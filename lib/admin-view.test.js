const test = require("node:test");
const assert = require("node:assert/strict");
const { summarize, lanes, filterEvents, redactUrl, pickCandidate, refererVerdict, rangeVerdict, buildReport, diagnoseSource } = require("../admin.js");

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
