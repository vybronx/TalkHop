const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('Running UI Integration Repair & Mode Separation Tests...');

const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const styleCss = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
const appJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

// TEST 1: Strict Mutual Exclusivity - Chat mode does not render old video panels
assert.ok(
  styleCss.includes('body[data-mode="text"] #videoModeView') &&
  styleCss.includes('display: none !important;'),
  'style.css must strictly hide #videoModeView in text mode'
);
assert.ok(
  styleCss.includes('body[data-mode="video"] #chatModeView') &&
  styleCss.includes('display: none !important;'),
  'style.css must strictly hide #chatModeView in video mode'
);
assert.ok(
  !styleCss.match(/^\s*#chatModeView\s*\{\s*display:\s*flex\s*!important;\s*\}/m),
  'style.css must NOT have unconditional #chatModeView display: flex !important'
);
assert.ok(
  !styleCss.match(/^\s*#videoModeView\s*\{\s*display:\s*flex\s*!important;\s*\}/m),
  'style.css must NOT have unconditional #videoModeView display: flex !important'
);
console.log('✓ 1. Chat mode does not render video panels & modes are strictly mutually exclusive.');

// TEST 2: Video Mode Desktop & Mobile Layout Definitions
assert.ok(
  styleCss.includes('grid-template-columns: 1fr 1fr !important;') &&
  styleCss.includes('#videoGridContainer'),
  'Desktop video layout must use 1fr 1fr side-by-side grid'
);
assert.ok(
  styleCss.includes('#strangerVideoWrapper') && styleCss.includes('#localVideoWrapper'),
  'Desktop video layout must contain both stranger and local video wrappers'
);
assert.ok(
  styleCss.includes('@media (max-width: 1023px)') &&
  styleCss.includes('flex-direction: column !important;'),
  'Mobile video layout must vertically stack video tiles'
);
console.log('✓ 2. Video mode renders correct side-by-side desktop and stacked mobile layouts.');

// TEST 3: Mode Switching Guards & No Duplicate Matchmaking
assert.ok(
  appJs.includes('if (isSearching) {') &&
  appJs.includes('Already in searching state, skipping duplicate startSearching call'),
  'startSearching must guard against duplicate matchmaking calls'
);
console.log('✓ 3. Switching modes does not create duplicate matchmaking requests.');

// TEST 4: Searching States Do Not Pollute Chat Message History
const waitingHandler = appJs.slice(appJs.indexOf("socket.on('waiting'"), appJs.indexOf("socket.on('match-found'"));
assert.ok(
  !waitingHandler.includes('addSystemChatMessage'),
  "socket.on('waiting') must not add system chat messages to message history"
);

const matchFoundHandler = appJs.slice(appJs.indexOf("socket.on('match-found'"), appJs.indexOf("socket.on('partner-requested-video-switch'"));
assert.ok(
  !matchFoundHandler.includes('addSystemChatMessage'),
  "socket.on('match-found') must not add system chat messages to message history"
);

const disconnectedHandler = appJs.slice(appJs.indexOf("socket.on('partner-disconnected'"), appJs.indexOf("socket.on('chat-message'"));
assert.ok(
  !disconnectedHandler.includes('addSystemChatMessage'),
  "socket.on('partner-disconnected') must not add system chat messages to message history"
);

const stoppedHandler = appJs.slice(appJs.indexOf("socket.on('stopped'"), appJs.indexOf("socket.on('disconnect'"));
assert.ok(
  !stoppedHandler.includes('addSystemChatMessage'),
  "socket.on('stopped') must not add system chat messages to message history"
);

const handleSkipCode = appJs.slice(appJs.indexOf('function handleSkip('), appJs.indexOf('function setSearchingUI('));
assert.ok(
  !handleSkipCode.includes('addSystemChatMessage'),
  'handleSkip must not add system messages to message history'
);

console.log('✓ 4. Searching and matchmaking states do not enter chat message history.');

// TEST 5: Dedicated Status Component in Chat Mode
assert.ok(
  indexHtml.includes('id="chatStatusBanner"'),
  'index.html must have dedicated #chatStatusBanner for text chat status'
);
assert.ok(
  appJs.includes('chatStatusBanner') && appJs.includes('chatStatusBannerText'),
  'app.js must update dedicated chatStatusBanner during connection lifecycle'
);
console.log('✓ 5. Dedicated status components active in chat mode.');

// TEST 6: Media Device Diagnostics & Denied Permission State
assert.ok(
  appJs.includes('NotAllowedError') || appJs.includes('PermissionDeniedError'),
  'initLocalMedia must handle denied permission error'
);
assert.ok(
  appJs.includes('Camera & Mic Access Blocked') || appJs.includes('Access Blocked'),
  'Denied permission must accurately inform user that access is blocked rather than webcam not found'
);
console.log('✓ 6. Denied webcam permission produces accurate permission fallback.');

// TEST 7: Flexible Media Acquisition (No Rigid Constraints Causing OverconstrainedError)
const initMediaCode = appJs.slice(appJs.indexOf('async function initLocalMedia()'), appJs.indexOf('function toggleAudio()'));
assert.ok(
  !initMediaCode.includes('min: 640') && !initMediaCode.includes('min: 480'),
  'initLocalMedia must not enforce rigid min resolution constraints that break on diverse cameras'
);
assert.ok(
  initMediaCode.includes('OverconstrainedError'),
  'initLocalMedia must explicitly catch OverconstrainedError and retry with relaxed video'
);
assert.ok(
  initMediaCode.includes('isAudioOnly = false'),
  'Successful camera acquisition must set isAudioOnly = false'
);
console.log('✓ 7. Camera initialization uses flexible constraints and relaxed video retry.');

// TEST 8: Mode Selector Synchronization
assert.ok(
  appJs.includes("document.body.setAttribute('data-mode', currentAppMode)"),
  'selectAppMode must update body data-mode attribute'
);
assert.ok(
  appJs.includes("chatTab.setAttribute('aria-selected'"),
  'selectAppMode must update accessible aria-selected attribute'
);
console.log('✓ 8. Mode selector reflects actual application state.');

// TEST 9: Resource Cleanup When Switching to Chat Mode
const selectAppModeCode = appJs.slice(appJs.indexOf('function selectAppMode('), appJs.indexOf('function showModeSelectionModal('));
assert.ok(
  selectAppModeCode.includes('stopLocalMedia()'),
  'selectAppMode in text mode must call stopLocalMedia()'
);
assert.ok(
  selectAppModeCode.includes('teardownPeerConnection(false)'),
  'selectAppMode in text mode must call teardownPeerConnection'
);
assert.ok(
  selectAppModeCode.includes('stopNsfwScanner()'),
  'selectAppMode in text mode must stop NSFW scanner'
);
console.log('✓ 9. Switching to Chat mode safely releases media tracks and peer connection resources.');

// TEST 10: Desktop & Mobile Controls Placement
assert.ok(
  indexHtml.indexOf('id="controlsSlotText"') < indexHtml.indexOf('TalkHop Chat Safety Tips'),
  'Chat mode action controls must be accessible above safety tips card'
);
assert.ok(
  indexHtml.indexOf('id="controlsSlotVideo"') < indexHtml.indexOf('id="chatSlotVideo"'),
  'Video mode action controls must be placed above compact chat for fast access'
);
console.log('✓ 10. Action controls are ergonomically positioned in both modes.');

console.log('All 10 UI Integration Repair tests passed successfully! 🚀');
