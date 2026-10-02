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
async function fetchAccount(session){
  try{
    const r=await fetch(`${Auth.SUPABASE_URL}/rest/v1/rpc/my_account`,{method:'POST',headers:{apikey:Auth.SUPABASE_ANON_KEY,'content-type':'application/json',authorization:`Bearer ${session.access_token}`},body:'{}'});
    return r.ok?await r.json():null;
  }catch{return null;}
}
const Account={signIn:()=>Auth.signIn(),getSession,decodeUser,fetchAccount,signOut:()=>Auth.signOut(),SITE};
if(typeof module!=='undefined')module.exports=Account;
