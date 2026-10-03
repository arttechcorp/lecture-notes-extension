// Supabase Auth 액세스 토큰(JWT) 검증 — Node crypto 만 쓴다. 서명 알고리즘은 설정이 정한다:
// SUPABASE_JWT_SECRET 이 있으면 HS256 만, 없으면 JWKS 의 ES256/RS256 만 받는다. 토큰 헤더의 alg 는 이 목록에 있는지 확인할 뿐 키를 고르는 데 쓰지 않는다
// (alg:none 과 HS/RS 혼동 공격은 여기서 막힌다).
const crypto=require("node:crypto");
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,SEGMENT=/^[A-Za-z0-9_-]+$/;
const plain=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const no=code=>Object.assign(new Error(code),{code});
// getJson(url) 은 한도 있는 GET 이다. now 는 테스트가 시계를 돌릴 수 있게 주입한다.
function createAuth({url,secret,getJson,now=Date.now,ttlMs=600000,cooldownMs=10000,leewaySec=5}){
  const iss=url+"/auth/v1",jwksUrl=iss+"/.well-known/jwks.json",algs=secret?["HS256"]:["ES256","RS256"];
  let keys=new Map(),at=0,last=0,pending=null;
  // JWK → 검증 키. kty/crv 에서 알고리즘을 정하므로 ES256 토큰이 RSA 키로 검증되는 일이 없다.
  function importKey(jwk){
    if(!plain(jwk)||typeof jwk.kid!=="string"||(jwk.use!==undefined&&jwk.use!=="sig"))return null;
    const alg=jwk.kty==="EC"&&jwk.crv==="P-256"?"ES256":jwk.kty==="RSA"?"RS256":null;
    if(!alg||(jwk.alg!==undefined&&jwk.alg!==alg))return null;
    const key=crypto.createPublicKey({key:jwk,format:"jwk"});
    return alg==="RS256"&&key.asymmetricKeyDetails.modulusLength<2048?null:{alg,key};
  }
  // 동시에 온 새로고침은 한 번으로 합친다. 실패하면 기존(만료됐을 수 있는) 키는 그대로 둔다.
  function refresh(){
    last=now();
    return pending||=(async()=>{
      try{
        const body=await getJson(jwksUrl),next=new Map();
        for(const jwk of Array.isArray(body?.keys)?body.keys.slice(0,32):[])try{const k=importKey(jwk);if(k)next.set(jwk.kid,k);}catch{}
        if(!next.size)throw no("auth_unavailable");
        keys=next;at=now();
      }finally{pending=null;}
    })();
  }
  // 모르는 kid 가 올 때마다 JWKS 를 부르면 가짜 토큰으로 Supabase 를 두드릴 수 있다 — 새로고침은 cooldown 마다 한 번이다.
  async function keyFor(kid){
    const fresh=keys.has(kid)&&now()-at<ttlMs;
    if(fresh)return keys.get(kid);
    if(pending||now()-last>=cooldownMs)try{await refresh();}catch{}
    if(!keys.size)throw no("auth_unavailable");
    return keys.get(kid)||null;
  }
  async function check(token){
    const seg=token.split(".");
    if(token.length>4096||seg.length!==3||!seg.every(s=>SEGMENT.test(s)))throw no("unauthorized");
    const h=JSON.parse(Buffer.from(seg[0],"base64url")),p=JSON.parse(Buffer.from(seg[1],"base64url")),sig=Buffer.from(seg[2],"base64url"),data=Buffer.from(seg[0]+"."+seg[1]);
    if(!plain(h)||!plain(p)||!algs.includes(h.alg)||h.crit!==undefined)throw no("unauthorized");
    if(h.alg==="HS256"){
      const mac=crypto.createHmac("sha256",secret).update(data).digest();
      if(sig.length!==mac.length||!crypto.timingSafeEqual(sig,mac))throw no("unauthorized");
    }else{
      if(typeof h.kid!=="string"||h.kid.length>128)throw no("unauthorized");
      const k=await keyFor(h.kid);
      if(!k||k.alg!==h.alg||!(h.alg==="ES256"?crypto.verify("sha256",data,{key:k.key,dsaEncoding:"ieee-p1363"},sig):crypto.verify("sha256",data,k.key,sig)))throw no("unauthorized");
    }
    // 서명이 맞은 토큰만 만료를 알려 준다 — 위조 토큰에는 어떤 단서도 주지 않는다.
    const s=Math.floor(now()/1000);
    if(typeof p.exp!=="number"||!Number.isFinite(p.exp))throw no("unauthorized");
    if(s>=p.exp+leewaySec)throw no("token_expired");
    if(p.nbf!==undefined&&!(typeof p.nbf==="number"&&p.nbf<=s+leewaySec))throw no("unauthorized");
    // anon·service_role 키도 서명이 맞는 JWT 다 — role 과 sub 가 사용자 토큰만 통과시킨다. 익명 로그인은 무료 한도를 무한히 만들 수 있어 거절한다.
    if(!(p.aud==="authenticated"||Array.isArray(p.aud)&&p.aud.includes("authenticated"))||p.iss!==iss||p.role!=="authenticated"||p.is_anonymous===true||typeof p.sub!=="string"||!UUID.test(p.sub))throw no("unauthorized");
    return p.sub.toLowerCase();
  }
  // → {sub} | {code}. 알 수 없는 예외(손상된 JSON 등)는 모두 unauthorized 다.
  async function verify(token){
    try{return {sub:await check(token)};}
    catch(e){return {code:e&&(e.code==="token_expired"||e.code==="auth_unavailable")?e.code:"unauthorized"};}
  }
  return {verify};
}
module.exports={createAuth};
