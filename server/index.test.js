const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path"),crypto=require("node:crypto");
const {createServer,config:serverConfig,readState,toTranscript,toSlideDoc,VISION_SCHEMA,judgeProbs,JUDGE_MODELS}=require("./index"),Vault=require("../lib/vault"),Contracts=require("../lib/contracts.js");
const token="test-token-A-".padEnd(40,"a"),tokenB="test-token-B-".padEnd(40,"b"),origin="chrome-extension://"+"a".repeat(32),model="google/gemini-2.5-flash-lite";
function config(root){return {APP_TOKENS_JSON:JSON.stringify({A:token,B:tokenB}),EXTENSION_ORIGIN:origin,OPENROUTER_API_KEY:"mock-operator-key",OPENROUTER_PROVIDERS_JSON:JSON.stringify({[model]:["test-provider"]}),VAULT_DIR:root};}
function provider(){const ids=["ev-1"],item={content:"서로 다른 조건을 비교하는 학습 설명입니다.",importance:"important",evidenceIds:ids},summary={title:"노트",keyConclusions:[item],concepts:[],corrections:[],openQuestions:[],sections:[{heading:"비교",...item}],formulas:[],visuals:[],reviewQuestions:[{question:"무엇이 다른가요?",evidenceIds:ids}],evidenceIds:ids};return {ok:true,json:async()=>({choices:[{finish_reason:"stop",message:{content:JSON.stringify(summary)}}],usage:{prompt_tokens:100,completion_tokens:20,cost:.001}})};}
async function listen(root,fetcher){const s=createServer(config(root),{fetch:fetcher});await new Promise(r=>s.listen(0,"127.0.0.1",r));return {server:s,url:"http://127.0.0.1:"+s.address().port};}
const close=s=>new Promise(r=>s.close(r));
const removeTemp=root=>{const target=path.resolve(root);assert.ok(target.startsWith(path.join(path.resolve(os.tmpdir()),'summrizei-service-test-')));fs.rmSync(target,{recursive:true,force:true});};
const req=(url,route,method="GET",body,auth=token,site=origin,headers)=>fetch(url+route,{method,headers:{authorization:"Bearer "+auth,origin:site,"content-type":"application/json",...(headers||{})},body:body===undefined?undefined:JSON.stringify(body)});
const input={model,stage:"chunk",requestId:"request-one",evidence:[{id:"ev-1",source:"ocr",text:"synthetic lecture",t0:0,t1:1,selection:"included",selectionReason:"학습 근거로 보존"}]};
test("auth, strict ciphertext, account isolation, delete and durable idempotency",async()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),"summrizei-service-test-"));let calls=0;let {server,url}=await listen(root,async()=>{calls++;return provider();});try{
assert.equal((await req(url,"/v1/me","GET",undefined,"bad")).status,401);assert.equal((await req(url,"/v1/me","GET",undefined,token,"https://evil.example")).status,403);
const ctx={accountId:"A",objectId:"object-one",kind:"session"},envelope=await Vault.encrypt({evidence:"private synthetic",summary:null},"testing-password-123",ctx);
assert.equal((await req(url,"/v1/vault/object-one","PUT",{envelope})).status,200);
assert.equal((await req(url,"/v1/vault/object-one","GET",undefined,tokenB)).status,404);
assert.equal((await req(url,"/v1/vault/object-two","PUT",{envelope})).status,400);
assert.equal((await req(url,"/v1/vault/object-one","PUT",{envelope:{...envelope,plaintext:"not allowed"}})).status,400);
const got=await(await req(url,"/v1/vault/object-one")).json();assert.equal((await Vault.decrypt(got.envelope,"testing-password-123",ctx)).evidence,"private synthetic");
assert.equal((await req(url,"/v1/summary","POST",input)).status,200);assert.equal((await req(url,"/v1/summary","POST",input)).status,409);assert.equal(calls,1);
assert.equal((await req(url,"/v1/summary","POST",{...input,evidence:[{...input.evidence[0],text:"changed"}]})).status,400);
await close(server);({server,url}=await listen(root,async()=>{calls++;return provider();}));
assert.equal((await req(url,"/v1/summary","POST",input)).status,409);assert.equal(calls,1);assert.ok(!fs.readFileSync(path.join(root,"usage.json"),"utf8").includes("synthetic lecture"));
assert.equal((await req(url,"/v1/vault/object-one","DELETE")).status,200);assert.equal((await req(url,"/v1/vault/object-one")).status,404);
}finally{await close(server);removeTemp(root);}});
test("concurrent duplicates never dispatch twice and corrupt usage fails closed",async()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),"summrizei-service-test-"));let calls=0,release;const pending=new Promise(r=>release=r);const {server,url}=await listen(root,async()=>{calls++;await pending;return provider();});try{const first=req(url,"/v1/summary","POST",input);while(!calls)await new Promise(r=>setTimeout(r,5));assert.equal((await req(url,"/v1/summary","POST",input)).status,409);release();assert.equal((await first).status,200);assert.equal(calls,1);}finally{release();await close(server);}fs.writeFileSync(path.join(root,"usage.json"),"{broken");assert.throws(()=>readState(path.join(root,"usage.json")));removeTemp(root);});
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
    assert.equal((await req(url,'/v1/summary','POST',{...input,model:expensive})).status,403);assert.equal(calls,0);
    assert.equal((await req(url,'/v1/summary','POST',input)).status,200);
    const me=await(await req(url,'/v1/me')).json();assert.ok(me.quota.spentCents>0);assert.deepEqual(me.models,[model]);
    assert.equal((await req(url,'/v1/summary','POST',{...input,requestId:'request-two'})).status,429);assert.equal(calls,1);
  }finally{await close(server);removeTemp(root);}
});

test("a malformed structured response retries once with the same provider",async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"summrizei-service-test-"));let calls=0;
  const {server,url}=await listen(root,async()=>{
    calls++;
    if(calls===1)return {ok:true,json:async()=>({choices:[{finish_reason:"stop",message:{content:"{}"}}],usage:{prompt_tokens:10,completion_tokens:5,cost:.001}})};
    return provider();
  });
  try{assert.equal((await req(url,"/v1/summary","POST",input)).status,200);assert.equal(calls,2);}
  finally{await close(server);removeTemp(root);}
});

test("transport failures do not retry or release an unknown charge reservation",async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"summrizei-service-test-"));let calls=0;
  const {server,url}=await listen(root,async()=>{calls++;return {ok:false,json:async()=>({})};});
  try{
    assert.equal((await req(url,"/v1/summary","POST",input)).status,502);
    assert.equal(calls,1);
    const state=readState(path.join(root,"usage.json"));assert.ok(state.accounts.A.spentCents>0);
  }finally{await close(server);removeTemp(root);}
});


test("끊긴 구간은 받아들이되 모양을 검사한다",async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"summrizei-service-test-"));
  let body=null;let {server,url}=await listen(root,async(_route,options)=>{body=JSON.parse(options.body);return provider();});
  try{
    const gaps=[{reason:"audio-capacity",t0:750,t1:770}];
    // 서버는 최상위 필드를 화이트리스트로 막는다. 여기 빠지면 클라이언트가 400 을 받는다.
    assert.equal((await req(url,"/v1/summary","POST",{...input,requestId:"gap-ok",gaps})).status,200);
    assert.deepEqual(JSON.parse(body.messages[1].content).gaps,gaps,"끊긴 구간이 모델 요청에 실리지 않는다");
    // 강의 내용이 아니라 메타데이터다 — 근거로 섞여 들어가면 안 된다.
    assert.ok(JSON.parse(body.messages[1].content).evidence.every(e=>e.source!=="gap"));
    assert.equal((await req(url,"/v1/summary","POST",{...input,requestId:"gap-none"})).status,200);
    assert.equal(JSON.parse(body.messages[1].content).gaps,undefined,"끊긴 곳이 없는데 빈 배열을 보낸다");
    for(const bad of [{reason:"x",t0:5,t1:1},{reason:"",t0:0,t1:1},{t0:0,t1:1},{reason:"x",t0:0,t1:1,extra:1}])
      assert.equal((await req(url,"/v1/summary","POST",{...input,requestId:"gap-bad-"+JSON.stringify(bad).length,gaps:[bad]})).status,400,JSON.stringify(bad));
  }finally{await close(server);removeTemp(root);}
});

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

test("selectionReason 없는 근거를 받고 Anthropic 요청에만 캐시 중단점을 찍는다",async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"summrizei-service-test-")),claude="anthropic/claude-haiku-4.5";
  const bodies=[];
  const env={...config(root),ALLOWED_MODELS:JSON.stringify([model,claude]),OPENROUTER_PROVIDERS_JSON:JSON.stringify({[model]:["provider-a"],[claude]:["provider-b"]})};
  const server=createServer(env,{fetch:async(_url,options)=>{bodies.push(JSON.parse(options.body));return provider();}});
  await new Promise(r=>server.listen(0,"127.0.0.1",r));const url="http://127.0.0.1:"+server.address().port;
  try{
    const {selectionReason,...lean}=input.evidence[0];
    assert.equal((await req(url,"/v1/summary","POST",{...input,requestId:"lean-one",evidence:[lean]})).status,200,"selectionReason 를 뺀 근거가 거절된다");
    assert.equal(typeof bodies[0].messages[0].content,"string","암묵 캐시 모델의 system 본문이 바뀌었다");
    assert.equal((await req(url,"/v1/summary","POST",{...input,requestId:"lean-two",model:claude,evidence:[lean]})).status,200);
    assert.equal(bodies[1].messages[0].content[0].cache_control.type,"ephemeral","Anthropic 요청에 캐시 중단점이 없다");
    assert.equal((await req(url,"/v1/summary","POST",{...input,requestId:"bad-reason",evidence:[{...lean,selectionReason:"x".repeat(301)}]})).status,400,"과한 selectionReason 이 통과한다");
  }finally{await close(server);removeTemp(root);}
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
    const rejected = await req(url, "/v1/summary", "POST", { ...input, bogus: 1 });
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
    const first = req(url, "/v1/summary", "POST", input);
    while (!calls) await new Promise(r => setTimeout(r, 5));
    const second = await req(url, "/v1/summary", "POST", { ...input, requestId: "request-two" });
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
    const first = req(url, "/v1/summary", "POST", input);
    while (!calls) await new Promise(r => setTimeout(r, 5));
    const second = req(url, "/v1/summary", "POST", { ...input, requestId: "request-two" });
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
    const first = req(url, "/v1/summary", "POST", input);
    while (!calls) await new Promise(r => setTimeout(r, 5));
    const t0 = Date.now();
    const busy = await req(url, "/v1/summary", "POST", { ...input, requestId: "request-two" });
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
    assert.equal((await req(url, "/v1/summary", "POST", { ...input, requestId: "request-two" })).status, 200, "되돌려진 requestId는 다시 쓸 수 있다");
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
    const first = req(url, "/v1/summary", "POST", input);
    while (!calls) await new Promise(r => setTimeout(r, 5));
    const ac = new AbortController();
    const queued = fetch(url + "/v1/summary", { method: "POST", signal: ac.signal, headers: { authorization: "Bearer " + token, origin, "content-type": "application/json" }, body: JSON.stringify({ ...input, requestId: "request-two" }) }).catch(() => null);
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
    assert.equal((await req(url, "/v1/summary", "POST", input)).status, 200);
    const limited = await req(url, "/v1/summary", "POST", { ...input, requestId: "request-two" });
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
    const big = await req(url, "/v1/summary", "POST", { ...input, evidence: [{ ...input.evidence[0], text: "x".repeat(70000) }] });
    assert.equal(big.status, 413);
    assert.equal((await big.json()).error.code, "request_too_large");
    const pre = await fetch(url + "/v1/summary", { method: "OPTIONS", headers: { origin } });
    assert.equal(pre.status, 204);
    assert.match(pre.headers.get("access-control-allow-headers"), /x-client-version/);
  } finally { await close(server); removeTemp(root); }
});

// ── STT (Groq Whisper) ──
const sttEnv = root => ({
  ...config(root),
  ALLOWED_STT_MODELS: JSON.stringify(["whisper-large-v3-turbo", "whisper-large-v3"]),
  GROQ_API_KEY: "mock-groq-key",
  ALLOWED_VISION_MODELS: JSON.stringify([model]),
  ACCOUNT_LIMITS_JSON: JSON.stringify({
    A: { models: [model], maxRequests: 50, maxCostCents: 500, features: ["stt", "vision"] },
    B: { models: [model], maxRequests: 50, maxCostCents: 500 },
  }),
});
const audio = size => "data:audio/mp4;base64," + Buffer.alloc(size, 7).toString("base64");
const groqRaw = () => ({
  duration: 12.4,
  segments: [
    { start: 0, end: 5.2, text: "  등가 회로를 먼저 그립니다.  ", avg_logprob: -0.2, compression_ratio: 1.1, no_speech_prob: 0.01 },
    { start: 5.8, end: 12.4, text: "전류 법칙을 적용합니다.", avg_logprob: -0.3, compression_ratio: 1.4, no_speech_prob: 0.02 },
  ],
  words: [
    { word: " 등가 ", start: 0.1, end: 0.5 }, { word: "회로를", start: 0.6, end: 1.2 },
    { word: "그리고", start: 5.4, end: 5.7 }, { word: "전류", start: 6.0, end: 6.6 },
  ],
});
const sttBody = o => ({ model: "whisper-large-v3-turbo", requestId: "stt-x", t0: 100, durationSec: 60, lang: "ko", prompt: "강의 전사", audio: audio(4096), ...o });
const settle = usd => Math.ceil(usd * 1e6) / 1e4;

test("stt forwards multipart audio to Groq and bills provider-measured seconds", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "summrizei-service-test-"));
  let calls = 0, sentUrl, sent, reply = groqRaw();
  const server = createServer(sttEnv(root), { fetch: async (u, o) => { calls++; sentUrl = u; sent = o; return { ok: true, json: async () => reply }; } });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const url = "http://127.0.0.1:" + server.address().port;
  try {
    const res = await req(url, "/v1/stt", "POST", sttBody({ requestId: "stt-one" }));
    assert.equal(res.status, 200);
    assert.equal(calls, 1);
    assert.equal(sentUrl, "https://api.groq.com/openai/v1/audio/transcriptions");
    assert.equal(sent.method, "POST");
    assert.equal(sent.headers.authorization, "Bearer mock-groq-key");
    assert.equal(sent.headers["content-type"], undefined, "multipart 경계는 fetch 가 붙인다");
    const form = sent.body;
    assert.ok(form instanceof FormData);
    assert.equal(form.get("model"), "whisper-large-v3-turbo");
    assert.equal(form.get("response_format"), "verbose_json");
    assert.deepEqual(form.getAll("timestamp_granularities[]"), ["word", "segment"]);
    assert.equal(form.get("language"), "ko");
    assert.equal(form.get("prompt"), "강의 전사");
    assert.equal(form.get("temperature"), "0");
    const file = form.get("file");
    assert.equal(file.type, "audio/mp4");
    assert.equal(file.name, "chunk.m4a");
    assert.equal(file.size, 4096, "디코드한 바이트 수와 같아야 한다");

    const data = await res.json();
    const checked = Contracts.validate(Contracts.SCHEMAS.transcript, data.transcript);
    assert.ok(checked.ok, JSON.stringify(checked.errors));
    assert.equal(data.transcript.engine, "groq-whisper");
    assert.equal(data.transcript.model, "whisper-large-v3-turbo");
    assert.equal(data.transcript.lang, "ko");
    const [s0, s1] = data.transcript.segments;
    assert.equal(s0.id, "100000-0");
    assert.equal(s0.t0, 100); assert.equal(s0.t1, 105.2);
    assert.equal(s1.t0, 105.8); assert.equal(s1.t1, 112.4);
    assert.equal(s0.text, "등가 회로를 먼저 그립니다.");
    assert.deepEqual(s0.words.map(w => w.w), ["등가", "회로를"]);
    assert.deepEqual(s1.words.map(w => w.w), ["그리고", "전류"], "끊긴 구간의 단어는 다음 세그먼트로 간다");
    assert.equal(s0.words[0].t0, 100.1);
    assert.equal(s0.noSpeechProb, 0.01);
    assert.equal(s0.avgLogprob, -0.2);
    assert.equal(s0.compressionRatio, 1.1);
    assert.equal(s0.status, "kept");
    assert.equal(data.usage.audioSec, 60, "선언 60초가 제공자 측정 13초보다 길다");
    assert.equal(data.usage.costUsd, 0.04 * 60 / 3600);
    assert.equal(data.promptVersion, "v1");
    assert.equal(data.schemaVersion, 1);

    // 빈 prompt 는 필드를 빼고, 선언+제공자 길이가 10초 미만이면 최소 과금 10초가 적용된다.
    reply = { duration: 4, segments: [{ start: 0, end: 3.5, text: "짧은 음성" }] };
    const short = await (await req(url, "/v1/stt", "POST", sttBody({ requestId: "stt-two", durationSec: 3, prompt: "" }))).json();
    assert.equal(sent.body.get("prompt"), null, "빈 prompt 는 보내지 않는다");
    assert.equal(short.usage.audioSec, 10);
    assert.equal(short.usage.costUsd, 0.04 * 10 / 3600);

    // 제공자가 잰 길이가 선언보다 길면 제공자 값으로 정산한다. 모델 단가도 갈아 탄다.
    reply = groqRaw();
    const v3 = await (await req(url, "/v1/stt", "POST", sttBody({ requestId: "stt-three", model: "whisper-large-v3", durationSec: 3 }))).json();
    assert.equal(v3.usage.audioSec, 13);
    assert.equal(v3.usage.costUsd, 0.111 * 13 / 3600);

    const me = await (await req(url, "/v1/me")).json();
    assert.equal(me.quota.requests, 3);
    const expected = settle(0.04 * 60 / 3600) + settle(0.04 * 10 / 3600) + settle(0.111 * 13 / 3600);
    assert.ok(Math.abs(me.quota.spentCents - expected) < 1e-9, "예약 1센트는 정산에서 되돌아간다: " + me.quota.spentCents);
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
    assert.equal(data.usage.costUsd, 0.04 * 150 / 3600);
  } finally { await close(server); removeTemp(root); }
});

test("stt validates fields, audio size and the paid feature gate", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "summrizei-service-test-"));
  let calls = 0;
  const server = createServer(sttEnv(root), { fetch: async () => { calls++; return { ok: true, json: async () => groqRaw() }; } });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const url = "http://127.0.0.1:" + server.address().port;
  const offRoot = fs.mkdtempSync(path.join(os.tmpdir(), "summrizei-service-test-"));
  const off = createServer({ ...sttEnv(offRoot), FEATURE_FLAGS_JSON: JSON.stringify({ stt: false }) }, { fetch: async () => ({ ok: true, json: async () => groqRaw() }) });
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
    await expect(sttBody({ requestId: "v-garbage", audio: "not-audio" }), 400, "invalid_audio");
    assert.equal(calls, 0, "검증 실패는 제공자를 호출하지 않는다");

    await expect(sttBody({ requestId: "v-big", audio: audio(8 * 1024 * 1024 + 1) }), 413, "audio_too_large");
    assert.equal((await req(url, "/v1/stt", "POST", sttBody({ requestId: "v-max", audio: audio(8 * 1024 * 1024) }))).status, 200, "8 MiB 정확히는 통과한다");
    const huge = await req(url, "/v1/stt", "POST", sttBody({ requestId: "v-huge", audio: audio(9 * 1024 * 1024) }));
    assert.equal(huge.status, 413);
    assert.equal((await huge.json()).error.code, "request_too_large", "12 MB 본문 상한이 먼저 걸린다");

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
    if (mode === "huge") return { ok: true, json: async () => ({ ...groqRaw(), pad: "x".repeat(2 * 1024 * 1024) }) };
    return { ok: true, json: async () => groqRaw() };
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
    assert.ok(Math.abs(me.quota.spentCents - settle(0.04 * 60 / 3600)) < 1e-9);

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
    : { ok: true, json: async () => groqRaw() } });
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

test("toTranscript maps groq verbose_json into the contract deterministically", () => {
  const opts = { t0: 10, model: "whisper-large-v3-turbo", lang: "ko" };
  const t = toTranscript({ segments: [{ start: 0, end: 2, text: "a" }, { start: 4, end: 6, text: "b" }], words: [
    { word: "w0", start: 0, end: 1 },
    { word: "boundary", start: 1.9, end: 2.1 },
    { word: "gap", start: 2.5, end: 3 },
    { word: "tail", start: 9, end: 10 },
    { word: "  ", start: 0, end: 1 },
    { word: 5, start: 0, end: 1 },
  ] }, opts);
  assert.equal(t.schemaVersion, Contracts.CONTRACT_VERSION);
  assert.equal(t.engine, "groq-whisper");
  assert.equal(t.segments[0].id, "10000-0");
  assert.equal(t.segments[0].t0, 10);
  assert.deepEqual(t.segments[0].words.map(w => w.w), ["w0"]);
  assert.deepEqual(t.segments[1].words.map(w => w.w), ["boundary", "gap", "tail"], "경계·틈새·마지막 이후 단어는 뒤 세그먼트로 간다");
  assert.equal(t.segments[1].words[2].t0, 19, "단어 시각에도 t0 를 더한다");
  assert.equal(t.segments[0].noSpeechProb, null, "없는 점수는 null");
  assert.equal(t.segments[0].avgLogprob, null);
  assert.equal(t.segments[0].compressionRatio, null);

  const noWords = toTranscript({ segments: [{ start: 0, end: 1, text: "x" }] }, opts);
  assert.deepEqual(noWords.segments[0].words, []);
  const empty = toTranscript({ segments: [], words: [{ word: "a", start: 0, end: 1 }] }, opts);
  assert.deepEqual(empty.segments, [], "세그먼트가 없으면 단어는 버린다");
  const ranged = toTranscript({ segments: [{ start: 0, end: 1, text: "x", no_speech_prob: 1.5, compression_ratio: -0.5 }] }, opts);
  assert.equal(ranged.segments[0].noSpeechProb, null, "범위 밖 점수는 null");
  assert.equal(ranged.segments[0].compressionRatio, null);
  assert.throws(() => toTranscript({ segments: [{ end: 1, text: "x" }] }, opts), /invalid_stt_output/);
  assert.throws(() => toTranscript({ segments: "x" }, opts));
  assert.throws(() => toTranscript(null, opts));
});

test("ServiceClient.stt round-trips through the real client and sends its version", async () => {
  const ServiceClient = require("../lib/service-client.js");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "summrizei-service-test-"));
  const server = createServer(sttEnv(root), { fetch: async () => ({ ok: true, json: async () => groqRaw() }) });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const url = "http://127.0.0.1:" + server.address().port;
  const strictRoot = fs.mkdtempSync(path.join(os.tmpdir(), "summrizei-service-test-"));
  const strict = createServer({ ...sttEnv(strictRoot), REMOTE_CONFIG_JSON: JSON.stringify({ minClientVersion: "9.0.0" }) }, { fetch: async () => ({ ok: true, json: async () => groqRaw() }) });
  await new Promise(r => strict.listen(0, "127.0.0.1", r));
  const strictUrl = "http://127.0.0.1:" + strict.address().port;
  globalThis.chrome = { runtime: { getManifest: () => ({ version: "1.2.3" }) } };
  try {
    const data = await ServiceClient.stt({ baseUrl: url, token, model: "whisper-large-v3-turbo", requestId: "cli-stt", t0: 0, durationSec: 10, lang: "ko", audio: audio(512) });
    assert.equal(data.transcript.engine, "groq-whisper");
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
