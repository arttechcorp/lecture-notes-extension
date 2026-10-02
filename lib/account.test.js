const {test}=require('node:test');
const assert=require('node:assert/strict');
const {parseAuthRedirect,decodeUser}=require('./account.js');
const b64u=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
test('parseAuthRedirect reads tokens from the hash',()=>{
  const s=parseAuthRedirect('https://x.chromiumapp.org/#access_token=a.b.c&refresh_token=r&expires_in=100&token_type=bearer');
  assert.equal(s.access_token,'a.b.c');assert.equal(s.refresh_token,'r');
  assert.ok(Math.abs(s.expires_at-(Date.now()/1000+100))<5);
});
test('parseAuthRedirect throws on error hash',()=>assert.throws(()=>parseAuthRedirect('https://x.chromiumapp.org/#error=access_denied&error_description=denied'),/denied/));
test('parseAuthRedirect throws when token is missing',()=>assert.throws(()=>parseAuthRedirect('https://x.chromiumapp.org/#expires_in=10'),/토큰/));
test('decodeUser decodes base64url Korean names',()=>{
  const jwt=`h.${b64u({sub:'u1',email:'a@b.ac.kr',user_metadata:{full_name:'홍길동 ✓',avatar_url:'https://i/a.png'}})}.s`;
  assert.deepEqual(decodeUser(jwt),{id:'u1',email:'a@b.ac.kr',name:'홍길동 ✓',avatar:'https://i/a.png'});
  assert.deepEqual(decodeUser(`h.${b64u({sub:'u2',email:'e@x.com'})}.s`),{id:'u2',email:'e@x.com',name:'e@x.com',avatar:''});
});
