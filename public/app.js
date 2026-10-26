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
    {
      urls: "stun:stun.relay.metered.ca:80",
    },
    {
      urls: "turn:global.relay.metered.ca:80",
      username: "1654f590900e48e1a4ae720e",
      credential: "uc4KT1+bOvxoS9js",
    },
    {
      urls: "turn:global.relay.metered.ca:80?transport=tcp",
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
  iceCandidatePoolSize: 10,
  bundlePolicy: 'max-bundle',
  rtcpMuxPolicy: 'require'
};

// ==========================================
// APPLICATION STATE
// ==========================================
let socket = null;
let localStream = null;
let peerConnection = null;
let dataChannel = null;
let currentPartnerId = null;
let isInitiator = false;
let isSearching = false;
let isAudioMuted = false;
let isVideoDisabled = false;
let currentFacingMode = 'user'; // 'user' (front selfie) or 'environment' (back camera)
let isFlippingCamera = false;
let isMediaRequesting = false;
let pendingIceCandidates = [];
let antiFlashInterval = null;
let typingTimeout = null;
let lastSkipTime = 0;
let remoteAudioMonitor = null;

// VIP & Matchmaking State
let consecutiveSkips = 0;
let matchCount = 0;
let isVip = false;
let vipCode = localStorage.getItem('vybrant_vip_code') || localStorage.getItem('blip_vip_code') || null;
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
// THEME CONTROLLER (Light-First Adaptive Theme)
// ==========================================
let themeInitialized = false;

function initTheme() {
  const savedTheme = localStorage.getItem('vybrant_theme') || 'light';
  applyTheme(savedTheme);

  if (themeInitialized) return;
  themeInitialized = true;

  const toggleBtn = document.getElementById('themeToggleBtn');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      const isCurrentlyDark = document.documentElement.classList.contains('dark');
      const newTheme = isCurrentlyDark ? 'light' : 'dark';
      applyTheme(newTheme);
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
applyTheme(localStorage.getItem('vybrant_theme') || 'light');

// ==========================================
// TOAST NOTIFICATIONS (De-duplicated & Anti-Spam)
// ==========================================
function showToast(message, type = 'info', duration = 3500) {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  // 1. Prevent duplicate toasts with identical content
  const existingToasts = container.querySelectorAll('.vybrant-toast');
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

  toast.className = `vybrant-toast pointer-events-auto flex items-center space-x-2 px-4 py-2.5 rounded-xl border shadow-xl backdrop-blur-xl text-xs font-semibold ${bgColors[type] || bgColors.info} transform transition-all duration-300 translate-y-3 opacity-0`;
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
// 1. AGE GATE INITIALIZATION
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
  const savedGender = localStorage.getItem('vybrant_my_gender') || userPreferences.myGender || 'male';
  let chosenGender = savedGender;

  function updateAgeGenderUI(gender) {
    chosenGender = gender;
    userPreferences.myGender = gender;
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

    // Sync with the in-app gender buttons
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
  const isVerified = sessionStorage.getItem('vybrant_age_verified') || sessionStorage.getItem('blip_age_verified');
  if (isVerified === 'true') {
    ageGateModal.style.display = 'none';
    initLocalMedia();
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
      showToast('⚠️ Please check "I am 18+" to enter Vybrant.', 'warning', 3000);
      return;
    }

    sessionStorage.setItem('vybrant_age_verified', 'true');
    localStorage.setItem('vybrant_my_gender', chosenGender);
    ageGateModal.style.display = 'none';
    if (socket) {
      socket.emit('update-preferences', userPreferences);
    }
    initLocalMedia();
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

  if (grantPermissionBtn) {
    grantPermissionBtn.disabled = true;
    grantPermissionBtn.innerHTML = `<span>⏳ Requesting Access...</span>`;
  }

  let isAudioOnly = false;

  try {
    // 1. Primary Attempt: Request Video + Audio
    const constraints = {
      video: {
        width: { ideal: 1280, min: 640 },
        height: { ideal: 720, min: 480 },
        facingMode: 'user'
      },
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    };

    try {
      localStream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (camErr) {
      console.warn('[Media] Video + Audio failed, testing for missing camera hardware:', camErr.name, camErr.message);

      // Check if error is due to missing camera hardware or constraint errors
      const isCameraHardwareError =
        camErr.name === 'NotFoundError' ||
        camErr.name === 'DevicesNotFoundError' ||
        camErr.name === 'OverconstrainedError' ||
        camErr.name === 'NotReadableError' ||
        camErr.name === 'TrackStartError' ||
        (camErr.message && /camera|video|device|found|constraint/i.test(camErr.message));

      // Retry requesting audio-only if camera is missing or unavailable
      if (isCameraHardwareError || (camErr.name !== 'NotAllowedError' && camErr.name !== 'PermissionDeniedError')) {
        console.log('[Media] Retrying with Audio-Only fallback...');
        localStream = await navigator.mediaDevices.getUserMedia({
          video: false,
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        });
        isAudioOnly = true;
      } else {
        throw camErr;
      }
    }

    // Attach stream to local video element
    if (localVid) {
      localVid.srcObject = localStream;
      localVid.play().catch(() => {});
    }

    // Cleanly hide the warning overlay
    if (cameraPermissionNotice) {
      cameraPermissionNotice.classList.add('hidden');
      cameraPermissionNotice.style.display = 'none';
    }

    if (grantPermissionBtn) {
      grantPermissionBtn.disabled = false;
      grantPermissionBtn.innerHTML = `<span>Allow Camera & Mic</span>`;
    }

    if (isAudioOnly) {
      // Audio-only fallback UI presentation
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
        localCamBtn.title = 'No Webcam Detected (Audio Only Mode)';
        localCamBtn.classList.add('opacity-60');
      }
      showToast('🎙️ Webcam not found. Audio-Only voice chat active!', 'info', 3500);
    } else {
      // Full video + audio mode UI
      if (audioOnlyPlaceholder) {
        audioOnlyPlaceholder.classList.add('hidden');
        audioOnlyPlaceholder.style.display = 'none';
      }
      if (localVideoPlaceholder) {
        localVideoPlaceholder.classList.add('hidden');
        localVideoPlaceholder.style.display = 'none';
      }
      if (localBadgeText) {
        localBadgeText.textContent = 'You (Local)';
      }
      if (localCamBtn) {
        localCamBtn.title = 'Turn Camera On/Off';
        localCamBtn.classList.remove('opacity-60');
      }
      showToast('Camera and microphone connected! 📹', 'success', 2500);
      initNsfwShield();
    }

    initSocketConnection();

  } catch (err) {
    console.warn('[Media] getUserMedia error:', err.name || err);

    // Show single, clean status alert inside the video frame
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

    let userFriendlyError = 'Camera & microphone required to chat.';
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      userFriendlyError = 'Media permissions blocked in browser. Click the lock/camera icon in your address bar to enable.';
      if (cameraNoticeTitle) cameraNoticeTitle.textContent = 'Access Blocked';
      if (cameraNoticeDesc) cameraNoticeDesc.textContent = 'Microphone/camera access was blocked. Please enable permissions in your browser URL bar.';
    } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
      userFriendlyError = 'No microphone or webcam found on your device.';
      if (cameraNoticeTitle) cameraNoticeTitle.textContent = 'No Hardware Found';
      if (cameraNoticeDesc) cameraNoticeDesc.textContent = 'Please plug in a microphone or headset to start chatting.';
    } else {
      if (cameraNoticeTitle) cameraNoticeTitle.textContent = 'Audio Access Required';
      if (cameraNoticeDesc) cameraNoticeDesc.textContent = 'Vybrant needs microphone access to connect you to voice and text chats.';
    }

    // Single user-friendly notification toast (never duplicate or stack)
    showToast(`⚠️ ${userFriendlyError}`, 'warning', 4000);

    // Initialize socket connection regardless so user can browse/redeem
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

// Flip Camera between 'user' (Front Selfie) and 'environment' (Rear Back) without dropping WebRTC call
async function flipCamera() {
  if (isFlippingCamera) return;

  if (!localStream) {
    showToast('⚠️ Camera not initialized yet', 'warning', 2000);
    return;
  }

  const currentVideoTrack = localStream.getVideoTracks()[0];
  if (!currentVideoTrack) {
    showToast('⚠️ No active webcam (Audio-Only mode active)', 'warning', 2500);
    return;
  }

  isFlippingCamera = true;
  const targetFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';

  const flipBtn = document.getElementById('flipCamBtn');
  const flipIcon = document.getElementById('flipCamIcon');

  if (flipBtn) flipBtn.classList.add('bg-purple-600/40');
  if (flipIcon) flipIcon.classList.add('rotate-180');

  try {
    let newStream = null;

    // 1. Request new video track with target facingMode
    try {
      newStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { exact: targetFacingMode },
          width: { ideal: 1280, min: 640 },
          height: { ideal: 720, min: 480 }
        },
        audio: false
      });
    } catch (exactErr) {
      console.warn('[Camera] Exact facingMode request failed, falling back to ideal constraint:', exactErr.name);
      newStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: targetFacingMode,
          width: { ideal: 1280, min: 640 },
          height: { ideal: 720, min: 480 }
        },
        audio: false
      });
    }

    const newVideoTrack = newStream.getVideoTracks()[0];
    if (!newVideoTrack) {
      throw new Error('No video track available');
    }

    // 2. Seamlessly update active WebRTC connection without dropping the call
    if (peerConnection) {
      const senders = peerConnection.getSenders();
      const videoSender = senders.find(s => s.track && s.track.kind === 'video');
      if (videoSender) {
        await videoSender.replaceTrack(newVideoTrack);
        console.log('[WebRTC] Seamlessly swapped video track on active peer connection.');
      }
    }

    // 3. Remove and release previous hardware track
    localStream.removeTrack(currentVideoTrack);
    currentVideoTrack.stop();

    // 4. Add new track to existing local stream
    localStream.addTrack(newVideoTrack);

    // 5. Update local video preview and horizontal mirror transform
    const localVid = document.getElementById('localVideo');
    if (localVid) {
      localVid.srcObject = localStream;
      localVid.play().catch(() => {});

      if (targetFacingMode === 'environment') {
        // Rear camera should NOT be mirrored horizontally
        localVid.style.transform = 'scaleX(1)';
        localVid.style.webkitTransform = 'scaleX(1)';
      } else {
        // Front camera should be mirrored horizontally for natural user experience
        localVid.style.transform = 'scaleX(-1)';
        localVid.style.webkitTransform = 'scaleX(-1)';
      }
    }

    currentFacingMode = targetFacingMode;
    const modeLabel = currentFacingMode === 'environment' ? 'Rear (Back) Camera 📷' : 'Front (Selfie) Camera 🤳';
    showToast(`Switched to ${modeLabel}`, 'success', 2200);

  } catch (err) {
    console.warn('[Camera] Flip camera error:', err.name || err.message);
    if (err.name === 'OverconstrainedError' || err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
      showToast('⚠️ No secondary/rear camera found on this device', 'warning', 3000);
    } else {
      showToast('⚠️ Could not switch camera source', 'warning', 2500);
    }
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
  }, 1500);
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

// ==========================================
// SOCKET.IO SIGNALING & MATCHMAKING
// ==========================================
function initSocketConnection() {
  if (socket) return;

  socket = io({
    transports: ['websocket', 'polling']
  });

  socket.on('connect', () => {
    console.log('[Socket] Connected with ID:', socket.id);
    if (vipCode) {
      activateVipCode(vipCode, false);
    }
    startSearching();
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
    setSearchingUI(true);
    addSystemChatMessage(data.message || 'Looking for a stranger...');
  });

  socket.on('match-found', async (data) => {
    console.log('[Match] Paired with stranger:', data);
    currentPartnerId = data.partnerId;
    isInitiator = Boolean(data.initiator);
    matchCount++;

    setSearchingUI(false);
    clearChatMessages();
    addSystemChatMessage('✨ You are now paired with a stranger. Say hello!');

    if (matchCount % 5 === 0 && matchCount > 0) {
      injectSponsorMessage();
    }

    await setupPeerConnection();
    startAntiFlashShield();
    startNsfwScanner();

    if (isInitiator) {
      setupDataChannelAsInitiator();
      createAndSendOffer();
    }
  });

  socket.on('match-notice', (data) => {
    if (data && data.message) {
      addSystemChatMessage(`⚡ ${data.message}`);
      showToast(data.message, 'info', 3000);
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
      await peerConnection.setLocalDescription(answer);

      socket.emit('answer', { answer });
    } catch (err) {
      console.error('[WebRTC] Error handling offer:', err);
    }
  });

  socket.on('answer', async (data) => {
    try {
      if (peerConnection) {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
        drainPendingIceCandidates();
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

  socket.on('partner-disconnected', (data) => {
    teardownPeerConnection();
    stopNsfwScanner();
    addSystemChatMessage(data.message || '👋 Stranger has disconnected.');
    const strangerBadge = document.getElementById('strangerBadgeText');
    const statusDot = document.getElementById('strangerStatusDot');
    if (strangerBadge) strangerBadge.textContent = 'Disconnected';
    if (statusDot) statusDot.className = 'w-2 h-2 rounded-full bg-rose-500';
    showToast(data.message || 'Stranger skipped.', 'info', 2500);

    setTimeout(() => {
      handleSkip();
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
    addSystemChatMessage('Search stopped. Click Start to resume.');
    const matchText = document.getElementById('toggleMatchText');
    const matchIcon = document.getElementById('toggleMatchIcon');
    if (matchText) matchText.textContent = 'Start';
    if (matchIcon) matchIcon.textContent = '▶';
    isSearching = false;
  });

  socket.on('disconnect', () => {
    showToast('Disconnected from server. Reconnecting...', 'warning');
    teardownPeerConnection();
    stopNsfwScanner();
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

  peerConnection = new RTCPeerConnection(RTC_CONFIG);

  if (localStream) {
    localStream.getTracks().forEach((track) => {
      peerConnection.addTrack(track, localStream);
    });
  }

  peerConnection.ontrack = (event) => {
    const remoteVid = document.getElementById('remoteVideo');
    const statusDot = document.getElementById('strangerStatusDot');
    const badgeText = document.getElementById('strangerBadgeText');

    if (remoteVid && remoteVid.srcObject !== event.streams[0]) {
      remoteVid.srcObject = event.streams[0];
      if (statusDot) statusDot.className = 'w-2 h-2 rounded-full bg-emerald-400';
      if (badgeText) badgeText.textContent = 'Connected (P2P)';

      monitorRemoteAudio(event.streams[0]);
    }
  };

  peerConnection.onicecandidate = (event) => {
    if (event.candidate && socket) {
      socket.emit('ice-candidate', { candidate: event.candidate });
    }
  };

  peerConnection.onconnectionstatechange = () => {
    const state = peerConnection.connectionState;
    const statusDot = document.getElementById('strangerStatusDot');
    const badgeText = document.getElementById('strangerBadgeText');
    const p2pBadge = document.getElementById('networkP2pBadge');

    if (state === 'connected') {
      if (statusDot) statusDot.className = 'w-2 h-2 rounded-full bg-emerald-400';
      if (badgeText) badgeText.textContent = 'Connected (Live)';
      if (p2pBadge) p2pBadge.textContent = 'Encrypted P2P';
    } else if (state === 'disconnected' || state === 'failed') {
      if (statusDot) statusDot.className = 'w-2 h-2 rounded-full bg-rose-500';
      if (badgeText) badgeText.textContent = 'Connection Lost';
    }
  };

  peerConnection.ondatachannel = (event) => {
    dataChannel = event.channel;
    bindDataChannelEvents(dataChannel);
  };
}

async function createAndSendOffer() {
  try {
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit('offer', { offer });
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
    try { remoteAudioMonitor.disconnect(); } catch (e) {}
    remoteAudioMonitor = null;
  }
  if (audioIndicator) audioIndicator.classList.add('hidden');

  if (dataChannel) {
    try { dataChannel.close(); } catch (e) {}
    dataChannel = null;
  }

  if (peerConnection) {
    try { peerConnection.close(); } catch (e) {}
    peerConnection = null;
  }

  pendingIceCandidates = [];
  currentPartnerId = null;

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

    const ctx = new AudioCtx();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const checkVolume = () => {
      if (!peerConnection || peerConnection.connectionState !== 'connected') {
        ctx.close();
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

// ==========================================
// MATCHMAKING ACTIONS (START / SKIP / REPORT)
// ==========================================
function startSearching() {
  if (!socket) return;
  isSearching = true;
  const matchText = document.getElementById('toggleMatchText');
  const matchIcon = document.getElementById('toggleMatchIcon');
  if (matchText) matchText.textContent = 'Stop';
  if (matchIcon) matchIcon.textContent = '⏹';

  socket.emit('start-search', { preferences: userPreferences });
  setSearchingUI(true);
}

function stopSearching() {
  if (!socket) return;
  isSearching = false;
  const matchText = document.getElementById('toggleMatchText');
  const matchIcon = document.getElementById('toggleMatchIcon');
  if (matchText) matchText.textContent = 'Start';
  if (matchIcon) matchIcon.textContent = '▶';
  socket.emit('stop-search');
}

function handleSkip(isReport = false) {
  const now = Date.now();
  if (now - lastSkipTime < 300) return;
  lastSkipTime = now;

  consecutiveSkips++;
  teardownPeerConnection();
  stopNsfwScanner();
  setSearchingUI(true);

  if (isReport) {
    socket.emit('report-peer', {
      reason: 'User reported peer for inappropriate or non-consensual behavior',
      preferences: userPreferences
    });
    showToast('🚩 Report submitted. Searching for someone new...', 'warning');
    addSystemChatMessage('🚩 You reported and skipped this stranger.');
  } else {
    socket.emit('skip', { preferences: userPreferences });
    addSystemChatMessage('⏭️ Skipped. Looking for someone new...');
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

  if (searching) {
    if (radarOverlay) radarOverlay.classList.remove('hidden');
    if (radarTitle) radarTitle.textContent = 'Looking for someone awesome...';
    if (statusDot) statusDot.className = 'w-2 h-2 rounded-full bg-amber-400 animate-pulse';
    if (badgeText) badgeText.textContent = 'Searching...';
  } else {
    if (radarOverlay) radarOverlay.classList.add('hidden');
  }
}

// ==========================================
// SMART CHAT TRIGGERS & PROMPTS
// ==========================================
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
  chatMessages.scrollTo({ top: chatMessages.scrollHeight, behavior: 'smooth' });
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
  chatMessages.scrollTo({ top: chatMessages.scrollHeight, behavior: 'smooth' });
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
  } else {
    msgWrapper.className += ' items-start';
    msgWrapper.innerHTML = `
      <div class="max-w-[85%] rounded-2xl rounded-tl-sm bg-zinc-100 dark:bg-white/10 text-zinc-900 dark:text-white px-4 py-2.5 shadow-xs">
        <p class="leading-relaxed break-words text-xs sm:text-sm">${escapeHtml(text)}</p>
      </div>
      <span class="text-[11px] text-zinc-400 dark:text-slate-500 mt-1 ml-1">${timeString}</span>
    `;
  }

  chatMessages.appendChild(msgWrapper);
  chatMessages.scrollTo({ top: chatMessages.scrollHeight, behavior: 'smooth' });
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
  chatMessages.scrollTo({ top: chatMessages.scrollHeight, behavior: 'smooth' });
}

function clearChatMessages() {
  const chatMessages = document.getElementById('chatMessages');
  if (chatMessages) chatMessages.innerHTML = '';
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
}

// ==========================================
// DOM BINDINGS & EVENT LISTENERS
// ==========================================
function bindUiEventListeners() {
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
          if (codeEl) codeEl.textContent = code;
          if (detEl) detEl.textContent = `${plan === '12-hour' ? '12-Hour' : '1-Hour'} Pass (₹${price}) • 1-Device Concurrency Lock`;

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
          const options = {
            key: orderData.key_id,
            amount: orderData.amount,
            currency: orderData.currency || 'INR',
            name: 'Vybrant ⚡ Video Engine',
            description: `${selectedPlan === '12-hour' ? '12-Hour' : '1-Hour'} VIP Micro-Pass`,
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
              name: 'Vybrant User',
              email: 'guest@vybrant.vybronx.online',
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
}

// ==========================================
// BOOTSTRAP APPLICATION
// ==========================================
window.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initAgeGate();
  bindUiEventListeners();
});
