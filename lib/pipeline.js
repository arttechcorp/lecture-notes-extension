// 파이프라인 v2 인프라: 작업 상태 기계·단계 캐시·스케줄러·재시도·회로 차단기 (docs/architecture-v2.md §7, §8).
// 단계 로직(정제·판정·계획·작성·검증·렌더)은 여기 없다. store·events·now·sleep·random은 전부 주입해 Node에서 그대로 테스트한다.
// offscreen 문서 전용이다. 서비스 워커(background.js)는 이 모듈 상태를 전역에 두지 않으며, 지속 상태는 jobs·packages 체크포인트가 전부다.
// events는 events.js의 safe()로 감싼 버스를 넣는다. 코드·수치만 싣고 강의 내용은 절대 싣지 않는다.
(() => {
  const STATES = Object.freeze(["created", "acquiring_source", "ingesting", "refining", "judging", "planning", "writing", "validating", "rendering", "done"]);
  const PAUSE_REASONS = Object.freeze(["auth", "quota", "user", "network"]);
  const SCHEMA = 1, END = new Set(["done", "failed", "cancelled"]), CODE_RE = /^[A-Z][A-Z0-9_]{0,63}$/;
  // ponytail: 전이는 한 칸씩만 허용한다. 해당 없는 단계(예: Free의 원격 수신)는 오케스트레이터가 빈 단계로 지나가며, 단계가 조용히 빠지는 버그를 막는 대신 체크포인트 쓰기가 몇 번 늘어난다.
  const NEXT = Object.fromEntries(STATES.slice(0, -1).map((s, i) => [s, STATES[i + 1]]));
  const NOOP_SPAN = { id: "", done() {}, fail() {}, skip() {} };
  const NOOP_EVENTS = { emit() {}, span: () => NOOP_SPAN };
  const abortErr = () => new DOMException("취소됨", "AbortError");
  const hex = buf => Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, "0")).join("");

  // 오류 코드 표(§8 `<영역>_<원인>`). retryable: withRetry가 자동 재시도해도 되는가. pause: runStages가 실패 대신 일시정지할 사유.
  // 백오프를 다 쓴 뒤의 *_UNAVAILABLE과 차단기의 *_CIRCUIT_OPEN은 영역별(STT·VIS·JDG·LLM)로 아래 루프에서 만든다.
  const CODES = {
    SRC_AUTH_EXPIRED: { retryable: false, pause: "auth", userMessage: "로그인 세션이 만료됐습니다. 강의 탭을 다시 열어 주세요." },
    SRC_PROTECTED: { retryable: false, userMessage: "보호된 영상이라 백그라운드로 처리할 수 없습니다. 실시간 모드로 진행할지 선택해 주세요." },
    SRC_DECODE_FAILED: { retryable: false, userMessage: "영상 일부 구간을 해석하지 못해 공백 구간으로 표시합니다." },
    NET_UNREACHABLE: { retryable: true, pause: "network", userMessage: "네트워크에 연결할 수 없거나 응답이 늦습니다. 연결을 확인한 뒤 이어서 진행해 주세요." },
    VIS_BAD_SCHEMA: { retryable: false, userMessage: "일부 슬라이드를 인식하지 못해 미인식으로 표시합니다." },
    LLM_TRUNCATED: { retryable: false, userMessage: "요약 응답이 중간에 잘려 섹션을 나눠 다시 요청합니다." },
    VAL_BLOCK_FAILED: { retryable: false, userMessage: "검증을 통과하지 못한 블록은 제외하고 부록에 표시합니다." },
    QUOTA_EXCEEDED: { retryable: false, pause: "quota", userMessage: "이번 달 사용 한도에 도달해 비용이 들기 전에 멈췄습니다." },
    CONSENT_REQUIRED: { retryable: false, pause: "user", userMessage: "백그라운드 처리에는 이용 동의가 필요합니다." },
    CONSENT_SUMMARY_REQUIRED: { retryable: false, pause: "user", userMessage: "요약을 만들려면 외부 요약 처리에 동의해야 합니다. 동의 전에는 인식 결과만 볼 수 있습니다." },
    MEM_BUDGET_EXCEEDED: { retryable: false, userMessage: "메모리 한도를 넘어 수신을 중단했습니다. 다른 탭을 닫고 다시 시도해 주세요." },
  };
  for (const [a, name] of Object.entries({ STT: "음성 인식", VIS: "화면 인식", JDG: "중요도 판정", LLM: "요약" })) {
    // 엔진을 조용히 바꾸지 않는다(불변식) — 안내 문구에도 명시한다.
    CODES[`${a}_UNAVAILABLE`] = { retryable: false, pause: "network", userMessage: `${name} 서비스가 응답하지 않습니다. 잠시 후 이어서 진행해 주세요. 다른 엔진으로 자동 전환하지 않습니다.` };
    CODES[`${a}_CIRCUIT_OPEN`] = { retryable: false, pause: "network", userMessage: `${name} 서비스 오류가 계속돼 잠시 호출을 멈췄습니다. 1분 뒤 이어서 진행해 주세요.` };
  }
  Object.freeze(CODES);

  // service-client가 던지는 오류 모양({code, retryable, retryAfterMs})과 같다.
  function pipelineError(code, extra) {
    const c = Object.hasOwn(CODES, code) ? CODES[code] : null;
    return Object.assign(new Error(c?.userMessage ?? code), { code, retryable: c?.retryable === true, retryAfterMs: null }, extra);
  }
  // fetch의 네트워크 실패만 본다(Chrome "Failed to fetch", Firefox "NetworkError…", Safari "Load failed", Node "fetch failed").
  // ponytail: 메시지로 구분하는 휴리스틱이다 — 코드 버그인 TypeError까지 재시도하지 않으려는 타협이며, 브라우저 문구가 바뀌면 여기만 고친다.
  const isNetworkError = e => e instanceof TypeError && /failed to fetch|fetch failed|network|load failed/i.test(e.message);
  const isRetryable = e => e?.retryable === true || isNetworkError(e);
  // 이벤트 code 필드는 대문자 코드만 받는다 — 서버 봉투 코드(소문자)는 대문자로 접어 영역 없이 싣는다.
  const evCode = e => {
    const c = String(e?.code ?? "").toUpperCase().replace(/\W/g, "_").slice(0, 64);
    return CODE_RE.test(c) ? c : isNetworkError(e) ? "NET_UNREACHABLE" : "UNKNOWN";
  };
  // 단계 오류 → 파이프라인 코드. 모르는 오류는 null(버그로 보고 삼키지 않는다). area는 백오프 소진 시 *_UNAVAILABLE의 영역.
  function codeOf(e, area = "LLM") {
    if (CODE_RE.test(e?.code)) return e.code;
    if (e?.code === "quota_exceeded") return "QUOTA_EXCEEDED";
    // AbortError가 여기까지 오면 사용자 취소가 아니라 서비스 클라이언트의 요청 타임아웃이다.
    if (isNetworkError(e) || e?.name === "AbortError") return "NET_UNREACHABLE";
    return e?.retryable === true && Object.hasOwn(CODES, `${area}_UNAVAILABLE`) ? `${area}_UNAVAILABLE` : null;
  }

  // ── 단계 결과 캐시(§8) ──
  // ponytail: JSON으로 표현되는 값만 해시한다(Map·Set·typed array 불가). 큰 바이너리는 호출자가 id·길이로 요약해 넣는다.
  const stable = v => JSON.stringify(v, (_, x) => x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(k => [k, x[k]])) : x) ?? "null";
  async function digest(value) {
    return hex(await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(stable(value))));
  }
  async function stageKey({ stage, inputDigest, model = null, promptVersion = null, schemaVersion = null } = {}) {
    // 비어 있으면 서로 다른 단계가 같은 키로 뭉친다 — 조용히 넘기지 않는다.
    if (typeof stage !== "string" || !stage || typeof inputDigest !== "string" || !inputDigest) throw new TypeError("단계 키에는 stage와 inputDigest가 필요합니다.");
    return digest([stage, inputDigest, model, promptVersion, schemaVersion]);
  }
  // 값은 packages 저장소에 `<packageId>:s:<키>`로 둔다(PackageStore id 규칙: 영숫자 시작, 128자 이하, ':' 허용).
  // 패키지 접두어가 있어야 패키지 삭제 때 단계 캐시도 함께 지울 수 있다. 키가 내용 해시라 작업이 달라도 같은 패키지에서 재사용된다.
  async function cached(store, key, compute, { packageId, signal } = {}) {
    if (signal?.aborted) throw abortErr();
    const id = `${packageId ? packageId + ":" : ""}s:${key}`;
    // 캐시는 손상(복호화 실패)을 미스로 본다 — 다시 계산해 덮어쓰면 그만이다.
    const hit = await store.getJson("packages", id).catch(() => null);
    if (hit && "value" in hit) return hit.value;
    const value = (await compute(signal)) ?? null;
    // 계산이 끝났으면 취소돼도 저장한다 — 돈을 쓴 결과라 다음 작업이 재사용한다. 쓰기 실패는 숨기지 않는다.
    await store.putJson("packages", id, { value });
    return value;
  }

  // ── 작업 상태 기계(§8) ──
  // 레코드는 상태·단계·끝난 단계 키·시각만 담는다. 강의 내용은 단계 캐시로 간다(불변식: 내용 없는 로그·체크포인트).
  function advance(r, to, { reason, code } = {}, ts) {
    const from = r.state;
    if (END.has(from)) throw new Error(`끝난 작업은 전이할 수 없습니다: ${from}`);
    if (to === "paused" && !PAUSE_REASONS.includes(reason)) throw new TypeError("일시정지 사유가 올바르지 않습니다.");
    if ((to === "failed" || (to === "paused" && code !== undefined)) && !CODE_RE.test(code)) throw new TypeError("오류 코드가 올바르지 않습니다.");
    const legal = to === "cancelled" || to === "failed" ? true
      : to === "paused" ? from !== "paused"
      : from === "paused" ? to === r.stage // 재개는 멈춘 단계로만
      : NEXT[from] === to;
    if (!legal) throw new Error(`불가능한 상태 전이입니다: ${from} → ${to}`);
    const { reason: _r, code: _c, ...rest } = r; // 모르는 필드는 그대로 보존한다
    const next = { ...rest, state: to, updatedAt: ts };
    if (STATES.includes(to)) next.stage = to;
    if (to === "paused") { next.reason = reason; if (code) next.code = code; }
    if (to === "failed") next.code = code;
    return next;
  }

  class Job {
    constructor(rec, { store, events, now }) { Object.assign(this, { rec, store, events: events ?? NOOP_EVENTS, now, tail: Promise.resolve() }); }
    get jobId() { return this.rec.jobId; }
    get packageId() { return this.rec.packageId; }
    get state() { return this.rec.state; }
    get stage() { return this.rec.stage; }
    get record() { return structuredClone(this.rec); }
    // 쓰기를 한 줄로 세운다: 취소가 단계 전이와 겹쳐도 서로 낡은 상태로 판단하지 않는다. 쓰기가 성공해야 메모리 상태가 바뀐다.
    _commit(fn) {
      const run = this.tail.then(async () => {
        const next = fn(this.rec);
        await this.store.putJson("jobs", next.jobId, next, { schemaVersion: SCHEMA });
        return this.rec = next;
      });
      this.tail = run.catch(() => {});
      return run;
    }
    async transition(to, opts = {}) {
      let from;
      const next = await this._commit(r => (from = r.state, advance(r, to, opts, this.now())));
      this.events.emit({
        jobId: next.jobId, stage: "job", msg: `${from}>${to}` + (opts.reason ? ":" + opts.reason : ""),
        level: to === "failed" ? "error" : to === "paused" ? "warn" : "info", ...(next.code && { code: next.code }),
      });
      return to;
    }
    resume() { return this.transition(this.rec.stage); }
    async complete(stage, key) { await this._commit(r => ({ ...r, completed: { ...r.completed, [stage]: key }, updatedAt: this.now() })); }
  }

  async function createJob({ jobId, packageId = jobId, store, events, now = Date.now } = {}) {
    if (typeof store?.putJson !== "function") throw new TypeError("저장소가 필요합니다.");
    // 같은 id로 다시 만들면 재개할 수 있던 체크포인트를 덮어쓴다.
    if (await store.getJson("jobs", jobId)) throw new Error("이미 있는 작업 번호입니다.");
    const t = now();
    const job = new Job({ schemaVersion: SCHEMA, jobId, packageId, state: "created", stage: "created", completed: {}, createdAt: t, updatedAt: t }, { store, events, now });
    await job._commit(r => r);
    job.events.emit({ jobId, stage: "job", msg: "created" });
    return job;
  }

  // ponytail: 마이그레이션은 schemaVersion 2가 생길 때 여기에 둔다. 지금은 모르는 필드를 보존만 한다(전이가 ...rec로 다시 쓴다).
  // 재시작 뒤 어떤 작업이 있는지는 store.ids("jobs")로 찾는다 — chrome.storage에는 작업 id를 두지 않는다.
  async function loadJob(jobId, store, { events, now = Date.now } = {}) {
    const rec = await store.getJson("jobs", jobId);
    if (rec == null) return null;
    if (rec.jobId !== jobId || ![...STATES, "paused", "failed", "cancelled"].includes(rec.state)) throw new Error("작업 기록이 올바르지 않습니다.");
    return new Job({ completed: {}, ...rec }, { store, events, now });
  }

  // 순서 있는 [{state, name?, area?, key(ctx)→{inputDigest, model, promptVersion, schemaVersion}, run(ctx)}]를 전이·캐시·체크포인트와 함께 돌린다.
  // ctx({signal, ...})에는 단계별 출력이 ctx.out[name]으로 쌓이고 ctx.job이 채워진다. 단계는 앞 단계 출력을 ctx.out에서 읽는다.
  // 멈춘 작업은 호출자가 resume()한 뒤 다시 부르면 된다: 끝난 단계는 캐시에서 값만 복원하고 멈춘 단계부터 이어서 계산한다.
  // 반환: 완료·일시정지·실패한 job(상태는 job.state). 취소는 AbortError를 던지며, 예상 밖 오류(버그)도 삼키지 않고 던진다.
  async function runStages(job, stages, ctx = {}) {
    if (job.state === "paused") throw new Error("일시정지된 작업은 resume() 뒤에 실행하세요.");
    const c = Object.assign(ctx, { out: ctx.out ?? {}, job }), { signal } = c;
    let span = null, area;
    try {
      if (END.has(job.state)) return job;
      for (const st of stages) {
        if (signal?.aborted) throw abortErr();
        if (!STATES.includes(st.state)) throw new TypeError("알 수 없는 단계 상태입니다.");
        // 이미 지난 단계(재개)는 전이 없이 캐시에서 값만 복원한다. 캐시에 없으면 다시 계산하므로 멱등이다.
        if (STATES.indexOf(st.state) > STATES.indexOf(job.stage)) await job.transition(st.state);
        const name = st.name ?? st.state;
        area = st.area;
        span = job.events.span({ jobId: job.jobId, stage: name });
        const key = await stageKey({ stage: name, ...await st.key(c) });
        let hit = true;
        c.out[name] = await cached(job.store, key, () => (hit = false, st.run(c)), { packageId: job.packageId, signal });
        await job.complete(name, key);
        if (hit) span.skip({ msg: "cache" }); else span.done();
      }
      if (job.state === "rendering") await job.transition("done");
      return job;
    } catch (e) {
      if (signal?.aborted) {
        span?.skip({ msg: "aborted" });
        if (!END.has(job.state)) await job.transition("cancelled");
        throw e?.name === "AbortError" ? e : abortErr();
      }
      const code = codeOf(e, area);
      span?.fail(code ?? evCode(e));
      if (!code) throw e; // 체크포인트는 마지막 정상 상태에 남는다
      const reason = Object.hasOwn(CODES, code) ? CODES[code].pause : undefined;
      await (reason ? job.transition("paused", { reason, code }) : job.transition("failed", { code }));
      return job;
    }
  }

  // ── 스케줄러(§7) ──
  // 기본 병렬도는 §7 표. 원격 설정(서버)이 이름별로 덮어쓴다.
  const LANES = Object.freeze({ recv: 4, decode: 2, stt: 4, vision: 8, judge: 2, plan: 1, write: 8 });
  const MAX_LANES = 16; // ponytail: 원격 설정 오류가 메모리·공급자 한도를 터뜨리지 않게 하는 상한. 더 필요하면 상수를 올린다.
  const laneCount = (name, remote) => {
    const n = Math.floor(remote?.[name]);
    return n >= 1 ? Math.min(n, MAX_LANES) : LANES[name] ?? 1;
  };

  // 상한 있는 비동기 큐. put은 가득 차면 기다린다(백프레셔) → 비전 대기열이 쌓이면 수신이 멈춘다.
  // close()는 더 못 넣게 하고 남은 항목은 비울 때까지 take할 수 있다. abort()/signal은 모두 즉시 거절하고 비운다.
  // ponytail: 대기자 목록은 배열 shift()라 O(n)이다. 대기자는 레인 수(≤16) 안팎이라 충분하다.
  function createQueue({ capacity = 1, signal } = {}) {
    if (!(capacity >= 1)) throw new RangeError("큐 용량이 올바르지 않습니다.");
    const buf = [], takers = [], putters = [];
    let closed = false, dead = null;
    // 호출별 signal이 울리면 대기자는 목록에서 빠져야 한다. 죽은 대기자가 다음 항목을 삼키면 안 된다.
    const park = (list, w, sig) => new Promise((resolve, reject) => {
      if (sig?.aborted) return reject(abortErr());
      const onAbort = () => { const i = list.indexOf(w); if (i >= 0) { list.splice(i, 1); reject(abortErr()); } };
      sig?.addEventListener("abort", onAbort, { once: true });
      Object.assign(w, { resolve, reject, off: () => sig?.removeEventListener("abort", onAbort) });
      list.push(w);
    });
    const kill = () => {
      dead ??= abortErr(); buf.length = 0;
      for (const w of [...takers.splice(0), ...putters.splice(0)]) { w.off(); w.reject(dead); }
    };
    if (signal?.aborted) kill(); else signal?.addEventListener("abort", kill, { once: true });
    return {
      capacity,
      get size() { return buf.length; },
      async put(item, { signal: sig } = {}) {
        if (dead) throw dead;
        if (closed) throw new Error("닫힌 큐에는 넣을 수 없습니다.");
        if (sig?.aborted) throw abortErr();
        const t = takers.shift();
        if (t) { t.off(); t.resolve({ done: false, value: item }); return; }
        if (buf.length < capacity) { buf.push(item); return; }
        await park(putters, { item }, sig);
      },
      async take({ signal: sig } = {}) {
        if (dead) throw dead;
        if (sig?.aborted) throw abortErr();
        if (buf.length) {
          const value = buf.shift(), p = putters.shift();
          if (p) { p.off(); buf.push(p.item); p.resolve(); } // 자리가 나면 대기 중인 put을 순서대로 들인다
          return { done: false, value };
        }
        return closed ? { done: true } : park(takers, {}, sig);
      },
      close() {
        if (closed || dead) return;
        closed = true;
        for (const w of takers.splice(0)) { w.off(); w.resolve({ done: true }); }
        for (const w of putters.splice(0)) { w.off(); w.reject(new Error("큐가 닫혔습니다.")); }
      },
      abort: kill,
    };
  }

  // 레인 수만큼만 동시에 돌리고 항목별 결과를 돌려준다: 끝난 항목은 다른 항목이 실패해도 남는다(transcribeChunks와 같은 계약).
  // 결과: {status:"ok", value} | {status:"failed", error} | {status:"skipped"}. 취소하면 시작 못 한 항목과 취소로 멈춘 항목은 skipped다.
  // worker(item, index, signal)는 signal을 지켜야 한다 — 풀은 진행 중 worker가 끝나길 기다린다(고아 작업을 남기지 않기 위해).
  // stopOnFail이면 첫 실패 뒤 새 항목을 시작하지 않는다. 기본은 독립 항목이라 계속 간다.
  async function pool(items, worker, { lanes = 1, signal, stopOnFail = false, events = NOOP_EVENTS, stage = "pool" } = {}) {
    if (!Array.isArray(items) || typeof worker !== "function") throw new TypeError("pool 인자가 올바르지 않습니다.");
    const out = items.map(() => ({ status: "skipped" })); // 시작하지 못한 항목의 기본 결과
    let next = 0, stop = false;
    const lane = async () => {
      while (!stop && !signal?.aborted) {
        const i = next++;
        if (i >= items.length) return;
        const span = events.span({ stage, unit: String(i) });
        try {
          out[i] = { status: "ok", value: await worker(items[i], i, signal) };
          span.done();
        } catch (error) {
          if (signal?.aborted) { span.skip({ msg: "aborted" }); continue; } // 취소로 멈춘 항목은 실패가 아니다
          out[i] = { status: "failed", error };
          span.fail(evCode(error));
          if (stopOnFail) stop = true;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(Math.max(1, Math.floor(lanes) || 1), items.length) }, lane));
    for (let i = Math.min(next, items.length); i < items.length; i++) events.emit({ stage, unit: String(i), status: "skipped" });
    return out;
  }

  // ── 재시도와 회로 차단기(§8) ──
  // 재시도마다 새 requestId를 쓴다(stt-client.transcribeChunks와 같은 규칙): 서버는 같은 requestId를 409
  // request_already_reserved_or_processed로 거절한다. 제공자 호출이 나간 뒤 실패(5xx·타임아웃)하면 예약이 uncertain으로 남아
  // 같은 id를 계속 막고, 환불되는 실패(제공자 HTTP 오류·큐 타임아웃)는 예약을 지워 같은 id가 통과하지만 클라이언트는 어느 쪽인지 모른다.
  // 그래서 항상 base, base-r1, base-r2…로 보낸다. (§8 본문의 "같은 requestId"는 서버 구현과 어긋나 이 규칙이 우선한다.)
  const retryId = (base, attempt) => attempt ? `${base}-r${attempt}` : base;
  // stt-client의 defaultSleep과 같다. 취소하면 타이머를 걷고 즉시 거절한다.
  const defaultSleep = (ms, signal) => new Promise((resolve, reject) => {
    const onAbort = () => { clearTimeout(t); reject(abortErr()); };
    const t = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
  });
  const MAX_RETRY_AFTER_MS = 60000; // ponytail: 서버가 준 대기 시간의 상한. 이보다 길면 일찍 재시도해 한 번 더 거절당할 수 있다.

  // 네트워크 오류와 retryable:true 오류만 재시도한다. 대기는 max(1000·2^n ±20% 지터, retryAfterMs).
  // AbortError는 재시도하지 않는다 — 사용자 취소와 서비스 클라이언트의 요청 타임아웃을 구분할 수 없고, 타임아웃 뒤 재호출은 중복 비용을 부른다.
  async function withRetry(fn, { retries = 3, baseMs = 1000, jitter = 0.2, signal, sleep = defaultSleep, random = Math.random } = {}) {
    if (signal?.aborted) throw abortErr();
    for (let attempt = 0; ; attempt++) {
      try { return await fn(attempt); }
      catch (e) {
        if (signal?.aborted || e?.name === "AbortError") throw e?.name === "AbortError" ? e : abortErr();
        if (attempt >= retries || !isRetryable(e)) throw e;
        const backoff = baseMs * 2 ** attempt * (1 - jitter + 2 * jitter * random());
        await sleep(Math.max(backoff, Math.min(Number(e.retryAfterMs) || 0, MAX_RETRY_AFTER_MS)), signal);
      }
    }
  }

  // 키(공급자/경로)별 차단기: 연속 5회 실패하면 60초 동안 네트워크 없이 즉시 실패하고, 이후 시험 호출 1건으로 복구를 확인한다(반열림).
  // 제공자 건강 신호만 센다: 네트워크 오류·retryable 오류는 실패, 400·한도 같은 정상 거절은 제공자가 살아 있다는 뜻이라 연속 실패를 끊는다. 취소는 세지 않는다.
  // withRetry 안쪽(시도마다)에 두면 열린 차단기의 오류(retryable:false)가 재시도 루프를 바로 끝낸다:
  //   withRetry(n => breaker.run("stt", () => service.stt({ requestId: retryId(base, n) }), { area: "STT" }))
  // ponytail: 상태는 offscreen 메모리에만 있다. 재시작하면 닫힌 상태로 시작하고 몇 번 더 실패하면 다시 열린다.
  function createBreaker({ failures = 5, openMs = 60000, now = Date.now } = {}) {
    const keys = new Map(); // 키 → {n 연속 실패, at 연 시각, probe 시험 호출 중}
    const get = k => keys.get(k) ?? keys.set(k, { n: 0, at: null, probe: false }).get(k);
    const state = k => { const s = get(k); return s.at === null ? "closed" : now() - s.at < openMs ? "open" : "half-open"; };
    async function run(key, fn, { area = "LLM" } = {}) {
      const s = get(key), mode = state(key);
      if (mode === "open" || (mode === "half-open" && s.probe)) throw pipelineError(`${area}_CIRCUIT_OPEN`, { retryAfterMs: Math.max(0, s.at + openMs - now()) });
      if (mode === "half-open") s.probe = true;
      try {
        const v = await fn();
        s.n = 0; s.at = null;
        return v;
      } catch (e) {
        if (e?.name === "AbortError") { /* 취소는 제공자 건강과 무관하다 */ }
        else if (isRetryable(e)) { s.n++; if (mode === "half-open" || s.n >= failures) s.at = now(); }
        else { s.n = 0; s.at = null; }
        throw e;
      } finally { if (mode === "half-open") s.probe = false; }
    }
    return { run, state };
  }

  const api = { STATES, PAUSE_REASONS, LANES, CODES, createJob, loadJob, runStages, digest, stageKey, cached, createQueue, pool, laneCount, withRetry, retryId, createBreaker, pipelineError, codeOf };
  globalThis.Pipeline = api;
  if (typeof module !== "undefined") module.exports = api;
})();
