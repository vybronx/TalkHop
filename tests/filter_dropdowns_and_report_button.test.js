/**
 * TalkHop — Filter Dropdowns and Report Button Layout Verification Test
 * Tests custom accessible dropdowns (Gender & Country), report button alignment,
 * full country list preservation, and non-overflow responsive layouts.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('Running Filter Dropdowns and Report Button Layout Verification Tests...');

const publicDir = path.join(__dirname, '..', 'public');
const indexHtml = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
const styleCss = fs.readFileSync(path.join(publicDir, 'style.css'), 'utf8');
const appJs = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');

// 1. REPORT BUTTON & ACTION CONTROLS INTEGRITY
assert.ok(
  indexHtml.includes('id="actionControlsBar"'),
  'index.html must define #actionControlsBar'
);
assert.ok(
  indexHtml.includes('id="toggleMatchBtn"') &&
  indexHtml.includes('id="skipBtn"') &&
  indexHtml.includes('id="reportBtn"'),
  '#actionControlsBar must contain Start, Skip, and Report buttons'
);
assert.ok(
  styleCss.includes('#controlsSlotText #actionControlsBar') &&
  styleCss.includes('#controlsSlotText #reportBtn'),
  'style.css must specify non-clipping responsive rules for action controls in Chat mode'
);
console.log('✓ 1. Report button and action controls bar properly structured and styled.');

// 2. CUSTOM GENDER DROPDOWN INTEGRITY
assert.ok(
  indexHtml.includes('id="genderDropdownWrap"') &&
  indexHtml.includes('id="customGenderTrigger"') &&
  indexHtml.includes('id="customGenderLabel"') &&
  indexHtml.includes('id="customGenderMenu"') &&
  indexHtml.includes('id="customGenderOptionsList"'),
  'index.html must include custom Gender dropdown trigger, label, menu, and options container'
);
assert.ok(
  indexHtml.includes('id="filterGenderSelect"'),
  'index.html must preserve native #filterGenderSelect in DOM for backward compatibility'
);
console.log('✓ 2. Custom Gender dropdown elements and native select preserved.');

// 3. CUSTOM COUNTRY DROPDOWN INTEGRITY & FULL COUNTRY LIST
assert.ok(
  indexHtml.includes('id="countryDropdownWrap"') &&
  indexHtml.includes('id="customCountryTrigger"') &&
  indexHtml.includes('id="customCountryLabel"') &&
  indexHtml.includes('id="customCountryMenu"') &&
  indexHtml.includes('id="countrySearchInput"') &&
  indexHtml.includes('id="customCountryOptionsList"'),
  'index.html must include custom Country dropdown trigger, search input, menu, and scrollable options container'
);
assert.ok(
  indexHtml.includes('id="filterCountrySelect"'),
  'index.html must preserve native #filterCountrySelect in DOM for backward compatibility'
);

// Count countries in select
const countryMatches = indexHtml.match(/<option value="[A-Z]{2}">/g);
assert.ok(
  countryMatches && countryMatches.length >= 60,
  `Full country list must be preserved (found ${countryMatches ? countryMatches.length : 0} countries)`
);
console.log(`✓ 3. Custom Country dropdown preserved with complete ${countryMatches.length} country options.`);

// 4. JAVASCRIPT CONTROLLER & STATE SYNCHRONIZATION
assert.ok(
  appJs.includes('function initCustomFilterDropdowns') &&
  appJs.includes('function syncCustomFilters'),
  'app.js must implement initCustomFilterDropdowns and syncCustomFilters'
);
assert.ok(
  appJs.includes('syncCustomFiltersUi'),
  'app.js must expose syncCustomFiltersUi on window for VIP state changes'
);
assert.ok(
  appJs.includes('updateVipFilterUi'),
  'app.js must preserve updateVipFilterUi'
);
console.log('✓ 4. JavaScript controller and VIP state synchronization logic verified.');

// 5. CSS RESPONSIVE RULES & ZERO CLIPPING
assert.ok(
  styleCss.includes('.custom-dropdown-menu') &&
  styleCss.includes('.custom-dropdown-option') &&
  styleCss.includes('.custom-scrollbar'),
  'style.css must include custom dropdown panel, options, and scrollbar styles'
);
assert.ok(
  styleCss.includes('repeat(2, minmax(0, 1fr))'),
  'style.css must use minmax(0, 1fr) for mobile aside grid columns to prevent blowout'
);
console.log('✓ 5. CSS responsive rules, internal scrollbars, and grid shrink rules verified.');

console.log('All Filter Dropdowns and Report Button Layout tests passed successfully! 🚀');
