// Display and control only. The offscreen document owns all lecture data.
const $=id=>document.getElementById(id);
const els=Object.fromEntries(['tabSelect','modeSelect','langSelect','startBtn','stopBtn','pauseBtn','disposeBtn','notesBtn','status','renderFrame','stageReady','stageLive','stageDone','onboard','obLogin','obAccount','obAccountErr','obSummary','obCloud','obCloudRow','obPersonal','obPersonalRow','obAccess','obAccessRow','obFolderBtn','obFolderName','obFolderErr','obError','obWhisper','obDone','settingsToggle','settingsClose','settingsDrawer','optionsLink','refreshTabsBtn','ocrEnabledToggle','whisperEnabledToggle','whisperField','cntSlides','cntVoice','cntQueue','feedLines','readyAlert','panelAlert','doneSummary','donePill','doneAlert','againBtn','retryNoteBtn','ocrField','popoutBtn','debugDetails','debugLog','markEngine','engineBanner','markVoice','voiceState','markTab','tabState','settingsSummary','legalLine','cropField','cropRow','cropWrap','cropImg','cropBox','cropHint','previewBtn','working','workingText','saveBox','doneNotices','recognitionBox','makeNoteBtn','genBox','genSynthetic','genAugment','genAgainBtn'].map(id=>[id,$(id)]));
let settings,state,busy=false,tabs=[],cropRect=null,cropTabId=null;
const active=s=>['preparing','running','paused','draining','summarizing'].includes(s?.status);
const label={preparing:'준비 중',running:'캡처 중',paused:'일시정지',draining:'마지막 구간 처리 중',summarizing:'요약 중',completed:'노트 준비됨',failed:'처리 중단',disposed:''};
// 캡처는 끝났는데 노트 만들기가 실패한 상태 — offscreen은 세션을 'completed'로 두고 error만 싣는다.
const summaryFailed=s=>s?.status==='completed'&&!!s?.error&&!s?.summary?.note;
const rpc=message=>new Promise(resolve=>chrome.runtime.sendMessage({...message,target:'background'},response=>{const error=chrome.runtime.lastError;resolve(response||{ok:false,error:error?'세션에 다시 연결하지 못했습니다.':'응답이 없습니다.'});}));
const setStatus=text=>els.status.textContent=text||'';
// 인증이 끊긴 응답 코드 — 오류 문구 옆에 로그인 버튼을 단다. 같은 문구를 코드 없이 다시 그려도(render의 setError(state.error)) 마지막 코드를 재사용해 버튼을 유지한다.
const AUTH_CODES=['AUTH_REQUIRED','unauthorized','token_expired'];
let lastAuth={text:'',code:''};
const setError=(text,code)=>{if(text&&AUTH_CODES.includes(code))lastAuth={text,code};else if(text!==lastAuth.text)lastAuth={text:'',code:''};for(const alert of [els.readyAlert,els.panelAlert,els.doneAlert]){alert.hidden=!text;alert.textContent=text||'';if(text&&lastAuth.text===text){const b=document.createElement('button');b.type='button';b.textContent='Google로 로그인';b.addEventListener('click',alertLogin);alert.append(b);}}};
// 로그인 한 번의 단계별 시간. 진단 로그(LOGIN_TIMING)에는 단계 이름과 ms만 싣고 보내기를 기다리지 않는다 — 토큰·이메일은 애초에 싣지 않는다.
const loginStep=(name,ms)=>{try{rpc({type:'DIAG_EVENT',event:{stage:'login',code:'LOGIN_TIMING',ms:Math.max(0,Math.round(ms)),msg:name}}).catch(()=>{});}catch{}};
const loginClock=()=>{const t0=Date.now(),rec=loginStep;return{rec,total:()=>rec('total',Date.now()-t0),signIn:()=>typeof Auth==='undefined'?Account.signIn():Auth.signIn({onStep:rec})};};
async function alertLogin(){const{rec,total,signIn}=loginClock();try{await signIn();let s=Date.now();settings=settings||await loadSettings();rec('settings',Date.now()-s);await obCheck(rec);s=Date.now();setError('');updateReadyCard();rec('render',Date.now()-s);bgInit();}catch{}finally{total();}}
function setStage(name){els.stageReady.hidden=name!=='ready';els.stageLive.hidden=name!=='live';els.stageDone.hidden=name!=='done';els.onboard.hidden=name!=='onboard';for(const [id,on] of [['stepReady',name==='ready'],['stepLive',name==='live'],['stepDone',name==='done']]){const node=$(id);if(node)node.className=on?'active':'';}if(name!=='ready'&&els.settingsDrawer.open)els.settingsDrawer.close();}
function controls(){const has=!!state&&state.status!=='disposed';els.startBtn.disabled=busy||active(state)||!tabs.some(tab=>String(tab.id)===els.tabSelect.value);els.stopBtn.disabled=busy||!active(state);if(els.pauseBtn){els.pauseBtn.disabled=busy||!['running','paused'].includes(state?.status);els.pauseBtn.textContent=state?.status==='paused'?'다시 시작':'일시정지';}if(els.disposeBtn)els.disposeBtn.disabled=busy||active(state)||!has;els.notesBtn.disabled=busy||regenBusy||!['completed','failed'].includes(state?.status)||!((state?.counts?.visual||0)+(state?.counts?.audio||0)>0);if(els.makeNoteBtn)els.makeNoteBtn.disabled=regenBusy;if(els.genAgainBtn)els.genAgainBtn.disabled=regenBusy;if(els.retryNoteBtn)els.retryNoteBtn.disabled=busy||regenBusy;}
function format(t){return `${Math.floor((t||0)/60)}:${String(Math.floor((t||0)%60)).padStart(2,'0')}`;}
// 캡처 경과(#elapsed): 이 세션의 'running'을 패널이 처음 본 순간부터 재고, 일시정지 구간은 뺀다. 세션이 바뀌면 다시 잰다.
let liveElapsed=null; // {sessionId,base,since} — base는 누적 ms, since는 달리는 중일 때만 시작 시각
const elapsedEl=$('elapsed');
function trackElapsed(){
  const id=state?.sessionId;
  if(liveElapsed&&liveElapsed.sessionId!==id)liveElapsed=null;
  if(state?.status==='running'){
    if(!liveElapsed)liveElapsed={sessionId:id,base:0,since:Date.now()};
    else if(!liveElapsed.since)liveElapsed.since=Date.now();
  }else if(liveElapsed?.since){
    liveElapsed.base+=Date.now()-liveElapsed.since;
    liveElapsed.since=0;
  }
}
function liveClock(){
  if(!elapsedEl||els.stageLive.hidden)return;
  const s=Math.floor((liveElapsed?liveElapsed.base+(liveElapsed.since?Date.now()-liveElapsed.since:0):0)/1000),h=Math.floor(s/3600),m=Math.floor(s%3600/60);
  elapsedEl.textContent=h?`${h}:${String(m).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`:`${String(m).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
}
if(typeof setInterval==='function')setInterval(liveClock,1000); // 테스트 VM에는 setInterval이 없어 건너뛴다
// 패널은 노트를 보여 주지 않는다 — 완성 노트는 암호화 파일로 보관함 폴더에 저장돼 웹사이트 보관함(Account.SITE/library)에서
// 같은 계정으로 로그인해 연다. 샌드박스에는 인식 결과 미리보기만 보낸다(RENDER_RECOGNITION).
const postToFrame=message=>els.renderFrame?.contentWindow?.postMessage(message,'*');
// 이 계정의 노트 키를 기기에 둔다(이미 있으면 그대로, 다른 계정 것이면 새로 받는다). 로그인하지 않았으면 null.
async function ensureLibraryKey(){
  const session=obSession||await Account.getSession();
  if(!session)throw new Error('로그인이 필요합니다.');
  return NoteFile.ensureLibraryKey(await PackageStore.indexedDbAdapter(),Account.decodeUser(session.access_token).id,()=>Account.fetchLibraryKey(session));
}
// 사용자 클릭 안에서만 부른다: 권한만 거둬졌으면 다시 허용, 아니면 폴더 선택 창. 취소(AbortError)는 조용히 넘긴다.
async function chooseFolder(){
  const adapter=await PackageStore.indexedDbAdapter();
  try{
    if((await LibraryFolder.status(adapter)).state==='needs-permission')return await LibraryFolder.regrant(adapter);
    const st=await LibraryFolder.pick(adapter);
    // 재설치·다른 기기: 폴더에 남은 설정 백업을 들인다(동의·로그인은 백업하지 않는다).
    if(await LibraryFolder.adoptSettings(adapter,loadSettings,saveSettings).catch(()=>false)){settings=await loadSettings();setStatus('보관함 폴더의 설정 백업을 불러왔습니다.');}
    return st;
  }
  catch(error){if(error?.name==='AbortError')return null;throw error;}
  finally{obFolder=await LibraryFolder.status(adapter).catch(()=>obFolder);updateReadyRows();}
}
if(typeof LibraryFolder!=='undefined')LibraryFolder.watchSettings(()=>PackageStore.indexedDbAdapter(),loadSettings);
// 저장 상태 상자. 완료 화면과 (이후) 백그라운드 작업 카드가 같은 함수를 쓴다.
// saved: "file"(폴더에 저장됨) / "no-folder"(폴더 없음·권한 필요) / "no-key"(기기에 계정 키 없음) / "failed"(저장 실패) / null(표시 없음).
function renderSaved(box,saved,packageId){
  if(!box)return;
  const key=`${saved||''}:${packageId||''}`;
  if(box.dataset.savedKey===key)return; // 같은 상태를 다시 그리면 진행 중 클릭과 안내를 지운다
  box.dataset.savedKey=key;
  box.textContent='';
  box.hidden=!saved;
  if(!saved)return;
  const say=text=>{
    const p=document.createElement('p');
    p.className='detail';
    p.textContent=text;
    box.append(p);
  };
  const button=(label,work)=>{
    const b=document.createElement('button');
    b.type='button';
    b.textContent=label;
    b.addEventListener('click',async()=>{
      b.disabled=true;
      try{await work();}
      catch(error){setStatus(error.message||'요청을 완료하지 못했습니다.');}
      finally{b.disabled=false;}
    });
    return b;
  };
  const exportAll=async()=>{
    const r=await rpc({type:'LIB_EXPORT_ALL'});
    if(!r?.ok){setStatus(r?.error||'노트 파일을 저장하지 못했습니다.');return;}
    setStatus(`노트 파일 ${r.count??0}개를 저장했습니다.`+(r.failed?` 실패 ${r.failed}개.`:''));
    if(state?.summary)state.summary.saved=r.count?'file':'failed';
    if(state)render(state);
  };
  if(saved==='file'){
    say('노트를 암호화해 보관함 폴더에 저장했습니다. 웹사이트에서 같은 계정으로 로그인하면 열립니다.');
    const row=document.createElement('div');
    row.className='btnrow';
    row.append(button('웹에서 노트 열기',()=>chrome.tabs.create({url:Account.SITE+'/library'})));
    box.append(row);
  }else if(saved==='no-folder'){
    say('보관함 폴더에 쓸 수 없어 저장하지 못했습니다. 폴더를 지정하거나 권한을 다시 허용하세요.');
    box.append(button('폴더 지정하고 저장',async()=>{if(await chooseFolder())await exportAll();}));
  }else if(saved==='no-key'){
    say('이 기기에 계정 보관함 키가 없어 저장하지 못했습니다. 인터넷에 연결된 상태에서 다시 시도하세요.');
    box.append(button('다시 시도',async()=>{await ensureLibraryKey();await exportAll();}));
  }else if(saved==='failed'){
    say('노트 파일을 저장하지 못했습니다.');
    box.append(button('다시 저장',exportAll));
  }
}
// LIB_REGENERATE: 보관함에 저장된 인식 자료로 노트를 다시 만든다(인식만 끝난 강의의 노트화·생성 옵션 변경).
// 몇 분 걸린다 — 진행은 working 표시와 상태 문구로 알리고, 결말은 {ok,status,code,saved}로 온다.
let regenBusy=false;
// 재생성 실패도 세션 오류와 같은 경로(state.error → render → setError → doneAlertExtras)를 탄다 —
// setError만 직접 부르면 로그인 버튼·요금제 링크가 안 붙는다.
const regenError=message=>{if(state){state.error=message;render(state);}else setError(message);};
async function regenerate(options){
  const packageId=state?.summary?.packageId;
  if(!packageId){regenError('다시 만들 노트 자료가 없습니다.');return;}
  setError('');
  setStatus('노트를 만드는 중… 몇 분 걸릴 수 있습니다.');
  regenBusy=true;
  setWorking();
  controls();
  try{
    const r=await rpc({type:'LIB_REGENERATE',packageId,options});
    if(!r?.ok){
      regenError(r?.error||'노트를 만들지 못했습니다.');
      return;
    }
    const sum=state?.summary;
    if(sum){
      sum.saved=r.saved??sum.saved;
      if(r.status==='complete'||r.status==='partial'){sum.status=r.status;sum.note=sum.note||{};sum.recognition=null;}
    }
    state.error=null;
    render(state);
    if(sum?.note)els.donePill.textContent=r.status==='partial'?'일부 완료':'노트 완성';
    setStatus('노트를 만들었습니다.');
  }finally{
    regenBusy=false;
    setWorking();
    controls();
  }
}
// v2 결과({version:2,note|recognition}): 노트 본문은 패널에 그리지 않는다. 인식 결과만 샌드박스에 그리고,
// 인식만 끝난 결과에는 노트 만들기를, 저장 상태는 상자로, 완료 고지는 목록으로 보여 준다.
function renderSummary(summary){
  const note=summary?.note||null,recognition=summary?.recognition||null;
  els.renderFrame.hidden=!recognition;
  if(recognition)postToFrame({type:'RENDER_RECOGNITION',recognition});
  if(els.recognitionBox)els.recognitionBox.hidden=!(!note&&recognition);
  els.notesBtn.hidden=summary?.status==='recognition-only'||summaryFailed(state); // 인식만 끝난 결과는 인식 상자의 '노트 만들기'가, 실패한 노트는 '다시 시도'가 유일한 경로다
  renderSaved(els.saveBox,summary?.saved||null,summary?.packageId);
  if(els.genBox)els.genBox.hidden=!(note&&obPlan!=='free');
  const lines=bgNoticeLines(summary?.notices);
  els.doneNotices.textContent='';
  els.doneNotices.hidden=!lines.length;
  for(const line of lines){
    const li=document.createElement('li');
    li.textContent=line;
    els.doneNotices.append(li);
  }
}
// 오류 아래에 조치를 단다: 로그아웃 상태면 로그인 버튼, '한도' 문구면 요금제 링크.
function doneAlertExtras(){
  if(!els.doneAlert||els.doneAlert.hidden)return;
  if(!obSession){
    const b=document.createElement('button');
    b.type='button';
    b.textContent='로그인';
    b.addEventListener('click',login);
    els.doneAlert.append(b);
  }
  if(state?.error?.includes('한도')){
    const a=document.createElement('a');
    a.href=Account.SITE+'/account/billing';
    a.target='_blank';
    a.rel='noopener';
    a.textContent='요금제 보기';
    els.doneAlert.append(a);
  }
}
function setRow(mark,val,kind,text){if(!mark||!val)return;mark.className='mark'+(kind==='off'?' off':kind==='warn'?' warn':'');mark.textContent=kind==='ok'?'✓':kind==='warn'?'!':'';val.textContent=text;}
// 유료(free가 아닌 모든 플랜)는 화면·음성 모두 서버에서 인식한다 — 클라우드 인식 동의가 있을 때만.
const cloudMode=()=>obPlan!=='free'&&cloudRecognitionAllowed(settings);
function updateReadyCard(){if(!settings)return;const cloud=cloudMode();setRow(els.markEngine,els.engineBanner,cloud?'ok':els.ocrEnabledToggle?.checked===false?'off':'ok',cloud?'화면 인식 · 서버 (고화질)':els.ocrEnabledToggle?.checked===false?'꺼짐':settings.ocrEngine==='vision-cloud'?'고화질 화면 인식 (서비스 경유)':'PP-OCRv5 한국어 (WASM)');setRow(els.markVoice,els.voiceState,cloud?'ok':settings.whisperEnabled?'ok':'warn',cloud?'음성 인식 · 서버':settings.whisperEnabled?`Whisper ${settings.whisperModel==='base-wasm'?'Base 저사양 · WASM':'Small q8/q4 · WebGPU'} (로컬)`:'꺼짐 — 음성은 기록되지 않습니다');if(els.ocrField)els.ocrField.hidden=cloud;if(els.whisperField)els.whisperField.hidden=cloud;const tabOpt=els.tabSelect?.selectedOptions?.[0];setRow(els.markTab,els.tabState,tabOpt?'ok':'warn',tabOpt?tabOpt.textContent:'선택된 탭 없음');const isRegion=els.modeSelect.value==='region';if(els.cropRow)els.cropRow.style.display=isRegion?'flex':'none';if(!isRegion&&els.cropWrap)els.cropWrap.style.display='none';if(els.cropField)els.cropField.hidden=els.ocrEnabledToggle?.checked===false;let modeDesc='영상 전체';if(els.modeSelect.value==='caption')modeDesc='하단 자막 띠';else if(isRegion)modeDesc=cropRect?`영역 지정 (${Math.round(cropRect.w*100)}%×${Math.round(cropRect.h*100)}%)`:'영역 지정 (슬라이드)';if(els.settingsSummary)els.settingsSummary.textContent=`${modeDesc} · ${{auto:'자동 감지(한국어 우선)',ko:'한국어',en:'영어'}[settings.whisperLang]||'한국어'}`;if(els.legalLine)els.legalLine.textContent=cloud?'화면·음성은 Summrizei 서비스에서 인식하고 저장하지 않습니다. 노트도 로그인한 계정으로 서비스가 만듭니다.':'화면·음성 인식은 기기 안에서 하고, 노트는 로그인한 계정으로 Summrizei 서비스가 만듭니다.';updateReadyRows();}
// 준비 카드의 계정·노트 저장 행. obCheck()가 채운 캐시(obSession·obPlan·obAcct·obFolder)로 그리고, 부족한 쪽엔 바로가기 버튼을 단다.
const readyEl=Object.fromEntries(['markAccount','accountState','accountLoginBtn','markStore','storeState','storePassBtn'].map(id=>[id,$(id)]));
function updateReadyRows(){
  if(!obSession){
    setRow(readyEl.markAccount,readyEl.accountState,'warn','로그인 필요');
    readyEl.accountLoginBtn.hidden=false;
  }else{
    let email='';
    try{email=Account.decodeUser(obSession.access_token).email;}catch{}
    const limit=obAcct?.minutes_limit;
    setRow(readyEl.markAccount,readyEl.accountState,'ok',`${email||'로그인됨'} · ${PLANS[obPlan]||obPlan}`+(limit!=null?` · 이번 달 ${obAcct?.minutes_used??0}/${limit}분`:''));
    readyEl.accountLoginBtn.hidden=true;
  }
  const f=obFolder.state;
  setRow(readyEl.markStore,readyEl.storeState,f==='ok'?'ok':'warn',f==='ok'?`보관함 폴더 · ${obFolder.name}`:f==='needs-permission'?'보관함 폴더 권한 필요':'보관함 폴더 없음');
  readyEl.storePassBtn.textContent=f==='needs-permission'?'다시 허용':'폴더 고르기';
  readyEl.storePassBtn.hidden=f==='ok';
}
if(readyEl.accountLoginBtn)readyEl.accountLoginBtn.addEventListener('click',login);
if(readyEl.storePassBtn)readyEl.storePassBtn.addEventListener('click',async()=>{
  try{if(await chooseFolder())rpc({type:'LIB_EXPORT_ALL'});}catch(error){setStatus(error.message||'폴더를 지정하지 못했습니다.');}
});
// One indicator for both waits the user actually has to sit through: summarising, and the recognition backlog
// that has to drain before a note can be made.
function setWorking(){if(!els.working)return;const s=state?.status,queued=(state?.backlog?.images||0)+(state?.backlog?.audio||0);const making=regenBusy||s==='summarizing';els.working.hidden=!(making||s==='draining'||(active(state)&&queued>0));if(els.workingText)els.workingText.textContent=making?'노트를 만드는 중입니다. 몇 분 걸릴 수 있습니다.':'남은 인식을 마무리하는 중입니다.';}
function render(next){if(next&&state&&next.generation<state.generation)return;const was=state?.status;state=next||null;const s=state?.status,failed=summaryFailed(state);setStatus(failed?'노트를 만들지 못했습니다.':label[s]||'');trackElapsed();liveClock();setError(state?.error);if(onboardingOpen)setStage('onboard');else if(!state||s==='disposed')setStage('ready');else if(active(state)&&s!=='summarizing')setStage('live');else setStage('done');els.cntSlides.textContent=state?.counts?.visual||0;els.cntVoice.textContent=state?.counts?.audio||0;els.cntQueue.textContent=(state?.backlog?.images||0)+(state?.backlog?.audio||0);els.feedLines.textContent='';const recent=state?.recent||[],gaps=state?.gaps||[];if(recent.length){for(const item of recent){const row=document.createElement('div'),time=document.createElement('span');time.className='t';time.textContent=`${format(item.time)} · ${item.source==='asr'?'음성':'화면'}`;row.append(time,document.createTextNode(item.text));els.feedLines.append(row);}}else if(gaps.length){for(const gap of gaps.slice(-3)){const row=document.createElement('div');row.textContent=`${format(gap.time)} · ${gap.reason}`;els.feedLines.append(row);}}else els.feedLines.textContent=active(state)?'인식 결과를 기다리는 중입니다.':'표시할 처리 구간이 없습니다.';els.debugLog.textContent=state?.debug?.join('\n')||'세션을 시작하면 음성 진단 정보가 표시됩니다.';els.debugLog.scrollTop=els.debugLog.scrollHeight;if(s==='failed'&&state?.error?.includes('음성'))els.debugDetails.open=true;els.donePill.textContent=failed?'노트 실패':s==='summarizing'?'요약 중':s==='failed'?'중단됨':state?.summary?.status==='recognition-only'?'인식만 완료':state?.summary?.status==='partial'?'일부 완료':state?.summary?.note?'노트 완성':'인식 완료';if(els.retryNoteBtn)els.retryNoteBtn.hidden=!failed;els.doneSummary.textContent=state?`화면 ${state.counts.visual} · 음성 ${state.counts.audio}`:'';renderSummary(state?.summary);doneAlertExtras();setWorking();controls();updateReadyCard();if(shouldAutoSummarize(was,state))autoSummarize();}
// 캡처가 끝나면 노트 화면이 비어 있으면 안 된다. 요약을 한 번 자동으로 이어 돌린다 —
// 중지 버튼뿐 아니라 영상 종료·트랙 종료 같은 자동 종료 경로도 모두 여기(completed 전이)로 모인다.
// 세션당 1회로 제한한다: 실패한 요약을 무한히 다시 부르지 않기 위해서다.
function shouldAutoSummarize(was,next){return !!was&&active({status:was})&&next?.status==='completed'&&!next.summary&&!next.error&&!!(next.counts?.visual||next.counts?.audio);}
let autoSummaryKey='';
function autoSummarize(){const key=`${state.sessionId}:${state.generation}`;if(autoSummaryKey===key)return;autoSummaryKey=key;setTimeout(async()=>action('GENERATE_NOTES',{settings:await loadSettings()}),0);}
async function action(type,extra={}){if(busy&&type!=='STOP_SESSION'&&type!=='CANCEL_SUMMARY')return null;busy=true;setError('');if(type==='START_SESSION')setStatus('강의 탭 확인 중…');setWorking();controls();try{const result=await rpc({type,...extra,...(state&&type!=='START_SESSION'?{sessionId:state.sessionId,generation:state.generation}:{})});if(result.state!==undefined)render(result.state);if(!result.ok){const error=new Error(result.error||'요청을 완료하지 못했습니다.');error.code=result.code;throw error;}return result;}catch(error){setError(error.message,error.code);return null;}finally{busy=false;setWorking();controls();}}
async function loadTabs(){const selected=els.tabSelect.value,requested=new URLSearchParams(location.search).get('tabId');const [all,[focused]]=await Promise.all([chrome.tabs.query({}),chrome.tabs.query({active:true,currentWindow:true})]);tabs=all.filter(tab=>/^https?:/.test(tab.url||''));els.tabSelect.textContent='';for(const tab of tabs){const opt=document.createElement('option');opt.value=tab.id;opt.textContent=`${new URL(tab.url).hostname} — ${(tab.title||'강의 탭').slice(0,60)}`;els.tabSelect.append(opt);}const target=selected||requested||String(focused?.id??'');if(target)els.tabSelect.value=target;controls();updateReadyCard();bgTabCheck();}
function rect(){if(els.modeSelect.value==='caption')return{x:0,y:.8,w:1,h:.2};if(els.modeSelect.value==='region'&&cropRect)return cropRect;return{x:0,y:0,w:1,h:1};}
async function start(){settings=await loadSettings();await obCheck();const steps=onboardingSteps(settings,obSession,obPlan,obFolder);if(steps.length){if(await openOnboarding(steps)!==true)return;settings=await loadSettings();}if(!tabs.some(tab=>String(tab.id)===els.tabSelect.value)){setError('선택한 강의 탭이 없습니다. 강의 창에서 확장을 다시 여세요.');return;}const cloud=cloudMode();if(!cloud&&!els.ocrEnabledToggle.checked&&!settings.whisperEnabled){setError('화면 또는 음성 인식 중 하나를 켜세요.');return;}if((cloud||els.ocrEnabledToggle.checked)&&els.modeSelect.value==='region'&&(!cropRect||cropTabId!==els.tabSelect.value)){els.settingsDrawer.showModal();els.cropHint.textContent='현재 강의 화면을 불러오고 인식할 슬라이드 영역을 드래그하세요.';setError('화면을 불러온 뒤 인식할 슬라이드 영역을 드래그하세요.');els.previewBtn.focus();return;}await action('START_SESSION',{settings,options:{tabId:Number(els.tabSelect.value),pageTitle:(tabs.find(tab=>String(tab.id)===els.tabSelect.value)?.title||'').slice(0,200),rect:rect(),recognition:cloud?'cloud':'local',ocrEnabled:cloud?true:els.ocrEnabledToggle.checked,ocrEngine:cloud?'vision-cloud':settings.ocrEngine||'ppocr-v5-wasm',visionConsent:settings.visionConsent===true,whisperEnabled:cloud?true:settings.whisperEnabled,whisperModel:settings.whisperModel,whisperLang:settings.whisperLang,speedCorrection:settings.speedCorrection===true}});}
els.startBtn.addEventListener('click',start);els.stopBtn.addEventListener('click',()=>action(state?.status==='summarizing'?'CANCEL_SUMMARY':'STOP_SESSION'));els.notesBtn.addEventListener('click',async()=>action('GENERATE_NOTES',{settings:await loadSettings()}));if(els.retryNoteBtn)els.retryNoteBtn.addEventListener('click',async()=>action('GENERATE_NOTES',{settings:await loadSettings()}));els.againBtn.addEventListener('click',()=>action('DISPOSE_SESSION'));els.settingsToggle.addEventListener('click',()=>els.settingsDrawer.showModal());els.settingsClose.addEventListener('click',()=>els.settingsDrawer.close());els.refreshTabsBtn.addEventListener('click',loadTabs);els.tabSelect.addEventListener('change',()=>{cropRect=null;cropTabId=null;els.cropBox.style.display='none';controls();updateReadyCard();bgTabCheck();});els.ocrEnabledToggle.addEventListener('change',async()=>{settings=await saveSettings({ocrEnabled:els.ocrEnabledToggle.checked});updateReadyCard();});els.whisperEnabledToggle.addEventListener('change',async()=>{settings=await saveSettings({whisperEnabled:els.whisperEnabledToggle.checked});updateReadyCard();});els.modeSelect.addEventListener('change',updateReadyCard);els.langSelect.addEventListener('change',async()=>{settings=await saveSettings({whisperLang:els.langSelect.value});updateReadyCard();});els.optionsLink.addEventListener('click',event=>{event.preventDefault();chrome.runtime.openOptionsPage();});
if(els.pauseBtn)els.pauseBtn.addEventListener('click',()=>action(state?.status==='paused'?'RESUME_SESSION':'PAUSE_SESSION'));if(els.disposeBtn)els.disposeBtn.addEventListener('click',()=>action('DISPOSE_SESSION'));
if(els.popoutBtn)els.popoutBtn.addEventListener('click',()=>chrome.windows?.create?.({url:chrome.runtime.getURL(`sidepanel.html?tabId=${encodeURIComponent(els.tabSelect.value)}`),type:'popup',width:480,height:760}));
// 노트 만들기·다시 만들기: 보관함 패키지의 인식 자료로 다시 만든다(LIB_REGENERATE). 요약 동의가 없으면 동의 단계부터 연다.
if(els.makeNoteBtn)els.makeNoteBtn.addEventListener('click',async()=>{
  settings=settings||await loadSettings();
  if(!summaryAllowed(settings)&&await openOnboarding(['consent'])!==true)return;
  regenerate({syntheticExamples:false,externalAugmentation:false});
});
// 생성 옵션은 다음 노트 생성부터 적용된다 — 바꾸는 즉시 설정에 저장한다.
const saveNoteOptions=async()=>{
  try{settings=await saveSettings({noteOptions:{syntheticExamples:els.genSynthetic.checked,externalAugmentation:els.genAugment.checked}});}
  catch(error){setStatus(error.message);}
};
if(els.genSynthetic)els.genSynthetic.addEventListener('change',saveNoteOptions);
if(els.genAugment)els.genAugment.addEventListener('change',saveNoteOptions);
if(els.genAgainBtn)els.genAgainBtn.addEventListener('click',()=>regenerate({syntheticExamples:els.genSynthetic.checked,externalAugmentation:els.genAugment.checked}));
function showPreview(dataUrl,tabId){if(!els.cropImg)return;cropRect=null;cropTabId=String(tabId);els.cropBox.style.display='none';els.cropImg.src=dataUrl;if(els.cropWrap)els.cropWrap.style.display='block';if(els.cropHint)els.cropHint.textContent='드래그해서 슬라이드 영역만 선택하세요.';updateReadyCard();}
(function setupCropDrag(){let start=null;if(!els.cropWrap||!els.cropBox||!els.cropImg)return;els.cropWrap.addEventListener('mousedown',e=>{const r=els.cropImg.getBoundingClientRect();start={x:e.clientX-r.left,y:e.clientY-r.top};Object.assign(els.cropBox.style,{display:'block',left:`${start.x}px`,top:`${start.y}px`,width:'0px',height:'0px'});e.preventDefault();});els.cropWrap.addEventListener('mousemove',e=>{if(!start)return;const r=els.cropImg.getBoundingClientRect(),x=Math.max(0,Math.min(r.width,e.clientX-r.left)),y=Math.max(0,Math.min(r.height,e.clientY-r.top));Object.assign(els.cropBox.style,{left:`${Math.min(start.x,x)}px`,top:`${Math.min(start.y,y)}px`,width:`${Math.abs(x-start.x)}px`,height:`${Math.abs(y-start.y)}px`});});window.addEventListener('mouseup',()=>{if(!start)return;start=null;const r=els.cropImg.getBoundingClientRect(),b=els.cropBox.getBoundingClientRect();if(b.width<10||b.height<10){cropRect=null;els.cropBox.style.display='none';if(els.cropHint)els.cropHint.textContent='영역이 너무 작아 취소되었습니다. 다시 드래그하세요.';updateReadyCard();return;}cropRect={x:Math.max(0,(b.left-r.left)/r.width),y:Math.max(0,(b.top-r.top)/r.height),w:Math.min(1,b.width/r.width),h:Math.min(1,b.height/r.height)};if(els.cropHint)els.cropHint.textContent=`영역 지정됨 (${Math.round(cropRect.w*100)}% × ${Math.round(cropRect.h*100)}%)`;updateReadyCard();});})();
if(els.previewBtn)els.previewBtn.addEventListener('click',async()=>{const tabId=Number(els.tabSelect.value);if(!tabId){setError('미리보기를 불러올 탭을 먼저 선택하세요.');return;}cropRect=null;cropTabId=null;els.cropBox.style.display='none';if(els.cropHint)els.cropHint.textContent='강의 화면을 불러오는 중...';setError('');const res=await rpc({type:'GET_PREVIEW',tabId});if(res?.ok&&res.dataUrl){showPreview(res.dataUrl,tabId);}else{setError(res?.error||'화면을 불러오지 못했습니다.');if(els.cropHint)els.cropHint.textContent='불러오기 실패. 영상을 재생한 뒤 다시 시도하세요.';}});
chrome.runtime.onMessage.addListener((message,sender)=>{try{const url=new URL(sender.url),base=new URL(chrome.runtime.getURL(''));if(sender.id===chrome.runtime.id&&url.protocol===base.protocol&&url.host===base.host&&url.pathname==='/offscreen.html'&&message?.target==='panel'&&message.type==='SESSION_STATE')render(message.state);}catch{}});
window.addEventListener('message',event=>{if(event.source!==els.renderFrame?.contentWindow||!event.data)return;if(event.data.type==='RENDER_HEIGHT'&&typeof event.data.height==='number')els.renderFrame.style.height=Math.max(event.data.height,140)+'px';});
// ── 백그라운드 처리(유료, docs/architecture-v2.md §6.1): 영상 목록 찾기 → BG_RUN → 진행·결말 표시. 작업은 offscreen이 하고 패널은 누르고 보여 줄 뿐이다.
// 실시간 모드로는 사용자가 "실시간 모드로 시작"을 눌러야만 넘어간다 — 보호·미지원·실패 어느 경우에도 조용히 바꾸지 않는다.
const bgEl=Object.fromEntries(['bgBox','bgBtn','bgStatus','bgProgress','bgBar','bgTime','bgSave','bgRetryBtn','bgCancelBtn','bgLiveBtn','bgConsentBtn','bgSummaryLink','bgMakeBtn','bgDiscardBtn','bgBilling'].map(id=>[id,$(id)]));
const YOUTUBE=/(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com|googlevideo\.com)$/i; // lib/background-job.js와 같은 목록(§19)
const YT_MSG='이 사이트는 실시간 캡처만 지원합니다.';
const UNSUP_MSG={dash:'이 강의는 DASH 방식이라 아직 백그라운드 처리를 지원하지 않습니다. 실시간 캡처를 쓰세요.',mp4:'이 강의는 MP4 파일 방식이라 아직 백그라운드 처리를 지원하지 않습니다. 실시간 캡처를 쓰세요.'};
const BG_STATE={created:'준비',acquiring_source:'소스 확인',ingesting:'수신·인식',refining:'정제',judging:'판정',planning:'계획',writing:'작성',validating:'검증',rendering:'렌더'},BG_STAGES=Object.keys(BG_STATE),BG_COUNT={recv:'수신',decode:'해석',vision:'화면',stt:'음성',write:'작성'};
let bg=null,bgYt=false,bgBusy=false,bgSince=0; // bg는 {jobId,source?,code?,pkg?}. 패널을 닫으면 사라진다 — 이어 할 작업은 BG_LIST가 다시 알려 준다.
// 요약 동의는 시작 조건이 아니다 — 없으면 인식 결과만 만들 뿐이다(시작 전에 알린다). 이용 동의와 클라우드 인식 동의만 필수.
const bgConsented=()=>backgroundAllowed(settings)&&cloudRecognitionAllowed(settings);
const NO_SUMMARY='외부 요약 처리에 동의하지 않아 인식 결과만 만듭니다.';
// 이어 하기 안내의 멈춤 사유 — 전체 문구가 아니라 짧은 사유만 단다.
const CODE_TEXT={SRC_AUTH_EXPIRED:'강의 로그인이 만료됨 — 강의 탭을 다시 연 뒤 이어 하세요',QUOTA_EXCEEDED:'이번 달 한도 도달'};
const bgReason=c=>!c?'':CODE_TEXT[c]||(/^NET_/.test(c)?'네트워크 오류':`코드 ${c}`);
function bgShow({text='',progress='',busy=false,cancel=false,retry=false,live=false,consent=false,summary=false,make=false,billing=false,discard=false,retryLabel}={}){
  bgBusy=busy;
  bgEl.bgStatus.textContent=text;bgEl.bgProgress.textContent=progress;
  bgEl.bgBtn.disabled=busy||bgYt;bgEl.bgCancelBtn.hidden=!cancel;bgEl.bgRetryBtn.hidden=!retry;bgEl.bgRetryBtn.textContent=retryLabel||'다시 시도';bgEl.bgLiveBtn.hidden=!live;
  bgEl.bgConsentBtn.hidden=!consent;bgEl.bgSummaryLink.hidden=!summary;bgEl.bgMakeBtn.hidden=!make;bgEl.bgBilling.hidden=!billing;bgEl.bgDiscardBtn.hidden=!discard;
  if(billing)try{bgEl.bgBilling.href=Account.SITE+'/account/billing';}catch{} // 테스트 VM에는 Account가 없다
}
// 진행 표시: created..rendering 9단계(BG_STATE 순서)의 단계 수와 경과 시계. 시계는 결말(BG_DONE)·시작 실패에서 멈춘다.
function bgTick(){bgEl.bgTime.hidden=!bgSince;if(bgSince){const s=Math.max(0,Math.floor((Date.now()-bgSince)/1000));bgEl.bgTime.textContent=`${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;}}
function bgStopClock(){bgSince=0;bgEl.bgTime.hidden=true;bgEl.bgBar.hidden=true;}
function bgRunShow(stage,progress=''){
  const n=BG_STAGES.indexOf(stage)+1;
  bgEl.bgBar.hidden=false;bgEl.bgBar.value=n||0;
  bgSince=bgSince||Date.now();bgTick();
  bgShow({text:`단계 ${n||'-'}/9 · ${BG_STATE[stage]||stage}`,progress,busy:true,cancel:true});
}
if(typeof setInterval==='function')setInterval(bgTick,1000); // 테스트 VM에는 setInterval이 없어 건너뛴다
// BG_DONE → 화면. 안내 문구는 offscreen이 파이프라인 CODES의 userMessage로 실어 보낸다. 실시간 모드 버튼은 suggest:"live"일 때만 나온다.
const BG_NOTE={ // 완료 고지 코드 → 사용자 문장. n은 건수(없으면 1). NOTE_ADVISORY_*는 렌더러 힌트라 여기 없다
  NOTE_CAPTURE_GAP:n=>`인식하지 못한 구간 ${n}곳`,
  NOTE_SECTIONS_FAILED:n=>`요약하지 못한 단원 ${n}개`,
  NOTE_BLOCKS_DROPPED:n=>`검증을 통과하지 못해 뺀 내용 ${n}건`,
  NOTE_UNITS_UNCITED:n=>`노트에 반영되지 않은 강의 구간 ${n}곳`,
  NOTE_GLOBAL_FAILED:()=>'강의 전체 요약을 만들지 못했습니다',
  NOTE_JUDGE_SKIPPED:()=>'중요도 판정 없이 만들었습니다',
  NOTE_FORMULAS_CHECK:n=>`확인이 필요한 수식 ${n}개`,
  NOTE_FORMULAS_UNVERIFIED:n=>`확인이 필요한 수식 ${n}개`,
  NOTE_FIGURES_CHECK:n=>`확인이 필요한 도표 ${n}개`,
  NOTE_FIGURES_NOT_DETECTED:()=>'도표는 찾지 않았습니다(Free)',
  NOTE_CLAIMS_UNSUPPORTED:n=>`강의 근거가 부족해 보류한 내용 ${n}건`,
  NOTE_AUGMENTED:n=>`강의 밖 보강·가상 사례 ${n}건(노트에 라벨 표시)`,
};
const BG_NOTE_PRUNED=new Set(['NOTE_ITEMS_PRUNED','NOTE_TARGET_DROPPED','NOTE_REVIEW_DROPPED','NOTE_CALC_DROPPED','NOTE_DEPENDENCY_DROPPED','NOTE_ANCHOR_DROPPED']); // 연결된 내용이 빠져 함께 뺀 항목 — 코드가 여럿이어도 한 줄로 합산
const bgClock=s=>{s=Math.floor(s||0);const h=Math.floor(s/3600),m=Math.floor(s%3600/60);return h?`${h}:${String(m).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`:`${m}:${String(s%60).padStart(2,'0')}`;};
const bgRanges=rs=>{if(!rs?.length)return'';const shown=rs.slice(0,3).map(r=>`${bgClock(r.t0)}–${bgClock(r.t1)}`).join(', ');return` (${shown}${rs.length>3?` 외 ${rs.length-3}곳`:''})`;};
function bgNoticeLines(notices){
  const lines=[];let pruned=0,at=-1;
  for(const n of notices||[]){
    const code=n?.code||'',count=n?.count||1; // ids는 절대 화면에 싣지 않는다
    if(BG_NOTE_PRUNED.has(code)){if(at<0)at=lines.length;pruned+=count;continue;}
    if(code.startsWith('NOTE_ADVISORY_')||code.startsWith('CONSENT_')||code==='NOTE_FORMULAS_IMAGE')continue; // CONSENT_*는 고지가 아니라 따로 UI가 받는다
    lines.push((BG_NOTE[code]?BG_NOTE[code](count):`기타 고지: ${code}×${count}`)+bgRanges(n?.ranges));
  }
  if(pruned)lines.splice(at,0,`연결된 내용이 빠져 함께 뺀 항목 ${pruned}건`);
  return lines;
}
function bgDoneView(d){
  if(d.status==='done')return {text:'이미 노트를 만든 강의입니다.'}; // BG_RUN already — 새로 돌리지 않고 저장된 결과만 다시 알린다
  if(['complete','partial'].includes(d.status))return {text:[`노트 준비됨${d.status==='partial'?' (일부 섹션 제외)':''} · 슬라이드 ${d.stats?.slides??'-'} · 음성 구간 ${d.stats?.chunks??'-'}`,...bgNoticeLines(d.notices)].join('\n')}; // 저장 안내는 공용 저장 상자(renderSaved)가 단다
  if(d.status==='cancelled')return {text:'백그라운드 처리를 취소했습니다.'};
  const text=d.message||`백그라운드 처리를 마치지 못했습니다. 같은 문제가 반복되면 메뉴의 고객지원으로 문의해 주세요.${d.code?` (코드: ${d.code})`:''}`;
  if(d.status==='paused'){
    if(d.code==='CONSENT_SUMMARY_REQUIRED')return {text:'인식을 마쳤습니다. 노트를 만들려면 외부 요약 처리에 동의하세요.',make:!!d.packageId}; // 재시도가 아니라 동의 후 이어 만든다
    if(d.code==='QUOTA_EXCEEDED')return {text,billing:true}; // 할당량 초과는 다시 시도해도 성공할 수 없다
    if(/^CONSENT_/.test(d.code||''))return {text,consent:true};
    return {text,retry:true,retryLabel:d.code==='SRC_AUTH_EXPIRED'?'강의 탭을 연 뒤 다시 시도':undefined};
  }
  return {text,live:d.suggest==='live'};
}
// 목록 찾기: VOD는 재생 시작 때 .m3u8을 한 번만 요청하므로 이미 재생 중이면 네트워크에 안 보인다 — 먼저 각 프레임(iframe 포함)의 리소스 기록에서 지난 요청을 찾는다.
// 못 찾으면 webRequest(선택 권한)로 고른 강의 탭의 media·xhr 응답만 몇 초 보고 바로 해제한다. 주소와 MIME만 분류하고 내용은 보지 않는다.
async function findPlaylist(tabId,ms=15000){
  const found={};
  try{
    for(const f of await chrome.scripting.executeScript({target:{tabId,allFrames:true},func:()=>performance.getEntriesByType('resource').map(e=>e.name)})||[])
      for(const url of f?.result||[]){const kind=LectureMedia.classifyRequest({url});if(kind==='hls')found.hls=url;else if(kind==='dash'||kind==='mp4')found[kind]=true;}
  }catch{} // 못 들어가는 프레임이 있거나 호출 자체가 실패해도 관찰로 넘어간다
  if(found.hls)return found.hls;
  if(found.dash||found.mp4)return{unsupported:found.dash?'dash':'mp4'};
  return new Promise(resolve=>{
    const end=url=>{clearTimeout(timer);chrome.webRequest.onResponseStarted.removeListener(seen);resolve(url);};
    const seen=d=>{
      if(d.tabId!==tabId)return;
      const mime=(d.responseHeaders||[]).find(h=>h.name.toLowerCase()==='content-type')?.value;
      if(LectureMedia.classifyRequest({url:d.url,type:d.type,mime})==='hls')end(d.url);
    };
    const timer=setTimeout(()=>end(null),ms);
    chrome.webRequest.onResponseStarted.addListener(seen,{urls:['<all_urls>'],tabId,types:['media','xmlhttprequest']},['responseHeaders']);
  });
}
// 작업 번호는 강의 탭 주소(조각 제외, 경로·질의 유지)의 SHA-256 앞 32자 — 같은 강의를 다시 누르면 같은 번호라 이전 작업의 인식 캐시를 이어 쓴다. 주소는 해시로만 둔다.
// BG_INGEST_V를 올리면 해시가 바뀌어 모든 강의가 새 번호를 받는다 — 인식 게이트·파이프라인이 바뀔 때 올려 다시 인식하게 한다.
const BG_INGEST_V="g2";
const bgJobId=async url=>{const u=new URL(url);u.hash="";const d=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(BG_INGEST_V+"\n"+u.href));return "lec-"+[...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,"0")).join("").slice(0,32);};
// source가 없으면 영상 목록을 찾는다(처음 시작, 그리고 강의 탭을 다시 연 뒤의 재개). 있으면 같은 jobId로 그대로 다시 보낸다.
async function bgStart(jobId=null,source=null){
  const tab=tabs.find(t=>String(t.id)===els.tabSelect.value);
  bg={jobId,source};if(bgEl.bgSave)bgEl.bgSave.hidden=true; // 지난 작업의 저장 안내를 새 작업에 남기지 않는다
  if(!tab){bgShow({text:'선택한 강의 탭이 없습니다. 강의 창에서 확장을 다시 여세요.'});return;}
  if(YOUTUBE.test(new URL(tab.url).hostname)){bgShow({text:YT_MSG});return;}
  if(!bgConsented()){settings=await loadSettings();if(!bgConsented()){bgShow({text:'백그라운드 처리에는 이용 동의 2종과 클라우드 인식(화면·음성 전송) 동의가 필요합니다.',consent:true});return;}}
  // 요약 동의가 없어도 막지 않는다 — 시작 전에 인식만 만들 거라고 알린다(조용한 전환 금지).
  const info=settings?.remoteSummaryConsent===true?'':NO_SUMMARY;
  bgSince=Date.now();bgTick();
  if(!source){
    bgShow({text:'영상 목록을 찾는 중… 강의 탭에서 영상을 재생하세요.',progress:info,summary:!!info,busy:true});
    let url=null;
    try{if(await chrome.permissions.request({permissions:['webRequest']}))url=await findPlaylist(tab.id);}catch{} // 권한 요청은 클릭 제스처 안의 첫 await이어야 한다
    if(url?.unsupported){bgStopClock();bgShow({text:UNSUP_MSG[url.unsupported],live:true});return;}
    if(!url){bgStopClock();bgShow({text:'영상 목록(HLS)을 찾지 못했습니다. 영상을 처음 위치로 되감거나 새로고침해 재생한 뒤 다시 시도하세요. 이 강의가 HLS가 아닌 방식이면 실시간 캡처를 쓰세요.',retry:true});return;}
    source=bg.source={playlistUrl:url};
  }
  jobId??=bg.jobId=await bgJobId(tab.url); // 번호가 없는 첫 클릭만 강의 주소 해시로 정한다 — 재시도·이어 하기의 명시된 번호는 그대로다
  bgShow({text:'백그라운드 처리를 시작합니다…',progress:info,summary:!!info,busy:true,cancel:true});
  const r=await rpc({type:'BG_RUN',jobId,tabId:tab.id,source});
  if(!r.ok){bgStopClock();bgShow({text:r.error||'백그라운드 처리를 시작하지 못했습니다.',retry:true});}
  else if(r.already&&r.state==='done'){bgStopClock();bgShow({text:'이미 노트를 만든 강의입니다.'});} // 저장 상자는 곧 오는 BG_DONE이 그린다
  else if(r.already)bgShow({text:'이전에 처리한 강의입니다. 인식 결과를 다시 쓰고 이어서 노트를 만듭니다.',busy:true,cancel:true});
}
// 패널을 열 때: 유료 계정이면 카드를 실시간 캡처 블록 위의 주 경로로 옮기고(bgLayout), 끝나지 않은 작업이 있으면 알린다(이어 하기는 같은 jobId로 BG_RUN).
async function bgInit(){
  if(!settings?.serviceUrl||!(settings.authSession||settings.appSessionToken))return;
  const r=await rpc({type:'BG_LIST'});
  if(!r.ok||!r.background)return;
  bgEl.bgBox.hidden=false;
  bgLayout(true);
  bgTabCheck();
  const open=r.jobs.find(j=>j.running)||r.jobs[0];
  if(!open)return;
  bg={jobId:open.jobId,code:open.code};
  if(open.running){bgRunShow(open.state);return;}
  const reason=bgReason(open.code);
  bgShow({text:`이어서 처리할 작업이 있습니다: ${BG_STATE[open.state]||({paused:'일시정지',failed:'중단'})[open.state]||'처리 중'}${reason?` — ${reason}`:''}`,retry:true,discard:true});
}
// 유료는 백그라운드가 주 경로: 카드를 준비 화면 맨 위(실시간 캡처 블록보다 위)로 옮기고 주 버튼으로 만든다. 로그아웃하면 원래 자리(stageReady 맨 끝)로 되돌린다.
function bgLayout(paid){
  if(paid){els.stageReady.insertBefore(bgEl.bgBox,els.stageReady.children[0]||null);bgEl.bgBtn.className='primary';els.startBtn.textContent='실시간으로 캡처';els.startBtn.className='';}
  else{els.stageReady.append(bgEl.bgBox);bgEl.bgBtn.className='';els.startBtn.textContent='캡처 시작';els.startBtn.className='primary';bgEl.bgBox.hidden=true;}
}
// 선택한 탭이 YouTube 계열이면 클릭 전부터 막는다 — 달리는 작업(bgBusy)의 진행 문구는 덮지 않는다.
function bgTabCheck(){
  const tab=tabs.find(t=>String(t.id)===els.tabSelect.value);
  bgYt=!!tab&&YOUTUBE.test(new URL(tab.url).hostname);
  if(bgYt&&!bgBusy)bgEl.bgStatus.textContent=YT_MSG;
  else if(!bgYt&&bgEl.bgStatus.textContent===YT_MSG)bgEl.bgStatus.textContent='';
  bgEl.bgBtn.disabled=bgYt||bgBusy;
}
bgEl.bgBtn.addEventListener('click',()=>bgStart());
bgEl.bgRetryBtn.addEventListener('click',()=>bgStart(bg?.jobId,bg?.code==='SRC_AUTH_EXPIRED'?null:bg?.source)); // 로그인 세션이 만료됐다면 강의 탭을 다시 연 뒤라 주소가 바뀌었을 수 있다
bgEl.bgCancelBtn.addEventListener('click',async()=>{bgShow({text:'취소하는 중…',busy:true});await rpc({type:'BG_CANCEL'});});
bgEl.bgLiveBtn.addEventListener('click',start); // 실시간 모드로 가는 유일한 길: 사용자의 클릭
// 필수 동의가 빠졌을 때: 동의 단계를 열고, 동의가 끝났으면 같은 작업으로 이어서 시작한다.
bgEl.bgConsentBtn.addEventListener('click',async()=>{
  bgEl.bgConsentBtn.disabled=true;
  try{
    if(await openOnboarding(['consent'])!==true)return;
    settings=await loadSettings();
    if(bgConsented())bgStart(bg?.jobId,bg?.source);
  }finally{bgEl.bgConsentBtn.disabled=false;}
});
// 인식만 만드는 안내 옆의 인라인 동의 — 다음 작업부터 요약까지 만든다.
bgEl.bgSummaryLink.addEventListener('click',async()=>{if(await openOnboarding(['consent'])===true){settings=await loadSettings();bgEl.bgSummaryLink.hidden=true;}});
// 인식만 끝난 작업의 노트 만들기: 요약 동의가 없으면 동의 단계부터, 그 뒤 보관함 인식 자료로 다시 만든다(LIB_REGENERATE).
bgEl.bgMakeBtn.addEventListener('click',async()=>{
  const pkg=bg?.pkg;if(!pkg)return; // 동의 창을 닫으면 bgInit()이 bg를 새로 만든다 — 시작할 때의 패키지를 쥐고 간다
  bgEl.bgMakeBtn.disabled=true;
  try{
    settings=settings||await loadSettings();
    if(!summaryAllowed(settings)&&await openOnboarding(['consent'])!==true)return;
    const r=await rpc({type:'LIB_REGENERATE',packageId:pkg,options:{syntheticExamples:false,externalAugmentation:false}});
    if(!r?.ok){bgEl.bgStatus.textContent=r?.error||'노트를 만들지 못했습니다.';return;}
    renderSaved(bgEl.bgSave,r.saved||null,pkg);
    bgEl.bgMakeBtn.hidden=true;
    bgEl.bgStatus.textContent=`노트 준비됨${r.status==='partial'?' (일부 섹션 제외)':''}`;
  }finally{bgEl.bgMakeBtn.disabled=false;}
});
// 이어 하기를 원치 않는 멈춘 작업은 확인 뒤 버린다(BG_DISCARD).
bgEl.bgDiscardBtn.addEventListener('click',async()=>{
  if(typeof confirm==='function'&&!confirm('이 백그라운드 작업을 버립니다. 계속할까요?'))return;
  const r=await rpc({type:'BG_DISCARD',jobId:bg?.jobId});
  if(r?.ok){bg=null;bgShow({text:'작업을 버렸습니다.'});}
});
chrome.runtime.onMessage.addListener((message,sender)=>{try{
  const url=new URL(sender.url),base=new URL(chrome.runtime.getURL(''));
  if(sender.id!==chrome.runtime.id||url.protocol!==base.protocol||url.host!==base.host||message?.target!=='panel'||!bg||message.jobId!==bg.jobId)return;
  if(url.pathname==='/offscreen.html'&&message.type==='BG_PROGRESS')bgRunShow(message.state,Object.entries(message.counts||{}).filter(([k])=>BG_COUNT[k]).map(([k,n])=>`${BG_COUNT[k]} ${n}`).join(' · '));
  else if(url.pathname==='/background.js'&&message.type==='BG_DONE'){
    bg.code=message.code;if(message.packageId)bg.pkg=message.packageId;
    bgStopClock();
    bgShow(bgDoneView(message));
    renderSaved(bgEl.bgSave,['complete','partial','done'].includes(message.status)?message.saved||null:null,message.packageId);
  }
}catch{}});
(async()=>{rpc({type:'PANEL_OPENED'});settings=await loadSettings();els.ocrEnabledToggle.checked=settings.ocrEnabled!==false;els.whisperEnabledToggle.checked=settings.whisperEnabled!==false;els.langSelect.value=settings.whisperLang||'auto';await loadTabs();const result=await action('GET_STATE');const ob=await obCheck();const steps=onboardingSteps(settings,ob.session,ob.plan,ob.libraryKey);if(steps.length)openOnboarding(steps);els.obWhisper.checked=!!settings.whisperEnabled;els.genSynthetic.checked=settings.noteOptions?.syntheticExamples===true;els.genAugment.checked=settings.noteOptions?.externalAugmentation===true;render(result?.state||null);updateReadyCard();bgInit();})().catch(error=>setError(error.message));

// 계정 메뉴. 오류는 메뉴 안에 짧게 알리고 던지지 않는다.
const menu=$('accountMenu'),menuBtn=$('menuBtn'),amHead=$('amHead'),amErr=$('amErr'),PLANS={free:'Free',essential:'Essential',professional:'Pro'};
const menuItems=()=>[...menu.querySelectorAll('[role=menuitem]:not([hidden])')];
const amErrShow=msg=>{amErr.textContent=msg||'';amErr.hidden=!msg;};
function closeMenu(back){menu.hidden=true;menuBtn.setAttribute('aria-expanded','false');if(back)menuBtn.focus();}
function renderHead(session,user,plan){
  const el=(t,c,x)=>{const e=document.createElement(t);if(c)e.className=c;if(x!==undefined)e.textContent=x;return e;};
  $('amLogout').hidden=!session;amHead.replaceChildren();
  if(!session){const b=el('button','', 'Google로 로그인');b.id='amLogin';b.type='button';b.className='primary';b.addEventListener('click',login);amHead.append(b);return;}
  const av=el('div','am-avatar',(user.name||'?').trim().slice(0,1).toUpperCase());
  if(user.avatar){const i=new Image();i.alt='';i.referrerPolicy='no-referrer';i.src=user.avatar;i.onload=()=>av.replaceChildren(i);}
  const who=el('div','am-who');who.append(el('b','',user.name),el('span','',user.email));
  const row=el('div','am-user');row.append(av,who);amHead.append(row,el('span','am-plan',plan));
}
async function openMenu(){
  menu.hidden=false;menuBtn.setAttribute('aria-expanded','true');amErrShow('');menuItems()[0]?.focus();
  try{
    const s=await Account.getSession();
    if(!s)return renderHead(null);
    const user=Account.decodeUser(s.access_token);renderHead(s,user,'—');
    // 등급과 이번 달 인식 분량. my_account는 서버가 한도를 거는 것과 같은 표(plans·monthly_usage)를 읽는다.
    const acc=await Account.fetchAccount(s);if(acc)renderHead(s,user,(PLANS[acc.plan]||'—')+(acc.minutes_limit!=null?` · 이번 달 ${acc.minutes_used??0}/${acc.minutes_limit}분`:''));
  }catch{amErrShow('계정 정보를 불러오지 못했습니다.');}
}
async function login(){
  amErrShow('');
  try{await Account.signIn();}catch{amErrShow('로그인하지 못했습니다. 다시 시도해 주세요.');return;}
  await openMenu();
  // 로그인으로 달라진 계정·플랜으로 온보딩 필요 여부를 다시 본다(새 동의·보관함 암호가 필요할 수 있다).
  try{
    settings=await loadSettings();
    const{folder}=await obCheck();
    const steps=onboardingSteps(settings,obSession,obPlan,folder);
    if(steps.length){closeMenu();openOnboarding(steps);}else{onboardingOpen=false;obFinish(true);} // 메뉴가 온보딩을 가리지 않게 닫고 연다
    render(state);bgInit();
  }catch{}
}
menuBtn.addEventListener('click',()=>menu.hidden?openMenu():closeMenu(true));
menu.addEventListener('click',async e=>{
  const b=e.target.closest('[role=menuitem]');if(!b)return;
  const{path,href,act}=b.dataset;
  if(act==='logout'){try{await Account.signOut();renderHead(null);amErrShow('');menuItems()[0]?.focus();await obCheck();bg=null;bgLayout(false);render(state);}catch{amErrShow('로그아웃하지 못했습니다.');}return;}
  closeMenu(true);
  if(act==='options')chrome.runtime.openOptionsPage();else chrome.tabs.create({url:href||Account.SITE+path});
});
document.addEventListener('click',e=>{if(!menu.hidden&&!menu.contains(e.target)&&!menuBtn.contains(e.target))closeMenu();});
document.addEventListener('keydown',e=>{
  if(menu.hidden)return;
  if(e.key==='Escape'){e.preventDefault();closeMenu(true);return;}
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){
    const it=[...(amHead.querySelector('button')?[amHead.querySelector('button')]:[]),...menuItems()],i=it.indexOf(document.activeElement);
    e.preventDefault();it[(i+(e.key==='ArrowDown'?1:-1)+it.length)%it.length]?.focus();
  }
});

// ── 온보딩: 계정 → 동의 → 보관함 폴더 → 받아쓰기. 부족한 단계만 연다(openOnboarding).
// render는 settings.consentAccepted가 아니라 이 플래그로 온보딩 화면을 고른다 - 동의는 끝났는데 보관함 폴더가 없는 경우처럼 부분만 다시 열어야 해서다.
let onboardingOpen=false,obSession=null,obPlan='free',obSteps=[],obAcct=null,obFolder={state:'none',name:''};
// 지금 상태의 로그인 세션·플랜·보관함 폴더. 로그인돼 있으면 이 계정의 노트 키도 기기에 둔다(이미 있으면 네트워크 없이). 각 조회 실패는 로그아웃·Free·폴더 없음으로 접는다(Account·NoteFile이 없는 테스트 환경 포함).
// step이 오면 각 조회 시간을 단계 이름과 함께 넘긴다(로그인 진단). 계정 조회와 키 확보·폴더 확인은 서로를 기다릴 게 없어 같이 시작한다.
async function obCheck(step){
  const timed=(name,work)=>{const s=Date.now();return Promise.resolve(work).finally(()=>{try{step?.(name,Date.now()-s);}catch{}});};
  try{obSession=await timed('session',Account.getSession());}catch{obSession=null;}
  if(obSession)obShowAccount(); // 세션이 확인되는 즉시 이메일 행부터 보여 주고 플랜은 조회 뒤에 채운다
  const[acct,folder]=await Promise.all([
    timed('account',(async()=>obSession?await Account.fetchAccount(obSession):null)().catch(()=>null)),
    timed('library_key',(async()=>{if(obSession)await ensureLibraryKey().catch(()=>null);return LibraryFolder.status(await PackageStore.indexedDbAdapter());})().catch(()=>({state:'none',name:''}))),
  ]);
  // 플랜 조회가 실패하면 Free 로 떨어뜨리지 않는다 — 이 기기에서 마지막으로 확인한 같은 계정의 플랜을 쓴다(플랜 이름은 민감 정보가 아니다).
  const planKey=obSession?'summrizei.plan.'+(()=>{try{return Account.decodeUser(obSession.access_token).id;}catch{return '';}})():'';
  if(acct?.plan)try{localStorage.setItem(planKey,acct.plan);}catch{}
  let cached=null;if(!acct&&planKey)try{cached=localStorage.getItem(planKey);}catch{}
  obAcct=acct;obPlan=acct?.plan||cached||'free';obFolder=folder;
  if(obSession)obShowAccount();
  return {session:obSession,plan:obPlan,folder:obFolder};
}
// 열어야 할 온보딩 단계 목록. 모두 갖췄으면 [].
function onboardingSteps(settings,session,plan,folder){
  const steps=[],paid=plan!=='free',bg=settings?.backgroundConsent||{};
  if(!session)steps.push('account');
  if(!summaryAllowed(settings)
    ||(paid&&!cloudRecognitionAllowed(settings))
    ||(paid&&(bg.personalUse===true||bg.accessRights===true)&&!backgroundAllowed(settings)))steps.push('consent');
  if(folder?.state==='none')steps.push('folder'); // 권한만 거둬진 폴더(needs-permission)는 막지 않는다 — 준비 카드의 '다시 허용'과 저장 뒤 안내가 맡는다
  if(settings?.consentAccepted!==true)steps.push('engine');
  return steps;
}
function obShowAccount(){
  els.obLogin.hidden=!!obSession;els.obAccount.hidden=!obSession;
  if(!obSession)return;
  let email='';
  try{email=Account.decodeUser(obSession.access_token).email;}catch{}
  els.obAccount.textContent=`${email||'로그인됨'} · ${PLANS[obPlan]||obPlan}`;
}
function obValidate(){
  let ok=true;
  if(obSteps.includes('account')&&!obSession)ok=false;
  if(obSteps.includes('consent')&&!els.obSummary.checked)ok=false;
  if(obSteps.includes('consent')&&obPlan!=='free'&&!els.obCloud.checked)ok=false;
  if(obSteps.includes('folder')&&obFolder.state!=='ok')ok=false;
  els.obDone.disabled=!ok;
}
// 열린 온보딩을 기다리는 약속: 완료하면 true, 다른 단계로 다시 열려 대체되면 false로 끝낸다.
let obResolve=null;
const obFinish=ok=>{const r=obResolve;obResolve=null;r?.(ok);};
function openOnboarding(steps){
  obFinish(false);
  obSteps=steps;onboardingOpen=true;
  for(const section of els.onboard.querySelectorAll?.('section[data-step]')||[])section.hidden=!steps.includes(section.dataset.step);
  for(const row of [els.obCloudRow,els.obPersonalRow,els.obAccessRow])if(row)row.hidden=obPlan==='free';
  // 동의 단계를 다시 열 때는 현재 설정이 TERMS_VERSION에 아직 유효한 것만 미리 체크한다 — 유효하지 않으면 다시 받는다.
  if(steps.includes('consent')){
    const bgValid=backgroundAllowed(settings);
    els.obCloud.checked=cloudRecognitionAllowed(settings);
    els.obPersonal.checked=bgValid&&settings?.backgroundConsent?.personalUse===true;
    els.obAccess.checked=bgValid&&settings?.backgroundConsent?.accessRights===true;
  }
  if(steps.includes('engine'))els.obWhisper.checked=settings?.whisperEnabled===true;
  els.obError.hidden=true;
  obShowAccount();obValidate();
  setStage('onboard');
  return new Promise(resolve=>{obResolve=resolve;});
}
els.obLogin.addEventListener('click',async()=>{
  els.obLogin.disabled=true;els.obAccountErr.hidden=true;
  const{rec,total,signIn}=loginClock();
  try{
    await signIn();
    // 로그인은 설정을 바꾸지 않는다 — 열릴 때 읽은 설정을 그대로 쓰고 없을 때만 읽는다.
    let s=Date.now();settings=settings||await loadSettings();rec('settings',Date.now()-s);
    const{folder}=await obCheck(rec);
    // 로그인으로 알게 된 플랜이 유료면 새로 필요해진 동의 단계를 더 연다. 계정 단계는 <email> · <plan> 확인을 보여 주기 위해 그대로 둔다.
    const next=onboardingSteps(settings,obSession,obPlan,folder);
    if(obSteps.includes('account')&&!next.includes('account'))next.unshift('account');
    s=Date.now();openOnboarding(next);rec('render',Date.now()-s);
  }catch(error){els.obAccountErr.textContent=error.message||'로그인하지 못했습니다. 다시 시도해 주세요.';els.obAccountErr.hidden=false;}
  finally{total();els.obLogin.disabled=false;obValidate();}
});
els.obSummary.addEventListener('change',obValidate);
els.obCloud.addEventListener('change',obValidate);
// 폴더 선택 창은 사용자 클릭 안에서만 열린다. 고른 폴더 이름을 보여 주고, 이후 노트는 묻지 않고 여기에 저장한다.
els.obFolderBtn.addEventListener('click',async()=>{
  els.obFolderBtn.disabled=true;els.obFolderErr.hidden=true;
  try{
    await chooseFolder();
    els.obFolderName.textContent=obFolder.state==='ok'?`선택한 폴더: ${obFolder.name}`:'';els.obFolderName.hidden=obFolder.state!=='ok';
  }catch(error){els.obFolderErr.textContent=error.message||'폴더를 지정하지 못했습니다.';els.obFolderErr.hidden=false;}
  finally{els.obFolderBtn.disabled=false;obValidate();}
});
els.obDone.addEventListener('click',async()=>{
  els.obDone.disabled=true;els.obError.hidden=true;
  try{
    // 요약 동의는 동의 단계를 열고 체크했을 때만 새로 찍는다 — 폴더·엔진 단계만 다시 열어도 동의를 주거나 시각을 갱신하면 안 된다.
    const patch={consentAccepted:true};
    if(obSteps.includes('consent')){
      if(els.obSummary.checked){patch.remoteSummaryConsent=true;patch.summaryConsentVersion=TERMS_VERSION;patch.summaryConsentAt=Date.now();}
      if(!els.obCloudRow.hidden){patch.visionConsent=els.obCloud.checked;patch.visionConsentVersion=els.obCloud.checked?TERMS_VERSION:'';patch.visionConsentAt=els.obCloud.checked?Date.now():0;}
      if(!els.obPersonalRow.hidden)patch.backgroundConsent={personalUse:els.obPersonal.checked,accessRights:els.obAccess.checked,version:TERMS_VERSION,at:Date.now()};
    }
    if(obSteps.includes('engine'))patch.whisperEnabled=els.obWhisper.checked;
    await saveSettings(patch);
    if(obSteps.includes('folder'))rpc({type:'LIB_EXPORT_ALL'}); // 이전에 만든 노트가 있으면 새 폴더에도 써 둔다(처리 중이면 건너뛴다)
    settings=await loadSettings();
    els.whisperEnabledToggle.checked=settings.whisperEnabled===true; // 엔진 단계가 저장한 값으로 서랍 토글도 맞춘다
    await obCheck(); // 닫힐 때 준비 카드의 계정·노트 저장 행도 새 캐시로 고친다
    onboardingOpen=false;
    obFinish(true);
    render(state);
    bgInit();
  }catch(error){els.obError.textContent=error.message;els.obError.hidden=false;}
  finally{obValidate();}
});
