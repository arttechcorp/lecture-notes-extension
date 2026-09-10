// 사이드패널이 모든 상태와 모든 AI 호출을 소유한다.
//
// 무저장 불변식: 강의 유래 데이터(프레임·인식 텍스트·노트)는 아래 변수들에만 존재하고
// chrome.storage에 절대 들어가지 않는다. 패널이 닫히면 이 페이지와 함께 사라진다.
const $ = (id) => document.getElementById(id);
const els = {
  tabSelect: $("tabSelect"), modeSelect: $("modeSelect"), langSelect: $("langSelect"), startBtn: $("startBtn"), stopBtn: $("stopBtn"),
  copyBtn: $("copyBtn"), downloadBtn: $("downloadBtn"), notesBtn: $("notesBtn"), previewBtn: $("previewBtn"),
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
  settingsLink: $("settingsLink"), ocrEnabledToggle: $("ocrEnabledToggle"), cropField: $("cropField"),
  // 진행
  elapsed: $("elapsed"), cntSlides: $("cntSlides"), cntVoice: $("cntVoice"), cntQueue: $("cntQueue"),
  feedLines: $("feedLines"), panelAlert: $("panelAlert"),
  // 완료
  doneSummary: $("doneSummary"), donePill: $("donePill"), againBtn: $("againBtn"), summarySettingsBtn: $("summarySettingsBtn"),
  resultTitle: $("resultTitle"), resultHint: $("resultHint"), timelineBtn: $("timelineBtn"), resumeBtn: $("resumeBtn"),
  // 하단
  planName: $("planName"), planUse: $("planUse"),
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
let cropRect = null; // 0~1 정규화
let settings = null;
let engine = "local"; // "local" | "remote" | "none"
let lastVideoTime = 0; // content.js가 알려주는 영상 재생 위치(초)
// 에러가 뜬 뒤에는 상태줄을 잠근다. content.js가 5초마다 보내는 진행 메시지가
// 같은 자리에 덮어써서, 에러가 5초만 보이고 흔적 없이 사라지던 문제를 막는다.
let statusSticky = false;
let resultViews = { kind: "timeline", timeline: "", summary: "" };

const tokens = { ocr: { input: 0, output: 0 }, notes: { input: 0, output: 0 } };

// OCR 대기 배치 상한. slide 모드 기준 배치당 8장이니 최대 32장(약 5MB)까지만 쥔다.
const MAX_QUEUE_BATCHES = 4;

const setStatus = (t) => (els.status.textContent = t);
// 로그는 2시간짜리 강의면 수천 줄까지 자란다. 오래된 건 진단에 쓸모가 없다.
const LOG_MAX_LINES = 500;
const log = (t) => {
  const lines = (els.debugLog.textContent + t + "\n").split("\n");
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
  els.cntQueue.textContent = queue.length;

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
    els.elapsed.textContent = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  };
  tick();
  clearInterval(elapsedTimer);
  elapsedTimer = setInterval(tick, 1000);
}
function stopElapsed() { clearInterval(elapsedTimer); elapsedTimer = null; }

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
  els.outputFormat.value = settings.outputFormat || "summary";
  els.customPrompt.style.display = els.outputFormat.value === "custom" ? "block" : "none";
  if (els.ocrEnabledToggle) {
    els.ocrEnabledToggle.checked = settings.ocrEnabled !== false;
  }
  if (els.cropField) {
    els.cropField.hidden = settings.ocrEnabled === false;
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
  } else {
    engine = "tesseract";
    setRow(els.markEngine, "ok", els.banner, "로컬 · 무료");
    detail = "슬라이드 글자가 선명하고 크게 보일수록 더 정확하게 읽을 수 있어요.";
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
const FORMAT_LABEL = { timeline: "원문 타임라인 · 무료", summary: "핵심 요약본", custom: "직접 입력" };

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
  if (settings.apiKey) {
    els.planName.textContent = "내 API 키 · " + (PROVIDER_LABEL[settings.provider] || settings.provider);
    els.planUse.textContent = "원격 요약";
  } else {
    els.planName.textContent = "Free · 무료";
    els.planUse.textContent = "키 없이 원문 타임라인";
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
async function prepareTesseract() {
  if (engine !== "tesseract" || tessReady) return;
  setStatus("Tesseract OCR 준비 중... 처음이면 언어 데이터를 읽는 데 잠시 걸립니다.");
  log("Tesseract 워커 생성 시도");
  await createTesseractWorker((m) => {
    if (m && m.status) setStatus(`Tesseract ${m.status}${m.progress ? ` ${Math.round(m.progress * 100)}%` : ""}`);
  });
  tessReady = true;
  log("Tesseract 준비 완료");
}

// --- OCR 큐 ----------------------------------------------------------------------
const ocrModelFor = (p) => (p === "gemini" ? "gemini-flash-latest" : "claude-haiku-4-5-20251001");

async function drainQueue() {
  if (draining) return;
  draining = true;
  try {
    while (queue.length) {
      const { frames, times } = queue.shift();
      setStatus(`OCR 처리 중 (${frames.length}장, 대기 ${queue.length}배치)`);
      let lines;
      if (engine === "remote") {
        const model = ocrModelFor(settings.provider);
        const res = await callRemote(settings.provider, model, settings.apiKey, buildOcrBody(settings.provider, model, frames));
        tokens.ocr.input += res.input;
        tokens.ocr.output += res.output;
        lines = parseOcrJson(res.text);
      } else {
        await prepareTesseract();
        lines = await ocrTesseract(await createTesseractWorker(), frames, (i, n) => setStatus(`Tesseract OCR ${i}/${n}`));
      }
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
  "너는 영상 화면에서 인식한 텍스트로 학습 노트를 만드는 보조자다. " +
  "주어진 텍스트에 실제로 있는 내용만 사용하고 없는 내용을 지어내지 않는다. " +
  "출력은 마크다운 본문만. 인사말·설명·메타 코멘트를 덧붙이지 않는다.";

function buildNotesPrompt(script, truncated) {
  const format = els.outputFormat.value;
  const custom = els.customPrompt.value.trim();
  
  let instruction = "";
  if (format === "summary") {
    instruction = "이 스크립트를 바탕으로 강의 내용을 잘 구조화된 핵심 요약본으로 작성해라.";
  } else if (format === "custom") {
    instruction = `다음 조건을 반드시 지켜서 작성해라:\n조건: ${custom || '내용 요약'}`;
  }

  return (
    `영상 제목: ${title}\n\n` +
    `아래는 영상 화면과 음성 인식을 통해 얻은 텍스트다. 각 줄 앞의 [mm:ss]는 영상 내 위치다.\n` +
    `${instruction}\n\n[캡처 스크립트]\n${script}\n\n` +
    `화면 인식(OCR)과 음성 인식 결과라 오탈자나 조각난 문장이 섞여 있다. 명백한 오독은 문맥으로 보정해라.` +
    (truncated ? `\n\n(스크립트가 길어 앞부분 ${MAX_SCRIPT_CHARS}자만 전달됐다. 글 끝에 "이후 구간은 분량 제한으로 포함되지 않았습니다"라고 적어라.)` : "")
  );
}

// 온디바이스 모델은 컨텍스트가 작아 스크립트를 통째로 못 받는다("The input is too large").
// 잘라 버리는 대신 구간별로 요약한 뒤 그 요약들을 다시 요약한다. 세션은 매번 새로 뜬다.
async function notesLocal(full, onProgress) {
  const s = await createLocalSession(undefined, {}); // 텍스트만 — 이미지 능력 불필요
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
    if (s.destroy) s.destroy();
  }
}

// 원격 호출 한 번. 프롬프트를 만드는 쪽에서 무엇을 담을지 이미 정해져 있다.
async function notesRemote(prompt) {
  const body = buildSummaryBody(
    settings.provider,
    settings.summaryModel,
    "너는 훌륭한 학습 보조 AI다. 사용자의 지시를 철저히 따른다.",
    prompt
  );
  const res = await callRemote(settings.provider, settings.summaryModel, settings.apiKey, body);
  tokens.notes.input += res.input;
  tokens.notes.output += res.output;
  return res.text;
}

// 무료 노트는 원문을 시간순으로만 정리한다. 원문을 축약하거나 API로 보내지 않는다.
function buildTimeline() {
  const entries = [...transcript].sort((a, b) => a.time - b.time);
  const subtitle = (settings && settings.ocrEnabled === false)
    ? "원문 타임라인 · 음성 인식 결과\n"
    : "원문 타임라인 · 화면 및 음성 인식 결과\n";
  return `# ${title || "강의 노트"}\n\n` +
    subtitle +
    `인식 오류가 포함될 수 있습니다. 강의와 대조하며 검토해 주세요.\n\n` +
    entries.map((entry) => `## ${formatTime(entry.time)} · ${entry.text.startsWith("[음성]") ? "음성" : "화면"}\n\n${entry.text.replace(/^\[음성\]\s*/, "")}\n`).join("\n");
}

function showNote(text, kind = "summary") {
  if (els.result.value) resultViews[resultViews.kind] = els.result.value;
  resultViews[kind] = text;
  resultViews.kind = kind;
  els.result.value = text;
  els.result.readOnly = false;
  els.copyBtn.disabled = false;
  els.downloadBtn.disabled = false;
  els.donePill.textContent = kind === "timeline" ? "원문 타임라인" : "노트 완성";
  els.resultTitle.textContent = title || "나의 강의 노트";
  els.resultHint.textContent = kind === "timeline"
    ? "Free · 인식된 원문을 시간순으로 담았어요. 직접 수정할 수 있습니다. 패널을 닫기 전 복사하거나 저장하세요."
    : "자동 생성된 초안입니다. 강의와 대조해 검토하고 수정하세요. 패널을 닫기 전 복사하거나 저장하세요.";
  const voice = transcript.filter((entry) => entry.text.startsWith("[음성]")).length;
  const slides = transcript.length - voice;
  els.doneSummary.textContent = (settings && settings.ocrEnabled === false)
    ? `음성 ${voice}줄 (화면 캡처 꺼짐)`
    : `화면 ${slides}개 · 음성 ${voice}줄`;
  els.resumeBtn.hidden = false;
  els.timelineBtn.hidden = kind === "timeline" && !resultViews.summary;
  els.timelineBtn.textContent = kind === "timeline" ? "요약 노트로 돌아가기" : "원문 타임라인 보기";
  setStage("done");
}

async function generateNotes() {
  if (busy || capturing || draining || queue.length) return;
  if (!transcript.length) return fail("인식된 텍스트가 없습니다. 먼저 캡처를 실행하세요.");
  busy = true;
  statusSticky = false;
  els.panelAlert.hidden = true;
  setStage("done");
  els.donePill.textContent = "노트 생성 중";
  els.againBtn.disabled = true;
  els.notesBtn.disabled = true;
  els.timelineBtn.disabled = true;
  els.formatToggle.disabled = true;
  els.outputFormat.disabled = true;
  els.customPrompt.disabled = true;
  setStatus(`텍스트 ${transcript.length}줄로 결과물 생성 중...`);
  try {
    settings = await loadSettings();
    renderPlan();
    if (!settings.apiKey || els.outputFormat.value === "timeline") {
      showNote(buildTimeline(), "timeline");
      setStatus(els.outputFormat.value === "timeline"
        ? "원문 타임라인이 준비됐어요. API를 사용하지 않았습니다."
        : "API 키 없이 원문 타임라인을 만들었어요. AI 요약은 아래에서 선택해 연결할 수 있습니다.");
      return;
    }

    const full = transcript.map((e) => `[${formatTime(e.time)}] ${e.text}`).join("\n");
    const truncated = full.length > MAX_SCRIPT_CHARS;
    const prompt = buildNotesPrompt(truncated ? full.slice(0, MAX_SCRIPT_CHARS) : full, truncated);

    setStatus("노트를 만드는 중...");
    const text = await notesRemote(prompt);

    if (!text.trim()) throw new Error("AI가 빈 결과를 반환했습니다. 원문 타임라인을 확인하거나 다시 만들어 주세요.");
    showNote(text);
    setStatus("완료. 자동 생성된 결과물입니다. 직접 내용을 검토하세요. 패널을 닫으면 사라집니다.");
    renderTokens();
  } catch (e) {
    if (!els.result.value) showNote(buildTimeline(), "timeline");
    return fail(String(e.message || e));
  } finally {
    busy = false;
    els.againBtn.disabled = false;
    els.notesBtn.disabled = !transcript.length;
    els.timelineBtn.disabled = !transcript.length;
    els.formatToggle.disabled = false;
    els.outputFormat.disabled = false;
    els.customPrompt.disabled = false;
    els.startBtn.disabled = false;
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
  // 남은 OCR 배치를 다 처리한 뒤에 노트를 만든다.
  setStatus("캡처를 마쳤어요. 남은 인식 내용을 정리하고 있습니다...");
  finishTimer = setInterval(() => {
    if (draining || queue.length) return;
    clearInterval(finishTimer);
    finishTimer = null;
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
  if (!capturing) return;
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
    engine = ocrWanted ? (settings.allowRemoteOcr && settings.apiKey ? "remote" : "tesseract") : "none";
    if (ocrWanted) {
      await prepareTesseract();
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
  resultViews = { kind: "timeline", timeline: "", summary: "" };
  els.resumeBtn.hidden = true;
  els.result.readOnly = true;
  els.rawScript.textContent = "";
  els.debugLog.textContent = "";
  els.copyBtn.disabled = true;
  els.downloadBtn.disabled = true;
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
  audioCapturer.stopCapture();
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
els.timelineBtn.addEventListener("click", () => {
  if (busy || capturing || draining || !transcript.length) return;
  const kind = resultViews.kind === "timeline" && resultViews.summary ? "summary" : "timeline";
  showNote(resultViews[kind] || buildTimeline(), kind);
  setStatus(kind === "timeline" ? "인식된 원문입니다. AI를 다시 호출하지 않았습니다." : "이전에 만든 요약 노트로 돌아왔어요.");
});

// 캡처·생성 도중 패널을 닫으면 전부 사라진다는 걸 미리 알린다.
window.addEventListener("beforeunload", (e) => {
  if (capturing || busy || transcript.length) {
    e.preventDefault();
    e.returnValue = "";
  }
});

// --- 결과 내보내기 (사용자가 직접 저장하는 것만 허용) --------------------------------
els.copyBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(els.result.value);
    els.copyBtn.textContent = "복사됨 ✓";
    setTimeout(() => (els.copyBtn.textContent = "복사"), 1500);
  } catch {
    setStatus("자동 복사를 완료하지 못했어요. 노트 내용을 선택해 직접 복사해 주세요.");
    els.result.focus();
    els.result.select();
  }
});

els.downloadBtn.addEventListener("click", () => {
  const name = (title || "notes").replace(/[\\/:*?"<>|]/g, "_").slice(0, 80);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([els.result.value], { type: "text/markdown" }));
  a.download = `${name}.md`;
  a.click();
  URL.revokeObjectURL(a.href);
});

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

loadTabs();
(async () => {
  settings = await loadSettings();
  if (!settings.consentAccepted) await runOnboarding();
  else setStage("ready");
  await detectEngine();
})();
