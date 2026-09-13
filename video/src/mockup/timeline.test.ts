import { strict as assert } from 'node:assert';
import { note } from './content';
import {
  CAPTURE_END_FRAME,
  CAPTURE_SECONDS,
  NOTE_END_FRAME,
  captureStateAt,
  inkDashOffsets,
  noteCursorAt,
} from './timeline';

// 프레임 → 상태가 결정론적이고 단조로운지만 본다. 이게 깨지면 영상이 프레임마다 튄다.
for (const frame of [0, 1, 137, CAPTURE_END_FRAME - 1, CAPTURE_END_FRAME, 400]) {
  assert.deepEqual(captureStateAt(frame), captureStateAt(frame), `frame ${frame} 비결정적`);
}

assert.equal(captureStateAt(0).stage, 'live');
assert.equal(captureStateAt(CAPTURE_END_FRAME - 1).stage, 'live');
assert.equal(captureStateAt(CAPTURE_END_FRAME).stage, 'done');
assert.equal(captureStateAt(CAPTURE_END_FRAME).elapsed, CAPTURE_SECONDS);

// 슬라이드는 3장을 넘지 않고, 카운터는 뒤로 가지 않는다.
let prev = captureStateAt(0);
for (let f = 1; f < CAPTURE_END_FRAME; f++) {
  const s = captureStateAt(f);
  assert.ok(s.slideIndex >= 0 && s.slideIndex < 3, `frame ${f} slideIndex ${s.slideIndex}`);
  assert.ok(s.slideCount >= prev.slideCount, `frame ${f} slideCount 역행`);
  assert.ok(s.voiceCount >= prev.voiceCount, `frame ${f} voiceCount 역행`);
  assert.ok(s.feed.length > 0 && s.feed.length <= 3, `frame ${f} feed ${s.feed.length}줄`);
  prev = s;
}
assert.equal(prev.slideCount, 3);
assert.equal(prev.voiceCount, 6);

// 잉크: 0.5초 대기 뒤 앞 획부터 차례로 채워지고 4.1초에 다 그려진다.
assert.deepEqual(inkDashOffsets(0.4, 3), [1, 1, 1]);
assert.deepEqual(inkDashOffsets(5, 3), [0, 0, 0]);
const mid = inkDashOffsets(0.5 + 3.6 / 2, 4);
mid.forEach((offset, i) => assert.ok(Math.abs(offset - (i < 2 ? 0 : 1)) < 1e-9, `획 ${i} offset ${offset}`));

// 노트는 캡처가 끝난 뒤에 시작해 끝까지 다 찬다.
assert.equal(noteCursorAt(CAPTURE_END_FRAME - 1), 0);
assert.equal(noteCursorAt(CAPTURE_END_FRAME), 0);
assert.ok(noteCursorAt(CAPTURE_END_FRAME + 10) > 0);
assert.equal(noteCursorAt(NOTE_END_FRAME), note.length);
assert.ok(NOTE_END_FRAME < 450, `노트 생성이 Demo 씬(450프레임)을 넘김: ${NOTE_END_FRAME}`);

console.log(`ok — capture ends f${CAPTURE_END_FRAME}, note ends f${NOTE_END_FRAME} (${note.length}자)`);
