// sol-luna-3 = sol-luna-2 위에 개선 실험을 얹은 숨은 모드(docs/note-quality-review-2026-10-06/sol-luna-2-improvements-2026-10-08.md).
// 여기는 라우팅 동치만 둔다 — 개선 로직은 켜는 곳에서 isV3(noteMode) 로 가른다.
const isV3 = mode => mode === "sol-luna-3";
// Luna 계열 v2(draft·questions 는 noteSession 없는 Luna High 독립 호출): sol-luna-2 와 sol-luna-3 가 같은 경로를 탄다.
const isLunaV2 = mode => mode === "sol-luna-2" || isV3(mode);
// devNoteV3(숨은 설정 객체, lib/settings.js)를 읽는다 — 모르는 값·없는 키·객체 아닌 입력은 기본으로 떨어진다.
// repair: "packet"(기본, 실패 블록만 보내는 수리) | "full-p"(접두 P 전체를 다시 싣는 수리). resume: 재개 캐시 실험.
function v3Options(raw = {}) {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  return { repair: o.repair === "full-p" ? "full-p" : "packet", resume: o.resume === true };
}
const api = { isV3, isLunaV2, v3Options };
globalThis.NoteV3 = api;
if (typeof module !== "undefined") module.exports = api;
