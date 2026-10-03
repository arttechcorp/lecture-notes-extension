// Display and control only. The offscreen document owns all lecture data.
const $=id=>document.getElementById(id);
const els=Object.fromEntries(['tabSelect','modeSelect','langSelect','startBtn','stopBtn','pauseBtn','disposeBtn','notesBtn','status','renderFrame','stageReady','stageLive','stageDone','onboard','obLogin','obAccount','obAccountErr','obSummary','obCloud','obCloudRow','obPersonal','obPersonalRow','obAccess','obAccessRow','obPass','obPass2','obPassErr','obError','obWhisper','obDone','settingsToggle','settingsClose','settingsDrawer','optionsLink','refreshTabsBtn','ocrEnabledToggle','cntSlides','cntVoice','cntQueue','feedLines','readyAlert','panelAlert','doneSummary','donePill','doneAlert','againBtn','popoutBtn','debugDetails','debugLog','markEngine','engineBanner','markVoice','voiceState','markTab','tabState','settingsSummary','cropField','cropRow','cropWrap','cropImg','cropBox','cropHint','previewBtn','working','workingText','saveBox','doneNotices','recognitionBox','makeNoteBtn','genBox','genSynthetic','genAugment','genAgainBtn'].map(id=>[id,$(id)]));
let settings,state,busy=false,tabs=[],cropRect=null,cropTabId=null;
const active=s=>['preparing','running','paused','draining','summarizing'].includes(s?.status);
const label={preparing:'준비 중',running:'캡처 중',paused:'일시정지',draining:'마지막 구간 처리 중',summarizing:'요약 중',completed:'노트 준비됨',failed:'처리 중단',disposed:'세션 없음'};
const rpc=message=>new Promise(resolve=>chrome.runtime.sendMessage({...message,target:'background'},response=>{const error=chrome.runtime.lastError;resolve(response||{ok:false,error:error?'세션에 다시 연결하지 못했습니다.':'응답이 없습니다.'});}));
const setStatus=text=>els.status.textContent=text||'';
const setError=text=>{for(const alert of [els.readyAlert,els.panelAlert,els.doneAlert]){alert.hidden=!text;alert.textContent=text||'';}};
function setStage(name){els.stageReady.hidden=name!=='ready';els.stageLive.hidden=name!=='live';els.stageDone.hidden=name!=='done';els.onboard.hidden=name!=='onboard';for(const [id,on] of [['stepReady',name==='ready'],['stepLive',name==='live'],['stepDone',name==='done']]){const node=$(id);if(node)node.className=on?'active':'';}if(name!=='ready')els.settingsDrawer.hidden=true;}
function controls(){const has=!!state&&state.status!=='disposed';els.startBtn.disabled=busy||active(state)||!tabs.some(tab=>String(tab.id)===els.tabSelect.value);els.stopBtn.disabled=busy||!active(state);if(els.pauseBtn){els.pauseBtn.disabled=busy||!['running','paused'].includes(state?.status);els.pauseBtn.textContent=state?.status==='paused'?'다시 시작':'일시정지';}if(els.disposeBtn)els.disposeBtn.disabled=busy||active(state)||!has;els.notesBtn.disabled=busy||regenBusy||!['completed','failed'].includes(state?.status)||!((state?.counts?.visual||0)+(state?.counts?.audio||0)>0);if(els.makeNoteBtn)els.makeNoteBtn.disabled=regenBusy;if(els.genAgainBtn)els.genAgainBtn.disabled=regenBusy;}
function format(t){return `${Math.floor((t||0)/60)}:${String(Math.floor((t||0)%60)).padStart(2,'0')}`;}
// 패널은 노트를 보여 주지 않는다 — 완성 노트는 암호화 파일로 저장돼 웹사이트 보관함(Account.SITE/library)에서
// 보관함 암호를 넣어 연다. 샌드박스에는 인식 결과 미리보기만 보낸다(RENDER_RECOGNITION).
const postToFrame=message=>els.renderFrame?.contentWindow?.postMessage(message,'*');
// 저장 상태 상자. 완료 화면과 (이후) 백그라운드 작업 카드가 같은 함수를 쓴다.
// saved: "file"(파일로 저장됨) / "no-passphrase"(보관함 암호 없음) / "failed"(저장 실패) / null(표시 없음).
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
    say('노트를 암호화해 다운로드/Summrizei 폴더에 저장했습니다. 웹사이트에서 보관함 암호를 넣어 엽니다.');
    const row=document.createElement('div');
    row.className='btnrow';
    row.append(
      button('웹에서 노트 열기',()=>chrome.tabs.create({url:Account.SITE+'/library'})),
      button('저장 폴더 열기',async()=>{
        const r=await rpc({type:'LIB_SHOW',packageId});
        if(!r?.ok)setStatus(r?.error||'저장 폴더를 열지 못했습니다.');
      }),
    );
    box.append(row);
  }else if(saved==='no-passphrase'){
    say('보관함 암호가 없어 파일로 저장하지 못했습니다.');
    box.append(button('암호 정하고 저장',async()=>{
      if(await openOnboarding(['passphrase'])!==true)return;
      await exportAll();
    }));
  }else if(saved==='failed'){
    say('노트 파일을 저장하지 못했습니다.');
    box.append(button('다시 저장',exportAll));
  }
}
// LIB_REGENERATE: 보관함에 저장된 인식 자료로 노트를 다시 만든다(인식만 끝난 강의의 노트화·생성 옵션 변경).
// 몇 분 걸린다 — 진행은 working 표시와 상태 문구로 알리고, 결말은 {ok,status,code,saved}로 온다.
let regenBusy=false;
async function regenerate(options){
  const packageId=state?.summary?.packageId;
  if(!packageId){setError('다시 만들 노트 자료가 없습니다.');return;}
  setError('');
  setStatus('노트를 만드는 중… 몇 분 걸릴 수 있습니다.');
  regenBusy=true;
  setWorking();
  controls();
  try{
    const r=await rpc({type:'LIB_REGENERATE',packageId,options});
    if(!r?.ok){
      setStatus('');
      setError(r?.error||'노트를 만들지 못했습니다.');
      return;
    }
    const sum=state?.summary;
    if(sum){
      sum.saved=r.saved??sum.saved;
      if(r.status==='complete'||r.status==='partial'){sum.status=r.status;sum.note=sum.note||{};}
    }
    render(state);
    if(sum?.note)els.donePill.textContent='노트 완성';
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
function updateReadyCard(){if(!settings)return;setRow(els.markEngine,els.engineBanner,els.ocrEnabledToggle?.checked===false?'off':'ok',els.ocrEnabledToggle?.checked===false?'꺼짐':settings.ocrEngine==='vision-cloud'?'고화질 화면 인식 (서비스 경유)':'PP-OCRv5 한국어 (WASM)');setRow(els.markVoice,els.voiceState,settings.whisperEnabled?'ok':'off',settings.whisperEnabled?`Whisper ${settings.whisperModel==='base-wasm'?'Base 저사양 · WASM':'Small q8/q4 · WebGPU'} (로컬)`:'꺼짐');const tabOpt=els.tabSelect?.selectedOptions?.[0];setRow(els.markTab,els.tabState,tabOpt?'ok':'warn',tabOpt?tabOpt.textContent:'선택된 탭 없음');const isRegion=els.modeSelect.value==='region';if(els.cropRow)els.cropRow.style.display=isRegion?'flex':'none';if(!isRegion&&els.cropWrap)els.cropWrap.style.display='none';if(els.cropField)els.cropField.hidden=els.ocrEnabledToggle?.checked===false;let modeDesc='영상 전체';if(els.modeSelect.value==='caption')modeDesc='하단 자막 띠';else if(isRegion)modeDesc=cropRect?`영역 지정 (${Math.round(cropRect.w*100)}%×${Math.round(cropRect.h*100)}%)`:'영역 지정 (슬라이드)';if(els.settingsSummary)els.settingsSummary.textContent=`${modeDesc} · ${{auto:'자동 감지(한국어 우선)',ko:'한국어',en:'영어'}[settings.whisperLang]||'한국어'}`;}
// One indicator for both waits the user actually has to sit through: summarising, and the recognition backlog
// that has to drain before a note can be made.
function setWorking(){if(!els.working)return;const s=state?.status,queued=(state?.backlog?.images||0)+(state?.backlog?.audio||0);const making=busy||regenBusy||s==='summarizing';els.working.hidden=!(making||s==='draining'||(active(state)&&queued>0));if(els.workingText)els.workingText.textContent=making?'노트를 만드는 중입니다. 몇 분 걸릴 수 있습니다.':'남은 인식을 마무리하는 중입니다.';}
function render(next){if(next&&state&&next.generation<state.generation)return;const was=state?.status;state=next||null;const s=state?.status;setStatus(label[s]||'세션 없음');setError(state?.error);if(onboardingOpen)setStage('onboard');else if(!state||s==='disposed')setStage('ready');else if(active(state)&&s!=='summarizing')setStage('live');else setStage('done');els.cntSlides.textContent=state?.counts?.visual||0;els.cntVoice.textContent=state?.counts?.audio||0;els.cntQueue.textContent=(state?.backlog?.images||0)+(state?.backlog?.audio||0);els.feedLines.textContent='';const recent=state?.recent||[],gaps=state?.gaps||[];if(recent.length){for(const item of recent){const row=document.createElement('div'),time=document.createElement('span');time.className='t';time.textContent=`${format(item.time)} · ${item.source==='asr'?'음성':'화면'}`;row.append(time,document.createTextNode(item.text));els.feedLines.append(row);}}else if(gaps.length){for(const gap of gaps.slice(-3)){const row=document.createElement('div');row.textContent=`${format(gap.time)} · ${gap.reason}`;els.feedLines.append(row);}}else els.feedLines.textContent=active(state)?'인식 결과를 기다리는 중입니다.':'표시할 처리 구간이 없습니다.';els.debugLog.textContent=state?.debug?.join('\n')||'세션을 시작하면 음성 진단 정보가 표시됩니다.';els.debugLog.scrollTop=els.debugLog.scrollHeight;if(s==='failed'&&state?.error?.includes('음성'))els.debugDetails.open=true;els.donePill.textContent=s==='summarizing'?'요약 중':s==='failed'?'중단됨':state?.summary?.status==='recognition-only'?'인식만 완료':state?.summary?.status==='partial'?'일부 완료':state?.summary?.note?'노트 완성':'인식 완료';els.doneSummary.textContent=state?`화면 ${state.counts.visual} · 음성 ${state.counts.audio}`:'';renderSummary(state?.summary);doneAlertExtras();setWorking();controls();updateReadyCard();if(shouldAutoSummarize(was,state))autoSummarize();}
// 캡처가 끝나면 노트 화면이 비어 있으면 안 된다. 요약을 한 번 자동으로 이어 돌린다 —
// 중지 버튼뿐 아니라 영상 종료·트랙 종료 같은 자동 종료 경로도 모두 여기(completed 전이)로 모인다.
// 세션당 1회로 제한한다: 실패한 요약을 무한히 다시 부르지 않기 위해서다.
function shouldAutoSummarize(was,next){return !!was&&active({status:was})&&next?.status==='completed'&&!next.summary&&!next.error&&!!(next.counts?.visual||next.counts?.audio);}
let autoSummaryKey='';
function autoSummarize(){const key=`${state.sessionId}:${state.generation}`;if(autoSummaryKey===key)return;autoSummaryKey=key;setTimeout(async()=>action('GENERATE_NOTES',{settings:await loadSettings()}),0);}
async function action(type,extra={}){if(busy&&type!=='STOP_SESSION'&&type!=='CANCEL_SUMMARY')return null;busy=true;setError('');if(type==='START_SESSION')setStatus('강의 탭 확인 중…');setWorking();controls();try{const result=await rpc({type,...extra,...(state&&type!=='START_SESSION'?{sessionId:state.sessionId,generation:state.generation}:{})});if(result.state!==undefined)render(result.state);if(!result.ok)throw new Error(result.error||'요청을 완료하지 못했습니다.');return result;}catch(error){setError(error.message);return null;}finally{busy=false;setWorking();controls();}}
async function loadTabs(){const selected=els.tabSelect.value,requested=new URLSearchParams(location.search).get('tabId');const [all,[focused]]=await Promise.all([chrome.tabs.query({}),chrome.tabs.query({active:true,currentWindow:true})]);tabs=all.filter(tab=>/^https?:/.test(tab.url||''));els.tabSelect.textContent='';for(const tab of tabs){const opt=document.createElement('option');opt.value=tab.id;opt.textContent=`${new URL(tab.url).hostname} — ${(tab.title||'강의 탭').slice(0,60)}`;els.tabSelect.append(opt);}const target=selected||requested||String(focused?.id??'');if(target)els.tabSelect.value=target;controls();updateReadyCard();}
function rect(){if(els.modeSelect.value==='caption')return{x:0,y:.8,w:1,h:.2};if(els.modeSelect.value==='region'&&cropRect)return cropRect;return{x:0,y:0,w:1,h:1};}
async function start(){settings=await loadSettings();if(!settings.consentAccepted){setStage('onboard');return;}if(!tabs.some(tab=>String(tab.id)===els.tabSelect.value)){setError('선택한 강의 탭이 없습니다. 강의 창에서 확장을 다시 여세요.');return;}if(!els.ocrEnabledToggle.checked&&!settings.whisperEnabled){setError('화면 또는 음성 인식 중 하나를 켜세요.');return;}if(els.ocrEnabledToggle.checked&&els.modeSelect.value==='region'&&(!cropRect||cropTabId!==els.tabSelect.value)){els.settingsDrawer.showModal();els.cropHint.textContent='현재 강의 화면을 불러오고 인식할 슬라이드 영역을 드래그하세요.';setError('화면을 불러온 뒤 인식할 슬라이드 영역을 드래그하세요.');els.previewBtn.focus();return;}await action('START_SESSION',{settings,options:{tabId:Number(els.tabSelect.value),rect:rect(),ocrEnabled:els.ocrEnabledToggle.checked,ocrEngine:settings.ocrEngine||'ppocr-v5-wasm',visionConsent:settings.visionConsent===true,whisperEnabled:settings.whisperEnabled,whisperModel:settings.whisperModel,whisperLang:settings.whisperLang,speedCorrection:settings.speedCorrection===true}});}
els.startBtn.addEventListener('click',start);els.stopBtn.addEventListener('click',()=>action(state?.status==='summarizing'?'CANCEL_SUMMARY':'STOP_SESSION'));els.notesBtn.addEventListener('click',async()=>action('GENERATE_NOTES',{settings:await loadSettings()}));els.againBtn.addEventListener('click',()=>action('DISPOSE_SESSION'));els.settingsToggle.addEventListener('click',()=>els.settingsDrawer.showModal());els.settingsClose.addEventListener('click',()=>els.settingsDrawer.close());els.refreshTabsBtn.addEventListener('click',loadTabs);els.tabSelect.addEventListener('change',()=>{cropRect=null;cropTabId=null;els.cropBox.style.display='none';controls();updateReadyCard();});els.ocrEnabledToggle.addEventListener('change',async()=>{settings=await saveSettings({ocrEnabled:els.ocrEnabledToggle.checked});updateReadyCard();});els.modeSelect.addEventListener('change',updateReadyCard);els.langSelect.addEventListener('change',async()=>{settings=await saveSettings({whisperLang:els.langSelect.value});updateReadyCard();});els.optionsLink.addEventListener('click',event=>{event.preventDefault();chrome.runtime.openOptionsPage();});
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
const bgEl=Object.fromEntries(['bgBox','bgBtn','bgStatus','bgProgress','bgRetryBtn','bgCancelBtn','bgLiveBtn','bgOptionsLink','bgNoteBtn'].map(id=>[id,$(id)]));
const YOUTUBE=/(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com|googlevideo\.com)$/i; // lib/background-job.js와 같은 목록(§19)
const BG_STATE={created:'준비',acquiring_source:'소스 확인',ingesting:'수신·인식',refining:'정제',judging:'판정',planning:'계획',writing:'작성',validating:'검증',rendering:'렌더'},BG_COUNT={recv:'수신',decode:'해석',vision:'화면',stt:'음성',write:'작성'};
let bg=null; // {jobId,source?,code?}. 패널을 닫으면 사라진다 — 이어 할 작업은 BG_LIST가 다시 알려 준다.
// 요약 동의는 시작 조건이 아니다 — 없으면 인식 결과만 만들 뿐이다(시작 전에 알린다). 이용 동의와 클라우드 인식 동의만 필수.
const bgConsented=()=>backgroundAllowed(settings)&&cloudRecognitionAllowed(settings);
const NO_SUMMARY='외부 요약 처리에 동의하지 않아 인식 결과만 만듭니다. 노트가 필요하면 설정에서 동의하세요.';
function bgShow({text='',progress='',busy=false,cancel=false,retry=false,live=false,options=false,open=false,retryLabel}={}){
  bgEl.bgStatus.textContent=text;bgEl.bgProgress.textContent=progress;
  bgEl.bgBtn.disabled=busy;bgEl.bgCancelBtn.hidden=!cancel;bgEl.bgRetryBtn.hidden=!retry;bgEl.bgRetryBtn.textContent=retryLabel||'다시 시도';bgEl.bgLiveBtn.hidden=!live;bgEl.bgOptionsLink.hidden=!options;bgEl.bgNoteBtn.hidden=!open;
}
// BG_DONE → 화면. 안내 문구는 offscreen이 파이프라인 CODES의 userMessage로 실어 보낸다. 실시간 모드 버튼은 suggest:"live"일 때만 나온다.
const BG_NOTE={ // 완료 고지 코드 → 사용자 문장. n은 건수(없으면 1). NOTE_ADVISORY_*는 렌더러 힌트라 여기 없다
  NOTE_CAPTURE_GAP:n=>`인식하지 못한 구간 ${n}곳`,
  NOTE_SECTIONS_FAILED:n=>`요약하지 못한 단원 ${n}개`,
  NOTE_BLOCKS_DROPPED:n=>`검증을 통과하지 못해 뺀 내용 ${n}건`,
  NOTE_UNITS_UNCITED:n=>`노트에 반영되지 않은 강의 구간 ${n}곳`,
  NOTE_GLOBAL_FAILED:()=>'강의 전체 요약을 만들지 못했습니다',
  NOTE_JUDGE_SKIPPED:()=>'중요도 판정 없이 만들었습니다',
  NOTE_FORMULAS_IMAGE:n=>`원본 이미지로 표시한 수식 ${n}개`,
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
    if(code.startsWith('NOTE_ADVISORY_')||code.startsWith('CONSENT_'))continue; // CONSENT_*는 고지가 아니라 따로 UI가 받는다
    lines.push((BG_NOTE[code]?BG_NOTE[code](count):`기타 고지: ${code}×${count}`)+bgRanges(n?.ranges));
  }
  if(pruned)lines.splice(at,0,`연결된 내용이 빠져 함께 뺀 항목 ${pruned}건`);
  return lines;
}
function bgDoneView(d){
  if(['complete','partial','done'].includes(d.status))return {text:[`노트 준비됨${d.status==='partial'?' (일부 섹션 제외)':''} · 슬라이드 ${d.stats?.slides??'-'} · 음성 구간 ${d.stats?.chunks??'-'}`,...bgNoticeLines(d.notices),'암호화 파일로 저장했습니다. 웹사이트 보관함에서 보관함 암호를 넣어 열 수 있습니다.'].join('\n')};
  if(d.status==='cancelled')return {text:'백그라운드 처리를 취소했습니다.'};
  const text=d.message||`백그라운드 처리를 마치지 못했습니다. 같은 문제가 반복되면 메뉴의 고객지원으로 문의해 주세요.${d.code?` (코드: ${d.code})`:''}`;
  if(d.status==='paused'){
    if(d.code==='QUOTA_EXCEEDED')return {text}; // 할당량 초과는 다시 시도해도 성공할 수 없다
    return {text,retry:true,options:/^CONSENT_/.test(d.code||''),retryLabel:d.code==='SRC_AUTH_EXPIRED'?'강의 탭을 연 뒤 다시 시도':undefined};
  }
  return {text,live:d.suggest==='live'};
}
// webRequest(선택 권한)는 사용자가 누른 뒤에만 요청한다. 고른 강의 탭의 media·xhr 응답만 몇 초 보고 바로 해제하며, 주소와 MIME만 분류하고 내용은 보지 않는다.
// ponytail: 이미 로드된 VOD 재생목록은 다시 요청되지 않아 못 찾는다 — 영상을 처음부터 다시 재생하게 안내한다. 지난 요청까지 보려면 content script에서 performance.getEntriesByType("resource")를 읽는다.
function findPlaylist(tabId,ms=8000){
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
// source가 없으면 영상 목록을 찾는다(처음 시작, 그리고 강의 탭을 다시 연 뒤의 재개). 있으면 같은 jobId로 그대로 다시 보낸다.
async function bgStart(jobId=crypto.randomUUID(),source=null){
  const tab=tabs.find(t=>String(t.id)===els.tabSelect.value);
  bg={jobId,source};
  if(!tab){bgShow({text:'선택한 강의 탭이 없습니다. 강의 창에서 확장을 다시 여세요.'});return;}
  if(YOUTUBE.test(new URL(tab.url).hostname)){bgShow({text:'이 사이트는 실시간 모드만 지원합니다. 위의 “캡처 시작”으로 진행하세요.'});return;}
  if(!bgConsented()){settings=await loadSettings();if(!bgConsented()){bgShow({text:'백그라운드 처리에는 이용 동의 2종과 클라우드 인식(화면·음성 전송) 동의가 필요합니다. 설정에서 동의해 주세요.',options:true});return;}}
  // 요약 동의가 없어도 막지 않는다 — 시작 전에 인식만 만들 거라고 알린다(조용한 전환 금지).
  const info=settings?.remoteSummaryConsent===true?'':NO_SUMMARY;
  if(!source){
    bgShow({text:'영상 목록을 찾는 중… 강의 탭에서 영상을 재생하세요.',progress:info,busy:true});
    let url=null;
    try{if(await chrome.permissions.request({permissions:['webRequest']}))url=await findPlaylist(tab.id);}catch{} // 권한 요청은 클릭 제스처 안의 첫 await이어야 한다
    if(!url){bgShow({text:'재생 중인 영상 목록(HLS)을 찾지 못했습니다. webRequest 권한을 허용하고, 영상을 처음부터 다시 재생한 뒤 다시 시도하세요.',retry:true});return;}
    source=bg.source={playlistUrl:url};
  }
  bgShow({text:'백그라운드 처리를 시작합니다…',progress:info,busy:true,cancel:true});
  const r=await rpc({type:'BG_RUN',jobId,tabId:tab.id,source});
  if(!r.ok)bgShow({text:r.error||'백그라운드 처리를 시작하지 못했습니다.',retry:true});
}
// 패널을 열 때: 유료 계정이면 컨트롤을 보이고, 끝나지 않은 작업이 있으면 알린다(이어 하기는 같은 jobId로 BG_RUN).
async function bgInit(){
  if(!settings?.serviceUrl||!(settings.authSession||settings.appSessionToken))return;
  const r=await rpc({type:'BG_LIST'});
  if(!r.ok||!r.background)return;
  bgEl.bgBox.hidden=false;
  const open=r.jobs.find(j=>j.running)||r.jobs[0];
  if(!open)return;
  bg={jobId:open.jobId};
  bgShow(open.running?{text:'백그라운드 처리 중…',busy:true,cancel:true}:{text:`이어서 처리할 작업이 있습니다 (${BG_STATE[open.state]||open.state}${open.code?` · ${open.code}`:''}).`,retry:true});
}
bgEl.bgBtn.addEventListener('click',()=>bgStart());
bgEl.bgRetryBtn.addEventListener('click',()=>bgStart(bg?.jobId,bg?.code==='SRC_AUTH_EXPIRED'?null:bg?.source)); // 로그인 세션이 만료됐다면 강의 탭을 다시 연 뒤라 주소가 바뀌었을 수 있다
bgEl.bgCancelBtn.addEventListener('click',async()=>{bgShow({text:'취소하는 중…',busy:true});await rpc({type:'BG_CANCEL'});});
bgEl.bgLiveBtn.addEventListener('click',start); // 실시간 모드로 가는 유일한 길: 사용자의 클릭
bgEl.bgOptionsLink.addEventListener('click',event=>{event.preventDefault();chrome.runtime.openOptionsPage();});
bgEl.bgNoteBtn.addEventListener('click',()=>chrome.tabs.create({url:Account.SITE+'/library'})); // 노트는 웹사이트 보관함에서 연다
chrome.runtime.onMessage.addListener((message,sender)=>{try{
  const url=new URL(sender.url),base=new URL(chrome.runtime.getURL(''));
  if(sender.id!==chrome.runtime.id||url.protocol!==base.protocol||url.host!==base.host||message?.target!=='panel'||!bg||message.jobId!==bg.jobId)return;
  if(url.pathname==='/offscreen.html'&&message.type==='BG_PROGRESS')bgShow({text:`처리 중 · ${BG_STATE[message.state]||message.state}`,progress:Object.entries(message.counts||{}).filter(([k])=>BG_COUNT[k]).map(([k,n])=>`${BG_COUNT[k]} ${n}`).join(' · '),busy:true,cancel:true});
  else if(url.pathname==='/background.js'&&message.type==='BG_DONE'){bg.code=message.code;if(message.packageId)bg.pkg=message.packageId;bgShow({...bgDoneView(message),open:!!message.packageId});}
}catch{}});
(async()=>{settings=await loadSettings();els.ocrEnabledToggle.checked=settings.ocrEnabled!==false;els.langSelect.value=settings.whisperLang||'auto';await loadTabs();const result=await action('GET_STATE');const ob=await obCheck();const steps=onboardingSteps(settings,ob.session,ob.plan,ob.libraryKey);if(steps.length)openOnboarding(steps);els.obWhisper.checked=!!settings.whisperEnabled;els.genSynthetic.checked=settings.noteOptions?.syntheticExamples===true;els.genAugment.checked=settings.noteOptions?.externalAugmentation===true;render(result?.state||null);updateReadyCard();bgInit();})().catch(error=>setError(error.message));

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
    const{libraryKey}=await obCheck();
    const steps=onboardingSteps(settings,obSession,obPlan,libraryKey);
    if(steps.length)openOnboarding(steps);else{onboardingOpen=false;obFinish(true);}
    render(state);bgInit();
  }catch{}
}
menuBtn.addEventListener('click',()=>menu.hidden?openMenu():closeMenu(true));
menu.addEventListener('click',async e=>{
  const b=e.target.closest('[role=menuitem]');if(!b)return;
  const{path,href,act}=b.dataset;
  if(act==='logout'){try{await Account.signOut();renderHead(null);amErrShow('');menuItems()[0]?.focus();}catch{amErrShow('로그아웃하지 못했습니다.');}return;}
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

// ── 온보딩: 계정 → 동의 → 보관함 암호 → 받아쓰기. 부족한 단계만 연다(openOnboarding).
// render는 settings.consentAccepted가 아니라 이 플래그로 온보딩 화면을 고른다 - 동의는 끝났는데 보관함 암호가 없는 경우처럼 부분만 다시 열어야 해서다.
let onboardingOpen=false,obSession=null,obPlan='free',obSteps=[];
// 지금 상태의 로그인 세션·플랜·보관함 키. 각 조회 실패는 로그아웃·Free·키 없음으로 접는다(Account·NoteFile이 없는 테스트 환경 포함).
async function obCheck(){
  try{obSession=await Account.getSession();}catch{obSession=null;}
  obPlan='free';
  if(obSession){const acc=await Account.fetchAccount(obSession).catch(()=>null);obPlan=acc?.plan||'free';}
  let libraryKey=null;
  try{libraryKey=await NoteFile.loadLibraryKey(await PackageStore.indexedDbAdapter());}catch{}
  return {session:obSession,plan:obPlan,libraryKey};
}
// 열어야 할 온보딩 단계 목록. 모두 갖췄으면 [].
function onboardingSteps(settings,session,plan,libraryKey){
  const steps=[],paid=plan!=='free',bg=settings?.backgroundConsent||{};
  if(!session)steps.push('account');
  if(!summaryAllowed(settings)
    ||(paid&&settings?.visionConsent===true&&!cloudRecognitionAllowed(settings))
    ||(paid&&(bg.personalUse===true||bg.accessRights===true)&&!backgroundAllowed(settings)))steps.push('consent');
  if(!libraryKey)steps.push('passphrase');
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
  if(obSteps.includes('passphrase')&&!(els.obPass.value.length>=12&&els.obPass.value===els.obPass2.value))ok=false;
  els.obDone.disabled=!ok;
}
function obPassHint(){
  const a=els.obPass.value,b=els.obPass2.value;
  const msg=a&&a.length<12?'암호는 12자 이상이어야 합니다.':b&&a!==b?'두 암호가 서로 다릅니다.':'';
  els.obPassErr.textContent=msg;els.obPassErr.hidden=!msg;
}
// 열린 온보딩을 기다리는 약속: 완료하면 true, 다른 단계로 다시 열려 대체되면 false로 끝낸다.
let obResolve=null;
const obFinish=ok=>{const r=obResolve;obResolve=null;r?.(ok);};
function openOnboarding(steps){
  obFinish(false);
  obSteps=steps;onboardingOpen=true;
  for(const section of els.onboard.querySelectorAll?.('section[data-step]')||[])section.hidden=!steps.includes(section.dataset.step);
  for(const row of [els.obCloudRow,els.obPersonalRow,els.obAccessRow])if(row)row.hidden=obPlan==='free';
  els.obError.hidden=true;
  obShowAccount();obValidate();
  setStage('onboard');
  return new Promise(resolve=>{obResolve=resolve;});
}
els.obLogin.addEventListener('click',async()=>{
  els.obLogin.disabled=true;els.obAccountErr.hidden=true;
  try{
    await Account.signIn();
    settings=await loadSettings();
    const{libraryKey}=await obCheck();
    // 로그인으로 알게 된 플랜이 유료면 새로 필요해진 동의 단계를 더 연다. 계정 단계는 <email> · <plan> 확인을 보여 주기 위해 그대로 둔다.
    const next=onboardingSteps(settings,obSession,obPlan,libraryKey);
    if(obSteps.includes('account')&&!next.includes('account'))next.unshift('account');
    openOnboarding(next);
  }catch(error){els.obAccountErr.textContent=error.message||'로그인하지 못했습니다. 다시 시도해 주세요.';els.obAccountErr.hidden=false;}
  finally{els.obLogin.disabled=false;obValidate();}
});
els.obSummary.addEventListener('change',obValidate);
for(const input of [els.obPass,els.obPass2])input.addEventListener('input',()=>{obPassHint();obValidate();});
els.obDone.addEventListener('click',async()=>{
  els.obDone.disabled=true;els.obError.hidden=true;
  try{
    const patch={remoteSummaryConsent:true,summaryConsentVersion:TERMS_VERSION,summaryConsentAt:Date.now(),consentAccepted:true};
    if(obSteps.includes('consent')){
      if(!els.obCloudRow.hidden){patch.visionConsent=els.obCloud.checked;patch.visionConsentVersion=els.obCloud.checked?TERMS_VERSION:'';patch.visionConsentAt=els.obCloud.checked?Date.now():0;}
      if(!els.obPersonalRow.hidden)patch.backgroundConsent={personalUse:els.obPersonal.checked,accessRights:els.obAccess.checked,version:TERMS_VERSION,at:Date.now()};
    }
    if(obSteps.includes('engine'))patch.whisperEnabled=els.obWhisper.checked;
    await saveSettings(patch);
    if(obSteps.includes('passphrase')){
      try{await NoteFile.saveLibraryKey(await PackageStore.indexedDbAdapter(),els.obPass.value);}
      catch(error){els.obPassErr.textContent=error.message;els.obPassErr.hidden=false;return;}
      finally{els.obPass.value='';els.obPass2.value='';}
    }
    settings=await loadSettings();
    onboardingOpen=false;
    obFinish(true);
    render(state);
    bgInit();
  }catch(error){els.obError.textContent=error.message;els.obError.hidden=false;}
  finally{obValidate();}
});
