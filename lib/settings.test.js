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
const { TERMS_VERSION, cloudRecognitionAllowed, backgroundAllowed, loadSettings, saveSettings, loadAuthSession, saveAuthSession } = require('./settings.js');

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

test('loadSettings cleans the retired BYOK keys out of chrome.storage', async () => {
  const store = { openRouterApiKey: 'sk-or-v1-' + 'a'.repeat(32), apiKey: 'sk-or-v1-' + 'b'.repeat(32), summaryModel: 'google/gemini-2.5-pro', theme: 'dark' };
  const prev = global.chrome;
  global.chrome = { storage: { local: {
    get: async keys => Object.fromEntries([].concat(keys).filter(k => k in store).map(k => [k, store[k]])),
    set: async obj => { Object.assign(store, obj); },
    remove: async keys => { for (const k of [].concat(keys)) delete store[k]; },
  }, sync: { remove: async () => {} } } };
  try {
    const s = await loadSettings();
    assert.equal(s.theme, 'dark', '살아 있는 설정은 그대로다');
    for (const k of ['openRouterApiKey', 'apiKey', 'summaryModel']) assert.ok(!(k in store), `${k} 는 지워진다`);
    assert.equal('openRouterApiKey' in s, false);
    assert.equal('summaryModel' in s, false);
  } finally {
    if (prev === undefined) delete global.chrome; else global.chrome = prev;
  }
});

test('options.html exposes the consent card without inline handlers', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'options.html'), 'utf8');
  // 동의는 사이드 패널에서 처음 쓸 때 받는다 — 설정은 상태 보기와 철회만
  assert.doesNotMatch(html, /id="bgPersonalCb"|id="bgAccessCb"/);
  assert.match(html, /id="bgState"/);
  assert.match(html, /id="bgWithdrawBtn"/);
  const inline = [...html.matchAll(/<script\b[^>]*>/g)].filter(m => !/\bsrc\s*=/.test(m[0]));
  assert.deepEqual(inline, [], '인라인 스크립트 본문은 CSP에 막힌다');
  assert.equal(/\son[a-z]+\s*=/i.test(html), false, 'on*= 인라인 핸들러 없음');
  const settingsAt = html.indexOf('src="lib/settings.js"'), optionsAt = html.indexOf('src="options.js"');
  assert.ok(settingsAt > -1 && optionsAt > -1 && settingsAt < optionsAt, 'settings.js가 options.js보다 먼저 로드된다');
});

// 로그인 세션(authSession): 앱 설정의 한 종류. 형식이 어긋나면 로그아웃 상태(null)로 접힌다.
const jwtLike = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1MSJ9.c2ln';
const goodSession = (over = {}) => ({ accessToken: jwtLike, refreshToken: 'refresh-token_1', expiresAt: 1700003600000, userId: '0b9c1c52-6f0e-4f5e-9a39-2a1d3f1d9c11', email: 'student@example.com', ...over });

test('authSession defaults to signed out', () => {
  assert.equal(DEFAULTS.authSession, null);
  assert.equal(validateSettings({}).authSession, null);
  assert.equal(validateSettings().authSession, null);
});

test('validateSettings keeps a well-formed authSession and drops unknown fields', () => {
  assert.deepEqual(validateSettings({ authSession: goodSession() }).authSession, goodSession());
  const kept = validateSettings({ authSession: { ...goodSession({ expiresAt: 1700003600000.9 }), role: 'admin', provider_token: 'x' } }).authSession;
  assert.deepEqual(kept, goodSession(), 'expiresAt 내림, 모르는 필드 제거');
  assert.equal(validateSettings({ authSession: goodSession({ email: 'not an email' }) }).authSession.email, '', '이메일 형식이 틀리면 이메일만 비운다');
  assert.equal(validateSettings({ authSession: goodSession({ email: undefined }) }).authSession.email, '');
  assert.equal(validateSettings({ authSession: goodSession({ email: 'a'.repeat(320) + '@x.io' }) }).authSession.email, '', '이메일 길이 상한');
});

test('validateSettings turns any malformed authSession into signed out', () => {
  const bad = [
    'a string', 42, [], null, {},
    goodSession({ accessToken: 'not-a-jwt' }), goodSession({ accessToken: 'a.b' }), goodSession({ accessToken: 'a.b.c.d' }), goodSession({ accessToken: jwtLike + ' ' }),
    goodSession({ accessToken: 'a.b.' + 'c'.repeat(4096) }), goodSession({ accessToken: 5 }),
    goodSession({ refreshToken: '' }), goodSession({ refreshToken: 'has space' }), goodSession({ refreshToken: 'x'.repeat(513) }), goodSession({ refreshToken: 7 }),
    goodSession({ expiresAt: NaN }), goodSession({ expiresAt: -1 }), goodSession({ expiresAt: 0 }), goodSession({ expiresAt: '1700000000000' }), goodSession({ expiresAt: Infinity }),
    goodSession({ userId: '' }), goodSession({ userId: 'u'.repeat(65) }), goodSession({ userId: 'a b' }), goodSession({ userId: 1 }),
  ];
  for (const authSession of bad) assert.equal(validateSettings({ authSession }).authSession, null, JSON.stringify(authSession)?.slice(0, 60));
  assert.equal(validateSettings({ authSession: goodSession({ refreshToken: 'x'.repeat(512) }) }).authSession.refreshToken.length, 512, '상한 경계값은 통과');
});

test('the authSession round trip uses its own storage key, local only', async () => {
  const store = {}, writes = [];
  const prev = global.chrome;
  global.chrome = { storage: { local: {
    get: async keys => Object.fromEntries([].concat(keys).filter(k => k in store).map(k => [k, store[k]])),
    set: async obj => { writes.push(Object.keys(obj)); Object.assign(store, obj); },
    remove: async keys => { for (const k of [].concat(keys)) delete store[k]; },
  }, sync: { remove: async () => {} } } };
  try {
    assert.equal(await loadAuthSession(), null);
    assert.deepEqual(await saveAuthSession(goodSession()), goodSession());
    assert.deepEqual(writes.at(-1), ['authSession'], '로그인 세션은 자기 키만 쓴다');
    assert.deepEqual(await loadAuthSession(), goodSession());
    assert.deepEqual((await loadSettings()).authSession, goodSession(), 'loadSettings도 같은 검증을 거쳐 읽는다');

    // 설정 저장은 전체를 다시 쓰지만 authSession은 건드리지 않는다 - 그 사이 갱신된 토큰을 낡은 값으로 덮지 않게.
    const refreshed = goodSession({ refreshToken: 'rotated' });
    await saveSettings({ theme: 'dark' });
    assert.ok(!writes.at(-1).includes('authSession'));
    store.authSession = refreshed;
    await saveSettings({ theme: 'light' });
    assert.deepEqual(store.authSession, refreshed);
    await assert.rejects(saveSettings({ authSession: goodSession({ refreshToken: 'forged' }) }), /허용되지 않은 설정/, 'saveSettings로는 세션을 쓸 수 없다');
    assert.deepEqual(store.authSession, refreshed);

    store.authSession = { ...goodSession(), accessToken: 'tampered' };
    assert.equal(await loadAuthSession(), null, '저장소 값이 깨졌으면 로그아웃 상태로 읽는다');
    assert.equal((await loadSettings()).authSession, null);

    await saveAuthSession(goodSession());
    assert.equal(await saveAuthSession(null), null);
    assert.ok(!('authSession' in store), '지우면 키 자체가 사라진다');
    await saveAuthSession(goodSession());
    assert.equal(await saveAuthSession({ ...goodSession(), accessToken: 'nope' }), null);
    assert.ok(!('authSession' in store), '검증을 못 넘는 값은 저장하지 않고 기존 세션도 지운다');
  } finally {
    if (prev === undefined) delete global.chrome; else global.chrome = prev;
  }
});

test('options.html loads auth.js after service-client.js and before options.js, with the login controls', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'options.html'), 'utf8'), at = name => html.indexOf(`src="${name}"`);
  assert.ok(at('lib/settings.js') < at('lib/auth.js') && at('lib/auth.js') < at('options.js'), 'auth.js는 settings.js 뒤, options.js 앞');
  for (const id of ['loginBtn', 'logoutBtn', 'authState', 'appSessionToken']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /Google로 로그인/);
  assert.match(html, /개발·테스트용 앱 세션 토큰/);
});
