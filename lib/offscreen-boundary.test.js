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
