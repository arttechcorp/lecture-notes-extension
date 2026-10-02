# 노트 계약 v1: 노트 양식 v3를 파이프라인 v2에 연결

작성 2026-10-02 · 브랜치 `w/dev` (기준 HEAD `8ba723b`) · 실행 계약: `lib/note-contract.js` · 합성 fixture: `tools/note-fixture/`

이 문서는 `docs/note-format-study-2026-10-02/`의 노트 양식 v3(내용 구조와 시안)를 파이프라인 v2의 Note 스펙으로 바꾼 **실행 가능한 계약**이다. 계약의 원본은 `lib/note-contract.js`이며 이 문서와 어긋나면 코드와 테스트를 기준으로 고친다. 디자인 시안은 실제 강의 검증이나 브라우저 검증을 마친 결과물이 아니다. 이 계약도 합성 fixture로만 검증했다.

---

## 0. 한눈에 보기

- **블록 18종은 내용 타입이고, P01–P06은 조판 예시다.** 모델은 B타입의 텍스트 슬롯만 채운다. 페이지 수는 내용에서 결과로 나오며 6쪽으로 고정하지 않는다.
- **블록마다 다른 슬롯을 `oneOf` 없이 검증한다.** Planner가 섹션별 블록 타입을 먼저 정하고, 코드가 그 계획에서 섹션별 출력 스키마(`blockId → 타입별 슬롯`)를 만든다. 모든 B 슬롯을 하나의 거대한 nullable 객체로 늘어놓지 않는다.
- **검증 단위는 주장(Claim)이다.** 주장 하나는 `{text, evidenceIds, basis}`이다. 근거 종류(`basis`)는 다음 셋 중 하나이고, 종류마다 숫자 검사 규칙이 다르다.
  - `lecture`: 강의 근거가 있는 주장.
  - `derived`: 코드가 검산한 계산값을 쓰는 주장.
  - `pedagogical`: 교육용 거짓 문장.
- **가상 사례와 강의 밖 보강은 꺼져 있다.** `POLICY`는 동결된 `false`다. v1 스키마에는 `synthetic` 같은 값 자체가 없어서 모델이 만들 수 없다. 켜려면 계약 버전을 올리고 사용자 승인을 받아야 한다.
- **근거는 줄 단위 ID로 원본까지 거슬러 간다.** `U3.s2`는 슬라이드 블록, `U3.t5`는 발화 세그먼트, `U3.g1`은 도표다. 입력 `unitId`와 출력 `sectionId`·`blockId`는 분리한다.
- **코드가 맡는 것:**
  - 블록·문항·Point의 ID와 표시 번호
  - B01(머리), B15(답안 투영), B16(필기란), 시스템 B17(처리 고지)
  - 계산 검산과 의존 정리(prune)
  - 고지 생성

---

## 1. 기준 문서와 적용 경계

| 분야 | 기준 | 쓰지 않는 것 |
|---|---|---|
| 실행·저장·동의·대체 경로 | `docs/architecture-v2.md` §§5.4, 6.5–6.7, 8, 11, 14, 15, 20 | — |
| 내용·교육 규칙 | `proposal.md` §§3–8, 11–12, 14 | §13의 v1 최소 적용 제안, §9.2의 구형 색상(산호·보라·청록 단계색) |
| 시각 규격 | `page-design-spec.md`, `assets/brand-tokens.json` | `assets/note.css`의 구형 색 변수(`--teal`·`--plum` 등) |
| 마크업 예시 | `assets/templates.html`(B01–B18), `assets/page-templates.html`(P01–P06) | 고정 지면용 `@page{margin:0}` + 고정 높이 지면(자동 흐름 조판에는 맞지 않음, §15) |
| 인계 | `claude-code-handoff.md` | 이 문서 작성 시점보다 오래된 구현 상태 표(§3) |

- `manifest.version: "3.0"`은 에셋 버전이다. 노트 계약 버전과 무관하다.
- `examples.json`은 예시 분류일 뿐이다. 입력 → 계획 → 노트 fixture가 아니다.
- **실행 fixture는 `tools/note-fixture/`의 직접 작성한 합성 자료**다. 실제 강의 전사, 슬라이드, 생성 노트는 저장소에 넣지 않는다.

## 2. 현재 구현과의 대조 (HEAD `8ba723b`, 2026-10-02 19시 확인)

인계 메모(`bc85a8b` 기준) 뒤로 클라우드 세션이 커밋 25개를 더 올렸다. 아래가 실제 상태다.

| 위치 | 현재 | 이 계약으로 바뀌는 것 |
|---|---|---|
| `lib/note-spec.js` | 자리표시. 블록 타입은 `text` 하나뿐이고, `NOTE_SPEC_VERSION = "placeholder-0"` | Phase 6-2에서 `NoteContract`를 읽어 슬롯 이름(`planSchema` 등)을 내보내도록 교체 |
| `server/prompts.js` | 단계별 **정적** 출력 스키마. section 요청은 `Unit` 문자열(slideText·speech)을 그대로 씀 | 섹션·repair 출력 스키마를 계획에서 **요청마다 생성**. 요청에 근거 항목(§5)을 실음 |
| `server/index.js` | 제공자 스키마를 단계별로 한 번만 계산(`NOTE_PROVIDER_SCHEMA`). 검증 전용 키워드는 제거 | 섹션·repair는 요청마다 `providerSchema(outputSchema(stage, body))` 계산. 나머지 흐름은 그대로 |
| `lib/stages.js` | 블록을 `evidenceIds`를 가진 불투명 객체로 취급. repair는 index 기준. 잘림이 나면 유닛과 블록을 반으로 나눔 | 계획 정규화, 섹션 검증, repair(blockId 기준), 조립·의존 정리를 `NoteContract`에 위임. 잘림이 나면 **블록만** 나눔(§12.4) |
| `lib/verify.js` | 블록 단위 `evidenceIds`, 숫자, 유도식, 재타이핑, 원문 재현, 커버리지 검사 | 주장 단위 검사는 `NoteContract`로 옮김. `numbersOf`와 원문 재현 창은 재사용(`verbatimIds` 추가 — 완료, `2841ad5`). T5 `checkSupport`는 유지 |
| `lib/note-render.js` | 수식 표시: 검증됨이면 KaTeX, 아니면 크롭, 둘 다 없으면 OCR 텍스트에 "미검증". 크롭 src는 허용 목록으로 제한 | 표시 결정은 `NoteContract.displayOf`(§14)를 따름. 크롭이 없으면 "확인 필요" |
| `lib/preprocess.js` `buildIR` | Unit에는 문자열만 있고 원 블록·세그먼트 ID가 없음 | 완료(`2841ad5`): 줄 단위 `evidence` 인덱스를 함께 반환(§5) |
| `lib/formulas.js` | `verified` = KaTeX 파싱 + OCR 숫자 대조. 부호·변수의 의미 검증은 하지 않음 | 그대로. KaTeX 통과는 문법 검증일 뿐이라는 점을 계약에 명시(§14) |
| 도표 | `SlideDoc.figures`는 있지만 레지스트리·크롭(§6.7)은 아직 없음 | 계약은 ID(`G#`)와 표시 규칙만 고정. 구현은 Phase 6-6 |
| `lib/contracts.js` | 허용 키워드 14종. `oneOf`·`anyOf`·`$ref` 없음. strict: 전 속성 required, `additionalProperties:false`, 생략은 `orNull` | `evidenceItem` 스키마 추가(완료). `orNull`이 enum에도 null을 넣도록 고침(기존 스키마 영향 없음). 검증 키워드는 늘리지 않음 |

## 3. 핵심 설계 결정

1. **타입별 스키마는 계획이 고르고, 공통 봉투는 코드가 검증한다.**
   - 섹션 Writer의 출력은 `{gist, blocks:{"S2_B1": 봉투|null, …}, checks:[…]}`다. `blocks`의 키는 계획에 있는 blockId와 정확히 같다.
   - 키마다 그 블록 타입의 슬롯 스키마가 붙는다. 그래서 `oneOf` 없이도 이종 블록을 strict 스키마로 받을 수 있다.
   - 서버와 클라이언트는 같은 함수 `sectionOutputSchemaFor(planSection)`로 같은 스키마를 만든다.
   - 기각한 대안:
     - 정적 18배열 스키마: 모든 요청에 큰 스키마가 실리고 빈 배열 18개를 늘 출력해야 한다.
     - 거대 nullable 객체: 인계 메모가 피하라고 한 방식이다.
2. **주장(Claim)이 최소 검증 단위다.** 블록 전체에 근거 하나를 붙이고 무관한 주장을 넣는 것을 막는다(`proposal.md` §11.2). 표의 셀, 논증 단계, 해설도 각각 주장이다.
3. **근거 ID는 줄 단위이고 입력 Unit에 묶인다.** `U3.s2`를 보면 유닛, 출처 종류, 순번을 알 수 있다. 근거 인덱스는 원 `slideId`·`blockId`·`segmentId`·시각을 갖는다. 문자열로 합친 IR에서는 이 대응을 복원할 수 없다.
4. **ID·번호·답안 투영은 코드가 맡는다.**
   - 모델은 blockId를 지어내지 않는다. 계획을 정규화할 때 코드가 위치로 부여한다.
   - Point·문항 ID는 배열 위치에서 계산한다.
5. **정책 상수는 동결한다.** `POLICY = {externalAugmentation:false, syntheticExamples:false}`. Plan과 Note는 이 값을 `const:false` 스키마로 싣는다.
6. **버전 넷을 분리한다**(§13): `schemaVersion`(데이터 구조), `noteSpecVersion`(생성·검증 계약), `promptVersion`(프롬프트), `designVersion`(템플릿·CSS·SVG).

## 4. ID 체계

| ID | 형식(정규식) | 소유자 | 예 | 표시 |
|---|---|---|---|---|
| unitId | `^U[0-9]{1,4}$` | 코드(`buildIR`) | `U3` | 표시 안 함 |
| evidenceId | `^U[0-9]{1,4}\.[stg][0-9]{1,4}$` | 코드(`buildIR` evidence) | `U3.s2`·`U3.t5`·`U3.g1` | 근거 위치(시각)로 표시 |
| formulaId | `^F[0-9]{1,6}$` | 코드(`Formulas.buildRegistry`) | `F12` | 본문의 `{{F12}}` |
| figureId | `^G[0-9]{1,4}$` | 코드(도표 레지스트리, Phase 6-6) | `G3` | "도표 3" |
| cropId | formulaId 또는 figureId와 같음 | 코드(패키지 `blobs`) | `F12`·`G3` | — |
| conceptId | `^C[0-9]{1,3}$` | Planner(코드가 검증) | `C4` | 표시 안 함 |
| sectionId | `^S[0-9]{1,3}$`. 계획 순서대로 `S1..Sn` | Planner(코드가 순서 검증) | `S2` | "02" |
| blockId | `^S[0-9]{1,3}_B[0-9]{1,2}$`, 전역은 `^GB[0-9]$` | 코드(계획 정규화, 위치 기준) | `S2_B3`·`GB1` | 표시 안 함 |
| 계산 참조 | `{blockId}.i{n}` 입력, `{blockId}.c{n}` 단계 | 코드(위치 기준) | `S2_B3.c2` | "계산 2" |
| Point | `{blockId}/P{n}` (= 단원/사례/point 번호) | 코드(위치 기준) | `S2_B4/P1` | 사례 안에서는 "Point 1", 밖에서는 "사례 02 · Point 1" |
| 문항 | `{blockId}/Q{n}` | 코드(위치 기준, 최종 노트 기준) | `S2_B5/Q1` | 문서 전체 일련번호 "문항 3" |
| 답안 | 문항 ID에 1:1(별도 ID 없음) | 코드(B15 투영) | — | "3번 해설" |
| 확인 항목 | `{sectionId}_K{n}` | 코드(위치 기준) | `S2_K1` | — |
| 고지 | `NOTE_*` 코드 | 코드 | `NOTE_ITEMS_PRUNED` | 한국어 평문 |

- **대상 ID(TargetId)**: 문항·명제·결론이 가리키는 ID. sectionId, blockId, conceptId, Point ID 중 하나다. 형식은 `^(S[0-9]{1,3}|S[0-9]{1,3}_B[0-9]{1,2}|GB[0-9]|C[0-9]{1,3}|S[0-9]{1,3}_B[0-9]{1,2}/P[1-6])$`. Point 번호는 1부터다.
- **근거 참조(Ref)**: 주장의 `evidenceIds`에 쓰는 값. 근거 항목 ID이거나 검산된 계산 참조다. 형식은 `^(U[0-9]{1,4}\.[stg][0-9]{1,4}|(S[0-9]{1,3}_B[0-9]{1,2}|GB[0-9])\.[ic][0-9]{1,2})$`.
- **표시 번호는 최종 노트에서 코드가 다시 매긴다.** 단원 번호는 계획 순서를 따르므로, 실패한 섹션이 있어도 뒤 섹션 번호는 바뀌지 않고 빈 번호는 고지로 설명한다. 문항 번호는 살아남은 문항만 일련번호로 매긴다.
- 위치 기반 ID(Point·문항·확인 항목)는 **콘텐츠 안에 저장하지 않는다.** 최종 노트에서 계산한다. 정리 단계에서 빠진 항목의 기록(`pruned`)에만 정리 전 위치 ID를 남긴다.

## 5. 근거 인덱스 (EvidenceItem)

`Preprocess.buildIR(slides, segments)`는 기존 `{schemaVersion, units, stats}`에 `evidence`를 더해 돌려준다. 유닛 묶음(정렬·점진 판서 병합)은 IR과 같은 계산을 쓰고, 유닛 순서대로 근거 항목을 만든다.

```text
EvidenceItem = { id: evidenceId, unitId, kind: e[slide, speech, figure], t0: num≥0, t1: num≥0,
                 slideId: s(64)?, sourceId: s(64), role: e[title, body, header, footer, watermark, page_number, figure_label]?, text: s(4000) }
```

| kind | 만드는 방법 | `sourceId` | 시각 |
|---|---|---|---|
| `slide` | 병합된 슬라이드의 사용 가능 블록(걸러지지 않았고 글자가 있음)을 `slideText`와 같은 순서(제목 → 나머지, 읽기 순서)로 한 줄씩 | 블록 id | 슬라이드 `t0`·`t1`(`t1`이 없으면 유닛 `t1`) |
| `figure` | 슬라이드 `figures` 중 `decorative`·`photo`를 뺀 것. 텍스트 = 제목, 행마다 셀을 ` \| `로 이은 줄, 차트 요약. 4000자에서 자름 | 도표 id | 슬라이드 시각 |
| `speech` | 유닛의 유지된 세그먼트를 `cleanSpeech`한 결과가 빈 문자열이 아닐 때 | 세그먼트 id | 세그먼트 `t0`·`t1` |

- **불변식(테스트로 고정):**
  - 유닛의 `slideText`는 그 유닛 `slide` 항목 텍스트를 `"\n"`으로 이은 것과 같다.
  - 유닛의 `speech`는 `speech` 항목 텍스트를 `" "`로 이은 것과 같다.
- 걸러진 블록(`selection:"filtered"`, 예: 학번 워터마크)은 근거가 되지 않는다. 노트로 새어 나갈 경로가 없다.
- **화자는 기록하지 않는다.** 화자 분리가 없어서 교수·학생 발언을 구분할 수 없다. Writer 규칙: 발화는 "강의에서"로만 귀속하고, 학생 질문을 공지나 결론으로 승격하지 않는다(§18 열린 결정).
- Writer에는 섹션 유닛의 근거와, Planner가 허용한 교차 유닛(`crossUnitIds`)의 근거만 보낸다. Global Writer는 근거 원문 대신 검증된 섹션 블록을 받는다.

## 6. 주장(Claim)과 근거 종류

```text
Claim = { text: s(600), evidenceIds: [Ref](0..8), basis: e[lecture, derived, pedagogical] }
```

| 출력 종류 | basis | 근거 요구 | 숫자 검사 | 허용 위치 |
|---|---|---|---|---|
| 강의의 사실·수치 | `lecture` | 근거 항목(`U…`) 1개 이상 | 숫자는 인용한 근거 항목 텍스트와 인용한 계산값 안에 있어야 한다 | 모든 주장 슬롯 |
| 계산 결과 | `derived` | 계산 참조(`…cN`·`…iN`) 1개 이상, 검산 통과한 것만 | 위와 같음. 검산된 값만 허용된다 | 모든 주장 슬롯 |
| 교육용 거짓 문장 | `pedagogical` | 없어도 됨(빈 배열 허용) | 검사하지 않는다(의도적으로 틀린 문장) | B14 OX 문항의 `prompt` 중 정답이 `X`인 것, B11 `misconception` 중 `origin: structural_check`인 것 |
| 가상 사례 | (v1에 없음) | — | — | v1 스키마 밖. 켜려면 §18 |
| 강의 밖 보강 | (v1에 없음) | — | — | v1 스키마 밖 |
| 번호·날짜·처리 정보 | 주장이 아님 | 코드가 만들거나 메타데이터 출처 | 검사 대상이 아님 | B01·B04 번호·고지 |

- **숫자 추출은 `Verify.numbersOf`를 그대로 쓴다.**
  - 천 단위 쉼표와 한글 배수는 수치로 맞춘다. "300만" = 3,000,000.
  - 한 자리 정수는 열거("2가지")로 보고 건너뛴다.
  - 근거 쪽은 한 자리 수까지 전부 모은다.
  - `{{F12}}`의 숫자는 수식 id라서 먼저 지운다.
- **주장이 아닌 문자열 슬롯도 블록 단위로 검사한다.** 제목, 라벨, 기호, 단위, 대안, 기한, 인용문, 자료명, 원어가 여기에 해당한다. 이 슬롯의 숫자는 그 블록이 인용한 모든 근거와 그 블록의 검산값 안에 있어야 한다. 제목에 "1937년" 같은 외부 사실을 끼워 넣는 우회를 막는 장치다.
- 블록의 `status` 하나로 안의 모든 문장을 예외 처리하지 않는다. 오답, 정정, 해설이 섞인 블록도 주장마다 따로 검사한다.
- **정정**: 섹션 확인 항목(B17)의 `kind: correction`은 `before`·`after` 두 주장이 모두 `lecture`다.
  - `before`가 인용한 근거 항목은 **대체된 근거**가 된다.
  - 다른 주장이 대체된 근거를 인용하면서 `after`의 근거를 함께 인용하지 않으면 `VAL_SUPERSEDED`다. 이렇게 오래된 수치가 표시 없이 남는 것을 막는다.
- **정정 감지는 모델이 한다.** 코드는 선언된 정정 관계의 일관성만 강제한다. 감지 누락은 T5 근거 지지(유료)와 사람 검수의 몫이다.

## 7. 계산 계약 (B10)

```text
inputs: [{ label: s(60), value: num, unit: s(16)?, evidenceIds: [evidenceId](1..4) }](0..10)
steps:  [{ label: s(60), op: e[add, sub, mul, div], a: LocalRef, b: LocalRef, value: num, unit: s(16)?, digits: int(0..6)? }](0..8)
LocalRef = ^[ic][0-9]{1,2}$     # i1 = inputs[0], c1 = steps[0]. 단계는 앞선 단계만 참조
```

`checkCalc`는 모델이 준 표현식을 `eval`하지 않는다. 허용된 연산 4종을 숫자 피연산자에 직접 적용한다.

| 검사 | 규칙 | 실패 코드 |
|---|---|---|
| 입력 근거 | `value`가 인용 근거의 숫자 집합 안에 있어야 한다("300만 원" → 3,000,000) | `VAL_CALC_INPUT_UNSUPPORTED` |
| 참조 | `a`·`b`가 존재하는 입력이거나 **앞선** 단계여야 한다 | `VAL_CALC_REF` |
| 분모 0 | `div`의 `b`가 0이면 실패 | `VAL_CALC_DIV_ZERO` |
| 값 | 계산값과 `value`의 차이가 0.5×10^−digits 이하(`digits`가 null이면 상대 오차 1e−9 이하)여야 한다. 다음 단계는 앞 단계의 **기재값**으로 계산한다(사람이 반올림한 값으로 이어 계산하는 방식) | `VAL_CALC_MISMATCH` |
| 단위 | `add`·`sub`는 두 피연산자의 단위가 같아야 하고 결과 단위도 같아야 한다. 단 `%`−`%`의 결과는 반드시 `%p`이고, `%`+`%`의 결과는 `%`다. `mul`·`div`의 결과 단위는 검사하지 않는다(ponytail: 단위 대수는 필요해지면 추가) | `VAL_CALC_UNIT` |
| 보류 | `withheld`가 null이 아니면 `steps`는 비어 있어야 한다. 분모 0, 단위 불일치, 가정 누락, 인식 충돌이 있으면 계산을 멈추고 이유를 적는다 | `VAL_CALC_WITHHELD` |

- 검산을 통과한 입력·단계 값만 `{blockId}.iN`·`{blockId}.cN` 참조로 쓸 수 있다.
- 섹션 Writer는 같은 섹션 안의 계산을 참조할 수 있다. 예: B14 계산 문항의 해설.
- Global Writer는 살아남은 모든 섹션의 계산을 참조할 수 있다. 섹션끼리 서로의 계산을 참조할 수는 없다. 병렬로 작성되어 서로를 보지 못하기 때문이다.
- 퍼센트·퍼센트포인트 혼동, 회계이익과 현금흐름의 치환, 표에 없는 숫자로 그래프를 만드는 일은 프롬프트 규칙으로 막는다. 숫자 검사도 이 경우 근거에 없는 숫자를 걸러낸다.

## 8. 계약 4종

### 8.1 NoteSpec (`lib/note-contract.js`가 내보내는 것)

| 이름 | 뜻 |
|---|---|
| `NOTE_SPEC_VERSION = "lecture-note-1"` | 생성·검증 계약 버전. 바뀌면 E~H를 다시 실행한다. 서버와 확장을 함께 배포한다(서버는 409 `note_spec_mismatch`) |
| `NOTE_SCHEMA_VERSION = 1` | Note 데이터 구조 버전. 패키지 마이그레이션 기준 |
| `POLICY` | `{externalAugmentation:false, syntheticExamples:false}`. 동결 |
| `TYPES` | B01–B18 메타: `writer`(code·planner·section·global), 계획 가능 위치, 권장량(§9) |
| `SECTION_TYPES` / `GLOBAL_TYPES` | 섹션에서 계획 가능: B03, B05–B14, B18. 전역에서 계획 가능: B02, B03, B13 |
| `IDS` | §4의 정규식 |
| `schemas`, `envelopeSchema(type)` | `claim`, `content[B02..B18]`, `check`, `plannerOutput`, `plan`, `note`. 근거 항목 스키마는 공용 계약 `Contracts.SCHEMAS.evidenceItem` |
| `sectionOutputSchemaFor(planSection, {blockIds, gist})`, `globalOutputSchemaFor(planGlobal)`, `repairOutputSchemaFor(planSection, blockIds)` | 요청별 Writer 출력 스키마. 모두 `Contracts.isStrictCompatible`을 만족한다 |
| `normalizePlan`, `checkCalc`, `validateSection`, `validateGlobal`, `assembleNote`, `displayOf`, `citedRefs` | §10–§14의 코드 검사·조립. `validateSection({plan, sectionId, output, evidence, registry, formulaUnits, figures, katex, superseded})` → `{ok, errors, gist, blocks:[{id, type, envelope, errors}], checks, calc, cited}`. `assembleNote({plan, sections:[{sectionId, output}], global, units, evidence, registry, formulaUnits, figures, crops, meta, tier, systemNotices, promptVersion, katex})` → Note |
| (권장량) | 전송 상한은 스키마의 `maxLength`·`maxItems`이고, 편집 권장량은 `TYPES[*].advice`에 둔다. 토큰 예산 `limits`(Planner 입력 40k, Writer 입력 12k·출력 4k)는 지금처럼 슬롯(`lib/note-spec.js`)이 내보낸다(Phase 6-2) |

- **권장량과 전송 상한은 다르다.**
  - 권장량을 넘으면 경고(`advisories`)와 조판 힌트를 낸다. 내용은 자르지 않는다.
  - 전송 상한은 스키마 위반이다. 스키마 위반은 repair 1회를 거친 뒤 제외한다.

### 8.2 PlannerOutput → Plan

Planner(모델)의 출력 스키마는 다음과 같다(strict).

```text
PlannerOutput = {
  concepts: [{ conceptId, name: s(60), homeSectionId: sectionId, depth: e[defined, mentioned] }](0..40),
  sections: [{ sectionId, title: s(80), question: s(160)?, stage: e[understand, relate, apply, check],
               unitIds: [unitId](1..60), crossUnitIds: [unitId](0..10),
               blocks: [{ type: e[SECTION_TYPES], purpose: s(200), conceptIds: [conceptId](0..6),
                          formulaIds: [formulaId](0..6), figureIds: [figureId](0..3) }](1..12) }](1..40),
  global: [{ type: e[GLOBAL_TYPES], purpose: s(200), conceptIds: [conceptId](0..6) }](0..3)
}
```

`normalizePlan(output, {units, formulaUnits, figures})`는 다음을 검사한 뒤 `Plan`을 만든다.

`Plan`은 PlannerOutput의 각 블록에 `blockId`를 붙이고, `schemaVersion`, `noteSpecVersion`, `policy`를 더한 것이다. 검사를 하나라도 통과하지 못하면 작업은 `VAL_PLAN_INVALID`로 실패한다. temp 0이라 같은 계획을 다시 요청해도 소용없다(기존 동작).

| 검사 | 코드 detail |
|---|---|
| 스키마 | `schema:<경로>` |
| 모든 유닛이 정확히 한 섹션에 속하고, 섹션이 비어 있지 않고, 모르는 유닛이 없다 | `missing:U3`·`duplicate:U3`·`unknown:U9`·`empty:S2` |
| 섹션 id가 `S1..Sn` 순서이고, 각 섹션의 유닛이 IR 순서로 **연속**하며, 섹션끼리 시간순이다(강의 전개를 바꾸지 않음) | `order:S3` |
| `crossUnitIds`는 아는 유닛이고, 자기 섹션 유닛과 겹치지 않는다 | `cross:S2:U1` |
| 개념 id 중복 없음. 홈 섹션이 존재함. 블록이 참조하는 개념이 존재함 | `concept:C4` |
| `defined` 개념은 홈 섹션에 그 개념 **하나만** 다루는 B05가 정확히 하나 있다(정의의 단일 기준 위치) | `home:C4` |
| `formulaIds`는 그 섹션 유닛(교차 포함)에 나온 수식이고, `figureIds`는 그 유닛의 도표다 | `ref:S2:F12` |
| B12(곁설명)는 섹션의 첫 블록이 될 수 없다(앞 블록에 붙음) | `side:S2_B1` |
| 단원 제목·질문과 개념 이름에 쓴 숫자는 그 섹션(개념은 홈 섹션) 유닛의 슬라이드·발화에 있어야 한다. B04 머리로 그대로 노출되는데 Writer 검사를 거치지 않기 때문이다 | `number:S2`·`number:C4` |
| 전역 타입은 각각 최대 1개 | `global:B02` |

### 8.3 SectionDraft — 섹션 Writer 출력

```text
SectionOutput = { gist: C?, blocks: { "<blockId>": Envelope | null, ... 계획의 blockId 전부 }, checks: [Check](0..6) }
Envelope      = { status: e[supported, uncertain, conflicting, corrected], importance: e[core, supporting, reference],
                  emphasis: [{ kind: e[stress, exam], evidenceIds: [evidenceId](1..3) }](0..2), content: <타입별 슬롯 §9> }
Check (B17)   = { kind: e[recognition_uncertain, input_conflict, missing, correction], claim: C,
                  targetIds: [blockId](0..4), before: C?, after: C?, hold: C? }
```

- 블록 값이 `null`이면 Writer가 **작성을 보류**한 것이다. 근거가 부족해 계획한 블록을 정직하게 비운 경우다. 코드는 이를 제외(`VAL_BLOCK_DECLINED`)로 기록하고 의존 정리를 돌린다.
- `gist`(단원 요지 1문장)는 B04 헤더의 한 칸이다. 섹션을 반으로 나눠 다시 쓸 때는 첫 반쪽 요청에만 넣는다.
- `checks`는 Writer가 작성 중 발견한 확인 필요·정정이다. 계획 단계에서는 충돌을 미리 알 수 없어서, 계획 블록이 아니라 항상 쓸 수 있는 칸으로 둔다.
- `SectionDraft`(코드 내부 표현)는 `{sectionId, gist, blocks:[{id, type, envelope}], checks}`이다. 블록은 **계획 순서**를 따르며, 병렬 작업이 끝난 순서와는 무관하다.
- **repair 출력**은 `{ blocks: { "<실패 blockId>": Envelope | null } }`이다. 실패한 블록만 키로 갖는다.

### 8.4 GlobalDraft — 전역 Writer 출력

```text
GlobalOutput = { blocks: { "GB1": Envelope | null, ... 계획의 전역 blockId 전부 } }    # 타입: B02·B03·B13
```

- 입력은 검증을 통과하고 정리까지 마친 섹션 블록이다. 근거 원문은 다시 보내지 않는다.
- 전역 주장의 근거 참조는 **살아남은 섹션 블록이 이미 인용한 참조**의 부분집합이어야 한다. 새 근거 ID를 만들면 `VAL_GLOBAL_EVIDENCE_NEW`다. 검산 참조는 살아남은 모든 섹션의 B10에서 찾을 수 있다.

### 8.5 Note

```text
Note = {
  schemaVersion: const 1, noteSpecVersion: const "lecture-note-1", promptVersion: s(32)?,
  status: e[complete, partial], tier: e[free, paid],
  policy: { externalAugmentation: const false, syntheticExamples: const false },
  meta: { title: s(200)?, course: s(200)?, lectureDate: s(40)?, session: s(40)?, lang: s(16), generatedAt: s(40), processed: { t0, t1 } },
  concepts: [{ conceptId, name, depth, homeBlockId: blockId? }],
  global:   [Block](0..3),                       # B02 → B03 → B13 순
  sections: [{ sectionId, number: int≥1, title, question: s?, stage, unitIds, range: { t0, t1 }, gist: C?, blocks: [Block](1..12), checks: [Check] }],
  registry: [{ id: formulaId, latex: s?, text: s?, status, slideId, t0, display: e[latex, crop, check] }],
  figures:  [{ id: figureId, evidenceId, kind, title: s?, cells: [[s]]?, t0, display: e[crop, check] }],   # 표 재조판(table)은 θ가 정해진 뒤 추가(§14)
  sources:  [{ id: evidenceId, kind, t0, t1, slideId: s? }],          # 인용된 근거의 위치만. 텍스트 없음
  notices:  [{ code, count: int?, ids: [s]?, ranges: [{ t0, t1 }]? }],
  dropped:  [{ blockId, type, codes: [code](1..8) }],                 # 내용 없음
  pruned:   [{ id, codes: [code](1..4) }],                            # 정리 전 위치 ID, 내용 없음
  advisories: [{ code, id }]                                          # 조판 힌트
}
Block = { id: blockId, type, sectionId: sectionId?, status, importance, emphasis, content }   # content는 type으로 검증
```

- Note 봉투는 스키마로 검증하고, `content`는 `type`에 맞는 슬롯 스키마로 코드가 검증한다. 이종 배열을 `oneOf` 없이 처리하는 방식이다.
- Note는 공급자에게 보내지 않으므로 strict 호환은 필요 없다. 다만 키 생략 대신 `null`과 빈 배열을 쓴다는 규칙은 같다.
- **B15·B16·B01·시스템 B17은 Note에 저장하지 않는다.** 렌더 시점에 Note에서 투영한다. 그래서 답안 공개 방식과 필기란 여부는 Note의 사실 내용을 바꾸지 않는다.
- `status`는 실패한 섹션, 녹화 공백, 제외된 블록 중 하나라도 있으면 `partial`이다. 처리 누락이 있는 노트를 완전한 노트로 표시하지 않는다(`proposal.md` §14.1).
- **시스템 상태와 콘텐츠 상태를 분리한다.**
  - 시스템 상태: `status`, `notices`, `dropped`, `pruned`.
  - 콘텐츠 상태: 블록 `status`와 섹션 `checks`.

## 9. B01–B18 슬롯

표기:
- `s(n)` = 1~n자 문자열
- `?` = null 허용
- `C` = 주장
- `[X](a..b)` = 배열 길이 범위

슬롯 규칙:
- null은 "강의에서 확인되지 않음 / 해당 없음"을 뜻한다. 빈 배열은 "항목 없음"을 뜻한다.
- 빈 문자열로 미확인을 표현하지 않는다. 필수 문자열은 최소 1자다.
- 렌더러는 null 슬롯과 빈 배열 슬롯을 그 여백까지 함께 생략한다.

| B | 작성 | 위치 | 슬롯 (전송 상한) | 권장량 (편집 기본값, 경고만) | 코드 검사 |
|---|---|---|---|---|---|
| B01 강의 머리 | 코드 | 문서 | `meta`, `status`, 처리 범위, 생성일(강의일과 별도) | 제목 1–2줄, 메타 2줄 | 입력에 없는 날짜·교수·학교는 만들지 않는다 |
| B02 한눈에 | 전역 | 문서 | `question: C?`, `mode: e[conclusions, issues]`, `items: [{claim: C, reason: C?, targetIds: [TargetId](1..4)}](1..3)` | 항목 80–180자 | 대상이 살아 있어야 한다(아니면 항목 정리). 탐색적 토론은 `issues` |
| B03 강의 지도 | 전역 또는 섹션 | 문서·단원 | `title: s(80)`, `nodes: [{key: ^n\d{1,2}$, label: s(40), targetId?}](2..12)`, `edges: [{from, to, relation: e[includes, part_of, example_of, precedes, contrasts, causes, supports, complements], claim: C?}](1..16)` | 노드 3–7 | 끝점이 실재하는 노드여야 한다(`VAL_MAP_REF`). `causes`·`supports`는 근거 있는 주장이 필수(`VAL_MAP_EDGE_UNSUPPORTED`) |
| B04 단원 헤더 | Planner + 섹션 + 코드 | 단원 | 번호·근거 범위는 코드, `title`·`question`·`stage`는 Planner, `gist: C?`는 섹션 Writer | 제목 15–40자, 요지 40–100자 | 헤더만 쪽 아래에 남기지 않는다(§15) |
| B05 개념 설명 | 섹션 | 단원 | `conceptId`, `term: s(60)`, `original: s(80)?`, `definition: C`, `explanation: C?`, `mechanism: C?`, `scope: [C](0..4)`, `examples: [C](0..3)` | 120–300자, 복잡하면 ≤600 | 계획한 개념과 같아야 한다(`VAL_CONCEPT_REF`). `original`은 인용 근거에 실제로 나와야 한다(`VAL_ORIGINAL_UNSUPPORTED`) |
| B06 공통 축 비교 | 섹션 | 단원 | `title`, `entities: [{label: s(40), conceptId?}](2..6)`, `criteria: [{label: s(40), cells: [C?](2..6)}](1..12)`, `common: [C](0..4)`, `discriminator: C?` | 대상 2–3, 기준 3–6, 셀 1–3문장 | `cells` 길이 = `entities` 길이(`VAL_TABLE_SHAPE`). 셀이 전부 null인 행은 금지(`VAL_TABLE_EMPTY_ROW`). null 셀은 "강의에서 확인되지 않음" |
| B07 논리 연결 | 섹션 | 단원 | `title`, `relationType: e[causal, argument, process, history]`, `question: C?`, `steps: [{role: e[premise, value_premise, evidence, reason, claim, counter, condition, step, event, result], claim: C}](2..8)`, `missingLinks: [C](0..3)` | 3–5단계 | 사실 근거(`evidence`)와 규범 전제(`value_premise`)는 다른 칸. 생략된 추론은 `missingLinks`에 적고 "연결 설명 확인 필요"로 표시 |
| B08 사례와 적용 | 섹션 | 단원 | `caseTitle`, `source: e[lecture_case, material_case]`, `situation: C`, `points: [{clue: C, reading: C}](1..6)`, `appliedConceptIds`, `judgment: {pointRefs: [int 1..6](1..6), claim: C}?`, `limits: [C](0..3)`, `decision: {actor: C?, goal: C?, alternatives, criteria, tradeoffs, missingData}?` | 사례 80–180자, 해석 120–300자 | `pointRefs` ≤ `points` 수(`VAL_POINT_REF`). 단서 없는 Point는 구조상 만들 수 없다(단서와 해석이 한 쌍) |
| B09 자료 읽기 | 섹션 | 단원 | `sourceTitle: s(120)`, `sourceKind: e[text, historical, philosophical, literary, data, other]`, `gist: C`, `quote: {text: s(150), evidenceIds: [evidenceId](1..2)}?`, `points: [{clue, reading}](0..6)`, `authorClaim: C?`, `lecturerReading: C?`, `limits: [C](0..3)` | 인용은 꼭 필요한 짧은 구절만 | `quote`는 인용 근거에 글자 그대로 있어야 한다(`VAL_QUOTE_NOT_FOUND`). 저자 주장과 교수 해석은 다른 칸 |
| B10 수식·표·그래프 | 섹션 | 단원 | `title`, `kind: e[formula, table, graph, calc]`, `goal: C?`, `formulaIds`, `figureIds`, `variables: [{symbol: s(40), meaning: C, unit?}](0..10)`, `assumptions`, `inputs`·`steps`(§7), `derived: [s(400)](0..4)`, `reading: [C](0..6)`, `result: C?`, `limits`, `withheld: C?` | 식은 독립 행, 계산은 단계 | §7 검산. `derived`는 KaTeX 검증(`VAL_DERIVED_INVALID`)과 재타이핑 검사. 원본 수식은 `formulaIds`와 `{{F#}}`로만 가리킨다. `figureIds`는 본문에서 다루는 도표다(배치는 계획 블록의 `figureIds`, §14) |
| B11 헷갈리기 쉬운 점 | 섹션 | 단원 | `misconception: C`, `correction: C`, `conditions: [C](0..3)`, `origin: e[lecture_correction, structural_check]` | 단원당 0–2 | `structural_check`는 "구분 점검"으로 표시하고, 오해 문장만 `pedagogical`을 허용한다. `correction`은 근거가 필수 |
| B12 곁설명 | 섹션 | 단원 | `kind: e[term, background, original, link, hint]`, `note: C` | 40–140자 | 바로 앞 블록에 붙는다. 앞 블록이 빠지면 함께 정리된다. 필수 조건·예외는 이 블록으로 보내지 않는다(프롬프트) |
| B13 연결 정리 | 섹션 또는 전역 | 단원·문서 | `title`, `propositions: [{relation: e[common, contrast, inclusion, condition, complement, cause, sequence], claim: C, targetIds: [TargetId](1..4)}](1..5)` | 관계 2–5 | 대상이 살아 있어야 한다(아니면 명제 정리). 전역은 새 근거 금지 |
| B14 자기 점검 | 섹션 | 단원 → 조판은 점검 파트 | `items: [{kind: e[recall, distinguish, apply, argue, calc, interpret, ox], prompt: C, premise: C?, level: e[basic, applied, advanced], targetIds: [TargetId](1..3), answer: {verdict: e[O, X]?, explanation: C, correction: C?, rubric: [C](0..5), alternatives: [s(200)](0..3), reviewIds: [blockId](1..3)}}](1..8)` | 문서 4–8, 짧은 강의 2–4 | §10 문항 규칙. 문항과 답안을 **같은 항목**으로 작성한다 |
| B15 정답과 해설 | 코드 | 렌더 투영 | B14 `answer`에서 만든다 | 닫힌 문항 50–150자, 열린 문항 채점 포인트 3–5 | 문항 ID와 1:1. 공개 방식은 §15 |
| B16 필기 공간 | 코드 | 렌더 옵션 | 고정 라벨 `내 말로 설명 / 질문 / 추가 사례` | — | 모델 호출 없음. 사실을 채우지 않는다 |
| B17 확인 필요·정정 | 섹션 `checks` + 코드 | 단원·문서 | 콘텐츠용: `Check`(§8.3). 시스템용: `notices`에서 투영 | — | 정정은 `before`·`after` 모두 근거 필수. 대체 근거 인용은 `VAL_SUPERSEDED`(§6). 상태가 `supported`가 아닌 블록은 같은 섹션 확인 항목이 가리켜야 한다(`VAL_STATUS_UNEXPLAINED`) |
| B18 수업 공지 | 섹션 | 문서 머리 뒤로 조판 | `items: [{topic: e[exam, assignment, deadline, materials, request, other], claim: C, due: s(60)?}](1..6)` | 표: 항목·내용·기한·근거 | `due`는 인용 근거에 글자 그대로 있어야 한다(`VAL_DUE_NOT_FOUND`). 절대 날짜를 추정하지 않는다 |

**공통 봉투 규칙:**
- `emphasis`는 실제 근거 텍스트에 강조어가 있어야 인정한다.
  - `stress`: 중요·핵심·꼭·반드시·기억
  - `exam`: 시험·출제·중간고사·기말고사·퀴즈
  - 위반하면 `VAL_EMPHASIS_UNSUPPORTED`다.
- 시험 언급은 "실제 신호"로만 표시하고 출제 확정으로 바꾸지 않는다.
- `importance`(core·supporting·reference)는 학습상 중심성을 나타내는 모델 판단이고, 교수 강조와는 별개 축이다.

## 10. 검증 방식과 오류 코드

**두 층으로 검증한다.**
1. **스키마**: `Contracts.validate`로 검사한다. 지원 키워드 14종만 쓰고 strict 규칙을 지킨다.
   - 서버는 공급자 응답을 이 스키마로 검사하고, 실패하면 같은 모델로 1회 재시도한다(기존).
   - 클라이언트는 응답을 받으면 같은 스키마로 다시 검사한다.
   - 공급자에 보내는 스키마에서는 검증 전용 키워드(`maxLength`, `pattern` 등)를 뺀다(`providerSchema`, 기존).
2. **코드 검사**: `validateSection`·`validateGlobal`이 맡는다. 참조, 주장, 숫자, 계산, 정책, 정정을 블록별로 검사한다.
   - 실패 detail에는 id, 숫자, 경로만 넣는다. 이 detail은 repair 프롬프트로만 돌아간다.
   - 이벤트, 로그, Note에는 코드만 남긴다.

| 코드 | 뜻 |
|---|---|
| `VAL_SCHEMA` | 슬롯 스키마 위반(경로) |
| `VAL_BLOCK_DECLINED` | Writer가 null로 보류 |
| `VAL_EVIDENCE_MISSING` / `VAL_EVIDENCE_UNKNOWN` | `lecture` 주장에 근거 항목이 없거나 `derived` 주장에 검산 참조가 없음 / 해석할 수 없거나 이 섹션에 허용되지 않은 참조 |
| `VAL_NUMBER_MISSING` | 숫자가 인용 근거·검산값에 없음 |
| `VAL_BASIS_PLACEMENT` | `pedagogical`이 허용 위치 밖에 있음. OX 정답 `O` 문항이 `pedagogical`인 경우 포함 |
| `VAL_FORMULA_REF_UNKNOWN` / `VAL_FORMULA_RETYPED` / `VAL_DERIVED_INVALID` / `VAL_VERBATIM` | 기존 verify 규칙과 같다 |
| `VAL_CALC_*` | §7 |
| `VAL_TABLE_SHAPE` / `VAL_TABLE_EMPTY_ROW` / `VAL_POINT_REF` / `VAL_MAP_REF` / `VAL_MAP_EDGE_UNSUPPORTED` | 구조 무결성 |
| `VAL_CONCEPT_REF` / `VAL_REF_UNKNOWN` | 계획에 없는 개념·수식·도표, 존재하지 않는 대상·복습 위치 |
| `VAL_ORIGINAL_UNSUPPORTED` / `VAL_QUOTE_NOT_FOUND` / `VAL_DUE_NOT_FOUND` / `VAL_EMPHASIS_UNSUPPORTED` | 근거에 실제로 없는 원어·인용·기한·강조 |
| `VAL_ANSWER_SHAPE` | 문항 규칙 위반(아래) |
| `VAL_SUPERSEDED` / `VAL_STATUS_UNEXPLAINED` | §6 정정, §9 B17 |
| `VAL_GLOBAL_EVIDENCE_NEW` | 전역 블록이 새 근거를 인용 |
| `VAL_COVERAGE_LOW` | 섹션 유닛 중 근거로 인용된 유닛 비율이 0.5 미만(기존 `MIN_COVERAGE`). 섹션 실패 |

**문항 규칙(`VAL_ANSWER_SHAPE`):**
- **OX**
  - `verdict`는 필수다.
  - `X`이면 `prompt.basis = pedagogical`이고, `correction`은 근거 있는 `lecture`·`derived` 주장이어야 한다.
  - `O`이면 `prompt`는 근거 있는 주장이고 `correction`은 null이다.
- **OX가 아닌 문항**
  - `verdict`와 `correction`은 null이다.
  - `prompt`는 근거 있는 주장이다. 본문에 없는 사실을 알아야 푸는 문항을 막기 위해서다.
- **`argue`**: `rubric`이 1개 이상 있어야 한다(필수 논점).
- **`calc`**: `explanation`이 같은 섹션 B10의 검산 참조를 인용해야 한다. 숫자만 답으로 두지 않기 위해서다.
- **`reviewIds`**: 같은 노트의 다른 블록을 가리킨다.
- **대상 개념**: `defined` 개념이어야 한다. 이름만 언급된 개념은 묻지 않는다.

**검사 순서와 계산 색인(구현에서 정한 것):**
- 확인 항목을 먼저 검사해 정정 지도(대체된 근거 → `after` 근거)를 만든다. 확인 항목 자신은 문제가 된 근거를 일부러 인용하므로 대체 검사를 받지 않는다.
- B10을 계획 순서대로 먼저 검사하고, **모든 검사를 통과한 B10만** 계산 색인에 올린다. 그래서 실패한 계산(예: 대체된 고정비로 한 계산)에 기댄 블록은 같은 회차에 `VAL_EVIDENCE_UNKNOWN`으로 함께 repair된다.
- B10 안의 주장은 그 블록 자신의 검산값을 바로 인용할 수 있다.
- 대체 검사(`VAL_SUPERSEDED`)는 주장뿐 아니라 계산 입력, 인용, 강조처럼 주장이 아닌 근거 목록에도 적용한다. 오래된 수치가 남는 대표 경로가 계산 입력이기 때문이다.
- 조립(`assembleNote`)은 모든 섹션의 정정 지도를 합쳐 섹션 검증을 한 번 더 돌린다. 검증을 통과한 정정 기록은 그 섹션이 실패해도 지도에 넣는다. 정정 자체는 따로 검증된 강의 사실이라, 오래된 값을 막는 데 쓰는 편이 안전하다. 뒤 단원에서 정정된 값을 앞 단원이 그대로 쓴 경우를 잡기 위해서다. 이때 걸린 블록은 repair 없이 제외된다. Planner가 정정이 있는 유닛을 `crossUnitIds`로 미리 이어 주면 피할 수 있다.

## 11. 책임 분담

| 책임 | Planner | 섹션 Writer | 전역 Writer | 코드 |
|---|---|---|---|---|
| 섹션 경계·순서 | 내용 기준으로 정한다(연속 유닛) | — | — | 커버리지, 연속성, ID 검증 |
| 블록 타입·순서·근거 허용 범위 | 정한다(`crossUnitIds` 포함) | 계획을 채운다. 못 채우면 null | 계획을 채운다 | 계획에서 출력 스키마 생성 |
| 개념의 기준 위치 | 홈 섹션과 B05를 정한다 | B05 하나에만 정의하고 나머지는 ID로 참조 | ID로 참조 | 단일 정의 검사 |
| 설명·비교·논증·사례·자료·계산 | — | 작성 | — | 주장, 숫자, 검산, 정정 검사 |
| 문항과 답안 | — | 같은 항목으로 작성 | — | 답안 연결·번호, B15 투영 |
| 확인 필요·정정 | — | `checks`에 작성 | — | 시스템 고지(B17 시스템) |
| 한눈에·지도·연결 정리 | 필요 여부 | 섹션 B03·B13 | B02·B03·B13(새 사실·새 근거 금지) | 대상·근거 부분집합 검사 |
| 메타데이터·번호·필기란·고지·내보내기 | — | — | — | 전부(모델 호출 없음) |
| 공지 | 계획(B18) | 실제 발언으로 작성 | — | 기한은 원문 대조, 절대 날짜 추정 금지 |

- 편집 권장량을 넘었다는 이유로 핵심 조건을 자르지 않는다.
- `finish_reason=length`는 섹션 분할(§12.4)로, 검증 오류는 실패 블록 1회 재생성으로 처리한다(v2 §6.5). 두 재시도는 겹치지 않는다. 분할한 반쪽의 검증 실패도 repair 1회뿐이다.

## 12. 실패와 종속 처리

### 12.1 블록 실패
1. `validateSection` → 실패 블록만 repair 1회(`repairOutputSchemaFor`, 실패 blockId만 키로).
2. 다시 실패하거나 Writer가 null로 보류하면 블록을 제외하고 `dropped`에 코드와 함께 기록한다.
3. `gist`나 확인 항목이 실패하면 repair 없이 뺀다. gist는 null로, 확인 항목은 제거한다.

### 12.2 의존 정리 (`assembleNote` 안, 고정점까지 반복)
| 대상 | 규칙 |
|---|---|
| 목록형 항목(B02 `items`, B13 `propositions`, B14 `items`, B18 `items`) | `targetIds` 중 하나라도 사라졌거나, 사라진 블록의 계산 참조를 인용하면 그 **항목**을 뺀다. 문항의 `reviewIds`는 사라진 ID만 빼고, 하나도 남지 않으면 문항을 뺀다 |
| 항목 수가 최소 미만이 된 블록 | 블록을 뺀다(`NOTE_DEPENDENCY_DROPPED`). B03은 노드 2개·간선 1개 미만이면 뺀다 |
| B03 노드 | `targetId`가 사라지면 노드와 그 간선을 뺀다 |
| B12 곁설명 | 계획상 바로 앞 블록이 사라지면 뺀다 |
| 계산 참조를 인용한 비목록 주장 | 그 블록을 뺀다 |
| 확인 항목 `targetIds` | 사라진 ID만 지운다. 정정 기록 자체는 정보이므로 남긴다 |
| 개념 | 홈 B05가 사라지면 `homeBlockId: null`. 개념 참조 자체는 유지한다(링크만 끊김). 그 개념을 묻는 문항은 `reviewIds` 규칙에 따라 정리된다 |
| 단원 요지(gist)·확인 항목 | 사라진 계산을 인용하면 요지는 null로 비우고 확인 항목은 뺀다 |
| 섹션 | 검증 시점(§10)에 커버리지가 0.5 미만이었거나 정리 후 블록이 0개가 되면 섹션을 실패 처리한다(`NOTE_SECTIONS_FAILED`, 구간 포함). 정리로 종속 항목이 빠졌다고 커버리지를 다시 계산하지 않는다. 그렇게 하면 멀쩡한 단원이 통째로 버려진다 |

- 정리된 항목은 `pruned`에 정리 전 위치 ID와 코드로 남는다. 고지는 `NOTE_ITEMS_PRUNED`다.
  - 항목 ID 접두: B02 `I`, B13 `R`, B14 `Q`, B18 `N`. 예: `S4_B2/Q3`, `GB1/I3`.
  - 항목 코드: `NOTE_TARGET_DROPPED`(대상이 사라짐), `NOTE_REVIEW_DROPPED`(복습 위치가 모두 사라짐), `NOTE_CALC_DROPPED`(인용한 계산이 사라짐).
  - 블록 코드(`dropped`): `NOTE_DEPENDENCY_DROPPED`, `NOTE_CALC_DROPPED`, `NOTE_ANCHOR_DROPPED`(B12의 앞 블록이 사라짐).
- 이렇게 하면 끊어진 답안·요약 링크가 0개가 되고, 본문에 없는 내용을 묻는 문항도 남지 않는다.

### 12.3 고지 코드 (내용 없음: 코드, 건수, id, 시각 구간만)
- 유지(현행 stages): `NOTE_CAPTURE_GAP`, `NOTE_SECTIONS_FAILED`, `NOTE_BLOCKS_DROPPED`, `NOTE_UNITS_UNCITED`, `NOTE_GLOBAL_FAILED`, `NOTE_JUDGE_SKIPPED`, `CONSENT_SUMMARY_REQUIRED`
- 추가:
  - `NOTE_ITEMS_PRUNED`
  - `NOTE_FORMULAS_IMAGE`: 본문이 참조한 수식 중 크롭으로 표시되는 것
  - `NOTE_FORMULAS_CHECK`: 크롭이 없어 "확인 필요"로 표시되는 것
  - `NOTE_FIGURES_CHECK`
  - `NOTE_FIGURES_NOT_DETECTED`: Free. 도표 탐지가 없음
- 현행 `NOTE_FORMULAS_UNVERIFIED`는 `NOTE_FORMULAS_CHECK`·`NOTE_FORMULAS_IMAGE`로 대체한다. 레지스트리 전체가 아니라 **노트가 참조한 수식만** 센다.

### 12.4 출력 잘림
섹션 Writer가 잘리면 **계획 블록을 반으로 나눠** 두 번 요청한다.
- 근거 입력은 두 요청이 같다. 블록이 어느 유닛의 근거를 쓸지 모르기 때문이다.
- `gist`는 첫 반쪽 요청에만 넣고, `checks`는 두 결과를 합친다.
- 반쪽도 잘리면 그 섹션은 실패다(현행과 같음).

## 13. 버전과 재생성 범위

| 바뀐 것 | 버전 | 다시 실행 | 비고 |
|---|---|---|---|
| 인식 결과, 정제 규칙, `Unit`·`EvidenceItem` 계약 | 입력 다이제스트, `CONTRACT_VERSION` | C~H | 단계 캐시 키가 자동으로 갈린다 |
| B 슬롯, 검증 규칙, 계획 규칙 | `noteSpecVersion` | E~H | 서버와 확장을 동시에 배포. 다르면 409 |
| 프롬프트 문구 | `promptVersion` | E~H(해당 단계부터) | |
| 계획·작성 모델 | 모델 id | E~H 또는 F~H | |
| 템플릿, CSS, SVG, 브랜드 토큰 | `designVersion`(렌더 버전) | **현행 승인 규칙: E~H**(§8 "템플릿만 바뀌면 E~H"). **제안: H만** | 결정 전까지는 현행 규칙을 따른다(§18) |
| 렌더 옵션(답안 위치, 필기란, 화면/인쇄) | 없음(렌더 입력) | H만 | Note를 바꾸지 않는 표시 옵션이다 |
| 정책(보강·가상) | `noteSpecVersion` | E~H | v1은 `false`로 고정 |

- temperature 0만으로 같은 결과를 보장하지 않는다. **재사용은 버전과 입력 다이제스트로만 판단한다.**
- 같은 Plan·Note에서 렌더 순서는 코드가 정한다. 같은 입력이면 같은 Note가 나와야 한다(fixture 테스트로 고정).
- 패키지 마이그레이션은 미지 필드를 보존한다(§5.4). 모델 출력과 렌더 입력의 미지 필드는 strict 스키마로 거절한다. 두 정책은 별개다.

## 14. 수식·그림 대체 규칙 (`displayOf`)

| 상황 | 표시 | 고지 |
|---|---|---|
| 수식 `verified` + LaTeX 있음 | KaTeX 직접 렌더(검증과 같은 빌드, `throwOnError:true`) | — |
| 수식 그 외(reread·image·unverified) + 크롭 있음 | 원본 크롭 + "원본 이미지로 표시" | `NOTE_FORMULAS_IMAGE` |
| 수식 그 외 + 크롭 없음 | "수식 확인 필요" 표식 + 원본 시각. OCR 텍스트가 있으면 "인식 원문(미검증)"으로 작게 표시 | `NOTE_FORMULAS_CHECK` |
| 새 유도식(`derived`) | 블록 검증에서 KaTeX 실패 시 블록 repair → 제외. 렌더 단계에서 미검증 LaTeX가 노출될 일이 없다 | `NOTE_BLOCKS_DROPPED` |
| 표 도표 + **셀 검증 통과** + 크롭 | HTML 표로 재조판 + "화면 표를 옮겨 적음" | — |
| 표 도표 그 외 + 크롭 | 크롭. 그림의 단일 `conf`는 셀별 검증이 아니다 | — |
| 차트·다이어그램 + 크롭 | 크롭. 설명은 근거가 있는 슬롯(축, 단위, 읽는 법, 해석, 한계)만 쓴다 | — |
| 도표 + 크롭 없음 | "도표 확인 필요" + 원본 시각 | `NOTE_FIGURES_CHECK` |
| Free | 도표 탐지가 없음. 수식은 항상 `unverified`이므로 크롭 또는 확인 필요 | `NOTE_FIGURES_NOT_DETECTED` |

- **KaTeX 통과는 문법 검증이다.** 새 유도식의 수학적 타당성이나 숫자 검산을 대신하지 않는다. 숫자 검산은 §7이 맡는다.
- **표 재조판 기준:**
  - 셀이 직사각형이다(모든 행의 셀 수가 같음).
  - 셀 숫자가 같은 영역의 로컬 OCR 숫자와 맞는다(`Formulas.crossCheck`와 같은 방식).
  - 표 신뢰도 임계값 θ는 Phase 0 A2 벤치에서 정한다. **정하기 전 기본값은 재조판하지 않고 크롭만 쓴다.**
- 크롭 ID는 패키지 `blobs`의 키이고, 렌더러는 `blob:`이나 래스터 `data:`만 받는다(현행 허용 목록). 외부 URL이나 원본 미디어 경로로 대체하지 않는다.
- 크롭이 없다고 클라우드로 자동 전환하지 않는다(불변식). 그래프도 임의로 복원하지 않는다.
- **도표 배치는 Planner가 정한다.** 계획 블록의 `figureIds`에 든 도표는 그 블록 바로 뒤에 표시한다. B10 내용의 `figureIds`는 본문에서 다루는 도표다. 고지는 이 둘에 든 도표만 센다.

## 15. 답안 공개와 PDF 분할 (렌더 계약, Phase 7)

**문서 순서(코드):**
- B01 머리 → B18 공지 → B02 한눈에 → B03 지도
- → 단원마다: B04 헤더 → 블록(계획 순서, B12는 앞 블록 옆) → 그 단원의 B17 확인
- → 전역 B13 → 자기 점검 파트(B14를 단원별로 묶어 문서 전체 번호) → 정답과 해설(B15) → 처리 고지(시스템 B17) → (필기형이면 B16)

**답안 공개:**
| 매체 | 기본 | 옵션 |
|---|---|---|
| 웹(사이드 패널 뷰어) | 문항별 `<details>`로 접어 둠. 펼쳐도 Note는 바뀌지 않는다 | — |
| PDF 표준 | 문항은 점검 파트에, 답안은 문서 끝 "정답과 해설"에 둔다. 답안 머리에 문항 번호와 앵커 링크를 단다 | `answers: "inline"`(P06 점검용 예외: 문항 바로 아래에 해설) |
| 시험 모드 | 표준과 같고, 정답과 해설 앞에서 쪽을 넘긴다(`break-before: page`) | — |

**PDF 넘김 규칙(자동 흐름 조판, 고정 지면 아님):**
- `@page { size: A4; margin: 14.3mm }`. 시안의 `@page{margin:0}` + 고정 `paper-sheet`는 정적 지면 전용이므로 쓰지 않는다. 쪽 수는 내용에서 결과로 나온다.
- 제목은 다음 본문 최소 2줄과 묶는다(`break-after: avoid`, `orphans/widows: 2`).
- B05에서 정의와 필수 조건(`scope`)은 한 묶음이다(`break-inside: avoid`).
- B06:
  - 행 사이에서만 나눈다(`tr { break-inside: avoid }`).
  - `thead { display: table-header-group }`으로 표 제목과 열 제목을 반복한다.
  - 대상이 4개 이상이면 기준별 카드로 전환한다(`NOTE_ADVISORY_TABLE_WIDE`).
  - 기준이 7개 이상이면 행 분할 힌트를 준다(`NOTE_ADVISORY_TABLE_LONG`).
- B08·B09: Point 한 쌍(단서+해석)은 떼지 않는다. 쪽을 넘기면 "사례 02 · 계속"과 Point 번호를 반복한다(사례를 `thead`가 있는 표로 조판).
- 문항과 답 쓰는 공간은 떼지 않는다. 답 쓰는 공간과 필기 격자는 **빈 여백**이므로 고정 높이를 허용한다. 내용 컨테이너에는 고정 높이, `overflow:hidden`, 말줄임, 글자 축소를 쓰지 않는다.
- 인쇄는 다음이 모두 끝난 뒤 한다:
  - `document.fonts.ready`
  - KaTeX CSS 로드
  - 모든 크롭 `img.decode()`

**기존 렌더 결합과의 충돌(`memory.md`, Phase 7에서 함께 정리):**
- `sandbox.html`·`sidepanel.html`·`landing/demo-panel.html`은 `landing/product-panel.css`를 노트 타이포그래피의 단일 원천으로 공유한다(7·16행). v2 슬롯의 `css`와 역할을 나눠야 한다. 제안은 노트 블록 표현을 슬롯 `css`로 옮기고, `product-panel.css`에는 패널 외곽만 남기는 것이다. 데모 화면도 같이 바뀐다.
- 형광펜 `==…==`과 인용 콜아웃 `>`의 3자 결합(`noteText` → marked 확장 → `product-panel.css`, 13·14행)은 v1 Markdown 경로의 것이다. v2에서는 블록 타입과 필드(`importance`, `emphasis`, B11·B13)가 이를 대신하므로, 결합 기록도 함께 고친다.
- 다크 테마 인쇄는 `@page` 여백 0 + `body` 패딩을 쓰며, `applyPrintRatio()`가 JS로 `@page`를 만든다(12행). 여러 쪽으로 흐르는 조판에서는 둘째 쪽부터 위아래 여백이 사라진다. 미색 지면(`#F7F7F4`)을 종이 끝까지 칠할지, 흰 종이 + 쪽 여백으로 갈지 Phase 7-4에서 정한다.

**시안(agy 추출, 직접 확인한 항목)에서 Phase 7이 고칠 점:**
- 문항·답안·Point에 기계용 ID와 앵커가 없다. 번호 문자열로만 이어진다. → `id`·`href`·`data-*`를 붙인다.
- `note.css`에 구형 색 변수가 남아 있다(`--teal`·`--plum` 등). → v3 토큰만 쓴다.
- 좁은 화면에서 `.compare.reflow thead`를 숨긴다. → 행 카드에 열 이름을 반복한다(`data-label`).
- B08 시안의 Point 라벨이 `P1`이다. → 규격대로 "Point 1"로 쓴다.

## 16. 합성 fixture (`tools/note-fixture/`)

직접 작성한 가상 강의 "원가 구조와 기업의 경계"(경영학원론 가상 회차)를 쓴다. 실제 강의 자료가 아니며, 수치와 자료는 일반 강의의 기본값으로 재사용하지 않는다.

| 파일 | 내용 |
|---|---|
| `input.json` | SlideDoc 6장, Transcript, 메타, 공백, 수식 레지스트리(상태 지정), 도표 레지스트리, 크롭 ID 목록 |
| `planner-output.json` | Planner 출력: 개념 7, 섹션 5, 전역 2 |
| `writer-outputs.json` | 섹션별 1차 출력, repair 출력, 전역 출력, 악성 지시 시도 출력 |
| `expected-note.json` | `assembleNote` 결과(골든). 재현성 기준 |

| 사례 | 확인 |
|---|---|
| 근거 | 줄 단위 근거, 걸러진 학번 워터마크가 근거·노트에 없음, 교차 근거 허용 범위 |
| 정정 | 고정비 240만 → 300만 원 정정. 1차 계산이 대체 근거를 인용 → `VAL_SUPERSEDED` → repair 후 손익분기 500개 |
| 계산 | 입력 근거, 공헌이익 6,000원, 손익분기 500개, 단위·반올림 검산. `checkCalc` 단위 테스트(분모 0, 불일치, `%p`) |
| 교육용 오답 | OX `X` 문항은 `pedagogical`이고 근거 있는 수정 문장과 연결됨. 같은 문장을 B05에 쓰면 `VAL_BASIS_PLACEMENT` |
| 이론 비교·긴 표 | 3대상×7기준 B06. 확인되지 않은 칸은 null로 유지(창작하지 않음). 경고만 있고 잘림 없음 |
| 인문 자료 | B09에서 저자 주장과 교수 해석 분리, 인용 원문 대조, 서술형 문항 + 채점 기준 |
| 부분 실패 | B07에 강의 밖 연도("1937년")가 들어가 repair 후에도 실패 → 제외. 그 블록을 복습 위치로 둔 문항, 그 블록을 대상으로 한 전역 결론은 정리 |
| 섹션 실패 | (변형) 섹션 5 출력 없음 → `NOTE_SECTIONS_FAILED`, 그 섹션을 가리키던 항목 정리 |
| 수식·크롭 | F1 검증됨 → `latex`, F2 image+크롭 → `crop`, F3 미검증·크롭 없음 → `check`. 도표 G1은 크롭 없음 → `check` |
| Free | (단위 테스트) 도표 없음 → `NOTE_FIGURES_NOT_DETECTED`. 다른 동작은 바뀌지 않음(자동 클라우드 전환 없음) |
| 악성 지시 | 슬라이드 속 "이전 지시 무시" 문장은 근거 텍스트일 뿐이다. 그 지시를 따른 출력(필드 추가, 타입 B99, `synthetic`)은 스키마에서 거절됨 |
| 재현성·무내용 로그 | 같은 입력으로 두 번 조립하면 동일. `dropped`·`pruned`·`notices`에 주장 텍스트 없음 |

검증 결과는 §19에 적는다.

## 17. Phase 6/7 구현 단위

각 단위는 파일 1~3개와 테스트로 끝난다. 계약은 이 문서와 `lib/note-contract.js`다.

| # | 단위 | 파일 | 계약·완료 기준 | 의존 |
|---|---|---|---|---|
| 6-1 | 근거 인덱스 | `lib/preprocess.js`, `lib/contracts.js`, `lib/verify.js` | §5. **완료(`2841ad5`)** | — |
| 6-2 | 슬롯 교체 | `lib/note-spec.js`, `server/prompts.js`, `server/index.js`(+테스트) | `NOTE_SPEC_VERSION = "lecture-note-1"`. `outputSchema(stage, body)`: section·repair는 요청별 스키마. 요청 `REQUEST.section = {section: Plan 섹션, concepts, evidence: [EvidenceItem], registry, figures}`, `repair`는 blockId 키. 제공자 스키마는 요청마다 계산. 기존 409·예약·재시도 흐름 유지 | 6-1 |
| 6-3 | 단계 연결 | `lib/stages.js`(+테스트) | 계획은 `normalizePlan`, 작성은 근거 항목 전송. 검증은 `validateSection` → blockId repair 1회 → `assembleNote`. 잘림은 §12.4. 고지는 §12.3 | 6-2 |
| 6-4 | 전역 Writer 입력 | `lib/stages.js`, `server/prompts.js` | 살아남은 섹션 블록만 보내고, 큰 노트는 블록 요약(주장 텍스트 + 참조)으로 줄여 입력 상한 안에 둔다. 새 근거 금지 | 6-3 |
| 6-5 | T5 주장 단위 근거 지지(유료) | `lib/verify.js`, `lib/stages.js` | `checkSupport`를 블록이 아니라 주장 단위로 보낸다(같은 `/v1/judge`) | 6-3 |
| 6-6 | 도표 레지스트리·크롭 | `lib/figures.js`(신규), `lib/stages.js` | §6.7 크롭(WebP), dHash 중복 제거, `G#` 부여, `display`(§14). 표 재조판은 θ가 정해지기 전에는 끈다 | 6-1 |
| 6-7 | 프롬프트 v2 | `server/prompts.js` | §9 규칙을 단계 프롬프트로(가상·보강 꺼짐, 정정 기록, 문항 규칙, 강조 근거). `PROMPT_VERSION` 올림 | 6-2 |
| 7-1 | B 템플릿·문서 순서 | `lib/note-spec.js`(templates·layout·css) | §15 순서, v3 토큰. 시안 마크업에 ID·앵커를 더한다. 구형 색은 쓰지 않는다 | 6-2 |
| 7-2 | 수식·도표 표시 | `lib/note-render.js` | `displayOf`를 따른다. "확인 필요" 표식 | 7-1 |
| 7-3 | 답안·필기란 옵션 | `lib/note-render.js`, `lib/note-spec.js` | 웹은 접고, PDF는 끝(기본)·inline(점검용). 시험 모드는 쪽 넘김. B16 | 7-1 |
| 7-4 | 인쇄·내보내기 | `sandbox.html`, `lib/note-export.js`(신규) | fonts·KaTeX·크롭 준비 후 인쇄. Note → Markdown 어댑터(v1 `noteText` 대체) | 7-1 |
| 7-5 | 렌더 QA | `tools/note-render-smoke.cjs`(신규) | fixture 노트로 360·768·1280px, A4 인쇄, 긴 표 헤더 반복, 잘림 0 확인(Playwright) | 7-2~7-4 |

## 18. 열린 결정 (사용자)

1. **가상 사례·강의 밖 보강을 켤지.** 현재 꺼져 있다. 켜면 계약 버전 증가, 라벨, 별도 출처 계약이 따라온다.
2. **CSS·SVG·토큰만 바뀌었을 때 H만 다시 렌더링할지.** 현행 승인 규칙은 E~H다. H만 하면 LLM 비용이 0이다.
3. **화자 분리가 없을 때의 귀속 규칙.** 현재는 "강의에서"로만 귀속한다. 교수·학생 구분이 필요하면 STT 화자 분리 도입을 검토한다.
4. **표 재조판 임계값 θ.** Phase 0 A2에서 정한다. 그 전에는 크롭만 쓴다.
5. **권장량 수치.** `proposal.md` §5·§8의 편집 가설이다. 실제 강의 평가(§14.3) 뒤 조정한다.
6. **시험 모드를 제품 옵션으로 노출할지.**

## 19. 검증 기록 (2026-10-02)

모두 로컬에서 검증했다. 유료 API는 호출하지 않았다.

**자동 검증:**
- 근거 인덱스(`2841ad5`): 전체 테스트 709개, 패키저 감사 통과.
- 계약 모듈 `lib/note-contract.test.js` 34개와 fixture `lib/note-fixture.test.js` 8개, 합계 42개 통과. 전체 게이트 결과는 커밋 메시지에 남긴다.
- 골든 노트 `tools/note-fixture/expected-note.json`: 같은 입력으로 두 번 조립해 바이트 단위로 같은 것을 확인했다. 내용을 검토한 뒤 저장했다.

**fixture 결과(예상과 실제가 같음):**
| 단계 | 결과 |
|---|---|
| 근거 | 유닛 6개, 근거 40줄. 학번 워터마크와 걸러진 세그먼트는 근거에 없다. 줄 ID가 미리 예측한 값과 같다 |
| 1차 검증 | S2_B3 `VAL_SUPERSEDED`(정정 전 고정비로 계산). S2_B5 `VAL_SUPERSEDED` + `VAL_EVIDENCE_UNKNOWN`(실패한 계산 참조) + `VAL_NUMBER_MISSING`. S3_B4 `VAL_NUMBER_MISSING`("1937", 강의 밖 연도) |
| repair 뒤 | S2 통과(공헌이익 6,000원, 손익분기 500개 검산). S3_B4만 다시 실패해 제외 |
| 조립 | `partial`. 제외 1(S3_B4). 정리 2: `S4_B2/Q3`(복습 위치 소멸), `GB1/I3`(대상 소멸). 인용 근거 31줄. 수식 F1 latex·F2 crop·F3 check, 도표 G1 check·G2 crop. 경고 `TABLE_LONG`(S3_B3)·`OX_CONTESTED`(S4_B2/Q2) |
| 악성 지시 | 필드 추가와 `synthetic`은 스키마에서 거절. 정답을 O로 바꾸라는 지시를 따른 출력은 `VAL_BASIS_PLACEMENT` + `VAL_ANSWER_SHAPE` |
| 섹션 실패 변형 | `NOTE_SECTIONS_FAILED`(S5, 1140–1260초) |
| 무내용 기록 | `dropped`·`pruned`·`notices`에는 코드와 ID뿐이다. 노트 전체에 학번과 "1937"이 없다 |

**fixture가 잡아낸 구현 결함(커밋 전에 고침):**
1. `citedRefs`의 else가 엉뚱한 if에 붙어 하위 노드를 탐색하지 않았다.
2. `pushErr`가 빈 위반 목록에도 오류를 기록해 모든 블록이 실패했다.
3. 다른 검사에 실패한 B10의 계산값이 색인에 남아, 그 값에 기댄 블록이 같은 회차 repair에서 빠졌다.
4. 대체 근거 검사가 계산 입력에 적용되지 않아, 정정 전 고정비로 한 계산이 통과했다.

**교차 리뷰(agy, Gemini 3.8 Flash, 읽기 전용):** 차단 4건, 중요 6건, 문서 6건이 보고됐다.
- 반영:
  - 단원 요지와 확인 항목의 끊긴 계산 참조 정리
  - 섹션 B03 노드 대상 검증
  - Point `P0` 거절
  - Planner가 쓴 제목·질문·개념 이름의 숫자 검사(검사를 거치지 않던 우회 경로)
  - 도표 표시 값 문서화
  - 회귀 테스트 3개 추가
- 반영하지 않음(근거와 함께):
  - 정리 뒤 커버리지 재검사: 멀쩡한 단원이 통째로 버려진다(§12.2).
  - 실패한 섹션의 정정 기록 제외: 정정은 따로 검증된 사실이다(§10).
  - 근거 4000자 절단 불일치: 입력 계약상 일어날 수 없다.
  - 중복 검산: 비용이 미미하다.

**검증하지 않은 것:**
- 실제 LLM이 이 스키마와 규칙을 지키는지, 정정과 충돌을 감지하는지. 프롬프트 v2(Phase 6-7) 뒤 A5 벤치에서 확인한다.
- 실제 강의 자료, 화자 귀속, 긴 강의(섹션 40개)에서의 검증 시간.
- 서버 경로(`/v1/plan`·`/v1/write`) 연결과 단계 캐시(Phase 6-2·6-3).
- 렌더, 인쇄, 모바일(Phase 7). 디자인 시안은 여전히 브라우저 검증 전이다.
- 전역 블록의 "새 근거 금지"는 근거 ID 기준이다. 같은 근거로 다른 주장을 지어내는 경우는 T5 근거 지지(유료)와 사람 검수의 몫이다.
