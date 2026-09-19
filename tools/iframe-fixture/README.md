# iframe-fixture

`<video>` 감지 content script(all-frames)를 수동으로 검증하기 위한 self-contained 테스트 픽스처.
외부 네트워크/파일 없이 `canvas.captureStream()`으로 비디오 스트림을 자체 생성한다.

## 실행

```bash
./serve.sh        # 또는 bash serve.sh
```

- 8123 포트: 부모 페이지들
- 8124 포트: `frame.html` (cross-origin iframe 소스)
- 종료: Ctrl-C (또는 출력된 PID를 kill)

## 페이지

| URL | 시나리오 |
|---|---|
| `http://localhost:8123/parent.html` | cross-origin iframe 안에만 비디오 존재 |
| `http://localhost:8123/nested.html` | iframe 2단계 중첩 (8123 → 8123 → 8124) |
| `http://localhost:8123/shadow.html` | open shadow root 안의 비디오 |
| `http://localhost:8123/black.html` | 재생 중이지만 전부 검은 픽셀 |
| `http://localhost:8124/frame.html` | control: 최상위 프레임의 일반 비디오 |

## QA 체크리스트

- **(a) parent.html** — 확장이 cross-origin iframe 안의 비디오를 찾고, 올바른 crop 좌표(iframe 위치 반영)를 표시해야 함.
- **(b) nested.html** — "중첩 iframe은 지원하지 않습니다" 류의 명확한 미지원 에러로 실패해야 함 (hang/crash 금지).
- **(c) shadow.html** — shadow DOM 안의 비디오를 찾아야 함 (`document.querySelectorAll("video")`로는 안 잡힘 — shadowRoot 순회 필요).
- **(d) black.html** — 보호/검은 화면 에러로 중단(halt)해야 함. 무음 캡처 진행 금지.
- **(e) frame.html 직접 접속** — control 케이스: 최상위 비디오를 정상 감지·캡처해야 함.

## 참고

- 모든 페이지의 비디오는 `videoWidth > 0`, 재생 중, muted+autoplay 상태여야 한다. (black.html 제외하고 검은 화면이면 안 됨)
- `frame.html`의 캔버스는 프레임 카운터+타임스탬프를 그려 OCR 변경 감지가 항상 새 픽셀을 볼 수 있게 한다.
