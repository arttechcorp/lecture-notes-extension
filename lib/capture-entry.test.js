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

function loadBackground(store, fetch) {
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
    } },
  };
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
  assert.deepEqual(imported, ['lib/settings.js', 'lib/auth.js']);
  const { files } = resolveRuntimeClosure();
  for (const file of imported) assert.ok(files.includes(file), `${file} 이 패키지에 없다`);
});
