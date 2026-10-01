// ponytail: single-process pilot with atomic files; move reservations to DB transactions before multi-instance scaling.
// Operator key server-only; archive contents are authenticated ciphertext.
const fs=require("node:fs"),path=require("node:path"),http=require("node:http"),crypto=require("node:crypto");
const Vault=require("../lib/vault.js"),{validateSummary}=require("../lib/summary.js");
const Contracts=require("../lib/contracts.js");
const RATES={"google/gemini-2.5-flash-lite":[.1,.4],"google/gemini-3.8-flash":[1.5,7.5],"google/gemini-2.5-pro":[1.25,10],"anthropic/claude-haiku-4.5":[1,5],"anthropic/claude-sonnet-4.6":[3,15],"anthropic/claude-sonnet-5":[2,10]};
// 이미지 입력은 텍스트와 단가가 다르고 출력도 훨씬 짧다. /v1/summary 와 예약 계산을 섞지 않는다.
const VISION_RATES={"google/gemini-2.5-flash-lite":[.1,.4],"google/gemini-3.8-flash":[1.5,7.5],"mistralai/ministral-8b-2512":[.15,.15],"qwen/qwen3-vl-8b-instruct":[.12,.45]};
const VISION_MAX_TOKENS=4096;
// 한 프레임을 읽는 지시. 요약이 아니라 "화면에 있는 것을 구조대로 옮겨 적기"다 —
// 여기서 모델이 요약을 시작하면 뒤쪽 합성 단계가 두 번 요약한 글을 받는다.
const VISION_PROMPT=[
  "이미지는 강의 슬라이드 한 장이다. 화면에 실제로 보이는 내용만 옮겨 적는다.",
  "수식은 LaTeX($...$ 또는 $$...$$), 표는 마크다운 표, 목록은 마크다운 목록으로 적는다.",
  "그래프·도식은 축·계열·추세를 한두 문장으로 설명한다.",
  "요약하거나 배경지식을 덧붙이지 않는다. 보이지 않는 것은 적지 않는다.",
  "판서·강조 표시가 있으면 해당 줄 끝에 (판서)로 표시한다.",
  "슬라이드가 비었거나 읽을 내용이 없으면 빈 문자열만 출력한다.",
].join("\n");
const {schema,systemFor,systemMessage,reasoningFor,maxTokensFor,parseNote}=require("../lib/openrouter-client.js");
const safePart=x=>{if(typeof x!=="string"||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(x))throw new Error("invalid_id");return x;};
const tokenEqual=(a,b)=>{const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&crypto.timingSafeEqual(x,y);};
const positive=(x,fallback)=>{const n=Number(x??fallback);if(!Number.isFinite(n)||n<=0)throw new Error("invalid_limit");return n;};
const FEATURES=["vision","stt","background","judge"];
// 재시도 계약: 같은 requestId는 멱등이다(중복은 409). 제공자 호출이 나간 뒤 실패하면 예약은
// "uncertain"으로 남아 비용을 보수적으로 잡으므로, 5xx 뒤 재시도는 새 requestId(예: 원본 + "-r1")를 써야 한다.
const ERRORS={
  origin_not_allowed:[403,false,"이 확장 출처에서는 호출할 수 없습니다."],
  unauthorized:[401,false,"서비스 인증이 올바르지 않습니다."],
  not_found:[404,false,"대상을 찾을 수 없습니다."],
  request_rejected:[400,false,"요청 형식이 올바르지 않습니다."],
  request_too_large:[413,false,"요청이 너무 큽니다."],
  request_already_reserved_or_processed:[409,false,"이미 처리했거나 비용이 예약된 요청입니다."],
  idempotency_content_mismatch:[400,false,"같은 요청 번호에 다른 본문입니다."],
  quota_exceeded:[429,false,"이번 달 사용 한도에 도달했습니다."],
  invalid_model_or_stage:[400,false,"모델 또는 단계가 올바르지 않습니다."],
  invalid_model:[400,false,"지원하지 않는 모델입니다."],
  model_not_in_account_plan:[403,false,"현재 요금제에서 지원하지 않는 모델입니다."],
  feature_not_in_account_plan:[403,false,"현재 요금제에서 지원하지 않는 기능입니다."],
  unexpected_field:[400,false,"허용되지 않는 필드가 있습니다."],
  invalid_evidence:[400,false,"근거 형식이 올바르지 않습니다."],
  invalid_gaps:[400,false,"끊긴 구간 형식이 올바르지 않습니다."],
  evidence_too_large:[413,false,"근거가 너무 큽니다."],
  invalid_image:[400,false,"이미지 형식이 올바르지 않습니다."],
  image_too_large:[413,false,"이미지가 너무 큽니다."],
  archive_quota_exceeded:[413,false,"보관함 용량을 초과했습니다."],
  request_cancelled_or_timed_out:[504,true,"요청이 취소됐거나 시간을 초과했습니다."],
  provider_failed_or_invalid_output:[502,true,"제공자가 결과를 완료하지 못했습니다."],
  provider_busy:[429,true,"제공자가 혼잡합니다. 잠시 후 다시 시도하세요."],
  rate_limited:[429,true,"요청이 너무 잦습니다. 잠시 후 다시 시도하세요."],
  account_concurrency_exceeded:[429,true,"동시에 처리할 수 있는 요청 수를 넘었습니다."],
  client_upgrade_required:[426,false,"확장을 최신 버전으로 업데이트하세요."],
};
// Chrome 확장 버전은 1~4개 숫자 조각이다. x.y.z 로만 읽으면 4조각 버전이 0.0.0 으로 떨어져 426 을 맞는다.
const version=v=>{const m=/^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:\.(\d+))?$/.exec(String(v??"0.0.0"));return m?m.slice(1).map(x=>Number(x||0)):[0,0,0,0];};
const below=(a,b)=>{for(let i=0;i<4;i++)if(a[i]!==b[i])return a[i]<b[i];return false;};
function config(env){
  const tokens=JSON.parse(env.APP_TOKENS_JSON||"{}"),allow=JSON.parse(env.ALLOWED_MODELS||'["google/gemini-2.5-flash-lite"]');
  const known=new Set();
  if(!Object.keys(tokens).length)throw new Error("APP_TOKENS_JSON required");
  for(const [account,token]of Object.entries(tokens)){safePart(account);if(typeof token!=="string"||token.length<32||known.has(token))throw new Error("unique_32_character_tokens_required");known.add(token);}
  if(!Array.isArray(allow)||!allow.length||allow.some(m=>!RATES[m]))throw new Error("invalid_model_allowlist");
  if(!/^chrome-extension:\/\/[a-p]{32}$/.test(env.EXTENSION_ORIGIN||""))throw new Error("exact_extension_origin_required");
  const providers=JSON.parse(env.OPENROUTER_PROVIDERS_JSON||"{}");
  for(const m of allow)if(!Array.isArray(providers[m])||!providers[m].length||providers[m].some(p=>typeof p!=="string"||p.length>100))throw new Error("explicit_provider_allowlist_required");
  const visionModels=JSON.parse(env.ALLOWED_VISION_MODELS||"[]");
  if(!Array.isArray(visionModels)||visionModels.some(m=>!VISION_RATES[m]))throw new Error("invalid_vision_model_allowlist");
  for(const m of visionModels)if(!Array.isArray(providers[m])||!providers[m].length)throw new Error("explicit_provider_allowlist_required");
  if(!env.OPENROUTER_API_KEY)throw new Error("OPENROUTER_API_KEY required");
  const accountLimits=JSON.parse(env.ACCOUNT_LIMITS_JSON||"{}");
  for(const [id,limit]of Object.entries(accountLimits)){
    if(!Object.hasOwn(tokens,id)||!limit||Object.keys(limit).some(k=>!["models","maxRequests","maxCostCents","features"].includes(k)))throw new Error("invalid_account_limits");
    if(!Array.isArray(limit.models)||!limit.models.length||limit.models.some(m=>!allow.includes(m)))throw new Error("invalid_account_models");
    // 기능 이름은 열린 문자열이 아니다. 오타 난 플랜 설정이 조용히 "기능 없음"으로 읽히면
    // 결제한 계정이 못 쓰고, 넓은 이름을 허용하면 권한이 새로 생겨도 아무도 모른다.
    if(limit.features!==undefined&&(!Array.isArray(limit.features)||limit.features.some(f=>!FEATURES.includes(f))))throw new Error("invalid_account_features");
    positive(limit.maxRequests);positive(limit.maxCostCents);
  }
  const plain=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
  const featureFlags=JSON.parse(env.FEATURE_FLAGS_JSON||"{}");
  if(!plain(featureFlags)||Object.entries(featureFlags).some(([k,v])=>!FEATURES.includes(k)||typeof v!=="boolean"))throw new Error("invalid_feature_flags");
  const remoteConfig={concurrency:{download:4,decode:1,stt:4,vision:8,judge:2,write:8},throughputMbps:50,minClientVersion:"0.0.0",promptVersion:"v1",schemaVersion:1};
  const remoteIn=JSON.parse(env.REMOTE_CONFIG_JSON||"{}");
  if(!plain(remoteIn)||Object.keys(remoteIn).some(k=>!Object.hasOwn(remoteConfig,k)))throw new Error("invalid_remote_config");
  if(remoteIn.concurrency!==undefined){
    if(!plain(remoteIn.concurrency)||Object.entries(remoteIn.concurrency).some(([k,v])=>!Object.hasOwn(remoteConfig.concurrency,k)||!Number.isFinite(v)||v<=0))throw new Error("invalid_remote_config");
    remoteConfig.concurrency={...remoteConfig.concurrency,...remoteIn.concurrency};
  }
  for(const k of ["throughputMbps","schemaVersion"])if(remoteIn[k]!==undefined){if(!Number.isFinite(remoteIn[k])||remoteIn[k]<=0)throw new Error("invalid_remote_config");remoteConfig[k]=remoteIn[k];}
  if(remoteIn.minClientVersion!==undefined){if(typeof remoteIn.minClientVersion!=="string"||!/^\d+\.\d+\.\d+$/.test(remoteIn.minClientVersion))throw new Error("invalid_remote_config");remoteConfig.minClientVersion=remoteIn.minClientVersion;}
  if(remoteIn.promptVersion!==undefined){if(typeof remoteIn.promptVersion!=="string"||!remoteIn.promptVersion)throw new Error("invalid_remote_config");remoteConfig.promptVersion=remoteIn.promptVersion;}
  const providerConcurrency=JSON.parse(env.PROVIDER_CONCURRENCY_JSON||"{}");
  if(!plain(providerConcurrency)||Object.values(providerConcurrency).some(v=>!Number.isInteger(v)||v<=0))throw new Error("invalid_provider_concurrency");
  return {tokens,allow,providers,key:env.OPENROUTER_API_KEY,origin:env.EXTENSION_ORIGIN,root:path.resolve(env.VAULT_DIR||"server-data"),stateFile:env.USAGE_STATE_FILE?path.resolve(env.USAGE_STATE_FILE):null,
    accountLimits,visionModels,featureFlags,remoteConfig,providerConcurrency,maxCents:positive(env.MAX_COST_CENTS,1500),maxRequests:positive(env.MAX_REQUESTS,500),globalCents:positive(env.GLOBAL_COST_CENTS,15000),timeout:Math.min(positive(env.OPENROUTER_TIMEOUT_MS,120000),120000),accountConcurrency:positive(env.ACCOUNT_CONCURRENCY,12),providerQueueMs:positive(env.PROVIDER_QUEUE_MS,10000),ratePerMin:positive(env.ACCOUNT_RATE_PER_MIN,120),maxFiles:100,maxArchiveBytes:200*1024*1024};
}
function atomic(file,data){fs.mkdirSync(path.dirname(file),{recursive:true});const temp=file+"."+crypto.randomUUID()+".tmp";fs.writeFileSync(temp,JSON.stringify(data),{mode:0o600,flag:"wx"});fs.renameSync(temp,file);}
function readState(file){
  if(!fs.existsSync(file))return {accounts:{}};
  const s=JSON.parse(fs.readFileSync(file,"utf8"));
  const object=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
  if(!object(s)||!object(s.accounts))throw new Error("invalid_usage_state");
  for(const [account,r]of Object.entries(s.accounts)){
    safePart(account);
    if(!object(r)||!Number.isFinite(r.spentCents)||r.spentCents<0||!Number.isInteger(r.requests)||r.requests<0||!object(r.jobs)||!/^\d{4}-(0[1-9]|1[0-2])$/.test(r.month))throw new Error("invalid_usage_state");
    for(const [id,job]of Object.entries(r.jobs)){
      safePart(id);
      if(!object(job)||!/^[a-f0-9]{64}$/.test(job.digest)||!["reserved","completed","uncertain"].includes(job.status)||!Number.isFinite(job.reservedCents)||job.reservedCents<0)throw new Error("invalid_usage_state");
    }
  }
  return s;
}
function createServer(env=process.env,deps={}){
  const c=config(env);fs.mkdirSync(c.root,{recursive:true});
  if(fs.lstatSync(c.root).isSymbolicLink())throw new Error("archive_root_symlink_not_allowed");
  const usageFile=c.stateFile||path.join(c.root,"usage.json"),state=readState(usageFile),fetcher=deps.fetch||fetch,inflight=new Map(),active=new Set(),sems=new Map(),buckets=new Map();
  const month=()=>new Date().toISOString().slice(0,7);
  const record=account=>{
    let r=Object.hasOwn(state.accounts,account)?state.accounts[account]:null;
    if(!r||r.month!==month())r=state.accounts[account]={month:month(),requests:0,spentCents:0,jobs:{}};
    return r;
  };
  const save=()=>atomic(usageFile,state);
  const limitFor=account=>Object.hasOwn(c.accountLimits,account)?{features:[],...c.accountLimits[account]}:{models:c.allow,maxRequests:c.maxRequests,maxCostCents:c.maxCents,features:[]};
  const fail=(res,code,retryAfterMs)=>{const [status,retryable,message]=ERRORS[code]||[500,false,"요청을 처리하지 못했습니다."];send(res,status,{error:{code,message,retryable,retryAfterMs:Number.isInteger(retryAfterMs)?retryAfterMs:null}});};
  function send(res,status,data){
    if(res.destroyed||res.writableEnded)return;
    res.writeHead(status,{"content-type":"application/json","cache-control":"no-store","x-content-type-options":"nosniff","access-control-allow-origin":c.origin,"vary":"Origin","access-control-allow-headers":"authorization,content-type,x-client-version","access-control-allow-methods":"GET,PUT,POST,DELETE,OPTIONS"});
    res.end(status===204?undefined:JSON.stringify(data));
  }
  function accountFor(req){
    const header=req.headers.authorization||"",token=header.startsWith("Bearer ")?header.slice(7):"";
    return Object.entries(c.tokens).find(([,v])=>tokenEqual(token,v))?.[0];
  }
  async function body(req,max){
    const declared=Number(req.headers["content-length"]);if(declared>max)throw new Error("request_too_large");
    const chunks=[];let size=0;
    for await(const chunk of req){size+=chunk.length;if(size>max)throw new Error("request_too_large");chunks.push(chunk);}
    return JSON.parse(Buffer.concat(chunks).toString("utf8")||"{}");
  }
  function accountDir(account){
    const parent=path.join(c.root,"vault"),dir=path.join(parent,safePart(account));
    for(const p of [parent,dir]){if(fs.existsSync(p)&&fs.lstatSync(p).isSymbolicLink())throw new Error("symlink_not_allowed");fs.mkdirSync(p,{recursive:true});}
    return dir;
  }
  function fileFor(account,id){
    const dir=accountDir(account),file=path.join(dir,safePart(id)+".json");
    if(!file.startsWith(dir+path.sep)||fs.existsSync(file)&&fs.lstatSync(file).isSymbolicLink())throw new Error("invalid_path");
    return file;
  }
  // 모델별 제공자 슬롯. 대기자는 FIFO로 슬롯을 물려받고 타임아웃은 .refund로 구분한다 —
  // 슬롯을 얻지 못한 요청은 제공자에 아무것도 보내지 않았으므로 예약을 정확히 되돌려야 한다.
  const slot=s=>{s.running++;let used=false;return()=>{if(used)return;used=true;s.running--;const w=s.queue.find(x=>!x.done);if(w){s.queue.splice(s.queue.indexOf(w),1);w.grant();}};};
  function acquire(model,signal){
    if(!model)return Promise.resolve(()=>{});
    let s=sems.get(model);if(!s)sems.set(model,s={running:0,queue:[]});
    if(!s.queue.length&&s.running<(c.providerConcurrency[model]||16))return Promise.resolve(slot(s));
    return new Promise((resolve,reject)=>{
      const w={};
      w.leave=(fn,v)=>{if(w.done)return;w.done=true;clearTimeout(w.timer);signal?.removeEventListener("abort",w.onAbort);const i=s.queue.indexOf(w);if(i>=0)s.queue.splice(i,1);fn(v);};
      w.grant=()=>{if(w.done)return;w.done=true;clearTimeout(w.timer);signal?.removeEventListener("abort",w.onAbort);resolve(slot(s));};
      w.timer=setTimeout(()=>w.leave(reject,Object.assign(new Error("provider_busy"),{refund:true,code:"provider_busy",retryAfterMs:2000})),c.providerQueueMs);
      w.onAbort=()=>w.leave(reject,Object.assign(new Error("aborted"),{refund:true,code:"request_cancelled_or_timed_out"}));
      s.queue.push(w);signal?.addEventListener("abort",w.onAbort,{once:true});
    });
  }
  // 계정별 분당 POST 토큰 버킷 — 한도를 넘은 요청에는 한 토큰이 찰 때까지의 시간을 알려준다.
  const bucket=account=>{let b=buckets.get(account);if(!b)buckets.set(account,b={tokens:c.ratePerMin,ts:Date.now()});const now=Date.now();b.tokens=Math.min(c.ratePerMin,b.tokens+(now-b.ts)*c.ratePerMin/6e4);b.ts=now;return b;};
  // /v1/summary 와 /v1/vision 이 같은 돈을 쓴다. 예약·멱등·락·정산을 한 군데 두지 않으면
  // 두 라우트의 한도 계산이 조용히 어긋난다 — 어긋난 쪽이 무료로 돌아가는 실패 모드다.
  async function withReservation({account,requestId,digest,reserve,model,res},run){
    const limits=limitFor(account),rec=record(account);
    const prior=Object.hasOwn(rec.jobs,requestId)?rec.jobs[requestId]:null;
    if(prior)return fail(res,prior.digest===digest?"request_already_reserved_or_processed":"idempotency_content_mismatch");
    if((inflight.get(account)||0)>=c.accountConcurrency)return fail(res,"account_concurrency_exceeded",1000);
    const globalSpent=Object.values(state.accounts).filter(r=>r.month===month()).reduce((sum,r)=>sum+r.spentCents,0);
    if(rec.requests>=limits.maxRequests||rec.spentCents+reserve>limits.maxCostCents||globalSpent+reserve>c.globalCents)return fail(res,"quota_exceeded");
    inflight.set(account,(inflight.get(account)||0)+1);rec.requests++;rec.spentCents+=reserve;rec.jobs[requestId]={digest,status:"reserved",reservedCents:reserve};
    try{save();}catch{const n=inflight.get(account)-1;n>0?inflight.set(account,n):inflight.delete(account);throw new Error("usage_store_failed");}
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),c.timeout);
    const disconnect=()=>{if(!res.writableEnded)controller.abort();};res.on("close",disconnect);active.add(controller);
    try{
      const release=await acquire(model,controller.signal);
      try{
        const {amount,reported,payload}=await run(controller.signal);
        // Unknown or failed requests keep the full reservation; never assume an unreported request was free.
        if(reported)rec.spentCents=Math.max(0,rec.spentCents-reserve+Math.ceil(amount*1e6)/1e4);
        rec.jobs[requestId].status="completed";save();
        send(res,200,payload);
      }finally{release();}
    }catch(e){
      if(e&&e.refund){rec.requests--;rec.spentCents=Math.max(0,rec.spentCents-reserve);delete rec.jobs[requestId];save();fail(res,e.code||"provider_failed_or_invalid_output",e.retryAfterMs);}
      else{rec.jobs[requestId].status="uncertain";save();fail(res,controller.signal.aborted?"request_cancelled_or_timed_out":"provider_failed_or_invalid_output");}
    }finally{clearTimeout(timer);res.removeListener("close",disconnect);const n=(inflight.get(account)||1)-1;n>0?inflight.set(account,n):inflight.delete(account);active.delete(controller);}
  }
  async function summary(input,account,req,res){
    const limits=limitFor(account);
    if(!c.allow.includes(input.model)||!["chunk","synthesis"].includes(input.stage))return fail(res,"invalid_model_or_stage");
    if(!limits.models.includes(input.model))return fail(res,"model_not_in_account_plan");
    safePart(input.requestId);
    if(Object.keys(input).some(k=>!["model","stage","requestId","evidence","gaps"].includes(k)))return fail(res,"unexpected_field");
    const items=input.evidence;
    if(!Array.isArray(items)||!items.length||items.length>2000||items.some(e=>!e||typeof e.id!=="string"||!e.id||e.id.length>128||typeof e.text!=="string"||!e.text.trim()||!["ocr","asr"].includes(e.source)||!Number.isFinite(e.t0)||!Number.isFinite(e.t1)||!["included","uncertain"].includes(e.selection)||(e.selectionReason!==undefined&&(typeof e.selectionReason!=="string"||e.selectionReason.length>300))||Object.keys(e).some(k=>!["id","text","source","t0","t1","selection","selectionReason"].includes(k))))return fail(res,"invalid_evidence");
    // 캡처가 끊긴 구간. 강의 내용이 아니라 메타데이터라서 근거와 따로 싣고 따로 검사한다.
    const gaps=input.gaps===undefined?[]:input.gaps;
    if(!Array.isArray(gaps)||gaps.length>200||gaps.some(g=>!g||typeof g.reason!=="string"||!g.reason||g.reason.length>64||!Number.isFinite(g.t0)||!Number.isFinite(g.t1)||g.t1<g.t0||Object.keys(g).some(k=>!["reason","t0","t1"].includes(k))))return fail(res,"invalid_gaps");
    const text=JSON.stringify(items);
    if(Buffer.byteLength(text)>48000)return fail(res,"evidence_too_large");
    const digest=crypto.createHash("sha256").update(JSON.stringify({model:input.model,stage:input.stage,evidence:items,gaps})).digest("hex");
    const [pi,po]=RATES[input.model],maxOutput=maxTokensFor(input.model),attempts=2;
    // Reserve both attempts: a malformed structured response is retried once on the same fixed provider.
    const reserve=Math.ceil(((Buffer.byteLength(text)+Buffer.byteLength(systemFor(input.stage))+8192)*pi+maxOutput*po)/1e6*100*1.2*attempts);
    return await withReservation({account,requestId:input.requestId,digest,reserve,model:input.model,res},async signal=>{
      let parsed,usage={},amount=0,reported=true;
      for(let retry=0;retry<attempts;retry++){
        const response=await fetcher("https://openrouter.ai/api/v1/chat/completions",{method:"POST",redirect:"error",signal,headers:{authorization:"Bearer "+c.key,"content-type":"application/json"},body:JSON.stringify({
          model:input.model,max_tokens:maxOutput,reasoning:reasoningFor(input.model),
          messages:[systemMessage(input.model,input.stage),{role:"user",content:JSON.stringify({stage:input.stage,evidence:items,...(gaps.length?{gaps}:{})})}],
          response_format:{type:"json_schema",json_schema:{name:"lecture_summary",strict:true,schema}},
          provider:{only:c.providers[input.model],order:c.providers[input.model],require_parameters:true,allow_fallbacks:false,zdr:true,data_collection:"deny"}
        })});
        if(!response.ok)throw new Error("provider_failed");
        const raw=await boundedResponse(response,1024*1024),u=raw.usage||{};
        usage={promptTokens:(usage.promptTokens||0)+(Number(u.prompt_tokens)||0),completionTokens:(usage.completionTokens||0)+(Number(u.completion_tokens)||0)};
        if(typeof u.cost==="number"&&Number.isFinite(u.cost)&&u.cost>=0)amount+=u.cost;else reported=false;
        try{
          if(raw.choices?.[0]?.finish_reason!=="stop")throw new Error("provider_output_incomplete");
          parsed=validateSummary(parseNote(raw.choices[0].message.content),items);
          break;
        }catch(error){if(retry===attempts-1)throw error;}
      }
      return {amount,reported,payload:{summary:parsed,usage:{...usage,costUsd:reported?amount:reserve/100}}};
    });
  }
  async function vision(input,account,res){
    if(!(limitFor(account).features||[]).includes("vision")||c.featureFlags.vision===false)return fail(res,"feature_not_in_account_plan");
    if(!c.visionModels.includes(input.model))return fail(res,"invalid_model");
    safePart(input.requestId);
    if(Object.keys(input).some(k=>!["model","requestId","image"].includes(k)))return fail(res,"unexpected_field");
    const match=/^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(String(input.image||""));
    if(!match)return fail(res,"invalid_image");
    const bytes=Buffer.from(match[1],"base64").byteLength;
    if(!bytes||bytes>1536*1024)return fail(res,"image_too_large");
    // digest 는 프레임 내용이 아니라 그 해시로 잡는다. 사용량 파일에 이미지가 남으면 안 된다.
    const digest=crypto.createHash("sha256").update(JSON.stringify({model:input.model,image:crypto.createHash("sha256").update(match[1]).digest("hex")})).digest("hex");
    const [pi,po]=VISION_RATES[input.model];
    // 이미지 토큰 수는 사전에 알 수 없다. 해상도 상한에서 나오는 최악값을 잡고 정산에서 되돌린다.
    const reserve=Math.ceil((8000*pi+VISION_MAX_TOKENS*po)/1e6*100*1.2);
    return await withReservation({account,requestId:input.requestId,digest,reserve,model:input.model,res},async signal=>{
      const response=await fetcher("https://openrouter.ai/api/v1/chat/completions",{method:"POST",redirect:"error",signal,headers:{authorization:"Bearer "+c.key,"content-type":"application/json"},body:JSON.stringify({
        model:input.model,max_tokens:VISION_MAX_TOKENS,
        messages:[{role:"user",content:[{type:"text",text:VISION_PROMPT},{type:"image_url",image_url:{url:input.image}}]}],
        provider:{only:c.providers[input.model],order:c.providers[input.model],require_parameters:true,allow_fallbacks:false,zdr:true,data_collection:"deny"}
      })});
      if(!response.ok)throw new Error("provider_failed");
      const raw=await boundedResponse(response,1024*1024),u=raw.usage||{};
      if(raw.choices?.[0]?.finish_reason!=="stop")throw new Error("provider_output_incomplete");
      const reported=typeof u.cost==="number"&&Number.isFinite(u.cost)&&u.cost>=0;
      return {amount:reported?u.cost:0,reported,payload:{
        text:String(raw.choices[0].message.content||"").slice(0,20000),
        usage:{promptTokens:Number(u.prompt_tokens)||0,completionTokens:Number(u.completion_tokens)||0,costUsd:reported?u.cost:reserve/100},
      }};
    });
  }
  const server=http.createServer(async(req,res)=>{
    try{
      if(req.headers.origin&&req.headers.origin!==c.origin)return fail(res,"origin_not_allowed");
      if(req.method==="OPTIONS")return send(res,204,{});
      const account=accountFor(req);if(!account)return fail(res,"unauthorized");
      if(below(version(req.headers["x-client-version"]),version(c.remoteConfig.minClientVersion)))return fail(res,"client_upgrade_required");
      if(req.method==="POST"){const b=bucket(account);if(b.tokens<1)return fail(res,"rate_limited",Math.ceil((1-b.tokens)*6e4/c.ratePerMin));b.tokens--;}
      if(req.url==="/v1/me"&&req.method==="GET"){const r=record(account),limits=limitFor(account);return send(res,200,{accountId:account,models:limits.models,features:(limits.features||[]).filter(f=>c.featureFlags[f]!==false),config:c.remoteConfig,quota:{month:r.month,requests:r.requests,maxRequests:limits.maxRequests,spentCents:r.spentCents,maxCents:limits.maxCostCents}});}
      if(req.url==="/v1/vault"&&req.method==="GET")return send(res,200,{items:fs.readdirSync(accountDir(account)).filter(x=>/^[A-Za-z0-9][A-Za-z0-9_-]*\.json$/.test(x)).map(x=>({objectId:x.slice(0,-5)}))});
      const match=req.url?.match(/^\/v1\/vault\/([A-Za-z0-9][A-Za-z0-9_-]{0,127})$/);
      if(match){
        const id=match[1],file=fileFor(account,id);
        if(req.method==="GET"){if(!fs.existsSync(file))return fail(res,"not_found");return send(res,200,{objectId:id,envelope:JSON.parse(fs.readFileSync(file,"utf8"))});}
        if(req.method==="DELETE"){if(fs.existsSync(file))fs.unlinkSync(file);return send(res,200,{deleted:true});}
        if(req.method==="PUT"){
          const value=await body(req,23*1024*1024);
          if(Object.keys(value).join(",")!=="envelope")return fail(res,"unexpected_field");
          Vault.validate(value.envelope,{accountId:account,objectId:id,kind:"session"});
          const dir=accountDir(account),files=fs.readdirSync(dir).filter(x=>x.endsWith(".json"));
          const used=files.filter(x=>x!==id+".json").reduce((sum,x)=>sum+fs.statSync(path.join(dir,x)).size,0);
          if((!fs.existsSync(file)&&files.length>=c.maxFiles)||used+Buffer.byteLength(JSON.stringify(value.envelope))>c.maxArchiveBytes)return fail(res,"archive_quota_exceeded");
          atomic(file,value.envelope);return send(res,200,{objectId:id,saved:true});
        }
      }
      if(req.url==="/v1/summary"&&req.method==="POST")return await summary(await body(req,64000),account,req,res);
      if(req.url==="/v1/vision"&&req.method==="POST")return await vision(await body(req,2200000),account,res);
      fail(res,"not_found");
    }catch(e){fail(res,e&&e.message==="request_too_large"?"request_too_large":"request_rejected");}
  });
  server.requestTimeout=30000;server.headersTimeout=15000;
  server.on("close",()=>{for(const controller of active)controller.abort();});
  return server;
}
async function boundedResponse(response,max){
  if(!response.body?.getReader){const out=await response.json();if(Buffer.byteLength(JSON.stringify(out))>max)throw new Error("response_too_large");return out;}
  const reader=response.body.getReader(),chunks=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max)throw new Error("response_too_large");chunks.push(value);}return JSON.parse(Buffer.concat(chunks).toString("utf8"));}
  finally{await reader.cancel().catch(()=>{});}
}
if(require.main===module)createServer().listen(Number(process.env.PORT||8788),"127.0.0.1",()=>console.log("Summrizei pilot service ready on loopback."));
module.exports={createServer,config,tokenEqual,schema,RATES,readState};

