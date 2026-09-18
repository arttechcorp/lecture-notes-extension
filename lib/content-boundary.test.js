const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
test("content metadata preserves a clipped video position for the session guard",()=>{
  let listener;
  const video={videoWidth:800,videoHeight:450,currentTime:1,playbackRate:1,paused:false,ended:false,mediaKeys:null,getBoundingClientRect:()=>({x:-200,y:0,width:800,height:450}),addEventListener:()=>{},removeEventListener:()=>{}};
  const canvas={width:0,height:0,getContext:()=>({drawImage:()=>{},getImageData:()=>({data:new Uint8ClampedArray(32*18*4).fill(255)})})};
  const context=vm.createContext({innerWidth:1280,innerHeight:720,setInterval,clearInterval,addEventListener:()=>{},document:{querySelectorAll:()=>[video],createElement:()=>canvas},chrome:{runtime:{id:"extension-id",onMessage:{addListener:fn=>{listener=fn;}},sendMessage:async()=>({ok:true})}}});context.window=context;
  vm.runInContext(fs.readFileSync(path.resolve(__dirname,"..","content.js"),"utf8"),context,{filename:"content.js"});
  let response;listener({type:"PREFLIGHT"},{id:"extension-id"},value=>{response=value;});
  assert.equal(response.ok,true);assert.equal(response.metadata.box.x,-200/1280);assert.equal(response.metadata.box.w,800/1280);
});
