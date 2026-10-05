# Chrome Web Store Listing — Summrizei (강의 노트)

> Last Updated: 2026-09-14 (v1.1.0 Aligned with dev_ANTI & AGENTS.md)

이 문서는 Chrome 웹 스토어(Chrome Web Store) 개발자 대시보드 등록 및 심사 제출을 위한 메타데이터 단일 기준(Single Source of Truth) 문서입니다. 스토어 등록 시 각 항목을 그대로 복사하여 입력할 수 있습니다.

---

## 1. Store Listing (스토어 기본 정보)

**Extension Name** [REQUIRED]  
`Summrizei — 강의 노트`  
*(영문 스토어: `Summrizei — AI Lecture Notes & Summarizer`)*

**Short Description** [REQUIRED] (최대 132자)  
`강의 영상의 화면과 음성을 인식해 요약 노트로 자동 변환합니다. 기기 내 처리와 클라우드 인식 옵션 모두 지원합니다.`

**Detailed Description** [REQUIRED] (스토어 본문 설명)  
```text
강의 영상을 보면서 일일이 멈추고 필기하느라 지치셨나요?
Summrizei는 강의 영상을 시청하는 동안 화면의 슬라이드와 강사의 음성을 실시간으로 인식하여 구조화된 고품질 학습 노트를 자동으로 작성해 주는 스마트 사이드패널 확장 프로그램입니다.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✨ 주요 핵심 기능
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. 유연한 인식 모드: 실시간 & 백그라운드
- 사이드패널에서 영상을 보며 실시간으로 노트를 작성하거나, 백그라운드에서 자동으로 캡처하고 정리할 수 있습니다.
- 화면의 슬라이드 변화(OCR)와 음성(Speech)을 동시에 감지하여 중요한 내용을 놓치지 않습니다.
- 다른 작업을 하면서도 강의를 동시에 정리할 수 있습니다.

2. 완벽하게 구조화된 학습 노트
- 단순 요약이 아닌 대제목, 소제목, 글머리 기호, 핵심 비교 표(Table)로 체계화된 노트를 만듭니다.
- 공학/수학/경영 공식(LaTeX) 및 프로세스/의사결정 트리 다이어그램까지 지원합니다.

3. 개인정보 보호 & 선택 가능한 인식 방식
- Free 플랜은 로컬 Whisper·PP-OCR 모델로 기기 안에서 인식하고, 요약할 때만 정리된 텍스트를 운영 서비스로 보냅니다(외부 요약 동의 필요). 화면 이미지와 음성은 기기 밖으로 나가지 않습니다.
- Essential·Pro 플랜에서는 클라우드 인식을 선택할 수 있습니다. 사용자가 켜고 별도 동의를 한 경우에만 슬라이드 프레임과 음성 조각을 운영 서비스를 거쳐 인식 제공자에게 보냅니다. 데이터는 인식 용도로만 처리되고 저장되지 않습니다.
- 기기 내 인식만 사용하면 민감한 사내 교육이나 비공개 강의도 안심하고 정리할 수 있습니다.

4. 클라우드 고품질 요약 지원 (명시적 동의 기반)
- 더 깊이 있는 학술 분석이 필요한 경우 사용자의 명시적 동의 하에 안전한 전송 구간 암호화(HTTPS)를 거쳐 고성능 모델로 정밀 노트를 제작할 수 있습니다.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚀 시작하는 방법
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. Chrome 웹 스토어에서 [Chrome에 추가]를 클릭합니다.
2. 브라우저 우측 상단의 Summrizei 아이콘을 클릭하여 사이드패널을 엽니다.
3. [캡처 시작]을 누르고 평소처럼 강의를 들은 뒤, 강의가 끝나면 [캡처 종료]를 누르면 노트가 만들어져 처음에 고른 보관함 폴더에 암호화 파일로 자동 저장됩니다.
4. 저장된 노트를 다시 보려면 웹사이트 summrizei.vercel.app/library에서 같은 계정으로 로그인하고 폴더를 선택하면 됩니다.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔒 철저한 개인정보 보호 원칙 (AGENTS.md 준수)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Memory Only: 기본 설정에서는 캡처된 화면 프레임과 오디오가 브라우저 메모리 안에서만 일시적으로 처리되며 디스크나 외부 서버에 절대 저장되지 않습니다. 유료 고화질 화면 인식을 켜고 동의한 경우에만 슬라이드 프레임이 인식을 위해 운영 서비스로 전달되며, 역시 어디에도 저장되지 않습니다.
- 제3자에게 데이터를 판매하거나 광고 목적으로 수집하지 않습니다.
- 패널을 닫으면 캡처 원본 데이터는 메모리에서 완전히 소멸합니다.

문의 및 피드백: summrizei.support@gmail.com
```

**Category** [REQUIRED]  
`Productivity` (생산성)

**Single Purpose** [REQUIRED] (단일 목적 선언)  
`브라우저 탭에서 재생 중인 영상·음성을 요약 노트로 바꿉니다.`

**Primary Language** [REQUIRED]  
`한국어 (Korean)`

---

## 2. Graphics & Assets (스토어 이미지 규격 및 체크리스트)

| 자산 항목 | 권장/필수 규격 | 파일 위치 / 상태 | 설명 |
|---|---|---|---|
| **스토어 아이콘 [필수]** | 128×128 PNG | `icons/icon128.png` ✅ | 투명 배경 없는 고해상도 앱 아이콘 |
| **스크린샷 1 [필수]** | 1280×800 PNG | `store-assets/screenshot-1-live.png` ✅ | 강의 영상 옆 사이드패널에서 실시간 인식 중 (강의 내용은 모자이크) |
| **스크린샷 2 [권장]** | 1280×800 PNG | `store-assets/screenshot-2-capture.png` ✅ | 캡처 중 — 슬라이드·음성 인식 실시간 누적 |
| **스크린샷 3 [권장]** | 1280×800 PNG | `store-assets/screenshot-3-formula.png` ✅ | 노트 서식 — LaTeX 수식과 비교 표 렌더링 |
| **스크린샷 4 [권장]** | 1280×800 PNG | `store-assets/screenshot-4-note.png` ✅ | 완성 노트 — 구조화된 요약 본문 |
| **소형 프로모션 타일 [권장]** | 440×280 PNG | `store-assets/promo-small-440x280.png` ⬜ | 스토어 추천 탭 노출용 그래픽 배너 |
| **대형 프로모션 타일 [선택]** | 1400×560 PNG | `store-assets/promo-marquee-1400x560.png` ⬜ | 스토어 메인 상단 마키 배너 |

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
| `webRequest` | permissions | 백그라운드 모드에서 사용자가 시작한 탭의 미디어 요청(m3u8·mpd·mp4)을 찾기 위해 **관찰 전용**으로 사용합니다. 요청을 차단하거나 수정하지 않으며, 작업 대상 탭 외의 요청이나 브라우징 기록을 수집하지 않습니다. *(Observes the media requests of the user-started tab to locate the lecture stream. Not used to block or modify requests, nor to collect browsing history.)* |
| `declarativeNetRequestWithHostAccess` | permissions | Referer를 요구하는 미디어 CDN에 한해, 사용자가 보고 있던 페이지의 Referer를 재현하는 임시 세션 규칙을 걸고 작업 종료 시 제거합니다. 다른 출처로 위장하거나 광고·트래커 차단·임의 헤더 조작에는 사용하지 않습니다. *(Sets a temporary session rule reproducing the viewed page's Referer for the media CDN only, removed after the job. Not used to spoof other origins or modify arbitrary headers.)* |
| `identity` | permissions | Supabase 계정의 구글 로그인(`chrome.identity.launchWebAuthFlow`)에 사용합니다. 로그인 결과(인증 토큰·계정 식별자·이메일) 외에 Chrome 프로필의 신원 정보를 읽지 않습니다. *(Used for Google sign-in via launchWebAuthFlow. Does not read Chrome profile identity beyond the sign-in result (auth token, account identifier, e-mail).)* |
| `power` | permissions | 사용자가 시작한 백그라운드 작업이 진행되는 동안만 `chrome.power.requestKeepAwake("system")`으로 유휴 절전을 막습니다. 상시 절전 방지나 화면 켜짐 유지에는 사용하지 않습니다. *(Prevents system idle sleep only while a user-started background job runs. Not used for display keep-awake or persistent wake locks.)* |
| `downloads` | permissions | 사용자가 설정 화면에서 요청한 진단 기록(내용 없는 이벤트 JSON)을 Downloads/Summrizei/diagnostics 폴더에 저장합니다. 강의 노트는 이 권한이 아니라 사용자가 처음에 고른 보관함 폴더에 브라우저의 폴더 접근 기능(File System Access)으로 직접 저장합니다. *(Saves the diagnostics file the user asks for in Settings. Lecture notes are written directly to the library folder the user picked, via the File System Access API, not through downloads.)* |
| `unlimitedStorage` | permissions | 강의당 약 4MB(추정)로 암호화된 강의 패키지가 브라우저 스토리지 축출로 삭제되지 않게 합니다. 원본 영상·음성은 저장하지 않습니다. *(Keeps encrypted lecture packages (est. ~4MB per lecture) from browser storage eviction. No raw media is stored.)* |
| `<all_urls>` | host_permissions | 사용자는 YouTube, Coursera, 대학 온라인 LMS, 웨비나 등 다양한 웹사이트에서 강의를 수강합니다. Manifest V3 사이드패널 UI의 버튼 클릭은 브라우저 보안 규격상 `activeTab` 권한을 임시 승계받지 못하므로, 사용자가 선택한 임의의 강의 페이지에 캡처 스크립트를 주입하기 위해 광범위한 호스트 권한이 기술적으로 불가피합니다. 캡처는 사용자가 [캡처 시작]을 누른 탭에서만 동작합니다. *(Users attend lectures on various educational platforms (YouTube, Coursera, university LMS, webinars). Under Manifest V3, side panel interactions do not inherit activeTab privileges; hence host permissions are technically required to inject capture scripts into user-selected educational sites. Capture is strictly confined to user-initiated sessions.)* |
| `https://huggingface.co/*`<br>`https://*.hf.co/*`<br>`https://cdn-lfs.huggingface.co/*` | host_permissions | 외부 서버로 음성을 유출하지 않고 기기 내부에서 100% 로컬로 음성을 인식하기 위해, 오픈소스 Whisper ONNX 모델 가중치 바이너리를 브라우저 캐시로 다운로드하는 데 사용됩니다. *(Required to download open-source Whisper ONNX speech recognition model weights to the browser cache for 100% local, privacy-safe on-device audio transcription.)* |

- `<all_urls>`는 유지합니다. 사유는 현행과 같습니다 — 임의의 강의 페이지에서 사용자가 시작한 캡처·소스 식별에 필요합니다.
- **설치 경고·`optional_permissions` 검토**: 계획서 17은 설치 경고를 일으키는 권한을 `optional_permissions`로 옮길 수 있는지 패키징 단계에서 확인하라고 하며 결과가 없습니다. Chrome이 실제로 보여주는 설치 경고 문구는 여기서 단정하지 않습니다.

---

## 4. Privacy & Compliance (개인정보 및 규정 준수 체크)

### Data Use Disclosures (데이터 사용 공개 선언)
- **개인 식별 정보(PII)**: Yes (구글 로그인 이메일·식별자를 계정 관리 목적으로 저장)
- **위치 정보**: 수집 안 함 (`No`)
- **금융 및 결제 정보**: 수집 안 함 (`No`)
- **웹 브라우징 기록**: 호스트명만 사용량 통계 목적으로 저장 (`Yes` - 강의 제목·URL 경로·내용 제외)
- **사용자 활동(키 입력 등)**: 수집 안 함 (`No`)
- **웹사이트 콘텐츠**: Yes - 사용자가 캡처를 승인한 비디오 탭의 화면/음성을 처리합니다. 처리 목적: 강의 노트 요약 생성. Free 플랜은 인식을 기기 안에서 하고, 요약용 텍스트만 운영 서비스로 보냅니다. Essential/Pro 플랜은 사용자가 클라우드 인식에 동의한 경우에만 슬라이드 프레임과 오디오 청크를 인식 제공자에게 전송하며, 데이터는 저장되지 않습니다.

### Data Use Certification (데이터 사용 보증 확인)
- [x] 사용자 데이터를 제3자에게 판매하지 않음 (Not sold to third parties)
- [x] 확장 프로그램의 핵심 기능과 무관한 목적으로 데이터를 사용하지 않음
- [x] 신용 평가 또는 대출 목적으로 데이터를 사용하지 않음

### Privacy Policy URL (개인정보처리방침)
`https://summrizei.vercel.app/policies/privacy`

---

## 5. Pre-Packaging Checklist (스토어 배포 빌드 시 필수 점검)

- [ ] **보안 패키징 검증**: `node tools/package-cws.mjs` 실행 및 모든 보안 검사(시크릿 스캔, 불변식, 런타임 폐쇄, 단위 테스트) 통과 확인.
- [ ] **무결성 체크섬 확인**: `dist/summrizei-v1.0.0-cws.sha256` 및 `dist/build-provenance.json` 생성 확인.
- [ ] **`apikey.env.local` 배제**: 개발용 로컬 키 파일이 ZIP에 절대 포함되지 않았는지 2차 확인.
- [ ] **테스트 파일 제외**: `lib/*.test.js`, `server/`, `tools/`, `docs/`, `.worktrees/` 배제 확인.
- [x] **버전 번호 점검**: `manifest.json` 내 `"version": "1.0.0"` 확정 (2026-09-19).
- [ ] **심사관용 시연 동영상 준비**: `<all_urls>` 권한 소명을 위해 30초 분량의 사용 시연 영상(Unlisted YouTube) 링크 준비.
