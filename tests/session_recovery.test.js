const assert = require('assert');
const EventEmitter = require('events');

// We simulate the exact server session recovery logic implemented in server.js
class MockServerSessionEngine {
  constructor() {
    this.activePairs = new Map();
    this.activeSessions = new Map();
    this.socketSessions = new Map();
    this.userStates = new Map();
    this.RECOVERY_GRACE_PERIOD_MS = 15000;
  }

  pairSockets(socketA, socketB) {
    const idA = socketA.id;
    const idB = socketB.id;
    const sessionId = 'sess_' + Math.random().toString(36).substring(2, 10);

    this.activePairs.set(idA, idB);
    this.activePairs.set(idB, idA);

    const sessionObj = {
      sessionId,
      userA: idA,
      userB: idB,
      initiator: idA,
      createdAt: Date.now(),
      state: 'active',
      timer: null,
      interruptedUser: null
    };
    this.activeSessions.set(sessionId, sessionObj);
    this.socketSessions.set(idA, sessionId);
    this.socketSessions.set(idB, sessionId);

    this.userStates.set(idA, { state: 'in_call' });
    this.userStates.set(idB, { state: 'in_call' });

    socketA.emit('match-found', { sessionId, initiator: true, partnerId: idB });
    socketB.emit('match-found', { sessionId, initiator: false, partnerId: idA });
    return sessionObj;
  }

  handleDisconnect(socket, reason, allSocketsMap) {
    const socketId = socket.id;
    const sessionId = this.socketSessions.get(socketId);
    const partnerId = this.activePairs.get(socketId);
    const userState = this.userStates.get(socketId);
    const wasInCall = userState && userState.state === 'in_call' && partnerId;

    if (wasInCall && sessionId && this.activeSessions.has(sessionId)) {
      const session = this.activeSessions.get(sessionId);
      const partnerSocket = allSocketsMap.get(partnerId);

      if (partnerSocket && partnerSocket.connected) {
        session.state = 'interrupted';
        session.interruptedUser = socketId;
        session.interruptedAt = Date.now();

        partnerSocket.emit('partner-interrupted', {
          sessionId,
          reason: 'network_interruption',
          gracePeriodMs: this.RECOVERY_GRACE_PERIOD_MS,
          message: 'Stranger network connection interrupted. Attempting recovery...'
        });

        if (session.timer) clearTimeout(session.timer);
        session.timer = setTimeout(() => {
          this.clearSession(sessionId);
          this.disconnectCurrentPair(socketId, 'disconnected_timeout', allSocketsMap);
        }, this.RECOVERY_GRACE_PERIOD_MS);

        return { interrupted: true, session };
      }
    }

    if (sessionId) this.clearSession(sessionId);
    this.disconnectCurrentPair(socketId, 'disconnected', allSocketsMap);
    this.userStates.delete(socketId);
    return { interrupted: false };
  }

  reconnectSession(newSocket, data, allSocketsMap) {
    const { sessionId } = data || {};
    if (!sessionId || !this.activeSessions.has(sessionId)) {
      return { success: false, message: 'Session expired or not found.' };
    }

    const session = this.activeSessions.get(sessionId);
    const partnerId = (session.userA === session.interruptedUser) ? session.userB : session.userA;
    const partnerSocket = allSocketsMap.get(partnerId);

    if (!partnerSocket || !partnerSocket.connected) {
      if (session.timer) clearTimeout(session.timer);
      this.clearSession(sessionId);
      return { success: false, message: 'Partner is no longer connected.' };
    }

    if (session.timer) {
      clearTimeout(session.timer);
      session.timer = null;
    }

    const oldId = session.interruptedUser || newSocket.id;
    if (session.userA === oldId) session.userA = newSocket.id;
    if (session.userB === oldId) session.userB = newSocket.id;
    session.state = 'active';
    session.interruptedUser = null;

    this.socketSessions.delete(oldId);
    this.socketSessions.set(newSocket.id, sessionId);

    this.activePairs.delete(oldId);
    this.activePairs.set(newSocket.id, partnerId);
    this.activePairs.set(partnerId, newSocket.id);

    this.userStates.set(newSocket.id, { state: 'in_call' });

    const isInitiator = (session.initiator === oldId || session.initiator === newSocket.id);

    newSocket.emit('session-recovered', { sessionId, partnerId, isInitiator });
    partnerSocket.emit('session-recovered', { sessionId, partnerId: newSocket.id });

    return { success: true, sessionId, partnerId };
  }

  clearSession(sessionId) {
    if (!sessionId) return;
    const session = this.activeSessions.get(sessionId);
    if (session) {
      if (session.timer) clearTimeout(session.timer);
      this.activeSessions.delete(sessionId);
      if (session.userA) this.socketSessions.delete(session.userA);
      if (session.userB) this.socketSessions.delete(session.userB);
    }
  }

  disconnectCurrentPair(socketId, reason, allSocketsMap) {
    const sessionId = this.socketSessions.get(socketId);
    if (sessionId) this.clearSession(sessionId);

    const partnerId = this.activePairs.get(socketId);
    this.activePairs.delete(socketId);
    if (this.userStates.has(socketId)) this.userStates.get(socketId).state = 'idle';

    if (partnerId) {
      this.activePairs.delete(partnerId);
      if (this.userStates.has(partnerId)) this.userStates.get(partnerId).state = 'idle';
      const partnerSocket = allSocketsMap.get(partnerId);
      if (partnerSocket && partnerSocket.connected) {
        partnerSocket.emit('partner-disconnected', { reason });
      }
      return partnerId;
    }
    return null;
  }
}

class MockSocket extends EventEmitter {
  constructor(id) {
    super();
    this.id = id;
    this.connected = true;
    this.receivedEvents = [];
  }

  emit(event, data) {
    this.receivedEvents.push({ event, data });
    return super.emit(event, data);
  }
}

function runTests() {
  console.log('Running Session Recovery & Resilience tests...');

  const engine = new MockServerSessionEngine();
  const sockets = new Map();

  const socketA = new MockSocket('sock_A');
  const socketB = new MockSocket('sock_B');
  sockets.set(socketA.id, socketA);
  sockets.set(socketB.id, socketB);

  // 1. Pair Sockets A and B
  const session = engine.pairSockets(socketA, socketB);
  assert.ok(session.sessionId.startsWith('sess_'));
  assert.strictEqual(engine.activePairs.get('sock_A'), 'sock_B');
  assert.strictEqual(engine.activePairs.get('sock_B'), 'sock_A');

  // 2. Simulate accidental network disconnect on Socket A
  socketA.connected = false;
  const discResult = engine.handleDisconnect(socketA, 'transport close', sockets);
  assert.strictEqual(discResult.interrupted, true, 'Active in-call disconnect must be marked interrupted, not destroyed');
  assert.strictEqual(session.state, 'interrupted');

  // Verify partner B received partner-interrupted with grace period
  const partnerInterruptedEvent = socketB.receivedEvents.find(e => e.event === 'partner-interrupted');
  assert.ok(partnerInterruptedEvent, 'Partner must receive partner-interrupted event');
  assert.strictEqual(partnerInterruptedEvent.data.gracePeriodMs, 15000);
  assert.strictEqual(partnerInterruptedEvent.data.sessionId, session.sessionId);

  // Verify the pair is NOT destroyed yet!
  assert.strictEqual(engine.activePairs.get('sock_B'), 'sock_A');

  // 3. Simulate Socket A reconnecting with a fresh socket connection
  const socketA_new = new MockSocket('sock_A_prime');
  sockets.set(socketA_new.id, socketA_new);

  const recResult = engine.reconnectSession(socketA_new, { sessionId: session.sessionId }, sockets);
  assert.strictEqual(recResult.success, true, 'Session must recover successfully');
  assert.strictEqual(session.state, 'active');
  assert.strictEqual(session.timer, null, 'Timer must be cleared on successful recovery');

  // Verify new pairing
  assert.strictEqual(engine.activePairs.get('sock_A_prime'), 'sock_B');
  assert.strictEqual(engine.activePairs.get('sock_B'), 'sock_A_prime');

  // Verify session-recovered events sent to both sides
  const recA = socketA_new.receivedEvents.find(e => e.event === 'session-recovered');
  const recB = socketB.receivedEvents.find(e => e.event === 'session-recovered');
  assert.ok(recA, 'Reconnected user must receive session-recovered');
  assert.ok(recB, 'Partner must receive session-recovered');

  // 4. Intentional skip from reconnected user immediately terminates call without grace period
  engine.disconnectCurrentPair('sock_A_prime', 'skipped', sockets);
  assert.strictEqual(engine.activePairs.has('sock_A_prime'), false);
  assert.strictEqual(engine.activePairs.has('sock_B'), false);

  const skipEvent = socketB.receivedEvents.find(e => e.event === 'partner-disconnected' && e.data.reason === 'skipped');
  assert.ok(skipEvent, 'Partner must receive partner-disconnected immediately on skip');

  console.log('✓ All Session Recovery tests passed successfully!');
}

runTests();
