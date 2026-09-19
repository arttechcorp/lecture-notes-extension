# memory.md

코드만 봐서는 드러나지 않는 결합을 기억하기 위한 메모.

## 제품 패널과 랜딩 체험

- `sidepanel.html`과 `landing/demo-panel.html`은 `landing/product-panel.css`를 공유한다. 이 CSS의 제품 패널 규칙은 두 화면에 함께 영향을 준다.
- 제품은 `landing/vendor/markdown-it.min.js`와 `landing/note-viewer.js`를 직접 로드한다. 랜딩의 부모 문서(`landing/index.html`, `hero-mockup.html`)도 두 파일을 로드하고, 같은 출처의 `demo-panel.html` iframe 문서에 `NoteViewer`를 연결해 조작한다.
- 데모 iframe은 `sandbox="allow-same-origin"`이라 내부 스크립트는 실행되지 않는다. 부모의 `hero-mockup.js`가 `contentDocument`를 통해 준비된 체험을 제어한다.
- `landing/demo-panel.html`(캡처 없는 데모)에서는 `#result` textarea가 여전히 canonical Markdown을 보존하고, `#notePreview`가 안전하게 렌더링된 HTML을 표시한다. 데모의 읽기·편집·복사·다운로드와 요약/타임라인 전환은 이 Markdown을 기준으로 동작한다.
- 실제 제품 `sidepanel.html`은 다르다. 캡처 상태의 canonical 소유자는 `offscreen.js`의 `CaptureSession`/`EvidenceStore`다. `sidepanel.js`는 화면·제어만 담당하는 thin RPC adapter이며, 그 안의 `#result` textarea는 `SESSION_STATE` 메시지로 받은 `state.summary`를 매번 다시 렌더링한 표시용 사본일 뿐 편집 가능한 canonical 원본이 아니다.
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
