# sol-fork-2 · sol-luna-2 파일럿 결과 (2026-10-07~08)

문서 상태: **implemented · tested · deployed. quality-judged 아님.** 사람 블라인드 평가가 없으므로 어떤 모드의 승자도 판정하지 않는다. 아래 "품질 대리 지표"는 파이프라인이 스스로 낸 검증 이벤트이고 사람 점수가 아니다.

## 1. 한 줄 요약

- 계획이 한 번의 Sol 호출에 `plan`+`editorialPlan`을 합치면 Supabase Edge 대기 한도(무료 약 150초)를 넘겨 파일럿이 처음부터 막혔다. 둘을 같은 세션의 두 호출(`plan`, `editorial`)로 나누자 plan 55~69초, editorial 41~50초로 통과했다.
- `sol-fork-2` 완주 1회 $1.326, `sol-luna-2` 완주 3회 $0.512·$0.877·$0.976(A·B·C). 기준 `independent`는 $0.142(이전 측정).
- 모든 완주 run이 `일부 완료`다. 통과당 비용은 품질 통과 판정이 0건이라 **n/a**.
- `sol-luna-2` run A·B는 S4·S5 섹션이 서버 계약 위반으로 요청이 거절돼 `no-output`이었다(근인은 5절 4번, 수정 후 run C에서 해소). **같은 조건의 비교는 `sol-fork-2` ↔ `sol-luna-2` run C뿐이다.**
- 그 비교에서 `sol-luna-2`(run C)는 `sol-fork-2` 대비 비용 -26%($0.976 vs $1.326), 소요는 비슷(둘 다 약 11분)하다. 비용 차이의 대부분은 draft(Sol $0.450 → Luna $0.037)에서 나오고, repair(Sol)는 오히려 $0.566 → $0.652로 늘었다.

## 2. 환경

| 항목 | 값 |
|---|---|
| 확장 | 2.6.0.1 (실서버·실확장, 실제 강의 1개) |
| 계정 | `developer` 등급 |
| 모델 | Sol=`openai/gpt-6.1-sol`(reasoning medium), Luna=`openai/gpt-6-luna@high` |
| 계획 비교 | endToEnd(각 run이 자기 계획을 만든다 — 계획 규모가 run마다 다름: 포함 항목 38/23/27) |
| 상한 | run당 $1.5 |
| 프라이버시 | ZDR + data_collection deny, 강의 원문·노트 내용은 로그·보고에 싣지 않음 |

## 3. 완주 run 비교 (서버 원장 `usage_events`)

| | `sol-fork-2` | `sol-luna-2` (run A) | `sol-luna-2` (run B) | `sol-luna-2` (run C, 수정 후) |
|---|---:|---:|---:|---:|
| 총 지출 | $1.326 | $0.512 | $0.877 | $0.976 |
| 소요(원장 첫 호출~마지막) | 약 11분 | 약 7분 24초 | 약 16분 | 약 11분 25초 |
| plan | $0.099 · 69초 | $0.084 · 55초 | $0.097 · 67초 | $0.089 · 59초 |
| editorial | $0.069 · 45초 · 캐시읽기 13,382 | $0.060 · 41초 · 13,379 | $0.073 · 50초 · 13,391 | $0.069 · 47초 · 13,390 |
| draft | 5×Sol $0.450 (평균 58초, 최대 81초) | 4×Luna $0.025 (평균 65초) | 5×Luna $0.036 (평균 88초, 최대 109초) + 120초 시간초과 1건 $0.040 | 5×Luna $0.037 (평균 84초, 최대 105초) |
| repair | 13×$0.566 | 5×$0.242 | 8×$0.528 | 11×$0.652 |
| review | $0.077 · 38초 | $0.055 · 36초 | $0.053 · 28초 | $0.070 · 48초 |
| global | $0.062 · 31초 | $0.045 · 24초 | $0.048 · 27초 | $0.056 · 26초 |
| judge(Jev) | $0.004 | — | — | $0.003 |
| 호출 오류(원장 `error`) | 0 | 0 | 1(Luna draft 시간초과) | 0 |
| Sol 입력 캐시읽기(후속 호출) | 26,662 고정 | 약 24,781 | 27,006 고정 | 26,082 고정 |

- 접두 캐시는 실제로 붙었다. `editorial`이 plan 이력 약 13.4k토큰을 읽고, 이후 Sol 호출은 같은 약 25~27k 접두를 읽는다. Luna 호출은 세션 밖 독립 호출이라 캐시읽기 0.
- `sol-fork-2`에서 repair 13건이 43%, draft 5건이 34%를 차지한다.
- `sol-luna-2`는 draft가 Luna로 바뀌어 draft 비용이 $0.45 → $0.025~0.037으로 줄지만, repair(Sol)가 run B·C에서 $0.528·$0.652로 `sol-fork-2`($0.566)와 같거나 크다. run C 기준 repair가 비용의 67%다.
- 참고(이전 측정, 같은 강의): `independent` $0.142, `sol-fork` $0.99, `sol-session` $0.368(불완전), `sol-luna-tool` $0.467(불완전).

## 4. 품질 대리 지표 (사람 평가 아님)

| 이벤트 | `sol-fork-2` | `sol-luna-2` A | `sol-luna-2` B | `sol-luna-2` C |
|---|---|---|---|---|
| 작성자 보류 블록 → 재작성으로 살림(`BLOCKS_HELD`) | writer=5, 5 복구 | writer=13, 11 복구 | writer=13, 13 복구 | writer=15, 13 복구 (judge 1) |
| 핵심 커버리지(core) | 32/34 | 20/27 | 23/31 | 25/25 |
| supporting / 조건 / 예시 | 6/6 · 4/5 · 4/4 | 3/4 · 1/2 · 2/3 | 4/5 · 2/3 · 3/4 | 5/5 · 3/3 · 3/3 |
| 통합 검수 제안/반영/반려 | dedupe 8/0/8, term_fix 1/0/1, claim_edit 2/0/2, 섹션 재작성 1/1/0, 미해결 9 | claim_edit 4/0/4, dedupe 2/0/2, term_fix 5/0/5, 미해결 10 | 섹션 재작성 4/2/2, claim_edit 3/0/3, term_fix 1/0/1, dedupe 1/0/1, 미해결 3 | 섹션 재작성 2/2/0, claim_edit 3/0/3, dedupe 4/0/4, term_fix 3/0/3, 미해결 6 |
| 근거 지지 주장(유지/전체) | 142/195 (의존 탈락 45) | 78/85 (의존 탈락 4) | 63/99 (의존 탈락 30) | 102/140 (의존 탈락 32, 보류 7) |
| 섹션 탈락 | 0 | S4·S5 no-output | S4·S5 no-output | 0 |
| 최종 상태 | 일부 완료 | 일부 완료 | 일부 완료 | 일부 완료 |

- 통합 검수는 네 run 모두 텍스트 수정(claim_edit·term_fix·dedupe) 제안이 **재검증을 통과해 반영된 것이 0건**이다. 검수가 비용($0.05~0.08)을 쓰지만 반영 효과는 아직 확인되지 않았다. 반영된 것은 섹션 재작성 요청뿐이다.
- 커버리지 분모(계획의 학습 항목 수)가 run마다 달라 절대 비교는 안 된다. run C는 포함 항목 30개 전부(deferred 0)를 계획해 core 25/25로 닫혔지만, 이는 계획이 한 번 더 좋게 나온 영향과 구분되지 않는다.
- 노트 PDF(렌더 확인용, 블라인드 평가 미실시): `~/.lecture-e2e/runs/pdf/sol-fork-2.pdf`(28블록), `sol-luna-2.pdf`(run B, 25블록), `sol-luna-2-c.pdf`(run C, 30블록). 보관함 폴더 저장이 실패해 기기 패키지 저장소에서 직접 렌더했다.

## 5. 파일럿에서 찾아 고친 문제 (근인과 근거)

| # | 증상 | 근인 | 조치 | 상태 |
|---|---|---|---|---|
| 1 | 두 모드 계획이 세 번 모두 120~148초에 끊김 ($0.09~0.13/회) | 한 호출에 plan+editorialPlan → 출력 8.5k토큰 이상, Sol 초당 약 60~95토큰이라 Edge 한도 초과. v1 plan은 5~6k토큰·55~70초였다 | editorialPlan을 같은 세션의 두 번째 Sol 호출(`editorial` 단계)로 분리 | 구현·테스트·배포, 실측 통과 |
| 2 | `editorial`이 `invalid_schema._v`로 4회 거절 ($0.39) | 모델이 계약 버전 칸 `v`에 1이 아닌 숫자를 씀(진단: 루트 키 정상, v 숫자) | 서버가 `glossary`·`sections`가 있으면 `v`를 1로 맞춤, `{editorialPlan:…}` 감싼 응답은 풀어 줌, 위반 시 루트 키 이름·v 타입만 detail에 기록 | 구현·테스트·배포, 실측 통과 |
| 3 | `sol-luna-2` Luna draft 6건이 `unexpected_field`로 거절 | 클라이언트가 섹션 편집 패킷(`editorialPlan`)을 싣는데 서버 draft 요청 계약에 칸이 없었음. 클라이언트 테스트가 이 칸을 검증에서 제외해 가려짐 | draft 요청에 선택 칸 `editorialPlan`(엄격한 모양) 추가, draft 지시에 사용법 문단 | 구현·테스트·배포 |
| 4 | `sol-luna-2` S4·S5 draft 요청이 `request_rejected` (`/editorialPlan/prerequisites`), 두 run 연속 | 선행 섹션이 여러 개일 때 섹션마다 최대 12개씩 이어 붙여 서버 상한 12 초과(검증기가 개수 초과를 배열 경로로 기록하는 코드로 확정) | 선행 주장 합계 12개를 선행 섹션 round-robin으로 채움(클라이언트) | 구현·테스트·배포(워커 v2-client 작성, 호스트 검증), run C에서 S4·S5 복구 확인 |
| 5 | `sol-luna-2` Luna 문항 요청의 `editorialPlan.glossary`가 모델에 전달되지 않음(거절 없이 폐기) | `REQUEST.questions`에 그 칸이 없어 서버가 계약 키만 골라 담음 | `REQUEST.questions`에 선택 칸 추가(`{v, glossary}`만) | 구현·테스트·배포(워커 v2-server 작성, 호스트 검증). 모델 입력 반영은 서버 테스트로 확인, 실 run 효과 분리 측정은 안 함 |
| 6 | Luna draft 1건 120초 시간초과 ($0.040, 과금됨) | 큰 섹션의 Luna High 작성이 120초 안에 끝나지 않음 | 미조치(분할 사다리가 처리했는지는 미확인) | 열림 |
| 7 | 하네스 5회 연속 시작 단계 차단(과금 0) | `offscreen.html`을 일반 탭으로 연 잔여 탐침 탭이 BG 메시지를 가로챔 → `AUTH_TOKEN`이 탭 발신이라 거부 → 패널이 `bgLocked`. 근거: 배경 쪽에서 본 발신자 `tab:true`, 탭을 닫으면 즉시 `background:true`. 그 밖에 사이드패널 `load` 지연·일시정지 작업 잠금·preflight 단일 읽기 | `tools/e2e-flow.cjs`가 CDP로 잔여 탭을 닫고 `domcontentloaded`까지만 기다리며 잠금 해제를 폴링 | 구현됨(제품 코드 변경 없음) |
| 8 | 노트 파일을 보관함 폴더에 저장하지 못함(`LIBRARY_EXPORT_FAILED`) | **미조사.** 기본 보관함 경로 `~/Downloads/Summrizei`가 디스크에 없었음 | — | 열림 |

## 6. 비용 총괄 (원장, 2026-10-07 19:00 KST 이후, 판정 `judge.*` 제외)

- 성공 호출 57건 $3.131 · 오류 14건 $1.361(plan·editorial 오류 13건 $1.321) · 환불 5건 $0.
- 파일럿 전체 약 $4.49. 그중 약 $1.3은 계획 시간초과와 `editorial` 형식 오류(위 1·2번)로 쓴 비용이고, 완주 3회가 약 $2.72다.
- 환불된 5건은 모두 상류 `provider_body_rate_limit_exceeded`였다. 이 오류는 `editorial`과 plan에서도 간헐적으로 났다(완주 run들에서는 0건).

## 7. 판정하지 않는 것과 다음 단계

- 판정하지 않음: 어느 모드의 노트가 더 좋은지(사람 평가 없음), run C 한 번의 비용이 대표값인지(같은 조건 반복 측정 없음 — run마다 계획 규모가 달라 비용이 $0.51~0.98로 흔들렸다).
- 판단 근거가 있는 것: Sol이 쓰는 경로의 비용은 독립 경로의 약 4~9배(`sol-luna-2` run C 기준 6.9배, `sol-fork-2` 9.3배)다. 통합 검수는 아직 반영 효과가 없다. 접두 캐시와 계획 분리는 의도대로 동작한다.
- 다음 단계(우선순위 순):
  1. 같은 강의의 `independent`·`sol-fork-2`·`sol-luna-2`(run C)를 사람이 블라인드로 비교 — 필요한 선행 조건이다.
  2. repair 비용 절감(run C에서 비용의 67%): `sol-fork-2` 기준 repair 13건의 평균 입력은 약 40k토큰(캐시읽기 26.7k 포함)으로, 블록 단위 재작성에도 접두 P 전체를 싣는다. 별도 repair 접두(계획·편집만) 또는 Luna repair 시도를 검토.
  3. 통합 검수의 반려 사유 분포를 보고 재검증 규칙이 과한지, 제안 품질이 낮은지 가린다.
  4. 8번(보관함 저장 실패) 조사.

## 8. 후속 (2026-10-09): `reasoning.context` 비교와 Liner 전환

### 8.1 `reasoning.context`

- 공식 문서(OpenRouter reasoning-tokens): 출력 아이템을 되돌려 보내는 멀티턴에서 모델이 볼 추론 범위를 정한다. `auto`(기본)·`all_turns`(입력의 모든 턴 추론 참조)·`current_turn`(현재 턴만). GPT-5.6 이상만 지원. Liner는 이 칸을 거절(`unknown_parameter`)하고 `reasoning` 아이템도 돌려주지 않는다.
- 합성 fixture(`sol-luna-3`, 계획→편집, 6회): 계획 입력 3741토큰, 용어집 7·섹션 5로 동일, 블록 수 18~20, 비용·시간·토큰은 같은 설정 반복 편차 안. 곱셈 회상 시험(OpenRouter, 설정당 3회)은 셋 다 3/3이라 구분력이 없었다.
- 실강의 `sol-luna-2`(lec2): `current_turn` 1회 총 약 $0.50(run C `all_turns` $0.976). plan·editorial·draft 비용은 같고(각 $0.086·$0.063·$0.034 대 $0.089·$0.069·$0.037), 핵심 25/25 동일. 비용 차이는 review가 502로 4회 실패해 비용이 없고 repair 호출 수가 달라서이며 옵션 효과로 읽을 수 없다. 사람이 두 PDF를 보고 "큰 차이는 없다"고 판단했다(블라인드 아님).
- 결론: 이 구간에서 `reasoning.context`가 필요하다는 증거는 없다. 서버 실험 스위치(`NOTE_REASONING_CONTEXT`)는 실험 후 되돌렸다.

### 8.2 Liner 게이트웨이 전환 (v2.7.1, 커밋 `beb4f5f`)

- 확인: Liner `/v1/responses`·`/v1/chat/completions`에서 `openai/gpt-6.1-sol`·`openai/gpt-6-luna`가 동작하고, `usage.cost`를 보고하며, 접두 캐시가 된다(chat은 `cache_control`로 쓰기·읽기 확인, responses는 자동. Sol 읽기 단가는 OpenRouter와 같은 수준). `session_id`·`include`·`text.format`·`seed`·`prompt_cache_key`는 받는다.
- 거절(400): `provider`(chat), `prompt_cache_options`, `reasoning.context`, chat의 `reasoning` 객체(→ `reasoning_effort`로 대체). `gpt-6-luna@high` 접미사 모델명은 없다(서버가 기본 모델명+effort로 보낸다). `reasoning.encrypted_content` 추론 아이템은 오지 않는다.
- 구현: `server/llm.js` `toLiner` — GPT-6 Sol·Luna 요청만 Liner 형식으로 바꿔 보낸다. 시크릿 `LINER_API_KEY`·`LINER_BASE_URL`이 있을 때만 작동하고 지우면 OpenRouter로 돌아간다. 판정·STT·비전·mimo 등은 OpenRouter 그대로.
- 실강의 검증(`sol-luna-2`, lec2, 배포 서버): 완주, 총 $0.846(plan $0.097, editorial $0.078, draft $0.050/6회, repair $0.460/6회, review $0.082, global $0.077). 핵심 22/22·보충 9/9·조건 4/4·예시 4/4, 섹션 탈락 없음, 보류 19→18 복구, 근거 유지 135/145.
- 열린 위험: ① **Liner의 데이터 보존(ZDR)·`data_collection:"deny"` 준수는 확인하지 못했다** — `provider` 칸을 보낼 수 없어 요청으로는 강제할 수 없다. 약관 확인 필요. ② review의 섹션 재작성 요청 5건이 `stale_revision`으로 거절돼 채택 0(원인 미조사). ③ 라이브러리 저장 실패(5번 8행)는 계속된다. ④ 한 번씩 돌린 결과라 OpenRouter 대비 품질·비용 차이를 가르지 못한다.
