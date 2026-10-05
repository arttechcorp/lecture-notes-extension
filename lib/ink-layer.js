// 같은 슬라이드 위에 나중에 더해진 것(판서)만 남긴 이미지. 인쇄 글자는 기준 화면에서 한 번만 OCR하고, 판서는 이 이미지로 따로 OCR한다.
(() => {
  // 임계값은 tools/visual-ink-layer-probe.mjs 의 합성 시퀀스에서 잰 값이다(지속 규칙 적용 시 정밀도 .91 / 재현율 .99).
  // 여기서는 지속 규칙을 쓰지 않는다 — 재캡처는 이미 멎은 프레임이다. 펜 커서는 처리하지 않는다(사용자 결정).
  const DIFF = 50, CELL = 4, MINPX = 2, GAP = 1, MINCELLS = 4;

  // base, current: {data: Uint8ClampedArray(RGBA), width, height}. 크기가 다르거나 의미 있는 변화가 없으면 null.
  function inkOnly(base, current) {
    const { width: W, height: H, data: c } = current, b = base?.data;
    if (!b || base.width !== W || base.height !== H) return null;
    const GW = Math.ceil(W / CELL), GH = Math.ceil(H / CELL), count = new Uint16Array(GW * GH);
    for (let i = 0, k = 0; i < W * H; i++, k += 4) {
      const dr = c[k] - b[k], dg = c[k + 1] - b[k + 1], db = c[k + 2] - b[k + 2];
      if (Math.abs((3 * dr + 6 * dg + db) / 10) > DIFF || Math.abs(dr - dg) > DIFF || Math.abs(db - dg) > DIFF) count[((i / W | 0) / CELL | 0) * GW + (i % W / CELL | 0)]++;
    }
    // 8방향 연결, 칸 하나의 틈은 이어 붙인다. 작은 덩어리(잡음)는 버린다.
    const seen = new Uint8Array(GW * GH), keep = [], R = GAP + 1;
    for (let s = 0; s < seen.length; s++) {
      if (count[s] < MINPX || seen[s]) continue;
      const stack = [s], part = []; seen[s] = 1;
      while (stack.length) {
        const p = stack.pop(), x = p % GW, y = p / GW | 0; part.push(p);
        for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
          const X = x + dx, Y = y + dy, t = Y * GW + X;
          if (X >= 0 && Y >= 0 && X < GW && Y < GH && count[t] >= MINPX && !seen[t]) { seen[t] = 1; stack.push(t); }
        }
      }
      if (part.length >= MINCELLS) for (const p of part) keep.push(p);
    }
    if (!keep.length) return null;
    // 바탕색 = 기준 화면에서 가장 흔한 색(채널당 16단계로 묶고 그 묶음의 평균). 어두운 슬라이드의 밝은 판서도 읽히게 한다.
    const hist = new Uint32Array(4096 * 4);
    for (let k = 0; k < b.length; k += 4) { const h = ((b[k] >> 4) << 8 | (b[k + 1] >> 4) << 4 | b[k + 2] >> 4) * 4; hist[h]++; hist[h + 1] += b[k]; hist[h + 2] += b[k + 1]; hist[h + 3] += b[k + 2]; }
    let top = 0; for (let h = 4; h < hist.length; h += 4) if (hist[h] > hist[top]) top = h;
    const data = new Uint8ClampedArray(c.length), n = hist[top];
    for (let k = 0; k < data.length; k += 4) { data[k] = hist[top + 1] / n; data[k + 1] = hist[top + 2] / n; data[k + 2] = hist[top + 3] / n; data[k + 3] = 255; }
    for (const p of keep) {
      const x0 = p % GW * CELL, w = Math.min(CELL, W - x0) * 4;
      for (let y = (p / GW | 0) * CELL, y1 = Math.min(H, y + CELL); y < y1; y++) { const s = (y * W + x0) * 4; data.set(c.subarray(s, s + w), s); }
    }
    return { data, width: W, height: H, cells: keep.length };
  }

  const InkLayer = { inkOnly };
  if (typeof module !== "undefined") module.exports = { InkLayer, inkOnly };
  globalThis.InkLayer = InkLayer;
})();
