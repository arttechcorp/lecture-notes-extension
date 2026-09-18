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
    const note = `> ⚠ 노트가 다루지 못한 근거가 1건 있습니다 — 05:47

## 핵심 결론
- **NPV(순현재가치)**: 투자 가치를 현재 금액으로 환산 — 같은 금액도 받는 시점에 따라 달라짐
- **IRR(내부수익률)**: NPV를 0으로 만드는 할인율 — 규모가 다른 대안 비교에는 부적합
- 할인율 20% 기준 B안 NPV **$117**로 최대 → 상호배타적 대안은 NPV 우선

## 1 구간 · 현재가치 개념 도입 ⭐
**슬라이드 제목:** Time Value of Money
- 오늘의 $100 > 내년의 $100 — 미래 현금을 현재가치로 환산

**강의자 설명(t≈0:40–1:36):** 회수 시점이 가치를 바꾼다고 강조

### 현재가치
PV = CFₜ ÷ (1 + r)ᵗ — 변수: CFₜ 미래 현금흐름, r 할인율 · 조건: 연 복리

## 2 구간 · 세 투자안 비교 평가 ⭐
| 투자안 | NPV | IRR |
| --- | ---: | ---: |
| A | $35 | 22% |
| **B** | **$117** | **27%** |
| C | −$46 | 18% |

**강의자 설명(t≈1:37–4:02):** 앞쪽 회수가 몰린 B안이 NPV 최대

## 복습 질문
- [ ] 총유입액이 같아도 B안과 C안의 NPV가 다른 이유를 회수 시점으로 설명하시오.
- [ ] 상호배타적 대안을 IRR만으로 고르지 못하는 이유를 설명하시오.
- [ ] 할인율이 올라갈 때 NPV가 어떻게 변하는지 설명하시오.`;

    const CAPTURE_SECONDS = 8;
    const NOTE_HOLD_MS = 2000;
    const SHARE_SECONDS = 2.8;
    const TABLET_SECONDS = 6.4;
    let stage = 'live';
    let elapsed = 0;
    let voice = 0;
    let slides = 0;
    let lastEvent = -1;
    let lastCapture = -10;
    let captureTimer;
    let noteTimer;
    let loopTimer;
    let phaseTimer;
    let phaseElapsed = 0;
    let hlGeom;
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
      panel.documentElement.classList.toggle('mobile-demo', window.matchMedia('(max-width: 760px)').matches);
      if (reducedMotion.matches || window.matchMedia('(max-width: 760px)').matches) {
        tiltFrame.style.removeProperty('transform');
        return;
      }
      // 목업 상단이 뷰포트의 40% 지점에 도달하면 평면 완료 — 스크롤 px 고정값 대신 요소 위치 기준.
      // 단 히어로 전체가 한 화면에 들어가는 큰 뷰포트에서도 틸트가 보이도록 최소 이동 거리(18vh)를 둔다.
      const endScroll = Math.max(window.innerHeight * .18,
        mock.getBoundingClientRect().top + window.scrollY - window.innerHeight * .4);
      const progress = clamp(window.scrollY / endScroll, 0, 1);
      const rotation = 12 * (1 - progress);
      const scale = .78 + .22 * progress;
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
        startShare();
      }, NOTE_HOLD_MS);
    }

    function updatePlayback() {
      clearInterval(captureTimer);
      clearInterval(noteTimer);
      clearInterval(phaseTimer);
      clearTimeout(loopTimer);
      cancelAnimationFrame(inkFrame);
      inkLastTime = undefined;
      loopTimer = undefined;
      phaseTimer = undefined;
      const playing = canPlay() && !reducedMotion.matches;
      if (playing && stage === 'live') captureTimer = setInterval(captureTick, 400);
      if (playing && stage === 'live') inkFrame = requestAnimationFrame(writeInk);
      if (playing && stage === 'done' && generating) noteTimer = setInterval(generateNoteTick, 24);
      if (playing && stage === 'done' && !generating && !loopTimer) queueLoop();
      if (playing && (stage === 'share' || stage === 'tablet')) phaseTimer = setInterval(phaseTick, 50);
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
      const event = Math.floor((elapsed + .001) / 1.6);
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
      generationCursor += 10;
      noteViewer.show(note.slice(0, generationCursor), { generating: true });
      if (generationCursor >= note.length) completeNote();
    }

    function completeNote() {
      clearInterval(noteTimer);
      generating = false;
      noteViewer.show(note);
      lockDemoEditing();
      $('copyBtn').disabled = false;
      $('exportRow').hidden = false;
      $('pdfBtn').disabled = false;
      $('donePill').textContent = '노트 완성';
      announcement.textContent = '예시 노트가 완성되었습니다. 일시정지하면 내용을 읽거나 복사할 수 있습니다.';
      if (reducedMotion.matches) return staticTabletSequence();
      queueLoop();
    }

    // ── 노트 완성 → PDF 출력 → AirDrop → 태블릿 필기 시연 ──
    function phaseTick() {
      phaseElapsed += .05;
      if (stage === 'share') shareTick();
      else tabletTick();
    }

    function startShare() {
      clearTimeout(loopTimer);
      loopTimer = undefined;
      stage = 'share';
      phaseElapsed = 0;
      $('pdfBtn').classList.add('is-pressed');
      mock.querySelector('#lectureCaption').textContent = '노트를 PDF로 저장해 iPad로 보냅니다.';
      announcement.textContent = '노트를 PDF로 저장해 태블릿으로 보내는 예시입니다.';
      shareTick();
      updatePlayback();
    }

    function shareTick() {
      const t = phaseElapsed;
      const sheet = mock.querySelector('.share-sheet');
      if (t >= .45 && mock.dataset.state !== 'share') {
        $('pdfBtn').classList.remove('is-pressed');
        mock.dataset.state = 'share';
      }
      if (t >= .7) sheet.querySelector('.share-airdrop').classList.add('is-selected');
      const progress = clamp((t - .85) / 1.2, 0, 1);
      sheet.querySelector('.ring-fg').style.strokeDashoffset = String(1 - progress);
      if (t >= 2.3) {
        sheet.classList.add('is-sent');
        sheet.querySelector('.share-status').textContent = '보냄';
      } else {
        sheet.querySelector('.share-status').textContent = progress > 0 ? '전송 중…' : '대기 중';
      }
      if (t >= SHARE_SECONDS) {
        clearInterval(phaseTimer);
        phaseTimer = undefined;
        startTablet();
      }
    }

    function startTablet() {
      stage = 'tablet';
      phaseElapsed = 0;
      mock.dataset.state = 'tablet';
      measureTablet();
      announcement.textContent = '노트앱에서 핵심 문장을 표시하는 예시입니다.';
      tabletTick();
      updatePlayback();
    }

    // hl-target은 한 줄로 고정해 두었으므로 offset 좌표로 형광펜·밑줄·펜 위치를 계산한다.
    function measureTablet() {
      const target = mock.querySelector('.hl-target');
      if (!target) return;
      const x = target.offsetLeft - 3;
      const y = target.offsetTop - 1;
      const w = target.offsetWidth + 6;
      const h = target.offsetHeight + 2;
      hlGeom = { x, y, w, h };
      const hl = mock.querySelector('.tablet-ink .hl');
      hl.setAttribute('x', x);
      hl.setAttribute('y', y);
      hl.setAttribute('height', h);
      hl.setAttribute('width', '0');
      const uy = y + h + 2;
      mock.querySelector('.tablet-ink .ul').setAttribute('d',
        `M ${x} ${uy} Q ${x + w * .28} ${uy + 3.5} ${x + w * .55} ${uy + 1} T ${x + w} ${uy + 2}`);
    }

    function paintTablet(sweep, underline) {
      if (!hlGeom) return;
      const { x, y, w, h } = hlGeom;
      const hl = mock.querySelector('.tablet-ink .hl');
      const ul = mock.querySelector('.tablet-ink .ul');
      const pen = mock.querySelector('.tablet-pen');
      hl.setAttribute('width', String(w * sweep));
      ul.style.strokeDashoffset = String(1 - underline);
      mock.querySelectorAll('.gn-tool[data-tool]').forEach((el) => {
        el.classList.toggle('is-active', el.dataset.tool === (underline > 0 ? 'pen' : 'marker'));
      });
      if (sweep > 0 && sweep < 1) {
        pen.setAttribute('transform', `translate(${x + w * sweep} ${y + h - 1}) rotate(-25) scale(.8)`);
        pen.style.opacity = '1';
      } else if (underline > 0 && underline < 1) {
        const tip = ul.getPointAtLength(underline * ul.getTotalLength());
        pen.setAttribute('transform', `translate(${tip.x} ${tip.y}) rotate(-25) scale(.8)`);
        pen.style.opacity = '1';
      } else {
        pen.style.opacity = '0';
      }
    }

    function tabletTick() {
      paintTablet(clamp((phaseElapsed - .7) / 2.2, 0, 1), clamp((phaseElapsed - 3.1) / 1, 0, 1));
      if (phaseElapsed >= TABLET_SECONDS) {
        clearInterval(phaseTimer);
        phaseTimer = undefined;
        startCapture();
      }
    }

    // reduced-motion에서는 연출 없이 각 장면의 완료 상태를 잠시 보여 준다.
    function staticTabletSequence() {
      const sheet = mock.querySelector('.share-sheet');
      setTimeout(() => {
        sheet.querySelector('.share-airdrop').classList.add('is-selected');
        sheet.querySelector('.ring-fg').style.strokeDashoffset = '0';
        sheet.classList.add('is-sent');
        sheet.querySelector('.share-status').textContent = '보냄';
        mock.dataset.state = 'share';
      }, 1400);
      setTimeout(() => {
        measureTablet();
        paintTablet(1, 1);
        mock.dataset.state = 'tablet';
      }, 3200);
    }

    function resetOverlays() {
      const sheet = mock.querySelector('.share-sheet');
      sheet.classList.remove('is-sent');
      sheet.querySelector('.share-airdrop').classList.remove('is-selected');
      sheet.querySelector('.ring-fg').style.strokeDashoffset = '1';
      sheet.querySelector('.share-status').textContent = '대기 중';
      $('exportRow').hidden = true;
      $('pdfBtn').disabled = true;
      $('pdfBtn').classList.remove('is-pressed');
      paintTablet(0, 0);
      const pen = mock.querySelector('.tablet-pen');
      if (pen) pen.style.opacity = '0';
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
      panel.querySelector('.result-help').textContent = 'AI가 작성한 예시 초안입니다. 자동 재생을 멈추고 읽거나 복사할 수 있습니다.';
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
      resetOverlays();
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
      userPaused = true;
      updatePlayback();
      try {
        await navigator.clipboard.writeText($('result').value);
        $('copyBtn').textContent = '복사됨 ✓';
        setTimeout(() => { $('copyBtn').textContent = '복사'; }, 1500);
      } catch {
        $('result').readOnly = true;
        noteViewer.edit(true, true);
        $('result').select();
        $('copyBtn').textContent = '직접 복사';
        panel.querySelector('.result-help').textContent = '자동 재생을 멈췄습니다. 선택된 노트를 길게 눌러 복사해 주세요.';
        announcement.textContent = '선택된 노트를 길게 눌러 복사해 주세요.';
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
    window.addEventListener('pageshow', () => { updateTilt(); updatePlayback(); });
    window.addEventListener('pagehide', () => { clearInterval(captureTimer); clearInterval(noteTimer); clearInterval(phaseTimer); clearTimeout(loopTimer); cancelAnimationFrame(inkFrame); });
    updateTilt();
    startCapture();
  }

  frame.addEventListener('load', mount);
  mount();
})();
