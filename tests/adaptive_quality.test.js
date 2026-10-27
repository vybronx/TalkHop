const assert = require('assert');

class AdaptiveQualityEvaluator {
  constructor() {
    this.consecutivePoor = 0;
    this.consecutiveGood = 0;
    this.videoTier = 0; // 0 = Full/Normal, 1 = Moderate (350k), 2 = Low-BW (160k), 3 = Audio-Only degraded
    this.isAudioOnlyDegraded = false;
    this.lastPeerHint = null;
  }

  evaluate({
    outVideoBitrate = 0,
    inVideoLossRate = 0,
    inFramesDroppedRate = 0,
    rtt = 0,
    jitter = 0,
    availableOutgoingBitrateKbps = 0,
    qualityLimitationReason = 'none'
  }) {
    // Severe network constraints: loss > 20%, RTT > 750ms, or BWE < 120 kbps
    const isSevere = (
      inVideoLossRate > 0.20 ||
      rtt > 750 ||
      (availableOutgoingBitrateKbps > 0 && availableOutgoingBitrateKbps < 120) ||
      (qualityLimitationReason === 'bandwidth' && inVideoLossRate > 0.15) ||
      inFramesDroppedRate > 0.35
    );

    // Moderate constraint: loss 8-20%, RTT 350-750ms, or BWE 120-350 kbps
    const isModerate = (
      inVideoLossRate > 0.08 ||
      rtt > 350 ||
      (availableOutgoingBitrateKbps > 0 && availableOutgoingBitrateKbps < 350) ||
      (qualityLimitationReason === 'bandwidth' && rtt > 250) ||
      inFramesDroppedRate > 0.18
    );

    // Healthy: loss < 3%, RTT < 200ms, jitter < 40ms, dropped frames < 5%, and good BWE
    const isHealthy = (
      inVideoLossRate < 0.03 &&
      (rtt === 0 || rtt < 200) &&
      jitter < 40 &&
      inFramesDroppedRate < 0.05 &&
      (availableOutgoingBitrateKbps === 0 || availableOutgoingBitrateKbps > 400)
    );

    if (isSevere) {
      this.consecutivePoor++;
      this.consecutiveGood = 0;

      if (this.consecutivePoor >= 5 && this.videoTier >= 2 && !this.isAudioOnlyDegraded) {
        this.videoTier = 3;
        this.isAudioOnlyDegraded = true;
      } else if (this.consecutivePoor >= 4 && this.videoTier < 2 && !this.isAudioOnlyDegraded) {
        this.videoTier = 2; // Low-bandwidth Tier 2 (160 kbps)
        if (inVideoLossRate > 0.15) {
          this.lastPeerHint = { targetTier: 2, reason: 'high_inbound_loss' };
        }
      } else if (this.consecutivePoor >= 3 && this.videoTier < 1 && !this.isAudioOnlyDegraded) {
        this.videoTier = 1; // Moderate Tier 1 (350 kbps)
      }
    } else if (isModerate) {
      this.consecutivePoor++;
      this.consecutiveGood = 0;

      if (this.consecutivePoor >= 3 && this.videoTier < 1 && !this.isAudioOnlyDegraded) {
        this.videoTier = 1; // Moderate Tier 1
      }
    } else if (isHealthy) {
      this.consecutiveGood++;
      this.consecutivePoor = 0;

      // Progressive restoration: requires 4 consecutive healthy readings (10s) per tier step
      if (this.consecutiveGood >= 4) {
        this.consecutiveGood = 0; // reset for next step

        if (this.isAudioOnlyDegraded) {
          this.isAudioOnlyDegraded = false;
          this.videoTier = 2; // recover to Tier 2 first
        } else if (this.videoTier === 2) {
          this.videoTier = 1; // recover to Tier 1
        } else if (this.videoTier === 1) {
          this.videoTier = 0; // recover to full Tier 0
          this.lastPeerHint = { targetTier: 0, reason: 'network_recovered' };
        }
      }
    }

    return {
      tier: this.videoTier,
      isAudioOnlyDegraded: this.isAudioOnlyDegraded,
      consecutivePoor: this.consecutivePoor,
      consecutiveGood: this.consecutiveGood,
      lastPeerHint: this.lastPeerHint
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

  // Test 2: Low outVideoBitrate in a healthy connection (still room/low motion) must NEVER trigger degradation!
  const healthyEvaluator = new AdaptiveQualityEvaluator();
  for (let i = 0; i < 10; i++) {
    const res = healthyEvaluator.evaluate({
      outVideoBitrate: 35, // Low bitrate due to static camera scene
      inVideoLossRate: 0.0,
      rtt: 45,
      jitter: 10,
      availableOutgoingBitrateKbps: 2500, // Good BWE
      qualityLimitationReason: 'none'
    });
    assert.strictEqual(res.isAudioOnlyDegraded, false, 'Low outbound bitrate alone must never trigger audio-only mode');
    assert.strictEqual(res.tier, 0, 'Healthy connection must stay at Tier 0');
  }

  // Test 3: Hysteresis check - single poor measurement must NOT immediately degrade
  const evaluator = new AdaptiveQualityEvaluator();
  let res = evaluator.evaluate({
    inVideoLossRate: 0.25,
    rtt: 850,
    jitter: 120,
    availableOutgoingBitrateKbps: 90
  });
  assert.strictEqual(res.tier, 0, 'Single poor measurement must not degrade immediately');
  assert.strictEqual(res.consecutivePoor, 1);

  // Test 4: Sustained moderate constraint triggers Tier 1 (350 kbps) after 3 samples
  evaluator.evaluate({ inVideoLossRate: 0.10, rtt: 400, jitter: 45 }); // sample 2
  res = evaluator.evaluate({ inVideoLossRate: 0.12, rtt: 420, jitter: 50 }); // sample 3
  assert.strictEqual(res.tier, 1, 'Should degrade to Tier 1 after 3 moderate samples');
  assert.strictEqual(res.isAudioOnlyDegraded, false);

  // Test 5: Severe stress triggers Tier 2 (160 kbps) after 4 samples
  res = evaluator.evaluate({ inVideoLossRate: 0.22, rtt: 800, jitter: 90, availableOutgoingBitrateKbps: 100 }); // sample 4
  assert.strictEqual(res.tier, 2, 'Should degrade to Tier 2 (160k) after 4 severe samples');
  assert.strictEqual(res.isAudioOnlyDegraded, false);
  assert.strictEqual(res.lastPeerHint.targetTier, 2, 'Should notify peer of downlink congestion');

  // Test 6: Sustained severe stress triggers Audio-Only degraded mode after 5 samples
  res = evaluator.evaluate({ inVideoLossRate: 0.30, rtt: 950, jitter: 140, availableOutgoingBitrateKbps: 50 }); // sample 5
  assert.strictEqual(res.tier, 3, 'Should degrade to Tier 3 (audio-only) after 5 severe samples');
  assert.strictEqual(res.isAudioOnlyDegraded, true);

  // Test 7: Progressive recovery requires 4 consecutive healthy samples per tier
  // Samples 1-3: still recovering, remains in audio-only
  for (let s = 1; s <= 3; s++) {
    res = evaluator.evaluate({ inVideoLossRate: 0.01, rtt: 50, jitter: 10, availableOutgoingBitrateKbps: 1500 });
    assert.strictEqual(res.isAudioOnlyDegraded, true, `Sample ${s} of recovery must stay in audio-only mode`);
  }

  // Sample 4: steps up to Tier 2 (video resumed with 160 kbps)
  res = evaluator.evaluate({ inVideoLossRate: 0.01, rtt: 48, jitter: 8, availableOutgoingBitrateKbps: 1600 });
  assert.strictEqual(res.isAudioOnlyDegraded, false, 'Sample 4 must resume video into Tier 2');
  assert.strictEqual(res.tier, 2);

  // Next 4 healthy samples step up from Tier 2 to Tier 1
  for (let s = 1; s <= 4; s++) {
    res = evaluator.evaluate({ inVideoLossRate: 0.01, rtt: 45, jitter: 8, availableOutgoingBitrateKbps: 1800 });
  }
  assert.strictEqual(res.tier, 1, 'Should step up to Tier 1');

  // Next 4 healthy samples step up from Tier 1 to full Tier 0
  for (let s = 1; s <= 4; s++) {
    res = evaluator.evaluate({ inVideoLossRate: 0.00, rtt: 40, jitter: 5, availableOutgoingBitrateKbps: 2000 });
  }
  assert.strictEqual(res.tier, 0, 'Should step up to full Tier 0');
  assert.strictEqual(res.lastPeerHint.targetTier, 0, 'Should notify peer that connection recovered');

  console.log('✓ All Adaptive Quality tests passed successfully!');
}

runTests();
