const test = require("node:test");
const assert = require("node:assert/strict");
const VisualSpec = require("./visual-spec.js");

// 합성 픽스처 원장
const mockLedger = {
  v: 1,
  claims: {
    c1: { role: "definition", conceptIds: ["C1"], evidenceIds: ["U1.s1", "U1.t1"], places: ["S1_B1#/content/definition"] },
    c2: { role: "intuition", conceptIds: ["C1"], evidenceIds: ["U1.t2"], places: ["S1_B1#/content/explanation"] },
    c3: { role: "condition", conceptIds: ["C1"], evidenceIds: ["U1.s2"], places: ["S1_B1#/content/scope/0"] },
    c4: { role: "argument", conceptIds: ["C2"], evidenceIds: ["U2.s1"], places: ["S2_B1#/content/steps/0/claim"] },
    c5: { role: "argument", conceptIds: ["C2"], evidenceIds: ["U2.s2"], places: ["S2_B1#/content/steps/1/claim"] },
  },
  draft: {
    claims: [
      { claimId: "c1", text: "기업의 경계는 거래 비용으로 결정된다", evidenceIds: ["U1.s1", "U1.t1"] },
      { claimId: "c2", text: "자산 전용성이 높을수록 내부화가 유리하다", evidenceIds: ["U1.t2"] },
      { claimId: "c3", text: "시장 거래 비용이 조직 비용보다 크다는 조건이다", evidenceIds: ["U1.s2"] },
      { claimId: "c4", text: "전제: 자산 전용성이 높은 투자가 필요하다", evidenceIds: ["U2.s1"] },
      { claimId: "c5", text: "결론: 계약 위험을 피하기 위해 통합한다", evidenceIds: ["U2.s2"] },
    ],
  },
};

const resolver = cid => mockLedger.draft.claims.find(c => c.claimId === cid)?.text ?? cid;

test("validateVisualSpec: valid spec passes validation", () => {
  const spec = {
    visualId: "V1",
    kind: "argument_map",
    targetBlockId: "S2_B3",
    nodes: [
      { id: "n1", claimId: "c4" },
      { id: "n2", claimId: "c5" },
    ],
    edges: [
      { from: "n1", to: "n2", relation: "supports", evidenceIds: ["U2.s1"] },
    ],
  };
  const res = VisualSpec.validateVisualSpec(spec, mockLedger);
  assert.equal(res.ok, true);
  assert.equal(res.errors.length, 0);
});

test("validateVisualSpec: rejects non-existent claimId and evidenceId", () => {
  const badClaim = {
    visualId: "V1",
    kind: "argument_map",
    nodes: [
      { id: "n1", claimId: "c999" }, // 없는 claimId
      { id: "n2", claimId: "c4" },
    ],
    edges: [],
  };
  const res1 = VisualSpec.validateVisualSpec(badClaim, mockLedger);
  assert.equal(res1.ok, false);
  assert.ok(res1.errors.some(e => e.code === "VAL_CLAIM_NOT_FOUND" && e.detail.includes("c999")));

  const badEvidence = {
    visualId: "V1",
    kind: "argument_map",
    nodes: [
      { id: "n1", claimId: "c4" },
      { id: "n2", claimId: "c5" },
    ],
    edges: [
      { from: "n1", to: "n2", relation: "supports", evidenceIds: ["U99.fake"] }, // 없는 evidenceId
    ],
  };
  const res2 = VisualSpec.validateVisualSpec(badEvidence, mockLedger);
  assert.equal(res2.ok, false);
  assert.ok(res2.errors.some(e => e.code === "VAL_EVIDENCE_NOT_FOUND" && e.detail.includes("U99.fake")));
});

test("validateVisualSpec: rejects statistical charts (chart kinds are disallowed without numbers)", () => {
  const chartSpec = {
    visualId: "V1",
    kind: "bar_chart", // 허용되지 않는 kind
    nodes: [{ id: "n1", claimId: "c1" }],
  };
  const res = VisualSpec.validateVisualSpec(chartSpec, mockLedger);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some(e => e.code === "VAL_KIND_INVALID"));
});

test("validateVisualSpec: rejects free text in nodes (must reference ledger via claimId)", () => {
  const freeTextSpec = {
    visualId: "V1",
    kind: "argument_map",
    nodes: [
      { id: "n1", claimId: "c1", text: "임의의 자유 텍스트 작성" },
    ],
  };
  const res = VisualSpec.validateVisualSpec(freeTextSpec, mockLedger);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some(e => e.code === "VAL_NODE_FREE_TEXT"));
});

test("validateVisualSpec: enforces upper limits on nodes and edges, rejects duplicate IDs", () => {
  // 중복 node id
  const dupIdSpec = {
    visualId: "V1",
    kind: "flow",
    nodes: [
      { id: "n1", claimId: "c1" },
      { id: "n1", claimId: "c2" },
    ],
  };
  const resDup = VisualSpec.validateVisualSpec(dupIdSpec, mockLedger);
  assert.equal(resDup.ok, false);
  assert.ok(resDup.errors.some(e => e.code === "VAL_NODE_DUP_ID"));

  // 21개 노드 (상한 20개 초과)
  const tooManyNodes = {
    visualId: "V1",
    kind: "flow",
    nodes: Array.from({ length: 21 }, (_, i) => ({ id: `n${i + 1}`, claimId: "c1" })),
  };
  const resNodes = VisualSpec.validateVisualSpec(tooManyNodes, mockLedger);
  assert.equal(resNodes.ok, false);
  assert.ok(resNodes.errors.some(e => e.code === "VAL_NODES_LIMIT"));

  // 31개 간선 (상한 30개 초과)
  const tooManyEdges = {
    visualId: "V1",
    kind: "argument_map",
    nodes: [
      { id: "n1", claimId: "c1" },
      { id: "n2", claimId: "c2" },
    ],
    edges: Array.from({ length: 31 }, (_, i) => ({ from: "n1", to: "n2", relation: "supports" })),
  };
  const resEdges = VisualSpec.validateVisualSpec(tooManyEdges, mockLedger);
  assert.equal(resEdges.ok, false);
  assert.ok(resEdges.errors.some(e => e.code === "VAL_EDGES_LIMIT"));
});

test("renderVisualSvg: deterministic output — same input produces identical SVG", () => {
  const spec = {
    visualId: "V1",
    kind: "argument_map",
    targetBlockId: "S2_B3",
    nodes: [
      { id: "n1", claimId: "c4" },
      { id: "n2", claimId: "c5" },
    ],
    edges: [
      { from: "n1", to: "n2", relation: "supports", evidenceIds: ["U2.s1"] },
    ],
  };
  const svg1 = VisualSpec.renderVisualSvg(spec, resolver);
  const svg2 = VisualSpec.renderVisualSvg(spec, resolver);
  assert.equal(svg1, svg2);
  assert.ok(svg1.startsWith("<svg"));
  assert.ok(svg1.endsWith("</svg>"));
});

test("renderVisualSvg: security — script, javascript URLs, external links, foreignObject, style injection do NOT survive", () => {
  const maliciousResolver = cid => {
    return `<script>alert('pwned')</script>보안 테스트 <foreignObject><body onload="evil()"></foreignObject> https://malicious-site.com/leak javascript:alert(1)`;
  };
  const spec = {
    visualId: "V1<script>bad()</script>",
    kind: "argument_map",
    nodes: [
      { id: "n1", claimId: "c1" },
      { id: "n2", claimId: "c2" },
    ],
    edges: [
      { from: "n1", to: "n2", relation: "supports" },
    ],
  };
  const svg = VisualSpec.renderVisualSvg(spec, maliciousResolver);

  assert.equal(svg.includes("<script"), false, "No script tag in SVG");
  assert.equal(svg.includes("javascript:"), false, "No javascript: URI in SVG");
  assert.equal(svg.includes("<foreignObject"), false, "No foreignObject tag in SVG");
  assert.equal(svg.includes("https://malicious-site.com"), false, "No external URL in SVG");
  assert.equal(svg.includes("onload="), false, "No onload handler in SVG");
  assert.equal(svg.includes("style="), false, "No inline style attributes in SVG");
  // 이스케이프 확인
  assert.ok(svg.includes("&lt;") || !svg.includes("<bad()"));
});

test("renderVisualSvg: accessibility — includes title and desc with textual equivalent description", () => {
  const spec = {
    visualId: "V1",
    kind: "argument_map",
    nodes: [
      { id: "n1", claimId: "c4" },
      { id: "n2", claimId: "c5" },
    ],
    edges: [
      { from: "n1", to: "n2", relation: "supports", evidenceIds: ["U2.s1"] },
    ],
  };
  const svg = VisualSpec.renderVisualSvg(spec, resolver);
  assert.ok(svg.includes("<title>"), "SVG contains <title>");
  assert.ok(svg.includes("<desc>"), "SVG contains <desc>");
  assert.ok(svg.includes("논증 지도 (V1)"), "Title contains visualId and kind");
  assert.ok(svg.includes("자산 전용성이 높은"), "Desc contains claim text");
  assert.ok(svg.includes("[n1] → (지지 (근거: U2.s1)) [n2]"), "Desc contains relationship summary");
});

test("renderVisualSvg: print friendly (B&W) — uses distinct line dash styles and relation labels", () => {
  const spec = {
    visualId: "V2",
    kind: "argument_map",
    nodes: [
      { id: "n1", claimId: "c1" },
      { id: "n2", claimId: "c2" },
      { id: "n3", claimId: "c3" },
    ],
    edges: [
      { from: "n1", to: "n2", relation: "supports" },
      { from: "n2", to: "n3", relation: "contrasts" },
    ],
  };
  const svg = VisualSpec.renderVisualSvg(spec, resolver);
  // supports: solid, contrasts: dashed
  assert.ok(svg.includes('stroke-dasharray="none"'), "Solid line for supports");
  assert.ok(svg.includes('stroke-dasharray="6,4"'), "Dashed line for contrasts");
  assert.ok(svg.includes("지지"), "Korean label for supports");
  assert.ok(svg.includes("대조"), "Korean label for contrasts");
});

test("renderVisualSvg: timeline and flow kinds render sequential layouts", () => {
  const timelineSpec = {
    visualId: "V_TIME",
    kind: "timeline",
    nodes: [
      { id: "n1", claimId: "c1" },
      { id: "n2", claimId: "c2" },
      { id: "n3", claimId: "c3" },
    ],
    edges: [
      { from: "n1", to: "n2", relation: "precedes" },
      { from: "n2", to: "n3", relation: "precedes" },
    ],
  };
  const timelineSvg = VisualSpec.renderVisualSvg(timelineSpec, resolver);
  assert.ok(timelineSvg.includes("STEP 1"), "Timeline has STEP markers");
  assert.ok(timelineSvg.includes("STEP 2"));
  assert.ok(timelineSvg.includes("타임라인 (V_TIME)"));

  const flowSpec = {
    visualId: "V_FLOW",
    kind: "flow",
    nodes: [
      { id: "n1", claimId: "c1" },
      { id: "n2", claimId: "c2" },
    ],
    edges: [
      { from: "n1", to: "n2", relation: "causes" },
    ],
  };
  const flowSvg = VisualSpec.renderVisualSvg(flowSpec, resolver);
  assert.ok(flowSvg.includes("단계 1"), "Flow has 단계 markers");
  assert.ok(flowSvg.includes("인과"), "Flow shows relation label");
});
