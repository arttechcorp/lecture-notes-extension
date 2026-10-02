const test = require("node:test");
const { before, after } = test;
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { execFileSync, spawnSync } = require("node:child_process");
const LM = require("./media-source.js");
// mux.js UMD의 Node 분기는 require("global/window")를 부르므로 워커의 importScripts처럼 전역 스크립트로 실행한다
vm.runInThisContext(fs.readFileSync(path.join(__dirname, "vendor/mux/mux-mp4.min.js"), "utf8"));
const D = require("./media-demux.js");

const GEN = path.join(__dirname, "../tools/make-hls-fixture.mjs");
const has = bin => spawnSync(bin, ["-version"], { stdio: "ignore" }).status === 0;
const FFMPEG = has("ffmpeg"), FFPROBE = FFMPEG && has("ffprobe");
const NEED_FFMPEG = FFMPEG ? false : "ffmpeg가 없어 HLS 픽스처 시험을 건너뜁니다 (apt install ffmpeg)";
const NEED_FFPROBE = FFPROBE ? false : "ffprobe가 없어 m4a 판독 시험을 건너뜁니다";

// 픽스처(tools/make-hls-fixture.mjs): 24초, 슬라이드(단색) 4초마다 6장, 키프레임 2초마다 12개, 8초 세그먼트 3개
let FX;
before(() => {
  if (!FFMPEG) return;
  FX = fs.mkdtempSync(path.join(os.tmpdir(), "hls-fixture-"));
  execFileSync(process.execPath, [GEN, FX], { stdio: "pipe" });
});
after(() => { if (FX) fs.rmSync(FX, { recursive: true, force: true }); });

// 재생목록을 parseM3U8로 읽고 세그먼트마다 demuxSegment를 부른다(미디어 Worker가 할 일의 축소판: 스트림마다 anchor 하나). anc = 그 세그먼트를 읽은 직후의 anchor 복사본.
function run(name, dir = path.join(FX, name)) {
  const base = `https://lms.test/${name}/`, anchor = {};
  const pl = LM.parseM3U8(fs.readFileSync(path.join(dir, "index.m3u8"), "utf8"), base + "index.m3u8");
  const file = u => new Uint8Array(fs.readFileSync(path.join(dir, new URL(u).pathname.slice(name.length + 2))));
  const init = pl.segments[0].map ? file(pl.segments[0].map.uri) : null;
  return { pl, init, segs: pl.segments.map(seg => ({ seg, bytes: file(seg.uri) })).map(x => ({ ...x, ...D.demuxSegment(x.bytes, { init, start: x.seg.start, discontinuity: x.seg.discontinuity, anchor }), anc: { ...anchor } })) };
}
const near = (a, b, eps = 1e-3) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b} (±${eps})`);
const FRAME = 0.1, AAC = 1024 / 44100; // 픽스처 영상 한 프레임(10fps), AAC 한 프레임(44.1kHz)
// 이어지는 세그먼트 사이의 오디오 간격(초, 앞 세그먼트 끝 → 다음 시작): 양수 = 구멍, 음수 = 겹침
const seams = segs => segs.slice(1).map((s, i) => { const p = segs[i].audio.samples.at(-1); return s.audio.samples[0].t - (p.t + p.dur); });
const keyTimes = (segs, interval) => { let after = -Infinity; const out = []; for (const s of segs) for (const k of D.keyframes(s.video, { interval, after })) { out.push(k.t); after = k.t; } return out; };
const RANGES = [{ t0: 0, t1: 10 }, { t0: 10, t1: 20 }, { t0: 20, t1: 30 }];

// ---- ffmpeg 없이 도는 시험: m4a 쓰기와 청크 분할 ----
const STSD = new Uint8Array([0, 0, 0, 16, 0x73, 0x74, 0x73, 0x64, 1, 2, 3, 4, 5, 6, 7, 8]); // 내용을 읽지 않는 시험용 샘플 엔트리
function fakeTrack({ n = 1000, size = 100, start = 0, d = 1024, rate = 44100, stsd = STSD, gapAt = -1, gap = 0 } = {}) {
  const buf = new Uint8Array(n * size).map((_, i) => (i * 7 + start) & 255), samples = []; let t = start;
  for (let i = 0; i < n; i++) { if (i === gapAt) t += gap; samples.push({ t, dur: d / rate, d, off: i * size, size, sync: true }); t += d / rate; }
  return { type: "audio", timescale: rate, stsd, buf, samples };
}
function parseBoxes(u8, s = 0, e = u8.length) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), out = [];
  while (s + 8 <= e) { const size = dv.getUint32(s); out.push({ type: String.fromCharCode(...u8.subarray(s + 4, s + 8)), s, e: s + size }); s += size; }
  return out;
}

test("m4a chunk is ftyp, moov, mdat with a correct sample table", () => {
  const tr = fakeTrack({ n: 50, size: 33 }), [c] = D.audioChunks(tr, [{ t0: 0, t1: 100 }]);
  const top = parseBoxes(c.bytes);
  assert.deepEqual(top.map(b => b.type), ["ftyp", "moov", "mdat"]);
  assert.equal(c.mime, "audio/mp4");
  assert.equal(c.sampleCount, 50);
  const find = (box, ...p) => p.reduce((b, t) => parseBoxes(c.bytes, b.s + 8, b.e).find(x => x.type === t), box);
  const dv = new DataView(c.bytes.buffer, c.bytes.byteOffset, c.bytes.byteLength);
  const stbl = find(top[1], "trak", "mdia", "minf", "stbl"), stsz = find(stbl, "stsz"), stco = find(stbl, "stco"), mdhd = find(top[1], "trak", "mdia", "mdhd");
  assert.equal(dv.getUint32(stsz.s + 16), 50); // sample_count
  assert.equal(dv.getUint32(stsz.s + 20), 33); // 첫 샘플 크기
  assert.equal(dv.getUint32(mdhd.s + 20), 44100); // timescale
  assert.equal(dv.getUint32(stco.s + 16), top[2].s + 8); // 청크 오프셋 = mdat 본문
  assert.deepEqual(c.bytes.subarray(top[2].s + 8), tr.buf.subarray(0, 50 * 33)); // 본문은 샘플 바이트의 이어붙임
  assert.notEqual(c.bytes.buffer, tr.buf.buffer); // 입력과 독립된 새 버퍼
  near(c.durationSec, 50 * 1024 / 44100, 1e-9);
  near(c.t1, c.t0 + c.durationSec, 1e-12);
});

test("audioChunks keeps only samples starting inside the range and t0 is the first sample t", () => {
  const tr = fakeTrack({ n: 400 }), chunks = D.audioChunks(tr, [{ t0: 2, t1: 4 }, { t0: 100, t1: 200 }]);
  assert.equal(chunks.length, 1); // 범위 밖은 청크를 만들지 않는다
  const first = tr.samples.find(s => s.t >= 2);
  near(chunks[0].t0, first.t, 1e-12);
  assert.equal(chunks[0].sampleCount, tr.samples.filter(s => s.t >= 2 && s.t < 4).length);
  assert.deepEqual(D.audioChunks(null, RANGES), []);
});

test("audioChunks splits to stay within 330 s and 8 MiB without losing samples", () => {
  // 샘플당 2000바이트 → 8MiB가 먼저 찬다. 20000샘플 ≈ 464초
  const tr = fakeTrack({ n: 20000, size: 2000 }), chunks = D.audioChunks(tr, [{ t0: 0, t1: 1000 }]);
  assert.ok(chunks.length >= 5);
  for (const c of chunks) { assert.ok(c.bytes.length <= D.MAX_CHUNK_BYTES, "8MiB 이하"); assert.ok(c.durationSec <= D.MAX_CHUNK_SEC, "330초 이하"); }
  assert.equal(chunks.reduce((n, c) => n + c.sampleCount, 0), 20000);
  for (let i = 1; i < chunks.length; i++) near(chunks[i].t0, chunks[i - 1].t1, 1e-6); // 이어진다
  // 샘플이 작으면 초가 먼저 찬다: 20000 × 100바이트
  const small = D.audioChunks(fakeTrack({ n: 20000, size: 100 }), [{ t0: 0, t1: 1000 }]);
  assert.equal(small.length, 2);
  for (const c of small) assert.ok(c.durationSec <= 330);
  // 옵션으로 줄일 수 있다
  assert.ok(D.audioChunks(fakeTrack({ n: 1000 }), [{ t0: 0, t1: 100 }], { maxSec: 10 }).every(c => c.durationSec <= 10));
});

test("audioChunks splits at timeline gaps and configuration changes", () => {
  const holey = D.audioChunks(fakeTrack({ n: 200, gapAt: 100, gap: 5 }), [{ t0: 0, t1: 100 }]);
  assert.equal(holey.length, 2);
  assert.equal(holey[0].sampleCount, 100);
  const a = fakeTrack({ n: 100 }), b = fakeTrack({ n: 100, start: a.samples[99].t + a.samples[99].dur, rate: 48000, stsd: new Uint8Array([...STSD.slice(0, 15), 9]) });
  const split = D.audioChunks([a, b], [{ t0: 0, t1: 100 }]);
  assert.deepEqual(split.map(c => c.sampleCount), [100, 100]);
  // 같은 설정이면 세그먼트가 달라도 한 청크
  const c = fakeTrack({ n: 100, start: a.samples[99].t + a.samples[99].dur });
  assert.deepEqual(D.audioChunks([a, c], [{ t0: 0, t1: 100 }]).map(x => x.sampleCount), [200]);
});

test("chunk limits equal the server STT limits", () => {
  assert.match(fs.readFileSync(path.join(__dirname, "../server/index.js"), "utf8"), /STT_MAX_SEC=330,STT_MAX_BYTES=8\*1024\*1024/);
  assert.equal(D.MAX_CHUNK_SEC, 330);
  assert.equal(D.MAX_CHUNK_BYTES, 8 * 1024 * 1024);
});

test("fMP4 reader applies composition offsets and sync flags to muxed tracks (synthetic)", () => {
  // mux.js의 fMP4 생성기로 만든 합성 세그먼트: 디코드 순서 I P B B, 한 프레임 = 3000틱, 비디오와 AAC가 한 세그먼트에
  const g = globalThis.muxjs.generator, F = 3000;
  const sps = new Uint8Array([0x67, 0x64, 0x00, 0x0c, 0xac, 0xd9, 0x41, 0x41, 0xfb, 0x01, 0x10, 0x00, 0x00, 0x03, 0x00, 0x10, 0x00, 0x00, 0x03, 0x03, 0xc0, 0xf1, 0x42, 0x99, 0x60]);
  const fl = nonsync => ({ isLeading: 0, dependsOn: nonsync ? 1 : 2, isDependedOn: 0, hasRedundancy: 0, paddingValue: 0, isNonSyncSample: nonsync, degradationPriority: 0 });
  const video = { id: 1, type: "video", width: 320, height: 180, sps: [sps], pps: [new Uint8Array([0x68, 0xeb, 0xe3, 0xcb, 0x22, 0xc0])], profileIdc: 100, levelIdc: 12, profileCompatibility: 0, sarRatio: [1, 1], timelineStartInfo: { baseMediaDecodeTime: 90000 }, baseMediaDecodeTime: 90000,
    samples: [[100, 0, F], [50, 1, 3 * F], [30, 1, 0], [30, 1, 0]].map(([size, ns, compositionTimeOffset]) => ({ duration: F, size, flags: fl(ns), compositionTimeOffset })) };
  const audio = { id: 2, type: "audio", audioobjecttype: 2, samplerate: 48000, samplingfrequencyindex: 3, channelcount: 2, samplesize: 16, timelineStartInfo: { baseMediaDecodeTime: 48000 }, baseMediaDecodeTime: 48000,
    samples: [10, 11, 12].map(size => ({ duration: 1024, size })) };
  // 생성기는 traf마다 자기 moof 기준 오프셋을 쓰므로 트랙마다 moof+mdat 쌍으로 이어 붙인다(ffmpeg·CMAF 조각과 같은 모양)
  const init = g.initSegment([video, audio]), pv = Uint8Array.from({ length: 210 }, (_, i) => i), pa = Uint8Array.from({ length: 33 }, (_, i) => 200 + i);
  const parts = [g.moof(1, [video]), g.mdat(pv), g.moof(2, [audio]), g.mdat(pa)];
  const seg = new Uint8Array(parts.reduce((n, x) => n + x.length, 0)); let o = 0; for (const x of parts) { seg.set(x, o); o += x.length; }
  const r = D.demuxSegment(seg, { init, start: 100 });
  // 표시 시각: I=0, P=0.1, B=0.0333, B=0.0667 (디코드 순서로 나열) — cts를 무시하면 단조 증가가 된다.
  // 기준은 모든 트랙의 최소 PTS라서 오디오(1초)가 비디오(1.0333초)보다 먼저 시작한 만큼 비디오가 0.0333초 늦다
  assert.deepEqual(r.video.samples.map(x => Math.round(x.t * 1e4) / 1e4), [100.0333, 100.1333, 100.0667, 100.1]);
  assert.deepEqual(r.video.samples.map(x => x.sync), [true, false, false, false]);
  assert.deepEqual(r.video.samples.map(x => x.size), [100, 50, 30, 30]);
  assert.equal(r.video.mediaStart, 1 + F / 90000); // tfdt + 최소 cts (원래 PTS)
  assert.equal(r.audio.mediaStart, 1);
  assert.equal(r.video.codec, "avc1.64000c");
  const [k] = D.keyframes(r.video, { interval: 5 });
  assert.deepEqual(k.data, pv.subarray(0, 100)); // 데이터 위치(trun data_offset)
  assert.equal(k.data.buffer, seg.buffer);
  assert.deepEqual(D.keyframes(r.video, { after: 99 }).map(x => Math.round(x.t * 1e4) / 1e4), [100.0333]);
  assert.deepEqual(D.keyframes(r.video, { after: 99.5, interval: 1 }).map(x => x.t), []); // 직전 키프레임과 간격 미달
  // 오디오: 같은 세그먼트의 두 번째 moof
  assert.equal(r.audio.codec, "mp4a.40.2");
  assert.equal(r.audio.sampleRate, 48000);
  assert.equal(r.audio.channels, 2);
  assert.deepEqual(r.audio.description, new Uint8Array([0x11, 0x90])); // AudioSpecificConfig: AAC-LC, 48kHz, 스테레오
  const us = t => Math.round(t * 1e6) / 1e6; // 기준 PTS를 빼는 부동소수 오차(≈1e-13)를 지운다
  assert.deepEqual(r.audio.samples.map(x => [us(x.t), x.size]), [[100, 10], [us(100 + 1024 / 48000), 11], [us(100 + 2048 / 48000), 12]]);
  const [c] = D.audioChunks(r.audio, [{ t0: 0, t1: 1000 }]);
  assert.equal(c.sampleCount, 3);
  assert.deepEqual(c.bytes.subarray(-33), pa); // 오디오 샘플 바이트가 mdat에 그대로
});

test("garbage and empty input are rejected with DEMUX_BAD_MEDIA", () => {
  for (const bytes of [new Uint8Array(0), new Uint8Array(5000).fill(7), Uint8Array.from({ length: 188 * 20 }, (_, i) => (i % 188 ? i & 255 : 0x47))]) {
    assert.throws(() => D.demuxSegment(bytes), { code: "DEMUX_BAD_MEDIA" });
  }
  assert.throws(() => D.demuxSegment([1, 2, 3]), TypeError);
});

test("fixture generator refuses paths inside the repo", () => {
  const inside = path.join(__dirname, "zz-fixture-should-not-exist");
  const r = spawnSync(process.execPath, [GEN, inside], { encoding: "utf8" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /저장소 안/);
  assert.ok(!fs.existsSync(inside));
  // 저장소를 가리키는 심볼릭 링크로도 들어올 수 없다
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hls-link-"));
  try {
    fs.symlinkSync(path.join(__dirname, ".."), path.join(tmp, "repo"));
    const viaLink = spawnSync(process.execPath, [GEN, path.join(tmp, "repo", "zz-fixture-should-not-exist")], { encoding: "utf8" });
    assert.equal(viaLink.status, 2);
    assert.ok(!fs.existsSync(path.join(__dirname, "../zz-fixture-should-not-exist")));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

// ---- ffmpeg 픽스처 시험 ----
test("plain TS: transmuxes audio and video separately, lists keyframes and cuts audio chunks", { skip: NEED_FFMPEG }, () => {
  const { segs } = run("plain");
  assert.equal(segs.length, 3);
  const parts = D.transmuxTs(segs[0].bytes);
  assert.deepEqual(parts.map(p => p.type).sort(), ["audio", "video"]);
  for (const p of parts) assert.ok(p.init instanceof Uint8Array && p.data instanceof Uint8Array && p.init.length > 0 && p.data.length > 0);

  const v = segs[0].video, a = segs[0].audio;
  assert.match(v.codec, /^avc1\.[0-9a-f]{6}$/);
  assert.equal(v.timescale, 90000);
  assert.equal(a.codec, "mp4a.40.2");
  assert.equal(a.sampleRate, 44100);
  assert.equal(a.description.length, 2); // AudioSpecificConfig
  // 키프레임: 2초마다 12개. 간격 4초로 솎으면 슬라이드가 바뀌는 시각 6개(영상 한 프레임 이내)
  const all = keyTimes(segs, 0);
  all.forEach((t, i) => near(t, 2 * i, FRAME));
  assert.equal(all.length, 12);
  const slides = keyTimes(segs, 4);
  assert.equal(slides.length, 6);
  slides.forEach((t, i) => near(t, 4 * i, FRAME));
  // 오디오는 비디오와의 상대 위치를 지키고(세그먼트마다 제 첫 샘플에 맞추면 어긋난다), 세그먼트 이음새의 구멍·겹침이 AAC 한 프레임을 넘지 않는다
  for (const s of segs) near(s.video.samples[0].t - s.audio.samples[0].t, s.video.mediaStart - s.audio.mediaStart, 1e-9);
  assert.ok(segs[1].video.mediaStart - segs[1].audio.mediaStart > 0.01, "시험이 의미 있으려면 오디오가 비디오보다 앞서야 한다");
  seams(segs).forEach(gap => near(gap, 0, AAC));
  assert.equal(new Set(segs.map(s => s.anc.base)).size, 1); // 한 구간: 기준은 첫 세그먼트에서 한 번만 잡힌다
  assert.equal(segs[0].anc.base, Math.min(segs[0].audio.mediaStart, segs[0].video.mediaStart)); // 모든 트랙의 최소 PTS
  // 키프레임 항목: 복사 없이 비디오 버퍼의 뷰
  const [k] = D.keyframes(v);
  assert.equal(k.data.buffer, v.buf.buffer);
  assert.ok(k.data.length > 0 && k.description[0] === 1); // avcC configurationVersion
  assert.equal(k.codec, v.codec);
  // 비디오 샘플표: 동기 샘플만 키프레임이고 PTS는 DTS 이상
  assert.equal(v.samples.filter(s => s.sync).length, 4);
  // 오디오 청크: 10초 단위 범위 → 길이 ≈ 10, 10, 4
  const chunks = D.audioChunks(segs.map(s => s.audio), RANGES);
  assert.equal(chunks.length, 3);
  near(chunks[0].durationSec, 10, 0.2);
  near(chunks[1].durationSec, 10, 0.2);
  near(chunks[2].durationSec, 4.2, 0.3);
  near(chunks.reduce((n, c) => n + c.durationSec, 0), 24.2, 0.3); // 오디오 전체(AAC 프라이밍 포함)
  for (const c of chunks) { assert.ok(c.bytes.length <= D.MAX_CHUNK_BYTES); assert.ok(c.durationSec <= D.MAX_CHUNK_SEC); assert.ok(c.t1 > c.t0); }
  assert.ok(chunks[0].t0 === 0 && chunks[1].t0 > chunks[0].t0 && chunks[2].t0 > chunks[1].t0);
});

test("fMP4 with EXT-X-MAP: same results from muxed audio and video, protected entries refused", { skip: NEED_FFMPEG }, () => {
  const { pl, init, segs } = run("fmp4");
  assert.ok(pl.segments[0].map && init.length > 0);
  assert.equal(segs[0].video.buf, segs[0].bytes); // fMP4 입력은 복사하지 않고 입력 바이트를 가리킨다
  assert.equal(segs[0].audio.buf, segs[0].bytes);
  const slides = keyTimes(segs, 4);
  assert.equal(slides.length, 6);
  slides.forEach((t, i) => near(t, 4 * i + 0.2, FRAME)); // ffmpeg의 fMP4는 영상을 B프레임 지연(0.2초)만큼 늦춰 쓴다. 편집 목록(elst)은 읽지 않으므로 그대로 보인다
  assert.equal(keyTimes(segs, 0).length, 12);
  seams(segs).forEach(gap => near(gap, 0, AAC));
  const chunks = D.audioChunks(segs.map(s => s.audio), RANGES);
  assert.equal(chunks.length, 3);
  near(chunks.reduce((n, c) => n + c.durationSec, 0), 24.2, 0.3);
  // 보호된 샘플 엔트리(encv)는 거절한다
  const enc = init.slice(); enc.set(Buffer.from("encv"), Buffer.from(enc).indexOf("avc1"));
  assert.throws(() => D.demuxSegment(segs[1].bytes, { init: enc }), { code: "DEMUX_PROTECTED" });
  // 조각화되지 않은 MP4(moov만)는 아직 지원하지 않는다
  assert.throws(() => D.demuxSegment(init), { code: "DEMUX_UNSUPPORTED" });
  // moov가 없으면 읽을 수 없다
  assert.throws(() => D.demuxSegment(segs[1].bytes), { code: "DEMUX_NO_INIT" });
  // 잘린 세그먼트
  assert.throws(() => D.demuxSegment(segs[1].bytes.subarray(0, segs[1].bytes.length >> 1), { init }), { code: "DEMUX_TRUNCATED" });
});

test("raw ADTS AAC segments (audio-only renditions) demux like TS audio", { skip: NEED_FFMPEG }, () => {
  const aac = path.join(FX, "a.aac");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", path.join(FX, "plain", "seg1.ts"), "-vn", "-c:a", "copy", "-f", "adts", aac]);
  const r = D.demuxSegment(new Uint8Array(fs.readFileSync(aac)), { start: 8 });
  assert.equal(r.video, null);
  assert.equal(r.audio.codec, "mp4a.40.2");
  assert.equal(r.audio.samples[0].t, 8);
  const [c] = D.audioChunks(r.audio, [{ t0: 8, t1: 20 }]);
  near(c.durationSec, 8, 0.05);
  assert.equal(c.t0, 8);
});

test("DISCONTINUITY: timeline stays monotonic across a PTS reset and chunks split where the audio config changes", { skip: NEED_FFMPEG }, () => {
  const { pl, segs } = run("disc");
  assert.deepEqual(pl.segments.map(s => s.discontinuity), [false, false, true]);
  assert.deepEqual(pl.segments.map(s => s.start), [0, 8, 16]);
  // 뒷조각의 원래 PTS가 앞조각 끝보다 작다(실제로 되감김)
  assert.ok(segs[2].video.mediaStart < segs[1].video.mediaStart, "PTS 리셋이 있어야 시험이 의미 있다");
  // 기준은 구간마다 하나: 첫 구간은 EXTINF 0초 + 첫 세그먼트의 최소 PTS, DISCONTINUITY에서 다시 잡혀 둘째 구간은 EXTINF 16초 + 그 세그먼트의 최소 PTS
  assert.deepEqual(segs.map(s => s.anc.start), [0, 0, 16]);
  assert.equal(segs[1].anc.base, segs[0].anc.base);
  assert.equal(segs[2].anc.base, Math.min(segs[2].audio.mediaStart, segs[2].video.mediaStart));
  assert.notEqual(segs[2].anc.base, segs[0].anc.base);
  // 키프레임 시각은 PTS가 아니라 구간 기준을 따라 단조 증가하고, 슬라이드 경계(2초마다) 한 프레임 안에 있다
  const keys = keyTimes(segs, 0);
  assert.equal(keys.length, 12);
  keys.forEach((t, i) => near(t, 2 * i, FRAME));
  for (let i = 1; i < keys.length; i++) assert.ok(keys[i] > keys[i - 1]);
  // 오디오 샘플: 구간 안에서는 이음새 없이 이어지고(AAC 한 프레임 이내), DISCONTINUITY에서는 앞 구간 오디오 길이와 EXTINF 차이(< 0.25초)만큼만 겹칠 수 있다
  let prevEnd = -Infinity;
  for (const s of segs) {
    for (let i = 1; i < s.audio.samples.length; i++) assert.ok(s.audio.samples[i].t > s.audio.samples[i - 1].t);
    assert.ok(s.audio.samples[0].t >= prevEnd - 0.25, "세그먼트 경계에서 크게 되감기면 안 된다");
    if (s.seg.discontinuity || s === segs[0]) assert.equal(s.audio.samples[0].t, s.seg.start); // 오디오가 구간에서 가장 먼저 시작한다
    const last = s.audio.samples.at(-1); prevEnd = last.t + last.dur;
  }
  near(seams(segs)[0], 0, AAC);
  // 앞조각 44.1kHz, 뒷조각 48kHz: 하나의 m4a에 섞지 않는다
  const chunks = D.audioChunks(segs.map(s => s.audio), RANGES);
  assert.equal(chunks.length, 4);
  assert.equal(segs[1].audio.sampleRate, 44100);
  assert.equal(segs[2].audio.sampleRate, 48000);
  assert.ok(chunks[1].t1 < 17 && chunks[2].t0 === 16); // [10,20) 범위가 16초 지점에서 둘로
  for (let i = 1; i < chunks.length; i++) assert.ok(chunks[i].t0 >= chunks[i - 1].t0, "청크 시작 시각은 단조 증가");
});

test("PTS wrap at 2^33 inside one sequence: segments after the wrap continue the timeline", { skip: NEED_FFMPEG }, () => {
  // plain/의 세그먼트를 PTS가 95440초(= 2^33/90000 직전)에서 시작하게 다시 담는다: 첫 세그먼트가 바퀴 경계를 가로지르고 뒤 세그먼트는 작은 PTS로 되감겨 시작한다
  const dir = path.join(FX, "wrap"); fs.mkdirSync(dir);
  for (let i = 0; i < 3; i++) execFileSync("ffmpeg", ["-v", "error", "-y", "-copyts", "-i", path.join(FX, "plain", `seg${i}.ts`), "-c", "copy", "-output_ts_offset", "95440", "-f", "mpegts", path.join(dir, `seg${i}.ts`)]);
  fs.copyFileSync(path.join(FX, "plain", "index.m3u8"), path.join(dir, "index.m3u8"));
  const wrapped = run("wrap", dir).segs, plain = run("plain").segs;
  assert.ok(wrapped[0].audio.mediaStart > 95000 && wrapped[1].audio.mediaStart < 100, "PTS가 실제로 되감겨야 시험이 의미 있다");
  wrapped.forEach((s, i) => { near(s.audio.samples[0].t, plain[i].audio.samples[0].t, 1e-3); near(s.video.samples[0].t, plain[i].video.samples[0].t, 1e-3); }); // 되감기지 않은 원본과 같은 시각
  seams(wrapped).forEach(gap => near(gap, 0, AAC));
});

test("a DISCONTINUITY drops the anchor even when that segment cannot be read, a failure mid-sequence keeps it", () => {
  const junk = new Uint8Array(500).fill(7), anchor = { start: 8, base: 5 };
  assert.throws(() => D.demuxSegment(junk, { anchor }), { code: "DEMUX_BAD_MEDIA" });
  assert.deepEqual(anchor, { start: 8, base: 5 });
  assert.throws(() => D.demuxSegment(junk, { discontinuity: true, anchor }), { code: "DEMUX_BAD_MEDIA" });
  assert.equal(anchor.base, undefined); // 다음 세그먼트가 새 구간의 기준이 된다
});

test("AES-128 playlist is detected as protected and neither key nor segments are fetched", { skip: NEED_FFMPEG }, async () => {
  const calls = [];
  const fetch = async url => { calls.push(url); return new Response(fs.readFileSync(path.join(FX, "aes", new URL(url).pathname.slice(5))), { headers: { "content-type": "application/vnd.apple.mpegurl" } }); };
  const f = LM.createFetcher({ fetch, maxMbps: Infinity });
  const url = "https://lms.test/aes/index.m3u8";
  const pl = LM.parseM3U8(new TextDecoder().decode(await f.get(url)), url);
  assert.equal(pl.keys[0].method, "AES-128");
  assert.equal(pl.keys[0].uri, "https://lms.test/aes/enc.key"); // 키 URI는 재생목록에 있다
  assert.deepEqual(LM.detectProtection({ playlists: [pl] }), { protected: true, reason: "EXT-X-KEY:AES-128" });
  // 보호가 감지되면 호출자는 여기서 멈춘다: 키도 세그먼트도 요청하지 않았다
  assert.deepEqual(calls, [url]);
  // 방어선: 게이트를 건너뛰고 암호문 세그먼트가 와도 디먹서는 해독을 시도하지 않고 거절한다
  const cipher = new Uint8Array(fs.readFileSync(path.join(FX, "aes", "seg0.ts")));
  assert.throws(() => D.demuxSegment(cipher), { code: "DEMUX_BAD_MEDIA" });
});

test("I-frame-only playlist: each BYTERANGE yields one keyframe at its start time", { skip: NEED_FFMPEG }, () => {
  const dir = path.join(FX, "iframe");
  const pl = LM.parseM3U8(fs.readFileSync(path.join(dir, "index.m3u8"), "utf8"), "https://lms.test/iframe/index.m3u8");
  assert.equal(pl.iframesOnly, true);
  assert.equal(pl.segments.length, 12);
  assert.ok(pl.segments.every(s => s.byterange && s.duration === 2));
  const file = new Uint8Array(fs.readFileSync(path.join(dir, "frames.ts")));
  const keys = pl.segments.flatMap(s => {
    const r = D.demuxSegment(file.subarray(s.byterange.offset, s.byterange.offset + s.byterange.length), { start: s.start });
    assert.equal(r.audio, null);
    return D.keyframes(r.video);
  });
  assert.equal(keys.length, 12);
  keys.forEach((k, i) => near(k.t, 2 * i));
  // 다운로드 절감: 12장 합쳐도 평문 TS 세그먼트 한 개보다 훨씬 작다
  assert.ok(file.length < fs.statSync(path.join(FX, "plain", "seg0.ts")).size / 5);
});

test("ffprobe reads the m4a chunks as audio and ffmpeg decodes them", { skip: NEED_FFMPEG || NEED_FFPROBE }, () => {
  const plain = run("plain"), disc = run("disc");
  const chunks = [...D.audioChunks(plain.segs.map(s => s.audio), RANGES), ...D.audioChunks(disc.segs.map(s => s.audio), RANGES)];
  assert.equal(chunks.length, 7);
  chunks.forEach((c, i) => {
    const file = path.join(FX, `chunk${i}.m4a`);
    fs.writeFileSync(file, c.bytes);
    const info = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_name,codec_type,sample_rate,channels,nb_frames", "-of", "json", file]));
    assert.equal(info.streams.length, 1);
    assert.equal(info.streams[0].codec_type, "audio");
    assert.equal(info.streams[0].codec_name, "aac");
    assert.equal(info.streams[0].channels, 1);
    assert.equal(Number(info.streams[0].nb_frames), c.sampleCount);
    near(Number(info.format.duration), c.durationSec, 5e-3);
    const dec = spawnSync("ffmpeg", ["-v", "error", "-i", file, "-f", "null", "-"], { encoding: "utf8" });
    assert.equal(dec.status, 0);
    assert.equal(dec.stderr, "");
    assert.equal(Number(info.streams[0].sample_rate), [44100, 44100, 44100, 44100, 44100, 48000, 48000][i]);
  });
});

test("corrupted segments fail only with DEMUX_* errors and never hang", { skip: NEED_FFMPEG }, () => {
  const rnd = (s => () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296)(12345);
  const { init, segs } = run("fmp4"), ts = run("plain").segs[0].bytes;
  for (const [src, n, withInit] of [[segs[1].bytes, 150, true], [ts, 25, false]]) {
    let failed = 0;
    for (let i = 0; i < n; i++) {
      const b = src.slice();
      for (let k = 1 + Math.floor(rnd() * 8); k > 0; k--) b[Math.floor(rnd() * (i % 2 ? Math.min(b.length, 1500) : b.length))] = Math.floor(rnd() * 256);
      try { D.demuxSegment(b, withInit ? { init } : {}); } catch (e) { failed++; assert.match(e.code ?? "", /^DEMUX_/, e.stack); }
    }
    assert.ok(failed < n, "일부는 성공해야 변조가 현실적이다");
  }
});
