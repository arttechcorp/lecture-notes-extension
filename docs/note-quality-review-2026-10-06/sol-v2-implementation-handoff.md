# sol-luna-2 / sol-fork-2 구현·실험 위임서

작성: 2026-10-07. 상태: 구현 전 명세. 이 문서 작성 작업은 코드 수정·배포·유료 실험을 실행하지 않는다. 다음 담당자는 아래 범위를 구현하고 실제 서비스 경로에서 비교한다.

## 1. 목표와 결정

우선순위는 **① 강의 내용의 정확한 구조화·시각화와 학습 가능성 ② 품질을 통과한 노트당 비용 ③ 소요 시간**이다. 싼 결과가 불완전한 노트라면 개선으로 판정하지 않는다.

| 모드 이름 — 문자열 그대로 사용 | 계획 | 본문·문항 작성 | 통합 검수·선택 수정 | 문맥 |
|---|---|---|---|---|
| `sol-luna-2` | Sol | Luna High | Sol | Sol의 계획 접두를 검수에 재사용. Luna에는 별도 작업 패킷 |
| `sol-fork-2` | Sol | Sol | Sol | 계획 접두 P를 고정하고 각 작업은 P+자기 입력 |

Sol은 `openai/gpt-6.1-sol`, Luna High는 내부 ID `openai/gpt-6-luna@high`이며 실제 업스트림 모델/effort는 기존 `LLM.upstreamOf`·파라미터 해석을 따른다. 첫 비교에서 Sol effort는 현재 medium을 유지하고 Luna는 high로 고정한다. 바꿀 경우 두 군의 공통 단계에 동일하게 적용하고 별도 실험으로 기록한다.

**sol-luna-2의 기본 구현은 코드가 실행하는 제한된 Luna 워커다.** Sol이 매 섹션에서 function call을 생성하게 하지 않는다. 계획에 담긴 위임 명세를 코드가 실행한다. 역할상 서브에이전트지만 범용 에이전트 SDK나 자율 반복 루프를 추가하지 않는다. `sol-luna-tool`의 매 작업 Sol→Luna→Sol 경로를 이름만 바꿔 재사용해서는 안 된다.

향후 모델이 동적으로 위임할 필요가 입증되면 `draft_sections` 배치 도구를 별도 군으로 비교할 수 있다. 이번 두 모드에는 넣지 않는다. 함수 도구는 워커를 실행하는 인터페이스일 뿐, 그 자체가 품질을 높인다는 근거는 없다.

## 2. 읽을 자료와 현재 상태

1. `AGENTS.md`, `memory.md`, `docs/architecture-v2.md`.
2. [품질 제안](proposal.md), [fork 실측 검토](sol-fork-review-2026-10-07.md), [기존 실험 계약](session-experiment-protocol.md).
3. [예시 PDF 편집 분석](../note-format-study-2026-10-02/source-analysis.md), 같은 디렉터리의 `page-design-spec.md`.
4. `server/note-session.js`, `server/index.js`, `server/prompts.js`, `server/llm.js`; `lib/stages.js`, `lib/section-draft.js`, `lib/note-contract.js`, `lib/service-client.js`, `offscreen.js`.

현재 작업 트리는 기존 구현 변경이 많이 남아 있다. 시작 시 status와 diff를 기록하고 기존 변경을 덮지 않는다. 새 작업 브랜치를 습관적으로 만들지 말고 저장소 지침에 따른다. 지침 파일을 수정하지 않는다.

기존 측정은 Luna 독립 작성 약 $0.142, Sol-fork 약 $0.990이며 단일 강의·군별 다른 계획의 결과다. 413이 발생한 누적 세션 군은 정상 품질 비교군이 아니다. 상세 한계는 fork 검토 문서를 따른다. 이를 새로운 두 버전의 예상 가격으로 사용하지 않는다.

## 3. 공통 실행 흐름

```text
암호화 패키지 → 메모리 복호화 → 근거·그림 적격성 확인
  → Sol 계획 1회: 기존 Plan + 편집 명세
  → 계획 검증·공통 접두 동결
  → 섹션별 작성(초기 동시성 4, 기존 전역 공급자 상한도 준수)
  → 계약·근거·수식·참조 검증 및 제한된 복구
  → Sol 통합 편집 검수 1회 → 허용된 부분 수정 → 수정분 재검증
  → 확정 본문으로 문항 작성 → 문항·답·근거 검증
  → Sol 전역 안내/관계 지도 생성 → 참조 검증
  → 기존 컴파일러·렌더러 → 화면 및 인쇄 검수
```

전역 생성은 기존 `global` 단계를 사용하며 전체 본문을 다시 쓰지 않는다. 두 모드의 단계 수와 검증 정책은 같게 유지한다. T5 모델·임계치·복구 정책을 비용을 줄이려고 동시에 바꾸지 않는다.

기존 `link`는 용어·모순·중복 편집을 수행한다. 여기에 통합 검수를 확장하거나 공통 구현을 재사용하되, 기존 link와 새 검수를 연속 중복 실행하지 않는다. 실험 모드는 `writer=draft`와 편집 검수 경로가 실제 켜졌음을 사전검사한다. 미지원 서버나 기능 누락이면 명시적 오류로 중단한다.

## 4. 편집 계획·작업·수정 계약

### 4.1 계획은 한 번에 생성

기존 Plan을 파괴하지 않고 실험 전용 응답에 `editorialPlan`을 나란히 둔다. v2 계획 생성의 업스트림 출력은 `{plan, editorialPlan}`로 검증하고 서비스 응답도 두 칸으로 분리한다. 기존 모드는 기존 응답 계약을 유지한다. `editorialPlan`은 실행 메모리 전용이며 최종 Note 저장 형식에 그대로 추가하지 않는다.

```text
editorialPlan {
  v: 1,
  glossary: [{conceptId, preferredTerm, aliases, evidenceIds}],
  sections: [{
    sectionId, learningQuestion, learningItemIds, prerequisiteSectionIds,
    mustExplain: [{role, learningItemIds, evidenceIds}],
    owns: [conceptId], referencesOnly: [conceptId],
    visuals: [{visualId, kind, purpose, learningItemIds, evidenceIds,
               assetIds, comparisonAxes, relationTypes, required}],
    targetOutputTokens
  }]
}
```

- `mustExplain.role`: definition / mechanism / condition / exception / example / comparison / argument. 해당 분야에 없는 설명 역할을 억지로 만들지 않는다.
- `visuals.kind`: comparison / process / relation / graph-reading / formula-steps / none.
- 실제 JSON Schema에는 타입·길이·enum·additionalProperties 제약을 명시하고 기존 Plan·근거·asset ID와 교차 검증한다. 위 표기는 필드 의미 설명이며 완성된 JSON Schema가 아니다.
- `owns`는 설명 책임 단원, `referencesOnly`는 짧게 참조할 단원이다. 정의를 모든 단원에서 반복하지 않는다.
- 중요한 예외·조건을 빈칸 채우기보다 먼저 배정한다. 근거 없는 인과 화살표·비교 기준·숫자 곡선을 만들지 않는다.
- 범위는 입력 Plan의 섹션/학습 항목에 닫는다. 모델이 임의 ID·모델명·외부 URL·파일 경로를 만들어 실행을 제어할 수 없다.

### 4.2 Luna 작업 패킷

`공통 작성 지시 + 용어/설명 소유권 + 이번 섹션 편집 명세 + 해당 근거/정정/조건 + 허용 asset 및 참조 + SectionDraft 스키마`를 전달한다. 전체 강의와 모든 다른 초안을 기본으로 붙이지 않는다. 의존 섹션은 검증된 선행 핵심 주장과 필요한 근거를 전달한 뒤 실행한다. 독립 섹션만 병렬화한다.

Luna 출력은 기존 SectionDraft의 claims·relations·검증 가능한 참조다. 자유 산문을 다시 LLM으로 구조화하거나 모델이 CSS·HTML을 생성하는 경로를 만들지 않는다. 그림을 선택하는 데 필요한 텍스트 메타데이터만 사용했는지, 실제 시각 입력을 봤는지는 구분한다. 보지 않은 그림의 정확성을 확인했다고 기록하지 않는다.

### 4.3 통합 검수는 본문 전체 재출력이 아니다

입력: 고정 계획, 살아남은 본문의 주장/관계/그림 연결, 조건·예외, 중복 후보, 누락 목록과 관련 근거. 기존 `globalSections`의 임의 축약 때문에 설명이나 조건이 사라지면 축약 비율과 누락 범위를 기록하고 검수 완료로 처리하지 않는다.

출력: 기존 link edits를 우선 재사용한 제한된 수정 목록과 `unresolved` 목록. 최소 지원 작업은 용어 수정, 주장 수정, 중복 통합, 관계 수정, 기존 asset 재연결, 섹션 복구 요청이다. 대상은 호스트 ID로 지정하며 경로를 무제한 조작하는 범용 JSON Patch는 허용하지 않는다.

- 수정에는 대상 ID·이유 코드·관련 근거·의도한 변경이 필요하다. 기존 주장 수정은 증거와 수식/숫자/참조 검사를 다시 통과해야 한다.
- 중복 제거 전 제거될 주장의 고유 조건·예외·근거가 다른 위치에 보존되는지 확인한다.
- 초기 상한: 통합 검수 1회, 선택 수정 배치 1회, 섹션 전체 재작성 최대 2개. 한 번에 최대 12개 수정 제안. 모두 설정 상수로 두고 최적값으로 주장하지 않는다.
- 재작성한 섹션은 그 섹션만 재검증한다. 전역 참조·의존 관계와 문항 무효화는 다시 계산한다. 상한을 넘는 문제는 `unresolved`로 보고하며 조용히 승인하지 않는다.
- 두 모드 모두 선택적 의미 복구는 Sol을 사용한다. 이는 명시된 역할이지 Luna 실패를 숨기는 자동 폴백이 아니다. 전송 오류를 무제한 Sol 대체 호출로 바꾸지 않는다.

### 4.4 피드백 루프 보완 — 우측 분석 반영, 두 모드 공통 필수

2026-10-07 우측 Herdr 분석 세션(`w1:p1S`)의 피드백 루프 보고를 읽고 `lib/stages.js`의 `fix()` 및 T5 경로와 대조했다. 확인한 사실과 해석을 구분한다.

| 관측/코드 | 의미 | v2 변경 |
|---|---|---|
| `fix()`가 오류가 전부 `VAL_BLOCK_DECLINED`인 블록을 제외하고 envelope가 있는 오류 블록만 `bad`로 선택 | 모델이 null로 둔 블록은 현재 형식 복구 후보가 아니다. 서버 salvage는 별도 복구됨 | null/거절/누락에 대한 명시적 후보 분류와 근거 기반 복구 경로 추가 |
| 섹션 검증 오류 `v.errors.length`가 있으면 `fix()`가 일찍 반환 | 커버리지 등 섹션 수준 결함이 블록 repair만으로 복구되지 않음 | 섹션 누락을 별도 진단하고 작은 범위 재계획/재작성 대상으로 분류 |
| 독립 군 형식 복구 fixed=2, still_bad=1; fork 완주 fixed=0, still_bad=1 | 호출 실행이 복구 성공을 의미하지 않음 | 이전 오류와 재검증 오류의 차이로 실제 성공 판정 |
| 완주 fork relink=2/2, repair=0/0 | 두 low 주장이 근거 재연결로 해소돼 T5 문장 수정이 필요 없었음 | 성공한 relink 후 불필요한 rewrite를 추가하지 않음 |
| fork claim collateral=16, 별도 LOSS_CASCADE direct=2/cascade=1 | 주장 동반 손실과 블록 의존 연쇄는 다른 단위 | root cause를 연결하고 선행 블록 복구 후 연쇄 정리 |

우측 보고는 Luna 군에서 VAL_BLOCK_DECLINED 13건, writer 보류 16건을 구분했다. `SUPPORT_RECOVERY repair=0/0`만으로 거절 복구 경로의 부재를 증명할 수는 없다. 이번에는 `fix()`의 명시적 제외 조건을 함께 확인했다. 또한 T5는 내용이 있는 주장에 적용되므로 null 블록 복구의 대체 수단이 아니다.

#### 실패 종류별 처리

| 원인 분류 | 첫 조치 | 모델 호출 조건 | 최종 상태 |
|---|---|---|---|
| 근거 부족/인식 불가 | 관련·인접·정정 근거를 제한 범위로 확인 | 새로 확보한 근거가 있을 때만 작성 | 근거가 없으면 보류 유지 |
| 작성자 null/이유 미상 | 계획의 필요성, 실제 근거, 중복 여부를 코드/검수로 확인 | 근거가 있고 미충족 핵심 항목이면 Sol로 해당 블록 재작성 1회 | 통과 또는 이유 있는 보류 |
| 정책·권한·보호 관련 거절 | 중단/제외 사유 유지 | 우회 목적의 다른 모델 호출 금지 | blocked/held |
| 스키마·표 구조·참조 실패 | 의미를 바꾸지 않는 코드 정규화 먼저 | 여전히 불량이면 정확한 오류+원래 의미 초안+근거로 Sol repair 1회 | 통과 또는 pending |
| T5 low | 근거 재연결 후 재판정 | 미해결이고 근거가 충분할 때만 최소 주장 수정 | 재검증 통과 또는 pending |
| 선행 블록 손실 | 의존 그래프에서 root를 찾음 | 근거 있는 root만 우선 복구 | root 실패 시 종속 주장을 확정 표시하지 않음 |
| 그림 누락·페이지 분리 | asset 연결/렌더 geometry 진단 | 의미 해석 변경이 필요한 경우만 모델 사용 | 공통 코드 복구 또는 명시적 결함 |

작성자 null 사유는 새 초안 응답의 선택적 실험 메타데이터로 `insufficient_evidence / duplicate / unsupported_format / policy / unknown`을 받을 수 있다. legacy null은 unknown으로 처리한다. 모델이 붙인 사유는 사실로 신뢰하지 않고 근거·권한·계약과 교차 확인한다. 최종 Note 저장 스키마를 사유 기록 때문에 바꾸지 않는다.

#### 닫힌 복구 루프와 종료 조건

```text
발견 → 원인/대상/의존성 분류 → 복구 가능성과 예산 확인
 → 최소 수정 → 형식·근거·숫자·참조 재검증
 → 해결/부분해결/미해결 기록 → 영향받은 자식만 재검증
 → 고정 상한 또는 개선 없음이면 종료
```

1. T5 이전의 구조 복구와 null 구제는 섹션별 후보를 모아 작은 repair 묶음으로 보낸다. 기존 `repair.previous`가 null을 지원하지 않으면 억지 봉투를 만들지 말고 실험용 `regenerate_missing` 입력 계약을 명시적으로 추가한다.
2. 초기 초안과 의미 ledger는 검증 과정에서 메모리에 보존한다. root가 복구됐을 때 이미 파괴된 자식 내용을 새로 추측하지 말고 원래 초안을 대상으로 재검증한다. 실제 근거가 없는 root를 점수 상승만으로 복구하지 않는다.
3. 형식 복구, T5 근거 재연결, 의미 재작성은 각각 원인별 1회지만 공통 금액 예산과 **대상별 의미 재작성 최대 1회**를 함께 적용한다. 통합 검수도 이미 복구한 대상을 새 ID로 바꿔 다시 호출할 수 없다.
4. 코드 오류 서명이 동일하고 새 근거/새 수정 제약도 없으면 같은 프롬프트 재시도를 하지 않는다. 문자열/동일성 비교는 메모리에서만 하고 내용 해시는 telemetry로 보내지 않는다.
5. 처리 우선순위는 핵심 learningItem의 선행 root → 핵심 조건·예외 → required visual → 나머지다. 단순히 judge 점수가 가장 낮은 순서만 사용하지 않는다.
6. 잘못된 수정은 마지막 검증 통과 상태로 되돌린다. 처음부터 검증 통과 상태가 없던 null은 pending으로 남긴다. 학생에게 확정 사실로 표시하지 않는다.
7. 검수가 새 누락을 발견하면 전역 본문 재작성 대신 남은 1회 선택 수정 배치에 포함한다. 이미 상한을 썼으면 unresolved로 표시한다. 요청 크기 분할은 새 복구 라운드가 아니라 같은 라운드의 하위 작업으로 과금·횟수를 합산한다.

콘텐츠 없는 추가 지표: `repairEligible / attempted / succeeded / stillBad / skippedNoEvidence / skippedBudget / stoppedNoProgress`, `declinedRecovered`, `rootRecovered`, `dependentClaimsRestored`, 원인별 비용. 대상 단위(block/claim/section)를 반드시 함께 표기하고 같은 대상의 여러 이벤트를 성공 여러 건으로 세지 않는다. 호출 시도와 실제 개선을 구분한다.

추가 합성 fixture: 충분한 근거가 있는 writer-null은 1회 구제, 근거 없는 null은 호출 없이 보류, root 복구 후 자식 재검증, root 실패 시 자식 비확정 유지, 표 형식 수정 시 정상 주장 보존, relink 성공 시 rewrite 0회, 같은 오류 반복 시 종료, 통합 검수와 T5의 동일 대상 중복 복구 방지. 이 fixture를 두 모드 모두 통과해야 한다.

## 5. sol-fork-2의 캐시 계약

### 5.1 prefix와 suffix를 코드에서 구별

```text
P = 고정 developer 지시
  + 계획 요청의 공통 자료
  + Sol 계획 응답의 native output items
  + 고정 user/input_text cache anchor

작성 = P + 해당 섹션 작업
검수 = P + 검증된 섹션 및 검수 작업
문항 = P + 확정 섹션 및 문항 작업
```

anchor의 텍스트는 모든 fork에서 동일하고 `prompt_cache_breakpoint:{mode:"explicit"}`를 둔다. 계획 응답 자체는 생성됐다는 이유만으로 입력 캐시에 쓰인 것으로 간주하지 않는다. 후속 요청에서 P가 처리돼야 전체 P의 재사용 여부를 측정할 수 있다.

- `prompt_cache_options:{mode:"explicit",ttl:"30m"}`, `reasoning.context:"all_turns"`, `include:["reasoning.encrypted_content"]`는 공식 문서·실 endpoint가 지원하는 범위에서 유지한다.
- 새로운 anchor는 완료된 계획 뒤에서만 추가한다. 미완료 function call과 그 결과 사이에 끼우지 않는다. native reasoning·출력 항목을 재정렬·요약·재생성하지 않는다.
- 일회성 섹션 suffix에는 breakpoint를 넣지 않는다. 실패한 동일 작업의 재시도 캐시가 유리한지는 별도 계측 후 결정한다.
- 현재 모든 단계 프롬프트를 이어붙인 `systemFor`를 그대로 유지할 필요가 있는지 조사한다. v2 전용 공통 지시는 짧게 고정하고 단계별 지시·스키마는 작업 suffix에 둔다. 필요한 규칙을 삭제하여 품질을 희생하지 않는다.
- 같은 원문 근거가 P와 suffix에 중복되는지 계측한다. P에 완전한 근거가 있는 Sol fork는 섹션별 ID 선택과 추가 근거만 붙이는 방식으로 중복을 줄인다. Luna는 P를 받지 않으므로 실제 근거 본문이 별도로 필요하다.
- 직렬화 순서, 옵션, 도구 정의, 모델·effort를 실행 중 고정한다. 시각·run ID·섹션 ID는 P 앞부분에 넣지 않는다. 내용 해시는 원격 식별자로 전송하지 않는다.

### 5.2 웜업 정책과 비용

초기 v2는 기존처럼 첫 유효 섹션 요청 하나를 마친 뒤 나머지를 병렬 실행한다. 전용 더미 생성으로 캐시를 데우지 않는다. 이후 작은 ablation으로 웜업 게이트 유무를 비교한다. plan cache write가 있었다는 이유만으로 계획 **출력까지** 캐시됐다고 판단해 게이트를 제거하지 않는다.

계측은 cached input / cache write / uncached input / completion / reasoning / reported cost를 분리한다. reasoning이 completion에 포함되는 공급자는 비용을 이중 합산하지 않는다. cache write 역시 일반 입력 비용에 무조건 가산하는 수수료로 계산하지 않는다. 가격은 실행 시 실제 모델/endpoint 가격과 보고 사용량을 기준으로 한다.

`session_id`는 불투명 난수이며 라우팅 힌트다. 영구 대화 저장이나 hit 보장이 아니다. `provider.order`는 sticky routing보다 우선하므로 v2 Sol 요청은 기존 검증된 allowlist의 `only`를 사용하고 불필요한 `order`를 제거한다. Luna도 지원 여부를 확인해 같은 원칙을 적용하되 Sol과 Luna의 캐시를 공유한다고 가정하지 않는다.

## 6. sol-luna-2의 캐시·문맥 계약

Sol 계획의 P는 통합 검수·전역 생성·선택 수정에 재사용한다. Luna에는 Sol의 encrypted reasoning을 넘기지 않는다. `editorialPlan`이라는 명시적 결과로 의도를 전달한다.

Luna는 자체 공통 접두(작성 규칙·공통 용어·고정 스키마)와 작업 suffix를 분리한다. 모델별 cache parser·지원 파라미터는 기존 `server/llm.js`를 재사용한다. Luna의 첫 쓰기 프리미엄과 재사용 횟수를 포함해 총비용을 비교하고, 캐시를 위해 무관한 텍스트로 접두를 부풀리지 않는다.

서버는 Luna 워커마다 account model allowlist·동의·잔여 quota·전역 provider 슬롯을 검증하고 별도로 과금한다. 하나의 부모 Sol 예약이 모든 Luna 호출을 덮는 것으로 처리하지 않는다.

## 7. 전송·실행 상태·오류

- `devNoteMode`에 두 이름을 추가하고 설정→background/offscreen→runNote→service request→server allowlist→실험 도구 전체를 연결한다. 기존 4군과 기본 빈 값은 그대로 유지한다.
- 모드별 단계 모델 테이블을 명시적으로 사용한다. `models.write` 하나를 바꾸는 것으로 검수까지 Luna에 보내거나 모든 작성까지 Sol로 바꾸지 않는다.
- 기존 `noteSession` v1 봉투에 모드 enum을 추가해 재사용한다. 혼합 모드의 Luna 요청에는 Sol history를 싣지 않는다. plan 응답 P와 작업별 continuation은 별개 변수다. 병렬 작성 응답이 P를 덮어쓰면 실패다.
- 현재 fork 구현은 두 번째 user 아이템 앞을 P로 해석한다. v2의 고정 anchor도 user이므로 이 휴리스틱을 그대로 쓰면 P가 잘린다. **v2 전용으로 검증된 plan 완료 구간 + 정확히 정의한 anchor까지**를 P로 파싱하고, 그 뒤의 작업만 continuation으로 취급한다. 클라이언트가 보낸 임의 길이 숫자를 그대로 신뢰하지 않는다. anchor 누락·중복·변조와 다른 작업 혼입을 거절하는 테스트를 추가한다.
- 혼합 모드의 루트 선택·단계 모델 제한을 서버에서도 검증한다. 클라이언트 설정만 신뢰하지 않는다. 필요하면 기존 요청의 실험 모드 필드를 추가하되 명시적 strict allowlist를 사용한다.
- pending 재개는 해당 작업의 이력만 이어가며 완료된 provider call을 중복 실행하지 않는다. 기존 요청 ID / 단계별 시도 기록과 최대 3회 HTTP continuation 계약을 유지하고 초과 시 원인을 반환한다.
- 서버 본문을 보관하는 세션 DB·원문 캐시를 만들지 않는다. 원문·history는 실행 메모리, 기존 허용된 파생 체크포인트는 AES-GCM 암호화만 사용한다. history 자체를 settings·로그·새 평문 파일에 쓰지 않는다.
- 계정/모델 제한, ZDR, `data_collection:"deny"`, 기존 consent를 유지한다. 제공자 오류를 해결하려고 정책을 완화하지 않는다. 공급자별 캐시 retention과 ZDR 호환은 별도 확인한다.
- 본문 크기와 토큰/출력 상한을 전송 전에 검사한다. 큰 검수 입력은 관련 단원 묶음으로 나누고 분할을 기록한다. 근거를 조용히 잘라 성공으로 처리하지 않는다.
- 비용 예산은 실행자가 `maxCostUsd`를 명시해야 한다. 새 호출 전 예약액+이미 보고된 비용을 검사하고 예약/추정/실측을 구별한다. 최초 pilot 결과를 보고 본 실험 예산을 산정한다.
- 429/timeout은 기존 bounded retry·backoff를 따르며 재시도 비용을 포함한다. 취소는 모든 워커로 전달하고 memory state·슬롯을 해제한다.

## 8. 품질을 위한 공통 조판·그림 조건

두 모드는 같은 renderer commit과 NoteSpec을 사용한다. 모델 비교 중 한 군에만 조판 개선을 적용하지 않는다.

1. 그림 ID의 선택→계획 배정→본문 참조→렌더까지 같은 asset 단위로 추적하고 실패 이유를 기록한다. 현재 figure funnel 숫자는 분모가 같다고 보장되지 않는다.
2. 핵심 그래프에는 본문의 해석 주장과 연결을 요구한다. 단순 그림 나열이나 캡션 개수는 시각화 품질 점수가 아니다.
3. 인쇄에서 제목·그림·최소 해설을 같은 지면 단위로 유지한다. 한 페이지보다 큰 자료는 설명 가능한 분할/크기 조절을 사용하고 글씨를 무조건 축소하지 않는다.
4. IMFACT·LIMIT의 내용 자체를 복제하지 않고 개념 계층, 비교 축, 사례 단서→해석, 조건·예외, 답과 근거의 대응을 재현한다.
5. 문항은 최종 확정 본문만 사용한다. 생성 후 참조 대상이 탈락하면 재검증하고 누락 상태를 노출한다.
6. PDF 전체 페이지 축소 검토와 표·수식·그림·문항 대표 페이지 확대 검토를 모두 수행한다. 화면 DOM preflight를 실제 print pagination 검증으로 표현하지 않는다.

## 9. 구현 분담과 파일 경계

| 담당 | 주요 파일 | 산출물 / 다른 담당과의 계약 |
|---|---|---|
| 서버·캐시 | `server/note-session.js`, `server/index.js`, `server/llm.js`, 관련 테스트 | 모드/단계 라우팅, P와 suffix, 계획 응답, 사용량·한도 |
| 클라이언트 실행 | `lib/stages.js`, `lib/service-client.js`, `lib/settings.js`, `offscreen.js`, `background.js` 및 테스트 | 단계별 모델, worker 동시성, P 소유권, 재개·취소, 출력 캐시 우회 |
| 편집·품질 계약 | `server/prompts.js`, `lib/section-draft.js`, `lib/note-contract.js`, 관련 테스트 | editorialPlan schema와 교차검증, 최소 수정 op, lineage 재검증 |
| 실험·QA | `tools/note-session-experiment.mjs`, 관련 테스트·보고서, 기존 auto debug | 실제 service/runNote 경로, 비용 집계, 블라인드 품질 평가·PDF 점검 |

조판 수정은 공통 담당자를 한 명 지정한다. 같은 파일을 여러 워커가 동시에 수정하지 않는다. 각 담당자는 합성 fixture로 계약을 먼저 맞추고 호스트가 통합한다. 서버 bundle·landing vendor mirror는 통합 후 한 번 생성/동기화한다. 기존 서버 모듈을 복제한 별도 실험 서버를 만들지 않는다.

## 10. 테스트 계획

### A. 회귀·계약 테스트 — 실제 과금 전

- 두 모드 이름의 settings부터 서버까지 전달, 미지원/허용되지 않은 모델의 명시적 거절.
- sol-luna-2: plan/review/global/선택수정=Sol, draft/questions=Luna High. 섹션별 Sol 사전 허가·전체 재작성 호출 0건.
- sol-fork-2: 각 쓰기의 P가 정확히 동일하고 다른 섹션 결과가 혼입되지 않음. 병렬 호출과 continuation·취소를 포함.
- P의 cache anchor와 일회성 suffix breakpoint 부재, 실제 전송 body를 검증. cache hit는 mock만으로 입증하지 않는다.
- 계획/편집 sidecar strict 검사, 알 수 없는 참조·순환 의존·임의 patch 경로·근거 없는 수정의 거절.
- 중복 통합 시 고유 조건 보존, 수정분 재검증 실패 시 원복/보류, 변경 없는 주장에 T5 중복 호출 방지.
- 형식 실패·429·timeout·pending·예산 종료에서 이중 실행/과금 누락 방지. null 사용량과 실제 0 구분.
- 원문·history·artifact ID와 연결되는 민감 정보를 로그/설정에 남기지 않는 검사.

필수 게이트:

```sh
node --test lib/*.test.js server/*.test.js tools/*.test.mjs
node tools/package-cws.mjs --dry-run --skip-tests
```

### B. API 연결·캐시 probe

강의가 아닌 합성 자료로 실제 Sol/Luna endpoint 지원을 확인한다. 같은 P+다른 suffix를 순차·병렬로 보내 cached/write 토큰과 비용을 측정한다. P/작업 길이만 기록하고 본문·키를 기록하지 않는다. cache ratio의 분모와 hidden/reasoning 제외 여부를 보고서에 적는다.

warm/cold는 실제 읽기 토큰으로 판정한다. 새 run ID만으로 cold라고 이름 붙이지 않는다. 동일 공유 prefix가 모델 캐시에 남아 있을 수 있다. 강제로 의미 없는 텍스트를 바꿔 캐시를 깨는 테스트는 품질 실험과 분리한다.

### C. 실제 사용자 흐름 pilot

두 모드 각 1회, 같은 암호화 입력 패키지·옵션·Plan+editorialPlan을 사용한다. 고정 계획은 실험 실행 메모리에서 재사용한다. 한 실행의 native Sol 계획 응답을 같은 모델의 P로 유지하되 Luna에는 명시적 계획만 전달한다. 계획의 비용은 공유 실제 비용과 군별 독립 실행 환산을 따로 보고한다.

local stage/call/output cache는 우회한다. provider prompt cache만 측정한다. `input.models.noteMode`와 `deps.noteMode`를 기존 production wiring과 동일하게 전달해야 하며 도구의 모드 문자열만 바꿔 production 경로를 생략하지 않는다.

실제 Chrome 확장 → 로그인/동의 → 암호화 자료 재생성 → 노트 표시 → 암호화 저장 → 인쇄 미리보기까지 **디버그 자동화 탭의 기존 auto debug 세션**에 위임한다. 테스트 전 host가 서버 배포 버전·확장 버전·모드·예산·기대 모델 테이블을 전달한다. 유료 호출은 명시한 예산 안에서만 한다. 원문/PDF를 새로운 평문 산출물로 자동 저장하지 말고 기존 개인정보 규칙에 맞는 메모리 검토와 암호화 아카이브를 사용한다.

### D. 본 비교 — pilot 통과 후

- 3종 강의: 개념·논증, 수식·계산, 도표·데이터. 각 모드 3회/강의 = 18개 결과를 초기 제안 규모로 삼는다. 실제 실행 전 pilot 비용으로 예산을 확정한다. 이 규모가 통계적 유의성을 보장하지는 않는다.
- 고정 계획 paired 비교와 계획부터 새로 만드는 end-to-end 비교를 구별한다. 후자는 최소 각 모드 1회/강의, 비용을 별도로 산정한다.
- 실행 순서를 교차하고 cached token 실측을 함께 기록한다. 현재 independent와 구 sol-fork도 같은 코드/renderer로 재실행한 일부 anchor를 두어 회귀를 확인한다. 과거 $0.142/$0.990와 직접 개선율을 계산하지 않는다.
- 원문 기준 핵심·조건·예외·그림 목록은 후보 출력과 독립적으로 사람이 고정한다. 후보 모델의 learningItems만 분모로 사용하지 않는다.
- 피드백 루프 효과는 같은 최초 초안의 복구 전/후로 측정한다. 필요 시 암호화 또는 메모리 스냅샷에서 구 루프와 새 루프를 재생해 비교한다. 작성 모델 차이와 복구 정책 차이를 섞어 모든 개선을 모델 공로로 돌리지 않는다. 추가 복구 비용과 실제 복구된 핵심 항목 수를 함께 보고한다.

## 11. 결과 판정과 보고 형식

**치명 결함:** 핵심 수식/인과/비교의 오류, 핵심 근거 누락, 핵심 시각 자료 미표시, 답할 수 없는 문항, 읽을 수 없는 인쇄 잘림. 하나라도 남은 결과는 완성 품질 통과로 집계하지 않는다.

블라인드 PDF 평가의 항목별 0–4점: 정확성·근거(30%), 내용 보존/조건·예외(20%), 개념 구조·학습 순서(15%), 의미 있는 시각화·본문 연결(20%), 문항·해설(10%), 조판 가독성(5%). 이는 초기 평가 규칙 제안이며 학습 효과 검증 점수가 아니다. 오류는 항목 평균에 숨기지 않고 별도 나열한다.

사람 평가가 없으면 자동 품질만 보고하고 승자를 확정하지 않는다. 품질 동등 허용폭은 첫 결과를 보기 전에 정한다(초기 제안: 100점 환산 3점, 어느 핵심 항목도 악화하지 않음). 표본이 작으면 동등성이 입증됐다고 말하지 말고 관측 차이와 평가자 의견을 보고한다. 동등 후보에서 비용, 마지막으로 시간을 비교한다.

콘텐츠 없는 결과 행:

```text
mode, buildVersion, serverVersion, prompt/schemaVersion,
fixtureAlias, repeat, fixedPlan|endToEnd, rendererVersion,
actualModels/providers/efforts, providerCallCount, retries,
input/cacheRead/cacheWrite/output/reasoningTokens,
reportedCostUsd, estimatedCostUsd, reservedUsd, costUnknownCalls,
generationMs, persistenceMs, endToEndMs,
sourceCoverage, conditionsCoverage, exceptionsCoverage,
direct/collateral/cascadeLoss, questionsAnswerable,
requiredVisuals/verifiedRenderedVisuals, printDefects,
humanScores, criticalErrors, complete|degraded|failed|unreviewed
```

fixtureAlias는 보고서용 불투명 별칭이다. 계정·강의 ID·제목·원문·원문 해시를 넣지 않는다. 비용은 실패 실행까지 포함한 총액/품질 통과 수와 성공 실행 자체의 비용을 둘 다 보고한다. 통과 0건이면 단가를 0으로 쓰지 않는다. 캐시 비용/추론 비용이 이중 집계되지 않았는지 공급자 usage와 대조한다.

## 12. 완료·배포·인계 체크리스트

- [ ] 두 이름으로 실제 확장과 service를 끝까지 실행할 수 있다.
- [ ] 기존 모드/기본 경로 회귀 없음, 공통 PDF 결함과 모델 결함을 분리해 보고했다.
- [ ] 모든 실제 provider call이 모델·stage·시도·비용에 귀속된다.
- [ ] 공식 API 지원과 privacy 조건을 실제 endpoint probe로 확인했다.
- [ ] 필수 테스트·패키징·합성 캐시 probe·실사용 pilot 증거가 있다.
- [ ] 사람이 PDF를 검토했는지, 자동 계측만 했는지 표시했다.
- [ ] 필요 시 `node tools/bump-version.mjs minor`로 한 번 올리고 한국어 changelog를 작성한다. 이번 문서만으로 bump하지 않는다.
- [ ] 통합 후 `node tools/build-edge.mjs`, 필요한 landing vendor mirror 동기화, Supabase CLI로 연결 프로젝트를 재확인 후 api만 배포한다. 배포 권한은 인계 당시 사용자 지시를 따른다. DB 변경은 실제 필요한 경우만 최소 migration으로 한다.
- [ ] 구현/테스트/배포/품질 판정 상태를 구분한 `sol-v2-results-YYYY-MM-DD.md`를 이 디렉터리에 작성한다. 결과 없으면 수치를 채워넣지 않는다.

## 13. 다음 에이전트에게 전달할 짧은 작업 지시

> 이 문서의 sol-luna-2와 sol-fork-2를 기존 실제 서비스·확장 경로에 구현한다. 기존 변경을 보존하고 단계별 모델 라우팅·고정 prefix·편집 검수·사용량 계약을 먼저 맞춘다. 품질을 비용보다 우선한다. 합성 계약 및 캐시 probe 후, host가 승인된 배포와 실험 예산을 전달하면 기존 auto debug 세션에서 사용자 흐름을 검증한다. 문서의 완료 조건과 결과 형식으로 보고한다. 커밋·푸시·기본 모델 변경은 별도 지시 없이 하지 않는다.

## 14. 공식 문서·개발 커뮤니티 조사와 반영

확인일 2026-10-07. Aside 조사 세션 `hrocrERSGPSZMDOH`에서 공식 페이지와 GitHub 이슈 본문을 조회했다. 아래는 API 계약, 작성자 경험 보고, 이 프로젝트의 설계 결정을 구분한 기록이다. 커뮤니티 이슈는 공급자 동작의 보장이나 해결된 원인으로 취급하지 않는다.

### 공식 근거

| 출처 | 확인한 내용 | 이 문서에 반영한 결정 |
|---|---|---|
| [OpenAI Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching) | 렌더링된 접두 일치가 필요. explicit 모드에서 마지막 breakpoint 뒤 입력은 캐시 쓰기 없이 처리. GPT-5.6 이후 최소 TTL 30m, 현재 Sol read 0.05×/write 1.25× 일반 입력 요율 | §5의 고정 P·anchor·일회성 suffix 분리. 요율은 실행 시 provider 보고와 재대조. 캐시 쓰기 요율을 일반 입력에 추가 가산하지 않음 |
| [OpenAI Function calling](https://developers.openai.com/api/docs/guides/function-calling) | 함수 호출은 모델 요청→애플리케이션 실행→결과 전달의 다단계 흐름. reasoning 모델은 관련 reasoning 아이템도 이어 전달 | §1의 코드 워커 선택. 진짜 함수 도구를 후속 실험에 넣으면 call_id 및 native 출력 보존. 매 섹션 Sol 왕복을 기본으로 추가하지 않음 |
| [OpenRouter Responses overview](https://openrouter.ai/docs/api/reference/responses/overview) | Responses 경로는 stateless이며 대화를 요청에 명시적으로 제공 | 서버 세션 저장소를 만들지 않고 클라이언트 메모리에서 P 관리. 실제 SDK/route 지원은 probe로 재확인 |
| [OpenRouter Prompt caching](https://openrouter.ai/docs/guides/best-practices/prompt-caching) | provider.order는 sticky routing에 우선. session_id는 라우팅 키를 제공하며 sticky routing 비활성 만료는 10분 | §5/6의 only allowlist·불투명 session ID·order 검토. provider의 30m 캐시 TTL과 router의 10분 sticky TTL을 같은 것으로 취급하지 않음 |

### 커뮤니티의 일차 경험 보고

| 출처·작성일 | 작성자가 보고한 현상과 한계 | 채택한 예방/검증 |
|---|---|---|
| [openai/codex #24704](https://github.com/openai/codex/issues/24704), 2026-05-27 | GPT-5.5 forked subagent가 부모 문맥을 상속해도 새 thread cache key 때문에 낮은 캐시 재사용이 나타난다는 보고. 원인 진단은 작성자 주장, Codex CLI 사례 | 작업 ID와 공유 prefix 라우팅 ID를 구분. 새 fork라는 이유만으로 공통 캐시 키를 바꾸지 않음. 실제 hit는 토큰으로 검증. Sol API에서도 동일 버그가 있다고 단정하지 않음 |
| [openai/codex #35416](https://github.com/openai/codex/issues/35416), 2026-07-26 | 세션 도중 새로운 reasoning effort로 변경할 때 큰 miss가 관측됐다는 보고. 내부 원인은 확정되지 않음 | 첫 비교에서 모델·effort·지시를 고정. effort 변경 실험은 분리. 특정 configuration_update 기능을 OpenRouter가 지원한다고 가정해 도입하지 않음 |
| [anthropics/claude-code #44045](https://github.com/anthropics/claude-code/issues/44045), 2026-04-06 | SDK resume에서 첫 메시지 skill_listing 블록 차이와 반복적인 부분 miss를 보고. Anthropic SDK 사례이며 당시 보고는 현재 Sol 보장이 아님 | 재개 전후 prefix 및 content block 순서를 검사. 이슈의 1바이트 개행 차이는 작성자도 잠재 위험으로 구분했으므로 실제 miss 원인으로 인용하지 않음 |

### 조사 결과 중 채택하지 않은 추론

- Aside 요약의 “모든 Sol 작성이 최상 품질”은 이 프로젝트의 평가로 입증되지 않았다. 두 모드의 승자는 §11 기준으로 결정한다.
- “계획 호출이 완료됐으니 계획 응답까지 캐시됐다”, “웜업 한 번이면 cache miss가 없어짐”, “동일 session ID가 동일 물리 서버를 보장함”은 채택하지 않는다. 첫 유효 작성 요청을 웜업으로 쓰고 관측한다.
- 과거 CLI/SDK 이슈의 추정 원인을 현재 Sol/OpenRouter의 확정 동작으로 옮기지 않는다. 계약 테스트와 실 endpoint probe를 모두 둔다.
- self-review 모델의 승인만으로 품질 완료를 판정하지 않는다. 피드백 루프는 형식·근거·참조·geometry 등 외부 검사 결과와 원문 기반 사람 검수를 함께 사용한다.
