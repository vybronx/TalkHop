const assert = require('assert');

class AdaptiveQualityEvaluator {
  constructor() {
    this.consecutivePoor = 0;
    this.consecutiveGood = 0;
    this.videoTier = 0; // 0 = Normal, 2 = 64k low-bw, 3 = AudioOnly degraded
    this.isAudioOnlyDegraded = false;
  }

  evaluate({ outVideoBitrate, inVideoLossRate, rtt, jitter }) {
    const isExtremelyConstrained = (inVideoLossRate > 0.18 || rtt > 800 || (outVideoBitrate > 0 && outVideoBitrate < 45));
    const isModeratelyConstrained = (inVideoLossRate > 0.08 || rtt > 400 || (outVideoBitrate > 0 && outVideoBitrate < 110));
    const isHealthy = (inVideoLossRate < 0.04 && rtt < 250 && jitter < 50);

    if (isExtremelyConstrained) {
      this.consecutivePoor++;
      this.consecutiveGood = 0;
      if (this.consecutivePoor >= 2) {
        this.videoTier = 3;
        this.isAudioOnlyDegraded = true;
      }
    } else if (isModeratelyConstrained) {
      this.consecutivePoor++;
      this.consecutiveGood = 0;
      if (this.consecutivePoor >= 2 && !this.isAudioOnlyDegraded) {
        this.videoTier = 2; // 64 kbps tier
      }
    } else if (isHealthy) {
      this.consecutiveGood++;
      this.consecutivePoor = 0;
      if (this.consecutiveGood >= 3) {
        this.videoTier = 0;
        this.isAudioOnlyDegraded = false;
      }
    }

    return {
      tier: this.videoTier,
      isAudioOnlyDegraded: this.isAudioOnlyDegraded,
      consecutivePoor: this.consecutivePoor,
      consecutiveGood: this.consecutiveGood
    };
  }
}

function calculateBitrate(currentBytes, lastBytes, elapsedSec) {
  if (elapsedSec <= 0) return 0;
  return ((currentBytes - lastBytes) * 8) / (elapsedSec * 1000);
}

function runTests() {
  console.log('Running Adaptive Quality tests...');

  // Test 1: Bitrate calculation formula
  // 50,000 bytes in 2.5 seconds = (50000 * 8) / (2.5 * 1000) = 400,000 / 2500 = 160 kbps
  const bitrate = calculateBitrate(150000, 100000, 2.5);
  assert.strictEqual(bitrate, 160);

  // Test 2: Single poor measurement must NOT immediately trigger degradation (Hysteresis check)
  const evaluator = new AdaptiveQualityEvaluator();
  let res = evaluator.evaluate({ outVideoBitrate: 30, inVideoLossRate: 0.25, rtt: 950, jitter: 120 });
  assert.strictEqual(res.isAudioOnlyDegraded, false, 'Single bad measurement should not degrade immediately');
  assert.strictEqual(res.consecutivePoor, 1);

  // Test 3: Second consecutive poor measurement triggers Audio-Only degraded mode
  res = evaluator.evaluate({ outVideoBitrate: 30, inVideoLossRate: 0.25, rtt: 950, jitter: 120 });
  assert.strictEqual(res.isAudioOnlyDegraded, true, 'Second bad measurement must trigger audio-only degraded mode');
  assert.strictEqual(res.tier, 3);

  // Test 4: Single good reading must NOT immediately restore video (prevents rapid flapping)
  res = evaluator.evaluate({ outVideoBitrate: 500, inVideoLossRate: 0.01, rtt: 40, jitter: 10 });
  assert.strictEqual(res.isAudioOnlyDegraded, true, 'Single good reading must not restore immediately');
  assert.strictEqual(res.consecutiveGood, 1);

  // Second good reading
  res = evaluator.evaluate({ outVideoBitrate: 550, inVideoLossRate: 0.01, rtt: 42, jitter: 12 });
  assert.strictEqual(res.isAudioOnlyDegraded, true, 'Second good reading still within hysteresis window');
  assert.strictEqual(res.consecutiveGood, 2);

  // Third consecutive good reading triggers full restoration
  res = evaluator.evaluate({ outVideoBitrate: 600, inVideoLossRate: 0.01, rtt: 38, jitter: 8 });
  assert.strictEqual(res.isAudioOnlyDegraded, false, 'Third consecutive good reading must restore video');
  assert.strictEqual(res.tier, 0);

  // Test 5: Moderate constraint triggers 64 kbps low-bandwidth tier (tier 2)
  const moderateEvaluator = new AdaptiveQualityEvaluator();
  moderateEvaluator.evaluate({ outVideoBitrate: 90, inVideoLossRate: 0.10, rtt: 450, jitter: 30 }); // 1st poor reading
  res = moderateEvaluator.evaluate({ outVideoBitrate: 85, inVideoLossRate: 0.12, rtt: 480, jitter: 35 }); // 2nd poor reading
  assert.strictEqual(res.tier, 2, 'Should degrade to 64 kbps tier');
  assert.strictEqual(res.isAudioOnlyDegraded, false, 'Should keep video active at 64k tier');

  console.log('✓ All Adaptive Quality tests passed successfully!');
}

runTests();
