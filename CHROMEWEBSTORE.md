# Chrome Web Store Listing — Summrizei (강의 노트)

> Last Updated: 2026-09-12

이 문서는 Chrome 웹 스토어(Chrome Web Store) 개발자 대시보드 등록 및 심사 제출을 위한 메타데이터 단일 기준(Single Source of Truth) 문서입니다. 스토어 등록 시 각 항목을 그대로 복사하여 입력할 수 있습니다.

---

## 1. Store Listing (스토어 기본 정보)

**Extension Name** [REQUIRED]  
`Summrizei — 강의 노트`  
*(영문 스토어: `Summrizei — AI Lecture Notes & Summarizer`)*

**Short Description** [REQUIRED] (최대 132자)  
`재생 중인 영상 화면과 음성에서 핵심 학습 노트를 생성합니다. 온디바이스 AI로 개인정보를 안전하게 보호합니다.`

**Detailed Description** [REQUIRED] (스토어 본문 설명)  
```text
강의 영상을 보면서 일일이 멈추고 필기하느라 지치셨나요?
Summrizei는 강의 영상을 시청하는 동안 화면의 슬라이드와 강사의 음성을 실시간으로 인식하여 구조화된 고품질 학습 노트를 자동으로 작성해 주는 스마트 사이드패널 확장 프로그램입니다.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✨ 주요 핵심 기능
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. 사이드패널 실시간 인식
- 영상을 가리지 않는 Chrome 사이드패널에서 강의 흐름을 방해하지 않고 동작합니다.
- 화면의 슬라이드 변화(OCR)와 음성(Speech)을 동시에 감지하여 중요한 내용을 놓치지 않습니다.

2. 완벽하게 구조화된 학습 노트
- 단순 요약이 아닌 대제목, 소제목, 글머리 기호, 핵심 비교 표(Table)로 체계화된 노트를 만듭니다.
- 공학/수학/경영 공식(LaTeX) 및 프로세스/의사결정 트리 다이어그램까지 지원합니다.

3. 100% 무료 & 개인정보 보호 온디바이스 요약 (Gemini Nano)
- Chrome 내장 온디바이스 AI(Gemini Nano)와 로컬 Whisper 모델을 활용하여 외부 서버 전송 없이 기기 내부에서 완전 무료로 노트를 생성할 수 있습니다.
- 민감한 사내 교육이나 비공개 강의도 안심하고 정리하세요.

4. 클라우드 고품질 요약 지원 (BYOK)
- 더 깊이 있는 학술 분석이 필요할 때 Anthropic Claude, Google Gemini, OpenRouter API 키를 직접 연결하여 최상급 모델로 노트를 제작할 수 있습니다.

5. 원클릭 노션(Notion) 복사 및 PDF 출력
- 완성된 노트를 클릭 한 번으로 노션에 붙여넣기(Ctrl+V) 가능한 블록 형태로 복사할 수 있습니다.
- 깔끔한 서식 그대로 A4 PDF 인쇄 및 저장을 지원합니다.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚀 사용 방법 (3단계)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. 유튜브, 온라인 강의, 웨비나 등 학습할 영상 탭을 엽니다.
2. 브라우저 우측 상단의 Summrizei 아이콘을 클릭하여 사이드패널을 엽니다.
3. [캡처 시작]을 누르고 평소처럼 강의를 들은 뒤, 강의가 끝나면 [캡처 종료]를 누르면 완성된 노트가 나타납니다!

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔒 철저한 개인정보 보호 원칙
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Memory Only: 캡처된 화면 프레임과 오디오는 브라우저 메모리 안에서만 일시적으로 처리되며 디스크나 외부 서버에 절대 저장되지 않습니다.
- 제3자에게 데이터를 판매하거나 광고 목적으로 수집하지 않습니다.
- 언제든 패널을 닫으면 캡처 원본 데이터는 메모리에서 완전히 소멸합니다.

문의 및 피드백: support@summrizei.com
```

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
| **스크린샷 4 [권장]** | 1280×800 PNG | `store-assets/screenshot-4-privacy-nano.png` ⬜ | 온디바이스 Gemini Nano 100% 무료/로컬 처리 안내 |
| **소형 프로모션 타일 [권장]** | 440×280 PNG | `store-assets/promo-small-440x280.png` ⬜ | 스토어 추천 탭 노출용 그래픽 배너 |
| **대형 프로모션 타일 [선택]** | 1400×560 PNG | `store-assets/promo-marquee-1400x560.png` ⬜ | 스토어 메인 상단 마키 배너 |

---

## 3. Permissions Justification (권한 소명서)
> ⚠️ **중요**: Chrome Web Store 심사관이 가장 꼼꼼하게 검토하는 영역입니다. 단순 "기능 수행을 위해 필요"라고 적으면 거절됩니다. 아래 소명 내용을 그대로 대시보드 폼에 입력하세요.

| 권한 (Permission) | 유형 | CWS 심사 소명 사유 (영문 & 국문) |
|---|---|---|
| `storage` | permissions | 사용자의 요약 환경설정(테마, 선택한 요약 양식, OCR 엔진 설정 등)을 로컬에 기억하기 위해 사용됩니다. 강의 원문이나 텍스트는 저장소에 저장되지 않습니다. *(Stores user UI preferences such as theme, selected summary template, and engine options. No lecture content or plaintext audio/video data is persisted.)* |
| `sidePanel` | permissions | 영상 시청을 방해하지 않고 브라우저 우측 사이드패널에서 실시간 인식 현황과 완성된 노트를 확인할 수 있는 전용 작업 환경을 제공하기 위해 필요합니다. *(Provides a persistent side panel workspace for users to view real-time recognition progress and generated lecture notes without obstructing the video playback.)* |
| `scripting` | permissions | 사용자가 명시적으로 [캡처 시작]을 클릭했을 때, 해당 영상 재생 탭에 비디오 화면 프레임 분석 및 오디오 수집 스크립트(`content.js`)를 동적으로 주입하기 위해 필요합니다. *(Used to programmatically inject the content capture script into the active lecture video tab when the user explicitly clicks the start button.)* |
| `tabs` | permissions | 영상 시청 탭의 제목(Title)을 읽어 학습 노트 제목으로 자동 지정하고, 사용자가 캡처 중인 대상 탭의 재생 상태를 추적하기 위해 필요합니다. *(Used to retrieve the video tab's title to automatically name the lecture notes and monitor the lifecycle of the tab being recorded.)* |
| `<all_urls>` | host_permissions | 사용자는 YouTube, Coursera, 대학 온라인 LMS, 웨비나 등 다양한 웹사이트에서 강의를 수강합니다. Manifest V3 사이드패널 UI의 버튼 클릭은 브라우저 보안 규격상 `activeTab` 권한을 임시 승계받지 못하므로, 사용자가 선택한 임의의 강의 페이지에 캡처 스크립트를 주입하기 위해 광범위한 호스트 권한이 기술적으로 불가피합니다. 캡처는 사용자가 [캡처 시작]을 누른 탭에서만 동작합니다. *(Users attend lectures on various educational platforms (YouTube, Coursera, university LMS, webinars). Under Manifest V3, side panel interactions do not inherit activeTab privileges; hence host permissions are technically required to inject capture scripts into user-selected educational sites. Capture is strictly confined to user-initiated sessions.)* |
| `https://huggingface.co/*`<br>`https://*.hf.co/*`<br>`https://cdn-lfs.huggingface.co/*` | host_permissions | 외부 서버로 음성을 유출하지 않고 기기 내부에서 100% 로컬로 음성을 인식하기 위해, 오픈소스 Whisper ONNX 모델 가중치 바이너리를 브라우저 캐시로 다운로드하는 데 사용됩니다. *(Required to download open-source Whisper ONNX speech recognition model weights to the browser cache for 100% local, privacy-safe on-device audio transcription.)* |
| `https://openrouter.ai/*`<br>`https://api.anthropic.com/*`<br>`https://generativelanguage.googleapis.com/*` | host_permissions | 사용자가 클라우드 AI 요약(Premium 플랜)을 선택하고 자신의 API 키(BYOK)를 입력한 경우, 선택한 제공자에게 구조화된 텍스트 요약을 요청하기 위해 사용됩니다. *(Required to send user-authorized text prompts to user-configured AI providers (OpenRouter, Anthropic Claude, Google Gemini) when the user opts for cloud-assisted summarization using their own API key.)* |

---

## 4. Privacy & Compliance (개인정보 및 규정 준수 체크)

### Data Use Disclosures (데이터 사용 공개 선언)
- **개인 식별 정보(PII)**: 수집 안 함 (`No`)
- **위치 정보**: 수집 안 함 (`No`)
- **금융 및 결제 정보**: 수집 안 함 (`No`) (외부 결제 페이지 연동 시에도 확장은 결제 정보를 직접 다루지 않음)
- **웹 브라우징 기록**: 수집 안 함 (`No`)
- **사용자 활동(키 입력 등)**: 수집 안 함 (`No`)
- **웹사이트 콘텐츠**: 사용자가 캡처를 승인한 비디오 탭의 화면/음성 텍스트만 처리함 (`Yes` - 처리 목적: 강의 노트 요약 생성, 외부 서버 영구 저장 없음)

### Data Use Certification (데이터 사용 보증 확인)
- [x] 사용자 데이터를 제3자에게 판매하지 않음 (Not sold to third parties)
- [x] 확장 프로그램의 핵심 기능과 무관한 목적으로 데이터를 사용하지 않음
- [x] 신용 평가 또는 대출 목적으로 데이터를 사용하지 않음

### Privacy Policy URL (개인정보처리방침)
`https://<도메인 또는 GitHub Pages 주소>/landing/policies/privacy.html`
*(현재 저장소 `landing/policies/privacy.html`에 초안이 완비되어 있으므로, 공개 웹 호스팅 활성화 후 해당 URL 입력)*

---

## 5. Pre-Packaging Checklist (스토어 배포 빌드 시 필수 점검)

- [ ] **`apikey.env.local` 배제**: 개발용 로컬 키 파일이 ZIP에 절대 포함되지 않았는지 확인.
- [ ] **테스트 파일 제외**: `lib/*.test.js`, `server/`, `tools/`, `docs/`, `.worktrees/` 배제.
- [ ] **버전 번호 점검**: `manifest.json` 내 `"version": "1.0.0"` 확정.
- [ ] **심사관용 시연 동영상 준비**: `<all_urls>` 권한 소명을 위해 30초 분량의 사용 시연 영상(Unlisted YouTube) 링크 준비 권장.
