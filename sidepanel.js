// 사이드패널이 모든 상태와 모든 AI 호출을 소유한다.
//
// 무저장 불변식: 강의 유래 데이터(프레임·인식 텍스트·노트)는 아래 변수들에만 존재하고
// chrome.storage에 절대 들어가지 않는다. 패널이 닫히면 이 페이지와 함께 사라진다.
const $ = (id) => document.getElementById(id);
const els = {
  tabSelect: $("tabSelect"), modeSelect: $("modeSelect"), langSelect: $("langSelect"), startBtn: $("startBtn"), stopBtn: $("stopBtn"),
  notesBtn: $("notesBtn"), previewBtn: $("previewBtn"),
  status: $("status"), result: $("result"), rawScript: $("rawScript"), tokenUsage: $("tokenUsage"),
  debugLog: $("debugLog"), banner: $("engineBanner"), cropRow: $("cropRow"), cropWrap: $("cropWrap"),
  cropImg: $("cropImg"), cropBox: $("cropBox"), cropHint: $("cropHint"),
  outputFormat: $("outputFormat"), customPrompt: $("customPrompt"),
  // 단계 전환
  stageReady: $("stageReady"), stageLive: $("stageLive"), stageDone: $("stageDone"),
  onboard: $("onboard"), obConsent: $("obConsent"), obWhisper: $("obWhisper"),
  obEngineWhy: $("obEngineWhy"), obEngineBtn: $("obEngineBtn"), obDone: $("obDone"),
  // 준비 카드
  markEngine: $("markEngine"), markVoice: $("markVoice"), markTab: $("markTab"),
  voiceState: $("voiceState"), tabState: $("tabState"), engineDetail: $("engineDetail"),
  // 설정 서랍
  drawer: $("settingsDrawer"), settingsToggle: $("settingsToggle"), settingsClose: $("settingsClose"),
  settingsSummary: $("settingsSummary"), formatSummary: $("formatSummary"), formatToggle: $("formatToggle"),
  settingsLink: $("settingsLink"), popoutBtn: $("popoutBtn"), ocrEnabledToggle: $("ocrEnabledToggle"), ocrEngineSelect: $("ocrEngineSelect"), ocrEngineField: $("ocrEngineField"), cropField: $("cropField"), doneAlert: $("doneAlert"),
  // 진행
  elapsed: $("elapsed"), cntSlides: $("cntSlides"), cntVoice: $("cntVoice"), cntQueue: $("cntQueue"),
  feedLines: $("feedLines"), panelAlert: $("panelAlert"),
  // 완료
  doneSummary: $("doneSummary"), donePill: $("donePill"), againBtn: $("againBtn"), summarySettingsBtn: $("summarySettingsBtn"),
  resultTitle: $("resultTitle"), resultHint: $("resultHint"), resumeBtn: $("resumeBtn"),
  renderFrame: $("renderFrame"), viewRenderedBtn: $("viewRenderedBtn"), viewRawBtn: $("viewRawBtn"),
  pdfBtn: $("pdfBtn"), notionBtn: $("notionBtn"), exportRow: $("exportRow"),
  notionModal: $("notionModal"), notionModalClose: $("notionModalClose"),
  // 하단
  planLine: $("planLine"), planSelect: $("planSelect"), planName: $("planName"), planUse: $("planUse"),
};

// --- 단계 전환 -------------------------------------------------------------------
// 한 화면에 주된 행동은 하나만 둔다. 준비·진행·결과를 동시에 보여주면
// 처음 여는 사람이 무엇부터 눌러야 할지 알 수 없다.
let stage = "onboard";
function setStage(name) {
  // 동의 전에는 온보딩 말고 아무것도 열지 않는다. 게이트를 "화면을 숨긴다"에만
  // 맡겼다가 #onboard의 display 규칙 하나에 통째로 뚫렸다. 모든 전환이 여길
  // 지나가므로, 개별 버튼마다 가드를 다는 대신 여기서 한 번 막는다.
  if (name !== "onboard" && !(settings && settings.consentAccepted)) name = "onboard";
  stage = name;
  els.onboard.hidden = name !== "onboard";
  els.stageReady.hidden = name !== "ready";
  els.stageLive.hidden = name !== "live";
  els.stageDone.hidden = name !== "done";
  $("stepReady").className = name === "ready" || name === "onboard" ? "active" : "";
  $("stepLive").className = name === "live" ? "active" : "";
  $("stepDone").className = name === "done" ? "active" : "";
  if (name !== "ready") els.drawer.hidden = true;
}

els.outputFormat.addEventListener("change", () => {
  els.customPrompt.style.display = els.outputFormat.value === "custom" ? "block" : "none";
  renderSettingsSummary();
  saveSettings({ outputFormat: els.outputFormat.value });
});

// --- 세션 상태 (메모리 전용) -----------------------------------------------------
let transcript = []; // [{ time, text }]
let title = "";
let port = null;
let capturing = false;
let busy = false; // 노트 생성 중 중복 실행 방지
let preparing = false; // 모델 준비 중 시작 버튼 중복 실행 방지
let finishTimer = null;
let queue = []; // OCR 대기 중인 프레임 배치
let draining = false;
let localSession = null;
let tessReady = false;
let nanoFailedThisSession = false; // Gemini Nano가 연속 실패한 경우 해당 세션 동안 로컬 Tesseract로 자동 대체
let cropRect = null; // 0~1 정규화
let settings = null;
let engine = "local"; // "local" | "remote" | "none"
let lastVideoTime = 0; // content.js가 알려주는 영상 재생 위치(초)
// 에러가 뜬 뒤에는 상태줄을 잠근다. content.js가 5초마다 보내는 진행 메시지가
// 같은 자리에 덮어써서, 에러가 5초만 보이고 흔적 없이 사라지던 문제를 막는다.
let statusSticky = false;

const tokens = { ocr: { input: 0, output: 0 }, notes: { input: 0, output: 0 } };

// OCR 대기 배치 상한. slide 모드 기준 배치당 8장이니 최대 32장(약 5MB)까지만 쥔다.
const MAX_QUEUE_BATCHES = 4;
// 캡처 종료 후 음성 인식을 기다리는 상한. 20초 청크 기준 3분이면 밀린 것을
// 웬만큼 따라잡는다. 넘으면 남은 건수를 알리고 진행한다.
const FINISH_WAIT_MS = 3 * 60 * 1000;

const setStatus = (t) => (els.status.textContent = t);
// 로그는 2시간짜리 강의면 수천 줄까지 자란다. 오래된 건 진단에 쓸모가 없다.
const LOG_MAX_LINES = 500;

// 어느 단계가 느린지는 줄 사이의 간격으로만 알 수 있다. 캡처 시작을 0으로 잡고
// 경과 시각을 붙인다. 벽시계보다 이쪽이 읽기 쉽다 — 단계 간 소요가 바로 뺄셈이 된다.
let logT0 = Date.now();
const resetClock = () => (logT0 = Date.now());
function stamp() {
  const s = (Date.now() - logT0) / 1000;
  return `[${String(Math.floor(s / 60)).padStart(2, "0")}:${(s % 60).toFixed(1).padStart(4, "0")}]`;
}
const log = (t) => {
  const lines = (els.debugLog.textContent + `${stamp()} ${t}` + "\n").split("\n");
  els.debugLog.textContent = lines.slice(-LOG_MAX_LINES).join("\n");
  els.debugLog.scrollTop = els.debugLog.scrollHeight;
};


// 토큰 수는 원격 호출로 실제 과금이 일어났을 때만 의미가 있다. 로컬만 쓰는
// 사용자에게 0이 두 줄 떠 있는 건 정보가 아니라 잡음이다.
function renderTokens() {
  const total = tokens.ocr.input + tokens.ocr.output + tokens.notes.input + tokens.notes.output;
  if (!total) return (els.tokenUsage.textContent = "");
  els.tokenUsage.textContent =
    `이번 세션 토큰 — 화면 ${(tokens.ocr.input + tokens.ocr.output).toLocaleString()} · ` +
    `노트 ${(tokens.notes.input + tokens.notes.output).toLocaleString()}`;
}

function renderRaw() {
  els.rawScript.textContent = transcript.map((e) => `[${formatTime(e.time)}] ${e.text}`).join("\n");
  renderProgress();
}

// 진행 중에는 숫자가 살아 움직여야 한다. "프레임 3장 대기 중" 한 줄이 5초마다
// 덮어써지는 것만으로는 동작하는지 멈췄는지 알 수 없다.
function renderProgress() {
  const voice = transcript.filter((e) => e.text.startsWith("[음성]"));
  els.cntSlides.textContent = transcript.length - voice.length;
  els.cntVoice.textContent = voice.length;
  // "처리 대기"가 OCR 배치만 세고 있었다. 정작 밀리는 쪽은 음성이다.
  const pendingVoice = audioCapturer ? audioCapturer.pending : 0;
  els.cntQueue.textContent = queue.length + pendingVoice;

  const last = transcript.slice(-3);
  if (!last.length) {
    els.feedLines.innerHTML = '<div class="empty">아직 인식된 내용이 없습니다.</div>';
    return;
  }
  els.feedLines.textContent = "";
  for (const item of last) {
    const row = document.createElement("div");
    const t = document.createElement("span");
    t.className = "t";
    t.textContent = formatTime(item.time);
    const body = document.createElement("span");
    body.textContent = item.text.replace(/^\[음성\] /, "");
    row.append(t, body);
    els.feedLines.appendChild(row);
  }
}

let elapsedTimer = null;
function startElapsed() {
  const t0 = Date.now();
  const tick = () => {
    const s = Math.floor((Date.now() - t0) / 1000);
    const timeStr = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
    els.elapsed.textContent = timeStr;
    document.title = `[${timeStr} 캡처 중] Summrizei`;
  };
  tick();
  clearInterval(elapsedTimer);
  elapsedTimer = setInterval(tick, 1000);
}
function stopElapsed() {
  clearInterval(elapsedTimer);
  elapsedTimer = null;
  document.title = "Summrizei — 강의 노트";
}

// --- 엔진 판정 -------------------------------------------------------------------
// 준비 상태는 개발자의 말이 아니라 사용자의 말로 적는다.
// "온디바이스 OCR(Nano) 사용 가능"이 아니라 "화면 글자 읽기 — 준비됨".
function setRow(mark, cls, valEl, text) {
  mark.textContent = cls === "ok" ? "✓" : cls === "warn" ? "!" : "·";
  mark.className = "mark" + (cls === "ok" ? "" : cls === "warn" ? " warn" : " off");
  if (valEl) valEl.textContent = text;
}

async function detectEngine() {
  settings = await loadSettings();
  els.langSelect.value = settings.whisperLang;
  // timeline 은 더 이상 출력 형태가 아니다(결과 화면의 버튼으로 옮겼다).
  // 예전에 그 값을 저장한 사용자가 계속 막히지 않도록 풀어준다.
  if (settings.outputFormat === "timeline") {
    settings.outputFormat = "summary";
    saveSettings({ outputFormat: "summary" });
    log("저장된 출력 형태 'timeline' 을 '핵심 요약본' 으로 되돌렸습니다.");
  }
  els.outputFormat.value = settings.outputFormat || "summary";
  els.customPrompt.style.display = els.outputFormat.value === "custom" ? "block" : "none";
  if (els.ocrEnabledToggle) {
    els.ocrEnabledToggle.checked = settings.ocrEnabled !== false;
  }
  if (els.cropField) {
    els.cropField.hidden = settings.ocrEnabled === false;
  }
  if (els.ocrEngineField) {
    els.ocrEngineField.hidden = settings.ocrEnabled === false;
  }
  if (els.ocrEngineSelect) {
    els.ocrEngineSelect.value = settings.ocrEngine || "nano";
  }

  let detail = "";
  if (settings.ocrEnabled === false) {
    engine = "none";
    setRow(els.markEngine, "off", els.banner, "꺼짐");
    detail = "화면 캡처가 꺼져 있습니다. 음성(Whisper) 전용으로 깨끗하게 노트를 만듭니다.";
  } else if (settings.allowRemoteOcr && settings.apiKey) {
    engine = "remote";
    setRow(els.markEngine, "ok", els.banner, "원격");
    detail = "화면 글자를 원격 API로 처리합니다. 캡처 이미지가 외부로 전송됩니다.";
  } else if (settings.ocrEngine === "nano") {
    if (nanoFailedThisSession) {
      engine = "tesseract";
      setRow(els.markEngine, "ok", els.banner, "Tesseract (대체)");
      detail = "Gemini Nano 인식 오류로 인해 로컬 Tesseract로 자동 대체 동작 중입니다.";
    } else {
      const status = typeof localAvailability !== "undefined" ? await localAvailability() : "unavailable";
      if (status === "available" || status === "readily") {
        engine = "nano";
        setRow(els.markEngine, "ok", els.banner, "Gemini Nano · 온디바이스");
        detail = "Chrome 내장 Gemini Nano가 기기 안에서 화면 글자를 읽습니다.";
      } else if (status === "downloadable" || status === "downloading" || status === "after-download") {
        engine = "nano";
        setRow(els.markEngine, "warn", els.banner, "다운로드 필요");
        detail = "Chrome 내장 Gemini Nano 모델 다운로드가 필요합니다.";
      } else {
        engine = "tesseract";
        setRow(els.markEngine, "ok", els.banner, "Tesseract (대체)");
        detail = "이 기기에서는 Gemini Nano를 사용할 수 없어 Tesseract로 대체 동작합니다.";
      }
    }
  } else {
    engine = "tesseract";
    setRow(els.markEngine, "ok", els.banner, "로컬 · 무료");
    detail = "Tesseract가 사양 제약 없이 기기 안에서 글자를 읽습니다.";
  }

  els.engineDetail.textContent = detail;
  els.engineDetail.hidden = !detail;

  const whisperModelName = (settings.whisperModel === "base") ? "Base" : "Tiny";
  setRow(
    els.markVoice,
    settings.whisperEnabled ? "ok" : "off",
    els.voiceState,
    settings.whisperEnabled ? `켜짐 (${whisperModelName})` : "꺼짐"
  );

  renderSettingsSummary();
  renderPlan();
  renderTokens();
}

// 설정은 한 줄로 접어둔다. 대부분 기본값으로 쓰고, 바꿀 때만 편다.
const MODE_LABEL = { region: "슬라이드 영역만", slide: "전체 화면", caption: "하단 자막 띠" };
const LANG_LABEL = { auto: "언어 자동", korean: "한국어", english: "영어" };
const FORMAT_LABEL = { summary: "핵심 요약본", custom: "직접 입력" };

function renderSettingsSummary() {
  const ocrPart = (settings && settings.ocrEnabled === false)
    ? "화면 꺼짐(음성 전용)"
    : (MODE_LABEL[els.modeSelect.value] || els.modeSelect.value);
  const parts = [
    ocrPart,
    LANG_LABEL[els.langSelect.value] || els.langSelect.value,
    FORMAT_LABEL[els.outputFormat.value] || els.outputFormat.value,
  ];
  els.settingsSummary.textContent = parts.join(" · ");
  els.formatSummary.textContent = "형태: " + (FORMAT_LABEL[els.outputFormat.value] || els.outputFormat.value);
}

function renderPlan() {
  const plan = settings.plan || "premium";
  if (els.planSelect) els.planSelect.value = plan;

  if (plan === "premium") {
    els.planName.textContent = "✨ Premium (Claude Sonnet 5)";
    els.planUse.textContent = "수식·그래프·고품질 요약";
  } else {
    els.planName.textContent = "🌱 Free (무료 플랜)";
    els.planUse.textContent = "온디바이스 Gemini Nano 요약";
  }

  // 개발용 키 파일이 쓰이는 중이면 알린다. 폴더를 압축해 배포하면 키가 함께
  // 나가므로, 잊고 지나치지 않게 계속 보이는 자리에 둔다.
  if (settings.devKeyInUse) {
    els.planUse.textContent += " · 키 파일 사용 중(배포 전 삭제)";
  }
}

function renderTabRow() {
  const opt = els.tabSelect.selectedOptions[0];
  const ok = !!opt;
  setRow(els.markTab, ok ? "ok" : "warn", els.tabState, ok ? opt.textContent.split(" — ")[1] || opt.textContent : "없음");
  els.tabState.title = opt ? opt.textContent : "";
  if (!capturing && !busy && !preparing) els.startBtn.disabled = !ok;
}

// --- 탭 선택 (사이트 하드코딩 없음) ------------------------------------------------
const originOf = (url) => {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
};

async function loadTabs() {
  const { lastOrigin } = await chrome.storage.local.get("lastOrigin");
  const selectedId = els.tabSelect.value;
  const tabs = (await chrome.tabs.query({})).filter((t) => /^https?:/.test(t.url || ""));
  tabs.sort((a, b) => Number(b.active) - Number(a.active) || (originOf(b.url) === lastOrigin) - (originOf(a.url) === lastOrigin));
  els.tabSelect.innerHTML = "";
  for (const t of tabs) {
    const opt = document.createElement("option");
    opt.value = String(t.id);
    opt.textContent = `${new URL(t.url).hostname} — ${(t.title || "").slice(0, 60)}`;
    els.tabSelect.appendChild(opt);
  }
  if (tabs.some((tab) => String(tab.id) === selectedId)) els.tabSelect.value = selectedId;
  if (!tabs.length) setStatus("열린 http(s) 탭이 없습니다. 영상을 먼저 여세요.");
  renderTabRow();
}

// --- 탭 연결 + 포트 프로토콜 -------------------------------------------------------
async function connectToTab() {
  const tabId = Number(els.tabSelect.value);
  const tab = tabId ? await chrome.tabs.get(tabId).catch(() => null) : null;
  if (!tab) throw new Error("탭을 찾을 수 없습니다. 목록을 새로고침하세요.");
  const origin = originOf(tab.url);
  // 설치 시점에 <all_urls>를 요구하지 않는다 — 실제로 쓰는 사이트만 그때그때 승인받는다.
  // permissions.request는 사용자 클릭 안에서만 동작하므로 호출자가 클릭 핸들러여야 한다.
  if (!(await chrome.permissions.request({ origins: [`${origin}/*`] }))) {
    throw new Error(`${origin} 접근 권한이 없어 캡처할 수 없습니다.`);
  }
  chrome.storage.local.set({ lastOrigin: origin });
  await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ["content.js"] });

  if (port) port.disconnect();
  const connectedPort = chrome.tabs.connect(tabId, { name: "capture" });
  port = connectedPort;
  connectedPort.onMessage.addListener(onPortMessage);
  connectedPort.onDisconnect.addListener(() => {
    if (port === connectedPort) port = null;
  });
  return port;
}

function onPortMessage(msg) {
  if (msg.type === "progress") {
    if (msg.stage === "error") return fail(msg.detail);
    if (!statusSticky) setStatus(`${msg.detail}${queue.length ? ` · OCR 대기 ${queue.length}배치` : ""}`);
  }
  if (msg.type === "tick") lastVideoTime = msg.t;
  if (msg.type === "audio") audioCapturer.pushAudio(msg);
  if (msg.type === "silence") log(`[음성] ${Math.round(msg.t)}초 구간 무음 — 건너뜀 (RMS ${msg.rms.toFixed(5)})`);
  if (msg.type === "log") log(msg.text);
  if (msg.type === "preview") showPreview(msg.dataUrl);
  if (msg.type === "frames") {
    queue.push({ frames: msg.frames, times: msg.times });
    log(`배치 도착 — 프레임 ${msg.frames.length}장 (대기 ${queue.length}배치)`);
    // 프레임은 JPEG data URL이라 장당 100~200KB다. OCR이 캡처보다 느리면 큐가
    // 끝없이 자란다 — 2시간 강의면 수백 MB까지 가고 결국 패널이 죽는다.
    // 오래된 배치를 버려서 메모리를 확정적으로 묶는다. 슬라이드는 몇 초 사이에
    // 크게 바뀌지 않으므로 손실보다 죽지 않는 쪽이 낫다.
    while (queue.length > MAX_QUEUE_BATCHES) {
      const dropped = queue.shift();
      log(`OCR 처리가 밀려 프레임 ${dropped.frames.length}장을 버렸습니다 (대기 ${queue.length}배치)`);
    }
    drainQueue();
  }
  if (msg.type === "done") {
    capturing = false;
    title = msg.title || "";
    finishCapture();
  }
}

// 온디바이스 모델의 최초 다운로드는 사용자 제스처가 있을 때만 시작할 수 있다.
// drainQueue()는 포트 메시지 핸들러에서 돌기 때문에 제스처가 없다 — 시작 버튼
// 클릭은 이미 수 초 전이라 만료됐다. 그래서 모델을 아직 안 받은 기기에서는
// create()가 실패하고, 그 실패가 상태줄에서 덮여 사라지면서 "아무 일도 안 일어남"으로
// 보였다. 모델이 이미 받아진 기기에서는 다운로드가 필요 없어 그냥 통과했다.
async function prepareLocalSession() {
  if (localSession) return;
  setStatus("온디바이스 Gemini Nano 모델 준비 중...");
  log("Gemini Nano 세션 생성 시도");
  const prepT0 = Date.now();
  localSession = await createLocalSession((p) => {
    setStatus(`Gemini Nano 모델 다운로드 중 ${Math.round(p * 100)}%`);
  });
  log(`Gemini Nano 준비 완료 — ${((Date.now() - prepT0) / 1000).toFixed(1)}초`);
}

async function prepareTesseract() {
  if (engine !== "tesseract" || tessReady) return;
  setStatus("Tesseract OCR 준비 중... 처음이면 언어 데이터를 읽는 데 잠시 걸립니다.");
  log("Tesseract 워커 생성 시도");
  await createTesseractPool((m) => {
    if (m && m.status) setStatus(`Tesseract ${m.status}${m.progress ? ` ${Math.round(m.progress * 100)}%` : ""}`);
  });
  tessReady = true;
  log("Tesseract 준비 완료");
}

// --- OCR 큐 ----------------------------------------------------------------------
// 모델 이름은 제공자마다 형식이 다르다. OpenRouter 는 "제공사/모델" 슬러그를 쓰고,
// Anthropic 직통은 날짜 접미사 없는 이름을 쓴다. 하나로 뭉뚱그리면 404 가 난다.
const OCR_MODEL = {
  gemini: "gemini-flash-latest",
  anthropic: "claude-haiku-4-5",
  openrouter: "anthropic/claude-haiku-4.5",
};
const ocrModelFor = (p) => OCR_MODEL[p] || OCR_MODEL.openrouter;

async function drainQueue() {
  if (draining) return;
  draining = true;
  try {
    while (queue.length) {
      const { frames, times } = queue.shift();
      const batchT0 = Date.now();
      log(`OCR 시작 — ${engine} 엔진으로 ${frames.length}장`);
      setStatus(`OCR 처리 중 (${frames.length}장, 대기 ${queue.length}배치)`);
      let lines;
      if (engine === "remote") {
        const configured = settings.provider || "openrouter";
        const ocrProvider = providerForKey(settings.apiKey, configured);
        const model = ocrModelFor(ocrProvider);
        const res = await callRemote(ocrProvider, model, settings.apiKey, buildOcrBody(ocrProvider, model, frames));
        tokens.ocr.input += res.input;
        tokens.ocr.output += res.output;
        lines = parseOcrJson(res.text);
      } else if (engine === "nano") {
        try {
          await prepareLocalSession();
          lines = await ocrLocal(localSession, frames, (i, n) => setStatus(`Gemini Nano OCR ${i}/${n}`));
        } catch (nanoErr) {
          nanoFailedThisSession = true;
          log(`[엔진 대체] Gemini Nano OCR 실패 (${nanoErr.message || nanoErr}) ➔ 로컬 Tesseract로 자동 전환합니다.`);
          setStatus("Gemini Nano 화면 인식이 원활하지 않아 로컬 Tesseract로 자동 전환합니다...");
          engine = "tesseract";
          setRow(els.markEngine, "ok", els.banner, "Tesseract (대체)");
          if (els.engineDetail) {
            els.engineDetail.textContent = "Gemini Nano 오류로 인해 로컬 Tesseract로 자동 전환되어 동작 중입니다.";
            els.engineDetail.hidden = false;
          }
          await prepareTesseract();
          lines = await ocrTesseract(await createTesseractPool(), frames, (i, n) => setStatus(`Tesseract OCR ${i}/${n}`));
        }
      } else {
        await prepareTesseract();
        lines = await ocrTesseract(await createTesseractPool(), frames, (i, n) => setStatus(`Tesseract OCR ${i}/${n}`));
      }
      log(
        `OCR(${engine}) ${frames.length}장 — ${((Date.now() - batchT0) / 1000).toFixed(1)}초 ` +
          `(장당 ${((Date.now() - batchT0) / frames.length / 1000).toFixed(1)}초, 남은 배치 ${queue.length})`
      );
      transcript = mergeLines(zipEntries(lines, times), transcript);
      renderRaw();
      renderTokens();
      if (transcript.length && !busy) els.notesBtn.disabled = false;
    }
  } catch (e) {
    fail(String(e.message || e));
  } finally {
    draining = false;
  }
}

// --- 노트 생성 (텍스트만 전송) -------------------------------------------------------
// 원격 모델에만 적용되는 상한. 온디바이스는 잘라내는 대신 구간별로 요약해 합친다.
const MAX_SCRIPT_CHARS = 30000;

const NOTES_SYSTEM =
  "너는 대학 강의와 학술 영상을 완벽하게 분석하여 최고 수준의 학습 노트를 만드는 전문가다. " +
  "주어진 텍스트에 실제로 있는 내용만 사용하고 없는 내용을 지어내지 않는다. " +
  "출력은 마크다운 본문만. 인사말·설명·메타 코멘트를 덧붙이지 않는다.";

function buildNotesPrompt(script, truncated) {
  const format = els.outputFormat.value;
  const custom = els.customPrompt.value.trim();
  
  let instruction = "";
  if (format === "summary") {
    instruction =
      "이 스크립트를 바탕으로 강의 내용을 잘 구조화된 한국어 핵심 학습 노트로 작성해라.\n" +
      "다음 작성 지침을 반드시 준수해라:\n" +
      "1. 구조화: 대제목(#), 중제목(##), 소제목(###), 글머리 기호를 활용해 계층적으로 정리할 것.\n" +
      "2. 비교 및 정리: 대안 비교, 주요 항목, 수치 데이터는 마크다운 표(| 구분 | 내용 |)를 적극 활용할 것.\n" +
      "3. 수식(Math): 수학 공식, 통계 공식, 계산식(NPV, IRR 등)이 나오는 경우 반드시 표준 LaTeX 수식 표기($인라인$ 또는 $$블록$$)를 사용할 것. (예: $$NPV = \\sum_{t=1}^{n} \\frac{CF_t}{(1+r)^t} - CF_0$$)\n" +
      "4. 다이어그램(Mermaid): 단계별 흐름, 프로세스, 인과관계, 대안 비교나 의사결정 트리가 있는 경우 반드시 ```mermaid 코드 블록(flowchart TD 또는 flowchart LR 등)으로 시각화할 것.\n" +
      "5. 핵심 원칙: 시험에 자주 출제되거나 실무에서 주의해야 할 핵심 원칙과 함정을 별도 섹션으로 강조할 것.";
  } else if (format === "custom") {
    instruction = `다음 조건을 반드시 지켜서 작성해라:\n조건: ${custom || '내용 요약'}`;
  }

  return (
    `영상 제목: ${title}\n\n` +
    `아래는 영상 화면과 음성 인식을 통해 얻은 텍스트다. 각 줄 앞의 [mm:ss]는 영상 내 위치다.\n` +
    `${instruction}\n\n[캡처 스크립트]\n${script}\n\n` +
    `화면 인식(OCR)과 음성 인식 결과라 오탈자나 조각난 문장이 섞여 있다. 명백한 오독은 문맥으로 보정해라.\n` +
    `"[그림]" 으로 시작하는 부분은 화면에 있던 그래프·표·다이어그램을 옮긴 설명이다. ` +
    `그 내용을 노트의 표나 Mermaid 다이어그램으로 되살려라. 원문에 없는 수치를 지어내지는 마라.` +
    (truncated ? `\n\n(스크립트가 길어 앞부분 ${MAX_SCRIPT_CHARS}자만 전달됐다. 글 끝에 "이후 구간은 분량 제한으로 포함되지 않았습니다"라고 적어라.)` : "")
  );
}

// 온디바이스 모델은 컨텍스트가 작아 스크립트를 통째로 못 받는다("The input is too large").
// 잘라 버리는 대신 구간별로 요약한 뒤 그 요약들을 다시 요약한다. 세션은 매번 새로 뜬다.
async function notesLocal(full, onProgress) {
  if (onProgress) onProgress("Gemini Nano 세션 준비 중...");
  const s = await createLocalSession(
    (loaded) => onProgress && onProgress(`Gemini Nano 모델 다운로드/준비 중... (${Math.round((loaded || 0) / 1024 / 1024)}MB)`),
    {}
  );
  try {
    return await summarizeLocal(
      s,
      full,
      (part, isPartial) =>
        isPartial
          ? "아래는 강의 스크립트의 한 구간이다. 이 구간에서 다룬 내용을 빠짐없이, 사실만 간결히 정리해라. " +
            "인사말이나 메타 코멘트를 붙이지 마라.\n\n" + part
          : buildNotesPrompt(part, false),
      onProgress
    );
  } finally {
    if (s && s.destroy) s.destroy();
  }
}

// 원격 호출 한 번. 프롬프트를 만드는 쪽에서 무엇을 담을지 이미 정해져 있다.
async function notesRemote(prompt) {
  // body 를 만들기 전에 제공자를 확정한다. 형식·엔드포인트·응답 파서가 모두
  // 같은 값을 봐야 한다 — 이게 어긋나면 400 으로 떨어지고 타임라인으로 밀린다.
  const configured = settings.provider || "openrouter";
  const provider = providerForKey(settings.apiKey, configured);
  const model = modelForProvider(provider, configured, settings.summaryModel) || "anthropic/claude-sonnet-5";
  const body = buildSummaryBody(
    provider,
    model,
    NOTES_SYSTEM,
    prompt
  );
  const res = await callRemote(provider, model, settings.apiKey, body);
  tokens.notes.input += res.input;
  tokens.notes.output += res.output;
  return res.text;
}

// buildTimeline 은 제거됐다. 인식 원문을 시간순으로 늘어놓는 출력이었는데,
// AGENTS.md §2 의 "강의 원문을 그대로 재현하지 않는다" 불변식과 정면으로
// 어긋난다. 요약이 실패하면 원문을 대신 보여주는 대신 사유와 재시도를 준다.

let currentViewMode = "rendered";

function setViewMode(mode) {
  currentViewMode = mode;
  const isRendered = mode === "rendered";
  if (els.viewRenderedBtn && els.viewRenderedBtn.classList) {
    els.viewRenderedBtn.classList.toggle("active", isRendered);
  }
  if (els.viewRawBtn && els.viewRawBtn.classList) {
    els.viewRawBtn.classList.toggle("active", !isRendered);
  }
  if (els.renderFrame) els.renderFrame.hidden = !isRendered;
  if (els.result) els.result.hidden = isRendered;
  if (isRendered) updateRenderedView();
}

function updateRenderedView() {
  if (els.renderFrame && els.renderFrame.contentWindow) {
    els.renderFrame.contentWindow.postMessage({
      type: "RENDER",
      markdown: els.result.value || "",
    }, "*");
  }
}

function showNote(text) {
  els.result.value = text;
  els.result.readOnly = false;
  if (els.pdfBtn) els.pdfBtn.disabled = !text;
  if (els.notionBtn) els.notionBtn.disabled = !text;
  updateRenderedView();
  setViewMode("rendered");
  els.donePill.textContent = "노트 완성";
  els.resultTitle.textContent = title || "나의 강의 노트";
  els.resultHint.textContent =
    "자동 생성된 초안입니다. 서식 보기에서 수식/그래프를 확인하고 마크다운 편집 탭에서 수정하세요.";
  const voice = transcript.filter((entry) => entry.text.startsWith("[음성]")).length;
  const slides = transcript.length - voice;
  els.doneSummary.textContent = (settings && settings.ocrEnabled === false)
    ? `음성 ${voice}줄 (화면 캡처 꺼짐)`
    : `화면 ${slides}개 · 음성 ${voice}줄`;
  els.resumeBtn.hidden = false;
  setStage("done");
}

async function generateNotes() {
  if (busy || capturing || draining || queue.length) return;
  if (!transcript.length) return fail("인식된 텍스트가 없습니다. 먼저 캡처를 실행하세요.");
  busy = true;
  statusSticky = false;
  els.panelAlert.hidden = true;
  if (els.doneAlert) els.doneAlert.hidden = true;
  setStage("done");
  els.donePill.textContent = "노트 생성 중";
  els.againBtn.disabled = true;
  els.notesBtn.disabled = true;
  els.formatToggle.disabled = true;
  els.outputFormat.disabled = true;
  els.customPrompt.disabled = true;
  if (els.pdfBtn) els.pdfBtn.disabled = true;
  if (els.notionBtn) els.notionBtn.disabled = true;
  setStatus(`텍스트 ${transcript.length}줄로 결과물 생성 중...`);
  try {
    settings = await loadSettings();
    renderPlan();
    log(
      `노트 생성 — 플랜 ${settings.plan || "premium"}, 형태 ${els.outputFormat.value}, ` +
        `제공자 ${settings.provider || "openrouter"}, 키 ${settings.apiKey ? "있음" : "없음"}`
    );
    const full = transcript.map((e) => `[${formatTime(e.time)}] ${e.text}`).join("\n");
    const plan = settings.plan || "premium";

    let text = "";
    if (plan === "premium") {
      if (!settings.apiKey) throw new Error("API 키가 없습니다.");
      const truncated = full.length > MAX_SCRIPT_CHARS;
      const prompt = buildNotesPrompt(truncated ? full.slice(0, MAX_SCRIPT_CHARS) : full, truncated);
      setStatus("Claude Sonnet으로 고품질 학습 노트(수식·그래프 포함) 작성 중...");
      log(`원격 노트 요청 — 입력 ${prompt.length}자`);
      const remoteT0 = Date.now();
      text = await notesRemote(prompt);
      log(`원격 노트 응답 — ${((Date.now() - remoteT0) / 1000).toFixed(1)}초`);
      renderTokens();
    } else {
      const avail = typeof localAvailability !== "undefined" ? await localAvailability({}) : "unavailable";
      const localReady = avail === "available" || avail === "readily" || avail === "after-download" || avail === "downloadable";
      if (localReady) {
        setStatus("기기 안에서 Gemini Nano로 요약 노트를 작성하는 중...");
        log(`기기 내 Gemini Nano 요약 시작 (상태: ${avail}) — 입력 ${full.length}자`);
        const localT0 = Date.now();
        text = await notesLocal(full, (progressMsg) => {
          setStatus(progressMsg);
        });
        log(`기기 내 요약 완료 — ${((Date.now() - localT0) / 1000).toFixed(1)}초`);
      } else {
        // 원문을 대신 보여주지 않는다(AGENTS.md §2). 무엇이 없어서 못 만들었는지와
        // 무엇을 하면 되는지를 알린다.
        throw new Error(
          `기기 내 요약 모델(Chrome 내장 Gemini Nano)을 쓸 수 없습니다 (상태: ${avail}). ` +
            `chrome://flags 에서 #prompt-api-for-gemini-nano 및 #optimization-guide-on-device-model 활성화 상태를 확인하거나, ` +
            `하단 플랜에서 Premium 으로 바꾸고 API 키를 넣으면 요약할 수 있습니다.`
        );
      }
    }

    if (!text.trim()) throw new Error("AI가 빈 결과를 반환했습니다. 다시 만들어 주세요.");
    showNote(text);
    setStatus("완료. 자동 생성된 결과물입니다. 직접 내용을 검토하세요. 패널을 닫으면 사라집니다.");
  } catch (e) {
    // 인식된 원문은 화면에 내놓지 않는다. 사유만 밝히고 "다시 만들기"를 남긴다.
    const errMsg = `요약하지 못했습니다: ${e.message || e}`;
    if (els.doneAlert) {
      els.doneAlert.textContent = errMsg;
      els.doneAlert.hidden = false;
    }
    return fail(errMsg);
  } finally {
    busy = false;
    els.againBtn.disabled = false;
    els.notesBtn.disabled = !transcript.length;
    els.formatToggle.disabled = false;
    els.outputFormat.disabled = false;
    els.customPrompt.disabled = false;
    els.startBtn.disabled = false;
    if (els.pdfBtn) els.pdfBtn.disabled = !els.result.value;
    if (els.notionBtn) els.notionBtn.disabled = !els.result.value;
  }
}

function finishCapture() {
  clearInterval(finishTimer);
  stopElapsed();
  els.stopBtn.disabled = true;
  els.startBtn.disabled = true;
  if (!transcript.length && !queue.length && !draining) {
    log("캡처 종료 — 인식된 텍스트 0줄");
    stopElapsed();
    const alertMsg = (settings && settings.ocrEnabled === false)
      ? "음성에서 텍스트를 얻지 못했습니다. 영상에 음성이 나오는지, 음소거되어 있지 않은지 확인하세요."
      : "화면에서 텍스트를 얻지 못했습니다. 슬라이드가 없는 영상이거나 캡처 영역이 빗나갔을 수 있습니다.";
    els.panelAlert.textContent = alertMsg;
    els.panelAlert.hidden = false;
    setStage("ready");
    renderTabRow();
    return setStatus(els.panelAlert.textContent);
  }
  // 남은 OCR 배치와 음성 인식을 모두 끝낸 뒤에 노트를 만든다. 예전에는 OCR 만
  // 기다려서, 밀려 있던 음성이 노트에 한 줄도 들어가지 못했다.
  log(
    `캡처 종료 — 남은 배치 ${queue.length}, 음성 대기 ${audioCapturer.pending}건, 인식 ${transcript.length}줄`
  );
  const waitT0 = Date.now();
  setStatus("캡처를 마쳤어요. 남은 인식 내용을 정리하고 있습니다...");
  finishTimer = setInterval(() => {
    const voiceLeft = audioCapturer.pending;
    const waited = Date.now() - waitT0;
    // 무한정 기다리지는 않는다. 상한에 닿으면 남은 건수를 밝히고 진행한다 —
    // 조용히 버리는 것이 지금까지의 문제였다.
    if ((draining || queue.length || voiceLeft) && waited < FINISH_WAIT_MS) {
      if (voiceLeft) {
        setStatus(`음성 인식을 마무리하는 중입니다... 남은 ${voiceLeft}건 (${Math.round(waited / 1000)}초)`);
        renderProgress();
      }
      return;
    }
    clearInterval(finishTimer);
    finishTimer = null;
    log(`남은 처리 대기 — ${(waited / 1000).toFixed(1)}초 (음성 ${voiceLeft}건 남음)`);
    if (voiceLeft) {
      // 여기서부터는 노트에 못 들어간다. 워커가 헛돌며 CPU 를 쓰지 않도록 버린다.
      audioCapturer.abandonPending();
      els.panelAlert.textContent =
        `음성 ${voiceLeft}건이 아직 인식되지 않아 노트에 빠졌습니다. ` +
        `설정에서 더 가벼운 모델을 쓰거나 1배속으로 재생하면 줄어듭니다.`;
      els.panelAlert.hidden = false;
    }
    if (!transcript.length) {
      setStage("ready");
      renderTabRow();
      return setStatus("텍스트를 인식하지 못했어요. 캡처 영역과 영상 재생 상태를 확인한 뒤 다시 시작하세요.");
    }
    generateNotes();
  }, 500);
}

function fail(message) {
  busy = false;
  capturing = false;
  clearInterval(finishTimer);
  finishTimer = null;
  // 상태줄은 진행 메시지에 덮인다. 로그에 남겨야 사후에 원인을 볼 수 있다.
  log(`오류: ${message}`);
  statusSticky = true;
  setStatus(`오류: ${message}`);
  stopElapsed();
  // 진행 화면에서는 그 자리에 띄운다. 상태줄은 진행 메시지에 덮이고,
  // 디버그 로그는 접혀 있어서 아무도 열지 않는다 — 이번 디버깅에서 반복해 물린 지점.
  els.panelAlert.textContent = message;
  els.panelAlert.hidden = false;
  if (els.doneAlert) {
    els.doneAlert.textContent = message;
    els.doneAlert.hidden = false;
  }
  // 포트를 끊지 않으면 content.js가 계속 프레임을 보내고, 매번 같은 실패를 조용히
  // 반복한다. UI는 이미 "중지됨"으로 보이는데 실제로는 캡처가 돌고 있었다.
  if (port) {
    port.disconnect();
    port = null;
  }
  els.startBtn.disabled = false;
  els.stopBtn.disabled = true;
  els.notesBtn.disabled = !transcript.length;
  if (stage === "live" || stage === "done") {
    setStage(transcript.length ? "done" : "ready");
    els.donePill.textContent = els.result.value ? "노트 보존됨 · 오류 확인" : "노트 생성 대기";
  }
}

// --- 영역 지정 --------------------------------------------------------------------
function showPreview(dataUrl) {
  els.cropImg.src = dataUrl;
  els.cropWrap.style.display = "block";
  els.cropHint.textContent = "드래그해서 슬라이드 영역만 선택하세요";
}

(function setupCropDrag() {
  let start = null;
  els.cropWrap.addEventListener("mousedown", (e) => {
    const r = els.cropImg.getBoundingClientRect();
    start = { x: e.clientX - r.left, y: e.clientY - r.top };
    Object.assign(els.cropBox.style, { display: "block", left: `${start.x}px`, top: `${start.y}px`, width: "0px", height: "0px" });
    e.preventDefault();
  });
  els.cropWrap.addEventListener("mousemove", (e) => {
    if (!start) return;
    const r = els.cropImg.getBoundingClientRect();
    const x = Math.max(0, Math.min(r.width, e.clientX - r.left));
    const y = Math.max(0, Math.min(r.height, e.clientY - r.top));
    Object.assign(els.cropBox.style, {
      left: `${Math.min(start.x, x)}px`, top: `${Math.min(start.y, y)}px`,
      width: `${Math.abs(x - start.x)}px`, height: `${Math.abs(y - start.y)}px`,
    });
  });
  window.addEventListener("mouseup", () => {
    if (!start) return;
    start = null;
    const r = els.cropImg.getBoundingClientRect();
    const b = els.cropBox.getBoundingClientRect();
    if (b.width < 10 || b.height < 10) {
      cropRect = null;
      return;
    }
    cropRect = { x: (b.left - r.left) / r.width, y: (b.top - r.top) / r.height, w: b.width / r.width, h: b.height / r.height };
    els.cropHint.textContent = `영역 지정됨 (${Math.round(cropRect.w * 100)}%×${Math.round(cropRect.h * 100)}%)`;
  });
})();

// 강의마다 언어가 다르므로 패널에서 바로 바꾼다. 고른 값은 다음 실행까지 남는다.
els.langSelect.addEventListener("change", () => {
  renderSettingsSummary();
  audioCapturer.language = els.langSelect.value; // 캡처 도중 바꿔도 다음 청크부터 반영된다
  saveSettings({ whisperLang: els.langSelect.value });
});

els.modeSelect.addEventListener("change", () => {
  renderSettingsSummary();
  const isRegion = els.modeSelect.value === "region";
  els.cropRow.style.display = isRegion ? "flex" : "none";
  if (!isRegion) els.cropWrap.style.display = "none";
});
els.modeSelect.dispatchEvent(new Event("change"));

if (els.ocrEnabledToggle) {
  els.ocrEnabledToggle.addEventListener("change", async () => {
    const ocrEnabled = els.ocrEnabledToggle.checked;
    await saveSettings({ ocrEnabled });
    await detectEngine();
  });
}

if (els.ocrEngineSelect) {
  els.ocrEngineSelect.addEventListener("change", async () => {
    nanoFailedThisSession = false;
    const ocrEngine = els.ocrEngineSelect.value;
    await saveSettings({ ocrEngine });
    await detectEngine();
  });
}

els.previewBtn.addEventListener("click", async () => {
  try {
    (await connectToTab()).postMessage({ type: "PREVIEW" });
    setStatus("현재 화면을 불러오는 중...");
  } catch (e) {
    fail(String(e.message || e));
  }
});

// // AudioCapturer 인스턴스
let audioCapturer = new AudioCapturer();
// 오디오 청크에 벽시계가 아니라 영상 시각을 찍기 위한 공급자. 배속·탐색에도 OCR과 눈금이 맞는다.
audioCapturer.getVideoTime = () => lastVideoTime;
audioCapturer.onLog = (m) => log(m);
audioCapturer.onTranscript = (item) => {
  // 캡처가 끝났다고 버리지 않는다. 인식은 재생보다 느려서 상당수가 종료 뒤에
  // 도착하는데, 예전에는 여기서 조용히 사라졌다 — 40분 강의의 노트가 앞 1/3 로
  // 만들어지고 사용자는 그 사실을 알 방법이 없었다. 정렬이 있어 순서는 맞는다.
  transcript.push({ time: item.time, text: `[음성] ${item.text}` });
  // time은 OCR 경로와 같은 "초" 숫자다. 문자열 비교로 정렬하면 OCR 항목에서 터진다.
  transcript.sort((a, b) => a.time - b.time);
  renderRaw();
};

// --- 캡처 시작/중지 ----------------------------------------------------------------
els.startBtn.addEventListener("click", async () => {
  if (preparing || capturing || busy || draining || queue.length || finishTimer) return;
  settings = await loadSettings();
  const ocrActive = settings.ocrEnabled !== false;
  if (!ocrActive && !settings.whisperEnabled) {
    return fail("화면 글자 읽기와 말소리 받아쓰기가 모두 꺼져 있습니다. 설정에서 최소 하나를 켜주세요.");
  }
  if (ocrActive && engine === "none") {
    return fail("사용 가능한 OCR 엔진이 없습니다. 설정에서 온디바이스 모델 상태를 확인하세요.");
  }
  if (ocrActive && els.modeSelect.value === "region" && !cropRect) {
    openDrawer();
    els.previewBtn.focus();
    return setStatus("‘현재 화면 불러오기’에서 영역을 지정해 주세요. 전체 화면을 캡처하려면 위 선택을 변경하세요.");
  }
  preparing = true;
  els.startBtn.disabled = true;
  els.startBtn.textContent = "캡처 준비 중...";
  els.settingsToggle.disabled = true;
  els.resumeBtn.disabled = true;
  statusSticky = false;
  els.panelAlert.hidden = true;
  try {
    // 사이트 권한은 사용자 클릭 직후 확보한다. 모델 다운로드 뒤에는 클릭 권한이 만료된다.
    const capturePort = await connectToTab();
    settings = await loadSettings();
    const ocrWanted = settings.ocrEnabled !== false;
    if (ocrWanted) {
      if (settings.allowRemoteOcr && settings.apiKey) {
        engine = "remote";
      } else if (settings.ocrEngine === "nano") {
        if (nanoFailedThisSession) {
          engine = "tesseract";
          await prepareTesseract();
        } else {
          const nanoStat = typeof localAvailability !== "undefined" ? await localAvailability() : "unavailable";
          if (nanoStat === "available" || nanoStat === "readily") {
            try {
              engine = "nano";
              await prepareLocalSession();
            } catch (prepErr) {
              nanoFailedThisSession = true;
              log(`[엔진 대체] Gemini Nano 세션 준비 실패 (${prepErr.message || prepErr}) ➔ 로컬 Tesseract로 자동 전환합니다.`);
              engine = "tesseract";
              setRow(els.markEngine, "ok", els.banner, "Tesseract (대체)");
              await prepareTesseract();
            }
          } else {
            engine = "tesseract";
            await prepareTesseract();
          }
        }
      } else {
        engine = "tesseract";
        await prepareTesseract();
      }
    } else {
      engine = "none";
    }
    let audioEnabled = settings.whisperEnabled;
    if (audioEnabled) {
      const modelName = settings.whisperModel === "base" ? "Base" : "Tiny";
      setStatus(`음성 인식(Whisper ${modelName}) 모델 준비 중...`);
      try {
        audioCapturer.language = els.langSelect.value;
        audioCapturer.model = settings.whisperModel || "tiny";
        await audioCapturer.initModel((prog) => {
          if (prog.status === 'progress') {
            setStatus(`음성 모델(${modelName}) 다운로드 중... ${Math.round(prog.progress)}%`);
          }
        }, audioCapturer.model);
      } catch(e) {
        audioEnabled = false;
        const errText = `음성 인식(Whisper) 초기화 실패: ${e.message || e}`;
        log(errText);
        if (!ocrWanted) {
          throw new Error(`${errText} — 화면 글자 읽기도 꺼져 있어 캡처를 진행할 수 없습니다.`);
        }
        els.panelAlert.textContent = `${errText} — 음성 없이 화면 글자(OCR)만 진행됩니다.`;
        els.panelAlert.hidden = false;
      }
    }

    if (!ocrWanted && !audioEnabled) {
      throw new Error("화면 글자 읽기와 말소리 받아쓰기가 모두 꺼져 있거나 준비되지 않았습니다.");
    }

    if (port !== capturePort) throw new Error("영상 탭 연결이 끊겼어요. 탭을 확인한 뒤 다시 시작해 주세요.");
    capturePort.postMessage({
      type: "START", mode: els.modeSelect.value, rect: cropRect,
      audio: audioEnabled, ocr: engine, ocrEnabled: ocrWanted,
    });

  // 새 캡처가 실제로 시작된 시점에만 이전 세션을 지운다.
  transcript = [];
  queue = [];
  tokens.ocr = { input: 0, output: 0 };
  tokens.notes = { input: 0, output: 0 };
  els.result.value = "";
  if (els.pdfBtn) els.pdfBtn.disabled = true;
  if (els.notionBtn) els.notionBtn.disabled = true;
  els.resumeBtn.hidden = true;
  els.result.readOnly = true;
  els.rawScript.textContent = "";
  els.debugLog.textContent = "";
  els.notesBtn.disabled = true;
  els.startBtn.disabled = true;
  renderTokens();
  setStatus("스크립트 주입 중...");
    if (!audioEnabled && ocrWanted) {
      log("음성 인식이 꺼져 있습니다 (설정에서 켤 수 있습니다). 화면 OCR만 동작합니다.");
    } else if (audioEnabled && !ocrWanted) {
      log("화면 글자 읽기(OCR)가 꺼져 있습니다. 음성 인식(Whisper) 전용으로 동작합니다.");
    }
    capturing = true;
    els.stopBtn.disabled = false;
    resetClock(); // 로그 시계를 0으로. "캡처 시작" 줄은 content.js 가 상세와 함께 남긴다.
    setStage("live");
    startElapsed();
    renderProgress();
  } catch (e) {
    return fail(String(e.message || e));
  } finally {
    preparing = false;
    els.startBtn.textContent = "캡처 시작";
    els.settingsToggle.disabled = false;
    els.resumeBtn.disabled = false;
    if (!capturing) renderTabRow();
  }
  // content.js는 응답하지 않는다(영상 없는 프레임까지 응답하면 어느 쪽이 이길지 모름).
  // 진행 메시지가 오는지로 성공을 판단한다.
  setTimeout(() => {
    if (capturing && !transcript.length && els.status.textContent.includes("주입")) {
      fail("이 탭에서 재생 중인 영상을 찾지 못했습니다. 영상을 재생한 뒤 다시 시도하세요.");
    }
  }, 3000);
});

els.stopBtn.addEventListener("click", () => {
  stopElapsed();
  // 여기서 음성 워커를 멈추지 않는다. 인식은 재생보다 느려서 상당수가 아직
  // 처리 중이고, finishCapture 가 그걸 기다렸다가 노트에 넣는다.
  els.stopBtn.disabled = true;
  if (port) {
    // 마지막 프레임 배치와 done을 받은 뒤 요약한다. 즉시 disconnect하면
    // content script의 아직 전송하지 않은 화면이 통째로 버려진다.
    port.postMessage({ type: "STOP" });
  } else {
    capturing = false;
    finishCapture();
  }
});

els.notesBtn.addEventListener("click", generateNotes);

// 캡처·생성 도중 패널을 닫으면 전부 사라진다는 걸 미리 알린다.
window.addEventListener("beforeunload", (e) => {
  if (capturing || busy || transcript.length) {
    e.preventDefault();
    e.returnValue = "";
  }
});

// 요약 노트 출력·복사: 생성된 요약 노트를 사용자가 PDF 인쇄하거나 노션(Notion)에 붙여넣을 수 있게 지원한다.
// 단, 강의 원문 녹취록(transcript) 복사나 파일 다운로드/타임라인 생성은 배제하여 비대체성 원칙을 지킨다.
els.tabSelect.addEventListener("change", renderTabRow);
$("refreshTabsBtn").addEventListener("click", loadTabs);

// --- 설정 서랍 --------------------------------------------------------------------
const openDrawer = () => { els.drawer.hidden = false; els.drawer.scrollIntoView({ block: "nearest" }); };
els.settingsToggle.addEventListener("click", openDrawer);
els.formatToggle.addEventListener("click", openDrawer);
els.settingsClose.addEventListener("click", () => { els.drawer.hidden = true; renderSettingsSummary(); });
els.settingsLink.addEventListener("click", () => chrome.runtime.openOptionsPage());
els.summarySettingsBtn.addEventListener("click", () => chrome.runtime.openOptionsPage());

// 완료 화면에서 다시 준비 화면으로.
els.againBtn.addEventListener("click", () => {
  if (busy || preparing) return;
  setStatus("새 캡처를 시작하면 현재 노트가 교체됩니다. 필요한 내용은 먼저 복사하거나 저장하세요.");
  setStage("ready");
  loadTabs();
});
els.resumeBtn.addEventListener("click", () => {
  if (preparing || capturing) return;
  setStage("done");
  setStatus("");
});

// --- 온보딩 (패널 안에서 끝낸다) ------------------------------------------------------
// 별도 탭으로 띄우면 맥락이 끊긴다. 세 가지만 확인하고 바로 첫 캡처로 넘어간다.
async function runOnboarding() {
  setStage("onboard");
  els.obWhisper.checked = settings.whisperEnabled;

  els.obEngineWhy.textContent = "Tesseract가 기기 안에서 화면 글자를 읽습니다. 정확도는 화면 선명도와 글자 크기에 따라 달라집니다.";
  els.obEngineBtn.hidden = true;

  els.obConsent.addEventListener("change", () => (els.obDone.disabled = !els.obConsent.checked));
  els.obDone.addEventListener("click", async () => {
    await saveSettings({ consentAccepted: true, whisperEnabled: els.obWhisper.checked });
    settings.consentAccepted = true; // setStage가 이 값을 본다. 저장만으로는 안 바뀐다.
    settings.whisperEnabled = els.obWhisper.checked;
    setStage("ready");
    await detectEngine();
  });
}


$("optionsLink").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

window.addEventListener("focus", () => {
  if (!capturing && !busy && !preparing && !draining) detectEngine().catch((error) => setStatus(`설정을 읽지 못했어요: ${error.message || error}`));
});

if (els.popoutBtn) {
  const isPopup = typeof window !== "undefined" && window.location && typeof window.location.search === "string" && window.location.search.includes("mode=popup");
  if (isPopup) {
    els.popoutBtn.hidden = true;
  } else {
    els.popoutBtn.addEventListener("click", async () => {
      if (capturing || busy) {
        if (!confirm("현재 캡처 중인 세션은 새 창으로 이전되지 않습니다. 독립 창으로 분리하시겠습니까?")) {
          return;
        }
      }
      const width = 420;
      const height = 720;
      const left = Math.max(0, (window.screen.availWidth || 1920) - width - 40);
      const top = 80;
      await chrome.windows.create({
        url: chrome.runtime.getURL("sidepanel.html?mode=popup"),
        type: "popup",
        width,
        height,
        left,
        top,
      });
      window.close();
    });
  }
}

if (els.viewRenderedBtn) els.viewRenderedBtn.addEventListener("click", () => setViewMode("rendered"));
if (els.viewRawBtn) els.viewRawBtn.addEventListener("click", () => setViewMode("raw"));

if (els.result) {
  els.result.addEventListener("input", () => {
    updateRenderedView();
  });
}

if (els.planSelect) {
  els.planSelect.addEventListener("change", async () => {
    settings.plan = els.planSelect.value;
    await saveSettings({ plan: settings.plan });
    renderPlan();
    log(`플랜 전환: ${settings.plan}`);
  });
}

if (els.pdfBtn) {
  els.pdfBtn.addEventListener("click", () => {
    if (!els.result || !els.result.value) {
      setStatus("출력할 노트 내용이 없습니다. 먼저 강의 노트를 생성해주세요.");
      return;
    }
    // 인쇄 전 서식 보기 모드로 전환하여 렌더링 프레임 활성화
    setViewMode("rendered");
    setStatus("PDF 인쇄 대화상자를 준비하는 중입니다...");
    if (els.renderFrame && els.renderFrame.contentWindow) {
      els.renderFrame.contentWindow.postMessage({
        type: "PRINT",
        markdown: els.result.value,
      }, "*");
    } else {
      window.print();
    }
  });
}

if (els.notionBtn) {
  els.notionBtn.addEventListener("click", async () => {
    const text = els.result ? els.result.value : "";
    if (!text) {
      setStatus("복사할 노트 내용이 없습니다. 먼저 강의 노트를 생성해주세요.");
      return;
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const prevHidden = els.result.hidden;
        els.result.hidden = false;
        els.result.select();
        document.execCommand("copy");
        els.result.hidden = prevHidden;
      }
      const prevText = els.notionBtn.textContent;
      els.notionBtn.textContent = "복사 완료! ✓";
      const noticeMsg = "복사 완료! 이제 노션에 복사하셔서 사용하시면 됩니다!";
      setStatus(noticeMsg);

      if (els.notionModal && typeof els.notionModal.showModal === "function") {
        try {
          els.notionModal.showModal();
        } catch {
          alert(noticeMsg);
        }
      } else {
        alert(noticeMsg);
      }

      setTimeout(() => {
        els.notionBtn.textContent = prevText;
      }, 3000);
    } catch (err) {
      setStatus(`복사 실패: ${err.message || err}`);
    }
  });
}

if (els.notionModalClose && els.notionModal) {
  els.notionModalClose.addEventListener("click", () => {
    els.notionModal.close();
  });
}

if (els.notionModal) {
  els.notionModal.addEventListener("click", (e) => {
    // 배경 클릭 시 닫기
    if (e.target === els.notionModal) {
      els.notionModal.close();
    }
  });
}

window.addEventListener("message", (e) => {
  if (!e.data) return;
  if (e.data.type === "RENDER_HEIGHT" && typeof e.data.height === "number") {
    if (els.renderFrame) {
      // 요약문 실제 높이에 딱 맞춰 높이 설정 (최소 140px)
      const fitHeight = Math.max(e.data.height, 140);
      els.renderFrame.style.height = fitHeight + "px";
    }
  } else if (e.data.type === "RENDERER_READY") {
    updateRenderedView();
  } else if (e.data.type === "PRINT_COMPLETE") {
    setStatus("PDF 인쇄가 완료되었거나 대화상자가 닫혔습니다.");
  } else if (e.data.type === "PRINT_ERROR") {
    setStatus(`PDF 인쇄 오류: ${e.data.error || "알 수 없는 오류"}`);
  }
});

loadTabs();
(async () => {
  settings = await loadSettings();
  if (!settings.consentAccepted) await runOnboarding();
  else setStage("ready");
  await detectEngine();
})();
