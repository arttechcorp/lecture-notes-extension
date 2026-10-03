// Groble 결제 웹훅 — 서명(HMAC-SHA256, "<timestamp>.<raw body>")을 확인하고 구독 이벤트를
// apply_billing_event RPC 한 번으로 entitlements에 반영한다(멱등은 (source,external_id) 유니크와 p_event_id로 SQL이 본다).
// 체크아웃 링크의 ?ref=<supabase user id>가 sellerReference로 돌아온다. Groble은 408/429/5xx에 재시도하고
// 400번대는 최종 실패, 410은 엔드포인트 비활성화라 절대 쓰지 않는다. 서버간 호출이라 CORS는 없다.
const HEADERS={"content-type":"application/json","cache-control":"no-store"};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXTID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/; // entitlements.external_id 체크와 같은 규칙 — 이벤트 id 겸용
const TYPES=new Set(["subscription_payment.completed","subscription_payment.refunded","subscription_payment.failed","subscription.cancel_requested","subscription.terminated"]);
const DAY=86400000,GRACE=3*DAY;
const ok=body=>new Response(JSON.stringify(body),{status:200,headers:HEADERS});
const fail=(status,error)=>new Response(JSON.stringify({error}),{status,headers:HEADERS});
const hex=b=>[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("");
const eqHex=(a,b)=>{let d=a.length^b.length;for(let i=0;i<Math.min(a.length,b.length);i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0};
async function hmac(secret,msg){
  const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  return hex(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(msg)));
}

export async function handle(req,env,fetchImpl=fetch){
  if(req.method!=="POST")return fail(405,"method_not_allowed");
  env=env||{};
  const {url,key,secret,previousSecret}=env;
  let plans=null;
  try{plans=typeof env.plans==="string"?JSON.parse(env.plans):env.plans}catch{/* 잘못된 JSON도 설정 오류 */}
  if(!url||!key||!secret||!plans||typeof plans!=="object")return fail(500,"misconfigured");
  const now=env.now?env.now():Date.now();
  const tsRaw=req.headers.get("x-groble-timestamp")||"",ts=Number(tsRaw);
  if(!Number.isFinite(ts)||Math.abs(now-ts*1000)>300000)return fail(401,"stale_timestamp");
  const raw=await req.text(); // 원문 그대로가 서명 입력이라 파싱 전에 한 번만 읽는다
  if(new TextEncoder().encode(raw).length>65536)return fail(400,"too_large");
  // 두 헤더(Signature, Signature-Previous)를 현재·이전 시크릿 양쪽으로 받는다 — 시크릿 로테이션 24h 동안 둘 다 유효.
  const cur=await hmac(secret,tsRaw+"."+raw),prev=previousSecret?await hmac(previousSecret,tsRaw+"."+raw):null;
  const sigs=["x-groble-signature","x-groble-signature-previous"].map(h=>(req.headers.get(h)||"").toLowerCase()).filter(Boolean);
  if(!sigs.some(s=>eqHex(s,cur)||prev&&eqHex(s,prev)))return fail(401,"bad_signature");
  let ev;
  try{ev=JSON.parse(raw)}catch{return fail(400,"bad_payload")}
  const hdrId=req.headers.get("x-groble-idempotency-key")||"",envId=typeof ev?.id==="string"?ev.id:"";
  const eventId=EXTID.test(hdrId)?hdrId:EXTID.test(envId)?envId:null;
  if(!eventId)return fail(400,"bad_payload");
  const type=ev?.type;
  // 비구독 이벤트와 결제 실패는 기록할 게 없다 — RPC도 부르지 않고 바로 승인(재시도 폭풍 방지).
  if(!TYPES.has(type)||type==="subscription_payment.failed")return ok({ignored:true});
  try{
    const o=ev?.data?.object||{},svc={apikey:key,authorization:"Bearer "+key},json={...svc,"content-type":"application/json"};
    // 플랜 맵(optionId 또는 content.id → {plan,edu}): options[]에서 먼저 맞는 optionId가 content.id보다 우선.
    let plan=null;
    for(const op of Array.isArray(o.options)?o.options:[])if(op&&plans[op.optionId]){plan=plans[op.optionId];break}
    if(!plan&&o.content&&plans[o.content.id])plan=plans[o.content.id];
    if(type==="subscription_payment.completed"&&!plan)return ok({ignored:"unknown_plan"}); // 재시도해도 안 풀리므로 승인하고 끝
    let user=UUID.test(o.sellerReference||"")?o.sellerReference:null;
    const merchant=typeof o.merchantUid==="string"&&o.merchantUid.length>0&&o.merchantUid.length<=128?o.merchantUid:null;
    if(!user&&merchant){
      // 환불에는 sellerReference가 없다 — 같은 결제번호로 앞서 기록한 계정을 쓴다.
      const r=await fetchImpl(`${url}/rest/v1/billing_events?select=user_id&merchant_uid=eq.${encodeURIComponent(merchant)}&user_id=not.is.null&limit=1`,{headers:svc});
      const rows=r.ok?await r.json().catch(()=>null):null;
      if(!Array.isArray(rows))return fail(503,"apply_failed");
      if(UUID.test(rows[0]?.user_id||""))user=rows[0].user_id;
    }
    if(!user){
      // sellerReference가 없거나 UUID가 아니면 구매자 이메일로 어드민 목록을 페이지 넘겨 찾는다.
      const email=String(o.buyer?.email||"").toLowerCase();
      if(email)for(let page=1;;page++){
        const r=await fetchImpl(`${url}/auth/v1/admin/users?per_page=1000&page=${page}`,{headers:svc});
        const list=r.ok?(await r.json().catch(()=>null))?.users:null;
        if(!Array.isArray(list))return fail(503,"apply_failed");
        const hit=list.find(u=>UUID.test(u?.id||"")&&String(u.email||"").toLowerCase()===email);
        if(hit){user=hit.id;break}
        if(list.length<1000)break;
      }
      if(!user)return ok({ignored:"unknown_user"});
    }
    let ext=(String(o.content?.id)+":"+user).replace(/[^A-Za-z0-9_.:-]/g,"_").slice(0,128);
    if(!EXTID.test(ext))ext=("x"+ext).slice(0,128); // 첫 글자는 영숫자여야 한다
    const sub=o.subscription||{};
    let p_starts=null,p_ends=null;
    if(type==="subscription_payment.completed"){
      p_starts=sub.activatedAt||null;
      // 청구일 말일(KST) + 유예 3일. Groble은 날짜만 보내지만 전체 시각이 와도 앞 10자만 쓴다 — 그래도 YYYY-MM-DD 가 아니면 추정으로 넘긴다.
      const day=String(sub.nextBillingDate||"").slice(0,10),nb=/^\d{4}-\d{2}-\d{2}$/.test(day)?new Date(day+"T23:59:59+09:00"):null;
      p_ends=nb&&!isNaN(nb)?new Date(nb.getTime()+GRACE).toISOString():new Date(now+(sub.billingCycleMonths||1)*31*DAY+GRACE).toISOString();
    }else if(type==="subscription.cancel_requested")p_ends=o.serviceEndsAt||null;
    else if(type==="subscription.terminated")p_ends=o.termination?.terminatedAt||new Date(now).toISOString();
    else if(type==="subscription_payment.refunded")p_ends=new Date(now).toISOString();
    const rpc=await fetchImpl(url+"/rest/v1/rpc/apply_billing_event",{method:"POST",headers:json,body:JSON.stringify({
      p_event_id:eventId,p_type:type,p_user:user,p_plan:plan?plan.plan:null,p_edu:plan?!!plan.edu:null,p_external_id:ext,p_starts,p_ends,p_merchant:merchant})});
    if(!rpc.ok)return fail(503,"apply_failed"); // Groble이 재시도하게 503
    const result=await rpc.json().catch(()=>null);
    return ok(result==="unknown_user"?{ignored:"unknown_user"}:{result}); // 지워진 계정은 재시도해도 안 풀리니 승인한다
  }catch{
    return fail(503,"apply_failed");
  }
}

if(typeof Deno!=="undefined")Deno.serve(req=>handle(req,{url:Deno.env.get("SUPABASE_URL"),key:Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),secret:Deno.env.get("GROBLE_WEBHOOK_SECRET"),previousSecret:Deno.env.get("GROBLE_WEBHOOK_SECRET_PREVIOUS"),plans:Deno.env.get("GROBLE_PLANS_JSON")}));
