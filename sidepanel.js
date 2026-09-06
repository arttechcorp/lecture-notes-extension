const $ = (id) => document.getElementById(id);
const tabSelect = $("tabSelect");
const modeSelect = $("modeSelect");
const startBtn = $("startBtn");
const copyBtn = $("copyBtn");
const downloadBtn = $("downloadBtn");
const notesBtn = $("notesBtn");
const statusEl = $("status");
const resultEl = $("result");
const rawScriptEl = $("rawScript");
const tokenUsageEl = $("tokenUsage");
const debugLogEl = $("debugLog");

const setStatus = (t) => (statusEl.textContent = t);

let running = false; // 생성 중에는 중복 실행을 막는다
let sawProgress = false; // 주입한 스크립트가 실제로 응답했는지 (영상 못 찾음 판정용)

// OCR과 노트가 서로 다른 모델(단가)을 쓰므로 따로 집계한다.
const tokens = { ocr: { input: 0, output: 0 }, notes: { input: 0, output: 0 } };

function renderTokenUsage() {
  const { ocr, notes } = tokens;
  tokenUsageEl.textContent =
    `OCR(haiku) 입력 ${ocr.input.toLocaleString()} · 출력 ${ocr.output.toLocaleString()}\n` +
    `노트(sonnet) 입력 ${notes.input.toLocaleString()} · 출력 ${notes.output.toLocaleString()}`;
}

function resetTokenUsage() {
  tokens.ocr = { input: 0, output: 0 };
  tokens.notes = { input: 0, output: 0 };
  renderTokenUsage();
}

function formatTime(sec) {
  const s = Math.max(0, Math.floor(sec || 0));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function renderRawScript(transcript) {
  rawScriptEl.textContent = (transcript || []).map((e) => `[${formatTime(e.time)}] ${e.text}`).join("\n");
}

// --- 탭 선택 (사이트 하드코딩 없음) -------------------------------------------
// 팝업 창(toolbar=no)으로 뜬 영상도 chrome.tabs.query({})에는 그대로 잡힌다.
async function loadTabs() {
  const { lastOrigin } = await chrome.storage.local.get("lastOrigin");
  const tabs = (await chrome.tabs.query({})).filter((t) => /^https?:/.test(t.url || ""));
  tabs.sort((a, b) => (originOf(b.url) === lastOrigin) - (originOf(a.url) === lastOrigin));
  tabSelect.innerHTML = "";
  for (const t of tabs) {
    const opt = document.createElement("option");
    opt.value = String(t.id);
    opt.textContent = `${new URL(t.url).hostname} — ${(t.title || "").slice(0, 60)}`;
    tabSelect.appendChild(opt);
  }
  if (tabs.length === 0) setStatus("열린 http(s) 탭이 없습니다. 강의 영상을 먼저 여세요.");
}

const originOf = (url) => {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
};

$("refreshTabsBtn").addEventListener("click", loadTabs);
loadTabs();

// --- 메시지 수신 ---------------------------------------------------------------
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "CAPTURE_PROGRESS") {
    sawProgress = true;
    if (msg.stage === "error") failWith(msg.detail);
    else setStatus(msg.detail);
  }
  if (msg.type === "CAPTURE_DONE") onCaptureDone(msg.transcript, msg.title);
  if (msg.type === "TRANSCRIPT_SAVED") {
    if (!running) notesBtn.disabled = false;
  }
  if (msg.type === "DEBUG_LOG") {
    debugLogEl.textContent += `${msg.text}\n`;
    debugLogEl.scrollTop = debugLogEl.scrollHeight;
  }
  if (msg.type === "TOKEN_USAGE") {
    const bucket = tokens[msg.bucket] || tokens.notes;
    bucket.input += msg.input;
    bucket.output += msg.output;
    renderTokenUsage();
  }
});

async function onCaptureDone(transcript, title) {
  if (!transcript || transcript.length === 0) {
    running = false;
    startBtn.disabled = false;
    setStatus("화면에서 텍스트를 하나도 얻지 못했습니다. 슬라이드가 없는 강의일 수 있습니다.");
    return;
  }
  await generateNotes(transcript, title); // 스크립트 저장은 content.js가 배치마다 이미 해둔다
}

async function generateNotes(transcript, title) {
  running = true;
  renderRawScript(transcript);
  setStatus(`스크립트 ${transcript.length}줄 확보. 노트 생성 중...`);
  const res = await chrome.runtime.sendMessage({ type: "GENERATE_NOTES", transcript, title });
  if (res.error) return failWith(res.error);

  resultEl.value = res.text;
  resultEl.readOnly = false;
  running = false;
  setStatus("완료. 자동 생성 노트이니 직접 검토하세요.");
  copyBtn.disabled = false;
  downloadBtn.disabled = false;
  notesBtn.disabled = false;
  startBtn.disabled = false;
  chrome.storage.local.set({ lastNotes: res.text });
}

function failWith(message) {
  running = false;
  setStatus(`오류: ${message}`);
  startBtn.disabled = false;
  chrome.storage.local.get("lastTranscript").then(({ lastTranscript }) => {
    if (lastTranscript && lastTranscript.length) notesBtn.disabled = false;
  });
}

// --- 캡처 시작 -----------------------------------------------------------------
startBtn.addEventListener("click", async () => {
  const tabId = Number(tabSelect.value);
  const tab = tabId ? await chrome.tabs.get(tabId).catch(() => null) : null;
  if (!tab) return failWith("탭을 찾을 수 없습니다. 목록을 새로고침하세요.");
  const origin = originOf(tab.url);

  // 설치 시점에 <all_urls>를 요구하지 않는다 — 실제로 쓰는 사이트만 그때그때 승인받는다.
  // permissions.request는 사용자 클릭 안에서만 동작하므로 이 핸들러에서 바로 부른다.
  const granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
  if (!granted) return failWith(`${origin} 접근 권한이 없어 캡처할 수 없습니다.`);
  chrome.storage.local.set({ lastOrigin: origin });

  running = true;
  sawProgress = false;
  startBtn.disabled = true;
  copyBtn.disabled = true;
  downloadBtn.disabled = true;
  notesBtn.disabled = true;
  resultEl.value = "";
  resultEl.readOnly = true;
  rawScriptEl.textContent = "";
  debugLogEl.textContent = "";
  resetTokenUsage();
  chrome.storage.local.remove("lastNotes");
  setStatus("스크립트 주입 중...");

  try {
    // allFrames: 임베드 플레이어(iframe)에 들어있는 <video>까지 커버한다.
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ["lib/mergeLines.js", "content.js"],
    });
    await chrome.tabs.sendMessage(tabId, { type: "START_CAPTURE", mode: modeSelect.value });
  } catch (e) {
    return failWith(`${e.message} (영상 탭이 맞는지 확인하세요)`);
  }

  // content.js는 응답하지 않는다(영상 없는 프레임까지 응답하면 어느 쪽이 이길지 모름).
  // 진행 메시지가 오는지로 성공을 판단한다.
  setTimeout(() => {
    if (!sawProgress) failWith("이 탭에서 재생 중인 <video>를 찾지 못했습니다. 영상을 재생한 뒤 다시 시도하세요.");
  }, 3000);
});

// --- 재캡처 없이 노트만 다시 (훨씬 저렴) ----------------------------------------
notesBtn.addEventListener("click", async () => {
  const { lastTranscript, lastTitle } = await chrome.storage.local.get(["lastTranscript", "lastTitle"]);
  if (!lastTranscript || !lastTranscript.length) {
    return failWith("저장된 스크립트가 없습니다. 먼저 캡처를 한 번 실행하세요.");
  }
  startBtn.disabled = true;
  notesBtn.disabled = true;
  copyBtn.disabled = true;
  downloadBtn.disabled = true;
  resultEl.value = "";
  resultEl.readOnly = true;
  resetTokenUsage();
  await generateNotes(lastTranscript, lastTitle || "");
});

// --- 결과 내보내기 --------------------------------------------------------------
copyBtn.addEventListener("click", async () => {
  await navigator.clipboard.writeText(resultEl.value);
  copyBtn.textContent = "복사됨";
  setTimeout(() => (copyBtn.textContent = "복사"), 1500);
});

downloadBtn.addEventListener("click", async () => {
  const { lastTitle } = await chrome.storage.local.get("lastTitle");
  const name = (lastTitle || "lecture-notes").replace(/[\\/:*?"<>|]/g, "_").slice(0, 80);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([resultEl.value], { type: "text/markdown" }));
  a.download = `${name}.md`;
  a.click();
  URL.revokeObjectURL(a.href);
});

// --- 패널을 닫았다 열어도 상태 복원 ---------------------------------------------
chrome.storage.local.get(["lastNotes", "lastTranscript"]).then(({ lastNotes, lastTranscript }) => {
  const saved = lastTranscript ? lastTranscript.length : 0;
  if (saved) {
    notesBtn.disabled = false;
    renderRawScript(lastTranscript);
  }
  if (lastNotes) {
    resultEl.value = lastNotes;
    resultEl.readOnly = false;
    copyBtn.disabled = false;
    downloadBtn.disabled = false;
    setStatus("이전 노트를 불러왔습니다.");
  } else if (saved) {
    setStatus(`저장된 스크립트 ${saved}줄이 있습니다. "노트 생성"으로 재캡처 없이 만들 수 있습니다.`);
  }
});
