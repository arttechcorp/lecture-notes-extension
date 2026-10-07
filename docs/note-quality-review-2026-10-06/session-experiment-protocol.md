# 노트 세션 실험 프로토콜 (개발 전용)

2026-10-07. `sol-v2-implementation-handoff.md` §"sol-luna-2 / sol-fork-2" 및 `followup-2026-10-07.md`의 서비스 경로 실험 프로토콜이다.
도구는 `tools/note-session-experiment.mjs` — **제공자(OpenRouter)를 직접 부르지 않고** 실제 서비스 API(`/v1/plan`·`/v1/write`·`/v1/judge`)를 거친다.
실측 결과 집계 및 보고서 생성은 `tools/sol-v2-report.mjs` 가 담당하며, 결과 기록용 빈 서식은 `docs/note-quality-review-2026-10-06/sol-v2-results-TEMPLATE.md` 를 따른다.

---

## 1. 실험군 및 단계별 모델 라우팅

동일한 원입력·옵션·등급으로 여섯 군을 비교한다. 모드 이름은 클라이언트의 `devNoteMode`, `noteMode`, `noteSession.mode` 문자열과 정확히 일치한다.
우선순위는 **① 품질(정확성·구조화·시각화) > ② 품질 통과 노트당 비용 > ③ 소요 시간**이다(Spec §1).

| 군 | 계획 (Plan) | 본문 초안 (Draft) | 통합 검수 (Review) | 문항 (Questions) | 전역·복구 (Global/Repair) | 세션 및 문맥 계약 |
|---|---|---|---|---|---|---|
| `independent` | Sol | Luna High | (link) Luna High | Luna High | Luna High | 없음 — 운영과 동일한 독립 호출 (기준군) |
| `sol-session` | Sol | Sol | (link) Sol | Sol | Sol | plan/write 마다 history 를 이어 붙이는 연쇄 세션 (직렬화) |
| `sol-luna-tool` | Sol | Sol(Luna tool) | (link) Sol | Sol | Sol | Sol 대화 안에서 서버가 Luna High 도구 호출을 대행 |
| `sol-fork` | Sol | Sol (section) | (link) Sol | Sol | Sol | Sol 계획 응답 P 를 고정 접두로 공유하며 병렬 쓰기 |
| `sol-luna-2` | Sol | Luna High | Sol | Luna High | Sol | Sol 계획 P 를 review/global/repair 에 공유; Luna 는 독립 호출 (no session). writer=draft 경로 전용 |
| `sol-fork-2` | Sol | Sol (draft) | Sol | Sol | Sol | 전 단계 Sol; 고정 앵커가 포함된 P 를 공유하며 매 쓰기 호출 병렬 실행. writer=draft 경로 전용 |

- Sol 은 `openai/gpt-6.1-sol`, Luna High 는 `openai/gpt-6-luna@high` 이다.
- 두 신규 v2 모드(`sol-luna-2`, `sol-fork-2`)는 기존 `section` 대신 `writer=draft` 경로(stage `"draft"`)를 사용하며, 기존 `link` 대신 통합 편집 검수(stage `"review"`)를 실행한다.
- 공통 조건: `models.writeAlt` 없음(조용한 대체 모델 전환 금지), 연쇄 세션 군은 write 레인 1(직렬), 포크 계열 군은 일반 write 레인 병렬 실행, 로컬 출력 캐시 off(`deps.promptVersions` 미전달 + 메모리 저장소).

---

## 2. 봉투 계약 (noteSession v2 및 캐시 계약)

### 2.1 세션 봉투 모양
요청(선택 칸, `/v1/plan`·`/v1/write`):
```json
"noteSession": {
  "v": 1,
  "id": "ns-<불투명 난수>",
  "mode": "sol-session | sol-luna-tool | sol-fork | sol-luna-2 | sol-fork-2",
  "history": [ ... ]
}
```

- `history` 는 제공자 고유 응답 항목(Responses output items)의 배열이며 클라이언트는 내용을 변경하지 않고 메모리에서만 유지한다.
- 클라이언트 상한: 120 항목·128KiB. 초과 시 `note_session_too_large` 로 안전 중단한다.

### 2.2 v2 고정 접두 P 와 캐시 앵커 (Anchor Text)
`sol-fork-2` 및 `sol-luna-2`의 계획 완료 후 공유 접두 P 는 다음 구조를 갖는다:
```text
P = [ 서버 plan 작업 task, 제공자 native output items, 고정 user input_text 캐시 앵커 ]
```
- 고정 앵커는 `server/note-session.js` 가 내보내는 `ANCHOR_TEXT` 상수 문자열을 담은 단일 user 아이템이며 `prompt_cache_breakpoint: { mode: "explicit" }` 를 갖는다.
- 서버는 클라이언트가 보낸 숫자 길이를 신뢰하지 않고 이 앵커 위치로 P 를 식별한다. 앵커 누락·변조·중복 시 `request_rejected` 로 거절한다.
- **포크 규칙(Fork Rule)**: 쓰기 단계 응답 봉투는 P 를 그대로 돌려주며(턴 미첨부), 후속 쓰기 호출의 접두를 대체하지 않는다.
- **sol-luna-2 선택적 첨부**: Luna High 로 실행되는 `draft` 및 `questions` 호출에는 noteSession 봉투를 싣지 않는다(독립 호출). Sol 로 실행되는 `review`, `global`, `repair` 호출만 접두 P 를 싣는다.
- **계획 응답 확장**: v2 두 모드의 계획 응답은 `{ plan, editorialPlan, noteSession }` 을 반환하며, `editorialPlan` 은 클라이언트 실행 메모리에만 유지되고 저장 Note 스키마에는 들어가지 않는다.

### 2.3 웜업 게이트와 어블레이션 (Warm Gate & Ablation)
- 초기 v2 구현은 기존처럼 첫 번째 유효 쓰기 요청이 완료되어 P 가 제공자 프롬프트 캐시에 기록될 때까지 나머지 병렬 쓰기를 대기시키는 웜업 게이트를 유지한다.
- 계획 단계의 캐시 쓰기가 있었다는 사실만으로 계획 출력부까지 캐시되었다고 단정하여 웜업 게이트를 즉시 제거하지 않는다.
- 향후 별도의 소규모 어블레이션(ablation) 실험으로 웜업 게이트 유무에 따른 지연과 캐시 적중률을 정량 비교한 뒤 제거 여부를 결정한다.

### 2.4 서버 기능 사전검사 (Preflight)
- v2 모드 실행 전, 실험 드라이버는 `/v1/me` 응답을 통해 서버가 `writer=draft` 와 `review` 단계를 정상 지원하는지 사전검사(`preflightV2Server`)한다.
- 미지원 서버이거나 필수 단계가 누락된 경우 `server_unsupported_draft` 또는 `server_unsupported_review` 오류 코드로 즉시 중단한다.

---

## 3. 실행 및 Auto Debug 세션 연계

### 3.1 CLI 실행
```sh
SERVICE_URL=<서비스 주소> SERVICE_TOKEN=<토큰> \
node tools/note-session-experiment.mjs \
  --mode=sol-luna-2|sol-fork-2|all \
  --max-cost-usd=3.0 \
  [--input=tools/note-fixture/input.json] \
  [--repeat=1] [--writer=draft] \
  [--fixture-alias=synth-01] [--plan-comparison=fixedPlan] \
  [--out=metrics.json] [--out-rows=results.jsonl] [--dry-run]
```

### 3.2 Host 가 Auto Debug 세션에 전달해야 하는 필수 항목
실제 Chrome 확장 탭 자동 디버그 세션에서 종단 사용자 흐름을 검증할 때, Host 는 사전에 다음 항목을 전달해야 한다:
1. **확장 빌드 버전 (`buildVersion`)**: `manifest.json` 의 버전.
2. **서버 배포 버전 (`serverVersion`)**: 실제 배포된 Edge/Container 의 버전.
3. **실험 모드 (`mode`)**: `sol-luna-2`, `sol-fork-2` 등 명시적 모드 이름.
4. **명시적 예산 상한 (`maxCostUsd`)**: 반드시 명시되어야 하며, 미지정 시 드라이버가 실행을 거부함.
5. **단계별 모델 테이블 (`modelTable`)**: Sol/Luna High 라우팅 설정.
6. **서버 사전검사 확인**: 서버가 writer=draft 및 review 단계를 수용함을 확인.

---

## 4. 지표 및 결과 행 규격 (Spec 11 Format)

### 4.1 내용 없는 결과 행 (Content-Free Result Row)
각 실행은 Spec §11 규격에 따라 강의 원문·키·개인정보가 없는 JSON 행으로 기록된다:
```text
mode, buildVersion, serverVersion, promptSchemaVersion,
fixtureAlias, repeat, planComparison, rendererVersion,
actualModels, providerCallCount, retries,
tokens { uncachedInputTokens, cacheReadTokens, cacheWriteTokens, outputTokens, reasoningTokens },
reportedCostUsd, estimatedCostUsd, reservedUsd, costUnknownCalls,
generationMs, persistenceMs, endToEndMs,
sourceCoverage, conditionsCoverage, exceptionsCoverage,
losses { direct, collateral, cascade }, questionsAnswerable,
visuals { required, verifiedRendered }, printDefects,
humanScores, criticalErrors, verdict (complete | degraded | failed | unreviewed)
```

- **토큰 분리**: 순수 출력 토큰과 reasoning 토큰은 이중 합산하지 않는다(`outputTokens = completionTokens - reasoningTokens`). 입력도 미캐시 입력과 캐시 읽기를 분리한다.
- **비용 표기**: 서버 보고 비용(`reportedCostUsd`)과 보수 추정 비용(`estimatedCostUsd`), 예약액(`reservedUsd`)을 구분하며, 보고되지 않은 비용은 null 로 남기고 0으로 치환하지 않는다.
- **불투명 별칭**: `fixtureAlias` 는 보고서용 불투명 별칭(예: `synth-01`)만 사용하며 원문 ID 나 파일 경로를 포함하지 않는다.

### 4.2 결과 판정 및 보고 규칙 (`tools/sol-v2-report.mjs`)
1. **통과당 비용 보고**: 실패 실행을 포함한 총 지출 대비 품질 통과수(`costPerPassTotal`)와 성공 실행 자체의 비용(`costPerPassSuccess`)을 둘 다 보고한다.
2. **통과수 0건 처리**: 품질 통과수가 0건이면 통과당 비용은 반드시 **`n/a`** 로 표기하며 절대 0으로 쓰지 않는다.
3. **치명 결함(Critical Defects)**: 핵심 수식/인과 오류, 핵심 근거 누락, 핵심 시각 자료 미표시, 답할 수 없는 문항, 읽을 수 없는 인쇄 잘림이 1건이라도 발생하면 품질 통과로 집계하지 않는다.
4. **사람 평가 없는 승자 확정 금지**: 사람 블라인드 평가 점수가 없으면 자동 계측 품질만 보고하고 승자를 확정하지 않는다(`unreviewed`).
5. **동등 허용폭(Equivalence Margin)**: 사전 고정된 `--margin`(기본 ±3점) 이내의 품질 점수 차이는 동등으로 판정하고, 2차 기준인 통과당 비용으로 우위를 결정한다.

---

## 5. 교란 요인 (Confounds)

1. **계획 호출 독립성**: `fixedPlan` 이 아닌 `endToEnd` 비교 시, 각 군의 계획 자체가 달라져 블록/문항 수의 차이가 모델의 작성 능력 차이와 혼동될 수 있다.
2. **직렬화 vs 병렬화 지연**: 연쇄 세션 군(`sol-session`, `sol-luna-tool`)의 총 소요 시간 지연은 호출 직렬화에 의한 것이며 모델 추론 속도 저하가 아니다.
3. **웜업 게이트 대기**: `sol-fork` 및 `sol-fork-2`의 첫 쓰기 대기 시간은 제공자 프롬프트 캐시 적중을 위한 안전장치이며 순수 작성 지연과 구별해야 한다.
4. **캐시 적중 보고 의존성**: 캐시 적중률은 제공자/서버가 `cachedInputTokens` 를 응답 헤더/바디에 포함할 때만 관측 가능하다.

---

## 6. 호스트 통합 체크리스트

- [ ] `lib/stages.js`: `deps.noteMode` 허용 목록에 `"sol-luna-2"` 및 `"sol-fork-2"` 추가, 단계별 모델 배선.
- [ ] `lib/service-client.js`: `plan`/`write` 전송 시 `noteSession` 및 `editorialPlan` 전달 필드 배선.
- [ ] `server/note-session.js`: `MODES` 에 v2 모드 추가, `ANCHOR_TEXT` 캐시 앵커 식별 로직 적용.
- [ ] `server/prompts.js`: `review` 단계 스키마 및 프롬프트 배선, `draft` 작성자 지원.
- [ ] 패키지 및 배포: `node tools/package-cws.mjs --dry-run --skip-tests` 및 Edge 빌드 확인.
