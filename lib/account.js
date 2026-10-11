// 패널 계정 메뉴: 표시(decodeUser)와 계정 조회(my_account). 로그인·토큰 갱신·로그아웃은 lib/auth.js(Auth, PKCE)가 맡는다.
// 세션 저장 형식이 하나여야 서비스 호출(background의 AUTH_TOKEN)과 이 메뉴가 같은 로그인을 본다(memory.md "계정 메뉴·로그인·결제").
const SITE='https://summrizei.vercel.app';
// Auth.token()은 만료 60초 전부터 갱신한 액세스 토큰을 준다. 로그아웃 상태면 null, 갱신 실패는 그대로 던진다(메뉴가 오류로 보여 준다).
async function getSession(){const token=await Auth.token();return token?{access_token:token}:null;}
function decodeUser(token){
  const b=String(token).split('.')[1].replace(/-/g,'+').replace(/_/g,'/');
  const c=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b.padEnd(Math.ceil(b.length/4)*4,'=')),ch=>ch.charCodeAt(0))));
  const m=c.user_metadata||{};
  return {id:c.sub,email:c.email,name:m.full_name||m.name||c.email,avatar:m.avatar_url||''};
}
// 8초 안에 못 받으면 한 번 더 묻는다. 둘 다 실패하면 null — 호출자는 이를 Free 로 읽지 말고 '확인 못 함'으로 다룬다.
async function lookupAccount(session){
  for(let attempt=0;attempt<2;attempt++){
    try{
      const r=await fetch(`${Auth.SUPABASE_URL}/rest/v1/rpc/my_account`,{method:'POST',signal:AbortSignal.timeout(8000),headers:{apikey:Auth.SUPABASE_ANON_KEY,'content-type':'application/json',authorization:`Bearer ${session.access_token}`},body:'{}'});
      if(r.ok)return await r.json();
      if(r.status<500)return null;
    }catch{}
  }
  return null;
}
// 패널 초기화·계정 메뉴·설정 페이지가 몇 초 안에 같은 계정을 다시 묻는다 — 진행 중인 조회를 공유하고
// 직전 응답을 짧게 재사용한다. 캐시 키는 계정(sub)이고 localStorage 에 둬 페이지를 갈아도(연속 로드) 나눈다 —
// 플랜·분량은 민감 정보가 아니다(기존 summrizei.plan.* 관례와 같다). 실패(null)는 캐시하지 않는다.
const ACCOUNT_TTL_MS=30000;
let accountInflight=null; // {key,promise}
const accountKey=session=>{try{const id=decodeUser(session?.access_token).id;return typeof id==='string'&&id?`summrizei.acct.${id}`:null;}catch{return null;}};
const accountCached=key=>{try{const v=key&&globalThis.localStorage?.getItem(key);if(!v)return null;const o=JSON.parse(v);return Number.isFinite(o?.at)&&Date.now()-o.at<ACCOUNT_TTL_MS?o.acc:null;}catch{return null;}};
async function fetchAccount(session){
  const key=accountKey(session);
  const hit=accountCached(key);if(hit)return hit;
  if(key&&accountInflight?.key===key)return accountInflight.promise;
  const promise=(async()=>{const acc=await lookupAccount(session);if(acc&&key)try{globalThis.localStorage?.setItem(key,JSON.stringify({at:Date.now(),acc}));}catch{}return acc;})();
  if(key){accountInflight={key,promise};const clear=()=>{if(accountInflight?.promise===promise)accountInflight=null;};promise.then(clear,clear);}
  return promise;
}
// 노트 파일 암호화 키(64자리 hex). 로그인한 계정 본인 것만 서버가 준다 — 별도 비밀번호 대신 이 계정이 열쇠다(supabase/schema-v2.sql library_key).
async function fetchLibraryKey(session){
  const r=await fetch(`${Auth.SUPABASE_URL}/rest/v1/rpc/library_key`,{method:'POST',signal:AbortSignal.timeout(8000),headers:{apikey:Auth.SUPABASE_ANON_KEY,'content-type':'application/json',authorization:`Bearer ${session.access_token}`},body:'{}'});
  if(!r.ok)throw new Error('보관함 키를 받지 못했습니다. 인터넷 연결과 로그인을 확인하세요.');
  return r.json();
}
const Account={signIn:()=>Auth.signIn(),getSession,decodeUser,fetchAccount,fetchLibraryKey,signOut:()=>Auth.signOut(),SITE};
if(typeof module!=='undefined')module.exports=Account;
