// Settings only. No evidence, notes or archive keys are accepted here.
// 동의 문구·약관 버전. 문구나 범위(예: 클라우드 인식에 음성 추가)를 바꾸면 반드시 올린다 - 올리면 모든 사용자에게 다시 동의를 받는다(docs/architecture-v2.md 9절).
const TERMS_VERSION='2026-10-03';
// visionConsent가 클라우드 인식 동의의 유일한 플래그다 - 오늘은 화면 프레임, 이후 음성 조각까지 같은 동의로 커버한다. visionConsentVersion ''은 버전 도입 전 동의라 화면 프레임에만 해당한다.
// 운영 서비스 기본값: Supabase Edge Function(supabase/functions/api). 확장만 불러와도 로그인하면 바로 쓴다. 로컬 node 서버로 바꿀 때만 설정에서 고친다.
const SERVICE_URL='https://rppknkhbiivyurhvljoi.supabase.co/functions/v1/api';
const DEFAULTS={serviceUrl:SERVICE_URL,appSessionToken:'',remoteSummaryConsent:false,summaryConsentVersion:'',summaryConsentAt:0,ocrEnabled:true,ocrEngine:'ppocr-v5-wasm',visionConsent:false,visionConsentVersion:'',visionConsentAt:0,whisperEnabled:true,whisperModel:'small-webgpu',whisperLang:'ko',speedCorrection:false,theme:'system',noteOptions:{syntheticExamples:false,externalAugmentation:false},consentAccepted:false,backgroundConsent:{personalUse:false,accessRights:false,version:'',at:0},authSession:null};
// backgroundConsent: D9 백그라운드 처리 사용 동의 2종(개인 이용·접근 권한).
// authSession: Supabase 로그인 세션(앱 설정의 한 종류, appSessionToken과 같은 자리). chrome.storage.local에만 두고 동기화하지 않는다. 쓰는 길은 아래 saveAuthSession 뿐이다.
const KEYS=Object.keys(DEFAULTS);
// 로그인 세션 {accessToken,refreshToken,expiresAt,userId,email}. 형식이 하나라도 어긋나면 로그아웃 상태(null)로 본다.
function authSessionOf(v){
  if(!v||typeof v!=='object'||Array.isArray(v))return null;
  const {accessToken:a,refreshToken:r,expiresAt:e,userId:u,email:m}=v;
  if(typeof a!=='string'||a.length>4096||!/^[\w-]+\.[\w-]+\.[\w-]+$/.test(a)||typeof r!=='string'||!/^[\x21-\x7e]{1,512}$/.test(r)||!Number.isFinite(e)||e<=0||typeof u!=='string'||!/^[\w-]{1,64}$/.test(u))return null;
  return {accessToken:a,refreshToken:r,expiresAt:Math.floor(e),userId:u,email:typeof m==='string'&&m.length<=320&&/^[^\s@]+@[^\s@]+$/.test(m)?m:''};
}
function validateSettings(input={}){
  const out={...DEFAULTS};
  for(const key of KEYS){if(typeof out[key]==='boolean')out[key]=input[key]===undefined?out[key]:input[key]===true;else if(typeof input[key]==='string')out[key]=input[key].trim().slice(0,key==='appSessionToken'?512:2048);}
  // 빈 값은 기본 서비스다. 경로는 Edge Function 경로(/functions/v1/<이름>)만 허용한다(lib/service-client.js baseUrl과 같은 규칙).
  if(!out.serviceUrl)out.serviceUrl=SERVICE_URL;
  try{const u=new URL(out.serviceUrl);if(u.username||u.password||u.search||u.hash||!/^\/(?:functions\/v1\/[a-z0-9_-]+\/?)?$/.test(u.pathname)||(u.protocol!=='https:'&&!(u.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname))))throw new Error();out.serviceUrl=u.origin+u.pathname.replace(/\/$/,'');}catch{throw new Error('HTTPS 서비스 주소를 입력하세요(원점 또는 Supabase /functions/v1/<이름>). 개발용 localhost만 HTTP를 허용합니다.');}
  if(out.serviceUrl===SERVICE_URL)out.appSessionToken='';
  out.whisperModel=({tiny:'base-wasm',base:'base-wasm'})[out.whisperModel]||out.whisperModel;if(!['small-webgpu','base-wasm'].includes(out.whisperModel))out.whisperModel='small-webgpu';out.whisperLang=({korean:'ko',english:'en'})[out.whisperLang]||out.whisperLang;if(!['auto','ko','en'].includes(out.whisperLang))out.whisperLang='auto';if(!['ppocr-v5-wasm','vision-cloud'].includes(out.ocrEngine))out.ocrEngine='ppocr-v5-wasm';if(!['system','light','dark'].includes(out.theme))out.theme='system';
  // 동의 기록: 메타데이터(버전·시각)는 동의가 있을 때만 남기고, 철회하면 흔적도 지운다.
  const text=v=>typeof v==='string'?v.trim().slice(0,32):'',stamp=v=>Number.isFinite(v)&&v>0?Math.floor(v):0;
  out.visionConsentVersion=out.visionConsent?text(input.visionConsentVersion):'';
  out.visionConsentAt=out.visionConsent?stamp(input.visionConsentAt):0;
  out.summaryConsentVersion=out.remoteSummaryConsent?text(input.summaryConsentVersion):'';
  out.summaryConsentAt=out.remoteSummaryConsent?stamp(input.summaryConsentAt):0;
  const noteOpts=input.noteOptions&&typeof input.noteOptions==='object'&&!Array.isArray(input.noteOptions)?input.noteOptions:{};
  out.noteOptions={syntheticExamples:noteOpts.syntheticExamples===true,externalAugmentation:noteOpts.externalAugmentation===true};
  const bg=input.backgroundConsent&&typeof input.backgroundConsent==='object'?input.backgroundConsent:{},personalUse=bg.personalUse===true,accessRights=bg.accessRights===true;
  out.backgroundConsent=personalUse||accessRights?{personalUse,accessRights,version:text(bg.version),at:stamp(bg.at)}:{personalUse:false,accessRights:false,version:'',at:0};
  out.authSession=authSessionOf(input.authSession);
  return out;
}
async function loadSettings(){const local=await chrome.storage.local.get(KEYS);await chrome.storage.local.remove(['apiKey','openRouterApiKey','summaryModel','syncKey','provider','allowRemoteOcr','plan']);await chrome.storage.sync.remove(['apiKey','syncKey']);return validateSettings(local);}
// authSession은 여기서 쓰지 않는다: 설정 저장은 모든 키를 다시 쓰므로, 그 사이 토큰 갱신이 끝났다면 새 refresh token을 옛 값으로 덮어 로그아웃시킨다.
async function saveSettings(patch){const unknown=Object.keys(patch).filter(k=>!KEYS.includes(k)||k==='authSession');if(unknown.length)throw new Error('허용되지 않은 설정입니다.');const next=validateSettings({...await loadSettings(),...patch}),{authSession,...rest}=next;await chrome.storage.local.set(rest);return next;}
// 로그인 세션만 따로 읽고 쓴다(검증은 validateSettings와 같은 authSessionOf). null이거나 형식이 어긋나면 지운다.
async function loadAuthSession(){return authSessionOf((await chrome.storage.local.get('authSession')).authSession);}
async function saveAuthSession(session){const clean=authSessionOf(session);if(clean)await chrome.storage.local.set({authSession:clean});else await chrome.storage.local.remove('authSession');return clean;}
// 클라우드 인식(화면 프레임, 이후 음성 조각 포함) 동의를 현재 문구 버전으로 받았는가. 버전 도입 전 동의('')는 화면 프레임에만 해당하므로 false다 - 기존 화면 전송 게이트(visionConsent===true)는 그대로 둔다.
function cloudRecognitionAllowed(settings,termsVersion=TERMS_VERSION){return settings?.visionConsent===true&&Boolean(termsVersion)&&settings.visionConsentVersion===termsVersion;}
// 백그라운드 처리 허용: 사용 동의 2종이 모두 true이고 현재 약관 버전으로 받았을 때만. 버전이 바뀌면 다시 받아야 한다.
function backgroundAllowed(settings,termsVersion=TERMS_VERSION){const c=settings?.backgroundConsent;return c?.personalUse===true&&c?.accessRights===true&&Boolean(termsVersion)&&c.version===termsVersion;}
// 외부 요약 처리 동의를 현재 문구 버전으로 받았는가. remoteSummaryConsent는 버전 기록이 없던 옛 플래그라, 요약 동의는 summaryConsentVersion이 TERMS_VERSION과 같을 때만 인정한다.
function summaryAllowed(settings,termsVersion=TERMS_VERSION){return settings?.remoteSummaryConsent===true&&Boolean(termsVersion)&&settings.summaryConsentVersion===termsVersion;}
if(typeof module!=='undefined')module.exports={DEFAULTS,SERVICE_URL,TERMS_VERSION,validateSettings,loadSettings,saveSettings,loadAuthSession,saveAuthSession,cloudRecognitionAllowed,backgroundAllowed,summaryAllowed};
