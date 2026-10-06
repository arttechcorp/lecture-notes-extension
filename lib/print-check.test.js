// lib/print-check.test.js
// 조판 검수 및 재조판 루프 단위 테스트 (lib/print-check.js)

const test = require("node:test");
const assert = require("node:assert/strict");
const PrintCheck = require("./print-check.js");

const {
  A4,
  MAX_RELAYOUT_ATTEMPTS,
  MIN_BODY_FONT_SIZE_PX,
  CODES,
  checkPrintLayout,
  applyRelayoutStage,
  waitForPrintReady,
} = PrintCheck;

// 모의 어댑터 생성 도우미 (순수 함수 테스트용)
function createMockAdapter(overrides = {}) {
  const pageHeight = overrides.pageHeight || A4.CONTENT_HEIGHT_PX;
  const pageWidth = overrides.pageWidth || A4.CONTENT_WIDTH_PX;

  return {
    pageHeight,
    pageWidth,
    getContainerRect: overrides.getContainerRect || (() => ({
      width: pageWidth,
      height: pageHeight,
      scrollWidth: pageWidth,
      scrollHeight: pageHeight,
    })),
    getOverflowCandidates: overrides.getOverflowCandidates || (() => []),
    getKatexErrors: overrides.getKatexErrors || (() => []),
    getImages: overrides.getImages || (() => []),
    getHeadings: overrides.getHeadings || (() => []),
    getAnswerUnits: overrides.getAnswerUnits || (() => []),
    getTableRows: overrides.getTableRows || (() => []),
    getBodyTextNodes: overrides.getBodyTextNodes || (() => []),
    getPageVisuals: overrides.getPageVisuals || ((count) => {
      const res = [];
      for (let i = 0; i < count; i++) {
        res.push({ pageIndex: i, charCount: 800, visualAreaPx: 5000 });
      }
      return res;
    }),
  };
}

// 1. 기본 정상 레이아웃 검수
test("정상 레이아웃: 이슈 0건 및 ok=true 반환", () => {
  const adapter = createMockAdapter();
  const res = checkPrintLayout(adapter);

  assert.equal(res.ok, true);
  assert.equal(res.issues.length, 0);
  assert.equal(res.metrics.overflowXCount, 0);
  assert.equal(res.metrics.katexErrorCount, 0);
  assert.equal(res.metrics.imageFailedCount, 0);
  assert.equal(res.metrics.headingOrphanCount, 0);
  assert.equal(res.metrics.answerSplitCount, 0);
  assert.equal(res.metrics.tableRowClippedCount, 0);
  assert.equal(res.metrics.minFontSizeViolationCount, 0);
  assert.ok(res.metrics.pages.length >= 1);
});

// 2. 가로 넘침 (OVERFLOW_X) 탐지
test("가로 넘침(OVERFLOW_X) 탐지: scrollWidth 초과 및 폭 초과", () => {
  const adapter = createMockAdapter({
    getOverflowCandidates: () => [
      {
        index: 0,
        tag: "table",
        blockId: "S1_B1",
        width: 720,
        height: 200,
        scrollWidth: 750,
        clientWidth: 686,
        right: 720,
      },
    ],
  });

  const res = checkPrintLayout(adapter);
  assert.equal(res.ok, false);
  assert.equal(res.metrics.overflowXCount, 1);
  const issue = res.issues.find(i => i.code === CODES.OVERFLOW_X);
  assert.ok(issue);
  assert.equal(issue.targetTag, "table");
  assert.equal(issue.blockId, "S1_B1");
  assert.ok(issue.excessPx > 0);
});

// 3. KaTeX 오류 (.katex-error) 탐지
test("KaTeX 렌더 오류(KATEX_ERROR) 탐지", () => {
  const adapter = createMockAdapter({
    getKatexErrors: () => [
      { index: 0, blockId: "S2_B1" },
    ],
  });

  const res = checkPrintLayout(adapter);
  assert.equal(res.ok, false);
  assert.equal(res.metrics.katexErrorCount, 1);
  const issue = res.issues.find(i => i.code === CODES.KATEX_ERROR);
  assert.ok(issue);
  assert.equal(issue.blockId, "S2_B1");
});

// 4. 이미지 실패 및 미완료 탐지 (IMAGE_FAILED, IMAGE_INCOMPLETE)
test("이미지 실패(IMAGE_FAILED) 및 미완료(IMAGE_INCOMPLETE) 탐지", () => {
  const adapter = createMockAdapter({
    getImages: () => [
      { index: 0, blockId: "S1_B2", complete: true, naturalWidth: 0, decodeFailed: true },
      { index: 1, blockId: "S1_B3", complete: false, naturalWidth: 0, decodeFailed: false },
    ],
  });

  const res = checkPrintLayout(adapter);
  assert.equal(res.ok, false);
  assert.equal(res.metrics.imageFailedCount, 1);
  assert.equal(res.metrics.imageIncompleteCount, 1);
  assert.ok(res.issues.some(i => i.code === CODES.IMAGE_FAILED && i.blockId === "S1_B2"));
  assert.ok(res.issues.some(i => i.code === CODES.IMAGE_INCOMPLETE && i.blockId === "S1_B3"));
});

// 5. 제목만 남은 페이지 (HEADING_ORPHAN) 탐지
test("제목 고아(HEADING_ORPHAN) 탐지: 페이지 하단에 제목만 남음", () => {
  // A4 높이 1014px 기준, 1페이지 바닥 부근(990px)에 위치한 제목
  const adapter = createMockAdapter({
    pageHeight: 1014,
    getHeadings: () => [
      {
        index: 0,
        tag: "h3",
        blockId: "S3_B1",
        top: 960,
        bottom: 990,
        height: 30,
        nextContentTop: 1020, // 다음 본문은 2페이지(1014px 이후)로 넘어감
      },
    ],
  });

  const res = checkPrintLayout(adapter);
  assert.equal(res.ok, false);
  assert.equal(res.metrics.headingOrphanCount, 1);
  const issue = res.issues.find(i => i.code === CODES.HEADING_ORPHAN);
  assert.ok(issue);
  assert.equal(issue.blockId, "S3_B1");
  assert.equal(issue.pageIndex, 0);
});

// 6. 정답 첫 줄 분리 (ANSWER_SPLIT) 탐지
test("정답 첫 줄 분리(ANSWER_SPLIT) 탐지: 답 머리는 앞 페이지, 해설 첫 줄은 다음 페이지", () => {
  // 1페이지 바닥에 머리(1000px), 2페이지 시작(1020px)에 첫 줄
  const adapter = createMockAdapter({
    pageHeight: 1014,
    getAnswerUnits: () => [
      {
        index: 0,
        blockId: "S4_B1",
        top: 980,
        bottom: 1100,
        headBottom: 1000,
        firstLineTop: 1025,
      },
    ],
  });

  const res = checkPrintLayout(adapter);
  assert.equal(res.ok, false);
  assert.equal(res.metrics.answerSplitCount, 1);
  const issue = res.issues.find(i => i.code === CODES.ANSWER_SPLIT);
  assert.ok(issue);
  assert.equal(issue.blockId, "S4_B1");
  assert.equal(issue.headPage, 0);
  assert.equal(issue.firstLinePage, 1);
});

// 7. 표 행 잘림 (TABLE_ROW_CLIPPED) 탐지
test("표 행 잘림(TABLE_ROW_CLIPPED) 탐지: 한 행이 페이지 경계(1014px)를 가로지름", () => {
  const adapter = createMockAdapter({
    pageHeight: 1014,
    getTableRows: () => [
      {
        index: 2,
        blockId: "S2_B3",
        top: 1000,
        bottom: 1040,
        height: 40,
      },
    ],
  });

  const res = checkPrintLayout(adapter);
  assert.equal(res.ok, false);
  assert.equal(res.metrics.tableRowClippedCount, 1);
  const issue = res.issues.find(i => i.code === CODES.TABLE_ROW_CLIPPED);
  assert.ok(issue);
  assert.equal(issue.blockId, "S2_B3");
});

// 8. 본문 최소 글자 크기 위반 (FONT_SIZE_VIOLATION) 탐지
test("본문 최소 글자 크기 위반(FONT_SIZE_VIOLATION) 탐지: 12px 미만 감지", () => {
  const adapter = createMockAdapter({
    getBodyTextNodes: () => [
      { index: 0, tag: "p", blockId: "S1_B1", fontSize: 14 },
      { index: 1, tag: "p", blockId: "S1_B2", fontSize: 10.5 }, // 위반
    ],
  });

  const res = checkPrintLayout(adapter);
  assert.equal(res.ok, false);
  assert.equal(res.metrics.minFontSizeViolationCount, 1);
  const issue = res.issues.find(i => i.code === CODES.FONT_SIZE_VIOLATION);
  assert.ok(issue);
  assert.equal(issue.blockId, "S1_B2");
  assert.equal(issue.fontSizePx, 10.5);
});

// 9. 글자 + 도형 점유율 (시각 영역 포함하여 차트 페이지 오판 방지)
test("점유율: 글자 수가 적어도 도형(차트) 면적이 충분하면 저품질로 오판하지 않음", () => {
  // 1페이지: 글자 50자(매우 적음)이지만 차트 면적이 250,000px²
  const adapter = createMockAdapter({
    pageWidth: 686,
    pageHeight: 1014,
    getContainerRect: () => ({ width: 686, height: 2028, scrollWidth: 686, scrollHeight: 2028 }),
    getPageVisuals: (count) => [
      { pageIndex: 0, charCount: 50, visualAreaPx: 250000 },
      { pageIndex: 1, charCount: 800, visualAreaPx: 10000 },
    ],
  });

  const res = checkPrintLayout(adapter);
  // 차트 면적으로 인해 점유율이 0.35 이상 확보되어 OCCUPANCY_LOW 이슈가 발생하지 않아야 함
  const occIssue = res.issues.find(i => i.code === CODES.OCCUPANCY_LOW && i.pageIndex === 0);
  assert.equal(occIssue, undefined, "차트 면적이 큰 페이지는 저품질로 오판하지 않는다");
  assert.ok(res.metrics.pages[0].occupancyRatio > 0.2);
});

// 10. 불변식 검증: 결과에 사용자 본문 텍스트가 누출되지 않음 (콘텐츠 없는 코드·수치)
test("결과 불변식: issues 및 metrics 에 강의 텍스트나 사용자 내용이 포함되지 않음", () => {
  const adapter = createMockAdapter({
    getOverflowCandidates: () => [{ index: 0, tag: "p", blockId: "S1_B1", width: 800, height: 50, scrollWidth: 800, clientWidth: 686, right: 800 }],
    getKatexErrors: () => [{ index: 0, blockId: "S1_B2" }],
    getImages: () => [{ index: 0, blockId: "S1_B3", complete: true, naturalWidth: 0, decodeFailed: true }],
  });

  const res = checkPrintLayout(adapter);
  const json = JSON.stringify(res);

  // 허용 키워드(코드, 태그, blockId, 숫자) 외에 일반 문장이나 텍스트가 없는지 확인
  assert.ok(!json.includes("강의"));
  assert.ok(!json.includes("수식"));
  assert.ok(!json.includes("설명"));
  assert.ok(!json.includes("evidence"));
});

// 11. 재조판 단계별 순서 및 상수 검증
test("재조판 순서 및 최대 재시도 상수 검증", () => {
  assert.equal(MAX_RELAYOUT_ATTEMPTS, 2);
  assert.equal(MIN_BODY_FONT_SIZE_PX, 12);

  const mockContainer = {
    classes: new Set(),
    classList: {
      add: function(c) { mockContainer.classes.add(c); },
      contains: function(c) { return mockContainer.classes.has(c); },
    },
    querySelector: () => null,
  };

  // 1단계 적용: 빈칸 제거
  const step1 = applyRelayoutStage(mockContainer, 1, { metrics: { overflowXCount: 1 } });
  assert.ok(step1.includes("TRIM_WHITESPACE"));
  assert.ok(step1.includes("REARRANGE_UNITS"));
  assert.ok(mockContainer.classList.contains("print-trim-whitespace"));
  assert.ok(mockContainer.classList.contains("print-rearrange-units"));

  // 2단계 적용: 분할 허용 및 행간 조정
  const step2 = applyRelayoutStage(mockContainer, 2, {});
  assert.ok(step2.includes("ALLOW_SPLITS"));
  assert.ok(step2.includes("TIGHTEN_LEADING"));
  assert.ok(mockContainer.classList.contains("print-allow-splits"));
  assert.ok(mockContainer.classList.contains("print-tighten-leading"));
});

// 12. 준비 신호 (waitForPrintReady) 동작 검증
test("waitForPrintReady: 폰트, 이미지 실패 수집, 수식 오류 수집", async () => {
  let fontsReadyCalled = false;
  const mockDoc = {
    fonts: {
      ready: Promise.resolve().then(() => { fontsReadyCalled = true; }),
    },
  };

  let decodedCount = 0;
  const mockContainer = {
    querySelectorAll: (sel) => {
      if (sel === "img") {
        return [
          {
            complete: false,
            naturalWidth: 100,
            dataset: {},
            getAttribute: () => "img1.png",
            decode: async () => { decodedCount++; },
          },
          {
            complete: false,
            naturalWidth: 0,
            dataset: {},
            getAttribute: () => "img2.png",
            decode: async () => { throw new Error("Decode failed"); },
          },
        ];
      }
      if (sel === ".katex-error") {
        return [{}]; // 1개의 katex error
      }
      return [];
    },
  };

  const status = await waitForPrintReady(mockContainer, { document: mockDoc });
  assert.equal(status.ready, true);
  assert.equal(status.fontReady, true);
  assert.equal(fontsReadyCalled, true);
  assert.equal(status.failedImages.length, 1);
  assert.equal(status.failedImages[0].src, "img2.png");
  assert.equal(status.formulaErrors, 1);
});
