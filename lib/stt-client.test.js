const test = require("node:test");
const assert = require("node:assert/strict");
const {energyFrames, vadSegments, planChunks, dedupeOverlap, filterSegments, makeEnergyAt, extractTerms, estimateTokens, buildPrompt, encodeWav, transcribeChunks, HALLUCINATION_PHRASES} = require("./stt-client.js");

const SR = 16000;
// deterministic LCG — seeded noise, no Math.random
const lcg = seed => { let s = (seed >>> 0) || 1; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; };
const silence = sec => new Float32Array(Math.round(sec * SR));
const noise = (sec, amp, seed = 1) => {
  const r = lcg(seed), a = new Float32Array(Math.round(sec * SR));
  for (let i = 0; i < a.length; i++) a[i] = (r() * 2 - 1) * amp;
  return a;
};
// 200Hz는 30ms 프레임에 정확히 6주기 — 프레임 RMS가 정확히 amp/sqrt(2)
const tone = (sec, amp, hz = 200) => {
  const a = new Float32Array(Math.round(sec * SR));
  for (let i = 0; i < a.length; i++) a[i] = amp * Math.sin(2 * Math.PI * hz * i / SR);
  return a;
};
const concat = (...parts) => {
  const a = new Float32Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) { a.set(p, o); o += p.length; }
  return a;
};
const w = (t0, t1, s) => ({w: s, t0, t1});
const near = (v, x, tol = 0.031, label = "") => assert.ok(Math.abs(v - x) <= tol, `${label}${v} !~ ${x}`);

test("energyFrames: tone -> uniform RMS, ceil frame count", () => {
  const e = energyFrames(tone(1, 0.5), SR); // 16000/480 = 33.33 -> 34
  assert.equal(e.length, 34);
  const rms = 0.5 / Math.SQRT2;
  for (const v of e) near(v, rms, 1e-4);
});

test("energyFrames: silence -> zeros, empty -> empty", () => {
  assert.ok(energyFrames(silence(1), SR).every(v => v === 0));
  assert.equal(energyFrames(new Float32Array(0), SR).length, 0);
});

test("energyFrames: invalid input throws TypeError", () => {
  assert.throws(() => energyFrames("pcm", SR), TypeError);
  assert.throws(() => energyFrames(silence(1), 0), TypeError);
  assert.throws(() => energyFrames(silence(1), NaN), TypeError);
  assert.throws(() => energyFrames(silence(1), SR, 0), TypeError);
  assert.throws(() => energyFrames(silence(1), 8, 30), TypeError); // step 0.24 < 1
});

test("energyFrames: fractional step still covers every sample", () => {
  const sr = 22050, pcm = new Float32Array(sr).fill(1); // step = 661.5
  const e = energyFrames(pcm, sr, 30);
  assert.equal(e.length, Math.ceil(sr / 661.5)); // 34
  for (const v of e) near(v, 1, 1e-6);
  // 마지막 샘플 하나만 켜두면 마지막 프레임에만 에너지 — 끝까지 커버된다
  const last = new Float32Array(sr);
  last[sr - 1] = 1;
  const e2 = energyFrames(last, sr, 30);
  assert.equal(e2.length, 34);
  assert.ok(e2[33] > 0);
  for (let i = 0; i < 33; i++) assert.equal(e2[i], 0);
  // Array 입력도 받는다
  assert.equal(energyFrames([1, -1, 1, -1], 4, 1000)[0], 1);
});

test("vadSegments: hangover merge + min-length drop", () => {
  const e = energyFrames(concat(
    silence(1), tone(2, 0.3), silence(1), tone(0.1, 0.3), silence(2),
    tone(1, 0.3), silence(0.3), tone(1, 0.3), silence(1)), SR);
  const segs = vadSegments(e);
  assert.equal(segs.length, 2);
  near(segs[0].t0, 1); near(segs[0].t1, 3);         // computed [0.99, 3.0]
  near(segs[1].t0, 6.1); near(segs[1].t1, 8.4);     // computed [6.09, 8.4]
});

test("vadSegments: noise-only and digital silence -> []", () => {
  assert.deepEqual(vadSegments(energyFrames(noise(5, 0.004), SR)), []);
  assert.deepEqual(vadSegments(energyFrames(silence(2), SR)), []);
  assert.deepEqual(vadSegments(new Float32Array(0)), []);
});

test("vadSegments: speech between low noise -> one segment", () => {
  const e = energyFrames(concat(noise(2, 0.004, 1), tone(1, 0.3), noise(2, 0.004, 2)), SR);
  const segs = vadSegments(e);
  assert.equal(segs.length, 1);
  near(segs[0].t0, 2); near(segs[0].t1, 3); // computed [1.98, 3.0]
});

test("vadSegments: adaptive threshold over loud noise floor", () => {
  const e = energyFrames(concat(noise(2, 0.05, 1), tone(1, 0.5), noise(2, 0.05, 2)), SR);
  const segs = vadSegments(e);
  assert.equal(segs.length, 1);
  near(segs[0].t0, 2); near(segs[0].t1, 3);
});

test("planChunks: 70s lecture -> 4 chunks, interior overlap, core-based skip", () => {
  const e = energyFrames(concat(
    tone(19.4, 0.3), silence(1.2), tone(18.9, 0.3), silence(0.8), tone(19.6, 0.3), silence(10.1)), SR);
  const chunks = planChunks(e, {frameMs: 30, targetSec: 20, searchSec: 5, overlapSec: 1});
  assert.equal(chunks.length, 4);
  const cuts = [20, 40, 60];
  for (let j = 0; j < 3; j++) {
    near(chunks[j].coreT1, cuts[j], 0.05, `cut${j} `);
    assert.equal(chunks[j].coreT1, chunks[j + 1].coreT0); // 경계 공유
    near(chunks[j].t1, chunks[j].coreT1 + 1, 1e-9);
  }
  assert.equal(chunks[0].t0, 0);
  for (let j = 1; j < 4; j++) near(chunks[j].t0, chunks[j].coreT0 - 1, 1e-9);
  near(chunks[3].t1, 70, 0.05); // total = 2334*0.03 = 70.02
  // chunk 3의 코어 [59.985,70.02]는 무음 — 패딩 [58.985,59.985]에 걸치는 마지막 ~0.9s 음성은 이웃 소유
  assert.deepEqual(chunks.map(c => c.skip), [false, false, false, true]);
});

test("planChunks: silent signal -> all chunks skip", () => {
  const chunks = planChunks(energyFrames(silence(70), SR), {frameMs: 30, targetSec: 20, searchSec: 5, overlapSec: 1});
  assert.equal(chunks.length, 4);
  assert.ok(chunks.every(c => c.skip));
});

test("planChunks: shorter than targetSec+searchSec -> single chunk", () => {
  // 순수 tone만 있으면 적응 바닥값이 올라가 speech=[]가 되므로 무음을 섞는다
  const chunks = planChunks(energyFrames(concat(tone(4.5, 0.3), silence(4.5)), SR),
    {frameMs: 30, targetSec: 20, searchSec: 5, overlapSec: 1});
  assert.equal(chunks.length, 1);
  assert.deepEqual(Object.keys(chunks[0]).sort(), ["coreT0", "coreT1", "skip", "t0", "t1"]);
  assert.equal(chunks[0].t0, 0);
  near(chunks[0].t1, 9, 1e-9);
  assert.equal(chunks[0].skip, false);
  const silent = planChunks(energyFrames(silence(9), SR), {frameMs: 30, targetSec: 20, searchSec: 5, overlapSec: 1});
  assert.equal(silent.length, 1);
  assert.equal(silent[0].skip, true);
});

test("planChunks: empty energy / invalid options", () => {
  assert.deepEqual(planChunks(new Float32Array(0)), []);
  assert.throws(() => planChunks(new Float32Array(100), {targetSec: 0}), RangeError);
  assert.throws(() => planChunks(new Float32Array(100), {searchSec: -1}), RangeError);
  assert.throws(() => planChunks(new Float32Array(100), {overlapSec: -0.5}), RangeError);
});

test("planChunks: caller-supplied speech is honoured", () => {
  const e = energyFrames(silence(70), SR);
  const chunks = planChunks(e, {frameMs: 30, targetSec: 20, searchSec: 5, overlapSec: 1, speech: [{t0: 0, t1: 70}]});
  assert.ok(chunks.every(c => !c.skip));
});

test("planChunks: tie -> zero-energy frame closest to target, smaller index wins", () => {
  // fs=0.5s, center=2.0: 프레임 3(중심 1.75)과 4(중심 2.25)가 정확히 등거리 -> 작은 인덱스
  const chunks = planChunks(new Float32Array(8), {frameMs: 500, targetSec: 2, searchSec: 0.5, overlapSec: 0});
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].coreT1, 1.75);
});

test("dedupeOverlap: midpoint cut + seam text dedup", () => {
  const prev = [{id: "p", t0: 298.0, t1: 300.9, text: "the discount rate is applied to each", noSpeechProb: 0.1,
    words: [w(298.0, 298.3, "the"), w(298.4, 298.9, "discount"), w(299.0, 299.3, "rate"), w(299.4, 299.6, "is"),
            w(299.7, 300.2, "applied"), w(300.3, 300.5, "to"), w(300.6, 300.9, "each")]}];
  const next = [{id: "n", t0: 299.8, t1: 301.8, text: "applied to each cash flow",
    words: [w(299.8, 300.3, "applied"), w(300.4, 300.6, "to"), w(300.7, 301.0, "each"), w(301.1, 301.4, "cash"), w(301.5, 301.8, "flow")]}];
  const snap = JSON.stringify({prev, next});
  const out = dedupeOverlap(prev, next, 300);
  assert.equal(out.length, 2);
  // prev "applied" 중점 299.95 생존, "to" 300.4 탈락 / next "applied" 300.05 생존하지만 이음새 중복으로 제거
  assert.deepEqual(out[0].words.map(x => x.w), ["the", "discount", "rate", "is", "applied"]);
  assert.equal(out[0].t0, 298.0); assert.equal(out[0].t1, 300.2);
  assert.equal(out[0].text, "the discount rate is applied");
  assert.equal(out[0].noSpeechProb, 0.1); // 다른 필드 생존
  assert.deepEqual(out[1].words.map(x => x.w), ["to", "each", "cash", "flow"]);
  assert.equal(out[1].t0, 300.4); assert.equal(out[1].t1, 301.8);
  assert.equal(out[1].text, "to each cash flow");
  assert.equal(JSON.stringify({prev, next}), snap); // 입력 불변
});

test("dedupeOverlap: wordless segments cut by midpoint", () => {
  const prev = [
    {id: "a", t0: 290, t1: 295, text: "old"},            // mid 292.5 < 300 -> 유지
    {id: "b", t0: 299.5, t1: 300.5, text: "straddle"},   // mid 300 -> prev에서 탈락
  ];
  const next = [
    {id: "c", t0: 299.5, t1: 300.5, text: "straddle"},   // mid 300 >= 300 -> 유지
    {id: "d", t0: 290, t1: 295, text: "dup"},            // mid < 300 -> next에서 탈락
  ];
  const out = dedupeOverlap(prev, next, 300);
  assert.deepEqual(out.map(s => s.id), ["a", "c"]);
  assert.equal(out[0].text, "old");
  assert.equal(out[1].text, "straddle");
});

test("dedupeOverlap: word midpoint on boundary belongs to next only", () => {
  const prev = [{id: "p", t0: 298, t1: 300.1, text: "a b", words: [w(298, 299, "a"), w(299.9, 300.1, "b")]}];
  const next = [{id: "n", t0: 299.9, t1: 302, text: "b c", words: [w(299.9, 300.1, "b"), w(301, 302, "c")]}];
  const out = dedupeOverlap(prev, next, 300);
  assert.equal(out.length, 2);
  assert.equal(out[0].text, "a");
  assert.equal(out[1].text, "b c"); // 이음새 불일치 — 아무것도 지우지 않는다
});

test("dedupeOverlap: punctuation/case-insensitive seam match", () => {
  const prev = [{id: "p", t0: 298, t1: 299.9, text: "hello Applied,", words: [w(298, 299, "hello"), w(299.5, 299.9, "Applied,")]}];
  const next = [{id: "n", t0: 300.0, t1: 302, text: "applied world", words: [w(300.0, 300.5, "applied"), w(301, 302, "world")]}];
  const out = dedupeOverlap(prev, next, 300);
  assert.equal(out.length, 2);
  assert.equal(out[0].text, "hello Applied,"); // 잃은 단어 없음 — 원본 text 그대로
  assert.equal(out[1].text, "world");
  assert.deepEqual(out[1].words.map(x => x.w), ["world"]);
});

test("dedupeOverlap: fully-removed segment disappears", () => {
  const prev = [{id: "p", t0: 298, t1: 299.9, text: "a b", words: [w(298, 299, "a"), w(299.5, 299.9, "b")]}];
  const next = [
    {id: "n1", t0: 300, t1: 300.4, text: "b", words: [w(300.0, 300.4, "b")]},
    {id: "n2", t0: 301, t1: 302, text: "c", words: [w(301, 302, "c")]},
  ];
  const out = dedupeOverlap(prev, next, 300);
  assert.deepEqual(out.map(s => s.id), ["p", "n2"]);
});

test("filterSegments: quality metric rules", () => {
  const segs = [
    {id: 1, t0: 0, t1: 1, text: "a", noSpeechProb: 0.8, avgLogprob: -1.5},  // filtered
    {id: 2, t0: 1, t1: 2, text: "b", noSpeechProb: 0.8, avgLogprob: -0.5},  // logprob 조건 실패 -> kept
    {id: 3, t0: 2, t1: 3, text: "c", noSpeechProb: 0.2, avgLogprob: -1.5},  // noSpeechProb 조건 실패 -> kept
    {id: 4, t0: 3, t1: 4, text: "d", compressionRatio: 2.5},                // filtered
    {id: 5, t0: 4, t1: 5, text: "e", compressionRatio: 2.4},                // strictly greater -> kept
    {id: 6, t0: 5, t1: 6, text: "f"},                                       // 품질 필드 없음 -> kept
  ];
  const out = filterSegments(segs);
  assert.deepEqual(out.map(s => s.status), ["filtered", "kept", "kept", "filtered", "kept", "kept"]);
});

test("filterSegments: phrase rule needs matching text AND low energy", () => {
  const seg = text => ({id: 0, t0: 0, t1: 1, text});
  const low = () => 0.005, high = () => 0.5;
  assert.equal(filterSegments([seg("시청해주셔서 감사합니다")], {energyAt: low})[0].status, "filtered");
  assert.equal(filterSegments([seg("시청해주셔서 감사합니다")], {energyAt: high})[0].status, "kept");
  assert.equal(filterSegments([seg("시청해주셔서 감사합니다")])[0].status, "kept"); // energyAt 없으면 발동 안 함
  assert.equal(filterSegments([seg("MBC 뉴스 이덕영입니다")], {energyAt: low})[0].status, "filtered");
  assert.equal(filterSegments([seg("수업 마치겠습니다")], {energyAt: low})[0].status, "kept");
  assert.equal(filterSegments([seg("강의 끝냅니다")], {energyAt: low, phrases: ["강의 끝"]})[0].status, "filtered");
});

test("filterSegments: status semantics, originals untouched", () => {
  const segs = [
    {id: 1, t0: 0, t1: 1, text: "a"},
    {id: 2, t0: 1, t1: 2, text: "b", status: "filtered"},
  ];
  const snap = JSON.stringify(segs);
  const out = filterSegments(segs);
  assert.equal(out[0].status, "kept");      // 기본값
  assert.equal(out[1].status, "filtered");  // 이미 filtered면 유지
  assert.deepEqual(Object.keys(out[0]).sort(), ["id", "status", "t0", "t1", "text"]); // 추가 필드 없음
  assert.equal(JSON.stringify(segs), snap);
  assert.ok(Object.isFrozen(HALLUCINATION_PHRASES));
});

test("makeEnergyAt: mean over overlapping frames, clamped", () => {
  const at = makeEnergyAt(new Float32Array([0, 0, 0.1, 0.1]), 1000);
  assert.equal(at(0, 2), 0);
  // Float32Array는 0.1을 float32로 저장하므로 정확 비교 대신 허용 오차로 본다
  near(at(2, 4), 0.1, 1e-6);
  near(at(1, 3), 0.05, 1e-6);
  near(at(3, 10), 0.1, 1e-6); // 끝을 넘으면 클램프
  assert.equal(makeEnergyAt(new Float32Array(0), 1000)(0, 1), Infinity);
});

test("planChunks: no chunk ever exceeds maxSec", () => {
  const e = new Float32Array(120000).fill(1); // 3600s, 전부 유성
  for (let k = 1; k * 300 + 13 < 3600; k++) {
    // 홀수 컷은 탐색 창의 가장 늦은 프레임, 짝수 컷은 가장 이른 프레임에 0을 둬 최장 코어를 유도
    e[k % 2 ? Math.floor((k * 300 + 13) / 0.03) : Math.ceil((k * 300 - 13) / 0.03)] = 0;
  }
  const chunks = planChunks(e, {speech: [{t0: 0, t1: 3600}]});
  assert.equal(chunks.length, 12);
  let longest = 0;
  for (const c of chunks) {
    assert.ok(c.t1 - c.t0 <= 330 + 1e-6, `chunk ${c.t0}~${c.t1}`);
    longest = Math.max(longest, c.t1 - c.t0);
    assert.equal(c.skip, false);
  }
  assert.ok(longest >= 329.5); // 상한이 빈틈없이 동작한다 — 우연한 여유가 아님
  assert.equal(chunks[0].t0, 0);
  near(chunks[chunks.length - 1].t1, 3600, 1e-6);
  for (let j = 0; j + 1 < chunks.length; j++) assert.equal(chunks[j].coreT1, chunks[j + 1].coreT0);
  assert.throws(() => planChunks(e, {targetSec: 320, overlapSec: 6}), RangeError); // 320+12 > 330
  // maxSec 400이면 searchSec 20이 유지 — 컷이 target-20 끝까지 도달 가능
  const e2 = new Float32Array(12000).fill(1); // 360s
  e2[Math.ceil((300 - 20) / 0.03)] = 0;
  const c2 = planChunks(e2, {targetSec: 300, searchSec: 20, maxSec: 400, speech: [{t0: 0, t1: 360}]});
  near(c2[0].coreT1, 280.035, 0.031); // 13s로 캡됐다면 ~287.0 근처였을 것
});

test("extractTerms: ranking, folding, stopwords", () => {
  const slides = [
    {title: "순현재가치(NPV)와 내부수익률(IRR)", text: "NPV is the sum of discounted cash flows. 할인율이 높을수록 NPV는 감소한다. 현금흐름을 할인율로 나눈다."},
    "IRR은 NPV를 0으로 만드는 할인율이다. 내부수익률 계산에는 반복법을 사용한다. Cash flow 현금흐름 표 Page 3",
    {title: "Example", text: "현금흐름 할인율 NPV The and for 1234"},
  ];
  const terms = extractTerms(slides);
  assert.equal(terms[0], "NPV");
  for (const t of ["IRR", "할인율", "현금흐름", "순현재가치", "내부수익률", "discounted"])
    assert.ok(terms.includes(t), `missing ${t}`);
  for (const t of ["the", "and", "for", "is", "of", "Example", "example", "Page", "page",
                   "사용한다", "감소한다", "높을수록", "1234", "할인율이", "할인율로", "현금흐름을", "NPV는", "표"])
    assert.ok(!terms.includes(t), `unexpected ${t}`);
  assert.deepEqual(extractTerms(slides, {max: 3}), terms.slice(0, 3));
  assert.equal(extractTerms(slides, {max: 0}).length, 0);
});

test("extractTerms: non-array/empty -> []", () => {
  assert.deepEqual(extractTerms("text"), []);
  assert.deepEqual(extractTerms(null), []);
  assert.deepEqual(extractTerms([]), []);
});

test("extractTerms: stem absent standalone is never stripped", () => {
  // 회로가 단독 출현하지 않으므로 회로의를 회로로 접지 않는다 — 회로의가 2회 출현해 그대로 유지
  assert.deepEqual(extractTerms([{text: "회로의 특성 회로의 해석"}]), ["회로의"]);
});

test("estimateTokens/buildPrompt", () => {
  assert.equal(estimateTokens("IRR, NPV, 할인율"), 6); // ASCII 10/4 + 한글 3 = 5.5 -> 6
  assert.equal(buildPrompt(["IRR", "NPV", "할인율"]), "IRR, NPV, 할인율");
  const ko = Array.from({length: 100}, (_, i) => "가나다" + String.fromCharCode(0xAC00 + i));
  const r1 = buildPrompt(ko);
  assert.equal(r1.split(", ").length, 49); // 4n + 0.5(n-1) <= 224
  assert.ok(estimateTokens(r1) <= 224);
  const en = Array.from({length: 100}, (_, i) => "term" + String(i).padStart(8, "0")); // 12 ASCII chars
  assert.equal(buildPrompt(en).split(", ").length, 64);
  assert.equal(buildPrompt(["aaa", "bbb"], {maxTokens: 1}), "aaa");
  assert.equal(buildPrompt(["IRR", "npv", "NPV", "", "  ", 42, null]), "IRR, npv");
  assert.equal(buildPrompt(["가".repeat(300), "ok"]), "ok"); // 못 들어가는 첫 항은 건너뛴다
  assert.equal(buildPrompt([]), "");
  assert.equal(buildPrompt(undefined), "");
});

// --- transcribeChunks: fake service, deferred promises for ordering ---
const deferred = () => { let resolve, reject; const p = new Promise((res, rej) => { resolve = res; reject = rej; }); return {p, resolve, reject}; };
const tick = () => new Promise(r => setTimeout(r, 0));
const okResponse = args => ({transcript: {schemaVersion: 1, engine: "groq-whisper", model: "whisper-large-v3-turbo", lang: "ko",
  segments: [{id: Math.round(args.t0 * 1000) + "-0", t0: args.t0, t1: args.t0 + 1, text: "x", words: [],
    noSpeechProb: null, avgLogprob: null, compressionRatio: null, status: "kept"}]},
  usage: {audioSec: args.durationSec, costUsd: 0.001}, promptVersion: "v1", schemaVersion: 1});
const mp4 = new Uint8Array([1, 2, 3]); // -> data:audio/mp4;base64,AQID
const chunk = (t0, t1, extra = {}) => ({t0, t1, audio: mp4, ...extra});
const svcErr = (code, extra = {}) => Object.assign(new Error(code), {code, retryable: false, retryAfterMs: null}, extra);

test("transcribeChunks: concurrency cap, order preserved", async () => {
  const calls = [], defs = [];
  let inFlight = 0, maxInFlight = 0;
  const service = {stt: args => {
    calls.push(args);
    const d = deferred();
    defs.push(d);
    inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
    return d.p.finally(() => inFlight--);
  }};
  const chunks = Array.from({length: 6}, (_, i) => chunk(300 * i, 300 * i + 300));
  const p = transcribeChunks(chunks, {service, concurrency: 2, newId: () => "req"});
  await tick();
  assert.equal(calls.length, 2);
  defs[1].resolve(okResponse(calls[1])); // 나중 청크가 먼저 끝나도 결과 순서는 유지
  defs[0].resolve(okResponse(calls[0]));
  await tick();
  assert.equal(calls.length, 4);
  defs[3].resolve(okResponse(calls[3]));
  defs[2].resolve(okResponse(calls[2]));
  await tick();
  assert.equal(calls.length, 6);
  defs[5].resolve(okResponse(calls[5]));
  defs[4].resolve(okResponse(calls[4]));
  const out = await p;
  assert.ok(maxInFlight <= 2);
  assert.deepEqual(out.map(o => o.index), [0, 1, 2, 3, 4, 5]);
  for (let i = 0; i < 6; i++) {
    assert.equal(out[i].status, "ok");
    assert.equal(out[i].attempts, 1);
    assert.equal(out[i].transcript.segments[0].t0, 300 * i);
    assert.deepEqual(out[i].usage, {audioSec: 300, costUsd: 0.001});
  }
});

test("transcribeChunks: skip:true -> skipped, no call even for bad audio", async () => {
  let n = 0;
  const service = {stt: args => { n++; return Promise.resolve(okResponse(args)); }};
  const out = await transcribeChunks([{t0: 0, t1: 300, audio: "garbage", skip: true}, chunk(300, 600)], {service});
  assert.equal(n, 1);
  assert.deepEqual(out[0], {index: 0, status: "skipped"});
  assert.equal(out[1].status, "ok");
});

test("transcribeChunks: retryable error -> new requestId per retry", async () => {
  const calls = [], sleeps = [];
  let n = 0;
  const service = {stt: args => { calls.push(args); return ++n < 3 ? Promise.reject(svcErr("RATE_LIMIT", {retryable: true})) : Promise.resolve(okResponse(args)); }};
  const out = await transcribeChunks([chunk(0, 300)], {service, newId: () => "base7", random: () => 0.5, sleep: ms => { sleeps.push(ms); return Promise.resolve(); }});
  assert.equal(out[0].status, "ok");
  assert.equal(out[0].attempts, 3);
  assert.deepEqual(calls.map(c => c.requestId), ["base7", "base7-r1", "base7-r2"]);
  assert.deepEqual(sleeps, [1000, 2000]); // 1000*2^a*(0.8+0.4*0.5)
});

test("transcribeChunks: retryAfterMs wins over backoff", async () => {
  const sleeps = [];
  let n = 0;
  const service = {stt: args => ++n === 1 ? Promise.reject(svcErr("L", {retryable: true, retryAfterMs: 5000})) : Promise.resolve(okResponse(args))};
  const out = await transcribeChunks([chunk(0, 300)], {service, random: () => 0.5, sleep: ms => { sleeps.push(ms); return Promise.resolve(); }});
  assert.equal(out[0].status, "ok");
  assert.equal(sleeps[0], 5000);
});

test("transcribeChunks: non-retryable failure stops scheduling", async () => {
  const e = svcErr("PROVIDER_DOWN");
  let calls = 0;
  const service = {stt: args => { calls++; return args.t0 === 0 ? Promise.reject(e) : Promise.resolve(okResponse(args)); }};
  let out = await transcribeChunks([chunk(0, 300), chunk(300, 600), chunk(600, 900)], {service, concurrency: 1});
  assert.equal(calls, 1);
  assert.equal(out[0].status, "failed");
  assert.equal(out[0].error, e);
  assert.equal(out[0].attempts, 1);
  assert.deepEqual(out.slice(1).map(o => o.status), ["pending", "pending"]);
  // 동시에 진행 중이던 청크는 정상 완료된다
  calls = 0;
  out = await transcribeChunks([chunk(0, 300), chunk(300, 600), chunk(600, 900)], {service, concurrency: 2});
  assert.equal(calls, 2);
  assert.equal(out[0].status, "failed");
  assert.equal(out[1].status, "ok");
  assert.equal(out[2].status, "pending");
});

test("transcribeChunks: always-retryable -> 1+3 attempts then failed", async () => {
  const calls = [], sleeps = [];
  const service = {stt: args => { calls.push(args); return Promise.reject(svcErr("L", {retryable: true})); }};
  const out = await transcribeChunks([chunk(0, 300)], {service, random: () => 0.5, sleep: ms => { sleeps.push(ms); return Promise.resolve(); }});
  assert.equal(calls.length, 4);
  assert.deepEqual(sleeps, [1000, 2000, 4000]);
  assert.equal(out[0].status, "failed");
  assert.equal(out[0].attempts, 4);
});

test("transcribeChunks: abort", async () => {
  const ac = new AbortController();
  const service = {stt: ({signal: s}) => new Promise((_, rej) => s.addEventListener("abort", () => rej(new DOMException("취소됨", "AbortError")), {once: true}))};
  const p = transcribeChunks([chunk(0, 300)], {service, signal: ac.signal});
  await tick();
  ac.abort();
  await assert.rejects(p, e => e.name === "AbortError");
  // 이미 abort된 신호 — 호출 자체가 없어야 한다
  const ac2 = new AbortController();
  ac2.abort();
  let n = 0;
  await assert.rejects(
    transcribeChunks([chunk(0, 300)], {service: {stt: () => { n++; return Promise.resolve(okResponse({t0: 0, durationSec: 300})); }}, signal: ac2.signal}),
    e => e.name === "AbortError");
  assert.equal(n, 0);
  // 기본 sleep 대기 중 abort — 실제 타이머로 수초 기다리면 안 된다
  const ac3 = new AbortController();
  const p3 = transcribeChunks([chunk(0, 300)], {
    service: {stt: () => Promise.reject(svcErr("L", {retryable: true}))},
    signal: ac3.signal, baseDelayMs: 5000, random: () => 0.5});
  setTimeout(() => ac3.abort(), 20);
  const t0 = Date.now();
  await assert.rejects(p3, e => e.name === "AbortError");
  assert.ok(Date.now() - t0 < 2000);
});

test("transcribeChunks: service receives exactly the contract fields", async () => {
  const ac = new AbortController();
  const seen = [];
  const service = {stt: args => { seen.push(args); return Promise.resolve(okResponse(args)); }};
  await transcribeChunks([chunk(0, 300.5)], {service, signal: ac.signal, termsFor: () => ["IRR", "NPV"], newId: () => "req1"});
  assert.deepEqual(seen[0], {audio: "data:audio/mp4;base64,AQID", t0: 0, durationSec: 300.5, lang: "ko", prompt: "IRR, NPV", requestId: "req1", signal: ac.signal});
  seen.length = 0;
  await transcribeChunks([chunk(0, 300.5)], {service, signal: ac.signal, model: "m1", timeoutMs: 9000});
  assert.equal(seen[0].prompt, ""); // termsFor 없으면 빈 프롬프트
  assert.equal(seen[0].model, "m1");
  assert.equal(seen[0].timeoutMs, 9000);
  // Uint8Array / ArrayBuffer / Blob / subarray view / data URL string 모두 같은 data URL
  for (const audio of [mp4, mp4.buffer, new Blob([mp4]), new Uint8Array([9, 9, 1, 2, 3, 9]).subarray(2, 5), "data:audio/mp4;base64,AQID"]) {
    seen.length = 0;
    await transcribeChunks([{t0: 0, t1: 1, audio}], {service});
    assert.equal(seen[0].audio, "data:audio/mp4;base64,AQID");
  }
  seen.length = 0;
  await transcribeChunks([{t0: 0, t1: 1, audio: mp4, mime: "audio/mp4"}], {service});
  assert.equal(seen[0].audio, "data:audio/mp4;base64,AQID");
});

test("transcribeChunks: bad response fails without retry", async () => {
  for (const bad of [{}, {segments: []}]) {
    let n = 0;
    const service = {stt: () => { n++; return Promise.resolve(bad); }};
    const out = await transcribeChunks([chunk(0, 300)], {service});
    assert.equal(n, 1);
    assert.equal(out[0].status, "failed");
    assert.equal(out[0].error.code, "STT_BAD_RESPONSE");
  }
});

test("transcribeChunks: invalid arguments reject TypeError", async () => {
  await assert.rejects(transcribeChunks([chunk(0, 1)], {}), TypeError); // service 없음
  await assert.rejects(transcribeChunks("x", {service: {stt: () => {}}}), TypeError);
  await assert.rejects(transcribeChunks([chunk(0, 1)], {service: {stt: () => {}}, lang: "fr"}), TypeError);
});

test("transcribeChunks: lang auto is accepted and passed to the service", async () => {
  const seen = [];
  const service = {stt: args => { seen.push(args); return Promise.resolve(okResponse(args)); }};
  const out = await transcribeChunks([chunk(0, 300)], {service, lang: "auto"});
  assert.equal(out[0].status, "ok");
  assert.equal(seen[0].lang, "auto");
});

test("transcribeChunks: chunk validation without service call", async () => {
  const cases = [
    [{t0: 0, t1: 331, audio: mp4}, "STT_BAD_CHUNK"],
    [{t0: 5, t1: 5, audio: mp4}, "STT_BAD_CHUNK"],
    [{t0: 0, t1: 1, audio: mp4, mime: "audio/mpeg"}, "STT_BAD_CHUNK"],
    [{t0: 0, t1: 1, audio: "not a url"}, "STT_BAD_CHUNK"],
    [{t0: 0, t1: 1, audio: new Uint8Array(12 * 1024 * 1024 + 1)}, "STT_CHUNK_TOO_LARGE"],
  ];
  for (const [c, code] of cases) {
    let n = 0;
    const service = {stt: () => { n++; return Promise.resolve(okResponse({t0: 0, durationSec: 1})); }};
    const out = await transcribeChunks([c], {service});
    assert.equal(n, 0, code);
    assert.equal(out[0].status, "failed");
    assert.equal(out[0].error.code, code);
    assert.equal(out[0].attempts, 0);
  }
  // 정확히 8 MiB는 허용
  let n = 0, got;
  const service = {stt: a => { n++; got = a; return Promise.resolve(okResponse(a)); }};
  const out = await transcribeChunks([{t0: 0, t1: 1, audio: new Uint8Array(8 * 1024 * 1024)}], {service});
  assert.equal(n, 1);
  assert.equal(out[0].status, "ok");
  assert.ok(got.audio.startsWith("data:audio/mp4;base64,"));
  assert.ok(got.audio.length >= 11000000);
});

// 리뷰 보강: base64 문자열 크기는 패딩을 빼서 계산하고, null 항목은 그 청크만 실패시킨다
test("transcribeChunks: data-URL size honours padding; a null chunk fails alone", async () => {
  const calls = [];
  const service = {stt: async a => { calls.push(a); return {transcript: {segments: []}, usage: null}; }};
  const P = "data:audio/mp4;base64,";
  // 정확히 12 MiB(12582912B) = base64 16777216자(패딩 없음) -> 통과, 12582913B = 16777218자 + '==' -> 거절(패딩은 바이트가 아니다)
  const exact = P + "A".repeat(16777216), over = P + "A".repeat(16777218) + "==";
  const ok = await transcribeChunks([{t0: 0, t1: 10, audio: exact}], {service, newId: () => "id1"});
  assert.equal(ok[0].status, "ok");
  assert.equal(calls.length, 1);
  const big = await transcribeChunks([{t0: 0, t1: 10, audio: over}], {service});
  assert.equal(big[0].error.code, "STT_CHUNK_TOO_LARGE");
  assert.equal(calls.length, 1);
  // WAV 청크는 mime대로 data URL을 만든다
  const wav = await transcribeChunks([{t0: 0, t1: 10, mime: "audio/wav", audio: new Uint8Array([82, 73, 70, 70])}], {service, newId: () => "id3"});
  assert.equal(wav[0].status, "ok");
  assert.equal(calls.at(-1).audio, "data:audio/wav;base64,UklGRg==");
  const mixed = await transcribeChunks([null, {t0: 0, t1: 10, audio: new Uint8Array([1])}], {service, concurrency: 2, newId: () => "id2"});
  assert.equal(mixed[0].status, "failed");
  assert.equal(mixed[0].error.code, "STT_BAD_CHUNK");
  assert.equal(mixed[1].status, "ok");
});

test("extractTerms: folded inflections keep the earliest first occurrence for ranking ties", () => {
  assert.deepEqual(extractTerms(["할인율이 현금흐름을 현금흐름 할인율"]), ["할인율", "현금흐름"]);
});

// --- encodeWav: 표준 44바이트 RIFF 헤더 + 16비트 모노 PCM ---
test("encodeWav: RIFF header fields and little-endian PCM samples", () => {
  const bytes = encodeWav(new Float32Array([0, 0.5, -0.5, 1, -1, 3, -3]), 16000);
  assert.ok(bytes instanceof Uint8Array);
  assert.equal(bytes.length, 44 + 7 * 2);
  const v = new DataView(bytes.buffer), tag = (o, n) => String.fromCharCode(...bytes.subarray(o, o + n));
  assert.equal(tag(0, 4), "RIFF");
  assert.equal(v.getUint32(4, true), 36 + 7 * 2); // 파일 크기 - 8
  assert.equal(tag(8, 4), "WAVE");
  assert.equal(tag(12, 4), "fmt ");
  assert.equal(v.getUint32(16, true), 16);   // PCM fmt 블록 크기
  assert.equal(v.getUint16(20, true), 1);    // PCM
  assert.equal(v.getUint16(22, true), 1);    // mono
  assert.equal(v.getUint32(24, true), 16000);
  assert.equal(v.getUint32(28, true), 32000); // byteRate
  assert.equal(v.getUint16(32, true), 2);    // blockAlign
  assert.equal(v.getUint16(34, true), 16);   // bitsPerSample
  assert.equal(tag(36, 4), "data");
  assert.equal(v.getUint32(40, true), 7 * 2);
  for (const [i, x] of [[0, 0], [1, 16384], [2, -16384], [3, 32767], [4, -32768], [5, 32767], [6, -32768]])
    assert.equal(v.getInt16(44 + i * 2, true), x, `sample ${i}`); // [-1,1] 밖은 클램프
});

test("encodeWav: custom sample rate, empty input, invalid input", () => {
  const v = new DataView(encodeWav(new Float32Array(0), 8000).buffer);
  assert.equal(v.getUint32(24, true), 8000);
  assert.equal(v.getUint32(28, true), 16000);
  assert.equal(v.getUint32(40, true), 0);
  assert.equal(encodeWav([], 16000).length, 44); // Array 입력도 받는다
  assert.equal(encodeWav(new Float32Array(0)).length, 44);
  assert.throws(() => encodeWav("pcm"), TypeError);
  assert.throws(() => encodeWav(new Float32Array(1), 0), TypeError);
  assert.throws(() => encodeWav(new Float32Array(1), NaN), TypeError);
});

test("encodeWav: a WAV chunk feeds transcribeChunks as a wav data URL", async () => {
  const seen = [];
  const service = {stt: args => { seen.push(args); return Promise.resolve(okResponse(args)); }};
  const bytes = encodeWav(new Float32Array(16000).fill(0.25));
  const out = await transcribeChunks([{t0: 5, t1: 6, mime: "audio/wav", audio: bytes}], {service, newId: () => "w1"});
  assert.equal(out[0].status, "ok");
  assert.ok(seen[0].audio.startsWith("data:audio/wav;base64,"));
  assert.equal(seen[0].durationSec, 1);
});
