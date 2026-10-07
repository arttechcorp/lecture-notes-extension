// tools/figure-trace.test.mjs
// 도표 생명주기 및 퍼널 추적 도구 단위 테스트 (tools/figure-trace.mjs)

import test from "node:test";
import assert from "node:assert/strict";

import {
  parseKvPairs,
  parseDiagnosticEvents,
  traceFigures,
  formatFigureTraceReport,
} from "./figure-trace.mjs";

test("1. parseKvPairs: k=v 문자열을 객체로 올바르게 파싱한다", () => {
  const msg = "cropExist=25 selected=21 rejQuality=0 planAssigned=16 textRef=6 renderOk=4";
  const kv = parseKvPairs(msg);
  assert.equal(kv.cropExist, 25);
  assert.equal(kv.selected, 21);
  assert.equal(kv.rejQuality, 0);
  assert.equal(kv.planAssigned, 16);
  assert.equal(kv.textRef, 6);
  assert.equal(kv.renderOk, 4);
});

test("2. parseDiagnosticEvents: JSON 배열, NDJSON, 진단 객체 지원", () => {
  // 2a. JSON 배열
  const arr = [{ code: "FIGURE_FUNNEL", msg: "selected=5" }];
  assert.deepEqual(parseDiagnosticEvents(arr), arr);

  // 2b. 객체 내부 events
  const obj = { events: arr };
  assert.deepEqual(parseDiagnosticEvents(obj), arr);

  // 2c. NDJSON 문자열
  const ndjson = '{"code":"FIGURE_FUNNEL","msg":"selected=10"}\n{"code":"COVERAGE","msg":"inc=5"}';
  const parsed = parseDiagnosticEvents(ndjson);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].code, "FIGURE_FUNNEL");
  assert.equal(parsed[1].code, "COVERAGE");
});

test("3. 단계별 분모 상이(spec 8.1) 감지 및 경고 발행", () => {
  // 이전 funnel 이벤트: cropExist=25, selected=21, planAssigned=16, textRef=6, renderOk=4
  const events = [
    {
      code: "FIGURE_FUNNEL",
      msg: "cropExist=25 selected=21 rejQuality=0 planAssigned=16 textRef=6 renderOk=4",
    },
    {
      code: "COVERAGE",
      msg: "inc=10 mrg=0 def=2 exc=0 core=5/5 sup=5/5 min=0/0 cond=2/2 excp=1/1 exmp=1/1",
    },
  ];

  const res = traceFigures(events);
  assert.equal(res.summary.denominatorsDiffer, true);
  assert.ok(res.warnings.length > 0);
  assert.ok(res.summary.warning.includes("단계별 집계 분모 상이"));
  assert.equal(res.summary.funnel.cropExist.count, 25);
  assert.equal(res.summary.funnel.selected.count, 21);
  assert.equal(res.summary.funnel.planAssigned.count, 16);
  assert.equal(res.summary.funnel.bodyReferenced.count, 6);
  assert.equal(res.summary.funnel.rendered.count, 4);
});

test("4. 동일 코호트 Asset ID 추적: 생명주기 4단계 및 탈락 사유 확인", () => {
  const diagnostic = {
    events: [
      { code: "FIGURE_FUNNEL", msg: "cropExist=4 selected=3 rejQuality=1 planAssigned=2 textRef=1 renderOk=1" },
      { code: "RENDER_CROP_REJECTED", unit: "G4" },
    ],
    figures: [
      { id: "G1", display: "table" },
      { id: "G2", display: "check" }, // 품질 미달로 탈락
      { id: "G3", display: "chart" },
      { id: "G4", display: "crop", cropKey: "C4" },
    ],
    plan: {
      sections: [
        {
          blocks: [
            { figureIds: ["G1", "G4"] }, // G3 는 계획에 미배정
          ],
        },
      ],
      global: [],
    },
    note: {
      sections: [
        {
          blocks: [
            { type: "B10", content: { figureIds: ["G1", "G4"] } },
          ],
        },
      ],
    },
    crops: ["G1"], // G4 크롭 없음
  };

  const assetIds = ["G1", "G2", "G3", "G4"];
  const res = traceFigures(diagnostic, { assetIds });

  // 동일 코호트이므로 분모는 4로 일치
  assert.equal(res.summary.denominatorsDiffer, false);
  assert.equal(res.denominators.selection, 4);
  assert.equal(res.denominators.plan, 4);
  assert.equal(res.denominators.body, 4);
  assert.equal(res.denominators.rendered, 4);

  // G1: 전 단계 통과
  const g1 = res.assets.find(a => a.id === "G1");
  assert.ok(g1);
  assert.equal(g1.selected, true);
  assert.equal(g1.planAssigned, true);
  assert.equal(g1.bodyReferenced, true);
  assert.equal(g1.rendered, true);
  assert.equal(g1.failStage, null);
  assert.equal(g1.failReason, null);

  // G2: 퍼널 선택 탈락 (품질 미달)
  const g2 = res.assets.find(a => a.id === "G2");
  assert.ok(g2);
  assert.equal(g2.selected, false);
  assert.equal(g2.failStage, "funnel_selection");
  assert.equal(g2.failReason, "rejected_quality");

  // G3: 계획 미배정 탈락
  const g3 = res.assets.find(a => a.id === "G3");
  assert.ok(g3);
  assert.equal(g3.selected, true);
  assert.equal(g3.planAssigned, false);
  assert.equal(g3.failStage, "plan_assignment");
  assert.equal(g3.failReason, "unassigned_in_plan");

  // G4: RENDER_CROP_REJECTED 로 렌더 탈락
  const g4 = res.assets.find(a => a.id === "G4");
  assert.ok(g4);
  assert.equal(g4.selected, true);
  assert.equal(g4.planAssigned, true);
  assert.equal(g4.bodyReferenced, true);
  assert.equal(g4.rendered, false);
  assert.equal(g4.failStage, "rendered");
  assert.equal(g4.failReason, "crop_rejected");
});

test("5. 불변식 검증: 결과 및 보고서에 강의 텍스트가 누출되지 않음 (콘텐츠 없는 검수)", () => {
  const diagnostic = {
    events: [
      { code: "FIGURE_FUNNEL", msg: "cropExist=2 selected=2 rejQuality=0 planAssigned=2 textRef=1 renderOk=1" },
    ],
    figures: [{ id: "G1", display: "table" }, { id: "G2", display: "chart" }],
    plan: { sections: [{ blocks: [{ figureIds: ["G1", "G2"] }] }] },
    note: { sections: [{ blocks: [{ type: "B10", content: { figureIds: ["G1"] } }] }] },
  };

  const res = traceFigures(diagnostic);
  const text = formatFigureTraceReport(res);

  // 오직 ID, 숫자, 라벨, 코드만 포함되어야 함
  assert.ok(text.includes("[G1]"));
  assert.ok(text.includes("[G2]"));
  assert.ok(text.includes("cropExist:"));
  assert.ok(text.includes("rendered:"));

  // 임의 강의 텍스트나 제목 등이 포함되지 않음
  assert.ok(!text.includes("수업"));
  assert.ok(!text.includes("강의"));
  assert.ok(!text.includes("교재"));
});

test("6. 외부 분모 지정 시 분모 불일치 경고 발행", () => {
  const res = traceFigures({}, {
    assetIds: ["G1", "G2"],
    denominators: { selection: 25, plan: 16, body: 6, rendered: 4 },
  });

  assert.equal(res.summary.denominatorsDiffer, true);
  assert.ok(res.warnings[0].includes("단계별 집계 분모 상이"));
});
