// One in-memory session and archive encryption boundary.
let session=null,generation=0,starting=false,summaryController=null,archiveBusy=false,bg=null,sink=null; // bg: 실행 중인 백그라운드 작업 {jobId,ctl} — 한 번에 하나
// 파이프라인 진단 이벤트: 한 버스를 어드민(실시간 포트)과 암호화 로컬 로그가 함께 구독한다. 파이프라인에는 예외를 삼키는 safe 껍데기만 넘긴다.
const bus=new PipelineEvents.EventBus(),events=PipelineEvents.safe(bus);
const storeP=PackageStore.indexedDbAdapter().then(PackageStore.createStore); // 로그와 백그라운드 작업이 한 암호화 저장소를 나눠 쓴다
storeP.then(store=>(sink=new PipelineEvents.LogSink(bus,store)).start()).catch(()=>events.emit({stage:"system",level:"warn",code:"LOG_STORE_UNAVAILABLE"}));
const emit=state=>chrome.runtime.sendMessage({target:"panel",type:"SESSION_STATE",state}).catch(()=>{});
const trusted=(sender,pages=["/background.js","/sidepanel.html","/options.html"])=>{try{const url=new URL(sender.url),base=new URL(chrome.runtime.getURL(""));return sender.id===chrome.runtime.id&&url.protocol===base.protocol&&url.host===base.host&&pages.includes(url.pathname);}catch{return false;}};
const settingsOf=s=>({openRouterApiKey:String(s?.openRouterApiKey||""),serviceUrl:String(s?.serviceUrl||""),appSessionToken:String(s?.appSessionToken||""),summaryModel:String(s?.summaryModel||""),remoteSummaryConsent:s?.remoteSummaryConsent===true});
// 서비스 호출 직전에 쓸 토큰을 정한다. offscreen에는 chrome.storage가 없어 background에 묻는다: 로그인 토큰(만료 전 갱신됨)을 우선하고, 로그아웃 상태면 설정의 개발용 정적 토큰(fallback)을 쓴다. 갱신 실패 같은 오류는 조용히 넘기지 않고 그대로 올린다.
const tokenProvider=async fallback=>{
  const reply=await chrome.runtime.sendMessage({target:"background",type:"AUTH_TOKEN"}).catch(()=>null);
  if(reply?.ok===false)throw new Error(reply.error||"로그인 정보를 확인하지 못했습니다.");
  return typeof reply?.token==="string"&&reply.token?reply.token:String(fallback||"");
};
// ── 유료 백그라운드 작업(BG_*, docs/architecture-v2.md §5.3, §6.1, §8) ──
// 한 번에 하나. 원본 미디어는 메모리에서만 쓰고 파생물(슬라이드·전사·노트)만 암호화 패키지 저장소에 둔다. 진행은 이벤트 버스에서 단계별 개수만 패널에 밀고, 결말은 BG_DONE으로 background에 알린다
// (background가 절전 방지·Referer 규칙을 풀고 패널에 전한다). BG_RUN·BG_LIST·BG_CANCEL은 background.js만 보낼 수 있다 — 동의 기록과 Referer 출처를 거기서 정하기 때문이다.
// /v1/me는 요약 모델 목록만 알려 주고 인식·판정 모델은 싣지 않아 모델은 여기 한 곳에 둔다. 서버 allowlist(ALLOWED_*_MODELS)와 어긋나면 invalid_model로 멈춘다 — 다른 모델로 조용히 바꾸지 않는다.
// ponytail: 계획·작성 모델은 둘 다 lite다(기본 allowlist에 있는 유일한 모델). 중급 Planner 선정(docs/architecture-v2.md A5)이 끝나면 plan만 바꾼다.
const BG_MODELS={plan:"google/gemini-2.5-flash-lite",write:"google/gemini-2.5-flash-lite",judge:"openai/gpt-4.1-nano",stt:"microsoft/mai-transcribe-2",vision:"google/gemini-2.5-flash-lite"};
const bgMe=async(settings,signal)=>ServiceClient.me({baseUrl:settings.serviceUrl,token:await tokenProvider(settings.appSessionToken),timeoutMs:15000,signal});
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
  return {jobId,status:wait?"paused":res.status,code,reason:res.reason??(wait?"user":null),suggest:res.suggest??null,message:Pipeline.CODES[code]?.userMessage??null,
    stats:res.stats&&{slides:res.stats.slides,chunks:res.stats.chunks,gaps:res.stats.gaps},notices:(res.notices||[]).map(({code,count})=>({code,count:count??null}))};
}
async function bgJob(job,source,settings,me,ctl){
  const base=settings.serviceUrl,token=()=>tokenProvider(settings.appSessionToken),svc=name=>async o=>ServiceClient[name]({baseUrl:base,token:await token(),...o}),progress=bgProgress(job.jobId);
  let done;
  try{
    const res=await BackgroundJob.runBackground(job,source,{
      fetch:refererFetch(source.pageUrl),decode:LectureDecode,paint:paintMasks,
      // 강의가 길면 기본 200장을 넘는다. 진짜 상한은 서버의 월 비용 한도다.
      vision:VisionClient.createVisionEngine({baseUrl:base,token,model:BG_MODELS.vision,maxCalls:Infinity,signal:ctl.signal}),
      stt:{stt:svc("stt")},settings,features:me,models:BG_MODELS,signal:ctl.signal,
      runNote:(j,input,o)=>NoteStages.runNote(j,input,{...o,service:{plan:svc("plan"),write:svc("write"),judge:svc("judge")},katex}),
    });
    done=bgResult(job.jobId,res);
  }catch(error){done={jobId:job.jobId,status:"failed",code:Pipeline.codeOf(error,"SRC")||"UNKNOWN"};} // 코드 없는 오류(버그)도 체크포인트는 마지막 정상 상태에 남아 BG_LIST에서 이어 갈 수 있다
  finally{bg=null;progress.stop();}
  chrome.runtime.sendMessage({target:"background",type:"BG_DONE",...done}).catch(()=>{});
}
async function bgList(settings){
  const store=await storeP,jobs=[];
  for(const id of await store.ids("jobs")){
    const r=await store.getJson("jobs",id).catch(()=>null);
    if(r&&!["done","failed","cancelled"].includes(r.state))jobs.push({jobId:id,state:r.state,code:r.code??null,running:bg?.jobId===id});
  }
  // 요금제는 서버만 안다. 확인하지 못하면(로그아웃·오프라인) 백그라운드 처리를 보여 주지 않는다.
  const me=await bgMe(settings).catch(()=>null);
  return {ok:true,background:Array.isArray(me?.features)&&me.features.includes("background"),jobs};
}
async function bgMessage(message,sender){
  if(!trusted(sender,["/background.js"]))throw new Error("허용되지 않은 요청입니다.");
  if(message.type==="BG_CANCEL"){bg?.ctl.abort();return {ok:true};}
  const settings=message.settings||{};
  if(message.type==="BG_LIST")return bgList(settings);
  if(message.type!=="BG_RUN")throw new Error("알 수 없는 요청입니다.");
  if(bg)return {ok:false,busy:true,error:"이미 백그라운드 작업이 진행 중입니다. 끝난 뒤 다시 시도하세요."};
  if(starting||archiveBusy||summaryController||session&&!["completed","failed","disposed"].includes(session.status))throw new Error("실시간 캡처나 보관 작업을 먼저 마쳐 주세요.");
  const {jobId,source}=message;
  if(!/^[A-Za-z0-9][A-Za-z0-9-]{7,63}$/.test(jobId)||!/^https?:\/\//i.test(source?.playlistUrl)||!/^https?:\/\//i.test(source?.pageUrl))throw new Error("백그라운드 처리 요청이 올바르지 않습니다.");
  const ctl=new AbortController();bg={jobId,ctl};
  try{
    const store=await storeP,me=await bgMe(settings,ctl.signal);
    const job=await Pipeline.loadJob(jobId,store,{events})??await Pipeline.createJob({jobId,store,events}); // 같은 번호면 이어서 한다
    bgJob(job,source,settings,me,ctl); // 기다리지 않는다: 결말은 BG_DONE으로 간다
    return {ok:true};
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
chrome.runtime.onConnect.addListener(port=>{
  if(port.name!=="admin-events")return;
  let ok=false;
  try{const url=new URL(port.sender.url),base=new URL(chrome.runtime.getURL(""));ok=port.sender.id===chrome.runtime.id&&url.protocol===base.protocol&&url.host===base.host&&url.pathname==="/admin.html";}catch{}
  if(!ok){port.disconnect();return;}
  port.postMessage({type:"snapshot",events:bus.recent()});
  const off=bus.on(event=>{try{port.postMessage({type:"event",event});}catch{}});
  port.onDisconnect.addListener(off);
});
async function archive(message){
  const span=message.type==="SAVE_VAULT"||message.type==="LOAD_VAULT"?events.span({stage:"vault",jobId:session?.id,unit:message.type==="SAVE_VAULT"?"save":"load"}):null;
  try{const result=await archiveRun(message);span?.done();return result;}
  catch(error){span?.fail("VAULT_FAILED");throw error;}
}
async function archiveRun(message){
  if(archiveBusy||summaryController||session&&!["completed","failed","disposed"].includes(session.status))throw new Error("현재 처리를 먼저 마쳐 주세요.");
  archiveBusy=true;const config=settingsOf(message.settings);
  try{
    const client={baseUrl:config.serviceUrl,token:await tokenProvider(config.appSessionToken)};
    const me=await ServiceClient.me(client);
    if(message.type==="LIST_VAULT")return {ok:true,items:(await ServiceClient.listEncrypted(client)).items};
    const objectId=message.objectId||crypto.randomUUID();
    if(message.type==="DELETE_VAULT"){await ServiceClient.deleteEncrypted({...client,objectId});return {ok:true};}
    const context={accountId:me.accountId,objectId,kind:"session"};
    if(message.type==="SAVE_VAULT"){
      if(!session?.store.items.length)throw new Error("보관할 인식 자료가 없습니다.");
      const decisions=new Map((session.summary?.preprocessing?.decisions||[]).map(item=>[item.id,item]));
      const evidence=session.store.snapshot().map(item=>({...item,...(decisions.get(item.id)||{})}));
      const envelope=await LectureVault.encrypt({version:1,evidence,summary:session.summary||null,gaps:session.gaps},message.passphrase,context);
      await ServiceClient.saveEncrypted({...client,objectId,envelope});
      return {ok:true,objectId,state:session.state()};
    }
    const {envelope}=await ServiceClient.loadEncrypted({...client,objectId});
    const value=await LectureVault.decrypt(envelope,message.passphrase,context);
    if(value?.version!==1)throw new Error("지원하지 않는 보관 문서입니다.");
    const restored=new EvidenceStore();restored.restore(value.evidence);
    const note=value.summary;
    if(note?.sections?.length){
      const summaryEvidence=restored.snapshot().filter(item=>item.selection!=="filtered"&&item.status!=="superseded");
      Object.assign(note,SummaryPipeline.validateSummary(note,summaryEvidence,{requireCoverage:note.status!=="partial",maxItems:2000,maxSections:2000,maxQuestions:2000}));
      note.evidenceRefs=restored.items.map(({id,t0,t1,source,selection,selectionReason,relatedEvidenceIds})=>({id,t0,t1,source,selection,selectionReason,relatedEvidenceIds}));
    }
    else if(note&&note.status!=="recognition-only")throw new Error("보관 노트의 형식을 확인할 수 없습니다.");
    await session?.dispose();
    session=new CaptureSession({id:crypto.randomUUID(),generation:++generation,stream:null,options:{},emit,events});
    session.store=restored;session.summary=note;session.status="completed";session.closed=true;
    session.gaps=Array.isArray(value.gaps)?value.gaps.slice(-200):[];
    session.counts={visual:restored.items.filter(e=>e.source==="ocr").length,audio:restored.items.filter(e=>e.source==="asr").length};
    session.publish();return {ok:true,objectId,state:session.state()};
  }finally{archiveBusy=false;message.passphrase="";}
}
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
    if(String(message.type).startsWith("BG_"))return bgMessage(message,sender);
    if(message.type==="GET_STATE")return {ok:true,state:session?.state()||null};
    if(message.type==="TAB_GONE"){
      if(message.tabId===session?.options.tabId&&!session.closed)await session.fail("강의 탭이 닫히거나 이동하여 인식을 중단했습니다.");
      return {ok:true,state:session?.state()||null};
    }
    if(["SAVE_VAULT","LOAD_VAULT","LIST_VAULT","DELETE_VAULT"].includes(message.type))return archive(message);
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
        // 고화질 화면 인식만 서비스를 쓴다. 시작 때 한 번 풀어 연결 여부를 확인하고(오류는 여기서 드러난다), 인식은 장면마다 getToken으로 새로 받는다 - 1시간 넘는 강의에서도 만료되지 않는다.
        let token=config.appSessionToken;
        if(message.options?.ocrEngine==="vision-cloud"){try{token=await tokenProvider(token);}catch(error){for(const track of stream.getTracks())track.stop();throw error;}}
        const options={...message.options,serviceUrl:config.serviceUrl,appSessionToken:token,getToken:()=>tokenProvider(config.appSessionToken)};
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
      const current=session;summaryController=new AbortController();current.status="summarizing";current.error=null;current.publish();
      current.summaryCache||=new Map();current.summaryAttempt=(current.summaryAttempt||0)+1;
      const span=events.span({stage:"summary",jobId:current.id});
      try{
        const config=settingsOf(message.settings),byok=Boolean(config.openRouterApiKey);
        // 서비스 경로는 청크마다 토큰을 새로 받는다(요약은 몇 분 걸릴 수 있다). 시작 때 한 번 풀어 두는 건 연결 여부 판단용이다.
        if(!byok&&config.serviceUrl)config.appSessionToken=await tokenProvider(config.appSessionToken);
        const summaryService=byok?OpenRouterClient:{summary:async o=>ServiceClient.summary({...o,token:await tokenProvider(o.token)})};
        current.log(`[요약] 연결 확인 · ${config.openRouterApiKey?"OpenRouter API 키 입력됨":config.serviceUrl&&config.appSessionToken?"보관 서비스 설정됨":"연결 설정 없음"} · 동의 ${config.remoteSummaryConsent?"완료":"미확인"} · 모델 ${config.summaryModel||"기본"}`);
        current.summary=await SummaryPipeline.generate(current.store.snapshot(),{sessionId:current.id,gaps:current.gaps,settings:config,service:summaryService,signal:summaryController.signal,cache:current.summaryCache,attempt:current.summaryAttempt,onProgress:progress=>{current.progress=progress;current.publish();}});
        span.done();
      }catch(error){if(error.partial?.sections.length)current.summary=error.partial;current.error=error.name==="AbortError"?"요약을 취소했습니다. 완료한 구간은 유지됩니다.":error.message;if(error.name==="AbortError")span.skip({msg:"cancelled"});else span.fail("SUMMARY_FAILED");}
      finally{summaryController=null;current.status="completed";current.progress=null;current.publish();}
      return {ok:!current.error,state:current.state(),error:current.error};
    }
    throw new Error("알 수 없는 요청입니다.");
  })().then(reply).catch(error=>reply({ok:false,error:error.message||"처리를 완료하지 못했습니다."}));
  return true;
});
