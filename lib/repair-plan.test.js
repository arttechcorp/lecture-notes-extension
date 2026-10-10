const test = require("node:test");
const assert = require("node:assert/strict");
const RepairPlan = require("./repair-plan.js");

const {
  classifyFailure,
  signatureOf,
  RepairBudget,
  nextRepairStep,
  metricsOf,
  normalizeTableShape,
  CAUSES,
  UNITS,
  ACTIONS,
} = RepairPlan;

test("classifyFailure: classifies all 7 causes accurately", () => {
  // 1. no_evidence
  assert.deepEqual(
    classifyFailure({ blockId: "S1_B1", nullReason: "insufficient_evidence" }),
    { cause: "no_evidence", unit: "block", target: "S1_B1" }
  );
  assert.deepEqual(
    classifyFailure({ blockId: "S1_B1", errors: [{ code: "VAL_EVIDENCE_MISSING" }] }),
    { cause: "no_evidence", unit: "block", target: "S1_B1" }
  );

  // 2. writer_null
  assert.deepEqual(
    classifyFailure({ blockId: "S1_B2", envelope: null, errors: [{ code: "VAL_BLOCK_DECLINED" }] }),
    { cause: "writer_null", unit: "block", target: "S1_B2" }
  );
  assert.deepEqual(
    classifyFailure({ blockId: "S1_B2", envelope: null, nullReason: "unknown" }),
    { cause: "writer_null", unit: "block", target: "S1_B2" }
  );

  // 3. policy
  assert.deepEqual(
    classifyFailure({ blockId: "S1_B3", errors: [{ code: "VAL_BASIS_POLICY" }] }),
    { cause: "policy", unit: "block", target: "S1_B3" }
  );
  assert.deepEqual(
    classifyFailure({ blockId: "S1_B3", nullReason: "policy" }),
    { cause: "policy", unit: "block", target: "S1_B3" }
  );

  // 4. schema_format
  assert.deepEqual(
    classifyFailure({ blockId: "S1_B4", errors: [{ code: "VAL_TABLE_SHAPE", detail: ["/content/criteria/0/cells"] }] }),
    { cause: "schema_format", unit: "block", target: "S1_B4" }
  );
  assert.deepEqual(
    classifyFailure({ blockId: "S1_B4", salvaged: { some: "data" } }),
    { cause: "schema_format", unit: "block", target: "S1_B4" }
  );

  // 5. t5_low
  assert.deepEqual(
    classifyFailure({ bid: "S1_B5", path: "/content/criteria/0/cells/0/claim", errors: [{ code: "VAL_SUPPORT_LOW" }] }),
    { cause: "t5_low", unit: "claim", target: "S1_B5#/content/criteria/0/cells/0/claim" }
  );
  assert.deepEqual(
    classifyFailure({ target: "c1", unit: "claim", score: 0.3 }),
    { cause: "t5_low", unit: "claim", target: "c1" }
  );

  // 6. root_loss
  assert.deepEqual(
    classifyFailure({ blockId: "S1_B6", root: "S1_B1", cause: "cascade" }),
    { cause: "root_loss", unit: "block", target: "S1_B6", root: "S1_B1" }
  );
  assert.deepEqual(
    classifyFailure({ blockId: "S1_B6", dependsOn: "S1_B1", errors: [{ code: "NOTE_DEPENDENCY_DROPPED" }] }),
    { cause: "root_loss", unit: "block", target: "S1_B6", root: "S1_B1" }
  );

  // 7. figure_missing
  assert.deepEqual(
    classifyFailure({ target: "FIG_01", kind: "figure", errors: [{ code: "NOTE_FIGURES_CHECK" }] }),
    { cause: "figure_missing", unit: "block", target: "FIG_01" }
  );
});

test("signatureOf: generates stable sorted string in memory without hashing", () => {
  assert.equal(signatureOf(null), "");
  assert.equal(signatureOf([]), "");

  const errs1 = [
    { code: "VAL_SCHEMA", detail: ["/content/title", "/content/name"] },
    { code: "VAL_REF_UNKNOWN", detail: ["F1"] },
  ];
  const errs2 = [
    { code: "VAL_REF_UNKNOWN", detail: ["F1"] },
    { code: "VAL_SCHEMA", detail: ["/content/name", "/content/title"] },
  ];

  const sig1 = signatureOf(errs1);
  const sig2 = signatureOf(errs2);
  assert.equal(sig1, sig2);
  assert.equal(sig1, "VAL_REF_UNKNOWN:F1;VAL_SCHEMA:/content/name,/content/title");
});

test("RepairBudget: tracks budget, enforces limits, records history and snapshot", () => {
  const budget = new RepairBudget({ maxUsd: 0.10, perTargetSemantic: 1, perCause: 1 });

  // 1. Initial attempt
  assert.equal(budget.canAttempt("S1_B1", "writer_null", 0.04), true);
  budget.record("S1_B1", "writer_null", { ok: false, usd: 0.04 });

  // 2. Per-cause and per-target semantic limit reached
  assert.equal(budget.canAttempt("S1_B1", "writer_null", 0.04), false);
  assert.equal(budget.canAttempt("S1_B1", "sol_repair", 0.04), false); // semantic limit = 1 reached

  // 3. Different target can still attempt if within USD limit
  assert.equal(budget.canAttempt("S1_B2", "schema_format", 0.04), true);
  budget.record("S1_B2", "schema_format", { ok: true, usd: 0.04 });

  // 4. Succeeded target cannot be re-attempted
  assert.equal(budget.canAttempt("S1_B2", "schema_format", 0.01), false);

  // 5. Exceeding maxUsd (spent = 0.08, max = 0.10, trying 0.03 -> 0.11 > 0.10)
  assert.equal(budget.canAttempt("S1_B3", "relink", 0.03), false);

  // 6. Snapshot reflects content-free numbers
  const snap = budget.snapshot();
  assert.equal(snap.maxUsd, 0.10);
  assert.equal(snap.spentUsd, 0.08);
  assert.equal(snap.remainingUsd.toFixed(2), "0.02");
  assert.equal(snap.attempts, 2);
  assert.equal(snap.successes, 1);
  assert.deepEqual(snap.successfulTargets, ["S1_B2"]);
  assert.equal(snap.costByCause.writer_null, 0.04);
  assert.equal(snap.costByCause.schema_format, 0.04);
});

test("nextRepairStep priority: core roots -> conditions/exceptions -> required visuals -> rest", () => {
  const candidates = [
    { target: "B_REST", errors: [{ code: "VAL_SCHEMA" }], role: "rest" },
    { target: "FIG_REQ", kind: "figure", required: true, errors: [{ code: "VAL_FIGURE" }] },
    { target: "B_COND", role: "condition", errors: [{ code: "VAL_SCHEMA" }] },
    { target: "B_CORE_ROOT", isCoreRoot: true, errors: [{ code: "VAL_SCHEMA" }] },
  ];

  // 1st step picks core root
  const step1 = nextRepairStep({ failures: candidates });
  assert.equal(step1.action, "code_normalize");
  assert.deepEqual(step1.targets, ["B_CORE_ROOT"]);

  // 2nd step (when core root is resolved) picks condition
  const step2 = nextRepairStep({
    failures: candidates,
    succeeded: ["B_CORE_ROOT"],
  });
  assert.equal(step2.action, "code_normalize");
  assert.deepEqual(step2.targets, ["B_COND"]);

  // 3rd step picks required visual
  const step3 = nextRepairStep({
    failures: candidates,
    succeeded: ["B_CORE_ROOT", "B_COND"],
  });
  assert.equal(step3.action, "code_normalize");
  assert.deepEqual(step3.targets, ["FIG_REQ"]);

  // 4th step picks rest
  const step4 = nextRepairStep({
    failures: candidates,
    succeeded: ["B_CORE_ROOT", "B_COND", "FIG_REQ"],
  });
  assert.equal(step4.action, "code_normalize");
  assert.deepEqual(step4.targets, ["B_REST"]);
});

// ── Spec 4.4 합성 Fixture 8종 테스트 ──────────────────────────────────────────

test("합성 fixture 1: writer-null with evidence rescued once", () => {
  const item = {
    blockId: "S1_B1",
    envelope: null,
    errors: [{ code: "VAL_BLOCK_DECLINED" }],
    hasEvidence: true,
  };
  const budget = new RepairBudget({ maxUsd: 1.0, perTargetSemantic: 1, perCause: 1 });

  // 1회 구제 시도: regenerate_missing
  const step1 = nextRepairStep({ failures: [item], budget });
  assert.equal(step1.action, "regenerate_missing");
  assert.deepEqual(step1.targets, ["S1_B1"]);

  // 구제 성공 기록
  budget.record("S1_B1", "writer_null", { ok: true, usd: 0.05 });

  // 2회차: 이미 성공하여 추가 호출 없이 종료
  const step2 = nextRepairStep({ failures: [item], budget });
  assert.equal(step2.action, "none");
  assert.deepEqual(step2.targets, []);
});

test("합성 fixture 2: null without evidence => no call", () => {
  const item = {
    blockId: "S1_B2",
    envelope: null,
    nullReason: "insufficient_evidence",
    hasEvidence: false,
  };
  const budget = new RepairBudget();

  const step = nextRepairStep({ failures: [item], budget });
  assert.equal(step.action, "none");
  assert.deepEqual(step.targets, []);
  assert.equal(step.reason, "no_evidence");
  assert.equal(budget.snapshot().attempts, 0); // 모델 호출 0회
});

test("합성 fixture 3: root recovered => children re-verified from original draft", () => {
  const originalDraft = {
    S1_B2: {
      claims: [
        { claimId: "c1", text: "Child claim 1", basis: "lecture", evidenceIds: ["E1"] },
        { claimId: "c2", text: "Child claim 2", basis: "lecture", evidenceIds: ["E2"] },
      ],
    },
  };

  const childItem = {
    blockId: "S1_B2",
    root: "S1_B1",
    cause: "root_loss",
    originalDraft: originalDraft.S1_B2,
  };

  // 선행 root S1_B1이 성공적으로 복구됨
  const step = nextRepairStep({
    failures: [childItem],
    rootStatus: { S1_B1: true },
  });

  assert.equal(step.action, "restore_dependents");
  assert.deepEqual(step.targets, ["S1_B2"]);

  // 원래 초안의 내용이 그대로 보존되어 재검증 가능함을 확인 (새 추측 없음)
  assert.equal(childItem.originalDraft.claims.length, 2);
  assert.equal(childItem.originalDraft.claims[0].claimId, "c1");
});

test("합성 fixture 4: root failed => children stay unconfirmed", () => {
  const childItem = {
    blockId: "S1_B2",
    root: "S1_B1",
    cause: "root_loss",
  };

  // 선행 root S1_B1 복구 실패 (미복구 상태)
  const step = nextRepairStep({
    failures: [childItem],
    rootStatus: { S1_B1: false },
  });

  // 종속 주장을 복구하거나 확정하지 않고 보류
  assert.equal(step.action, "none");
  assert.deepEqual(step.targets, []);
  assert.equal(step.reason, "root_unrecovered");
});

test("합성 fixture 5: table format fix keeps good claims", () => {
  // 표 B06에 비정상 cell 길이가 있으나 정상 주장 포함
  const tableContent = {
    entities: [{ name: "Entity A", conceptId: "C1" }, { name: "Entity B", conceptId: "C2" }],
    criteria: [
      {
        name: "Criterion 1",
        cells: [
          { claim: { text: "Good comparison A", basis: "lecture", evidenceIds: ["E1"] } },
          // ragged: entity는 2개인데 cell은 1개뿐
        ],
      },
      {
        name: "Empty Criterion",
        cells: [null, null], // 빈 행
      },
    ],
  };

  const item = {
    blockId: "S1_B06",
    errors: [{ code: "VAL_TABLE_SHAPE", detail: ["/content/criteria/0/cells"] }],
    content: tableContent,
  };

  const step = nextRepairStep({ failures: [item] });
  assert.equal(step.action, "code_normalize");
  assert.deepEqual(step.targets, ["S1_B06"]);

  // 코드 정규화 실행: 형태 맞춤 + 빈 행 정리 + 정상 주장 보존
  const normalized = normalizeTableShape(tableContent);
  assert.equal(normalized.criteria.length, 1);
  assert.equal(normalized.criteria[0].cells.length, 2);
  assert.equal(normalized.criteria[0].cells[0].claim.text, "Good comparison A");
  assert.equal(normalized.criteria[0].cells[1], null);
});

test("합성 fixture 6: relink success => 0 rewrites", () => {
  const claimItem = {
    target: "S1_B1#/content/criteria/0/cells/0/claim",
    cause: "t5_low",
  };

  // 1단계: relink 제안
  const step1 = nextRepairStep({ failures: [claimItem] });
  assert.equal(step1.action, "relink");

  // relink가 성공함
  const step2 = nextRepairStep({
    failures: [claimItem],
    relinked: [claimItem.target],
  });

  // relink 성공 후 추가 rewrite (t5_minimal_edit 등) 0회
  assert.equal(step2.action, "none");
  assert.deepEqual(step2.targets, []);
});

test("합성 fixture 7: repeated identical error => stop", () => {
  const item = {
    blockId: "S1_B1",
    errors: [{ code: "VAL_SCHEMA", detail: ["/content/title"] }],
    hasNewEvidence: false,
  };

  const sig = signatureOf(item.errors);

  // 이전 호출과 동일한 오류 서명이 들어오고 새 근거가 없으면 중단
  const step = nextRepairStep({
    failures: [item],
    signatures: { S1_B1: sig },
    hasNewEvidence: false,
  });

  assert.equal(step.action, "none");
  assert.deepEqual(step.targets, []);
  assert.equal(step.reason, "no_progress");
});

test("합성 fixture 8: review+T5 same target not duplicated", () => {
  // review 검수 단계에서 이미 복구된 대상 S1_B3
  const item = {
    target: "new_S1_B3",
    cause: "t5_low",
  };

  const step = nextRepairStep({
    failures: [item],
    reviewRecovered: ["S1_B3"],
    aliases: { new_S1_B3: "S1_B3" }, // 새 ID로 변형되어 재요청 시도
  });

  // 중복 복구 방지: 건너뜀
  assert.equal(step.action, "none");
  assert.deepEqual(step.targets, []);
});

test("metricsOf: counts unique targets, not events, separating attempts and successes", () => {
  const events = [
    // B01: 2회 시도 끝에 성공 (declined 및 root였음)
    { type: "eligible", target: "B01", cause: "writer_null" },
    { type: "attempt", target: "B01", cause: "writer_null", usd: 0.04 },
    { type: "attempt", target: "B01", cause: "writer_null", usd: 0.04 },
    { type: "succeeded", target: "B01", cause: "writer_null", wasDeclined: true, isRoot: true },

    // B02: 1회 시도 후 stillBad
    { type: "eligible", target: "B02", cause: "schema_format" },
    { type: "attempt", target: "B02", cause: "schema_format", usd: 0.02 },
    { type: "still_bad", target: "B02", cause: "schema_format" },

    // 건너뛴 대상들
    { type: "skipped_no_evidence", target: "B03" },
    { type: "skipped_budget", target: "B04" },
    { type: "stopped_no_progress", target: "B05" },

    // 복원된 종속 주장
    { type: "dependent_restored", target: "c10" },
    { type: "dependent_restored", target: "c11" },
  ];

  const m = metricsOf(events);

  // 이벤트가 아닌 고유 대상 단위 집계 확인
  assert.equal(m.repairEligible, 2); // B01, B02
  assert.equal(m.attempted, 2);      // B01, B02 (B01 2회 시도했으나 1개 대상)
  assert.equal(m.succeeded, 1);      // B01
  assert.equal(m.stillBad, 1);       // B02
  assert.equal(m.skippedNoEvidence, 1); // B03
  assert.equal(m.skippedBudget, 1);     // B04
  assert.equal(m.stoppedNoProgress, 1); // B05
  assert.equal(m.declinedRecovered, 1); // B01
  assert.equal(m.rootRecovered, 1);     // B01
  assert.equal(m.dependentClaimsRestored, 2); // c10, c11

  // 원인별 비용 합산
  assert.equal(m.costByCause.writer_null, 0.08);
  assert.equal(m.costByCause.schema_format, 0.02);
});

test("RepairBudget 실행 계약: reserve → commit 은 시도·비용·서명을 기록하고, rollback 은 시도를 쓰지 않는다", () => {
  const budget = new RepairBudget({ maxUsd: 0.10, perTargetSemantic: 2, perCause: 1 });

  // 예약이 끝나기 전에는 같은 대상의 병렬 호출이 상한·예약분까지 합쳐 막힌다
  const r1 = budget.reserveAttempt("S1_B1", "writer_null", 0.04);
  assert.ok(r1, "첫 예약");
  assert.equal(budget.reserveAttempt("S1_B1", "writer_null", 0.01), null, "원인별 상한이 예약분까지 센다");
  assert.equal(budget.canAttempt("S1_B2", "schema", 0.07), false, "예약 비용까지 합쳐 금액 상한을 본다");

  // commit — 실제 비용·서명·revision·개선 여부가 한 번에 들어간다
  budget.commit(r1, { ok: false, usd: 0.04, signature: "VAL_SCHEMA|/a", revision: 0 });
  assert.equal(budget.spentUsd, 0.04);
  assert.equal(budget.attemptsByTargetCause.get("S1_B1#writer_null"), 1);
  assert.equal(budget.signatures.get("S1_B1"), "VAL_SCHEMA|/a");
  assert.equal(budget.events.filter(e => e.type === "attempt").length, 1);
  assert.equal(budget.events.at(-1).type, "still_bad");

  // rollback — 전송 실패는 시도 횟수를 쓰지 않고 푼다(비용이 나간 것만 원장에 남긴다)
  const r2 = budget.reserveAttempt("S1_B2", "support", 0.02);
  budget.rollback(r2);
  assert.equal(budget.attemptsByTargetCause.get("S1_B2#support") ?? 0, 0, "롤백은 시도를 기록하지 않는다");
  assert.equal(budget.semanticAttemptsByTarget.get("S1_B2") ?? 0, 0);
  assert.equal(budget.reserveAttempt("S1_B2", "support", 0.02) !== null, true, "풀린 자리는 다시 쓸 수 있다");

  // 성공 기록은 성공 대상 집합과 declined 이벤트에 반영된다
  const r3 = budget.reserveAttempt("S1_B3", "writer_null", 0.02);
  budget.commit(r3, { ok: true, usd: 0.02 });
  assert.ok(budget.successfulTargets.has("S1_B3"));
  assert.equal(budget.events.at(-1).wasDeclined, true, "writer_null 성공은 declined 복구로 센다");
  assert.equal(budget.canAttempt("S1_B3", "schema", 0.01), false, "성공 대상은 다시 못 쓴다");
});

test("실행 계약 통합: 같은 오류 서명으로 두 번째 시도를 제어기가 막는다", () => {
  const budget = new RepairBudget({ maxUsd: 1, perTargetSemantic: 2, perCause: 2 });
  const item = { blockId: "S1_B1", errors: [{ code: "VAL_SCHEMA", detail: ["/content/title"] }] };

  // 1차: 후보 → 예약 → 실행 → 기록(서명 남김)
  let step = nextRepairStep({ failures: [item], budget, signatures: budget.signatures });
  assert.notEqual(step.action, "none");
  const r = budget.reserveAttempt(item.blockId, "schema", 0.05);
  assert.ok(r);
  budget.commit(r, { ok: false, usd: 0.05, signature: signatureOf(item.errors), revision: 0 });

  // 2차: 같은 오류가 다시 올라오면 서명이 같아서 새 근거 없이는 멈춘다(no_progress)
  step = nextRepairStep({ failures: [item], budget, signatures: budget.signatures });
  assert.equal(step.action, "none");
  assert.equal(step.reason, "no_progress");
});
