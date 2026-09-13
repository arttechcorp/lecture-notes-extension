const assert = require("assert");
const fs = require("fs");

// The extension must have no operator-key HTTP or remote image OCR API.
const ai = require("./ai.js");
assert.equal(ai.callRemote, undefined);
assert.equal(ai.buildOcrBody, undefined);

// --- splitScript: 온디바이스 요약용 분할 -------------------------------------------
{
  const { splitScript } = require("./ai.js");
  const lines = (n) => Array.from({ length: n }, (_, i) => `[00:0${i % 10}] 줄 ${i}`).join("\n");

  // 한도 안이면 한 덩어리
  assert.deepStrictEqual(splitScript("짧은 스크립트", 100), ["짧은 스크립트"]);

  // 줄 경계에서만 자른다 — 조각을 다시 붙이면 원본과 같아야 한다
  const src = lines(50);
  const parts = splitScript(src, 60);
  assert.ok(parts.length > 1);
  assert.ok(parts.every((p) => p.length <= 60));
  assert.strictEqual(parts.join("\n"), src);

  // 한 줄이 통째로 한도를 넘으면 그 줄만 강제로 자른다 (무한 루프 방지)
  const huge = splitScript("가".repeat(250), 100);
  assert.deepStrictEqual(huge.map((p) => p.length), [100, 100, 50]);

  // 빈 입력
  assert.deepStrictEqual(splitScript("", 100), []);
}

// 비전 OCR 은 글자만이 아니라 그림도 옮겨야 한다. 예전 프롬프트는 "설명을
// 덧붙이지 마라"로 이걸 명시적으로 금지해서, 그래프·표가 통째로 사라졌다.
{
  const ai = fs.readFileSync(require("path").join(__dirname, "ai.js"), "utf8");
  assert.ok(/\[그림\]/.test(ai), "OCR 프롬프트에 그림 설명 지시가 없다 — 도표가 사라진다");
  assert.ok(
    !/설명·추측을 덧붙이지 마라/.test(ai),
    "설명을 금지하는 옛 문구가 남아 있다 — 그림 지시와 모순된다"
  );
}

// --- withTimeout: 온디바이스 AI 프리징 방지 타임아웃 --------------------------------
(async () => {
  const { withTimeout } = require("./ai.js");

  // 정상 완료
  const fast = Promise.resolve("ok");
  assert.strictEqual(await withTimeout(fast, 100, "초과"), "ok");

  // 지연 시 타임아웃 에러 발생
  const slow = new Promise((resolve) => setTimeout(() => resolve("late"), 50));
  await assert.rejects(
    async () => withTimeout(slow, 10, "시간 초과 발생"),
    /시간 초과 발생/
  );

  // 원래 에러 전파
  const errorPromise = Promise.reject(new Error("기존 오류"));
  await assert.rejects(
    async () => withTimeout(errorPromise, 100, "초과"),
    /기존 오류/
  );

  // --- summarizeLocal: 온디바이스 요약 워치독 및 세션 관리 -----------------------------
  const { summarizeLocal, LOCAL_SUMMARY_TIMEOUT_MS, getLanguageModelApi } = require("./ai.js");
  assert.strictEqual(LOCAL_SUMMARY_TIMEOUT_MS, 120000, "로컬 요약 타임아웃은 최소 120초여야 한다");

  // 단일 청크는 복제 없이 세션을 직접 사용
  let cloned = false;
  const mockSingleSession = {
    clone: async () => { cloned = true; return mockSingleSession; },
    prompt: async () => "요약 완료",
  };
  const resSingle = await summarizeLocal(mockSingleSession, "짧은 강의 스크립트", (t) => t);
  assert.strictEqual(resSingle, "요약 완료");
  assert.strictEqual(cloned, false, "단일 청크에서는 clone()을 부르지 않는다");

  // promptStreaming (누적형 cumulative stream): 청크 누적 검증
  const progressUpdatesCumul = [];
  const mockCumulSession = {
    async *promptStreaming() {
      yield "핵심";
      yield "핵심 개념 정리";
    }
  };
  const resCumul = await summarizeLocal(
    mockCumulSession,
    "짧은 강의",
    (t) => t,
    (msg) => progressUpdatesCumul.push(msg)
  );
  assert.strictEqual(resCumul, "핵심 개념 정리");
  assert.ok(progressUpdatesCumul.some((msg) => msg.includes("자")));

  // promptStreaming (델타형 delta stream - 크롬 네이티브 방식): 토큰 이어붙이기 검증
  const progressUpdatesDelta = [];
  const mockDeltaSession = {
    async *promptStreaming() {
      yield "핵심 ";
      yield "개념 ";
      yield "정리 완료";
    }
  };
  const resDelta = await summarizeLocal(
    mockDeltaSession,
    "짧은 강의",
    (t) => t,
    (msg) => progressUpdatesDelta.push(msg)
  );
  assert.strictEqual(resDelta, "핵심 개념 정리 완료", "델타 스트리밍 토큰이 누락 없이 이어붙여져야 한다");
  assert.ok(progressUpdatesDelta.some((msg) => msg.includes("자")));

  // promptStreaming 실패 시 prompt() 폴백 검증
  const mockFallbackSession = {
    promptStreaming() {
      throw new Error("스트리밍 지원 불가");
    },
    prompt: async () => "폴백 요약 성공",
  };
  const resFallback = await summarizeLocal(mockFallbackSession, "짧은 강의", (t) => t);
  assert.strictEqual(resFallback, "폴백 요약 성공", "스트리밍 실패 시 일반 prompt로 성공해야 한다");

  console.log("ai: all tests passed");
})();
