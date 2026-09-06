// Claude API 호출을 전담하는 service worker. API 키는 옵션 페이지에서 로컬에만 저장한다.

// OCR은 호출 수가 압도적으로 많고 단순 전사라 저렴한 모델로 충분하다.
// 노트 품질을 좌우하는 요약만 상위 모델을 쓴다.
const OCR_MODEL = "claude-haiku-4-5-20251001";
const NOTES_MODEL = "claude-sonnet-5";
const API_URL = "https://api.anthropic.com/v1/messages";
const MAX_SCRIPT_CHARS = 30000; // 한 번에 넣을 수 있는 스크립트 상한

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

async function getApiKey() {
  const { apiKey } = await chrome.storage.local.get("apiKey");
  if (!apiKey) throw new Error("옵션 페이지에서 Claude API 키를 먼저 입력하세요.");
  return apiKey;
}

async function callClaude({ system, messages, maxTokens = 1024, model = NOTES_MODEL }) {
  const apiKey = await getApiKey();
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Claude API 오류 (${res.status}): ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  const usage = data.usage || {};
  chrome.runtime
    .sendMessage({
      type: "TOKEN_USAGE",
      input: usage.input_tokens || 0,
      output: usage.output_tokens || 0,
      bucket: model === OCR_MODEL ? "ocr" : "notes",
    })
    .catch(() => {});
  return data.content.map((b) => b.text || "").join("");
}

function dataUrlToImageBlock(dataUrl) {
  const [meta, base64] = dataUrl.split(",");
  const mediaType = meta.match(/data:(.*);base64/)[1];
  return { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } };
}

async function ocrBatch(frames) {
  const content = frames.map(dataUrlToImageBlock);
  content.push({
    type: "text",
    text:
      `위 ${frames.length}장은 강의 영상 화면을 시간 순서대로 캡처한 이미지입니다. ` +
      `각 이미지에서 보이는 텍스트(슬라이드 제목·본문·판서·자막)를 순서대로 옮겨 적으세요. ` +
      `한 이미지의 여러 줄은 " / "로 이어 붙여 하나의 문자열로 만드세요. ` +
      `읽을 만한 텍스트가 없는 이미지는 빈 문자열로 두세요. ` +
      `오직 JSON 배열(문자열 ${frames.length}개)만 응답하세요. 다른 설명은 절대 포함하지 마세요.`,
  });
  const text = await callClaude({
    system: "너는 강의 영상 프레임에서 화면에 보이는 텍스트만 정확히 옮겨 적는 OCR 도구다. JSON 배열 외의 텍스트는 절대 출력하지 않는다.",
    messages: [{ role: "user", content }],
    maxTokens: 4096,
    model: OCR_MODEL,
  });
  console.log("[강의 필기] OCR 원본 응답 (frames=%d):", frames.length, text);
  try {
    const lines = JSON.parse(text.slice(text.indexOf("["), text.lastIndexOf("]") + 1));
    return { lines: lines.map((l) => String(l ?? "")) };
  } catch {
    return { lines: text.split("\n").filter(Boolean) };
  }
}

function formatTime(sec) {
  const s = Math.max(0, Math.floor(sec || 0));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

async function generateNotes(transcript, title) {
  const full = transcript.map((e) => `[${formatTime(e.time)}] ${e.text}`).join("\n");
  const truncated = full.length > MAX_SCRIPT_CHARS;
  const script = truncated ? full.slice(0, MAX_SCRIPT_CHARS) : full;
  const notice = truncated
    ? `\n\n(주의: 스크립트가 길어 앞부분 ${MAX_SCRIPT_CHARS}자만 전달되었다. 노트 맨 끝에 "이후 구간은 요약에 포함되지 않았습니다"라고 한 줄 적어라.)`
    : "";

  return callClaude({
    system:
      "너는 강의 영상에서 추출한 화면 텍스트로 학습용 노트를 만드는 보조자다. " +
      "스크립트에 실제로 있는 내용만 사용하고, 없는 내용을 지어내거나 일반 상식으로 메우지 않는다. " +
      "출력은 마크다운 본문만. 인사말·설명·메타 코멘트를 덧붙이지 않는다.",
    messages: [
      {
        role: "user",
        content:
          `강의 제목: ${title}\n\n` +
          `아래는 강의 영상 화면을 OCR해 얻은 텍스트다. 각 줄 앞의 [mm:ss]는 영상 내 위치다.\n` +
          `---\n${script}\n---\n\n` +
          `이걸로 학습용 마크다운 노트를 작성해라. 구성:\n` +
          `1. ## 개요 — 이 강의가 무엇을 다뤘는지 3~4줄\n` +
          `2. ## 목차 — \`[mm:ss] 주제\` 형식의 목록\n` +
          `3. ## 핵심 개념 — 등장한 용어와 그 정의 (스크립트에 정의가 없으면 용어만 적고 "정의 미기재"로 표시)\n` +
          `4. ## 섹션별 정리 — 목차 각 항목을 타임스탬프와 함께 요지 정리\n` +
          `5. ## 확인 필요 — OCR 오독으로 보이는 부분, 문맥이 끊긴 구간을 타임스탬프와 함께 나열 (없으면 이 섹션 생략)\n\n` +
          `OCR 결과라 오탈자·중복·조각난 문장이 섞여 있다. 명백한 오독은 문맥으로 보정하되, ` +
          `보정에 확신이 없으면 원문을 그대로 두고 5번 섹션에 적어라.${notice}`,
      },
    ],
    maxTokens: 8000,
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "OCR_BATCH_REQUEST") {
    ocrBatch(msg.frames).then(sendResponse).catch((e) => sendResponse({ error: String(e.message || e) }));
    return true;
  }
  if (msg.type === "GENERATE_NOTES") {
    generateNotes(msg.transcript, msg.title)
      .then((text) => sendResponse({ text }))
      .catch((e) => sendResponse({ error: String(e.message || e) }));
    return true;
  }
});
