// 영상 페이지에 executeScript로 주입된다(선언적 content_scripts 없음 = 사이트 중립).
//
// 이 스크립트는 아무것도 저장하지 않고 아무데도 전송하지 않는다. 프레임은 메모리에만 있다가
// 사이드패널 포트로 넘어가고, 포트가 끊기면(=패널이 닫히면) 캡처가 즉시 멈춘다.
(() => {
  if (window.__lectureNotesLoaded) return; // allFrames 주입 + 재실행 대비 가드
  window.__lectureNotesLoaded = true;

  // ponytail: 영상마다 다른 튜닝값. 프레임을 너무 많이/적게 잡으면 여기를 조정.
  const MODES = {
    slide: { interval: 5000, diffThreshold: 20, batchSize: 8, maxWidth: 1024, sample: [48, 27] },
    caption: { interval: 2000, diffThreshold: 12, batchSize: 15, maxWidth: 0, rect: { x: 0, y: 0.8, w: 1, h: 0.2 }, sample: [48, 12] },
    region: { interval: 5000, diffThreshold: 20, batchSize: 8, maxWidth: 1024, sample: [48, 27] },
  };

  let capturing = false;
  let batch = [];
  let audioCtx = null;
  let audioProc = null;
  let ocrEngine = "local"; // 사이드패널이 START로 알려준다 — 엔진마다 원하는 입력 크기가 다르다
  let lastDiffSample = null;
  let port = null;

  const send = (msg) => port && port.postMessage(msg);
  const report = (stage, detail) => send({ type: "progress", stage, detail });
  const debugLog = (...args) =>
    send({ type: "log", text: args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ") });

  const getVideo = () => document.querySelector("video");

  // rect는 0~1 정규화 좌표. 지정이 없으면 전체 화면.
  function pixelRect(video, rect) {
    const r = rect || { x: 0, y: 0, w: 1, h: 1 };
    return {
      x: Math.round(video.videoWidth * r.x),
      y: Math.round(video.videoHeight * r.y),
      w: Math.max(1, Math.round(video.videoWidth * r.w)),
      h: Math.max(1, Math.round(video.videoHeight * r.h)),
    };
  }

  function drawRect(video, px, destW, destH) {
    const c = document.createElement("canvas");
    c.width = destW;
    c.height = destH;
    const ctx = c.getContext("2d");
    // 확대할 때 획이 계단지면 OCR이 바로 나빠진다.
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(video, px.x, px.y, px.w, px.h, 0, 0, destW, destH);
    return c;
  }

  // 저해상도 그레이스케일 썸네일로 직전 프레임과의 변화량을 저렴하게 측정
  function sampleForDiff(video, px, cfg) {
    const [w, h] = cfg.sample;
    const { data } = drawRect(video, px, w, h).getContext("2d").getImageData(0, 0, w, h);
    const gray = new Uint8Array(w * h);
    for (let i = 0; i < gray.length; i++) {
      const o = i * 4;
      gray[i] = (data[o] + data[o + 1] + data[o + 2]) / 3;
    }
    return gray;
  }

  function diffScore(a, b) {
    if (!a || !b) return Infinity;
    let sum = 0;
    for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
    return sum / a.length;
  }

  // Tesseract는 글자 획이 뭉개지면 급격히 나빠진다. Nano처럼 1024로 줄이면 저해상도
  // 강의에서 읽을 게 남지 않는다. 그래서 줄이지 않고, 오히려 작으면 키워서 넘긴다.
  // Tesseract는 대략 글자 높이 20px 이상을 원하는데, 720p 영상의 슬라이드 본문은
  // 그에 한참 못 미친다. 확대해도 정보가 늘지는 않지만 획 경계가 살아나서 실제로 는다.
  // JPEG 품질도 올린다 — 0.7은 텍스트 가장자리에 링잉을 남긴다.
  const TESS_MIN_WIDTH = 1600;
  const TESS_MAX_WIDTH = 2560; // 무한정 키우면 큐·포트 부담만 커진다
  function captureFrame(video, px, cfg) {
    let destW = px.w;
    let quality = 0.7;
    if (ocrEngine === "tesseract") {
      destW = Math.min(TESS_MAX_WIDTH, Math.max(px.w, TESS_MIN_WIDTH));
      quality = 0.92;
    } else if (cfg.maxWidth && px.w > cfg.maxWidth) {
      destW = cfg.maxWidth; // Nano는 큰 이미지를 싫어한다 (컨텍스트·크래시)
    }
    const scale = destW / px.w;
    return drawRect(video, px, Math.round(px.w * scale), Math.round(px.h * scale)).toDataURL("image/jpeg", quality);
  }

  // ── 오디오 ────────────────────────────────────────────────────────────────
  // tabCapture는 쓰지 않는다. tabCapture는 activeTab 부여(= 그 탭에서 확장 아이콘 클릭)를
  // 요구하는데, 강의 뷰어처럼 툴바 없는 창에서 열리는 페이지에서는 아이콘을 누를 방법이 없다.
  // 대신 여기, 이미 영상에 접근하고 있는 컨텍스트에서 <video>의 오디오를 직접 딴다.
  // 추가 권한이 하나도 필요 없고, 창이 몇 개든 어떤 탭이든 똑같이 동작한다.
  const AUDIO_HZ = 16000;
  const CHUNK = AUDIO_HZ * 5; // Whisper에 넘길 5초 단위

  // 무음 청크는 Whisper에 넣지 않는다. 넣으면 빈 결과가 아니라 환각이 나온다
  // ("감사합니다", "시청해주셔서 감사합니다" 같은 정형구) — 학습 데이터의 자막 상투구다.
  // 관측된 말소리 RMS는 0.014 근처. 임계값은 그보다 한참 아래여야 조용한 발화를 안 버린다.
  const SILENCE_RMS = 0.002; // 약 -54 dBFS
  // RMS만 보면 5초 중 4초가 무음이고 한 단어만 있는 청크가 잘려나간다.
  // 순간 최대값이 함께 낮을 때만 무음으로 판정한다.
  const SILENCE_PEAK = 0.02;

  // 배속 재생 보정.
  // 확장 포트 메시지는 structured clone이 아니라 JSON이다. Float32Array를 그대로 넣으면
  // {"0":0.01,...} 로 부풀어 터진다. int16 PCM + base64가 가장 싼 전송 형식.
  function encodePcm(buf, len) {
    const bytes = new Uint8Array(len * 2);
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < len; i++) {
      const v = Math.max(-1, Math.min(1, buf[i]));
      view.setInt16(i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
    }
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }

  async function startAudio(video) {
    if (audioProc) return; // 이미 붙어 있다
    try {
      // createMediaElementSource는 엘리먼트당 딱 한 번만 된다. 재시작에 대비해 캐시한다.
      if (!video.__lnAudio) {
        const ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: AUDIO_HZ });
        const src = ctx.createMediaElementSource(video);
        src.connect(ctx.destination); // 소리는 계속 스피커로 나가야 한다
        video.__lnAudio = { ctx, src };
      }
      const { ctx, src } = video.__lnAudio;
      audioCtx = ctx;
      // 재생 중인 페이지라 보통 running이지만, suspended면 영상이 무음이 된다.
      if (ctx.state === "suspended") await ctx.resume();

      // AudioWorklet은 페이지 CSP가 확장 URL 모듈 로드를 막을 수 있다.
      // ScriptProcessor는 폐기 예정이지만 로드할 파일이 없어 어디서든 뜬다.
      const proc = ctx.createScriptProcessor(4096, 1, 1);
      let buf = new Float32Array(CHUNK);
      let off = 0;
      let chunkStart = video.currentTime;
      let silentCount = 0;
      let corsWarned = false;

      proc.onaudioprocess = (e) => {
        if (!capturing) return;
        const input = e.inputBuffer.getChannelData(0);
        for (let i = 0; i < input.length; i++) {
          buf[off++] = input[i];
          if (off >= CHUNK) {
            let sum = 0;
            let peak = 0;
            for (let k = 0; k < CHUNK; k++) {
              sum += buf[k] * buf[k];
              const abs = buf[k] < 0 ? -buf[k] : buf[k];
              if (abs > peak) peak = abs;
            }
            const rms = Math.sqrt(sum / CHUNK);

            // CORS 무음 감지: 영상이 재생 중이고 볼륨이 켜져 있는데 3연속 완벽한 무음(0)이면 CORS 보안 차단일 가능성이 높음
            if (rms < 0.00001 && !video.paused && video.volume > 0 && !video.muted) {
              silentCount++;
              if (silentCount >= 3 && !corsWarned) {
                corsWarned = true;
                debugLog("이 영상은 CORS 보안 정책으로 인해 페이지 내 직접 오디오 추출이 무음(0)으로 차단되고 있습니다.");
              }
            } else if (rms >= SILENCE_RMS) {
              silentCount = 0;
            }

            // base64 인코딩 전에 거른다 — 버릴 청크에 그 비용을 쓸 이유가 없다.
            if (rms < SILENCE_RMS && peak < SILENCE_PEAK) {
              send({ type: "silence", t: chunkStart, rms, peak });
            } else {
              const rate = video.playbackRate || 1;
              send({ type: "audio", pcm: encodePcm(buf, CHUNK), t: chunkStart, rms, rate });
            }
            chunkStart = video.currentTime;
            off = 0;
          }
        }
      };
      src.connect(proc);
      proc.connect(ctx.destination); // 연결돼 있어야 onaudioprocess가 돈다 (출력은 무음)
      audioProc = proc;
      debugLog("오디오 캡처 시작", {
        state: ctx.state,
        sampleRate: ctx.sampleRate,
      });
    } catch (e) {
      report("error", `영상 오디오에 연결하지 못했습니다: ${e.name} ${e.message}`);
    }
  }

  function stopAudio() {
    if (audioProc) {
      audioProc.onaudioprocess = null;
      audioProc.disconnect();
      audioProc = null;
    }
    audioCtx = null; // ctx/src는 엘리먼트에 캐시된 채 남긴다 (재연결용)
  }

  // 사이트별 캡처 가능 여부를 미리 판정한다. 이게 없으면 사이트마다 원인 불명으로 죽는다.
  // DRM 영상에서는 캡처를 시도하지 않고 중단한다 — 기술적 보호조치를 우회하지 않는다는 정책.
  function preflight(video, px, cfg) {
    let canvas;
    try {
      canvas = drawRect(video, px, ...cfg.sample);
      canvas.toDataURL("image/jpeg", 0.5);
    } catch (e) {
      return `이 사이트는 CORS 정책으로 영상 프레임 캡처가 차단됩니다 (${e.name}).`;
    }
    const [w, h] = cfg.sample;
    const { data } = canvas.getContext("2d").getImageData(0, 0, w, h);
    let max = 0;
    for (let i = 0; i < data.length; i += 4) max = Math.max(max, data[i], data[i + 1], data[i + 2]);
    if (max < 8) {
      return "캡처된 화면이 완전히 검습니다. DRM으로 보호된 영상이거나 아직 재생 전일 수 있습니다. DRM 영상은 이 확장으로 처리하지 않습니다.";
    }
    return null;
  }

  // 프레임은 포트로 넘기는 즉시 참조를 끊는다 (GC 대상이 되게).
  function flushBatch() {
    if (batch.length === 0) return;
    const frames = batch.map((e) => e.frame);
    const times = batch.map((e) => e.time);
    batch = [];
    send({ type: "frames", frames, times });
  }

  function captureLoop(video, px, cfg) {
    if (!capturing) return;
    if (!video.paused && !video.ended) {
      const sample = sampleForDiff(video, px, cfg);
      if (diffScore(sample, lastDiffSample) > cfg.diffThreshold) {
        lastDiffSample = sample;
        batch.push({ frame: captureFrame(video, px, cfg), time: video.currentTime });
        report("capture", `프레임 ${batch.length}장 대기 중`);
        if (batch.length >= cfg.batchSize) flushBatch();
      }
    }
    // 음성 인식 쪽이 벽시계 대신 영상 시각으로 타임스탬프를 찍게 한다.
    // 배속·탐색 때 벽시계는 영상 시각과 어긋난다(2배속이면 2배로 벌어진다).
    send({ type: "tick", t: video.currentTime });
    if (video.ended) {
      flushBatch();
      capturing = false;
      stopAudio();
      send({ type: "done", title: document.title });
      return;
    }
    // 배속 재생 시 화면이 머무는 실제 시간이 짧아지므로 간격도 비례해서 줄인다.
    setTimeout(() => captureLoop(video, px, cfg), cfg.interval / (video.playbackRate || 1));
  }

  function startCapture(mode, rect, wantAudio) {
    const video = getVideo();
    if (!video) return; // 이 프레임엔 영상이 없다 — 다른 프레임이 처리한다
    const cfg = MODES[mode] || MODES.slide;
    if (video.videoWidth === 0) {
      return report("error", "영상이 아직 로드되지 않았습니다. 재생한 뒤 다시 시도하세요.");
    }
    const px = pixelRect(video, rect || cfg.rect);
    const problem = preflight(video, px, cfg);
    if (problem) return report("error", problem);

    capturing = true;
    batch = [];
    lastDiffSample = null;
    debugLog("캡처 시작", { mode, ocrEngine, videoWidth: video.videoWidth, videoHeight: video.videoHeight, px });
    report("capture", "캡처 시작");
    if (wantAudio) startAudio(video);
    captureLoop(video, px, cfg);
  }

  // 영역 지정용 미리보기 한 장. 저장되지 않고 사이드패널 메모리로만 간다.
  function sendPreview() {
    const video = getVideo();
    if (!video || video.videoWidth === 0) return;
    const px = pixelRect(video, null);
    if (preflight(video, px, MODES.slide)) return;
    const scale = Math.min(1, 640 / px.w);
    send({
      type: "preview",
      dataUrl: drawRect(video, px, Math.round(px.w * scale), Math.round(px.h * scale)).toDataURL("image/jpeg", 0.6),
    });
  }

  chrome.runtime.onConnect.addListener((p) => {
    if (p.name !== "capture") return;
    port = p;
    p.onMessage.addListener((msg) => {
      if (msg.type === "START") {
        ocrEngine = msg.ocr || "local";
        startCapture(msg.mode, msg.rect, msg.audio);
      }
      if (msg.type === "STOP") { capturing = false; stopAudio(); }
      if (msg.type === "PREVIEW") sendPreview();
    });
    // 사이드패널이 닫히면 포트가 끊긴다 → 캡처를 즉시 멈춘다.
    // "패널이 열려 있는 동안만 동작한다"는 무저장 설계의 수명 보장.
    p.onDisconnect.addListener(() => {
      capturing = false;
      stopAudio();
      batch = [];
      lastDiffSample = null;
      port = null;
    });
  });
})();
