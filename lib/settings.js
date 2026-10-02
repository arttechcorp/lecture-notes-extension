// Settings only. No evidence, notes or archive keys are accepted here.
// 동의 문구·약관 버전. 문구나 범위(예: 클라우드 인식에 음성 추가)를 바꾸면 반드시 올린다 - 올리면 모든 사용자에게 다시 동의를 받는다(docs/architecture-v2.md 9절).
const TERMS_VERSION='2026-10-02';
// visionConsent가 클라우드 인식 동의의 유일한 플래그다 - 오늘은 화면 프레임, 이후 음성 조각까지 같은 동의로 커버한다. visionConsentVersion ''은 버전 도입 전 동의라 화면 프레임에만 해당한다.
const DEFAULTS={openRouterApiKey:'',serviceUrl:'',appSessionToken:'',summaryModel:'google/gemini-2.5-flash-lite',remoteSummaryConsent:false,ocrEnabled:true,ocrEngine:'ppocr-v5-wasm',visionConsent:false,visionConsentVersion:'',visionConsentAt:0,whisperEnabled:false,whisperModel:'small-webgpu',whisperLang:'ko',speedCorrection:false,theme:'system',consentAccepted:false,backgroundConsent:{personalUse:false,accessRights:false,version:'',at:0}};
// backgroundConsent: D9 백그라운드 처리 사용 동의 2종(개인 이용·접근 권한).
const KEYS=Object.keys(DEFAULTS);
function validateSettings(input={}){
  const out={...DEFAULTS};
  for(const key of KEYS){if(typeof out[key]==='boolean')out[key]=input[key]===undefined?out[key]:input[key]===true;else if(typeof input[key]==='string')out[key]=input[key].trim().slice(0,key==='appSessionToken'?512:key==='openRouterApiKey'?256:2048);}
  if(out.openRouterApiKey&&!/^sk-or-v1-[A-Za-z0-9_-]{20,}$/.test(out.openRouterApiKey))throw new Error('OpenRouter API 키 형식이 올바르지 않습니다. sk-or-v1- 키를 입력하세요.');
  if(out.serviceUrl){try{const u=new URL(out.serviceUrl);if(u.username||u.password||u.search||u.hash||u.pathname!=='/'||(u.protocol!=='https:'&&!(u.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname))))throw new Error();out.serviceUrl=u.origin;}catch{throw new Error('HTTPS 서비스 원점을 입력하세요. 개발용 localhost만 HTTP를 허용합니다.');}}
  out.whisperModel=({tiny:'base-wasm',base:'base-wasm'})[out.whisperModel]||out.whisperModel;if(!['small-webgpu','base-wasm'].includes(out.whisperModel))out.whisperModel='small-webgpu';out.whisperLang=({korean:'ko',english:'en'})[out.whisperLang]||out.whisperLang;if(!['auto','ko','en'].includes(out.whisperLang))out.whisperLang='auto';if(!['ppocr-v5-wasm','vision-cloud'].includes(out.ocrEngine))out.ocrEngine='ppocr-v5-wasm';if(!['system','light','dark'].includes(out.theme))out.theme='system';
  if(out.summaryModel==='anthropic/claude-sonnet-5')out.summaryModel='anthropic/claude-sonnet-4.6';
  if(!['google/gemini-2.5-flash-lite','google/gemini-3.8-flash','google/gemini-2.5-pro','anthropic/claude-haiku-4.5','anthropic/claude-sonnet-4.6'].includes(out.summaryModel))out.summaryModel=DEFAULTS.summaryModel;
  // 동의 기록: 메타데이터(버전·시각)는 동의가 있을 때만 남기고, 철회하면 흔적도 지운다.
  const text=v=>typeof v==='string'?v.trim().slice(0,32):'',stamp=v=>Number.isFinite(v)&&v>0?Math.floor(v):0;
  out.visionConsentVersion=out.visionConsent?text(input.visionConsentVersion):'';
  out.visionConsentAt=out.visionConsent?stamp(input.visionConsentAt):0;
  const bg=input.backgroundConsent&&typeof input.backgroundConsent==='object'?input.backgroundConsent:{},personalUse=bg.personalUse===true,accessRights=bg.accessRights===true;
  out.backgroundConsent=personalUse||accessRights?{personalUse,accessRights,version:text(bg.version),at:stamp(bg.at)}:{personalUse:false,accessRights:false,version:'',at:0};
  return out;
}
async function loadSettings(){const local=await chrome.storage.local.get([...KEYS,'apiKey']);if(!local.openRouterApiKey&&typeof local.apiKey==='string'&&local.apiKey.trim()){const migrated=validateSettings({...local,openRouterApiKey:local.apiKey});await chrome.storage.local.set({openRouterApiKey:migrated.openRouterApiKey});local.openRouterApiKey=migrated.openRouterApiKey;}await chrome.storage.local.remove(['apiKey','syncKey','provider','allowRemoteOcr','plan']);await chrome.storage.sync.remove(['apiKey','syncKey']);return validateSettings(local);}
async function saveSettings(patch){const unknown=Object.keys(patch).filter(k=>!KEYS.includes(k));if(unknown.length)throw new Error('허용되지 않은 설정입니다.');const next=validateSettings({...await loadSettings(),...patch});await chrome.storage.local.set(next);return next;}
// 클라우드 인식(화면 프레임, 이후 음성 조각 포함) 동의를 현재 문구 버전으로 받았는가. 버전 도입 전 동의('')는 화면 프레임에만 해당하므로 false다 - 기존 화면 전송 게이트(visionConsent===true)는 그대로 둔다.
function cloudRecognitionAllowed(settings,termsVersion=TERMS_VERSION){return settings?.visionConsent===true&&Boolean(termsVersion)&&settings.visionConsentVersion===termsVersion;}
// 백그라운드 처리 허용: 사용 동의 2종이 모두 true이고 현재 약관 버전으로 받았을 때만. 버전이 바뀌면 다시 받아야 한다.
function backgroundAllowed(settings,termsVersion=TERMS_VERSION){const c=settings?.backgroundConsent;return c?.personalUse===true&&c?.accessRights===true&&Boolean(termsVersion)&&c.version===termsVersion;}
if(typeof module!=='undefined')module.exports={DEFAULTS,TERMS_VERSION,validateSettings,loadSettings,saveSettings,cloudRecognitionAllowed,backgroundAllowed};
