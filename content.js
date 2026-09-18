// Metadata/preflight only. No frames, audio, credentials or lecture text cross this boundary.
// The one page mutation is preservesPitch, and only when the user turns on 배속 인식 보정: Chrome's pitch-preserving
// time stretch cannot be undone by resampling, so it is switched off for the capture and restored when it ends.
(() => {
  if (window.__summrizeiMetadata) return;
  window.__summrizeiMetadata = true;
  let timer, video, epoch = 0, sessionId, failures = 0, blocked = false;
  let pitchWas = null;
  const onSeek = () => { epoch++; };
  const onEncrypted = () => { blocked = true; };
  function locate() {
    const videos = [...document.querySelectorAll("video")].filter(v => v.videoWidth && v.getBoundingClientRect().width > 0);
    if (!videos.length) return null;
    const playing = videos.find(v => !v.paused && v.currentTime > 0 && !v.ended);
    const found = playing || videos.sort((a, b) => b.videoWidth * b.videoHeight - a.videoWidth * a.videoHeight)[0];
    if (found !== video) {
      video?.removeEventListener("seeking", onSeek); video?.removeEventListener("encrypted", onEncrypted);
      video = found; epoch++;
      video?.addEventListener("seeking", onSeek); video?.addEventListener("encrypted", onEncrypted);
    }
    return video;
  }
  function metadata() {
    const v = locate();
    if (!v) return { ended: true, epoch };
    const r = v.getBoundingClientRect();
    const x = r.x / innerWidth, y = r.y / innerHeight;
    const w = r.width / innerWidth, h = r.height / innerHeight;
    return { time: v.currentTime, rate: v.playbackRate, paused: v.paused, ended: v.ended, epoch,
      blocked: blocked || !!v.mediaKeys,
      box: { x, y, w, h },
      videoAspect: v.videoWidth / v.videoHeight };
  }
  function preview() {
    const v = locate();
    if (!v || !v.videoWidth) throw new Error("영상을 찾지 못했거나 아직 재생되지 않았습니다. 영상을 먼저 재생해 주세요.");
    if (blocked || v.mediaKeys) throw new Error("보호된 강의는 미리보기를 지원하지 않습니다.");
    const scale = Math.min(1, 640 / v.videoWidth);
    const w = Math.round(v.videoWidth * scale), h = Math.round(v.videoHeight * scale);
    const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    try {
      ctx.drawImage(v, 0, 0, w, h);
      return canvas.toDataURL("image/jpeg", 0.65);
    } catch (e) {
      if (e.name === "SecurityError") throw new Error("보안 정책으로 영상 미리보기가 차단되었습니다.");
      throw e;
    }
  }
  function preflight() {
    const v = locate();
    if (!v) throw new Error("이 페이지의 영상을 찾지 못했습니다. iframe 전용 플레이어는 현재 지원하지 않습니다.");
    if (blocked || v.mediaKeys) throw new Error("보호된 강의는 캡처하지 않습니다.");
    const canvas = document.createElement("canvas"); canvas.width = 32; canvas.height = 18;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    try {
      ctx.drawImage(v, 0, 0, 32, 18);
      const pixels = ctx.getImageData(0, 0, 32, 18).data;
      let bright = 0;
      for (let i = 0; i < pixels.length; i += 4) bright += pixels[i] + pixels[i + 1] + pixels[i + 2];
      if (bright / (32 * 18 * 3) < 2) throw new Error("검은 화면입니다. 보호 여부를 확인할 수 없어 중단했습니다.");
    } catch (error) {
      if (error.name === "SecurityError") throw new Error("영상의 캡처가 차단돼 있습니다. 다른 캡처 경로로 우회하지 않습니다.");
      throw error;
    }
    return metadata();
  }
  function setPitchPreservation(on) {
    const v = locate();
    if (!v) return;
    const key = "preservesPitch" in v ? "preservesPitch" : "webkitPreservesPitch" in v ? "webkitPreservesPitch" : null;
    if (!key) return;
    if (!on) { if (pitchWas === null) pitchWas = v[key]; v[key] = false; }
    else if (pitchWas !== null) { v[key] = pitchWas; pitchWas = null; }
  }
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (sender.id !== chrome.runtime.id) return;
    if (message.type === "PREFLIGHT") {
      try { reply({ ok: true, metadata: preflight() }); } catch (error) { reply({ ok: false, error: error.message }); }
    }
    if (message.type === "PREVIEW") {
      try { reply({ ok: true, dataUrl: preview() }); } catch (error) { reply({ ok: false, error: error.message }); }
    }
    if (message.type === "WATCH_MEDIA") {
      clearInterval(timer); sessionId = message.sessionId; failures = 0;
      if (message.speedCorrection === true) setPitchPreservation(false);
      timer = setInterval(() => {
        chrome.runtime.sendMessage({ target: "session", type: "MEDIA_METADATA", sessionId, metadata: metadata() }).then(r => {
          if (!r?.ok && ++failures > 3) clearInterval(timer);
        }).catch(() => { if (++failures > 3) clearInterval(timer); });
      }, 250);
      reply({ ok: true });
    }
    if (message.type === "STOP_WATCH") { clearInterval(timer); setPitchPreservation(true); reply({ ok: true }); }
  });
  addEventListener("pagehide", () => { clearInterval(timer); setPitchPreservation(true); }, { once: true });
})();
