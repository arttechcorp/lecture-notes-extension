(() => {
  const FrameBox = {
    compose(outer, inner) {
      return {
        x: outer.x + outer.w * inner.x,
        y: outer.y + outer.h * inner.y,
        w: outer.w * inner.w,
        h: outer.h * inner.h,
      };
    },
    valid(b) {
      return Boolean(
        b &&
        typeof b === "object" &&
        Number.isFinite(b.x) &&
        Number.isFinite(b.y) &&
        Number.isFinite(b.w) &&
        Number.isFinite(b.h) &&
        b.w > 0 &&
        b.h > 0
      );
    },
    inViewport(b, eps = 0.01) {
      if (!FrameBox.valid(b)) return false;
      return b.x >= 0 && b.y >= 0 && (b.x + b.w) <= 1 + eps && (b.y + b.h) <= 1 + eps;
    },
    fitAspect(rect, aspect) {
      if (
        !rect ||
        !Number.isFinite(aspect) ||
        aspect <= 0 ||
        !Number.isFinite(rect.w) ||
        !Number.isFinite(rect.h) ||
        rect.w <= 0 ||
        rect.h <= 0
      ) {
        return { ...rect };
      }
      const rectAspect = rect.w / rect.h;
      if (rectAspect > aspect) {
        const w = rect.h * aspect;
        return { x: rect.x + (rect.w - w) / 2, y: rect.y, w, h: rect.h };
      }
      if (rectAspect < aspect) {
        const h = rect.w / aspect;
        return { x: rect.x, y: rect.y + (rect.h - h) / 2, w: rect.w, h };
      }
      return { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
    },
    meanBrightness(data, pixelCount) {
      if (!data || !pixelCount || pixelCount <= 0) return 0;
      let sum = 0;
      const len = pixelCount * 4;
      for (let i = 0; i < len; i += 4) {
        sum += data[i] + data[i + 1] + data[i + 2];
      }
      return sum / (pixelCount * 3);
    },
    isBlack(data, pixelCount, threshold = 2) {
      return FrameBox.meanBrightness(data, pixelCount) < threshold;
    },
  };

  globalThis.FrameBox = FrameBox;
  if (typeof module !== "undefined") module.exports = { FrameBox, ...FrameBox };
})();
