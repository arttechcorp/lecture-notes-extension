// Regenerate semantics: libRegenerate() creates a NEW job (same packageId) and calls runNote with the stored input.
const katex = require("./lib/vendor/katex/katex.min.js");
const P = require("./lib/pipeline.js"), S = require("./lib/stages.js");
const { createStore, memoryAdapter } = require("./lib/package-store.js");
const { EventBus } = require("./lib/events.js");
const INPUT = require("./tools/note-fixture/input.json"), PLANNER = require("./tools/note-fixture/planner-output.json"), WRITER = require("./tools/note-fixture/writer-outputs.json");
const clock = (t = 1000) => () => t++;
const calls = { plan: 0, section: 0, repair: 0, global: 0, judge: 0 };
const svc = {
  plan: async () => (calls.plan++, { plan: PLANNER, promptVersion: "note-v2" }),
  write: async o => { const k = o.stage ?? "section"; calls[k]++;
    if (k === "section") { const f = WRITER.sections[o.section.sectionId].first; const out = { blocks: Object.fromEntries(o.section.blocks.map(b => [b.blockId, f.blocks[b.blockId] ?? null])), checks: f.checks ?? [] }; if (o.withGist !== false) out.gist = f.gist; return { output: out }; }
    if (k === "repair") return { output: { blocks: Object.fromEntries(o.repair.map(r => [r.blockId, WRITER.sections[o.section.sectionId].repair?.blocks?.[r.blockId] ?? null])) } };
    return { output: WRITER.global }; },
  judge: async () => { calls.judge++; return { results: [] }; },
};
(async () => {
  const store = await createStore(memoryAdapter());
  const input = { slides: INPUT.slides, transcript: INPUT.transcript, gaps: [], tier: "paid", models: { plan: "m-plan", write: "m-write", judge: null }, consent: { summary: true }, meta: INPUT.meta };
  const run = async jobId => {
    const bus = new EventBus({ now: clock(), limit: 100000 });
    const job = await P.createJob({ jobId, packageId: "L1", store, events: bus, now: clock() });
    const res = await S.runNote(job, input, { service: svc, katex, events: bus, sleep: async () => {} });
    const hits = bus.recent().filter(e => e.stage && ["refining", "judging", "planning", "writing", "validating", "rendering"].includes(e.stage) && e.status === "skipped" || (e.msg === "cache"));
    return { res, bus };
  };
  const a = await run("first-job-1"); const after1 = { ...calls };
  const b = await run("regen-L1-abc"); const after2 = { ...calls };
  console.log("service calls after 1st run:", JSON.stringify(after1));
  console.log("service calls added by the 2nd run (same package, new job, same input/options/models):", JSON.stringify(Object.fromEntries(Object.keys(after2).map(k => [k, after2[k] - after1[k]]))));
  const ev = b.bus.recent().filter(e => ["refining", "judging", "planning", "writing", "validating", "rendering"].includes(e.stage));
  console.log("2nd-run stage events:", ev.map(e => `${e.stage}:${e.status ?? ""}${e.msg ? "(" + e.msg + ")" : ""}`).join(" "));
  console.log("identical note JSON:", JSON.stringify(a.res.note) === JSON.stringify(b.res.note), "(generatedAt same too => assemble not re-run):", a.res.note.meta.generatedAt === b.res.note.meta.generatedAt);
  console.log("VERSION in stage keys (stages.js):", S.VERSION, " — not tied to NoteContract/Boilerplate/Verify/Prompts versions");
})();
