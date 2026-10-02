const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const root=path.resolve(__dirname,"..");
test("runtime-only offscreen summarizes with settings from its trusted message",async()=>{
  let listener,received;
  const context=vm.createContext({URL,AbortController,crypto,console,Map,chrome:{runtime:{id:"extension-id",getURL:p=>`chrome-extension://extension-id/${p}`,sendMessage:async()=>({ok:true}),onMessage:{addListener:fn=>{listener=fn;}},onConnect:{addListener(){}}}},PackageStore:{indexedDbAdapter:()=>Promise.reject(new Error("no idb"))},OpenRouterClient:{name:"openrouter"},ServiceClient:{name:"service"},SummaryPipeline:{generate:async(_evidence,options)=>{received=options;return{status:"recognition-only"};}}});
  // offscreen.js는 진단 이벤트 버스(lib/events.js)를 전제한다. 로그 저장소(IndexedDB)는 이 테스트에서 없는 것으로 둔다.
  vm.runInContext(fs.readFileSync(path.join(root,"lib","events.js"),"utf8"),context,{filename:"events.js"});
  vm.runInContext(fs.readFileSync(path.join(root,"offscreen.js"),"utf8"),context,{filename:"offscreen.js"});
  vm.runInContext(`session={status:"completed",id:"session-id",generation:1,error:null,summaryCache:null,summaryAttempt:0,store:{snapshot:()=>[]},publish:()=>{},log:()=>{},state(){return{sessionId:this.id,status:this.status,summary:this.summary||null};}}`,context);
  const settings={openRouterApiKey:"sk-or-v1-synthetic-test-key-123456",summaryModel:"synthetic-model",remoteSummaryConsent:true};
  const response=await new Promise(resolve=>listener({target:"session",type:"GENERATE_NOTES",settings},{id:"extension-id",url:"chrome-extension://extension-id/background.js"},resolve));
  assert.equal(response.ok,true);assert.equal(received.settings.openRouterApiKey,settings.openRouterApiKey);assert.equal(received.settings.summaryModel,settings.summaryModel);assert.equal(received.service.name,"openrouter");
  assert.equal(context.chrome.storage,undefined);
  assert.doesNotMatch(fs.readFileSync(path.join(root,"offscreen.html"),"utf8"),/lib\/settings\.js/);
});

test("admin-events port serves live events only to the extension's own admin page",async()=>{
  let listener,connect,mode="ok";
  const context=vm.createContext({URL,AbortController,crypto,console,Map,chrome:{runtime:{id:"extension-id",getURL:p=>`chrome-extension://extension-id/${p}`,sendMessage:async()=>({ok:true}),onMessage:{addListener:fn=>{listener=fn;}},onConnect:{addListener:fn=>{connect=fn;}}}},PackageStore:{indexedDbAdapter:()=>Promise.reject(new Error("no idb"))},OpenRouterClient:{},ServiceClient:{},SummaryPipeline:{generate:async()=>{if(mode==="fail")throw new Error("secret failure detail");return{status:"recognition-only"};}}});
  vm.runInContext(fs.readFileSync(path.join(root,"lib","events.js"),"utf8"),context,{filename:"events.js"});
  vm.runInContext(fs.readFileSync(path.join(root,"offscreen.js"),"utf8"),context,{filename:"offscreen.js"});
  vm.runInContext(`session={status:"completed",id:"session-id",generation:1,error:null,summaryCache:null,summaryAttempt:0,store:{snapshot:()=>[]},publish:()=>{},log:()=>{},state(){return{};}}`,context);
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
  const harness = { replies: [], asked: [], clients: [], summaryTokens: [], captured: null, stopped: 0 };
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
    PackageStore: { indexedDbAdapter: () => Promise.reject(new Error("no idb")) },
    OpenRouterClient: { name: "openrouter" },
    ServiceClient: {
      me: async client => { harness.clients.push(client); return { accountId: "account-1" }; },
      listEncrypted: async () => ({ items: [] }),
      summary: async options => { harness.summaryTokens.push(options.token); return { summary: {} }; },
    },
    SummaryPipeline: { generate: async (_evidence, options) => { harness.options = options; if (options.service.summary && options.settings.serviceUrl) { await options.service.summary({ token: "from-summary-pipeline" }); await options.service.summary({ token: "from-summary-pipeline" }); } return { status: "recognition-only" }; } },
    CaptureSession: class { constructor(init) { harness.captured = init; this.options = init.options; this.id = init.id; this.status = "completed"; } publish() {} async start() {} state() { return {}; } async dispose() {} },
    navigator: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop: () => { harness.stopped++; } }] }) } },
    ...extra,
  });
  vm.runInContext(fs.readFileSync(path.join(root, "lib", "events.js"), "utf8"), context, { filename: "events.js" });
  vm.runInContext(fs.readFileSync(path.join(root, "offscreen.js"), "utf8"), context, { filename: "offscreen.js" });
  harness.send = (message, url = "sidepanel.html") => new Promise(resolve => listener(message, { id: "extension-id", url: `chrome-extension://extension-id/${url}` }, resolve));
  harness.context = context;
  return harness;
}
const AUTH_ASK = { target: "background", type: "AUTH_TOKEN" };

test("archive calls prefer the logged-in token, then the static developer token", async () => {
  const h = tokenHarness();
  const list = settings => h.send({ target: "session", type: "LIST_VAULT", settings });
  const settings = { serviceUrl: "https://service.example", appSessionToken: "static-dev-token" };

  h.replies = [{ ok: true, token: "login-jwt" }];
  assert.equal((await list(settings)).ok, true);
  assert.equal(h.clients.at(-1).token, "login-jwt");
  assert.equal(h.clients.at(-1).baseUrl, "https://service.example");
  assert.deepEqual(h.asked, [AUTH_ASK], "토큰 요청은 이 한 가지 모양뿐이다");

  h.replies = [{ ok: true, token: null }];
  await list(settings);
  assert.equal(h.clients.at(-1).token, "static-dev-token", "로그아웃 상태면 정적 토큰");
  h.replies = [{ ok: true, token: "" }];
  await list(settings);
  assert.equal(h.clients.at(-1).token, "static-dev-token");

  for (const unreachable of [new Error("Could not establish connection"), undefined]) {
    h.replies = [unreachable];
    await list(settings);
    assert.equal(h.clients.at(-1).token, "static-dev-token", "background에 닿지 않으면 정적 토큰");
  }

  h.replies = [{ ok: true, token: null }];
  await list({ serviceUrl: "https://service.example" });
  assert.equal(h.clients.at(-1).token, "", "둘 다 없으면 빈 토큰(서비스 클라이언트가 연결 설정을 요구한다)");

  const before = h.asked.length;
  h.replies = [{ ok: true, token: "t1" }, { ok: true, token: "t2" }];
  await list(settings);
  await list(settings);
  assert.deepEqual(h.clients.slice(-2).map(c => c.token), ["t1", "t2"], "호출마다 새로 묻는다(offscreen이 토큰을 들고 있지 않는다)");
  assert.equal(h.asked.length - before, 2);
});

test("a token refresh failure surfaces as the error and does not fall back to the static token", async () => {
  const h = tokenHarness();
  const settings = { serviceUrl: "https://service.example", appSessionToken: "static-dev-token" };
  h.replies = [{ ok: false, error: "로그인이 만료되었거나 취소되었습니다. 설정에서 Google로 다시 로그인하세요." }];
  const failed = await h.send({ target: "session", type: "LIST_VAULT", settings });
  assert.equal(failed.ok, false);
  assert.match(failed.error, /다시 로그인/);
  assert.equal(h.clients.length, 0, "정적 토큰으로 서비스를 호출하지 않았다");
  h.replies = [{ ok: true, token: "login-jwt" }];
  assert.equal((await h.send({ target: "session", type: "LIST_VAULT", settings })).ok, true, "오류 뒤에도 보관 작업이 잠기지 않는다");
});

test("summary resolves the token for every service call, never for the BYOK path", async () => {
  const h = tokenHarness();
  const sendNotes = settings => h.send({ target: "session", type: "GENERATE_NOTES", settings });
  vm.runInContext(`session={status:"completed",id:"session-id",generation:1,error:null,summaryCache:null,summaryAttempt:0,store:{snapshot:()=>[]},publish:()=>{},log:()=>{},state(){return{status:this.status};}}`, h.context);

  h.replies = [{ ok: true, token: "jwt-1" }, { ok: true, token: "jwt-2" }, { ok: true, token: "jwt-3" }];
  const response = await sendNotes({ serviceUrl: "https://service.example", appSessionToken: "static-dev-token", remoteSummaryConsent: true });
  assert.equal(response.ok, true);
  assert.equal(h.options.settings.appSessionToken, "jwt-1", "연결 여부 판단용으로 시작 때 한 번 푼다");
  assert.deepEqual(h.summaryTokens, ["jwt-2", "jwt-3"], "서비스 호출마다 새로 받는다 - 긴 요약이 중간에 만료되지 않는다");

  h.asked.length = 0; h.summaryTokens.length = 0;
  h.replies = [{ ok: true, token: "jwt-x" }];
  await sendNotes({ openRouterApiKey: "sk-or-v1-synthetic-test-key-123456", serviceUrl: "https://service.example", appSessionToken: "static-dev-token", remoteSummaryConsent: true });
  assert.equal(h.options.service.name, "openrouter");
  assert.equal(h.asked.length, 0, "BYOK는 서비스 토큰을 묻지 않는다");

  await sendNotes({ appSessionToken: "static-dev-token", remoteSummaryConsent: true });
  assert.equal(h.asked.length, 0, "서비스 주소가 없으면 묻지 않는다");
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
  assert.equal(await options.getToken(), "static-dev-token", "로그아웃되면 정적 토큰");

  // 로컬 인식은 서비스를 쓰지 않으므로 로그인 상태나 갱신 실패와 무관하게 시작한다.
  h.asked.length = 0;
  h.replies = [{ ok: false, error: "로그인이 만료되었거나 취소되었습니다." }];
  assert.equal((await start(settings, { ocrEngine: "ppocr-v5-wasm", tabId: 7 })).ok, true);
  assert.equal(h.asked.length, 0);
  assert.equal(h.captured.options.appSessionToken, "static-dev-token");
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

test("offscreen never reads storage or loads the auth module", () => {
  const html = fs.readFileSync(path.join(root, "offscreen.html"), "utf8");
  assert.doesNotMatch(html, /lib\/(settings|auth)\.js/);
  const code = fs.readFileSync(path.join(root, "offscreen.js"), "utf8").split("\n").filter(line => !line.trimStart().startsWith("//")).join("\n");
  assert.doesNotMatch(code, /chrome\.storage|\bAuth\./);
});
