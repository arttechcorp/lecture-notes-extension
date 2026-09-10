(() => {
  const plans = {
    free: { name: 'Free', type: '원문 시각순 타임라인', description: '0원 · 기기에서 원문 수집' },
    basic: { name: 'Basic', type: '핵심 요약', description: '월 4,900원 · 월 60편', model: 'Gemini 2.5 Flash-Lite' },
    standard: { name: 'Standard', type: '학습 노트', description: '월 7,900원 · 월 50편', model: 'Claude Haiku 4.5' },
    premium: { name: 'Premium', type: '상세 노트', description: '월 13,900원 · 월 30편', model: 'Claude Sonnet 5' },
  };
  const excerpts = {
    basic: '<p class="eyebrow">핵심 개념과 결론</p><h3>투자안 평가:<br>NPV와 IRR</h3><h4>01. 순현재가치법 (NPV)</h4><p>미래 현금 유입액을 할인하여 현재가치로 환산한 후 초기 투자비용을 차감한 값.</p><h4>02. 내부수익률법 (IRR)</h4><p>순현재가치를 정확히 0으로 만드는 할인율. 요구수익률보다 높으면 투자를 채택한다.</p><div class="note-callout"><p><strong>핵심 원칙</strong><br>NPV와 IRR 결과가 상충하면 NPV를 우선한다. 회수기간법은 보조 지표로 활용한다.</p></div>',
    standard: '<p class="eyebrow">개념 · 비교 · 핵심 원칙</p><h3>같은 투자안,<br>서로 다른 판단 기준</h3><h4>상호배타적 투자안에서의 불일치</h4><p>둘 중 하나만 선택할 수 있을 때, NPV와 IRR의 순위가 다를 수 있다.</p><div class="table-wrap"><table><thead><tr><th>비교 기준</th><th>대안 A</th><th>대안 B</th></tr></thead><tbody><tr><td>IRR</td><td>50%</td><td>30%</td></tr><tr><td>NPV (약)</td><td>3,600만 원</td><td>1억 8천만 원</td></tr></tbody></table></div><div class="note-callout"><p><strong>왜 B를 선택할까?</strong><br>IRR은 상대적 수익률을, NPV는 기업 가치의 절대적 증가분을 본다. 규모가 다른 투자안에서는 NPV를 기준으로 판단한다.</p></div>',
    premium: '<p class="eyebrow">개념의 연결 · 판단 근거</p><h3>수익률이 높아도<br>NPV를 먼저 보는 이유</h3><h4>투자 규모 차이로 생기는 상충</h4><p>대안 A의 IRR은 50%, B는 30%다. 수익률만 보면 A가 유리하지만, NPV는 B가 약 1억 8천만 원으로 A의 약 3,600만 원보다 크다.</p><h4>비율만으로는 알 수 없는 것</h4><p>IRR은 비율만 보여줄 뿐 절대적 부의 증가분을 반영하지 못한다. 기업 가치를 더 크게 증가시키는 대안은 B다.</p><div class="note-callout"><p><strong>다른 기준과 연결하기</strong><br>회수기간법은 회수 이후의 현금흐름과 화폐의 시간가치를 반영하지 못하므로 보조 지표로 활용한다.</p></div>',
  };
  const sample = document.getElementById('sampleDialog');
  const checkout = document.getElementById('checkout');
  const install = document.getElementById('installDialog');
  const full = document.getElementById('demoFull');
  function httpsUrl(value) {
    try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url : null; } catch { return null; }
  }
  function showExample(id) {
    const plan = plans[id];
    const result = window.SUMMRIZEI_EXAMPLES?.[id];
    if (!plan || !result) return;
    document.getElementById('sampleLabel').textContent = plan.name + ' / ' + plan.type;
    document.getElementById('sampleTitle').textContent = plan.name + ' 노트 예시';
    document.getElementById('sampleOrigin').textContent = id === 'free'
      ? '제공된 강의 샘플 원문 · 00:15–07:30 · 화면 글자와 말소리를 시간순으로 표시한 예시입니다.'
      : plan.model + ' · 2026.09.10 비교 파일의 생성 결과. 수식과 목록 표시를 정돈했습니다. 사례 수치는 원문에 따른 근삿값입니다.';
    // examples.js는 개발 시 원본을 HTML 이스케이프한 정적 콘텐츠만 포함한다.
    document.getElementById('sampleBody').innerHTML = result.html;
    sample.showModal();
    sample.scrollTop = 0;
  }
  function showPlan(id) {
    const plan = plans[id];
    if (!plan || id === 'free') return;
    document.getElementById('checkoutTitle').textContent = plan.name + ' 플랜';
    document.getElementById('checkoutDescription').textContent = plan.description;
    const link = document.getElementById('checkoutLink');
    const url = httpsUrl(window.SUMMRIZEI_CHECKOUT?.[id]);
    link.hidden = !url;
    if (url) link.href = url.href;
    else link.removeAttribute('href');
    document.getElementById('checkoutStatus').textContent = url
      ? '결제 페이지에서 최종 금액과 구독 조건을 확인해 주세요.'
      : '유료 구독을 준비하고 있습니다. 지금은 결제가 진행되지 않습니다. 출시 전까지 플랜별 예시를 살펴보세요.';
    checkout.showModal();
  }
  function showInstall() {
    const url = httpsUrl(window.SUMMRIZEI_INSTALL_URL);
    if (url && url.hostname === 'chromewebstore.google.com') window.location.assign(url.href);
    else install.showModal();
  }
  document.querySelectorAll('[data-example]').forEach(button => button.addEventListener('click', () => showExample(button.dataset.example)));
  document.querySelectorAll('[data-plan]').forEach(button => button.addEventListener('click', () => showPlan(button.dataset.plan)));
  document.querySelectorAll('[data-install]').forEach(button => button.addEventListener('click', showInstall));
  document.querySelectorAll('[data-card]').forEach(card => {
    card.addEventListener('click', event => {
      // 카드의 예시/모델 설명/선택 버튼은 각각 자신의 동작을 유지한다.
      if (event.target.closest('button,a,details') || window.getSelection()?.toString()) return;
      card.dataset.card === 'free' ? showInstall() : showPlan(card.dataset.card);
    });
  });
  const tabs = [...document.querySelectorAll('[data-demo]')];
  function selectDemo(id, focus = false) {
    for (const tab of tabs) {
      const selected = tab.dataset.demo === id;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      if (selected && focus) tab.focus();
    }
    const output = document.getElementById('demoOutput');
    output.innerHTML = excerpts[id];
    output.setAttribute('aria-labelledby', 'tab-' + id);
    document.getElementById('demoModel').textContent = plans[id].model + ' · 편집된 발췌';
    full.dataset.example = id;
  }
  tabs.forEach((tab,index) => {
    tab.addEventListener('click', () => selectDemo(tab.dataset.demo));
    tab.addEventListener('keydown', event => {
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = tabs.length - 1;
      if (next !== undefined) { event.preventDefault(); selectDemo(tabs[next].dataset.demo, true); }
    });
  });
  selectDemo('standard');
})();
