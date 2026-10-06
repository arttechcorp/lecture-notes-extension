const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('capture entry resets persisted auto-open, keeps gesture, and carries popup tab ID', async () => {
  const handlers = {}, opened = [], windows = [];
  const event = name => ({ addListener: fn => { handlers[name] = fn; } });
  let autoOpen = true, sidePanelFails = false;
  const chrome = {
    runtime: { id: 'test', getURL: p => `chrome-extension://test/${p}`, onInstalled: event('installed'), onStartup: event('startup'), onMessage: event('message') },
    sidePanel: { setPanelBehavior: async options => { autoOpen = options.openPanelOnActionClick; }, open: options => { opened.push(options.tabId); return sidePanelFails ? Promise.reject(new Error('Unsupported window')) : Promise.resolve(); } },
    action: { onClicked: event('action') }, commands: { onCommand: event('command') },
    tabs: { onRemoved: event('removed'), onUpdated: event('updated') },
    storage: { local: { setAccessLevel: async () => {} } },
    windows: { create: async options => { windows.push(options); } },
  };
  vm.runInNewContext(fs.readFileSync('background.js', 'utf8'), { chrome, URL, console, importScripts: () => {} });
  handlers.installed();
  assert.equal(autoOpen, false, 'Reload must reset a previously saved true value');
  handlers.action({ id: 41, windowId: 5, url: 'https://lecture.example/watch' });
  assert.deepEqual(opened, [41], 'Panel must open synchronously in the action gesture');
  handlers.command('open-capture-panel', { id: 73, windowId: 8, url: 'https://lecture.example/popup' });
  assert.equal(windows[0].url, 'chrome-extension://test/sidepanel.html?tabId=73');
  assert.equal(windows[0].type, 'popup');
  handlers.command('unrelated', { id: 41, url: 'https://lecture.example/watch' });
  handlers.command('open-capture-panel', { id: 41, url: 'chrome://extensions' });
  assert.equal(windows.length, 1);
  sidePanelFails = true;
  handlers.action({ id: 73, windowId: 8, url: 'https://lecture.example/popup' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(windows[1].url, 'chrome-extension://test/sidepanel.html?tabId=73');
});

// AUTH_TOKEN: offscreen 문서는 chrome.storage가 없어 background에 로그인 토큰을 묻는다. 확장 자신의 페이지와 offscreen.html 그 자체만 받는다.
const jwt = tag => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ tag })).toString('base64url')}.sig${tag}`;
const saved = (tag, expiresAt) => ({ accessToken: jwt(tag), refreshToken: 'refresh-' + tag, expiresAt, userId: 'user-1', email: 'student@example.com' });

function loadBackground(store, fetch, tweak = () => {}) {
  const handlers = {}, event = name => ({ addListener: fn => { handlers[name] = fn; } }), reads = [];
  const chrome = {
    runtime: { id: 'test', getURL: p => `chrome-extension://test/${p}`, onInstalled: event('installed'), onStartup: event('startup'), onMessage: event('message') },
    sidePanel: { setPanelBehavior: async () => {}, open: async () => {} }, action: { onClicked: event('action') }, commands: { onCommand: event('command') },
    tabs: { onRemoved: event('removed'), onUpdated: event('updated') },
    storage: { local: {
      setAccessLevel: async () => {},
      get: async keys => { reads.push(keys); return Object.fromEntries([].concat(keys).filter(k => k in store).map(k => [k, store[k]])); },
      set: async obj => { Object.assign(store, obj); },
      remove: async keys => { for (const k of [].concat(keys)) delete store[k]; },
    }, sync: { remove: async () => {} } },
  };
  tweak(chrome);
  const context = vm.createContext({ chrome, URL, URLSearchParams, TextEncoder, AbortSignal, btoa, crypto: globalThis.crypto, console, fetch });
  context.importScripts = (...files) => files.forEach(file => vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file }));
  vm.runInContext(fs.readFileSync('background.js', 'utf8'), context, { filename: 'background.js' });
  const ask = (message, sender) => new Promise(resolve => {
    const async = handlers.message(message, sender, resolve);
    if (async !== true) setImmediate(() => resolve(undefined));
  }).then(response => response === undefined ? undefined : JSON.parse(JSON.stringify(response))); // vm 영역 경계를 넘은 객체를 평범한 값으로
  return { ask, reads };
}
const AUTH_TOKEN = { target: 'background', type: 'AUTH_TOKEN' }, DENIED = { ok: false, error: '허용되지 않은 요청입니다.' };

test('AUTH_TOKEN answers extension pages and the offscreen document from storage, with no cached state', async () => {
  const store = { authSession: saved('a', Date.now() + 3600_000) };
  const { ask } = loadBackground(store, async () => { throw new Error('no network expected'); });
  const senders = [
    { id: 'test', url: 'chrome-extension://test/sidepanel.html' },
    { id: 'test', url: 'chrome-extension://test/options.html' },
    { id: 'test', url: 'chrome-extension://test/offscreen.html' },
  ];
  for (const sender of senders) assert.deepEqual(await ask(AUTH_TOKEN, sender), { ok: true, token: jwt('a') }, sender.url);
  // 서비스 워커는 전역에 세션을 두지 않는다: 저장소가 바뀌면 다음 요청에 바로 반영된다.
  store.authSession = saved('b', Date.now() + 3600_000);
  assert.deepEqual(await ask(AUTH_TOKEN, senders[2]), { ok: true, token: jwt('b') });
  delete store.authSession;
  assert.deepEqual(await ask(AUTH_TOKEN, senders[2]), { ok: true, token: null }, '로그아웃 상태는 null');
});

test('AUTH_TOKEN is refused for every other sender and never touches storage', async () => {
  const store = { authSession: saved('a', Date.now() + 3600_000) };
  const { ask, reads } = loadBackground(store, async () => { throw new Error('no network expected'); });
  const refused = [
    { id: 'other-extension', url: 'chrome-extension://test/sidepanel.html' },
    { id: 'test', url: 'https://lecture.example/watch', tab: { id: 1 }, frameId: 0 }, // 웹 페이지(content script 포함)
    { id: 'test', url: 'chrome-extension://test/admin.html' },
    { id: 'test', url: 'chrome-extension://test/background.js' },
    { id: 'test', url: 'chrome-extension://test/offscreen.html?x=1' },
    { id: 'test', url: 'chrome-extension://test/offscreen.html', tab: { id: 2 } },
    { id: 'test', url: 'chrome-extension://test.evil/offscreen.html' },
    { id: 'test', url: 'chrome-extension://test/sandbox.html' },
    { id: 'other-extension', url: 'chrome-extension://test/offscreen.html' },
    { id: 'test', url: 'not a url' },
    { id: 'test' },
    {},
  ];
  for (const sender of refused) {
    assert.deepEqual(await ask(AUTH_TOKEN, sender), DENIED, JSON.stringify(sender));
  }
  // 토큰 요청이라는 이유로 offscreen에 다른 background 기능이 열리지는 않는다.
  const offscreen = { id: 'test', url: 'chrome-extension://test/offscreen.html' };
  assert.deepEqual(await ask({ target: 'background', type: 'GET_PREVIEW', tabId: 1 }, offscreen), DENIED);
  assert.deepEqual(await ask({ target: 'background', type: 'START_SESSION', options: {} }, offscreen), DENIED);
  assert.equal(await ask({ target: 'session', type: 'AUTH_TOKEN' }, offscreen), undefined, 'target이 background가 아니면 응답하지 않는다');
  assert.equal(reads.length, 0, '거절된 요청은 저장소를 읽지 않는다');
});

test('AUTH_TOKEN refreshes an expiring session, and reports a revoked one as an error without a token', async () => {
  const offscreen = { id: 'test', url: 'chrome-extension://test/offscreen.html' };
  const store = { authSession: saved('old', Date.now() + 10_000) };
  const calls = [];
  const ok = { ok: true, status: 200, json: async () => ({ access_token: jwt('new'), refresh_token: 'refresh-new', expires_in: 3600, user: { id: 'user-1', email: 'student@example.com' } }) };
  const revoked = { ok: false, status: 400, json: async () => ({ error: 'invalid_grant' }) };
  let next = ok;
  const { ask } = loadBackground(store, async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return next; });

  assert.deepEqual(await ask(AUTH_TOKEN, offscreen), { ok: true, token: jwt('new') });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/auth\/v1\/token\?grant_type=refresh_token$/);
  assert.deepEqual(calls[0].body, { refresh_token: 'refresh-old' });
  assert.equal(store.authSession.refreshToken, 'refresh-new');

  store.authSession = saved('old2', Date.now() - 1000);
  next = revoked;
  const response = await ask(AUTH_TOKEN, offscreen);
  assert.equal(response.ok, false);
  assert.match(response.error, /다시 로그인/);
  assert.equal(response.token, undefined);
  assert.ok(!('authSession' in store), '폐기된 세션은 지워진다');
});

// background.js가 importScripts로 불러오는 파일이 패키지에서 빠지면 서비스 워커가 시작하지 못한다. 패키저가 importScripts를 따라가는지 고정한다.
test('every file background.js loads with importScripts is in the packaged closure', async () => {
  const { resolveRuntimeClosure } = await import('../tools/package-cws.mjs');
  const source = fs.readFileSync('background.js', 'utf8');
  const imported = [...source.matchAll(/importScripts\(([^)]*)\)/g)].flatMap(match => [...match[1].matchAll(/"([^"]+)"/g)].map(m => m[1]));
  assert.deepEqual(imported, ['lib/settings.js', 'lib/auth.js', 'lib/account.js', 'lib/media-source.js']);
  const { files } = resolveRuntimeClosure();
  for (const file of imported) assert.ok(files.includes(file), `${file} 이 패키지에 없다`);
});

// ── 유료 백그라운드 작업: 절전 방지와 Referer 규칙. 서비스 워커는 상태를 두지 않는다 — chrome.power와 DNR 세션 규칙이 상태다. ──
const PANEL = { id: 'test', url: 'chrome-extension://test/sidepanel.html' }, OFFSCREEN = { id: 'test', url: 'chrome-extension://test/offscreen.html' };
const clone = x => JSON.parse(JSON.stringify(x));
const CONSENT = { personalUse: true, accessRights: true, version: '2026-10-03', at: 1 };
function bgBackground({ offscreenReply = { ok: true }, tabs = { 7: { id: 7, url: 'https://lms.example.com/watch?id=7#t=3', title: '강의' } } } = {}) {
  const log = { awake: [], sent: [], rules: [] };
  let rules = [{ id: 900001, priority: 1, action: { type: 'block' }, condition: { urlFilter: 'admin-diag' } }]; // 다른 규칙(admin 진단)은 건드리지 않아야 한다
  const store = { serviceUrl: 'https://service.example', appSessionToken: 'static-token-static-token-static-token', backgroundConsent: CONSENT, authSession: saved('a', Date.now() + 3600_000) };
  const { ask } = loadBackground(store, async () => { throw new Error('no network expected'); }, chrome => {
    chrome.power = { requestKeepAwake: level => log.awake.push('request:' + level), releaseKeepAwake: () => log.awake.push('release') };
    chrome.declarativeNetRequest = {
      getSessionRules: async () => clone(rules),
      updateSessionRules: async ({ removeRuleIds = [], addRules = [] }) => { rules = rules.filter(r => !removeRuleIds.includes(r.id)).concat(clone(addRules)); log.rules.push(clone({ removeRuleIds, addRules })); },
    };
    chrome.tabs.get = async id => tabs[id] ?? Promise.reject(new Error('No tab with id: ' + id));
    chrome.runtime.getContexts = async () => [{}]; // offscreen 문서가 이미 있다
    chrome.runtime.sendMessage = async m => { log.sent.push(clone(m)); return m.target === 'session' ? clone(offscreenReply) : undefined; };
  });
  return { ask, log, rules: () => clone(rules) };
}
const referer = (host, url = 'https://lms.example.com/watch?id=7') => ({ target: 'background', type: 'BG_REFERER', host, referer: url });

test('BG messages are gated by sender: Referer rules and job end come only from offscreen, job control only from our pages', async () => {
  const b = bgBackground();
  const web = { id: 'test', url: 'https://lecture.example/watch', tab: { id: 1 }, frameId: 0 };
  const others = [web, { id: 'other-extension', url: OFFSCREEN.url }, { id: 'test', url: 'chrome-extension://test/admin.html' }, { id: 'test', url: 'chrome-extension://test/sandbox.html' },
    { id: 'test', url: OFFSCREEN.url, tab: { id: 2 } }, { id: 'test', url: 'chrome-extension://test/offscreen.html?x=1' }, { id: 'test', url: 'chrome-extension://test/background.js' }, { id: 'test' }, {}];
  // 패널·옵션 페이지가 Referer 규칙을 걸거나 작업 종료(절전 방지 해제)를 흉내 낼 수 없다
  for (const type of ['BG_REFERER', 'BG_DONE']) for (const sender of [PANEL, { id: 'test', url: 'chrome-extension://test/options.html' }, ...others])
    assert.deepEqual(await b.ask({ ...referer('cdn.example.com'), type, status: 'failed' }, sender), DENIED, type + ' ' + JSON.stringify(sender));
  // 작업 시작·목록·취소는 패널만. offscreen이나 웹 페이지는 안 된다
  for (const type of ['BG_RUN', 'BG_LIST', 'BG_CANCEL']) for (const sender of [OFFSCREEN, ...others])
    assert.deepEqual(await b.ask({ target: 'background', type, jobId: 'job-12345678', tabId: 7, source: { playlistUrl: 'https://cdn.example.com/a.m3u8' } }, sender), DENIED, type + ' ' + JSON.stringify(sender));
  assert.deepEqual(b.log, { awake: [], sent: [], rules: [] }, '거절된 요청은 아무것도 건드리지 않는다');
  assert.equal(b.rules().length, 1);
  assert.deepEqual(await b.ask(referer('cdn.example.com'), OFFSCREEN), { ok: true });
  assert.equal((await b.ask({ target: 'session', type: 'BG_DONE' }, OFFSCREEN)), undefined, 'target이 background가 아니면 응답하지 않는다');
});

test('the Referer rule is added, extended per host and removed, only for the extension\'s own requests', async () => {
  const b = bgBackground(), mine = () => b.rules().filter(r => r.id === 900002);
  assert.deepEqual(await b.ask(referer('cdn-a.example.com'), OFFSCREEN), { ok: true });
  let [rule] = mine();
  assert.deepEqual(rule.condition.requestDomains, ['cdn-a.example.com']);
  assert.deepEqual(rule.condition.tabIds, [-1], '페이지(탭)의 요청이 아니라 확장 자신의 요청에만 걸린다');
  assert.deepEqual(rule.action, { type: 'modifyHeaders', requestHeaders: [{ header: 'referer', operation: 'set', value: 'https://lms.example.com/watch?id=7' }] });
  // 호스트가 늘면 같은 규칙의 requestDomains가 늘어난다(규칙이 하나 더 생기지 않는다)
  await b.ask(referer('cdn-b.example.com'), OFFSCREEN);
  await b.ask(referer('cdn-a.example.com'), OFFSCREEN);
  assert.equal(mine().length, 1);
  assert.deepEqual(mine()[0].condition.requestDomains, ['cdn-a.example.com', 'cdn-b.example.com']);
  // 잘못된 호스트·Referer는 거절하고 규칙을 그대로 둔다
  for (const bad of [referer('evil.example.com/x'), referer('a b'), referer('*.example.com'), referer('cdn-c.example.com', 'javascript:alert(1)'), referer('cdn-c.example.com', 'not a url'), { ...referer('cdn-c.example.com'), host: undefined }]) {
    const r = await b.ask(bad, OFFSCREEN);
    assert.equal(r.ok, false, JSON.stringify(bad));
  }
  assert.deepEqual(mine()[0].condition.requestDomains, ['cdn-a.example.com', 'cdn-b.example.com']);
  // 작업이 끝나면 규칙이 사라진다. 다른 규칙은 남는다.
  await b.ask({ target: 'background', type: 'BG_DONE', jobId: 'job-12345678', status: 'complete' }, OFFSCREEN);
  assert.deepEqual(b.rules().map(r => r.id), [900001]);
});

test('BG_RUN keeps the system awake and tells offscreen the page the user is viewing, never a panel-supplied Referer', async () => {
  const b = bgBackground();
  const run = (source, tabId = 7) => b.ask({ target: 'background', type: 'BG_RUN', jobId: 'job-12345678', tabId, source }, PANEL);
  assert.deepEqual(await run({ playlistUrl: 'https://cdn.example.com/a.m3u8', pageUrl: 'https://evil.example/' }), { ok: true });
  assert.deepEqual(b.log.awake, ['request:system']);
  const [forwarded] = b.log.sent;
  assert.equal(forwarded.target, 'session');
  assert.equal(forwarded.type, 'BG_RUN');
  assert.deepEqual(forwarded.source, { playlistUrl: 'https://cdn.example.com/a.m3u8', pageUrl: 'https://lms.example.com/', course: null }, '패널이 보낸 pageUrl은 무시하고 탭의 출처만 쓴다(브라우저 기본 Referer와 같다)');
  // 동의 기록은 저장소에서 읽어 넘기고, 로그인 세션·OpenRouter 키는 넘기지 않는다
  assert.deepEqual(Object.keys(forwarded.settings).sort(), ['appSessionToken', 'backgroundConsent', 'devWriteModel', 'noteOptions', 'remoteSummaryConsent', 'serviceUrl', 'visionConsent', 'visionConsentVersion', 'whisperLang']);
  assert.deepEqual(forwarded.settings.backgroundConsent, CONSENT);
  // 시작하지 못하는 요청은 절전 방지를 걸지 않는다
  b.log.awake.length = 0;
  for (const [source, tabId] of [[{ playlistUrl: 'file:///etc/passwd' }, 7], [{ playlistUrl: 'https://cdn.example.com/a.m3u8' }, 99], [{ playlistUrl: 'https://cdn.example.com/a.m3u8' }, null], [undefined, 7]])
    assert.equal((await run(source, tabId)).ok, false);
  const chromeTab = bgBackground({ tabs: { 7: { id: 7, url: 'chrome://extensions' } } });
  assert.equal((await chromeTab.ask({ target: 'background', type: 'BG_RUN', jobId: 'job-12345678', tabId: 7, source: { playlistUrl: 'https://cdn.example.com/a.m3u8' } }, PANEL)).ok, false);
  assert.deepEqual([b.log.awake, chromeTab.log.awake], [[], []]);
});

test('keep-awake is released when offscreen refuses, except while another job is already running', async () => {
  for (const [reply, expected] of [[{ ok: true }, ['request:system']], [{ ok: false, error: '실시간 캡처를 먼저 마쳐 주세요.' }, ['request:system', 'release']], [{ ok: false, busy: true, error: '진행 중' }, ['request:system']]]) {
    const b = bgBackground({ offscreenReply: reply });
    const r = await b.ask({ target: 'background', type: 'BG_RUN', jobId: 'job-12345678', tabId: 7, source: { playlistUrl: 'https://cdn.example.com/a.m3u8' } }, PANEL);
    assert.equal(r.ok, reply.ok);
    assert.deepEqual(b.log.awake, expected, JSON.stringify(reply));
  }
});

test('BG_DONE releases keep-awake and the rule on every status, and relays only content-free fields to the panel', async () => {
  for (const status of ['complete', 'partial', 'done', 'paused', 'failed', 'cancelled']) {
    const b = bgBackground();
    await b.ask(referer('cdn.example.com'), OFFSCREEN);
    const done = { target: 'background', type: 'BG_DONE', jobId: 'job-12345678', status, code: status === 'failed' ? 'SRC_PROTECTED' : null, reason: null, suggest: 'live', message: '안내', stats: { slides: 3, chunks: 2, gaps: 0 }, notices: [{ code: 'NOTE_X', count: 1 }], note: '강의 내용 SENTINEL', url: 'https://cdn.example.com/secret.m3u8' };
    assert.deepEqual(await b.ask(done, OFFSCREEN), { ok: true });
    assert.deepEqual(b.log.awake, ['release'], status);
    assert.deepEqual(b.rules().map(r => r.id), [900001], status);
    const relayed = b.log.sent.find(m => m.target === 'panel');
    assert.deepEqual(relayed, { target: 'panel', type: 'BG_DONE', jobId: 'job-12345678', status, code: done.code, reason: null, suggest: 'live', message: '안내', stats: { slides: 3, chunks: 2, gaps: 0 }, notices: [{ code: 'NOTE_X', count: 1 }], packageId: null, saved: null }, status);
    assert.ok(!JSON.stringify(b.log.sent).includes('SENTINEL') && !JSON.stringify(b.log.sent).includes('secret.m3u8'));
  }
  // packageId는 패널의 "노트 열기"가 쓴다 — 저장소 id 규칙에 맞는 것만 그대로 보낸다.
  const b = bgBackground();
  await b.ask({ target: 'background', type: 'BG_DONE', jobId: 'job-12345678', status: 'complete', packageId: 'Lp1-abc123' }, OFFSCREEN);
  assert.equal(b.log.sent.find(m => m.target === 'panel').packageId, 'Lp1-abc123');
  await b.ask({ target: 'background', type: 'BG_DONE', jobId: 'job-12345678', status: 'complete', packageId: 'bad id!<script>' }, OFFSCREEN);
  assert.equal(b.log.sent.filter(m => m.target === 'panel').at(-1).packageId, null, '규칙에 안 맞는 id는 버린다');
  await b.ask({ target: 'background', type: 'BG_DONE', jobId: 'job-12345678', status: 'complete', packageId: 12345 }, OFFSCREEN);
  assert.equal(b.log.sent.filter(m => m.target === 'panel').at(-1).packageId, null, '문자열이 아니면 버린다(정규식 강제변환 통과 방지)');
});

// 노트 페이지의 "다시 만들기": 검증된 필드와 저장소 설정만 offscreen에 넘기고, 끝날 때까지 절전 방지를 든다.
test('LIB_REGENERATE is gated to our pages, validates packageId and options, forwards storage settings and holds keep-awake until the reply', async () => {
  const NOTE = { id: 'test', url: 'chrome-extension://test/note.html' }; // 지워지는 페이지 — 더는 신뢰하는 페이지가 아니다
  const regen = (extra = {}) => ({ target: 'background', type: 'LIB_REGENERATE', packageId: 'Lp1-abc123', options: { syntheticExamples: false, externalAugmentation: false }, ...extra });

  // 보낼 수 있는 페이지: sidepanel·options. note.html·offscreen·웹 페이지·다른 확장·관리 페이지는 안 된다.
  const b = bgBackground();
  for (const sender of [NOTE, OFFSCREEN, { id: 'test', url: 'https://lecture.example/watch', tab: { id: 1 } }, { id: 'other-extension', url: NOTE.url }, { id: 'test', url: 'chrome-extension://test/admin.html' }, { id: 'test', url: 'chrome-extension://test/sandbox.html' }])
    assert.deepEqual(await b.ask(regen(), sender), DENIED, JSON.stringify(sender));
  for (const sender of [PANEL, { id: 'test', url: 'chrome-extension://test/options.html' }])
    assert.equal((await b.ask(regen(), sender)).ok, true, JSON.stringify(sender));

  // 모양이 깨진 요청은 offscreen에 가지도 않는다
  for (const bad of [
    { packageId: 'bad id!<script>' }, { packageId: '' }, { packageId: undefined },
    { options: undefined }, { options: { syntheticExamples: 'yes', externalAugmentation: false } },
    { options: { syntheticExamples: false } }, { options: { syntheticExamples: false, externalAugmentation: false, note: '강의 내용' } },
  ]) assert.equal((await b.ask(regen(bad), PANEL)).ok, false, JSON.stringify(bad));
  assert.deepEqual(b.log.sent.filter(m => m.type === 'LIB_REGENERATE').length, 2, '정상 요청 2건만 전달됐다');

  // 전달 내용: 검증된 packageId·options + 저장소에서 읽은 설정. 페이지가 넣은 다른 키·내용은 싣지 않는다.
  const fwd = b.log.sent.find(m => m.type === 'LIB_REGENERATE');
  assert.deepEqual(Object.keys(fwd).sort(), ['options', 'packageId', 'settings', 'target', 'type']);
  assert.equal(fwd.target, 'session');
  assert.equal(fwd.packageId, 'Lp1-abc123');
  assert.deepEqual(fwd.options, { syntheticExamples: false, externalAugmentation: false });
  assert.deepEqual(Object.keys(fwd.settings).sort(), ['appSessionToken', 'backgroundConsent', 'devWriteModel', 'noteOptions', 'remoteSummaryConsent', 'serviceUrl', 'visionConsent', 'visionConsentVersion', 'whisperLang']);
  assert.equal(fwd.settings.serviceUrl, 'https://service.example');
  assert.ok(!('authSession' in fwd.settings), '로그인 세션 자체는 넘기지 않는다');
  // 절전 방지: 답이 오면(거절 포함) 놓는다. busy(다른 작업·재생성이 점유)면 그 작업의 절전 방지를 놓지 않는다.
  assert.deepEqual(b.log.awake, ['request:system', 'release', 'request:system', 'release']);
  const busy = bgBackground({ offscreenReply: { ok: false, busy: true, error: '진행 중' } });
  assert.equal((await busy.ask(regen(), PANEL)).ok, false);
  assert.deepEqual(busy.log.awake, ['request:system'], 'busy에는 놓지 않는다 — 돌고 있는 쪽의 절전 방지다');
});

test('BG_RUN passes the note course only as a single folder-safe name', async () => {
  const b = bgBackground();
  for (const [course, want] of [['회로이론', '회로이론'], ['../etc', null], ['a/b', null], ['x'.repeat(41), null], [7, null]]) {
    await b.ask({ target: 'background', type: 'BG_RUN', jobId: 'job-12345678', tabId: 7, source: { playlistUrl: 'https://cdn.example.com/a.m3u8', course } }, PANEL);
    assert.equal(b.log.sent.at(-1).source.course, want);
  }
});
