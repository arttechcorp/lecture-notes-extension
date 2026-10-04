# 시각 복원 평가 자료

수식·단순 그래프의 **내용 보존 + 재디자인**을 검토하기 위한 초기 공개 자료 코퍼스다. 실제 강의 캡처가 아니며 제품에 포함되지 않는다. 복원 모델은 아직 연결하지 않았다.

- [평가 기준](../../docs/visual-evaluation-rubric.md)
- [작업 범위](../../docs/visual-evaluation-plan.md)
- [출처 목록](sources.json)
- [원본·대조 이미지 미리보기](index.html)
- [정답 및 영역 주석](manifest.json)
- [실측·오생성 억제 HTML 보고서](report.html)
- [2단계 측정 범위](../../docs/visual-measurement-scope.md)

현재 자료는 **12개(수식 6, 그래프 4, 그림 없는 본문 2)**다. 공개 원본 7개와 자체 제작 대조 5개이며, 모두 800×600 PNG 입력과 원본 SVG를 함께 보관한다. 두 수식 영역이 있는 사례, 숫자 없는 곡선, 흐린 수식, 한국어 다단 본문을 포함한다. 모든 정답은 실제 PNG를 AI가 확인한 초안이며 사람의 독립 확인은 남아 있다.

## 실행

아래 명령은 이 자료가 있는 **b/visual-suppression 작업 폴더의 루트**에서 실행한다. 현재 작업트리 위치는 `lecture-notes/.worktrees/visual-suppression` (절대 경로: `C:\Users\부지환\OneDrive\Desktop\vibe-coding\claude workspace\lecture-notes\.worktrees\visual-suppression`)이다.

```powershell
Set-Location "C:\Users\부지환\OneDrive\Desktop\vibe-coding\claude workspace\lecture-notes\.worktrees\visual-suppression"

node tools/visual-eval.mjs validate
node tools/visual-suppression-check.mjs
node tools/visual-report.mjs
node tools/visual-eval.mjs template > eval/visual/review-template.json
node tools/visual-eval.mjs score eval/visual/exact-copy-control.json
node tools/visual-eval.mjs score eval/visual/reviews.json
node --test tools/visual-eval.test.mjs
node --test lib/*.test.js server/*.test.js tools/*.test.mjs
node tools/package-cws.mjs --dry-run --skip-tests
```

실제 로컬 OCR 원시 결과는 `runs/local-baseline.json`, 사례별 관찰은 `runs/local-review.json`에 있다. OCR 재측정은 `node tools/visual-local-bench.mjs`로 실행하며 기존 결과 파일을 덮어쓴다. `visual-suppression-check.mjs`는 고정된 이전 커밋과 현재 검증기에 합성 후보를 입력하는 회귀 실험이며 생성 모델의 오생성률이 아니다. 검증할 수 없는 정상 시각 자료도 보류하므로 보류를 복원 성공으로 세지 않는다.

`template`은 판정이 비어 있는 입력 틀을 만든다. runId와 reviewer, 실제 실행 상태·출력 경로·항목별 판정을 채워야 score가 실행된다. 예시나 템플릿의 결과를 모델 측정치로 보고하지 않는다. PowerShell 구버전에서 리다이렉션이 UTF-16을 만들면 UTF-8로 저장한다.

저장된 `review-template.json`을 복사해 채운 뒤 `reviews.json`으로 저장한다. `exact-copy-control.json`은 원본을 출력으로 지정하면서 일부러 design=changed라고 주장하는 도구 검사다. 실행하면 원본 복사 1건이 실패하고 미실행 11건은 보류·누락으로 남는다. 이는 복원 모델의 점수가 아니다.

## 미리보기 재생성

```powershell
node tools/visual-eval-preview.mjs controls
node tools/visual-eval-preview.mjs gallery
node tools/visual-eval-preview.mjs render
# 한 항목만 다시 만들 때
node tools/visual-eval-preview.mjs render formula-clear
```

현재 래스터화 도구는 Windows의 기본 Google Chrome 설치 경로를 사용한다. 폰트·브라우저 버전이 달라지면 PNG 픽셀과 체크섬이 달라질 수 있다. 다시 생성한 파일은 눈으로 확인하고 manifest의 해시를 갱신해야 한다. 정답을 검토하지 않은 채 자동으로 해시를 덮어쓰지 않는다.

## 평가 입력 계약

manifest의 `image`와 검토 JSON의 `output`은 `eval/visual` 기준 상대 경로다. 다른 폴더로 벗어나는 경로는 허용하지 않는다. SHA-256으로 평가 입력 파일이 바뀌지 않았는지 확인한다. 모델에게는 image만 주고 정답·소스 SVG 코드·파일명에서 유추한 수학 정보는 입력하지 않는다.

각 결과는 `status: rendered | abstained`, 핵심 항목마다 `pass | fail | unknown`을 기록한다. 양성 출력에는 실제 output 파일과 `design: changed | identical | cosmetic-only | unknown`도 필요하다. 디자인 변경을 주장했더라도 원본과 바이트가 같으면 실패한다. 바이트가 다른 시각적 복사는 검토자가 반드시 `identical` 또는 `cosmetic-only`로 기록한다.

도구는 사람이/검토자가 기입한 판정을 집계한다. OCR, 수식 동등성, 이미지 유사도를 자동 채점하는 모델이 아니다. 출력 생성자가 자신의 결과를 채점한 것만으로 최종 성능을 확정하지 않는다. 초기 AI 시각 주석은 사람이 독립 확인할 필요가 있다.

## 검색·다운로드

```powershell
node tools/visual-eval-collect.mjs search
node tools/visual-eval-collect.mjs download https://upload.wikimedia.org/wikipedia/commons/9/9e/Parabola.svg Parabola.svg
```

검색은 최대 세 질의, 질의당 다섯 결과로 제한한다. 키는 EXA_API_KEY 환경 변수 또는 기존 주 작업 폴더의 apikey.env.local에서 읽으며 출력하지 않는다. 결과가 성공한 경우에만 `discovery.json`이 생긴다. 다운로드는 공개 Wikimedia 호스트만 허용하며 기존 파일을 덮어쓰지 않는다. 새 이미지 추가 시 소스 페이지와 라이선스를 확인하고 sources/manifest를 함께 갱신한다.

2026-10-03 현재 최초 Exa 호출은 HTTP 401로 실패했다. 공개 원본 페이지를 직접 확인해 수집을 계속했으며 Exa 수집에 성공했다고 표시하지 않는다. Wikimedia의 429는 자료 부재가 아닌 요청 제한이므로 반복 호출하지 않고 간격을 두어 재시도한다.

## 자료와 라이선스

각 공개 원본의 저작자·라이선스·다운로드 URL은 sources.json 및 manifest의 source에 보존한다. 래스터화나 흐림 등 변경이 있으면 원본과 파생물의 연결 및 변경 설명을 기록한다. CC BY-SA 자료에서 파생된 이미지는 해당 라이선스를 유지한다. 자체 제작 대조 자료는 강의에서 가져온 것이 아니며 생성 코드와 함께 둔다.

학습과 검증에 같은 원본의 다른 버전을 나누어 넣지 않는다. `group`이 같은 사례는 같은 split을 사용한다. 초기 코퍼스는 모두 개발용으로 사용하며 별도의 미공개 검증셋 성능을 의미하지 않는다.
