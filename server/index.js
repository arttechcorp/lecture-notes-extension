// ponytail: single-process pilot with atomic files; move reservations to DB transactions before multi-instance scaling.
// Operator key server-only; archive contents are authenticated ciphertext.
const fs=require("node:fs"),path=require("node:path"),http=require("node:http"),crypto=require("node:crypto");
const Vault=require("../lib/vault.js"),{validateSummary}=require("../lib/summary.js");
const RATES={"google/gemini-2.5-flash-lite":[.1,.4],"google/gemini-3.8-flash":[1.5,7.5],"google/gemini-2.5-pro":[1.25,10],"anthropic/claude-haiku-4.5":[1,5],"anthropic/claude-sonnet-4.6":[3,15],"anthropic/claude-sonnet-5":[2,10]};
// 이미지 입력은 텍스트와 단가가 다르고 출력도 훨씬 짧다. /v1/summary 와 예약 계산을 섞지 않는다.
const VISION_RATES={"google/gemini-2.5-flash-lite":[.1,.4],"google/gemini-3.8-flash":[1.5,7.5]};
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
    if(limit.features!==undefined&&(!Array.isArray(limit.features)||limit.features.some(f=>f!=="vision")))throw new Error("invalid_account_features");
    positive(limit.maxRequests);positive(limit.maxCostCents);
  }
  return {tokens,allow,providers,key:env.OPENROUTER_API_KEY,origin:env.EXTENSION_ORIGIN,root:path.resolve(env.VAULT_DIR||"server-data"),stateFile:env.USAGE_STATE_FILE?path.resolve(env.USAGE_STATE_FILE):null,
    accountLimits,visionModels,maxCents:positive(env.MAX_COST_CENTS,1500),maxRequests:positive(env.MAX_REQUESTS,500),globalCents:positive(env.GLOBAL_COST_CENTS,15000),timeout:Math.min(positive(env.OPENROUTER_TIMEOUT_MS,120000),120000),maxFiles:100,maxArchiveBytes:200*1024*1024};
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
  const usageFile=c.stateFile||path.join(c.root,"usage.json"),state=readState(usageFile),fetcher=deps.fetch||fetch,locks=new Set(),active=new Map();
  const month=()=>new Date().toISOString().slice(0,7);
  const record=account=>{
    let r=Object.hasOwn(state.accounts,account)?state.accounts[account]:null;
    if(!r||r.month!==month())r=state.accounts[account]={month:month(),requests:0,spentCents:0,jobs:{}};
    return r;
  };
  const save=()=>atomic(usageFile,state);
  const limitFor=account=>Object.hasOwn(c.accountLimits,account)?{features:[],...c.accountLimits[account]}:{models:c.allow,maxRequests:c.maxRequests,maxCostCents:c.maxCents,features:[]};
  const fail=(res,status,code)=>send(res,status,{error:code});
  function send(res,status,data){
    if(res.destroyed||res.writableEnded)return;
    res.writeHead(status,{"content-type":"application/json","cache-control":"no-store","x-content-type-options":"nosniff","access-control-allow-origin":c.origin,"vary":"Origin","access-control-allow-headers":"authorization,content-type","access-control-allow-methods":"GET,PUT,POST,DELETE,OPTIONS"});
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
  // /v1/summary 와 /v1/vision 이 같은 돈을 쓴다. 예약·멱등·락·정산을 한 군데 두지 않으면
  // 두 라우트의 한도 계산이 조용히 어긋난다 — 어긋난 쪽이 무료로 돌아가는 실패 모드다.
  async function withReservation({account,requestId,digest,reserve,res},run){
    const limits=limitFor(account),rec=record(account);
    const prior=Object.hasOwn(rec.jobs,requestId)?rec.jobs[requestId]:null;
    if(prior)return fail(res,prior.digest===digest?409:400,prior.digest===digest?"request_already_reserved_or_processed":"idempotency_content_mismatch");
    if(locks.has(account))return fail(res,429,"account_request_in_progress");
    const globalSpent=Object.values(state.accounts).filter(r=>r.month===month()).reduce((sum,r)=>sum+r.spentCents,0);
    if(rec.requests>=limits.maxRequests||rec.spentCents+reserve>limits.maxCostCents||globalSpent+reserve>c.globalCents)return fail(res,429,"quota_exceeded");
    locks.add(account);rec.requests++;rec.spentCents+=reserve;rec.jobs[requestId]={digest,status:"reserved",reservedCents:reserve};
    try{save();}catch{locks.delete(account);throw new Error("usage_store_failed");}
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),c.timeout);
    const disconnect=()=>{if(!res.writableEnded)controller.abort();};res.on("close",disconnect);active.set(account,controller);
    try{
      const {amount,reported,payload}=await run(controller.signal);
      // Unknown or failed requests keep the full reservation; never assume an unreported request was free.
      if(reported)rec.spentCents=Math.max(0,rec.spentCents-reserve+Math.ceil(amount*1e6)/1e4);
      rec.jobs[requestId].status="completed";save();
      send(res,200,payload);
    }catch{
      rec.jobs[requestId].status="uncertain";save();
      fail(res,controller.signal.aborted?504:502,controller.signal.aborted?"request_cancelled_or_timed_out":"provider_failed_or_invalid_output");
    }finally{clearTimeout(timer);res.removeListener("close",disconnect);locks.delete(account);active.delete(account);}
  }
  async function summary(input,account,req,res){
    const limits=limitFor(account);
    if(!c.allow.includes(input.model)||!["chunk","synthesis"].includes(input.stage))return fail(res,400,"invalid_model_or_stage");
    if(!limits.models.includes(input.model))return fail(res,403,"model_not_in_account_plan");
    safePart(input.requestId);
    if(Object.keys(input).some(k=>!["model","stage","requestId","evidence","gaps"].includes(k)))return fail(res,400,"unexpected_field");
    const items=input.evidence;
    if(!Array.isArray(items)||!items.length||items.length>2000||items.some(e=>!e||typeof e.id!=="string"||!e.id||e.id.length>128||typeof e.text!=="string"||!e.text.trim()||!["ocr","asr"].includes(e.source)||!Number.isFinite(e.t0)||!Number.isFinite(e.t1)||!["included","uncertain"].includes(e.selection)||(e.selectionReason!==undefined&&(typeof e.selectionReason!=="string"||e.selectionReason.length>300))||Object.keys(e).some(k=>!["id","text","source","t0","t1","selection","selectionReason"].includes(k))))return fail(res,400,"invalid_evidence");
    // 캡처가 끊긴 구간. 강의 내용이 아니라 메타데이터라서 근거와 따로 싣고 따로 검사한다.
    const gaps=input.gaps===undefined?[]:input.gaps;
    if(!Array.isArray(gaps)||gaps.length>200||gaps.some(g=>!g||typeof g.reason!=="string"||!g.reason||g.reason.length>64||!Number.isFinite(g.t0)||!Number.isFinite(g.t1)||g.t1<g.t0||Object.keys(g).some(k=>!["reason","t0","t1"].includes(k))))return fail(res,400,"invalid_gaps");
    const text=JSON.stringify(items);
    if(Buffer.byteLength(text)>48000)return fail(res,413,"evidence_too_large");
    const digest=crypto.createHash("sha256").update(JSON.stringify({model:input.model,stage:input.stage,evidence:items,gaps})).digest("hex");
    const [pi,po]=RATES[input.model],maxOutput=maxTokensFor(input.model),attempts=2;
    // Reserve both attempts: a malformed structured response is retried once on the same fixed provider.
    const reserve=Math.ceil(((Buffer.byteLength(text)+Buffer.byteLength(systemFor(input.stage))+8192)*pi+maxOutput*po)/1e6*100*1.2*attempts);
    return await withReservation({account,requestId:input.requestId,digest,reserve,res},async signal=>{
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
    if(!(limitFor(account).features||[]).includes("vision"))return fail(res,403,"feature_not_in_account_plan");
    if(!c.visionModels.includes(input.model))return fail(res,400,"invalid_model");
    safePart(input.requestId);
    if(Object.keys(input).some(k=>!["model","requestId","image"].includes(k)))return fail(res,400,"unexpected_field");
    const match=/^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(String(input.image||""));
    if(!match)return fail(res,400,"invalid_image");
    const bytes=Buffer.from(match[1],"base64").byteLength;
    if(!bytes||bytes>1536*1024)return fail(res,413,"image_too_large");
    // digest 는 프레임 내용이 아니라 그 해시로 잡는다. 사용량 파일에 이미지가 남으면 안 된다.
    const digest=crypto.createHash("sha256").update(JSON.stringify({model:input.model,image:crypto.createHash("sha256").update(match[1]).digest("hex")})).digest("hex");
    const [pi,po]=VISION_RATES[input.model];
    // 이미지 토큰 수는 사전에 알 수 없다. 해상도 상한에서 나오는 최악값을 잡고 정산에서 되돌린다.
    const reserve=Math.ceil((8000*pi+VISION_MAX_TOKENS*po)/1e6*100*1.2);
    return await withReservation({account,requestId:input.requestId,digest,reserve,res},async signal=>{
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
      if(req.headers.origin&&req.headers.origin!==c.origin)return fail(res,403,"origin_not_allowed");
      if(req.method==="OPTIONS")return send(res,204,{});
      const account=accountFor(req);if(!account)return fail(res,401,"unauthorized");
      if(req.url==="/v1/me"&&req.method==="GET"){const r=record(account),limits=limitFor(account);return send(res,200,{accountId:account,models:limits.models,features:limits.features,quota:{month:r.month,requests:r.requests,maxRequests:limits.maxRequests,spentCents:r.spentCents,maxCents:limits.maxCostCents}});}
      if(req.url==="/v1/vault"&&req.method==="GET")return send(res,200,{items:fs.readdirSync(accountDir(account)).filter(x=>/^[A-Za-z0-9][A-Za-z0-9_-]*\.json$/.test(x)).map(x=>({objectId:x.slice(0,-5)}))});
      const match=req.url?.match(/^\/v1\/vault\/([A-Za-z0-9][A-Za-z0-9_-]{0,127})$/);
      if(match){
        const id=match[1],file=fileFor(account,id);
        if(req.method==="GET"){if(!fs.existsSync(file))return fail(res,404,"not_found");return send(res,200,{objectId:id,envelope:JSON.parse(fs.readFileSync(file,"utf8"))});}
        if(req.method==="DELETE"){if(fs.existsSync(file))fs.unlinkSync(file);return send(res,200,{deleted:true});}
        if(req.method==="PUT"){
          const value=await body(req,23*1024*1024);
          if(Object.keys(value).join(",")!=="envelope")return fail(res,400,"unexpected_field");
          Vault.validate(value.envelope,{accountId:account,objectId:id,kind:"session"});
          const dir=accountDir(account),files=fs.readdirSync(dir).filter(x=>x.endsWith(".json"));
          const used=files.filter(x=>x!==id+".json").reduce((sum,x)=>sum+fs.statSync(path.join(dir,x)).size,0);
          if((!fs.existsSync(file)&&files.length>=c.maxFiles)||used+Buffer.byteLength(JSON.stringify(value.envelope))>c.maxArchiveBytes)return fail(res,413,"archive_quota_exceeded");
          atomic(file,value.envelope);return send(res,200,{objectId:id,saved:true});
        }
      }
      if(req.url==="/v1/summary"&&req.method==="POST")return await summary(await body(req,64000),account,req,res);
      if(req.url==="/v1/vision"&&req.method==="POST")return await vision(await body(req,2200000),account,res);
      fail(res,404,"not_found");
    }catch(e){fail(res,e&&e.message==="request_too_large"?413:400,"request_rejected");}
  });
  server.requestTimeout=30000;server.headersTimeout=15000;
  server.on("close",()=>{for(const controller of active.values())controller.abort();});
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

