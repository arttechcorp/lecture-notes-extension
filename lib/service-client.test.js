const test = require("node:test");
const assert = require("node:assert/strict");
const ServiceClient = require("./service-client.js");

const b64 = o => Buffer.from(JSON.stringify(o)).toString("base64url");
const now = () => Math.floor(Date.now() / 1000);
const JWT = `${b64({ alg: "RS256", kid: "kid-1234567890" })}.${b64({ iss: "https://auth.example.com/", exp: now() + 600, sub: "user-secret-id", email: "user@example.com" })}.${Buffer.from("signature-part").toString("base64url")}`;
const BASE = "https://service.example";

// fetch 를 고정 응답으로 바꿔 request() 를 끝까지 태운다.
const attempt = async (status, body, token = JWT) => {
  const old = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  try { return { result: await ServiceClient.me({ baseUrl: BASE, token }) }; }
  catch (error) { return { error }; }
  finally { globalThis.fetch = old; }
};

test("401 attaches decoded tokenInfo for a JWT - never sub, email or the token itself", async () => {
  const { error } = await attempt(401, { error: { code: "unauthorized", message: "ignored", retryable: false } });
  assert.equal(error.status, 401);
  assert.equal(error.code, "unauthorized");
  assert.equal(error.message, "로그인이 만료됐습니다. Google로 다시 로그인하세요.");
  assert.equal(error.retryable, false);
  const info = error.tokenInfo;
  assert.equal(info.kind, "jwt");
  assert.equal(info.alg, "RS256");
  assert.equal(info.kid, "kid-1234", "kid 는 첫 8자만");
  assert.equal(info.iss, "auth.example.com", "iss 는 호스트명만");
  assert.ok(Number.isInteger(info.expInSec) && info.expInSec > 550 && info.expInSec <= 600, `expInSec=${info.expInSec}`);
  const text = JSON.stringify(info);
  for (const leak of ["user-secret-id", "user@example.com", JWT]) assert.ok(!text.includes(leak), `tokenInfo 에 ${leak.slice(0, 24)} 가 없다`);
});

test("401 attaches {kind:'static',length} for a non-JWT token and keeps the token_expired message", async () => {
  const { error } = await attempt(401, { error: "token_expired" }, "x".repeat(40));
  assert.equal(error.status, 401);
  assert.equal(error.code, "token_expired");
  assert.equal(error.message, "로그인이 만료됐습니다. Google로 다시 로그인하세요.");
  assert.deepEqual(error.tokenInfo, { kind: "static", length: 40 });
});

test("401 decoding never throws - corrupt 3-part tokens yield {kind:'unreadable'}", async () => {
  for (const core of ["aaa.bbb.ccc", "not-json.at-all.here", "a.b.c", "eyJ.@@@.$$$"]) {
    const token = `${core}-${"p".repeat(40)}`; // 3 파트는 유지하면서 32자를 넘긴다
    const { error } = await attempt(401, { error: "unauthorized" }, token);
    assert.equal(error.status, 401);
    assert.deepEqual(error.tokenInfo, { kind: "unreadable" }, token);
  }
});

test("unauthorized and token_expired both map to the login message, whatever the envelope", async () => {
  for (const body of [{ error: "unauthorized" }, { error: { code: "token_expired" } }]) {
    const { error } = await attempt(401, body);
    assert.equal(error.message, "로그인이 만료됐습니다. Google로 다시 로그인하세요.");
  }
});

test("non-401 errors carry status but no tokenInfo; unknown codes keep the generic message", async () => {
  const { error } = await attempt(403, { error: { code: "feature_not_in_account_plan" } });
  assert.equal(error.status, 403);
  assert.equal(error.code, "feature_not_in_account_plan");
  assert.equal(error.message, "현재 요금제에서 지원하지 않는 기능입니다.");
  assert.equal(error.tokenInfo, undefined);
  const unknown = await attempt(500, { error: "weird_code" });
  assert.equal(unknown.error.status, 500);
  assert.equal(unknown.error.message, "서비스 요청을 완료하지 못했습니다 (500).");
  assert.equal(unknown.error.tokenInfo, undefined);
});

test("401 copies error.reason/detail onto authReason/authDetail, detail as JSON capped at 120 chars", async () => {
  const { error } = await attempt(401, { error: { code: "unauthorized", reason: "iss", detail: { expectedHost: "a.supabase.co", gotHost: "b.supabase.co" } } });
  assert.equal(error.authReason, "iss");
  assert.equal(error.authDetail, '{"expectedHost":"a.supabase.co","gotHost":"b.supabase.co"}');
  const long = await attempt(401, { error: { code: "unauthorized", reason: "aud", detail: "x".repeat(200) } });
  assert.equal(long.error.authReason, "aud");
  assert.equal(long.error.authDetail.length, 120);
  const none = await attempt(401, { error: { code: "unauthorized" } });
  assert.equal(none.error.authReason, undefined);
  assert.equal(none.error.authDetail, undefined);
});

// POST 본문을 그대로 잡는다 — 선택 필드가 실렸는지, 키째로 빠졌는지 본다.
const posted = async (method, args) => {
  const old = globalThis.fetch; let body;
  globalThis.fetch = async (url, init) => (body = JSON.parse(init.body), new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));
  try { await ServiceClient[method]({ baseUrl: BASE, token: JWT, ...args }).catch(() => {}); }
  finally { globalThis.fetch = old; }
  return body;
};

test("vision forwards a well-formed ink mask and drops anything that is not an array", async () => {
  const mask = [{ x: 0.1, y: 0.2, w: 0.3, h: 0.1 }];
  assert.deepEqual((await posted("vision", { ink: mask })).ink, mask);
  for (const bad of [undefined, null, "x", { x: 1 }]) assert.ok(!("ink" in await posted("vision", { ink: bad })), JSON.stringify(bad));
});

test("model calls send jobId only when it is a valid string; plan also sends a valid host", async () => {
  for (const m of ["vision", "stt", "judge", "plan", "write"]) {
    assert.equal((await posted(m, { jobId: "job_1-x" })).jobId, "job_1-x", m);
    assert.equal((await posted(m, { jobId: "j" + "x".repeat(127) })).jobId.length, 128, m + " 128자 경계");
    for (const bad of [undefined, null, "", "has space", "-lead", "x".repeat(129), 42])
      assert.ok(!("jobId" in await posted(m, { jobId: bad })), `${m} jobId=${JSON.stringify(bad)}`);
  }
  const plan = await posted("plan", { jobId: "j1", host: "lms.example.edu" });
  assert.equal(plan.host, "lms.example.edu");
  assert.equal((await posted("plan", { host: "a" })).host, "a");
  for (const bad of [undefined, null, "", "Host.Up.edu", "h:8080", "a/b?c", "-x.com", "x.", "한글.com"])
    assert.ok(!("host" in await posted("plan", { host: bad })), `host=${JSON.stringify(bad)}`);
  assert.ok(!("host" in await posted("stt", { host: "lms.example.edu" })), "host는 plan만 받는다");
});

test("write serializes the stage fields the server contract requires — blockId, allowedRefs, learningItems", async () => {
  const body = await posted("write", {
    model: "m", requestId: "r1", stage: "questions",
    section: { sectionId: "S2", blocks: [] }, sections: [], concepts: [],
    blockId: "S2_B5",
    allowedRefs: { targetIds: ["S2", "S2_B1"], reviewIds: ["S2_B1"] },
    learningItems: [{ itemId: "L1", kind: "definition", importance: "core", unitIds: ["U1"] }],
  });
  assert.equal(body.blockId, "S2_B5", "questions 계약의 blockId 가 HTTP 본문에 실린다");
  assert.deepEqual(body.allowedRefs, { targetIds: ["S2", "S2_B1"], reviewIds: ["S2_B1"] });
  assert.deepEqual(body.learningItems, [{ itemId: "L1", kind: "definition", importance: "core", unitIds: ["U1"] }]);
  const bare = await posted("write", { model: "m", requestId: "r2", stage: "section" });
  for (const k of ["blockId", "allowedRefs", "learningItems", "noteSession"]) assert.ok(!(k in bare), `${k} — 없으면 키째로 뺀다`);
});

test("write forwards editorialPlan only when it is an object — v2 review packets and Luna drafts", async () => {
  const ep = { v: 1, glossary: [], section: { sectionId: "S2" } };
  assert.deepEqual((await posted("write", { model: "m", requestId: "r3", stage: "review", editorialPlan: ep })).editorialPlan, ep);
  for (const bad of [undefined, null, "x", 5]) assert.ok(!("editorialPlan" in await posted("write", { model: "m", requestId: "r4", stage: "draft", editorialPlan: bad })), JSON.stringify(bad));
});

test("plan/write forward the noteSession envelope untouched; judge never carries it", async () => {
  const ns = { v: 1, id: "sess-1", mode: "sol-session", history: [{ type: "message", role: "assistant" }] };
  assert.deepEqual((await posted("plan", { noteSession: ns })).noteSession, ns);
  assert.deepEqual((await posted("write", { noteSession: ns, stage: "section" })).noteSession, ns);
  assert.deepEqual((await posted("write", { noteSession: ns, stage: "questions" })).noteSession, ns);
  for (const bad of [null, "x", 5]) assert.ok(!("noteSession" in await posted("write", { noteSession: bad })), JSON.stringify(bad));
  assert.ok(!("noteSession" in await posted("judge", { noteSession: ns })), "judge 는 세션을 싣지 않는다");
  assert.ok(!("noteSession" in await posted("vision", { noteSession: ns })));
});

// pending 체인(노트 세션 실험): 서버가 200 {pending:true,noteSession,usage} 를 돌려주면 같은 본문을 최신 history·
// -s1/-s2 requestId 로 최대 3 요청까지 이어 보낸다. pending 본문은 결과가 아니다.
test("pending chain resends the identical body with -s1/-s2 requestIds and accumulates usage", async () => {
  const old = globalThis.fetch, bodies = [];
  const ns = { v: 1, id: "sess-9", mode: "sol-session", history: [] };
  globalThis.fetch = async (url, init) => {
    const b = JSON.parse(init.body); bodies.push(b);
    const h = b.noteSession.history;
    if (h.length < 2) return new Response(JSON.stringify({
      pending: true, usage: { prompt_tokens: 10, completion_tokens: 5 },
      noteSession: { v: 1, id: "sess-9", mode: "sol-session", history: [...h, { type: "message", role: "assistant", content: [] }] },
    }), { status: 200 });
    return new Response(JSON.stringify({ output: { ok: true }, usage: { prompt_tokens: 7 }, noteSession: { v: 1, id: "sess-9", mode: "sol-session", history: h } }), { status: 200 });
  };
  let res;
  try { res = await ServiceClient.write({ baseUrl: BASE, token: JWT, model: "m", requestId: "req-1", stage: "section", noteSession: ns }); }
  finally { globalThis.fetch = old; }
  assert.equal(bodies.length, 3);
  assert.deepEqual(bodies.map(b => b.requestId), ["req-1", "req-1-s1", "req-1-s2"]);
  assert.deepEqual(bodies.map(b => b.noteSession.history.length), [0, 1, 2]);
  const strip = b => { const { requestId, noteSession, ...rest } = b; return rest; };
  assert.deepEqual(strip(bodies[1]), strip(bodies[0]), "재개 본문은 최초와 같다 — task 는 한 번만 실린다");
  assert.deepEqual(strip(bodies[2]), strip(bodies[0]));
  assert.deepEqual(res.usage, { prompt_tokens: 27, completion_tokens: 10 }, "슬라이스 usage 누적");
});

test("pending chain stops after three requests — never an endless continuation", async () => {
  const old = globalThis.fetch; let n = 0;
  globalThis.fetch = async (url, init) => {
    n++;
    const b = JSON.parse(init.body);
    return new Response(JSON.stringify({ pending: true, noteSession: { ...b.noteSession, history: [...b.noteSession.history, {}] } }), { status: 200 });
  };
  let err;
  try { await ServiceClient.write({ baseUrl: BASE, token: JWT, model: "m", requestId: "r", stage: "section", noteSession: { v: 1, id: "s1", mode: "sol-session", history: [] } }); }
  catch (e) { err = e; }
  finally { globalThis.fetch = old; }
  assert.equal(n, 3);
  assert.equal(err.name, "AbortError", "시간 초과와 같은 결말 — 상위 사다리가 나누기·보류를 정한다");
});

test("a pending reply must echo the same session envelope — mismatch breaks the chain", async () => {
  const old = globalThis.fetch; let n = 0;
  globalThis.fetch = async (url, init) => {
    n++;
    return new Response(JSON.stringify({ pending: true, noteSession: { v: 1, id: "forged", mode: "sol-session", history: [] } }), { status: 200 });
  };
  let err;
  try { await ServiceClient.write({ baseUrl: BASE, token: JWT, model: "m", requestId: "r", stage: "section", noteSession: { v: 1, id: "s1", mode: "sol-session", history: [] } }); }
  catch (e) { err = e; }
  finally { globalThis.fetch = old; }
  assert.equal(n, 1);
  assert.equal(err.code, "note_session_invalid");
});

test("reportRun posts content-free cache stats to /v1/runs", async () => {
  const old = globalThis.fetch; let url, body;
  globalThis.fetch = async (u, init) => { url = u; body = JSON.parse(init.body); return new Response("{}", { status: 200 }); };
  try { await ServiceClient.reportRun({ baseUrl: BASE, token: JWT, jobId: "job-1", cacheHits: 3, cacheMisses: 7, rerun: 1 }); }
  finally { globalThis.fetch = old; }
  assert.equal(url, BASE + "/v1/runs");
  assert.deepEqual(body, { jobId: "job-1", cacheHits: 3, cacheMisses: 7, rerun: 1 });
});
