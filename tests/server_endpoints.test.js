const http = require('http');
const assert = require('assert');

// Test that server.js exports or responds to HTTP endpoints
async function runTests() {
  console.log('Testing server endpoints and configuration...');

  // Start a test instance of server.js on an ephemeral port
  process.env.PORT = 3099;
  process.env.ADMIN_USER = 'testadmin';
  process.env.ADMIN_PASS = 'testpass';

  const app = require('../server.js');

  // Allow server a moment to bind
  await new Promise(resolve => setTimeout(resolve, 800));

  function get(path) {
    return new Promise((resolve, reject) => {
      http.get(`http://localhost:3099${path}`, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(data) });
          } catch (e) {
            resolve({ status: res.statusCode, raw: data });
          }
        });
      }).on('error', reject);
    });
  }

  // 1. Test /ping endpoint
  const pingRes = await get('/ping');
  assert.strictEqual(pingRes.status, 200);
  assert.strictEqual(pingRes.data.status, 'alive');
  console.log('✓ /ping endpoint returns 200 OK alive');

  // 2. Test /health endpoint
  const healthRes = await get('/health');
  assert.strictEqual(healthRes.status, 200);
  assert.strictEqual(healthRes.data.status, 'ok');
  assert.strictEqual(healthRes.data.service, 'Vybrant WebRTC Engine');
  console.log('✓ /health endpoint returns 200 OK');

  // 3. Test /api/rtc-config endpoint
  const rtcRes = await get('/api/rtc-config');
  assert.strictEqual(rtcRes.status, 200);
  assert.ok(Array.isArray(rtcRes.data.iceServers), 'Must return iceServers array');
  assert.ok(rtcRes.data.iceServers.length >= 2, 'Must provide STUN and TURN fallback');
  assert.strictEqual(rtcRes.data.iceCandidatePoolSize, 2, 'iceCandidatePoolSize must be 2 to prevent initial gathering storms');
  assert.strictEqual(rtcRes.data.bundlePolicy, 'max-bundle');
  assert.strictEqual(rtcRes.data.rtcpMuxPolicy, 'require');
  console.log('✓ /api/rtc-config returns valid dynamic WebRTC ICE configuration');

  console.log('✓ All server endpoint tests passed successfully!');
  process.exit(0);
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
