const assert=require('node:assert/strict'),test=require('node:test');
const OpenRouter=require('./openrouter-client.js');
const key='sk-or-v1-'+'a'.repeat(32), evidence=[{id:'e1',text:'합성 자료',source:'ocr',t0:0,t1:1,selection:'included',selectionReason:'학습 근거로 보존'}];
const summary={title:'요약',keyConclusions:[],concepts:[],claims:[],definitions:[],relationships:[],examples:[],corrections:[],openQuestions:[],sections:[],formulas:[],visuals:[],reviewQuestions:[],evidenceIds:['e1']};
function response(value){return {ok:true,status:200,text:async()=>JSON.stringify(value)};}
test('OpenRouter summary sends only structured text with fixed provider policy',async()=>{
  let request;
  const result=await OpenRouter.summary({apiKey:key,model:'google/gemini-2.5-flash-lite',stage:'chunk',evidence,fetcher:async(url,options)=>{request={url,options,body:JSON.parse(options.body)};return response({choices:[{finish_reason:'stop',message:{content:JSON.stringify(summary)}}],usage:{prompt_tokens:2,completion_tokens:3,cost:.01}});}});
  assert.equal(result.summary.title,'요약');assert.equal(request.url,'https://openrouter.ai/api/v1/chat/completions');assert.equal(request.options.headers.authorization,`Bearer ${key}`);assert.deepEqual(request.body.provider,{only:['google-vertex'],order:['google-vertex'],require_parameters:true,allow_fallbacks:false,zdr:true,data_collection:'deny'});assert.deepEqual(JSON.parse(request.body.messages[1].content).evidence,evidence);
});
test('OpenRouter key check rejects invalid keys without network access',async()=>{await assert.rejects(OpenRouter.check({apiKey:'not-a-key',fetcher:async()=>{throw new Error('must not fetch');}}),/형식/);});
