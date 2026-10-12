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
  DEFAULT_MAX_USD, PROBE_MAX_USD, armConfigHash,
} = await import("./note-session-experiment.mjs");

const loaded = loadInput("tools/note-fixture/input.json");

const ANCHOR_ITEM = { role: "user", content: [{ type: "input_text", text: ANCHOR_TEXT, prompt_cache_breakpoint: { mode: "explicit" } }] };
// ── v2 초안 응답 픽스처(lib/stages.test.js 와 같은 모양) — stage:"draft" 는 블록 봉투가 아니라
// 주장+typed 관계를 돌려준다. 컴파일(lib/section-draft.js)이 계획 블록으로 조판한다.
// writer-outputs.json 의 first 는 이미 컴파일된 봉투라 초안 스키마(sectionId·claims·relations·nullReasons)를 통과하지 못한다.
const REL0 = () => ({ comparisons: [], arguments: [], cases: [], materials: [], calcs: [], pitfalls: [], notes: [], links: [], notices: [], maps: [] });
const dclaim = (claimId, role, text, evidenceIds, conceptIds = []) => ({ claimId, role, text, basis: "lecture", evidenceIds, conceptIds, dependsOn: [], emphasis: null });
const draftOf = (sectionId, claims, relations = {}, gist = null) => ({ sectionId, gist, claims, relations: { ...REL0(), ...relations }, checks: [] });
const DRAFT_S1 = () => draftOf("S1", [
  dclaim("c1", "definition", "생산량과 관계없이 일정 기간 동안 발생하는 비용을 고정비라고 한다", ["U1.s2", "U1.t2"], ["C1"]),
  dclaim("c2", "definition", "생산량에 비례해 늘어나는 비용을 변동비라고 한다", ["U1.s3", "U1.t3"], ["C2"]),
]);
const DRAFT_S2 = () => draftOf("S2", [
  dclaim("c1", "definition", "판매가격에서 단위당 변동비를 뺀 값이 공헌이익이라고 한다", ["U2.s4", "U2.t1"], ["C3"]),
  dclaim("c2", "definition", "고정비를 개당 공헌이익으로 나눈 판매량을 손익분기점이라고 한다", ["U2.t3"], ["C4"]),
  dclaim("c3", "example", "정정된 고정비로 계산한 손익분기 판매량 사례가 나온다", ["U3.t2"], ["C3"]),
]);
const DRAFT_S3 = () => draftOf("S3", [
  dclaim("c1", "definition", "시장 거래 비용과 내부 조직 비용을 비교해 기업의 경계를 정한다는 관점이다", ["U4.s2", "U4.t2"], ["C5"]),
  dclaim("c2", "definition", "고유 자원과 역량이 있는 활동을 기업 내부에 둔다는 관점이다", ["U4.s3", "U4.t3"], ["C6"]),
  dclaim("c3", "comparison", "거래를 분석 단위로 삼는다", ["U4.g1"], ["C5"]),
  dclaim("c4", "comparison", "자원과 역량을 분석 단위로 삼는다", ["U4.g1"], ["C6"]),
  dclaim("c5", "argument", "기업의 경계는 시장 거래 비용과 내부 조직 비용의 비교로 정한다", ["U4.s2"], ["C5"]),
  dclaim("c6", "argument", "거래가 자주 일어나고 전용 자산이 필요할수록 내부에서 하는 편이 낫다", ["U4.t2"], ["C5"]),
], {
  comparisons: [{ status: null, importance: null, title: "세 관점을 같은 기준으로 비교", entities: [{ label: "거래비용 관점", conceptId: "C5" }, { label: "자원기반 관점", conceptId: "C6" }], criteria: [{ label: "분석 단위", cells: ["c3", "c4"] }], common: [], discriminator: null }],
  arguments: [{ status: null, importance: null, title: "거래비용 관점의 논거", relationType: "argument", question: null, steps: [{ role: "premise", claim: "c5" }, { role: "claim", claim: "c6" }], missingLinks: [] }],
});
// review 수정 제안의 change 는 strict 스키마라 REVIEW_OPS 가 쓰는 칸을 모두 가진다 — op 가 안 쓰는 칸은 null/빈 배열이다(lib/stages.test.js 의 chg 와 같은 모양).
const chg = o => ({ text: null, claim: null, keepTargetId: null, assetIds: [], note: null, from: null, to: null, value: null, ...o });
// 초안 출력은 outputSchemaFor 를 통과해야 한다 — nullReasons 는 필수·null 허용 칸이다.
const draftOut = body => {
  const out = { nullReasons: null, ...(body.section?.sectionId === "S1" ? DRAFT_S1() : body.section?.sectionId === "S2" ? DRAFT_S2() : body.section?.sectionId === "S3" ? DRAFT_S3() : draftOf(body.section?.sectionId, [], {})) };
  if (body.withGist === false) delete out.gist; // 반으로 나뉜 뒷반 요청(withGist:false)은 gist 칸 자체가 스키마에 없다
  return out;
};

// 서비스 API 봉투를 흉내 내는 mock — plan/write 응답에 noteSession 을 되돌린다.
// sol-fork/sol-fork-2/sol-luna-2: 계획 응답이 고정 접두 P 를 구성하고 anchor item 을 포함한다.
function fakePost({ sessionSupport = true, mutate = ns => ({ v: 1, id: ns.id, mode: ns.mode, history: [...ns.history, { type: "message" }] }), sessionError = null, writeDelayMs = 0, reviewEdits = null, inference = true } = {}) {
  const calls = [], writeTimes = [];
  let writesInflight = 0, maxWritesInflight = 0, seq = 0;
  const post = async (route, body) => {
    calls.push({ route, body });
    const isWrite = route === "/v1/write";
    let wr = null;
    if (isWrite) { wr = { start: seq++ }; writeTimes.push(wr); writesInflight++; maxWritesInflight = Math.max(maxWritesInflight, writesInflight); }
    try {
      if (isWrite && writeDelayMs) await new Promise(r => setTimeout(r, writeDelayMs));
      const base = {
        usage: {
          promptTokens: 500, completionTokens: 200, costUsd: 0.005,
          // usage.inference 서버 계약(호스트 합의): 프로파일·요청/실제 모델·보낸 effort·라우트·시도 수.
          // reportedEffort 는 제공자가 확인해 돌려주는 별개 칸 — 이 mock 은 미보고(null)로 둔다.
          // inference:false 옵션은 칸째로 빼 미보고 경로(메트릭이 null/unknown 으로 남는지)를 시험한다.
          ...(inference ? { inference: {
            profile: body.noteSession?.mode ?? null,
            requestedModel: body.model ?? null,
            resolvedModel: body.model ?? null,
            effort: (/@(medium|high|xhigh)/.exec(body.model ?? "") || [])[1] ?? null,
            reportedEffort: null,
            route: "liner",
            attempts: 1,
          } } : {}),
        },
        promptVersion: "note-v6", schemaVersion: 1,
      };
      const mode = body.noteSession?.mode;
      if (isWrite && (mode === "sol-fork" || mode === "sol-fork-2")) base.usage.cachedInputTokens = 420;

      let payload;
      if (route === "/v1/plan") {
        payload = { ...base, plan: plannerOutput };
      } else if (route === "/v1/judge") {
        payload = { ...base, results: body.items.map(i => ({ itemId: i.itemId, task: body.task, probs: [{ label: "A", p: .9 }, { label: "B", p: .1 }], score: .9, confidence: .8, model: body.model })) };
      } else if (isWrite) {
        const sec = body.section?.sectionId;
        if (body.stage === "editorial") {
          // v2 편집 계획은 plan 과 별개 호출(같은 세션의 두 번째 Sol 턴) — 응답 이력 끝에 앵커가 붙는다.
          payload = { ...base, editorialPlan: { v: 1, glossary: [{ conceptId: "C1", preferredTerm: "고정비", aliases: [], evidenceIds: ["U1.s1"] }],
            sections: plannerOutput.sections.map(sec => ({ sectionId: sec.sectionId, learningQuestion: null, learningItemIds: [], prerequisiteSectionIds: [], mustExplain: [], owns: [], referencesOnly: [], visuals: [], targetOutputTokens: 1200 })) } };
        } else if (body.stage === "section") {
          payload = { ...base, output: writer.sections[sec]?.first };
        } else if (body.stage === "draft") {
          payload = { ...base, output: draftOut(body) };
        } else if (body.stage === "review") {
          // baseRevision 을 되돌려야 stale 판정을 통과한다(운영 서버가 요청 판본을 에코하는 것과 같다).
          payload = { ...base, output: { baseRevision: body.baseRevision ?? null, edits: reviewEdits ?? [], unresolved: [] } };
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
              history: V2_MODES.has(body.noteSession.mode) && route === "/v1/plan" ? [{ type: "task" }, { type: "message" }]
                : body.stage === "editorial" ? [...body.noteSession.history, { type: "task" }, { type: "message" }, ANCHOR_ITEM]
                : body.noteSession.history.length
                  ? body.noteSession.history
                  : [{ type: "task" }, { type: "message" }, ANCHOR_ITEM],
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

// 3c. sol-luna-2·sol-luna-3: Sol 계획 → Luna draft(독립) → Sol review(P) → Luna questions(독립) → Sol 전역/복구(P)
for (const lunaMode of ["sol-luna-2", "sol-luna-3"]) test(`${lunaMode}: stage->model table and noteSession selective attachment`, async () => {
  const { post, calls } = fakePost();
  const res = await arm(lunaMode, { post, budget: new Budget({ maxCostUsd: 3, maxRequests: 400 }) });
  assert.equal(res.session.mode, lunaMode);
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

  // review, global, repair 호출은 Sol. sol-luna-3 의 repair 는 transport:"packet" — 세션 봉투 XOR 자급 패킷 둘 중 정확히 하나다(production 정상).
  const solWriteCalls = calls.filter(c => c.route === "/v1/write" && ["review", "global", "repair"].includes(c.body.stage));
  for (const c of solWriteCalls) {
    assert.equal(c.body.model, SOL, "review, global, repair 는 Sol");
    if (lunaMode === "sol-luna-3" && c.body.stage === "repair") {
      assert.equal(c.body.noteSession == null, c.body.packet != null, "packet 수리는 봉투 대신 패킷을 싣는다");
      continue;
    }
    assert.ok(c.body.noteSession !== undefined, "Sol 단계는 noteSession 포함");
    assert.equal(c.body.noteSession.mode, lunaMode);
  }
});

// 3e. mis-luna-legacy-medium·high: mis-sol-hai 경로에 전 단계 Luna 단일 모델 — Sol·Haiku 호출 0건.
// 세션/체크포인트는 mode(=effort 변형)별로 갈리므로 두 변형의 이력이 섞이지 않는다.
for (const [lunaMode, lunaModel, effort] of [["mis-luna-legacy-medium", "openai/gpt-6-luna@medium", "medium"], ["mis-luna-legacy-high", LUNA_HIGH, "high"]])
test(`${lunaMode}: every stage and both repair paths use one Luna model; session/fork wiring preserved`, async () => {
  const { post, calls } = fakePost();
  const res = await arm(lunaMode, { post, budget: new Budget({ maxCostUsd: 3, maxRequests: 400 }) });
  assert.equal(res.session.mode, lunaMode);
  assert.ok(res.session.prefixItems > 0, "편집 계획 응답이 고정 접두 P 를 형성함");
  assert.equal(typeof res.session.id, "string");
  assert.ok(res.session.id.length > 0, "세션 id 는 비어 있지 않다");
  assert.ok(calls.every(c => c.body.noteSession === undefined || c.body.noteSession.id === res.session.id), "군 안의 봉투 id 는 하나다 — production Stages 가 만든 id 를 채택한다");
  assert.ok(res.editorialPlan !== null);
  assert.ok(res.render && res.render.print, "mock 군도 렌더까지 간다");

  // 전 단계 Luna — Sol·Haiku 호출이 없다.
  const modelCalls = calls.filter(c => c.route !== "/v1/judge");
  for (const c of modelCalls) assert.equal(c.body.model, lunaModel, `${c.body.stage ?? "plan"} 모델`);

  // plan·editorial·review·global 은 세션 봉투(고정 접두 P), draft·questions 는 봉투 없는 독립 호출.
  const sessionStages = calls.filter(c => c.route === "/v1/write" && ["editorial", "review", "global"].includes(c.body.stage));
  for (const c of sessionStages) {
    assert.equal(c.body.noteSession?.mode, lunaMode, `${c.body.stage} 는 세션 봉투`);
    assert.ok(c.body.noteSession.history.length > 0, `${c.body.stage} 는 접두/이력을 싣는다`);
  }
  for (const c of calls.filter(c => c.route === "/v1/write" && (c.body.stage === "draft" || c.body.stage === "questions")))
    assert.equal(c.body.noteSession, undefined, `${c.body.stage} 는 독립 호출`);
  assert.equal(calls.find(c => c.route === "/v1/plan").body.noteSession.mode, lunaMode);
  // 수리(dual)의 봉투는 Stages 의 목적 결정을 그대로 따른다 — 실험 래퍼는 봉투를 다시 붙이지도 떼지도 않는다.
  for (const c of calls.filter(c => c.route === "/v1/write" && c.body.stage === "repair"))
    assert.equal(c.body.model, lunaModel, "수리도 같은 Luna");

  // production 본문 칸 전달(래퍼가 버리면 서버 MSH 분기·검수가 깨진다): v2 쓰기는 noteMode 를 싣고,
  // HTML 검수는 렌더 html·baseRevision 판본을 싣는다. 독립 호출에도 noteMode 는 production 이 붙인다.
  for (const c of calls.filter(c => c.route === "/v1/write"))
    assert.equal(c.body.noteMode, lunaMode, `${c.body.stage} 본문에 noteMode`);
  const rv = calls.find(c => c.route === "/v1/write" && c.body.stage === "review");
  assert.ok(typeof rv.body.html === "string" && rv.body.html.length > 0, "검수 입력은 렌더 HTML");
  assert.ok(typeof rv.body.baseRevision === "string" && rv.body.baseRevision.length > 0, "검수 입력 판본");
  // 편집 계획 호출은 실제 근거·자산 id 허용 목록을 싣는다 — 래퍼가 버리면 서버가 모르는 id 를 지어낸다.
  const ed = calls.find(c => c.route === "/v1/write" && c.body.stage === "editorial");
  assert.ok(Array.isArray(ed.body.allowedEvidenceIds) && ed.body.allowedEvidenceIds.length > 0, "편집 계획 근거 허용 목록");
  assert.ok(Array.isArray(ed.body.allowedAssetIds), "편집 계획 자산 허용 목록");
  for (const c of calls.filter(c => c.route === "/v1/write" && ["draft", "questions"].includes(c.body.stage)))
    assert.equal(c.body.noteSession, undefined, `${c.body.stage} 는 독립 — 봉투 없음`);

  // 내용 없는 관측 칸: profile·요청/실제 모델·effort·라우트·재시도·캐시 사용(usage.inference 계약).
  for (const c of res.calls) {
    assert.equal(c.profile, lunaMode);
    if (c.route !== "/v1/judge") {
      assert.equal(c.model, lunaModel, "요청 모델");
      assert.equal(c.resolvedModel, lunaModel, "서버가 보고한 실제 모델 — mock 은 요청 그대로 돌려준다");
      assert.equal(c.effort.requested, effort, "설계 effort 는 변형의 @effort");
      assert.equal(c.effort.sent, effort, "실제로 보낸 effort(usage.inference.effort)");
      assert.equal(c.effort.reported, null, "제공자 확인 effort 는 미보고(null) — sent 를 실측으로 표기하지 않는다");
      assert.equal(c.inferenceRoute, "liner");
      assert.equal(c.attempts, 1, "mock 은 시도 1건을 보고한다");
    }
  }
  const row = toSpec11ResultRow({ armResult: res });
  assert.match(row.requestedModels, new RegExp(`plan:${lunaModel.replace(/[/@.]/g, "\\$&")}`), "요청 구성은 레지스트리 모델");
  assert.match(row.requestedModels, new RegExp(`repair:${lunaModel.replace(/[/@.]/g, "\\$&")}\\|${lunaModel.replace(/[/@.]/g, "\\$&")}`), "dual 수리는 세션|독립 양쪽 모델");
  assert.match(row.actualModels, new RegExp(`plan:${lunaModel.replace(/[/@.]/g, "\\$&")}`), "mock 이 보고한 실제 모델만 모인다");
});

// 3f. mis-luna-legacy: HTML 검수의 request_section_redo 는 Stages 의 의도된 독립 호출이다 — model==alt 여도
// 실험 래퍼가 봉투를 다시 붙이면 안 되고(서버가 거절), 봉투 없는 응답에 applySessionReply 를 걸어 멈추면 안 된다.
test("mis-luna-legacy-high: HTML review request_section_redo repair goes out independent — no reattached envelope, no session adoption", async () => {
  const { post, calls } = fakePost({
    reviewEdits: [{ op: "request_section_redo", targetId: "S1", reasonCode: "needs_redo", evidenceIds: [], change: chg({ note: "rewrite it" }) }],
  });
  const res = await arm("mis-luna-legacy-high", { post, budget: new Budget({ maxCostUsd: 3 }) });
  assert.equal(res.status, "partial", `독립 재작성 응답에 noteSession 이 없어도 군이 멈추지 않는다: ${res.code}`);

  const redos = calls.filter(c => c.route === "/v1/write" && c.body.stage === "repair" && (c.body.repair ?? []).some(r => (r.errors ?? []).some(e => e.code === "VAL_SECTION_REDO")));
  assert.ok(redos.length >= 1, "재작성 수리 호출이 나간다");
  for (const c of redos) {
    assert.equal(c.body.noteSession, undefined, "독립 재작성에는 봉투를 다시 붙이지 않는다(Stages 의 전송 결정)");
    assert.equal(c.body.model, LUNA_HIGH, "재작성 모델도 변형의 Luna");
    assert.equal(c.body.noteMode, "mis-luna-legacy-high", "독립 호출도 production noteMode 를 싣는다");
  }
  const redoMetrics = redos.map(c => res.calls.find(m => m.requestId === c.body.requestId));
  for (const m of redoMetrics) if (m) assert.equal(m.sessionSentItems, null, "봉투 없는 호출은 sessionSentItems null");
});

// 3g. spec11 actualModels: 서버가 실제 모델을 보고하지 않으면 요청값으로 채우지 않는다 — 단계별 unknown 만 남긴다.
test("spec11 actualModels: 서버 미보고면 unknown — 요청 모델을 실측으로 적지 않는다", async () => {
  const { post } = fakePost({ inference: false }); // usage.inference 칸째로 없음(구 서버)
  const res = await arm("mis-luna-legacy-high", { post, budget: new Budget({ maxCostUsd: 3 }) });
  const row = toSpec11ResultRow({ armResult: res });
  assert.match(row.requestedModels, /plan:openai\/gpt-6-luna@high/, "요청 구성은 레지스트리 그대로 적는다");
  for (const c of res.calls) assert.equal(c.resolvedModel, null, "미보고 resolvedModel 은 null");
  assert.ok(!row.actualModels.includes("gpt-6-luna"), "미보고를 실측으로 오표시하지 않는다: " + row.actualModels);
  assert.match(row.actualModels, /unknown/, "단계별 unknown 표기");
});

// 3d. sol-fork-2: 전 단계 Sol, 모든 쓰기 호출이 고정 접두 P 싣고 병렬
test("sol-fork-2: all stages Sol, every write carries identical prefix P with anchor", async () => {
  const { post, calls } = fakePost();
  const res = await arm("sol-fork-2", { post, budget: new Budget({ maxCostUsd: 3, maxRequests: 400 }) });
  assert.equal(res.session.mode, "sol-fork-2");
  const edit = calls.find(c => c.body.stage === "editorial");
  assert.ok(edit, "편집 계획은 plan 과 별개 호출이다");
  assert.deepEqual(edit.body.noteSession.history, [{ type: "task" }, { type: "message" }], "editorial 은 plan 응답 이력(앵커 없음)을 이어 쓴다");
  const writes = calls.filter(c => c.route === "/v1/write" && c.body.stage !== "editorial");
  assert.ok(writes.length > 0);
  const P = writes[0].body.noteSession?.history;
  assert.equal(P.at(-1).content[0].text, ANCHOR_TEXT, "고정 접두 P 는 앵커로 끝난다");

  for (const c of calls.filter(c => c.route !== "/v1/judge")) {
    assert.equal(c.body.model, SOL, "sol-fork-2 는 모든 단계 Sol");
    if (c.route === "/v1/write" && c.body.stage !== "editorial") {
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
  assert.ok(estCostUsd("/v1/write", "openai/gpt-6-luna@medium", { stage: "draft" }, "mis-luna-legacy-medium") > 0, "mode 인자를 modelParams 에 넘긴다");
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
  assert.equal(arms.length, 10, "총 10개 모드 (independent, 3개 v1 세션, 6개 v2 세션)");
  assert.equal(arms[0].models.write, LUNA_HIGH);
  assert.ok(arms[1].sessionEnvelope && arms[2].sessionEnvelope && arms[3].sessionEnvelope);
  assert.equal(arms[0].sessionEnvelope, null);
  assert.equal(arms[3].mode, "sol-fork");
  assert.equal(arms[4].mode, "sol-luna-2");
  assert.equal(arms[5].mode, "sol-fork-2");
  assert.equal(arms[6].mode, "mis-sol-hai");
  assert.equal(arms[7].mode, "mis-luna-legacy-medium");
  assert.equal(arms[8].mode, "mis-luna-legacy-high");
  assert.equal(arms[9].mode, "sol-luna-3");
  assert.equal(arms[4].models.write, LUNA_HIGH);
  assert.equal(arms[5].models.write, SOL);
  assert.equal(arms[6].models.write, "anthropic/claude-haiku-5.5", "mis-sol-hai 는 Haiku 작성 경로");
  assert.equal(arms[7].models.write, "openai/gpt-6-luna@medium", "mis-luna-legacy-medium 은 Luna medium 작성 경로");
  assert.equal(arms[8].models.write, LUNA_HIGH, "mis-luna-legacy-high 는 Luna high 작성 경로");
  assert.equal(arms[9].models.write, LUNA_HIGH, "sol-luna-3 도 Luna 작성 경로");
  assert.equal(arms[7].models.plan, "openai/gpt-6-luna@medium", "mis-luna-legacy 의 계획도 같은 Luna — Sol 잔존 0");
  assert.equal(arms[8].models.plan, LUNA_HIGH);
  assert.equal(arms[7].reasoningBudget, 8000);
  assert.equal(arms[8].reasoningBudget, 8000, "medium 도 8000 — 두 변형의 출력 상한이 같다");
  assert.ok(arms[6].sessionEnvelope && arms[6].writer === "draft", "mis-sol-hai 도 v2 세션·draft 경로");
  assert.ok(arms[9].sessionEnvelope && arms[9].writer === "draft", "sol-luna-3 도 v2 세션·draft 경로");
  assert.ok(arms[7].sessionEnvelope && arms[7].writer === "draft" && arms[8].sessionEnvelope && arms[8].writer === "draft", "mis-luna-legacy 도 v2 fork 세션·draft 경로");
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

test("§9.4 하네스 규칙: 기본 예산 상수와 armConfigHash", () => {
  assert.equal(DEFAULT_MAX_USD, 1.50);
  assert.equal(PROBE_MAX_USD, 0.05);

  const h1 = armConfigHash({ mode: "sol-luna-3", noteV3: { repair: "packet", resume: false } });
  const h2 = armConfigHash({ mode: "sol-luna-3", noteV3: { repair: "full-p", resume: false } });
  const h3 = armConfigHash({ mode: "sol-luna-3", noteV3: { repair: "packet", resume: false } });
  assert.equal(h1, h3, "동일 설정은 동일 해시");
  assert.notEqual(h1, h2, "옵션 변경 시 다른 해시");
});

test("planArms: sol-luna-3 에 v3 옵션 전달", () => {
  const arms = planArms({ repair: "full-p", resume: "on" });
  const v3Arm = arms.find(a => a.mode === "sol-luna-3");
  assert.ok(v3Arm);
  assert.deepEqual(v3Arm.noteV3, { repair: "full-p", resume: true });

  const armsDefault = planArms();
  const v3Default = armsDefault.find(a => a.mode === "sol-luna-3");
  assert.deepEqual(v3Default.noteV3, { repair: "packet", resume: false });
});

test("makeService (§9.4 규칙): plan/editorial 실패 1회 시 즉시 plan_editorial_failed 로 중단", async () => {
  const failPost = async (route) => {
    if (route === "/v1/plan") throw new Error("plan error");
    return {};
  };
  const calls = [];
  const srv = makeService({ post: failPost, calls });
  await assert.rejects(
    () => srv.plan({ model: "openai/gpt-6.1-sol", requestId: "r1" }),
    err => err.retryable === false && err.code === "plan_editorial_failed"
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].ok, false);
});

test("makeService (§9.4 규칙): 연속 429 2회 발생 시 consecutive_upstream_429 로 즉시 중단", async () => {
  let callCount = 0;
  const rateLimitPost = async () => {
    callCount++;
    throw Object.assign(new Error("rate limit"), { status: 429, code: "provider_busy" });
  };
  const calls = [];
  const srv = makeService({ post: rateLimitPost, calls });

  // 1회차 429: 일반 에러 throw
  await assert.rejects(
    () => srv.write({ model: "openai/gpt-6-luna", requestId: "r1", stage: "draft" }),
    err => err.code === "provider_busy"
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].ok, false);

  // 2회차 연속 429: consecutive_upstream_429 로 즉시 중단
  await assert.rejects(
    () => srv.write({ model: "openai/gpt-6-luna", requestId: "r2", stage: "draft" }),
    err => err.code === "consecutive_upstream_429"
  );
  assert.equal(calls.length, 2);
  assert.equal(calls[1].ok, false);
});
