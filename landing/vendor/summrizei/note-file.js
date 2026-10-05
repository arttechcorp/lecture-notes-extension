// 완성된 강의 노트를 보관함 폴더에 쓰는 단일 암호문 파일 형식(summrizei-note). 같은 봉투로 다시 만들기 자료 백업(summrizei-data)도 싼다.
// 키는 로그인 계정마다 하나인 256비트 난수다(서버 library_key()). 별도 비밀번호는 없다: 같은 계정으로 로그인한 확장·웹사이트만 키를 받아 연다.
// 확장은 받은 키를 추출 불가 CryptoKey 로만 보관하고, 웹사이트는 메모리에만 둔다.
(() => {
  const FORMAT="summrizei-note",VERSION=2,EXT=".summrizei";
  const MAX_PLAIN=24*1024*1024,MAX_FILE=40*1024*1024;
  const ID_RE=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/,CROP_KEY_RE=/^[A-Za-z0-9_.:-]{1,64}$/,CROP_RE=/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+\/]+={0,2}$/;
  const NOT_FILE="Summrizei 노트 파일이 아닙니다.",BAD_PAYLOAD="노트 파일 내용이 올바르지 않습니다.",DECRYPT_FAIL="복호화하지 못했습니다. 이 노트를 만든 계정으로 로그인했는지 확인하세요.",NO_KEY="보관함 키가 올바르지 않습니다.";
  const DATA_FORMAT="summrizei-data",B64_RE=/^[A-Za-z0-9+\/]*={0,2}$/,DATA_CROP_RE=/^[FG]\d{1,6}$/;
  const aadOf=format=>JSON.stringify({format,version:VERSION});
  const c=()=>globalThis.crypto?.subtle?globalThis.crypto:require("node:crypto").webcrypto;
  const encode=value=>new TextEncoder().encode(value);
  const isObj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
  function b64(data){
    let s="";for(let i=0;i<data.length;i+=8192)s+=String.fromCharCode(...data.subarray(i,i+8192));
    return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
  }
  function unb64(s,max=MAX_FILE){
    if(typeof s!=="string"||s.length>Math.ceil(max*4/3)+4||!/^[A-Za-z0-9_-]*$/.test(s)||s.length%4===1)throw new Error("잘못된 암호화 데이터입니다.");
    const data=Uint8Array.from(atob(s.replace(/-/g,"+").replace(/_/g,"/")),x=>x.charCodeAt(0));
    if(data.length>max||b64(data)!==s)throw new Error("잘못된 암호화 데이터입니다.");
    return data;
  }
  function checkPayload(p){
    if(!isObj(p)||Object.keys(p).sort().join(",")!=="crops,meta,note"||!isObj(p.meta)||!isObj(p.note)||!isObj(p.crops))throw new Error(BAD_PAYLOAD);
    if(typeof p.meta.packageId!=="string"||!ID_RE.test(p.meta.packageId))throw new Error(BAD_PAYLOAD);
    for(const[k,v]of Object.entries(p.crops))if(!CROP_KEY_RE.test(k)||typeof v!=="string"||!CROP_RE.test(v))throw new Error(BAD_PAYLOAD);
    return p;
  }
  // 서버가 주는 키: 64자리 hex(256비트). 추출 불가 AES-GCM 키로만 바꿔 쓴다.
  async function keyFromHex(hex){
    if(typeof hex!=="string"||!/^[0-9a-f]{64}$/.test(hex))throw new Error(NO_KEY);
    const raw=Uint8Array.from(hex.match(/../g),h=>parseInt(h,16));
    try{return await c().subtle.importKey("raw",raw,"AES-GCM",false,["encrypt","decrypt"]);}
    finally{raw.fill(0);}
  }
  // 다시 만들기 자료: 기기 보관함 패키지 하나(lib/library.js load + 크롭 바이트 base64). 확장만 쓰고 읽는다.
  function checkData(p){
    if(!isObj(p)||Object.keys(p).sort().join(",")!=="crops,input,meta,note,recognition"||!isObj(p.meta)||!isObj(p.crops))throw new Error(BAD_PAYLOAD);
    if(typeof p.meta.packageId!=="string"||!ID_RE.test(p.meta.packageId))throw new Error(BAD_PAYLOAD);
    for(const[k,v]of Object.entries(p.crops))if(!DATA_CROP_RE.test(k)||typeof v!=="string"||!B64_RE.test(v))throw new Error(BAD_PAYLOAD);
    return p;
  }
  const CHECK={[FORMAT]:checkPayload,[DATA_FORMAT]:checkData};
  async function seal(format,payload,key){
    CHECK[format](payload);
    const plain=encode(JSON.stringify(payload));
    if(plain.length>MAX_PLAIN)throw new Error("노트 파일 한도 24 MiB를 초과했습니다.");
    const iv=c().getRandomValues(new Uint8Array(12)),aad=encode(aadOf(format));
    try{
      const cipher=await c().subtle.encrypt({name:"AES-GCM",iv,additionalData:aad,tagLength:128},key,plain);
      return JSON.stringify({format,version:VERSION,alg:"AES-256-GCM",iv:b64(iv),aad:b64(aad),ciphertext:b64(new Uint8Array(cipher))});
    }finally{plain.fill(0);}
  }
  function parseFile(text,format=FORMAT){
    if(typeof text!=="string"||text.length>MAX_FILE)throw new Error(NOT_FILE);
    let e;try{e=JSON.parse(text);}catch{throw new Error(NOT_FILE);}
    if(!isObj(e)||Object.keys(e).sort().join(",")!=="aad,alg,ciphertext,format,iv,version"||e.format!==format||e.version!==VERSION||e.alg!=="AES-256-GCM")throw new Error(NOT_FILE);
    let iv,aad,cipher;
    try{iv=unb64(e.iv,12);aad=unb64(e.aad,1024);cipher=unb64(e.ciphertext);}catch{throw new Error(NOT_FILE);}
    if(iv.length!==12||new TextDecoder().decode(aad)!==aadOf(format)||cipher.length<16)throw new Error(NOT_FILE);
    return e;
  }
  async function unseal(format,text,key){
    const e=parseFile(text,format);let plain;
    try{
      const iv=unb64(e.iv,12),aad=unb64(e.aad,1024),cipher=unb64(e.ciphertext);
      plain=new Uint8Array(await c().subtle.decrypt({name:"AES-GCM",iv,additionalData:aad,tagLength:128},key,cipher));
      return CHECK[format](JSON.parse(new TextDecoder().decode(plain)));
    }catch(err){
      if(err&&err.message===BAD_PAYLOAD)throw err;
      throw new Error(DECRYPT_FAIL);
    }finally{plain?.fill(0);}
  }
  const encryptFile=(payload,key)=>seal(FORMAT,payload,key);
  const decryptWithKey=(text,key)=>unseal(FORMAT,text,key);
  const encryptData=(payload,key)=>seal(DATA_FORMAT,payload,key);
  const decryptData=(text,key)=>unseal(DATA_FORMAT,text,key);
  // 저장된 키 레코드 {key,uid,at}. uid 는 키를 받은 로그인 계정이다.
  async function saveLibraryKey(adapter,uid,hex){
    if(typeof uid!=="string"||!uid)throw new Error(NO_KEY);
    const key=await keyFromHex(hex),at=Date.now();
    await adapter.put("keys","library",{key,uid,at});
    return {key,uid,at};
  }
  async function loadLibraryKey(adapter){
    const r=await adapter.get("keys","library");
    return isObj(r)&&r.key?.type==="secret"&&typeof r.at==="number"&&typeof r.uid==="string"?r:null;
  }
  // 이 계정(uid)의 키가 기기에 있으면 그대로, 없거나 다른 계정 것이면 fetchHex()로 받아 바꾼다. 로그아웃·다른 계정 로그인 뒤에도 옛 키로 쓰지 않는다.
  async function ensureLibraryKey(adapter,uid,fetchHex){
    const r=await loadLibraryKey(adapter);
    return r&&r.uid===uid?r:saveLibraryKey(adapter,uid,await fetchHex());
  }
  async function clearLibraryKey(adapter){await adapter.delete("keys","library");}
  function fileName(meta){
    let t=String(meta?.title||"강의").normalize("NFC").replace(/[\\/:*?"<>|\x00-\u001F\u007F]/g,"").replace(/\s+/g," ").trim().slice(0,60).trimEnd();
    if(!t)t="강의";
    return `${t}-${String(meta?.packageId).replace(/[^A-Za-z0-9_.-]/g,"_")}${EXT}`; // ':' 같은 파일명 금지 문자는 '_' — 진짜 id 는 암호문 안에 있다
  }
  const api={FORMAT,DATA_FORMAT,VERSION,EXT,MAX_PLAIN,keyFromHex,encryptFile,parseFile,decryptWithKey,encryptData,decryptData,saveLibraryKey,loadLibraryKey,ensureLibraryKey,clearLibraryKey,fileName};
  globalThis.NoteFile=api;if(typeof module!=="undefined")module.exports=api;
})();
