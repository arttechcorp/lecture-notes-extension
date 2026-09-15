// Settings only. No evidence, notes or archive keys are accepted here.
const DEFAULTS={openRouterApiKey:'',serviceUrl:'',appSessionToken:'',summaryModel:'google/gemini-2.5-flash-lite',remoteSummaryConsent:false,ocrEnabled:true,ocrEngine:'ppocr-v5-wasm',whisperEnabled:false,whisperModel:'small-webgpu',whisperLang:'ko',theme:'system',consentAccepted:false};
const KEYS=Object.keys(DEFAULTS);
function validateSettings(input={}){
  const out={...DEFAULTS};
  for(const key of KEYS){if(typeof out[key]==='boolean')out[key]=input[key]===undefined?out[key]:input[key]===true;else if(typeof input[key]==='string')out[key]=input[key].trim().slice(0,key==='appSessionToken'?512:key==='openRouterApiKey'?256:2048);}
  if(out.openRouterApiKey&&!/^sk-or-v1-[A-Za-z0-9_-]{20,}$/.test(out.openRouterApiKey))throw new Error('OpenRouter API 키 형식이 올바르지 않습니다. sk-or-v1- 키를 입력하세요.');
  if(out.serviceUrl){try{const u=new URL(out.serviceUrl);if(u.username||u.password||u.search||u.hash||u.pathname!=='/'||(u.protocol!=='https:'&&!(u.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname))))throw new Error();out.serviceUrl=u.origin;}catch{throw new Error('HTTPS 서비스 원점을 입력하세요. 개발용 localhost만 HTTP를 허용합니다.');}}
  out.whisperModel=({tiny:'base-wasm',base:'base-wasm'})[out.whisperModel]||out.whisperModel;if(!['small-webgpu','base-wasm'].includes(out.whisperModel))out.whisperModel='small-webgpu';out.whisperLang=({korean:'ko',english:'en'})[out.whisperLang]||out.whisperLang;if(!['auto','ko','en'].includes(out.whisperLang))out.whisperLang='auto';out.ocrEngine='ppocr-v5-wasm';if(!['system','light','dark'].includes(out.theme))out.theme='system';
  if(!['google/gemini-2.5-flash-lite','google/gemini-3.8-flash','anthropic/claude-haiku-4.5','anthropic/claude-sonnet-5'].includes(out.summaryModel))out.summaryModel=DEFAULTS.summaryModel;
  return out;
}
async function loadSettings(){const local=await chrome.storage.local.get([...KEYS,'apiKey']);if(!local.openRouterApiKey&&typeof local.apiKey==='string'&&local.apiKey.trim()){const migrated=validateSettings({...local,openRouterApiKey:local.apiKey});await chrome.storage.local.set({openRouterApiKey:migrated.openRouterApiKey});local.openRouterApiKey=migrated.openRouterApiKey;}await chrome.storage.local.remove(['apiKey','syncKey','provider','allowRemoteOcr','plan']);await chrome.storage.sync.remove(['apiKey','syncKey']);return validateSettings(local);}
async function saveSettings(patch){const unknown=Object.keys(patch).filter(k=>!KEYS.includes(k));if(unknown.length)throw new Error('허용되지 않은 설정입니다.');const next=validateSettings({...await loadSettings(),...patch});await chrome.storage.local.set(next);return next;}
if(typeof module!=='undefined')module.exports={DEFAULTS,validateSettings,loadSettings,saveSettings};
