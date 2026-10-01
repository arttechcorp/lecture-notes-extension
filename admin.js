// 개발 전용 관찰 화면. manifest에서 도달할 수 없어 스토어 패키지에는 들어가지 않는다.
(() => {
  const TERMINAL = new Set(["done", "failed", "skipped"]);
  const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
  const MAX_EVENTS = 5000;

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

  const api = { summarize, lanes, filterEvents };
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
    $("tabPipeline").classList.toggle("active", t === "pipeline");
    $("tabLogs").classList.toggle("active", t === "logs");
    render();
  }

  $("tabPipeline").addEventListener("click", () => showTab("pipeline"));
  $("tabLogs").addEventListener("click", () => showTab("logs"));
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

  connect();
  setInterval(() => { if (!$("viewPipeline").hidden) scheduleRender(); }, 1000); // 열린 막대가 자라도록
  render();
})();
