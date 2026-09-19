// 기존 로컬 AI 호환 도우미. 운영 경로는 offscreen 세션과 인증된 요약 서비스다.
// 원격 이미지 OCR과 확장 내 API 키 호출은 지원하지 않는다.

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

// 외부 요청은 lib/service-client.js와 server/index.js의 텍스트 계약만 사용한다.

const LOCAL_OPTS = { expectedInputs: [{ type: "image" }] };

function getLanguageModelApi() {
  if (typeof LanguageModel !== "undefined") return LanguageModel;
  if (typeof ai !== "undefined" && ai.languageModel) return ai.languageModel;
  if (typeof window !== "undefined" && window.ai && window.ai.languageModel) return window.ai.languageModel;
  if (typeof self !== "undefined" && self.ai && self.ai.languageModel) return self.ai.languageModel;
  return null;
}

async function localAvailability(opts = LOCAL_OPTS) {
  const LM = getLanguageModelApi();
  if (!LM) return "unavailable";
  try {
    const hasOpts = opts && Object.keys(opts).length > 0;
    if (typeof LM.availability === "function") {
      return await (hasOpts ? LM.availability(opts) : LM.availability());
    }
    if (typeof LM.capabilities === "function") {
      const cap = await LM.capabilities();
      return cap.available || "unavailable";
    }
    return "unavailable";
  } catch {
    return "unavailable";
  }
}

async function createLocalSession(onProgress, opts = LOCAL_OPTS) {
  const LM = getLanguageModelApi();
  if (!LM) throw new Error("Chrome 내장 AI(LanguageModel)를 지원하지 않는 브라우저입니다.");
  const hasOpts = opts && Object.keys(opts).length > 0;
  return LM.create({
    ...(hasOpts ? opts : {}),
    monitor(m) {
      if (m && typeof m.addEventListener === "function") {
        m.addEventListener("downloadprogress", (e) => onProgress && onProgress(e.loaded));
      }
    },
  });
}

function localFailureHint(err) {
  const msg = String(err && err.message ? err.message : err);
  if (/crashed too many times/i.test(msg)) {
    return (
      "크롬 온디바이스 모델(Nano)이 반복 크래시로 이 크롬 버전에서 차단됐습니다. " +
      "chrome://on-device-internals 에서 상태를 확인하거나 크롬을 재시작하세요. " +
      "화면 글자 인식은 PP-OCRv5로 계속 동작합니다. (원문: " + msg + ")"
    );
  }
  return "온디바이스 OCR이 연속 실패했습니다: " + msg;
}

const LOCAL_FRAME_TIMEOUT_MS = 15000;
const LOCAL_SUMMARY_TIMEOUT_MS = 120000; // 기기 내 LLM 요약 기본 상한 (120초/2분)

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
      s = session.clone ? await withTimeout(session.clone(), 10000, "세션 복제 시간 초과") : session;
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
  const quota = session.maxTokens || session.inputQuota || 4096;
  let overhead = 0;
  let perChar = 1 / 1.5;
  if (typeof session.countPromptTokens === "function") {
    try {
      overhead = await session.countPromptTokens(overheadText);
      const probe = overheadText.slice(0, 400) || "가나다라마바사아자차";
      const probeTokens = await session.countPromptTokens(probe);
      if (probeTokens > 0) perChar = probeTokens / probe.length;
    } catch {
      // 측정 불가시 기본 추정치 사용
    }
  } else if (typeof session.measureInputUsage === "function") {
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

async function promptLocalWithWatchdog(s, promptText, timeoutMs = LOCAL_SUMMARY_TIMEOUT_MS, onProgress) {
  // 1. promptStreaming 지원 시: 토큰 스트리밍(델타 및 누적 지원) 및 동적 비활동 워치독
  if (typeof s.promptStreaming === "function") {
    try {
      const streamed = await new Promise(async (resolve, reject) => {
        let settled = false;
        let result = "";
        let timer = null;
        const INACTIVITY_MS = 45000; // 45초 동안 새 토큰이 전혀 안 나오면 중단
        const overallDeadline = Date.now() + timeoutMs;

        const resetInactivity = () => {
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => {
            if (!settled) {
              settled = true;
              reject(new Error("온디바이스 요약 무응답 시간 초과 (45초 동안 새 토큰 없음)"));
            }
          }, INACTIVITY_MS);
        };

        const processChunk = (chunk) => {
          const textChunk = typeof chunk === "string" ? chunk : (chunk && chunk.text ? chunk.text : String(chunk || ""));
          if (!textChunk) return;
          resetInactivity();
          // Chrome은 델타(새 토큰) 스트리밍을 제공하며, 일부 환경은 누적(전체 텍스트)을 제공함
          if (result && textChunk.startsWith(result)) {
            result = textChunk; // 누적 모드
          } else {
            result += textChunk; // 델타 모드
          }
          if (onProgress && result.length > 0) {
            onProgress(`기기 내 요약 작성 중... (${result.length}자)`);
          }
        };

        resetInactivity();
        try {
          const stream = s.promptStreaming(promptText);
          // ReadableStream getReader 및 async iterator 모두 안전하게 지원
          if (stream && typeof stream.getReader === "function" && typeof stream[Symbol.asyncIterator] !== "function") {
            const reader = stream.getReader();
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done || settled) break;
                if (Date.now() > overallDeadline) {
                  settled = true;
                  if (timer) clearTimeout(timer);
                  reject(new Error(`온디바이스 요약 전체 시간 초과 (${Math.round(timeoutMs / 1000)}초)`));
                  break;
                }
                processChunk(value);
              }
            } finally {
              reader.releaseLock();
            }
          } else if (stream) {
            for await (const chunk of stream) {
              if (settled) break;
              if (Date.now() > overallDeadline) {
                settled = true;
                if (timer) clearTimeout(timer);
                reject(new Error(`온디바이스 요약 전체 시간 초과 (${Math.round(timeoutMs / 1000)}초)`));
                break;
              }
              processChunk(chunk);
            }
          }
          if (!settled) {
            settled = true;
            if (timer) clearTimeout(timer);
            resolve(result);
          }
        } catch (err) {
          if (!settled) {
            settled = true;
            if (timer) clearTimeout(timer);
            reject(err);
          }
        }
      });

      if (streamed && streamed.trim().length > 0) {
        return streamed;
      }
    } catch (streamErr) {
      console.warn("[강의 필기] promptStreaming 실패/중단, 기본 prompt로 대체 실행:", streamErr);
    }
  }

  // 2. promptStreaming 미지원 또는 스트리밍 실패 시: 기본 prompt + 전체 타임아웃
  if (typeof s.prompt === "function") {
    return withTimeout(
      s.prompt(promptText),
      timeoutMs,
      `온디바이스 요약 응답 시간 초과 (${Math.round(timeoutMs / 1000)}초)`
    );
  }

  throw new Error("세션에 prompt 또는 promptStreaming 메서드가 없습니다.");
}

async function summarizeLocal(session, script, makePrompt, onProgress, summaryTimeoutMs = LOCAL_SUMMARY_TIMEOUT_MS) {
  const limit = await localChunkChars(session, makePrompt("", true));
  let parts = splitScript(script, limit);

  const ask = async (text, isPartial) => {
    // 단일 청크이거나 clone이 없으면 세션을 복제하지 않고 그대로 쓴다.
    // 불필요한 세션 복제로 5초 타임아웃이 터지는 문제를 방지한다.
    let s = session;
    let shouldDestroy = false;
    if (parts.length > 1 && typeof session.clone === "function") {
      try {
        s = await withTimeout(session.clone(), 15000, "세션 복제 시간 초과");
        shouldDestroy = (s !== session);
      } catch (e) {
        console.warn("[강의 필기] 세션 복제 지연/실패, 기존 세션으로 계속 진행:", e);
        s = session;
        shouldDestroy = false;
      }
    }

    try {
      return await promptLocalWithWatchdog(s, makePrompt(text, isPartial), summaryTimeoutMs, onProgress);
    } finally {
      if (shouldDestroy && s.destroy) s.destroy();
    }
  };

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
    if (round > 3 && parts.length > 1) throw new Error("전체 구간을 안전하게 통합하지 못했습니다. 인증된 요약 서비스로 다시 시도하세요.");
  }

  if (onProgress) onProgress("기기 내 요약 정리 중...");
  return ask(parts[0], false);
}

if (typeof module !== "undefined") {
  module.exports = {
    parseOcrJson,
    splitScript, localAvailability, createLocalSession, ocrLocal, summarizeLocal, localChunkChars,
    withTimeout, LOCAL_FRAME_TIMEOUT_MS, LOCAL_SUMMARY_TIMEOUT_MS, getLanguageModelApi
  };
}

