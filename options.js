const $=id=>document.getElementById(id);
// sidepanel.js 계정 메뉴와 같은 플랜 표기. 목록에 없는 id(edu 변형 등)는 id 그대로 보여 준다.
const PLANS={free:'Free',essential:'Essential',professional:'Pro'};
const ymd=t=>{if(!Number.isFinite(t)||t<=0)return '';const d=new Date(t);return Number.isFinite(d.getTime())?`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`:'';};
// Explicit-save fields: gathered by the API section's own Save/Test buttons.
const fields=['serviceUrl','appSessionToken'];
// Auto-save fields: each persists immediately on change (elements below carry the "자동 저장" badge).
const AUTO=[['themeSelect','theme'],['ocrEnabledCb','ocrEnabled'],['whisperCb','whisperEnabled'],['whisperModel','whisperModel'],['whisperLang','whisperLang']];
// Speed correction is the one auto-saved toggle that is NOT wired through AUTO: turning it on changes what the
// listener hears, so it is only persisted after the warning dialog is acknowledged.
function wireSpeedCorrection(initial){
  const box=$('speedCorrectionCb'),modal=$('speedWarn');
  if(!box)return;
  box.checked=initial;
  const persist=async value=>{try{await saveSettings({speedCorrection:value});notice(value?'배속 인식 보정을 켰습니다. 다음 캡처부터 적용됩니다.':'배속 인식 보정을 껐습니다.');}catch(error){box.checked=!value;notice(error.message);}};
  box.addEventListener('change',()=>{
    if(!box.checked)return persist(false);
    if(modal?.showModal)modal.showModal();else persist(true);
  });
  $('speedWarnOk')?.addEventListener('click',()=>{modal.close();persist(true);});
  $('speedWarnCancel')?.addEventListener('click',()=>{modal.close();box.checked=false;});
  modal?.addEventListener('cancel',()=>{box.checked=false;});
}
// 이용 동의 3종(외부 요약 처리·클라우드 인식·백그라운드 처리)은 사이드 패널에서 기능을 처음 쓸 때만 받는다.
// 이 페이지는 저장된 기록을 보여 주고 철회만 한다 - 철회하면 동의 플래그와 함께 버전·시각 기록도 지워진다(lib/settings.js).
function wireConsents(settings){
  const show=(ok,at,stateId,btnId)=>{
    const state=$(stateId),btn=$(btnId);if(!state)return;
    state.textContent=ok?'동의함'+(ymd(at)?' · '+ymd(at):''):'동의하지 않음 — 사이드 패널에서 처음 사용할 때 동의합니다';
    if(btn)btn.hidden=!ok;
  };
  const withdraw=(id,ask,patch,done)=>{
    const btn=$(id);if(!btn)return;
    btn.addEventListener('click',async()=>{
      if(!confirm(ask))return;
      btn.disabled=true;
      try{const s=await saveSettings(patch);await done(s);notice('동의를 철회했습니다.');}
      catch(error){notice(error.message);}finally{btn.disabled=false;}
    });
  };
  // summaryAllowed 는 settings.js 가 제공한다(버전·시각 포함 판정). 없는 빌드에서는 플래그만 본다.
  const sumOk=s=>typeof summaryAllowed==='function'?summaryAllowed(s):s.remoteSummaryConsent===true;
  const showAll=s=>{
    show(sumOk(s),s.summaryConsentAt,'summaryConsentState','summaryWithdrawBtn');
    show(cloudRecognitionAllowed(s),s.visionConsentAt,'visionConsentState','visionWithdrawBtn');
    show(backgroundAllowed(s),s.backgroundConsent?.at,'bgState','bgWithdrawBtn');
  };
  showAll(settings);
  withdraw('summaryWithdrawBtn','철회하면 인식된 텍스트가 더 이상 요약 서비스로 전송되지 않아 새 노트 요약을 만들 수 없습니다. 계속할까요?',{remoteSummaryConsent:false},showAll);
  withdraw('visionWithdrawBtn','철회하면 고화질 화면 인식이 꺼지고 강의 화면·음성이 기기 밖으로 나가지 않습니다. 백그라운드 처리도 쓸 수 없습니다. 계속할까요?',{visionConsent:false,ocrEngine:'ppocr-v5-wasm'},async s=>{showAll(s);await refreshAccount();});
  withdraw('bgWithdrawBtn','철회하면 탭을 닫아도 노트를 만드는 백그라운드 처리를 쓸 수 없습니다. 계속할까요?',{backgroundConsent:{personalUse:false,accessRights:false,version:'',at:0}},showAll);
}
// 서비스 호출에 쓸 토큰: 로그인한 계정이 우선이고, 로그아웃 상태일 때만 개발·테스트용 정적 토큰을 쓴다(offscreen의 tokenProvider와 같은 순서).
async function serviceToken(s){return (await Auth.token())||s.appSessionToken;}
// 로그인·로그아웃·동의 철회 뒤에 플랜 표시와 인식 카드를 다시 그린다(wireAccount가 채운다).
let refreshAccount=async()=>{};
// 모두 삭제가 기기 키까지 지우면 보관함 PIN 카드도 다시 그린다(wireLibraryKey가 채운다).
let refreshLibraryKey=async()=>{};
// 플랜은 서버(my_account)만 안다. 무료가 아닌 모든 플랜(essential·professional·edu 변형 등)은 화면·음성을 서버에서 인식하므로
// 온디바이스 설정(OCR·Whisper·배속 보정)을 숨기고 서버 인식 상태와 노트 옵션만 보여 준다.
// 계정을 못 읽으면 '확인 못 함'만 표시하고 온디바이스 설정은 그대로 둔다 - 플랜을 모르는 채 서버 인식으로 바꾸지 않는다.
async function wireAccount(settings){
  if(typeof Account==='undefined'||typeof Auth==='undefined')return;
  for(const[id,path]of[['billingLink','/account/billing'],['libraryLink','/library']]){const a=$(id);if(a)a.href=Account.SITE+path;}
  const apply=(signed,acc,s)=>{
    const paid=Boolean(acc&&acc.plan&&acc.plan!=='free');
    const box=$('accountPlanBox');if(box)box.hidden=!signed;
    const planEl=$('planState');
    if(planEl)planEl.textContent=!signed?'':acc?.plan?(PLANS[acc.plan]||acc.plan)+' 플랜'+(acc.minutes_limit!=null?` · 이번 달 ${acc.minutes_used??0}/${acc.minutes_limit}분`:''):'플랜: 확인 못 함';
    for(const id of['ocrCard','whisperToggle','whisperModelField','speedField']){const el=$(id);if(el)el.hidden=paid;}
    const voiceH=$('voiceHeading');if(voiceH)voiceH.textContent=paid?'화면·음성 인식':'음성 받아쓰기';
    const bannerText=$('bannerRecogText');if(bannerText)bannerText.textContent=paid?'화면과 음성은 서버에서 인식하고 저장하지 않습니다.':'화면과 음성은 기기 안에서 인식합니다';
    const srv=$('serverRecog');if(srv)srv.hidden=!paid;
    const cs=$('serverConsentState');if(cs)cs.textContent=paid?'클라우드 인식 동의: '+(cloudRecognitionAllowed(s)?'완료':'필요 — 사이드 패널에서 동의'):'';
    const nc=$('noteOptsCard');if(nc)nc.hidden=!paid;
  };
  const refresh=async s=>{
    const user=await Auth.user().catch(()=>null);
    const token=user?await Auth.token().catch(()=>null):null;
    const acc=token?await Account.fetchAccount({access_token:token}).catch(()=>null):null;
    apply(Boolean(user),acc,s);
  };
  refreshAccount=async()=>{await refresh(await loadSettings());};
  await refresh(settings);
}
// 노트 옵션(유료 플랜 카드만 보인다): 노트 생성 시 예시 합성·외부 지식 보강.
function wireNoteOptions(s){
  const a=$('noteSyntheticCb'),b=$('noteAugmentCb');if(!a||!b)return;
  a.checked=s.noteOptions?.syntheticExamples===true;b.checked=s.noteOptions?.externalAugmentation===true;
  const save=async()=>{const aBefore=a.checked,bBefore=b.checked;try{await saveSettings({noteOptions:{syntheticExamples:a.checked,externalAugmentation:b.checked}});notice('설정이 저장되었습니다');}catch(error){a.checked=aBefore;b.checked=bBefore;notice(error.message);}};
  a.addEventListener('change',save);b.addEventListener('change',save);
}
// 개발자 카드: 스토어 배포 빌드(manifest에 update_url)에서는 숨기고, 압축 풀린 개발 빌드에서만 연다.
function wireDevCard(){const card=$('devCard');if(card)card.hidden='update_url'in(chrome.runtime.getManifest?.()??{});}
// 계정 카드: 이메일만 보여 주고 토큰은 읽지 않는다.
async function showAuth(){
  const user=await Auth.user().catch(()=>null);
  $('authState').textContent=user?(user.email?user.email+' 계정으로 로그인했습니다.':'로그인했습니다.'):'로그인하지 않았습니다.';
  $('loginBtn').hidden=Boolean(user);$('logoutBtn').hidden=!user;$('accountDeleteBox').hidden=!user;
}
function wireAuth(){
  for(const [id,work,done] of [['loginBtn',Auth.signIn,'로그인했습니다.'],['logoutBtn',Auth.signOut,'로그아웃했습니다.']]){
    const button=$(id);
    button.addEventListener('click',async()=>{button.disabled=true;try{await work();await showAuth();await refreshAccount();notice(done);}catch(error){notice(error.message);}finally{button.disabled=false;}});
  }
}
// 데이터 관리 카드. 암호화 저장소와 기기 키는 offscreen 문서가 쥐고 있어 삭제·열람은 background를 거쳐 거기서 한다(진행 중인 캡처·작업이 있으면 offscreen이 거절한다).
const local=(type,extra)=>chrome.runtime.sendMessage({target:'background',type,...extra}).then(r=>{if(!r?.ok)throw new Error(r?.error||'처리하지 못했습니다.');return r;});
// 서버 -> 이 기기 -> 로그아웃 순서. 서버가 실패하면 로컬은 그대로라 다시 시도할 수 있다. 서버를 지운 뒤에는 이 기기 삭제가 실패해도 로그아웃한다(계정이 없으니 로그인 상태가 의미 없다).
async function deleteAccount(){
  const s=await loadSettings(),token=await Auth.token();
  if(!token||!s.serviceUrl)throw new Error('서비스 연결을 먼저 설정하세요.');
  await local('WIPE_LOCAL',{dryRun:true}); // 되돌릴 수 없는 서버 삭제 전에, 이 기기도 지울 수 있는 상태인지 먼저 본다
  if((await ServiceClient.deleteAccount({baseUrl:s.serviceUrl,token}))?.deleted!==true)throw new Error('서버가 삭제를 확인하지 않았습니다. 다시 시도하세요.');
  try{await local('WIPE_LOCAL');}
  catch(error){throw new Error('계정은 삭제했지만 이 기기의 데이터는 지우지 못했습니다. "이 기기의 강의 데이터 모두 삭제"를 다시 실행하세요. ('+error.message+')');}
  finally{await Auth.signOut();await showAuth();await refreshAccount();}
}
// 진단 파일: 허용 필드뿐인 로그를 평문 JSON으로 Blob 링크로 내려받는다(chrome.downloads 권한 없음). 강의 내용은 애초에 로그에 없다.
async function exportDiagnostics(){
  const {events}=await local('LOGS_READ');
  if(!events.length)return '내보낼 진단 로그가 없습니다.';
  const version=chrome.runtime.getManifest?.()?.version??null;
  const bundle=await Diagnostics.exportBundle(events,{version}),a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([JSON.stringify(bundle,null,2)],{type:'application/json'}));
  a.download='summrizei-diagnostic-'+new Date(bundle.createdAt).toISOString().slice(0,10)+'.json';
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),4e4);
  return '진단 파일을 내려받았습니다. 지원 메일에 첨부해 보내 주세요.';
}
function wireData(){
  const run=(id,ask,work)=>$(id).addEventListener('click',async()=>{
    if(ask&&!confirm(ask))return;
    const button=$(id);button.disabled=true;
    try{notice(await work());}catch(error){notice(error.message);}finally{button.disabled=false;}
  });
  run('wipeBtn','이 기기에 보관된 노트·전사·슬라이드 텍스트·작업 기록과 진단 로그를 모두 삭제합니다. 되돌릴 수 없습니다.\n\n설정·동의·로그인은 지우지 않습니다. 계속할까요?',async()=>{await local('WIPE_LOCAL');await refreshLibraryKey().catch(()=>{});return '이 기기의 강의 데이터를 모두 삭제했습니다.';});
  run('diagClearBtn',null,async()=>{await local('LOGS_CLEAR');return '진단 로그를 삭제했습니다.';});
  run('diagExportBtn',null,exportDiagnostics);
  run('accountDeleteBtn','계정과 서버에 저장된 데이터(보관함 포함)를 영구 삭제합니다. 되돌릴 수 없습니다.\n\n삭제가 끝나면 이 기기의 강의 데이터도 모두 지우고 로그아웃합니다. 계속할까요?',async()=>{await deleteAccount();return '계정과 서버 데이터를 삭제했습니다. 이 기기의 강의 데이터도 지우고 로그아웃했습니다.';});
}
// 보관함 PIN: NoteFile(lib/note-file.js)이 PIN에서 내보낸 키를 이 기기의 암호화 저장소에 둔다.
// 바꾸면 이 기기에 남아 있는 노트 파일을 background가 새 키로 다시 저장한다(LIB_EXPORT_ALL).
async function wireLibraryKey(){
  const state=$('keyState'),form=$('keyForm'),p1=$('keyPass1'),btn=$('keySaveBtn');
  if(!form||!state)return;
  const unavailable=()=>{state.textContent='이 기능을 쓸 수 없습니다.';for(const el of[p1,btn])if(el)el.disabled=true;};
  if(typeof NoteFile==='undefined'||typeof PackageStore==='undefined')return unavailable();
  const refresh=async()=>{const rec=await NoteFile.loadLibraryKey(await PackageStore.indexedDbAdapter());state.textContent=rec?'설정됨'+(ymd(rec.at)?' · '+ymd(rec.at):''):'설정 안 됨';if(btn)btn.textContent=rec?'PIN 바꾸기':'PIN 정하기';};
  try{await refresh();}catch{return unavailable();}
  refreshLibraryKey=refresh;
  form.addEventListener('submit',async e=>{
    e.preventDefault();
    const a=p1.value;p1.value=''; // 입력은 어떤 결말이든 비운다
    if(!NoteFile.isPin(a))return notice('숫자 4자리를 입력하세요.');
    if(!confirm('새 PIN으로 이 기기에 남아 있는 노트 파일을 모두 다시 저장합니다. 예전 PIN이나 암호로 저장된 다른 파일은 그 암호로 열어야 합니다.'))return;
    btn.disabled=true;
    try{
      await NoteFile.saveLibraryKey(await PackageStore.indexedDbAdapter(),a);
      const r=await local('LIB_EXPORT_ALL');
      notice(`노트 파일 ${r.count??0}개를 새 PIN으로 다시 저장했습니다.`+(r.failed?` 실패 ${r.failed}개.`:''));
      await refresh();
    }catch(error){notice(error.message);}finally{btn.disabled=false;}
  });
}
function notice(message){$('saved').hidden=false;$('saved').textContent=message;}
function values(){return Object.fromEntries(fields.map(id=>[id,$(id).value]));}
(async()=>{try{
  const s=await loadSettings();
  for(const id of fields)$(id).value=s[id];
  for(const [id,key] of AUTO){const el=$(id);if(!el)continue;if(el.type==='checkbox')el.checked=s[key];else el.value=s[key];}
  wireSpeedCorrection(s.speedCorrection===true);
  wireConsents(s);
  wireAuth();
  wireData();
  wireDevCard();
  wireNoteOptions(s);
  await wireLibraryKey();
  await wireAccount(s);
  await showAuth();
}catch(error){notice(error.message);}})();
for(const [id,key] of AUTO){
  const el=$(id);
  if(!el)continue;
  el.addEventListener('change',async()=>{try{await saveSettings({[key]:el.type==='checkbox'?el.checked:el.value});notice('설정이 저장되었습니다');}catch(error){notice(error.message);}});
}
$('saveBtn').addEventListener('click',async()=>{try{await saveSettings(values());notice('설정을 저장했습니다. 열려 있는 강의 패널로 돌아갈 수 있습니다.');}catch(error){notice(error.message);}});
$('testBtn').addEventListener('click',async()=>{const button=$('testBtn');button.disabled=true;try{const s=await saveSettings(values());const result=await ServiceClient.me({baseUrl:s.serviceUrl,token:await serviceToken(s),timeoutMs:15000});if(typeof result.accountId!=='string'||!Array.isArray(result.models))throw new Error('계정 정보를 확인하지 못했습니다.');notice('연결됨 · 서비스 계정을 확인했습니다.');}catch(error){notice(error.message);}finally{button.disabled=false;}});
