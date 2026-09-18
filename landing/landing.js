(() => {
  // example은 examples.js의 기존 예시 키를 가리킨다. 예시 본문은 아직 그대로 쓴다.
  const plans = {
    free: { name: 'Free', type: '원문 시각순 타임라인', example: 'free' },
    essential: { name: 'Essential', type: '핵심 요약', example: 'basic' },
    professional: { name: 'Professional', type: '상세 노트', example: 'premium' },
  };
  const studentToggle = document.getElementById('studentToggle');
  const sample = document.getElementById('sampleDialog');
  const reserve = document.getElementById('reserveDialog');
  const reserveForm = document.getElementById('reserveForm');
  // CSS의 @media(max-width:760px)와 같은 기준으로 모바일 동작을 가른다.
  const mobileTap = matchMedia('(max-width: 760px)');
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
  function showReserve(planId) {
    const plan = plans[planId];
    const label = document.getElementById('reservePlan');
    label.hidden = !plan;
    if (plan) label.textContent = plan.name + ' 플랜으로 예약';
    reserveForm.dataset.plan = plan?.name ?? '';
    document.getElementById('reserveStatus').textContent = '';
    reserve.showModal();
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
  const reserveInputs = {
    email: [document.getElementById('reserveEmail'), document.getElementById('reserveEmailError')],
    phone: [document.getElementById('reservePhone'), document.getElementById('reservePhoneError')],
    consent: [document.getElementById('reserveConsent'), document.getElementById('reserveConsentError')],
  };
  function reserveValid(key) {
    const [input, error] = reserveInputs[key];
    const ok = input.checkValidity();
    error.hidden = ok;
    input.setAttribute('aria-invalid', String(!ok));
    return ok;
  }
  reserveForm.addEventListener('submit', async event => {
    event.preventDefault();
    const status = document.getElementById('reserveStatus');
    const submit = document.getElementById('reserveSubmit');
    // 전송 중에는 재진입을 막아 중복 제출을 방지한다.
    if (submit.disabled) return;
    const ok = ['email', 'phone', 'consent'].map(reserveValid).every(Boolean);
    if (!ok) {
      status.textContent = '';
      reserveInputs[['email', 'phone', 'consent'].find(key => !reserveInputs[key][0].checkValidity())][0].focus();
      return;
    }
    const conf = window.SUMMRIZEI_WAITLIST;
    if (!conf?.url || !conf?.anonKey) {
      status.textContent = '예약 접수를 준비하고 있습니다. 잠시 후 다시 시도해 주세요.';
      return;
    }
    submit.disabled = true;
    status.textContent = '예약을 보내고 있습니다…';
    try {
      const res = await fetch(conf.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          apikey: conf.anonKey,
          authorization: 'Bearer ' + conf.anonKey,
          prefer: 'return=minimal',
        },
        body: JSON.stringify({
          email: reserveInputs.email[0].value.trim(),
          phone: reserveInputs.phone[0].value.replace(/\D/g, ''),
          plan: reserveForm.dataset.plan || null,
        }),
      });
      if (res.status === 409) {
        status.textContent = '이미 사전 예약된 이메일이에요.';
      } else if (!res.ok) {
        status.textContent = '예약을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.';
      } else {
        sessionStorage.setItem('summrizei.reserved', JSON.stringify({
          email: reserveInputs.email[0].value.trim(),
          plan: reserveForm.dataset.plan || '',
        }));
        location.assign('thanks.html');
        return;
      }
    } catch {
      status.textContent = '네트워크 오류로 예약을 보내지 못했습니다. 연결을 확인해 주세요.';
    }
    submit.disabled = false;
  });
  document.querySelectorAll('[data-example]').forEach(button => button.addEventListener('click', () => showExample(button.dataset.example)));
  document.querySelectorAll('[data-reserve]').forEach(button => button.addEventListener('click', () => showReserve(button.dataset.reserve)));
  // 모바일에서는 카드 빈 곳 탭으로 예약창이 뜨지 않게 한다(docs/mobile-web-principles.md §4).
  document.querySelectorAll('[data-card]').forEach(card => {
    card.addEventListener('click', event => {
      // 카드 안의 예시 보기와 선택 버튼은 각각 자신의 동작을 유지한다.
      if (event.target.closest('button,a,details') || window.getSelection()?.toString()) return;
      if (mobileTap.matches) return;
      showReserve(card.dataset.card);
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
    // ≤760px 모바일에서는 자동 마퀴 대신 스와이프 카드 목록을 쓴다(docs/mobile-web-principles.md §4).
    const tracks = [...reviews.querySelectorAll('.reviews-track')];
    const copies = [];
    function enableMarquee() {
      for (const track of tracks) {
        const group = track.querySelector('.reviews-group');
        if (!group) continue;
        for (let i = 0; i < 3; i++) {
          const copy = group.cloneNode(true);
          copy.setAttribute('aria-hidden', 'true');
          copy.inert = true;
          track.append(copy);
          copies.push(copy);
        }
        requestAnimationFrame(() => { if (!mobileTap.matches) track.classList.add('is-ready'); });
      }
      reviews.classList.add('is-ready');
    }
    function disableMarquee() {
      for (const copy of copies.splice(0)) copy.remove();
      for (const track of tracks) track.classList.remove('is-ready');
      reviews.classList.remove('is-ready', 'is-paused');
    }
    function syncReviews() {
      reviews.classList.toggle('is-paused', document.hidden || reviewMotion.matches);
    }
    function applyReviewMode() {
      if (mobileTap.matches) disableMarquee(); else enableMarquee();
      syncReviews();
    }
    mobileTap.addEventListener('change', applyReviewMode);
    reviewMotion.addEventListener('change', syncReviews);
    document.addEventListener('visibilitychange', syncReviews);
    applyReviewMode();
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
