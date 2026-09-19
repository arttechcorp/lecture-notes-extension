# Chrome Web Store Listing — Summrizei (강의 노트)

> Last Updated: 2026-09-19 (manifest v0.2.0 기준 실제 구현 상태로 정정)

> ⚠️ **이 문서는 현재 코드가 실제로 하는 일만 적는다.** 예정 기능은 스토어 설명에 쓰지 않는다.
> 설명과 동작이 다르면 Chrome Web Store는 기능 불일치로 거절한다.

이 문서는 Chrome 웹 스토어(Chrome Web Store) 개발자 대시보드 등록 및 심사 제출을 위한 메타데이터 단일 기준(Single Source of Truth) 문서입니다. 스토어 등록 시 각 항목을 그대로 복사하여 입력할 수 있습니다.

---

## 1. Store Listing (스토어 기본 정보)

**Extension Name** [REQUIRED]  
`Summrizei — 강의 노트`  
*(영문 스토어: `Summrizei — AI Lecture Notes & Summarizer`)*

**Short Description** [REQUIRED] (최대 132자)  
`재생 중인 영상의 화면과 음성을 기기 안에서 인식해 강의 타임라인을 만들고, 원하면 AI 요약 노트로 정리합니다.`

**Detailed Description** [REQUIRED] (스토어 본문 설명)  
```text
강의 영상을 보면서 일일이 멈추고 필기하느라 지치셨나요?
Summrizei는 강의를 시청하는 동안 화면의 슬라이드와 강사의 음성을 기기 안에서 인식해 시간순 강의 기록을 만들고, 이를 구조화된 학습 노트로 정리해 주는 사이드패널 확장 프로그램입니다.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✨ 주요 핵심 기능
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. 사이드패널 실시간 인식
- 영상을 가리지 않는 Chrome 사이드패널에서 강의 흐름을 방해하지 않고 동작합니다.
- 화면의 슬라이드 변화(OCR)와 음성(Speech)을 동시에 감지하여 중요한 내용을 놓치지 않습니다.

2. 기기 안에서 끝나는 인식 (무료)
- 화면 글자 인식은 PP-OCRv5 모델이, 음성 인식은 Whisper 모델이 브라우저 안에서 직접 실행합니다.
- 화면 이미지와 오디오는 기기 밖으로 나가지 않으며, 인식된 강의 타임라인은 API 키 없이 무료로 확인하고 저장할 수 있습니다.

3. AI 요약 노트 (개인 API 키 필요)
- 요약 노트가 필요하면 본인의 OpenRouter API 키를 설정에 입력해 연결합니다.
- 단순 요약이 아닌 대제목, 소제목, 글머리 기호, 핵심 비교 표(Table)로 체계화된 노트를 만듭니다.
- 공학/수학/경영 공식(LaTeX) 및 프로세스/의사결정 트리 다이어그램까지 지원합니다.
- 요약 단계에서는 인식된 '텍스트'만 전송됩니다. 화면 이미지와 오디오는 전송하지 않습니다.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚀 시작하는 방법
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. Chrome 웹 스토어에서 [Chrome에 추가]를 클릭합니다.
2. 브라우저 우측 상단의 Summrizei 아이콘을 클릭하여 사이드패널을 엽니다.
3. [캡처 시작]을 누르고 평소처럼 강의를 들은 뒤, 강의가 끝나면 [캡처 종료]를 누르면 강의 기록이 정리됩니다.
4. AI 요약 노트를 쓰려면 설정에서 OpenRouter API 키를 연결하세요.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔒 개인정보 보호 원칙
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Memory Only: 캡처된 화면 프레임과 오디오는 브라우저 메모리 안에서만 처리되며 디스크나 외부 서버에 저장되지 않습니다.
- 확장이 저장하는 것은 설정값뿐입니다. 강의 원문, 이미지, 노트는 저장하지 않습니다.
- 요약을 위한 텍스트 전송은 사용자가 API 키를 연결하고 동의한 경우에만 일어납니다. HTTPS로 전송되지만, 모델이 추론 중 텍스트를 보게 되므로 종단간 암호화가 아닙니다.
- 제3자에게 데이터를 판매하거나 광고 목적으로 수집하지 않습니다.
- 웹폰트를 포함한 모든 리소스를 확장 안에 번들했습니다. 패널을 열 때 외부 CDN을 호출하지 않습니다.

문의 및 피드백: support@summrizei.com
```

> 📌 **삭제된 문구 기록**: 이전 판에는 "100% 무료 온디바이스 Gemini Nano 요약"이 기능 3번으로 적혀 있었다.
> 온디바이스 요약을 구현한 `lib/ai.js`는 현재 어떤 런타임 페이지에서도 로드되지 않고 배포 ZIP에도 포함되지 않는다.
> (`sidepanel.html`·`offscreen.html`·`options.html`의 `<script>` 목록에 없으며 참조는 테스트 파일뿐이다.)
> 실제 요약 경로는 `lib/summary.js`가 OpenRouter API 키 또는 서비스 URL을 요구한다.
> **이 기능을 실제로 연결하기 전까지 스토어 설명에 온디바이스 요약을 다시 넣지 말 것.**

**Category** [REQUIRED]  
`Productivity` (생산성)

**Single Purpose** [REQUIRED] (단일 목적 선언)  
`재생 중인 영상 강의의 화면 텍스트와 음성을 인식하여 학습 노트를 자동 생성합니다.`

**Primary Language** [REQUIRED]  
`한국어 (Korean)`

---

## 2. Graphics & Assets (스토어 이미지 규격 및 체크리스트)

| 자산 항목 | 권장/필수 규격 | 파일 위치 / 상태 | 설명 |
|---|---|---|---|
| **스토어 아이콘 [필수]** | 128×128 PNG | `icons/icon128.png` ✅ | 투명 배경 없는 고해상도 앱 아이콘 |
| **스크린샷 1 [필수]** | 1280×800 (또는 640×400) PNG | `store-assets/screenshot-1-live.png` ⬜ | 영상 옆 사이드패널에서 실시간 캡처 중인 모습 |
| **스크린샷 2 [권장]** | 1280×800 PNG | `store-assets/screenshot-2-note.png` ⬜ | 완성된 노트 (구조화된 요약, 표, 수식 렌더링) |
| **스크린샷 3 [권장]** | 1280×800 PNG | `store-assets/screenshot-3-notion-pdf.png` ⬜ | 원클릭 노션 복사 및 PDF 인쇄 기능 |
| **스크린샷 4 [권장]** | 1280×800 PNG | `store-assets/screenshot-4-privacy-local.png` ⬜ | 화면·음성 인식이 기기 안에서 처리된다는 안내 (요약은 개인 API 키 연결 시) |
| **소형 프로모션 타일 [권장]** | 440×280 PNG | `store-assets/promo-small-440x280.png` ⬜ | 스토어 추천 탭 노출용 그래픽 배너 |
| **대형 프로모션 타일 [선택]** | 1400×560 PNG | `store-assets/promo-marquee-1400x560.png` ⬜ | 스토어 메인 상단 마키 배너 |

> ⚠️ **스크린샷이 0장이면 제출 자체가 불가능합니다.** `store-assets/` 디렉터리가 아직 없습니다.
> 최소 1280×800 스크린샷 1장을 만들어야 심사를 시작할 수 있습니다.

**웹폰트**: Hedvig Letters Serif와 Geist Mono는 `lib/vendor/fonts/`에 번들되어 있습니다(SIL OFL 1.1).
확장 페이지는 `fonts.googleapis.com`을 호출하지 않습니다. 본문 한글은 시스템 폰트 스택이 처리합니다.

---

## 3. Permissions Justification (권한 소명서)
> ⚠️ **중요**: Chrome Web Store 심사관이 가장 꼼꼼하게 검토하는 영역입니다. 단순 "기능 수행을 위해 필요"라고 적으면 거절됩니다. 아래 소명 내용을 그대로 대시보드 폼에 입력하세요.

| 권한 (Permission) | 유형 | CWS 심사 소명 사유 (영문 & 국문) |
|---|---|---|
| `storage` | permissions | 사용자의 요약 환경설정(테마, 선택한 요약 양식, OCR 엔진 설정 등)을 로컬에 기억하기 위해 사용됩니다. 강의 원문이나 텍스트는 저장소에 저장되지 않습니다. *(Stores user UI preferences such as theme, selected summary template, and engine options. No lecture content or plaintext audio/video data is persisted.)* |
| `sidePanel` | permissions | 영상 시청을 방해하지 않고 브라우저 우측 사이드패널에서 실시간 인식 현황과 완성된 노트를 확인할 수 있는 전용 작업 환경을 제공하기 위해 필요합니다. *(Provides a persistent side panel workspace for users to view real-time recognition progress and generated lecture notes without obstructing the video playback.)* |
| `scripting` | permissions | 사용자가 명시적으로 [캡처 시작]을 클릭했을 때, 해당 영상 재생 탭에 비디오 화면 프레임 분석 스크립트(`content.js`)를 동적으로 주입하기 위해 필요합니다. *(Used to programmatically inject the content capture script into the active lecture video tab when the user explicitly clicks the start button.)* |
| `tabs` | permissions | 영상 시청 탭의 제목(Title)을 읽어 학습 노트 제목으로 자동 지정하고, 사용자가 캡처 중인 대상 탭의 재생 상태를 추적하기 위해 필요합니다. *(Used to retrieve the video tab's title to automatically name the lecture notes and monitor the lifecycle of the tab being recorded.)* |
| `tabCapture` | permissions | 사용자가 명시적으로 녹화를 시작한 강의 탭의 내부 오디오 스트림을 캡처하여 브라우저 로컬에서 음성 인식을 수행하기 위해 필요합니다. *(Required to capture the internal audio stream of the lecture tab explicitly selected by the user for on-device local speech-to-text processing.)* |
| `offscreen` | permissions | Manifest V3 Service Worker에서 직접 접근할 수 없는 WebGPU 가속 및 AudioWorklet 기반 로컬 음성 인식(Whisper) 워커를 백그라운드 오프스크린 문서에서 격리 실행하기 위해 필요합니다. *(Required to execute WebGPU-accelerated and AudioWorklet-based local speech recognition (Whisper) workers in an isolated offscreen document, which is inaccessible directly from the MV3 Service Worker.)* |
| `activeTab` | permissions | 단축키(Alt+Shift+S) 또는 확장 프로그램 아이콘 클릭 시, 사용자가 현재 보고 있는 강의 탭에 대한 최소한의 임시 권한을 부여받아 즉각적인 캡처 패널을 활성화하기 위해 필요합니다. *(Granted temporarily when the user clicks the action icon or presses the shortcut (Alt+Shift+S) to interact with the active educational video tab.)* |
| `<all_urls>` | host_permissions | 사용자는 YouTube, Coursera, 대학 온라인 LMS, 웨비나 등 다양한 웹사이트에서 강의를 수강합니다. Manifest V3 사이드패널 UI의 버튼 클릭은 브라우저 보안 규격상 `activeTab` 권한을 임시 승계받지 못하므로, 사용자가 선택한 임의의 강의 페이지에 캡처 스크립트를 주입하기 위해 광범위한 호스트 권한이 기술적으로 불가피합니다. 캡처는 사용자가 [캡처 시작]을 누른 탭에서만 동작합니다. *(Users attend lectures on various educational platforms (YouTube, Coursera, university LMS, webinars). Under Manifest V3, side panel interactions do not inherit activeTab privileges; hence host permissions are technically required to inject capture scripts into user-selected educational sites. Capture is strictly confined to user-initiated sessions.)* |
| `https://huggingface.co/*`<br>`https://*.hf.co/*`<br>`https://cdn-lfs.huggingface.co/*` | host_permissions | 외부 서버로 음성을 유출하지 않고 기기 내부에서 100% 로컬로 음성을 인식하기 위해, 오픈소스 Whisper ONNX 모델 가중치 바이너리를 브라우저 캐시로 다운로드하는 데 사용됩니다. *(Required to download open-source Whisper ONNX speech recognition model weights to the browser cache for 100% local, privacy-safe on-device audio transcription.)* |
| `https://openrouter.ai/*` | host_permissions | AI 요약은 선택 기능이며, 사용자가 설정에서 본인의 OpenRouter API 키를 직접 입력하고 동의한 경우에만 동작합니다. 이때 로컬에서 인식한 구조화 텍스트만 전송하며 화면 이미지·오디오는 전송하지 않습니다. 확장에는 운영자 API 키가 포함되어 있지 않습니다. *(Optional feature. Active only after the user enters their own OpenRouter API key in settings and consents. Only locally recognized structured text is sent; screen images and audio are never sent. No operator API key ships inside the extension.)* |

---

## 4. Privacy & Compliance (개인정보 및 규정 준수 체크)

### Data Use Disclosures (데이터 사용 공개 선언)
- **개인 식별 정보(PII)**: 수집 안 함 (`No`)
- **위치 정보**: 수집 안 함 (`No`)
- **금융 및 결제 정보**: 수집 안 함 (`No`)
- **웹 브라우징 기록**: 수집 안 함 (`No`)
- **사용자 활동(키 입력 등)**: 수집 안 함 (`No`)
- **웹사이트 콘텐츠**: 사용자가 캡처를 승인한 비디오 탭의 화면/음성 텍스트만 메모리에서 처리함 (`Yes` - 처리 목적: 강의 노트 요약 생성, 외부 서버 영구 저장 없음)

### Data Use Certification (데이터 사용 보증 확인)
- [x] 사용자 데이터를 제3자에게 판매하지 않음 (Not sold to third parties)
- [x] 확장 프로그램의 핵심 기능과 무관한 목적으로 데이터를 사용하지 않음
- [x] 신용 평가 또는 대출 목적으로 데이터를 사용하지 않음

### Privacy Policy URL (개인정보처리방침)
`https://<도메인 또는 GitHub Pages 주소>/landing/policies/privacy.html`

> ⚠️ **미해결 차단 항목**: 아직 플레이스홀더입니다. 실제 공개 URL이 있어야 심사가 시작됩니다.
> `landing/policies/privacy.html`을 배포한 뒤 그 URL로 교체하세요.

---

## 5. Pre-Packaging Checklist (스토어 배포 빌드 시 필수 점검)

- [ ] **보안 패키징 검증**: `node tools/package-cws.mjs` 실행 및 모든 보안 검사(시크릿 스캔, 불변식, 런타임 폐쇄, 단위 테스트) 통과 확인.
- [ ] **무결성 체크섬 확인**: `dist/summrizei-v<버전>-cws.sha256` 및 `dist/build-provenance.json` 생성 확인.
- [ ] **`apikey.env.local` 배제**: 개발용 로컬 키 파일이 ZIP에 절대 포함되지 않았는지 2차 확인.
- [ ] **테스트 파일 제외**: `lib/*.test.js`, `server/`, `tools/`, `docs/`, `.worktrees/` 배제 확인.
- [ ] **버전 번호 확정**: `manifest.json`이 현재 `0.2.0`입니다. 출시 버전으로 올린 뒤 이 문서와 맞추세요.
- [ ] **개인정보처리방침 URL 배포**: 위 4번의 플레이스홀더를 실제 공개 URL로 교체.
- [ ] **스토어 스크린샷 준비**: `store-assets/`에 최소 1280×800 1장.
- [ ] **심사관용 시연 동영상 준비**: `<all_urls>` 권한 소명을 위해 30초 분량의 사용 시연 영상(Unlisted YouTube) 링크 준비.

---

## 6. 제출 전 남은 차단 항목 (2026-09-19 기준)

| 상태 | 항목 | 비고 |
|---|---|---|
| ✅ 해결 | 배포 ZIP에 Whisper 워커 2종 누락 | `lib/session.js:157`의 삼항 연산자를 `tools/package-cws.mjs`의 `new Worker(...)` 정규식이 놓쳐 음성 인식이 패키지에서만 죽던 문제. `chrome.runtime.getURL(...)` 인자 스캐너를 추가하고, 필수 런타임 파일 누락 시 패키징이 실패하도록 바꿨다. |
| ✅ 해결 | 확장 페이지의 외부 Google Fonts 호출 | 폰트를 `lib/vendor/fonts/`에 번들. 패널을 열 때 사용자 IP가 외부로 나가지 않는다. |
| ✅ 해결 | 개발용 `lib/dev-chrome-mock.js`가 제품에 포함 | 파일과 `sidepanel.html`의 스크립트 태그를 제거했다. |
| ✅ 해결 | 스토어 설명의 온디바이스 요약 문구가 구현과 불일치 | 이 문서를 실제 구현(개인 OpenRouter 키 필요) 기준으로 정정했다. |
| ⬜ 남음 | 개인정보처리방침 URL이 플레이스홀더 | 실제 URL 배포 필요 |
| ⬜ 남음 | 스토어 스크린샷 0장 | 최소 1장 필요 |
| ⬜ 남음 | 버전 번호 미확정 | `manifest.json` = `0.2.0` |
| ⬜ 남음 | `<all_urls>` 소명용 시연 영상 | 3번 소명문과 함께 제출 |
| ℹ️ 결정 필요 | `lib/ai.js`(온디바이스 요약)가 연결되지 않은 채 저장소에 남아 있음 | 실제로 연결하거나 제거할지 결정. 연결한다면 스토어 설명에 해당 기능을 다시 추가할 수 있다. |
