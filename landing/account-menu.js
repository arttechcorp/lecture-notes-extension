// 사이트 공통 계정 메뉴(왼쪽 햄버거 + 서랍). 페이지에는 #menuBtn 버튼만 두면 서랍 DOM은 여기서 만든다.
// supabase-js는 서랍을 처음 열 때(또는 OAuth 복귀 직후) 한 번만 내려받아 랜딩을 가볍게 유지한다.
(function () {
  const btn = document.getElementById("menuBtn");
  if (!btn) return;
  const SDK = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js";
  const PLAN = { free: "Free", essential: "Essential", professional: "Pro" };
  const support = (window.SUMMRIZEI_BILLING && window.SUMMRIZEI_BILLING.support) || "jihwanbu26@gmail.com";

  let clientP;
  const getClient = () => clientP || (clientP = new Promise((resolve) => {
    const cfg = window.SUMMRIZEI_SUPABASE;
    if (!cfg || !cfg.url || !cfg.anonKey) return resolve(null);
    const make = () => resolve(window.supabase ? window.supabase.createClient(cfg.url, cfg.anonKey) : null);
    if (window.supabase) return make();
    const s = document.createElement("script");
    s.src = SDK;
    s.onload = make;
    s.onerror = () => { clientP = null; resolve(null); };
    document.head.append(s);
  }));
  window.summrizeiAuth = { client: getClient, planLabel: (p) => PLAN[p] || PLAN.free };

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const link = (text, href) => {
    const a = el("a", "drawer-item", text);
    a.href = href;
    a.setAttribute("role", "menuitem");
    return a;
  };

  const dlg = el("dialog", "drawer");
  dlg.id = "accountDrawer";
  dlg.setAttribute("aria-label", "메뉴");
  const head = el("div", "drawer-head");
  const closeBtn = el("button", "drawer-close", "닫기");
  closeBtn.type = "button";
  head.append(el("span", "drawer-title", "메뉴"), closeBtn);
  const userBox = el("div", "drawer-user");
  userBox.setAttribute("aria-live", "polite");
  const list = el("div", "drawer-list");
  list.setAttribute("role", "menu");
  list.setAttribute("aria-label", "계정 메뉴");
  const logout = el("button", "drawer-item drawer-minor", "로그아웃");
  logout.type = "button";
  logout.setAttribute("role", "menuitem");
  logout.hidden = true;
  // 1순위(내 노트)를 맨 위에 따로 두고, 2순위(계정·결제·구독)를 그 아래, 나머지는 바닥에 작은 회색 글씨로 둔다.
  const notes = link("내 노트 (웹)", "/library");
  notes.classList.add("drawer-primary");
  notes.insertAdjacentHTML("afterbegin", '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z"/><path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3"/><path d="M9 7.5h6M9 11h4"/></svg>');
  const minor = (text, href) => { const a = link(text, href); a.classList.add("drawer-minor"); return a; };
  const footer = el("div", "drawer-footer");
  footer.setAttribute("role", "none");
  footer.append(minor("고객지원", "mailto:" + support), minor("이용약관", "/policies/terms"), minor("개인정보처리방침", "/policies/privacy"), logout);
  list.append(
    notes,
    el("hr", "drawer-divider"),
    link("사용자 정보", "/account"),
    link("결제 정보", "/account/billing"),
    link("구독 설정", "/account/subscription"),
    footer,
  );
  dlg.append(head, userBox, list);
  document.body.append(dlg);

  btn.setAttribute("aria-haspopup", "menu");
  btn.setAttribute("aria-expanded", "false");
  btn.setAttribute("aria-controls", dlg.id);

  const items = () => [...dlg.querySelectorAll("a.drawer-item, button.drawer-item, .drawer-login")].filter((n) => !n.hidden);

  function renderUser(client, user, plan, failed) {
    userBox.textContent = "";
    logout.hidden = !user;
    if (!user) {
      if (failed) userBox.append(el("p", "drawer-note", "로그인 서비스를 불러오지 못했습니다. 연결을 확인해 주세요."));
      const login = el("button", "button dark drawer-login", "Google로 로그인");
      login.type = "button";
      login.disabled = !client;
      login.addEventListener("click", async () => {
        const { error } = await client.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.href } });
        if (error) userBox.append(el("p", "drawer-note", "로그인을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요."));
      });
      userBox.append(login);
      return;
    }
    const meta = user.user_metadata || {};
    const name = meta.full_name || meta.name || (user.email || "").split("@")[0];
    const avatar = el("span", "avatar");
    if (meta.avatar_url || meta.picture) {
      const img = el("img");
      img.src = meta.avatar_url || meta.picture;
      img.alt = "";
      img.referrerPolicy = "no-referrer";
      img.addEventListener("error", () => { img.remove(); avatar.textContent = (name[0] || "?").toUpperCase(); });
      avatar.append(img);
    } else avatar.textContent = (name[0] || "?").toUpperCase();
    const who = el("div", "who");
    who.append(el("strong", null, name), el("span", null, user.email || ""));
    if (plan) who.append(el("em", "plan-badge", PLAN[plan] || PLAN.free));
    userBox.append(avatar, who);
  }

  let loaded = false;
  async function load() {
    if (loaded) return;
    loaded = true;
    const client = await getClient();
    if (!client) { loaded = false; return renderUser(null, null, null, true); }
    const render = async () => {
      const { data } = await client.auth.getSession();
      const user = data.session && data.session.user;
      renderUser(client, user, null);
      if (user) {
        const { data: acct } = await client.rpc("my_account");
        if (acct) renderUser(client, user, acct.plan);
      }
    };
    logout.addEventListener("click", async () => { await client.auth.signOut(); dlg.close(); });
    client.auth.onAuthStateChange((ev) => { if (ev === "SIGNED_IN" || ev === "SIGNED_OUT") render(); });
    render();
  }

  userBox.append(el("p", "drawer-note", "불러오는 중…"));
  btn.addEventListener("click", () => {
    dlg.showModal();
    btn.setAttribute("aria-expanded", "true");
    const first = list.querySelector(".drawer-item");
    if (first) first.focus();
    load();
  });
  closeBtn.addEventListener("click", () => dlg.close());
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener("close", () => { btn.setAttribute("aria-expanded", "false"); btn.focus(); });
  dlg.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const els = items();
    const i = els.indexOf(document.activeElement);
    const next = els[(i + (e.key === "ArrowDown" ? 1 : -1) + els.length) % els.length];
    if (next) { e.preventDefault(); next.focus(); }
  });

  // OAuth에서 돌아온 직후엔 URL의 토큰을 바로 세션으로 바꿔야 하므로 지연 로딩하지 않는다.
  if (/[#&?](access_token|code)=/.test(location.hash + location.search)) load();
})();
