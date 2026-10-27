const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');

console.log('Running TalkHop Admin Command Center Redesign & Theme System Tests...');

const adminHtmlPath = path.join(__dirname, '..', 'public', 'admin.html');
assert.ok(fs.existsSync(adminHtmlPath), 'admin.html must exist');
const adminHtml = fs.readFileSync(adminHtmlPath, 'utf8');

// 1. BRANDING VERIFICATION
assert.ok(adminHtml.includes('TalkHop ⚡ | Secret Admin Command Center'), 'admin.html title must be TalkHop ⚡ | Secret Admin Command Center');
assert.ok(adminHtml.includes('TalkHop<span class="text-purple-400">⚡</span> Admin Center'), 'admin.html login header branding verified');
assert.ok(adminHtml.includes('TalkHop<span class="text-purple-500">⚡</span> Admin</span>'), 'admin.html dashboard header branding verified');
assert.ok(adminHtml.includes('Live Telemetry & VIP Controller'), 'admin.html subtitle must contain Live Telemetry & VIP Controller');
assert.ok(adminHtml.includes('Live Traffic Overview'), 'admin.html must contain Live Traffic Overview heading');
console.log('✓ 1. TalkHop Admin branding and headings strictly verified.');

// 2. THEME SYSTEM VERIFICATION
assert.ok(adminHtml.includes('talkhop_admin_theme'), 'admin.html must persist theme in localStorage as talkhop_admin_theme');
assert.ok(adminHtml.includes('id="adminThemeToggleBtn"'), 'admin.html must have #adminThemeToggleBtn');
assert.ok(adminHtml.includes('--bg-page:'), 'admin.html must define CSS custom property --bg-page');
assert.ok(adminHtml.includes('--bg-card:'), 'admin.html must define CSS custom property --bg-card');
assert.ok(adminHtml.includes('prefers-color-scheme: dark'), 'admin.html must check prefers-color-scheme for zero-flash load');
console.log('✓ 2. Dark/Light mode theme system and CSS tokens verified.');

// 3. PERSISTENT SIDEBAR NAVIGATION SYSTEM
const requiredNavItems = [
  'dashboard',
  'analytics',
  'users',
  'calls',
  'queue',
  'vip-passes',
  'vip-generator',
  'reports',
  'ip-bans',
  'blocked-users',
  'sponsor',
  'revenue',
  'diagnostics',
  'settings'
];

requiredNavItems.forEach(navId => {
  assert.ok(
    adminHtml.includes(`data-nav="${navId}"`),
    `Sidebar must contain navigation button for data-nav="${navId}"`
  );
  assert.ok(
    adminHtml.includes(`id="view-${navId}"`),
    `Content container must contain view section for id="view-${navId}"`
  );
});
assert.ok(adminHtml.includes('id="adminSidebar"'), 'Must have persistent sidebar #adminSidebar');
assert.ok(adminHtml.includes('id="systemHealthBadge"'), 'Sidebar must have health indicator #systemHealthBadge');
console.log('✓ 3. Persistent sidebar navigation and all 14 domain views verified.');

// 4. MAIN DASHBOARD OVERVIEW COMPONENTS
const kpiCards = [
  'statTotalOnline',
  'statInCall',
  'statInQueue',
  'statVipCount',
  'statBannedCount',
  'statUptime'
];
kpiCards.forEach(id => {
  assert.ok(adminHtml.includes(`id="${id}"`), `Main overview must have KPI card #${id}`);
});

assert.ok(adminHtml.includes('id="trafficChartCanvas"'), 'Must have canvas #trafficChartCanvas for Traffic & Sessions chart');
assert.ok(adminHtml.includes('id="countryStatsContainer"'), 'Must have #countryStatsContainer for demographic distribution');
assert.ok(adminHtml.includes('id="donutMaleSegment"'), 'Must have #donutMaleSegment for Gender Donut');
assert.ok(adminHtml.includes('id="donutFemaleSegment"'), 'Must have #donutFemaleSegment for Gender Donut');
assert.ok(adminHtml.includes('id="quickVipTableBody"'), 'Must have #quickVipTableBody for quick VIP overview');
assert.ok(adminHtml.includes('id="quickBansTableBody"'), 'Must have #quickBansTableBody for quick safety bans overview');
assert.ok(adminHtml.includes('id="recentActivityList"'), 'Must have #recentActivityList for real admin audit log');
console.log('✓ 4. Main Dashboard KPI cards, chart canvas, user distribution, and audit log verified.');

// 5. BACKEND AUDIT LOG & DETAILED SESSIONS INTEGRATION
const serverJsPath = path.join(__dirname, '..', 'server.js');
const serverJs = fs.readFileSync(serverJsPath, 'utf8');

assert.ok(serverJs.includes('logAdminActivity('), 'server.js must log administrative actions');
assert.ok(serverJs.includes('adminAuditLog'), 'server.js must maintain in-memory admin audit log');
assert.ok(serverJs.includes('trafficHistory'), 'server.js must maintain rolling traffic history snapshots');
assert.ok(serverJs.includes('/api/admin/dismiss-report'), 'server.js must provide /api/admin/dismiss-report endpoint');
assert.ok(serverJs.includes('/api/admin/kick-user'), 'server.js must provide /api/admin/kick-user endpoint');
console.log('✓ 5. Server admin audit logging, traffic history, and moderation endpoints verified.');

// 6. CLIENT VIP 3-PASS & ADMIN COLLAPSIBLE SIDEBAR VERIFICATION
const indexHtmlPath = path.join(__dirname, '..', 'public', 'index.html');
const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');

// Client 3rd VIP pass checks
assert.ok(indexHtml.includes('value="1-hour"'), 'index.html must have 1-hour VIP pass');
assert.ok(indexHtml.includes('value="12-hour"'), 'index.html must have 12-hour VIP pass');
assert.ok(indexHtml.includes('value="24-hour"'), 'index.html must have 24-hour VIP pass');
assert.ok(indexHtml.includes('24-Hour VIP Pass'), 'index.html must display 24-Hour VIP Pass label');
assert.ok(indexHtml.includes('₹59'), 'index.html must display ₹59 price for 24-hour pass');

// Backend payment support for 3 passes
assert.ok(serverJs.includes("plan === '24-hour'"), 'server.js must support 24-hour VIP pass in payment endpoints');

// Admin collapsible navigation checks
assert.ok(adminHtml.includes('id="sidebarRailToggleBtn"'), 'admin.html must have #sidebarRailToggleBtn for rail collapse');
assert.ok(adminHtml.includes('id="toggleAllSectionsBtn"'), 'admin.html must have #toggleAllSectionsBtn to collapse/expand all sections');
assert.ok(adminHtml.includes('class="sidebar-nav-section"'), 'admin.html must have .sidebar-nav-section accordions');
assert.ok(adminHtml.includes('class="section-toggle-btn'), 'admin.html must have .section-toggle-btn buttons');
assert.ok(adminHtml.includes('id="themeSunIcon"'), 'admin.html must have crisp SVG theme icons');
console.log('✓ 6. Client 3 VIP passes and Admin collapsible sidebar accordions verified.');

console.log('All TalkHop Admin Command Center Redesign tests passed successfully! 🚀');
process.exit(0);

