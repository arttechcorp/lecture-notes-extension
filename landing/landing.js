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
    const reviewControl = reviews.querySelector('.reviews-control');
    let reviewsPaused = false;
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
      const paused = reviewsPaused || document.hidden || reviewMotion.matches;
      reviews.classList.toggle('is-paused', paused);
      if (!reviewControl) return;
      reviewControl.hidden = reviewMotion.matches;
      reviewControl.setAttribute('aria-pressed', String(paused));
      reviewControl.textContent = paused ? '후기 흐름 재생' : '후기 흐름 일시정지';
    }
    reviewControl?.addEventListener('click', () => { reviewsPaused = !reviewsPaused; syncReviews(); });
    reviewMotion.addEventListener('change', syncReviews);
    document.addEventListener('visibilitychange', syncReviews);
    syncReviews();
  }
  if (window.location.hash.startsWith('#example-')) {
    const ex = window.location.hash.slice(9);
    if (plans[ex]) showExample(ex);
  }
})();

// Six-second, silent sample scene; independent of the real lecture capture and hero demo.
(() => {
  const player = document.getElementById('lecturePlayer');
  const playBtn = document.getElementById('lectureScenePlay');
  const label = playBtn?.querySelector('[data-player-label]');
  const caption = document.getElementById('lectureSceneCaption');
  const timeEl = document.getElementById('lectureSceneTime');
  const progEl = document.getElementById('lectureSceneProgress');

  if (!player || !playBtn || !label || !caption || !timeEl || !progEl) {
    if (playBtn) playBtn.hidden = true;
    return;
  }

  const BASE_SEC = 340;
  const TOTAL_SEC = 2538;
  const DURATION = 6000;
  const FULL_CAPTION = caption.textContent;
  const STAGES = [
    { max: 1500, scene: 'current', text: '지금 조건에서는' },
    { max: 3000, scene: 'choice', text: '위쪽 안을 고르면 됩니다.' },
    { max: 4500, scene: 'crossing', text: '다만 여기 교차점을 지나면' },
    { max: 6000, scene: 'after', text: '순서가 바뀌죠.' }
  ];

  let elapsed = 0;
  let rafId = null;
  let lastTime = 0;
  let hasInteracted = false;
  let ioInit = true;

  const mm = window.matchMedia('(prefers-reduced-motion: reduce)');

  function fmtTime(sec) {
    const m = String(Math.floor(sec / 60)).padStart(2, '0');
    const s = String(Math.floor(sec % 60)).padStart(2, '0');
    return `${m}:${s}`;
  }

  function render(ms) {
    const curSec = BASE_SEC + (ms / 1000);
    progEl.style.width = `${((curSec / TOTAL_SEC) * 100).toFixed(3)}%`;
    timeEl.textContent = fmtTime(curSec);

    if (ms >= DURATION) {
      player.dataset.scene = 'complete';
      caption.textContent = FULL_CAPTION;
      label.textContent = '다시 재생';
      return;
    }

    const stage = STAGES.find(s => ms < s.max) || STAGES[STAGES.length - 1];
    if (player.dataset.scene !== stage.scene) {
      player.dataset.scene = stage.scene;
      caption.textContent = stage.text;
    }
  }

  function pause() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    player.dataset.playing = 'false';
    playBtn.setAttribute('aria-pressed', 'false');
    if (elapsed < DURATION && hasInteracted) {
      label.textContent = '이어서 재생';
    }
  }

  function tick(now) {
    elapsed += (now - lastTime);
    lastTime = now;
    if (elapsed >= DURATION) {
      elapsed = DURATION;
      render(DURATION);
      pause();
      return;
    }
    render(elapsed);
    rafId = requestAnimationFrame(tick);
  }

  function play() {
    if (mm.matches || document.hidden) return;
    if (elapsed >= DURATION) {
      elapsed = 0;
      render(0);
    }
    hasInteracted = true;
    render(elapsed);
    player.dataset.playing = 'true';
    playBtn.setAttribute('aria-pressed', 'true');
    label.textContent = '일시정지';
    lastTime = performance.now();
    rafId = requestAnimationFrame(tick);
  }

  playBtn.addEventListener('click', () => {
    if (player.dataset.playing === 'true') pause();
    else play();
  });

  function handleMotion() {
    if (mm.matches) {
      pause();
      elapsed = 0;
      hasInteracted = false;
      render(DURATION);
      label.textContent = '장면 재생';
      timeEl.textContent = '05:40';
      progEl.style.width = `${((BASE_SEC / TOTAL_SEC) * 100).toFixed(3)}%`;
      playBtn.hidden = true;
    } else {
      playBtn.hidden = false;
    }
  }
  player.dataset.playing = 'false';
  playBtn.setAttribute('aria-pressed', 'false');
  mm.addEventListener('change', handleMotion);
  handleMotion();

  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  window.addEventListener('pagehide', pause);

  const io = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (ioInit) { ioInit = false; return; }
      if (!entry.isIntersecting) pause();
    });
  }, { threshold: 0 }) : null;
  io?.observe(player);
})();
