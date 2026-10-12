# 에이전트·프롬프트·컨텍스트 엔지니어링 조사 부록

조사일: 2026-10-08. Aside에서 공식 API 문서, GitHub 코드/개발 지침, 논문, Reddit 운영 경험을 병렬 조사했다. [통합 개선안](sol-luna-2-improvements-2026-10-08.md)의 설계 판단을 뒷받침하는 출처와 적용 한계를 기록한다. 접근일과 출판일은 다르다. 현재 모델을 직접 평가하지 않은 연구의 수치를 우리 품질/절감률로 옮기지 않는다.

## 1. 현재 모델에 직접 적용하는 계약

| 출처 | 확인 내용 | 우리 서비스에 적용 / 미확인 |
|---|---|---|
| [GPT-6.1 Sol](https://openrouter.ai/openai/gpt-6.1-sol), [GPT-6 Luna](https://openrouter.ai/openai/gpt-6-luna) | 현재 사용하는 모델의 공급자 페이지 | 코드의 Sol medium / Luna high를 기준선으로 유지. `@high`는 로컬 설정 별칭이며 별도 업스트림 모델이 아니다. 페이지의 일반 성능 설명은 한국어 노트 품질 실측이 아님 |
| [OpenRouter caching](https://openrouter.ai/docs/guides/best-practices/prompt-caching) | 공통 접두와 공급자별 캐시 동작 | 세션 ID만으로 hit 판정 금지. 실제 cached/read/write usage와 과금값으로 판정 |
| [OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching) | 고정 접두, breakpoint, 동적 내용을 뒤에 배치 | 캐시를 위한 의미 없는 padding 금지. 정확한 모델/경로의 최소 길이·TTL·지원 파라미터 확인. 과거 모델의 1,024-token 규칙을 무조건 이식하지 않음 |
| [OpenRouter reasoning](https://openrouter.ai/docs/api_reference/responses/reasoning) | reasoning effort, 지원 모델의 configuration_update 안내 | 현재 경로의 지원을 probe한 다음 effort 변경 실험. 요청 수준 effort를 바꾸는 것과 입력 뒤에 update item을 추가하는 것은 다름 |
| [Provider routing](https://openrouter.ai/docs/guides/routing/provider-selection) | only 제한과 계정 허용 목록이 함께 적용 | cache hit를 높이려는 이유로 ZDR/허용 공급자 제한을 완화하지 않음. 제한으로 인한 실패를 cache miss와 분리 |
| [OpenAI compaction](https://developers.openai.com/api/docs/guides/compaction) | 서버 threshold 방식과 독립 `/responses/compact` 방식 | 독립 compact의 반환 window는 전체를 그대로 이어서 사용. opaque item만 떼거나 임의 재요약 금지. 서버 방식의 이전 item 제거 규칙과 혼동하지 않음. OpenRouter/Azure 지원은 별도 검증 |
| [Jev 1.13 model jaggedness](https://docs.typesafe.ai/model-jaggedness/jev-1.13) | 다중 추론·숫자/날짜 비교·불필요한 긴 state·선택지 순서·적대적 입력에 대한 한계 | 하나의 주장과 관련 근거로 질문을 분리. 계산은 코드. 판정 실패를 곧바로 원문 무근거로 해석하지 않음 |

공식 문서는 기능 계약의 근거이며 이 조합의 품질 보증이 아니다. 최신 문서에서도 모든 user 메시지가 standalone compact 뒤에 원문 그대로 보존된다는 보장은 확인하지 못했다. native compact와 현재 encrypted reasoning replay도 다른 기능이다.

## 2. GitHub 구현에서 가져올 메커니즘

2026-10-08 조회 당시 커밋으로 고정했다. SDK를 그대로 설치하자는 제안이 아니다. 파일에 존재하는 메커니즘과 우리 저장 구조에 대한 설계 추론을 구분한다.

| 출처 / 조회 커밋 | 직접 참고할 부분 | 우리 설계 판단 |
|---|---|---|
| [Agents SDK 상태 소유권](https://github.com/openai/openai-agents-python/blob/26345c1e45ebede8e2fc9b0bc7341dedab5e01fc/.agents/references/conversation-state-ownership.md) | 재생 가능한 input 목록, 세션/서버 상태의 소유권 구분 | 클라이언트 암호화 checkpoint를 기준 상태로 삼고 서버 세션과 이중 원장 생성 방지 |
| [Agents SDK 세션 영속화](https://github.com/openai/openai-agents-python/blob/26345c1e45ebede8e2fc9b0bc7341dedab5e01fc/.agents/references/session-persistence.md) | 세션 기록과 rollback 경계 | 검증 전 결과를 committed note에 섞지 않음. 실패한 section만 재개. 전체 대화 replay를 의무화하는 뜻은 아님 |
| [Agent 정의와 실행 context](https://github.com/openai/openai-agents-python/blob/26345c1e45ebede8e2fc9b0bc7341dedab5e01fc/.agents/references/agent-definition-and-run-context.md) | agent 설정과 개별 실행 context 분리 | plan은 공통 불변 입력, 각 writer는 자기 근거/슬롯만 소유. 형제 writer의 임시 출력을 암묵적으로 공유하지 않음 |
| [Codex apply-patch](https://github.com/openai/codex/blob/82e70121f86bc1f6fea7f2bb7bbc169d259b3c6b/codex-rs/apply-patch/src/lib.rs) | 주변 문맥을 확인하는 국소 수정 | 텍스트 hunk를 복제하기보다 claimId + baseRevision + 허용 operation으로 구현. 충돌 시 재검토, 조용히 덮어쓰지 않음 |
| [LangGraph checkpoint capabilities](https://github.com/langchain-ai/langgraph/blob/40a2e6d845054cc0cc17a6a169ca6e7394e5231c/libs/checkpoint-conformance/langgraph/checkpoint/conformance/capabilities.py) | 저장/조회/삭제 및 선택적 증분 기록 capability | 완료 artifact의 재사용·삭제·버전 무효화 계약을 명시. 이 인터페이스만으로 멱등성이나 exactly-once가 보장되지는 않음 |

서버 plaintext SQLite 세션 저장 예제를 가져오면 현재 아키텍처와 충돌한다. 저장은 기존 AES-GCM package-store를 사용하고 서버에는 사용량/오류 코드 등 내용 없는 기록만 남긴다.

## 3. 논문: 최신 연구와 기반 연구를 분리

| 논문 / 최초 공개 | 확인 범위와 적용 가능한 통찰 | 한계 |
|---|---|---|
| [When Agents Coordinate](https://arxiv.org/abs/2608.16801), 2026-08-17 | 코딩 다중 에이전트의 조정 과정을 따로 측정. 본문 모델 `claude-sonnet-4-6`, Claude Code 2.1.x 확인. 작업 성공뿐 아니라 중복 작업·인계·통합 비용을 관측하는 설계에 참고 | Sol/Luna 및 한국어 강의 평가 아님. 우리 시스템에서도 plan→writer→review의 중복 근거 전송/재작성 비용을 별도로 측정하자는 추론 |
| [Multi-Agent Debate Strategies](https://arxiv.org/abs/2607.26212), 2026-07-28 v1 | 논쟁형 에이전트의 분류와 과제를 정리한 survey. 메타데이터/초록 확인 | 단일 모델 실험 결과로 취급하지 않음. 자유 토론 loop 채택 근거로 불충분 |
| [ACE](https://arxiv.org/abs/2510.04618), 2025-10-06 | 문맥 전체를 반복 요약하면 brevity bias/context collapse가 생길 수 있어 구조화된 증분 갱신을 제안 | 이번 확인에서 실험 모델 상세를 확정하지 못함. 효과 수치 인용 안 함. ID별 용어/조건/예외 memory를 변경분으로 갱신하는 실험에 참고 |
| [The Complexity Trap](https://arxiv.org/abs/2508.21433), 2025-08-29 | SWE-bench Verified, Qwen3 계열/Gemini 2.5 Flash 등을 사용한 observation masking와 LLM 요약 비교 | 과거 도구 결과를 가리는 것과 강의 근거를 버리는 것은 다름. 완료 작업의 로그를 줄이되 근거는 ID로 다시 읽을 수 있게 보존 |
| [When Can LLMs Actually Correct Their Own Mistakes?](https://arxiv.org/abs/2406.01297), 2024-06-03, 확인 v3 2024-12-03 | 자기수정에서 feedback 출처와 평가 설계의 중요성을 다루는 survey | 최신 모델 직접 검증 아님. 단순히 “다시 생각해”보다 schema/계산/근거 검증 결과를 주는 실험의 기반 |
| [Lost in the Middle](https://arxiv.org/abs/2307.03172), 2023-07-06, 확인 v3 2023-11-20 | 긴 문맥에서 관련 정보 위치의 영향을 평가한 기반 연구 | 현재 Sol의 실패율로 해석 금지. 조건/예외 위치를 바꾼 회귀 자료를 만드는 근거로 활용 |

검색 결과에 표시된 수집 시각을 논문 revision 날짜로 오인하지 않는다. 일부 arXiv 메타데이터 응답의 updated 값이 접근 시각과 일치하여, 교차 확인한 version 날짜 외에는 최신 개정일을 단정하지 않았다. 이 조사에서 **Sol 6.1 + Luna high + 한국어 강의 노트**를 직접 검증한 외부 논문은 확보하지 못했다.

## 4. Reddit: 운영 경험은 가설로만 사용

- [Don't compact, handoff with Claude Code](https://www.reddit.com/r/ClaudeAI/comments/1p6rksl/dont_compact_handoff_with_claude_code): 본문과 댓글을 확인했다. 작성자는 handoff를 권하지만 directed compact로 충분하다는 반대 경험도 있다. 도구 홍보와 자기선택 편향이 있으므로 handoff의 우월성 증거로 삼지 않는다. 정확한 게시일 미확인.
- [Subagents save context but use a lot of tokens](https://www.reddit.com/r/ClaudeCode/comments/1q6jr9o/yes_subagents_save_context_but_they_use_a_lot_of/): 검색으로 발견한 운영 경험 후보. 부모 context 감소와 전체 청구 토큰 감소는 다른 지표라는 실험 질문으로만 사용. 본문/정확한 날짜 검증이 충분하지 않아 사실 근거에서 제외.
- [Multi-agent handoff failures](https://www.reddit.com/r/AI_Agents/comments/1pxapa1/most_multiagent_failures_are_handoff_failures): 검색 후보. 인계 계약을 점검할 체크리스트 후보이며 실패 빈도나 원인에 대한 실증 자료로 인용하지 않음. 정확한 날짜 미확인.

커뮤니티에서 나온 아이디어라도 실제 적용 결정은 공식 계약·로컬 코드·대조 실험을 기준으로 한다. 검색 후보를 읽고 검증한 소스 수에 포함하지 않는다.

## 5. 통합 판단과 다음 실험 계약

**기본 판단:** 현행 계획→병렬 작성→조건부 수리 구조를 유지하면서 계약/컨텍스트/검증을 고치는 것이 첫 비교군이다. 역할 이름이나 SDK 교체보다 적용 가능한 feedback과 원문 조건 보존이 중요하다.

| 실험 | 바꾸는 변수 | 품질/비용 측정 | 채택 조건 |
|---|---|---|---|
| repair packet | 같은 Sol medium, full P 대 코드 선택 근거 | actual accepted patch, 조건/예외 보존, 복구당 비용, p95 | 필수 조건 누락·무근거 추가가 증가하면 반려. 통과 뒤 비용 비교 |
| stage prompts | 역할별 규칙 분리만 변경 | schema 실패, writer-null, 수리 호출/비용 | 계약 오류 수정 기준선보다 품질 저하 없는 경우 |
| Luna effort | 같은 입력 high 대 medium | 복구 포함 최종 비용과 blind 품질 | 단순 초안 단가가 아니라 repair까지 포함해 판단 |
| reviewer context | full P 대 추출 handoff 대 LLM handoff | 누락 ID, 근거 추가조회, accepted patch, 총 토큰 | 추출 패킷도 선택 오류가 가능하므로 누락/조회 실패 검사 필요 |
| compaction | 지원 probe 이후에만 native compact 추가 | 압축비+새 cache write+후속 read+재수정 비용 | 1/3/다회 후속 작업별 손익분기와 품질 둘 다 충족 |
| 캐시 | 동일 model/provider/prompt revision에서 cold/warm/TTL 경과 | cached input/eligible input, cache write, 청구액, provider, 지연 | null usage를 0 hit로 집계하지 않음. 실제 비용으로 판정 |
| 시각 구조 | 동일 claims/relations에서 기존 지면 대 HTML/SVG | 근거와 도식의 일치, 설명 이해, overflow, 수식 오류 | 없는 수치/인과/비교 축 생성 0. 글자 축소 전에 의미 단위 재배치 |

Jev는 별도로 사람 판정 표본을 만든다. 원문 근거가 있는데 보류된 주장, 무근거인데 통과한 주장, root 보류로 함께 사라진 dependent를 분리한다. 직접 명시/정당한 바꿔쓰기/다중 근거 추론/숫자/조건·예외별 오류표를 보고 threshold 또는 Sol 재검증을 결정한다. 판단 대상 문장과 판정 전후 변화는 로컬 암호화 검사물로 보존하고 서버에는 집계만 기록한다.

선정한 인문·경영·경제 강의를 동일 plan/evidence/renderer로 paired 비교하고 사람 blind 평가를 우선한다. 수정된 작은 benchmark와 end-to-end 비용을 모두 기록한다. 필수 조건 누락·무근거 관계·수식 의미 오류가 새로 생기면 비용이 싸도 채택하지 않는다. 이 문서의 절감 효과는 제안이며 새 실측 결과가 아니다.

## 6. 위임 기록

초기 CLI 워커: Devin SWE-2 High의 계약/예산 감사, AGY Gemini 3.8 Flash의 프롬프트/렌더 검토. 후속으로 사용자가 지정한 Herdr `기획 반영 검토` 탭 `w1:tJ`에 `plan-review-devin` (`w1:p2H`) 및 `plan-review-agy` (`w1:p2J`)를 생성했다. Devin은 통합 문서 반영, AGY는 과장 및 실험 기준 검토를 맡았다. 호스트가 원문 코드와 출처를 대조해 채택한다. 런타임 변경·배포는 이 작업 범위가 아니다.

호스트 검토에서 AGY의 무손실 handoff·Luna 준수율·항상 캐시 무효화라는 과장을 배제했다. 제안된 95%/98%/50% 합격선도 실측 또는 제품 합의가 없어 채택하지 않았다. 필수 의미 오류의 탈락 조건과 대조 실험을 우선한다.
