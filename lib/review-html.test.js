const test = require("node:test");
const assert = require("node:assert/strict");
const RH = require("./review-html.js");

test("reduce: style·script·인라인 style·data: URI를 빼고 id·data-* 앵커는 남긴다", () => {
  const html = `<style>.x{color:red}</style><script>evil()</script><script src="x.js"></script>`
    + `<section class="note-block" id="S1_B2" data-type="B05" style="margin:0"><p class="note-claim" data-ev="U1.s2" data-claim="c1">정의다</p>`
    + `<img class="note-crop" src="data:image/png;base64,AAAABBBBCCCC" alt="수식"></section>`;
  const out = RH.reduce(html);
  assert.ok(!out.includes("<style") && !out.includes("color:red"), "스타일 블록 제거");
  assert.ok(!out.includes("<script") && !out.includes("evil"), "스크립트 제거");
  assert.ok(!out.includes("style="), "인라인 style 제거");
  assert.ok(!out.includes("AAAABBBB"), "크롭 바이트 제거");
  assert.ok(out.includes('src="data:"'), "src 자리는 남는다");
  for (const a of ['id="S1_B2"', 'data-type="B05"', 'data-ev="U1.s2"', 'data-claim="c1"', "정의다"])
    assert.ok(out.includes(a), a + " 보존");
});

test("reduce: 크기 상한을 넘으면 </section> 경계에서 자르고 표식을 붙인다", () => {
  const sec = i => `<section id="S${i}_B1">` + "가".repeat(100) + "</section>";
  const html = Array.from({ length: 20 }, (_, i) => sec(i)).join("");
  const out = RH.reduce(html, 2000);
  assert.ok(new TextEncoder().encode(out).length <= 2000, "상한 안");
  assert.ok(out.endsWith(RH.CUT_MARK.trim()), "절단 표식");
  assert.equal(out.lastIndexOf("</section>"), out.indexOf(RH.CUT_MARK) - "</section>".length, "블록 경계 절단");
  assert.ok(out.includes('id="S0_B1"') && out.includes('id="S1_B1"'), "앞 블록은 온전히 남는다");
  assert.ok(!out.includes('id="S19_B1"'), "뒤 블록은 잘린다");
});

test("reduce: 상한 안이면 그대로, 첫 섹션보다 작은 상한도 문자열을 돌려준다", () => {
  const s = '<section id="S1_B1">본문</section>';
  assert.equal(RH.reduce(s, 60000), s);
  assert.equal(RH.reduce("", 10), "");
  assert.equal(typeof RH.reduce(s, 5), "string");
  assert.ok(new TextEncoder().encode(RH.reduce(s, 5)).length <= 5 + new TextEncoder().encode(RH.CUT_MARK).length);
});

test("redoCap: 영상 10분당 1개, 최소 1 (7분→1, 25분→2, 75분→7)", () => {
  assert.equal(RH.redoCap(7), 1);
  assert.equal(RH.redoCap(0), 1);
  assert.equal(RH.redoCap(25), 2);
  assert.equal(RH.redoCap(75), 7);
  assert.equal(RH.redoCap(9.9), 1);
  assert.equal(RH.redoCap(10), 1);
  assert.equal(RH.redoCap(null), 1);
});

test("pickRedos: Sol의 출력 순서가 우선순위 — 앞에서 cap 개만 채택하고 중복·없는 대상은 반려", () => {
  const edits = [
    { op: "claim_edit", targetId: "S1_B2/x" },
    { op: "request_section_redo", targetId: "S3" },
    { op: "request_section_redo", targetId: "S1" },
    { op: "request_section_redo", targetId: "S3" },        // 중복 → no_change
    { op: "request_section_redo", targetId: "S9" },        // 없는 섹션 → target_missing
    { op: "request_section_redo", targetId: "S2" },        // 상한 초과 → over
  ];
  const is = id => ["S1", "S2", "S3"].includes(id);
  const pr = RH.pickRedos(edits, 2, is);
  assert.deepEqual(pr.queue, ["S3", "S1"], "지시 순서대로 상한까지");
  assert.deepEqual(pr.over, ["S2"], "상한 초과");
  assert.deepEqual(pr.rejected, ["no_change", "target_missing"]);
  const all = RH.pickRedos(edits, 9, is);
  assert.deepEqual(all.queue, ["S3", "S1", "S2"]);
});
