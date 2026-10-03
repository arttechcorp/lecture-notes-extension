# 강의 필기 도우미

강의 영상의 화면·음성을 기기 안에서 인식해 **근거 시각이 연결된 구조화 학습 노트**를 만드는 Chrome Manifest V3 확장 프로그램입니다.

특정 LMS에 묶여 있지 않습니다. 표준 `<video>` 요소만 찾으면 되므로 런어스·무들·유튜브 등 사이트를 가리지 않습니다.

> 개인 학습용 도구입니다. 강의 영상의 캡처·재배포는 학칙이나 저작권 정책에 저촉될 수 있으니 결과물을 외부에 공유하지 마세요. 노트는 OCR 기반 자동 생성물이라 오독이 섞일 수 있습니다.

> 이 README는 지금 동작하는 기능을 적습니다. 전체 설계는 `docs/architecture-v2.md`에, 남은 작업은 `docs/v2-remaining-work.md`에 있습니다.

## 동작 방식

### 지금 동작하는 흐름

1. 일반 강의 탭에서 확장 아이콘을 누릅니다. 툴바 없는 LearnUs 팝업은 그 창을 활성화하고 `Alt+Shift+S`를 누르면 해당 탭을 선택한 별도 캡처 창이 열립니다.
2. 이 명시적 호출로 해당 탭의 임시 캡처 권한을 얻고, `chrome.scripting`으로 메타데이터 스크립트를 주입합니다. 현재 manifest의 사이트 접근 권한과 `tabCapture`의 탭별 캡처 권한은 별개이며, 목록에서 탭을 선택하는 것만으로 캡처 권한이 생기지는 않습니다.
3. **preflight** — 프레임 1장을 시험 캡처해 CORS 차단·DRM 여부를 먼저 판정하고, 안 되면 이유를 명시하고 중단합니다.
4. offscreen document가 캡처 수명과 제한된 메모리 큐를 소유하고, 필요한 화면만 로컬 PP-OCRv5 한국어 mobile/WASM과 선택적 로컬 Whisper로 인식합니다. 단계별 진단 이벤트는 강의 내용이 아닌 코드·수치만 담아 기기 안에서 AES-256-GCM으로 암호화해 둡니다(14일 또는 20MB).
5. 근거를 `included / filtered / uncertain`으로 비파괴 선별합니다. 숫자·단위·기호·대소문자·부정·수식은 보존합니다.
6. 기기 밖으로 나가는 데이터는 정해져 있습니다. 외부 요약 동의를 켠 경우에만 선별된 인식 텍스트를 운영 서비스(`/v1/plan`·`/v1/write`)로 보내 노트를 만들고, 유료 고화질 화면 인식 옵션과 그 별도 전송 동의를 켠 경우에만 슬라이드 프레임이 운영 서비스를 거쳐 인식 모델로 전달됩니다. 음성은 어떤 설정에서도 기기 밖으로 나가지 않습니다.

### v2 설계

아래는 설계 문서의 요약입니다. 실시간 캡처와 유료 백그라운드 처리 모두 이 파이프라인(`lecture-note-2`)으로 노트를 만듭니다.

- 파이프라인을 소스 → 인식 → 정제 → 판정 → 계획·작성 → 검증 → 렌더 단계로 나누고, 소스가 달라도 같은 출력 형태로 이후 단계를 공유하도록 설계했습니다.
- Free는 지금처럼 탭을 켠 채 실시간 캡처하고 인식은 로컬에 둡니다. 요약 단계만 서버에서 처리하고 월 한도를 둘 계획입니다.
- 유료는 탭 없이 백그라운드에서 미디어 세그먼트를 직접 받아 고속으로 처리하고, 별도 동의를 받아 클라우드 인식(음성·화면)을 쓸 계획입니다.
- 원본 영상·음성은 메모리에서만 처리하고 저장·보내기 기능을 두지 않으며, 전사·슬라이드 텍스트·노트 같은 파생물은 기기에서 AES-GCM으로 암호화해 보관할 계획입니다.
- EME나 암호화 HLS·DASH 같은 보호조치는 우회하지 않습니다. 감지하면 백그라운드 작업을 중단하고 실시간 캡처만 제안하도록 설계돼 있습니다.
- 인식 엔진이나 소스를 사용자에게 묻지 않고 자동으로 바꾸지 않으며, 이벤트·로그·서버 사용 기록에는 강의 내용을 넣지 않는 원칙을 유지합니다.
- 단계별 결정과 동의·저장 설계는 `docs/architecture-v2.md`를 따릅니다.

### 구현 현황

| 구성 | 상태 | 비고 |
| --- | --- | --- |
| 실시간 캡처·로컬 인식(PP-OCRv5, Whisper)·비파괴 근거 선별 | 동작 | 위 1~5단계 흐름 |
| 외부 노트 생성(운영 서비스 `/v1/plan`·`/v1/write`) | 동작 | 동의 후 텍스트만 전송. BYOK(OpenRouter 키 직접 입력)와 `openrouter.ai` 호스트 권한은 제거됨 |
| 유료 고화질 화면 인식(`/v1/vision`) | 동작 | 별도 전송 동의와 서버의 계정·기능 플래그 게이트를 통과해야 함 |
| 암호화 보관함 | 동작 | 사용자 암호로 기기에서 암호화한 ciphertext만 서비스에 저장 |
| 진단 이벤트 스트림과 기기 암호화 로그 | 동작 | `lib/events.js` → `lib/package-store.js`. 내용 없는 코드·수치만, 14일 또는 20MB |
| 개발용 어드민(`admin.html`) | 기반 구현 | 이벤트 실시간 피드는 연결돼 있으나 개발 전용. 패키저 감사(`tools/package-cws.mjs`)로 웹스토어 패키지에서 제외 |
| 강의 패키지 저장(전사·슬라이드 텍스트·노트) | 동작 | 실시간 캡처와 백그라운드 작업 모두 결과를 기기 안 암호화 저장소(`lib/library.js`)에 두고, 노트는 보관함 암호로 암호화한 파일로 Downloads/Summrizei 폴더에 저장합니다 |
| 버전 데이터 계약·검증기(`lib/contracts.js`) | 동작 | 화면 인식·전사·판정·계획/작성 요청과 응답 검증 |
| 정제·판정·계획·작성·검증 단계(`lib/stages.js`, `/v1/judge`·`/v1/plan`·`/v1/write`, `lib/verify.js`) | 동작 | 실시간 캡처·백그라운드·재생성이 같은 `runNote` 경로를 씁니다 |
| 노트 양식·렌더(`lib/note-spec.js`, `lib/note-render.js`) | 동작 | `lecture-note-2` 계약과 `render-4` 템플릿. 노트는 `landing/library.html`의 웹사이트 페이지에서 보고 Markdown·PDF(A4)로 내보냅니다 |
| 노트 목록·보기(`landing/library.html`) | 동작 | 웹사이트에서 Downloads/Summrizei 폴더나 파일을 고르고 보관함 암호를 넣으면 브라우저 안에서 복호화해 보여 줍니다(시험 모드·Markdown·PDF). 생성 옵션을 바꾼 다시 만들기와 인식만 끝난 강의의 노트 만들기는 사이드 패널에서 합니다 |
| 결제(Groble 웹훅 → `entitlements`) | 기반 구현 | `billing-webhook` 함수가 구독 이벤트를 반영합니다. 결제창·포털 주소는 `landing/billing-config.js`에 비어 있습니다 |
| 유료 백그라운드 처리·클라우드 음성 인식(`lib/background-job.js`) | 동작(실서비스 미검증) | HLS만. 서버 기능 플래그 `background`와 사용 동의 2항목·클라우드 인식 동의가 있어야 시작합니다. 보호 스트림·YouTube는 실시간 모드 선택을 묻습니다. 가짜 공급자와 합성 HLS로만 끝까지 확인(`tools/background-smoke.cjs`) |
| 로그인·계정(Supabase Auth·사용량 장부·보관함 Storage·계정 삭제) | 동작(실서비스 미검증) | 구글 로그인, JWT 검증, 원자적 사용량 예약, 계정·데이터 삭제. 실제 Supabase 프로젝트 연결 확인 전 |
| 데이터 관리(기기 데이터 삭제·진단 파일·로그 삭제) | 동작 | 진단 파일 내보내기는 운영자 공개키를 넣기 전까지 꺼져 있습니다 |
| 전역 공급자 동시성(`provider_slots`) | 동작 | 모델별 공급자 상한을 Postgres가 잡아 Edge 워커 수와 무관하게 나눕니다 |

남은 작업(프론트 반영 목록 포함)과 테스트 준비물은 `docs/v2-remaining-work.md`에 정리했습니다.

## 캡처 모드

| 모드 | 영역 | 간격 | 용도 |
| --- | --- | --- | --- |
| **슬라이드** (기본) | 영상 전체 | 저비용 감시 후 안정화 시 OCR | 대부분의 강의 |
| 자막 띠 | 하단 20% | 저비용 감시 후 안정화 시 OCR | 화면에 자막이 박혀 있는 강의 |

배속 재생 시 캡처 간격을 재생 속도에 비례해 줄입니다.

## 설치

1. `chrome://extensions` → "개발자 모드" 켜기
2. "압축해제된 확장 프로그램을 로드" → 이 폴더(`lecture-notes`) 선택
3. 외부 노트 생성을 쓰려면 옵션에서 로그인하고 텍스트 처리 안내에 동의합니다. 인식된 텍스트만 운영 서비스로 전송됩니다.

## 사용

1. 강의 영상을 재생
2. 일반 탭은 확장 아이콘, LearnUs 팝업은 `Alt+Shift+S` → 선택된 영상 탭 확인 → "캡처 시작"
3. 영상이 끝나면 v2 단계가 노트를 만들어 노트 화면이 열리고, 결과는 기기 보관함에 암호화해 저장됩니다. 필요한 경우 암호화 보관함(서비스)에 사용자가 직접 저장합니다.

캡처·오디오·평문 근거는 메모리에만 존재합니다. 패널을 닫아도 offscreen 세션은 유지되지만 브라우저 종료·충돌에서는 복구되지 않습니다. 보관 요청 시에만 기기에서 암호화한 ciphertext를 서비스에 저장합니다.

개발 버전 갱신 시 기존 캡처 창을 닫고 `chrome://extensions`의 확장 카드에서 새로고침하세요. 단축키가 작동하지 않으면 `chrome://extensions/shortcuts`에서 **현재 강의 탭의 캡처 창 열기 (LearnUs 팝업용)** 항목을 확인하세요.

## 알려진 한계

| 장벽 | 증상 | 상태 |
| --- | --- | --- |
| CORS 미설정 CDN | 프레임 캡처 자체가 차단 | preflight가 감지·안내, 우회 불가 |
| DRM (Widevine/EME) | 캔버스가 검은 프레임 반환 | preflight가 감지·안내, 우회 불가 |
| cross-origin iframe 플레이어 | 최상위 문서에서 `<video>`를 못 찾음 | 현재는 명시적으로 중단, 실제 LMS 호환성 검증 필요 |
| 슬라이드 없이 말로만 하는 강의 | OCR할 텍스트가 없음 | Whisper를 사용자가 켠 경우에만 로컬 전사 |
| 암호화 스트림(HLS `EXT-X-KEY`·`EXT-X-SESSION-KEY`, DASH `ContentProtection`, EME) | 백그라운드 수신 불가. 우회하지 않고 작업을 중단한 뒤 실시간 캡처 선택을 묻습니다(EME는 실시간도 불가) | 현재 — HLS `EXT-X-KEY`·`EXT-X-SESSION-KEY` 감지. DASH는 백그라운드 미지원 |
| MSE·blob 플레이어 | `video.currentSrc`가 원본 주소가 아니라 탭의 네트워크 요청을 관찰해 소스를 찾음. 클릭 뒤 최대 8초 동안 그 탭의 요청만 보므로 재생 중이어야 함 | 현재 |
| 다운로드를 약관으로 금지하는 사이트(예: YouTube) | 백그라운드 대상에서 제외하고 실시간 모드만 제공 | 현재 |
| Referer를 검사하는 미디어 CDN | 사용자가 보던 탭의 출처(origin)만 Referer로 재현하고, 확장 자신의 요청에만 겁니다 | 현재 |
| 저사양 기기의 메모리 | 유료 백그라운드 작업은 300MB 예산과 백프레셔로 묶습니다. M1 8GB 실측은 아직 | 현재(미측정) |
| 수식·도표 충실도 | KaTeX 검증·숫자 대조를 통과한 수식만 LaTeX로 렌더하고 나머지는 원본 크롭·"확인 필요"로 표시합니다(재판독은 아직). 숫자 없는 간단한 표만 HTML 표로 옮기고 그래프·숫자 표는 크롭입니다 | 현재 |
| 파생 데이터 보존 | 완료된 결과는 기기 암호화 보관함에 남아 브라우저 종료·충돌에서 이어받습니다. 진행 중인 캡처 세션의 메모리 상태는 복구되지 않습니다 | 일부 현재 |

현재 OCR 기본 경로는 PP-OCRv5 한국어 mobile ONNX/WASM입니다. 음성은 20초 합성음의 Worker 단독 실측에서 실시간 처리량을 충족한 Whisper small q8 인코더/q4 디코더 WebGPU 조합을 기본 선택으로, 기존 Whisper base/WASM을 저사양 모드로 둡니다. 이 측정은 실제 강의의 캡처·발화 분할·OCR 동시 처리 안정성을 보장하지 않습니다. Silero VAD, 실제 LearnUs 팝업·iframe 검증과 장시간 성능 평가는 후속 단계입니다.

## 비용

로컬 OCR/ASR에는 외부 추론 비용이 없습니다. 외부 노트 생성과 유료 고화질 화면 인식의 비용과 한도는 운영 서비스의 계정 설정 및 실제 제공자 usage를 따릅니다.

## 구조

| 파일 | 역할 |
| --- | --- |
| `manifest.json` | MV3 설정. `content_scripts` 없음 — 주입은 런타임에 |
| `content.js` | 영상 preflight와 시각·seek·배속·레이아웃 메타데이터 전달 |
| `background.js` | 권한, tabCapture stream ID, offscreen 생성과 제어 메시지 라우팅 |
| `offscreen.html` / `.js` | 메모리 내 캡처 세션·근거·노트 생성(`lib/stages.js`)·암호화 보관 작업 소유 |
| `lib/session.js` / `evidence.js` | 제한된 OCR/ASR 큐, 종료 drain, 시각·출처 근거 관리 |
| `lib/library.js` | 기기 암호화 보관함 — 메타·재생성 입력·노트·인식 결과·크롭 |
| `lib/note-file.js` | 암호화 파일 형식 — AES-256-GCM, PBKDF2 key derivation, 파일 읽기·쓰기 |
| `landing/library.html` / `.js` | 웹사이트 보관함 페이지 — 폴더/파일 선택, 암호 입력, 브라우저 안 복호화와 노트 보기(서버로 아무것도 보내지 않음) |
| `lib/events.js` | 내용 없는 파이프라인 진단 이벤트 버스(동작 — 암호화 로그와 개발용 어드민에 공급) |
| `lib/auth.js` | Supabase 구글 로그인(PKCE)과 액세스 토큰 갱신. 세션은 `chrome.storage.local`의 `authSession`에만 있다(동기화 안 함) |
| `lib/package-store.js` | 기기 암호화 IndexedDB 저장소(노트·근거·진단 로그) |
| `server/index.js` | 운영자 키, 고정 provider 정책, 노트 계획·작성·판정·비전·STT, 사용량 제한, ciphertext 보관 |
| `sidepanel.html` / `.js` | 표시·제어용 thin RPC adapter. 노트 렌더는 `sandbox.html`에 위임 |

## Supabase 로그인 설정 (운영자)

확장은 `chrome.identity.launchWebAuthFlow`로 Supabase Auth(구글, PKCE)에 로그인합니다. 프로젝트 URL과 공개 anon 키는 `lib/auth.js`에 있고 `landing/supabase-config.js`와 같은 값입니다.

Supabase 설정은 Supabase CLI로 합니다. 원격 설정은 `supabase/config.toml`이 선언하고, 바꾼 뒤 `supabase config diff`로 확인하고 `supabase config push`로 올립니다(서버 쪽 순서는 `server/README.md` "설정 순서").

1. Google 공급자를 켭니다(운영 프로젝트는 이미 켜져 있습니다). Google Cloud Console의 OAuth 클라이언트 ID/Secret이 필요하고, 그 클라이언트의 승인된 리디렉션 URI에 Supabase 콜백(`https://<프로젝트 ref>.supabase.co/auth/v1/callback`)을 추가합니다.
2. `config.toml`의 `auth.additional_redirect_urls`에 `https://<확장 ID>.chromiumapp.org/`를 넣고 push합니다. 목록에 없으면 Supabase가 Site URL로 돌려보내 로그인 창이 끝나지 않습니다. 저장소 경로(`/Users/giwook/Documents/lecture-summary/lecture-notes-extension`)에서 압축 해제로 불러온 개발용 확장의 ID(`gllijdanodakjamndimlpgmhokaakpod`)는 2026-10-03에 넣었습니다.
3. 확장 ID는 `manifest.json`의 `key`가 없으면 압축 해제 로드 시 폴더 경로에서, 웹스토어 배포 시 웹스토어가 정한 값으로 정해집니다. 개발과 배포의 ID를 같게 고정하려면 `key`가 필요하며, 현재 `manifest.json`에는 `key`가 없습니다. 폴더를 옮기거나 다른 경로에서 불러와 ID가 바뀌면 2번의 URL과 서버 `EXTENSION_ORIGIN`도 바꿔야 합니다.

액세스 토큰은 Supabase의 JWT 만료 설정(기본 1시간)을 따르고, 확장은 만료 60초 전부터 refresh token으로 갱신합니다. 갱신이 거부되면(폐기·만료) 세션을 지우고 다시 로그인하도록 안내합니다.

## 캡처 권한 회귀 검증

`node --test lib/*.test.js`로 기본 검사를 실행합니다. `PLAYWRIGHT_MODULE`과 `CHROME_PATH`를 지정한 뒤 `node tools/extension-capture-smoke.cjs`를 실행하면 별도 임시 Chrome 프로필에 실제 확장을 로드합니다. 테스트용 확장 디버깅 옵션은 이 임시 프로필에만 사용하며 개인 Chrome에는 연결하지 않습니다.

Chrome 152에서 `openPanelOnActionClick: true`일 때 아이콘 호출 후에도 캡처 권한이 없는 기존 오류를 재현했고, `false`와 명시적 `action.onClicked`로 변경한 뒤 실제 tabCapture → offscreen → PP-OCRv5 → 종료 경로를 검증했습니다. 권한을 받은 탭을 툴바 없는 팝업으로 옮겨 같은 경로와 대상 탭 유지도 확인합니다. 다른 출처로 이동하면 권한이 취소되는지도 검사합니다.

이 검사는 합성 영상만 사용합니다. Headless 키 입력으로는 Chrome 단축키를 실행할 수 없어 실제 LearnUs 창에서의 `Alt+Shift+S` 입력과 LMS 호환성은 별도 실사용 확인이 필요합니다. 단축키 등록 및 명령 핸들러의 탭 ID 전달은 자동 검사에 포함됩니다.
