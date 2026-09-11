# memory.md

코드만 봐서는 드러나지 않는 결합을 기억하기 위한 메모.

## 제품 패널과 랜딩 체험

- `sidepanel.html`과 `landing/demo-panel.html`은 `landing/product-panel.css`를 공유한다. 이 CSS의 제품 패널 규칙은 두 화면에 함께 영향을 준다.
- 제품은 `landing/vendor/markdown-it.min.js`와 `landing/note-viewer.js`를 직접 로드한다. 랜딩의 부모 문서(`landing/index.html`, `hero-mockup.html`)도 두 파일을 로드하고, 같은 출처의 `demo-panel.html` iframe 문서에 `NoteViewer`를 연결해 조작한다.
- 데모 iframe은 `sandbox="allow-same-origin"`이라 내부 스크립트는 실행되지 않는다. 부모의 `hero-mockup.js`가 `contentDocument`를 통해 준비된 체험을 제어한다.
- `#result` textarea가 메모리 내 canonical Markdown을 보존하고, `#notePreview`가 안전하게 렌더링된 HTML을 표시한다. 읽기·편집·복사·다운로드와 요약/타임라인 전환은 이 Markdown을 기준으로 동작한다.
- `hero-mockup.js`는 실제 캡처나 녹음 없이 직접 작성한 샘플과 스트리밍 연출을 제공한다. `landing/index.html`의 메인 figure와 `hero-mockup.html`의 standalone figure는 동작·마크업 parity를 유지한다.
- 갱신된 랜딩 자산의 `src`에는 버전 쿼리를 붙인다. `landing/hero-mockup.css`는 브라우저와 강의 화면 레이아웃을 맡고, 제품 패널 스타일은 `product-panel.css`가 맡는다.

## 왼쪽 강의 화면

왼쪽 슬라이드는 사용자 제공 금융 슬라이드 레퍼런스를 바탕으로 재구성한 작성 HTML이다. 실제 녹화·강의 캡처는 추가하지 않는다.
