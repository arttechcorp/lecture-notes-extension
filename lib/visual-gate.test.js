const test = require('node:test');
const assert = require('node:assert/strict');

let frame = 24;
class FakeOffscreenCanvas {
  constructor(width, height) { this.width = width; this.height = height; }
  getContext() {
    return {
      drawImage() {},
      getImageData: (_x, _y, width, height) => ({ data: new Uint8ClampedArray(width * height * 4).fill(frame) }),
    };
  }
}
global.OffscreenCanvas = FakeOffscreenCanvas;
const { VisualGate } = require('./visual-gate.js');

test('VisualGate does not re-submit an unchanged slide on a timer', () => {
  const gate = new VisualGate();
  const first = gate.inspect({}, 1000, true);
  assert.equal(first.accept, true);
  frame = 80;
  assert.equal(gate.inspect({}, 2000).accept, false, 'a frame cannot be submitted again while OCR is pending');
  gate.complete(first.sample);

  frame = 24;
  assert.equal(gate.inspect({}, 13000).accept, false);
  assert.equal(gate.inspect({}, 25000).accept, false);
});

test('VisualGate waits for a changed frame to settle before submitting it', () => {
  const gate = new VisualGate();
  const first = gate.inspect({}, 1000, true);
  gate.complete(first.sample);
  frame = 220;

  assert.equal(gate.inspect({}, 2000).accept, false, 'first changed sample starts the stability window');
  assert.equal(gate.inspect({}, 2601).accept, true, 'stable changed slide is admitted once');
  gate.complete(gate.submitted);
  assert.equal(gate.inspect({}, 20000).accept, false, 'the new slide is not submitted again');
});

test('vision mode submits once per slide, not once per stroke', () => {
  const gate = new VisualGate({ mode: 'vision', settleMs: 1200 });
  frame = 24;
  const first = gate.inspect({}, 1000, true);
  assert.equal(first.accept, true, '첫 장은 언제나 제출한다');
  gate.complete(first.sample);

  // 판서 한 줄: 타일은 변했지만 같은 슬라이드다.
  frame = 30;
  assert.equal(gate.inspect({}, 3000).accept, false, '같은 슬라이드의 변화는 호출을 만들지 않는다');

  // 슬라이드 전환: 화면 전체가 바뀐다.
  frame = 200;
  assert.equal(gate.inspect({}, 4000).accept, false, '전환 직후 움직이는 중에는 제출하지 않는다');
  const settled = gate.inspect({}, 4000 + 1300);
  assert.equal(settled.accept, true, '멎고 settleMs 가 지나면 제출한다');
  assert.equal(settled.slideId, first.slideId + 1);
});

test('default mode behaviour is unchanged', () => {
  const gate = new VisualGate();
  assert.equal(gate.mode, 'ocr');
  frame = 24;
  const first = gate.inspect({}, 1000, true);
  gate.complete(first.sample);
  frame = 90;
  gate.inspect({}, 2000);
  assert.equal(gate.inspect({}, 2700).accept, true, '기본 모드는 지금처럼 누적 변화만으로 제출한다');
});
