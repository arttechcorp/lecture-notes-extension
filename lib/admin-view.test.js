const test = require("node:test");
const assert = require("node:assert/strict");
const { summarize, lanes, filterEvents } = require("../admin.js");

// summarize: 단계별 상태 카운터와 오류 수 집계
test("summarize counts statuses per stage and errors", () => {
  const events = [
    { ts: 1, stage: "capture", spanId: "s1", status: "running" },
    { ts: 2, stage: "capture", spanId: "s1", status: "done", ms: 1000 },
    { ts: 3, stage: "capture", spanId: "s2", status: "queued" },
    { ts: 4, stage: "ocr", spanId: "s3", status: "failed", ms: 5, code: "OCR_TIMEOUT" },
    { ts: 5, stage: "ocr", level: "error", msg: "boom" },
    { ts: 6, stage: "asr", status: "skipped" },
  ];
  const s = summarize(events);
  assert.deepEqual(s.stages.capture, { queued: 1, running: 1, done: 1, failed: 0, skipped: 0 });
  assert.deepEqual(s.stages.ocr, { queued: 0, running: 0, done: 0, failed: 1, skipped: 0 });
  assert.deepEqual(s.stages.asr, { queued: 0, running: 0, done: 0, failed: 0, skipped: 1 });
  assert.equal(s.errors, 1);
});

// summarize: 종료 이벤트가 없는 running 스팬만 open으로 나온다
test("summarize reports only running spans without a terminal event", () => {
  const events = [
    { ts: 10, stage: "ocr", spanId: "a", unit: "f1", status: "running" },
    { ts: 11, stage: "ocr", spanId: "b", unit: "f2", status: "running" },
    { ts: 12, stage: "ocr", spanId: "a", status: "done", ms: 2000 },
  ];
  const s = summarize(events);
  assert.equal(s.open.length, 1);
  assert.deepEqual(s.open[0], { spanId: "b", stage: "ocr", unit: "f2", start: 11 });
});

// lanes: 창 밖 스팬 배제, 경계에 걸친 스팬 포함, running 없는 종료 이벤트는 ts-ms로 시작
test("lanes clips to the window and backs off start for terminal-only spans", () => {
  const now = 1000000, windowMs = 600000; // 창: 400000 ~ 1000000
  const events = [
    { ts: now - 300000, stage: "capture", spanId: "s1", unit: "u1", status: "running" },
    { ts: now - 200000, stage: "capture", spanId: "s1", status: "done", ms: 100000 },
    { ts: now - 100000, stage: "ocr", spanId: "s2", status: "running" },                 // 아직 열림
    { ts: now - 50000, stage: "asr", spanId: "s3", status: "failed", ms: 30000, code: "X" }, // running 없음
    { ts: now - 700000, stage: "asr", spanId: "s4", status: "running" },                // 창 시작 전에 시작, 안에서 끝남
    { ts: now - 100000, stage: "asr", spanId: "s4", status: "done", ms: 600000 },
    { ts: now - 700000, stage: "capture", spanId: "old", status: "running" },           // 창 밖에서 끝남
    { ts: now - 650000, stage: "capture", spanId: "old", status: "done", ms: 50000 },
  ];
  const rows = lanes(events, { now, windowMs });
  assert.deepEqual(rows.map(r => r.spanId), ["s4", "s3", "s1", "s2"]); // stage → start 정렬

  const s3 = rows[1]; // running 없는 종료 이벤트: start = ts - ms
  assert.equal(s3.start, now - 50000 - 30000);
  assert.equal(s3.end, now - 50000);
  assert.equal(s3.status, "failed");
  assert.equal(s3.code, "X");

  const s2 = rows[3]; // 열린 스팬
  assert.equal(s2.end, null);
  assert.equal(s2.status, "running");
  assert.equal(s2.start, now - 100000);
});

// lanes: now를 생략하면 현재 시각 기준 — NaN 창으로 모든 스팬이 사라지면 안 된다
test("lanes defaults now to the current time", () => {
  const t = Date.now();
  const rows = lanes([{ ts: t - 1000, stage: "ocr", spanId: "x", status: "running" }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].end, null);
});

// filterEvents: 레벨 하한, stage/jobId 정확 일치, msg·code 대소문자 무시 부분 검색
test("filterEvents filters by level, stage, jobId and text", () => {
  const events = [
    { ts: 1, stage: "capture", jobId: "j1", level: "debug", msg: "tick" },
    { ts: 2, stage: "capture", jobId: "j1", level: "info", msg: "frame", code: "OK" },
    { ts: 3, stage: "ocr", jobId: "j1", level: "warn", msg: "slow" },
    { ts: 4, stage: "ocr", jobId: "j2", level: "error", msg: "boom", code: "OCR_TIMEOUT" },
    { ts: 5, stage: "asr", jobId: "j2", msg: "done" }, // level 없음 → info 취급
  ];
  assert.equal(filterEvents(events).length, 5);
  assert.deepEqual(filterEvents(events, { minLevel: "warn" }).map(e => e.ts), [3, 4]);
  assert.deepEqual(filterEvents(events, { stage: "ocr" }).map(e => e.ts), [3, 4]);
  assert.deepEqual(filterEvents(events, { jobId: "j2" }).map(e => e.ts), [4, 5]);
  assert.deepEqual(filterEvents(events, { text: "timeout" }).map(e => e.ts), [4]); // code도 검색
  assert.deepEqual(filterEvents(events, { text: "BOOM" }).map(e => e.ts), [4]);   // 대소문자 무시
  assert.equal(filterEvents(events, { minLevel: "error", stage: "capture" }).length, 0);
});
