/* 클릭으로 체험하는 준비 → 캡처 → 노트. 준비된 예시만 사용하며,
   화면/마이크 권한, AI 요청, 저장소 접근은 하지 않는다. */
(() => {
  const mock = document.querySelector('#heroDemo');
  const frame = mock?.querySelector('.demo-panel');
  if (!frame) return;

  function mount() {
    const panel = frame.contentDocument;
    if (!panel?.querySelector('#startBtn') || frame.dataset.mounted) return;
    frame.dataset.mounted = 'true';
    const $ = (id) => panel.getElementById(id);
    const noteViewer = NoteViewer.create(panel);
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const pauseButton = mock.querySelector('.lec-play-toggle');
    const announcement = mock.querySelector('.demo-announcement');
    const captions = [
      'NPV는 투자로 만들어지는 가치를 현재 시점의 금액으로 비교합니다.',
      'IRR은 순현재가치가 0이 되는 할인율, 즉 수익률 기준입니다.',
      '초기 투자금이 같아도 현금이 들어오는 시점에 따라 가치가 달라집니다.',
      '앞에서 더 많이 회수하는 B안의 NPV는 117달러로 가장 높습니다.',
      '서로 다른 규모의 투자안은 수익률만으로 비교하면 안 됩니다.',
      '상호배타적인 대안은 NPV와 판단 근거를 함께 확인하세요.',
    ];
    const note = `## 핵심 요약

> 같은 금액이라도 **언제 받는지**에 따라 가치가 달라집니다. 이 예시에서는 현금을 일찍 회수하는 B안이 가장 유리합니다.

### NPV와 IRR, 무엇이 다를까?
- **NPV · 순현재가치**: 투자로 창출하는 가치를 현재 시점의 금액으로 나타냅니다.
- **IRR · 내부수익률**: NPV를 0으로 만드는 할인율입니다.

### 할인율 20%에서 비교
초기 투자금은 모두 **1,000달러**입니다.

| 투자안 | NPV | IRR |
| --- | ---: | ---: |
| A | 약 $35 | 약 22% |
| **B** | **약 $117** | **약 27%** |
| C | 약 −$46 | 약 18% |

### 기억할 판단 기준
1. 금액뿐 아니라 **현금이 들어오는 시점**을 함께 비교합니다.
2. 규모가 다른 상호배타적 대안은 수익률만으로 고르지 않습니다.
3. NPV가 보여주는 **가치 증가**와 판단 근거를 확인합니다.

---

### 복습 질문
- [ ] 총유입액이 같아도 B안과 C안의 NPV가 다른 이유를 설명할 수 있나요?`;

    let stage = 'ready';
    let elapsed = 0;
    let voice = 0;
    let slides = 0;
    let lastEvent = -1;
    let lastCapture = -10;
    let captureTimer;
    let noteTimer;
    let userPaused = false;
    let inView = true;
    let dismissedStopGuide = false;

    const formatTime = (seconds) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
    const resize = () => {
      mock.style.setProperty('--demo-panel-height', `${Math.ceil(panel.body.getBoundingClientRect().height)}px`);
    };
    new ResizeObserver(resize).observe(panel.body);
    panel.fonts.ready.then(resize);

    function showStage(next) {
      stage = next;
      mock.dataset.state = next;
      for (const name of ['Ready', 'Live', 'Done']) {
        const active = next === name.toLowerCase();
        $(`stage${name}`).hidden = !active;
        $(`step${name}`).classList.toggle('active', active);
        if (active) $(`step${name}`).setAttribute('aria-current', 'step');
        else $(`step${name}`).removeAttribute('aria-current');
      }
      pauseButton.hidden = next !== 'live';
      mock.querySelector('.lec-idle-play').hidden = next === 'live';
      resize();
    }

    function showSlide(index) {
      mock.querySelectorAll('[data-slide]').forEach((slide, i) => { slide.hidden = i !== index; });
    }

    function captureTick() {
      elapsed += .4;
      $('elapsed').textContent = formatTime(elapsed);
      mock.querySelector('#lectureTime').textContent = formatTime(727 + elapsed);
      mock.style.setProperty('--lecture-progress', `${Math.min(99, (727 + elapsed) / 1340 * 100)}%`);
      const event = Math.floor(elapsed / 2.4);
      if (event !== lastEvent) {
        lastEvent = event;
        voice += 1;
        const text = captions[event % captions.length];
        const feed = $('feedLines');
        feed.querySelector('.empty')?.remove();
        const line = panel.createElement('div');
        const time = panel.createElement('span');
        time.className = 't';
        time.textContent = formatTime(727 + elapsed);
        const content = panel.createElement('span');
        content.textContent = text;
        line.append(time, content);
        feed.append(line);
        while (feed.children.length > 3) feed.firstElementChild.remove();
        $('cntVoice').textContent = String(voice);
        mock.querySelector('#lectureCaption').textContent = text;
        if (event % 2 === 0) {
          slides += 1;
          lastCapture = elapsed;
          showSlide(Math.floor(event / 2) % 3);
          $('cntSlides').textContent = String(slides);
          mock.classList.add('is-scanning');
        }
        if (voice >= 2 && !dismissedStopGuide) $('stopGuide').hidden = false;
      }
      const scanning = elapsed - lastCapture < 1.2;
      $('cntQueue').textContent = scanning ? '1' : '0';
      if (!scanning) mock.classList.remove('is-scanning');
    }

    function updatePlayback() {
      const playing = stage === 'live' && !userPaused && inView && !document.hidden;
      clearInterval(captureTimer);
      if (playing) captureTimer = setInterval(captureTick, 400);
      mock.classList.toggle('is-paused', !playing);
      panel.querySelector('.pulse').style.animationPlayState = playing ? 'running' : 'paused';
      pauseButton.setAttribute('aria-label', userPaused ? '체험 재생' : '체험 일시정지');
      pauseButton.querySelector('path').setAttribute('d', userPaused ? 'M4 3l8 5-8 5Z' : 'M4 3v10M12 3v10');
    }

    function completeNote() {
      clearInterval(noteTimer);
      noteViewer.show(note);
      $('copyBtn').disabled = false;
      $('donePill').textContent = '노트 완성';
      announcement.textContent = '예시 노트가 완성되었습니다. 내용을 읽거나 새로 캡처하기로 다시 체험할 수 있습니다.';
    }

    $('startBtn').addEventListener('click', () => {
      if (stage !== 'ready') return;
      showStage('live');
      userPaused = false;
      updatePlayback();
      $('stopBtn').focus({ preventScroll: true });
      announcement.textContent = '캡처 체험이 시작되었습니다. 화면과 음성이 인식되는 예시를 확인한 뒤 캡처 마치고 노트 보기를 누르세요.';
    });

    $('stopBtn').addEventListener('click', () => {
      if (stage !== 'live') return;
      showStage('done');
      updatePlayback();
      mock.classList.remove('is-scanning');
      $('cntQueue').textContent = '0';
      $('doneSummary').textContent = `화면 ${slides}개 · 음성 ${voice}줄`;
      $('donePill').textContent = '노트 생성 중';
      noteViewer.show('', { generating: true });
      $('copyBtn').disabled = true;
      $('resultTitle').focus({ preventScroll: true });
      mock.querySelector('#lectureCaption').textContent = '강의에서 모은 내용이 학습 노트로 정리됩니다.';
      announcement.textContent = '예시 강의를 핵심 요약본으로 정리하고 있습니다.';
      if (reducedMotion.matches) return completeNote();
      let cursor = 0;
      noteTimer = setInterval(() => {
        cursor += 6;
        noteViewer.show(note.slice(0, cursor), { generating: true });
        if (cursor >= note.length) completeNote();
      }, 24);
    });

    $('againBtn').addEventListener('click', () => {
      clearInterval(captureTimer);
      clearInterval(noteTimer);
      elapsed = voice = slides = 0;
      lastEvent = -1;
      lastCapture = -10;
      dismissedStopGuide = false;
      userPaused = false;
      $('elapsed').textContent = '00:00';
      for (const id of ['cntSlides', 'cntVoice', 'cntQueue']) $(id).textContent = '0';
      const empty = panel.createElement('div');
      empty.className = 'empty';
      empty.textContent = '아직 인식된 내용이 없습니다.';
      $('feedLines').replaceChildren(empty);
      noteViewer.show('');
      $('copyBtn').disabled = true;
      $('startGuide').hidden = false;
      $('stopGuide').hidden = true;
      mock.classList.remove('is-scanning');
      mock.style.removeProperty('--lecture-progress');
      mock.querySelector('#lectureTime').textContent = '12:07';
      mock.querySelector('#lectureCaption').textContent = '캡처 시작을 눌러 강의를 함께 들어보세요.';
      showSlide(0);
      showStage('ready');
      updatePlayback();
      $('startBtn').focus({ preventScroll: true });
      announcement.textContent = '체험을 초기화했습니다. 캡처 시작으로 다시 체험하세요.';
    });

    pauseButton.addEventListener('click', () => { userPaused = !userPaused; updatePlayback(); });
    $('copyBtn').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText($('result').value);
        $('copyBtn').textContent = '복사됨 ✓';
        setTimeout(() => { $('copyBtn').textContent = '복사'; }, 1500);
      } catch {
        noteViewer.edit(true);
        $('result').focus({ preventScroll: true });
        $('result').select();
        announcement.textContent = '노트를 선택했습니다. 직접 복사해 주세요.';
      }
    });
    for (const button of panel.querySelectorAll('[data-dismiss]')) {
      button.addEventListener('click', () => {
        $(button.dataset.dismiss).hidden = true;
        if (button.dataset.dismiss === 'stopGuide') dismissedStopGuide = true;
        $(stage === 'ready' ? 'startBtn' : 'stopBtn').focus({ preventScroll: true });
      });
    }
    for (const id of ['settingsLink', 'settingsToggle', 'formatToggle']) {
      $(id).addEventListener('click', () => $('demoSettings').showModal());
    }
    $('closeSettings').addEventListener('click', () => $('demoSettings').close());
    document.addEventListener('visibilitychange', updatePlayback);
    new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; updatePlayback(); }).observe(mock);
    reducedMotion.addEventListener('change', () => {
      if (reducedMotion.matches && stage === 'done' && $('notePreview').getAttribute('aria-busy') === 'true') completeNote();
    });
    window.addEventListener('pagehide', () => { clearInterval(captureTimer); clearInterval(noteTimer); });
    resize();
  }

  frame.addEventListener('load', mount);
  mount();
})();
