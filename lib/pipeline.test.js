const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const P = require("./pipeline.js");
const { createStore, memoryAdapter } = require("./package-store.js");
const { EventBus } = require("./events.js");

// 실제 PackageStore(암호화)를 메모리 어댑터로 쓴다. 시계·난수·sleep은 전부 주입해 결정적으로 돈다.
const mk = async () => { const adapter = memoryAdapter(); return { adapter, store: await createStore(adapter) }; };
const clock = (t = 1000) => () => t++;
const tick = () => new Promise(r => setImmediate(r));
const svcErr = (code, extra) => Object.assign(new Error(code), { code, retryable: false, retryAfterMs: null }, extra);
const retryable = (code = "provider_busy", extra) => svcErr(code, { retryable: true, ...extra });
const abortErr = () => new DOMException("취소됨", "AbortError");
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} !~ ${b}`);
const sha = s => crypto.createHash("sha256").update(s).digest("hex");
const fakeSleep = () => { const delays = []; return { delays, sleep: async ms => { delays.push(ms); } }; };
const advanceTo = async (job, state) => { for (const s of P.STATES.slice(1, P.STATES.indexOf(state) + 1)) await job.transition(s); };

// ── 작업 상태 기계 ──
test("job: walks the happy path one step at a time, checkpointing every transition", async () => {
  const { store, adapter } = await mk();
  const writes = [], put = store.putJson.bind(store);
  store.putJson = (s, id, v, o) => (writes.push([s, id, v.state]), put(s, id, v, o));
  const job = await P.createJob({ jobId: "j1", store, now: clock() });
  for (const s of P.STATES.slice(1)) await job.transition(s);
  assert.equal(job.state, "done");
  // 생성 체크포인트 1 + 전이 9 = 10번, 순서대로
  assert.deepEqual(writes, P.STATES.map(s => ["jobs", "j1", s]));
  // PackageStore가 암호화한다: 어댑터에는 평문 필드가 없다
  assert.equal(JSON.stringify(await adapter.get("jobs", "j1")).includes("state"), false);
  const re = await P.loadJob("j1", store);
  assert.deepEqual(re.record, job.record);
  assert.ok(re.record.createdAt < re.record.updatedAt);
  assert.deepEqual(Object.keys(re.record).sort(), ["completed", "createdAt", "jobId", "packageId", "schemaVersion", "stage", "state", "updatedAt"]);
});

test("job: illegal transitions are rejected and leave state and checkpoint untouched", async () => {
  const { store } = await mk();
  const job = await P.createJob({ jobId: "j1", store, now: clock() });
  for (const to of ["ingesting", "done", "created", "bogus"]) await assert.rejects(job.transition(to), /불가능한 상태 전이/, to);
  await job.transition("acquiring_source");
  await assert.rejects(job.transition("created"), /불가능한 상태 전이/); // 뒤로
  await assert.rejects(job.transition("acquiring_source"), /불가능한 상태 전이/); // 제자리
  await assert.rejects(job.resume(), /불가능한 상태 전이/); // 멈춘 적 없는 작업
  await assert.rejects(job.transition("paused"), TypeError);
  await assert.rejects(job.transition("paused", { reason: "nope" }), TypeError);
  await assert.rejects(job.transition("paused", { reason: "user", code: "lower" }), TypeError);
  await assert.rejects(job.transition("failed"), TypeError);
  await assert.rejects(job.transition("failed", { code: "not-a-code" }), TypeError);
  assert.equal(job.state, "acquiring_source");
  assert.equal((await store.getJson("jobs", "j1")).state, "acquiring_source");
});

test("job: done is terminal; failed and cancelled only reopen to their recorded stage", async () => {
  const { store } = await mk();
  const mkAt = async (id, fin, opts) => { const j = await P.createJob({ jobId: id, store }); await j.transition("acquiring_source"); await j.transition(fin, opts); return j; };
  const failed = await mkAt("f", "failed", { code: "SRC_PROTECTED" });
  const cancelled = await mkAt("c", "cancelled");
  const done = await P.createJob({ jobId: "d", store });
  await advanceTo(done, "done");
  for (const j of [failed, cancelled]) for (const to of ["paused", "failed", "cancelled", "done", "ingesting"]) await assert.rejects(j.transition(to, { reason: "user", code: "SRC_X" }), /끝난 작업/, to);
  for (const to of ["acquiring_source", "paused", "failed", "cancelled", "done"]) await assert.rejects(done.transition(to, { reason: "user", code: "SRC_X" }), /끝난 작업/, to);
  assert.deepEqual([failed.record.code, failed.record.stage], ["SRC_PROTECTED", "acquiring_source"]);
  assert.equal(cancelled.state, "cancelled");
});

test("job: reopen returns a failed or cancelled job to its recorded stage and clears the code", async () => {
  const { store } = await mk();
  const job = await P.createJob({ jobId: "j1", store, now: clock() });
  await advanceTo(job, "planning");
  await job.transition("failed", { code: "MEM_BUDGET_EXCEEDED" });
  assert.deepEqual([job.state, job.stage], ["failed", "planning"], "단계는 실패한 곳에 남는다");
  // 재시작 뒤 새 Job으로 되돌린다 — 코드는 지워지고 이어서 평소 전이 규칙이다
  const re = await P.loadJob("j1", store);
  await re.reopen();
  assert.deepEqual([re.state, re.stage], ["planning", "planning"]);
  assert.equal("code" in re.record, false);
  await re.transition("writing");
  await assert.rejects(re.transition("ingesting"), /불가능한 상태 전이/, "되돌린 뒤에도 단계를 건너뛰지 못한다");
  // 취소도 기록된 단계로 되돌릴 수 있다
  await re.transition("cancelled");
  await re.reopen();
  assert.equal(re.state, "writing");
  // done은 끝이다
  const done = await P.createJob({ jobId: "j2", store });
  await advanceTo(done, "done");
  await assert.rejects(done.reopen(), /끝난 작업/);
});

test("job: pause records the reason and resume returns to the stage it paused from", async () => {
  const { store } = await mk();
  const job = await P.createJob({ jobId: "j1", store, now: clock() });
  await advanceTo(job, "writing");
  await job.transition("paused", { reason: "quota", code: "QUOTA_EXCEEDED" });
  assert.deepEqual([job.state, job.stage, job.record.reason, job.record.code], ["paused", "writing", "quota", "QUOTA_EXCEEDED"]);
  // 멈춘 동안은 다른 단계로도, 다시 멈추기도 안 된다
  await assert.rejects(job.transition("validating"), /불가능한 상태 전이/);
  await assert.rejects(job.transition("paused", { reason: "user" }), /불가능한 상태 전이/);
  await job.resume();
  assert.equal(job.state, "writing");
  assert.equal("reason" in job.record || "code" in job.record, false);
  await job.transition("validating");
  assert.equal(job.state, "validating");
  for (const reason of P.PAUSE_REASONS) { await job.transition("paused", { reason }); await job.resume(); }
  // 멈춘 작업도 취소·실패로 끝낼 수 있다
  await job.transition("paused", { reason: "user" });
  await job.transition("cancelled");
  assert.deepEqual([job.state, job.stage], ["cancelled", "validating"]);
});

test("job: a paused job survives a restart and resumes where it stopped", async () => {
  const { store } = await mk();
  const job = await P.createJob({ jobId: "j1", store });
  await advanceTo(job, "judging");
  await job.transition("paused", { reason: "network" });
  const re = await P.loadJob("j1", store);
  assert.deepEqual([re.state, re.stage, re.record.reason], ["paused", "judging", "network"]);
  await re.resume();
  await re.transition("planning");
  assert.equal((await store.getJson("jobs", "j1")).state, "planning");
});

test("job: createJob refuses to clobber an existing checkpoint; loadJob returns null or rejects bad records", async () => {
  const { store } = await mk();
  await P.createJob({ jobId: "j1", store });
  await assert.rejects(P.createJob({ jobId: "j1", store }), /이미 있는 작업/);
  await assert.rejects(P.createJob({ jobId: "bad id!", store }), TypeError);
  await assert.rejects(P.createJob({ jobId: "j2" }), TypeError);
  assert.equal(await P.loadJob("nope", store), null);
  await store.putJson("jobs", "weird", { jobId: "weird", state: "teleporting" });
  await assert.rejects(P.loadJob("weird", store), /작업 기록/);
});

test("job: unknown record fields survive load and transition", async () => {
  const { store } = await mk();
  const job = await P.createJob({ jobId: "j1", store });
  await store.putJson("jobs", "j1", { ...job.record, futureField: { a: 1 } });
  const re = await P.loadJob("j1", store);
  await re.transition("acquiring_source");
  assert.deepEqual((await store.getJson("jobs", "j1")).futureField, { a: 1 });
});

test("job: concurrent transitions are serialized, so the second sees the first", async () => {
  const { store } = await mk();
  const job = await P.createJob({ jobId: "j1", store });
  const [a, b] = await Promise.allSettled([job.transition("acquiring_source"), job.transition("acquiring_source")]);
  assert.deepEqual([a.status, b.status], ["fulfilled", "rejected"]);
  // 취소가 전이와 겹쳐도 마지막 쓰기가 이긴다
  await Promise.all([job.transition("ingesting"), job.transition("cancelled")]);
  assert.equal(job.state, "cancelled");
  assert.equal((await store.getJson("jobs", "j1")).state, "cancelled");
});

test("job: a failed checkpoint write does not advance the in-memory state", async () => {
  const { store } = await mk();
  const job = await P.createJob({ jobId: "j1", store });
  const put = store.putJson.bind(store);
  store.putJson = () => Promise.reject(new Error("disk full"));
  await assert.rejects(job.transition("acquiring_source"), /disk full/);
  assert.equal(job.state, "created");
  store.putJson = put;
  await job.transition("acquiring_source"); // 앞선 실패가 쓰기 줄을 막지 않는다
  assert.equal(job.state, "acquiring_source");
});

// ── 단계 캐시 ──
test("digest/stageKey: hex SHA-256 of key-sorted JSON, stable across key order", async () => {
  const a = { b: 1, a: { d: [1, { z: 1, y: 2 }], c: "x" } }, b = { a: { c: "x", d: [1, { y: 2, z: 1 }] }, b: 1 };
  assert.equal(await P.digest(a), await P.digest(b));
  assert.equal(await P.digest(a), sha('{"a":{"c":"x","d":[1,{"y":2,"z":1}]},"b":1}'));
  assert.notEqual(await P.digest([1, 2]), await P.digest([2, 1])); // 배열 순서는 의미가 있다
  assert.match(await P.digest(undefined), /^[0-9a-f]{64}$/);

  const base = { stage: "refining", inputDigest: "d1", model: "m", promptVersion: "p1", schemaVersion: 1 };
  const k = await P.stageKey(base);
  assert.match(k, /^[0-9a-f]{64}$/);
  assert.equal(await P.stageKey({ schemaVersion: 1, promptVersion: "p1", model: "m", inputDigest: "d1", stage: "refining" }), k);
  for (const [f, v] of Object.entries({ stage: "judging", inputDigest: "d2", model: "m2", promptVersion: "p2", schemaVersion: 2 })) assert.notEqual(await P.stageKey({ ...base, [f]: v }), k, f);
  // 필드 경계가 뭉개지지 않는다
  assert.notEqual(await P.stageKey({ ...base, model: "a", promptVersion: "bc" }), await P.stageKey({ ...base, model: "ab", promptVersion: "c" }));
  await assert.rejects(P.stageKey({ inputDigest: "d" }), TypeError);
  await assert.rejects(P.stageKey({ stage: "s" }), TypeError);
});

test("cached: a hit skips compute; the value is stored encrypted under the package prefix", async () => {
  const { store, adapter } = await mk();
  let n = 0, seenSignal;
  const compute = async signal => { n++; seenSignal = signal; return { text: "비밀 강의 문장" }; };
  const key = await P.stageKey({ stage: "refining", inputDigest: "d1" });
  const ac = new AbortController();
  const v1 = await P.cached(store, key, compute, { packageId: "pkg1", signal: ac.signal });
  const v2 = await P.cached(store, key, compute, { packageId: "pkg1" });
  assert.equal(n, 1);
  assert.equal(seenSignal, ac.signal);
  assert.deepEqual(v2, v1);
  const id = `pkg1:s:${key}`;
  assert.deepEqual(await store.ids("packages"), [id]);
  assert.equal(JSON.stringify(await adapter.get("packages", id)).includes("비밀"), false);
  await P.cached(store, key, compute, { packageId: "pkg2" }); // 다른 패키지는 별도 항목
  assert.equal(n, 2);
});

test("cached: falsy results are real hits, a corrupt record is a miss, abort skips compute", async () => {
  const { store, adapter } = await mk();
  for (const [i, v] of [0, false, "", null].entries()) {
    let n = 0;
    const k = await P.digest(i);
    await P.cached(store, k, async () => (n++, v));
    assert.deepEqual(await P.cached(store, k, async () => (n++, "x")), v);
    assert.equal(n, 1, `falsy ${i}`);
  }
  const k = await P.digest("corrupt"), other = await P.digest("other");
  await P.cached(store, other, async () => "o");
  await adapter.put("packages", `s:${k}`, await adapter.get("packages", `s:${other}`)); // 다른 id로 복사 → 복호화 실패
  assert.equal(await P.cached(store, k, async () => "fresh"), "fresh");
  assert.equal(await P.cached(store, k, async () => "again"), "fresh"); // 덮어써서 다음엔 히트
  const ac = new AbortController(); ac.abort();
  let called = false;
  await assert.rejects(P.cached(store, await P.digest("z"), async () => (called = true), { signal: ac.signal }), { name: "AbortError" });
  assert.equal(called, false);
});

test("cached stats: hits and misses are counted when a stats object is passed", async () => {
  const { store } = await mk();
  const stats = { hits: 0, misses: 0 }, key = await P.digest("k");
  await P.cached(store, key, async () => "v", { stats });
  await P.cached(store, key, async () => "x", { stats });
  await P.cached(store, key, async () => "x"); // stats 없으면 세지 않는다
  assert.deepEqual(stats, { hits: 1, misses: 1 });
});

// ── 스케줄러: 큐 ──
test("queue: put blocks while full until a take frees a slot (backpressure), FIFO", async () => {
  const q = P.createQueue({ capacity: 2 });
  await q.put(1); await q.put(2);
  let third = false;
  const p = q.put(3).then(() => { third = true; });
  await tick();
  assert.deepEqual([third, q.size], [false, 2]);
  assert.deepEqual(await q.take(), { done: false, value: 1 });
  await p;
  assert.deepEqual([third, q.size], [true, 2]);
  assert.deepEqual([(await q.take()).value, (await q.take()).value], [2, 3]);
});

test("queue: take waits for a put; close drains what is left, then reports done", async () => {
  const q = P.createQueue({ capacity: 1 });
  const t = q.take();
  await q.put("a"); // 대기 중인 take에 바로 넘어간다
  assert.deepEqual(await t, { done: false, value: "a" });
  await q.put("b");
  const idle = q.take();
  q.close();
  assert.deepEqual(await idle, { done: false, value: "b" });
  assert.deepEqual(await q.take(), { done: true });
  await assert.rejects(q.put("c"), /닫힌 큐/);
  const waiter = P.createQueue();
  const w = waiter.take();
  waiter.close();
  assert.deepEqual(await w, { done: true }); // 비어서 기다리던 take는 done으로 깨운다
});

test("queue: close rejects pending puts but keeps buffered items takeable", async () => {
  const q = P.createQueue({ capacity: 1 });
  await q.put("a");
  const blocked = q.put("b");
  q.close();
  await assert.rejects(blocked, /닫혔습니다/);
  assert.deepEqual(await q.take(), { done: false, value: "a" });
  assert.deepEqual(await q.take(), { done: true });
});

test("queue: abort() and the queue signal reject every waiter and later calls", async () => {
  const q = P.createQueue({ capacity: 1 });
  await q.put("a");
  const blockedPut = q.put("b");
  q.abort();
  await assert.rejects(blockedPut, { name: "AbortError" });
  await assert.rejects(q.take(), { name: "AbortError" });
  await assert.rejects(q.put("c"), { name: "AbortError" });
  assert.equal(q.size, 0);

  const ac = new AbortController(), q2 = P.createQueue({ signal: ac.signal });
  const t = q2.take();
  ac.abort();
  await assert.rejects(t, { name: "AbortError" });
  const pre = new AbortController(); pre.abort();
  await assert.rejects(P.createQueue({ signal: pre.signal }).take(), { name: "AbortError" });
});

test("queue: a per-call signal removes the waiter so it cannot swallow a later item", async () => {
  const q = P.createQueue({ capacity: 1 });
  const ac = new AbortController();
  const t = q.take({ signal: ac.signal });
  ac.abort();
  await assert.rejects(t, { name: "AbortError" });
  await q.put("x");
  assert.deepEqual(await q.take(), { done: false, value: "x" });

  await q.put("a");
  const ac2 = new AbortController();
  const p = q.put("b", { signal: ac2.signal });
  ac2.abort();
  await assert.rejects(p, { name: "AbortError" });
  assert.deepEqual(await q.take(), { done: false, value: "a" });
  assert.equal(q.size, 0); // 취소된 put의 항목이 뒤늦게 들어오지 않는다
  await assert.rejects(q.take({ signal: ac2.signal }), { name: "AbortError" });
  assert.throws(() => P.createQueue({ capacity: 0 }), RangeError);
});

// ── 스케줄러: 풀 ──
test("pool: never exceeds the lane limit and keeps result order", async () => {
  let active = 0, max = 0;
  const items = Array.from({ length: 10 }, (_, i) => i);
  const out = await P.pool(items, async n => { active++; max = Math.max(max, active); await tick(); active--; return n * 2; }, { lanes: 3 });
  assert.equal(max, 3);
  assert.deepEqual(out, items.map(n => ({ status: "ok", value: n * 2 })));
  // 레인이 항목보다 많아도, 0이어도 안전하다
  assert.deepEqual(await P.pool([1, 2], async n => n, { lanes: 99 }), [{ status: "ok", value: 1 }, { status: "ok", value: 2 }]);
  assert.deepEqual(await P.pool([1], async n => n, { lanes: 0 }), [{ status: "ok", value: 1 }]);
  assert.deepEqual(await P.pool([], async n => n, { lanes: 4 }), []);
});

test("laneCount: defaults from §7, remote config overrides, bad values fall back, ceiling applies", () => {
  assert.deepEqual([P.laneCount("stt"), P.laneCount("vision"), P.laneCount("plan"), P.laneCount("write")], [4, 8, 1, 8]);
  assert.equal(P.laneCount("stt", { stt: 2 }), 2);
  assert.equal(P.laneCount("stt", { vision: 1 }), 4);
  for (const bad of [0, -1, "x", null, NaN]) assert.equal(P.laneCount("stt", { stt: bad }), 4, String(bad));
  assert.equal(P.laneCount("stt", { stt: 1000 }), 16);
  assert.equal(P.laneCount("unknown"), 1);
});

test("pool: a failure keeps finished successes (and stopOnFail stops new items)", async () => {
  const worker = async n => { if (n === 1) throw svcErr("STT_BAD_CHUNK"); return n; };
  const out = await P.pool([0, 1, 2, 3], worker, { lanes: 2 });
  assert.deepEqual(out.map(o => o.status), ["ok", "failed", "ok", "ok"]);
  assert.equal(out[1].error.code, "STT_BAD_CHUNK");
  assert.deepEqual(out.filter(o => o.status === "ok").map(o => o.value), [0, 2, 3]);

  const stopped = await P.pool([0, 1, 2, 3], worker, { lanes: 1, stopOnFail: true });
  assert.deepEqual(stopped.map(o => o.status), ["ok", "failed", "skipped", "skipped"]);
});

test("pool: abort mid-run stops pending items (skipped) and keeps what already finished", async () => {
  const ac = new AbortController(), started = [];
  const worker = (n, i, signal) => new Promise((resolve, reject) => {
    started.push(n);
    if (n === 0) return resolve("zero");
    signal.addEventListener("abort", () => reject(abortErr()), { once: true });
  });
  const run = P.pool([0, 1, 2, 3, 4, 5], worker, { lanes: 2, signal: ac.signal });
  await tick();
  ac.abort();
  const out = await run;
  assert.deepEqual(started, [0, 1, 2]); // 2칸 레인: 0은 끝나서 2가 시작, 1과 2는 취소로 멈춤
  assert.deepEqual(out.map(o => o.status), ["ok", "skipped", "skipped", "skipped", "skipped", "skipped"]);
  assert.equal(out[0].value, "zero");

  const pre = new AbortController(); pre.abort();
  let calls = 0;
  const none = await P.pool([1, 2, 3], async () => calls++, { lanes: 2, signal: pre.signal });
  assert.deepEqual([calls, none.map(o => o.status)], [0, ["skipped", "skipped", "skipped"]]);
});

test("pool: emits one span per item with codes only, and skipped for items never started", async () => {
  const bus = new EventBus({ now: clock() });
  await P.pool([0, 1, 2], async n => { if (n === 1) throw svcErr("provider_busy"); return n; }, { lanes: 1, stopOnFail: true, events: bus, stage: "vision" });
  const last = unit => bus.recent().filter(e => e.unit === unit).at(-1);
  assert.deepEqual([last("0").status, last("1").status, last("1").code, last("2").status], ["done", "failed", "PROVIDER_BUSY", "skipped"]);
  assert.ok(bus.recent().every(e => e.stage === "vision"));
  await assert.rejects(P.pool("nope", async () => {}), TypeError);
});

// ── 클라이언트 재시도 ──
test("withRetry: retries retryable errors with 1000·2^n backoff and ±20% jitter", async () => {
  const { delays, sleep } = fakeSleep();
  let n = 0;
  const r = await P.withRetry(async a => { if (++n < 4) throw retryable(); return a; }, { sleep, random: () => 0.5 });
  assert.equal(r, 3);
  [1000, 2000, 4000].forEach((d, i) => near(delays[i], d));
  assert.equal(delays.length, 3);
  for (const [random, f] of [[() => 0, 0.8], [() => 1, 1.2]]) {
    const s = fakeSleep();
    await assert.rejects(P.withRetry(async () => { throw retryable(); }, { sleep: s.sleep, random }));
    [1000, 2000, 4000].forEach((d, i) => near(s.delays[i], d * f));
  }
});

test("withRetry: gives up after 1 + retries attempts with the last error", async () => {
  const { delays, sleep } = fakeSleep();
  let n = 0;
  await assert.rejects(P.withRetry(async () => { throw retryable("provider_busy", { seq: ++n }); }, { sleep, random: () => 0.5 }), { seq: 4 });
  assert.deepEqual([n, delays.length], [4, 3]);
  n = 0;
  await assert.rejects(P.withRetry(async () => { n++; throw retryable(); }, { sleep, retries: 0 }));
  assert.equal(n, 1);
});

test("withRetry: non-retryable errors and plain bugs are thrown immediately", async () => {
  for (const err of [svcErr("quota_exceeded"), svcErr("invalid_stt_params"), new TypeError("x is not a function"), new Error("boom")]) {
    const { delays, sleep } = fakeSleep();
    let n = 0;
    await assert.rejects(P.withRetry(async () => { n++; throw err; }, { sleep }), e => e === err);
    assert.deepEqual([n, delays], [1, []]);
  }
});

test("withRetry: network errors (fetch TypeError) are retried", async () => {
  for (const msg of ["Failed to fetch", "fetch failed", "NetworkError when attempting to fetch resource.", "Load failed"]) {
    const { delays, sleep } = fakeSleep();
    let n = 0;
    assert.equal(await P.withRetry(async () => { if (++n < 2) throw new TypeError(msg); return "ok"; }, { sleep }), "ok", msg);
    assert.equal(delays.length, 1);
  }
});

test("withRetry: retryAfterMs wins over a shorter backoff, a shorter hint loses, a huge hint is capped", async () => {
  const { delays, sleep } = fakeSleep();
  const hints = [5000, 100, 10 * 60 * 1000];
  let n = 0;
  await P.withRetry(async () => { if (n < 3) throw retryable("rate_limited", { retryAfterMs: hints[n++] }); }, { sleep, random: () => 0.5 });
  [5000, 2000, 60000].forEach((d, i) => near(delays[i], d));
});

test("withRetry: a fresh requestId per attempt, so a server that rejects reused ids still succeeds", async () => {
  // 서버 모사: 한 번 본 requestId는 409. 실패(uncertain)해도 id는 계속 막힌다.
  const seen = new Set(), ids = [];
  const server = id => { if (seen.has(id)) throw svcErr("request_already_reserved_or_processed"); seen.add(id); };
  let fails = 2;
  const { sleep } = fakeSleep();
  const result = await P.withRetry(async attempt => {
    const id = P.retryId("stt-abc", attempt);
    ids.push(id);
    server(id);
    if (fails-- > 0) throw retryable("provider_failed_or_invalid_output");
    return "done";
  }, { sleep });
  assert.equal(result, "done");
  assert.deepEqual(ids, ["stt-abc", "stt-abc-r1", "stt-abc-r2"]);
  assert.equal(new Set(ids).size, ids.length);
  // 같은 id를 재사용하면 첫 재시도에서 409로 끝난다 — 이 정책이 필요한 이유
  const reused = new Set();
  await assert.rejects(P.withRetry(async () => { if (reused.has("x")) throw svcErr("request_already_reserved_or_processed"); reused.add("x"); throw retryable(); }, { sleep }), { code: "request_already_reserved_or_processed" });
});

test("withRetry: cancellation stops promptly (before, during sleep, and on AbortError)", async () => {
  const pre = new AbortController(); pre.abort();
  let n = 0;
  await assert.rejects(P.withRetry(async () => n++, { signal: pre.signal }), { name: "AbortError" });
  assert.equal(n, 0);

  const ac = new AbortController();
  const abortingSleep = async (ms, signal) => { ac.abort(); if (signal.aborted) throw abortErr(); };
  await assert.rejects(P.withRetry(async () => { n++; throw retryable(); }, { signal: ac.signal, sleep: abortingSleep }), { name: "AbortError" });
  assert.equal(n, 1);

  // 서비스 클라이언트의 AbortError(취소·타임아웃)는 재시도하지 않는다
  const { delays, sleep } = fakeSleep();
  n = 0;
  await assert.rejects(P.withRetry(async () => { n++; throw abortErr(); }, { sleep }), { name: "AbortError" });
  assert.deepEqual([n, delays], [1, []]);
});

test("withRetry: the default sleep really waits, and abort cuts a long wait short", async () => {
  let n = 0;
  assert.equal(await P.withRetry(async () => { if (++n < 2) throw retryable(); return "ok"; }, { baseMs: 1 }), "ok");
  const ac = new AbortController();
  const run = P.withRetry(async () => { throw retryable(); }, { baseMs: 600000, signal: ac.signal });
  await tick();
  ac.abort();
  await assert.rejects(run, { name: "AbortError" });
});

// ── 회로 차단기 ──
test("breaker: opens after 5 consecutive failures and then fails fast with no call", async () => {
  let t = 0, calls = 0;
  const b = P.createBreaker({ now: () => t });
  const bad = async () => { calls++; throw retryable(); };
  for (let i = 0; i < 4; i++) await assert.rejects(b.run("groq:stt", bad), { code: "provider_busy" });
  assert.equal(b.state("groq:stt"), "closed");
  await assert.rejects(b.run("groq:stt", bad), { code: "provider_busy" });
  assert.equal(b.state("groq:stt"), "open");
  t = 10000;
  await assert.rejects(b.run("groq:stt", bad), e => e.code === "LLM_CIRCUIT_OPEN" && e.retryable === false && e.retryAfterMs === 50000 && /[가-힣]/.test(e.message));
  await assert.rejects(b.run("groq:stt", bad, { area: "STT" }), { code: "STT_CIRCUIT_OPEN" });
  assert.equal(calls, 5); // 열린 동안 네트워크 호출 없음
  // 다른 키는 영향이 없다
  assert.equal(await b.run("openrouter:plan", async () => "ok"), "ok");
  assert.equal(b.state("openrouter:plan"), "closed");
});

test("breaker: half-opens after openMs, lets one probe through, closes on success", async () => {
  let t = 0;
  const b = P.createBreaker({ failures: 2, openMs: 60000, now: () => t });
  const bad = async () => { throw retryable(); };
  for (let i = 0; i < 2; i++) await assert.rejects(b.run("k", bad));
  t = 59999;
  assert.equal(b.state("k"), "open");
  t = 60000;
  assert.equal(b.state("k"), "half-open");
  let release;
  const probe = b.run("k", () => new Promise(r => { release = r; }));
  await tick();
  // 시험 호출이 나가 있는 동안 다른 호출은 즉시 실패한다
  await assert.rejects(b.run("k", async () => "x"), { code: "LLM_CIRCUIT_OPEN" });
  release("probed");
  assert.equal(await probe, "probed");
  assert.equal(b.state("k"), "closed");
  assert.equal(await b.run("k", async () => "after"), "after");
  // 닫힌 뒤에는 연속 실패 카운트가 새로 시작한다
  await assert.rejects(b.run("k", bad));
  assert.equal(b.state("k"), "closed");
});

test("breaker: a failed probe re-opens for another openMs", async () => {
  let t = 0;
  const b = P.createBreaker({ failures: 1, openMs: 1000, now: () => t });
  await assert.rejects(b.run("k", async () => { throw retryable(); }));
  t = 1000;
  await assert.rejects(b.run("k", async () => { throw retryable("provider_busy", { seq: "probe" }); }), { seq: "probe" });
  assert.equal(b.state("k"), "open");
  t = 1999;
  await assert.rejects(b.run("k", async () => "x"), { code: "LLM_CIRCUIT_OPEN" });
  t = 2000;
  assert.equal(await b.run("k", async () => "recovered"), "recovered");
  assert.equal(b.state("k"), "closed");
});

test("breaker: only consecutive provider-health failures count", async () => {
  const b = P.createBreaker({ failures: 3, now: () => 0 });
  const bad = async () => { throw retryable(); };
  await assert.rejects(b.run("k", bad)); await assert.rejects(b.run("k", bad));
  await b.run("k", async () => "ok"); // 성공이 연속 실패를 끊는다
  await assert.rejects(b.run("k", bad)); await assert.rejects(b.run("k", bad));
  assert.equal(b.state("k"), "closed");
  await assert.rejects(b.run("k", async () => { throw svcErr("invalid_stt_params"); })); // 정상 거절은 제공자가 살아 있다는 뜻
  await assert.rejects(b.run("k", bad)); await assert.rejects(b.run("k", bad));
  assert.equal(b.state("k"), "closed");
  for (let i = 0; i < 5; i++) await assert.rejects(b.run("k", async () => { throw abortErr(); })); // 취소는 세지 않는다
  assert.equal(b.state("k"), "closed");
  const net = async () => { throw new TypeError("fetch failed"); }; // 네트워크 오류는 센다
  for (let i = 0; i < 3; i++) await assert.rejects(b.run("k", net));
  assert.equal(b.state("k"), "open");
});

test("breaker + withRetry: an open circuit ends the retry loop (no further calls)", async () => {
  const b = P.createBreaker({ failures: 2, now: () => 0 });
  const { delays, sleep } = fakeSleep();
  let calls = 0;
  await assert.rejects(
    P.withRetry(attempt => b.run("stt", async () => { calls++; throw retryable("provider_busy", { attempt }); }, { area: "STT" }), { sleep, random: () => 0.5 }),
    { code: "STT_CIRCUIT_OPEN" });
  // 차단기를 연 시도는 원래 오류(retryable)라 한 번 더 백오프하고, 다음 시도부터는 호출 없이 바로 끝난다
  assert.deepEqual([calls, delays.length], [2, 2]);
});

// ── 오류 코드 ──
test("CODES: <AREA>_<CAUSE> scheme, Korean user messages, valid pause reasons, event-safe", () => {
  const areas = ["SRC", "NET", "STT", "VIS", "JDG", "LLM", "VAL", "QUOTA", "CONSENT", "MEM"];
  const bus = new EventBus();
  for (const [code, c] of Object.entries(P.CODES)) {
    assert.match(code, /^[A-Z]+_[A-Z_]+$/);
    assert.ok(areas.includes(code.split("_")[0]), code);
    assert.equal(typeof c.retryable, "boolean", code);
    assert.match(c.userMessage, /[가-힣]/, code);
    if (c.pause) assert.ok(P.PAUSE_REASONS.includes(c.pause), code);
    bus.emit({ stage: "job", code }); // 이벤트 허용 목록 통과
  }
  // §8 FMEA가 이름 붙인 코드와 차단기 코드
  for (const code of ["SRC_AUTH_EXPIRED", "SRC_PROTECTED", "MEM_BUDGET_EXCEEDED", "QUOTA_EXCEEDED", "STT_UNAVAILABLE", "VIS_UNAVAILABLE", "STT_CIRCUIT_OPEN", "VIS_CIRCUIT_OPEN", "JDG_CIRCUIT_OPEN", "LLM_CIRCUIT_OPEN"]) assert.ok(code in P.CODES, code);
  assert.ok(Object.keys(P.CODES).length <= 24, "작은 표를 유지한다 — 실제로 내는 코드만 둔다");
  assert.equal(Object.isFrozen(P.CODES), true);
  // 자동 재시도를 켜는 건 네트워크 오류 하나뿐 — 나머지는 이미 재시도한 뒤의 결과다
  assert.deepEqual(Object.entries(P.CODES).filter(([, c]) => c.retryable).map(([k]) => k), ["NET_UNREACHABLE"]);
  assert.equal(P.CODES.SRC_AUTH_EXPIRED.pause, "auth");
  assert.equal(P.CODES.QUOTA_EXCEEDED.pause, "quota");
  assert.equal(P.CODES.SRC_PROTECTED.pause, undefined); // 보호조치는 우회하지 않고 실시간 모드를 제안하며 끝낸다
});

test("pipelineError / codeOf: service-client shaped errors and classification", () => {
  const e = P.pipelineError("NET_UNREACHABLE", { retryAfterMs: 5 });
  assert.deepEqual([e.code, e.retryable, e.retryAfterMs, e instanceof Error], ["NET_UNREACHABLE", true, 5, true]);
  assert.equal(e.message, P.CODES.NET_UNREACHABLE.userMessage);
  assert.equal(P.pipelineError("SRC_PROTECTED").retryable, false);
  assert.equal(P.pipelineError("constructor").retryable, false); // 프로토타입 키를 코드로 착각하지 않는다
  assert.equal(P.codeOf(svcErr("SRC_PROTECTED")), "SRC_PROTECTED");
  assert.equal(P.codeOf(svcErr("SRC_HTTP_404")), "SRC_HTTP_404");
  assert.equal(P.codeOf(svcErr("quota_exceeded")), "QUOTA_EXCEEDED");
  assert.equal(P.codeOf(new TypeError("fetch failed")), "NET_UNREACHABLE");
  assert.equal(P.codeOf(abortErr()), "NET_UNREACHABLE");
  assert.equal(P.codeOf(retryable(), "STT"), "STT_UNAVAILABLE");
  assert.equal(P.codeOf(retryable()), "LLM_UNAVAILABLE");
  assert.equal(P.codeOf(retryable(), "SRC"), null);
  assert.equal(P.codeOf(svcErr("invalid_stt_params")), null);
  assert.equal(P.codeOf(new Error("boom")), null);
  assert.equal(P.codeOf(null), null);
});

// ── runStages ──
const stagesFor = (log, over = {}) => P.STATES.slice(1, -1).map(state => ({
  state,
  key: async () => ({ inputDigest: await P.digest({ state }), model: "m", promptVersion: "p1", schemaVersion: 1 }),
  run: async ctx => { log.push(state); return over[state] ? over[state](ctx) : { state, text: "비밀 강의 내용 " + state }; },
}));

test("runStages: runs the stages with transitions, caches outputs, keeps lecture content out of job/events", async () => {
  const { store } = await mk();
  const bus = new EventBus({ now: clock() });
  const job = await P.createJob({ jobId: "j1", packageId: "pkg", store, events: bus, now: clock() });
  const log = [], ctx = {};
  assert.equal(await P.runStages(job, stagesFor(log), ctx), job);
  assert.equal(job.state, "done");
  assert.deepEqual(log, P.STATES.slice(1, -1));
  assert.deepEqual(Object.keys(job.record.completed), P.STATES.slice(1, -1));
  assert.ok(Object.values(job.record.completed).every(k => /^[0-9a-f]{64}$/.test(k)));
  // 내용은 단계 캐시에만 있고 작업 체크포인트·이벤트에는 없다
  assert.equal(JSON.stringify(await store.getJson("jobs", "j1")).includes("비밀"), false);
  assert.equal(JSON.stringify(bus.recent()).includes("비밀"), false);
  const ids = await store.ids("packages");
  assert.equal(ids.length, 8);
  assert.ok(ids.every(id => id.startsWith("pkg:s:")));
  assert.equal((await store.getJson("packages", ids[0])).value.text.includes("비밀"), true);
  // 생명주기 이벤트: 코드·상태 이름뿐
  const lifecycle = bus.recent().filter(e => e.stage === "job").map(e => e.msg);
  assert.deepEqual(lifecycle, ["created", ...P.STATES.slice(1).map((s, i) => `${P.STATES[i]}>${s}`)]);
  const spans = bus.recent().filter(e => e.stage === "writing");
  assert.deepEqual(spans.map(e => e.status), ["running", "done"]);
});

test("runStages: a second job on the same package reuses every cached stage", async () => {
  const { store } = await mk();
  const log = [];
  await P.runStages(await P.createJob({ jobId: "j1", packageId: "pkg", store }), stagesFor(log));
  const bus = new EventBus();
  const j2 = await P.createJob({ jobId: "j2", packageId: "pkg", store, events: bus });
  const ctx = {};
  await P.runStages(j2, stagesFor(log), ctx);
  assert.equal(log.length, 8); // 새로 계산한 단계 없음
  assert.equal(j2.state, "done");
  assert.equal(ctx.out.planning.state, "planning"); // 값은 캐시에서 복원된다
  const skips = bus.recent().filter(e => e.status === "skipped");
  assert.equal(skips.length, 8);
  assert.ok(skips.every(e => e.msg === "cache"));
  // 입력 다이제스트가 바뀐 단계만 다시 계산한다
  const log3 = [], stages = stagesFor(log3);
  stages[4].key = async () => ({ inputDigest: "changed" }); // planning
  await P.runStages(await P.createJob({ jobId: "j3", packageId: "pkg", store }), stages);
  assert.deepEqual(log3, ["planning"]);
});

test("runStages: a paused job resumes after a restart; finished stages come from the cache", async () => {
  const { store } = await mk();
  const log = [];
  let quota = true;
  const over = { writing: ctx => { if (quota) throw P.pipelineError("QUOTA_EXCEEDED"); assert.equal(ctx.out.planning.state, "planning"); return { done: true }; } };
  const job = await P.createJob({ jobId: "j1", store });
  assert.equal(await P.runStages(job, stagesFor(log, over)), job);
  assert.deepEqual([job.state, job.stage, job.record.reason, job.record.code], ["paused", "writing", "quota", "QUOTA_EXCEEDED"]);
  assert.deepEqual(Object.keys(job.record.completed), ["acquiring_source", "ingesting", "refining", "judging", "planning"]);
  await assert.rejects(P.runStages(job, stagesFor(log, over)), /resume/);

  // offscreen이 죽었다 살아난 상황: 새 Job을 체크포인트에서 읽는다
  quota = false;
  const re = await P.loadJob("j1", store);
  await re.resume();
  await P.runStages(re, stagesFor(log, over));
  assert.equal(re.state, "done");
  assert.deepEqual(log, ["acquiring_source", "ingesting", "refining", "judging", "planning", "writing", "writing", "validating", "rendering"]);
});

test("runStages: a failed job reopens at its recorded stage; finished stages come from the cache", async () => {
  const { store } = await mk();
  const log = [];
  let quota = true;
  const over = { writing: () => { if (quota) throw P.pipelineError("MEM_BUDGET_EXCEEDED"); return { done: true }; } };
  const job = await P.createJob({ jobId: "j1", store });
  await P.runStages(job, stagesFor(log, over));
  assert.deepEqual([job.state, job.stage, job.record.code], ["failed", "writing", "MEM_BUDGET_EXCEEDED"]);
  assert.deepEqual(Object.keys(job.record.completed), ["acquiring_source", "ingesting", "refining", "judging", "planning"]);
  // offscreen이 죽었다 살아난 상황: 실패한 작업을 되돌려 이어 간다 — 끝난 단계는 캐시에서 복원한다
  quota = false;
  const re = await P.loadJob("j1", store);
  await re.reopen();
  await P.runStages(re, stagesFor(log, over));
  assert.equal(re.state, "done");
  assert.deepEqual(log, ["acquiring_source", "ingesting", "refining", "judging", "planning", "writing", "writing", "validating", "rendering"]);
});

test("runStages: coded errors pause or fail the job instead of throwing", async () => {
  const cases = [
    ["acquiring_source", P.pipelineError("SRC_AUTH_EXPIRED"), "paused", "auth", "SRC_AUTH_EXPIRED"],
    ["ingesting", new TypeError("fetch failed"), "paused", "network", "NET_UNREACHABLE"],
    ["ingesting", retryable(), "paused", "network", "LLM_UNAVAILABLE"],
    ["judging", P.pipelineError("CONSENT_REQUIRED"), "paused", "user", "CONSENT_REQUIRED"],
    ["planning", svcErr("quota_exceeded"), "paused", "quota", "QUOTA_EXCEEDED"],
    ["acquiring_source", P.pipelineError("SRC_PROTECTED"), "failed", undefined, "SRC_PROTECTED"],
    ["writing", svcErr("MEM_BUDGET_EXCEEDED"), "failed", undefined, "MEM_BUDGET_EXCEEDED"],
  ];
  for (const [i, [state, err, want, reason, code]] of cases.entries()) {
    const { store } = await mk();
    const job = await P.createJob({ jobId: "j" + i, store });
    const stages = stagesFor([], { [state]: () => { throw err; } });
    await P.runStages(job, stages);
    assert.deepEqual([job.state, job.record.reason, job.record.code, job.stage], [want, reason, code, state], state + " " + code);
  }
  // 영역은 stage.area로 정한다
  const { store } = await mk();
  const job = await P.createJob({ jobId: "a", store });
  const stages = stagesFor([], { ingesting: () => { throw retryable(); } });
  stages[1].area = "STT";
  await P.runStages(job, stages);
  assert.equal(job.record.code, "STT_UNAVAILABLE");
});

test("runStages: unexpected errors are rethrown, checkpoint stays at the last good state, events stay content-free", async () => {
  const { store } = await mk();
  const bus = new EventBus();
  const job = await P.createJob({ jobId: "j1", store, events: bus });
  const stages = stagesFor([], { refining: () => { throw new Error("비밀 문장이 담긴 오류"); } });
  await assert.rejects(P.runStages(job, stages), /비밀 문장/);
  assert.equal(job.state, "refining");
  assert.equal((await store.getJson("jobs", "j1")).state, "refining");
  const failed = bus.recent().find(e => e.stage === "refining" && e.status === "failed");
  assert.equal(failed.code, "UNKNOWN");
  assert.match(failed.msg, /^Error@pipeline\.test\.js:\d+$/); // 이름과 던진 위치만
  assert.equal(JSON.stringify(bus.recent()).includes("비밀"), false);
  await assert.rejects(P.runStages(job, [{ state: "bogus", key: async () => ({}), run: async () => {} }]), TypeError);
});

test("runStages: abort cancels the job, checkpoints it, and throws AbortError", async () => {
  const { store } = await mk();
  const ac = new AbortController();
  const job = await P.createJob({ jobId: "j1", store });
  let started;
  const running = new Promise(r => { started = r; });
  const stages = stagesFor([], { ingesting: ctx => new Promise((_, rej) => { started(); ctx.signal.addEventListener("abort", () => rej(abortErr()), { once: true }); }) });
  const run = P.runStages(job, stages, { signal: ac.signal });
  await running; // 암호화 I/O 시간에 기대지 않고 단계가 실제로 시작된 뒤에 취소한다
  ac.abort();
  await assert.rejects(run, { name: "AbortError" });
  assert.deepEqual([job.state, job.stage], ["cancelled", "ingesting"]);
  assert.equal((await store.getJson("jobs", "j1")).state, "cancelled");

  const pre = new AbortController(); pre.abort();
  const j2 = await P.createJob({ jobId: "j2", store });
  await assert.rejects(P.runStages(j2, stagesFor([]), { signal: pre.signal }), { name: "AbortError" });
  assert.equal(j2.state, "cancelled");
  // 이미 끝난 작업은 그대로 돌려준다
  assert.equal(await P.runStages(j2, stagesFor([])), j2);
});
test("withRetry retries a 409 duplicate so the caller can send a fresh requestId", async () => {
  const ids = [];
  const out = await P.withRetry(async n => { ids.push(n); if (n === 0) throw Object.assign(new Error("dup"), { code: "request_already_reserved_or_processed", retryable: false }); return "ok"; }, { sleep: async () => {} });
  assert.equal(out, "ok");
  assert.deepEqual(ids, [0, 1]);
});
