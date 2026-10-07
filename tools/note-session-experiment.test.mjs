// note-session-experiment.mjs 의 합성 자가 테스트 — 네트워크 없이 mock post 로 runNote 를 끝까지 돌린다.
// fixture(tools/note-fixture/*)의 골든 출력을 canned 응답으로 쓰고, 세션 봉투의 스레딩·직렬화·
// 상한·오류 경로와 내용 없는 메트릭 출력을 검증한다. 실제 서비스·제공자는 부르지 않는다.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const plannerOutput = require("../tools/note-fixture/planner-output.json");
const writer = require("../tools/note-fixture/writer-outputs.json");
const expected = require("../tools/note-fixture/expected-note.json");

const {
  MODES, SESSION_MODES, FORK_MODES, V2_MODES, SOL, LUNA_HIGH, ANCHOR_TEXT,
  HISTORY_MAX_ITEMS, HISTORY_MAX_BYTES,
  Budget, newSession, applySessionReply, planBody, writeBody, judgeBody,
  makeService, makePost, loadInput, normalizePlan, learningCoverage, noteMetrics,
  kvPairs, memStore, runArm, planArms, estCostUsd, preflightV2Server, toSpec11ResultRow,
} = await import("./note-session-experiment.mjs");

const loaded = loadInput("tools/note-fixture/input.json");

// 서비스 API 봉투를 흉내 내는 mock — plan/write 응답에 noteSession 을 되돌린다.
// sol-fork/sol-fork-2/sol-luna-2: 계획 응답이 고정 접두 P 를 구성하고 anchor item 을 포함한다.
function fakePost({ sessionSupport = true, mutate = ns => ({ v: 1, id: ns.id, mode: ns.mode, history: [...ns.history, { type: "message" }] }), sessionError = null, writeDelayMs = 0 } = {}) {
  const calls = [], writeTimes = [];
  let writesInflight = 0, maxWritesInflight = 0, seq = 0;
  const post = async (route, body) => {
    calls.push({ route, body });
    const isWrite = route === "/v1/write";
    let wr = null;
    if (isWrite) { wr = { start: seq++ }; writeTimes.push(wr); writesInflight++; maxWritesInflight = Math.max(maxWritesInflight, writesInflight); }
    try {
      if (isWrite && writeDelayMs) await new Promise(r => setTimeout(r, writeDelayMs));
      const base = { usage: { promptTokens: 500, completionTokens: 200, costUsd: 0.005 }, promptVersion: "note-v6", schemaVersion: 1 };
      const mode = body.noteSession?.mode;
      if (isWrite && (mode === "sol-fork" || mode === "sol-fork-2")) base.usage.cachedInputTokens = 420;

      let payload;
      if (route === "/v1/plan") {
        payload = { ...base, plan: plannerOutput };
        if (body.noteSession && V2_MODES.has(body.noteSession.mode)) {
          payload.editorialPlan = { v: 1, glossary: [{ conceptId: "C1", preferredTerm: "고정비", aliases: [], evidenceIds: ["U1.s1"] }],
            sections: plannerOutput.sections.map(sec => ({ sectionId: sec.sectionId, learningQuestion: null, learningItemIds: [], prerequisiteSectionIds: [], mustExplain: [], owns: [], referencesOnly: [], visuals: [], targetOutputTokens: 1200 })) };
        }
      } else if (route === "/v1/judge") {
        payload = { ...base, results: body.items.map(i => ({ itemId: i.itemId, task: body.task, probs: [{ label: "A", p: .9 }, { label: "B", p: .1 }], score: .9, confidence: .8, model: body.model })) };
      } else if (isWrite) {
        const sec = body.section?.sectionId;
        if (body.stage === "section") {
          payload = { ...base, output: writer.sections[sec]?.first };
        } else if (body.stage === "draft") {
          payload = { ...base, output: writer.sections[sec]?.first || { claims: [], relations: [] } };
        } else if (body.stage === "review") {
          payload = { ...base, output: { edits: [], unresolved: [] } };
        } else if (body.stage === "questions") {
          payload = { ...base, output: { blocks: {} } };
        } else if (body.stage === "repair") {
          payload = { ...base, output: { blocks: Object.fromEntries((body.repair || []).map(r => [r.blockId, writer.sections[sec]?.repair?.blocks[r.blockId] ?? null])) } };
        } else if (body.stage === "global") {
          payload = { ...base, output: writer.global };
        } else {
          throw Object.assign(new Error("bad stage"), { code: "invalid_model_or_stage" });
        }
      } else {
        throw new Error("bad route " + route);
      }

      if (body.noteSession) {
        if (!sessionSupport) return payload;
        if (sessionError) throw sessionError;
        const isFork = FORK_MODES.has(body.noteSession.mode);
        payload.noteSession = isFork
          ? {
              v: 1, id: body.noteSession.id, mode: body.noteSession.mode,
              history: body.noteSession.history.length
                ? body.noteSession.history
                : [{ type: "task" }, { type: "message" }, { role: "user", content: [{ type: "input_text", text: ANCHOR_TEXT, prompt_cache_breakpoint: { mode: "explicit" } }] }],
            }
          : mutate(body.noteSession);
      }
      return payload;
    } finally { if (isWrite) { writesInflight--; wr.end = seq++; } }
  };
  return { post, calls, writeTimes, maxWritesInflight: () => maxWritesInflight };
}

const arm = (mode, opts = {}, cfg = {}) => runArm({ mode, loaded, cfg: { jobId: `t-${mode}-${Math.random().toString(36).slice(2, 8)}`, judge: "typesafe/jev-1.13", run: 0, ...cfg }, ...opts });
const planWriteBodies = calls => calls.filter(c => c.route !== "/v1/judge").map(c => c.body);

// 1. sol-session 종단
test("sol-session: noteSession envelope on every plan/write, history threaded, writes serialized", async () => {
  const { post, calls, maxWritesInflight } = fakePost();
  const res = await arm("sol-session", { post, budget: new Budget({ maxCostUsd: 3, maxRequests: 400 }) });
  assert.equal(res.status, "partial", JSON.stringify(res.code));
  const bodies = planWriteBodies(calls);
  assert.ok(bodies.length >= 7, "plan + 5 sections + repairs + global");
  const ids = new Set(bodies.map(b => b.noteSession?.id));
  assert.equal(ids.size, 1, "세션 id 는 군 안에서 하나다");
  assert.ok([...bodies].every(b => b.noteSession?.v === 1 && b.noteSession.mode === "sol-session" && Array.isArray(b.noteSession.history)));
  assert.deepEqual(bodies.map(b => b.noteSession.history.length), bodies.map((_, i) => i));
  assert.equal(res.session.finalHistoryItems, bodies.length);
  assert.ok(bodies.every(b => b.model === SOL), "sol-session 은 plan/write 모두 Sol");
  assert.ok(calls.filter(c => c.route === "/v1/judge").every(c => !("noteSession" in c.body)));
  assert.equal(maxWritesInflight(), 1, "세션 모드는 write 호출이 직렬이다");
  assert.ok(res.note.questions.items > 0 && res.note.questions.refs.dead === 0);
  assert.equal(res.note.withheld.droppedBlocks, 1);
});

// 2. independent 기준군
test("independent: no noteSession, Sol plan + Luna High write", async () => {
  const { post, calls } = fakePost({ sessionSupport: false });
  const res = await arm("independent", { post, budget: new Budget({ maxCostUsd: 3, maxRequests: 400 }) });
  assert.equal(res.status, "partial");
  assert.equal(res.session, null);
  const bodies = planWriteBodies(calls);
  assert.ok(bodies.every(b => !("noteSession" in b)), "독립 호출에는 세션 봉투가 없다");
  assert.equal(bodies[0].model, SOL);
  assert.ok(bodies.slice(1).every(b => b.model === LUNA_HIGH), "작성은 Luna High");
});

// 3. sol-luna-tool
test("sol-luna-tool: envelope mode sol-luna-tool, Sol on the wire", async () => {
  const { post, calls } = fakePost();
  const res = await arm("sol-luna-tool", { post, budget: new Budget({ maxCostUsd: 3, maxRequests: 400 }) });
  assert.equal(res.status, "partial");
  const bodies = planWriteBodies(calls);
  assert.ok(bodies.every(b => b.noteSession?.mode === "sol-luna-tool" && b.model === SOL));
  assert.equal(res.session.mode, "sol-luna-tool");
});

// 3b. sol-fork
test("sol-fork: every write sends the identical plan prefix; writes overlap after the first warms the cache", async () => {
  const { post, calls, writeTimes, maxWritesInflight } = fakePost({ writeDelayMs: 10 });
  const res = await arm("sol-fork", { post, budget: new Budget({ maxCostUsd: 3, maxRequests: 400 }) });
  assert.equal(res.status, "partial", JSON.stringify(res.code));
  const plan = calls.find(c => c.route === "/v1/plan");
  assert.deepEqual(plan.body.noteSession.history, [], "계획은 빈 history 로 세션을 연다");
  const writes = calls.filter(c => c.route === "/v1/write");
  assert.ok(writes.length >= 7, `섹션·재작성·전역 모두 세션 호출 (${writes.length})`);
  const P = writes[0].body.noteSession.history;
  assert.ok(P.length > 0, "계획 응답이 접두를 만든다");
  for (const c of writes) {
    assert.equal(c.body.noteSession.mode, "sol-fork");
    assert.equal(c.body.noteSession.id, plan.body.noteSession.id);
    assert.deepEqual(c.body.noteSession.history, P, `${c.body.stage} 도 바이트 동일한 접두만 싣는다`);
  }
  assert.ok(writes.every(b => b.body.model === SOL), "fork 도 plan/write 모두 Sol");
  assert.equal(res.session.mode, "sol-fork");
  assert.equal(res.session.prefixItems, P.length);
  assert.equal(res.session.finalHistoryItems, P.length, "자란 history 가 없다");
  assert.deepEqual(res.session.writeCacheReadTokens, writes.map(() => 420), "쓰기 호출별 캐시 읽기 토큰이 보고된다");
  assert.ok(maxWritesInflight() >= 2, "fork 쓰기는 병렬 — 직렬화된 연쇄 세션과 다르다");
  assert.ok(writeTimes[0].end < writeTimes[1].start, "첫 쓰기 호출이 끝나야 나머지가 나간다(웜업 게이트)");
  assert.ok(calls.filter(c => c.route === "/v1/judge").every(c => !("noteSession" in c.body)));
});

// 3c. sol-luna-2: Sol 계획 → Luna draft(독립) → Sol review(P) → Luna questions(독립) → Sol 전역/복구(P)
test("sol-luna-2: stage->model table and noteSession selective attachment", async () => {
  const { post, calls } = fakePost();
  const res = await arm("sol-luna-2", { post, budget: new Budget({ maxCostUsd: 3, maxRequests: 400 }) });
  assert.equal(res.session.mode, "sol-luna-2");
  assert.ok(res.session.prefixItems > 0, "Sol 계획이 고정 접두 P 를 형성함");
  assert.ok(res.editorialPlan !== null, "editorialPlan 이 메모리에 캡처됨");

  const planCall = calls.find(c => c.route === "/v1/plan");
  assert.equal(planCall.body.model, SOL, "계획은 Sol");
  assert.ok(planCall.body.noteSession !== undefined, "계획은 세션 봉투 포함");

  // draft 및 questions 호출은 Luna High 독립 호출(noteSession 없음)
  const lunaCalls = calls.filter(c => c.route === "/v1/write" && (c.body.stage === "draft" || c.body.stage === "questions"));
  for (const c of lunaCalls) {
    assert.equal(c.body.model, LUNA_HIGH, "draft 및 questions 는 Luna High");
    assert.equal(c.body.noteSession, undefined, "Luna 호출에는 noteSession 봉투가 절대 들어가지 않음");
  }

  // review, global, repair 호출은 Sol(noteSession 고정 접두 P 포함)
  const solWriteCalls = calls.filter(c => c.route === "/v1/write" && ["review", "global", "repair"].includes(c.body.stage));
  for (const c of solWriteCalls) {
    assert.equal(c.body.model, SOL, "review, global, repair 는 Sol");
    assert.ok(c.body.noteSession !== undefined, "Sol 단계는 noteSession 포함");
    assert.equal(c.body.noteSession.mode, "sol-luna-2");
  }
});

// 3d. sol-fork-2: 전 단계 Sol, 모든 쓰기 호출이 고정 접두 P 싣고 병렬
test("sol-fork-2: all stages Sol, every write carries identical prefix P with anchor", async () => {
  const { post, calls } = fakePost();
  const res = await arm("sol-fork-2", { post, budget: new Budget({ maxCostUsd: 3, maxRequests: 400 }) });
  assert.equal(res.session.mode, "sol-fork-2");
  const writes = calls.filter(c => c.route === "/v1/write");
  assert.ok(writes.length > 0);
  const P = writes[0].body.noteSession?.history;
  assert.ok(P && P.length > 0, "고정 접두 P 존재");

  for (const c of calls.filter(c => c.route !== "/v1/judge")) {
    assert.equal(c.body.model, SOL, "sol-fork-2 는 모든 단계 Sol");
    if (c.route === "/v1/write") {
      assert.deepEqual(c.body.noteSession.history, P, "모든 쓰기 호출에 바이트 동일한 접두 P 전달");
    }
  }
});

test("sol-fork: writes before a plan prefix throw note_session_no_prefix", async () => {
  const s = newSession("sol-fork", "ab".repeat(12));
  assert.equal(s.prefix, null);
  assert.throws(() => writeBody({ model: SOL, requestId: "r", noteSpecVersion: "v", stage: "section" }, s),
    e => e.code === "note_session_no_prefix");
  s.prefix = [{ type: "task" }, { type: "message" }];
  const b = writeBody({ model: SOL, requestId: "r", noteSpecVersion: "v", stage: "section" }, s);
  assert.deepEqual(b.noteSession.history, s.prefix, "접두가 있으면 그대로 싣는다");
});

test("missing noteSession in response halts the arm with note_session_unsupported", async () => {
  const { post } = fakePost({ sessionSupport: false });
  const res = await arm("sol-session", { post, budget: new Budget({ maxCostUsd: 3, maxRequests: 400 }) });
  assert.equal(res.status, "failed");
  assert.match(String(res.code), /NOTE_SESSION_UNSUPPORTED/);
  assert.ok(res.totals.calls <= 2, "계획 호출 뒤 더 보내지 않는다");
});

test("mismatched envelope is rejected", async () => {
  const { post } = fakePost({ mutate: ns => ({ v: 1, id: "other", mode: ns.mode, history: [] }) });
  const res = await arm("sol-session", { post, budget: new Budget({ maxCostUsd: 3 }) });
  assert.match(String(res.code), /NOTE_SESSION_INVALID/);
});

test("history bounds halt the arm", async () => {
  const big = { post: null };
  big.post = fakePost({ mutate: ns => ({ v: 1, id: ns.id, mode: ns.mode, history: Array.from({ length: HISTORY_MAX_ITEMS + 1 }, () => ({ type: "x" })) }) }).post;
  let res = await arm("sol-session", { post: big.post, budget: new Budget({ maxCostUsd: 3 }) });
  assert.match(String(res.code), /NOTE_SESSION_TOO_LARGE/);

  const fat = fakePost({ mutate: ns => ({ v: 1, id: ns.id, mode: ns.mode, history: [{ type: "x", pad: "a".repeat(HISTORY_MAX_BYTES) }] }) });
  res = await arm("sol-session", { post: fat.post, budget: new Budget({ maxCostUsd: 3 }) });
  assert.match(String(res.code), /NOTE_SESSION_TOO_LARGE/);
});

test("budget caps stop sends and reservation releases on failure", async () => {
  const { post, calls } = fakePost();
  const b = new Budget({ maxCostUsd: 3, maxRequests: 3 });
  const res = await arm("independent", { post, budget: b });
  assert.match(String(res.code), /EXPERIMENT_BUDGET/);
  assert.ok(calls.length <= 3, "상한 이상의 전송이 없다");
  assert.ok(res.calls.some(c => c.error?.code === "experiment_budget"), "차단 기록이 남는다");
});

test("preflightV2Server: enforces writer=draft and review stage", () => {
  // 1. draft 미지원 서버
  assert.throws(() => preflightV2Server({ config: { noteWriter: "blocks" }, promptVersions: { review: "v1" } }),
    e => e.code === "server_unsupported_draft");

  // 2. review 단계 미지원 서버
  assert.throws(() => preflightV2Server({ config: { noteWriter: "draft" }, promptVersions: { draft: "v1" } }),
    e => e.code === "server_unsupported_review");

  // 3. 둘 다 지원
  assert.equal(preflightV2Server({
    config: { noteWriter: "draft" },
    promptVersions: { draft: "v1", review: "v1" },
  }), true);
});

test("toSpec11ResultRow: content-free row format and token separation", async () => {
  const { post } = fakePost();
  const res = await arm("sol-fork-2", { post, budget: new Budget({ maxCostUsd: 3 }) });
  const row = toSpec11ResultRow({
    armResult: res,
    serverVersion: "1.2.0",
    fixtureAlias: "synth-opaque-01",
    fixedPlan: true,
  });

  const expectedKeys = [
    "mode", "buildVersion", "serverVersion", "promptSchemaVersion", "fixtureAlias",
    "repeat", "planComparison", "rendererVersion", "actualModels", "providerCallCount",
    "retries", "tokens", "reportedCostUsd", "estimatedCostUsd", "reservedUsd",
    "costUnknownCalls", "generationMs", "persistenceMs", "endToEndMs", "sourceCoverage",
    "conditionsCoverage", "exceptionsCoverage", "losses", "questionsAnswerable",
    "visuals", "printDefects", "humanScores", "criticalErrors", "verdict"
  ];
  for (const k of expectedKeys) {
    assert.ok(k in row, "missing spec 11 field: " + k);
  }
  assert.equal(row.fixtureAlias, "synth-opaque-01");
  assert.equal(row.planComparison, "fixedPlan");
  assert.equal(row.mode, "sol-fork-2");
  assert.ok("uncachedInputTokens" in row.tokens);
  assert.ok("cacheReadTokens" in row.tokens);
  assert.ok("outputTokens" in row.tokens);
  assert.ok("reasoningTokens" in row.tokens);

  const str = JSON.stringify(row);
  for (const secret of ["고정비", "손익분기", "이전 지시", "2026123456", "월 고정비는 300만"]) {
    assert.ok(!str.includes(secret), "content leaked in row: " + secret);
  }
});

test("arm output carries no content, no history, no secrets", async () => {
  const { post } = fakePost();
  const res = await arm("sol-session", { post, budget: new Budget({ maxCostUsd: 3 }) });
  const blob = JSON.stringify(res);
  for (const s of ["고정비", "손익분기", "이전 지시", "2026123456", "월 고정비는 300만"])
    assert.ok(!blob.includes(s), "content leaked: " + s);
  assert.ok(!blob.includes('"history"'), "history 는 출력에 없다");
  assert.ok(!/"token"|"authorization"|Bearer /.test(blob));
});

test("newSession/applySessionReply contract", () => {
  const s = newSession("sol-session", "ab".repeat(12));
  assert.equal(s.v, 1); assert.equal(s.mode, "sol-session"); assert.match(s.id, /^ns-/); assert.deepEqual(s.history, []);
  const r = applySessionReply(s, { noteSession: { v: 1, id: s.id, mode: s.mode, history: [{ type: "message" }] } });
  assert.equal(r.items, 1); assert.equal(s.history.length, 1);
  for (const [name, res] of [
    ["missing", {}],
    ["missing", { noteSession: null }],
    ["bad v", { noteSession: { v: 2, id: s.id, mode: s.mode, history: [] } }],
    ["bad id", { noteSession: { v: 1, id: "x", mode: s.mode, history: [] } }],
    ["bad mode", { noteSession: { v: 1, id: s.id, mode: "sol-luna-tool", history: [] } }],
    ["bad history", { noteSession: { v: 1, id: s.id, mode: s.mode, history: "x" } }],
  ]) assert.throws(() => applySessionReply(s, res), e => /^note_session_(unsupported|invalid|too_large)/.test(e.code), name);
});

test("applySessionReply sol-fork: only the plan reply is adopted into the fixed prefix", () => {
  const s = newSession("sol-fork", "ab".repeat(12));
  const P = [{ type: "task" }, { type: "message" }];
  const grown = [...P, { type: "message" }];
  applySessionReply(s, { noteSession: { v: 1, id: s.id, mode: s.mode, history: grown } });
  assert.equal(s.prefix, null); assert.deepEqual(s.history, []);
  applySessionReply(s, { noteSession: { v: 1, id: s.id, mode: s.mode, history: P } }, { plan: true });
  assert.deepEqual(s.prefix, P); assert.deepEqual(s.history, P);
  applySessionReply(s, { noteSession: { v: 1, id: s.id, mode: s.mode, history: grown } });
  assert.deepEqual(s.prefix, P, "쓰기 응답은 절대 접두를 대체하지 않는다");
});

test("request bodies: write carries followup §1 fields + optional envelope; judge has none", () => {
  const o = { model: SOL, requestId: "r1", noteSpecVersion: "v", stage: "questions", section: {}, blockId: "S1_B2", allowedRefs: { targetIds: [], reviewIds: [] }, learningItems: [], jobId: "j1" };
  const w = writeBody(o, newSession("sol-session", "ab".repeat(12)));
  for (const k of ["blockId", "allowedRefs", "learningItems", "noteSession"]) assert.ok(k in w, "missing " + k);
  assert.equal(writeBody(o, null).noteSession, undefined);
  assert.ok(!("noteSession" in judgeBody({ task: "support", model: "m", requestId: "r", items: [] })));
  const p = planBody({ model: SOL, requestId: "r", noteSpecVersion: "v", ir: {}, recognition: "local", options: {}, host: "bad host" }, null);
  assert.ok(!("host" in p), "무효 host 는 뺀다");
});

test("makePost: 서비스 오류 봉투를 같은 모양의 오류로 접고 detail 은 안전 문자열만 남긴다", async () => {
  const post = makePost({ baseUrl: "http://localhost:8788", token: "t".repeat(40), fetchImpl: async () => new Response(JSON.stringify({ error: { code: "unexpected_field", message: "허용되지 않는 필드가 있습니다.", retryable: false, detail: "/noteSession" } }), { status: 400 }) });
  await assert.rejects(() => post("/v1/write", {}), e => e.code === "unexpected_field" && e.status === 400 && e.detail === "/noteSession");
  const leaky = makePost({ baseUrl: "http://localhost:8788", token: "t".repeat(40), fetchImpl: async () => new Response(JSON.stringify({ error: { code: "request_rejected", message: "x", detail: "주장: 고정비 300만 원" } }), { status: 400 }) });
  await assert.rejects(() => leaky("/v1/write", {}), e => e.detail === undefined, "내용 문자가 섞인 detail 은 버린다");
});

test("estCostUsd · Budget", () => {
  assert.ok(estCostUsd("/v1/plan", SOL, { ir: { units: [] } }) > 0);
  assert.ok(estCostUsd("/v1/write", LUNA_HIGH, { stage: "section" }) > 0);
  const b = new Budget({ maxCostUsd: 0.01, maxRequests: 5 });
  b.gate(0.005); b.spend(0.005);
  assert.throws(() => b.gate(0.006), e => e.code === "experiment_budget");
  const r = new Budget({ maxCostUsd: 10, maxRequests: 1 });
  r.spend(0.001); assert.ok(r.exhausted);
  assert.throws(() => r.gate(0), e => e.code === "experiment_budget");
});

test("kvPairs·memStore·planArms", () => {
  assert.deepEqual(kvPairs("claims=10 kept=7 relinked=0"), { claims: 10, kept: 7, relinked: 0 });
  const s = memStore(); s.putJson("jobs", "j1", { state: "done" }).then(async () => assert.equal((await s.getJson("jobs", "j1")).state, "done"));
  const arms = planArms({ judge: "typesafe/jev-1.13" });
  assert.equal(arms.length, 6, "총 6개 모드 (independent, 3개 v1 세션, 2개 v2 세션)");
  assert.equal(arms[0].models.write, LUNA_HIGH);
  assert.ok(arms[1].sessionEnvelope && arms[2].sessionEnvelope && arms[3].sessionEnvelope);
  assert.equal(arms[0].sessionEnvelope, null);
  assert.equal(arms[3].mode, "sol-fork");
  assert.equal(arms[4].mode, "sol-luna-2");
  assert.equal(arms[5].mode, "sol-fork-2");
  assert.equal(arms[4].models.write, LUNA_HIGH);
  assert.equal(arms[5].models.write, SOL);
  assert.equal(arms[4].writer, "draft");
  assert.equal(arms[5].writer, "draft");
  assert.equal(arms[3].writeLane, "default(8)", "sol-fork 는 일반 write 레인 — 연쇄 군만 1로 직렬화");
  assert.ok(arms.slice(1, 3).every(a => a.writeLane === 1), "연쇄 세션 군은 직렬");
  assert.ok(arms.every(a => a.localOutputCache === "disabled" && a.altModelFallback === "disabled"));
});

test("noteMetrics on the golden note", () => {
  const m = noteMetrics(expected, { evidenceTotal: loaded.evidenceTotal });
  assert.equal(m.status, "partial");
  assert.equal(m.sections, 5);
  assert.equal(m.withheld.droppedBlocks, 1);
  assert.deepEqual(m.withheld.droppedCodes, { VAL_NUMBER_MISSING: 1 });
  assert.equal(m.withheld.pruned, 2);
  const goldenItems = expected.sections.flatMap(s => s.blocks).filter(b => b.type === "B14").reduce((n, b) => n + (b.content?.items?.length ?? 0), 0);
  assert.equal(m.questions.items, goldenItems);
  assert.ok(goldenItems > 0);
  assert.equal(m.questions.refs.dead, 0);
  assert.ok(m.claims.total > 0 && m.evidence.cited > 0);
  assert.equal(m.evaluation.humanAccuracy, "not_evaluated");
  const cov = learningCoverage(normalizePlan(plannerOutput, loaded.scope, undefined), expected);
  assert.equal(cov.total, 0, "fixture 계획에는 학습 항목이 없다");
  assert.equal(cov.claimLinked, "not_evaluated");
});
