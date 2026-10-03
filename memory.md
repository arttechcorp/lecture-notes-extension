# memory.md

코드만 봐서는 드러나지 않는 결합을 기억하기 위한 메모.

## 제품 패널과 랜딩 체험

- `sidepanel.html`과 `landing/demo-panel.html`은 `landing/product-panel.css`를 공유한다. 이 CSS의 제품 패널 규칙은 두 화면에 함께 영향을 준다.
- 제품은 `landing/vendor/markdown-it.min.js`와 `landing/note-viewer.js`를 직접 로드한다. 랜딩의 부모 문서(`landing/index.html`, `hero-mockup.html`)도 두 파일을 로드하고, 같은 출처의 `demo-panel.html` iframe 문서에 `NoteViewer`를 연결해 조작한다.
- 데모 iframe은 `sandbox="allow-same-origin"`이라 내부 스크립트는 실행되지 않는다. 부모의 `hero-mockup.js`가 `contentDocument`를 통해 준비된 체험을 제어한다.
- `landing/demo-panel.html`(캡처 없는 데모)에서는 `#result` textarea가 여전히 canonical Markdown을 보존하고, `#notePreview`가 안전하게 렌더링된 HTML을 표시한다. 데모의 읽기·편집·복사·다운로드와 요약/타임라인 전환은 이 Markdown을 기준으로 동작한다.
- 실제 제품 `sidepanel.html`은 다르다. 캡처 상태의 canonical 소유자는 `offscreen.js`의 `CaptureSession`/`EvidenceStore`다. `sidepanel.js`는 화면·제어만 담당하는 thin RPC adapter이며, 그 안의 `#result` textarea는 `SESSION_STATE` 메시지로 받은 `state.summary`를 매번 다시 렌더링한 표시용 사본일 뿐 편집 가능한 canonical 원본이 아니다.
- v2 노트의 타이포그래피·인쇄 규칙 단일 원천은 `lib/note-spec.js`의 `NoteSpec.css`다 — `sandbox.html`이 한 번 `<style>`에 주입한다(제품 패널의 product-panel.css 와는 별개). PDF는 `PRINT_NOTE` 메시지가 `medium:"print"`로 다시 렌더한 뒤 폰트·이미지 디코드를 기다려 `window.print()`로 찍는다 — 비율 선택이나 테마 분기는 없다.
- 패널의 `sidepanel.js`는 노트를 직접 렌더하지 않는다. `state.summary`(v2: `note` 또는 `recognition`)를 받아 `RENDER_NOTE`/`RENDER_RECOGNITION`/`PRINT_NOTE` 메시지만 sandbox에 보내고, `#result` textarea에는 `NoteExport.toMarkdown`이 만든 Markdown 사본만 둔다(노션 복사·마크다운 편집 탭용). 크롭 이미지는 `NoteLibrary.cropUrls`가 data URL로 꺼내 같이 보낸다.
- `library.html`/`note.html?id=<packageId>`는 offscreen을 거치지 않고 암호화된 로컬 스토어(`PackageStore`/`NoteLibrary`)를 직접 읽는다. 노트가 없고 `recognition`만 있는 패키지는 note 페이지가 `RENDER_RECOGNITION`으로 인식 결과만 보여 주고 내보내기 버튼을 숨긴다 — 인식 원문은 절대 내보내지 않는다.
- `background.js`는 `BG_DONE`에 `packageId`를 검증해 싣고, 패널은 그 id로 "노트 열기"(note.html) 버튼을 보인다. 외부 요약 동의가 없으면 백그라운드 작업은 인식만 만들지만, 시작 전에 그 사실을 패널이 알려야 한다(조용한 전환 금지).
- `hero-mockup.js`는 실제 캡처나 녹음 없이 직접 작성한 샘플과 스트리밍 연출을 제공한다. `landing/index.html`의 메인 figure와 `hero-mockup.html`의 standalone figure는 동작·마크업 parity를 유지한다.
- 데모 후반의 PDF→AirDrop→태블릿 장면(`share`/`tablet` state)은 `.mock-canvas` 안의 `.share-sheet`/`.tablet-scene` 오버레이로 구현되며, 시퀀스·타이밍·좌표 규칙은 `docs/hero-demo-sequence.md`에 정리해 둔다.
- 갱신된 랜딩 자산의 `src`에는 버전 쿼리를 붙인다. `landing/hero-mockup.css`는 브라우저와 강의 화면 레이아웃을 맡고, 제품 패널 스타일은 `product-panel.css`가 맡는다.

## 왼쪽 강의 화면

왼쪽 슬라이드는 사용자 제공 금융 슬라이드 레퍼런스를 바탕으로 재구성한 작성 HTML이다. 실제 녹화·강의 캡처는 추가하지 않는다.

## 사전 예약 웨이트리스트

- 예약 버튼은 `data-reserve`(히어로)와 `data-reserve="<plan-id>"`(플랜 카드·카드 본문 클릭)로 표시하고 `landing.js`가 `#reserveDialog`를 연다. plan id는 `plans` 객체의 키여야 라벨·payload에 이름이 붙는다.
- 제출은 `waitlist-config.js`의 `window.SUMMRIZEI_WAITLIST`(Supabase PostgREST URL + anon key)로 POST한다. 값이 비어 있으면 다이얼로그는 열리지만 전송은 안내 문구로 막는다. anon key는 RLS INSERT 전용이라 공개 가능 — 테이블·정책은 `docs/waitlist-supabase.sql`.
- 성공 시 `sessionStorage('summrizei.reserved')`에 `{email, plan}`을 넣고 `thanks.html`로 이동한다. 완료 페이지는 이 값이 있으면 이메일·플랜을 되보여 주고 즉시 지운다.
- 전화번호는 digits만 저장한다(폼 `pattern`이 한국 휴대폰 형식을 검증). `[필수]` 수집·이용 동의 체크박스는 전화번호 수집의 법적 요건이라 제거하지 않는다.

## 랜딩 모바일·인앱 브라우저 결합

- `.sr-only`는 `position:absolute`다. 조상에 positioned 요소가 없으면 containing block이 뷰포트라 `overflow:hidden` 조상도 무시하고 문서 `scrollWidth`를 넓힌다 — 카드 안 `sr-only`가 문서를 1301px로 만들어 모바일 브라우저가 페이지를 축소 렌더링했던 실제 사고. `.review-card`의 `position:relative`는 이를 막는 장치이니 제거 금지.
- 마퀴 트랙(`.school-marquee-track`, `.reviews-track`)에 `will-change:transform`를 붙이지 않는다. 트랙이 수천 px라 iOS 합성 레이어 한도를 넘어 애니메이션이 조용히 죽는다.
- 터치 기기에서 `tabindex` 영역은 탭하면 `:focus-within`이 고정돼 마퀴 정지 선택자가 영구 발동한다. `:hover`/`:focus-within` 정지 규칙은 `@media(hover:hover)` 안에만 두고, 터치 정지는 `:active`로만 처리한다.
- 모바일 리뷰는 자동 마퀴가 아니라 스와이프 카드 목록이 설계(docs/mobile-web-principles.md §4). `.reviews-viewport`의 `scroll-snap-type:x mandatory` 아래 카드에 `scroll-snap-align`이 없으면 iOS에서 스크롤이 튕겨 돌아오므로 카드의 `scroll-snap-align:start`는 필수다.
- 히어로 목업은 IntersectionObserver `threshold:.35`로 "실제로 보일 때"만 재생하고, 재진입 시 `startCapture()`로 처음부터 다시 시작한다(`userPaused`면 재시작 안 함 — 일시정지해 읽던 노트를 지키기 위함).
- `#preview` 강의 화면은 `aspect-ratio:16/9` + `container-type:inline-size` 프레임이고 내부 크기는 전부 `cqw`다. 프레임 안 요소를 px로 고치면 폭마다 깨진다. 자동 루프는 `data-scene`/`data-evidence` 선택자에 의존하므로 이름을 바꾸면 안 된다.

## 프레임 감시 구조 (iframe 지원)

- `content.js`는 `allFrames` 주사로 모든 프레임에 들어가며, 시작 직후 `FRAME_READY`를 자진 보고한다(재주입·서비스 워커 재시작 시에도). `background.js`는 약 1.4초 announce를 모아 `watchFrameId`를 고른다: 0=상위 프레임 영상, >0=iframe, null=video 없음(경과시간 모드 — 탭 뷰포트 전체가 ROI, `timeKind:"elapsed"`).
- 프레임 역할은 둘이다. video가 있는 감시 프레임은 `MEDIA_METADATA`(자기 뷰포트 기준 box)를, 상위 프레임(frameId 0)은 `FRAME_WATCH`를 받아 watched `<iframe>` 요소의 `FRAME_BOX`를 보낸다. 상위 프레임은 어떤 iframe이 watched인지 postMessage probe(`srz:"probe"`/`"probe-ack"`, sessionId 일치 + `event.source` 비교)로 식별한다 — URL 매칭은 쓰지 않는다.
- `offscreen.js`의 `MEDIA_METADATA` 송신자 검증은 `frameId===0`이 아니라 `options.watchFrameId`와 비교한다. `state().watchFrameId`로 재연결 라우팅하므로 state에 항상 포함돼야 한다.
- 검은 화면·캡처 차단 판정은 `content.js`의 `drawImage` 사전검사가 아니라 `session.js`의 크롭 픽셀 검사(32×18, 연속 3회)가 담당한다. cross-origin mp4의 CORS taint 오탐을 피하기 위한 이동이며, iframe 내부 EME는 여전히 content.js의 `mediaKeys`/`encrypted`로 감지한다.
- 중첩 iframe(깊이≥2)은 상위 프레임이 직계 iframe만 probe하므로 `FRAME_BOX`가 오지 않고, `session.js`가 2.5초 유예 뒤 "중첩된 iframe 안의 영상은 아직 지원하지 않습니다"로 중단한다.

## 캡처 권한과 별도 제어 창

- `openPanelOnActionClick: true`는 tabCapture에 필요한 action 권한 부여 경로를 건너뛴다. 기존 브라우저에 저장된 값도 바꾸도록 `setup()`에서 명시적으로 `false`로 설정하고, `action.onClicked`에서 패널을 연다.
- LearnUs 팝업용 `open-capture-panel` 명령은 호출 시점의 `tab.id`를 `sidepanel.html?tabId=…`로 전달한다. 제어 창이 포커스를 가져간 뒤 활성 탭을 다시 선택하면 원래 강의 탭과 달라질 수 있으므로 이 대상 ID를 유지해야 한다. ID는 권한을 만들어 주지 않으며 캡처 권한 판정은 Chrome이 한다.

## 음성 진단 로그

- `lib/session.js`의 `CaptureSession`이 ASR 진단 로그를 메모리에서만 소유하고 `SESSION_STATE`에 최근 100줄을 실어 보낸다. `sidepanel.js`는 `#debugLog`에 표시만 하며 강의 발화 텍스트는 로그에 넣지 않는다.
- 로그는 모델 준비, AudioContext, 청크 길이/RMS, 백로그, 처리 시간, 빈 결과와 오류만 기록하고 세션 폐기 시 지운다. 음성 실패 시 `#debugDetails`를 자동으로 연다.
- 모델 준비 로그는 Worker가 보고한 모델·device·dtype와 선택 언어·OCR 사용 여부를 포함한다. 화면의 Small 표시만으로 실제 로드된 Worker 모델을 판정하지 않는다.
- Transformers.js의 다국어 Whisper는 언어를 생략하면 영어 토큰을 기본 선택한다. 따라서 설정의 `auto`는 현재 한국어 강의 우선(`korean`)으로 보정하고, 영어 강의는 `en`을 명시한다.
- 일반 무음 경계에서는 최소 10초를 모으고 최대 20초에서 분할한다. 정지·탐색·배속 변경의 명시적 flush는 짧은 꼬리도 보존한다. 20초 고정 음원을 Worker에 직접 보내는 벤치마크는 이 실제 분할 경로 및 OCR 경쟁을 검증하지 않는다.

## GSAP 의존성

- GSAP + ScrollTrigger는 `landing/gsap-animations.js` 한 파일에서만 쓴다. 사용처와 유지 이유는 그 파일 머리말에 적어뒀다. 두 연출(히어로 진입 타임라인, ScrollTrigger 1회 등장)을 쓰지 않게 되면 `landing/index.html`의 CDN `<script>` 두 줄과 함께 통째로 지운다.
- 히어로 진입의 초기 상태(`opacity: 0`)는 세 곳에 나뉘어 있다. `index.html` head의 인라인 스크립트가 `html.gsap-enter`를 붙이고(2초 안전장치 포함), `landing.css`가 그 클래스로 숨기고, `gsap-animations.js`가 `gsap.set()`으로 시작값을 고정한 뒤 클래스를 걷는다. 셋 중 하나만 고치면 히어로가 영영 안 보이거나 페인트 후 깜빡인다.

## 파이프라인 이벤트 스트림

- 진단 이벤트는 오프스크린의 단일 `PipelineEvents.EventBus`(`lib/events.js`)에서 나오고 세 곳이 구독한다: `admin-events` 포트의 `admin.html`(`offscreen.js` onConnect — 송신자가 이 확장의 `/admin.html`인지 검증), `LogSink`→`PackageStore` "logs" 스토어의 암호화 로컬 로그, 이후 진행 UI.
- 이벤트에는 강의 텍스트를 싣지 않는다(AGENTS.md §2 콘텐츠 없는 원격 측정). 고정 코드·수치·짧은 진단 msg만 허용한다.
- 파이프라인(`session.js`, `offscreen.js`)에는 `PipelineEvents.safe(bus)` 껍데기만 넘긴다 — 잘못된 진단 이벤트의 예외가 캡처를 죽이지 않도록.
- `admin.html`은 개발 전용이며 `tools/package-cws.mjs`(테스트 + 감사 규칙)가 스토어 패키지에서 배제한다.

## 동의 기록

- 동의 기록은 `chrome.storage.local`의 설정 값에만 산다(`lib/settings.js`): 클라우드 인식은 `visionConsent`+`visionConsentVersion`/`visionConsentAt`, 백그라운드 처리는 `backgroundConsent{personalUse,accessRights,version,at}`.
- `TERMS_VERSION`은 options.html/sidepanel의 동의 문구나 정책 페이지가 바뀔 때마다 올린다 - 올리면 재동의가 강제되고, 이후 서버 `profiles.consent_version`과도 맞춰야 한다.
- 버전 없는 `visionConsent:true`는 화면 프레임만 커버하는 레거시 동의다. 장래 음성/클라우드 STT 게이트는 `cloudRecognitionAllowed()`를 쓰고, `session.js`의 기존 화면 전송 게이트(`visionConsent===true`)는 그대로다.
- `backgroundAllowed()`·`cloudRecognitionAllowed()`는 패널(시작 전 확인)과 `lib/background-job.js`의 게이트(네트워크 전)가 읽는다. 후자는 이 함수들을 전역에서 찾으므로 `offscreen.html`이 `lib/settings.js`를 싣는다(저장소를 읽는 함수는 offscreen.js가 부르지 않는다). offscreen에 넘기는 설정은 패널이 보낸 값이 아니라 background가 저장소에서 읽은 것이다.

## 유료 백그라운드 작업 배선

- 메시지: 패널 → background `BG_RUN`·`BG_LIST`·`BG_CANCEL` → offscreen(`target:"session"`, 송신자는 `/background.js`만). offscreen → background `BG_REFERER`(새 호스트를 Referer 규칙에 더함)·`BG_DONE`(결말, 이 둘은 offscreen 문서만 보낼 수 있다). background → 패널 `BG_DONE`, offscreen → 패널 `BG_PROGRESS`(단계 이름과 개수만).
- `BG_DONE`을 빠뜨리면 절전 방지(`chrome.power`)와 Referer 규칙(DNR 세션 규칙 900002, admin 소스 진단은 900001)이 풀리지 않는다 - background가 둘 다 `BG_DONE`에서만 푼다. offscreen은 어떤 결말이든 `BG_DONE`을 보내야 한다.
- Referer 값은 background가 `BG_RUN` 때 `chrome.tabs.get`으로 읽은 탭 주소(조각 제외)다. 패널이 보낸 pageUrl은 쓰지 않는다. 규칙은 `tabIds:[-1]`이라 확장 자신의 요청에만 걸린다.
- 모델 이름은 `offscreen.js`의 `BG_MODELS` 한 곳이다. 서버 allowlist(`ALLOWED_*_MODELS`)와 맞아야 한다.
- `sidepanel.js`의 `YOUTUBE` 정규식은 `lib/background-job.js`의 것과 같아야 한다(`lib/sidepanel-background.test.js`가 대조한다).

## 계정 메뉴·로그인·결제(grogle)

- 햄버거 메뉴는 두 곳에 있다: 확장 `sidepanel.html`의 `#menuBtn`/`#accountMenu`(인앱 설정 포함), 랜딩·계정 페이지의 `landing/account-menu.js` 서랍(인앱 설정 없음). 항목 순서·문구를 바꾸면 둘을 같이 고친다. `landing/demo-panel.html`의 `.menu-glyph`는 장식용 사본이다.
- 확장 로그인은 `lib/auth.js` 하나가 맡는다(PKCE). 세션은 `chrome.storage.local`의 `authSession` 한 키에만 있고 `lib/settings.js`의 `loadAuthSession`·`saveAuthSession`만 읽고 쓴다(설정 저장은 이 키를 건드리지 않는다). `lib/account.js`는 패널 계정 메뉴의 표시(`decodeUser`)와 `my_account()` 조회만 하고, 로그인·갱신·로그아웃은 `Auth`에 맡긴다. 두 구현이 따로 로그인하면 세션 형식이 엇갈려 서로를 로그아웃시킨다(2026-10-03 main 병합 때 하나로 합침). 노트·원문은 이 키에 넣지 않는다.
- 확장은 `tools/package-cws.mjs`가 `landing/`을 빼고 패키징하므로 `landing/supabase-config.js`를 읽지 못한다. 그래서 `lib/auth.js`가 Supabase URL·anon 키를 복제해 둔다 — 프로젝트를 바꾸면 두 파일을 같이 고친다.
- Supabase Auth의 Redirect URLs에 `https://<확장ID>.chromiumapp.org/`와 `https://summrizei.vercel.app/account/**`가 등록돼 있어야 로그인이 돌아온다. 목록은 `supabase/config.toml`의 `auth.additional_redirect_urls`가 선언하고 `supabase config push`로 올린다.
- grogle 결제창·고객 포털 주소는 `landing/billing-config.js` 한 곳에만 둔다. 비어 있으면 계정 페이지는 "결제 준비 중"으로 안내한다. 이동할 때 `email`·`client_reference_id`(Supabase user id)를 쿼리로 붙인다 — 웹훅이 구독을 계정에 묶는 키다.
- 등급·가격·사용량은 `supabase/schema-v2.sql` 한 벌이다(2026-10-03 일원화). 이름·가격·한도는 `plans`(free·essential·professional), 사용자 등급은 `profiles`+`entitlements`(결제는 `source='payment'`, 학생가 `edu`, 해지 예약 `cancel_at_period_end`)를 `effective_plan`이 합치고, 사용량은 `monthly_usage`다. 서버 한도, 계정 페이지·패널 메뉴(`my_account()`), 가격 표(`plan_catalog()`)가 모두 이 표를 읽는다. 클라이언트는 쓰지 않고, 쓰기는 서버(service_role)와 이후 grogle 웹훅만 한다.
- 랜딩의 정적 가격(`landing/index.html`·`llms.txt`·`thanks.html`)은 `plans` 시드와 같아야 한다(`tools/plan-prices.test.mjs`). 가격을 바꾸면 시드와 정적 문구를 같이 고친다.
- 계정 삭제는 두 곳(확장 설정 → 서버 `DELETE /v1/account`, 랜딩 → Edge Function `delete-account`)이고 순서가 같다: `delete_account_data`(결제 구독 검사) → Storage `<user_id>/` → auth 사용자. Postgres는 Storage 객체를 지울 수 없다(`protect_objects_delete`).
