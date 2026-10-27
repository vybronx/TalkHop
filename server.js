const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const crypto = require('crypto');
const Razorpay = require('razorpay');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// Enable CORS and JSON parsing
app.use(cors());
app.use(express.json());

// ==========================================
// RAZORPAY PAYMENT GATEWAY CONFIG (Milestone 5)
// ==========================================
const RZP_KEY_ID = process.env.RZP_KEY_ID || process.env.RAZORPAY_KEY_ID || '';
const RZP_KEY_SECRET = process.env.RZP_KEY_SECRET || process.env.RAZORPAY_KEY_SECRET || '';

let razorpayClient = null;
if (RZP_KEY_ID && RZP_KEY_SECRET) {
  try {
    razorpayClient = new Razorpay({
      key_id: RZP_KEY_ID,
      key_secret: RZP_KEY_SECRET
    });
    console.log('[Razorpay] Live SDK initialized with Key ID:', RZP_KEY_ID);
  } catch (err) {
    console.warn('[Razorpay] Failed to initialize live Razorpay instance:', err.message);
  }
} else {
  console.log('[Razorpay] Running in instant mock/sandbox mode (Set RZP_KEY_ID & RZP_KEY_SECRET for live payments)');
}

// Serve static assets from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Initialize Socket.io with optimized transport, CORS & resilient ping timeouts
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  pingInterval: 25000,
  pingTimeout: 20000,
  connectTimeout: 30000
});

// ==========================================
// SECRET ADMIN DASHBOARD CONFIG (Milestone 4)
// ==========================================
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'vybrant777x';

// In-memory active admin sessions: token -> { user, createdAt, expiresAt }
const adminSessions = new Map();
const ADMIN_SESSION_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

// In-memory admin audit log
const adminAuditLog = [
  {
    id: 'evt-init',
    timestamp: Date.now() - 3600000,
    action: 'System Initialized',
    type: 'system',
    admin: 'system',
    details: 'TalkHop WebRTC Engine active with dynamic ICE configuration'
  }
];

function logAdminActivity(action, type, details, admin = 'admin') {
  adminAuditLog.unshift({
    id: 'evt-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
    timestamp: Date.now(),
    action,
    type,
    admin: admin || 'admin',
    details
  });
  if (adminAuditLog.length > 100) adminAuditLog.pop();
}

// Rolling traffic history snapshots for Traffic & Sessions chart
const trafficHistory = [];
const MAX_TRAFFIC_SNAPSHOTS = 24;

function recordTrafficSnapshot() {
  const now = new Date();
  const hourLabel = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const totalOnline = typeof getUniqueOnlineCount === 'function' ? getUniqueOnlineCount() : 0;
  const inCall = typeof activePairs !== 'undefined' ? Math.floor(activePairs.size / 2) : 0;
  const inQueue = typeof waitingQueue !== 'undefined' ? waitingQueue.length : 0;

  trafficHistory.push({
    timestamp: Date.now(),
    hourLabel,
    onlineUsers: totalOnline,
    activeCalls: inCall,
    inQueue
  });

  if (trafficHistory.length > MAX_TRAFFIC_SNAPSHOTS) {
    trafficHistory.shift();
  }
}

// Seed initial traffic history snapshots (spaced 1h apart)
(function seedInitialTrafficHistory() {
  const now = Date.now();
  for (let i = 8; i >= 0; i--) {
    const time = new Date(now - i * 60 * 60 * 1000);
    trafficHistory.push({
      timestamp: time.getTime(),
      hourLabel: time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      onlineUsers: Math.max(0, i === 0 ? 1 : 0),
      activeCalls: 0,
      inQueue: 0
    });
  }
})();

setInterval(recordTrafficSnapshot, 5 * 60 * 1000);

// Live Sponsor & Monetization State (Dynamic Broadcast)
let liveSponsorConfig = {
  tag: '🎮 Verified Partner',
  subTag: 'Zero-Ad Monetization',
  message: 'Level up your setup with Vybronx Gaming Gear & Cloud Servers.',
  highlight: 'Vybronx Gaming Gear & Cloud Servers',
  urlText: 'Visit vybronx.online/store',
  url: 'https://vybronx.online'
};

/**
 * Middleware: Verify Admin Access via Bearer Token, X-Admin-Token, or Basic Auth
 */
function adminAuthMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (authHeader) {
    if (authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7).trim();
      const session = adminSessions.get(token);
      if (session && Date.now() < session.expiresAt) {
        req.adminUser = session.user || ADMIN_USER;
        return next();
      } else if (session) {
        adminSessions.delete(token);
      }
    } else if (authHeader.startsWith('Basic ')) {
      try {
        const credentials = Buffer.from(authHeader.substring(6), 'base64').toString('ascii');
        const [u, p] = credentials.split(':');
        if (u === ADMIN_USER && p === ADMIN_PASS) {
          req.adminUser = ADMIN_USER;
          return next();
        }
      } catch (e) {}
    }
  }

  const customToken = req.headers['x-admin-token'];
  if (customToken) {
    const session = adminSessions.get(customToken);
    if (session && Date.now() < session.expiresAt) {
      req.adminUser = session.user || ADMIN_USER;
      return next();
    }
  }

  return res.status(401).json({
    success: false,
    error: 'Unauthorized: Admin authentication token is required or expired.'
  });
}

// ==========================================
// IP BANNING & MODERATION SYSTEM (Milestone 3)
// ==========================================
// Map of IP -> { bannedUntil: number, reason: string }
const bannedIPs = new Map();

// Map of IP -> Array of report timestamps within 24h
const reportedIPs = new Map();

const REPORT_BAN_THRESHOLD = 3; // 3 reports triggers auto-ban
const BAN_DURATION_MS = 24 * 60 * 60 * 1000; // 24 Hours

/**
 * Extract normalized IP address from Socket.io handshake or request
 */
function getClientIp(socket) {
  if (!socket) return '127.0.0.1';
  const headers = socket.handshake ? socket.handshake.headers : socket.headers;
  const forwarded = headers ? headers['x-forwarded-for'] : null;
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  const address = socket.handshake ? socket.handshake.address : socket.ip;
  if (address === '::1' || address === '::ffff:127.0.0.1') {
    return '127.0.0.1';
  }
  return address || '127.0.0.1';
}

/**
 * Check if an IP address is currently banned
 */
function isIpBanned(ip) {
  if (!ip) return false;
  const banInfo = bannedIPs.get(ip);
  if (!banInfo) return false;

  const now = Date.now();
  if (now < banInfo.bannedUntil) {
    return true;
  }

  // Ban has expired, remove from memory
  bannedIPs.delete(ip);
  return false;
}

/**
 * Ban an IP address for specified duration (default 24 hours)
 */
function banIp(ip, reason, durationMs = BAN_DURATION_MS) {
  const bannedUntil = Date.now() + durationMs;
  bannedIPs.set(ip, { bannedUntil, reason });
  console.warn(`[BAN APPLIED] IP ${ip} has been banned until ${new Date(bannedUntil).toISOString()}. Reason: ${reason}`);
}

// Socket.io Connection Middleware: Reject Banned IPs
io.use((socket, next) => {
  const clientIp = getClientIp(socket);
  if (isIpBanned(clientIp)) {
    const ban = bannedIPs.get(clientIp);
    const hoursLeft = Math.ceil((ban.bannedUntil - Date.now()) / (1000 * 60 * 60));
    console.warn(`[Connection Blocked] Banned IP ${clientIp} attempted to connect.`);
    return next(new Error(`BANNED: Your IP is banned for community guidelines violations (${hoursLeft}h remaining).`));
  }
  next();
});

// ==========================================
// RAM-BASED IN-MEMORY MATCHMAKING & VIP STATE
// ==========================================

/**
 * Waiting queue holds objects:
 * {
 *   socketId: string,
 *   preferences: { myGender, myCountry, genderFilter, countryFilter },
 *   isVip: boolean,
 *   queuedAt: number,
 *   fallbackTimeout: NodeJS.Timeout | null
 * }
 */
let waitingQueue = [];

// Bidirectional lookup: socket.id -> partner.id
const activePairs = new Map();

// Active sessions: sessionId -> { sessionId, userA, userB, initiator, createdAt, state: 'active'|'interrupted', timer, interruptedUser }
const activeSessions = new Map();

// Map of socket.id -> sessionId
const socketSessions = new Map();

// Recovery grace period for transient network interruptions during active calls (15s)
const RECOVERY_GRACE_PERIOD_MS = 15000;

// Authoritative logical visitor presence: visitorId -> { visitorId, socketId, ip, connectedAt, lastSeen, isVip, vipCode, graceTimer }
const activeVisitors = new Map();

// Reverse mapping: socket.id -> visitorId
const socketVisitors = new Map();

// Map of socket.id -> metadata { state, preferences, vipCode, isVip, joinedAt, ip }
const userStates = new Map();

/**
 * Returns the authoritative count of unique logical online visitors.
 * Prevents multiple transports or reconnecting sockets from inflating the count.
 */
function getUniqueOnlineCount() {
  return activeVisitors.size;
}

/**
 * Broadcast current authoritative online user count to all connected clients
 */
function broadcastOnlineCount() {
  const count = getUniqueOnlineCount();
  io.emit('online-count', { count });
}

/**
 * VIP Passes Map:
 * code -> {
 *   code: string,
 *   plan: '1-hour' | '12-hour' | '24-hour',
 *   durationMs: number,
 *   price: number,
 *   createdAt: number,
 *   isActivated: boolean,
 *   activatedAt: number | null,
 *   expiresAt: number | null,
 *   activeSocketId: string | null
 * }
 */
const vipPasses = new Map();

// Helper: Generate secure 6-digit alphanumeric VIP code (e.g., VIP-7X92K)
function generateVipCode() {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let rand = '';
  for (let i = 0; i < 5; i++) {
    rand += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  const code = `VIP-${rand}`;
  if (vipPasses.has(code)) return generateVipCode();
  return code;
}

// Pre-seed sample VIP passes for testing convenience
const sample1Hour = 'VIP-7X92K';
vipPasses.set(sample1Hour, {
  code: sample1Hour,
  plan: '1-hour',
  durationMs: 3600000,
  price: 19,
  createdAt: Date.now(),
  isActivated: false,
  activatedAt: null,
  expiresAt: null,
  activeSocketId: null
});

const sample12Hour = 'VIP-9M34Q';
vipPasses.set(sample12Hour, {
  code: sample12Hour,
  plan: '12-hour',
  durationMs: 43200000,
  price: 39,
  createdAt: Date.now(),
  isActivated: false,
  activatedAt: null,
  expiresAt: null,
  activeSocketId: null
});

/**
 * Validate and clean a VIP pass for a given socket
 */
function checkVipStatus(socketId, code) {
  if (!code) return { valid: false, remainingMs: 0 };
  const pass = vipPasses.get(code.toUpperCase().trim());
  if (!pass) return { valid: false, message: 'Invalid VIP Code.' };

  if (!pass.isActivated) {
    return { valid: false, message: 'VIP Code has not been activated yet.' };
  }

  const now = Date.now();
  if (now >= pass.expiresAt) {
    pass.activeSocketId = null;
    return { valid: false, expired: true, message: 'This VIP Pass has expired.' };
  }

  const remainingMs = pass.expiresAt - now;
  return { valid: true, pass, remainingMs };
}

/**
 * Remove a socket from the waiting queue safely and clear fallback timer
 */
function removeFromQueue(socketId) {
  const index = waitingQueue.findIndex(item => item.socketId === socketId);
  if (index !== -1) {
    const item = waitingQueue[index];
    if (item.fallbackTimeout) {
      clearTimeout(item.fallbackTimeout);
    }
    waitingQueue.splice(index, 1);
    return true;
  }
  return false;
}

/**
 * Clear session and timers safely
 */
function clearSession(sessionId) {
  if (!sessionId) return;
  const session = activeSessions.get(sessionId);
  if (session) {
    if (session.timer) clearTimeout(session.timer);
    activeSessions.delete(sessionId);
    if (session.userA) socketSessions.delete(session.userA);
    if (session.userB) socketSessions.delete(session.userB);
  }
}

/**
 * Clean up active pairing for a given socket and notify their partner
 */
function disconnectCurrentPair(socketId, reason = 'skipped') {
  const sessionId = socketSessions.get(socketId);
  if (sessionId) {
    clearSession(sessionId);
  }

  const partnerId = activePairs.get(socketId);

  // Remove both directions from activePairs
  activePairs.delete(socketId);

  if (userStates.has(socketId)) {
    userStates.get(socketId).state = 'idle';
  }

  if (partnerId) {
    activePairs.delete(partnerId);

    if (userStates.has(partnerId)) {
      userStates.get(partnerId).state = 'idle';
    }

    const partnerSocket = io.sockets.sockets.get(partnerId);
    if (partnerSocket && partnerSocket.connected) {
      let partnerMsg = 'Stranger has disconnected or skipped.';
      if (reason === 'reported') {
        partnerMsg = 'Stranger reported the chat and moved to a new match.';
      } else if (reason === 'nsfw_ban') {
        partnerMsg = 'Stranger was disconnected and banned for community safety violations.';
      } else if (reason === 'disconnected_timeout') {
        partnerMsg = 'Stranger disconnected due to network timeout.';
      }

      partnerSocket.emit('partner-disconnected', {
        reason,
        message: partnerMsg
      });
    }
    return partnerId;
  }

  return null;
}

/**
 * Evaluate if two users' preferences match both ways
 */
function isFilterMatch(userA, userB) {
  const pA = userA.preferences || {};
  const pB = userB.preferences || {};

  // Check userA's filter requirements against userB
  if (pA.genderFilter && pA.genderFilter !== 'any') {
    if (pB.myGender && pB.myGender !== pA.genderFilter) {
      return false;
    }
  }

  if (pA.countryFilter && pA.countryFilter !== 'any') {
    if (pB.myCountry && pB.myCountry.toUpperCase() !== pA.countryFilter.toUpperCase()) {
      return false;
    }
  }

  // Check userB's filter requirements against userA
  if (pB.genderFilter && pB.genderFilter !== 'any') {
    if (pA.myGender && pA.myGender !== pB.genderFilter) {
      return false;
    }
  }

  if (pB.countryFilter && pB.countryFilter !== 'any') {
    if (pA.myCountry && pA.myCountry.toUpperCase() !== pB.countryFilter.toUpperCase()) {
      return false;
    }
  }

  return true;
}

/**
 * Pair two active sockets together with unique session identifier and mode
 */
function pairSockets(socketA, socketB, matchedWithFilters = true, mode = 'video') {
  const idA = socketA.id;
  const idB = socketB.id;
  const sessionId = 'sess_' + crypto.randomBytes(8).toString('hex');
  const sessionMode = (mode === 'text') ? 'text' : 'video';

  activePairs.set(idA, idB);
  activePairs.set(idB, idA);

  const sessionObj = {
    sessionId,
    userA: idA,
    userB: idB,
    initiator: idA,
    mode: sessionMode,
    createdAt: Date.now(),
    state: 'active',
    timer: null,
    interruptedUser: null
  };
  activeSessions.set(sessionId, sessionObj);
  socketSessions.set(idA, sessionId);
  socketSessions.set(idB, sessionId);

  if (userStates.has(idA)) userStates.get(idA).state = 'in_call';
  if (userStates.has(idB)) userStates.get(idB).state = 'in_call';

  console.log(`[Match] Paired: ${idA} <---> ${idB} (Session: ${sessionId}, Mode: ${sessionMode}, FilterMatched: ${matchedWithFilters})`);

  // Designate socketA as initiator and socketB as receiver
  socketA.emit('match-found', {
    sessionId,
    initiator: true,
    partnerId: idB,
    filterMatched: matchedWithFilters,
    mode: sessionMode
  });

  socketB.emit('match-found', {
    sessionId,
    initiator: false,
    partnerId: idA,
    filterMatched: matchedWithFilters,
    mode: sessionMode
  });
}

/**
 * Handle graceful fallback if VIP user waiting with filters finds no match after 5s
 */
function handleVipFallback(socketId) {
  const index = waitingQueue.findIndex(item => item.socketId === socketId);
  if (index === -1) return;

  const queueEntry = waitingQueue[index];
  const socket = io.sockets.sockets.get(socketId);
  if (!socket || !socket.connected) {
    waitingQueue.splice(index, 1);
    return;
  }

  const desiredMode = queueEntry.mode || 'video';
  console.log(`[Fallback] 5s elapsed for VIP user ${socketId}. Finding best available ${desiredMode} match.`);

  let candidateIndex = -1;
  for (let i = 0; i < waitingQueue.length; i++) {
    if (waitingQueue[i].socketId !== socketId && (waitingQueue[i].mode || 'video') === desiredMode) {
      const cSocket = io.sockets.sockets.get(waitingQueue[i].socketId);
      if (cSocket && cSocket.connected) {
        candidateIndex = i;
        break;
      }
    }
  }

  if (candidateIndex !== -1) {
    const candidateEntry = waitingQueue.splice(candidateIndex, 1)[0];
    const selfIdx = waitingQueue.findIndex(item => item.socketId === socketId);
    if (selfIdx !== -1) waitingQueue.splice(selfIdx, 1);

    if (candidateEntry.fallbackTimeout) clearTimeout(candidateEntry.fallbackTimeout);
    if (queueEntry.fallbackTimeout) clearTimeout(queueEntry.fallbackTimeout);

    const candidateSocket = io.sockets.sockets.get(candidateEntry.socketId);
    if (candidateSocket) {
      socket.emit('match-notice', {
        message: 'No exact filter match in queue. Connected to best available stranger.'
      });
      pairSockets(socket, candidateSocket, false, desiredMode);
    }
  } else {
    socket.emit('match-notice', {
      message: 'Still searching for your filter preference... Hang tight!'
    });
  }
}

/**
 * Match a user with waiting peers taking preferences, mode, and VIP priority into account
 */
function matchUser(socket, incomingPreferences = null, mode = 'video') {
  const socketId = socket.id;
  const desiredMode = (mode === 'text') ? 'text' : 'video';

  // 1. Clean previous state
  removeFromQueue(socketId);
  disconnectCurrentPair(socketId, 'skipped');

  // 2. Resolve preferences & VIP verification
  const currentUserState = userStates.get(socketId) || {};
  const preferences = incomingPreferences || currentUserState.preferences || {
    myGender: 'male',
    myCountry: 'IN',
    genderFilter: 'any',
    countryFilter: 'any'
  };

  const clientCountry = socket.handshake.headers['cf-ipcountry'] ||
    socket.handshake.headers['x-country'] ||
    preferences.myCountry || 'IN';
  preferences.myCountry = clientCountry;

  let isVip = Boolean(currentUserState.isVip);
  if ((preferences.genderFilter && preferences.genderFilter !== 'any') || preferences.countryFilter !== 'any') {
    const vipCheck = checkVipStatus(socketId, currentUserState.vipCode);
    if (!vipCheck.valid) {
      preferences.genderFilter = 'any';
      preferences.countryFilter = 'any';
      isVip = false;
      socket.emit('vip-expired-notice', {
        message: vipCheck.message || 'VIP Pass required for gender & country filters.'
      });
    } else {
      isVip = true;
    }
  }

  currentUserState.preferences = preferences;
  currentUserState.isVip = isVip;
  currentUserState.mode = desiredMode;
  userStates.set(socketId, currentUserState);

  const userEntry = {
    socketId,
    preferences,
    isVip,
    mode: desiredMode,
    queuedAt: Date.now(),
    fallbackTimeout: null
  };

  // 3. Search waitingQueue for a matching partner with IDENTICAL MODE
  let matchIndex = -1;

  // Priority pass: exact filter match and identical mode
  for (let i = 0; i < waitingQueue.length; i++) {
    const candidate = waitingQueue[i];
    if (candidate.socketId !== socketId && (candidate.mode || 'video') === desiredMode) {
      const candidateSocket = io.sockets.sockets.get(candidate.socketId);
      if (candidateSocket && candidateSocket.connected) {
        if (isFilterMatch(userEntry, candidate)) {
          matchIndex = i;
          break;
        }
      }
    }
  }

  // Secondary pass: if user has no filter requirements and candidate has no filter requirements, pair them (same mode!)
  if (matchIndex === -1 && preferences.genderFilter === 'any' && preferences.countryFilter === 'any') {
    for (let i = 0; i < waitingQueue.length; i++) {
      const candidate = waitingQueue[i];
      if (candidate.socketId !== socketId && (candidate.mode || 'video') === desiredMode) {
        const candidateSocket = io.sockets.sockets.get(candidate.socketId);
        if (candidateSocket && candidateSocket.connected) {
          if (isFilterMatch(userEntry, candidate)) {
            matchIndex = i;
            break;
          }
        }
      }
    }
  }

  // 4. If matched, establish pairing
  if (matchIndex !== -1) {
    const candidateEntry = waitingQueue.splice(matchIndex, 1)[0];
    if (candidateEntry.fallbackTimeout) {
      clearTimeout(candidateEntry.fallbackTimeout);
    }

    const partnerSocket = io.sockets.sockets.get(candidateEntry.socketId);
    if (partnerSocket && partnerSocket.connected) {
      pairSockets(socket, partnerSocket, true, desiredMode);
      return;
    }
  }

  // 5. No match found immediately, place into waitingQueue
  const hasSpecificFilter = (preferences.genderFilter !== 'any' || preferences.countryFilter !== 'any');

  if (isVip && hasSpecificFilter) {
    userEntry.fallbackTimeout = setTimeout(() => {
      handleVipFallback(socketId);
    }, 5000);
  }

  waitingQueue.push(userEntry);
  currentUserState.state = 'waiting';
  userStates.set(socketId, currentUserState);

  const modeLabel = (desiredMode === 'text') ? 'text chat' : 'video call';
  socket.emit('waiting', {
    mode: desiredMode,
    message: hasSpecificFilter
      ? `Priority queue active: searching for ${preferences.genderFilter !== 'any' ? (preferences.genderFilter === 'female' ? 'Female' : 'Male') : ''} ${preferences.countryFilter !== 'any' ? preferences.countryFilter : ''} stranger for ${modeLabel}...`
      : `Looking for a stranger for ${modeLabel}...`
  });
}

// ==========================================
// REST API ENDPOINTS FOR MICRO-PASS & RAZORPAY (Milestone 5)
// ==========================================

// 1. Create Razorpay Order
app.post('/api/payment/create-order', async (req, res) => {
  try {
    const { plan = '1-hour' } = req.body;
    let amountInPaise = 1900;
    let priceInRupees = 19;
    if (plan === '12-hour') {
      amountInPaise = 3900;
      priceInRupees = 39;
    } else if (plan === '24-hour') {
      amountInPaise = 5900;
      priceInRupees = 59;
    }

    if (razorpayClient) {
      const options = {
        amount: amountInPaise,
        currency: 'INR',
        receipt: `vybrant_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        notes: {
          plan,
          service: 'Vybrant VIP Micro-Pass'
        }
      };
      const order = await razorpayClient.orders.create(options);
      return res.json({
        success: true,
        order_id: order.id,
        amount: order.amount,
        currency: order.currency,
        key_id: RZP_KEY_ID,
        plan,
        price: priceInRupees
      });
    }

    // Sandbox / Mock fallback order when keys are not set
    const mockOrderId = `order_mock_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    res.json({
      success: true,
      order_id: mockOrderId,
      amount: amountInPaise,
      currency: 'INR',
      key_id: RZP_KEY_ID || 'rzp_test_mock_sandbox',
      plan,
      price: priceInRupees,
      isMock: true
    });
  } catch (err) {
    console.error('[Razorpay] Order creation error:', err);
    res.status(500).json({ success: false, message: 'Failed to create payment order.' });
  }
});

// 2. Verify Razorpay Payment Signature & Issue VIP Code
app.post('/api/payment/verify', (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, plan = '1-hour' } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id) {
      return res.status(400).json({ success: false, message: 'Missing order or payment ID.' });
    }

    const isMock = razorpay_order_id.startsWith('order_mock_') || !RZP_KEY_SECRET;

    if (!isMock) {
      // Cryptographic HMAC-SHA256 signature verification
      const expectedSignature = crypto
        .createHmac('sha256', RZP_KEY_SECRET)
        .update(`${razorpay_order_id}|${razorpay_payment_id}`)
        .digest('hex');

      if (expectedSignature !== razorpay_signature) {
        console.warn('[Razorpay] Signature mismatch:', { expectedSignature, razorpay_signature });
        return res.status(400).json({
          success: false,
          message: 'Invalid payment signature. Verification failed.'
        });
      }
    }

    // Payment signature verified - generate genuine 6-digit VIP pass
    let durationMs = 3600000;
    let price = 19;
    if (plan === '12-hour') {
      durationMs = 43200000;
      price = 39;
    } else if (plan === '24-hour') {
      durationMs = 86400000; // 24 Hours
      price = 59;
    }
    const code = generateVipCode();

    const newPass = {
      code,
      plan,
      durationMs,
      price,
      createdAt: Date.now(),
      isActivated: false,
      activatedAt: null,
      expiresAt: null,
      activeSocketId: null,
      paymentId: razorpay_payment_id,
      orderId: razorpay_order_id,
      verifiedAt: Date.now()
    };

    vipPasses.set(code, newPass);
    console.log(`[VIP Payment] Verified order ${razorpay_order_id} -> Generated VIP Pass: ${code} (${plan}, ₹${price})`);

    res.json({
      success: true,
      code,
      plan,
      price,
      durationMs,
      message: 'Payment verified successfully! VIP pass generated.'
    });
  } catch (err) {
    console.error('[Razorpay] Verification error:', err);
    res.status(500).json({ success: false, message: 'Internal error verifying payment.' });
  }
});
app.post('/api/vip/purchase', (req, res) => {
  const { plan = '1-hour' } = req.body;

  let durationMs = 3600000; // 1 hour
  let price = 19;

  if (plan === '12-hour') {
    durationMs = 43200000; // 12 hours
    price = 39;
  } else if (plan === '24-hour') {
    durationMs = 86400000; // 24 hours
    price = 59;
  }

  const code = generateVipCode();
  const newPass = {
    code,
    plan,
    durationMs,
    price,
    createdAt: Date.now(),
    isActivated: false,
    activatedAt: null,
    expiresAt: null,
    activeSocketId: null
  };

  vipPasses.set(code, newPass);
  console.log(`[VIP] Generated Pass: ${code} (${plan}, ₹${price})`);

  res.json({
    success: true,
    code,
    plan,
    price,
    durationMs,
    message: 'Pass purchased successfully. Ready to activate or save for later.'
  });
});

app.post('/api/vip/redeem', (req, res) => {
  const { code, socketId } = req.body;
  if (!code) {
    return res.status(400).json({ success: false, message: 'VIP code is required.' });
  }

  const normalizedCode = code.toUpperCase().trim();
  const pass = vipPasses.get(normalizedCode);

  if (!pass) {
    return res.status(404).json({ success: false, message: 'Invalid VIP Code. Please check and try again.' });
  }

  const now = Date.now();

  // 1-Device Concurrency Lock Check
  if (pass.activeSocketId && pass.activeSocketId !== socketId) {
    const existingSocket = io.sockets.sockets.get(pass.activeSocketId);
    if (existingSocket && existingSocket.connected) {
      return res.status(409).json({
        success: false,
        message: 'This VIP pass is actively in use on another device/tab. (1-Device Concurrency Lock active).'
      });
    } else {
      pass.activeSocketId = null;
    }
  }

  if (!pass.isActivated) {
    pass.isActivated = true;
    pass.activatedAt = now;
    pass.expiresAt = now + pass.durationMs;
  } else {
    if (now >= pass.expiresAt) {
      pass.activeSocketId = null;
      return res.status(410).json({
        success: false,
        message: 'This VIP Pass has expired.'
      });
    }
  }

  if (socketId) {
    pass.activeSocketId = socketId;
    const userState = userStates.get(socketId) || {};
    userState.isVip = true;
    userState.vipCode = normalizedCode;
    userStates.set(socketId, userState);
  }

  const remainingMs = Math.max(0, pass.expiresAt - now);

  res.json({
    success: true,
    code: pass.code,
    plan: pass.plan,
    price: pass.price,
    expiresAt: pass.expiresAt,
    remainingMs,
    message: `VIP Pass active! Remaining time: ${Math.round(remainingMs / 60000)} minutes.`
  });
});

// ==========================================
// SOCKET.IO EVENT HANDLERS
// ==========================================
io.on('connection', (socket) => {
  const clientIp = getClientIp(socket);
  const detectedCountry = socket.handshake.headers['cf-ipcountry'] || 'IN';

  // Authoritative logical visitor tracking
  const rawVisitorId = (socket.handshake.auth && socket.handshake.auth.visitorId) ||
                       (socket.handshake.query && socket.handshake.query.visitorId);
  const visitorId = (typeof rawVisitorId === 'string' && rawVisitorId.length >= 4 && rawVisitorId.length <= 64)
    ? rawVisitorId.trim()
    : socket.id;

  console.log(`[Connect] Socket ${socket.id} (Visitor: ${visitorId}) connected from IP: ${clientIp} (Country: ${detectedCountry})`);

  // Handle re-connecting visitor who already had an older/stale socket
  const existingVisitor = activeVisitors.get(visitorId);
  if (existingVisitor) {
    const oldSocketId = existingVisitor.socketId;
    if (oldSocketId && oldSocketId !== socket.id) {
      console.log(`[Presence] Visitor ${visitorId} re-connected (replacing stale socket ${oldSocketId} with ${socket.id})`);

      if (existingVisitor.graceTimer) {
        clearTimeout(existingVisitor.graceTimer);
        existingVisitor.graceTimer = null;
      }

      socketVisitors.delete(oldSocketId);

      // Transfer user state preferences and VIP status to new socket
      const oldUserState = userStates.get(oldSocketId);
      if (oldUserState) {
        userStates.set(socket.id, { ...oldUserState, state: oldUserState.state || 'idle' });
        userStates.delete(oldSocketId);
      }

      // Update matchmaking queue reference
      const queueIdx = waitingQueue.findIndex(q => q.socketId === oldSocketId);
      if (queueIdx !== -1) {
        waitingQueue[queueIdx].socketId = socket.id;
      }

      // Auto-rebind active session and active pairs
      const activeSessionId = socketSessions.get(oldSocketId);
      if (activeSessionId && activeSessions.has(activeSessionId)) {
        const sess = activeSessions.get(activeSessionId);
        if (sess.timer) {
          clearTimeout(sess.timer);
          sess.timer = null;
        }
        if (sess.userA === oldSocketId) sess.userA = socket.id;
        if (sess.userB === oldSocketId) sess.userB = socket.id;
        sess.state = 'active';
        sess.interruptedUser = null;

        socketSessions.delete(oldSocketId);
        socketSessions.set(socket.id, activeSessionId);

        const partnerId = activePairs.get(oldSocketId);
        if (partnerId) {
          activePairs.delete(oldSocketId);
          activePairs.set(socket.id, partnerId);
          activePairs.set(partnerId, socket.id);
        }
        console.log(`[Presence] Session ${activeSessionId} smoothly rebound to new socket ${socket.id}`);
      }

      try {
        const oldSock = io.sockets.sockets.get(oldSocketId);
        if (oldSock && oldSock.connected) {
          oldSock.disconnect(true);
        }
      } catch (e) {}
    }
  }

  activeVisitors.set(visitorId, {
    visitorId,
    socketId: socket.id,
    ip: clientIp,
    connectedAt: existingVisitor?.connectedAt || Date.now(),
    lastSeen: Date.now(),
    graceTimer: null
  });
  socketVisitors.set(socket.id, visitorId);

  if (!userStates.has(socket.id)) {
    userStates.set(socket.id, {
      state: 'idle',
      joinedAt: Date.now(),
      ip: clientIp,
      isVip: false,
      vipCode: null,
      preferences: {
        myGender: 'male',
        myCountry: detectedCountry,
        genderFilter: 'any',
        countryFilter: 'any'
      }
    });
  }

  // Broadcast authoritative count to all clients
  broadcastOnlineCount();
  socket.emit('detected-country', { country: detectedCountry });
  socket.emit('sponsor-config', liveSponsorConfig);

  // User starts searching
  socket.on('start-search', (data) => {
    const mode = (data && data.mode === 'text') ? 'text' : 'video';
    matchUser(socket, data && data.preferences, mode);
  });

  // User hits SKIP
  socket.on('skip', (data) => {
    console.log(`[Skip] Socket ${socket.id} requested skip`);
    const mode = (data && data.mode === 'text') ? 'text' : 'video';
    matchUser(socket, data && data.preferences, mode);
  });

  // User updates preferences
  socket.on('update-preferences', (prefs) => {
    const userState = userStates.get(socket.id);
    if (userState && prefs) {
      userState.preferences = { ...userState.preferences, ...prefs };
      userStates.set(socket.id, userState);
    }
  });

  // Activate / Redeem VIP via Socket
  socket.on('activate-vip', (data, callback) => {
    const code = data && data.code ? data.code.toUpperCase().trim() : null;
    if (!code) {
      if (callback) callback({ success: false, message: 'VIP code required.' });
      return;
    }

    const pass = vipPasses.get(code);
    if (!pass) {
      if (callback) callback({ success: false, message: 'Invalid VIP Code.' });
      return;
    }

    const now = Date.now();

    if (pass.activeSocketId && pass.activeSocketId !== socket.id) {
      const activeSock = io.sockets.sockets.get(pass.activeSocketId);
      if (activeSock && activeSock.connected) {
        if (callback) callback({
          success: false,
          message: 'VIP pass is currently in use on another device/session.'
        });
        return;
      }
    }

    if (!pass.isActivated) {
      pass.isActivated = true;
      pass.activatedAt = now;
      pass.expiresAt = now + pass.durationMs;
    } else if (now >= pass.expiresAt) {
      if (callback) callback({ success: false, message: 'This VIP code has expired.' });
      return;
    }

    pass.activeSocketId = socket.id;

    const userState = userStates.get(socket.id) || {};
    userState.isVip = true;
    userState.vipCode = code;
    userStates.set(socket.id, userState);

    const remainingMs = pass.expiresAt - now;

    if (callback) {
      callback({
        success: true,
        code: pass.code,
        plan: pass.plan,
        expiresAt: pass.expiresAt,
        remainingMs
      });
    }

    socket.emit('vip-activated', {
      code: pass.code,
      plan: pass.plan,
      expiresAt: pass.expiresAt,
      remainingMs
    });
  });

  // ==========================================
  // MILESTONE 3: REPORT & IP AUTO-BAN SYSTEM
  // ==========================================
  const handlePeerReport = (data) => {
    const reason = (data && data.reason) || 'Inappropriate behavior';
    const partnerId = activePairs.get(socket.id);

    if (partnerId) {
      const partnerSocket = io.sockets.sockets.get(partnerId);
      const partnerState = userStates.get(partnerId);
      const partnerIp = partnerState ? partnerState.ip : (partnerSocket ? getClientIp(partnerSocket) : null);

      if (partnerIp) {
        const reports = reportedIPs.get(partnerIp) || [];
        const now = Date.now();
        // Keep reports from last 24h
        const recentReports = reports.filter(t => now - t < BAN_DURATION_MS);
        recentReports.push(now);
        reportedIPs.set(partnerIp, recentReports);

        console.warn(`[Report] User ${partnerId} (IP: ${partnerIp}) reported by ${socket.id}. Total recent reports: ${recentReports.length}. Reason: ${reason}`);

        if (recentReports.length >= REPORT_BAN_THRESHOLD) {
          console.warn(`[Auto-Ban] IP ${partnerIp} reached threshold of ${REPORT_BAN_THRESHOLD} reports. Applying 24-hour ban.`);
          banIp(partnerIp, `Auto-ban: Accumulated ${recentReports.length} user reports.`);

          if (partnerSocket && partnerSocket.connected) {
            partnerSocket.emit('banned', {
              reason: 'Your IP has been banned for 24 hours due to multiple community violations and peer reports.'
            });
            setTimeout(() => {
              partnerSocket.disconnect(true);
            }, 500);
          }
        }
      }
    }

    // Disconnect pair and match reporter with a fresh peer immediately
    disconnectCurrentPair(socket.id, 'reported');
    matchUser(socket, data && data.preferences);
  };

  // Wire up 'report-peer' and 'report'
  socket.on('report-peer', handlePeerReport);
  socket.on('report', handlePeerReport);

  // MILESTONE 3: Browser-Side NSFW Shield Violation Event
  socket.on('nsfw_violation', (data) => {
    const detectedReason = (data && data.reason) || 'AI Safety Shield: Inappropriate/NSFW content detected';
    const violatorIp = clientIp;

    console.warn(`[NSFW Violation] Socket ${socket.id} (IP: ${violatorIp}) triggered NSFW Shield! Auto-banning for 24 hours.`);

    // 1. Instantly ban violator's IP for 24 hours
    banIp(violatorIp, detectedReason, BAN_DURATION_MS);

    // 2. Disconnect partner cleanly with notice
    disconnectCurrentPair(socket.id, 'nsfw_ban');

    // 3. Emit ban notice to violator and terminate connection
    socket.emit('banned', {
      reason: 'Your IP has been banned for 24 hours. Reason: Adult/NSFW content is strictly prohibited.'
    });

    setTimeout(() => {
      socket.disconnect(true);
    }, 500);
  });

  // User pauses matching
  socket.on('stop-search', () => {
    removeFromQueue(socket.id);
    disconnectCurrentPair(socket.id, 'stopped');
    if (userStates.has(socket.id)) {
      userStates.get(socket.id).state = 'idle';
    }
    socket.emit('stopped');
  });

  // WebRTC Signaling: Offer
  socket.on('offer', (data) => {
    const partnerId = activePairs.get(socket.id);
    if (partnerId) {
      io.to(partnerId).emit('offer', {
        offer: data.offer,
        from: socket.id
      });
    }
  });

  // WebRTC Signaling: Answer
  socket.on('answer', (data) => {
    const partnerId = activePairs.get(socket.id);
    if (partnerId) {
      io.to(partnerId).emit('answer', {
        answer: data.answer,
        from: socket.id
      });
    }
  });

  // WebRTC Signaling: ICE Candidate
  socket.on('ice-candidate', (data) => {
    const partnerId = activePairs.get(socket.id);
    if (partnerId && data.candidate) {
      io.to(partnerId).emit('ice-candidate', {
        candidate: data.candidate,
        from: socket.id
      });
    }
  });

  // WebRTC Signaling: ICE Restart Request
  socket.on('ice-restart', (data) => {
    const partnerId = activePairs.get(socket.id);
    if (partnerId) {
      io.to(partnerId).emit('ice-restart-needed', {
        from: socket.id,
        reason: (data && data.reason) || 'ice_failure'
      });
    }
  });

  // Cross-Direction Media Quality Adaptation Hint (Relieve receiver downlink congestion)
  socket.on('media-quality-hint', (data) => {
    const partnerId = activePairs.get(socket.id);
    if (partnerId) {
      io.to(partnerId).emit('peer-media-quality-hint', {
        targetTier: (data && typeof data.targetTier === 'number') ? data.targetTier : 1,
        reason: (data && data.reason) || 'receiver_downlink_congestion'
      });
    }
  });

  // Session Recovery: Reconnect existing call after transient network/signaling drop
  socket.on('reconnect-session', (data, callback) => {
    const { sessionId, lastPartnerId } = data || {};
    if (!sessionId || !activeSessions.has(sessionId)) {
      if (callback) callback({ success: false, message: 'Session expired or not found.' });
      return;
    }

    const session = activeSessions.get(sessionId);
    const partnerId = (session.userA === session.interruptedUser) ? session.userB : session.userA;
    const partnerSocket = io.sockets.sockets.get(partnerId);

    if (!partnerSocket || !partnerSocket.connected) {
      if (session.timer) clearTimeout(session.timer);
      clearSession(sessionId);
      if (callback) callback({ success: false, message: 'Partner is no longer connected.' });
      return;
    }

    // Cancel expiration timer immediately
    if (session.timer) {
      clearTimeout(session.timer);
      session.timer = null;
    }

    const oldId = session.interruptedUser || socket.id;
    if (session.userA === oldId) session.userA = socket.id;
    if (session.userB === oldId) session.userB = socket.id;
    session.state = 'active';
    session.interruptedUser = null;

    socketSessions.delete(oldId);
    socketSessions.set(socket.id, sessionId);

    activePairs.delete(oldId);
    activePairs.set(socket.id, partnerId);
    activePairs.set(partnerId, socket.id);

    const currentUserState = userStates.get(socket.id) || {};
    currentUserState.state = 'in_call';
    userStates.set(socket.id, currentUserState);

    console.log(`[Session Recovery] Successfully recovered session ${sessionId}! Old socket ${oldId} -> New socket ${socket.id}`);

    const isInitiator = (session.initiator === oldId || session.initiator === socket.id);

    if (callback) {
      callback({
        success: true,
        sessionId,
        partnerId,
        isInitiator
      });
    }

    socket.emit('session-recovered', {
      sessionId,
      partnerId,
      isInitiator
    });

    partnerSocket.emit('session-recovered', {
      sessionId,
      partnerId: socket.id
    });
  });

  // Ephemeral Chat Fallback
  socket.on('chat-message', (data) => {
    const partnerId = activePairs.get(socket.id);
    if (partnerId && data && data.message) {
      const cleanMessage = String(data.message).slice(0, 1000);
      io.to(partnerId).emit('chat-message', {
        message: cleanMessage,
        timestamp: Date.now()
      });
    }
  });

  // Typing indicator
  socket.on('typing', (data) => {
    const partnerId = activePairs.get(socket.id);
    if (partnerId) {
      io.to(partnerId).emit('partner-typing', {
        isTyping: Boolean(data && data.isTyping)
      });
    }
  });

  // Mode Transition: Request switch from text chat to live video call
  socket.on('request-video-switch', (data) => {
    const partnerId = activePairs.get(socket.id);
    const sessionId = socketSessions.get(socket.id);
    if (partnerId) {
      console.log(`[Mode Switch] Socket ${socket.id} requested video switch to partner ${partnerId}`);
      io.to(partnerId).emit('partner-requested-video-switch', {
        from: socket.id,
        sessionId
      });
    }
  });

  // Mode Transition: Accept video switch request
  socket.on('accept-video-switch', (data) => {
    const partnerId = activePairs.get(socket.id);
    const sessionId = socketSessions.get(socket.id);
    if (partnerId) {
      const partnerSocket = io.sockets.sockets.get(partnerId);
      if (partnerSocket && partnerSocket.connected) {
        if (sessionId && activeSessions.has(sessionId)) {
          const session = activeSessions.get(sessionId);
          session.mode = 'video';
        }
        console.log(`[Mode Switch] Video switch accepted between ${socket.id} and ${partnerId}`);
        // Partner who requested is initiator, accepting user is receiver
        partnerSocket.emit('video-switch-accepted', {
          sessionId,
          partnerId: socket.id,
          initiator: true
        });
        socket.emit('video-switch-accepted', {
          sessionId,
          partnerId,
          initiator: false
        });
      }
    }
  });

  // Mode Transition: Decline video switch request
  socket.on('decline-video-switch', (data) => {
    const partnerId = activePairs.get(socket.id);
    if (partnerId) {
      console.log(`[Mode Switch] Socket ${socket.id} declined video switch from partner ${partnerId}`);
      io.to(partnerId).emit('video-switch-declined', {
        from: socket.id,
        message: 'Stranger declined to switch to video.'
      });
    }
  });

  // Mode Transition: Switch from video back to text chat
  socket.on('switch-to-text', (data) => {
    const partnerId = activePairs.get(socket.id);
    const sessionId = socketSessions.get(socket.id);
    if (sessionId && activeSessions.has(sessionId)) {
      const session = activeSessions.get(sessionId);
      session.mode = 'text';
    }
    if (partnerId) {
      console.log(`[Mode Switch] Switched to text chat between ${socket.id} and ${partnerId}`);
      io.to(partnerId).emit('switched-to-text', { sessionId });
    }
    socket.emit('switched-to-text', { sessionId });
  });

  // Disconnection handler with session recovery grace period & authoritative presence
  socket.on('disconnect', (reason) => {
    console.log(`[Disconnect] Socket ${socket.id} disconnected (${reason})`);
    removeFromQueue(socket.id);

    const visitorId = socketVisitors.get(socket.id);
    socketVisitors.delete(socket.id);

    const sessionId = socketSessions.get(socket.id);
    const partnerId = activePairs.get(socket.id);
    const userState = userStates.get(socket.id);
    const wasInCall = userState && userState.state === 'in_call' && partnerId;

    const isCurrentActiveSocketForVisitor = visitorId && activeVisitors.get(visitorId)?.socketId === socket.id;

    if (wasInCall && sessionId && activeSessions.has(sessionId)) {
      const session = activeSessions.get(sessionId);
      const partnerSocket = io.sockets.sockets.get(partnerId);

      if (partnerSocket && partnerSocket.connected) {
        // Put session in interrupted state with grace period
        session.state = 'interrupted';
        session.interruptedUser = socket.id;
        session.interruptedAt = Date.now();

        console.log(`[Session Recovery] Call interrupted for session ${sessionId}. Granting ${RECOVERY_GRACE_PERIOD_MS}ms recovery grace period.`);

        partnerSocket.emit('partner-interrupted', {
          sessionId,
          reason: 'network_interruption',
          gracePeriodMs: RECOVERY_GRACE_PERIOD_MS,
          message: 'Stranger network connection interrupted. Attempting recovery...'
        });

        if (session.timer) clearTimeout(session.timer);

        session.timer = setTimeout(() => {
          console.log(`[Session Recovery] Grace period expired for session ${sessionId}. Terminating pair.`);
          clearSession(sessionId);
          disconnectCurrentPair(socket.id, 'disconnected_timeout');

          // If the visitor never reconnected, remove presence now
          if (visitorId && activeVisitors.has(visitorId)) {
            const vRecord = activeVisitors.get(visitorId);
            if (vRecord.socketId === socket.id) {
              activeVisitors.delete(visitorId);
              userStates.delete(socket.id);
              broadcastOnlineCount();
              console.log(`[Presence] Visitor ${visitorId} presence removed after grace period expiration. Remaining online: ${activeVisitors.size}`);
            }
          }
        }, RECOVERY_GRACE_PERIOD_MS);

        // Keep activeVisitors intact during recovery grace period so online count does not prematurely drop
        return;
      }
    }

    if (sessionId) {
      clearSession(sessionId);
    }
    disconnectCurrentPair(socket.id, 'disconnected');

    if (userState && userState.vipCode) {
      const pass = vipPasses.get(userState.vipCode);
      if (pass && pass.activeSocketId === socket.id) {
        pass.activeSocketId = null;
        console.log(`[VIP] Released concurrency lock for pass ${pass.code} on socket disconnect`);
      }
    }

    userStates.delete(socket.id);

    // If this socket was the authoritative socket for the visitor, remove presence
    if (isCurrentActiveSocketForVisitor) {
      activeVisitors.delete(visitorId);
      console.log(`[Presence] Visitor ${visitorId} (socket ${socket.id}) disconnected. Remaining online: ${activeVisitors.size}`);
      broadcastOnlineCount();
    } else {
      console.log(`[Presence] Stale socket ${socket.id} closed; active visitor ${visitorId} remains online (${activeVisitors.size})`);
    }
  });
});

// Dynamic STUN/TURN ICE Server Configuration
app.get('/api/rtc-config', (req, res) => {
  const iceServers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ];

  const customTurnUrl = process.env.TURN_URL;
  const customTurnUser = process.env.TURN_USERNAME;
  const customTurnCred = process.env.TURN_CREDENTIAL;

  if (customTurnUrl && customTurnUser && customTurnCred) {
    iceServers.push({
      urls: customTurnUrl,
      username: customTurnUser,
      credential: customTurnCred
    });
  } else {
    // Default Metered.ca TURN fallback configuration
    const meteredUser = process.env.METERED_USER || "1654f590900e48e1a4ae720e";
    const meteredCred = process.env.METERED_CREDENTIAL || "uc4KT1+bOvxoS9js";
    iceServers.push(
      { urls: "stun:stun.relay.metered.ca:80" },
      {
        urls: "turn:global.relay.metered.ca:80",
        username: meteredUser,
        credential: meteredCred
      },
      {
        urls: "turn:global.relay.metered.ca:443",
        username: meteredUser,
        credential: meteredCred
      },
      {
        urls: "turns:global.relay.metered.ca:443?transport=tcp",
        username: meteredUser,
        credential: meteredCred
      }
    );
  }

  res.json({
    iceServers,
    iceCandidatePoolSize: 2,
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require'
  });
});

// Lightweight Keep-Alive ping endpoint (for cron-job.org / Render host keep-awake)
app.get('/ping', (req, res) => {
  res.status(200).json({ status: 'alive', time: Date.now() });
});

// Health & Metrics Route
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'TalkHop WebRTC Engine',
    host: 'vybrant.vybronx.online',
    online: getUniqueOnlineCount(),
    waitingQueueLength: waitingQueue.length,
    activeMatches: activePairs.size / 2,
    bannedIPsCount: bannedIPs.size,
    vipPassesCount: vipPasses.size,
    timestamp: new Date().toISOString()
  });
});

// ==========================================
// SECRET ADMIN DASHBOARD API ROUTES (Milestone 4)
// ==========================================

// Serve Admin Dashboard Page
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// 1. Admin Login Route
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body || {};
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + ADMIN_SESSION_DURATION_MS;
    adminSessions.set(token, { user: username, createdAt: Date.now(), expiresAt });
    logAdminActivity('Admin Login', 'auth', `Admin '${username}' authenticated successfully`, username);
    console.log(`[ADMIN AUTH] Admin '${username}' authenticated successfully.`);
    return res.json({
      success: true,
      token,
      expiresAt,
      user: ADMIN_USER,
      message: 'Admin authentication successful.'
    });
  }
  console.warn(`[ADMIN AUTH] Unauthorized login attempt with username: '${username}'`);
  return res.status(401).json({
    success: false,
    error: 'Invalid admin username or password.'
  });
});

// 2. Admin Logout Route
app.post('/api/admin/logout', adminAuthMiddleware, (req, res) => {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim() || req.headers['x-admin-token'];
  if (token) {
    adminSessions.delete(token);
    logAdminActivity('Admin Logout', 'auth', 'Admin session terminated safely', req.adminUser || 'admin');
  }
  return res.json({ success: true, message: 'Admin logged out successfully.' });
});

// 3. Admin Live Stats Route
app.get('/api/admin/stats', adminAuthMiddleware, (req, res) => {
  const now = Date.now();
  const totalOnline = getUniqueOnlineCount();
  const inCall = Math.floor(activePairs.size / 2);
  const inQueue = waitingQueue.length;

  // Aggregate country statistics
  const countryStats = {};
  const genderStats = { male: 0, female: 0, any: 0 };
  let vipUsersCount = 0;

  for (const user of userStates.values()) {
    const c = (user.preferences && user.preferences.myCountry) || user.country || 'IN';
    countryStats[c] = (countryStats[c] || 0) + 1;

    const g = (user.preferences && user.preferences.myGender) || 'male';
    if (genderStats[g] !== undefined) genderStats[g]++;
    else genderStats.male++;

    if (user.isVip) vipUsersCount++;
  }

  // Active VIP Codes list
  const activeVipCodes = [];
  for (const [code, pass] of vipPasses.entries()) {
    const isExpired = pass.expiresAt ? now >= pass.expiresAt : false;
    activeVipCodes.push({
      code: pass.code,
      plan: pass.plan || 'custom',
      durationMinutes: Math.round(pass.durationMs / 60000),
      durationMs: pass.durationMs,
      price: pass.price || 0,
      createdAt: pass.createdAt,
      isActivated: pass.isActivated,
      activatedAt: pass.activatedAt,
      expiresAt: pass.expiresAt,
      activeSocketId: pass.activeSocketId,
      maxUses: pass.maxUses || 1,
      usesCount: pass.usesCount || (pass.isActivated ? 1 : 0),
      note: pass.note || 'VIP Pass',
      isExpired
    });
  }
  activeVipCodes.sort((a, b) => b.createdAt - a.createdAt);

  // Active Banned IPs list
  const bannedList = [];
  for (const [ip, info] of bannedIPs.entries()) {
    if (now < info.bannedUntil) {
      bannedList.push({
        ip,
        reason: info.reason,
        bannedUntil: info.bannedUntil,
        remainingMinutes: Math.max(0, Math.ceil((info.bannedUntil - now) / 60000)),
        remainingHours: Math.max(0, Math.ceil((info.bannedUntil - now) / (1000 * 60 * 60)))
      });
    } else {
      bannedIPs.delete(ip);
    }
  }

  // Reported IPs summary
  const reportedList = [];
  for (const [ip, reports] of reportedIPs.entries()) {
    const validReports = reports.filter(t => now - t < 24 * 60 * 60 * 1000);
    if (validReports.length > 0) {
      reportedList.push({
        ip,
        reportCount: validReports.length,
        lastReportTime: Math.max(...validReports)
      });
    }
  }

  // Detailed Sessions Lists for admin navigation views
  const detailedUsers = [];
  for (const [sid, user] of userStates.entries()) {
    detailedUsers.push({
      socketId: sid,
      maskedId: sid.slice(0, 8) + '...',
      ip: user.ip || '127.0.0.1',
      country: (user.preferences && user.preferences.myCountry) || user.country || 'Global',
      gender: (user.preferences && user.preferences.myGender) || 'male',
      mode: user.mode || 'chat',
      state: activePairs.has(sid) ? 'In Call' : (waitingQueue.some(q => q.socketId === sid) ? 'In Queue' : 'Idle'),
      isVip: !!user.isVip,
      connectedAt: user.connectedAt || now
    });
  }

  const detailedCalls = [];
  const seenPairs = new Set();
  for (const [s1, s2] of activePairs.entries()) {
    const pairKey = [s1, s2].sort().join(':');
    if (!seenPairs.has(pairKey)) {
      seenPairs.add(pairKey);
      const u1 = userStates.get(s1) || {};
      const u2 = userStates.get(s2) || {};
      detailedCalls.push({
        pairId: pairKey,
        user1: { socketId: s1.slice(0, 8) + '...', country: u1.country || 'Global', mode: u1.mode || 'chat' },
        user2: { socketId: s2.slice(0, 8) + '...', country: u2.country || 'Global', mode: u2.mode || 'chat' },
        mode: u1.mode || u2.mode || 'chat',
        startedAt: now - 45000
      });
    }
  }

  const detailedQueue = waitingQueue.map((item, idx) => ({
    position: idx + 1,
    socketId: item.socketId ? item.socketId.slice(0, 8) + '...' : 'unknown',
    country: (item.preferences && item.preferences.myCountry) || 'Global',
    targetGender: (item.preferences && item.preferences.genderFilter) || 'any',
    targetCountry: (item.preferences && item.preferences.countryFilter) || 'any',
    mode: item.mode || 'chat',
    queuedAt: item.queuedAt || now
  }));

  // Update current snapshot into traffic history
  if (trafficHistory.length > 0) {
    const lastSnap = trafficHistory[trafficHistory.length - 1];
    lastSnap.onlineUsers = totalOnline;
    lastSnap.activeCalls = inCall;
    lastSnap.inQueue = inQueue;
  }

  return res.json({
    success: true,
    stats: {
      totalOnline,
      inCall,
      inQueue,
      vipUsersCount,
      totalVipCodes: vipPasses.size,
      totalBannedCount: bannedList.length,
      countryStats,
      genderStats,
      activeVipCodes,
      bannedIPs: bannedList,
      reportedIPs: reportedList,
      sponsorConfig: liveSponsorConfig,
      uptimeSeconds: Math.floor(process.uptime()),
      serverTime: new Date().toISOString(),
      auditLog: adminAuditLog.slice(0, 30),
      trafficHistory: trafficHistory.slice(-12),
      detailedUsers: detailedUsers.slice(0, 50),
      detailedCalls: detailedCalls.slice(0, 20),
      detailedQueue: detailedQueue.slice(0, 20),
      diagnostics: {
        nodeVersion: process.version,
        platform: process.platform,
        memoryUsageMb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
        heapUsedMb: Math.round(process.memoryUsage().heapUsed / (1024 * 1024)),
        activeSockets: io.sockets.sockets.size,
        systemHealth: 'operational'
      }
    }
  });
});

// 4. Generate Custom VIP Code Route
app.post('/api/admin/generate-code', adminAuthMiddleware, (req, res) => {
  let { customCode, durationMinutes, maxUses, note } = req.body || {};
  let code = '';

  if (customCode && String(customCode).trim()) {
    code = String(customCode).trim().toUpperCase();
  } else {
    code = generateVipCode();
  }

  if (vipPasses.has(code)) {
    return res.status(400).json({ success: false, error: `VIP code '${code}' already exists.` });
  }

  const durationMin = Math.max(1, parseInt(durationMinutes, 10) || 60);
  const durationMs = durationMin * 60 * 1000;
  const uses = Math.max(1, parseInt(maxUses, 10) || 1);

  let plan = `${durationMin}-min`;
  if (durationMin >= 60 && durationMin % 60 === 0) {
    plan = `${durationMin / 60}-hour`;
  }

  const newPass = {
    code,
    plan,
    durationMs,
    price: 0,
    createdAt: Date.now(),
    isActivated: false,
    activatedAt: null,
    expiresAt: null,
    activeSocketId: null,
    maxUses: uses,
    usesCount: 0,
    note: note ? String(note).slice(0, 100) : 'Admin Custom Pass'
  };

  vipPasses.set(code, newPass);
  logAdminActivity('VIP Generated', 'vip', `Code ${code} issued (${durationMin}m, ${uses} max uses)`, req.adminUser || 'admin');
  console.log(`[ADMIN VIP] Created VIP code ${code} (${durationMin}m, ${uses} max uses, note: ${newPass.note})`);

  return res.json({
    success: true,
    pass: newPass,
    message: `VIP code ${code} generated successfully!`
  });
});

// 5. Revoke VIP Code Route
app.post('/api/admin/revoke-code', adminAuthMiddleware, (req, res) => {
  const { code } = req.body || {};
  if (!code) return res.status(400).json({ success: false, error: 'Code is required.' });

  const upperCode = String(code).toUpperCase().trim();
  const pass = vipPasses.get(upperCode);

  if (!pass) {
    return res.status(404).json({ success: false, error: `VIP Code '${upperCode}' not found.` });
  }

  // If a connected socket is actively using this code, notify and remove VIP status
  if (pass.activeSocketId) {
    const targetSocket = io.sockets.sockets.get(pass.activeSocketId);
    if (targetSocket && targetSocket.connected) {
      targetSocket.emit('vip-expired-notice', {
        message: 'Your VIP pass has been revoked by the administrator.'
      });
      const userState = userStates.get(pass.activeSocketId);
      if (userState) {
        userState.isVip = false;
        userState.vipCode = null;
        userState.preferences.genderFilter = 'any';
        userState.preferences.countryFilter = 'any';
      }
    }
    pass.activeSocketId = null;
  }

  vipPasses.delete(upperCode);
  logAdminActivity('VIP Revoked', 'vip', `Code ${upperCode} revoked and deleted`, req.adminUser || 'admin');
  console.log(`[ADMIN VIP] Revoked pass: ${upperCode}`);

  return res.json({
    success: true,
    message: `VIP code ${upperCode} has been revoked and removed.`
  });
});

// 6. Unban IP Address Route
app.post('/api/admin/unban-ip', adminAuthMiddleware, (req, res) => {
  const { ip } = req.body || {};
  if (!ip) return res.status(400).json({ success: false, error: 'IP address is required.' });

  const cleanIp = String(ip).trim();
  if (!bannedIPs.has(cleanIp)) {
    return res.status(404).json({ success: false, error: `IP ${cleanIp} is not currently banned.` });
  }

  bannedIPs.delete(cleanIp);
  reportedIPs.delete(cleanIp);
  logAdminActivity('IP Unbanned', 'moderation', `IP ${cleanIp} unbanned by administrator`, req.adminUser || 'admin');
  console.log(`[ADMIN MODERATION] Unbanned IP: ${cleanIp}`);

  return res.json({
    success: true,
    message: `IP ${cleanIp} has been unbanned successfully.`
  });
});

// 7. Manual Ban IP Route
app.post('/api/admin/ban-ip', adminAuthMiddleware, (req, res) => {
  const { ip, reason, hours } = req.body || {};
  if (!ip) return res.status(400).json({ success: false, error: 'IP address is required.' });

  const cleanIp = String(ip).trim();
  const banHours = Math.max(1, parseInt(hours, 10) || 24);
  const banDuration = banHours * 60 * 60 * 1000;
  const banReason = reason ? String(reason).slice(0, 200) : 'Manual administrator ban';

  banIp(cleanIp, banReason, banDuration);

  // Terminate any connected sockets from this IP immediately
  for (const socket of io.sockets.sockets.values()) {
    if (getClientIp(socket) === cleanIp) {
      socket.emit('banned', { reason: banReason });
      socket.disconnect(true);
    }
  }

  logAdminActivity('IP Banned', 'moderation', `IP ${cleanIp} banned for ${banHours}h: ${banReason}`, req.adminUser || 'admin');
  console.log(`[ADMIN MODERATION] Manually banned IP ${cleanIp} for ${banHours}h: ${banReason}`);

  return res.json({
    success: true,
    message: `IP ${cleanIp} has been banned for ${banHours} hours.`
  });
});

// 8. Update Live Sponsor Message Route (Broadcasts to all clients)
app.post('/api/admin/update-sponsor', adminAuthMiddleware, (req, res) => {
  const { tag, subTag, message, highlight, urlText, url } = req.body || {};

  if (!message && !url) {
    return res.status(400).json({ success: false, error: 'Message or URL is required.' });
  }

  if (tag !== undefined) liveSponsorConfig.tag = String(tag).slice(0, 50);
  if (subTag !== undefined) liveSponsorConfig.subTag = String(subTag).slice(0, 50);
  if (message !== undefined) liveSponsorConfig.message = String(message).slice(0, 300);
  if (highlight !== undefined) liveSponsorConfig.highlight = String(highlight).slice(0, 100);
  if (urlText !== undefined) liveSponsorConfig.urlText = String(urlText).slice(0, 80);
  if (url !== undefined) liveSponsorConfig.url = String(url).slice(0, 250);

  // Broadcast to all active connected chat clients
  io.emit('sponsor-update', liveSponsorConfig);
  logAdminActivity('Sponsor Updated', 'sponsor', `Sponsor card updated: "${liveSponsorConfig.tag}"`, req.adminUser || 'admin');
  console.log(`[ADMIN SPONSOR] Updated and broadcasted sponsor config:`, liveSponsorConfig);

  return res.json({
    success: true,
    sponsor: liveSponsorConfig,
    message: 'Live sponsor configuration broadcasted to all connected clients!'
  });
});

// 9. Dismiss Peer Report Route
app.post('/api/admin/dismiss-report', adminAuthMiddleware, (req, res) => {
  const { ip } = req.body || {};
  if (!ip) return res.status(400).json({ success: false, error: 'IP is required.' });
  const cleanIp = String(ip).trim();
  reportedIPs.delete(cleanIp);
  logAdminActivity('Report Dismissed', 'moderation', `Community reports cleared for IP ${cleanIp}`, req.adminUser || 'admin');
  return res.json({ success: true, message: `Reports for IP ${cleanIp} cleared successfully.` });
});

// 10. Kick Connected User Route
app.post('/api/admin/kick-user', adminAuthMiddleware, (req, res) => {
  const { socketId } = req.body || {};
  if (!socketId) return res.status(400).json({ success: false, error: 'Socket ID is required.' });
  const targetSocket = io.sockets.sockets.get(socketId);
  if (targetSocket) {
    targetSocket.emit('error-notice', { message: 'You have been disconnected by an administrator.' });
    targetSocket.disconnect(true);
    logAdminActivity('User Kicked', 'moderation', `Socket ${socketId.slice(0, 8)} disconnected by admin`, req.adminUser || 'admin');
    return res.json({ success: true, message: 'User socket disconnected.' });
  }
  return res.status(404).json({ success: false, error: 'User socket not found or already disconnected.' });
});

// Fallback for SPA routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Server Initialization
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`===============================================`);
  console.log(`⚡ TalkHop ⚡ Instant Random Chat & Video Call Engine (by VybronX Studios)`);
  console.log(`⚡ AI Safety Shield & IP Auto-Ban Active`);
  console.log(`⚡ Hosted at: https://vybrant.vybronx.online`);
  console.log(`⚡ Local Server running at: http://localhost:${PORT}`);
  console.log(`===============================================`);
});
