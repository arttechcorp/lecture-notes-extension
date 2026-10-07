// noteSession 실험 경로 — /v1/plan·/v1/write 봉투의 선택 칸 noteSession={v:1,id,mode,history}.
// 클라이언트(확장 작업 메모리)가 대화 이력을 들고 다니고 서버는 무상태다:
// OpenRouter /v1/responses 는 store:false 가 고정이라 previous_response_id 를 거절하고 input 전체를 다시 받는다.
// GPT-6.1 Sol 은 tool calling 에 Responses API 만 지원한다(공식 function-calling) — 세션 호출은 전부 /v1/responses.
//   sol-session   : Sol 이 계획+모든 작성 단계를 직접 쓴다.
//   sol-luna-tool : 계획은 Sol, 작성 단계는 write_note 함수 호출로 Luna High 에 위임한다.
//                   서버는 도구 호출을 '현재 검증된 요청'에 묶어 실행하고 Luna 결과를 function_call_output 으로
//                   돌려준 뒤 Sol 의 최종 출력을 받는다. Sol 의 arguments 로는 라우팅하지 않는다.
//   sol-fork      : 계획은 sol-session 과 같다. plan 응답 이력이 고정 공유 접두 P 가 되고, 작성 단계는
//                   developer+P+그 호출의 작업만 input 으로 보내는 독립 호출이다 — 성공 응답의 history 는 P 그대로
//                   (이 단계의 턴을 붙이지 않는다)라 입력이 단계 수와 무관하게 일정하고, 같은 P 의 작성 호출은
//                   세션 잠금 없이 병렬로 간다. 이어 보내기(pending·실패 재개)만 P+자기 턴을 그 호출에 다시 쓴다.
// 이력은 [user task(서버 생성·단계마다 정확히 한 번), 공급자 출력 아이템(reasoning·message·function_call),
// function_call_output]의 append-only 열이다 — 다음 요청의 input 은 앞 요청 input 의 정확한 접두 확장이어야
// 프롬프트 캐시가 붙는다(공식: 대화 이력 append-only 보존). 꼬리가 단계 연속 상태를 담는다:
//   user 꼬리=작업 턴 미응답 → Sol 호출 재개. function_call 꼬리=도구 실행 대기. function_call_output 꼬리=최종 답 대기.
// 요청 시간 예산(공유 c.timeout)에 남은 단계를 못 마치면 200 {pending:true,noteSession,...} 을 돌려주고
// 클라이언트는 같은 stage·본문을 최신 history·새 requestId(-sN, 최대 3회)로 이어 보낸다 — Sol→Luna→Sol
// 3회 완료를 가정하지 않고, pending 응답은 output/plan 으로 검증·캐시하지 않는다.
const LLM=require("./llm.js"),Prompts=require("./prompts.js");
const SOL="openai/gpt-6.1-sol",LUNA="openai/gpt-6-luna@high",TOOL="write_note";
//   sol-luna-2    : 계획·통합 검수(review)·전역·선택 수정은 Sol 이 고정 접두 P 를 이어 쓰고, draft·questions 는
//                   noteSession 없는 독립 Luna High 요청이다(서버가 단계→모델 표를 강제한다).
//   sol-fork-2    : 모든 단계가 Sol. 계획 응답 이력 끝의 고정 앵커가 P 의 끝 — 작성 호출은 P+자기 작업만 보낸다.
const MODES=["sol-session","sol-luna-tool","sol-fork","sol-luna-2","sol-fork-2"];
const V2=["sol-luna-2","sol-fork-2"];
const RESPONSES_ENDPOINT="https://openrouter.ai/api/v1/responses",CHAT_ENDPOINT="https://openrouter.ai/api/v1/chat/completions";
const ID_RE=/^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/;
// v2 공유 접두 P 의 끝을 표시하는 고정 user/input_text 앵커 — 텍스트가 모든 호출에서 바이트로 같아야 캐시 경계가 일정하다.
// 텍스트·breakpoint 를 건드린 변조 앵커는 앵커가 아니라 외부 user 턴으로 읽혀 validate 가 거절한다.
const ANCHOR_TEXT="v2-prefix-anchor — 이 메시지까지가 공유 접두이고 그 아래가 이 호출의 작업이다";
const anchorItem=()=>({role:"user",content:[{type:"input_text",text:ANCHOR_TEXT,prompt_cache_breakpoint:{mode:"explicit"}}]});
const isAnchor=it=>!!it&&it.role==="user"&&Array.isArray(it.content)&&it.content.length===1
  &&it.content[0].type==="input_text"&&it.content[0].text===ANCHOR_TEXT&&it.content[0].prompt_cache_breakpoint?.mode==="explicit";
// 이력 상한: 항목 수·항목별 문자열·직렬화 총량 모두 제한한다 — 경계 없는 이력은 요청 본문 상한으로도 못 막는 누적이 된다.
// 이력은 단계마다 작업(근거 전부 포함)과 출력이 쌓여 단계 수에 비례해 커진다 — 첫 실측(2026-10-07)에서 384KB 상한이 3~5번째 섹션에서 걸려
// 노트가 413 으로 얇아졌다. 클라이언트 상한(512 항목)과 맞추고 바이트는 본문 상한(index.js 세션 요청 4MB) 아래로 둔다.
const MAX_ITEMS=512,ITEM_STR=200000,MAX_BYTES=3*1024*1024;
// 한 요청 안에서 다음 제공자 호출을 시작하는 최소 남은 시간 — 못 미치면 그 단계는 pending 으로 다음 요청에 넘긴다.
const MIN_LEFT_MS=12000;
const REJ="request_rejected",TOOL_STAGES=["section","global","repair","link","questions","draft"];
const plain=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const str=(v,n)=>typeof v==="string"&&v.length<=n;
const textArr=(a,types,n)=>Array.isArray(a)&&a.length<=n&&a.every(p=>plain(p)&&typeof p.text==="string"&&p.text.length<=ITEM_STR&&types.includes(p.type));
// 이력에는 서버가 만든 user 작업(우리가 붙여 돌려준 것을 클라이언트가 그대로 돌려보낸다)과 공급자 출력
// 아이템만 온다 — 클라이언트가 넣은 system·developer 지시는 주입이라 받지 않는다.
// 모양 검사는 경계(키 화이트리스트·길이)에만 두고 내용은 읽지 않는다 — 서버는 이력을 저장하지도 해석하지도 않는다.
function itemOk(it,mode){
  if(!plain(it)||typeof it.type!=="string"&&typeof it.role!=="string")return false;
  // 서버 생성 작업 메시지 — role 이 user 면 공급자 출력이 아니라 우리 task 다. 본문은 input_text 블록(들)과
  // 그 블록의 prompt_cache_breakpoint 를 허용한다 — 재생될 때 그대로 돌아가야 이전 턴 캐시 경계가 유지된다.
  if(it.role==="user")return (typeof it.content==="string"?it.content.length<=ITEM_STR:
      Array.isArray(it.content)&&it.content.length<=4&&it.content.every(p=>plain(p)&&p.type==="input_text"&&str(p.text,ITEM_STR)
        &&(p.prompt_cache_breakpoint===undefined||plain(p.prompt_cache_breakpoint)&&p.prompt_cache_breakpoint.mode==="explicit")
        &&Object.keys(p).every(k=>["type","text","prompt_cache_breakpoint"].includes(k))))
    &&(it.type===undefined||it.type==="message")&&Object.keys(it).every(k=>["role","content","type"].includes(k));
  if(it.role!==undefined&&it.type===undefined)return false; // type 없는 role 전용 아이템은 우리 형식이 아니다
  switch(it.type){
    case "reasoning":
      return str(it.id,256)&&Object.keys(it).every(k=>["type","id","summary","content","encrypted_content","format","status","signature"].includes(k))
        &&(it.summary==null||textArr(it.summary,["summary_text"],8))
        &&(it.content==null||textArr(it.content,["reasoning_text"],40))
        &&(it.encrypted_content==null||str(it.encrypted_content,ITEM_STR))
        &&(it.status==null||["completed","incomplete","in_progress"].includes(it.status))
        &&(it.format==null||str(it.format,64))&&(it.signature==null||str(it.signature,ITEM_STR));
    case "message":
      return it.role==="assistant"&&Object.keys(it).every(k=>["type","id","role","status","content","phase"].includes(k))
        &&(it.id==null||str(it.id,256))&&(it.status==null||str(it.status,32))
        &&(it.phase==null||["commentary","final_answer"].includes(it.phase))
        &&(typeof it.content==="string"?it.content.length<=ITEM_STR:textArr(it.content,["output_text","refusal"],40));
    case "function_call":
      return mode==="sol-luna-tool"&&it.name===TOOL&&str(it.call_id,128)&&str(it.arguments,ITEM_STR)
        &&Object.keys(it).every(k=>["type","id","call_id","name","arguments","status"].includes(k))
        &&(it.id==null||str(it.id,256))&&(it.status==null||str(it.status,32));
    case "function_call_output":
      return mode==="sol-luna-tool"&&str(it.call_id,128)&&typeof it.output==="string"&&it.output.length<=ITEM_STR
        &&Object.keys(it).every(k=>["type","id","call_id","output","status"].includes(k))
        &&(it.id==null||str(it.id,256))&&(it.status==null||str(it.status,32));
    default:return false;
  }
}
// 서버 작업 아이템의 stage 칸만 읽는다(input·outputSchema 같은 작업 본문은 읽지 않는다) — sol-fork 접두 검사용.
const taskStage=it=>{try{
  const p=Array.isArray(it.content)?it.content[0]:null,t=p?p.text:typeof it.content==="string"?it.content:null,j=t&&JSON.parse(t);
  return j&&typeof j.stage==="string"?j.stage:null;}catch{return null;}};
// 봉투 검증 — 실패는 오류를 던지지 않고 {error:"<code>"} 를 돌려 라우트가 fail() 로 접는다.
// function_call_output 은 앞선 function_call 의 call_id 와 짝이어야 한다(미답 도구 호출 위조 방지).
function validate(ns,stage){
  if(!plain(ns)||ns.v!==1||!ID_RE.test(ns.id)||!MODES.includes(ns.mode)||!Array.isArray(ns.history))return{error:REJ};
  const h=ns.history;
  if(h.length>MAX_ITEMS||Buffer.byteLength(JSON.stringify(h))>MAX_BYTES)return{error:"request_too_large"};
  const ids=new Set;
  for(const it of h){
    if(!itemOk(it,ns.mode))return{error:REJ};
    if(it.type==="function_call")ids.add(it.call_id);
    if(it.type==="function_call_output"&&!ids.has(it.call_id))return{error:REJ};
  }
  const tail=h[h.length-1],tailKind=!tail?"":tail.role==="user"?"user":tail.type;
  if(tailKind==="reasoning")return{error:REJ}; // 턴 중간 절단 — 이어 붙일 상태가 아니다
  if(!h.length&&stage!=="plan")return{error:REJ}; // 세션은 계획 호출로 시작한다
  if(stage==="plan"&&h.length&&!["message","user"].includes(tailKind))return{error:REJ}; // 계획은 도구 단계를 다시 열지 않는다
  // sol-fork 작성 단계의 history 는 고정 접두 P 이거나 P+이 호출 자신의 턴(미응답 작업·부분 항목)이다.
  // P: 첫 user 아이템(index 0)이 유일한 서버 생성 plan 작업이고 꼬리가 plan 의 마지막 assistant message 다 —
  // 실패한 계획(꼬리가 작업), 다른 단계의 턴, 두 번째 plan 작업이 섞인 이력은 접두가 아니다.
  // 두 번째 user 아이템부터가 자기 턴이다 — 이 단계의 작업 하나만 온다(그 호출에만 다시 쓰는 이어 보내기).
  if(ns.mode==="sol-fork"&&stage!=="plan"){
    const users=[];for(let i=0;i<h.length;i++)if(h[i].role==="user")users.push(i);
    if(users[0]!==0||taskStage(h[0])!=="plan"||users.length>2)return{error:REJ};
    const own=users.length>1?users[1]:h.length,ptail=h[own-1];
    if(ptail.type!=="message"||ptail.role!=="assistant")return{error:REJ};
    if(own<h.length&&taskStage(h[own])!==stage)return{error:REJ};
  }
  // v2 모드는 구 sol-fork 의 '두 번째 user' 휴리스틱을 쓰지 않는다 — P 의 끝은 고정 앵커 하나다.
  // 계획 이력에 앵커가 있으면 안 되고(앵커는 계획 응답에서만 생긴다), 작성 이력은 P+자기 턴:
  //   P = plan 작업(0번) + plan 의 공급자 출력(앵커 앞은 assistant message 로 끝나는 완료 턴) + 앵커 정확히 하나.
  //   앵커 누락·중복·변조(=isAnchor 불일치), P 안의 다른 user 턴, 앵커 뒤의 두 번째 작업·이미 끝난 턴은 거절.
  if(V2.includes(ns.mode)){
    const marks=[];for(let i=0;i<h.length;i++)if(isAnchor(h[i]))marks.push(i);
    if(stage==="plan"){
      if(marks.length)return{error:REJ};
      for(let i=0;i<h.length;i++)if(h[i].role==="user"&&taskStage(h[i])!=="plan")return{error:REJ};
    }else if(stage==="editorial"){
      // 편집 계획은 계획 턴을 이어 쓰는 두 번째 Sol 턴이다 — 앵커는 아직 없고, 이력은 계획 작업+계획 출력(+재개 중이면 자기 작업).
      if(marks.length)return{error:REJ};
      const users=[];for(let i=0;i<h.length;i++)if(h[i].role==="user")users.push(i);
      if(users[0]!==0||taskStage(h[0])!=="plan"||users.length>2)return{error:REJ};
      const ptail=h[(users[1]??h.length)-1];
      if(ptail.type!=="message"||ptail.role!=="assistant")return{error:REJ};
      if(users.length>1&&(taskStage(h[users[1]])!=="editorial"||h.at(-1).type==="message"&&h.at(-1).role==="assistant"))return{error:REJ};
    }else{
      // 작성 이력 = P(계획 작업·계획 출력·편집 작업·편집 출력·앵커 하나) + 이 호출 자신의 턴.
      if(marks.length!==1||marks[0]<4)return{error:REJ};
      const anchor=marks[0],ptail=h[anchor-1];
      if(ptail.type!=="message"||ptail.role!=="assistant")return{error:REJ};
      const users=[];for(let i=0;i<h.length;i++)if(h[i].role==="user"&&!isAnchor(h[i]))users.push(i);
      const pre=users.filter(i=>i<anchor),post=users.filter(i=>i>anchor);
      if(pre.length!==2||pre[0]!==0||taskStage(h[0])!=="plan"||taskStage(h[pre[1]])!=="editorial"||post.length>1)return{error:REJ};
      if(post.length){
        if(taskStage(h[post[0]])!==stage)return{error:REJ};
        if(h.at(-1).type==="message"&&h.at(-1).role==="assistant")return{error:REJ}; // 완료된 자기 턴의 재전송
      }else if(anchor!==h.length-1)return{error:REJ}; // 작업 없이 앵커 뒤에 잔여 아이템
    }
  }
  return{v:1,id:ns.id,mode:ns.mode,history:h};
}
// 꼬리 상태가 다음 동작을 정한다 — 명시적 단계 연속 상태다.
const tailState=h=>{const t=h[h.length-1];
  if(!t||t.type==="message")return{kind:"new"}; // 첫 턴이거나 앞 턴 완료 — 새 작업을 이력에 한 번 추가한다
  if(t.role==="user")return{kind:"task"}; // 작업 턴 미응답 — 이력 그대로 Sol 호출을 재개한다
  if(t.type==="function_call"&&t.name===TOOL)return{kind:"tool",call:t};
  if(t.type==="function_call_output")return{kind:"final"};
  return{kind:"bad"};};
// 세션 공용 안정 지시 — 모든 호출이 같은 developer 블록으로 시작해 접두 캐시가 붙는다.
// 단계 지시는 계약 순서로 한 번만 나열하고, 영어 강의 규칙(근거가 영어일 때만 의미가 있다)은 두 언어 공통으로
// 얹는다 — plan 요청에는 sourceLang 이 없으므로 요청마다 지시가 갈리면 접두가 깨진다. 언어는 작업 안 sourceLang 칸이 알린다.
const STAGE_ORDER=["plan","section","draft","repair","global","link","questions"];
const PREAMBLE=[
  "이 대화는 강의 노트 생성 작업 하나를 정해진 단계 순서로 진행한다. 각 사용자 메시지는 한 단계의 작업이고 {stage, sourceLang?, input, outputSchema} 모양의 JSON이다 — 아래 규칙 중 해당 단계(stage)의 지시를 따르고, 응답은 작업의 outputSchema 를 만족하는 JSON 객체 하나로 답한다.",
  "write_note 도구가 보이면 그 단계 본문 작성을 그 도구로 위임한다.",
].join("\n");
const systemFor=options=>[PREAMBLE,...STAGE_ORDER.map(s=>Prompts.systemFor(s,options,"en"))].join("\n\n---\n\n");
// v2 모드의 고정 developer 지시 — 짧게 고정하고 단계별 지시·스키마는 일회성 작업(suffix)에 싣는다(spec 5.1).
// 앵커가 P 의 끝이다 — 앵커 아래 작업이 이 호출의 유일한 작업이고 일회성 suffix 에는 breakpoint 를 두지 않는다.
const V2_DEV=[
  "이 대화는 강의 노트 생성의 고정 계획 접두다. 마지막 사용자 메시지의 고정 앵커(v2-prefix-anchor)가 접두의 끝을 표시한다.",
  "앵커 아래의 사용자 메시지가 이번 호출의 작업이다 — {stage, instruction, input, outputSchema} 모양의 JSON 이다. 작업의 instruction 지시를 따르고 outputSchema 를 만족하는 JSON 객체 하나로 답한다.",
].join("\n");
// 서버 생성 작업 — 단계 입력과 그 단계의 출력 스키마(제공자용 슬림판)를 함께 싣는다. text.format 은 모든 턴
// json_object 로 고정하므로 단계마다 스키마가 갈리는 엄격 강제는 클라이언트 측 로컬 검증이 그대로 담당한다.
// 작업은 native input_text 블록 + explicit breakpoint — developer 단독 중단점으로는 대화가 캐시되지 않는다.
// 이 아이템은 이력에 그대로 보존·재생된다(이전 턴 메타데이터·본문 재작성 금지) — 다음 턴 input 의 캐시 경계다.
// bp=false 면 breakpoint 를 싣지 않는다 — v2 의 일회성 작업 suffix 는 캐시 경계가 아니다(앵커가 P 의 경계).
const taskItem=(stage,rest,sourceLang,providerOut,instruction,bp)=>({role:"user",content:[{type:"input_text",
  text:JSON.stringify({stage,...(sourceLang?{sourceLang}:{}) ,input:rest,...(instruction?{instruction}:{}) ,outputSchema:providerOut}),
  ...(bp===false?{}:{prompt_cache_breakpoint:{mode:"explicit"}})}]});
const toolOutput=(callId,output)=>({type:"function_call_output",call_id:callId,output});
const TOOL_DEF={type:"function",name:TOOL,strict:true,
  description:"현재 단계의 노트 본문 작성을 작성 모델에 위임하고 결과 JSON 을 받는다. 입력 자료는 이미 이 대화와 작업의 outputSchema 에 있다 — stage 만 확인하고 호출한다.",
  parameters:{type:"object",properties:{stage:{type:"string",enum:TOOL_STAGES,description:"위임할 작성 단계"}},required:["stage"],additionalProperties:false}};
// 응답에서 공급자 아이템·도구 호출·본문을 꺼낸다 — 알 수 없는 유형의 function_call 은 우리 도구가 아니다.
function extract(raw){
  const items=(raw.output||[]).filter(plain);
  const calls=items.filter(i=>i.type==="function_call"&&i.name===TOOL);
  const alien=items.filter(i=>i.type==="function_call"&&i.name!==TOOL);
  const text=typeof raw.output_text==="string"&&raw.output_text?raw.output_text:
    items.filter(i=>i.type==="message").map(i=>typeof i.content==="string"?i.content:(Array.isArray(i.content)?i.content:[]).map(p=>p&&p.type==="output_text"?p.text||"":"").join("")).join("\n");
  return{items,calls,alien,text,status:raw.status||"completed",reason:raw.incomplete_details?.reason||null};
}
// 이력에 싣는 건 공급자 출력 아이템 그대로다 — 알려진 키만 투사해 부가 필드가 다음 요청을 깨지 않게 한다.
const KEEP={reasoning:["type","id","summary","content","encrypted_content","format","status","signature"],message:["type","id","role","status","content","phase"],function_call:["type","id","call_id","name","arguments","status"]};
const keepItem=i=>{const ks=KEEP[i?.type];if(!ks)return null;const o={};for(const k of ks)if(i[k]!==undefined)o[k]=i[k];return o;};
// Sol(Responses) 요청 본문 — 공식 확인된 유일한 tool calling 경로다. provider.order 는 sticky 라우팅을 꺼서 쓰지 않고
// session_id 로 같은 세션을 같은 제공자에 붙인다. zdr·data_collection:"deny" 는 둘 다 유지한다(서로 대체가 아니다).
// text.format 은 모든 턴 json_object — 단계 스키마는 작업 안에 있어 호출 사이 접두가 갈리지 않는다.
// tools 정의는 모드 안에서 모든 턴 동일하고, 호출 강제(tool_choice)만 단계 위치마다 바꾼다:
// 위임 턴=write_note 강제, 계획·최종 답 턴=none — 최종 호출에 강제를 두면 도구 호출이 무한 반복된다.
// seed·parallel_tool_calls 는 싣지 않는다 — seed 는 OpenRouter Responses 요청 스키마에 없는 chat 전용 칸이라
// 업스트림이 400 으로 거절하고, parallel_tool_calls 는 Sol 엔드포인트의 supported_parameters 에 없어
// require_parameters 가 전부 걸러 404(no_endpoints)가 된다(2026-10-07 실 라이브 측정). 호출 강제는 tool_choice
// 하나로 충분하고 도구 응답이 하나뿐이라 병렬 허용 칸은 의미가 없다.
function solBody({stage,system,items,params,providers,session,mode,choice}){
  const body={model:SOL,store:false,
    input:[{role:"developer",content:[{type:"input_text",text:system,prompt_cache_breakpoint:{mode:"explicit"}}]},...items],
    reasoning:{...(params.reasoning||{}),context:"all_turns"},
    include:["reasoning.encrypted_content"],
    prompt_cache_options:{mode:"explicit",ttl:"30m"},
    max_output_tokens:params.max_tokens,
    text:{format:{type:"json_object"}},
    session_id:session.id,
    provider:{only:providers,require_parameters:true,allow_fallbacks:false,zdr:true,data_collection:"deny"}};
  if(mode==="sol-luna-tool"){body.tools=[TOOL_DEF];body.tool_choice=choice;}
  return body;
}
// 세션 경로의 제공자 4xx — 업스트림 오류 봉투의 code·type·param 칸만 살균해 detail 에 붙인다.
// message·요청 에코·본문은 절대 싣지 않는다: 각 칸은 [a-z0-9_.-] ≤24자로 자르고, HTTP 상태 숫자와
// 같은 값(code:404 같은)은 중복이라 뺀다. 4xx 본문은 작으니 8KiB 안에 읽는다.
const cleanPart=(v,status)=>{
  if(typeof v!=="string"&&typeof v!=="number")return"";
  const s=String(v).toLowerCase().replace(/[^a-z0-9_.-]+/g,"_").replace(/^[^a-z0-9]+|[^a-z0-9]+$/g,"").slice(0,24);
  return s&&s!==String(status)?s:"";
};
const upstreamDetail=async(h,response)=>{
  const base=h.httpDetail(response),st=response.status;
  if(!(st>=400&&st<500))return base;
  let env=null;try{env=await h.boundedResponse(response,8192);}catch{}
  const e=env&&env.error;
  if(!e||typeof e!=="object")return base;
  const extra=[e.code,e.type,e.param].map(v=>cleanPart(v,st)).filter(Boolean).join(".").slice(0,72);
  return extra?base+"."+extra:base;
};
// 한 요청의 단계 오케스트레이션 — Sol·Luna 호출 전부가 같은 예약·타임아웃·시도 기록 안에서 돈다.
// ctx: {stage,rest,session,sourceLang,options,params,providerOut,outSchema,noteSpecVersion,schemaVersion,reserve,deadline,signal,fetcher,key,gens,lock,
//       solProviders,solRates,luna:{model,up,params,providers,rates,system,user,cacheFields},deps:{boundedResponse,costOf,attemptOf,errCode,finalizeNote,httpDetail}}
async function run(ctx){
  const {stage,rest,session}=ctx,h=ctx.deps,mode=session.mode,v2=V2.includes(mode);
  // v2 모드는 고정된 짧은 지시(V2_DEV)가 developer 접두다 — 전 단계 지시를 이어붙인 systemFor 는 쓰지 않는다.
  const system=v2?V2_DEV:systemFor(ctx.options),history=[...session.history],tries=[],usage={promptTokens:0,completionTokens:0};
  // sol-fork 작성 호출의 고정 접두 P: 들어온 history 의 두 번째 user(이 호출 자신의 작업) 앞까지다.
  // 성공 응답의 history 는 이 P 를 그대로 돌려준다 — 이 단계의 턴은 접두에 붙지 않아 입력 크기가 단계 수와 무관하게 일정하다.
  let prefix=null;
  if(mode==="sol-fork"&&stage!=="plan"){const i=session.history.findIndex((it,j)=>j>0&&it.role==="user");prefix=i<0?session.history:session.history.slice(0,i);}
  // v2 작성 호출의 고정 접두 P: 들어온 이력에서 고정 앵커(포함)까지다 — 클라이언트 길이 힌트가 아니라 앵커로 찾는다.
  if(v2&&stage!=="plan"&&stage!=="editorial"){const i=history.findIndex(isAnchor);if(i<0)throw Object.assign(new Error("invalid_note_output"),{detail:"prefix_anchor_missing"});prefix=history.slice(0,i+1);}
  // continuation — v2 는 앵커 아래 구간(이 호출의 자기 턴), 그 외는 이력 전체. 꼬리 상태 판정은 이 구간에서 한다.
  const cont=()=>prefix?history.slice(prefix.length):history;
  let amount=0,reported=true;
  // 시도별 행의 실제 호출 식별 — 응답이 provider·model 을 싣지 않으면 미보고 null(추정하지 않는다).
  const tag=(raw,m)=>({model:typeof raw?.model==="string"?raw.model:m,provider:typeof raw?.provider==="string"?raw.provider.slice(0,64):null,stage:stage==="plan"?"plan":"write."+stage});
  const snap=()=>({v:1,id:session.id,mode,history});
  // 과금 확정·세션 첨부 — 중간 실패도 이력을 돌려줘야 클라이언트가 같은 단계로 이어서 마칠 수 있다.
  // 코드 없는 세션 실패(출력 계약 위반·사이드카 거절 등)는 독립 경로와 같은 provider_failed_or_invalid_output 으로 접는다.
  const failed=e=>{e.charged??={amount,reported,usage};e.session??=snap();e.code??="provider_failed_or_invalid_output";return e;};
  const charge=e=>{throw failed(e);};
  // 단계 오류 — detail(세부 사유)만 싣는다. 과금 확정은 재시도 판정 뒤에 한다.
  const invalid=detail=>Object.assign(new Error("invalid_note_output"),{detail});
  const acc=u=>{usage.promptTokens+=Number(u.prompt_tokens??u.input_tokens)||0;usage.completionTokens+=Number(u.completion_tokens??u.output_tokens)||0;};
  const versions=()=>({promptVersion:Prompts.PROMPT_VERSIONS[stage]||Prompts.PROMPT_VERSION,schemaVersion:ctx.schemaVersion,noteSpecVersion:ctx.noteSpecVersion});
  // 시간 예산에 남은 단계를 못 마칠 때의 명시적 연속 응답 — 계약상 200 성공이고 output/plan 은 없다.
  const pendingResult=kind=>({amount,reported,attempts:tries,payload:{pending:true,stage,kind,noteSession:snap(),usage:{...usage,costUsd:reported?amount:ctx.reserve/100},...versions()}});
  // 도구 실행(Luna) — 현재 검증된 요청의 시스템·본문·스키마를 그대로 쓴다. 도구 결과를 무료로 두지 않는다:
  // 이 호출도 usage·시도·비용에 그대로 센다. chat/completions 경로는 운영 작성 호출과 같은 모양이다.
  const lunaCall=async()=>{
    // Luna 전용 제공자 슬롯을 별도로 잡는다 — 부모 Sol 슬롯만 쓰면 Luna 의 전역 동시성 상한을 우회한다.
    // 슬롯 대기가 거절되면 이미 나간 Sol 호출이 있을 수 있어 환불로 접지 않고 과금 확정으로 둔다.
    const release=await h.acquire(ctx.luna.model,ctx.signal,false,ctx.store).catch(e=>{
      throw failed(Object.assign(new Error("provider_busy"),{code:e.code||"provider_busy",detail:e.detail||"queue_busy"}));});
    const at=Date.now();
    try{
    const response=await ctx.fetcher(CHAT_ENDPOINT,{method:"POST",redirect:"error",signal:ctx.signal,headers:{authorization:"Bearer "+ctx.key,"content-type":"application/json"},body:JSON.stringify({
      model:ctx.luna.up,...ctx.luna.params,...ctx.luna.cacheFields,
      messages:[LLM.cachedSystem(ctx.luna.model,ctx.luna.system),LLM.cachedUser(ctx.luna.model,ctx.luna.user,stage)],
      response_format:{type:"json_schema",json_schema:{name:"lecture_note_"+stage,strict:true,schema:ctx.providerOut}},
      provider:{only:ctx.luna.providers,order:ctx.luna.providers,require_parameters:true,allow_fallbacks:false,zdr:true,data_collection:"deny"}})});
    if(!response.ok){const detail=await upstreamDetail(h,response);tries.push(h.attemptOf("a"+tries.length,Date.now()-at,null,detail,tag(null,ctx.luna.model)));charge(Object.assign(new Error("provider_failed"),{detail}));}
    const raw=await h.boundedResponse(response,1024*1024),u=raw.usage||{},choice=raw.choices?.[0];if(typeof raw.id==="string")ctx.gens.push(raw.id);
    if(!choice&&!raw.usage){tries.push(h.attemptOf("a"+tries.length,Date.now()-at,null,"provider_body_"+String(raw.error?.code??"empty").replace(/[^a-z0-9_]/gi,"_").slice(0,24),tag(raw,ctx.luna.model)));charge(Object.assign(new Error("provider_failed"),{detail:tries.at(-1).error}));}
    acc(u);{const c=h.costOf(u,...ctx.luna.rates,!choice?.message?.content&&choice?.finish_reason!=="length");if(c===null)reported=false;else amount+=c;}
    tries.push(h.attemptOf("a"+tries.length,Date.now()-at,u,null,tag(raw,ctx.luna.model)));
    if(choice?.finish_reason==="length"){const t=tries.at(-1);t.status="error";t.error="llm_output_truncated.long";charge(Object.assign(new Error("llm_output_truncated"),{code:"llm_output_truncated",detail:t.error}));}
    if(choice?.finish_reason!=="stop"||typeof choice?.message?.content!=="string")throw invalid("incomplete."+String(choice?.finish_reason||"none").toLowerCase().replace(/[^a-z0-9_]/g,"").slice(0,30));
    return choice.message.content;
    }finally{release();}
  };
  // Sol(Responses) 호출 — 입력은 developer 블록 + 이력 전체(서버 작업·공급자 아이템·도구 결과).
  const solCall=async choice=>{
    const at=Date.now();
    const response=await ctx.fetcher(RESPONSES_ENDPOINT,{method:"POST",redirect:"error",signal:ctx.signal,headers:{authorization:"Bearer "+ctx.key,"content-type":"application/json"},body:JSON.stringify(
      solBody({stage,system,items:history,params:ctx.params,providers:ctx.solProviders,session,mode,choice}))});
    // HTTP 거절: 4xx 는 라우팅 단계의 거절이라 생성 비용이 없다 — 이 요청의 첫 시도면 예약을 환불한다.
    // 5xx·전송 실패는 제공자 쪽에서 돈이 나갔는지 알 수 없어 예약을 그대로 둔다(보수적). 두 번째 이후 호출의 거절은 항상 과금 확정.
    if(!response.ok){const detail=await upstreamDetail(h,response);tries.push(h.attemptOf("a"+tries.length,Date.now()-at,null,detail,tag(null,SOL)));
      const e=Object.assign(new Error("provider_failed"),{detail});
      throw tries.length===1&&response.status>=400&&response.status<500?Object.assign(e,{refund:true,code:"provider_failed_or_invalid_output"}):failed(e);}
    const raw=await h.boundedResponse(response,1024*1024),u=raw.usage||{};if(typeof raw.id==="string")ctx.gens.push(raw.id);
    if(!raw.output?.length&&!raw.usage){tries.push(h.attemptOf("a"+tries.length,Date.now()-at,null,"provider_body_"+String(raw.error?.code??"empty").replace(/[^a-z0-9_]/gi,"_").slice(0,24),tag(raw,SOL)));
      const e=Object.assign(new Error("provider_failed"),{detail:tries.at(-1).error});
      throw tries.length===1?Object.assign(e,{refund:true,code:"provider_failed_or_invalid_output"}):failed(e);}
    acc(u);{const c=h.costOf(u,...ctx.solRates,!raw.output?.length);if(c===null)reported=false;else amount+=c;}
    tries.push(h.attemptOf("a"+tries.length,Date.now()-at,u,null,tag(raw,SOL)));
    const out=extract(raw);
    if(out.status==="incomplete"&&out.reason==="max_output_tokens"){const t=tries.at(-1);t.status="error";t.error="llm_output_truncated.long";charge(Object.assign(new Error("llm_output_truncated"),{code:"llm_output_truncated",detail:t.error}));}
    if(out.status!=="completed")throw invalid("incomplete."+String(out.status+"."+(out.reason||"")).toLowerCase().replace(/[^a-z0-9_.]/g,"").slice(0,40));
    return out;
  };
  const push=items=>{for(const i of items){const k=keepItem(i);if(k)history.push(k);}};
  // 최종 출력: 파싱·id 정규화·salvage·strict 검사는 독립 경로와 같다 — 검증을 통과한 턴만 이력에 남긴다.
  const finish=(text,items)=>{
    const fin=h.finalizeNote(stage,text,ctx.outSchema,rest);
    push(items);
    // sol-fork·v2 성공 이력은 들어온 접두 P 다 — 누적 이력의 앞 P 구간이 바이트로 같은지 확인하고 이 단계의 턴은 돌려주지 않는다.
    if(prefix&&JSON.stringify(history.slice(0,prefix.length))!==JSON.stringify(prefix))throw invalid("prefix_changed");
    // v2 편집 계획 응답 이력의 끝에는 고정 앵커를 붙인다 — 이후 모든 작성 호출이 P=[계획 턴, 편집 턴, 앵커] 를 재사용한다.
    if(v2&&stage==="editorial")history.push(anchorItem());
    const payload={...(stage==="plan"?{plan:fin.parsed}:stage==="editorial"?{editorialPlan:fin.parsed}:{output:fin.parsed}),
      ...(fin.salvaged?{salvaged:fin.salvaged,salvagedErrors:fin.salvagedErrors}:{}),
      usage:{...usage,costUsd:reported?amount:ctx.reserve/100},...versions(),noteSession:prefix?{v:1,id:session.id,mode,history:prefix}:snap()};
    return{amount,reported,attempts:tries,payload};
  };
  // 전문 worker 초안(그 밖의 단계는 세션 지시가 이미 덮는다)은 그 단계의 systemFor 지시를 작업 안에 싣는다 —
  // 고정 developer 접두는 그대로고 draft 전문 행이 빠지지 않는다.
  // v2 모드는 단계별 지시 전부를 작업 suffix 에 싣고, 일회성 작업에는 breakpoint 를 두지 않는다(계획 작업은 P 안이라 유지).
  const task=taskItem(stage,rest,ctx.sourceLang,ctx.providerOut,
    v2?Prompts.systemFor(stage,ctx.options,ctx.sourceLang,rest.section?.worker,mode)
      :rest.section?.worker?Prompts.systemFor(stage,ctx.options,ctx.sourceLang,rest.section.worker):null,
    v2&&stage!=="plan"&&stage!=="editorial"?false:undefined),
    left=()=>ctx.deadline-Date.now();
  const choice=stage==="plan"?"none":{type:"function",name:TOOL}; // 위임 턴만 도구 호출을 강제한다
  const unlock=await ctx.lock(session.id,ctx.signal);
  try{
    for(let round=0;round<2;round++){ // 형식 실패 재시도는 한 번 — 제공자 호출 상한은 요청당 sol-session 2회·sol-luna-tool 4회다
      try{
        let tail=tailState(cont());
        if(tail.kind==="bad")throw invalid("bad_history");
        if(mode==="sol-luna-tool"){
          // 도구 단계 재개(재제출): 꼬리의 도구 호출을 현재 검증된 요청으로 실행한다 — Sol 작업을 다시 묻지 않는다.
          if(tail.kind==="tool"){
            if(left()<MIN_LEFT_MS)return pendingResult("tool");
            history.push(toolOutput(tail.call.call_id,await lunaCall()));
            tail={kind:"final"};
          }
          // 최종 답 단계: 이력(…작업, 도구 호출, 도구 결과) 그대로 Sol 의 최종 출력을 받는다.
          if(tail.kind==="final"){
            if(left()<MIN_LEFT_MS)return pendingResult("final");
            const r=await solCall("none");
            if(r.calls.length||r.alien.length)throw invalid("tool_loop");
            return finish(r.text,r.items);
          }
        }
        // kind==="new": 단계의 첫 작업을 이력에 정확히 한 번 추가한다(재개 시 중복 삽입 금지).
        if(tail.kind==="new")history.push(task);
        // kind==="task": 미응답 작업 턴 — 이력 그대로 Sol 호출을 재개한다.
        if(left()<MIN_LEFT_MS)return pendingResult("task");
        const r=await solCall(choice);
        if(r.alien.length||r.calls.length>1)throw invalid("unexpected_tool_call");
        if(!r.calls.length){
          if(mode==="sol-luna-tool"&&stage!=="plan")throw invalid("no_tool_call");
          return finish(r.text,r.items);
        }
        // sol-luna-tool 작성 단계의 도구 호출 — 계획 단계의 자발적 호출은 계약에 없다.
        if(stage==="plan")throw invalid("plan_tool_call");
        try{const a=JSON.parse(r.calls[0].arguments||"{}");if(a.stage!==undefined&&a.stage!==stage)throw invalid("tool_arg_mismatch");}
        catch(e){if(e.detail)throw e;throw invalid("tool_arg_bad");}
        push(r.items); // 도구 단계는 같은 요청에서 이어간다 — 시간이 모자라면 pending 으로 다음 요청에 넘긴다
        if(left()<MIN_LEFT_MS)return pendingResult("tool");
        history.push(toolOutput(r.calls[0].call_id,await lunaCall()));
        if(left()<MIN_LEFT_MS)return pendingResult("final");
        const r2=await solCall("none");
        if(r2.calls.length||r2.alien.length)throw invalid("tool_loop");
        return finish(r2.text,r2.items);
      }catch(e){
        if(e.session||e.refund||e.charged)throw e; // 환불·과금 확정·세션 첨부 오류는 그대로 나간다
        const t=tries.at(-1);if(t&&t.status==="ok"){t.status="error";t.error=h.errCode(e);}
        // detail 을 단 단계·형식 오류만 한 번 더 간다 — 그 외와 마지막 라운드는 과금을 확정하고 끝낸다.
        if(round>=1||!e.detail)throw failed(e);
      }
    }
  }finally{unlock();}
}
module.exports={SOL,LUNA,TOOL,MODES,V2,ANCHOR_TEXT,anchorItem,isAnchor,V2_DEV,RESPONSES_ENDPOINT,MAX_ITEMS,MAX_BYTES,MIN_LEFT_MS,validate,tailState,systemFor,taskItem,toolOutput,TOOL_DEF,solBody,extract,run};
