// AI 제공자 라우팅. 순수 함수(요청 본문 빌더·응답 파서)와 실제 호출을 한 파일에 둔다.
//
// 규정 대응상 가장 중요한 불변식:
//   OCR(이미지)은 기본적으로 온디바이스에서만 돈다. 캡처 이미지가 기기를 벗어나지 않는다.
//   요약은 텍스트만 넘기므로 원격 모델을 써도 "캡처 이미지의 제3자 송신"에 해당하지 않는다.
// 원격 이미지 OCR은 Nano/Tesseract를 못 쓰는 환경을 위한 탈출구이며 명시적 동의 없이는 켜지지 않는다.

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

// 비전 모델이 글자만 읽으면 그래프·표·다이어그램이 통째로 사라진다. 그림이
// 무엇을 나타내는지 한 문장으로 함께 적게 한다. 마커를 붙이는 이유는 요약
// 단계에서 "이건 화면에서 본 그림"이라고 구분해 쓰게 하려는 것이다.
const FIGURE_CLAUSE =
  '그래프·다이어그램·표처럼 글자만으로는 알 수 없는 것이 있으면, 텍스트 뒤에 ' +
  '" / [그림] " 을 붙이고 무엇을 나타내는지 한 문장으로 적으세요. ' +
  '축과 추세, 항목 사이의 관계를 중심으로 쓰고 해석이나 추측은 하지 마세요. ';

const OCR_INSTRUCTION = (n) =>
  `위 ${n}장은 영상 화면을 시간 순서대로 캡처한 이미지입니다. ` +
  `각 이미지에서 보이는 텍스트(슬라이드 제목·본문·판서·자막)를 순서대로 옮겨 적으세요. ` +
  `한 이미지의 여러 줄은 " / "로 이어 붙여 하나의 문자열로 만드세요. ` +
  FIGURE_CLAUSE +
  `읽을 만한 것이 전혀 없는 이미지는 빈 문자열로 두세요. ` +
  `오직 JSON 배열(문자열 ${n}개)만 응답하세요. 다른 설명은 절대 포함하지 마세요.`;

const OCR_SYSTEM =
  "너는 영상 프레임에서 화면에 보이는 것을 옮겨 적는 도구다. 텍스트는 그대로 옮기고, " +
  "그림·그래프·표는 무엇을 나타내는지 한 문장으로만 적는다. JSON 배열 외의 텍스트는 절대 출력하지 않는다.";

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
  if (provider === "openrouter") {
    // OpenAI 호환 형식. 프레임은 이미 data URL 이라 그대로 넣으면 된다.
    const content = frames.map((f) => ({ type: "image_url", image_url: { url: f } }));
    content.push({ type: "text", text: instruction });
    return {
      model,
      max_tokens: 4096,
      messages: [
        { role: "system", content: OCR_SYSTEM },
        { role: "user", content },
      ],
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
  if (provider === "openrouter") {
    return {
      model,
      max_tokens: 4096,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
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
  if (provider === "openrouter") {
    const choice = (data.choices || [])[0] || {};
    const u = data.usage || {};
    return {
      text: (choice.message && choice.message.content) || "",
      input: u.prompt_tokens || 0,
      output: u.completion_tokens || 0,
    };
  }
  throw new Error(`알 수 없는 제공자: ${provider}`);
}

// --- 원격 호출 -----------------------------------------------------------------
// 제공자는 키 모양이 정한다. 설정에서 고른 값보다 키가 우선이다 — 키를 바꿔
// 넣었는데 제공자가 그대로면 요청 형식과 보내는 곳이 어긋난다.
//
// 이 함수가 유일한 판정자여야 한다. 예전에는 callRemote 안에서만 판정했는데,
// body 는 그전에 호출부가 settings.provider 로 이미 만들어 둔 상태였다. 기본
// 제공자(openrouter)에 Anthropic 키(sk-ant-)를 넣으면 OpenRouter 형식 body 가
// Anthropic 엔드포인트로 날아가 400 으로 떨어졌다.
function providerForKey(apiKey, configured) {
  if (!apiKey) return configured;
  if (apiKey.startsWith("sk-or-")) return "openrouter";
  if (apiKey.startsWith("sk-ant-")) return "anthropic";
  if (apiKey.startsWith("AIzaSy")) return "gemini";
  return configured;
}

// 모델 이름은 제공자마다 형식이 다르므로 AI 계층이 주인이다. 예전에는 settings.js
// 의 전역을 읽었는데, 브라우저에서는 스크립트 순서 덕에 우연히 동작하고 테스트에서는
// 터졌다. 파일 간 암묵적 결합이라 언제든 끊어질 수 있었다.
const PROVIDER_DEFAULT_MODEL = {
  openrouter: "anthropic/claude-sonnet-5",
  anthropic: "claude-sonnet-5",
  gemini: "gemini-flash-latest",
};

// 설정에 저장된 모델은 그때 고른 제공자의 것이다. 키가 바뀌어 제공자가 달라지면
// 그 모델 이름은 새 제공자에서 통하지 않는다. 그럴 땐 기본 모델로 돌아간다.
function modelForProvider(provider, configured, savedModel) {
  if (provider === configured && savedModel) return savedModel;
  return PROVIDER_DEFAULT_MODEL[provider] || "";
}

async function callRemote(provider, model, apiKey, body, retries = 2) {
  if (!apiKey) throw new Error("API 키가 없습니다. 설정에서 먼저 입력하세요.");
  if (apiKey.startsWith("apikey_")) {
    throw new Error(
      "입력하신 키는 Anthropic 콘솔의 식별자(Key ID)입니다. 'sk-ant-...' (Anthropic 비밀 키) 또는 'sk-or-...' (OpenRouter 키)를 설정에서 입력해 주세요."
    );
  }
  const activeProvider = providerForKey(apiKey, provider);
  const activeKey = apiKey;
  const activeModel = model;
  if (activeProvider !== provider) {
    // 호출부가 다른 제공자 형식으로 body 를 만들었다는 뜻이다. 조용히 보내면
    // 엉뚱한 오류로 나타난다 — 무엇이 어긋났는지 그대로 말한다.
    throw new Error(
      `요청 형식(${provider})과 API 키(${activeProvider})가 서로 다릅니다. ` +
        `설정에서 AI 제공자를 '${activeProvider}' 로 맞추거나, 해당 제공자의 키를 넣으세요.`
    );
  }

  let url = "";
  let headers = {};
  if (activeProvider === "anthropic") {
    url = ANTHROPIC_URL;
    headers = {
      "content-type": "application/json",
      "x-api-key": activeKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    };
  } else if (activeProvider === "openrouter") {
    url = OPENROUTER_URL;
    headers = {
      "content-type": "application/json",
      "Authorization": `Bearer ${activeKey}`,
      "HTTP-Referer": "https://github.com/arttechcorp/lecture-notes-extension",
      "X-Title": "Summrizei Lecture Notes",
    };
    body.model = activeModel;
  } else if (activeProvider === "gemini") {
    url = `${GEMINI_URL}/${activeModel}:generateContent`;
    headers = { "content-type": "application/json", "x-goog-api-key": activeKey };
  } else {
    throw new Error(`알 수 없는 제공자: ${activeProvider}`);
  }

  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
    if (!res.ok) {
      if ((res.status === 503 || res.status === 429) && attempt <= retries) {
        await new Promise((r) => setTimeout(r, 2000 * attempt));
        continue;
      }
      const text = await res.text().catch(() => "");
      if (res.status === 402 && text.includes("can only afford") && attempt <= retries) {
        const match = text.match(/can only afford (\d+)/);
        if (match && body.max_tokens && Number(match[1]) < body.max_tokens && Number(match[1]) > 300) {
          body.max_tokens = Math.floor(Number(match[1]) * 0.95);
          continue;
        }
      }
      throw new Error(`${activeProvider} API 오류 (${res.status}): ${text.slice(0, 300)}`);
    }
    return parseProviderResponse(activeProvider, await res.json());
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
// "연속 3회 실패"는 순차 실행을 전제로 한 판단이다. 병렬로 돌리면 '연속'이라는
// 개념이 사라지고, 일시적으로 겹친 실패 몇 개가 멀쩡한 배치를 통째로 중단시킨다.
// 전체 시도 중 실패 비율로 센다. 최소 시도 수를 두는 이유는 첫 한두 장이
// 실패했다고 바로 포기하지 않기 위해서다.
const FAIL_MIN_ATTEMPTS = 3;
const FAIL_ABORT_RATIO = 0.7;

async function ocrLocal(session, frames, onEach, frameTimeoutMs = LOCAL_FRAME_TIMEOUT_MS) {
  const lines = [];
  let attempts = 0;
  let failures = 0;
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
                  "그래프·다이어그램·표처럼 글자만으로는 알 수 없는 것이 있으면, 텍스트 뒤에 " +
                  "\" / [그림] \" 을 붙이고 무엇을 나타내는지 한 문장으로 적어라. " +
                  "축과 추세, 항목 사이의 관계를 중심으로 쓰고 해석이나 추측은 하지 마라. " +
                  "읽을 만한 것이 전혀 없으면 아무것도 출력하지 마라.",
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
      attempts++;
    } catch (e) {
      if (abortCtrl) abortCtrl.abort();
      text = "";
      lastError = e;
      attempts++;
      failures++;
      console.warn(`[강의 필기] 로컬 OCR 실패 (프레임 ${i + 1}/${frames.length}):`, e);
      // finally 가 정리를 맡으므로 여기선 던지기만 한다.
      if (attempts >= FAIL_MIN_ATTEMPTS && failures / attempts > FAIL_ABORT_RATIO) {
        throw new Error(localFailureHint(lastError));
      }
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

// 워커 하나에 동시에 recognize 를 걸면 내부 큐에 쌓일 뿐 병렬이 되지 않는다.
// 실제로 겹쳐 돌리려면 워커가 여러 개여야 한다. 코어 하나는 UI 몫으로 남기고,
// 넷을 넘기지 않는다 — 워커마다 언어 데이터를 따로 올려서 메모리가 그만큼 는다.
const TESS_MAX_WORKERS = 4;
function tessWorkerCount() {
  const cores = (typeof navigator !== "undefined" && navigator.hardwareConcurrency) || 2;
  return Math.max(1, Math.min(TESS_MAX_WORKERS, cores - 1));
}

async function createTesseractPool(onProgress) {
  if (tessWorker) return tessWorker;
  if (typeof Tesseract === "undefined") {
    throw new Error("Tesseract 라이브러리를 불러오지 못했습니다 — lib/vendor/tesseract/ 가 빠졌는지 확인하세요.");
  }
  const dir = chrome.runtime.getURL("lib/vendor/tesseract/");
  const make = () =>
    Tesseract.createWorker("kor+eng", 1, {
      workerPath: dir + "worker.min.js",
      corePath: dir + "tesseract-core-simd-lstm.wasm.js",
      langPath: dir,
      workerBlobURL: false,
      logger: (m) => onProgress && onProgress(m),
    });
  tessWorker = await Promise.all(Array.from({ length: tessWorkerCount() }, make));
  return tessWorker;
}

// 워커마다 하나씩 집어가며 돌린다. 결과는 완료 순서가 아니라 **입력 인덱스**에
// 넣는다 — mergeLines 는 직전 항목과만 중복을 비교하고 OCR 경로에는 시간 정렬이
// 없어서, 완료 순서로 쌓으면 중복 제거와 시간 순서가 동시에 깨진다.
// 한 워커는 한 번에 한 장만 본다. 같은 워커에 동시 호출하면 큐에 쌓일 뿐이다.
async function ocrTesseract(pool, frames, onEach) {
  const workers = Array.isArray(pool) ? pool : [pool];
  const lines = new Array(frames.length).fill("");
  let next = 0;
  let done = 0;
  await Promise.all(
    workers.map(async (worker) => {
      for (;;) {
        const i = next++;
        if (i >= frames.length) return;
        try {
          const res = await worker.recognize(frames[i]);
          lines[i] = (res.data.text || "")
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean)
            .join(" / ");
        } catch (e) {
          console.warn("[강의 필기] Tesseract OCR 실패:", e);
        }
        // 진행률은 완료 개수로 센다. 인덱스로 찍으면 3/8 다음에 1/8 이 나온다.
        if (onEach) onEach(++done, frames.length);
      }
    })
  );
  return lines;
}

if (typeof module !== "undefined") {
  module.exports = {
    parseOcrJson, buildOcrBody, buildSummaryBody, parseProviderResponse, dataUrlParts,
    splitScript, localAvailability, createLocalSession, ocrLocal, summarizeLocal, localChunkChars,
    withTimeout, LOCAL_FRAME_TIMEOUT_MS,
    providerForKey, modelForProvider, callRemote, PROVIDER_DEFAULT_MODEL,
    ocrTesseract, tessWorkerCount
  };
}

