const C = require("./probe-common.js");
const NC = C.NoteContract;
const at = (text, x, y, w, h) => ({ text, box: { x, y, width: w, height: h }, confidence: 0.97 });
const slide = C.localSlideDoc([at("Graph theory 3강", 100, 40, 600, 60), at("|x| < 1 이면 수렴", 100, 200, 500, 30), at("가격은 $5에서 $10로", 100, 320, 500, 30)], 1280, 720, { slideId: "s1", t0: 0, t1: 30 });
const r = C.refine([slide], [{ id: "a1", t0: 1, t1: 8, text: "그래프 이론 시간입니다", words: [], status: "kept" }], "free");
const mkPlanner = (title, question, cname = "개념") => ({
  concepts: [{ conceptId: "C1", name: cname, homeSectionId: "S1", depth: "defined" }],
  sections: [{ sectionId: "S1", title, question, stage: "understand", unitIds: ["U1"], crossUnitIds: [], blocks: [{ type: "B05", purpose: "p", conceptIds: ["C1"], formulaIds: [], figureIds: [] }] }],
  global: [],
});
const scope = { units: r.ir.units, formulaUnits: r.formulaUnits, figures: r.figures };
for (const [title, q, cname] of [
  ["Graph theory 3강", null, "개념"],
  ["Graph theory 13강", null, "개념"],
  ["Graph theory 13강 (2024학년도)", "|x| < 10 이면 수렴하는가", "개념"],
  ["Pie chart는 비율 비교에 적합", "가격은 $5에서 $10로 바뀌었나", "개념"],
  ["가격은 $5에서 $15로", null, "개념"],           // 15 not in evidence
  ["제3장 그래프", null, "2차 함수"],
  ["Q3 매출 분석", null, "ISO 9001"],              // 4-digit number in a concept name; not in evidence
]) {
  const out = mkPlanner(title, q, cname);
  const { output, fixes } = NC.repairPlan(out, scope);
  const n = NC.normalizePlan(output, { ...scope, policy: {} });
  console.log(`title=${JSON.stringify(title)} q=${JSON.stringify(q)} cname=${JSON.stringify(cname)}\n   -> repaired title=${JSON.stringify(output.sections[0]?.title)} q=${JSON.stringify(output.sections[0]?.question)} concept=${JSON.stringify(output.concepts[0]?.name)} fixes=${JSON.stringify(fixes)} normalize.ok=${n.ok}`);
}
