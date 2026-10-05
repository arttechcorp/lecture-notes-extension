const test = require('node:test');
const assert = require('node:assert/strict');

let frame = 24, pattern = null;
// pattern(u, v)가 있으면 요청 해상도의 각 픽셀(0~1 좌표)을 그 값(회색 또는 [r,g,b])으로 채운다. 없으면 균일한 frame.
class FakeOffscreenCanvas {
  constructor(width, height) { this.width = width; this.height = height; }
  getContext() {
    return {
      drawImage() {},
      getImageData: (_x, _y, width, height) => {
        const data = new Uint8ClampedArray(width * height * 4).fill(frame);
        if (pattern) for (let i = 0; i < width * height; i++) {
          const [r, g = r, b = r] = [].concat(pattern(((i % width) + .5) / width, (Math.floor(i / width) + .5) / height));
          data.set([r, g, b, 255], i * 4);
        }
        return { data };
      },
    };
  }
}
global.OffscreenCanvas = FakeOffscreenCanvas;
const { VisualGate, delta } = require('./visual-gate.js');

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

// --- 구조 있는 프레임: 흰 바탕 + 어두운 "글자" 블록 [x, y, w, h, 색] (0~1 좌표) ---
const slide = (...blocks) => (u, v) => {
  for (const [x, y, w, h, color = 40] of blocks) if (u >= x && u < x + w && v >= y && v < y + h) return color;
  return 235;
};
const A = [[.1, .15, .5, .04], [.1, .25, .6, .04], [.1, .35, .4, .04], [.1, .45, .55, .04]];
const B = [[.35, .15, .5, .04], [.35, .25, .5, .04], [.35, .35, .5, .04], [.35, .45, .5, .04]]; // 같은 영역, 다른 글
const INK = [[.65, .65, .25, .05, [220, 30, 30]], [.1, .7, .3, .04, [20, 20, 140]]]; // 빈 곳에 붉은/푸른 판서

const look = (gate, p, now, force) => { pattern = p; try { return gate.inspect({}, now, force); } finally { pattern = null; } };
// 화면을 p로 바꾸고 ms 동안 지켜본다. 제출된 프레임은 인식이 바로 끝난 것으로 보고 complete 한다.
function watch(gate, p, t, ms = 3000) {
  const accepted = [];
  for (let now = t; now <= t + ms; now += 700) {
    const r = look(gate, p, now);
    if (r.accept) { accepted.push(r); gate.complete(r.sample); }
  }
  return accepted;
}
const start = (mode, p) => {
  const gate = new VisualGate({ mode }), first = look(gate, p, 1000);
  gate.complete(first.sample);
  return { gate, first };
};

test('handwriting added over a slide is not a new slide', () => {
  const ocr = start('ocr', slide(...A)), added = watch(ocr.gate, slide(...A, ...INK), 10000);
  assert.equal(added.length, 1, 'OCR 모드는 판서 뒤 다시 캡처한다');
  assert.equal(added[0].slideId, ocr.first.slideId, '같은 슬라이드');

  const vision = start('vision', slide(...A));
  assert.equal(watch(vision.gate, slide(...A, ...INK), 10000).length, 0, '비전 모드는 판서로 제출하지 않는다');
});

test('erased handwriting is not a new slide', () => {
  const inked = slide(...A, ...INK), clean = slide(...A);
  const ocr = start('ocr', clean);
  watch(ocr.gate, inked, 10000);
  const erased = watch(ocr.gate, clean, 20000); // recognized 는 이제 판서 포함본이지만 기준은 처음 화면이다
  assert.equal(erased.length, 1);
  assert.equal(erased[0].slideId, ocr.first.slideId);

  const vision = start('vision', clean);
  assert.equal(watch(vision.gate, inked, 10000).length, 0);
  assert.equal(watch(vision.gate, clean, 20000).length, 0);
});

test('a slide whose text is replaced in the same layout is a new slide', () => {
  const ocr = start('ocr', slide(...A)), changed = watch(ocr.gate, slide(...B), 10000);
  assert.ok(delta(ocr.first.sample.low, changed[0].sample.low) < .32, '옛 규칙(64×36 변화율)으로는 전환이 안 잡히던 쌍');
  assert.equal(changed.length, 1);
  assert.equal(changed[0].slideId, ocr.first.slideId + 1);

  const vision = start('vision', slide(...A));
  const submitted = watch(vision.gate, slide(...B), 10000);
  assert.equal(submitted.length, 1, '멎은 뒤 한 번 제출한다');
  assert.equal(submitted[0].slideId, vision.first.slideId + 1);
  assert.equal(watch(vision.gate, slide(...B, ...INK), 20000).length, 0, '새 슬라이드 위 판서는 제출하지 않는다');
});

test('changing slides while handwriting is on the old one is a new slide', () => {
  for (const mode of ['ocr', 'vision']) {
    const { gate, first } = start(mode, slide(...A));
    watch(gate, slide(...A, ...INK), 10000);
    const changed = watch(gate, slide(...B), 20000); // 판서도, 앞 슬라이드 글도 사라진다
    assert.equal(changed.length, 1, mode);
    assert.equal(changed[0].slideId, first.slideId + 1, mode);
  }
});

test('content appearing on a near-blank base is a new slide, a tiny mark is not', () => {
  const blank = slide(), mark = slide([.45, .45, .05, .05]); // 흰 바탕 / 내용 칸 0.25%
  for (const mode of ['ocr', 'vision']) {
    const shown = start(mode, blank), changed = watch(shown.gate, slide(...A), 10000);
    assert.equal(changed.length, 1, mode);
    assert.equal(changed[0].slideId, shown.first.slideId + 1, mode);
  }
  const vision = start('vision', blank);
  assert.equal(watch(vision.gate, mark, 10000).length, 0, '작은 표시는 전환이 아니다');
  assert.equal(watch(vision.gate, slide(...A), 20000)[0].slideId, vision.first.slideId + 1, '그 뒤 글이 나타나면 전환이다');
  const ocr = start('ocr', blank);
  assert.ok(watch(ocr.gate, mark, 10000).every(r => r.slideId === ocr.first.slideId));
});

test('a reset starts a new slide, even if the picture is the same', () => {
  for (const mode of ['ocr', 'vision']) {
    const { gate, first } = start(mode, slide(...A));
    gate.reset();
    gate.reset(); // 프레임 없이 거듭 불러도 한 번만 올린다
    const again = look(gate, slide(...A), 10000);
    assert.equal(again.accept, true, mode);
    assert.equal(again.slideId, first.slideId + 1, mode);
  }
  const fresh = new VisualGate();
  fresh.reset();
  assert.equal(look(fresh, slide(...A), 1000).slideId, 0, '첫 슬라이드는 reset 이 있어도 0');
});
