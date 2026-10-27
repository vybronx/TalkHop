/**
 * Vybrant ⚡ - Instant P2P Random Video Chat Engine
 * High-performance peer-to-peer random video matchmaking with AI Safety Shield
 * Hosted at vybrant.vybronx.online
 */

// ==========================================
// CONFIGURATION & WEBRTC STUN/TURN OPTIMIZATION (Milestone 5)
// ==========================================
const RTC_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun.relay.metered.ca:80" },
    {
      urls: "turn:global.relay.metered.ca:80",
      username: "1654f590900e48e1a4ae720e",
      credential: "uc4KT1+bOvxoS9js",
    },
    {
      urls: "turn:global.relay.metered.ca:443",
      username: "1654f590900e48e1a4ae720e",
      credential: "uc4KT1+bOvxoS9js",
    },
    {
      urls: "turns:global.relay.metered.ca:443?transport=tcp",
      username: "1654f590900e48e1a4ae720e",
      credential: "uc4KT1+bOvxoS9js",
    },
  ],
  iceCandidatePoolSize: 2,
  bundlePolicy: 'max-bundle',
  rtcpMuxPolicy: 'require'
};

// ==========================================
// CONNECTION STATE MACHINE
// ==========================================
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

// ==========================================
// APPLICATION STATE
// ==========================================
let socket = null;
let localStream = null;
let peerConnection = null;
let dataChannel = null;
let currentPartnerId = null;
let currentSessionId = null;
let isInitiator = false;
let isSearching = false;
let isAudioMuted = false;
let isVideoDisabled = false;
let isAudioOnly = false;
let currentFacingMode = 'user'; // 'user' (front selfie) or 'environment' (back camera)
let isCameraMirrored = true; // true = selfie mirrored view, false = natural view
let currentVideoDeviceId = null; // Track active hardware camera deviceId
let isFlippingCamera = false;
let isMediaRequesting = false;
let pendingIceCandidates = [];
let antiFlashInterval = null;
let typingTimeout = null;
let lastSkipTime = 0;
let remoteAudioMonitor = null;

// TalkHop Application Mode: 'text' (Random Chat) | 'video' (Video Call)
let currentAppMode = localStorage.getItem('talkhop_selected_mode') || 'text';

// Connection Resilience & Recovery State
let currentCallState = ConnectionState.IDLE;
let iceRestartCount = 0;
let iceRecoveryTimer = null;
let isAdaptiveVideoPaused = false;
let activeVideoTier = 0; // 0: Normal, 1: Constrained, 2: 64k low-bw, 3: Audio-only degraded
let adaptiveMonitorInterval = null;
let consecutivePoorReadings = 0;
let consecutiveGoodReadings = 0;
let lastStatsSample = null;

// Browser Environment & Autoplay Flags
const isInstagramBrowser = /Instagram|FBAN|FBAV/i.test(navigator.userAgent);
let isRemoteAudioBlocked = false;

// VIP & Matchmaking State
let consecutiveSkips = 0;
let matchCount = 0;
let isVip = false;
let vipCode = localStorage.getItem('talkhop_vip_code') || localStorage.getItem('vybrant_vip_code') || localStorage.getItem('blip_vip_code') || null;
let vipExpiresAt = 0;
let vipTimerInterval = null;
let latestGeneratedCode = null;

// Browser-Side NSFW Shield (nsfwjs + TensorFlow.js)
let nsfwModel = null;
let nsfwScannerInterval = null;
let isNsfwScanning = false;
const NSFW_PROBABILITY_THRESHOLD = 0.65; // 65% confidence

// Preferences
let userPreferences = {
  myGender: 'male',
  myCountry: 'IN',
  genderFilter: 'any',
  countryFilter: 'any'
};

// Dynamic Live Sponsor Configuration (Milestone 4 Admin Broadcast)
let currentSponsorConfig = {
  tag: '🎮 Verified Partner',
  subTag: 'Zero-Ad Monetization',
  message: 'Level up your setup with Vybronx Gaming Gear & Cloud Servers.',
  highlight: 'Vybronx Gaming Gear & Cloud Servers',
  urlText: 'Visit vybronx.online/store',
  url: 'https://vybronx.online'
};

// ==========================================
// VOICE CLARITY & AUDIO PROCESSING CONFIGURATION
// ==========================================
// Clean voice constraints that avoid aggressive desktop AGC gain pumping (which causes swirling/oscillating echo artifacts)
const PREFERRED_AUDIO_CONSTRAINTS = {
  echoCancellation: { ideal: true },
  noiseSuppression: { ideal: true },
  autoGainControl: { ideal: false }, // Avoids excessive gain boosting during pauses on PC headphones
  channelCount: { ideal: 1 },
  sampleRate: { ideal: 48000 }
};

/**
 * Inspect actual audio track settings without logging device IDs or private data
 */
function logAudioTrackSettings(stream) {
  if (!stream || typeof stream.getAudioTracks !== 'function') return null;
  const audioTrack = stream.getAudioTracks()[0];
  const settings = audioTrack?.getSettings();

  console.debug('Vybrant audio settings', {
    echoCancellation: settings?.echoCancellation,
    noiseSuppression: settings?.noiseSuppression,
    autoGainControl: settings?.autoGainControl,
    channelCount: settings?.channelCount,
    sampleRate: settings?.sampleRate
  });

  return settings;
}

/**
 * Optimizes WebRTC SDP for Opus speech clarity and telephony reliability:
 * Enforces mono channel to avoid phase artifacts on mobile speakers,
 * enables inband forward error correction (FEC) for packet loss resilience,
 * enables DTX for bandwidth efficiency, disables comfort noise (CNG) oscillation,
 * and sets an optimal 32 kbps average bitrate ceiling.
 */
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

/**
 * Improves WebRTC voice transmission quality by inspecting existing audio senders
 * and setting an optimal Opus voice bitrate ceiling (32-40 kbps, default 36000 bps)
 */
async function applyVoiceSenderBitrate(pc) {
  if (!pc || typeof pc.getSenders !== 'function') return;

  try {
    const senders = pc.getSenders();
    const audioSender = senders.find(s => s.track && s.track.kind === 'audio');
    if (!audioSender || typeof audioSender.getParameters !== 'function' || typeof audioSender.setParameters !== 'function') {
      return;
    }

    const params = audioSender.getParameters();
    if (!params || !Array.isArray(params.encodings) || params.encodings.length === 0) {
      return;
    }

    const TARGET_VOICE_BITRATE_BPS = 36000; // 36 kbps optimal speech clarity
    if (params.encodings[0].maxBitrate === TARGET_VOICE_BITRATE_BPS) {
      return;
    }

    params.encodings[0].maxBitrate = TARGET_VOICE_BITRATE_BPS;
    await audioSender.setParameters(params);
    console.debug('[Vybrant Audio] WebRTC audio sender voice bitrate optimized (maxBitrate: 36 kbps)');
  } catch (err) {
    console.debug('[Vybrant Audio] Audio sender bitrate adjustment skipped:', err.name || err.message);
  }
}

// ==========================================
// CONNECTION STATE MACHINE CONTROLLER
// ==========================================
function setCallState(newState, meta = {}) {
  const previousState = currentCallState;
  currentCallState = newState;

  // Video Mode Elements
  const statusDot = document.getElementById('strangerStatusDot');
  const badgeText = document.getElementById('strangerBadgeText');
  const p2pBadge = document.getElementById('networkP2pBadge');
  const recoveryOverlay = document.getElementById('connectionRecoveryOverlay');
  const recoveryTitle = document.getElementById('recoveryOverlayTitle');
  const recoveryDesc = document.getElementById('recoveryOverlayDesc');

  // Chat Mode Elements
  const statusDotText = document.getElementById('strangerStatusDotText');
  const badgeTextMode = document.getElementById('strangerBadgeTextMode');
  const subtitleTextMode = document.getElementById('strangerSubtitleTextMode');
  const chatStatusBanner = document.getElementById('chatStatusBanner');
  const chatStatusBannerText = document.getElementById('chatStatusBannerText');
  const chatStatusBannerIcon = document.getElementById('chatStatusBannerIcon');

  switch (newState) {
    case ConnectionState.IDLE:
      if (statusDot) statusDot.className = 'w-2 h-2 rounded-full bg-slate-500';
      if (badgeText) badgeText.textContent = 'Standby';
      if (recoveryOverlay) recoveryOverlay.classList.add('hidden');
      if (statusDotText) statusDotText.className = 'w-3 h-3 rounded-full bg-slate-400';
      if (badgeTextMode) badgeTextMode.textContent = 'Standby';
      if (subtitleTextMode) subtitleTextMode.textContent = 'Click Start to begin matching';
      if (chatStatusBanner) chatStatusBanner.classList.add('hidden');
      break;

    case ConnectionState.SEARCHING:
      if (statusDot) statusDot.className = 'w-2 h-2 rounded-full bg-amber-400 animate-pulse';
      if (badgeText) badgeText.textContent = 'Searching...';
      if (recoveryOverlay) recoveryOverlay.classList.add('hidden');
      if (statusDotText) statusDotText.className = 'w-3 h-3 rounded-full bg-amber-400 animate-pulse';
      if (badgeTextMode) badgeTextMode.textContent = 'Searching...';
      if (subtitleTextMode) subtitleTextMode.textContent = meta.message || 'Looking for someone awesome around the world...';
      if (chatStatusBanner) {
        chatStatusBanner.classList.remove('hidden');
        if (chatStatusBannerText) chatStatusBannerText.textContent = meta.message || 'Looking for a stranger for text chat...';
        if (chatStatusBannerIcon) chatStatusBannerIcon.textContent = '🔍';
      }
      break;

    case ConnectionState.CONNECTING:
      if (statusDot) statusDot.className = 'w-2 h-2 rounded-full bg-cyan-400 animate-pulse';
      if (badgeText) badgeText.textContent = 'Connecting...';
      if (recoveryOverlay) recoveryOverlay.classList.add('hidden');
      if (statusDotText) statusDotText.className = 'w-3 h-3 rounded-full bg-cyan-400 animate-pulse';
      if (badgeTextMode) badgeTextMode.textContent = 'Connecting...';
      if (subtitleTextMode) subtitleTextMode.textContent = 'Connecting with a stranger...';
      if (chatStatusBanner) {
        chatStatusBanner.classList.remove('hidden');
        if (chatStatusBannerText) chatStatusBannerText.textContent = 'Connecting to stranger...';
        if (chatStatusBannerIcon) chatStatusBannerIcon.textContent = '⚡';
      }
      break;

    case ConnectionState.CONNECTED:
      if (statusDot) statusDot.className = 'w-2 h-2 rounded-full bg-emerald-400';
      if (badgeText) badgeText.textContent = isAudioOnly ? 'Connected (Voice)' : 'Connected (Live)';
      if (p2pBadge) p2pBadge.textContent = 'Encrypted P2P';
      if (recoveryOverlay) recoveryOverlay.classList.add('hidden');
      if (statusDotText) statusDotText.className = 'w-3 h-3 rounded-full bg-emerald-500';
      if (badgeTextMode) badgeTextMode.textContent = 'Stranger';
      if (subtitleTextMode) subtitleTextMode.textContent = (currentAppMode === 'text') ? 'Connected anonymously • No media shared' : 'Connected live • WebRTC P2P';
      if (chatStatusBanner) {
        if (chatStatusBannerText) chatStatusBannerText.textContent = 'Connected anonymously with Stranger';
        setTimeout(() => {
          if (currentPartnerId && currentCallState === ConnectionState.CONNECTED && chatStatusBanner) {
            chatStatusBanner.classList.add('hidden');
          }
        }, 3000);
      }
      break;

    case ConnectionState.TEMPORARILY_INTERRUPTED:
      if (statusDot) statusDot.className = 'w-2 h-2 rounded-full bg-amber-500 animate-ping';
      if (badgeText) badgeText.textContent = 'Interrupted';
      if (recoveryOverlay) {
        if (recoveryTitle) recoveryTitle.textContent = 'Reconnecting...';
        if (recoveryDesc) recoveryDesc.textContent = meta.message || 'Temporary network fluctuation detected. Preserving call...';
        recoveryOverlay.classList.remove('hidden');
      }
      if (statusDotText) statusDotText.className = 'w-3 h-3 rounded-full bg-amber-500 animate-pulse';
      if (badgeTextMode) badgeTextMode.textContent = 'Reconnecting...';
      if (subtitleTextMode) subtitleTextMode.textContent = meta.message || 'Temporary network fluctuation. Preserving chat...';
      if (chatStatusBanner) {
        chatStatusBanner.classList.remove('hidden');
        if (chatStatusBannerText) chatStatusBannerText.textContent = meta.message || 'Reconnecting session...';
        if (chatStatusBannerIcon) chatStatusBannerIcon.textContent = '🔄';
      }
      break;

    case ConnectionState.RECOVERING:
      if (statusDot) statusDot.className = 'w-2 h-2 rounded-full bg-amber-500 animate-spin';
      if (badgeText) badgeText.textContent = 'Recovering';
      if (recoveryOverlay) {
        if (recoveryTitle) recoveryTitle.textContent = 'Restoring Call...';
        if (recoveryDesc) recoveryDesc.textContent = meta.message || 'Performing ICE recovery handshake...';
        recoveryOverlay.classList.remove('hidden');
      }
      if (chatStatusBanner) {
        chatStatusBanner.classList.remove('hidden');
        if (chatStatusBannerText) chatStatusBannerText.textContent = 'Restoring connection...';
      }
      break;

    case ConnectionState.AUDIO_ONLY_DEGRADED:
      if (statusDot) statusDot.className = 'w-2 h-2 rounded-full bg-amber-400';
      if (badgeText) badgeText.textContent = 'Voice Priority (Low-BW)';
      if (recoveryOverlay) recoveryOverlay.classList.add('hidden');
      break;

    case ConnectionState.DISCONNECTED:
      if (statusDot) statusDot.className = 'w-2 h-2 rounded-full bg-rose-500';
      if (badgeText) badgeText.textContent = 'Disconnected';
      if (recoveryOverlay) recoveryOverlay.classList.add('hidden');
      if (statusDotText) statusDotText.className = 'w-3 h-3 rounded-full bg-slate-400';
      if (badgeTextMode) badgeTextMode.textContent = 'Stranger';
      if (subtitleTextMode) subtitleTextMode.textContent = 'Stranger disconnected. Press Skip to find someone new.';
      if (chatStatusBanner) {
        chatStatusBanner.classList.remove('hidden');
        if (chatStatusBannerText) chatStatusBannerText.textContent = meta.message || 'Stranger has disconnected. Press Skip or Start to match.';
        if (chatStatusBannerIcon) chatStatusBannerIcon.textContent = '👋';
      }
      break;
  }

  console.log(`[Connection State] Transitioned: ${previousState} -> ${newState}`);
}

// ==========================================
// ADAPTIVE QUALITY & LOW-BANDWIDTH ENGINE
// ==========================================
function startAdaptiveStatsMonitoring() {
  stopAdaptiveStatsMonitoring();
  consecutivePoorReadings = 0;
  consecutiveGoodReadings = 0;
  lastStatsSample = null;

  // Poll WebRTC stats every 2.5 seconds
  adaptiveMonitorInterval = setInterval(sampleConnectionStats, 2500);
}

function stopAdaptiveStatsMonitoring() {
  if (adaptiveMonitorInterval) {
    clearInterval(adaptiveMonitorInterval);
    adaptiveMonitorInterval = null;
  }
  lastStatsSample = null;
}

async function sampleConnectionStats() {
  if (!peerConnection || (peerConnection.connectionState !== 'connected' && peerConnection.iceConnectionState !== 'connected')) {
    return;
  }

  try {
    const stats = await peerConnection.getStats();
    const now = Date.now();
    let outboundVideo = null;
    let outboundAudio = null;
    let inboundVideo = null;
    let inboundAudio = null;
    let candidatePair = null;
    let remoteInboundVideo = null;

    stats.forEach(report => {
      if (report.type === 'outbound-rtp' && report.kind === 'video') {
        outboundVideo = report;
      } else if (report.type === 'outbound-rtp' && report.kind === 'audio') {
        outboundAudio = report;
      } else if (report.type === 'inbound-rtp' && report.kind === 'video') {
        inboundVideo = report;
      } else if (report.type === 'inbound-rtp' && report.kind === 'audio') {
        inboundAudio = report;
      } else if (report.type === 'candidate-pair' && (report.state === 'succeeded' || report.nominated)) {
        candidatePair = report;
      } else if (report.type === 'remote-inbound-rtp' && report.kind === 'video') {
        remoteInboundVideo = report;
      }
    });

    if (!lastStatsSample) {
      lastStatsSample = { now, outboundVideo, outboundAudio, inboundVideo, inboundAudio, candidatePair };
      return;
    }

    const elapsedSec = (now - lastStatsSample.now) / 1000;
    if (elapsedSec <= 0.5) return;

    // Calculate outbound video bitrate in kbps (for telemetry/diagnostics only, NOT for assuming low network capacity)
    let outVideoBitrate = 0;
    if (outboundVideo && lastStatsSample.outboundVideo) {
      const bytesDiff = (outboundVideo.bytesSent || 0) - (lastStatsSample.outboundVideo.bytesSent || 0);
      outVideoBitrate = (bytesDiff * 8) / (elapsedSec * 1000);
    }

    // Inbound video packet loss rate calculation
    let inVideoLossRate = 0;
    if (inboundVideo && lastStatsSample.inboundVideo) {
      const packetsReceivedDiff = (inboundVideo.packetsReceived || 0) - (lastStatsSample.inboundVideo.packetsReceived || 0);
      const packetsLostDiff = (inboundVideo.packetsLost || 0) - (lastStatsSample.inboundVideo.packetsLost || 0);
      const total = packetsReceivedDiff + packetsLostDiff;
      if (total > 0 && packetsLostDiff >= 0) inVideoLossRate = Math.max(0, packetsLostDiff / total);
    }

    // Inbound frame drop rate
    let inFramesDroppedRate = 0;
    if (inboundVideo && lastStatsSample.inboundVideo) {
      const decodedDiff = (inboundVideo.framesDecoded || 0) - (lastStatsSample.inboundVideo.framesDecoded || 0);
      const droppedDiff = (inboundVideo.framesDropped || 0) - (lastStatsSample.inboundVideo.framesDropped || 0);
      const totalFrames = decodedDiff + droppedDiff;
      if (totalFrames > 0 && droppedDiff >= 0) inFramesDroppedRate = Math.max(0, droppedDiff / totalFrames);
    }

    const rtt = candidatePair?.currentRoundTripTime ? candidatePair.currentRoundTripTime * 1000 : 0;
    const jitter = (inboundAudio?.jitter || inboundVideo?.jitter || 0) * 1000;
    const availableOutgoingBitrateKbps = candidatePair?.availableOutgoingBitrate ? (candidatePair.availableOutgoingBitrate / 1000) : 0;
    const qualityLimitationReason = outboundVideo?.qualityLimitationReason || 'none';

    lastStatsSample = { now, outboundVideo, outboundAudio, inboundVideo, inboundAudio, candidatePair };

    evaluateAdaptiveQuality({
      outVideoBitrate,
      inVideoLossRate,
      inFramesDroppedRate,
      rtt,
      jitter,
      availableOutgoingBitrateKbps,
      qualityLimitationReason
    });
  } catch (err) {
    console.debug('[Adaptive Quality] Error reading stats:', err);
  }
}

function evaluateAdaptiveQuality({
  outVideoBitrate,
  inVideoLossRate,
  inFramesDroppedRate,
  rtt,
  jitter,
  availableOutgoingBitrateKbps,
  qualityLimitationReason
}) {
  if (currentCallState === ConnectionState.IDLE || currentCallState === ConnectionState.SEARCHING || currentCallState === ConnectionState.DISCONNECTED) {
    return;
  }

  // Severe network constraints: high packet loss (>20%), high RTT (>750ms), or confirmed BWE < 120 kbps
  const isSevere = (
    inVideoLossRate > 0.20 ||
    rtt > 750 ||
    (availableOutgoingBitrateKbps > 0 && availableOutgoingBitrateKbps < 120) ||
    (qualityLimitationReason === 'bandwidth' && inVideoLossRate > 0.15) ||
    inFramesDroppedRate > 0.35
  );

  // Moderate network constraints: packet loss 8-20%, RTT 350-750ms, or BWE 120-350 kbps
  const isModerate = (
    inVideoLossRate > 0.08 ||
    rtt > 350 ||
    (availableOutgoingBitrateKbps > 0 && availableOutgoingBitrateKbps < 350) ||
    (qualityLimitationReason === 'bandwidth' && rtt > 250) ||
    inFramesDroppedRate > 0.18
  );

  // Healthy network: loss < 3%, RTT < 200ms, jitter < 40ms, dropped frames < 5%, and good BWE
  const isHealthy = (
    inVideoLossRate < 0.03 &&
    (rtt === 0 || rtt < 200) &&
    jitter < 40 &&
    inFramesDroppedRate < 0.05 &&
    (availableOutgoingBitrateKbps === 0 || availableOutgoingBitrateKbps > 400)
  );

  if (isSevere) {
    consecutivePoorReadings++;
    consecutiveGoodReadings = 0;

    // SUTAINED severe stress after Tier 2 was already active -> Pause video, prioritize voice
    if (consecutivePoorReadings >= 5 && activeVideoTier >= 2 && !isAdaptiveVideoPaused) {
      applyAudioOnlyDegradedMode(true);
    } else if (consecutivePoorReadings >= 4 && activeVideoTier < 2 && !isAdaptiveVideoPaused) {
      // Apply low-bandwidth Tier 2 (160 kbps, 15 fps, scale 2.0)
      applyLowBandwidthVideoTier(2);
      // Notify remote peer to reduce outgoing video if our downlink is congested
      if (inVideoLossRate > 0.15 && socket) {
        socket.emit('media-quality-hint', { targetTier: 2, reason: 'high_inbound_loss' });
      }
    } else if (consecutivePoorReadings >= 3 && activeVideoTier < 1 && !isAdaptiveVideoPaused) {
      // Apply moderate Tier 1 (350 kbps, 24 fps, scale 1.5)
      applyLowBandwidthVideoTier(1);
    }
  } else if (isModerate) {
    consecutivePoorReadings++;
    consecutiveGoodReadings = 0;

    if (consecutivePoorReadings >= 3 && activeVideoTier < 1 && !isAdaptiveVideoPaused) {
      applyLowBandwidthVideoTier(1);
    }
  } else if (isHealthy) {
    consecutiveGoodReadings++;
    consecutivePoorReadings = 0;

    // Hysteresis & Progressive Restoration: Requires 4 consecutive healthy samples (10s) per tier step
    if (consecutiveGoodReadings >= 4) {
      consecutiveGoodReadings = 0; // Reset for next progressive step

      if (isAdaptiveVideoPaused) {
        // Step 1: Recover from Audio-Only degraded mode to low-bandwidth Tier 2
        applyAudioOnlyDegradedMode(false);
        applyLowBandwidthVideoTier(2);
      } else if (activeVideoTier === 2) {
        // Step 2: Recover from Tier 2 to Tier 1
        applyLowBandwidthVideoTier(1);
      } else if (activeVideoTier === 1) {
        // Step 3: Recover from Tier 1 to full unconstrained Tier 0
        applyLowBandwidthVideoTier(0);
        if (socket) {
          socket.emit('media-quality-hint', { targetTier: 0, reason: 'network_recovered' });
        }
      }
    }
  }
}

async function applyAudioOnlyDegradedMode(enable) {
  const banner = document.getElementById('adaptiveQualityBanner');
  const bannerText = document.getElementById('adaptiveQualityText');

  if (enable) {
    isAdaptiveVideoPaused = true;
    activeVideoTier = 3;
    setCallState(ConnectionState.AUDIO_ONLY_DEGRADED);

    if (banner) {
      if (bannerText) bannerText.textContent = 'Poor connection — video paused, audio continuing';
      banner.classList.remove('hidden');
    }

    // Temporarily pause outgoing video track to protect audio bandwidth
    if (localStream) {
      const vidTrack = localStream.getVideoTracks()[0];
      if (vidTrack) vidTrack.enabled = false;
    }

    console.log('[Adaptive Quality] Entered Audio-Only degraded mode. Intelligible audio prioritized.');
  } else {
    isAdaptiveVideoPaused = false;

    if (banner) banner.classList.add('hidden');

    // ONLY restore video if user did not intentionally disable their camera
    if (localStream && !isVideoDisabled) {
      const vidTrack = localStream.getVideoTracks()[0];
      if (vidTrack) vidTrack.enabled = true;
    }

    setCallState(ConnectionState.CONNECTED);
    showToast('Connection improved — video resumed 📹', 'success', 2500);
    console.log('[Adaptive Quality] Resumed video from Audio-Only mode.');
  }
}

async function applyLowBandwidthVideoTier(tier) {
  activeVideoTier = tier;
  if (!peerConnection) return;

  try {
    const senders = peerConnection.getSenders();
    const vidSender = senders.find(s => s.track && s.track.kind === 'video');
    if (!vidSender || typeof vidSender.getParameters !== 'function') return;

    const params = vidSender.getParameters();
    if (!params.encodings || params.encodings.length === 0) return;

    if (tier === 2) {
      // Tier 2: Realistic low-bandwidth video (160 kbps, 15 fps, scale 2.0)
      params.encodings[0].maxBitrate = 160000;
      params.encodings[0].scaleResolutionDownBy = 2.0;
      params.encodings[0].maxFramerate = 15;
    } else if (tier === 1) {
      // Tier 1: Moderate bandwidth constraint (350 kbps, 24 fps, scale 1.5)
      params.encodings[0].maxBitrate = 350000;
      params.encodings[0].scaleResolutionDownBy = 1.5;
      params.encodings[0].maxFramerate = 24;
    } else {
      // Tier 0: Restore standard/unconstrained quality
      delete params.encodings[0].maxBitrate;
      params.encodings[0].scaleResolutionDownBy = 1.0;
      params.encodings[0].maxFramerate = 30;
    }

    await vidSender.setParameters(params);
    console.log(`[Adaptive Quality] Applied video tier ${tier} (maxBitrate: ${params.encodings[0].maxBitrate || 'unlimited'} bps)`);
  } catch (err) {
    console.debug('[Adaptive Quality] Parameter adjustment skipped:', err.message);
  }
}

// ==========================================
// AUTOPLAY & AUDIO PLAYBACK RESTRICTIONS (Instagram / iOS Safari)
// ==========================================
function showTapToPlayAudioPrompt() {
  const tapBtn = document.getElementById('tapToPlayAudioBtn');
  if (tapBtn) {
    tapBtn.classList.remove('hidden');
    isRemoteAudioBlocked = true;
  }
}

function hideTapToPlayAudioPrompt() {
  const tapBtn = document.getElementById('tapToPlayAudioBtn');
  if (tapBtn) {
    tapBtn.classList.add('hidden');
    isRemoteAudioBlocked = false;
  }
}

// Window diagnostic helper for QA & audio inspection
window.getVybrantAudioDiagnostics = async function() {
  const localAudioTrack = localStream?.getAudioTracks()?.[0];
  const localSettings = localAudioTrack?.getSettings();
  let rtcStats = null;

  if (peerConnection && typeof peerConnection.getStats === 'function') {
    try {
      const stats = await peerConnection.getStats();
      rtcStats = {};
      stats.forEach(report => {
        if (report.type === 'outbound-rtp' && report.kind === 'audio') {
          rtcStats.outbound = {
            packetsSent: report.packetsSent,
            bytesSent: report.bytesSent,
            targetBitrate: report.targetBitrate
          };
        } else if (report.type === 'inbound-rtp' && report.kind === 'audio') {
          rtcStats.inbound = {
            packetsReceived: report.packetsReceived,
            packetsLost: report.packetsLost,
            jitter: report.jitter,
            bytesReceived: report.bytesReceived
          };
        }
      });
    } catch (e) {
      rtcStats = { error: e.message };
    }
  }

  return {
    audioTrackSettings: {
      echoCancellation: localSettings?.echoCancellation,
      noiseSuppression: localSettings?.noiseSuppression,
      autoGainControl: localSettings?.autoGainControl,
      channelCount: localSettings?.channelCount,
      sampleRate: localSettings?.sampleRate
    },
    isAudioMuted,
    isAudioOnly,
    peerConnectionState: peerConnection?.connectionState || 'none',
    rtcStats
  };
};

// ==========================================
// THEME CONTROLLER (Light-First Adaptive Theme)
// ==========================================
let themeInitialized = false;

function initTheme() {
  const savedTheme = localStorage.getItem('talkhop_theme') || localStorage.getItem('vybrant_theme') || 'light';
  applyTheme(savedTheme);

  if (themeInitialized) return;
  themeInitialized = true;

  const toggleBtn = document.getElementById('themeToggleBtn');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      const isCurrentlyDark = document.documentElement.classList.contains('dark');
      const newTheme = isCurrentlyDark ? 'light' : 'dark';
      applyTheme(newTheme);
      localStorage.setItem('talkhop_theme', newTheme);
      localStorage.setItem('vybrant_theme', newTheme);
      showToast(`Switched to ${newTheme === 'dark' ? 'Dark 🌙' : 'Light ☀️'} mode`, 'info', 2000);
    });
  }
}

function applyTheme(theme) {
  const toggleIcon = document.getElementById('themeToggleIcon');
  const metaThemeColor = document.querySelector('meta[name="theme-color"]');

  if (theme === 'dark') {
    document.documentElement.classList.add('dark');
    if (toggleIcon) toggleIcon.textContent = '☀️';
    if (metaThemeColor) metaThemeColor.setAttribute('content', '#07080d');
  } else {
    document.documentElement.classList.remove('dark');
    if (toggleIcon) toggleIcon.textContent = '🌙';
    if (metaThemeColor) metaThemeColor.setAttribute('content', '#f4f4f5');
  }
}

// Immediate Theme Apply on load
applyTheme(localStorage.getItem('talkhop_theme') || localStorage.getItem('vybrant_theme') || 'light');

// ==========================================
// TOAST NOTIFICATIONS (De-duplicated & Anti-Spam)
// ==========================================
function showToast(message, type = 'info', duration = 3500) {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  // 1. Prevent duplicate toasts with identical content
  const existingToasts = container.querySelectorAll('.talkhop-toast, .vybrant-toast');
  for (const t of existingToasts) {
    if (t.dataset.message === message) {
      // Re-trigger entrance animation without creating a duplicate DOM node
      t.classList.remove('translate-y-3', 'opacity-0');
      return;
    }
  }

  // 2. Cap max visible toasts to 2 to prevent stacking spam
  if (existingToasts.length >= 2) {
    existingToasts[0].remove();
  }

  const toast = document.createElement('div');
  toast.dataset.message = message;
  const bgColors = {
    info: 'bg-white dark:bg-slate-900/95 border-zinc-200 dark:border-purple-500/30 text-purple-700 dark:text-purple-200 shadow-md',
    success: 'bg-white dark:bg-slate-900/95 border-zinc-200 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-200 shadow-md',
    warning: 'bg-white dark:bg-slate-900/95 border-zinc-200 dark:border-amber-500/30 text-amber-700 dark:text-amber-200 shadow-md',
    danger: 'bg-white dark:bg-slate-900/95 border-zinc-200 dark:border-rose-500/30 text-rose-700 dark:text-rose-200 shadow-md'
  };

  toast.className = `talkhop-toast vybrant-toast pointer-events-auto flex items-center space-x-2 px-4 py-2.5 rounded-xl border shadow-xl backdrop-blur-xl text-xs font-semibold ${bgColors[type] || bgColors.info} transform transition-all duration-300 translate-y-3 opacity-0`;
  toast.innerHTML = `<span>${message}</span>`;
  
  container.appendChild(toast);
  requestAnimationFrame(() => {
    toast.classList.remove('translate-y-3', 'opacity-0');
  });

  setTimeout(() => {
    toast.classList.add('translate-y-3', 'opacity-0');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ==========================================
// 1. TALKHOP MODE MANAGEMENT & WIDGET MOUNTING
// ==========================================
function stopLocalMedia() {
  if (localStream) {
    try {
      localStream.getTracks().forEach(track => {
        track.stop();
        console.debug('[Media] Local track stopped:', track.kind);
      });
    } catch (e) {
      console.warn('[Media] Error stopping local tracks:', e);
    }
    localStream = null;
  }
  const localVid = document.getElementById('localVideo');
  if (localVid) {
    localVid.srcObject = null;
  }
  const localPlaceholder = document.getElementById('localVideoPlaceholder');
  if (localPlaceholder) {
    localPlaceholder.classList.remove('hidden');
    localPlaceholder.style.display = 'flex';
  }
  isAudioMuted = false;
  isVideoDisabled = false;
}

function mountSharedWidgets(mode) {
  const filterToolbar = document.getElementById('filterToolbar');
  const chatAside = document.getElementById('chatAside');
  const actionControlsBar = document.getElementById('actionControlsBar');
  const sharedPool = document.getElementById('sharedWidgetsPool');
  const filterSlotShared = document.getElementById('filterSlotShared');

  // Filter toolbar permanently resides in the shared top toolbar directly below header
  if (filterToolbar && filterSlotShared && filterToolbar.parentElement !== filterSlotShared) {
    filterSlotShared.appendChild(filterToolbar);
  }

  if (mode === 'text') {
    const chatSlot = document.getElementById('chatAsideSlotText');
    const controlsSlot = document.getElementById('controlsSlotText');
    if (chatSlot && chatAside) chatSlot.appendChild(chatAside);
    if (controlsSlot && actionControlsBar) controlsSlot.appendChild(actionControlsBar);
  } else {
    // In Video mode: action controls mount in the dedicated action row below video viewports
    const controlsSlot = document.getElementById('controlsSlotVideo');
    if (controlsSlot && actionControlsBar) controlsSlot.appendChild(actionControlsBar);
    // In Video mode: chat is completely removed from the layout
    if (chatAside && sharedPool && chatAside.parentElement !== sharedPool) {
      sharedPool.appendChild(chatAside);
    }
  }
}

function selectAppMode(mode, autoSearch = false) {
  currentAppMode = (mode === 'video') ? 'video' : 'text';
  document.body.setAttribute('data-mode', currentAppMode);
  localStorage.setItem('talkhop_selected_mode', currentAppMode);

  const chatView = document.getElementById('chatModeView');
  const videoView = document.getElementById('videoModeView');
  const chatTab = document.getElementById('switchModeChatBtn');
  const videoTab = document.getElementById('switchModeVideoBtn');

  if (currentAppMode === 'text') {
    if (chatView) {
      chatView.classList.remove('hidden');
      chatView.style.display = '';
    }
    if (videoView) {
      videoView.classList.add('hidden');
      videoView.style.display = 'none';
    }
    if (chatTab) {
      chatTab.setAttribute('aria-selected', 'true');
      chatTab.className = 'relative z-10 flex-1 py-1.5 px-3 rounded-full text-xs font-extrabold flex items-center justify-center gap-1.5 transition-colors duration-200 text-white cursor-pointer select-none';
    }
    if (videoTab) {
      videoTab.setAttribute('aria-selected', 'false');
      videoTab.className = 'relative z-10 flex-1 py-1.5 px-3 rounded-full text-xs font-extrabold flex items-center justify-center gap-1.5 transition-colors duration-200 text-zinc-600 dark:text-slate-400 hover:text-zinc-900 dark:hover:text-white cursor-pointer select-none';
    }
    mountSharedWidgets('text');
    stopLocalMedia();
    teardownPeerConnection(false);
    stopNsfwScanner();
  } else {
    if (videoView) {
      videoView.classList.remove('hidden');
      videoView.style.display = '';
    }
    if (chatView) {
      chatView.classList.add('hidden');
      chatView.style.display = 'none';
    }
    if (videoTab) {
      videoTab.setAttribute('aria-selected', 'true');
      videoTab.className = 'relative z-10 flex-1 py-1.5 px-3 rounded-full text-xs font-extrabold flex items-center justify-center gap-1.5 transition-colors duration-200 text-white cursor-pointer select-none';
    }
    if (chatTab) {
      chatTab.setAttribute('aria-selected', 'false');
      chatTab.className = 'relative z-10 flex-1 py-1.5 px-3 rounded-full text-xs font-extrabold flex items-center justify-center gap-1.5 transition-colors duration-200 text-zinc-600 dark:text-slate-400 hover:text-zinc-900 dark:hover:text-white cursor-pointer select-none';
    }
    mountSharedWidgets('video');
  }

  if (autoSearch) {
    if (currentAppMode === 'video') {
      initLocalMedia().then(() => {
        startSearching();
      }).catch(err => {
        console.warn('[Mode] Media init error:', err);
      });
    } else {
      startSearching();
    }
  }
}

function showModeSelectionModal() {
  const modal = document.getElementById('modeSelectionModal');
  if (modal) {
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
  }
}

function hideModeSelectionModal() {
  const modal = document.getElementById('modeSelectionModal');
  if (modal) {
    modal.classList.add('hidden');
    modal.style.display = 'none';
  }
}

// ==========================================
// 2. AGE GATE INITIALIZATION
// ==========================================
function initAgeGate() {
  const ageGateModal = document.getElementById('ageGateModal');
  const enterAgeGateBtn = document.getElementById('enterAgeGateBtn');
  const exitAgeGateBtn = document.getElementById('exitAgeGateBtn');
  const ageConfirmCheckbox = document.getElementById('ageConfirmCheckbox');
  const ageCheckContainer = document.getElementById('ageCheckContainer');
  const ageWarningText = document.getElementById('ageWarningText');
  const maleBtn = document.getElementById('ageGenderMaleBtn');
  const femaleBtn = document.getElementById('ageGenderFemaleBtn');

  if (!ageGateModal || !enterAgeGateBtn) {
    console.warn('[AgeGate] Age Gate elements not found.');
    return;
  }

  // Restore stored gender preference or default to male
  const savedGender = localStorage.getItem('talkhop_my_gender') || localStorage.getItem('vybrant_my_gender') || userPreferences.myGender || 'male';
  let chosenGender = savedGender;

  function updateAgeGenderUI(gender) {
    chosenGender = gender;
    userPreferences.myGender = gender;
    localStorage.setItem('talkhop_my_gender', gender);
    localStorage.setItem('vybrant_my_gender', gender);

    if (maleBtn && femaleBtn) {
      if (gender === 'male') {
        maleBtn.className = 'age-gate-gender-btn py-3 px-4 rounded-2xl border-2 font-bold text-sm flex items-center justify-center space-x-2 transition-all cursor-pointer bg-purple-50 dark:bg-purple-950/40 border-purple-600 text-purple-700 dark:text-purple-300 ring-2 ring-purple-500/20 active:scale-95 shadow-sm';
        femaleBtn.className = 'age-gate-gender-btn py-3 px-4 rounded-2xl border-2 font-bold text-sm flex items-center justify-center space-x-2 transition-all cursor-pointer bg-zinc-50 dark:bg-black/30 border-zinc-200 dark:border-white/10 text-zinc-700 dark:text-slate-300 hover:border-pink-500 hover:text-pink-500 active:scale-95';
      } else {
        femaleBtn.className = 'age-gate-gender-btn py-3 px-4 rounded-2xl border-2 font-bold text-sm flex items-center justify-center space-x-2 transition-all cursor-pointer bg-pink-50 dark:bg-pink-950/40 border-pink-500 text-pink-700 dark:text-pink-300 ring-2 ring-pink-500/20 active:scale-95 shadow-sm';
        maleBtn.className = 'age-gate-gender-btn py-3 px-4 rounded-2xl border-2 font-bold text-sm flex items-center justify-center space-x-2 transition-all cursor-pointer bg-zinc-50 dark:bg-black/30 border-zinc-200 dark:border-white/10 text-zinc-700 dark:text-slate-300 hover:border-purple-500 hover:text-purple-500 active:scale-95';
      }
    }

    // Sync with in-app gender buttons
    const myM = document.getElementById('myGenderMale');
    const myF = document.getElementById('myGenderFemale');
    if (myM && myF) {
      if (gender === 'male') {
        myM.className = 'px-2.5 py-0.5 rounded-lg text-xs font-semibold bg-purple-600 text-white transition-all shadow-xs';
        myF.className = 'px-2.5 py-0.5 rounded-lg text-xs font-semibold text-zinc-600 dark:text-slate-300 hover:text-zinc-900 dark:hover:text-white transition-all';
      } else {
        myF.className = 'px-2.5 py-0.5 rounded-lg text-xs font-semibold bg-gradient-to-r from-purple-600 to-pink-500 text-white transition-all shadow-xs';
        myM.className = 'px-2.5 py-0.5 rounded-lg text-xs font-semibold text-zinc-600 dark:text-slate-300 hover:text-zinc-900 dark:hover:text-white transition-all';
      }
    }
  }

  if (maleBtn) maleBtn.addEventListener('click', () => updateAgeGenderUI('male'));
  if (femaleBtn) femaleBtn.addEventListener('click', () => updateAgeGenderUI('female'));
  updateAgeGenderUI(chosenGender);

  // Browser-aware exit handler
  if (exitAgeGateBtn) {
    exitAgeGateBtn.addEventListener('click', (e) => {
      e.preventDefault();
      handleExitSite();
    });
  }

  // Check if previously verified in sessionStorage
  const isVerified = sessionStorage.getItem('talkhop_age_verified') || sessionStorage.getItem('vybrant_age_verified') || sessionStorage.getItem('blip_age_verified');
  if (isVerified === 'true') {
    ageGateModal.style.display = 'none';
    initSocketConnection();
    const savedMode = localStorage.getItem('talkhop_selected_mode');
    if (!savedMode) {
      selectAppMode('text');
      showModeSelectionModal();
    } else {
      selectAppMode(savedMode);
    }
    return;
  }

  // Ensure modal is visible and interactive
  ageGateModal.style.display = 'flex';
  ageGateModal.style.pointerEvents = 'auto';

  if (ageConfirmCheckbox) {
    ageConfirmCheckbox.addEventListener('change', () => {
      if (ageConfirmCheckbox.checked) {
        if (ageWarningText) ageWarningText.classList.add('hidden');
        if (ageCheckContainer) {
          ageCheckContainer.classList.remove('shake-warning', 'border-rose-500/50', 'bg-rose-500/10');
        }
      }
    });
  }

  enterAgeGateBtn.addEventListener('click', (e) => {
    e.preventDefault();

    if (!ageConfirmCheckbox || !ageConfirmCheckbox.checked) {
      if (ageWarningText) ageWarningText.classList.remove('hidden');
      if (ageCheckContainer) {
        ageCheckContainer.classList.remove('shake-warning');
        void ageCheckContainer.offsetWidth; // Restart CSS animation
        ageCheckContainer.classList.add('shake-warning');
      }
      showToast('⚠️ Please check "I am 18+" to enter TalkHop.', 'warning', 3000);
      return;
    }

    sessionStorage.setItem('talkhop_age_verified', 'true');
    sessionStorage.setItem('vybrant_age_verified', 'true');
    localStorage.setItem('talkhop_my_gender', chosenGender);
    localStorage.setItem('vybrant_my_gender', chosenGender);
    ageGateModal.style.display = 'none';
    initSocketConnection();
    if (socket) {
      socket.emit('update-preferences', userPreferences);
    }
    selectAppMode('text');
    showModeSelectionModal();
  });
}

// Exit site to current browser's homepage/start page instead of just Google
function handleExitSite() {
  if (window.history.length > 1 && document.referrer && !document.referrer.includes(window.location.host)) {
    window.history.back();
    return;
  }
  const ua = navigator.userAgent.toLowerCase();
  let exitUrl = 'https://www.google.com';
  if (ua.includes('edg/') || ua.includes('edge/')) {
    exitUrl = 'https://www.msn.com';
  } else if (ua.includes('firefox')) {
    exitUrl = 'https://start.mozilla.org';
  } else if (ua.includes('brave')) {
    exitUrl = 'https://search.brave.com';
  } else if (ua.includes('safari') && !ua.includes('chrome')) {
    exitUrl = 'https://www.apple.com';
  } else if (ua.includes('opera') || ua.includes('opr/')) {
    exitUrl = 'https://www.opera.com';
  } else {
    exitUrl = 'https://www.google.com';
  }
  try {
    window.location.replace(exitUrl);
  } catch {
    window.location.href = exitUrl;
  }
}

// Show Banned IP Screen (24-Hour ban)
function showBannedScreen(reason) {
  const bannedModal = document.getElementById('bannedModal');
  const bannedReasonText = document.getElementById('bannedReasonText');
  if (bannedModal) {
    if (reason && bannedReasonText) {
      bannedReasonText.textContent = reason;
    }
    bannedModal.classList.remove('hidden');
    bannedModal.style.display = 'flex';
  }
}

// ==========================================
// 2. SMOOTH CAMERA & MICROPHONE INITIALIZATION
// ==========================================
async function initLocalMedia() {
  if (isMediaRequesting) return; // Guard against concurrent spam
  isMediaRequesting = true;

  const localVid = document.getElementById('localVideo');
  const cameraPermissionNotice = document.getElementById('cameraPermissionNotice');
  const grantPermissionBtn = document.getElementById('grantPermissionBtn');
  const cameraNoticeTitle = document.getElementById('cameraNoticeTitle');
  const cameraNoticeDesc = document.getElementById('cameraNoticeDesc');
  const audioOnlyPlaceholder = document.getElementById('audioOnlyPlaceholder');
  const localVideoPlaceholder = document.getElementById('localVideoPlaceholder');
  const localBadgeText = document.getElementById('localBadgeText');
  const localCamBtn = document.getElementById('localCamBtn');
  const flipCamBtn = document.getElementById('flipCamBtn');

  if (grantPermissionBtn) {
    grantPermissionBtn.disabled = true;
    grantPermissionBtn.innerHTML = `<span>⏳ Requesting Access...</span>`;
  }

  isAudioOnly = false;

  // Query hardware device presence via enumerateDevices if supported
  let videoDevices = [];
  let audioDevices = [];
  try {
    if (navigator.mediaDevices && typeof navigator.mediaDevices.enumerateDevices === 'function') {
      const devices = await navigator.mediaDevices.enumerateDevices();
      videoDevices = devices.filter(d => d.kind === 'videoinput');
      audioDevices = devices.filter(d => d.kind === 'audioinput');
      console.log(`[Media] Detected devices: ${videoDevices.length} camera(s), ${audioDevices.length} microphone(s)`);
    }
  } catch (enumErr) {
    console.debug('[Media] enumerateDevices notice:', enumErr);
  }

  try {
    // 1. Primary Attempt: Flexible ideal constraints without rigid min values that trigger OverconstrainedError
    const primaryConstraints = {
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: currentFacingMode || 'user'
      },
      audio: PREFERRED_AUDIO_CONSTRAINTS
    };

    try {
      localStream = await navigator.mediaDevices.getUserMedia(primaryConstraints);
      logAudioTrackSettings(localStream);
      const vidTrack = localStream.getVideoTracks()[0];
      if (vidTrack && typeof vidTrack.getSettings === 'function') {
        const vidSettings = vidTrack.getSettings();
        if (vidSettings?.deviceId) currentVideoDeviceId = vidSettings.deviceId;
      }
    } catch (camErr) {
      console.warn('[Media] Primary constraints failed:', camErr.name, camErr.message);

      // If OverconstrainedError or constraint issue, try basic relaxed video before giving up!
      if (camErr.name === 'OverconstrainedError' || (camErr.message && /constraint|resolution|facing/i.test(camErr.message))) {
        console.log('[Media] Retrying with basic relaxed video constraints...');
        try {
          localStream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: PREFERRED_AUDIO_CONSTRAINTS
          });
        } catch (basicErr) {
          console.warn('[Media] Basic video failed:', basicErr.name);
          throw basicErr;
        }
      } else {
        throw camErr;
      }
    }

    // Camera + Audio succeeded!
    isAudioOnly = false;
    if (localVid) {
      localVid.srcObject = localStream;
      localVid.play().catch(() => {});
    }

    if (cameraPermissionNotice) {
      cameraPermissionNotice.classList.add('hidden');
      cameraPermissionNotice.style.display = 'none';
    }
    if (audioOnlyPlaceholder) {
      audioOnlyPlaceholder.classList.add('hidden');
      audioOnlyPlaceholder.style.display = 'none';
    }
    if (localVideoPlaceholder) {
      localVideoPlaceholder.classList.add('hidden');
      localVideoPlaceholder.style.display = 'none';
    }
    if (localBadgeText) {
      localBadgeText.textContent = 'You';
    }
    if (localCamBtn) {
      localCamBtn.title = 'Turn Camera On/Off';
      localCamBtn.classList.remove('opacity-60');
    }
    if (flipCamBtn) {
      flipCamBtn.title = 'Flip Camera / Mirror View';
      flipCamBtn.classList.remove('opacity-40', 'cursor-not-allowed');
    }
    if (grantPermissionBtn) {
      grantPermissionBtn.disabled = false;
      grantPermissionBtn.innerHTML = `<span>Allow Camera & Mic</span>`;
    }

    showToast('Camera and microphone connected! 📹', 'success', 2500);
    initNsfwShield();
    initSocketConnection();

  } catch (err) {
    console.warn('[Media] Video acquisition error:', err.name || err, err.message);

    const isNotFoundError = err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError' || (videoDevices.length === 0 && err.name !== 'NotAllowedError');
    const isLockedError = err.name === 'NotReadableError' || err.name === 'TrackStartError';

    // If hardware genuinely has no camera or camera is locked by another app, try Audio-Only fallback
    if (isNotFoundError || isLockedError) {
      console.log(`[Media] Fallback to Audio-Only mode (${err.name})...`);
      try {
        localStream = await navigator.mediaDevices.getUserMedia({
          video: false,
          audio: PREFERRED_AUDIO_CONSTRAINTS
        });
      } catch (audioErr) {
        try {
          localStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
        } catch (basicAudioErr) {
          console.warn('[Media] Audio-only fallback also failed:', basicAudioErr.name);
          localStream = null;
        }
      }

      if (localStream && localStream.getAudioTracks().length > 0) {
        logAudioTrackSettings(localStream);
        isAudioOnly = true;

        if (localVid) {
          localVid.srcObject = localStream;
        }
        if (cameraPermissionNotice) {
          cameraPermissionNotice.classList.add('hidden');
          cameraPermissionNotice.style.display = 'none';
        }
        if (localVideoPlaceholder) {
          localVideoPlaceholder.classList.add('hidden');
          localVideoPlaceholder.style.display = 'none';
        }
        if (audioOnlyPlaceholder) {
          audioOnlyPlaceholder.classList.remove('hidden');
          audioOnlyPlaceholder.style.display = 'flex';
        }
        if (localBadgeText) {
          localBadgeText.textContent = 'You (Voice Only)';
        }
        if (localCamBtn) {
          localCamBtn.title = isLockedError ? 'Camera in use by another app' : 'No Webcam Detected (Audio Only)';
          localCamBtn.classList.add('opacity-60');
        }
        if (flipCamBtn) {
          flipCamBtn.title = 'Camera Flip Unavailable in Audio Only';
          flipCamBtn.classList.add('opacity-40', 'cursor-not-allowed');
        }

        const msg = isLockedError
          ? '🎙️ Camera in use by another application. Audio-Only voice active!'
          : '🎙️ No webcam hardware detected. Audio-Only voice active!';
        showToast(msg, 'info', 3500);
        initSocketConnection();
        return;
      }
    }

    // Permission denied or total device failure
    if (cameraPermissionNotice) {
      cameraPermissionNotice.classList.remove('hidden');
      cameraPermissionNotice.style.display = 'flex';
    }
    if (audioOnlyPlaceholder) {
      audioOnlyPlaceholder.classList.add('hidden');
      audioOnlyPlaceholder.style.display = 'none';
    }
    if (grantPermissionBtn) {
      grantPermissionBtn.disabled = false;
      grantPermissionBtn.innerHTML = `<span>Allow Camera & Mic</span>`;
    }

    let userFriendlyError = 'Camera & microphone access required to start video call.';
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      userFriendlyError = 'Camera & mic permissions were denied. Please click the lock icon in your browser address bar to allow.';
      if (cameraNoticeTitle) cameraNoticeTitle.textContent = 'Camera & Mic Access Blocked';
      if (cameraNoticeDesc) cameraNoticeDesc.textContent = 'Permission was dismissed or blocked. Please allow camera and microphone in browser settings.';
    } else if (isNotFoundError) {
      userFriendlyError = 'No microphone or webcam detected on your device.';
      if (cameraNoticeTitle) cameraNoticeTitle.textContent = 'No Devices Found';
      if (cameraNoticeDesc) cameraNoticeDesc.textContent = 'Please plug in a webcam or microphone headset to continue.';
    } else {
      if (cameraNoticeTitle) cameraNoticeTitle.textContent = 'Device Error';
      if (cameraNoticeDesc) cameraNoticeDesc.textContent = `Could not access media devices (${err.name || 'Unknown'}).`;
    }

    showToast(`⚠️ ${userFriendlyError}`, 'warning', 4500);
    initSocketConnection();
  } finally {
    isMediaRequesting = false;
  }
}

function toggleAudio() {
  if (!localStream) return;
  const audioTrack = localStream.getAudioTracks()[0];
  const localMicIcon = document.getElementById('localMicIcon');
  const localMicBtn = document.getElementById('localMicBtn');

  if (audioTrack) {
    isAudioMuted = !isAudioMuted;
    audioTrack.enabled = !isAudioMuted;

    const micSvgActive = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"/>`;
    const micSvgMuted = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2"/>`;

    const iconContent = isAudioMuted ? micSvgMuted : micSvgActive;
    if (localMicIcon) localMicIcon.innerHTML = iconContent;

    if (localMicBtn) {
      localMicBtn.classList.toggle('bg-rose-600/80', isAudioMuted);
      localMicBtn.classList.toggle('hover:bg-rose-500', isAudioMuted);
    }

    showToast(isAudioMuted ? 'Microphone Muted 🔇' : 'Microphone Active 🎙️', isAudioMuted ? 'warning' : 'info', 2000);
  } else {
    showToast('⚠️ No microphone found', 'warning', 2500);
  }
}

function toggleVideo() {
  if (!localStream) return;
  const videoTrack = localStream.getVideoTracks()[0];
  const localCamIcon = document.getElementById('localCamIcon');
  const localCamBtn = document.getElementById('localCamBtn');

  if (!videoTrack) {
    showToast('⚠️ No webcam detected (Audio-Only mode active)', 'warning', 2500);
    return;
  }

  isVideoDisabled = !isVideoDisabled;
  videoTrack.enabled = !isVideoDisabled;

  const camSvgActive = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/>`;
  const camSvgDisabled = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"/>`;

  const iconContent = isVideoDisabled ? camSvgDisabled : camSvgActive;
  if (localCamIcon) localCamIcon.innerHTML = iconContent;

  if (localCamBtn) {
    localCamBtn.classList.toggle('bg-rose-600/80', isVideoDisabled);
    localCamBtn.classList.toggle('hover:bg-rose-500', isVideoDisabled);
  }

  showToast(isVideoDisabled ? 'Camera Disabled 🚫' : 'Camera Enabled 📹', isVideoDisabled ? 'warning' : 'info', 2000);
}

// Universal Camera Flip Engine: Cycles multi-camera hardware (Front/Rear/USB) or toggles horizontal mirror on single-cam devices
async function flipCamera() {
  if (isFlippingCamera) return;

  if (!localStream) {
    showToast('⚠️ Camera not initialized yet', 'warning', 2000);
    return;
  }

  const currentVideoTrack = localStream.getVideoTracks()[0];
  if (!currentVideoTrack || isAudioOnly) {
    showToast('⚠️ No webcam active (Voice-Only Mode)', 'warning', 2500);
    return;
  }

  isFlippingCamera = true;
  const flipBtn = document.getElementById('flipCamBtn');
  const flipIcon = document.getElementById('flipCamIcon');
  const localVid = document.getElementById('localVideo');

  if (flipBtn) flipBtn.classList.add('bg-purple-600/40');
  if (flipIcon) flipIcon.classList.add('rotate-180');

  try {
    // 1. Detect connected videoinput devices
    let videoDevices = [];
    if (navigator.mediaDevices && typeof navigator.mediaDevices.enumerateDevices === 'function') {
      try {
        const allDevices = await navigator.mediaDevices.enumerateDevices();
        videoDevices = allDevices.filter(d => d.kind === 'videoinput');
      } catch (enumErr) {
        console.warn('[Camera] Device enumeration warning:', enumErr.message);
      }
    }

    // SCENARIO 1: Multiple Cameras Available (Mobile Front/Back or Multiple Desktop Webcams)
    if (videoDevices.length > 1) {
      const activeTrackSettings = typeof currentVideoTrack.getSettings === 'function' ? currentVideoTrack.getSettings() : {};
      const activeDeviceId = activeTrackSettings.deviceId || currentVideoDeviceId;

      let nextDevice = null;
      if (activeDeviceId) {
        const currentIndex = videoDevices.findIndex(d => d.deviceId === activeDeviceId);
        if (currentIndex !== -1) {
          nextDevice = videoDevices[(currentIndex + 1) % videoDevices.length];
        }
      }
      if (!nextDevice) {
        nextDevice = videoDevices.find(d => d.deviceId !== activeDeviceId) || videoDevices[0];
      }

      const targetFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';

      // Crucial: Release previous track hardware lock so Android HAL / Windows USB driver doesn't throw NotReadableError
      localStream.removeTrack(currentVideoTrack);
      currentVideoTrack.stop();

      let newStream = null;

      // Method A: Switch directly by hardware deviceId (most robust for multi-cam & USB devices)
      if (nextDevice && nextDevice.deviceId) {
        try {
          newStream = await navigator.mediaDevices.getUserMedia({
            video: {
              deviceId: { exact: nextDevice.deviceId },
              width: { ideal: 1280 },
              height: { ideal: 720 }
            },
            audio: false
          });
        } catch (devErr) {
          console.warn('[Camera] Exact deviceId request failed, falling back to facingMode:', devErr.name);
        }
      }

      // Method B: Switch by target facingMode (for mobile browsers where facingMode is mapped)
      if (!newStream) {
        try {
          newStream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: { ideal: targetFacingMode },
              width: { ideal: 1280 },
              height: { ideal: 720 }
            },
            audio: false
          });
        } catch (facingErr) {
          console.warn('[Camera] facingMode ideal request failed, falling back to generic video:', facingErr.name);
          newStream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false
          });
        }
      }

      const newVideoTrack = newStream.getVideoTracks()[0];
      if (!newVideoTrack) throw new Error('No video track available');

      // Preserve current video enabled / disabled mute state
      newVideoTrack.enabled = !isVideoDisabled;

      // Add new track to existing localStream
      localStream.addTrack(newVideoTrack);

      // Track active device settings
      const newSettings = typeof newVideoTrack.getSettings === 'function' ? newVideoTrack.getSettings() : {};
      currentVideoDeviceId = newSettings.deviceId || nextDevice?.deviceId || null;
      currentFacingMode = targetFacingMode;

      // Seamlessly update WebRTC sender track without breaking call
      if (peerConnection) {
        const senders = peerConnection.getSenders();
        const videoSender = senders.find(s => s.track && s.track.kind === 'video');
        if (videoSender) {
          await videoSender.replaceTrack(newVideoTrack);
          console.log('[WebRTC] Swapped video track on active peer connection.');
        }
      }

      // Update local preview and mirror orientation
      if (localVid) {
        localVid.srcObject = localStream;
        localVid.play().catch(() => {});

        if (currentFacingMode === 'environment') {
          localVid.style.transform = 'scaleX(1)';
          isCameraMirrored = false;
        } else {
          localVid.style.transform = 'scaleX(-1)';
          isCameraMirrored = true;
        }
      }

      const friendlyName = nextDevice?.label || (currentFacingMode === 'environment' ? 'Rear Camera 📷' : 'Front Camera 🤳');
      showToast(`Switched: ${friendlyName}`, 'success', 2200);

    } else {
      // SCENARIO 2: Single Camera Device (Single Laptop Webcam, PC Webcam, or Single Mobile Lens)
      // Flips the horizontal perspective (Selfie Mirror vs Natural True View)
      isCameraMirrored = !isCameraMirrored;
      currentFacingMode = isCameraMirrored ? 'user' : 'environment';

      if (localVid) {
        localVid.style.transform = isCameraMirrored ? 'scaleX(-1)' : 'scaleX(1)';
      }

      const mirrorToast = isCameraMirrored
        ? 'Camera Mirrored 🤳 (Selfie View)'
        : 'Camera Unmirrored 📷 (True View)';
      showToast(mirrorToast, 'info', 2200);
    }

  } catch (err) {
    console.warn('[Camera] Flip camera error:', err.name || err.message);

    // Self-healing recovery: If track was stopped and error occurred, re-open default camera
    if (localStream.getVideoTracks().length === 0) {
      try {
        const recoverStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        const recoverTrack = recoverStream.getVideoTracks()[0];
        if (recoverTrack) {
          recoverTrack.enabled = !isVideoDisabled;
          localStream.addTrack(recoverTrack);
          if (peerConnection) {
            const senders = peerConnection.getSenders();
            const videoSender = senders.find(s => s.track && s.track.kind === 'video');
            if (videoSender) await videoSender.replaceTrack(recoverTrack);
          }
          if (localVid) {
            localVid.srcObject = localStream;
            localVid.play().catch(() => {});
          }
        }
      } catch (recErr) {
        console.error('[Camera] Recovery stream failed:', recErr);
      }
    }

    showToast('⚠️ Could not switch camera source', 'warning', 2500);
  } finally {
    if (flipIcon) {
      setTimeout(() => flipIcon.classList.remove('rotate-180'), 350);
    }
    if (flipBtn) flipBtn.classList.remove('bg-purple-600/40');
    isFlippingCamera = false;
  }
}

// ==========================================
// 3. BROWSER-SIDE NSFW SHIELD (nsfwjs + TensorFlow.js)
// ==========================================
async function initNsfwShield() {
  const aiShieldStatusText = document.getElementById('aiShieldStatusText');
  const aiShieldBadge = document.getElementById('aiShieldBadge');

  try {
    if (typeof nsfwjs !== 'undefined' && typeof tf !== 'undefined') {
      if (aiShieldStatusText) aiShieldStatusText.textContent = 'AI Shield Loading...';

      nsfwModel = await nsfwjs.load();
      console.log('[AI Safety] NSFWJS model loaded successfully!');

      if (aiShieldStatusText) aiShieldStatusText.textContent = 'AI Shield Active';
      if (aiShieldBadge) aiShieldBadge.classList.remove('hidden');
    }
  } catch (err) {
    console.warn('[AI Safety] Could not initialize NSFWJS model:', err);
    if (aiShieldStatusText) aiShieldStatusText.textContent = 'AI Shield Standby';
  }
}

function startNsfwScanner() {
  stopNsfwScanner();
  if (!nsfwModel) return;
  const localVid = document.getElementById('localVideo');

  nsfwScannerInterval = setInterval(async () => {
    if (!nsfwModel || !localVid || localVid.readyState < 2 || isNsfwScanning) {
      return;
    }

    try {
      isNsfwScanning = true;
      // Yield to main event loop so Socket.IO ping/pong heartbeats and audio buffers are never starved
      await new Promise(resolve => setTimeout(resolve, 0));
      const predictions = await nsfwModel.classify(localVid, 1);

      for (const pred of predictions) {
        if (pred.className === 'Porn' || pred.className === 'Hentai') {
          if (pred.probability >= NSFW_PROBABILITY_THRESHOLD) {
            console.warn(`[AI Safety] NSFW Violation detected! ${pred.className}: ${(pred.probability * 100).toFixed(1)}%`);
            handleNsfwViolation(pred.className, pred.probability);
            break;
          }
        }
      }
    } catch (e) {
      // Ignore frame read hiccup
    } finally {
      isNsfwScanning = false;
    }
  }, 3000); // 3000ms to maintain safety while keeping main thread and Socket.IO heartbeat responsive
}

function stopNsfwScanner() {
  if (nsfwScannerInterval) {
    clearInterval(nsfwScannerInterval);
    nsfwScannerInterval = null;
  }
}

function handleNsfwViolation(className, probability) {
  stopNsfwScanner();

  const localVid = document.getElementById('localVideo');
  const remoteVid = document.getElementById('remoteVideo');
  if (localVid) localVid.classList.add('safety-blurred');
  if (remoteVid) remoteVid.classList.add('safety-blurred');

  const reasonText = `AI Shield Violation: Inappropriate/NSFW content detected (${className} ${Math.round(probability * 100)}%)`;
  if (socket) {
    socket.emit('nsfw_violation', { reason: reasonText });
  }

  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
  }

  showBannedScreen('Inappropriate/NSFW content was detected on your video feed. Your IP has been banned for 24 hours pursuant to our Community Guidelines.');

  setTimeout(() => {
    if (socket) socket.disconnect();
  }, 500);
}

// ==========================================
// 4. FIRST 3-SECOND ANTI-FLASH BLUR SHIELD
// ==========================================
function startAntiFlashShield() {
  const remoteVid = document.getElementById('remoteVideo');
  const antiFlashOverlay = document.getElementById('antiFlashOverlay');
  const antiFlashCountdown = document.getElementById('antiFlashCountdown');
  const antiFlashProgressBar = document.getElementById('antiFlashProgressBar');

  if (antiFlashInterval) {
    clearInterval(antiFlashInterval);
    antiFlashInterval = null;
  }

  if (remoteVid) {
    remoteVid.classList.remove('safety-unblurred');
    remoteVid.classList.add('safety-blurred');
  }
  if (antiFlashOverlay) antiFlashOverlay.classList.remove('hidden');
  if (antiFlashCountdown) antiFlashCountdown.textContent = '3s';
  if (antiFlashProgressBar) antiFlashProgressBar.style.width = '100%';

  let remainingMs = 3000;
  const stepMs = 100;

  antiFlashInterval = setInterval(() => {
    remainingMs -= stepMs;
    const progressPercent = Math.max(0, (remainingMs / 3000) * 100);
    if (antiFlashProgressBar) antiFlashProgressBar.style.width = `${progressPercent}%`;

    const secondsLeft = Math.ceil(remainingMs / 1000);
    if (antiFlashCountdown) antiFlashCountdown.textContent = `${secondsLeft}s`;

    if (remainingMs <= 0) {
      revealStrangerVideo();
    }
  }, stepMs);
}

function revealStrangerVideo() {
  const remoteVid = document.getElementById('remoteVideo');
  const antiFlashOverlay = document.getElementById('antiFlashOverlay');

  if (antiFlashInterval) {
    clearInterval(antiFlashInterval);
    antiFlashInterval = null;
  }

  if (antiFlashOverlay) antiFlashOverlay.classList.add('opacity-0');
  if (remoteVid) {
    remoteVid.classList.remove('safety-blurred');
    remoteVid.classList.add('safety-unblurred');
  }

  setTimeout(() => {
    if (antiFlashOverlay) {
      antiFlashOverlay.classList.add('hidden');
      antiFlashOverlay.classList.remove('opacity-0');
    }
  }, 400);
}

// Helper: Authoritative Visitor / Session Identification (persisted per device/browser)
function getOrCreateVisitorId() {
  try {
    let vid = localStorage.getItem('talkhop_visitor_id');
    if (!vid) {
      vid = sessionStorage.getItem('talkhop_visitor_id') || sessionStorage.getItem('vybrant_visitor_id');
    }
    if (!vid) {
      vid = 'vis_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 9);
    }
    localStorage.setItem('talkhop_visitor_id', vid);
    sessionStorage.setItem('talkhop_visitor_id', vid);
    sessionStorage.setItem('vybrant_visitor_id', vid);
    return vid;
  } catch (e) {
    if (!window.__talkhop_visitor_id) {
      window.__talkhop_visitor_id = 'vis_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 9);
    }
    return window.__talkhop_visitor_id;
  }
}

// ==========================================
// SOCKET.IO SIGNALING & MATCHMAKING
// ==========================================
function initSocketConnection() {
  if (socket) return;

  const visitorId = getOrCreateVisitorId();

  socket = io({
    auth: { visitorId },
    query: { visitorId },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 20000
  });

  // Cross-direction media quality hint from remote peer
  socket.on('peer-media-quality-hint', (data) => {
    console.log('[Adaptive Quality] Received downlink congestion hint from peer:', data);
    if (data && typeof data.targetTier === 'number') {
      const requestedTier = data.targetTier;
      if (requestedTier >= 1 && requestedTier > activeVideoTier && !isAdaptiveVideoPaused) {
        applyLowBandwidthVideoTier(requestedTier);
      } else if (requestedTier === 0 && activeVideoTier > 0 && !isAdaptiveVideoPaused) {
        applyLowBandwidthVideoTier(0);
      }
    }
  });

  socket.on('connect', () => {
    console.log('[Socket] Connected with ID:', socket.id, 'Visitor ID:', visitorId);
    if (vipCode) {
      activateVipCode(vipCode, false);
    }

    // If we have an active session with an alive P2P WebRTC connection, recover it!
    if (currentSessionId && currentPartnerId && peerConnection &&
        (peerConnection.connectionState === 'connected' || peerConnection.iceConnectionState === 'connected')) {
      console.log(`[Socket] Attempting session recovery for session ${currentSessionId}...`);
      socket.emit('reconnect-session', {
        sessionId: currentSessionId,
        lastPartnerId: currentPartnerId
      }, (resp) => {
        if (resp && resp.success) {
          console.log('[Socket] Session re-attached to signaling successfully.');
          currentPartnerId = resp.partnerId;
          setCallState(ConnectionState.CONNECTED);
        } else {
          console.warn('[Socket] Session could not be recovered on server:', resp?.message);
        }
      });
      return;
    }

    if (isSearching && !peerConnection) {
      startSearching();
    }
  });

  socket.on('connect_error', (err) => {
    console.warn('[Socket] Connection error:', err.message);
    if (err && err.message && err.message.includes('BANNED')) {
      showBannedScreen(err.message);
    }
  });

  socket.on('banned', (data) => {
    const reason = (data && data.reason) || 'Your IP has been banned for 24 hours due to community violations.';
    showBannedScreen(reason);
    if (localStream) localStream.getTracks().forEach(t => t.stop());
    teardownPeerConnection();
  });

  socket.on('online-count', (data) => {
    const countEl = document.getElementById('onlineCountText');
    if (countEl && data && typeof data.count === 'number') {
      const count = Math.max(1, data.count);
      countEl.textContent = `${count.toLocaleString()} Online`;
    }
  });

  socket.on('detected-country', (data) => {
    if (data && data.country) {
      userPreferences.myCountry = data.country;
    }
  });

  socket.on('sponsor-config', (data) => {
    if (data) {
      currentSponsorConfig = { ...currentSponsorConfig, ...data };
    }
  });

  socket.on('sponsor-update', (data) => {
    if (data) {
      currentSponsorConfig = { ...currentSponsorConfig, ...data };
      showToast('📢 Sponsored Partner update broadcasted!', 'info', 2500);
    }
  });

  socket.on('waiting', (data) => {
    setCallState(ConnectionState.SEARCHING, { message: data?.message });
    setSearchingUI(true);
  });

  socket.on('match-found', async (data) => {
    console.log('[Match] Paired with stranger:', data);
    currentPartnerId = data.partnerId;
    currentSessionId = data.sessionId || `sess_${Date.now()}`;
    isInitiator = Boolean(data.initiator);
    const sessionMode = (data && data.mode === 'text') ? 'text' : 'video';
    matchCount++;

    setCallState(ConnectionState.CONNECTING);
    setSearchingUI(false);
    clearChatMessages();

    if (sessionMode === 'text') {
      selectAppMode('text');
      setCallState(ConnectionState.CONNECTED);
    } else {
      selectAppMode('video');
      await setupPeerConnection();
      startAntiFlashShield();
      startNsfwScanner();

      if (isInitiator) {
        setupDataChannelAsInitiator();
        createAndSendOffer();
      }
    }

    if (matchCount % 5 === 0 && matchCount > 0) {
      injectSponsorMessage();
    }
  });

  // Handle Stranger requested Video Call switch
  socket.on('partner-requested-video-switch', (data) => {
    console.log('[Mode Switch] Stranger requested video switch:', data);
    addVideoCallRequestInChat();
    const modal = document.getElementById('videoSwitchModal');
    if (modal) {
      modal.classList.remove('hidden');
      modal.style.display = 'flex';
    }
  });

  // Handle Video Switch Accepted by Stranger
  socket.on('video-switch-accepted', async (data) => {
    console.log('[Mode Switch] Video switch accepted:', data);
    addSystemChatMessage('🎉 Stranger accepted your Video Call request! Switching to video mode now...');
    selectAppMode('video');
    showToast('Stranger accepted video call! Initializing camera... 📹', 'success', 3000);
    try {
      await initLocalMedia();
      if (data && data.initiator) {
        await setupPeerConnection();
        setupDataChannelAsInitiator();
        createAndSendOffer();
      }
    } catch (err) {
      console.warn('[Mode Switch] Error establishing video after switch:', err);
      showToast('Could not access camera/mic. Preserving text chat.', 'warning', 3500);
      selectAppMode('text');
      socket.emit('switch-to-text');
    }
  });

  // Handle Video Switch Declined by Stranger
  socket.on('video-switch-declined', (data) => {
    console.log('[Mode Switch] Video switch declined:', data);
    addSystemChatMessage('Stranger declined the video call invitation. Staying in text chat.');
    showToast(data.message || 'Stranger declined to switch to video.', 'info', 3000);
  });

  // Handle Stranger switched back to text chat
  socket.on('switched-to-text', () => {
    console.log('[Mode Switch] Switched to text chat mode');
    selectAppMode('text');
    teardownPeerConnection(false);
    stopNsfwScanner();
    stopLocalMedia();
    showToast('Switched to text chat mode 💬', 'info', 2500);
  });

  socket.on('match-notice', (data) => {
    if (data && data.message) {
      showToast(data.message, 'info', 3000);
      const chatStatusBannerText = document.getElementById('chatStatusBannerText');
      if (chatStatusBannerText) chatStatusBannerText.textContent = data.message;
    }
  });

  socket.on('vip-expired-notice', (data) => {
    if (data && data.message) {
      showToast(data.message, 'warning', 3500);
      updateVipFilterUi(false);
    }
  });

  socket.on('offer', async (data) => {
    try {
      if (!peerConnection) await setupPeerConnection();
      await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
      drainPendingIceCandidates();

      const answer = await peerConnection.createAnswer();
      const tunedAnswer = new RTCSessionDescription({
        type: answer.type,
        sdp: tuneOpusSdp(answer.sdp)
      });
      await peerConnection.setLocalDescription(tunedAnswer);
      applyVoiceSenderBitrate(peerConnection);

      socket.emit('answer', { answer: tunedAnswer });
    } catch (err) {
      console.error('[WebRTC] Error handling offer:', err);
    }
  });

  socket.on('answer', async (data) => {
    try {
      if (peerConnection) {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
        drainPendingIceCandidates();
        applyVoiceSenderBitrate(peerConnection);
      }
    } catch (err) {
      console.error('[WebRTC] Error handling answer:', err);
    }
  });

  socket.on('ice-candidate', async (data) => {
    try {
      const candidate = new RTCIceCandidate(data.candidate);
      if (peerConnection && peerConnection.remoteDescription) {
        await peerConnection.addIceCandidate(candidate);
      } else {
        pendingIceCandidates.push(candidate);
      }
    } catch (err) {
      console.error('[WebRTC] Error adding received ICE candidate:', err);
    }
  });

  // Handle remote request for ICE restart
  socket.on('ice-restart-needed', () => {
    console.log('[WebRTC] Remote stranger requested ICE restart.');
    if (isInitiator && peerConnection) {
      createAndSendOffer(true);
    }
  });

  // Handle partner temporary network interruption (do NOT immediately terminate!)
  socket.on('partner-interrupted', (data) => {
    console.warn('[Session Recovery] Partner connection interrupted:', data);
    setCallState(ConnectionState.TEMPORARILY_INTERRUPTED, {
      message: data.message || "Stranger's connection was interrupted. Waiting for recovery..."
    });
  });

  // Handle successful session recovery
  socket.on('session-recovered', (data) => {
    console.log('[Session Recovery] Session recovered successfully:', data);
    currentPartnerId = data.partnerId;
    if (data.sessionId) currentSessionId = data.sessionId;
    setCallState(ConnectionState.CONNECTED);
    showToast('Call connection recovered! 🎉', 'success', 2500);
    startAdaptiveStatsMonitoring();
  });

  socket.on('partner-disconnected', (data) => {
    teardownPeerConnection();
    stopNsfwScanner();
    setCallState(ConnectionState.DISCONNECTED, { message: data.message || 'Stranger has disconnected.' });
    showToast(data.message || 'Stranger skipped.', 'info', 2500);

    setTimeout(() => {
      if (isSearching) {
        handleSkip();
      }
    }, 600);
  });

  socket.on('chat-message', (data) => {
    appendChatMessage('stranger', data.message);
  });

  socket.on('partner-typing', (data) => {
    showPartnerTyping(Boolean(data && data.isTyping));
  });

  socket.on('stopped', () => {
    setSearchingUI(false);
    teardownPeerConnection();
    stopNsfwScanner();
    setCallState(ConnectionState.IDLE);
    const matchText = document.getElementById('toggleMatchText');
    const matchIcon = document.getElementById('toggleMatchIcon');
    if (matchText) matchText.textContent = 'Start';
    if (matchIcon) matchIcon.textContent = '▶';
    isSearching = false;
  });

  socket.on('disconnect', (reason) => {
    console.warn(`[Socket] Disconnected from signaling server (${reason})`);
    // If WebRTC is currently streaming media P2P directly between browsers, PRESERVE IT!
    if (peerConnection && (peerConnection.connectionState === 'connected' || peerConnection.iceConnectionState === 'connected')) {
      console.log('[WebRTC] P2P Media connection is still alive despite signaling interruption. Preserving call.');
      setCallState(ConnectionState.TEMPORARILY_INTERRUPTED, {
        message: 'Signaling server reconnecting... Call continues over P2P'
      });
      showToast('Signaling interrupted — call continuing over P2P', 'info', 3000);
    } else {
      showToast('Disconnected from server. Reconnecting...', 'warning', 2500);
      teardownPeerConnection();
      stopNsfwScanner();
    }
  });
}

async function drainPendingIceCandidates() {
  while (pendingIceCandidates.length > 0) {
    const candidate = pendingIceCandidates.shift();
    try {
      await peerConnection.addIceCandidate(candidate);
    } catch (err) {
      console.error('[WebRTC] Error adding queued ICE candidate:', err);
    }
  }
}

// ==========================================
// WEBRTC PEER CONNECTION LIFECYCLE
// ==========================================
async function setupPeerConnection() {
  teardownPeerConnection(false);

  setCallState(ConnectionState.CONNECTING);
  iceRestartCount = 0;
  isAdaptiveVideoPaused = false;
  activeVideoTier = 0;

  // Query dynamic ICE server configuration from server or use resilient defaults
  let config = RTC_CONFIG;
  try {
    const res = await fetch('/api/rtc-config');
    if (res.ok) {
      const dynConfig = await res.json();
      if (dynConfig && Array.isArray(dynConfig.iceServers)) {
        config = dynConfig;
      }
    }
  } catch (e) {
    console.debug('[WebRTC] Using static RTC_CONFIG fallback');
  }

  peerConnection = new RTCPeerConnection(config);

  if (localStream) {
    localStream.getTracks().forEach((track) => {
      peerConnection.addTrack(track, localStream);
    });
    applyVoiceSenderBitrate(peerConnection);
  }

  peerConnection.ontrack = (event) => {
    const remoteVid = document.getElementById('remoteVideo');
    if (!remoteVid) return;

    if (remoteVid.srcObject !== event.streams[0]) {
      remoteVid.srcObject = event.streams[0];
      monitorRemoteAudio(event.streams[0]);

      // Autoplay handling: Explicitly play with rejection catcher for Instagram / iOS Safari
      const playPromise = remoteVid.play();
      if (playPromise !== undefined) {
        playPromise.then(() => {
          hideTapToPlayAudioPrompt();
        }).catch((err) => {
          console.warn('[Audio Playback] Autoplay blocked by browser policy:', err);
          showTapToPlayAudioPrompt();
        });
      }
    }
  };

  peerConnection.onicecandidate = (event) => {
    if (event.candidate && socket) {
      socket.emit('ice-candidate', { candidate: event.candidate });
    }
  };

  peerConnection.onconnectionstatechange = () => {
    if (!peerConnection) return;
    const state = peerConnection.connectionState;
    console.log(`[WebRTC] connectionState changed: ${state}`);

    if (state === 'connected') {
      if (iceRecoveryTimer) {
        clearTimeout(iceRecoveryTimer);
        iceRecoveryTimer = null;
      }
      setCallState(ConnectionState.CONNECTED);
      applyVoiceSenderBitrate(peerConnection);
      startAdaptiveStatsMonitoring();
    } else if (state === 'disconnected') {
      handleTransientDisconnect();
    } else if (state === 'failed') {
      handleFatalConnectionFailure();
    }
  };

  peerConnection.oniceconnectionstatechange = () => {
    if (!peerConnection) return;
    const iceState = peerConnection.iceConnectionState;
    console.log(`[WebRTC] iceConnectionState changed: ${iceState}`);

    if (iceState === 'connected' || iceState === 'completed') {
      if (iceRecoveryTimer) {
        clearTimeout(iceRecoveryTimer);
        iceRecoveryTimer = null;
      }
      setCallState(ConnectionState.CONNECTED);
      startAdaptiveStatsMonitoring();
    } else if (iceState === 'disconnected') {
      handleTransientDisconnect();
    } else if (iceState === 'failed') {
      handleFatalConnectionFailure();
    }
  };

  peerConnection.ondatachannel = (event) => {
    dataChannel = event.channel;
    bindDataChannelEvents(dataChannel);
  };
}

function handleTransientDisconnect() {
  if (currentCallState === ConnectionState.DISCONNECTED || currentCallState === ConnectionState.IDLE) return;

  setCallState(ConnectionState.TEMPORARILY_INTERRUPTED, {
    message: 'Temporary network fluctuation detected. Preserving call...'
  });

  // Start 8-second grace period before initiating an ICE restart
  if (!iceRecoveryTimer) {
    iceRecoveryTimer = setTimeout(() => {
      iceRecoveryTimer = null;
      if (peerConnection && (peerConnection.iceConnectionState === 'disconnected' || peerConnection.connectionState === 'disconnected')) {
        console.log('[WebRTC] Transient disconnection persisted > 8s. Initiating ICE restart...');
        attemptIceRestart();
      }
    }, 8000);
  }
}

function handleFatalConnectionFailure() {
  if (iceRecoveryTimer) {
    clearTimeout(iceRecoveryTimer);
    iceRecoveryTimer = null;
  }
  if (iceRestartCount < 2) {
    attemptIceRestart();
  } else {
    setCallState(ConnectionState.DISCONNECTED);
  }
}

async function attemptIceRestart() {
  if (iceRestartCount >= 2) {
    console.warn('[ICE Restart] Maximum restart attempts (2) reached.');
    setCallState(ConnectionState.DISCONNECTED);
    showToast('⚠️ Could not recover connection with stranger.', 'warning', 4000);
    return;
  }

  iceRestartCount++;
  setCallState(ConnectionState.RECOVERING, { message: 'Performing ICE connection restart...' });
  console.log(`[ICE Restart] Initiating ICE restart attempt #${iceRestartCount}...`);

  if (isInitiator) {
    await createAndSendOffer(true);
  } else {
    if (socket) {
      socket.emit('ice-restart', { reason: 'ice_restart_requested' });
    }
  }

  if (iceRecoveryTimer) clearTimeout(iceRecoveryTimer);
  iceRecoveryTimer = setTimeout(() => {
    if (peerConnection && peerConnection.iceConnectionState !== 'connected' && peerConnection.iceConnectionState !== 'completed') {
      if (iceRestartCount < 2) {
        attemptIceRestart();
      } else {
        setCallState(ConnectionState.DISCONNECTED);
        showToast('Connection recovery timed out.', 'info', 3500);
      }
    }
  }, 8000);
}

async function createAndSendOffer(isRestart = false) {
  try {
    let offer;
    if (isRestart && typeof peerConnection.restartIce === 'function') {
      peerConnection.restartIce();
      offer = await peerConnection.createOffer();
    } else {
      offer = await peerConnection.createOffer({ iceRestart: isRestart });
    }

    const tunedOffer = new RTCSessionDescription({
      type: offer.type,
      sdp: tuneOpusSdp(offer.sdp)
    });
    await peerConnection.setLocalDescription(tunedOffer);
    applyVoiceSenderBitrate(peerConnection);
    socket.emit('offer', { offer: tunedOffer, isRestart });
  } catch (err) {
    console.error('[WebRTC] Error creating offer:', err);
  }
}

function setupDataChannelAsInitiator() {
  try {
    dataChannel = peerConnection.createDataChannel('vybrant_chat', { ordered: true });
    bindDataChannelEvents(dataChannel);
  } catch (err) {
    console.error('[WebRTC] Error creating DataChannel:', err);
  }
}

function bindDataChannelEvents(channel) {
  const badge = document.getElementById('chatChannelBadge');
  const secText = document.getElementById('chatSecurityText');

  channel.onopen = () => {
    if (badge) badge.className = 'w-1.5 h-1.5 rounded-full bg-emerald-400';
    if (secText) secText.textContent = 'P2P DataChannel Active (0ms Latency)';
  };

  channel.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (payload.type === 'chat') {
        appendChatMessage('stranger', payload.text);
      } else if (payload.type === 'typing') {
        showPartnerTyping(payload.isTyping);
      }
    } catch (e) {
      appendChatMessage('stranger', event.data);
    }
  };

  channel.onclose = () => {
    if (badge) badge.className = 'w-1.5 h-1.5 rounded-full bg-slate-500';
    if (secText) secText.textContent = 'Socket Fallback';
  };

  channel.onerror = (err) => {
    console.warn('[DataChannel] Error:', err);
  };
}

function teardownPeerConnection(clearVideo = true) {
  stopAdaptiveStatsMonitoring();
  setCallState(ConnectionState.IDLE);

  if (iceRecoveryTimer) {
    clearTimeout(iceRecoveryTimer);
    iceRecoveryTimer = null;
  }
  iceRestartCount = 0;
  isAdaptiveVideoPaused = false;
  activeVideoTier = 0;

  const banner = document.getElementById('adaptiveQualityBanner');
  if (banner) banner.classList.add('hidden');

  const recoveryOverlay = document.getElementById('connectionRecoveryOverlay');
  if (recoveryOverlay) recoveryOverlay.classList.add('hidden');

  hideTapToPlayAudioPrompt();

  const remoteVid = document.getElementById('remoteVideo');
  const antiFlashOverlay = document.getElementById('antiFlashOverlay');
  const audioIndicator = document.getElementById('strangerAudioIndicator');

  if (antiFlashInterval) {
    clearInterval(antiFlashInterval);
    antiFlashInterval = null;
  }
  if (antiFlashOverlay) antiFlashOverlay.classList.add('hidden');
  if (remoteVid) {
    remoteVid.classList.remove('safety-blurred', 'safety-unblurred');
  }

  if (remoteAudioMonitor) {
    try {
      if (remoteAudioMonitor.source) remoteAudioMonitor.source.disconnect();
      if (remoteAudioMonitor.analyser) remoteAudioMonitor.analyser.disconnect();
      if (remoteAudioMonitor.ctx && remoteAudioMonitor.ctx.state !== 'closed') {
        remoteAudioMonitor.ctx.close();
      }
    } catch (e) {}
    remoteAudioMonitor = null;
  }
  if (audioIndicator) audioIndicator.classList.add('hidden');

  if (dataChannel) {
    try { dataChannel.close(); } catch (e) {}
    dataChannel = null;
  }

  if (peerConnection) {
    peerConnection.onconnectionstatechange = null;
    peerConnection.oniceconnectionstatechange = null;
    peerConnection.onicecandidate = null;
    peerConnection.ontrack = null;
    try { peerConnection.close(); } catch (e) {}
    peerConnection = null;
  }

  pendingIceCandidates = [];
  currentPartnerId = null;
  currentSessionId = null;

  if (clearVideo && remoteVid) {
    remoteVid.srcObject = null;
  }
}

function monitorRemoteAudio(stream) {
  const audioIndicator = document.getElementById('strangerAudioIndicator');
  try {
    const audioTrack = stream.getAudioTracks()[0];
    if (!audioTrack) return;

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;

    // Disconnect previous audio monitor to avoid multiple AudioContexts leaking
    if (remoteAudioMonitor) {
      try {
        if (remoteAudioMonitor.source) remoteAudioMonitor.source.disconnect();
        if (remoteAudioMonitor.analyser) remoteAudioMonitor.analyser.disconnect();
        if (remoteAudioMonitor.ctx && remoteAudioMonitor.ctx.state !== 'closed') {
          remoteAudioMonitor.ctx.close();
        }
      } catch (e) {}
      remoteAudioMonitor = null;
    }

    const ctx = new AudioCtx();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);

    remoteAudioMonitor = { ctx, source, analyser };

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const checkVolume = () => {
      if (!peerConnection || (peerConnection.connectionState !== 'connected' && peerConnection.iceConnectionState !== 'connected') || !remoteAudioMonitor) {
        return;
      }
      analyser.getByteFrequencyData(dataArray);
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) sum += dataArray[i];
      const avg = sum / bufferLength;

      if (audioIndicator) {
        if (avg > 18) {
          audioIndicator.classList.remove('hidden');
          audioIndicator.classList.add('flex');
        } else {
          audioIndicator.classList.add('hidden');
          audioIndicator.classList.remove('flex');
        }
      }

      requestAnimationFrame(checkVolume);
    };

    checkVolume();
  } catch (err) {
    console.warn('[Audio] Audio activity detection error:', err);
  }
}

// Dynamic Toggle Match Button Style Sync (Start / Stop)
function updateToggleMatchButton(searching) {
  const matchBtn = document.getElementById('toggleMatchBtn');
  const matchText = document.getElementById('toggleMatchText');
  const matchIcon = document.getElementById('toggleMatchIcon');
  if (!matchBtn) return;

  if (searching) {
    if (matchText) matchText.textContent = 'Stop';
    if (matchIcon) matchIcon.textContent = '⏹';
    matchBtn.className = 'flex-1 py-2 sm:py-2.5 px-2.5 sm:px-3 rounded-2xl bg-gradient-to-r from-rose-500 to-red-600 hover:from-rose-400 hover:to-red-500 text-white font-bold text-xs sm:text-sm flex items-center justify-center space-x-1.5 transition-all active:scale-95 shadow-md shadow-rose-500/20 cursor-pointer min-w-0';
  } else {
    if (matchText) matchText.textContent = 'Start';
    if (matchIcon) matchIcon.textContent = '▶';
    matchBtn.className = 'flex-1 py-2 sm:py-2.5 px-2.5 sm:px-3 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-white font-bold text-xs sm:text-sm flex items-center justify-center space-x-1.5 transition-all active:scale-95 shadow-md shadow-emerald-500/20 cursor-pointer min-w-0';
  }
}

// ==========================================
// MATCHMAKING ACTIONS (START / SKIP / REPORT)
// ==========================================
function startSearching() {
  if (!socket) return;
  if (isSearching) {
    console.debug('[Match] Already in searching state, skipping duplicate startSearching call');
    return;
  }
  isSearching = true;
  updateToggleMatchButton(true);

  socket.emit('start-search', { mode: currentAppMode, preferences: userPreferences });
  setSearchingUI(true);
}

function stopSearching() {
  if (!socket) return;
  isSearching = false;
  updateToggleMatchButton(false);
  socket.emit('stop-search');
  setSearchingUI(false);

  const chatStatusBanner = document.getElementById('chatStatusBanner');
  const chatStatusBannerText = document.getElementById('chatStatusBannerText');
  const chatStatusBannerIcon = document.getElementById('chatStatusBannerIcon');
  if (chatStatusBanner && chatStatusBannerText) {
    chatStatusBanner.classList.remove('hidden');
    if (chatStatusBannerIcon) chatStatusBannerIcon.textContent = '⚡';
    chatStatusBannerText.textContent = 'Ready to chat. Click Start to find a stranger! 🚀';
  }
}

function handleSkip(isReport = false) {
  const now = Date.now();
  if (now - lastSkipTime < 300) return;
  lastSkipTime = now;

  consecutiveSkips++;
  isSearching = true;
  updateToggleMatchButton(true);
  teardownPeerConnection();
  stopNsfwScanner();
  setSearchingUI(true);

  if (isReport) {
    socket.emit('report-peer', {
      mode: currentAppMode,
      reason: 'User reported peer for inappropriate or non-consensual behavior',
      preferences: userPreferences
    });
    showToast('🚩 Report submitted. Searching for someone new...', 'warning');
  } else {
    socket.emit('skip', { mode: currentAppMode, preferences: userPreferences });
  }

  if (consecutiveSkips % 10 === 0 && consecutiveSkips > 0) {
    injectVipTipPrompt();
  }
}

function setSearchingUI(searching) {
  const radarOverlay = document.getElementById('radarOverlay');
  const radarTitle = document.getElementById('radarTitle');
  const statusDot = document.getElementById('strangerStatusDot');
  const badgeText = document.getElementById('strangerBadgeText');
  const statusDotText = document.getElementById('strangerStatusDotText');
  const badgeTextMode = document.getElementById('strangerBadgeTextMode');
  const subtitleTextMode = document.getElementById('strangerSubtitleTextMode');
  const chatStatusBanner = document.getElementById('chatStatusBanner');
  const chatStatusBannerText = document.getElementById('chatStatusBannerText');
  const chatStatusBannerIcon = document.getElementById('chatStatusBannerIcon');

  if (searching) {
    if (radarOverlay) radarOverlay.classList.remove('hidden');
    if (radarTitle) radarTitle.textContent = 'Looking for someone awesome...';
    if (statusDot) statusDot.className = 'w-2 h-2 rounded-full bg-amber-400 animate-pulse';
    if (badgeText) badgeText.textContent = 'Searching...';
    if (statusDotText) statusDotText.className = 'w-3 h-3 rounded-full bg-amber-400 animate-pulse';
    if (badgeTextMode) badgeTextMode.textContent = 'Searching...';
    if (subtitleTextMode) subtitleTextMode.textContent = 'Looking for someone awesome around the world...';
    if (chatStatusBanner) {
      chatStatusBanner.classList.remove('hidden');
      if (chatStatusBannerIcon) chatStatusBannerIcon.textContent = '🔍';
      if (chatStatusBannerText) chatStatusBannerText.textContent = 'Looking for a stranger for text chat...';
    }
  } else {
    if (radarOverlay) radarOverlay.classList.add('hidden');
    if (statusDot) statusDot.className = 'w-2 h-2 rounded-full bg-emerald-400';
    if (badgeText) badgeText.textContent = currentPartnerId ? 'Stranger' : 'Ready';
    if (statusDotText) statusDotText.className = 'w-3 h-3 rounded-full bg-emerald-500';
    if (badgeTextMode) badgeTextMode.textContent = currentPartnerId ? 'Stranger' : 'Ready';
    if (subtitleTextMode) subtitleTextMode.textContent = currentPartnerId ? ((currentAppMode === 'text') ? 'Connected anonymously • No media shared' : 'Connected live • WebRTC P2P') : 'Click Start to connect with someone new';
    if (currentPartnerId) {
      if (chatStatusBanner) chatStatusBanner.classList.add('hidden');
    } else {
      if (chatStatusBanner) {
        chatStatusBanner.classList.remove('hidden');
        if (chatStatusBannerIcon) chatStatusBannerIcon.textContent = '⚡';
        if (chatStatusBannerText) chatStatusBannerText.textContent = 'Ready to chat. Click Start to find a stranger! 🚀';
      }
    }
  }
}

// ==========================================
// SMART CHAT TRIGGERS & PROMPTS
// ==========================================
let isUserNearChatBottom = true;
const CHAT_BOTTOM_THRESHOLD_PX = 80;

function isChatNearBottom() {
  const chatMessages = document.getElementById('chatMessages');
  if (!chatMessages) return true;
  const distanceFromBottom = chatMessages.scrollHeight - chatMessages.scrollTop - chatMessages.clientHeight;
  return distanceFromBottom <= CHAT_BOTTOM_THRESHOLD_PX;
}

function scrollChatToBottom(smooth = true) {
  const chatMessages = document.getElementById('chatMessages');
  const scrollBtn = document.getElementById('scrollToBottomBtn');
  if (!chatMessages) return;
  chatMessages.scrollTo({ top: chatMessages.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  isUserNearChatBottom = true;
  if (scrollBtn) scrollBtn.classList.add('hidden');
}

function handleIncomingChatScroll(force = false) {
  const scrollBtn = document.getElementById('scrollToBottomBtn');
  if (force || isUserNearChatBottom) {
    scrollChatToBottom(true);
  } else {
    // If the user scrolls upward to read older messages, do not forcibly jump to the bottom
    // Provide a return to latest message button
    if (scrollBtn) scrollBtn.classList.remove('hidden');
  }
}

function injectVipTipPrompt() {
  const chatMessages = document.getElementById('chatMessages');
  if (!chatMessages) return;

  const tipWrapper = document.createElement('div');
  tipWrapper.className = 'my-2 p-3 rounded-2xl bg-gradient-to-r from-amber-500/15 via-purple-600/15 to-transparent border border-amber-500/30 text-xs chat-bubble-enter';
  tipWrapper.innerHTML = `
    <div class="flex items-start space-x-2.5">
      <span class="text-xl">💡</span>
      <div class="flex-1">
        <p class="font-display font-bold text-amber-300 text-xs">Tired of randoms?</p>
        <p class="text-slate-300 text-[11px] mt-0.5 leading-snug">
          Unlock 1-Hour Female & Country Filter for just ₹19!
        </p>
        <button class="unlock-vip-cta-btn mt-2 px-3 py-1.5 rounded-lg bg-gradient-to-r from-amber-400 to-yellow-400 hover:from-amber-300 hover:to-yellow-300 text-slate-950 font-bold text-[11px] shadow-sm transition-all hover:scale-105 active:scale-95">
          👑 Unlock Female Filter (₹19)
        </button>
      </div>
    </div>
  `;

  tipWrapper.querySelector('.unlock-vip-cta-btn').addEventListener('click', () => {
    openMicroPassModal();
  });

  chatMessages.appendChild(tipWrapper);
  handleIncomingChatScroll(false);
}

function injectSponsorMessage() {
  const chatMessages = document.getElementById('chatMessages');
  if (!chatMessages) return;

  const sponsorWrapper = document.createElement('div');
  sponsorWrapper.className = 'my-2 p-3 rounded-2xl bg-zinc-50 dark:bg-slate-900/90 border border-purple-500/30 text-xs chat-bubble-enter shadow-xs';

  const tag = escapeHtml(currentSponsorConfig.tag || '🎮 Verified Partner');
  const subTag = escapeHtml(currentSponsorConfig.subTag || 'Zero-Ad Monetization');
  const msg = escapeHtml(currentSponsorConfig.message || 'Level up your setup with Vybronx Gaming Gear & Cloud Servers.');
  const urlLabel = escapeHtml(currentSponsorConfig.urlText || 'Visit vybronx.online/store');
  const rawUrl = currentSponsorConfig.url || 'https://vybronx.online';
  const safeUrl = rawUrl.replace(/[<>"']/g, '');

  sponsorWrapper.innerHTML = `
    <div class="flex items-center space-x-2 mb-1.5">
      <span class="text-[10px] font-bold text-purple-700 dark:text-purple-300 uppercase tracking-wider bg-purple-500/10 dark:bg-purple-500/20 px-2 py-0.5 rounded-full border border-purple-500/30">
        ${tag}
      </span>
      <span class="text-[10px] text-zinc-500 dark:text-slate-400">&bull; ${subTag}</span>
    </div>
    <p class="text-zinc-700 dark:text-slate-300 text-xs leading-relaxed">
      ${msg}
    </p>
    <a href="${safeUrl}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center space-x-1 text-purple-600 dark:text-purple-400 hover:text-purple-500 font-semibold text-xs mt-1.5 underline">
      <span>${urlLabel}</span>
      <span>↗</span>
    </a>
  `;

  chatMessages.appendChild(sponsorWrapper);
  handleIncomingChatScroll(false);
}

// ==========================================
// EPHEMERAL TEXT CHAT
// ==========================================
function appendChatMessage(sender, text) {
  const chatMessages = document.getElementById('chatMessages');
  if (!chatMessages) return;

  const msgWrapper = document.createElement('div');
  msgWrapper.className = 'flex flex-col chat-bubble-enter';
  const timeString = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  if (sender === 'self') {
    msgWrapper.className += ' items-end';
    msgWrapper.innerHTML = `
      <div class="max-w-[85%] rounded-2xl rounded-tr-sm bg-purple-600 text-white px-4 py-2.5 shadow-sm">
        <p class="leading-relaxed break-words text-xs sm:text-sm">${escapeHtml(text)}</p>
      </div>
      <div class="flex items-center space-x-1 text-[11px] text-zinc-400 dark:text-slate-500 mt-1 mr-1">
        <span>${timeString}</span>
        <span class="text-blue-500 font-bold ml-1 text-xs select-none">✔✔</span>
      </div>
    `;
    chatMessages.appendChild(msgWrapper);
    scrollChatToBottom(true);
  } else {
    msgWrapper.className += ' items-start';
    msgWrapper.innerHTML = `
      <div class="max-w-[85%] rounded-2xl rounded-tl-sm bg-zinc-100 dark:bg-white/10 text-zinc-900 dark:text-white px-4 py-2.5 shadow-xs">
        <p class="leading-relaxed break-words text-xs sm:text-sm">${escapeHtml(text)}</p>
      </div>
      <span class="text-[11px] text-zinc-400 dark:text-slate-500 mt-1 ml-1">${timeString}</span>
    `;
    chatMessages.appendChild(msgWrapper);
    handleIncomingChatScroll(false);
  }
}

function addSystemChatMessage(text) {
  const chatMessages = document.getElementById('chatMessages');
  if (!chatMessages) return;

  const systemMsg = document.createElement('div');
  systemMsg.className = 'flex justify-center chat-bubble-enter my-1';
  systemMsg.innerHTML = `
    <div class="bg-zinc-100 dark:bg-white/5 border border-zinc-200 dark:border-white/10 px-3 py-1 rounded-full text-[11px] text-purple-700 dark:text-purple-300 font-medium text-center shadow-xs">
      ${escapeHtml(text)}
    </div>
  `;
  chatMessages.appendChild(systemMsg);
  handleIncomingChatScroll(false);
}

// Interactive Video Call Request prompt inside Chat Box
function addVideoCallRequestInChat() {
  const chatMessages = document.getElementById('chatMessages');
  if (!chatMessages) return;

  const existing = document.getElementById('inlineVideoRequestCard');
  if (existing) existing.remove();

  const card = document.createElement('div');
  card.id = 'inlineVideoRequestCard';
  card.className = 'w-full my-3 p-3.5 sm:p-4 rounded-2xl bg-gradient-to-r from-pink-500/15 via-purple-500/15 to-indigo-500/10 border-2 border-pink-500/40 dark:border-pink-500/30 text-center shadow-lg transition-all';
  card.innerHTML = `
    <div class="flex items-center justify-center gap-2 mb-2">
      <span class="text-2xl animate-pulse">📹</span>
      <span class="font-display font-extrabold text-sm sm:text-base text-zinc-950 dark:text-white">Stranger requested a Video Call!</span>
    </div>
    <p class="text-xs text-zinc-600 dark:text-slate-300 mb-3 font-medium">Would you like to turn on your camera and switch to a live face-to-face video call?</p>
    <div class="flex items-center justify-center gap-2.5">
      <button id="inlineAcceptVideoCallBtn" type="button" class="py-2 px-4 rounded-xl bg-gradient-to-r from-pink-500 via-rose-500 to-purple-600 hover:from-pink-400 hover:to-purple-500 text-white font-bold text-xs shadow-md shadow-pink-500/30 active:scale-95 transition-all cursor-pointer flex items-center space-x-1.5">
        <span>📹 Accept Call</span>
      </button>
      <button id="inlineDeclineVideoCallBtn" type="button" class="py-2 px-3.5 rounded-xl bg-zinc-200 dark:bg-white/10 hover:bg-zinc-300 dark:hover:bg-white/20 text-zinc-700 dark:text-slate-200 font-semibold text-xs active:scale-95 transition-all cursor-pointer">
        <span>Decline ✕</span>
      </button>
    </div>
  `;
  chatMessages.appendChild(card);
  handleIncomingChatScroll(true);

  const acceptBtn = card.querySelector('#inlineAcceptVideoCallBtn');
  const declineBtn = card.querySelector('#inlineDeclineVideoCallBtn');

  if (acceptBtn) {
    acceptBtn.addEventListener('click', async () => {
      card.innerHTML = `
        <div class="py-1 flex items-center justify-center gap-2 text-emerald-600 dark:text-emerald-400 font-bold text-xs">
          <span>✅</span>
          <span>Video Call accepted! Initializing camera...</span>
        </div>
      `;
      const modal = document.getElementById('videoSwitchModal');
      if (modal) { modal.classList.add('hidden'); modal.style.display = 'none'; }
      socket.emit('accept-video-switch');
      selectAppMode('video');
      showToast('Video Call accepted! Initializing camera... 📹', 'success', 2500);
      try {
        await initLocalMedia();
      } catch (err) {
        console.warn('[Video Switch] Camera init error:', err);
      }
    });
  }

  if (declineBtn) {
    declineBtn.addEventListener('click', () => {
      card.innerHTML = `
        <div class="py-1 flex items-center justify-center gap-2 text-zinc-500 dark:text-slate-400 font-medium text-xs">
          <span>✕</span>
          <span>You declined the video call request. Remaining in text chat.</span>
        </div>
      `;
      const modal = document.getElementById('videoSwitchModal');
      if (modal) { modal.classList.add('hidden'); modal.style.display = 'none'; }
      socket.emit('decline-video-switch');
      showToast('Declined video call. Remaining in text chat 💬', 'info', 2500);
    });
  }
}

function clearChatMessages() {
  const chatMessages = document.getElementById('chatMessages');
  const scrollBtn = document.getElementById('scrollToBottomBtn');
  if (chatMessages) chatMessages.innerHTML = '';
  isUserNearChatBottom = true;
  if (scrollBtn) scrollBtn.classList.add('hidden');
}

function sendTypingSignal(isTyping) {
  if (dataChannel && dataChannel.readyState === 'open') {
    dataChannel.send(JSON.stringify({ type: 'typing', isTyping }));
  } else if (socket) {
    socket.emit('typing', { isTyping });
  }
}

function showPartnerTyping(isTyping) {
  const typingEl = document.getElementById('typingIndicator');
  if (!typingEl) return;
  if (isTyping) {
    typingEl.classList.remove('hidden');
    typingEl.classList.add('flex');
  } else {
    typingEl.classList.add('hidden');
    typingEl.classList.remove('flex');
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ==========================================
// VIP & MICRO-PASS CONTROLS
// ==========================================
function openMicroPassModal() {
  const modal = document.getElementById('microPassModal');
  const selView = document.getElementById('vipPlanSelectionView');
  const sucView = document.getElementById('vipSuccessView');
  if (selView) selView.classList.remove('hidden');
  if (sucView) sucView.classList.add('hidden');
  if (modal) modal.classList.remove('hidden');
}

function closeMicroPassModal() {
  const modal = document.getElementById('microPassModal');
  if (modal) modal.classList.add('hidden');
}

async function activateVipCode(code, isImmediateActivation = false) {
  const redeemModal = document.getElementById('redeemModal');
  const redeemCodeInput = document.getElementById('redeemCodeInput');
  const redeemErrorMsg = document.getElementById('redeemErrorMsg');

  try {
    const payload = {
      code: code.toUpperCase().trim(),
      socketId: socket ? socket.id : null
    };

    const res = await fetch('/api/vip/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const result = await res.json();

    if (result.success) {
      isVip = true;
      vipCode = result.code;
      vipExpiresAt = result.expiresAt;
      localStorage.setItem('talkhop_vip_code', vipCode);
      localStorage.setItem('vybrant_vip_code', vipCode);

      if (redeemModal) redeemModal.classList.add('hidden');
      if (redeemCodeInput) redeemCodeInput.value = '';
      if (redeemErrorMsg) redeemErrorMsg.classList.add('hidden');

      startVipCountdownTimer(result.expiresAt);
      updateVipFilterUi(true);

      showToast(`👑 VIP Pass Activated! (${result.plan}) Female & Country filters unlocked!`, 'success', 4000);

      if (socket) {
        socket.emit('update-preferences', userPreferences);
      }
    } else {
      const errorText = res.status === 409
        ? '⚠️ 1-Device Concurrency Lock: This VIP code is actively in use on another device or tab.'
        : `⚠️ ${result.message || 'Failed to activate VIP code.'}`;
      if (redeemErrorMsg) {
        redeemErrorMsg.textContent = errorText;
        redeemErrorMsg.classList.remove('hidden');
      }
    }
  } catch (err) {
    console.error('[VIP] Redeem request failed:', err);
  }
}

function startVipCountdownTimer(expiryTimestamp) {
  const openVipBtn = document.getElementById('openVipModalBtn');
  const vipBadge = document.getElementById('vipActiveBadge');
  const countdownEl = document.getElementById('vipCountdownText');
  const mobileVipText = document.getElementById('mobileVipBtnText');

  if (vipTimerInterval) clearInterval(vipTimerInterval);

  if (openVipBtn) openVipBtn.classList.add('hidden');
  if (vipBadge) {
    vipBadge.classList.remove('hidden');
    vipBadge.classList.add('flex');
  }

  const updateDisplay = () => {
    const remainingMs = expiryTimestamp - Date.now();
    if (remainingMs <= 0) {
      clearInterval(vipTimerInterval);
      vipTimerInterval = null;
      isVip = false;
      localStorage.removeItem('talkhop_vip_code');
      localStorage.removeItem('vybrant_vip_code');
      localStorage.removeItem('blip_vip_code');
      if (openVipBtn) openVipBtn.classList.remove('hidden');
      if (vipBadge) {
        vipBadge.classList.add('hidden');
        vipBadge.classList.remove('flex');
      }
      if (mobileVipText) {
        mobileVipText.textContent = 'Get VIP Pass';
      }
      updateVipFilterUi(false);
      showToast('Your VIP Pass has expired. Re-lock filters to standard.', 'warning', 3500);
      return;
    }

    const totalSecs = Math.floor(remainingMs / 1000);
    const hrs = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;

    const formattedTime = hrs > 0 ? `${hrs}h ${mins}m ${secs}s` : `${mins}m ${secs}s`;
    if (countdownEl) {
      countdownEl.textContent = formattedTime;
    }
    if (mobileVipText) {
      mobileVipText.textContent = `VIP: ${formattedTime}`;
    }
  };

  updateDisplay();
  vipTimerInterval = setInterval(updateDisplay, 1000);
}

function updateVipFilterUi(vipUnlocked) {
  // Update gender dropdown lock indicators
  const genderSelect = document.getElementById('filterGenderSelect');
  if (genderSelect) {
    const femaleOpt = genderSelect.querySelector('option[value="female"]');
    const maleOpt = genderSelect.querySelector('option[value="male"]');
    if (femaleOpt) femaleOpt.textContent = vipUnlocked ? '♀️ Gender: Female ✨' : '♀️ Gender: Female 🔒';
    if (maleOpt) maleOpt.textContent = vipUnlocked ? '♂️ Gender: Male ✨' : '♂️ Gender: Male 🔒';
  }

  if (!vipUnlocked) {
    userPreferences.genderFilter = 'any';
    userPreferences.countryFilter = 'any';
    if (genderSelect) genderSelect.value = 'any';
    const countrySel = document.getElementById('filterCountrySelect');
    if (countrySel) countrySel.value = 'any';
  }

  if (typeof window.syncCustomFiltersUi === 'function') {
    window.syncCustomFiltersUi(vipUnlocked);
  }
}

// ==========================================
// CUSTOM ACCESSIBLE FILTER DROPDOWNS CONTROLLER
// ==========================================
function initCustomFilterDropdowns() {
  const genderWrap = document.getElementById('genderDropdownWrap');
  const genderTrigger = document.getElementById('customGenderTrigger');
  const genderLabel = document.getElementById('customGenderLabel');
  const genderMenu = document.getElementById('customGenderMenu');
  const genderOptionsList = document.getElementById('customGenderOptionsList');
  const genderSelect = document.getElementById('filterGenderSelect');

  const countryWrap = document.getElementById('countryDropdownWrap');
  const countryTrigger = document.getElementById('customCountryTrigger');
  const countryLabel = document.getElementById('customCountryLabel');
  const countryMenu = document.getElementById('customCountryMenu');
  const countryOptionsList = document.getElementById('customCountryOptionsList');
  const countrySearch = document.getElementById('countrySearchInput');
  const countrySelect = document.getElementById('filterCountrySelect');

  if (!genderWrap || !countryWrap || !genderSelect || !countrySelect) return;

  // 1. Populate Gender Options
  if (genderOptionsList && genderOptionsList.children.length === 0) {
    genderOptionsList.innerHTML = '';
    const genderData = [
      { value: 'any', icon: '🎯', label: 'Gender: Random', vip: false },
      { value: 'female', icon: '♀️', label: 'Gender: Female', vip: true },
      { value: 'male', icon: '♂️', label: 'Gender: Male', vip: true }
    ];

    genderData.forEach(item => {
      const optEl = document.createElement('div');
      optEl.className = 'custom-dropdown-option';
      optEl.setAttribute('role', 'option');
      optEl.setAttribute('tabindex', '0');
      optEl.setAttribute('data-value', item.value);
      optEl.setAttribute('aria-selected', 'false');

      optEl.innerHTML = `
        <div class="flex items-center space-x-2">
          <span class="text-sm">${item.icon}</span>
          <span class="font-semibold text-xs text-zinc-800 dark:text-slate-100">${item.label}</span>
        </div>
        <div class="flex items-center space-x-1.5">
          ${item.vip ? `<span class="vip-badge text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border border-amber-300 dark:border-amber-700/50">🔒 VIP</span>` : ''}
          <span class="option-check text-purple-600 dark:text-purple-400 font-bold hidden text-xs">✓</span>
        </div>
      `;
      genderOptionsList.appendChild(optEl);
    });
  }

  // 2. Populate Country Options from the underlying select element
  if (countryOptionsList && countryOptionsList.children.length === 0) {
    countryOptionsList.innerHTML = '';
    Array.from(countrySelect.options).forEach(opt => {
      const val = opt.value;
      const rawText = opt.textContent.trim();
      const isAny = (val === 'any');

      let flag = '🌐';
      let cleanName = rawText;
      if (!isAny) {
        cleanName = rawText.replace(/🔒|\(VIP\)|✨/g, '').trim();
        const parts = cleanName.split(/\s+/);
        if (parts.length > 1) {
          flag = parts[0];
          cleanName = parts.slice(1).join(' ');
        }
      }

      const optEl = document.createElement('div');
      optEl.className = 'custom-dropdown-option';
      optEl.setAttribute('role', 'option');
      optEl.setAttribute('tabindex', '0');
      optEl.setAttribute('data-value', val);
      optEl.setAttribute('data-search', `${cleanName.toLowerCase()} ${val.toLowerCase()}`);
      optEl.setAttribute('aria-selected', 'false');

      optEl.innerHTML = `
        <div class="flex items-center space-x-2 min-w-0">
          <span class="text-sm flex-shrink-0">${flag}</span>
          <span class="font-medium text-xs text-zinc-800 dark:text-slate-200 truncate">${isAny ? 'Global (Any Country)' : cleanName}</span>
        </div>
        <div class="flex items-center space-x-1.5 flex-shrink-0 ml-1.5">
          ${!isAny && flag !== val ? `<span class="text-[10px] font-mono text-zinc-400 dark:text-slate-500 uppercase">${val}</span>` : ''}
          ${!isAny ? `<span class="vip-badge text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border border-amber-300 dark:border-amber-700/50">🔒 VIP</span>` : ''}
          <span class="option-check text-purple-600 dark:text-purple-400 font-bold hidden text-xs">✓</span>
        </div>
      `;
      countryOptionsList.appendChild(optEl);
    });
  }

  // 3. Sync UI with active state
  function syncCustomFilters(vipUnlocked) {
    const isUnlocked = typeof vipUnlocked === 'boolean' ? vipUnlocked : !!isVip;

    // Sync Gender
    const curGender = genderSelect.value || 'any';
    const gOpts = genderOptionsList.querySelectorAll('.custom-dropdown-option');
    gOpts.forEach(el => {
      const v = el.getAttribute('data-value');
      const isSel = (v === curGender);
      el.classList.toggle('selected', isSel);
      el.setAttribute('aria-selected', isSel ? 'true' : 'false');
      const badge = el.querySelector('.vip-badge');
      if (badge) {
        badge.textContent = isUnlocked ? '✨ VIP' : '🔒 VIP';
        badge.className = isUnlocked
          ? 'vip-badge text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-purple-100 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border border-purple-300 dark:border-purple-700/50'
          : 'vip-badge text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border border-amber-300 dark:border-amber-700/50';
      }
    });

    if (curGender === 'female') genderLabel.textContent = 'Gender: Female';
    else if (curGender === 'male') genderLabel.textContent = 'Gender: Male';
    else genderLabel.textContent = 'Gender: Random';

    // Sync Country
    const curCountry = countrySelect.value || 'any';
    const cOpts = countryOptionsList.querySelectorAll('.custom-dropdown-option');
    let selCountryLabel = 'Global (Any Country)';
    cOpts.forEach(el => {
      const v = el.getAttribute('data-value');
      const isSel = (v === curCountry);
      el.classList.toggle('selected', isSel);
      el.setAttribute('aria-selected', isSel ? 'true' : 'false');
      if (isSel) {
        const nameNode = el.querySelector('.truncate');
        if (nameNode) selCountryLabel = nameNode.textContent;
      }
      const badge = el.querySelector('.vip-badge');
      if (badge) {
        badge.textContent = isUnlocked ? '✨ VIP' : '🔒 VIP';
        badge.className = isUnlocked
          ? 'vip-badge text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-purple-100 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border border-purple-300 dark:border-purple-700/50'
          : 'vip-badge text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border border-amber-300 dark:border-amber-700/50';
      }
    });
    countryLabel.textContent = selCountryLabel;
  }

  window.syncCustomFiltersUi = syncCustomFilters;

  // 4. Open / Close helpers
  function closeAllDropdowns() {
    genderWrap.classList.remove('open');
    genderMenu.classList.add('hidden');
    genderTrigger.setAttribute('aria-expanded', 'false');
    genderMenu.classList.remove('open-upward');

    countryWrap.classList.remove('open');
    countryMenu.classList.add('hidden');
    countryTrigger.setAttribute('aria-expanded', 'false');
    countryMenu.classList.remove('open-upward');
  }

  function toggleDropdown(wrap, trigger, menu) {
    const isCurrentlyOpen = wrap.classList.contains('open');
    closeAllDropdowns();
    if (isCurrentlyOpen) return;

    // Viewport collision detection
    const triggerRect = trigger.getBoundingClientRect();
    const spaceBelow = window.innerHeight - triggerRect.bottom;
    if (spaceBelow < 280 && triggerRect.top > 280) {
      menu.classList.add('open-upward');
    } else {
      menu.classList.remove('open-upward');
    }

    wrap.classList.add('open');
    menu.classList.remove('hidden');
    trigger.setAttribute('aria-expanded', 'true');

    if (wrap === countryWrap) {
      if (countrySearch) {
        countrySearch.value = '';
        countryOptionsList.querySelectorAll('.custom-dropdown-option').forEach(el => el.style.display = 'flex');
        setTimeout(() => countrySearch.focus(), 50);
      }
      const activeOption = countryOptionsList.querySelector('.custom-dropdown-option.selected');
      if (activeOption) {
        activeOption.scrollIntoView({ block: 'nearest' });
      }
    }
  }

  // 5. Trigger click events
  genderTrigger.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleDropdown(genderWrap, genderTrigger, genderMenu);
  });

  countryTrigger.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleDropdown(countryWrap, countryTrigger, countryMenu);
  });

  // Stop click bubbling from inside menu panels
  genderMenu.addEventListener('click', (e) => e.stopPropagation());
  countryMenu.addEventListener('click', (e) => e.stopPropagation());

  // Click outside to dismiss
  document.addEventListener('pointerdown', (e) => {
    if (!genderWrap.contains(e.target) && !countryWrap.contains(e.target)) {
      closeAllDropdowns();
    }
  });

  // Escape key to dismiss
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeAllDropdowns();
    }
  });

  // 6. Real-time Country Search Filter
  if (countrySearch) {
    countrySearch.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase().trim();
      const allOpts = countryOptionsList.querySelectorAll('.custom-dropdown-option');
      allOpts.forEach(el => {
        const searchStr = (el.getAttribute('data-search') || '').toLowerCase();
        if (!q || searchStr.includes(q)) {
          el.style.display = 'flex';
        } else {
          el.style.display = 'none';
        }
      });
    });

    countrySearch.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const firstVisible = Array.from(countryOptionsList.querySelectorAll('.custom-dropdown-option')).find(el => el.style.display !== 'none');
        if (firstVisible) firstVisible.click();
      }
    });
  }

  // 7. Option selection handlers (updates select, fires change event, syncs UI)
  genderOptionsList.addEventListener('click', (e) => {
    const opt = e.target.closest('.custom-dropdown-option');
    if (!opt) return;
    const val = opt.getAttribute('data-value');
    genderSelect.value = val;
    genderSelect.dispatchEvent(new Event('change', { bubbles: true }));
    syncCustomFilters(isVip);
    closeAllDropdowns();
    genderTrigger.focus();
  });

  countryOptionsList.addEventListener('click', (e) => {
    const opt = e.target.closest('.custom-dropdown-option');
    if (!opt) return;
    const val = opt.getAttribute('data-value');
    countrySelect.value = val;
    countrySelect.dispatchEvent(new Event('change', { bubbles: true }));
    syncCustomFilters(isVip);
    closeAllDropdowns();
    countryTrigger.focus();
  });

  // Keyboard navigation on list options
  [genderOptionsList, countryOptionsList].forEach(list => {
    list.addEventListener('keydown', (e) => {
      const cur = document.activeElement;
      if (!cur || !cur.classList.contains('.custom-dropdown-option')) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = cur.nextElementSibling;
        if (next && next.classList.contains('custom-dropdown-option')) next.focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = cur.previousElementSibling;
        if (prev && prev.classList.contains('custom-dropdown-option')) prev.focus();
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        cur.click();
      }
    });
  });

  // Keep synced if select changes programmatically
  genderSelect.addEventListener('change', () => syncCustomFilters(isVip));
  countrySelect.addEventListener('change', () => syncCustomFilters(isVip));

  // Initial sync
  syncCustomFilters(isVip);
}

// ==========================================
// DOM BINDINGS & EVENT LISTENERS
// ==========================================
function bindUiEventListeners() {
  initCustomFilterDropdowns();

  const localMic = document.getElementById('localMicBtn');
  const localCam = document.getElementById('localCamBtn');
  const flipBtn = document.getElementById('flipCamBtn');
  const grantBtn = document.getElementById('grantPermissionBtn');

  if (localMic) localMic.addEventListener('click', toggleAudio);
  if (localCam) localCam.addEventListener('click', toggleVideo);
  if (flipBtn) flipBtn.addEventListener('click', flipCamera);
  if (grantBtn) grantBtn.addEventListener('click', initLocalMedia);

  const guideBtn = document.getElementById('safetyGuideBtn');
  const guideModal = document.getElementById('guidelinesModal');
  const closeGuide = document.getElementById('closeGuidelinesBtn');
  const ackGuide = document.getElementById('ackGuidelinesBtn');

  if (guideBtn && guideModal) guideBtn.addEventListener('click', () => guideModal.classList.remove('hidden'));
  if (closeGuide && guideModal) closeGuide.addEventListener('click', () => guideModal.classList.add('hidden'));
  if (ackGuide && guideModal) ackGuide.addEventListener('click', () => guideModal.classList.add('hidden'));

  const openVip = document.getElementById('openVipModalBtn');
  const mobileOpenVip = document.getElementById('mobileOpenVipModalBtn');
  const closeMicro = document.getElementById('closeMicroPassBtn');
  const openRedeem = document.getElementById('openRedeemModalBtn');
  const mobileOpenRedeem = document.getElementById('mobileOpenRedeemModalBtn');
  const closeRedeem = document.getElementById('closeRedeemModalBtn');
  const redeemModal = document.getElementById('redeemModal');
  const redeemInput = document.getElementById('redeemCodeInput');
  const redeemErr = document.getElementById('redeemErrorMsg');

  if (openVip) openVip.addEventListener('click', openMicroPassModal);
  if (mobileOpenVip) mobileOpenVip.addEventListener('click', openMicroPassModal);
  if (closeMicro) closeMicro.addEventListener('click', closeMicroPassModal);
  if (openRedeem && redeemModal) {
    openRedeem.addEventListener('click', () => {
      if (redeemErr) redeemErr.classList.add('hidden');
      redeemModal.classList.remove('hidden');
      if (redeemInput) redeemInput.focus();
    });
  }
  if (mobileOpenRedeem && redeemModal) {
    mobileOpenRedeem.addEventListener('click', () => {
      if (redeemErr) redeemErr.classList.add('hidden');
      redeemModal.classList.remove('hidden');
      if (redeemInput) redeemInput.focus();
    });
  }
  if (closeRedeem && redeemModal) {
    closeRedeem.addEventListener('click', () => redeemModal.classList.add('hidden'));
  }

  document.querySelectorAll('input[name="vipPlan"]').forEach(radio => {
    radio.addEventListener('change', () => {
      document.querySelectorAll('.vip-plan-card').forEach(card => {
        card.classList.remove('border-amber-500/40', 'bg-amber-500/10');
        card.classList.add('border-zinc-200', 'dark:border-white/10', 'bg-zinc-50', 'dark:bg-white/5');
      });
      const parent = radio.closest('.vip-plan-card');
      if (parent) {
        parent.classList.remove('border-zinc-200', 'dark:border-white/10', 'bg-zinc-50', 'dark:bg-white/5');
        parent.classList.add('border-amber-500/40', 'bg-amber-500/10');
      }
    });
  });

  const simPayBtn = document.getElementById('simulatePaymentBtn');
  if (simPayBtn) {
    simPayBtn.addEventListener('click', async () => {
      const selectedPlan = document.querySelector('input[name="vipPlan"]:checked')?.value || '1-hour';
      const origBtnHtml = simPayBtn.innerHTML;
      simPayBtn.innerHTML = `<span>⏳ Processing Payment...</span>`;
      simPayBtn.disabled = true;

      try {
        // 1. Create order on backend
        const orderRes = await fetch('/api/payment/create-order', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ plan: selectedPlan })
        });
        const orderData = await orderRes.json();

        if (!orderData.success) {
          throw new Error(orderData.message || 'Could not initiate payment order.');
        }

        // Helper function to handle completion on frontend
        const handlePaymentComplete = (code, plan, price) => {
          latestGeneratedCode = code;
          const codeEl = document.getElementById('generatedVipCodeText');
          const detEl = document.getElementById('generatedPassDetails');
          const planLabel = plan === '24-hour' ? '24-Hour' : (plan === '12-hour' ? '12-Hour' : '1-Hour');
          if (codeEl) codeEl.textContent = code;
          if (detEl) detEl.textContent = `${planLabel} Pass (₹${price}) • 1-Device Concurrency Lock`;

          const selView = document.getElementById('vipPlanSelectionView');
          const sucView = document.getElementById('vipSuccessView');
          if (selView) selView.classList.add('hidden');
          if (sucView) sucView.classList.remove('hidden');

          simPayBtn.innerHTML = origBtnHtml;
          simPayBtn.disabled = false;
          showToast('Payment verified! VIP Pass generated successfully 🎉', 'success', 3500);
        };

        // 2. If Razorpay Checkout SDK is loaded and not a mock order
        if (typeof window.Razorpay === 'function' && !orderData.isMock && orderData.key_id && !orderData.key_id.includes('mock')) {
          const planDesc = selectedPlan === '24-hour' ? '24-Hour' : (selectedPlan === '12-hour' ? '12-Hour' : '1-Hour');
          const options = {
            key: orderData.key_id,
            amount: orderData.amount,
            currency: orderData.currency || 'INR',
            name: 'TalkHop ⚡ Engine',
            description: `${planDesc} VIP Micro-Pass`,
            order_id: orderData.order_id,
            image: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%238b5cf6"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>',
            handler: async function (response) {
              simPayBtn.innerHTML = `<span>⏳ Verifying Signature...</span>`;
              try {
                const verifyRes = await fetch('/api/payment/verify', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    razorpay_order_id: response.razorpay_order_id || orderData.order_id,
                    razorpay_payment_id: response.razorpay_payment_id,
                    razorpay_signature: response.razorpay_signature,
                    plan: selectedPlan
                  })
                });
                const verifyData = await verifyRes.json();
                if (verifyData.success) {
                  handlePaymentComplete(verifyData.code, selectedPlan, verifyData.price);
                } else {
                  showToast(verifyData.message || 'Payment signature verification failed.', 'danger', 4000);
                  simPayBtn.innerHTML = origBtnHtml;
                  simPayBtn.disabled = false;
                }
              } catch (verErr) {
                showToast('Error validating payment with server.', 'danger');
                simPayBtn.innerHTML = origBtnHtml;
                simPayBtn.disabled = false;
              }
            },
            prefill: {
              name: 'TalkHop User',
              email: 'guest@talkhop.vybronx.online',
              contact: '9999999999'
            },
            theme: {
              color: '#8b5cf6',
              backdrop_color: 'rgba(7, 8, 13, 0.85)'
            },
            modal: {
              ondismiss: function () {
                simPayBtn.innerHTML = origBtnHtml;
                simPayBtn.disabled = false;
                showToast('Payment window closed.', 'info', 2000);
              }
            }
          };

          const rzp = new window.Razorpay(options);
          rzp.on('payment.failed', function (resp) {
            console.warn('[Razorpay] Payment failed:', resp.error);
            showToast(`Payment failed: ${resp.error.description || 'Transaction declined'}`, 'danger', 4000);
            simPayBtn.innerHTML = origBtnHtml;
            simPayBtn.disabled = false;
          });
          rzp.open();

        } else {
          // Instant Mock Sandbox Verification (when running without live keys)
          console.log('[Payment] Executing sandbox instant verification for order:', orderData.order_id);
          const verifyRes = await fetch('/api/payment/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              razorpay_order_id: orderData.order_id,
              razorpay_payment_id: `pay_mock_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
              razorpay_signature: 'sandbox_valid_sig',
              plan: selectedPlan
            })
          });
          const verifyData = await verifyRes.json();
          if (verifyData.success) {
            handlePaymentComplete(verifyData.code, selectedPlan, verifyData.price);
          } else {
            showToast(verifyData.message || 'Sandbox verification failed.', 'danger');
            simPayBtn.innerHTML = origBtnHtml;
            simPayBtn.disabled = false;
          }
        }

      } catch (err) {
        console.error('[Payment] Error:', err);
        simPayBtn.innerHTML = origBtnHtml;
        simPayBtn.disabled = false;
        showToast(err.message || 'Failed to connect to payment server.', 'danger');
      }
    });
  }

  const copyBtn = document.getElementById('copyVipCodeBtn');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      if (latestGeneratedCode) {
        navigator.clipboard.writeText(latestGeneratedCode).then(() => {
          copyBtn.textContent = '✅ Copied!';
          setTimeout(() => { copyBtn.textContent = '📋 Copy'; }, 2000);
          showToast('VIP Code copied to clipboard!', 'info', 2000);
        });
      }
    });
  }

  const actNow = document.getElementById('activateNowBtn');
  const saveLater = document.getElementById('saveForLaterBtn');
  if (actNow) {
    actNow.addEventListener('click', () => {
      if (latestGeneratedCode) {
        activateVipCode(latestGeneratedCode, true);
        closeMicroPassModal();
      }
    });
  }
  if (saveLater) {
    saveLater.addEventListener('click', () => {
      if (latestGeneratedCode) {
        navigator.clipboard.writeText(latestGeneratedCode);
        showToast(`VIP Code ${latestGeneratedCode} saved! Redeem anytime using 🎟️ button.`, 'info', 4000);
      }
      closeMicroPassModal();
    });
  }

  const subRedeem = document.getElementById('submitRedeemBtn');
  if (subRedeem) {
    subRedeem.addEventListener('click', () => {
      const code = redeemInput?.value.trim();
      if (!code) {
        if (redeemErr) {
          redeemErr.textContent = 'Please enter a valid VIP code.';
          redeemErr.classList.remove('hidden');
        }
        return;
      }
      activateVipCode(code, false);
    });
  }

  const fGenderSelect = document.getElementById('filterGenderSelect');
  const fCountry = document.getElementById('filterCountrySelect');
  const myM = document.getElementById('myGenderMale');
  const myF = document.getElementById('myGenderFemale');

  if (fGenderSelect) {
    fGenderSelect.addEventListener('change', (e) => {
      const selected = e.target.value;
      if (selected !== 'any' && !isVip) {
        e.target.value = 'any';
        userPreferences.genderFilter = 'any';
        openMicroPassModal();
        showToast('👑 VIP Pass required to use Gender Filter!', 'warning', 3000);
        return;
      }
      userPreferences.genderFilter = selected;
      if (socket) socket.emit('update-preferences', userPreferences);
      if (selected === 'female') {
        showToast('Priority Female Matchmaking Filter active ♀️', 'info', 2000);
      } else if (selected === 'male') {
        showToast('Priority Male Matchmaking Filter active ♂️', 'info', 2000);
      }
    });
  }

  if (fCountry) {
    fCountry.addEventListener('change', (e) => {
      const selected = e.target.value;
      if (selected !== 'any' && !isVip) {
        e.target.value = 'any';
        userPreferences.countryFilter = 'any';
        openMicroPassModal();
        showToast('👑 VIP Pass required to filter by Country!', 'warning', 3000);
        return;
      }
      userPreferences.countryFilter = selected;
      if (socket) socket.emit('update-preferences', userPreferences);
      if (selected !== 'any') {
        showToast(`Priority Country Filter (${selected}) active 🌍`, 'info', 2000);
      }
    });
  }

  if (myM) {
    myM.addEventListener('click', () => {
      userPreferences.myGender = 'male';
      myM.className = 'px-2.5 py-0.5 rounded-lg text-xs font-semibold bg-purple-600 text-white transition-all shadow-xs';
      if (myF) myF.className = 'px-2.5 py-0.5 rounded-lg text-xs font-semibold text-zinc-600 dark:text-slate-300 hover:text-zinc-900 dark:hover:text-white transition-all';
      if (socket) socket.emit('update-preferences', userPreferences);
    });
  }

  if (myF) {
    myF.addEventListener('click', () => {
      userPreferences.myGender = 'female';
      myF.className = 'px-2.5 py-0.5 rounded-lg text-xs font-semibold bg-gradient-to-r from-purple-600 to-pink-500 text-white transition-all shadow-xs';
      if (myM) myM.className = 'px-2.5 py-0.5 rounded-lg text-xs font-semibold text-zinc-600 dark:text-slate-300 hover:text-zinc-900 dark:hover:text-white transition-all';
      if (socket) socket.emit('update-preferences', userPreferences);
    });
  }



  const skipButton = document.getElementById('skipBtn');
  const reportButton = document.getElementById('reportBtn');
  const toggleMatch = document.getElementById('toggleMatchBtn');
  const quickRev = document.getElementById('quickRevealBtn');

  if (skipButton) skipButton.addEventListener('click', () => handleSkip(false));
  if (reportButton) reportButton.addEventListener('click', () => handleSkip(true));
  if (toggleMatch) {
    toggleMatch.addEventListener('click', () => {
      if (isSearching) stopSearching();
      else startSearching();
    });
  }
  if (quickRev) quickRev.addEventListener('click', revealStrangerVideo);

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      handleSkip(false);
    }
  });

  const cForm = document.getElementById('chatForm');
  const cInput = document.getElementById('chatInput');
  const clearC = document.getElementById('clearChatBtn');
  const emojiB = document.getElementById('quickEmojiBtn');

  if (cForm && cInput) {
    cForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = cInput.value.trim();
      if (!text) return;

      cInput.value = '';
      appendChatMessage('self', text);
      sendTypingSignal(false);

      if (dataChannel && dataChannel.readyState === 'open') {
        dataChannel.send(JSON.stringify({ type: 'chat', text }));
      } else if (socket) {
        socket.emit('chat-message', { message: text });
      }
    });

    cInput.addEventListener('input', () => {
      sendTypingSignal(true);
      if (typingTimeout) clearTimeout(typingTimeout);
      typingTimeout = setTimeout(() => {
        sendTypingSignal(false);
      }, 1500);
    });
  }

  if (clearC) {
    clearC.addEventListener('click', () => {
      clearChatMessages();
      addSystemChatMessage('Chat cleared.');
      showToast('Chat cleared 🗑️', 'info', 2000);
    });
  }

  const chatMessagesEl = document.getElementById('chatMessages');
  const scrollBottomBtn = document.getElementById('scrollToBottomBtn');

  if (chatMessagesEl) {
    chatMessagesEl.addEventListener('scroll', () => {
      isUserNearChatBottom = isChatNearBottom();
      if (isUserNearChatBottom && scrollBottomBtn) {
        scrollBottomBtn.classList.add('hidden');
      }
    });
  }

  if (scrollBottomBtn) {
    scrollBottomBtn.addEventListener('click', () => {
      scrollChatToBottom(true);
    });
  }

  const EMOJIS = ['👋', '🔥', '✨', '⚡', '😂', '💀', '😎', '❤️'];
  let emojiIndex = 0;
  if (emojiB && cInput) {
    emojiB.addEventListener('click', () => {
      const emoji = EMOJIS[emojiIndex % EMOJIS.length];
      emojiIndex++;
      cInput.value += emoji;
      cInput.focus();
    });
  }

  // Tap-to-play Audio Unlock (Instagram in-app browser / iOS Safari autoplay restriction)
  const tapAudioBtn = document.getElementById('tapToPlayAudioBtn');
  if (tapAudioBtn) {
    tapAudioBtn.addEventListener('click', () => {
      const remoteVid = document.getElementById('remoteVideo');
      if (remoteVid) {
        remoteVid.play().then(() => {
          hideTapToPlayAudioPrompt();
          showToast('Audio playback enabled! 🔊', 'success', 2000);
        }).catch(err => {
          console.warn('[Audio] User tap play failed:', err);
        });
      }
      if (remoteAudioMonitor && remoteAudioMonitor.ctx && remoteAudioMonitor.ctx.state === 'suspended') {
        remoteAudioMonitor.ctx.resume();
      }
    });
  }

  // Recovery overlay skip button
  const recSkipBtn = document.getElementById('recoverySkipBtn');
  if (recSkipBtn) {
    recSkipBtn.addEventListener('click', () => {
      const overlay = document.getElementById('connectionRecoveryOverlay');
      if (overlay) overlay.classList.add('hidden');
      handleSkip(false);
    });
  }

  // ==========================================
  // TALKHOP MODE SELECTION MODAL BINDINGS
  // ==========================================
  const startChatBtn = document.getElementById('startChatModeBtn');
  const startVideoBtn = document.getElementById('startVideoModeBtn');
  const modeCardChat = document.getElementById('modeCardChat');
  const modeCardVideo = document.getElementById('modeCardVideo');

  const handleStartChatMode = () => {
    hideModeSelectionModal();
    selectAppMode('text', false);
    updateToggleMatchButton(false);
    showToast('Random Chat mode active 💬 Click Start to find a stranger!', 'info', 2500);
  };

  const handleStartVideoMode = () => {
    hideModeSelectionModal();
    selectAppMode('video', false);
    updateToggleMatchButton(false);
    showToast('Video Call mode active 📹 Click Start to begin!', 'info', 2500);
  };

  if (startChatBtn) startChatBtn.addEventListener('click', handleStartChatMode);
  if (modeCardChat) modeCardChat.addEventListener('click', (e) => {
    if (e.target !== startChatBtn) handleStartChatMode();
  });

  if (startVideoBtn) startVideoBtn.addEventListener('click', handleStartVideoMode);
  if (modeCardVideo) modeCardVideo.addEventListener('click', (e) => {
    if (e.target !== startVideoBtn) handleStartVideoMode();
  });

  // ==========================================
  // SLIDE-TO-SWITCH MODE TABS & CTA BINDINGS
  // ==========================================
  const switchChatBtn = document.getElementById('switchModeChatBtn');
  const switchVideoBtn = document.getElementById('switchModeVideoBtn');
  const requestVideoBtn = document.getElementById('requestVideoSwitchBtn');

  if (switchChatBtn) {
    switchChatBtn.addEventListener('click', () => {
      if (currentAppMode === 'video') {
        if (currentPartnerId) {
          socket.emit('switch-to-text');
          selectAppMode('text');
          showToast('Switched to text chat mode 💬', 'info', 2500);
        } else {
          selectAppMode('text');
          if (isSearching) startSearching();
        }
      }
    });
  }

  const handleRequestVideo = () => {
    if (currentAppMode === 'text') {
      if (currentPartnerId) {
        showToast('Video Call request sent to stranger... 📹', 'info', 3000);
        addSystemChatMessage('📹 You sent a Video Call invitation to stranger... Waiting for response.');
        socket.emit('request-video-switch');
      } else {
        selectAppMode('video');
        initLocalMedia().then(() => {
          if (isSearching) startSearching();
        }).catch(err => {
          console.warn('[Mode] Media init error:', err);
        });
      }
    }
  };

  if (switchVideoBtn) switchVideoBtn.addEventListener('click', handleRequestVideo);
  if (requestVideoBtn) requestVideoBtn.addEventListener('click', handleRequestVideo);

  // Stranger requested video call accept/decline buttons
  const acceptVideoBtn = document.getElementById('acceptVideoSwitchBtn');
  const declineVideoBtn = document.getElementById('declineVideoSwitchBtn');

  if (acceptVideoBtn) {
    acceptVideoBtn.addEventListener('click', async () => {
      const modal = document.getElementById('videoSwitchModal');
      if (modal) {
        modal.classList.add('hidden');
        modal.style.display = 'none';
      }
      socket.emit('accept-video-switch');
      selectAppMode('video');
      showToast('Video Call accepted! Initializing camera... 📹', 'success', 2500);
      try {
        await initLocalMedia();
      } catch (err) {
        console.warn('[Video Switch] Camera init error:', err);
      }
    });
  }

  if (declineVideoBtn) {
    declineVideoBtn.addEventListener('click', () => {
      const modal = document.getElementById('videoSwitchModal');
      if (modal) {
        modal.classList.add('hidden');
        modal.style.display = 'none';
      }
      socket.emit('decline-video-switch');
      showToast('Declined video switch. Remaining in text chat 💬', 'info', 2500);
    });
  }

  // Instagram / In-App Browser Notice
  initInAppBrowserNotice();
}

function initInAppBrowserNotice() {
  if (isInstagramBrowser) {
    const notice = document.getElementById('inAppBrowserNotice');
    if (notice) notice.classList.remove('hidden');

    const dismissBtn = document.getElementById('dismissInAppNoticeBtn');
    if (dismissBtn && notice) {
      dismissBtn.addEventListener('click', () => {
        notice.classList.add('hidden');
      });
    }

    const copyBtn = document.getElementById('copyBrowserLinkBtn');
    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(window.location.href).then(() => {
            showToast('Link copied! Open Chrome or Safari and paste 📋', 'success', 3500);
          }).catch(() => {
            showToast('Please copy URL from address bar.', 'info', 2500);
          });
        }
      });
    }
  }
}

// Window diagnostic helper for QA & connection state inspection
// Comprehensive window diagnostic helper for WebRTC QA & connection inspection
window.getVybrantConnectionDiagnostics = async function() {
  let statsReport = {
    selectedPair: null,
    outboundVideo: null,
    inboundVideo: null,
    outboundAudio: null,
    inboundAudio: null,
    remoteInboundVideo: null
  };

  if (peerConnection && typeof peerConnection.getStats === 'function') {
    try {
      const stats = await peerConnection.getStats();
      const candidates = new Map();

      stats.forEach(report => {
        if (report.type === 'local-candidate' || report.type === 'remote-candidate') {
          candidates.set(report.id, report);
        }
      });

      stats.forEach(report => {
        if (report.type === 'candidate-pair' && (report.state === 'succeeded' || report.nominated)) {
          const localCand = candidates.get(report.localCandidateId);
          const remoteCand = candidates.get(report.remoteCandidateId);

          statsReport.selectedPair = {
            state: report.state,
            nominated: Boolean(report.nominated),
            currentRoundTripTimeMs: report.currentRoundTripTime != null ? Math.round(report.currentRoundTripTime * 1000) : null,
            availableOutgoingBitrateKbps: report.availableOutgoingBitrate ? Math.round(report.availableOutgoingBitrate / 1000) : null,
            availableIncomingBitrateKbps: report.availableIncomingBitrate ? Math.round(report.availableIncomingBitrate / 1000) : null,
            bytesSent: report.bytesSent,
            bytesReceived: report.bytesReceived,
            localCandidateType: localCand?.candidateType || 'unknown',
            localProtocol: localCand?.protocol || 'unknown',
            remoteCandidateType: remoteCand?.candidateType || 'unknown',
            remoteProtocol: remoteCand?.protocol || 'unknown',
            isRelay: (localCand?.candidateType === 'relay' || remoteCand?.candidateType === 'relay')
          };
        } else if (report.type === 'outbound-rtp' && report.kind === 'video') {
          statsReport.outboundVideo = {
            bytesSent: report.bytesSent,
            packetsSent: report.packetsSent,
            framesEncoded: report.framesEncoded,
            framesPerSecond: report.framesPerSecond,
            targetBitrateKbps: report.targetBitrate ? Math.round(report.targetBitrate / 1000) : null,
            qualityLimitationReason: report.qualityLimitationReason || 'none',
            retransmittedPacketsSent: report.retransmittedPacketsSent || 0
          };
        } else if (report.type === 'inbound-rtp' && report.kind === 'video') {
          statsReport.inboundVideo = {
            bytesReceived: report.bytesReceived,
            packetsReceived: report.packetsReceived,
            packetsLost: report.packetsLost,
            framesDecoded: report.framesDecoded,
            framesDropped: report.framesDropped,
            jitterMs: report.jitter != null ? Math.round(report.jitter * 1000) : 0
          };
        } else if (report.type === 'outbound-rtp' && report.kind === 'audio') {
          statsReport.outboundAudio = {
            bytesSent: report.bytesSent,
            packetsSent: report.packetsSent,
            targetBitrateKbps: report.targetBitrate ? Math.round(report.targetBitrate / 1000) : null
          };
        } else if (report.type === 'inbound-rtp' && report.kind === 'audio') {
          statsReport.inboundAudio = {
            bytesReceived: report.bytesReceived,
            packetsReceived: report.packetsReceived,
            packetsLost: report.packetsLost,
            jitterMs: report.jitter != null ? Math.round(report.jitter * 1000) : 0
          };
        } else if (report.type === 'remote-inbound-rtp' && report.kind === 'video') {
          statsReport.remoteInboundVideo = {
            packetsLost: report.packetsLost,
            fractionLost: report.fractionLost,
            roundTripTimeMs: report.roundTripTime != null ? Math.round(report.roundTripTime * 1000) : null
          };
        }
      });
    } catch (e) {
      statsReport.error = e.message;
    }
  }

  return {
    timestamp: new Date().toISOString(),
    visitorId: getOrCreateVisitorId(),
    sessionId: currentSessionId,
    partnerId: currentPartnerId,
    state: currentCallState,
    peerConnectionState: peerConnection?.connectionState || 'none',
    iceConnectionState: peerConnection?.iceConnectionState || 'none',
    signalingState: peerConnection?.signalingState || 'none',
    socketConnected: Boolean(socket && socket.connected),
    socketId: socket?.id || null,
    iceRestartAttempts: iceRestartCount,
    quality: {
      activeVideoTier,
      isAdaptiveVideoPaused,
      isVideoDisabled,
      isAudioMuted,
      isAudioOnly,
      consecutivePoorReadings,
      consecutiveGoodReadings
    },
    browser: {
      isInstagramBrowser,
      isRemoteAudioBlocked
    },
    stats: statsReport
  };
};

window.getVybrantDiagnosticSummary = async function() {
  const d = await window.getVybrantConnectionDiagnostics();
  const pair = d.stats.selectedPair;
  const outVid = d.stats.outboundVideo;
  const inVid = d.stats.inboundVideo;

  return [
    `=== TALKHOP WEBRTC CONNECTION DIAGNOSTICS ===`,
    `Time: ${d.timestamp} | Visitor: ${d.visitorId} | Session: ${d.sessionId || 'none'}`,
    `Mode: ${currentAppMode} | Call State: ${d.state} | PC: ${d.peerConnectionState} | ICE: ${d.iceConnectionState}`,
    `Quality Tier: ${d.quality.activeVideoTier} (Paused: ${d.quality.isAdaptiveVideoPaused}) | Camera Off: ${d.quality.isVideoDisabled}`,
    `Transport: ${pair ? `${pair.localCandidateType} -> ${pair.remoteCandidateType} (${pair.localProtocol}, Relay: ${pair.isRelay})` : 'none'}`,
    `RTT: ${pair?.currentRoundTripTimeMs ?? 'N/A'} ms | BWE Out: ${pair?.availableOutgoingBitrateKbps ?? 'N/A'} kbps`,
    `Outbound Video: ${outVid ? `${outVid.framesPerSecond || 0} fps, LimReason: ${outVid.qualityLimitationReason}, Retrans: ${outVid.retransmittedPacketsSent}` : 'none'}`,
    `Inbound Video: ${inVid ? `Lost: ${inVid.packetsLost}, Jitter: ${inVid.jitterMs} ms, Dropped Frames: ${inVid.framesDropped}` : 'none'}`,
    `===============================================`
  ].join('\n');
};

// TalkHop diagnostic aliases (maintains backward compatibility for window.getVybrant...)
window.getTalkHopConnectionDiagnostics = window.getVybrantConnectionDiagnostics;
window.getTalkHopDiagnosticSummary = window.getVybrantDiagnosticSummary;
if (typeof window.getVybrantAudioDiagnostics === 'function') {
  window.getTalkHopAudioDiagnostics = window.getVybrantAudioDiagnostics;
}

// TalkHop mode & chat helpers on window for programmatic & testing access
window.selectAppMode = selectAppMode;
window.mountSharedWidgets = mountSharedWidgets;
window.appendChatMessage = appendChatMessage;
window.clearChatMessages = clearChatMessages;

// ==========================================
// BOOTSTRAP APPLICATION
// ==========================================
window.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initAgeGate();
  bindUiEventListeners();
});
