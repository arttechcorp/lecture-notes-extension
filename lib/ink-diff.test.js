const test = require("node:test"), assert = require("node:assert/strict");
const { diff, coverage } = require("./ink-diff.js");

const W = 256, H = 144;
const arr = v => new Uint8Array(W * H).fill(v);
const stroke = (a, x0, y0, x1, y1, v = 200) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) a[y * W + x] = v; return a; };

test("identical frames produce an empty mask", () => {
  assert.deepEqual(diff(arr(30), arr(30)), { mask: [], area: 0 });
  assert.deepEqual(diff(arr(30), null), { mask: [], area: 0 });
});

test("a stroke between first and last frame becomes one normalized bbox", () => {
  const b = stroke(arr(30), 40, 20, 70, 40);
  const { mask, area } = diff(arr(30), b);
  assert.equal(mask.length, 1);
  const [m] = mask;
  // 패드(4px)를 더한 상자 — 필기 영역을 감싼다
  assert.ok(m.x <= 40 / W && m.y <= 20 / H && m.x + m.w >= 70 / W && m.y + m.h >= 40 / H, JSON.stringify(m));
  assert.ok(Math.abs(m.x - 36 / W) < 1e-9 && Math.abs(m.w - 38 / W) < 1e-9);
  assert.ok(area > 0.01 && area < 0.03, String(area));
});

test("strokes close together merge, far apart stay separate", () => {
  const b = arr(30);
  stroke(b, 40, 20, 70, 40); stroke(b, 74, 20, 100, 40); // 4px 간격 — 패드 4로 붙는다
  stroke(b, 40, 100, 70, 120);                            // 멀리 떨어진 획
  assert.equal(diff(arr(30), b).mask.length, 2);
});

test("excluded (live) tiles are ignored", () => {
  const a = arr(30), b = stroke(arr(30), 40, 20, 70, 40); // 타일 (1..2, 1..2) 에 걸친다
  const exclude = new Uint8Array(64); for (const t of [9, 10, 17, 18]) exclude[t] = 1;
  assert.equal(diff(a, b, { exclude }).mask.length, 0);
  assert.equal(diff(a, b).mask.length, 1, "제외하지 않으면 잡힌다");
});

test("tiny specks below minPx are dropped", () => {
  const b = stroke(arr(30), 10, 10, 12, 12); // 2×2 — 점·커서 자취 크기
  assert.equal(diff(arr(30), b).mask.length, 0);
  const c = stroke(arr(30), 10, 10, 40, 16); // 얇지만 긴 획은 남는다
  assert.equal(diff(arr(30), c).mask.length, 1);
});

test("coverage: overlapping blocks are marked ink; regions with no readable block are unread", () => {
  const mask = [{ x: 0, y: 0, w: 0.2, h: 0.2 }, { x: 0.5, y: 0.5, w: 0.2, h: 0.2 }];
  const blocks = [
    { id: "b1", text: "읽힌 필기", bbox: { x: 0.1, y: 0.1, w: 0.3, h: 0.3 }, conf: 0.9 },
    { id: "b2", text: "", bbox: { x: 0.55, y: 0.55, w: 0.1, h: 0.1 }, conf: null },
    { id: "b3", text: "안 겹치는 블록", bbox: { x: 0.8, y: 0.8, w: 0.1, h: 0.1 }, conf: 0.9 },
  ];
  const cov = coverage(mask, blocks);
  assert.deepEqual([...cov.blockIds].sort(), ["b1", "b2"]);
  assert.equal(cov.regions[0].unread, false, "텍스트가 읽힌 블록과 겹치는 영역");
  assert.equal(cov.regions[1].unread, true, "겹치는 블록이 텍스트를 못 읽은 영역");
});

test("coverage: a low-confidence read still counts as unread", () => {
  const mask = [{ x: 0, y: 0, w: 0.2, h: 0.2 }];
  const blocks = [{ id: "b1", text: "흐린 판독", bbox: { x: 0, y: 0, w: 0.3, h: 0.3 }, conf: 0.2 }];
  assert.equal(coverage(mask, blocks).regions[0].unread, true);
  assert.equal(coverage(mask, blocks, { minConf: 0.1 }).regions[0].unread, false);
});

test("coverage: 마스크가 블록의 maxShare 초과를 덮으면 dominant — 호출자가 표식을 억제한다", () => {
  const mask = [{ x: 0, y: 0, w: 1, h: 1 }]; // 슬라이드 전체가 바뀐 경우(전환·애니메이션·대면적 낙서)
  const blocks = [
    { id: "b1", text: "a", bbox: { x: 0, y: 0, w: 0.3, h: 0.3 }, conf: 0.9 },
    { id: "b2", text: "b", bbox: { x: 0.5, y: 0.3, w: 0.3, h: 0.3 }, conf: 0.9 },
    { id: "b3", text: "c", bbox: { x: 0.6, y: 0.7, w: 0.3, h: 0.2 }, conf: 0.9 },
  ];
  const cov = coverage(mask, blocks, { maxShare: 0.4 });
  assert.equal(cov.dominant, true, "3/3 블록이 필기 판정이면 변별력이 없다");
  assert.deepEqual([...cov.blockIds].sort(), ["b1", "b2", "b3"], "겹침 사실은 그대로 보고 — 억제 결정은 호출자");
  const cov2 = coverage(mask, [blocks[0], blocks[1], { id: "b9", text: "d", bbox: { x: 1, y: 1, w: 0.01, h: 0.01 }, conf: 0.9 }, ...Array.from({ length: 4 }, (_, i) => ({ id: "z" + i, text: "z", bbox: { x: 1, y: 1, w: 0.01, h: 0.01 }, conf: 0.9 }))], { maxShare: 0.4 });
  assert.equal(cov2.dominant, false, "블록 6중 2 겹침(33%)은 변별 가능 — dominant 아님");
});
