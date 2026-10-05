// Supabase Auth 구글 로그인(PKCE)과 액세스 토큰 관리. 의존성(fetch·chrome.identity·저장소·시계·crypto)은 createAuth 로 주입한다.
// 세션은 lib/settings.js 의 authSession 한 키(chrome.storage.local, 동기화 안 함)에만 있다. 이 파일은 토큰·이메일을 로그에 남기지 않는다.
(() => {
  // landing/supabase-config.js 와 같은 프로젝트 값이다(lib/auth.test.js 가 두 파일이 같은지 확인한다).
  // anon 키는 공개용이다. service_role 키는 확장에 절대 넣지 않는다.
  const SUPABASE_URL = "https://rppknkhbiivyurhvljoi.supabase.co";
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJwcGtua2hiaWl2eXVyaHZsam9pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk2NDY1MTQsImV4cCI6MjEwNTIyMjUxNH0.1on99mSxHuwj7VmWJqy6LwBgkUN7gbgSgWwEyJnvZJw";
  const REFRESH_MARGIN_MS = 60000, HTTP_TIMEOUT_MS = 15000;
  const EXPIRED = "로그인이 만료되었거나 취소되었습니다. 설정에서 Google로 다시 로그인하세요.";
  const RETRY = "로그인 정보를 갱신하지 못했습니다. 네트워크를 확인하고 잠시 뒤 다시 시도하세요.";
  const BAD_RESPONSE = "로그인 응답을 확인하지 못했습니다.";
  const base64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  // 브라우저에서는 settings.js 가 먼저 실려 있고(options.html, background.js 의 importScripts), Node 테스트에서는 require 한다.
  const settings = () => typeof loadAuthSession === "function" ? { loadAuthSession, saveAuthSession } : require("./settings.js");

  function createAuth(deps = {}) {
    const http = deps.fetch || ((url, init) => globalThis.fetch(url, init));
    const identity = () => deps.identity || chrome.identity;
    const cryptoApi = deps.crypto || globalThis.crypto;
    const now = deps.now || (() => Date.now());
    const supabaseUrl = deps.url || SUPABASE_URL, anonKey = deps.anonKey || SUPABASE_ANON_KEY;
    // save 는 저장된 세션을 돌려주고, 형식 검증(settings.js authSessionOf)에 걸리면 null 을 돌려준다. save(null)은 로그아웃이다.
    const store = deps.storage || { load: () => settings().loadAuthSession(), save: session => settings().saveAuthSession(session) };
    // 진행 중인 갱신 하나만 호출끼리 공유한다. 서비스 워커가 죽으면 사라져도 되는 값이다 - 세션의 원본은 언제나 storage 다.
    let refreshing = null;

    const post = (path, body, headers) => http(`${supabaseUrl}/auth/v1/${path}`, {
      method: "POST", headers: { apikey: anonKey, "content-type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    const sessionFrom = (r, previous) => {
      const ttl = Number(r?.expires_in);
      if (typeof r?.access_token !== "string" || typeof r?.refresh_token !== "string" || !(ttl > 0)) return null;
      return { accessToken: r.access_token, refreshToken: r.refresh_token, expiresAt: now() + ttl * 1000, userId: r.user?.id ?? previous?.userId, email: r.user?.email ?? previous?.email ?? "" };
    };
    const commit = async session => {
      if (!session || !(await store.save(session))) throw new Error(BAD_RESPONSE);
      return session;
    };
    const fresh = session => session.expiresAt - now() > REFRESH_MARGIN_MS;
    const identityOf = session => ({ userId: session.userId, email: session.email });

    // onStep(name,ms)은 단계 이름과 시간만 받는 진단 콜백이다 — 토큰·인증 코드·이메일은 절대 넘기지 않는다.
    async function signIn(opts) {
      const step = (name, since) => { try { opts?.onStep?.(name, Math.max(0, now() - since)); } catch {} };
      const verifier = base64url(cryptoApi.getRandomValues(new Uint8Array(32)));
      const challenge = base64url(new Uint8Array(await cryptoApi.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
      const authorize = new URL(`${supabaseUrl}/auth/v1/authorize`);
      authorize.search = new URLSearchParams({ provider: "google", redirect_to: identity().getRedirectURL(), code_challenge: challenge, code_challenge_method: "s256" });
      const windowAt = now();
      let back;
      try { back = new URL(await identity().launchWebAuthFlow({ url: authorize.href, interactive: true })); }
      catch { throw new Error("로그인이 취소되었거나 로그인 창을 열지 못했습니다."); }
      step("auth_window", windowAt);
      // 오류는 쿼리(PKCE) 또는 해시로 온다.
      const query = back.searchParams, hash = new URLSearchParams(back.hash.slice(1)), pick = name => query.get(name) || hash.get(name);
      const failure = pick("error");
      if (failure) throw new Error(failure === "access_denied" ? "로그인이 취소되었습니다." : `로그인에 실패했습니다. (${String(pick("error_code") || failure).replace(/[^\w.-]/g, "").slice(0, 40)})`);
      const code = query.get("code");
      if (!code) throw new Error("로그인 응답에 인증 코드가 없습니다.");
      const exchangeAt = now();
      const res = await post("token?grant_type=pkce", { auth_code: code, code_verifier: verifier });
      if (!res.ok) throw new Error(`로그인 코드를 교환하지 못했습니다. (HTTP ${res.status})`);
      const result = identityOf(await commit(sessionFrom(await res.json().catch(() => null))));
      step("code_exchange", exchangeAt);
      return result;
    }

    async function refreshNow() {
      const session = await store.load();
      // 다른 호출이나 페이지가 이미 갱신했을 수 있다. refresh token 은 한 번만 쓸 수 있으므로 다시 읽어 확인한다.
      if (!session || fresh(session)) return session;
      let res;
      try { res = await post("token?grant_type=refresh_token", { refresh_token: session.refreshToken }); }
      catch { throw new Error(RETRY); }
      if (!res.ok) {
        // 4xx(요청 시간 초과·한도 제외)는 refresh token 이 폐기·만료된 것이다. 일시 오류(네트워크·5xx·429)로는 로그아웃시키지 않는다.
        if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) { await store.save(null); throw new Error(EXPIRED); }
        throw new Error(RETRY);
      }
      const next = sessionFrom(await res.json().catch(() => null), session);
      if (!next) throw new Error(RETRY);
      return commit(next);
    }

    // 유효한 액세스 토큰. 로그아웃 상태면 null, 만료 60초 전부터는 먼저 갱신한다.
    async function token() {
      const session = await store.load();
      if (!session) return null;
      if (fresh(session)) return session.accessToken;
      refreshing ||= refreshNow().finally(() => { refreshing = null; });
      return (await refreshing)?.accessToken ?? null;
    }

    // 서버 로그아웃은 최선 노력이다(이 기기의 세션만: scope=local). 실패해도 로컬 세션은 반드시 지운다.
    async function signOut() {
      const session = await store.load().catch(() => null);
      try { if (session) await post("logout?scope=local", undefined, { authorization: `Bearer ${session.accessToken}` }); } catch {}
      await store.save(null);
    }

    // 토큰 없이 계정 표시용 정보만.
    async function user() {
      const session = await store.load();
      return session ? identityOf(session) : null;
    }

    return { signIn, token, signOut, user };
  }

  const Auth = { ...createAuth(), createAuth, SUPABASE_URL, SUPABASE_ANON_KEY };
  globalThis.Auth = Auth;
  if (typeof module !== "undefined") module.exports = Auth;
})();
