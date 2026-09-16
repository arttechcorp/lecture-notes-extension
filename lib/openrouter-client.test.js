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
// The server reuses this schema and prompt; drift between the two copies is what shipped mismatched token limits.
const {schema:serverSchema}=require('../server/index.js');
assert.equal(serverSchema,OpenRouter.schema);
assert.deepEqual(OpenRouter.schema.required.filter(f=>!['title','sections','formulas','visuals','reviewQuestions','evidenceIds'].includes(f)),require('./summary.js').LISTS);
assert.match(OpenRouter.systemFor('synthesis'),/collapsing repeated or overlapping items/);
assert.doesNotMatch(OpenRouter.systemFor('chunk'),/collapsing repeated/);
test('provider rejections surface the reason instead of a bare status code',async()=>{
  const fail=body=>async()=>({ok:false,status:400,text:async()=>JSON.stringify(body)});
  await assert.rejects(OpenRouter.summary({apiKey:key,model:'google/gemini-2.5-flash-lite',stage:'chunk',evidence,fetcher:fail({error:{message:'google/gemini-3.8-flash is not a valid model ID'}})}),
    /\(400\)\. google\/gemini-3\.8-flash is not a valid model ID/);
  await assert.rejects(OpenRouter.summary({apiKey:key,model:'google/gemini-2.5-flash-lite',stage:'chunk',evidence,fetcher:fail({})}),/\(400\)\.$/);
});
test('each model pins its own endpoint tag, not a shared vendor name',async()=>{
  const sent={};
  for(const model of ['google/gemini-2.5-flash-lite','google/gemini-3.8-flash','google/gemini-2.5-pro','anthropic/claude-haiku-4.5','anthropic/claude-sonnet-4.6'])
    await OpenRouter.summary({apiKey:key,model,stage:'chunk',evidence,fetcher:async(_u,o)=>{sent[model]=JSON.parse(o.body).provider.only;return response({choices:[{finish_reason:'stop',message:{content:JSON.stringify(summary)}}],usage:{}});}});
  assert.deepEqual(sent,{'google/gemini-2.5-flash-lite':['google-vertex'],'google/gemini-3.8-flash':['google-vertex/global'],'google/gemini-2.5-pro':['google-vertex/global'],'anthropic/claude-haiku-4.5':['amazon-bedrock/global'],'anthropic/claude-sonnet-4.6':['amazon-bedrock/global']});
});
test('reasoning and token budget follow the model, not one global default',async()=>{
  const sent={};
  for(const model of Object.keys(OpenRouter.MODELS))
    await OpenRouter.summary({apiKey:key,model,stage:'chunk',evidence,fetcher:async(_u,o)=>{const b=JSON.parse(o.body);sent[model]=[b.reasoning,b.max_tokens];return response({choices:[{finish_reason:'stop',message:{content:JSON.stringify(summary)}}],usage:{}});}});
  // google-vertex/global refuses { enabled: false }: "Reasoning is mandatory for this endpoint and cannot be disabled."
  assert.deepEqual(sent['google/gemini-3.8-flash'],[{effort:'low'},16384]);
  assert.deepEqual(sent['google/gemini-2.5-pro'],[{},16384]);
  assert.deepEqual(sent['anthropic/claude-sonnet-4.6'],[{enabled:false},8192]);
  assert.deepEqual(sent['google/gemini-2.5-flash-lite'],[{enabled:false},8192]);
});
// Zero Data Retention disables first-party endpoints (the OpenRouter privacy page says so outright), and every
// request sends zdr:true — so pinning one can only ever 404, however healthy the endpoint looks.
for(const [model,{tags}] of Object.entries(OpenRouter.MODELS))
  for(const tag of tags)assert.ok(!['anthropic','openai','google-ai-studio','xai'].includes(tag.split('/')[0]),`${model}: ${tag}는 ZDR에서 비활성화되는 1차 공급자 엔드포인트`);


test("수식 규칙이 프롬프트에 백슬래시까지 온전히 실린다",()=>{
  const prompt=OpenRouter.systemFor("chunk");
  // JS 문자열에서 \f 는 폼피드다. 한 번만 쓰면 모델은 "rac{}{}"를 받는다.
  assert.ok(prompt.includes("\\frac{numerator}{denominator}"),"분수 규칙의 백슬래시가 이스케이프에 먹혔다");
  assert.ok(prompt.includes("\\sqrt")&&prompt.includes("\\sum"),"다른 LaTeX 명령도 백슬래시가 먹혔다");
  assert.doesNotMatch(prompt,/\f(?!rac)/,"프롬프트에 폼피드 문자가 들어 있다");
});

test("배치 좌표의 뜻과 쓰임이 프롬프트에 실린다",()=>{
  const prompt=OpenRouter.systemFor("chunk");
  // 좌표를 근거에 실어 보내면서 뜻을 알려주지 않으면 모델이 그대로 본문에 찍는다.
  assert.ok(prompt.includes("(55,30)"),"좌표 표기의 예시가 없다");
  assert.match(prompt,/never print the coordinates themselves/,"좌표를 본문에 찍지 말라는 금지가 없다");
  assert.match(prompt,/mermaid/,"도식을 다시 그리라는 지시가 없다");
});
