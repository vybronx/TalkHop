const assert = require('assert');

// Connection State Machine Definition (mirrors client implementation)
const ConnectionState = {
  IDLE: 'idle',
  SEARCHING: 'searching',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  TEMPORARILY_INTERRUPTED: 'temporarily_interrupted',
  RECOVERING: 'recovering',
  AUDIO_ONLY_DEGRADED: 'audio_only_degraded',
  DISCONNECTED: 'disconnected'
};

class ConnectionStateMachine {
  constructor() {
    this.state = ConnectionState.IDLE;
    this.history = [ConnectionState.IDLE];
    this.iceRestartCount = 0;
    this.maxIceRestarts = 2;
  }

  transition(nextState, meta = {}) {
    const validTransitions = {
      [ConnectionState.IDLE]: [ConnectionState.SEARCHING, ConnectionState.CONNECTING],
      [ConnectionState.SEARCHING]: [ConnectionState.IDLE, ConnectionState.CONNECTING],
      [ConnectionState.CONNECTING]: [ConnectionState.CONNECTED, ConnectionState.TEMPORARILY_INTERRUPTED, ConnectionState.DISCONNECTED],
      [ConnectionState.CONNECTED]: [ConnectionState.TEMPORARILY_INTERRUPTED, ConnectionState.AUDIO_ONLY_DEGRADED, ConnectionState.DISCONNECTED, ConnectionState.SEARCHING, ConnectionState.IDLE],
      [ConnectionState.TEMPORARILY_INTERRUPTED]: [ConnectionState.CONNECTED, ConnectionState.RECOVERING, ConnectionState.DISCONNECTED, ConnectionState.SEARCHING],
      [ConnectionState.RECOVERING]: [ConnectionState.CONNECTED, ConnectionState.DISCONNECTED, ConnectionState.SEARCHING],
      [ConnectionState.AUDIO_ONLY_DEGRADED]: [ConnectionState.CONNECTED, ConnectionState.TEMPORARILY_INTERRUPTED, ConnectionState.DISCONNECTED, ConnectionState.SEARCHING],
      [ConnectionState.DISCONNECTED]: [ConnectionState.IDLE, ConnectionState.SEARCHING, ConnectionState.CONNECTING]
    };

    const allowed = validTransitions[this.state] || [];
    if (!allowed.includes(nextState)) {
      throw new Error(`Illegal state transition from ${this.state} to ${nextState}`);
    }

    this.state = nextState;
    this.history.push(nextState);
    return this.state;
  }

  canAttemptIceRestart() {
    return this.iceRestartCount < this.maxIceRestarts;
  }

  recordIceRestart() {
    if (!this.canAttemptIceRestart()) {
      return false;
    }
    this.iceRestartCount++;
    return true;
  }

  resetIceRestarts() {
    this.iceRestartCount = 0;
  }
}

function runTests() {
  console.log('Running Connection State Machine tests...');

  // Test 1: Happy path call flow
  const fsm = new ConnectionStateMachine();
  assert.strictEqual(fsm.state, ConnectionState.IDLE);

  fsm.transition(ConnectionState.SEARCHING);
  assert.strictEqual(fsm.state, ConnectionState.SEARCHING);

  fsm.transition(ConnectionState.CONNECTING);
  assert.strictEqual(fsm.state, ConnectionState.CONNECTING);

  fsm.transition(ConnectionState.CONNECTED);
  assert.strictEqual(fsm.state, ConnectionState.CONNECTED);

  // Test 2: Transient network fluctuation and recovery
  fsm.transition(ConnectionState.TEMPORARILY_INTERRUPTED);
  assert.strictEqual(fsm.state, ConnectionState.TEMPORARILY_INTERRUPTED);

  fsm.transition(ConnectionState.RECOVERING);
  assert.strictEqual(fsm.state, ConnectionState.RECOVERING);

  fsm.transition(ConnectionState.CONNECTED);
  assert.strictEqual(fsm.state, ConnectionState.CONNECTED);

  // Test 3: Adaptive low-bandwidth degraded audio-only mode and recovery
  fsm.transition(ConnectionState.AUDIO_ONLY_DEGRADED);
  assert.strictEqual(fsm.state, ConnectionState.AUDIO_ONLY_DEGRADED);

  fsm.transition(ConnectionState.CONNECTED);
  assert.strictEqual(fsm.state, ConnectionState.CONNECTED);

  // Test 4: ICE restart loop prevention (max 2 attempts)
  fsm.resetIceRestarts();
  assert.strictEqual(fsm.canAttemptIceRestart(), true);
  assert.strictEqual(fsm.recordIceRestart(), true); // attempt 1
  assert.strictEqual(fsm.recordIceRestart(), true); // attempt 2
  assert.strictEqual(fsm.canAttemptIceRestart(), false);
  assert.strictEqual(fsm.recordIceRestart(), false); // attempt 3 blocked!

  // Test 5: Illegal transition check
  fsm.transition(ConnectionState.DISCONNECTED);
  assert.throws(() => {
    fsm.transition(ConnectionState.AUDIO_ONLY_DEGRADED); // Cannot jump from DISCONNECTED to AUDIO_ONLY_DEGRADED directly
  }, /Illegal state transition/);

  console.log('✓ All Connection State Machine tests passed successfully!');
}

runTests();
