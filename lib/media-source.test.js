const test = require("node:test");
const assert = require("node:assert/strict");
const LM = require("./media-source.js");

const BASE = "https://lms.example.com/lecture/master.m3u8";

const MASTER = `#EXTM3U
#EXT-X-VERSION:6
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="한국어",LANGUAGE="ko",DEFAULT=YES,AUTOSELECT=YES,URI="audio/ko.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="English",LANGUAGE="en",URI="audio/en.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360,CODECS="avc1.4d401e,mp4a.40.2",AUDIO="aud"
v360/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720,AUDIO="aud"
v720/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080,AUDIO="aud"
v1080/index.m3u8
#EXT-X-I-FRAME-STREAM-INF:BANDWIDTH=90000,RESOLUTION=640x360,URI="i360.m3u8"
#EXT-X-I-FRAME-STREAM-INF:BANDWIDTH=400000,RESOLUTION=1280x720,URI="i720.m3u8"
`;

// classifyRequest: 확장자·MIME 기반 소스 분류 및 세그먼트/blob/data 제외
test("classifyRequest identifies playlists and progressive files, rejects segments and blob/data", () => {
  assert.equal(LM.classifyRequest({ url: "https://a.com/x/master.m3u8", type: "xmlhttprequest" }), "hls");
  assert.equal(LM.classifyRequest({ url: "https://a.com/x/manifest.mpd?sig=1", type: "xmlhttprequest" }), "dash");
  assert.equal(LM.classifyRequest({ url: "https://a.com/v/lecture.mp4", type: "media" }), "mp4");
  assert.equal(LM.classifyRequest({ url: "https://a.com/v/clip.mov", type: "media" }), "mp4");
  assert.equal(LM.classifyRequest({ url: "https://a.com/pl", type: "xmlhttprequest", mime: "application/vnd.apple.mpegurl" }), "hls");
  assert.equal(LM.classifyRequest({ url: "https://a.com/pl", type: "other", mime: "application/x-mpegurl; charset=utf-8" }), "hls");
  assert.equal(LM.classifyRequest({ url: "https://a.com/pl", type: "xmlhttprequest", mime: "audio/mpegurl" }), "hls");
  assert.equal(LM.classifyRequest({ url: "https://a.com/pl", type: "xmlhttprequest", mime: "application/dash+xml" }), "dash");
  assert.equal(LM.classifyRequest({ url: "https://a.com/v", type: "media", mime: "video/mp4" }), "mp4");

  // 세그먼트·조각은 MIME이 붙어 있어도 소스가 아니다
  assert.equal(LM.classifyRequest({ url: "https://a.com/s/seg7.ts", type: "media" }), null);
  assert.equal(LM.classifyRequest({ url: "https://a.com/s/c.m4s", type: "media", mime: "video/mp4" }), null);
  assert.equal(LM.classifyRequest({ url: "https://a.com/s/a.aac", type: "media" }), null);
  assert.equal(LM.classifyRequest({ url: "blob:https://a.com/uuid", type: "media", mime: "video/mp4" }), null);
  assert.equal(LM.classifyRequest({ url: "data:video/mp4;base64,xx", type: "media" }), null);
  assert.equal(LM.classifyRequest({ url: "https://a.com/page.html", type: "xmlhttprequest" }), null);
  assert.equal(LM.classifyRequest({ url: "not a url", type: "other" }), null);
});

// parseM3U8 마스터: 변형·오디오·I-frame 목록과 절대 URI 해석
test("parseM3U8 master resolves variants, audio renditions and I-frame playlists", () => {
  const m = LM.parseM3U8(MASTER, BASE);
  assert.equal(m.kind, "master");
  assert.equal(m.variants.length, 3);
  assert.equal(m.variants[1].uri, "https://lms.example.com/lecture/v720/index.m3u8");
  assert.equal(m.variants[1].width, 1280);
  assert.equal(m.variants[1].height, 720);
  assert.equal(m.variants[1].bandwidth, 2500000);
  // 따옴표 안 쉼표가 있는 CODECS
  assert.equal(m.variants[0].codecs, "avc1.4d401e,mp4a.40.2");
  assert.equal(m.variants[0].audioGroup, "aud");
  assert.equal(m.audio.length, 2);
  assert.equal(m.audio[0].isDefault, true);
  assert.equal(m.audio[1].isDefault, false);
  assert.equal(m.audio[0].uri, "https://lms.example.com/lecture/audio/ko.m3u8");
  assert.equal(m.audio[0].language, "ko");
  assert.equal(m.iframes.length, 2);
  assert.equal(m.iframes[1].uri, "https://lms.example.com/lecture/i720.m3u8");
  assert.equal(m.iframes[1].height, 720);
});

// selectRenditions: minHeight 이상 중 최저 대역폭, 미달 시 최대 높이
test("selectRenditions picks lowest-bandwidth variant at/above minHeight and grouped audio", () => {
  const m = LM.parseM3U8(MASTER, BASE);
  const sel = LM.selectRenditions(m);
  assert.equal(sel.video.height, 720);
  assert.equal(sel.video.uri, "https://lms.example.com/lecture/v720/index.m3u8");
  assert.equal(sel.audio, "https://lms.example.com/lecture/audio/ko.m3u8");
  assert.equal(sel.iframe.uri, "https://lms.example.com/lecture/i720.m3u8");

  // minHeight 미달 변형만 있을 때는 가장 큰 높이 선택
  const low = LM.parseM3U8(`#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=500000,RESOLUTION=640x360
v360.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=300000,RESOLUTION=854x480
v480.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=999999
nores.m3u8
`, BASE);
  const sel2 = LM.selectRenditions(low);
  assert.equal(sel2.video.height, 480);
  // RESOLUTION 없는 변형은 높이 0 취급
  assert.equal(low.variants[2].height, 0);
  // AUDIO 그룹이 없으면 muxed로 간주해 audio=null
  assert.equal(sel2.audio, null);
  assert.equal(sel2.iframe, null);
});

// selectRenditions: 변형에 AUDIO 그룹이 없으면 음성은 muxed — groupId 없는 rendition과 묶이면 안 된다
test("selectRenditions returns null audio when the variant has no audio group", () => {
  const m = LM.parseM3U8(`#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,NAME="loose",URI="audio.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=1280x720
v.m3u8
`, BASE);
  assert.equal(LM.selectRenditions(m).audio, null);
});

const MEDIA = `#EXTM3U
#EXT-X-TARGETDURATION:6
#EXT-X-VERSION:7
#EXT-X-MAP:URI="init.mp4",BYTERANGE="800@0"
#EXTINF:6.0,
seg.m4s
#EXT-X-BYTERANGE:5000@1000
#EXTINF:4.0,
seg.m4s
#EXT-X-DISCONTINUITY
#EXT-X-BYTERANGE:3000
#EXTINF:2.5,
seg.m4s
#EXT-X-ENDLIST
`;

// parseM3U8 미디어: canonical 시작(EXTINF 누적)·바이트 범위 연속·MAP
test("parseM3U8 media accumulates canonical starts, continues byteranges and applies MAP", () => {
  const m = LM.parseM3U8(MEDIA, BASE);
  assert.equal(m.kind, "media");
  assert.equal(m.targetDuration, 6);
  assert.equal(m.endList, true);
  assert.equal(m.iframesOnly, false);
  assert.equal(m.segments.length, 3);
  const [s0, s1, s2] = m.segments;
  assert.equal(s0.start, 0); assert.equal(s0.duration, 6);
  assert.equal(s0.byterange, null);
  assert.equal(s0.map.uri, "https://lms.example.com/lecture/init.mp4");
  assert.deepEqual(s0.map.byterange, { length: 800, offset: 0 });
  assert.equal(s1.start, 6);
  assert.deepEqual(s1.byterange, { length: 5000, offset: 1000 });
  // DISCONTINUITY는 플래그만 세우고 canonical start(10)를 초기화하지 않는다
  assert.equal(s2.start, 10);
  assert.equal(s2.discontinuity, true);
  // @오프셋 생략 — 같은 리소스의 직전 구간 끝(1000+5000)에서 이어진다
  assert.deepEqual(s2.byterange, { length: 3000, offset: 6000 });

  assert.throws(() => LM.parseM3U8("not a playlist", BASE), /HLS 재생목록 형식이 아닙니다/);
});

// segmentIndexAt / remaining: canonical 시각의 세그먼트와 미완료 색인
test("segmentIndexAt and remaining locate and resume segments", () => {
  const m = LM.parseM3U8(MEDIA, BASE);
  assert.equal(LM.segmentIndexAt(m, 0), 0);
  assert.equal(LM.segmentIndexAt(m, 5.9), 0);
  assert.equal(LM.segmentIndexAt(m, 6), 1);
  assert.equal(LM.segmentIndexAt(m, 9.99), 1);
  assert.equal(LM.segmentIndexAt(m, 10), 2);
  assert.equal(LM.segmentIndexAt(m, 999), 2);
  assert.equal(LM.segmentIndexAt(m, -1), 0);
  assert.equal(LM.segmentIndexAt({ segments: [] }, 5), -1);
  assert.deepEqual(LM.remaining(m, new Set([1])), [0, 2]);
  assert.deepEqual(LM.remaining(m, new Set()), [0, 1, 2]);
  assert.deepEqual(LM.remaining(m, new Set([0, 1, 2])), []);
});

// detectProtection: 키 방법이 NONE이 아니면 보호 콘텐츠 — 배경 경로가 거절해야 한다
test("detectProtection flags encrypted keys, session keys and DASH ContentProtection", () => {
  const enc = LM.parseM3U8(`#EXTM3U
#EXT-X-KEY:METHOD=AES-128,URI="k.key"
#EXTINF:4,
s0.ts
#EXT-X-ENDLIST
`, BASE);
  assert.equal(enc.keys[0].method, "AES-128");
  assert.equal(enc.keys[0].uri, "https://lms.example.com/lecture/k.key");
  assert.equal(enc.segments[0].key.method, "AES-128");
  assert.deepEqual(LM.detectProtection({ playlists: [enc] }), { protected: true, reason: "EXT-X-KEY:AES-128" });

  const none = LM.parseM3U8(`#EXTM3U
#EXT-X-KEY:METHOD=NONE
#EXTINF:4,
s0.ts
#EXT-X-ENDLIST
`, BASE);
  assert.equal(none.segments[0].key, null);
  assert.deepEqual(LM.detectProtection({ playlists: [none] }), { protected: false, reason: null });
  assert.deepEqual(LM.detectProtection({ playlists: [LM.parseM3U8(MEDIA, BASE)] }), { protected: false, reason: null });

  const sk = LM.parseM3U8(`#EXTM3U
#EXT-X-SESSION-KEY:METHOD=SAMPLE-AES,URI="data:text/plain;base64,AAAA"
#EXT-X-STREAM-INF:BANDWIDTH=1,RESOLUTION=2x2
v.m3u8
`, BASE);
  assert.deepEqual(LM.detectProtection({ playlists: [sk] }), { protected: true, reason: "EXT-X-SESSION-KEY:SAMPLE-AES" });

  assert.deepEqual(LM.detectProtection({ dashText: '<MPD><Period><AdaptationSet><ContentProtection schemeIdUri="urn:x"/></AdaptationSet></Period></MPD>' }), { protected: true, reason: "DASH ContentProtection" });
  assert.deepEqual(LM.detectProtection({ dashText: '<MPD><Period><cenc:ContentProtection schemeIdUri="urn:x"/></Period></MPD>' }), { protected: true, reason: "DASH ContentProtection" });
  assert.deepEqual(LM.detectProtection({ dashText: "<MPD><Period/></MPD>" }), { protected: false, reason: null });
});

const res = (status, { bytes = 8, headers = {} } = {}) => ({
  ok: status >= 200 && status < 300, status,
  headers: { get: k => headers[String(k).toLowerCase()] ?? null },
  arrayBuffer: async () => new Uint8Array(bytes).buffer,
});

// createFetcher: 5xx/TypeError 재시도 — 지터는 주입된 random으로 계산
test("fetcher retries 503 and network TypeError with jittered backoff", async () => {
  const sleeps = []; let calls = 0;
  const fetch = async () => { calls++; if (calls === 1) return res(503); if (calls === 2) throw new TypeError("fetch failed"); return res(200); };
  const f = LM.createFetcher({ fetch, baseDelayMs: 100, random: () => 0, sleep: async ms => { sleeps.push(ms); }, maxMbps: Infinity });
  const out = await f.get("https://h.example.com/a.ts");
  assert.equal(calls, 3);
  assert.deepEqual(sleeps, [80, 160]); // 100*2^a*0.8
  assert.ok(out instanceof Uint8Array);
});

// createFetcher: Retry-After가 지터 백오프보다 크면 그 값을 따른다
test("fetcher honours Retry-After when larger than backoff", async () => {
  const sleeps = []; let calls = 0;
  const fetch = async () => { calls++; return calls === 1 ? res(503, { headers: { "retry-after": "5" } }) : res(200); };
  const f = LM.createFetcher({ fetch, baseDelayMs: 100, random: () => 0, sleep: async ms => { sleeps.push(ms); }, maxMbps: Infinity });
  await f.get("https://h.example.com/a.ts");
  assert.equal(calls, 2);
  assert.deepEqual(sleeps, [5000]);
});

// createFetcher: 401/403은 만료 세션 — 재시도 없이 SRC_AUTH_EXPIRED
test("fetcher throws SRC_AUTH_EXPIRED on 403 without retrying", async () => {
  const sleeps = []; let calls = 0;
  const fetch = async () => { calls++; return res(403); };
  const f = LM.createFetcher({ fetch, sleep: async ms => { sleeps.push(ms); }, maxMbps: Infinity });
  await assert.rejects(f.get("https://h.example.com/a.ts"), e => e.code === "SRC_AUTH_EXPIRED");
  assert.equal(calls, 1);
  assert.deepEqual(sleeps, []);
});

// createFetcher: 재시도 소진 및 비재시대 상태는 SRC_HTTP_<status>
test("fetcher exhausts retries and reports SRC_HTTP status", async () => {
  let calls = 0;
  const f = LM.createFetcher({ fetch: async () => { calls++; return res(503); }, retries: 2, baseDelayMs: 1, sleep: async () => {}, maxMbps: Infinity });
  await assert.rejects(f.get("https://h.example.com/a.ts"), e => e.code === "SRC_HTTP_503");
  assert.equal(calls, 3);
  const f2 = LM.createFetcher({ fetch: async () => res(404), sleep: async () => {}, maxMbps: Infinity });
  await assert.rejects(f2.get("https://h.example.com/a.ts"), e => e.code === "SRC_HTTP_404");
});

// createFetcher: 호스트당 동시 요청은 perHost를 넘지 않는다(FIFO)
test("fetcher caps per-host concurrency", async () => {
  let inflight = 0, peak = 0, started = 0; const gates = [];
  const fetch = () => { started++; return new Promise(r => { inflight++; peak = Math.max(peak, inflight); gates.push(() => { inflight--; r(res(200)); }); }); };
  const f = LM.createFetcher({ fetch, perHost: 2, sleep: async () => {}, maxMbps: Infinity });
  const p = [f.get("https://h.example.com/1"), f.get("https://h.example.com/2"), f.get("https://h.example.com/3")];
  await new Promise(r => setImmediate(r));
  assert.equal(started, 2);
  assert.equal(peak, 2);
  gates.shift()(); await p[0];
  await new Promise(r => setImmediate(r));
  assert.equal(started, 3); // 빈 슬롯이 생기자마자 대기 요청이 나간다(FIFO)
  gates.splice(0).forEach(g => g());
  await Promise.all(p);
  assert.equal(peak, 2);
});

// createFetcher: 슬롯은 본문 읽기까지 유지 — 헤더만 받았다고 다음 요청이 나가면 안 된다
test("fetcher holds the slot until the body is read", async () => {
  let started = 0, releaseBody;
  const first = { ok: true, status: 200, headers: { get: () => null }, arrayBuffer: () => new Promise(r => { releaseBody = () => r(new Uint8Array(4).buffer); }) };
  const f = LM.createFetcher({ fetch: async () => (++started, started === 1 ? first : res(200)), perHost: 1, sleep: async () => {}, maxMbps: Infinity });
  const p1 = f.get("https://h.example.com/1"), p2 = f.get("https://h.example.com/2");
  await new Promise(r => setImmediate(r));
  assert.equal(started, 1);
  releaseBody(); await p1; await p2;
  assert.equal(started, 2);
});

// createFetcher: 실패한 요청도 슬롯을 반환한다
test("fetcher frees the slot after a failed request", async () => {
  let started = 0;
  const f = LM.createFetcher({ fetch: async () => (++started, started === 1 ? res(404) : res(200)), perHost: 1, maxMbps: Infinity });
  await assert.rejects(f.get("https://h.example.com/1"), e => e.code === "SRC_HTTP_404");
  await f.get("https://h.example.com/2");
  assert.equal(started, 2);
});

// createFetcher: 본문 읽기 실패도 네트워크 오류와 같이 재시도한다
test("fetcher retries a body-read TypeError", async () => {
  const sleeps = []; let calls = 0;
  const bad = { ok: true, status: 200, headers: { get: () => null }, arrayBuffer: async () => { throw new TypeError("stream broke"); } };
  const f = LM.createFetcher({ fetch: async () => (++calls, calls === 1 ? bad : res(200)), retries: 2, baseDelayMs: 100, random: () => 0, sleep: async ms => { sleeps.push(ms); }, maxMbps: Infinity });
  await f.get("https://h.example.com/a.ts");
  assert.equal(calls, 2);
  assert.deepEqual(sleeps, [80]);
});

// createFetcher: 재시도 소진된 네트워크 실패는 SRC_NETWORK + cause
test("fetcher wraps exhausted network errors as SRC_NETWORK", async () => {
  let calls = 0;
  const f = LM.createFetcher({ fetch: async () => { calls++; throw new TypeError("fetch failed"); }, retries: 2, baseDelayMs: 1, sleep: async () => {}, maxMbps: Infinity });
  await assert.rejects(f.get("https://h.example.com/a.ts"), e => e.code === "SRC_NETWORK" && e.cause instanceof TypeError);
  assert.equal(calls, 3);
});

// createFetcher: Range를 무시한 200은 SRC_RANGE_UNSUPPORTED — 본문은 취소하고 읽지 않는다
test("fetcher rejects a 200 answer to a range request", async () => {
  let cancels = 0, reads = 0;
  const r200 = { ok: true, status: 200, headers: { get: () => null }, body: { cancel: async () => { cancels++; } }, arrayBuffer: async () => { reads++; return new Uint8Array(4).buffer; } };
  const f = LM.createFetcher({ fetch: async () => r200, maxMbps: Infinity });
  await assert.rejects(f.get("https://h.example.com/v.mp4", { range: { offset: 0, length: 4 } }), e => e.code === "SRC_RANGE_UNSUPPORTED");
  assert.equal(cancels, 1);
  assert.equal(reads, 0);
});

// createFetcher: HTML로 응답하는 만료 세션도 SRC_AUTH_EXPIRED — 재시도 없음
test("fetcher treats a 200 HTML page as an expired session", async () => {
  let calls = 0; const sleeps = [];
  const f = LM.createFetcher({ fetch: async () => (++calls, res(200, { headers: { "content-type": "text/html; charset=utf-8" } })), sleep: async ms => { sleeps.push(ms); }, maxMbps: Infinity });
  await assert.rejects(f.get("https://h.example.com/a.ts"), e => e.code === "SRC_AUTH_EXPIRED");
  assert.equal(calls, 1);
  assert.deepEqual(sleeps, []);
});

// createFetcher: 버스트 크레딧 — 단일 대형 응답은 burstMs 만큼만 공짜
test("fetcher bounds bursts to burstMs of credit", async () => {
  const sleeps = [];
  const f = LM.createFetcher({ fetch: async () => res(200, { bytes: 4000000 }), maxMbps: 8, now: () => 1000, sleep: async ms => { sleeps.push(ms); } });
  await f.get("https://h.example.com/big.bin");
  assert.deepEqual(sleeps, [2000]); // 4000ms 가상 종료 − 2000ms 버스트
});

// createFetcher: 가상 종료 시각은 응답마다 누적된다
test("fetcher accumulates virtual finish time across responses", async () => {
  const sleeps = [];
  const f = LM.createFetcher({ fetch: async () => res(200, { bytes: 3000000 }), maxMbps: 8, now: () => 1000, sleep: async ms => { sleeps.push(ms); } });
  await f.get("https://h.example.com/a"); await f.get("https://h.example.com/b");
  assert.deepEqual(sleeps, [1000, 4000]);
});

// createFetcher: 유휴 시간 크레딧 상한은 burstMs — 누적 평균률 방식이면 0이 되는 케이스
test("fetcher banks at most burstMs of idle credit", async () => {
  const sleeps = []; let t = 0, calls = 0;
  const f = LM.createFetcher({ fetch: async () => res(200, { bytes: calls++ === 0 ? 500000 : 4000000 }), maxMbps: 8, now: () => t, sleep: async ms => { sleeps.push(ms); } });
  await f.get("https://h.example.com/a");
  t = 3600000;
  await f.get("https://h.example.com/b");
  assert.deepEqual(sleeps, [2000]);
});

// createFetcher: 기본 sleep도 abort되면 AbortError로 빠진다
test("fetcher aborts a real backoff sleep", async () => {
  const ac = new AbortController();
  const f = LM.createFetcher({ fetch: async () => res(503, { headers: { "retry-after": "60" } }), retries: 1, maxMbps: Infinity });
  const t0 = Date.now();
  const p = f.get("https://h.example.com/a.ts", { signal: ac.signal });
  setTimeout(() => ac.abort(), 20);
  await assert.rejects(p, e => e.name === "AbortError");
  assert.ok(Date.now() - t0 < 1000);
});

// createFetcher: 대기열 요청도 abort되며 슬롯은 새지 않는다
test("fetcher aborts a queued request without leaking the slot", async () => {
  let started = 0, releaseFirst;
  const fetch = () => (++started, started === 1 ? new Promise(r => { releaseFirst = () => r(res(200)); }) : Promise.resolve(res(200)));
  const f = LM.createFetcher({ fetch, perHost: 1, maxMbps: Infinity });
  const p1 = f.get("https://h.example.com/1");
  const ac = new AbortController();
  const p2 = f.get("https://h.example.com/2", { signal: ac.signal });
  await new Promise(r => setImmediate(r));
  assert.equal(started, 1);
  ac.abort();
  await assert.rejects(p2, e => e.name === "AbortError");
  assert.equal(started, 1);
  releaseFirst(); await p1;
  await f.get("https://h.example.com/3");
  // 중단된 두 번째 요청은 fetch를 부르지 않았으므로 첫째와 셋째, 총 2번
  assert.equal(started, 2);
});

// createFetcher: 누적 바이트/상한에 따른 처리량 sleep (burstMs=0이면 크레딧 없이 즉시 환산)
test("fetcher sleeps to keep throughput under the cap", async () => {
  const sleeps = [];
  const f = LM.createFetcher({ fetch: async () => res(200, { bytes: 500000 }), maxMbps: 8, burstMs: 0, now: () => 1000, sleep: async ms => { sleeps.push(ms); } });
  await f.get("https://h.example.com/big.bin");
  // 상한 8Mbps=1,000,000B/s → 500,000B 읽은 뒤 500ms 대기
  assert.deepEqual(sleeps, [500]);
});

// createFetcher: credentials include·cache no-store·Range 헤더, 206은 range 요청 시에만 정상
test("fetcher sends required options and accepts 206 only with a range", async () => {
  const seen = [];
  const f = LM.createFetcher({ fetch: async (u, o) => { seen.push(o); return res(206); }, maxMbps: Infinity });
  await f.get("https://h.example.com/v.mp4", { range: { offset: 100, length: 50 } });
  assert.equal(seen[0].credentials, "include");
  assert.equal(seen[0].cache, "no-store");
  assert.equal(seen[0].redirect, "follow");
  assert.equal(seen[0].headers.Range, "bytes=100-149");

  const f2 = LM.createFetcher({ fetch: async () => res(206), sleep: async () => {}, maxMbps: Infinity });
  await assert.rejects(f2.get("https://h.example.com/v.mp4"), e => e.code === "SRC_HTTP_206");
});

// createFetcher: AbortError는 그대로 전파
test("fetcher propagates AbortError", async () => {
  const f = LM.createFetcher({ fetch: async () => { throw new DOMException("stop", "AbortError"); }, sleep: async () => {}, maxMbps: Infinity });
  await assert.rejects(f.get("https://h.example.com/x"), e => e.name === "AbortError");
});

// createFetcher: 잘못된 주소도 코드가 붙은 오류로 — 모든 비중단 오류는 .code를 가진다
test("fetcher rejects a malformed URL with SRC_BAD_URL", async () => {
  let calls = 0;
  const f = LM.createFetcher({ fetch: async () => { calls++; return res(200); }, maxMbps: Infinity });
  await assert.rejects(f.get("not a url"), e => e.code === "SRC_BAD_URL");
  assert.equal(calls, 0);
});

// refererRule: DNR 세션 규칙 형태와 입력 검증
test("refererRule builds a session-scoped rule and validates inputs", () => {
  const r = LM.refererRule({ ruleId: 7, requestDomains: ["lms.example.com", "cdn.example.com"], referer: "https://lms.example.com/course/1" });
  assert.deepEqual(r, {
    id: 7, priority: 1,
    action: { type: "modifyHeaders", requestHeaders: [{ header: "referer", operation: "set", value: "https://lms.example.com/course/1" }] },
    condition: { requestDomains: ["lms.example.com", "cdn.example.com"], tabIds: [-1], resourceTypes: ["xmlhttprequest", "media", "other"] },
  });
  assert.throws(() => LM.refererRule({ ruleId: 0, requestDomains: ["a.com"], referer: "https://a.com" }));
  assert.throws(() => LM.refererRule({ ruleId: 1.5, requestDomains: ["a.com"], referer: "https://a.com" }));
  assert.throws(() => LM.refererRule({ ruleId: "7", requestDomains: ["a.com"], referer: "https://a.com" }));
  assert.throws(() => LM.refererRule({ requestDomains: ["a.com"], referer: "https://a.com" }));
  assert.throws(() => LM.refererRule({ ruleId: 1, requestDomains: ["a.com"], referer: "ftp://a.com/x" }));
  assert.throws(() => LM.refererRule({ ruleId: 1, requestDomains: ["a.com"], referer: "not a url" }));
  assert.throws(() => LM.refererRule({ ruleId: 1, requestDomains: [], referer: "https://a.com" }));
  assert.throws(() => LM.refererRule({ ruleId: 1, requestDomains: ["bad host/"], referer: "https://a.com" }));
  // requestDomains는 와일드카드를 받지 않는다
  assert.throws(() => LM.refererRule({ ruleId: 1, requestDomains: ["*.example.com"], referer: "https://a.com" }));
});
