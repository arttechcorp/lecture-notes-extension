// 노트 실험 프로파일 레지스트리(lib/note-profiles.js) 검증:
// 1) 표 불변식 2) 7개 모드의 파생 결과 = 리팩터 전 하드코딩 값(기대값은 이 파일에 리터럴로 둔다) 3) 프로파일 추가 = 표 한 줄.
const test = require("node:test"), assert = require("node:assert/strict");
const NP = require("./note-profiles.js");
const NoteV3 = require("./note-v3.js");
const LLM = require("../server/llm.js");

const SOL = "openai/gpt-6.1-sol", LUNA = "openai/gpt-6-luna@high";
const IDS = ["independent", "sol-session", "sol-luna-tool", "sol-fork", "sol-luna-2", "sol-luna-3", "sol-fork-2"];
const TRANSPORTS = new Set(["session", "independent", "packet"]);

test("레지스트리 불변식: id 유일·v2 단계 모양·transport·모델 allowlist", () => {
  assert.deepEqual(NP.ids(), IDS);
  for (const id of NP.ids()) {
    const p = NP.get(id);
    assert.equal(p.id, id, `${id}: 키와 id가 같아야 한다`);
    assert.ok(["independent", "session", "v2"].includes(p.family), `${id}: 알 수 없는 family`);
    assert.ok(p.session === null || p.session === "chain" || p.session === "fork", `${id}: 알 수 없는 session`);
    if (p.family === "independent") assert.equal(p.session, null, `${id}: independent 는 세션 없음`);
    if (p.family === "v2") {
      assert.ok(p.stages.editorial && p.stages.review, `${id}: v2 는 editorial·review 단계를 갖는다`);
      assert.ok(!p.stages.section && !p.stages.link, `${id}: v2 에는 section·link 가 없다`);
    }
    for (const [stage, s] of Object.entries(p.stages)) {
      assert.ok(TRANSPORTS.has(s.transport), `${id}.${stage}: 알 수 없는 transport ${s.transport}`);
      assert.ok(Object.hasOwn(LLM.MODELS, s.model), `${id}.${stage}: 모델 ${s.model} 이 서버 MODELS 에 없다`);
    }
    assert.ok(Object.hasOwn(LLM.MODELS, p.clientModels.plan) && Object.hasOwn(LLM.MODELS, p.clientModels.write), `${id}: clientModels 가 서버 MODELS 밖이다`);
  }
});

// ── 동치: 리팩터 전 하드코딩 값을 그대로 옮긴 기대 표 ──
// offscreen.js noteModels 의 모드별 결과(PLAN·WRITE). writeAlt는 일곱 모드 다 null.
const EXPECT_CLIENT = {
  "independent": { plan: SOL, write: LUNA }, "sol-session": { plan: SOL, write: SOL }, "sol-luna-tool": { plan: SOL, write: SOL },
  "sol-fork": { plan: SOL, write: SOL }, "sol-luna-2": { plan: SOL, write: LUNA }, "sol-luna-3": { plan: SOL, write: LUNA },
  "sol-fork-2": { plan: SOL, write: SOL },
};
// stages.js STAGE_MODEL + modelFor 의 실제 응답(v2 표 7단계 + 비-v2 는 plan=clientModels.plan, 나머지=write).
const V2_STAGES = ["plan", "editorial", "draft", "questions", "review", "global", "repair"];
const EXPECT_STAGE = {
  "independent": { plan: SOL, section: LUNA, draft: LUNA, repair: LUNA, global: LUNA, link: LUNA, questions: LUNA },
  "sol-session": { plan: SOL, section: SOL, draft: SOL, repair: SOL, global: SOL, link: SOL, questions: SOL },
  "sol-luna-tool": { plan: SOL, section: SOL, draft: SOL, repair: SOL, global: SOL, link: SOL, questions: SOL },
  "sol-fork": { plan: SOL, section: SOL, draft: SOL, repair: SOL, global: SOL, link: SOL, questions: SOL },
  "sol-luna-2": { plan: SOL, editorial: SOL, draft: LUNA, questions: LUNA, review: SOL, global: SOL, repair: SOL },
  "sol-luna-3": { plan: SOL, editorial: SOL, draft: LUNA, questions: LUNA, review: SOL, global: SOL, repair: SOL },
  "sol-fork-2": { plan: SOL, editorial: SOL, draft: SOL, questions: SOL, review: SOL, global: SOL, repair: SOL },
};

test("동치: clientModels 와 stageModel 이 리팩터 전 값을 돌려준다", () => {
  for (const id of IDS) {
    assert.deepEqual(NP.get(id).clientModels, EXPECT_CLIENT[id], `${id} clientModels`);
    for (const [stage, model] of Object.entries(EXPECT_STAGE[id])) assert.equal(NP.stageModel(id, stage), model, `${id}.${stage}`);
    // 리팩터 전 비-v2 의 modelFor 는 모든 작성 단계에 write 모델, 계획에 plan 모델을 돌렸다.
    if (NP.get(id).family !== "v2") {
      for (const stage of [...V2_STAGES, "bogus-stage"]) {
        const want = stage === "plan" ? EXPECT_CLIENT[id].plan : EXPECT_CLIENT[id].write;
        assert.equal(NP.stageModel(id, stage), want, `${id}.${stage} 비-v2 폴백`);
      }
    }
  }
  assert.equal(NP.stageModel("bogus-mode", "plan"), null, "모르는 모드는 null — 호출부가 거절한다");
});

// 리팩터 전 server/index.js 656-670행의 허용 판정을 그대로 다시 쓴다 — 기대값 대조용(파생 코드가 아니다).
const oldAccept = (v2, stage, { hasSession, hasPacket, model, sessionMode = v2 }) => {
  if (!v2) return !(stage === "review" || stage === "editorial");
  const v2Sol = { "sol-luna-2": ["plan", "editorial", "review", "global", "repair"], "sol-luna-3": ["plan", "editorial", "review", "global", "repair"], "sol-fork-2": ["plan", "editorial", "draft", "questions", "review", "global", "repair"] }[v2] || [];
  const lunaStage = (v2 === "sol-luna-2" || v2 === "sol-luna-3") && (stage === "draft" || stage === "questions");
  const packetStage = v2 === "sol-luna-3" && stage === "repair" && !hasSession;
  if (lunaStage) return model === LUNA && !hasSession;
  if (packetStage) return model === SOL && hasPacket;
  return v2Sol.includes(stage) && model === SOL && hasSession && sessionMode === v2 && !(v2 === "sol-luna-3" && stage === "repair" && hasPacket);
};
// server/index.js 의 새 분기와 같은 조합: serverRoute 의 ok·model·transport 를 그대로 적용한다.
const newAccept = (v2, stage, { hasSession, hasPacket, model, sessionMode = v2 }) => {
  if (!v2) return !(stage === "review" || stage === "editorial");
  const r = NP.serverRoute(v2, stage, { hasSession, hasPacket });
  return r.ok && model === r.model && (r.transport !== "session" || sessionMode === v2);
};

test("동치: 서버 허용/거절 판정 매트릭스(v2 모드 × stage × hasSession × hasPacket × model × sessionMode)", () => {
  const stages = [...V2_STAGES, "section", "link", "bogus"];
  const models = [SOL, LUNA, "xiaomi/mimo-v2.6-flash"];
  for (const v2 of ["sol-luna-2", "sol-luna-3", "sol-fork-2"])
    for (const stage of stages)
      for (const hasSession of [false, true])
        for (const hasPacket of [false, true])
          for (const model of models)
            for (const sessionMode of [v2, "sol-fork-2"]) {
              const io = { hasSession, hasPacket, model, sessionMode };
              assert.equal(newAccept(v2, stage, io), oldAccept(v2, stage, io),
                `${v2} stage=${stage} session=${hasSession} packet=${hasPacket} model=${model} sessionMode=${sessionMode}`);
            }
});

test("동치: NoteV3 공개 API 는 레지스트리에서 파생한다", () => {
  assert.equal(NoteV3.isV3("sol-luna-3"), true);
  for (const id of IDS) assert.equal(NoteV3.isV3(id), id === "sol-luna-3", `isV3 ${id}`);
  assert.equal(NoteV3.isLunaV2("sol-luna-2"), true);
  assert.equal(NoteV3.isLunaV2("sol-luna-3"), true);
  assert.equal(NoteV3.isLunaV2("sol-fork-2"), false);
  assert.equal(NoteV3.isLunaV2("independent"), false);
  assert.deepEqual(NoteV3.v3Options(), { repair: "packet", resume: false });
  assert.deepEqual(NoteV3.v3Options({ repair: "full-p", resume: true, bogus: 1 }), { repair: "full-p", resume: true });
  assert.deepEqual(NoteV3.v3Options(null), { repair: "packet", resume: false });
});

test("확장성: 표에 프로파일 하나를 얹으면 클라이언트 stageModel 과 서버 serverRoute 가 같은 답을 낸다", () => {
  // 테스트 전용 가짜 프로파일 — draft·questions 는 다른 모델의 독립 호출인 v2 변형.
  const HAIKU = "anthropic/claude-haiku-4.5";
  const fake = {
    id: "mis-sol-hai", family: "v2", session: "fork", clientModels: { plan: SOL, write: HAIKU }, options: null,
    stages: {
      plan: { model: SOL, transport: "session" }, editorial: { model: SOL, transport: "session" },
      draft: { model: HAIKU, transport: "independent" }, questions: { model: HAIKU, transport: "independent" },
      review: { model: SOL, transport: "session" }, global: { model: SOL, transport: "session" }, repair: { model: SOL, transport: "session" },
    },
  };
  const extra = NP.withProfiles({ "mis-sol-hai": fake });
  assert.equal(NP.get("mis-sol-hai"), null, "withProfiles 는 전역 표를 바꾸지 않는다");
  for (const [stage, s] of Object.entries(fake.stages)) {
    assert.equal(extra.stageModel("mis-sol-hai", stage), s.model, `stageModel mis-sol-hai.${stage}`);
    const route = extra.serverRoute("mis-sol-hai", stage, { hasSession: s.transport === "session" });
    assert.equal(route.ok, true, `serverRoute mis-sol-hai.${stage} 허용`);
    assert.equal(route.model, s.model, `serverRoute mis-sol-hai.${stage} 모델`);
    assert.equal(route.model, extra.stageModel("mis-sol-hai", stage), `클라이언트·서버가 같은 모델: ${stage}`);
    // 독립 단계에 봉투를 싣거나 세션 단계에 봉투가 없으면 거절 — 클라이언트 표와 같은 계약.
    assert.equal(extra.serverRoute("mis-sol-hai", stage, { hasSession: s.transport !== "session" }).ok, false, `serverRoute mis-sol-hai.${stage} 거절`);
  }
  assert.equal(extra.isLunaV2("mis-sol-hai"), true, "draft/questions 독립 호출인 v2 는 Luna 계열로 읽힌다");
});
