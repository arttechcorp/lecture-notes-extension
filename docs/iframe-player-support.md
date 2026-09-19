# iframe 플레이어 지원 — 코드 보강 기획

작성일: 2026-09-17. 상태: 구현 중.

결정 사항(2026-09-18): ① "video 없는 탭" 전체화면 경과시간 모드를 범위에 **포함**(Meet/Zoom 웹 커버), ② `FRAME_BOX` 폴링은 메타데이터와 같은 250ms, ③ 중첩 iframe은 이번 범위에서 미지원 — "중첩된 iframe 안의 영상은 아직 지원하지 않습니다" 에러로 명시(추가 논의 예정).

LMS 페이지 안 cross-origin iframe에 있는 비보호 `<video>` 강의를 현재와 동일한 품질(시간 동기·영역 크롭·seek/종료 감지)로 인식하기 위한 변경 범위를 정리한다.

## 목표 / 비목표

**목표**: 상위 프레임이 아닌 iframe 안의 `<video>`도 찾아 DRM 검사·좌표 측정·재생 메타데이터 수집을 수행한다.

**비목표(불변)**:

- DRM·보안 플레이어 우회 금지 — EME(`mediaKeys`/`encrypted`) 또는 검은 화면 감지 시 중단
- 설치형 전용 플레이어(Kollus App Player 등), 네이티브 앱 — 브라우저 밖이라 범위 외
- 특정 대학 "지원 보장" 문구 — 실측 전까지 랜딩에 쓰지 않음

## 현재 구조에서 막히는 지점

tabCapture는 탭 합성 출력 전체를 잡으므로(`offscreen.js:62-63`) 미디어 경로는 이미 iframe을 포함한다. 보강은 메타데이터·좌표·DRM 감지 경로에 집중된다.

| 단계 | 현재 | 문제 |
|---|---|---|
| 주사 | `executeScript({target:{tabId}})` — top frame만 (`background.js:49`) | iframe에 스크립트 없음 |
| 사전검사 | `PREFLIGHT` → `frameId:0` 고정 (`background.js:50`) | iframe의 video를 못 찾아 실패 |
| 감시 | `WATCH_MEDIA` → `frameId:0` (`background.js:30,54`) | 잘못된 프레임 |
| 메타 수신 | `sender.frameId===0` 하드코딩 (`offscreen.js:45`) | iframe 메타데이터 거부 |
| 좌표 | `metadata.box` = 상위 뷰포트 기준 (`content.js:23` → `session.js:67`) | iframe 내부 좌표는 오프셋 필요 |
| video 탐색 | `querySelectorAll("video")` (`content.js:9`) | shadow DOM 관통 불가 |
| 캡처 검증 | `drawImage` SecurityError = 차단 판정 (`content.js:39`) | cross-origin mp4는 CORS taint로 오탐 가능 (tabCapture는 정상) |

## 변경 범위

### Phase 1 — 1단계 iframe 지원 (핵심)

**1. `content.js` — 전 프레임 주입 + 역할 분리**

- `executeScript`에 `allFrames: true` 추가. 각 프레임의 스크립트는 주입 직후 `FRAME_READY {url}`를 background에 자진 보고 → `sender.frameId`로 프레임 목록 확보 (새 권한 불필요)
- `locate()`: shadow root 재귀 탐색(깊이 제한)으로 `<video>` 검색
- `preflight()`: 로컬 video 유무·EME·면적을 보고. `drawImage` 실패(SecurityError)는 치명이 아닌 `unverifiable` 플래그로 격하 — 최종 판정을 offscreen으로 이동
- 역할 2개:
  - 감시 프레임(video가 있는 프레임): 기존 250ms 메타 폴링, `box`를 자기 뷰포트 기준으로 전송
  - 상위 프레임(frameId 0): `FRAME_WATCH` 수신 시 postMessage 핸드셰이크로 어떤 `<iframe>`이 감시 프레임인지 식별(iframe.contentWindow로 probe → 감시 프레임이 ack) 후, 그 요소의 `getBoundingClientRect()`를 정규화해 `FRAME_BOX`로 주기 보고. URL 매칭보다 견고(srcdoc·리다이렉트 무관)

**2. `background.js` — 프레임 라우팅**

- `FRAME_READY` 수집 → 각 프레임에 `PREFLIGHT` → 비보호·최대 면적 프레임을 `watchFrameId`로 선정 (모두 실패 시 기존 에러 유지)
- `WATCH_MEDIA`/`STOP_WATCH`를 `watchFrameId`로, `FRAME_WATCH`를 frameId 0으로 송신
- `START_SESSION`의 `options.watchFrameId`를 offscreen에 전달
- `SESSION_STATE` 재연결 경로(`background.js:30-31`)도 동일 라우팅 적용

**3. `offscreen.js` — 송신자 검증 완화**

- `MEDIA_METADATA`: `sender.frameId===session.options.watchFrameId`로 변경 (탭 검증은 유지)
- `FRAME_BOX` 메시지 수신 → 세션의 최신 iframe rect로 보관

**4. `lib/session.js` — 좌표 합성 + 캡처 검증 이동**

- `rect()`: `watchFrameId!==0`이면 `boxTop = iframeBox ∘ boxLocal` 합성 후 기존 뷰포트 경계 검사
- `FRAME_BOX`도 `metadataAt`과 같은 stale 판정(2.5초) — iframe rect 갱신이 끊기면 동일하게 중단
- 검은 화면 가드레일 이전: `captureVisual` 첫 크롭에서 평균 밝기 측정 — 재생 중인데 검정이면 "보호된 강의이거나 영상을 읽을 수 없습니다"로 실패. `drawImage` CORS 오탐과 EME-비EME 캡처 차단을 한 곳에서 커버

**5. 신규 `lib/frame-box.js` + 테스트**

- 좌표 합성·검증을 순수 함수로 분리 → `lib/frame-box.test.js` 단위 테스트 (합성, 경계 클리핑, stale, 역비율 레터박스)
- `node --test lib/*.test.js` 통과 필수

### Phase 2 — 견고성 (Phase 1 이후 판단)

- 중첩 iframe(깊이≥2): LMS → 중간 페이지 → 플레이어. probe를 hop-by-hop 릴레이하면 `webNavigation` 권한 없이도 체인 합성 가능. 실측에서 필요 확인 후 진행
- 늦게 로드되는 플레이어: preflight 재시도 창(~3초) 또는 `registerContentScripts(persistAcrossSessions:false)`로 세션 중 신규 프레임 자동 주사
- iframe 네비게이션/교체: 주사 스크립트 소실 → 현재는 stale 감지로 중단. Phase 2에서 재식별
- video 요소 없는 플레이어(canvas/WebGL): box를 뷰포트 전체로 둔 "경과시간 모드" — `timeKind:"elapsed"` 경로가 이미 존재(`session.js:24`)하나 ROI·종료 감지가 없어져 별도 결정 사항

## 보안·불변 체크

- 프레임 경계를 넘는 건 좌표·재생 메타데이터뿐 — `content.js`의 "강의 내용 무전송" 계약 유지
- iframe 안 EME 감지는 해당 프레임 안에서 동일하게 동작 → 차단 판정 보존
- 위캔디오 등 "확장 감지·차단" 보안 플레이어가 화면을 검게 하면 offscreen 검정 체크가 중단 — 우회 시도 없음
- 권한 추가 없음 (`scripting` + `<all_urls>`로 충분). `webNavigation`은 Phase 2에서도 릴레이 방식이면 불필요

## 검증 계획

1. 단위: `frame-box` 합성·검증, 기존 `lib/*.test.js` 회귀
2. 픽스처: 로컬 서버 2개(포트 다른 = cross-origin)로 `iframe > video` 테스트 페이지 작성 — top-frame/iframe/shadow DOM/검은 화면 4케이스
3. 수동 QA 매트릭스: Canvas 임베드 샘플, YouTube 임베드, Panopto 공개 샘플, Kollus 비암호화 샘플, (DRM 샘플 = 중단 확인), 중첩 iframe = 명확한 미지원 에러
4. 실측: 대학 LMS는 계정 필요 — 지원 페이지에 "되는지 직접 확인" 체크리스트로 전달하는 게 현실적

## 규모 감

Phase 1: `content.js` 대폭(+역할 분리), `background.js` 중간(프레임 선택 로직), `offscreen.js`·`session.js` 소폭, 신규 lib+테스트. 인식 파이프라인(OCR/ASR/요약)은 무접촉.

## 열린 결정

1. "video 없는 탭" 전체화면 모드를 이번 범위에 넣을지 — 넣으면 Meet/Zoom 웹 실시간 강의도 커버되나 에러 표현·ROI UX가 바뀜
2. `FRAME_BOX` 폴링 주기를 메타데이터와 같은 250ms로 할지(구현 단순) 느리게 할지
3. 중첩 iframe을 처음부터 지원할지 — 릴레이 방식이면 권한 없이 가능하나 복잡도 ↑
