const assert = require('assert');

// Simulate mode matchmaking engine
class MockModeMatchEngine {
  constructor() {
    this.waitingQueue = [];
    this.activePairs = new Map();
    this.activeSessions = new Map();
    this.socketSessions = new Map();
  }

  isFilterMatch(userA, userB) {
    return true; // Simplified for mode test
  }

  pairSockets(socketA, socketB, mode = 'video') {
    const idA = socketA.id;
    const idB = socketB.id;
    const sessionId = 'sess_' + Math.random().toString(36).substring(2, 9);
    const sessionMode = (mode === 'text') ? 'text' : 'video';

    this.activePairs.set(idA, idB);
    this.activePairs.set(idB, idA);

    const sessionObj = {
      sessionId,
      userA: idA,
      userB: idB,
      initiator: idA,
      mode: sessionMode,
      state: 'active'
    };

    this.activeSessions.set(sessionId, sessionObj);
    this.socketSessions.set(idA, sessionId);
    this.socketSessions.set(idB, sessionId);

    socketA.matched = { sessionId, partnerId: idB, initiator: true, mode: sessionMode };
    socketB.matched = { sessionId, partnerId: idA, initiator: false, mode: sessionMode };
    return sessionObj;
  }

  matchUser(socket, mode = 'video') {
    const socketId = socket.id;
    const desiredMode = (mode === 'text') ? 'text' : 'video';

    // Remove from queue
    const qIdx = this.waitingQueue.findIndex(q => q.socketId === socketId);
    if (qIdx !== -1) this.waitingQueue.splice(qIdx, 1);

    const userEntry = {
      socketId,
      mode: desiredMode
    };

    // Find match with IDENTICAL mode
    let matchIndex = -1;
    for (let i = 0; i < this.waitingQueue.length; i++) {
      const candidate = this.waitingQueue[i];
      if (candidate.socketId !== socketId && candidate.mode === desiredMode) {
        matchIndex = i;
        break;
      }
    }

    if (matchIndex !== -1) {
      const candidate = this.waitingQueue.splice(matchIndex, 1)[0];
      const partnerSocket = candidate.socket;
      return this.pairSockets(socket, partnerSocket, desiredMode);
    }

    userEntry.socket = socket;
    this.waitingQueue.push(userEntry);
    return null;
  }

  requestVideoSwitch(fromSocketId) {
    const partnerId = this.activePairs.get(fromSocketId);
    const sessionId = this.socketSessions.get(fromSocketId);
    if (!partnerId) return { success: false };
    return { success: true, toPartner: partnerId, sessionId };
  }

  acceptVideoSwitch(acceptingSocketId) {
    const partnerId = this.activePairs.get(acceptingSocketId);
    const sessionId = this.socketSessions.get(acceptingSocketId);
    if (!partnerId || !sessionId) return { success: false };

    const session = this.activeSessions.get(sessionId);
    session.mode = 'video';
    return {
      success: true,
      sessionId,
      initiatorId: partnerId,
      receiverId: acceptingSocketId
    };
  }

  declineVideoSwitch(decliningSocketId) {
    const partnerId = this.activePairs.get(decliningSocketId);
    return { success: true, toPartner: partnerId };
  }

  switchToText(socketId) {
    const partnerId = this.activePairs.get(socketId);
    const sessionId = this.socketSessions.get(socketId);
    if (sessionId) {
      const session = this.activeSessions.get(sessionId);
      session.mode = 'text';
    }
    return { success: true, sessionId, partnerId };
  }
}

function runTests() {
  console.log('Running Mode Matchmaking & Transition tests...');
  const engine = new MockModeMatchEngine();

  const userText1 = { id: 'user_text_1' };
  const userText2 = { id: 'user_text_2' };
  const userVideo1 = { id: 'user_video_1' };
  const userVideo2 = { id: 'user_video_2' };

  // Test 1: userText1 starts searching in text mode -> queue length 1
  let match = engine.matchUser(userText1, 'text');
  assert.strictEqual(match, null, 'First text user must wait in queue');
  assert.strictEqual(engine.waitingQueue.length, 1);

  // Test 2: userVideo1 starts searching in video mode -> must NOT match with userText1!
  match = engine.matchUser(userVideo1, 'video');
  assert.strictEqual(match, null, 'Video user must not match with text user');
  assert.strictEqual(engine.waitingQueue.length, 2, 'Both users must wait in their respective modes');

  // Test 3: userText2 searches in text mode -> must pair ONLY with userText1!
  match = engine.matchUser(userText2, 'text');
  assert.ok(match, 'Second text user must match with first text user');
  assert.strictEqual(match.mode, 'text');
  assert.strictEqual(userText2.matched.partnerId, 'user_text_1');
  assert.strictEqual(userText1.matched.partnerId, 'user_text_2');
  assert.strictEqual(engine.waitingQueue.length, 1, 'Only userVideo1 should remain in queue');
  assert.strictEqual(engine.waitingQueue[0].socketId, 'user_video_1');

  // Test 4: userVideo2 searches in video mode -> must pair with userVideo1!
  match = engine.matchUser(userVideo2, 'video');
  assert.ok(match, 'Second video user must match with first video user');
  assert.strictEqual(match.mode, 'video');
  assert.strictEqual(userVideo2.matched.partnerId, 'user_video_1');
  assert.strictEqual(engine.waitingQueue.length, 0, 'Queue should now be empty');

  // Test 5: In active text session, userText1 requests switch to video
  const switchReq = engine.requestVideoSwitch('user_text_1');
  assert.strictEqual(switchReq.success, true);
  assert.strictEqual(switchReq.toPartner, 'user_text_2');

  // Test 6: userText2 accepts video switch -> session mode becomes 'video'
  const switchAccept = engine.acceptVideoSwitch('user_text_2');
  assert.strictEqual(switchAccept.success, true);
  assert.strictEqual(engine.activeSessions.get(switchAccept.sessionId).mode, 'video');
  assert.strictEqual(switchAccept.initiatorId, 'user_text_1');

  // Test 7: Either user switches back to text -> session mode becomes 'text'
  const textSwitch = engine.switchToText('user_text_1');
  assert.strictEqual(textSwitch.success, true);
  assert.strictEqual(engine.activeSessions.get(textSwitch.sessionId).mode, 'text');

  // Test 8: Decline video switch keeps session in text mode
  engine.requestVideoSwitch('user_text_1');
  const declineRes = engine.declineVideoSwitch('user_text_2');
  assert.strictEqual(declineRes.success, true);
  assert.strictEqual(declineRes.toPartner, 'user_text_1');
  assert.strictEqual(engine.activeSessions.get(textSwitch.sessionId).mode, 'text');

  console.log('✓ All Mode Matchmaking & Transition tests passed successfully!');
}

runTests();
