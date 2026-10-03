// 완성된 강의 노트를 Downloads/Summrizei 폴더에 쓰는 단일 암호문 파일 형식.
// 복호화는 사용자의 보관함 암호를 아는 웹사이트만 할 수 있고, 확장은 추출 불가 파생키만 보관한다.
(() => {
  const FORMAT="summrizei-note",VERSION=1,ITERATIONS=600000,EXT=".summrizei";
  const MAX_PLAIN=24*1024*1024,MAX_FILE=40*1024*1024;
  const ID_RE=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/,CROP_KEY_RE=/^[A-Za-z0-9_.:-]{1,64}$/,CROP_RE=/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+\/]+={0,2}$/;
  const NOT_FILE="Summrizei 노트 파일이 아닙니다.",BAD_PAYLOAD="노트 파일 내용이 올바르지 않습니다.",DECRYPT_FAIL="복호화하지 못했습니다. 보관함 암호를 확인하세요.";
  const AAD_TEXT=JSON.stringify({format:FORMAT,version:VERSION});
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
  function newSalt(){return b64(c().getRandomValues(new Uint8Array(16)));}
  async function deriveKey(passphrase,salt){
    if(typeof passphrase!=="string"||passphrase.length<12||encode(passphrase).length>1024)throw new Error("보관함 암호는 12자 이상, 1024바이트 이하로 입력하세요.");
    const s=typeof salt==="string"?unb64(salt,16):salt,material=encode(passphrase);
    try{
      const base=await c().subtle.importKey("raw",material,"PBKDF2",false,["deriveKey"]);
      return await c().subtle.deriveKey({name:"PBKDF2",salt:s,iterations:ITERATIONS,hash:"SHA-256"},base,{name:"AES-GCM",length:256},false,["encrypt","decrypt"]);
    }finally{material.fill(0);}
  }
  async function encryptFile(payload,key,salt){
    checkPayload(payload);
    const plain=encode(JSON.stringify(payload));
    if(plain.length>MAX_PLAIN)throw new Error("노트 파일 한도 24 MiB를 초과했습니다.");
    const iv=c().getRandomValues(new Uint8Array(12)),aad=encode(AAD_TEXT);
    try{
      const cipher=await c().subtle.encrypt({name:"AES-GCM",iv,additionalData:aad,tagLength:128},key,plain);
      return JSON.stringify({format:FORMAT,version:VERSION,alg:"AES-256-GCM",kdf:{name:"PBKDF2",hash:"SHA-256",iterations:ITERATIONS},salt,iv:b64(iv),aad:b64(aad),ciphertext:b64(new Uint8Array(cipher))});
    }finally{plain.fill(0);}
  }
  function parseFile(text){
    if(typeof text!=="string"||text.length>MAX_FILE)throw new Error(NOT_FILE);
    let e;try{e=JSON.parse(text);}catch{throw new Error(NOT_FILE);}
    if(!isObj(e)||Object.keys(e).sort().join(",")!=="aad,alg,ciphertext,format,iv,kdf,salt,version"||e.format!==FORMAT||e.version!==VERSION||e.alg!=="AES-256-GCM")throw new Error(NOT_FILE);
    const k=e.kdf;
    if(!isObj(k)||Object.keys(k).sort().join(",")!=="hash,iterations,name"||k.name!=="PBKDF2"||k.hash!=="SHA-256"||k.iterations!==ITERATIONS)throw new Error(NOT_FILE);
    let salt,iv,aad,cipher;
    try{salt=unb64(e.salt,16);iv=unb64(e.iv,12);aad=unb64(e.aad,1024);cipher=unb64(e.ciphertext);}catch{throw new Error(NOT_FILE);}
    if(salt.length!==16||iv.length!==12||new TextDecoder().decode(aad)!==AAD_TEXT||cipher.length<16)throw new Error(NOT_FILE);
    return e;
  }
  async function decryptWithKey(text,key){
    const e=parseFile(text);let plain;
    try{
      const iv=unb64(e.iv,12),aad=unb64(e.aad,1024),cipher=unb64(e.ciphertext);
      plain=new Uint8Array(await c().subtle.decrypt({name:"AES-GCM",iv,additionalData:aad,tagLength:128},key,cipher));
      return checkPayload(JSON.parse(new TextDecoder().decode(plain)));
    }catch(err){
      if(err&&err.message===BAD_PAYLOAD)throw err;
      throw new Error(DECRYPT_FAIL);
    }finally{plain?.fill(0);}
  }
  async function decryptFile(text,passphrase){
    const e=parseFile(text);
    return decryptWithKey(text,await deriveKey(passphrase,e.salt));
  }
  async function saveLibraryKey(adapter,passphrase){
    const salt=newSalt(),key=await deriveKey(passphrase,salt),at=Date.now();
    await adapter.put("keys","library",{key,salt,at});
    return {salt,at};
  }
  async function loadLibraryKey(adapter){
    const r=await adapter.get("keys","library");
    if(!isObj(r)||r.key?.type!=="secret"||typeof r.at!=="number"||typeof r.salt!=="string")return null;
    try{if(unb64(r.salt,16).length!==16)return null;}catch{return null;}
    return r;
  }
  async function clearLibraryKey(adapter){await adapter.delete("keys","library");}
  function fileName(meta){
    let t=String(meta?.title||"강의").normalize("NFC").replace(/[\\/:*?"<>|\x00-\u001F\u007F]/g,"").replace(/\s+/g," ").trim().slice(0,60).trimEnd();
    if(!t)t="강의";
    return `Summrizei/${t}-${meta?.packageId}${EXT}`;
  }
  const api={FORMAT,VERSION,ITERATIONS,EXT,MAX_PLAIN,newSalt,deriveKey,encryptFile,parseFile,decryptWithKey,decryptFile,saveLibraryKey,loadLibraryKey,clearLibraryKey,fileName};
  globalThis.NoteFile=api;if(typeof module!=="undefined")module.exports=api;
})();
