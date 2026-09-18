# 강의 필기 도우미

강의 영상의 화면·음성을 기기 안에서 인식해 **근거 시각이 연결된 구조화 학습 노트**를 만드는 Chrome Manifest V3 확장 프로그램입니다.

특정 LMS에 묶여 있지 않습니다. 표준 `<video>` 요소만 찾으면 되므로 런어스·무들·유튜브 등 사이트를 가리지 않습니다.

> 개인 학습용 도구입니다. 강의 영상의 캡처·재배포는 학칙이나 저작권 정책에 저촉될 수 있으니 결과물을 외부에 공유하지 마세요. 노트는 OCR 기반 자동 생성물이라 오독이 섞일 수 있습니다.

## 동작 방식

1. 일반 강의 탭에서 확장 아이콘을 누릅니다. 툴바 없는 LearnUs 팝업은 그 창을 활성화하고 `Alt+Shift+S`를 누르면 해당 탭을 선택한 별도 캡처 창이 열립니다.
2. 이 명시적 호출로 해당 탭의 임시 캡처 권한을 얻고, `chrome.scripting`으로 메타데이터 스크립트를 주입합니다. 현재 manifest의 사이트 접근 권한과 `tabCapture`의 탭별 캡처 권한은 별개이며, 목록에서 탭을 선택하는 것만으로 캡처 권한이 생기지는 않습니다.
3. **preflight** — 프레임 1장을 시험 캡처해 CORS 차단·DRM 여부를 먼저 판정하고, 안 되면 이유를 명시하고 중단합니다.
4. offscreen document가 캡처 수명과 제한된 메모리 큐를 소유하고, 필요한 화면만 로컬 PP-OCRv5 한국어 mobile/WASM과 선택적 로컬 Whisper로 인식합니다.
5. 근거를 `included / filtered / uncertain`으로 비파괴 선별합니다. 숫자·단위·기호·대소문자·부정·수식은 보존합니다.
6. 사용자가 외부 텍스트 처리에 동의한 경우에만 모든 구간을 운영 서비스로 보내 구간별 요약과 전체 합성을 수행합니다. 이미지와 오디오는 외부로 보내지 않습니다.

## 캡처 모드

| 모드 | 영역 | 간격 | 용도 |
| --- | --- | --- | --- |
| **슬라이드** (기본) | 영상 전체 | 저비용 감시 후 안정화 시 OCR | 대부분의 강의 |
| 자막 띠 | 하단 20% | 저비용 감시 후 안정화 시 OCR | 화면에 자막이 박혀 있는 강의 |

배속 재생 시 캡처 간격을 재생 속도에 비례해 줄입니다.

## 설치

1. `chrome://extensions` → "개발자 모드" 켜기
2. "압축해제된 확장 프로그램을 로드" → 이 폴더(`lecture-notes`) 선택
3. 선택적 외부 요약을 사용하려면 옵션에서 OpenRouter API 키를 입력하고 텍스트 처리 안내에 동의합니다. 키는 이 기기의 확장 설정에만 저장하며, 화면 이미지·오디오는 보내지 않습니다.

## 사용

1. 강의 영상을 재생
2. 일반 탭은 확장 아이콘, LearnUs 팝업은 `Alt+Shift+S` → 선택된 영상 탭 확인 → "캡처 시작"
3. 영상이 끝나면 인식 결과를 확인하고 구조화 노트를 생성합니다. 필요한 경우 암호화 보관함에 사용자가 직접 저장합니다.

캡처·오디오·평문 근거는 메모리에만 존재합니다. 패널을 닫아도 offscreen 세션은 유지되지만 브라우저 종료·충돌에서는 복구되지 않습니다. 보관 요청 시에만 기기에서 암호화한 ciphertext를 서비스에 저장합니다.

개발 버전 갱신 시 기존 캡처 창을 닫고 `chrome://extensions`의 확장 카드에서 새로고침하세요. 단축키가 작동하지 않으면 `chrome://extensions/shortcuts`에서 **현재 강의 탭의 캡처 창 열기 (LearnUs 팝업용)** 항목을 확인하세요.

## 알려진 한계

| 장벽 | 증상 | 상태 |
| --- | --- | --- |
| CORS 미설정 CDN | 프레임 캡처 자체가 차단 | preflight가 감지·안내, 우회 불가 |
| DRM (Widevine/EME) | 캔버스가 검은 프레임 반환 | preflight가 감지·안내, 우회 불가 |
| cross-origin iframe 플레이어 | 최상위 문서에서 `<video>`를 못 찾음 | 현재는 명시적으로 중단, 실제 LMS 호환성 검증 필요 |
| 슬라이드 없이 말로만 하는 강의 | OCR할 텍스트가 없음 | Whisper를 사용자가 켠 경우에만 로컬 전사 |

현재 OCR 기본 경로는 PP-OCRv5 한국어 mobile ONNX/WASM입니다. 음성은 20초 합성음의 Worker 단독 실측에서 실시간 처리량을 충족한 Whisper small q8 인코더/q4 디코더 WebGPU 조합을 기본 선택으로, 기존 Whisper base/WASM을 저사양 모드로 둡니다. 이 측정은 실제 강의의 캡처·발화 분할·OCR 동시 처리 안정성을 보장하지 않습니다. Silero VAD, 실제 LearnUs 팝업·iframe 검증과 장시간 성능 평가는 후속 단계입니다.

## 비용

로컬 OCR/ASR에는 외부 추론 비용이 없습니다. 외부 요약 비용과 한도는 운영 서비스의 계정 설정 및 실제 제공자 usage를 따릅니다.

## 구조

| 파일 | 역할 |
| --- | --- |
| `manifest.json` | MV3 설정. `content_scripts` 없음 — 주입은 런타임에 |
| `content.js` | 영상 preflight와 시각·seek·배속·레이아웃 메타데이터 전달 |
| `background.js` | 권한, tabCapture stream ID, offscreen 생성과 제어 메시지 라우팅 |
| `offscreen.html` / `.js` | 메모리 내 캡처 세션·근거·요약·암호화 보관 작업 소유 |
| `lib/session.js` / `evidence.js` | 제한된 OCR/ASR 큐, 종료 drain, 시각·출처 근거 관리 |
| `lib/summary.js` | 비파괴 선별, 전체 coverage 청킹, 구간 요약과 필수 전체 합성 |
| `server/index.js` | 운영자 키, 고정 provider 정책, 구조화 요약, 사용량 제한, ciphertext 보관 |
| `sidepanel.html` / `.js` | 표시·제어용 thin RPC adapter와 결과 내보내기 |

## 캡처 권한 회귀 검증

`node --test lib/*.test.js`로 기본 검사를 실행합니다. `PLAYWRIGHT_MODULE`과 `CHROME_PATH`를 지정한 뒤 `node tools/extension-capture-smoke.cjs`를 실행하면 별도 임시 Chrome 프로필에 실제 확장을 로드합니다. 테스트용 확장 디버깅 옵션은 이 임시 프로필에만 사용하며 개인 Chrome에는 연결하지 않습니다.

Chrome 152에서 `openPanelOnActionClick: true`일 때 아이콘 호출 후에도 캡처 권한이 없는 기존 오류를 재현했고, `false`와 명시적 `action.onClicked`로 변경한 뒤 실제 tabCapture → offscreen → PP-OCRv5 → 종료 경로를 검증했습니다. 권한을 받은 탭을 툴바 없는 팝업으로 옮겨 같은 경로와 대상 탭 유지도 확인합니다. 다른 출처로 이동하면 권한이 취소되는지도 검사합니다.

이 검사는 합성 영상만 사용합니다. Headless 키 입력으로는 Chrome 단축키를 실행할 수 없어 실제 LearnUs 창에서의 `Alt+Shift+S` 입력과 LMS 호환성은 별도 실사용 확인이 필요합니다. 단축키 등록 및 명령 핸들러의 탭 ID 전달은 자동 검사에 포함됩니다.
