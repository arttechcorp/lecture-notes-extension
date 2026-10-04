const test = require("node:test");
const { before, after } = test;
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { execFileSync, spawnSync } = require("node:child_process");
// mux.js UMD의 Node 분기는 require("global/window")를 부르므로 워커의 importScripts처럼 전역 스크립트로 실행한다(TS 픽스처용)
vm.runInThisContext(fs.readFileSync(path.join(__dirname, "vendor/mux/mux-mp4.min.js"), "utf8"));

// VisualGate는 OffscreenCanvas로 표본을 뽑는다. 시험의 "표본"은 {gray}이고 캔버스는 그 값을 그대로 돌려준다.
global.OffscreenCanvas = class {
  constructor(w, h) { this.w = w; this.h = h; }
  getContext() {
    return {
      drawImage: src => { this.gray = src.gray; },
      getImageData: (_x, _y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4).fill(this.gray) }),
    };
  }
};

const BG = require("./background-job.js");
const P = require("./pipeline.js");
const D = require("./media-demux.js");
const { createStore, memoryAdapter } = require("./package-store.js");
const { EventBus } = require("./events.js");
const { TERMS_VERSION } = require("./settings.js");

const GEN = path.join(__dirname, "../tools/make-hls-fixture.mjs");
const has = bin => spawnSync(bin, ["-version"], { stdio: "ignore" }).status === 0;
const NEED_FFMPEG = has("ffmpeg") ? false : "ffmpeg가 없어 HLS 픽스처 시험을 건너뜁니다 (apt install ffmpeg)";
// 픽스처: 24초, 슬라이드(단색) 4초마다 6장, 키프레임 2초마다, 8초 세그먼트 3개. fmp4/는 EXT-X-MAP, plain/은 TS, aes/는 AES-128.
let FX;
before(() => {
  if (NEED_FFMPEG) return;
  FX = fs.mkdtempSync(path.join(os.tmpdir(), "bg-job-fixture-"));
  execFileSync(process.execPath, [GEN, FX], { stdio: "pipe" });
});
after(() => { if (FX) fs.rmSync(FX, { recursive: true, force: true }); });

// ── 도구 ──
const SENTINEL = "SECRET-LECTURE";
const enc = s => new TextEncoder().encode(s);
const clock = (t = 1000) => () => t++;
const tick = () => new Promise(r => setImmediate(r));
const wait = ms => new Promise(r => setTimeout(r, ms));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const nap = async () => {};
const SRC = { playlistUrl: "https://lms.test/fmp4/index.m3u8", pageUrl: "https://lms.test/course/view.php?id=1" };

const settings = { backgroundConsent: { personalUse: true, accessRights: true, version: TERMS_VERSION, at: 1 }, visionConsent: true, visionConsentVersion: TERMS_VERSION, visionConsentAt: 1, remoteSummaryConsent: true, whisperLang: "ko" };
const features = { accountId: "u1", models: [], features: ["vision", "stt", "judge", "background"], config: { concurrency: { download: 4, decode: 1, stt: 4, vision: 8, judge: 2, write: 8 }, throughputMbps: 10000 } };
const models = { plan: "plan-model", write: "write-model", judge: "judge-model", stt: "whisper-large-v3-turbo" };
const withConc = c => ({ ...features, config: { ...features.config, concurrency: { ...features.config.concurrency, ...c } } });

const resp = (status, body, ct = "video/mp4", onBuffer) => ({
  status, ok: status >= 200 && status < 300,
  headers: { get: k => (k.toLowerCase() === "content-type" ? ct : null) },
  arrayBuffer: async () => { const ab = body.slice().buffer; onBuffer?.(ab); return ab; }, body: { cancel() {} },
});
// files(url) → Uint8Array | string | undefined(404). hook(url, 몇 번째 요청인지)가 응답을 돌려주면 그것을 쓴다.
function makeFetch(files, { log = [], hook } = {}) {
  const fn = async (url, init) => {
    log.push({ url, init });
    await tick(); // 진짜 네트워크처럼 이벤트 루프를 한 번 돈다(안 그러면 마이크로태스크만으로 수신이 끝나 암호화 쓰기 완료가 굶는다)
    const hooked = hook?.(url, log.filter(l => l.url === url).length);
    if (hooked) return hooked;
    const body = files(url);
    if (body === undefined) return resp(404, new Uint8Array(0), "text/plain");
    return resp(200, typeof body === "string" ? enc(body) : body, /\.m3u8$/.test(url) ? "application/vnd.apple.mpegurl" : "video/mp4");
  };
  fn.log = log;
  return fn;
}
const fixtureFiles = (extra = () => undefined) => url => extra(url) ?? (() => {
  const p = path.join(FX, new URL(url).pathname.slice(1));
  return fs.existsSync(p) ? new Uint8Array(fs.readFileSync(p)) : undefined;
})();
const urls = fetch => fetch.log.map(l => l.url);
const idxOf = u => +/seg(\d+)\./.exec(u)[1];

// 끝에 `free` 박스를 붙여 세그먼트를 부풀린다(디먹서는 모르는 박스를 건너뛴다)
function pad(bytes, total) {
  const n = total - bytes.length - 8, out = new Uint8Array(total);
  out.set(bytes); new DataView(out.buffer).setUint32(bytes.length, 8 + n); out.set(enc("free"), bytes.length + 4);
  return out;
}
// 같은 fMP4 세그먼트를 n번 되풀이하는 재생목록. 세그먼트마다 PTS가 처음으로 되감기므로 DISCONTINUITY를 붙이고, 시간은 EXTINF 누적으로 이어진다.
const repeated = n => ["#EXTM3U", "#EXT-X-VERSION:7", "#EXT-X-TARGETDURATION:8", "#EXT-X-PLAYLIST-TYPE:VOD", '#EXT-X-MAP:URI="init.mp4"',
  ...Array.from({ length: n }, (_, i) => `${i ? "#EXT-X-DISCONTINUITY\n" : ""}#EXTINF:8.000000,\nseg${i}.m4s`), "#EXT-X-ENDLIST"].join("\n");
const longFiles = (n, { size, over } = {}) => url => {
  const u = new URL(url).pathname;
  if (u === "/long/index.m3u8") return repeated(n);
  if (u === "/long/init.mp4") return new Uint8Array(fs.readFileSync(path.join(FX, "fmp4/init.mp4")));
  if (/^\/long\/seg\d+\.m4s$/.test(u)) { const b = new Uint8Array(fs.readFileSync(path.join(FX, "fmp4/seg0.m4s"))); return over?.(u, b) ?? (size ? pad(b, size) : b); }
};
const LONG = { playlistUrl: "https://lms.test/long/index.m3u8", pageUrl: SRC.pageUrl };

// ── 가짜 의존성 ──
const GRAYS = [30, 90, 150, 210, 60, 120]; // 이웃끼리 18 이상 차이
function fakeDecode({ frames = true, slideSec = 4, speech = true, gate = Promise.resolve(), fail } = {}) {
  const calls = { frames: 0, batches: [], energy: 0, energyTracks: [] };
  return {
    calls,
    async *keyframeImages(kfs, { signal } = {}) {
      calls.batches.push(kfs.map(k => ({ t: k.t, codec: k.codec })));
      fail?.(calls.batches.length);
      if (!frames) return;
      for (const k of kfs) {
        signal?.throwIfAborted(); calls.frames++;
        yield { t: k.t, sample: { gray: GRAYS[Math.floor(k.t / slideSec + 1e-3) % GRAYS.length] }, blob: new Blob([`jpeg@${k.t.toFixed(3)}`]) };
      }
    },
    async audioEnergy(tracks, { frameMs, signal } = {}) {
      calls.energy++; calls.energyTracks.push(tracks.length);
      await gate; await tick();
      signal?.throwIfAborted();
      const t0 = Math.min(...tracks.map(t => t.samples[0].t)), end = Math.max(...tracks.map(t => { const s = t.samples.at(-1); return s.t + s.dur; }));
      const energy = new Float32Array(Math.ceil((end - t0) * 1000 / frameMs));
      // 1초마다 0.8초 발화(0.2)·0.2초 쉼(0.01). 샘플이 없는 구간은 0 = 무음
      if (speech) for (const tr of tracks) for (const s of tr.samples) for (let i = Math.floor((s.t - t0) * 1000 / frameMs); i < Math.ceil((s.t + s.dur - t0) * 1000 / frameMs) && i < energy.length; i++) energy[i] = (i * frameMs) % 1000 < 800 ? 0.2 : 0.01;
      return { t0, frameMs, energy };
    },
  };
}
const slideDoc = ({ slideId, t0, t1 }) => ({
  schemaVersion: 1, slideId, t0, t1, engine: "vision-cloud", model: "fake",
  blocks: [
    { id: "b1", text: `${SENTINEL}-${slideId} 금리 NPV`, role: "title", bbox: { x: 0.1, y: 0.05, w: 0.6, h: 0.1 }, conf: null },
    { id: "b2", text: "학번 2024123456 홍길동", role: "watermark", bbox: { x: 0.7, y: 0.9, w: 0.25, h: 0.06 }, conf: null },
  ],
  formulas: [], figures: [],
});
function fakeVision({ delay = 0, hang = false, onCall } = {}) {
  const calls = [];
  return {
    calls,
    async recognize(blob, meta) {
      calls.push({ ...meta, size: blob.size, text: await blob.text() });
      onCall?.(calls.length);
      if (hang) return new Promise(() => {});
      if (delay) await wait(delay);
      return { data: { text: "x", confidence: null, slideDoc: slideDoc(meta) } };
    },
  };
}
const svcErr = (code, extra) => Object.assign(new Error(code), { code, retryable: false, retryAfterMs: null }, extra);
function fakeStt({ fail } = {}) {
  const calls = [];
  return {
    calls,
    async stt(args) {
      calls.push(args);
      const e = fail?.(args, calls.length);
      if (e) throw e;
      const mid = args.t0 + args.durationSec / 2;
      return { transcript: { schemaVersion: 1, engine: "groq-whisper", model: args.model, lang: args.lang, segments: [{ id: `${Math.round(args.t0 * 1000)}-0`, t0: mid, t1: mid + 2, text: `${SENTINEL} speech ${calls.length}`, words: [], noSpeechProb: null, avgLogprob: null, compressionRatio: null, status: "kept" }] }, usage: { audioSec: args.durationSec, costUsd: 0 } };
    },
  };
}

// 암호화 저장소 + 쓰기 기록(저장소 메서드와 어댑터 양쪽)
async function memStore() {
  const adapter = memoryAdapter(), store = await createStore(adapter), writes = [], rawPuts = new Set();
  for (const m of ["putJson", "putBytes", "appendLogBatch"]) { const f = store[m].bind(store); store[m] = (...a) => (writes.push({ m, store: a[0], id: a[1], value: a[2] }), f(...a)); }
  const put = adapter.put.bind(adapter);
  adapter.put = (s, id, v) => (rawPuts.add(s), put(s, id, v));
  return { store, adapter, writes, rawPuts };
}

async function env(over = {}) {
  const { store, adapter, writes, rawPuts } = over.mem ?? await memStore();
  const bus = new EventBus({ now: clock(), limit: 100000 });
  const job = over.job ?? await P.createJob({ jobId: "j1", store, events: bus, now: clock() });
  const note = { calls: [], fn: null };
  note.fn = over.runNote ?? (async (j, input, o) => (note.calls.push({ input: structuredClone(input), o }), { status: "complete", note: null, notices: [] }));
  const decode = over.decode ?? fakeDecode(), vision = over.vision ?? fakeVision(), stt = over.stt ?? fakeStt(), paints = [];
  const deps = {
    fetch: over.fetch, decode, vision, stt, store, events: bus, settings, features, models, sleep: nap, now: clock(1e6),
    paint: async (blob, boxes) => (paints.push(boxes), new Blob(["PAINTED:" + await blob.text()])),
    runNote: note.fn, ...over.deps,
  };
  const run = (source = SRC, extra = {}) => BG.runBackground(job, source, { ...deps, ...extra });
  return { job, deps, bus, store, adapter, writes, rawPuts, note, decode, vision, stt, paints, run, mem: { store, adapter, writes, rawPuts } };
}
const hits = e => e.vision.calls.length + e.stt.calls.length + e.decode.calls.frames + e.note.calls.length;

// ── 게이트: 네트워크 전에 멈춘다 ──
const bg = { ...settings.backgroundConsent };
const GATES = [
  ["background consent: access rights unchecked", { settings: { ...settings, backgroundConsent: { ...bg, accessRights: false } } }, "paused", "user", "CONSENT_REQUIRED"],
  ["background consent: personal use unchecked", { settings: { ...settings, backgroundConsent: { ...bg, personalUse: false } } }, "paused", "user", "CONSENT_REQUIRED"],
  ["background consent: stale terms version", { settings: { ...settings, backgroundConsent: { ...bg, version: "2000-01-01" } } }, "paused", "user", "CONSENT_REQUIRED"],
  ["plan without the background feature", { features: { ...features, features: ["vision", "stt", "judge"] } }, "failed", null, "SRC_NOT_IN_PLAN"],
  ["cloud recognition consent missing", { settings: { ...settings, visionConsent: false, visionConsentVersion: "", visionConsentAt: 0 } }, "paused", "user", "CONSENT_CLOUD_REQUIRED"],
  ["legacy unversioned vision consent", { settings: { ...settings, visionConsentVersion: "" } }, "paused", "user", "CONSENT_CLOUD_REQUIRED"],
  ["plan without stt", { features: { ...features, features: ["vision", "judge", "background"] } }, "failed", null, "SRC_NOT_IN_PLAN"],
  ["plan without vision", { features: { ...features, features: ["stt", "judge", "background"] } }, "failed", null, "SRC_NOT_IN_PLAN"],
  ["no features at all", { features: undefined }, "failed", null, "SRC_NOT_IN_PLAN"],
  ["youtube page", { source: { ...SRC, pageUrl: "https://www.youtube.com/watch?v=abc" } }, "failed", null, "SRC_UNSUPPORTED_HOST", "live"],
  ["youtube short link", { source: { ...SRC, pageUrl: "https://youtu.be/abc" } }, "failed", null, "SRC_UNSUPPORTED_HOST", "live"],
  ["youtube embed", { source: { ...SRC, pageUrl: "https://www.youtube-nocookie.com/embed/abc" } }, "failed", null, "SRC_UNSUPPORTED_HOST", "live"],
  ["youtube media host in the playlist", { source: { ...SRC, playlistUrl: "https://rr1---sn.googlevideo.com/api/manifest/hls_playlist/x.m3u8" } }, "failed", null, "SRC_UNSUPPORTED_HOST", "live"],
];
for (const [name, over, status, reason, code, suggest] of GATES) {
  test(`gate: ${name} stops before any network or engine call`, async () => {
    const fetch = makeFetch(() => { throw new Error("네트워크에 닿으면 안 된다"); });
    const e = await env({ fetch });
    const r = await e.run(over.source ?? SRC, { ...("settings" in over && { settings: over.settings }), ...("features" in over && { features: over.features }) });
    assert.equal(fetch.log.length, 0, "fetch call count");
    assert.deepEqual([r.status, r.code, r.reason, r.suggest], [status, code, reason, suggest]);
    assert.equal(e.job.state, status);
    assert.equal(e.job.record.code, code);
    assert.equal(hits(e), 0);
    assert.equal(e.decode.calls.energy, 0);
    assert.deepEqual(e.job.record.completed, {}); // 수신은 시작도 하지 않았다
  });
}

test("gate: models are required up front (programmer error, still no network)", async () => {
  const fetch = makeFetch(() => { throw new Error("no"); });
  const e = await env({ fetch });
  await assert.rejects(e.run(SRC, { models: { plan: "p" } }), TypeError);
  assert.equal(fetch.log.length, 0);
});

test("gate: a consent-paused job continues when the same job is run again after consent", { skip: NEED_FFMPEG }, async () => {
  const fetch = makeFetch(fixtureFiles());
  const e = await env({ fetch });
  const first = await e.run(SRC, { settings: { ...settings, backgroundConsent: { ...bg, accessRights: false } } });
  assert.equal(first.status, "paused");
  assert.equal(fetch.log.length, 0);
  const second = await e.run();
  assert.equal(second.status, "complete");
  assert.equal(e.note.calls.length, 1);
  assert.equal(e.job.state, "ingesting");
});

// ── 보호 콘텐츠: 키를 가져오지 않고 멈춘다 ──
test("AES-128 playlist is refused with SRC_PROTECTED, suggests live mode, and the key URI is never requested", { skip: NEED_FFMPEG }, async () => {
  const fetch = makeFetch(fixtureFiles());
  const e = await env({ fetch });
  const r = await e.run({ ...SRC, playlistUrl: "https://lms.test/aes/index.m3u8" });
  assert.deepEqual([r.status, r.code, r.suggest, r.reason], ["failed", "SRC_PROTECTED", "live", null]);
  assert.deepEqual(urls(fetch), ["https://lms.test/aes/index.m3u8"]); // 목록 하나. 키(enc.key)도 세그먼트도 요청하지 않았다
  assert.deepEqual([e.job.state, e.job.stage, e.job.record.code], ["failed", "acquiring_source", "SRC_PROTECTED"]);
  assert.equal(hits(e), 0);
  assert.ok(e.bus.recent().some(x => x.stage === "job" && x.code === "SRC_PROTECTED" && x.level === "error"));
});

test("a master playlist with a SAMPLE-AES SESSION-KEY is DRM: refused before any media playlist, without suggesting live mode", async () => {
  const master = '#EXTM3U\n#EXT-X-SESSION-KEY:METHOD=SAMPLE-AES,URI="skd://key"\n#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=1280x720\nv.m3u8\n';
  const fetch = makeFetch(u => (u.endsWith("master.m3u8") ? master : "#EXTM3U\n"));
  const e = await env({ fetch });
  const r = await e.run({ ...SRC, playlistUrl: "https://lms.test/master.m3u8" });
  assert.deepEqual([r.status, r.code, r.suggest], ["failed", "SRC_DRM", undefined]);
  assert.deepEqual(urls(fetch), ["https://lms.test/master.m3u8"]);
});

test("a media playlist that is not finished (live) or not HLS is a coded failure, not a partial result", async () => {
  for (const body of ["#EXTM3U\n#EXT-X-TARGETDURATION:8\n#EXTINF:8,\nseg0.ts\n", "<html>", "#EXTM3U\n#EXT-X-TARGETDURATION:8\n#EXT-X-ENDLIST\n"]) {
    const e = await env({ fetch: makeFetch(() => body) });
    const r = await e.run();
    assert.deepEqual([r.status, r.code], ["failed", "SRC_BAD_PLAYLIST"], body);
  }
});

// ── 정상 경로 ──
test("happy path (fMP4): vision only on slide changes, STT chunk within limits, runNote gets slides and transcript", { skip: NEED_FFMPEG }, async () => {
  const fetch = makeFetch(fixtureFiles());
  const visionDone = deferred();
  const e = await env({ fetch, vision: fakeVision({ onCall: n => n === 6 && visionDone.resolve() }), decode: fakeDecode({ gate: visionDone.promise }) });
  const r = await e.run();
  assert.equal(r.status, "complete");
  assert.equal(e.note.calls.length, 1);
  const { input, o } = e.note.calls[0];

  // 화면: 키프레임 12개 중 슬라이드가 바뀐 6번만 비전으로 간다
  assert.equal(e.decode.calls.frames, 12);
  assert.ok(e.decode.calls.batches.flat().every(k => k.codec.startsWith("avc1.")));
  assert.equal(e.vision.calls.length, 6);
  assert.deepEqual(input.slides.map(s => s.slideId), ["s0", "s1", "s2", "s3", "s4", "s5"]);
  assert.deepEqual(input.slides.map(s => Math.round(s.t0)), [0, 4, 8, 12, 16, 20]);
  assert.ok(input.slides.every((s, i) => s.t1 >= s.t0 && (!input.slides[i + 1] || s.t1 === input.slides[i + 1].t0)));
  // 마스크: 처음 5장은 그대로, 그 결과로 배운 영역은 6번째부터 칠해서 보낸다
  assert.equal(e.paints.length, 1);
  const [box] = e.paints[0];
  assert.deepEqual([box.x, box.y, box.w, box.h].map(v => Math.round(v * 1e6) / 1e6), [0.7, 0.9, 0.25, 0.06]);
  assert.deepEqual(e.vision.calls.map(c => c.text.startsWith("PAINTED:")), [false, false, false, false, false, true]);

  // 음성: 청크 하나, 서비스 한도 안, 슬라이드 용어가 prompt로
  assert.equal(e.stt.calls.length, 1);
  const [call] = e.stt.calls, b64 = call.audio.slice("data:audio/mp4;base64,".length);
  assert.ok(call.audio.startsWith("data:audio/mp4;base64,"));
  assert.ok(call.durationSec > 0 && call.durationSec <= D.MAX_CHUNK_SEC, String(call.durationSec));
  assert.ok(Buffer.from(b64, "base64").length <= D.MAX_CHUNK_BYTES);
  assert.deepEqual([call.lang, call.model, Math.round(call.t0)], ["ko", models.stt, 0]);
  assert.equal(call.jobId, "j1"); // stt 도 같은 작업 번호로 묶인다
  assert.match(call.prompt, /NPV/);
  assert.ok(call.prompt.length <= 1000);
  assert.deepEqual([input.transcript.engine, input.transcript.model, input.transcript.lang, input.transcript.segments.length, input.transcript.segments[0].status], ["groq-whisper", models.stt, "ko", 1, "kept"]);

  // runNote 계약
  assert.deepEqual([input.tier, input.gaps, input.consent, input.models], ["paid", [], { summary: true }, { plan: "plan-model", write: "write-model", judge: "judge-model" }]);
  assert.equal(input.host, "lms.test"); // runNote 입력에 강의 페이지 호스트명
  assert.deepEqual(Object.keys(o).sort(), ["concurrency", "events", "signal", "sleep"]);
  assert.deepEqual(o.concurrency, features.config.concurrency);

  // 수신: 목록 + init 한 번 + 세그먼트 3개. 모든 요청이 no-store·credentials include
  assert.deepEqual(urls(fetch).map(u => u.split("/").pop()).sort(), ["index.m3u8", "init.mp4", "seg0.m4s", "seg1.m4s", "seg2.m4s"]);
  assert.ok(fetch.log.every(l => l.init.cache === "no-store" && l.init.credentials === "include"));
  // 메모리: 다 쓰고 나면 0, 최대치는 세 세그먼트를 한꺼번에 쥔 것보다 작다
  assert.deepEqual([r.stats.segments, r.stats.slides, r.stats.chunks, r.stats.gaps, r.stats.heldBytes], [3, 6, 1, 0, 0]);
  assert.ok(r.stats.peakBytes > 0 && r.stats.peakBytes < 450000, String(r.stats.peakBytes)); // 세그먼트 3개(~210KB)와 그 오디오·이미지
  assert.deepEqual([e.job.state, e.job.record.completed.ingest], ["ingesting", "done"]);
});

test("whisperLang auto reaches STT and the transcript meta as auto", { skip: NEED_FFMPEG }, async () => {
  const e = await env({ fetch: makeFetch(fixtureFiles()) });
  const r = await e.run(SRC, { settings: { ...settings, whisperLang: "auto" } });
  assert.equal(r.status, "complete");
  assert.equal(e.stt.calls[0].lang, "auto");
  const { input } = e.note.calls[0];
  assert.equal(input.transcript.lang, "auto");
  assert.equal(input.meta.lang, "auto");
});

test("with decoded PCM the STT chunk goes out as a 16 kHz mono WAV of the same span", { skip: NEED_FFMPEG }, async () => {
  const D = require("./media-decode.js"), base = fakeDecode(), seen = [];
  const decode = { ...base, wavSlice: (pcm, t0, t1) => (seen.push([t0, t1]), D.wavSlice(pcm, t0, t1)),
    async audioEnergy(tracks, o) { const r = await base.audioEnergy(tracks, o); assert.equal(o.pcmRate, 16000); return { ...r, pcm: D.makePcm(r.t0, r.t0 + r.energy.length * r.frameMs / 1000, o.pcmRate) }; } };
  const e = await env({ fetch: makeFetch(fixtureFiles()), decode });
  assert.equal((await e.run()).status, "complete");
  assert.ok(e.stt.calls.length >= 1);
  for (const c of e.stt.calls) assert.match(c.audio, /^data:audio\/wav;base64,UklGR/);
  assert.equal(seen.length, e.stt.calls.length);
});

test("happy path (MPEG-TS via mux.js): same slides and one STT chunk", { skip: NEED_FFMPEG }, async () => {
  const e = await env({ fetch: makeFetch(fixtureFiles()) });
  const r = await e.run({ ...SRC, playlistUrl: "https://lms.test/plain/index.m3u8" });
  assert.equal(r.status, "complete");
  assert.deepEqual([e.vision.calls.length, e.stt.calls.length], [6, 1]);
  assert.deepEqual(e.note.calls[0].input.slides.map(s => Math.round(s.t0)), [0, 4, 8, 12, 16, 20]);
});

test("a silent recording is never sent to STT", { skip: NEED_FFMPEG }, async () => {
  const e = await env({ fetch: makeFetch(fixtureFiles()), decode: fakeDecode({ speech: false }) });
  const r = await e.run();
  assert.equal(r.status, "complete");
  assert.equal(e.stt.calls.length, 0);
  assert.equal(e.note.calls[0].input.transcript.segments.length, 0);
  assert.equal(e.note.calls[0].input.slides.length, 6);
});

// ── 롤링 창과 메모리 ──
test("rolling window: long audio becomes overlapping chunks within limits while segment buffers are released", { skip: NEED_FFMPEG }, async () => {
  const SIZE = 400000, N = 60; // 480초
  const fetch = makeFetch(longFiles(N, { size: SIZE }));
  const e = await env({ fetch, decode: fakeDecode({ slideSec: 60 }) });
  const r = await e.run(LONG);
  assert.equal(r.status, "complete");
  assert.equal(e.stt.calls.length, 2);
  const [a, b] = e.stt.calls;
  for (const c of e.stt.calls) assert.ok(c.durationSec > 0 && c.durationSec <= D.MAX_CHUNK_SEC, String(c.durationSec));
  assert.ok(a.t0 < 1 && a.t0 + a.durationSec > 290 && a.t0 + a.durationSec < 330, "첫 청크는 ~300초 무음 근처에서 자른다");
  assert.ok(b.t0 < a.t0 + a.durationSec && b.t0 > a.t0 + a.durationSec - 10, "다음 청크는 겹쳐서 시작한다");
  assert.ok(Math.abs(b.t0 + b.durationSec - 480) < 6, "마지막 청크는 끝까지(길이는 담긴 샘플 길이의 합이라 세그먼트 사이 틈만큼 짧다)");
  const { transcript, slides } = e.note.calls[0].input;
  assert.deepEqual(transcript.segments.map(s => s.t0), transcript.segments.map(s => s.t0).sort((x, y) => x - y));
  assert.equal(transcript.segments.length, 2);
  assert.equal(slides.length, 8);
  // 28MB를 받았지만 한꺼번에 쥔 것은 수 MB: 받은 즉시 풀린다
  assert.equal(urls(fetch).filter(u => u.endsWith(".m4s")).length, N);
  assert.ok(r.stats.peakBytes < 8e6, String(r.stats.peakBytes));
  assert.equal(r.stats.heldBytes, 0);
});

test("backpressure: a slow vision engine stops receiving before in-flight bytes pass the budget", { skip: NEED_FFMPEG }, async () => {
  const SIZE = 4e6, BUDGET = 14e6, N = 12;
  const fetch = makeFetch(longFiles(N, { size: SIZE }));
  const e = await env({ fetch, vision: fakeVision({ delay: 15 }), deps: { features: withConc({ vision: 1 }), budget: { bytes: BUDGET, stallMs: 60000 } } });
  const r = await e.run(LONG);
  assert.equal(r.status, "complete");
  assert.ok(r.stats.peakBytes <= BUDGET, `${r.stats.peakBytes} <= ${BUDGET}`);
  assert.ok(r.stats.peakBytes >= 2 * SIZE, "예산이 실제로 쓰였다");
  assert.ok(e.bus.recent().some(x => x.stage === "recv" && x.msg === "mem-wait"), "수신이 예산 때문에 멈춘 적이 있다");
  assert.equal(r.stats.segments, N);
  assert.equal(e.vision.calls.length, r.stats.slides); // 막았을 뿐 잃은 장은 없다
  assert.ok(r.stats.slides >= N);
  assert.equal(r.stats.heldBytes, 0);
});

test("MEM_BUDGET_EXCEEDED: overflow that persists fails the job instead of waiting forever", { skip: NEED_FFMPEG }, async () => {
  // (1) 세그먼트 하나가 예산보다 크다: 다음 수신은 아무것도 풀어 줄 게 없어 멈춘 채 시간이 간다
  let e = await env({ fetch: makeFetch(longFiles(6)), deps: { budget: { bytes: 50000, stallMs: 30 } } });
  let r = await e.run(LONG);
  assert.deepEqual([r.status, r.code, r.reason], ["failed", "MEM_BUDGET_EXCEEDED", null]);
  assert.equal(e.job.state, "failed");
  assert.equal(e.note.calls.length, 0);
  // (2) 비전이 응답하지 않아 큐가 가득 찬다
  e = await env({ fetch: makeFetch(longFiles(24, { size: 1e6 })), vision: fakeVision({ hang: true }), deps: { features: withConc({ vision: 1 }), budget: { bytes: 6e6, stallMs: 30 } } });
  r = await e.run(LONG);
  assert.deepEqual([r.status, r.code], ["failed", "MEM_BUDGET_EXCEEDED"]);
});

// ── 구간 오류 ──
test("a corrupt segment becomes a gap notice and the job keeps going", { skip: NEED_FFMPEG }, async () => {
  const e = await env({ fetch: makeFetch(fixtureFiles(u => (u.endsWith("seg1.m4s") ? new Uint8Array(fs.readFileSync(path.join(FX, "fmp4/seg1.m4s"))).subarray(0, 200) : undefined))) });
  const r = await e.run();
  assert.equal(r.status, "complete");
  const { input } = e.note.calls[0];
  assert.deepEqual(input.gaps, [{ reason: "decode", t0: 8, t1: 16 }]);
  assert.deepEqual(input.slides.map(s => Math.round(s.t0)), [0, 4, 16, 20]);
  assert.equal(e.stt.calls.length, 2); // 오디오는 구멍 앞뒤 두 조각
  assert.deepEqual(e.stt.calls.map(c => Math.round(c.t0)), [0, 16]);
  const warn = e.bus.recent().filter(x => x.level === "warn" && x.code === "SRC_DECODE_FAILED");
  assert.deepEqual(warn.map(x => [x.stage, x.unit, x.msg]), [["ingest", "8", "gap:decode"]]);
  assert.equal(e.job.state, "ingesting");
});

test("a decoder failure on one segment is a gap; an unsupported decoder fails the job", { skip: NEED_FFMPEG }, async () => {
  let e = await env({ fetch: makeFetch(fixtureFiles()), decode: fakeDecode({ fail: n => { if (n === 2) throw svcErr("DECODE_FAILED"); } }) });
  let r = await e.run();
  assert.equal(r.status, "complete");
  assert.deepEqual(e.note.calls[0].input.gaps, [{ reason: "decode", t0: 8, t1: 16 }]);
  e = await env({ fetch: makeFetch(fixtureFiles()), decode: fakeDecode({ fail: () => { throw svcErr("DECODE_UNSUPPORTED"); } }) });
  r = await e.run();
  assert.deepEqual([r.status, r.code], ["failed", "DECODE_UNSUPPORTED"]);
  assert.equal(e.note.calls.length, 0);
});

test("a recognition failure on one slide or chunk is a gap notice; any other failure stops", { skip: NEED_FFMPEG }, async () => {
  let n = 0;
  const vision = fakeVision();
  const recognize = vision.recognize.bind(vision);
  vision.recognize = async (b, m) => { if (++n === 3) throw svcErr("provider_failed_or_invalid_output"); return recognize(b, m); };
  const e = await env({ fetch: makeFetch(fixtureFiles()), vision, stt: fakeStt({ fail: () => svcErr("invalid_audio") }) });
  const r = await e.run();
  assert.equal(r.status, "complete");
  const gaps = e.note.calls[0].input.gaps;
  assert.deepEqual(gaps.map(g => g.reason).sort(), ["stt", "vision"]);
  assert.equal(e.note.calls[0].input.slides.length, 5);
  // 계약이 맞지 않는 비전 오류(버그·버전 불일치)는 공백으로 덮지 않고 코드로 실패시킨다
  const e2 = await env({ fetch: makeFetch(fixtureFiles()), vision: { recognize: async () => { throw svcErr("invalid_model"); } } });
  const r2 = await e2.run();
  assert.deepEqual([r2.status, r2.code], ["failed", "VIS_INVALID_MODEL"]);
});

// ── 일시정지: 인증·네트워크·한도. 엔진을 바꾸지 않는다 ──
test("401 on a segment pauses with reason auth; running again resumes from the checkpoint without re-receiving or re-recognizing", { skip: NEED_FFMPEG }, async () => {
  const N = 60;
  let expired = true;
  const fetch = makeFetch(longFiles(N), { hook: u => (expired && /seg55\.m4s$/.test(u) ? resp(401, new Uint8Array(0), "text/plain") : undefined) });
  const e = await env({ fetch, decode: fakeDecode({ slideSec: 60 }) });
  const first = await e.run(LONG);
  assert.deepEqual([first.status, first.reason, first.code], ["paused", "auth", "SRC_AUTH_EXPIRED"]);
  assert.deepEqual([e.job.state, e.job.stage, e.job.record.reason], ["paused", "ingesting", "auth"]);
  assert.equal(e.note.calls.length, 0);
  const cursor = JSON.parse(e.job.record.completed.ingest).av;
  assert.equal(cursor[1], N);
  // 오디오 창(~350초)이 아직 안 비워진 구간부터 다시 받는다: 처음은 아니고 401 지점보다 앞
  assert.ok(cursor[0] > 20 && cursor[0] < 55, String(cursor[0]));
  assert.equal(e.stt.calls.length, 1);
  const vision1 = e.vision.calls.length;
  const stored = (await e.store.ids("packages")).filter(i => /:(sd|tr):\d+$/.test(i));
  assert.equal(stored.length, vision1 + 1); // 슬라이드마다 하나 + 전사 청크 하나

  expired = false;
  fetch.log.length = 0;
  const second = await e.run(LONG);
  assert.equal(second.status, "complete");
  const segs = urls(fetch).filter(u => u.endsWith(".m4s")).map(idxOf);
  assert.deepEqual(segs.sort((x, y) => x - y), Array.from({ length: N - cursor[0] }, (_, i) => cursor[0] + i));
  // 이미 인식한 구간의 슬라이드는 다시 보내지 않는다: 새 호출은 이전 마지막 슬라이드 이후만
  const lastT1 = Math.max(...e.vision.calls.slice(0, vision1).map(c => c.t1));
  assert.ok(e.vision.calls.slice(vision1).every(c => c.t0 > lastT1), "재전송 없음");
  assert.ok(e.vision.calls.length - vision1 <= 3);
  // 전사는 앞 청크(저장소에서)와 새 청크가 이어진다
  const { slides, transcript } = e.note.calls[0].input;
  assert.equal(e.stt.calls.length, 2);
  assert.equal(transcript.segments.length, 2);
  assert.ok(e.stt.calls[1].t0 >= e.stt.calls[0].t0 + e.stt.calls[0].durationSec - 8);
  assert.ok(slides.length >= 8);
  assert.equal(e.job.record.completed.ingest, "done");
});

test("a stale playlist length on resume is refused instead of resuming at the wrong index", { skip: NEED_FFMPEG }, async () => {
  let n = 60;
  const fetch = makeFetch(url => longFiles(n)(url), { hook: u => (n === 60 && /seg55\.m4s$/.test(u) ? resp(401, new Uint8Array(0), "text/plain") : undefined) });
  const e = await env({ fetch, decode: fakeDecode({ slideSec: 60 }) });
  assert.equal((await e.run(LONG)).status, "paused");
  n = 61;
  const r = await e.run(LONG);
  assert.deepEqual([r.status, r.code], ["failed", "SRC_BAD_PLAYLIST"]);
});

test("401 on the playlist pauses at acquiring_source; running again continues from there", { skip: NEED_FFMPEG }, async () => {
  const fetch = makeFetch(fixtureFiles(), { hook: (u, n) => (u.endsWith("index.m3u8") && n === 1 ? resp(403, new Uint8Array(0), "text/plain") : undefined) });
  const e = await env({ fetch });
  const first = await e.run();
  assert.deepEqual([first.status, first.reason, first.code, e.job.stage], ["paused", "auth", "SRC_AUTH_EXPIRED", "acquiring_source"]);
  assert.equal(urls(fetch).length, 1);
  const second = await e.run();
  assert.equal(second.status, "complete");
  assert.equal(e.job.state, "ingesting");
  assert.equal(e.vision.calls.length, 6);
});

test("DISCONTINUITY with an audio configuration change keeps lecture time continuous and splits audio per configuration", { skip: NEED_FFMPEG }, async () => {
  const e = await env({ fetch: makeFetch(fixtureFiles()) });
  const r = await e.run({ ...SRC, playlistUrl: "https://lms.test/disc/index.m3u8" });
  assert.equal(r.status, "complete");
  assert.deepEqual(e.note.calls[0].input.slides.map(s => Math.round(s.t0)), [0, 4, 8, 12, 16, 20]);
  assert.equal(e.stt.calls.length, 2); // 44.1kHz 조각과 48kHz 조각은 한 m4a에 담을 수 없다
  assert.deepEqual(e.stt.calls.map(c => Math.round(c.t0)), [0, 16]);
});

test("an expired session that returns an HTML login page pauses with auth too", async () => {
  const e = await env({ fetch: makeFetch(() => undefined, { hook: () => resp(200, enc("<html>login</html>"), "text/html; charset=utf-8") }) });
  const r = await e.run();
  assert.deepEqual([r.status, r.reason, r.code], ["paused", "auth", "SRC_AUTH_EXPIRED"]);
});

test("5xx that outlasts the polite backoff pauses as network", { skip: NEED_FFMPEG }, async () => {
  const fetch = makeFetch(fixtureFiles(), { hook: u => (u.endsWith("seg1.m4s") ? resp(503, new Uint8Array(0), "text/plain") : undefined) });
  const e = await env({ fetch });
  const r = await e.run();
  assert.deepEqual([r.status, r.reason, r.code], ["paused", "network", "NET_UNREACHABLE"]);
  assert.equal(fetch.log.filter(l => l.url.endsWith("seg1.m4s")).length, 4); // 첫 요청 + 재시도 3
  assert.equal(e.note.calls.length, 0);
});

test("STT and vision outages pause and ask; they never switch engines", { skip: NEED_FFMPEG }, async () => {
  const busy = () => svcErr("provider_busy", { retryable: true });
  let e = await env({ fetch: makeFetch(fixtureFiles()), stt: fakeStt({ fail: busy }) });
  let r = await e.run();
  assert.deepEqual([r.status, r.reason, r.code], ["paused", "network", "STT_UNAVAILABLE"]);
  assert.equal(e.stt.calls.length, 4); // transcribeChunks의 백오프 재시도 3번 포함
  assert.equal(e.note.calls.length, 0);
  e = await env({ fetch: makeFetch(fixtureFiles()), stt: fakeStt({ fail: () => svcErr("quota_exceeded") }) });
  r = await e.run();
  assert.deepEqual([r.status, r.reason, r.code], ["paused", "quota", "QUOTA_EXCEEDED"]);
  e = await env({ fetch: makeFetch(fixtureFiles()), vision: { recognize: async () => { throw busy(); } } });
  r = await e.run();
  assert.equal(r.status, "paused");
  assert.equal(r.reason, "network");
  assert.match(r.code, /^VIS_(UNAVAILABLE|CIRCUIT_OPEN)$/);
});

test("a job paused after ingest continues from the stored artifacts without any new work", { skip: NEED_FFMPEG }, async () => {
  const fetch = makeFetch(fixtureFiles());
  let calls = 0;
  const runNote = async (job, input) => {
    calls++; inputs.push(structuredClone(input));
    if (calls === 1) { await job.transition("refining"); await job.transition("paused", { reason: "quota", code: "QUOTA_EXCEEDED" }); return { status: "paused", code: "QUOTA_EXCEEDED", reason: "quota" }; }
    return { status: "complete", note: null, notices: [] };
  };
  const inputs = [];
  const e = await env({ fetch, runNote });
  const first = await e.run();
  assert.deepEqual([first.status, first.code], ["paused", "QUOTA_EXCEEDED"]);
  const before = [fetch.log.length, e.vision.calls.length, e.stt.calls.length];
  const second = await e.run();
  assert.equal(second.status, "complete");
  assert.deepEqual([fetch.log.length, e.vision.calls.length, e.stt.calls.length], before);
  assert.deepEqual(inputs[1], inputs[0]); // 저장소에서 복원한 슬라이드·전사가 처음과 같다
  assert.equal(inputs[1].slides.length, 6);
  assert.equal(inputs[1].transcript.segments.length, 1);
});

test("a finished job is returned as is", async () => {
  const e = await env({ fetch: makeFetch(() => { throw new Error("no"); }) });
  await e.job.transition("failed", { code: "SRC_PROTECTED" });
  const r = await e.run();
  assert.deepEqual([r.status, r.code], ["failed", "SRC_PROTECTED"]);
});

// ── 분리된 오디오 렌디션 ──
test("a separate audio rendition is received as its own stream and feeds STT, not the video segments' audio", { skip: NEED_FFMPEG }, async () => {
  const master = '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="ko",DEFAULT=YES,URI="a.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=1280x720,AUDIO="aud"\nv.m3u8\n';
  const media = fs.readFileSync(path.join(FX, "fmp4/index.m3u8"), "utf8");
  const fetch = makeFetch(fixtureFiles(u => (u.endsWith("fmp4/master.m3u8") ? master : /fmp4\/[av]\.m3u8$/.test(u) ? media : undefined)));
  const e = await env({ fetch });
  const r = await e.run({ ...SRC, playlistUrl: "https://lms.test/fmp4/master.m3u8" });
  assert.equal(r.status, "complete");
  const count = name => urls(fetch).filter(u => u.endsWith(name)).length;
  assert.deepEqual(["v.m3u8", "a.m3u8", "init.mp4", "seg0.m4s", "seg2.m4s"].map(count), [1, 1, 1, 2, 2]); // 영상 스트림과 오디오 스트림이 각각 받는다
  assert.deepEqual([e.vision.calls.length, e.stt.calls.length], [6, 1]);
  assert.equal(e.decode.calls.frames, 12); // 영상 쪽에서만 키프레임
  assert.equal(r.stats.heldBytes, 0);
});

// ── 취소 ──
test("abort: the job is cancelled, receiving stops, nothing is handed to runNote, buffers are released", { skip: NEED_FFMPEG }, async () => {
  const ctl = new AbortController();
  const fetch = makeFetch(longFiles(60, { size: 400000 }));
  const e = await env({ fetch, vision: fakeVision({ hang: true, onCall: n => n === 1 && ctl.abort() }), decode: fakeDecode({ slideSec: 20 }), deps: { signal: ctl.signal } });
  const r = await e.run(LONG);
  assert.deepEqual([r.status, e.job.state], ["cancelled", "cancelled"]);
  assert.equal(e.note.calls.length, 0);
  const after = fetch.log.length;
  assert.ok(after < 40, `수신이 멈췄다 (${after}/62)`);
  await wait(30);
  assert.equal(fetch.log.length, after, "취소 뒤에는 요청이 없다");
  assert.equal(r.stats.peakBytes > 0, true);
});

test("abort while receiving the playlists", async () => {
  const ctl = new AbortController();
  const e = await env({ fetch: async (u, init) => new Promise((_, rej) => { init.signal.addEventListener("abort", () => rej(new DOMException("취소됨", "AbortError"))); queueMicrotask(() => ctl.abort()); }), deps: { signal: ctl.signal } });
  const r = await e.run();
  assert.deepEqual([r.status, e.job.state], ["cancelled", "cancelled"]);
});

test("abort: segment buffers are garbage once the run is over (needs node --expose-gc)", { skip: typeof gc === "function" ? false : "node --expose-gc 필요" }, async () => {
  if (NEED_FFMPEG) return;
  const ctl = new AbortController(), refs = [];
  const base = longFiles(60, { size: 400000 });
  // 수신기에 넘긴 ArrayBuffer만 약하게 쥔다(시험이 강하게 쥐면 안 된다)
  const e = await env({ fetch: makeFetch(base, { hook: u => (/seg\d+\.m4s/.test(u) ? resp(200, base(u), "video/mp4", ab => refs.push(new WeakRef(ab))) : undefined) }), vision: fakeVision({ hang: true, onCall: n => n === 1 && ctl.abort() }), decode: fakeDecode({ slideSec: 20 }), deps: { signal: ctl.signal } });
  await e.run(LONG);
  for (let i = 0; i < 5; i++) { await wait(10); gc(); }
  assert.ok(refs.length > 3);
  assert.equal(refs.filter(r => r.deref()).length, 0);
});

// ── 내용 없는 이벤트·저장소 ──
test("events never carry lecture text and every stage reports through the bus", { skip: NEED_FFMPEG }, async () => {
  const e = await env({ fetch: makeFetch(fixtureFiles(u => (u.endsWith("seg1.m4s") ? new Uint8Array(fs.readFileSync(path.join(FX, "fmp4/seg1.m4s"))).subarray(0, 200) : undefined))) });
  await e.run();
  assert.ok(e.vision.calls.length > 0 && e.stt.calls.length > 0);
  const events = e.bus.recent();
  assert.ok(events.length > 20);
  const text = JSON.stringify(events);
  for (const s of [SENTINEL, "금리", "NPV", "학번", "홍길동", "2024123456", "speech", "jpeg@", "PAINTED"]) assert.equal(text.includes(s), false, s);
  for (const stage of ["job", "recv", "decode", "vision", "stt", "ingest"]) assert.ok(events.some(x => x.stage === stage), stage);
  assert.ok(events.filter(x => x.stage === "stt").every(x => x.unit.startsWith("chunk-")));
  assert.ok(events.filter(x => x.stage === "stt" && x.status === "running").every(x => x.model === models.stt));
  // 같은 위치 규칙: msg는 짧은 진단뿐
  assert.ok(events.every(x => (x.msg ?? "").length <= 40));
});

test("only encrypted derived artifacts and the job record are written; raw media never is", { skip: NEED_FFMPEG }, async () => {
  const e = await env({ fetch: makeFetch(fixtureFiles(u => (u.endsWith("seg1.m4s") ? new Uint8Array(fs.readFileSync(path.join(FX, "fmp4/seg1.m4s"))).subarray(0, 200) : undefined))) });
  await e.run();
  assert.ok(e.writes.length > 0);
  assert.ok(e.writes.every(w => w.m === "putJson"), "바이트 저장은 없다: " + [...new Set(e.writes.map(w => w.m))]);
  assert.deepEqual([...new Set(e.writes.map(w => w.store))].sort(), ["jobs", "packages"]);
  assert.deepEqual([...e.rawPuts].sort(), ["jobs", "packages"]); // 어댑터에는 blobs·logs 저장소가 닿지 않았다
  const kinds = new Set(e.writes.filter(w => w.store === "packages").map(w => w.id.replace(/\d+$/, "N")));
  assert.deepEqual([...kinds].sort(), ["j1:gaps", "j1:sd:N", "j1:tr:N"]);
  assert.ok(e.writes.filter(w => w.store === "jobs").every(w => w.id === "j1"));
  // 값은 순수 JSON(문자열·수·배열·객체)이고, 형식화 배열·Blob이 들어 있지 않다
  const bad = v => ArrayBuffer.isView(v) || v instanceof ArrayBuffer || (typeof Blob !== "undefined" && v instanceof Blob) || (v && typeof v === "object" && Object.values(v).some(bad));
  assert.equal(e.writes.some(w => bad(w.value)), false);
  // 암호문: 어댑터에 저장된 것은 iv·ct뿐, 평문 강의 내용은 없다
  for (const [, rec] of await e.adapter.entries("packages")) {
    assert.deepEqual(Object.keys(rec).sort(), ["ct", "iv", "meta", "schemaVersion", "v"]);
    assert.equal(Buffer.from(rec.ct).includes(SENTINEL), false);
  }
  // 작업 기록에는 커서와 상태뿐
  const rec = await e.store.getJson("jobs", "j1");
  assert.equal(JSON.stringify(rec).includes(SENTINEL), false);
  assert.ok(JSON.stringify(rec).length < 600);
});

test("this module has no browser-storage, download or cache-API use (same audit the packager applies to media modules)", async () => {
  const { auditMediaSource } = await import("../tools/package-cws.mjs");
  const src = fs.readFileSync(path.join(__dirname, "background-job.js"), "utf8");
  assert.deepEqual(auditMediaSource("lib/media-background-job.js", src), []);
  // 수신기에 넘기는 fetch는 주입값이고, 수신기가 cache:"no-store"를 붙인다(위 정상 경로 시험이 모든 요청을 확인)
  assert.equal(/\bfetch\s*\(/.test(src.replace(/\/\/.*$/gm, "")), false);
});
