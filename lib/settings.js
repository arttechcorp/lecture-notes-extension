// 설정 읽기/쓰기 한 곳. 여기에 저장되는 건 전부 사용자 설정값이며 강의 유래 데이터가 아니다.
// 강의 스크립트·노트·프레임은 어떤 경우에도 storage에 넣지 않는다.

const DEFAULTS = {
  provider: "gemini", // 요약용 원격 제공자
  summaryModel: "", // 비우면 PROVIDER_DEFAULT_MODEL 사용
  allowRemoteOcr: false, // 캡처 이미지를 외부로 보내는 옵션 — 기본 꺼짐
  whisperEnabled: false, // 로컬 음성 인식(Whisper) 사용 여부
  syncKey: false, // API 키를 크롬 계정에 동기화할지
  consentAccepted: false,
};

const PROVIDER_DEFAULT_MODEL = {
  gemini: "gemini-flash-latest",
  anthropic: "claude-sonnet-5",
};

const PROVIDER_LABEL = { gemini: "Gemini", anthropic: "Claude" };
const PROVIDER_KEY_URL = {
  gemini: "https://aistudio.google.com/apikey",
  anthropic: "https://console.anthropic.com/settings/keys",
};

async function loadSettings() {
  const local = await chrome.storage.local.get(Object.keys(DEFAULTS).concat("apiKey"));
  const s = { ...DEFAULTS, ...local };
  // 동기화를 켜둔 경우 키는 sync 쪽이 진실. 다른 컴퓨터에서 바로 쓰려는 용도.
  if (s.syncKey) {
    const synced = await chrome.storage.sync.get("apiKey");
    if (synced.apiKey) s.apiKey = synced.apiKey;
  }
  if (!s.summaryModel) s.summaryModel = PROVIDER_DEFAULT_MODEL[s.provider];
  return s;
}

async function saveSettings(patch) {
  await chrome.storage.local.set(patch);
}

async function saveApiKey(key, sync) {
  await chrome.storage.local.set({ apiKey: key, syncKey: !!sync });
  if (sync) await chrome.storage.sync.set({ apiKey: key });
  else await chrome.storage.sync.remove("apiKey");
}

if (typeof module !== "undefined") {
  module.exports = { DEFAULTS, PROVIDER_DEFAULT_MODEL, PROVIDER_LABEL, PROVIDER_KEY_URL };
}
