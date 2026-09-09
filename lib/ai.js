// AI 제공자 라우팅. 순수 함수(요청 본문 빌더·응답 파서)와 실제 호출을 한 파일에 둔다.
//
// 규정 대응상 가장 중요한 불변식:
//   OCR(이미지)은 기본적으로 온디바이스에서만 돈다. 캡처 이미지가 기기를 벗어나지 않는다.
//   요약은 텍스트만 넘기므로 원격 모델을 써도 "캡처 이미지의 제3자 송신"에 해당하지 않는다.
// 원격 이미지 OCR은 Nano를 못 쓰는 기기를 위한 탈출구이며 명시적 동의 없이는 켜지지 않는다.

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models";

const OCR_INSTRUCTION = (n) =>
  `위 ${n}장은 영상 화면을 시간 순서대로 캡처한 이미지입니다. ` +
  `각 이미지에서 보이는 텍스트(슬라이드 제목·본문·판서·자막)를 순서대로 옮겨 적으세요. ` +
  `한 이미지의 여러 줄은 " / "로 이어 붙여 하나의 문자열로 만드세요. ` +
  `읽을 만한 텍스트가 없는 이미지는 빈 문자열로 두세요. ` +
  `오직 JSON 배열(문자열 ${n}개)만 응답하세요. 다른 설명은 절대 포함하지 마세요.`;

const OCR_SYSTEM =
  "너는 영상 프레임에서 화면에 보이는 텍스트만 정확히 옮겨 적는 OCR 도구다. JSON 배열 외의 텍스트는 절대 출력하지 않는다.";

// --- 순수 함수: 파싱 -----------------------------------------------------------
// 모델이 배열 앞뒤에 설명을 붙이는 경우가 흔해 대괄호 구간만 잘라 파싱한다.
function parseOcrJson(text) {
  try {
    const arr = JSON.parse(text.slice(text.indexOf("["), text.lastIndexOf("]") + 1));
    if (!Array.isArray(arr)) throw new Error("not an array");
    return arr.map((l) => String(l ?? ""));
  } catch {
    return text.split("\n").map((s) => s.trim()).filter(Boolean);
  }
}

function dataUrlParts(dataUrl) {
  const [meta, base64] = dataUrl.split(",");
  return { mediaType: meta.match(/data:(.*);base64/)[1], base64 };
}

// --- 순수 함수: 요청 본문 -------------------------------------------------------
function buildOcrBody(provider, model, frames) {
  const instruction = OCR_INSTRUCTION(frames.length);
  if (provider === "anthropic") {
    const content = frames.map((f) => {
      const { mediaType, base64 } = dataUrlParts(f);
      return { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } };
    });
    content.push({ type: "text", text: instruction });
    return { model, max_tokens: 4096, system: OCR_SYSTEM, messages: [{ role: "user", content }] };
  }
  if (provider === "gemini") {
    const parts = frames.map((f) => {
      const { mediaType, base64 } = dataUrlParts(f);
      return { inline_data: { mime_type: mediaType, data: base64 } };
    });
    parts.push({ text: instruction });
    return {
      contents: [{ role: "user", parts }],
      systemInstruction: { parts: [{ text: OCR_SYSTEM }] },
      generationConfig: { maxOutputTokens: 4096 },
    };
  }
  throw new Error(`알 수 없는 제공자: ${provider}`);
}

function buildSummaryBody(provider, model, system, prompt) {
  if (provider === "anthropic") {
    return { model, max_tokens: 8000, system, messages: [{ role: "user", content: prompt }] };
  }
  if (provider === "gemini") {
    return {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      systemInstruction: { parts: [{ text: system }] },
      generationConfig: { maxOutputTokens: 8000 },
    };
  }
  throw new Error(`알 수 없는 제공자: ${provider}`);
}

function parseProviderResponse(provider, data) {
  if (provider === "anthropic") {
    return {
      text: (data.content || []).map((b) => b.text || "").join(""),
      input: (data.usage || {}).input_tokens || 0,
      output: (data.usage || {}).output_tokens || 0,
    };
  }
  if (provider === "gemini") {
    const parts = ((data.candidates || [])[0] || {}).content || {};
    const u = data.usageMetadata || {};
    return {
      text: (parts.parts || []).map((p) => p.text || "").join(""),
      input: u.promptTokenCount || 0,
      output: u.candidatesTokenCount || 0,
    };
  }
  throw new Error(`알 수 없는 제공자: ${provider}`);
}

// --- 원격 호출 -----------------------------------------------------------------
async function callRemote(provider, model, apiKey, body, retries = 2) {
  if (!apiKey) throw new Error("API 키가 없습니다. 설정에서 먼저 입력하세요.");
  const url = provider === "anthropic" ? ANTHROPIC_URL : `${GEMINI_URL}/${model}:generateContent`;
  const headers =
    provider === "anthropic"
      ? {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        }
      : { "content-type": "application/json", "x-goog-api-key": apiKey };

  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
    if (!res.ok) {
      if ((res.status === 503 || res.status === 429) && attempt <= retries) {
        // 일시적인 트래픽 폭주/제한인 경우 지수 백오프로 재시도
        await new Promise(r => setTimeout(r, 2000 * attempt));
        continue;
      }
      const text = await res.text().catch(() => "");
      throw new Error(`${provider} API 오류 (${res.status}): ${text.slice(0, 300)}`);
    }
    return parseProviderResponse(provider, await res.json());
  }
}

// --- 온디바이스 OCR: Tesseract.js ------------------------------------------------
// Chrome 내장 Nano의 고사양(RAM 16GB, 디스크 22GB) 제약을 탈피하여,
// 100% 로컬에서 동작하는 경량 Tesseract.js를 기본 온디바이스 OCR로 사용합니다.


// --- 온디바이스 요약: 분할 후 합치기 -------------------------------------------------
// Nano의 컨텍스트는 원격 모델보다 두 자릿수 작다. 스크립트를 통째로 넣으면
// "The input is too large."로 끝난다 — 자막과 음성이 둘 다 잡히는 영상이면
// 텍스트가 두 배로 불어나므로 더 쉽게 걸린다.
//
// 잘라 버리는 대신 구간별로 요약한 뒤 그 요약들을 다시 요약한다(map-reduce).
// 강의가 아무리 길어도 들어간다.

// 줄 경계에서 자른다. 한 줄이 통째로 한도를 넘으면 그 줄만 잘라 넣는다.
function splitScript(text, maxChars) {
  const out = [];
  let cur = "";
  for (const line of String(text).split("\n")) {
    if (line.length > maxChars) {
      if (cur) { out.push(cur); cur = ""; }
      for (let i = 0; i < line.length; i += maxChars) out.push(line.slice(i, i + maxChars));
      continue;
    }
    if (cur && cur.length + 1 + line.length > maxChars) { out.push(cur); cur = ""; }
    cur = cur ? cur + "\n" + line : line;
  }
  if (cur) out.push(cur);
  return out;
}

// 하위 호환용 스텁 (더 이상 Nano Prompt API를 쓰지 않음)
async function localAvailability() {
  return "unavailable";
}

// --- 온디바이스 OCR: Tesseract ----------------------------------------------------
// 요건 없이 100% 기기 안에서 도는 경량 OCR 엔진.
let tessWorker = null;

async function createTesseractWorker(onProgress) {
  if (tessWorker) return tessWorker;
  if (typeof Tesseract === "undefined") {
    throw new Error("Tesseract 라이브러리를 불러오지 못했습니다 — lib/vendor/tesseract/ 가 빠졌는지 확인하세요.");
  }
  const dir = chrome.runtime.getURL("lib/vendor/tesseract/");
  tessWorker = await Tesseract.createWorker("kor+eng", 1, {
    workerPath: dir + "worker.min.js",
    corePath: dir + "tesseract-core-simd-lstm.wasm.js",
    langPath: dir,
    workerBlobURL: false,
    logger: (m) => onProgress && onProgress(m),
  });
  return tessWorker;
}

async function ocrTesseract(worker, frames, onEach) {
  const lines = [];
  for (let i = 0; i < frames.length; i++) {
    let text = "";
    try {
      const res = await worker.recognize(frames[i]);
      text = (res.data.text || "")
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .join(" / ");
    } catch (e) {
      console.warn("[강의 필기] Tesseract OCR 실패:", e);
    }
    lines.push(text);
    if (onEach) onEach(i + 1, frames.length);
  }
  return lines;
}

if (typeof module !== "undefined") {
  module.exports = { parseOcrJson, buildOcrBody, buildSummaryBody, parseProviderResponse, dataUrlParts, splitScript };
}
