// tools/render-note-pdf.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { parseNoteJson, resolveCrops, renderNoteHtml, isSealedSrzdata } from "./render-note-pdf.mjs";

const NOTE = {
  noteSpecVersion: "lecture-note-2", status: "complete", tier: "paid",
  meta: { title: "t" }, concepts: [], global: [], dropped: [], pruned: [], notices: [],
  sources: [], advisories: [],
  figures: [],
  registry: [
    { id: "F1", latex: "x+1", display: "latex", t0: 0, slideId: "s1" },
    { id: "F2", latex: null, display: "crop", t0: 5, slideId: "s6" },
  ],
  sections: [{
    sectionId: "S1", number: 1, title: "t", question: null, stage: "understand",
    unitIds: ["U1"], range: { t0: 0, t1: 60 }, gist: null, checks: [],
    blocks: [{
      id: "S1_B1", type: "B10", sectionId: "S1", status: "supported",
      importance: "core", emphasis: [],
      content: { title: "c", kind: "calc", goal: null, formulaIds: ["F1", "F2"], figureIds: [], variables: [], assumptions: [], inputs: [], steps: [], derived: [], reading: [], result: null, limits: [], withheld: null },
    }],
  }],
};
const PNG_B64 = "iVBORw0KGgoAAAANSUhEUg==";

test("parseNoteJson: {note, crops} 페이로드 — data:URI 는 그대로", () => {
  const r = parseNoteJson(JSON.stringify({ note: NOTE, crops: { F2: "data:image/png;base64,XYZ" } }));
  assert.equal(r.note.sections[0].sectionId, "S1");
  assert.equal(r.crops.F2, "data:image/png;base64,XYZ");
});

test("parseNoteJson: raw base64 크롭은 매직으로 MIME을 감싼다", () => {
  const r = parseNoteJson({ note: NOTE, crops: { F2: PNG_B64, X9: PNG_B64 } });
  assert.equal(r.crops.F2, `data:image/png;base64,${PNG_B64}`);
  assert.equal(r.crops.X9, undefined, "F#/G# 가 아닌 키는 버린다");
});

test("parseNoteJson: 슬라이드 키 크롭은 cropMap으로 등록부 id를 푼다", () => {
  const r = parseNoteJson({ note: NOTE, cropMap: { F2: "s6/f1" }, crops: { "s6/f1": PNG_B64 } });
  assert.equal(r.crops.F2, `data:image/png;base64,${PNG_B64}`);
});

test("parseNoteJson: 노트 객체 그 자체도 받는다(크롭 없음)", () => {
  const r = parseNoteJson(NOTE);
  assert.equal(r.note, NOTE);
  assert.deepEqual(r.crops, {});
});

test("parseNoteJson: 노트가 없으면 던진다", () => {
  assert.throws(() => parseNoteJson({ meta: {}, crops: {} }), /note-json-no-note/);
  assert.throws(() => parseNoteJson("42"), /note-json-invalid/);
});

test("renderNoteHtml: 저장 노트를 인쇄용 HTML로 조판한다", () => {
  const { html, warnings } = renderNoteHtml(JSON.stringify({ note: NOTE, crops: { F2: "data:image/png;base64,XYZ" } }));
  assert.match(html, /eq-F1/);
  assert.match(html, /eq-F2/);
  assert.ok(Array.isArray(warnings));
});

test("isSealedSrzdata: 암호 봉투 형태만 감지한다", () => {
  assert.equal(isSealedSrzdata({ format: "summrizei-data", version: 2, alg: "AES-256-GCM", iv: "x", ciphertext: "y" }), true);
  assert.equal(isSealedSrzdata({ format: "summrizei", alg: "AES-256-GCM", ciphertext: "y" }), true);
  assert.equal(isSealedSrzdata({ note: {}, ciphertext: "y" }), false);
  assert.equal(isSealedSrzdata(NOTE), false);
  assert.equal(isSealedSrzdata(null), false);
});
