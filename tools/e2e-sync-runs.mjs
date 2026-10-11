#!/usr/bin/env node
// e2e-sync-runs.mjs — 로컬 e2e run 폴더 스냅샷을 Supabase engine_runs 에 올린다.
// landing/engine-debug (/engine-debug) 가 이 표를 어드민 RPC 로 읽는다.
//
//   node tools/e2e-sync-runs.mjs [--prefix mis-sol-hai-] [--watch <sec>]
//
// 읽기: $LECTURE_E2E_RUNS(기본 ~/.lecture-e2e/runs) 아래 <prefix>로 시작하는 "폴더".
// 쓰기: `supabase db query --linked`(repo cwd, postgres 롤이라 RLS 우회). engine_runs 만 건드린다.
// 올리는 것: report.json(스크린샷 경로 제거), debug.md, <run>.log 꼬리 20줄, events.ndjson 꼬리 6개.
// 노트 본문·스크린샷·강의 원문은 올리지 않는다.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const REPO = process.env.LECTURE_REPO || path.resolve(import.meta.dirname, '..');
const RUNS = process.env.LECTURE_E2E_RUNS || path.join(os.homedir(), '.lecture-e2e', 'runs');
const LOG_TAIL = 20;
const EVENTS_TAIL = 6;

const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : dflt;
};

const readJson = p => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };

function tailLines(p, n) {
  try {
    return fs.readFileSync(p, 'utf8').replace(/\s+$/, '').split('\n').filter(l => l.length).slice(-n);
  } catch { return []; }
}

// 이름이 prefix로 시작하는 run 폴더 목록(시작 시각 오름차순). <run>.log 같은 파일은 제외.
export function scanRuns(runsDir, prefix) {
  let ents;
  try { ents = fs.readdirSync(runsDir, { withFileTypes: true }); }
  catch { return []; }
  const runs = [];
  for (const e of ents) {
    if (!e.isDirectory() || !e.name.startsWith(prefix)) continue;
    const dir = path.join(runsDir, e.name);
    const rp = path.join(dir, 'report.json');
    const report = readJson(rp);
    let reportMtime = null, dirMtime = 0;
    try { reportMtime = fs.statSync(rp).mtimeMs; } catch {}
    try { dirMtime = fs.statSync(dir).mtimeMs; } catch {}
    const startMs = report?.startedAt ? Date.parse(report.startedAt) : dirMtime;
    runs.push({ name: e.name, dir, report, reportMtime, startMs });
  }
  runs.sort((a, b) => a.startMs - b.startMs);
  return runs;
}

// run 한 개의 upsert 행. nextStartMs = 시간상 다음 run 의 시작(없으면 null).
// 끝 시각: 결과가 있으면 report mtime, 없고 다음 run 이 있으면 그 시작, 둘 다 없으면 null(진행 중 → now()).
export function runRow(runsDir, run, nextStartMs) {
  const rep = run.report || {};
  const report = { ...rep };
  if (Array.isArray(report.steps))
    report.steps = report.steps.map(({ screenshots, ...s }) => s);
  let endedAt = null;
  if (rep.result && run.reportMtime) endedAt = run.reportMtime;
  else if (nextStartMs != null && nextStartMs > run.startMs) endedAt = nextStartMs;
  const events = tailLines(path.join(run.dir, 'events.ndjson'), EVENTS_TAIL)
    .map(l => { try { return JSON.parse(l); } catch { return l; } });
  return {
    name: run.name,
    started_at: new Date(run.startMs).toISOString(),
    ended_at: endedAt == null ? null : new Date(endedAt).toISOString(),
    version: rep.version ?? null,
    result: rep.result ?? null,
    report,
    debug_md: (() => { try { return fs.readFileSync(path.join(run.dir, 'debug.md'), 'utf8'); } catch { return null; } })(),
    log_tail: tailLines(path.join(runsDir, run.name + '.log'), LOG_TAIL).join('\n') || null,
    events_tail: events,
    has_note_pdf: fs.existsSync(path.join(run.dir, 'note.pdf')),
  };
}

const q = v => v == null ? 'null' : `'${String(v).replace(/'/g, "''")}'`;
const qj = v => v == null ? 'null' : `${q(JSON.stringify(v))}::jsonb`;

export function upsertSql(rows) {
  const vals = rows.map(r =>
    `(${q(r.name)},${q(r.started_at)}::timestamptz,${q(r.ended_at)}::timestamptz,${q(r.version)},${q(r.result)},` +
    `${qj(r.report)},${q(r.debug_md)},${q(r.log_tail)},${qj(r.events_tail)},${r.has_note_pdf})`);
  return `insert into engine_runs (name, started_at, ended_at, version, result, report, debug_md, log_tail, events_tail, has_note_pdf)
values ${vals.join(',\n')}
on conflict (name) do update set started_at = excluded.started_at, ended_at = excluded.ended_at,
  version = excluded.version, result = excluded.result, report = excluded.report,
  debug_md = excluded.debug_md, log_tail = excluded.log_tail, events_tail = excluded.events_tail,
  has_note_pdf = excluded.has_note_pdf, updated_at = now();`;
}

export function syncOnce(runsDir, prefix) {
  const runs = scanRuns(runsDir, prefix);
  const rows = runs.map((r, i) => runRow(runsDir, r, runs[i + 1]?.startMs ?? null));
  if (!rows.length) return 0;
  execFileSync('supabase', ['db', 'query', '--linked', upsertSql(rows)],
    { cwd: REPO, encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'pipe'] });
  return rows.length;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const prefix = arg('--prefix', 'mis-sol-hai-');
  const watch = Number(arg('--watch', 0));
  if (!watch) {
    console.log(`synced ${syncOnce(RUNS, prefix)} runs`);
  } else {
    for (;;) {
      try { console.log(`${new Date().toISOString()} synced ${syncOnce(RUNS, prefix)} runs`); }
      catch (e) { console.error('sync failed:', e.message); }
      await new Promise(r => setTimeout(r, watch * 1000));
    }
  }
}
