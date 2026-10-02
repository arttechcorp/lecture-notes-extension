const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

for (const mode of ['success', 'failure', 'invalid']) test(`connection check preserves auto-saved settings with ${mode} API key`, async () => {
  const apiKey = 'sk-or-v1-' + 'a'.repeat(32);
  const saved = {theme: 'dark', ocrEnabled: false, whisperEnabled: true, whisperLang: 'en', speedCorrection: true};
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      type: ['remoteSummaryConsent', 'jevEnabled', 'ocrEnabledCb', 'whisperCb', 'speedCorrectionCb'].includes(id) ? 'checkbox' : 'text',
      value: '', checked: false, hidden: true, disabled: false,
      addEventListener(name, fn) { this[name] = fn; },
    });
    return elements.get(id);
  };
  const changes = [];
  let writes = 0;
  const chrome = {storage: {
    local: {
      get(keys, callback) {
        const result = typeof keys === 'string' ? {[keys]: saved[keys]} : Object.fromEntries(keys.filter(key => key in saved).map(key => [key, saved[key]]));
        if (callback) callback(result); else return Promise.resolve(result);
      },
      async set(patch) {
        writes++;
        Object.entries(patch).forEach(([key, value]) => { if (saved[key] !== value) changes.forEach(fn => fn({[key]: {newValue: value}}, 'local')); });
        Object.assign(saved, patch);
      },
      async remove() {},
    },
    sync: {async remove() {}},
    onChanged: {addListener(fn) { changes.push(fn); }},
  }};
  let checkedKey;
  const root = {dataset: {}};
  const context = vm.createContext({
    chrome, document: {documentElement: root, getElementById: element},
    matchMedia: () => ({matches: false, addEventListener() {}}),
    OpenRouterClient: {async check({apiKey}) { checkedKey = apiKey; if (mode === 'failure') throw Error('network failed'); }},
    ServiceClient: {async me() { throw Error('unexpected service check'); }},
    URL, console,
  });
  for (const file of ['lib/settings.js', 'lib/theme.js', 'options.js']) vm.runInContext(fs.readFileSync(file, 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(root.dataset.theme, 'dark');
  element('openRouterApiKey').value = mode === 'invalid' ? 'bad-key' : apiKey;
  await element('testBtn').click();
  assert.equal(checkedKey, mode === 'invalid' ? undefined : apiKey);
  assert.equal(saved.openRouterApiKey, mode === 'invalid' ? undefined : apiKey);
  assert.equal(writes, mode === 'invalid' ? 0 : 1);
  assert.equal(saved.theme, 'dark');
  assert.equal(root.dataset.theme, 'dark');
  assert.equal(saved.ocrEnabled, false);
  assert.equal(saved.whisperEnabled, true);
  assert.equal(saved.whisperLang, 'en');
  assert.equal(saved.speedCorrection, true);
  assert.equal(element('testBtn').disabled, false);
});
