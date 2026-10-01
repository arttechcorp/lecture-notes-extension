const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const {createServer,readState}=require("./index"),Vault=require("../lib/vault"),Contracts=require("../lib/contracts.js");
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
const visionProvider = text => ({ ok: true, json: async () => ({ choices: [{ finish_reason: "stop", message: { content: text } }], usage: { prompt_tokens: 900, completion_tokens: 120, cost: .002 } }) });

test("vision route reads a slide, gates on the paid feature and caps image size", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "summrizei-service-test-"));
  let sent = null;
  const server = createServer(visionEnv(root), { fetch: async (_url, options) => { sent = JSON.parse(options.body); return visionProvider("## 키르히호프 법칙\n\n$\\sum i_k = 0$"); } });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const url = "http://127.0.0.1:" + server.address().port;
  try {
    const ok = await req(url, "/v1/vision", "POST", { model, requestId: "vision-one", image: jpeg(2048) });
    assert.equal(ok.status, 200);
    assert.match((await ok.json()).text, /키르히호프/);
    assert.equal(sent.provider.zdr, true, "프레임은 zdr provider 로만 나간다");
    assert.equal(sent.provider.data_collection, "deny");

    assert.equal((await req(url, "/v1/vision", "POST", { model, requestId: "vision-two", image: jpeg(2 * 1024 * 1024) })).status, 413);
    assert.equal((await req(url, "/v1/vision", "POST", { model, requestId: "vision-three", image: "not-an-image" })).status, 400);
    assert.equal((await req(url, "/v1/vision", "POST", { model, requestId: "vision-four", image: jpeg(2048), extra: 1 })).status, 400);
    assert.equal((await req(url, "/v1/vision", "POST", { model, requestId: "vision-one", image: jpeg(2048) })).status, 409, "같은 요청 id 는 두 번 청구하지 않는다");

    const free = await req(url, "/v1/vision", "POST", { model, requestId: "vision-five", image: jpeg(2048) }, tokenB);
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
  const server = createServer(env, { fetch: async () => visionProvider("ok") });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const url = "http://127.0.0.1:" + server.address().port;
  try {
    const me = await (await req(url, "/v1/me")).json();
    assert.deepEqual(me.features, [], "전역 스위치가 꺼진 기능은 계정 권한이 있어도 숨긴다");
    assert.equal(me.config.throughputMbps, 30);
    assert.equal(me.config.concurrency.vision, 2, "지정한 키만 기본값 위에 올라간다");
    assert.equal(me.config.concurrency.stt, 4);
    assert.equal(me.config.minClientVersion, "0.0.0");
    const blocked = await req(url, "/v1/vision", "POST", { model, requestId: "vision-flag", image: jpeg(64) });
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
