# 노트 양식 슬롯 연결 안내

작성 2026-10-02 · 대상: 노트 양식(내용 구조·디자인 에셋)을 만드는 작업

파이프라인 v2는 노트 양식을 `lib/note-spec.js` 한 파일에서만 읽는다. 지금 이 파일은 **자리표시(placeholder)** 다. 블록 종류는 `text` 하나뿐이고 디자인도 최소한이다. 양식이 확정되면 이 파일을 통째로 바꾸고 아래 항목을 맞춘다. 라우트·검증기·렌더러 코드는 고치지 않아도 되도록 만들었다.

## 1. 슬롯이 내보내야 하는 이름과 읽는 곳

| 이름 | 읽는 곳 | 뜻 |
|---|---|---|
| `NOTE_SPEC_VERSION` | `server/index.js`, `server/prompts.js`, `lib/note-render.js` | 양식 버전. 바꾸면 서버와 확장을 함께 배포한다(다르면 서버가 409 `note_spec_mismatch`) |
| `BLOCK_TYPES` | 스키마, 템플릿 | 블록 종류 enum |
| `blockSchema`, `planSchema`, `planSectionSchema`, `sectionOutputSchema`, `globalOutputSchema`, `sectionResultSchema` | `server/prompts.js`(요청·출력 스키마), `server/index.js`(제공자 strict 스키마) | 모두 `Contracts.isStrictCompatible` 이어야 한다: 전 속성 필수, `additionalProperties:false`, `lib/contracts.js` 의 키워드만 |
| `limits` | `server/prompts.js`, `server/index.js` | 섹션·블록 수, 문자열 길이, 토큰 예산(Planner 입력 40k, Writer 입력 12k / 출력 4k) |
| `promptRules` | `server/prompts.js` | 양식에 따른 짧은 작성 규칙. 모든 단계 시스템 프롬프트에 들어간다 |
| `templates[type]` | `lib/note-render.js` | `(block, h) => HTML 문자열`. `BLOCK_TYPES` 마다 하나 |
| `layout(note, h)` | `lib/note-render.js` | 문서 전체 순서와 감싸는 마크업. 모든 블록을 `h.block` 으로 그린다 |
| `notice(n, h)` | `lib/note-render.js` | 내용 없는 고지 코드 → 한국어 평문(엔진이 이스케이프한다) |
| `css` | `lib/note-render.js` | 화면·인쇄 표현 전부 |

## 2. 블록 데이터 규칙 (검증기 `lib/verify.js` 와 맞물림)

- 블록마다 최상위에 `evidenceIds`(Unit id, 예: `"U3"`)가 있어야 한다.
- 원본 수식은 본문에 `{{F12}}` 참조로만 쓴다. 등록부 LaTeX 를 다시 쓰면 `VAL_FORMULA_RETYPED` 로 걸린다.
- 새로 유도한 식은 키 이름이 `derived` 인 필드(문자열 또는 문자열 배열)에만 쓴다. KaTeX 로 검증되고 숫자 보존 검사에서는 빠진다.
- 출력의 수치(두 자리 이상 정수, 소수, 배수 붙은 수)는 인용한 근거에 있어야 한다.
- 조건부 블록의 "없음"은 strict 스키마 때문에 빈 배열·빈 문자열로 표현한다.

## 3. 템플릿·레이아웃 작성 규칙 (렌더러 `lib/note-render.js`)

- 모델이 쓴 글은 `h.esc`(속성·평문), `h.rich`(요소 본문 전용, `{{F12}}` 치환과 줄바꿈 포함), `h.math`, `h.formula`, `h.crop` 으로만 넣는다.
- `<script>`, 인라인 이벤트 처리기, 외부 URL, `Date`·`Math.random` 금지(같은 입력 → 같은 HTML).
- 필드가 없거나 모양이 달라도 던지지 않는다. 던지면 엔진이 `RENDER_TEMPLATE_FAILED` 로 기록하고 중립 표시로 대체한다.
- `h.rich` 는 마크다운을 해석하지 않는다. 형광펜(`==…==`)이나 인용 콜아웃이 필요하면 블록 종류나 필드로 만든다.
- 도표 크롭은 `crops` 맵의 키를 정하고 `h.crop(id, alt)` 로 넣는다. 허용되는 src 는 `blob:` 와 `data:image/(png|jpeg|webp);base64,` 뿐이다.
- 엔진이 직접 내는 클래스: `note-f`, `note-f-img`, `note-f-raw`, `note-f-missing`, `note-f-label`, `note-f-src`, `note-crop`, `note-block-fallback`. `css` 에서 스타일을 준다.
- 인쇄 규칙(`@page`, `print-color-adjust: exact`, 인쇄 색 토큰, 다크 테마 여백)은 `css` 가 맡는다. `memory.md` 의 렌더 결합 항목을 함께 다시 본다.

## 4. 고지 코드

`notice` 가 받는 객체는 `{code, count?, ranges?:[{t0,t1}], ids?}` 이고 강의 내용이 없다. 자리표시가 아는 코드는 `VAL_BLOCK_FAILED`, `VAL_UNCITED`, `SRC_GAPS` 다. 확정할 때 `lib/stages.js` 가 실제로 내는 코드 목록과 맞추고, Free 의 "도표 탐지 없음" 고지 문구도 정한다.

## 5. 바꾼 뒤 고칠 테스트

자리표시 값을 고정한 테스트가 있다. 양식을 바꾸면 함께 고친다.

- `lib/note-spec.test.js`: 버전 `"placeholder-0"`, `BLOCK_TYPES` 가 `["text"]`, `promptRules` 의 `{{F12}}` 문구
- `lib/note-render.test.js`: `text` 블록의 `heading`/`body`/`derived`, `VAL_BLOCK_FAILED` 문구, `NoteSpec.css`
- `server/index.test.js`: 자리표시 블록 모양을 쓰는 plan/write 테스트

## 6. 아직 연결하지 않은 것

- `sandbox.html` 에 v2 렌더를 붙이는 일(`lib/vendor/katex/katex.min.css` 와 폰트 로드, `document.fonts.ready` 후 인쇄). 양식이 확정된 뒤 한다.
- KaTeX 는 `\href`·`\url`·`\includegraphics` 를 오류 없이 빨간 글자로 그린다(링크·속성은 만들지 않음). `lib/formulas.js` 가 이런 수식을 `verified` 로 둘 수 있으니, 필요하면 검증 단계에서 거른다.
