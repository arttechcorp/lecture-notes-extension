// 사용량 장부 어댑터. withReservation 은 저장소를 모른다: reserve() → {fail}|{settle}, settle({status,amount,meta}).
//   status: ok | error | refunded.  amount: 제공자가 보고한 USD, 모르면 null(예약 유지 — 공짜였다고 가정하지 않는다).
// FileUsage 는 정적 토큰 계정과 Supabase 미설정 배포의 기존 JSON 장부, SupabaseUsage 는 JWT 계정의 Postgres 장부다(schema-v2.sql).
const FAIL_CODE={duplicate:"request_already_reserved_or_processed",digest_mismatch:"idempotency_content_mismatch",quota_exceeded:"quota_exceeded"};
function fileUsage({state,record,save,month,globalCents}){
  return {async reserve({account,requestId,digest,cents,limits}){
    const rec=record(account),prior=Object.hasOwn(rec.jobs,requestId)?rec.jobs[requestId]:null;
    if(prior)return {fail:prior.digest===digest?"duplicate":"digest_mismatch"};
    const globalSpent=Object.values(state.accounts).filter(r=>r.month===month()).reduce((sum,r)=>sum+r.spentCents,0);
    if(rec.requests>=limits.maxRequests||rec.spentCents+cents>limits.maxCostCents||globalSpent+cents>globalCents)return {fail:"quota_exceeded"};
    rec.requests++;rec.spentCents+=cents;rec.jobs[requestId]={digest,status:"reserved",reservedCents:cents};
    try{save();}catch{throw new Error("usage_store_failed");}
    // rec 를 붙들고 있다 — 요청 도중 월이 바뀌어도 예약한 그 달의 줄을 정산한다.
    return {async settle({status,amount}){
      if(status==="refunded"){rec.requests--;rec.spentCents=Math.max(0,rec.spentCents-cents);delete rec.jobs[requestId];}
      else{
        // 보고된 비용만 정산한다. 성공은 비용 미보고여도 completed, 실패는 보고된 비용이 있을 때만 completed(잘림) 아니면 uncertain.
        const paid=amount!==null;
        if(paid)rec.spentCents=Math.max(0,rec.spentCents-cents+Math.ceil(amount*1e6)/1e4);
        rec.jobs[requestId].status=paid||status==="ok"?"completed":"uncertain";
      }
      save();
    }};
  }};
}
// 메타데이터는 usage_events 의 CHECK 와 같은 모양만 보낸다. 클라이언트가 고른 값(x-client-version)이나 설정 문자열이 모양을 어겨도
// 정산 RPC 전체가 거절되어 예약이 열린 채 남는 일이 없게, 어긋난 값은 null 로 바꾼다. 자유 텍스트는 어떤 칸으로도 나가지 않는다.
const text=(re,v)=>typeof v==="string"&&re.test(v)?v:null;
const count=v=>Number.isInteger(v)&&v>=0&&v<=2147483647?v:null;
const SHAPE={stage:/^[a-z][a-z0-9_.-]{0,31}$/,provider:/^[a-z][a-z0-9_.-]{0,31}$/,model:/^[A-Za-z0-9][A-Za-z0-9_./:@-]{0,95}$/,version:/^[A-Za-z0-9][A-Za-z0-9_.-]{0,31}$/,error:/^[a-z][a-z0-9_.-]{0,63}$/,client:/^[0-9A-Za-z][0-9A-Za-z._+-]{0,31}$/};
function eventFields(status,m){
  const used=status!=="refunded",seconds=Number.isFinite(m.audioSeconds)&&m.audioSeconds>=0&&m.audioSeconds<1e7?Math.round(m.audioSeconds*100)/100:null;
  return {p_stage:text(SHAPE.stage,m.stage)||"unknown",p_provider:text(SHAPE.provider,m.provider),p_model:text(SHAPE.model,m.model),
    p_input_tokens:used?count(m.inputTokens):null,p_output_tokens:used?count(m.outputTokens):null,p_audio_seconds:used?seconds:null,p_images:used?count(m.images):null,
    p_prompt_version:text(SHAPE.version,m.promptVersion),p_schema_version:count(m.schemaVersion),p_error_code:text(SHAPE.error,m.errorCode),
    p_latency_ms:count(Math.round(m.latencyMs)),p_client_version:text(SHAPE.client,m.clientVersion),
    // 신뢰할 수 있는 호스트 출처가 아직 없다 — 지금은 보내지 않는다.
    p_host:null};
}
// http(url,init,parse=true): 한도 있는 fetch → 파싱한 JSON. HTTP 오류와 시간 초과는 throw 한다.
function supabaseUsage({url,key,http}){
  const auth={apikey:key,authorization:"Bearer "+key},rpc=(name,args)=>http(url+"/rest/v1/rpc/"+name,{method:"POST",headers:{...auth,"content-type":"application/json"},body:JSON.stringify(args)});
  return {
    // 예약은 재시도하지 않는다: 응답을 못 받았어도 DB에는 들어갔을 수 있어서, 같은 requestId 로 다시 부르면 우리 자신의 예약이 duplicate 로 돌아온다.
    async reserve({account,requestId,digest,cents,minutes}){
      const r=await rpc("reserve_usage",{p_user:account,p_request_id:requestId,p_digest:digest,p_cost_micros:Math.ceil(cents*1e4),p_minutes:minutes});
      if(r==="reserved")return {async settle({status,amount,meta}){
        const body={p_user:account,p_request_id:requestId,p_actual_cost_micros:status==="refunded"||amount===null?null:Math.ceil(amount*1e6),p_status:status,...eventFields(status,meta)};
        // 같은 요청의 두 번째 정산은 DB가 already_settled 로 무시하므로 한 번 더 시도해도 안전하다.
        try{await rpc("settle_usage",body);}catch{await rpc("settle_usage",body);}
      }};
      if(typeof r==="string"&&Object.hasOwn(FAIL_CODE,r))return {fail:r};
      throw new Error("usage_store_failed");
    },
    async plan(user){const r=await rpc("effective_plan",{p_user:user});return typeof r==="string"&&/^[a-z][a-z0-9_]{0,31}$/.test(r)?r:null;},
    // 첫 로그인 때 한 번. 이미 있으면 건드리지 않는다(plan 을 되돌리지 않도록 ignore-duplicates).
    ensureProfile:user=>http(url+"/rest/v1/profiles?on_conflict=user_id",{method:"POST",headers:{...auth,"content-type":"application/json",prefer:"resolution=ignore-duplicates,return=minimal"},body:JSON.stringify({user_id:user})},false),
    // /v1/me 의 한도 조회. plans·monthly_usage 직접 조회다(schema-v2.sql 의 service_role 권한).
    async quota(user,plan,monthStart){
      const q=name=>http(url+"/rest/v1/"+name,{headers:auth});
      const [caps,used]=await Promise.all([plan?q("plans?select=monthly_cost_cap_micros,monthly_request_cap,monthly_minutes_cap&plan=eq."+encodeURIComponent(plan)):[],q("monthly_usage?select=requests,minutes,cost_micros&user_id=eq."+encodeURIComponent(user)+"&month=eq."+monthStart)]);
      return {cap:Array.isArray(caps)?caps[0]||null:null,used:Array.isArray(used)?used[0]||null:null};
    },
  };
}
module.exports={fileUsage,supabaseUsage,FAIL_CODE};
