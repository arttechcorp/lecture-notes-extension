const C = require("./probe-common.js");
const nl = (a, y) => ({ text: a, box: { x: 100, y, width: 400, height: 30 }, confidence: 0.9 });
const lines = ["문턱 전압 이하에서는 소자가 차단 영역에 머물러 전류가 거의 흐르지 않는다", "게이트 전압이 문턱 전압을 넘으면 채널이 형성되어 선형 영역으로 들어간다", "선형 영역에서는 드레인 전압에 비례하여 전류가 증가하므로 저항처럼 동작한다", "드레인 전압이 충분히 커지면 채널이 핀치오프되어 포화 영역으로 진입한다", "포화 영역에서는 드레인 전압이 변해도 전류가 거의 일정하게 유지된다"];
const slide = C.localSlideDoc(lines.map((t, i) => nl(t, 40 + i * 60)), 1280, 720, { slideId: "s1", t0: 0, t1: 60 });
const r = C.refine([slide], [], "free");
const copy = slide.blocks.map(b => b.text).join(" ");
console.log("claim length", copy.length, "; evidence item lengths", r.evidence.map(e => e.text.length).join(","));
const plan = C.plan1("t", null, ["U1"]);
const out = { gist: null, checks: [], blocks: { S1_B1: { status: "supported", importance: "core", emphasis: [], content: { conceptId: "C1", term: "t", original: null, definition: { text: copy.slice(0, 600), evidenceIds: ["U1.s1"], basis: "lecture" }, explanation: null, mechanism: null, scope: [], examples: [] } } } };
const a = C.assemble({ r, tier: "free", plan, outputs: out });
console.log("per-line evidence (production shape): errors =", JSON.stringify(a.check.blocks[0].errors));
// joined-frame evidence (shape of old tests / EvidenceStore.add normalize)
const joined = { ...r, evidence: [{ ...r.evidence[0], text: copy }, ...r.evidence.slice(1)] };
const b = C.assemble({ r: joined, tier: "free", plan, outputs: out });
console.log("ONE joined evidence line (test-like shape):           errors =", JSON.stringify(b.check.blocks[0].errors));
// also the full-frame text, produced exactly as session.js does (layoutText + EvidenceStore.add normalize)
const { EvidenceStore } = require("./lib/evidence.js"); const { layoutText } = require("./lib/layout.js");
const t = layoutText(lines.map((tx, i) => ({ text: tx, box: { x: 100, y: 40 + i * 60, width: 400, height: 30 } })), 1280, 720);
const st = new EvidenceStore(); const it = st.add({ source: "ocr", time: 0, text: t, slideId: "s1" });
console.log("EvidenceStore item text has newline?", /\n/.test(it.text), " lines in = ", lines.length, " items stored = ", st.items.length, "  first 70:", it.text.slice(0, 70));
