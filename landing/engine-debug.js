// 엔진 e2e 실행 모니터. engine_runs 스냅샷(tools/e2e-sync-runs.mjs 가 올림)을
// 어드민 게이트 RPC engine_debug()로 읽는다 — 관리자 판정은 RPC 성공/실패(42501)뿐.
(function () {
  const $ = (id) => document.getElementById(id);
  const statusEl = $("edStatus");
  const setStatus = (msg) => { statusEl.textContent = msg || ""; };
  const show = (id) => { for (const v of ["gateView", "loginView", "deniedView", "dashboardView"]) $(v).hidden = v !== id; };

  // 진입 비밀번호는 화면 앞의 걸쇠일 뿐이다 — 데이터는 뒤의 Supabase 로그인 + is_admin RPC 가 막는다.
  const GATE_PW = "qhdks551!!";
  const unlocked = () => sessionStorage.getItem("ed.gate") === "1";
  $("gateForm").addEventListener("submit", (e) => {
    e.preventDefault();
    if ($("gateInput").value === GATE_PW) {
      sessionStorage.setItem("ed.gate", "1");
      setStatus("로그인 상태를 확인하는 중입니다...");
      startAuth();
    } else {
      setStatus("비밀번호가 다릅니다.");
      $("gateInput").select();
    }
  });

  const cfg = window.SUMMRIZEI_SUPABASE;
  if (!cfg || !cfg.url || !cfg.anonKey) {
    setStatus("Supabase 설정이 비어 있습니다 — supabase-config.js에 URL과 anon 키를 넣으세요.");
    return;
  }
  const supabase = window.supabase.createClient(cfg.url, cfg.anonKey);

  const esc = (s) => String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const fmtT = (iso) => iso ? new Date(iso).toLocaleString("ko-KR", { hour12: false }) : "-";
  const fmtDur = (a, b) => {
    if (!a) return "-";
    const s = Math.max(0, Math.round(((b ? new Date(b) : Date.now()) - new Date(a)) / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return h ? `${h}h ${m}m` : m ? `${m}m ${s % 60}s` : `${s}s`;
  };
  const badge = (result) =>
    result === "ok" ? '<span class="badge ok">ok</span>'
    : result ? `<span class="badge fail">${esc(result)}</span>`
    : '<span class="badge running">running</span>';

  // 간단한 마크다운: 제목·목록·코드만 (debug.md 용)
  function renderMd(src) {
    const inline = (s) => esc(s)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
    const out = [];
    let inCode = false, inList = false;
    const closeList = () => { if (inList) { out.push("</ul>"); inList = false; } };
    for (const line of String(src).split("\n")) {
      if (/^\s*```/.test(line)) {
        if (inCode) { out.push("</code></pre>"); inCode = false; }
        else { closeList(); out.push("<pre><code>"); inCode = true; }
        continue;
      }
      if (inCode) { out.push(esc(line)); continue; }
      const h = line.match(/^(#{1,4})\s+(.*)/);
      if (h) { closeList(); out.push(`<h${Math.min(h[1].length + 2, 6)}>${inline(h[2])}</h${Math.min(h[1].length + 2, 6)}>`); continue; }
      const li = line.match(/^\s*(?:[-*]|\d+\.)\s+(.*)/);
      if (li) { if (!inList) { out.push("<ul>"); inList = true; } out.push(`<li>${inline(li[1])}</li>`); continue; }
      closeList();
      if (line.trim()) out.push(`<p>${inline(line)}</p>`);
    }
    closeList();
    if (inCode) out.push("</code></pre>");
    return out.join("\n");
  }

  let selected = new URLSearchParams(location.search).get("run");
  let timer = null;

  async function loadList() {
    const { data, error } = await supabase.rpc("engine_debug");
    if (error) {
      if (error.code === "42501") { show("deniedView"); setStatus(""); return false; }
      setStatus("run 목록을 불러오지 못했습니다. 연결을 확인해 주세요.");
      return false;
    }
    const runs = data || [];
    if (!selected && runs.length) selected = runs[0].name;
    $("runList").innerHTML = runs.length
      ? runs.map((r) =>
          `<a class="ed-run${r.name === selected ? " sel" : ""}" href="?run=${encodeURIComponent(r.name)}" data-name="${esc(r.name)}">` +
          `<div class="r1">${esc(r.name)} ${badge(r.result)}</div>` +
          `<div class="r2">v${esc(r.version ?? "?")} · ${fmtT(r.started_at)} · ${fmtDur(r.started_at, r.ended_at)}</div></a>`)
          .join("")
      : '<p class="ed-meta" style="padding:8px">동기화된 run이 없습니다. (tools/e2e-sync-runs.mjs)</p>';
    for (const a of $("runList").querySelectorAll("a.ed-run"))
      a.addEventListener("click", (e) => {
        e.preventDefault();
        selected = a.dataset.name;
        history.replaceState(null, "", "?run=" + encodeURIComponent(selected));
        loadList(); loadDetail();
      });
    return true;
  }

  function ledgerHtml(rows) {
    if (!rows || !rows.length) return '<p class="ed-meta">원장 행 없음</p>';
    const agg = new Map();
    for (const r of rows) {
      const a = agg.get(r.stage) || { ok: 0, err: 0, inp: 0, out: 0 };
      if (r.status === "ok") a.ok++; else a.err++;
      a.inp += r.input_tokens || 0; a.out += r.output_tokens || 0;
      agg.set(r.stage, a);
    }
    let h = '<div class="table-wrap"><table><thead><tr><th>stage</th><th>ok</th><th>error</th><th>in tok</th><th>out tok</th></tr></thead><tbody>';
    for (const [st, a] of agg)
      h += `<tr><td>${esc(st)}</td><td>${a.ok}</td><td${a.err ? ' class="st-error"' : ""}>${a.err}</td><td>${a.inp}</td><td>${a.out}</td></tr>`;
    h += '</tbody></table></div><div class="table-wrap"><table><thead><tr><th>created_at</th><th>stage</th><th>model</th><th>status</th><th>error_code</th><th>in</th><th>out</th><th>reason</th><th>ms</th></tr></thead><tbody>';
    for (const r of rows) {
      const bad = r.status !== "ok";
      h += `<tr${bad ? ' class="errrow"' : ""}><td>${esc(String(r.created_at).slice(0, 19))}</td><td>${esc(r.stage)}</td><td>${esc(r.model)}</td>` +
        `<td class="st-${esc(r.status)}">${esc(r.status)}</td><td>${esc(r.error_code)}</td>` +
        `<td>${r.input_tokens ?? ""}</td><td>${r.output_tokens ?? ""}</td><td>${r.reasoning_tokens ?? ""}</td><td>${r.latency_ms ?? ""}</td></tr>`;
    }
    return h + "</tbody></table></div>";
  }

  async function loadDetail() {
    if (!selected) { $("runDetail").innerHTML = '<p class="ed-meta">run을 선택하세요.</p>'; return; }
    const { data: r, error } = await supabase.rpc("engine_debug", { p_name: selected });
    if (error) {
      if (error.code === "42501") { show("deniedView"); return; }
      $("runDetail").innerHTML = `<p class="ed-meta">불러오지 못했습니다: ${esc(error.message)}</p>`;
      return;
    }
    if (!r) { $("runDetail").innerHTML = '<p class="ed-meta">run이 없습니다.</p>'; return; }
    const rep = r.report || {};
    let h = `<h2>${esc(r.name)} ${badge(r.result)}</h2>` +
      `<p class="ed-meta">v${esc(r.version ?? "-")} · 시작 ${fmtT(r.started_at)} · 소요 ${fmtDur(r.started_at, r.ended_at)}` +
      ` · flow ${esc(rep.flow ?? "-")} · login ${esc(String(rep.login ?? "-"))} · 동기화 ${fmtT(r.updated_at)}</p>`;
    for (const u of rep.urls || []) h += `<p class="ed-meta">url: ${esc(u)}</p>`;
    if (r.has_note_pdf) h += '<p class="ed-meta">note.pdf 있음(로컬 run 폴더)</p>';

    h += "<h3>단계</h3>";
    const steps = rep.steps || [];
    h += steps.length
      ? '<div class="table-wrap"><table><thead><tr><th>name</th><th>status</th><th>started</th><th>ms</th><th>detail/error</th></tr></thead><tbody>' +
        steps.map((s) =>
          `<tr><td>${esc(s.name)}</td><td class="st-${esc(s.status)}">${esc(s.status)}</td>` +
          `<td>${esc(fmtT(s.startedAt).split(" ").pop())}</td><td>${s.ms ?? ""}</td>` +
          `<td class="detail">${esc(s.error ?? s.detail ?? "")}</td></tr>`).join("") +
        "</tbody></table></div>"
      : '<p class="ed-meta">단계 없음</p>';

    h += "<h3>모델 호출 원장</h3>" + ledgerHtml(r.ledger);

    const ev = r.events_tail || [];
    h += "<h3>events 꼬리</h3><div class=\"ed-pre\">" +
      (ev.length ? esc(ev.map((e) => { const s = typeof e === "string" ? e : JSON.stringify(e); return s.length > 500 ? s.slice(0, 500) + "…" : s; }).join("\n")) : "없음") + "</div>";

    h += "<h3>로그 꼬리</h3><div class=\"ed-pre\">" + (r.log_tail ? esc(r.log_tail) : "없음") + "</div>";

    h += "<h3>debug.md</h3>" + (r.debug_md ? `<div class="ed-md">${renderMd(r.debug_md)}</div>` : '<p class="ed-meta">없음</p>');
    $("runDetail").innerHTML = h;
  }

  async function refresh() {
    if (await loadList()) await loadDetail();
  }

  $("googleLoginButton").addEventListener("click", async () => {
    setStatus("");
    const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.href } });
    if (error) setStatus("로그인을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  });
  const logout = async () => { await supabase.auth.signOut(); };
  $("logoutButton").addEventListener("click", logout);
  $("deniedLogoutButton").addEventListener("click", logout);

  let authStarted = false;
  function startAuth() {
    if (authStarted) return;
    authStarted = true;
    supabase.auth.onAuthStateChange((_event, session) => {
      clearInterval(timer);
      if (!session) {
        $("edAccount").hidden = true;
        show("loginView");
        setStatus("");
        return;
      }
      $("edAccount").hidden = false;
      $("edEmail").textContent = session.user.email || "";
      show("dashboardView");
      setStatus("");
      refresh();
      timer = setInterval(refresh, 15000); // 15초 자동 새로고침(선택 유지)
    });
  }

  if (unlocked()) {
    setStatus("로그인 상태를 확인하는 중입니다...");
    startAuth();
  } else {
    show("gateView");
  }
})();
