// /account 3개 페이지 공통 로직. body[data-page]로 동작을 고른다. 사용자 문자열은 textContent로만 넣는다.
(function () {
  const view = document.getElementById("view");
  const page = document.body.dataset.page;
  const cfg = window.SUMMRIZEI_BILLING || { checkout: {}, portal: "", support: "jihwanbu26@gmail.com" };
  const STATUS = { active: "이용 중", trialing: "체험 중", past_due: "결제 실패", canceled: "해지됨" };
  const PLANS = [
    { id: "free", name: "Free", price: "$0", edu: null, forWho: "다시 볼 장면을 찾고 싶다면", perks: ["로컬 화면·음성 인식", "개념별 핵심 요약", "월 100분 제한"] },
    { id: "essential", name: "Essential", price: "$9", edu: "$7", forWho: "많은 강의를 빠르게 훑고 싶다면", perks: ["Free의 모든 기능", "PDF로 변환해 노트앱에서 이어서 사용"] },
    { id: "professional", name: "Professional", price: "$14", edu: null, forWho: "중요한 강의를 깊이 이해한다면", perks: ["Essential의 모든 기능", "더 많은 사용량"] },
  ];

  const h = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const date = (iso) => (iso ? new Date(iso).toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" }) : "—");
  const isEdu = (email) => /\.(ac\.kr|edu)$/i.test((email || "").split("@")[1] || "");
  // grogle 주소에 이메일과 사용자 id를 붙인다. 주소가 비었거나 잘못되면 null.
  function withUser(url, user) {
    if (!url) return null;
    try {
      const u = new URL(url);
      u.searchParams.set("email", user.email || "");
      u.searchParams.set("client_reference_id", user.id);
      return u.href;
    } catch { return null; }
  }
  const set = (...nodes) => { view.textContent = ""; view.append(...nodes); };
  const heading = (title, lead) => [h("h1", null, title), h("p", "account-lead", lead)];
  const logoutAfter = async (client) => { await client.auth.signOut(); location.href = "/"; };

  function errorCard(msg) {
    const c = h("div", "card error-card");
    c.setAttribute("role", "alert");
    const retry = h("button", "button quiet", "다시 시도");
    retry.type = "button";
    retry.addEventListener("click", () => location.reload());
    c.append(h("p", null, msg), retry);
    set(c);
  }
  function loginCard(client, title, lead) {
    const c = h("div", "card center");
    const b = h("button", "button dark", "Google로 로그인");
    b.type = "button";
    b.addEventListener("click", async () => {
      const { error } = await client.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.href } });
      if (error) c.append(h("p", null, "로그인을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요."));
    });
    c.append(h("p", null, "로그인하면 계정과 구독 정보를 볼 수 있습니다."), b);
    set(...heading(title, lead), c);
  }

  function summaryCard(acct) {
    const c = h("div", "card");
    c.append(h("h2", null, "현재 구독"));
    const dl = h("dl", "facts");
    const row = (k, v) => dl.append(h("dt", null, k), h("dd", null, v));
    const label = window.summrizeiAuth.planLabel(acct.plan) + (acct.edu ? " (EDU)" : "");
    row("플랜", label);
    row("상태", STATUS[acct.status] || acct.status);
    if (acct.plan !== "free") row(acct.cancel_at_period_end ? "해지 예정" : "다음 결제일", date(acct.current_period_end) + (acct.cancel_at_period_end ? "까지 이용" : ""));
    c.append(dl);
    return c;
  }

  function usageCard(acct) {
    const c = h("div", "card");
    c.append(h("h2", null, "이번 달 사용량"));
    if (acct.minutes_used == null) {
      c.append(h("p", "meter-text", "집계 준비 중"));
      return c;
    }
    if (acct.minutes_limit == null) {
      c.append(h("p", "meter-text", acct.minutes_used + "분 사용"));
      return c;
    }
    const bar = h("div", "meter");
    bar.setAttribute("role", "progressbar");
    bar.setAttribute("aria-label", "이번 달 사용량");
    bar.setAttribute("aria-valuemin", "0");
    bar.setAttribute("aria-valuemax", String(acct.minutes_limit));
    bar.setAttribute("aria-valuenow", String(Math.min(acct.minutes_used, acct.minutes_limit)));
    const fill = h("i");
    fill.style.width = Math.min(100, (acct.minutes_used / acct.minutes_limit) * 100) + "%";
    bar.append(fill);
    c.append(bar, h("p", "meter-text", acct.minutes_used + " / " + acct.minutes_limit + "분"));
    return c;
  }

  function deleteCard(client) {
    const c = h("div", "card");
    c.append(h("h2", null, "회원 탈퇴"), h("p", "account-note", "탈퇴하면 계정과 구독·사용량 기록이 삭제되며 되돌릴 수 없습니다."));
    const open = h("button", "button quiet danger", "회원 탈퇴");
    open.type = "button";
    open.style.marginTop = "14px";
    const dlg = h("dialog", "confirm-dialog");
    dlg.setAttribute("aria-labelledby", "delTitle");
    const title = h("h2", null, "정말 탈퇴하시겠어요?");
    title.id = "delTitle";
    const input = h("input");
    input.type = "text";
    input.autocomplete = "off";
    input.setAttribute("aria-label", "확인 문구 입력");
    const msg = h("p", "account-note");
    msg.setAttribute("role", "alert");
    const cancel = h("button", "button quiet", "취소");
    cancel.type = "button";
    const go = h("button", "button dark", "탈퇴하기");
    go.type = "button";
    go.disabled = true;
    const actions = h("div", "account-actions");
    actions.append(cancel, go);
    dlg.append(title, h("p", null, "계속하려면 아래에 “탈퇴”를 입력하세요."), input, msg, actions);
    input.addEventListener("input", () => { go.disabled = input.value.trim() !== "탈퇴"; });
    cancel.addEventListener("click", () => dlg.close());
    dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener("close", () => { input.value = ""; go.disabled = true; msg.textContent = ""; open.focus(); });
    open.addEventListener("click", () => { dlg.showModal(); input.focus(); });
    go.addEventListener("click", async () => {
      go.disabled = true;
      const { error } = await client.rpc("delete_my_account");
      if (error) { msg.textContent = /active_subscription/.test(error.message || "") ? "유료 구독이 남아 있어요. 구독 설정에서 먼저 해지한 뒤 탈퇴해 주세요." : "탈퇴를 처리하지 못했습니다. 잠시 후 다시 시도해 주세요."; go.disabled = false; return; }
      await logoutAfter(client);
    });
    c.append(open, dlg);
    return c;
  }

  function accountView(client, user, acct) {
    const meta = user.user_metadata || {};
    const name = meta.full_name || meta.name || (user.email || "").split("@")[0];
    const profile = h("div", "card profile");
    const av = h("span", "avatar lg");
    const pic = meta.avatar_url || meta.picture;
    if (pic) {
      const img = h("img");
      img.src = pic;
      img.alt = "";
      img.referrerPolicy = "no-referrer";
      img.addEventListener("error", () => { img.remove(); av.textContent = (name[0] || "?").toUpperCase(); });
      av.append(img);
    } else av.textContent = (name[0] || "?").toUpperCase();
    const who = h("div", "who");
    who.append(h("strong", null, name), h("span", null, user.email || ""), h("span", null, "가입일 " + date(user.created_at)));
    profile.append(av, who);
    set(...heading("사용자 정보", "Google 계정으로 로그인되어 있습니다."), profile, summaryCard(acct), usageCard(acct), deleteCard(client));
  }

  function soon() {
    const p = h("p", "plan-soon", "출시 후 이용 가능 · ");
    const a = h("a", null, "사전 예약");
    a.href = "/#plans";
    p.append(a);
    return p;
  }

  function billingView(client, user, acct) {
    const c = h("div", "card");
    c.append(h("h2", null, "결제 수단 · 영수증"));
    const url = withUser(cfg.portal, user);
    const actions = h("div", "account-actions");
    if (url) {
      const a = h("a", "button dark", "결제수단 변경·영수증 보기 (grogle)");
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener";
      actions.append(a);
      c.append(actions, h("p", "account-note", "결제수단 변경, 영수증 확인, 구독 해지는 결제 대행사 grogle의 고객 포털에서 처리합니다."));
    } else {
      const off = h("span", "button quiet is-disabled", "결제 준비 중");
      off.setAttribute("aria-disabled", "true");
      const note = h("p", "account-note", "아직 결제가 시작되지 않았습니다. 문의는 ");
      const m = h("a", null, cfg.support);
      m.href = "mailto:" + cfg.support;
      note.append(m, "로 보내 주세요.");
      actions.append(off);
      c.append(actions, note);
    }
    const refund = h("p", "account-note", "환불 기준은 ");
    const r = h("a", null, "결제 및 환불 정책");
    r.href = "/policies/refund";
    refund.append(r, "에서 확인할 수 있습니다.");
    set(...heading("결제 정보", "결제 수단과 영수증을 관리합니다."), summaryCard(acct), c, h("div", "card").appendChild(refund).parentNode);
  }

  function subscriptionView(client, user, acct) {
    const edu = isEdu(user.email);
    const grid = h("div", "plans-stack");
    for (const p of PLANS) {
      const card = h("article", "plan" + (p.id === acct.plan ? " current" : ""));
      const head = h("div", "plan-heading");
      head.append(h("h3", null, p.name));
      if (p.id === acct.plan) head.append(h("span", "badge-current", "현재 플랜"));
      else if (p.id === "essential" && edu) head.append(h("span", "tag solid", "EDU 학생가"));
      card.append(head, h("p", "plan-for", p.forWho));
      const showEdu = p.id === "essential" && edu;
      const price = h("p", "price", showEdu ? p.edu : p.price);
      if (p.id !== "free") price.append(h("span", null, " / 월"));
      card.append(price);
      const ul = h("ul", "benefits");
      for (const t of p.perks) ul.append(h("li", null, t));
      card.append(ul);
      const cta = h("div", "plan-cta");
      card.append(cta);
      if (p.id === acct.plan) {
        const cur = h("span", "button quiet is-disabled", "현재 플랜");
        cur.setAttribute("aria-disabled", "true");
        cta.append(cur);
      } else if (p.id !== "free") {
        const url = withUser(cfg.checkout[showEdu ? "essential_edu" : p.id], user);
        if (url) {
          const a = h("a", "button dark", p.name + "로 변경");
          a.href = url;
          a.target = "_blank";
          a.rel = "noopener";
          cta.append(a);
        } else {
          const off = h("span", "button quiet is-disabled", "출시 후 이용 가능");
          off.setAttribute("aria-disabled", "true");
          cta.append(off, soon());
        }
      }

      grid.append(card);
    }
    const nodes = [...heading("구독 설정", "플랜을 바꾸거나 해지합니다."), grid];
    if (acct.plan !== "free") {
      const c = h("div", "card");
      c.append(h("h2", null, "구독 해지"));
      const url = withUser(cfg.portal, user);
      if (url) {
        const a = h("a", "button quiet danger", "구독 해지");
        a.href = url;
        a.target = "_blank";
        a.rel = "noopener";
        c.append(a);
      } else {
        const off = h("span", "button quiet is-disabled", "결제 준비 중");
        off.setAttribute("aria-disabled", "true");
        c.append(off);
      }
      c.append(h("p", "account-note", "버튼을 누르면 grogle 고객 포털로 이동하며, 한 번에 해지할 수 있습니다. 해지해도 이미 결제한 기간이 끝날 때까지는 계속 이용할 수 있습니다."));
      nodes.push(c);
    }
    set(...nodes);
  }

  async function init() {
    set(h("p", "skeleton", "불러오는 중…"));
    const titles = { account: ["사용자 정보", "Google 계정으로 로그인되어 있습니다."], billing: ["결제 정보", "결제 수단과 영수증을 관리합니다."], subscription: ["구독 설정", "플랜을 바꾸거나 해지합니다."] };
    const client = await window.summrizeiAuth.client();
    if (!client) return errorCard("계정 서비스를 불러오지 못했습니다. 연결을 확인하고 다시 시도해 주세요.");
    const { data } = await client.auth.getSession();
    const user = data.session && data.session.user;
    if (!user) return loginCard(client, ...titles[page]);
    const { data: acct, error } = await client.rpc("my_account");
    if (error || !acct) return errorCard("계정 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
    ({ account: accountView, billing: billingView, subscription: subscriptionView })[page](client, user, acct);
  }
  init();
})();
