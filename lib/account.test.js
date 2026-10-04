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
test('fetchAccount retries a failed lookup once and gives up on a 4xx',async()=>{
  globalThis.Auth={SUPABASE_URL:'https://x',SUPABASE_ANON_KEY:'k'};const real=globalThis.fetch;let n=0;
  try{
    globalThis.fetch=async()=>{n++;if(n===1)throw new TypeError('fetch failed');return {ok:true,status:200,json:async()=>({plan:'professional'})};};
    assert.equal((await Account.fetchAccount({access_token:'t'})).plan,'professional');assert.equal(n,2);
    n=0;globalThis.fetch=async()=>{n++;return {ok:false,status:401};};
    assert.equal(await Account.fetchAccount({access_token:'t'}),null);assert.equal(n,1);
  }finally{globalThis.fetch=real;delete globalThis.Auth;}
});
