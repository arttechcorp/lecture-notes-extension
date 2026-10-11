# Summrizei 자동 디버깅 루프 (herdr + agy + Playwright): 검토와 계획

## Context
- `b/visual-verify`는 그림(차트·표·수식) 다시 그리기 검증 브랜치다. 최근 버그 3건(2.6.1.2~2.6.1.4, 예: 서비스가 보낸 `ink` 칸 때문에 노트 생성이 멈춤)은 모두 실제 실행에서야 드러났다. 지금은 사람이 확장을 직접 열어 확인한다.
- 목표: 한 번 시작하면 테스트 → 진단 → 수정 → 재테스트를 사람 없이 반복하고, 목표 도달·예산 소진·사람 전용 관문에서만 멈춘다.
- 사용자 결정 사항:
  - 조작 주체: Playwright 주력, Claude in Chrome 보조.
  - 자율 범위: 현재 브랜치 로컬 커밋까지(push·PR·배포·DB 변경 없음).
  - 예산: 반복 8회 / 3시간.
  - 기준 강의: YouTube `oGoIo56vEqk`(재생목록 12번).
  - 추가 요청: YouTube 백그라운드 실행이 안 되는 문제 검토.

---

## 1. 검토 — "모든 문제"를 자동으로 풀 수 있나?
**결론: 전부는 안 된다.** 다만 문제를 다섯 갈래로 나누면 코드 버그와 환경 문제는 자동으로 풀 수 있다. 나머지는 미리 한 번 손대 두거나, 정책상 멈추는 것이 맞다.

| 분류 | 실제 예(이 저장소) | 자동 해결 | 방법 |
|---|---|---|---|
| **CODE** 코드 버그 | 계약 위반(`/blocks/0/ink`), 렌더 경고 `RENDER_FORMULA_FAILED`, 차트 오승인 | ✅ 루프의 본업 | 재현 테스트 → 최소 수정 → 게이트 → 로컬 커밋 |
| **ENV** 환경 상태 | 웜 Chrome 꺼짐, 확장 버전 불일치, `queue_busy`(DB 슬롯 실패가 "바쁨"으로 보임) | ✅ | 사전 점검(preflight)에서 복구 또는 1회 재시도 |
| **SERVER** 서버·Supabase | `409 note_spec_mismatch`, RLS·RPC·CHECK 위반, `426` | ⚠️ 절반 | 수정·마이그레이션 파일·테스트까지는 자동으로 하고 로컬 커밋한다. **배포(`functions deploy`·`db push`)는 사람**이 한다. 운영 서비스를 쓰므로 서버 수정은 배포 전까지 재검증할 수 없다 → "배포 필요"로 표시하고 다음 문제로 넘어간다. |
| **HUMAN** 사람 전용 관문 | Google 로그인(자동화 Chrome은 Google이 거부), 동의 체크, 폴더 선택기, `401` 갱신 실패로 인한 로그아웃, `quota_exceeded` | ❌ | §4의 1회 사전 셋업으로 예방한다. 실행 중에 걸리면 즉시 멈추고 알린다. |
| **POLICY** 풀면 안 되는 것 | DRM·암호화 스트림, YouTube 백그라운드, 동의 자동 수락, 클라우드 자동 전환 | 🚫 | AGENTS.md 불변식에 따라 "제대로 멈췄는지"만 검증한다. |

Supabase 권한 구조(탐색 결과):
- 모든 테이블이 RLS 켜짐 + 정책 0개다. 클라이언트는 `my_account`, `library_key`, `plan_catalog` RPC만 부르고, 나머지는 서버 service-role이 다룬다. 그래서 루프에서 보이는 "권한 문제"는 사실상 다섯 가지다:
  - `401`: 토큰 갱신 실패 → HUMAN
  - `403 origin_not_allowed`: 확장 ID 불일치 → ENV
  - `429 quota_exceeded` → HUMAN
  - `409`·`426`: 배포 불일치 → SERVER
  - `queue_busy` → ENV
- **에이전트에게 service-role 키를 주지 않는다.** 테스트 계정 플랜 지정도 사용자가 SQL로 한 번 한다.

Claude in Chrome의 한계(무인 루프에서 뺀 이유):
- 다른 확장의 `chrome-extension://` 페이지와 사이드패널을 조작할 수 없을 가능성이 높다.
- 실패가 2~3회 나면 멈추고 사람에게 묻게 돼 있다.
- 사이트별 권한 프롬프트가 뜬다.

→ 보조 역할로만 쓴다: 목표를 달성한 뒤 실제 Chrome의 웹 보관함(`summrizei.vercel.app/library`)에서 노트를 육안으로 확인한다.

## 1-b. YouTube 백그라운드 검토
- **버그가 아니라 의도된 차단이다.**
  - 코드: `lib/background-job.js:35`의 `YOUTUBE` 정규식 → `gate()` → `SRC_UNSUPPORTED_HOST`.
  - 근거: `docs/architecture-v2.md` §19 리스크 레지스터. YouTube 약관이 다운로드를 명시적으로 금지하고, 스트림이 서명·토큰 기반(googlevideo DASH)이라 불안정하다. 백그라운드는 HLS만 지원한다. 웹스토어 정책 위반 위험도 있다.
- **권고: 켜지 말 것.** 켜면 약관 위반과 웹스토어 반려 위험이 생긴다.
- "안 되는 것 같다"는 체감이 **안내가 불명확해서**일 수 있으니 이것을 확인한다. 기대 동작:
  - (a) `lib/pipeline.js:23` 문구("이 사이트는 백그라운드 처리 대상이 아닙니다…")가 뜬다.
  - (b) `실시간 캡처 설정으로 이동` 버튼이 뜬다.
  - (c) 자동 시작이나 자동 엔진 전환이 없다.
- 루프의 **음성 시나리오**로 넣는다: YouTube + `--flow bg` → 위 3가지가 맞으면 통과. 서버 호출 전에 막히므로 비용은 0이다.
- 개선 후보(이번 범위 밖, 결과를 보고 결정): YouTube 탭에서는 백그라운드 카드 자체에 "실시간만 지원"을 미리 표시한다.

---

## 2. 구조 — herdr 오케스트레이션

```
herdr 워크스페이스 "summ-loop" (SUMM_LOOP=1)
 ├─ orch   : claude --chrome (Opus)    판단·분류·리뷰·커밋·사용자 알림   ← 반드시 herdr 창 안(HERDR_ENV=1)
 ├─ runner : 일반 셸                    오프라인 게이트, e2e-flow.cjs 실행 (pane run / wait-output)
 ├─ scout  : agy --agent gemini-flash   로그 요약 → triage.json (읽기 전용 작업)
 └─ fixer  : agy --agent gemini-flash   재현 테스트 + 최소 수정 (쓰기는 한 번에 한 명)
웜 Chrome (:9333, 전용 프로필 ~/.lecture-e2e/profile) ← herdr 밖, 사람이 1회 셋업
```

- 지금 이 데스크톱 세션은 herdr 밖이다(`HERDR_ENV` 없음). 루프 오케스트레이터는 herdr 창에서 새로 띄운 CLI `claude`다.
- **쓰기는 직렬, 읽기는 병렬.** 같은 체크아웃을 둘이 동시에 고치면 충돌하고, e2e는 반드시 이 폴더에서 로드해야 한다(확장 ID `gibhonakailcjlgjnfgeggpoigdbieef`가 Supabase 리디렉트·`EXTENSION_ORIGIN` 허용 목록에 이미 있음. worktree·임시 복사본은 ID가 달라져 로그인과 서버가 깨진다).
  - ponytail: worktree 병렬 수정은 처리량이 실제로 병목일 때 추가한다.
- 에이전트 간 결과 전달: 터미널 긁기 대신 `~/.lecture-e2e/loop/<i>/<task>.result.json` 파일로 받는다. herdr `agent prompt --wait`로 끝났는지 확인한 뒤 파일을 읽는다. 작업마다 새 대화로 시작한다.

### 반복 1회의 흐름
1. **preflight**: :9333 응답, `git status` 깨끗함, 브랜치 `b/visual-verify`, 남은 예산, 워커 idle. 하나라도 실패하면 반복을 시작하지 않는다.
2. **오프라인 게이트**(runner): `node --test …`, `package-cws --dry-run`, `visual-verify-eval.mjs`. 싸고 결정적이다.
3. **e2e**(runner):
   - 본 실행: `e2e-flow.cjs --url <YT>&t=<시작> --flow live --duration <창> --inspect`
   - 음성 시나리오: `--flow bg`
4. **판정**: `tools/debug-loop-verdict.mjs`가 산출물을 읽고 pass/fail과 실패 시그니처를 낸다. LLM이 아니라 코드가 판정한다.
5. **triage**: scout가 report.json, console/network.ndjson, 진단 JSON, `figure-trace.mjs` 출력을 요약한다. orch가 CODE/ENV/SERVER/HUMAN/FLAKY로 분류한다.
   - FLAKY(1회만 발생) → 재실행 1번.
   - ENV → 복구한 뒤 재실행.
   - HUMAN → 정지하고 알림.
6. **dispatch**: CODE 시그니처마다 fixer에게 지시한다: "실패하는 재현 테스트 먼저 → 최소 수정 → 해당 테스트 실행 → result.json `{status: fixed|escalate, files, test, note}`".
7. **리뷰·커밋**(orch):
   - 변경 범위 검사: 잠근 파일을 건드리지 않았는지, 지정 파일만 바꿨는지.
   - 불변식 체크리스트를 확인하고 전체 게이트를 돌린다.
   - `node tools/bump-version.mjs build` + CHANGELOG(한국어) + 커밋 `fix: …; vX.Y.Z.W`.
8. **장부**: `~/.lecture-e2e/loop/ledger.jsonl`에 지표·시그니처·커밋·소요시간을 남긴다. 그다음 정지 조건을 검사한다. 장부가 있으므로 컨텍스트 압축이나 재시작 뒤에도 이어서 돌 수 있다.

### 막힘이 올라가는 경로 (질문 2)
- **fixer → orch**: 결과가 `escalate`이거나, 같은 시그니처에서 2번 실패하거나, 잠근 파일 수정이 필요하거나, herdr 상태가 `blocked`/timeout일 때.
  - orch가 `agent read`로 화면을 보고, systematic-debugging으로 근본 원인을 직접 잡는다. 그 뒤 더 좁은 지시로 다시 맡기거나 직접 고친다.
- **orch → 사용자**: HUMAN 관문, 예산 소진, 무진전, 운영 위험(전역 한도)일 때. 푸시 알림을 보내고 정지한다. 마지막 정상 커밋과 장부 요약을 남긴다.
- herdr `blocked` 화면 대응: 사전 승인표에 있는 무해한 확인(예: 폴더 신뢰)만 orch가 응답한다. 그 밖은 해당 워커를 멈추고 orch가 직접 처리한다.

---

## 3. 목표값 (질문 3)
원칙:
- (1) 시작 전에 **기준선**(현재 HEAD)부터 측정한다.
- (2) 하드 게이트는 절대값 0이다. 품질 지표는 "기준선보다 나빠지지 않기"에서 시작해 한 단계씩 올린다(래칫).
- (3) LLM 출력은 매번 다르므로 **2회 연속 통과**해야 성공이다.
- (4) **에이전트는 목표·평가 도구를 못 고친다.** 고칠 수 있으면 루프는 기준을 낮춰서 "통과"한다.

| 층 | 지표 | 목표 |
|---|---|---|
| 오프라인 | 단위 테스트 | 기준선의 실패 목록 대비 **새 실패 0** (2026-10-07에 기존 실패 30건이 있었으므로 절대 0이 아니라 차이로 본다) |
| 오프라인 | `package-cws --dry-run` | 통과 |
| 오프라인 | `visual-verify-eval` | **falseApprove = 0**(틀린 그림 승인은 절대 금지), falseHold = 0 |
| e2e | `report.result` | `ok` (fail·blocked 단계 0) |
| e2e | 확장 콘솔 `pageerror`, 진단 `level=error` | 0 |
| e2e | 렌더 경고 `RENDER_FORMULA_FAILED/CHART_INVALID/TEMPLATE_FAILED/REF_UNKNOWN/SPEC_MISMATCH` | 0 |
| e2e | `FIGURE_FUNNEL selected ≥ 1` | 그림이 실제로 다뤄졌는지 확인한다. 0이면 이 실행은 **무효**이고 통과로 치지 않는다. |
| e2e 음성 | YouTube bg | 안내 문구와 실시간 이동 버튼이 뜨고 자동 시작 없음 |
| 품질(래칫) | `renderOk/selected`, 표시 유형 `missing` 수, `FORMULA_CHECKS parseFail·symMismatch` | 기준선 이상(나빠지면 실패) |
| 품질(판단) | orch가 그림 스크린샷을 보고 "명백히 틀린 그림" 수 | 0 |

정지 조건:
- 성공: 위 전부를 2회 연속 통과.
- 예산: 반복 8회 또는 3시간.
- 무진전: 같은 시그니처 3회 연속, 또는 품질 지표 2회 연속 악화 → 마지막 정상 커밋 기준으로 보고.
- HUMAN 관문: 즉시 정지.

시간 감각:
- e2e 1회 ≈ 캡처 창 3분 + 노트 생성 3~5분이다. 반복 1회는 15~25분이라 8회면 3시간에 빠듯하다. 그래서 캡처 창은 **3분**으로 시작하고, 차트·수식이 나오는 구간을 Phase 1에서 고른다.
- 비용 위험: 운영 DB의 **전역 월 한도 $150은 모든 사용자 공용**이다. 실행 16회 정도면 수 달러 수준이지만, 루프 시작 전에 이번 달 사용량을 확인하고 실행 횟수 상한(≤ 20회)을 둔다.

---

## 4. 멈춤 예방 준비물 (질문 4)

### 4-A. 사람이 한 번만 하는 셋업 (약 20분, Phase 0)
1. `node tools/e2e-flow.cjs --login`(Windows 포팅 후) → 웜 Chrome에서:
   - 이 폴더를 Load unpacked → ID가 `gibhon…`인지 확인
   - **테스트 계정으로 Google 로그인**
   - 온보딩 동의: 요약 + 서버 인식 전송 + 백그라운드 2종
   - 보관함 폴더 지정
   - "다운로드 전 저장 위치 묻기" 끄기
   - YouTube 1회 재생(동의 배너·광고 상태 확인)
2. 테스트 계정 플랜을 `developer`로 지정 (사용자가 Supabase SQL: `update profiles set plan='developer' where user_id=…`).
3. 웜 Chrome 창은 **최소화하지 않고 보이게** 둔다. 가려지거나 최소화되면 렌더링이 멈추고, 검은 프레임 3장이면 세션이 실패한다. 실행 플래그 `--disable-backgrounding-occluded-windows --disable-renderer-backgrounding`도 추가한다.
4. 기계 설정:
   - 절전·화면 잠금 끄기, Windows 업데이트 재시작 미루기.
   - **OneDrive 동기화 일시 중지**: 저장소가 OneDrive 안에 있어 파일 잠금(EPERM)이 생긴다.
5. 남은 사용량 확인: Claude(Opus 3시간분), agy/Gemini, OpenRouter 크레딧, 이번 달 전역 사용량.

### 4-B. 실행 중 생기는 권한 멈춤과 해결
| 멈춤 지점 | 확인된 원인 | 대책 |
|---|---|---|
| **폴더 권한 프롬프트** | 수정할 때마다 버전 bump → 확장 재로드 → 폴더 권한 해제. 이후 `start()`가 `ensureFolder()`(`sidepanel.js:278`)에서 네이티브 프롬프트를 띄우고 **사람 클릭을 기다린다** | Phase 1 스파이크: 사용자 제스처 없이 시작(`requestPermission`이 거부되고 `catch`로 넘어가는지 확인. 노트는 IndexedDB에 남고 `no-folder` 저장). 안 되면 개발 전용 설정 `devSkipFolder`(압축 해제 빌드에서만 동작, `devWriteModel`과 같은 방식). 드라이버는 루프 모드에서 `needs-permission`을 blocked가 아닌 warn으로 본다. |
| 확장 ID 불일치 | 드라이버에 macOS ID가 하드코딩됨 | 경로에서 ID를 계산(Chrome과 같은 SHA-256 → a-p 변환) |
| Claude 권한 프롬프트 | 허용 목록에 없는 명령마다 멈춤 | orch를 `--permission-mode bypassPermissions` + 프로젝트 `.claude/settings.local.json` **deny 목록**으로 실행. deny 대상: `git push`, `git checkout/switch main`, `git reset --hard`, `rm -rf`, `supabase *`, 잠근 파일 편집. dry run에서 `git push`가 실제로 막히는지 검증한다. |
| agy 승인 프롬프트 | 워커가 명령마다 승인을 기다림 | `--dangerously-skip-permissions`로 실행. 대신 ① `.git/hooks/pre-push`가 `SUMM_LOOP=1`이면 push를 거부(VS Code 푸시는 영향 없음) ② 워커는 커밋하지 않고, orch가 diff 범위를 검사한다 ③ 디스패치 전에 orch가 커밋해 작업 트리를 깨끗하게 둔다 |
| herdr `blocked` | 대화형 질문이나 로그인 만료 | §2의 사전 승인표대로 처리하고, 그 밖은 워커를 교체한다 |
| YouTube | 프리롤 광고, 재생목록 자동 다음 영상, 동의 배너 | 드라이버가 `.ad-showing` 동안 기다리거나 건너뛴다. URL에서 `list=`를 빼고 `t=`로 시작점을 고정한다. |
| Claude in Chrome (보조) | 사이트 권한 | `youtube.com`, `summrizei.vercel.app`을 미리 허용. 루프 경로에는 넣지 않는다. |
| 잠근 파일 | 평가 기준 조작 위험 | deny + diff 검사 대상: `tools/visual-verify-eval.mjs`, `tools/e2e-flow.cjs`, `tools/debug-loop-verdict.mjs`, 목표 정의, `AGENTS.md`, `.claude/**` |

---

## 5. 구현 단계

**Phase 0 — 준비 (orch 없이 이 세션에서)**
- 설계 문서를 `docs/superpowers/specs/2026-10-11-debug-loop-design.md`에 저장한다(brainstorming 절차).
- `origin/main`을 `b/visual-verify`에 병합한다. 43커밋 뒤처져 있고 main에 더 새 e2e 드라이버가 있다. `manifest.json`·`CHANGELOG.md` 충돌은 AGENTS.md §3대로 번호를 다시 매긴다. 로컬 커밋.
- §4-A 셋업 체크리스트를 사용자에게 넘긴다.

**Phase 1 — 드라이버 (`tools/e2e-flow.cjs`, 병합 후 main 버전 기준)**
- Windows 포팅:
  - 플랫폼별 기본 `CHROME_PATH`
  - `pgrep`은 win32에서 건너뜀
  - 키체인 호출은 LMS 로그인 페이지에서만 하고, win32에서는 blocked 처리
  - 확장 ID를 경로에서 계산
- YouTube 재생 처리: 재생 버튼, 광고 대기, `t=` 시작점.
- `--inspect` 단계 추가:
  - 웜 Chrome의 `admin.html`에서 `PackageStore`/`NoteLibrary.load`/`cropUrls`로 최신 노트를 읽는다.
  - `sandbox.html`에 `RENDER_NOTE`를 보내 렌더하고(`tools/note-render-smoke.cjs` 프로토콜 재사용) 다음을 모은다:
    - `RENDER_WARNINGS`
    - `figure.note-fig` 표시 유형별 개수
    - `.note-f-check/.note-f-missing/code.note-f-src` 개수
    - 그림별 스크린샷(`figs/<id>.png`, 저장소 밖)
  - 진단 JSON의 `FIGURE_FUNNEL`·`FORMULA_CHECKS`를 `report.json`에 숫자로만 넣는다(내용 없음 원칙 유지).
- 폴더 프롬프트 스파이크(§4-B 첫 행).

**Phase 2 — 판정기 + 루프 절차**
- `tools/debug-loop-verdict.mjs`: 오프라인 산출물 + `report.json` + 기준선을 받아 `{pass, invalid, failures:[{signature, class, evidence}], metrics}`를 출력한다. 검사용 `tools/debug-loop-verdict.test.mjs` 1개를 함께 둔다(CI 게이트 `tools/*.test.mjs`에 자동 포함).
- `.claude/commands/debug-loop.md`: §2 반복 흐름, 분류 규칙, 워커 지시 템플릿, 리뷰 체크리스트(불변식·버전 규칙), §3 목표·정지 조건, 장부 형식.
  - herdr 창 생성과 agy 시작(`herdr pane split` / `agent start --kind agy -- --agent gemini-flash --dangerously-skip-permissions`)은 이 절차 안에서 orch가 직접 한다. 별도 런처 스크립트는 만들지 않는다.
  - `.claude/skills`는 Windows에서 파일로 체크아웃돼 있어 commands를 쓴다.

**Phase 3 — 안전장치**
- `.claude/settings.local.json`의 deny 목록.
- `.git/hooks/pre-push`의 `SUMM_LOOP` 가드(버전 관리 밖).

**Phase 4 — dry run → 본 실행**
- 반복 3회 예산으로 dry run: 가드 검증, 기준선 기록, 멈춘 지점이 있으면 수집해서 보완.
- 그다음 본 실행: 8회 / 3시간.

### 수정·생성 파일
- 수정: `tools/e2e-flow.cjs`. 스파이크가 실패할 때만 `sidepanel.js`·`offscreen.js`(+ `lib/settings.js`의 dev 키).
- 생성: `tools/debug-loop-verdict.mjs`(+ `.test.mjs`), `.claude/commands/debug-loop.md`, `.claude/settings.local.json`, `.git/hooks/pre-push`, 설계 문서.
- 재사용:
  - `tools/figure-trace.mjs`(진단 → 그림별 탈락 단계)
  - `tools/visual-verify-eval.mjs`
  - `tools/note-render-smoke.cjs`(렌더 프로토콜)
  - `admin.html`의 `NoteLibrary`
  - `lib/stages.js:1202 FIGURE_FUNNEL`, `lib/stages.js:419 FORMULA_CHECKS`
  - `lib/pipeline.js` 오류 코드표
- 하지 않는 것:
  - 로컬 서버 모드(service-role 키를 에이전트 환경에 두게 됨) → 서버 쪽 버그가 주된 원인이 되면 추가한다.
  - worktree 병렬 수정 → 처리량이 병목이 되면 추가한다.
  - YouTube 백그라운드 활성화 → 하지 않는다.

## 검증
1. `node --test lib/*.test.js server/*.test.js tools/*.test.mjs` + `node tools/package-cws.mjs --dry-run --skip-tests`. 판정기 테스트 포함.
2. 드라이버 단독 실행: `node tools/e2e-flow.cjs --url <YT>&t=<s> --flow live --duration 180 --inspect`
   - 확인할 것: `report.result=ok`, `figures` 요약, 그림 스크린샷 생성.
   - 같은 URL로 `--flow bg`를 돌려 `SRC_UNSUPPORTED_HOST` 안내가 뜨는지 확인.
3. 재로드 후 실행해 폴더 프롬프트 없이 시작되는지 확인한다(스파이크 결과).
4. 가드 확인: orch 세션에서 `git push --dry-run`이 deny되고, 워커 창에서 pre-push 훅이 거부하는지.
5. dry run 3회 동안 사람 개입 없이 끝까지 가는지, 장부가 쌓이는지, 정지 조건이 동작하는지.

---

## 인계 — Phase 1부터 herdr의 Sonnet 세션이 진행 (2026-10-11)

상태:
- Phase 0의 `origin/main` 병합은 **아직 안 됨**. 이 세션에서 자동 권한 검사가 막았다. 사용자가 직접 하거나 Sonnet 세션에서 먼저 한다.
- 병합 시 충돌은 3개다:
  - `lib/vision-client.js`: **main 쪽을 택한다**. main은 `ink`를 계약의 정식 칸(`orNull(boolean)`)으로 받고, 없으면 null로 채운다. 이 브랜치의 2.6.1.4(ink 떼어 내기)는 대체됐다.
  - `lib/vision-client.test.js`: 이 브랜치가 추가한 테스트 `'블록의 ink 표시는 떼어 내고 나머지는 그대로 통과한다'`를 삭제한다. main 동작과 모순된다.
  - `manifest.json`과 `CHANGELOG.md`: main 항목을 유지한다. 2.6.1.4 항목은 삭제한다(대체됨). 2.6.1.2는 2.8.0.9로, 2.6.1.3은 2.8.0.10으로 번호를 바꾸고, manifest는 `2.8.0.10`으로 한다(main은 2.8.0.8).
- 병합 뒤 게이트: `node --test lib/*.test.js server/*.test.js tools/*.test.mjs`. 실패 목록을 **기준선으로 저장**한다(§3).

Sonnet 세션 규칙:
- AGENTS.md, memory.md, 이 문서를 읽는다.
- 각 Phase가 끝날 때마다 사용자에게 보고하고 승인을 받은 뒤 다음으로 넘어간다: 무엇을 바꿨는지, 검증 결과, 다음 단계, 막힌 점.
- 로컬 커밋까지만 한다. push·배포·DB 변경은 하지 않는다.

---

## 실행 방법 — 잠금은 루프 전용 설정으로 (2026-10-11 결정)

- `.claude/settings.local.json`(항상 적용)에는 되돌리기 어려운 명령 차단만 둔다: `git push`, `main` 전환, `reset --hard`, `rm -rf`, `supabase`(Bash·PowerShell 양쪽).
- §4-B의 **잠근 파일 `Edit`/`Write` deny는 `.claude/loop-settings.json`에만** 둔다. 루프 본 실행 때만 얹는다:
  `SUMM_LOOP=1 claude --settings .claude/loop-settings.json` (herdr 창 안, `HERDR_ENV=1`). 사람이 일반 세션에서 도구를 고칠 때는 잠기지 않는다.
- `.git/hooks/pre-push`는 `SUMM_LOOP=1`이면 push를 거부한다(버전 관리 밖). orch·워커 창 모두 `SUMM_LOOP=1`로 띄운다.
- **Edit/Write deny는 Bash 쓰기(`node -e`, `sed`)를 막지 못한다**(Phase 3 검증 중 확인: 이 세션이 Bash로 잠긴 도구 파일을 고칠 수 있었다). 그래서 반복마다 orch가 `git diff --name-only HEAD`를 잠금 목록과 대조하고, 걸리면 되돌린 뒤 정지·보고한다. deny는 실수를 막는 안전벨트이고, 실제 방어선은 이 diff 검사다.
- 그림이 나오는 기준 구간과 `--stop-timeout`(기본 240초)은 Phase 4 dry run 전에 정한다.
