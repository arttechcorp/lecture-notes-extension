const C = require("./probe-common.js");
const nl = (a, y, h = 30) => ({ text: a, box: { x: 100, y, width: 600, height: h }, confidence: 0.95 });
const bullets = ["문턱 전압 이하에서는 소자가 차단 영역에 머문다", "게이트 전압이 높아지면 채널이 형성된다", "선형 영역에서는 저항처럼 동작한다", "포화 영역에서는 전류가 일정하게 유지된다"];
// progressive build: capture k shows title + first k bullets (typical "점진 판서" / click-to-reveal)
const caps = [];
for (let k = 1; k <= 4; k++) caps.push(C.localSlideDoc([nl("MOSFET 동작 영역", 40, 60), ...bullets.slice(0, k).map((b, i) => nl(b, 200 + i * 60))], 1280, 720, { slideId: "p" + k, t0: k * 10, t1: k * 10 + 9 }));
caps.push(C.localSlideDoc([nl("채널 길이 변조", 40, 60), nl("출력 저항이 유한해지는 현상이다", 200)], 1280, 720, { slideId: "q1", t0: 50, t1: 59 }));
caps.push(C.localSlideDoc([nl("정리", 40, 60), nl("세 영역을 구분해서 기억한다", 200)], 1280, 720, { slideId: "q2", t0: 60, t1: 69 }));
const bp = C.Boilerplate.detect(caps);
for (const s of bp.slides) console.log(s.slideId, s.blocks.map(b => (b.selection === "filtered" ? "[X " + b.selectionReason + "] " : "[ok] ") + b.text.slice(0, 18)).join(" | "));
const r = C.refine(caps, [], "free");
console.log("\nunits:", r.ir.units.map(u => u.unitId + ":" + JSON.stringify(u.slideText.slice(0, 80))));
console.log("\n-- fix check: merge progressive captures BEFORE document-frequency detection");
const merged = C.Preprocess.mergeProgressive(caps);
const bp2 = C.Boilerplate.detect(merged);
for (const s of bp2.slides) console.log(s.slideId, s.blocks.map(b => (b.selection === "filtered" ? "[X] " : "[ok] ") + b.text.slice(0, 14)).join(" | "));
// how does the threshold scale: lecture with N captures, a k-step progressive build
for (const N of [6, 10, 20, 40]) {
  const need = Math.max(3, Math.ceil(0.3 * N));
  console.log(`N=${N} captures -> a line is dropped once it appears in >= ${need} captures (i.e. a build of >= ${need} steps drops its early bullets)`);
}
