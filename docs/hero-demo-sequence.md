# 히어로 데모 시퀀스

랜딩 히어로 목업(`#heroDemo`)이 고객에게 보여 주는 자동 재생 시퀀스 정리.
구동 코드는 `landing/hero-mockup.js`, 마크업은 `landing/index.html`과 `landing/hero-mockup.html`(두 figure는 parity 유지), 패널 UI는 `landing/demo-panel.html`.

## 전체 루프 (약 21~22초)

```
02 캡처 (8s)
  → 03 노트 스트리밍 + "노트 완성" (생성 ~2.3s + 유지 2.0s)
  → PDF 출력 버튼 눌림 (0.45s)
  → macOS 공유 시트: AirDrop → iPad 전송 (약 2.4s)
  → 태블릿 노트앱: 형광펜 + 밑줄 필기 (약 6.4s)
  → 02 캡처로 복귀
```

## 단계별 상세

| `mock.dataset.state` | 시간 | 화면 |
|---|---|---|
| `live` | 8s | 왼쪽 강의 슬라이드 3장 순환 + 손글씨 잉크. 패널: "캡처 중" pill, 카운터(슬라이드/음성 줄/처리 대기), 인식 피드 최근 3줄 |
| `done` | ~4.3s | 패널: 노트 마크다운 스트리밍 → "노트 완성" + 읽기/편집 토글 + 복사 + `export-row`(PDF 출력/노션으로 복사) 등장 |
| `done` → `share` | 0~0.45s | `data-state`는 아직 `done`. 패널의 "PDF 출력" 버튼에 `.is-pressed` |
| `share` | 0.45~2.8s | macOS 공유 시트 오버레이: 요약 노트.pdf 칩, 앱 아이콘 행, AirDrop 수신자(iPad) 링 프로그레스 0.85→2.05s, "보냄" 체크 2.3s~ |
| `tablet` | ~6.4s | 창 전체가 태블릿으로 전환. 굿노트 유사 2단 툴바 + PDF 페이지. 0.7~2.9s 형광펜 스윕(marker 툴 active), 3.1~4.1s 밑줄(pen 툴로 전환), ~4.4s부터 유지 후 `live`로 복귀 |

### 타이밍 상수 (`hero-mockup.js`)

- `CAPTURE_SECONDS = 8` — 캡처 단계. 1.6s마다 자막 1줄, 짝수 이벤트마다 슬라이드 전환 (자막 5줄·슬라이드 3장)
- `NOTE_HOLD_MS = 2000` — 노트 완성 후 공유 단계 진입까지
- `SHARE_SECONDS = 2.8` — 공유 시트 전체
- `TABLET_SECONDS = 6.4` — 태블릿 장면 전체
- 노트 스트리밍은 `generateNoteTick`에서 24ms마다 10자씩 진행 (약 2.3s)

## 구조

- **패널 단계**(`stage` 변수): `live`/`done` — `demo-panel.html` iframe 안에서 `showStage()`가 `#stageLive`/`#stageDone`을 전환
- **부모 오버레이 단계**: `share`/`tablet` — `mock.dataset.state`로 CSS가 `.share-sheet`/`.tablet-scene` 표시를 제어. `stage` 변수도 같은 값을 가지며 `phaseTimer`(50ms interval)가 `phaseElapsed`를 진행
- `share` 진입 후 첫 0.45s는 `dataset.state`가 `done`을 유지해 PDF 버튼 눌림이 보임

### 태블릿 필기 좌표

- `.pdf-doc` 안의 `.hl-target`(`언제 받는지에 따라 가치가 달라집니다.`)이 하이라이트 대상. `<br>`로 한 줄 고정
- `measureTablet()`이 `offsetLeft/Top/Width/Height`를 읽어 `.tablet-ink` SVG의 `.hl`(rect), `.ul`(path), `.tablet-pen` 위치를 계산
- `.tablet-ink`는 viewBox 없이 inset:0이라 사용자 단위 = px = offset 좌표계
- `.pdf-wrap`이 `position:relative`라 hl-target의 offsetParent 역할
- `.pdf-doc`은 `width:100%; min-height:100%`(최대 640px)로 워크스페이스를 채우는 한 페이지. 내용이 아래로 잘리는 건 의도 — 실제 노트앱처럼 문서가 이어지는 연출. 표 3행까지는 반드시 보이도록 세로 간격을 조여 둠(복습 질문은 아래로 잘림)
- 모바일(≤760px)에서는 `.tablet-workspace`가 `overflow-y:auto`의 스크롤 영역(`tabindex=0`, `role=region`, "요약 노트 · 스크롤 가능")이라 전체 문서에 접근 가능. `.pdf-wrap`은 `height:auto`로 문서 높이를 따라가 `.tablet-ink`가 전체 문서를 같은 좌표계로 덮고, `measureTablet()` 진입 시 `scrollTop=0`으로 리셋 — 스크롤 중에는 사용자가 문서를 읽는 상태라 잉크 좌표 보정 불필요

## 제어

- **일시정지**(`.lec-play-toggle`), 탭 숨김, 뷰포트 이탈: `updatePlayback()`이 `phaseTimer` 포함 전 interval 정리/재개
- **prefers-reduced-motion**: `staticTabletSequence()` — 연출 없이 공유 완료 상태(1.4s) → 태블릿 완료 상태를 정적으로 보여 주고 정지(루프 없음)
- **복사 버튼** 클릭 시 자동 일시정지 → 공유 단계 진행도 멈춤

## 결합 주의

- 데모 노트(`hero-mockup.js`의 `note`)는 실제 제품의 "노트 서식 미리보기" 양식을 따른다: ⚠ 근거 경고 → 핵심 결론 → `N 구간 · 제목 ⭐`(슬라이드 제목/강의자 설명/개념 카드/표) → 복습 질문. 태블릿 `.pdf-doc`도 같은 양식의 조각이라 함께 맞춰 둔다

- `demo-panel.html`의 `export-row` 스타일은 파일 내 `<style>`에만 있음 — `product-panel.css`는 실제 제품과 공유라 건드리지 않음
- 실제 제품 `sidepanel.html`의 export-row는 "📄 PDF 출력"/"📝 노션으로 복사" 2버튼 — 데모도 동일 구성이나 둘 다 disabled 상태에서 PDF만 시연 중 활성
- 갱신 자산의 `?v=` 쿼리는 `index.html`/`hero-mockup.html` 양쪽에서 함께 범프
