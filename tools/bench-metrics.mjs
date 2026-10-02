// 벤치 공용 순수 함수 — I/O 없음. stt-bench·judge-bench 와 테스트가 함께 쓴다.
import { createRequire } from "node:module";
const { normalizeLatex } = createRequire(import.meta.url)("../lib/formulas.js");

// 문자열은 코드 포인트 단위로 비교한다 — 서로게이트 쌍이 두 글자로 세어지면 CER이 틀어진다.
export function editDistance(a, b) {
  a = [...a]; b = [...b];
  if (a.length < b.length) [a, b] = [b, a];
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++)
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

// 발화 비교에서는 공백·구두점 차이가 의미 없다 — CER 과 용어 재현율이 같은 정규화를 쓴다.
export function cerNorm(s) {
  return String(s ?? "").normalize("NFC").replace(/[\p{White_Space}\p{P}]/gu, "");
}

export function koreanCER(ref, hyp) {
  const r = cerNorm(ref), h = cerNorm(hyp), n = [...r].length;
  // 기준이 비었으면 오차율을 정의할 수 없다 — 빈 가설이면 0, 아니면 벌점 상한 1.
  return n ? editDistance(r, h) / n : ([...h].length ? 1 : 0);
}

export function termHits(terms, hyp) {
  const h = cerNorm(hyp).toLowerCase(), hit = [], miss = [];
  for (const t of terms || []) {
    const n = cerNorm(t).toLowerCase();
    if (!n) continue; // 정규화 후 빈 용어는 모집단에서 제외 — 있어도 맞출 수 없다.
    (h.includes(n) ? hit : miss).push(t);
  }
  return { hit, miss };
}

export function termRecall(terms, hyp) {
  const { hit, miss } = termHits(terms, hyp);
  return hit.length + miss.length ? hit.length / (hit.length + miss.length) : 1;
}

// LaTeX 비교는 lib/formulas.js 의 정규화를 재사용한다 — 파이프라인과 같은 기준이어야
// 벤치 숫자가 실제 검증 경로와 대응한다.
export function formulaMatch(refLatex, hypLatex) {
  const r = normalizeLatex(refLatex);
  return !!r && r === normalizeLatex(hypLatex);
}

export function bboxIoU(a, b) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  const inter = Math.max(0, w) * Math.max(0, h), union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

// probs[i] 는 클래스별 확률 배열이거나 양성 확률 숫자 하나(→ [1-p, p]).
// 최상위 라벨 보정: 신뢰도 = 최대 확률, 정답 여부 = argmax === gold 인덱스.
export function reliabilityBins(probs, labels, bins = 10) {
  const out = Array.from({ length: bins }, (_, i) => ({ lo: i / bins, hi: (i + 1) / bins, n: 0, correct: 0, conf: 0 }));
  for (let i = 0; i < probs.length; i++) {
    let p = probs[i];
    if (typeof p === "number") p = [1 - p, p];
    if (!Array.isArray(p) || !p.length) continue;
    let pred = 0;
    for (let j = 1; j < p.length; j++) if (p[j] > p[pred]) pred = j;
    const conf = p[pred];
    if (!Number.isFinite(conf)) continue;
    const label = labels[i], gold = label === true ? 1 : label === false ? 0 : label;
    const bin = out[Math.max(0, Math.min(bins - 1, Math.floor(conf * bins)))]; // conf 1 은 마지막 bin
    bin.n++; bin.conf += conf;
    if (pred === gold) bin.correct++;
  }
  return out.map(({ lo, hi, n, correct, conf }) => ({ lo, hi, n, accuracy: n ? correct / n : null, confidence: n ? conf / n : null }));
}

export function ece(probs, labels, bins = 10) {
  const bs = reliabilityBins(probs, labels, bins), n = bs.reduce((s, b) => s + b.n, 0);
  return n ? bs.reduce((s, b) => s + b.n / n * (b.n ? Math.abs(b.accuracy - b.confidence) : 0), 0) : 0;
}

// numpy 기본 방식: 정렬 후 (p/100)·(n-1) 위치에서 선형 보간.
export function percentile(xs, p) {
  const s = [...xs].sort((x, y) => x - y);
  if (!s.length) return null;
  const r = Math.min(100, Math.max(0, p)) / 100 * (s.length - 1), lo = Math.floor(r), hi = Math.ceil(r);
  return s[lo] + (s[hi] - s[lo]) * (r - lo);
}

// mp4 재생 시간은 moov/mvhd 에만 있다 — 청크 파일을 디코더 없이 읽어 durationSec(과금 상한)을 채운다.
export function mp4Duration(bytes) {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
  const typeAt = o => String.fromCharCode(u[o], u[o + 1], u[o + 2], u[o + 3]);
  const scan = (start, end, inMoov) => {
    for (let pos = start; pos + 8 <= end;) {
      let size = dv.getUint32(pos), header = 8;
      if (size === 1) { // 64비트 크기가 뒤따른다
        if (pos + 16 > end) return null;
        size = Number(dv.getBigUint64(pos + 8)); header = 16;
      } else if (size === 0) size = end - pos; // 파일 끝까지
      if (size < header || pos + size > end) return null; // 잘린 박스
      const t = typeAt(pos + 4);
      if (t === "moov") {
        const r = scan(pos + header, pos + size, true);
        if (r != null) return r;
      } else if (inMoov && t === "mvhd") {
        const p = pos + header, version = u[p]; // 페이로드: version(1)+flags(3)
        if (version === 0 && p + 20 <= pos + size) {
          const ts = dv.getUint32(p + 12), d = dv.getUint32(p + 16);
          return ts && d ? d / ts : null;
        }
        if (version === 1 && p + 32 <= pos + size) {
          const ts = dv.getUint32(p + 20), d = Number(dv.getBigUint64(p + 24));
          return ts && d ? d / ts : null;
        }
        return null;
      }
      pos += size;
    }
    return null;
  };
  return scan(0, u.length, false);
}
