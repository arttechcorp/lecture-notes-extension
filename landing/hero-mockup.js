/* 자동으로 반복되는 준비된 예시. 화면/마이크 권한, AI 요청, 저장소 접근은 하지 않는다. */
(() => {
  const mock = document.querySelector('#heroDemo');
  const frame = mock?.querySelector('.demo-panel');
  const tiltFrame = mock?.querySelector('.mock-tilt');
  const canvasFrame = mock?.querySelector('.mock-window');
  if (!frame || !tiltFrame || !canvasFrame) return;

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  function mount() {
    const panel = frame.contentDocument;
    if (!panel?.querySelector('#stageLive') || frame.dataset.mounted) return;
    frame.dataset.mounted = 'true';
    const $ = (id) => panel.getElementById(id);
    const noteViewer = NoteViewer.create(panel);
    const editButton = $('noteEditBtn');
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

    const CAPTURE_SECONDS = 14.4;
    const NOTE_HOLD_MS = 4200;
    let stage = 'live';
    let elapsed = 0;
    let voice = 0;
    let slides = 0;
    let lastEvent = -1;
    let lastCapture = -10;
    let captureTimer;
    let noteTimer;
    let loopTimer;
    let generationCursor = 0;
    let generating = false;
    let userPaused = false;
    let inView = true;
    let activeSlide = -1;
    let inkPaths = [];
    let inkLength = 0;
    let inkPen;
    let inkFrame;
    let inkTime = 0;
    let inkLastTime;

    const formatTime = (seconds) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
    const lockDemoEditing = () => { if (editButton) editButton.disabled = true; };
    const updateScale = () => mock.style.setProperty('--mock-scale', Math.max(.01, canvasFrame.clientWidth / 960).toFixed(3));

    function updateTilt() {
      updateScale();
      if (reducedMotion.matches) {
        tiltFrame.style.removeProperty('transform');
        return;
      }
      const mobile = window.matchMedia('(max-width: 760px)').matches;
      const progress = clamp(window.scrollY / 400, 0, 1);
      const rotation = mobile ? 0 : 12 * (1 - progress);
      const scale = (mobile ? .88 : .78) + (mobile ? .12 : .22) * progress;
      tiltFrame.style.transform = `perspective(1200px) rotateX(${rotation}deg) scale(${scale})`;
      tiltFrame.style.transformOrigin = 'center top';
    }

    function showStage(next) {
      stage = next;
      mock.dataset.state = next;
      for (const name of ['Live', 'Done']) {
        const active = next === name.toLowerCase();
        $(`stage${name}`).hidden = !active;
        $(`step${name}`).classList.toggle('active', active);
        if (active) $(`step${name}`).setAttribute('aria-current', 'step');
        else $(`step${name}`).removeAttribute('aria-current');
      }
    }

    function showSlide(index) {
      if (activeSlide === index) return;
      activeSlide = index;
      mock.querySelectorAll('[data-slide]').forEach((slide, i) => { slide.hidden = i !== index; });
      const ink = mock.querySelector(`[data-slide="${index}"] .lecture-ink`);
      inkPaths = Array.from(ink?.querySelectorAll('[data-ink]') || [], (path) => ({ path, length: path.getTotalLength() }));
      inkLength = inkPaths.reduce((total, stroke) => total + stroke.length, 0);
      inkPen = ink?.querySelector('.lecture-pen');
      inkTime = 0;
      inkLastTime = undefined;
      paintInk(reducedMotion.matches ? 4.2 : 0);
    }

    // SVG 획 길이에 맞춰 잉크와 커서를 함께 이동한다. 슬라이드마다 0.5초 대기 + 3.6초 필기.
    function paintInk(seconds) {
      let remaining = clamp((seconds - .5) / 3.6, 0, 1) * inkLength;
      let tip;
      for (const { path, length } of inkPaths) {
        const drawn = clamp(remaining, 0, length);
        path.style.strokeDashoffset = String(1 - drawn / length);
        if (remaining > 0) tip = path.getPointAtLength(drawn);
        remaining -= length;
      }
      if (!inkPen) return;
      if (tip) inkPen.setAttribute('transform', `translate(${tip.x} ${tip.y}) rotate(-25) scale(.8)`);
      inkPen.style.opacity = tip && seconds < 4.1 && !reducedMotion.matches ? '1' : '0';
    }

    function writeInk(now) {
      if (inkLastTime !== undefined) inkTime += (now - inkLastTime) / 1000;
      inkLastTime = now;
      paintInk(inkTime);
      inkFrame = requestAnimationFrame(writeInk);
    }

    function canPlay() { return !userPaused && inView && !document.hidden; }

    function updatePauseButton() {
      const paused = reducedMotion.matches || userPaused || !inView || document.hidden;
      pauseButton.setAttribute('aria-label', paused ? '체험 재생' : '체험 일시정지');
      pauseButton.setAttribute('aria-pressed', String(userPaused));
      pauseButton.querySelector('path').setAttribute('d', paused ? 'M4 3l8 5-8 5Z' : 'M4 3v10M12 3v10');
    }

    function queueLoop() {
      clearTimeout(loopTimer);
      if (!reducedMotion.matches && canPlay()) loopTimer = setTimeout(() => {
        loopTimer = undefined;
        startCapture();
      }, NOTE_HOLD_MS);
    }

    function updatePlayback() {
      clearInterval(captureTimer);
      clearInterval(noteTimer);
      clearTimeout(loopTimer);
      cancelAnimationFrame(inkFrame);
      inkLastTime = undefined;
      loopTimer = undefined;
      const playing = canPlay() && !reducedMotion.matches;
      if (playing && stage === 'live') captureTimer = setInterval(captureTick, 400);
      if (playing && stage === 'live') inkFrame = requestAnimationFrame(writeInk);
      if (playing && stage === 'done' && generating) noteTimer = setInterval(generateNoteTick, 24);
      if (playing && stage === 'done' && !generating && !loopTimer) queueLoop();
      mock.classList.toggle('is-paused', !playing);
      const pulse = panel.querySelector('.pulse');
      if (pulse) pulse.style.animationPlayState = playing ? 'running' : 'paused';
      updatePauseButton();
    }

    function captureTick() {
      elapsed += .4;
      $('elapsed').textContent = formatTime(elapsed);
      mock.querySelector('#lectureTime').textContent = formatTime(727 + elapsed);
      mock.style.setProperty('--lecture-progress', `${Math.min(99, (727 + elapsed) / 1340 * 100)}%`);
      if (elapsed + .001 >= CAPTURE_SECONDS) return finishCapture();
      const event = Math.floor((elapsed + .001) / 2.4);
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
      }
      const scanning = elapsed - lastCapture < 1.2;
      $('cntQueue').textContent = scanning ? '1' : '0';
      if (!scanning) mock.classList.remove('is-scanning');
    }

    function generateNoteTick() {
      generationCursor += 6;
      noteViewer.show(note.slice(0, generationCursor), { generating: true });
      if (generationCursor >= note.length) completeNote();
    }

    function completeNote() {
      clearInterval(noteTimer);
      generating = false;
      noteViewer.show(note);
      lockDemoEditing();
      $('copyBtn').disabled = false;
      $('donePill').textContent = '노트 완성';
      announcement.textContent = '예시 노트가 완성되었습니다. 일시정지하면 내용을 읽거나 복사할 수 있습니다.';
      queueLoop();
    }

    function finishCapture() {
      clearInterval(captureTimer);
      paintInk(4.2);
      mock.classList.remove('is-scanning');
      $('cntQueue').textContent = '0';
      $('doneSummary').textContent = `화면 ${slides}개 · 음성 ${voice}줄`;
      $('donePill').textContent = '노트 생성 중';
      $('copyBtn').disabled = true;
      $('copyBtn').textContent = '복사';
      mock.querySelector('#lectureCaption').textContent = '강의에서 모은 내용이 학습 노트로 정리됩니다.';
      noteViewer.show('', { generating: true });
      lockDemoEditing();
      generationCursor = 0;
      generating = true;
      showStage('done');
      announcement.textContent = '예시 강의를 핵심 요약본으로 정리하고 있습니다.';
      if (reducedMotion.matches) completeNote();
      else updatePlayback();
    }

    function startCapture() {
      clearTimeout(loopTimer);
      clearInterval(captureTimer);
      clearInterval(noteTimer);
      elapsed = voice = slides = 0;
      lastEvent = -1;
      lastCapture = -10;
      activeSlide = -1;
      $('elapsed').textContent = '00:00';
      for (const id of ['cntSlides', 'cntVoice', 'cntQueue']) $(id).textContent = '0';
      const empty = panel.createElement('div');
      empty.className = 'empty';
      empty.textContent = '아직 인식된 내용이 없습니다.';
      $('feedLines').replaceChildren(empty);
      noteViewer.show('');
      lockDemoEditing();
      $('copyBtn').disabled = true;
      mock.style.removeProperty('--lecture-progress');
      mock.querySelector('#lectureTime').textContent = '12:07';
      mock.querySelector('#lectureCaption').textContent = '화면과 음성을 읽는 중입니다.';
      showSlide(0);
      showStage('live');
      announcement.textContent = '화면과 음성을 인식하는 예시를 재생하고 있습니다.';
      if (reducedMotion.matches) {
        finishCapture();
        updatePlayback();
        return;
      }
      updatePlayback();
    }

    pauseButton.hidden = false;
    pauseButton.addEventListener('click', () => {
      userPaused = !userPaused;
      updatePlayback();
    });
    $('copyBtn').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText($('result').value);
        $('copyBtn').textContent = '복사됨 ✓';
        setTimeout(() => { $('copyBtn').textContent = '복사'; }, 1500);
      } catch {
        noteViewer.edit(false);
        announcement.textContent = '복사 권한을 사용할 수 없습니다. 일시정지한 뒤 직접 선택해 주세요.';
      }
    });
    lockDemoEditing();
    document.addEventListener('visibilitychange', updatePlayback);
    new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; updatePlayback(); }).observe(mock);
    reducedMotion.addEventListener('change', () => {
      updateTilt();
      if (reducedMotion.matches) {
        clearInterval(captureTimer);
        clearInterval(noteTimer);
        startCapture();
      }
      updatePlayback();
    });
    window.addEventListener('scroll', updateTilt, { passive: true });
    window.addEventListener('resize', updateTilt);
    window.addEventListener('pagehide', () => { clearInterval(captureTimer); clearInterval(noteTimer); clearTimeout(loopTimer); cancelAnimationFrame(inkFrame); });
    updateTilt();
    startCapture();
  }

  frame.addEventListener('load', mount);
  mount();
})();
