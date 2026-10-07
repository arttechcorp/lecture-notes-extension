// lib/admin-view-comparison.test.js — 비교 화면의 기록(records) 전용 지표 복원 테스트
// 암호화 기록만 불러와도 실시간 메모리 경로와 같은 주장 점수·복구 분모가 나와야 한다(후속 검토 §4).
// 합성 fixture 만 쓰며 강의 본문·식별자는 없다.
const test = require("node:test");
const assert = require("node:assert/strict");
const AdminView = require("./admin-view.js");

const DRAFT = {
  sections: [{
    sectionId: "S1",
    output: {
      title: "섹션 1",
      blocks: {
        S1_B1: { id: "S1_B1", type: "B05", content: { item: { text: "재연결된 주장", evidenceIds: ["U1"], basis: "lecture" } } },
        S1_B2: { id: "S1_B2", type: "B01", content: { item: { text: "보류된 주장", evidenceIds: ["U2"], basis: "lecture" } } },
        S1_B3: { id: "S1_B3", type: "B01", content: { item: { text: "통과 주장", evidenceIds: ["U3"], basis: "lecture" } } },
      },
    },
  }],
  failed: [],
};

const FINAL_NOTE = {
  noteSpecVersion: "lecture-note-2",
  sections: [{
    sectionId: "S1",
    blocks: [
      { id: "S1_B1", envelope: { content: { item: { text: "재연결된 주장", evidenceIds: ["U1", "U9"], basis: "lecture" } } } },
      { id: "S1_B3", envelope: { content: { item: { text: "통과 주장", evidenceIds: ["U3"], basis: "lecture" } } } },
    ],
  }],
  pending: [{ blockId: "S1_B2", sectionId: "S1", type: "B01", paths: ["/content/item"], claims: [{ text: "보류된 주장" }], envelope: null }],
};

// validating 단계 캐시가 남기는 support 맵(stages.js): scores=주장별 첫 점수, outcomes=주장별 최종 결과.
const SUPPORT = {
  scores: { "S1_B1#/content/item": 0.31, "S1_B2#/content/item": 0.12, "S1_B3#/content/item": 0.88 },
  outcomes: { "S1_B1#/content/item": "relinked", "S1_B2#/content/item": "direct", "S1_B3#/content/item": "kept" },
};

const RECORDS = { "s:write": { value: DRAFT }, "s:valid": { value: { note: FINAL_NOTE, support: SUPPORT } }, note: FINAL_NOTE };

test("buildComparisonModel: 암호화 기록만으로 지지 점수·결과·복구 필요를 복원한다", () => {
  // supportScores·repairs 메모리 입력 없이 records 만 넘긴다 — 실제 비교 탭 호출과 같다.
  const m = AdminView.buildComparisonModel({ records: RECORDS });
  assert.equal(m.available, true);
  assert.equal(m.claims.length, 3);

  const byId = Object.fromEntries(m.claims.map(c => [c.claimId, c]));
  assert.equal(byId["S1_B1#/content/item"].score, 0.31);
  assert.equal(byId["S1_B1#/content/item"].outcome, "relinked");
  assert.equal(byId["S1_B1#/content/item"].status, "relinked");
  assert.equal(byId["S1_B2#/content/item"].status, "direct");
  assert.equal(byId["S1_B3#/content/item"].status, "kept");

  // judge_low_rate = 기록 점수의 low/judged — 분모는 이 초안에서 실제 점수가 있는 주장 수
  assert.equal(m.metrics.initialJudged, 3);
  assert.equal(m.metrics.initialLow, 2);
  assert.equal(m.metrics.judge_low_rate, 0.6667);

  // 복구: 수락(relinked 1건)은 기록에서 복원되지만 실제 시도는 기록에 없다 — 예산 건너뜀·미시도를
  // 시도로 부풀리지 않게 attempted 는 null(미측정)이고 recovery.needed(저점수 주장 수)가 분모다.
  assert.equal(m.metrics.repairStats.attempted, null);
  assert.equal(m.metrics.repairStats.measured, false);
  assert.equal(m.metrics.repairStats.accepted, 1);
  assert.equal(m.metrics.repairStats.skippedBudget, null);
  assert.deepEqual(m.metrics.recovery, { needed: 2, relinked: 1, fixed: 0, recovered: 1 });
  assert.equal(m.metrics.outcomeClaims, 3);
});

test("buildComparisonModel: 복구 수락은 주장 단위로 적용 — 같은 블록 형제 주장에 물려주지 않는다", () => {
  // S1_B1 에 주장 2개: fixed 수락은 첫 주장에만 있다. 형제 주장은 본문에 그대로 남아 kept 여야 한다.
  const draft = {
    sections: [{
      sectionId: "S1",
      output: {
        blocks: {
          S1_B1: {
            id: "S1_B1", type: "B05",
            content: {
              a: { text: "고쳐진 주장", evidenceIds: ["U1"], basis: "lecture" },
              b: { text: "형제 주장", evidenceIds: ["U1"], basis: "lecture" },
            },
          },
        },
      },
    }],
    failed: [],
  };
  const note = {
    noteSpecVersion: "lecture-note-2",
    sections: [{
      sectionId: "S1",
      blocks: [{
        id: "S1_B1",
        envelope: { content: { a: { text: "고쳐진 주장", evidenceIds: ["U1"], basis: "lecture" }, b: { text: "형제 주장", evidenceIds: ["U1"], basis: "lecture" } } },
      }],
    }],
  };
  const support = { scores: { "S1_B1#/content/a": 0.2, "S1_B1#/content/b": 0.9 }, outcomes: { "S1_B1#/content/a": "fixed" } };
  const m = AdminView.buildComparisonModel({ records: { "s:write": { value: draft }, "s:valid": { value: { note, support } }, note } });
  const byId = Object.fromEntries(m.claims.map(c => [c.claimId, c]));
  assert.equal(byId["S1_B1#/content/a"].status, "fixed");
  // outcomes 에 없는 형제 주장은 블록의 fixed 수락을 물려받지 않는다 — 본문 생존 추론(kept)이 유지된다
  assert.equal(byId["S1_B1#/content/b"].status, "kept");
});

test("buildComparisonModel: support 기록이 없으면 지표는 미측정(null)이지 0점이 아니다", () => {
  const m = AdminView.buildComparisonModel({
    records: { "s:write": { value: DRAFT }, note: FINAL_NOTE },
  });
  assert.equal(m.available, true);
  assert.equal(m.metrics.judge_low_rate, null);   // 판정 관측 없음 — 0%가 아니다
  assert.equal(m.metrics.initialJudged, 0);
  assert.equal(m.metrics.repairStats.attempted, null); // 시도 미측정
  assert.equal(m.metrics.repairStats.accepted, 0);
  assert.equal(m.metrics.repairStats.measured, false);
  assert.equal(m.metrics.outcomeClaims, 0);
});

test("calculateComparisonMetrics: claimId·text 두 키가 같은 주장을 가리켜도 한 번만 센다", () => {
  const metrics = AdminView.calculateComparisonMetrics({
    claims: [{ claimId: "S1_B1#/a", text: "주장 갑", status: "kept" }],
    supportScores: { "S1_B1#/a": 0.9, "주장 갑": 0.2 }, // 같은 주장의 두 키 — text 키는 보조라 읽지 않는다
    outcomes: { "S1_B1#/a": "kept", "주장 갑": "fixed" },
  });
  assert.equal(metrics.initialJudged, 1);
  assert.equal(metrics.initialLow, 0);        // claimId 점수 0.9 하나만 — text 점수로 low 에 안 센다
  assert.equal(metrics.outcomeClaims, 1);     // 결과도 주장별 한 번
  assert.equal(metrics.recovery.fixed, 0);
});

test("calculateComparisonMetrics: 다른 실행의 잔여 점수·결과는 이 초안 분모에 안 센다", () => {
  const metrics = AdminView.calculateComparisonMetrics({
    claims: [
      { claimId: "S1_B1#/a", text: "주장 갑", status: "kept" },
      { claimId: "S1_B2#/b", text: "주장 을", status: "direct" },
    ],
    supportScores: { "S1_B1#/a": 0.9, "S1_B2#/b": 0.2, "S9_B9#/old": 0.1 }, // S9_B9 는 이전 실행 잔여
    outcomes: { "S1_B1#/a": "kept", "S9_B9#/old": "fixed" },
  });
  assert.equal(metrics.initialJudged, 2);   // 실제 커버된 주장만
  assert.equal(metrics.initialLow, 1);
  assert.equal(metrics.judge_low_rate, 0.5);
  assert.equal(metrics.outcomeClaims, 1);   // 잔여 fixed 는 세지 않는다
  assert.equal(metrics.repairStats.accepted, 0);
});

test("calculateComparisonMetrics: 명시 repairs 입력이 결과 맵보다 정본이다", () => {
  const metrics = AdminView.calculateComparisonMetrics({
    claims: [{ claimId: "c1", status: "fixed" }],
    supportScores: { c1: 0.3 },
    repairs: [{ blockId: "S1_B1", ok: true }, { blockId: "S1_B2", failed: true }],
    outcomes: { c1: "kept" },
  });
  assert.equal(metrics.repairStats.attempted, 2);
  assert.equal(metrics.repairStats.accepted, 1);
  assert.equal(metrics.repairStats.networkFailed, 1);
  assert.equal(metrics.repairStats.measured, true);
});

test("buildEvalExport: run 에 비용 관측 커버리지를 싣고 미측정은 null 로 남긴다", () => {
  const model = AdminView.buildComparisonModel({
    records: { "s:write": { value: DRAFT }, note: FINAL_NOTE },
  });
  // 부분 보고: 호출 3건 중 비용 보고 2건, 합계는 보고분만 — 실제 $0 은 0, 미측정은 null
  const out = AdminView.buildEvalExport(model, {
    packageId: "p1",
    run: { jobId: "j1", costUsd: 0, ms: 100, costObs: 2, costCalls: 3 },
  });
  assert.equal(out.run.costUsd, 0);      // 실제 $0 보고는 0 — null 이 아니다
  assert.equal(out.run.costObs, 2);
  assert.equal(out.run.costCalls, 3);

  const unmeasured = AdminView.buildEvalExport(model, { packageId: "p1", run: { jobId: "j2", ms: 5 } });
  assert.equal(unmeasured.run.costUsd, null); // 관측 없음 — $0 으로 내보내지 않는다
  assert.equal(unmeasured.run.costObs, null);
  assert.equal(unmeasured.run.costCalls, null);
});
