// tools/eval-notes.mjs 테스트 — 지표는 손으로 계산한 작은 fixture 로 검증한다.
import test from "node:test";
import assert from "node:assert/strict";
import {
  parseRun, parseLabels, parseCsv, cohenKappa, bandOf, roleOf, stratifiedSheet, sheetCsv,
  scoreBins, eceOf, pathMetrics, checkLeakage, buildLabelIndex, evaluate, requiredIdsOf, reportMd,
} from "./eval-notes.mjs";

const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

// 경로 preserve, 강의 L1 — 9주장(점수·상태·basis·required 를 지표 검증에 맞게 배치).
const runL1 = {
  tool: "summrizei-eval-run", version: 1, lectureId: "L1", path: "preserve",
  run: { jobId: "j1", costUsd: 0.02, ms: 1000 },
  claims: [
    { claimId: "B1#/content/definition", score: 0.95, status: "kept", basis: "lecture", text: "정의 주장", evidenceIds: ["E1"], pointer: "/content/definition", type: "B05", required: true },
    { claimId: "B1#/content/explanation", score: 0.85, status: "kept", basis: "lecture", text: "설명 주장", evidenceIds: ["E1"], pointer: "/content/explanation", type: "B05" },
    { claimId: "B2#/content/conditions/0", score: 0.4, status: "direct", basis: "lecture", text: "잘못 보류된 조건", evidenceIds: ["E2"], pointer: "/content/conditions/0", type: "B11" },
    { claimId: "B3#/content/note", score: 0.2, status: "direct", basis: "lecture", text: "옳게 보류된 주장", evidenceIds: ["E3"], pointer: "/content/note", type: "B12" },
    { claimId: "B4#/content/note", score: 0.2, status: "kept", basis: "lecture", text: "근거 없이 남은 주장", evidenceIds: ["E3"], pointer: "/content/note", type: "B12" },
    { claimId: "B5#/content/examples/0", score: null, status: "unjudged", basis: "lecture", text: "미판정 사례", evidenceIds: ["E4"], pointer: "/content/examples/0", type: "B05" },
    { claimId: "B6#/content/note", score: 0.9, status: "kept", basis: "pedagogical", text: "교육용 주장", evidenceIds: [], pointer: "/content/note", type: "B12" },
    { claimId: "B7#/content/limits/0", score: 0.6, status: "collateral", basis: "lecture", text: "모호 라벨 주장", evidenceIds: ["E5"], pointer: "/content/limits/0", type: "B08" },
    { claimId: "B8#/content/note", score: 0.8, status: "kept", basis: "lecture", text: "라벨 없는 주장", evidenceIds: ["E6"], pointer: "/content/note", type: "B12" },
  ],
  evidence: [
    { id: "E1", kind: "slide", unitId: "U1", text: "근거 1" }, { id: "E2", kind: "transcript", unitId: "U1", text: "근거 2" },
    { id: "E3", kind: "slide", unitId: "U2", text: "근거 3" }, { id: "E4", kind: "transcript", unitId: "U2", text: "근거 4" },
    { id: "E5", kind: "slide", unitId: "U3", text: "근거 5" }, { id: "E6", kind: "transcript", unitId: "U3", text: "근거 6" },
  ],
};

const runL2 = {
  tool: "summrizei-eval-run", version: 1, lectureId: "L2", path: "shadow",
  run: { costUsd: 0.03, ms: 3000 },
  claims: [
    { claimId: "B1#/content/note", score: 0.1, status: "direct", basis: "lecture", text: "섀도 보류 주장", evidenceIds: ["E1"], pointer: "/content/note", type: "B12" },
    { claimId: "B2#/content/note", score: 0.9, status: "kept", basis: "lecture", text: "섀도 수용 주장", evidenceIds: ["E1"], pointer: "/content/note", type: "B12" },
    { claimId: "B3#/content/note", score: null, status: "unjudged", basis: "lecture", text: "미응답 주장", evidenceIds: ["E2"], pointer: "/content/note", type: "B12" },
    { claimId: "B4#/content/note", score: 0.55, status: "fixed", basis: "lecture", text: "수정된 주장", evidenceIds: ["E2"], pointer: "/content/note", type: "B12" },
  ],
  evidence: [{ id: "E1", text: "근거 1" }, { id: "E2", text: "근거 2" }],
};

const LABELS_CSV = `lectureId,claimId,label_a,label_b,adjudicated
L1,B1#/content/definition,supported,supported,
L1,B1#/content/explanation,supported,contradicted,supported
L1,B2#/content/conditions/0,supported,supported,
L1,B3#/content/note,contradicted,contradicted,
L1,B4#/content/note,insufficient,insufficient,
L1,B5#/content/examples/0,supported,supported,
L1,B6#/content/note,supported,ambiguous,supported
L1,B7#/content/limits/0,ambiguous,ambiguous,
L2,B1#/content/note,supported,supported,
L2,B2#/content/note,contradicted,supported,contradicted
L2,B3#/content/note,insufficient,insufficient,
L2,B4#/content/note,supported,supported,
`;

test("parseRun: 형식 검증과 정규화", () => {
  const r = parseRun(runL1, "a.json");
  assert.equal(r.lectureId, "L1");
  assert.equal(r.path, "preserve");
  assert.equal(r.claims.length, 9);
  assert.equal(r.claims[4].score, 0.2);
  assert.equal(r.claims[5].score, null);
  assert.equal(r.evidence.get("E1").text, "근거 1");
  // path 오류·claims 없음·범위 밖 점수
  assert.throws(() => parseRun({ path: "weird", claims: [] }), /path/);
  assert.throws(() => parseRun({ path: "preserve" }), /claims/);
  const bad = parseRun({ path: "preserve", lectureId: "X", claims: [{ claimId: "c1", score: 9 }, { claimId: "c1" }, { noId: 1 }] });
  assert.equal(bad.claims.length, 1); // 중복·무 claimId 제거
  assert.equal(bad.claims[0].score, null); // 범위 밖 점수는 null
  assert.equal(bad.duplicateClaims, 1);
  assert.equal(bad.invalidClaims, 1);
});

test("parseCsv: 따옴표·쉼표·줄바꿈 필드", () => {
  const rows = parseCsv('a,b\n"x,y","줄1\n줄2"\n1,"""인용"""');
  assert.deepEqual(rows, [["a", "b"], ["x,y", "줄1\n줄2"], ["1", '"인용"']]);
});

test("parseLabels: CSV — 조정값 우선, 일치 라벨, 무효 값", () => {
  const rows = parseLabels(LABELS_CSV);
  assert.equal(rows.length, 12);
  assert.equal(rows.find(r => r.claimId === "B1#/content/explanation").final, "supported"); // 조정값
  assert.equal(rows.find(r => r.claimId === "B3#/content/note").final, "contradicted"); // 일치
  assert.equal(rows.find(r => r.claimId === "B1#/content/definition").final, "supported");
  // JSON 형태도 받는다
  const jr = parseLabels(JSON.stringify([{ claimId: "x", label_a: "supported", label_b: "contradicted" }, { claimId: "y", final: "ambiguous" }]));
  assert.equal(jr[0].final, null); // 불일치·미조정
  assert.equal(jr[1].final, "ambiguous");
});

test("cohenKappa: 손계산과 일치", () => {
  // fixture 라벨: a 는 s7 c2 i2 a1, b 는 s6 c2 i2 a2, 일치 9/12
  const rows = parseLabels(LABELS_CSV);
  const { kappa, pairs, agreement } = cohenKappa(rows);
  assert.equal(pairs, 12);
  assert.equal(agreement, 0.75);
  const pe = (7 / 12) * (6 / 12) + (2 / 12) * (2 / 12) + (2 / 12) * (2 / 12) + (1 / 12) * (2 / 12);
  assert.ok(near(kappa, (0.75 - pe) / (1 - pe)));
  assert.ok(near(kappa, 0.6087, 1e-3));
  assert.deepEqual(cohenKappa([]), { kappa: null, pairs: 0, agreement: null });
});

test("bandOf / roleOf 층화 분류", () => {
  assert.equal(bandOf(null), "unjudged");
  assert.equal(bandOf(0.3), "low");
  assert.equal(bandOf(0.55), "border");
  assert.equal(bandOf(0.9), "high");
  assert.equal(roleOf({ pointer: "/content/definition" }), "definition");
  assert.equal(roleOf({ pointer: "/content/conditions/2" }), "condition");
  assert.equal(roleOf({ pointer: "/content/limits/0" }), "exception");
  assert.equal(roleOf({ pointer: "/content/examples/1" }), "example");
  assert.equal(roleOf({ pointer: "/content/items/0/claim" }), "other");
});

test("pathMetrics: false withhold/accept·응답 정확도·ECE 손계산", () => {
  const labels = parseLabels(LABELS_CSV);
  const run = parseRun(runL1);
  const { labelFor } = buildLabelIndex(labels, [run]);
  const m = pathMetrics([run], labelFor);
  // supported = c1,c2,c3,c6,c7 = 5 → false withhold = c3 하나 → 0.2
  assert.equal(m.false_withhold.of, 5);
  assert.equal(m.false_withhold.withheld, 1);
  assert.equal(m.false_withhold.rate, 0.2);
  // unsupported = c4,c5 = 2 → false accept = c5(kept) 하나 → 0.5
  assert.equal(m.false_accept.of, 2);
  assert.equal(m.false_accept.accepted, 1);
  assert.equal(m.false_accept.rate, 0.5);
  // 미응답 제외 정확도: 점수 있는 라벨 6개 중 c3 만 오답 → 5/6
  assert.equal(m.accuracy_responded.of, 6);
  assert.ok(near(m.accuracy_responded.rate, 5 / 6));
  // 판정 성공률: lecture 8개 중 점수 7개 → 7/8 (pedagogical 은 대상이 아니다)
  assert.equal(m.judge_success.of, 8);
  assert.equal(m.judge_success.answered, 7);
  // ECE: bin9(.95,.9)acc1·bin8(.85)acc1·bin4(.4)acc1·bin2(.2,.2)acc0
  //      = (2·|1-.925| + 1·.15 + 1·.6 + 2·.2)/6 = 1.3/6
  assert.ok(near(m.ece.value, 1.3 / 6));
  assert.equal(m.ece.scored, 6);
  // 필수 항목: c1 required → 보존·지지 확인
  assert.equal(m.required_coverage.of, 1);
  assert.equal(m.required_coverage.preserved, 1);
  assert.equal(m.required_coverage.verified, 1);
  // 비용·지연
  assert.equal(m.cost.totalUsd, 0.02);
  assert.equal(m.latency.p50ms, 1000);
  assert.equal(m.latency.p95ms, 1000);
  assert.equal(m.status_counts.kept, 5);
});

test("pathMetrics: shadow 경로 — 전원 미보류 판정은 보존율 없음", () => {
  const labels = parseLabels(LABELS_CSV);
  const run = parseRun(runL2);
  const { labelFor } = buildLabelIndex(labels, [run]);
  const m = pathMetrics([run], labelFor);
  assert.equal(m.false_withhold.rate, 0.5); // supported 2 중 c1 보류
  assert.equal(m.false_accept.rate, 1); // unsupported 2 전부 본문 잔류
  assert.ok(near(m.accuracy_responded.rate, 1 / 3));
  assert.equal(m.judge_success.rate, 0.75);
  assert.equal(m.required_coverage, null); // 필수 표시 없음 → 측정 안 됨
});

test("scoreBins/eceOf: 점수 구간과 가중 평균", () => {
  const rows = [
    { claim: { score: 0.95 }, label: "supported" }, { claim: { score: 0.85 }, label: "supported" },
    { claim: { score: 0.4 }, label: "contradicted" }, { claim: { score: 0.2 }, label: "supported" },
  ];
  const bins = scoreBins(rows);
  assert.equal(bins[9].n, 1); assert.equal(bins[8].n, 1); assert.equal(bins[4].n, 1); assert.equal(bins[2].n, 1);
  assert.equal(bins[4].accuracy, 0);
  // ECE = (|1-.95| + |1-.85| + |0-.4| + |1-.2|)/4 = (.05+.15+.4+.8)/4 = .35
  assert.ok(near(eceOf(bins), 0.35));
  assert.equal(eceOf(scoreBins([])), null);
});

test("checkLeakage: 같은 강의 id 가 양쪽에 있으면 걸린다", () => {
  const e = [parseRun(runL1)], t = [parseRun({ path: "preserve", lectureId: "L1", claims: [] })];
  assert.deepEqual(checkLeakage(e, t), ["L1"]);
  assert.throws(() => evaluate({ evalRuns: e, tuningRuns: t, labelRows: [] }), /L1/);
  assert.deepEqual(checkLeakage(e, [parseRun({ path: "preserve", lectureId: "L9", claims: [] })]), []);
});

test("buildLabelIndex: lectureId 없는 라벨은 claimId 가 유일할 때만 단다", () => {
  const r1 = parseRun(runL1), r2 = parseRun(runL2); // B3#/content/note 는 두 실행에 모두 있다
  const labels = parseLabels(`claimId,label\nB2#/content/conditions/0,supported\nB3#/content/note,contradicted\n`);
  const { labelFor } = buildLabelIndex(labels, [r1, r2]);
  assert.equal(labelFor("L1", "B2#/content/conditions/0")?.final, "supported");
  assert.equal(labelFor("L1", "B3#/content/note"), null); // 여러 강의에 있어 애매 — 매칭 안 함
  assert.equal(labelFor("L9", "B2#/content/conditions/0"), null); // 실행에 없는 쌍은 매칭 안 함
});

test("evaluate: 경로별 지표 묶음과 κ, 리포트 형식", () => {
  const r1 = parseRun(runL1), r2 = parseRun(runL2);
  const rep = evaluate({ evalRuns: [r1, r2], tuningRuns: [], labelRows: parseLabels(LABELS_CSV) });
  assert.equal(rep.tool, "summrizei-eval-report");
  assert.deepEqual(rep.lectures.sort(), ["L1", "L2"]);
  assert.equal(rep.leakage.ok, true);
  assert.ok(near(rep.paths.preserve.false_withhold.rate, 0.2));
  assert.ok(near(rep.paths.shadow.false_accept.rate, 1));
  assert.ok(near(rep.interRater.kappa, 0.6087, 1e-3));
  const md = reportMd(rep);
  assert.match(md, /false withhold/);
  assert.match(md, /표본 크기.*보증이 아니다/);
});

test("stratifiedSheet: 결정성·맹검·층화", () => {
  // 16칸을 골고루 채운 40+ 주장 합성
  const claims = [];
  const ptrs = { definition: "/content/definition", condition: "/content/conditions/0", exception: "/content/limits/0", example: "/content/examples/0", other: "/content/items/0/claim" };
  let i = 0;
  for (const score of [0.3, 0.6, 0.9, null]) {
    for (const p of Object.values(ptrs)) {
      claims.push({ claimId: `B${i}#/c`, score, status: "kept", basis: "lecture", text: `주장 ${i}`, evidenceIds: [], pointer: p });
      i++;
    }
  }
  claims.push({ claimId: "extra", score: 0.3, status: "direct", basis: "lecture", text: "저점수 추가", evidenceIds: [], pointer: "/content/note" });
  const run = parseRun({ path: "preserve", lectureId: "L9", claims, evidence: [] });
  const a = stratifiedSheet(run, 40), b = stratifiedSheet(run, 40);
  assert.deepEqual(a, b); // 결정적
  assert.ok(a.sheet.length <= 40);
  assert.equal(a.sheet.length, a.key.length);
  // 맹검: 시트에는 점수·상태가 없다 (키 파일에만 있다)
  const csv = sheetCsv(a.sheet);
  assert.equal(csv.split("\n")[0], "lectureId,claimId,claim,evidence,label_a,label_b,adjudicated");
  assert.ok(!/score|status/.test(csv.split("\n")[0]));
  assert.ok(a.key.every(k => "score" in k && "status" in k && "band" in k && "role" in k));
  // 층화: 16칸 × 최소 1개씩 — 21개 모집단에서 각 칸이 최소 1개 뽑힌다
  const bands = new Set(a.key.map(k => k.band)), roles = new Set(a.key.map(k => k.role));
  assert.equal(bands.size, 4);
  assert.ok(roles.size >= 4);
});

test("requiredIdsOf: coverage 모양과 claim.required 둘 다 받는다", () => {
  const run = parseRun({ path: "preserve", lectureId: "X", claims: [{ claimId: "c1", required: true }, { claimId: "c2" }], coverage: { requiredClaims: ["c2"], items: [{ importance: "core", claimIds: ["c3"] }] } });
  assert.deepEqual([...requiredIdsOf(run)].sort(), ["c1", "c2", "c3"]);
});
