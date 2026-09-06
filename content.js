// 강의 영상 페이지에 executeScript로 주입된다(선언적 content_scripts 없음 = 사이트 중립).
// <video> 프레임을 변화가 있을 때만 캡처해 OCR용 배치로 보내고, 타임스탬프를 함께 기록한다.
(() => {
  if (window.__lectureNotesLoaded) return; // allFrames 주입 + 재실행 대비 가드
  window.__lectureNotesLoaded = true;

  // ponytail: 실제 영상마다 다른 튜닝값. 프레임을 너무 많이/적게 잡으면 여기를 조정.
  const MODES = {
    slide: {
      interval: 5000, // 슬라이드는 1~2분마다 바뀌므로 자주 볼 필요가 없다
      diffThreshold: 20, // 강사 얼굴·마우스 움직임에 반응하지 않을 만큼 둔감하게
      batchSize: 8, // 전체 프레임은 이미지가 커서 배치를 작게
      maxWidth: 1024, // 원본 1920 그대로 보내면 이미지당 토큰이 2배 가까이 든다
      sample: [48, 27],
    },
    caption: {
      interval: 2000,
      diffThreshold: 12,
      batchSize: 15,
      maxWidth: 0, // 자막은 원본 해상도 유지 (축소하면 작은 글자가 뭉갠다)
      cropRatio: 0.2, // 화면 하단 20%
      sample: [48, 12],
    },
  };
  const DEBUG = true;

  let capturing = false;
  let transcript = [];
  let batch = [];
  let lastDiffSample = null;

  function reportProgress(stage, detail) {
    chrome.runtime.sendMessage({ type: "CAPTURE_PROGRESS", stage, detail }).catch(() => {});
  }

  // 사이트에 따라 페이지 콘솔(F12)이 막혀 있어 디버그 로그를 사이드패널로도 보낸다.
  function debugLog(...args) {
    if (!DEBUG) return;
    console.log("[강의 필기]", ...args);
    const text = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
    chrome.runtime.sendMessage({ type: "DEBUG_LOG", text }).catch(() => {});
  }

  function getRegion(video, cfg) {
    const h = video.videoHeight;
    const cropH = cfg.cropRatio ? Math.round(h * cfg.cropRatio) : h;
    return { y: h - cropH, h: cropH };
  }

  function drawRegion(video, region, destW, destH) {
    const c = document.createElement("canvas");
    c.width = destW;
    c.height = destH;
    c.getContext("2d").drawImage(video, 0, region.y, video.videoWidth, region.h, 0, 0, destW, destH);
    return c;
  }

  // 저해상도 그레이스케일 썸네일로 직전 프레임과의 변화량을 저렴하게 측정
  function sampleForDiff(video, region, cfg) {
    const [w, h] = cfg.sample;
    const { data } = drawRegion(video, region, w, h).getContext("2d").getImageData(0, 0, w, h);
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

  function captureFrame(video, region, cfg) {
    const scale = cfg.maxWidth && video.videoWidth > cfg.maxWidth ? cfg.maxWidth / video.videoWidth : 1;
    const destW = Math.round(video.videoWidth * scale);
    const destH = Math.round(region.h * scale);
    return drawRegion(video, region, destW, destH).toDataURL("image/jpeg", 0.7);
  }

  // 사이트별 캡처 가능 여부를 미리 판정한다. 이게 없으면 사이트마다 원인 불명으로 죽는다.
  function preflight(video, region, cfg) {
    let canvas;
    try {
      canvas = drawRegion(video, region, ...cfg.sample);
      canvas.toDataURL("image/jpeg", 0.5);
    } catch (e) {
      return `이 사이트는 CORS 정책으로 영상 프레임 캡처가 차단됩니다 (${e.name}). 이 확장으로는 캡처할 수 없습니다.`;
    }
    const [w, h] = cfg.sample;
    const { data } = canvas.getContext("2d").getImageData(0, 0, w, h);
    let max = 0;
    for (let i = 0; i < data.length; i += 4) max = Math.max(max, data[i], data[i + 1], data[i + 2]);
    if (max < 8) {
      return "캡처된 화면이 완전히 검습니다. DRM 보호 영상이거나 아직 재생 전일 수 있습니다.";
    }
    return null;
  }

  async function flushBatch() {
    if (batch.length === 0) return;
    const entries = batch;
    batch = [];
    reportProgress("ocr", `${entries.length}장 OCR 요청 중`);
    try {
      const res = await chrome.runtime.sendMessage({
        type: "OCR_BATCH_REQUEST",
        frames: entries.map((e) => e.frame),
        times: entries.map((e) => e.time),
      });
      debugLog("OCR 응답:", res);
      if (res && res.lines) {
        transcript = mergeLines(zipEntries(res.lines, entries.map((e) => e.time)), transcript);
        // 배치마다 저장한다. 영상을 끝까지 안 봐도, 창을 닫아도 OCR한 분량은 남는다
        // (OCR이 전체 비용의 대부분이라 날리면 손해가 크다).
        chrome.storage.local.set({ lastTranscript: transcript, lastTitle: document.title });
        chrome.runtime.sendMessage({ type: "TRANSCRIPT_SAVED", lines: transcript.length }).catch(() => {});
      } else if (res && res.error) {
        reportProgress("error", res.error);
      }
    } catch (e) {
      reportProgress("error", String(e));
    }
  }

  async function captureLoop(video, region, cfg) {
    if (!capturing) return;
    if (!video.paused && !video.ended) {
      const sample = sampleForDiff(video, region, cfg);
      if (diffScore(sample, lastDiffSample) > cfg.diffThreshold) {
        lastDiffSample = sample;
        batch.push({ frame: captureFrame(video, region, cfg), time: video.currentTime });
        reportProgress("capture", `프레임 ${batch.length}장 대기 중 (스크립트 ${transcript.length}줄 확보)`);
        if (batch.length >= cfg.batchSize) await flushBatch();
      }
    }
    if (video.ended) {
      await flushBatch();
      capturing = false;
      reportProgress("done", "캡처 완료");
      chrome.runtime.sendMessage({ type: "CAPTURE_DONE", transcript, title: document.title }).catch(() => {});
      return;
    }
    // 배속 재생 시 화면이 머무는 실제 시간이 짧아지므로 간격도 비례해서 줄인다.
    setTimeout(() => captureLoop(video, region, cfg), cfg.interval / (video.playbackRate || 1));
  }

  function startCapture(mode) {
    const video = document.querySelector("video");
    if (!video) return; // 이 프레임엔 영상이 없다 — 다른 프레임이 처리한다
    const cfg = MODES[mode] || MODES.slide;
    if (video.videoWidth === 0) {
      reportProgress("error", "영상이 아직 로드되지 않았습니다. 재생한 뒤 다시 시도하세요.");
      return;
    }
    const region = getRegion(video, cfg);
    const problem = preflight(video, region, cfg);
    if (problem) {
      reportProgress("error", problem);
      return;
    }
    capturing = true;
    transcript = [];
    batch = [];
    lastDiffSample = null;
    debugLog("캡처 시작", { mode, videoWidth: video.videoWidth, videoHeight: video.videoHeight, region });
    reportProgress("capture", "캡처 시작");
    captureLoop(video, region, cfg);
  }

  chrome.runtime.onMessage.addListener((msg) => {
    // 응답하지 않는다 — allFrames 주입이라 영상 없는 프레임까지 응답하면 어느 쪽이 이길지 알 수 없다.
    // 사이드패널은 CAPTURE_PROGRESS가 오는지로 성공을 판단한다.
    if (msg.type === "START_CAPTURE") startCapture(msg.mode);
  });
})();
