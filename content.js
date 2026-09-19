// Metadata/preflight only. No frames, audio, credentials or lecture text cross this boundary.
(() => {
  // Pure: find the largest visible video in this document, including shadow roots.
  const findVideo = () => {
    let list = [...document.querySelectorAll("video")];
    if (!list.length) {
      const walk = (node, d) => {
        if (d > 6) return;
        for (const el of node.children || []) {
          if (el.shadowRoot) { list.push(...el.shadowRoot.querySelectorAll("video")); walk(el.shadowRoot, d + 1); }
          walk(el, d + 1);
        }
      };
      walk(document.documentElement, 0);
    }
    return list.filter(v => v.videoWidth && v.getBoundingClientRect().width > 0)
      .sort((a, b) => b.videoWidth * b.videoHeight - a.videoWidth * a.videoHeight)[0];
  };
  // Announces run before the inject guard so a stale instance still reports after a service-worker restart.
  const announce = () => {
    try {
      const v = findVideo(), r = v?.getBoundingClientRect();
      chrome.runtime.sendMessage({ target: "background", type: "FRAME_READY", url: location.href,
        hasVideo: !!v, blocked: !!(v && v.mediaKeys), area: v ? v.videoWidth * v.videoHeight : 0,
        meta: v ? { time: v.currentTime, rate: v.playbackRate, paused: v.paused, ended: v.ended, epoch: 0,
          box: { x: r.x / innerWidth, y: r.y / innerHeight, w: r.width / innerWidth, h: r.height / innerHeight },
          videoAspect: v.videoWidth / v.videoHeight } : null }).catch(() => {});
    } catch {}
  };
  announce();
  if (window.__summrizeiMetadata) return;
  window.__summrizeiMetadata = true;
  const isTop = window === window.top;
  let timer, boxTimer, watchdog, video, epoch = 0, sessionId, failures = 0, blocked = false, watchedEl, ackBound = false;
  const onSeek = () => { epoch++; };
  const onEncrypted = () => { blocked = true; };
  function locate() {
    const found = findVideo();
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
    return { time: v.currentTime, rate: v.playbackRate, paused: v.paused, ended: v.ended, epoch,
      blocked: blocked || !!v.mediaKeys,
      box: { x: r.x / innerWidth, y: r.y / innerHeight, w: r.width / innerWidth, h: r.height / innerHeight },
      videoAspect: v.videoWidth / v.videoHeight };
  }
  // Late-mounting players: re-announce when video presence changes for a few seconds.
  let lastHas = !!findVideo();
  watchdog = setInterval(() => {
    if (sessionId) return clearInterval(watchdog);
    const has = !!findVideo();
    if (has !== lastHas) { lastHas = has; announce(); }
  }, 500);
  setTimeout(() => clearInterval(watchdog), 6000);
  // The watched frame answers parent probes so the top frame can identify its <iframe> element.
  addEventListener("message", e => {
    if (e.data?.srz === "probe" && sessionId && e.data.sessionId === sessionId) e.source?.postMessage({ srz: "probe-ack", sessionId }, "*");
  });
  function bindAck() {
    if (ackBound) return; ackBound = true;
    addEventListener("message", e => {
      if (e.data?.srz === "probe-ack" && e.data.sessionId === sessionId)
        for (const f of document.querySelectorAll("iframe")) if (f.contentWindow === e.source) { watchedEl = f; break; }
    });
  }
  // Top frame role: locate the watched frame's <iframe> and report its viewport rect.
  function frameWatch(id) {
    clearInterval(boxTimer); sessionId = id; watchedEl = null; bindAck();
    boxTimer = setInterval(() => {
      if (!watchedEl?.isConnected) {
        watchedEl = null;
        for (const f of document.querySelectorAll("iframe")) try { f.contentWindow.postMessage({ srz: "probe", sessionId }, "*"); } catch {}
        return;
      }
      const r = watchedEl.getBoundingClientRect();
      chrome.runtime.sendMessage({ target: "session", type: "FRAME_BOX", sessionId,
        box: { x: r.x / innerWidth, y: r.y / innerHeight, w: r.width / innerWidth, h: r.height / innerHeight } }).catch(() => {});
    }, 250);
  }
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (sender.id !== chrome.runtime.id) return;
    if (message.type === "PREFLIGHT") {
      try {
        const v = locate();
        if (!v) throw new Error("이 페이지의 영상을 찾지 못했습니다.");
        if (blocked || v.mediaKeys) throw new Error("보호된 강의는 캡처하지 않습니다.");
        reply({ ok: true, metadata: metadata() });
      } catch (error) { reply({ ok: false, error: error.message }); }
    }
    if (message.type === "PREVIEW") {
      try {
        const v = locate();
        if (!v) throw new Error("영상을 찾지 못했습니다.");
        const c = document.createElement("canvas");
        c.width = v.videoWidth; c.height = v.videoHeight;
        c.getContext("2d").drawImage(v, 0, 0);
        reply({ ok: true, dataUrl: c.toDataURL("image/jpeg", .8) });
      } catch (error) { reply({ ok: false, error: error.message }); }
    }
    if (message.type === "WATCH_MEDIA") {
      clearInterval(timer); sessionId = message.sessionId; failures = 0;
      timer = setInterval(() => {
        chrome.runtime.sendMessage({ target: "session", type: "MEDIA_METADATA", sessionId, metadata: metadata() }).then(r => {
          if (!r?.ok && ++failures > 3) clearInterval(timer);
        }).catch(() => { if (++failures > 3) clearInterval(timer); });
      }, 250);
      reply({ ok: true });
    }
    if (message.type === "FRAME_WATCH") { if (isTop) frameWatch(message.sessionId); reply({ ok: true }); }
    if (message.type === "STOP_WATCH") { clearInterval(timer); clearInterval(boxTimer); sessionId = undefined; watchedEl = null; reply({ ok: true }); }
  });
  addEventListener("pagehide", () => { clearInterval(timer); clearInterval(boxTimer); clearInterval(watchdog); }, { once: true });
})();
