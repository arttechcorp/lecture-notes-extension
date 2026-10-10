// 슬라이드의 그림을 노트에 다시 그리기 위한 입력.
//
// PP-OCRv5 는 글자만 읽는다. 회로도든 밴드 다이어그램이든 모델에게는 라벨 몇 개만
// 도착하고, 그림이 있었다는 사실조차 전달되지 않는다. 그런데 검출기는 이미 각 글자
// 상자의 좌표를 알고 있다 — 그걸 버리지 않고 같이 넘기면 모델이 배치를 보고 도식을
// 복원할 수 있다.
//
// ponytail: 그림 검출기를 따로 만들지 않는다. 임계값을 깎는 대신 좌표를 그대로 주고
// 판단은 모델에 맡긴다. 천장 — 라벨이 없는 곡선·파형은 이 방법으로 살릴 수 없다.
// 이미지를 외부로 보내는 것은 원칙상 별개 결정이다 — 유일한 예외는 mis-sol-hai D6:
// OCR이 못 읽은 필기 영역 한정으로, 클라우드 인식 동의 범위에서 작성 모델에 이미지로 보내 해석한다(저장 금지).
(() => {
  // 본문 슬라이드는 제목과 글머리가 한두 개의 x 에 줄맞춤된다. 그런 화면에 좌표를
  // 붙여봐야 토큰만 늘고 알려주는 것이 없다. 흩어진 배치일 때만 좌표를 싣는다.
  const COLUMN_TOLERANCE = 0.05, MIN_COLUMNS = 3, MIN_LINES = 3;

  function layoutText(lines, width, height) {
    const spoken = (lines || []).filter(line => line && String(line.text || "").trim());
    const plain = spoken.map(line => String(line.text).trim()).join("\n");
    // 일부만 좌표가 있으면 배치를 반만 아는 셈이라 오히려 틀린 그림을 그리게 한다.
    const placed = spoken.every(line => Number.isFinite(line.box?.x) && Number.isFinite(line.box?.y));
    if (!placed || !(width > 0) || !(height > 0) || spoken.length < MIN_LINES) return plain;

    const columns = new Set(spoken.map(line => Math.round(line.box.x / width / COLUMN_TOLERANCE)));
    if (columns.size < MIN_COLUMNS) return plain;

    const pct = (value, span) => Math.max(0, Math.min(99, Math.round(value / span * 100)));
    return spoken
      .map(line => `(${pct(line.box.x, width)},${pct(line.box.y, height)}) ${String(line.text).trim()}`)
      .join("\n");
  }

  // Free 로컬 엔진(PP-OCR)의 줄 상자를 유료 비전과 같은 SlideDoc 모양으로 옮긴다 — 이후 단계는
  // 엔진을 몰라도 된다. 역할은 한 장만 보고도 확실한 것만 붙인다: 위쪽의 가장 큰 글씨 줄만 title,
  // 나머지는 전부 body 다. 가장자리·반복 판정은 여러 장을 봐야 하므로 boilerplate.js 몫이다 —
  // 여기서 footer 로 찍으면 한 장만 보고 내용을 지우는 셈이 된다.
  const TOP = 0.3, TITLE_RATIO = 1.25;
  // 수식 줄: 관계 기호가 있고 한글이 없으며 거의 전부가 수식 문자다. 3자 이상 영단어는 함수명이 아니면
  // 산문("Profit = Revenue")이나 URL 이라 본문으로 둔다. 애매하면 본문 — 로컬 OCR 은 구조를 못 읽으므로
  // 수식으로 옮겨도 LaTeX 이 생기지 않고, 원문을 그대로 남기는 편이 안전하다.
  const RELATION = /[=<>≤≥≠≈∝]/;
  const MATH = /[\p{N}A-Za-zͰ-Ͽ+\-−–=<>≤≥≠≈∝±×÷·∙√∑∏∫∂∞^_()[\]{}|/.,'′%]/u;
  const FUNCS = new Set(["sin", "cos", "tan", "log", "exp", "lim", "max", "min", "sqrt", "det", "mod", "var", "cov", "arg", "sup", "inf"]);
  function isFormulaLine(text) {
    const s = String(text || "").normalize("NFKC").replace(/\s+/g, "");
    if (s.length < 3 || !RELATION.test(s) || /[가-힣]/.test(s) || !/[\p{L}\p{N}]/u.test(s)) return false;
    if ((s.match(/[A-Za-z]{3,}/g) || []).some(word => !FUNCS.has(word.toLowerCase()))) return false;
    const chars = [...s];
    return chars.filter(c => MATH.test(c)).length / chars.length >= 0.85;
  }

  // ponytail: 수식 줄 크롭 보관(architecture-v2 §6.2)은 패키지 저장 단계가 붙을 때 한다 — 지금은 bbox 만 넘긴다.
  function localSlideDoc(lines, width, height, { slideId = "s1", t0 = 0, t1 = 0, model = "PP-OCRv5" } = {}) {
    const unit = v => Math.min(1, Math.max(0, v)), time = v => Number.isFinite(v) && v > 0 ? v : 0;
    const bboxOf = b => width > 0 && height > 0 && [b?.x, b?.y, b?.width, b?.height].every(Number.isFinite)
      ? { x: unit(b.x / width), y: unit(b.y / height), w: unit(b.width / width), h: unit(b.height / height) } : null;
    const items = (lines || []).filter(line => line && String(line.text || "").trim())
      .map(line => ({ text: String(line.text).trim().slice(0, 4000), bbox: bboxOf(line.box), conf: Number.isFinite(line.confidence) ? unit(line.confidence) : null }));
    const blocks = items.filter(item => !isFormulaLine(item.text)).slice(0, 400);
    const formulas = items.filter(item => isFormulaLine(item.text)).slice(0, 100);
    // 아래쪽 중앙값과 비교한다 — 두 줄뿐인 슬라이드에서 제목 자신이 기준이 되면 안 된다.
    const sized = blocks.filter(b => b.bbox && b.bbox.h > 0), cy = b => b.bbox.y + b.bbox.h / 2;
    const heights = sized.map(b => b.bbox.h).sort((a, z) => a - z), median = heights[(heights.length - 1) >> 1];
    const top = sized.filter(b => cy(b) < TOP);
    const tallest = top.reduce((m, b) => !m || b.bbox.h > m.bbox.h ? b : m, null);
    // 검출기가 제목 한 줄을 여러 상자로 쪼개도 같은 행의 비슷한 크기 상자는 모두 제목이다.
    const titles = new Set(tallest && sized.length >= 2 && tallest.bbox.h >= TITLE_RATIO * median
      ? top.filter(b => b.bbox.h >= 0.8 * tallest.bbox.h && Math.abs(cy(b) - cy(tallest)) <= tallest.bbox.h / 2) : []);
    return {
      schemaVersion: 1, slideId: String(slideId).slice(0, 64), t0: time(t0), t1: time(t1), engine: "ppocr-v5", model,
      blocks: blocks.map((b, i) => ({ id: "b" + (i + 1), text: b.text, role: titles.has(b) ? "title" : "body", bbox: b.bbox, conf: b.conf, ink: null })),
      formulas: formulas.map((f, i) => ({ id: "f" + (i + 1), latex: null, text: f.text, bbox: f.bbox, conf: f.conf, status: "unverified" })),
      figures: [],
    };
  }

  if (typeof module !== "undefined") module.exports = { layoutText, localSlideDoc, isFormulaLine };
  if (typeof self !== "undefined") Object.assign(self, { layoutText, localSlideDoc });
})();
