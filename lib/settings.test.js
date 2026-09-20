const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULTS, validateSettings } = require('./settings.js');

test('vision is off by default and its consent is separate from text consent', () => {
  assert.equal(DEFAULTS.ocrEngine, 'ppocr-v5-wasm');
  assert.equal(DEFAULTS.visionConsent, false);
  assert.equal(DEFAULTS.remoteSummaryConsent, false, '요약 텍스트 동의는 그대로 남는다');
});

test('the engine field accepts only known engines', () => {
  assert.equal(validateSettings({ ocrEngine: 'vision-cloud' }).ocrEngine, 'vision-cloud');
  assert.equal(validateSettings({ ocrEngine: 'gpt-please' }).ocrEngine, 'ppocr-v5-wasm', '모르는 값은 로컬로 떨어진다');
  assert.equal(validateSettings({}).ocrEngine, 'ppocr-v5-wasm');
});

test('unknown settings keys are dropped rather than stored', () => {
  assert.equal(validateSettings({ visionApiKey: 'sk-nope' }).visionApiKey, undefined);
});
