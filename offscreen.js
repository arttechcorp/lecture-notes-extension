// One in-memory session and archive encryption boundary.
let session=null,generation=0,starting=false,summaryController=null,archiveBusy=false;
// 파이프라인 진단 이벤트: 한 버스를 어드민(실시간 포트)과 암호화 로컬 로그가 함께 구독한다. 파이프라인에는 예외를 삼키는 safe 껍데기만 넘긴다.
const bus=new PipelineEvents.EventBus(),events=PipelineEvents.safe(bus);
PackageStore.indexedDbAdapter().then(PackageStore.createStore).then(store=>new PipelineEvents.LogSink(bus,store).start()).catch(()=>events.emit({stage:"system",level:"warn",code:"LOG_STORE_UNAVAILABLE"}));
const emit=state=>chrome.runtime.sendMessage({target:"panel",type:"SESSION_STATE",state}).catch(()=>{});
const trusted=sender=>{try{const url=new URL(sender.url),base=new URL(chrome.runtime.getURL(""));return sender.id===chrome.runtime.id&&url.protocol===base.protocol&&url.host===base.host&&["/background.js","/sidepanel.html","/options.html"].includes(url.pathname);}catch{return false;}};
const settingsOf=s=>({openRouterApiKey:String(s?.openRouterApiKey||""),serviceUrl:String(s?.serviceUrl||""),appSessionToken:String(s?.appSessionToken||""),summaryModel:String(s?.summaryModel||""),remoteSummaryConsent:s?.remoteSummaryConsent===true});
// 서비스 호출 직전에 쓸 토큰을 정한다. offscreen에는 chrome.storage가 없어 background에 묻는다: 로그인 토큰(만료 전 갱신됨)을 우선하고, 로그아웃 상태면 설정의 개발용 정적 토큰(fallback)을 쓴다. 갱신 실패 같은 오류는 조용히 넘기지 않고 그대로 올린다.
const tokenProvider=async fallback=>{
  const reply=await chrome.runtime.sendMessage({target:"background",type:"AUTH_TOKEN"}).catch(()=>null);
  if(reply?.ok===false)throw new Error(reply.error||"로그인 정보를 확인하지 못했습니다.");
  return typeof reply?.token==="string"&&reply.token?reply.token:String(fallback||"");
};
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
    if(message.type==="GET_STATE")return {ok:true,state:session?.state()||null};
    if(message.type==="TAB_GONE"){
      if(message.tabId===session?.options.tabId&&!session.closed)await session.fail("강의 탭이 닫히거나 이동하여 인식을 중단했습니다.");
      return {ok:true,state:session?.state()||null};
    }
    if(["SAVE_VAULT","LOAD_VAULT","LIST_VAULT","DELETE_VAULT"].includes(message.type))return archive(message);
    if(message.type==="START_SESSION"){
      if(starting||archiveBusy||summaryController)throw new Error("현재 작업이 끝난 뒤 다시 시작하세요.");
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
