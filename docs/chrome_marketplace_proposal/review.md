# CWS 패키징 PRD 검토 결과

## 판정

**수정 후 승인**한다. 방향은 타당하지만, 현재 명세를 그대로 구현하면 배포 ZIP이 런타임 의존성을 누락하거나 CWS 검사와 현재 코드가 충돌할 수 있다.

## 승인 전 필수 수정 사항

### 1. 기준 브랜치와 개인정보 계약을 단일화한다

- PRD의 대상은 `dev_ANTI`지만, 기존 `tools/package-cws.mjs`와 `CHROMEWEBSTORE.md`는 별도 `b/dev` 작업 디렉터리에 있다. 구현 기준 커밋과 저장소 루트를 명시한다.
- 현재 매니페스트의 `tabCapture`, `offscreen`, `activeTab`은 CWS 권한 소명에 없고, CWS 문서의 외부 AI 호스트 권한은 현재 매니페스트에 없다. 매니페스트와 권한 소명서를 같은 변경에서 동기화한다.
- CWS 문서의 BYOK 설명은 `AGENTS.md`의 “운영자 API 키는 서버에만 보관하고, 외부 요약은 명시적 동의가 필요하다”는 원칙과 충돌한다. 실제 데이터 흐름, 동의 문구, 개인정보처리방침을 하나의 제품 계약으로 확정한다.

### 2. 고정 화이트리스트를 런타임 의존성 폐쇄로 대체한다

- `landing/` 전체 제외는 `sidepanel.html`이 참조하는 `landing/product-panel.css`를 누락시킨다.
- `lib/*.js`만 포함하면 `lib/ppocr-runtime.mjs`, Whisper 워커, WASM, ONNX 모델 등 실제 런타임 의존성이 누락된다.
- 매니페스트 엔트리포인트와 HTML의 로컬 `src`/`href`, JS import, Worker, offscreen URL을 재귀적으로 수집한다. 생성된 최종 파일 목록으로 필수 파일 존재와 제외 파일 부재를 검사한다.

### 3. ZIP과 재현성 요구사항을 분리한다

- `node:zlib`은 ZIP 아카이브 작성 API가 아니다. PKZIP을 직접 구현하는 대신, 고정 버전의 검증된 소형 ZIP 라이브러리를 사용하거나 ZIP 구현·CRC·ZIP64·손상 검증을 명시적으로 책임진다.
- ZIP의 결정론적 해시와 provenance의 빌드 시각·실행자 기록은 같은 ZIP 안에 넣으면 양립하지 않는다. ZIP은 정렬된 경로, 고정 timestamp, 고정 권한으로 재현 가능하게 만들고 provenance는 `dist/`의 별도 파일로 둔다.
- 실행자 식별 정보는 수집하지 않는다. 커밋 SHA, Node 버전, `SOURCE_DATE_EPOCH`, 파일 해시, 아카이브 해시만 기록한다.
- 기존 `dist/` 전체를 삭제하지 말고, 이번 버전의 산출물만 교체한다.

### 4. 보안 감사를 정적 휴리스틱으로 명확히 정의한다

- 제안된 “고엔트로피 검사”는 실제 엔트로피 검사가 아니라 키 이름이 붙은 문자열 패턴이다. 이를 명시하고, 알려진 키 형식·일반 키 할당 패턴·마스킹·fixture 테스트로 구성한다.
- 원격 `<script>`만 검사하지 말고 동적 import, `importScripts`, 원격 WASM, fetch 후 Blob URL 실행을 검사한다. MV3는 원격 JavaScript와 WASM 실행을 금지한다. [Chrome의 MV3 원격 코드 정책](https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements)
- `sandbox.html`의 `unsafe-eval`은 샌드박스 격리 자체로는 위반이 아니다. 샌드박스에 `chrome.*` 접근이 없고, 메시지 origin·스키마 검증이 있는지를 검사한다. [Chrome CSP 문서](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy)
- 원시 화면·PCM의 네트워크 전송 검사는 단순 `fetch` 문자열 탐지로 끝내지 않는다. 모델 다운로드와 명시적 동의를 거친 텍스트 요약 요청은 허용 경로로 문서화하고, 원시 미디어의 전송 경로만 차단한다.
- “CWS 심사 100% 통과”는 승인 기준에서 제거한다. 자동 점검은 위험을 낮출 뿐, 심사는 전체 기능의 투명성과 정책 적합성을 평가한다.

### 5. 테스트 게이트와 검증 시나리오를 강화한다

- `--skip-tests`는 필수 테스트 게이트와 모순된다. 제거하거나, 사용 시 provenance에 `UNVERIFIED`를 기록하고 CWS 제출용 산출물로 취급하지 않는다.
- 크로스 플랫폼 실행을 위해 셸 글롭에 의존하지 않는다. 스크립트가 테스트 파일을 열거하고 `node --test`를 실행한다.
- 패키징 후 ZIP 열기 검증, 필수 파일 존재, 제외 파일 부재, 매니페스트 JSON 파싱, 압축 파일 크기 검사를 추가한다.
- Chrome Web Store의 확장 프로그램 업로드 한도는 2GB다. [Chrome 게시 가이드](https://developer.chrome.com/docs/webstore/publish/)

## 확인된 현황

- 현재 `node --test lib/*.test.js` 결과: **41개 통과, 실패 0개**.
- 런타임 의존성에는 `landing/product-panel.css`, 동적 `.mjs` import, Worker, WASM, ONNX 모델이 포함된다.
- 현재 `lib/`는 약 74.42 MiB이며, 이 중 벤더 런타임 자산은 약 74.28 MiB다. 크기 최적화는 실제 의존성 폐쇄를 확인한 뒤 진행한다.

## 권장 구현 순서

1. 기준 브랜치·매니페스트·CWS 권한 소명·개인정보 계약을 동기화한다.
2. 런타임 의존성 폐쇄 수집과 파일 목록 검증을 구현한다.
3. 시크릿·MV3·불변식 정적 감사와 fixture 테스트를 추가한다.
4. 안전한 ZIP 생성, ZIP 자체 검증, 체크섬과 외부 provenance 생성을 추가한다.

자체 ZIP 포맷 구현보다 검증된 소형 아카이브 의존성을 사용하는 것이 최소 구현 원칙과 보안 목표에 더 부합한다.
