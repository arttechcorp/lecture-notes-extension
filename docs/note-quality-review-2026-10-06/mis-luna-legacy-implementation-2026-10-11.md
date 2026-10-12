# mis-luna(legacy) 구현·검증 기록

기준: [승인된 기획](mis-luna-legacy-plan-2026-10-11.md). 구현 시작 2026-10-11, 브랜치 `w/dev`.

## 기준과 결정

- 기준 커밋은 `288a485c91d6e3529923abae27c1b877f5647b4b`이며, 구현 시작 시점의 미커밋 변경을 포함한 현재 `mis-sol-hai` 설정을 조립 기준으로 사용한다. `mis-sol-luna`라는 기존 등록을 가정하지 않는다.
- `mis-luna-legacy-medium` / `mis-luna-legacy-high`는 Mistral OCR·MSH 프롬프트·HTML 검수·강조 신호·마지막 프레임·fork 세션 설정을 유지하며, 모든 노트 작성 단계와 양쪽 수리를 각각 Luna medium / high로 실행한다.
- 두 변형 모두 추론용 출력 여유분을 8,000으로 고정한다. 기존 프로파일의 출력 상한은 변경하지 않는다. 비교 시 실제 공급자 요청의 상한과 effort를 검증한다.
- 일반 수리는 세션 접두 P를 사용하고 HTML 검수 후 섹션 재작성은 독립 호출한다. 모델 이름이 같아도 호출 목적에 따라 경로를 구분한다.
- 시작 시점 파일 사본·상태와 위임 브리프는 `/private/tmp/mis-luna-legacy-20261011/`에 둔다. 실강의 자료나 인증값은 기록하지 않는다.

## Herdr 위임

탭: `w1:tN` (`노트 기획 구현`). 기존 유휴 세션을 재사용한다.

| 워커 | 모델 | 소유 범위 |
|---|---|---|
| `w1:p2T` / `super-cardamom` | Devin SWE-2 High | 서버 세션·모델·출력 상한·관측, 관련 서버 테스트 |
| `w1:p2R` / `bird-maple` | Devin SWE-2 Medium | 프로파일·설정·실험 도구·실험 안내, 해당 테스트 |
| `w1:p2S` / `puzzle-valley` | Devin SWE-2 High | 클라이언트 수리 경로와 생성·렌더·암호화 왕복 통합 테스트 |
| `w1:p31` / `msh-l3` | agy Gemini 3.8 Flash High | 읽기 전용 경로 감사 및 최종 변경 검토 |

Gemini의 기존 시작 인자는 `--model gemini-3.8-flash-high --dangerously-skip-permissions`로 확인했다. 파일 소유권을 나눠 현재 작업 트리에서 병렬 구현하며, 커밋·푸시·배포·기존 변경 원복은 위임하지 않았다. 호스트가 통합·생성 산출물 동기화와 검증을 수행한다.

## 구현 결과

- 공통 레지스트리와 숨은 설정에 두 프로파일을 추가했다. 기존 프로파일의 모델·effort·출력 상한은 유지한다.
- 세션 요청의 Sol 하드코딩을 단계 레지스트리 모델로 연결했다. 별칭은 서버에서만 쓰며 실제 요청은 `openai/gpt-6-luna`와 선택 effort로 나간다.
- 일반 수리와 HTML 검수 후 재작성은 모델 동등 비교 대신 호출 목적에 따라 세션/독립 전송을 선택한다.
- 서버는 legacy 응답의 `usage.inference`에 profile, 요청/보고 모델, 보낸/보고 effort, 실제 route, attempts 및 추론·캐시 토큰을 기록한다. 미보고는 null이며 추론·캐시 토큰은 실험 도구가 읽는 최상위 usage에도 전달한다. profile·effort·route는 기존 DB 장부 스키마에 새로 저장하지 않고 응답 및 내용 없는 실험 기록에 남긴다.
- 실험 래퍼는 독립 재작성에 세션을 다시 붙이지 않는다. `noteMode`, HTML 검수·판본·누락 섹션, repair packet, 필기 images, 계획의 허용 근거·강조 신호를 보존하고 프로파일의 강조 신호 설정을 production과 맞춘다. 결과의 `requestedModels`와 공급자 보고값만 모은 `actualModels`를 구분한다.
- `node tools/bump-version.mjs minor`로 2.10.0을 준비했다. 커밋·푸시·배포는 하지 않았다.

## 검증

### 로컬 합성 검증

- 단계 통합 테스트 86/86 통과. 두 변형 모두 전 단계·일반 수리·검수 재작성에서 선택 Luna만 호출하며, 세션 접두 P/독립 호출, HTML 검수, 재작성 채택과 provider_busy 재시도를 검증했다.
- 두 변형 모두 노트 스키마 검증 → HTML 렌더 → AES-GCM 암호화 → 복호화 → 동일 HTML 재렌더를 통과했다. 이는 메모리 내 자동 테스트이며 확장 UI에서 실제 보관함을 열어본 검증과 구분한다.
- 실험 도구 테스트 30/30 통과. 프로파일·설정·실험 도구를 묶은 최종 focused 검증도 62/62 통과했다. 실제 전송에서 noteMode·HTML·판본·packet·images·강조 신호가 소실되지 않는지 검사한다.
- Gemini 3.8 Flash가 핵심 세션/수리 코드를 읽기 전용으로 검토해 blocking 결함 없음으로 보고했다. route를 실행 전 추정값으로 채우는 지적은 실제 전송이 없으면 null로 보존하도록 반영했다. 실험 래퍼의 필드 누락 2건 지적도 반영했고, 현재 파일 재검토에서 NO BLOCKING ISSUES / MODEL: Gemini 3.8 Flash를 확인했다.

### 실제 endpoint 합성 검증

기존 워커가 알려준 인증 설정을 호스트 프로세스 메모리에서 읽었다. 인증값·원문·요청/응답 본문을 로그나 저장소에 남기지 않았다. 실제 강의 자료는 전송하지 않았다.

| 변형 | 호출 | route | HTTP / 스키마 | 요청 / 보고 effort | 출력 상한 | 추론 토큰 | 시간(ms) |
|---|---|---|---|---|---:|---:|---:|
| medium | editorial strict | liner | 200 / 유효 | medium / medium | 24,000 | 24 | 4,715 |
| medium | review strict + 반환 이력 재생 | liner | 200 / 유효 | medium / medium | 12,000 | 23 | 1,350 |
| medium | 독립 strict 전송 | liner | 200 / 유효 | medium / 미보고 | 22,000 | 10 | 1,190 |
| high | editorial strict | liner | 200 / 유효 | high / high | 24,000 | 18 | 1,610 |
| high | review strict + 반환 이력 재생 | liner | 200 / 유효 | high / high | 12,000 | 21 | 1,196 |
| high | 독립 strict 전송 | liner | 200 / 유효 | high / 미보고 | 22,000 | 11 | 1,037 |

6/6 성공, 공급자 보고 비용 합계 $0.00095183. 모든 단계의 medium/high 출력 상한 일치도 production modelParams로 확인했다. 독립 호출 프로브는 실제 review 스키마를 Chat Completions에 넣은 전송 검증이며 실제 questions 스키마/문항 품질 검증은 아니다. 짧은 합성 입력의 캐시 적중은 모두 0으로, 캐시 성능을 입증하지 않는다.

**reasoning 재생 완료 판정은 보류한다.** Responses는 추론 토큰을 보고했지만 output에 message만 반환했다. 반환 message 이력 재생은 수락됐으나 native/encrypted reasoning 항목을 반환하지 않아 해당 재생은 실행하지 못했다. 다른 모델·공급자·전송 방식으로 우회하지 않았다. 이 조건을 통과했다고 표시하거나 실제 강의 비교 실험을 계속하지 않는다.

### 최종 게이트

2026-10-12 최종 실행 결과:

- `node --test lib/*.test.js server/*.test.js tools/*.test.mjs`: **1,653건 중 1,649 통과 / 3 실패 / 1 skip**. Luna 관련 회귀는 모두 통과했다. 따라서 전체 게이트 통과 또는 기획 전체 완료로 판정하지 않는다.
- 실패 3건: `tools/print-check.test.mjs`의 출시 조건 및 대표 페이지 검사, `tools/print-geometry.test.mjs`의 probe 자기 검증. 현재 HEAD의 `lib/print-check.js`는 산술 쪽 경계 추정을 결함에서 제외하지만 도구는 이전 코드를 기대하고, probe 글자 크기도 새 기준에 맞지 않는다. 별도 작업 세션 `w1:p1S`가 이 계약 변경 누락을 인정했고 자신의 트랙에서 통합할 예정이다. 이 구현에서 그 파일을 임의 수정·병합하지 않았다.
- `node tools/build-edge.mjs`: 서버 번들 재생성 완료. 번들 일치 테스트 통과.
- `node tools/package-cws.mjs --dry-run --skip-tests`: 통과, 정적 감사 위반 0건. `--skip-tests` 결과이므로 위 전체 테스트 실패를 대신하지 않는다. ZIP은 생성하지 않았다.
- `git diff --check`: 통과.
- 로그: `/private/tmp/mis-luna-legacy-20261011/{final-tests,package,live-probe}.log`.

동시 작업 세션이 stages의 두 수정 조각을 다른 트랙으로 옮기며 삭제한 사실을 확인해 해당 두 조각만 복원했다. 별도 세션과 파일 경계를 조율하고 현재 main 원본 기준 landing section-draft 사본을 동기화했다. 이 세션은 기존 dirty 작업 원복·merge·stash·stage·commit·push·배포를 수행하지 않았다. 위임한 구현/QA 결과를 모두 수집했고 이번에 만든 임시 검증 셸 `w1:p35`만 닫았다.

## 남은 완료 조건

- native/encrypted reasoning 재생은 현재 Liner 응답 형태로 검증하지 못했다.
- 동일 STT/OCR·자산으로 기준 엔진/medium/high의 실제 개념 누락·수식·도표·구조·수리·비용·시간 비교는 미실행이다. 품질·비용 우위를 주장하지 않는다.
- 확장 UI에서 실제 생성·저장·재열기 및 PDF 시각 검증은 미실행이다.
- 배포 서비스/계정의 별칭 허용 목록은 직접 endpoint 합성 검증과 별개다. 원격 설정 변경과 배포는 수행하지 않았다.
