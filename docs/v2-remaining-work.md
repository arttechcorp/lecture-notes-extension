# v2 남은 작업과 테스트 준비

확인 기준: `w/dev`, 2026-10-03 두 번째 묶음까지(HEAD `fcc2f79`). 코드가 바뀌면 다시 대조한다.

- 확정된 결정은 여기 두지 않는다. 노트는 `docs/note-contract.md` §18, 정책·출시는 `docs/policy-drafts-v2.md` §0, 설계는 `docs/architecture-v2.md` §3(D16~D18)과 §22에 있다.
- 구현 범위는 `README.md` "구현 현황"이 기준이다.

## 1. 확장만 불러와 테스트하기 (node 서버 없음)

운영 서비스는 Supabase Edge Function `api`다(`supabase/functions/api`, `server/index.js`를 묶어 그대로 돌린다). 확장의 기본 서비스 주소가 이 함수라서 로컬 서버를 띄우지 않는다.

**한 번만 하는 준비(운영자), 이 순서로:**

1. 비밀값을 넣는다. 표는 `server/README.md` "Supabase Edge Function 배포"(api)와 "Groble 결제 웹훅"(billing-webhook)에 있다. OpenRouter 키 하나로 계획·작성·비전·판정·STT가 모두 된다.
2. 함수를 배포한다(`api`는 묶음을 먼저 다시 만든다).
   ```bash
   node tools/build-edge.mjs
   supabase functions deploy api --use-api
   supabase functions deploy delete-account --use-api
   supabase functions deploy billing-webhook --use-api
   ```
3. 원격 DB에 `supabase/schema-v2.sql`을 다시 적용한다(등급·사용량 일원화, `plan_catalog()`, 결제 구독 검사, `provider_slots`, `billing_events`). 옛 탈퇴 RPC를 지우므로 2번 뒤에 한다.
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
5. 사이드 패널을 다시 열면 "백그라운드로 처리" 카드가 보인다. HLS 강의 탭에서 실행한다. 결과는 기기에 암호화해 저장되고 패널의 "보관함"(`library.html` 목록)과 "노트 열기"(`note.html`)로 본다. 외부 요약 동의 없이 돌리면 인식만 끝나 `note.html`이 인식 결과를 보여 주고, 동의 후 같은 화면의 "노트 만들기"로 노트를 만든다.
6. 실시간 캡처도 완료되면 같은 v2 단계(`/v1/plan`·`/v1/write`)로 노트를 만들어 보관함에 넣고 노트 화면이 연다. 예전 `/v1/summary` 경로는 없다.

로컬 서버로 시험할 때만 설정의 "서비스 URL (개발용)"을 `http://127.0.0.1:8788`로 바꾼다. 비우면 기본값으로 돌아간다.

## 2. 이번에 끝낸 것

### 첫 묶음 (2026-10-03)

- 등급·가격·사용량 표 일원화: `plans`(free·essential 24,000원/학생 14,000원·professional 28,900원), 구독 상태는 `entitlements`, 사용량은 `monthly_usage`. 옛 `subscriptions`·`usage_monthly`·`paid` 등급 삭제.
- 랜딩 탈퇴가 보관함 암호문을 남기던 문제: Edge Function `delete-account`(행 → Storage → 계정). 결제 구독이 남아 있으면 아무것도 지우지 않고 거절.
- 운영 서비스를 Supabase Edge Function으로 이전, 확장 기본 주소로 고정.
- STT를 OpenRouter `microsoft/mai-transcribe-2`로 전환(WAV 전송, phraseList, `usage.cost` 정산). Groq 키 불필요.
- P0: 클라우드 인식 동의 문구(화면+음성), 동의 버전 올림. 등급·이번 달 사용량을 계정 메뉴에 표시. 426 안내 문구.
- P1: 요약 동의 없이는 백그라운드를 시작하지 않음(인식 결과 보기 화면이 없어서). 완료 고지를 한국어와 시각 구간으로 표시. 일시정지 사유별 버튼. DRM(EME 계열)은 실시간 모드를 권하지 않음(`SRC_DRM`).
- 판정 기능 스위치: 서버가 `judge`를 끄면 유료 작업이 판정 없이 진행(`NOTE_JUDGE_SKIPPED`).

### 두 번째 묶음 (같은 날, `fcc2f79`)

- **노트 계약 `lecture-note-2`**(`fc991ad`, `fc991ad`): 요청별 생성 옵션 `options:{syntheticExamples, externalAugmentation}`(기본 꺼짐·유료 전용). 서버는 계정 기능 `augment`로 막고(`feature_not_in_account_plan`), 켠 항목의 basis(`synthetic`·`external`)만 출력 스키마와 코드 검사가 허용한다(`lib/note-contract.js` §6).
- **파이프라인 단계 재작성**(`b88343f`, `b88343f`, `b88343f`): `lib/stages.js`가 계획 정규화 → 섹션별 근거 전송 → blockId repair 1회 → 주장 단위 T5 지지(낮으면 블록 보류 + `NOTE_CLAIMS_UNSUPPORTED`) → 전역 입력 요약(6-4) → 조립까지 돌린다. 도표 레지스트리·크롭은 `lib/figures.js`와 캡처 쪽 크롭 저장이 맡는다(`6ee674f`, `d6c60ed`, `7caadd5` — `~` 구분자가 저장소 id 규칙에 안 맞아 크롭 블롭 쓰기·읽기가 둘 다 실패하던 것을 고침).
- **Free 월 분 한도를 `/v1/plan`에서 센다**: 로컬 인식만 쓰는 계정은 STT에 안 걸려 한도가 항상 0분이던 구멍을 메웠다(유닛 시각 범위를 올림한 분).
- **노트 렌더**(`e6a9382`, `98039a2`, `d4fbee1`): `lib/note-spec.js`(`render-4` 템플릿·문서 순서·css)와 `lib/note-render.js`(결정적 HTML + 경고 집계), `lib/note-export.js`(Markdown, `f7a236e`), `lib/library.js` 암호화 보관함(`a23047d`). 노트는 항상 밝은 종이 토큰으로 그리고 인쇄는 A4만 낸다.
- **보관함·노트 화면**(`0e7823b`, `56a913c`, `fcc2f79`): `library.html` 목록과 `note.html` 뷰어가 기기 암호화 저장소를 직접 읽는다. Markdown 내보내기, PDF(`PRINT_NOTE` → 인쇄 매체 렌더 → 인쇄), 시험 모드·답안 위치·필기 공간 옵션, 유료 노트의 생성 옵션 "다시 만들기", 인식만 끝난 패키지의 "노트 만들기"(요약 동의 필요 안내 포함).
- **사이드 패널 v2**(`69bd788`): 노트·인식 결과 렌더를 `sandbox.html`에 위임(`RENDER_NOTE`·`PRINT_NOTE`·`RENDER_RECOGNITION`). `product-panel.css`는 나누지 않았다 — 샌드박스가 안 읽고 `NoteSpec.css`를 쓴다. 인식 결과는 화면에만 보이고 Markdown·PDF로 내보내지 않는다. 외부 요약 동의 없는 백그라운드는 막지 않고 인식만 돌려 `recognition-only`로 저장한다(`CONSENT_SUMMARY_REQUIRED` 고지).
- **v1 BYOK 경로 제거**(`27f7382`, `03acc4b`): OpenRouter 키 입력란, `openrouter.ai` 호스트 권한, `lib/summary.js`, `lib/openrouter-client.js`, 서버 `/v1/summary` 라우트. 남은 경로는 `/v1/plan`·`/v1/write`뿐이다.
- **전역 공급자 동시성**(`a94d0b2`): `provider_slots` 표 + `acquire_provider_slot`/`release_provider_slot` RPC로 Edge 워커 수와 무관하게 모델별 공급자 상한을 공유한다. 워커가 죽어도 슬롯은 TTL(요청 타임아웃+30초)로 회수된다.
- **Groble 결제 웹훅**(`5fd753e`, `d6c60ed`): `billing-webhook` 함수가 HMAC 서명을 확인하고 `apply_billing_event`가 `billing_events` 멱등 원장을 거쳐 `entitlements`에 반영한다. 학생가 자격은 `edu_eligible` RPC(확인된 로그인 메일이 `.ac.kr`·`.edu`).
- **어드민 작업·산출물 탭**(`ef248f3`), **정책 문서 v2 반영**(`a998b87`, 랜딩 게시 페이지 시행 2026.10.11·공고 10.03).
- **브라우저 렌더 스모크**(`84f36d3`, `4cf96d7`): `tools/note-render-smoke.cjs`가 패키지 클로저를 `http://localhost`에 서빙하고 CDP로 fixture 노트 렌더·1280/400px·A4 PDF를 확인한다.

## 3. 아직 구현하지 않은 것

1. **운영자 진단 키**: `lib/diagnostics.js`의 `OPERATOR_KEYS`가 비어 있어 진단 파일 내보내기는 꺼져 있다. `node tools/decrypt-diagnostic.mjs --generate-keypair <저장소 밖 폴더>`로 키쌍을 만들고 공개키를 넣는다 — 개인키 보관 위치는 §4의 사용자 결정.
2. **고객 포털 주소**: `landing/billing-config.js`의 결제창 3개(Essential `u9m5dR`·Edu `a5DgpJ`·Pro `grxETv`)는 채웠다. `portal`은 아직 비어 있다 — Groble이 구매자용 해지·영수증 주소를 주는지 확인해 넣는다.
3. **학생가는 자격 확인 없이 판매**(2026-10-03 결정): 계정 화면은 Essential 카드에 일반·학생가 결제 버튼을 둘 다 보여 주고, 랜딩 문구의 "학생 인증 시"를 "학생 요금제"로 바꿨다. `edu_eligible` RPC는 DB에 남아 있으나 쓰지 않는다.
4. **실서비스 종단 검증**: 배포한 함수와 실제 강의로 백그라운드 작업을 끝까지 한 번 돌린다. 확인할 것 — MAI-Transcribe 2의 한국어 품질, WAV 업로드 크기(5분 약 9.6 MB), Edge 150초 제한 안에 응답이 오는지.
5. **`chrome-extension://` 경계의 브라우저 스모크**: 이 맥의 Chrome stable은 `--load-extension`을 무시해 언팩 확장을 못 올린다. `tools/note-render-smoke.cjs`는 패키지 클로저를 `http://localhost`로만 확인한다 — 확장 원점(매니페스트 샌드박스 CSP, `chrome.runtime` 메시지 경계)은 Chrome for Testing 같은 다른 브라우저가 필요하다.
6. **원격 반영(사용자 실행)**: `schema-v2.sql` 재적용(`provider_slots`·`billing_events` 추가분 포함) → `node tools/build-edge.mjs` → `supabase functions deploy api --use-api`. `billing-webhook` 배포·`GROBLE_*` 비밀값·Groble 웹훅 등록은 2026-10-03 끝났다(테스트 발송 200 `unknown_plan`). 실결제로 등급이 바뀌는지는 아직 확인하지 않았다.

## 4. 결정이 필요한 것 (사용자)

1. **원격 반영 실행**: §1의 비밀값·함수 배포·DB 적용(§3의 6). 자동 실행은 운영 배포라 막혀 있어 직접 실행하거나 허용해야 한다.
2. **등급별 한도 수치**: 지금은 임시값이다. free 월 100분·$0.3·300요청, essential 1,800분·$8·5,000요청, professional 3,600분·$14·10,000요청(`plans`, `placeholder = true`). 강의 1시간 원가는 약 270~305원(설계 §18)이다.
3. **Pro와 Essential의 차이**: 지금은 기능이 같고 한도만 다르다. 랜딩은 Pro를 "상세 노트"로 소개한다. 노트 깊이를 등급별로 나눌지 정해야 한다.
4. **정책 문서의 열린 항목**(`docs/policy-drafts-v2.md` §0): Supabase 리전(지금 시드니), 서버 호스팅(Supabase Edge, 리전 확인 필요), 국외 이전 고지 방식, Jev 채택, 운영자 표기, 온디바이스 요약(Gemini Nano) 존속, 법률 검토 일정. 시행일은 게시 페이지에 2026.10.11로 정해졌으나 초안 문서에는 "(미정)"으로 남아 있다(대조 필요).
5. **확장 ID 고정**: 저장소 폴더를 옮기면 ID가 바뀌어 로그인 리디렉트와 `EXTENSION_ORIGIN`이 어긋난다. `manifest.json`에 개발용 `key`를 넣을지.
6. **운영자 진단 키 보관**: 개인키를 어디에 둘지(`node tools/decrypt-diagnostic.mjs --generate-keypair <저장소 밖 폴더>`).
7. **모델·공급자 고정**: 계획·작성·비전·판정 모델과 ZDR 공급자 태그(`OPENROUTER_PROVIDERS_JSON`).
8. **PR #14 병합 시점**: 병합하면 랜딩 가격(24,000원·14,000원)과 탈퇴 방식이 바로 바뀐다. 함수 배포와 DB 적용 뒤에 병합한다.
9. **`AGENTS.md`의 미커밋 변경**(Devin·aside 사용, 저렴한 모델 서브에이전트 지시): 메인 체크아웃에 아직 미커밋으로 있다. 커밋할지.
10. ~~학생가 인증 수준~~: 2026-10-03 인증 없이 판매로 결정(§3의 3).

## 5. 오늘 코드가 반영한 결정 (사용자가 뒤집을 수 있는 것)

이번 묶음에서 새로 굳은 동작이다. 전부 코드와 테스트로 고정됐다 — 바꾸려면 §18과 함께 고친다.

1. **가상 사례·강의 밖 보강의 허용 위치**(`lib/note-contract.js` `augOk`): 가상 사례는 B08 전체·B05 `examples`·B14 `premise`, 강의 밖 보강은 B05 `explanation`·`mechanism`·`examples`·B12 `note`. 전역 블록·정의·비교·답안·공지·계산에는 둘 다 금지다. 꺼진 옵션의 basis는 출력 스키마에서 빠진다(`restrictBasis`) — 모델이 만들 수 없다.
2. **T5 지지가 낮은 주장이 있는 블록은 보류(`null`)로 바꾸고 `NOTE_CLAIMS_UNSUPPORTED`로 고지**한다. T5는 `basis:"lecture"` 주장만 본다 — 가상·보강·교육용은 대상이 아니다.
3. **숫자가 든 표·모든 그래프는 크롭 표시**: 백그라운드는 도표 숫자 대조용 로컬 OCR을 돌리지 않는다(`figureData.ocr`이 항상 비어 `isSimpleChart`가 참이 될 수 없고, `isSimpleTable`은 숫자 없는 표만 통과).
4. **노트는 항상 밝은 종이 토큰으로 렌더**한다(`NoteSpec.css`의 `--canvas` 등 고정). 다크 테마 노트는 없다. PDF는 A4·14.3mm 여백만 낸다.
5. **`product-panel.css`는 분리하지 않는다**: 샌드박스가 그 파일을 아예 읽지 않게 하고 노트 스타일은 `NoteSpec.css`로 둔다(랜딩 데모 화면은 그대로).
6. **인식 결과 텍스트는 화면에만 보인다**: `RENDER_RECOGNITION`은 textContent로만 넣고 Markdown·PDF 내보내기(`note-export`)는 인식 결과를 다루지 않는다.
7. **요약 동의 없는 백그라운드는 허용하되 인식만 돌린다**: `runNote`가 서비스 호출 없이 `recognition-only`를 돌려주고 `CONSENT_SUMMARY_REQUIRED`를 고지한다. 재생성 화면의 "노트 만들기"로 이어진다.
8. **노트 없는 결과로 기존 노트를 덮어쓰지 않는다**: 재생성은 앞에서 거절하고, 백그라운드·실시간 경로는 `saveLibrary`가 막는다(`LIBRARY_NOTE_KEPT`).

## 6. 테스트 도구

- 단위·계약: `node --test lib/*.test.js server/*.test.js tools/*.test.mjs`. DB 스키마 테스트는 Postgres가 있으면 돈다(`PG_BIN_DIR`, 이 맥은 `/opt/homebrew/opt/postgresql@17/bin`, `LC_ALL=en_US.UTF-8` 필요).
- 패키저 감사: `node tools/package-cws.mjs --dry-run`.
- Edge 묶음: 서버 코드를 고치면 `node tools/build-edge.mjs`. `tools/edge-api.test.mjs`가 어긋남을 잡는다. Deno로 직접 띄워 볼 수도 있다(`deno run --allow-env --allow-read --allow-write --allow-net --allow-sys supabase/functions/api/index.js`, 비밀값은 환경변수).
- 노트 렌더 스모크: `node tools/note-render-smoke.cjs`(Playwright 불필요 — 패키지 클로저를 localhost에 서빙하고 Chrome을 CDP로 직접 움직인다. 산출물은 `/tmp/v2orch/smoke/`). 한 번은 Chrome 부트 타이밍에 기다림이 끊긴 적이 있다 — 재실행으로 확인한다.
- 그 외 브라우저 스모크(`tools/*-smoke.cjs`): Playwright를 저장소 밖에 설치하고 `PLAYWRIGHT_MODULE`·`CHROME_PATH`를 지정한다. 번들 Chromium은 H.264·AAC를 못 풀어 실제 Chrome이 필요하다.
- 합성 HLS: `node tools/make-hls-fixture.mjs <저장소 밖 폴더>`(ffmpeg 필요). 실제 골든셋은 `docs/bench-v2.md` §1.
