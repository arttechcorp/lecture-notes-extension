// Probe harness: mirrors lib/stages.js "refining" + validate + assemble + render, without any service call.
const katex = require("./lib/vendor/katex/katex.min.js");
const Boilerplate = require("./lib/boilerplate.js");
const Formulas = require("./lib/formulas.js");
const Preprocess = require("./lib/preprocess.js");
const NoteContract = require("./lib/note-contract.js");
const Figures = require("./lib/figures.js");
const NoteRender = require("./lib/note-render.js");
const NoteSpec = require("./lib/note-spec.js");
const NoteExport = require("./lib/note-export.js");
const Verify = require("./lib/verify.js");
const { localSlideDoc } = require("./lib/layout.js");

// Same as stages.js refining (lines 189-206)
function refine(slides, segments, tier = "free") {
  const bp = Boilerplate.detect(slides);
  const registry = Formulas.buildRegistry(bp.slides).map(e => Formulas.verify(e, { katex, reread: true }));
  const ir = Preprocess.buildIR(bp.slides, segments);
  const owner = new Map();
  for (const m of Preprocess.mergeProgressive(bp.slides)) for (const id of [...(m.mergedFrom ?? []), m.slideId]) owner.set(String(id), String(m.slideId));
  const unitBySlide = new Map(ir.units.filter(u => u.slideId != null).map(u => [String(u.slideId), u.unitId]));
  const unitOf = s => unitBySlide.get(owner.get(String(s))) ?? null;
  const uniq = l => [...new Set(l)];
  const formulaUnits = Object.fromEntries(registry.map(e => [e.id, uniq([e.slideId, ...e.seenOn].map(unitOf).filter(Boolean))]));
  const figs = tier === "paid" ? Figures.buildFigureRegistry(bp.slides, { unitOf, evidence: ir.evidence, hashes: {}, ocr: {}, crops: [] }) : [];
  return { ir, evidence: ir.evidence, registry, formulaUnits, figures: figs.map(({ cropKey, ...f }) => f), bp };
}

const claim = (text, ids, basis = "lecture") => ({ text, evidenceIds: ids, basis });
const env = content => ({ status: "supported", importance: "core", emphasis: [], content });
const b05 = (term, defText, ids, extra = {}) => env({ conceptId: "C1", term, original: null, definition: claim(defText, ids), explanation: null, mechanism: null, scope: [], examples: [], ...extra });

function plan1(title, question, units, blocks = [{ type: "B05", purpose: "p", conceptIds: ["C1"], formulaIds: [], figureIds: [] }], concept = { conceptId: "C1", name: "개념", homeSectionId: "S1", depth: "defined" }) {
  return { schemaVersion: 1, noteSpecVersion: NoteContract.NOTE_SPEC_VERSION, policy: { externalAugmentation: false, syntheticExamples: false },
    concepts: [concept], sections: [{ sectionId: "S1", title, question, stage: "understand", unitIds: units, crossUnitIds: [], blocks: blocks.map((b, i) => ({ blockId: `S1_B${i + 1}`, ...b })) }], global: [] };
}

function assemble({ r, plan, outputs, tier = "free", meta = {} }) {
  const sections = [{ sectionId: "S1", output: outputs }];
  const check = NoteContract.validateSection({ plan, sectionId: "S1", output: outputs, evidence: r.evidence, registry: r.registry, formulaUnits: r.formulaUnits, figures: r.figures, katex });
  const note = NoteContract.assembleNote({ plan, sections, global: null, units: r.ir.units, evidence: r.evidence, registry: r.registry, formulaUnits: r.formulaUnits, figures: r.figures, crops: [], tier,
    meta: { title: meta.title ?? null, course: null, lectureDate: null, session: null, lang: "ko", generatedAt: "2026-10-05T00:00:00.000Z", processed: { t0: 0, t1: 10 } }, systemNotices: [], katex });
  return { check, note };
}

const render = (note, options) => NoteRender.renderNote(note, { katex, options });
const md = note => NoteExport.toMarkdown(note);

module.exports = { katex, Boilerplate, Formulas, Preprocess, NoteContract, Figures, NoteRender, NoteSpec, NoteExport, Verify, localSlideDoc, refine, claim, env, b05, plan1, assemble, render, md };
