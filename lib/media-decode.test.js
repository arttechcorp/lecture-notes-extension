const test = require("node:test");
const assert = require("node:assert/strict");
const D = require("./media-decode.js");
const S = require("./stt-client.js");

// WebCodecs는 Node에 없다 — 디코더를 부르는 부분은 tools/media-decode-smoke.cjs가 Chromium에서 시험하고, 여기서는 순수 계산만 본다.
const tone = (n, rate, f = 440) => Float32Array.from({ length: n }, (_, i) => 0.3 * Math.sin(2 * Math.PI * f * i / rate) * (1 + 0.5 * Math.sin(i / 997)));
// pcm을 들쭉날쭉한 크기(AudioData 한 개씩)로 잘라 누산기에 먹이고 에너지를 돌려준다
function chunked(pcm, rate, frameMs, { t0 = 0, sizes = [1024, 777, 1, 4096, 300] } = {}) {
  const acc = D.makeAcc(t0, t0 + pcm.length / rate, frameMs);
  for (let k = 0, i = 0, n; k < pcm.length; k += n) { n = sizes[i++ % sizes.length]; D.accumulate(acc, [pcm.subarray(k, k + n)], rate, t0 + k / rate); }
  return D.rms(acc);
}

test("fit shrinks the long side to maxSide, keeps the aspect, and never upscales", () => {
  assert.deepEqual(D.fit(1920, 1080, 1600), { w: 1600, h: 900 });
  assert.deepEqual(D.fit(1080, 1920, 1600), { w: 900, h: 1600 });
  assert.deepEqual(D.fit(320, 180, 1600), { w: 320, h: 180 });
  assert.deepEqual(D.fit(10000, 1, 1600), { w: 1600, h: 1 });
});

test("jpeg lowers the quality once when the blob is over 1.5 MB, then gives up with DECODE_TOO_BIG", async () => {
  const canvas = sizes => { const asked = []; return { asked, convertToBlob: async ({ type, quality }) => { asked.push(quality); return { type, size: sizes[asked.length - 1] }; } }; };
  const ok = canvas([D.MAX_JPEG_BYTES]), once = canvas([D.MAX_JPEG_BYTES + 1, 1000]), never = canvas([D.MAX_JPEG_BYTES + 1, D.MAX_JPEG_BYTES + 1, 1]);
  assert.equal((await D.jpeg(ok, 0.8)).size, D.MAX_JPEG_BYTES); assert.deepEqual(ok.asked, [0.8]);
  assert.equal((await D.jpeg(once, 0.8)).size, 1000); assert.deepEqual(once.asked, [0.8, 0.8 * 0.6]);
  await assert.rejects(D.jpeg(never, 0.8), { code: "DECODE_TOO_BIG" }); assert.equal(never.asked.length, 2);
});

test("energy accumulated across arbitrary AudioData chunks equals stt-client energyFrames", () => {
  // 44100·30ms는 정수 스텝(1323), 22050은 661.5, 16000은 480 — 프레임 경계가 energyFrames와 같아야 VAD·planChunks 시각이 어긋나지 않는다
  for (const rate of [44100, 22050, 16000, 48000]) {
    const pcm = tone(Math.round(rate * 2.37), rate), want = S.energyFrames(pcm, rate, 30), got = chunked(pcm, rate, 30);
    // 길이는 초 단위 올림이라 끝이 프레임 경계에 겨우 걸치면 샘플이 없는 0짜리 꼬리 프레임이 하나 더 생길 수 있다
    assert.ok(got.length - want.length === 0 || (got.length - want.length === 1 && got[got.length - 1] === 0), `rate ${rate}: ${got.length} vs ${want.length}`);
    for (let i = 0; i < want.length; i++) assert.ok(Math.abs(got[i] - want[i]) < 1e-6, `rate ${rate} frame ${i}: ${got[i]} vs ${want[i]}`);
  }
});

test("chunks of any size, down to one sample, give the same frames", () => {
  const rate = 16000, pcm = tone(rate, rate), want = S.energyFrames(pcm, rate, 30);
  for (const sizes of [[1], [7], [480], [481], [100000]]) {
    const got = chunked(pcm, rate, 30, { sizes });
    for (let i = 0; i < want.length; i++) assert.ok(Math.abs(got[i] - want[i]) < 1e-6, `sizes ${sizes} frame ${i}`);
  }
});

test("stereo is mixed down to the mean of its channels", () => {
  const rate = 16000, L = tone(rate, rate), R = tone(rate, rate, 700), mono = L.map((x, i) => (x + R[i]) / 2);
  const acc = D.makeAcc(0, 1, 30); D.accumulate(acc, [L, R], rate, 0);
  const got = D.rms(acc), want = S.energyFrames(mono, rate, 30);
  for (let i = 0; i < want.length; i++) assert.ok(Math.abs(got[i] - want[i]) < 1e-6);
});

test("energy is placed on the lecture timeline: offset start, holes are silent, samples before t0 are dropped", () => {
  const rate = 16000, frame = 0.03, a = tone(rate, rate); // 1초
  const acc = D.makeAcc(10, 13, 30); // 강의 10~13초
  D.accumulate(acc, [a], rate, 10);   // 10~11초
  D.accumulate(acc, [a], rate, 12);   // 12~13초 (11~12초는 구멍)
  D.accumulate(acc, [a], rate, 9.5);  // t0 앞 0.5초는 버리고 나머지 0.5초가 10~10.5초에 겹친다
  const e = D.rms(acc), at = t => e[Math.floor((t - 10) / frame)];
  assert.equal(e.length, 100);
  assert.ok(at(10.5) > 0.05 && at(12.5) > 0.05);
  assert.equal(at(11.5), 0); // 구멍 = 무음
  // 구멍이 있는 에너지에서 vadSegments가 두 구간을 찾고 시각은 t0 기준 상대값이다
  const v = S.vadSegments(e, { frameMs: 30 });
  assert.equal(v.length, 2);
  assert.ok(Math.abs(v[0].t0) < 0.05 && Math.abs(v[0].t1 - 1) < 0.1 && Math.abs(v[1].t0 - 2) < 0.1 && Math.abs(v[1].t1 - 3) < 0.1, JSON.stringify(v));
});

test("the dropped AAC fade-in leaves no empty frame at a seam, a missing segment stays silent", () => {
  const rate = 44100, hole = 1024 / rate, tone1 = tone(rate, rate); // 디코더 flush 뒤 버린 첫 AudioData(1024샘플 ≈ 23ms)는 30ms 프레임보다 짧다
  const acc = D.makeAcc(0, 4, 30);
  D.accumulate(acc, [tone1], rate, 0);          // 0~1초
  D.accumulate(acc, [tone1], rate, 1 + hole);   // 이음새에 구멍 하나, 1.023~2.023초
  D.accumulate(acc, [tone1], rate, 3);          // 2.023~3초가 빠진 세그먼트, 3~4초
  const e = D.rms(acc), at = t => e[Math.floor(t / 0.03)];
  for (let t = 0; t < 2.01; t += 0.03) assert.ok(at(t) > 0.05, `frame at ${t.toFixed(2)}: ${at(t)}`);
  assert.equal(at(2.6), 0);
});

test("without WebCodecs the decoders fail with DECODE_UNSUPPORTED, and empty input needs no decoder", async () => {
  const kf = { t: 0, data: new Uint8Array(4), codec: "avc1.64001f", description: new Uint8Array(4) };
  await assert.rejects(D.keyframeImages([kf]).next(), { code: "DECODE_UNSUPPORTED" });
  await assert.rejects(D.audioEnergy({ type: "audio", codec: "mp4a.40.2", sampleRate: 44100, channels: 1, buf: new Uint8Array(4), samples: [{ t: 0, dur: 0.02, off: 0, size: 4 }] }), { code: "DECODE_UNSUPPORTED" });
  assert.deepEqual(await D.keyframeImages([]).next(), { done: true, value: undefined });
  assert.deepEqual(await D.audioEnergy([null, undefined]), { t0: 0, frameMs: 30, energy: new Float32Array(0) });
});

test("PCM for cloud STT: resampled mono matches the source signal and wavSlice writes a valid 16-bit WAV", () => {
  const src = 48000, pcm = D.makePcm(10, 12, 16000), sine = t => Math.sin(2 * Math.PI * 440 * t);
  // 1초씩 두 덩어리, 스테레오(한 채널은 반전 없이 같은 값) — 모노 평균이 원 신호와 같아야 한다
  for (const start of [10, 11]) {
    const p = Float32Array.from({ length: src }, (_, i) => sine(start + i / src) * 0.5);
    D.resampleInto(pcm, [p, p], src, start);
  }
  assert.equal(pcm.data.length, 32000);
  let worst = 0;
  for (let o = 0; o < 32000 - 3; o++) worst = Math.max(worst, Math.abs(pcm.data[o] - sine(10 + o / 16000) * 0.5));
  assert.ok(worst < 0.01, `리샘플 오차 ${worst}`);
  const wav = D.wavSlice(pcm, 10.5, 11.5), v = new DataView(wav.buffer);
  assert.equal(String.fromCharCode(...wav.subarray(0, 4)), "RIFF");
  assert.equal(String.fromCharCode(...wav.subarray(8, 12)), "WAVE");
  assert.deepEqual([v.getUint16(22, true), v.getUint32(24, true), v.getUint16(34, true), v.getUint32(40, true)], [1, 16000, 16, 32000]);
  assert.equal(wav.length, 44 + 32000);
  assert.ok(Math.abs(v.getInt16(44 + 2 * 100, true) / 32767 - pcm.data[8000 + 100]) < 1e-4);
  // 범위 밖은 무음, 길이는 요청한 구간 그대로
  const tail = D.wavSlice(pcm, 11.9, 12.2);
  assert.equal(tail.length, 44 + Math.round(0.3 * 16000) * 2);
  assert.equal(new DataView(tail.buffer).getInt16(tail.length - 2, true), 0);
});
