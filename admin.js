// 개발 전용 관찰 화면. manifest에서 도달할 수 없어 스토어 패키지에는 들어가지 않는다.
(() => {
  const TERMINAL = new Set(["done", "failed", "skipped"]);
  const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
  const MAX_EVENTS = 5000;
  const media = globalThis.LectureMedia || (typeof require !== "undefined" ? require("./lib/media-source.js") : null);

  function summarize(events) {
    const stages = {}, open = {}, terminal = new Set();
    let errors = 0;
    for (const e of events || []) {
      if (!e || typeof e !== "object") continue;
      if (e.level === "error") errors++;
      const stage = e.stage;
      if (typeof stage !== "string" || !stage) continue;
      const c = stages[stage] || (stages[stage] = { queued: 0, running: 0, done: 0, failed: 0, skipped: 0 });
      if (Object.hasOwn(c, e.status)) c[e.status]++;
      if (!e.spanId) continue;
      if (e.status === "running") open[e.spanId] = { spanId: e.spanId, stage, unit: e.unit, start: e.ts };
      else if (TERMINAL.has(e.status)) terminal.add(e.spanId);
    }
    return { stages, open: Object.values(open).filter(s => !terminal.has(s.spanId)), errors };
  }

  function lanes(events, { now = Date.now(), windowMs = 600000 } = {}) {
    const spans = new Map();
    for (const e of events || []) {
      if (!e || !e.spanId || (e.status !== "running" && !TERMINAL.has(e.status))) continue;
      let s = spans.get(e.spanId);
      if (!s) { s = { spanId: e.spanId }; spans.set(e.spanId, s); }
      if (e.status === "running") {
        if (!Number.isFinite(s.start) || e.ts < s.start) s.start = e.ts;
        s.stage = e.stage; s.unit = e.unit;
      } else if (!Number.isFinite(s.end) || e.ts < s.end) {
        s.end = e.ts; s.status = e.status; s.ms = e.ms; s.code = e.code;
        s.stage = s.stage || e.stage; s.unit = s.unit || e.unit;
      }
    }
    const ws = now - windowMs, out = [];
    for (const s of spans.values()) {
      const open = !Number.isFinite(s.end);
      let start = s.start;
      // running이 유실된 스팬은 끝 시각에서 ms를 거슬러 막대를 세운다
      if (!Number.isFinite(start)) {
        if (open) continue;
        start = Number.isFinite(s.ms) ? s.end - s.ms : s.end;
      }
      const end = open ? now : s.end;
      if (start > now || end < ws) continue;
      out.push({ stage: s.stage || "", spanId: s.spanId, unit: s.unit, start, end: open ? null : s.end, status: open ? "running" : s.status, ms: s.ms, code: s.code });
    }
    out.sort((a, b) => a.stage < b.stage ? -1 : a.stage > b.stage ? 1 : a.start - b.start);
    return out;
  }

  function filterEvents(events, { minLevel = "debug", stage = "", jobId = "", text = "" } = {}) {
    const min = LEVELS[minLevel] ?? 0, needle = String(text || "").toLowerCase();
    return (events || []).filter(e => {
      if (!e || typeof e !== "object") return false;
      // level이 없는 수명주기 이벤트는 info 취급 — 아니면 info 이상 필터에서 전부 사라진다
      if ((LEVELS[e.level] ?? LEVELS.info) < min) return false;
      if (stage && e.stage !== stage) return false;
      if (jobId && e.jobId !== jobId) return false;
      if (needle && !String(e.msg || "").toLowerCase().includes(needle) && !String(e.code || "").toLowerCase().includes(needle)) return false;
      return true;
    });
  }

  // ---- 소스 진단 순수 부분 (B1·B2 측정용, DOM 없이 Node에서 시험) ----

  // 리포트·카드·클립보드에는 절대 원문 URL이 들어가지 않는다 — 호스트 + 마스킹된 경로만
  function redactUrl(url) {
    if (typeof url !== "string") return { host: "", path: "" };
    try {
      const u = new URL(url);
      if (u.protocol !== "http:" && u.protocol !== "https:") return { host: "", path: "" };
      return { host: u.host, path: u.pathname.split("/").map(s => /^[A-Za-z0-9_-]{24,}$/.test(s) ? "…" : s).join("/") };
    } catch { return { host: "", path: "" }; }
  }

  // 소스 후보 하나를 고른다: hls > dash > mp4. hls 안에서는 얕고 master를 이름에 둔 쪽
  function pickCandidate(requests) {
    let best = null, rank = -1, score = -Infinity;
    for (const r of Array.isArray(requests) ? requests : []) {
      if (!r || typeof r !== "object" || typeof r.url !== "string") continue;
      if (r.kind !== "hls" && r.kind !== "dash" && r.kind !== "mp4") continue;
      // 상태 0·누락은 모름(allowed)으로 보고, 확정된 비-2xx만 걸러낸다
      if (typeof r.status === "number" && r.status !== 0 && (r.status < 200 || r.status > 299)) continue;
      const rk = r.kind === "hls" ? 2 : r.kind === "dash" ? 1 : 0;
      let sc = 0;
      if (r.kind === "hls") {
        let p = "";
        try { p = new URL(r.url).pathname; } catch { }
        sc = 100 - 5 * p.split("/").filter(Boolean).length + (/master/i.test(p) ? 20 : 0);
      } else if (r.kind === "mp4") sc = Number.isFinite(r.size) ? r.size : 0;
      // 점수가 같으면 먼저 관찰된 쪽을 유지한다 (strictly greater)
      if (rk > rank || (rk === rank && sc > score)) { best = r; rank = rk; score = sc; }
    }
    return best;
  }

  const okStatus = s => Number.isInteger(s) && s >= 200 && s < 300;

  function refererVerdict({ plainStatus, withRefererStatus } = {}) {
    if (okStatus(plainStatus)) return "not-required";
    if (withRefererStatus === undefined || withRefererStatus === null) return "unknown";
    // 재시도도 거절이면 Referer 규칙인지 인증·만료인지 구분할 수 없다
    return okStatus(withRefererStatus) ? "required" : "unknown";
  }

  function rangeVerdict({ status } = {}) {
    if (status === 206) return "supported";
    if (status === 200) return "ignored"; // Range를 무시하고 200으로 본문을 주는 서버
    if (Number.isInteger(status) && status >= 400) return "error";
    return "unknown";
  }

  function buildReport({ pageUrl, requests, candidate, verdict, protection, playlist, renditions, iframe, range, referer, notes, at } = {}) {
    const reqs = Array.isArray(requests) ? requests : [];
    const byKind = { hls: 0, dash: 0, mp4: 0 };
    for (const r of reqs) if (r && typeof r === "object" && Object.hasOwn(byKind, r.kind)) byKind[r.kind]++;
    const sample = reqs.slice(0, 8).map(r => {
      const u = redactUrl(r && r.url);
      return { kind: r?.kind ?? null, host: u.host, path: u.path, status: r?.status ?? null, mime: r?.mime ?? null };
    });
    const hasCand = candidate && typeof candidate === "object";
    const cu = redactUrl(hasCand ? candidate.url : null);
    return {
      tool: "source-diagnostic", version: 1,
      at: new Date(Number.isFinite(at) ? at : Date.now()).toISOString(),
      site: redactUrl(pageUrl).host,
      verdict: typeof verdict === "string" && verdict ? verdict : "error",
      observed: { total: reqs.length, byKind, sample },
      candidate: hasCand ? { kind: candidate.kind ?? null, host: cu.host, path: cu.path, status: candidate.status ?? null } : null,
      protection: protection || { detected: false, reason: null },
      playlist: playlist ?? null, renditions: renditions ?? null, iframe: iframe ?? null,
      range: range ?? null, referer: referer ?? null,
      notes: (Array.isArray(notes) ? notes : []).filter(n => typeof n === "string").slice(0, 8).map(n => n.slice(0, 160)),
    };
  }

  // 진단은 요청을 최대 4개까지만 순차적으로 보낸다 — 후보(+Referer 재시도), 미디어 재생목록, Range 시험
  async function diagnoseSource({ requests, pageUrl, ownTabId, fetchFn, dnr = null, now = Date.now, timeoutMs = 15000 } = {}) {
    const notes = [];
    const note = s => notes.push(String(s));
    let candidate = null;
    const finish = x => buildReport({ pageUrl, requests, candidate, notes, at: now(), ...x });
    try {
      if (!media) throw new Error("media-source.js가 로드되지 않았습니다.");
      candidate = pickCandidate(requests);
      if (!candidate) {
        note("관찰 시간 안에 재생목록·영상 요청이 없었습니다. 영상을 재생했는지 확인하세요.");
        return finish({ verdict: "no-source" });
      }
      const call = async (url, init) => {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), timeoutMs);
        try { return await fetchFn(url, { credentials: "include", cache: "no-store", signal: ctrl.signal, ...init }); }
        finally { clearTimeout(t); }
      };
      // 본문이 큰 응답은 통째로 읽지 않는다 — 진단에는 재생목록 앞부분만 필요하다
      const getText = async url => {
        const res = await call(url);
        const len = Number(res.headers?.get?.("content-length")) || 0;
        if (len > 2000000) {
          note("본문이 커서 읽지 않았습니다(content-length " + len + ").");
          try { await res.body?.cancel?.(); } catch { }
          return { status: res.status, text: null, finalUrl: res.url || url };
        }
        return { status: res.status, text: await res.text(), finalUrl: res.url || url };
      };
      // Range 시험은 상태·헤더만 보고 본문은 즉시 취소한다
      const probe = async url => {
        const res = await call(url, { headers: { Range: "bytes=0-1023" } });
        const cut = v => typeof v === "string" ? v.slice(0, 80) : null;
        const range = { status: res.status, contentRange: cut(res.headers?.get?.("content-range")), acceptRanges: cut(res.headers?.get?.("accept-ranges")) };
        try { await res.body?.cancel?.(); } catch { }
        range.verdict = rangeVerdict(range);
        return range;
      };

      if (candidate.kind === "mp4") {
        note("단일 mp4는 DRM 여부를 여기서 판별하지 않습니다.");
        const range = await probe(candidate.url);
        return finish({ verdict: range.verdict === "error" ? "fetch-failed" : "ok", protection: { detected: false, reason: null, checked: "n/a" }, range });
      }
      if (candidate.kind === "dash") {
        const got = await getText(candidate.url);
        if (!okStatus(got.status)) { note("매니페스트를 가져오지 못했습니다(" + got.status + ")."); return finish({ verdict: "fetch-failed" }); }
        const p = media.detectProtection({ dashText: got.text || "" });
        if (p.protected) return finish({ verdict: "protected", protection: { detected: true, reason: p.reason } });
        note("MPD 상세 분석은 B3 범위입니다(여기서는 보호 여부만).");
        return finish({ verdict: "ok" });
      }

      // hls
      let got = await getText(candidate.url);
      const plainStatus = got.status;
      let withRefererStatus = null;
      if (!okStatus(plainStatus)) {
        if (dnr && typeof dnr.updateSessionRules === "function" && /^https?:/.test(String(pageUrl))) {
          // refererRule의 tabIds [-1]는 확장 내부(offscreen) 요청만 매칭된다 — 이 탭의 fetch에 맞게 범위를 좁힌다
          const rule = media.refererRule({ ruleId: 900001, requestDomains: [new URL(candidate.url).hostname], referer: pageUrl });
          rule.condition.tabIds = [ownTabId];
          await dnr.updateSessionRules({ removeRuleIds: [900001], addRules: [rule] });
          try {
            const retry = await getText(candidate.url);
            withRefererStatus = retry.status;
            if (okStatus(withRefererStatus)) got = retry;
          } finally {
            try { await dnr.updateSessionRules({ removeRuleIds: [900001] }); } catch { }
          }
        } else note("페이지 Referer 비교는 declarativeNetRequest 권한이 있을 때만 가능합니다.");
      }
      const referer = { verdict: refererVerdict({ plainStatus, withRefererStatus }), plainStatus, withRefererStatus };
      if (!okStatus(got.status)) { note("재생목록을 가져오지 못했습니다(" + got.status + ")."); return finish({ verdict: "fetch-failed", referer }); }
      let pl;
      try { pl = media.parseM3U8(got.text, got.finalUrl); } catch { return finish({ verdict: "not-hls", referer }); }
      let master = null, mediaPl = pl, iframe = null, renditions = null;
      if (pl.kind === "master") {
        master = pl;
        mediaPl = null;
        // 세션 키가 보이면 여기서 멈춘다 — 변형 재생목록도 받지 않는다
        const pm = media.detectProtection({ playlists: [master] });
        if (pm.protected) return finish({ verdict: "protected", referer, protection: { detected: true, reason: pm.reason } });
        const sel = media.selectRenditions(master);
        iframe = { available: master.iframes.length > 0, count: master.iframes.length, selected: sel.iframe ? { width: sel.iframe.width, height: sel.iframe.height, bandwidth: sel.iframe.bandwidth } : null };
        if (!sel.video) return finish({ verdict: "no-rendition", referer, iframe });
        renditions = { variants: master.variants.length, selected: { width: sel.video.width, height: sel.video.height, bandwidth: sel.video.bandwidth, codecs: sel.video.codecs ?? null }, audioSeparate: Boolean(sel.audio), audioGroups: new Set(master.audio.map(a => a.groupId)).size };
        const sub = await getText(sel.video.uri);
        if (!okStatus(sub.status)) { note("미디어 재생목록을 가져오지 못했습니다(" + sub.status + ")."); return finish({ verdict: "fetch-failed", referer, iframe, renditions }); }
        try { mediaPl = media.parseM3U8(sub.text, sub.finalUrl); } catch { return finish({ verdict: "not-hls", referer, iframe, renditions }); }
      }
      // 키 URI·I-frame 재생목록은 절대 요청하지 않는다 — 보호 신호만 보고 중단
      const p = media.detectProtection({ playlists: [master, mediaPl] });
      if (p.protected) return finish({ verdict: "protected", referer, iframe, renditions, protection: { detected: true, reason: p.reason } });
      const playlist = { type: master ? "master" : "media", segments: mediaPl.segments.length, targetDuration: mediaPl.targetDuration, live: !mediaPl.endList, discontinuities: mediaPl.segments.filter(s => s.discontinuity).length, iframesOnly: mediaPl.iframesOnly, byteranges: mediaPl.segments.filter(s => s.byterange).length };
      let range = null;
      if (mediaPl.segments.length) range = await probe(mediaPl.segments[0].uri);
      else note("세그먼트가 없어 Range 시험을 건너뛰었습니다.");
      if (iframe && !iframe.available) note("I-frame 재생목록 없음: 세그먼트 전체 수신 폴백이 필요합니다.");
      if (range && range.verdict !== "supported") note("Range 미지원: 첫 IDR만 받는 최적화를 쓸 수 없습니다.");
      if (playlist.live) note("라이브 재생목록입니다.");
      return finish({ verdict: "ok", referer, iframe, renditions, playlist, range });
    } catch (e) {
      // 오류 메시지에도 URL이 섞일 수 있으므로 지우고 나서 기록한다
      note(String(e?.message || e).replace(/https?:\/\/\S+/g, "[url]").slice(0, 120));
      return finish({ verdict: "error" });
    }
  }

  const api = { summarize, lanes, filterEvents, redactUrl, pickCandidate, refererVerdict, rangeVerdict, buildReport, diagnoseSource };
  globalThis.AdminView = api;
  if (typeof module !== "undefined") module.exports = api;
  if (typeof document === "undefined") return; // Node 테스트는 DOM이 없으므로 여기서 끝

  const $ = id => document.getElementById(id);
  const events = [], seen = new Set();
  // 스냅샷 재연결·저장 로그 병합이 같은 이벤트를 다시 주므로 키로 한 번만 받는다
  const keyOf = e => [e.ts, e.stage, e.spanId, e.status, e.msg].join("|");

  function addEvent(e) {
    if (!e || typeof e !== "object" || seen.has(keyOf(e))) return false;
    seen.add(keyOf(e)); events.push(e);
    return true;
  }
  function trim() {
    if (events.length <= MAX_EVENTS) return;
    for (const e of events.splice(0, events.length - MAX_EVENTS)) seen.delete(keyOf(e));
  }
  function ingest(list) {
    let n = 0;
    for (const e of list || []) if (addEvent(e)) n++;
    events.sort((a, b) => (a.ts || 0) - (b.ts || 0));
    trim();
    return n;
  }

  function setStatus(text, cls) {
    const el = $("connStatus");
    el.textContent = text;
    el.className = cls || "";
  }

  function connect() {
    let port;
    try { port = chrome.runtime.connect({ name: "admin-events" }); }
    catch { return void setTimeout(connect, 2000); }
    port.onMessage.addListener(m => {
      // 수신 측이 없으면 포트가 비동기로 끊기므로 connect() 직후가 아니라 첫 메시지에서 연결됨으로 본다
      setStatus("실시간 연결됨", "ok");
      if (m?.type === "snapshot" && Array.isArray(m.events)) ingest(m.events);
      else if (m?.type === "event") { if (addEvent(m.event)) trim(); }
      scheduleRender();
    });
    port.onDisconnect.addListener(() => {
      void chrome.runtime.lastError; // 읽어 두지 않으면 재시도마다 "Unchecked runtime.lastError" 경고가 쌓인다
      setStatus("offscreen 문서 없음 — 세션을 시작하면 연결됩니다", "bad");
      setTimeout(connect, 2000);
    });
  }

  const pad = (n, l = 2) => String(n).padStart(l, "0");
  function fmtTime(ts) {
    if (!Number.isFinite(ts)) return "";
    const d = new Date(ts);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
  }
  function cell(tr, v) {
    const td = document.createElement("td");
    td.textContent = v ?? "";
    tr.appendChild(td);
    return td;
  }

  function renderPipeline(sum) {
    const tb = $("stageRows");
    tb.textContent = "";
    for (const [stage, c] of Object.entries(sum.stages).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
      const tr = document.createElement("tr");
      cell(tr, stage);
      for (const k of ["queued", "running", "done", "failed", "skipped"]) cell(tr, c[k]);
      tb.appendChild(tr);
    }
    const ul = $("openSpans");
    ul.textContent = "";
    if (!sum.open.length) {
      const li = document.createElement("li");
      li.textContent = "없음";
      ul.appendChild(li);
    }
    for (const s of sum.open.sort((a, b) => (a.start || 0) - (b.start || 0))) {
      const li = document.createElement("li");
      li.textContent = `${s.stage} · ${s.unit || "-"} · ${s.spanId} · 시작 ${fmtTime(s.start)}`;
      ul.appendChild(li);
    }
    renderGantt();
  }

  function renderGantt() {
    const now = Date.now(), W = 600000, ws = now - W;
    const g = $("gantt");
    g.textContent = "";
    const rows = lanes(events, { now, windowMs: W });
    if (!rows.length) { g.textContent = "표시할 스팬이 없습니다"; return; }
    let track = null, cur = null;
    for (const l of rows) {
      if (l.stage !== cur) {
        cur = l.stage;
        const row = document.createElement("div");
        row.className = "lane";
        const lab = document.createElement("span");
        lab.className = "lab";
        lab.textContent = cur || "(없음)";
        track = document.createElement("div");
        track.className = "track";
        row.append(lab, track);
        g.appendChild(row);
      }
      const s = Math.max(l.start, ws), e = Math.min(l.end ?? now, now);
      const bar = document.createElement("div");
      bar.className = "bar " + l.status;
      bar.style.left = ((s - ws) / W * 100).toFixed(2) + "%";
      bar.style.width = Math.max((e - s) / W * 100, 0.3).toFixed(2) + "%";
      bar.title = [l.unit, Number.isFinite(l.ms) ? l.ms + "ms" : "", l.code].filter(Boolean).join(" · ") || l.spanId;
      track.appendChild(bar);
    }
  }

  function currentFilters() {
    return {
      minLevel: $("fLevel").value,
      stage: $("fStage").value.trim(),
      jobId: $("fJob").value.trim(),
      text: $("fText").value,
    };
  }

  function renderLogs() {
    const matched = filterEvents(events, currentFilters());
    const tb = $("logRows");
    tb.textContent = "";
    for (const e of matched.slice(-1000)) {
      const tr = document.createElement("tr");
      if (e.level === "warn" || e.level === "error") tr.className = "lv-" + e.level;
      cell(tr, fmtTime(e.ts));
      cell(tr, e.level || "");
      cell(tr, e.stage || "");
      cell(tr, e.status || "");
      cell(tr, e.unit || "");
      cell(tr, Number.isFinite(e.ms) ? e.ms : "");
      cell(tr, e.code || "");
      cell(tr, e.msg || "").className = "msg";
      tb.appendChild(tr);
    }
    if ($("follow").checked) {
      const w = $("logWrap");
      w.scrollTop = w.scrollHeight;
    }
  }

  let renderTimer = null;
  function scheduleRender() {
    if (renderTimer) return;
    renderTimer = setTimeout(() => { renderTimer = null; render(); }, 500); // 최대 500ms 간격
  }
  function render() {
    const sum = summarize(events);
    $("eventCount").textContent = events.length;
    $("errorCount").textContent = sum.errors;
    if (!$("viewPipeline").hidden) renderPipeline(sum);
    if (!$("viewLogs").hidden) renderLogs();
  }

  function showTab(t) {
    $("viewPipeline").hidden = t !== "pipeline";
    $("viewLogs").hidden = t !== "logs";
    $("viewSource").hidden = t !== "source";
    $("tabPipeline").classList.toggle("active", t === "pipeline");
    $("tabLogs").classList.toggle("active", t === "logs");
    $("tabSource").classList.toggle("active", t === "source");
    render();
  }

  $("tabPipeline").addEventListener("click", () => showTab("pipeline"));
  $("tabLogs").addEventListener("click", () => showTab("logs"));
  $("tabSource").addEventListener("click", () => { showTab("source"); refreshTabs(); });
  $("fLevel").addEventListener("change", render);
  for (const id of ["fStage", "fJob", "fText"]) $(id).addEventListener("input", render);

  $("exportJson").addEventListener("click", () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(filterEvents(events, currentFilters()), null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "summrizei-events-" + new Date().toISOString().replace(/[:.]/g, "-") + ".json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  });

  $("loadLogs").addEventListener("click", async () => {
    const btn = $("loadLogs"), note = $("loadNote");
    btn.disabled = true;
    try {
      if (typeof PackageStore === "undefined") throw new Error("저장소 모듈이 없습니다");
      const store = await PackageStore.createStore(await PackageStore.indexedDbAdapter());
      note.textContent = `저장된 로그 ${ingest(await store.readLogs({ since: Date.now() - 86400000 }))}개 병합`;
    } catch (err) {
      note.textContent = "로그 불러오기 실패: " + (err?.message || err);
    } finally {
      btn.disabled = false;
    }
    render();
  });

  // ---- 소스 진단 탭 (개발 전용 B1·B2 측정 — 관찰만 하고 아무것도 저장하지 않는다) ----
  const srcStatus = m => { $("srcStatus").textContent = m; };
  const sep = (...xs) => xs.filter(x => x !== null && x !== undefined && x !== "").join(" · ");

  async function refreshTabs() {
    const sel = $("srcTab"), prev = sel.value; // 다른 탭을 보고 돌아와도 고른 탭을 유지한다
    sel.textContent = "";
    if (!chrome.tabs?.query) return void srcStatus("chrome.tabs를 쓸 수 없습니다");
    try {
      const me = chrome.tabs.getCurrent ? await chrome.tabs.getCurrent() : null;
      for (const t of await chrome.tabs.query({})) {
        if (!/^https?:/.test(t.url || "") || (me && t.id === me.id)) continue; // 자기 탭과 비-http 탭은 제외
        let host = "";
        try { host = new URL(t.url).host; } catch { }
        const o = document.createElement("option");
        o.value = String(t.id);
        o.textContent = (host + " · " + (t.title || "")).slice(0, 40);
        sel.appendChild(o);
      }
      if (prev && [...sel.options].some(o => o.value === prev)) sel.value = prev;
      if (!sel.options.length) srcStatus("관찰할 http(s) 탭이 없습니다.");
    } catch (e) { srcStatus("탭 목록을 가져오지 못했습니다: " + (e?.message || e)); }
  }

  // 관찰은 선택한 tabId로만 한정 — 필터와 콜백 양쪽에서 확인하고 끝나면 반드시 해제한다
  async function observe(tabId, ms) {
    const out = [];
    const hdr = (d, n) => (d.responseHeaders || []).find(h => h.name.toLowerCase() === n)?.value || "";
    const onResp = d => {
      if (d.tabId !== tabId || out.length >= 200) return;
      const mime = hdr(d, "content-type").split(";")[0].trim().toLowerCase();
      const kind = media?.classifyRequest({ url: d.url, type: d.type, mime }) || null;
      if (!kind) return;
      out.push({ url: d.url, type: d.type, mime, status: d.statusCode, size: Number(hdr(d, "content-length")) || null, kind, frameId: d.frameId });
    };
    chrome.webRequest.onResponseStarted.addListener(onResp, { urls: ["<all_urls>"], tabId, types: ["media", "xmlhttprequest"] }, ["responseHeaders"]);
    try { await new Promise(r => setTimeout(r, ms)); }
    finally { chrome.webRequest.onResponseStarted.removeListener(onResp); }
    return out;
  }

  const VERDICT_LABEL = { ok: ["소스 확인", "ok"], protected: ["보호된 스트림 · 중단", "bad"], "no-source": ["미디어 요청 없음", "warn"], "fetch-failed": ["가져오기 실패", "bad"], "not-hls": ["재생목록 형식 아님", "warn"], "no-rendition": ["렌디션 없음", "warn"], error: ["오류", "bad"] };
  function row(dl, k, v) {
    if (v === null || v === undefined || v === "") return;
    const dt = document.createElement("dt"), dd = document.createElement("dd");
    dt.textContent = k; dd.textContent = v;
    dl.append(dt, dd);
  }

  function renderCard(r) {
    const card = document.createElement("div");
    card.className = "srcCard";
    const head = document.createElement("div");
    head.className = "srcHead";
    const site = document.createElement("b");
    site.textContent = r.site || "(호스트 없음)";
    const [label, cls] = VERDICT_LABEL[r.verdict] || VERDICT_LABEL.error;
    const tag = document.createElement("span");
    tag.className = "verdict " + cls;
    tag.textContent = label;
    const copy = document.createElement("button");
    copy.type = "button";
    copy.textContent = "결과 JSON 복사";
    copy.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(JSON.stringify(r, null, 2)); srcStatus("복사했습니다"); }
      catch (e) { srcStatus("복사 실패: " + (e?.message || e)); }
    });
    head.append(site, tag, copy);
    card.appendChild(head);
    const dl = document.createElement("dl");
    const c = r.candidate, p = r.protection, pl = r.playlist, rd = r.renditions, fr = r.iframe, rg = r.range, rf = r.referer, ob = r.observed;
    row(dl, "후보", c ? sep(c.kind, c.host, c.path) : null);
    row(dl, "보호조치", p ? (p.detected ? p.reason : (p.checked === "n/a" ? "판별 안 함" : "없음")) : null);
    row(dl, "재생목록", pl ? sep(pl.type, "세그먼트 " + pl.segments, pl.live ? "라이브" : "VOD", "discontinuity " + pl.discontinuities) : null);
    row(dl, "렌디션", rd ? sep(rd.selected ? rd.selected.width + "x" + rd.selected.height : null, rd.selected?.bandwidth != null ? rd.selected.bandwidth + "bps" : null, rd.audioSeparate ? "오디오 분리" : "오디오 muxed", "변형 " + rd.variants) : null);
    row(dl, "I-frame", fr ? (fr.available ? "있음 " + fr.count + "개" : "없음") : null);
    row(dl, "Range", rg ? sep(rg.verdict, rg.status) : null);
    row(dl, "Referer", rf ? sep(rf.verdict, rf.plainStatus + "/" + (rf.withRefererStatus ?? "-")) : null);
    row(dl, "관찰", ob ? sep("총 " + ob.total, "hls " + (ob.byKind?.hls ?? 0), "dash " + (ob.byKind?.dash ?? 0), "mp4 " + (ob.byKind?.mp4 ?? 0)) : null);
    row(dl, "메모", (r.notes || []).join("\n") || null);
    card.appendChild(dl);
    const box = $("srcResults");
    box.prepend(card);
    while (box.children.length > 10) box.lastElementChild.remove(); // 카드는 메모리에만, 최대 10장
  }

  $("srcRefresh").addEventListener("click", refreshTabs);
  $("srcRelease").addEventListener("click", async () => {
    try { srcStatus(await chrome.permissions.remove({ permissions: ["webRequest"] }) ? "webRequest 권한을 해제했습니다." : "해제할 권한이 없거나 해제에 실패했습니다."); }
    catch (e) { srcStatus("권한 해제 실패: " + (e?.message || e)); }
  });
  async function runDiagnosis() {
    // 권한 요청은 사용자 제스처 안의 첫 await이어야 한다 — 먼저 다른 걸 await하면 거부된다
    let granted = false;
    try { granted = await chrome.permissions.request({ permissions: ["webRequest"] }); } catch { }
    if (!granted) return void srcStatus("webRequest 권한이 거부되어 진단할 수 없습니다.");
    if (!chrome.webRequest?.onResponseStarted) return void srcStatus("webRequest를 쓸 수 없습니다. 확장을 새로고침한 뒤 다시 시도하세요.");
    const tabId = Number($("srcTab").value);
    if (!tabId) return void srcStatus("관찰할 탭을 선택하세요.");
    let tab;
    try { tab = await chrome.tabs.get(tabId); } catch { return void srcStatus("선택한 탭을 찾을 수 없습니다."); }
    const me = chrome.tabs.getCurrent ? await chrome.tabs.getCurrent() : null;
    let tick = null;
    try {
      let left = 10;
      const watching = () => srcStatus("관찰 중… " + left + "초 남음 · 선택한 탭에서 영상을 재생하세요");
      watching();
      tick = setInterval(() => { if (--left > 0) watching(); }, 1000);
      const requests = await observe(tabId, 10000);
      srcStatus("분석 중…");
      const report = await diagnoseSource({
        requests, pageUrl: tab.url, ownTabId: me ? me.id : -1,
        fetchFn: (u, i) => fetch(u, i),
        dnr: chrome.declarativeNetRequest?.updateSessionRules ? chrome.declarativeNetRequest : null,
      });
      renderCard(report);
      srcStatus("완료");
    } catch (e) {
      srcStatus("오류: " + (e?.message || e));
    } finally {
      if (tick !== null) clearInterval(tick); // 카운트다운은 진단이 끝나면 남기지 않는다
    }
  }
  $("srcRun").addEventListener("click", () => {
    const btn = $("srcRun");
    if (btn.disabled) return; // 권한 창을 기다리는 동안의 이중 실행도 막는다
    btn.disabled = true;
    runDiagnosis().finally(() => { btn.disabled = false; });
  });

  connect();
  setInterval(() => { if (!$("viewPipeline").hidden) scheduleRender(); }, 1000); // 열린 막대가 자라도록
  render();
})();
