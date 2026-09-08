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
};

els.outputFormat.addEventListener("change", () => {
  els.customPrompt.style.display = els.outputFormat.value === "custom" ? "block" : "none";
});

// --- 세션 상태 (메모리 전용) -----------------------------------------------------
let transcript = []; // [{ time, text }]
let title = "";
let port = null;
let capturing = false;
let busy = false; // 노트 생성 중 중복 실행 방지
let queue = []; // OCR 대기 중인 프레임 배치
let draining = false;
let localSession = null;
let cropRect = null; // 0~1 정규화
let settings = null;
let engine = "local"; // "local" | "remote" | "none"
let lastVideoTime = 0; // content.js가 알려주는 영상 재생 위치(초)

const tokens = { ocr: { input: 0, output: 0 }, notes: { input: 0, output: 0 } };

const setStatus = (t) => (els.status.textContent = t);
const log = (t) => {
  els.debugLog.textContent += `${t}\n`;
  els.debugLog.scrollTop = els.debugLog.scrollHeight;
};

function renderTokens() {
  const ocrLabel = engine === "local" ? "OCR(온디바이스, 무료)" : "OCR(원격)";
  els.tokenUsage.textContent =
    `${ocrLabel} 입력 ${tokens.ocr.input.toLocaleString()} · 출력 ${tokens.ocr.output.toLocaleString()}\n` +
    `노트 입력 ${tokens.notes.input.toLocaleString()} · 출력 ${tokens.notes.output.toLocaleString()}`;
}

function renderRaw() {
  els.rawScript.textContent = transcript.map((e) => `[${formatTime(e.time)}] ${e.text}`).join("\n");
}

// --- 엔진 판정 -------------------------------------------------------------------
async function detectEngine() {
  settings = await loadSettings();
  els.langSelect.value = settings.whisperLang;
  const status = await localAvailability();
  if (status === "available") {
    engine = "local";
    els.banner.className = "banner ok";
    els.banner.textContent = "온디바이스 OCR 사용 가능 — 화면 이미지가 기기를 벗어나지 않습니다.";
  } else if (status === "downloadable" || status === "downloading") {
    engine = "local";
    els.banner.className = "banner warn";
    els.banner.textContent = "온디바이스 모델을 아직 내려받지 않았습니다. 첫 캡처 때 자동으로 내려받습니다(수 분 소요).";
  } else if (settings.allowRemoteOcr && settings.apiKey) {
    engine = "remote";
    els.banner.className = "banner warn";
    els.banner.textContent = "온디바이스 OCR 불가 → 원격 OCR로 동작합니다. 캡처 이미지가 외부 제공자로 전송됩니다.";
  } else {
    engine = "none";
    els.banner.className = "banner warn";
    els.banner.textContent = "이 기기에서는 온디바이스 OCR을 쓸 수 없습니다. 설정에서 상태를 확인하세요.";
  }
  renderTokens();
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
  const tabs = (await chrome.tabs.query({})).filter((t) => /^https?:/.test(t.url || ""));
  tabs.sort((a, b) => (originOf(b.url) === lastOrigin) - (originOf(a.url) === lastOrigin));
  els.tabSelect.innerHTML = "";
  for (const t of tabs) {
    const opt = document.createElement("option");
    opt.value = String(t.id);
    opt.textContent = `${new URL(t.url).hostname} — ${(t.title || "").slice(0, 60)}`;
    els.tabSelect.appendChild(opt);
  }
  if (!tabs.length) setStatus("열린 http(s) 탭이 없습니다. 영상을 먼저 여세요.");
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
  port = chrome.tabs.connect(tabId, { name: "capture" });
  port.onMessage.addListener(onPortMessage);
  port.onDisconnect.addListener(() => (port = null));
  return port;
}

function onPortMessage(msg) {
  if (msg.type === "progress") {
    if (msg.stage === "error") return fail(msg.detail);
    setStatus(`${msg.detail}${queue.length ? ` · OCR 대기 ${queue.length}배치` : ""}`);
  }
  if (msg.type === "tick") lastVideoTime = msg.t;
  if (msg.type === "audio") audioCapturer.pushAudio(msg);
  if (msg.type === "silence") log(`[음성] ${Math.round(msg.t)}초 구간 무음 — 건너뜀 (RMS ${msg.rms.toFixed(5)})`);
  if (msg.type === "log") log(msg.text);
  if (msg.type === "preview") showPreview(msg.dataUrl);
  if (msg.type === "frames") {
    queue.push({ frames: msg.frames, times: msg.times });
    drainQueue();
  }
  if (msg.type === "done") {
    capturing = false;
    title = msg.title || "";
    finishCapture();
  }
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
      if (engine === "local") {
        if (!localSession) {
          setStatus("온디바이스 모델 준비 중... 처음이면 다운로드에 수 분 걸립니다.");
          localSession = await createLocalSession((p) => setStatus(`모델 다운로드 ${Math.round(p * 100)}%`));
        }
        lines = await ocrLocal(localSession, frames, (i, n) => setStatus(`온디바이스 OCR ${i}/${n}`));
      } else if (engine === "remote") {
        const model = ocrModelFor(settings.provider);
        const res = await callRemote(settings.provider, model, settings.apiKey, buildOcrBody(settings.provider, model, frames));
        tokens.ocr.input += res.input;
        tokens.ocr.output += res.output;
        lines = parseOcrJson(res.text);
      } else {
        throw new Error("사용 가능한 OCR 엔진이 없습니다.");
      }
      transcript = mergeLines(zipEntries(lines, times), transcript);
      renderRaw();
      renderTokens();
      if (transcript.length && !busy) els.notesBtn.disabled = false;
    }
  } catch (e) {
    // 온디바이스 세션이 죽었을 수 있다. 참조를 버려서 다음 시도가 새로 만들게 한다.
    localSession = null;
    fail(String(e.message || e));
  } finally {
    draining = false;
  }
}

// --- 노트 생성 (텍스트만 전송) -------------------------------------------------------
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

async function generateNotes() {
  if (!transcript.length) return fail("인식된 텍스트가 없습니다. 먼저 캡처를 실행하세요.");
  busy = true;
  els.notesBtn.disabled = true;
  setStatus(`텍스트 ${transcript.length}줄로 결과물 생성 중...`);
  try {
    const full = transcript.map((e) => `[${formatTime(e.time)}] ${e.text}`).join("\n");
    const truncated = full.length > MAX_SCRIPT_CHARS;
    const prompt = buildNotesPrompt(truncated ? full.slice(0, MAX_SCRIPT_CHARS) : full, truncated);

    settings = await loadSettings();
    let text;
    if (settings.apiKey) {
      try {
        const body = buildSummaryBody(settings.provider, settings.summaryModel, "너는 훌륭한 학습 보조 AI다. 사용자의 지시를 철저히 따른다.", prompt);
        const res = await callRemote(settings.provider, settings.summaryModel, settings.apiKey, body);
        tokens.notes.input += res.input;
        tokens.notes.output += res.output;
        text = res.text;
      } catch (e) {
        if (e.message.includes("503") || e.message.includes("UNAVAILABLE") || e.message.includes("429")) {
          setStatus("API 서버가 혼잡하여(503/429) 로컬 AI로 전환하여 요약을 시도합니다...");
          const s = await createLocalSession();
          text = await s.prompt(prompt);
          if (s.destroy) s.destroy();
        } else {
          throw e;
        }
      }
    } else {
      setStatus("API 키가 없어 온디바이스 모델로 생성합니다 (품질이 낮을 수 있습니다).");
      const s = await createLocalSession();
      text = await s.prompt(prompt);
      if (s.destroy) s.destroy();
    }
    els.result.value = text;
    els.result.readOnly = false;
    els.copyBtn.disabled = false;
    els.downloadBtn.disabled = false;
    setStatus("완료. 자동 생성된 결과물입니다. 직접 내용을 검토하세요. 패널을 닫으면 사라집니다.");
    renderTokens();
  } catch (e) {
    return fail(String(e.message || e));
  } finally {
    busy = false;
    els.notesBtn.disabled = !transcript.length;
    els.startBtn.disabled = false;
  }
}

function finishCapture() {
  els.stopBtn.disabled = true;
  els.startBtn.disabled = false;
  if (!transcript.length && !queue.length && !draining) {
    return setStatus("화면에서 텍스트를 얻지 못했습니다. 슬라이드가 없는 영상일 수 있습니다.");
  }
  // 남은 OCR 배치를 다 처리한 뒤에 노트를 만든다.
  const wait = setInterval(() => {
    if (draining || queue.length) return;
    clearInterval(wait);
    generateNotes();
  }, 500);
}

function fail(message) {
  busy = false;
  capturing = false;
  setStatus(`오류: ${message}`);
  els.startBtn.disabled = false;
  els.stopBtn.disabled = true;
  els.notesBtn.disabled = !transcript.length;
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
  audioCapturer.language = els.langSelect.value; // 캡처 도중 바꿔도 다음 청크부터 반영된다
  saveSettings({ whisperLang: els.langSelect.value });
});

els.modeSelect.addEventListener("change", () => {
  const isRegion = els.modeSelect.value === "region";
  els.cropRow.style.display = isRegion ? "flex" : "none";
  if (!isRegion) els.cropWrap.style.display = "none";
});
els.modeSelect.dispatchEvent(new Event("change"));

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
  if (engine === "none") {
    return fail("사용 가능한 OCR 엔진이 없습니다. 설정에서 온디바이스 모델 상태를 확인하세요.");
  }
  if (els.modeSelect.value === "region" && !cropRect) {
    return fail("영역을 먼저 지정하거나 캡처 영역을 '전체 화면'으로 바꾸세요.");
  }
  
  settings = await loadSettings();
  if (settings.whisperEnabled) {
    setStatus("음성 인식(Whisper) 모델 준비 중...");
    try {
      audioCapturer.language = els.langSelect.value;
      await audioCapturer.initModel((prog) => {
        if (prog.status === 'progress') {
          setStatus(`음성 모델 다운로드 중... ${Math.round(prog.progress)}%`);
        }
      });
    } catch(e) {
      log("Whisper 초기화 실패: " + e.message);
    }
  }

  transcript = [];
  queue = [];
  tokens.ocr = { input: 0, output: 0 };
  tokens.notes = { input: 0, output: 0 };
  els.result.value = "";
  els.result.readOnly = true;
  els.rawScript.textContent = "";
  els.debugLog.textContent = "";
  els.copyBtn.disabled = true;
  els.downloadBtn.disabled = true;
  els.notesBtn.disabled = true;
  els.startBtn.disabled = true;
  renderTokens();
  setStatus("스크립트 주입 중...");
  try {
    // 오디오도 같은 포트로 온다 — content script가 <video>에서 직접 딴다.
    (await connectToTab()).postMessage({
      type: "START",
      mode: els.modeSelect.value,
      rect: cropRect,
      audio: settings.whisperEnabled,
    });
    if (!settings.whisperEnabled) {
      log("음성 인식이 꺼져 있습니다 (설정에서 켤 수 있습니다). 화면 OCR만 동작합니다.");
    }
    capturing = true;
    els.stopBtn.disabled = false;
  } catch (e) {
    return fail(String(e.message || e));
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
  capturing = false;
  audioCapturer.stopCapture();
  if (port) port.disconnect();
  port = null;
  finishCapture();
});

els.notesBtn.addEventListener("click", generateNotes);

// 캡처·생성 도중 패널을 닫으면 전부 사라진다는 걸 미리 알린다.
window.addEventListener("beforeunload", (e) => {
  if (capturing || busy || transcript.length) {
    e.preventDefault();
    e.returnValue = "";
  }
});

// --- 결과 내보내기 (사용자가 직접 저장하는 것만 허용) --------------------------------
els.copyBtn.addEventListener("click", async () => {
  await navigator.clipboard.writeText(els.result.value);
  els.copyBtn.textContent = "복사됨";
  setTimeout(() => (els.copyBtn.textContent = "복사"), 1500);
});

els.downloadBtn.addEventListener("click", () => {
  const name = (title || "notes").replace(/[\\/:*?"<>|]/g, "_").slice(0, 80);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([els.result.value], { type: "text/markdown" }));
  a.download = `${name}.md`;
  a.click();
  URL.revokeObjectURL(a.href);
});

$("refreshTabsBtn").addEventListener("click", loadTabs);
$("optionsLink").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

loadTabs();
detectEngine();
