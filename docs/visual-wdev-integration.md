# 그림 인식 시스템 — `w/dev` v2 아키텍처에 끼울 위치

작성: 2026-10-05 · 기준: `origin/w/dev` `67e6f61`(v1.2.5, 노트 계약 `lecture-note-2`) · 우리 작업: `b/visual-suppression`

> 요청받은 `note-pipeline.html`은 원격 저장소 어느 브랜치에도 없다(푸시 전으로 보임). 대신 아래 자료로 파악했다.
> `docs/architecture-v2.md`, `docs/note-contract.md`, `docs/v2-remaining-work.md`, 코드(`lib/`, `server/`, `offscreen.js`).
> 줄 번호는 `git show origin/w/dev:<경로> | nl` 기준이다.

## 0. 결론

1. **`w/dev`에는 도표 체계가 이미 있다.**
   - 흐름: 비전 결과(`SlideDoc.figures`) → 도표 레지스트리 `G#`(`lib/figures.js`) → 표시 방식 결정 → 렌더(`lib/note-render.js`).
   - 표시 방식: `table`(HTML 표), `chart`(SVG 그래프), `crop`(원본 크롭), `check`(확인 필요).
   - 수식은 레지스트리 `F#`(`lib/formulas.js`)로 같은 방식이다.
   - 그래서 우리 시스템은 새 파이프라인을 만들기보다, 이 체계의 **빈 곳을 채우는 부품**으로 들어가는 것이 맞다.
2. **빈 곳은 여섯 군데다.**
   - Free(로컬) 경로에는 도표 탐지가 없다: `layout.js` `localSlideDoc`의 `figures: []`.
   - 도표 크롭 안의 숫자를 로컬 OCR로 대조하는 경로가 비어 있다(`figureData.ocr = {}`). 그래서 숫자 있는 표와 **모든 그래프가 HTML로 다시 그려지지 않고 크롭**으로만 나간다.
   - 실시간(탭) 경로는 크롭을 만들지 않는다.
   - 수식 검증의 "화면 대조"가 비전 모델 자신의 텍스트를 쓴다. 독립된 대조가 아니다.
   - 판서를 표현하는 자리가 없다.
   - OCR 모드(Free 실시간)의 슬라이드 전환 판정은 우리가 고친 그 32% 버그가 그대로 있다.
3. **우리 브랜치 변경 중 일부는 버려야 한다.**
   - 2단계 검증기(`lib/summary.js`)와 프롬프트(`lib/openrouter-client.js`)는 `main`·`w/dev`에서 **파일이 삭제됐다**.
   - `(판서)` 텍스트 접두어는 `w/dev`에서 노트까지 가지 않는다. 노트는 `EvidenceStore` 텍스트가 아니라 `SlideDoc`을 쓰기 때문이다.
   - 살릴 것: 슬라이드 전환 판정(`visual-gate.js`)과 판서 층 계산(`ink-layer.js`). `w/dev` 구조에 맞춰 옮겨야 한다.

## 1. `w/dev`의 화면 → 노트 흐름

```
[A 소스]
  Free 실시간: session.js captureVisual → VisualGate(OCR 모드, 기존 32% 규칙) → JPEG
  유료 백그라운드: background-job.js(HLS 직접 수신) → 2초마다 키프레임 → VisualGate(비전 모드, 8×8 타일 15%) → JPEG
[B 인식]
  Free:  PP-OCRv5 → layout.js localSlideDoc     (blocks: title|body, formulas: unverified, figures: [])
  유료:  /v1/vision(GPT-6 Luna) → SlideDoc       (blocks role, formulas LaTeX, figures bbox·kind·cells·chartData)
         → offscreen.js cropRegions(도표 ≤3·수식 ≤4/장, WebP, 슬라이드 전체 크롭 금지) → 패키지 blobs(암호화)
[C 정제]   stages.js refining: Boilerplate → Formulas.buildRegistry+verify → Preprocess.buildIR → Figures.buildFigureRegistry(유료)
[D 판정]   /v1/judge 중요도(유료만)
[E 계획]   /v1/plan → Plan(섹션·블록·formulaIds·figureIds)
[F 작성]   /v1/write 섹션별 → 블록 JSON(B01–B18)
[G 검증]   NoteContract.validateSection(근거·숫자·수식 재타이핑·원문 재현) → repair 1회 → T5 지지(유료) → assembleNote
[H 렌더]   sandbox.html / landing/library.js ← note-render.js figure(): table|chart(SVG)|crop|check
[저장]     PackageStore(IndexedDB AES-GCM) · .summrizei 파일(PIN, 24MiB) · 웹 보관함에서만 열람
```

달라진 불변식(`w/dev` AGENTS.md):

- 도표·표·수식 영역 **크롭은 암호화해 보관할 수 있다**. 슬라이드 전체는 저장하지 않는다.
- 그래서 앞서 "손그림 판서 크롭은 이미지 저장 금지와 충돌"이라고 적은 결정 사항은 v2에서 성격이 바뀐다. 판서 스케치를 도표 영역 크롭으로 다루면 허용 범위다. 단 90% 넘게 덮으면 `CROP_WHOLE_FRAME`으로 거부된다.

## 2. 이미 있는 것 (그대로 활용)

| 기능 | 위치 | 비고 |
|---|---|---|
| 도표 계약 | `lib/contracts.js:94-120` `SlideDoc.figures{id,bbox,kind,title,cells,chartSummary,chartData,conf}` | strict 스키마. 서버 `VISION_SCHEMA`가 이것에서 파생된다 |
| 크롭 생성 | `offscreen.js:81-100` `cropRegions`, `figures.js:152-164` `cropFigure`, dHash `figures.js:15-42` | 백그라운드(`background-job.js:147-158` `keepCrops`)에서만 호출 |
| 레지스트리·표시 결정 | `figures.js:100-148` (`display` = table/chart/crop/check), `isSimpleTable` 68-79, `isSimpleChart` 83-94 | 숫자를 로컬 OCR 숫자 집합과 대조. OCR이 없으면 그래프는 절대 `chart`가 아니다 |
| 수식 레지스트리·검증 | `formulas.js:66-112` (KaTeX 파싱 + OCR 숫자 대조, 실패 시 크롭) | `stages.js:191` |
| 렌더 | `note-render.js:131-142` `figure()`, `figChart` 99-130(손으로 쓴 SVG), `figTable` 89-96 | 크롭은 `blob:`/래스터 `data:`만 허용(`SRC_OK`) |
| 배치 | `note-spec.js:286-336` (`figureIds` 블록 뒤, 아니면 `t0`이 속한 섹션) | `G#`에 `unitId, slideId, t0, evidenceId` |
| 보류 표시 | `display:"check"` → "도표 확인 필요", `NOTE_FIGURES_CHECK` | 근거 없는 도표를 만들지 않는 원칙이 이미 계약에 있다(note-contract §14) |

## 3. 끼울 위치

| # | 우리 부품 | `w/dev`에 끼울 위치 | 바꿀 것 | 단계 |
|---|---|---|---|---|
| 1 | **슬라이드 전환 판정(사라짐 기준)** | `lib/visual-gate.js` OCR 모드 분기(`w/dev` 66-80, 여전히 `delta>.32`) | 기준 화면 + 내용 사라짐 규칙을 OCR 모드에 이식한다. 비전 모드는 `w/dev`가 타일 15% 규칙으로 새로 썼으므로 실측(§6) 후 결정한다 | 지금 |
| 2 | **판서 층** | 실시간: `session.js` `captureVisual`(`gate.inspect` 169와 JPEG 176 사이) → `createOcrEngine`(10-26). 백그라운드: `background-job.js` `onFrame`(253-263) | 판서는 텍스트 접두어가 아니라 **SlideDoc 안에서 표현**해야 한다. ① `contracts.js:93` role에 `annotation`을 추가한다(서버 `VISION_SCHEMA`와 함께 배포). 또는 ② 판서 전용 SlideDoc(`engine:"ppocr-v5-ink"`)을 둔다. 어느 쪽이든 `preprocess.js:47` `usableBlocks`, 근거 종류, 작성 프롬프트 규칙(`server/prompts.js`)을 같이 바꾼다. 백그라운드는 256×144 표본과 JPEG만 있어, 원해상도 기준 화면이 필요하면 `media-decode.js:85-111`과 메모리 예산(`mem.hold`)을 손봐야 한다 | 3단계와 병행 |
| 3 | **그림 영역 탐지(텍스트 vs 그림)** — Free | `layout.js:52-74` `localSlideDoc`의 `figures: []` 자리. PP-OCR 줄 상자는 이미 있고(54), 픽셀은 `session.js:17-22`에서 `image.close()` 전에 접근할 수 있다 | 픽셀 규칙 시제품(`tools/visual-region-probe.mjs`)이나 PP-DocLayout으로 `figures[{bbox,kind}]`를 채운다. 그러면 Free의 `NOTE_FIGURES_NOT_DETECTED`가 해소된다 | **3단계 핵심** |
| 4 | **실시간 경로 크롭** | `session.js` → `offscreen.js` `cropRegions` | 지금은 백그라운드만 크롭한다. 실시간·Free에서도 3번의 영역으로 크롭해 패키지에 보관한다(불변식 허용 범위) | 3단계 |
| 5 | **도표 크롭 로컬 OCR(숫자 대조)** | 비어 있는 슬롯 `figureData.ocr["<slideId>/<figId>"]`(`background-job.js:395`, 사용처 `figures.js:68-94`), `fd` 레코드(155) | 크롭마다 PP-OCR을 돌려 숫자 다중집합을 채운다. 그러면 `isSimpleTable`·`isSimpleChart`가 통과할 수 있고, **숫자 있는 표·단순 그래프가 HTML/SVG로 재디자인**된다. 이것이 우리의 "의미 보존 + 재디자인" 목표다 | **3→4단계 핵심** |
| 6 | **수식 독립 대조·로컬 수식 인식** | `stages.js:191` `Formulas.verify`의 `opts.ocrText`(지금은 비전 모델 자신의 텍스트) | 수식 크롭을 로컬 PP-OCR로 읽어 넘긴다. 2단계 실측에서 PP-OCR은 첨자·분수를 깨뜨리지만 숫자는 강하다. Free에서 수식을 `verified`로 올리려면 로컬 수식 인식(PP-FormulaNet 등)을 비교해야 한다 | 3단계 비교 대상 |
| 7 | **재판독(reread)** | 서버 `VISION_REREAD_PROMPT`(54-58)는 있으나 클라이언트가 호출하지 않는다(`stages.js:190`) | 유료 경로에서 검증에 실패한 수식·도표를 다시 읽는 경로를 잇는다 | 4단계 |
| 8 | **재디자인 렌더** | `note-render.js:131-142`, `figChart` 99-130 | 표시 종류를 추가하면 `note-contract.js:293` enum, `displayOf` 679, `note-spec.js` 배치, `RENDER_VERSION`, 스키마가 바뀌면 `NOTE_SPEC_VERSION`(서버 409 `note_spec_mismatch`), `landing/vendor/summrizei/*` 사본, `note-export.js:81`을 같이 바꾼다 | 4단계 |
| 9 | **회로도(연결 검증)** | `SlideDoc.figures.kind:"diagram"` → 지금은 항상 크롭 | 소자·배선 구조를 `figures`에 담는 필드가 없다. 계약 확장이 필요하다 | 5단계 |
| 10 | **그림 ↔ 섹션·시간 연결** | 이미 있음: `G#.unitId/slideId/t0`, plan `figureIds`, 배치 규칙 | `t1`이나 판서 시각을 더하려면 `note.figures`(`note-contract.js:284-294`)와 `cropMap`(`stages.js:204`)을 확장한다 | 6단계 |
| 11 | **보관·복원** | `library.js:12`(id `^[FG]\d+$`), `offscreen.js:115-125·193-211`, `note-file.js:23-28` | 새 영역 산출물은 `input.figureData`(재생성 때 복원) 또는 `note.figures`에 넣는다. 상한은 파일 24MiB, 레코드 16MiB | 6단계 |

## 4. 우리 브랜치 변경의 처리

| 우리 변경 | `w/dev` 상태 | 처리 |
|---|---|---|
| `lib/visual-gate.js` 사라짐 기준 전환, `fresh`, `reset` 새 슬라이드 | 같은 줄을 `w/dev`도 고쳤다(비전 모드 타일·EMA·`minGapMs`) | **OCR 모드만 이식.** 비전 모드는 §6 실측 후 결정 |
| `lib/ink-layer.js` | 없음(충돌 없음) | 그대로 가져가 §3-2 위치에 연결 |
| `lib/session.js` `(판서)` 접두어·`slideBase` | `session.js`가 크게 바뀌었다. 노트는 `result.data.slideDoc`을 쓴다 | 접두어 방식은 폐기. SlideDoc 표현(§3-2)으로 다시 구현 |
| `lib/summary.js` 검증기(`richStructure`, `simpleEquation`, held) | **삭제됨** | 폐기. 같은 위험이 v2 검증(`note-contract.js`, `formulas.js`, `note-render.js`)에 있는지는 §6에서 따로 점검 |
| `lib/openrouter-client.js` 프롬프트 | **삭제됨**(BYOK 경로 제거) | 폐기. v2 프롬프트는 `server/prompts.js` |
| `offscreen.js` 보관 노트 재검증, `sandbox.html` | 재작성됨 | 폐기 |
| 평가 도구(`tools/visual-*`), 평가 자료(`eval/visual`), 문서 | 없음 | 유지. 입력을 SlideDoc 기준으로 바꾸면 3단계 평가에 그대로 쓴다 |

**브랜치 운용 제안**

- `b/visual-suppression`을 `w/dev`에 병합하면 `visual-gate.js`·`session.js`·`offscreen.js`에서 실제 충돌이 나고, 삭제된 파일 두 개는 버려진다.
- 그래서 `w/dev`(또는 `w/dev`가 들어간 `main`)에서 새 작업 브랜치를 따고 살릴 부품만 옮기는 편이 깔끔하다.
- `w/dev`는 Kiwook의 브랜치라, 끼울 위치(특히 `contracts.js` 스키마·서버 배포)는 합의가 필요하다.

## 5. 수정한 단계 계획

| 단계 | 원래 계획 | v2 기준 수정 |
|---|---|---|
| ② 마무리 | 2단계 회귀 수정 | 대상 파일이 삭제돼 **취소**. 대신 v2 검증 체계에 같은 위험이 있는지 점검(§6) |
| ③ 로컬 인식 비교 | Chrome 내장 AI · PaddleOCR · Qwen 비교 | 비교 과제를 v2 빈칸에 맞춘다. **(a) 도표 영역 탐지**(Free `figures` 채우기: 픽셀 규칙 vs PP-DocLayout vs Chrome 내장 AI), **(b) 크롭 OCR 숫자 대조**(`figureData.ocr` 채우기), **(c) 로컬 수식 인식**(PP-FormulaNet 등, Free 수식 `verified`), **(d) 판서 OCR**. 출력은 모두 `SlideDoc` 계약 모양으로 낸다 |
| ④ 수식·단순 그래프 | 검출 → 구조 → 렌더 → 원본 비교 | `isSimpleChart`/`isSimpleTable` 통과율과 `figChart` 재디자인을 평가셋(`eval/visual`)으로 채점한다. reread 경로를 연결한다 |
| ⑤ 회로도 | 소자·핀·배선 | `figures` 계약 확장 설계부터 시작 |
| ⑥ 노트·보관 | 그림과 섹션 연결, 암호화 복원 | 대부분 이미 있음. 새 필드의 보관·재생성 경로만 추가 |
| ⑦ 외부 API | — | 유료 비전은 이미 GPT-6 Luna. 같은 평가셋으로 로컬 조합과 비교 |

## 6. 진행 중인 확인 (결과가 나오면 이 절을 갱신)

- **`w/dev` 슬라이드 전환 판정 실측:** 우리의 재생 시퀀스(판서 추가·지움·전환, 실제 강의 화면 3장, 흰 화면 → 슬라이드)를 `w/dev` 판정의 OCR 모드와 비전 모드(실시간·백그라운드 설정)에 넣어 본다.
- **v2 검증 체계 점검:** 2단계에서 찾은 문제가 v2에도 있는지 본다.
  - 정상 문장 오탐(`Graph theory` 제목, `|x|`, `$5…$10`)
  - OCR 오독 통과(`x = 12`, 첨자 소실)
  - 예전 노트·패키지 복원
  - 실제 근거 모양
  - 텍스트만으로 도식을 만드는 경로(B03 지도)

## 7. 결정이 필요한 것

1. **작업 기반:** `w/dev`에서 새 브랜치를 따서 부품을 옮길지(권장), `b/visual-suppression`에 `w/dev`를 병합할지.
2. **판서 표현:** SlideDoc의 `role:"annotation"` 추가(계약·서버 동시 배포)와 판서 전용 SlideDoc 중 무엇으로 할지. Kiwook과 합의가 필요하다.
3. **3단계 후보와 모델 크기 상한:** 앞서 질문한 그대로다.
4. **`note-pipeline.html` 공유:** 아직 푸시되지 않았다면 올려 주면 이 문서와 대조한다.
