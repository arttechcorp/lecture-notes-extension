// Settings only. No evidence, notes or archive keys are accepted here.
const DEFAULTS={serviceUrl:'',appSessionToken:'',summaryModel:'google/gemini-2.5-flash-lite',remoteSummaryConsent:false,ocrEnabled:true,ocrEngine:'tesseract',whisperEnabled:false,whisperModel:'tiny',whisperLang:'auto',theme:'system',consentAccepted:false};
const KEYS=Object.keys(DEFAULTS);
function validateSettings(input={}){
  const out={...DEFAULTS};
  for(const key of KEYS){if(typeof out[key]==='boolean')out[key]=input[key]===undefined?out[key]:input[key]===true;else if(typeof input[key]==='string')out[key]=input[key].trim().slice(0,key==='appSessionToken'?512:2048);}
  if(out.serviceUrl){try{const u=new URL(out.serviceUrl);if(u.username||u.password||u.search||u.hash||u.pathname!=='/'||(u.protocol!=='https:'&&!(u.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname))))throw new Error();out.serviceUrl=u.origin;}catch{throw new Error('HTTPS 서비스 원점을 입력하세요. 개발용 localhost만 HTTP를 허용합니다.');}}
  if(!['tiny','base'].includes(out.whisperModel))out.whisperModel='tiny';out.whisperLang=({korean:'ko',english:'en'})[out.whisperLang]||out.whisperLang;if(!['auto','ko','en'].includes(out.whisperLang))out.whisperLang='auto';out.ocrEngine='tesseract';if(!['system','light','dark'].includes(out.theme))out.theme='system';
  if(!['google/gemini-2.5-flash-lite','google/gemini-3.8-flash','anthropic/claude-haiku-4.5','anthropic/claude-sonnet-5'].includes(out.summaryModel))out.summaryModel=DEFAULTS.summaryModel;
  return out;
}
async function loadSettings(){const local=await chrome.storage.local.get(KEYS);await chrome.storage.local.remove(['apiKey','syncKey','provider','allowRemoteOcr','plan']);await chrome.storage.sync.remove(['apiKey','syncKey']);return validateSettings(local);}
async function saveSettings(patch){const unknown=Object.keys(patch).filter(k=>!KEYS.includes(k));if(unknown.length)throw new Error('허용되지 않은 설정입니다.');const next=validateSettings({...await loadSettings(),...patch});await chrome.storage.local.set(next);return next;}
if(typeof module!=='undefined')module.exports={DEFAULTS,validateSettings,loadSettings,saveSettings};
