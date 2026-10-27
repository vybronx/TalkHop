const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('Running TalkHop Branding & UI Flow Verification Tests...');

const indexHtmlPath = path.join(__dirname, '..', 'public', 'index.html');
const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');

const adminHtmlPath = path.join(__dirname, '..', 'public', 'admin.html');
const adminHtml = fs.readFileSync(adminHtmlPath, 'utf8');

const appJsPath = path.join(__dirname, '..', 'public', 'app.js');
const appJs = fs.readFileSync(appJsPath, 'utf8');

// 1. BRANDING TESTS: index.html
assert.ok(indexHtml.includes('<title>TalkHop⚡ — Instant Random Chat</title>'), 'index.html must have correct browser title');
assert.ok(indexHtml.includes('content="Connect instantly with random strangers worldwide via private, encrypted peer-to-peer text chat and video calls with AI Safety Shield on TalkHop."'), 'index.html meta description must use TalkHop');
assert.ok(indexHtml.includes('property="og:title" content="TalkHop⚡ — Instant Random Chat"'), 'index.html OpenGraph title must use TalkHop');
assert.ok(indexHtml.includes('TalkHop<span class="text-amber-500 text-xl font-normal ml-0.5">⚡</span>'), 'index.html main header must feature TalkHop⚡ logo text');
assert.ok(indexHtml.includes('Instant Random Chat'), 'index.html header must have Instant Random Chat tagline');
assert.ok(indexHtml.includes('Welcome to <strong class="text-zinc-950 dark:text-white font-bold">TalkHop ⚡</strong>'), 'Age gate must welcome users to TalkHop ⚡');
assert.ok(indexHtml.includes('Enter TalkHop 🚀'), 'Age gate button must say Enter TalkHop 🚀');
assert.ok(indexHtml.includes('Leave TalkHop'), 'Ban modal button must say Leave TalkHop');
assert.ok(indexHtml.includes('TalkHop is exclusively for legal adults'), 'Guidelines modal must say TalkHop is exclusively for legal adults');
assert.ok(indexHtml.includes('TalkHop needs your webcam and microphone to connect you to video chats.'), 'Permission notice must refer to TalkHop');

// Check no user-facing accidental "Vybrant" in visible headings or buttons in index.html
const visibleVybrantMatches = indexHtml.match(/>[^<]*\bVybrant\b[^<]*</gi) || [];
assert.strictEqual(visibleVybrantMatches.length, 0, `No visible HTML elements should display old brand 'Vybrant': found ${JSON.stringify(visibleVybrantMatches)}`);

console.log('✓ index.html TalkHop branding verified.');

// 2. BRANDING TESTS: admin.html
assert.ok(adminHtml.includes('TalkHop ⚡ | Secret Admin Command Center'), 'admin.html title must use TalkHop');
assert.ok(adminHtml.includes('TalkHop Secret Admin Command Center'), 'admin.html meta description must use TalkHop');
assert.ok(adminHtml.includes('TalkHop<span class="text-purple-400">⚡</span> Admin Center'), 'admin.html login header must use TalkHop');
assert.ok(adminHtml.includes('TalkHop<span class="text-purple-400">⚡</span> Admin'), 'admin.html dashboard header must use TalkHop');

console.log('✓ admin.html TalkHop branding verified.');

// 3. MODE SELECTION & SWITCHING DOM ELEMENTS
assert.ok(indexHtml.includes('id="modeSelectionModal"'), 'index.html must have #modeSelectionModal');
assert.ok(indexHtml.includes('What would you like to do?'), 'modeSelectionModal must have heading: What would you like to do?');
assert.ok(indexHtml.includes('Meet new people around the world.'), 'modeSelectionModal must have subtitle: Meet new people around the world.');
assert.ok(indexHtml.includes('id="modeCardChat"'), 'modeSelectionModal must have Card A: #modeCardChat');
assert.ok(indexHtml.includes('id="modeCardVideo"'), 'modeSelectionModal must have Card B: #modeCardVideo');
assert.ok(indexHtml.includes('id="startChatModeBtn"'), 'Card A must have #startChatModeBtn');
assert.ok(indexHtml.includes('id="startVideoModeBtn"'), 'Card B must have #startVideoModeBtn');

// Slide-to-switch control
assert.ok(indexHtml.includes('id="modeSwitchBar"'), 'index.html must have #modeSwitchBar');
assert.ok(indexHtml.includes('id="switchModeChatBtn"'), 'modeSwitchBar must have #switchModeChatBtn');
assert.ok(indexHtml.includes('id="switchModeVideoBtn"'), 'modeSwitchBar must have #switchModeVideoBtn');
assert.ok(indexHtml.includes('id="modeSwitchSlider"'), 'modeSwitchBar must have animated slider pill');

// Video Switch Consent Modal
assert.ok(indexHtml.includes('id="videoSwitchModal"'), 'index.html must have #videoSwitchModal');
assert.ok(indexHtml.includes('id="acceptVideoSwitchBtn"'), 'videoSwitchModal must have #acceptVideoSwitchBtn');
assert.ok(indexHtml.includes('id="declineVideoSwitchBtn"'), 'videoSwitchModal must have #declineVideoSwitchBtn');
assert.ok(indexHtml.includes('id="requestVideoSwitchBtn"'), 'Chat secondary panel must have #requestVideoSwitchBtn');

// Dedicated views
assert.ok(indexHtml.includes('id="chatModeView"'), 'index.html must have #chatModeView');
assert.ok(indexHtml.includes('id="videoModeView"'), 'index.html must have #videoModeView');

console.log('✓ Mode selection, slide-to-switch, and consent modal DOM elements verified.');

// 4. CLIENT LOGIC VERIFICATION: app.js
assert.ok(appJs.includes('currentAppMode'), 'app.js must maintain currentAppMode');
assert.ok(appJs.includes('selectAppMode'), 'app.js must have selectAppMode function');
assert.ok(appJs.includes('mountSharedWidgets'), 'app.js must have mountSharedWidgets function');
assert.ok(appJs.includes('stopLocalMedia'), 'app.js must have stopLocalMedia function');
assert.ok(appJs.includes('showModeSelectionModal'), 'app.js must have showModeSelectionModal function');
assert.ok(appJs.includes('partner-requested-video-switch'), 'app.js must listen for partner-requested-video-switch');
assert.ok(appJs.includes('video-switch-accepted'), 'app.js must handle video-switch-accepted');
assert.ok(appJs.includes('video-switch-declined'), 'app.js must handle video-switch-declined');
assert.ok(appJs.includes('switched-to-text'), 'app.js must handle switched-to-text');
assert.ok(appJs.includes('window.getTalkHopConnectionDiagnostics'), 'app.js must provide getTalkHopConnectionDiagnostics alias');
assert.ok(appJs.includes('window.getTalkHopDiagnosticSummary'), 'app.js must provide getTalkHopDiagnosticSummary alias');

console.log('✓ app.js mode transitions and diagnostic aliases verified.');
console.log('All TalkHop Branding & UI Flow tests passed successfully! 🎉');
