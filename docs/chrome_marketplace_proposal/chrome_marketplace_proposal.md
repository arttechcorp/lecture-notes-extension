# Product Requirement Document (PRD) [v1.1.0 — Revised]
## Chrome Web Store 배포 패키징 도구 (`tools/package-cws.mjs`) 보안 강화 및 릴리스 파이프라인 고도화

---

## 1. 문서 메타데이터 및 개정 이력 (Document Overview & Revision)

| 항목 | 내용 |
|---|---|
| **문서명** | PRD — CWS 배포 패키징 도구 (`tools/package-cws.mjs`) 보안 강화 및 릴리스 파이프라인 |
| **대상 프로젝트** | Summrizei — Chrome Extension (Manifest V3) |
| **문서 버전** | **v1.1.0 (검토 피드백 `review.md` 반영 완료)** |
| **작성자 / 담당** | Antigravity & 부지환 (Jihwan Bu) |
| **상태 (Status)** | **Approved with Modifications Applied (구현 준비 완료)** |
| **작업 기준 브랜치** | `dev_ANTI` (저장소 루트 `.`) |
| **포팅 기준 커밋** | `b/dev` 브랜치의 커밋 `5f1034a` (`CHROMEWEBSTORE.md` 및 초기 `tools/package-cws.mjs`) |
| **참조 문서** | `docs/chrome_marketplace_proposal/review.md` (검토 보고서)<br>`CHROMEWEBSTORE.md` (스토어 등록 명세서 & 권한 소명서)<br>`AGENTS.md` (프로젝트 보안 불변식 & 아키텍처 원칙)<br>`manifest.json` (Chrome MV3 명세) |

### 1.1 개정 이력 (Changelog v1.1.0)
* **기준 브랜치 및 개인정보 계약 단일화**: `dev_ANTI` 기준으로 `b/dev` 커밋(`5f1034a`) 자산 이관 명시, `manifest.json`과 CWS 소명서의 권한 불일치(`tabCapture`, `offscreen`, `activeTab`, 외부 AI 도메인) 해소 계획 수립, `AGENTS.md`와 상충되던 CWS BYOK 서술을 단일 개인정보/아키텍처 계약으로 동기화.
* **고정 화이트리스트 폐기 및 런타임 의존성 폐쇄(Dependency Closure) 도입**: `sidepanel.html`이 참조하는 `landing/product-panel.css` 누락 방지, `lib/ppocr-runtime.mjs`, Whisper 워커, WASM/ONNX 벤더 자산의 재귀적 의존성 폐쇄 수집 알고리즘 규정.
* **ZIP 엔진 현실화 및 결정론적 재현성 분리**: `node:zlib` 직접 구현 한계 극복을 위한 검증된 무의존성 경량 아카이브 도입, 재현 가능한 빌드(고정 timestamp, 엔트리 정렬)와 가변 메타데이터(외부 `build-provenance.json`)의 엄격한 분리, 빌더 개인 식별 정보 수집 제거.
* **보안 감사 정적 휴리스틱 구체화**: "고엔트로피" 표현을 구체적 정규식/할당 패턴/fixture 테스트로 명문화, MV3 원격 코드(동적 import, `importScripts`, 원격 WASM, Blob URL 실행) 전수 차단, `sandbox.html` 격리 규약(chrome API 차단, postMessage 검증) 점검, 원시 미디어 전송 경로 정밀 차단, 비현실적인 "100% 승인 보장" 문구 현실화.
* **테스트 게이트 및 사후 검증 강화**: `--skip-tests` 사용 시 `UNVERIFIED` 패키지 분리 격리, OS 셸 글롭 종속 없는 프로그래밍 방식 테스트 러너(`fs.readdir`), 패키징 사후 아카이브 무결성 언팩 검증 추가.

---

## 2. 배경 및 목적 (Background & Objectives)

### 2.1 배경 (Context)
- **Summrizei**는 Chrome 확장 프로그램(Manifest V3) 환경에서 웹 강의 화면과 음성을 온디바이스(Gemini Nano, Whisper ONNX) 및 승인된 서버 AI 요약 파이프라인을 통해 학습 노트로 제작하는 도구입니다.
- Chrome Web Store(CWS) 배포 패키지는 Google의 엄격한 개발자 프로그램 정책(원격 코드 실행 전면 금지, 최소 권한 원칙, 사용자 데이터 프라이버시)을 완벽히 준수해야 합니다.
- 기존 브랜치(`b/dev:5f1034a`)에 작성되었던 프로토타입 `tools/package-cws.mjs`는 단순 파일 복사 및 Windows PowerShell `Compress-Archive` 호출에 의존하여 **1) 소스 내 하드코딩된 API Key 탐지 불가, 2) 쉘 주입 취약점 및 Linux CI 실행 불가, 3) 런타임 필수 에셋(`offscreen.html/js`, `landing/product-panel.css`, `.mjs`, ONNX 모델) 누락 위험, 4) 아키텍처 불변식 사전 검증 부재**의 문제점을 안고 있습니다.

### 2.2 핵심 목표 (Core Objectives)
1. **Zero Secret Leakage**: 소스 코드 전수 정적 스캔을 통해 개발용 키(`apikey.env.local`), API Key, 사설 토큰이 포함된 빌드를 원천 차단.
2. **Runtime Dependency Closure Integrity**: 매니페스트 엔트리포인트부터 HTML/JS의 import, Worker, CSS, WASM, ONNX 모델까지 런타임 의존성 폐쇄 집합을 정확히 식별하여 단 하나의 필수 파일도 누락되지 않도록 보장.
3. **Reproducible & Safe Archiving**: 쉘 명령어 실행 없는 안전한 순수 JS 아카이빙 엔진으로 전환하고, 고정 timestamp를 적용하여 소스가 동일하면 항상 동일한 해시가 생성되는 재현 가능한 빌드(Deterministic Build) 달성.
4. **CWS & Architectural Compliance Guard**: 원격 코드 실행(MV3 위반), `chrome.storage` 평문 저장, 원시 미디어 무단 전송 등 `AGENTS.md`의 불변식을 컴파일 타임에 사전 검증하여 CWS 심사 거절 리스크를 최소화.

---

## 3. 계약 및 명세 동기화 (Contract & Specification Alignment)

### 3.1 기준 브랜치 및 저장소 루트 명시
- **타깃 브랜치**: `dev_ANTI`
- **저장소 루트**: `c:\Users\부지환\OneDrive\Desktop\vibe-coding\claude workspace\lecture-notes`
- **이관 계획**: `b/dev` 브랜치의 커밋 `5f1034a`에 포함된 `CHROMEWEBSTORE.md`와 `tools/package-cws.mjs`를 `dev_ANTI` 브랜치로 가져와 본 PRD에 맞춰 전면 리팩토링합니다.

### 3.2 `manifest.json`과 `CHROMEWEBSTORE.md` 권한 소명 1:1 동기화
현재 소스 코드와 배포 문서 간의 불일치를 아래와 같이 단일 기준으로 동기화합니다:

| 권한 항목 | 매니페스트 상태 | 기존 CWS 소명서 상태 | 동기화 조치 |
|---|---|---|---|
| `tabCapture` | 선언됨 | 누락됨 | **소명서 추가**: 사용자가 선택한 강의 탭의 시스템 오디오 스트림 캡처 목적 소명 작성 |
| `offscreen` | 선언됨 | 누락됨 | **소명서 추가**: Service Worker가 다룰 수 없는 WebGPU Whisper 음성 모델 구동 목적 소명 작성 |
| `activeTab` | 선언됨 | 누락됨 | **소명서 추가**: 단축키/액션 클릭 시 활성 탭에 캡처 패널을 열기 위한 목적 소명 작성 |
| `openrouter.ai` | 선언됨 | 소명서에 선언 | **사용자 동의 기반 BYOK 텍스트 요약 경로와 1:1 일치** |

### 3.3 개인정보 및 데이터 흐름 단일화 (`AGENTS.md` 정합성 확보)
- **충돌 해소**: 최신 아키텍처 기준으로 사용자 OpenRouter BYOK 직접 전송을 명시하되, 운영자 키는 확장에 포함하지 않고 원시 미디어는 외부로 보내지 않습니다.
- **확정된 제품 계약**:
  1. **온디바이스 기본**: Gemini Nano 및 로컬 Whisper ONNX는 100% 기기 내부 메모리에서만 동작하며 외부 네트워크를 일체 사용하지 않음.
  2. **외부 요약 서비스**: 외부 모델 요약은 사용자의 명시적 동의(Consent) 하에 OpenRouter로 구조화 텍스트만 HTTPS 전송하며, 브라우저가 원시 미디어를 외부로 보내지 않음. 운영자 키는 확장에 포함하지 않음.
  3. **암호화 표현 정정**: 추론 과정을 "End-to-End 암호화"로 과장하지 않고, 전송 구간 암호화(HTTPS) 및 메모리 내 일시 처리 원칙을 사실대로 기술.

---

## 4. 상세 기능 요구사항 (Detailed Functional Requirements)

```
+---------------------------------------------------------------------------------------+
|                           tools/package-cws.mjs Pipeline                              |
+---------------------------------------------------------------------------------------+
|  [Step 1] Cross-platform Pre-flight Test Gate (node --test enumerated test files)     |
|       |                                                                               |
|  [Step 2] Runtime Dependency Closure Resolution (Manifest + HTML/JS/CSS recursive)   |
|       |                                                                               |
|  [Step 3] Static Security Scanner (Known regex patterns, key assignments, fixtures)   |
|       |                                                                               |
|  [Step 4] Architectural Invariant & CWS MV3 Policy Audit (Remote code, Invariants)    |
|       |                                                                               |
|  [Step 5] Stage Clean Distribution Files (Targeted version cleanup in dist/)         |
|       |                                                                               |
|  [Step 6] Pure Safe Archiver (Deterministic timestamps, sorted paths, pure JS zip)    |
|       |                                                                               |
|  [Step 7] Post-Packaging Verification (Unpack CRC32 check, manifest validation)       |
|       |                                                                               |
|  [Step 8] Checksums & External Build Provenance (SHA-256, build-provenance.json)     |
+---------------------------------------------------------------------------------------+
```

### 4.1 [FR-01] 교차 플랫폼 사전 테스트 게이트 (Cross-Platform Test Gate)
- **셸 글롭 제거**: `node --test lib/*.test.js`와 같은 셸 글롭 방식은 Windows와 Linux 환경 간 파싱 불일치가 발생할 수 있으므로, Node.js `fs.readdir`을 사용하여 `lib/` 내의 `*.test.js` 파일을 명시적으로 수집한 뒤 인자로 전달합니다.
- **실행 원칙**: 41개 단위 테스트가 100% 통과(Pass)해야만 다음 단계로 진입.
- **`--skip-tests` 안전장치**:
  - CWS 정식 릴리스 빌드에서는 테스트 생략을 불허합니다.
  - 디버깅용으로 플래그 사용 시, 생성 아티팩트명을 `summrizei-v{version}-UNVERIFIED.zip`으로 강제 격리하고 provenance에 `"test_status": "UNVERIFIED (TESTS_SKIPPED)"`를 영구 기록하여 실수 업로드를 방지합니다.

### 4.2 [FR-02] 런타임 의존성 폐쇄 수집 엔진 (Runtime Dependency Closure)
고정된 파일 목록이나 단순 폴더 복사 방식을 폐기하고, 브라우저 런타임에 실제로 필요한 파일들의 완전 폐쇄 집합(Closure)을 재귀적으로 식별합니다.

1. **Root Entrypoints**:
   - `manifest.json`에서 직접 참조하는 모든 리소스:
     - `background.service_worker` (`background.js`)
     - `side_panel.default_path` (`sidepanel.html`)
     - `options_page` (`options.html`)
     - `sandbox.pages` (`sandbox.html`)
     - `icons` (`icons/icon16.png`, `icon32.png`, `icon48.png`, `icon128.png`)
     - 런타임 생성 엔트리: `content.js`, `offscreen.html`, `offscreen.js`
2. **HTML 의존성 재귀 추적**:
   - `sidepanel.html`, `options.html`, `offscreen.html`, `sandbox.html` 내의 로컬 `<link href="...">`, `<script src="...">` 파싱.
   - **중요**: `sidepanel.html`이 참조하는 `landing/product-panel.css`를 의존성 폐쇄 집합에 정확히 포함 (단, `landing/index.html`, `demo-panel.html` 등 웹 마케팅 전용 파일은 완벽 배제).
3. **JS/MJS 모듈 및 워커 의존성 추적**:
   - JS 파일 내 정적 `import ... from '...'` 및 동적 `import('...')` 경로 파싱 (`lib/ppocr-runtime.mjs` 등 누락 방지).
   - `new Worker('...')`, `audioWorklet.addModule('...')` 경로 파싱 (`lib/whisper-webgpu-worker.js`, `lib/pcm-worklet.js` 등).
4. **WASM 및 모델 바이너리 수집**:
   - `lib/vendor/` 내 브라우저 구동에 필수적인 ONNX/WASM/가중치 파일 식별 (`ppocr`, `onnxruntime`, `transformers4`).
5. **엄격한 배제 집합 (Strict Exclusion)**:
   - `*.test.js`, `*.spec.js`, `apikey.env.local`, `.env*`, `server/`, `tools/`, `docs/`, `*.md`, `.git*`, `node_modules/`.

### 4.3 [FR-03] 정적 보안 휴리스틱 감사 (Static Security Heuristics)
추상적인 "엔트로피 분석" 대신 명확히 정의된 정적 휴리스틱 룰셋과 fixture 검증을 적용합니다.

1. **알려진 시크릿 포맷 정규식 (Known Patterns)**:
   - Anthropic: `sk-ant-[a-zA-Z0-9_\-]{80,}`
   - Google Gemini: `AIzaSy[a-zA-Z0-9_\-]{33}`
   - OpenAI / OpenRouter: `sk-[a-zA-Z0-9]{48}`, `sk-or-v1-[a-f0-9]{64}`
   - Private Key: `-----BEGIN [A-Z ]*PRIVATE KEY-----`
2. **일반 키 할당 패턴 매칭 (Generic Assignment Heuristics)**:
   - `/(api[_-]?key|secret|password|access[_-]?token)\s*[:=]\s*['"][a-zA-Z0-9_\-]{20,}['"]/i`
   - 더미 플레이스홀더(`YOUR_API_KEY`, `sk-ant-xxx...`)는 주석/문서 허용 여부를 명확히 구분.
3. **Fixture 기반 검증**:
   - 패키징 도구 자체 테스트를 위해 `tools/fixtures/secret-samples/`에 유효/무효 샘플을 두고 스캐너의 정밀도를 사전 검증.

### 4.4 [FR-04] CWS MV3 정책 및 아키텍처 불변식 정적 검증
1. **MV3 원격 코드 실행(Remote Code) 포괄적 차단**:
   - 외부 `<script src="http(s)://">` 차단
   - 동적 `import("http(s)://...")` 및 `importScripts("http(s)://...")` 차단
   - 원격 WASM 바이너리 fetch 및 `URL.createObjectURL` 기반 스크립트 실행 패턴 차단
   - 확장 페이지 내 `eval()`, `new Function()` 차단
2. **`sandbox.html` 격리 규약 정적 검사**:
   - `sandbox.html`은 수식(KaTeX)/다이어그램(Mermaid) 렌더링을 위해 `unsafe-eval`을 사용하므로, 격리 안전성을 검증:
     - 샌드박스 페이지 내에 `chrome.*` 확장 API 호출이 일체 존재하지 않는지 검사.
     - 메인 프레임과의 `postMessage` 통신 시 origin 검증 및 수신 데이터 스키마 유효성 검사 로직이 존재하는지 확인.
3. **네트워크 미디어 전송 경로 정밀 감사**:
   - **허용 경로(Allowlist)**: `huggingface.co` 모델 가중치 GET 요청, 사용자 명시적 동의 하의 텍스트 요약 HTTPS 요청.
   - **차단 경로(Blocklist)**: 캡처된 비디오 프레임(`ImageData`, `toDataURL`), 원시 PCM 오디오 버퍼가 네트워크 전송 함수(`fetch`, `WebSocket`, `sendBeacon`)로 직접 연결되는 구문 차단 (`AGENTS.md` Memory-only 불변식 보호).
4. **스토리지 불변식 검증**:
   - `chrome.storage.local/sync.set`에 `transcript`, `rawAudio`, `notes`, `summary`가 저장 키로 전달되는 구문 감지 (`lib/settings.js` 외 저장 금지 원칙 준수).

### 4.5 [FR-05] 순수 JS 안전 아카이빙 및 결정론적 재현성 (Deterministic Archiving)
1. **검증된 소형 무의존성 ZIP 엔진 사용**:
   - `node:zlib`을 사용해 불안정한 PKZIP 사양을 자체 구현하는 위험을 피하고, 검증된 초경량 순수 JS 아카이브 솔루션(예: 단일 파일로 인라인 가능한 `fflate` 기반 패키징 루틴)을 활용하여 CRC32, ZIP64, 파일 디렉터리 손상 위험을 원천 차단합니다.
   - 외부 쉘(`powershell`, `zip` CLI) 실행을 일체 배제하여 Command Injection 위험 0% 달성.
2. **결정론적 빌드(Deterministic Reproducibility)**:
   - ZIP 아카이브 엔트리를 파일 경로 알파벳순(Lexicographical order)으로 정렬.
   - 파일 수정 시각(`mtime`)을 `SOURCE_DATE_EPOCH` 환경변수 또는 고정 기준 시각(`2026-01-01T00:00:00Z`)으로 정규화.
   - 파일 권한(POSIX mode)을 일반 파일 0644, 실행 파일 0755로 고정.
   - 결과: 소스 코드가 동일하면 언제, 어느 OS에서 빌드하더라도 정확히 동일한 바이너리 ZIP 해시 생성.
3. **타깃 아티팩트 관리**:
   - `dist/` 전체를 날리지 않고, 이번 빌드 버전(`summrizei-v${version}-*`)의 산출물만 안전하게 교체.

### 4.6 [FR-06] 패키징 사후 검증 (Post-Packaging Verification)
ZIP 파일 생성 직후 메모리/임시 영역에서 사후 무결성 검증을 자동 수행합니다:
1. **Archive Readability Check**: 생성된 ZIP을 직접 열어 엔트리 목록을 순회하고 CRC32 및 아카이브 손상 여부 검증.
2. **Integrity Invariant Check**:
   - 필수 런타임 파일(`manifest.json`, `offscreen.html`, `landing/product-panel.css` 등)이 모두 ZIP 내부에 존재하는지 확인.
   - 제외 대상 파일(`.env`, `*.test.js`, `landing/index.html`)이 단 하나도 포함되지 않았는지 확인.
   - ZIP 내부의 `manifest.json`을 직접 파싱하여 JSON 문법 오류가 없는지 확인.
3. **용량 한도 점검**:
   - 총 압축 크기가 CWS 최대 한도인 **2GB (2,048MB)**를 초과하지 않는지 검증하고, 최적화 권장선(100MB 이하) 대비 상태 보고.

### 4.7 [FR-07] 무결성 체크섬 및 외부 빌드 출처 (Provenance)
가변적인 메타데이터는 ZIP 아카이브 내부가 아닌 `dist/` 내의 별도 파일로 분리 발행합니다.

1. **`dist/summrizei-v${version}-cws.sha256`**:
   - 배포용 ZIP 아카이브의 단일 SHA-256 체크섬 텍스트.
2. **`dist/build-provenance.json`**:
   - 빌드 환경: Git 커밋 SHA, Node.js 버전, `SOURCE_DATE_EPOCH`
   - 개인 식별 정보 배제: 빌더 로컬 OS 사용자명, 로컬 머신명 등 프라이버시 침해 요소 일체 미수집.
   - 파일 명세: 아카이브에 포함된 모든 파일 경로 및 개별 파일의 SHA-256 해시 목록.
   - 아카이브 명세: 최종 ZIP 크기(bytes) 및 SHA-256 해시.
   - 테스트 결과: `test_status: "PASSED (41/41)"` 기록.

---

## 5. 비기능 요구사항 (Non-Functional Requirements)

1. **플랫폼 독립성 (Cross-Platform)**: Windows (CMD/PowerShell), Linux (Ubuntu LTS), macOS 환경 어디서나 `node tools/package-cws.mjs` 단일 명령으로 100% 동일하게 동작.
2. **성능 (Performance)**: 의존성 폐쇄 수집, 정적 보안 검사, ZIP 압축 및 사후 검증까지 일반 개발 머신 기준 **3초 이내**에 완료.
3. **무번들러 원칙 (`AGENTS.md` 준수)**: Webpack, Rollup, Vite 등 거대 번들러를 일체 추가하지 않고 Vanilla JS(ES2022+) 환경 유지.
4. **명확한 진단 출력 (DX)**: 터미널에 단계별 상태(Pass/Fail)와 제외된 항목, 포함된 파일 수, 최종 용량을 컬러 기호로 명확히 표시.

---

## 6. 승인 기준 및 검증 시나리오 (Acceptance Criteria)

| 시나리오 | 테스트 방법 | 기대 결과 |
|---|---|---|
| **시크릿 차단** | `lib/sample.js`에 `const KEY = "sk-ant-api03-xxx..."` 주입 후 실행 | 패키징 즉시 중단(Exit 1), 마스킹된 위치 경고 출력, `dist/`에 ZIP 미생성 |
| **의존성 누락 방지** | `landing/product-panel.css` 및 `offscreen.html/js` 포함 여부 검사 | 의존성 폐쇄 추적을 통해 ZIP 내부에 완벽히 포함됨 |
| **불필요 파일 배제** | `landing/index.html`, `lib/*.test.js`, `.env` 포함 여부 검사 | 의존성 폐쇄에 포함되지 않아 ZIP 내부에서 100% 배제됨 |
| **결정론적 해시** | 동일한 커밋에서 두 번 연속 패키징 실행 | 두 번 생성된 ZIP의 SHA-256 해시가 100% 일치 |
| **사후 언팩 검증** | 패키징 직후 ZIP 유효성 검사 루틴 통과 확인 | 손상 없는 유효한 아카이브 및 유효한 `manifest.json` 확인 완료 |
| **테스트 연동** | 단위 테스트 41개 통과 확인 | 41개 테스트가 사전 실행되어 통과한 후에만 패키지 생성 |

---

## 7. 권장 구현 로드맵 (Implementation Roadmap)

1. **Phase 1: 브랜치·매니페스트·CWS 소명·계약 동기화**
   - `b/dev:5f1034a` 자산(`CHROMEWEBSTORE.md`, `tools/package-cws.mjs`)을 `dev_ANTI`로 포팅
   - `manifest.json`과 `CHROMEWEBSTORE.md` 권한 소명서 동기화 (`tabCapture`, `offscreen`, `activeTab`, 외부 AI 도메인 정비)
   - `AGENTS.md`의 서버 프록시/동의 기반 계약과 CWS 등록 설명문 일치화
2. **Phase 2: 런타임 의존성 폐쇄 수집 엔진 구현**
   - HTML/JS/CSS 재귀 파서 구현 (`landing/product-panel.css`, `.mjs`, 워커, ONNX 벤더 자산 수집)
   - 필수 런타임 파일 및 배제 파일 목록 검증기 구축
3. **Phase 3: 정적 보안 감사 및 fixture 테스트 구축**
   - 시크릿 정규식/할당 패턴 매칭 엔진 작성
   - MV3 원격 코드 전수 차단 및 `sandbox.html` 격리 규약 검사 추가
   - `AGENTS.md` 아키텍처 불변식(스토리지, 미디어 전송 경로) 정적 감사 구축
   - `tools/fixtures/` 기반 단위 테스트 검증
4. **Phase 4: 순수 JS 아카이빙, 사후 검증 및 Provenance 생성**
   - 외부 쉘 호출 제거 및 결정론적 순수 JS ZIP 생성기 구현
   - 사후 ZIP 언팩 및 CRC32 검증기 탑재
   - `dist/SHA256SUMS` 및 빌더 개인정보가 배제된 `dist/build-provenance.json` 발행
   - 프로그래밍 방식 테스트 러너 연동 및 CWS 배포 시운전
