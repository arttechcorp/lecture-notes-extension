// PLACEHOLDER — 노트 양식(블록 종류, 내용 구조, 디자인 에셋)은 별도 노트 기획 세션이 정하고,
// 그 산출물이 이 파일 하나를 통째로 대체한다. docs/superpowers/specs/ 의 양식 문서는 초안일 뿐이며 여기서 구현하지 않는다.
// 라우트(server/index.js)·프롬프트(server/prompts.js)·서비스 클라이언트는 아래에서 내보내는 이름만 읽는다.
// 그래서 이 파일의 값만 바꿔도 라우트는 건드릴 필요가 없다. 블록 필드 이름(heading, body …)은 이 파일 밖에서 쓰지 않는다.
(() => {
  const NOTE_SPEC_VERSION = "placeholder-0";
  const BLOCK_TYPES = ["text"];
  // contracts.js 와 같은 규칙: required 를 properties 키에서 파생해 strict 호환(전 속성 필수, additionalProperties:false)을 지킨다.
  const obj = properties => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
  const arr = (items, maxItems) => ({ type: "array", maxItems, items });
  const str = maxLength => ({ type: "string", maxLength });

  const limits = {
    maxSections: 40, maxUnitsPerSection: 60, maxBlocksPerSection: 12, maxGlobalBlocks: 6, maxEvidenceIds: 20, maxDerived: 8,
    strings: { id: 32, title: 120, purpose: 300, heading: 120, body: 1500, derived: 600 },
    // 서버는 입력 토큰을 바이트 수 / bytesPerToken 으로 어림한다. 정확한 계수가 아니라 입력 상한을 거르는 가드다.
    bytesPerToken: 4,
    tokens: { plannerInput: 40000, plannerOutput: 8000, writerInput: 12000, writerOutput: 4000 },
  };
  const S = limits.strings;

  // body 에는 원본 수식을 쓰지 않고 {{F12}} 참조만 둔다. 새로 유도한 식만 derived 에 LaTeX 로 적는다. evidenceIds 는 Unit id("U3").
  const blockSchema = obj({
    type: { type: "string", enum: BLOCK_TYPES },
    heading: str(S.heading),
    body: str(S.body),
    evidenceIds: arr(str(S.id), limits.maxEvidenceIds),
    derived: arr(str(S.derived), limits.maxDerived),
  });
  // 섹션 경계는 청크가 아니라 내용 기준이며 Planner 가 정한다.
  const planSectionSchema = obj({
    sectionId: { type: "string", pattern: "^S[0-9]{1,3}$" },
    title: str(S.title),
    unitIds: arr(str(S.id), limits.maxUnitsPerSection),
    blocks: arr(obj({ type: { type: "string", enum: BLOCK_TYPES }, purpose: str(S.purpose) }), limits.maxBlocksPerSection),
  });
  const planSchema = obj({ sections: arr(planSectionSchema, limits.maxSections) });
  const sectionOutputSchema = obj({ blocks: arr(blockSchema, limits.maxBlocksPerSection) });
  const globalOutputSchema = obj({ blocks: arr(blockSchema, limits.maxGlobalBlocks) });
  // Global Writer 의 입력 한 칸: 섹션이 쓴 블록을 id·제목과 함께 넘긴다.
  const sectionResultSchema = obj({ sectionId: planSectionSchema.properties.sectionId, title: planSectionSchema.properties.title, blocks: sectionOutputSchema.properties.blocks });

  // 프롬프트가 그대로 포함하는 형식 규칙. 양식이 정해지면 이 문장도 함께 바뀐다.
  const promptRules = [
    "[노트 형식 — 임시 규칙. 노트 양식 설계가 확정되면 이 블록을 교체한다]",
    "블록 type은 \"text\" 하나뿐이다. heading은 짧은 제목, body는 자기 말로 정리한 설명이다.",
    "body에는 원본 수식을 쓰지 않고 {{F12}} 같은 등록부 참조만 쓴다. 새로 유도한 식만 derived에 LaTeX로 적는다.",
    "evidenceIds에는 근거로 쓴 유닛 id(예: \"U3\")만 적는다.",
  ].join("\n");

  // PLACEHOLDER — 표현 슬롯. 렌더러(lib/note-render.js)는 모든 표현을 여기서만 가져온다. 양식 세션의 산출물이 통째로 대체한다.
  // 템플릿·layout·notice 는 h(렌더러 도우미)로만 모델 텍스트를 내보낸다: h.esc(속성·일반 텍스트), h.rich(요소 본문 전용, {{F12}} 치환·줄바꿈),
  // h.math(LaTeX, {display}), h.formula(id), h.crop(id, alt), h.block(block), h.notice(n). 템플릿 결과는 신뢰된 HTML 이다.
  const templates = {
    text: (b, h) => `<section class="note-block"><h3>${h.rich(b.heading)}</h3><p>${h.rich(b.body)}</p>`
      + (Array.isArray(b.derived) ? b.derived : []).map(d => `<div class="note-derived">${h.math(d, { display: true })}</div>`).join("") + "</section>",
  };
  // 문서 순서: 전역 블록, 섹션, 고지. 고지 코드는 내용이 없다(건수·구간·id 만).
  const layout = (note, h) => `<article class="note">${note.global.map(b => h.block(b)).join("")}`
    + note.sections.map(s => `<section id="${h.esc(s.sectionId)}"><h2>${h.esc(s.title)}</h2>${(s.blocks || []).map(b => h.block(b)).join("")}</section>`).join("")
    + note.notices.map(n => `<p class="note-notice">${h.notice(n)}</p>`).join("") + "</article>";
  // 일반 텍스트를 돌려준다. 이스케이프는 h.notice 가 한다.
  const notice = n => ({
    VAL_BLOCK_FAILED: `검증을 통과하지 못해 제외된 항목이 ${n.count}건 있습니다.`,
    VAL_UNCITED: `노트가 다루지 못한 근거가 ${n.count}건 있습니다.`,
    SRC_GAPS: "기록이 끊긴 구간이 있어 강의 전체를 담지 못합니다.",
  })[n.code] || `알림: ${n.code}`;
  const css = ".note{font:14px/1.6 sans-serif;max-width:720px;margin:0 auto}.note-notice{color:#666;font-size:.85em}"
    + ".note-f-label{margin-left:.3em;color:#666;font-size:.75em}.note-f-img img{max-height:3em;vertical-align:middle}.note-f-missing{color:#b00}";

  const freeze = o => { for (const v of Object.values(o)) if (v && typeof v === "object") freeze(v); return Object.freeze(o); };
  const api = freeze({ NOTE_SPEC_VERSION, BLOCK_TYPES, blockSchema, planSchema, planSectionSchema, sectionOutputSchema, globalOutputSchema, sectionResultSchema, limits, promptRules, templates, layout, notice, css });
  globalThis.NoteSpec = api;
  if (typeof module !== "undefined") module.exports = api;
})();
