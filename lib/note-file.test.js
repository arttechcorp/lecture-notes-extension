const test=require("node:test"),assert=require("node:assert/strict"),nf=require("./note-file"),{memoryAdapter}=require("./package-store");
const pass="synthetic-library-pass",wrong="totally-wrong-pass",pin="0427";
const payload={meta:{packageId:"pkg-1",title:"자료구조 5주차"},note:{version:2,blocks:[{type:"h",text:"정렬"}]},crops:{fig1:"data:image/png;base64,AAAA"}};
// PBKDF2 600000회가 느리므로 키·파일 하나를 만들어 여러 테스트가 나눠 쓴다.
const setup=(async()=>{const salt=nf.newSalt(),key=await nf.deriveKey(pass,salt),text=await nf.encryptFile(payload,key,salt);return{salt,key,text};})();

test("round trip: saveLibraryKey -> loadLibraryKey -> encryptFile -> decryptFile/decryptWithKey",async()=>{
  const adapter=memoryAdapter(),saved=await nf.saveLibraryKey(adapter,pin),rec=await nf.loadLibraryKey(adapter);
  assert.equal(rec.salt,saved.salt);assert.equal(rec.at,saved.at);assert.equal(rec.key.type,"secret");assert.equal(rec.key.extractable,false);
  const text=await nf.encryptFile(payload,rec.key,rec.salt);
  assert.ok(!text.includes("정렬"));
  assert.deepEqual(await nf.decryptFile(text,pin),payload);
  assert.deepEqual(await nf.decryptWithKey(text,rec.key),payload);
});
test("wrong passphrase rejects with the Korean decrypt message",async()=>{
  const{text}=await setup;
  await assert.rejects(nf.decryptFile(text,wrong),{message:"복호화하지 못했습니다. 보관함 PIN을 확인하세요."});
});
test("tampered ciphertext rejects",async()=>{
  const{key,text}=await setup,e=JSON.parse(text);
  e.ciphertext=(e.ciphertext[0]==="A"?"B":"A")+e.ciphertext.slice(1);
  await assert.rejects(nf.decryptWithKey(JSON.stringify(e),key));
  await assert.rejects(nf.decryptFile(JSON.stringify(e),pass),{message:"복호화하지 못했습니다. 보관함 PIN을 확인하세요."});
});
test("parseFile rejects non-JSON, extra key, wrong format, wrong iterations, short salt",async()=>{
  const{text}=await setup,e=JSON.parse(text);
  assert.throws(()=>nf.parseFile("not json"),{message:"Summrizei 노트 파일이 아닙니다."});
  assert.throws(()=>nf.parseFile(JSON.stringify({...e,extra:1})),{message:"Summrizei 노트 파일이 아닙니다."});
  assert.throws(()=>nf.parseFile(JSON.stringify({...e,format:"other"})),{message:"Summrizei 노트 파일이 아닙니다."});
  assert.throws(()=>nf.parseFile(JSON.stringify({...e,kdf:{...e.kdf,iterations:1}})),{message:"Summrizei 노트 파일이 아닙니다."});
  assert.throws(()=>nf.parseFile(JSON.stringify({...e,salt:"AAAA"})),{message:"Summrizei 노트 파일이 아닙니다."});
});
test("encryptFile rejects non-data-URL and svg crop values",async()=>{
  const{key,salt}=await setup;
  await assert.rejects(nf.encryptFile({...payload,crops:{a:"https://x/y.png"}},key,salt),{message:"노트 파일 내용이 올바르지 않습니다."});
  await assert.rejects(nf.encryptFile({...payload,crops:{a:"data:image/svg+xml;base64,AAAA"}},key,salt),{message:"노트 파일 내용이 올바르지 않습니다."});
});
test("isPin accepts exactly four digits",()=>{
  assert.equal(nf.isPin("0427"),true);
  for(const bad of["123","12345","abcd"])assert.equal(nf.isPin(bad),false,bad);
});
test("saveLibraryKey rejects non-PIN secrets and accepts a 4-digit PIN",async()=>{
  for(const bad of["123","12345","abcd"])await assert.rejects(nf.saveLibraryKey(memoryAdapter(),bad),{message:"보관함 PIN은 숫자 4자리입니다."});
  const adapter=memoryAdapter(),saved=await nf.saveLibraryKey(adapter,"0427");
  assert.equal((await nf.loadLibraryKey(adapter)).salt,saved.salt);
});
test("deriveKey accepts a PIN or a legacy 12+ char passphrase and rejects an empty secret",async()=>{
  const salt=nf.newSalt();
  assert.equal((await nf.deriveKey("0427",salt)).type,"secret");
  assert.equal((await nf.deriveKey("legacy-passphrase",salt)).type,"secret");
  await assert.rejects(nf.deriveKey("",salt),{message:"보관함 PIN을 입력하세요."});
});
test("loadLibraryKey is null when empty or after clearLibraryKey",async()=>{
  const adapter=memoryAdapter();
  assert.equal(await nf.loadLibraryKey(adapter),null);
  await nf.saveLibraryKey(adapter,pin);
  assert.ok(await nf.loadLibraryKey(adapter));
  await nf.clearLibraryKey(adapter);
  assert.equal(await nf.loadLibraryKey(adapter),null);
});
test("fileName sanitizes title and falls back to 강의",()=>{
  const title="자료".repeat(10)+" / : \n"+"구조".repeat(30);
  const name=nf.fileName({packageId:"pkg-9",title});
  assert.ok(name.startsWith("Summrizei/")&&name.endsWith("-pkg-9.summrizei"));
  const part=name.slice("Summrizei/".length,-("-pkg-9.summrizei".length));
  assert.ok(part.length<=60);
  assert.ok(!/[\\/:*?"<>|\n]/.test(part));
  assert.equal(nf.fileName({packageId:"pkg-9",title:null}),"Summrizei/강의-pkg-9.summrizei");
});
test("two encryptions of the same payload differ in iv and ciphertext",async()=>{
  const{key,salt}=await setup;
  const a=JSON.parse(await nf.encryptFile(payload,key,salt)),b=JSON.parse(await nf.encryptFile(payload,key,salt));
  assert.notEqual(a.iv,b.iv);assert.notEqual(a.ciphertext,b.ciphertext);
});
