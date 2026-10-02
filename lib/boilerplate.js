// 슬라이드 인식 결과에서 반복되는 비내용 텍스트(LMS 워터마크·머리글·쪽번호 등)를 걸러낸다.
//
// 비파괴가 원칙이다: 블록을 지우지 않고 selection 표시만 한다. 표 안의 숫자 같은
// 진짜 내용은 건드리지 않는 것이 재현율보다 우선이다 — 숫자는 정규화하면 전부 "#"가
// 되어 서로 구별이 안 되므로, 문자 정보가 부족한 텍스트는 반복 판정 대상에서 아예
// 뺀다(eligible). 같은 이유로 "예제 3"처럼 숫자가 매 장 바뀌는 번호 라벨은 내용이다:
// 문서빈도(규칙 3)는 클러스터의 숫자 run이 상수(최다 값 ≥80%)일 때만 걸러낸다.
(() => {
  // 공백으로 구분된 토큰이 숫자와 OCR 유사문자(O o I l |)만으로 이루어지고 실제
  // 숫자가 4개 이상이면 수로 본다 — "2O24123456"도 "#"가 되어야 학번 워터마크의
  // 오독 변형이 같은 문자열로 모인다.
  const NUM_TOKEN = /^[0-9oil|]+$/;
  const numToken = (t) => NUM_TOKEN.test(t) && (t.match(/[0-9]/g) || []).length >= 4;
  const normalizeText = (s) =>
    String(s ?? "")
      .normalize("NFC")
      .trim()
      .replace(/\s+/g, " ")
      .replace(/[A-Z]/g, (c) => c.toLowerCase())
      .split(" ")
      .map((t) => (numToken(t) ? "#" : t))
      .join(" ")
      .replace(/[0-9]+/g, "#");

  // 원문의 숫자 run을 순서대로 이은 열쇠 — 수토큰은 normalizeText와 같이 접는다
  // (o→0, i·l·|→1). "예제 1"/"예제 2"처럼 번호가 바뀌는 라벨과 학번처럼 상수인
  // 반복물을 가르는 기준이다. 숫자가 없으면 "".
  const digitKey = (s) =>
    String(s ?? "")
      .normalize("NFC")
      .trim()
      .replace(/\s+/g, " ")
      .replace(/[A-Z]/g, (c) => c.toLowerCase())
      .split(" ")
      .flatMap((t) => (numToken(t) ? [t.replace(/[oil|]/g, (c) => (c === "o" ? "0" : "1"))] : t.match(/[0-9]+/g) || []))
      .join(",");

  const trigrams = (s) => {
    const g = new Set();
    for (let i = 0; i + 3 <= s.length; i++) g.add(s.slice(i, i + 3));
    return g;
  };

  // 이미 정규화된 문자열의 자카드 — detect는 캐시 버전을 쓰고 maskBoxes는 이걸 쓴다
  const jacNorm = (na, nb) => {
    if (na.length < 3 || nb.length < 3) return na === nb ? 1 : 0;
    const ga = trigrams(na), gb = trigrams(nb);
    let inter = 0;
    for (const g of ga) if (gb.has(g)) inter++;
    return inter / (ga.size + gb.size - inter);
  };
  const trigramJaccard = (a, b) => jacNorm(normalizeText(a), normalizeText(b));

  // 80자 이하이고 한글 3자·라틴 4자 연속 run이 있거나, "#" 없이 문자가 4개 이상.
  // 이를 못 채운 텍스트("12", "3.5", "5kg", "100만원", "금리 #% 상승")는 숫자
  // 데이터일 가능성이 커서 반복 규칙·서명·후보에서 모두 제외한다.
  const HANGUL_RUN = /[가-힣]{3}/, LATIN_RUN = /[a-z]{4}/, LETTER = /\p{L}/gu;
  const eligible = (n) =>
    n.length > 0 && n.length <= 80 &&
    (HANGUL_RUN.test(n) || LATIN_RUN.test(n) || (!n.includes("#") && (n.match(LETTER) || []).length >= 4));

  // 정규화된 두 문자열의 편집거리가 긴 쪽의 20%(최소 1) 이내인지 — 오독 변형 흡수용
  const nearEdit = (a, b) => {
    const limit = Math.max(1, Math.floor(0.2 * Math.max(a.length, b.length)));
    if (Math.abs(a.length - b.length) > limit) return false;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++)
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[b.length] <= limit;
  };

  // 서명 매칭 — 규칙 2(과목 서명)와 maskBoxes가 이 하나를 공유해 판정이 어긋나지 않는다.
  // na, nb는 정규화된 문자열, jac은 정규화 문자열용 자카드 함수.
  const sigMatch = (na, nb, jaccard, jac = jacNorm) => jac(na, nb) >= jaccard || nearEdit(na, nb);

  const validBox = (b) =>
    b && typeof b === "object" && Number.isFinite(b.x) && Number.isFinite(b.y) &&
    Number.isFinite(b.w) && Number.isFinite(b.h) && b.w > 0 && b.h > 0;

  const PAGE_RE = /^\s*(?:p\.?\s*)?(\d{1,3})(?:\s*\/\s*(\d{1,3}))?\s*$/i;

  function detect(slides, { dfRatio = 0.3, minSlides = 3, edge = 0.07, smallHeight = 0.04, jaccard = 0.8, known = [] } = {}) {
    const N = slides.length;
    const need = Math.max(minSlides, Math.ceil(dfRatio * N));
    const bySlide = [], entries = [];
    slides.forEach((s, si) => {
      const blocks = s.blocks || [];
      const hasTitle = blocks.some((b) => b.role === "title");
      bySlide.push(blocks.map((b) => {
        const norm = normalizeText(b.text);
        const e = { si, b, norm, ok: eligible(norm), title: b.role === "title" || (b.role === "header" && !hasTitle), filtered: false, reason: null };
        entries.push(e);
        return e;
      }));
    });
    const mark = (e, reason) => { e.filtered = true; e.reason = reason; };
    const gramCache = new Map();
    const gramsOf = (t) => { let g = gramCache.get(t); if (!g) { g = trigrams(t); gramCache.set(t, g); } return g; };
    // na, nb는 이미 정규화된 문자열. 자카드는 |교집합| ≤ min(|A|,|B|)라 gram 수 비교로 먼저 자른다.
    const jac = (na, nb) => {
      if (na.length < 3 || nb.length < 3) return na === nb ? 1 : 0;
      const ga = gramsOf(na), gb = gramsOf(nb);
      if (Math.min(ga.size, gb.size) < jaccard * Math.max(ga.size, gb.size)) return 0;
      let inter = 0;
      for (const g of ga) if (gb.has(g)) inter++;
      return inter / (ga.size + gb.size - inter);
    };
    // 이번 실행에서 실제로 블록을 걸러낸 정규화 문자열 — 과목 단위 기억으로 넘긴다
    const sigs = new Set();

    // 1. 역할로 확정되는 블록. header는 반복 규칙을 통과해야만 걸러진다.
    for (const e of entries) {
      const r = e.b.role;
      if (r === "watermark" || r === "page_number" || r === "footer") {
        mark(e, "역할: " + r);
        if (r !== "page_number" && e.ok) sigs.add(e.norm);
      }
    }

    // 2. 지난 강의 서명 — 자카드 또는 오독 편집거리로 맞으면 같은 과목의 반복물
    const knowns = [];
    for (const k of known) {
      const n = normalizeText(k);
      if (eligible(n) && !knowns.includes(n)) knowns.push(n);
    }
    for (const e of entries) {
      if (e.filtered || !e.ok || e.title) continue;
      for (const kn of knowns) {
        if (sigMatch(e.norm, kn, jaccard, jac)) {
          mark(e, "과목 반복 텍스트"); sigs.add(kn); break;
        }
      }
    }

    // 3. 문서빈도 — distinct eligible 텍스트를 유사도로 묶고, 클러스터가 닿는
    //    슬라이드 수가 need 이상이면 반복물
    const info = new Map();
    for (const e of entries) {
      if (!e.ok) continue;
      let t = info.get(e.norm);
      if (!t) { t = { list: [], slides: new Set() }; info.set(e.norm, t); }
      t.list.push(e); t.slides.add(e.si);
    }
    const texts = [...info.keys()];
    // ponytail: 서로 다른 후보 텍스트끼리 전수 비교 O(D²) — 2천 개 0.4초, 6천 개 3초, 1만 5천 개 20초.
    // 실제 강의(수백~천 블록)에선 충분하다. 장시간 강의가 문제되면 gram 수로 정렬해 창만 비교한다.
    const parent = texts.map((_, i) => i);
    const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    for (let i = 0; i < texts.length; i++)
      for (let j = i + 1; j < texts.length; j++)
        if (jac(texts[i], texts[j]) >= jaccard) { const a = find(i), b = find(j); if (a !== b) parent[a] = b; }
    const clusters = new Map();
    texts.forEach((t, i) => {
      const r = find(i);
      let c = clusters.get(r);
      if (!c) { c = { texts: [], slides: new Set(), list: [] }; clusters.set(r, c); }
      const ti = info.get(t);
      c.texts.push(t);
      ti.slides.forEach((s) => c.slides.add(s));
      ti.list.forEach((e) => c.list.push(e));
    });
    for (const c of clusters.values()) {
      if (c.slides.size < need) continue;
      // 숫자가 매 장 바뀌는 라벨("예제 #")은 내용이다. 역할·서명으로 이미 걸린 것까지
      // 포함한 클러스터 전체에서 최다 숫자열이 80%를 넘을 때만 상수 반복물로 본다 —
      // 학번·주차의 오독 몇 장은 용인하고, 번호 라벨은 아무것도 걸러내지 않는다.
      const keys = new Map();
      for (const e of c.list) {
        const k = digitKey(e.b.text);
        keys.set(k, (keys.get(k) || 0) + 1);
      }
      if (Math.max(...keys.values()) < 0.8 * c.list.length) continue;
      let rep = c.texts[0]; // 대표는 최다 출현, 동률이면 먼저 본 것
      for (const t of c.texts) if (info.get(t).list.length > info.get(rep).list.length) rep = t;
      let hit = false;
      for (const e of c.list) {
        if (e.filtered) continue;
        if (e.title && c.slides.size < 0.8 * N) continue; // 제목 계열은 80% 이상에서만 건드린다
        mark(e, "반복 텍스트"); hit = true;
      }
      if (hit) sigs.add(rep);
    }

    // 클러스터 문턱에 못 미친 오독 변형 — 확정된 서명(발견+기존)과 편집거리가 가까우면 흡수
    const allSigs = new Set([...sigs, ...knowns]);
    for (const e of entries) {
      if (e.filtered || !e.ok || e.title) continue;
      for (const sg of allSigs) if (nearEdit(e.norm, sg)) { mark(e, "반복 텍스트 (오독 추정)"); break; }
    }

    // 4. 쪽번호 — 같은 자리에서 값이 단조로 커지는 숫자 전용 블록.
    //    진행형 슬라이드는 같은 값을 반복하고 번호 없는 슬라이드는 간극을 만든다.
    const tracks = [];
    for (const e of entries) {
      if (e.filtered) continue;
      const m = PAGE_RE.exec(String(e.b.text ?? ""));
      if (!m || !validBox(e.b.bbox)) continue;
      const cx = e.b.bbox.x + e.b.bbox.w / 2, cy = e.b.bbox.y + e.b.bbox.h / 2;
      let tr = tracks.find((t) => !t.slides.has(e.si) && Math.abs(t.cx - cx) <= 0.05 && Math.abs(t.cy - cy) <= 0.05);
      if (!tr) { tr = { cx, cy, slides: new Set(), items: [] }; tracks.push(tr); }
      tr.slides.add(e.si); tr.items.push({ e, v: parseInt(m[1], 10), si: e.si });
    }
    for (const tr of tracks) {
      if (tr.items.length < need || new Set(tr.items.map((i) => i.v)).size < 2) continue;
      let mono = true;
      for (let i = 1; i < tr.items.length && mono; i++) {
        const dv = tr.items[i].v - tr.items[i - 1].v, gap = tr.items[i].si - tr.items[i - 1].si;
        if (dv < 0 || dv > gap + 1) mono = false;
      }
      if (mono) for (const it of tr.items) mark(it.e, "쪽번호");
    }

    // 5. 가장자리 후보 — 작고 반복되지만 확정 못 한 텍스트는 판정을 판사 모델로 미룬다.
    //    원문이 아니라 정규화 문자열을 넣는다 — 학번이 새면 안 된다.
    const edgeSeen = new Map();
    for (const e of entries) {
      if (!e.ok || !validBox(e.b.bbox)) continue;
      const b = e.b.bbox;
      if (b.h >= smallHeight) continue;
      if (!(b.x + b.w <= edge || b.x >= 1 - edge || b.y + b.h <= edge || b.y >= 1 - edge)) continue;
      let t = edgeSeen.get(e.norm);
      if (!t) { t = { slides: new Set(), open: false }; edgeSeen.set(e.norm, t); }
      t.slides.add(e.si);
      if (!e.filtered) t.open = true;
    }
    const candidates = [];
    for (const [text, t] of edgeSeen) if (t.open && t.slides.size >= 2) candidates.push({ text, reason: "가장자리 반복" });

    return {
      slides: slides.map((s, si) => ({
        ...s,
        blocks: bySlide[si].map((e) => ({ ...e.b, selection: e.filtered ? "filtered" : "included", ...(e.filtered ? { selectionReason: e.reason } : {}) })),
      })),
      signatures: [...sigs],
      candidates,
    };
  }

  const iou = (a, b) => {
    const iw = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
    const ih = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    const inter = iw * ih, uni = a.w * a.h + b.w * b.h - inter;
    return uni > 0 ? inter / uni : 0;
  };
  const unionBox = (boxes) => ({
    x: Math.min(...boxes.map((b) => b.x)),
    y: Math.min(...boxes.map((b) => b.y)),
    w: Math.max(...boxes.map((b) => b.x + b.w)) - Math.min(...boxes.map((b) => b.x)),
    h: Math.max(...boxes.map((b) => b.y + b.h)) - Math.min(...boxes.map((b) => b.y)),
  });

  // 첫 learnSlides 장에서 매번 같은 자리에 걸러진 영역 — vision API 업로드 전 칠할 부분.
  // 움직이는 워터마크는 자리가 안정되지 않아 절대 반환되면 안 된다.
  function maskRegions(slides, { learnSlides = 5, iou: minIou = 0.5 } = {}) {
    if (!Array.isArray(slides) || slides.length < learnSlides) return [];
    const first = slides.slice(0, learnSlides);
    const filteredBoxes = (s) => (s.blocks || []).filter((b) => b.selection === "filtered" && validBox(b.bbox)).map((b) => b.bbox);
    const regions = [];
    for (const seed of filteredBoxes(first[0])) {
      const chosen = [seed];
      let ok = true;
      for (let i = 1; i < first.length; i++) {
        let best = null, bestIou = minIou;
        for (const b of filteredBoxes(first[i])) { const v = iou(seed, b); if (v >= bestIou) { best = b; bestIou = v; } }
        if (!best) { ok = false; break; }
        chosen.push(best);
      }
      if (!ok) continue;
      // 시드와 각각 가깝더라도 선택된 상자끼리 벌어지면 자리가 안정된 게 아니다
      let stable = true;
      for (let i = 0; i < chosen.length && stable; i++)
        for (let j = i + 1; j < chosen.length; j++)
          if (iou(chosen[i], chosen[j]) < minIou) { stable = false; break; }
      if (stable) regions.push(unionBox(chosen));
    }
    for (let changed = true; changed;) { // 겹치는 영역은 하나로 합친다
      changed = false;
      outer: for (let i = 0; i < regions.length; i++)
        for (let j = i + 1; j < regions.length; j++)
          if (iou(regions[i], regions[j]) >= minIou) {
            regions[i] = unionBox([regions[i], regions[j]]);
            regions.splice(j, 1);
            changed = true;
            break outer;
          }
    }
    return regions;
  }

  // 위치가 매 장 바뀌는 워터마크용 — maskRegions는 자리가 고정된 것만 잡으므로 못 쓴다.
  // 업로드 경로에서 슬라이드 한 장의 로컬 OCR 블록을 받아, 배운/기존 서명과 맞는
  // 상자만 칠한다(프레임이 기기를 떠나기 전). 판정은 detect 규칙 2와 같은 sigMatch.
  function maskBoxes(blocks, signatures, { jaccard = 0.8 } = {}) {
    if (!Array.isArray(blocks) || !Array.isArray(signatures)) return [];
    const sigs = [];
    for (const s of signatures) {
      const n = normalizeText(s);
      if (eligible(n) && !sigs.includes(n)) sigs.push(n);
    }
    if (!sigs.length) return [];
    const boxes = [];
    for (const b of blocks) {
      if (!b || !validBox(b.bbox)) continue;
      const n = normalizeText(b.text);
      if (!eligible(n)) continue;
      for (const sg of sigs) {
        if (sigMatch(n, sg, jaccard)) {
          const { x, y, w, h } = b.bbox;
          boxes.push({ x, y, w, h });
          break;
        }
      }
    }
    return boxes;
  }

  const api = { normalizeText, trigramJaccard, detect, maskRegions, maskBoxes };
  globalThis.Boilerplate = api;
  if (typeof module !== "undefined") module.exports = api;
})();
