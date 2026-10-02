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
  assert.doesNotMatch(html, /lib\/auth\.js/);
  // settings.js는 동의 판정 함수(backgroundAllowed·cloudRecognitionAllowed)를 background-job.js가 전역에서 찾기 때문에 싣는다. 저장소를 읽고 쓰는 함수는 offscreen.js가 부르지 않는다.
  const code = fs.readFileSync(path.join(root, "offscreen.js"), "utf8").split("\n").filter(line => !line.trimStart().startsWith("//")).join("\n");
  assert.doesNotMatch(code, /chrome\.storage|\bAuth\.|\b(load|save)(Settings|AuthSession)\b/);
});

// ── 유료 백그라운드 작업 ──
test("offscreen loads the background job's scripts in dependency order and no script redefines another's globals", () => {
  const html = fs.readFileSync(path.join(root, "offscreen.html"), "utf8"), srcs = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
  const at = name => srcs.indexOf(name.includes("/") || name === "offscreen.js" ? name : `lib/${name}.js`);
  const before = (a, b) => { assert.ok(at(a) >= 0 && at(b) >= 0, `${a} ${b} 가 offscreen.html 에 없다`); assert.ok(at(a) < at(b), `${a} 는 ${b} 보다 먼저 실려야 한다`); };
  before("settings", "background-job"); // backgroundAllowed·cloudRecognitionAllowed 를 전역에서 찾는다
  before("lib/vendor/mux/mux-mp4.min.js", "media-demux"); // 전역 muxjs
  before("lib/vendor/katex/katex.min.js", "stages"); // runNote 에 넘기는 전역 katex
  for (const dep of ["pipeline", "verify", "boilerplate", "formulas", "preprocess", "contracts", "note-spec"]) before(dep, "stages");
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
  for (const name of ["Pipeline", "NoteStages", "LectureMedia", "LectureDemux", "LectureDecode", "BackgroundJob", "katex", "muxjs", "backgroundAllowed", "cloudRecognitionAllowed"]) assert.ok(owner.has(name), `${name} 이 전역에 없다`);
});

const PS = require("./package-store.js"), P = require("./pipeline.js");
const defer = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
// 가짜 의존성으로 offscreen.js 를 올린다. runBackground 는 시험이 끝내 주는 약속이고, 서비스·저장소·fetch 는 기록만 한다.
function bgHarness(over = {}) {
  const h = { sent: [], runs: [], fetched: [], mes: 0, referer: async () => ({ ok: true }), svc: [], vision: null, notes: [] };
  let listener;
  const context = vm.createContext({
    URL, AbortController, crypto, console, Map, Set, Promise, setTimeout, clearTimeout,
    chrome: { runtime: { id: "extension-id", getURL: p => `chrome-extension://extension-id/${p}`, onMessage: { addListener: fn => { listener = fn; } }, onConnect: { addListener() {} },
      sendMessage: async m => {
        h.sent.push(JSON.parse(JSON.stringify(m)));
        if (m.type === "AUTH_TOKEN") return { ok: true, token: "login-jwt-login-jwt-login-jwt-login-jwt" };
        return m.type === "BG_REFERER" ? h.referer(m) : { ok: true };
      } } },
    PackageStore: { indexedDbAdapter: async () => PS.memoryAdapter(), createStore: PS.createStore },
    Pipeline: P, OpenRouterClient: {}, SummaryPipeline: {},
    ServiceClient: { me: async o => { h.mes++; h.meArgs = o; return over.me ?? { accountId: "a", features: ["background", "stt", "vision", "judge"], config: { concurrency: { download: 4 } } }; },
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
  assert.deepEqual(done, { target: "background", type: "BG_DONE", jobId: "job-12345678", status: "partial", code: null, reason: null, suggest: null, message: null, stats: { slides: 5, chunks: 4, gaps: 2 }, notices: [{ code: "NOTE_CAPTURE_GAP", count: 2 }, { code: "NOTE_X", count: null }] });
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
  assert.deepEqual(list.jobs.map(j => j.jobId).sort(), ["job-created1", "job-paused01"], "끝난 작업(실패·취소·완료)은 이어 할 수 없으니 싣지 않는다");
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
