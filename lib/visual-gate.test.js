const test = require('node:test');
const assert = require('node:assert/strict');

let frame = 24; // 숫자면 단색, 함수면 (u,v) => 명암 — u,v는 0..1 비율 좌표라 게이트의 8×8 타일 경계는 1/8 단위다
class FakeOffscreenCanvas {
  constructor(width, height) { this.width = width; this.height = height; }
  getContext() {
    return {
      drawImage() {},
      getImageData: (_x, _y, width, height) => {
        const data = new Uint8ClampedArray(width * height * 4);
        for (let i = 0; i < width * height; i++) data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = typeof frame === 'function' ? frame((i % width) / width, Math.floor(i / width) / height) : frame;
        return { data };
      },
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
  const gate = new VisualGate({ mode: 'vision', minGapMs: 0 }); // minGap 기본값(8초)은 이 시험의 4.3초 간격 재수락을 막으므로 끈다
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
  assert.equal(settled.accept, true, '멎은 표본이 오면 제출한다');
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

test('vision mode accepts a slide change in only part of the frame, once each', () => {
  const gate = new VisualGate({ mode: 'vision', minGapMs: 0 });
  const slide = text => { frame = (u, v) => (u < .5 && v < .5 ? text : 30); }; // 본문 4×4 타일(화면의 25%)만 바뀐다
  slide(200);
  const first = gate.inspect({}, 0, true);
  assert.equal(first.accept, true);
  gate.complete(first.sample);

  slide(90);
  assert.equal(gate.inspect({}, 2000).accept, false, '전환 직후 표본은 아직 바뀌는 중이다');
  const second = gate.inspect({}, 4000);
  assert.equal(second.accept, true, '다음 표본이 멎어 있으면 제출한다');
  assert.equal(second.slideId, first.slideId + 1);
  gate.complete(second.sample);
  assert.equal(gate.inspect({}, 6000).accept, false, '같은 슬라이드는 다시 보내지 않는다');

  slide(160);
  assert.equal(gate.inspect({}, 8000).accept, false);
  assert.equal(gate.inspect({}, 10000).accept, true, '다음 전환도 멎은 표본에서 한 번 제출한다');
});

test('vision mode: a webcam inset that moves every sample neither submits nor blocks a slide change', () => {
  const gate = new VisualGate({ mode: 'vision', minGapMs: 0 });
  let cam = 40;
  const slide = text => { frame = (u, v) => (u >= .75 && v >= .75 ? cam : u < .5 && v < .5 ? text : 30); }; // 오른쪽 아래 2×2 타일 = 웹캠
  const flip = () => { cam = cam === 40 ? 200 : 40; };
  slide(200);
  gate.complete(gate.inspect({}, 0, true).sample);
  for (let i = 1; i <= 5; i++) { flip(); assert.equal(gate.inspect({}, i * 2000).accept, false, '웹캠만 바뀐 표본은 제출하지 않는다'); }
  slide(90);
  flip(); assert.equal(gate.inspect({}, 12000).accept, false, '본문이 방금 바뀐 표본은 멎지 않았다');
  flip();
  const next = gate.inspect({}, 14000);
  assert.equal(next.accept, true, '웹캠 타일을 빼면 슬라이드는 멎어 있어 제출한다');
  assert.equal(next.slideId, 2);
});

test('vision mode: a frame that changes everywhere is bounded by minGapMs', () => {
  const gate = new VisualGate({ mode: 'vision', minGapMs: 8000 });
  let v = 30;
  frame = () => v;
  gate.complete(gate.inspect({}, 0, true).sample);
  let accepts = 0;
  for (let i = 1; i <= 20; i++) { v = v === 30 ? 200 : 30; if (gate.inspect({}, i * 2000).accept) { accepts++; gate.complete(gate.submitted); } }
  assert.ok(accepts <= 40000 / 8000, `표본 20장(40초) 동안 ${accepts}번 제출`);
});

// ── mis-sol-hai "직전 프레임" 모드(옵션으로만 켠다) ──
test('vision lastFrame mode holds the last still frame and submits it when the next slide is confirmed', () => {
  const gate = new VisualGate({ mode: 'vision', lastFrame: true, minGapMs: 0 });
  frame = 24;
  const first = gate.inspect({}, 0, false, 't0');
  assert.equal(first.accept, false, '첫 프레임은 제출하지 않고 후보가 된다');
  assert.equal(first.entered.slideId, 0, '첫 슬라이드 시작을 알린다');
  assert.equal(first.candidateTag, 't0');
  // 판서 한 줄(한 타일): 같은 슬라이드 — 후보를 갱신한다
  frame = (u, v) => (u < 1 / 8 && v < 1 / 8 ? 200 : 24);
  const still = gate.inspect({}, 2000, false, 't2');
  assert.equal(still.accept, false);
  assert.equal(still.candidateTag, 't2', '정지할 때마다 후보를 갱신한다');
  // 전환: 첫 표본은 이전 프레임과 달라 아직 멎지 않았고, 다음 표본에서 확정된다
  frame = 200;
  assert.equal(gate.inspect({}, 4000, false, 't4').accept, false, '전환 첫 표본은 움직이는 중이다');
  const c = gate.inspect({}, 6000, false, 't6');
  assert.equal(c.accept, true);
  assert.equal(c.tag, 't2', '제출된 것은 전환 직전의 정지 후보다');
  assert.equal(c.slideId, 0, '제출된 슬라이드의 번호');
  assert.equal(c.sample.high[0], 200, '후보 표본에는 판서가 들어 있다');
  assert.equal(c.entered.slideId, 1);
  assert.equal(c.entered.tag, 't6', '새 슬라이드의 첫 정지 표본');
  assert.equal(c.candidateTag, 't6', '새 후보는 전환을 확정한 프레임이다');
  gate.complete(c.sample);
  // 멎은 새 슬라이드는 다시 제출되지 않는다
  assert.equal(gate.inspect({}, 8000, false, 't8').accept, false);
});

test('vision lastFrame mode: t0ms is the submitted slide start, and the candidate survives mid-transition noise', () => {
  const gate = new VisualGate({ mode: 'vision', lastFrame: true, minGapMs: 0 });
  frame = 24;
  gate.inspect({}, 10000, false, 'a');
  gate.inspect({}, 12000, false, 'b');
  frame = 120;
  gate.inspect({}, 14000, false, 'x'); // 전환 첫 표본 — changedAt
  frame = 200;
  gate.inspect({}, 15000, false, 'y'); // 여전히 전환 중(움직이는 중간 프레임)
  const c = gate.inspect({}, 16000, false, 'z'); // 멎음 → 확정
  assert.equal(c.accept, true);
  assert.equal(c.tag, 'b');
  assert.equal(c.t0ms, 10000, '제출된 슬라이드가 처음 뜬 시각');
  assert.equal(c.entered.t0ms, 14000, '새 슬라이드는 전환이 시작된 시각에 뜬다');
  gate.complete(c.sample);
  assert.equal(gate.inspect({}, 18000, false, 'w').accept, false);
});

test('vision lastFrame mode: flush submits the pending candidate at video end, once', () => {
  const gate = new VisualGate({ mode: 'vision', lastFrame: true });
  frame = 24;
  gate.inspect({}, 0, false, 'a');
  gate.inspect({}, 2000, false, 'b');
  const c = gate.flush();
  assert.equal(c.accept, true);
  assert.equal(c.tag, 'b', '마지막 정지 후보를 낸다');
  assert.equal(c.slideId, 0);
  assert.equal(gate.flush(), null, '두 번 내지 않는다');
});

test('vision lastFrame mode: a blip that returns to the same slide submits nothing', () => {
  const gate = new VisualGate({ mode: 'vision', lastFrame: true, minGapMs: 0 });
  frame = 24;
  gate.inspect({}, 0, false, 'a');
  frame = 200;
  gate.inspect({}, 2000, false, 'x'); // 한 표본짜리 팝업 — 멎지 않아 확정이 안 난다
  frame = 24;
  const back = gate.inspect({}, 4000, false, 'b'); // 원래 슬라이드로 돌아옴 — 직전 표본과 달라 아직 미정지
  assert.equal(back.accept, false, '전환이 확정되지 않았으면 제출도 없다');
  assert.equal(back.candidateTag, 'a', '돌아오는 중에는 후보도 옛 프레임이다');
  const settled = gate.inspect({}, 6000, false, 'c');
  assert.equal(settled.accept, false);
  assert.equal(settled.candidateTag, 'c', '다시 멎으면 후보가 최신 정지 프레임으로 갱신된다');
});

test('ocr/default mode ignores the lastFrame flag', () => {
  const gate = new VisualGate({ lastFrame: true }); // mode는 ocr — lastFrame은 vision 경로에만 있다
  assert.equal(gate.mode, 'ocr');
  frame = 24;
  const first = gate.inspect({}, 1000, true);
  assert.equal(first.accept, true, '기본 모드는 첫 장을 즉시 제출한다');
});
