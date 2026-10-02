// Google 로그인(Supabase) + 계정 조회. 세션은 자격 증명이라 설정(lib/settings.js)에 섞지 않고 별도 키 authSession에 둔다.
// SUPABASE_URL / SUPABASE_ANON_KEY 는 landing/supabase-config.js 와 같아야 한다(스토어 패키지에서 landing/ 이 빠지므로 복사).
const SUPABASE_URL='https://rppknkhbiivyurhvljoi.supabase.co';
const SUPABASE_ANON_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJwcGtua2hiaWl2eXVyaHZsam9pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk2NDY1MTQsImV4cCI6MjEwNTIyMjUxNH0.1on99mSxHuwj7VmWJqy6LwBgkUN7gbgSgWwEyJnvZJw';
const SITE='https://summrizei.vercel.app';
const SESSION_KEY='authSession';
const apiHeaders=extra=>({apikey:SUPABASE_ANON_KEY,'content-type':'application/json',...extra});
function parseAuthRedirect(url){
  const u=new URL(url),p=new URLSearchParams(u.hash.replace(/^#/,'')||u.search);
  const err=p.get('error_description')||p.get('error');if(err)throw new Error(err);
  const access_token=p.get('access_token'),refresh_token=p.get('refresh_token');
  if(!access_token||!refresh_token)throw new Error('로그인 응답에 토큰이 없습니다.');
  return {access_token,refresh_token,expires_at:Math.floor(Date.now()/1000)+(Number(p.get('expires_in'))||3600)};
}
async function signIn(){
  const url=await chrome.identity.launchWebAuthFlow({url:`${SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(chrome.identity.getRedirectURL())}`,interactive:true});
  const session=parseAuthRedirect(url);await chrome.storage.local.set({[SESSION_KEY]:session});return session;
}
async function getSession(){
  const s=(await chrome.storage.local.get(SESSION_KEY))[SESSION_KEY];if(!s?.access_token)return null;
  if(s.expires_at-60>Date.now()/1000)return s;
  try{
    const r=await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`,{method:'POST',headers:apiHeaders(),body:JSON.stringify({refresh_token:s.refresh_token})});
    if(!r.ok)throw new Error();const j=await r.json();
    const next={access_token:j.access_token,refresh_token:j.refresh_token||s.refresh_token,expires_at:Math.floor(Date.now()/1000)+(Number(j.expires_in)||3600)};
    await chrome.storage.local.set({[SESSION_KEY]:next});return next;
  }catch{await chrome.storage.local.remove(SESSION_KEY);return null;}
}
function decodeUser(token){
  const b=String(token).split('.')[1].replace(/-/g,'+').replace(/_/g,'/');
  const c=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b.padEnd(Math.ceil(b.length/4)*4,'=')),ch=>ch.charCodeAt(0))));
  const m=c.user_metadata||{};
  return {id:c.sub,email:c.email,name:m.full_name||m.name||c.email,avatar:m.avatar_url||''};
}
async function fetchAccount(session){
  try{
    const r=await fetch(`${SUPABASE_URL}/rest/v1/rpc/my_account`,{method:'POST',headers:apiHeaders({authorization:`Bearer ${session.access_token}`}),body:'{}'});
    return r.ok?await r.json():null;
  }catch{return null;}
}
async function signOut(){
  const s=(await chrome.storage.local.get(SESSION_KEY))[SESSION_KEY];
  if(s?.access_token)await fetch(`${SUPABASE_URL}/auth/v1/logout`,{method:'POST',headers:apiHeaders({authorization:`Bearer ${s.access_token}`})}).catch(()=>{});
  await chrome.storage.local.remove(SESSION_KEY);
}
const Account={signIn,getSession,decodeUser,fetchAccount,signOut,SITE};
if(typeof module!=='undefined')module.exports={...Account,parseAuthRedirect,SUPABASE_URL};
