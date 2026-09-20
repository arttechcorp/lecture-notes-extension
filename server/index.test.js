const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const {createServer,readState}=require("./index"),Vault=require("../lib/vault");
const token="test-token-A-".padEnd(40,"a"),tokenB="test-token-B-".padEnd(40,"b"),origin="chrome-extension://"+"a".repeat(32),model="google/gemini-2.5-flash-lite";
function config(root){return {APP_TOKENS_JSON:JSON.stringify({A:token,B:tokenB}),EXTENSION_ORIGIN:origin,OPENROUTER_API_KEY:"mock-operator-key",OPENROUTER_PROVIDERS_JSON:JSON.stringify({[model]:["test-provider"]}),VAULT_DIR:root};}
function provider(){const ids=["ev-1"],item={content:"서로 다른 조건을 비교하는 학습 설명입니다.",importance:"important",evidenceIds:ids},summary={title:"노트",keyConclusions:[item],concepts:[],corrections:[],openQuestions:[],sections:[{heading:"비교",...item}],formulas:[],visuals:[],reviewQuestions:[{question:"무엇이 다른가요?",evidenceIds:ids}],evidenceIds:ids};return {ok:true,json:async()=>({choices:[{finish_reason:"stop",message:{content:JSON.stringify(summary)}}],usage:{prompt_tokens:100,completion_tokens:20,cost:.001}})};}
async function listen(root,fetcher){const s=createServer(config(root),{fetch:fetcher});await new Promise(r=>s.listen(0,"127.0.0.1",r));return {server:s,url:"http://127.0.0.1:"+s.address().port};}
const close=s=>new Promise(r=>s.close(r));
const removeTemp=root=>{const target=path.resolve(root);assert.ok(target.startsWith(path.join(path.resolve(os.tmpdir()),'summrizei-service-test-')));fs.rmSync(target,{recursive:true,force:true});};
const req=(url,route,method="GET",body,auth=token,site=origin)=>fetch(url+route,{method,headers:{authorization:"Bearer "+auth,origin:site,"content-type":"application/json"},body:body===undefined?undefined:JSON.stringify(body)});
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
