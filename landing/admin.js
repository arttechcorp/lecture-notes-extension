// 사전예약 코드 어드민. 관리자 판정은 admin_stats() 호출의 성공/실패로만 한다 — 클라이언트 이메일 비교 금지.
(function () {
  const $ = (id) => document.getElementById(id);
  const statusEl = $("adminStatus");
  const setStatus = (msg) => { statusEl.textContent = msg || ""; };
  const show = (id) => { for (const v of ["loginView", "deniedView", "dashboardView"]) $(v).hidden = v !== id; };

  const cfg = window.SUMMRIZEI_SUPABASE;
  if (!cfg || !cfg.url || !cfg.anonKey) {
    setStatus("Supabase 설정이 비어 있습니다 — supabase-config.js에 URL과 anon 키를 넣으세요.");
    return;
  }

  const supabase = window.supabase.createClient(cfg.url, cfg.anonKey);

  $("googleLoginButton").addEventListener("click", async () => {
    setStatus("");
    const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.href } });
    if (error) setStatus("로그인을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  });

  const logout = async () => { await supabase.auth.signOut(); };
  $("logoutButton").addEventListener("click", logout);
  $("deniedLogoutButton").addEventListener("click", logout);

  // keep: 코드 생성 직후 갱신할 때 "N개 생성했습니다"를 덮어쓰지 않는다.
  async function loadDashboard(keep) {
    if (!keep) setStatus("통계를 불러오는 중입니다...");
    const { data, error } = await supabase.rpc("admin_stats");
    if (error) {
      // 42501은 관리자가 아니라는 서버 판정이고, 그 외(네트워크·서버 장애)는 권한 문제가 아니다.
      // 구분하지 않으면 통신이 끊긴 관리자에게 권한을 잃었다고 알리게 된다.
      if (error.code === "42501") { show("deniedView"); setStatus(""); }
      else setStatus("통계를 불러오지 못했습니다. 연결을 확인하고 새로고침해 주세요.");
      return;
    }
    $("statReservations").textContent = data.reservations;
    $("statCodesIssued").textContent = data.codes_issued;
    $("statCodesUsed").textContent = data.codes_used;
    $("statSubscribers").textContent = data.subscribers == null ? "—" : data.subscribers;
    show("dashboardView");
    if (!keep) setStatus("");
    loadCodes();
  }

  let loadedCodes = [];

  async function loadCodes() {
    const { data, error } = await supabase.rpc("admin_list_codes");
    if (error) {
      // admin_stats와 동일한 규약: 42501만 권한 문제, 그 외는 통신 실패.
      if (error.code !== "42501") setStatus("코드 목록을 불러오지 못했습니다. 연결을 확인하고 새로고침해 주세요.");
      return;
    }
    loadedCodes = data.map((row) => row.code);
    const body = $("codesBody");
    body.textContent = "";
    if (!data.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 6;
      td.textContent = "아직 생성된 코드가 없습니다";
      tr.appendChild(td);
      body.appendChild(tr);
      return;
    }
    for (const row of data) {
      const tr = document.createElement("tr");
      const cells = [
        row.code,
        row.kind === "seed" ? "시드" : "파생",
        row.owner_email || "—",
        row.used_by_email || "—",
        row.used ? "사용됨" : "미사용",
        new Date(row.created_at).toLocaleDateString("ko-KR"),
      ];
      for (const text of cells) {
        const td = document.createElement("td");
        td.textContent = text;
        tr.appendChild(td);
      }
      body.appendChild(tr);
    }
  }

  $("reloadCodesButton").addEventListener("click", loadCodes);

  $("copyCodesButton").addEventListener("click", async () => {
    if (!loadedCodes.length) { setStatus("복사할 코드가 없습니다."); return; }
    try {
      await navigator.clipboard.writeText(loadedCodes.join("\n"));
      setStatus(`${loadedCodes.length}개 코드를 복사했습니다.`);
    } catch {
      setStatus("클립보드 접근이 막혀 있어 복사하지 못했습니다.");
    }
  });

  $("mintButton").addEventListener("click", async () => {
    const n = Number($("mintCount").value);
    if (!Number.isInteger(n) || n < 1 || n > 100) {
      setStatus("개수는 1~100 사이여야 합니다.");
      return;
    }
    const btn = $("mintButton");
    btn.disabled = true;
    setStatus("코드를 생성하는 중입니다...");
    const { data, error } = await supabase.rpc("admin_mint_codes", { n });
    btn.disabled = false;
    if (error) {
      setStatus("코드 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.");
      return;
    }
    $("mintOutput").value = data.join("\n");
    setStatus(`${data.length}개 코드를 생성했습니다.`);
    loadDashboard(true);
  });

  $("copyButton").addEventListener("click", async () => {
    const el = $("mintOutput");
    try {
      await navigator.clipboard.writeText(el.value);
      setStatus("복사했습니다.");
    } catch {
      el.select();
      setStatus("클립보드 접근이 막혀 있어 텍스트를 선택해 두었습니다. Ctrl+C로 복사하세요.");
    }
  });

  setStatus("로그인 상태를 확인하는 중입니다...");
  supabase.auth.onAuthStateChange((_event, session) => {
    if (!session) {
      $("adminAccount").hidden = true;
      show("loginView");
      setStatus("");
      return;
    }
    $("adminAccount").hidden = false;
    $("adminEmail").textContent = session.user.email || "";
    loadDashboard();
  });
})();
