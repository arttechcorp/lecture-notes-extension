// noteSession 실험 경로 단위·통합 테스트 — 실 제공자 호출 없이 mock fetch 로 검증한다.
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path"),crypto=require("node:crypto");
const NoteSession=require("./note-session.js"),Prompts=require("./prompts.js");
const {createServer}=require("./index"),Contracts=require("../lib/contracts.js"),NoteContract=require("../lib/note-contract.js"),
  Boilerplate=require("../lib/boilerplate.js"),Preprocess=require("../lib/preprocess.js");

// ── 단위: 봉투·이력 검증 ──
const taskItem=role=>({role:"user",content:"{}"});
const msg=t=>({type:"message",role:"assistant",status:"completed",content:[{type:"output_text",text:t||"{}"}]});
const fc=(id="c1")=>({type:"function_call",call_id:id,name:"write_note",arguments:"{}",status:"completed"});
const fco=(id="c1")=>({type:"function_call_output",call_id:id,output:"{}"});
const rs=()=>({type:"reasoning",id:"r1",summary:[]});
const env=(mode,history,id="sess-01ab")=>({v:1,id,mode,history});

test("validate: 봉투 모양과 이력 아이템",()=>{
  assert.equal(NoteSession.validate(env("sol-session",[]),"plan").error,undefined);
  assert.equal(NoteSession.validate(env("sol-session",[msg()]),"section").error,undefined,"작성 단계 재개는 message 꼬리");
  assert.equal(NoteSession.validate({v:2,id:"sess-01ab",mode:"sol-session",history:[]},"plan").error,"request_rejected","버전");
  assert.equal(NoteSession.validate(env("bad-mode",[]),"plan").error,"request_rejected","모드");
  assert.equal(NoteSession.validate(env("sol-session",[],"x"),"plan").error,"request_rejected","id 모양");
  assert.equal(NoteSession.validate(env("sol-session",[{role:"system",content:"x"}]),"section").error,"request_rejected","system 지시 주입 거절");
  assert.equal(NoteSession.validate(env("sol-session",[{role:"developer",content:"x"}]),"section").error,"request_rejected","developer 지시 주입 거절");
  assert.equal(NoteSession.validate(env("sol-session",[{role:"assistant",content:"x"}]),"section").error,"request_rejected","assistant role-only 아이템 거절");
  assert.equal(NoteSession.validate(env("sol-session",[taskItem()]),"section").error,undefined,"서버가 만든 user 작업은 허용");
  assert.equal(NoteSession.validate(env("sol-session",[{type:"message",role:"user",content:"x"}]),"section").error,undefined,"type+role user 도 허용");
  assert.equal(NoteSession.validate(env("sol-session",[{role:"user",content:"x",inject:1}]),"section").error,"request_rejected","user 아이템 낯선 키 거절");
});
test("validate: 도구 이력은 sol-luna-tool 에서만, fco 는 짝이 있어야",()=>{
  assert.equal(NoteSession.validate(env("sol-session",[fc()]),"section").error,"request_rejected","sol-session 은 도구 이력 없음");
  assert.equal(NoteSession.validate(env("sol-luna-tool",[fc()]),"section").error,undefined,"미답 fc 꼬리 = 도구 단계 대기");
  assert.equal(NoteSession.validate(env("sol-luna-tool",[fco()]),"section").error,"request_rejected","짝 없는 fco");
  assert.equal(NoteSession.validate(env("sol-luna-tool",[fc("c1"),fco("c2")]),"section").error,"request_rejected","call_id 불일치");
  assert.equal(NoteSession.validate(env("sol-luna-tool",[fc("c1"),fco("c1")]),"section").error,undefined);
  assert.equal(NoteSession.validate(env("sol-luna-tool",[fc({}),fc()]),"section").error,"request_rejected","다른 이름의 function_call 거절");
});
test("validate: 시작·꼬리·경계 규칙",()=>{
  assert.equal(NoteSession.validate(env("sol-session",[]),"section").error,"request_rejected","빈 이력은 plan 만");
  assert.equal(NoteSession.validate(env("sol-session",[rs()]),"section").error,"request_rejected","reasoning 꼬리는 턴 중간 절단");
  assert.equal(NoteSession.validate(env("sol-luna-tool",[fc()]),"plan").error,"request_rejected","계획은 도구 단계를 다시 열지 않는다");
  const big=Array.from({length:NoteSession.MAX_ITEMS+1},(_,i)=>({type:"message",role:"assistant",content:[{type:"output_text",text:"x"+i}]}));
  assert.equal(NoteSession.validate(env("sol-session",big),"section").error,"request_too_large","항목 수 상한");
});
test("tailState: 이력 꼬리가 단계 연속 상태다",()=>{
  assert.equal(NoteSession.tailState([]).kind,"new");
  assert.equal(NoteSession.tailState([msg()]).kind,"new");
  assert.equal(NoteSession.tailState([taskItem()]).kind,"task");
  assert.equal(NoteSession.tailState([taskItem(),rs(),fc()]).kind,"tool");
  assert.equal(NoteSession.tailState([taskItem(),rs(),fc(),fco()]).kind,"final");
});
test("solBody: 확인된 Responses 전선 — store:false·명시 캐시·공급자 고정·tools 안정",()=>{
  const session={v:1,id:"sess-01ab",mode:"sol-luna-tool",history:[]};
  const b=NoteSession.solBody({stage:"section",system:"sys",items:[taskItem()],params:{max_tokens:512,reasoning:{effort:"medium"},seed:7},providers:["azure","azure/us","azure/eu"],session,mode:"sol-luna-tool",choice:{type:"function",name:"write_note"}});
  assert.equal(b.model,"openai/gpt-6.1-sol");assert.equal(b.store,false);
  assert.equal(b.session_id,"sess-01ab");
  assert.deepEqual(b.provider,{only:["azure","azure/us","azure/eu"],require_parameters:true,allow_fallbacks:false,zdr:true,data_collection:"deny"});
  assert.ok(!("order" in b.provider),"order 는 sticky 라우팅을 꺼서 쓰지 않는다");
  assert.equal(b.input[0].role,"developer");
  assert.deepEqual(b.input[0].content[0].prompt_cache_breakpoint,{mode:"explicit"});
  assert.equal(b.input[0].content[0].type,"input_text");
  assert.deepEqual(b.prompt_cache_options,{mode:"explicit",ttl:"30m"});
  assert.deepEqual(b.include,["reasoning.encrypted_content"]);
  assert.deepEqual(b.reasoning,{effort:"medium",context:"all_turns"});
  assert.equal(b.max_output_tokens,512);
  assert.deepEqual(b.text,{format:{type:"json_object"}},"단계마다 스키마가 갈리지 않게 json_object 고정");
  assert.equal(b.tools.length,1);assert.equal(b.tools[0].name,"write_note");assert.equal(b.tools[0].strict,true);
  assert.deepEqual(b.tool_choice,{type:"function",name:"write_note"});
  // seed 는 Responses 요청 스키마에 없는 chat 전용 칸이고(→400), parallel_tool_calls 는 Sol 엔드포인트의
  // supported_parameters 에 없어 require_parameters 에 걸린다(→404) — 둘 다 싣지 않는다.
  assert.ok(!("seed" in b),"seed 는 싣지 않는다");
  assert.ok(!("parallel_tool_calls" in b),"parallel_tool_calls 는 싣지 않는다");
  // 단계 스키마는 text.format 이 아니라 작업 안에 있다 — 전선 접두는 턴마다 같다.
  const b2=NoteSession.solBody({stage:"plan",system:"sys",items:[],params:{max_tokens:512,reasoning:{effort:"medium"}},providers:["azure"],session:{...session,mode:"sol-luna-tool"},mode:"sol-luna-tool",choice:"none"});
  assert.equal(b2.tool_choice,"none","계획·최종 턴은 도구 호출을 강제하지 않는다");
  assert.equal(b2.tools[0].name,"write_note","tools 정의는 턴마다 동일");
  const solo=NoteSession.solBody({stage:"plan",system:"sys",items:[],params:{max_tokens:512},providers:["azure"],session:{...session,mode:"sol-session"},mode:"sol-session",choice:"none"});
  assert.ok(!("tools" in solo)&&!("tool_choice" in solo),"sol-session 은 도구가 없다");
  const fork=NoteSession.solBody({stage:"section",system:"sys",items:[taskItem()],params:{max_tokens:512},providers:["azure"],session:{...session,mode:"sol-fork"},mode:"sol-fork",choice:"none"});
  assert.ok(!("tools" in fork)&&!("tool_choice" in fork)&&!("seed" in fork)&&!("parallel_tool_calls" in fork),"sol-fork 도 도구·seed 없는 sol 전선이다");
});
test("taskItem: 서버 작업에 단계·언어·입력·outputSchema 가 실리고 breakpoint 블록이다",()=>{
  const t=NoteSession.taskItem("section",{section:{sectionId:"S1"}},"en",{type:"object"});
  assert.equal(t.role,"user");
  assert.equal(t.content[0].type,"input_text");
  assert.deepEqual(t.content[0].prompt_cache_breakpoint,{mode:"explicit"},"터션 캐시 경계");
  const j=JSON.parse(t.content[0].text);
  assert.equal(j.stage,"section");assert.equal(j.sourceLang,"en");
  assert.deepEqual(j.input,{section:{sectionId:"S1"}});assert.deepEqual(j.outputSchema,{type:"object"});
  assert.equal(JSON.parse(NoteSession.taskItem("plan",{},undefined,{}).content[0].text).sourceLang,undefined,"sourceLang 은 있을 때만");
});

// ── 단위: run() 오케스트레이션 (stub deps) ──
const respMsg=(text,o={})=>({ok:true,json:async()=>({id:o.id||"resp_m",status:"completed",
  output:[{type:"reasoning",id:"rs_1",summary:[],encrypted_content:"e"},{type:"message",role:"assistant",status:"completed",content:[{type:"output_text",text}]}],
  usage:o.usage??{input_tokens:300,output_tokens:80,cost:.001,input_tokens_details:{cached_tokens:0,cache_write_tokens:256},output_tokens_details:{reasoning_tokens:40}},
  model:"openai/gpt-6.1-sol",provider:"Azure"})});
const respFc=(o={})=>({ok:true,json:async()=>({id:o.id||"resp_f",status:"completed",
  output:[{type:"reasoning",id:"rs_2",summary:[]},{type:"function_call",id:"fc_1",call_id:"call_1",name:"write_note",arguments:JSON.stringify(o.args??{stage:"section"}),status:"completed"}],
  usage:{input_tokens:400,output_tokens:40,cost:.0005,input_tokens_details:{cached_tokens:128},output_tokens_details:{reasoning_tokens:20}},
  model:"openai/gpt-6.1-sol",provider:"Azure"})});
const lunaReply=(content)=>({ok:true,json:async()=>({id:"chat_1",choices:[{finish_reason:"stop",message:{content:typeof content==="string"?content:JSON.stringify(content)}}],
  usage:{prompt_tokens:500,completion_tokens:200,cost:.002},model:"openai/gpt-6-luna",provider:"Azure"})});
const bodies=[];
const seq=(...replies)=>{let i=0;return async(u,o)=>{bodies.push({url:u,body:JSON.parse(o.body)});return replies[Math.min(i++,replies.length-1)];};};
const stubDeps={
  boundedResponse:async r=>r.json(),
  acquire:async()=>()=>{},
  costOf:(u,pi,po,empty)=>typeof u?.cost==="number"?u.cost:empty?0:null,
  attemptOf:(id,ms,u,err,meta)=>({id,status:err?"error":"ok",error:err??null,latencyMs:ms,inputTokens:u?.input_tokens??u?.prompt_tokens??null,outputTokens:u?.output_tokens??u?.completion_tokens??null,providerReportedCost:typeof u?.cost==="number"?u.cost:null,...(meta||{})}),
  errCode:e=>e?.detail||"invalid_output",
  httpDetail:r=>"provider_http_"+r.status,
  finalizeNote:(stage,text)=>({parsed:JSON.parse(text),salvaged:null,salvagedErrors:null}),
};
const ctxFor=(o={})=>({stage:o.stage??"section",rest:o.rest??{section:{sectionId:"S1"}},
  session:o.session??{v:1,id:"sess-01ab",mode:o.mode??"sol-session",history:o.history??[]},
  sourceLang:o.sourceLang,options:o.options??{},params:o.params??{max_tokens:512,reasoning:{effort:"medium"}},
  providerOut:o.providerOut??{type:"object"},outSchema:{},noteSpecVersion:"n1",schemaVersion:"s1",
  reserve:100,deadline:o.deadline??Date.now()+60000,signal:o.signal??new AbortController().signal,fetcher:o.fetcher,key:"k",gens:o.gens??[],
  lock:o.lock??(async()=>()=>{}),
  solProviders:["azure","azure/us","azure/eu"],solRates:[1.5,10],
  luna:o.luna===undefined?{model:NoteSession.LUNA,up:"openai/gpt-6-luna",params:{max_tokens:512,reasoning:{effort:"high"}},providers:["azure","azure/us"],rates:[.1,.5],system:"sys",user:"{}",cacheFields:{}}:o.luna,
  deps:stubDeps});

test("run sol-session: 한 Sol 호출로 작업+출력 아이템을 이력에 붙인다",async()=>{
  bodies.length=0;
  const r=await NoteSession.run(ctxFor({fetcher:seq(respMsg('{"ok":1}'))}));
  assert.deepEqual(r.payload.output,{ok:1});
  assert.equal(bodies.length,1);
  const b=bodies[0].body;
  assert.equal(b.store,false);assert.equal(b.session_id,"sess-01ab");
  assert.equal(b.input.length,2,"developer + 첫 작업");
  assert.equal(b.input[1].role,"user");
  const h=r.payload.noteSession.history;
  assert.equal(h[0].role,"user","작업은 이력에 정확히 한 번");
  assert.deepEqual(h.slice(1).map(i=>i.type),["reasoning","message"]);
  assert.equal(r.attempts.length,1);assert.equal(r.attempts[0].model,"openai/gpt-6.1-sol");assert.equal(r.attempts[0].stage,"write.section");
});
test("run sol-luna-tool: Sol→Luna→Sol 세 호출이 한 예약·시도·비용에 센다",async()=>{
  bodies.length=0;
  const r=await NoteSession.run(ctxFor({mode:"sol-luna-tool",session:{v:1,id:"sess-02ab",mode:"sol-luna-tool",history:[msg()]},
    fetcher:seq(respFc(),lunaReply({sectionId:"S1",blocks:{}}),respMsg('{"sectionId":"S1","blocks":{}}'))}));
  assert.equal(bodies.length,3);
  assert.deepEqual(bodies.map(b=>b.url),[NoteSession.RESPONSES_ENDPOINT,"https://openrouter.ai/api/v1/chat/completions",NoteSession.RESPONSES_ENDPOINT]);
  // 위임 턴만 write_note 강제 — 최종 턴은 none 이어야 도구 호출이 무한 반복되지 않는다.
  assert.deepEqual(bodies[0].body.tool_choice,{type:"function",name:"write_note"});
  assert.equal(bodies[2].body.tool_choice,"none");
  // Luna 는 운영 작성 호출 모양 — strict json_schema + 제공자 order.
  const lb=bodies[1].body;
  assert.equal(lb.model,"openai/gpt-6-luna");assert.equal(lb.response_format.type,"json_schema");
  assert.deepEqual(lb.provider.only,["azure","azure/us"]);
  // 세 번째 호출 input = 첫 호출 input 의 정확한 접두 확장(append-only, 바이트 같음) — 캐시 접두가 깨지지 않는다.
  const js=v=>JSON.stringify(v);
  assert.equal(js(bodies[2].body.input.slice(0,bodies[0].body.input.length)),js(bodies[0].body.input),"정확한 바이트 접두 보존");
  const tail=bodies[2].body.input.slice(bodies[0].body.input.length);
  assert.deepEqual(tail.map(i=>i.type),["reasoning","function_call","function_call_output"]);
  assert.equal(tail[2].call_id,"call_1");assert.equal(JSON.parse(tail[2].output).sectionId,"S1");
  const h=r.payload.noteSession.history;
  assert.deepEqual(h.map(i=>i.type==="message"?i.type:i.type||i.role),["message","user","reasoning","function_call","function_call_output","reasoning","message"]);
  assert.deepEqual(r.attempts.map(a=>a.model),["openai/gpt-6.1-sol","openai/gpt-6-luna","openai/gpt-6.1-sol"],"시도별 실제 모델");
  assert.deepEqual(r.payload.output,{sectionId:"S1",blocks:{}});
  assert.equal(r.payload.usage.costUsd,.001+.0005+.002,"세 호출 비용 합산 — 도구 결과는 무료가 아니다");
});
test("run 재개: fc 꼬리는 Sol 작업을 다시 묻지 않고 도구부터, fco 꼬리는 최종만",async()=>{
  bodies.length=0;
  const h1=[taskItem(),rs(),fc()]; // 작업·도구 호출까지 끝난 이력
  await NoteSession.run(ctxFor({mode:"sol-luna-tool",session:{v:1,id:"sess-03ab",mode:"sol-luna-tool",history:h1},
    fetcher:seq(lunaReply({x:1}),respMsg('{"ok":1}'))}));
  assert.equal(bodies.length,2,"재개는 Luna + 최종 Sol 두 호출");
  assert.equal(bodies[0].url,"https://openrouter.ai/api/v1/chat/completions");
  assert.deepEqual(bodies[1].body.input.slice(1).map(i=>i.type||i.role),["user","reasoning","function_call","function_call_output"]);
  bodies.length=0;
  const h2=[taskItem(),rs(),fc(),fco()];
  await NoteSession.run(ctxFor({mode:"sol-luna-tool",session:{v:1,id:"sess-04ab",mode:"sol-luna-tool",history:h2},
    fetcher:seq(respMsg('{"ok":1}'))}));
  assert.equal(bodies.length,1,"fco 꼬리는 최종 Sol 한 호출");
  assert.equal(bodies[0].body.tool_choice,"none");
});
test("run 재개: 미응답 작업(user 꼬리)은 작업을 다시 넣지 않는다",async()=>{
  bodies.length=0;
  const h=[taskItem()]; // 작업만 있고 응답이 없던 이력(앞 요청 실패)
  await NoteSession.run(ctxFor({session:{v:1,id:"sess-05ab",mode:"sol-session",history:h},fetcher:seq(respMsg('{"ok":1}'))}));
  const users=bodies[0].body.input.filter(i=>i.role==="user");
  assert.equal(users.length,1,"작업 중복 삽입 금지 — 같은 user 아이템을 그대로 재사용");
  assert.deepEqual(users[0],h[0]);
});
test("run pending: 시간 예산 아래에서 다음 단계는 200 pending 으로 넘긴다",async()=>{
  bodies.length=0;
  // 첫 Sol 호출까지는 시간이 있다 — 호출이 끝나면 deadline 까지 12s 미만이어서 다음 단계는 pending.
  const slow=async(u,o)=>{bodies.push({url:u,body:JSON.parse(o.body)});await new Promise(x=>setTimeout(x,500));return respFc();};
  const r=await NoteSession.run(ctxFor({mode:"sol-luna-tool",deadline:Date.now()+NoteSession.MIN_LEFT_MS+300,
    session:{v:1,id:"sess-06ab",mode:"sol-luna-tool",history:[msg()]},fetcher:slow}));
  assert.equal(r.payload.pending,true);assert.equal(r.payload.kind,"tool");
  assert.ok(r.payload.noteSession.history.at(-1).type==="function_call","도구 단계 대기로 이력 반환");
  assert.ok(r.payload.usage&&r.payload.noteSpecVersion==="n1"&&r.payload.schemaVersion==="s1");
  assert.equal(r.payload.output,undefined,"pending 은 output 을 싣지 않는다");
});
test("run 오류: 첫 4xx 는 환불, 5xx·중간 실패는 과금 확정 + 세션 이력",async()=>{
  const err=async fetcher=>{try{await NoteSession.run(ctxFor({session:{v:1,id:"sess-07ab",mode:"sol-session",history:[msg()]},fetcher}));return null;}catch(e){return e;}};
  assert.equal((await err(async()=>({ok:false,status:400,json:async()=>({})}))).refund,true);
  const e5=await err(async()=>({ok:false,status:500,json:async()=>({})}));
  assert.equal(e5.refund,undefined);assert.ok(e5.charged);assert.ok(e5.session,"실패도 이력을 돌려준다");
  // 도구 단계의 Luna 4xx — Sol 호출이 이미 과금됐으므로 환불하지 않는다.
  const e2=await(async()=>{try{await NoteSession.run(ctxFor({mode:"sol-luna-tool",
    session:{v:1,id:"sess-08ab",mode:"sol-luna-tool",history:[taskItem(),fc()]},
    fetcher:seq({ok:false,status:400,json:async()=>({})})}));return null;}catch(e){return e;}})();
  assert.equal(e2.refund,undefined);assert.ok(e2.charged);assert.equal(e2.detail,"provider_http_400");
});
test("run 오류: 세션 4xx 는 업스트림 봉투의 code·type·param 만 살균해 detail 에 붙인다",async()=>{
  const failWith=async(id,status,body)=>{try{await NoteSession.run(ctxFor({session:{v:1,id,mode:"sol-session",history:[msg()]},
    fetcher:async()=>({ok:false,status,json:async()=>body})}));return null;}catch(e){return e;}};
  const e=await failWith("sess-11ab",400,{error:{code:"invalid_request_error",type:"invalid_param",param:"seed",message:"LEAKME message text"}});
  assert.equal(e.detail,"provider_http_400.invalid_request_error.invalid_param.seed");
  assert.ok(!e.detail.includes("LEAKME"),"업스트림 message·본문은 절대 싣지 않는다");
  // 숫자 code 가 상태와 같으면 중복으로 붙이지 않고, 낯선 문자는 _ 로 살균한다.
  const e2=await failWith("sess-12ab",404,{error:{code:404,type:"NO endpoints!?",param:"Tools[0]!"}});
  assert.equal(e2.detail,"provider_http_404.no_endpoints.tools_0");
  // 봉투가 없거나 읽기에 실패하면 기존 provider_http_NNN 그대로다.
  const e3=await failWith("sess-13ab",400,{});
  assert.equal(e3.detail,"provider_http_400");
  const e4=await(async()=>{try{await NoteSession.run(ctxFor({session:{v:1,id:"sess-14ab",mode:"sol-session",history:[msg()]},
    fetcher:async()=>({ok:false,status:400,json:async()=>{throw new Error("unreadable");}})}));return null;}catch(x){return x;}})();
  assert.equal(e4.detail,"provider_http_400","본문을 못 읽어도 호출 경로는 기존과 같이 실패한다");
});
test("run 형식 실패: tool 없는 응답·tool_loop 는 한 번 재시도하고 끝낸다",async()=>{
  bodies.length=0;
  try{await NoteSession.run(ctxFor({mode:"sol-luna-tool",session:{v:1,id:"sess-09ab",mode:"sol-luna-tool",history:[msg()]},
    fetcher:seq(respMsg("{}"),respMsg("{}"))}));assert.fail();
  }catch(e){assert.equal(e.detail,"no_tool_call");assert.equal(bodies.length,2,"한 번 재시도");assert.ok(e.charged);}
  bodies.length=0;
  try{await NoteSession.run(ctxFor({mode:"sol-luna-tool",session:{v:1,id:"sess-10ab",mode:"sol-luna-tool",history:[taskItem(),fc(),fco()]},
    fetcher:seq(respFc(),respFc())}));assert.fail();
  }catch(e){assert.equal(e.detail,"tool_loop");}
});

// ── sol-fork: plan 접두를 고정 공유 컨텍스트로 쓰는 독립 작성 호출 ──
test("validate sol-fork: 작성 단계는 plan 접두 P 또는 P+자기 턴만 받는다",()=>{
  const pt=NoteSession.taskItem("plan",{ir:{units:[]}},undefined,{type:"object"});
  const P=[pt,rs(),msg()];
  assert.equal(NoteSession.validate(env("sol-fork",P),"section").error,undefined,"신선한 작성 호출은 P 그대로");
  assert.equal(NoteSession.validate(env("sol-fork",[...P,NoteSession.taskItem("section",{s:1},undefined,{})]),"section").error,undefined,"자기 턴 이어 보내기");
  assert.equal(NoteSession.validate(env("sol-fork",[...P,NoteSession.taskItem("section",{s:1},undefined,{}),rs(),msg()]),"section").error,undefined,"자기 턴 + 부분 항목");
  assert.equal(NoteSession.validate(env("sol-fork",[]),"section").error,"request_rejected","계획이 실패하면 접두가 없다 — 작성 거절");
  assert.equal(NoteSession.validate(env("sol-fork",[msg()]),"section").error,"request_rejected","plan 작업 없는 이력");
  assert.equal(NoteSession.validate(env("sol-fork",[pt]),"section").error,"request_rejected","미완료 plan — P 꼬리가 message 가 아니다");
  assert.equal(NoteSession.validate(env("sol-fork",[rs(),msg()]),"section").error,"request_rejected","첫 아이템이 plan 작업이 아니다");
  assert.equal(NoteSession.validate(env("sol-fork",[...P,NoteSession.taskItem("plan",{i:1},undefined,{})]),"section").error,"request_rejected","두 번째 plan 작업");
  assert.equal(NoteSession.validate(env("sol-fork",[...P,NoteSession.taskItem("global",{g:1},undefined,{})]),"section").error,"request_rejected","다른 단계의 작업 턴");
  assert.equal(NoteSession.validate(env("sol-fork",[...P,NoteSession.taskItem("section",{s:1},undefined,{}),msg(),NoteSession.taskItem("global",{g:1},undefined,{})]),"global").error,"request_rejected","세 번째 user — 다른 단계 턴 혼입");
  assert.equal(NoteSession.validate(env("sol-fork",[]),"plan").error,undefined,"계획 호출은 sol-session 과 같다");
});
test("run sol-fork: plan 응답이 접두가 되고 작성은 dev+P+자기 작업 입력·성공 history=P",async()=>{
  bodies.length=0;
  const pr=await NoteSession.run(ctxFor({stage:"plan",rest:{ir:{}},
    session:{v:1,id:"fork-01ab",mode:"sol-fork",history:[]},fetcher:seq(respMsg('{"sections":[]}'))}));
  assert.ok(pr.payload.plan,"계획은 sol-session 과 같은 응답 모양");
  const P=pr.payload.noteSession.history;
  assert.equal(P[0].role,"user");assert.equal(P.at(-1).type,"message","계획 이력이 곧 공유 접두");
  // 같은 P 로 두 번 연속 작성 — 제공자 요청의 developer+P 구간이 바이트로 같고, 돌아온 history 도 P 다.
  const mk=()=>ctxFor({session:{v:1,id:"fork-01ab",mode:"sol-fork",history:P},fetcher:seq(respMsg('{"ok":1}'))});
  const r1=await NoteSession.run(mk()),r2=await NoteSession.run(mk());
  const i1=bodies[1].body.input,i2=bodies[2].body.input,js=JSON.stringify;
  assert.equal(i1.length,P.length+2,"developer + P + 이 호출의 작업");
  assert.equal(js(i1.slice(0,1+P.length)),js(i2.slice(0,1+P.length)),"developer+P 접두는 호출마다 바이트로 같다");
  assert.equal(js(i1.slice(1,1+P.length)),js(P),"input 의 P 구간이 들어온 접두와 같다");
  assert.equal(JSON.parse(i1.at(-1).content[0].text).stage,"section","마지막 user 는 이 호출의 작업");
  assert.equal(js(r1.payload.noteSession.history),js(P),"성공 history 는 P 그대로 — 이 단계의 턴을 붙이지 않는다");
  assert.equal(js(r2.payload.noteSession.history),js(P));
  const wb=bodies[1].body;
  assert.ok(!("tools" in wb)&&!("tool_choice" in wb)&&!("seed" in wb)&&!("parallel_tool_calls" in wb),"도구·seed 없는 sol 전선");
  assert.deepEqual(wb.text,{format:{type:"json_object"}});assert.equal(wb.session_id,"fork-01ab");
});
test("run sol-fork: 이어 보내기는 P+자기 작업을 재사용하고, 시간 부족은 P+자기 작업을 돌려준다",async()=>{
  bodies.length=0;
  const pt=NoteSession.taskItem("plan",{ir:{}},undefined,{type:"object"});
  const P=[pt,rs(),msg()];
  const r=await NoteSession.run(ctxFor({deadline:Date.now()+1000,
    session:{v:1,id:"fork-02ab",mode:"sol-fork",history:P},fetcher:seq(respMsg('{"ok":1}'))}));
  assert.equal(r.payload.pending,true);assert.equal(r.payload.kind,"task");
  const cont=r.payload.noteSession.history;
  assert.equal(cont.length,P.length+1);assert.equal(cont.at(-1).role,"user","pending 은 P+자기 작업뿐 — 접두 승격 없음");
  assert.equal(JSON.parse(cont.at(-1).content[0].text).stage,"section");
  // 재전송: 자기 작업이 이미 있으면 다시 넣지 않고 같은 턴을 재개한다.
  await NoteSession.run(ctxFor({session:{v:1,id:"fork-02ab",mode:"sol-fork",history:cont},fetcher:seq(respMsg('{"ok":1}'))}));
  const users=bodies.at(-1).body.input.filter(i=>i.role==="user");
  assert.equal(users.length,2,"plan 작업 + 자기 작업 둘뿐 — 작업 중복 삽입 금지");
  assert.deepEqual(users[1],cont.at(-1),"돌려받은 자기 작업을 그대로 재사용");
});
test("run sol-fork 오류: 작성 호출 실패도 P+자기 턴을 돌려준다",async()=>{
  const pt=NoteSession.taskItem("plan",{ir:{}},undefined,{type:"object"});
  const P=[pt,rs(),msg()];
  const e=await(async()=>{try{await NoteSession.run(ctxFor({session:{v:1,id:"fork-03ab",mode:"sol-fork",history:P},
    fetcher:async()=>({ok:false,status:500,json:async()=>({})})}));return null;}catch(x){return x;}})();
  assert.ok(e.charged);const h=e.session.history;
  assert.equal(h.at(-1).role,"user","실패 재개 이력은 P+자기 작업");
  assert.equal(JSON.stringify(h.slice(0,P.length)),JSON.stringify(P),"앞 P 구간은 들어온 접두 그대로");
});

// ── 통합: createServer + mock fetch ──
const token="test-token-A-".padEnd(40,"a"),origin="chrome-extension://"+"a".repeat(32);
const SOL=NoteSession.SOL,LUNA=NoteSession.LUNA;
const noteInput=require("../tools/note-fixture/input.json"),notePlanner=require("../tools/note-fixture/planner-output.json"),noteWriter=require("../tools/note-fixture/writer-outputs.json");
const noteIR=Preprocess.buildIR(Boilerplate.detect(noteInput.slides).slides,noteInput.transcript.segments);
const notePlan=(()=>{const n=NoteContract.normalizePlan(notePlanner,{units:noteIR.units,formulaUnits:noteInput.formulaUnits,figures:noteInput.figures});if(!n.ok)throw new Error("plan fixture");return n.plan;})();
const noteS1=notePlan.sections.find(s=>s.sectionId==="S1");
const noteOpts={syntheticExamples:false,externalAugmentation:false};
const noteFormulas=noteInput.registry.map(f=>({id:f.id,status:f.status,unitIds:noteInput.formulaUnits[f.id]||[]}));
const notePlanFigures=noteInput.figures.map(f=>({id:f.id,unitId:f.unitId,kind:f.kind,title:f.title??null}));
const noteRegistry=noteInput.registry.map(f=>({id:f.id,latex:f.latex??null,status:f.status}));
const noteFigures=noteInput.figures.map(f=>({id:f.id,kind:f.kind,title:f.title??null,cells:f.cells??null}));
const writerRest={section:noteS1,concepts:notePlan.concepts,evidence:noteIR.evidence.filter(e=>e.unitId==="U1"),registry:noteRegistry,figures:noteFigures,options:noteOpts};
const noteSpecVersion=NoteContract.NOTE_SPEC_VERSION;
const sessEnv=root=>({APP_TOKENS_JSON:JSON.stringify({A:token}),EXTENSION_ORIGIN:origin,OPENROUTER_API_KEY:"k",
  ALLOWED_MODELS:JSON.stringify([SOL,LUNA]),OPENROUTER_PROVIDERS_JSON:JSON.stringify({[SOL]:["azure","azure/us","azure/eu"],[LUNA]:["azure","azure/us","azure/eu"],"openai/gpt-6-luna":["azure","azure/us","azure/eu"]}),VAULT_DIR:root});
const close=s=>new Promise(r=>s.close(r));
const removeTemp=root=>{const target=path.resolve(root);assert.ok(target.startsWith(path.join(path.resolve(os.tmpdir()),'summrizei-service-test-')));fs.rmSync(target,{recursive:true,force:true});};
const req=(url,route,body)=>fetch(url+route,{method:"POST",headers:{authorization:"Bearer "+token,origin,"content-type":"application/json"},body:JSON.stringify(body)});
const withSess=async(fetcher,run,extra={})=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"summrizei-service-test-"));
  const server=createServer(sessEnv(root),{fetch:fetcher});
  await new Promise(r=>server.listen(0,"127.0.0.1",r));
  try{await run("http://127.0.0.1:"+server.address().port);}finally{await close(server);removeTemp(root);}
};

test("통합 sol-session: plan 200 + noteSession 반환·Responses 전선",async()=>{
  bodies.length=0;
  await withSess(seq(respMsg(JSON.stringify(notePlanner))),async url=>{
    const res=await req(url,"/v1/plan",{model:SOL,requestId:"sp-1",noteSpecVersion,ir:{units:noteIR.units},formulas:noteFormulas,figures:notePlanFigures,recognition:"local",options:{...noteOpts},
      noteSession:{v:1,id:"sessit01",mode:"sol-session",history:[]}});
    assert.equal(res.status,200);
    const out=await res.json();
    assert.ok(out.plan&&out.plan.sections.length,"계획 출력");
    assert.deepEqual({v:out.noteSession.v,id:out.noteSession.id,mode:out.noteSession.mode},{v:1,id:"sessit01",mode:"sol-session"});
    assert.ok(out.noteSession.history.length>=3,"작업+공급자 아이템이 이력에 붙는다");
    const b=bodies[0].body;
    assert.equal(b.store,false);assert.equal(b.session_id,"sessit01");
    assert.deepEqual(b.text,{format:{type:"json_object"}});
    assert.equal(b.input[0].role,"developer");assert.deepEqual(b.input[0].content[0].prompt_cache_breakpoint,{mode:"explicit"});
    assert.equal(b.input[1].role,"user");
    const task=JSON.parse(b.input[1].content[0].text);
    assert.equal(task.stage,"plan");assert.ok(task.outputSchema,"단계 스키마는 작업 안에 있다");
    assert.deepEqual(b.provider,{only:["azure","azure/us","azure/eu"],require_parameters:true,allow_fallbacks:false,zdr:true,data_collection:"deny"});
  });
});
test("통합 sol-luna-tool: section 작성은 Sol→Luna→Sol + 200·검증·noteSession",async()=>{
  bodies.length=0;
  const s1=noteWriter.sections.S1.first;
  await withSess(seq(respFc(),lunaReply(s1),respMsg(JSON.stringify(s1))),async url=>{
    const res=await req(url,"/v1/write",{model:SOL,requestId:"sw-1",noteSpecVersion,stage:"section",...writerRest,withGist:true,
      noteSession:{v:1,id:"sessit02",mode:"sol-luna-tool",history:[taskItem(),msg(JSON.stringify(notePlanner))]}});
    assert.equal(res.status,200);
    const out=await res.json();
    assert.deepEqual(out.output,s1,"로컬 strict 검증을 통과한 Luna·Sol 합의 출력");
    assert.equal(bodies.length,3);
    assert.equal(bodies[0].body.tool_choice.type,"function");
    assert.equal(bodies[2].body.tool_choice,"none");
    // 도구 결과를 붙인 뒤에도 앞 items 는 바이트로 같다(정확한 접두 보존).
    const js=v=>JSON.stringify(v);
    assert.equal(js(bodies[2].body.input.slice(0,bodies[0].body.input.length)),js(bodies[0].body.input),"정확한 바이트 접두 보존");
  });
});
test("통합: 세션 모델 고정·잘못된 이력은 거절, 기본 경로는 무영향",async()=>{
  bodies.length=0;
  await withSess(seq(respMsg(JSON.stringify(notePlanner))),async url=>{
    const base={model:SOL,requestId:"sp-2",noteSpecVersion,ir:{units:noteIR.units},formulas:noteFormulas,figures:notePlanFigures,recognition:"local",options:{...noteOpts}};
    assert.equal((await req(url,"/v1/plan",{...base,model:"google/gemini-2.5-flash-lite",noteSession:{v:1,id:"sessit03",mode:"sol-session",history:[]}})).status,400,"허용 목록 밖 모델");
    assert.equal((await req(url,"/v1/plan",{...base,noteSession:{v:1,id:"sessit04",mode:"sol-session",history:[{role:"system",content:"x"}]}})).status,400,"지시 주입 이력");
    assert.equal((await req(url,"/v1/plan",{...base,noteSession:{v:1,id:"sessit05",mode:"nope",history:[]}})).status,400,"모르는 모드");
    assert.equal((await req(url,"/v1/plan",{...base,noteSession:{v:1,id:"sessit06",mode:"sol-luna-tool",history:[]}})).status,200,"plan 부터 시작하는 도구 모드");
  });
});
test("통합: sol-luna-tool 의 Luna 도 허용·계정·핀 게이트를 거친다",async()=>{
  bodies.length=0;
  // Luna 가 허용 목록에 없으면 도구 모드는 거절 — 도구 실행 모델도 클라이언트 선택과 같은 게이트다.
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"summrizei-service-test-"));
  const env={...sessEnv(root),ALLOWED_MODELS:JSON.stringify([SOL])};
  const server=createServer(env,{fetch:seq(respMsg(JSON.stringify(notePlanner)))});
  await new Promise(r=>server.listen(0,"127.0.0.1",r));
  const url="http://127.0.0.1:"+server.address().port;
  try{
    const res=await req(url,"/v1/plan",{model:SOL,requestId:"sp-3",noteSpecVersion,ir:{units:noteIR.units},formulas:noteFormulas,figures:notePlanFigures,recognition:"local",options:{...noteOpts},
      noteSession:{v:1,id:"sessit07",mode:"sol-luna-tool",history:[]}});
    assert.equal(res.status,400);assert.equal((await res.json()).error.code,"invalid_model_or_stage");
  }finally{await close(server);removeTemp(root);}
});

// ── sol-luna-2 / sol-fork-2: 고정 앵커가 공유 접두 P 의 끝 ──
// 서버가 editorial 응답 이력 뒤에 붙여 돌려주는 것과 같은 모양: plan 작업 → 공급자 항목 → assistant message → editorial 작업 → 공급자 항목 → assistant message → 고정 앵커.
const PLAN2=()=>[NoteSession.taskItem("plan",{ir:{units:[]}},undefined,{type:"object"}),rs(),msg('{"sections":[]}')];
const P2=()=>[...PLAN2(),NoteSession.taskItem("editorial",{options:{}},undefined,{type:"object"}),rs(),msg('{"v":1,"glossary":[],"sections":[]}'),NoteSession.anchorItem()];
test("validate v2: P 의 끝은 고정 앵커 — 누락·중복·변조·외부 턴을 거절한다",()=>{
  const P=P2();
  assert.equal(NoteSession.validate(env("sol-fork-2",P),"draft").error,undefined,"신선한 작성 호출은 P 그대로");
  assert.equal(NoteSession.validate(env("sol-luna-2",P),"review").error,undefined,"sol-luna-2 의 Sol 단계도 같은 P");
  assert.equal(NoteSession.validate(env("sol-fork-2",[...P,NoteSession.taskItem("draft",{s:1},undefined,{},null,false)]),"draft").error,undefined,"자기 턴 이어 보내기");
  assert.equal(NoteSession.validate(env("sol-fork-2",[]),"draft").error,"request_rejected","앵커 없음");
  assert.equal(NoteSession.validate(env("sol-fork-2",[P[0],rs(),msg()]),"draft").error,"request_rejected","구 fork 모양(앵커 없음)은 v2 접두가 아니다");
  assert.equal(NoteSession.validate(env("sol-fork-2",[...P,NoteSession.anchorItem()]),"draft").error,"request_rejected","앵커 중복");
  const tampered={role:"user",content:[{type:"input_text",text:NoteSession.ANCHOR_TEXT+"!",prompt_cache_breakpoint:{mode:"explicit"}}]};
  assert.equal(NoteSession.validate(env("sol-fork-2",[P[0],rs(),msg(),tampered]),"draft").error,"request_rejected","앵커 텍스트 변조");
  const stripped={role:"user",content:[{type:"input_text",text:NoteSession.ANCHOR_TEXT}]};
  assert.equal(NoteSession.validate(env("sol-fork-2",[P[0],rs(),msg(),stripped]),"draft").error,"request_rejected","breakpoint 를 뺀 변조 앵커");
  assert.equal(NoteSession.validate(env("sol-fork-2",[P[0],NoteSession.anchorItem(),rs(),msg()]),"draft").error,"request_rejected","계획 출력 없는 접두");
  assert.equal(NoteSession.validate(env("sol-fork-2",[P[0],rs(),NoteSession.anchorItem(),msg()]),"draft").error,"request_rejected","앵커 앞이 완료된 계획 턴이 아니다");
  assert.equal(NoteSession.validate(env("sol-fork-2",[P[0],rs(),taskItem(),msg(),NoteSession.anchorItem()]),"draft").error,"request_rejected","P 안의 외부 user 턴");
  assert.equal(NoteSession.validate(env("sol-fork-2",[...P,NoteSession.taskItem("global",{x:1},undefined,{})]),"draft").error,"request_rejected","다른 단계의 자기 작업");
  assert.equal(NoteSession.validate(env("sol-fork-2",[...P,NoteSession.taskItem("draft",{x:1},undefined,{},null,false),msg()]),"draft").error,"request_rejected","완료된 자기 턴의 재전송");
  assert.equal(NoteSession.validate(env("sol-fork-2",P),"plan").error,"request_rejected","계획 이력에 앵커");
  assert.equal(NoteSession.validate(env("sol-fork-2",[]),"plan").error,undefined,"v2 계획은 빈 이력으로 시작");
  // 편집 계획 턴이 없는 접두(계획 출력+앵커뿐)는 P 가 아니다 — plan 과 editorial 은 별개 호출이다.
  assert.equal(NoteSession.validate(env("sol-fork-2",[...PLAN2(),NoteSession.anchorItem()]),"draft").error,"request_rejected","편집 계획 없는 접두");
  assert.equal(NoteSession.validate(env("sol-fork-2",[...P,NoteSession.taskItem("editorial",{options:{}},undefined,{})]),"draft").error,"request_rejected","P 뒤의 두 번째 editorial 작업");
});
test("validate v2 editorial: 계획 턴을 이어 쓰는 두 번째 턴 — 앵커·다른 작업·계획 없는 이력은 거절",()=>{
  const plan=PLAN2();
  assert.equal(NoteSession.validate(env("sol-fork-2",plan),"editorial").error,undefined,"plan 응답 이력 그대로");
  assert.equal(NoteSession.validate(env("sol-luna-2",plan),"editorial").error,undefined);
  assert.equal(NoteSession.validate(env("sol-fork-2",[...plan,NoteSession.taskItem("editorial",{options:{}},undefined,{})]),"editorial").error,undefined,"자기 턴 이어 보내기·재개");
  assert.equal(NoteSession.validate(env("sol-fork-2",[]),"editorial").error,"request_rejected","계획 없는 이력");
  assert.equal(NoteSession.validate(env("sol-fork-2",[plan[0],rs()]),"editorial").error,"request_rejected","계획이 완료되지 않았다(꼬리가 reasoning)");
  assert.equal(NoteSession.validate(env("sol-fork-2",[...plan,NoteSession.anchorItem()]),"editorial").error,"request_rejected","앵커는 editorial 응답 뒤에만 생긴다");
  assert.equal(NoteSession.validate(env("sol-fork-2",[...plan,NoteSession.taskItem("draft",{x:1},undefined,{},null,false)]),"editorial").error,"request_rejected","다른 단계의 작업");
  assert.equal(NoteSession.validate(env("sol-fork-2",[...plan,NoteSession.taskItem("editorial",{options:{}},undefined,{}),msg()]),"editorial").error,"request_rejected","완료된 editorial 의 재전송");
  assert.equal(NoteSession.validate(env("sol-fork-2",plan),"draft").error,"request_rejected","editorial 이전 이력으로 작성 호출 불가");
});
test("run sol-fork-2: plan 은 {plan}+이어 쓸 이력, editorial 은 {editorialPlan}+앵커 P, 작성은 V2_DEV+P+작업(breakpoint 없음)",async()=>{
  bodies.length=0;
  const pr=await NoteSession.run(ctxFor({stage:"plan",rest:{ir:{}},mode:"sol-fork-2",
    session:{v:1,id:"fork2-01ab",mode:"sol-fork-2",history:[]},fetcher:seq(respMsg('{"sections":[]}'))}));
  assert.deepEqual(pr.payload.plan,{sections:[]});assert.ok(!("editorialPlan" in pr.payload),"편집 계획은 별도 호출이다");
  const PL=pr.payload.noteSession.history;
  assert.ok(!PL.some(NoteSession.isAnchor),"계획 응답 이력에는 앵커가 없다 — 앵커는 editorial 응답이 붙인다");
  assert.equal(JSON.parse(PL[0].content[0].text).stage,"plan","첫 user 는 plan 작업");
  const er=await NoteSession.run(ctxFor({stage:"editorial",rest:{options:{}},mode:"sol-fork-2",
    session:{v:1,id:"fork2-01ab",mode:"sol-fork-2",history:PL},fetcher:seq(respMsg('{"v":1,"glossary":[],"sections":[]}'))}));
  assert.deepEqual(er.payload.editorialPlan,{v:1,glossary:[],sections:[]});assert.ok(!("plan" in er.payload));
  const P=er.payload.noteSession.history;
  assert.equal(P.at(-1).role,"user");assert.equal(P.at(-1).content[0].text,NoteSession.ANCHOR_TEXT,"앵커가 P 의 끝");
  assert.equal(JSON.stringify(P.slice(0,PL.length)),JSON.stringify(PL),"편집 턴은 계획 이력을 이어 쓴다(접두 바이트 동일 — 캐시 적중)");
  assert.equal(JSON.parse(P[PL.length].content[0].text).stage,"editorial","계획 다음 user 는 editorial 작업");
  assert.equal(bodies[1].body.input.length,PL.length+2,"editorial 입력 = developer + 계획 이력 + editorial 작업");
  // 같은 P 로 두 작성 호출 — dev+P 구간이 바이트로 같고, 일회성 작업에는 breakpoint 가 없다.
  const mk=()=>ctxFor({mode:"sol-fork-2",stage:"draft",session:{v:1,id:"fork2-01ab",mode:"sol-fork-2",history:P},fetcher:seq(respMsg('{"claims":[]}'))});
  const r1=await NoteSession.run(mk()),r2=await NoteSession.run(mk());
  const i1=bodies[2].body.input,i2=bodies[3].body.input,js=JSON.stringify;
  assert.equal(i1.length,P.length+2,"developer + P + 이 호출의 작업");
  assert.equal(js(i1.slice(0,1+P.length)),js(i2.slice(0,1+P.length)),"developer+P 접두는 호출마다 바이트로 같다");
  assert.equal(js(i1.slice(1,1+P.length)),js(P),"입력의 P 구간은 들어온 접두 그대로");
  assert.equal(i1[0].content[0].text,NoteSession.V2_DEV,"v2 는 고정 짧은 developer 지시");
  const task=i1.at(-1),tj=JSON.parse(task.content[0].text);
  assert.equal(tj.stage,"draft");assert.ok(typeof tj.instruction==="string"&&tj.instruction.length,"단계 지시·스키마는 작업 suffix 에");
  assert.ok(tj.outputSchema);assert.equal(task.content[0].prompt_cache_breakpoint,undefined,"일회성 suffix 에 breakpoint 없음");
  assert.equal(js(r1.payload.noteSession.history),js(P),"성공 history 는 P 그대로 — fork 규칙");
  assert.equal(js(r2.payload.noteSession.history),js(P));
  const wb=bodies[2].body;
  assert.ok(!("tools" in wb)&&!("tool_choice" in wb)&&!("seed" in wb)&&!("parallel_tool_calls" in wb),"v2 Sol 전선은 도구·seed 없음");
  assert.equal(wb.session_id,"fork2-01ab");
});
test("run sol-luna-2: Sol 단계는 P 를 이어 쓰고 단계 지시는 작업 안에 — 도구·Luna 호출 없음",async()=>{
  bodies.length=0;
  const orig=Prompts.systemFor;
  Prompts.systemFor=(s,o,l,w)=>s==="review"?"review-instructions":orig(s,o,l,w); // review 지시는 v2-contract 계약 — 여기선 stub
  try{
    const r=await NoteSession.run(ctxFor({mode:"sol-luna-2",stage:"review",rest:{sections:[]},
      session:{v:1,id:"luna2-01ab",mode:"sol-luna-2",history:P2()},fetcher:seq(respMsg('{"edits":[],"unresolved":[]}'))}));
    assert.equal(bodies.length,1,"Sol 호출 하나뿐 — 세션 안에 Luna 는 없다");
    const b=bodies[0].body;
    assert.equal(b.model,SOL);assert.ok(!("tools" in b)&&!("tool_choice" in b));
    assert.equal(b.input[0].content[0].text,NoteSession.V2_DEV);
    const task=JSON.parse(b.input.at(-1).content[0].text);
    assert.equal(task.stage,"review");assert.equal(task.instruction,"review-instructions");
    assert.equal(JSON.stringify(r.payload.noteSession.history),JSON.stringify(P2()),"성공 history=P");
    assert.deepEqual(r.payload.output,{edits:[],unresolved:[]});
  }finally{Prompts.systemFor=orig;}
});
test("run v2 pending·재개: 이어 보내기는 P+자기 작업, 재개는 작업 중복 없이 같은 턴",async()=>{
  bodies.length=0;
  const P=P2();
  const r=await NoteSession.run(ctxFor({mode:"sol-fork-2",stage:"draft",deadline:Date.now()+1000,
    session:{v:1,id:"fork2-02ab",mode:"sol-fork-2",history:P},fetcher:seq(respMsg('{"claims":[]}'))}));
  assert.equal(r.payload.pending,true);assert.equal(r.payload.kind,"task");
  assert.equal(bodies.length,0,"시간 부족이면 제공자 호출이 나가지 않는다");
  const cont=r.payload.noteSession.history;
  assert.equal(cont.length,P.length+1,"pending 은 P+자기 작업뿐");
  assert.equal(JSON.parse(cont.at(-1).content[0].text).stage,"draft");
  assert.equal(cont.at(-1).content[0].prompt_cache_breakpoint,undefined);
  await NoteSession.run(ctxFor({mode:"sol-fork-2",stage:"draft",session:{v:1,id:"fork2-02ab",mode:"sol-fork-2",history:cont},fetcher:seq(respMsg('{"claims":[]}'))}));
  const users=bodies.at(-1).body.input.filter(i=>i.role==="user");
  assert.equal(users.length,4,"plan·editorial 작업·앵커·자기 작업뿐 — 중복 삽입 없음");
  assert.equal(users[2].content[0].text,NoteSession.ANCHOR_TEXT);
  assert.deepEqual(users.at(-1),cont.at(-1),"돌려받은 자기 작업을 그대로 재사용");
});
test("run v2: 앵커 없는 작성 이력은 접두를 못 찾아 거절",async()=>{
  await assert.rejects(()=>NoteSession.run(ctxFor({mode:"sol-fork-2",stage:"draft",
    session:{v:1,id:"v2bad-01",mode:"sol-fork-2",history:[msg()]},fetcher:seq(respMsg('{}'))})),e=>e.detail==="prefix_anchor_missing");
});
