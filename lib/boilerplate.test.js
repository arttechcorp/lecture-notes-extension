const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeText, trigramJaccard, detect, maskRegions, maskBoxes } = require("./boilerplate.js");

const B = (id, text, role, bbox) => ({ id, text, role, bbox, conf: 0.9 });
const slide = (i, blocks) => ({ slideId: "sl" + i, t0: i * 30, blocks });
const at = (out, i, id) => out.slides[i].blocks.find((b) => b.id === id);
// union rect은 부동소수 연산 결과라 리터럴 비교 대신 IoU로 본다
const iou = (a, b) => {
  const iw = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const ih = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = iw * ih, uni = a.w * a.h + b.w * b.h - inter;
  return uni > 0 ? inter / uni : 0;
};

const FOOTER_BOX = { x: 0.05, y: 0.95, w: 0.2, h: 0.03 };
const PAGE_BOX = { x: 0.9, y: 0.95, w: 0.06, h: 0.03 };
// 워터마크는 매 슬라이드 위치가 달라야 한다 — 고정 영역 마스킹으로 잡히면 안 된다
const WM_BOXES = [
  { x: 0.15, y: 0.25 }, { x: 0.6, y: 0.4 }, { x: 0.3, y: 0.6 }, { x: 0.7, y: 0.2 },
  { x: 0.1, y: 0.5 }, { x: 0.55, y: 0.65 }, { x: 0.35, y: 0.3 }, { x: 0.75, y: 0.55 },
  { x: 0.2, y: 0.7 }, { x: 0.65, y: 0.35 }, { x: 0.4, y: 0.55 }, { x: 0.05, y: 0.35 },
].map((p) => ({ ...p, w: 0.18, h: 0.03 }));
const WM_TEXTS = [
  "2024123456 홍길동", "2024123456 홍길동", "2O24123456 홍길동", "2024123456 홍길동",
  "2024123456 홍길동", "2024123456 홍길동", "2024123456 홍길동", "2024123456 홍길동",
  "2024123456 홍길동", "2024123456 홍길퉁", "2024123456홍길동", "2024123456 홍길동",
];
// 표 숫자는 매 슬라이드 같은 자리에 있어도 데이터다 — 걸러지면 안 된다
const CELLS = [
  ["12", { x: 0.2, y: 0.45, w: 0.06, h: 0.03 }],
  ["3.5", { x: 0.3, y: 0.45, w: 0.06, h: 0.03 }],
  ["5kg", { x: 0.4, y: 0.45, w: 0.06, h: 0.03 }],
  ["100만원", { x: 0.5, y: 0.45, w: 0.07, h: 0.03 }],
  ["7%", { x: 0.62, y: 0.45, w: 0.05, h: 0.03 }],
];
const TOPICS = ["도입", "현금흐름", "할인율", "순현가", "수익률", "회수기간", "민감도", "시나리오", "사례", "정리", "복습", "질의"];

// 로컬 OCR은 전부 role "body"로 온다 — 역할 힌트 없이 잡아야 하는 경우
const buildOcr = () =>
  WM_TEXTS.map((wt, i) =>
    slide(i, [
      B("wm", wt, "body", WM_BOXES[i]),
      B("ft", "재무관리 3주차", "body", FOOTER_BOX),
      B("pg", String(i + 1), "body", PAGE_BOX),
      ...CELLS.map(([t, bx], j) => B("c" + j, t, "body", bx)),
      B("bd", `금리 ${i + 3}% 상승 시 가치 하락 ${i + 1}번째 사례`, "body", { x: 0.1, y: 0.2, w: 0.7, h: 0.08 }),
    ])
  );

// 학번 + 이름 + 매 장 바뀌는 타임스탬프 — 숫자열 전체는 상수가 아니지만 ID run은 상수
const WM_TIMES = [
  "14:31", "14:32", "15:07", "14:33", "14:34", "14:35",
  "14:36", "14:37", "14:38", "14:39", "14:40", "14:41",
];
const buildOcrTs = () =>
  WM_TIMES.map((tm, i) =>
    slide(i, [
      B("wm", `2024123456 홍길동 2026-10-02 ${tm}`, "body", WM_BOXES[i]),
      B("ft", "재무관리 3주차", "body", FOOTER_BOX),
      B("pg", String(i + 1), "body", PAGE_BOX),
      ...CELLS.map(([t, bx], j) => B("c" + j, t, "body", bx)),
      B("bd", `금리 ${i + 3}% 상승 시 가치 하락 ${i + 1}번째 사례`, "body", { x: 0.1, y: 0.2, w: 0.7, h: 0.08 }),
    ])
  );

// 블록 전체가 학번인 digit-only 워터마크 — 유사문자(2)와 한 자리 오독(6) 변형 포함
const WM_IDS = [
  "2024123456", "2024123456", "2O24123456", "2024123456", "2024123456", "2024123456",
  "2824123456", "2024123456", "2024123456", "2024123456", "2024123456", "2024123456",
];
const buildIdOnly = () =>
  WM_IDS.map((t, i) =>
    slide(i, [
      B("wm", t, "body", WM_BOXES[i]),
      ...CELLS.map(([c, bx], j) => B("c" + j, c, "body", bx)),
    ])
  );

// normalizeText: NFC, 공백 축약, 라틴 소문자화, 숫자 마스킹 + OCR 유사문자 흡수
test("normalizeText masks digit runs and OCR look-alike number tokens", () => {
  assert.equal(normalizeText("  2O24123456   홍길동 "), "# 홍길동");
  assert.equal(normalizeText("Page 12"), "page #");
  assert.equal(normalizeText("3.5%"), "#.#%");
  // NFD로 분해된 한글도 NFC와 같은 결과를 내야 한다
  assert.equal(normalizeText("홍길동".normalize("NFD")), normalizeText("홍길동"));
});

// trigramJaccard: 정규화된 문자열의 문자 3-gram 자카드, 3자 미만은 동일성 비교
test("trigramJaccard compares trigram sets, short strings by equality", () => {
  assert.equal(trigramJaccard("ab", "ab"), 1);
  assert.equal(trigramJaccard("ab", "ac"), 0);
  assert.equal(trigramJaccard("재무관리 3주차", "재무관리 7주차"), 1);
  const j = trigramJaccard("재무관리 3주차", "재무관리 4주차");
  assert.equal(j, trigramJaccard("재무관리 4주차", "재무관리 3주차"));
  assert.ok(trigramJaccard("재무관리 3주차", "international finance lecture") < 0.2);
});

// 움직이는 학번 워터마크: 오독 변형이 한두 장뿐이어도 편집거리 흡수로 걸러져야 한다
test("moving student-ID watermark is filtered including rare OCR variants", () => {
  const out = detect(buildOcr());
  for (let i = 0; i < 12; i++) assert.equal(at(out, i, "wm").selection, "filtered");
  assert.equal(at(out, 2, "wm").selectionReason, "반복 텍스트");
  assert.equal(at(out, 9, "wm").selectionReason, "반복 텍스트 (오독 추정)");
  assert.equal(at(out, 10, "wm").selectionReason, "반복 텍스트 (오독 추정)");
  assert.ok(out.signatures.includes("# 홍길동"));
  assert.ok(out.signatures.includes("2024123456")); // 학번은 ID 서명으로 남는다
  // 숫자열이 아닌 서명(정규화 텍스트)에는 숫자가 하나도 없어야 한다
  assert.ok(out.signatures.every((s) => /^\d{6,}$/.test(s) || !/\d/.test(s)));

  for (let i = 0; i < 12; i++) {
    assert.equal(at(out, i, "ft").selection, "filtered");
    assert.equal(at(out, i, "ft").selectionReason, "반복 텍스트");
    assert.equal(at(out, i, "pg").selection, "filtered");
    assert.equal(at(out, i, "pg").selectionReason, "쪽번호");
  }
  assert.ok(out.signatures.includes("재무관리 #주차"));
});

// 표 숫자·본문 수치는 절대 건드리지 않는다 — 정규화하면 "#"라 반복처럼 보이지만 배제 대상
test("table numbers at fixed positions and numeric body text stay included", () => {
  const out = detect(buildOcr());
  for (let i = 0; i < 12; i++) {
    for (let j = 0; j < 5; j++) assert.equal(at(out, i, "c" + j).selection, "included");
    assert.equal(at(out, i, "bd").selection, "included");
  }
  // 슬라이드 12의 쪽번호 "12"와 표 셀 "12"는 위치로 구별된다
  assert.equal(at(out, 11, "c0").text, "12");
  assert.equal(at(out, 11, "pg").selectionReason, "쪽번호");
  const numeric = ["#", "#.#", "#kg", "#만원", "#%"];
  assert.ok(out.signatures.every((s) => !numeric.includes(s)));
  assert.deepEqual(out.candidates, []); // 이 픽스처에선 가장자리 미확정 텍스트가 없다
});

// 80자 넘는 반복 문단은 진짜 내용(안건 등)일 가능성이 커서 건드리지 않는다
test("repeated agenda paragraph longer than 80 chars stays included", () => {
  const agenda =
    "오늘 강의에서는 자본예산의 기본 개념을 복습하고 순현가치법과 내부수익률법 회수기간법을 비교한 뒤 실제 기업의 투자 의사결정 사례에 적용하는 방법을 함께 살펴봅니다";
  assert.ok(normalizeText(agenda).length > 80);
  const slides = Array.from({ length: 12 }, (_, i) =>
    slide(i, [
      ...(i < 5 ? [B("ag", agenda, "body", { x: 0.1, y: 0.15, w: 0.8, h: 0.2 })] : []),
      B("bd", `본문 주제 ${TOPICS[i]}`, "body", { x: 0.1, y: 0.5, w: 0.6, h: 0.08 }),
    ])
  );
  const out = detect(slides);
  for (let i = 0; i < 5; i++) assert.equal(at(out, i, "ag").selection, "included");
});

// 과목 서명은 슬라이드가 2장뿐이어도 문서빈도 없이 바로 걸러낸다; 숫자 서명은 무시
test("known signatures filter on the first slide, ineligible ones are ignored", () => {
  const slides = [0, 1].map((i) =>
    slide(i, [
      B("wm", "2024123456 홍길동", "body", WM_BOXES[i]),
      B("ft", "재무관리 3주차", "body", FOOTER_BOX),
      ...CELLS.map(([t, bx], j) => B("c" + j, t, "body", bx)),
    ])
  );
  const out = detect(slides, { known: ["재무관리 #주차", "# 홍길동", "#", "#%", "#kg"] });
  assert.equal(at(out, 0, "wm").selectionReason, "과목 반복 텍스트");
  assert.equal(at(out, 0, "ft").selectionReason, "과목 반복 텍스트");
  for (let i = 0; i < 2; i++)
    for (let j = 0; j < 5; j++) assert.equal(at(out, i, "c" + j).selection, "included");
});

// 가장자리의 작은 반복 텍스트는 걸러내지 않고 후보로만 남긴다 — 판정은 판사 모델로
test("edge candidates are reported masked and stay included", () => {
  const build = (txt) =>
    Array.from({ length: 12 }, (_, i) =>
      slide(i, [
        ...(i < 2 ? [B("ed", txt, "body", { x: 0.3, y: 0.965, w: 0.22, h: 0.03 })] : []),
        B("bd", `본문 주제 ${TOPICS[i]}`, "body", { x: 0.1, y: 0.3, w: 0.6, h: 0.08 }),
      ])
    );
  const out = detect(build("교수 김철수 연구실"));
  assert.deepEqual(out.candidates, [{ text: "교수 김철수 연구실", reason: "가장자리 반복" }]);
  assert.equal(at(out, 0, "ed").selection, "included");
  assert.equal(at(out, 1, "ed").selection, "included");

  // 학번이 섞인 후보도 마스킹된 문자열로만 보고한다 — 원문이 새면 안 된다
  const out2 = detect(build("2024123456 김철수 연구실"));
  assert.deepEqual(out2.candidates, [{ text: "# 김철수 연구실", reason: "가장자리 반복" }]);
  assert.ok(out2.candidates.every((c) => !/\d{4}/.test(c.text)));
});

// vision 엔진 역할은 곧 판정 근거 — header/title만 반복 조건을 추가로 탄다
test("vision roles filter directly, header/title only by repetition", () => {
  const buildVision = (titleCount) =>
    Array.from({ length: 12 }, (_, i) =>
      slide(i, [
        B("ti", i < titleCount ? "자본예산 개론" : `개별 주제 ${TOPICS[i]} 강의`, "title", { x: 0.1, y: 0.04, w: 0.5, h: 0.06 }),
        B("hd", "재무관리 · 김민준 교수", "header", { x: 0.35, y: 0.02, w: 0.3, h: 0.03 }),
        B("wm", "2024123456 홍길동", "watermark", WM_BOXES[i]),
        B("ft", "재무관리 3주차", "footer", FOOTER_BOX),
        B("pn", `페이지 ${i + 1}`, "page_number", PAGE_BOX),
        B("bd", `본문 주제 ${TOPICS[i]}`, "body", { x: 0.1, y: 0.3, w: 0.6, h: 0.08 }),
      ])
    );

  const out = detect(buildVision(5));
  for (let i = 0; i < 12; i++) {
    assert.equal(at(out, i, "wm").selectionReason, "역할: watermark");
    assert.equal(at(out, i, "ft").selectionReason, "역할: footer");
    assert.equal(at(out, i, "pn").selectionReason, "역할: page_number");
    // 슬라이드에 title이 따로 있으니 header는 일반 블록처럼 반복 판정을 탄다
    assert.equal(at(out, i, "hd").selectionReason, "반복 텍스트");
  }
  // 쪽번호 역할 텍스트는 서명에 실리지 않는다
  assert.ok(!out.signatures.includes("페이지 #"));
  // 40% 정도 반복되는 제목은 살린다
  for (let i = 0; i < 5; i++) assert.equal(at(out, i, "ti").selection, "included");

  const out80 = detect(buildVision(10));
  for (let i = 0; i < 10; i++) assert.equal(at(out80, i, "ti").selectionReason, "반복 텍스트");
});

// 쪽번호 트랙 판정: 같은 자리의 단조 증가만 걸러진다
test("page-number tracks require monotonic increase at a fixed position", () => {
  const fixture = (fmt) =>
    Array.from({ length: 8 }, (_, i) =>
      slide(i, [B("pg", fmt(i), "body", PAGE_BOX), B("bd", `본문 주제 ${TOPICS[i]}`, "body", { x: 0.1, y: 0.3, w: 0.6, h: 0.08 })])
    );
  const pgAll = (out, sel) => {
    for (let i = 0; i < 8; i++) {
      assert.equal(at(out, i, "pg").selection, sel ? "filtered" : "included");
      if (sel) assert.equal(at(out, i, "pg").selectionReason, "쪽번호");
    }
  };
  pgAll(detect(fixture((i) => String([5, 3, 9, 2, 7, 1, 8, 4][i]))), false); // 단조 아님
  pgAll(detect(fixture(() => "12")), false); // 값이 안 변하면 쪽번호가 아니다
  pgAll(detect(fixture((i) => String(2019 + i))), false); // 연도는 4자리라 후보가 아니다
  pgAll(detect(fixture((i) => String(i + 1))), true);
  pgAll(detect(fixture((i) => String([1, 1, 2, 2, 3, 4, 4, 5][i]))), true); // 진행형 반복 허용
  pgAll(detect(fixture((i) => `${i + 1} / 8`)), true);
});

// maskRegions: 학습 슬라이드 내내 같은 자리에 걸러진 상자만 칠한다
test("maskRegions returns stable filtered regions, never the moving watermark", () => {
  const out = detect(buildOcr());
  const regions = maskRegions(out.slides);
  // 고정 바닥글과 쪽번호 자리만 남고 움직이는 워터마크는 없다
  assert.ok(regions.some((r) => iou(r, FOOTER_BOX) >= 0.5));
  assert.ok(regions.some((r) => iou(r, PAGE_BOX) >= 0.5));
  assert.ok(regions.every((r) => WM_BOXES.every((w) => iou(r, w) < 0.5)));

  // 학습 장수(기본 5) 미만이면 아무것도 반환하지 않는다
  assert.deepEqual(maskRegions(detect(buildOcr().slice(0, 4)).slides), []);

  // 바닥글만 안정된 5장 픽스처 → 바닥글 하나만
  const five = Array.from({ length: 5 }, (_, i) =>
    slide(i, [B("wm", WM_TEXTS[i], "body", WM_BOXES[i]), B("ft", "재무관리 3주차", "body", FOOTER_BOX)])
  );
  const fiveRegions = maskRegions(detect(five).slides);
  assert.equal(fiveRegions.length, 1);
  assert.ok(iou(fiveRegions[0], FOOTER_BOX) >= 0.5);
});

// 필터는 비파괴다 — 입력은 그대로, 출력은 새 객체, 블록 수도 같다
test("detect and maskRegions never mutate inputs and mark every block", () => {
  const slides = buildOcr();
  const snap = JSON.stringify(slides);
  const out = detect(slides);
  assert.equal(JSON.stringify(slides), snap);
  out.slides.forEach((s, i) => {
    assert.notEqual(s, slides[i]);
    assert.equal(s.blocks.length, slides[i].blocks.length); // 삭제 없음
    s.blocks.forEach((b) => {
      assert.notEqual(b, slides[i].blocks.find((x) => x.id === b.id));
      assert.ok(b.selection === "included" || b.selection === "filtered");
      assert.equal("selectionReason" in b, b.selection === "filtered");
    });
  });
  const snap2 = JSON.stringify(out.slides);
  maskRegions(out.slides);
  assert.equal(JSON.stringify(out.slides), snap2);
});

// 빈 입력·blocks 누락 슬라이드에서도 죽지 않는다
test("detect tolerates empty slides and missing blocks", () => {
  assert.deepEqual(detect([]), { slides: [], signatures: [], candidates: [] });
  const out = detect([{ slideId: "a", t0: 0 }, { slideId: "b", t0: 1, blocks: [] }]);
  assert.equal(out.slides.length, 2);
  assert.deepEqual(out.slides[0].blocks, []);
});

// maskBoxes: 앞 장에서 배운 서명으로 뒤 장의 움직이는 워터마크 상자를 칠한다
test("maskBoxes paints learned moving-watermark and footer boxes on later slides", () => {
  const slides = buildOcr();
  const { signatures } = detect(slides.slice(0, 5));
  for (let i = 5; i < 12; i++) {
    // 오독 변형("홍길퉁", 공백 누락)이 있는 슬라이드도 워터마크·바닥글 둘만 칠해진다
    assert.deepEqual(maskBoxes(slides[i].blocks, signatures), [WM_BOXES[i], FOOTER_BOX]);
  }
});

// 지난 강의에서 저장해 둔 서명은 학습 없이 첫 슬라이드부터 적용된다
test("maskBoxes applies stored course signatures without learning", () => {
  const slides = buildOcr();
  assert.deepEqual(maskBoxes(slides[0].blocks, ["# 홍길동"]), [WM_BOXES[0]]);
  // eligible을 못 채운 서명은 표 숫자를 칠하지 못하게 아예 무시한다
  for (const s of slides)
    assert.deepEqual(maskBoxes(s.blocks, ["#", "#%", "#kg", "#만원"]), []);
});

// maskBoxes는 비파괴다 — 상자 복사본을 돌려주고 입력은 그대로, 못 쓰는 입력엔 []
test("maskBoxes returns bbox copies, never mutates, tolerates bad input", () => {
  const blocks = [
    B("wm", "2024123456 홍길동", "body", WM_BOXES[0]),
    B("nb", "2024123456 홍길동", "body", undefined), // 상자 없음
    B("zb", "2024123456 홍길동", "body", { x: 0.1, y: 0.1, w: 0, h: 0.03 }), // 크기 0
    B("c0", "12", "body", { x: 0.2, y: 0.45, w: 0.06, h: 0.03 }),
  ];
  const sigs = ["# 홍길동"];
  const snapB = JSON.stringify(blocks), snapS = JSON.stringify(sigs);
  const boxes = maskBoxes(blocks, sigs);
  assert.equal(boxes.length, 1); // 상자 없는 블록은 건너뛴다
  boxes[0].x = 0.99;
  assert.equal(blocks[0].bbox.x, 0.15); // 복사본이어야 한다
  assert.equal(JSON.stringify(blocks), snapB);
  assert.equal(JSON.stringify(sigs), snapS);
  assert.deepEqual(maskBoxes(undefined, sigs), []);
  assert.deepEqual(maskBoxes([], sigs), []);
  assert.deepEqual(maskBoxes("x", sigs), []);
  assert.deepEqual(maskBoxes(blocks, undefined), []);
  assert.deepEqual(maskBoxes(blocks, "# 홍길동"), []);
});

// maskBoxes의 판정은 detect 규칙 2(과목 서명)와 정확히 같아야 한다
test("maskBoxes matches exactly when detect rule 2 filters", () => {
  const SIG = "# 홍길동";
  const samples = [
    "2024123456 홍길동",   // 동일
    "2O24123456 홍길동",   // 유사문자 오독
    "2024123456 홍길퉁",   // 한 음절 오독
    "2024123456홍길동",    // 공백 누락
    "재무관리 핵심 정리",  // 무관
  ];
  for (const t of samples) {
    const sl = slide(0, [B("x", t, "body", WM_BOXES[0])]);
    const masked = maskBoxes(sl.blocks, [SIG]).length === 1;
    const filtered = detect([sl], { known: [SIG] }).slides[0].blocks[0].selection === "filtered";
    assert.equal(masked, filtered, t);
  }
});

// 번호 라벨("예제 N" 계열)은 숫자가 매 장 바뀌는 내용이다 — 반복돼도 걸러내면 안 된다
test("numbered labels with varying digits stay included, no signature or candidate", () => {
  const DEFS = [
    ["lb1", "예제", 8, 0, { x: 0.1, y: 0.55, w: 0.25, h: 0.05 }],
    ["lb2", "연습문제", 6, 2, { x: 0.45, y: 0.55, w: 0.25, h: 0.05 }],
    ["lb3", "Example", 5, 1, { x: 0.1, y: 0.65, w: 0.25, h: 0.05 }],
    ["lb4", "Step", 6, 1, { x: 0.45, y: 0.65, w: 0.25, h: 0.05 }],
  ];
  const slides = Array.from({ length: 12 }, (_, i) =>
    slide(i, [
      ...DEFS.flatMap(([id, name, n, off, bx]) =>
        i >= off && i < off + n ? [B(id, `${name} ${i - off + 1}`, "body", bx)] : []),
      B("bd", `본문 주제 ${TOPICS[i]}`, "body", { x: 0.1, y: 0.3, w: 0.6, h: 0.08 }),
    ])
  );
  const out = detect(slides);
  for (const [id] of DEFS)
    for (let i = 0; i < 12; i++) {
      const b = out.slides[i].blocks.find((x) => x.id === id);
      if (b) assert.equal(b.selection, "included", `${id} on slide ${i}`);
    }
  assert.deepEqual(out.signatures, []);
  assert.deepEqual(out.candidates, []);

  // 같은 라벨이 중간에 번호를 바꿔도(Example 1×3 → Example 2×3) 내용이다
  const prog = Array.from({ length: 6 }, (_, i) =>
    slide(i, [
      B("ex", `Example ${i < 3 ? 1 : 2}`, "body", { x: 0.1, y: 0.5, w: 0.3, h: 0.05 }),
      B("bd", `본문 주제 ${TOPICS[i]}`, "body", { x: 0.1, y: 0.3, w: 0.6, h: 0.08 }),
    ])
  );
  const outP = detect(prog);
  for (let i = 0; i < 6; i++) assert.equal(at(outP, i, "ex").selection, "included");
});

// 숫자가 상수인 반복물은 여전히 걸러진다 — 오독 한두 장(20% 미만)은 용인한다
test("constant-digit repetitions are still filtered despite rare digit misreads", () => {
  const texts = WM_TEXTS.slice();
  texts[5] = "2824123456 홍길동"; // 12장 중 1장만 숫자 오독
  const slides = texts.map((wt, i) =>
    slide(i, [B("wm", wt, "body", WM_BOXES[i]), B("ft", "재무관리 3주차", "body", FOOTER_BOX)])
  );
  const out = detect(slides);
  for (let i = 0; i < 12; i++) {
    assert.equal(at(out, i, "wm").selection, "filtered");
    assert.equal(at(out, i, "ft").selection, "filtered");
  }
  assert.ok(out.signatures.includes("# 홍길동"));
  assert.ok(out.signatures.includes("재무관리 #주차"));
});

// 숫자가 아예 없는 반복 텍스트는 상수("")로 간주해 예전처럼 문서빈도로 걸러낸다
test("digit-free repeated text is still filtered by document frequency", () => {
  const slides = Array.from({ length: 12 }, (_, i) =>
    slide(i, [
      ...(i < 5 ? [B("un", "서울대학교 경영대학", "body", { x: 0.3, y: 0.9, w: 0.4, h: 0.05 })] : []),
      B("bd", `본문 주제 ${TOPICS[i]}`, "body", { x: 0.1, y: 0.3, w: 0.6, h: 0.08 }),
    ])
  );
  const out = detect(slides);
  for (let i = 0; i < 5; i++) assert.equal(at(out, i, "un").selectionReason, "반복 텍스트");
  assert.ok(out.signatures.includes("서울대학교 경영대학"));
});

// (a) 상수 학번 + 매 장 바뀌는 타임스탬프 — 긴 상수 run으로 걸리고 ID가 서명이 된다
test("constant student ID with varying timestamp is filtered, ID becomes a signature", () => {
  const slides = buildOcrTs();
  const snap = JSON.stringify(slides);
  const out = detect(slides);
  for (let i = 0; i < 12; i++) {
    assert.equal(at(out, i, "wm").selection, "filtered");
    assert.equal(at(out, i, "wm").selectionReason, "반복 텍스트");
    for (let j = 0; j < 5; j++) assert.equal(at(out, i, "c" + j).selection, "included");
  }
  assert.ok(out.signatures.includes("2024123456"));
  assert.ok(out.signatures.includes("# 홍길동 #-#-# #:#"));
  assert.ok(out.signatures.every((s) => /^\d{6,}$/.test(s) || !/\d/.test(s)));

  // 앞 5장으로 배우면 뒤 장의 워터마크·바닥글만 칠해진다
  const { signatures } = detect(slides.slice(0, 5));
  for (let i = 5; i < 12; i++)
    assert.deepEqual(maskBoxes(slides[i].blocks, signatures), [WM_BOXES[i], FOOTER_BOX]);
  // 타임스탬프가 잘려도, ID만 따로 읽혀도 같은 서명으로 칠해진다
  const trunc = slide(12, [B("wm", "2024123456 홍길동 2026-10-0", "body", WM_BOXES[0])]);
  assert.deepEqual(maskBoxes(trunc.blocks, signatures), [WM_BOXES[0]]);
  const onlyId = slide(13, [B("wm", "2024123456", "body", WM_BOXES[1])]);
  assert.deepEqual(maskBoxes(onlyId.blocks, signatures), [WM_BOXES[1]]);
  assert.equal(JSON.stringify(slides), snap);
});

// (b) digit-only 학번 워터마크 — eligible이 아니어도 규칙 3b로 걸리고 칠해진다
test("digit-only student-ID watermark is filtered and maskable", () => {
  const slides = buildIdOnly();
  const snap = JSON.stringify(slides);
  const out = detect(slides);
  for (let i = 0; i < 12; i++) assert.equal(at(out, i, "wm").selection, "filtered");
  assert.equal(at(out, 0, "wm").selectionReason, "반복 텍스트");
  assert.equal(at(out, 2, "wm").selectionReason, "반복 텍스트"); // 유사문자는 접혀서 같은 그룹
  assert.equal(at(out, 6, "wm").selectionReason, "반복 텍스트 (오독 추정)"); // 한 자리 오독
  assert.ok(out.signatures.includes("2024123456"));
  assert.ok(!out.signatures.includes("#"));
  for (let i = 0; i < 12; i++)
    for (let j = 0; j < 5; j++) assert.equal(at(out, i, "c" + j).selection, "included");

  // 앞 5장(유사문자 포함)만 배워도 뒤 장은 오독 변형까지 전부 칠해진다
  const { signatures } = detect(slides.slice(0, 5));
  for (let i = 5; i < 12; i++)
    assert.deepEqual(maskBoxes(slides[i].blocks, signatures), [WM_BOXES[i]]);
  assert.equal(JSON.stringify(slides), snap);

  // OCR이 한 자리를 빠뜨리거나 더해도 칠한다; 두 자리 이상 짧은 근접열("20241234")은 다른 수라 안 칠한다
  const box = { x: 0.1, y: 0.1, w: 0.2, h: 0.05 };
  const one = (text) => maskBoxes([{ id: "x", text, role: "body", bbox: box, conf: 0.9 }], ["2024123456"]).length;
  assert.equal(one("202412345"), 1);
  assert.equal(one("20241234567"), 1);
  assert.equal(one("20241234"), 0);
});

// (c) 고정 자리 표 숫자는 ID처럼 보여도 절대 안 건드린다 — 7자리는 digit-only ID도 아니다
test("fixed table numbers are never filtered and never masked", () => {
  const FIXED = [
    ["n12", "12"], ["n2026", "2026"], ["n7", "1234567"], ["n35", "3.5"], ["nw", "100만원"],
  ];
  const slides = Array.from({ length: 12 }, (_, i) =>
    slide(i, [
      ...FIXED.map(([id, t], j) => B(id, t, "body", { x: 0.2 + j * 0.1, y: 0.45, w: 0.07, h: 0.03 })),
      B("bd", `본문 주제 ${TOPICS[i]}`, "body", { x: 0.1, y: 0.3, w: 0.6, h: 0.08 }),
    ])
  );
  const out = detect(slides);
  for (let i = 0; i < 12; i++)
    for (const [id] of FIXED) assert.equal(at(out, i, id).selection, "included", `${id} on slide ${i}`);
  assert.ok(out.signatures.every((s) => !/^\d{6,}$/.test(s)));

  // (a)·(b)에서 배운 ID 서명으로도 이 셀들은 칠해지지 않는다
  const learned = [
    ...detect(buildOcrTs().slice(0, 5)).signatures,
    ...detect(buildIdOnly().slice(0, 5)).signatures,
  ];
  for (let i = 0; i < 12; i++) assert.deepEqual(maskBoxes(slides[i].blocks, learned), []);
});

// (d) 번호 라벨은 긴 숫자 run이 없어 상수 판정을 통과하지 못한다 — 그대로 내용
test("numbered labels have no long digit run and stay unsigned", () => {
  const slides = Array.from({ length: 12 }, (_, i) =>
    slide(i, [
      ...(i < 8 ? [B("ye", `예제 ${i + 1}`, "body", { x: 0.3, y: 0.55, w: 0.25, h: 0.05 })] : []),
      ...(i < 6 ? [B("ex", `Example ${i + 1}`, "body", { x: 0.3, y: 0.65, w: 0.25, h: 0.05 })] : []),
      B("bd", `본문 주제 ${TOPICS[i]}`, "body", { x: 0.1, y: 0.3, w: 0.6, h: 0.08 }),
    ])
  );
  const out = detect(slides);
  for (let i = 0; i < 8; i++) assert.equal(at(out, i, "ye").selection, "included");
  for (let i = 0; i < 6; i++) assert.equal(at(out, i, "ex").selection, "included");
  assert.deepEqual(out.signatures, []);
  assert.deepEqual(out.candidates, []);
});

// (e) vision이 watermark로 판정한 digit-only 블록 — 숫자가 서명으로 남아 뒤 장도 칠한다
test("vision watermark role captures digit-only ID into signatures", () => {
  const slides = Array.from({ length: 12 }, (_, i) =>
    slide(i, [
      B("wm", "2024123456", "watermark", WM_BOXES[i]),
      B("bd", `본문 주제 ${TOPICS[i]}`, "body", { x: 0.1, y: 0.3, w: 0.6, h: 0.08 }),
    ])
  );
  const out = detect(slides);
  for (let i = 0; i < 12; i++) assert.equal(at(out, i, "wm").selectionReason, "역할: watermark");
  assert.ok(out.signatures.includes("2024123456"));
  const later = slide(12, [B("wm", "2024123456", "body", WM_BOXES[3])]);
  assert.deepEqual(maskBoxes(later.blocks, out.signatures), [WM_BOXES[3]]);
});

// (f) 저장해 둔 ID 서명은 학습 없이 첫 슬라이드부터 적용되고, 다른 숫자는 건드리지 않는다
test("known ID signature filters from the first slide, other digits untouched", () => {
  const slides = [
    slide(0, [
      B("id", "2024123456", "body", WM_BOXES[0]),
      B("wm", "2024123456 홍길동 2026-10-02 09:00", "body", WM_BOXES[1]),
      B("sh", "20241234", "body", WM_BOXES[2]), // 길이가 다른 근접열 — 다른 학번일 수 있다
      B("c0", "12", "body", { x: 0.2, y: 0.45, w: 0.06, h: 0.03 }),
    ]),
  ];
  const out = detect(slides, { known: ["2024123456"] });
  assert.equal(at(out, 0, "id").selectionReason, "과목 반복 텍스트");
  assert.equal(at(out, 0, "wm").selectionReason, "과목 반복 텍스트");
  assert.equal(at(out, 0, "sh").selection, "included");
  assert.equal(at(out, 0, "c0").selection, "included");
});
