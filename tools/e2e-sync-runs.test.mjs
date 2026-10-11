import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { scanRuns, runRow, upsertSql } from "./e2e-sync-runs.mjs";

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-runs-"));
  const mk = (name, report, extra = {}) => {
    const d = path.join(dir, name);
    fs.mkdirSync(d);
    if (report) fs.writeFileSync(path.join(d, "report.json"), JSON.stringify(report));
    for (const [f, v] of Object.entries(extra)) fs.writeFileSync(path.join(d, f), v);
    return d;
  };
  return { dir, mk };
}

test("scanRuns은 prefix 폴더만 시작 시각 오름차순으로 모은다(.log 파일·다른 prefix 제외)", () => {
  const { dir, mk } = fixture();
  mk("mis-sol-hai-2", { startedAt: "2026-10-10T02:00:00Z", result: "ok" });
  mk("mis-sol-hai-1", { startedAt: "2026-10-10T01:00:00Z" });
  mk("other-1", { startedAt: "2026-10-10T03:00:00Z" });
  fs.writeFileSync(path.join(dir, "mis-sol-hai-3.log"), "not a dir");
  const runs = scanRuns(dir, "mis-sol-hai-");
  assert.deepEqual(runs.map(r => r.name), ["mis-sol-hai-1", "mis-sol-hai-2"]);
});

test("runRow는 스크린샷 경로를 빼고 꼬리·결과·끝 시각을 담는다", () => {
  const { dir, mk } = fixture();
  mk("mis-sol-hai-1", {
    startedAt: "2026-10-10T01:00:00Z", result: "ok", version: "2.8.0.4",
    steps: [{ name: "launch", status: "ok", ms: 1, screenshots: ["/abs/secret.png"], detail: "d" }],
  }, {
    "debug.md": "# 가설\n- 원인",
    "events.ndjson": '{"kind":"a"}\nnot-json\n{"kind":"b"}\n',
    "note.pdf": "%PDF",
  });
  fs.writeFileSync(path.join(dir, "mis-sol-hai-1.log"), "l1\nl2\n");
  const run = scanRuns(dir, "mis-sol-hai-")[0];
  const row = runRow(dir, run, null);
  assert.equal(row.name, "mis-sol-hai-1");
  assert.equal(row.result, "ok");
  assert.equal(row.version, "2.8.0.4");
  assert.deepEqual(row.report.steps, [{ name: "launch", status: "ok", ms: 1, detail: "d" }], "screenshots 제거");
  assert.ok(row.ended_at, "결과 있으면 report mtime이 끝");
  assert.equal(row.debug_md, "# 가설\n- 원인");
  assert.equal(row.log_tail, "l1\nl2");
  assert.deepEqual(row.events_tail, [{ kind: "a" }, "not-json", { kind: "b" }]);
  assert.equal(row.has_note_pdf, true);
});

test("진행 중 run의 끝 시각은 다음 run 시작, 둘 다 없으면 null", () => {
  const { dir, mk } = fixture();
  mk("mis-sol-hai-1", { startedAt: "2026-10-10T01:00:00Z" });          // 진행 중 + 다음 run 있음
  mk("mis-sol-hai-2", { startedAt: "2026-10-10T02:00:00Z" });          // 진행 중 + 마지막
  const runs = scanRuns(dir, "mis-sol-hai-");
  const rows = runs.map((r, i) => runRow(dir, r, runs[i + 1]?.startMs ?? null));
  assert.equal(rows[0].ended_at, "2026-10-10T02:00:00.000Z");
  assert.equal(rows[1].ended_at, null);
});

test("upsertSql은 작은따옴표를 이스케이프하고 멱등 upsert다", () => {
  const sql = upsertSql([{
    name: "mis-sol-hai-1", started_at: "2026-10-10T01:00:00.000Z", ended_at: null,
    version: "2.8.0.4", result: "ok", report: { steps: [] },
    debug_md: "it's --fine", log_tail: null, events_tail: [], has_note_pdf: false,
  }]);
  assert.match(sql, /insert into engine_runs/);
  assert.match(sql, /on conflict \(name\) do update/);
  assert.match(sql, /'it''s --fine'/);
  assert.match(sql, /null::timestamptz/);
});
