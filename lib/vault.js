// Browser-native authenticated encryption. Keys and passphrases are never part of the envelope.
(() => {
  const MAX=16*1024*1024, ITERATIONS=600000;
  const c=()=>globalThis.crypto?.subtle?globalThis.crypto:require("node:crypto").webcrypto;
  const encode=value=>new TextEncoder().encode(value);
  function b64(data){
    let s="";for(let i=0;i<data.length;i+=8192)s+=String.fromCharCode(...data.subarray(i,i+8192));
    return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
  }
  function unb64(s,max=MAX+16){
    if(typeof s!=="string"||s.length>Math.ceil(max*4/3)+4||!/^[A-Za-z0-9_-]*$/.test(s)||s.length%4===1)throw new Error("잘못된 암호화 데이터입니다.");
    const data=Uint8Array.from(atob(s.replace(/-/g,"+").replace(/_/g,"/")),x=>x.charCodeAt(0));
    if(data.length>max||b64(data)!==s)throw new Error("잘못된 암호화 데이터입니다.");
    return data;
  }
  function contextOf(x){
    if(!x||!["accountId","objectId"].every(k=>typeof x[k]==="string"&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(x[k]))||x.kind!=="session")throw new Error("보관 대상 정보가 올바르지 않습니다.");
    return {accountId:x.accountId,objectId:x.objectId,kind:"session",version:1};
  }
  function validate(envelope,context){
    if(!envelope||Object.keys(envelope).sort().join(",")!=="aad,alg,ciphertext,context,iv,kdf,salt,version"||envelope.version!==1||envelope.alg!=="AES-256-GCM")throw new Error("암호문 형식이 올바르지 않습니다.");
    const k=envelope.kdf;
    if(!k||Object.keys(k).sort().join(",")!=="hash,iterations,name"||k.name!=="PBKDF2"||k.hash!=="SHA-256"||k.iterations!==ITERATIONS)throw new Error("암호 키 형식이 올바르지 않습니다.");
    const ctx=contextOf(context),a=unb64(envelope.aad,1024),salt=unb64(envelope.salt,16),iv=unb64(envelope.iv,12),cipher=unb64(envelope.ciphertext);
    if(JSON.stringify(ctx)!==JSON.stringify(envelope.context)||new TextDecoder().decode(a)!==JSON.stringify(ctx)||salt.length!==16||iv.length!==12||cipher.length<16)throw new Error("보관 계정·문서 정보가 일치하지 않습니다.");
    return {ctx,a,salt,iv,cipher};
  }
  async function key(password,salt){
    if(typeof password!=="string"||password.length<12||encode(password).length>1024)throw new Error("보관 암호는 12자 이상, 1024바이트 이하로 입력하세요.");
    const material=encode(password);
    try{
      const base=await c().subtle.importKey("raw",material,"PBKDF2",false,["deriveKey"]);
      return await c().subtle.deriveKey({name:"PBKDF2",salt,iterations:ITERATIONS,hash:"SHA-256"},base,{name:"AES-GCM",length:256},false,["encrypt","decrypt"]);
    }finally{material.fill(0);}
  }
  async function encrypt(value,password,context){
    const plain=encode(JSON.stringify(value));if(plain.length>MAX)throw new Error("암호화 보관 한도 16 MiB를 초과했습니다.");
    const ctx=contextOf(context),salt=c().getRandomValues(new Uint8Array(16)),iv=c().getRandomValues(new Uint8Array(12)),aad=encode(JSON.stringify(ctx));
    try{
      const secret=await key(password,salt);
      const cipher=await c().subtle.encrypt({name:"AES-GCM",iv,additionalData:aad,tagLength:128},secret,plain);
      return {version:1,alg:"AES-256-GCM",kdf:{name:"PBKDF2",hash:"SHA-256",iterations:ITERATIONS},salt:b64(salt),iv:b64(iv),aad:b64(aad),ciphertext:b64(new Uint8Array(cipher)),context:ctx};
    }finally{plain.fill(0);}
  }
  async function decrypt(envelope,password,context){
    const {salt,iv,a,cipher}=validate(envelope,context);let plain;
    try{
      const secret=await key(password,salt);plain=new Uint8Array(await c().subtle.decrypt({name:"AES-GCM",iv,additionalData:a,tagLength:128},secret,cipher));
      return JSON.parse(new TextDecoder().decode(plain));
    }catch{throw new Error("복호화하지 못했습니다. 암호 또는 보관 자료를 확인하세요.");}
    finally{plain?.fill(0);}
  }
  const api={encrypt,decrypt,validate,contextOf,constants:{version:1,iterations:ITERATIONS,maxBytes:MAX}};
  globalThis.LectureVault=api;if(typeof module!=="undefined")module.exports=api;
})();
