---
description: 자동 디버깅 루프(테스트→진단→수정→재테스트). herdr 창 안에서 orch로 실행한다.
---

설계 근거는 `docs/superpowers/specs/2026-10-11-debug-loop-design.md`. 이 문서는 실행 절차다. `AGENTS.md`와 `memory.md`가 우선한다.

## 0. 시작 조건 (하나라도 실패하면 시작하지 않는다)
- `HERDR_ENV=1`, `SUMM_LOOP=1`, 브랜치 `b/visual-verify`, `git status` 깨끗함.
- 웜 Chrome :9333 응답, 확장 버전 = `manifest.json` 버전(다르면 드라이버가 재로드한다).
- 환경: `PLAYWRIGHT_MODULE`, `CHROME_PATH`. 드라이버는 항상 `--skip-folder --inspect`로 돌린다.
- 예산: 반복 8회 / 3시간 / e2e 실행 20회 이하. 시작 전에 이번 달 전역 사용량을 사용자에게 확인한다.
- `~/.lecture-e2e/loop/ledger.jsonl`이 있으면 이어서 한다(없으면 기준선부터).

## 1. 기준선 (첫 반복 전 1회, 현재 HEAD)
1. `node --test lib/*.test.js server/*.test.js tools/*.test.mjs`의 실패 이름 목록 → `baseline.json.testFailed`.
2. `node tools/visual-verify-eval.mjs . <out>.json`의 `summary`를 `eval`로.
3. e2e 1회 → `metricsOf(report)`(tools/debug-loop-verdict.mjs)를 `baseline.json.metrics`로.
저장 위치는 `~/.lecture-e2e/loop/baseline.json`. 저장소 안에 두지 않는다.

## 2. 반복 1회
1. **오프라인 게이트**(runner 창): 위 테스트, `node tools/package-cws.mjs --dry-run --skip-tests`, `visual-verify-eval` → `offline.json` `{testFailed, packageOk, eval}`.
2. **e2e**(runner 창): 본 실행 `node tools/e2e-flow.cjs --url "<YT>&t=<시작>" --flow live --duration 180 --skip-folder --inspect`. 음성 시나리오 `--flow bg`는 판정에 `--negative-yt`를 붙인다.
3. **판정**: `node tools/debug-loop-verdict.mjs --run <runDir> --offline offline.json --baseline baseline.json`. 종료 코드 0 = pass. **판정은 이 코드가 한다. 눈으로 바꾸지 않는다.**
4. **triage**: scout(읽기 전용)가 report.json·console/network.ndjson·진단 JSON·`tools/figure-trace.mjs` 출력을 요약해 `<i>/triage.json`에 쓴다. orch가 `failures[].class`를 확정한다.
   - FLAKY(그 시그니처가 처음) → 재실행 1번. ENV → 복구 뒤 재실행. SERVER → 수정·마이그레이션 파일·테스트까지만 하고 "배포 필요"로 표시, 다음 문제로. HUMAN → §5. POLICY → 고치지 않는다(막혔는지만 본다).
5. **dispatch**(CODE만): fixer에게 시그니처마다 하나씩. 지시 템플릿:
   > 시그니처 `<SIG>` / 증거 `<evidence>` / 관련 파일 `<files>`. ① 실패하는 재현 테스트부터 쓴다 ② 최소 수정 ③ 그 테스트만 실행 ④ 커밋하지 않는다 ⑤ `~/.lecture-e2e/loop/<i>/<sig>.result.json`에 `{status:"fixed"|"escalate", files, test, note}`를 쓴다. 잠근 파일은 건드리지 않는다.
6. **리뷰·커밋**(orch): `git diff`가 지정 파일 안인지, 잠근 파일을 안 건드렸는지, 불변식(AGENTS.md §2)을 안 깼는지 본다. 전체 게이트를 돌린다. 출하 코드면 `node tools/bump-version.mjs build` + CHANGELOG(한국어, 효과→`필드: …`) + `fix: …; vX.Y.Z.W`. 도구·테스트·문서만이면 bump 없음. 디스패치 전에 작업 트리를 커밋해 깨끗하게 둔다.
7. **장부**: `ledger.jsonl`에 한 줄 `{i, ts, runDir, pass, invalid, signatures, commits, metrics, ms}`. 정지 조건을 검사한다.

## 3. 목표와 정지
- 성공: 판정 `pass:true`(invalid 아님)가 **2회 연속**. LLM 출력은 매번 다르다.
- 하드: `falseApprove=0`, 새 테스트 실패 0, `FIGURE_FUNNEL selected≥1`, 렌더 경고 5종 0, pageerror 0, 진단 error 0.
- 래칫: 판정기가 기준선과 비교한다. 좋아지면 기준선을 새로 저장하되 **orch만** 갱신한다.
- 정지: 성공 / 8회 / 3시간 / 같은 시그니처 3회 연속 / 래칫 2회 연속 악화 / HUMAN 관문. 정지하면 마지막 정상 커밋과 장부 요약을 보고한다.
- 에이전트는 목표·평가 도구를 고치지 못한다.

## 4. 잠근 파일 (수정 금지, diff 검사 대상)
`tools/visual-verify-eval.mjs`, `tools/e2e-flow.cjs`, `tools/debug-loop-verdict.mjs`, `tools/debug-loop-verdict.test.mjs`, 이 문서, `AGENTS.md`, `.claude/**`.
고쳐야 하는 이유가 생기면 정지하고 사용자에게 묻는다.

## 5. 막힘 처리
- fixer → orch: `escalate`, 같은 시그니처 2번 실패, 잠근 파일이 필요, herdr `blocked`/timeout. orch가 `herdr agent read`로 화면을 보고 systematic-debugging으로 직접 원인을 잡아 더 좁게 다시 맡기거나 직접 고친다. 워커가 두 번 실패하면 orch가 직접 하고 보고에 적는다.
- orch → 사용자(푸시 알림 후 정지): Google 로그인·동의·`401`·`quota_exceeded`, 예산 소진, 무진전, 운영 위험(전역 한도), 웜 Chrome 종료.
- `blocked` 화면 응답은 무해한 확인(폴더 신뢰 등)만. 그 밖은 워커를 멈춘다.

## 6. herdr 배치 (이 절차 안에서 직접 한다. 런처 스크립트 없음)
- `herdr pane split --current --direction right --cwd "$PWD" --no-focus`로 runner·scout·fixer 창을 만든다.
- scout/fixer: `herdr agent start <name> --kind agy --pane <pane> -- --agent gemini-flash --dangerously-skip-permissions`. 권한 플래그 없이 띄우면 첫 셸 명령에서 승인 대기로 멈춘다.
- 일은 `herdr agent prompt <name> "<지시>" --wait --timeout <ms>` 로 맡기고, **끝났는지는 result.json 파일로 확인**한다. 쓰기는 한 번에 한 명.
- 작업마다 새 대화로 시작한다. 결과 경로는 `~/.lecture-e2e/loop/<i>/`.

## 7. 금지
push·PR·배포(`supabase functions deploy`/`db push`)·DB 변경·service-role 키 사용·동의 자동 수락·클라우드 자동 전환·YouTube 백그라운드 활성화·`main` 직접 커밋.
