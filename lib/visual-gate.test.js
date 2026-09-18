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
