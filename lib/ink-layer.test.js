const test = require('node:test');
const assert = require('node:assert/strict');
const { InkLayer } = require('./ink-layer.js');

const W = 200, H = 120;
// 배경 + 어두운 "인쇄 글자" 블록 [x, y, w, h, 색]
const frame = (bg, blocks = []) => {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) data.set([...bg, 255], i * 4);
  for (const [x0, y0, w, h, color] of blocks) for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) data.set([...color, 255], (y * W + x) * 4);
  return { data, width: W, height: H };
};
const at = (img, x, y) => [...img.data.slice((y * W + x) * 4, (y * W + x) * 4 + 3)];
const WHITE = [240, 240, 240], TEXT = [30, 30, 30], RED = [220, 30, 30];
const PRINTED = [[10, 10, 120, 8, TEXT], [10, 40, 90, 8, TEXT], [10, 70, 100, 8, TEXT]];
const noisy = (img, seed = 1) => { // 영상 압축 같은 ±10 잡음
  let s = seed; const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  const data = img.data.map((v, i) => i % 4 === 3 ? v : v + Math.round((rnd() - .5) * 20));
  return { ...img, data };
};

test('identical frames and compression-like noise give no ink layer', () => {
  const base = frame(WHITE, PRINTED);
  assert.equal(InkLayer.inkOnly(base, frame(WHITE, PRINTED)), null);
  assert.equal(InkLayer.inkOnly(base, noisy(base)), null);
});

test('a red stroke is kept and the printed text and background are not', () => {
  const base = frame(WHITE, PRINTED), current = frame(WHITE, [...PRINTED, [20, 100, 100, 5, RED]]);
  const ink = InkLayer.inkOnly(noisy(base, 1), noisy(current, 2));
  assert.ok(ink && ink.cells >= 4);
  assert.equal(ink.width, W); assert.equal(ink.height, H);
  assert.deepEqual(at(ink, 60, 102), at(noisy(current, 2), 60, 102), '획 픽셀은 현재 화면 그대로');
  assert.ok(at(ink, 60, 102)[0] > 180 && at(ink, 60, 102)[1] < 80);
  assert.ok(at(ink, 50, 12).every(v => v > 220), '인쇄 글자는 없고 바탕색');
  assert.ok(at(ink, 150, 60).every(v => v > 220));
});

test('a black stroke crossing printed text is detected where it adds ink', () => {
  const base = frame(WHITE, PRINTED), current = frame(WHITE, [...PRINTED, [60, 30, 6, 40, [0, 0, 0]]]); // 인쇄 글줄 사이의 빈 곳을 지나는 검은 세로선
  const ink = InkLayer.inkOnly(base, current);
  assert.ok(ink);
  assert.deepEqual(at(ink, 62, 55), [0, 0, 0]);
  assert.ok(at(ink, 20, 12).every(v => v > 220), '떨어진 인쇄 글자는 빠진다');
});

test('light ink on a dark slide keeps a dark background', () => {
  const DARK = [20, 24, 40], base = frame(DARK, [[10, 10, 120, 8, [200, 200, 200]]]);
  const ink = InkLayer.inkOnly(base, frame(DARK, [[10, 10, 120, 8, [200, 200, 200]], [20, 90, 100, 5, [255, 240, 60]]]));
  assert.ok(ink);
  assert.deepEqual(at(ink, 100, 60), DARK, '바탕은 기준 화면의 바탕색(어둡다)');
  assert.deepEqual(at(ink, 60, 92), [255, 240, 60]);
});

test('size mismatch and tiny specks give no ink layer', () => {
  const base = frame(WHITE, PRINTED);
  assert.equal(InkLayer.inkOnly(base, { data: new Uint8ClampedArray(100 * 60 * 4), width: 100, height: 60 }), null);
  assert.equal(InkLayer.inkOnly(base, frame(WHITE, [...PRINTED, [150, 90, 3, 3, RED]])), null, '4칸 미만 덩어리는 버린다');
});
