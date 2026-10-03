const test = require("node:test");
const assert = require("node:assert/strict");
const { normalize, EventBus, LogSink, safe } = require("./events.js");

const fakeStore = () => ({
  batches: [],
  async appendLogBatch(b) { this.batches.push(b); },
  async pruneLogs() { this.pruned = true; },
});
// 타이머는 실제 시계 대신 수동으로 돌린다 — tick()이 보류 중인 타이머 전부를 즉시 발사.
const fakeTimers = () => {
  const timers = new Map(); let seq = 0;
  return {
    setTimer: (fn, ms) => { const h = ++seq; timers.set(h, { fn, ms }); return h; },
    clearTimer: h => timers.delete(h),
    pending: () => timers.size,
    tick: () => { const due = [...timers.values()]; timers.clear(); for (const t of due) t.fn(); },
  };
};
const settle = () => new Promise(r => setTimeout(r, 0));

// normalize: 필드 검증, 기본값, 동결 결과
test("normalize validates fields, applies defaults, returns a frozen copy", () => {
  const e = normalize({ stage: "capture.frame" });
  assert.equal(e.level, "info");
  assert.ok(Number.isFinite(e.ts));
  assert.equal(Object.isFrozen(e), true);
  assert.equal("status" in e, false);
  assert.equal("jobId" in e, false);
  assert.equal("msg" in e, false);

  const input = { stage: "s", msg: "  a  b " };
  normalize(input);
  assert.equal(input.msg, "  a  b "); // 원본 불변

  const ok = normalize({ stage: "s", status: "queued", code: "OCR_FAIL_1", ms: 0, bytes: 0, costUsd: 0.5, model: "m", unit: "u" });
  assert.equal(ok.status, "queued");
  assert.equal(ok.code, "OCR_FAIL_1");

  const notPlain = { name: "TypeError", message: "event must be a plain object" };
  assert.throws(() => normalize(null), notPlain);
  assert.throws(() => normalize("x"), notPlain);
  assert.throws(() => normalize([]), notPlain);
  assert.throws(() => normalize(Object.assign([], { stage: "s" })), notPlain);
  assert.throws(() => normalize(new Date()), notPlain);
  assert.throws(() => normalize(() => {}), notPlain);
  assert.equal(normalize(Object.assign(Object.create(null), { stage: "s" })).stage, "s");
  assert.throws(() => normalize({ stage: "s", nope: 1 }), { name: "TypeError", message: "unknown event field: nope" });
  assert.throws(() => normalize({}), /stage/);
  assert.throws(() => normalize({ stage: 5 }), /stage/);
  assert.throws(() => normalize({ stage: "Bad Stage" }), /stage/);
  assert.throws(() => normalize({ stage: "a".repeat(33) }), /stage/);
  assert.throws(() => normalize({ stage: "s", ts: "now" }), /ts/);
  assert.throws(() => normalize({ stage: "s", ts: NaN }), /ts/);
  assert.throws(() => normalize({ stage: "s", ms: -1 }), /ms/);
  assert.throws(() => normalize({ stage: "s", bytes: Infinity }), /bytes/);
  assert.throws(() => normalize({ stage: "s", costUsd: "0.1" }), /costUsd/);
  assert.throws(() => normalize({ stage: "s", jobId: 1 }), /jobId/);
  assert.throws(() => normalize({ stage: "s", jobId: "x".repeat(129) }), /jobId/);
  assert.throws(() => normalize({ stage: "s", unit: "x".repeat(65) }), /unit/);
  assert.throws(() => normalize({ stage: "s", model: {} }), /model/);
  assert.throws(() => normalize({ stage: "s", status: "nope" }), /status/);
  assert.throws(() => normalize({ stage: "s", level: "nope" }), /level/);
  assert.throws(() => normalize({ stage: "s", code: "lower" }), /code/);
  assert.throws(() => normalize({ stage: "s", msg: 42 }), /msg/);
});

// normalize: msg는 공백 압축·200자 절단 — 절대 길이로 던지지 않는다
test("normalize collapses and truncates msg without throwing", () => {
  assert.equal(normalize({ stage: "s", msg: "  a   b\tc\n" }).msg, "a b c");
  const long = normalize({ stage: "s", msg: "x".repeat(500) });
  assert.equal(long.msg.length, 200);
  assert.equal(normalize({ stage: "s", msg: "" }).msg, "");
});

// EventBus: 링 버퍼 한도, 리스너 예외 격리, off()
test("EventBus keeps newest limit events and isolates listener errors", () => {
  const bus = new EventBus({ limit: 3, now: () => 7, id: () => "id" });
  for (let i = 0; i < 5; i++) bus.emit({ stage: "s", msg: "m" + i });
  assert.deepEqual(bus.recent().map(e => e.msg), ["m2", "m3", "m4"]);
  assert.deepEqual(bus.recent(2).map(e => e.msg), ["m3", "m4"]);
  assert.equal(bus.recent()[0].ts, 7); // 주입한 시계가 ts 기본값
  const copy = bus.recent(); copy.push(null);
  assert.equal(bus.recent().length, 3); // 반환값은 복사본

  const seen = [];
  bus.on(() => { throw new Error("boom"); });
  bus.on(e => seen.push(e));
  const emitted = bus.emit({ stage: "s" });
  assert.equal(seen.at(-1), emitted);
  assert.equal(Object.isFrozen(emitted), true);

  let count = 0;
  const off = bus.on(() => count++);
  bus.emit({ stage: "s" });
  off();
  bus.emit({ stage: "s" });
  assert.equal(count, 1);
});

// span: running → done/failed/skipped, 주입 시계로 ms 계측, 두 번째 종료 호출 무시
test("span emits running then terminal status with measured ms", () => {
  let t = 100, seq = 0;
  const bus = new EventBus({ now: () => t, id: () => "span" + seq++ });
  const events = [];
  bus.on(e => events.push(e));

  const s = bus.span({ stage: "ocr", jobId: "j1", traceId: "tr1", parentSpanId: "p0", unit: "slide-3" });
  assert.equal(s.id, "span0");
  assert.equal(events[0].status, "running");
  assert.equal(events[0].spanId, "span0");

  t += 42;
  s.done({ bytes: 512 });
  const done = events[1];
  assert.equal(done.status, "done");
  assert.equal(done.ms, 42);
  assert.equal(done.bytes, 512);
  assert.deepEqual(
    [done.stage, done.jobId, done.traceId, done.unit, done.spanId, done.parentSpanId],
    ["ocr", "j1", "tr1", "slide-3", "span0", "p0"]
  );

  s.done({ msg: "again" }); // 두 번째 종료 호출은 무시
  s.skip();
  s.fail("SHOULD_NOT");
  assert.equal(events.length, 2);

  const s2 = bus.span({ stage: "asr", jobId: "j1" });
  t += 5;
  s2.fail("ASR_TIMEOUT", { msg: "worker stalled" });
  const failed = events.at(-1);
  assert.equal(failed.status, "failed");
  assert.equal(failed.code, "ASR_TIMEOUT");
  assert.equal(failed.level, "error");
  assert.equal(failed.ms, 5);
  assert.equal(failed.msg, "worker stalled");

  const s3 = bus.span({ stage: "summarize" });
  s3.skip();
  assert.equal(events.at(-1).status, "skipped");
});

// safe(): 잘못된 진단 필드의 TypeError를 삼켜 본 파이프라인 호출자를 보호한다 — 버스 자체는 여전히 엄격
test("safe() keeps invalid diagnostics from throwing into the pipeline", () => {
  const bus = new EventBus({ id: () => "sp" });
  const events = safe(bus);

  assert.doesNotThrow(() => events.emit({ stage: "Bad Stage" }));
  assert.doesNotThrow(() => events.emit({ stage: "s", jobId: 42 }));
  assert.equal(bus.recent().length, 0);

  const bad = events.span({ stage: "s", jobId: 42 });
  assert.equal(bad.id, "");
  assert.doesNotThrow(() => bad.done());
  assert.doesNotThrow(() => bad.fail("X"));
  assert.doesNotThrow(() => bad.skip());

  const ok = events.span({ stage: "ocr", jobId: "j" });
  assert.doesNotThrow(() => ok.done({ bytes: -1 })); // 잘못된 종료 extra도 삼킨다
  events.emit({ stage: "s", msg: "fine" });
  assert.deepEqual(bus.recent().map(e => e.stage + ":" + (e.status || "")), ["ocr:running", "s:"]);

  const ok2 = events.span({ stage: "asr" });
  ok2.done();
  const tail = bus.recent().slice(-2);
  assert.equal(tail[0].status, "running");
  assert.equal(tail[1].status, "done");
  assert.equal(tail[0].spanId, tail[1].spanId);
});

// LogSink: batchSize 도달 시 즉시 flush, 아니면 intervalMs 타이머로 flush
test("LogSink flushes by batch size and by timer", async () => {
  const store = fakeStore(), timers = fakeTimers(), bus = new EventBus();
  const sink = new LogSink(bus, store, { batchSize: 3, intervalMs: 1000, setTimer: timers.setTimer, clearTimer: timers.clearTimer });

  bus.emit({ stage: "a" }); bus.emit({ stage: "b" });
  assert.equal(store.batches.length, 0);
  assert.equal(timers.pending(), 1); // 하나의 보류 타이머만
  bus.emit({ stage: "c" });
  assert.equal(store.batches.length, 1); // appendLogBatch 본문은 호출 시 동기 실행
  assert.equal(store.batches[0].length, 3);
  assert.equal(timers.pending(), 0); // 플러시가 타이머를 해제

  bus.emit({ stage: "d" });
  assert.equal(timers.pending(), 1);
  timers.tick();
  await settle(); // 앞선 flush가 끝난 뒤에야 직렬화된 다음 flush가 실행된다
  assert.equal(store.batches.length, 2);
  assert.deepEqual(store.batches[1].map(e => e.stage), ["d"]);
  await sink.dispose();
});

// LogSink: minLevel 미만은 버퍼에도 들어가지 않는다
test("LogSink filters events below minLevel", async () => {
  const store = fakeStore(), timers = fakeTimers(), bus = new EventBus();
  const sink = new LogSink(bus, store, { setTimer: timers.setTimer, clearTimer: timers.clearTimer });
  bus.emit({ stage: "s", level: "debug" });
  assert.equal(timers.pending(), 0);
  bus.emit({ stage: "s", level: "warn" });
  bus.emit({ stage: "s" }); // 기본 info는 통과
  timers.tick();
  assert.deepEqual(store.batches[0].map(e => e.level), ["warn", "info"]);

  const store2 = fakeStore(), timers2 = fakeTimers(), bus2 = new EventBus();
  const sink2 = new LogSink(bus2, store2, { minLevel: "error", setTimer: timers2.setTimer, clearTimer: timers2.clearTimer });
  bus2.emit({ stage: "s", level: "warn" });
  assert.equal(timers2.pending(), 0);
  bus2.emit({ stage: "s", level: "error" });
  timers2.tick();
  assert.equal(store2.batches[0].length, 1);
  await sink.dispose(); await sink2.dispose();
});

// LogSink: append 실패 시 최신 batchSize*4건만 되돌리고 다음 flush에서 복구
test("LogSink requeues failed batch keeping newest events and recovers", async () => {
  const store = {
    batches: [], calls: 0, reject: null,
    appendLogBatch(b) {
      this.calls++;
      if (this.calls === 1) return new Promise((_, rej) => { this.reject = rej; });
      this.batches.push(b); return Promise.resolve();
    },
    async pruneLogs() {},
  };
  const timers = fakeTimers(), bus = new EventBus();
  const sink = new LogSink(bus, store, { batchSize: 2, setTimer: timers.setTimer, clearTimer: timers.clearTimer });

  bus.emit({ stage: "s", msg: "e1" });
  bus.emit({ stage: "s", msg: "e2" }); // 첫 flush 진행 중 (보류)
  for (let i = 3; i <= 9; i++) bus.emit({ stage: "s", msg: "e" + i });
  store.reject(new Error("저장 실패"));
  await settle();
  // batchSize*4=8건만 남고 가장 오래된 e1은 버려진 채 다음 배치로 재전송
  assert.equal(store.calls, 2);
  assert.deepEqual(store.batches[0].map(e => e.msg), ["e2", "e3", "e4", "e5", "e6", "e7", "e8", "e9"]);

  bus.emit({ stage: "s", msg: "e10" });
  await sink.flush();
  assert.deepEqual(store.batches[1].map(e => e.msg), ["e10"]);
  await sink.dispose();
});

// LogSink: dispose는 구독 해제·타이머 해제·잔여 flush
test("LogSink dispose unsubscribes, clears timer, and flushes", async () => {
  const store = fakeStore(), timers = fakeTimers(), bus = new EventBus();
  const sink = new LogSink(bus, store, { batchSize: 10, setTimer: timers.setTimer, clearTimer: timers.clearTimer });
  bus.emit({ stage: "s", msg: "last" });
  assert.equal(timers.pending(), 1);
  await sink.dispose();
  assert.equal(timers.pending(), 0);
  assert.equal(store.batches.length, 1);
  assert.equal(store.batches[0][0].msg, "last");

  bus.emit({ stage: "s", msg: "after" }); // 구독 해제 후에는 수집 안 함
  timers.tick();
  assert.equal(store.batches.length, 1);
  await sink.dispose(); // 멱등
});

// LogSink: dispose는 진행 중 쓰기와 queued 후속 쓰기가 모두 끝날 때까지 기다린다
test("LogSink dispose waits for in-flight and queued writes", async () => {
  const releases = [];
  const store = {
    batches: [],
    appendLogBatch(b) { return new Promise(res => releases.push(() => { this.batches.push(b); res(); })); },
    async pruneLogs() {},
  };
  const timers = fakeTimers(), bus = new EventBus();
  const sink = new LogSink(bus, store, { batchSize: 2, setTimer: timers.setTimer, clearTimer: timers.clearTimer });

  bus.emit({ stage: "s", msg: "a" });
  bus.emit({ stage: "s", msg: "b" }); // 첫 쓰기 진행 중
  bus.emit({ stage: "s", msg: "c" }); // 버퍼에 남아 queued 후속 쓰기 대상

  let resolved = false;
  const disposing = sink.dispose().then(() => { resolved = true; });
  await settle();
  assert.equal(resolved, false); // 첫 쓰기가 보류 중이라 아직 안 끝남

  releases[0](); // 첫 쓰기 완료 → [c] 후속 쓰기 시작
  await settle();
  assert.equal(resolved, false); // 후속 쓰기도 보류 중
  assert.equal(releases.length, 2);

  releases[1]();
  await disposing;
  assert.equal(resolved, true);
  assert.deepEqual(store.batches.map(b => b.map(e => e.msg)), [["a", "b"], ["c"]]);
});

// LogSink: start는 pruneLogs를 한 번 호출하고 실패를 무시, this 반환
test("LogSink start prunes once, ignores errors, returns this", async () => {
  const store = fakeStore(), bus = new EventBus();
  const sink = new LogSink(bus, store, {});
  assert.equal(await sink.start(), sink);
  assert.equal(store.pruned, true);

  const failing = { async pruneLogs() { throw new Error("정리 실패"); }, async appendLogBatch() {} };
  await new LogSink(bus, failing, {}).start(); // 던지지 않는다
});
