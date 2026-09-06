// OCR 결과를 하나의 스크립트로 재구성한다. LLM 재호출 없는 로컬 처리.
// 항목은 { time: 초, text: 문자열 }. 직전 항목과 본문이 같으면(공백/대소문자 무시) 건너뛴다.
function normalizeLine(s) {
  return s.replace(/\s+/g, "").toLowerCase();
}

// OCR이 요청한 장수보다 적게/많이 돌려주는 일이 실제로 흔하다. 짧은 쪽에 맞춰 자른다.
function zipEntries(lines, times) {
  const n = Math.min(lines.length, times.length);
  const out = [];
  for (let i = 0; i < n; i++) out.push({ time: times[i], text: String(lines[i] ?? "") });
  return out;
}

function formatTime(sec) {
  const s = Math.max(0, Math.floor(sec || 0));
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function mergeLines(newEntries, transcriptSoFar) {
  const result = transcriptSoFar.slice();
  for (const entry of newEntries) {
    const text = (entry.text || "").trim();
    if (!text) continue;
    const last = result[result.length - 1];
    if (last && normalizeLine(last.text) === normalizeLine(text)) continue;
    result.push({ time: entry.time, text });
  }
  return result;
}

if (typeof module !== "undefined") {
  module.exports = { mergeLines, normalizeLine, zipEntries, formatTime };
}
