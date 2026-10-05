// 파이프라인 전체의 단일 진단 이벤트 스트림. 개발용 관리 페이지·암호화 로컬 로그·진행 UI가 함께 구독한다.
// 강의 내용(전사·슬라이드 텍스트)은 절대 싣지 않는다 — msg는 짧은 진단 메시지 전용이라 길이를 잘라도 예외를 던지지 않는다.
(() => {
  const FIELDS = Object.freeze(["ts","jobId","traceId","spanId","parentSpanId","requestId","stage","unit","status","ms","bytes","model","costUsd","code","level","msg"]);
  const STATUSES = Object.freeze(["queued","running","done","failed","skipped"]);
  const LEVELS = Object.freeze(["debug","info","warn","error"]);
  const FIELD_SET = new Set(FIELDS), LEVEL_RANK = { debug: 0, info: 1, warn: 2, error: 3 };
  const STAGE_RE = /^[a-z][a-z0-9_.-]*$/, CODE_RE = /^[A-Z][A-Z0-9_]{0,63}$/;
  const sysCrypto = () => globalThis.crypto?.getRandomValues ? globalThis.crypto : require("node:crypto").webcrypto;
  const randomId = () => Array.from(sysCrypto().getRandomValues(new Uint8Array(8)), b => b.toString(16).padStart(2, "0")).join("");
  const bad = name => { throw new TypeError(`invalid event field: ${name}`); };

  function normalize(event, now = Date.now) {
    // "객체 아님" 표식은 undefined — Object.create(null)의 프로토타입 null과 충돌하면 안 된다.
    const proto = event !== null && typeof event === "object" && !Array.isArray(event) ? Object.getPrototypeOf(event) : undefined;
    if (proto !== Object.prototype && proto !== null) throw new TypeError("event must be a plain object");
    for (const key of Object.keys(event)) if (!FIELD_SET.has(key)) throw new TypeError(`unknown event field: ${key}`);
    const str = (name, max) => {
      const v = event[name];
      if (v === undefined) return undefined;
      if (typeof v !== "string" || v.length > max) bad(name);
      return v;
    };
    const num = name => {
      const v = event[name];
      if (v === undefined) return undefined;
      if (!Number.isFinite(v) || v < 0) bad(name);
      return v;
    };
    const stage = event.stage;
    if (typeof stage !== "string" || stage.length > 32 || !STAGE_RE.test(stage)) bad("stage");
    const ts = event.ts === undefined ? now() : event.ts;
    if (!Number.isFinite(ts)) bad("ts");
    const status = str("status", 32);
    if (status !== undefined && !STATUSES.includes(status)) bad("status");
    const level = event.level === undefined ? "info" : event.level;
    if (!LEVELS.includes(level)) bad("level");
    const code = str("code", 64);
    if (code !== undefined && !CODE_RE.test(code)) bad("code");
    let msg = event.msg;
    if (msg !== undefined) {
      if (typeof msg !== "string") bad("msg");
      msg = msg.replace(/\s+/g, " ").trim().slice(0, 200);
    }
    const out = { ts };
    for (const key of ["jobId", "traceId", "spanId", "parentSpanId", "requestId"]) { const v = str(key, 128); if (v !== undefined) out[key] = v; }
    out.stage = stage;
    const unit = str("unit", 64); if (unit !== undefined) out.unit = unit;
    if (status !== undefined) out.status = status;
    for (const key of ["ms", "bytes"]) { const v = num(key); if (v !== undefined) out[key] = v; }
    const model = str("model", 128); if (model !== undefined) out.model = model;
    const costUsd = num("costUsd"); if (costUsd !== undefined) out.costUsd = costUsd;
    if (code !== undefined) out.code = code;
    out.level = level;
    if (msg !== undefined) out.msg = msg;
    return Object.freeze(out);
  }

  class EventBus {
    constructor({ limit = 2000, now = () => Date.now(), id = randomId } = {}) {
      this.limit = limit; this.now = now; this.id = id;
      this.events = []; this.listeners = new Set();
    }
    emit(event) {
      const e = normalize(event, this.now);
      this.events.push(e);
      if (this.events.length > this.limit) this.events.splice(0, this.events.length - this.limit);
      // 진단 버스가 파이프라인을 죽이면 안 된다 — 리스너 예외는 격리한다.
      for (const fn of [...this.listeners]) { try { fn(e); } catch {} }
      return e;
    }
    on(listener) {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    }
    recent(n = this.limit) {
      return n <= 0 ? [] : this.events.slice(-n);
    }
    span(fields) {
      const spanId = this.id(), start = this.now(), base = { ...fields, spanId };
      this.emit({ ...base, status: "running" });
      // 종료 이벤트는 식별 필드를 그대로 물려받는다 — extra가 덮어쓰지 못하게 뒤에 둔다.
      const idem = { stage: base.stage, jobId: base.jobId, traceId: base.traceId, parentSpanId: base.parentSpanId, unit: base.unit, spanId };
      let closed = false;
      const finish = (status, extra) => {
        if (closed) return;
        closed = true;
        // 시계가 역행하면 음수 ms로 normalize가 던져 파이프라인 호출자가 깨진다 — 0으로 클램프.
        this.emit({ ...extra, ...idem, status, ms: Math.max(0, this.now() - start) });
      };
      return {
        id: spanId,
        done: (extra = {}) => finish("done", extra),
        fail: (code, extra = {}) => finish("failed", { ...extra, code, level: "error" }),
        skip: (extra = {}) => finish("skipped", extra),
      };
    }
  }

  class LogSink {
    constructor(bus, store, { batchSize = 50, intervalMs = 5000, minLevel = "info", setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
      this.store = store; this.batchSize = batchSize; this.intervalMs = intervalMs;
      this.min = LEVEL_RANK[minLevel] ?? LEVEL_RANK.info;
      this.setTimer = setTimer; this.clearTimer = clearTimer;
      this.buffer = []; this.timer = null; this.flushing = false; this.queued = false; this.disposed = false;
      this.idle = Promise.resolve();
      this.off = bus.on(e => this.push(e));
    }
    push(e) {
      if (this.disposed || LEVEL_RANK[e.level] < this.min) return;
      this.buffer.push(e);
      if (this.buffer.length >= this.batchSize) void this.flush();
      else this.arm();
    }
    arm() {
      if (this.timer == null && !this.disposed) this.timer = this.setTimer(() => { this.timer = null; void this.flush(); }, this.intervalMs);
    }
    async start() {
      try { await this.store.pruneLogs(); } catch {}
      return this;
    }
    async flush() {
      if (this.timer != null) { this.clearTimer(this.timer); this.timer = null; }
      // 진행 중 flush와 겹치면 배치 순서가 뒤집힐 수 있어 queued로 넘기고, 기다리는 호출자는 후속 쓰기까지 끝나는 idle을 받는다.
      if (this.flushing) { this.queued = true; return this.idle; }
      const batch = this.buffer;
      if (!batch.length) return;
      this.buffer = []; this.flushing = true;
      let done; this.idle = new Promise(r => { done = r; });
      try { await this.store.appendLogBatch(batch); }
      catch {
        // 실패한 배치는 되돌리되 무한 재시도 누적으로 메모리가 부풀지 않게 최신 batchSize*4건만 남긴다.
        this.buffer = batch.concat(this.buffer).slice(-this.batchSize * 4);
        this.arm();
      } finally {
        this.flushing = false;
        // 대기 중이던 이벤트의 후속 쓰기까지 끝나야 await한 쪽(dispose 등)이 안전하게 반환된다.
        if (this.queued) { this.queued = false; await this.flush(); }
        done();
      }
    }
    async dispose() {
      if (this.disposed) return;
      this.disposed = true;
      this.off?.(); this.off = null;
      if (this.timer != null) { this.clearTimer(this.timer); this.timer = null; }
      await this.flush();
    }
  }

  // 진단 이벤트의 검증 오류가 본 파이프라인(캡처·OCR·ASR)을 죽이면 안 된다 — 파이프라인 쪽 호출자는 버스를 이 껍데기로 감싸 쓴다.
  const NOOP_SPAN = Object.freeze({ id: "", done() {}, fail() {}, skip() {} });
  function safe(bus) {
    const quiet = fn => (...args) => { try { return fn(...args); } catch { return undefined; } };
    return {
      emit: quiet(e => bus.emit(e)),
      span(fields) {
        let s;
        try { s = bus.span(fields); } catch { return NOOP_SPAN; }
        return { id: s.id, done: quiet(s.done), fail: quiet(s.fail), skip: quiet(s.skip) };
      },
    };
  }

  const api = { FIELDS, STATUSES, LEVELS, normalize, EventBus, LogSink, safe };
  globalThis.PipelineEvents = api;
  if (typeof module !== "undefined") module.exports = api;
})();
