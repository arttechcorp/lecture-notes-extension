// runNote → ServiceClient → fetch 직렬화까지 태우는 회귀 — service mock은 요청 직렬화 누락을 못 잡는다
// (필드: write() 가 blockId·allowedRefs·learningItems 를 본문에서 빼 questions 가 서버에서 400 이었다).
// fetch 는 서버 계약을 그대로 지키는 합성 서버로 바꾼다: 본문을 server/prompts.js REQUEST 스키마로 검증하고,
// noteSession 은 마지막으로 돌려준 history 와 다르면 400 을 돌려준다.
const test = require("node:test");
const assert = require("node:assert/strict");
const katex = require("./vendor/katex/katex.min.js");
const P = require("./pipeline.js");
const S = require("./stages.js");
const NoteContract = require("./note-contract.js");
const Contracts = require("./contracts.js");
const Prompts = require("../server/prompts.js");
const ServiceClient = require("./service-client.js");
const { createStore, memoryAdapter } = require("./package-store.js");
const { EventBus } = require("./events.js");
const INPUT = require("../tools/note-fixture/input.json");
const PLANNER = require("../tools/note-fixture/planner-output.json");
const WRITER = require("../tools/note-fixture/writer-outputs.json");

const b64 = o => Buffer.from(JSON.stringify(o)).toString("base64url");
const JWT = `${b64({ alg: "RS256" })}.${b64({ iss: "https://auth.example.com/", exp: Math.floor(Date.now() / 1000) + 600 })}.${b64("sig")}`;
const BASE = "https://service.example";
const clock = (t = 1000) => () => t++;
const deep = o => JSON.parse(JSON.stringify(o));
const inputOf = (over = {}) => ({
  slides: INPUT.slides, transcript: INPUT.transcript, gaps: [], tier: "paid",
  models: { plan: "openai/gpt-6.1-sol", write: "openai/gpt-6.1-sol", judge: null },
  consent: { summary: true }, meta: INPUT.meta, ...over,
});
const PV = { plan: "note-v5", section: "note-v5", repair: "note-v5", global: "note-v5", draft: "note-v5", link: "note-v5", review: "note-v5", questions: "note-v5", judge: "v1" };

// 본문에 실리지만 요청 스키마에 없는 봉투 칸(모델·id·작업·세션) — 검증 전에 뗀다.
const ENVELOPE = new Set(["model", "requestId", "noteSpecVersion", "stage", "jobId", "host", "sourceLang", "noteSession", "noteMode"]);
// v2 칸(editorialPlan·repair mode·review 단계)은 계약 워커가 prompts.js 에 넣는다 — 병합 전 스냅샷에서는
// 스키마가 아직 모르는 칸을 검사에서만 뺀다(병합 뒤에는 스키마가 받는다). 단계 스키마 자체가 없으면 건너뛴다.
const V2_FIELDS = new Set(["editorialPlan"]);
const V2_MODES = new Set(["sol-luna-2", "sol-fork-2"]), FORK_MODES = new Set(["sol-fork", "sol-fork-2", "sol-luna-2"]);
const SESSION_MODES = new Set(["sol-session", "sol-luna-tool", "sol-fork", "sol-luna-2", "sol-fork-2"]);
// 고정 접두 P 의 끝 — 서버가 심는 앵커 항목(v2 계획 응답 history 는 이것으로 끝난다).
const ANCHOR_ITEM = { type: "message", role: "user", content: [{ type: "input_text", text: "anchor-marker-v2", prompt_cache_breakpoint: { mode: "explicit" } }] };
const EP = { v: 1, glossary: [{ conceptId: "C1", preferredTerm: "고정비", aliases: ["고정 비용"], evidenceIds: ["U1.s2"] }],
  sections: PLANNER.sections.map(s => ({ sectionId: s.sectionId, learningQuestion: s.title ?? "q", learningItemIds: [], prerequisiteSectionIds: [], mustExplain: [], owns: [], referencesOnly: [], visuals: [], targetOutputTokens: 1200 })) };

// 합성 서버. over 는 {route|stage: body=>json} 로 단계 응답을 덮는다. 세션 기록은 서버 기억처럼 맵에 둔다.
// writeDelayMs 를 주면 /v1/write 마다 잠시 멈춰 동시 실행 수를 잰다 — sol-fork 의 병렬·웜업 게이트 검증용.
function serve(over = {}, { writeDelayMs = 0 } = {}) {
  const sent = [], sessions = new Map(), writeTimes = [];
  let inflight = 0, maxWritesInflight = 0, seq = 0;
  const defaults = {
    plan: () => ({ plan: deep(PLANNER), promptVersion: "note-v5" }),
    section: b => ({ output: deep(WRITER.sections[b.section.sectionId].first) }),
    // v2 모드의 초안 스키마는 nullReasons(필수·null 허용)를 갖는다 — 구 모드 초안에는 그 칸이 없다.
    draft: b => { const r = draftFixture(b); return V2_MODES.has(b.noteSession?.mode) || V2_MODES.has(b.noteMode) ? { ...r, output: { nullReasons: null, ...r.output } } : r; },
    repair: b => ({ output: { blocks: Object.fromEntries(b.repair.map(r => [r.blockId, deep(WRITER.sections[b.section.sectionId].repair?.blocks?.[r.blockId] ?? null)])) } }),
    global: () => ({ output: deep(WRITER.global) }),
    link: () => ({ output: { edits: [] } }),
    review: () => ({ output: { edits: [], unresolved: [] } }),
    questions: b => ({ output: { blocks: { [b.blockId]: null } } }),
    judge: b => ({ results: b.items.map(i => ({ itemId: i.itemId, task: b.task, probs: [{ label: "yes", p: .9 }], score: b.task === "support" ? .9 : 3, confidence: null, model: b.model })) }),
  };
  const handle = async (route, body) => {
    sent.push({ route, body });
    // /v1/write 의 동시 실행 수와 시작·종료 순서를 잰다 — 연쇄 모드는 1, fork 는 첫 호출 뒤 병렬이어야 한다.
    let wr = null;
    if (route === "/v1/write") {
      wr = { start: seq++ }; writeTimes.push(wr); // 도착 순서
      inflight++; maxWritesInflight = Math.max(maxWritesInflight, inflight);
      if (writeDelayMs) await new Promise(r => setTimeout(r, writeDelayMs));
      wr.end = seq++; inflight--;
    }
    const stage = route === "/v1/plan" ? "plan" : route === "/v1/judge" ? "judge" : body.stage;
    if (route === "/v1/write" || route === "/v1/plan") {
      const sch = Prompts.REQUEST[stage];
      if (sch) {
        const known = new Set(Object.keys(sch.properties ?? {}));
        const rest = Object.fromEntries(Object.entries(body).filter(([k]) => !ENVELOPE.has(k) && (known.has(k) || !V2_FIELDS.has(k))));
        if (Array.isArray(rest.repair) && sch.properties?.repair?.items?.properties && !("mode" in sch.properties.repair.items.properties))
          rest.repair = rest.repair.map(r => { const { mode, ...x } = r; return x; });
        const v = Contracts.validate(sch, rest);
        if (!v.ok) return { status: 400, json: { error: { code: "request_rejected", message: stage + " " + (v.errors[0]?.path ?? "?"), retryable: false } } };
      }
    }
    let noteSession;
    if (body.noteSession !== undefined) {
      const ns = body.noteSession;
      const shape = ns && ns.v === 1 && typeof ns.id === "string" && ns.id.length >= 8 && SESSION_MODES.has(ns.mode) && Array.isArray(ns.history);
      if (!shape) return { status: 400, json: { error: { code: "note_session_invalid", retryable: false } } };
      if (FORK_MODES.has(ns.mode)) {
        // 포크 서버 규칙: 계획 호출이 고정 접두 P 를 만들고, 쓰기 호출은 P 만 받는다(requestId -sN 연속 재개만
        // P + 자기 작업을 받는다). 쓰기 응답은 접두를 그대로 돌려준다 — 이 호출의 턴은 이어 붙이지 않는다.
        // v2 의 P 는 작업·출력 항목 뒤 하나의 앵커 항목으로 끝난다 — 서버는 이 앵커로 P 를 찾는다.
        const P = sessions.get(ns.id) ?? null;
        if (route === "/v1/plan") {
          const next = [...ns.history, { type: "task", stage: "plan" }, { type: "message", role: "assistant", content: [{ type: "output_text", text: "synthetic" }] },
            ...(V2_MODES.has(ns.mode) ? [deep(ANCHOR_ITEM)] : [])];
          sessions.set(ns.id, next);
          noteSession = { v: 1, id: ns.id, mode: ns.mode, history: next };
        } else {
          const exact = P !== null && JSON.stringify(ns.history) === JSON.stringify(P);
          const cont = P !== null && /-s\d+$/.test(String(body.requestId)) && ns.history.length > P.length && JSON.stringify(ns.history.slice(0, P.length)) === JSON.stringify(P);
          if (!exact && !cont) return { status: 400, json: { error: { code: "request_rejected", retryable: false } } };
          noteSession = { v: 1, id: ns.id, mode: ns.mode, history: cont ? ns.history : P };
        }
      } else {
        const prev = sessions.get(ns.id) ?? null;
        const fresh = prev === null && ns.history.length === 0;
        if (!fresh && JSON.stringify(ns.history) !== JSON.stringify(prev))
          return { status: 400, json: { error: { code: "note_session_invalid", retryable: false } } };
        const next = [...ns.history, { type: "message", role: "assistant", content: [{ type: "output_text", text: "synthetic" }] }];
        sessions.set(ns.id, next);
        noteSession = { v: 1, id: ns.id, mode: ns.mode, history: next };
      }
    }
    const ov = over[route] ?? over[stage];
    let r = typeof ov === "function" ? ov(body) : ov;
    if (r === undefined && defaults[stage]) r = defaults[stage](body);
    if (r === undefined) return { status: 500, json: { error: { code: "no_fixture", retryable: false } } };
    // 덮은 응답이 {status,json} 모양이면 그대로 쓴다(오류·pending 시나리오). 200이면 세션 봉투는 붙인다 —
    // 덮은 봉투가 있으면 그것을 쓴다(비정상 접두·자란 history 주입). fork 의 pending 은 접두+자기 작업을 돌려준다.
    if (r && typeof r === "object" && "json" in r && "status" in r) {
      const j = { ...r.json };
      if (noteSession && r.status === 200)
        j.noteSession = j.noteSession ?? (j.pending === true && FORK_MODES.has(body.noteSession?.mode) ? { ...noteSession, history: [...noteSession.history, { type: "task", pending: true }] } : noteSession);
      return { ...r, json: j };
    }
    const j = { ...r, ...(noteSession ? { noteSession } : {}) };
    // v2 계획 응답은 {plan, editorialPlan, noteSession} — 응답 덮어쓰기가 직접 주지 않으면 기본 편집 계획을 얹는다.
    if (route === "/v1/plan" && V2_MODES.has(body.noteSession?.mode) && !("editorialPlan" in j)) j.editorialPlan = deep(EP);
    return { status: 200, json: j };
  };
  const old = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const { status, json } = await handle(String(url).slice(BASE.length), JSON.parse(init.body));
    return new Response(JSON.stringify(json), { status, headers: { "content-type": "application/json" } });
  };
  return { sent, sessions, writeTimes, maxWritesInflight: () => maxWritesInflight, restore: () => { globalThis.fetch = old; } };
}
// ServiceClient 를 그대로 통과하는 서비스 묶음 — stages.test.js 의 fakeService 가 아니라 실제 직렬화 경로다.
const realService = () => ({
  plan: o => ServiceClient.plan({ baseUrl: BASE, token: JWT, ...o }),
  write: o => ServiceClient.write({ baseUrl: BASE, token: JWT, ...o }),
  judge: o => ServiceClient.judge({ baseUrl: BASE, token: JWT, ...o }),
});
const depsOf = (bus, over = {}) => ({ service: realService(), katex, events: bus, sleep: async () => {}, promptVersions: PV, ...over });
async function setup({ jobId = "j1", packageId = "pkg", store } = {}) {
  store ??= await createStore(memoryAdapter());
  const bus = new EventBus({ now: clock(), limit: 100000 });
  return { store, bus, job: await P.createJob({ jobId, packageId, store, events: bus, now: clock() }) };
}

// ── draft 경로(W2-A)용 초안 — stages.test.js 의 변환과 같은 모양으로 픽스처 봉투를 되돌린다 ──
const REL0 = () => ({ comparisons: [], arguments: [], cases: [], materials: [], calcs: [], pitfalls: [], notes: [], links: [], notices: [], maps: [] });
const draftFixture = o => {
  const first = WRITER.sections[o.section.sectionId].first, claims = [], rels = {};
  let n = 0, em = null;
  const put = (c, role, conceptIds = []) => { claims.push({ claimId: "c" + ++n, role, text: c.text, basis: c.basis, evidenceIds: [...c.evidenceIds], conceptIds, dependsOn: [], emphasis: em }); em = null; return "c" + n; };
  const add = (kind, env, r) => (rels[kind] ??= []).push({ status: null, importance: env.importance ?? null, ...r });
  for (const pb of o.section.blocks) {
    const env = first.blocks[pb.blockId], c = env?.content;
    if (!c || pb.type === "B14") continue;
    em = env.emphasis?.[0] ?? null;
    switch (pb.type) {
      case "B05":
        put(c.definition, "definition", [c.conceptId]);
        if (c.explanation) put(c.explanation, "intuition", [c.conceptId]);
        if (c.mechanism) put(c.mechanism, "mechanism", [c.conceptId]);
        for (const x of c.scope ?? []) put(x, "condition", [c.conceptId]);
        for (const x of c.examples ?? []) put(x, "example", [c.conceptId]);
        break;
      case "B06": add("comparisons", env, { title: c.title,
        entities: c.entities.map(e => ({ label: e.label, conceptId: e.conceptId ?? null })),
        criteria: c.criteria.map(r => ({ label: r.label, cells: r.cells.map(x => x ? put(x, "comparison") : null) })),
        common: (c.common ?? []).map(x => put(x, "comparison")),
        discriminator: c.discriminator ? put(c.discriminator, "comparison") : null }); break;
      case "B07": add("arguments", env, { title: c.title, relationType: c.relationType,
        question: c.question ? put(c.question, "argument") : null,
        steps: c.steps.map(s => ({ role: s.role, claim: put(s.claim, "argument") })),
        missingLinks: (c.missingLinks ?? []).map(x => put(x, "argument")) }); break;
      case "B09": add("materials", env, { sourceTitle: c.sourceTitle, sourceKind: c.sourceKind, gist: put(c.gist, "notice"),
        quote: c.quote ? { text: c.quote.text, evidenceIds: [...c.quote.evidenceIds] } : null,
        points: (c.points ?? []).map(p => ({ clue: put(p.clue, "notice"), reading: put(p.reading, "notice") })),
        authorClaim: c.authorClaim ? put(c.authorClaim, "notice") : null,
        lecturerReading: c.lecturerReading ? put(c.lecturerReading, "notice") : null,
        limits: (c.limits ?? []).map(x => put(x, "notice")) }); break;
      case "B10": add("calcs", env, { title: c.title, kind: c.kind, goal: c.goal ? put(c.goal, "calculation") : null,
        formulaIds: [...c.formulaIds ?? []], figureIds: [...c.figureIds ?? []],
        variables: (c.variables ?? []).map(v => ({ symbol: v.symbol, meaning: put(v.meaning, "calculation"), unit: v.unit ?? null })),
        assumptions: (c.assumptions ?? []).map(x => put(x, "calculation")),
        inputs: (c.inputs ?? []).map(x => ({ label: x.label, value: x.value, unit: x.unit ?? null, evidenceIds: [...x.evidenceIds] })),
        steps: (c.steps ?? []).map(x => ({ label: x.label, op: x.op, a: x.a, b: x.b, value: x.value, unit: x.unit ?? null, digits: x.digits ?? null })),
        derived: [...c.derived ?? []], reading: (c.reading ?? []).map(x => put(x, "calculation")),
        result: c.result ? put(c.result, "calculation") : null, limits: (c.limits ?? []).map(x => put(x, "calculation")),
        withheld: c.withheld ? put(c.withheld, "calculation") : null }); break;
      case "B11": add("pitfalls", env, { misconception: put(c.misconception, "notice"), correction: put(c.correction, "notice"),
        conditions: (c.conditions ?? []).map(x => put(x, "notice")), origin: c.origin }); break;
      case "B12": add("notes", env, { kind: c.kind, note: put(c.note, "notice") }); break;
      case "B18": add("notices", env, { items: c.items.map(i => ({ topic: i.topic, claim: put(i.claim, "notice"), due: i.due ?? null })) }); break;
    }
    em = null;
  }
  const out = { sectionId: o.section.sectionId, gist: first.gist ? { text: first.gist.text, evidenceIds: [...first.gist.evidenceIds], basis: first.gist.basis } : null, claims, relations: { ...REL0(), ...rels }, checks: first.checks ?? [] };
  if (o.withGist === false) delete out.gist;
  return { output: out };
};
const S4_Q = { status: "supported", importance: "supporting", emphasis: [], content: { items: [{ kind: "ox", prompt: { text: "응답 점포 62%가 매출이 늘었다고 답했다", evidenceIds: ["U5.s3"], basis: "lecture" }, premise: null, level: "basic", targetIds: ["S4_B1"], answer: { verdict: "O", explanation: { text: "자료에 응답 점포의 62%가 매출이 늘었다고 답했다고 적혀 있다", evidenceIds: ["U5.s3"], basis: "lecture" }, correction: null, rubric: [], alternatives: [], reviewIds: ["S4_B1"] } }] } };
const questionsFill = b => ({ output: { blocks: { [b.blockId]: b.blockId === "S2_B5" ? deep(WRITER.sections.S2.repair.blocks.S2_B5) : deep(S4_Q) } } });

// ── 실제 직렬화 회귀: 본문이 server/prompts.js REQUEST 를 통과하고 questions 필드가 실린다 ──
test("transport regression: every plan/write body passes the server REQUEST schema end to end", async () => {
  const srv = serve({ questions: questionsFill });
  const { job, bus } = await setup();
  const res = await S.runNote(job, inputOf(), depsOf(bus, { writer: "draft", linkEditor: true }));
  srv.restore();
  assert.equal(job.state, "done", "400 이 하나라도 나면 작업이 끝나지 않는다");
  assert.equal(res.status, "partial");
  // questions 호출 본문(직렬화된 것): blockId·allowedRefs·살아남은 주장 목록이 실제로 실렸다
  const qs = srv.sent.filter(c => c.body.stage === "questions");
  assert.deepEqual(qs.map(c => c.body.blockId).sort(), ["S2_B5", "S4_B2"]);
  for (const c of qs) {
    assert.ok(Array.isArray(c.body.allowedRefs.targetIds) && c.body.allowedRefs.targetIds.length > 0, "allowedRefs 가 본문에 있다");
    assert.ok(!c.body.allowedRefs.reviewIds.includes("S4_B2"), "아직 null 인 B14 는 복습 목록에 없다");
    assert.ok(c.body.sections.length > 0, "살아남은 주장 목록");
  }
  const b14 = res.note.sections.find(s => s.sectionId === "S4").blocks.find(b => b.id === "S4_B2");
  assert.equal(b14.type, "B14", "문항이 채워진다");
  assert.ok(srv.sent.every(c => !("noteSession" in c.body)), "운영 경로는 세션 봉투를 싣지 않는다");
});

test("transport regression: write bodies carry allowedRefs; learningItems lands when the plan assigns items", async () => {
  const plan = deep(PLANNER);
  // 합성 계획에 학습 항목을 얹는다 — learningItems 직렬화는 픽스처에 없는 경로라 여기서 만든다
  const L = [{ itemId: "L1", kind: "definition", importance: "core", unitIds: ["U1"], correctionOf: null }];
  const onWire = [{ itemId: "L1", kind: "definition", importance: "core", unitIds: ["U1"] }]; // learningItemsFor 가 싣는 네 칸
  plan.learningItems = L;
  const srv = serve({ plan: () => ({ plan, promptVersion: "note-v5" }) });
  const { job, bus } = await setup();
  const res = await S.runNote(job, inputOf(), depsOf(bus));
  srv.restore();
  assert.equal(job.state, "done");
  assert.equal(res.status, "partial");
  const writes = srv.sent.filter(c => c.route === "/v1/write");
  assert.ok(writes.length > 0);
  for (const c of writes.filter(c => c.body.stage === "section" || c.body.stage === "repair" || c.body.stage === "draft")) {
    assert.ok(c.body.allowedRefs && Array.isArray(c.body.allowedRefs.targetIds), `${c.body.stage} 의 allowedRefs`);
  }
  // 정규화가 core 항목 L1 을 그 근거 유닛의 섹션(U1 → S1)에 배정한다 — 그 섹션의 작성·재작성 요청에 실려야 한다
  const withItems = writes.filter(c => c.body.learningItems !== undefined);
  assert.ok(withItems.length > 0, "정규화가 L1 을 배정한 섹션의 요청은 learningItems 를 실어야 한다");
  for (const c of withItems) assert.deepEqual(c.body.learningItems, onWire);
  assert.ok(withItems.every(c => c.body.section?.sectionId === "S1"), "배정된 섹션에만 싣는다");
});

// ── noteSession 계약: plan→write 전 구간 직렬·봉투 전파·메모리 전용 ──
for (const mode of ["sol-session", "sol-luna-tool"]) {
  test(`noteSession ${mode}: every plan/write call rides one serialized conversation in run memory`, async () => {
    const srv = serve();
    const { job, bus, store } = await setup();
    const res = await S.runNote(job, inputOf(), depsOf(bus, { noteMode: mode }));
    assert.equal(job.state, "done");
    assert.equal(res.status, "partial");
    const sess = srv.sent.filter(c => "noteSession" in c.body);
    assert.ok(sess.length >= 7, `계획 1 + 섹션 5 + 전역 + 재작성 … 모두 세션 호출 (${sess.length})`);
    const id = sess[0].body.noteSession.id;
    for (const [i, c] of sess.entries()) {
      assert.equal(c.body.noteSession.v, 1);
      assert.equal(c.body.noteSession.id, id, "모든 호출이 같은 불투명 세션 id");
      assert.equal(c.body.noteSession.mode, mode);
      // 직렬화 증거: 합성 서버가 응답마다 항목을 하나씩 붙이므로 직렬 호출의 history 길이는 0,1,2,… 다 —
      // 병렬로 나갔다면 같은 길이의 요청이 둘 이상 생긴다.
      assert.equal(c.body.noteSession.history.length, i, `요청 ${i} 의 history 길이`);
    }
    assert.ok(sess[0].route === "/v1/plan" && sess[0].body.noteSession.history.length === 0, "계획이 세션을 연다");
    // 세션 밖 호출 없음(judge 모델 null) — 세션 봉투는 plan·write 본문에만 있다
    assert.ok(srv.sent.every(c => c.route !== "/v1/judge" || !("noteSession" in c.body)));
    // 끝난 run 의 세션은 버린다 — 같은 패키지의 다음 run 은 새 불투명 id 로 연다
    const b = await setup({ jobId: "j2", packageId: "pkg", store });
    await S.runNote(b.job, inputOf(), depsOf(b.bus, { noteMode: mode }));
    const sess2 = srv.sent.filter(c => "noteSession" in c.body && c.body.noteSession.id !== id);
    assert.ok(sess2.length > 0 && sess2.every(c => c.body.noteSession.id === sess2[0].body.noteSession.id), "두 번째 run 은 새 세션 id");
    srv.restore();
  });
}

test("noteSession mismatch stops the experiment instead of continuing with a broken prefix", async () => {
  // 서버가 다른 id 를 돌려주는 깨진 계약 — 이어지는 호출은 전부 오염되므로 작업이 실패해야 한다
  const srv = serve();
  const inner = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const res = await inner(url, init);
    if (!init?.body || !JSON.parse(init.body).noteSession) return res;
    const j = await res.json();
    return new Response(JSON.stringify({ ...j, noteSession: { ...j.noteSession, id: "forged-session-id" } }), { status: res.status });
  };
  const { job, bus } = await setup();
  const res = await S.runNote(job, inputOf(), depsOf(bus, { noteMode: "sol-session" }));
  srv.restore();
  assert.equal(job.state, "failed");
  assert.equal(res.status, "failed");
});

test("pending slice: a 200 pending continues the same call with -s1 and fresh history, then validates only the final body", async () => {
  let pended = false;
  const srv = serve({ section: b => b.section.sectionId === "S1" && !pended && !b.requestId.includes("-s")
    ? (pended = true, { status: 200, json: { pending: true, usage: { prompt_tokens: 5, completion_tokens: 2 } } })
    : undefined });
  const { job, bus, store } = await setup();
  const res = await S.runNote(job, inputOf(), depsOf(bus, { noteMode: "sol-session" }));
  srv.restore();
  assert.equal(job.state, "done");
  const s1 = srv.sent.filter(c => c.body.section?.sectionId === "S1" && c.body.stage === "section");
  assert.equal(s1.length, 2, "S1 작성은 pending 뒤 재개 한 번 — 같은 논리 호출의 두 HTTP 요청");
  assert.equal(s1[0].body.requestId + "-s1", s1[1].body.requestId, "재개 요청은 -s1 접미");
  const { requestId: _a, noteSession: _b, ...first } = s1[0].body, { requestId: _c, noteSession: _d, ...second } = s1[1].body;
  assert.deepEqual(second, first, "stage·body 는 그대로 — 달라지는 것은 requestId·history 뿐");
  assert.equal(s1[1].body.noteSession.history.length, s1[0].body.noteSession.history.length + 1, "재개는 최신 history");
  assert.ok(res.note.sections.some(s => s.sectionId === "S1"), "최종 output만 검증돼 본문에 들어간다");
});

test("pending chain is capped: three requests then the call stops as a timeout, never endless", async () => {
  // 계획 호출이 계속 pending 을 돌려준다 — 총량 상한(3요청)에서 끊겨야 한다
  const srv = serve({ plan: () => ({ status: 200, json: { pending: true, usage: { prompt_tokens: 1 } } }) });
  const { job, bus } = await setup();
  const res = await S.runNote(job, inputOf(), depsOf(bus, { noteMode: "sol-session" }));
  srv.restore();
  const plans = srv.sent.filter(c => c.route === "/v1/plan");
  assert.equal(plans.length, 3, "최초 + -s1 + -s2 까지");
  assert.equal(plans[1].body.requestId, plans[0].body.requestId + "-s1");
  assert.equal(plans[2].body.requestId, plans[0].body.requestId + "-s2");
  assert.equal(job.state, "paused", "시간 초과와 같은 network 일시정지 — 무한 재시도는 없다");
  assert.equal(res.status, "paused");
  assert.equal(res.code, "NET_UNREACHABLE");
});

test("independent mode: no noteSession anywhere, and a rerun never reuses local caches", async () => {
  const srv = serve();
  const { job, bus, store } = await setup();
  const res = await S.runNote(job, inputOf(), depsOf(bus, { noteMode: "independent" }));
  assert.equal(job.state, "done");
  assert.equal(res.status, "partial");
  assert.ok(srv.sent.every(c => !("noteSession" in c.body)), "independent 는 봉투를 만들지 않는다");
  const n1 = srv.sent.length;
  // 같은 패키지·같은 입력의 재실행은 평소라면 단계 캐시에서 다 나온다 — 실험 모드는 전부 다시 보낸다
  const b = await setup({ jobId: "j2", packageId: "pkg", store });
  const res2 = await S.runNote(b.job, inputOf(), depsOf(b.bus, { noteMode: "independent" }));
  srv.restore();
  assert.equal(res2.status, "partial");
  const plans = srv.sent.filter(c => c.route === "/v1/plan");
  assert.equal(plans.length, 2, "두 번째 run 의 계획도 서버에 나간다(캐시 우회)");
  assert.ok(srv.sent.length > n1, "재실행의 모든 호출이 실제로 나간다");
});

test("experiment modes never fall back to writeAlt; a held block stays held", async () => {
  // S5(블록 하나) 작성이 항상 llm_output_truncated 로 실패하게 한다 — 운영 경로는 writeAlt 로 넘기지만 실험 모드는 그대로 보류다
  const srv = serve({ section: b => b.section.sectionId === "S5" ? { status: 500, json: { error: { code: "llm_output_truncated", retryable: false } } } : undefined });
  const { job, bus } = await setup();
  const res = await S.runNote(job, inputOf({ models: { plan: "openai/gpt-6.1-sol", write: "openai/gpt-6.1-sol", writeAlt: "alt-model", judge: null } }), depsOf(bus, { noteMode: "sol-session" }));
  srv.restore();
  assert.equal(job.state, "done");
  assert.equal(res.status, "partial");
  assert.ok(srv.sent.every(c => c.body.model !== "alt-model"), "대체 모델로 조용히 넘기지 않는다");
  assert.ok(!res.note.sections.some(s => s.sectionId === "S5"), "못 쓴 S5 는 보류로 빠진다");
});

// ── sol-fork: 계획 응답이 고정 접두 P — 모든 쓰기 호출이 P 만 싣고 병렬로 나간다 ──
test("noteSession sol-fork: every write call sends the identical fixed prefix and writes overlap on write lanes", async () => {
  const srv = serve({}, { writeDelayMs: 10 });
  const { job, bus } = await setup();
  const res = await S.runNote(job, inputOf(), depsOf(bus, { noteMode: "sol-fork" }));
  srv.restore();
  assert.equal(job.state, "done");
  assert.equal(res.status, "partial");
  const sess = srv.sent.filter(c => "noteSession" in c.body);
  const plan = sess.find(c => c.route === "/v1/plan");
  assert.ok(plan && plan.body.noteSession.mode === "sol-fork" && plan.body.noteSession.v === 1);
  assert.deepEqual(plan.body.noteSession.history, [], "계획 호출은 빈 history 로 세션을 연다 — sol-session 과 같다");
  const id = plan.body.noteSession.id, P = srv.sessions.get(id);
  assert.ok(P?.length > 0, "계획 응답이 고정 접두를 만든다");
  const writes = sess.filter(c => c.route === "/v1/write");
  assert.ok(writes.length >= 7, `섹션·재작성·전역 모두 세션 호출 (${writes.length})`);
  for (const c of writes) {
    assert.equal(c.body.noteSession.id, id, "모든 호출이 같은 불투명 세션 id");
    assert.equal(c.body.noteSession.mode, "sol-fork");
    assert.deepEqual(c.body.noteSession.history, P, `${c.body.stage} 도 바이트 동일한 접두만 싣는다 — 이어 붙이지 않는다`);
  }
  assert.ok(srv.maxWritesInflight() >= 2, "fork 쓰기는 write 레인으로 병렬 실행된다 — session.tail 직렬화 없음");
  // 웜업 게이트: 첫 쓰기 호출(도착 순 1번)이 응답까지 끝나야 나머지가 서버에 도착한다 — 접두를 캐시에 쓰는 호출
  assert.ok(srv.writeTimes.length >= 2 && srv.writeTimes[0].end < srv.writeTimes[1].start, "첫 쓰기 호출은 단독으로 끝난다");
  // 세션 밖 호출 없음 — 봉투는 plan·write 본문에만 있다
  assert.ok(srv.sent.every(c => c.route !== "/v1/judge" || !("noteSession" in c.body)));
});

test("noteSession sol-session stays serialized under the same write lanes where sol-fork overlaps", async () => {
  const srv = serve({}, { writeDelayMs: 10 });
  const { job, bus } = await setup();
  const res = await S.runNote(job, inputOf(), depsOf(bus, { noteMode: "sol-session" }));
  srv.restore();
  assert.equal(job.state, "done");
  assert.equal(res.status, "partial");
  assert.equal(srv.maxWritesInflight(), 1, "연쇄 세션은 history 순서 때문에 한 줄로 세운다");
});

test("sol-fork: a write reply that grows history is validated but never adopted as prefix", async () => {
  // 서버가 쓰기 응답에 이어 붙인 history 를 돌려줘도(계약 어긋남) 다음 호출은 여전히 접두만 싣는다
  const grow = b => ({ status: 200, json: {
    output: { blocks: Object.fromEntries(b.repair.map(r => [r.blockId, deep(WRITER.sections[b.section.sectionId].repair?.blocks?.[r.blockId] ?? null)])) },
    noteSession: { v: 1, id: b.noteSession.id, mode: "sol-fork", history: [...b.noteSession.history, { type: "message", role: "assistant", content: [{ type: "output_text", text: "extra" }] }] } } });
  const srv = serve({ repair: grow });
  const { job, bus } = await setup();
  const res = await S.runNote(job, inputOf(), depsOf(bus, { noteMode: "sol-fork" }));
  srv.restore();
  assert.equal(job.state, "done");
  assert.ok(srv.sent.some(c => c.body.stage === "repair"), "재작성 호출이 실제로 나갔다");
  const id = srv.sent.find(c => c.route === "/v1/plan").body.noteSession.id, P = srv.sessions.get(id);
  for (const c of srv.sent.filter(c => c.route === "/v1/write"))
    assert.deepEqual(c.body.noteSession.history, P, `${c.body.stage} 도 접두만 — 자란 응답 history 는 승격되지 않는다`);
});

test("sol-fork: a pending write resumes with its own grown history — the shared prefix is never promoted", async () => {
  let pended = false;
  const srv = serve({ section: b => b.section.sectionId === "S2" && !pended && !/-s\d+$/.test(b.requestId)
    ? (pended = true, { status: 200, json: { pending: true, usage: { prompt_tokens: 5, completion_tokens: 2 } } })
    : undefined });
  const { job, bus } = await setup();
  const res = await S.runNote(job, inputOf(), depsOf(bus, { noteMode: "sol-fork" }));
  srv.restore();
  assert.equal(job.state, "done");
  const id = srv.sent.find(c => c.route === "/v1/plan").body.noteSession.id, P = srv.sessions.get(id);
  const s2 = srv.sent.filter(c => c.body.section?.sectionId === "S2" && c.body.stage === "section");
  assert.equal(s2.length, 2, "S2 작성은 pending 뒤 같은 호출 재개 한 번 — 두 HTTP 요청");
  assert.equal(s2[1].body.requestId, s2[0].body.requestId + "-s1");
  assert.deepEqual(s2[0].body.noteSession.history, P, "첫 전송도 접두만");
  assert.deepEqual(s2[1].body.noteSession.history.slice(0, P.length), P, "재개는 접두 + 자기 작업");
  assert.ok(s2[1].body.noteSession.history.length > P.length, "그 호출만 history 가 자랐다");
  // 그리고 나머지 모든 쓰기 호출은 여전히 정확한 접두만 싣는다 — 자란 history 는 절대 공유 접두로 승격되지 않는다
  for (const c of srv.sent.filter(c => c.route === "/v1/write" && !/-s\d+$/.test(c.body.requestId)))
    assert.deepEqual(c.body.noteSession.history, P, `${c.body.stage}·${c.body.section?.sectionId ?? "-"} 도 접두만`);
});

test("sol-fork: a failed plan leaves no prefix — not a single write request goes out as an independent call", async () => {
  const srv = serve({ plan: () => ({ status: 500, json: { error: { code: "provider_failed_or_invalid_output", retryable: false } } }) });
  const { job, bus } = await setup();
  const res = await S.runNote(job, inputOf(), depsOf(bus, { noteMode: "sol-fork" }));
  srv.restore();
  assert.equal(job.state, "failed");
  assert.equal(res.status, "failed");
  assert.ok(!srv.sent.some(c => c.route === "/v1/write"), "계획 접두가 없으면 쓰기를 보내지 않는다");
});

test("sol-fork: a plan reply without the session envelope stops the run — no write is attempted", async () => {
  // 서버가 봉투를 떼고 돌려주는 깨진 계약 — 접두를 만들 수 없으므로 쓰기는 거부돼야 한다
  const srv = serve();
  const inner = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const res = await inner(url, init);
    if (!init?.body || !JSON.parse(init.body).noteSession) return res;
    const j = await res.json(); delete j.noteSession;
    return new Response(JSON.stringify(j), { status: res.status });
  };
  const { job, bus } = await setup();
  const res = await S.runNote(job, inputOf(), depsOf(bus, { noteMode: "sol-fork" }));
  srv.restore();
  assert.equal(job.state, "failed");
  assert.equal(res.status, "failed");
  assert.ok(!srv.sent.some(c => c.route === "/v1/write"), "계획 봉투가 없으면 쓰기를 보내지 않는다");
});

test("sol-fork: an empty plan prefix refuses every write with a clear coded event, never a silent fallback", async () => {
  // 서버가 계획 봉투를 빈 history 로 돌려주는 계약 위반 — 접두가 없는 것과 같다
  const srv = serve({ plan: b => ({ status: 200, json: { plan: deep(PLANNER), promptVersion: "note-v5",
    noteSession: { v: 1, id: b.noteSession.id, mode: "sol-fork", history: [] } } }) });
  const { job, bus } = await setup();
  const res = await S.runNote(job, inputOf(), depsOf(bus, { noteMode: "sol-fork" }));
  srv.restore();
  assert.equal(job.state, "failed");
  assert.equal(res.code, "NOTE_FORK_NO_PREFIX");
  assert.ok(bus.recent().some(e => e.code === "NOTE_FORK_NO_PREFIX" && e.level === "error"), "명시적 코드 이벤트가 남는다");
  assert.ok(!srv.sent.some(c => c.route === "/v1/write"), "접두 없이 보낸 쓰기 호출은 없다 — 독립 호출 폴백 없음");
});

// ── v2 noteSession: 고정 접두 P(앵커 종료) · 단계→모델 표 · Luna 독립 호출 ──
test("sol-fork-2: every write call is Sol riding the same fixed prefix P — plan reply ends at the anchor item", async () => {
  const srv = serve({}, { writeDelayMs: 10 });
  const { job, bus } = await setup();
  const res = await S.runNote(job, inputOf(), depsOf(bus, { writer: "draft", noteMode: "sol-fork-2" }));
  srv.restore();
  assert.equal(job.state, "done");
  const plan = srv.sent.find(c => c.route === "/v1/plan");
  const id = plan.body.noteSession.id, P = srv.sessions.get(id);
  assert.equal(plan.body.noteSession.mode, "sol-fork-2");
  assert.deepEqual(plan.body.noteSession.history, [], "계획 호출은 빈 history 로 연다");
  // 접두 P 는 작업·출력 항목 뒤 정확히 하나의 앵커 항목으로 끝난다 — 서버가 이 앵커로 P 를 찾는다
  const last = P.at(-1);
  assert.equal(last.role, "user");
  assert.deepEqual(last.content[0].prompt_cache_breakpoint, { mode: "explicit" });
  const writes = srv.sent.filter(c => c.route === "/v1/write");
  assert.ok(writes.length >= 7, `draft×5 + review + repair + global·문항 (${writes.length})`);
  for (const c of writes) {
    assert.equal(c.body.model, "openai/gpt-6.1-sol", c.body.stage);
    assert.equal(c.body.noteSession.mode, "sol-fork-2");
    assert.deepEqual(c.body.noteSession.history, P, `${c.body.stage} 도 바이트 동일한 접두만 싣는다`);
  }
  assert.ok(srv.maxWritesInflight() >= 2 && srv.maxWritesInflight() <= 4, "웜업 뒤 병렬 — 초기 동시성 4 상한");
  assert.ok(srv.writeTimes[0].end < srv.writeTimes[1].start, "첫 쓰기 호출(웜업)은 단독으로 끝난다");
  assert.equal(writes.filter(c => c.body.stage === "review").length, 1, "통합 검수는 한 번");
  assert.equal(writes.filter(c => c.body.stage === "link").length, 0, "link 는 돌지 않는다");
});

test("sol-luna-2: Sol stages ride P; Luna draft/questions are plain calls — no envelope, no history, per-section packet", async () => {
  const srv = serve({}, { writeDelayMs: 10 });
  const { job, bus } = await setup();
  const res = await S.runNote(job, inputOf(), depsOf(bus, { writer: "draft", noteMode: "sol-luna-2" }));
  srv.restore();
  assert.equal(job.state, "done");
  const plan = srv.sent.find(c => c.route === "/v1/plan");
  const id = plan.body.noteSession.id, P = srv.sessions.get(id);
  assert.equal(plan.body.noteSession.mode, "sol-luna-2");
  const writes = srv.sent.filter(c => c.route === "/v1/write");
  const luna = writes.filter(c => ["draft", "questions"].includes(c.body.stage));
  const sol = writes.filter(c => !["draft", "questions"].includes(c.body.stage));
  assert.ok(luna.length >= 6, "draft×5 + questions");
  for (const c of luna) {
    assert.equal(c.body.model, "openai/gpt-6-luna@high", c.body.stage);
    assert.ok(!("noteSession" in c.body), `${c.body.stage} — Luna 호출은 봉투를 싣지 않는다`);
    assert.ok(!("history" in c.body), "history 도 없다");
    if (c.body.stage === "draft") {
      const ep = c.body.editorialPlan;
      assert.equal(ep.v, 1);
      assert.equal(ep.section.sectionId, c.body.section.sectionId, "이 섹션의 편집 명세만");
      assert.ok(!("sections" in ep), "다른 섹션의 명세를 싣지 않는다");
      assert.ok(Array.isArray(ep.glossary), "공통 용어");
    }
  }
  assert.ok(sol.length > 0, "Sol 단계가 있다(review·global·repair)");
  for (const c of sol) {
    assert.equal(c.body.model, "openai/gpt-6.1-sol", c.body.stage);
    assert.deepEqual(c.body.noteSession.history, P, `${c.body.stage} — 고정 접두 P`);
  }
  const rv = writes.filter(c => c.body.stage === "review");
  assert.equal(rv.length, 1, "통합 검수는 정확히 한 번");
  assert.equal(rv[0].body.editorialPlan.v, 1, "검수 요청은 전체 편집 계획을 싣는다");
  assert.ok(Array.isArray(rv[0].body.editorialPlan.sections) && rv[0].body.editorialPlan.sections.length === 5);
  assert.equal(writes.filter(c => c.body.stage === "link").length, 0);
});

test("sol-luna-2: a grown write reply is validated but never promotes to P — the next Sol call still sends the exact prefix", async () => {
  // 서버가 쓰기 응답에 이어 붙인 history 를 돌려줘도 접두는 계획 응답 것 그대로다
  const grow = b => ({ status: 200, json: {
    output: { blocks: Object.fromEntries(b.repair.map(r => [r.blockId, null])) },
    noteSession: { v: 1, id: b.noteSession.id, mode: "sol-luna-2", history: [...b.noteSession.history, { type: "message", role: "assistant", content: [{ type: "output_text", text: "extra" }] }] } } });
  const srv = serve({ repair: grow });
  const { job, bus } = await setup();
  const res = await S.runNote(job, inputOf(), depsOf(bus, { writer: "draft", noteMode: "sol-luna-2" }));
  srv.restore();
  assert.equal(job.state, "done");
  const id = srv.sent.find(c => c.route === "/v1/plan").body.noteSession.id, P = srv.sessions.get(id);
  for (const c of srv.sent.filter(c => c.route === "/v1/write" && "noteSession" in c.body))
    assert.deepEqual(c.body.noteSession.history, P, `${c.body.stage} 도 접두만 — 자란 응답 history 는 승격되지 않는다`);
});

test("v2 preflight: without draft writer or review prompt version the run stops before any request", async () => {
  for (const [tag, over] of [["writer 미지원", { writer: "blocks" }], ["review 버전 없음", { writer: "draft", promptVersions: { ...PV, review: undefined } }]]) {
    const srv = serve();
    const { job, bus } = await setup();
    await assert.rejects(() => S.runNote(job, inputOf(), depsOf(bus, { ...over, noteMode: "sol-fork-2" })), e => e?.code === "NOTE_V2_UNSUPPORTED", tag);
    srv.restore();
    assert.ok(bus.recent().some(e => e.code === "NOTE_V2_UNSUPPORTED"), tag + ": 코드 이벤트");
    assert.equal(srv.sent.length, 0, tag + ": 요청이 하나도 나가지 않는다");
  }
});

test("v2: a missing editorialPlan stops at planning — no fallback, no write requests", async () => {
  const srv = serve({ plan: () => ({ status: 200, json: { plan: deep(PLANNER), promptVersion: "note-v5" } }) });
  const { job, bus } = await setup();
  const res = await S.runNote(job, inputOf(), depsOf(bus, { writer: "draft", noteMode: "sol-luna-2" }));
  srv.restore();
  assert.equal(res.status, "failed");
  assert.equal(res.code, "EDITORIAL_PLAN_INVALID");
  assert.ok(bus.recent().some(e => e.code === "EDITORIAL_PLAN_INVALID"), "코드 이벤트가 남는다");
  assert.ok(!srv.sent.some(c => c.route === "/v1/write"), "계획에서 멈춘다 — 쓰기 호출 없음");
});

test("sol-fork-2: cancelling mid-run stops in-flight workers — no further writes go out", async () => {
  const srv = serve({}, { writeDelayMs: 40 });
  const { job, bus } = await setup();
  const ctl = new AbortController();
  const p = S.runNote(job, inputOf(), depsOf(bus, { writer: "draft", noteMode: "sol-fork-2", signal: ctl.signal }));
  // 계획이 끝나 쓰기가 나가기 시작하면 취소한다 — 진행 중인 호출·대기 중인 작업이 모두 멈춰야 한다
  setTimeout(() => ctl.abort(), 25);
  const res = await p.catch(e => e);
  srv.restore();
  const writes = srv.sent.filter(c => c.route === "/v1/write");
  assert.ok(writes.length < 8, `취소 뒤 나머지 호출이 나가지 않는다 (${writes.length})`);
  assert.ok(res instanceof Error || res.status !== "complete");
});
