# mis-luna(legacy) 구현 기획

작성: 2026-10-11. 상태: 기획만 작성, 미구현.

## 1. 목적·기준

기존 단계형 노트 엔진의 Sol 담당 단계를 Luna로 교체한다. 인식 → 계획 → 편집 계획 → 초안·문항 → 검수·수리 → 렌더·저장 구조는 유지한다. 새 SDK·자율 에이전트·자유 Markdown을 제안한 [mis-luna](mis-luna-feasibility-2026-10-10.md)와 별개다. 기존 프롬프트·출력 스키마도 유지하며, 사용자 작성 프롬프트 파일을 기다리는 엔진이 아니다.

**기준 이름 확인:** 현재 `lib/note-profiles.js`에는 `mis-sol-luna`가 없다. 이 문서에서는 사용자 표현을 **Mistral OCR + Sol 계획·검수 + Luna 작성인 기존 단계형 구성**으로 해석한다. 구현 시 실제 기준 프로파일/커밋을 먼저 고정한다. 현재 코드에서 조립한다면 `mis-sol-hai`의 Mistral·지면·검수 설정을 기반으로 작성 모델을 Luna로 두고, Sol 담당 단계도 Luna로 교체한다. 이는 기존 `mis-sol-luna` 등록이 확인됐다는 뜻이 아니다.

## 2. 두 variation

| 표시 이름 | 내부 ID 제안 | 모든 작성 단계의 모델 |
|---|---|---|
| `mis-luna(legacy)-medium` | `mis-luna-legacy-medium` | `openai/gpt-6-luna@medium` |
| `mis-luna(legacy)-high` | `mis-luna-legacy-high` | `openai/gpt-6-luna@high` |

계획(plan), 편집 계획(editorial), 초안(draft), 문항(questions), 검수(review), 전역 정리(global), 수리(repair), 검수 후 재작성 모두 해당 variation의 Luna를 사용한다. medium에서 기존 초안만 high로 남기지 않는다. Sol·Haiku로의 숨은 fallback도 두지 않는다.

두 variation은 **effort만** 다르게 한다. 동일 모델 버전·공급자 경로·입력·프롬프트·스키마·출력 상한·병렬도·재시도 및 검수 횟수·캐시 정책을 사용한다. 현 `server/llm.js`의 별칭은 medium/high에 `reasoningBudget`도 4,000/8,000으로 다르므로, 이 값은 추론 effort 자체가 아니라 단계 출력 상한에 더하는 여유분이다. 실제 요청의 출력 상한까지 비교해 legacy 경로에서는 같은 값으로 맞춘다. 기존 프로파일의 설정은 바꾸지 않는다.

## 3. 유지할 것

- STT·Mistral OCR, 인식 동의, 필기·그림·수식 자산 처리.
- 기존 단계별 프롬프트·JSON 스키마·근거 연결·검수 및 수리 정책.
- 계획·검수 계열의 기존 fork 세션과 초안·문항의 독립 호출 구분. 모델이 같아져도 단일 대화로 합치지 않는다.
- 수리의 세션/독립 양쪽 경로와 HTML 검수, 렌더·PDF·암호화 보관함.
- 기존 캐시 접두·usage 기록. variation별 세션/checkpoint를 분리해 effort가 다른 실행의 이력을 섞지 않는다.

## 4. 구현 범위

1. **프로파일:** `lib/note-profiles.js`에 두 행 추가. 단계의 `model`·독립 수리의 `alt`·`clientModels` 모두 variation 모델로 지정한다. 기존 프로파일 동작은 유지한다.
2. **진입·라우팅:** `lib/settings.js` 허용 목록, 실험 실행 도구, 서버 검증에 ID를 연결한다. 단계 선택은 공통 레지스트리를 사용하고 Sol 전용 이름/하드코딩이 실제 모델을 고정하지 않는지 확인한다.
3. **세션 요청:** `server/note-session.js`와 `server/llm.js`에서 Luna 모델·effort가 세션/독립 호출 모두에 전달되는지 확인한다. 현재 `solBody`의 `model: SOL` 하드코딩도 프로파일의 단계 모델로 연결해야 한다. 기존 Sol 세션의 effort·출력 상한을 무조건 상속하지 않는다. 실제 endpoint에서 reasoning 재생과 기존 strict 출력 스키마 호환을 synthetic 입력으로 검증한다. 불호환이면 중단하고 원인을 기록하며 다른 모델로 우회하지 않는다.
4. **관측·배포 산출물:** 실행 기록에 내부 ID·실제 모델·effort·route·토큰·cache usage·재시도 수를 남긴다(강의 내용 제외). 구현 시 필요한 서버 번들/배포 산출물과 테스트를 동기화한다. 새 SDK 도입이나 엔진 구조 개편은 이 작업 범위가 아니다.

## 5. 완료 기준

- 두 프로파일의 모든 단계·재작성·양쪽 수리에 Sol/Haiku 호출 0건. 실제 요청의 effort가 선택값과 일치.
- 동일 fixture에서 variation 간 요청 차이가 프로파일 식별값·effort 및 그에 따른 실행 결과뿐임을 확인. 빈 출력·거절·잘림·형식 오류는 기존 정책대로 실패 처리.
- 동일 STT/OCR·자산으로 기준 엔진/medium/high를 비교: 개념 누락·수식·도표·구조·수리 횟수·비용·시간. 품질이나 비용 우위를 사전 단정하지 않는다.
- 성공은 생성뿐 아니라 렌더·암호화 저장·다시 열기까지 확인한다.
- 구현 후 전체 테스트와 패키징 dry-run을 통과한다. 노트 출력 변경이므로 구현 커밋에서는 기존 버전 규칙에 따라 minor bump한다. 이 기획 문서에는 버전 변경이 없다.
