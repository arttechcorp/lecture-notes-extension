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

const fs = require('node:fs');
const path = require('node:path');
const { TERMS_VERSION, cloudRecognitionAllowed, backgroundAllowed, loadSettings, saveSettings } = require('./settings.js');

test('defaults carry versioned consent records, all denied', () => {
  assert.deepEqual(DEFAULTS.backgroundConsent, { personalUse: false, accessRights: false, version: '', at: 0 });
  assert.equal(DEFAULTS.visionConsentVersion, '');
  assert.equal(DEFAULTS.visionConsentAt, 0);
  assert.equal(backgroundAllowed(DEFAULTS), false);
  assert.equal(cloudRecognitionAllowed(DEFAULTS), false);
  assert.match(TERMS_VERSION, /^\d{4}-\d{2}-\d{2}$/);
});

test('validateSettings normalises the backgroundConsent record', () => {
  const coerced = validateSettings({ backgroundConsent: { personalUse: 'yes', accessRights: 1, version: '  2026-10-02  ', at: 9 } });
  assert.deepEqual(coerced.backgroundConsent, { personalUse: false, accessRights: false, version: '', at: 0 }, '비불리언은 false이고 둘 다 false면 버전·시각이 와도 기본값으로 접힌다');
  const kept = validateSettings({ backgroundConsent: { personalUse: true, accessRights: false, version: '  ' + 'v'.repeat(40) + '  ', at: 1.9, extra: 'x' } });
  assert.deepEqual(kept.backgroundConsent, { personalUse: true, accessRights: false, version: 'v'.repeat(32), at: 1 }, '버전은 trim+32자 컷, at은 내림, 모르는 중첩 키는 버린다');
  for (const bad of [NaN, -3, '12', Infinity]) {
    assert.equal(validateSettings({ backgroundConsent: { personalUse: true, version: 'x', at: bad } }).backgroundConsent.at, 0);
  }
  for (const bad of [null, [true, true], 'consent']) {
    assert.deepEqual(validateSettings({ backgroundConsent: bad }).backgroundConsent, DEFAULTS.backgroundConsent);
  }
  const first = validateSettings({ backgroundConsent: { personalUse: true, version: 'x', at: 1 } });
  first.backgroundConsent.personalUse = 'mutated';
  const second = validateSettings({ backgroundConsent: { personalUse: true, version: 'x', at: 1 } });
  assert.deepEqual(DEFAULTS.backgroundConsent, { personalUse: false, accessRights: false, version: '', at: 0 }, 'DEFAULTS.backgroundConsent는 절대 변하지 않는다');
  assert.equal(second.backgroundConsent.personalUse, true);
});

test('backgroundAllowed requires both consents on the current terms version', () => {
  const rec = over => ({ backgroundConsent: { personalUse: true, accessRights: true, version: TERMS_VERSION, at: 1, ...over } });
  assert.equal(backgroundAllowed(rec()), true);
  assert.equal(backgroundAllowed(rec(), TERMS_VERSION), true);
  assert.equal(backgroundAllowed(rec({ version: '2099-01-01' }), '2099-01-01'), true);
  assert.equal(backgroundAllowed(rec({ personalUse: false })), false);
  assert.equal(backgroundAllowed(rec({ accessRights: false })), false);
  assert.equal(backgroundAllowed(rec({ version: '2000-01-01' })), false, '지난 버전의 동의는 다시 받아야 한다');
  assert.equal(backgroundAllowed(rec({ version: '' })), false);
  assert.equal(backgroundAllowed(undefined), false);
  assert.equal(backgroundAllowed(null), false);
  assert.equal(backgroundAllowed(rec(), ''), false);
});

test('vision consent keeps versioned metadata only while consent is true', () => {
  const on = validateSettings({ visionConsent: true, visionConsentVersion: TERMS_VERSION, visionConsentAt: 1700000000000 });
  assert.equal(on.visionConsentVersion, TERMS_VERSION);
  assert.equal(on.visionConsentAt, 1700000000000);
  assert.equal(cloudRecognitionAllowed(on), true);
  const off = validateSettings({ visionConsent: false, visionConsentVersion: TERMS_VERSION, visionConsentAt: 5 });
  assert.equal(off.visionConsentVersion, '', '철회하면 메타데이터 흔적도 지운다');
  assert.equal(off.visionConsentAt, 0);
  const legacy = validateSettings({ visionConsent: true });
  assert.equal(legacy.visionConsent, true, '기존 화면 전송 게이트(visionConsent===true)는 그대로다');
  assert.equal(legacy.visionConsentVersion, '');
  assert.equal(legacy.visionConsentAt, 0);
  assert.equal(cloudRecognitionAllowed(legacy), false, '버전 없는 동의는 화면 프레임 한정이라 클라우드 인식 게이트는 false');
  assert.equal(cloudRecognitionAllowed(validateSettings({ visionConsent: true, visionConsentVersion: '2000-01-01', visionConsentAt: 1 })), false, '지난 버전 동의는 false');
});

test('consent records survive a chrome.storage round trip', async () => {
  const store = {};
  const prev = global.chrome;
  global.chrome = { storage: { local: {
    get: async keys => Object.fromEntries([].concat(keys).filter(k => k in store).map(k => [k, store[k]])),
    set: async obj => { Object.assign(store, obj); },
    remove: async keys => { for (const k of [].concat(keys)) delete store[k]; },
  }, sync: { remove: async () => {} } } };
  try {
    await chrome.storage.local.set({ ocrEngine: 'vision-cloud', visionConsent: true });
    const legacy = await loadSettings();
    assert.equal(legacy.visionConsent, true);
    assert.equal(legacy.visionConsentVersion, DEFAULTS.visionConsentVersion);
    assert.equal(legacy.visionConsentAt, DEFAULTS.visionConsentAt);
    assert.deepEqual(legacy.backgroundConsent, DEFAULTS.backgroundConsent);

    await saveSettings({ backgroundConsent: { personalUse: true, accessRights: true, version: TERMS_VERSION, at: 1700000000000 } });
    let s = await loadSettings();
    assert.deepEqual(s.backgroundConsent, { personalUse: true, accessRights: true, version: TERMS_VERSION, at: 1700000000000 });
    assert.equal(backgroundAllowed(s), true);

    await saveSettings({ backgroundConsent: { personalUse: true, accessRights: false, version: TERMS_VERSION, at: 1 } });
    s = await loadSettings();
    assert.equal(backgroundAllowed(s), false);

    await assert.rejects(saveSettings({ somethingElse: 1 }), /허용되지 않은 설정/);

    await saveSettings({ visionConsent: true, visionConsentVersion: TERMS_VERSION, visionConsentAt: 5 });
    await saveSettings({ visionConsent: false });
    s = await loadSettings();
    assert.equal(s.visionConsentVersion, '');
    assert.equal(s.visionConsentAt, 0);
  } finally {
    if (prev === undefined) delete global.chrome; else global.chrome = prev;
  }
});

test('options.html exposes the consent card without inline handlers', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'options.html'), 'utf8');
  assert.match(html, /<input[^>]*type="checkbox"[^>]*id="bgPersonalCb"/);
  assert.match(html, /<input[^>]*type="checkbox"[^>]*id="bgAccessCb"/);
  assert.match(html, /id="bgState"/);
  const inline = [...html.matchAll(/<script\b[^>]*>/g)].filter(m => !/\bsrc\s*=/.test(m[0]));
  assert.deepEqual(inline, [], '인라인 스크립트 본문은 CSP에 막힌다');
  assert.equal(/\son[a-z]+\s*=/i.test(html), false, 'on*= 인라인 핸들러 없음');
  const settingsAt = html.indexOf('src="lib/settings.js"'), optionsAt = html.indexOf('src="options.js"');
  assert.ok(settingsAt > -1 && optionsAt > -1 && settingsAt < optionsAt, 'settings.js가 options.js보다 먼저 로드된다');
});
