# v2 남은 작업과 테스트 준비

확인 기준: `w/dev` `a04e9fc`(2026-10-02). 코드가 바뀌면 다시 대조한다.

- 열린 결정은 여기 두지 않는다. 노트는 `docs/note-contract.md` §18, 정책·출시는 `docs/policy-drafts-v2.md` §0, 설계는 `docs/architecture-v2.md` §22 "남은 결정"에 있다.
- 구현 범위는 `README.md` "구현 현황"이 기준이다. 유료 백그라운드 경로와 계정·사용량 서버까지 동작하지만 실서비스로는 검증 전이다.

## 1. 프론트에 반영할 것

작업 전에 `origin/main`을 합친다. 협업자 커밋 `d2e590a`(캡처 설정 모달)가 `sidepanel.html`·`sidepanel.js`를 바꿨고 아직 `w/dev`에 없다.

### P0: 출시 차단

1. **클라우드 인식 동의 문구가 동작과 다르다.**
   - `options.html`의 화면 인식 동의와 `landing/policies/privacy.html`은 음성이 이 설정과 무관하게 항상 기기 안에서만 처리된다고 적는다.
   - 그런데 같은 동의(`lib/settings.js` `cloudRecognitionAllowed` = `visionConsent`)가 백그라운드 작업의 클라우드 음성 인식을 허가한다(`lib/background-job.js` `gate`). 동의가 없을 때의 안내(`CONSENT_CLOUD_REQUIRED`)는 "화면·음성 전송에 동의"하라고 한다.
   - 할 일: 동의창을 화면·음성 전송 동의로 고치고 `TERMS_VERSION`을 올려 다시 동의를 받는다. 처리방침·스토어 문구는 `docs/policy-drafts-v2.md` §1~§5를 반영한다.
2. **등급과 사용량이 화면에 없다.** `GET /v1/me`가 `plan`과 `quota`(`requests`·`maxRequests`·`minutes`·`maxMinutes`·`spentCents`·`maxCents`)를 주지만 패널과 설정 어디에도 보이지 않는다.
3. **426(업데이트 필요)을 처리하지 않는다.** `lib/service-client.js`는 버전 헤더만 싣는다. 서버가 `minClientVersion`을 올리면 사용자에게는 일반 오류로 보인다.

### P1

4. **"인식 결과만 볼 수 있다"는 안내에 보기 화면이 없다.** 요약 동의 없이 끝난 백그라운드 작업은 `CONSENT_SUMMARY_REQUIRED`로 멈추고 이 문구를 보인다. 하지만 백그라운드 작업의 인식 결과를 여는 화면은 없다. 화면을 만들거나 문구를 고친다.
5. **완료 고지가 코드 문자열로 나온다.** `sidepanel.js` `bgDoneView`가 `NOTE_TARGET_DROPPED×2`처럼 코드를 그대로 나열한다. 한국어 문구와 해당 구간이 필요하다.
6. **일시정지마다 같은 버튼이 나온다.**
   - 모든 일시정지에 "다시 시도"가 붙는다(`bgDoneView`).
   - 한도 초과(`QUOTA_EXCEEDED`)는 다시 시도해도 소용없다.
   - 인증 만료(`SRC_AUTH_EXPIRED`)는 강의 탭을 다시 여는 것이 먼저다.
   - 코드표(`lib/pipeline.js` `CODES`)에 없는 오류는 코드만 보인다.
7. **DRM(EME) 영상에도 실시간 모드를 권한다.** `SRC_PROTECTED`면 항상 "실시간 모드로 시작"이 나온다. 그런데 EME 영상은 실시간 캡처도 `content.js`가 거절하므로 두 번째 실패로 이어진다. EME면 중단 안내만 한다(설계 §6.1의 2).
8. **진단 파일 내보내기가 꺼져 있다.** `lib/diagnostics.js` `OPERATOR_KEYS`가 비어 있다(§3 운영자 진단 키).

### P2

9. 개발용 어드민의 작업 탭과 산출물 검사 탭(설계 §13). 지금은 파이프라인·로그·소스 진단 탭만 있다.

### 노트 계약 연결(6-x·7-x) 뒤

`docs/note-contract.md` §17의 단위와 함께 진행한다.

10. v2 노트 보기. 지금은 완료 화면이 "노트 양식이 정해진 뒤에 제공"이라고만 한다.
11. 인쇄 v2(`sandbox.html`): 답안을 끝에 모으고, 시험 모드를 넣고, 폰트·KaTeX·크롭이 준비된 뒤 인쇄한다(7-3·7-4).
12. Markdown 내보내기(`sidepanel.js` `noteText` 대체, 7-4).
13. `product-panel.css`를 사이드 패널과 `sandbox.html`이 같이 쓴다. 노트 v3 토큰을 넣을 때 패널 모양이 같이 바뀌지 않게 나눈다.
14. v1 경로 제거: OpenRouter 키 입력란, `openrouter.ai` 호스트 권한, `lib/summary.js`, `lib/openrouter-client.js`, `noteText`(설계 §20).
15. 보관함 목록·재생성 화면(설계 §12).

## 2. 백엔드·파이프라인에 남은 것

- **노트 계약 연결**: `docs/note-contract.md` §17의 6-2(슬롯 교체)부터.
- **실시간(Free) 캡처**: 아직 v1 요약 경로다. v2 단계(`lib/stages.js`)와 월 한도로 옮긴다.
- **판정 기능 스위치**:
  - 서버에서 `judge`를 끄면(`FEATURE_FLAGS_JSON`) 유료 작업이 판정 단계에서 멈춘다. `lib/stages.js`가 `features`를 보지 않고 유료면 항상 `/v1/judge`를 부르기 때문이다. 검증 단계의 근거 지지 확인도 같다.
  - 꺼져 있으면 판정 없이 진행해야 한다(설계 §17 기능 플래그).
- **실서비스 검증**: 실제 Supabase 프로젝트와 Groq·OpenRouter 키로 백그라운드 작업을 끝까지 한 번 돌린다.

## 3. 테스트 준비

### 지금 바로 되는 것

- `node --test lib/*.test.js server/*.test.js`
- `node tools/package-cws.mjs --dry-run`

### 설치

| 무엇 | 쓰는 곳 | 비고 |
|---|---|---|
| Node | 전부 | CI는 22 |
| ffmpeg | `tools/make-hls-fixture.mjs` | 합성 HLS 생성 |
| Playwright | `tools/*-smoke.cjs` 10개, `tools/ppocr-bench.cjs` | 저장소 밖에 설치하고 `PLAYWRIGHT_MODULE=<경로>/node_modules/playwright`로 지정한다. 저장소에는 `package.json`을 두지 않는다 |
| 실제 Chrome | 위와 같은 스크립트 | `CHROME_PATH`로 지정한다. Playwright 번들 Chromium은 H.264·AAC를 못 풀어 `media-decode-smoke`·`background-smoke`가 실패한다 |
| PostgreSQL(선택) | `tools/supabase-schema.test.mjs` | 없으면 이 테스트만 건너뛴다 |

### 외부 계정 (사람이 할 일)

- **OpenRouter**: 운영자 키와 모델별 ZDR 엔드포인트 태그(`OPENROUTER_PROVIDERS_JSON`, `server/README.md` "설정").
- **Groq**: 운영자 키. 조직 설정에서 ZDR을 켠다.
- **Supabase**:
  - `server/README.md` "Supabase 계정과 장부"의 설정 순서를 따른다: 스키마 `schema.sql` → `schema-v2.sql`, 비공개 `vault` 버킷, 테스트 계정 `admin_grant_plan`.
  - `README.md` "Supabase 로그인 설정"을 따른다: Google 공급자, Redirect URL.
- **확장 ID 고정**: `manifest.json`에 `key`가 없어 압축 해제한 폴더마다 ID가 다르다. ID가 바뀌면 Supabase Redirect URL과 서버 `EXTENSION_ORIGIN`도 바꿔야 한다. 개발용 `key`를 넣을지 정한다.
- **운영자 진단 키**: `node tools/decrypt-diagnostic.mjs --generate-keypair <저장소 밖 폴더>`로 만들고, 공개키를 `lib/diagnostics.js` `OPERATOR_KEYS`에 넣는다. 개인키는 저장소 밖에 둔다(`.gitignore`가 `*.private.jwk.json`을 막는다).

### 서버

- 실행: `node server/index.js`(`127.0.0.1:8788`). `.env`를 읽지 않으므로 셸에서 넣는다. 변수 표는 `server/README.md` "설정"에 있다.
- 최소 변수:
  - `OPENROUTER_API_KEY`, `OPENROUTER_PROVIDERS_JSON`, `EXTENSION_ORIGIN`
  - 계정 방식 하나. 벤치는 정적 토큰(`APP_TOKENS_JSON`)이면 충분하다. 확장 로그인은 `SUPABASE_URL`·`SUPABASE_SERVICE_ROLE_KEY`·`USAGE_DIGEST_KEY`가 필요하다.
- 유료 경로:
  - `GROQ_API_KEY`, `ALLOWED_STT_MODELS`, `ALLOWED_VISION_MODELS`. 두 목록은 기본값이 비어 있어 넣지 않으면 꺼진다.
  - 판정 모델은 `ALLOWED_JUDGE_MODELS`로 지정한다. 넣지 않으면 `OPENROUTER_PROVIDERS_JSON`에 `openai/gpt-4.1-nano` 태그가 있을 때만 그 모델을 쓴다.
  - 기능 스위치(`FEATURE_FLAGS_JSON`)는 기본이 모두 켬이다.
- 벤치 절차와 변수: `docs/bench-v2.md` §2.

### 확장 권한

- **설치할 때**: `storage`, `sidePanel`, `scripting`, `tabs`, `tabCapture`, `offscreen`, `activeTab`, `identity`, `power`, `declarativeNetRequestWithHostAccess`, `unlimitedStorage`, 모든 사이트 접근.
- **실행 중**: `webRequest`(선택 권한). 백그라운드 시작과 어드민 소스 진단에서 사용자가 누른 뒤 요청한다.
- **네트워크**: Free 로컬 Whisper는 첫 사용 때 HuggingFace에서 모델을 받는다.

### 데이터

- **합성 HLS**: `node tools/make-hls-fixture.mjs <저장소 밖 폴더>`.
- **실제 골든셋**: `docs/bench-v2.md` §1을 따른다. 저장소 밖에 두고, 사람이 교정한 참조 전사를 함께 둔다. 본인이 접근 권한을 가진 강의만 쓴다.
- **사이트 호환성**: LMS 계정으로 어드민 "소스 진단" 탭을 쓴다(`docs/bench-v2.md` B1/B2).
- **벤치 비용**: Phase 0 벤치는 합계 $2 안팎이다(추정, `docs/bench-v2.md`).
