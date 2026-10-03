# v2 남은 작업과 테스트 준비

확인 기준: `w/dev`, 2026-10-03. 코드가 바뀌면 다시 대조한다.

- 확정된 결정은 여기 두지 않는다. 노트는 `docs/note-contract.md` §18, 정책·출시는 `docs/policy-drafts-v2.md` §0, 설계는 `docs/architecture-v2.md` §3(D16~D18)과 §22에 있다.
- 구현 범위는 `README.md` "구현 현황"이 기준이다.

## 1. 확장만 불러와 테스트하기 (node 서버 없음)

운영 서비스는 Supabase Edge Function `api`다(`supabase/functions/api`, `server/index.js`를 묶어 그대로 돌린다). 확장의 기본 서비스 주소가 이 함수라서 로컬 서버를 띄우지 않는다.

**한 번만 하는 준비(운영자), 이 순서로:**

1. 비밀값을 넣는다. 표는 `server/README.md` "Supabase Edge Function 배포"에 있다. OpenRouter 키 하나로 요약·비전·판정·STT가 모두 된다.
2. 함수를 배포한다.
   ```bash
   supabase functions deploy api --use-api
   supabase functions deploy delete-account --use-api
   ```
3. 원격 DB에 `supabase/schema-v2.sql`을 다시 적용한다(등급·사용량 일원화, `plan_catalog()`, 결제 구독 검사). 옛 탈퇴 RPC를 지우므로 2번 뒤에 한다.
   ```bash
   supabase db query --linked -f supabase/schema-v2.sql
   ```
   Free의 월 분 한도는 시드가 기존 행을 덮지 않으므로 한 번 맞춘다: `supabase db query --linked "update plans set monthly_minutes_cap = 100 where plan = 'free'"`

**테스트:**

1. `chrome://extensions` → 개발자 모드 → "압축해제된 확장 프로그램을 로드합니다" → 저장소 폴더를 고른다. ID가 `gllijdanodakjamndimlpgmhokaakpod`인지 본다(다르면 `EXTENSION_ORIGIN` 비밀값과 Supabase 리디렉트 URL을 그 ID로 바꾼다).
2. 설정에서 Google로 로그인한다. 사이드 패널 계정 메뉴에 "Free · 이번 달 0/100분"이 보이면 연결된 것이다.
3. 유료 경로: 테스트 계정에 등급을 준다.
   ```bash
   supabase db query --linked "insert into entitlements (user_id, plan, starts_at, source) select id, 'essential', now(), 'manual' from auth.users where email = '<이메일>'"
   ```
4. 설정에서 이용 동의 2항목, 클라우드 인식(화면·음성 전송), 외부 요약 처리에 동의한다(동의 문구 버전 2026-10-03).
5. 사이드 패널을 다시 열면 "백그라운드로 처리" 카드가 보인다. HLS 강의 탭에서 실행한다. 결과는 기기에 암호화해 저장되고, 노트 보기 화면은 아직 없다(§3의 1).
6. 실시간 캡처(Free)는 기존 v1 화면 그대로이고, 요약은 같은 서비스의 `/v1/summary`를 쓴다.

로컬 서버로 시험할 때만 설정의 "서비스 URL (개발용)"을 `http://127.0.0.1:8788`로 바꾼다. 비우면 기본값으로 돌아간다.

## 2. 이번에 끝낸 것 (2026-10-03)

- 등급·가격·사용량 표 일원화: `plans`(free·essential 24,000원/학생 14,000원·professional 28,900원), 구독 상태는 `entitlements`, 사용량은 `monthly_usage`. 옛 `subscriptions`·`usage_monthly`·`paid` 등급 삭제.
- 랜딩 탈퇴가 보관함 암호문을 남기던 문제: Edge Function `delete-account`(행 → Storage → 계정). 결제 구독이 남아 있으면 아무것도 지우지 않고 거절.
- 운영 서비스를 Supabase Edge Function으로 이전, 확장 기본 주소로 고정.
- STT를 OpenRouter `microsoft/mai-transcribe-2`로 전환(WAV 전송, phraseList, `usage.cost` 정산). Groq 키 불필요.
- P0: 클라우드 인식 동의 문구(화면+음성), 동의 버전 올림. 등급·이번 달 사용량을 계정 메뉴에 표시. 426 안내 문구.
- P1: 요약 동의 없이는 백그라운드를 시작하지 않음(인식 결과 보기 화면이 없어서). 완료 고지를 한국어와 시각 구간으로 표시. 일시정지 사유별 버튼. DRM(EME 계열)은 실시간 모드를 권하지 않음(`SRC_DRM`).
- 판정 기능 스위치: 서버가 `judge`를 끄면 유료 작업이 판정 없이 진행(`NOTE_JUDGE_SKIPPED`).

## 3. 아직 구현하지 않은 것

**노트(Phase 6·7, `docs/note-contract.md` §17)**
1. 6-2 슬롯 교체부터 6-8 생성 옵션까지, 7-1 템플릿부터 7-5 렌더 QA까지 전부 남았다. 끝나야 v2 노트 보기·PDF가 나온다.
2. 노트 생성 옵션 UI: 가상 사례·강의 밖 보강(유료 전용, 기본 꺼짐)과 시험 모드 버튼(6-8·7-3).
3. 인쇄 v2(`sandbox.html`), Markdown 내보내기(`noteText` 대체), `product-panel.css`를 패널과 노트 렌더로 나누기.

**파이프라인·확장**
4. 실시간(Free) 캡처는 아직 v1 요약 경로(`lib/summary.js` → `/v1/summary`)다. v2 단계(`lib/stages.js`)로 옮기지 않았다.
5. Free의 월 분 한도는 집계되지 않는다. 분은 클라우드 STT에서만 세므로, 로컬 인식만 쓰는 Free는 항상 0분이다. 요청 수·비용 한도만 걸린다.
6. v1 경로 제거: OpenRouter 키 입력란, `openrouter.ai` 호스트 권한, `lib/summary.js`, `lib/openrouter-client.js`.
7. 보관함 목록·재생성 화면(설계 §12).
8. 개발용 어드민의 작업 탭과 산출물 검사 탭(설계 §13).
9. 진단 파일 내보내기가 꺼져 있다. `lib/diagnostics.js` `OPERATOR_KEYS`가 비어 있다(§4의 7).
10. 인식 결과만 볼 화면이 없다. 지금은 요약 동의를 시작 조건으로 막아 두었다.

**서버·계정**
11. 결제 연동: grogle 웹훅 → `entitlements`(`source='payment'`, `edu`, `cancel_at_period_end`). `landing/billing-config.js`의 결제창·포털 주소가 비어 있다.
12. 학생가 자격은 계정 페이지가 이메일 도메인(`.ac.kr`·`.edu`)으로만 표시한다. 실제 인증 절차가 없다.
13. Edge Function에서는 서버 메모리의 캐시·동시성 제한·분당 버킷이 워커마다 따로다. 한도·중복 요청은 Postgres가 판정해 정확성에는 문제가 없지만, 공급자 동시 호출 상한은 전역으로 걸리지 않는다.
14. 실서비스 검증: 배포한 함수와 실제 강의로 백그라운드 작업을 끝까지 한 번 돌린다. 특히 확인할 것은 MAI-Transcribe 2의 한국어 품질, WAV 업로드 크기(5분 약 9.6 MB), Edge 150초 제한 안에 응답이 오는지다.

**정책·문서**
15. 개인정보처리방침·약관·환불·저작권 방침과 스토어 문구를 v2 동작에 맞춘다(`docs/policy-drafts-v2.md` §1~§5). 확장 동의창은 고쳤지만 게시 방침은 그대로다(§4의 4).

## 4. 결정이 필요한 것 (사용자)

1. **원격 반영 실행**: §1의 비밀값·함수 배포·DB 적용. 자동 실행은 운영 배포라 막혀 있어 직접 실행하거나 허용해야 한다.
2. **등급별 한도 수치**: 지금은 임시값이다. free 월 100분·$0.3·300요청, essential 1,800분·$8·5,000요청, professional 3,600분·$14·10,000요청(`plans`, `placeholder = true`). 강의 1시간 원가는 약 270~305원(설계 §18)이다.
3. **Pro와 Essential의 차이**: 지금은 기능이 같고 한도만 다르다. 랜딩은 Pro를 "상세 노트"로 소개한다. 노트 깊이를 등급별로 나눌지 정해야 한다.
4. **개인정보처리방침 개정 시점**: 방침은 이용자에게 불리한 변경을 7일 전에 알리게 돼 있다. 음성 전송(유료 백그라운드)을 넣는 개정을 언제 게시할지, 시행일을 언제로 할지.
5. **정책 문서의 열린 항목**(`docs/policy-drafts-v2.md` §0): Supabase 리전(지금 시드니), 서버 호스팅(이제 Supabase Edge, 리전 확인 필요), 국외 이전 고지 방식, Jev 채택, 운영자 표기, 온디바이스 요약(Gemini Nano) 존속, 법률 검토 일정.
6. **확장 ID 고정**: 저장소 폴더를 옮기면 ID가 바뀌어 로그인 리디렉트와 `EXTENSION_ORIGIN`이 어긋난다. `manifest.json`에 개발용 `key`를 넣을지.
7. **운영자 진단 키 보관**: 키쌍을 만들고 개인키를 어디에 둘지(`node tools/decrypt-diagnostic.mjs --generate-keypair <저장소 밖 폴더>`).
8. **모델·공급자 고정**: 요약·계획·작성·비전·판정 모델과 ZDR 공급자 태그(`OPENROUTER_PROVIDERS_JSON`).
9. **PR #14 병합 시점**: 병합하면 랜딩 가격(24,000원·14,000원)과 탈퇴 방식이 바로 바뀐다. 함수 배포와 DB 적용 뒤에 병합한다.
10. **`AGENTS.md`의 미커밋 변경**(aside 사용, 저렴한 모델 서브에이전트 지시): 커밋할지.

## 5. 테스트 도구

- 단위·계약: `node --test lib/*.test.js server/*.test.js tools/*.test.mjs`. DB 스키마 테스트는 Postgres가 있으면 돈다(`PG_BIN_DIR`, 이 맥은 `/opt/homebrew/opt/postgresql@17/bin`, `LC_ALL=en_US.UTF-8` 필요).
- 패키저 감사: `node tools/package-cws.mjs --dry-run`.
- Edge 묶음: 서버 코드를 고치면 `node tools/build-edge.mjs`. `tools/edge-api.test.mjs`가 어긋남을 잡는다. Deno로 직접 띄워 볼 수도 있다(`deno run --allow-env --allow-read --allow-write --allow-net --allow-sys supabase/functions/api/index.js`, 비밀값은 환경변수).
- 브라우저 스모크(`tools/*-smoke.cjs`): Playwright를 저장소 밖에 설치하고 `PLAYWRIGHT_MODULE`·`CHROME_PATH`를 지정한다. 번들 Chromium은 H.264·AAC를 못 풀어 실제 Chrome이 필요하다.
- 합성 HLS: `node tools/make-hls-fixture.mjs <저장소 밖 폴더>`(ffmpeg 필요). 실제 골든셋은 `docs/bench-v2.md` §1.
