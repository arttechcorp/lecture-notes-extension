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

test("inferClaimStatus: pending 보존 목록은 보류로 본다", () => {
  // 블록째 보류(envelope 있음): 블록이 최종 노트에 없어도 dropped 가 아니라 pending
  const finalNote = {
    sections: [],
    pending: [{ blockId: "S1_B1", sectionId: "S1", type: "B05", paths: ["/content/definition"], claims: [], envelope: { content: {} } }],
  };
  const c = { claimId: "S1_B1#/content/definition", blockId: "S1_B1", path: "/content/definition", text: "보류 주장" };
  assert.equal(AdminView.inferClaimStatus(c, { finalNote }), "pending");

  // 주장 단위 보류(paths 만): 블록은 살았는데 이 주장만 빠짐 → pending
  const finalNote2 = {
    sections: [{
      sectionId: "S1",
      blocks: [{ id: "S1_B2", envelope: { content: { other: { text: "남은 주장", evidenceIds: ["U1"], basis: "lecture" } } } }],
    }],
    pending: [{ blockId: "S1_B2", sectionId: "S1", type: "B05", paths: ["/content/definition"], claims: [{ text: "뺀 주장" }], envelope: null }],
  };
  const c2 = { claimId: "S1_B2#/content/definition", blockId: "S1_B2", path: "/content/definition", text: "뺀 주장" };
  assert.equal(AdminView.inferClaimStatus(c2, { finalNote: finalNote2 }), "pending");
  const c3 = { claimId: "S1_B2#/content/examples/0", blockId: "S1_B2", path: "/content/examples/0", text: "다른 주장" };
  assert.equal(AdminView.inferClaimStatus(c3, { finalNote: finalNote2 }), "direct"); // pending 경로에 없으면 직접 보류
});

test("buildComparisonModel: validating 캐시의 support 맵으로 점수·결과를 붙인다", () => {
  const records = {
    "s:write": { value: { sections: [{ sectionId: "S1", output: { blocks: { S1_B1: { id: "S1_B1", type: "B05", content: { item: { text: "초안 주장", evidenceIds: ["U1"], basis: "lecture" } } } } } }], failed: [] } },
    "s:valid": { value: { note: { noteSpecVersion: "lecture-note-2", sections: [] }, support: { scores: { "S1_B1#/content/item": 0.31 }, outcomes: { "S1_B1#/content/item": "direct" } } } },
    "note": { noteSpecVersion: "lecture-note-2", sections: [{ sectionId: "S1", blocks: [] }], pending: [{ blockId: "S1_B1", paths: ["/content/item"], claims: [], envelope: {} }] },
  };
  const m = AdminView.buildComparisonModel({ records });
  assert.equal(m.available, true);
  const c = m.claims[0];
  assert.equal(c.claimId, "S1_B1#/content/item");
  assert.equal(c.score, 0.31);
  assert.equal(c.outcome, "direct");
  assert.equal(c.status, "direct"); // outcome 이 추론보다 정본
  assert.equal(c.type, "B05");
});

test("detectEvalPath: shadow/preserve/current_delete 추정", () => {
  assert.equal(AdminView.detectEvalPath({ input: { options: { judgeShadow: true } }, note: null }), "shadow");
  assert.equal(AdminView.detectEvalPath({ input: {}, note: { pending: [{ blockId: "B1" }] } }), "preserve");
  assert.equal(AdminView.detectEvalPath({ input: {}, note: { dropped: [{ blockId: "B1" }] } }), "current_delete");
});

test("jobForPackage: createdAt 을 덮는 작업만 고른다", () => {
  const jobs = [
    { jobId: "j-old", start: 1000, end: 2000 },
    { jobId: "j-hit", start: 3000, end: 9000, costUsd: 0.1, totalMs: 6000 },
    { jobId: "j-later", start: 20000, end: 30000 },
  ];
  assert.equal(AdminView.jobForPackage(jobs, "1970-01-01T00:00:05Z").jobId, "j-hit"); // 5s ∈ [3s, 9s+60s]
  assert.equal(AdminView.jobForPackage(jobs, "1970-01-01T00:01:40Z"), null); // 100s — 어떤 작업 창도 안 덮음
  assert.equal(AdminView.jobForPackage(jobs, null), null);
});

test("buildEvalExport: 실행 기록 형식 + 서버 전송 경로 없음", () => {
  const draft = {
    sections: [{ sectionId: "S1", output: { title: "섹션", blocks: { S1_B1: { id: "S1_B1", type: "B05", content: { item: { text: "주장", evidenceIds: ["U1"], basis: "lecture" } } } } } }],
    failed: [],
  };
  const model = AdminView.buildComparisonModel({
    evidence: [{ id: "U1", kind: "slide", unitId: "U1", text: "근거" }],
    draft,
    finalNote: { noteSpecVersion: "lecture-note-2", sections: [{ sectionId: "S1", blocks: [{ id: "S1_B1", envelope: { content: { item: { text: "주장", evidenceIds: ["U1"], basis: "lecture" } } } }] }] },
  });
  const out = AdminView.buildEvalExport(model, { packageId: "pkg1", path: "preserve", run: { jobId: "j1", costUsd: 0.02, ms: 1234 } });
  assert.equal(out.tool, "summrizei-eval-run");
  assert.equal(out.version, 1);
  assert.equal(out.lectureId, "pkg1"); // 기본값 = packageId
  assert.equal(out.path, "preserve");
  assert.equal(out.run.ms, 1234);
  assert.equal(out.claims.length, 1);
  assert.equal(out.claims[0].claimId, "S1_B1#/content/item");
  assert.equal(out.claims[0].status, "kept");
  assert.equal(out.claims[0].score, null);
  assert.equal(out.evidence[0].text, "근거");
  //보내기 객체 어디에도 서버 전송 경로 키가 없다 (키 이름 검사 — 값의 본문은 평문이어도 된다)
  const keys = [];
  const walk = v => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { keys.push(k); walk(x); }
  };
  walk(out);
  assert.ok(!keys.some(k => /url|uri|endpoint|server|upload|fetch|token|http/i.test(k)), "전송 경로 키가 없어야 한다: " + keys.join(","));
  assert.equal(AdminView.buildEvalExport({ available: false }), null);
});
