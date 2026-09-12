const $=id=>document.getElementById(id);
const fields=['serviceUrl','appSessionToken','summaryModel','whisperModel','whisperLang','remoteSummaryConsent'];
function notice(message){$('saved').hidden=false;$('saved').textContent=message;}
function values(){return Object.fromEntries(fields.map(id=>[id,id==='remoteSummaryConsent'?$(id).checked:$(id).value]));}
(async()=>{try{const s=await loadSettings();for(const id of fields){if(id==='remoteSummaryConsent')$(id).checked=s[id];else $(id).value=s[id];}}catch(error){notice(error.message);}})();
$('saveBtn').addEventListener('click',async()=>{try{await saveSettings(values());notice('설정을 저장했습니다. 열려 있는 강의 패널로 돌아갈 수 있습니다.');}catch(error){notice(error.message);}});
$('testBtn').addEventListener('click',async()=>{const button=$('testBtn');button.disabled=true;try{const s=validateSettings(values());const result=await ServiceClient.me({baseUrl:s.serviceUrl,token:s.appSessionToken,timeoutMs:15000});if(typeof result.accountId!=='string'||!Array.isArray(result.models))throw new Error('계정 정보를 확인하지 못했습니다.');notice(result.models.includes(s.summaryModel)?'연결됨 · 선택한 요약 모델을 사용할 수 있습니다.':'연결됨 · 선택한 모델이 계정에 허용되지 않았습니다. 다른 모델을 선택하세요.');}catch(error){notice(error.message);}finally{button.disabled=false;}});
$('backBtn').addEventListener('click',()=>{if(history.length>1)history.back();else window.close();});
