// 설정 읽기/쓰기 한 곳. 여기에 저장되는 건 전부 사용자 설정값이며 강의 유래 데이터가 아니다.
// 강의 스크립트·노트·프레임은 어떤 경우에도 storage에 넣지 않는다.

const DEFAULTS = {
  provider: "gemini", // 요약용 원격 제공자 (선택 사항)
  summaryModel: "", // 비우면 PROVIDER_DEFAULT_MODEL 사용
  allowRemoteOcr: false, // 캡처 이미지를 외부로 보내는 옵션 — 기본 꺼짐
  ocrEngine: "nano", // "nano" (Chrome 내장 Gemini Nano) | "tesseract" (Tesseract.js 로컬)
  ocrEnabled: true, // 화면 캡처(OCR) 사용 여부. 끄면 음성(Whisper) 전용으로 깨끗하고 가볍게 동작
  whisperEnabled: false, // 로컬 음성 인식(Whisper) 사용 여부
  whisperModel: "tiny", // "tiny" (초경량, 약 40MB) | "base" (고품질, 약 200MB)
  whisperLang: "auto", // 음성 인식 언어. auto면 Whisper가 청크마다 스스로 판별한다
  outputFormat: "summary", // 노트 형태. 마지막으로 고른 값을 기억한다
  theme: "system", // 화면 테마: "system" | "light" | "dark" (lib/theme.js가 적용)
  syncKey: false, // API 키를 크롬 계정에 동기화할지
  consentAccepted: false,
};

const PROVIDER_DEFAULT_MODEL = {
  gemini: "gemini-flash-latest",
  anthropic: "claude-3-5-sonnet-20241022",
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
