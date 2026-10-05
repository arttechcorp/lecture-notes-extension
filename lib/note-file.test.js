const test=require("node:test"),assert=require("node:assert/strict"),nf=require("./note-file"),{memoryAdapter}=require("./package-store");
const HEX="0123456789abcdef".repeat(4),OTHER="fedcba9876543210".repeat(4),uid="user-1";
const payload={meta:{packageId:"pkg-1",title:"자료구조 5주차"},note:{version:2,blocks:[{type:"h",text:"정렬"}]},crops:{fig1:"data:image/png;base64,AAAA"}};
const NOT_FILE={message:"Summrizei 노트 파일이 아닙니다."},FAIL={message:"복호화하지 못했습니다. 이 노트를 만든 계정으로 로그인했는지 확인하세요."};

test("round trip: saveLibraryKey -> loadLibraryKey -> encryptFile -> decryptWithKey with a key rebuilt from the same hex",async()=>{
  const adapter=memoryAdapter(),saved=await nf.saveLibraryKey(adapter,uid,HEX),rec=await nf.loadLibraryKey(adapter);
  assert.equal(rec.uid,uid);assert.equal(rec.at,saved.at);assert.equal(rec.key.type,"secret");assert.equal(rec.key.extractable,false);
  const text=await nf.encryptFile(payload,rec.key);
  assert.ok(!text.includes("정렬"));
  assert.deepEqual(await nf.decryptWithKey(text,await nf.keyFromHex(HEX)),payload); // 웹사이트 쪽: 같은 계정 키로 연다
});
test("a key from another account cannot open the file",async()=>{
  const text=await nf.encryptFile(payload,await nf.keyFromHex(HEX));
  await assert.rejects(nf.decryptWithKey(text,await nf.keyFromHex(OTHER)),FAIL);
});
test("tampered ciphertext rejects",async()=>{
  const key=await nf.keyFromHex(HEX),e=JSON.parse(await nf.encryptFile(payload,key));
  e.ciphertext=(e.ciphertext[0]==="A"?"B":"A")+e.ciphertext.slice(1);
  await assert.rejects(nf.decryptWithKey(JSON.stringify(e),key),FAIL);
});
test("parseFile rejects non-JSON, extra key, wrong format, the old PIN format (v1 kdf/salt) and a bad iv",async()=>{
  const e=JSON.parse(await nf.encryptFile(payload,await nf.keyFromHex(HEX)));
  assert.throws(()=>nf.parseFile("not json"),NOT_FILE);
  assert.throws(()=>nf.parseFile(JSON.stringify({...e,extra:1})),NOT_FILE);
  assert.throws(()=>nf.parseFile(JSON.stringify({...e,format:"other"})),NOT_FILE);
  assert.throws(()=>nf.parseFile(JSON.stringify({...e,version:1,salt:"AAAA",kdf:{name:"PBKDF2",hash:"SHA-256",iterations:600000}})),NOT_FILE);
  assert.throws(()=>nf.parseFile(JSON.stringify({...e,iv:"AAAA"})),NOT_FILE);
});
test("encryptFile rejects non-data-URL and svg crop values",async()=>{
  const key=await nf.keyFromHex(HEX);
  await assert.rejects(nf.encryptFile({...payload,crops:{a:"https://x/y.png"}},key),{message:"노트 파일 내용이 올바르지 않습니다."});
  await assert.rejects(nf.encryptFile({...payload,crops:{a:"data:image/svg+xml;base64,AAAA"}},key),{message:"노트 파일 내용이 올바르지 않습니다."});
});
test("keyFromHex and saveLibraryKey reject anything but 64 lowercase hex and an empty uid",async()=>{
  for(const bad of["","abc",HEX.toUpperCase(),HEX+"0",null])await assert.rejects(nf.keyFromHex(bad),{message:"보관함 키가 올바르지 않습니다."});
  await assert.rejects(nf.saveLibraryKey(memoryAdapter(),"",HEX),{message:"보관함 키가 올바르지 않습니다."});
});
test("ensureLibraryKey reuses the same account's key, refetches for another account, and does not fetch when cached",async()=>{
  const adapter=memoryAdapter();let calls=0;const fetchHex=async()=>{calls++;return calls===1?HEX:OTHER;};
  const a=await nf.ensureLibraryKey(adapter,"u1",fetchHex);assert.equal(a.uid,"u1");assert.equal(calls,1);
  await nf.ensureLibraryKey(adapter,"u1",fetchHex);assert.equal(calls,1);
  const b=await nf.ensureLibraryKey(adapter,"u2",fetchHex);assert.equal(b.uid,"u2");assert.equal(calls,2);assert.equal((await nf.loadLibraryKey(adapter)).uid,"u2");
  const text=await nf.encryptFile(payload,b.key);
  assert.deepEqual(await nf.decryptWithKey(text,await nf.keyFromHex(OTHER)),payload);
});
test("a failed fetch leaves no key behind; an old PIN record (salt, no uid) counts as no key",async()=>{
  const adapter=memoryAdapter();
  await assert.rejects(nf.ensureLibraryKey(adapter,"u1",async()=>{throw new Error("offline");}),{message:"offline"});
  assert.equal(await nf.loadLibraryKey(adapter),null);
  await adapter.put("keys","library",{key:await nf.keyFromHex(HEX),salt:"AAAAAAAAAAAAAAAAAAAAAA",at:1});
  assert.equal(await nf.loadLibraryKey(adapter),null);
});
test("loadLibraryKey is null when empty or after clearLibraryKey",async()=>{
  const adapter=memoryAdapter();
  assert.equal(await nf.loadLibraryKey(adapter),null);
  await nf.saveLibraryKey(adapter,uid,HEX);
  assert.ok(await nf.loadLibraryKey(adapter));
  await nf.clearLibraryKey(adapter);
  assert.equal(await nf.loadLibraryKey(adapter),null);
});
test("fileName is a flat name: sanitizes the title and falls back to 강의",()=>{
  const title="자료".repeat(10)+" / : \n"+"구조".repeat(30);
  const name=nf.fileName({packageId:"pkg-9",title});
  assert.ok(name.endsWith("-pkg-9.summrizei")&&!name.includes("/"));
  const part=name.slice(0,-("-pkg-9.summrizei".length));
  assert.ok(part.length<=60);
  assert.ok(!/[\\/:*?"<>|\n]/.test(part));
  assert.equal(nf.fileName({packageId:"pkg-9",title:null}),"강의-pkg-9.summrizei");
});
test("two encryptions of the same payload differ in iv and ciphertext",async()=>{
  const key=await nf.keyFromHex(HEX);
  const a=JSON.parse(await nf.encryptFile(payload,key)),b=JSON.parse(await nf.encryptFile(payload,key));
  assert.notEqual(a.iv,b.iv);assert.notEqual(a.ciphertext,b.ciphertext);
});
