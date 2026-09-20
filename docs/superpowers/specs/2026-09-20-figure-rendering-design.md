# 강의 그림 자료 재구성 — 설계

작성일 2026-09-20 · 상태: 승인 대기

## 1. 무엇을 만드는가

강의 캡처 근거로부터 회로도·그래프·과학 도식 같은 **그림 자료**를 노트에 넣는다.
지금은 `visuals[]`가 표(마크다운)와 관계도(mermaid flowchart) 두 가지만 낼 수 있고,
슬라이드에 있던 그림은 노트에서 사라진다.

범위는 과목을 가리지 않는다 — 회로, 수학·경제 그래프, 에너지 밴드도, 결정구조,
자유물체도까지. 이 "모든 과목" 요구가 설계 전체를 결정한다.

## 2. 왜 DSL 하나로는 안 되는가

전용 DSL은 미리 적어둔 심볼과 원시요소만 그린다. 회로·그래프·밴드도를 넣으면
다음엔 유기화학 구조식과 공정도가 온다. 과목 목록은 끝나지 않고, 그때마다
렌더러에 코드가 붙는다. 이 프로젝트에서 무한한 표현력을 가진 것은 **SVG 하나뿐**이다.

그래서 두 기구를 쓴다. 계산이 의미를 바꾸는 곳만 DSL이 책임지고, 나머지 전부는
모델이 그린 SVG를 받는다. 흐름도는 지금처럼 mermaid가 계속 맡는다.

## 3. 근거 — 모델은 이미 SVG를 그린다

`electric_circuits_note_example/`의 7개 모델 출력 21개 SVG 전수 감사:

| 항목 | 결과 |
| --- | --- |
| `viewBox` 보유 | 21/21 (100%) |
| 허용 목록 밖 태그 | 4개 (qwen3.5 한 파일에 몰림) |
| 하드코딩 hex 색상 | 약 724개 |
| 크기 (문자) | 최소 832 · 중앙값 3,947 · 최대 7,290 |

제일 싼 모델(gemini-3.1-flash-lite, 6.9초)도 2개를 구조적으로 멀쩡하게 그렸다.
**구조는 문제가 아니다. 색이 문제다** — 전부 다크 배경을 자체적으로 박아둔다.

크기 중앙값 3,947자는 `lib/summary.js`의 기존 `data` 상한 12,000자 안에 들어간다.
스키마 상한은 손대지 않는다.

## 4. 단계

- **1단계 — sanitizer만.** 모델 SVG를 받아 안전하게 만들고 테마에 맞춘다.
  이것만으로 모든 과목의 그림이 노트에 들어오기 시작한다.
- **2단계 — 1단계의 실패를 측정한 뒤** 그 실패가 몰린 종류부터 DSL 원시요소를 붙인다.

2단계 심볼 테이블은 추측이 아니라 5절의 실측 목록으로 정한다. 1단계를 건너뛰면
어떤 그림이 실제로 틀리는지 모르는 채로 렌더러를 짓게 된다.

본 스펙의 구현 범위는 1단계다.

## 5. 1단계 설계

### 5.1 결합점

```
모델 → visuals[{ type: "figure", data: "<svg…>" }]
        ↓ lib/summary.js       스키마 검증 (기존 경로, 상한 변경 없음)
        ↓ sidepanel.js         noteText() — 마크다운에 그대로 삽입
        ↓ sandbox.html         renderMarkdown() — 추출 → sanitize → 주입
             ↑ lib/svg-figure.js   ← 유일한 신규 파일
```

`lib/svg-figure.js`는 `lib/summary.js`의 기존 패턴(IIFE + `module.exports` +
`globalThis`)을 따른다. sandbox가 classic script로 싣고 node 테스트가 `require`로 집는다.

**ES 모듈은 쓸 수 없다.** `sidepanel.html`의 `renderFrame`은
`sandbox="allow-scripts allow-forms allow-popups allow-modals"`로, `allow-same-origin`이
없다. opaque origin에서는 모듈 fetch가 막힌다. 기존 vendor 스크립트가 전부 classic인 이유다.

### 5.2 계약

`visuals[].type` enum에 `"figure"`를 추가한다. `data`에 인라인 SVG.

함께 `visuals[].inferred`(boolean)를 추가한다. 근거에 없는 연결을 도메인 상식으로
메운 그림이면 모델이 `true`로 표시하고, `sidepanel.js`의 `noteText()`가 설명 앞에
`*(강의 화면에 없던 연결은 표준 구성으로 채웠습니다)*` 한 줄을 붙인다. 이탤릭 마크다운
한 줄이라 새 CSS가 필요 없고, canonical 마크다운을 타고 노션 복사본과 PDF에도 따라간다.
`lib/summary.js`의 검증에 boolean 확인 한 줄이 는다.

프롬프트는 `viewBox` 필수만 요구한다. **색상 지시는 하지 않는다.** 모델이 이런
형식 지시를 지키지 않는다는 것은 이미 실측돼 있다(mermaid 펜스 누락 78~95%,
`tools/diagram-violation-probe.mjs`). 색은 전부 sanitizer가 빼앗는다.

기존 `relationship`·`table`·`chart`는 그대로 둔다. 이 스펙은 타입을 하나 더할 뿐이다.

### 5.3 sanitizer — 신뢰 경계

`sandbox.html`의 `renderMarkdown()`은 marked 출력을 `target.innerHTML`에 그대로 넣고,
marked는 HTML을 거르지 않는다. **SVG를 허용하는 순간 주입 표면이 열린다.**

피해 범위:

- `renderFrame`에 `allow-same-origin`이 없어 주입된 코드는 `chrome.*`, 확장 스토리지,
  부모 DOM에 닿지 못한다.
- 그러나 `manifest.json`의 CSP에 `connect-src`가 없다. `<svg onload>` 안의 `fetch()`는
  외부로 나간다 → **AGENTS.md의 "원문을 외부로 보내지 않는다" 불변식을 깰 수 있다.**
  여기가 실제 위험이며 타협하지 않는다.

정규식 sanitizing은 하지 않는다. `DOMParser("image/svg+xml")`로 파싱하고 트리를 순회해
허용 목록 밖을 잘라낸 뒤 재직렬화한다. 파싱 실패 시 그림을 버리고 `description`만 남긴다.

- **태그 허용**: `svg g rect circle ellipse line polyline polygon path text tspan defs
  marker linearGradient stop title desc`
- **전량 차단**: `script foreignObject image a use animate*` 및 `style` 요소.
  `use`는 외부 참조 경로라 함께 자른다.
- **속성**: 기본 거부(deny-by-default). 허용 목록은 `lib/svg-figure.js`에 열거하고,
  목록에 없는 속성은 이름을 보지 않고 전부 버린다. 이 성질이 핵심이다 — 차단 목록
  방식이면 새 이벤트 핸들러 속성이 생길 때마다 구멍이 난다. 허용하는 것은 기하
  (`x y width height cx cy r rx ry x1 y1 x2 y2 d points transform viewBox`)와 표현
  (`fill stroke stroke-width stroke-dasharray stroke-linecap opacity fill-opacity
  text-anchor dominant-baseline font-size font-weight font-family`) 뿐이다.
  `on*`, `href`, `xlink:*`, `style`은 목록에 없으므로 자동으로 걸러진다.
- **루트 정규화**: `viewBox`는 보존하고, `width`/`height`는 `width="100%"`로 고쳐 쓴다.
  패널 폭이 좁아도 그림이 넘치지 않게 하기 위함이며, 원본 픽셀 크기는 버린다.

### 5.4 색 — 면적으로 전경과 배경을 가른다

sanitizer가 색을 결정한다:

1. **viewBox 면적의 90% 이상을 덮는 도형의 `fill`을 제거한다.** 자체 배경판이 사라지고
   `--paper-card`가 비친다. 코퍼스의 `<rect width="100%" height="100%" fill="#0f172a"/>`
   패턴이 여기 걸린다.
2. **`<text>`의 `fill`은 무조건 `--ink`.** 가독성은 슬롯 순환에서 제외한다.
3. **나머지 서로 다른 색은 등장 순서로 4슬롯 순환**: `--ink` → `--brand` → `--ash` → `--faint`.
   "등장 순서"는 문서 순회 순서로 처음 만난 서로 다른 색 값을 뜻하며, `fill`과 `stroke`는
   같은 표를 공유한다(같은 색이면 같은 슬롯). 5번째부터는 처음으로 돌아가 순환한다.
   대소문자와 `#abc`/`#aabbcc` 축약형은 정규화해 같은 색으로 센다.

절대 색조는 보존되지 않는다(원본의 빨강이 빨강으로 남지 않는다). 대신 **색으로
구분하던 것은 계속 구분되고**, 그림이 노트 디자인 안으로 들어온다. 인쇄는
`sandbox.html`의 `--print-*` 토큰이 같은 자리를 덮어써서 따라온다.

토큰은 `landing/product-panel.css`가 라이트·다크 양쪽에 정의한 실재 이름이다.

### 5.5 그림 상자

sanitize된 SVG는 `.note-figure` 래퍼에 담는다. 규칙은 **`landing/product-panel.css`에
둔다** — 노트 타이포그래피의 단일 원천이 그 파일이고, `sandbox.html`의 `<style>`에는
렌더러 전용 상자와 인쇄 규칙만 두는 것이 기존 규약이다(`memory.md`).

인쇄에는 `page-break-inside: avoid`가 필요하다. 그림이 페이지 경계에서 반으로
잘리는 것을 막는 유일한 수단이며, 기존 `.mermaid-box`가 같은 처리를 받고 있다.

## 6. 측정 — 2단계 착수 조건

`tools/svg-figure-probe.html`에 코퍼스 21개를 싣는다. **HTTP로 띄운다** —
`file://`로 열면 vendor 라이브러리가 붙지 않아 전부 FAIL로 나온다
(`tools/mermaid-render-probe.html`과 같은 함정).

| 지표 | 2단계 트리거 |
| --- | --- |
| 파싱 실패율 | 높으면 sanitizer 설계 재검토 |
| 잘려나간 태그·속성 | 허용 목록 조정 근거 |
| 축·눈금이 있는데 간격이 어긋난 그림 | 많으면 `plot` DSL을 먼저 |
| 회로 심볼이 뭉개진 그림 | 많으면 `circuit` DSL을 먼저 |

## 7. 테스트

- **node**: 순수 정책 함수(`allowTag` / `allowAttr` / `mapColor` / 배경 면적 판정)에만 붙인다.
  node에 `DOMParser`가 없고 jsdom은 새 의존성이라 들이지 않는다.
- **브라우저**: DOM 순회와 실제 렌더는 `tools/svg-figure-probe.html`이 검증한다.
- 기존 `node --test lib/*.test.js`는 계속 통과해야 한다.

## 8. 알려진 천장

- **노션 붙여넣기에 그림은 따라가지 않는다.** canonical 마크다운에 raw SVG가 들어가지만
  노션은 이를 받지 않는다. 읽기 탭과 PDF에서만 보인다.
- **절대 색조는 보존되지 않는다** (5.4).
- **보간된 그림은 틀릴 수 있다.** 근거에 없는 연결을 표준 구성으로 메우는 것을 허용하기로
  했고, 노트에는 그 사실을 이탤릭 한 줄로 표시한다. 이는 경고이지 정확성 보장이 아니다.
  첫 배포 전에 `electric_circuits_note_example`의 코퍼스로 눈 검증을 한 번 거친다.
- **1단계는 기하를 검증하지 않는다.** 모델이 그린 축 간격이나 회로 배선이 그럴듯하게
  틀려도 sanitizer는 잡지 못한다. 그것이 2단계의 존재 이유다.

## 9. 이 스펙이 하지 않는 것

- mermaid를 대체하지 않는다. 흐름도·관계도는 계속 mermaid가 그린다.
- 자동 레이아웃 엔진을 만들지 않는다. 2단계의 DSL도 모델이 격자 좌표를 지정하고
  우리는 심볼을 찍고 직교 배선만 잇는다.
- 기존 `table` / `chart` / `relationship` 타입의 동작을 바꾸지 않는다.
