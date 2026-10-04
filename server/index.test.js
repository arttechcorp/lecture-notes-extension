const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path"),crypto=require("node:crypto");
const {createServer,config:serverConfig,readState,toTranscript,toSlideDoc,VISION_SCHEMA,judgeProbs,JUDGE_MODELS}=require("./index"),Vault=require("../lib/vault"),Contracts=require("../lib/contracts.js");
const token="test-token-A-".padEnd(40,"a"),tokenB="test-token-B-".padEnd(40,"b"),origin="chrome-extension://"+"a".repeat(32),model="google/gemini-2.5-flash-lite";
function config(root){return {APP_TOKENS_JSON:JSON.stringify({A:token,B:tokenB}),EXTENSION_ORIGIN:origin,OPENROUTER_API_KEY:"mock-operator-key",OPENROUTER_PROVIDERS_JSON:JSON.stringify({[model]:["test-provider"]}),VAULT_DIR:root};}
function provider(){return noteReply(s1Out);}
async function listen(root,fetcher){const s=createServer(config(root),{fetch:fetcher});await new Promise(r=>s.listen(0,"127.0.0.1",r));return {server:s,url:"http://127.0.0.1:"+s.address().port};}
const close=s=>new Promise(r=>s.close(r));
const removeTemp=root=>{const target=path.resolve(root);assert.ok(target.startsWith(path.join(path.resolve(os.tmpdir()),'summrizei-service-test-')));fs.rmSync(target,{recursive:true,force:true});};
const req=(url,route,method="GET",body,auth=token,site=origin,headers)=>fetch(url+route,{method,headers:{authorization:"Bearer "+auth,origin:site,"content-type":"application/json",...(headers||{})},body:body===undefined?undefined:JSON.stringify(body)});
test("auth, strict ciphertext, account isolation, delete and durable idempotency",async()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),"summrizei-service-test-"));let calls=0;let {server,url}=await listen(root,async()=>{calls++;return provider();});try{
assert.equal((await req(url,"/v1/me","GET",undefined,"bad")).status,401);assert.equal((await req(url,"/v1/me","GET",undefined,token,"https://evil.example")).status,403);
const ctx={accountId:"A",objectId:"object-one",kind:"session"},envelope=await Vault.encrypt({evidence:"private synthetic",summary:null},"testing-password-123",ctx);
assert.equal((await req(url,"/v1/vault/object-one","PUT",{envelope})).status,200);
assert.equal((await req(url,"/v1/vault/object-one","GET",undefined,tokenB)).status,404);
assert.equal((await req(url,"/v1/vault/object-two","PUT",{envelope})).status,400);
assert.equal((await req(url,"/v1/vault/object-one","PUT",{envelope:{...envelope,plaintext:"not allowed"}})).status,400);
const got=await(await req(url,"/v1/vault/object-one")).json();assert.equal((await Vault.decrypt(got.envelope,"testing-password-123",ctx)).evidence,"private synthetic");
assert.equal((await req(url,"/v1/write","POST",input)).status,200);assert.equal((await req(url,"/v1/write","POST",input)).status,409);assert.equal(calls,1);
assert.equal((await req(url,"/v1/write","POST",{...input,evidence:[{...input.evidence[0],text:"changed"}]})).status,400);
await close(server);({server,url}=await listen(root,async()=>{calls++;return provider();}));
assert.equal((await req(url,"/v1/write","POST",input)).status,409);assert.equal(calls,1);assert.ok(!fs.readFileSync(path.join(root,"usage.json"),"utf8").includes("고정비"));
assert.equal((await req(url,"/v1/vault/object-one","DELETE")).status,200);assert.equal((await req(url,"/v1/vault/object-one")).status,404);
}finally{await close(server);removeTemp(root);}});
test("concurrent duplicates never dispatch twice and corrupt usage fails closed",async()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),"summrizei-service-test-"));let calls=0,release;const pending=new Promise(r=>release=r);const {server,url}=await listen(root,async()=>{calls++;await pending;return provider();});try{const first=req(url,"/v1/write","POST",input);while(!calls)await new Promise(r=>setTimeout(r,5));assert.equal((await req(url,"/v1/write","POST",input)).status,409);release();assert.equal((await first).status,200);assert.equal(calls,1);}finally{release();await close(server);}fs.writeFileSync(path.join(root,"usage.json"),"{broken");assert.throws(()=>readState(path.join(root,"usage.json")));removeTemp(root);});
test("credential and path configuration reject traversal and weak tokens",()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),"summrizei-service-test-"));assert.throws(()=>createServer({...config(root),APP_TOKENS_JSON:JSON.stringify({"..":token})}));assert.throws(()=>createServer({...config(root),APP_TOKENS_JSON:'{"A":"weak"}'}));removeTemp(root);});
test("valid JSON with invalid usage types also fails closed",()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),"summrizei-service-test-")),file=path.join(root,'usage.json');try{for(const value of [{accounts:1},{accounts:[]},{accounts:{A:{month:'2026-09',requests:0,spentCents:0,jobs:1}}}]){fs.writeFileSync(file,JSON.stringify(value));assert.throws(()=>readState(file));}}finally{removeTemp(root);}});

test("account model/quantity limits hold server-side; unreported costs keep reservations",async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"summrizei-service-test-")),expensive="anthropic/claude-haiku-4.5";
  let calls=0;
  const env={...config(root),ALLOWED_MODELS:JSON.stringify([model,expensive]),OPENROUTER_PROVIDERS_JSON:JSON.stringify({[model]:["provider-a"],[expensive]:["provider-b"]}),ACCOUNT_LIMITS_JSON:JSON.stringify({A:{models:[model],maxRequests:1,maxCostCents:100}})};
  const server=createServer(env,{fetch:async(url,options)=>{
    calls++;const body=JSON.parse(options.body);assert.equal(options.headers.authorization,'Bearer mock-operator-key');
    assert.deepEqual(body.provider,{only:['provider-a'],order:['provider-a'],require_parameters:true,allow_fallbacks:false,zdr:true,data_collection:'deny'});
    const response=await provider().json();response.usage.cost=null;return {ok:true,json:async()=>response};
  }});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;
  try{
    assert.equal((await req(url,'/v1/write','POST',{...input,model:expensive})).status,403);assert.equal(calls,0);
    assert.equal((await req(url,'/v1/write','POST',input)).status,200);
    const me=await(await req(url,'/v1/me')).json();assert.ok(me.quota.spentCents>0);assert.deepEqual(me.models,[model]);
    assert.equal((await req(url,'/v1/write','POST',{...input,requestId:'request-two'})).status,429);assert.equal(calls,1);
  }finally{await close(server);removeTemp(root);}
});

test("a malformed structured response retries once with the same provider",async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"summrizei-service-test-"));let calls=0;
  const {server,url}=await listen(root,async()=>{
    calls++;
    if(calls===1)return {ok:true,json:async()=>({choices:[{finish_reason:"stop",message:{content:"{}"}}],usage:{prompt_tokens:10,completion_tokens:5,cost:.001}})};
    return provider();
  });
  try{assert.equal((await req(url,"/v1/write","POST",input)).status,200);assert.equal(calls,2);}
  finally{await close(server);removeTemp(root);}
});

test("transport failures do not retry or release an unknown charge reservation",async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"summrizei-service-test-"));let calls=0;
  const {server,url}=await listen(root,async()=>{calls++;return {ok:false,json:async()=>({})};});
  try{
    assert.equal((await req(url,"/v1/write","POST",input)).status,502);
    assert.equal(calls,1);
    const state=readState(path.join(root,"usage.json"));assert.ok(state.accounts.A.spentCents>0);
  }finally{await close(server);removeTemp(root);}
});


// 구 /v1/summary 본문의 evidence·gaps 검사는 라우트와 함께 갔다 — Anthropic 캐시 중단점은 아래 plan/write 테스트가 덮는다.

test("account features gate paid capabilities and default to empty", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "summrizei-service-test-"));
  const env = {
    ...config(root),
    ACCOUNT_LIMITS_JSON: JSON.stringify({ A: { models: [model], maxRequests: 10, maxCostCents: 100, features: ["vision"] } }),
  };
  const server = createServer(env, { fetch: async () => provider() });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const url = "http://127.0.0.1:" + server.address().port;
  try {
    const paid = await (await req(url, "/v1/me")).json();
    assert.deepEqual(paid.features, ["vision"], "설정된 계정은 기능을 그대로 돌려준다");
    const free = await (await req(url, "/v1/me", "GET", undefined, tokenB)).json();
    assert.deepEqual(free.features, [], "한도 설정이 없는 계정은 유료 기능이 없다");
  } finally { await close(server); removeTemp(root); }
});

test("unknown feature names are rejected at boot", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "summrizei-service-test-"));
  try {
    assert.throws(() => createServer({
      ...config(root),
      ACCOUNT_LIMITS_JSON: JSON.stringify({ A: { models: [model], maxRequests: 1, maxCostCents: 1, features: ["admin"] } }),
    }));
  } finally { removeTemp(root); }
});


const visionEnv = root => ({
  ...config(root),
  ALLOWED_VISION_MODELS: JSON.stringify(["google/gemini-2.5-flash-lite"]),
  ACCOUNT_LIMITS_JSON: JSON.stringify({ A: { models: [model], maxRequests: 10, maxCostCents: 500, features: ["vision"] } }),
});
const jpeg = size => "data:image/jpeg;base64," + Buffer.alloc(size, 7).toString("base64");
// 제공자는 message.content에 JSON 문자열을 싣는다 — 스키마는 서버가 강제하므로 fixture는 파싱 전 형태다.
const slideDocFixture = () => ({
  blocks: [
    { text: "키르히호프 전류 법칙", role: "title", bbox: { x: 0.05, y: 0.04, w: 0.9, h: 0.08 }, conf: 0.98 },
    { text: "각 노드에서 전류의 합은 0이다.", role: "body", bbox: { x: 0.05, y: 0.2, w: 0.85, h: 0.1 }, conf: 0.95 },
    { text: "회로이론 3주차", role: "footer", bbox: { x: 0.4, y: 0.95, w: 0.2, h: 0.03 }, conf: 0.7 },
  ],
  formulas: [{ latex: "$$\\sum_k i_k = 0$$", text: null, bbox: { x: 0.3, y: 0.45, w: 0.4, h: 0.1 }, conf: 0.9 }],
  figures: [
    { bbox: { x: 0.05, y: 0.6, w: 1.002, h: 0.3 }, kind: "table", title: "측정값", cells: [["노드", "전류"], ["a", "1.2A"]], chartSummary: null, conf: 0.9 },
    { bbox: { x: 0.55, y: 0.6, w: 0.4, h: 0.3 }, kind: "chart", title: null, cells: null, chartSummary: "전류가 시간에 따라 선형 증가", conf: null },
  ],
});
const slideProvider = (doc = slideDocFixture()) => ({ ok: true, json: async () => ({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(doc) } }], usage: { prompt_tokens: 900, completion_tokens: 120, cost: .002 } }) });
const visionBody = o => ({ model, requestId: "vision-x", slideId: "lec-01-slide-03", t0: 120, t1: 135.5, image: jpeg(2048), mode: "full", ...o });

test("vision route reads a slide, gates on the paid feature and caps image size", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "summrizei-service-test-"));
  let sent = null;
  const server = createServer(visionEnv(root), { fetch: async (_url, options) => { sent = JSON.parse(options.body); return slideProvider(); } });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const url = "http://127.0.0.1:" + server.address().port;
  try {
    const ok = await req(url, "/v1/vision", "POST", visionBody({ requestId: "vision-one" }));
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).slideDoc.blocks[0].text, "키르히호프 전류 법칙");
    assert.equal(sent.provider.zdr, true, "프레임은 zdr provider 로만 나간다");
    assert.equal(sent.provider.data_collection, "deny");

    assert.equal((await req(url, "/v1/vision", "POST", visionBody({ requestId: "vision-two", image: jpeg(2 * 1024 * 1024) }))).status, 413);
    assert.equal((await req(url, "/v1/vision", "POST", visionBody({ requestId: "vision-three", image: "not-an-image" }))).status, 400);
    assert.equal((await req(url, "/v1/vision", "POST", visionBody({ requestId: "vision-four", extra: 1 }))).status, 400);
    assert.equal((await req(url, "/v1/vision", "POST", visionBody({ requestId: "vision-one" }))).status, 409, "같은 요청 id 는 두 번 청구하지 않는다");

    const free = await req(url, "/v1/vision", "POST", visionBody({ requestId: "vision-five" }), tokenB);
    assert.equal(free.status, 403, "유료 기능이 없는 계정은 UI 를 우회해도 막힌다");
    assert.equal((await free.json()).error.code, "feature_not_in_account_plan");

    assert.ok(!fs.readFileSync(path.join(root, "usage.json"), "utf8").includes("BwcH"), "프레임은 사용량 파일에 남지 않는다");
  } finally { await close(server); removeTemp(root); }
});

test("error responses carry the contracted envelope", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "summrizei-service-test-"));
  const { server, url } = await listen(root, async () => provider());
  try {
    const denied = await req(url, "/v1/me", "GET", undefined, "bad");
    assert.equal(denied.status, 401);
    const body = await denied.json();
    const checked = Contracts.validate(Contracts.SCHEMAS.errorEnvelope, body);
    assert.ok(checked.ok, JSON.stringify(checked.errors));
    assert.equal(body.error.code, "unauthorized");
    assert.equal(body.error.retryable, false);
    assert.equal(body.error.retryAfterMs, null);
    assert.equal((await (await req(url, "/v1/nope")).json()).error.code, "not_found");
    const rejected = await req(url, "/v1/write", "POST", { ...input, bogus: 1 });
    assert.equal((await rejected.json()).error.code, "unexpected_field");
  } finally { await close(server); removeTemp(root); }
});

test("/v1/me exposes merged remote config and global flags hide and block features", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "summrizei-service-test-"));
  const env = { ...visionEnv(root), FEATURE_FLAGS_JSON: JSON.stringify({ vision: false }), REMOTE_CONFIG_JSON: JSON.stringify({ throughputMbps: 30, concurrency: { vision: 2 } }) };
  const server = createServer(env, { fetch: async () => slideProvider() });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const url = "http://127.0.0.1:" + server.address().port;
  try {
    const me = await (await req(url, "/v1/me")).json();
    assert.deepEqual(me.features, [], "전역 스위치가 꺼진 기능은 계정 권한이 있어도 숨긴다");
    assert.equal(me.config.throughputMbps, 30);
    assert.equal(me.config.concurrency.vision, 2, "지정한 키만 기본값 위에 올라간다");
    assert.equal(me.config.concurrency.stt, 4);
    assert.equal(me.config.minClientVersion, "0.0.0");
    const blocked = await req(url, "/v1/vision", "POST", visionBody({ requestId: "vision-flag", image: jpeg(64) }));
    assert.equal(blocked.status, 403, "전역 스위치가 꺼지면 계정 권한이 있어도 라우트가 막힌다");
    assert.equal((await blocked.json()).error.code, "feature_not_in_account_plan");
  } finally { await close(server); removeTemp(root); }
});

test("min client version gates requests after auth", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "summrizei-service-test-"));
  const server = createServer({ ...config(root), REMOTE_CONFIG_JSON: JSON.stringify({ minClientVersion: "1.2.0" }) }, { fetch: async () => provider() });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const url = "http://127.0.0.1:" + server.address().port;
  try {
    const old = await req(url, "/v1/me", "GET", undefined, token, origin, { "x-client-version": "1.1.9" });
    assert.equal(old.status, 426);
    assert.equal((await old.json()).error.code, "client_upgrade_required");
    assert.equal((await req(url, "/v1/me", "GET", undefined, token, origin, { "x-client-version": "1.2.0" })).status, 200);
    assert.equal((await req(url, "/v1/me", "GET", undefined, token, origin, { "x-client-version": "2.0.0" })).status, 200);
    assert.equal((await req(url, "/v1/me")).status, 426, "헤더가 없으면 0.0.0으로 본다");
    assert.equal((await req(url, "/v1/me", "GET", undefined, token, origin, { "x-client-version": "1.2.0.1" })).status, 200, "Chrome 은 4조각 버전도 허용한다");
    assert.equal((await req(url, "/v1/me", "GET", undefined, token, origin, { "x-client-version": "1.1.9.9" })).status, 426);
    assert.equal((await req(url, "/v1/me", "GET", undefined, "bad", origin, { "x-client-version": "0.0.1" })).status, 401, "버전 검사는 인증 뒤다");
  } finally { await close(server); removeTemp(root); }
});

test("account concurrency limit rejects a second in-flight request", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "summrizei-service-test-"));
  let calls = 0, release; const pending = new Promise(r => release = r);
  const server = createServer({ ...config(root), ACCOUNT_CONCURRENCY: "1" }, { fetch: async () => { calls++; await pending; return provider(); } });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const url = "http://127.0.0.1:" + server.address().port;
  try {
    const first = req(url, "/v1/write", "POST", input);
    while (!calls) await new Promise(r => setTimeout(r, 5));
    const second = await req(url, "/v1/write", "POST", { ...input, requestId: "request-two" });
    assert.equal(second.status, 429);
    const e = (await second.json()).error;
    assert.equal(e.code, "account_concurrency_exceeded");
    assert.equal(e.retryable, true);
    assert.equal(e.retryAfterMs, 1000);
    release();
    assert.equal((await first).status, 200);
  } finally { release(); await close(server); removeTemp(root); }
});

test("provider semaphore queues a second request for the same model", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "summrizei-service-test-"));
  let calls = 0, release; const pending = new Promise(r => release = r);
  const env = { ...config(root), PROVIDER_CONCURRENCY_JSON: JSON.stringify({ [model]: 1 }) };
  const server = createServer(env, { fetch: async () => { calls++; await pending; return provider(); } });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const url = "http://127.0.0.1:" + server.address().port;
  try {
    const first = req(url, "/v1/write", "POST", input);
    while (!calls) await new Promise(r => setTimeout(r, 5));
    const second = req(url, "/v1/write", "POST", { ...input, requestId: "request-two" });
    await new Promise(r => setTimeout(r, 50));
    assert.equal(calls, 1, "슬롯이 비기 전까지 두 번째 호출은 대기한다");
    release();
    assert.equal((await first).status, 200);
    assert.equal((await second).status, 200);
    assert.equal(calls, 2);
  } finally { release(); await close(server); removeTemp(root); }
});

test("a provider slot timeout answers busy and rolls the reservation back", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "summrizei-service-test-"));
  let calls = 0, release; const pending = new Promise(r => release = r);
  const env = { ...config(root), PROVIDER_CONCURRENCY_JSON: JSON.stringify({ [model]: 1 }), PROVIDER_QUEUE_MS: "50" };
  const server = createServer(env, { fetch: async () => { calls++; await pending; return provider(); } });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const url = "http://127.0.0.1:" + server.address().port;
  try {
    const first = req(url, "/v1/write", "POST", input);
    while (!calls) await new Promise(r => setTimeout(r, 5));
    const t0 = Date.now();
    const busy = await req(url, "/v1/write", "POST", { ...input, requestId: "request-two" });
    const elapsed = Date.now() - t0;
    assert.equal(busy.status, 429);
    const e = (await busy.json()).error;
    assert.equal(e.code, "provider_busy");
    assert.equal(e.retryable, true);
    assert.equal(e.retryAfterMs, 2000);
    assert.ok(elapsed >= 40 && elapsed < 2000, "슬롯 대기 상한만큼만 기다린다: " + elapsed);
    assert.equal(calls, 1, "슬롯을 못 얻은 요청은 제공자를 호출하지 않는다");
    const me = await (await req(url, "/v1/me")).json();
    assert.equal(me.quota.requests, 1, "롤백된 요청은 사용량에 남지 않는다");
    release();
    assert.equal((await first).status, 200);
    assert.equal((await req(url, "/v1/write", "POST", { ...input, requestId: "request-two" })).status, 200, "되돌려진 requestId는 다시 쓸 수 있다");
  } finally { release(); await close(server); removeTemp(root); }
});

test("a client that disconnects while queued for a provider slot is refunded", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "summrizei-service-test-"));
  let calls = 0, release; const pending = new Promise(r => release = r);
  const env = { ...config(root), PROVIDER_CONCURRENCY_JSON: JSON.stringify({ [model]: 1 }) };
  const server = createServer(env, { fetch: async () => { calls++; await pending; return provider(); } });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const url = "http://127.0.0.1:" + server.address().port;
  try {
    const first = req(url, "/v1/write", "POST", input);
    while (!calls) await new Promise(r => setTimeout(r, 5));
    const ac = new AbortController();
    const queued = fetch(url + "/v1/write", { method: "POST", signal: ac.signal, headers: { authorization: "Bearer " + token, origin, "content-type": "application/json" }, body: JSON.stringify({ ...input, requestId: "request-two" }) }).catch(() => null);
    await new Promise(r => setTimeout(r, 50));
    ac.abort(); await queued;
    await new Promise(r => setTimeout(r, 50));
    const me = await (await req(url, "/v1/me")).json();
    assert.equal(me.quota.requests, 1, "슬롯을 기다리다 끊긴 요청은 제공자에 가지 않았으므로 사용량에서 빠진다");
    assert.equal(calls, 1);
    release();
    assert.equal((await first).status, 200);
  } finally { release(); await close(server); removeTemp(root); }
});

test("per-account rate limit throttles POST routes", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "summrizei-service-test-"));
  const server = createServer({ ...config(root), ACCOUNT_RATE_PER_MIN: "1" }, { fetch: async () => provider() });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const url = "http://127.0.0.1:" + server.address().port;
  try {
    assert.equal((await req(url, "/v1/write", "POST", input)).status, 200);
    const limited = await req(url, "/v1/write", "POST", { ...input, requestId: "request-two" });
    assert.equal(limited.status, 429);
    const e = (await limited.json()).error;
    assert.equal(e.code, "rate_limited");
    assert.equal(e.retryable, true);
    assert.ok(e.retryAfterMs > 0 && e.retryAfterMs <= 60000);
  } finally { await close(server); removeTemp(root); }
});

test("invalid remote config and provider concurrency fail at boot", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "summrizei-service-test-"));
  try {
    for (const bad of [{ bogus: 1 }, { throughputMbps: 0 }, { concurrency: { vision: -1 } }, { concurrency: { bogus: 1 } }, { minClientVersion: "soon" }])
      assert.throws(() => createServer({ ...config(root), REMOTE_CONFIG_JSON: JSON.stringify(bad) }), undefined, JSON.stringify(bad));
    assert.throws(() => createServer({ ...config(root), PROVIDER_CONCURRENCY_JSON: JSON.stringify({ [model]: 0 }) }));
    assert.throws(() => createServer({ ...config(root), PROVIDER_CONCURRENCY_JSON: JSON.stringify({ [model]: 1.5 }) }));
  } finally { removeTemp(root); }
});

test("oversized bodies report request_too_large and preflight advertises the version header", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "summrizei-service-test-"));
  const { server, url } = await listen(root, async () => provider());
  try {
    const big = await req(url, "/v1/write", "POST", { ...input, evidence: [{ ...input.evidence[0], text: "x".repeat(300000) }] });
    assert.equal(big.status, 413);
    assert.equal((await big.json()).error.code, "request_too_large");
    const pre = await fetch(url + "/v1/write", { method: "OPTIONS", headers: { origin } });
    assert.equal(pre.status, 204);
    assert.match(pre.headers.get("access-control-allow-headers"), /x-client-version/);
  } finally { await close(server); removeTemp(root); }
});

test("gone /v1/summary route answers not_found and never reaches the provider", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "summrizei-service-test-"));
  let calls = 0;
  const { server, url } = await listen(root, async () => { calls++; return provider(); });
  try {
    const res = await req(url, "/v1/summary", "POST", input);
    assert.equal(res.status, 404);
    assert.equal((await res.json()).error.code, "not_found");
    assert.equal(calls, 0, "삭제된 라우트가 제공자를 부르면 안 된다");
  } finally { await close(server); removeTemp(root); }
});

// ── STT (OpenRouter MAI Transcribe) ──
const sttEnv = root => ({
  ...config(root),
  ALLOWED_STT_MODELS: JSON.stringify(["microsoft/mai-transcribe-2"]),
  ALLOWED_VISION_MODELS: JSON.stringify([model]),
  ACCOUNT_LIMITS_JSON: JSON.stringify({
    A: { models: [model], maxRequests: 50, maxCostCents: 500, features: ["stt", "vision"] },
    B: { models: [model], maxRequests: 50, maxCostCents: 500 },
  }),
});
const audio = size => "data:audio/mp4;base64," + Buffer.alloc(size, 7).toString("base64");
const wav = size => "data:audio/wav;base64," + Buffer.alloc(size, 7).toString("base64");
const maiRaw = () => ({
  text: "등가 회로를 먼저 그립니다. 전류 법칙을 적용합니다.", language: "ko", duration: 12.4,
  segments: [
    { id: 0, start: 0, end: 5.2, text: "  등가 회로를 먼저 그립니다.  " },
    { id: 1, start: 5.8, end: 12.4, text: "전류 법칙을 적용합니다." },
  ],
  words: [
    { word: " 등가 ", start: 0.1, end: 0.5, confidence: 0.9 }, { word: "회로를", start: 0.6, end: 1.2 },
    { word: "그리고", start: 5.4, end: 5.7 }, { word: "전류", start: 6.0, end: 6.6, confidence: 0.8 },
  ],
  usage: { cost: 0.004, seconds: 12.4 },
});
const sttBody = o => ({ model: "microsoft/mai-transcribe-2", requestId: "stt-x", t0: 100, durationSec: 60, lang: "ko", prompt: "강의 전사", audio: audio(4096), ...o });
const settle = usd => Math.ceil(usd * 1e6) / 1e4;

test("stt posts base64 audio to OpenRouter and bills the reported cost", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "summrizei-service-test-"));
  let calls = 0, sentUrl, sent, reply = maiRaw();
  const server = createServer(sttEnv(root), { fetch: async (u, o) => { calls++; sentUrl = u; sent = o; return { ok: true, json: async () => reply }; } });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const url = "http://127.0.0.1:" + server.address().port;
  try {
    const res = await req(url, "/v1/stt", "POST", sttBody({ requestId: "stt-one", prompt: "등가 회로, KCL ,, KCL" }));
    assert.equal(res.status, 200);
    assert.equal(calls, 1);
    assert.equal(sentUrl, "https://openrouter.ai/api/v1/audio/transcriptions");
    assert.equal(sent.method, "POST");
    assert.equal(sent.headers.authorization, "Bearer mock-operator-key", "운영자 OpenRouter 키로 나간다");
    assert.equal(sent.headers["content-type"], "application/json");
    const body = JSON.parse(sent.body);
    assert.equal(body.model, "microsoft/mai-transcribe-2");
    assert.equal(body.input_audio.format, "m4a");
    assert.equal(body.input_audio.data, audio(4096).split(",")[1], "data URI 가 아니라 raw base64 다");
    assert.equal(body.language, "ko");
    assert.equal(body.response_format, "verbose_json");
    assert.deepEqual(body.timestamp_granularities, ["segment", "word"]);
    assert.equal(body.prompt, undefined, "이 모델이 무시하는 필드는 빼고");
    assert.equal(body.temperature, undefined, "temperature 도 보내지 않는다");
    assert.deepEqual(body.provider, { options: { azure: { phraseList: { phrases: ["등가 회로", "KCL"] } } } }, "prompt 는 구문 목록으로 내린다");

    const data = await res.json();
    const checked = Contracts.validate(Contracts.SCHEMAS.transcript, data.transcript);
    assert.ok(checked.ok, JSON.stringify(checked.errors));
    assert.equal(data.transcript.engine, "openrouter-mai");
    assert.equal(data.transcript.model, "microsoft/mai-transcribe-2");
    assert.equal(data.transcript.lang, "ko");
    const [s0, s1] = data.transcript.segments;
    assert.equal(s0.id, "100000-0");
    assert.equal(s0.t0, 100); assert.equal(s0.t1, 105.2);
    assert.equal(s1.t0, 105.8); assert.equal(s1.t1, 112.4);
    assert.equal(s0.text, "등가 회로를 먼저 그립니다.");
    assert.deepEqual(s0.words.map(w => w.w), ["등가", "회로를"]);
    assert.deepEqual(s1.words.map(w => w.w), ["전류"], "틈새의 단어는 어느 세그먼트에도 붙지 않는다");
    assert.deepEqual(s0.words[0], { w: "등가", t0: 100.1, t1: 100.5 }, "단어 confidence 는 계약에 없어 버린다");
    assert.equal(s0.noSpeechProb, null, "MAI 에는 품질 점수가 없다");
    assert.equal(s0.status, "kept");
    assert.equal(data.usage.audioSec, 60, "선언 60초가 제공자 측정 13초보다 길다");
    assert.equal(data.usage.costUsd, 0.004, "제공자가 보고한 usage.cost 를 그대로 쓴다");
    assert.equal(data.promptVersion, "v1");
    assert.equal(data.schemaVersion, 1);

    // 빈 prompt 는 provider 를 빼고, usage.cost 가 없으면 시간 단가로 되돌린다(최소 과금 10초).
    reply = { duration: 4, segments: [{ start: 0, end: 3.5, text: "짧은 음성" }] };
    const short = await (await req(url, "/v1/stt", "POST", sttBody({ requestId: "stt-two", durationSec: 3, prompt: "" }))).json();
    assert.equal(JSON.parse(sent.body).provider, undefined, "구문이 없으면 provider 를 보내지 않는다");
    assert.equal(short.usage.audioSec, 10);
    assert.equal(short.usage.costUsd, 0.10 * 10 / 3600);

    // 제공자가 잰 길이가 선언보다 길면 그 값까지 올려 정산한다.
    reply = { ...maiRaw(), usage: {} };
    const long = await (await req(url, "/v1/stt", "POST", sttBody({ requestId: "stt-three", durationSec: 3 }))).json();
    assert.equal(long.usage.audioSec, 13);
    assert.equal(long.usage.costUsd, 0.10 * 13 / 3600);

    // wav 도 받아들인다.
    reply = maiRaw();
    assert.equal((await req(url, "/v1/stt", "POST", sttBody({ requestId: "stt-wav", audio: wav(1024) }))).status, 200);
    assert.equal(JSON.parse(sent.body).input_audio.format, "wav");

    const me = await (await req(url, "/v1/me")).json();
    assert.equal(me.quota.requests, 4);
    const expected = settle(0.004) + settle(0.10 * 10 / 3600) + settle(0.10 * 13 / 3600) + settle(0.004);
    assert.ok(Math.abs(me.quota.spentCents - expected) < 1e-9, "예약 1센트는 정산에서 되돌아간다: " + me.quota.spentCents);
  } finally { await close(server); removeTemp(root); }
});

test("stt lang auto omits the provider language field and reports the detected language", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "summrizei-service-test-"));
  let sent, reply = { ...maiRaw(), language: "Korean" };
  const server = createServer(sttEnv(root), { fetch: async (u, o) => { sent = o; return { ok: true, json: async () => reply }; } });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const url = "http://127.0.0.1:" + server.address().port;
  try {
    let data = await (await req(url, "/v1/stt", "POST", sttBody({ requestId: "stt-auto", lang: "auto" }))).json();
    assert.equal(JSON.parse(sent.body).language, undefined, "auto는 language 필드를 보내지 않는다");
    assert.equal(data.transcript.lang, "ko", "감지된 korean은 ko로 접는다");
    for (const [i, language, want] of [[0, "english", "en"], [1, "ko", "ko"], [2, "japanese", "auto"], [3, undefined, "auto"]]) {
      reply = { ...maiRaw(), language };
      if (language === undefined) delete reply.language;
      data = await (await req(url, "/v1/stt", "POST", sttBody({ requestId: "stt-auto-" + i, lang: "auto" }))).json();
      assert.equal(data.transcript.lang, want, String(language));
    }
    await req(url, "/v1/stt", "POST", sttBody({ requestId: "stt-pinned", lang: "ko" }));
    assert.equal(JSON.parse(sent.body).language, "ko", "명시 언어는 그대로 보낸다");
  } finally { await close(server); removeTemp(root); }
});

test("stt bills the last segment end when the provider omits duration", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "summrizei-service-test-"));
  const server = createServer(sttEnv(root), { fetch: async () => ({ ok: true, json: async () => ({ segments: [{ start: 0, end: 150, text: "긴 음성" }] }) }) });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const url = "http://127.0.0.1:" + server.address().port;
  try {
    const data = await (await req(url, "/v1/stt", "POST", sttBody({ requestId: "stt-nodur", durationSec: 20 }))).json();
    assert.equal(data.usage.audioSec, 150, "선언 20초보다 실제 150초 분량이 정산된다");
    assert.equal(data.usage.costUsd, 0.10 * 150 / 3600);
  } finally { await close(server); removeTemp(root); }
});

test("stt validates fields, audio size and the paid feature gate", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "summrizei-service-test-"));
  let calls = 0;
  const server = createServer(sttEnv(root), { fetch: async () => { calls++; return { ok: true, json: async () => maiRaw() }; } });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const url = "http://127.0.0.1:" + server.address().port;
  const offRoot = fs.mkdtempSync(path.join(os.tmpdir(), "summrizei-service-test-"));
  const off = createServer({ ...sttEnv(offRoot), FEATURE_FLAGS_JSON: JSON.stringify({ stt: false }) }, { fetch: async () => ({ ok: true, json: async () => maiRaw() }) });
  await new Promise(r => off.listen(0, "127.0.0.1", r));
  const offUrl = "http://127.0.0.1:" + off.address().port;
  const expect = async (body, status, code, auth) => {
    const r = await req(url, "/v1/stt", "POST", body, auth);
    assert.equal(r.status, status, code);
    assert.equal((await r.json()).error.code, code);
  };
  try {
    await expect(sttBody({ requestId: "v-model", model: "nope" }), 400, "invalid_model");
    const { prompt: _drop, ...missingPrompt } = sttBody({ requestId: "v-missing" });
    await expect(missingPrompt, 400, "unexpected_field");
    await expect(sttBody({ requestId: "v-extra", extra: 1 }), 400, "unexpected_field");
    for (const [i, patch] of [{ durationSec: 0 }, { durationSec: 331 }, { t0: -1 }, { lang: "fr" }, { prompt: "x".repeat(1001) }].entries())
      await expect(sttBody({ requestId: "v-params-" + i, ...patch }), 400, "invalid_stt_params");
    await expect(sttBody({ requestId: "v-mime", audio: "data:image/jpeg;base64,AAAA" }), 400, "invalid_audio");
    await expect(sttBody({ requestId: "v-ogg", audio: "data:audio/ogg;base64,AAAA" }), 400, "invalid_audio");
    await expect(sttBody({ requestId: "v-garbage", audio: "not-audio" }), 400, "invalid_audio");
    assert.equal(calls, 0, "검증 실패는 제공자를 호출하지 않는다");

    await expect(sttBody({ requestId: "v-big", audio: audio(12 * 1024 * 1024 + 1) }), 413, "audio_too_large");
    assert.equal((await req(url, "/v1/stt", "POST", sttBody({ requestId: "v-max", audio: audio(12 * 1024 * 1024) }))).status, 200, "12 MiB 정확히는 통과한다");
    const huge = await req(url, "/v1/stt", "POST", sttBody({ requestId: "v-huge", audio: audio(13 * 1024 * 1024) }));
    assert.equal(huge.status, 413);
    assert.equal((await huge.json()).error.code, "request_too_large", "17 MB 본문 상한이 먼저 걸린다");

    assert.equal((await req(url, "/v1/stt", "POST", sttBody({ requestId: "v-dup" }))).status, 200);
    const before = calls;
    assert.equal((await req(url, "/v1/stt", "POST", sttBody({ requestId: "v-dup" }))).status, 409);
    assert.equal(calls, before, "중복은 제공자를 다시 호출하지 않는다");
    const mismatch = await req(url, "/v1/stt", "POST", sttBody({ requestId: "v-dup", durationSec: 20 }));
    assert.equal(mismatch.status, 400);
    assert.equal((await mismatch.json()).error.code, "idempotency_content_mismatch");

    await expect(sttBody({ requestId: "v-free" }), 403, "feature_not_in_account_plan", tokenB);
    const offMe = await (await req(offUrl, "/v1/me")).json();
    assert.deepEqual(offMe.features, ["vision"], "전역 스위치가 꺼진 stt 는 목록에서 빠진다");
    const blocked = await req(offUrl, "/v1/stt", "POST", sttBody({ requestId: "v-off" }));
    assert.equal(blocked.status, 403);
    assert.equal((await blocked.json()).error.code, "feature_not_in_account_plan");
  } finally { await close(server); await close(off); removeTemp(root); removeTemp(offRoot); }
});

test("stt refunds provider HTTP errors but keeps the reservation on bad output", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "summrizei-service-test-"));
  let mode = "fail";
  const server = createServer(sttEnv(root), { fetch: async () => {
    if (mode === "fail") return { ok: false, status: 500, headers: new Map(), json: async () => ({}) };
    if (mode === "busy") return { ok: false, status: 429, headers: new Map([["retry-after", "3"]]), json: async () => ({}) };
    if (mode === "malformed") return { ok: true, json: async () => ({ duration: 1, text: "no segments" }) };
    if (mode === "huge") return { ok: true, json: async () => ({ ...maiRaw(), pad: "x".repeat(2 * 1024 * 1024) }) };
    return { ok: true, json: async () => maiRaw() };
  }});
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const url = "http://127.0.0.1:" + server.address().port;
  try {
    let r = await req(url, "/v1/stt", "POST", sttBody({ requestId: "stt-500" }));
    assert.equal(r.status, 502);
    let e = (await r.json()).error;
    assert.equal(e.code, "provider_failed_or_invalid_output");
    assert.equal(e.retryable, true);
    let me = await (await req(url, "/v1/me")).json();
    assert.equal(me.quota.requests, 0, "환불은 사용량을 되돌린다");
    assert.equal(me.quota.spentCents, 0);
    mode = "ok";
    assert.equal((await req(url, "/v1/stt", "POST", sttBody({ requestId: "stt-500" }))).status, 200, "환불된 requestId는 다시 쓸 수 있다");

    mode = "busy";
    r = await req(url, "/v1/stt", "POST", sttBody({ requestId: "stt-busy" }));
    assert.equal(r.status, 429);
    e = (await r.json()).error;
    assert.equal(e.code, "provider_busy");
    assert.equal(e.retryAfterMs, 3000);
    me = await (await req(url, "/v1/me")).json();
    assert.equal(me.quota.requests, 1, "앞의 성공 1건만 남는다");
    assert.ok(Math.abs(me.quota.spentCents - settle(0.004)) < 1e-9);

    mode = "malformed";
    r = await req(url, "/v1/stt", "POST", sttBody({ requestId: "stt-bad" }));
    assert.equal(r.status, 502);
    me = await (await req(url, "/v1/me")).json();
    assert.ok(me.quota.spentCents > 1, "불량 출력은 예약 전액을 유지한다");
    mode = "ok";
    r = await req(url, "/v1/stt", "POST", sttBody({ requestId: "stt-bad" }));
    assert.equal(r.status, 409, "유지된 예약은 같은 requestId를 막는다");

    mode = "huge";
    r = await req(url, "/v1/stt", "POST", sttBody({ requestId: "stt-huge" }));
    assert.equal(r.status, 502, "2 MiB 넘는 제공자 본문은 거절한다");
  } finally { await close(server); removeTemp(root); }
});

test("stt keeps audio out of the ledger and error bodies", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "summrizei-service-test-"));
  let mode = "ok";
  const server = createServer(sttEnv(root), { fetch: async () => mode === "fail"
    ? { ok: false, status: 500, headers: new Map(), json: async () => ({}) }
    : { ok: true, json: async () => maiRaw() } });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const url = "http://127.0.0.1:" + server.address().port;
  try {
    const marker = crypto.randomBytes(2048).toString("base64");
    const clip = "data:audio/mp4;base64," + marker;
    assert.equal((await req(url, "/v1/stt", "POST", sttBody({ requestId: "p-ok", audio: clip }))).status, 200);
    mode = "fail";
    const failed = await req(url, "/v1/stt", "POST", sttBody({ requestId: "p-fail", audio: clip }));
    assert.equal(failed.status, 502);
    assert.ok(!(await failed.text()).includes(marker.slice(0, 32)), "오류 응답에 음성이 섞여 나간다");
    assert.ok(!fs.readFileSync(path.join(root, "usage.json"), "utf8").includes(marker.slice(0, 32)), "원장에 음성 페이로드가 남는다");
  } finally { await close(server); removeTemp(root); }
});

test("toTranscript maps mai verbose_json into the contract deterministically", () => {
  const opts = { t0: 10, model: "microsoft/mai-transcribe-2", lang: "ko" };
  const t = toTranscript({ segments: [{ start: 0, end: 2, text: "a" }, { start: 4, end: 6, text: "b" }], words: [
    { word: "w0", start: 0, end: 1, confidence: 0.9 },
    { word: "edge", start: 1.9, end: 2.1 },
    { word: "inside", start: 4.5, end: 5 },
    { word: "gap", start: 2.5, end: 3 },
    { word: "tail", start: 9, end: 10 },
    { word: "  ", start: 0, end: 1 },
    { word: 5, start: 0, end: 1 },
  ] }, opts);
  assert.equal(t.schemaVersion, Contracts.CONTRACT_VERSION);
  assert.equal(t.engine, "openrouter-mai");
  assert.equal(t.segments[0].id, "10000-0");
  assert.equal(t.segments[0].t0, 10);
  assert.deepEqual(t.segments[0].words.map(w => w.w), ["w0", "edge"], "중간 시각을 품는 세그먼트에 붙는다(경계 포함)");
  assert.deepEqual(t.segments[1].words.map(w => w.w), ["inside"], "틈새·마지막 이후 단어는 버린다");
  assert.deepEqual(t.segments[0].words[0], { w: "w0", t0: 10, t1: 11 }, "confidence 는 계약에 없어 버리고 단어 시각에도 t0 를 더한다");
  assert.equal(t.segments[0].noSpeechProb, null, "MAI 에는 품질 점수가 없다");
  assert.equal(t.segments[0].avgLogprob, null);
  assert.equal(t.segments[0].compressionRatio, null);

  const noWords = toTranscript({ segments: [{ start: 0, end: 1, text: "x" }] }, opts);
  assert.deepEqual(noWords.segments[0].words, []);
  const empty = toTranscript({ segments: [], words: [{ word: "a", start: 0, end: 1 }] }, opts);
  assert.deepEqual(empty.segments, [], "세그먼트가 없으면 단어는 버린다");
  const ranged = toTranscript({ segments: [{ start: 0, end: 1, text: "x", no_speech_prob: 1.5, avg_logprob: -0.2 }] }, opts);
  assert.equal(ranged.segments[0].noSpeechProb, null, "Whisper 점수가 섞여 와도 계약 필드는 null 로 둔다");
  assert.equal(ranged.segments[0].avgLogprob, null);
  assert.throws(() => toTranscript({ segments: [{ end: 1, text: "x" }] }, opts), /invalid_stt_output/);
  assert.throws(() => toTranscript({ segments: "x" }, opts));
  assert.throws(() => toTranscript(null, opts));
});

test("ServiceClient.stt round-trips through the real client and sends its version", async () => {
  const ServiceClient = require("../lib/service-client.js");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "summrizei-service-test-"));
  const server = createServer(sttEnv(root), { fetch: async () => ({ ok: true, json: async () => maiRaw() }) });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const url = "http://127.0.0.1:" + server.address().port;
  const strictRoot = fs.mkdtempSync(path.join(os.tmpdir(), "summrizei-service-test-"));
  const strict = createServer({ ...sttEnv(strictRoot), REMOTE_CONFIG_JSON: JSON.stringify({ minClientVersion: "9.0.0" }) }, { fetch: async () => ({ ok: true, json: async () => maiRaw() }) });
  await new Promise(r => strict.listen(0, "127.0.0.1", r));
  const strictUrl = "http://127.0.0.1:" + strict.address().port;
  globalThis.chrome = { runtime: { getManifest: () => ({ version: "1.2.3" }) } };
  try {
    const data = await ServiceClient.stt({ baseUrl: url, token, model: "microsoft/mai-transcribe-2", requestId: "cli-stt", t0: 0, durationSec: 10, lang: "ko", audio: audio(512) });
    assert.equal(data.transcript.engine, "openrouter-mai");
    assert.equal(data.transcript.segments.length, 2);
    let err;
    try { await ServiceClient.stt({ baseUrl: url, token, model: "nope", requestId: "cli-bad", t0: 0, durationSec: 10, lang: "ko", audio: audio(512) }); } catch (e) { err = e; }
    assert.ok(err instanceof Error);
    assert.equal(err.code, "invalid_model");
    assert.equal(err.retryable, false);
    assert.equal(err.retryAfterMs, null);
    let old;
    try { await ServiceClient.me({ baseUrl: strictUrl, token }); } catch (e) { old = e; }
    assert.equal(old.code, "client_upgrade_required", "클라이언트가 x-client-version 을 실제로 보낸다");
    globalThis.chrome.runtime.getManifest = () => ({ version: "9.0.1" });
    const me = await ServiceClient.me({ baseUrl: strictUrl, token });
    assert.equal(me.accountId, "A");
  } finally {
    delete globalThis.chrome;
    await close(server);
    await close(strict);
    removeTemp(root);
    removeTemp(strictRoot);
  }
});

test("vision returns a structured slideDoc through strict json_schema", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "summrizei-service-test-"));
  let sent = null;
  const server = createServer(visionEnv(root), { fetch: async (_u, o) => { sent = JSON.parse(o.body); return slideProvider(); } });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const url = "http://127.0.0.1:" + server.address().port;
  try {
    const res = await req(url, "/v1/vision", "POST", visionBody({ requestId: "vs-one" }));
    assert.equal(res.status, 200);
    const rf = sent.response_format;
    assert.equal(rf.type, "json_schema");
    assert.equal(rf.json_schema.strict, true);
    assert.equal(rf.json_schema.name, "slide_doc");
    assert.deepEqual(rf.json_schema.schema, VISION_SCHEMA);
    assert.ok(Contracts.isStrictCompatible(VISION_SCHEMA), "제공자 스키마는 strict 호환이어야 한다");
    assert.ok(!/"maxLength"|"maxItems"|"minimum"|"maximum"|"const"|"pattern"/.test(JSON.stringify(VISION_SCHEMA)), "검증 전용 키워드가 제공자로 새 나간다");
    // id·status는 서버가 채우는 필드라 모델 출력 스키마에는 없어야 한다.
    const walk = o => { if (!o || typeof o !== "object") return; for (const bad of ["id", "status"]) assert.ok(!Object.hasOwn(o.properties || {}, bad), bad + "가 스키마에 남았다"); for (const p of Object.values(o.properties || {})) walk(p); if (o.items) walk(o.items); };
    walk(VISION_SCHEMA);
    assert.equal(sent.messages[0].role, "system");
    assert.match(sent.messages[0].content, /판독기다/);
    assert.equal(sent.messages[1].content[1].type, "image_url");
    assert.equal(sent.messages[1].content[1].image_url.url, visionBody().image);
    assert.equal(sent.provider.zdr, true);
    assert.equal(sent.temperature, 0);
    assert.equal(sent.max_tokens, 8192);

    const data = await res.json();
    const checked = Contracts.validate(Contracts.SCHEMAS.slideDoc, data.slideDoc);
    assert.ok(checked.ok, JSON.stringify(checked.errors));
    const doc = data.slideDoc;
    assert.equal(doc.slideId, "lec-01-slide-03");
    assert.equal(doc.t0, 120);
    assert.equal(doc.t1, 135.5);
    assert.equal(doc.engine, "vision-cloud");
    assert.equal(doc.model, model);
    assert.deepEqual(doc.blocks.map(b => b.id), ["b1", "b2", "b3"]);
    assert.equal(doc.formulas[0].id, "f1");
    assert.equal(doc.formulas[0].latex, "\\sum_k i_k = 0", "$$ 껍데기는 벗긴다");
    assert.equal(doc.formulas[0].status, "unverified");
    assert.equal(doc.figures[0].id, "g1");
    assert.equal(doc.figures[0].bbox.w, 1, "범위 밖 좌표는 0~1로 잘린다");
    assert.deepEqual(doc.figures[0].cells, [["노드", "전류"], ["a", "1.2A"]]);
    assert.equal(data.usage.promptTokens, 900);
    assert.equal(data.usage.costUsd, 0.002);
    assert.equal(data.promptVersion, "v1");
    assert.equal(data.schemaVersion, 1);

    const rr = await req(url, "/v1/vision", "POST", visionBody({ requestId: "vs-reread", mode: "reread" }));
    assert.equal(rr.status, 200);
    assert.match(sent.messages[0].content, /2배로 확대/, "reread 는 재판독 프롬프트로 나간다");
    assert.equal((await rr.json()).slideDoc.formulas[0].status, "reread");
  } finally { await close(server); removeTemp(root); }
});

test("vision sends reasoning effort and no temperature to openai/gpt-6-luna", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "summrizei-service-test-"));
  const luna = "openai/gpt-6-luna";
  let sent = null;
  const env = {
    ...visionEnv(root),
    ALLOWED_VISION_MODELS: JSON.stringify([model, luna]),
    OPENROUTER_PROVIDERS_JSON: JSON.stringify({ [model]: ["test-provider"], [luna]: ["azure"] }),
  };
  const server = createServer(env, { fetch: async (_u, o) => { sent = JSON.parse(o.body); return slideProvider(); } });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const url = "http://127.0.0.1:" + server.address().port;
  try {
    const res = await req(url, "/v1/vision", "POST", visionBody({ model: luna, requestId: "vl-one" }));
    assert.equal(res.status, 200);
    assert.deepEqual(sent.reasoning, { effort: "high" });
    assert.ok(!Object.hasOwn(sent, "temperature"), "temperature 를 거절하는 엔드포인트에는 키를 아예 뺀다(require_parameters)");
    assert.equal(sent.max_tokens, 16384, "추론 토큰도 max_tokens 를 먹는다");
    assert.deepEqual(sent.provider.only, ["azure"]);

    const lite = await req(url, "/v1/vision", "POST", visionBody({ requestId: "vl-two" }));
    assert.equal(lite.status, 200);
    assert.equal(sent.temperature, 0);
    assert.equal(sent.max_tokens, 8192);
    assert.ok(!Object.hasOwn(sent, "reasoning"), "기존 모델의 요청 모양은 그대로다");
  } finally { await close(server); removeTemp(root); }
});

test("vision retries one malformed structured response then fails with the reservation kept", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "summrizei-service-test-"));
  let calls = 0, mode = "bad-then-good";
  const server = createServer(visionEnv(root), { fetch: async () => {
    calls++;
    if (mode === "bad-then-good" && calls === 1) return { ok: true, json: async () => ({ choices: [{ finish_reason: "stop", message: { content: "{broken" } }], usage: { prompt_tokens: 10, completion_tokens: 5, cost: .001 } }) };
    if (mode === "allbad") return { ok: true, json: async () => ({ choices: [{ finish_reason: "stop", message: { content: "{}" } }], usage: { prompt_tokens: 10, completion_tokens: 5, cost: .001 } }) };
    if (mode === "noise") return slideProvider({ blocks: [{ text: "x", role: "noise", bbox: null, conf: null }], formulas: [], figures: [] });
    return slideProvider();
  }});
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const url = "http://127.0.0.1:" + server.address().port;
  try {
    const res = await req(url, "/v1/vision", "POST", visionBody({ requestId: "vr-one" }));
    assert.equal(res.status, 200);
    assert.equal(calls, 2, "첫 응답이 깨지면 같은 제공자로 한 번 더 간다");
    const data = await res.json();
    assert.equal(data.usage.promptTokens, 910, "두 시도의 토큰을 합친다");
    assert.equal(data.usage.costUsd, .003);

    mode = "allbad";
    const bad = await req(url, "/v1/vision", "POST", visionBody({ requestId: "vr-two" }));
    assert.equal(bad.status, 502);
    assert.equal(calls, 4);
    let me = await (await req(url, "/v1/me")).json();
    assert.ok(me.quota.spentCents > 1, "두 번 다 깨지면 예약 전액을 유지한다");
    assert.equal((await req(url, "/v1/vision", "POST", visionBody({ requestId: "vr-two" }))).status, 409);

    mode = "noise";
    assert.equal((await req(url, "/v1/vision", "POST", visionBody({ requestId: "vr-three" }))).status, 502, "계약을 어긴 role 도 형식 실패다");
    assert.equal(calls, 6);

    for (const k of ["slideId", "t0", "t1", "mode"]) {
      const b = visionBody({ requestId: "vp-miss-" + k }); delete b[k];
      const r = await req(url, "/v1/vision", "POST", b);
      assert.equal(r.status, 400, k);
      assert.equal((await r.json()).error.code, "unexpected_field", k);
    }
    for (const [i, patch] of [{ t0: 10, t1: 5 }, { slideId: "bad slide!" }, { mode: "half" }, { t0: -1 }].entries()) {
      const r = await req(url, "/v1/vision", "POST", visionBody({ requestId: "vp-bad-" + i, ...patch }));
      assert.equal(r.status, 400);
      assert.equal((await r.json()).error.code, "invalid_vision_params", JSON.stringify(patch));
    }
    assert.equal(calls, 6, "검증 실패는 제공자를 호출하지 않는다");
  } finally { await close(server); removeTemp(root); }
});

test("toSlideDoc clamps boxes, strips dollars and never invents fields", () => {
  const opts = { slideId: "s1", t0: 0, t1: 10, model, mode: "full" };
  const doc = toSlideDoc({
    blocks: [null, { text: "   ", role: "body", bbox: null, conf: null }, { text: "본문", role: "body", bbox: { x: -0.5, y: 0.5, w: 1.7, h: 0.1 }, conf: 2 }],
    formulas: [{ latex: " $$ e=mc^2 $$ ", text: null, bbox: null, conf: null }, { latex: "  ", text: "보이는 대로", bbox: null, conf: null }],
    figures: [],
  }, opts);
  assert.equal(doc.blocks.length, 1, "null·공백 블록은 버린다");
  assert.equal(doc.blocks[0].id, "b1", "살아남은 블록부터 번호를 다시 매긴다");
  assert.deepEqual(doc.blocks[0].bbox, { x: 0, y: 0.5, w: 1, h: 0.1 });
  assert.equal(doc.blocks[0].conf, 1);
  assert.equal(doc.formulas[0].latex, "e=mc^2");
  assert.equal(doc.formulas[1].latex, null, "벗기고 비면 latex는 null이다");
  assert.equal(doc.formulas[0].status, "unverified");
  const rr = toSlideDoc({ blocks: [], formulas: [], figures: [] }, { ...opts, mode: "reread" });
  assert.equal(rr.engine, "vision-cloud");
  assert.equal(Contracts.validate(Contracts.SCHEMAS.slideDoc, rr).ok, true, "빈 세 배열도 계약상 정상이다");
  const missing = toSlideDoc({ blocks: [{ text: "x" }], formulas: [], figures: [] }, opts);
  assert.equal(Contracts.validate(Contracts.SCHEMAS.slideDoc, missing).ok, false, "없는 필드를 기본값으로 채우지 않는다 — 계약이 걸러낸다");
  assert.throws(() => toSlideDoc({ blocks: [] }, opts), /invalid_vision_output/);
  assert.throws(() => toSlideDoc(null, opts));
});

test("ServiceClient.vision round-trips a structured slideDoc", async () => {
  const ServiceClient = require("../lib/service-client.js");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "summrizei-service-test-"));
  const server = createServer(visionEnv(root), { fetch: async () => slideProvider() });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const url = "http://127.0.0.1:" + server.address().port;
  try {
    const data = await ServiceClient.vision({ baseUrl: url, token, model, requestId: "cv-one", slideId: "lec-01-slide-03", t0: 0, t1: 5, image: jpeg(512) });
    assert.equal(data.slideDoc.engine, "vision-cloud");
    assert.equal(data.slideDoc.blocks.length, 3);
    assert.equal(data.slideDoc.formulas[0].latex, "\\sum_k i_k = 0");
    let err;
    try { await ServiceClient.vision({ baseUrl: url, token, model: "not-allowed", requestId: "cv-bad", slideId: "x", t0: 0, t1: 1, image: jpeg(512) }); } catch (e) { err = e; }
    assert.ok(err instanceof Error);
    assert.equal(err.code, "invalid_model");
  } finally { await close(server); removeTemp(root); }
});

test("request-count and rate defaults are generous so the cost caps stay the real guard", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "summrizei-service-test-"));
  const { server, url } = await listen(root, async () => provider());
  try {
    const c = serverConfig(config(root));
    assert.equal(c.maxRequests, 10000, "월 요청 수 기본값");
    assert.equal(c.ratePerMin, 300, "분당 POST 기본값");
    assert.equal(c.maxCents, 1500, "비용 캡은 그대로다");
    assert.equal(c.globalCents, 15000);
    const me = await (await req(url, "/v1/me")).json();
    assert.equal(me.quota.maxRequests, 10000, "한도 설정이 없는 계정은 새 기본값을 상속한다");
    assert.equal(me.quota.maxCents, 1500);
    assert.equal(serverConfig({ ...config(root), MAX_REQUESTS: "7", ACCOUNT_RATE_PER_MIN: "9" }).maxRequests, 7, "환경 변수가 기본값을 덮어쓴다");
    assert.equal(serverConfig({ ...config(root), MAX_REQUESTS: "7", ACCOUNT_RATE_PER_MIN: "9" }).ratePerMin, 9);
  } finally { await close(server); removeTemp(root); }
});

// ── 판정(judge) ──
const judgeModel = "openai/gpt-4.1-nano";
const judgeEnv = root => ({
  ...config(root),
  OPENROUTER_PROVIDERS_JSON: JSON.stringify({ [model]: ["test-provider"], [judgeModel]: ["test-provider"] }),
  ACCOUNT_LIMITS_JSON: JSON.stringify({
    A: { models: [model], maxRequests: 50, maxCostCents: 500, features: ["judge"] },
    B: { models: [model], maxRequests: 50, maxCostCents: 500 },
  }),
});
// 제공자는 알파벳 한 글자와 top_logprobs를 실어 보낸다 — 호출별 스펙은 top_logprobs 배열 하나다.
const judgeReply = (top = [{ token: "A", logprob: Math.log(.9) }, { token: " B", logprob: Math.log(.1) }]) => ({
  ok: true,
  json: async () => ({ choices: [{ finish_reason: "length", message: { content: "A" }, logprobs: { content: [{ token: "A", logprob: Math.log(.9), top_logprobs: top }] } }], usage: { prompt_tokens: 300, completion_tokens: 1, cost: .00003 } }),
});
const judgeRaw = top => ({ choices: [{ logprobs: { content: [{ token: "A", logprob: 0, top_logprobs: top }] } }] });
const judgeBody = o => ({ task: "utterance", model: judgeModel, requestId: "judge-x", items: [{ itemId: "it-1", text: "미분은 순간 변화율이다" }, { itemId: "it-2", text: "시험은 다음 주 목요일이다", context: "앞뒤 문맥 단서" }], ...o });

test("judgeProbs renormalises label letters and derives per-task scores", () => {
  const lp = p => Math.log(p);
  const r = judgeProbs(judgeRaw([{ token: "A", logprob: lp(.6) }, { token: " B", logprob: lp(.2) }, { token: "Hello", logprob: lp(.2) }]), "utterance");
  assert.equal(r.probs.length, 4);
  assert.ok(Math.abs(r.probs[0].p - .75) < 1e-9, "라벨 바깥 토큰은 버리고 라벨끼리만 정규화한다");
  assert.ok(Math.abs(r.probs[1].p - .25) < 1e-9);
  assert.equal(r.score, null, "utterance 는 score 가 없다");
  const v = judgeProbs(judgeRaw([{ token: "A", logprob: lp(.3) }, { token: " A", logprob: lp(.2) }, { token: "a", logprob: lp(.1) }, { token: "B", logprob: lp(.4) }]), "utterance");
  assert.ok(Math.abs(v.probs[0].p - .6) < 1e-9, "'A', ' A', 'a' 변형이 한 라벨에 합산된다");
  assert.ok(Math.abs(v.probs[1].p - .4) < 1e-9);
  assert.ok(Math.abs(v.probs.reduce((s, x) => s + x.p, 0) - 1) < 1e-9, "확률 합은 1이다");
  const imp = judgeProbs(judgeRaw([{ token: "D", logprob: lp(.5) }, { token: "E", logprob: lp(.5) }]), "importance");
  assert.equal(imp.probs[3].label, "4");
  assert.ok(Math.abs(imp.score - 4.5) < 1e-9, "importance score 는 기댓값 1~5다");
  assert.ok(Math.abs(judgeProbs(judgeRaw([{ token: "A", logprob: lp(.8) }, { token: "B", logprob: lp(.2) }]), "boilerplate").score - .8) < 1e-9, "boilerplate score 는 p(yes)");
  assert.ok(Math.abs(judgeProbs(judgeRaw([{ token: "A", logprob: lp(.7) }, { token: "B", logprob: lp(.3) }]), "support").score - .7) < 1e-9, "support score 는 p(supported)");
  assert.equal(judgeProbs(judgeRaw([{ token: "A", logprob: lp(.9) }, { token: "B", logprob: lp(.1) }]), "figure").score, null, "figure 는 score 가 없다");
  assert.deepEqual(judgeProbs(judgeRaw([{ token: "Hello", logprob: 0 }, { token: "world", logprob: -1 }]), "utterance"), { probs: [], score: null }, "라벨 글자가 없으면 판정 없음이다");
  assert.throws(() => judgeProbs({ choices: [{ message: { content: "A" } }] }, "utterance"), /judge_logprobs_missing/);
  assert.throws(() => judgeProbs({}, "utterance"), /judge_logprobs_missing/);
});

test("judge calls the provider once per item for each task", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "summrizei-service-test-"));
  const bodies = [];
  let top = [];
  const server = createServer(judgeEnv(root), { fetch: async (_u, o) => { bodies.push(JSON.parse(o.body)); return judgeReply(top); } });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const url = "http://127.0.0.1:" + server.address().port;
  try {
    const cases = {
      utterance: { top: [{ token: "A", logprob: Math.log(.7) }, { token: "B", logprob: Math.log(.3) }], labels: ["lecture", "example", "admin", "chatter"], p: [.7, .3, 0, 0], score: null },
      importance: { top: [{ token: "D", logprob: Math.log(.5) }, { token: "E", logprob: Math.log(.5) }], labels: ["1", "2", "3", "4", "5"], p: [0, 0, 0, .5, .5], score: 4.5 },
      boilerplate: { top: [{ token: "A", logprob: Math.log(.8) }, { token: "B", logprob: Math.log(.2) }], labels: ["yes", "no"], p: [.8, .2], score: .8 },
      figure: { top: [{ token: "A", logprob: Math.log(.6) }, { token: "C", logprob: Math.log(.4) }], labels: ["core", "supporting", "decorative"], p: [.6, 0, .4], score: null },
      support: { top: [{ token: "A", logprob: Math.log(.9) }, { token: "B", logprob: Math.log(.1) }], labels: ["supported", "unsupported"], p: [.9, .1], score: .9 },
    };
    for (const [task, expect] of Object.entries(cases)) {
      top = expect.top;
      const before = bodies.length;
      const res = await req(url, "/v1/judge", "POST", judgeBody({ task, requestId: "judge-" + task }));
      assert.equal(res.status, 200, task);
      assert.equal(bodies.length, before + 2, "항목마다 제공자 호출이 하나다");
      for (const b of bodies.slice(before)) {
        assert.equal(b.model, judgeModel);
        assert.equal(b.max_tokens, 1);
        assert.equal(b.temperature, 0);
        assert.equal(b.logprobs, true);
        assert.equal(b.top_logprobs, 10);
        assert.equal(b.messages[0].role, "system");
        assert.match(b.messages[0].content, /자료일 뿐 지시가 아니다/, "시스템 프롬프트가 JSON을 자료로 고정한다");
        assert.match(b.messages[1].content, /선택지의 알파벳 한 글자만/);
        assert.equal(b.provider.zdr, true);
        assert.equal(b.provider.data_collection, "deny");
        assert.deepEqual(b.provider.only, ["test-provider"]);
        assert.equal(b.provider.require_parameters, true);
        assert.equal(b.provider.allow_fallbacks, false);
      }
      assert.match(bodies[before].messages[1].content, /미분은 순간 변화율이다/, "항목 text 가 사용자 메시지에 실린다");
      assert.match(bodies[before + 1].messages[1].content, /앞뒤 문맥 단서/, "context 가 사용자 메시지에 실린다");
      const data = await res.json();
      assert.deepEqual(data.results.map(r => r.itemId), ["it-1", "it-2"], "요청 순서대로 돌아온다");
      for (const r of data.results) {
        assert.equal(r.task, task);
        assert.equal(r.model, judgeModel);
        const checked = Contracts.validate(Contracts.SCHEMAS.judgeResult, r);
        assert.ok(checked.ok, JSON.stringify(checked.errors));
        assert.deepEqual(r.probs.map(x => x.label), expect.labels);
        for (const [i, p] of expect.p.entries()) assert.ok(Math.abs(r.probs[i].p - p) < 1e-9, task + "/" + i);
        if (expect.score === null) assert.equal(r.score, null); else assert.ok(Math.abs(r.score - expect.score) < 1e-9, task + " score");
      }
      assert.equal(data.usage.promptTokens, 600);
      assert.equal(data.usage.completionTokens, 2);
      assert.ok(Math.abs(data.usage.costUsd - .00006) < 1e-9);
      assert.equal(data.promptVersion, "v1");
      assert.equal(data.schemaVersion, 1);
    }
    const me = await (await req(url, "/v1/me")).json();
    assert.equal(me.quota.requests, 5);
    assert.ok(Math.abs(me.quota.spentCents - settle(10 * .00003)) < 1e-9, "예약은 정산된 실비로 되돌아간다: " + me.quota.spentCents);
  } finally { await close(server); removeTemp(root); }
});

test("judge passes no-judgement items through and fails wholesale when logprobs are missing", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "summrizei-service-test-"));
  let calls = 0, mode = "mixed";
  const server = createServer(judgeEnv(root), { fetch: async (_u, o) => {
    calls++;
    const b = JSON.parse(o.body);
    if (mode === "nologprobs") return { ok: true, json: async () => ({ choices: [{ finish_reason: "length", message: { content: "A" } }], usage: { prompt_tokens: 10, completion_tokens: 1, cost: .00001 } }) };
    if (b.messages[1].content.includes("라벨 없는 답변")) return judgeReply([{ token: "Hello", logprob: 0 }, { token: "world", logprob: -.5 }]);
    return judgeReply();
  }});
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const url = "http://127.0.0.1:" + server.address().port;
  try {
    const res = await req(url, "/v1/judge", "POST", judgeBody({ requestId: "j-mixed", items: [{ itemId: "ok", text: "개념 설명" }, { itemId: "skip", text: "라벨 없는 답변" }] }));
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.results[0].probs.length, 4);
    assert.deepEqual(data.results[1].probs, [], "라벨 글자가 없는 항목은 판정 없음으로 돌아온다");
    assert.equal(data.results[1].score, null);
    mode = "nologprobs";
    const bad = await req(url, "/v1/judge", "POST", judgeBody({ requestId: "j-nolog" }));
    assert.equal(bad.status, 502, "logprobs가 빠진 응답은 요청 전체를 실패시킨다");
    assert.equal((await bad.json()).error.code, "provider_failed_or_invalid_output");
    assert.equal((await req(url, "/v1/judge", "POST", judgeBody({ requestId: "j-nolog" }))).status, 409, "유지된 예약이 같은 requestId를 막는다");
    const me = await (await req(url, "/v1/me")).json();
    assert.ok(me.quota.spentCents > 1, "실패 요청은 예약을 유지한다");
  } finally { await close(server); removeTemp(root); }
});

test("judge validation rejects bad shapes without touching the provider", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "summrizei-service-test-"));
  let calls = 0;
  const server = createServer(judgeEnv(root), { fetch: async () => { calls++; return judgeReply(); } });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const url = "http://127.0.0.1:" + server.address().port;
  const expect = async (b, status, code) => {
    const r = await req(url, "/v1/judge", "POST", b);
    assert.equal(r.status, status, code);
    assert.equal((await r.json()).error.code, code);
  };
  try {
    await expect(judgeBody({ requestId: "v-task", task: "nope" }), 400, "invalid_task");
    await expect(judgeBody({ requestId: "v-model", model }), 400, "invalid_model");
    const { items: _drop, ...noItems } = judgeBody({ requestId: "v-miss" });
    await expect(noItems, 400, "unexpected_field");
    await expect(judgeBody({ requestId: "v-extra", extra: 1 }), 400, "unexpected_field");
    const bads = [
      { items: [] },
      { items: Array.from({ length: 201 }, (_, i) => ({ itemId: "i" + i, text: "a" })) },
      { items: [{ itemId: "d", text: "a" }, { itemId: "d", text: "b" }] },
      { items: [{ itemId: "i" }] },
      { items: [{ itemId: "i", text: "" }] },
      { items: [{ itemId: "i", text: "x".repeat(8001) }] },
      { items: [{ itemId: "i", text: "a", context: "x".repeat(8001) }] },
      { items: [{ itemId: "i", text: "a", nope: 1 }] },
      { items: [{ itemId: "x".repeat(65), text: "a" }] },
      { items: [{ itemId: "i", text: 3 }] },
      { items: [{ itemId: "i", text: "a", context: 2 }] },
    ];
    for (const [i, patch] of bads.entries()) await expect(judgeBody({ requestId: "v-items-" + i, ...patch }), 400, "invalid_items");
    await expect(judgeBody({ requestId: "v-big", items: Array.from({ length: 9 }, (_, i) => ({ itemId: "b" + i, text: "x".repeat(7300) })) }), 413, "items_too_large");
    const huge = await req(url, "/v1/judge", "POST", judgeBody({ requestId: "v-huge", items: Array.from({ length: 10 }, (_, i) => ({ itemId: "h" + i, text: "x".repeat(7500) })) }));
    assert.equal(huge.status, 413);
    assert.equal((await huge.json()).error.code, "request_too_large", "본문 상한이 항목 상한보다 먼저 걸린다");
    assert.equal(calls, 0, "검증 실패는 제공자를 호출하지 않는다");
  } finally { await close(server); removeTemp(root); }
});

test("judge gates the paid feature, honours the global flag and keeps idempotency", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "summrizei-service-test-"));
  let calls = 0;
  const server = createServer(judgeEnv(root), { fetch: async () => { calls++; return judgeReply(); } });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const url = "http://127.0.0.1:" + server.address().port;
  const offRoot = fs.mkdtempSync(path.join(os.tmpdir(), "summrizei-service-test-"));
  const off = createServer({ ...judgeEnv(offRoot), FEATURE_FLAGS_JSON: JSON.stringify({ judge: false }) }, { fetch: async () => judgeReply() });
  await new Promise(r => off.listen(0, "127.0.0.1", r));
  const offUrl = "http://127.0.0.1:" + off.address().port;
  try {
    assert.equal((await req(url, "/v1/judge", "POST", judgeBody({ requestId: "id-one" }))).status, 200);
    const before = calls;
    assert.equal((await req(url, "/v1/judge", "POST", judgeBody({ requestId: "id-one" }))).status, 409);
    assert.equal(calls, before, "중복은 제공자를 다시 호출하지 않는다");
    const mm = await req(url, "/v1/judge", "POST", judgeBody({ requestId: "id-one", items: [{ itemId: "a", text: "다른 내용" }] }));
    assert.equal(mm.status, 400);
    assert.equal((await mm.json()).error.code, "idempotency_content_mismatch");
    const free = await req(url, "/v1/judge", "POST", judgeBody({ requestId: "id-free" }), tokenB);
    assert.equal(free.status, 403);
    assert.equal((await free.json()).error.code, "feature_not_in_account_plan");
    const me = await (await req(offUrl, "/v1/me")).json();
    assert.ok(!me.features.includes("judge"), "전역 스위치가 꺼진 기능은 목록에서 빠진다");
    const blocked = await req(offUrl, "/v1/judge", "POST", judgeBody({ requestId: "id-off" }));
    assert.equal(blocked.status, 403);
    assert.equal((await blocked.json()).error.code, "feature_not_in_account_plan");
  } finally { await close(server); await close(off); removeTemp(root); removeTemp(offRoot); }
});

test("judge shares provider slots per item and stops launching calls after a failure", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "summrizei-service-test-"));
  let running = 0, peak = 0, calls = 0;
  const env = { ...judgeEnv(root), PROVIDER_CONCURRENCY_JSON: JSON.stringify({ [judgeModel]: 2 }) };
  const server = createServer(env, { fetch: async () => { calls++; running++; peak = Math.max(peak, running); await new Promise(r => setTimeout(r, 10)); running--; return judgeReply(); } });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const url = "http://127.0.0.1:" + server.address().port;
  try {
    const items = Array.from({ length: 8 }, (_, i) => ({ itemId: "c" + i, text: "항목 " + i }));
    const second = (async () => { await new Promise(r => setTimeout(r, 20)); return req(url, "/v1/judge", "POST", judgeBody({ requestId: "cc-two" })); })();
    const [r1, r2] = await Promise.all([req(url, "/v1/judge", "POST", judgeBody({ requestId: "cc-one", items })), second]);
    assert.equal(r1.status, 200);
    assert.equal(r2.status, 200, "동시에 온 두 번째 판정 요청도 끝까지 간다");
    assert.equal((await r1.json()).results.length, 8);
    assert.equal(peak, 2, "항목 슬롯이 제공자 동시 상한을 넘지 않는다");
    assert.equal(calls, 10);
  } finally { await close(server); removeTemp(root); }

  const root2 = fs.mkdtempSync(path.join(os.tmpdir(), "summrizei-service-test-"));
  let calls2 = 0;
  const serial = createServer({ ...judgeEnv(root2), PROVIDER_CONCURRENCY_JSON: JSON.stringify({ [judgeModel]: 1 }) }, { fetch: async () => { calls2++; if (calls2 === 2) return { ok: false, status: 500, json: async () => ({}) }; return judgeReply(); } });
  await new Promise(r => serial.listen(0, "127.0.0.1", r));
  const url2 = "http://127.0.0.1:" + serial.address().port;
  try {
    const items = Array.from({ length: 4 }, (_, i) => ({ itemId: "f" + i, text: "항목 " + i }));
    const r = await req(url2, "/v1/judge", "POST", judgeBody({ requestId: "cc-fail", items }));
    assert.equal(r.status, 502);
    assert.equal(calls2, 2, "첫 실패 뒤 남은 항목은 제공자를 부르지 않는다");
  } finally { await close(serial); removeTemp(root2); }
});

test("judge model config validates the allowlist and explicit providers", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "summrizei-service-test-"));
  try {
    assert.throws(() => createServer({ ...config(root), ALLOWED_JUDGE_MODELS: JSON.stringify(["nope/model"]) }), /invalid_judge_model_allowlist/);
    assert.throws(() => createServer({ ...config(root), ALLOWED_JUDGE_MODELS: JSON.stringify([judgeModel]) }), /explicit_provider_allowlist_required/, "허용 모델에 제공자 목록이 없다");
    assert.deepEqual(serverConfig(config(root)).judgeModels, [], "제공자 항목이 없으면 기본은 빈 목록이다");
    assert.deepEqual(serverConfig(judgeEnv(root)).judgeModels, [judgeModel], "제공자 항목이 있으면 기본으로 켜진다");
    assert.deepEqual(serverConfig({ ...judgeEnv(root), ALLOWED_JUDGE_MODELS: "[]" }).judgeModels, [], "명시적으로 끌 수 있다");
    assert.equal(JUDGE_MODELS[judgeModel].via, "logprob");
  } finally { removeTemp(root); }
});

test("ServiceClient.judge round-trips results through the real client", async () => {
  const ServiceClient = require("../lib/service-client.js");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "summrizei-service-test-"));
  const server = createServer(judgeEnv(root), { fetch: async () => judgeReply() });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const url = "http://127.0.0.1:" + server.address().port;
  try {
    const data = await ServiceClient.judge({ baseUrl: url, token, task: "utterance", model: judgeModel, requestId: "cj-one", items: [{ itemId: "a", text: "개념 설명" }] });
    assert.equal(data.results[0].itemId, "a");
    assert.equal(data.results[0].task, "utterance");
    assert.equal(data.results[0].model, judgeModel);
    let err;
    try { await ServiceClient.judge({ baseUrl: url, token, task: "nope", model: judgeModel, requestId: "cj-bad", items: [{ itemId: "a", text: "x" }] }); } catch (e) { err = e; }
    assert.ok(err instanceof Error);
    assert.equal(err.code, "invalid_task");
    assert.equal(err.retryable, false);
  } finally { await close(server); removeTemp(root); }
});

// ── 노트 계획·작성(plan/write, lecture-note-2) ──
const NoteContract = require("../lib/note-contract.js"), Prompts = require("./prompts.js");
const Boilerplate = require("../lib/boilerplate.js"), Preprocess = require("../lib/preprocess.js");
const noteInput = require("../tools/note-fixture/input.json"), notePlanner = require("../tools/note-fixture/planner-output.json"), noteWriter = require("../tools/note-fixture/writer-outputs.json");
// 정제 단계와 같은 순서로 IR 을 만들고 모델 계획을 정규화한다 — 요청용 Plan 은 검증된 fixture 다(lib/note-fixture.test.js 와 같은 경로).
const noteIR = Preprocess.buildIR(Boilerplate.detect(noteInput.slides).slides, noteInput.transcript.segments);
const notePlan = (() => { const n = NoteContract.normalizePlan(notePlanner, { units: noteIR.units, formulaUnits: noteInput.formulaUnits, figures: noteInput.figures }); if (!n.ok) throw new Error(JSON.stringify(n.errors)); return n.plan; })();
const noteS1 = notePlan.sections.find(s => s.sectionId === "S1"); // B05·B05·B12 → S1_B1..S1_B3
const noteOpts = { syntheticExamples: false, externalAugmentation: false };
// 요청 칸은 노트 저장 모양이 아니라 계약 모양이다 — 수식·도표는 id·상태·칸만 남긴다.
const noteFormulas = noteInput.registry.map(f => ({ id: f.id, status: f.status, unitIds: noteInput.formulaUnits[f.id] || [] }));
const notePlanFigures = noteInput.figures.map(f => ({ id: f.id, unitId: f.unitId, kind: f.kind, title: f.title ?? null }));
const noteRegistry = noteInput.registry.map(f => ({ id: f.id, latex: f.latex ?? null, status: f.status }));
const noteFigures = noteInput.figures.map(f => ({ id: f.id, kind: f.kind, title: f.title ?? null, cells: f.cells ?? null }));
const s1Evidence = noteIR.evidence.filter(e => e.unitId === "U1");
const writerRest = { section: noteS1, concepts: notePlan.concepts, evidence: s1Evidence, registry: noteRegistry, figures: noteFigures, options: noteOpts };
const noteSpecVersion = NoteContract.NOTE_SPEC_VERSION;
// 크기·모양 검사용 임의 유닛 — 요청 계약(contracts.js 의 unit)만 맞추면 된다.
const noteUnit = (id, t0 = 0, text = "합성 슬라이드 글 " + id) => ({
  schemaVersion: 1, unitId: id, slideId: "s-" + id, t0, t1: t0 + 30, slideText: text, speech: "합성 발화 " + id,
  features: { dwell: 30, speechChars: 12, emphasis: 0, deixis: 0, repeat: 0, hasFormula: true, hasFigure: false },
  judge: { importance: null, lectureProb: null },
});
const planIn = o => ({ model, requestId: "plan-x", noteSpecVersion, ir: { units: noteIR.units }, formulas: noteFormulas, figures: notePlanFigures, recognition: "local", options: { ...noteOpts }, ...o });
const sectionIn = o => ({ model, requestId: "write-x", noteSpecVersion, stage: "section", ...writerRest, withGist: true, ...o });
// plan/write 라우트의 digest 와 같은 직렬화 — 라우트가 스키마 순서로 키를 다시 놓는 것과 동일하게 만든다.
const input = sectionIn({ requestId: "request-one" });
const noteDigest = body => JSON.stringify({ route: body.stage === "plan" ? "plan" : "write", stage: body.stage, model: body.model, noteSpecVersion: body.noteSpecVersion, rest: Object.fromEntries(Object.keys(Prompts.REQUEST[body.stage].properties).map(k => [k, body[k]])) });
const globalIn = o => ({ model, requestId: "write-g", noteSpecVersion, stage: "global",
  plan: { concepts: notePlan.concepts, global: notePlan.global },
  sections: [{ sectionId: "S1", title: noteS1.title, gist: noteWriter.sections.S1.first.gist, blocks: noteS1.blocks.map(b => ({ blockId: b.blockId, type: b.type, claims: [] })) }],
  options: { ...noteOpts }, ...o });
const repairIn = o => ({ model, requestId: "write-r", noteSpecVersion, stage: "repair", ...writerRest,
  repair: [{ blockId: "S1_B3", previous: noteWriter.sections.S1.first.blocks.S1_B3, errors: [{ code: "VAL_EVIDENCE_MISSING", detail: ["/content/note"] }] }], ...o });
// 출력 스키마가 요청 계획의 blockId 를 요구하므로 제공자는 fixture 의 유효 출력을 그대로 돌려준다.
const s1Out = noteWriter.sections.S1.first, globalOut = noteWriter.global, repairOut = { blocks: { S1_B3: noteWriter.sections.S1.first.blocks.S1_B3 } };
const noteReply = (content, o = {}) => ({ ok: true, json: async () => ({ choices: [{ finish_reason: o.finish || "stop", message: { content: typeof content === "string" ? content : JSON.stringify(content) } }], usage: { prompt_tokens: 800, completion_tokens: 90, cost: Object.hasOwn(o, "cost") ? o.cost : .002 } }) });
const near = (a, b, label) => assert.ok(Math.abs(a - b) < 1e-9, label + ": " + a + " != " + b);
const withNoteServer = async (fetcher, run, extra = {}) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "summrizei-service-test-"));
  const server = createServer({ ...config(root), ...extra }, { fetch: fetcher });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  try { await run("http://127.0.0.1:" + server.address().port, root); } finally { await close(server); removeTemp(root); }
};
const errorOf = async (res, status, code) => {
  assert.equal(res.status, status, code);
  const body = await res.json();
  assert.ok(Contracts.validate(Contracts.SCHEMAS.errorEnvelope, body).ok, "오류 봉투 계약: " + code);
  assert.equal(body.error.code, code);
  return body.error;
};

test("plan reads units through strict json_schema, allows the free tier and carries versions", async () => {
  const bodies = [];
  await withNoteServer(async (_u, o) => { bodies.push(JSON.parse(o.body)); return noteReply(notePlanner); }, async url => {
    // tokenB 는 한도 설정이 없는 계정(Free 상당)이다 — plan 은 등급 기능 검사 없이 기존 계정 한도만 적용한다.
    const res = await req(url, "/v1/plan", "POST", planIn(), tokenB);
    assert.equal(res.status, 200);
    const out = await res.json();
    assert.deepEqual(out.plan, notePlanner);
    assert.ok(Contracts.validate(NoteContract.schemas.plannerOutput, out.plan).ok);
    assert.equal(out.promptVersion, Prompts.PROMPT_VERSION);
    assert.equal(out.schemaVersion, Contracts.CONTRACT_VERSION);
    assert.equal(out.noteSpecVersion, NoteContract.NOTE_SPEC_VERSION);
    assert.deepEqual(out.usage, { promptTokens: 800, completionTokens: 90, costUsd: .002 });
    const sent = bodies[0];
    assert.equal(sent.model, model);
    assert.equal(sent.temperature, 0);
    assert.equal(typeof sent.seed, "number", "seed 를 지원하는 모델에는 seed 를 보낸다");
    assert.equal(sent.max_tokens, Prompts.LIMITS.tokens.plannerOutput, "출력 상한은 계약의 예산이다");
    assert.deepEqual(sent.provider, { only: ["test-provider"], order: ["test-provider"], require_parameters: true, allow_fallbacks: false, zdr: true, data_collection: "deny" });
    assert.equal(sent.response_format.type, "json_schema");
    assert.equal(sent.response_format.json_schema.strict, true);
    const schemaText = JSON.stringify(sent.response_format.json_schema.schema);
    assert.ok(Contracts.isStrictCompatible(sent.response_format.json_schema.schema));
    assert.ok(!/maxLength|maxItems|minItems|pattern/.test(schemaText), "제공자 스키마에 검증 전용 키워드가 남아 있다");
    // 변하지 않는 시스템 본문이 앞, 변하는 입력이 뒤다. 모델 입력에 요청 봉투(model·requestId·버전)는 없다.
    assert.deepEqual(sent.messages.map(m => m.role), ["system", "user"]);
    assert.equal(sent.messages[0].content, Prompts.systemFor("plan", planIn().options));
    const { model: _m, requestId: _r, noteSpecVersion: _v, ...rest } = planIn();
    assert.deepEqual(JSON.parse(sent.messages[1].content), rest);
  });
});

test("write answers each stage with the plan-keyed output schema and the stage's own system prompt", async () => {
  const bodies = [];
  const cases = [
    ["section", sectionIn(), s1Out],
    ["global", globalIn(), globalOut],
    ["repair", repairIn(), repairOut],
  ];
  let next = null;
  await withNoteServer(async (_u, o) => { bodies.push(JSON.parse(o.body)); return noteReply(next); }, async url => {
    for (const [stage, body, output] of cases) {
      next = output;
      const res = await req(url, "/v1/write", "POST", body, tokenB);
      assert.equal(res.status, 200, stage);
      const out = await res.json();
      assert.deepEqual(out.output, output, stage);
      const { model: _m, requestId: _r, noteSpecVersion: _v, stage: _s, ...rest } = body;
      assert.ok(Contracts.validate(Prompts.outputSchema(stage, rest), out.output).ok, stage);
      assert.equal(out.promptVersion, Prompts.PROMPT_VERSION);
      assert.equal(out.schemaVersion, Contracts.CONTRACT_VERSION);
      assert.equal(out.noteSpecVersion, NoteContract.NOTE_SPEC_VERSION);
      assert.equal(out.usage.costUsd, .002);
      const sent = bodies.at(-1);
      assert.equal(sent.messages[0].content, Prompts.systemFor(stage, rest.options), stage + " 시스템 프롬프트");
      assert.equal(sent.max_tokens, stage === "global" ? Prompts.LIMITS.tokens.globalOutput : Prompts.LIMITS.tokens.writerOutput);
      assert.equal(sent.temperature, 0);
      assert.equal(sent.response_format.json_schema.name, "lecture_note_" + stage);
      assert.deepEqual(JSON.parse(sent.messages[1].content), rest, stage + " 모델 입력");
      // 제공자에 내리는 스키마의 blocks 키는 요청 계획의 blockId 다.
      const want = stage === "global" ? rest.plan.global.map(g => g.blockId) : stage === "repair" ? rest.repair.map(r => r.blockId) : rest.section.blocks.map(b => b.blockId);
      assert.deepEqual(Object.keys(sent.response_format.json_schema.schema.properties.blocks.properties), want, stage + " 스키마 블록 키");
    }
    assert.notEqual(Prompts.systemFor("section"), Prompts.systemFor("global"));
    assert.equal(bodies.length, 3);
  });
});

test("plan and write retry a schema-invalid or unfinished output once on the same model", async () => {
  const replies = [];
  let calls = 0;
  await withNoteServer(async () => { calls++; return replies.shift(); }, async url => {
    replies.push(noteReply({ concepts: [], sections: [], global: [] }, { cost: .001 }), noteReply(notePlanner, { cost: .002 }));
    const plan = await req(url, "/v1/plan", "POST", planIn({ requestId: "retry-plan" }));
    assert.equal(plan.status, 200);
    const planBody = await plan.json();
    assert.deepEqual(planBody.plan, notePlanner);
    assert.equal(calls, 2);
    assert.equal(planBody.usage.costUsd, .003, "두 번 나간 비용이 모두 청구된다");
    assert.equal(planBody.usage.promptTokens, 1600);

    calls = 0;
    replies.push(noteReply({ gist: null, blocks: {}, checks: [] }), noteReply(s1Out));
    assert.equal((await req(url, "/v1/write", "POST", sectionIn({ requestId: "retry-sec" }))).status, 200);
    assert.equal(calls, 2);

    calls = 0;
    replies.push(noteReply(globalOut, { finish: "content_filter" }), noteReply(globalOut));
    assert.equal((await req(url, "/v1/write", "POST", globalIn({ requestId: "retry-glob" }))).status, 200, "stop 이 아닌 종료는 형식 실패로 한 번 재시도한다");
    assert.equal(calls, 2);

    calls = 0;
    replies.push(noteReply("not json"), noteReply({ blocks: "x" }));
    const failed = await req(url, "/v1/write", "POST", sectionIn({ requestId: "retry-twice" }));
    assert.equal((await errorOf(failed, 502, "provider_failed_or_invalid_output")).retryable, true);
    assert.equal(calls, 2, "두 번째 실패 뒤에는 더 시도하지 않는다");
  });
});

test("a length cut-off is not retried, answers llm_output_truncated and charges the reported cost", async () => {
  const replies = [];
  let calls = 0;
  await withNoteServer(async () => { calls++; return replies.shift(); }, async (url, root) => {
    const ledger = () => readState(path.join(root, "usage.json")).accounts.A;
    for (const [route, body, label] of [["/v1/plan", planIn({ requestId: "cut-plan" }), "plan"], ["/v1/write", sectionIn({ requestId: "cut-write" }), "write"]]) {
      calls = 0;
      replies.push(noteReply('{"blocks":[{"type":"te', { finish: "length", cost: .003 }));
      const before = ledger()?.spentCents || 0;
      const err = await errorOf(await req(url, route, "POST", body), 422, "llm_output_truncated");
      assert.equal(err.retryable, false, label);
      assert.equal(calls, 1, label + ": 한도를 키워 재시도하지 않는다");
      near(ledger().spentCents - before, settle(.003), label + ": 예약이 아니라 제공자가 보고한 금액만 청구한다");
      assert.equal(ledger().jobs[body.requestId].status, "completed");
      // 환불이 아니다: 같은 requestId 는 다시 못 쓰고 요청 수도 되돌아가지 않는다. 클라이언트는 섹션을 나눠 새 requestId 로 보낸다.
      await errorOf(await req(url, route, "POST", body), 409, "request_already_reserved_or_processed");
      assert.equal(calls, 1);
    }
    assert.equal(ledger().requests, 2);

    // 형식 실패 뒤에 잘려도 두 호출의 보고 비용이 모두 청구된다.
    const before = ledger().spentCents;
    replies.push(noteReply("{}", { cost: .001 }), noteReply('{"blocks":[', { finish: "length", cost: .003 }));
    await errorOf(await req(url, "/v1/write", "POST", sectionIn({ requestId: "cut-after-retry" })), 422, "llm_output_truncated");
    near(ledger().spentCents - before, settle(.001 + .003), "두 호출의 보고 비용");

    // 비용을 보고하지 않은 잘림은 모르는 비용이라 예약을 그대로 둔다.
    replies.push(noteReply('{"blocks":[', { finish: "length", cost: null }));
    const spent = ledger().spentCents;
    await errorOf(await req(url, "/v1/write", "POST", sectionIn({ requestId: "cut-unreported" })), 422, "llm_output_truncated");
    const job = ledger().jobs["cut-unreported"];
    assert.equal(job.status, "uncertain");
    assert.ok(job.reservedCents > 0);
    near(ledger().spentCents - spent, job.reservedCents, "예약 전액이 남는다");
  });
});

test("a request with another noteSpecVersion is refused before anything is reserved", async () => {
  let calls = 0;
  await withNoteServer(async () => { calls++; return noteReply(notePlanner); }, async url => {
    for (const [route, body] of [["/v1/plan", planIn({ noteSpecVersion: "v9" })], ["/v1/write", sectionIn({ noteSpecVersion: "v9" })], ["/v1/write", globalIn({ noteSpecVersion: 3 })]]) {
      const err = await errorOf(await req(url, route, "POST", body), 409, "note_spec_mismatch");
      assert.equal(err.retryable, false);
    }
    // 다른 양식은 본문 모양도 다를 수 있다 — 모양 검사보다 버전 검사가 먼저다.
    await errorOf(await req(url, "/v1/plan", "POST", planIn({ noteSpecVersion: "v9", ir: { units: "new-format" } })), 409, "note_spec_mismatch");
    assert.equal(calls, 0);
    const me = await (await req(url, "/v1/me")).json();
    assert.equal(me.quota.requests, 0, "거절된 요청은 예약을 만들지 않는다");
    assert.equal(me.quota.spentCents, 0);
    // 버전을 아예 빼면 필수 필드 누락이다.
    const { noteSpecVersion: _v, ...noVersion } = planIn();
    await errorOf(await req(url, "/v1/plan", "POST", noVersion), 400, "unexpected_field");
  });
});

test("plan and write reject unknown, missing and mismatched fields without calling the provider", async () => {
  let calls = 0;
  await withNoteServer(async () => { calls++; return noteReply(notePlanner); }, async url => {
    const expectCode = async (route, body, status, code, label) => { await errorOf(await req(url, route, "POST", body), status, code); assert.equal(calls, 0, label); };
    await expectCode("/v1/plan", planIn({ extra: 1 }), 400, "unexpected_field", "plan 최상위 추가 필드");
    await expectCode("/v1/plan", planIn({ stage: "plan" }), 400, "unexpected_field", "plan 에는 stage 가 없다");
    await expectCode("/v1/plan", { ...planIn(), ir: { units: planIn().ir.units, extra: 1 } }, 400, "unexpected_field", "ir 안의 추가 필드");
    await expectCode("/v1/plan", planIn({ ir: { units: [{ ...noteUnit("U1"), secret: "x" }] } }), 400, "unexpected_field", "유닛 안의 추가 필드");
    const { formulas: _f, ...noFormulas } = planIn();
    await expectCode("/v1/plan", noFormulas, 400, "unexpected_field", "필드 누락");
    await expectCode("/v1/plan", planIn({ model: "nope/model" }), 400, "invalid_model", "plan 모델");
    await expectCode("/v1/plan", planIn({ requestId: "../x" }), 400, "request_rejected", "requestId");
    await expectCode("/v1/plan", planIn({ ir: { units: [] } }), 400, "request_rejected", "빈 유닛");
    await expectCode("/v1/plan", planIn({ ir: { units: [{ ...noteUnit("U1"), t0: "0" }] } }), 400, "request_rejected", "유닛 계약 위반");
    await expectCode("/v1/plan", planIn({ formulas: [{ id: "f1", status: "verified", unitIds: [] }] }), 400, "request_rejected", "수식 id 형식");
    await expectCode("/v1/plan", planIn({ formulas: [{ id: "F1", status: "maybe", unitIds: [] }] }), 400, "request_rejected", "수식 상태");
    await expectCode("/v1/plan", planIn({ recognition: "device" }), 400, "request_rejected", "인식 출처");

    await expectCode("/v1/write", sectionIn({ stage: "plan" }), 400, "invalid_model_or_stage", "write 에 plan 단계");
    await expectCode("/v1/write", sectionIn({ stage: undefined }), 400, "invalid_model_or_stage", "stage 누락");
    await expectCode("/v1/write", sectionIn({ model: "nope/model" }), 400, "invalid_model_or_stage", "write 모델");
    await expectCode("/v1/write", sectionIn({ repair: repairIn().repair }), 400, "unexpected_field", "section 에 repair 필드");
    await expectCode("/v1/write", sectionIn({ withGist: undefined }), 400, "unexpected_field", "section 에 withGist 누락");
    await expectCode("/v1/write", globalIn({ evidence: s1Evidence }), 400, "unexpected_field", "global 에 evidence 필드");
    await expectCode("/v1/write", repairIn({ extra: 1 }), 400, "unexpected_field", "repair 최상위 추가 필드");
    await expectCode("/v1/write", sectionIn({ section: { ...noteS1, extra: 1 } }), 400, "unexpected_field", "계획 섹션의 추가 필드");
    await expectCode("/v1/write", sectionIn({ registry: [{ id: "F1", latex: "x", status: "verified", note: "y" }] }), 400, "unexpected_field", "등록부의 추가 필드");
    await expectCode("/v1/write", sectionIn({ evidence: [] }), 400, "request_rejected", "빈 근거");
    await expectCode("/v1/write", sectionIn({ section: { ...noteS1, blocks: [{ ...noteS1.blocks[0], type: "B01" }] } }), 400, "request_rejected", "Writer 가 아닌 블록 종류");
    await expectCode("/v1/write", sectionIn({ section: { ...noteS1, blocks: [{ ...noteS1.blocks[0], blockId: "S1-B1" }] } }), 400, "request_rejected", "blockId 형식");
    await expectCode("/v1/write", sectionIn({ registry: [{ id: "F1", latex: undefined, status: "verified" }] }), 400, "request_rejected", "latex 누락");
    await expectCode("/v1/write", sectionIn({ withGist: "yes" }), 400, "request_rejected", "withGist 타입");
    await expectCode("/v1/write", repairIn({ repair: [] }), 400, "request_rejected", "repair 비어 있음");
    await expectCode("/v1/write", repairIn({ repair: [{ blockId: "S1_B3", previous: null, errors: [] }] }), 400, "request_rejected", "오류 목록 없음");
    await expectCode("/v1/write", repairIn({ repair: [{ blockId: "S1_B3", previous: null, errors: [{ code: "lowercase", detail: [] }] }] }), 400, "request_rejected", "오류 코드 형식");
    // 스키마는 통과하지만 계획에 없는 blockId 는 출력 스키마를 만들다 거절된다.
    await expectCode("/v1/write", repairIn({ repair: [{ blockId: "S1_B9", previous: null, errors: [{ code: "VAL_SCHEMA", detail: [] }] }] }), 400, "request_rejected", "계획에 없는 블록 id");
    await expectCode("/v1/write", globalIn({ sections: [] }), 400, "request_rejected", "빈 섹션 목록");
  });
});

test("plan and write enforce body size and the stage's input token budget", async () => {
  let calls = 0;
  await withNoteServer(async () => { calls++; return noteReply(s1Out); }, async url => {
    const kor = n => "가".repeat(n);
    const ev = (id, text) => ({ id, unitId: "U1", kind: "slide", t0: 0, t1: 1, slideId: "sl", sourceId: "b", role: null, text });
    // 본문 상한: plan 512 KiB, write 256 KiB.
    await errorOf(await req(url, "/v1/plan", "POST", planIn({ ir: { units: [noteUnit("U1", 0, kor(40000)), noteUnit("U2", 30, kor(40000)), noteUnit("U3", 60, kor(40000)), noteUnit("U4", 90, kor(40000)), noteUnit("U5", 120, kor(40000))] } })), 413, "request_too_large");
    await errorOf(await req(url, "/v1/write", "POST", sectionIn({ evidence: Array.from({ length: 70 }, (_, i) => ev("U1.s" + (i + 1), kor(3900))) })), 413, "request_too_large");
    assert.equal(calls, 0);
    // 본문 상한 안이어도 입력 토큰 예산(writer 16k, planner 40k)을 넘으면 거절한다. 한국어 3바이트/글자, 근거 한 항목은 4000자까지.
    const writeBody = sectionIn({ evidence: Array.from({ length: 6 }, (_, i) => ev("U1.s" + (i + 1), kor(4000))) });
    assert.ok(Buffer.byteLength(JSON.stringify(writeBody)) < 256 * 1024, "본문 상한 안이어야 예산 검사를 확인한다");
    await errorOf(await req(url, "/v1/write", "POST", writeBody), 413, "request_too_large");
    const planBody = planIn({ ir: { units: [noteUnit("U1", 0, kor(14000)), noteUnit("U2", 30, kor(14000)), noteUnit("U3", 60, kor(14000)), noteUnit("U4", 90, kor(14000))] } });
    assert.ok(Buffer.byteLength(JSON.stringify(planBody)) < 512 * 1024);
    await errorOf(await req(url, "/v1/plan", "POST", planBody), 413, "request_too_large");
    assert.equal(calls, 0);
    // 예산 안이면 통과한다.
    assert.equal((await req(url, "/v1/write", "POST", sectionIn({ requestId: "fits" }))).status, 200);
    assert.equal(calls, 1);
  });
});

test("repair output must carry exactly the requested blockIds", async () => {
  const replies = [];
  let calls = 0;
  await withNoteServer(async () => { calls++; return replies.shift(); }, async url => {
    // 요청한 S1_B3 이 아닌 키가 오면 스키마 불일치다 — 형식 실패로 한 번 재시도한다.
    replies.push(noteReply({ blocks: { S1_B1: repairOut.blocks.S1_B3 } }), noteReply({ blocks: {} }));
    await errorOf(await req(url, "/v1/write", "POST", repairIn({ requestId: "repair-bad" })), 502, "provider_failed_or_invalid_output");
    assert.equal(calls, 2);
    calls = 0;
    replies.push(noteReply(repairOut));
    const ok = await req(url, "/v1/write", "POST", repairIn({ requestId: "repair-fixed" }));
    assert.equal(ok.status, 200);
    assert.deepEqual(Object.keys((await ok.json()).output.blocks), ["S1_B3"]);
    assert.equal(calls, 1);
    // 개수가 아니라 키가 문제다 — 여러 블록을 고치면 그 키를 모두 돌려줘야 한다.
    calls = 0;
    const two = { blocks: { S1_B1: s1Out.blocks.S1_B1, S1_B2: s1Out.blocks.S1_B2 } };
    replies.push(noteReply(two));
    const many = await req(url, "/v1/write", "POST", repairIn({ requestId: "repair-two", repair: [
      { blockId: "S1_B1", previous: null, errors: [{ code: "VAL_SCHEMA", detail: [] }] },
      { blockId: "S1_B2", previous: null, errors: [{ code: "VAL_SCHEMA", detail: [] }] },
    ] }));
    assert.equal(many.status, 200);
    assert.deepEqual(Object.keys((await many.json()).output.blocks), ["S1_B1", "S1_B2"]);
    assert.equal(calls, 1);
  });
});

test("plan and write are idempotent per requestId and keep lecture text out of the ledger", async () => {
  let calls = 0;
  await withNoteServer(async () => { calls++; return noteReply(s1Out); }, async (url, root) => {
    const body = sectionIn({ requestId: "idem-one" });
    assert.equal((await req(url, "/v1/write", "POST", body)).status, 200);
    await errorOf(await req(url, "/v1/write", "POST", body), 409, "request_already_reserved_or_processed");
    assert.equal(calls, 1, "중복은 제공자를 다시 부르지 않는다");
    // 키 순서가 달라도 본문은 같다 — digest 는 스키마 순서로 만든다.
    const { evidence, registry, ...head } = body;
    await errorOf(await req(url, "/v1/write", "POST", { ...head, registry, evidence }), 409, "request_already_reserved_or_processed");
    await errorOf(await req(url, "/v1/write", "POST", sectionIn({ requestId: "idem-one", evidence: [{ ...s1Evidence[0], text: "다른 내용" }] })), 400, "idempotency_content_mismatch");
    // 같은 requestId 로 다른 라우트를 불러도 본문이 달라 같은 요청이 아니다.
    await errorOf(await req(url, "/v1/plan", "POST", planIn({ requestId: "idem-one" })), 400, "idempotency_content_mismatch");
    // 같은 requestId 가 동시에 두 번 와도 제공자 호출은 한 번이다.
    const concurrent = await Promise.all([req(url, "/v1/write", "POST", sectionIn({ requestId: "idem-two" })), req(url, "/v1/write", "POST", sectionIn({ requestId: "idem-two" }))]);
    assert.deepEqual(concurrent.map(r => r.status).sort(), [200, 409]);
    assert.equal(calls, 2);
    const ledger = fs.readFileSync(path.join(root, "usage.json"), "utf8");
    for (const secret of ["고정비", "손익분기", "공헌이익", "합성 슬라이드 글"])
      assert.ok(!ledger.includes(secret), "원장에 강의 내용이 남는다: " + secret);
  });
});

test("plan and write follow the account's model list and monthly cost cap", async () => {
  const expensive = "anthropic/claude-haiku-4.5";
  let calls = 0;
  const extra = {
    ALLOWED_MODELS: JSON.stringify([model, expensive]),
    OPENROUTER_PROVIDERS_JSON: JSON.stringify({ [model]: ["test-provider"], [expensive]: ["test-provider"] }),
    ACCOUNT_LIMITS_JSON: JSON.stringify({ A: { models: [model], maxRequests: 10, maxCostCents: 0.01 } }),
  };
  await withNoteServer(async () => { calls++; return noteReply(notePlanner); }, async url => {
    await errorOf(await req(url, "/v1/plan", "POST", planIn({ model: expensive })), 403, "model_not_in_account_plan");
    await errorOf(await req(url, "/v1/write", "POST", sectionIn({ model: expensive })), 403, "model_not_in_account_plan");
    // 예약이 월 한도를 넘으면 지출 전에 거절한다.
    await errorOf(await req(url, "/v1/plan", "POST", planIn()), 429, "quota_exceeded");
    assert.equal(calls, 0);
    assert.equal((await req(url, "/v1/plan", "POST", planIn({ requestId: "other-account" }), tokenB)).status, 200, "한도 설정이 없는 계정은 기본 한도를 따른다");
  }, extra);
});

test("write sends the cache breakpoint only to caching models and seed only where supported", async () => {
  const claude = "anthropic/claude-haiku-4.5";
  const bodies = [];
  const extra = { ALLOWED_MODELS: JSON.stringify([model, claude]), OPENROUTER_PROVIDERS_JSON: JSON.stringify({ [model]: ["provider-a"], [claude]: ["provider-b"] }) };
  await withNoteServer(async (_u, o) => { bodies.push(JSON.parse(o.body)); return noteReply(s1Out); }, async url => {
    assert.equal((await req(url, "/v1/write", "POST", sectionIn({ requestId: "cache-g" }))).status, 200);
    assert.equal((await req(url, "/v1/write", "POST", sectionIn({ requestId: "cache-c", model: claude }))).status, 200);
    const [gemini, anthropic] = bodies;
    assert.equal(typeof gemini.messages[0].content, "string");
    assert.equal(typeof gemini.seed, "number");
    assert.deepEqual(anthropic.messages[0].content, [{ type: "text", text: Prompts.systemFor("section", noteOpts), cache_control: { type: "ephemeral" } }], "Anthropic 요청에 캐시 중단점이 없다");
    assert.equal(anthropic.messages[1].role, "user", "변하는 입력은 캐시 중단점 뒤에 온다");
    assert.equal(anthropic.seed, undefined, "seed 를 지원하지 않는 모델에 보내면 제공자가 요청을 거절한다");
    assert.equal(anthropic.temperature, 0);
    assert.deepEqual(anthropic.provider.only, ["provider-b"]);
  }, extra);
});

test("ServiceClient.plan and write from an older extension are refused as unexpected_field", async () => {
  const ServiceClient = require("../lib/service-client.js");
  let calls = 0;
  await withNoteServer(async () => { calls++; return noteReply(notePlanner); }, async url => {
    // 옛 클라이언트는 새 계약의 필수 필드(figures·options·concepts …)를 모른다 — 라우트가 예약 전에 400 으로 닫는다.
    const fail = async call => { try { await call(); } catch (e) { return e; } assert.fail("오류가 나야 한다"); };
    const planErr = await fail(() => ServiceClient.plan({ baseUrl: url, token, model, requestId: "cli-plan", noteSpecVersion, ir: planIn().ir, formulas: planIn().formulas }));
    assert.equal(planErr.code, "unexpected_field");
    assert.equal(planErr.retryable, false);
    const writeErr = await fail(() => ServiceClient.write({ baseUrl: url, token, model, requestId: "cli-sec", noteSpecVersion, stage: "section", section: noteS1 }));
    assert.equal(writeErr.code, "unexpected_field");
    assert.equal(calls, 0, "거절된 요청은 제공자에 닿지 않는다");
  });
});

test("the note contract is one slot: swapping lib/note-contract.js changes output validation and version without touching the routes", async () => {
  const [contractPath, promptsPath, indexPath] = ["../lib/note-contract.js", "./prompts.js", "./index.js"].map(k => require.resolve(k));
  const saved = { contract: require.cache[contractPath].exports, prompts: require.cache[promptsPath], index: require.cache[indexPath] };
  // alt 양식: 섹션 출력이 문자열 블록이다 — 요청 계약은 그대로 두고 출력 슬롯과 버전만 바꾼다. 펼쳐 쓰는 건 얼린 원본의 읽기 전용 프로토타입 슬롯을 피하기 위해서다.
  const alt = { ...NoteContract, NOTE_SPEC_VERSION: "alt-1", sectionOutputSchemaFor: section => ({
    type: "object", additionalProperties: false, required: ["blocks"],
    properties: { blocks: { type: "object", additionalProperties: false, required: section.blocks.map(b => b.blockId), properties: Object.fromEntries(section.blocks.map(b => [b.blockId, { type: "string" }])) } },
  }) };
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "summrizei-service-test-"));
  const replies = [];
  let server;
  try {
    require.cache[contractPath].exports = alt;
    delete require.cache[promptsPath]; delete require.cache[indexPath];
    server = require("./index.js").createServer(config(root), { fetch: async () => replies.shift() });
    await new Promise(r => server.listen(0, "127.0.0.1", r));
    const url = "http://127.0.0.1:" + server.address().port;
    replies.push(noteReply({ blocks: { S1_B1: "새 양식", S1_B2: "블록", S1_B3: "출력" } }));
    const ok = await req(url, "/v1/write", "POST", sectionIn({ requestId: "alt-ok", noteSpecVersion: "alt-1" }));
    assert.equal(ok.status, 200);
    const out = await ok.json();
    assert.deepEqual(out.output, { blocks: { S1_B1: "새 양식", S1_B2: "블록", S1_B3: "출력" } });
    assert.equal(out.noteSpecVersion, "alt-1");
    replies.push(noteReply({ blocks: { S1_B1: 1, S1_B2: "x", S1_B3: "y" } }), noteReply({ blocks: { S1_B1: "x", S1_B2: "y" } }));
    await errorOf(await req(url, "/v1/write", "POST", sectionIn({ requestId: "alt-old", noteSpecVersion: "alt-1" })), 502, "provider_failed_or_invalid_output");
    await errorOf(await req(url, "/v1/write", "POST", sectionIn({ requestId: "alt-stale", noteSpecVersion })), 409, "note_spec_mismatch");
  } finally {
    if (server) await close(server);
    require.cache[contractPath].exports = saved.contract; require.cache[promptsPath] = saved.prompts; require.cache[indexPath] = saved.index;
    removeTemp(root);
  }
});

test("generation options need the augment feature: denied before anything is reserved", async () => {
  const bodies = [];
  let calls = 0;
  const aug = { syntheticExamples: true, externalAugmentation: false };
  const extra = { ACCOUNT_LIMITS_JSON: JSON.stringify({ A: { models: [model], maxRequests: 10, maxCostCents: 100, features: ["augment"] } }) };
  await withNoteServer(async (_u, o) => { bodies.push(JSON.parse(o.body)); calls++; return noteReply(s1Out); }, async url => {
    // tokenB 는 기능이 없다 — 옵션을 켠 요청은 예약·제공자 호출 전에 거절된다.
    await errorOf(await req(url, "/v1/write", "POST", sectionIn({ options: aug }), tokenB), 403, "feature_not_in_account_plan");
    await errorOf(await req(url, "/v1/plan", "POST", planIn({ options: aug }), tokenB), 403, "feature_not_in_account_plan");
    assert.equal(calls, 0);
    const free = await (await req(url, "/v1/me", "GET", undefined, tokenB)).json();
    assert.equal(free.quota.requests, 0, "기능 거절은 예약을 만들지 않는다");
    assert.equal(free.quota.spentCents, 0);
    // augment 기능이 있는 계정은 옵션을 켤 수 있고, 켠 옵션의 basis 가 제공자 스키마에 남는다.
    assert.equal((await req(url, "/v1/write", "POST", sectionIn({ options: aug }), token)).status, 200);
    assert.equal(calls, 1);
    assert.ok(JSON.stringify(bodies[0].response_format.json_schema.schema).includes('"synthetic"'), "켠 옵션의 basis 가 스키마에 있다");
  }, extra);
  // 전역 플래그로 augment 를 끄면 기능이 있는 계정도 막힌다.
  await withNoteServer(async () => { calls++; return noteReply(s1Out); }, async url => {
    await errorOf(await req(url, "/v1/write", "POST", sectionIn({ options: aug }), token), 403, "feature_not_in_account_plan");
  }, { ...extra, FEATURE_FLAGS_JSON: JSON.stringify({ augment: false }) });
});

test("/v1/plan reserves the lecture span as monthly minutes unless cloud recognition already counted it", async () => {
  // 파일 장부는 분을 기록하지 않는다(fileUsage.reserve 가 무시한다) — p_minutes 는 Postgres 예약에만 보인다.
  await withSupabase(async ({ url, sb }) => {
    sb.other = async () => noteReply(notePlanner);
    // fixture 유닛 구간은 0~1260초다 — ceil((1260-0)/60) = 21분.
    assert.equal((await req(url, "/v1/plan", "POST", planIn({ requestId: "min-local" }), ec1())).status, 200);
    assert.equal(sb.rpcNamed("reserve_usage").at(-1).args.p_minutes, 21, "로컬 인식은 STT 를 거치지 않으므로 계획 요청이 길이를 센다");
    // 클라우드 인식은 STT 가 이미 셌다 — 계획 요청은 분을 다시 세지 않는다.
    assert.equal((await req(url, "/v1/plan", "POST", planIn({ requestId: "min-cloud", recognition: "cloud" }), ec1())).status, 200);
    assert.equal(sb.rpcNamed("reserve_usage").at(-1).args.p_minutes, 0);
    // STT 기능이 없는 등급은 신고와 무관하게 센다 — 클라이언트 선언을 믿지 않는다.
    sb.plan = "free";
    assert.equal((await req(url, "/v1/plan", "POST", planIn({ requestId: "min-free", recognition: "cloud" }), ec1({ claims: { sub: UID2 } }))).status, 200);
    assert.equal(sb.rpcNamed("reserve_usage").at(-1).args.p_minutes, 21);
  }, { setup: sb => { sb.plan = "essential"; } });
});

// ── Supabase 인증·장부 (docs/architecture-v2.md §11, supabase/schema-v2.sql) ──
// 키는 테스트 안에서 만든다. Supabase는 가짜 fetch 하나가 JWKS 엔드포인트와 PostgREST RPC·테이블을 흉내 낸다(OpenRouter 호출은 sb.other 로 넘긴다).
const SB = "https://proj.supabase.co", SERVICE_KEY = "service-role-key-".padEnd(40, "s"), DIGEST_KEY = "usage-digest-key-".padEnd(40, "d"), JWT_SECRET = "jwt-secret-".padEnd(40, "j");
const UID = "7b1f3c52-0a4e-4d19-9c8e-5e2a6f1d3b70", UID2 = "0d9c4a1e-2b7f-4e55-8a31-9f6c7d2e1b44";
const EC1 = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" }), EC2 = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" }), RSA1 = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwkOf = (pair, kid) => ({ ...pair.publicKey.export({ format: "jwk" }), kid, use: "sig", alg: pair.publicKey.asymmetricKeyType === "ec" ? "ES256" : "RS256" });
const b64u = x => Buffer.from(typeof x === "string" || Buffer.isBuffer(x) ? x : JSON.stringify(x)).toString("base64url");
function mint({ alg = "ES256", kid = "ec-1", pair = EC1, secret = JWT_SECRET, claims = {}, header = {}, now = Math.floor(Date.now() / 1000) } = {}) {
  const p = { sub: UID, aud: "authenticated", role: "authenticated", iss: SB + "/auth/v1", iat: now, exp: now + 3600, ...claims };
  for (const k of Object.keys(p)) if (p[k] === undefined) delete p[k];
  const data = b64u({ alg, typ: "JWT", ...(kid === null ? {} : { kid }), ...header }) + "." + b64u(p);
  const sig = alg === "HS256" ? crypto.createHmac("sha256", secret).update(data).digest()
    : alg === "ES256" ? crypto.sign("sha256", Buffer.from(data), { key: pair.privateKey, dsaEncoding: "ieee-p1363" })
    : alg === "RS256" ? crypto.sign("sha256", Buffer.from(data), pair.privateKey) : Buffer.alloc(0);
  return data + "." + b64u(sig);
}
const ec1 = o => mint({ pair: EC1, kid: "ec-1", ...o });
const sha256 = s => crypto.createHash("sha256").update(s).digest("hex"), hmac256 = s => crypto.createHmac("sha256", DIGEST_KEY).update(s).digest("hex");
function supabaseFake() {
  const ok = v => ({ ok: true, status: 200, json: async () => v });
  const f = {
    jwks: { keys: [] }, jwksCalls: 0, jwksDown: false, down: false, plan: "free", planCalls: 0, reserveResult: null, failRpc: {}, upsertOk: true,
    rpcs: [], calls: [], upserts: [], gets: [], reservations: new Map(), other: async () => provider(),
    // Postgres provider_slots 의 최소 흉내: id → {provider, expires}. slotQueue 에 응답을 밀어 두면 만료·상한 계산 없이 그대로 돌려준다.
    slots: new Map(), slotQueue: null,
    // 보관함: objects 는 Storage("<버킷>/<경로>" → 본문), failStorage/failRows 는 HTTP 메서드별 실패 스위치다.
    objects: new Map(), storageCalls: [], failStorage: {}, failRows: {},
    // 계정 삭제: auth 사용자 목록(admin API 가 지운다)과 그 실패 스위치. failStorage.LIST 는 목록 호출만 실패시킨다(업로드는 POST 라 따로).
    authUsers: new Set([UID, UID2]), failAdmin: false,
    rows: { plans: { free: { monthly_cost_cap_micros: 300000, monthly_request_cap: 300, monthly_minutes_cap: 600 }, essential: { monthly_cost_cap_micros: 15000000, monthly_request_cap: null, monthly_minutes_cap: 6000 } }, usage: null, vault: new Map() },
  };
  f.rpcNamed = name => f.rpcs.filter(r => r.rpc === name);
  f.fetch = async (url, init = {}) => {
    const u = new URL(url);
    if (url === SB + "/auth/v1/.well-known/jwks.json") {
      f.jwksCalls++;
      if (f.jwksDown) throw new TypeError("fetch failed");
      return ok(f.jwks);
    }
    if (u.origin !== SB) return f.other(url, init);
    const headers = init.headers || {};
    f.calls.push({ url, method: init.method || "GET", headers, redirect: init.redirect, bounded: init.signal instanceof AbortSignal });
    if (f.down) throw new TypeError("fetch failed");
    const bad = status => ({ ok: false, status, json: async () => ({}) });
    if (u.pathname.startsWith("/storage/v1/object/")) {
      // 업로드는 POST + x-upsert, 다운로드는 GET, 삭제는 일괄 삭제(DELETE /object/<버킷> {prefixes}) 다. 서비스 롤 키 없이는 401 이다.
      const method = init.method || "GET", key = u.pathname.slice("/storage/v1/object/".length), list = method === "POST" && key.startsWith("list/");
      f.storageCalls.push({ method, key, headers, body: init.body });
      if (f.failStorage[list ? "LIST" : method]) return bad(503);
      if (headers.apikey !== SERVICE_KEY || headers.authorization !== "Bearer " + SERVICE_KEY) return bad(401);
      if (list) {
        // POST /object/list/<버킷> {prefix,limit,offset,sortBy}: 접두사 바로 아래 항목을 name 순으로. name 은 접두사 뒤 이름이고, 더 깊은 경로는 id 가 null 인 폴더 항목으로만 보인다.
        const b = JSON.parse(init.body), start = key.slice("list/".length) + "/" + b.prefix, names = new Map();
        if (typeof b.prefix !== "string" || !Number.isInteger(b.limit) || b.limit < 1 || !Number.isInteger(b.offset) || b.offset < 0) return bad(400);
        for (const k of f.objects.keys()) if (k.startsWith(start)) { const [head, ...deeper] = k.slice(start.length).split("/"); names.set(head, deeper.length ? null : "id-" + head); }
        return ok([...names].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)).slice(b.offset, b.offset + b.limit).map(([name, id]) => ({ name, id })));
      }
      if (method === "POST") { if (f.objects.has(key) && headers["x-upsert"] !== "true") return bad(400); f.objects.set(key, init.body); return ok({ Key: key }); }
      if (method === "GET") return f.objects.has(key) ? ok(JSON.parse(f.objects.get(key))) : bad(404);
      if (method === "DELETE") {
        const { prefixes } = JSON.parse(init.body);
        if (!Array.isArray(prefixes) || !prefixes.length) return bad(400); // 실제 Storage 도 빈 배열은 거절한다
        for (const p of prefixes) f.objects.delete(key + "/" + p);
        return ok([]);
      }
      return bad(405);
    }
    if (u.pathname.startsWith("/auth/v1/admin/users/")) {
      // GoTrue admin: 서비스 롤 키가 있어야 하고, 없는 사용자는 404 다. 지우면 FK on delete cascade 로 vault_objects 행도 같이 간다.
      const id = u.pathname.slice("/auth/v1/admin/users/".length);
      if (f.failAdmin) return bad(503);
      if ((init.method || "GET") !== "DELETE" || headers.apikey !== SERVICE_KEY || headers.authorization !== "Bearer " + SERVICE_KEY) return bad(401);
      if (!f.authUsers.delete(id)) return bad(404);
      for (const [k, r] of f.rows.vault) if (r.user_id === id) f.rows.vault.delete(k);
      return ok({});
    }
    const name = u.pathname.slice("/rest/v1/".length);
    if (name.startsWith("rpc/")) {
      const rpc = name.slice(4), args = JSON.parse(init.body);
      f.rpcs.push({ rpc, args, headers, raw: init.body });
      if (f.failRpc[rpc] > 0) { f.failRpc[rpc]--; return { ok: false, status: 503, json: async () => ({}) }; }
      if (rpc === "effective_plan") { f.planCalls++; return ok(f.plan); }
      if (rpc === "settle_usage") return ok("settled");
      // schema-v2.sql: 행만 지운다(Storage 객체와 auth 사용자는 건드리지 않는다). 반환은 처리한 행 수다.
      if (rpc === "delete_account_data" && f.activeSubscription) return { ok: false, status: 400, json: async () => ({ code: "P0001", message: "active_subscription" }) };
      if (rpc === "delete_account_data") { let n = 0; for (const [k, r] of f.rows.vault) if (r.user_id === args.p_user) { f.rows.vault.delete(k); n++; } return ok({ vault_objects: n }); }
      if (rpc === "reserve_usage") {
        if (f.reserveResult !== null) return ok(typeof f.reserveResult === "function" ? f.reserveResult(args) : f.reserveResult);
        // schema-v2.sql 의 멱등 의미: 같은 (user, requestId) 가 있으면 digest 로 duplicate / digest_mismatch 를 가른다.
        const key = args.p_user + ":" + args.p_request_id, prior = f.reservations.get(key);
        if (prior !== undefined) return ok(prior === args.p_digest ? "duplicate" : "digest_mismatch");
        f.reservations.set(key, args.p_digest);
        return ok("reserved");
      }
      if (rpc === "acquire_provider_slot") {
        if (f.slotQueue && f.slotQueue.length) return ok(f.slotQueue.shift());
        const now = Date.now();
        for (const [id, s] of f.slots) if (s.expires <= now) f.slots.delete(id);
        if ([...f.slots.values()].filter(s => s.provider === args.p_provider).length >= args.p_max) return ok(null);
        const id = crypto.randomUUID();
        f.slots.set(id, { provider: args.p_provider, expires: now + args.p_ttl_ms });
        return ok(id);
      }
      if (rpc === "release_provider_slot") { f.slots.delete(args.p_id); return ok(null); }
    }
    if (name === "profiles") { f.upserts.push({ search: u.search, headers, body: JSON.parse(init.body) }); return { ok: f.upsertOk, status: f.upsertOk ? 201 : 500 }; }
    if ((name === "plans" || name === "monthly_usage") && f.failGet) return { ok: false, status: 500, json: async () => ({}) };
    if (name === "plans") { f.gets.push(url); const row = f.rows.plans[(u.searchParams.get("plan") || "").replace(/^eq\./, "")]; return ok(row ? [row] : []); }
    if (name === "monthly_usage") { f.gets.push(url); return ok(f.rows.usage ? [f.rows.usage] : []); }
    if (name === "vault_objects") {
      const method = init.method || "GET", eq = k => (u.searchParams.get(k) || "").replace(/^eq\./, "");
      if (f.failRows[method]) return bad(503);
      if (method === "GET") return ok([...f.rows.vault.values()].filter(r => r.user_id === eq("user_id")).map(({ object_id, size, storage_path }) => ({ object_id, size, storage_path })));
      if (method === "DELETE") { f.rows.vault.delete(eq("user_id") + ":" + eq("object_id")); return { ok: true, status: 204 }; }
      if (method === "POST") {
        // schema-v2.sql 의 vault_objects CHECK·PK·UNIQUE 를 그대로 흉내 낸다.
        const r = JSON.parse(init.body), key = r.user_id + ":" + r.object_id;
        const valid = /^[0-9a-f-]{36}$/.test(r.user_id) && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(r.object_id) && Number.isInteger(r.size) && r.size >= 0 && /^[A-Za-z0-9][A-Za-z0-9/_-]{0,255}$/.test(r.storage_path);
        if (!valid || [...f.rows.vault].some(([k, o]) => k !== key && o.storage_path === r.storage_path)) return bad(400);
        if (f.rows.vault.has(key) && !(u.searchParams.get("on_conflict") === "user_id,object_id" && /resolution=merge-duplicates/.test(headers.prefer))) return bad(409);
        f.rows.vault.set(key, r); return { ok: true, status: 201 };
      }
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  return f;
}
const sbEnv = root => ({
  ...config(root), SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, USAGE_DIGEST_KEY: DIGEST_KEY,
  OPENROUTER_PROVIDERS_JSON: JSON.stringify({ [model]: ["test-provider"], [judgeModel]: ["test-provider"] }),
  ALLOWED_VISION_MODELS: JSON.stringify([model]), ALLOWED_STT_MODELS: JSON.stringify(["microsoft/mai-transcribe-2"]),
});
// clock.t 를 올리면 서버의 JWT 만료·JWKS cooldown·등급 캐시 시계가 같이 간다.
async function withSupabase(run, { env = {}, setup } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "summrizei-service-test-")), sb = supabaseFake(), clock = { t: Date.now() };
  sb.jwks = { keys: [jwkOf(EC1, "ec-1"), jwkOf(RSA1, "rsa-1")] };
  if (setup) setup(sb);
  const server = createServer({ ...sbEnv(root), ...env }, { fetch: sb.fetch, now: () => clock.t });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  try { await run({ url: "http://127.0.0.1:" + server.address().port, root, sb, clock }); } finally { await close(server); removeTemp(root); }
}
const settledOf = (sb, n = 0) => sb.rpcNamed("settle_usage")[n].args;

test("supabase config fails closed without its secrets and plan features are validated at boot", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "summrizei-service-test-"));
  try {
    const base = sbEnv(root);
    createServer(base);
    createServer({ ...base, APP_TOKENS_JSON: undefined });
    assert.throws(() => createServer({ ...config(root), APP_TOKENS_JSON: undefined }), /APP_TOKENS_JSON/, "Supabase 없이는 정적 토큰이 여전히 필수다");
    assert.throws(() => createServer({ ...base, USAGE_DIGEST_KEY: undefined }), /USAGE_DIGEST_KEY/);
    assert.throws(() => createServer({ ...base, USAGE_DIGEST_KEY: "short" }), /USAGE_DIGEST_KEY/);
    assert.throws(() => createServer({ ...base, SUPABASE_SERVICE_ROLE_KEY: undefined }), /SERVICE_ROLE_KEY/);
    assert.throws(() => createServer({ ...base, SUPABASE_JWT_SECRET: "short" }), /invalid_supabase_jwt_secret/);
    createServer({ ...base, SUPABASE_JWT_SECRET: JWT_SECRET });
    for (const bad of ["http://proj.supabase.co", SB + "/rest/v1", SB + "?x=1", "not a url", "https://user:pw@proj.supabase.co"])
      assert.throws(() => createServer({ ...base, SUPABASE_URL: bad }), /invalid_supabase_url/, bad);
    createServer({ ...base, SUPABASE_URL: "http://127.0.0.1:54321" });
    const { SUPABASE_URL, ...noUrl } = base;
    assert.throws(() => createServer(noUrl), /SUPABASE_URL required/, "URL 없이 키만 있는 설정은 조용히 무시하지 않는다");
    assert.throws(() => createServer({ ...config(root), SUPABASE_JWT_SECRET: JWT_SECRET }), /SUPABASE_URL required/);

    const defaults = serverConfig(base).planFeatures;
    assert.deepEqual(defaults.free, { features: [], models: [model] });
    for (const p of ["essential", "professional"]) assert.deepEqual(defaults[p], { features: ["vision", "stt", "judge", "background", "augment"], models: [model] }, p);
    assert.equal(defaults.paid, undefined, "옛 paid 등급은 없다");
    const lite = "anthropic/claude-haiku-4.5", two = { ...base, ALLOWED_MODELS: JSON.stringify([lite, model]), OPENROUTER_PROVIDERS_JSON: JSON.stringify({ [model]: ["p"], [lite]: ["p"] }) };
    assert.deepEqual(serverConfig(two).planFeatures.free.models, [model], "free 는 lite 요약 모델만");
    assert.deepEqual(serverConfig(two).planFeatures.essential.models, [lite, model]);
    const merged = serverConfig({ ...base, PLAN_FEATURES_JSON: JSON.stringify({ free: { features: ["judge"] }, pro: { features: ["vision"] } }) }).planFeatures;
    assert.deepEqual(merged.free, { features: ["judge"], models: [model] }, "빠진 키는 기본값을 유지한다");
    assert.deepEqual(merged.pro, { features: ["vision"], models: [model] });
    for (const bad of [{ free: { features: ["admin"] } }, { free: { models: ["openai/unknown"] } }, { free: { models: [] } }, { free: { extra: 1 } }, { "Bad Name": {} }, [], { free: [] }])
      assert.throws(() => createServer({ ...base, PLAN_FEATURES_JSON: JSON.stringify(bad) }), /invalid_plan/, JSON.stringify(bad));
  } finally { removeTemp(root); }
});

test("JWT verification accepts valid ES256 and RS256 tokens, caches the JWKS and rejects everything else", async () => {
  await withSupabase(async ({ url, sb }) => {
    const now = Math.floor(Date.now() / 1000), rs = o => mint({ alg: "RS256", pair: RSA1, kid: "rsa-1", ...o });
    for (const t of [ec1(), rs(), ec1({ claims: { sub: UID.toUpperCase() } }), ec1({ claims: { aud: ["authenticated", "extra"] } }), ec1({ claims: { exp: now - 2 } })]) {
      const res = await req(url, "/v1/me", "GET", undefined, t);
      assert.equal(res.status, 200);
      assert.equal((await res.json()).accountId, UID, "계정 id 는 sub(소문자 uuid)다");
    }
    assert.equal(sb.jwksCalls, 1, "JWKS 는 캐시된다");
    const before = [sb.rpcs.length, sb.upserts.length, sb.calls.length];

    const [h, p, s] = ec1().split("."), flip = x => x.slice(0, 10) + (x[10] === "A" ? "B" : "A") + x.slice(11);
    const edit = (claims, tail = s) => h + "." + b64u({ ...JSON.parse(Buffer.from(p, "base64url")), ...claims }) + "." + tail;
    const pem = EC1.publicKey.export({ type: "spki", format: "pem" });
    const bad = [
      ["expired", ec1({ claims: { exp: now - 60 } }), "token_expired"],
      ["expired + forged signature", mint({ pair: EC2, kid: "ec-1", claims: { exp: now - 60 } }), "unauthorized"],
      ["expiry extended in the payload", edit({ exp: now + 99999 }), "unauthorized"],
      ["not yet valid", ec1({ claims: { nbf: now + 600 } })],
      ["exp missing", ec1({ claims: { exp: undefined } })], ["exp is a string", ec1({ claims: { exp: String(now + 600) } })],
      ["aud anon", ec1({ claims: { aud: "anon" } })], ["aud missing", ec1({ claims: { aud: undefined } })], ["aud array without authenticated", ec1({ claims: { aud: ["a", "b"] } })],
      ["iss of another project", ec1({ claims: { iss: "https://evil.supabase.co/auth/v1" } })], ["iss missing", ec1({ claims: { iss: undefined } })], ["iss without /auth/v1", ec1({ claims: { iss: SB } })],
      ["anon key role", ec1({ claims: { role: "anon" } })], ["service_role key", ec1({ claims: { role: "service_role" } })],
      ["sub missing", ec1({ claims: { sub: undefined } })], ["sub is not a uuid", ec1({ claims: { sub: "admin" } })], ["anonymous sign-in", ec1({ claims: { is_anonymous: true } })],
      ["alg none, empty signature", mint({ alg: "none" })],
      ["alg none, junk signature", b64u({ alg: "none", typ: "JWT" }) + "." + p + ".AAAA"], ["alg None", mint({ alg: "None" })],
      ["tampered signature", h + "." + p + "." + flip(s)], ["tampered payload", edit({ sub: UID2 })], ["signed by another key under a known kid", mint({ pair: EC2, kid: "ec-1" })],
      ["HS256 with the public key PEM as the secret", mint({ alg: "HS256", secret: pem })], ["HS256 with the project secret while only JWKS is configured", mint({ alg: "HS256", secret: JWT_SECRET })],
      ["ES256 header on an RSA kid", mint({ pair: EC1, kid: "rsa-1" })], ["RS256 header on an EC kid", mint({ alg: "RS256", pair: RSA1, kid: "ec-1" })],
      ["no kid", ec1({ kid: null })], ["unknown kid", ec1({ kid: "ec-9" })], ["crit header", ec1({ header: { crit: ["exp"] } })],
      ["not a jwt", "bad"], ["two segments", h + "." + p], ["empty segment", h + ".." + s], ["segment with padding", h + "." + p + "=." + s], ["oversized", h + "." + "A".repeat(5000) + "." + s],
    ];
    for (const [label, t, code = "unauthorized"] of bad) {
      const e = await errorOf(await req(url, "/v1/me", "GET", undefined, t), 401, code);
      assert.equal(e.retryable, false, label);
    }
    assert.deepEqual([sb.rpcs.length, sb.upserts.length, sb.calls.length], before, "거절된 토큰은 DB를 건드리지 않는다");
    assert.equal((await req(url, "/v1/me", "GET", undefined, ec1())).status, 200, "거절 뒤에도 정상 토큰은 통과한다");
  });
});

test("with SUPABASE_JWT_SECRET only HS256 is accepted and the JWKS is never fetched", async () => {
  await withSupabase(async ({ url, sb }) => {
    const now = Math.floor(Date.now() / 1000), hs = o => mint({ alg: "HS256", kid: null, ...o });
    const res = await req(url, "/v1/me", "GET", undefined, hs());
    assert.equal(res.status, 200);
    assert.equal((await res.json()).accountId, UID);
    await errorOf(await req(url, "/v1/me", "GET", undefined, hs({ claims: { exp: now - 60 } })), 401, "token_expired");
    for (const t of [hs({ secret: "another-secret".padEnd(40, "x") }), hs({ claims: { aud: "anon" } }), hs({ claims: { iss: "https://evil.supabase.co/auth/v1" } }), hs({ claims: { role: "anon" } }),
      ec1(), mint({ alg: "RS256", pair: RSA1, kid: "rsa-1" }), mint({ alg: "none" })])
      await errorOf(await req(url, "/v1/me", "GET", undefined, t), 401, "unauthorized");
    const [h, p, s] = hs().split(".");
    await errorOf(await req(url, "/v1/me", "GET", undefined, h + "." + b64u({ sub: UID2, aud: "authenticated", role: "authenticated", iss: SB + "/auth/v1", exp: now + 99 }) + "." + s), 401, "unauthorized");
    assert.equal(sb.jwksCalls, 0, "시크릿이 있으면 JWKS 를 쓰지 않는다");
  }, { env: { SUPABASE_JWT_SECRET: JWT_SECRET } });
});

test("an unknown kid refetches the JWKS at most once per cooldown and rotated keys are picked up", async () => {
  await withSupabase(async ({ url, sb, clock }) => {
    const ec2 = o => mint({ pair: EC2, kid: "ec-2", ...o });
    assert.equal((await req(url, "/v1/me", "GET", undefined, ec1())).status, 200);
    assert.equal(sb.jwksCalls, 1);
    sb.jwks = { keys: [jwkOf(EC1, "ec-1"), jwkOf(EC2, "ec-2")] };
    // 가짜 kid 로 Supabase 를 두드릴 수 없다: cooldown 안에서는 다시 받지 않는다.
    for (let i = 0; i < 10; i++) await errorOf(await req(url, "/v1/me", "GET", undefined, ec2()), 401, "unauthorized");
    assert.equal(sb.jwksCalls, 1);
    clock.t += 11000;
    assert.equal((await req(url, "/v1/me", "GET", undefined, ec2())).status, 200, "새 kid 는 JWKS 를 다시 받으면 통과한다");
    assert.equal(sb.jwksCalls, 2);
    assert.equal((await req(url, "/v1/me", "GET", undefined, ec1())).status, 200);
    assert.equal(sb.jwksCalls, 2, "아는 kid 는 다시 받지 않는다");
    // 끝내 없는 kid 는 cooldown 마다 한 번만 받아 본다.
    clock.t += 11000;
    for (let i = 0; i < 10; i++) await errorOf(await req(url, "/v1/me", "GET", undefined, ec1({ kid: "ec-9" })), 401, "unauthorized");
    assert.equal(sb.jwksCalls, 3);
    // TTL(10분)이 지나면 아는 kid 도 새로 받고, 받기에 실패하면 가진 키로 계속 검증한다.
    sb.jwksDown = true;
    clock.t += 11 * 60 * 1000;
    assert.equal((await req(url, "/v1/me", "GET", undefined, ec1())).status, 200);
    assert.equal(sb.jwksCalls, 4);
    // 폐기된 키가 JWKS 에서 빠지면 다음 새로고침에서 거절된다.
    sb.jwksDown = false;
    sb.jwks = { keys: [jwkOf(EC2, "ec-2")] };
    clock.t += 11000;
    await errorOf(await req(url, "/v1/me", "GET", undefined, ec1()), 401, "unauthorized");
    assert.equal((await req(url, "/v1/me", "GET", undefined, ec2())).status, 200);
  });
});

test("an unreachable JWKS answers a retryable 503 instead of logging users out, then recovers", async () => {
  await withSupabase(async ({ url, sb, clock }) => {
    const e = await errorOf(await req(url, "/v1/me", "GET", undefined, ec1()), 503, "auth_unavailable");
    assert.equal(e.retryable, true);
    assert.equal(sb.jwksCalls, 1);
    await errorOf(await req(url, "/v1/me", "GET", undefined, ec1()), 503, "auth_unavailable");
    assert.equal(sb.jwksCalls, 1, "실패한 뒤에도 cooldown 안에서는 다시 두드리지 않는다");
    sb.jwksDown = false;
    clock.t += 11000;
    assert.equal((await req(url, "/v1/me", "GET", undefined, ec1())).status, 200);
  }, { setup: sb => { sb.jwksDown = true; } });
  // 쓸 수 있는 키가 하나도 없는 응답(대칭키·너무 작은 RSA 키뿐)도 못 믿는 응답이다.
  await withSupabase(async ({ url }) => {
    await errorOf(await req(url, "/v1/me", "GET", undefined, ec1()), 503, "auth_unavailable");
  }, { setup: sb => { sb.jwks = { keys: [{ kty: "oct", kid: "ec-1", k: "c2VjcmV0", use: "sig", alg: "HS256" }, { kty: "RSA", kid: "weak" }] }; } });
});

test("static tokens keep the file ledger while JWT accounts use Postgres", async () => {
  await withSupabase(async ({ url, root, sb }) => {
    assert.equal((await req(url, "/v1/write", "POST", input)).status, 200);
    assert.equal(sb.rpcs.length, 0, "정적 토큰 계정은 Supabase 장부를 쓰지 않는다 — 전역 슬롯 RPC 도 없다");
    assert.equal(sb.calls.length, 0);
    const ledger = () => readState(path.join(root, "usage.json")).accounts;
    assert.equal(ledger().A.jobs["request-one"].status, "completed");
    assert.equal(ledger().A.jobs["request-one"].digest, sha256(noteDigest(input)), "파일 장부 digest 는 기존 SHA-256 이다");
    const me = await (await req(url, "/v1/me")).json();
    assert.equal(me.accountId, "A");
    assert.equal(me.quota.requests, 1);
    assert.deepEqual(me.models, [model]);
    assert.equal(me.plan, undefined, "정적 계정에는 DB 등급이 없다");
    assert.equal(me.noteSpecVersion, NoteContract.NOTE_SPEC_VERSION);
    assert.equal(me.promptVersion, Prompts.PROMPT_VERSION);
    assert.equal(sb.upserts.length, 0, "정적 계정은 프로필을 만들지 않는다");

    assert.equal((await req(url, "/v1/write", "POST", { ...input, requestId: "jwt-one" }, ec1())).status, 200);
    assert.ok(!ledger()[UID], "JWT 계정은 파일 장부에 남지 않는다");
    assert.equal(sb.rpcNamed("reserve_usage").length, 1);
    assert.equal(sb.rpcNamed("reserve_usage")[0].args.p_user, UID);
    // 같은 requestId 라도 계정마다 따로다 — 정적 "A" 의 request-one 은 JWT 사용자와 겹치지 않는다.
    assert.equal((await req(url, "/v1/write", "POST", input, ec1())).status, 200);
  });
});

test("the client-version gate and rate limit run before any database call for JWT accounts", async () => {
  await withSupabase(async ({ url, sb }) => {
    const old = { "x-client-version": "1.0.0" }, ok = { "x-client-version": "1.2.0" };
    await errorOf(await req(url, "/v1/me", "GET", undefined, ec1(), origin, old), 426, "client_upgrade_required");
    await errorOf(await req(url, "/v1/write", "POST", { ...input, requestId: "old-client" }, ec1(), origin, old), 426, "client_upgrade_required");
    assert.equal(sb.calls.length, 0, "426 은 등급 조회·예약·프로필 전에 나간다");
    assert.equal((await req(url, "/v1/write", "POST", { ...input, requestId: "new-client" }, ec1(), origin, ok)).status, 200);
    const e = await errorOf(await req(url, "/v1/write", "POST", { ...input, requestId: "too-fast" }, ec1(), origin, ok), 429, "rate_limited");
    assert.equal(e.retryable, true);
    assert.equal(sb.rpcNamed("reserve_usage").length, 1, "토큰 버킷은 sub 별로 메모리에서 센다");
    assert.equal((await req(url, "/v1/write", "POST", { ...input, requestId: "other-user" }, ec1({ claims: { sub: UID2 } }), origin, ok)).status, 200, "다른 사용자의 버킷은 따로다");
  }, { env: { REMOTE_CONFIG_JSON: JSON.stringify({ minClientVersion: "1.2.0" }), ACCOUNT_RATE_PER_MIN: "1" } });
});

test("reserve_usage results map to the existing error codes and nothing reaches the provider", async () => {
  let calls = 0;
  await withSupabase(async ({ url, sb }) => {
    const jwt = ec1();
    for (const [result, status, code, retryable] of [["duplicate", 409, "request_already_reserved_or_processed", false], ["digest_mismatch", 400, "idempotency_content_mismatch", false], ["quota_exceeded", 429, "quota_exceeded", false],
      ["surprise", 503, "usage_store_failed", true], [null, 503, "usage_store_failed", true], [7, 503, "usage_store_failed", true], ["constructor", 503, "usage_store_failed", true]]) {
      sb.reserveResult = () => result;
      for (let i = 0; i < 3; i++) {
        const e = await errorOf(await req(url, "/v1/write", "POST", { ...input, requestId: "map-" + i }, jwt), status, code);
        assert.equal(e.retryable, retryable, String(result));
      }
    }
    assert.equal(calls, 0, "예약이 거절되면 제공자를 부르지 않는다");
    assert.equal(sb.rpcNamed("settle_usage").length, 0, "예약하지 못한 요청은 정산할 것도 없다");
    // 거절마다 동시 처리 슬롯이 반납된다(ACCOUNT_CONCURRENCY=1 인데 21번 연속 같은 오류가 나왔다).
    sb.reserveResult = null;
    assert.equal((await req(url, "/v1/write", "POST", { ...input, requestId: "map-ok" }, jwt)).status, 200);
    assert.equal(calls, 1);

    // 실제 RPC 의 멱등 의미: 같은 본문은 duplicate(409), 다른 본문은 digest_mismatch(400).
    await errorOf(await req(url, "/v1/write", "POST", { ...input, requestId: "map-ok" }, jwt), 409, "request_already_reserved_or_processed");
    await errorOf(await req(url, "/v1/write", "POST", { ...input, requestId: "map-ok", evidence: [{ ...input.evidence[0], text: "changed" }] }, jwt), 400, "idempotency_content_mismatch");
    assert.equal(calls, 1);
    assert.equal((await req(url, "/v1/write", "POST", { ...input, requestId: "map-ok" }, ec1({ claims: { sub: UID2 } }))).status, 200, "requestId 는 사용자별로 따로다");
  }, { env: { ACCOUNT_CONCURRENCY: "1", ACCOUNT_RATE_PER_MIN: "1000" }, setup: sb => { sb.other = async () => { calls++; return provider(); }; } });
});

test("a successful write reserves then settles through PostgREST with content-free metadata", async () => {
  await withSupabase(async ({ url, sb }) => {
    const res = await req(url, "/v1/write", "POST", input, ec1(), origin, { "x-client-version": "1.2.3" });
    assert.equal(res.status, 200);
    assert.deepEqual(sb.rpcs.map(r => r.rpc), ["effective_plan", "reserve_usage", "acquire_provider_slot", "release_provider_slot", "settle_usage"]);
    for (const c of sb.calls) {
      assert.equal(c.headers.apikey, SERVICE_KEY);
      assert.equal(c.headers.authorization, "Bearer " + SERVICE_KEY);
      assert.equal(c.redirect, "error", "리다이렉트를 따라가지 않는다");
      assert.ok(c.bounded, "모든 Supabase 호출에 시간 제한이 걸린다");
      assert.ok(c.url.startsWith(SB + "/rest/v1/"));
    }
    assert.deepEqual(sb.rpcNamed("effective_plan")[0].args, { p_user: UID });
    const reserve = sb.rpcNamed("reserve_usage")[0].args;
    const canonical = noteDigest(input);
    assert.deepEqual(Object.keys(reserve).sort(), ["p_cost_micros", "p_digest", "p_minutes", "p_request_id", "p_user"]);
    assert.equal(reserve.p_user, UID);
    assert.equal(reserve.p_request_id, "request-one");
    assert.equal(reserve.p_digest, hmac256(canonical), "digest 는 USAGE_DIGEST_KEY 로 HMAC 한 값이다");
    assert.notEqual(reserve.p_digest, sha256(canonical), "맨 SHA-256 은 DB에 가지 않는다");
    assert.match(reserve.p_digest, /^[a-f0-9]{64}$/);
    assert.ok(Number.isInteger(reserve.p_cost_micros) && reserve.p_cost_micros > 0 && reserve.p_cost_micros % 1e4 === 0, "예약은 센트 x 10,000 마이크로달러다: " + reserve.p_cost_micros);
    assert.equal(reserve.p_minutes, 0);

    const { p_latency_ms, ...settled } = settledOf(sb);
    assert.deepEqual(settled, {
      p_user: UID, p_request_id: "request-one", p_actual_cost_micros: Math.ceil(.002 * 1e6), p_status: "ok", p_stage: "write.section", p_provider: "openrouter", p_model: model,
      p_input_tokens: 800, p_output_tokens: 90, p_audio_seconds: null, p_images: null, p_prompt_version: Prompts.PROMPT_VERSION, p_schema_version: 1, p_error_code: null, p_client_version: "1.2.3", p_host: null,
    });
    assert.ok(Number.isInteger(p_latency_ms) && p_latency_ms >= 0 && p_latency_ms < 5000);
    assert.equal(sb.rpcs.at(-1).rpc, "settle_usage");
  });
});

// ── 전역 제공자 슬롯(provider_slots): 로컬 세마포어 뒤에 Postgres 상한을 한 겹 더 둔다. ──
test("a write holds a global provider slot between reserve and settle", async () => {
  await withSupabase(async ({ url, sb }) => {
    // 제공자 호출은 Supabase 출처가 아니라 calls/rpcs 에 안 남으므로 마커를 끼워 순서를 본다.
    sb.other = async () => { sb.rpcs.push({ rpc: "provider-fetch", args: {} }); return noteReply(s1Out); };
    assert.equal((await req(url, "/v1/write", "POST", input, ec1())).status, 200);
    assert.equal(sb.slots.size, 0, "응답 전에 슬롯을 돌려놓는다");
    assert.deepEqual(sb.rpcs.map(r => r.rpc), ["effective_plan", "reserve_usage", "acquire_provider_slot", "provider-fetch", "release_provider_slot", "settle_usage"]);
    const acq = sb.rpcNamed("acquire_provider_slot"), rel = sb.rpcNamed("release_provider_slot");
    assert.equal(acq.length, 1);
    assert.deepEqual(acq[0].args, { p_provider: model, p_max: 2, p_ttl_ms: 70000 }, "상한은 PROVIDER_CONCURRENCY_JSON, 만료는 요청 타임아웃+30초");
    assert.equal(rel.length, 1);
    assert.equal(rel[0].args.p_id.length, 36);
  }, { env: { PROVIDER_CONCURRENCY_JSON: JSON.stringify({ [model]: 2 }), OPENROUTER_TIMEOUT_MS: "40000" } });
});

test("a failed provider call still releases the global slot", async () => {
  await withSupabase(async ({ url, sb }) => {
    sb.other = async () => ({ ok: false, status: 500, json: async () => ({}) });
    const e = await errorOf(await req(url, "/v1/write", "POST", input, ec1()), 502, "provider_failed_or_invalid_output");
    assert.equal(e.retryable, true);
    assert.equal(sb.rpcNamed("release_provider_slot").length, 1);
    assert.equal(sb.slots.size, 0);
    assert.equal(settledOf(sb, 0).p_status, "error");
  });
});

test("a full global pool answers provider_busy after the queue wait and refunds", async () => {
  await withSupabase(async ({ url, sb }) => {
    let calls = 0;
    sb.other = async () => { calls++; return noteReply(s1Out); };
    // 다른 워커가 잡아 둔 슬롯 — p_max 1 이라 이 요청의 획득은 계속 null 을 받는다.
    sb.slots.set(crypto.randomUUID(), { provider: model, expires: Date.now() + 60000 });
    const t0 = Date.now();
    const e = await errorOf(await req(url, "/v1/write", "POST", input, ec1()), 429, "provider_busy");
    assert.equal(e.retryable, true);
    assert.equal(e.retryAfterMs, 2000);
    assert.ok(Date.now() - t0 >= 350, "로컬+전역 대기 합산이 대기 상한이다");
    assert.equal(calls, 0, "전역 슬롯을 못 얻은 요청은 제공자를 호출하지 않는다");
    assert.ok(sb.rpcNamed("acquire_provider_slot").length > 1, "잡힐 때까지 250ms 간격으로 다시 본다");
    const args = settledOf(sb, 0);
    assert.equal(args.p_status, "refunded");
    assert.equal(args.p_error_code, "provider_busy");
  }, { env: { PROVIDER_CONCURRENCY_JSON: JSON.stringify({ [model]: 1 }), PROVIDER_QUEUE_MS: "400" } });
});

test("empty answers and RPC errors in the global pool are retried, then the write succeeds", async () => {
  await withSupabase(async ({ url, sb }) => {
    sb.slotQueue = [null];
    sb.failRpc.acquire_provider_slot = 1;
    assert.equal((await req(url, "/v1/write", "POST", input, ec1())).status, 200);
    assert.equal(sb.rpcNamed("acquire_provider_slot").length, 3, "오류 1번 + 빈 응답 1번 뒤 세 번째에 잡는다");
    assert.equal(sb.rpcNamed("release_provider_slot").length, 1);
  });
});

test("a release_rpc failure does not change a successful response", async () => {
  await withSupabase(async ({ url, sb }) => {
    sb.failRpc.release_provider_slot = 1;
    assert.equal((await req(url, "/v1/write", "POST", input, ec1())).status, 200);
    assert.equal(sb.rpcNamed("release_provider_slot").length, 1);
    assert.equal(sb.slots.size, 1, "놓기 RPC가 실패해도 응답은 그대로다 — 슬롯은 만료로 회수된다");
  });
});

test("a client abort during the global wait refunds and frees the local slot", async () => {
  await withSupabase(async ({ url, sb }) => {
    let calls = 0;
    sb.other = async () => { calls++; return noteReply(s1Out); };
    const held = crypto.randomUUID();
    sb.slots.set(held, { provider: model, expires: Date.now() + 60000 });
    const ac = new AbortController();
    const queued = fetch(url + "/v1/write", { method: "POST", signal: ac.signal, headers: { authorization: "Bearer " + ec1(), origin, "content-type": "application/json" }, body: JSON.stringify(input) }).catch(() => null);
    await new Promise(r => setTimeout(r, 350));
    ac.abort(); await queued;
    for (let i = 0; i < 20 && !sb.rpcNamed("settle_usage").length; i++) await new Promise(r => setTimeout(r, 10));
    const args = settledOf(sb, 0);
    assert.equal(args.p_status, "refunded");
    assert.equal(args.p_error_code, "request_cancelled_or_timed_out");
    assert.equal(calls, 0);
    // 전역 대기에서 나갈 때 로컬 슬롯도 놓았다 — 점유 슬롯을 지우면 다음 요청은 바로 간다(로컬 상한 1).
    sb.slots.delete(held);
    assert.equal((await req(url, "/v1/write", "POST", { ...input, requestId: "after-abort" }, ec1())).status, 200);
    assert.equal(calls, 1);
  }, { env: { PROVIDER_CONCURRENCY_JSON: JSON.stringify({ [model]: 1 }), PROVIDER_QUEUE_MS: "5000" } });
});

test("unreported costs settle as null and reported charges settle in micros", async () => {
  let cost = null;
  await withSupabase(async ({ url, sb }) => {
    const jwt = ec1();
    const reply = () => ({ ok: true, json: async () => ({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(s1Out) } }], usage: { prompt_tokens: 800, completion_tokens: 90, cost } }) });
    sb.other = async () => reply();
    const body = i => sectionIn({ requestId: "cost-" + i });
    assert.equal((await req(url, "/v1/write", "POST", body(1), jwt)).status, 200);
    assert.equal(settledOf(sb, 0).p_actual_cost_micros, null, "비용을 보고하지 않으면 null — DB가 예약액을 그대로 청구한다");
    assert.equal(settledOf(sb, 0).p_status, "ok");
    cost = .0023;
    assert.equal((await req(url, "/v1/write", "POST", body(2), jwt)).status, 200);
    assert.equal(settledOf(sb, 1).p_actual_cost_micros, Math.ceil(.0023 * 1e6));
    cost = 0;
    assert.equal((await req(url, "/v1/write", "POST", body(3), jwt)).status, 200);
    assert.equal(settledOf(sb, 2).p_actual_cost_micros, 0, "0 으로 보고한 비용은 0 이다(미보고와 다르다)");
    assert.equal(settledOf(sb, 2).p_stage, "write.section");
    assert.equal(settledOf(sb, 2).p_prompt_version, Prompts.PROMPT_VERSION, "plan/write 의 프롬프트 버전이 원장에 남는다");
    assert.equal(settledOf(sb, 2).p_schema_version, 1);

    // 제공자가 끝내 실패하면 예약을 그대로 두고(actual null) error 로 닫는다. 같은 requestId 는 다시 못 쓴다.
    sb.other = async () => ({ ok: false, status: 500, json: async () => ({}) });
    const e = await errorOf(await req(url, "/v1/write", "POST", body(4), jwt), 502, "provider_failed_or_invalid_output");
    assert.equal(e.retryable, true);
    const failed = settledOf(sb, 3);
    assert.equal(failed.p_status, "error");
    assert.equal(failed.p_actual_cost_micros, null);
    assert.equal(failed.p_error_code, "provider_failed_or_invalid_output");
    assert.equal(failed.p_input_tokens, null);
    await errorOf(await req(url, "/v1/write", "POST", body(4), jwt), 409, "request_already_reserved_or_processed");
  }, { setup: sb => { sb.plan = "free"; } });
});

test("a length cut-off settles as an error carrying the reported charge, not as a refund", async () => {
  await withSupabase(async ({ url, sb }) => {
    const jwt = ec1();
    sb.other = async () => noteReply('{"blocks":[{"type":"te', { finish: "length", cost: .003 });
    const e = await errorOf(await req(url, "/v1/write", "POST", sectionIn({ requestId: "cut-1" }), jwt), 422, "llm_output_truncated");
    assert.equal(e.retryable, false);
    const { p_latency_ms, ...cut } = settledOf(sb, 0);
    assert.deepEqual(cut, {
      p_user: UID, p_request_id: "cut-1", p_actual_cost_micros: Math.ceil(.003 * 1e6), p_status: "error", p_stage: "write.section", p_provider: "openrouter", p_model: model,
      p_input_tokens: 800, p_output_tokens: 90, p_audio_seconds: null, p_images: null, p_prompt_version: null, p_schema_version: null, p_error_code: "llm_output_truncated", p_client_version: null, p_host: null,
    });
    await errorOf(await req(url, "/v1/write", "POST", sectionIn({ requestId: "cut-1" }), jwt), 409, "request_already_reserved_or_processed");

    sb.other = async () => noteReply('{"blocks":[', { finish: "length", cost: null });
    await errorOf(await req(url, "/v1/plan", "POST", planIn({ requestId: "cut-2" }), jwt), 422, "llm_output_truncated");
    const unreported = settledOf(sb, 1);
    assert.equal(unreported.p_status, "error");
    assert.equal(unreported.p_actual_cost_micros, null, "비용을 모르는 잘림은 예약을 그대로 둔다");
    assert.equal(unreported.p_stage, "plan");

    // 형식 실패 뒤에 잘려도 두 호출의 보고 비용이 합쳐진다.
    const replies = [noteReply("{}", { cost: .001 }), noteReply('{"blocks":[', { finish: "length", cost: .003 })];
    sb.other = async () => replies.shift();
    await errorOf(await req(url, "/v1/write", "POST", sectionIn({ requestId: "cut-3" }), jwt), 422, "llm_output_truncated");
    assert.equal(settledOf(sb, 2).p_actual_cost_micros, Math.ceil((.001 + .003) * 1e6));
    assert.equal(settledOf(sb, 2).p_input_tokens, 1600);
    assert.equal(sb.rpcNamed("settle_usage").every(r => r.args.p_status === "error"), true);
  });
});

test("refund paths settle as refunded with no cost and no usage, and the same requestId can retry", async () => {
  let mode = "fail";
  await withSupabase(async ({ url, sb }) => {
    const jwt = ec1();
    // 제공자 HTTP 오류는 청구가 없다고 확정할 수 있다 — 환불.
    let e = await errorOf(await req(url, "/v1/stt", "POST", sttBody({ requestId: "stt-r1" }), jwt), 502, "provider_failed_or_invalid_output");
    assert.equal(e.retryable, true);
    assert.equal(sb.rpcNamed("reserve_usage")[0].args.p_minutes, 1, "60초 청크는 1분으로 센다");
    assert.deepEqual(settledOf(sb, 0), {
      p_user: UID, p_request_id: "stt-r1", p_actual_cost_micros: null, p_status: "refunded", p_stage: "stt", p_provider: "openrouter", p_model: "microsoft/mai-transcribe-2",
      p_input_tokens: null, p_output_tokens: null, p_audio_seconds: null, p_images: null, p_prompt_version: null, p_schema_version: null,
      p_error_code: "provider_failed_or_invalid_output", p_latency_ms: settledOf(sb, 0).p_latency_ms, p_client_version: null, p_host: null,
    });
    mode = "busy";
    e = await errorOf(await req(url, "/v1/stt", "POST", sttBody({ requestId: "stt-r2" }), jwt), 429, "provider_busy");
    assert.equal(e.retryAfterMs, 3000);
    assert.equal(settledOf(sb, 1).p_status, "refunded");
    assert.equal(settledOf(sb, 1).p_error_code, "provider_busy");
    // 실제 RPC 는 환불하면 예약 행을 지운다 — 같은 requestId 로 다시 보낼 수 있다.
    sb.reservations.delete(UID + ":stt-r1");
    mode = "ok";
    const ok = await req(url, "/v1/stt", "POST", sttBody({ requestId: "stt-r1" }), jwt);
    assert.equal(ok.status, 200);
    const done = settledOf(sb, 2);
    assert.equal(done.p_status, "ok");
    assert.equal(done.p_audio_seconds, 60, "정산은 제공자가 잰 길이와 선언 중 큰 값이다");
    assert.equal(done.p_actual_cost_micros, Math.ceil(0.004 * 1e6), "제공자가 보고한 usage.cost 가 정산된다");
    assert.equal(done.p_prompt_version, "v1");
    assert.equal(done.p_schema_version, 1);
    assert.equal(done.p_error_code, null);

    // 정산에 실패한 환불은 같은 requestId 재시도를 약속할 수 없으므로 503 이다. 성공은 결과를 돌려준다.
    mode = "fail";
    sb.failRpc.settle_usage = 2;
    await errorOf(await req(url, "/v1/stt", "POST", sttBody({ requestId: "stt-r3" }), jwt), 503, "usage_store_failed");
    mode = "ok";
    sb.failRpc.settle_usage = 2;
    assert.equal((await req(url, "/v1/stt", "POST", sttBody({ requestId: "stt-r4" }), jwt)).status, 200, "정산 실패가 이미 만든 결과를 버리지 않는다");
    // 정산은 한 번 다시 시도한다(DB가 already_settled 로 멱등 처리).
    sb.failRpc.settle_usage = 1;
    const before = sb.rpcNamed("settle_usage").length;
    assert.equal((await req(url, "/v1/stt", "POST", sttBody({ requestId: "stt-r5" }), jwt)).status, 200);
    assert.equal(sb.rpcNamed("settle_usage").length - before, 2);
    assert.equal(sb.rpcNamed("reserve_usage").filter(r => r.args.p_request_id === "stt-r5").length, 1, "예약은 다시 부르지 않는다");
  }, { setup: sb => {
    sb.plan = "essential";
    sb.other = async () => {
      if (mode === "fail") return { ok: false, status: 500, headers: new Map(), json: async () => ({}) };
      if (mode === "busy") return { ok: false, status: 429, headers: new Map([["retry-after", "3"]]), json: async () => ({}) };
      return { ok: true, json: async () => maiRaw() };
    };
  } });
});

test("when Supabase is unavailable no request reaches a provider and every failure is a retryable 503", async () => {
  let calls = 0;
  await withSupabase(async ({ url, sb }) => {
    const jwt = ec1();
    // 등급 조회 단계: 아직 아무것도 읽지 못했다.
    sb.down = true;
    let e = await errorOf(await req(url, "/v1/write", "POST", input, jwt), 503, "usage_store_failed");
    assert.equal(e.retryable, true);
    await errorOf(await req(url, "/v1/me", "GET", undefined, jwt), 503, "usage_store_failed");
    assert.equal(calls, 0);
    assert.equal(sb.rpcs.length, 0);

    // 예약 단계: 등급은 캐시에서 읽히고 reserve 가 실패한다.
    sb.down = false;
    assert.equal((await req(url, "/v1/me", "GET", undefined, jwt)).status, 200);
    calls = 0;
    sb.down = true;
    e = await errorOf(await req(url, "/v1/write", "POST", { ...input, requestId: "down-1" }, jwt), 503, "usage_store_failed");
    assert.equal(e.retryable, true);
    assert.equal(calls, 0, "예약에 성공하지 못하면 제공자를 부르지 않는다");
    sb.down = false;
    sb.failRpc.reserve_usage = 1;
    await errorOf(await req(url, "/v1/write", "POST", { ...input, requestId: "down-2" }, jwt), 503, "usage_store_failed");
    assert.equal(calls, 0);
    assert.equal(sb.calls.filter(c => c.url.endsWith("/rpc/reserve_usage")).length, 2, "요청마다 예약을 한 번만 시도한다(자동 재시도 없음 — 응답을 잃어도 DB에는 들어갔을 수 있다)");
    assert.equal(sb.rpcNamed("settle_usage").length, 0);

    // 복구되면 새 requestId 로 정상 동작하고 동시 처리 슬롯도 새지 않았다.
    assert.equal((await req(url, "/v1/write", "POST", { ...input, requestId: "down-3" }, jwt)).status, 200);
    assert.equal(calls, 1);

    // 한도 조회(/v1/me)가 실패해도 503 이다.
    sb.failGet = true;
    await errorOf(await req(url, "/v1/me", "GET", undefined, jwt), 503, "usage_store_failed");
  }, { env: { ACCOUNT_CONCURRENCY: "1" }, setup: sb => { sb.other = async () => { calls++; return provider(); }; } });
});

test("no lecture content or bare hash reaches Supabase from any route and digests are keyed HMACs", async () => {
  await withSupabase(async ({ url, sb }) => {
    const jwt = ec1(), items = judgeBody({ requestId: "leak-judge" }).items;
    sb.other = async (u, o) => {
      if (u.includes("audio/transcriptions")) return { ok: true, json: async () => maiRaw() };
      const b = JSON.parse(o.body), schemaName = b.response_format?.json_schema?.name;
      if (b.logprobs) return judgeReply();
      if (schemaName === "slide_doc") return slideProvider();
      if (schemaName === "lecture_note_plan") return noteReply(notePlanner);
      if (schemaName === "lecture_note_section") return noteReply(s1Out);
      if (schemaName === "lecture_note_repair") return noteReply(repairOut);
      return provider();
    };
    const repairReq = repairIn({ requestId: "leak-repair" });
    const calls = [
      ["/v1/write", repairReq], ["/v1/plan", planIn({ requestId: "leak-plan" })], ["/v1/write", sectionIn({ requestId: "leak-write" })],
      ["/v1/vision", visionBody({ requestId: "leak-vision" })], ["/v1/stt", sttBody({ requestId: "leak-stt" })], ["/v1/judge", judgeBody({ requestId: "leak-judge" })],
    ];
    for (const [route, body] of calls) assert.equal((await req(url, route, "POST", body, jwt)).status, 200, route);
    const reserves = sb.rpcNamed("reserve_usage"), digests = reserves.map(r => r.args.p_digest);
    assert.equal(reserves.length, 6);
    assert.equal(new Set(digests).size, 6);
    for (const d of digests) assert.match(d, /^[a-f0-9]{64}$/);
    assert.equal(reserves[0].args.p_digest, hmac256(noteDigest(repairReq)));
    const judgeCanonical = JSON.stringify({ route: "judge", task: "utterance", model: judgeModel, items });
    assert.equal(reserves[5].args.p_digest, hmac256(judgeCanonical));
    assert.notEqual(reserves[5].args.p_digest, sha256(judgeCanonical));
    assert.deepEqual(sb.rpcNamed("settle_usage").map(r => r.args.p_stage), ["write.repair", "plan", "write.section", "vision.full", "stt", "judge.utterance"]);
    assert.equal(settledOf(sb, 3).p_images, 1);
    assert.equal(settledOf(sb, 4).p_audio_seconds, 60);

    const wire = JSON.stringify([sb.rpcs, sb.upserts, sb.gets, sb.calls.map(c => c.url)]);
    for (const secret of ["원가는 생산량에 어떻게 반응하는가", "고정비", "공헌이익", "손익분기", "미분은 순간 변화율이다", "앞뒤 문맥 단서", "강의 전사", "BwcH", "생산량과 관계없이 일정 기간 동안 발생하는 비용", DIGEST_KEY, JWT_SECRET, ec1().slice(0, 40)])
      assert.ok(!wire.includes(secret), "Supabase 로 나간 본문에 있으면 안 된다: " + secret);
    // 메타데이터 칸은 usage_events 의 CHECK 와 같은 모양이거나 null 이다. 호스트와 job id 는 보내지 않는다.
    for (const { args } of sb.rpcNamed("settle_usage")) {
      assert.equal(args.p_host, null);
      assert.equal(Object.hasOwn(args, "p_job_id"), false);
      for (const [k, v] of Object.entries(args)) if (typeof v === "string" && !["p_user", "p_request_id"].includes(k)) assert.match(v, /^[A-Za-z0-9][A-Za-z0-9_./:@-]*$/, k);
    }
  }, { setup: sb => { sb.plan = "essential"; }, env: { ACCOUNT_RATE_PER_MIN: "1000" } });
});

test("client-chosen metadata that would violate the ledger CHECKs is dropped instead of failing the settlement", async () => {
  await withSupabase(async ({ url, sb }) => {
    for (const [i, v] of ["9.9.9; drop table usage_events", "1.2.3/../x", "v".repeat(40), "1.2.3"].entries()) {
      assert.equal((await req(url, "/v1/write", "POST", { ...input, requestId: "meta-" + i }, ec1(), origin, { "x-client-version": v })).status, 200);
    }
    assert.deepEqual(sb.rpcNamed("settle_usage").map(r => r.args.p_client_version), [null, null, null, "1.2.3"]);
  });
});

test("the DB plan decides features and models, closed by default, and is cached for 30 seconds", async () => {
  const haiku = "anthropic/claude-haiku-4.5";
  let provided = 0;
  await withSupabase(async ({ url, sb, clock }) => {
    const jwt = ec1(), me = async () => (await req(url, "/v1/me", "GET", undefined, jwt)).json();
    // free: 기능 없음, lite 요약 모델만. 막힌 요청은 예약도 제공자 호출도 만들지 않는다.
    let m = await me();
    assert.equal(m.plan, "free");
    assert.deepEqual(m.features, []);
    assert.deepEqual(m.models, [model]);
    for (const [route, body] of [["/v1/vision", visionBody({ requestId: "p-v" })], ["/v1/stt", sttBody({ requestId: "p-s" })], ["/v1/judge", judgeBody({ requestId: "p-j" })]])
      await errorOf(await req(url, route, "POST", body, jwt), 403, "feature_not_in_account_plan");
    await errorOf(await req(url, "/v1/write", "POST", sectionIn({ requestId: "p-w", model: haiku }), jwt), 403, "model_not_in_account_plan");
    assert.equal(sb.rpcNamed("reserve_usage").length, 0);
    assert.equal(provided, 0);
    assert.equal((await req(url, "/v1/plan", "POST", planIn({ requestId: "p-plan" }), jwt)).status, 200, "plan/write 는 free 도 쓴다");
    assert.equal(provided, 1);

    // 등급 조회는 사용자별 30초 캐시이고 /v1/me 만 새로 읽는다. 업그레이드는 /v1/me 로 즉시 보인다.
    const calls = sb.planCalls;
    sb.plan = "essential";
    await errorOf(await req(url, "/v1/judge", "POST", judgeBody({ requestId: "p-j2" }), jwt), 403, "feature_not_in_account_plan");
    assert.equal(sb.planCalls, calls, "연속 호출은 캐시를 쓴다");
    m = await me();
    assert.equal(sb.planCalls, calls + 1);
    assert.equal(m.plan, "essential");
    assert.deepEqual(m.features, ["vision", "stt", "judge", "background", "augment"]);
    assert.deepEqual(m.models, [model, haiku]);
    assert.equal((await req(url, "/v1/judge", "POST", judgeBody({ requestId: "p-j3" }), jwt)).status, 200, "/v1/me 가 캐시를 갱신했다");
    assert.equal(sb.planCalls, calls + 1);
    sb.plan = "free";
    assert.equal((await req(url, "/v1/judge", "POST", judgeBody({ requestId: "p-j4" }), jwt)).status, 200, "TTL 안에서는 이전 등급이다(한도는 DB가 매번 판정한다)");
    clock.t += 31000;
    await errorOf(await req(url, "/v1/judge", "POST", judgeBody({ requestId: "p-j5" }), jwt), 403, "feature_not_in_account_plan");
    assert.equal(sb.planCalls, calls + 2, "TTL 이 지나면 다시 읽는다");

    // 모르는 등급과 null 은 free 로 닫힌다.
    for (const plan of ["legacy", null]) {
      sb.plan = plan;
      m = await me();
      assert.equal(m.plan, plan);
      assert.deepEqual(m.features, []);
      assert.deepEqual(m.models, [model]);
    }
  }, {
    env: { ALLOWED_MODELS: JSON.stringify([model, haiku]), OPENROUTER_PROVIDERS_JSON: JSON.stringify({ [model]: ["test-provider"], [haiku]: ["test-provider"], [judgeModel]: ["test-provider"] }), ACCOUNT_RATE_PER_MIN: "1000" },
    setup: sb => { sb.other = async (_u, o) => { provided++; return JSON.parse(o.body).logprobs ? judgeReply() : noteReply(notePlanner); }; },
  });
});

test("PLAN_FEATURES_JSON overrides the defaults per plan", async () => {
  await withSupabase(async ({ url, sb }) => {
    const jwt = ec1();
    sb.plan = "pro";
    let m = await (await req(url, "/v1/me", "GET", undefined, jwt)).json();
    assert.deepEqual(m.features, ["vision"]);
    assert.equal((await req(url, "/v1/vision", "POST", visionBody({ requestId: "pro-v" }), jwt)).status, 200);
    await errorOf(await req(url, "/v1/stt", "POST", sttBody({ requestId: "pro-s" }), jwt), 403, "feature_not_in_account_plan");
    sb.plan = "free";
    m = await (await req(url, "/v1/me", "GET", undefined, jwt)).json();
    assert.deepEqual(m.features, ["judge"], "free 의 덮어쓴 기능");
    assert.deepEqual(m.models, [model]);
  }, { env: { PLAN_FEATURES_JSON: JSON.stringify({ free: { features: ["judge"] }, pro: { features: ["vision"] } }) }, setup: sb => { sb.other = async () => slideProvider(); } });
});

test("/v1/me for a JWT user returns plan, features, DB limits, remote config and version prechecks; the profile is upserted once", async () => {
  await withSupabase(async ({ url, sb }) => {
    const jwt = ec1(), month = new Date().toISOString().slice(0, 7);
    sb.rows.usage = { requests: 3, minutes: 7, cost_micros: 123456 };
    const res = await req(url, "/v1/me", "GET", undefined, jwt, origin, { "x-client-version": "1.0.0" });
    assert.equal(res.status, 200);
    const me = await res.json();
    assert.deepEqual(me, {
      accountId: UID, plan: "free", models: [model], features: [],
      routeModels: { vision: ["google/gemini-2.5-flash-lite"], stt: ["microsoft/mai-transcribe-2"], judge: ["openai/gpt-4.1-nano"] },
      config: { concurrency: { download: 4, decode: 1, stt: 4, vision: 8, judge: 2, write: 8 }, throughputMbps: 50, minClientVersion: "0.0.0", promptVersion: "v1", schemaVersion: 1 },
      noteSpecVersion: NoteContract.NOTE_SPEC_VERSION, promptVersion: Prompts.PROMPT_VERSION,
      quota: { month, requests: 3, maxRequests: 300, minutes: 7, maxMinutes: 600, spentCents: 12.3456, maxCents: 30 },
    });
    assert.notEqual(me.promptVersion, me.config.promptVersion, "plan/write 프롬프트 버전은 비전·판정용 원격 설정과 별개다");
    const [plans, usage] = sb.gets;
    assert.ok(plans.includes("/rest/v1/plans?") && plans.includes("plan=eq.free"));
    assert.ok(usage.includes("/rest/v1/monthly_usage?") && usage.includes("user_id=eq." + UID) && usage.includes("month=eq." + month + "-01"));

    for (let i = 0; i < 3; i++) assert.equal((await req(url, "/v1/me", "GET", undefined, jwt)).status, 200);
    assert.equal(sb.upserts.length, 1, "프로필 upsert 는 사용자당 한 번");
    const [up] = sb.upserts;
    assert.equal(up.search, "?on_conflict=user_id");
    assert.deepEqual(up.body, { user_id: UID });
    assert.equal(up.headers.prefer, "resolution=ignore-duplicates,return=minimal", "이미 있는 프로필(등급)을 덮어쓰지 않는다");
    assert.equal(up.headers.apikey, SERVICE_KEY);
    assert.equal(up.headers.authorization, "Bearer " + SERVICE_KEY);
    await req(url, "/v1/me", "GET", undefined, ec1({ claims: { sub: UID2 } }));
    assert.equal(sb.upserts.length, 2, "다른 사용자는 따로 한 번");
    assert.equal(sb.upserts[1].body.user_id, UID2);

    // 한도가 없는 상한(null)은 그대로 null, 상한 줄이 없는 등급은 maxCents 0 으로 닫힌다. 사용 기록이 없으면 0 이다.
    sb.rows.usage = null;
    sb.plan = "essential";
    let q = (await (await req(url, "/v1/me", "GET", undefined, jwt)).json()).quota;
    assert.deepEqual(q, { month, requests: 0, maxRequests: null, minutes: 0, maxMinutes: 6000, spentCents: 0, maxCents: 1500 });
    sb.plan = "legacy";
    q = (await (await req(url, "/v1/me", "GET", undefined, jwt)).json()).quota;
    assert.equal(q.maxCents, 0);
    const reads = sb.gets.length;
    sb.plan = null;
    q = (await (await req(url, "/v1/me", "GET", undefined, jwt)).json()).quota;
    assert.equal(q.maxCents, 0);
    assert.equal(sb.gets.length - reads, 1, "등급이 없으면 plans 조회는 건너뛰고 사용량만 읽는다");
    // 전역 스위치는 등급과 무관하게 기능을 가린다.
    sb.plan = "essential";
    assert.deepEqual((await (await req(url, "/v1/me", "GET", undefined, jwt)).json()).features, ["vision", "stt", "background", "augment"]);
  }, { env: { FEATURE_FLAGS_JSON: JSON.stringify({ judge: false }) } });
});

test("a failed profile upsert never blocks /v1/me and is retried until it succeeds", async () => {
  await withSupabase(async ({ url, sb }) => {
    const jwt = ec1();
    sb.upsertOk = false;
    assert.equal((await req(url, "/v1/me", "GET", undefined, jwt)).status, 200, "프로필이 없어도 effective_plan 은 free 로 읽힌다");
    assert.equal((await req(url, "/v1/me", "GET", undefined, jwt)).status, 200);
    assert.equal(sb.upserts.length, 2, "성공할 때까지 다음 /v1/me 가 다시 시도한다");
    sb.upsertOk = true;
    await req(url, "/v1/me", "GET", undefined, jwt);
    await req(url, "/v1/me", "GET", undefined, jwt);
    assert.equal(sb.upserts.length, 3);
    // 장부를 쓰는 라우트는 프로필을 만들지 않는다(/v1/me 만으로 충분하다).
    await req(url, "/v1/write", "POST", { ...input, requestId: "no-profile" }, ec1({ claims: { sub: UID2 } }));
    assert.equal(sb.upserts.length, 3);
  });
});

// ── JWT 계정의 보관함 (Storage + vault_objects, server/vault-store.js) ──
// 가짜 Supabase 가 Storage 와 vault_objects(schema-v2.sql 의 CHECK·UNIQUE 포함)를 함께 흉내 낸다.
const PASS = "testing-password-123", MIB = 1024 * 1024;
const vaultEnvelope = (account, objectId, evidence = "private synthetic vault") => Vault.encrypt({ evidence, summary: null }, PASS, { accountId: account, objectId, kind: "session" });
const vaultReq = (url, id, method, envelope, t) => req(url, "/v1/vault" + (id ? "/" + id : ""), method, envelope === undefined ? undefined : { envelope }, t);
const vaultRow = (user, id, size) => ({ user_id: user, object_id: id, size, storage_path: user + "/" + id, updated_at: new Date().toISOString() });
const rowCalls = (sb, method) => sb.calls.filter(c => c.url.includes("/rest/v1/vault_objects") && c.method === method);

test("JWT vault round trip keeps ciphertext in Storage and metadata in vault_objects, never on disk", async () => {
  await withSupabase(async ({ url, root, sb }) => {
    const jwt = ec1(), ctx = { accountId: UID, objectId: "object-one", kind: "session" }, key = "vault/" + UID + "/object-one", row = () => sb.rows.vault.get(UID + ":object-one");
    const e1 = await vaultEnvelope(UID, "object-one", "first"), e2 = await vaultEnvelope(UID, "object-one", "second");
    let res = await vaultReq(url, "object-one", "PUT", e1, jwt);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { objectId: "object-one", saved: true });
    // 올라간 것은 검증을 통과한 envelope JSON 그대로이고, 경로는 <버킷>/<user_id>/<object_id> 다(storage_path 의 CHECK 가 '.' 을 막아 확장자가 없다).
    assert.deepEqual([...sb.objects.keys()], [key]);
    assert.equal(sb.objects.get(key), JSON.stringify(e1));
    assert.deepEqual(Object.keys(JSON.parse(sb.objects.get(key))).sort(), ["aad", "alg", "ciphertext", "context", "iv", "kdf", "salt", "version"]);
    assert.ok(!sb.objects.get(key).includes(PASS) && !sb.objects.get(key).includes("first"));
    const upload = sb.storageCalls.find(c => c.method === "POST");
    assert.equal(upload.headers["x-upsert"], "true");
    assert.deepEqual(Object.keys(row()).sort(), ["object_id", "size", "storage_path", "updated_at", "user_id"]);
    assert.equal(row().storage_path, UID + "/object-one");
    assert.equal(row().size, Buffer.byteLength(JSON.stringify(e1)));
    assert.ok(Number.isFinite(Date.parse(row().updated_at)));

    assert.deepEqual(await (await vaultReq(url, "", "GET", undefined, jwt)).json(), { items: [{ objectId: "object-one" }] });
    const got = await (await vaultReq(url, "object-one", "GET", undefined, jwt)).json();
    assert.equal(got.objectId, "object-one");
    assert.equal((await Vault.decrypt(got.envelope, PASS, ctx)).evidence, "first");
    await errorOf(await vaultReq(url, "missing", "GET", undefined, jwt), 404, "not_found");

    // 같은 id 로 다시 쓰면 덮어쓴다: 객체도 행도 하나고 크기가 바뀐다.
    assert.equal((await vaultReq(url, "object-one", "PUT", e2, jwt)).status, 200);
    assert.equal(sb.objects.size, 1);
    assert.equal(sb.rows.vault.size, 1);
    assert.equal(row().size, Buffer.byteLength(JSON.stringify(e2)));
    assert.equal((await Vault.decrypt((await (await vaultReq(url, "object-one", "GET", undefined, jwt)).json()).envelope, PASS, ctx)).evidence, "second");

    // 큰 envelope(16 MiB 평문 한도 근처)도 읽는다: Supabase 응답 기본 상한(256 KiB)을 보관함 다운로드만 24 MiB 로 올렸다.
    sb.objects.set("vault/" + UID + "/big", JSON.stringify({ ...e1, ciphertext: "A".repeat(300 * 1024) }));
    sb.rows.vault.set(UID + ":big", vaultRow(UID, "big", 300 * 1024));
    const big = await vaultReq(url, "big", "GET", undefined, jwt);
    assert.equal(big.status, 200);
    assert.equal((await big.json()).envelope.ciphertext.length, 300 * 1024);

    for (const id of ["object-one", "big"]) {
      res = await vaultReq(url, id, "DELETE", undefined, jwt);
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { deleted: true });
    }
    assert.equal(sb.objects.size, 0);
    assert.equal(sb.rows.vault.size, 0);
    await errorOf(await vaultReq(url, "object-one", "GET", undefined, jwt), 404, "not_found");
    assert.deepEqual(await (await vaultReq(url, "", "GET", undefined, jwt)).json(), { items: [] });
    res = await vaultReq(url, "object-one", "DELETE", undefined, jwt);
    assert.deepEqual(await res.json(), { deleted: true }, "없는 항목을 지워도 디스크 경로처럼 성공이다");

    // 검증은 디스크 경로와 같고, 거절된 요청은 Storage 에도 표에도 닿지 않는다.
    const before = sb.calls.length;
    await errorOf(await vaultReq(url, "object-two", "PUT", e2, jwt), 400, "request_rejected");
    await errorOf(await req(url, "/v1/vault/object-one", "PUT", { envelope: e1, plaintext: "not allowed" }, jwt), 400, "unexpected_field");
    await errorOf(await vaultReq(url, "object-one", "PUT", await vaultEnvelope("A", "object-one"), jwt), 400, "request_rejected");
    await errorOf(await vaultReq(url, "object-one", "PATCH", e1, jwt), 404, "not_found");
    assert.equal(sb.calls.length, before);

    assert.ok(!fs.existsSync(path.join(root, "vault")), "JWT 계정은 디스크에 아무것도 만들지 않는다");
    assert.equal(sb.rpcs.length, 0, "보관함은 등급·장부와 무관하다");
    for (const c of sb.calls) {
      assert.equal(c.headers.apikey, SERVICE_KEY);
      assert.equal(c.headers.authorization, "Bearer " + SERVICE_KEY);
      assert.equal(c.redirect, "error");
      assert.ok(c.bounded, "시간 제한이 걸린다");
    }
  });
});

test("JWT vault enforces the file and byte limits from the vault_objects rows before uploading", async () => {
  await withSupabase(async ({ url, sb }) => {
    const jwt = ec1(), seed = (user, id, size) => sb.rows.vault.set(user + ":" + id, vaultRow(user, id, size));
    const fresh = await vaultEnvelope(UID, "object-new"), extra = await vaultEnvelope(UID, "object-extra"), mine = await vaultEnvelope(UID, "obj-0");
    const size = Buffer.byteLength(JSON.stringify(fresh)), uploads = () => sb.storageCalls.filter(c => c.method === "POST").length;

    // 개수: 계정당 100개. 다른 사용자의 행은 세지 않고, 이미 있는 항목을 덮어쓰는 것은 개수에 걸리지 않는다.
    for (let i = 0; i < 99; i++) seed(UID, "obj-" + i, 10);
    for (let i = 0; i < 50; i++) seed(UID2, "theirs-" + i, 10);
    assert.equal((await vaultReq(url, "object-new", "PUT", fresh, jwt)).status, 200, "100번째는 들어간다");
    assert.equal(uploads(), 1);
    await errorOf(await vaultReq(url, "object-extra", "PUT", extra, jwt), 413, "archive_quota_exceeded");
    assert.equal(uploads(), 1, "거절된 요청은 아무것도 올리지 않는다");
    assert.ok(!sb.rows.vault.has(UID + ":object-extra"));
    assert.equal((await vaultReq(url, "obj-0", "PUT", mine, jwt)).status, 200, "덮어쓰기는 개수에 걸리지 않는다");
    assert.equal(uploads(), 2);
    assert.equal((await vaultReq(url, "", "GET", undefined, jwt).then(r => r.json())).items.length, 100);

    // 용량: 계정당 200 MiB. 한도에 정확히 맞으면 통과하고 1바이트 넘으면 거절한다. 덮어쓸 때는 자기 크기를 뺀다.
    sb.rows.vault.clear();
    seed(UID, "big", 200 * MIB - size + 1);
    await errorOf(await vaultReq(url, "object-new", "PUT", fresh, jwt), 413, "archive_quota_exceeded");
    seed(UID, "big", 200 * MIB - size);
    assert.equal((await vaultReq(url, "object-new", "PUT", fresh, jwt)).status, 200);
    seed(UID, "object-new", 200 * MIB);
    seed(UID2, "theirs", 200 * MIB);
    assert.equal((await vaultReq(url, "object-new", "PUT", fresh, jwt)).status, 200, "자기 자신의 이전 크기는 빠진다");
    assert.equal(sb.rows.vault.get(UID + ":object-new").size, size);
    assert.equal(uploads(), 4);
  });
});

test("a Storage failure leaves vault_objects untouched, and a failed row write leaves only an unlisted object that a retry heals", async () => {
  await withSupabase(async ({ url, sb }) => {
    const jwt = ec1(), e1 = await vaultEnvelope(UID, "object-one", "first"), e2 = await vaultEnvelope(UID, "object-one", "second"), e3 = await vaultEnvelope(UID, "object-two");
    const listed = async () => (await (await vaultReq(url, "", "GET", undefined, jwt)).json()).items.map(i => i.objectId);

    // PUT 은 Storage 먼저다. 업로드가 실패하면 표에는 쓰지 않는다(행 쓰기를 시도조차 하지 않는다).
    sb.failStorage.POST = true;
    const err = await errorOf(await vaultReq(url, "object-one", "PUT", e1, jwt), 503, "vault_store_failed");
    assert.equal(err.retryable, true);
    assert.equal(sb.rows.vault.size, 0);
    assert.equal(sb.objects.size, 0);
    assert.equal(rowCalls(sb, "POST").length, 0);
    assert.deepEqual(await listed(), []);

    // 덮어쓰기가 실패해도 이전 행과 이전 객체가 그대로다.
    sb.failStorage.POST = false;
    assert.equal((await vaultReq(url, "object-one", "PUT", e1, jwt)).status, 200);
    const oldSize = sb.rows.vault.get(UID + ":object-one").size;
    sb.failStorage.POST = true;
    await errorOf(await vaultReq(url, "object-one", "PUT", e2, jwt), 503, "vault_store_failed");
    assert.equal(sb.rows.vault.get(UID + ":object-one").size, oldSize);
    assert.equal(sb.objects.get("vault/" + UID + "/object-one"), JSON.stringify(e1));
    sb.failStorage.POST = false;

    // 업로드 뒤 행 쓰기가 실패하면 객체만 남는다: 목록·읽기·용량에는 없고, 같은 id 의 PUT 을 다시 보내면 정상이 된다.
    sb.failRows.POST = true;
    await errorOf(await vaultReq(url, "object-two", "PUT", e3, jwt), 503, "vault_store_failed");
    assert.ok(sb.objects.has("vault/" + UID + "/object-two"));
    assert.ok(!sb.rows.vault.has(UID + ":object-two"));
    assert.deepEqual(await listed(), ["object-one"]);
    await errorOf(await vaultReq(url, "object-two", "GET", undefined, jwt), 404, "not_found");
    sb.failRows.POST = false;
    assert.equal((await vaultReq(url, "object-two", "PUT", e3, jwt)).status, 200);
    assert.deepEqual((await listed()).sort(), ["object-one", "object-two"]);
    assert.equal(sb.objects.size, 2);

    // DELETE 도 Storage 먼저다. 실패하면 행이 남아 목록에서 다시 지울 수 있다.
    sb.failStorage.DELETE = true;
    await errorOf(await vaultReq(url, "object-one", "DELETE", undefined, jwt), 503, "vault_store_failed");
    assert.ok(sb.rows.vault.has(UID + ":object-one"));
    assert.ok(sb.objects.has("vault/" + UID + "/object-one"));
    assert.deepEqual((await listed()).sort(), ["object-one", "object-two"]);
    sb.failStorage.DELETE = false;
    assert.equal((await vaultReq(url, "object-one", "DELETE", undefined, jwt)).status, 200);
    assert.deepEqual(await listed(), ["object-two"]);

    // Storage 삭제 뒤 행 삭제가 실패하면 행만 남는다. 읽기는 503 이고(Storage 오류를 없음으로 읽지 않는다) 재시도가 행을 치운다.
    sb.failRows.DELETE = true;
    await errorOf(await vaultReq(url, "object-two", "DELETE", undefined, jwt), 503, "vault_store_failed");
    assert.equal(sb.objects.size, 0);
    assert.ok(sb.rows.vault.has(UID + ":object-two"));
    await errorOf(await vaultReq(url, "object-two", "GET", undefined, jwt), 503, "vault_store_failed");
    sb.failRows.DELETE = false;
    assert.equal((await vaultReq(url, "object-two", "DELETE", undefined, jwt)).status, 200);
    assert.deepEqual(await listed(), []);

    // 읽기·목록도 저장소가 닫히면 503 이다.
    sb.failRows.GET = true;
    await errorOf(await vaultReq(url, "", "GET", undefined, jwt), 503, "vault_store_failed");
    await errorOf(await vaultReq(url, "object-one", "GET", undefined, jwt), 503, "vault_store_failed");
    sb.failRows.GET = false;
    sb.down = true;
    await errorOf(await vaultReq(url, "", "GET", undefined, jwt), 503, "vault_store_failed");
    await errorOf(await vaultReq(url, "object-one", "PUT", e1, jwt), 503, "vault_store_failed");
  });
});

test("static-token accounts keep the disk vault even when Supabase is configured", async () => {
  await withSupabase(async ({ url, root, sb }) => {
    const e = await vaultEnvelope("A", "object-one"), file = path.join(root, "vault", "A", "object-one.json");
    assert.equal((await vaultReq(url, "object-one", "PUT", e)).status, 200);
    assert.equal(fs.readFileSync(file, "utf8"), JSON.stringify(e));
    assert.deepEqual(await (await vaultReq(url, "", "GET")).json(), { items: [{ objectId: "object-one" }] });
    assert.equal((await Vault.decrypt((await (await vaultReq(url, "object-one", "GET")).json()).envelope, PASS, { accountId: "A", objectId: "object-one", kind: "session" })).evidence, "private synthetic vault");
    assert.equal(sb.calls.length, 0, "정적 계정은 Supabase 에 아무것도 보내지 않는다");
    assert.equal(sb.objects.size + sb.rows.vault.size, 0);

    // 같은 id 의 JWT 사용자는 완전히 따로다: 디스크 파일은 그대로고, JWT 쪽 데이터는 Storage 에만 있다.
    const mine = await vaultEnvelope(UID, "object-one", "jwt only");
    assert.equal((await vaultReq(url, "object-one", "PUT", mine, ec1())).status, 200);
    assert.equal(fs.readFileSync(file, "utf8"), JSON.stringify(e));
    assert.deepEqual(fs.readdirSync(path.join(root, "vault")), ["A"]);
    assert.deepEqual([...sb.objects.keys()], ["vault/" + UID + "/object-one"]);

    assert.equal((await vaultReq(url, "object-one", "DELETE")).status, 200);
    assert.ok(!fs.existsSync(file));
    assert.ok(sb.objects.has("vault/" + UID + "/object-one"), "정적 계정의 삭제가 JWT 사용자의 객체를 건드리지 않는다");
  });
});

test("JWT vault paths carry the user id, so one user can never reach another's object", async () => {
  await withSupabase(async ({ url, sb }) => {
    const a = ec1(), b = ec1({ claims: { sub: UID2 } }), ea = await vaultEnvelope(UID, "object-one", "alice"), eb = await vaultEnvelope(UID2, "object-one", "bob");
    assert.equal((await vaultReq(url, "object-one", "PUT", ea, a)).status, 200);

    // B 는 같은 id 로 A 의 항목을 읽지도, 목록에서 보지도, 지우지도 못한다.
    await errorOf(await vaultReq(url, "object-one", "GET", undefined, b), 404, "not_found");
    assert.deepEqual(await (await vaultReq(url, "", "GET", undefined, b)).json(), { items: [] });
    assert.equal((await vaultReq(url, "object-one", "DELETE", undefined, b)).status, 200);
    assert.equal(sb.objects.get("vault/" + UID + "/object-one"), JSON.stringify(ea));
    assert.ok(sb.rows.vault.has(UID + ":object-one"));

    // A 의 암호문을 B 의 이름으로 쓰려 해도 문맥(accountId)이 달라 거절되고, B 가 자기 것을 쓰면 경로가 따로다.
    await errorOf(await vaultReq(url, "object-one", "PUT", ea, b), 400, "request_rejected");
    assert.equal((await vaultReq(url, "object-one", "PUT", eb, b)).status, 200);
    assert.deepEqual([...sb.objects.keys()].sort(), ["vault/" + UID + "/object-one", "vault/" + UID2 + "/object-one"].sort());
    assert.equal((await Vault.decrypt((await (await vaultReq(url, "object-one", "GET", undefined, a)).json()).envelope, PASS, { accountId: UID, objectId: "object-one", kind: "session" })).evidence, "alice");
    assert.equal((await Vault.decrypt((await (await vaultReq(url, "object-one", "GET", undefined, b)).json()).envelope, PASS, { accountId: UID2, objectId: "object-one", kind: "session" })).evidence, "bob");
    // 정적 계정도 JWT 사용자의 객체를 보지 못한다(디스크만 본다).
    await errorOf(await vaultReq(url, "object-one", "GET"), 404, "not_found");

    // 경로를 바꾸는 id 는 라우트에서 걸러져 Storage 까지 가지 않는다.
    const before = sb.storageCalls.length;
    for (const id of ["a%2Fb", "..%2F" + UID2 + "%2Fobject-one", "a.b", "a%00b"]) await errorOf(await vaultReq(url, id, "GET", undefined, a), 404, "not_found");
    assert.equal(sb.storageCalls.length, before);
    // 모든 Storage 호출의 경로는 그 요청의 토큰 sub 로 시작했다. 사용자 id 는 요청 본문·경로에서 받지 않는다.
    for (const c of sb.storageCalls) assert.match(c.key, c.method === "DELETE" ? /^vault$/ : new RegExp("^vault/(" + UID + "|" + UID2 + ")/object-one$"));
    for (const c of sb.storageCalls.filter(c => c.method === "DELETE")) assert.match(c.body, new RegExp('^\\{"prefixes":\\["(' + UID + "|" + UID2 + ')/object-one"\\]\\}$'));
  });
});

test("the service-role key and Supabase internals never appear in a vault response", async () => {
  await withSupabase(async ({ url, sb }) => {
    const jwt = ec1(), e = await vaultEnvelope(UID, "object-one"), seen = [];
    const call = async (id, method, envelope) => { const res = await vaultReq(url, id, method, envelope, jwt); seen.push(JSON.stringify([...res.headers]) + await res.text()); return res.status; };
    assert.equal(await call("object-one", "PUT", e), 200);
    assert.equal(await call("object-one", "GET"), 200);
    assert.equal(await call("", "GET"), 200);
    assert.equal(await call("missing", "GET"), 404);
    assert.equal(await call("object-one", "DELETE"), 200);
    sb.failStorage = { POST: true, GET: true, DELETE: true };
    assert.equal(await call("object-one", "PUT", e), 503);
    assert.equal(await call("object-one", "DELETE"), 503);
    sb.down = true;
    assert.equal(await call("", "GET"), 503);
    assert.equal(seen.length, 8);
    for (const secret of [SERVICE_KEY, DIGEST_KEY, JWT_SECRET, SB, "supabase", "storage/v1", "rest/v1", "vault_objects"])
      assert.ok(!seen.join("\n").includes(secret), "응답에 있으면 안 된다: " + secret);
  });
});

test("VAULT_BUCKET picks the Storage bucket (default vault) and rejects names that could change the path", async () => {
  await withSupabase(async ({ url, sb }) => {
    assert.equal((await vaultReq(url, "object-one", "PUT", await vaultEnvelope(UID, "object-one"), ec1())).status, 200);
    assert.deepEqual([...sb.objects.keys()], ["lecture-vault/" + UID + "/object-one"]);
    assert.equal((await vaultReq(url, "object-one", "DELETE", undefined, ec1())).status, 200);
    assert.equal(JSON.parse(sb.storageCalls.at(-1).body).prefixes[0], UID + "/object-one");
    assert.equal(sb.storageCalls.at(-1).key, "lecture-vault");
  }, { env: { VAULT_BUCKET: "lecture-vault" } });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "summrizei-service-test-"));
  try {
    assert.equal(serverConfig(sbEnv(root)).supabase.bucket, "vault");
    assert.equal(serverConfig({ ...sbEnv(root), VAULT_BUCKET: "" }).supabase.bucket, "vault");
    for (const bad of ["a/b", "../x", "a b", "-x", "x".repeat(64), "a?b"])
      assert.throws(() => createServer({ ...sbEnv(root), VAULT_BUCKET: bad }), /invalid_vault_bucket/, bad);
  } finally { removeTemp(root); }
});

// ── 계정 삭제 (DELETE /v1/account: ① delete_account_data RPC → ② Storage 객체 → ③ auth 사용자) ──
const accountDel = (url, t, body) => req(url, "/v1/account", "DELETE", body, t);
// 가짜 Supabase 로 나간 호출을 단계 이름으로 줄인다: rows:GET(보관함 행 읽기), list(접두사 목록), storage:DELETE(일괄 삭제), rpc, admin(auth 사용자 삭제).
const stepOf = c => /\/storage\/v1\/object\/list\//.test(c.url) ? "list" : c.url.includes("/storage/v1/object/") ? "storage:" + c.method
  : c.url.includes("/rpc/") ? "rpc" : c.url.includes("/auth/v1/admin/") ? "admin" : "rows:" + c.method;
const FULL = ["rpc", "rows:GET", "list", "storage:DELETE", "admin"];
// 사용자마다 행 있는 객체 둘과 접두사 아래 행 없는 고아 하나. 경로는 "<user>/<id>" 다.
function seedAccount(sb, user) {
  for (const id of ["object-one", "object-two"]) { sb.objects.set("vault/" + user + "/" + id, "ciphertext-" + user + id); sb.rows.vault.set(user + ":" + id, vaultRow(user, id, 10)); }
  sb.objects.set("vault/" + user + "/orphan", "ciphertext-orphan");
}
const objectsOf = (sb, user) => [...sb.objects.keys()].filter(k => k.startsWith("vault/" + user + "/")).sort();
const rowsOf = (sb, user) => [...sb.rows.vault.values()].filter(r => r.user_id === user).length;

test("DELETE /v1/account runs the data RPC, then removes Storage objects (row paths and orphans), then the auth user, and only the caller's", async () => {
  await withSupabase(async ({ url, sb }) => {
    seedAccount(sb, UID); seedAccount(sb, UID2);
    sb.objects.set("vault/" + UID + "-other/file", "not an object of this user"); // 접두사 "<user>/" 의 슬래시 없이는 걸릴 이름
    // 본문에 다른 사용자를 적어도 대상은 토큰의 sub 뿐이다.
    const res = await accountDel(url, ec1(), { user: UID2, userId: UID2, user_id: UID2 });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { deleted: true });
    assert.deepEqual(sb.calls.map(stepOf), FULL, "순서: RPC → Storage → auth 사용자");

    // ② 행을 읽고(① 이 이미 지웠다), 접두사 "<user>/" 를 목록으로 읽은 뒤, 찾은 객체를 한꺼번에 지운다.
    assert.equal(new URL(sb.calls[1].url).searchParams.get("user_id"), "eq." + UID);
    const list = sb.storageCalls.find(c => c.key === "list/vault"), del = sb.storageCalls.find(c => c.method === "DELETE");
    assert.deepEqual(JSON.parse(list.body), { prefix: UID + "/", limit: 100, offset: 0, sortBy: { column: "name", order: "asc" } });
    assert.equal(del.key, "vault");
    assert.deepEqual(JSON.parse(del.body).prefixes.sort(), ["object-one", "object-two", "orphan"].map(x => UID + "/" + x));
    // ① RPC 인자는 사용자 id 하나, ③ 은 그 사용자의 admin 삭제다.
    assert.deepEqual(sb.rpcNamed("delete_account_data").map(r => r.args), [{ p_user: UID }]);
    const admin = sb.calls[4];
    assert.equal(admin.url, SB + "/auth/v1/admin/users/" + UID);
    assert.equal(admin.method, "DELETE");

    // 결과: 그 사용자의 객체·행·auth 사용자는 없고, 다른 사용자(와 이름만 비슷한 경로)는 그대로다.
    assert.deepEqual(objectsOf(sb, UID), []);
    assert.equal(rowsOf(sb, UID), 0);
    assert.ok(!sb.authUsers.has(UID));
    assert.deepEqual(objectsOf(sb, UID2), ["object-one", "object-two", "orphan"].map(x => "vault/" + UID2 + "/" + x));
    assert.equal(rowsOf(sb, UID2), 2);
    assert.ok(sb.authUsers.has(UID2));
    assert.ok(sb.objects.has("vault/" + UID + "-other/file"));
    // 모든 호출은 서비스 롤 키로, 리다이렉트 금지·시간 제한이 걸려 나갔다. 보관함처럼 등급·장부는 건드리지 않는다.
    for (const c of sb.calls) { assert.equal(c.headers.apikey, SERVICE_KEY); assert.equal(c.headers.authorization, "Bearer " + SERVICE_KEY); assert.equal(c.redirect, "error"); assert.ok(c.bounded); }
    assert.deepEqual(sb.rpcs.map(r => r.rpc), ["delete_account_data"]);
  });
});

test("DELETE /v1/account never deletes a path outside the caller's prefix, even if a row points there", async () => {
  await withSupabase(async ({ url, sb }) => {
    seedAccount(sb, UID); seedAccount(sb, UID2);
    sb.rows.vault.set(UID + ":stray", { ...vaultRow(UID, "stray", 10), storage_path: UID2 + "/object-one" }); // 잘못 들어간 행
    assert.equal((await accountDel(url, ec1())).status, 200);
    assert.ok(sb.objects.has("vault/" + UID2 + "/object-one"), "다른 사용자의 객체는 남는다");
    assert.deepEqual(objectsOf(sb, UID), []);
  });
});

test("DELETE /v1/account also removes orphans under the user's prefix, across list pages and delete chunks", async () => {
  await withSupabase(async ({ url, sb }) => {
    seedAccount(sb, UID); seedAccount(sb, UID2);
    for (let i = 0; i < 250; i++) sb.objects.set("vault/" + UID + "/orphan-" + String(i).padStart(3, "0"), "x");
    sb.objects.set("vault/" + UID + "/folder/nested", "x"); // 하위 폴더: 목록에는 폴더 항목(id null)으로만 보인다 — 서버는 평면 경로만 만든다
    assert.equal((await accountDel(url, ec1())).status, 200);
    // 목록 항목 254개(고아 250 + 시드 3 + 폴더 항목 1; 행 경로 둘은 목록과 겹친다) → 100개씩 3쪽, 지울 경로도 254개 → 100개씩 3번.
    const pages = sb.storageCalls.filter(c => c.key === "list/vault").map(c => JSON.parse(c.body).offset);
    assert.deepEqual(pages, [0, 100, 200]);
    const deletes = sb.storageCalls.filter(c => c.method === "DELETE").map(c => JSON.parse(c.body).prefixes.length);
    assert.deepEqual(deletes, [100, 100, 54]);
    assert.deepEqual(objectsOf(sb, UID), ["vault/" + UID + "/folder/nested"], "행 없는 고아는 모두 사라졌다. 하위 폴더 안은 따라가지 않는다(ponytail 한계)");
    assert.equal(objectsOf(sb, UID2).length, 3, "다른 사용자의 객체는 그대로");
    assert.equal(rowsOf(sb, UID2), 2);
  });
});

test("DELETE /v1/account fails closed instead of looping or silently skipping when the prefix holds more than 10000 entries", async () => {
  await withSupabase(async ({ url, sb }) => {
    seedAccount(sb, UID);
    for (let i = 0; i < 10100; i++) sb.objects.set("vault/" + UID + "/orphan-" + i, "x");
    await errorOf(await accountDel(url, ec1()), 503, "account_delete_failed");
    assert.equal(sb.storageCalls.filter(c => c.key === "list/vault").length, 100, "쪽 수에 상한이 있다");
    assert.equal(sb.storageCalls.filter(c => c.method === "DELETE").length, 0, "일부만 지우고 성공하지 않는다");
    assert.equal(sb.calls.filter(c => c.url.includes("/auth/v1/admin/")).length, 0, "auth 사용자는 남는다(재시도로 이어 지운다)");
    assert.equal(objectsOf(sb, UID).length, 10103);
  });
});

test("a failure at any step answers 503 account_delete_failed, leaves later steps uncalled, and a retry finishes the job", async () => {
  // [단계, 실패 스위치, 부른 단계, 실패 직후 남은 UID 객체 수·행 수]
  const stages = [
    ["the data RPC", sb => { sb.failRpc.delete_account_data = 1; }, FULL.slice(0, 1), 3, 2],
    ["reading the vault rows", sb => { sb.failRows.GET = true; }, FULL.slice(0, 2), 3, 0],
    ["listing the prefix", sb => { sb.failStorage.LIST = true; }, FULL.slice(0, 3), 3, 0],
    ["deleting the objects", sb => { sb.failStorage.DELETE = true; }, FULL.slice(0, 4), 3, 0],
    ["deleting the auth user", sb => { sb.failAdmin = true; }, FULL, 0, 0],
  ];
  for (const [stage, fail, called, objects, rows] of stages) {
    await withSupabase(async ({ url, sb }) => {
      seedAccount(sb, UID); seedAccount(sb, UID2);
      fail(sb);
      const err = await errorOf(await accountDel(url, ec1()), 503, "account_delete_failed");
      assert.equal(err.retryable, true, stage);
      assert.deepEqual(sb.calls.map(stepOf), called, stage + ": 뒤 단계는 부르지 않는다");
      assert.equal(objectsOf(sb, UID).length, objects, stage);
      assert.equal(rowsOf(sb, UID), rows, stage);
      assert.ok(sb.authUsers.has(UID), stage + ": auth 사용자는 마지막까지 남는다");
      assert.equal(objectsOf(sb, UID2).length + rowsOf(sb, UID2), 5, stage + ": 다른 사용자는 그대로");

      // 스위치를 풀고 같은 요청을 다시 보내면 남은 일을 마친다.
      sb.failRows = {}; sb.failStorage = {}; sb.failRpc = {}; sb.failAdmin = false;
      sb.calls.length = 0;
      const res = await accountDel(url, ec1());
      assert.equal(res.status, 200, stage + ": 재시도");
      assert.deepEqual(await res.json(), { deleted: true });
      assert.deepEqual(objectsOf(sb, UID), [], stage);
      assert.equal(rowsOf(sb, UID), 0, stage);
      assert.ok(!sb.authUsers.has(UID), stage);
      assert.equal(objectsOf(sb, UID2).length + rowsOf(sb, UID2), 5, stage);
    });
  }
  // 저장소가 통째로 닫혀도 같은 503 이다.
  await withSupabase(async ({ url, sb }) => {
    seedAccount(sb, UID);
    sb.down = true;
    await errorOf(await accountDel(url, ec1()), 503, "account_delete_failed");
    assert.equal(objectsOf(sb, UID).length, 3);
  });
});

test("DELETE /v1/account with an active payment subscription answers 409 and deletes nothing", async () => {
  await withSupabase(async ({ url, sb }) => {
    seedAccount(sb, UID);
    sb.activeSubscription = true;
    const err = await errorOf(await accountDel(url, ec1()), 409, "account_has_active_subscription");
    assert.equal(err.retryable, false);
    assert.deepEqual(sb.calls.map(stepOf), ["rpc"]);
    assert.equal(objectsOf(sb, UID).length, 3);
    assert.equal(rowsOf(sb, UID), 2);
    assert.ok(sb.authUsers.has(UID));
  });
});

test("DELETE /v1/account is idempotent: nothing left to delete is not an error, and an already-deleted auth user counts as done", async () => {
  await withSupabase(async ({ url, sb }) => {
    seedAccount(sb, UID);
    assert.equal((await accountDel(url, ec1())).status, 200);
    // 응답을 잃고 다시 보낸 경우: 행·객체가 없고 auth 사용자도 이미 없다(404). 토큰은 exp 까지 유효하다.
    sb.calls.length = 0;
    const again = await accountDel(url, ec1());
    assert.equal(again.status, 200);
    assert.deepEqual(await again.json(), { deleted: true });
    assert.deepEqual(sb.calls.map(stepOf), ["rpc", "rows:GET", "list", "admin"], "지울 것이 없으면 일괄 삭제(빈 prefixes 는 Storage 가 거절)를 부르지 않는다");
    // 404 가 아닌 admin 오류는 실패다.
    sb.failAdmin = true;
    await errorOf(await accountDel(url, ec1()), 503, "account_delete_failed");
  });
});

test("static-token accounts are refused without touching Supabase, and bad tokens never reach it", async () => {
  await withSupabase(async ({ url, root, sb }) => {
    const e = await vaultEnvelope("A", "object-one"), file = path.join(root, "vault", "A", "object-one.json");
    assert.equal((await vaultReq(url, "object-one", "PUT", e)).status, 200);
    const err = await errorOf(await accountDel(url, token), 403, "account_not_deletable");
    assert.equal(err.retryable, false);
    await errorOf(await accountDel(url, "bad-token"), 401, "unauthorized");
    await errorOf(await req(url, "/v1/account", "DELETE", undefined, ec1(), "https://evil.example"), 403, "origin_not_allowed");
    assert.equal(sb.calls.length, 0, "Supabase 호출 0건");
    assert.ok(fs.existsSync(file), "정적 계정의 보관함도 그대로");
    // 다른 메서드와 경로 변형은 라우트가 아니다.
    await errorOf(await req(url, "/v1/account", "GET", undefined, ec1()), 404, "not_found");
    await errorOf(await req(url, "/v1/account?user=" + UID2, "DELETE", undefined, ec1()), 404, "not_found");
    assert.equal(sb.calls.length, 0);
  });
  // Supabase 를 켜지 않은 배포에서도 같은 거절이다.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "summrizei-service-test-")), { server, url } = await listen(root, async () => provider());
  try { await errorOf(await accountDel(url, token), 403, "account_not_deletable"); } finally { await close(server); removeTemp(root); }
});

test("after a successful deletion the server keeps no cached plan, profile memo or rate bucket for that user", async () => {
  await withSupabase(async ({ url, sb }) => {
    const jwt = ec1(), other = ec1({ claims: { sub: UID2 } }), post = (id, t = jwt) => req(url, "/v1/write", "POST", { ...input, requestId: id }, t);
    await req(url, "/v1/me", "GET", undefined, jwt);
    await req(url, "/v1/me", "GET", undefined, other);
    assert.equal(sb.upserts.length, 2);
    for (const id of ["c-1", "c-2", "c-3"]) assert.equal((await post(id)).status, 200);
    assert.equal(sb.planCalls, 2, "등급은 /v1/me 가 읽은 것을 캐시에서 쓴다(사용자당 한 번)");
    await errorOf(await post("c-4"), 429, "rate_limited");
    assert.equal((await post("c-o", other)).status, 200);
    assert.equal(sb.planCalls, 2);

    assert.equal((await accountDel(url, jwt)).status, 200);
    assert.equal((await post("c-5")).status, 200, "분당 요청 버킷이 새로 시작한다");
    assert.equal(sb.planCalls, 3, "등급 캐시가 지워져 다시 읽는다");
    await req(url, "/v1/me", "GET", undefined, jwt);
    assert.equal(sb.upserts.length, 3, "프로필 upsert 기억이 지워져 다시 시도한다");
    assert.equal(sb.upserts[2].body.user_id, UID);
    // 다른 사용자의 캐시는 그대로다.
    const reads = sb.planCalls;
    assert.equal((await post("c-o2", other)).status, 200);
    assert.equal(sb.planCalls, reads, "다른 사용자는 캐시를 계속 쓴다");
  }, { env: { ACCOUNT_RATE_PER_MIN: "3" } });
});

test("ServiceClient.deleteAccount round-trips {deleted:true} through the real client and surfaces the refusal", async () => {
  const ServiceClient = require("../lib/service-client.js");
  await withSupabase(async ({ url, sb }) => {
    seedAccount(sb, UID);
    assert.deepEqual(await ServiceClient.deleteAccount({ baseUrl: url, token: ec1() }), { deleted: true });
    assert.deepEqual(objectsOf(sb, UID), []);
    assert.ok(!sb.authUsers.has(UID));
    let err;
    try { await ServiceClient.deleteAccount({ baseUrl: url, token }); } catch (e) { err = e; }
    assert.equal(err.code, "account_not_deletable");
    assert.equal(err.retryable, false);
    sb.failAdmin = true; sb.authUsers.add(UID);
    try { await ServiceClient.deleteAccount({ baseUrl: url, token: ec1() }); err = null; } catch (e) { err = e; }
    assert.equal(err.code, "account_delete_failed");
    assert.equal(err.retryable, true);
  });
});

test("neither the service-role key nor any token appears in an account-deletion response", async () => {
  await withSupabase(async ({ url, sb }) => {
    const jwt = ec1(), seen = [];
    const call = async (t, expected) => { const res = await accountDel(url, t); seen.push(JSON.stringify([...res.headers]) + await res.text()); assert.equal(res.status, expected); };
    seedAccount(sb, UID);
    sb.failStorage.LIST = true; await call(jwt, 503); sb.failStorage = {};
    sb.failRpc.delete_account_data = 1; await call(jwt, 503);
    sb.failAdmin = true; await call(jwt, 503); sb.failAdmin = false;
    sb.down = true; await call(jwt, 503); sb.down = false;
    await call(jwt, 200);
    await call(token, 403);
    await call("bad-token", 401);
    assert.equal(seen.length, 7);
    for (const secret of [SERVICE_KEY, DIGEST_KEY, JWT_SECRET, jwt, token, UID, SB, "supabase", "storage/v1", "rest/v1", "auth/v1", "admin/users", "vault_objects", "delete_account_data"])
      assert.ok(!seen.join("\n").includes(secret), "응답에 있으면 안 된다: " + secret);
  });
});
