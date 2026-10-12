# mis-luna 구현용 AI agent 자료 조사

조사일: 2026-10-10. 방법: Aside 조사 세션 3개(API·하네스·컨텍스트), 공식 문서와 GitHub/논문을 Aside 브라우저에서 추가 대조. 제품 구현·실강의 실험은 하지 않았다. 이 문서는 개발 지식이며 제품 모델에 전달할 프롬프트가 아니다.

## 결론

권장 출발점은 **공식 API SDK 전송 + 작은 단일 agent 실행기**다. SDK를 두 부류로 구분한다: 공식 API SDK(OpenAI `openai`, Anthropic `@anthropic-ai/sdk`)는 서버 전송 계층에 채택하고, agent 프레임워크는 `@openai/agents`를 단일 runner 채택 후보로 둔다(구현 gate는 §2·§9, 전체 계약은 [설계 검토 §4 공식 SDK 채택](mis-luna-feasibility-2026-10-10.md)). `@anthropic-ai/claude-agent-sdk`는 Claude Code 기반의 별도 제품으로 보류한다. 전체 STT/OCR + 사용자 작성 지시 + 고정된 소수 도구를 입력하고, 반환 도구 호출과 결과를 같은 대화에 이어 붙인다. writer는 Luna 단일 세션이고, 같은 턴 dual writer·자동 provider fallback은 금지다.

모델의 자율성과 실행기의 통제는 양립한다. 내용 구성·작성·수정은 Luna에 맡기고, 호출 한도·동의·저장·revision·취소·권한·완료 판정은 코드로 보장한다. 구조화 출력 최소화는 노트 본문의 자유를 의미하며, 도구 호출·상태·과금 원장까지 무구조로 만들겠다는 뜻은 아니다.

## 1. 우선 읽을 자료

공식 문서도 native API 계약과 gateway 계약을 구분한다. SDK/GitHub는 설계 사례이지 우리 조합의 동작 보증이 아니다. 논문은 평가 아이디어의 근거이며 Luna 성능을 실측한 자료로 취급하지 않는다.

| 우선 | 자료·출처 | 확인 상태·날짜 | 구현에서 얻을 것 |
|---|---|---|---|
| P0 | [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna) | 공식, 동일 일자 선행 검토에서 직접 확인 | high 도구 호출은 Responses, 모델 한도와 실제 route 한도를 분리 |
| P0 | [Function calling](https://developers.openai.com/api/docs/guides/function-calling) | 공식, 이번 조사 직접 확인 | function_call/call_id, 인자 스트리밍 완료, strict 설정, 최소 도구 계약 |
| P0 | [Conversation state](https://developers.openai.com/api/docs/guides/conversation-state) | 공식, 동일 일자 선행 검토에서 직접 확인 | 클라이언트 이력 관리, output item·reasoning·phase 보존 |
| P0 | [Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching) | 공식, 동일 일자 선행 검토에서 직접 확인 | 접두 일치·경계·TTL·read/write 과금. 세션 ID만으로 hit 판정 금지 |
| P0 | [Your data](https://developers.openai.com/api/docs/guides/your-data) | 공식, 이번 조사 직접 확인 | store:false와 ZDR 차이, background 응답 임시 보관 |
| P0 | [Agents JS: Running agents](https://openai.github.io/openai-agents-js/guides/running-agents/) | 공식 SDK, 이번 조사 직접 확인 | loop·maxTurns·AbortSignal·state·retry·trace·toolErrorFormatter |
| P1 | [pi agent-loop.ts](https://github.com/badlogic/pi-mono/blob/main/packages/agent/src/agent-loop.ts) | 원저장소 파일 직접 확인; 화면상 최근 변경 2026-10-06. main 링크는 가변 | 모델 경계에서 메시지 변환, start/continue 분리, 이벤트·signal·도구 인자 검증 |
| P1 | [LangGraph Persistence](https://docs.langchain.com/oss/python/langgraph/persistence) | 공식 직접 확인. durable-execution URL이 이 페이지로 이동 | 대화별 checkpoint와 장기 store 구분, RAM 저장의 재시작 한계 |
| P1 | [Aside Run tasks](https://docs.aside.com/help/tasks.md) | 공식, 동일 일자 선행 검토에서 직접 확인 | Queue/Steer·재개·산출물 미리보기. 일반 transcript 저장은 우리 서비스에 복제하지 않음 |
| P1 | [Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) | 공식 엔지니어링, 2025-09-29; 이번 조사 직접 확인 | 작고 구분되는 도구, 컨텍스트 선택·압축·필요 시 조회의 장단점 |
| P1 | [Manus context engineering](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus) | 제작사 경험담, 2025-07-18; 이번 조사 직접 확인 | 안정된 접두·복원 가능한 외부 상태. 우리 서비스에서는 평문 파일 대신 암호화 상태 |
| P2 | [Lost in the Middle](https://arxiv.org/abs/2307.03172) | 원논문 직접 확인, 2023-07-06 최초 공개 | 긴 입력에서 위치별 활용 능력을 따로 평가 |
| P2 | [LongMemEval](https://arxiv.org/abs/2410.10813) | 원논문 직접 확인, 2024-10-14 / v2 2025-03-04, ICLR 2025 | 정보 추출·시간·정정·답변 유보 평가 축 |
| P2 | [Don’t Break the Cache](https://arxiv.org/html/2601.06007) | 2026-01 arXiv 원문 직접 확인; 게재 심사 상태 미확인 | system-only/전체/도구결과 제외 캐시 전략 비교와 비용·TTFT 분리 |

최신 native Luna API 문서와 과거 모델 실험을 섞지 않는다. LongMemEval과 Lost in the Middle은 오래됐지만 평가 설계에 여전히 유용하다. 최신 캐시 논문도 Luna 6 High 노트 작성을 직접 검증하지 않는다. 수집 자료를 해당 분야 전체의 최신 문헌을 망라한 조사로 주장하지 않는다.

## 2. 실행 루프: SDK에서 배울 것

OpenAI Agents JS 가이드는 모델 호출 → 도구 실행 → 결과 추가 → 다음 호출이라는 루프, 턴 상한, 취소 신호와 실행 상태를 제공한다. client-managed history와 server-managed conversation을 무계획하게 함께 쓰면 대화가 중복될 수 있다고 설명한다. 우리에게는 확장 메모리 + 암호화 checkpoint를 소유자로 두는 방식이 맞다. [Running agents](https://openai.github.io/openai-agents-js/guides/running-agents/)

SDK에는 입력 필터·도구 오류 formatter·tracing 등 모델 입출력에 영향을 줄 수 있는 지점이 있다. 이것이 모두 숨은 프롬프트를 주입한다는 뜻은 아니다. **실제로 조립된 요청을 검사해야 한다**는 뜻이다. SDK 예제의 guardrail agent나 기본 에러 문구를 그대로 쓰지 않는다. 일반 tracing은 끄고 승인된 content-free 계측을 별도로 둔다.

이 절의 "SDK"는 실행 프레임워크(Agents JS)를 가리킨다. 전송 API SDK도 선택한 helper·설정에 따라 요청 조립이 달라지고 기본 재시도·헤더·telemetry가 있을 수 있으므로 "조립된 요청 검사" 요구는 똑같이 적용한다. `@openai/agents`를 runner로 쓰려면 도구 경계의 pause·export·replay가 클라이언트 암호화 checkpoint 경계와 맞는지 feasibility spike로 먼저 확인한다 — 불가능하면 API SDK 위 작은 loop를 대체 설계 제안으로 둔다.

pi 소스는 내부 AgentMessage와 모델용 메시지 변환 경계, 신규 실행과 이어 실행, 이벤트 스트림과 AbortSignal을 구분한다. 작은 실행기의 읽기 자료로 적합하다. 전체 coding agent의 shell·filesystem·system prompt를 복사하지 않는다. 사용 전 commit SHA와 라이선스를 고정한다. 이번 확인은 현재 main 파일이며 immutable SHA 검증까지 한 것은 아니다. [pi agent-loop.ts](https://github.com/badlogic/pi-mono/blob/main/packages/agent/src/agent-loop.ts)

권장 상태 흐름(아래는 조사에 기초한 우리 설계 제안):

`ready → model_running → response_committed → tool_pending → tool_running → tool_committed → ready`

별도 상태는 `paused`, `cancelled`, `failed`, `completed`. partial assistant text를 completed로 보지 않는다. finish_note 호출도 기술 검사와 실제 암호화 파일 저장 성공 전에는 completed가 아니다.

## 3. 스트리밍과 도구 호출 계약

Function calling 문서에서 `response.function_call_arguments.done`을 확인했다. 스트리밍 delta가 일부 왔다는 이유만으로 JSON을 실행하지 않는다. 단순한 첫 구현에서는 응답 완료와 전체 도구 인자 검증까지 기다린 뒤 실행한다. 도구 name·arguments·call_id와 반환 결과를 연결하고, 모르는 도구는 거절한다. [Function calling](https://developers.openai.com/api/docs/guides/function-calling)

또한 Responses에서 strict를 생략하면 가능한 경우 스키마를 strict로 정규화한다고 문서가 설명한다. **strict를 생략하는 것이 non-strict 보장은 아니다.** 첫 버전은 자유 Markdown 본문 + 작은 도구 스키마를 명시적으로 선택한다. non-strict 실험은 `strict:false`와 로컬 인자 검사를 사용한다. 실제 gateway가 받는지도 probe한다.

코드에서 지킬 제안:

- 같은 응답에 도구 호출이 여러 개면 모두 추적한다. 첫 호출만 처리하고 나머지를 버리지 않는다.
- 초안을 바꾸는 save/patch/finish는 순차 실행한다. 읽기 도구 병렬화는 필요가 입증된 뒤 추가한다.
- 이미 결과가 있는 call_id는 결과를 재사용하고 실행하지 않는다. call_id가 같고 인자가 다르면 충돌이다.
- 오류도 해당 call_id의 짧은 도구 결과로 남긴다 — 고정 코드와 사용자가 작성한 설명만. SDK·실행기가 만드는 자연어 오류 문구·수정 지시를 덧붙이지 않는다.
- invalid arguments·동일 revision 수정 충돌·반복 실패가 발생하면 유한한 수정 기회를 주고 중단한다. model retry와 tool retry를 별도 집계한다.

## 4. 세션·checkpoint·재개

LangGraph 공식 persistence 문서는 thread-scoped checkpoint와 장기 store를 구분하며, in-memory checkpoint는 프로세스 재시작에 살아남지 않는다고 설명한다. 이를 참고하되 Python 프레임워크나 서버 DB에 강의 원문을 저장하는 방식을 도입하지 않는다. durable-execution의 상세 replay 문서는 현재 URL 이동 때문에 별도 확인이 필요하다. [Persistence](https://docs.langchain.com/oss/python/langgraph/persistence)

우리 설계에서는 대화 이력만 저장해서는 부족하다. 다음 최소 상태를 로컬에서 암호화해 관리한다:

| 상태 | 목적 |
|---|---|
| session ID, source/prompt/tool revision | 다른 자료·지시·도구로 잘못 재개하는 것 방지 |
| 완료된 provider output items | reasoning·phase·도구 호출을 잃지 않고 재생 |
| pending tool calls, 실행 상태와 결과 | 도구 중복 실행 방지 |
| note revision와 저장된 artifact 식별자 | 동일 초안에 대한 수정·완료 여부 확인 |
| 소비 예산·호출 원장 | 재개 후 비용 한도 초기화 방지 |

핵심 실패 구간은 '도구가 저장했지만 결과 checkpoint 전에 프로세스가 종료됨'이다. revision과 저장 artifact를 확인해 이미 완료한 작업을 재실행하지 않아야 한다. 다른 저장소 사이에 원자성이 없으면 exactly-once를 보장한다고 쓰지 않는다. idempotent 실행과 재개 시 상태 대조로 복구한다. 이 부분은 특정 문서가 보장한 SDK 기능이 아니라 우리 구현 요구다.

필기 이미지·화면 원본·이미지 data URL은 이력 checkpoint에서 제외한다. 재시작 뒤 복원할 수 없는 입력이 있으면 사용자에게 재인식 필요 상태를 보여준다. 보존 가능한 crop도 기존 암호화 규칙을 따른다.

## 5. 컨텍스트: 그대로 넣되 관찰 결과는 작게

Anthropic 글은 도구의 역할이 겹치지 않도록 만들고, 필요한 정보를 적시에 조회하거나 장기 작업에서 압축하는 방법을 설명한다. 이것이 모든 작업에 요약·다중 agent를 넣으라는 규칙은 아니다. 초기 mis-luna에서는 전체 STT/OCR를 유지하고 도구 관찰을 짧게 만드는 원리만 적용한다. [Context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)

Manus는 복원할 수 없는 과도한 압축의 위험과 외부 상태를 활용하는 방법을 설명한다. 우리에게는 원자료의 안정된 ID와 암호화된 초안 revision으로 적용할 수 있다. Manus의 브라우저 업무·파일 시스템 전략과 강의 전체 입력은 다른 조건이다. 원문을 매 턴 삭제하거나 plaintext 작업 폴더를 만드는 식으로 복제하지 않는다. [Manus](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus)

구체적 적용:

- 입력 자료는 정렬·ID·canonical 표현만 결정적으로 처리한다. 내용 중요도는 타 LLM이 선별하지 않는다.
- render 도구는 전체 HTML 대신 수식 오류·깨진 asset ID·overflow 위치·revision을 반환한다.
- 필요할 때만 해당 페이지의 안전한 미리보기 또는 좁은 excerpt를 요청한다. `inspect_note`가 시각적 확인까지 할 수 있는지 별도로 결정한다. 수치 검사만 제공하고 모델이 PDF를 봤다고 주장하지 않는다.
- 도구의 반환 길이 상한과 요약 규칙은 코드로 정한다. 원자료를 자르는 것과 도구 로그를 줄이는 것은 다른 조치다.
- 초기에는 자동 compact·요약 메모리·다중 writer를 추가하지 않는다. 필요 시 조회 방식은 별도 비교 실험으로 분리한다.

## 6. 캐싱: 이력을 보존하는 것과 싸게 실행되는 것은 다르다

native Luna 관련 최신 계약은 [공식 캐싱 문서](https://developers.openai.com/api/docs/guides/prompt-caching)를 기준으로 한다. 불변 지시·도구·자료를 앞에 두고 후속 output/result는 append-only로 유지한다. gateway가 cache 옵션을 제거하는 현재 `toLiner` 변환을 지나면 공식 native 설정을 그대로 적용했다고 볼 수 없다.

2026년 논문 Don’t Break the Cache는 다른 모델과 DeepResearch 업무에서 cache 전략별 비용과 TTFT를 비교한다. 전체 캐싱이 항상 최저 지연이 아니며 write 비용과 실제 재사용 여부를 함께 봐야 한다는 실험 동기를 준다. 논문의 과거 모델별 절감률·가격·최소 토큰 수를 Luna 계약으로 복사하지 않는다. [원논문](https://arxiv.org/html/2601.06007)

특히 논문의 UUID로 cache 경계를 깨는 실험 조작을 제품 기본으로 채택하지 않는다. 우리의 단일 세션에서는 도구 결과가 이후 턴에서 반복 사용되므로 'dynamic이니 전부 캐시 제외'라는 결론도 성립하지 않는다. 최소 비교는 다음이다:

1. 고정 지시·도구·전체 강의 접두를 재사용하는 기본 경로.
2. 지원되는 경우의 명시적 cache 경계와 provider 기본 implicit 경계 비교.
3. 같은 자료의 cold/warm/TTL 경과, 짧은 작업/여러 수정 턴 비교.

품질·도구 실행 순서를 유지한 상태에서 input/output/reasoning·cache read/write·청구액·TTFT·전체 완료 시간을 측정한다. hit율을 올리려고 의미 없는 프롬프트를 길게 만들지 않는다.

## 7. 데이터 경계와 중단

공식 문서는 background mode가 polling을 위해 응답 데이터를 약 10분 디스크에 둔다고 명시한다. 따라서 타임아웃 회피만을 이유로 background=true를 켜지 않는다. store:false와 ZDR는 동일한 설정이 아니다. [Your data](https://developers.openai.com/api/docs/guides/your-data)

우리 기본은 foreground 호출 + 턴 경계 재개다. AbortSignal은 사용자 취소를 실행기에 전달하는 수단이며, 공급자가 이미 시작한 연산이나 과금을 반드시 취소한다고 보장하지 않는다. 새 모델·도구 실행은 멈추고 확정된 결과와 불확실한 호출 비용을 구분한다. endpoint 취소 지원은 별도 확인한다.

외부 tracing은 처음부터 사용하지 않는다. 모델 입력·노트·도구 결과가 trace에 들어갈 수 있는 통로를 닫고, 승인된 수치·고정 오류 코드만 기록한다. provider의 ZDR·retention과 서비스의 로컬 암호화 저장을 별도로 검증한다.

## 8. 평가 자료에서 가져올 테스트

[Lost in the Middle](https://arxiv.org/abs/2307.03172)은 긴 입력에서 정보 위치가 성능에 영향을 줄 수 있음을 보여주는 연구다. Luna에서 같은 저하율이 나온다는 증거는 아니다. 강의 시작·중간·끝에 핵심 개념을 배치한 합성 자료로 위치별 누락을 측정한다.

[LongMemEval](https://arxiv.org/abs/2410.10813)은 정보 추출·다중 세션 추론·시간 추론·지식 업데이트·답변 유보를 평가한다. mis-luna는 단일 강의이므로 장기 사용자 기억 점수를 그대로 채택하지 않는다. 대신 교수의 후반 정정, 같은 기호의 의미 변화, OCR/STT 충돌, 자료에 없는 질문에 대한 처리 능력을 검사한다.

| 평가 축 | 최소 시험 | 성공 근거 |
|---|---|---|
| 내용 보존 | 앞/중간/끝 개념·정의·조건·예외 | 사람이 만든 근거 목록과 대조 |
| 추론 정확성 | 인과·대조·수식 가정·단위 | 개념과 논리 연결 모두 맞음 |
| 입력 충돌 | 후반 정정·OCR 오류·불확실 수식 | 잘못된 앞선 정보를 무조건 반복하지 않음 |
| 상태 복구 | 응답 중단·도구 전/후 종료·저장 후 종료 | 중복 수정/저장 없이 재개 |
| 도구 계약 | 인자 잘림·unknown tool·중복 call_id | 실행 거절/재사용이 결정적으로 동작 |
| 프롬프트 출처 | synthetic wire payload 감사 | 사용자 영역 외 자연어 지시가 없음 |
| 비용 | cold/warm·실패·수정 턴 | 청구액·usage와 원장이 일치 |
| 완성도 | PDF·보관함 저장·재열기 | 일부 완료·저장 실패를 성공으로 집계하지 않음 |

모델 한 번 작성과 도구 loop를 같은 입력·사용자 프롬프트·렌더러로 비교한다. 자동 self-review만으로 통과시키지 않는다. 실패 응답·재시도를 포함해 비용을 계산한다.

## 9. 구현 순서와 제외할 것

1. 사용자 작성 프롬프트 파일의 선택 영역만 읽는 loader와 wire provenance 검사.
2. 실제 route의 Luna High Responses/도구/usage/취소 동작을 합성 자료로 probe.
3. 하나의 active writer를 가진 작은 loop와 최소 도구 계약.
4. 로컬 암호화 checkpoint + revision + 도구 실행 원장.
5. Markdown·자산·수식 렌더와 실제 저장 완료 확인.
6. 위 평가표와 cache 실험으로 품질·비용 측정.

초기 제외: 프롬프트 자동 생성, automatic compact, Agents SDK 무검증 채택·SDK 내장 coding prompt, Claude Agent SDK, shell/웹/임의 filesystem, hosted background execution, 서버 plaintext checkpoint, 여러 모델 writer, 같은 턴 dual writer·자동 provider fallback, 모델 설명만으로 성공 처리.

현재 코드 연결점: `server/note-session.js`의 전송·pending·call_id 처리는 참고 가능하지만 고정 PREAMBLE·STAGE_ORDER·json_object는 가져오지 않는다. 현재 validate의 과거 call_id 존재 확인을 재개 안전성 전체로 간주하지 말고 중복·충돌·미완료 도구를 별도 검증한다. `lib/note-profiles.js`는 프로파일 등록 단일 출처로 유지하고 기존 단계 family와 새 loop 경계를 명시한다.

## 10. 확인 한계

- Aside 비공개 시스템 프롬프트·KV cache 구현·압축 알고리즘은 확인하지 않았다. 공개 인터페이스만 벤치마킹했다.
- API 조사 agent가 streaming 완료 이벤트를 미확인으로 보고한 부분은 호스트가 공식 function-calling 페이지에서 직접 확인해 보완했다.
- 하네스 조사 agent의 Chat Completions 직접 사용 제안은 Luna High 도구 호출의 Responses 요구와 충돌해 제외했다. `tool_call_id` 기반 Chat 메시지 예제를 Responses의 `call_id` 계약으로 혼용하지 않는다.
- '상용 SDK는 항상 숨은 지시를 넣는다', 'vanilla fetch이면 정보 유출이 없다'는 조사 답변의 일반화는 채택하지 않았다. 특정 버전의 요청 조립·오류 formatter·telemetry를 검사해야 판단할 수 있다.
- durable-execution URL은 persistence로 이동했다. 상세 durable replay 계약을 확인했다고 과장하지 않았다.
- 연구 세션이 찾은 arXiv 2601.06007의 실제 제목은 **Don’t Break the Cache**다. ID만 보고 다른 논문 제목을 추정하지 않았다.
- SDK 기본값·GitHub main은 변할 수 있다. 실제 도입 시 버전/SHA를 고정하고 검증한다.
- native 공식 지원은 Liner/OpenRouter route 지원의 증거가 아니다. 공급자 호출 smoke test는 이번 조사에 포함되지 않는다.
- Anthropic SDK 상세 기본값(재시도·timeout·cache 항목)은 확인 전이라 기재하지 않는다. Claude 사용 시에도 SDK 기본 prompt·filesystem/transcript persistence·compact·내장 tool 통제 가능 여부는 검증 전 보류다.
- Claude Agent SDK는 Claude Code 기반 별도 제품이며 Luna를 native로 실행한다고 단정하지 않았다. 통제 옵션(settingSources·persistSession·systemPrompt·tools·verbatimPrompts)은 공식 reference로 확인했으나 이것만으로 내부 지시·파일·compact 제거가 보장되지 않아 보류를 유지한다 — 검토 시작 설정과 persistSession/resume tradeoff는 [설계 검토 §4 공식 SDK 채택](mis-luna-feasibility-2026-10-10.md)에 둔다.
- SDK 후속 조사는 Herdr ‘노트 기획 구현’ 탭의 Devin 워커 3개(공급자별 조사 2개·문서 편집 1개)와 AGY 읽기 전용 검토로 분담했다. 호스트는 Aside에서 공식 Node SDK README·Agents 실행 가이드·Claude Agent SDK TS reference를 직접 대조했다. 워커가 보고한 Claude 기본 systemPrompt=preset, persistence 비활성 옵션 미확인, 예전 캐시 최소 토큰·런타임 수치는 최신 reference와 대조되지 않아 채택하지 않았다. 특히 현재 TS reference의 minimal prompt·persistSession 옵션을 기준으로 문서를 정리했다.
- 제품 프롬프트 본문은 작성하지 않았으며 사용자용 빈 영역은 유지했다.

연결: [설계 검토](mis-luna-feasibility-2026-10-10.md) · [사용자 작성 프롬프트](mis-luna-user-prompts.md).
