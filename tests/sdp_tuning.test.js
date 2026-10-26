const assert = require('assert');

function tuneOpusSdp(sdp) {
  if (!sdp || typeof sdp !== 'string') return sdp;

  return sdp.replace(/a=fmtp:(\d+)\s+(.*)/g, (match, pt, params) => {
    if (sdp.includes(`a=rtpmap:${pt} opus/48000`)) {
      let tuned = params
        .replace(/stereo=\d+/g, 'stereo=0')
        .replace(/sprop-stereo=\d+/g, 'sprop-stereo=0');

      const additions = [];
      if (!tuned.includes('stereo=')) additions.push('stereo=0;sprop-stereo=0');
      if (!tuned.includes('useinbandfec=')) additions.push('useinbandfec=1');
      if (!tuned.includes('usedtx=')) additions.push('usedtx=1');
      if (!tuned.includes('maxaveragebitrate=')) additions.push('maxaveragebitrate=32000');
      if (!tuned.includes('cng=')) additions.push('cng=0');

      return `a=fmtp:${pt} ${tuned}${additions.length ? ';' + additions.join(';') : ''}`;
    }
    return match;
  });
}

function runTests() {
  console.log('Running Opus SDP Tuning tests...');

  // Sample real WebRTC SDP section containing Opus and VP8
  const sampleSdp = [
    'v=0',
    'o=- 123456789 2 IN IP4 127.0.0.1',
    's=-',
    't=0 0',
    'm=audio 9 UDP/TLS/RTP/SAVPF 111 9',
    'a=rtpmap:111 opus/48000/2',
    'a=fmtp:111 minptime=10',
    'm=video 9 UDP/TLS/RTP/SAVPF 96',
    'a=rtpmap:96 VP8/90000',
    'a=fmtp:96 max-fs=12288;max-fr=60'
  ].join('\r\n');

  const tuned = tuneOpusSdp(sampleSdp);

  // Assertions:
  // 1. Opus line must contain stereo=0
  assert.ok(tuned.includes('stereo=0'), 'Opus must be tuned to mono stereo=0');

  // 2. Opus line must contain inband FEC for packet loss resilience
  assert.ok(tuned.includes('useinbandfec=1'), 'Opus must have useinbandfec=1');

  // 3. Opus line must contain DTX for discontinuous transmission
  assert.ok(tuned.includes('usedtx=1'), 'Opus must have usedtx=1');

  // 4. Opus line must have voice ceiling limit (32 kbps)
  assert.ok(tuned.includes('maxaveragebitrate=32000'), 'Opus must have maxaveragebitrate=32000');

  // 5. Comfort noise generation must be disabled to prevent oscillating hiss
  assert.ok(tuned.includes('cng=0'), 'Opus must have cng=0');

  // 6. Video format parameters (VP8) must remain untouched
  assert.ok(tuned.includes('a=fmtp:96 max-fs=12288;max-fr=60'), 'VP8 line must remain completely untouched');

  // Test with existing stereo=1 in SDP
  const stereoSdp = 'm=audio 9\r\na=rtpmap:111 opus/48000/2\r\na=fmtp:111 stereo=1;sprop-stereo=1';
  const tunedStereo = tuneOpusSdp(stereoSdp);
  assert.ok(tunedStereo.includes('stereo=0'), 'Must override stereo=1 with stereo=0');
  assert.ok(!tunedStereo.includes('stereo=1'), 'Must not contain stereo=1');

  console.log('✓ All Opus SDP Tuning tests passed successfully!');
}

runTests();
