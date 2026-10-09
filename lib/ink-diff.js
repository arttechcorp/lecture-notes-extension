// InkDiff — mis-sol-hai D6(기획 §4.2). 같은 슬라이드의 첫·마지막 표본(같은 크기의 회색조
// Uint8Array)을 비교해 새로 생긴 필기 영역을 bbox 목록으로 돌린다. 커서·웹캠처럼 계속
// 움직이는 곳은 게이트의 live 타일 마스크를 exclude로 넘겨 뺀다. 픽셀 원본은 계산에만 쓰고
// 어디에도 남기지 않는다(AGENTS.md §2).
(() => {
  // 제외 마스크는 visual-gate의 32×18 타일과 같은 격자(256×144 표본에서 8×8=64칸)다.
  const TILE_W = 32, TILE_H = 18, ADJ = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

  // first → last 사이에 달라진 픽셀을 잡아 연결된 덩어리로 묶는다.
  // threshold: 명암 차 게이트 노이즈 한계(visual-gate와 같은 18), minPx: 점·커서 자취 같은
  // 작은 얼룩 컷, pad: 가까운 획을 한 영역으로 묶는 여백(px).
  // 반환 {mask:[{x,y,w,h}], area} — 좌표는 0..1 정규화, area는 제외 타일을 뺀 화면에서 바뀐 픽셀 비율.
  function diff(first, last, { width = 256, height = 144, exclude = null, threshold = 18, minPx = 8, pad = 4 } = {}) {
    const out = { mask: [], area: 0 };
    if (!first || !last || first.length !== last.length || !width || !height) return out;
    const cols = Math.ceil(width / TILE_W), rows = Math.ceil(height / TILE_H);
    const excluded = (x, y) => exclude && exclude[Math.min(rows - 1, (y / TILE_H) | 0) * cols + Math.min(cols - 1, (x / TILE_W) | 0)];
    const flags = new Uint8Array(width * height);
    let px = 0, all = 0;
    for (let i = 0; i < first.length; i++) {
      if (excluded(i % width, (i / width) | 0)) continue;
      all++;
      if (Math.abs(first[i] - last[i]) > threshold) { flags[i] = 1; px++; }
    }
    out.area = all ? px / all : 0;
    const seen = new Uint8Array(width * height), boxes = [];
    for (let i = 0; i < flags.length; i++) {
      if (!flags[i] || seen[i]) continue;
      let x0 = x1 = i % width, y0 = y1 = (i / width) | 0, n = 0;
      for (const st = [i]; st.length;) {
        const c = st.pop(), cx = c % width, cy = (c / width) | 0; n++;
        if (cx < x0) x0 = cx; if (cx > x1) x1 = cx; if (cy < y0) y0 = cy; if (cy > y1) y1 = cy;
        for (const [dx, dy] of ADJ) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const t = ny * width + nx;
          if (flags[t] && !seen[t]) { seen[t] = 1; st.push(t); }
        }
      }
      if (n >= minPx) boxes.push({ x: x0 - pad, y: y0 - pad, w: x1 - x0 + 1 + 2 * pad, h: y1 - y0 + 1 + 2 * pad });
    }
    // 여백 때문에 겹친 상자는 한 덩어리로 합친다(합치면 새 겹침이 생길 수 있어 안정될 때까지 돈다).
    for (let merged = true; merged;) {
      merged = false;
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        if (!overlap(boxes[i], boxes[j])) continue;
        const a = boxes[i], b = boxes[j], x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
        boxes[i] = { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
        boxes.splice(j, 1); merged = true; j--;
      }
    }
    out.mask = boxes.map(b => {
      const x = Math.max(0, b.x), y = Math.max(0, b.y);
      return { x: x / width, y: y / height, w: (Math.min(width, x + b.w) - x) / width, h: (Math.min(height, y + b.h) - y) / height };
    });
    return out;
  }

  // 마스크 영역과 겹치는 인식 블록을 찾는다. 텍스트가 있고 conf가 충분한 블록과 겹치면
  // "읽힌 필기"(그 블록은 ink:true 표시 대상), 아니면 unread — 작성 단계에 영역 이미지를
  // 메모리 근거로 넘기는 대상이다.
  // 반환 {regions:[{x,y,w,h,blockIds,unread}], blockIds:Set(마스크와 겹친 블록 id)}.
  function coverage(mask, blocks, { minConf = 0.5 } = {}) {
    const blockIds = new Set(), regions = [];
    for (const m of mask ?? []) {
      const bs = (blocks ?? []).filter(b => b?.bbox && overlap(m, b.bbox));
      const ids = bs.filter(b => b.id != null).map(b => String(b.id));
      for (const id of ids) blockIds.add(id);
      const read = bs.some(b => String(b.text ?? "").trim() && (b.conf == null || b.conf >= minConf));
      regions.push({ x: m.x, y: m.y, w: m.w, h: m.h, blockIds: ids, unread: !read });
    }
    return { regions, blockIds };
  }

  const api = { diff, coverage };
  globalThis.InkDiff = api;
  if (typeof module !== "undefined") module.exports = api;
})();
