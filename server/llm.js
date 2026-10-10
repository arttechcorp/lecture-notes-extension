// 운영 서버가 OpenRouter 를 부를 때 쓰는 모델 표와 응답 해석. 확장에는 실리지 않는다(BYOK 경로는 v2 에서 없앴다).
// tags 는 공급자 이름이 아니라 엔드포인트 태그다 — 모델마다 /models/<id>/endpoints 가 받는 태그가 다르다.
// reasoning 도 모델마다 다르다: { enabled:false } 를 거절하는 엔드포인트는 가장 싼 effort 를 준다.
// temperature:false 는 그 파라미터 자체를 거절하는 모델이다 — require_parameters 로 보내는 요청은 키를 아예 빼야 한다.
// tools/openrouter-endpoint-probe.mjs 가 둘을 실제 목록과 대조한다. 1차 공급자 태그(anthropic·openai·google-ai-studio)는
// zdr:true 와 함께 쓰면 늘 404 라 고정하지 않는다. Claude 는 amazon-bedrock/global 로 보낸다(Haiku 5.5 는 Bedrock 이 structured_outputs 를 안 지원해 json_schema strict + require_parameters 가 404 라 google-vertex/global).
// maxTokens 는 reasoning 을 포함한다. 서버 예약액이 이 값에 비례하므로 단계별 상한은 prompts.js 가 더 낮게 정한다.
// reasoningBudget 은 그 단계 출력 상한 위에 얹는 추론 토큰용 max_tokens 여유분이다 — 추론형 모델이 답을 쓰기 전 상한을 다 먹지 않게 한다(prompts.js).
// cache: system 프롬프트에 캐시 중단점을 찍을지. Anthropic 은 cache_control 을 명시해야 붙고, Gemini 는 암묵 캐시라 표시하지 않는다.
const MODELS={
  "google/gemini-2.5-flash-lite":{tags:["google-vertex"],reasoning:{enabled:false},maxTokens:32768},
  "google/gemini-3.8-flash":{tags:["google-vertex/global"],reasoning:{effort:"low"},maxTokens:32768},
  "google/gemini-2.5-pro":{tags:["google-vertex/global"],reasoning:{},maxTokens:32768},
  "anthropic/claude-haiku-4.5":{tags:["amazon-bedrock/global"],reasoning:{enabled:false},maxTokens:32768,cache:true},
  "anthropic/claude-sonnet-4.6":{tags:["amazon-bedrock/global"],reasoning:{enabled:false},maxTokens:32768,cache:true},
  "openai/gpt-6-luna":{tags:["azure"],reasoning:{effort:"high"},maxTokens:16384,temperature:false},
  // 작성 모델 실험용 변형 — id 는 effort 마다 하나씩, 업스트림 요청에는 base 만 간다(upstreamOf).
  "openai/gpt-6-luna@medium":{base:"openai/gpt-6-luna",tags:["azure","azure/us","azure/eu"],reasoning:{effort:"medium"},reasoningBudget:4000,maxTokens:32768,temperature:false,cacheMode:"openai-explicit"},
  "openai/gpt-6-luna@high":{base:"openai/gpt-6-luna",tags:["azure","azure/us","azure/eu"],reasoning:{effort:"high"},reasoningBudget:8000,maxTokens:32768,temperature:false,cacheMode:"openai-explicit"},
  "openai/gpt-6-luna@xhigh":{base:"openai/gpt-6-luna",tags:["azure","azure/us","azure/eu"],reasoning:{effort:"xhigh"},reasoningBudget:16000,maxTokens:32768,temperature:false,cacheMode:"openai-explicit"},
  "openai/gpt-6.1-sol":{tags:["azure","openai","azure/us","azure/eu"],reasoning:{effort:"medium"},reasoningBudget:8000,maxTokens:32768,temperature:false},
  // mis-sol-hai 작성 모델(기획 §3.2): Liner 에 없으므로 OpenRouter. temperature 는 생략(temperature:false).
  // reasoning 은 effort 대신 max_tokens 다 — OpenRouter 는 Claude 의 effort 를 max_tokens 비율(high=0.8)로 바꿔, 실강의에서 추론이 상한(22K)을 다 먹고 잘렸다.
  // schemaInPrompt: Anthropic strict json_schema 는 null 허용(union) 칸을 요청당 16개까지만 받아(공식 문서, 초과 시 400) 초안 스키마(약 48칸)가 늘 거절된다 —
  // response_format 없이 스키마를 system 메시지로 주고 서버 계약 검증·형식 재시도로 받는다.
  "anthropic/claude-haiku-5.5":{tags:["google-vertex/global"],reasoning:{max_tokens:8000},reasoningBudget:8000,maxTokens:32768,temperature:false,cache:true,schemaInPrompt:true},
  "xiaomi/mimo-v2.6-pro":{tags:["deepinfra/fp8"],reasoning:{effort:"low"},reasoningBudget:4000,maxTokens:32768},
  "xiaomi/mimo-v2.6-flash":{tags:["io-net/fp8","venice/fp8","deepinfra/fp8"],reasoning:{enabled:false},maxTokens:32768},
};
const upstreamOf=model=>MODELS[model]?.base||model;
const reasoningFor=model=>MODELS[model]?.reasoning||{enabled:false};
const reasoningBudgetFor=model=>MODELS[model]?.reasoningBudget||0;
const maxTokensFor=model=>MODELS[model]?.maxTokens||8192;
const noTemperature=model=>MODELS[model]?.temperature===false;
const cacheModeOf=model=>MODELS[model]?.cacheMode||null;
// 캐시를 안 쓰는 모델에는 문자열을 그대로 보낸다. 배열 본문은 공급자마다 정규화 경로가 달라 얻는 게 없는 쪽까지 바꾸지 않는다.
// openai-explicit 도 같은 모양이다 — OpenRouter 가 Anthropic 식 cache_control 블록을 OpenAI prompt_cache_breakpoint 로 번역한다.
const cachedSystem=(model,text)=>({role:"system",content:(MODELS[model]?.cache||MODELS[model]?.cacheMode==="openai-explicit")?[{type:"text",text,cache_control:{type:"ephemeral"}}]:text});
let NoteV3;try{NoteV3=require("../lib/note-v3.js");}catch{NoteV3=globalThis.NoteV3;}
// 두 문자열 또는 버퍼의 앞에서부터 일치하는 바이트/문자 길이를 잰다.
const commonPrefixLength=(a,b)=>{
  if(typeof a!=="string"||typeof b!=="string")return 0;
  const len=Math.min(a.length,b.length);
  let i=0;
  while(i<len&&a.charCodeAt(i)===b.charCodeAt(i))i++;
  return i;
};
// 두 번째 중단점: 작업 공유 칸만 담은 user 접두다. 요청 스키마 순서가 공유 칸을 앞에 놓으므로(prompts.js REQUEST)
// head 를 따로 직렬화해 본문 앞부분과 바이트가 같으면 잘라 둘로 나누고, 아니면 한 덩어리로 둔다(안전 장치).
const SHARED_HEAD={section:["concepts","options","allowedRefs"],draft:["concepts","options","allowedRefs"],repair:["concepts","options","allowedRefs"],questions:["concepts","sections","options","allowedRefs"]};
// v3 표시(isV3)가 있을 때만 공통 키가 앞에 오도록 재정렬한다 — independent 및 기존 모드는 원본 그대로 유지.
const orderUserPayload=(user,stage,isV3=false)=>{
  if(!isV3)return user;
  const keys=SHARED_HEAD[stage];
  if(!keys)return user;
  let parsed;try{parsed=typeof user==="string"?JSON.parse(user):user;}catch{return user;}
  if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))return user;
  const ordered={};
  for(const k of keys)if(parsed[k]!==undefined)ordered[k]=parsed[k];
  for(const k of Object.keys(parsed))if(!keys.includes(k))ordered[k]=parsed[k];
  return JSON.stringify(ordered);
};
const cachedUser=(model,user,stage,opts={})=>{
  const keys=SHARED_HEAD[stage];
  if(!(MODELS[model]?.cache||MODELS[model]?.cacheMode==="openai-explicit")||!keys)return {role:"user",content:user};
  let parsed;try{parsed=JSON.parse(user);}catch{return {role:"user",content:user};}
  const isV3=opts===true||opts?.isV3===true||(Boolean(NoteV3?.isV3)&&NoteV3.isV3(opts?.noteMode))||parsed?.isV3===true||(Boolean(NoteV3?.isV3)&&NoteV3.isV3(parsed?.noteMode));
  const targetUser=isV3?orderUserPayload(user,stage,true):user;
  const head={};for(const k of keys)if(parsed[k]!==undefined)head[k]=parsed[k];
  if(!Object.keys(head).length)return {role:"user",content:targetUser};
  const cut=JSON.stringify(head).length,headText=targetUser.slice(0,cut-1)+",";
  if(!targetUser.startsWith(headText))return {role:"user",content:targetUser};
  return {role:"user",content:[{type:"text",text:headText,cache_control:{type:"ephemeral"}},{type:"text",text:targetUser.slice(cut)}]};
};
// 모델이 JSON 안에 LaTeX 백슬래시를 한 번만 쓰면 JSON.parse 가 \t \f \b \r 제어문자로 읽는다. 알려진 명령만 되살린다.
// ponytail: \n 으로 시작하는 명령(\neq 등)과 \to·\rm 은 되살리지 않는다 — 정상 줄바꿈·들여쓰기와 부딪히고 실측 손상 0건이었다.
const UNMANGLE=[
  [/\u0009(imes|ext|heta|anh|an|ilde|op|frac)\b/gu,"\\t$1"],
  [/\u000c(rac|orall|lat)\b/gu,"\\f$1"],
  [/\u0008(eta|ar|inom|ullet|mod|ig|oxed|ot)\b/gu,"\\b$1"],
  [/\u000d(ho|ight|angle|floor|ceil)\b/gu,"\\r$1"],
];
const unmangle=s=>UNMANGLE.reduce((acc,[re,rep])=>acc.replace(re,rep),s);
// 스키마를 프롬프트로 받은 모델은 JSON 을 코드 블록으로 감쌀 때가 있다 — 바깥 펜스만 벗긴다.
const parseNote=text=>JSON.parse(String(text).trim().replace(/^```(?:json)?\s*/i,"").replace(/\s*```$/,""),(_,v)=>typeof v==="string"?unmangle(v):v);
const schemaInPrompt=model=>!!MODELS[model]?.schemaInPrompt;
// 이미지 근거(mis-sol-hai 필기 해석, 기획 §4.2): user 텍스트 뒤에 근거 id 라벨과 image_url 파트를 번갈아 붙인다.
// 이미지는 이 요청 안에서만 산다 — 문자열이든 캐시 분할 파트든 그 뒤에 덧붙이고, 호출 뒤에는 버린다(저장 금지).
const userWithImages=(user,images)=>{
  if(!Array.isArray(images)||!images.length)return{role:"user",content:user};
  const parts=typeof user==="string"?[{type:"text",text:user}]:user.slice();
  for(const i of images)if(i&&typeof i.id==="string"&&typeof i.image==="string")
    parts.push({type:"text",text:"[필기 이미지 — 근거 "+i.id+"]"},{type:"image_url",image_url:{url:i.image}});
  return{role:"user",content:parts};
};
// chat/completions 응답의 첫 선택지에서 본문을 꺼낸다 — 잘림(finish_reason "length")·거부(message.refusal)·
// 미완료를 JSON 파싱·검증보다 먼저 본다(기획 §4.5 — Haiku 독립 호출 경로).
const readChoice=raw=>{
  const c=raw&&raw.choices&&raw.choices[0];
  if(!c)return{error:"incomplete.none"};
  if(c.finish_reason==="length")return{error:"truncated"};
  if(c.finish_reason!=="stop")return{error:"incomplete."+String(c.finish_reason||"none").toLowerCase().replace(/[^a-z0-9_]/g,"").slice(0,30)};
  if(c.message&&c.message.refusal)return{error:"refused"};
  if(typeof c.message?.content!=="string"||!c.message.content)return{error:"empty"};
  return{text:c.message.content};
};
// 공급자가 응답 usage 에 실어 주는 프롬프트 캐시 상세를 한 모양으로 정규화한다.
// OpenAI·Gemini 계열은 prompt_tokens_details.cached_tokens(Chat)·input_tokens_details.cached_tokens(Responses)와
// 같은 칸 안의 cache_write_tokens, Anthropic 은 cache_read_input_tokens·cache_creation_input_tokens,
// DeepSeek 계열은 prompt_cache_hit_tokens 를 돌려준다. 미보고는 null 이다 — 보고된 0(miss)과 구분해야 hit ratio 분모가 오염되지 않는다.
const cacheOf=u=>{const num=v=>Number.isFinite(v)&&v>=0?Math.floor(v):null,
  ds=[u?.prompt_tokens_details,u?.input_tokens_details],pick=k=>{for(const d of ds){const v=num(d?.[k]);if(v!==null)return v;}return null;};
  return {cached_input_tokens:pick("cached_tokens")??num(u?.cache_read_input_tokens)??num(u?.prompt_cache_hit_tokens),
    cache_write_tokens:pick("cache_write_tokens")??num(u?.cache_creation_input_tokens)??num(u?.cache_write_tokens)};};
// Liner(OpenAI 호환 게이트웨이)가 제공하는 모델 목록(기획 D9): 이 목록의 모델만 Liner 로 보내고
// 그 외(anthropic/claude-haiku-5.5 등)는 OpenRouter 그대로다. 판정·STT·비전도 OpenRouter.
// Liner 는 provider 칸과 reasoning 객체(chat)·prompt_cache_options·reasoning.context(responses)를 거절한다(2026-10-08 실측).
// 캐시는 cache_control(chat)·자동 접두(responses)로 된다. 키·주소가 없으면 변환하지 않는다.
const LINER_MODELS=new Set(["openai/gpt-6.1-sol","openai/gpt-6-luna"]);
const onLiner=m=>LINER_MODELS.has(upstreamOf(m))||LINER_MODELS.has(String(m||"").split("@")[0]);
function toLiner(url,init,liner){
  if(!liner?.key||!liner.base||typeof init?.body!=="string")return null;
  const m=/^https:\/\/openrouter\.ai\/api\/v1\/(chat\/completions|responses)$/.exec(String(url));
  if(!m)return null;
  let b;try{b=JSON.parse(init.body);}catch{return null;}
  if(!b||!onLiner(b.model))return null;
  delete b.provider;delete b.prompt_cache_options;
  if(m[1]==="responses"){if(b.reasoning)delete b.reasoning.context;}
  else if(b.reasoning){if(b.reasoning.effort)b.reasoning_effort=b.reasoning.effort;delete b.reasoning;}
  return[liner.base.replace(/\/+$/,"")+"/"+m[1],{...init,body:JSON.stringify(b),headers:{...init.headers,authorization:"Bearer "+liner.key}}];
}
module.exports={schemaInPrompt,toLiner,MODELS,LINER_MODELS,upstreamOf,reasoningFor,reasoningBudgetFor,maxTokensFor,noTemperature,cachedSystem,cachedUser,cacheModeOf,parseNote,cacheOf,commonPrefixLength,orderUserPayload,SHARED_HEAD,userWithImages,readChoice};
