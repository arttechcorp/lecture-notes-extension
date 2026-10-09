// One in-memory session and archive encryption boundary.
let session=null,generation=0,starting=false,summaryController=null,archiveBusy=false,bg=null,sink=null; // bg: 실행 중인 백그라운드 작업 {jobId,ctl} — 한 번에 하나
// 파이프라인 진단 이벤트: 한 버스를 어드민(실시간 포트)과 암호화 로컬 로그가 함께 구독한다. 파이프라인에는 예외를 삼키는 safe 껍데기만 넘긴다.
const bus=new PipelineEvents.EventBus(),events=PipelineEvents.safe(bus);
// 확장 버전: offscreen 에는 getManifest 가 없어 패키지의 manifest.json 을 한 번 읽는다(서비스 요청의 x-client-version·진단 파일에 쓴다).
const versionP=(async()=>{try{return chrome.runtime.getManifest?.()?.version||(await (await fetch(chrome.runtime.getURL("manifest.json"))).json()).version||null;}catch{return null;}})();
versionP.then(v=>{if(v)globalThis.SUMMRIZEI_VERSION=v;});
const storeP=PackageStore.indexedDbAdapter().then(PackageStore.createStore); // 로그와 백그라운드 작업이 한 암호화 저장소를 나눠 쓴다
storeP.then(store=>(sink=new PipelineEvents.LogSink(bus,store)).start()).catch(()=>events.emit({stage:"system",level:"warn",code:"LOG_STORE_UNAVAILABLE"}));
events.emit({stage:"system",code:"BOOT",msg:"offscreen"});
// 잡히지 않은 오류도 진단에 남긴다 — error.message 는 입력 텍스트를 담을 수 있어(V8 JSON 오류) 이름과 첫 스택 프레임의 file:line:col 만 싣는다.
const frameLoc=s=>{for(const l of String(s||"").split("\n")){if(!/^\s*at\b/.test(l))continue;const m=l.match(/[^\s()]+:\d+:\d+/g);if(m)return m.at(-1);}return "-";};
const uncaught=(name,stack)=>events.emit({stage:"system",level:"error",code:"UNCAUGHT",msg:`${name||"Error"} ${frameLoc(stack)}`});
globalThis.addEventListener?.("error",e=>uncaught(e.error?.name,e.error?.stack||`at ${e.filename||"-"}:${e.lineno||0}:${e.colno||0}`));
globalThis.addEventListener?.("unhandledrejection",e=>uncaught(e.reason?.name||typeof e.reason,e.reason?.stack));
const emit=state=>chrome.runtime.sendMessage({target:"panel",type:"SESSION_STATE",state}).catch(()=>{});
const trusted=(sender,pages=["/background.js","/sidepanel.html","/options.html"])=>{try{const url=new URL(sender.url),base=new URL(chrome.runtime.getURL(""));return sender.id===chrome.runtime.id&&url.protocol===base.protocol&&url.host===base.host&&pages.includes(url.pathname);}catch{return false;}};
const settingsOf=s=>({serviceUrl:String(s?.serviceUrl||""),appSessionToken:String(s?.appSessionToken||""),remoteSummaryConsent:s?.remoteSummaryConsent===true,
  noteOptions:{syntheticExamples:s?.noteOptions?.syntheticExamples===true,externalAugmentation:s?.noteOptions?.externalAugmentation===true}});
// 서비스 호출 직전에 쓸 토큰을 정한다. offscreen에는 chrome.storage가 없어 background에 묻는다: 로그인 토큰(만료 전 갱신됨)을 우선한다.
// 로그아웃 상태면 개발용 정적 토큰(fallback)을 쓰되 localhost 서비스에서만 — 운영 서버가 모르는 v1 개발 토큰을 보내 "인증 만료"가 되는 일을 막는다. 갱신 실패 같은 오류는 조용히 넘기지 않고 그대로 올린다.
const tokenProvider=async(fallback,serviceUrl)=>{
  const reply=await chrome.runtime.sendMessage({target:"background",type:"AUTH_TOKEN"}).catch(()=>null);
  if(reply?.ok===false)throw new Error(reply.error||"로그인 정보를 확인하지 못했습니다.");
  if(typeof reply?.token==="string"&&reply.token)return reply.token;
  try{const u=new URL(serviceUrl);if(/^https?:$/.test(u.protocol)&&["localhost","127.0.0.1","[::1]"].includes(u.hostname)&&typeof fallback==="string"&&fallback)return fallback;}catch{}
  throw Object.assign(new Error("로그인이 필요합니다. 메뉴에서 Google로 로그인하세요."),{code:"AUTH_REQUIRED"});
};
// 서비스가 401로 토큰을 거부하면 검증 없이 뗀 껍데기(tokenInfo: 종류·alg·kid·발급자·남은 수명)와 서버의 거절 이유(authReason·authDetail)만 진단 이벤트에 싣는다 — 본문·sub·이메일·토큰은 싣지 않는다. 돌려주는 문자열은 세션 디버그 로그 한 줄용이다.
const tokenInfoText=t=>[t.kind,t.alg,t.kid,t.iss,t.expInSec!=null?`exp ${t.expInSec}s`:null,t.length!=null?`len ${t.length}`:null].filter(v=>v!=null&&v!=="").join(" ");
const authEvent=(error,extra)=>{if(error?.status!==401||!error?.tokenInfo)return null;const msg=(tokenInfoText(error.tokenInfo)+(error.authReason?` · reason ${error.authReason}${error.authDetail?" "+error.authDetail:""}`:"")).slice(0,200);events.emit({stage:"auth",level:"warn",code:"AUTH_REJECTED",msg,...extra});return `[인증] 서버가 토큰을 거부함 · ${msg}`;};
// ── 유료 백그라운드 작업(BG_*, docs/architecture-v2.md §5.3, §6.1, §8) ──
// 한 번에 하나. 원본 미디어는 메모리에서만 쓰고 파생물(슬라이드·전사·노트)만 암호화 패키지 저장소에 둔다. 진행은 이벤트 버스에서 단계별 개수만 패널에 밀고, 결말은 BG_DONE으로 background에 알린다
// (background가 절전 방지·Referer 규칙을 풀고 패널에 전한다). BG_*·LIB_* 요청은 background.js만 보낼 수 있다 — 동의 기록과 Referer 출처를 거기서 정하기 때문이다.
// /v1/me는 요약 모델 목록만 알려 주고 인식·판정 모델은 싣지 않아 모델은 여기 한 곳에 둔다. 서버 allowlist(ALLOWED_*_MODELS)와 어긋나면 invalid_model로 멈춘다 — 다른 모델로 조용히 바꾸지 않는다.
// ponytail: 계획·작성 분담은 MiMo Pro/Flash 다(2026-10-04 결정).
// 계획은 GPT-6.1 Sol(추론 medium) — 100초 안에 못 끝내면 stages가 작성 모델(Flash)로 한 번 다시 계획한다. MiMo Pro는 무료 Edge 150초 안에 못 끝내 뺐다(필드 3/3 시간 초과).
const BG_MODELS={plan:"openai/gpt-6.1-sol",write:"xiaomi/mimo-v2.6-flash",writeAlt:"openai/gpt-6.1-sol",judge:"typesafe/jev-1.13",stt:"microsoft/mai-transcribe-2",vision:"openai/gpt-6-luna"};
const bgMe=async(settings,signal)=>ServiceClient.me({baseUrl:settings.serviceUrl,token:await tokenProvider(settings.appSessionToken,settings.serviceUrl),timeoutMs:15000,signal});
// Referer 규칙은 background가 건다(DNR은 서비스 워커 몫). 새 호스트로 나가기 전에 그 호스트를 더해 달라고 하고 답을 기다린다 — 호스트마다 한 번, 차례로(규칙 갱신이 서로 덮어쓰지 않게).
// ponytail: 리다이렉트로 호스트가 바뀌면 그 호스트는 규칙에 없어 Referer가 빠지고 SRC_AUTH_EXPIRED로 멈춘다. 필요하면 응답의 url을 보고 규칙을 늘린다.
function refererFetch(referer){
  const asked=new Map();let queue=Promise.resolve();
  const bad=message=>Object.assign(new Error(message),{code:"SRC_BAD_URL"});
  const ask=async host=>{const r=await chrome.runtime.sendMessage({target:"background",type:"BG_REFERER",host,referer}).catch(()=>null);if(!r?.ok)throw bad(r?.error||"Referer 규칙을 걸지 못했습니다.");};
  return async(url,init)=>{
    const {protocol,hostname}=new URL(url);
    if(!/^https?:$/.test(protocol))throw bad("영상 주소가 올바르지 않습니다.");
    if(!asked.has(hostname))asked.set(hostname,queue=queue.catch(()=>{}).then(()=>ask(hostname)));
    await asked.get(hostname);
    return fetch(url,{...init,cache:"no-store"}); // 원본 미디어는 HTTP 캐시에도 남기지 않는다
  };
}
// 비전에 올리기 전에 반복 워터마크 영역(정규화 상자)을 둘레 띠의 채널별 중앙값 색으로 칠한다. 프레임은 메모리에서만 다룬다.
async function paintMasks(blob,boxes){
  const img=await createImageBitmap(blob),W=img.width,H=img.height,canvas=new OffscreenCanvas(W,H),g=canvas.getContext("2d",{willReadFrequently:true});
  g.drawImage(img,0,0);img.close();
  const px=(v,max)=>Math.max(0,Math.min(max,Math.round(v))),ring=Math.max(2,Math.round(Math.min(W,H)/100));
  for(const b of boxes){
    const x0=px(b.x*W,W),y0=px(b.y*H,H),x1=px((b.x+b.w)*W,W),y1=px((b.y+b.h)*H,H),X0=px(x0-ring,W),Y0=px(y0-ring,H),X1=px(x1+ring,W),Y1=px(y1+ring,H);
    const data=[[X0,Y0,X1-X0,y0-Y0],[X0,y1,X1-X0,Y1-y1],[X0,y0,x0-X0,y1-y0],[x1,y0,X1-x1,y1-y0]].filter(r=>r[2]>0&&r[3]>0).map(r=>g.getImageData(...r).data);
    const median=c=>{const v=data.flatMap(d=>Array.from({length:d.length/4},(_,i)=>d[i*4+c])).sort((a,b)=>a-b);return v[v.length>>1]??255;};
    g.fillStyle=`rgb(${median(0)},${median(1)},${median(2)})`;g.fillRect(x0,y0,x1-x0,y1-y0);
  }
  return LectureDecode.jpeg(canvas,0.8);
}
// ── v2 노트 공통(실시간·백그라운드) ──
// 계획·작성 모델은 계정 모델 목록(/v1/me)에서 고른다: BG_MODELS 가 목록에 있으면 그것, 없으면 첫 모델. 판정은 judge 기능이 켜진 계정만.
// writeAlt(대체 작성 모델, 다른 제공자)는 목록에 있을 때만 — 없으면 실패한 부분은 대체 없이 빠진다.
// devWriteModel(숨은 실험 설정)은 계정 목록에 있을 때만 write를 덮어쓴다 — 목록에 없거나 빈 값이면 기본 그대로.
// devNoteMode(숨은 실험 설정)는 모델을 실험 계약으로 고정한다 — 계정 목록과 무관하게 그 모델로만 부른다(서버가 허용 목록으로 걸러
// 못 쓰면 invalid_model로 멈춘다). independent=Sol 계획+Luna High 작성의 캐시 없는 독립 호출, sol-session·sol-luna-tool=Sol 전용
// noteSession 대화(이어 붙이는 연쇄), sol-fork=Sol 전용 noteSession 이지만 계획 응답의 고정 접두를 모든 쓰기 호출이 공유한다.
// sol-luna-2·sol-fork-2(v2)=계획 응답의 고정 접두 P·편집 계획·통합 검수(review): sol-fork-2 는 전 단계 Sol,
// sol-luna-2 는 검수·전역·수정=Sol(P)·초안·문항=Luna High 독립 호출 — 단계→모델 표는 stages.js 와 서버가 함께 강제한다.
// sol-luna-3 은 sol-luna-2 와 같은 경로다 — 개선 실험은 devNoteV3 옵션(deps.noteV3 → stages ctx.v3)으로만 가른다.
// mis-sol-hai(v2)=계획·편집·검수·전역·수리는 Sol 세션, 초안·문항은 Haiku 5.5 독립 호출 — 단계→모델 표는 프로파일이 강제한다.
// 여덟 모드 다 writeAlt는 null — 대체 모델로 조용히 넘어가면 실험 조건이 아니다.
// 모드 표는 lib/note-profiles.js(전역 NoteProfiles)가 단일 출처다 — vm 테스트는 이 파일만 올리므로 없을 때는 같은 값의 리터럴로 떨어진다.
const NP=globalThis.NoteProfiles||null;
const NOTE_MODES=new Set(NP?NP.ids():["independent","sol-session","sol-luna-tool","sol-fork","sol-luna-2","sol-luna-3","sol-fork-2","mis-sol-hai"]),SOL="openai/gpt-6.1-sol",LUNA_HIGH="openai/gpt-6-luna@high";
// 플래그가 켜져 있는데 여섯 모드가 아니면 값을 못 읽은 것이다 — 기본 모델로 조용히 넘어가지 않고 멈춘다(조용한 전환 금지·비용 보호).
const noteModeOf=s=>{const m=s?.devNoteMode;
  if(m==null||m==="")return null;
  if(NOTE_MODES.has(m))return m;
  events.emit({stage:"job",level:"error",code:"NOTE_MODE_INVALID"});
  throw Pipeline.pipelineError("NOTE_MODE_INVALID");};
const noteModels=(me,settings)=>{const ms=Array.isArray(me?.models)?me.models:[],pick=m=>ms.includes(m)?m:ms[0],dev=typeof settings?.devWriteModel==="string"?settings.devWriteModel.trim():"",judge=(me?.features||[]).includes("judge")?BG_MODELS.judge:null,mode=noteModeOf(settings),prof=mode&&NP?.get(mode);
  if(prof)return{plan:prof.clientModels.plan,write:prof.clientModels.write,writeAlt:null,judge};
  if(mode==="independent"||mode==="sol-luna-2"||mode==="sol-luna-3")return{plan:SOL,write:LUNA_HIGH,writeAlt:null,judge};
  if(mode==="mis-sol-hai")return{plan:SOL,write:"anthropic/claude-haiku-5.5",writeAlt:null,judge};
  if(mode)return{plan:SOL,write:SOL,writeAlt:null,judge};
  return{plan:pick(BG_MODELS.plan),write:dev&&ms.includes(dev)?dev:pick(BG_MODELS.write),writeAlt:ms.includes(BG_MODELS.writeAlt)?BG_MODELS.writeAlt:null,judge};};
// 노트 실행 시작 때 쓴 모델 셋을 내용 없는 이벤트 한 줄로 남긴다 — devWriteModel·devNoteMode 실험군을 작업 진단 파일에서 구분하기 위해서.
const noteModelsEvent=(jobId,m,mode)=>events.emit({stage:"job",jobId,code:"NOTE_MODELS",msg:`plan=${m?.plan||"-"} write=${m?.write||"-"} alt=${m?.writeAlt||"-"}${mode?` noteMode=${mode}`:""}`});
// GENERATE_NOTES·LIB_REGENERATE 가 같은 모양으로 runNote 를 부른다 — /v1/me 와 서비스 묶음을 한 곳에서 만든다. 토큰은 매 서비스 호출마다 새로 받는다.
// deps(signal, me, stats): /v1/me 의 작업별 서버 프롬프트 버전을 단계·호출 캐시 키에 넣고, 로컬 캐시 적중 수를 stats 에 모아 run 끝에 한 번 보고한다.
const noteService=settings=>{
  const config=settingsOf(settings),token=()=>tokenProvider(config.appSessionToken,config.serviceUrl);
  const svc=name=>async o=>ServiceClient[name]({baseUrl:config.serviceUrl,token:await token(),...o});
  return {
    me:async signal=>ServiceClient.me({baseUrl:config.serviceUrl,token:await token(),timeoutMs:15000,signal}),
    deps:(signal,me,stats)=>({service:{plan:svc("plan"),write:svc("write"),judge:svc("judge")},katex,events,signal,sleep:ms=>new Promise(r=>setTimeout(r,ms)),promptVersions:me?.promptVersions??null,cacheStats:stats??null,linkEditor:me?.config?.linkEditor===true,writer:me?.config?.noteWriter,noteMode:noteModeOf(settings),noteV3:settings?.devNoteV3,emphasisSignals:NP?.get(noteModeOf(settings))?.emphasisSignals===true}),
    // 로컬 결과 캐시 적중은 서버 원장에 안 보인다 — 내용 없는 수치(jobId·hit/miss·rerun 번호)만 모아 보낸다. 실패해도 노트 흐름을 막지 않는다.
    report:async(jobId,rerun,stats)=>{try{await ServiceClient.reportRun({baseUrl:config.serviceUrl,token:await token(),jobId,cacheHits:stats?.hits??0,cacheMisses:stats?.misses??0,rerun});}catch{}},
  };
};
const hostOf=url=>{try{return new URL(url).hostname;}catch{return null;}};
// 슬라이드 한 장의 도표·수식 영역을 메모리 안에서 잘라 WebP 바이트로 돌려준다(6-6). 슬라이드 전체는 자르지 않는다(D2). 도표는 dHash 도 낸다.
// 후보는 Figures.cropCandidates 가 검사·중복 제거·면적 순위·상한을 정한다 — 잘린 것은 내용 없는 코드(CROP_LIMIT 등)만 남긴다.
// 도표 크롭에는 소스 픽셀 그대로의 크롭 비트맵에 기기 안 OCR(Figures.cropOcr — 실시간과 같은 PP-OCR 런타임)을 돌려 읽은
// 텍스트를 ocr 에 담는다 — 이벤트에는 텍스트를 싣지 않는다. 소스가 작은 크롭(lowRes)은 크롭·지문만 남기고 OCR은 건너뛴다.
// ctx:{jobId,signal} — 작업 취소가 오면 남은 크롭·OCR을 시작하지 않고 AbortError 로 멈춘다.
async function cropRegions(blob,doc,ctx){
  const {jobId=null,signal=null}=ctx||{},bail=()=>signal?.throwIfAborted();
  const warn=(code,extra)=>events.emit({stage:"crop",level:"warn",code,...(jobId?{jobId}:{}),...(extra||{})});
  const crops={},hashes={},formulas=[],ocr={},lowRes=[];
  bail();
  const bmp=await createImageBitmap(blob),canvas=(w,h)=>new OffscreenCanvas(w,h),bytes=async b=>new Uint8Array(await b.arrayBuffer());
  const pick=(list,kinds,cap)=>{
    const {items,rejected,omitted}=Figures.cropCandidates(list,bmp.width,bmp.height,{kinds,cap});
    for(const rj of rejected)warn(rj.code,{unit:`${doc.slideId}/${rj.f.id}`});
    if(omitted)warn("CROP_LIMIT",{msg:`omitted:${omitted}`});
    return items;
  };
  let engine=null,engineTried=false;
  try{
    bail();
    for(const {f,r} of pick(doc.figures,new Set(["table","chart","diagram"]),3)){
      bail();
      const key=`${doc.slideId}/${f.id}`;
      crops[key]=await bytes(await Figures.cropFigure(bmp,f.bbox,{createCanvas:canvas}));bail();
      const c=canvas(9,8),g=c.getContext("2d",{willReadFrequently:true});
      g.drawImage(bmp,r.sx,r.sy,r.sw,r.sh,0,0,9,8);
      hashes[key]=Figures.dHash({width:9,height:8,data:g.getImageData(0,0,9,8).data,channels:4});
      if(r.lowRes){lowRes.push(key);warn("CROP_LOW_RES",{unit:key});continue;}
      if(!engineTried){engineTried=true;engine=await Figures.cropOcr();bail();if(!engine)warn("CROP_OCR_UNAVAILABLE",{unit:key});}
      if(!engine)continue;
      let cb=null;
      try{
        cb=await createImageBitmap(bmp,r.sx,r.sy,r.sw,r.sh);bail(); // 소스 픽셀 그대로 — 늘리지 않는다
        const text=String((await engine.recognize(cb))?.text??"").trim();bail();
        if(text)ocr[key]=text.slice(0,4000);else warn("CROP_OCR_EMPTY",{unit:key});
      }catch(e){if(signal?.aborted)throw e;warn("CROP_OCR_EMPTY",{unit:key});}
      finally{cb?.close?.();}
    }
    for(const {f,r} of pick(doc.formulas,null,4)){
      bail();
      const key=`${doc.slideId}/${f.id}`;
      const cut=await Figures.cropFigure(bmp,f.bbox,{createCanvas:canvas,maxSide:900});bail();
      crops[key]=await bytes(cut);bail();
      formulas.push(key);
      if(r.lowRes){lowRes.push(key);warn("CROP_LOW_RES",{unit:key});}
    }
  }finally{bmp.close();}
  return {crops,hashes,formulas,ocr,lowRes};
}
// mis-sol-hai D6: OCR 이 못 읽은 필기 영역(정규화 상자)만 잘라 Blob 목록으로 돌려준다 — 슬라이드 전체는 자르지 않는다.
// cropRegions 와 같은 방식(createImageBitmap+OffscreenCanvas)이고, 결과는 작성 단계의 이미지 근거로만 쓰인다 —
// 저장소·노트·이벤트 어디에도 싣지 않고 runNote 입력의 메모리 참조로만 둔다.
async function cropInk(blob,boxes,ctx){
  const {signal=null}=ctx||{};
  signal?.throwIfAborted();
  const bmp=await createImageBitmap(blob),canvas=(w,h)=>new OffscreenCanvas(w,h);
  try{
    const out=[];
    for(const b of boxes||[]){
      signal?.throwIfAborted();
      const x=Math.max(0,Math.min(bmp.width,Math.round(b.x*bmp.width))),y=Math.max(0,Math.min(bmp.height,Math.round(b.y*bmp.height)));
      const w=Math.min(bmp.width-x,Math.round(b.w*bmp.width)),h=Math.min(bmp.height-y,Math.round(b.h*bmp.height));
      if(w<4||h<4){out.push(null);continue;} // 상자가 사라지면 그 영역은 근거가 없다 — 순서는 상자와 맞춰 둔다
      const g=canvas(w,h).getContext("2d");g.drawImage(bmp,x,y,w,h,0,0,w,h);
      out.push(await g.canvas.convertToBlob({type:"image/jpeg",quality:0.85}));
    }
    return out;
  }finally{bmp.close();}
}
// 노트 키. 기기에 있으면 그대로, 없으면(보관함 비우기 뒤·패널에서 키를 못 받은 채 끝난 작업) 지금 로그인한 계정 것을 background(LIBRARY_KEY)에서 받아 둔다.
// offscreen 은 인증 모듈을 싣지 않아 uid 는 AUTH_TOKEN 의 sub 로 정한다. 로그아웃·오프라인이면 던진다 — 호출자가 "no-key"로 접는다.
async function libraryKey(adapter){
  const have=await NoteFile.loadLibraryKey(adapter);
  if(have)return have;
  const b=String(await tokenProvider()).split(".")[1].replace(/-/g,"+").replace(/_/g,"/");
  const uid=JSON.parse(atob(b.padEnd(Math.ceil(b.length/4)*4,"="))).sub; // sub(uuid)는 ASCII라 UTF-8 복원 없이 읽힌다
  const r=await chrome.runtime.sendMessage({target:"background",type:"LIBRARY_KEY"});
  if(!r?.ok)throw new Error(r?.error||"보관함 키를 받지 못했습니다.");
  return NoteFile.saveLibraryKey(adapter,uid,r.hex);
}
// 끝난 노트를 로그인 계정 키(NoteFile)로 암호화해 사용자가 온보딩에서 고른 폴더에 바로 쓴다(LibraryFolder) — 저장 때 따로 묻지 않는다.
// 저장은 이미 끝났으니 결말("file"|"no-folder"|"no-key"|"failed")만 돌려주고, 이벤트에는 코드만 싣는다.
// no-folder: 폴더를 안 골랐거나 브라우저가 권한을 거둠 / no-key: 계정 키를 기기에서도 서버에서도 얻지 못함(로그아웃·오프라인).
async function exportNote(store,pkg,meta,note){
  try{
    const lk=await libraryKey(store.adapter).catch(()=>null);
    if(!lk){events.emit({stage:"library",level:"warn",code:"LIBRARY_NO_KEY"});return "no-key";}
    const text=await NoteFile.encryptFile({meta,note,crops:await NoteLibrary.cropUrls(store,pkg)},lk.key);
    await LibraryFolder.write(store.adapter,NoteFile.fileName(meta),text,NoteFile.courseFolder(meta));
    return "file";
  }catch(e){
    if(e?.code==="no-folder"||e?.code==="no-permission"){events.emit({stage:"library",level:"warn",code:"LIBRARY_NO_FOLDER"});return "no-folder";}
    events.emit({stage:"library",level:"warn",code:"LIBRARY_EXPORT_FAILED"});return "failed";
  }
}
// 다시 만들기 자료 백업: 기기 패키지 하나(메타·재생성 입력·노트·인식 결과·크롭)를 계정 키로 싸서 보관함 폴더 data/ 에 둔다.
// 재설치·다른 기기에서 폴더를 고르면 restoreMissing 이 되살려 옵션을 바꾼 다시 만들기를 할 수 있다. 실패는 코드만 남기고 노트 저장에 영향을 주지 않는다.
const bytesB64=b=>{let s="";for(let i=0;i<b.length;i+=0x8000)s+=String.fromCharCode.apply(null,b.subarray(i,i+0x8000));return btoa(s);};
const b64Bytes=s=>Uint8Array.from(atob(s),ch=>ch.charCodeAt(0));
async function backupPackage(store,pkg){
  try{
    const lk=await libraryKey(store.adapter).catch(()=>null),data=lk&&await NoteLibrary.load(store,pkg);
    if(!data)return false;
    const crops=Object.fromEntries(Object.entries(await NoteLibrary.crops(store,pkg)).map(([id,b])=>[id,bytesB64(b)]));
    await LibraryFolder.writeFile(store.adapter,LibraryFolder.dataPath(pkg),await NoteFile.encryptData({meta:data.meta,input:data.input??null,note:data.note??null,recognition:data.recognition??null,crops},lk.key));
    return true;
  }catch(e){if(!["no-folder","no-permission"].includes(e?.code))events.emit({stage:"library",level:"warn",code:"LIBRARY_BACKUP_FAILED"});return false;}
}
// 폴더의 백업 중 이 기기에 없는 패키지만 되살린다(있는 것은 기기 쪽이 최신이라 건드리지 않는다). 다른 계정 백업은 열리지 않아 건너뛴다.
async function restoreMissing(store){
  const lk=await libraryKey(store.adapter).catch(()=>null);
  if(!lk)return 0;
  let restored=0;
  for(const path of await LibraryFolder.listData(store.adapter).catch(()=>[])){
    try{
      const d=await NoteFile.decryptData(await LibraryFolder.readFile(store.adapter,path),lk.key),pkg=d.meta.packageId;
      if(await NoteLibrary.load(store,pkg).catch(()=>null))continue;
      await NoteLibrary.saveResult(store,{packageId:pkg,meta:d.meta,input:d.input??undefined,note:d.note,recognition:d.recognition??undefined,crops:Object.fromEntries(Object.entries(d.crops).map(([id,v])=>[id,b64Bytes(v)]))});
      restored++;
    }catch{events.emit({stage:"library",level:"warn",code:"LIBRARY_RESTORE_SKIPPED"});}
  }
  return restored;
}
// saveLibrary 의 반환값은 넷("file"|"no-folder"|"no-key"|"failed")만 의미 있다 — 노트를 지키며 건너뛴 false 나 저장만 한 경우는 null 로 본다.
const savedResult=v=>["file","no-folder","no-key","failed"].includes(v)?v:null;
// 끝난 노트(또는 인식 결과만)를 로컬 보관함에 둔다: 메타·재생성 입력·노트·크롭(F#·G# 키로 옮김). 강의 내용은 기기 안 암호문으로만 남는다.
async function saveLibrary(pkg,input,res,{source,host}){
  const store=await storeP,crops={},note=res.note||null;
  // saveResult 는 note==null 을 삭제로 읽는다 — 노트 없는 결과(인식만·재실행)로 저장 노트를 지우지 않는다. 재생성은 앞에서 이미 거절하고, 여기는 백그라운드·실시간 경로의 마지막 방어다.
  if(!note&&(await NoteLibrary.load(store,pkg).catch(()=>null))?.note){events.emit({stage:"library",level:"warn",code:"LIBRARY_NOTE_KEPT"});return false;}
  for(const [id,key] of Object.entries(res.cropMap||{})){const b=await store.getBytes("blobs",`${pkg}:c:${key.replace(/[^A-Za-z0-9_.:-]/g,"_")}`).catch(()=>null);if(b)crops[id]=b;}
  const questions=note?note.sections.flatMap(s=>s.blocks).filter(b=>b.type==="B14").reduce((n,b)=>n+b.content.items.length,0):0;
  const meta=await NoteLibrary.saveResult(store,{packageId:pkg,input,note,crops,recognition:res.recognition??null,meta:{packageId:pkg,title:input.meta?.title??null,course:input.meta?.course??null,host,source,tier:input.tier,
    status:res.status==="recognition-only"?"recognition-only":note?.status||"partial",durationSec:note?Math.max(0,note.meta.processed.t1-note.meta.processed.t0):null,
    noteSpecVersion:note?.noteSpecVersion??null,options:{...NoteContract.policyOf(input.options),exam:false},counts:note?{sections:note.sections.length,questions}:null}});
  await backupPackage(store,pkg);
  return note?await exportNote(store,pkg,meta,note):null;
}
// 실시간 세션 → runNote 입력(Free 와 유료의 실시간 모드). 슬라이드 t1 은 다음 슬라이드의 시작이고, 발화는 기기 Whisper 의 근거 항목에서 만든다(화자 없음).
// ponytail: 탐색(epoch)이 바뀌어도 시각을 그대로 쓴다 — 앞뒤로 옮겨 다니며 본 강의는 시각이 겹칠 수 있다. 필요하면 epoch 마다 이어 붙인다.
function liveInput(cur,{tier,models,consent,options}){
  const docs=[...(cur.slideDocs||[])].sort((a,b)=>a.t0-b.t0),lang=cur.options.whisperLang==="en"?"en":"ko";
  const asr=cur.store.snapshot().filter(e=>e.source==="asr"&&String(e.text||"").trim());
  return {
    slides:docs.map((d,i)=>({...d,t1:Math.max(d.t0,docs[i+1]?.t0??d.t1??d.t0)})),
    transcript:{schemaVersion:1,engine:"whisper",model:String(cur.options.whisperModel||"local").slice(0,64),lang,
      segments:asr.map((e,i)=>({id:"a"+(i+1),t0:e.t0,t1:Math.max(e.t0,e.t1??e.t0),text:String(e.text).slice(0,4000),words:[],noSpeechProb:null,avgLogprob:null,compressionRatio:null,status:"kept"}))},
    gaps:cur.gaps||[],tier,models,consent,recognition:"local",options,meta:{title:typeof cur.options.pageTitle==="string"&&cur.options.pageTitle.trim()?cur.options.pageTitle.trim().slice(0,120):null,course:typeof cur.options.course==="string"&&cur.options.course.trim()?cur.options.course.trim().slice(0,40):null,lang},
    host:hostOf(cur.options.pageUrl),
  };
}
// 진행: 이 작업의 이벤트에서 단계 이름과 끝난 개수만 모아 1초에 한 번 패널에 민다(주소·시각·내용 없음).
function bgProgress(jobId){
  const counts={};let state="created",timer=null;
  const send=()=>{timer=null;chrome.runtime.sendMessage({target:"panel",type:"BG_PROGRESS",jobId,state,counts:{...counts}}).catch(()=>{});};
  const off=bus.on(e=>{
    if(e.jobId!==jobId)return;
    if(e.stage==="job")state=e.msg?.split(">")[1]?.split(":")[0]||state;
    else if(e.status==="done")counts[e.stage]=(counts[e.stage]||0)+1;
    timer??=setTimeout(send,1000);
  });
  return {stop:()=>{off();clearTimeout(timer);}};
}
// BG_DONE의 본문: 코드·수치·고지 개수뿐이다(res.note는 강의 내용이라 싣지 않는다). 요약 동의가 없어 멈춘 작업(recognition-only)은 사용자 사유의 일시정지로 보인다.
function bgResult(jobId,res){
  const wait=res.status==="recognition-only",code=res.code??(wait?"CONSENT_SUMMARY_REQUIRED":null);
  return {jobId,packageId:res.packageId??null,status:wait?"paused":res.status,code,reason:res.reason??(wait?"user":null),suggest:res.suggest??null,message:Pipeline.CODES[code]?.userMessage??null,saved:res.saved??null,
    stats:res.stats&&{slides:res.stats.slides,chunks:res.stats.chunks,gaps:res.stats.gaps},notices:(res.notices||[]).map(({code,count})=>({code,count:count??null}))};
}
async function bgJob(job,source,settings,me,ctl){
  const base=settings.serviceUrl,token=()=>tokenProvider(settings.appSessionToken,settings.serviceUrl),svc=name=>async o=>ServiceClient[name]({baseUrl:base,token:await token(),...o}),progress=bgProgress(job.jobId);
  // 실험 프로파일(note-profiles.js)이 실행 옵션까지 선언한다 — mis-sol-hai 는 vision=mistral-ocr-4-1·lastFrame 캡처·emphasisSignals.
  // 레지스트리가 없는 모드는 기존 경로 그대로다(프로파일 칸이 없으면 아무것도 바뀌지 않는다).
  const prof=noteModeOf(settings)&&NP?.get(noteModeOf(settings));
  const noteOpts=settingsOf(settings).noteOptions;
  let done;
  try{
    const res=await BackgroundJob.runBackground(job,source,{
      fetch:refererFetch(source.pageUrl),decode:LectureDecode,paint:paintMasks,
      // 강의가 길면 기본 200장을 넘는다. 진짜 상한은 서버의 월 비용 한도다.
      vision:VisionClient.createVisionEngine({baseUrl:base,token,model:prof?.vision??BG_MODELS.vision,maxCalls:Infinity,signal:ctl.signal}),
      // lastFrame 은 사용자 옵션이 아니라 프로파일 칸에서만 파생한다 — noteOpts 에는 그 키가 없다(settings.js 화이트리스트 밖).
      stt:{stt:svc("stt")},settings,features:me,models:{...BG_MODELS,...noteModels(me,settings),judge:BG_MODELS.judge},signal:ctl.signal,crop:cropRegions,cropInk,options:{...noteOpts,...(prof?.lastFrame?{lastFrame:true}:{})},
      // 끝나면(인식 결과만 있어도) 로컬 보관함에 둔다. 저장 실패는 노트를 잃게 하지 않도록 코드만 남기고 결말은 그대로 알린다.
      runNote:async(j,input,o)=>{
        noteModelsEvent(j.jobId,input?.models,noteModeOf(settings));
        const stats={hits:0,misses:0};
        const res=await NoteStages.runNote(j,input,{...o,service:{plan:svc("plan"),write:svc("write"),judge:svc("judge")},katex,promptVersions:me?.promptVersions??null,cacheStats:stats,linkEditor:me?.config?.linkEditor===true,writer:me?.config?.noteWriter,noteMode:noteModeOf(settings),noteV3:settings?.devNoteV3,emphasisSignals:prof?.emphasisSignals===true});
        try{await ServiceClient.reportRun({baseUrl:base,token:await token(),jobId:j.jobId,cacheHits:stats.hits,cacheMisses:stats.misses,rerun:input?.rerun??0});}catch{}
        // inkImages(Blob)는 메모리 근거다 — JSON 저장하면 {} 가 되어 재생성을 깨고, 픽셀 저장은 저장 금지 규칙에도 어긋난다. 저장본에서 뗀다.
        const storable={...input,slides:(input.slides??[]).map(s=>s?.inkImages?{...s,inkImages:undefined}:s)};
        const saved=["complete","partial","recognition-only"].includes(res.status)?await saveLibrary(j.packageId,storable,res,{source:"background",host:hostOf(source.pageUrl)}).catch(()=>events.emit({stage:"library",jobId:j.jobId,level:"warn",code:"LIBRARY_SAVE_FAILED"})):null;
        return {...res,packageId:j.packageId,saved:savedResult(saved)};
      },
    });
    done=bgResult(job.jobId,res);
  }catch(error){authEvent(error,{jobId:job.jobId});done={jobId:job.jobId,status:"failed",code:Pipeline.codeOf(error,"SRC")||"UNKNOWN",saved:null};} // 코드 없는 오류(버그)도 체크포인트는 마지막 정상 상태에 남아 BG_LIST에서 이어 갈 수 있다
  finally{await globalThis.Figures?.cropOcrDispose?.().catch(()=>{});bg=null;progress.stop();} // runBackground 가 settle되면 크롭 작업은 다 끝났다 — 재사용한 로컬 OCR 엔진 해제를 기다린 뒤 자리를 비워 다음 BG_RUN이 해제 중인 엔진과 엇갈리지 않게 한다
  chrome.runtime.sendMessage({target:"background",type:"BG_DONE",...done}).catch(()=>{});
  writeJobDiag(job.jobId); // 기다리지 않는다
}
// 작업이 끝날 때마다(성공·실패·멈춤) 그 작업의 진단 기록을 보관함 폴더 diagnostics/ 에 남긴다(폴더를 못 쓰면 Downloads/Summrizei/diagnostics/) — 문의할 때 따로 내보내지 않고 바로 첨부하게.
// 이벤트는 처음부터 내용 없는 코드·수치뿐이다(§10). 계정·환경 정보는 넣지 않는다 — 그건 설정의 "진단 내보내기"가 사용자가 누를 때만 모은다.
async function writeJobDiag(jobId){
  try{
    await sink?.flush();
    const evs=(await (await storeP).readLogs()).filter(e=>e.jobId===jobId);
    if(!evs.length)return;
    const bundle=Diagnostics.exportBundle(evs,{version:await versionP});
    const text=JSON.stringify(bundle,null,2),day=new Date().toISOString().slice(0,10);
    try{await LibraryFolder.writeFile((await storeP).adapter,`diagnostics/summrizei-diagnostic-${day}-${jobId}.json`,text);return;}
    catch(e){if(!["no-folder","no-permission"].includes(e?.code))throw e;}
    await chrome.runtime.sendMessage({target:"background",type:"DIAG_EXPORT",jobId,text});
  }catch{events.emit({stage:"library",jobId,level:"warn",code:"DIAG_EXPORT_FAILED"});}
}
// 보관함 패키지의 저장 입력으로 노트를 다시 만든다(옵션 변경·인식만 끝난 강의의 노트화). background.js만 부를 수 있다(BG_*와 같다).
// 원본 프레임은 없으니 크롭을 새로 자르지 않는다: input 의 figureData/formulaCrops 가 가리키는 `<pkg>:c:*` 블롭이 남아 있고,
// saveLibrary 가 runNote 의 cropMap 대로 그 바이트를 `<pkg>:crop:<F#|G#>` 로 다시 옮긴다. 동의·요금제는 설정이 아니라 서비스가 정한다.
async function libRegenerate(message,settings){
  if(starting||archiveBusy||summaryController||bg||session&&!["completed","failed","disposed"].includes(session.status))return {ok:false,busy:true,error:"다른 처리가 진행 중입니다. 끝난 뒤 다시 시도하세요."};
  const store=await storeP,data=await NoteLibrary.load(store,message.packageId).catch(()=>null);
  if(!data?.input)return {ok:false,error:"다시 만들 자료가 없습니다."};
  if(settingsOf(settings).remoteSummaryConsent!==true)return {ok:false,error:"외부 요약 처리 동의가 필요합니다. 설정에서 동의한 뒤 다시 시도하세요."};
  archiveBusy=true; // 지우기·새 작업·실시간 캡처와 같은 자리를 잡아 다시 만드는 동안 끼어들지 못하게 한다
  try{
    const svc=noteService(settings),me=await svc.me(),options=message.options||{};
    const paid=(me.features||[]).includes("background");
    if((options.syntheticExamples||options.externalAugmentation)&&!paid)return {ok:false,error:"가상 사례·강의 밖 보강은 유료 기능입니다."};
    // '새로 만들기'는 명시적 generation revision(rerun)을 올린다 — 저장 입력의 번호 다음. 계획·판정은 재사용하고
    // 쓰기 이후 단계 캐시 키가 갈리며, 성공한 호출은 호출 캐시에서, 실패했던 호출만 새 requestId 로 다시 나간다.
    const input={...data.input,models:noteModels(me,settings),consent:{...data.input.consent,summary:true},options:paid?options:{},host:data.meta.host,rerun:(data.input.rerun||0)+1};
    const job=await Pipeline.createJob({jobId:`regen-${message.packageId}-${Date.now().toString(36)}`.replace(/[^A-Za-z0-9-]/g,"").slice(0,64),packageId:message.packageId,store,events});
    const stats={hits:0,misses:0};
    noteModelsEvent(job.jobId,input.models,noteModeOf(settings));
    const res=await NoteStages.runNote(job,input,svc.deps(new AbortController().signal,me,stats));
    await svc.report(job.jobId,input.rerun,stats);
    if(!["complete","partial","recognition-only"].includes(res.status)||data.note&&!res.note) // 노트 없이 끝나면 덮어쓰지 않는다 — 저장하면 기존 노트가 지워진다
      return {ok:false,code:res.code??null,error:Pipeline.CODES[res.code]?.userMessage||"다시 만들지 못했습니다."};
    const saved=await saveLibrary(message.packageId,input,res,{source:data.meta.source,host:data.meta.host});
    return {ok:true,status:res.status,code:res.code??null,saved:savedResult(saved)};
  }finally{archiveBusy=false;}
}
// 보관함의 저장 노트를 암호 파일로 전부 다시 폴더에 쓴다(폴더를 새로 골랐거나 권한을 다시 허용했을 때). 키가 없으면 시작하지 않는다.
async function libExportAll(){
  if(starting||archiveBusy||summaryController||bg||session&&!["completed","failed","disposed"].includes(session.status))return {ok:false,busy:true,error:"다른 처리가 진행 중입니다. 끝난 뒤 다시 시도하세요."};
  const store=await storeP;
  if(!await libraryKey(store.adapter).catch(()=>null))return {ok:false,error:"보관함 키가 없습니다. 로그인한 뒤 다시 시도하세요."};
  let count=0,failed=0,restored=0;archiveBusy=true; // 내보내는 동안 지우기·새 작업이 끼어들지 못하게 한다
  try{
    restored=await restoreMissing(store); // 새로 고른 폴더(재설치·다른 기기)의 백업부터 되살린다
    for(const meta of await NoteLibrary.list(store)){
      await backupPackage(store,meta.packageId);
      const data=await NoteLibrary.load(store,meta.packageId).catch(()=>null);
      if(!data?.note)continue;
      if(await exportNote(store,meta.packageId,meta,data.note)==="file")count++;else failed++;
    }
  }finally{archiveBusy=false;}
  return {ok:true,count,failed,restored};
}
async function bgList(settings){
  const store=await storeP,jobs=[];
  for(const id of await store.ids("jobs")){
    const r=await store.getJson("jobs",id).catch(()=>null);
    if(r&&!["done","cancelled"].includes(r.state))jobs.push({jobId:id,state:r.state,code:r.code??null,running:bg?.jobId===id}); // 실패한 작업도 이어 할 수 있으니 싣는다 — 완료·취소만 숨긴다
  }
  // 요금제는 서버만 안다. 확인하지 못하면(로그아웃·오프라인) 백그라운드 처리를 보여 주지 않는다.
  const me=await bgMe(settings).catch(()=>null);
  return {ok:true,background:Array.isArray(me?.features)&&me.features.includes("background"),jobs};
}
async function bgMessage(message,sender){
  if(!trusted(sender,["/background.js"]))throw new Error("허용되지 않은 요청입니다.");
  if(message.type==="BG_CANCEL"){bg?.ctl.abort();return {ok:true};}
  // 노트를 시작하는 요청에 설정 묶음이 없으면 devNoteMode·devWriteModel이 기본값으로 떨어져 다른 모델이 조용히 돈다 — 시작하지 않고 닫는다.
  if((message.type==="BG_RUN"||message.type==="LIB_REGENERATE")&&(!message.settings||typeof message.settings!=="object"||Array.isArray(message.settings))){
    events.emit({stage:"job",...(typeof message.jobId==="string"?{jobId:message.jobId}:{}),level:"error",code:"NOTE_SETTINGS_MISSING"});
    return {ok:false,error:"설정을 읽지 못해 노트 작업을 시작하지 않았습니다."};
  }
  const settings=message.settings||{};
  if(message.type==="LIB_REGENERATE")return libRegenerate(message,settings);
  if(message.type==="LIB_EXPORT_ALL")return libExportAll();
  // 웹 /library 가 확장을 거쳐 보관함 폴더를 읽는다(background 가 사이트 탭인지 확인한 뒤 보낸다). 암호문만 돌려준다.
  if(message.type==="LIB_FILES"){
    const adapter=(await storeP).adapter;
    try{return message.op==="list"?{ok:true,...await LibraryFolder.list(adapter)}:{ok:true,text:await LibraryFolder.read(adapter,message.name)};}
    catch(e){return {ok:false,code:["no-folder","no-permission"].includes(e?.code)?e.code:"failed"};}
  }
  if(message.type==="BG_DISCARD"){
    const{jobId}=message;
    if(typeof jobId!=="string"||!/^[A-Za-z0-9][A-Za-z0-9-]{7,63}$/.test(jobId))throw new Error("작업 번호가 올바르지 않습니다.");
    if(bg?.jobId===jobId)return {ok:false,error:"진행 중인 작업은 먼저 취소하세요."};
    await (await storeP).adapter.delete("jobs",jobId);return {ok:true};
  }
  if(message.type==="BG_LIST")return bgList(settings);
  if(message.type!=="BG_RUN")throw new Error("알 수 없는 요청입니다.");
  if(bg)return {ok:false,busy:true,error:"이미 백그라운드 작업이 진행 중입니다. 끝난 뒤 다시 시도하세요."};
  if(starting||archiveBusy||summaryController||session&&!["completed","failed","disposed"].includes(session.status))throw new Error("실시간 캡처나 보관 작업을 먼저 마쳐 주세요.");
  const {jobId,source}=message;
  if(!/^[A-Za-z0-9][A-Za-z0-9-]{7,63}$/.test(jobId)||!/^https?:\/\//i.test(source?.playlistUrl)||!/^https?:\/\//i.test(source?.pageUrl))throw new Error("백그라운드 처리 요청이 올바르지 않습니다.");
  const ctl=new AbortController();bg={jobId,ctl};
  try{
    const store=await storeP,found=await Pipeline.loadJob(jobId,store,{events});
    if(found?.state==="done"){
      // 이미 노트까지 만든 강의다 — 다시 돌리지 않고, 저장된 노트가 있으면 끝난 작업처럼 파일도 다시 내보낸 뒤 결말만 알린다.
      bg=null;
      const data=await NoteLibrary.load(store,found.packageId).catch(()=>null);
      const res={status:data?.note?"done":data?.recognition?"recognition-only":"done",packageId:found.packageId,
        saved:data?.note?savedResult(await exportNote(store,found.packageId,data.meta,data.note)):null};
      await chrome.runtime.sendMessage({target:"background",type:"BG_DONE",...bgResult(jobId,res)}).catch(()=>{});
      return {ok:true,already:true,state:"done"};
    }
    const me=await bgMe(settings,ctl.signal);
    if(found?.state==="failed"||found?.state==="cancelled")await found.reopen(); // 끝난 작업을 기록된 단계로 되돌린다 — 앞서 끝난 단계는 패키지 캐시가 메운다
    const job=found??await Pipeline.createJob({jobId,store,events}); // 같은 번호면 이어서 한다(멈춘 작업은 runBackground가 resume 한다)
    bgJob(job,source,settings,me,ctl); // 기다리지 않는다: 결말은 BG_DONE으로 간다
    return {ok:true,...(found?{already:true,state:job.state}:{})};
  }catch(error){bg=null;throw error;}
}
// ── 로컬 데이터 관리(options.html "데이터 관리" 카드) ──
// 기기 키는 이 문서의 저장소 객체가 메모리에 쥐고 있고 로그 싱크와 백그라운드 작업도 그 객체를 쓴다. 그래서 삭제·열람은 options가 아니라 여기서 한다:
// wipe()가 이 객체의 key를 새 키로 바꾸므로 옛 키는 어디에도 남지 않고, 싱크를 먼저 멈춰 삭제 뒤에 늦은 쓰기가 끼어들지 못한다. background.js만 보낼 수 있다(BG_*와 같다).
async function localData(message,sender){
  if(!trusted(sender,["/background.js"]))throw new Error("허용되지 않은 요청입니다.");
  const store=await storeP;
  if(message.type==="LOGS_READ"){await sink?.flush();return {ok:true,events:await store.readLogs()};}
  if(message.type==="LOGS_CLEAR"){await sink?.flush();await store.adapter.clear("logs");return {ok:true};}
  if(starting||archiveBusy||summaryController||bg||session&&!["completed","failed","disposed"].includes(session.status))throw new Error("캡처나 백그라운드 작업이 진행 중입니다. 끝난 뒤 다시 시도하세요.");
  if(message.dryRun)return {ok:true}; // 계정 삭제가 서버를 지우기 전에 이 기기를 지울 수 있는지만 본다
  archiveBusy=true; // 지우는 동안 새 캡처·작업·보관이 끼어들지 못하게 보관 작업 자리를 쓴다
  try{await sink?.dispose();await store.wipe();sink=new PipelineEvents.LogSink(bus,store);await sink.start();}
  finally{archiveBusy=false;}
  return {ok:true};
}
// 패널이 잰 로그인 단계별 시간. 이 한 모양(stage:"login", code:"LOGIN_TIMING")만 버스에 싣는다 — 단계 이름과 ms뿐이라 토큰·계정 값은 구조적으로 실릴 수 없다.
async function diagEvent(e){
  const msg=e?.msg;
  if(e?.stage!=="login"||e?.code!=="LOGIN_TIMING"||!Number.isFinite(e?.ms)||e.ms<0||e.ms>600000||typeof msg!=="string"||!/^[a-z_ ]{0,80}$/.test(msg))return {ok:false};
  await storeP.catch(()=>{}); // 로그 싱크가 붙은 뒤에 실어 암호화 로그에도 남는다
  events.emit({stage:"login",code:"LOGIN_TIMING",ms:e.ms,msg});
  return {ok:true};
}
chrome.runtime.onConnect.addListener(port=>{
  if(port.name!=="admin-events")return;
  let ok=false;
  try{const url=new URL(port.sender.url),base=new URL(chrome.runtime.getURL(""));ok=port.sender.id===chrome.runtime.id&&url.protocol===base.protocol&&url.host===base.host&&url.pathname==="/admin.html";}catch{}
  if(!ok){port.disconnect();return;}
  port.postMessage({type:"snapshot",events:bus.recent()});
  const off=bus.on(event=>{try{port.postMessage({type:"event",event});}catch{}});
  port.onDisconnect.addListener(off);
});
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if(message?.target!=="session")return;
  if(message.type==="MEDIA_METADATA"){
    if(sender.id===chrome.runtime.id&&sender.tab?.id===session?.options.tabId&&sender.frameId===session?.options.watchFrameId&&message.sessionId===session.id&&!session.closed){session.updateMetadata(message.metadata);reply({ok:true});}
    else reply({ok:false});
    return;
  }
  if(message.type==="FRAME_BOX"){
    if(sender.id===chrome.runtime.id&&sender.tab?.id===session?.options.tabId&&sender.frameId===0&&message.sessionId===session?.id&&!session.closed){session.updateFrameBox(message.box);reply({ok:true});}
    else reply({ok:false});
    return;
  }
  if(!trusted(sender)){reply({ok:false,error:"허용되지 않은 요청입니다."});return;}
  (async()=>{
    if(message.type==="DIAG_EVENT")return diagEvent(message.event);
    if(String(message.type).startsWith("BG_")||["LIB_REGENERATE","LIB_EXPORT_ALL","LIB_FILES"].includes(message.type))return bgMessage(message,sender);
    if(message.type==="GET_STATE")return {ok:true,state:session?.state()||null};
    if(message.type==="TAB_GONE"){
      if(message.tabId===session?.options.tabId&&!session.closed)await session.fail("강의 탭이 닫히거나 이동하여 인식을 중단했습니다.");
      return {ok:true,state:session?.state()||null};
    }
    if(["WIPE_LOCAL","LOGS_READ","LOGS_CLEAR"].includes(message.type))return localData(message,sender);
    if(message.type==="START_SESSION"){
      if(starting||archiveBusy||summaryController||bg)throw new Error("현재 작업이 끝난 뒤 다시 시작하세요.");
      if(session&&!["completed","failed","disposed"].includes(session.status))throw new Error("현재 세션을 먼저 중지하세요.");
      starting=true;
      try{
        const source={mandatory:{chromeMediaSource:"tab",chromeMediaSourceId:message.streamId}};
        const stream=await navigator.mediaDevices.getUserMedia({audio:source,video:source});
        await session?.dispose();
        const config=settingsOf(message.settings);
        // 고화질 화면 인식과 서버 인식(recognition:"cloud")만 서비스를 쓴다. 시작 때 한 번 풀어 연결·요금제·동의를 확인하고(오류는 여기서 드러난다), 인식은 장면마다 getToken으로 새로 받는다 - 1시간 넘는 강의에서도 만료되지 않는다.
        const options={...message.options,serviceUrl:config.serviceUrl,appSessionToken:config.appSessionToken,getToken:()=>tokenProvider(config.appSessionToken,config.serviceUrl)};
        try{
          if(options.recognition==="cloud"){
            options.appSessionToken=await tokenProvider(config.appSessionToken,config.serviceUrl);
            const me=await ServiceClient.me({baseUrl:config.serviceUrl,token:options.appSessionToken,timeoutMs:15000}),features=me?.features||[];
            if(!features.includes("vision")||!features.includes("stt"))throw Object.assign(new Error("현재 플랜은 서버 인식을 쓸 수 없습니다."),{code:"PLAN_NO_CLOUD"});
            if(globalThis.cloudRecognitionAllowed?.(message.settings)!==true)throw Object.assign(new Error("클라우드 인식 동의가 필요합니다."),{code:"CONSENT_CLOUD_REQUIRED"});
            Object.assign(options,{ocrEngine:"vision-cloud",ocrEnabled:true,whisperEnabled:true,sttEngine:"cloud",sttModel:BG_MODELS.stt,visionModel:BG_MODELS.vision});
          }else{
            if(options.ocrEngine==="vision-cloud")options.appSessionToken=await tokenProvider(config.appSessionToken,config.serviceUrl);
            options.sttEngine="local";
          }
        }catch(error){for(const track of stream.getTracks())track.stop();throw error;}
        session=new CaptureSession({id:options.sessionId||crypto.randomUUID(),generation:++generation,stream,options,emit,events});
        session.publish();await session.start();
        return {ok:true,state:session.state()};
      }finally{starting=false;}
    }
    if(archiveBusy)throw new Error("보관 작업이 끝난 뒤 다시 시도하세요.");
    if(!session)throw new Error("활성 세션이 없습니다.");
    if(message.sessionId&&message.sessionId!==session.id||message.generation!==undefined&&message.generation!==session.generation)throw new Error("이전 세션 요청입니다.");
    if(message.type==="CANCEL_SUMMARY"){summaryController?.abort();return {ok:true,state:session.state()};}
    if(summaryController)throw new Error("요약을 취소하거나 완료한 뒤 다시 시도하세요.");
    if(message.type==="STOP_SESSION")return {ok:true,state:await session.stop()};
    if(message.type==="DISPOSE_SESSION"){if(archiveBusy)throw new Error("보관 작업 중입니다.");return {ok:true,state:await session.dispose()};}
    if(message.type==="PAUSE_SESSION"){session.pause();return {ok:true,state:session.state()};}
    if(message.type==="RESUME_SESSION"){session.resume();return {ok:true,state:session.state()};}
    if(message.type==="GENERATE_NOTES"){
      if(!["completed","failed"].includes(session.status))throw new Error("캡처 처리를 마친 뒤 요약하세요.");
      if(!message.settings||typeof message.settings!=="object"||Array.isArray(message.settings)){events.emit({stage:"job",jobId:session.id,level:"error",code:"NOTE_SETTINGS_MISSING"});throw new Error("설정을 읽지 못해 요약을 시작하지 않았습니다.");}
      const current=session;summaryController=new AbortController();current.status="summarizing";current.error=null;current.errorCode=null;current.publish();
      current.summaryAttempt=(current.summaryAttempt||0)+1;
      const span=events.span({stage:"summary",jobId:current.id});
      try{
        // v2 단계(lib/stages.js): 인식은 이미 기기에서 끝났다(recognition local). 서버는 계획·작성만 하고, 월 분 한도는 계획 요청이 센다.
        const config=settingsOf(message.settings),svc=noteService(message.settings);
        const me=await svc.me(summaryController.signal);
        const paid=(me.features||[]).includes("background"),store=await storeP,pkg=current.packageId||=NoteLibrary.packageIdFor({});
        const job=await Pipeline.createJob({jobId:`live-${current.id}-${current.summaryAttempt}`.replace(/[^A-Za-z0-9-]/g,"").slice(0,64),packageId:pkg,store,events});
        // 요약을 다시 누른 것은 새로 만들기다 — rerun 을 올려 쓰기 이후 단계를 다시 돌리고, 성공한 호출은 호출 캐시가 메운다.
        const input={...liveInput(current,{tier:paid?"paid":"free",models:noteModels(me,message.settings),consent:{summary:config.remoteSummaryConsent},options:paid?config.noteOptions:{}}),rerun:current.summaryAttempt-1};
        current.log(`[요약] v2 · ${paid?"유료":"Free"} · 슬라이드 ${input.slides.length} · 발화 ${input.transcript.segments.length} · 동의 ${config.remoteSummaryConsent?"완료":"미확인"}`);
        const stats={hits:0,misses:0};
        noteModelsEvent(job.jobId,input.models,noteModeOf(message.settings));
        const res=await NoteStages.runNote(job,input,svc.deps(summaryController.signal,me,stats));
        await svc.report(job.jobId,input.rerun,stats);
        if(!["complete","partial","recognition-only"].includes(res.status))throw Object.assign(new Error(Pipeline.CODES[res.code]?.userMessage||"요약을 마치지 못했습니다."),{code:res.code});
        const saved=await saveLibrary(pkg,input,res,{source:"live",host:hostOf(current.options.pageUrl)});
        current.summary={version:2,packageId:pkg,status:res.status,note:res.note??null,recognition:res.recognition??null,notices:res.notices??[],saved:savedResult(saved)};
        span.done();
      }catch(error){const auth=authEvent(error,{jobId:current.id});if(auth)current.log(auth);current.error=error.name==="AbortError"?"요약을 취소했습니다. 완료한 호출은 다시 요약할 때 재사용됩니다.":error.message;current.errorCode=error.name==="AbortError"||typeof error.code!=="string"?null:error.code;if(error.name==="AbortError")span.skip({msg:"cancelled"});else span.fail(error.code||"SUMMARY_FAILED");}
      finally{summaryController=null;current.status="completed";current.progress=null;current.publish();}
      return {ok:!current.error,state:current.state(),error:current.error,...(current.errorCode?{code:current.errorCode}:{})};
    }
    throw new Error("알 수 없는 요청입니다.");
  })().then(reply).catch(error=>{authEvent(error);reply({ok:false,error:error.message||"처리를 완료하지 못했습니다.",...(typeof error?.code==="string"?{code:error.code}:{})});});
  return true;
});
