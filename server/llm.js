// 운영 서버가 OpenRouter 를 부를 때 쓰는 모델 표와 응답 해석. 확장에는 실리지 않는다(BYOK 경로는 v2 에서 없앴다).
// tags 는 공급자 이름이 아니라 엔드포인트 태그다 — 모델마다 /models/<id>/endpoints 가 받는 태그가 다르다.
// reasoning 도 모델마다 다르다: { enabled:false } 를 거절하는 엔드포인트는 가장 싼 effort 를 준다.
// temperature:false 는 그 파라미터 자체를 거절하는 모델이다 — require_parameters 로 보내는 요청은 키를 아예 빼야 한다.
// tools/openrouter-endpoint-probe.mjs 가 둘을 실제 목록과 대조한다. 1차 공급자 태그(anthropic·openai·google-ai-studio)는
// zdr:true 와 함께 쓰면 늘 404 라 고정하지 않는다. Claude 는 amazon-bedrock/global 로 보낸다.
// maxTokens 는 reasoning 을 포함한다. 서버 예약액이 이 값에 비례하므로 단계별 상한은 prompts.js 가 더 낮게 정한다.
// cache: system 프롬프트에 캐시 중단점을 찍을지. Anthropic 은 cache_control 을 명시해야 붙고, Gemini 는 암묵 캐시라 표시하지 않는다.
const MODELS={
  "google/gemini-2.5-flash-lite":{tags:["google-vertex"],reasoning:{enabled:false},maxTokens:32768},
  "google/gemini-3.8-flash":{tags:["google-vertex/global"],reasoning:{effort:"low"},maxTokens:32768},
  "google/gemini-2.5-pro":{tags:["google-vertex/global"],reasoning:{},maxTokens:32768},
  "anthropic/claude-haiku-4.5":{tags:["amazon-bedrock/global"],reasoning:{enabled:false},maxTokens:32768,cache:true},
  "anthropic/claude-sonnet-4.6":{tags:["amazon-bedrock/global"],reasoning:{enabled:false},maxTokens:32768,cache:true},
  "openai/gpt-6-luna":{tags:["azure"],reasoning:{effort:"high"},maxTokens:16384,temperature:false},
};
const reasoningFor=model=>MODELS[model]?.reasoning||{enabled:false};
const maxTokensFor=model=>MODELS[model]?.maxTokens||8192;
const noTemperature=model=>MODELS[model]?.temperature===false;
// 캐시를 안 쓰는 모델에는 문자열을 그대로 보낸다. 배열 본문은 공급자마다 정규화 경로가 달라 얻는 게 없는 쪽까지 바꾸지 않는다.
const cachedSystem=(model,text)=>({role:"system",content:MODELS[model]?.cache?[{type:"text",text,cache_control:{type:"ephemeral"}}]:text});
// 모델이 JSON 안에 LaTeX 백슬래시를 한 번만 쓰면 JSON.parse 가 \t \f \b \r 제어문자로 읽는다. 알려진 명령만 되살린다.
// ponytail: \n 으로 시작하는 명령(\neq 등)과 \to·\rm 은 되살리지 않는다 — 정상 줄바꿈·들여쓰기와 부딪히고 실측 손상 0건이었다.
const UNMANGLE=[
  [/\u0009(imes|ext|heta|anh|an|ilde|op|frac)\b/gu,"\\t$1"],
  [/\u000c(rac|orall|lat)\b/gu,"\\f$1"],
  [/\u0008(eta|ar|inom|ullet|mod|ig|oxed|ot)\b/gu,"\\b$1"],
  [/\u000d(ho|ight|angle|floor|ceil)\b/gu,"\\r$1"],
];
const unmangle=s=>UNMANGLE.reduce((acc,[re,rep])=>acc.replace(re,rep),s);
const parseNote=text=>JSON.parse(text,(_,v)=>typeof v==="string"?unmangle(v):v);
module.exports={MODELS,reasoningFor,maxTokensFor,noTemperature,cachedSystem,parseNote};
