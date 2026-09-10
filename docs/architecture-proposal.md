# Summrizei 아키텍처 개선안

작성일: 2026-09-10. 상태: 설계 제안, 구현·모델 성능 검증 전.

기본 배포 형태는 사용자가 지정한 **Chrome Manifest V3 확장 프로그램**이다. 향후 로컬 보조 앱을 붙일 수 있도록 인식 작업의 입력·출력 계약만 분리한다. 현재 제품을 데스크톱 앱으로 바꾸거나, 강의 원본을 클라우드 OCR/ASR로 보내는 것은 이 제안의 기본안에 포함하지 않는다.

## 1. 권장 구조

**자주 실행하는 저비용 화면 감시 → 필요한 영역만 OCR → 발화 단위 ASR → 출처가 있는 근거 타임라인 → 텍스트만 선택적 외부 요약**으로 구성한다.

OCR 모델만 교체해서는 문제를 해결할 수 없다. 슬라이드·필기 변화를 놓치지 않는 감지, 인식보다 캡처가 빠를 때의 처리량 제어, 화면·음성 시간 정렬, 인식 실패를 드러내는 결과 구조가 함께 필요하다.

- [제안 아키텍처 HTML](./architecture-proposal.html)
- [편집 가능한 설계 JSON](./architecture-proposal.json)
- [현재 구현을 설명하는 기존 JSON](./architecture.json)

설계도는 처리 모듈과 데이터 경계를 보여준다. 별도 프로세스를 모듈마다 만드는 뜻은 아니다. 세션 상태와 텍스트 타임라인은 하나의 offscreen document 안에 두고, 무거운 OCR·ASR만 Worker로 실행한다. 외부 요약을 선택하지 않으면 로컬 근거·추출 상태까지 제공하며, 로컬 요약 모델 지원은 별도 기능으로 판단한다.

## 2. 현재 구현에서 확인한 문제

| 확인된 구현 | 개선이 필요한 이유 | 변경 방향 |
|---|---|---|
| `content.js:11`의 슬라이드 감시 간격 5초, 48×27 썸네일 평균 차이 | 짧은 슬라이드, 작은 필기·수식 기호는 놓칠 수 있고 교수 영상은 불필요한 변화를 만듦 | ROI, 두 해상도 변화 감지, 안정화·최대 대기시간 |
| 8장 또는 15장이 쌓이면 프레임 배치 전송 | 변하지 않는 마지막 슬라이드는 배치가 차기 전까지 OCR이 지연됨 | 이벤트 발생 후 곧바로 한 장씩 처리 |
| `sidepanel.js:318`에서 4배치 초과 시 가장 오래된 배치 삭제 | 메모리를 제한하지만 서로 다른 슬라이드도 함께 잃음 | 이미지 개수+바이트 상한, 동일 슬라이드 갱신만 병합, 누락 구간 표시 |
| `lib/audio.js`가 청크마다 Worker에 전사 메시지 전송 | 생산자→소비자 ACK가 없어 작업·버퍼 적체를 명시적으로 통제하지 않음 | ASR in-flight 1개, 제한된 PCM 링 버퍼 |
| 5초 음성 청크, RMS·peak 무음 판별 | 문장 경계·단어가 끊기고 낮은 음량·음악을 구분하기 어려움 | VAD, 앞뒤 문맥, 겹침 정렬 |
| `lib/whisper-worker.js`가 tiny/base와 WASM 1스레드를 사용 | 한국어·전문 용어 품질 및 처리량의 상한을 실측해야 함 | multilingual small WebGPU 후보, base 저사양 모드 |
| `mergeLines`가 마지막 항목의 공백·대소문자를 없애 비교 | 음성 항목이 사이에 끼면 OCR 중복을 놓치고 대소문자 차이가 중요한 표현은 합칠 수 있음 | 출처·슬라이드·위치를 포함한 비교 |
| `collapseRepeats`가 반복 문자열을 규칙적으로 축약 | 직접 재현 시 `100000 → 100`, `1000만 원 → 100만 원`으로 숫자도 변하며 `removed: 0`으로 보고됨 | 숫자·단위·수식 보호를 먼저 추가하고 시간·겹침·신뢰도 근거로 제한 |
| 외부 요약은 앞 30,000자만 사용 | 강의 후반부가 요약에서 제외됨 | 전체 구간을 청크별로 처리한 후 통합 |
| 사이드패널이 상태와 캡처 수명을 소유 | 패널 닫힘이 작업 종료·데이터 상실과 연결됨 | offscreen 세션과 표시 UI 분리 |

기존 설명과 구현의 차이도 정리해야 한다. `AGENTS.md`와 manifest는 원본의 외부 전송을 금지하지만 `lib/ai.js:39`, `sidepanel.js:374`에는 원격 이미지 OCR 경로가 있다. 원문 타임라인과 파일 내보내기 역시 현재의 ‘구조화된 요약만 제공·강의 데이터 파일 저장 금지’ 규칙과 맞춰 검토해야 한다. 이 설계에서는 **이미지·오디오는 로컬 처리, 사용자가 선택한 텍스트 요약만 외부 전송**을 기준으로 삼는다. 이번 작업에서는 해당 코드나 규칙을 변경하지 않았다.

## 3. MV3 실행 구조와 수명

| 구성 요소 | 책임 | 보관하는 데이터 |
|---|---|---|
| `background.js` | 사용자 시작 동작, 권한, offscreen 생성·조회·중지 전달 | 지속 상태 없음 |
| `content.js` | 영상 식별, ROI 선택, `currentTime`·seek·배속·레이아웃 이벤트 | 최소한의 현재 영상 메타데이터 |
| 새 `offscreen.html/js` | MediaStream 소유, 세션 상태, 작업 큐, 종료 처리 | 제한된 원본 버퍼와 텍스트 근거 |
| `visual-gate.js` | ROI 변화·전환·필기 감지, OCR 작업 선정 | 작은 기준 이미지, 변화 지도, 제한된 후보 프레임 |
| OCR Worker | 탐지→글줄 crop→인식→bbox·confidence 반환 | 실행 중인 입력과 모델 |
| AudioWorklet + ASR Worker | PCM·VAD·발화 분할·전사 | 제한된 PCM과 모델 |
| `evidence.js` | 시간 정렬, 보수적 중복 처리, 근거 ID·revision | 텍스트·bbox·타임스탬프 |
| `summary.js` | 청크 생성, 선택한 API 호출, 결과 스키마 검사 | 요청 중 텍스트와 구조화된 요약 |
| `sidepanel.js` | 시작·중지·진행 상태·요약·근거 시각 표시 | 표시용 상태 |

Vanilla JS ES modules를 유지한다. 상태 관리 프레임워크, 메시지 브로커, 벡터 DB, 서버 OCR 워커 풀은 필요하지 않다. Worker 파일은 독립 진입점이 필요한 만큼만 분리한다.

기본 캡처는 사용자 동작으로 권한을 받은 `chrome.tabCapture`의 stream ID를 offscreen document에서 소비하는 구조를 검증한다. 임의 탭 ID를 선택했다고 캡처 권한이 생기지는 않는다. 특히 현재 코드가 대응하려는 **툴바 없는 강의 팝업, iframe, 별도 창**에서 시작 동작이 성립하는지 첫 단계에서 확인한다. 적법한 일반 캡처 경로가 없으면 미지원 상태로 중단한다. DRM·캡처 차단을 감지한 뒤 다른 경로로 우회하지 않는다.

[Chrome tabCapture 문서](https://developer.chrome.com/docs/extensions/reference/api/tabCapture)는 Chrome 116부터 서비스 워커에서 얻은 stream ID를 offscreen document에서 소비하는 경로를 설명한다. 최소 Chrome 버전은 116 이상을 출발점으로 하되 실제 WebGPU·모델 런타임 요구 버전까지 확인해 확정한다. 탭 오디오는 캡처 시작 시 원래 출력 동작이 바뀔 수 있으므로 AudioContext의 destination 연결과 중지 시 복원도 시험한다.

영상 요소 직접 캡처가 정상 작동하는 사이트는 기존 경로를 과도기적으로 유지할 수 있지만, 캔버스 CORS·오디오 노드 점유·사이트 CSP 차이를 호환성 시험에 포함한다. 직접 캡처 실패를 감추는 자동 우회는 두지 않는다.

offscreen 내부에서 영상 프레임과 PCM을 처리하면 extension `runtime.Port`로 큰 base64를 보낼 필요가 없다. **Chrome runtime 메시지는 JSON 직렬화이고, 일반 Worker의 transferable과 다르다.** `ImageBitmap`·`ArrayBuffer` 소유권 이전은 offscreen↔Worker 경계에서만 사용하고, Chrome runtime에는 제어·상태·텍스트를 보낸다. [Chrome 메시지 직렬화 문서](https://developer.chrome.com/docs/extensions/develop/concepts/messaging)

offscreen은 서비스 워커보다 적절한 세션 소유자지만 영구 실행이나 장애 복구 저장소는 아니다. 상태는 `preparing → running → draining → completed`, 별도로 `paused / failed / disposed` 정도면 충분하다. 재연결 시 `sessionId + generation`으로 현재 세션을 조회하며, 이전 세션의 늦은 인식 결과는 버린다. 패널 닫힘과 명시적 세션 종료를 구분하고, 캡처 중임을 다시 확인·중지할 UI를 제공한다. 브라우저 종료·충돌 때 메모리 자료는 복구할 수 없다.

[Chrome offscreen 문서](https://developer.chrome.com/docs/extensions/reference/api/offscreen)에 따르면 extension API 중 `chrome.runtime`만 사용할 수 있고, 일반 프로필에서 동시에 하나의 offscreen document를 연다. 초기 제품은 강의 세션 하나만 허용해 자원 소유를 단순하게 한다. 실제 용도에 맞는 `USER_MEDIA`·`WORKERS` 등의 reason을 사용한다. `AUDIO_PLAYBACK`만 지정하면 소리가 없는 30초 뒤 문서가 닫힐 수 있으므로 이를 장시간 강의 세션의 수명 보장으로 사용하지 않는다. 생성·조회는 서비스 워커, 실제 세션 상태는 offscreen이 소유한다.

## 4. 동적 슬라이드 추출 로직

다음 숫자는 **벤치마크 결과가 아니라 최초 실험값**이다. 기기·배속·강의 유형에 따라 조정한다.

### 4.1 ROI를 먼저 결정한다

초기에는 사용자가 슬라이드 영역을 드래그하는 방식이 가장 안정적이다. 영상 전체와 영역 선택을 제공하고 정규화 좌표로 저장한다. 교수 얼굴, 플레이어 버튼, 자막 영역을 기본 슬라이드 ROI에 포함하지 않는다. 자막을 이용하는 모드는 별도 출처로 기록한다.

영상 크기·화면 분할·전체화면이 바뀌면 ROI를 재검증한다. 이전 좌표를 다른 레이아웃에 그대로 적용하지 않는다. 자동 슬라이드 탐지는 수동 ROI 기반 평가가 끝난 후 추가한다. 교수와 슬라이드가 겹치는 경우는 영구 마스킹보다 일시 가림 판정으로 처리한다.

### 4.2 감시와 OCR 주기를 분리한다

- 안정된 화면: 미디어 시간 기준 약 **초당 2회** 저비용 감시.
- 변화·필기 진행: 약 **초당 4~8회**로 잠시 올리고 전체 기기 부하에 상한을 둔다.
- 변화가 멈춘 뒤 **0.5~0.8초** 안정화하면 OCR.
- 필기가 계속되어도 **2~3초** 이상 무한히 기다리지 않고 누적 변화 영역을 OCR.
- 감시 누락을 검출하기 위해 **10~15초**마다 텍스트가 있을 법한 영역을 재확인한다. 변화가 작지만 존재하거나 신뢰도가 낮을 때 인식하고, 초기 검증에서는 주기적인 전체 재인식도 비교군으로 둔다.

`requestVideoFrameCallback`을 감시 스케줄과 미디어 시각 취득에 활용하되 모든 디코딩 프레임에서 픽셀 계산·OCR을 실행하지 않는다. 백그라운드 스케줄링 지연도 측정하며, 감시 사이에 나타났다가 사라진 화면을 100% 보존한다고 약속하지 않는다.

### 4.3 전환·필기·잡음을 따로 판정한다

| 상황 | 신호 | 처리 |
|---|---|---|
| 새 슬라이드 | 넓은 영역의 배치·경계·영상 특징 변화 | 이전 슬라이드 마지막 후보를 먼저 확정하고 새 슬라이드 전체 OCR |
| 불릿 순차 등장 | 일부 글줄의 지속적 추가 | 같은 슬라이드의 새 revision, 해당 글줄과 주변 문맥만 OCR |
| 필기 | 작은 영역에 쌓이는 새 획 | 마지막 **인식 완료 기준 화면** 대비 누적 변화 영역 재인식 |
| 지우기·고치기 | 기존 획 소실, 덧쓰기 | 해당 영역 전체 재인식, 이전 텍스트를 superseded로 기록 |
| 커서·레이저 포인터 | 작고 이동하는 일시 변화 | 짧은 시간 지속성을 보고 OCR 트리거 억제 |
| 교수 손·몸의 가림 | 이동하며 생겼다 사라지는 가림 | 가능한 마지막 선명 프레임 유지, 장기 가림은 미인식 표시 |
| 스크롤·확대 | 텍스트 블록의 공통 이동 | 먼저 좌표 정렬, 새로 노출된 영역 인식; 초기 버전은 ROI 전체 재인식 |
| 동영상·애니메이션 삽입 | 계속되는 넓은 변화 | OCR 빈도 제한, 텍스트 ROI만 처리하고 시각 의미는 미추출 표시 |

평균 픽셀 차이나 pHash 하나로 결정하지 않는다. 넓은 전환에는 저해상도 grayscale 차이와 edge 변화가 유용하지만, 작은 필기는 그 단계에서 사라질 수 있다. **전체 저해상도 감시 + 중간 해상도 타일별 획·edge 변화**를 함께 사용한다. pHash가 같다는 이유로 인식을 영구 생략하지 않는다.

직전 프레임끼리만 비교하면 천천히 쓰는 필기가 기준 아래로 계속 지나간다. 따라서 `previousSample`은 움직임·안정화에, `lastRecognizedSample`은 누적 변화에 각각 사용한다. OCR 완료 전에는 두 번째 기준을 갱신하지 않는다.

### 4.4 인식 단위를 글줄·영역으로 만든다

큰 전환 때는 ROI 전체에서 텍스트 박스를 탐지한다. 이후에는 바뀐 타일을 합치고 여백을 추가해 인접 글줄을 포함한다. 글자 하나 크기로 너무 잘게 자르면 인식 문맥을 잃는다. 이미 인식한 bbox와 좌표가 맞는지 확인하고, 짧은 주기와 슬라이드 종료 때 전체 레이아웃을 다시 확인한다.

crop은 원본 해상도를 이용하며 전체 이미지를 일괄 768px로 줄이지 않는다. 글자 높이에 맞게 리사이즈하되 정보가 원본에 없으면 확대만으로 복구되지 않는다. 슬라이드 전환 직전의 마지막 선명 프레임을 제한된 슬롯에 유지해야 마지막 필기를 인식할 수 있다.

**필기 감지와 필기 해독은 별개다.** 작은 변화 감지가 성공해도 손글씨·수식 인식은 실패할 수 있다. 낮은 신뢰도의 영역은 같은 원본 crop의 대비·배율을 바꾸어 최대 한 번 재시도하고, 여전히 불명확하면 `unresolved`로 남긴다. 이미지가 없어지기 전에 재시도를 끝내며 무제한 재시도하지 않는다.

## 5. 모델 선정

**OCR은 PP-OCRv5 mobile의 공식 ONNX 탐지기 + 한국어 전용 ONNX 인식기, ASR은 multilingual Whisper small의 ONNX 버전을 기본 개발 대상으로 선정한다.** Tesseract와 기존 Whisper base는 지원 기기·성능 비교를 위한 대안으로 남긴다. 고성능 기기에는 Whisper large-v3-turbo를 별도로 평가한다.

| 역할 | 정확한 모델·프로젝트 | 선정 이유와 확인 범위 | 브라우저 적용 상태 |
|---|---|---|---|
| 텍스트 영역 탐지 | [PaddlePaddle/PP-OCRv5_mobile_det_onnx](https://huggingface.co/PaddlePaddle/PP-OCRv5_mobile_det_onnx) | 공식 ONNX 배포, 작은 탐지기로 영역 crop을 먼저 만듦. Apache-2.0 표기 | ONNX Runtime 예제 확인. **ORT Web/WebGPU·WASM은 프로젝트에서 검증 필요** |
| 한글·영문 슬라이드 글줄 인식 | [PaddlePaddle/korean_PP-OCRv5_mobile_rec_onnx](https://huggingface.co/PaddlePaddle/korean_PP-OCRv5_mobile_rec_onnx) | 한국어 전용 인식기. 혼합 언어 슬라이드는 이 모델로 시작해 영어·숫자 정확도도 따로 측정. Apache-2.0 표기 | 공식 ONNX가 있으므로 원본 변환부터 만들 필요 없음. 전처리·문자 사전·후처리·Web 실행 통합 필요 |
| 기존 OCR 대안 | [naptha/tesseract.js](https://github.com/naptha/tesseract.js), 기존 `kor+eng` 리소스 | 이미 사용하는 브라우저 WASM 경로를 재사용. 감지 개선 효과의 기준선 | 기존 프로젝트 실행 경로 있음. 필기·수식·복잡한 레이아웃의 품질 상한은 별도 평가 |
| 기본 ASR | [onnx-community/whisper-small](https://huggingface.co/onnx-community/whisper-small) | [openai/whisper-small](https://huggingface.co/openai/whisper-small)의 multilingual 모델. 변환본 카드에 Transformers.js 호환 명시 | ONNX 파일·호환 선언 확인. 새 Worker와 실제 Chrome/WebGPU 성능 시험 필요 |
| 저사양 ASR | 기존 `Xenova/whisper-base` | 현재 코드의 WASM 경로를 활용하며 small보다 작은 모델로 처리량 비교 | 기존 경로 유지 가능. 한국어 강의 품질을 small과 동급으로 보장하지 않음 |
| 고성능 ASR | [onnx-community/whisper-large-v3-turbo](https://huggingface.co/onnx-community/whisper-large-v3-turbo) | multilingual turbo의 Transformers.js 호환 ONNX 변환본 | 설치·기동·GPU 메모리·OCR 동시 부하를 확인한 기기에만 제공 |
| 발화 감지 | [snakers4/silero-vad](https://github.com/snakers4/silero-vad) | MIT, ONNX 지원. 공식 README에서 [브라우저 ONNX Runtime Web 구현](https://github.com/ricky0123/vad)을 안내 | ASR과 분리된 작은 VAD로 통합. microphone wrapper를 그대로 붙이지 않고 탭 PCM에 연결 |

**PP-OCRv5라는 이름만 지정하면 충분하지 않다.** 기본 `PP-OCRv5_server_rec`의 언어 범위와 한국어 전용 `korean_PP-OCRv5_mobile_rec`을 구분해야 한다. [공식 한국어 카드](https://huggingface.co/PaddlePaddle/korean_PP-OCRv5_mobile_rec)에는 한국어 전용 모델과 평가 기준이 따로 제시되어 있다. 해당 원본 카드의 H1에 server 이름이 남아 있지만 repo ID와 예제에서 사용하는 모델명은 한국어 mobile이다. 카드의 88% 수치는 특정 데이터셋의 **글줄 전체 일치율**로, 이 제품의 한국어 CER나 강의 정확도가 아니다.

원본 한국어 모델 파일 목록에는 Paddle 포맷이 있지만, 별도의 공식 `_onnx` 저장소도 현재 존재한다. 따라서 ‘Paddle을 브라우저에서 쓰려면 모델 변환기를 먼저 만들어야 한다’고 계획하지 않는다. 먼저 공식 ONNX를 다운로드해 **원래 Python 결과와 Web 결과가 일치하는지** 확인한다. dynamic shape, CTC decoding, 문자 사전, 모델이 요구하는 resize/normalization, WebGPU 미지원 연산과 WASM 성능이 검증 대상이다. Python `onnxruntime` 예제 성공은 `onnxruntime-web` 성공을 의미하지 않는다.

Whisper는 우선 q8 계열을 품질 기준으로 비교하고 메모리 문제가 확인되면 지원되는 q4·모듈별 정밀도를 비교한다. 형식·정밀도 이름은 실제 모델 파일과 런타임 버전으로 고정한다. WebGPU가 없거나 device loss가 발생하면 미리 선택한 로컬 저사양 모드로만 전환하거나 중단한다. GPU 사용이 가능하다는 이유만으로 large-v3-turbo를 자동 다운로드하지 않는다.

Whisper의 [원본 small HF 카드](https://huggingface.co/openai/whisper-small)는 Apache-2.0으로 표시되어 있고 변환본 카드는 원본 모델을 연결한다. 배포 때 실제로 선택한 가중치 revision과 런타임의 라이선스·고지를 함께 고정한다. 모델 가중치 파일 크기를 전체 RAM·VRAM 요구량으로 표시하지 않는다.

### 필기·수식·도표의 고품질 경로

[PaddleOCR-VL-1.6](https://huggingface.co/PaddlePaddle/PaddleOCR-VL-1.6)을 고품질 재인식의 연구 후보로 둔다. 공식 카드에서 0.9B 모델, 표·수식·차트 등의 처리와 Python/Transformers 실행을 확인했다. 비교한 [1.5 카드](https://huggingface.co/PaddlePaddle/PaddleOCR-VL-1.5)도 후속 버전으로 1.6을 안내하며, 1.5에는 별도 llama.cpp/GGUF 경로가 공개되어 있다. 한국어 판서·수식의 정답률이나 Chrome 확장 WebGPU에서의 실행은 이번 조사로 검증되지 않았다. 따라서 **전체 프레임을 이 모델에 상시 넣는 구성을 기본판으로 선정하지 않는다.**

기본 OCR이 실패한 crop에 한정한 로컬 VLM 재인식을 연구할 수 있다. 브라우저에서 해당 모델의 추론·메모리·취소가 검증되기 전에는 `unresolved` 표시가 정식 기본 동작이다. 브라우저 한계를 넘는 품질이 필요하면 향후 별도 보조 앱에서 PaddleOCR-VL과 [whisper.cpp](https://github.com/ggml-org/whisper.cpp) 또는 ALT 공개 엔진을 평가한다. 외부 원본 전송으로 대체하지 않는다.

Gemini Nano는 현재 프로젝트의 선택 기능으로는 남길 수 있으나 특정 Chrome·기기·가용 언어·API 지원에 의존하므로 유일한 필수 OCR 엔진으로 삼지 않는다. 작은 OCR 모델로 해결되는 인쇄 슬라이드에 범용 VLM을 항상 실행할 이유는 없다.

## 6. 메모리와 처리량 제어

사용자의 ‘텍스트를 추출한 뒤 이미지는 삭제’ 방향이 맞다. 다만 변화 감지용 작은 기준 이미지와 아직 확정하지 않은 마지막 화면까지 즉시 버리면 누적 필기·전환 직전 화면을 놓친다. **한 세션 전체 이미지를 모으지 않고 필요한 몇 개 슬롯만 유지한다.**

| 종류 | 최초 예산안 | 수명 |
|---|---:|---|
| 전체 프레임·OCR crop | 실행 1개, 대기·마지막 후보 합쳐 최대 3개 추가 / 총 64 MiB | OCR·제한된 재시도 종료 후 해제 |
| 변화 감지 기준 이미지 | 작은 grayscale·edge 지도 2~3개 | 기준 교체 시 이전 참조 해제 |
| PCM | 16 kHz mono float32, 최대 60초 약 3.66 MiB | 전사 확정·겹침 정렬 후 해제 |
| 근거 텍스트·인덱스 | 직렬화 기준 우선 16 MiB, 실제 heap도 측정 | 세션 종료까지; 상한 접근 시 안내 후 중단·세션 분리 |
| 모델·런타임·GPU 메모리 | 별도 측정·기기별 상한 | 세션/엔진 수명에 맞춰 dispose |

1920×1080 RGBA 한 장은 약 **7.91 MiB**다. 네 장이면 약 31.64 MiB이고, 디코딩·crop·tensor·GPU 복제까지 더해진다. 4K 한 장은 약 31.64 MiB이므로 개수만 제한해서는 부족하다. **64 MiB는 원본 작업 예산이며 확장 전체 메모리 보장이 아니다.** 각 예산을 동시에 상한까지 사용한다는 뜻도 아니다.

Worker `postMessage`의 transfer list로 소유권을 넘기고, `finally`에서 `ImageBitmap.close()`·`VideoFrame.close()`·object URL 해제·배열 참조 제거를 수행한다. `null` 할당만으로 GPU 자원이 즉시 반환된다고 가정하지 않는다. AbortController와 세션 generation으로 취소·늦은 결과도 정리한다.

**같은 슬라이드에서 앞의 내용을 유지하며 추가만 된 중간 revision을 최신 후보로 합친다.** 지우기·정정·일시적으로 나타난 내용은 앞 상태가 최신 이미지에 남아 있지 않을 수 있으므로 별도 후보를 보존한다. 다른 슬라이드를 단순 FIFO로 삭제하지 않는다. 새로운 슬라이드가 계속 들어와 수용 능력을 넘으면 VOD는 지원·허용된 재생 제어로 일시정지하는 선택을 제공하고, 라이브는 유실 시각과 원인을 기록한다. 유한 메모리에서 무한 입력·느린 추론·무손실을 동시에 보장할 수는 없다.

ASR은 승인된 작업 하나만 실행하고 PCM을 제한된 링 버퍼로 받는다. OCR과 ASR이 GPU를 무제한으로 동시에 점유하지 않게 하고, 음성 backlog에 우선권을 주되 OCR도 최대 지연시간을 넘기지 않도록 한다. 초기에 한 GPU 추론씩 실행하는 단순한 스케줄로 시작하고, 동시 실행은 실측 이득이 확인될 때만 허용한다.

강의 데이터는 `chrome.storage`·IndexedDB·Cache Storage·파일·분석 로그에 저장하지 않는다. 이미 사용 중인 **모델 가중치 캐시**는 강의 데이터와 분리된 정적 리소스 캐시로 명시한다. 모델 버전·해시·용량을 고정하고 동봉 JS/WASM만 실행하며, 모델 다운로드를 원격 코드 다운로드와 혼동하지 않는다. API 키·설정은 trusted extension context에 한정하고, 키를 content script나 동기화 저장소에 보내지 않는다.

## 7. 한국어·영어 음성 파이프라인

기본 단계는 `AudioWorklet → mono 16 kHz → VAD → 발화 청크 → Whisper → 겹침 정렬 → 확정된 텍스트`다.

- VAD 앞쪽 **300~500ms**를 보존하고 발화가 끝난 뒤 **500~800ms** 정도 여유를 둔다. 작은 소리·첫 음절이 잘리지 않는지 평가한다.
- 발화 청크는 대략 **8~20초**, 무음이 없는 긴 발화는 최대 **25~30초**에서 분할하고 **1~2초** 겹친다. 실제 구현은 모델 입력 제한을 따른다.
- 강의 주 언어 `한국어 / 영어 / 자동`을 설정한다. 충분히 긴 구간으로 초기 자동 추정 후 안정화하고, 한국어 발화 속 영문 용어가 유지되는지 별도로 평가한다. 영어 전용 `.en` 모델을 공통 기본값으로 사용하지 않는다.
- `task: transcribe`를 사용한다. 영어 강의를 무조건 한국어로 번역해 ASR 근거를 덮어쓰지 않는다. 번역·요약은 뒤 단계에서 한다.
- OCR의 고신뢰 전문 용어는 ASR 런타임이 지원할 때 길이가 제한된 힌트로만 제공한다. 슬라이드 전체 텍스트로 발화를 유도하지 않는다.
- 강의에는 보통 주 화자 한 명이므로 화자 분리는 초기 기본 구성에서 제외한다. 질의응답 구별의 가치가 확인되면 추가한다.

음성과 영상은 공통 시계에 매핑한다. `sessionId`, `epoch`, 실제 캡처 시각, `mediaTime`, 재생 속도, 청크의 시작·끝을 기록한다. seek·다른 영상 전환은 epoch를 나눈다. ASR의 상대 timestamp는 해당 PCM의 시계 매핑으로 변환한다. DOM 영상 시간을 얻지 못하면 세션 경과 시간으로 표시하고 정확도를 과장하지 않는다.

현재 `rate`는 로그에 표시되지만 `lib/audio.js`가 배속을 원속도로 복원하지는 않는다. **재생 속도 값을 곱하거나 단순 resampling했다고 원음으로 복원됐다고 말해서는 안 된다.** 브라우저의 pitch preservation까지 고려해야 한다. 먼저 1×·1.5×·2× 입력을 그대로 전사해 평가하고, 품질·처리량이 기준 아래면 재생 속도를 낮추도록 안내한다.

## 8. 보수적 중복 제거와 근거 구조

원문을 통째로 삭제하는 중복 제거보다 **요약에 사용할 근거를 연결·대표화하는 처리**를 우선한다. 화면과 음성 원문은 서로 확인해 주는 독립 근거다.

```json
{
  "id": "ev-104",
  "sessionId": "session-a",
  "epoch": 2,
  "source": "ocr",
  "slideId": "slide-8",
  "revision": 3,
  "t0": 321.4,
  "t1": 338.8,
  "bbox": [0.12, 0.24, 0.64, 0.12],
  "text": "읽힌 텍스트",
  "confidence": 0.91,
  "status": "confirmed",
  "supersedes": ["ev-99"],
  "relatedEvidenceIds": ["asr-61"]
}
```

이것은 구현할 데이터 형태의 예시다. bbox는 ROI 내 정규화 좌표이며 ASR에는 없을 수 있다. confidence를 출력하지 않는 모델에는 숫자를 만들어 넣지 않고 `null`로 둔다. 모델별 confidence 척도를 직접 비교하지 않는다. OCR `t0/t1`은 화면에 존재한 구간, ASR은 발화 구간이므로 같은 값이라고 가정하지 않는다.

| 종류 | 자동 처리해도 되는 범위 | 보존해야 할 차이 |
|---|---|---|
| 같은 OCR 결과 | 같은 slide·bbox·안정 상태에서 NFC·공백 정돈 후 완전 일치 | 숫자, 단위, 기호, 대소문자, 부정, 위치·열 차이 |
| OCR 재인식의 미세 차이 | 시각 특징과 위치가 같고 더 나은 인식이라는 근거가 있을 때 revision 연결 | 실제 덧쓰기인지 오인식인지 애매하면 둘 다 유지 |
| 겹친 ASR 청크 | 겹친 **시간 구간 안에서** 이전 suffix와 새 prefix가 일치·정렬될 때 | 새 시각에 다시 말한 동일 문장, ‘아니고’ 같은 정정 |
| Whisper 반복 루프 | 낮은 신뢰도·무음 근거·비정상 반복이 함께 있을 때 표시·제한적 축약 | 실제 강조 발화는 repetitionCount와 시각 보존 |
| OCR와 ASR의 동일 개념 | `relatedEvidenceIds`로 연결하고 요약 입력에서 대표화 | 발화에만 있는 조건·예외·예시·정정은 독립 근거 유지 |

예를 들어 슬라이드의 ‘상관관계’와 교수의 ‘상관관계가 인과관계를 뜻하는 것은 아닙니다’를 유사하다는 이유로 합쳐 버리면 핵심 내용을 잃는다. `>`와 `<`, `15`와 `50`, `may`와 `must`, `p`와 `P`도 보존한다. 임베딩 유사도만으로 삭제하지 않는다. 짧은 문장·수식에는 특히 완전 일치에 가까운 기준을 적용한다.

## 9. LLM 요약 방식

### 9.1 OpenRouter 모델 선택

**기본 요약 후보는 `google/gemini-3.8-flash`, 저비용 선택지는 `google/gemini-2.5-flash-lite`, 상세 노트 비교 후보는 `anthropic/claude-sonnet-5`로 제안한다.** 이는 현재 카탈로그·비용 구조를 바탕으로 한 초기 선정이며, 이 강의 데이터에서의 품질 우위는 아직 평가하지 않았다. 기본판에는 한 모델을 먼저 연결하고 같은 평가셋에서 후보를 비교한다.

2026-09-10 Aside CLI로 [OpenRouter 공식 모델 카탈로그 API](https://openrouter.ai/api/v1/models)를 조회해 아래 ID·단가·structured output 지원을 확인했다. 모두 일반 동기 텍스트 요청의 USD / 100만 토큰, 캐시 미스 기준이다.

| 후보 | 입력 / 출력 | 사용 판단 |
|---|---:|---|
| `google/gemini-3.8-flash` | $0.75 / $3.75 | 기본 요약 평가 후보. 장문·구조화 출력을 포함한 현재 Flash 계열 |
| `google/gemini-2.5-flash-lite` | $0.10 / $0.40 | 비용 우선 요약, 간단한 청크 구조화의 비교군 |
| `google/gemini-3.1-flash-lite` | $0.25 / $1.50 | Flash-Lite의 추가 비교군; 2.5 대비 품질 이득을 측정할 때 |
| `google/gemini-2.5-flash` | $0.30 / $2.50 | 기존 계열 기준선; 최신 후보와 같은 평가셋에서 비교 |
| `anthropic/claude-haiku-4.5` | $1.00 / $5.00 | Claude 계열 대안. Flash보다 우수하다는 결론은 실험 전 유보 |
| `anthropic/claude-sonnet-5` | $2.00 / $10.00 | 상세 구조화·논점·수식 설명의 상위 비용 비교군 |

같은 API에서 모두 `structured_outputs` 지원을 확인했지만 실제 라우팅 provider가 요구 기능을 제공하는지도 요청 시 강제한다. `:batch`, preview, 이미지 생성 변형을 일반 요약 ID와 혼동하지 않는다. 현재 3.8이 카탈로그에 있다는 사실만으로 2.5/3.1/Claude 대비 학습 노트 품질이 더 좋다고 단정하지 않는다.

예를 들어 **모든 청크 처리와 최종 통합을 합친 총 입력 30,000·총 출력 4,000 토큰**이라면 텍스트 추론 단가는 Flash-Lite 2.5 약 $0.0046, Flash 3.8 약 $0.0375, Haiku 4.5 약 $0.05, Sonnet 5 약 $0.10이다. 특정 길이의 강의가 반드시 이 토큰 수를 쓴다는 뜻이 아니다. reasoning·재시도·라우팅별 추가 요금·크레딧 구매 수수료는 별도이며 실제 응답 usage와 청구 비용으로 확인한다.

기존 `tools/compare-notes-2026-09-10T06-20-47.md`는 짧은 준비 텍스트의 단발 요약 비교다. 실제 장시간 강의를 캡처·OCR·ASR부터 처리한 검증으로 해석하지 않는다. 기존 `tools/compare-models.mjs`의 부분 문자열 모델 검색은 평가 때 정확한 allowlist ID로 고정해 다른 모델을 고르는 일을 막는다. 이번 조사에서는 유료 모델 호출을 실행하지 않았다.

### 9.2 전체 구간을 보존하는 요약

누적 원문 전체를 매번 보내거나 앞부분만 잘라 보내지 않는다. 슬라이드 구간과 완결된 발화를 함께 묶고 토큰 예산을 적용한다. **전체 입력 coverage를 유지하는 청크 처리**가 우선이다.

1. 슬라이드 변경·주제 구간으로 근거를 묶는다. 긴 구간은 대략 6k~12k 입력 토큰으로 나누되 실제 tokenizer와 모델 context 한도를 따른다.
2. 각 청크에서 `concepts`, `claims`, `definitions`, `formulas`, `examples`, `corrections`, `openQuestions`, `evidenceIds`를 구조화한다. 모호한 인식은 uncertainty에 남긴다.
3. 청크별 구조화 결과로 최종 학습 노트를 만든다. 최종 단계에도 필요한 직접 근거·정정 문장을 함께 제공한다. 요약을 반복 요약해 정보가 계속 사라지는 경로는 피한다.
4. 최종 결과는 개요·개념·관계·정정·질문과 근거 시각을 포함한다. 모든 입력 청크의 처리 상태와 누락·미인식 구간을 별도 추적한다.

JSON Schema 지원 모델·provider를 선택하고 로컬 검증을 수행한다. 존재하지 않는 evidence ID, 잘린 출력(`finish_reason`), 누락 청크, 표·수식의 불완전한 구조를 확인한다. 형식 오류는 한 번 제한적으로 재요청하되 다른 모델·공급자로 몰래 전환하지 않는다. 근거 ID가 실제 존재하는지 확인하는 것만으로 의미 충실성이 증명되지는 않으므로 사람 평가를 병행한다.

OCR·ASR 텍스트는 명령이 아니라 비신뢰 데이터로 구분해 입력한다. 요약 모델에 도구 실행 권한을 주지 않는다. 텍스트에 포함된 ‘앞의 지시를 무시하라’ 같은 문장을 실행하지 않도록 시스템 지침과 데이터 영역을 분리한다.

**이미지를 버린 뒤에는 텍스트로 남기지 못한 도표·화살표·공간 관계를 복구할 수 없다.** OCR 단계에서 bbox·읽기 순서·가능한 표 구조·수식 표현을 보존하고, 제대로 읽지 못한 도형은 그 사실과 시각만 남긴다. 일반 OCR만으로 ‘슬라이드 전체 의미를 빠짐없이 이해한다’는 제품 약속은 하지 않는다.

## 10. API와 소비자 구독 연결

OpenRouter 연결은 요약 provider 선택과 사용자 인증을 분리한다. **세 서비스의 소비자 구독을 공통 OAuth로 연결해 요약 API처럼 사용하는 기능은 기본 출시 항목으로 확정할 수 없다.** 각각의 공식 사용 범위가 다르다.

| 연결 | 현재 확인한 공식 범위 | 제품 결정 |
|---|---|---|
| OpenRouter | 사용자 API 키 및 OAuth PKCE 방식의 사용자 키 발급 | 기본 연결 대상. 사용자 OpenRouter 잔액·한도로 과금 |
| ChatGPT 구독 | 공식 Codex 클라이언트의 ChatGPT 로그인은 지원. 현재 인증 문서는 programmatic CLI 워크플로에 API 키 사용을 안내 | ChatGPT 로그인 토큰을 범용 요약 API로 재사용하지 않음. 초기에는 OpenAI/OpenRouter API 연결 |
| Claude 구독 | 자체 앱에 Claude.ai 로그인을 제공하거나 사용자 Free/Pro/Max 자격증명으로 요청을 중계하는 방식은 제한 | 제품 내 직접 구독 로그인 기능을 약속하지 않음. API 키·지원 cloud provider 경로 우선 |
| Gemini 구독 | Gemini CLI는 Google AI Pro/Ultra 가입 계정으로 로그인할 수 있고 headless 모드에서 기존 인증을 사용할 수 있음 | 이는 CLI의 공식 사용 범위. 확장 단독의 범용 구독 API로 보지 않음; 기본은 API 키 |

근거: [OpenRouter OAuth PKCE](https://openrouter.ai/docs/guides/overview/auth/oauth), [OpenAI 공식 인증 문서](https://learn.chatgpt.com/docs/auth), [Claude Code의 인증·제품 제공 조건](https://code.claude.com/docs/en/legal-and-compliance), [Gemini CLI 공식 인증 문서](https://geminicli.com/docs/get-started/authentication/).

OpenRouter의 PKCE는 사용자에게 귀속된 API 키를 발급하는 연결 방식이다. ChatGPT·Claude·Gemini 소비자 구독의 사용량을 가져오는 기능이 아니다. 초기 BYOK 이후 연결 UX를 개선할 때 S256 PKCE를 사용하고, Chrome 확장 콜백 URL과 인증 창의 호환성을 확인한다. 키·인가 코드·verifier는 로그에 남기지 않는다. 문서 예제의 Buffer 패키지를 그대로 도입할 필요 없이 Web Crypto와 브라우저 base64 처리를 사용할 수 있다.

Claude 문서는 사용자가 **변경하지 않은 Claude Code 바이너리**에 본인 계정으로 직접 로그인하는 경우와, 제3자 앱이 자격증명을 수집·중계하는 경우를 구분한다. 따라서 모든 로컬 CLI 연동이 무조건 금지됐다고 해석하지도 않는다. 다만 이 예외가 이 제품의 자동 요약 중계를 허용하는지는 별도 확인이 필요하다. Native Messaging 보조 앱을 만든다고 인증·서비스 조건이 자동으로 해결되지는 않는다.

확장 프로그램은 로컬 CLI 바이너리를 직접 실행하지 못한다. 향후 사용자가 보조 앱 설치를 선택하면 Native Messaging host에서 공식 클라이언트를 실행하는 방식을 검토할 수 있지만, 이는 **추가 설치가 필요한 다른 배포 옵션**이다. 인증 파일·브라우저 쿠키를 읽어 자체 LLM 요청 헤더로 재사용하는 경로는 설계하지 않는다. CLI 자체의 대화 로그·세션 파일 생성도 현재의 강의 데이터 무저장 규칙을 충족하는지 따로 확인해야 한다. [Chrome Native Messaging 문서](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)

구독 활용을 꼭 제공하려면 사용자 본인이 사용하는 공식 앱 안의 지원되는 확장·커넥터 흐름이나 명시적 인계 기능을 별도 제품 흐름으로 검토한다. 현재 기본 확장에는 API 연결이 실제로 구현된 범위만 표시한다. 지원을 확인하지 않은 ‘ChatGPT/Claude/Gemini 구독 연결’ 버튼은 준비 완료로 노출하지 않는다.

초기 제품은 사용자가 연결한 OpenRouter/API 키로 텍스트를 직접 전송하는 단순한 구조가 적합하다. 사용자의 계정에서 발생하는 API 비용을 분명히 표시한다. 운영자 과금형 SaaS를 추가한다면 그 시점에 작은 인증·사용량 제한·요약 프록시를 둔다. 운영자 키를 확장 프로그램에 포함하지 않고 서버 로그에도 강의 본문을 기록하지 않는다.

외부 요약 요청에는 다음 provider 조건을 적용한다. 실제 provider/endpoint의 허용 목록과 하나의 정확한 model ID도 함께 고정한다. 조건에 맞는 경로가 없으면 실패 상태를 보여 주며, 보존 정책을 완화하거나 다른 모델로 자동 변경하지 않는다.

```json
{
  "provider": {
    "require_parameters": true,
    "data_collection": "deny",
    "zdr": true,
    "allow_fallbacks": false
  }
}
```

`allow_fallbacks: false`만으로 특정 공급자가 고정되는 것은 아니다. 구현 시 선택한 endpoint의 `only`/`order`를 함께 설정한다. `require_parameters`는 JSON Schema 등 요청 옵션을 지원하지 않는 공급자가 해당 옵션을 무시하는 일을 막는다. [OpenRouter 공급자 선택 문서](https://openrouter.ai/docs/guides/routing/provider-selection)

학습에 사용하지 않는다는 조건과 무보존은 다르므로 `data_collection: "deny"`만으로 ZDR을 대신하지 않는다. OpenRouter의 ZDR은 추론 endpoint의 정책에 따른 라우팅이며, 웹 검색 같은 별도 도구에는 적용되지 않는다. 일부 일시적인 메모리 prompt cache는 ZDR로 분류될 수 있다. 따라서 ‘공급자에서 어떤 형태의 일시 보관도 전혀 없다’고 설명하지 않는다. 입력·출력 로그 opt-in을 끄고 외부 도구를 사용하지 않는 구성을 기준으로 한다. [OpenRouter ZDR 범위와 예외](https://openrouter.ai/docs/guides/features/zdr)

## 11. 유사 서비스에서 가져올 점

| 서비스·프로젝트 | 공식 자료에서 확인한 점 | Summrizei에 적용할 판단 |
|---|---|---|
| [ALT](https://www.altalt.io/ko) | 온디바이스 음성 인식, 로컬 데이터 보관, 음성·PDF 요약과 퀴즈, 공개 [Lightning-SimulWhisper](https://github.com/altalt-org/Lightning-SimulWhisper) 엔진을 소개 | 로컬 인식으로 분당 API 비용을 줄이는 방향, 하드웨어에 맞는 엔진 최적화, 학습 노트·질문으로 이어지는 흐름을 참고 |
| [Genio — 기존 Glean 도메인이 이동한 서비스](https://genio.co/) | 수업 녹음, Live Captions, AI Outline, 손글씨 Scribble, Quiz를 공식 제품 설명에 포함 | 전사 결과 자체보다 수업을 정리·이해·복습하는 흐름을 최종 결과에 반영. Scribble 기능은 자동 판서 OCR의 증거가 아님 |
| [Screenpipe](https://github.com/screenpipe/screenpipe) | 로컬 화면·음성 캡처를 검색 가능한 맥락으로 만들고, 접근성 트리·OCR·전사를 연결 | 시간·출처를 함께 기록하는 원리를 참고. 일반 영상 픽셀에는 접근성 텍스트가 없으므로 슬라이드 OCR은 여전히 필요 |

ALT의 공개 설명과 [Lightning-SimulWhisper](https://github.com/altalt-org/Lightning-SimulWhisper)는 Apple Silicon의 CoreML·MLX 최적화를 강조한다. 해당 속도 수치는 제작자 측 주장이고 **WASM/WebGPU 확장에서 재현한 결과가 아니다.** Chrome 확장 기본판에 그대로 이식할 수 있다고 가정하지 않는다. 향후 네이티브 배포를 검토할 때 비교할 구현이다.

ALT와 Screenpipe는 로컬에 자료를 보관하는 제품인 반면, 이 프로젝트의 현재 규칙은 강의 데이터를 메모리에만 두는 것이다. 경쟁사의 영구 녹화·검색 DB를 그대로 도입하지 않는다. ALT 홈페이지에서 동적 슬라이드 전환 감지나 판서 OCR의 내부 알고리즘·정확 모델은 확인하지 못했으므로 이 문서의 화면 로직은 **경쟁사의 구현을 재현한 것이 아니라 제안한 설계**다.

랜딩페이지의 성능 수치·샘플 화면은 이 확장 프로그램의 실측 성능이나 경쟁사의 비공개 OCR 아키텍처를 증명하지 않는다.

## 12. 구현 순서와 출시 판단

| 단계 | 구현 범위 | 다음 단계 진입 기준 |
|---|---|---|
| 1. 캡처·수명 | 현재 동작을 기준선으로 기록, tabCapture/offscreen, 시계·중지·수명 정리, 원격 이미지 경로 정리 | 일반 탭·강의 팝업·iframe에서 권한·캡처 가능 범위를 확정 |
| 2. 화면 선택·큐 | ROI, 전환·누적 필기 감지, 이미지 슬롯·바이트 상한 | 고정 간격 대비 누락 감소와 OCR 호출량을 함께 확인 |
| 3. OCR·ASR 교체 | 공식 Paddle ONNX의 Web 통합, Whisper small WebGPU, VAD·겹침 | 한국어·영어 품질과 장시간 실시간 처리량 기준 통과 |
| 4. 근거·요약 | 출처·revision, 보수적 정리, 전체 coverage 청크 요약, OpenRouter 연결 | 삭제 오류·누락 청크·근거 없는 요약을 평가 |
| 5. 선택적 확장 | 고품질 필기/수식 모델, 네이티브 실행, 공식 구독 연동 | 브라우저 기본판의 한계와 추가 설치 가치가 측정으로 확인될 때 |

모델의 Web 런타임 통합과 캡처 호환성은 각각 **1~2일 수준의 범위 제한 spike 목표**를 두되 완료 일정을 보장하지 않는다. 공식 Paddle ONNX가 있다는 이유만으로 ONNX Runtime Web에서 즉시 실행된다고 가정하지 않는다. spike가 실패하면 Tesseract 기반 감지·메모리 개선은 독립적으로 진행하고, 고품질 한국어 OCR 출시 조건은 미충족으로 남긴다.

### 평가 자료와 지표

권한 있는 공개·합성·자체 제작 강의 자료로 한국어/영어 인쇄 슬라이드, 언어 혼합, 작은 글씨, 필기, 수식, 순차 불릿, 가림, 스크롤, 1×/1.5×/2×, seek·일시정지, 2시간 연속 재생을 포함한다. 실제 사용자 강의 이미지·오디오를 새 파일이나 테스트 fixture로 저장하지 않는다. 품질 평가용 자료와 ground truth는 별도로 권한·출처를 확보한다.

| 영역 | 측정값 | 최초 목표 예시 — 아직 측정하지 않음 |
|---|---|---|
| 화면 선택 | 서로 다른 텍스트 상태를 포함한 keyframe recall, 전환·필기 누락 | 정의한 평가셋의 중요한 텍스트 상태 recall ≥99% |
| OCR | 한글 CER·영문 WER, 숫자·단위·기호·수식 보존율 | Tesseract 기준선 대비 개선; 과목별 별도 통과선 |
| ASR | 한국어 CER·영어 WER, 전문 용어 recall, 혼합 언어, 겹침 경계 오류 | tiny/base 기준선 대비 개선 |
| 처리량 | p50/p95 추론 시간, backlog 초, shared GPU 점유 | OCR과 동시 실행 시에도 음성 backlog가 시간에 따라 증가하지 않음 |
| 안정성 | heap·GPU·총 프로세스 메모리 추이, device loss, 워커 중지 | 2시간 세션에서 큐 상한 준수·메모리의 지속적 우상향 없음 |
| 중복 제거 | 삭제한 항목 중 유일한 정보의 비율 | 평가셋에서 잘못 삭제한 핵심 사실 0건 목표; 표본 수 동시 보고 |
| 요약 | 사실 충실성·중요 내용 recall·근거 연결·후반부 포함 | 모든 처리 가능한 청크 포함, 근거 없는 핵심 주장 0건 목표 |

Whisper의 처리 실시간 비율(RTF)은 먼저 **캡처된 오디오 초 대비 처리 시간**으로 정의한다. 실제로 듣는 PCM은 2배속이어도 벽시계 1초에 1초씩 들어오므로 이 기준의 안정 조건은 RTF<1이며 OCR과의 자원 경쟁까지 포함해야 한다. 원본 강의 초 기준으로 지표를 계산할 때만 배속에 따라 기준을 변환한다. 두 정의를 섞어 ‘2배속이면 무조건 RTF<0.5’라고 해석하지 않는다.

이 작업에서는 기존 `node --test lib/*.test.js`를 실행해 5개 테스트 파일이 통과했다. 제안한 모델·캡처 구조·임계값의 실측 통과를 의미하지 않는다. 이번 변경은 검토용 문서와 설계도에 한정된다.

## 13. 출처 및 검토 기록

공개 자료 조사는 사용자가 지정한 Aside CLI로 수행했다. 공식 페이지의 확인 사실, 이 문서의 설계 판단, 아직 검증하지 않은 가정은 구분한다. 모델 카탈로그·가격·구독 정책은 출시 직전에 다시 확인한다.

검토할 산출물:

- 본 설계안: [architecture-proposal.md](./architecture-proposal.md)
- 탐색 가능한 설계도: [architecture-proposal.html](./architecture-proposal.html)
- 재생성용 명세: [architecture-proposal.json](./architecture-proposal.json)
- 화면 검증 모음: [visual-check.html](./architecture-proposal.visual-check.html)
- 자동 검증 기록: [visual-check.json](./architecture-proposal.visual-check.json)
- 최종 캡처: [1440 밝게](./architecture-proposal.visual-check.1440x900.light.png), [1440 어둡게](./architecture-proposal.visual-check.1440x900.dark.png), [2048 밝게](./architecture-proposal.visual-check.2048x1320.light.png), [2048 어둡게](./architecture-proposal.visual-check.2048x1320.dark.png)

Archify `showcase` 명세 검증은 9/9 통과, 오류·경고 0건이다. Chrome 자동 배치 검사는 1440×900, 1600×1000, 1920×1080, 2048×1320에서 통과했다. 최종 1440×900·2048×1320의 밝은/어두운 테마 PNG 네 장을 직접 열어 글자·연결선·가림·배치를 확인했다. 첫 검토에서 발견한 탐색 UI 겹침은 한 차례 수정 후 다시 생성·검사했다. 검색·모든 탐색 버튼·내보내기 동작을 수동으로 전수 시험한 것은 아니다.

자동 기록의 `visualReview: pending`은 도구가 사람의 시각 판단을 대신하지 않는다는 뜻으로 유지했다. 위 네 장을 확인한 이번 수동 시각 검토의 상태는 `passed`, 수정 횟수는 `1`이다. 이 기록은 아래 최종 해시의 설계도에 해당하며 모델 추론의 품질 검증과는 별개다.

```text
spec sha256: 28e709dfa76e30354580f5b531567ff1a576f257fe63765f64e58ef96d3204cf
html sha256: 404e90c9db3d20cb5eb0493cedc3b2643c26bfb81467a0a36816e970f5e1e026
```
