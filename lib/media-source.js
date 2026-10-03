// 강의 미디어 소스의 순수 로직. 세그먼트는 메모리에서만 다루고(cache:"no-store") 어디에도 저장하지 않는다.
// 보호 콘텐츠(암호화 키·ContentProtection)는 절대 키를 가져오지 않는다 — 신호만 노출하고 호출자가 거절한다.
(() => {
  // 속성 목록: 따옴표 안의 쉼표(CODECS 등)를 지키기 위해 따옴표 값을 먼저 소비한다
  const attrs = s => { const o = {}, re = /([A-Za-z0-9-]+)=("[^"]*"|[^,]*)/g; let m; while ((m = re.exec(s))) o[m[1].toUpperCase()] = m[2][0] === '"' ? m[2].slice(1, -1) : m[2]; return o; };
  const attrOf = l => attrs(l.slice(l.indexOf(":") + 1));
  const wh = v => { const m = /^(\d+)x(\d+)$/.exec(v || ""); return { width: m ? +m[1] : 0, height: m ? +m[2] : 0 }; };
  const rangeStr = s => { const [n, o] = String(s).split("@"); return { length: +n, offset: o === undefined ? 0 : +o }; };
  const abortErr = () => new DOMException("취소됨", "AbortError");

  function classifyRequest({ url, type, mime } = {}) {
    if (typeof url !== "string") return null;
    let path; try { const u = new URL(url); if (u.protocol === "blob:" || u.protocol === "data:") return null; path = u.pathname.toLowerCase(); } catch { return null; }
    // 전송 세그먼트는 소스 후보가 아니다 — MIME이 달려 있어도 제외
    if (/\.(ts|m2ts|m4s|aac|m4a|mp3|cmfv|cmfa|vtt)$/.test(path)) return null;
    const m = String(mime || "").split(";")[0].trim().toLowerCase();
    if (path.endsWith(".m3u8") || m === "application/vnd.apple.mpegurl" || m === "application/x-mpegurl" || m === "audio/mpegurl") return "hls";
    if (path.endsWith(".mpd") || m === "application/dash+xml") return "dash";
    if (/\.(mp4|m4v|mov)$/.test(path) || m === "video/mp4") return "mp4";
    return null;
  }

  function parseM3U8(text, baseUrl) {
    const lines = String(text).split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines[0] !== "#EXTM3U") throw new Error("HLS 재생목록 형식이 아닙니다.");
    const abs = v => new URL(v, baseUrl).href;
    if (lines.some(l => l.startsWith("#EXT-X-STREAM-INF:") || l.startsWith("#EXT-X-I-FRAME-STREAM-INF:") || l.startsWith("#EXT-X-MEDIA:"))) {
      const variants = [], audio = [], iframes = [], sessionKeys = []; let inf = null;
      for (const l of lines.slice(1)) {
        if (l.startsWith("#EXT-X-STREAM-INF:")) { inf = attrOf(l); continue; }
        if (l.startsWith("#EXT-X-I-FRAME-STREAM-INF:")) { const a = attrOf(l); iframes.push({ uri: abs(a.URI), bandwidth: +a.BANDWIDTH || 0, ...wh(a.RESOLUTION) }); continue; }
        if (l.startsWith("#EXT-X-MEDIA:")) { const a = attrOf(l); if (a.TYPE === "AUDIO") audio.push({ groupId: a["GROUP-ID"] || null, uri: a.URI ? abs(a.URI) : null, name: a.NAME || "", language: a.LANGUAGE || null, isDefault: a.DEFAULT === "YES" }); continue; }
        if (l.startsWith("#EXT-X-SESSION-KEY:")) { const a = attrOf(l); sessionKeys.push({ method: a.METHOD || null, uri: a.URI ? abs(a.URI) : null }); continue; }
        if (l.startsWith("#") || !inf) continue;
        variants.push({ uri: abs(l), bandwidth: +inf.BANDWIDTH || 0, ...wh(inf.RESOLUTION), codecs: inf.CODECS || null, audioGroup: inf.AUDIO || null }); inf = null;
      }
      return { kind: "master", variants, audio, iframes, sessionKeys };
    }
    const segments = [], keys = [], tail = new Map();
    let targetDuration = 0, endList = false, iframesOnly = false, t = 0, dur = null, pendingRange = null, disc = false, key = null, map = null;
    for (const l of lines.slice(1)) {
      if (l.startsWith("#EXTINF:")) { dur = parseFloat(l.slice(8)) || 0; continue; }
      if (l.startsWith("#EXT-X-BYTERANGE:")) { const [n, o] = l.slice(17).split("@"); pendingRange = { length: +n, offset: o === undefined ? null : +o }; continue; }
      if (l === "#EXT-X-DISCONTINUITY") { disc = true; continue; }
      if (l.startsWith("#EXT-X-KEY:")) { const a = attrOf(l), k = { method: a.METHOD || null, uri: a.URI ? abs(a.URI) : null }; keys.push(k); key = k.method === "NONE" ? null : k; continue; }
      if (l.startsWith("#EXT-X-MAP:")) { const a = attrOf(l); map = a.URI ? { uri: abs(a.URI), byterange: a.BYTERANGE ? rangeStr(a.BYTERANGE) : null } : null; continue; }
      if (l.startsWith("#EXT-X-TARGETDURATION:")) { targetDuration = +l.slice(22) || 0; continue; }
      if (l === "#EXT-X-ENDLIST") { endList = true; continue; }
      if (l === "#EXT-X-I-FRAMES-ONLY") { iframesOnly = true; continue; }
      if (l.startsWith("#") || dur === null) continue;
      const uri = abs(l); let br = null;
      // @오프셋이 없으면 같은 리소스의 직전 구간 끝에서 이어진다
      if (pendingRange) { const offset = pendingRange.offset ?? tail.get(uri) ?? 0; br = { length: pendingRange.length, offset }; tail.set(uri, offset + pendingRange.length); }
      // start는 PTS가 아니라 EXTINF 누적값 — DISCONTINUITY도 초기화하지 않는다
      segments.push({ uri, duration: dur, start: t, discontinuity: disc, byterange: br, key, map });
      t += dur; dur = null; pendingRange = null; disc = false;
    }
    return { kind: "media", targetDuration, endList, iframesOnly, segments, keys };
  }

  // 암호화 방법이 NONE이 아니면 보호 콘텐츠 — 배경 경로는 키를 받지 않고 거절해야 한다
  function detectProtection({ playlists = [], dashText = "" } = {}) {
    for (const p of playlists) {
      if (!p) continue;
      for (const k of p.keys || []) if (k.method !== "NONE") return { protected: true, reason: "EXT-X-KEY:" + k.method };
      for (const k of p.sessionKeys || []) if (k.method !== "NONE") return { protected: true, reason: "EXT-X-SESSION-KEY:" + k.method };
    }
    if (typeof dashText === "string" && /<(?:[\w.-]+:)?ContentProtection[\s/>]/.test(dashText)) return { protected: true, reason: "DASH ContentProtection" };
    return { protected: false, reason: null };
  }

  function selectRenditions(master, { minHeight = 720 } = {}) {
    // 목표 높이 이상 중 가장 가벼운 것 — 없으면 가장 큰 것(동률은 대역폭 큰 쪽)
    const pick = list => {
      const q = list.filter(v => (v.height || 0) >= minHeight);
      if (q.length) return q.reduce((a, b) => (b.bandwidth || 0) < (a.bandwidth || 0) ? b : a);
      return list.length ? list.reduce((a, b) => (b.height || 0) > (a.height || 0) || ((b.height || 0) === (a.height || 0) && (b.bandwidth || 0) > (a.bandwidth || 0)) ? b : a) : null;
    };
    const video = pick(master?.variants || []), iframe = pick(master?.iframes || []);
    // AUDIO 그룹이 없는 변형은 음성이 muxed — groupId 없는 rendition과 엮이지 않게 먼저 문자열 검사
    const group = typeof video?.audioGroup === "string" && video.audioGroup ? (master?.audio || []).filter(a => a.groupId === video.audioGroup && a.uri) : [];
    const audio = (group.find(a => a.isDefault) || group[0] || {}).uri || null;
    return { video, audio, iframe };
  }

  function segmentIndexAt(media, t) {
    const s = media.segments; let lo = 0, hi = s.length - 1, i = 0;
    if (!s.length) return -1; // 빈 재생목록은 -1
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (s[mid].start <= t) { i = mid; lo = mid + 1; } else hi = mid - 1; }
    return i;
  }

  const remaining = (media, done) => { const out = []; for (let i = 0; i < media.segments.length; i++) if (!done.has(i)) out.push(i); return out; };

  function createFetcher({ fetch, perHost = 4, maxMbps = 50, retries = 3, baseDelayMs = 1000, burstMs = 2000, now = () => Date.now(), sleep = (ms, signal) => new Promise((res, rej) => {
    if (signal?.aborted) { rej(abortErr()); return; }
    const onAbort = () => { clearTimeout(t); rej(abortErr()); };
    const t = setTimeout(() => { signal?.removeEventListener("abort", onAbort); res(); }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  }), random = Math.random } = {}) {
    const call = fetch || ((u, o) => globalThis.fetch(u, { ...o, cache: "no-store" })); // 원본 미디어는 HTTP 캐시에도 남기지 않는다(AGENTS.md §2)
    const cap = maxMbps * 125000, RETRYABLE = new Set([429, 500, 502, 503, 504]);
    const hosts = new Map();
    // 대기열에 있는 요청도 abort되면 즉시 빠진다 — 슬롯은 허가된 요청이 다 쓸 때까지 잠긴다
    const acquire = (host, signal) => {
      if (signal?.aborted) return Promise.reject(abortErr());
      let h = hosts.get(host); if (!h) hosts.set(host, h = { n: 0, q: [] });
      if (h.n < perHost) { h.n++; return Promise.resolve(); }
      return new Promise((res, rej) => {
        const grant = () => { signal?.removeEventListener("abort", onAbort); res(); };
        const onAbort = () => { const i = h.q.indexOf(grant); if (i >= 0) h.q.splice(i, 1); rej(abortErr()); };
        h.q.push(grant); signal?.addEventListener("abort", onAbort, { once: true });
      });
    };
    const release = host => { const h = hosts.get(host); const next = h.q.shift(); next ? next() : h.n--; };
    const coded = (code, msg) => { const e = new Error(msg); e.code = code; return e; };
    const retryAfter = v => { if (!v) return 0; const n = Number(v); if (Number.isFinite(n)) return Math.max(0, n * 1000); const t = Date.parse(v); return Number.isFinite(t) ? Math.max(0, t - now()) : 0; };
    const backoff = (a, v) => Math.max(baseDelayMs * 2 ** a * (0.8 + 0.4 * random()), retryAfter(v));
    const cancel = async r => { try { await r.body?.cancel?.(); } catch { } };
    // 버스트 상한: 세그먼트 몇 개는 회선 속도로 가도 되지만 유휴 시간은 최대 burstMs만큼만 크레딧으로 쌓는다
    let tat = -Infinity;
    async function throttle(n, signal) {
      if (!(cap > 0) || !Number.isFinite(cap)) return;
      const t = now(); tat = Math.max(tat, t - burstMs) + n / cap * 1000;
      const wait = tat - t; if (wait > 0) await sleep(wait, signal);
    }
    async function get(url, { range = null, signal } = {}) {
      let host; try { host = new URL(url).host; } catch { throw coded("SRC_BAD_URL", "영상 주소가 올바르지 않습니다."); }
      const headers = {};
      if (range) { const o = range.offset ?? range.start ?? 0; headers.Range = "bytes=" + o + "-" + (range.end ?? o + range.length - 1); }
      for (let a = 0, delay = null; ; a++) {
        if (delay !== null) { const d = delay; delay = null; await sleep(d, signal); }
        if (signal?.aborted) throw abortErr();
        let buf;
        try {
          await acquire(host, signal);
          try {
            const res = await call(url, { credentials: "include", cache: "no-store", redirect: "follow", signal, headers });
            const status = res.status, ct = String(res.headers?.get?.("content-type") || "").toLowerCase();
            const ok = res.ok ?? (status >= 200 && status < 300);
            // 만료된 세션은 HTML 로그인 화면으로 200 리다이렉트되기도 한다 — 재생목록·세그먼트는 결코 HTML이 아니다
            if (status === 401 || status === 403 || (ok && (ct.startsWith("text/html") || ct.startsWith("application/xhtml")))) { await cancel(res); throw coded("SRC_AUTH_EXPIRED", "로그인 세션이 만료됐습니다. 강의 탭을 다시 열어 주세요."); }
            if (RETRYABLE.has(status) && a < retries) { delay = backoff(a, res.headers?.get?.("retry-after")); await cancel(res); continue; }
            if (!ok || (status === 206 && !range)) { await cancel(res); throw coded("SRC_HTTP_" + status, "영상을 가져오지 못했습니다 (" + status + ")."); }
            // Range를 무시하고 200으로 본문 전체를 주면 잘못된 바이트 — 호출자가 전체 내려받기로 되돌아간다
            if (range && status === 200) { await cancel(res); throw coded("SRC_RANGE_UNSUPPORTED", "서버가 부분 요청(Range)을 지원하지 않습니다."); }
            buf = new Uint8Array(await res.arrayBuffer());
          } finally { release(host); }
        } catch (e) {
          if (e && (e.name === "AbortError" || e.code)) throw e;
          if (a < retries) { delay = backoff(a, null); continue; }
          const w = new Error("네트워크 오류로 영상을 가져오지 못했습니다.", { cause: e }); w.code = "SRC_NETWORK"; throw w;
        }
        await throttle(buf.byteLength, signal);
        return buf;
      }
    }
    return { get };
  }

  function refererRule({ ruleId, requestDomains, referer } = {}) {
    if (!Number.isInteger(ruleId) || ruleId < 1) throw new Error("규칙 번호가 올바르지 않습니다.");
    let u; try { u = new URL(referer); } catch { throw new Error("Referer 주소가 올바르지 않습니다."); }
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("Referer 주소가 올바르지 않습니다.");
    // requestDomains는 와일드카드를 받지 않는다 — 서브도메인은 자동으로 매칭된다
    const hostRe = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;
    if (!Array.isArray(requestDomains) || !requestDomains.length || requestDomains.some(d => typeof d !== "string" || d.length > 253 || !hostRe.test(d))) throw new Error("요청 도메인 목록이 올바르지 않습니다.");
    // tabIds [-1](TAB_ID_NONE) — 확장 자기 자신(offscreen)의 요청에만 적용하고 페이지 요청은 건드리지 않는다
    return { id: ruleId, priority: 1, action: { type: "modifyHeaders", requestHeaders: [{ header: "referer", operation: "set", value: referer }] }, condition: { requestDomains, tabIds: [-1], resourceTypes: ["xmlhttprequest", "media", "other"] } };
  }

  const api = { classifyRequest, parseM3U8, detectProtection, selectRenditions, segmentIndexAt, remaining, createFetcher, refererRule };
  globalThis.LectureMedia = api; if (typeof module !== "undefined") module.exports = api;
})();
