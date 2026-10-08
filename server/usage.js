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
  },
  // 로컬 결과 캐시 hit/miss 의 콘텐츠 없는 run 집계(POST /v1/runs). 청구 정산 근거가 아니다 — jobId 마다 마지막 값만 남긴다.
  async recordRun({account,report}){
    const rec=record(account);(rec.runs??={})[report.jobId]={hits:report.cacheHits,misses:report.cacheMisses,rerun:report.rerun};
    const keys=Object.keys(rec.runs);if(keys.length>500)delete rec.runs[keys[0]];
    try{save();}catch{throw new Error("usage_store_failed");}
  }};
}
// 메타데이터는 usage_events 의 CHECK 와 같은 모양만 보낸다. 클라이언트가 고른 값(x-client-version)이나 설정 문자열이 모양을 어겨도
// 정산 RPC 전체가 거절되어 예약이 열린 채 남는 일이 없게, 어긋난 값은 null 로 바꾼다. 자유 텍스트는 어떤 칸으로도 나가지 않는다.
const text=(re,v)=>typeof v==="string"&&re.test(v)?v:null;
const count=v=>Number.isInteger(v)&&v>=0&&v<=2147483647?v:null;
const micros=v=>Number.isFinite(v)&&v>=0?Math.ceil(v*1e6):null;
const SHAPE={stage:/^[a-z][a-z0-9_.-]{0,31}$/,provider:/^[a-z][a-z0-9_.-]{0,31}$/,model:/^[A-Za-z0-9][A-Za-z0-9_./:@-]{0,95}$/,version:/^[A-Za-z0-9][A-Za-z0-9_.-]{0,31}$/,error:/^[a-z][a-z0-9_.-]{0,63}$/,client:/^[0-9A-Za-z][0-9A-Za-z._+-]{0,31}$/,job:/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/,host:/^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/,subject:/^[a-z][a-z0-9_]{0,31}$/,attempt:/^a[0-9]{1,4}$/};
const CACHE_KIND=["local_result","provider_prompt"],CACHE_STATUS=["hit","miss","unknown","not_applicable"],
  COST_STATUS=["provider_reported","estimated","unreported","not_applicable"],en=(list,v)=>list.includes(v)?v:null;
// 요청 안 제공자 HTTP 호출 하나의 기록(usage_attempts 행과 같은 칸 이름). 모양을 어긴 시도는 통째로 버린다.
function attemptRow(promptCache){
  return a=>{
    if(a===null||typeof a!=="object"||!SHAPE.attempt.test(a.id))return null;
    const cached=count(a.cachedInputTokens);
    const row={attempt_id:a.id,status:a.status==="error"?"error":"ok",error_code:text(SHAPE.error,a.error),
      input_tokens:count(a.inputTokens),output_tokens:count(a.outputTokens),cached_input_tokens:cached,cache_write_tokens:count(a.cacheWriteTokens),
      provider_reported_cost_micros:micros(a.providerReportedCost),cost_status:en(COST_STATUS,a.costStatus),
      cache_status:promptCache?(cached===null?"unknown":cached>0?"hit":"miss"):"not_applicable",latency_ms:count(Math.round(a.latencyMs))};
    // 선택 필드: 혼합 모델 실행(계획 Sol·작성 Luna 등)의 시도별 모델·공급자·단계와 추론 토큰.
    // 유효한 값이 올 때만 키를 싣는다 — 없거나 모양이 어긋나면 빼서 SQL이 요청 부모 값으로 채운다(coalesce, 이전 호환).
    const model=text(SHAPE.model,a.model);if(model!==null)row.model=model;
    const provider=text(SHAPE.provider,a.provider);if(provider!==null)row.provider=provider;
    const stage=text(SHAPE.stage,a.stage);if(stage!==null)row.stage=stage;
    const reasoning=count(a.reasoningTokens);if(reasoning!==null)row.reasoning_tokens=reasoning;
    return row;
  };
}
function eventFields(status,m){
  const used=status!=="refunded",seconds=Number.isFinite(m.audioSeconds)&&m.audioSeconds>=0&&m.audioSeconds<1e7?Math.round(m.audioSeconds*100)/100:null,
    lecture=Number.isFinite(m.lectureSeconds)&&m.lectureSeconds>=0&&m.lectureSeconds<1e7?Math.round(m.lectureSeconds*100)/100:null,
    cacheKind=en(CACHE_KIND,m.cacheKind),attempts=Array.isArray(m.attempts)?m.attempts.slice(0,64).map(attemptRow(cacheKind==="provider_prompt")).filter(Boolean):[];
  return {p_stage:text(SHAPE.stage,m.stage)||"unknown",p_provider:text(SHAPE.provider,m.provider),p_model:text(SHAPE.model,m.model),
    p_input_tokens:used?count(m.inputTokens):null,p_output_tokens:used?count(m.outputTokens):null,p_audio_seconds:used?seconds:null,p_images:used?count(m.images):null,
    p_prompt_version:text(SHAPE.version,m.promptVersion),p_schema_version:count(m.schemaVersion),p_error_code:text(SHAPE.error,m.errorCode),
    p_latency_ms:count(Math.round(m.latencyMs)),p_client_version:text(SHAPE.client,m.clientVersion),p_host:text(SHAPE.host,m.host),
    // subject 는 plan 단계의 Jev 분야 분류 결과다 — 못 정하면(실패·건너뜀) 둘 다 null 이다.
    p_job_id:text(SHAPE.job,m.jobId),p_lecture_seconds:lecture,p_slides:count(m.slides),
    p_subject:text(SHAPE.subject,m.subject),p_subject_conf:Number.isFinite(m.subjectConf)&&m.subjectConf>=0&&m.subjectConf<=1?Math.round(m.subjectConf*1e4)/1e4:null,
    // 논리 작업·시도·캐시·비용 보고: logical_task_id 는 클라이언트 재시도(-rN)를 묶는 기준 id, attempt_id 는 이 요청의 마지막 제공자 호출 번호.
    // 미보고 캐시 토큰은 null 로 보존해 보고된 0(miss)과 구분한다. 시도별 상세는 p_attempts(usage_attempts)에 간다.
    p_logical_task_id:text(SHAPE.job,m.logicalTaskId),p_attempt_id:text(SHAPE.attempt,m.attemptId),
    p_cache_kind:cacheKind,p_cache_status:en(CACHE_STATUS,m.cacheStatus),
    p_cached_input_tokens:used?count(m.cachedInputTokens):null,p_cache_write_tokens:used?count(m.cacheWriteTokens):null,
    p_provider_reported_cost_micros:used?micros(m.providerReportedCost):null,p_cost_status:en(COST_STATUS,m.costStatus),
    p_policy_version:text(SHAPE.version,m.policyVersion),p_attempts:attempts};
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
    // 제공자 동시 호출의 전역 상한(server/index.js 의 acquire). 잡으면 uuid, 꽉 차면 null. fileUsage 에는 없다 — 정적 배포는 프로세스 안 상한만 쓴다.
    slot:{
      acquire:(provider,max,ttlMs)=>rpc("acquire_provider_slot",{p_provider:provider,p_max:max,p_ttl_ms:ttlMs}),
      release:id=>rpc("release_provider_slot",{p_id:id}),
    },
    // 첫 로그인 때 한 번. 이미 있으면 건드리지 않는다(plan 을 되돌리지 않도록 ignore-duplicates).
    ensureProfile:user=>http(url+"/rest/v1/profiles?on_conflict=user_id",{method:"POST",headers:{...auth,"content-type":"application/json",prefer:"resolution=ignore-duplicates,return=minimal"},body:JSON.stringify({user_id:user})},false),
    // 계정 삭제(§9, D8)의 ②③단계. ② 는 행 삭제 + usage_events 비식별화 RPC, ③ 은 auth 사용자 삭제(GoTrue admin API, 서비스 롤 키)다. 둘 다 멱등이다.
    // ③ 의 404 는 이미 없다는 뜻이라 성공으로 센다(응답을 잃은 뒤의 재시도). 본문을 읽지 않으므로 다른 404 와는 구별하지 못한다.
    deleteData:user=>rpc("delete_account_data",{p_user:user}),
    async deleteAuthUser(user){try{await http(url+"/auth/v1/admin/users/"+user,{method:"DELETE",headers:auth},false);}catch(e){if(e?.status!==404)throw e;}},
    // 로컬 결과 캐시 hit/miss 의 콘텐츠 없는 run 집계(POST /v1/runs → run_reports). 청구 정산 근거가 아니다.
    // 같은 jobId 의 두 번째 보고는 무시한다(재전송·중복 수신에도 한 줄).
    async recordRun({account,report}){
      const res=await http(url+"/rest/v1/run_reports?on_conflict=user_id,job_id",{method:"POST",
        headers:{...auth,"content-type":"application/json",prefer:"resolution=ignore-duplicates,return=minimal"},
        body:JSON.stringify([{user_id:account,job_id:report.jobId,cache_kind:"local_result",cache_hits:report.cacheHits,cache_misses:report.cacheMisses,rerun:report.rerun,client_version:report.clientVersion??null}])},false);
      return res?.ok===true;
    },
    // /v1/me 의 한도 조회. plans·monthly_usage 직접 조회다(schema-v2.sql 의 service_role 권한).
    async quota(user,plan,monthStart){
      const q=name=>http(url+"/rest/v1/"+name,{headers:auth});
      const [caps,used]=await Promise.all([plan?q("plans?select=monthly_cost_cap_micros,monthly_request_cap,monthly_minutes_cap&plan=eq."+encodeURIComponent(plan)):[],q("monthly_usage?select=requests,minutes,cost_micros&user_id=eq."+encodeURIComponent(user)+"&month=eq."+monthStart)]);
      return {cap:Array.isArray(caps)?caps[0]||null:null,used:Array.isArray(used)?used[0]||null:null};
    },
  };
}

// 단계별 집계 helper: 내용 없는 숫자만으로 단계별 토큰·비용·적중률을 요약한다.
// 미보고된 토큰/비용은 null 을 유지하고 0 과 구분한다.
function stageUsageSummary(attempts=[]){
  if(!Array.isArray(attempts))return {byStage:[],total:null};
  const groups=new Map();
  for(const a of attempts){
    if(!a||typeof a!=="object")continue;
    const st=a.stage||a.p_stage||"unknown";
    if(!groups.has(st))groups.set(st,[]);
    groups.get(st).push(a);
  }
  const sumOrNull=(list,fn)=>{
    let sum=0,count=0;
    for(const item of list){
      const v=fn(item);
      if(Number.isFinite(v)&&v>=0){sum+=v;count++;}
    }
    return count>0?sum:null;
  };
  const costSumOrNull=(list,fn)=>{
    let sum=0,count=0;
    for(const item of list){
      const v=fn(item);
      if(Number.isFinite(v)&&v>=0){sum+=v;count++;}
    }
    return count>0?Math.round(sum*1e6)/1e6:null;
  };
  const numField=(a,...keys)=>{
    for(const k of keys){
      const v=a[k];
      if(Number.isFinite(v)&&v>=0)return Math.floor(v);
    }
    return null;
  };
  const costField=a=>{
    if(Number.isFinite(a.costUsd)&&a.costUsd>=0)return a.costUsd;
    if(Number.isFinite(a.providerReportedCost)&&a.providerReportedCost>=0)return a.providerReportedCost;
    if(Number.isFinite(a.provider_reported_cost_micros)&&a.provider_reported_cost_micros>=0)return a.provider_reported_cost_micros/1e6;
    return null;
  };
  const byStage=[];
  for(const [st,list] of groups.entries()){
    const models=[...new Set(list.map(a=>a.model||a.p_model).filter(Boolean))];
    const providers=[...new Set(list.map(a=>a.provider||a.p_provider).filter(Boolean))];
    const cacheRead=sumOrNull(list,a=>numField(a,"cachedInputTokens","cached_input_tokens"));
    const cacheWrite=sumOrNull(list,a=>numField(a,"cacheWriteTokens","cache_write_tokens"));
    const uncached=sumOrNull(list,a=>{
      const u=numField(a,"uncachedInputTokens","uncached_input_tokens");
      if(u!==null)return u;
      const inp=numField(a,"inputTokens","input_tokens");
      const rd=numField(a,"cachedInputTokens","cached_input_tokens")||0;
      const wr=numField(a,"cacheWriteTokens","cache_write_tokens")||0;
      return inp!==null?Math.max(0,inp-(rd+wr)):null;
    });
    const input=sumOrNull(list,a=>numField(a,"inputTokens","input_tokens"));
    const output=sumOrNull(list,a=>numField(a,"outputTokens","output_tokens"));
    const reasoning=sumOrNull(list,a=>numField(a,"reasoningTokens","reasoning_tokens"));
    const cost=costSumOrNull(list,costField);
    const eligible=(cacheRead||0)+(uncached||0);
    const hitRatio=eligible>0&&cacheRead!==null?Math.round(((cacheRead||0)/eligible)*10000)/10000:null;

    byStage.push({
      stage:st,
      model:models.length===1?models[0]:(models.length>1?models.join(","):null),
      provider:providers.length===1?providers[0]:(providers.length>1?providers.join(","):null),
      cacheReadTokens:cacheRead,
      cacheWriteTokens:cacheWrite,
      uncachedInputTokens:uncached,
      inputTokens:input,
      outputTokens:output,
      reasoningTokens:reasoning,
      costUsd:cost,
      hitRatio,
    });
  }

  const allModels=[...new Set(attempts.map(a=>a?.model||a?.p_model).filter(Boolean))];
  const allProviders=[...new Set(attempts.map(a=>a?.provider||a?.p_provider).filter(Boolean))];
  const totRead=sumOrNull(attempts,a=>numField(a,"cachedInputTokens","cached_input_tokens"));
  const totWrite=sumOrNull(attempts,a=>numField(a,"cacheWriteTokens","cache_write_tokens"));
  const totUncached=sumOrNull(attempts,a=>{
    const u=numField(a,"uncachedInputTokens","uncached_input_tokens");
    if(u!==null)return u;
    const inp=numField(a,"inputTokens","input_tokens");
    const rd=numField(a,"cachedInputTokens","cached_input_tokens")||0;
    const wr=numField(a,"cacheWriteTokens","cache_write_tokens")||0;
    return inp!==null?Math.max(0,inp-(rd+wr)):null;
  });
  const totInput=sumOrNull(attempts,a=>numField(a,"inputTokens","input_tokens"));
  const totOutput=sumOrNull(attempts,a=>numField(a,"outputTokens","output_tokens"));
  const totReasoning=sumOrNull(attempts,a=>numField(a,"reasoningTokens","reasoning_tokens"));
  const totCost=costSumOrNull(attempts,costField);
  const totEligible=(totRead||0)+(totUncached||0);
  const totHitRatio=totEligible>0&&totRead!==null?Math.round(((totRead||0)/totEligible)*10000)/10000:null;

  const total={
    stage:"total",
    model:allModels.length===1?allModels[0]:(allModels.length>1?allModels.join(","):null),
    provider:allProviders.length===1?allProviders[0]:(allProviders.length>1?allProviders.join(","):null),
    cacheReadTokens:totRead,
    cacheWriteTokens:totWrite,
    uncachedInputTokens:totUncached,
    inputTokens:totInput,
    outputTokens:totOutput,
    reasoningTokens:totReasoning,
    costUsd:totCost,
    hitRatio:totHitRatio,
  };

  return {byStage,total};
}

module.exports={fileUsage,supabaseUsage,FAIL_CODE,stageUsageSummary,aggregateUsageByStage:stageUsageSummary};
