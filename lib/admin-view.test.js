const test = require("node:test");
const assert = require("node:assert/strict");
const { summarize, lanes, filterEvents, jobSummary, classifyRecord, redactUrl, pickCandidate, refererVerdict, rangeVerdict, buildReport, diagnoseSource } = require("../admin.js");

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

// redactUrl: 쿼리·해시·자격증명 제거, 포트 유지, 24자 이상 토큰 구간 마스킹
test("redactUrl strips secrets and masks token-like path segments", () => {
  assert.deepEqual(
    redactUrl("https://user:pw@cdn.example.com:8443/a/abcdefghijklmnopqrstuvwxyz12/master.m3u8?token=abc#frag"),
    { host: "cdn.example.com:8443", path: "/a/…/master.m3u8" });
  assert.deepEqual(redactUrl("https://h.example/abcd1234abcd1234abcd1234/x"), { host: "h.example", path: "/…/x" }); // 24자 → 마스킹
  assert.deepEqual(redactUrl("https://h.example/abcd1234abcd1234abcd123/x"), { host: "h.example", path: "/abcd1234abcd1234abcd123/x" }); // 23자 → 유지
  assert.deepEqual(redactUrl("file:///etc/passwd"), { host: "", path: "" });
  assert.deepEqual(redactUrl("not a url"), { host: "", path: "" });
  assert.deepEqual(redactUrl(null), { host: "", path: "" });
  assert.deepEqual(redactUrl(42), { host: "", path: "" });
});

// pickCandidate: 종류 우선순위, hls 점수(master 보너스·깊이), mp4 크기, 비-2xx 제외
test("pickCandidate applies kind priority, hls score, mp4 size and status filter", () => {
  for (const bad of [undefined, null, 42, true, "x", {}, [null, 5, "u"]]) assert.equal(pickCandidate(bad), null, "잘못된 입력은 null이다");
  const variant = { url: "https://a.com/x/y/z/v720.m3u8", kind: "hls", status: 200 };      // 깊이 4 → 80점
  const master = { url: "https://a.com/master.m3u8", kind: "hls", status: 200 };           // 깊이 1 + master → 115점
  const dash = { url: "https://a.com/m.mpd", kind: "dash" };
  const mp4 = { url: "https://a.com/a.mp4", kind: "mp4", size: 100 };
  assert.equal(pickCandidate([variant, master, dash, mp4]), master);   // master가 깊은 변형을 이긴다
  assert.equal(pickCandidate([dash, mp4]), dash);                      // dash > mp4
  assert.equal(pickCandidate([mp4, dash]), dash);                      // 순서와 무관하게 종류 우선

  const small = { url: "https://a.com/s.mp4", kind: "mp4", size: 10 };
  const big = { url: "https://a.com/b.mp4", kind: "mp4", size: 99 };
  assert.equal(pickCandidate([small, big]), big);
  assert.equal(pickCandidate([{ url: "https://a.com/u.mp4", kind: "mp4" }, small]), small); // 크기 모름=0

  assert.equal(pickCandidate([{ url: "https://a.com/x.mp4", kind: "mp4", status: 404 }, { url: "https://a.com/y.mp4", kind: "mp4" }]).url, "https://a.com/y.mp4");
  assert.equal(pickCandidate([{ url: "https://a.com/x.mp4", kind: "mp4", status: 500 }, { url: "https://a.com/y.mp4", kind: "mp4", status: 0 }]).url, "https://a.com/y.mp4"); // 0=모름 허용

  const d1 = { url: "https://a.com/1.mpd", kind: "dash" }, d2 = { url: "https://a.com/2.mpd", kind: "dash" };
  assert.equal(pickCandidate([d1, d2]), d1); // 동률은 먼저 온 쪽
  assert.equal(pickCandidate([]), null);
  assert.equal(pickCandidate(null), null);
  assert.equal(pickCandidate([null, 5, { url: 1 }, { url: "https://a.com/x.txt" }]), null);
  const orig = { url: "https://a.com/m.m3u8", kind: "hls" };
  assert.equal(pickCandidate([orig]), orig); // 복사가 아니라 원래 객체
});

// refererVerdict / rangeVerdict 진리표
test("refererVerdict and rangeVerdict truth tables", () => {
  assert.equal(refererVerdict({ plainStatus: 200 }), "not-required");
  assert.equal(refererVerdict({ plainStatus: 204, withRefererStatus: 500 }), "not-required");
  assert.equal(refererVerdict({ plainStatus: 403, withRefererStatus: 200 }), "required");
  assert.equal(refererVerdict({ plainStatus: 403 }), "unknown");
  assert.equal(refererVerdict({ plainStatus: 403, withRefererStatus: null }), "unknown");
  assert.equal(refererVerdict({ plainStatus: 403, withRefererStatus: 401 }), "unknown");
  assert.equal(refererVerdict({}), "unknown");

  assert.equal(rangeVerdict({ status: 206 }), "supported");
  assert.equal(rangeVerdict({ status: 200, acceptRanges: "bytes" }), "ignored");
  assert.equal(rangeVerdict({ status: 404 }), "error");
  assert.equal(rangeVerdict({ status: 503 }), "error");
  assert.equal(rangeVerdict({ status: 302 }), "unknown");
  assert.equal(rangeVerdict({ status: null }), "unknown");
  assert.equal(rangeVerdict({}), "unknown");
});

// buildReport: 쿼리·토큰이 리포트 JSON에 남지 않고, 샘플·메모 상한 적용
test("buildReport never leaks queries or tokens and applies caps", () => {
  const tok = "a1b2c3d4e5f6a1b2c3d4e5f6"; // 24자 토큰형 구간
  const req = { url: "https://cdn.example.com/" + tok + "/master.m3u8?token=abc&sig=zz", kind: "hls", status: 200, mime: "application/x-mpegurl" };
  const r = buildReport({
    pageUrl: "https://lms.example.com/view.php?id=7&token=pp",
    requests: Array(12).fill(req), candidate: { ...req }, verdict: "ok",
    notes: ["x".repeat(300), ...Array(12).fill("n")], at: 0,
  });
  const json = JSON.stringify(r);
  assert.ok(!json.includes(tok));
  assert.ok(!json.includes("token="));
  assert.ok(!json.includes("sig=zz"));
  assert.ok(!json.includes("id=7"));
  assert.equal(r.site, "lms.example.com");
  assert.equal(r.tool, "source-diagnostic");
  assert.equal(r.version, 1);
  assert.equal(r.at, new Date(0).toISOString());
  assert.equal(r.observed.total, 12);
  assert.deepEqual(r.observed.byKind, { hls: 12, dash: 0, mp4: 0 });
  assert.equal(r.observed.sample.length, 8);
  assert.equal(r.notes.length, 8);
  assert.equal(r.notes[0].length, 160);

  const d = buildReport({ pageUrl: "not a url", verdict: "no-source" });
  assert.equal(d.site, "");
  assert.deepEqual(d.protection, { detected: false, reason: null });
  assert.equal(d.playlist, null);
  assert.equal(d.candidate, null);
  assert.deepEqual(d.notes, []);
});

// diagnoseSource용 가짜 fetch: URL→응답 라우트(배열이면 순차 소비)와 호출 기록
function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url, init });
    let r = routes[url];
    if (Array.isArray(r)) r = r.shift();
    if (!r) throw new Error("unexpected fetch " + url);
    if (r.throw) throw r.throw;
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status, url,
      headers: { get: n => (r.headers || {})[String(n).toLowerCase()] ?? null },
      text: async () => r.text ?? "",
      body: { cancel: async () => { r.bodyCancelled = true; } },
    };
  };
  return { fn, calls };
}

const MASTER_TEXT = `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="ko",DEFAULT=YES,URI="audio.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=854x480,AUDIO="aud"
v480.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2400000,RESOLUTION=1280x720,AUDIO="aud"
v720.m3u8
#EXT-X-I-FRAME-STREAM-INF:BANDWIDTH=90000,RESOLUTION=1280x720,URI="iframe.m3u8"
`;
const SIMPLE_MASTER = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=2400000,RESOLUTION=1280x720
v720.m3u8
`;
const MEDIA_TEXT = `#EXTM3U
#EXT-X-TARGETDURATION:6
#EXTINF:6,
seg0.ts
#EXTINF:6,
seg1.ts
#EXTINF:6,
seg2.ts
#EXT-X-ENDLIST
`;
const ONE_SEG_MEDIA = `#EXTM3U
#EXT-X-TARGETDURATION:6
#EXTINF:6,
seg0.ts
#EXT-X-ENDLIST
`;

// 깨끗한 HLS: master → 720p 미디어 재생목록 → 첫 세그먼트 Range 시험, 정확히 3요청
test("diagnoseSource follows a clear HLS master to rendition and Range probe", async () => {
  const M = "https://cdn.example.com/live/master.m3u8";
  const V = "https://cdn.example.com/live/v720.m3u8";
  const S = "https://cdn.example.com/live/seg0.ts";
  const routes = {
    [M]: { status: 200, text: MASTER_TEXT },
    [V]: { status: 200, text: MEDIA_TEXT },
    [S]: { status: 206, headers: { "content-range": "bytes 0-1023/123456", "accept-ranges": "bytes" } },
  };
  const { fn, calls } = fakeFetch(routes);
  const r = await diagnoseSource({ requests: [{ url: M, kind: "hls", status: 200 }], pageUrl: "https://lms.example.com/course", ownTabId: 7, fetchFn: fn });
  assert.equal(r.verdict, "ok");
  assert.equal(r.renditions.selected.height, 720);
  assert.equal(r.renditions.audioSeparate, true);
  assert.equal(r.iframe.available, true);
  assert.equal(r.iframe.count, 1);
  assert.equal(r.range.verdict, "supported");
  assert.equal(r.referer.verdict, "not-required");
  assert.equal(r.playlist.type, "master");
  assert.equal(r.playlist.segments, 3);
  assert.equal(r.playlist.live, false);
  // I-frame 재생목록·오디오·키는 요청하지 않는다
  assert.deepEqual(calls.map(c => c.url), [M, V, S]);
  assert.equal(calls[2].init.headers.Range, "bytes=0-1023");
});

// 미디어 재생목록의 EXT-X-KEY: 키 URI도 세그먼트도 요청하지 않고 중단
test("diagnoseSource stops on EXT-X-KEY without requesting key or segment", async () => {
  const PL = "https://cdn.example.com/e/playlist.m3u8";
  const text = `#EXTM3U
#EXT-X-TARGETDURATION:6
#EXT-X-KEY:METHOD=AES-128,URI="https://keys.example.com/k.bin"
#EXTINF:6,
seg0.ts
#EXT-X-ENDLIST
`;
  const { fn, calls } = fakeFetch({ [PL]: { status: 200, text } });
  const r = await diagnoseSource({ requests: [{ url: PL, kind: "hls" }], pageUrl: "https://lms.example.com/x", fetchFn: fn });
  assert.equal(r.verdict, "protected");
  assert.ok(r.protection.detected);
  assert.ok(r.protection.reason.startsWith("EXT-X-KEY"));
  assert.deepEqual(calls.map(c => c.url), [PL]);
});

// master의 EXT-X-SESSION-KEY: 변형 재생목록을 받기 전에 중단 — 정확히 1요청
test("diagnoseSource stops on EXT-X-SESSION-KEY in the master playlist", async () => {
  const M = "https://cdn.example.com/k/master.m3u8";
  const text = `#EXTM3U
#EXT-X-SESSION-KEY:METHOD=AES-128,URI="https://keys.example.com/k"
#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1280x720
v720.m3u8
`;
  const { fn, calls } = fakeFetch({ [M]: { status: 200, text } });
  const r = await diagnoseSource({ requests: [{ url: M, kind: "hls" }], pageUrl: "https://lms.example.com/x", fetchFn: fn });
  assert.equal(r.verdict, "protected");
  assert.ok(r.protection.reason.startsWith("EXT-X-SESSION-KEY"));
  assert.deepEqual(calls.map(c => c.url), [M]);
});

// Range를 무시하는 서버(200 응답): ignored 판정 + 본문 취소
test("diagnoseSource marks Range-ignoring servers and cancels the body", async () => {
  const PL = "https://cdn.example.com/rg/playlist.m3u8";
  const SEG = "https://cdn.example.com/rg/seg0.ts";
  const routes = { [PL]: { status: 200, text: ONE_SEG_MEDIA }, [SEG]: { status: 200 } };
  const { fn, calls } = fakeFetch(routes);
  const r = await diagnoseSource({ requests: [{ url: PL, kind: "hls" }], pageUrl: "https://lms.example.com/x", fetchFn: fn });
  assert.equal(r.verdict, "ok");
  assert.equal(r.range.verdict, "ignored");
  assert.equal(r.range.status, 200);
  assert.equal(routes[SEG].bodyCancelled, true);
  assert.deepEqual(calls.map(c => c.url), [PL, SEG]);
});

// Referer 비교: 403 → DNR 세션 규칙(이 탭 범위) 설치 후 200 → required
test("diagnoseSource runs the Referer comparison via a scoped DNR session rule", async () => {
  const M = "https://cdn.example.com/r/master.m3u8";
  const routes = {
    [M]: [{ status: 403, text: "denied" }, { status: 200, text: SIMPLE_MASTER }],
    "https://cdn.example.com/r/v720.m3u8": { status: 200, text: ONE_SEG_MEDIA },
    "https://cdn.example.com/r/seg0.ts": { status: 206, headers: { "content-range": "bytes 0-1023/2000" } },
  };
  const { fn } = fakeFetch(routes);
  const ops = [];
  const dnr = { updateSessionRules: async o => { ops.push(o); } };
  const r = await diagnoseSource({ requests: [{ url: M, kind: "hls" }], pageUrl: "https://lms.example.com/lecture/1", ownTabId: 42, fetchFn: fn, dnr });
  assert.equal(r.verdict, "ok");
  assert.deepEqual(r.referer, { verdict: "required", plainStatus: 403, withRefererStatus: 200 });
  const rule = ops[0].addRules[0];
  assert.equal(rule.id, 900001);
  assert.deepEqual(rule.condition.tabIds, [42]);
  assert.deepEqual(rule.condition.requestDomains, ["cdn.example.com"]);
  assert.deepEqual(ops.at(-1).removeRuleIds, [900001]);

  // 재시도가 던져도 규칙은 반드시 제거된다
  const f2 = fakeFetch({ [M]: [{ status: 403 }, { throw: new Error("down") }] });
  const ops2 = [];
  const r2 = await diagnoseSource({ requests: [{ url: M, kind: "hls" }], pageUrl: "https://lms.example.com/lecture/1", ownTabId: 42, fetchFn: f2.fn, dnr: { updateSessionRules: async o => { ops2.push(o); } } });
  assert.equal(r2.verdict, "error");
  assert.equal(ops2.length, 2);
  assert.deepEqual(ops2[1].removeRuleIds, [900001]);
});

// dnr 없이 403: 재시도 없이 fetch-failed, referer는 unknown, 정확히 1요청
test("diagnoseSource without dnr reports fetch-failed and unknown referer", async () => {
  const M = "https://cdn.example.com/f/master.m3u8";
  const { fn, calls } = fakeFetch({ [M]: { status: 403, text: "denied" } });
  const r = await diagnoseSource({ requests: [{ url: M, kind: "hls" }], pageUrl: "https://lms.example.com/x", fetchFn: fn });
  assert.equal(r.verdict, "fetch-failed");
  assert.deepEqual(r.referer, { verdict: "unknown", plainStatus: 403, withRefererStatus: null });
  assert.equal(calls.length, 1);
});

// 단일 mp4: Range 시험 1요청뿐, DRM은 판별하지 않는다
test("diagnoseSource probes a single mp4 with one Range request", async () => {
  const U = "https://cdn.example.com/v/lecture.mp4";
  const routes = { [U]: { status: 206, headers: { "content-range": "bytes 0-1023/9999" } } };
  const { fn, calls } = fakeFetch(routes);
  const r = await diagnoseSource({ requests: [{ url: U, kind: "mp4", size: 5000 }], pageUrl: "https://lms.example.com/x", fetchFn: fn });
  assert.equal(r.verdict, "ok");
  assert.equal(r.protection.checked, "n/a");
  assert.equal(r.range.verdict, "supported");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.headers.Range, "bytes=0-1023");
});

// 후보 없음 → no-source; 던진 오류의 URL은 리포트에서 지워진다
test("diagnoseSource reports no-source and scrubs URLs from thrown errors", async () => {
  const r1 = await diagnoseSource({ requests: [{ kind: "text" }, null], pageUrl: "https://x.example", fetchFn: async () => { throw new Error("unused"); } });
  assert.equal(r1.verdict, "no-source");
  assert.equal(r1.candidate, null);

  const r2 = await diagnoseSource({
    requests: [{ url: "https://cdn.example.com/live/master.m3u8?token=abc", kind: "hls" }],
    pageUrl: "https://lms.example.com/p?token=secret",
    fetchFn: async () => { throw new Error("failed https://cdn.example.com/live/master.m3u8?token=abc"); },
  });
  assert.equal(r2.verdict, "error");
  const json = JSON.stringify(r2);
  assert.ok(!json.includes("token=abc"));
  assert.ok(!json.includes("token=secret"));
});

// DASH ContentProtection: 1요청 후 중단
test("diagnoseSource stops on DASH ContentProtection", async () => {
  const U = "https://cdn.example.com/d/manifest.mpd";
  const mpd = '<?xml version="1.0"?><MPD><Period><AdaptationSet><ContentProtection schemeIdUri="urn:mpeg:dash:mp4protection:2011"/></AdaptationSet></Period></MPD>';
  const { fn, calls } = fakeFetch({ [U]: { status: 200, text: mpd } });
  const r = await diagnoseSource({ requests: [{ url: U, kind: "dash" }], pageUrl: "https://lms.example.com/x", fetchFn: fn });
  assert.equal(r.verdict, "protected");
  assert.equal(r.protection.reason, "DASH ContentProtection");
  assert.equal(calls.length, 1);
});

// jobSummary: jobId별 그룹(없는 이벤트는 무시), 비용·모델·코드 집계, 단계별 ms·호출·실패, 시작 역순
test("jobSummary groups by jobId and aggregates cost, models and codes", () => {
  const events = [
    { ts: 1000, jobId: "j-b", stage: "job", msg: "created" },
    { ts: 1010, jobId: "j-b", stage: "job", msg: "created>ingesting" },
    { ts: 1100, jobId: "j-b", stage: "stt", spanId: "s1", status: "done", ms: 90, costUsd: 0.01, model: "stt-1" },
    { ts: 1200, jobId: "j-b", stage: "stt", spanId: "s2", status: "skipped", ms: 5 },
    { ts: 1300, jobId: "j-b", stage: "job", msg: "ingesting>done" },
    { ts: 2000, jobId: "j-a", stage: "vision", spanId: "v1", status: "failed", ms: 40, code: "VIS_BAD_SCHEMA", level: "error", costUsd: 0.02, model: "v-1" },
    { ts: 2100, jobId: "j-a", stage: "vision", spanId: "v2", status: "done", ms: 60, code: "VIS_BAD_SCHEMA", costUsd: 0.02 },
    { ts: 2200, jobId: "j-a", stage: "vision", spanId: "v3", status: "done", ms: 10, code: "NET_UNREACHABLE" },
    { ts: 2300, stage: "stt", status: "done" }, // jobId 없음 — 무시된다
  ];
  const js = jobSummary(events);
  assert.deepEqual(js.map(j => j.jobId), ["j-a", "j-b"]); // 시작 시각 역순
  const a = js[0];
  assert.equal(a.calls, 3);
  assert.ok(Math.abs(a.costUsd - 0.04) < 1e-9);
  assert.deepEqual(a.models, ["v-1"]);
  assert.deepEqual(a.codes, [{ code: "VIS_BAD_SCHEMA", count: 2 }, { code: "NET_UNREACHABLE", count: 1 }]); // 횟수 내림차순
  assert.equal(a.errors, 1);
  assert.deepEqual(a.stages.vision, { ms: 110, calls: 3, failed: 1 });
  assert.equal(a.state, "failed"); // 코드 있는 오류가 있고 뒤에 done이 없다
  const b = js[1];
  assert.equal(b.calls, 2); // done + skipped 둘 다 종료 스팬이다
  assert.deepEqual(b.stages.stt, { ms: 95, calls: 2, failed: 0 });
  assert.equal(b.totalMs, 300);
  assert.equal(b.state, "done"); // job 전이 메시지가 정본이다
});

// jobSummary 비용: 보고 없음은 null(미측정), 실제 $0 은 0. 비용 분모(costCalls)는 requestId 를 가진
// 실제 외부 호출만 센다 — 정제·렌더·job 전이 같은 상태 스팬은 분모가 아니라 거의 항상 부분으로 오판되지 않는다.
test("jobSummary distinguishes missing cost from true zero and partial reports", () => {
  // 상태 스팬만 있는 작업 — requestId 없는 이벤트는 외부 호출이 아니다
  const none = jobSummary([
    { ts: 1, jobId: "a", stage: "refining", status: "done", ms: 5 },
    { ts: 2, jobId: "a", stage: "rendering", status: "done", ms: 5 },
    { ts: 3, jobId: "a", stage: "job", msg: "ingesting>done" },
  ])[0];
  assert.equal(none.costUsd, null);   // 미보고는 0원이 아니다
  assert.equal(none.costObs, 0);
  assert.equal(none.costCalls, 0);
  assert.equal(none.calls, 2);        // 호출 수 스팬 집계는 그대로다

  const zero = jobSummary([{ ts: 1, jobId: "a", stage: "stt", status: "done", costUsd: 0 }])[0];
  assert.equal(zero.costUsd, 0);      // 실제 $0 보고는 0 — null 이 아니다
  assert.equal(zero.costObs, 1);
  assert.equal(zero.costCalls, 1);    // requestId 없는 비용 보고도 호출 1건

  // 부분 보고: requestId 가 있는 외부 호출 2건 중 1건만 비용 보고
  const part = jobSummary([
    { ts: 1, jobId: "a", stage: "stt", status: "done", requestId: "stt-x1", costUsd: 0.01 },
    { ts: 2, jobId: "a", stage: "stt", status: "running", requestId: "stt-x1" }, // 같은 호출 — 중복 집계 안 함
    { ts: 3, jobId: "a", stage: "vision", status: "done", requestId: "vision-y2" }, // 비용 미보고 외부 호출
    { ts: 4, jobId: "a", stage: "refining", status: "done" },                      // 상태 스팬 — 분모 아님
  ])[0];
  assert.equal(part.costUsd, 0.01);   // 보고된 것만 합산
  assert.equal(part.costObs, 1);
  assert.equal(part.costCalls, 2);    // 외부 호출 stt-x1·vision-y2 둘 — 상태 스팬 제외

  // 전부 보고: 재시도 requestId 는 별도 호출로 센다
  const full = jobSummary([
    { ts: 1, jobId: "a", stage: "judge", status: "done", requestId: "jdg-1", costUsd: 0.02 },
    { ts: 2, jobId: "a", stage: "judge", status: "done", requestId: "jdg-1-r1", costUsd: 0.03 },
  ])[0];
  assert.ok(Math.abs(full.costUsd - 0.05) < 1e-9);
  assert.equal(full.costObs, 2);
  assert.equal(full.costCalls, 2);
});

// admin.js 전역 이름: AdminView(lib/admin-view.js 비교 화면 API)를 덮어쓰지 않고 AdminDiag 를 쓴다
test("admin.js exports diagnostics as AdminDiag without clobbering globalThis.AdminView", () => {
  const prev = globalThis.AdminView;
  globalThis.AdminView = { sentinel: true };
  try {
    delete require.cache[require.resolve("../admin.js")];
    const api = require("../admin.js");
    assert.equal(globalThis.AdminView.sentinel, true); // 비교 화면 API 를 덮어쓰지 않는다
    assert.equal(globalThis.AdminDiag, api);           // 진단 API 는 AdminDiag 이름으로만 나간다
    assert.equal(typeof api.jobSummary, "function");
  } finally {
    globalThis.AdminView = prev;
    delete require.cache[require.resolve("../admin.js")];
    require("../admin.js");
  }
});

// jobSummary 상태 추론: job 메시지 > 오류(코드) + 늦은 done 없음 > rendering·job done 스팬 > running
test("jobSummary infers state from job msg and terminal events", () => {
  assert.equal(jobSummary([{ ts: 1, jobId: "a", stage: "recv", status: "running" }])[0].state, "running");
  assert.equal(jobSummary([{ ts: 1, jobId: "a", stage: "job", msg: "writing>failed" }])[0].state, "failed");
  assert.equal(jobSummary([{ ts: 1, jobId: "a", stage: "job", msg: "planning>paused:quota" }])[0].state, "paused");
  assert.equal(jobSummary([{ ts: 1, jobId: "a", stage: "rendering", status: "done", ms: 5 }])[0].state, "done");
  // 코드 있는 오류 뒤 done이 오면 실패가 아니다
  const evs = [
    { ts: 1, jobId: "a", level: "error", code: "VIS_BAD_SCHEMA", stage: "vision" },
    { ts: 2, jobId: "a", stage: "rendering", status: "done" },
  ];
  assert.equal(jobSummary(evs)[0].state, "done");
  // 코드 없는 오류만 있으면 실패로 보지 않는다
  assert.equal(jobSummary([{ ts: 1, jobId: "a", level: "error", stage: "vision" }])[0].state, "running");
  // 중간 단계 전이는 종료 상태가 아니다 — 추론으로 돌아간다
  assert.equal(jobSummary([{ ts: 1, jobId: "a", stage: "job", msg: "judging>planning" }])[0].state, "running");
});

// classifyRecord: 레코드 id로 종류를 나누고 모양으로 단계를 알아낸다
test("classifyRecord maps record ids to kinds", () => {
  assert.equal(classifyRecord("meta", { title: "t" }).kind, "meta");
  assert.equal(classifyRecord("note", { sections: [] }).kind, "note");
  assert.equal(classifyRecord("input", { slides: [] }).kind, "input");
  assert.equal(classifyRecord("sd:12", { blocks: [] }).kind, "slide");
  assert.equal(classifyRecord("tr:0", { segments: [] }).kind, "transcript");
  assert.equal(classifyRecord("gaps", []).kind, "gaps");
  assert.equal(classifyRecord("crop:x", {}).kind, "crop");
  assert.equal(classifyRecord("zzz", {}).kind, "other");
  assert.equal(classifyRecord(null, {}).kind, "other");
});

test("classifyRecord detects the cached stage by value shape", () => {
  const stage = v => classifyRecord("s:" + "0".repeat(8), { value: v }).stage;
  assert.equal(stage({ ir: { units: [] }, registry: [], formulaUnits: {} }), "refining");
  assert.equal(stage({ importance: {} }), "judging");
  assert.equal(stage({ plan: { sections: [] } }), "planning");
  assert.equal(stage({ sections: [], failed: [] }), "writing");
  assert.equal(stage({ note: {}, partial: false }), "validating");
  assert.equal(stage({ rendered: null }), "rendering"); // 렌더러 없이 끝난 단계도 렌더다
  assert.equal(stage({ results: [] }), "call");         // 서비스 호출 캐시
  assert.equal(stage([{ type: "p" }]), "call");         // 블록 배열도 호출 캐시다
});

test("classifyRecord labels carry counts", () => {
  assert.equal(
    classifyRecord("s:x", { value: { ir: { units: Array(12) }, registry: Array(4) } }).label,
    "정제 · 유닛 12, 수식 4");
  assert.equal(classifyRecord("s:y", { value: { plan: { sections: Array(5) } } }).label, "계획 · 섹션 5");
  assert.equal(
    classifyRecord("note", { sections: [{ blocks: [1, 2] }, { blocks: [1] }], global: [1] }).label,
    "노트 · 섹션 2 · 블록 4");
  assert.equal(classifyRecord("sd:3", { blocks: [1, 2], formulas: [1], figures: [] }).label, "슬라이드 3 · 블록 2 · 수식 1 · 도표 0");
  assert.equal(classifyRecord("gaps", [{ reason: "decode", t0: 1, t1: 2 }]).label, "공백 구간 1");
});
