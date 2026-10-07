# 컨텍스트 누적 관리 분석: Claude Code · Codex · Aside

2026-10-07. 목적: `sol-session`(계획과 모든 작성 단계를 한 대화에 이어붙임)이 단계 수에 비례해 커지는 문제의 설계 참고. 근거는 공식 문서, Codex 소스, 이 맥의 실제 세션 로그다. Aside 내부 코드는 읽지 못해 세션 로그와 UI 이벤트로만 추정했다.

## 실측 배경

| 군 | 입력 토큰(작성 draft) | 캐시 적중 | 비용 | 핵심 커버리지 |
|---|---|---|---|---|
| independent (Sol 계획 + Luna High 독립 작성) | — | — | $0.142 | 29/29 |
| sol-session | 49,143 → 73,599 | 55% → 67% | $0.368 | 13/28 |
| sol-luna-tool | 115,303 → 93,714 → 167,329 | 48% → 65%(최종 턴 94%) | $0.467 | 13/24 |

세션 군의 413은 공급자 한도가 아니라 우리 서버의 `/v1/write` 본문 상한(256KB)이었다(독립 군은 같은 입력 검사에서 `LLM_REQUEST_TOO_LARGE` 0건). 상한을 4MB(세션 요청만)로 올렸고, 재측정은 배포 후 진행한다. 따라서 위 품질 수치는 가설의 기각이 아니라 상한이 만든 결과다. 비용이 2.6~3.3배였던 점은 상한과 무관하다.

## 세 도구의 방식

| | Claude Code | Codex | Aside |
|---|---|---|---|
| 1차 대응 | 오래된 도구 출력부터 비움 | 임계치 초과 시 자동 압축(`model_auto_compact_token_limit`) | 자동 압축(`auto_compaction_start/end`) |
| 압축 결과 | 요약 + 요청·핵심 코드 보존 | 로컬: 최근 사용자 메시지(최대 20,000 토큰) + 요약. 원격: 사용자·개발자 메시지 + 불투명 `compaction` 항목 | 요약 1개(`summary`, `firstKeptEntryId`, `tokensBefore`, 읽은·수정한 파일) + 그 이후 원문 |
| 트리거 | API 기본 150k(최소 50k) | 컨텍스트 약 90% 상한(3자 출처) | 실측 `tokensBefore` 88k~246k |
| 원본 | JSONL에 전부 보존, 모델이 보는 컨텍스트만 축소 | 롤아웃 JSONL에 `compacted` 레코드 | `messages.jsonl` append-only |
| 분리 | 서브에이전트 별도 컨텍스트, 요약만 반환. 포크는 대화 사본으로 시작 | 에이전트 v2 | 확인 못 함 |
| 폭주 방지 | 압축 직후 재충전되면 몇 번 후 오류로 중단 | 오버플로 시 가장 오래된 항목 제거 후 재시도 | 공급자별 오버플로 오류 감지 |

- Claude API 도구 결과 비우기(`clear_tool_uses`): 기본 100k에서 작동, 최근 3개 유지, 비울 때마다 프롬프트 캐시가 깨지므로 `clear_at_least`로 한 번에 충분히 비우라고 권한다.
- Claude API 요약 압축: 압축 블록 이전 내용은 API가 무시한다. 시스템 프롬프트에 별도 캐시 중단점을 두면 압축 후에도 그 캐시가 유지된다.
- Codex 원격 압축 실물(이 맥 롤아웃 `replacement_history`): 사용자 메시지 6, 개발자 메시지 3, 마지막에 `compaction` 항목 1.
- Aside 요약 형식: `Goal / Constraints / Progress(Done·In Progress·Blocked) / Key Decisions / Next Steps / Critical Context`. 한 턴이 잘리면 `Original Request / Early Progress / Context for Suffix`.

## 시사점

1. 세 도구 모두 이력을 무한히 누적하지 않는다. 비우거나, 요약하고 최근만 원문으로 두거나, 큰 일은 별도 컨텍스트로 분리한다.
2. 대화형 에이전트와 우리 파이프라인은 다르다. 우리는 각 단계의 검증된 출력이 클라이언트에 이미 저장된다. 이전 섹션의 근거 원문·스키마는 다음 섹션에 필요 없다.
3. 가장 가까운 모델은 포크다. 계획 턴을 고정 접두로 두고 각 작성 호출이 `접두 + 자기 작업`만 보낸다. 입력 크기가 일정하고, 접두는 캐시가 읽고, 섹션을 병렬로 쓸 수 있다.
4. 체인을 유지한다면 도구 결과 비우기에 해당하는 정책이 필요하다: 검증된 단계의 작업 입력은 자리표시자로 바꾸고 출력만 남기되, 매 단계가 아니라 몇 단계마다 크게 비운다.
5. 상한은 거절이 아니라 축소로 처리한다. 이력이 한도에 가까우면 413 대신 "줄이라" 신호나 자동 정리.
6. 세션이 추가로 주는 유일한 것은 계획의 추론 항목을 작성이 이어받는 연속성이다. 접두 캐시 자체는 독립 호출도 이미 얻는다(섹션 공유 필드 선행 + 두 번째 캐시 중단점).

## 다음 실험

`sol-fork` 모드(계획 접두 고정 + 작성 호출마다 접두 + 자기 작업, 첫 작성 호출만 단독으로 캐시를 데우고 나머지는 병렬)를 네 번째 군으로 추가한다. 비교군: independent, sol-session(413 수정 후), sol-luna-tool(수정 후), sol-fork. 지표: 호출별 cache read, 총비용, 지연, 섹션·문항 생존, T5 보류, 핵심 커버리지.

## 출처

- [Anthropic Context editing](https://platform.claude.com/docs/en/build-with-claude/context-editing)
- [Anthropic Compaction](https://platform.claude.com/docs/en/build-with-claude/compaction), [token threshold](https://platform.claude.com/docs/en/build-with-claude/compaction-threshold)
- [How Claude Code works](https://code.claude.com/docs/en/how-claude-code-works)
- [OpenAI Compaction guide](https://developers.openai.com/api/docs/guides/compaction)
- [Codex compact.rs](https://github.com/openai/codex/blob/main/codex-rs/core/src/compact.rs)
- [Codex 압축 튜닝(3자 블로그)](https://codex.danielvaughan.com/2026/04/16/codex-cli-context-compaction-tuning-long-sessions/)
- 로컬 실물: `~/.codex/sessions/2026/10/06/rollout-*.jsonl`, `~/.aside/u/0/sessions/*/messages.jsonl`
