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
