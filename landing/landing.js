(() => {
  const plans = {
    free: { name: 'Free', type: '원문 시각순 타임라인', description: '0원 · 기기에서 원문 수집' },
    basic: { name: 'Basic', type: '핵심 요약', description: '월 4,900원' },
    standard: { name: 'Standard', type: '학습 노트', description: '월 7,900원' },
    premium: { name: 'Premium', type: '상세 노트', description: '월 13,900원' },
  };
  // 발췌는 examples.js의 전체 예시 앞부분에서 파생한다. 같은 내용을 손으로 두 번 쓰지 않는다.
  // #demoOutput은 h3를 제목, h4를 소제목으로 스타일링하므로 첫 제목만 h3로 내린다.
  function excerpt(id) {
    const source = window.SUMMRIZEI_EXAMPLES?.[id]?.html;
    if (!source) return '';
    const holder = document.createElement('div');
    holder.innerHTML = source;
    const parts = [`<p class="eyebrow">${plans[id].type}</p>`];
    let headings = 0;
    for (const block of holder.children) {
      if (block.tagName === 'HR') continue;
      if (/^H[1-4]$/.test(block.tagName)) {
        const level = headings++ === 0 ? 'h3' : 'h4';
        parts.push(`<${level}>${block.innerHTML}</${level}>`);
      } else parts.push(block.outerHTML);
      if (parts.length > 5) break;
    }
    return parts.join('');
  }

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
      : plan.type + ' · 2026.09.10 비교 파일의 생성 결과. 수식과 목록 표시를 정돈했습니다. 사례 수치는 원문에 따른 근삿값입니다.';
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
      // 카드 안의 예시 보기와 선택 버튼은 각각 자신의 동작을 유지한다.
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
    output.innerHTML = excerpt(id);
    output.setAttribute('aria-labelledby', 'tab-' + id);
    document.getElementById('demoModel').textContent = plans[id].type + ' · 편집된 발췌';
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
