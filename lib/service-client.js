(() => {
  // 서버가 minClientVersion 보다 낮은 클라이언트를 426으로 돌려보낸다 — 매 호출에 버전을 싣는다.
  // offscreen 문서에는 chrome.runtime.getManifest 가 없다(필드: usage_events.client_version 344건 모두 null) — offscreen 은 시작할 때 manifest.json 을 읽어 SUMMRIZEI_VERSION 에 둔다.
  const clientVersion=()=>{try{return (typeof chrome!=="undefined"&&chrome.runtime?.getManifest?.()?.version)||globalThis.SUMMRIZEI_VERSION||null;}catch{return globalThis.SUMMRIZEI_VERSION||null;}};
  function baseUrl(value){
    const u=new URL(value);
    // 원점(로컬 node 서버) 또는 Supabase Edge Function 경로(/functions/v1/<이름>)만 받는다.
    if(u.username||u.password||u.search||u.hash||!/^\/(?:functions\/v1\/[a-z0-9_-]+\/?)?$/.test(u.pathname||"/")||(u.protocol!=="https:"&&!(u.protocol==="http:"&&["localhost","127.0.0.1","[::1]"].includes(u.hostname))))throw new Error("서비스 주소는 HTTPS 원점이나 Supabase 함수 주소여야 합니다. 개발 환경만 localhost를 허용합니다.");
    return u.origin+u.pathname.replace(/\/$/,"");
  }
  // 401 진단용: 토큰을 검증 없이 읽어 껍데기만 남긴다 — sub·이메일·토큰 본문은 절대 싣지 않는다. 읽기는 어떤 입력에도 던지지 않는다.
  function tokenInfo(token){
    try{
      const parts=String(token||"").split(".");
      if(parts.length!==3)return {kind:"static",length:String(token||"").length};
      const decode=p=>JSON.parse(atob(p.replace(/-/g,"+").replace(/_/g,"/")+"=".repeat((4-p.length%4)%4))),header=decode(parts[0]),payload=decode(parts[1]);
      let iss=null;try{iss=payload?.iss?new URL(payload.iss).hostname:null;}catch{}
      return {kind:"jwt",alg:typeof header?.alg==="string"?header.alg:null,kid:typeof header?.kid==="string"?header.kid.slice(0,8):null,iss,expInSec:Number.isFinite(payload?.exp)?Math.round(payload.exp-Date.now()/1000):null};
    }catch{return {kind:"unreadable"};}
  }
  async function request(o,route,method="GET",body){
    if(typeof o.token!=="string"||o.token.length<32)throw new Error("서비스 연결을 먼저 설정하세요.");
    if(o.signal?.aborted)throw new DOMException("취소됨","AbortError");
    const controller=new AbortController(),onAbort=()=>controller.abort();
    o.signal?.addEventListener("abort",onAbort,{once:true});
    const timer=setTimeout(onAbort,Math.min(Number(o.timeoutMs)||120000,145000));
    try{
      const v=clientVersion();
      const response=await fetch(baseUrl(o.baseUrl)+route,{method,redirect:"error",signal:controller.signal,headers:{authorization:"Bearer "+o.token,"content-type":"application/json",...(v?{"x-client-version":v}:{})},body:body===undefined?undefined:JSON.stringify(body)});
      const reader=response.body.getReader(),decoder=new TextDecoder();let text="",bytes=0;
      try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>24*1024*1024)throw new Error("응답이 너무 큽니다.");text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}
      finally{await reader.cancel().catch(()=>{});}
      if(controller.signal.aborted)throw new DOMException("취소됨","AbortError");
      let data;try{data=JSON.parse(text);}catch{throw new Error("서비스 응답을 읽을 수 없습니다.");}
      if(!response.ok){
        // 새 봉투 {error:{code,message,retryable,retryAfterMs}}와 레거시 {error:"code"}를 둘 다 받는다.
        const messages={unauthorized:"로그인이 만료됐습니다. Google로 다시 로그인하세요.",token_expired:"로그인이 만료됐습니다. Google로 다시 로그인하세요.",client_upgrade_required:"확장 버전이 낮아 서비스가 요청을 받지 않습니다. chrome://extensions에서 업데이트한 뒤 다시 시도하세요.",quota_exceeded:"이번 달 요약 한도에 도달했습니다.",request_already_reserved_or_processed:"이미 처리했거나 비용이 예약된 요청입니다. 중복 요청은 실행하지 않았습니다.",provider_failed_or_invalid_output:"요약 제공자가 결과를 완료하지 못했습니다. 현재까지의 노트는 유지됩니다.",feature_not_in_account_plan:"현재 요금제에서 지원하지 않는 기능입니다.",provider_busy:"제공자가 혼잡합니다. 잠시 후 다시 시도하세요.",rate_limited:"요청이 너무 잦습니다. 잠시 후 다시 시도하세요.",invalid_audio:"음성 데이터 형식이 올바르지 않습니다."};
        const e=data&&typeof data.error==="object"&&data.error?data.error:{code:typeof data?.error==="string"?data.error:"unknown_error"};
        const err=new Error(messages[e.code]||e.message||"서비스 요청을 완료하지 못했습니다 ("+response.status+").");
        err.code=e.code;err.status=response.status;err.retryable=e.retryable===true;err.retryAfterMs=Number.isInteger(e.retryAfterMs)?e.retryAfterMs:null;
        if(response.status===401){err.tokenInfo=tokenInfo(o.token);if(typeof e.reason==="string")err.authReason=e.reason;if(e.detail!==undefined)err.authDetail=JSON.stringify(e.detail).slice(0,120);}
        throw err;
      }
      return data;
    }finally{clearTimeout(timer);o.signal?.removeEventListener("abort",onAbort);}
  }
  const JOB_ID=/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/,HOST=/^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/;
  // 선택 필드(jobId·host)는 문자열이고 모양이 맞을 때만 본문에 싣는다 — null·무효 값은 키째로 뺀다.
  const opt=(k,v,re)=>re.test(typeof v==="string"?v:"")?{[k]:v}:{};
  const id=x=>{if(!JOB_ID.test(x))throw new Error("보관 문서 번호가 올바르지 않습니다.");return x;};
  const api={
    vision:o=>request(o,"/v1/vision","POST",{model:o.model,requestId:o.requestId,slideId:o.slideId,t0:o.t0,t1:o.t1,image:o.image,mode:o.mode||"full",...opt("jobId",o.jobId,JOB_ID)}),
    stt:o=>request(o,"/v1/stt","POST",{model:o.model,requestId:o.requestId,t0:o.t0,durationSec:o.durationSec,lang:o.lang,prompt:o.prompt||"",audio:o.audio,...opt("jobId",o.jobId,JOB_ID)}),
    judge:o=>request(o,"/v1/judge","POST",{task:o.task,model:o.model,requestId:o.requestId,items:o.items,...opt("jobId",o.jobId,JOB_ID)}),
    plan:o=>request(o,"/v1/plan","POST",{model:o.model,requestId:o.requestId,noteSpecVersion:o.noteSpecVersion,ir:o.ir,formulas:o.formulas,figures:o.figures,recognition:o.recognition,options:o.options,...opt("jobId",o.jobId,JOB_ID),...opt("host",o.host,HOST)}),
    // stage 에 따라 section/units/registry · sections · repair 중 해당하는 것만 채운다. 값이 없는 키는 직렬화에서 빠진다.
    write:o=>request(o,"/v1/write","POST",{model:o.model,requestId:o.requestId,noteSpecVersion:o.noteSpecVersion,stage:o.stage,section:o.section,concepts:o.concepts,evidence:o.evidence,registry:o.registry,figures:o.figures,options:o.options,withGist:o.withGist,repair:o.repair,plan:o.plan,sections:o.sections,...opt("jobId",o.jobId,JOB_ID),...(o.sourceLang==="en"?{sourceLang:"en"}:{})}),
    summary:o=>request(o,"/v1/summary","POST",{model:o.model,stage:o.stage||"chunk",evidence:o.evidence,gaps:o.gaps,requestId:o.requestId}),
    me:o=>request(o,"/v1/me"),
    // 로컬 단계·호출 캐시 적중 집계(내용 없는 수치). 청구 근거가 아니라 관측용이다(server/index.js /v1/runs).
    reportRun:o=>request(o,"/v1/runs","POST",{jobId:o.jobId,cacheHits:o.cacheHits,cacheMisses:o.cacheMisses,rerun:o.rerun}),
    // Supabase 로그인 계정만. 성공하면 {deleted:true} — 이 뒤 토큰은 더 쓸 곳이 없으니 호출자가 세션을 정리한다.
    deleteAccount:o=>request(o,"/v1/account","DELETE"),
    saveEncrypted:o=>request(o,"/v1/vault/"+id(o.objectId),"PUT",{envelope:o.envelope}),
    loadEncrypted:o=>request(o,"/v1/vault/"+id(o.objectId)),
    deleteEncrypted:o=>request(o,"/v1/vault/"+id(o.objectId),"DELETE"),
    listEncrypted:o=>request(o,"/v1/vault"),baseUrl
  };
  globalThis.ServiceClient=api;if(typeof module!=="undefined")module.exports=api;
})();
