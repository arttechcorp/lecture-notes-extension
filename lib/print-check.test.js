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
  getRepresentativePages,
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
    getFigureUnits: overrides.getFigureUnits || (() => []),
    getRepresentativeFeatures: overrides.getRepresentativeFeatures || (() => []),
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
  assert.equal(res.metrics.figureUnitSplitCount, 0);
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

// 2-1. 세로 넘침 (OVERFLOW_Y) 탐지: 한 쪽보다 큰 단편화 불가 요소
test("세로 넘침(OVERFLOW_Y) 탐지: 한 쪽(1014px)보다 큰 atomic 요소는 잘림", () => {
  const adapter = createMockAdapter({
    pageHeight: 1014,
    getOverflowCandidates: () => [
      {
        index: 0,
        tag: "svg",
        blockId: "S1_B1",
        width: 200,
        height: 1200,
        top: 50,
        bottom: 1250,
        atomic: true,
        scrollWidth: 200,
        clientWidth: 200,
        right: 200,
      },
    ],
  });

  const res = checkPrintLayout(adapter);
  assert.equal(res.ok, false);
  assert.equal(res.metrics.overflowYCount, 1);
  const issue = res.issues.find(i => i.code === CODES.OVERFLOW_Y);
  assert.ok(issue);
  assert.equal(issue.targetTag, "svg");
  assert.equal(issue.blockId, "S1_B1");
  assert.equal(issue.pageIndex, 0);
  assert.ok(issue.excessPx > 0);
});

// 2-2. 쪽 경계를 걸치기만 하는 atomic 요소는 세로 넘침이 아니다 (인쇄 엔진이 다음 쪽으로 밀어 넣음)
test("세로 넘침 비검출: 쪽 경계를 걸치지만 한 쪽보다 작은 atomic 요소", () => {
  const adapter = createMockAdapter({
    pageHeight: 1014,
    getOverflowCandidates: () => [
      {
        index: 0,
        tag: "pre",
        blockId: "S1_B1",
        width: 600,
        height: 200,
        top: 950,
        bottom: 1150, // 쪽 경계(1014)를 걸침
        atomic: true,
        scrollWidth: 600,
        clientWidth: 686,
        right: 600,
      },
    ],
  });

  const res = checkPrintLayout(adapter);
  assert.equal(res.metrics.overflowYCount, 0);
  assert.ok(!res.issues.some(i => i.code === CODES.OVERFLOW_Y));
});

// 2-3. 단편화 가능한 흐름 블록은 한 쪽보다 커도 세로 넘침이 아니다
test("세로 넘침 비검출: 단편화 가능한 블록이 한 쪽보다 큼", () => {
  const adapter = createMockAdapter({
    pageHeight: 1014,
    getContainerRect: () => ({ width: 686, height: 2200, scrollWidth: 686, scrollHeight: 2200 }),
    getOverflowCandidates: () => [
      {
        index: 0,
        tag: "section",
        blockId: "S1_B1",
        width: 686,
        height: 2100,
        top: 0,
        bottom: 2100,
        atomic: false, // 문단 흐름은 쪽 사이에서 나뉜다
        scrollWidth: 686,
        clientWidth: 686,
        right: 686,
      },
    ],
  });

  const res = checkPrintLayout(adapter);
  assert.equal(res.metrics.overflowYCount, 0);
  assert.ok(!res.issues.some(i => i.code === CODES.OVERFLOW_Y));
});

// 2-4. atomic 플래그가 없는 어댑터 데이터는 태그로 판별한다
test("세로 넘침 태그 판별: atomic 필드가 없어도 img 태그는 단편화 불가로 본다", () => {
  const adapter = createMockAdapter({
    pageHeight: 1014,
    getOverflowCandidates: () => [
      { index: 0, tag: "img", blockId: "S1_B1", width: 100, height: 1200, top: 0, bottom: 1200, scrollWidth: 100, clientWidth: 100, right: 100 },
      { index: 1, tag: "section", blockId: "S1_B2", width: 686, height: 1200, top: 1200, bottom: 2400, scrollWidth: 686, clientWidth: 686, right: 686 },
    ],
    getContainerRect: () => ({ width: 686, height: 2400, scrollWidth: 686, scrollHeight: 2400 }),
  });

  const res = checkPrintLayout(adapter);
  assert.equal(res.metrics.overflowYCount, 1);
  const issue = res.issues.find(i => i.code === CODES.OVERFLOW_Y);
  assert.equal(issue.targetTag, "img");
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

// 13. 제목+그림+최소해설 단위 분리 (FIGURE_UNIT_SPLIT) 탐지 및 1쪽 초과 분할 허용 (spec 8.3)
test("FIGURE_UNIT_SPLIT: 쪽 경계를 걸친 도표 단위 탐지 및 1쪽 초과/명시적 분할 허용", () => {
  // 13a. 정상: 한 쪽 안에 온전히 들어가는 도표 단위
  const normalAdapter = createMockAdapter({
    pageHeight: 1014,
    getFigureUnits: () => [
      {
        index: 0,
        figId: "G1",
        blockId: "S1_B1",
        top: 100,
        bottom: 400,
        height: 300,
        titleTop: 100,
        titleBottom: 130,
        bodyTop: 135,
        bodyBottom: 350,
        expTop: 355,
        expBottom: 400,
        documentedSplit: false,
      },
    ],
  });
  const normalRes = checkPrintLayout(normalAdapter);
  assert.equal(normalRes.metrics.figureUnitSplitCount, 0);

  // 13b. 결함: 도표 단위가 쪽 경계(1014px)를 걸쳐 분리됨 (제목 950px, 그림 1050px)
  const splitAdapter = createMockAdapter({
    pageHeight: 1014,
    getFigureUnits: () => [
      {
        index: 0,
        figId: "G2",
        blockId: "S1_B2",
        top: 950,
        bottom: 1250,
        height: 300,
        titleTop: 950,
        titleBottom: 980,
        bodyTop: 1020,
        bodyBottom: 1200,
        expTop: 1210,
        expBottom: 1250,
        documentedSplit: false,
      },
    ],
  });
  const splitRes = checkPrintLayout(splitAdapter);
  assert.equal(splitRes.ok, false);
  assert.equal(splitRes.metrics.figureUnitSplitCount, 1);
  const splitIssue = splitRes.issues.find(i => i.code === CODES.FIGURE_UNIT_SPLIT);
  assert.ok(splitIssue);
  assert.equal(splitIssue.figId, "G2");
  assert.equal(splitIssue.blockId, "S1_B2");
  assert.equal(splitIssue.startPage, 0);
  assert.equal(splitIssue.endPage, 1);

  // 13c. 허용: 1페이지보다 큰 도표는 설명 가능한 분할/축소 허용 (결함으로 집계하지 않음)
  const giantAdapter = createMockAdapter({
    pageHeight: 1014,
    getFigureUnits: () => [
      {
        index: 0,
        figId: "G3",
        blockId: "S1_B3",
        top: 100,
        bottom: 1300,
        height: 1200, // 1014px 초과
        titleTop: 100,
        titleBottom: 130,
        bodyTop: 140,
        bodyBottom: 1200,
        expTop: 1210,
        expBottom: 1300,
        documentedSplit: false,
      },
    ],
  });
  const giantRes = checkPrintLayout(giantAdapter);
  assert.equal(giantRes.metrics.figureUnitSplitCount, 0);

  // 13d. 허용: documentedSplit=true 설정된 경우 쪽 경계 걸침 허용
  const documentedAdapter = createMockAdapter({
    pageHeight: 1014,
    getFigureUnits: () => [
      {
        index: 0,
        figId: "G4",
        blockId: "S1_B4",
        top: 950,
        bottom: 1250,
        height: 300,
        titleTop: 950,
        titleBottom: 980,
        bodyTop: 1020,
        bodyBottom: 1200,
        expTop: 1210,
        expBottom: 1250,
        documentedSplit: true,
      },
    ],
  });
  const docRes = checkPrintLayout(documentedAdapter);
  assert.equal(docRes.metrics.figureUnitSplitCount, 0);
});

// 14. 대표 페이지(getRepresentativePages) 추출 및 dom_preflight 라벨링 검증 (spec 8.6)
test("getRepresentativePages: 표, 수식, 도표, 문항 대표 페이지 추출 및 DOM 프리플라이트 라벨링", () => {
  const adapter = createMockAdapter({
    pageHeight: 1014,
    getContainerRect: () => ({ width: 686, height: 3042, scrollWidth: 686, scrollHeight: 3042 }),
    getRepresentativeFeatures: () => [
      { reason: "table", blockId: "S1_B1", top: 100, bottom: 300 },      // 쪽 0
      { reason: "formula", blockId: "S1_B2", top: 400, bottom: 450 },    // 쪽 0
      { reason: "figure", blockId: "S2_B1", top: 1200, bottom: 1500 },   // 쪽 1
      { reason: "question", blockId: "S3_B1", top: 2200, bottom: 2500 }, // 쪽 2
    ],
  });

  const rep = getRepresentativePages(adapter);
  assert.equal(rep.checkType, "dom_preflight");
  assert.ok(rep.label.includes("DOM 프리플라이트"));
  assert.equal(rep.pageCount, 3);
  assert.equal(rep.zoomList.length, 4);

  // zoomList 항목 확인
  const tableZoom = rep.zoomList.find(z => z.reason === "table");
  assert.ok(tableZoom);
  assert.equal(tableZoom.pageNumber, 1);
  assert.equal(tableZoom.pageIndex, 0);
  assert.equal(tableZoom.blockId, "S1_B1");

  const figZoom = rep.zoomList.find(z => z.reason === "figure");
  assert.ok(figZoom);
  assert.equal(figZoom.pageNumber, 2);
  assert.equal(figZoom.pageIndex, 1);
  assert.equal(figZoom.blockId, "S2_B1");

  const qZoom = rep.zoomList.find(z => z.reason === "question");
  assert.ok(qZoom);
  assert.equal(qZoom.pageNumber, 3);
  assert.equal(qZoom.pageIndex, 2);
  assert.equal(qZoom.blockId, "S3_B1");
});

// 15. 재조판 2단계에서 FIGURE_UNIT_SPLIT 발생 시 page-break 적용
test("applyRelayoutStage: FIGURE_UNIT_SPLIT 이슈에 대해 대상 요소에 page-break 삽입", () => {
  const elementClasses = new Set();
  const mockContainer = {
    classList: {
      add: (cls) => elementClasses.add(cls),
      contains: (cls) => elementClasses.has(cls),
    },
    querySelector: (sel) => {
      if (sel === "#S1_B2" || sel === '[data-fig="G2"]') {
        const targetClasses = new Set();
        return {
          classList: {
            add: (cls) => targetClasses.add(cls),
            contains: (cls) => targetClasses.has(cls),
          },
        };
      }
      return null;
    },
  };

  const checkResult = {
    issues: [
      { code: CODES.FIGURE_UNIT_SPLIT, blockId: "S1_B2", figId: "G2" },
    ],
  };

  const applied = applyRelayoutStage(mockContainer, 2, checkResult);
  assert.ok(applied.includes("PAGE_BREAK_S1_B2"));
});

