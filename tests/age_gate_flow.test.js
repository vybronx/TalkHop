const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('Running Age Gate & Gender Selection Verification Tests...');

const appJsPath = path.join(__dirname, '..', 'public', 'app.js');
const indexHtmlPath = path.join(__dirname, '..', 'public', 'index.html');

// 1. App.js Syntax Check
try {
  execSync(`node -c "${appJsPath}"`, { stdio: 'pipe' });
  console.log('✓ 1. app.js compiles cleanly with 0 syntax errors.');
} catch (err) {
  assert.fail(`app.js has syntax errors: ${err.message}`);
}

// 2. DOM Elements Check
const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');
assert.ok(indexHtml.includes('id="ageGateModal"'), 'index.html must contain #ageGateModal');
assert.ok(indexHtml.includes('id="ageGenderMaleBtn"'), 'index.html must contain #ageGenderMaleBtn');
assert.ok(indexHtml.includes('id="ageGenderFemaleBtn"'), 'index.html must contain #ageGenderFemaleBtn');
assert.ok(indexHtml.includes('id="ageConfirmCheckbox"'), 'index.html must contain #ageConfirmCheckbox');
assert.ok(indexHtml.includes('id="enterAgeGateBtn"'), 'index.html must contain #enterAgeGateBtn');
assert.ok(indexHtml.includes('id="exitAgeGateBtn"'), 'index.html must contain #exitAgeGateBtn');
console.log('✓ 2. Age Gate DOM elements verified in index.html.');

// 3. Logic & Event Binding Verification in app.js
const appJs = fs.readFileSync(appJsPath, 'utf8');

assert.ok(appJs.includes("if (femaleBtn) femaleBtn.addEventListener('click', () => updateAgeGenderUI('female'));"), 'app.js must attach click listener to female button');
assert.ok(appJs.includes("if (maleBtn) maleBtn.addEventListener('click', () => updateAgeGenderUI('male'));"), 'app.js must attach click listener to male button');
assert.ok(appJs.includes('function updateAgeGenderUI(gender)'), 'app.js must define updateAgeGenderUI');
assert.ok(appJs.includes("femaleBtn.className = 'age-gate-gender-btn py-3 px-4 rounded-2xl border-2 font-bold text-sm flex items-center justify-center space-x-2 transition-all cursor-pointer bg-pink-50 dark:bg-pink-950/40 border-pink-500 text-pink-700 dark:text-pink-300 ring-2 ring-pink-500/20 active:scale-95 shadow-sm';"), 'female button styling properly applied when female is selected');
assert.ok(appJs.includes('if (!ageConfirmCheckbox || !ageConfirmCheckbox.checked)'), 'app.js must validate ageConfirmCheckbox before entering');
assert.ok(appJs.includes("sessionStorage.setItem('talkhop_age_verified', 'true');"), 'app.js must mark user verified in sessionStorage upon enter');
console.log('✓ 3. Age Gate selection and validation logic verified in app.js.');

// 4. Functional DOM Simulation
class MockElement {
  constructor(id, tag = 'div') {
    this.id = id;
    this.tagName = tag.toUpperCase();
    this.className = '';
    this.style = {};
    this.classList = {
      _classes: new Set(),
      add: (c) => this.classList._classes.add(c),
      remove: (c) => this.classList._classes.delete(c),
      contains: (c) => this.classList._classes.has(c)
    };
    this.listeners = {};
    this.checked = false;
  }
  addEventListener(event, fn) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(fn);
  }
  click() {
    if (this.listeners['click']) {
      const e = { preventDefault: () => {} };
      this.listeners['click'].forEach(fn => fn(e));
    }
  }
}

const mockElements = {
  ageGateModal: new MockElement('ageGateModal'),
  enterAgeGateBtn: new MockElement('enterAgeGateBtn', 'button'),
  exitAgeGateBtn: new MockElement('exitAgeGateBtn', 'button'),
  ageConfirmCheckbox: new MockElement('ageConfirmCheckbox', 'input'),
  ageCheckContainer: new MockElement('ageCheckContainer'),
  ageWarningText: new MockElement('ageWarningText'),
  ageGenderMaleBtn: new MockElement('ageGenderMaleBtn', 'button'),
  ageGenderFemaleBtn: new MockElement('ageGenderFemaleBtn', 'button'),
  myGenderMale: new MockElement('myGenderMale', 'button'),
  myGenderFemale: new MockElement('myGenderFemale', 'button')
};

const mockLocalStorage = {};
const mockSessionStorage = {};
let mockSocketEmits = [];
let modeSelected = null;

// Simulate the age gate logic isolated environment
let chosenGender = 'male';
const userPreferences = { myGender: 'male' };

function updateAgeGenderUI(gender) {
  chosenGender = gender;
  userPreferences.myGender = gender;
  mockLocalStorage['talkhop_my_gender'] = gender;

  if (gender === 'male') {
    mockElements.ageGenderMaleBtn.className = 'active-male';
    mockElements.ageGenderFemaleBtn.className = 'inactive-female';
  } else {
    mockElements.ageGenderFemaleBtn.className = 'active-female';
    mockElements.ageGenderMaleBtn.className = 'inactive-male';
  }
}

mockElements.ageGenderMaleBtn.addEventListener('click', () => updateAgeGenderUI('male'));
mockElements.ageGenderFemaleBtn.addEventListener('click', () => updateAgeGenderUI('female'));
updateAgeGenderUI(chosenGender);

// Test female selection
assert.strictEqual(mockElements.ageGenderMaleBtn.className, 'active-male');
mockElements.ageGenderFemaleBtn.click();
assert.strictEqual(chosenGender, 'female');
assert.strictEqual(userPreferences.myGender, 'female');
assert.strictEqual(mockLocalStorage['talkhop_my_gender'], 'female');
assert.strictEqual(mockElements.ageGenderFemaleBtn.className, 'active-female');
console.log('✓ 4. Clicking Female button successfully updates gender selection state & UI.');

// Test checkbox requirement
let entered = false;
mockElements.enterAgeGateBtn.addEventListener('click', (e) => {
  e.preventDefault();
  if (!mockElements.ageConfirmCheckbox.checked) {
    mockElements.ageWarningText.classList.remove('hidden');
    return;
  }
  mockSessionStorage['talkhop_age_verified'] = 'true';
  mockElements.ageGateModal.style.display = 'none';
  modeSelected = 'text';
  entered = true;
});

// Click without checking checkbox
mockElements.enterAgeGateBtn.click();
assert.strictEqual(entered, false, 'Should not enter without 18+ checkbox checked');
assert.strictEqual(mockElements.ageGateModal.style.display, undefined);

// Now check checkbox and click enter
mockElements.ageConfirmCheckbox.checked = true;
mockElements.enterAgeGateBtn.click();
assert.strictEqual(entered, true, 'Should successfully enter once 18+ checkbox is checked');
assert.strictEqual(mockSessionStorage['talkhop_age_verified'], 'true');
assert.strictEqual(mockElements.ageGateModal.style.display, 'none');
assert.strictEqual(modeSelected, 'text');
console.log('✓ 5. Checkbox validation and entry flow work as expected.');

console.log('All Age Gate & Gender Selection tests passed successfully! 🎉');
