// Groble 결제 웹훅 — 서명(HMAC-SHA256, "<timestamp>.<raw body>")을 확인하고 구독 이벤트를
// apply_billing_event RPC 한 번으로 entitlements에 반영한다(멱등은 (source,external_id) 유니크와 p_event_id로 SQL이 본다).
// 매칭 실패(unknown_plan/unknown_user)는 RPC 대신 billing_events에 reason·이메일 해시만 남겨 무기록 증발을 막는다.
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
const sha256=async s=>hex(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s)));
const eqHex=(a,b)=>{let d=a.length^b.length;for(let i=0;i<Math.min(a.length,b.length);i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0};
const s128=v=>{if(v==null)return null;const s=String(v);return s.length>0&&s.length<=128?s:null}; // 원장 컬럼 상한 128자에 맞춘다
async function hmac(secret,msg){
  const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  return hex(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(msg)));
}

// 결제 금액·쿠폰: 모양이 어긋난 값은 버린다(원장 체크에 걸려 503·재시도가 되지 않게).
const won=v=>Number.isSafeInteger(v)&&v>=0?v:null;
const pricing=o=>{
  const p=o.pricing||{},code=p.coupon?.code;
  return {p_amount:won(p.finalAmount),p_coupon:typeof code==="string"&&code.length>0&&code.length<=64?code:null,p_coupon_discount:won(p.couponDiscountAmount)};
};

// 이벤트 발생 시각. 순서가 뒤바뀐 재전송을 SQL이 가려낸다. 못 읽으면 null(비교하지 않음).
const occurred=ev=>{const t=Date.parse(ev?.occurredAt);return Number.isFinite(t)?new Date(t).toISOString():null};

export async function handle(req,env,fetchImpl=fetch){
  if(req.method!=="POST")return fail(405,"method_not_allowed");
  env=env||{};
  const {url,key,secret,previousSecret}=env;
  let plans=null;
  try{plans=typeof env.plans==="string"?JSON.parse(env.plans):env.plans}catch{/* 잘못된 JSON도 설정 오류 */}
  if(!url||!key||!secret||!plans||typeof plans!=="object")return fail(500,"misconfigured");
  const now=env.now?env.now():Date.now();
  const tsRaw=req.headers.get("x-groble-timestamp")||"",ts=Number(tsRaw);
  if(!Number.isFinite(ts)||Math.abs(now-(ts>=1e12?ts:ts*1000))>300000)return fail(401,"stale_timestamp"); // 1e12 이상은 밀리초로 본다 — 서명 입력은 원문 tsRaw 그대로
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
    const merchant=s128(o.merchantUid);
    // 서명은 맞았지만 매칭이 안 되는 이벤트(unknown_plan/unknown_user)도 원장에 남긴다 — 운영자가 수동 매칭·재적용할 단서다.
    // 평문 이메일은 두지 않고 trim+소문자한 값의 SHA-256만. 같은 이벤트 id는 한 번만 쓰고(ignore-duplicates) 200으로 승인해 재시도를 끊는다.
    const record=async reason=>{
      const pr=pricing(o),email=String(o.buyer?.email||"").trim().toLowerCase();
      const r=await fetchImpl(`${url}/rest/v1/billing_events?on_conflict=id`,{method:"POST",headers:{...json,prefer:"resolution=ignore-duplicates"},
        body:JSON.stringify({id:eventId,type,user_id:null,reason,merchant_uid:merchant,amount_krw:pr.p_amount,coupon_code:pr.p_coupon,coupon_discount_krw:pr.p_coupon_discount,
          buyer_email_hash:email?await sha256(email):null,product_id:s128(o.content?.id),option_id:s128(Array.isArray(o.options)?o.options[0]?.optionId:null),occurred_at:occurred(ev)})});
      return r.ok?ok({ignored:reason}):fail(503,"apply_failed");
    };
    // 플랜 맵(optionId 또는 content.id → {plan,edu}): options[]에서 먼저 맞는 optionId가 content.id보다 우선.
    let plan=null;
    for(const op of Array.isArray(o.options)?o.options:[])if(op&&plans[op.optionId]){plan=plans[op.optionId];break}
    if(!plan&&o.content&&plans[o.content.id])plan=plans[o.content.id];
    if(type==="subscription_payment.completed"&&!plan)return record("unknown_plan"); // 재시도해도 안 풀리므로 기록 후 승인
    let user=UUID.test(o.sellerReference||"")?o.sellerReference:null;
    if(!user&&merchant){
      // 환불·갱신은 sellerReference가 없을 수 있다 — 같은 주문번호(merchantUid는 주문별 고유)로 앞서 기록한 계정을 쓴다.
      const r=await fetchImpl(`${url}/rest/v1/billing_events?select=user_id&merchant_uid=eq.${encodeURIComponent(merchant)}&user_id=not.is.null&limit=1`,{headers:svc});
      const rows=r.ok?await r.json().catch(()=>null):null;
      if(!Array.isArray(rows))return fail(503,"apply_failed");
      if(UUID.test(rows[0]?.user_id||""))user=rows[0].user_id;
    }
    if(!user){
      // sellerReference가 없거나 UUID가 아니면 구매자 이메일로 어드민 목록을 페이지 넘겨 찾는다.
      const email=String(o.buyer?.email||"").trim().toLowerCase();
      if(email)for(let page=1;;page++){
        const r=await fetchImpl(`${url}/auth/v1/admin/users?per_page=1000&page=${page}`,{headers:svc});
        const list=r.ok?(await r.json().catch(()=>null))?.users:null;
        if(!Array.isArray(list))return fail(503,"apply_failed");
        const hit=list.find(u=>UUID.test(u?.id||"")&&String(u.email||"").trim().toLowerCase()===email);
        if(hit){user=hit.id;break}
        if(list.length<1000)break;
      }
      if(!user)return record("unknown_user");
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
      p_event_id:eventId,p_type:type,p_user:user,p_plan:plan?plan.plan:null,p_edu:plan?!!plan.edu:null,p_external_id:ext,p_starts,p_ends,p_merchant:merchant,...pricing(o),p_occurred:occurred(ev)})});
    if(!rpc.ok)return fail(503,"apply_failed"); // Groble이 재시도하게 503
    const result=await rpc.json().catch(()=>null);
    return ok(result==="unknown_user"?{ignored:"unknown_user"}:{result}); // 지워진 계정은 재시도해도 안 풀리니 승인한다
  }catch{
    return fail(503,"apply_failed");
  }
}

if(typeof Deno!=="undefined")Deno.serve(req=>handle(req,{url:Deno.env.get("SUPABASE_URL"),key:Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),secret:Deno.env.get("GROBLE_WEBHOOK_SECRET"),previousSecret:Deno.env.get("GROBLE_WEBHOOK_SECRET_PREVIOUS"),plans:Deno.env.get("GROBLE_PLANS_JSON")}));
