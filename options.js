const $=id=>document.getElementById(id);
// Explicit-save fields: gathered by the API section's own Save/Test buttons.
const fields=['openRouterApiKey','serviceUrl','appSessionToken','summaryModel','remoteSummaryConsent'];
// Auto-save fields: each persists immediately on change (elements below carry the "자동 저장" badge).
const AUTO=[['themeSelect','theme'],['ocrEnabledCb','ocrEnabled'],['whisperCb','whisperEnabled'],['whisperModel','whisperModel'],['whisperLang','whisperLang']];
const BOOL_FIELDS=new Set(['remoteSummaryConsent']);
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
// 유료 여부는 서버만 안다. chrome.storage 는 사용자가 고칠 수 있으므로 여기서 켜진 토글은
// 의사 표시일 뿐이고, 실제 호출은 /v1/vision 이 계정 features 로 다시 막는다.
async function wireVision(settings){
  const box=$('visionCb'),state=$('visionState'),modal=$('visionWarn');
  if(!box)return;
  box.checked=settings.ocrEngine==='vision-cloud'&&settings.visionConsent===true;
  const persist=async on=>{
    try{await saveSettings({ocrEngine:on?'vision-cloud':'ppocr-v5-wasm',visionConsent:on});notice(on?'고화질 화면 인식을 켰습니다. 다음 캡처부터 적용됩니다.':'고화질 화면 인식을 껐습니다. 기기 안에서만 인식합니다.');}
    catch(error){box.checked=!on;notice(error.message);}
  };
  box.addEventListener('change',()=>{
    if(!box.checked)return persist(false);
    if(modal?.showModal)modal.showModal();else persist(true);
  });
  $('visionWarnOk')?.addEventListener('click',()=>{modal.close();persist(true);});
  $('visionWarnCancel')?.addEventListener('click',()=>{modal.close();box.checked=false;});
  modal?.addEventListener('cancel',()=>{box.checked=false;});
  if(!settings.serviceUrl||!settings.appSessionToken){state.textContent='서비스 연결을 먼저 설정하세요.';return;}
  try{
    const me=await ServiceClient.me({baseUrl:settings.serviceUrl,token:settings.appSessionToken,timeoutMs:15000});
    const allowed=Array.isArray(me.features)&&me.features.includes('vision');
    box.disabled=!allowed;
    state.textContent=allowed?'사용 가능한 플랜입니다.':'유료 플랜에서 사용할 수 있습니다.';
    // 플랜이 끝났는데 설정만 남아 있으면 세션 시작이 403 으로 죽는다. 조용히 로컬로 되돌린다.
    if(!allowed&&box.checked){box.checked=false;await saveSettings({ocrEngine:'ppocr-v5-wasm',visionConsent:false});}
  }catch(error){state.textContent='사용 가능 여부를 확인하지 못했습니다 · '+error.message;}
}
function notice(message){$('saved').hidden=false;$('saved').textContent=message;}
function values(){return Object.fromEntries(fields.map(id=>[id,BOOL_FIELDS.has(id)?$(id).checked:$(id).value]));}
(async()=>{try{
  const s=await loadSettings();
  for(const id of fields)if(BOOL_FIELDS.has(id))$(id).checked=s[id];else $(id).value=s[id];
  for(const [id,key] of AUTO){const el=$(id);if(!el)continue;if(el.type==='checkbox')el.checked=s[key];else el.value=s[key];}
  wireSpeedCorrection(s.speedCorrection===true);
  await wireVision(s);
}catch(error){notice(error.message);}})();
for(const [id,key] of AUTO){
  const el=$(id);
  if(!el)continue;
  el.addEventListener('change',async()=>{try{await saveSettings({[key]:el.type==='checkbox'?el.checked:el.value});notice('설정이 저장되었습니다');}catch(error){notice(error.message);}});
}
$('saveBtn').addEventListener('click',async()=>{try{await saveSettings(values());notice('설정을 저장했습니다. 열려 있는 강의 패널로 돌아갈 수 있습니다.');}catch(error){notice(error.message);}});
$('testBtn').addEventListener('click',async()=>{const button=$('testBtn');button.disabled=true;try{const s=validateSettings(values());await saveSettings(s);if(s.openRouterApiKey){await OpenRouterClient.check({apiKey:s.openRouterApiKey,timeoutMs:15000});notice('연결됨 · OpenRouter API 키를 확인했습니다.');}else{const result=await ServiceClient.me({baseUrl:s.serviceUrl,token:s.appSessionToken,timeoutMs:15000});if(typeof result.accountId!=='string'||!Array.isArray(result.models))throw new Error('계정 정보를 확인하지 못했습니다.');notice(result.models.includes(s.summaryModel)?'연결됨 · 선택한 요약 모델을 사용할 수 있습니다.':'연결됨 · 선택한 모델이 계정에 허용되지 않았습니다. 다른 모델을 선택하세요.');}}catch(error){notice(error.message);}finally{button.disabled=false;}});
