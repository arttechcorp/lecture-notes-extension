// lib/admin-compare.test.js — admin-view.js(비교 화면 순수 로직) 테스트
const test = require("node:test");
const assert = require("node:assert/strict");
const AdminView = require("./admin-view.js");

test("extractClaims: extracts recursive claims with unique claimIds", () => {
  const content = {
    overview: { text: "첫 번째 주장", evidenceIds: ["U1.s1"], basis: "lecture" },
    items: [
      { text: "두 번째 주장", evidenceIds: ["U1.t1", "U1.s1"], basis: "lecture" },
      { other: "비주장", sub: { text: "세 번째 주장", evidenceIds: ["U2.s2"], basis: "synthetic" } },
    ],
  };
  const claims = AdminView.extractClaims(content, "S1_B1");
  assert.equal(claims.length, 3);
  assert.equal(claims[0].claimId, "S1_B1#/overview");
  assert.equal(claims[0].text, "첫 번째 주장");
  assert.deepEqual(claims[0].evidenceIds, ["U1.s1"]);
  assert.equal(claims[1].claimId, "S1_B1#/items/0");
  assert.equal(claims[2].claimId, "S1_B1#/items/1/sub");
  assert.equal(claims[2].basis, "synthetic");
});

test("inferClaimStatus: prioritizes T1 claim.status if present", () => {
  const statuses = ["kept", "fixed", "relinked", "pending", "direct", "collateral", "cascade", "unjudged"];
  for (const st of statuses) {
    const claim = { claimId: "C1", text: "테스트", status: st };
    assert.equal(AdminView.inferClaimStatus(claim, {}), st);
  }
});

test("inferClaimStatus: infers kept, fixed, relinked for surviving blocks", () => {
  const finalNote = {
    sections: [
      {
        sectionId: "S1",
        blocks: [
          {
            id: "S1_B1",
            envelope: {
              content: {
                item: { text: "유지 주장", evidenceIds: ["U1.s1"], basis: "lecture" },
              },
            },
          },
          {
            id: "S1_B2",
            envelope: {
              content: {
                item: { text: "수정 주장", evidenceIds: ["U1.s1"], basis: "lecture" },
              },
            },
          },
          {
            id: "S1_B3",
            envelope: {
              content: {
                item: { text: "재연결 주장", evidenceIds: ["U2.s2"], basis: "lecture" },
              },
            },
          },
        ],
      },
    ],
  };

  // 1. kept
  const c1 = { blockId: "S1_B1", text: "유지 주장", evidenceIds: ["U1.s1"] };
  assert.equal(AdminView.inferClaimStatus(c1, { finalNote }), "kept");

  // 2. fixed (repaired)
  const c2 = { blockId: "S1_B2", text: "수정 주장", evidenceIds: ["U1.s1"] };
  assert.equal(AdminView.inferClaimStatus(c2, { finalNote, repairs: [{ blockId: "S1_B2", ok: true }] }), "fixed");

  // 3. relinked
  const c3 = { blockId: "S1_B3", text: "재연결 주장", evidenceIds: ["U1.s1"] };
  assert.equal(AdminView.inferClaimStatus(c3, { finalNote }), "relinked");
});

test("inferClaimStatus: infers direct, collateral, cascade for dropped/pruned blocks", () => {
  const droppedBlocks = [
    { blockId: "S1_B1", codes: ["VAL_NUMBER_MISSING"], cause: "direct" },
    { blockId: "S1_B2", codes: ["VAL_TARGET_DROPPED"], cause: "cascade" },
  ];
  const prunedItems = [{ id: "S1_B3/Q1", codes: ["NOTE_REVIEW_DROPPED"], cause: "cascade" }];

  // 저점수로 직접 떨어진 경우: direct
  const cDirect = { claimId: "c1", blockId: "S1_B1", text: "직접 원인 주장" };
  const supportScores = { c1: 0.2 };
  assert.equal(AdminView.inferClaimStatus(cDirect, { droppedBlocks, supportScores }), "direct");

  // 블록은 떨어졌으나 본 주장의 점수는 양호한 경우: collateral
  const cCollateral = { claimId: "c2", blockId: "S1_B1", text: "동반 손실 주장" };
  supportScores.c2 = 0.9;
  assert.equal(AdminView.inferClaimStatus(cCollateral, { droppedBlocks, supportScores }), "collateral");

  // 의존성 연쇄로 블록이 빠진 경우: cascade
  const cCascade = { claimId: "c3", blockId: "S1_B2", text: "연쇄 탈락 주장" };
  assert.equal(AdminView.inferClaimStatus(cCascade, { droppedBlocks }), "cascade");

  // pruned 항목에 포함된 경우: cascade
  const cPruned = { claimId: "c4", blockId: "S1_B3", text: "pruned 문항 주장" };
  assert.equal(AdminView.inferClaimStatus(cPruned, { prunedItems }), "cascade");
});

test("calculateComparisonMetrics: correctly calculates judge_low_rate and collateral_loss_rate", () => {
  const claims = [
    { claimId: "c1", status: "kept" },
    { claimId: "c2", status: "fixed" },
    { claimId: "c3", status: "collateral" },
    { claimId: "c4", status: "cascade" },
    { claimId: "c4", status: "cascade" }, // 중복 claimId는 1번만 집계
    { claimId: "c5", status: "direct" },
  ];
  const supportScores = {
    c1: 0.9,
    c2: 0.8,
    c3: 0.7,
    c5: 0.2, // low (< 0.5)
  };
  const repairs = [
    { blockId: "S1_B1", ok: true },
    { blockId: "S1_B2", ok: false, failed: true },
  ];

  const metrics = AdminView.calculateComparisonMetrics({ claims, supportScores, repairs });
  // judge_low_rate = 1 / 4 = 0.25
  assert.equal(metrics.judge_low_rate, 0.25);
  assert.equal(metrics.initialJudged, 4);
  assert.equal(metrics.initialLow, 1);

  // total draft unique claims: 5 (c1, c2, c3, c4, c5)
  // collateral or cascade: 2 (c3, c4)
  // collateral_loss_rate = 2 / 5 = 0.4
  assert.equal(metrics.totalDraftClaims, 5);
  assert.equal(metrics.collateralClaims, 2);
  assert.equal(metrics.collateral_loss_rate, 0.4);

  assert.equal(metrics.repairStats.attempted, 2);
  assert.equal(metrics.repairStats.accepted, 1);
  assert.equal(metrics.repairStats.networkFailed, 1);
});

test("filterEvidenceForClaim: filters by evidenceIds or returns empty", () => {
  const evidence = [
    { id: "U1.s1", text: "슬라이드 1" },
    { id: "U1.t1", text: "발화 1" },
    { id: "U2.s2", text: "슬라이드 2" },
  ];
  // 1. 특정 주장 선택
  const filtered = AdminView.filterEvidenceForClaim(evidence, { evidenceIds: ["U1.s1", "U2.s2"] });
  assert.deepEqual(filtered.map(e => e.id), ["U1.s1", "U2.s2"]);

  // 2. 근거 없는 주장 선택
  assert.deepEqual(AdminView.filterEvidenceForClaim(evidence, { evidenceIds: [] }), []);

  // 3. 미선택 시 전체
  assert.equal(AdminView.filterEvidenceForClaim(evidence, null).length, 3);
});

test("buildComparisonModel: requires writing draft cache, else shows '새 실행 필요'", () => {
  // 초안 캐시 없는 경우
  const resNoDraft = AdminView.buildComparisonModel({
    evidence: [{ id: "U1.s1" }],
    finalNote: { noteSpecVersion: "lecture-note-2" },
  });
  assert.equal(resNoDraft.available, false);
  assert.equal(resNoDraft.reason, "새 실행 필요");

  // 초안 캐시 있는 경우
  const draft = {
    sections: [
      {
        sectionId: "S1",
        output: {
          title: "섹션 1",
          blocks: {
            S1_B1: {
              id: "S1_B1",
              type: "B01",
              content: { item: { text: "초안 주장 1", evidenceIds: ["U1.s1"], basis: "lecture" } },
            },
          },
        },
      },
    ],
    failed: [],
  };
  const finalNote = {
    sections: [
      {
        sectionId: "S1",
        blocks: [{ id: "S1_B1", envelope: { content: { item: { text: "초안 주장 1", evidenceIds: ["U1.s1"], basis: "lecture" } } } }],
      },
    ],
    dropped: [],
    pruned: [],
  };

  const resWithDraft = AdminView.buildComparisonModel({
    evidence: [{ id: "U1.s1", text: "근거 1" }],
    draft,
    finalNote,
  });
  assert.equal(resWithDraft.available, true);
  assert.equal(resWithDraft.draft.sections.length, 1);
  assert.equal(resWithDraft.claims.length, 1);
  assert.equal(resWithDraft.claims[0].status, "kept");
  assert.equal(resWithDraft.claims[0].statusLabel, "유지");
  assert.equal(resWithDraft.metrics.totalDraftClaims, 1);
});
