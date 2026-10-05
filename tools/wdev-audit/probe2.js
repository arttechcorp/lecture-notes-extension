const C = require("./probe-common.js");
const { Formulas: F, Verify: V, katex } = C;
const nl = (a, y) => ({ text: a, box: { x: 100, y, width: 400, height: 30 }, confidence: 0.9 });

console.log("=== A. FREE path: PP-OCR lines -> localSlideDoc (production fn) -> registry/verify");
const ocrLines = ["ax2 + bx + c = 0", "x = −b±√62-4ac 2a", "VGs = 2 V", "VrHlµ,", "Vps", "x = 2", "12", "E = 12 mv2", "Vgs = Vg - Vs"];
const doc = C.localSlideDoc(ocrLines.map((t, i) => nl(t, 40 + i * 50)), 1280, 720, { slideId: "s1", t0: 0, t1: 30 });
console.log("blocks (-> evidence):", doc.blocks.map(b => b.text));
console.log("formulas (-> registry):", doc.formulas.map(f => ({ id: f.id, latex: f.latex, text: f.text, status: f.status })));
const r = C.refine([doc], [], "free");
console.log("registry after Formulas.verify:", r.registry.map(e => `${e.id}:${e.status} latex=${e.latex} text=${JSON.stringify(e.text)}`));
// final display (assembleNote -> displayOf) with no crops (Free passes no formulaCrops)
const NC = C.NoteContract;
console.log("displayOf (no crop):", r.registry.map(e => `${e.id}=${NC.displayOf("formula", e, false)}`).join(" "));
// Even if LLM writes {{F1}} in a claim, render shows:
const plan = C.plan1("t", null, ["U1"]);
const out = { gist: null, checks: [], blocks: { S1_B1: C.b05("이차식", "이차식은 {{F1}} 꼴이다", ["U1.s1"]) } };
const evOnly = r.evidence;
const { check, note } = C.assemble({ r, plan, outputs: out });
console.log("claim with {{F1}} errors:", JSON.stringify(check.blocks[0].errors), " registry in note:", JSON.stringify(note.registry.map(e => ({ id: e.id, display: e.display, status: e.status }))));
const html = C.render(note, {}).html; console.log("render {{F1}} ->", (html.match(/<p class="definition">.*?<\/p>/s) || [])[0]);

console.log("\n=== B. PAID/cloud path: Formulas.verify(entry{latex,text}) as stages.js calls it (reread:true)");
const cases = [
  ["correct latex, OCR ok               ", "ax^2+bx+c=0", "ax2 + bx + c = 0"],
  ["WRONG exponent ^3 (digit differs)   ", "ax^3+bx+c=0", "ax2 + bx + c = 0"],
  ["WRONG sign (+c -> -c), same digits  ", "ax^2+bx-c=0", "ax2 + bx + c = 0"],
  ["WRONG variables (y,z), same digits  ", "ay^2+bz+c=0", "ax2 + bx + c = 0"],
  ["quadratic CORRECT latex vs 62 misread", "x=\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}", "x = −b±√62-4ac 2a"],
  ["quadratic WRONG (lost -b, +4ac) ok digits", "x=\\frac{b\\pm\\sqrt{b^2+4ac}}{2a}", "x = −b±√b2-4ac 2a"],
  ["subscript lost: latex V_{DS} vs 'VGs'", "V_{DS}", "VGs"],
  ["subscript: latex V_{GS}=2V vs 'VGs = 2 V'", "V_{GS}=2V", "VGs = 2 V"],
  ["stacked fraction CORRECT vs '12 mv2'  ", "\\frac{1}{2}mv^2", "12 mv2"],
  ["stacked fraction WRONG '12mv^2' vs '12 mv2'", "12mv^2", "12 mv2"],
  ["minus lost: latex x=-2 vs 'x = 2'     ", "x=-2", "x = 2"],
  ["minus lost: latex x=2 vs 'x = -2'     ", "x=2", "x = -2"],
  ["digit-free: latex 'a+b=c' vs 'x-y=z'  ", "a+b=c", "x-y=z"],
  ["no text (vision gave latex only)      ", "a+b=c", null],
];
for (const [label, latex, text] of cases) {
  const e = F.verify({ id: "F1", latex, text }, { katex, reread: true });
  const cc = F.crossCheck(latex, text);
  console.log(`${label} -> status=${e.status.padEnd(10)} display=${NC.displayOf("formula", e, false).padEnd(5)} crossCheck=${JSON.stringify(cc)}`);
}

console.log("\n=== C. G3 number-preservation (Verify.numbersOf) on OCR-misread strings");
for (const s of ["ax2 + bx + c = 0", "ax² + bx + c = 0", "x = −b±√62-4ac 2a", "b²-4ac", "x = 2", "x = -2", "1/2", "12", "1/2 mv²", "12 mv²", "VGs = 5 V", "V_GS = 5 V", "VrHlµ,"]) {
  console.log(JSON.stringify(s).padEnd(26), "-> claim-side numbers:", JSON.stringify(V.numbersOf(s).map(n => n.raw)), " evidence-side:", JSON.stringify(V.numbersOf(s, true).map(n => n.raw)));
}
console.log("\n-- end-to-end: evidence has the misread; does a claim that carries it (or 'fixes' it) pass G3?");
const slide2 = C.localSlideDoc([nl("판별식 D = 62-4ac 이다", 40), nl("해는 x = 2 이다", 100), nl("운동에너지 12 mv2", 160), nl("VGs 문턱 전압", 220)], 1280, 720, { slideId: "s1", t0: 0, t1: 30 });
const r2 = C.refine([slide2], [], "free");
console.log("evidence:", r2.evidence.map(e => e.id + " " + e.text));
const trial = (label, text, ids) => {
  const out = { gist: null, checks: [], blocks: { S1_B1: C.b05("t", text, ids) } };
  const { check } = C.assemble({ r: r2, plan: C.plan1("t", null, ["U1"]), outputs: out });
  console.log(label.padEnd(58), "->", JSON.stringify(check.blocks[0].errors));
};
trial("carries misread: '판별식은 62-4ac 이다'", "판별식은 62-4ac 이다", ["U1.s1"]);
trial("'fixes' it:      '판별식은 b²-4ac 이다'", "판별식은 b²-4ac 이다", ["U1.s1"]);
trial("sign dropped by OCR: claim 'x = -2' vs evidence 'x = 2'", "해는 x = -2 이다", ["U1.s2"]);
trial("claim 'x = 2' (as OCR'd)", "해는 x = 2 이다", ["U1.s2"]);
trial("stacked: claim '1/2 mv²' vs evidence '12 mv2'", "운동에너지는 1/2 mv² 이다", ["U1.s3"]);
trial("stacked: claim '12 mv²' (carries OCR misread)", "운동에너지는 12 mv² 이다", ["U1.s3"]);
trial("stacked: claim '12분의 mv²' (invented 12 present)", "운동에너지는 12 mv2 이다", ["U1.s3"]);
trial("multi-digit not in evidence: claim 'b²는 64'", "판별식은 64-4ac 이다", ["U1.s1"]);
