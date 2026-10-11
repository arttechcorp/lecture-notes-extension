// 노트 실험 프로파일 레지스트리 — 실험 모드(devNoteMode)의 단계→모델·세션 계약을 한 표에 모은다.
// 새 실험 모드 = 이 표에 항목 하나(docs/note-experiments.md). 모드 이름 문자열 비교·목록을 다른 곳에 두지 않는다.
// 클라이언트(offscreen·stages)와 서버(server/note-session.js·index.js)가 같은 파일을 읽는다(UMD: 전역 NoteProfiles / module.exports).
(() => {
  const SOL="openai/gpt-6.1-sol",LUNA="openai/gpt-6-luna@high",HAIKU="anthropic/claude-haiku-5.5";
  // stages.<단계>: 서버가 강제하는 그 단계의 모델과 전송 방식.
  //   transport "session"     — noteSession 봉투를 실은 Sol 호출(fork 계열은 고정 접두 P+자기 작업)
  //   transport "independent" — 봉투 없는 독립 호출(Luna 독립 호출 포함)
  //   transport "packet"      — 봉투 없이 packet 칸만 싣는 독립 호출 또는(패킷이 없으면)세션 경로 — 둘 중 정확히 하나(sol-luna-3 repair)
  //   transport "dual"        — 봉투가 실리면 세션 경로(model), 안 실리면 봉투 없는 독립 호출(alt) — 봉투+packet 을 함께 실은 요청은 거절(mis-sol-hai repair)
  const I=m=>({model:m,transport:"independent"}),SE=m=>({model:m,transport:"session"}),PK=m=>({model:m,transport:"packet"}),DU=(m,alt)=>({model:m,transport:"dual",alt});
  // sol-luna-3 실험 옵션 정규화(구 lib/note-v3.js v3Options — 호환 키는 설정 devNoteV3): repair "packet"(기본)|"full-p", resume.
  const v3Options=(raw={})=>{const o=raw&&typeof raw==="object"&&!Array.isArray(raw)?raw:{};return{repair:o.repair==="full-p"?"full-p":"packet",resume:o.resume===true};};
  // 표의 행 순서 = ids() 순서: sol-luna-3 은 sol-luna-2 의 변형이라 그 바로 뒤다(서버 V2 목록·prompts 의 V2_MODES 순서 유지).
  const PROFILES={
    "independent":{id:"independent",family:"independent",session:null,clientModels:{plan:SOL,write:LUNA},options:null,
      stages:{plan:I(SOL),section:I(LUNA),draft:I(LUNA),repair:I(LUNA),global:I(LUNA),link:I(LUNA),questions:I(LUNA)}},
    "sol-session":{id:"sol-session",family:"session",session:"chain",clientModels:{plan:SOL,write:SOL},options:null,
      stages:{plan:SE(SOL),section:SE(SOL),draft:SE(SOL),repair:SE(SOL),global:SE(SOL),link:SE(SOL),questions:SE(SOL)}},
    "sol-luna-tool":{id:"sol-luna-tool",family:"session",session:"chain",clientModels:{plan:SOL,write:SOL},options:null,
      stages:{plan:SE(SOL),section:SE(SOL),draft:SE(SOL),repair:SE(SOL),global:SE(SOL),link:SE(SOL),questions:SE(SOL)}},
    "sol-fork":{id:"sol-fork",family:"session",session:"fork",clientModels:{plan:SOL,write:SOL},options:null,
      stages:{plan:SE(SOL),section:SE(SOL),draft:SE(SOL),repair:SE(SOL),global:SE(SOL),link:SE(SOL),questions:SE(SOL)}},
    "sol-luna-2":{id:"sol-luna-2",family:"v2",session:"fork",clientModels:{plan:SOL,write:LUNA},options:null,
      stages:{plan:SE(SOL),editorial:SE(SOL),draft:I(LUNA),questions:I(LUNA),review:SE(SOL),global:SE(SOL),repair:SE(SOL)}},
    "sol-luna-3":{id:"sol-luna-3",family:"v2",session:"fork",clientModels:{plan:SOL,write:LUNA},options:v3Options,
      stages:{plan:SE(SOL),editorial:SE(SOL),draft:I(LUNA),questions:I(LUNA),review:SE(SOL),global:SE(SOL),repair:PK(SOL)}},
    "sol-fork-2":{id:"sol-fork-2",family:"v2",session:"fork",clientModels:{plan:SOL,write:SOL},options:null,
      stages:{plan:SE(SOL),editorial:SE(SOL),draft:SE(SOL),questions:SE(SOL),review:SE(SOL),global:SE(SOL),repair:SE(SOL)}},
    // mis-sol-hai(기획 §3.2·§4.4·§4.5, D9): 계획·편집 계획·검수·전역·수리는 Sol 세션(Liner), 초안·문항은 Haiku 5.5 독립 호출(OpenRouter).
    //   stages.<단계>.strict — 그 단계의 세션 출력을 Liner strict json_schema 로 받는다(server/note-session.js solBody).
    //   vision — 이 모드의 슬라이드 인식 경로는 Mistral OCR(L2 의 /v1/vision 분기). prompts:"msh" — server/prompts.js MSH 단계 지시.
    //   reviewInput "html" — Sol 검수 입력은 렌더 HTML 축약본이다(L6 의 lib/review-html.js 가 data-block·data-claim 앵커를 남긴다).
    //   emphasisSignals — plan 입력에 유닛별 강조 신호 숫자를 싣고 JEV 판정은 끈다(L3 의 lib/emphasis.js).
    //   repair 이중 경로 — 세션이 실린 수리는 Sol(세션), 세션 없는 수리는 Haiku 독립 호출이다(L6 섹션 재작성이 봉투 없이 온다).
    //   lastFrame — 전환 직전 프레임으로 캡처해 필기까지 담는다(L1 의 VisualGate lastFrame 모드, background-job 이 읽는다).
    //   visionLanes — 비전 호출 레인 상한. Mistral OCR 은 초당 요청 한도가 낮아 1 로 줄인다(background-job 이 읽는다).
    "mis-sol-hai":{id:"mis-sol-hai",family:"v2",session:"fork",vision:"mistral-ocr-4-1",visionLanes:1,prompts:"msh",reviewInput:"html",emphasisSignals:true,lastFrame:true,clientModels:{plan:SOL,write:HAIKU},options:null,
      stages:{plan:SE(SOL),editorial:{...SE(SOL),strict:true},draft:I(HAIKU),questions:I(HAIKU),review:{...SE(SOL),strict:true},global:SE(SOL),repair:DU(SOL,HAIKU)}},
  };
  const build=profiles=>{
    const get=id=>Object.hasOwn(profiles,id)?profiles[id]:null;
    const ids=()=>Object.keys(profiles);
    const isV2=id=>get(id)?.family==="v2";
    // Luna 계열 v2: draft·questions 가 noteSession 없는 Luna 독립 호출인 v2 프로파일(sol-luna-2·sol-luna-3).
    const isLunaV2=id=>isV2(id)&&get(id).stages.draft?.transport==="independent";
    const stageModel=(id,stage)=>{const p=get(id);if(!p)return null;
      return p.stages[stage]?.model??(p.family==="v2"?p.clientModels.plan:stage==="plan"?p.clientModels.plan:p.clientModels.write);};
    // 서버 허용 판정(server/index.js v2 분기가 그대로 쓴다): ok 여부와 기대 모델·실제 전송 방식을 돌려준다.
    const serverRoute=(id,stage,{hasSession=false,hasPacket=false}={})=>{
      const spec=get(id)?.stages?.[stage];
      if(!spec)return{ok:false,model:null,transport:null};
      if(spec.transport==="independent")return{ok:!hasSession,model:spec.model,transport:"independent"};
      if(spec.transport==="session")return{ok:hasSession,model:spec.model,transport:"session"};
      if(spec.transport==="dual")return{ok:!(hasSession&&hasPacket),model:hasSession?spec.model:(spec.alt??spec.model),transport:hasSession?"session":"independent"}; // "dual": 세션이면 model 세션, 아니면 alt 독립
      return{ok:hasSession!==hasPacket,model:spec.model,transport:hasSession?"session":"packet"}; // "packet": 세션 XOR 패킷
    };
    return{SOL,LUNA,get,ids,isV2,isLunaV2,stageModel,serverRoute,withProfiles:extra=>build({...profiles,...extra})};
  };
  const api=build(PROFILES);
  globalThis.NoteProfiles=api;
  if(typeof module!=="undefined")module.exports=api;
})();
