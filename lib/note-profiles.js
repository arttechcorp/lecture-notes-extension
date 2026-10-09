// 노트 실험 프로파일 레지스트리 — 실험 모드(devNoteMode)의 단계→모델·세션 계약을 한 표에 모은다.
// 새 실험 모드 = 이 표에 항목 하나(docs/note-experiments.md). 모드 이름 문자열 비교·목록을 다른 곳에 두지 않는다.
// 클라이언트(offscreen·stages)와 서버(server/note-session.js·index.js)가 같은 파일을 읽는다(UMD: 전역 NoteProfiles / module.exports).
(() => {
  const SOL="openai/gpt-6.1-sol",LUNA="openai/gpt-6-luna@high";
  // stages.<단계>: 서버가 강제하는 그 단계의 모델과 전송 방식.
  //   transport "session"     — noteSession 봉투를 실은 Sol 호출(fork 계열은 고정 접두 P+자기 작업)
  //   transport "independent" — 봉투 없는 독립 호출(Luna 독립 호출 포함)
  //   transport "packet"      — 봉투 없이 packet 칸만 싣는 독립 호출 또는(패킷이 없으면)세션 경로 — 둘 중 정확히 하나(sol-luna-3 repair)
  const I=m=>({model:m,transport:"independent"}),SE=m=>({model:m,transport:"session"}),PK=m=>({model:m,transport:"packet"});
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
      return{ok:hasSession!==hasPacket,model:spec.model,transport:hasSession?"session":"packet"}; // "packet": 세션 XOR 패킷
    };
    return{SOL,LUNA,get,ids,isV2,isLunaV2,stageModel,serverRoute,withProfiles:extra=>build({...profiles,...extra})};
  };
  const api=build(PROFILES);
  globalThis.NoteProfiles=api;
  if(typeof module!=="undefined")module.exports=api;
})();
