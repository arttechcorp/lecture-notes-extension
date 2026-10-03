const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const Auth = require('./auth.js');

const { createAuth, SUPABASE_URL, SUPABASE_ANON_KEY } = Auth;
const REDIRECT = 'https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/';
const T0 = 1_700_000_000_000;

// JWT 모양의 가짜 토큰(settings.js 의 authSessionOf 검증을 통과해야 한다).
const jwt = tag => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: 'user-1', tag })).toString('base64url')}.sig${tag}`;
const tokenResponse = (tag, extra = {}) => ({ access_token: jwt(tag), refresh_token: 'refresh-' + tag, expires_in: 3600, token_type: 'bearer', user: { id: 'user-1', email: 'student@example.com' }, ...extra });
const reply = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

function memory(initial = null) {
  let value = initial;
  return { load: async () => value, save: async session => (value = session ?? null), get value() { return value; } };
}
function recorder(handler) {
  const calls = [];
  const fn = async (url, init) => { calls.push({ url, init, body: init.body === undefined ? undefined : JSON.parse(init.body) }); return handler(url, init, calls.length); };
  fn.calls = calls;
  return fn;
}
function fakeIdentity(result) {
  const calls = [];
  return { calls, getRedirectURL: () => REDIRECT, launchWebAuthFlow: async options => { calls.push(options); return typeof result === 'function' ? result(options) : result; } };
}
function clock(start = T0) { const c = { t: start, now: () => c.t }; return c; }
const session = (tag, expiresAt) => ({ accessToken: jwt(tag), refreshToken: 'refresh-' + tag, expiresAt, userId: 'user-1', email: 'student@example.com' });
const sha256url = text => crypto.createHash('sha256').update(text).digest('base64url');

test('signIn builds a PKCE authorize URL: S256 challenge of a 43+ char verifier', async () => {
  const identity = fakeIdentity(`${REDIRECT}?code=auth-code-1`);
  const fetch = recorder(() => reply(tokenResponse('a')));
  await createAuth({ fetch, identity, storage: memory(), now: clock().now }).signIn();

  assert.equal(identity.calls.length, 1);
  assert.equal(identity.calls[0].interactive, true);
  const url = new URL(identity.calls[0].url);
  assert.equal(url.origin + url.pathname, `${SUPABASE_URL}/auth/v1/authorize`);
  assert.equal(url.searchParams.get('provider'), 'google');
  assert.equal(url.searchParams.get('redirect_to'), REDIRECT, 'chrome.identity.getRedirectURL() 값 그대로');
  assert.equal(url.searchParams.get('code_challenge_method'), 's256');
  const verifier = fetch.calls[0].body.code_verifier;
  assert.match(verifier, /^[A-Za-z0-9_-]{43,128}$/, 'RFC 7636: 43~128자 unreserved');
  assert.equal(url.searchParams.get('code_challenge'), sha256url(verifier), '챌린지 = base64url(SHA-256(verifier))');
  assert.doesNotMatch(url.search, new RegExp(verifier), '검증자 자체는 URL에 실리지 않는다');
});

test('every sign-in uses a new verifier', async () => {
  const fetch = recorder(() => reply(tokenResponse('a')));
  const auth = createAuth({ fetch, identity: fakeIdentity(`${REDIRECT}?code=c`), storage: memory(), now: clock().now });
  await auth.signIn();
  await auth.signIn();
  assert.notEqual(fetch.calls[0].body.code_verifier, fetch.calls[1].body.code_verifier);
});

test('signIn exchanges the code and stores the session; the result carries no tokens', async () => {
  const c = clock(), storage = memory();
  const fetch = recorder(() => reply(tokenResponse('a')));
  const result = await createAuth({ fetch, identity: fakeIdentity(`${REDIRECT}?code=auth-code-1`), storage, now: c.now }).signIn();

  assert.equal(fetch.calls.length, 1);
  const call = fetch.calls[0];
  assert.equal(call.url, `${SUPABASE_URL}/auth/v1/token?grant_type=pkce`);
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.headers.apikey, SUPABASE_ANON_KEY);
  assert.equal(call.init.headers['content-type'], 'application/json');
  assert.deepEqual(Object.keys(call.body).sort(), ['auth_code', 'code_verifier']);
  assert.equal(call.body.auth_code, 'auth-code-1');
  assert.deepEqual(storage.value, session('a', T0 + 3600 * 1000));
  assert.deepEqual(result, { userId: 'user-1', email: 'student@example.com' });
});

test('an error in the redirect URL is reported without calling the token endpoint', async () => {
  const run = async redirected => {
    const fetch = recorder(() => reply(tokenResponse('a')));
    const storage = memory();
    const error = await createAuth({ fetch, identity: fakeIdentity(redirected), storage, now: clock().now }).signIn().then(() => null, e => e);
    assert.equal(fetch.calls.length, 0);
    assert.equal(storage.value, null);
    return error;
  };
  assert.match((await run(`${REDIRECT}?error=access_denied&error_description=User+denied`)).message, /취소/);
  assert.match((await run(`${REDIRECT}?error=server_error&error_code=unexpected_failure&error_description=x`)).message, /로그인에 실패했습니다\. \(unexpected_failure\)/);
  assert.match((await run(`${REDIRECT}#error=server_error&error_code=bad_oauth_callback`)).message, /bad_oauth_callback/, '해시로 온 오류도 읽는다');
  assert.match((await run(`${REDIRECT}?error=x&error_code=${encodeURIComponent('<b>"\'' + 'a'.repeat(100))}`)).message, /^로그인에 실패했습니다\. \(b?a{0,40}\)$/, '오류 코드는 안전한 문자만 40자까지');
  assert.match((await run(REDIRECT)).message, /인증 코드/);
  assert.match((await run(undefined)).message, /취소되었거나/);
});

test('closing the login window (launchWebAuthFlow rejects) is a cancel', async () => {
  const identity = fakeIdentity(() => { throw new Error('The user did not approve access.'); });
  const fetch = recorder(() => reply({}));
  await assert.rejects(createAuth({ fetch, identity, storage: memory(), now: clock().now }).signIn(), /취소되었거나/);
  assert.equal(fetch.calls.length, 0);
});

test('a failed or malformed code exchange stores nothing', async () => {
  for (const response of [reply({ error: 'invalid_grant' }, 400), reply({ access_token: 'x' }), reply(null)]) {
    const storage = memory();
    await assert.rejects(createAuth({ fetch: recorder(() => response), identity: fakeIdentity(`${REDIRECT}?code=c`), storage, now: clock().now }).signIn(), /로그인/);
    assert.equal(storage.value, null);
  }
  const rejectedByStore = { load: async () => null, save: async () => null };
  await assert.rejects(createAuth({ fetch: recorder(() => reply(tokenResponse('a'))), identity: fakeIdentity(`${REDIRECT}?code=c`), storage: rejectedByStore, now: clock().now }).signIn(), /응답을 확인하지 못했습니다/, '저장 검증을 못 넘으면 성공으로 보이지 않는다');
});

test('token(): signed out is null, a fresh token is returned without any request', async () => {
  const c = clock(), fetch = recorder(() => reply({}));
  assert.equal(await createAuth({ fetch, storage: memory(), now: c.now }).token(), null);
  const storage = memory(session('a', T0 + 61_000));
  assert.equal(await createAuth({ fetch, storage, now: c.now }).token(), jwt('a'), '만료 61초 전은 아직 새 토큰');
  assert.equal(fetch.calls.length, 0);
});

test('token(): refreshes when expiry is within 60 s and stores the rotated session', async () => {
  const c = clock(), storage = memory(session('old', T0 + 59_000));
  const fetch = recorder(() => reply(tokenResponse('new')));
  assert.equal(await createAuth({ fetch, storage, now: c.now }).token(), jwt('new'));

  assert.equal(fetch.calls.length, 1);
  const call = fetch.calls[0];
  assert.equal(call.url, `${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`);
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.headers.apikey, SUPABASE_ANON_KEY);
  assert.equal(call.init.headers['content-type'], 'application/json');
  assert.deepEqual(call.body, { refresh_token: 'refresh-old' });
  assert.deepEqual(storage.value, session('new', T0 + 3600 * 1000), '새 refresh token으로 교체(회전)');
});

test('token(): an already expired token is refreshed too, and the user id/email survive a response without a user', async () => {
  const storage = memory(session('old', T0 - 5000));
  const fetch = recorder(() => reply(tokenResponse('new', { user: undefined })));
  await createAuth({ fetch, storage, now: clock().now }).token();
  assert.equal(storage.value.userId, 'user-1');
  assert.equal(storage.value.email, 'student@example.com');
});

test('concurrent token() calls share a single refresh', async () => {
  const c = clock(), storage = memory(session('old', T0 + 10_000));
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const fetch = recorder(async () => { await gate; return reply(tokenResponse('new')); });
  const auth = createAuth({ fetch, storage, now: c.now });

  const pending = [auth.token(), auth.token(), auth.token()];
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fetch.calls.length, 1, '갱신 요청은 한 번');
  release();
  assert.deepEqual(await Promise.all(pending), [jwt('new'), jwt('new'), jwt('new')]);
  assert.equal(fetch.calls.length, 1);
  assert.equal(await auth.token(), jwt('new'));
  assert.equal(fetch.calls.length, 1, '갱신이 끝난 뒤에는 새 토큰을 그대로 쓴다');
});

test('a call holding a stale read does not spend the already rotated refresh token again', async () => {
  const stale = session('old', T0 + 10_000), rotated = session('new', T0 + 3600_000);
  let reads = 0;
  // 첫 읽기는 낡은 세션, 이후 읽기는 이미 다른 호출/페이지가 갱신해 둔 세션을 돌려준다.
  const storage = { load: async () => (reads++ === 0 ? stale : rotated), save: async s => s };
  const fetch = recorder(() => reply(tokenResponse('never')));
  assert.equal(await createAuth({ fetch, storage, now: clock().now }).token(), jwt('new'));
  assert.equal(fetch.calls.length, 0);
});

test('a revoked refresh token clears the session and asks for a new login (all concurrent callers)', async () => {
  for (const status of [400, 401, 403]) {
    const storage = memory(session('old', T0 + 5000));
    const fetch = recorder(() => reply({ error: 'invalid_grant', error_description: 'Invalid Refresh Token: Already Used' }, status));
    const auth = createAuth({ fetch, storage, now: clock().now });

    const results = await Promise.allSettled([auth.token(), auth.token()]);
    for (const r of results) {
      assert.equal(r.status, 'rejected');
      assert.match(r.reason.message, /다시 로그인/);
      assert.ok(!r.reason.message.includes('refresh-old') && !r.reason.message.includes(jwt('old')), '토큰은 오류 문구에 싣지 않는다');
    }
    assert.equal(fetch.calls.length, 1);
    assert.equal(storage.value, null, '폐기된 세션은 지운다');
    assert.equal(await auth.token(), null, '이후에는 로그아웃 상태');
    assert.equal(fetch.calls.length, 1);
  }
});

test('a transient refresh failure keeps the session so going offline does not log the user out', async () => {
  const cases = [() => { throw new TypeError('Failed to fetch'); }, () => reply({}, 500), () => reply({}, 429), () => reply({}, 408), () => reply({ unexpected: true })];
  for (const handler of cases) {
    const original = session('old', T0 + 5000), storage = memory(original);
    const auth = createAuth({ fetch: recorder(handler), storage, now: clock().now });
    await assert.rejects(auth.token(), /갱신하지 못했습니다/);
    assert.deepEqual(storage.value, original);
  }
});

test('signOut revokes this device session on the server best-effort, then clears locally', async () => {
  const storage = memory(session('a', T0 + 3600_000));
  const fetch = recorder(() => reply({}, 204));
  const auth = createAuth({ fetch, storage, now: clock().now });
  await auth.signOut();

  assert.equal(fetch.calls.length, 1);
  const call = fetch.calls[0];
  assert.equal(call.url, `${SUPABASE_URL}/auth/v1/logout?scope=local`, '다른 기기의 세션까지 끊지 않는다');
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.headers.apikey, SUPABASE_ANON_KEY);
  assert.equal(call.init.headers.authorization, 'Bearer ' + jwt('a'));
  assert.equal(storage.value, null);
  assert.equal(await auth.token(), null);
  assert.equal(await auth.user(), null);
});

test('signOut clears the local session even when the server call fails or the token already expired', async () => {
  for (const handler of [() => { throw new TypeError('offline'); }, () => reply({ msg: 'JWT expired' }, 401)]) {
    const storage = memory(session('a', T0 - 1000));
    await createAuth({ fetch: recorder(handler), storage, now: clock().now }).signOut();
    assert.equal(storage.value, null);
  }
  const fetch = recorder(() => reply({}));
  await createAuth({ fetch, storage: memory(), now: clock().now }).signOut();
  assert.equal(fetch.calls.length, 0, '로그아웃 상태에서는 요청하지 않는다');
});

test('user() exposes only the account identity, never tokens', async () => {
  const user = await createAuth({ storage: memory(session('a', T0 + 3600_000)), now: clock().now }).user();
  assert.deepEqual(user, { userId: 'user-1', email: 'student@example.com' });
});

test('nothing in the module logs', () => {
  const source = fs.readFileSync(path.join(__dirname, 'auth.js'), 'utf8');
  assert.doesNotMatch(source, /console\.|debugger/);
});

test('the embedded Supabase values are the landing page ones, and the key is the public anon role', () => {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'landing', 'supabase-config.js'), 'utf8'), sandbox);
  assert.equal(SUPABASE_URL, sandbox.window.SUMMRIZEI_SUPABASE.url);
  assert.equal(SUPABASE_ANON_KEY, sandbox.window.SUMMRIZEI_SUPABASE.anonKey);
  assert.equal(JSON.parse(Buffer.from(SUPABASE_ANON_KEY.split('.')[1], 'base64url')).role, 'anon', 'service_role 키는 확장에 넣지 않는다');
});

test('with the default storage the session lives in chrome.storage.local under authSession only', async () => {
  const store = {}, touched = [];
  const previous = global.chrome;
  global.chrome = { storage: { local: {
    get: async keys => { touched.push(['get', keys]); return Object.fromEntries([].concat(keys).filter(k => k in store).map(k => [k, store[k]])); },
    set: async obj => { touched.push(['set', Object.keys(obj)]); Object.assign(store, obj); },
    remove: async keys => { touched.push(['remove', keys]); for (const k of [].concat(keys)) delete store[k]; },
  } } }; // chrome.storage.sync 는 일부러 없다: 건드리면 TypeError
  try {
    const c = clock();
    const auth = createAuth({ fetch: recorder(() => reply(tokenResponse('a'))), identity: fakeIdentity(`${REDIRECT}?code=c`), now: c.now });
    await auth.signIn();
    assert.deepEqual(Object.keys(store), ['authSession']);
    assert.deepEqual(store.authSession, session('a', T0 + 3600_000));
    assert.equal(await auth.token(), jwt('a'));
    await auth.signOut();
    assert.deepEqual(store, {});
    assert.ok(touched.every(([, keys]) => [].concat(keys).every(k => k === 'authSession')), '다른 설정 키는 읽지도 쓰지도 않는다');
  } finally {
    if (previous === undefined) delete global.chrome; else global.chrome = previous;
  }
});
