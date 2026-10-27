const assert = require('assert');

// Authoritative logical presence engine simulation matching server.js
class MockPresenceEngine {
  constructor() {
    this.activeVisitors = new Map();
    this.socketVisitors = new Map();
    this.userStates = new Map();
    this.activeSessions = new Map();
    this.socketSessions = new Map();
    this.activePairs = new Map();
    this.waitingQueue = [];
    this.broadcastHistory = [];
    this.RECOVERY_GRACE_PERIOD_MS = 15000;
  }

  getUniqueOnlineCount() {
    return this.activeVisitors.size;
  }

  broadcastOnlineCount() {
    const count = this.getUniqueOnlineCount();
    this.broadcastHistory.push(count);
  }

  handleConnect(socketId, rawVisitorId, clientIp = '127.0.0.1') {
    const visitorId = (typeof rawVisitorId === 'string' && rawVisitorId.length >= 4)
      ? rawVisitorId.trim()
      : socketId;

    const existingVisitor = this.activeVisitors.get(visitorId);
    if (existingVisitor) {
      const oldSocketId = existingVisitor.socketId;
      if (oldSocketId && oldSocketId !== socketId) {
        if (existingVisitor.graceTimer) {
          clearTimeout(existingVisitor.graceTimer);
          existingVisitor.graceTimer = null;
        }

        this.socketVisitors.delete(oldSocketId);

        const oldUserState = this.userStates.get(oldSocketId);
        if (oldUserState) {
          this.userStates.set(socketId, { ...oldUserState, state: oldUserState.state || 'idle' });
          this.userStates.delete(oldSocketId);
        }

        // Auto-rebind active session
        const activeSessionId = this.socketSessions.get(oldSocketId);
        if (activeSessionId && this.activeSessions.has(activeSessionId)) {
          const sess = this.activeSessions.get(activeSessionId);
          if (sess.timer) {
            clearTimeout(sess.timer);
            sess.timer = null;
          }
          if (sess.userA === oldSocketId) sess.userA = socketId;
          if (sess.userB === oldSocketId) sess.userB = socketId;
          sess.state = 'active';
          sess.interruptedUser = null;

          this.socketSessions.delete(oldSocketId);
          this.socketSessions.set(socketId, activeSessionId);

          const partnerId = this.activePairs.get(oldSocketId);
          if (partnerId) {
            this.activePairs.delete(oldSocketId);
            this.activePairs.set(socketId, partnerId);
            this.activePairs.set(partnerId, socketId);
          }
        }
      }
    }

    this.activeVisitors.set(visitorId, {
      visitorId,
      socketId,
      ip: clientIp,
      connectedAt: existingVisitor?.connectedAt || Date.now(),
      lastSeen: Date.now(),
      graceTimer: null
    });
    this.socketVisitors.set(socketId, visitorId);

    if (!this.userStates.has(socketId)) {
      this.userStates.set(socketId, {
        state: 'idle',
        joinedAt: Date.now(),
        ip: clientIp
      });
    }

    this.broadcastOnlineCount();
    return visitorId;
  }

  handleDisconnect(socketId) {
    const visitorId = this.socketVisitors.get(socketId);
    this.socketVisitors.delete(socketId);

    const sessionId = this.socketSessions.get(socketId);
    const partnerId = this.activePairs.get(socketId);
    const userState = this.userStates.get(socketId);
    const wasInCall = userState && userState.state === 'in_call' && partnerId;

    const isCurrentActiveSocket = visitorId && this.activeVisitors.get(visitorId)?.socketId === socketId;

    if (wasInCall && sessionId && this.activeSessions.has(sessionId)) {
      const session = this.activeSessions.get(sessionId);
      session.state = 'interrupted';
      session.interruptedUser = socketId;

      session.timer = setTimeout(() => {
        if (visitorId && this.activeVisitors.has(visitorId)) {
          const vRecord = this.activeVisitors.get(visitorId);
          if (vRecord.socketId === socketId) {
            this.activeVisitors.delete(visitorId);
            this.userStates.delete(socketId);
            this.broadcastOnlineCount();
          }
        }
      }, this.RECOVERY_GRACE_PERIOD_MS);

      // Keep activeVisitors intact during recovery grace period
      return { inGracePeriod: true };
    }

    this.userStates.delete(socketId);

    if (isCurrentActiveSocket) {
      this.activeVisitors.delete(visitorId);
      this.broadcastOnlineCount();
      return { removed: true };
    }

    return { removed: false, wasStale: true };
  }
}

function runTests() {
  console.log('Running Authoritative Presence & Online Count tests...');
  const engine = new MockPresenceEngine();

  // Test 1: Desktop and Mobile connect -> Count is exactly 2
  engine.handleConnect('sock_desktop_1', 'vis_desktop');
  engine.handleConnect('sock_mobile_1', 'vis_mobile');
  assert.strictEqual(engine.getUniqueOnlineCount(), 2, 'Two unique visitors must equal count of 2');

  // Test 2: Mobile socket reconnects with new socket ID while old socket was alive -> Count MUST REMAIN 2!
  engine.handleConnect('sock_mobile_2', 'vis_mobile');
  assert.strictEqual(engine.getUniqueOnlineCount(), 2, 'Reconnecting mobile must NOT inflate count to 3');

  // Test 3: Old mobile socket disconnect event arrives after new socket connected -> Count MUST REMAIN 2!
  const dcResult = engine.handleDisconnect('sock_mobile_1');
  assert.strictEqual(dcResult.wasStale, true, 'Old socket disconnect must be recognized as stale');
  assert.strictEqual(engine.getUniqueOnlineCount(), 2, 'Stale socket disconnect must NOT decrement count to 1');

  // Test 4: Genuine 3rd user connects -> Count becomes 3
  engine.handleConnect('sock_user3_1', 'vis_user3');
  assert.strictEqual(engine.getUniqueOnlineCount(), 3, 'Third visitor must increment count to 3');

  // Test 5: 3rd user disconnects (idle) -> Count returns to 2
  engine.handleDisconnect('sock_user3_1');
  assert.strictEqual(engine.getUniqueOnlineCount(), 2, 'Third visitor disconnect must return count to 2');

  // Test 6: In-call transient disconnect preserves presence during 15s grace period
  // Set up call between desktop and mobile
  const userDesktop = engine.userStates.get('sock_desktop_1');
  const userMobile = engine.userStates.get('sock_mobile_2');
  userDesktop.state = 'in_call';
  userMobile.state = 'in_call';
  engine.activePairs.set('sock_desktop_1', 'sock_mobile_2');
  engine.activePairs.set('sock_mobile_2', 'sock_desktop_1');
  const sessId = 'sess_test_1';
  engine.activeSessions.set(sessId, { sessionId: sessId, userA: 'sock_desktop_1', userB: 'sock_mobile_2', state: 'active' });
  engine.socketSessions.set('sock_desktop_1', sessId);
  engine.socketSessions.set('sock_mobile_2', sessId);

  // Mobile disconnects while in call
  const callDcResult = engine.handleDisconnect('sock_mobile_2');
  assert.strictEqual(callDcResult.inGracePeriod, true, 'In-call disconnect must enter grace period');
  assert.strictEqual(engine.getUniqueOnlineCount(), 2, 'Presence must remain 2 during recovery grace period');

  // Mobile recovers with sock_mobile_3
  engine.handleConnect('sock_mobile_3', 'vis_mobile');
  assert.strictEqual(engine.getUniqueOnlineCount(), 2, 'Presence must still be exactly 2 after recovery rebind');
  assert.strictEqual(engine.socketSessions.get('sock_mobile_3'), sessId, 'Session must be rebound to sock_mobile_3');

  console.log('✓ All Authoritative Presence & Online Count tests passed successfully!');
}

runTests();
