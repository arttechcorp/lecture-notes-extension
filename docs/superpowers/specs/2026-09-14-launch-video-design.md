# 런칭 영상 (Remotion) 설계

## 배경

랜딩페이지 히어로 목업(`landing/hero-mockup.html` + `.css` + `.js`)을 소스로, 세로(9:16) 쇼츠/릴스용 제품 런칭 영상을 만든다. 목업은 브라우저 실시간 상호작용(setTimeout/setInterval/requestAnimationFrame/CSS transition, 스크롤 틸트, IntersectionObserver, visibilitychange, 클립보드)에 기반한 무한 루프 데모라, 그대로 화면 녹화하면 프레임 캡처 시점마다 타이밍이 어긋나 결과물이 렌더마다 달라지고 끊긴다. [Remotion](https://github.com/remotion-dev/remotion)은 프레임 단위 결정론적 렌더링을 전제하므로, 목업의 시각 마크업/스타일은 재사용하되 타이밍 로직은 `useCurrentFrame()` 기반 순수 함수로 재구현한다.

## 범위

- 신규 Remotion 프로젝트: 레포 내 `/video` 폴더
- 해상도 1080×1920 (9:16), 30fps
- 무음 영상 (내레이션/BGM 없음, 추후 확장 가능하게 오디오 트랙 자리만 비워둠)
- 3개 씬을 `<Sequence>`로 순차 구성, 반복 루프 없이 1회 재생으로 종료
- 산출물: `remotion render`로 뽑는 mp4

## 씬 구성

1. **인트로**: 브랜드 워드마크(`Summrizei`) + 랜딩 히어로 카피("온라인 강의 딸깍." 등) 페이드/슬라이드 인
2. **목업 시연**: `landing/hero-mockup.js`의 상태머신 중 영상에 의미 있는 부분만 포팅
3. **CTA**: 마무리 카피 + CTA 버튼 비주얼

## 목업 포팅 매핑 (hero-mockup.js → Remotion)

| 원본 (wall-clock) | 포팅 (frame 기반) |
|---|---|
| `captureTick` (setInterval 400ms, `elapsed += .4`) | `elapsed = frame / fps` |
| 캡션 인덱스 `Math.floor(elapsed / 2.4)` | 동일 수식, `elapsed`만 frame 기반값 대입 |
| 슬라이드 전환 (`showSlide`, `event % 2 === 0`) | 동일 수식 적용 |
| 잉크 드로잉 (`paintInk`, rAF 루프, `strokeDashoffset`) | `interpolate(frame, ...)`로 stroke-dashoffset 직접 계산, rAF 불필요 |
| 노트 스트리밍 (`generateNoteTick`, setInterval 24ms, `generationCursor += 6`) | `generationCursor = min(note.length, frameSinceDoneStage * (6 / (24/1000) / fps))`로 동일 속도 환산 |
| `queueLoop` / 무한 반복 | 제거 — 1회 재생 후 CTA 씬으로 전환 |
| 스크롤 틸트 (`updateTilt`, scroll 이벤트) | 제거. 초기 틸트 각도(12deg→0deg)를 씬 진입 시 `interpolate()`로 대체하거나 고정값 사용 |
| IntersectionObserver / visibilitychange / reduced-motion / 클립보드 | 전부 제거 — 렌더링 영상에는 의미 없음 |

## 컴포넌트 구조

- 목업 시각 마크업(`demo-panel.html`의 패널 구조, 캡션 피드, 노트 뷰어)을 React 컴포넌트로 이식
- 스타일은 `landing/hero-mockup.css`, `landing/product-panel.css`를 최대한 그대로 재사용 (import 또는 복사)
- `note-viewer.js`의 마크다운 렌더링 로직은 순수 함수라 그대로 가져다 쓸 수 있음

## 테스트

- `remotion render`로 로컬 mp4 렌더 후 육안 확인 (자동화 테스트 대상 아님, 시각 결과물)
- 잉크 드로잉/노트 스트리밍 진행률 계산 함수는 순수 함수이므로 프레임→진행률 매핑에 대한 간단한 단위 테스트 작성 가능
