# mis-luna 실현 가능성 검토

작성·공식 문서 확인: 2026-10-10. 상태: 설계 제안, 미구현·실측 전. 기존 mis-sol-hai와 별개 프로파일이다.

## 1. 결론과 요청 해석

실현 가능하다. 모든 STT/OCR 텍스트를 한 Luna High 대화에 제공하고, 같은 에이전트가 필요한 만큼 작성·미리보기·수정을 수행하게 한다. 한 세션은 한 번의 API 호출을 뜻하지 않는다. 매 호출은 유한하며 대화 상태를 이어받는다. 품질 향상·비용 절감은 아직 가설이다.

사용자가 확정한 경계: 시스템 지시·도구 설명·검수 지시는 사용자가 직접 작성한다. Luna가 작성한 노트와 도구 실행 결과는 같은 세션의 수정 작업에 재사용할 수 있다. 이를 새로운 system/developer 명령으로 승격하지 않는다. 개발 에이전트가 만든 자연어 지시문, 자동 프롬프트 개선, 상위 모델이 작성하는 실행 지시를 제품 추론에 넣지 않는다.

이 문서는 구현자를 위한 설계이며 모델에 전달하지 않는다. 동반 파일 `mis-luna-user-prompts.md`도 전체를 전송하지 않는다. 그 파일의 사용자가 채운 명시적 본문 영역만 추출하는 방식으로 설계한다.

`mis`는 기존 Mistral OCR 경로를 유지한다는 의미다. STT도 기존 선택을 유지한다. 이번 변경은 인식 이후의 작성 경로다. OCR/STT 자체의 기존 지시·annotation 옵션까지 사용자 작성으로 통일할지는 따로 감사한다. 초기 실험에서 OCR annotation·사전 LLM 개념 추출·중요도 판정·계획 요약 결과를 새 작성 입력에 섞지 않는다.

## 2. 세 가지 접근

| 방식 | 이점 | 한계 | 판단 |
|---|---|---|---|
| 전체 자료 → Luna 한 번 → Markdown | 최소 호출·최소 하네스, 비교 기준이 명확 | 길이 초과·잘림·누락·지면 오류를 스스로 확인 못 함 | 기준 실험 A |
| 전체 자료 → Luna 단일 세션 + 제한된 도구 | 작성 순서와 수정 결정을 모델이 맡고 실제 렌더 결과를 볼 수 있음 | 대화 증가·반복 비용·복구 설계 필요 | 권장 실험 B |
| 기존 단계 파이프라인의 모델만 Luna로 변경 | 기존 코드를 많이 재사용 | 기존 계획·블록 스키마·작성 지시가 그대로 남음 | 요청과 다르므로 제외 |

초기에는 서브에이전트, 별도 judge, 메모리 요약 에이전트가 없다. 일반 shell·웹 탐색·임의 파일 접근도 노트 작성에 필요하지 않다. 자율성은 자료 구성·설명·도구 선택·수정 판단에 부여한다.

## 3. Aside에서 실제 확인한 것과 미확인인 것

확인 근거: 설치된 공식 Aside CLI 1.26.1008.1938의 `aside guide`, `aside guide repl`, `aside skills show aside`, 읽기 전용 설정 조회. CLI는 스킬의 갱신 지침에 따라 업데이트했다. 아래 값은 이 계정의 현재 설정이지 모든 Aside 설치의 기본값이 아니다.

| 관찰된 기능 | mis-luna에 적용 |
|---|---|
| `exec`로 작업 세션 생성, `resume`으로 후속 작업 | 강의당 하나의 논리 세션, 중단 뒤 동일 작업 재개 |
| `steer`는 현재 실행 방향 변경, `queue`는 다음 단계 이후 처리 | 사용자 수정 요구를 별도 턴으로 추가; 실행 중 상태 덮어쓰기 금지 |
| 지속되는 JS REPL과 도구 반환값 | 메모리 안 노트 초안·자산·렌더 상태를 도구가 관리 |
| snapshot 후 행동, 행동 뒤 diff 확인 | render 결과·오류 위치를 관찰하고 바뀐 부분만 재검증 |
| 세션 메시지·도구 결과·자식 세션 조회 API | 추적 가능한 호출 원장; 이번 버전은 자식 세션 불필요 |
| Markdown 메모리를 별도로 관리 | 강의별 자동 요약 메모리는 초기 버전에서 도입하지 않음 |
| compaction enabled, reserveTokens=16384, keepRecentTokens=20000 | 여유 공간과 최근 결과 보존 개념만 참고. 수치 복사 안 함 |
| retry enabled, maxRetries=3, baseDelayMs=2000, maxDelayMs=60000 | 한도 있는 전송 재시도. 품질 개선 턴과 별도 집계 |

Aside가 실제로 어떤 압축 프롬프트·선별 알고리즘·캐시 breakpoint·공급자 라우팅을 쓰는지는 이 인터페이스만으로 확인되지 않았다. Aside가 무프롬프트 에이전트이거나 동일 세션만으로 캐시 hit를 보장한다고 주장하지 않는다. 비공개 내부 프롬프트나 개인 세션을 추출하지 않았다.

벤치마킹의 핵심은 **관찰 → 도구 실행 → 결과 관찰 → 수정**과 재개 가능한 실행 상태다. Aside의 저장 방식은 이 서비스의 강의 암호화·무상태 서버 원칙과 같다고 가정하지 않는다.

## 4. 모델과 API 계약

[공식 Luna 문서](https://developers.openai.com/api/docs/models/gpt-6-luna)를 Aside 브라우저로 직접 확인했다.

- native ID: `gpt-6-luna`; 현 코드 별칭: `openai/gpt-6-luna@high` → 업스트림 `openai/gpt-6-luna`.
- reasoning effort: high 지원. 기본값 medium이므로 high를 명시한다.
- context 1,050,000 tokens, 최대 output 128,000 tokens. 이는 모델 한도이며 실제 endpoint·계정·서버 한도와 다르다.
- high에서 function calling을 사용하려면 Responses API. Chat Completions의 function calling은 reasoning_effort=none일 때만 지원한다고 명시돼 있다.
- 텍스트·이미지 입력, 텍스트 출력. 음성·동영상 직접 입력 경로로 바꾸지 않는다.
- 출력 본문은 Markdown 문자열. `json_object`, 거대한 `json_schema`, 기존 SectionDraft 스키마를 강제하지 않는다.
- 도구 호출에는 최소한의 인자 계약이 필요하다. 자유로운 노트 본문과 도구의 안전한 실행 계약을 구분한다.
- 모델의 128K 출력 상한을 기본 요청값으로 쓰지 않는다. reasoning을 포함한 실제 출력량·응답 시간에 맞춰 턴 예산을 정한다.

현재 `server/llm.js`는 Luna High에 32,768 토큰 상한을 두고 있다. `server/note-session.js`에는 3MiB 이력·항목별 200,000자 등 별도 한도가 있다. 따라서 모델이 1M context를 지원해도 현재 서버에 전체 강의가 무조건 들어가는 것은 아니다.

Liner 설정이 있으면 현 `toLiner`는 GPT 계열 요청을 우회시키고 provider·prompt_cache_options·일부 reasoning 설정을 제거한다. native 공식 계약을 Liner에 그대로 적용할 수 없다. 구현 전 **실제 endpoint, high 도구 호출, 반환 아이템, usage, 취소, ZDR**를 확인한다. store:false 하나로 ZDR를 충족한다고 판단하지 않는다. 미확인 공급자에 실강의를 보내는 실험은 시작 조건을 충족하지 못한 것으로 처리한다.

### 0단계 실측: Liner 경로 (2026-10-11)

`tools/liner-luna-probe.mjs`로 합성 자료만 보내 확인했다. 모델 `openai/gpt-6-luna`, Responses API, `store:false`.

| 항목 | 결과 |
|---|---|
| high 적용 | 응답의 effort가 high로 표시됨. 추론 문제에서 reasoning 토큰 228~245개를 쓰고 정답을 냄. none은 0개에 오답. 쉬운 도구 호출 요청에서는 high여도 reasoning 0 |
| 도구 호출 | strict true와 false 모두 됨. `call_id`가 오고 인자는 올바른 JSON. 스트리밍에 `function_call_arguments.done`과 `completed` 이벤트가 옴 |
| 이력 재생 | 출력 아이템과 `function_call_output`을 이어 붙여 다음 응답을 받을 수 있음 |
| reasoning 아이템 | **오지 않음.** `include:["reasoning.encrypted_content"]`와 `summary:"auto"`를 넣어도 output에는 message와 function_call만 있음. 턴 사이에 추론 내용은 이어지지 않고, 매 턴 새로 추론한다 |
| 캐시 | 자동 접두 캐시가 됨. 3,084 토큰 중 3,082가 즉시 적중. `prompt_cache_options`는 400 `unsupported_parameter`라서 TTL은 지정할 수 없고 실측해야 함 |
| 비용 | usage에 `cost` 칸이 있음. 청구액을 원장에 바로 기록할 수 있다 |
| 보관 | `store:false` 응답을 GET하면 404. ZDR의 증거는 아니며 Liner 데이터 처리 약관 확인이 남아 있다 |

판정: 기술 조건은 통과. §8에서 명시적 TTL과 reasoning 재생 항목은 이 경로에 적용되지 않는다. ZDR은 사용자 결정(2026-10-11)으로 시작 조건에서 제외했다.

#### reasoning 재생: Liner와 OpenRouter 비교 (2026-10-11 실측)

1턴에서 수열 12단계를 계산해 `record`를 호출하게 했다. 2턴에서는 재계산하지 말고 6단계 값을 답하게 했다. 정답은 61이다.

| 경로 | reasoning 아이템 | 2턴 답 |
|---|---|---|
| OpenRouter(azure), 아이템 재생 | 옴(encrypted_content 약 1.8KB) | 61, 2/2 |
| OpenRouter(azure), 아이템 제외 | — | unknown, 2/2 |
| Liner | 오지 않음. `store:true`와 `reasoning.context`도 400 | unknown, 4/4 |

- 비용과 캐시(3K 접두, 3회 반복): 두 경로 모두 2회째부터 3,022 토큰 이상 적중. 비용은 OpenRouter가 약 10% 낮았다(콜드 $0.00039 vs $0.00043).
- 공식 근거: function calling 문서는 도구 호출과 함께 온 reasoning 아이템을 도구 결과와 같이 되돌리라고 요구한다. 쿡북은 SWE-bench에서 약 3% 개선을 보고했다. reasoning 가이드에 따르면 `all_turns`는 GPT-5.6과 6.1 Sol만 지원하고 Luna 문서에는 언급이 없다. 위 실측에서 OpenRouter 재생 시 다음 턴이 6단계 값을 기억했으니 적어도 이 형태의 재생은 동작한다.
- **Liner Chat Completions에서는 reasoning이 이어진다. 문서에는 없는 동작이다.** 도구와 high를 함께 쓰면 assistant 메시지에 `reasoning_details`가 함께 온다. 구성은 `reasoning.summary`와 `reasoning.encrypted`(약 1.4KB)다. 이것을 assistant 메시지에 다시 넣으면 2턴 답이 61로 맞았다(3/3, 프로브 T9 포함). 넣지 않거나 `reasoning` 텍스트만 넣으면 unknown(3/3)이었다. 캐시는 3,057 토큰 중 2,932 토큰 적중이고, 웜 상태 비용은 Responses보다 약 40% 높았다($0.000068 vs $0.000049).
- Liner 공식 문서([Responses](https://liner.com/developers/docs/liner-model-api-responses), [Chat Completions](https://liner.com/developers/docs/liner-model-api-chat-completions), 2026-10-11 Aside 확인)의 내용은 다음과 같다. Responses는 output에 message와 function_call만 넣는다. input에 reasoning 아이템을 넣으면 400이다. `include`와 `reasoning.summary`는 받기는 하지만 무시한다. Chat Completions 문서에는 `reasoning_effort`만 있고 `reasoning_details`는 정의되지 않았다. 로드맵은 공개되지 않았고, 문의는 [개발자 지원 폼](https://liner.com/support/form?source=developer)으로 한다(x-request-id 첨부, 2~3 영업일).
- 결론: Liner 크레딧을 쓰려면 mis-luna 전송을 Chat Completions로 정하고 `reasoning_details`를 재생한다. 이 동작은 문서 밖이므로 실험 전마다 프로브 T9로 확인한다. 동작이 사라지면 재생 없이 진행하고 원장에 기록한다. Liner에 이 동작의 보장(문서화)을 요청한다.
- 별도 관찰: Liner에서 도구를 붙이고 중립 지시만 주면 high여도 reasoning 0으로 바로 호출하는 경우가 있었다. 3회 중 2회였고 둘 다 오답. 지시에 "carefully"를 넣고 `tool_choice:"required"`로 두면 두 경로 합쳐 8/8 모두 reasoning을 하고 정답을 냈다. 사용자 프롬프트 작성 시 참고할 사항이다.

### 공식 SDK 채택 (2026-10-10 사용자 결정)

아직 런타임 미구현이고 SDK도 설치하지 않았다. 확인된 공식 사실과 설계 제안을 구분한다.

#### 확인된 공식 사실(호스트 Aside 직접 확인)

- OpenAI `openai` Node SDK([github.com/openai/openai-node](https://github.com/openai/openai-node)): Responses 호출의 전송 클라이언트. 기본 retries 2, 기본 timeout 10분, output replay helper가 있다.
- `@openai/agents`(Agents JS, [running agents 가이드](https://openai.github.io/openai-agents-js/guides/running-agents/)): agent 실행 프레임워크. loop·maxTurns·AbortSignal·state·tracing 같은 실행기 구성을 제공한다.
- Anthropic `@anthropic-ai/sdk`([github.com/anthropics/anthropic-sdk-typescript](https://github.com/anthropics/anthropic-sdk-typescript)): Anthropic 공식 TypeScript 전송 SDK. 상세 기본값(재시도·timeout·cache 항목)은 아직 확인하지 않아 기재하지 않는다.
- `@anthropic-ai/claude-agent-sdk`: Claude Code 기반 Agent 실행기로, 위 API SDK와 별도 제품이다. TS reference는 확인했고(아래 통제 검토), Luna를 native로 실행한다고 단정할 근거는 없다.

#### 채택 계약(설계 제안)

| SDK | 성격 | 채택 |
|---|---|---|
| `openai` | API 전송 | Luna Responses 전송에 채택 |
| `@openai/agents` | agent 실행 프레임워크 | 단일 agent runner 채택 후보 — 아래 gate 통과 시에만 |
| `@anthropic-ai/sdk` | API 전송 | Claude provider 전송 어댑터. 별도 명시 선택 profile에서만 |
| `@anthropic-ai/claude-agent-sdk` | Claude Code 기반 실행기 | 보류 — 통제 검토는 아래 |

경계는 SDK가 바꾸지 않는다. npm 의존성은 서버에만 도입하고, browser 확장·랜딩 번들에 SDK·키·bundler를 넣지 않는다. 확장이 논리 세션·도구 권한·클라이언트 암호화 checkpoint를 소유하고, 서버는 stateless SDK turn transport만 맡는다. 현재 bare Node 실행 경로에 서버 전용 의존성 manifest·lockfile과 컨테이너 설치 절차를 추가하는 범위를 검토한다. SDK 버전·Node 지원 버전을 고정하며 확장에는 빌드 단계를 추가하지 않는다.

writer는 Luna 단일 세션으로 유지한다. Anthropic 사용은 별도 명시 선택 profile이다. 같은 턴 dual writer와 자동 provider fallback은 금지한다 — 엔진·공급자 전환은 멈추고 묻는다.

`@openai/agents` runner 채택의 구현 gate:

1. native reasoning/output item을 손실 없이 보존·재생하는가.
2. 모든 자연어 지시의 출처를 추적할 수 있는가(prompt provenance).
3. 클라이언트 암호화 checkpoint에 pause/export/replay를 연결할 수 있는가 — 도구 경계에서 멈추고 상태를 꺼내 되넣는지 feasibility spike로 먼저 확인한다.
4. custom model/proxy(route)를 지원하는가.
5. 서버 한 요청에서 모델 응답 → 클라이언트 도구 요청 반환 → 확장에서 실행·암호화 checkpoint → 다음 요청으로 재개할 수 있는가. 서버 RunState는 요청 중 메모리에만 두고 디스크·서버 대화 저장을 쓰지 않는다. SDK 실행기의 pause 상태를 승인 UX와 혼동하지 않는다.
6. SDK 자동 도구 병렬 실행을 제한해 revision 변경 도구가 순차 실행되는가. SDK 최종 텍스트 반환은 노트 완료로 처리하지 않고 `finish_note` 저장 확인을 별도로 검증하는가.

spike가 불가능하다고 나오면 API SDK 위 작은 loop를 대체 설계 제안으로 둔다.

runner·출력 계약(설계 제안):

- Agents runner 채택 시 `tracingDisabled: true`와 model `gpt-6-luna` + reasoning effort high를 명시한다(API SDK 직접 호출도 같은 파라미터를 명시). SDK 기본 모델·기본 effort·기본 tracing에 맡기지 않는다.
- `outputType`은 구조화 스키마를 강제하지 않고 string으로 둔다 — 노트 본문은 자유 Markdown. 도구 인자의 작은 스키마(유효성·revision 검사)와 노트 출력 형식은 구분한다.
- handoff, compaction wrapper(`OpenAIResponsesCompactionSession` 류), hosted/server session은 쓰지 않는다 — 대화 상태는 클라이언트 암호화 checkpoint만 소유한다.
- 도구 오류 결과는 고정 코드와 사용자가 작성한 설명만 담는다. SDK·실행기가 만드는 자연어 오류 문구·수정 지시를 덧붙이지 않는다.

#### Claude Agent SDK 통제 검토(보류 유지)

[code.claude.com/docs/en/agent-sdk/typescript](https://code.claude.com/docs/en/agent-sdk/typescript) 최신 reference를 호스트 Aside로 직접 확인했다(2026-10-10):

- `settingSources`를 omitted/undefined로 두면 CLI처럼 user/project/local settings를 로드한다.
- `persistSession` 기본 true. `false`면 disk 저장을 끄고 이후 SDK resume은 불가다.
- `systemPrompt` undefined면 minimal prompt, custom string 지원. `tools` 배열 허용.
- `verbatimPrompts` 기본 false.

보류 해제를 검토할 때의 시작 설정(설계 제안): `settingSources: []`, `persistSession: false`, 사용자 작성 `systemPrompt`, 내장 tools `[]` + 허용 custom만, `verbatimPrompts: true`. 이 옵션만으로 모든 내부 지시·settings 파일 로드·compact 제거가 보장되는 것은 아니다 — 실제 serialized request 감사로 검증한다.

`persistSession: false`는 SDK resume을 포기하고 재개를 우리 암호화 checkpoint에 맡기는 선택이다. 반대로 SDK resume을 켜면 session transcript가 disk에 평문으로 남아 강의 평문 저장 정책과 충돌한다 — 기본은 false다. Luna를 native로 실행할 수 있는지는 여전히 미확인으로 둔다.

전송·관측·캐시 정책:

- 초기 `maxRetries: 0`, timeout·AbortSignal 명시 — 유한 재시도 소유자는 하네스다. SDK 기본 재시도·timeout에 맡기지 않는다.
- SDK debug log·tracing은 끈다. 지시 출처는 사용자 파일 해시만 믿지 말고 실제 serialized request를 감사한다. 강의 이력·RunState·응답 버퍼는 요청 범위로 제한하고 완료·취소·실패 시 참조를 해제한다. 내용 없는 SDK 클라이언트·연결 풀 재사용과 강의 이력의 전역 캐싱을 구별하며 후자는 금지한다.
- cache는 공급자별 별도 계약이다(OpenAI cached usage vs Anthropic cache_read/cache_creation). session·resume은 cache가 아니고, usage 미보고는 unknown이다(0 hit가 아님).

SDK 도입 수락 검사에는 synthetic 자료만 쓴다. (a) 정상·도구 오류·재개 요청의 wire payload에서 비사용자 지시 0건, (b) 모델 실패를 주입해도 Claude 등 다른 공급자로 전송 0건, (c) 실행·취소·재개 후 설정 자동 유입과 평문 transcript/checkpoint 파일 0건, (d) 중복 call_id와 저장 직후 중단에서 revision·저장 결과 보존을 확인한다. SDK 업데이트 때 같은 검사를 다시 통과해야 한다. Anthropic 전용 실험에서도 이 조건을 완화하지 않는다.

## 5. 입력과 컨텍스트

### 최초 입력

1. 사용자 작성 시스템 본문과 도구 설명: 버전·내용 고정.
2. 전체 STT 텍스트: 시간순, 안정된 source ID와 timestamp 포함.
3. 전체 OCR 텍스트: 슬라이드 순서·블록 읽기 순서·수식·불확실성 표시 포함.
4. 자산 manifest: 허용된 그림·표·수식 crop ID와 원천 연결, 크기 등.
5. 사용자가 작성한 작업 요청 본문.

STT/OCR은 명령이 아닌 자료로 구분한다. 원자료에 포함된 지시가 시스템 권한을 얻지 않게 한다. 이를 설명할 문구도 사용자가 작성한다. 모델이 명령을 따라도 허용되지 않는 동작을 실행할 수 없도록 권한은 코드가 제한한다.

STT를 먼저 LLM이 요약·정리한 문장으로 바꾸지 않는다. 핵심어 목록·계획·slot·우선순위를 타 모델이 만들지 않는다. 전처리는 정렬·ID 부여·명확한 기술적 중복 제거 등 결정적 작업으로 제한하고 원본 연결을 유지한다. OCR blocks와 page markdown이 같은 내용을 중복 표현하면 한 표현을 canonical로 정한다. 발화의 반복 강조를 기술적 중복으로 삭제하지 않는다.

모든 텍스트를 처음부터 넣는 원칙과 모든 이미지 바이너리를 넣는 것은 다르다. 이미지는 manifest로 제공하고 필요할 때 허용된 crop만 관찰한다. 판독하지 못한 필기 이미지는 동의 범위에서 메모리로만 전달하며 저장하지 않는다. 전체 슬라이드는 보존하지 않는다.

### 세션 예산과 초과 처리

실제 route의 context 한도 C에 대해 `input + replay history + tool results + reserved reasoning/output + safety margin <= C`를 매 턴 점검한다. 문자 수나 고정 토큰 비율만 믿지 않고 공급자 tokenizer/usage로 보정한다. body bytes, 응답 상한, 시간 제한도 별도로 검사한다.

처음부터 모든 자료가 들어가지 않으면 조용히 잘라내거나 요약하지 않는다. 길이 초과를 명시하고 멈춘다. 자료를 필요할 때 읽는 방식은 별도 실험 옵션이며 사용자의 '모두 넣기' 실험으로 집계하지 않는다.

기본 compact는 꺼둔다. 사용자 작성 프롬프트와 전체 근거 접두를 불변으로 두고, 과거 도구 결과는 애초부터 짧게 반환한다. 큰 HTML·PDF 전체를 턴마다 되돌려 넣지 않는다. 한도 근접 시 초안을 보존하고 중단한다. 향후 압축을 추가하더라도 LLM 요약을 지시문으로 승격하지 않으며 별도 동의·실험 항목으로 다룬다.

## 6. 최소 하네스 제안

도구 이름과 인자 목록은 구현 제안이고 자연어 description은 사용자 작성 파일에서만 가져온다.

| 도구 | 최소 인자 | 기능·반환 |
|---|---|---|
| `save_note` | markdown, expectedRevision | 초안 교체·revision 반환. 본문은 자유 Markdown |
| `patch_note` | expectedRevision, oldText, newText | 정확히 한 위치가 맞을 때만 수정; 불일치·중복이면 실패 |
| `inspect_note` | revision | 렌더·수식·깨진 자산·overflow를 검사; 코드·위치·짧은 수치만 반환 |
| `read_asset` | assetId | 입력 manifest에 있는 허용 crop만 제공; 임의 URL·파일 불가 |
| `finish_note` | revision | 필수 기술 검증 통과 뒤 암호화 보관함 저장·확인 |

각 인자의 type·필수값·길이·revision 검사는 유지한다. 이는 내용 구조 강제가 아니라 데이터 손상·잘못된 도구 실행 방지다. 사용자 파일에 인자 설명을 적는 칸도 둔다. 별도의 자연어 tool 오류 지시문을 코드에서 자동 생성하지 않는다.

루프: 모델 호출 → 반환 function_call을 허용 목록·인자·현재 revision으로 검사 → 도구 실행 → 동일 call_id에 결과 연결 → 같은 세션 후속 호출. 독립된 별도 모델 검수는 기본 경로에 없다. 모델이 finish를 요청해도 저장 실패면 완료가 아니다.

단일 논리 세션에 단일 활성 writer를 둔다. checkpoint는 마지막 확정 이력, 미실행 도구 호출, 도구 결과, 초안 revision, usage 원장을 구분한다. 재개 시 성공한 저장·도구를 중복 실행하지 않는다. 스트림 단절로 응답 완료 여부가 불분명하면 미완성 텍스트를 최종 노트로 확정하지 않는다. 전송 재시도·모델 수정 턴·시간·비용 상한을 각각 관리한다.

서버는 무상태 프록시로 유지하고 확장 작업 메모리가 논리 세션을 소유한다. 장기 호출 하나로 전체 작업을 유지하지 않는다. 턴 경계마다 암호화 checkpoint를 남기되 필기 이미지·원화면은 제외한다. checkpoint의 이력에 이미지 data URL이 숨어 저장되지 않게 전용 검사를 둔다. 재시작 뒤 필기 이미지를 복원할 수 없으면 재인식 필요 상태를 명시한다.

예산·허용 모델·동의·암호화·외부 통신·취소는 모델이 바꿀 수 없는 코드 정책이다. 강의별 내용 없는 호출 수·시간·토큰·cache usage·실패 코드만 서버에 기록한다.

## 7. 출력과 기존 제품 연결

권장 canonical은 Markdown이다. 제목·문단·표·목록·수식과 허용된 자산 링크를 사용한다. 모델은 설명 순서와 분량을 결정하고, 디자인 CSS·폰트·인쇄·KaTeX·정해진 도표 렌더링은 코드가 맡는다.

모델 생성 임의 HTML/JavaScript/SVG 실행을 기본 기능으로 열지 않는다. 임의 HTML은 제거하고 자산 링크는 manifest ID로만 해석한다. 기존 자료에 없는 수치 그래프는 자동 생성하지 않는다. 도식 기능은 실제 수요가 확인된 뒤 작은 별도 문법을 사용자와 정한다.

현 NoteContract·NoteSpec 중심 경로와 자유 Markdown은 직접 호환되지 않는다. JSON 블록을 다시 LLM에게 작성시키는 중간 변환은 목표에 어긋난다. 새 Markdown renderer/암호화 artifact 타입 또는 기존 컨테이너의 호환 가능한 확장을 검토해야 한다. 기존 보관함·PDF·다운로드·재생성을 끝까지 연결해야 MVP가 끝난다. 저장 형식/서버 계약을 깨면 AGENTS의 major 버전 규칙을 적용한다.

`inspect_note`는 깨진 수식·참조·레이아웃은 검사할 수 있지만 사실성·강의 개념 누락을 증명하지 못한다. 같은 Luna의 자체 검토에도 편향이 있다. 기술 검사 통과와 노트 품질 통과를 분리한다.

## 8. 캐싱 설계

[공식 캐싱 문서](https://developers.openai.com/api/docs/guides/prompt-caching)를 2026-10-10 Aside snapshot으로 확인했다. GPT-5.6 이후 설명 기준 최소 1,024 visible input tokens, `prompt_cache_options.ttl`은 `30m`, 최근 write/reuse 이후 최소 30분이다. 과거 모델의 5~10분·128토큰 반올림 규칙을 Luna에 그대로 옮기지 않는다. 실제 gateway 지원은 별도다.

불변 접두는 `사용자 지시 + 고정 도구 정의 + 강의 전체 자료`다. 후속 턴은 append-only로 추가한다. 초안 전체를 첫 메시지에 덮어쓰거나 매번 시간·실행 ID를 접두에 넣지 않는다. 사용자 편집으로 지시가 바뀌면 새 prompt revision으로 캐시 경계가 달라졌음을 기록한다.

반환된 reasoning·function call·output item은 공급자 계약대로 재생한다. assistant 텍스트만 추출해 세션을 조립하지 않는다. store:false와 reasoning replay, tools의 동작을 실제 route에서 synthetic probe로 확인한다. previous_response_id가 무료 입력이나 캐시 보장이라고 가정하지 않는다.

native 공식 가격: input $0.10/M, cached input $0.01/M, cache write $0.125/M, output $0.50/M. 272K 초과 input이면 전체 요청의 input/cache 2배·output 1.5배 규칙이 있다. gateway 가격은 별도로 기록한다. cache write usage 의미와 input의 포함 관계를 확인해 이중 합산하지 않는다. 한 번만 쓰는 긴 접두의 write 비용까지 포함해야 한다.

측정: route/model/effort/prompt hash/tool hash, input/output/reasoning, cache read/write, actual billed cost, 호출·재시도 수, latency, context 점유율. 미제공 usage는 unknown이며 0 hit가 아니다. 캐시는 암호화 checkpoint와 별개다. provider KV retention과 서비스의 원문 보관 정책도 별도로 확인한다.

## 9. 기존 코드에서 재사용·우회할 것

| 위치 | 판단 |
|---|---|
| `lib/note-profiles.js`, settings allowlist | mis-luna 등록의 단일 진입점 유지. 현 단계 기반 family에 억지로 끼우지 않음 |
| `server/prompts.js`, `server/index.js`의 Prompts.systemFor·schemaInPrompt | 새 경로에서 우회. 자연어 지시·출력 스키마 자동 주입 금지 |
| `server/note-session.js`의 PREAMBLE·STAGE_ORDER·taskItem·json_object | 그대로 재사용 불가. 전송·call_id·재개 처리만 필요한 만큼 재사용 |
| `server/llm.js` 전송 계층 | 공식 API SDK 채택 지점. Luna Responses는 `openai`, Claude는 별도 profile에서 `@anthropic-ai/sdk` 어댑터. usage 수집·오류 코드·유한 재시도 경계는 유지하고 SDK 기본 재시도·헤더·telemetry는 요청 감사로 검증 |
| `lib/stages.js`의 계획→section→Jev→repair | 초기 mis-luna 기본 경로에서 실행하지 않음 |
| 인식·동의·암호화·자산·usage accounting | 기존 경계 유지. 전체 텍스트가 upstream 요약에서 이미 줄지 않았는지 점검 |
| note renderer·library·print | Markdown 연결과 저장 성공 검증 필요 |

소스 코드에서 문자열 검색만 하는 것으로 끝내지 않는다. synthetic 입력을 사용한 실제 요청 조립 결과를 검사해 모든 자연어 지시의 출처를 추적한다. `mis-luna-user-prompts.md` 외부에서 온 system/developer 텍스트, 자동 repair 지시, schema 설명, tool description, inherited project prompt가 있으면 실패시킨다. 자료와 이전 assistant 산출물은 이 금지와 구별한다.

빈 필수 프롬프트는 실행 불가. 기존 프롬프트로 fallback하지 않는다. 사용자가 작성한 내용도 버전/hash로 고정하고 모델이 바꿀 수 없게 한다. API 제공자의 비공개 시스템 처리는 서비스가 제거하거나 무프롬프트라고 보장할 수 없다.

## 10. 실험과 완료 기준

1. 사용자가 프롬프트 파일을 작성한다. 그 전에는 제품용 프롬프트를 개발 에이전트가 대신 채우지 않는다.
2. synthetic 자료로 route·high tool calling·cache usage·timeout·취소·암호화 재개·prompt provenance를 검증한다.
3. 같은 전체 STT/OCR·자산·동일 사용자 지시로 A(한 번 작성)와 B(단일 agent 세션)를 비교한다. 기존 mis-sol-hai는 별도 baseline이다. renderer가 다른 경우 시각 차이와 내용 차이를 따로 평가한다.
4. 짧은 강의, 긴 강의, 수식 강의, 개념/논증 강의, 도표가 많은 강의에서 검증한다. 저장 실패·context overflow·거절·잘림·도구 오호출·필기 이미지 소실을 포함한다.
5. 원강의와 블라인드 대조: 핵심 개념·정의·논리 연결·예시·수식·도표 정확성·읽기 순서·누락·근거 없는 추가. 압축률 하나로 품질을 판단하지 않는다.
6. 캐시 cold/warm/TTL 경과를 동일 route에서 비교하고 reasoning·수정·재시도 전체 비용을 포함한다. 검수 턴이 항상 품질을 높인다고 가정하지 않는다.
7. 최종 성공은 기술 검사 통과 + 보관함 저장·다시 열기 확인 + 품질 평가 통과다. 기존 24번 실행의 `ok`처럼 일부 완료/저장 실패를 성공 처리하지 않는다.

구현 후 필수 게이트: `node --test lib/*.test.js server/*.test.js tools/*.test.mjs`, `node tools/package-cws.mjs --dry-run --skip-tests`. 이 문서 작성 단계에서는 신규 모델 추론·실강의 재실행·배포를 하지 않는다.

## 11. 남은 불확실성과 근거

- 한 세션에 모두 넣으면 더 좋은 노트가 되는가: 미실측. 긴 입력의 누락·주의 분산·연속 오류 전파가 가능하다.
- 현재 gateway의 high 도구 호출·KV caching·ZDR: native 문서와 분리해 검증 필요.
- Aside 내부 압축/캐시 알고리즘: 미확인. 공개 CLI 동작·읽기 전용 설정만 벤치마킹했다.
- Markdown 저장 형식의 최종 호환 설계와 실제 지면 품질: 구현 전 결정·실험 필요.

공식 출처:

- https://developers.openai.com/api/docs/models/gpt-6-luna — 모델·high 도구 호출·한도·가격, 브라우저 직접 확인.
- https://developers.openai.com/api/docs/guides/prompt-caching — 접두 일치·최소 길이·TTL·캐시 비용, 브라우저 직접 확인.
- https://developers.openai.com/api/docs/guides/conversation-state — 브라우저 직접 확인. stateless reasoning 요청에서 output 배열 전체 보존, phase와 reasoning 유지, previous_response_id 사용 시에도 이전 input 과금. 실제 gateway 호환 보장은 아님.
- https://github.com/openai/openai-node — OpenAI 공식 Node API SDK. 기본 retries 2·timeout 10분·output replay helper, 호스트 Aside 직접 확인.
- https://openai.github.io/openai-agents-js/guides/running-agents/ — Agents JS 실행 루프·maxTurns·AbortSignal·state. runner 채택은 §4 gate 조건부.
- https://github.com/anthropics/anthropic-sdk-typescript — Anthropic 공식 TypeScript SDK. 상세 기본값은 확인 전이라 본문에 기재하지 않았다.
- https://code.claude.com/docs/en/agent-sdk/typescript — Claude Agent SDK TS reference. settingSources·persistSession·systemPrompt·tools·verbatimPrompts 동작, 호스트 Aside 직접 확인.
- https://docs.aside.com/help/tasks.md — 브라우저 직접 확인. 장기 작업·재개·Queue/Steer·산출물 미리보기. 일반 작업 transcript를 task folder에 저장한다는 동작은 우리 강의 평문 저장 정책으로 복사하지 않음.
- Aside 설치 CLI `aside guide`, `aside guide repl`, `aside skills show aside` 및 `aside.settings.get('compaction'|'retry')` — 실행 시점 확인. 공개 GitHub 소스 구현을 확인한 것으로 주장하지 않음.

사용자 작성 파일: [mis-luna-user-prompts.md](mis-luna-user-prompts.md).

후속 구현 자료 조사: [mis-luna-agent-research-2026-10-10.md](mis-luna-agent-research-2026-10-10.md). 실행 루프·도구 호출·암호화 재개·캐싱·평가를 공식 문서와 원저장소/논문에 연결한다. 제품 프롬프트로 전송하지 않는다.
