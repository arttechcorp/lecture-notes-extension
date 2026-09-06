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
    c.getContext("2d").drawImage(video, px.x, px.y, px.w, px.h, 0, 0, destW, destH);
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

  function captureFrame(video, px, cfg) {
    const scale = cfg.maxWidth && px.w > cfg.maxWidth ? cfg.maxWidth / px.w : 1;
    return drawRect(video, px, Math.round(px.w * scale), Math.round(px.h * scale)).toDataURL("image/jpeg", 0.7);
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
    if (video.ended) {
      flushBatch();
      capturing = false;
      send({ type: "done", title: document.title });
      return;
    }
    // 배속 재생 시 화면이 머무는 실제 시간이 짧아지므로 간격도 비례해서 줄인다.
    setTimeout(() => captureLoop(video, px, cfg), cfg.interval / (video.playbackRate || 1));
  }

  function startCapture(mode, rect) {
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
    debugLog("캡처 시작", { mode, videoWidth: video.videoWidth, videoHeight: video.videoHeight, px });
    report("capture", "캡처 시작");
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
      if (msg.type === "START") startCapture(msg.mode, msg.rect);
      if (msg.type === "PREVIEW") sendPreview();
    });
    // 사이드패널이 닫히면 포트가 끊긴다 → 캡처를 즉시 멈춘다.
    // "패널이 열려 있는 동안만 동작한다"는 무저장 설계의 수명 보장.
    p.onDisconnect.addListener(() => {
      capturing = false;
      batch = [];
      lastDiffSample = null;
      port = null;
    });
  });
})();
