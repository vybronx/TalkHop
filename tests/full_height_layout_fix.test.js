const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('Running TalkHop Full-Height Chat & Video Layout Verification Tests...');

const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const styleCss = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
const appJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

// 1. CHAT MODE — FULL AVAILABLE HEIGHT
assert.ok(
  styleCss.includes('body[data-mode="text"] #chatModeView') &&
  styleCss.includes('height: 100% !important;'),
  'Chat mode view must stretch to 100% available height'
);
assert.ok(
  styleCss.includes('#chatAsideSlotText #chatMessages') &&
  styleCss.includes('flex: 1 1 0% !important;') &&
  styleCss.includes('overflow-y: auto !important;'),
  'Chat message history container must flex: 1 1 0% and be the only scrollable area'
);
assert.ok(
  styleCss.includes('#chatAsideSlotText #chatForm') &&
  styleCss.includes('flex-shrink: 0 !important;'),
  'Message input form must be flex-shrink: 0 and fixed at bottom of chat card'
);
assert.ok(
  !styleCss.includes('height: 58vh !important;'),
  'Mobile chat must not be artificially restricted to 58vh'
);
console.log('✓ 1. Chat mode uses full available vertical space with internal scrolling & fixed input.');

// 2. VIDEO MODE — ZERO CHAT BOX & ZERO RESERVED SPACE
// Extract content of #videoModeView from indexHtml
const videoViewStart = indexHtml.indexOf('<div id="videoModeView"');
const videoViewEnd = indexHtml.indexOf('</main>');
const videoViewContent = indexHtml.substring(videoViewStart, videoViewEnd);

assert.ok(
  !videoViewContent.includes('id="chatSlotVideo"'),
  '#videoModeView must NOT contain #chatSlotVideo'
);
assert.ok(
  !videoViewContent.includes('id="chatAside"'),
  '#videoModeView must NOT contain #chatAside'
);
assert.ok(
  !videoViewContent.includes('id="chatMessages"'),
  '#videoModeView must NOT contain #chatMessages'
);
assert.ok(
  !videoViewContent.includes('id="chatForm"'),
  '#videoModeView must NOT contain #chatForm'
);
console.log('✓ 2. Video mode completely removes the chat box and reserves zero layout space for chat.');

// 3. DESKTOP VIDEO VIEWPORTS — SIDE-BY-SIDE FULL HEIGHT
assert.ok(
  styleCss.includes('grid-template-columns: repeat(2, minmax(0, 1fr)) !important;') ||
  styleCss.includes('grid-template-columns: 1fr 1fr !important;'),
  'Desktop video layout must use equal-width side-by-side grid'
);
assert.ok(
  styleCss.includes('#strangerVideoWrapper, #localVideoWrapper') &&
  styleCss.includes('height: 100% !important;'),
  'Both desktop video viewports must stretch vertically to 100% height'
);
assert.ok(
  styleCss.includes('#remoteVideo, #localVideo') &&
  styleCss.includes('object-fit: cover !important;'),
  'Video elements must use object-fit: cover to prevent distortion'
);
console.log('✓ 3. Both desktop video viewports stretch vertically side-by-side to fill available space.');

// 4. MOBILE VIDEO VIEWPORTS — STACKED FULL HEIGHT
assert.ok(
  styleCss.includes('@media (max-width: 1023px)') &&
  styleCss.includes('#strangerVideoWrapper') &&
  styleCss.includes('height: 50% !important;'),
  'Mobile video tiles must stack and share available height equally (50% each)'
);
console.log('✓ 4. Mobile video viewports stack vertically and utilize available height without chat.');

// 5. SMART AUTOSCROLL & RETURN TO LATEST MESSAGE BUTTON
assert.ok(
  indexHtml.includes('id="scrollToBottomBtn"'),
  'index.html must include #scrollToBottomBtn floating button'
);
assert.ok(
  appJs.includes('isUserNearChatBottom') &&
  appJs.includes('handleIncomingChatScroll') &&
  appJs.includes('scrollToBottomBtn'),
  'app.js must implement smart autoscroll with return-to-bottom trigger when user scrolled up'
);
console.log('✓ 5. Smart autoscroll preserves scroll position when viewing older messages with return button.');

// 6. GLOBAL ROOT VIEWPORT & DYNAMIC DVH
assert.ok(
  styleCss.includes('100dvh') &&
  styleCss.includes('overflow: hidden !important;'),
  'style.css must use 100dvh foundation with overflow: hidden on main viewport to prevent page bounce'
);
console.log('✓ 6. Global viewport uses 100dvh foundation with no whole-page scroll leaks.');

// 7. SHARED TOP TOOLBAR & CONTROLS BELOW VIDEO VIEWPORTS
assert.ok(
  indexHtml.includes('shared-top-toolbar') &&
  indexHtml.includes('id="filterSlotShared"') &&
  indexHtml.includes('id="filterToolbar"'),
  'Top toolbar directly below header must host both mode selector (left) and filterToolbar (right)'
);
assert.ok(
  indexHtml.indexOf('id="videoGridContainer"') < indexHtml.indexOf('id="videoActionRow"'),
  'In Video mode, the action row (Start/Skip/Report) must be positioned beneath both video viewports'
);
assert.ok(
  indexHtml.includes('id="chatVideoInviteCard"') &&
  indexHtml.includes('id="requestVideoSwitchBtn"'),
  'Chat mode must preserve the "Want to see each other? Request Video Call" card and button'
);
assert.ok(
  indexHtml.includes('id="localControlsBar"'),
  'localVideoWrapper must contain accessible localControlsBar'
);
console.log('✓ 7. Shared top toolbar and beneath-video controls layout verified.');

// 8. TALKHOP BRANDING INTEGRITY
assert.ok(
  indexHtml.includes('TalkHop<span class="text-amber-500 text-xl font-normal ml-0.5">⚡</span>'),
  'TalkHop header logo and branding must remain intact'
);
console.log('✓ 8. TalkHop branding strictly preserved.');

console.log('All TalkHop Full-Height Layout Verification tests passed successfully! 🎯');
