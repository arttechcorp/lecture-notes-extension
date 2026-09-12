// One in-memory session and archive encryption boundary.
let session=null,generation=0,starting=false,summaryController=null,archiveBusy=false;
const emit=state=>chrome.runtime.sendMessage({target:"panel",type:"SESSION_STATE",state}).catch(()=>{});
const trusted=sender=>{try{const url=new URL(sender.url),base=new URL(chrome.runtime.getURL(""));return sender.id===chrome.runtime.id&&url.protocol===base.protocol&&url.host===base.host&&["/background.js","/sidepanel.html","/options.html"].includes(url.pathname);}catch{return false;}};
const settingsOf=s=>({serviceUrl:String(s?.serviceUrl||""),appSessionToken:String(s?.appSessionToken||""),summaryModel:String(s?.summaryModel||""),remoteSummaryConsent:s?.remoteSummaryConsent===true});
async function archive(message){
  if(archiveBusy||summaryController||session&&!["completed","failed","disposed"].includes(session.status))throw new Error("현재 처리를 먼저 마쳐 주세요.");
  archiveBusy=true;const config=settingsOf(message.settings),client={baseUrl:config.serviceUrl,token:config.appSessionToken};
  try{
    const me=await ServiceClient.me(client);
    if(message.type==="LIST_VAULT")return {ok:true,items:(await ServiceClient.listEncrypted(client)).items};
    const objectId=message.objectId||crypto.randomUUID();
    if(message.type==="DELETE_VAULT"){await ServiceClient.deleteEncrypted({...client,objectId});return {ok:true};}
    const context={accountId:me.accountId,objectId,kind:"session"};
    if(message.type==="SAVE_VAULT"){
      if(!session?.store.items.length)throw new Error("보관할 인식 자료가 없습니다.");
      const envelope=await LectureVault.encrypt({version:1,evidence:session.store.snapshot(),summary:session.summary||null,gaps:session.gaps},message.passphrase,context);
      await ServiceClient.saveEncrypted({...client,objectId,envelope});
      return {ok:true,objectId,state:session.state()};
    }
    const {envelope}=await ServiceClient.loadEncrypted({...client,objectId});
    const value=await LectureVault.decrypt(envelope,message.passphrase,context);
    if(value?.version!==1)throw new Error("지원하지 않는 보관 문서입니다.");
    const restored=new EvidenceStore();restored.restore(value.evidence);
    const note=value.summary;
    if(note?.sections?.length){
      if(!Array.isArray(note.questions))throw new Error("보관 노트의 형식을 확인할 수 없습니다.");
      for(let i=0;i<note.sections.length;i+=80)SummaryPipeline.validateSummary({...note,sections:note.sections.slice(i,i+80),questions:[]},restored.snapshot());
      for(let i=0;i<note.questions.length;i+=30)SummaryPipeline.validateSummary({...note,sections:note.sections.slice(0,1),questions:note.questions.slice(i,i+30)},restored.snapshot());
      if(note.overview)SummaryPipeline.validateSummary(note.overview,restored.snapshot());
      note.evidenceRefs=restored.items.map(({id,t0,t1,source})=>({id,t0,t1,source}));
    }
    else if(note&&note.status!=="recognition-only")throw new Error("보관 노트의 형식을 확인할 수 없습니다.");
    await session?.dispose();
    session=new CaptureSession({id:crypto.randomUUID(),generation:++generation,stream:null,options:{},emit});
    session.store=restored;session.summary=note;session.status="completed";session.closed=true;
    session.gaps=Array.isArray(value.gaps)?value.gaps.slice(-200):[];
    session.counts={visual:restored.items.filter(e=>e.source==="ocr").length,audio:restored.items.filter(e=>e.source==="asr").length};
    session.publish();return {ok:true,objectId,state:session.state()};
  }finally{archiveBusy=false;message.passphrase="";}
}
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if(message?.target!=="session")return;
  if(message.type==="MEDIA_METADATA"){
    if(sender.id===chrome.runtime.id&&sender.tab?.id===session?.options.tabId&&sender.frameId===0&&message.sessionId===session.id&&!session.closed){session.updateMetadata(message.metadata);reply({ok:true});}
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
        session=new CaptureSession({id:crypto.randomUUID(),generation:++generation,stream,options:message.options,emit});
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
      try{
        current.summary=await SummaryPipeline.generate(current.store.snapshot(),{sessionId:current.id,settings:settingsOf(message.settings),signal:summaryController.signal,cache:current.summaryCache,attempt:current.summaryAttempt,onProgress:progress=>{current.progress=progress;current.publish();}});
      }catch(error){if(error.partial?.sections.length)current.summary=error.partial;current.error=error.name==="AbortError"?"요약을 취소했습니다. 완료한 구간은 유지됩니다.":error.message;}
      finally{summaryController=null;current.status="completed";current.progress=null;current.publish();}
      return {ok:!current.error,state:current.state(),error:current.error};
    }
    throw new Error("알 수 없는 요청입니다.");
  })().then(reply).catch(error=>reply({ok:false,error:error.message||"처리를 완료하지 못했습니다."}));
  return true;
});
