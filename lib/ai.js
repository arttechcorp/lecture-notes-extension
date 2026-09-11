// AI 제공자 라우팅. 순수 함수(요청 본문 빌더·응답 파서)와 실제 호출을 한 파일에 둔다.
//
// 규정 대응상 가장 중요한 불변식:
//   OCR(이미지)은 기본적으로 온디바이스에서만 돈다. 캡처 이미지가 기기를 벗어나지 않는다.
//   요약은 텍스트만 넘기므로 원격 모델을 써도 "캡처 이미지의 제3자 송신"에 해당하지 않는다.
// 원격 이미지 OCR은 Nano/Tesseract를 못 쓰는 환경을 위한 탈출구이며 명시적 동의 없이는 켜지지 않는다.

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
        await new Promise(r => setTimeout(r, 2000 * attempt));
        continue;
      }
      const text = await res.text().catch(() => "");
      throw new Error(`${provider} API 오류 (${res.status}): ${text.slice(0, 300)}`);
    }
    return parseProviderResponse(provider, await res.json());
  }
}

// --- 온디바이스 (Chrome Prompt API: Gemini Nano) --------------------------------
const LOCAL_OPTS = { expectedInputs: [{ type: "image" }] };

async function localAvailability(opts = LOCAL_OPTS) {
  if (typeof LanguageModel === "undefined") return "unavailable";
  try {
    return await LanguageModel.availability(opts);
  } catch {
    return "unavailable";
  }
}

async function createLocalSession(onProgress, opts = LOCAL_OPTS) {
  if (typeof LanguageModel === "undefined") throw new Error("Chrome 내장 AI(LanguageModel)를 지원하지 않는 브라우저입니다.");
  return LanguageModel.create({
    ...opts,
    monitor(m) {
      m.addEventListener("downloadprogress", (e) => onProgress && onProgress(e.loaded));
    },
  });
}

function localFailureHint(err) {
  const msg = String(err && err.message ? err.message : err);
  if (/crashed too many times/i.test(msg)) {
    return (
      "크롬 온디바이스 모델(Nano)이 반복 크래시로 이 크롬 버전에서 차단됐습니다. " +
      "chrome://on-device-internals 에서 상태를 확인하거나 크롬을 재시작하세요. " +
      "그동안은 Tesseract로 전환하면 계속 쓸 수 있습니다. (원문: " + msg + ")"
    );
  }
  return "온디바이스 OCR이 연속 실패했습니다: " + msg;
}

const LOCAL_FRAME_TIMEOUT_MS = 15000;

function withTimeout(promise, ms, errMsg = "시간 초과") {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(errMsg)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Nano는 contextWindow가 작아 여러 장을 한 번에 못 넣는다. 한 장씩 순차 처리한다.
async function ocrLocal(session, frames, onEach, frameTimeoutMs = LOCAL_FRAME_TIMEOUT_MS) {
  const lines = [];
  let consecutiveFail = 0;
  let lastError = null;
  for (let i = 0; i < frames.length; i++) {
    const bitmap = await createImageBitmap(await (await fetch(frames[i])).blob());
    let s = null;
    let text = "";
    const abortCtrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    try {
      s = session.clone ? await withTimeout(session.clone(), 5000, "세션 복제 시간 초과") : session;
      const promptPromise = s.prompt(
        [
          {
            role: "user",
            content: [
              { type: "image", value: bitmap },
              {
                type: "text",
                value:
                  "이 이미지에 보이는 텍스트를 그대로 옮겨 적어라. 여러 줄이면 \" / \"로 이어 붙여라. " +
                  "읽을 만한 텍스트가 없으면 아무것도 출력하지 마라. 설명·추측을 덧붙이지 마라.",
              },
            ],
          },
        ],
        abortCtrl ? { signal: abortCtrl.signal } : undefined
      );
      text = await withTimeout(
        promptPromise,
        frameTimeoutMs,
        `온디바이스 OCR 응답 시간 초과 (${Math.round(frameTimeoutMs / 1000)}초)`
      );
      consecutiveFail = 0;
    } catch (e) {
      if (abortCtrl) abortCtrl.abort();
      text = "";
      lastError = e;
      consecutiveFail++;
      console.warn(`[강의 필기] 로컬 OCR 실패 (프레임 ${i + 1}/${frames.length}):`, e);
      if (consecutiveFail >= 3) throw new Error(localFailureHint(lastError));
    } finally {
      bitmap.close();
      if (s && s !== session && s.destroy) s.destroy();
    }
    lines.push(text.trim());
    if (onEach) onEach(i + 1, frames.length);
  }
  return lines;
}

// --- 온디바이스 요약: 분할 후 합치기 (Map-Reduce) -----------------------------------
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

async function localChunkChars(session, overheadText) {
  const quota = session.inputQuota || 4096;
  let overhead = 0;
  let perChar = 1 / 1.5;
  if (session.measureInputUsage) {
    try {
      overhead = await session.measureInputUsage(overheadText);
      const probe = overheadText.slice(0, 400) || "가나다라마바사아자차";
      const probeTokens = await session.measureInputUsage(probe);
      if (probeTokens > 0) perChar = probeTokens / probe.length;
    } catch {
      // 측정 불가시 기본 추정치 사용
    }
  }
  const budget = Math.max(1000, quota - overhead - 500);
  return Math.max(500, Math.floor(budget / perChar));
}

async function summarizeLocal(session, script, makePrompt, onProgress) {
  const ask = async (text, isPartial) => {
    const s = session.clone ? await withTimeout(session.clone(), 5000, "세션 복제 시간 초과") : session;
    try {
      return await withTimeout(
        s.prompt(makePrompt(text, isPartial)),
        30000,
        "온디바이스 요약 응답 시간 초과 (30초)"
      );
    } finally {
      if (s !== session && s.destroy) s.destroy();
    }
  };

  const limit = await localChunkChars(session, makePrompt("", true));
  let parts = splitScript(script, limit);
  if (parts.length <= 1) return ask(script, false);

  let round = 0;
  while (parts.length > 1) {
    round++;
    const summaries = [];
    for (let i = 0; i < parts.length; i++) {
      if (onProgress) onProgress(`기기 내 요약 ${round}차 ${i + 1}/${parts.length}구간`);
      summaries.push((await ask(parts[i], true)).trim());
    }
    const joined = summaries.join("\n\n");
    parts = splitScript(joined, limit);
    if (round > 3) { parts = [joined.slice(0, limit)]; break; }
  }

  if (onProgress) onProgress("기기 내 요약 정리 중...");
  return ask(parts[0], false);
}

// --- 온디바이스 OCR: Tesseract ----------------------------------------------------
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
  module.exports = {
    parseOcrJson, buildOcrBody, buildSummaryBody, parseProviderResponse, dataUrlParts,
    splitScript, localAvailability, createLocalSession, ocrLocal, summarizeLocal, localChunkChars,
    withTimeout, LOCAL_FRAME_TIMEOUT_MS
  };
}
