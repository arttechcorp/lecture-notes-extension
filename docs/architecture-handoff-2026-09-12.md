# 아키텍처 구현 중단 지점 — 2026-09-12

사용자가 “일시 정지 후 다른 세션에서 진행 예정”이라고 요청하여 작업과 서브에이전트를 중지했다. **현재 작업본은 통합 중이며 배포 가능한 완료본으로 간주하지 않는다.**

## 브랜치와 보존 상태

- 작업 폴더: `C:\Users\부지환\OneDrive\Desktop\vibe-coding\claude workspace\lecture-notes`
- 현재 브랜치: **dev_ANTI**. 이후 모든 변경도 사용자의 명시적 지시에 따라 이 브랜치에서 한다.
- 이번 작업 시작 HEAD: `28efa1b` (기존 음성 보정 수정). 이번 턴에는 커밋·push·merge·배포하지 않았다. 수정/새 파일은 작업 폴더에 보존했다.
- 다른 worktree와 브랜치는 건드리지 않았다. 기존 stash도 그대로 두었다.
- 이전 아키텍처 구현 `74734ce` / `d4e3361`은 Git 객체로 남아 있지만 현재 HEAD의 조상이 아니다. 현재 트리에 offscreen/server가 없던 이유를 검토했고, 필요한 소스만 선택적으로 재사용했다. 이전 커밋 전체를 checkout/cherry-pick하여 최근 UI를 덮어쓰면 안 된다.

## 사용자 결정

1. `docs/architecture-proposal.md`와 HTML을 기준으로 검토하고 미완료면 구현한다.
2. 로컬 인식과 근거 기반 요약 안정화부터 진행한다. PP-OCR/Whisper small 등 모델 교체는 실제 브라우저 평가가 필요한 후속 단계다.
3. OpenRouter는 운영자 키를 서버에서 사용한다. 키를 확장에 포함하지 않는다.
4. 근거/노트의 서버 보관은 기기에서 암호화하고 기기에서 해독한다. 이는 예전 문서의 모든 파일 저장 금지 규칙에 대한 사용자의 명시적 변경이다. 평문 저장은 금지한다.
5. 외부 모델 추론은 HTTPS 전송 중 보호되지만 모델/서비스가 일시적으로 텍스트를 읽는 경계다. 종단간 암호화 추론이라고 표현하면 안 된다. 별도 안내·동의를 유지한다.
6. Lite/Pro/Max 가격 및 한도는 직전 대화에서 조언한 단계다. 실제 유료 등급/가격/무제한 조건은 확정·연동하지 않았다. Paddle 자격증명은 아직 없어 비워두라는 이전 지시를 유지한다.

## 검토에서 확인한 기존 문제

- 패널이 캡처/PCM/근거와 AI 작업을 소유하여 패널 닫힘에 의존했다.
- 원격 요약이 앞 30,000자만 사용했다.
- 원격 이미지 OCR 경로와 확장 폴더 `apikey.env.local` 직접 키 로딩이 남아 있었다.
- `mergeLines`가 대소문자 차이를 삭제하고 `collapseRepeats`가 `100000` 같은 숫자를 훼손했다.
- 시작 시 기존 11개 테스트 파일은 모두 통과했지만 일부는 위의 구식 동작 자체를 요구했다. 테스트 통과만으로 제안 구현 완료를 판단하면 안 된다.

## 현재 작성된 변경

- `background.js`, `content.js`, `offscreen.html/js`: 권한/메타데이터와 실제 세션 수명 분리. 제어/상태는 runtime, 원본은 offscreen 내부에 둔다.
- `lib/session.js`, `visual-gate.js`, `evidence.js`, `audio-segments.js`, `pcm-worklet.js`: 이미지 4개/64 MiB 작업 예산, PCM 약 60초 상한, 출처/시각/epoch, 종료 drain과 늦은 결과 무시, 실제 번들 Tesseract 연결.
- 음성 20초 경계 누락, 낮은 음량 보정, 앞 문맥 시계, 배속 변경 flush를 보완했다. 음성 전용 설정인데 오디오 트랙이 없으면 실패를 표시한다.
- `lib/whisper-worker.js`: tiny/base만 명시적으로 허용, 단일 작업, PCM 검증·30초 상한·완료 후 지우기, 모델 교체 시 dispose, 오류에도 job ID 반환.
- `lib/summary.js`: 전 구간 UTF-8 청킹, 구조/근거 ID 검증, 장문 원문 재현의 보수적 검사, 부분 결과 유지. 전체 개요가 너무 길면 개별 구간 결과를 보존하고 개요 생략을 안내한다.
- `server/index.js`: 운영자 키, 계정 토큰, 모델/provider allowlist, ZDR/data_collection deny/no fallback, 비용 예약과 요청 중복 방지, strict schema. 형식/잘린 응답만 동일 모델·provider에서 1회 재시도; 네트워크/HTTP 오류는 재시도하지 않는다. 알 수 없는 비용은 예약을 유지한다. Gemini 3.8 예산은 프로모션이 아닌 $1.50/$7.50 단가를 사용한다.
- `lib/vault.js`, `service-client.js`: AES-GCM 보관, 계정/문서 AAD, 인증된 ciphertext CRUD. 서버는 단일 프로세스 파일 저장 파일럿이다.
- `lib/settings.js`, `options.html/js`: 앱 토큰/서비스 URL/외부 요약 동의로 변경, 기존 AI 키 동기화/직접 로딩 제거. 설정 화면의 연결 시험은 제한시간/리디렉션 금지 ServiceClient를 사용한다. `theme` 설정은 보존한다.
- `lib/ai.js`: 직접 원격 API/OCR 함수 제거. 기존 로컬 호환 도우미만 남김. 로컬 요약의 무음 절단도 오류로 바꿨다.
- `lib/mergeLines.js`, `repeats.js`: 숫자/대소문자 및 새 시각의 강조 보존 회귀 수정.
- `AGENTS.md`: dev_ANTI, 서버/암호화 보관 예외, 추론 동의 경계를 사용자 결정과 맞췄다.

## 중단 순간의 가장 중요한 미완료 작업

**sidepanel 통합을 먼저 완료해야 한다.**

- Luna의 첫 작업은 서비스 설정만 바꾼 패널이었다. 로컬 캡처 소유권이 남아 있어 Terra에게 thin offscreen adapter를 다시 맡겼다.
- 중단 시점에는 `sidepanel.js`가 `// Display and control only...`로 시작하는 새 RPC 어댑터로 교체됐고, `sidepanel.html`도 일부 수정되어 있다.
- 이 최종 UI 변경은 아직 전체 테스트/실제 브라우저 검증을 하지 않았다. 필요한 ID, NoteViewer 렌더링, popup/minimize, 시작/중지/요약/재연결, 보관함 버튼을 하나씩 확인한다.
- 특히 `lib/panel.test.js`는 아직 패널에서 `ServiceClient.summary`를 직접 호출하고 script를 로드하기를 기대한다. 새 구조에서는 요약은 offscreen이 소유하므로 **이 테스트를 새 RPC 계약에 맞춰 갱신해야 한다**. 단순히 테스트를 삭제하지 않는다.
- `lib/recovery.test.js`도 새 UI 어댑터에 맞춘 재검토가 필요하다.
- HTML에 기존 Premium/Free 텍스트와 로컬 API 상태 UI가 남았는지 확인한다. 미연동 플랜을 실제 사용 가능하게 표시하지 않는다.
- trusted sender는 `url.protocol`과 `url.host`를 정확히 비교한다. `chrome-extension:` URL의 `origin`만 비교하면 `null`이 될 수 있다. 자신의 popup/tab 페이지는 sender.tab이 있어도 허용되지만 웹 content script는 허용하면 안 된다. background/offscreen에 이 수정이 작성돼 있다.

다음 통합에서 추가로 확인할 항목:

1. 실제 설정 → 패널 → background → offscreen → SummaryPipeline의 `appSessionToken` 계약. 옛 `serviceToken` 별칭을 다시 도입하지 않는다.
2. `.gitignore`에 `server-data/`, usage 상태·vault 로컬 운영 데이터 경로를 추가해야 한다. 비밀 파일 내용은 출력하지 않는다.
3. `memory.md`의 “패널 textarea가 canonical 데이터 소유자” 설명은 새 offscreen 소유권과 달라졌으므로 업데이트한다. 랜딩은 아직 변경하지 않았다.
4. 앱 키 없는 상태에서도 로컬 인식과 설정 이동/다시 시작이 가능해야 한다. 실제 서버 연결은 운영자 키/앱 토큰/provider/확장 origin 설정 전에는 미완료다.
5. 외부 요약 서비스 계정 로그인/Paddle provisioning, 영속 볼륨/TLS 배포는 미완료다. 키 값을 읽거나 실제 유료 API 요청은 이번에 하지 않았다.

## 실행한 검증과 한계

- 시작 기준선: `node --test lib/*.test.js` → 기존 11/11 통과.
- 서비스 최종 개별 검사: `node --test lib/summary.test.js lib/vault.test.js server/index.test.js` → 16/16 통과.
- 캡처 에이전트 검사: diff/session/evidence → 13개 통과(그 후 부모가 session 테스트를 더 추가함).
- 마지막 부모 개별 검사: `node --test lib/session.test.js lib/whisper-worker.test.js` → 10/10 통과.
- 숫자/대소문자/AI 도우미 개별 검사 통과.
- `tools/architecture-smoke.cjs`: 실제 Chrome에서 합성 canvas MediaStream + 번들 Tesseract로 `100000` 보존, STOP/drain, 트랙/버퍼 해제, 외부 요청 없음 통과. 암호화 보관 save/dispose/load, 잘못된 비밀번호 후 기존 상태 보존, ciphertext-only payload 통과.
- 이 smoke는 **최종 캡처/패널 수정 전** 실행했다. 최종 작업본에 재실행해야 한다. runtime API는 mock이므로 설치된 MV3의 권한 시험을 대신하지 않는다.
- 마지막 UI 작성 후 전체 검사 결과는 아직 없다. 통과했다고 보고하면 안 된다.

Windows 브라우저 smoke 실행:

```powershell
$env:NODE_PATH = 'C:\Users\부지환\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules'
$env:CHROME_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
node tools/architecture-smoke.cjs
node --test lib/*.test.js server/*.test.js
```

개발 명령은 `C:/Users/부지환/.codex/RTK.md`를 따른다. RTK 지원 명령은 사용하되 정확한 검토에는 원문을 읽는다. Headroom 도구는 발견했지만 이번 턴에는 압축을 실제로 호출하지 않았다. 강의 데이터는 어느 도구의 로그에도 보내지 않는다.

## 제안 전체 완료로 볼 수 없는 항목

- PP-OCRv5 한국어 ONNX, Whisper small WebGPU, Silero VAD는 아직 미구현이다. 현재 번들은 Transformers.js **2.17.2**, WebGPU 구현이 없다. 이름만 바꿔 동작한다고 표시하면 안 된다.
- 현재 모델 기준은 Tesseract kor+eng + Whisper tiny/base WASM + 에너지 기반 발화 감지다.
- 세부 글줄 bbox/교정 revision/supersedes 그래프, 시간 정렬 기반 ASR 중첩 중복 제거, 마지막 선명 프레임/필기 회수율 등의 고급 로직은 추가 구현·실측이 필요하다.
- 현재 preflight는 최상위 video 기반이다. iframe 전용 플레이어, CORS/보호/검은 화면은 명시적으로 중단한다. LMS/강의 popup 권한 동작은 실제 설치 환경에서 검증해야 한다.
- 한국어 CER/WER, 1×/1.5×/2×, 2시간 메모리·처리량 시험은 하지 않았다.
- 사용자의 요청은 검토 후 구현 착수였으며 현재는 위 작업 중간에 사용자가 정지시켰다. 재개 시 UI 통합과 검증부터 이어간다.
