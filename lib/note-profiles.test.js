// 노트 실험 프로파일 레지스트리(lib/note-profiles.js) 검증:
// 1) 표 불변식 2) 7개 모드의 파생 결과 = 리팩터 전 하드코딩 값(기대값은 이 파일에 리터럴로 둔다) 3) 프로파일 추가 = 표 한 줄.
const test = require("node:test"), assert = require("node:assert/strict");
const NP = require("./note-profiles.js");
const NoteV3 = require("./note-v3.js");
const LLM = require("../server/llm.js");

const SOL = "openai/gpt-6.1-sol", LUNA = "openai/gpt-6-luna@high", LUNA_M = "openai/gpt-6-luna@medium", HAIKU = "anthropic/claude-haiku-5.5";
const IDS = ["independent", "sol-session", "sol-luna-tool", "sol-fork", "sol-luna-2", "sol-luna-3", "sol-fork-2", "mis-sol-hai", "mis-luna-legacy-medium", "mis-luna-legacy-high"];
const TRANSPORTS = new Set(["session", "independent", "packet", "dual"]);

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
      if (s.transport === "dual") assert.ok(Object.hasOwn(LLM.MODELS, s.alt), `${id}.${stage}: 독립 경로 모델 ${s.alt} 이 서버 MODELS 에 없다`);
    }
    assert.ok(Object.hasOwn(LLM.MODELS, p.clientModels.plan) && Object.hasOwn(LLM.MODELS, p.clientModels.write), `${id}: clientModels 가 서버 MODELS 밖이다`);
  }
});

// ── 동치: 리팩터 전 하드코딩 값을 그대로 옮긴 기대 표 ──
// offscreen.js noteModels 의 모드별 결과(PLAN·WRITE). writeAlt는 여덟 모드 다 null.
const EXPECT_CLIENT = {
  "independent": { plan: SOL, write: LUNA }, "sol-session": { plan: SOL, write: SOL }, "sol-luna-tool": { plan: SOL, write: SOL },
  "sol-fork": { plan: SOL, write: SOL }, "sol-luna-2": { plan: SOL, write: LUNA }, "sol-luna-3": { plan: SOL, write: LUNA },
  "sol-fork-2": { plan: SOL, write: SOL }, "mis-sol-hai": { plan: SOL, write: HAIKU },
  "mis-luna-legacy-medium": { plan: LUNA_M, write: LUNA_M }, "mis-luna-legacy-high": { plan: LUNA, write: LUNA },
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
  // mis-sol-hai(기획 D9): 계획·편집·검수·전역·수리는 Sol 세션(Liner), 초안·문항은 Haiku 5.5 독립 호출(OpenRouter).
  "mis-sol-hai": { plan: SOL, editorial: SOL, draft: HAIKU, questions: HAIKU, review: SOL, global: SOL, repair: SOL },
  // mis-luna(legacy): mis-sol-hai 와 같은 경로 — 전 단계·양쪽 수리가 Luna 한 모델(effort 만 다르다).
  "mis-luna-legacy-medium": { plan: LUNA_M, editorial: LUNA_M, draft: LUNA_M, questions: LUNA_M, review: LUNA_M, global: LUNA_M, repair: LUNA_M },
  "mis-luna-legacy-high": { plan: LUNA, editorial: LUNA, draft: LUNA, questions: LUNA, review: LUNA, global: LUNA, repair: LUNA },
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
  const FAKE_W = "anthropic/claude-haiku-4.5";
  const fake = {
    id: "x-probe", family: "v2", session: "fork", clientModels: { plan: SOL, write: FAKE_W }, options: null,
    stages: {
      plan: { model: SOL, transport: "session" }, editorial: { model: SOL, transport: "session" },
      draft: { model: FAKE_W, transport: "independent" }, questions: { model: FAKE_W, transport: "independent" },
      review: { model: SOL, transport: "session" }, global: { model: SOL, transport: "session" }, repair: { model: SOL, transport: "session" },
    },
  };
  const extra = NP.withProfiles({ "x-probe": fake });
  assert.equal(NP.get("x-probe"), null, "withProfiles 는 전역 표를 바꾸지 않는다");
  for (const [stage, s] of Object.entries(fake.stages)) {
    assert.equal(extra.stageModel("x-probe", stage), s.model, `stageModel x-probe.${stage}`);
    const route = extra.serverRoute("x-probe", stage, { hasSession: s.transport === "session" });
    assert.equal(route.ok, true, `serverRoute x-probe.${stage} 허용`);
    assert.equal(route.model, s.model, `serverRoute x-probe.${stage} 모델`);
    assert.equal(route.model, extra.stageModel("x-probe", stage), `클라이언트·서버가 같은 모델: ${stage}`);
    // 독립 단계에 봉투를 싣거나 세션 단계에 봉투가 없으면 거절 — 클라이언트 표와 같은 계약.
    assert.equal(extra.serverRoute("x-probe", stage, { hasSession: s.transport !== "session" }).ok, false, `serverRoute x-probe.${stage} 거절`);
  }
  assert.equal(extra.isLunaV2("x-probe"), true, "draft/questions 독립 호출인 v2 는 Luna 계열로 읽힌다");
});

// mis-sol-hai(기획 §3.2·§3.3·§4.4·§4.5, D9): 동치 표가 아니라 레인 명세를 직접 기대값으로 쓴다.
test("mis-sol-hai: Sol 세션 단계 + Haiku 독립 단계, vision·strict·prompts 표시", () => {
  const p = NP.get("mis-sol-hai");
  assert.equal(p.family, "v2");
  assert.equal(p.session, "fork");
  assert.equal(p.vision, "mistral-ocr-4-1", "슬라이드 인식은 Mistral OCR(L2)");
  assert.equal(p.prompts, "msh", "MSH 단계 지시 분기 표시");
  assert.equal(p.reviewInput, "html", "Sol 검수 입력은 축약 렌더 HTML(L6)");
  assert.equal(p.emphasisSignals, true, "plan 입력에 강조 신호 숫자·JEV 판정 끔(L3)");
  assert.equal(p.options, null, "실험 옵션 없음 — isV3 가 아니다");
  assert.equal(NoteV3.isV3("mis-sol-hai"), false);
  assert.equal(NP.isLunaV2("mis-sol-hai"), true, "draft·questions 독립 호출 경로(Luna 계열과 같은 전송 모양)");
  const SESSION = ["plan", "editorial", "review", "global"], INDEP = ["draft", "questions"];
  for (const stage of SESSION) {
    const r = NP.serverRoute("mis-sol-hai", stage, { hasSession: true });
    assert.deepEqual([r.ok, r.model, r.transport], [true, SOL, "session"], stage);
    assert.equal(NP.serverRoute("mis-sol-hai", stage, { hasSession: false }).ok, false, stage + ": 봉투 없는 세션 단계 거절");
  }
  for (const stage of INDEP) {
    const r = NP.serverRoute("mis-sol-hai", stage, { hasSession: false });
    assert.deepEqual([r.ok, r.model, r.transport], [true, HAIKU, "independent"], stage);
    assert.equal(NP.serverRoute("mis-sol-hai", stage, { hasSession: true }).ok, false, stage + ": 봉투 실은 독립 단계 거절");
  }
  // repair 는 이중 경로(transport "dual"): 봉투가 실리면 Sol 세션, 없으면 Haiku 독립 — 봉투+packet 은 거절.
  assert.deepEqual((r => [r.ok, r.model, r.transport])(NP.serverRoute("mis-sol-hai", "repair", { hasSession: true })), [true, SOL, "session"], "repair: 세션 경로는 Sol");
  assert.deepEqual((r => [r.ok, r.model, r.transport])(NP.serverRoute("mis-sol-hai", "repair", { hasSession: false })), [true, HAIKU, "independent"], "repair: 봉투 없으면 Haiku 독립(L6 재작성)");
  assert.equal(NP.serverRoute("mis-sol-hai", "repair", { hasSession: true, hasPacket: true }).ok, false, "repair: 봉투+packet 거절");
  assert.equal(NP.stageModel("mis-sol-hai", "repair"), SOL, "stageModel 은 세션 경로 모델");
  assert.equal(p.stages.editorial.strict, true, "editorial 은 Liner strict json_schema");
  assert.equal(p.stages.review.strict, true, "review 는 Liner strict json_schema");
  assert.ok(![...INDEP, "plan", "global", "repair"].some(s => p.stages[s].strict), "strict 는 editorial·review 뿐");
});

// mis-luna(legacy)(기획 mis-luna-legacy-plan-2026-10-11): mis-sol-hai 와 id·모델·reasoningBudget 만 다르고
// 인식·지면·검수·세션·transport 모양은 같아야 한다 — 비교군으로서의 동치는 필드 parity 로 검증한다.
test("mis-luna-legacy-medium·high: mis-sol-hai parity(id·모델 제외), 전 단계 Luna 단일 모델", () => {
  const base = NP.get("mis-sol-hai");
  for (const [id, luna] of [["mis-luna-legacy-medium", LUNA_M], ["mis-luna-legacy-high", LUNA]]) {
    const p = NP.get(id);
    assert.ok(p, id + " 등록");
    // parity: id·clientModels·stages(모델)·reasoningBudget 을 뺀 나머지 칸은 mis-sol-hai 와 같다.
    for (const k of ["family", "session", "vision", "visionLanes", "prompts", "reviewInput", "emphasisSignals", "lastFrame", "options"])
      assert.deepEqual(p[k], base[k], `${id}.${k} parity`);
    assert.equal(p.reasoningBudget, 8000, `${id}.reasoningBudget — medium 도 8000 으로 끌어올려 출력 상한을 맞춘다`);
    assert.equal(NoteV3.isV3(id), false);
    assert.equal(NP.isLunaV2(id), true, "draft·questions 독립 호출");
    // 전 단계·양쪽 수리가 선택된 effort 의 Luna 단일 모델 — Sol·Haiku 잔존 0.
    for (const [stage, s] of Object.entries(p.stages)) {
      assert.equal(s.model, luna, `${id}.${stage} 모델`);
      if (s.alt !== undefined) assert.equal(s.alt, luna, `${id}.${stage} alt 모델`);
      assert.deepEqual(s.transport, base.stages[stage].transport, `${id}.${stage} transport parity`);
      assert.equal(Boolean(s.strict), Boolean(base.stages[stage].strict), `${id}.${stage} strict parity`);
    }
    assert.deepEqual(p.clientModels, { plan: luna, write: luna }, `${id}.clientModels`);
    // 세션 단계는 봉투 필수·독립 단계는 봉투 금지, dual 수리는 세션·독립 양쪽 다 Luna.
    for (const stage of ["plan", "editorial", "review", "global"]) {
      assert.deepEqual((r => [r.ok, r.model])(NP.serverRoute(id, stage, { hasSession: true })), [true, luna], `${id}.${stage} 세션`);
      assert.equal(NP.serverRoute(id, stage, { hasSession: false }).ok, false, `${id}.${stage} 봉투 없으면 거절`);
    }
    for (const stage of ["draft", "questions"]) {
      assert.deepEqual((r => [r.ok, r.model])(NP.serverRoute(id, stage, { hasSession: false })), [true, luna], `${id}.${stage} 독립`);
      assert.equal(NP.serverRoute(id, stage, { hasSession: true }).ok, false, `${id}.${stage} 봉투 실으면 거절`);
    }
    assert.deepEqual((r => [r.ok, r.model, r.transport])(NP.serverRoute(id, "repair", { hasSession: true })), [true, luna, "session"], `${id} repair 세션 경로`);
    assert.deepEqual((r => [r.ok, r.model, r.transport])(NP.serverRoute(id, "repair", { hasSession: false })), [true, luna, "independent"], `${id} repair 독립 경로`);
    assert.equal(NP.serverRoute(id, "repair", { hasSession: true, hasPacket: true }).ok, false, `${id} repair 봉투+packet 거절`);
    // 두 변형의 차이는 모델(@effort)뿐 — 나머지 프로파일 칸은 서로 같다.
    const other = NP.get(id === "mis-luna-legacy-medium" ? "mis-luna-legacy-high" : "mis-luna-legacy-medium");
    const strip = x => { const { id: _i, ...rest } = x; return rest; };
    assert.deepEqual(Object.keys(strip(p)), Object.keys(strip(other)), `${id} 키 parity`);
    for (const k of Object.keys(strip(p))) if (k !== "clientModels" && k !== "stages") assert.deepEqual(p[k], other[k], `${id} vs 변형 ${k}`);
    for (const stage of Object.keys(p.stages)) {
      assert.deepEqual(p.stages[stage].transport, other.stages[stage].transport, `변형 ${stage} transport`);
      assert.equal(Boolean(p.stages[stage].strict), Boolean(other.stages[stage].strict), `변형 ${stage} strict`);
    }
  }
});
