const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("./preprocess.js");

const block = (id, text, role = "body", bbox = null, extra = {}) => ({ id, text, role, bbox, conf: .9, ...extra });
const slide = (slideId, t0, texts) => ({
  slideId, t0, formulas: [], figures: [],
  blocks: texts.map((text, i) => block(`${slideId}-b${i}`, text, i === 0 ? "title" : "body", { x: 0, y: i * .1, w: .8, h: .1 })),
});

// cleanSpeech: 단독 간투사·겹친 낱말만 지우고 수치·부정·영어·단독 접속사는 보존
test("cleanSpeech removes fillers and stutters but keeps data words", () => {
  assert.equal(P.cleanSpeech("어 오늘은 강의를 시작한다"), "오늘은 강의를 시작한다");
  assert.equal(P.cleanSpeech("음 음 잠깐 보면"), "잠깐 보면");
  assert.equal(P.cleanSpeech("그 그 다음 식은"), "그 다음 식은");
  assert.equal(P.cleanSpeech("이 이 문제는 쉽다"), "이 문제는 쉽다");
  assert.equal(P.cleanSpeech("그 그 다음"), "그 다음");
  assert.equal(P.cleanSpeech("저 저 거는"), "저 거는");
  assert.equal(P.cleanSpeech("이 이 문제는"), "이 문제는");
  assert.equal(P.cleanSpeech("어 어 그 그 다음"), "그 다음");
  assert.equal(P.cleanSpeech("어, 다음으로 넘어간다"), "다음으로 넘어간다");

  assert.equal(P.cleanSpeech("수익률은 0.75% 다"), "수익률은 0.75% 다");
  assert.equal(P.cleanSpeech("조건이 안 된다"), "조건이 안 된다");
  assert.equal(P.cleanSpeech("IRR 을 쓴다"), "IRR 을 쓴다");
  assert.equal(P.cleanSpeech("이제 공식을 본다"), "이제 공식을 본다");
});

// cleanSpeech: 숫자 없는 Whisper 루프는 repeats.js 가 접고, 숫자·영어·두 음절 반복은 데이터라 유지
test("cleanSpeech folds digit-free loops but keeps repeated data", () => {
  assert.equal(
    P.cleanSpeech("제가 얘기하면 제가 얘기하면 제가 얘기하면 제가 얘기하면 끝"),
    "제가 얘기하면 제가 얘기하면 끝"
  );
  assert.equal(P.cleanSpeech("금리가 3 3 퍼센트"), "금리가 3 3 퍼센트");
  assert.equal(P.cleanSpeech("3 3 퍼센트"), "3 3 퍼센트");
  assert.equal(P.cleanSpeech("the the IRR is"), "the the IRR is");
  assert.equal(P.cleanSpeech("the the IRR"), "the the IRR");
  assert.equal(P.cleanSpeech("5 mg 5 mg 투여"), "5 mg 5 mg 투여");
  assert.equal(P.cleanSpeech("하나 하나 본다"), "하나 하나 본다");
  assert.equal(P.cleanSpeech("조금 조금 본다"), "조금 조금 본다");
});

// 로더: 브라우저에서는 repeats.js 가 클래식 스크립트라 globalThis 를 먼저 본다
test("loads collapseRepeats from globalThis before require", () => {
  const path = require.resolve("./preprocess.js");
  globalThis.collapseRepeats = t => ({ text: "STUB:" + t, removed: 0 });
  try {
    delete require.cache[path];
    const stub = require("./preprocess.js");
    assert.equal(stub.cleanSpeech("어 안녕"), "STUB:안녕");
  } finally {
    delete globalThis.collapseRepeats;
    delete require.cache[path];
  }
});

// slideText: filtered 워터마크 제외, title 역할 우선, 나머지는 y→x 읽기 순서
test("slideText drops filtered blocks and orders title first", () => {
  const s = {
    slideId: "s1", t0: 0, formulas: [], figures: [],
    blocks: [
      block("wm", "○○대학교 국제캠퍼스", "body", { x: 0, y: .95, w: 1, h: .05 }, { selection: "filtered" }),
      block("b1", "회수 기간법", "body", { x: .1, y: .3, w: .8, h: .1 }),
      block("t", "내부수익률", "title", { x: .1, y: .05, w: .8, h: .1 }),
      block("b2", "투자안 평가", "body", { x: .1, y: .2, w: .8, h: .1 }),
    ],
  };
  assert.equal(P.slideText(s), "내부수익률\n투자안 평가\n회수 기간법");
});

// slideText: 한 시각 행의 셀은 y 오차를 흡수해 x 순으로, bbox 없는 블록은 뒤에 입력 순서로
test("slideText groups visual rows and appends bbox-less blocks last", () => {
  const table = {
    slideId: "t", t0: 0, formulas: [], figures: [],
    blocks: [
      block("c1", "셀1", "body", { x: .1, y: .301, w: .2, h: .1 }),
      block("c2", "셀2", "body", { x: .4, y: .299, w: .2, h: .1 }),
      block("c3", "셀3", "body", { x: .7, y: .300, w: .2, h: .1 }),
    ],
  };
  assert.equal(P.slideText(table), "셀1\n셀2\n셀3");

  const mixed = {
    slideId: "m", t0: 0, formulas: [], figures: [],
    blocks: [
      block("a", "A", "body", { x: 0, y: .5, w: .1, h: .1 }),
      block("n", "N", "body", null),
      block("c", "C", "body", { x: 0, y: .1, w: .1, h: .1 }),
      block("d", "D", "body", { x: 0, y: .3, w: .1, h: .1 }),
    ],
  };
  assert.equal(P.slideText(mixed), "C\nD\nA\nN");
});

// slideText: title 블록이 여러 개면 읽기 순서로 잇는다 — repeat 특징이 같은 문자열을 보도록
test("slideText orders multiple title blocks by reading order", () => {
  const s = {
    slideId: "tt", t0: 0, formulas: [], figures: [],
    blocks: [
      block("t2", "부제", "title", { x: .6, y: 0, w: .3, h: .1 }),
      block("t1", "제목", "title", { x: .1, y: 0, w: .4, h: .1 }),
      block("b", "본문", "body", { x: .1, y: .3, w: .8, h: .1 }),
    ],
  };
  assert.equal(P.slideText(s), "제목\n부제\n본문");
});

// mergeProgressive: 앞 슬라이드 ⊂ 뒤 슬라이드(≥0.9) 연쇄 병합, 무관한 슬라이드는 유지
test("mergeProgressive folds build-up chains and keeps unrelated slides", () => {
  const merged = P.mergeProgressive([
    slide("a", 10, ["자본예산", "1. 개요"]),
    slide("b", 20, ["자본예산", "1. 개요", "2. 절차"]),
    slide("c", 30, ["자본예산", "1. 개요", "2. 절차", "3. 사례"]),
    slide("d", 40, ["전혀 다른 장", "새 내용"]),
  ]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].slideId, "c");
  assert.equal(merged[0].t0, 10);
  assert.deepEqual(merged[0].mergedFrom, ["a", "b"]);
  assert.equal(merged[1].slideId, "d");
});

// mergeProgressive: 앞 슬라이드에만 떴던 수식·도표는 id 합집합으로 보존, 입력은 불변
test("mergeProgressive unions formulas and figures by id", () => {
  const a = {
    slideId: "a", t0: 0, figures: [{ id: "G1" }],
    blocks: [block("a1", "제목", "title", { x: 0, y: 0, w: 1, h: .1 })],
    formulas: [{ id: "F1" }, { id: "F2" }],
  };
  const b = {
    slideId: "b", t0: 5, figures: [],
    blocks: [block("b1", "제목", "title", { x: 0, y: 0, w: 1, h: .1 }), block("b2", "새 줄", "body", { x: 0, y: .2, w: 1, h: .1 })],
    formulas: [{ id: "F2" }, { id: "F3" }],
  };
  const merged = P.mergeProgressive([a, b]);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].formulas.map(f => f.id), ["F1", "F2", "F3"]);
  assert.deepEqual(merged[0].figures.map(f => f.id), ["G1"]);
  assert.equal(a.formulas.length, 2);
  assert.equal(b.formulas.length, 2);
});

// mergeProgressive: 빈 슬라이드는 다음 것에 합쳐지지 않는다 — 빈 화면은 덧칠이 아니라 구간 경계다
test("mergeProgressive does not merge an empty slide into the next", () => {
  const merged = P.mergeProgressive([
    { slideId: "empty", t0: 0, blocks: [], formulas: [], figures: [] },
    slide("b", 5, ["내용"]),
  ]);
  assert.equal(merged.length, 2);
});

// alignSpeech: 발화 중간 시각이 든 구간의 슬라이드로 배정, 첫 슬라이드 이전은 선행 그룹
test("alignSpeech assigns by midpoint with leading group", () => {
  const slides = [slide("s1", 100, ["제목"]), slide("s2", 200, ["다른 제목"])];
  const groups = P.alignSpeech(slides, [
    { id: "g0", t0: 0, t1: 50, text: "도입부 인사" },
    { id: "g1", t0: 90, t1: 130, text: "경계를 걸친 발화" },   // 중간 110 → s1
    { id: "g2", t0: 150, t1: 170, text: "본론" },
    { id: "gx", t0: 160, t1: 165, text: "버려진 구간", status: "dropped" },
    { id: "g3", t0: 210, t1: 240, text: "다음 장" },
    { id: "g4", t0: 300, t1: 320, text: "마지막 슬라이드 이후" }, // 중간 310 → s2
  ]);
  assert.equal(groups.length, 3);
  assert.equal(groups[0].slide, null);
  assert.deepEqual(groups[0].segments.map(s => s.id), ["g0"]);
  assert.equal(groups[1].slide.slideId, "s1");
  assert.deepEqual(groups[1].segments.map(s => s.id), ["g1", "g2"]);
  assert.equal(groups[2].slide.slideId, "s2");
  assert.deepEqual(groups[2].segments.map(s => s.id), ["g3", "g4"]);
});

// alignSpeech: 슬라이드가 없으면 120초 창으로 자른다
test("alignSpeech falls back to 120s windows without slides", () => {
  const groups = P.alignSpeech([], [
    { id: "w1", t0: 0, t1: 10, text: "a" },
    { id: "w2", t0: 60, t1: 70, text: "b" },
    { id: "w3", t0: 130, t1: 140, text: "c" },
    { id: "w4", t0: 250, t1: 260, text: "d" },
  ]);
  assert.deepEqual(groups.map(g => g.segments.map(s => s.id)), [["w1", "w2"], ["w3"], ["w4"]]);
  assert.ok(groups.every(g => g.slide === null));
});

// features: 체류시간, 강조어·지시어 발생 횟수, 같은 제목 슬라이드 수, 수식·도표 유무
test("features counts emphasis, deixis and title repeats", () => {
  const sl = (slideId, title, extra = {}) => ({
    slideId, t0: 0, formulas: [], figures: [], ...extra,
    blocks: [block(slideId + "-t", title, "title", { x: 0, y: 0, w: 1, h: .1 })],
  });
  const g1 = {
    slide: sl("x", "3장 자본예산"), t0: 0, t1: 10,
    segments: [{ id: "p", t0: 0, t1: 10, text: "이 그래프 중요하고 시험에 꼭 나온다" }],
  };
  const g2 = { slide: sl("y", "3장 자본예산"), t0: 10, t1: 20, segments: [] };
  const g3 = { slide: sl("z", "4장 현금흐름"), t0: 20, t1: 30, segments: [] };
  const groups = [g1, g2, g3];

  const f1 = P.features(g1, groups);
  assert.equal(f1.dwell, 10);
  assert.ok(f1.speechChars > 0);
  assert.equal(f1.emphasis, 3);   // 중요·시험·꼭
  assert.equal(f1.deixis, 1);     // 이 그래프
  assert.equal(f1.repeat, 1);     // g2 가 같은 제목
  assert.equal(f1.hasFormula, false);

  assert.equal(P.features(g2, groups).repeat, 1);
  assert.equal(P.features(g3, groups).repeat, 0);

  const f4 = P.features({ slide: sl("f", "수식", { formulas: [{ id: "f1" }], figures: [{ id: "v1" }] }), segments: [] }, []);
  assert.equal(f4.hasFormula, true);
  assert.equal(f4.hasFigure, true);
});

// features: 지시어는 겹침 없이 한 번만 세고, 뒤가 조사 아닌 한글이면 오탐으로 걸러낸다
test("features counts deixis phrases once without false positives", () => {
  const deixis = text => P.features({
    slide: null, t0: 0, t1: 1,
    segments: [{ id: "s", t0: 0, t1: 1, text }],
  }, []).deixis;
  assert.equal(deixis("이 그래프를 보면 알 수 있다"), 1);
  assert.equal(deixis("이 표를 보면"), 1);
  assert.equal(deixis("그래프를 보면"), 1);
  assert.equal(deixis("이 표현은"), 0);
  assert.equal(deixis("이 표시와 이 표준"), 0);
  assert.equal(deixis("여기 보시면"), 1);
});

// buildIR: 유닛 순서·식별자, 수치 보존, 압축률
test("buildIR emits ordered units and compresses", () => {
  const slides = [
    {
      slideId: "s1", t0: 0, formulas: [], figures: [],
      blocks: [
        block("t1", "2장 수익률", "title", { x: 0, y: 0, w: 1, h: .1 }),
        block("wm", "○○대학교 워터마크", "body", { x: 0, y: .9, w: 1, h: .1 }, { selection: "filtered" }),
        block("b1", "IRR은 12.5%", "body", { x: 0, y: .2, w: 1, h: .1 }),
      ],
    },
    {
      slideId: "s2", t0: 60, formulas: [{ id: "f1" }], figures: [],
      blocks: [
        block("t2", "3장 할인율", "title", { x: 0, y: 0, w: 1, h: .1 }),
        block("b2", "WACC = 9%", "body", { x: 0, y: .2, w: 1, h: .1 }),
      ],
    },
  ];
  const segments = [
    { id: "a1", t0: 0, t1: 20, text: "어 어 지금부터 음 2장을 시작한다 반복 반복" },
    { id: "a2", t0: 30, t1: 50, text: "내부수익률은 12.5% 로 계산한다" },
    { id: "a5", t0: 52, t1: 58, text: "다시 다시 다시 다시" },
    { id: "a3", t0: 70, t1: 90, text: "자 할인율은 9% 다 여기 보면 된다" },
    { id: "a4", t0: 40, t1: 45, text: "잡담 구간", status: "dropped" },
  ];
  const ir = P.buildIR(slides, segments);
  assert.equal(ir.schemaVersion, 1);
  assert.deepEqual(ir.units.map(u => u.unitId), ["U1", "U2"]);
  assert.equal(ir.units[0].slideId, "s1");
  assert.equal(ir.units[0].t0, 0);
  assert.equal(ir.units[0].t1, 60);
  assert.equal(ir.units[0].slideText, "2장 수익률\nIRR은 12.5%");
  assert.ok(ir.units[0].speech.includes("12.5%"));
  // "2장"이 든 세그먼트는 repeats.js 보호 스위치가 꺼져 두 음절 반복이 그대로 남는다
  assert.ok(ir.units[0].speech.includes("반복 반복"));
  // 숫자 없는 세그먼트의 루프는 repeats.js 가 정확히 두 번으로 접는다
  assert.ok(ir.units[0].speech.includes("다시 다시"));
  assert.ok(!ir.units[0].speech.includes("다시 다시 다시"));
  assert.ok(!ir.units[0].speech.startsWith("어"));
  assert.equal(ir.units[1].slideId, "s2");
  assert.equal(ir.units[1].t0, 60);
  assert.equal(ir.units[1].t1, 90);
  assert.equal(ir.units[1].features.hasFormula, true);
  assert.equal(ir.units[0].judge.importance, null);
  assert.equal(ir.units[0].judge.lectureProb, null);
  assert.ok(ir.stats.irChars < ir.stats.rawChars);
  assert.ok(ir.stats.ratio < 1 && ir.stats.ratio > 0);
});

// buildIR: 같은 그룹의 다른 세그먼트에 숫자가 있어도 루프는 접히고, 숫자는 그대로 남는다
test("buildIR folds loops per segment and keeps digits", () => {
  const ir = P.buildIR([slide("s1", 0, ["제목"])], [
    { id: "a", t0: 0, t1: 10, text: "제가 얘기하면 제가 얘기하면 제가 얘기하면 제가 얘기하면" },
    { id: "b", t0: 10, t1: 20, text: "이자율은 3% 입니다" },
  ]);
  assert.equal(ir.units[0].speech, "제가 얘기하면 제가 얘기하면 이자율은 3% 입니다");
});

// buildIR: slideId 는 문자열로 정규화 — 숫자 id 도 "7" 로
test("buildIR stringifies numeric slideId", () => {
  const ir = P.buildIR([{ slideId: 7, t0: 0, blocks: [], formulas: [], figures: [] }], []);
  assert.equal(ir.units[0].slideId, "7");
});

// buildIR: 입력이 비면 유닛 없이 ratio 0
test("buildIR on empty input yields no units and ratio 0", () => {
  const ir = P.buildIR([], []);
  assert.deepEqual(ir.units, []);
  assert.equal(ir.stats.ratio, 0);
});

// buildIR: 입력 슬라이드·세그먼트는 변형하지 않는다
test("buildIR does not mutate inputs", () => {
  const slides = [
    { slideId: "a", t0: 0, blocks: [block("a1", "공통", "body", { x: 0, y: 0, w: 1, h: .1 })], formulas: [{ id: "F1" }], figures: [] },
    { slideId: "b", t0: 10, blocks: [block("b1", "공통", "body", { x: 0, y: 0, w: 1, h: .1 }), block("b2", "추가", "body", { x: 0, y: .2, w: 1, h: .1 })], formulas: [], figures: [] },
  ];
  const segments = [{ id: "s", t0: 0, t1: 5, text: "발화" }];
  const before = [JSON.stringify(slides), JSON.stringify(segments)];
  const ir = P.buildIR(slides, segments);
  assert.equal(ir.units.length, 1);
  assert.equal(ir.units[0].features.hasFormula, true);
  assert.deepEqual([JSON.stringify(slides), JSON.stringify(segments)], before);
});

// buildIR: evidence — 항목 텍스트를 이으면 유닛의 slideText·speech 와 같아지고, 걸러진 입력은 근거에 없다
test("buildIR evidence items reconstruct unit text and drop filtered input", () => {
  const Contracts = require("./contracts.js");
  const slides = [
    // 점진 판서 쌍 — 뒤 슬라이드로 병합된다
    { slideId: "p1", t0: 0, formulas: [], figures: [],
      blocks: [block("p1-t", "자본예산", "title", { x: 0, y: 0, w: 1, h: .1 }),
               block("p1-b", "1. 개요", "body", { x: 0, y: .2, w: 1, h: .1 })] },
    { slideId: "p2", t0: 10, formulas: [], figures: [],
      blocks: [block("p2-t", "자본예산", "title", { x: 0, y: 0, w: 1, h: .1 }),
               block("p2-b1", "1. 개요", "body", { x: 0, y: .2, w: 1, h: .1 }),
               block("p2-b2", "2. 절차", "body", { x: 0, y: .4, w: 1, h: .1 })] },
    // 배열 순서와 읽기 순서가 다른 블록들, filtered 워터마크, 표·장식 도표
    { slideId: "s3", t0: 60, t1: 120, formulas: [],
      figures: [
        { id: "g-tab", kind: "table", title: "구간별 값", cells: [["구간", "값"], ["[1,2]", "3"]], chartSummary: null },
        { id: "g-deco", kind: "decorative", title: "장식" },
      ],
      blocks: [
        block("s3-wm", "○○대 학번 워터마크", "watermark", { x: 0, y: .9, w: 1, h: .05 }, { selection: "filtered" }),
        block("s3-b2", "본문 둘째", "body", { x: 0, y: .4, w: 1, h: .1 }),
        block("s3-t", "회수 기간법", "title", { x: 0, y: 0, w: 1, h: .1 }),
        block("s3-b3", "본문 셋째", "body", { x: 0, y: .6, w: 1, h: .1 }),
        block("s3-b1", "본문 첫째", "body", { x: 0, y: .2, w: 1, h: .1 }),
      ] },
  ];
  const segments = [
    { id: "a1", t0: 0, t1: 8, text: "자본예산을 시작한다" },
    { id: "a2", t0: 20, t1: 30, text: "절차를 설명한다" },
    { id: "a3", t0: 40, t1: 50, text: "잡담", status: "filtered" },
    { id: "a4", t0: 52, t1: 56, text: "음 어 아" },   // 필러만 — 항목이 안 생긴다
    { id: "a5", t0: 70, t1: 90, text: "회수 기간법을 본다" },
  ];
  const ir = P.buildIR(slides, segments);
  assert.deepEqual(ir.units.map(u => u.unitId), ["U1", "U2"]);

  const items = (unitId, kind) => ir.evidence.filter(e => e.unitId === unitId && e.kind === kind);
  // 항목 텍스트를 이으면 유닛 문자열과 같다 — slideText·speechOf 와 같은 순서·정규화를 쓰므로
  for (const u of ir.units) {
    assert.equal(u.slideText, items(u.unitId, "slide").map(e => e.text).join("\n"), u.unitId);
    assert.equal(u.speech, items(u.unitId, "speech").map(e => e.text).join(" "), u.unitId);
  }
  // 모든 항목이 계약을 지키고 id 는 유일하다
  const ids = ir.evidence.map(e => e.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const e of ir.evidence) assert.ok(Contracts.validate(Contracts.SCHEMAS.evidenceItem, e).ok, JSON.stringify(e));
  // 번호는 유닛·종류별로 1부터
  assert.deepEqual(items("U1", "slide").map(e => e.id), ["U1.s1", "U1.s2", "U1.s3"]);
  assert.deepEqual(items("U1", "speech").map(e => e.id), ["U1.t1", "U1.t2"]);
  assert.deepEqual(items("U2", "slide").map(e => e.id), ["U2.s1", "U2.s2", "U2.s3", "U2.s4"]);
  assert.deepEqual(items("U2", "figure").map(e => e.id), ["U2.g1"]);
  assert.deepEqual(items("U2", "speech").map(e => e.id), ["U2.t1"]);
  // 유닛 안 순서: slide → figure → speech
  assert.deepEqual(ir.evidence.filter(e => e.unitId === "U2").map(e => e.kind),
    ["slide", "slide", "slide", "slide", "figure", "speech"]);
  // filtered 워터마크·세그먼트, 필러만 남은 세그먼트는 근거에 없다
  assert.ok(!ir.evidence.some(e => e.text.includes("워터마크")));
  assert.ok(!ir.evidence.some(e => e.sourceId === "s3-wm" || e.sourceId === "a3" || e.sourceId === "a4"));
  // 병합된 점진 슬라이드는 뒤 슬라이드 id 로 한 번만 나온다
  assert.equal(items("U1", "slide").length, 3);
  assert.ok(items("U1", "slide").every(e => e.slideId === "p2" && e.t0 === 0 && e.t1 === 60));
  assert.ok(!ir.evidence.some(e => e.slideId === "p1"));
  // 읽기 순서·role·도표 텍스트
  assert.deepEqual(items("U2", "slide").map(e => e.text), ["회수 기간법", "본문 첫째", "본문 둘째", "본문 셋째"]);
  assert.equal(items("U2", "slide")[0].role, "title");
  assert.equal(items("U2", "figure")[0].text, "구간별 값\n구간 | 값\n[1,2] | 3");
  assert.equal(items("U2", "figure")[0].role, null);
  assert.ok(items("U2", "speech").every(e => e.role === null && e.slideId === "s3"));
});

// buildIR: evidence — 슬라이드가 없으면 slideId null, 유닛은 120초 창 규칙을 그대로 따른다
test("buildIR evidence uses 120s windows and null slideId without slides", () => {
  const ir = P.buildIR([], [
    { id: "w1", t0: 0, t1: 10, text: "첫 발화" },
    { id: "w2", t0: 60, t1: 70, text: "같은 창" },
    { id: "w3", t0: 130, t1: 140, text: "다음 창" },
  ]);
  assert.deepEqual(ir.units.map(u => u.unitId), ["U1", "U2"]);
  assert.deepEqual(ir.evidence.map(e => e.id), ["U1.t1", "U1.t2", "U2.t1"]);
  assert.ok(ir.evidence.every(e => e.kind === "speech" && e.slideId === null && e.role === null));
  assert.equal(ir.evidence[2].t0, 130);
  assert.equal(ir.evidence[2].t1, 140);
});
