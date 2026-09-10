# memory.md

코드만 봐서는 드러나지 않는 결합을 기억하기 위한 메모.

## 랜딩 히어로 목업 ↔ 제품 사이드패널

`sidepanel.html`의 `#stageLive`(캡처 중) 단계를 랜딩 히어로의 브라우저 목업 오른쪽 40% 패널이 **손으로 베껴 재현**한다. 참조가 아니라 복사본이라, 제품 UI를 고쳐도 목업은 자동으로 따라오지 않는다.

- 원본: `sidepanel.html` — `:root` 토큰, `.pill.live` / `.pulse`, `.counters` / `.counter`, `.feed`, `button.danger`, `<footer>`
- 사본: `landing/hero-mockup.css`의 `.panel*` 규칙과 `landing/hero-mockup.html`의 `<aside class="panel">` 마크업. 연출은 `landing/hero-mockup.js`.

### 제품 디자인을 바꿀 때 확인할 것

목업 쪽은 토큰 이름에 `--p-` 접두어를 붙여 복사해 뒀다 (`hero-mockup.css` `.panel`).

| 바꾼 것 | 목업에서 같이 고칠 곳 |
| --- | --- |
| `--paper #fff` / `--ground #f3f3f2` / `--ink #181818` / `--ash #666` / `--rule #e4e4e4` | `.panel`의 `--p-paper/--p-ground/--p-ink/--p-ash/--p-rule` (값이 하드코딩돼 있음) |
| `--faint #767676` | `.panel-feed-head`의 `color: #767676` |
| `--lift-1` | `.panel`의 `--p-lift` |
| `--r-md 10px` | `.panel-counter`의 `border-radius: 10px` |
| `--r-lg 14px` | `.panel-feed`의 `border-radius: 14px` |
| pill 반경 100px (`.pill`, `button.primary/.danger`) | `.panel-pill`, `.panel-stop`의 `border-radius: 100px` |
| `.pill.live` (ink 배경 + `.pulse` 1.4s 깜빡임) | `.panel-pill` + `.panel-pulse` / `@keyframes panel-blink` |
| 카운터 3개 구성·라벨: 슬라이드 / 음성 줄 / 처리 대기 (`#cntSlides`·`#cntVoice`·`#cntQueue`, 3열 그리드) | `.panel-counters`의 `.panel-counter` 3개. 개수·순서·라벨 문구 전부 일치시킬 것 |
| `.feed` 헤더 문구 "지금 인식 중" / "최근 3줄" | `.panel-feed-head`의 두 `<span>` |
| 피드 줄 구조 (`#feedLines div`, 마지막 줄만 `--ink`) | `.feed-line`(`<time>` + `<p>`). 목업은 3줄 고정이고 `hero-mockup.js`가 줄을 쌓는다 |
| `button.danger` 문구 "캡처 마치고 노트 보기" + 스타일(paper 배경, `1.5px solid var(--ink)`, 굵기 600) | `.panel-stop` (문구는 `hero-mockup.html`) |
| 푸터 `#planName` "무료 플랜" / `#planUse` "기기 안에서 처리" + 상단 1px rule 구분선 | `.panel-foot` 두 `<span>` |
| 상태줄 경과 시간 `#elapsed` | `.panel-elapsed` (목업은 `12:07` 고정) |

주의: `sidepanel.html`은 `prefers-color-scheme: dark`에서 토큰을 뒤집지만, 목업 `.panel`은 **라이트 값만 하드코딩**돼 있다. 제품의 다크 팔레트를 바꿔도 목업은 영향받지 않는다 — 의도된 것이며, 랜딩에 다크를 넣게 되면 이 표의 첫 줄부터 다시 판단할 것.

목업에 없는 것(경고 배너 `#panelAlert`, `.stage-steps` 등)은 일부러 뺐다. 굳이 채워 넣지 말 것.

## 왼쪽 강의 화면

가상의 플랫폼 **LetsLearn**(`letslearn.org`)이다. 실제 강의 캡처·실제 대학교명·실제 LMS 브랜드는 절대 넣지 않는다 — 저작권과 비대체성 원칙(AGENTS.md §2)의 연장이다. 슬라이드 내용도 전부 창작이다.

## 애셋

목업은 전부 CSS로 그렸다. 이미지·아이콘 파일이 하나도 없으므로, 목업이 깨졌다면 원인은 항상 CSS다.
