const {test}=require('node:test');
const assert=require('node:assert/strict');
const Account=require('./account.js');
const b64u=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
test('decodeUser decodes base64url Korean names',()=>{
  const jwt=`h.${b64u({sub:'u1',email:'a@b.ac.kr',user_metadata:{full_name:'홍길동 ✓',avatar_url:'https://i/a.png'}})}.s`;
  assert.deepEqual(Account.decodeUser(jwt),{id:'u1',email:'a@b.ac.kr',name:'홍길동 ✓',avatar:'https://i/a.png'});
  assert.deepEqual(Account.decodeUser(`h.${b64u({sub:'u2',email:'e@x.com'})}.s`),{id:'u2',email:'e@x.com',name:'e@x.com',avatar:''});
});
// 로그인은 lib/auth.js 하나만 한다. 메뉴는 Auth의 토큰을 그대로 쓰고 세션을 따로 저장하지 않는다.
test('the menu session, sign-in and sign-out all go through Auth',async()=>{
  const calls=[];
  globalThis.Auth={token:async()=>'t1',signIn:async()=>calls.push('in'),signOut:async()=>calls.push('out')};
  try{
    assert.deepEqual(await Account.getSession(),{access_token:'t1'});
    globalThis.Auth.token=async()=>null;
    assert.equal(await Account.getSession(),null);
    await Account.signIn();await Account.signOut();
    assert.deepEqual(calls,['in','out']);
  }finally{delete globalThis.Auth;}
});
// 패널 초기화·계정 메뉴가 몇 초 안에 같은 조회를 다시 보낸다 — 동시 호출은 진행 중인 약속을 나누고,
// 직전에 확인한 계정은 짧게 재사용한다. 페이지를 갈아도 localStorage 에 남아 연속 로드의 중복을 막는다.
test('fetchAccount shares an in-flight lookup and briefly reuses a fresh result',async()=>{
  globalThis.Auth={SUPABASE_URL:'https://x',SUPABASE_ANON_KEY:'k'};const real=globalThis.fetch,realLs=globalThis.localStorage;
  const box={};globalThis.localStorage={getItem:k=>box[k]??null,setItem:(k,v)=>{box[k]=String(v);},removeItem:k=>{delete box[k];}};
  let n=0;globalThis.fetch=async()=>{n++;return {ok:true,status:200,json:async()=>({plan:'professional'})};};
  const session=()=>({access_token:`h.${b64u({sub:'u-cache'})}.s`});
  try{
    const [a,b]=await Promise.all([Account.fetchAccount(session()),Account.fetchAccount(session())]);
    assert.equal(a.plan,'professional');assert.equal(b.plan,'professional');
    assert.equal(n,1,'동시 조회는 네트워크 한 번으로 합친다');
    assert.equal((await Account.fetchAccount(session())).plan,'professional');
    assert.equal(n,1,'직전 응답은 재사용한다');
    const other=await Account.fetchAccount({access_token:`h.${b64u({sub:'u-other'})}.s`});
    assert.equal(n,2,'다른 계정은 캐시를 쓰지 않는다');assert.equal(other.plan,'professional');
    const realNow=Date.now;try{Date.now=()=>realNow()+60000;}finally{}
    globalThis.fetch=async()=>{n++;return {ok:false,status:500};};
    try{Date.now=()=>realNow()+60000;assert.equal(await Account.fetchAccount(session()),null,'유효 시간이 지나면 다시 묻는다');}
    finally{Date.now=realNow;}
  }finally{globalThis.fetch=real;delete globalThis.Auth;globalThis.localStorage=realLs;}
});
test('fetchAccount retries a failed lookup once and gives up on a 4xx',async()=>{
  globalThis.Auth={SUPABASE_URL:'https://x',SUPABASE_ANON_KEY:'k'};const real=globalThis.fetch;let n=0;
  try{
    globalThis.fetch=async()=>{n++;if(n===1)throw new TypeError('fetch failed');return {ok:true,status:200,json:async()=>({plan:'professional'})};};
    assert.equal((await Account.fetchAccount({access_token:'t'})).plan,'professional');assert.equal(n,2);
    n=0;globalThis.fetch=async()=>{n++;return {ok:false,status:401};};
    assert.equal(await Account.fetchAccount({access_token:'t'}),null);assert.equal(n,1);
  }finally{globalThis.fetch=real;delete globalThis.Auth;}
});
test('fetchLibraryKey returns the key string and throws on a failed call',async()=>{
  globalThis.Auth={SUPABASE_URL:'https://x',SUPABASE_ANON_KEY:'k'};const real=globalThis.fetch;let url,auth;
  try{
    globalThis.fetch=async(u,o)=>{url=u;auth=o.headers.authorization;return {ok:true,json:async()=>'ab'.repeat(32)};};
    assert.equal(await Account.fetchLibraryKey({access_token:'t'}),'ab'.repeat(32));assert.equal(url,'https://x/rest/v1/rpc/library_key');assert.equal(auth,'Bearer t');
    globalThis.fetch=async()=>({ok:false,status:401});
    await assert.rejects(Account.fetchLibraryKey({access_token:'t'}));
  }finally{globalThis.fetch=real;delete globalThis.Auth;}
});
