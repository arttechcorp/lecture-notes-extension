const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const root=path.resolve(__dirname,"..");
test("runtime-only offscreen summarizes with settings from its trusted message",async()=>{
  let listener,received;
  const context=vm.createContext({URL,AbortController,crypto,console,Map,chrome:{runtime:{id:"extension-id",getURL:p=>`chrome-extension://extension-id/${p}`,sendMessage:async()=>({ok:true}),onMessage:{addListener:fn=>{listener=fn;}}}},OpenRouterClient:{name:"openrouter"},ServiceClient:{name:"service"},SummaryPipeline:{generate:async(_evidence,options)=>{received=options;return{status:"recognition-only"};}}});
  vm.runInContext(fs.readFileSync(path.join(root,"offscreen.js"),"utf8"),context,{filename:"offscreen.js"});
  vm.runInContext(`session={status:"completed",id:"session-id",generation:1,error:null,summaryCache:null,summaryAttempt:0,store:{snapshot:()=>[]},publish:()=>{},log:()=>{},state(){return{sessionId:this.id,status:this.status,summary:this.summary||null};}}`,context);
  const settings={openRouterApiKey:"sk-or-v1-synthetic-test-key-123456",summaryModel:"synthetic-model",remoteSummaryConsent:true};
  const response=await new Promise(resolve=>listener({target:"session",type:"GENERATE_NOTES",settings},{id:"extension-id",url:"chrome-extension://extension-id/background.js"},resolve));
  assert.equal(response.ok,true);assert.equal(received.settings.openRouterApiKey,settings.openRouterApiKey);assert.equal(received.settings.summaryModel,settings.summaryModel);assert.equal(received.service.name,"openrouter");
  assert.equal(context.chrome.storage,undefined);
  assert.doesNotMatch(fs.readFileSync(path.join(root,"offscreen.html"),"utf8"),/lib\/settings\.js/);
});
test("restoring an old note shows a warning for newly held visuals",async()=>{
  const SummaryPipeline=require("./summary.js");
  const item={content:"요점",importance:"important",evidenceIds:["e1"]};
  const note={title:"강의",keyConclusions:[item],concepts:[],corrections:[],openQuestions:[],sections:[{heading:"내용",...item}],formulas:[],visuals:[{type:"chart",title:"차트",description:"",data:"A | B",importance:"important",evidenceIds:["e1"]}],reviewQuestions:[],status:"complete",notice:"기존 안내"};
  class EvidenceStore{restore(items){this.items=items;}snapshot(){return this.items;}}
  class CaptureSession{constructor(){this.status="completed";}state(){return{summary:this.summary};}publish(){}}
  const context=vm.createContext({URL,AbortController,crypto,console,Map,chrome:{runtime:{id:"extension-id",getURL:p=>`chrome-extension://extension-id/${p}`,sendMessage:async()=>({ok:true}),onMessage:{addListener:()=>{}}}},SummaryPipeline,EvidenceStore,CaptureSession,ServiceClient:{me:async()=>({accountId:"a"}),loadEncrypted:async()=>({envelope:{}})},LectureVault:{decrypt:async()=>({version:1,evidence:[{id:"e1",source:"ocr",text:"평문",t0:0,t1:1}],summary:note,gaps:[]})}});
  vm.runInContext(fs.readFileSync(path.join(root,"offscreen.js"),"utf8"),context,{filename:"offscreen.js"});
  const message={type:"LOAD_VAULT",objectId:"archive",passphrase:"synthetic"};
  context.message=message;
  await vm.runInContext("archive(message)",context);
  assert.equal(note.visuals.length,0);
  assert.match(note.notice,/기존 안내/);
  assert.match(note.notice,/시각 자료 1건/);
});
