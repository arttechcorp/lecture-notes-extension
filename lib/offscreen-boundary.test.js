const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const root=path.resolve(__dirname,"..");
test("runtime-only offscreen generates notes with settings from its trusted message",async()=>{
  let listener,meArgs,runArgs,saved;
  const context=vm.createContext({URL,AbortController,crypto,console,Map,chrome:{runtime:{id:"extension-id",getURL:p=>`chrome-extension://extension-id/${p}`,sendMessage:async()=>({ok:true,token:"login-jwt"}),onMessage:{addListener:fn=>{listener=fn;}},onConnect:{addListener(){}}}},
    PackageStore:{indexedDbAdapter:async()=>({}),createStore:async a=>a},
    ServiceClient:{me:async o=>{meArgs=o;return{accountId:"a",features:["background"],models:["model-m"]};}},
    Pipeline:{createJob:async o=>({jobId:o.jobId}),loadJob:async()=>null,CODES:{}},
    NoteStages:{runNote:async(job,input,deps)=>{runArgs={job,input,deps};return{status:"complete",note:{sections:[],status:"complete",meta:{processed:{t0:0,t1:60}},noteSpecVersion:"lecture-note-2"},recognition:{engine:"local"},notices:[]};}},
    NoteLibrary:{packageIdFor:()=>"pkg-1",load:async()=>null,saveResult:async(store,args)=>{saved=args;}},
    NoteContract:{policyOf:o=>({syntheticExamples:o?.syntheticExamples===true,externalAugmentation:o?.externalAugmentation===true})},
    katex:{renderToString:()=>""}});
  // offscreen.js는 진단 이벤트 버스(lib/events.js)를 전제한다. 로그 저장소(IndexedDB)는 이 테스트에서 없는 것으로 둔다.
  vm.runInContext(fs.readFileSync(path.join(root,"lib","events.js"),"utf8"),context,{filename:"events.js"});
  vm.runInContext(fs.readFileSync(path.join(root,"offscreen.js"),"utf8"),context,{filename:"offscreen.js"});
  vm.runInContext(`session={status:"completed",id:"session-id",generation:1,error:null,summaryAttempt:0,slideDocs:[],gaps:[],options:{},store:{snapshot:()=>[]},publish:()=>{},log:()=>{},state(){return{sessionId:this.id,status:this.status,summary:this.summary||null};}}`,context);
  const settings={serviceUrl:"https://service.example",appSessionToken:"static-dev-token",remoteSummaryConsent:true,noteOptions:{syntheticExamples:true}};
  const response=await new Promise(resolve=>listener({target:"session",type:"GENERATE_NOTES",settings},{id:"extension-id",url:"chrome-extension://extension-id/background.js"},resolve));
  assert.equal(response.ok,true,response.error);
  assert.equal(meArgs.baseUrl,"https://service.example");assert.equal(meArgs.token,"login-jwt","로그인 토큰이 정적 토큰보다 먼저");
  assert.equal(runArgs.input.tier,"paid");assert.equal(runArgs.input.consent.summary,true);
  assert.equal(runArgs.input.options.syntheticExamples,true);assert.equal(runArgs.input.options.externalAugmentation,false);
  assert.equal(runArgs.job.jobId,"live-session-id-1");
  assert.equal(saved.packageId,"pkg-1");assert.equal(saved.note.status,"complete");assert.equal(saved.meta.source,"live");
  const summary=await vm.runInContext("session.summary",context);
  assert.deepEqual([summary.version,summary.packageId,summary.status],[2,"pkg-1","complete"]);
  assert.equal(context.chrome.storage,undefined);
});

test("admin-events port serves live events only to the extension's own admin page",async()=>{
  let listener,connect,mode="ok";
  const context=vm.createContext({URL,AbortController,crypto,console,Map,chrome:{runtime:{id:"extension-id",getURL:p=>`chrome-extension://extension-id/${p}`,sendMessage:async()=>({ok:true,token:"login-jwt"}),onMessage:{addListener:fn=>{listener=fn;}},onConnect:{addListener:fn=>{connect=fn;}}}},
    PackageStore:{indexedDbAdapter:async()=>({}),createStore:async a=>a},
    ServiceClient:{me:async()=>({accountId:"a",features:[],models:[]})},
    Pipeline:{createJob:async o=>({jobId:o.jobId}),loadJob:async()=>null,CODES:{}},
    NoteStages:{runNote:async()=>{if(mode==="fail")throw new Error("secret failure detail");return{status:"complete",note:null,notices:[]};}},
    NoteLibrary:{packageIdFor:()=>"pkg-1",load:async()=>null,saveResult:async()=>{}},
    NoteContract:{policyOf:()=>({})},katex:{renderToString:()=>""}});
  vm.runInContext(fs.readFileSync(path.join(root,"lib","events.js"),"utf8"),context,{filename:"events.js"});
  vm.runInContext(fs.readFileSync(path.join(root,"offscreen.js"),"utf8"),context,{filename:"offscreen.js"});
  vm.runInContext(`session={status:"completed",id:"session-id",generation:1,error:null,summaryAttempt:0,slideDocs:[],gaps:[],options:{},store:{snapshot:()=>[]},publish:()=>{},log:()=>{},state(){return{};}}`,context);
  const mk=(sender,name="admin-events")=>{const p={name,sender,msgs:[],closed:false,off:[],postMessage:m=>p.msgs.push(m),disconnect:()=>{p.closed=true;}};p.onDisconnect={addListener:fn=>p.off.push(fn)};return p;};
  const admin={id:"extension-id",url:"chrome-extension://extension-id/admin.html"};
  // 송신자가 이 확장의 admin.html이 아니면 데이터를 한 건도 주지 않고 끊는다(URL.origin은 확장 URL에서 "null"이라 쓰지 않는다).
  for(const sender of [{id:"extension-id",url:"chrome-extension://extension-id/sidepanel.html"},{id:"other",url:admin.url},{id:"extension-id",url:"https://evil.example/admin.html"},{id:"extension-id",url:"chrome-extension://extension-id/admin.html.evil"},{id:"extension-id"},undefined]){
    const p=mk(sender);connect(p);assert.equal(p.closed,true);assert.equal(p.msgs.length,0);
  }
  const foreign=mk(admin,"other-port");connect(foreign);assert.equal(foreign.closed,false);assert.equal(foreign.msgs.length,0);
  const good=mk(admin);connect(good);
  assert.equal(good.closed,false);assert.equal(good.msgs[0].type,"snapshot");
  const call=()=>new Promise(resolve=>listener({target:"session",type:"GENERATE_NOTES",settings:{}},{id:"extension-id",url:"chrome-extension://extension-id/sidepanel.html"},resolve));
  assert.equal((await call()).ok,true);
  const summary=()=>good.msgs.filter(m=>m.type==="event"&&m.event.stage==="summary").map(m=>m.event);
  assert.deepEqual(summary().map(e=>e.status),["running","done"]);
  assert.equal(summary()[0].jobId,"session-id");assert.equal(summary()[0].spanId,summary()[1].spanId);
  mode="fail";assert.equal((await call()).ok,false);
  const failed=summary().at(-1);
  assert.equal(failed.status,"failed");assert.equal(failed.code,"SUMMARY_FAILED");assert.ok(!JSON.stringify(good.msgs).includes("secret failure detail"));
  good.off.forEach(fn=>fn());const seen=good.msgs.length;
  mode="ok";await call();
  assert.equal(good.msgs.length,seen); // 연결이 끊긴 포트에는 더 보내지 않는다
});

// 비전 클라이언트는 contracts.js 가 먼저 실려 있어야 서버가 준 SlideDoc 을 다시 검증한다. 없으면 검증을 조용히 건너뛴다.
test("offscreen loads the data contracts before the vision client",()=>{
  const html=fs.readFileSync(path.join(root,"offscreen.html"),"utf8"),at=name=>html.indexOf(`lib/${name}.js`);
  assert.ok(at("contracts")>=0,"offscreen.html 에 lib/contracts.js 가 없다");
  assert.ok(at("contracts")<at("vision-client"),"contracts.js 는 vision-client.js 보다 먼저 실려야 한다");
});

// 로컬 Whisper 환각 필터는 session.js 가 SttClient 를 찾아야 켜진다. 없으면 필터만 조용히 꺼지므로 순서를 못 박아 둔다.
test("offscreen loads the STT client before the session",()=>{
  const html=fs.readFileSync(path.join(root,"offscreen.html"),"utf8"),at=name=>html.indexOf(`lib/${name}.js`);
  assert.ok(at("stt-client")>=0,"offscreen.html 에 lib/stt-client.js 가 없다");
  assert.ok(at("stt-client")<at("session"),"stt-client.js 는 session.js 보다 먼저 실려야 한다");
});

// 로그인 토큰: offscreen에는 chrome.storage가 없으므로 서비스 호출 직전에 background(AUTH_TOKEN)에 묻는다.
// 순서는 로그인 토큰 -> 설정의 개발용 정적 토큰이다. 갱신 실패 같은 오류는 정적 토큰으로 조용히 바꾸지 않고 그대로 올린다.
function tokenHarness(extra = {}) {
  const harness = { replies: [], asked: [], clients: [], svc: [], note: null, captured: null, stopped: 0 };
  let listener;
  const next = () => (harness.replies.length > 1 ? harness.replies.shift() : harness.replies[0]);
  const sendMessage = async message => {
    if (message?.target !== "background") return { ok: true };
    harness.asked.push(JSON.parse(JSON.stringify(message)));
    const reply = next();
    if (reply instanceof Error) throw reply;
    return reply;
  };
  const context = vm.createContext({
    URL, AbortController, crypto, console, Map,
    chrome: { runtime: { id: "extension-id", getURL: p => `chrome-extension://extension-id/${p}`, sendMessage, onMessage: { addListener: fn => { listener = fn; } }, onConnect: { addListener() {} } } },
    PackageStore: { indexedDbAdapter: async () => ({}), createStore: async a => a },
    ServiceClient: {
      me: async client => { harness.clients.push(client); return { accountId: "account-1", features: [], models: [] }; },
      listEncrypted: async () => ({ items: [] }),
      ...Object.fromEntries(["plan", "write", "judge"].map(n => [n, async o => (harness.svc.push({ n, ...o }), { ok: true })])),
    },
    Pipeline: { createJob: async o => ({ jobId: o.jobId }), loadJob: async () => null, CODES: {} },
    NoteStages: { runNote: async (job, input, deps) => { harness.note = { job, input, deps }; return { status: "complete", note: null, notices: [] }; } },
    NoteLibrary: { packageIdFor: () => "pkg-1", load: async () => null, saveResult: async () => {} },
    NoteContract: { policyOf: () => ({}) }, katex: { renderToString: () => "" },
    CaptureSession: class { constructor(init) { harness.captured = init; this.options = init.options; this.id = init.id; this.status = "completed"; } publish() {} async start() {} state() { return {}; } async dispose() {} },
    navigator: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop: () => { harness.stopped++; } }] }) } },
    ...extra,
  });
  vm.runInContext(fs.readFileSync(path.join(root, "lib", "events.js"), "utf8"), context, { filename: "events.js" });
  vm.runInContext(fs.readFileSync(path.join(root, "offscreen.js"), "utf8"), context, { filename: "offscreen.js" });
  harness.send = (message, url = "sidepanel.html") => new Promise(resolve => listener(message, { id: "extension-id", url: `chrome-extension://extension-id/${url}` }, resolve));
  harness.raw = (message, sender) => new Promise(resolve => listener(message, sender, resolve));
  harness.context = context;
  return harness;
}
const AUTH_ASK = { target: "background", type: "AUTH_TOKEN" };

test("tokenProvider returns the login token, uses the static developer token only on localhost, and demands a login elsewhere", async () => {
  const { memoryAdapter, createStore } = require("./package-store.js");
  const { SERVICE_URL } = require("./settings.js");
  const h = tokenHarness({ PackageStore: { indexedDbAdapter: async () => memoryAdapter(), createStore } });
  const list = settings => h.send({ target: "session", type: "BG_LIST", settings }, "background.js");
  const run = settings => h.send({ target: "session", type: "BG_RUN", jobId: "job-12345678", source: { playlistUrl: "https://cdn.example.com/m.m3u8", pageUrl: "https://lms.example.com/" }, settings }, "background.js");
  const settings = { serviceUrl: "https://service.example", appSessionToken: "static-dev-token" };

  h.replies = [{ ok: true, token: "login-jwt" }];
  assert.equal((await list(settings)).ok, true);
  assert.equal(h.clients.at(-1).token, "login-jwt");
  assert.equal(h.clients.at(-1).baseUrl, "https://service.example");
  assert.deepEqual(h.asked, [AUTH_ASK], "토큰 요청은 이 한 가지 모양뿐이다");

  // 정적 토큰은 개발용 localhost 에서만 쓴다 — 운영 주소로 나가면 서버가 모르는 v1 토큰을 보내는 꼴이라 로그인 요구로 멈춘다
  for (const serviceUrl of ["http://localhost:8787", "http://127.0.0.1:8787", "http://[::1]:8787", "https://localhost:8787"]) {
    h.replies = [{ ok: true, token: null }];
    await list({ serviceUrl, appSessionToken: "static-dev-token" });
    assert.equal(h.clients.at(-1).token, "static-dev-token", serviceUrl);
    assert.equal(h.clients.at(-1).baseUrl, serviceUrl);
  }
  h.replies = [{ ok: true, token: "" }];
  await list({ serviceUrl: "http://localhost:8787", appSessionToken: "static-dev-token" });
  assert.equal(h.clients.at(-1).token, "static-dev-token");
  for (const unreachable of [new Error("Could not establish connection"), undefined]) {
    h.replies = [unreachable];
    await list({ serviceUrl: "http://localhost:8787", appSessionToken: "static-dev-token" });
    assert.equal(h.clients.at(-1).token, "static-dev-token", "background에 닿지 않아도 정적 토큰은 localhost 에서만");
  }

  // 운영 주소(실서비스 Supabase 함수 포함)에서 로그인 토큰이 없으면 정적 토큰을 보내지 않고 로그인을 요구한다
  for (const reply of [{ ok: true, token: null }, { ok: true, token: "" }, new Error("Could not establish connection"), undefined]) {
    h.replies = [reply];
    const denied = await run(settings);
    assert.equal(denied.ok, false);
    assert.equal(denied.code, "AUTH_REQUIRED");
    assert.match(denied.error, /로그인이 필요합니다/);
  }
  h.replies = [{ ok: true, token: null }];
  const denied = await run({ serviceUrl: SERVICE_URL, appSessionToken: "static-dev-token" });
  assert.equal(denied.code, "AUTH_REQUIRED", "운영 Supabase 주소 + 정적 토큰이어도 로그인 요구");
  const noToken = await run({ serviceUrl: "https://service.example" });
  assert.equal(noToken.code, "AUTH_REQUIRED", "토큰이 둘 다 없어도 같은 로그인 요구");

  const before = h.asked.length;
  h.replies = [{ ok: true, token: "t1" }, { ok: true, token: "t2" }];
  await list(settings);
  await list(settings);
  assert.deepEqual(h.clients.slice(-2).map(c => c.token), ["t1", "t2"], "호출마다 새로 묻는다(offscreen이 토큰을 들고 있지 않는다)");
  assert.equal(h.asked.length - before, 2);
});

test("a token refresh failure surfaces as the error and does not fall back to the static token", async () => {
  const h = tokenHarness();
  const settings = { serviceUrl: "https://service.example", appSessionToken: "static-dev-token", remoteSummaryConsent: true };
  vm.runInContext(`session={status:"completed",id:"session-id",generation:1,error:null,summaryAttempt:0,slideDocs:[],gaps:[],options:{},store:{snapshot:()=>[]},publish:()=>{},log:()=>{},state(){return{status:this.status};}}`, h.context);
  const sendNotes = () => h.send({ target: "session", type: "GENERATE_NOTES", settings });
  h.replies = [{ ok: false, error: "로그인이 만료되었거나 취소되었습니다. 설정에서 Google로 다시 로그인하세요." }];
  const failed = await sendNotes();
  assert.equal(failed.ok, false);
  assert.match(failed.error, /다시 로그인/);
  assert.equal(h.clients.length, 0, "정적 토큰으로 서비스를 호출하지 않았다");
  h.replies = [{ ok: true, token: "login-jwt" }];
  assert.equal((await sendNotes()).ok, true, "오류 뒤에도 요약 작업이 잠기지 않는다");
});

test("GENERATE_NOTES resolves the token for every service call and ignores a BYOK key", async () => {
  const h = tokenHarness();
  const sendNotes = settings => h.send({ target: "session", type: "GENERATE_NOTES", settings });
  vm.runInContext(`session={status:"completed",id:"session-id",generation:1,error:null,summaryAttempt:0,slideDocs:[],gaps:[],options:{},store:{snapshot:()=>[]},publish:()=>{},log:()=>{},state(){return{status:this.status};}}`, h.context);

  h.replies = [{ ok: true, token: "jwt-1" }, { ok: true, token: "jwt-2" }, { ok: true, token: "jwt-3" }, { ok: true, token: "jwt-4" }];
  const response = await sendNotes({ serviceUrl: "https://service.example", appSessionToken: "static-dev-token", remoteSummaryConsent: true });
  assert.equal(response.ok, true, response.error);
  assert.equal(h.clients.at(-1).token, "jwt-1", "/v1/me 는 첫 토큰으로 부른다");
  for (const n of ["plan", "write", "judge"]) await h.note.deps.service[n]({ model: "m" });
  assert.deepEqual(h.svc.map(c => c.token), ["jwt-2", "jwt-3", "jwt-4"], "서비스 호출마다 새로 받는다 - 긴 작업이 중간에 만료되지 않는다");
  assert.ok(h.svc.every(c => c.baseUrl === "https://service.example"));
  assert.equal(h.asked.length, 4);

  h.asked.length = 0; h.svc.length = 0; h.clients.length = 0;
  h.replies = [{ ok: true, token: "jwt-x" }];
  const again = await sendNotes({ openRouterApiKey: "sk-or-v1-synthetic-test-key-123456", serviceUrl: "https://service.example", appSessionToken: "static-dev-token", remoteSummaryConsent: true });
  assert.equal(again.ok, true, again.error);
  assert.equal(h.clients.at(-1).token, "jwt-x", "BYOK 키가 와도 무시하고 서비스 토큰만 쓴다");
  assert.equal(h.asked.length, 1);
});

test("a vision session resolves a token at start and gets a fresh one per call through getToken", async () => {
  const h = tokenHarness();
  const start = (settings, options) => h.send({ target: "session", type: "START_SESSION", streamId: "stream-1", settings, options });
  const settings = { serviceUrl: "https://service.example", appSessionToken: "static-dev-token" };

  h.replies = [{ ok: true, token: "jwt-1" }];
  const started = await start(settings, { ocrEngine: "vision-cloud", visionConsent: true, tabId: 7 });
  assert.equal(started.ok, true, started.error);
  const options = h.captured.options;
  assert.equal(options.appSessionToken, "jwt-1");
  assert.equal(options.serviceUrl, "https://service.example");
  assert.equal(options.tabId, 7);
  assert.equal(typeof options.getToken, "function");
  h.replies = [{ ok: true, token: "jwt-2" }, { ok: true, token: null }];
  assert.equal(await options.getToken(), "jwt-2", "1시간 뒤의 호출도 그 시점의 토큰을 받는다");
  await assert.rejects(options.getToken(), e => e.code === "AUTH_REQUIRED", "운영 주소에서 로그아웃되면 정적 토큰으로 넘어가지 않는다");

  // 로컬 인식은 서비스를 쓰지 않으므로 로그인 상태나 갱신 실패와 무관하게 시작한다.
  h.asked.length = 0;
  h.replies = [{ ok: false, error: "로그인이 만료되었거나 취소되었습니다." }];
  assert.equal((await start(settings, { ocrEngine: "ppocr-v5-wasm", tabId: 7 })).ok, true);
  assert.equal(h.asked.length, 0);
  assert.equal(h.captured.options.appSessionToken, "static-dev-token");
  assert.equal(h.captured.options.sttEngine, "local");
});

test("a vision session start stops the capture stream when the login cannot be refreshed", async () => {
  const h = tokenHarness();
  h.replies = [{ ok: false, error: "로그인이 만료되었거나 취소되었습니다. 설정에서 Google로 다시 로그인하세요." }];
  h.captured = null;
  const response = await h.send({ target: "session", type: "START_SESSION", streamId: "stream-1", settings: { serviceUrl: "https://service.example", appSessionToken: "static-dev-token" }, options: { ocrEngine: "vision-cloud", visionConsent: true, tabId: 7 } });
  assert.equal(response.ok, false);
  assert.match(response.error, /다시 로그인/);
  assert.equal(h.captured, null, "세션을 만들지 않았다");
  assert.equal(h.stopped, 1, "이미 잡은 탭 스트림은 놓아 준다");
});

test("START_SESSION recognition:\"cloud\" checks plan and consent, then wires server recognition; anything else stays local", async () => {
  const cloudSvc = features => {
    const calls = [];
    return [calls, {
      me: async o => (calls.push(o), { features, models: [] }),
      ...Object.fromEntries(["plan", "write", "judge"].map(n => [n, async () => ({})])),
    }];
  };
  const start = (h, options) => h.send({ target: "session", type: "START_SESSION", streamId: "stream-1", settings: { serviceUrl: "https://service.example", appSessionToken: "static-dev-token", visionConsent: true, visionConsentVersion: "2026-10-03" }, options });

  // 요금제에 vision·stt 둘 다 있고 동의가 있으면 서버 인식으로 시작한다
  const [calls, svc] = cloudSvc(["vision", "stt"]);
  const h = tokenHarness({ cloudRecognitionAllowed: s => s?.visionConsent === true && s?.visionConsentVersion === "2026-10-03", ServiceClient: svc });
  h.replies = [{ ok: true, token: "login-jwt" }];
  const started = await start(h, { recognition: "cloud", tabId: 7 });
  assert.equal(started.ok, true, started.error);
  const options = h.captured.options;
  assert.deepEqual([options.ocrEngine, options.ocrEnabled, options.whisperEnabled, options.sttEngine], ["vision-cloud", true, true, "cloud"]);
  assert.deepEqual([options.sttModel, options.visionModel], ["microsoft/mai-transcribe-2", "openai/gpt-6-luna"]);
  assert.equal(options.appSessionToken, "login-jwt");
  assert.equal(calls.at(-1).token, "login-jwt", "/v1/me 도 로그인 토큰으로");
  assert.equal(calls.at(-1).timeoutMs, 15000);
  assert.equal(calls.at(-1).baseUrl, "https://service.example");

  // 플랜이 서버 인식을 못 쓰면(vision·stt 둘 중 하나라도 없으면) 시작하지 않고 스트림을 놓는다
  const h2 = tokenHarness();
  h2.replies = [{ ok: true, token: "login-jwt" }]; // 기본 me: features []
  const denied = await start(h2, { recognition: "cloud", tabId: 7 });
  assert.equal(denied.ok, false);
  assert.equal(denied.code, "PLAN_NO_CLOUD");
  assert.match(denied.error, /서버 인식/);
  assert.equal(h2.captured, null);
  assert.equal(h2.stopped, 1, "잡은 탭 스트림은 놓아 준다");

  // 동의가 없으면 시작하지 않는다
  const [, svc3] = cloudSvc(["vision", "stt"]);
  const h3 = tokenHarness({ cloudRecognitionAllowed: () => false, ServiceClient: svc3 });
  h3.replies = [{ ok: true, token: "login-jwt" }];
  const noConsent = await start(h3, { recognition: "cloud", tabId: 7 });
  assert.equal(noConsent.ok, false);
  assert.equal(noConsent.code, "CONSENT_CLOUD_REQUIRED");
  assert.equal(h3.stopped, 1);

  // recognition:"cloud" 가 아니면 서비스를 부르지 않고 로컬 STT로 둔다
  const h4 = tokenHarness();
  const local = await start(h4, { tabId: 7 });
  assert.equal(local.ok, true, local.error);
  assert.equal(h4.captured.options.sttEngine, "local");
  assert.equal(h4.clients.length, 0);
});

test("a 401 from the service emits AUTH_REJECTED with tokenInfo fields only and a session debug line", async () => {
  const h = tokenHarness({
    ServiceClient: {
      me: async () => { throw Object.assign(new Error("로그인이 만료됐습니다. Google로 다시 로그인하세요."), { status: 401, code: "unauthorized", tokenInfo: { kind: "jwt", alg: "RS256", kid: "kid-1234", iss: "auth.example", expInSec: -30 } }); },
      ...Object.fromEntries(["plan", "write", "judge"].map(n => [n, async () => ({})])),
    },
  });
  vm.runInContext(`session={status:"completed",id:"session-id",generation:1,error:null,summaryAttempt:0,slideDocs:[],gaps:[],options:{},store:{snapshot:()=>[]},publish:()=>{},logs:[],log(m){this.logs.push(m);},state(){return{status:this.status};}}`, h.context);
  h.replies = [{ ok: true, token: "login-jwt" }];
  const r = await h.send({ target: "session", type: "GENERATE_NOTES", settings: { serviceUrl: "https://service.example", appSessionToken: "static-dev-token", remoteSummaryConsent: true } });
  assert.equal(r.ok, false);
  assert.equal(r.code, "unauthorized", "오류 코드가 답장에 실려 패널이 로그인 버튼을 띄울 수 있다");
  const recent = JSON.parse(vm.runInContext("JSON.stringify(bus.recent(20))", h.context));
  const auth = recent.find(e => e.code === "AUTH_REJECTED");
  assert.ok(auth, "인증 거부 진단 이벤트");
  assert.deepEqual([auth.stage, auth.level, auth.jobId], ["auth", "warn", "session-id"]);
  assert.equal(auth.msg, "jwt RS256 kid-1234 auth.example exp -30s");
  for (const leak of ["login-jwt", "static-dev-token"]) assert.ok(!JSON.stringify(recent).includes(leak), `로그에 ${leak} 이 없다`);
  assert.equal(vm.runInContext("session.logs.at(-1)", h.context), "[인증] 서버가 토큰을 거부함 · jwt RS256 kid-1234 auth.example exp -30s");
});

test("offscreen never reads storage or loads the auth module", () => {
  const html = fs.readFileSync(path.join(root, "offscreen.html"), "utf8");
  assert.doesNotMatch(html, /lib\/auth\.js/);
  // settings.js는 동의 판정 함수(backgroundAllowed·cloudRecognitionAllowed)를 background-job.js가 전역에서 찾기 때문에 싣는다. 저장소를 읽고 쓰는 함수는 offscreen.js가 부르지 않는다.
  const code = fs.readFileSync(path.join(root, "offscreen.js"), "utf8").split("\n").filter(line => !line.trimStart().startsWith("//")).join("\n");
  assert.doesNotMatch(code, /chrome\.storage|\bAuth\.|\b(load|save)(Settings|AuthSession)\b/);
});

test("DIAG_EVENT records one login timing shape on the event bus and rejects every other shape", async () => {
  const h = tokenHarness();
  const send = event => h.send({ target: "session", type: "DIAG_EVENT", event }, "background.js");
  const logged = () => JSON.parse(vm.runInContext("JSON.stringify(bus.recent().filter(e => e.code === 'LOGIN_TIMING'))", h.context));
  assert.deepEqual({ ...(await send({ stage: "login", code: "LOGIN_TIMING", ms: 42, msg: "auth_window" })) }, { ok: true });
  assert.equal(logged().length, 1);
  assert.deepEqual([logged()[0].stage, logged()[0].ms, logged()[0].msg], ["login", 42, "auth_window"]);
  for (const event of [
    { stage: "session", code: "LOGIN_TIMING", ms: 1, msg: "total" },
    { stage: "login", code: "SESSION_TIMING", ms: 1, msg: "total" },
    { stage: "login", code: "LOGIN_TIMING", ms: -1, msg: "total" },
    { stage: "login", code: "LOGIN_TIMING", ms: 600001, msg: "total" },
    { stage: "login", code: "LOGIN_TIMING", ms: 1, msg: "Email address" },
    { stage: "login", code: "LOGIN_TIMING", ms: 1, msg: "a".repeat(81) },
    { stage: "login", code: "LOGIN_TIMING", ms: 1 },
    null, "auth_window",
  ]) assert.equal((await send(event)).ok, false, JSON.stringify(event));
  assert.equal(logged().length, 1, "거절한 이벤트는 버스에 싣지 않는다");
});

// ── 유료 백그라운드 작업 ──
test("offscreen loads the background job's scripts in dependency order and no script redefines another's globals", () => {
  const html = fs.readFileSync(path.join(root, "offscreen.html"), "utf8"), srcs = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
  const at = name => srcs.indexOf(name.includes("/") || name === "offscreen.js" ? name : `lib/${name}.js`);
  const before = (a, b) => { assert.ok(at(a) >= 0 && at(b) >= 0, `${a} ${b} 가 offscreen.html 에 없다`); assert.ok(at(a) < at(b), `${a} 는 ${b} 보다 먼저 실려야 한다`); };
  before("settings", "background-job"); // backgroundAllowed·cloudRecognitionAllowed 를 전역에서 찾는다
  before("lib/vendor/mux/mux-mp4.min.js", "media-demux"); // 전역 muxjs
  before("lib/vendor/katex/katex.min.js", "stages"); // runNote 에 넘기는 전역 katex
  before("service-client", "stages"); // GENERATE_NOTES 의 ServiceClient 호출
  for (const dep of ["pipeline", "verify", "boilerplate", "formulas", "preprocess", "contracts", "note-contract", "figures"]) before(dep, "stages");
  before("package-store", "library"); // NoteLibrary 가 PackageStore 에 쓴다
  before("formulas", "verify"); before("repeats", "preprocess");
  for (const dep of ["pipeline", "media-source", "media-demux", "boilerplate", "stt-client", "vision-client", "visual-gate", "stages"]) before(dep, "background-job");
  before("media-decode", "offscreen.js");
  assert.equal(at("offscreen.js"), srcs.length - 1, "offscreen.js 는 마지막이다");
  // 같은 전역을 두 번 정의하면 뒤의 스크립트가 앞의 것을 조용히 덮는다(const·class 는 SyntaxError). 실제 로드 순서대로 한 컨텍스트에 올려 확인한다.
  const context = vm.createContext({ URL, AbortController, TextEncoder, TextDecoder, crypto, console, Map, Set, setTimeout, clearTimeout, chrome: { runtime: { id: "extension-id", getURL: p => `chrome-extension://extension-id/${p}`, sendMessage: async () => ({}), onMessage: { addListener() {} }, onConnect: { addListener() {} } } } });
  const owner = new Map();
  for (const src of srcs) {
    const known = new Set(Object.getOwnPropertyNames(context));
    vm.runInContext(fs.readFileSync(path.join(root, src), "utf8"), context, { filename: src });
    for (const name of Object.getOwnPropertyNames(context)) if (!known.has(name)) { assert.ok(!owner.has(name), `${src} 가 ${owner.get(name)} 의 전역 ${name} 을 다시 정의한다`); owner.set(name, src); }
  }
  for (const name of ["Pipeline", "NoteStages", "LectureMedia", "LectureDemux", "LectureDecode", "BackgroundJob", "katex", "muxjs", "backgroundAllowed", "cloudRecognitionAllowed", "NoteFile"]) assert.ok(owner.has(name), `${name} 이 전역에 없다`);
});

const PS = require("./package-store.js"), P = require("./pipeline.js");
const defer = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
// 가짜 의존성으로 offscreen.js 를 올린다. runBackground 는 시험이 끝내 주는 약속이고, 서비스·저장소·fetch 는 기록만 한다.
function bgHarness(over = {}) {
  const h = { sent: [], runs: [], fetched: [], mes: 0, referer: async () => ({ ok: true }), svc: [], vision: null, notes: [] };
  let listener;
  const context = vm.createContext({
    URL, AbortController, crypto, console, Map, Set, Promise, setTimeout, clearTimeout,
    chrome: { runtime: { id: "extension-id", getManifest: () => ({ version: "1.0.0" }), getURL: p => `chrome-extension://extension-id/${p}`, onMessage: { addListener: fn => { listener = fn; } }, onConnect: { addListener() {} },
      sendMessage: async m => {
        h.sent.push(JSON.parse(JSON.stringify(m)));
        if (m.type === "AUTH_TOKEN") return { ok: true, token: "login-jwt-login-jwt-login-jwt-login-jwt" };
        return m.type === "BG_REFERER" ? h.referer(m) : { ok: true };
      } } },
    PackageStore: { indexedDbAdapter: async () => PS.memoryAdapter(), createStore: PS.createStore },
    Pipeline: P,
    ServiceClient: { me: async o => { h.mes++; h.meArgs = o; return over.me ?? { accountId: "a", features: ["background", "stt", "vision", "judge"], models: ["model-m"], config: { concurrency: { download: 4 } } }; },
      ...Object.fromEntries(["stt", "plan", "write", "judge"].map(n => [n, async o => (h.svc.push({ n, ...o }), { ok: true })])) },
    VisionClient: { createVisionEngine: o => { h.vision = o; return { recognize: async () => ({}) }; } },
    LectureDecode: require("./media-decode.js"), NoteStages: { runNote: async (job, input, deps) => (h.notes.push({ job, input, deps }), { status: "complete", note: null, notices: [] }) }, katex: { renderToString: () => "" },
    BackgroundJob: { runBackground: (job, source, deps) => { const d = defer(); h.runs.push({ job, source, deps, done: d }); deps.signal.addEventListener("abort", () => d.resolve({ status: "cancelled" })); return d.promise; } },
    fetch: async (url, init) => (h.fetched.push({ url, init, askedBefore: h.sent.filter(m => m.type === "BG_REFERER").length }), { ok: true }),
    CaptureSession: class { constructor(init) { this.options = init.options; this.status = "completed"; } publish() {} async start() {} state() { return {}; } async dispose() {} },
    navigator: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) } },
    ...over.globals,
  });
  vm.runInContext(fs.readFileSync(path.join(root, "lib", "events.js"), "utf8"), context, { filename: "events.js" });
  vm.runInContext(fs.readFileSync(path.join(root, "offscreen.js"), "utf8"), context, { filename: "offscreen.js" });
  h.context = context;
  h.send = (message, url = "background.js") => new Promise(resolve => listener({ target: "session", ...message }, { id: "extension-id", url: `chrome-extension://extension-id/${url}` }, resolve)).then(r => JSON.parse(JSON.stringify(r)));
  h.until = async pred => { for (let i = 0; i < 200 && !pred(); i++) await new Promise(r => setImmediate(r)); assert.ok(pred(), "기다리던 일이 일어나지 않았다"); };
  h.done = () => h.sent.filter(m => m.type === "BG_DONE");
  return h;
}
const SETTINGS = { serviceUrl: "https://service.example", appSessionToken: "static-dev-token-static-dev-token-1", remoteSummaryConsent: true, whisperLang: "ko", visionConsent: true, visionConsentVersion: "2026-10-02", backgroundConsent: { personalUse: true, accessRights: true, version: "2026-10-02", at: 1 } };
const RUN = (jobId = "job-12345678", extra = {}) => ({ type: "BG_RUN", jobId, source: { playlistUrl: "https://cdn.example.com/master.m3u8", pageUrl: "https://lms.example.com/watch?id=7" }, settings: SETTINGS, ...extra });

test("BG_RUN, BG_LIST and BG_CANCEL are accepted from background.js only", async () => {
  const h = bgHarness();
  for (const url of ["sidepanel.html", "options.html", "offscreen.html", "admin.html", "background.js.evil"]) for (const type of ["BG_RUN", "BG_LIST", "BG_CANCEL"]) {
    const r = await h.send(type === "BG_RUN" ? RUN() : { type }, url);
    assert.equal(r.ok, false, `${type} from ${url}`);
  }
  assert.equal(h.runs.length, 0);
  assert.equal(h.mes, 0, "거절된 요청은 서비스를 부르지 않는다");
  assert.equal((await h.send({ type: "BG_RUN", jobId: "job-12345678", source: { playlistUrl: "file:///etc/passwd", pageUrl: "https://lms.example.com/" }, settings: SETTINGS })).ok, false, "http(s)가 아닌 주소");
  assert.equal((await h.send(RUN("../x"))).ok, false, "작업 번호 모양");
  assert.equal(h.runs.length, 0);
});

test("only one background job runs at a time; a second BG_RUN is refused with a clear message and live capture waits", async () => {
  const h = bgHarness();
  const first = await h.send(RUN("job-aaaaaaaa"));
  assert.deepEqual(first, { ok: true });
  await h.until(() => h.runs.length === 1);
  const second = await h.send(RUN("job-bbbbbbbb"));
  assert.equal(second.ok, false);
  assert.equal(second.busy, true, "background 가 이 답으로 첫 작업의 절전 방지를 유지한다");
  assert.match(second.error, /이미 백그라운드 작업이 진행 중/);
  assert.equal(h.runs.length, 1, "두 번째 작업은 시작하지 않았다");
  assert.equal((await h.send({ type: "START_SESSION", streamId: "s", settings: {}, options: { tabId: 1 } }, "background.js")).ok, false, "실시간 캡처도 작업이 끝날 때까지 기다린다");
  h.runs[0].done.resolve({ status: "complete", notices: [] });
  await h.until(() => h.done().length === 1);
  assert.equal((await h.send(RUN("job-bbbbbbbb"))).ok, true, "끝나면 다음 작업을 받는다");
});

test("BG_CANCEL aborts the running job and the end is reported once as cancelled", async () => {
  const h = bgHarness();
  assert.equal((await h.send({ type: "BG_CANCEL" })).ok, true, "돌고 있는 작업이 없어도 오류가 아니다");
  await h.send(RUN());
  await h.until(() => h.runs.length === 1);
  const { signal } = h.runs[0].deps;
  assert.equal(signal.aborted, false);
  assert.deepEqual(await h.send({ type: "BG_CANCEL" }), { ok: true });
  assert.equal(signal.aborted, true, "runBackground 의 signal 이 중단됐다");
  await h.until(() => h.done().length === 1);
  assert.equal(h.done()[0].status, "cancelled");
  assert.equal(h.done()[0].target, "background");
  assert.equal(h.done()[0].jobId, "job-12345678");
  assert.equal(h.done().length, 1);
});

test("BG_RUN wires the job: login token, long-lecture vision limit, models, and a resumable job id", async () => {
  const h = bgHarness();
  assert.equal((await h.send(RUN())).ok, true);
  await h.until(() => h.runs.length === 1);
  const { deps, source, job } = h.runs[0];
  assert.equal(h.meArgs.baseUrl, "https://service.example");
  assert.equal(h.meArgs.token, "login-jwt-login-jwt-login-jwt-login-jwt", "로그인 토큰이 정적 토큰보다 먼저");
  assert.deepEqual(JSON.parse(JSON.stringify(source)), RUN().source);
  assert.equal(job.jobId, "job-12345678");
  assert.equal(deps.features.features.includes("background"), true, "/v1/me 응답을 그대로 넘긴다");
  assert.deepEqual(JSON.parse(JSON.stringify(deps.settings)), SETTINGS);
  for (const k of ["plan", "write", "judge", "stt"]) assert.ok(deps.models[k], `models.${k}`);
  assert.ok(h.vision.maxCalls > 200, "기본 200장으로는 긴 강의가 오류가 난다");
  assert.equal(h.vision.signal, deps.signal);
  assert.equal(typeof h.vision.token, "function", "토큰은 호출마다 새로 받는다");
  assert.equal(h.vision.model, deps.models.vision);
  // stt·plan·write·judge 는 호출마다 토큰을 새로 받아 서비스를 부른다
  await deps.stt.stt({ audio: "x", t0: 0, durationSec: 1, lang: "ko", requestId: "r1" });
  await deps.runNote(job, { slides: [] }, { signal: deps.signal });
  const note = h.notes[0].deps;
  for (const n of ["plan", "write", "judge"]) await note.service[n]({ model: "m", requestId: "r2" });
  assert.deepEqual(h.svc.map(c => c.n), ["stt", "plan", "write", "judge"]);
  assert.ok(h.svc.every(c => c.baseUrl === "https://service.example" && c.token === "login-jwt-login-jwt-login-jwt-login-jwt"));
  assert.equal(note.katex.renderToString("x"), "");
  // 같은 번호로 다시 부르면 만들지 않고 저장소의 작업을 이어 간다
  const store = await vm.runInContext("storeP", h.context);
  await job.transition("acquiring_source"); await job.transition("paused", { reason: "network", code: "NET_UNREACHABLE" });
  h.runs[0].done.resolve({ status: "paused", code: "NET_UNREACHABLE", reason: "network" });
  await h.until(() => h.done().length === 1);
  assert.equal((await h.send(RUN())).ok, true);
  await h.until(() => h.runs.length === 2);
  assert.equal(h.runs[1].job.state, "paused", "저장된 기록을 불러왔다");
  assert.deepEqual((await store.ids("jobs")), ["job-12345678"]);
});

test("BG_RUN on a failed or cancelled job reopens it at the recorded stage — the finished ingest is not redone", async () => {
  const h = bgHarness();
  const store = await vm.runInContext("storeP", h.context);
  const job = await P.createJob({ jobId: "job-dead0001", store });
  for (const s of ["acquiring_source", "ingesting"]) await job.transition(s);
  await job.complete("ingest", "done"); // 수신·인식이 끝난 체크포인트 — 비전·STT는 패키지의 sd:·tr: 기록으로 복원한다
  for (const s of ["refining", "judging", "planning"]) await job.transition(s);
  await job.transition("failed", { code: "MEM_BUDGET_EXCEEDED" });
  const r = await h.send(RUN("job-dead0001"));
  assert.deepEqual(r, { ok: true, already: true, state: "planning" });
  await h.until(() => h.runs.length === 1);
  assert.equal(h.runs[0].job.state, "planning");
  assert.equal(h.runs[0].job.record.code, undefined, "실패 코드를 지웠다");
  assert.equal(h.runs[0].job.record.completed.ingest, "done", "끝난 수신은 건너뛰고 runNote부터 이어 간다 — 새 목록 주소(토큰 갱신)도 받는다");
  // 취소도 같은 규칙으로 되돌린다
  const j2 = await P.createJob({ jobId: "job-dead0002", store });
  await j2.transition("acquiring_source"); await j2.transition("cancelled");
  h.runs[0].done.resolve({ status: "complete", notices: [] });
  await h.until(() => h.done().length === 1);
  assert.deepEqual(await h.send(RUN("job-dead0002")), { ok: true, already: true, state: "acquiring_source" });
  await h.until(() => h.runs.length === 2);
  assert.equal(h.runs[1].job.state, "acquiring_source");
});

test("BG_RUN on a done job reruns nothing: already:true, no service call, and BG_DONE re-sends the stored note's save result", async () => {
  const h = exportHarness();
  const store = await vm.runInContext("storeP", h.context);
  await NF.saveLibraryKey(store.adapter, PASSPHRASE);
  const job = await P.createJob({ jobId: "job-done0001", store });
  for (const s of P.STATES.slice(1)) await job.transition(s);
  await LIB.saveResult(store, { packageId: "job-done0001", meta: { packageId: "job-done0001", title: "강의", host: "lms.example.com", source: "background", tier: "paid", status: "complete", options: {} }, note: FAKE_NOTE, crops: {} });
  const r = await h.send(RUN("job-done0001"));
  assert.deepEqual(r, { ok: true, already: true, state: "done" });
  assert.equal(h.runs.length, 0, "인식·노트를 다시 돌리지 않는다");
  assert.equal(h.mes, 0, "서비스도 부르지 않는다");
  await h.until(() => h.done().length === 1);
  const [done] = h.done();
  assert.deepEqual([done.status, done.packageId, done.saved], ["done", "job-done0001", "file"], "끝난 작업과 같은 결말 모양 — background가 절전 방지를 풀고 패널에 저장 상자를 그린다");
  assert.equal(h.sent.filter(m => m.type === "LIB_EXPORT").length, 1, "저장된 노트 파일을 다시 내보낸다");
  // 자리를 차지하지 않는다 — 다음 작업을 바로 받는다
  assert.equal((await h.send(RUN("job-newbie01"))).ok, true);
});

test("a BG_RUN that cannot reach the service starts nothing and frees the slot", async () => {
  const h = bgHarness({ globals: { ServiceClient: { me: async () => { throw new Error("서비스 연결을 먼저 설정하세요."); } } } });
  const r = await h.send(RUN());
  assert.equal(r.ok, false);
  assert.match(r.error, /서비스 연결/);
  assert.equal(r.busy, undefined, "자리를 차지하지 않았으니 background 가 절전 방지를 푼다");
  assert.equal(h.runs.length, 0);
  assert.equal((await h.send(RUN())).ok, false, "busy 가 아니라 같은 오류로 다시 시도된다");
});

test("BG_DONE carries codes, counts and notice counts only - never the note, ranges or ids", async () => {
  const h = bgHarness();
  await h.send(RUN());
  await h.until(() => h.runs.length === 1);
  h.runs[0].done.resolve({ status: "partial", code: undefined, note: { sections: [{ title: "SENTINEL 강의 내용" }] }, rendered: "SENTINEL", notices: [{ code: "NOTE_CAPTURE_GAP", count: 2, ranges: [{ t0: 1, t1: 2 }], ids: ["U3"] }, { code: "NOTE_X" }], stats: { slides: 5, chunks: 4, gaps: 2, segments: 9, peakBytes: 1, heldBytes: 0 } });
  await h.until(() => h.done().length === 1);
  const [done] = h.done();
  assert.deepEqual(done, { target: "background", type: "BG_DONE", jobId: "job-12345678", packageId: null, status: "partial", code: null, reason: null, suggest: null, message: null, saved: null, stats: { slides: 5, chunks: 4, gaps: 2 }, notices: [{ code: "NOTE_CAPTURE_GAP", count: 2 }, { code: "NOTE_X", count: null }] });
  assert.ok(!JSON.stringify(h.sent).includes("SENTINEL"));
});

test("BG_DONE tells the panel why a job stopped, in the pipeline's own Korean message, and suggests live mode only when the pipeline does", async () => {
  const finish = async result => {
    const h = bgHarness();
    await h.send(RUN());
    await h.until(() => h.runs.length === 1);
    h.runs[0].done.resolve(result);
    await h.until(() => h.done().length === 1);
    return h.done()[0];
  };
  const protectedJob = await finish({ status: "failed", code: "SRC_PROTECTED", reason: null, suggest: "live" });
  assert.equal(protectedJob.suggest, "live");
  assert.equal(protectedJob.message, P.CODES.SRC_PROTECTED.userMessage);
  const paused = await finish({ status: "paused", code: "NET_UNREACHABLE", reason: "network" });
  assert.deepEqual([paused.status, paused.reason, paused.suggest, paused.message], ["paused", "network", null, P.CODES.NET_UNREACHABLE.userMessage]);
  // 요약 동의가 없어 인식 결과만 남은 작업은 사용자 사유의 일시정지로 보인다
  const consent = await finish({ status: "recognition-only", note: null, notices: [{ code: "CONSENT_SUMMARY_REQUIRED" }] });
  assert.deepEqual([consent.status, consent.code, consent.reason, consent.message], ["paused", "CONSENT_SUMMARY_REQUIRED", "user", P.CODES.CONSENT_SUMMARY_REQUIRED.userMessage]);
  // 코드 없는 오류(버그)는 내용 없이 UNKNOWN 으로 알리고, 자리는 비워 둔다
  const h = bgHarness({ globals: { BackgroundJob: { runBackground: async () => { throw new Error("SENTINEL secret detail"); } } } });
  await h.send(RUN());
  await h.until(() => h.done().length === 1);
  assert.deepEqual([h.done()[0].status, h.done()[0].code], ["failed", "UNKNOWN"]);
  assert.ok(!JSON.stringify(h.sent).includes("SENTINEL"));
  assert.equal((await h.send(RUN("job-cccccccc"))).ok, true);
});

test("the fetch wrapper asks background to allow a host in the Referer rule before the first request to it", async () => {
  const h = bgHarness();
  await h.send(RUN());
  await h.until(() => h.runs.length === 1);
  const fetchIt = h.runs[0].deps.fetch, asks = () => h.sent.filter(m => m.type === "BG_REFERER");
  await fetchIt("https://cdn-a.example.com/master.m3u8", { credentials: "include", headers: {}, cache: "no-store" });
  assert.equal(asks().length, 1);
  assert.deepEqual(asks()[0], { target: "background", type: "BG_REFERER", host: "cdn-a.example.com", referer: "https://lms.example.com/watch?id=7" });
  assert.equal(h.fetched[0].askedBefore, 1, "규칙을 건 뒤에 요청이 나갔다");
  assert.equal(h.fetched[0].init.cache, "no-store");
  assert.equal(h.fetched[0].init.credentials, "include");
  await fetchIt("https://cdn-a.example.com/seg1.ts", {});
  assert.equal(asks().length, 1, "이미 올린 호스트는 다시 묻지 않는다");
  assert.equal(h.fetched[1].init.cache, "no-store", "init 에 없어도 HTTP 캐시를 쓰지 않는다");
  await fetchIt("https://cdn-b.example.com:8443/seg2.ts", {});
  assert.deepEqual(asks().map(m => m.host), ["cdn-a.example.com", "cdn-b.example.com"]);
  assert.equal(h.fetched[2].askedBefore, 2);
});

test("the fetch wrapper waits for the reply, serializes host additions, and refuses on failure without fetching", async () => {
  let gate = defer(), inflight = 0, overlap = 0;
  const h = bgHarness();
  h.referer = async () => { inflight++; overlap = Math.max(overlap, inflight); await gate.promise; inflight--; return { ok: true }; };
  await h.send(RUN());
  await h.until(() => h.runs.length === 1);
  const fetchIt = h.runs[0].deps.fetch;
  const a = fetchIt("https://cdn-a.example.com/1.ts", {}), a2 = fetchIt("https://cdn-a.example.com/2.ts", {}), b = fetchIt("https://cdn-b.example.com/1.ts", {});
  await h.until(() => h.sent.some(m => m.type === "BG_REFERER"));
  assert.equal(h.fetched.length, 0, "답이 오기 전에는 요청이 나가지 않는다");
  assert.equal(h.sent.filter(m => m.type === "BG_REFERER").length, 1, "다른 호스트의 요청은 앞 호스트의 답을 기다린다");
  gate.resolve();
  await Promise.all([a, a2, b]);
  assert.deepEqual(h.sent.filter(m => m.type === "BG_REFERER").map(m => m.host), ["cdn-a.example.com", "cdn-b.example.com"], "같은 호스트는 한 번만");
  assert.equal(overlap, 1, "규칙 갱신이 겹치지 않는다");
  assert.equal(h.fetched.length, 3);
  // 규칙을 걸지 못하면 그 호스트로는 요청을 보내지 않는다. 코드가 있어 수신기가 재시도하지 않고 작업이 멈춘다.
  h.referer = async () => ({ ok: false, error: "요청 도메인 목록이 올바르지 않습니다." });
  await assert.rejects(() => fetchIt("https://cdn-c.example.com/1.ts", {}), e => e.code === "SRC_BAD_URL" && /도메인/.test(e.message));
  await assert.rejects(() => fetchIt("https://cdn-c.example.com/2.ts", {}), e => e.code === "SRC_BAD_URL", "실패는 그 호스트에 대해 기억된다");
  await assert.rejects(() => fetchIt("chrome-extension://extension-id/manifest.json", {}), e => e.code === "SRC_BAD_URL");
  await assert.rejects(() => fetchIt("data:text/plain,x", {}), e => e.code === "SRC_BAD_URL");
  assert.equal(h.fetched.length, 3, "거절된 요청은 나가지 않았다");
  h.referer = async () => { throw new Error("Could not establish connection"); };
  await assert.rejects(() => fetchIt("https://cdn-d.example.com/1.ts", {}), e => e.code === "SRC_BAD_URL");
});

test("BG_LIST reports unfinished jobs by id, state and code only, and whether the account may use background processing", async () => {
  const h = bgHarness();
  const store = await vm.runInContext("storeP", h.context);
  const mk = async (jobId, steps) => { const job = await P.createJob({ jobId, store }); for (const [to, opts] of steps) await job.transition(to, opts); };
  await mk("job-created1", []);
  await mk("job-paused01", [["acquiring_source"], ["ingesting"], ["paused", { reason: "network", code: "NET_UNREACHABLE" }]]);
  await mk("job-failed01", [["failed", { code: "SRC_PROTECTED" }]]);
  await mk("job-cancel01", [["cancelled"]]);
  await store.putJson("packages", "job-paused01:sd:0", { blocks: [{ text: "SENTINEL 강의 내용" }] });
  const list = await h.send({ type: "BG_LIST", settings: SETTINGS });
  assert.equal(list.ok, true);
  assert.equal(list.background, true);
  assert.deepEqual(list.jobs.map(j => j.jobId).sort(), ["job-created1", "job-failed01", "job-paused01"], "실패한 작업은 다시 열 수 있으니 싣는다 — 완료·취소만 숨긴다");
  assert.deepEqual(list.jobs.find(j => j.jobId === "job-paused01"), { jobId: "job-paused01", state: "paused", code: "NET_UNREACHABLE", running: false });
  assert.ok(!JSON.stringify(list).includes("SENTINEL"));
  assert.deepEqual(Object.keys(list.jobs[0]).sort(), ["code", "jobId", "running", "state"]);
  await h.send(RUN("job-created1"));
  await h.until(() => h.runs.length === 1);
  assert.equal((await h.send({ type: "BG_LIST", settings: SETTINGS })).jobs.find(j => j.jobId === "job-created1").running, true);
  // 요금제가 background 를 허용하지 않거나 서비스에 닿지 않으면 컨트롤을 보이지 않는다
  const free = bgHarness({ me: { features: [] } });
  assert.equal((await free.send({ type: "BG_LIST", settings: SETTINGS })).background, false);
  const offline = bgHarness({ globals: { ServiceClient: { me: async () => { throw new Error("offline"); } } } });
  const r = await offline.send({ type: "BG_LIST", settings: SETTINGS });
  assert.deepEqual([r.ok, r.background, r.jobs], [true, false, []]);
});

test("paintMasks fills each normalized box with the median colour of the ring around it and re-encodes JPEG", async () => {
  const W = 40, H = 20, base = new Uint8ClampedArray(W * H * 4);
  const set = (data, x, y, c) => data.set([...c, 255], (y * W + x) * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) set(base, x, y, [200, 100, 50]);
  for (let y = 5; y < 10; y++) for (let x = 10; x < 20; x++) set(base, x, y, [0, 0, 0]); // 워터마크
  set(base, 8, 7, [0, 0, 0]); // 띠에 낀 이상치 하나: 평균이면 색이 흔들리고 중앙값이면 그대로다
  set(base, 30, 15, [1, 2, 3]); // 상자 밖의 내용은 그대로여야 한다
  let canvas = null, encoded = null;
  class FakeCanvas {
    constructor(w, h) { this.w = w; this.h = h; this.data = new Uint8ClampedArray(w * h * 4); canvas = this; }
    getContext() {
      const c = this;
      return {
        drawImage: img => c.data.set(img.data),
        getImageData: (x, y, w, h) => { const out = []; for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) out.push(...c.data.slice((j * c.w + i) * 4, (j * c.w + i) * 4 + 4)); return { data: Uint8ClampedArray.from(out) }; },
        fillRect: (x, y, w, h) => { const [r, g, b] = /rgb\((\d+),(\d+),(\d+)\)/.exec(c.fill).slice(1).map(Number); for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) c.data.set([r, g, b, 255], (j * c.w + i) * 4); },
        set fillStyle(v) { c.fill = v; },
      };
    }
    async convertToBlob(o) { encoded = o; return new Blob(["jpeg"], { type: o.type }); }
  }
  const h = bgHarness({ globals: { createImageBitmap: async () => ({ width: W, height: H, data: base, close() {} }), OffscreenCanvas: FakeCanvas } });
  const paint = vm.runInContext("paintMasks", h.context);
  const blob = await paint(new Blob(["x"]), [{ x: 10 / W, y: 5 / H, w: 10 / W, h: 5 / H }, { x: 0.9, y: 0.9, w: 0.5, h: 0.5 }]); // 둘째 상자는 이미지 가장자리를 넘는다
  const at = (x, y) => [...canvas.data.slice((y * W + x) * 4, (y * W + x) * 4 + 3)];
  for (const [x, y] of [[10, 5], [19, 9], [14, 7]]) assert.deepEqual(at(x, y), [200, 100, 50], `상자 안 (${x},${y})`);
  assert.deepEqual(at(9, 7), [200, 100, 50], "상자 밖(띠)은 칠하지 않는다");
  assert.deepEqual(at(8, 7), [0, 0, 0], "이상치는 그대로 남는다");
  assert.deepEqual(at(30, 15), [1, 2, 3]);
  assert.deepEqual(at(39, 19), [200, 100, 50], "가장자리 상자도 띠의 중앙값으로 칠한다");
  assert.equal(encoded.type, "image/jpeg");
  assert.equal(blob.type, "image/jpeg");
});

// ── 로컬 데이터 관리(options.html 데이터 관리 카드): 키 폐기·진단 로그 열람·삭제 ──
// 실제 PackageStore 와 메모리 어댑터를 쓴다. 저장소 객체의 key 가 바뀌어야 로그 싱크와 작업이 낡은 키로 쓰지 않는다.
const wipeHarness = async (adapter = PS.memoryAdapter()) => {
  // 로그 싱크가 쓰는 타이머. 5초 타이머가 시험 프로세스를 붙잡지 않게 unref 한다.
  const timers = { setTimeout: (fn, ms) => setTimeout(fn, ms).unref(), clearTimeout };
  const h = tokenHarness({ PackageStore: { indexedDbAdapter: async () => adapter, createStore: PS.createStore }, ...timers });
  h.adapter = adapter;
  h.store = await vm.runInContext("storeP", h.context);
  h.run = code => vm.runInContext(code, h.context);
  h.ask = (type, extra) => h.send({ target: "session", type, ...extra }, "background.js").then(r => JSON.parse(JSON.stringify(r)));
  return h;
};
const ids = async (adapter, store) => (await adapter.entries(store)).map(([id]) => id);

test("WIPE_LOCAL crypto-shreds every store: old ciphertext stays unreadable and the log sink continues with the new key", async () => {
  const h = await wipeHarness(), { adapter, store } = h;
  await store.putJson("packages", "pkg:note", { text: "synthetic note" });
  await store.putBytes("blobs", "pkg:crop", new Uint8Array([1, 2, 3]));
  await store.putJson("jobs", "job-1", { state: "recognizing" });
  h.run(`events.emit({stage:"system",code:"BEFORE_WIPE"})`);
  await h.run("sink.flush()");
  assert.equal((await store.readLogs()).length, 1);
  const oldKey = await adapter.get("keys", "device"), oldRecord = await adapter.get("packages", "pkg:note");

  assert.deepEqual(await h.ask("WIPE_LOCAL"), { ok: true });
  for (const name of ["packages", "blobs", "jobs", "logs"]) assert.deepEqual(await ids(adapter, name), [], `${name} 이 비었다`);
  const newKey = await adapter.get("keys", "device");
  assert.ok(newKey && newKey !== oldKey, "기기 키가 새로 만들어졌다");
  assert.equal(store.key, newKey, "offscreen 의 저장소 객체가 새 키를 쥐고 옛 키는 놓았다");

  // 옛 암호문이 어딘가(백업·디스크 조각)에서 되돌아와도 새 키로는 열리지 않는다
  await adapter.put("packages", "pkg:note", oldRecord);
  await assert.rejects(store.getJson("packages", "pkg:note"), /보관 데이터가 손상/);

  // 지운 뒤에도 로그 싱크는 새 키로 쓰고 읽는다
  h.run(`events.emit({stage:"system",code:"AFTER_WIPE"})`);
  await h.run("sink.flush()");
  assert.deepEqual((await store.readLogs()).map(e => e.code), ["AFTER_WIPE"]);
});

test("WIPE_LOCAL is refused while a capture or background job is running, and dryRun never wipes", async () => {
  const h = await wipeHarness(), { adapter, store } = h;
  await store.putJson("packages", "pkg:note", { text: "synthetic note" });
  const key = await adapter.get("keys", "device");
  const intact = async () => { assert.deepEqual(await store.getJson("packages", "pkg:note"), { text: "synthetic note" }); assert.equal(await adapter.get("keys", "device"), key); };
  const session = status => `session={status:"${status}",id:"s",generation:1,state(){return{};}}`;
  const busy = [["session " + "preparing", session("preparing")], ["session running", session("running")], ["session paused", session("paused")], ["session draining", session("draining")], ["session summarizing", session("summarizing")],
    ["starting", "starting=true"], ["archive", "archiveBusy=true"], ["summary", "summaryController={abort(){}}"], ["background job", `bg={jobId:"job-1",ctl:{abort(){}}}`]];
  for (const [name, code] of busy) {
    h.run(code);
    const r = await h.ask("WIPE_LOCAL");
    assert.equal(r.ok, false, name);
    assert.match(r.error, /진행 중/, name);
    await intact();
    h.run("session=null;starting=false;archiveBusy=false;summaryController=null;bg=null");
  }
  h.run(session("completed"));
  assert.deepEqual(await h.ask("WIPE_LOCAL", { dryRun: true }), { ok: true }, "끝난 세션은 막지 않는다");
  await intact(); // dryRun 은 확인만 한다
  h.run(session("running"));
  assert.equal((await h.ask("WIPE_LOCAL", { dryRun: true })).ok, false, "dryRun 도 진행 중이면 거절한다");
  h.run("session=null");
  assert.deepEqual(await h.ask("WIPE_LOCAL"), { ok: true });
  assert.deepEqual(await ids(adapter, "packages"), []);
});

test("while the wipe runs, no capture, background job, archive or second wipe can start", async () => {
  const adapter = PS.memoryAdapter(), gate = defer(), clear = adapter.clear;
  adapter.clear = async name => { await gate.promise; return clear(name); };
  const h = await wipeHarness(adapter);
  await h.store.putJson("packages", "pkg:note", { text: "synthetic note" });
  const first = h.ask("WIPE_LOCAL");
  for (let i = 0; i < 100 && !h.run("archiveBusy"); i++) await new Promise(r => setImmediate(r));
  assert.equal(h.run("archiveBusy"), true);
  const blocked = [await h.ask("WIPE_LOCAL"), await h.ask("START_SESSION", { streamId: "s", settings: {}, options: { tabId: 1 } }), await h.ask("LIB_REGENERATE", { packageId: "Lregen-1", settings: {} }),
    await h.ask("BG_RUN", { jobId: "job-12345678", source: { playlistUrl: "https://cdn.example.com/a.m3u8", pageUrl: "https://lms.example.com/" }, settings: {} })];
  for (const r of blocked) assert.equal(r.ok, false);
  gate.resolve();
  assert.deepEqual(await first, { ok: true });
  assert.equal(h.run("archiveBusy"), false, "끝나면 풀린다");
  assert.deepEqual(await h.ask("WIPE_LOCAL"), { ok: true });
});

test("WIPE_LOCAL, LOGS_READ and LOGS_CLEAR are accepted from background.js only", async () => {
  const h = await wipeHarness(), { adapter, store } = h;
  await store.putJson("packages", "pkg:note", { text: "synthetic note" });
  h.run(`events.emit({stage:"system",code:"KEEP_ME"})`);
  await h.run("sink.flush()");
  const key = await adapter.get("keys", "device"), base = "chrome-extension://extension-id/";
  const senders = [{ id: "extension-id", url: base + "sidepanel.html" }, { id: "extension-id", url: base + "options.html" }, { id: "extension-id", url: base + "offscreen.html" }, { id: "extension-id", url: base + "admin.html" },
    { id: "extension-id", url: base + "background.js.evil" }, { id: "extension-id", url: "https://evil.example/background.js" }, { id: "other", url: base + "background.js" }, { id: "extension-id" }, undefined];
  for (const sender of senders) for (const type of ["WIPE_LOCAL", "LOGS_READ", "LOGS_CLEAR"]) {
    const r = JSON.parse(JSON.stringify(await h.raw({ target: "session", type }, sender)));
    assert.equal(r.ok, false, `${type} from ${sender?.url}`);
    assert.equal(r.events, undefined, "거절된 요청에는 로그를 주지 않는다");
  }
  assert.deepEqual(await store.getJson("packages", "pkg:note"), { text: "synthetic note" });
  assert.equal(await adapter.get("keys", "device"), key);
  assert.deepEqual((await store.readLogs()).map(e => e.code), ["KEEP_ME"]);
  assert.equal((await h.ask("LOGS_READ")).ok, true);
  assert.equal((await h.ask("WIPE_LOCAL")).ok, true);
});

test("LOGS_READ includes events still in the sink buffer; LOGS_CLEAR deletes only the logs and nothing flushes back", async () => {
  const h = await wipeHarness(), { adapter, store } = h;
  await store.putJson("packages", "pkg:note", { text: "synthetic note" });
  const key = await adapter.get("keys", "device");
  h.run(`events.emit({stage:"stt",code:"FIRST",level:"warn"});events.emit({stage:"stt",code:"SECOND",level:"error",ms:5})`);
  const read = await h.ask("LOGS_READ");
  assert.deepEqual(read.events.map(e => e.code), ["FIRST", "SECOND"], "아직 저장 전인 최근 이벤트도 담긴다");

  h.run(`events.emit({stage:"stt",code:"BUFFERED",level:"warn"})`);
  assert.deepEqual(await h.ask("LOGS_CLEAR"), { ok: true });
  await h.run("sink.flush()");
  assert.deepEqual(await ids(adapter, "logs"), [], "지운 뒤 늦은 쓰기가 되살리지 않는다");
  assert.deepEqual(await store.getJson("packages", "pkg:note"), { text: "synthetic note" }, "로그 밖은 그대로");
  assert.equal(await adapter.get("keys", "device"), key, "키도 그대로");
  h.run(`events.emit({stage:"stt",code:"LATER",level:"warn"})`);
  assert.deepEqual((await h.ask("LOGS_READ")).events.map(e => e.code), ["LATER"], "삭제 뒤에도 로그는 계속 쌓인다");
});

// ── LIB_REGENERATE: 보관함 패키지의 저장 입력으로 노트를 다시 만든다 ──
const LIB = require("./library.js"), NC = require("./note-contract.js");
const regenHarness = (over = {}) => bgHarness({ ...over, globals: { NoteLibrary: LIB, NoteContract: NC, ...over.globals } });
const FAKE_NOTE = { sections: [], status: "complete", meta: { processed: { t0: 0, t1: 60 } }, noteSpecVersion: "lecture-note-2" };
const REGEN = (extra = {}) => ({ type: "LIB_REGENERATE", packageId: "Lregen-1", options: { syntheticExamples: false, externalAugmentation: false }, settings: SETTINGS, ...extra });
const seedRegen = async (h, { status = "complete", note = FAKE_NOTE, options = {}, input } = {}) => {
  const store = await vm.runInContext("storeP", h.context);
  await LIB.saveResult(store, {
    packageId: "Lregen-1",
    meta: { packageId: "Lregen-1", title: "강의", host: "lms.example.com", source: "background", tier: "paid", status, options },
    input: input ?? { tier: "paid", slides: [], transcript: { segments: [] }, gaps: [], models: { plan: "x", write: "x", judge: null }, consent: { summary: false }, options: { old: true } },
    note, crops: { G1: new Uint8Array([7, 7]) },
  });
  return store;
};

test("LIB_REGENERATE is accepted from background.js only; other senders touch nothing", async () => {
  const h = regenHarness();
  await seedRegen(h);
  for (const url of ["sidepanel.html", "options.html", "note.html", "admin.html", "offscreen.html"]) {
    const r = await h.send(REGEN(), url);
    assert.equal(r.ok, false, url);
  }
  assert.equal(h.mes, 0, "서비스를 부르지 않는다");
  assert.equal(h.notes.length, 0, "runNote 를 부르지 않는다");
  // 저장 입력이 없는 패키지는 이유를 알려 거절한다
  const h2 = regenHarness();
  assert.match((await h2.send(REGEN())).error, /다시 만들 자료가 없습니다/);
});

test("LIB_REGENERATE refuses without summary consent and never calls the service", async () => {
  const h = regenHarness();
  await seedRegen(h);
  const r = await h.send(REGEN({ settings: { ...SETTINGS, remoteSummaryConsent: false } }));
  assert.equal(r.ok, false);
  assert.match(r.error, /외부 요약 처리 동의/);
  assert.equal(h.mes, 0);
  assert.equal(h.notes.length, 0);
});

test("LIB_REGENERATE refuses generation options on a free account", async () => {
  const h = regenHarness({ me: { features: [], models: ["model-m"] }, globals: { NoteStages: { runNote: async (job, input, deps) => (h.notes.push({ job, input, deps }), { status: "complete", note: FAKE_NOTE, notices: [] }) } } });
  await seedRegen(h);
  const r = await h.send(REGEN({ options: { syntheticExamples: true, externalAugmentation: false } }));
  assert.equal(r.ok, false);
  assert.match(r.error, /유료 기능/);
  assert.equal(h.notes.length, 0);
  // 무료 계정이라도 옵션이 꺼져 있으면(인식 결과 → 노트화) 실행한다
  assert.equal((await h.send(REGEN())).ok, true);
  assert.equal(h.notes[0].input.tier, "paid", "계정이 아니라 저장 입력의 tier 를 그대로 쓴다");
});

test("LIB_REGENERATE reruns runNote with the chosen options, sets consent and saves meta; stored crops survive", async () => {
  const notes = [];
  let map = true;
  const h = regenHarness({ globals: { NoteStages: { runNote: async (job, input, deps) => (notes.push({ job, input, deps }), { status: "complete", note: FAKE_NOTE, cropMap: map ? { G1: "s1/f1" } : {}, notices: [] }) } } });
  const store = await seedRegen(h);
  await store.putBytes("blobs", "Lregen-1:c:s1_f1", new Uint8Array([4, 2]));
  const r = await h.send(REGEN({ options: { syntheticExamples: true, externalAugmentation: true } }));
  assert.equal(r.ok, true, r.error);
  assert.equal(r.status, "complete");
  const { input, deps } = notes[0];
  const plain = JSON.parse(JSON.stringify(input)); // vm 영역을 넘은 객체는 prototype 이 달라 deepEqual 전에 평범한 값으로
  assert.deepEqual(plain.options, { syntheticExamples: true, externalAugmentation: true }, "새 옵션으로 돌린다");
  assert.equal(plain.consent.summary, true, "요약 동의를 확인한 뒤에만 온 요청이라 반영한다");
  assert.deepEqual(plain.models, { plan: "model-m", write: "model-m", writeAlt: null, judge: "typesafe/jev-1.13" }, "모델은 계정 /v1/me 에서 고른다");
  for (const n of ["plan", "write", "judge"]) assert.equal(typeof deps.service[n], "function");
  assert.equal(typeof deps.katex.renderToString, "function", "katex 는 전역에서 온다");
  const data = await LIB.load(store, "Lregen-1");
  assert.equal(data.meta.options.syntheticExamples, true, "메타 옵션이 새 선택을 반영한다");
  assert.equal(data.meta.status, "complete");
  assert.deepEqual([...(await store.getBytes("blobs", "Lregen-1:crop:G1"))], [4, 2], "cropMap 이 남아 있던 c: 블롭을 crop id로 다시 옮긴다");
  assert.deepEqual([...(await store.getBytes("blobs", "Lregen-1:c:s1_f1"))], [4, 2], "원본 c: 블롭도 남는다");
  // cropMap 이 없는 재생성도 저장된 크롭을 지우지 않는다
  map = false;
  assert.equal((await h.send(REGEN())).ok, true);
  assert.deepEqual([...(await store.getBytes("blobs", "Lregen-1:crop:G1"))], [4, 2], "saveResult 는 크롭을 지우지 않는다");
});

test("LIB_REGENERATE never overwrites an existing note with a noteless result", async () => {
  // 인식만 끝나고 돌아오면(이론상: summary 동의를 강제해도) 노트를 지우며 저장하면 안 된다 — saveResult 는 note==null 을 삭제로 읽는다.
  const h = regenHarness({ globals: { NoteStages: { runNote: async () => ({ status: "recognition-only", recognition: { engine: "local" }, notices: [] }) } } });
  const store = await seedRegen(h);
  const r = await h.send(REGEN());
  assert.equal(r.ok, false);
  assert.deepEqual(JSON.parse(JSON.stringify((await LIB.load(store, "Lregen-1")).note)), FAKE_NOTE, "기존 노트가 지워지지 않는다");
});

test("LIB_REGENERATE refuses while a background job or another regeneration runs", async () => {
  const h = regenHarness();
  await seedRegen(h);
  await h.send(RUN("job-aaaaaaaa"));
  await h.until(() => h.runs.length === 1);
  const refused = await h.send(REGEN());
  assert.equal(refused.ok, false);
  assert.equal(refused.busy, true, "background 가 절전 방지를 그대로 둔다");
  assert.equal(h.notes.length, 0);
  h.runs[0].done.resolve({ status: "complete", notices: [] });
  await h.until(() => h.done().length === 1);

  // 재생성이 도는 동안 두 번째 재생성·새 백그라운드 작업·데이터 지우기 모두 거절된다
  const entered = defer(), release = defer();
  const h2 = regenHarness({ globals: { NoteStages: { runNote: async () => { entered.resolve(); await release.promise; return { status: "complete", note: FAKE_NOTE, notices: [] }; } } } });
  await seedRegen(h2);
  const pending = h2.send(REGEN());
  await entered.promise;
  const second = await h2.send(REGEN());
  assert.equal(second.ok, false);
  assert.equal(second.busy, true);
  const run = await h2.send(RUN("job-bbbbbbbb"));
  assert.equal(run.ok, false, "재생성 중 새 작업도 막힌다");
  assert.equal((await h2.send({ type: "WIPE_LOCAL" })).ok, false, "지우기도 막힌다");
  release.resolve();
  assert.equal((await pending).ok, true);
});

test("a noteless result never overwrites a stored note — saveLibrary is the last guard on live and background paths", async () => {
  // saveResult 는 note==null 을 삭제로 읽는다. 재생성은 앞에서 거절하지만, 백그라운드·실시간 경로는 saveLibrary 가 막는다.
  const h = regenHarness({ globals: { NoteStages: { runNote: async () => ({ status: "recognition-only", recognition: { engine: "local" }, notices: [] }) } } });
  const store = await vm.runInContext("storeP", h.context);
  await LIB.saveResult(store, { packageId: "job-12345678",
    meta: { packageId: "job-12345678", title: "강의", host: "lms", source: "background", tier: "paid", status: "complete", options: {} },
    input: { tier: "paid", slides: [], transcript: { segments: [] }, gaps: [], models: {}, consent: {}, options: {} },
    note: FAKE_NOTE, crops: {} });
  assert.equal((await h.send(RUN())).ok, true);
  await h.until(() => h.runs.length === 1);
  await h.runs[0].deps.runNote(h.runs[0].job, { slides: [] }, { signal: h.runs[0].deps.signal });
  const data = await LIB.load(store, "job-12345678");
  assert.deepEqual(JSON.parse(JSON.stringify(data.note)), FAKE_NOTE, "저장된 노트가 인식만 결과로 지워지지 않는다");
  const recent = JSON.parse(vm.runInContext("JSON.stringify(bus.recent(20))", h.context));
  assert.ok(recent.some(e => e.code === "LIBRARY_NOTE_KEPT"), "건너뛴 저장은 내용 없는 경고 이벤트로 남는다");
});

test("a crop region covering >90% of the frame is refused, not stored", async () => {
  // 불변식: 통째 슬라이드는 저장하지 않는다 — 비전이 준 bbox가 프레임 대부분이면 크롭을 거절하고 경고 코드만 남긴다.
  const h = bgHarness({ globals: {
    Figures: require("./figures.js"),
    createImageBitmap: async () => ({ width: 100, height: 100, close() {} }),
    OffscreenCanvas: class {
      constructor(w, h) { this.width = w; this.height = h; }
      getContext() { return { drawImage() {}, getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }) }; }
      async convertToBlob() { return { arrayBuffer: async () => new Uint8Array([1]).buffer }; }
    },
  } });
  assert.equal((await h.send(RUN())).ok, true);
  await h.until(() => h.runs.length === 1);
  const doc = { slideId: "s1", figures: [
    { id: "f1", kind: "table", bbox: { x: 0, y: 0, w: 0.98, h: 0.98 } },    // 면적 96% — 거절
    { id: "f2", kind: "chart", bbox: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 } },  // 면적 25% — 크롭
  ], formulas: [{ id: "m1", bbox: { x: 0, y: 0, w: 1, h: 1 } }] };
  const out = await h.runs[0].deps.crop(null, doc);
  assert.deepEqual(Object.keys(out.crops), ["s1/f2"], "프레임 대부분인 영역은 저장하지 않는다");
  assert.equal(out.formulas.length, 0, "수식 크롭도 같은 규칙");
  assert.ok(out.hashes["s1/f2"] && !out.hashes["s1/f1"], "거절한 영역의 지문도 남기지 않는다");
  const recent = JSON.parse(vm.runInContext("JSON.stringify(bus.recent(20))", h.context));
  assert.equal(recent.filter(e => e.code === "CROP_WHOLE_FRAME").length, 2, "거절마다 내용 없는 경고 이벤트");
});

// ── 노트 파일 내보내기(exportNote·LIB_EXPORT_ALL)·작업 버리기(BG_DISCARD)·페이지 제목 ──
const NF = require("./note-file.js");
const exportHarness = (over = {}) => bgHarness({ ...over, globals: { NoteFile: NF, NoteLibrary: LIB, ...over.globals } });
const PASSPHRASE = "0427";

test("exportNote reports no-passphrase without a library key and sends nothing", async () => {
  const h = exportHarness();
  const store = await vm.runInContext("storeP", h.context);
  const exportNote = vm.runInContext("exportNote", h.context);
  assert.equal(await exportNote(store, "Lexp-1", { packageId: "Lexp-1", title: "강의" }, FAKE_NOTE), "no-passphrase");
  assert.equal(h.sent.filter(m => m.type === "LIB_EXPORT").length, 0, "키가 없으면 아무것도 보내지 않는다");
  const recent = JSON.parse(vm.runInContext("JSON.stringify(bus.recent(20))", h.context));
  assert.ok(recent.some(e => e.code === "LIBRARY_NO_PASSPHRASE"), "내용 없는 경고 이벤트로 남는다");
});

test("exportNote sends LIB_EXPORT whose text decrypts back to the note", async () => {
  const h = exportHarness();
  const store = await vm.runInContext("storeP", h.context);
  await NF.saveLibraryKey(store.adapter, PASSPHRASE);
  const exportNote = vm.runInContext("exportNote", h.context);
  const meta = { packageId: "Lexp-1", title: "선형대수 3강" };
  assert.equal(await exportNote(store, "Lexp-1", meta, FAKE_NOTE), "file");
  const [msg] = h.sent.filter(m => m.type === "LIB_EXPORT");
  assert.equal(msg.target, "background");
  assert.equal(msg.packageId, "Lexp-1");
  assert.equal(msg.fileName, NF.fileName(meta));
  const payload = await NF.decryptFile(msg.text, PASSPHRASE);
  assert.deepEqual(payload.note, FAKE_NOTE);
  assert.equal(payload.meta.packageId, "Lexp-1");
  assert.deepEqual(payload.crops, {});
  // 내보내기 실패(연결 끊김)는 코드로만 남는다
  const h2 = exportHarness({ globals: { chrome: { runtime: { id: "extension-id", getURL: p => `chrome-extension://extension-id/${p}`, onMessage: { addListener() {} }, onConnect: { addListener() {} }, sendMessage: async () => { throw new Error("Could not establish connection"); } } } } });
  const store2 = await vm.runInContext("storeP", h2.context);
  await NF.saveLibraryKey(store2.adapter, PASSPHRASE);
  assert.equal(await vm.runInContext("exportNote", h2.context)(store2, "Lexp-1", meta, FAKE_NOTE), "failed");
  const recent = JSON.parse(vm.runInContext("JSON.stringify(bus.recent(20))", h2.context));
  assert.ok(recent.some(e => e.code === "LIBRARY_EXPORT_FAILED"));
});

test("LIB_EXPORT_ALL re-exports every stored note but needs the library passphrase first", async () => {
  const h = exportHarness();
  const store = await vm.runInContext("storeP", h.context);
  const refused = await h.send({ type: "LIB_EXPORT_ALL" });
  assert.equal(refused.ok, false);
  assert.match(refused.error, /보관함 PIN/);
  const mk = (pkg, note) => LIB.saveResult(store, { packageId: pkg, meta: { packageId: pkg, title: "t", host: "lms.example.com", source: "background", tier: "paid", status: "complete", options: {} }, note });
  await mk("Lexp-1", FAKE_NOTE);
  await mk("Lexp-2", null); // 인식만 — 노트가 없어 건너뛴다
  await mk("Lexp-3", FAKE_NOTE);
  await NF.saveLibraryKey(store.adapter, PASSPHRASE);
  assert.deepEqual(await h.send({ type: "LIB_EXPORT_ALL" }), { ok: true, count: 2, failed: 0 });
  assert.equal(h.sent.filter(m => m.type === "LIB_EXPORT").length, 2, "노트가 있는 패키지만 내보낸다");
});

test("BG_DISCARD deletes a stored job record, refuses the running job and malformed ids", async () => {
  const h = bgHarness();
  const store = await vm.runInContext("storeP", h.context);
  await store.putJson("jobs", "job-dead0001", { state: "paused", reason: "network" });
  assert.deepEqual(await h.send({ type: "BG_DISCARD", jobId: "job-dead0001" }), { ok: true });
  assert.equal(await store.getJson("jobs", "job-dead0001"), null, "레코드를 지웠다");
  assert.deepEqual(await h.send({ type: "BG_DISCARD", jobId: "job-dead0001" }), { ok: true }, "없는 번호를 지워도 오류가 아니다");
  assert.equal((await h.send({ type: "BG_DISCARD", jobId: "../etc" })).ok, false, "번호 모양은 검사한다");
  await h.send(RUN("job-12345678"));
  await h.until(() => h.runs.length === 1);
  const refused = await h.send({ type: "BG_DISCARD", jobId: "job-12345678" });
  assert.equal(refused.ok, false);
  assert.match(refused.error, /취소/);
  for (const url of ["sidepanel.html", "options.html"]) assert.equal((await h.send({ type: "BG_DISCARD", jobId: "job-dead0001" }, url)).ok, false, `${url} 는 못 보낸다`);
});

test("liveInput puts the live tab title into the note meta, trimmed and capped at 120 chars", async () => {
  const h = bgHarness();
  const liveInput = vm.runInContext("liveInput", h.context);
  const input = pageTitle => liveInput({ slideDocs: [], gaps: [], options: { whisperLang: "ko", whisperModel: "whisper-1", pageTitle }, store: { snapshot: () => [] } }, { tier: "free", models: {}, consent: {}, options: {} });
  assert.equal(input("  선형대수 3강  ").meta.title, "선형대수 3강");
  assert.equal(input("x".repeat(200)).meta.title.length, 120);
  for (const pageTitle of ["", "   ", null, undefined, 9]) assert.equal(input(pageTitle).meta.title, null, JSON.stringify(pageTitle));
});

test("a finished background job writes its own content-free diagnostic (DIAG_EXPORT) after BG_DONE", async () => {
  const h = bgHarness({ globals: { TextEncoder } });
  vm.runInContext(fs.readFileSync(path.join(root, "lib", "diagnostics.js"), "utf8"), h.context, { filename: "diagnostics.js" });
  assert.equal((await h.send(RUN("job-diag0001"))).ok, true);
  await h.until(() => h.runs.length === 1);
  vm.runInContext('events.emit({ stage: "job", jobId: "job-diag0001", level: "info", msg: "created" }); events.emit({ stage: "job", jobId: "job-other001", level: "info", msg: "created" })', h.context);
  h.runs[0].done.resolve({ status: "failed", code: "SRC_HTTP_404" });
  await h.until(() => h.sent.some(m => m.type === "DIAG_EXPORT"));
  const diag = h.sent.find(m => m.type === "DIAG_EXPORT");
  assert.ok(h.sent.findIndex(m => m.type === "BG_DONE") < h.sent.indexOf(diag), "결말을 먼저 알린다");
  assert.equal(diag.jobId, "job-diag0001");
  const bundle = JSON.parse(diag.text);
  assert.ok(bundle.events.length > 0);
  assert.ok(bundle.events.every(e => e.jobId === "job-diag0001"), "그 작업의 이벤트만 싣는다");
  assert.equal(bundle.env ?? null, null, "계정·환경 정보는 넣지 않는다");
  assert.equal(bundle.version, "1.0.0", "확장 버전을 싣는다");
});
