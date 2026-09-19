const test = require("node:test");
const assert = require("node:assert/strict");
const { FrameBox } = require("./frame-box.js");

// compose: 최상위 뷰포트 기준 좌표 합성 및 원본 불변성 검증
test("compose combines nested viewport coordinates and preserves inputs", () => {
  const outer = { x: 0, y: 0, w: 1, h: 1 };
  const inner = { x: 0.2, y: 0.3, w: 0.4, h: 0.5 };
  assert.deepEqual(FrameBox.compose(outer, inner), { x: 0.2, y: 0.3, w: 0.4, h: 0.5 });

  const o = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 };
  const i = { x: 0.5, y: 0, w: 0.5, h: 1 };
  const composed = FrameBox.compose(o, i);
  assert.deepEqual(composed, { x: 0.5, y: 0.25, w: 0.25, h: 0.5 });

  // 원본 객체 변형 금지
  assert.deepEqual(o, { x: 0.25, y: 0.25, w: 0.5, h: 0.5 });
  assert.deepEqual(i, { x: 0.5, y: 0, w: 0.5, h: 1 });
  assert.notEqual(composed, o);
  assert.notEqual(composed, i);
});

// valid / inViewport: 유효하지 않은 상자 배제 및 뷰포트 경계/엡실론 허용 검증
test("valid and inViewport reject invalid boxes and apply edge epsilon", () => {
  // NaN, undefined, zero-size 및 음수 크기 배제
  assert.equal(FrameBox.valid(undefined), false);
  assert.equal(FrameBox.valid(null), false);
  assert.equal(FrameBox.valid({ x: NaN, y: 0, w: 1, h: 1 }), false);
  assert.equal(FrameBox.valid({ x: 0, y: 0, w: 0, h: 1 }), false);
  assert.equal(FrameBox.valid({ x: 0, y: 0, w: 1, h: -0.1 }), false);
  assert.equal(FrameBox.inViewport(null), false);
  assert.equal(FrameBox.inViewport({ x: NaN, y: 0, w: 1, h: 1 }), false);
  assert.equal(FrameBox.inViewport({ x: 0, y: 0, w: 0, h: 1 }), false);

  // 정상 크기 및 뷰포트 내 수용
  assert.equal(FrameBox.valid({ x: 0, y: 0, w: 1, h: 1 }), true);
  assert.equal(FrameBox.inViewport({ x: 0, y: 0, w: 1, h: 1 }), true);
  assert.equal(FrameBox.inViewport({ x: 0.1, y: 0.2, w: 0.5, h: 0.5 }), true);

  // 음수 x/y는 뷰포트 벗어남으로 판단
  assert.equal(FrameBox.inViewport({ x: -0.01, y: 0, w: 0.5, h: 0.5 }), false);
  assert.equal(FrameBox.inViewport({ x: 0, y: -0.001, w: 0.5, h: 0.5 }), false);

  // 엡실론 허용 오차 (기본 eps=0.01)
  assert.equal(FrameBox.inViewport({ x: 0.005, y: 0, w: 1.0, h: 1.0 }), true); // x+w = 1.005 <= 1.01
  assert.equal(FrameBox.inViewport({ x: 0, y: 0, w: 1.005, h: 1.0 }), true);
  assert.equal(FrameBox.inViewport({ x: 0, y: 0, w: 1.02, h: 1.0 }), false); // x+w = 1.02 > 1.01
  assert.equal(FrameBox.inViewport({ x: 0, y: 0.02, w: 1.0, h: 1.0 }), false);

  // 커스텀 eps 지정
  assert.equal(FrameBox.inViewport({ x: 0, y: 0, w: 1.02, h: 1.0 }, 0.03), true);
});

// fitAspect: 종횡비(contain)에 따른 레터박스 보정 및 중심 정렬
test("fitAspect corrects letterbox aspect ratio and centers", () => {
  // 너비가 더 넓은 경우: w 축소 및 가로 중앙 정렬
  const wide = { x: 0, y: 0, w: 200, h: 100 };
  assert.deepEqual(FrameBox.fitAspect(wide, 1), { x: 50, y: 0, w: 100, h: 100 });

  // 높이가 더 높은 경우: h 축소 및 세로 중앙 정렬
  const tall = { x: 10, y: 20, w: 100, h: 200 };
  assert.deepEqual(FrameBox.fitAspect(tall, 1), { x: 10, y: 70, w: 100, h: 100 });

  // 16:9 종횡비 보정
  const video16x9 = { x: 0, y: 0, w: 1920, h: 1200 };
  assert.deepEqual(FrameBox.fitAspect(video16x9, 16 / 9), { x: 0, y: 60, w: 1920, h: 1080 });

  // 유효하지 않은 종횡비는 동일한 새 사각형 반환
  const rect = { x: 5, y: 10, w: 80, h: 60 };
  const resNaN = FrameBox.fitAspect(rect, NaN);
  assert.deepEqual(resNaN, rect);
  assert.notEqual(resNaN, rect);
  assert.deepEqual(FrameBox.fitAspect(rect, 0), rect);
  assert.deepEqual(FrameBox.fitAspect(rect, -1), rect);
  assert.deepEqual(FrameBox.fitAspect(rect, Infinity), rect);
});

// meanBrightness / isBlack: RGBA 픽셀 데이터의 평균 밝기 계산 및 검은 화면 감지
test("meanBrightness and isBlack measure RGBA brightness correctly", () => {
  // 올 블랙 버퍼
  const black = new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 255]);
  assert.equal(FrameBox.meanBrightness(black, 2), 0);
  assert.equal(FrameBox.isBlack(black, 2), true);

  // 중간 회색 (~128)
  const gray = new Uint8ClampedArray([128, 128, 128, 255, 128, 128, 128, 255]);
  assert.equal(FrameBox.meanBrightness(gray, 2), 128);
  assert.equal(FrameBox.isBlack(gray, 2), false);

  // 작은 픽셀 픽스처
  // 픽셀 1: (10, 20, 30), 픽셀 2: (40, 50, 60) -> 합: 210, 2*3=6 -> 35
  const sample = new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 255]);
  assert.equal(FrameBox.meanBrightness(sample, 2), 35);
  assert.equal(FrameBox.isBlack(sample, 2, 40), true);
  assert.equal(FrameBox.isBlack(sample, 2, 30), false);

  // 기본 임계값(threshold=2) 경계
  const dim1 = new Uint8ClampedArray([1, 1, 1, 255]);
  assert.equal(FrameBox.meanBrightness(dim1, 1), 1);
  assert.equal(FrameBox.isBlack(dim1, 1), true);

  const dim3 = new Uint8ClampedArray([3, 3, 3, 255]);
  assert.equal(FrameBox.meanBrightness(dim3, 1), 3);
  assert.equal(FrameBox.isBlack(dim3, 1), false);

  // 데이터 없음 또는 픽셀 0
  assert.equal(FrameBox.meanBrightness(new Uint8ClampedArray(0), 0), 0);
});
