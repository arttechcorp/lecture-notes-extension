// lib/media-decode.js를 진짜 WebCodecs로 시험한다: 합성 HLS 픽스처(tools/make-hls-fixture.mjs, ffmpeg 필요)를 로컬 서버로 내고,
// Worker 안에서 디코드한다(운영과 같은 DOM 없는 환경). 필요: CHROME_PATH = H.264·AAC를 디코드하는 Chrome(Chrome 또는 Chrome for Testing).
// Playwright 번들 Chromium은 둘 다 디코드하지 못한다. Playwright 위치는 PLAYWRIGHT_MODULE(없으면 require("playwright")).
const http = require("node:http"), fs = require("node:fs"), os = require("node:os"), path = require("node:path"), assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const Stt = require("../lib/stt-client.js");
const root = path.resolve(__dirname, "..");
const LIBS = ["lib/vendor/mux/mux-mp4.min.js", "lib/media-source.js", "lib/media-demux.js", "lib/visual-gate.js", "lib/media-decode.js"];
const MAX_JPEG = 1536 * 1024, SLIDES = ["ff0000", "00ff00", "0000ff", "ffff00", "ff00ff", "00ffff"]; // 픽스처의 슬라이드 색(4초마다)

// Worker 안에서 도는 본문. 바깥 변수를 쓰지 않는다(소스 문자열로 Worker에 실린다).
async function body({ origin }) {
  const get = async u => new Uint8Array(await (await fetch(u, { cache: "no-store" })).arrayBuffer());
  const arr = e => ({ t0: e.t0, frameMs: e.frameMs, energy: Array.from(e.energy) });
  const code = p => p.then(() => null, e => typeof e.code === "string" ? e.code : e.name);

  async function one(name) {
    const timing = {};
    const timed = async (key, fn) => { const t = performance.now(); const r = await fn(); timing[key] = Math.round(performance.now() - t); return r; };
    const base = `${origin}/fx/${name}/`, pl = LectureMedia.parseM3U8(new TextDecoder().decode(await get(base + "index.m3u8")), base + "index.m3u8");
    const segs = await timed("demux", async () => { const out = []; for (const seg of pl.segments) out.push(LectureDemux.demuxSegment(await get(seg.uri), { start: seg.start })); return out; });
    const kfs = segs.flatMap(s => LectureDemux.keyframes(s.video)), tracks = segs.map(s => s.audio);

    // 키프레임 → 샘플·JPEG. 샘플은 운영과 같이 VisualGate(비전 모드)에 먹인다.
    const gate = new VisualGate({ mode: "vision" }), frames = [], accepted = [];
    await timed("video", async () => {
      for await (const k of LectureDecode.keyframeImages(kfs)) {
        const bmp = await createImageBitmap(k.blob), px = k.sample.getContext("2d").getImageData(128, 72, 1, 1).data;
        frames.push({ t: k.t, size: k.blob.size, type: k.blob.type, magic: Array.from(new Uint8Array(await k.blob.slice(0, 3).arrayBuffer())), w: bmp.width, h: bmp.height, sw: k.sample.width, sh: k.sample.height, rgb: Array.from(px.slice(0, 3)) });
        bmp.close();
        const r = gate.inspect(k.sample, k.t * 1000);
        if (r.accept) { accepted.push(k.t); gate.complete(r.sample); }
      }
    });
    let scaled = null;
    for await (const k of LectureDecode.keyframeImages(kfs.slice(0, 2), { maxSide: 160 })) { const b = await createImageBitmap(k.blob); scaled = { w: b.width, h: b.height }; b.close(); }

    const audio = await timed("audio", () => LectureDecode.audioEnergy(tracks));
    const out = { name, segments: pl.segments.length, keyframes: kfs.length, frames, gate: { accepted, slideId: gate.slideId }, scaled, audio: arr(audio), ms: timing };
    if (name === "plain") {
      // 노이즈 1080p 키프레임: 기본 품질로는 한도 안, quality:1은 한도를 넘어 한 번 낮춘 결과(= quality 0.6로 바로 낸 것)와 같아야 한다
      const nk = LectureDemux.keyframes(LectureDemux.demuxSegment(await get(`${origin}/fx/noise.ts`)).video);
      const size = async o => { let n = 0; for await (const k of LectureDecode.keyframeImages(nk, o)) n = k.blob.size; return n; };
      // 서로 다른 avcC(320×180 ↔ 1920×1080)가 섞인 목록: 설정이 바뀔 때마다 다시 configure하고 순서를 지킨다
      out.mixed = [];
      for await (const k of LectureDecode.keyframeImages([...kfs.slice(0, 2), ...nk, ...kfs.slice(2, 4)])) { const b = await createImageBitmap(k.blob); out.mixed.push([+k.t.toFixed(2), b.width, b.height]); b.close(); }
      out.noise = { keyframes: nk.length, byDefault: await size({}), quality1: await size({ quality: 1 }), quality06: await size({ quality: 0.6 }) };
      // 가운데 세그먼트를 빼면 8~16초가 구멍(무음)이어야 한다 — 트랙 시각이 타임라인에 맞게 놓였는지 본다
      out.gap = arr(await LectureDecode.audioEnergy([tracks[0], tracks[2]]));
      const pre = new AbortController(); pre.abort();
      const mid = new AbortController(), it = LectureDecode.keyframeImages(kfs, { signal: mid.signal });
      await it.next(); mid.abort();
      out.errors = {
        audioPreAborted: await code(LectureDecode.audioEnergy(tracks, { signal: pre.signal })),
        videoAbortedMidway: await code(it.next()),
        videoBogusCodec: await code(LectureDecode.keyframeImages([{ ...kfs[0], codec: "bogus" }]).next()),
        audioBogusCodec: await code(LectureDecode.audioEnergy([{ ...tracks[0], codec: "bogus" }])),
      };
    }
    return out;
  }
  return [await one("plain"), await one("disc")];
}

const types = { ".js": "text/javascript", ".m3u8": "application/vnd.apple.mpegurl", ".ts": "video/mp2t" };
(async () => {
  const fx = fs.mkdtempSync(path.join(os.tmpdir(), "media-decode-smoke-"));
  let server, browser;
  try {
    execFileSync(process.execPath, [path.join(root, "tools/make-hls-fixture.mjs"), fx], { stdio: "pipe" });
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=gray:s=1920x1080:r=1:d=1,geq=lum='random(1)*255':cb='random(2)*255':cr='random(3)*255'",
      "-c:v", "libx264", "-crf", "12", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-frames:v", "1", "-an", "-f", "mpegts", path.join(fx, "noise.ts")], { stdio: "pipe" });
    server = http.createServer((request, response) => {
      const name = decodeURIComponent(new URL(request.url, "http://localhost").pathname).slice(1);
      const file = name.startsWith("fx/") ? path.resolve(fx, name.slice(3)) : LIBS.includes(name) ? path.resolve(root, name) : null;
      if (name === "") { response.setHeader("content-type", "text/html"); response.end("<!doctype html><title>media-decode-smoke</title>"); return; }
      if (!file || !(file.startsWith(fx + path.sep) || file.startsWith(root + path.sep)) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { response.writeHead(404); response.end(); return; }
      response.setHeader("content-type", types[path.extname(file)] || "application/octet-stream"); fs.createReadStream(file).pipe(response);
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH });
    const page = await browser.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.stack || error.message));
    await page.goto(origin + "/");
    const codecs = await page.evaluate(async () => ({ h264: (await VideoDecoder.isConfigSupported({ codec: "avc1.64001f" })).supported, aac: (await AudioDecoder.isConfigSupported({ codec: "mp4a.40.2", sampleRate: 44100, numberOfChannels: 1 })).supported }));
    assert.ok(codecs.h264 && codecs.aac, `이 브라우저(${browser.version()})는 H.264/AAC를 디코드하지 못합니다 ${JSON.stringify(codecs)} — CHROME_PATH를 Chrome 또는 Chrome for Testing으로 지정하세요.`);

    const src = `importScripts(${LIBS.map(l => JSON.stringify(`${origin}/${l}`)).join(",")});\n${body}\nself.onmessage = async e => { try { postMessage({ ok: true, r: await body(e.data) }); } catch (err) { postMessage({ ok: false, err: String(err && err.stack || err) }); } };`;
    const res = await page.evaluate(({ src, origin }) => new Promise((resolve, reject) => {
      const w = new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" })));
      w.onmessage = e => resolve(e.data); w.onerror = e => reject(new Error(e.message));
      w.postMessage({ origin });
    }), { src, origin });
    assert.ok(res.ok, res.err);
    assert.deepEqual(errors, []);

    const near = (a, b, eps, what) => assert.ok(Math.abs(a - b) <= eps, `${what}: ${a} ≈ ${b} (±${eps})`);
    for (const r of res.r) {
      // 영상: 키프레임 12개(2초마다), 전부 JPEG이고 1.5MB 이하, 샘플은 256×144, 슬라이드 색이 맞다(채널 128 기준: 색공간 오차에 둔감)
      assert.equal(r.keyframes, 12, r.name); assert.equal(r.frames.length, 12, r.name);
      r.frames.forEach((f, i) => {
        near(f.t, 2 * i, 0.05, `${r.name} frame ${i} t`);
        assert.equal(f.type, "image/jpeg"); assert.deepEqual(f.magic, [0xff, 0xd8, 0xff]);
        assert.ok(f.size > 0 && f.size <= MAX_JPEG, `${r.name} frame ${i} size ${f.size}`);
        assert.deepEqual([f.w, f.h, f.sw, f.sh], [320, 180, 256, 144], `${r.name} frame ${i} dims`); // 원본이 maxSide보다 작으면 키우지 않는다
        const want = SLIDES[Math.floor(i / 2)].match(/../g).map(h => parseInt(h, 16) > 127);
        assert.deepEqual(f.rgb.map(v => v > 127), want, `${r.name} frame ${i} color ${f.rgb}`);
      });
      assert.equal(r.gate.slideId, 6, `${r.name} VisualGate slideId`); assert.equal(r.gate.accepted.length, 6, `${r.name} gate accepted`);
      assert.deepEqual(r.scaled, { w: 160, h: 90 }, `${r.name} maxSide:160`);

      // 오디오: 24초, 사인파가 무음 문턱(filterSegments 기본 silenceRms 0.01)보다 크다(끝의 프라이밍·꼬리 1초는 뺀다)
      const e = Float32Array.from(r.audio.energy), inner = e.subarray(Math.ceil(1 / 0.03), Math.floor(23 / 0.03)), median = Float32Array.from(inner).sort()[inner.length >> 1];
      near(r.audio.t0, 0, 0.05, `${r.name} t0`); assert.equal(r.audio.frameMs, 30);
      near(e.length * 0.03, 24, 0.3, `${r.name} covered seconds`); // demux 오디오 시각이 세그먼트마다 최대 ~0.2초 어긋난다
      assert.ok(Math.min(...inner) > 0.01, `${r.name} min tone rms ${Math.min(...inner)}`);
      assert.ok(Math.min(...inner) > 0.7 * median, `${r.name} 일정한 톤인데 이음새에서 에너지가 꺼졌다(min ${Math.min(...inner)}, median ${median})`); // 세그먼트 이음새의 구멍·페이드인 보정 검사
      near(median, 0.125 / Math.SQRT2, 0.02, `${r.name} median rms`); // ffmpeg sine 진폭 1/8
      r.vadFull = Stt.vadSegments(e, { frameMs: r.audio.frameMs }); // 대비 없는 일정한 톤이라 기본 VAD(바닥×3)는 구간을 못 찾는다 — 출력만 한다
    }

    assert.deepEqual(res.r[0].mixed, [[0, 320, 180], [2, 320, 180], [0, 1600, 900], [4, 320, 180], [6, 320, 180]], JSON.stringify(res.r[0].mixed));
    const n = res.r[0].noise;
    assert.equal(n.keyframes, 1); assert.ok(n.byDefault > 100000 && n.byDefault <= MAX_JPEG, `noise default ${n.byDefault}`);
    assert.equal(n.quality1, n.quality06, "한도를 넘으면 정확히 한 번, ×0.6으로 다시 인코딩한다"); assert.ok(n.quality1 <= MAX_JPEG);

    // 구멍 시험: stt-client에 그대로 꽂는다
    const g = res.r[0], ge = Float32Array.from(g.gap.energy), at = (a, b) => ge.subarray(Math.round(a / 0.03), Math.round(b / 0.03));
    assert.ok(Math.max(...at(8.3, 15.7)) < 1e-3, "구멍은 무음"); assert.ok(Math.min(...at(0.5, 7.5)) > 0.01 && Math.min(...at(16.5, 23.5)) > 0.01, "양옆은 톤");
    const vad = Stt.vadSegments(ge, { frameMs: 30 });
    assert.equal(vad.length, 2, JSON.stringify(vad));
    near(vad[0].t1, 8, 0.2, "vad[0].t1"); near(vad[1].t0, 16, 0.2, "vad[1].t0"); near(vad[1].t1, 24, 0.3, "vad[1].t1");
    const plan = Stt.planChunks(ge, { frameMs: 30, targetSec: 12, searchSec: 3, overlapSec: 0.5, speech: vad });
    assert.equal(plan.length, 2); assert.ok(plan[0].coreT1 > 8 && plan[0].coreT1 < 16, `cut ${plan[0].coreT1}`); assert.ok(plan.every(c => !c.skip));
    assert.deepEqual(g.errors, { audioPreAborted: "AbortError", videoAbortedMidway: "AbortError", videoBogusCodec: "DECODE_UNSUPPORTED", audioBogusCodec: "DECODE_UNSUPPORTED" });

    for (const r of res.r) console.log(`PASS ${r.name}: ${r.keyframes} keyframes, JPEG ${Math.min(...r.frames.map(f => f.size))}-${Math.max(...r.frames.map(f => f.size))} B ${r.frames[0].w}x${r.frames[0].h}, VisualGate slideId=${r.gate.slideId} accepted at t=[${r.gate.accepted.map(t => t.toFixed(1))}], audio ${(r.audio.energy.length * 0.03).toFixed(2)}s t0=${r.audio.t0} median rms=${Float32Array.from(r.audio.energy).sort()[r.audio.energy.length >> 1].toFixed(4)}, default VAD on constant tone: ${JSON.stringify(r.vadFull)}, ms ${JSON.stringify(r.ms)}`);
    console.log(`PASS mixed avcC list (reconfigure twice): ${JSON.stringify(res.r[0].mixed)}`);
    console.log(`PASS noisy 1080p keyframe: default ${n.byDefault} B, quality 1 retried at 0.6 -> ${n.quality1} B (== quality 0.6 ${n.quality06} B), cap ${MAX_JPEG} B`);
    console.log(`PASS gap (segment 2 skipped): VAD ${JSON.stringify(vad.map(v => [+v.t0.toFixed(2), +v.t1.toFixed(2)]))}, planChunks cut at ${plan[0].coreT1.toFixed(2)}s; errors ${JSON.stringify(g.errors)}; ${browser.version()} in Worker`);
  } finally { await browser?.close(); server?.close(); fs.rmSync(fx, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
