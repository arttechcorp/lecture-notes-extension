(() => {
  // example은 examples.js의 기존 예시 키를 가리킨다. 예시 본문은 아직 그대로 쓴다.
  const plans = {
    free: { name: 'Free', type: '원문 시각순 타임라인', example: 'free' },
    essential: { name: 'Essential', type: '핵심 요약', example: 'basic' },
    professional: { name: 'Professional', type: '상세 노트', example: 'premium' },
  };
  const studentToggle = document.getElementById('studentToggle');
  const sample = document.getElementById('sampleDialog');
  const checkout = document.getElementById('checkout');
  const install = document.getElementById('installDialog');
  function httpsUrl(value) {
    try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url : null; } catch { return null; }
  }
  function showExample(id) {
    const plan = plans[id];
    const result = plan && window.SUMMRIZEI_EXAMPLES?.[plan.example];
    if (!result) return;
    document.getElementById('sampleLabel').textContent = plan.name + ' / ' + plan.type;
    document.getElementById('sampleTitle').textContent = plan.name + ' 노트 예시';
    document.getElementById('sampleOrigin').textContent = id === 'free'
      ? '제공된 강의 샘플 원문 · 00:15–07:30 · 화면 글자와 말소리를 시간순으로 표시한 예시입니다.'
      : plan.type + ' · 2026.09.10 비교 파일의 생성 결과. 수식과 목록 표시를 정돈했습니다. 사례 수치는 원문에 따른 근삿값입니다.';
    // examples.js는 개발 시 원본을 HTML 이스케이프한 정적 콘텐츠만 포함한다.
    document.getElementById('sampleBody').innerHTML = result.html;
    wrapTables(document.getElementById('sampleBody'));
    sample.showModal();
    sample.scrollTop = 0;
  }
  function showPlan(id) {
    const plan = plans[id];
    if (!plan || id === 'free') return;
    document.getElementById('checkoutTitle').textContent = plan.name + ' 플랜';
    // 카드에 지금 표시 중인 금액을 그대로 읽어 학생 요금 토글과 어긋나지 않게 한다.
    const price = document.querySelector(`[data-card="${id}"] .price`);
    const student = studentToggle?.getAttribute('aria-pressed') === 'true' && price.dataset.student;
    document.getElementById('checkoutDescription').textContent =
      price.textContent.replace(/\s+/g, ' ').trim() + (student ? ' · 학생 요금' : '');
    const link = document.getElementById('checkoutLink');
    const url = httpsUrl(window.SUMMRIZEI_CHECKOUT?.[id]);
    link.hidden = !url;
    if (url) link.href = url.href;
    else link.removeAttribute('href');
    document.getElementById('checkoutStatus').textContent = url
      ? '결제 페이지에서 최종 금액과 구독 조건을 확인해 주세요.'
      : '유료 플랜은 출시 준비 중입니다. 지금은 결제가 진행되지 않습니다.';
    checkout.showModal();
  }
  function wrapTables(root) {
    for (const table of root.querySelectorAll('table')) {
      const scroll = document.createElement('div');
      scroll.className = 'table-scroll';
      scroll.tabIndex = 0;
      scroll.setAttribute('role', 'region');
      scroll.setAttribute('aria-label', '노트 표 · 좌우로 스크롤');
      table.before(scroll);
      scroll.append(table);
    }
  }
  function showInstall() {
    const url = httpsUrl(window.SUMMRIZEI_INSTALL_URL);
    const mobile = /Android|iPhone|iPad|iPod|KAKAOTALK|Instagram/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    document.getElementById('mobileInstall').hidden = !mobile;
    document.getElementById('installAddress').value = new URL('.', location.href).href;
    if (!mobile && url && url.hostname === 'chromewebstore.google.com') window.location.assign(url.href);
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
  studentToggle?.addEventListener('click', () => {
    const on = studentToggle.getAttribute('aria-pressed') !== 'true';
    studentToggle.setAttribute('aria-pressed', String(on));
    studentToggle.textContent = on ? '일반 요금 보기' : '학생이신가요?';
    for (const price of document.querySelectorAll('.price[data-student]')) {
      price.firstChild.textContent = '$' + price.dataset[on ? 'student' : 'price'];
    }
    // 배지와 CTA 문구도 함께 바꿔 학생 요금이 적용된 상태를 카드에서 읽히게 한다.
    for (const label of document.querySelectorAll('[data-student-label]')) {
      label.textContent = on ? label.dataset.studentLabel : label.dataset.label;
    }
  });
  const reviews = document.querySelector('.reviews');
  if (reviews) {
    const reviewMotion = matchMedia('(prefers-reduced-motion: reduce)');
    for (const track of reviews.querySelectorAll('.reviews-track')) {
      const group = track.querySelector('.reviews-group');
      if (!group) continue;
      for (let i = 0; i < 3; i++) {
        const copy = group.cloneNode(true);
        copy.setAttribute('aria-hidden', 'true');
        copy.inert = true;
        track.append(copy);
      }
      requestAnimationFrame(() => track.classList.add('is-ready'));
    }
    reviews.classList.add('is-ready');
    function syncReviews() {
      reviews.classList.toggle('is-paused', document.hidden || reviewMotion.matches);
    }
    reviewMotion.addEventListener('change', syncReviews);
    document.addEventListener('visibilitychange', syncReviews);
    syncReviews();
  }
  if (window.location.hash.startsWith('#example-')) {
    const ex = window.location.hash.slice(9);
    if (plans[ex]) showExample(ex);
  }
})();

// Six-second, silent sample scene on a loop; independent of the real lecture capture and hero demo.
(() => {
  const player = document.getElementById('lecturePlayer');
  const caption = document.getElementById('lectureSceneCaption');
  if (!player || !caption) return;

  const DURATION = 6000;
  const HOLD = 1600;
  const LOOP = DURATION + HOLD;
  const FULL_CAPTION = caption.textContent;
  const STAGES = [
    { max: 1500, scene: 'points', text: '훈련 데이터 세 점을 놓고' },
    { max: 3000, scene: 'boundary', text: '이 경계로 분류한다고 하면' },
    { max: 4500, scene: 'miss', text: '왼쪽 점 하나가 반대편에 있죠.' },
    { max: 6000, scene: 'loss', text: '그래서 평균 손실이 0.33입니다.' }
  ];

  let elapsed = 0;
  let rafId = null;
  let lastTime = 0;
  let inView = false;

  const mm = window.matchMedia('(prefers-reduced-motion: reduce)');

  function render(ms) {
    if (ms >= DURATION) {
      player.dataset.scene = 'complete';
      caption.textContent = FULL_CAPTION;
      return;
    }
    const stage = STAGES.find(s => ms < s.max) || STAGES[STAGES.length - 1];
    if (player.dataset.scene !== stage.scene) {
      player.dataset.scene = stage.scene;
      caption.textContent = stage.text;
    }
  }

  function tick(now) {
    elapsed += now - lastTime;
    lastTime = now;
    if (elapsed >= LOOP) elapsed -= LOOP;
    render(Math.min(elapsed, DURATION));
    rafId = requestAnimationFrame(tick);
  }

  function play() {
    if (rafId !== null || mm.matches || document.hidden || !inView) return;
    player.dataset.playing = 'true';
    lastTime = performance.now();
    rafId = requestAnimationFrame(tick);
  }

  function pause() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    player.dataset.playing = 'false';
  }

  function handleMotion() {
    if (mm.matches) {
      pause();
      elapsed = 0;
      render(DURATION);
    } else {
      play();
    }
  }
  player.dataset.playing = 'false';
  mm.addEventListener('change', handleMotion);

  document.addEventListener('visibilitychange', () => { document.hidden ? pause() : play(); });
  window.addEventListener('pagehide', pause);

  if ('IntersectionObserver' in window) {
    new IntersectionObserver((entries) => {
      for (const entry of entries) {
        inView = entry.isIntersecting;
        inView ? play() : pause();
      }
    }, { threshold: 0 }).observe(player);
  } else {
    inView = true;
    play();
  }
})();
