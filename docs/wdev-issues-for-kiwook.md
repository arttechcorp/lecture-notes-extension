# `w/dev` 점검 이슈 — Kiwook 전달용

작성: 2026-10-05 · Jihwan(b) 쪽 시각 자료 작업 중 발견 · 대상 `origin/w/dev` **`308d240`(v1.3.6)**

- **확인 방법:** `w/dev`를 저장소 밖에 풀어 서비스 호출 없는 프로브로 실제로 돌렸다. 처음 점검은 `67e6f61`에서 했고, 아래 항목은 모두 `308d240`에서 다시 재현했다.
- **재현 스크립트:** `tools/wdev-audit/`. `w/dev` 루트에 복사해서 실행한다.
- **줄 번호:** `308d240` 기준이다.
- **범위:** 고치지는 않았다. 제안만 적었다.
- **`main`에도 있는 항목:** 1, 2, 3, 4, 9, 12.
  - 근거: `main`의 `formulas.js`·`boilerplate.js`·`preprocess.js`·`note-file.js`가 `w/dev`와 같다. `stages.js`도 같은 순서(`detect` → `mergeProgressive`)와 같은 `VERSION`을 쓴다.
  - **이슈 3은 `main`에서 더 심하다.** `main`의 `visual-gate.js`는 비전 모드도 같은 32% 규칙을 쓴다. 그래서 `main`의 유료 비전 경로는 첫 장 이후 화면을 거의 보내지 않는다. `w/dev`는 비전 분기를 새로 써서 이 문제가 없다.

## 요약

| # | 제목 | 심각도 | 위치 |
|---|---|---|---|
| 1 | 수식 화면 대조가 숫자만 비교해 틀린 수식이 `verified`로 나감 | **높음** | `lib/formulas.js` |
| 2 | 반복 텍스트 필터가 슬라이드 병합보다 먼저 돌아 점진 노출 슬라이드의 본문을 지움 | **높음** | `lib/stages.js`, `lib/boilerplate.js` |
| 3 | OCR 모드(Free 실시간) 슬라이드 전환 판정이 실제 전환을 못 잡음 | **높음(Free)** | `lib/visual-gate.js` |
| 4 | 단계 캐시 버전이 고정돼 재생성이 예전 결과를 그대로 돌려줌 | 중상 | `lib/stages.js`, `lib/pipeline.js` |
| 5 | B10 `derived` LaTeX가 "모델 유도·미검증" 표시 없이 렌더됨 | 중상 | `lib/note-contract.js`, `lib/note-spec.js` |
| 6 | B03 지도의 노드·연결에 근거 검사가 없음 | 중 | `lib/note-contract.js` |
| 7 | 원문 재현 검사가 실제(줄 단위) 근거에서 걸러내지 못함 | 중 | `lib/verify.js` |
| 8 | Free 작성 모델이 수식 내용을 못 받아 `{{F#}}`가 우연히 짝지어짐 | 중 | `lib/stages.js` |
| 9 | 근거에 OCR 신뢰도가 없어 오독 줄을 표시할 수 없음 | 중 | `lib/preprocess.js`, `lib/verify.js` |
| 10 | `repairPlan`이 제목의 여러 자리 숫자를 지움 (`13강` → `강`) | 중하 | `lib/note-contract.js` |
| 11 | 숫자 보존 검사가 한글 수사·백분율을 모름 | 중하 | `lib/verify.js` |
| 12 | 예전 노트·패키지 읽기 변환(마이그레이션)이 없음 | 잠재(형식 변경 시 높음) | `lib/note-file.js`, `lib/package-store.js`, `lib/library.js` |
| 13 | Markdown 내보내기 이스케이프 불일치 | 낮음 | `lib/note-export.js` |
| 14 | 웹 보관함에서 같은 패키지 파일이 여러 개면 마지막으로 읽은 것을 씀 | 낮음 | `landing/library.js` |

---

## 1. 수식 화면 대조가 숫자만 비교해 틀린 수식이 `verified`로 나감 — 높음

- **위치:** `lib/formulas.js:22-45`(`numericTokens`, `crossCheck`), `:105-111`(`verify`), 호출은 `lib/stages.js:198`.
- **현상:**
  - LaTeX와 화면 텍스트의 **숫자 다중집합만** 비교한다. 부호와 변수는 비교하지 않는다(`formulas.js:31` 주석).
  - 대조 텍스트는 같은 비전 호출이 준 `text`다(`opts.ocrText ?? entry.text`). 독립된 두 번째 판독이 아니다.
  - 숫자가 없는 수식은 빈 집합끼리 일치해서 무조건 `verified`가 된다.
  - 이 결과는 "노트에 노출된 수식 중 검증 안 된 LaTeX 0건" SLO(`architecture-v2.md` §4)와 충돌한다.
- **재현** (`node probe2.js` B절, 또는 아래 한 줄):
  ```sh
  node -e 'const F=require("./lib/formulas.js"),katex=require("./lib/vendor/katex/katex.min.js");for(const[l,t]of[["a+b=c","x-y=z"],["ax^2+bx-c=0","ax2 + bx + c = 0"],["x=-2","x = 2"],["V_{DS}","VGs"]])console.log(l,"|",t,"->",F.verify({id:"F1",latex:l,text:t},{katex,reread:true}).status)'
  # 넷 다 verified
  ```
  반대로 맞는 수식이 OCR 오독 때문에 떨어지기도 한다: 근의 공식 vs `62-4ac`, `\frac{1}{2}mv^2` vs `12 mv2` → `image`. 이쪽은 안전한 방향이지만 맞는 수식을 잃는다.
- **제안:**
  1. 비교할 토큰이 양쪽 다 비면 `unverified`로 둔다(`formulas.js:110` 근처).
  2. 부호(`-`, `−`), 한 글자 변수, 연산자 토큰을 비교에 더한다.
  3. 두 번째 판독기로 수식 크롭을 로컬 PP-OCR로 읽어 `opts.ocrText`에 넘긴다. 이 부분은 b쪽 3단계 작업(로컬 인식 비교)에서 제공할 예정이다.

## 2. 반복 텍스트 필터가 점진 노출 슬라이드의 본문을 지움 — 높음

- **위치:** `lib/stages.js:196`(`Boilerplate.detect`)이 `:202`(`Preprocess.mergeProgressive`)보다 먼저 돈다. 문서 빈도 규칙은 `lib/boilerplate.js:140` `detect({dfRatio:0.3, minSlides:3})`.
- **현상:**
  - 클릭으로 한 줄씩 드러나는 슬라이드나 판서가 쌓이는 화면은 같은 줄이 여러 캡처에 반복된다.
  - 이 줄들이 병합 전에 "max(3, 30%) 이상 캡처에 나온 반복 텍스트"로 분류돼 `filtered`가 된다.
  - 캡처 6장인 세션에서 4단계로 드러나는 슬라이드는 1·2번째 글머리가 마지막 캡처에서도 지워진다. `U1.slideText`에서 빠지고 인용할 수 없다.
  - 문턱은 N≤10이면 3장, N=20이면 6장, N=40이면 12장이다. 짧은 세션일수록 심하다.
- **재현:** `node probe4.js`. 같은 스크립트가 "병합 먼저 하면 아무것도 지워지지 않음"도 보여 준다.
- **제안:** `mergeProgressive` 뒤에 `detect`를 돌리거나, 병합된 슬라이드 단위로 문서 빈도를 센다.

## 3. OCR 모드(Free 실시간) 슬라이드 전환 판정이 실제 전환을 못 잡음 — 높음(Free)

- **위치:** `lib/visual-gate.js` OCR 분기의 `transition = delta(recognized.low, current.low) > .32`. 비전 분기는 v2에서 타일 15% 규칙으로 새로 썼고 정상이다.
- **현상:**
  - 흰 배경 슬라이드는 글자 면적이 작다. 그래서 실제 슬라이드 전환의 64×36 변화량이 0.06~0.31로 32%에 못 미친다.
  - 측정에 쓴 쌍은 실제 강의 화면 3장(쌍 3개)을 포함한 실제 전환 7쌍이고, 판서 추가는 0.03~0.04였다.
  - 재생 측정에서 `w/dev` OCR 모드는 전환 **9건 중 0건**을 잡았다. `slideId`가 계속 0이다.
  - 실시간 경로는 `slideId:"s"+job.slideId`(`lib/session.js:190`)를 쓰므로, 한 강의의 모든 SlideDoc이 같은 `slideId`를 갖게 된다. 그 뒤 단계(병합, 유닛, 반복 텍스트)에 주는 영향은 이번에 따라가 보지 않았다. 확인 부탁.
- **제안:** b쪽 브랜치에 고친 판정이 있다. `b/visual-suppression` `7565108`.
  - 슬라이드 첫 프레임을 기준으로, 그 내용 칸의 20% 넘게 배경으로 돌아가면 전환으로 본다.
  - 판서 추가·삭제는 전환이 아니다. 거의 빈 기준 화면이면 내용이 나타나는 것을 전환으로 본다.
  - 측정: 전환은 0.76~1.00, 판서는 0.00이라 깨끗하게 갈린다.
  - **OCR 분기에만 이식**하고 비전 분기는 그대로 두는 것을 제안한다. 이식은 b쪽에서 PR로 올릴 수 있다.

## 4. 재생성이 단계 캐시에서 예전 결과를 그대로 돌려줌 — 중상

- **위치:** `lib/stages.js:22` `VERSION = "stages-2"`, `:158` `K()`(캐시 키 = 입력 해시, 모델, `VERSION`, 스키마), `lib/pipeline.js:74-99`.
- **현상:**
  - `VERSION`이 도입(`966baaf`) 뒤로 검증·조립·repair 수정 10여 건 동안 그대로다(v1.2.x~v1.3.6).
  - 서버 `PROMPT_VERSION`도 키에 없다.
  - 같은 패키지를 새 작업 id로 재생성하면 **서비스 호출 0회, 같은 노트 JSON**(`generatedAt`까지 같음)이 나온다.
  - `input.rerun`을 설정하는 곳이 없어서, 옛 패키지는 옵션을 바꾸지 않는 한 고친 검증기를 영영 거치지 않는다.
- **재현:** `node probe6.js`(`tools/note-fixture` 사용).
- **제안:** 로컬 단계와 LLM 호출 키에 코드·프롬프트 개정 상수를 넣는다. 또는 `libRegenerate`가 새 `rerun`을 넘긴다.

## 5. B10 `derived` LaTeX가 표시 없이 렌더됨 — 중상

- **위치:** `lib/note-contract.js:739-746`(숫자·원문 검사에서 `derived` 제외), `:859-860`(KaTeX 문법만 검사). 렌더는 `lib/note-spec.js`, 내보내기는 `lib/note-export.js`.
- **현상:** 슬라이드에 수식이 없어도 모델이 새로 쓴 식이 문법만 맞으면 일반 수식처럼 렌더된다. 틀린 근의 공식으로 확인했다.
- **제안:** 렌더·내보내기에 "모델 유도·미검증" 표시를 단다. 또는 `derived`에 근거(basis/evidence)를 요구한다.

## 6. B03 지도의 노드·연결에 근거 검사가 없음 — 중

- **위치:** `lib/note-contract.js:926-927`. `causes`·`supports` 연결만 claim을 요구한다. 렌더는 `lib/note-spec.js`의 B03 카드 그리드, 내보내기는 `lib/note-export.js`.
- **현상:**
  - 강의에 없는 노드("양자 터널링", "BJT")와 `includes`·`precedes` 연결이 오류·탈락·고지 없이 `status: complete`로 나간다.
  - "구조" 배지 아래 카드로 렌더되고, "모델 정리" 표시가 없다.
  - Markdown에는 `A → B (includes)`처럼 enum 원문이 나간다.
- **재현:** `node probe8.js`.
- **제안:** 노드 라벨이 섹션 유닛 텍스트에 있어야 통과시킨다. 또는 모든 연결에 lecture claim을 요구하거나, 블록에 "모델 정리" 표시와 고지를 단다.

## 7. 원문 재현 검사가 줄 단위 근거에서 걸러내지 못함 — 중 (비대체성 불변식)

- **위치:** `lib/verify.js:9`(`WINDOW = 180, STEP = 60`), `:62-75`(`verbatimIds`).
- **현상:**
  - 180자 창을 근거 항목마다 만든다. 그런데 실제 슬라이드 근거는 PP-OCR 한 줄씩이라 10~50자다.
  - 슬라이드 다섯 줄을 그대로 이은 202자 본문이 `errors: []`로 통과한다. 같은 텍스트를 한 줄짜리 근거로 주면 `VAL_VERBATIM`이 걸린다.
  - 테스트는 200자 한 항목만 쓴다(`note-contract.test.js`, `verify.test.js`).
- **재현:** `node probe3c.js`.
- **제안:** 유닛별로 합친 `slideText`·`speech`에도 창을 만든다.

## 8. Free 작성 모델이 수식 내용을 못 받음 — 중

- **위치:** `lib/stages.js:156` `regFor`가 `{id, latex, status}`만 보낸다. Free는 `latex:null`이다(`lib/layout.js` `localSlideDoc`).
- **현상:**
  - 작성 모델이 `{{F1}}`과 `{{F2}}`를 구분할 정보가 없어 짝이 우연히 맞는다. 같은 문장에 다른 수식의 OCR 원문이 붙는다.
  - 인용되지 않은 수식은 고지 없이 사라진다.
- **제안:** OCR `text`를 "미검증"으로 표시해 함께 보낸다. 노트에 빠진 수식은 고지 코드를 추가한다.

## 9. 근거에 OCR 신뢰도가 없어 오독 줄을 표시할 수 없음 — 중

- **위치:** `lib/preprocess.js:155-159` 근거 항목이 `conf`·`bbox`를 버린다. 숫자 보존 검사는 `lib/verify.js:50-59`.
- **현상:**
  - 숫자 보존 검사는 "주장의 숫자 ⊆ 근거의 숫자"라서 근거의 오독을 그대로 옮긴 주장도 통과한다.
  - 예: 근거 `x = 2`(원래 `x = -2`), `62-4ac`(원래 `b²-4ac`), `12 mv2`(원래 ½mv²)에 대해 `x = -2`, `62-4ac`, `12 mv²` 주장이 모두 통과한다.
  - 한 자리 숫자는 건너뛰고(`verify.js:54`), 부호는 비교하지 않는다.
  - 한글이나 세 글자 이상 이름이 든 줄(`VGs = 2 V`)은 `isFormulaLine`에서 빠져 본문 근거로 들어간다.
- **제안:** 근거에 `conf`를 싣는다. 저신뢰 줄을 인용한 주장은 표시하거나 고지한다.

## 10. `repairPlan`이 제목의 여러 자리 숫자를 지움 — 중하

- **위치:** `lib/note-contract.js:417-420`(판정), `:625`, `:633`(수정).
- **현상:**
  - 근거에 없는 두 자리 이상 숫자를 제목·개념 이름에서 지운다.
  - `Graph theory 13강` → `Graph theory 강`, `(2024학년도)` → `( 학년도)`, `ISO 9001` → `ISO`, `$5에서 $15로` → `$5에서 $ 로`.
- **재현:** `node probe1b.js`.
- **제안:** 숫자와 붙은 접미사를 함께 지운다. 또는 숫자 없는 대체 제목을 쓴다.

## 11. 숫자 보존 검사가 한글 수사·백분율을 모름 — 중하 (보수적 실패)

- **위치:** `lib/verify.js:47-59`.
- **현상:** 근거가 "십 달러"면 주장 "$10"은 `VAL_NUMBER_MISSING`이 된다. "삼 점 오" vs 3.5, "천이백" vs 1,200, "열두" vs 12, `25%` vs `0.25`, `10²` vs `10^2`도 같다. 맞는 주장이 탈락한다.
- **제안:** 근거 쪽 `numbersOf`에서 한글 수사를 해석한다.

## 12. 예전 노트·패키지 읽기 변환이 없음 — 잠재

- **위치:** `lib/note-file.js:51`(`version===1`, 정확한 키 집합, 고정 KDF 반복 수), `lib/package-store.js:91`(`record.v !== 1`은 손상으로 처리), `lib/library.js` 메타 화이트리스트와 엄격한 enum.
- **현상:**
  - `architecture-v2.md`·`note-contract.md`가 약속한 "읽을 때 마이그레이션, 모르는 필드 보존"이 코드에 없다(`pipeline.js:156` 주석뿐).
  - 형식을 한 번 바꾸면 기존 `.summrizei` 파일 전체가 "Summrizei 노트 파일이 아닙니다"로 거부된다.
  - 웹 보관함은 재생성할 수 없다. 페이로드가 `{meta,note,crops}`라 `input`이 없다.
- **제안:** 버전별 읽기 표, 모르는 키 무시, 파일의 KDF 값을 허용 범위 안에서 읽기, 버전 전용 안내 문구.

## 13. Markdown 내보내기 이스케이프 — 낮음

- **위치:** `lib/note-export.js:11`(`<`·`>` 엔티티화), `:13`.
- **현상:** `.md`에서 `|x| &lt; 1`처럼 보인다. 반면 `*`·`_`·`$`는 이스케이프하지 않아 `x*y + z*w`가 기울임으로 바뀌고 `$5 … $10`이 수식 문법과 섞인다. HTML 보기와 PDF는 영향 없다.
- **제안:** 본문의 `* _ [ ] $ \``를 백슬래시로 이스케이프하고, `<`는 글자·`!`·`/` 앞에서만 이스케이프한다.

## 14. 웹 보관함 중복 패키지 — 낮음

- **위치:** `landing/library.js:227`.
- **현상:** 같은 `packageId` 파일이 여러 개면 `updatedAt`이 최신인 것이 아니라 마지막으로 읽은 것을 쓴다.
- **제안:** `updatedAt`을 비교한다.

---

## 참고: b쪽이 맡을 것 (조율용)

이건 이슈가 아니라 b쪽 시각 자료 작업이 `w/dev` 구조에 들어갈 위치다. 자세한 내용은 `docs/visual-wdev-integration.md`.

- **도표 크롭 로컬 OCR:** `figureData.ocr`가 늘 `{}`라 `isSimpleChart`·숫자 있는 `isSimpleTable`이 사실상 쓰이지 않는다(`background-job.js`). b쪽이 크롭 OCR을 채운다.
- **Free 도표 탐지:** `localSlideDoc.figures: []`를 채운다. 실시간 경로 크롭도 같이 한다.
- **판서 층:** 같은 슬라이드에 나중에 더해진 부분을 SlideDoc에 담는다. `contracts.js` role에 `annotation`을 추가할지(서버 `VISION_SCHEMA`와 함께 배포), 판서 전용 SlideDoc으로 할지 **합의가 필요하다**.
- **이슈 3** 판정 이식, **이슈 1-3** 두 번째 판독기.
