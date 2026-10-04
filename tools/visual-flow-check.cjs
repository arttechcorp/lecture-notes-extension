#!/usr/bin/env node
// 2단계 검증기를 제품 경로(EvidenceStore 정규화 → preprocess → validate)로 재현한다. 모델 추론 없음.
// Production-shaped flow check: OCR text -> EvidenceStore (normalize) -> preprocess -> validateSummary.
const root = require("node:path").resolve(__dirname, "..");
const { EvidenceStore } = require(root + "/lib/evidence.js");
const { preprocessEvidence, validateSummary } = require(root + "/lib/summary.js");
const corpus = require(root + "/eval/visual/runs/local-baseline.json");

const plain = id => ({ content: "핵심 내용을 설명합니다.", importance: "important", evidenceIds: [id] });
const note = (id, patch = {}) => ({ title: "강의 노트", keyConclusions: [plain(id)], concepts: [], corrections: [], openQuestions: [],
  sections: [{ heading: "기본 내용", ...plain(id) }], formulas: [], visuals: [], reviewQuestions: [], ...patch });
const formula = (latex, id) => ({ latex, variables: "", units: "", conditions: "", explanation: "", importance: "important", evidenceIds: [id] });
const run = (label, fn) => { try { console.log(label, "=>", JSON.stringify(fn())); } catch (e) { console.log(label, "=> THROW", e.message); } };

console.log("## A. 실제 코퍼스 OCR을 제품 경로(EvidenceStore 정규화)로 통과시킨 뒤, 그림 속 글자를 그대로 옮긴 수식 후보");
for (const c of corpus.cases) {
  const store = new EvidenceStore();
  const item = store.add({ source: "ocr", t0: 0, t1: 1, text: c.layoutText, confidence: 0.9, slideId: 1 });
  if (!item) { console.log(c.caseId.padEnd(26), "(OCR 빈 결과 → 근거 없음)"); continue; }
  const entries = preprocessEvidence(store.snapshot());
  // verbatim copy of each OCR line containing "=" as a formula candidate
  const lines = c.text.split("\n").filter(l => l.includes("="));
  const out = validateSummary(note(item.id, { formulas: lines.map(l => formula(l, item.id)) }), entries);
  console.log(c.caseId.padEnd(26), "evidence:", JSON.stringify(item.text).slice(0, 70), "| 후보", lines.length, "→ 통과", out.formulas.length, "보류", out.held.formulas);
}

console.log("\n## B. 테스트의 '허용' 대조군이 실제 화면 모양이면?");
for (const [text, latex] of [["x=2", "x=2"], ["연립방정식 예제\nx=2", "x=2"], ["y = mx + b", "y=mx+b"], ["y =\nmx + b", "y=mx+b"]]) {
  const store = new EvidenceStore(); const item = store.add({ source: "ocr", t0: 0, t1: 1, text, slideId: 1 });
  const entries = preprocessEvidence(store.snapshot());
  const out = validateSummary(note(item.id, { formulas: [formula(latex, item.id)] }), entries);
  console.log(JSON.stringify(text).padEnd(22), "stored:", JSON.stringify(item.text).padEnd(26), "후보", latex, "→", out.formulas.length ? "허용" : "보류");
}

console.log("\n## C. OCR 오독을 그대로 옮기면 검증기는 통과시킨다 (그림 속 글자 = 정답이라는 가정)");
for (const [shown, ocr] of [["x = 1/2 (세로 분수)", "x = 12"], ["x = -2 (마이너스 누락)", "x = 2"], ["V = IR", "V = 1R"]]) {
  const store = new EvidenceStore(); const item = store.add({ source: "ocr", t0: 0, t1: 1, text: ocr, slideId: 1 });
  const out = validateSummary(note(item.id, { formulas: [formula(ocr.replace(/\s/g, ""), item.id)] }), preprocessEvidence(store.snapshot()));
  console.log(shown.padEnd(24), "OCR:", JSON.stringify(ocr).padEnd(10), "→", out.formulas.length ? "허용(오독 그대로 노트에 들어감)" : "보류");
}

console.log("\n## D. 실제 강의 문장에서 richStructure 오탐");
const ev = [{ id: "e1", source: "asr", text: "강의", t0: 0, t1: 1 }];
run("제목 'Graph theory 3강'      ", () => validateSummary({ ...note("e1"), title: "Graph theory 3강" }, ev).title);
run("결론 '|x| < 1 이면 수렴'      ", () => validateSummary(note("e1", { keyConclusions: [{ ...plain("e1"), content: "|x| < 1 이면 급수가 수렴" }] }), ev).keyConclusions.length);
run("결론 'Pie chart는 비율 비교'  ", () => validateSummary(note("e1", { keyConclusions: [{ ...plain("e1"), content: "Pie chart는 비율 비교에 적합" }] }), ev).keyConclusions.length);
run("섹션 '가격은 $5에서 $10로'    ", () => { const o = validateSummary(note("e1", { sections: [{ heading: "가격", ...plain("e1"), content: "가격은 $5에서 $10로 올랐다" }] }), ev); return { sections: o.sections.length, dropped: o.dropped }; });

console.log("\n## E. 2단계 이전 프롬프트로 만든 보관 노트(본문에 $..$ 필수였음) 복원");
const old = note("e1", { keyConclusions: [{ ...plain("e1"), content: "운동에너지 $\\frac{1}{2}mv^2$" }], sections: [{ heading: "에너지", ...plain("e1"), content: "$E=mc^2$ 유도" }] });
run("complete 노트 복원          ", () => validateSummary(old, ev, { requireCoverage: true, maxItems: 2000, maxSections: 2000, maxQuestions: 2000 }).keyConclusions.length);

console.log("\n## F. 비전(클라우드) 엔진 근거: 서버 프롬프트가 수식을 $..$, 그래프를 설명문으로 적게 함");
const vstore = new EvidenceStore();
const vitem = vstore.add({ source: "ocr", t0: 0, t1: 1, text: "근의 공식\n$$x=\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}$$\n그래프는 x축 시간, y축 전압의 사인파이며 주기는 2π이다.", slideId: 1 });
const ventries = preprocessEvidence(vstore.snapshot());
run("수식 후보 x=\\frac..        ", () => validateSummary(note(vitem.id, { formulas: [formula("x=\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}", vitem.id)] }), ventries).held);
run("결론이 근거의 $..$를 그대로 인용", () => validateSummary(note(vitem.id, { keyConclusions: [{ ...plain(vitem.id), content: "근의 공식 $x=\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}$" }] }), ventries).keyConclusions.length);
