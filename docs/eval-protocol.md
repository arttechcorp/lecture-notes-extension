# 노트 품질 평가 프로토콜 (개발 전용)

제안서 §4 평가 설계의 실행 절차다. 도구는 `tools/eval-notes.mjs`, 실행 기록은 admin 비교 화면의
"평가용보내기"가 만든다. 모든 산출물은 **평문 강의 내용**을 담으므로 저장소 밖·비공개 위치에만 둔다.
서버로 보내는 경로는 어디에도 없다.

## 1. 실행 기록 (eval-run JSON)

`admin.html` 비교 화면에서 패키지를 불러온 뒤 강의 id·경로를 확인하고 [평가용보내기]를 누른다.
경로(실험 arm)는 `current_delete`(예전 0.5 삭제 경로), `shadow`(judgeShadow — 판정만 하고 본문은
안 바꿈), `preserve`(근거 확장+보류 보존 경로) 셋 중 하나다. 자동 추정이 틀릴 수 있으니 실행 조건을
알고 있는 운영자가 확인한다. 같은 강의를 여러 경로로 돌린 기록을 모아야 경로별 비교가 된다.

주장별 필드: `claimId`, `pointer`(봉투 안 경로), `text`, `evidenceIds`, `score`(첫 Jev 점수,
없으면 null), `status`(그 경로의 최종 결정: kept/fixed/relinked = 본문 잔류, direct/pending/
collateral/cascade = 보류, unjudged = 미판정이지만 본문 잔류). 실행 단위 `run.costUsd`·`run.ms`는
이벤트 스트림에서 추정해 넣는다 — 없으면 지표가 "측정 안 됨"으로 빠진다.

## 2. 층화 표본 추출

```sh
node tools/eval-notes.mjs sample --runs=run1.json,run2.json --out=<저장소 밖 디렉터리>
```

강의당 40개를 `(낮음<0.5 / 경계 0.5–0.7 / 높음≥0.7 / 미판정) × (정의·조건·예외·사례·기타)` 칸에서
돌아가며 뽑는다. 표본 순서와 선정은 claimId 해시로 결정적이다 — 같은 입력이면 같은 시트.

산출물 두 벌:
- `<강의>.labels.csv` — 라벨러용. `lectureId,claimId,claim,evidence,label_a,label_b,adjudicated`.
  점수·상태·층이 **없다** — 라벨러가 시스템 판정을 보고 따라 하지 않게 하는 맹검 장치다.
- `<강의>.key.json` — 운영자용. claimId → 층·점수·상태. 라벨러에게 보내지 않는다.

## 3. 라벨 정의

각 주장을 두 사람이 **독립적으로**, 점수·상태·시스템 결론을 보지 않은 채 판정한다. 판정 대상은
"이 주장이 인용된 근거(시트의 evidence 열)에 의해 지지되는가"다.

| 라벨 | 뜻 |
|---|---|
| `supported` | 인용 근거만으로 주장 내용이 성립한다 |
| `contradicted` | 근거와 모순되거나 사실 오류가 있다 |
| `insufficient` | 근거가 부족해 지지도 모순도 못 한다 |
| `ambiguous` | 해석·복합 주장이라 한 라벨로 정할 수 없다 |

- `label_a`·`label_b`에 각자 기록한다. 서로의 답을 보지 않는다.
- 두 라벨이 다르면 둘이 함께 조정해 `adjudicated`에 최종값을 쓴다. 조정해도 합의가 안 되면 비워 둔다
  — 그 행은 최종 라벨 없이 지표에서 빠진다(κ 계산에는 들어간다).
- `ambiguous`는 지표 분모에서 빠진다. 어물쩍 supported 로 몰지 않는다.
- 필수 학습 항목(핵심 정의·조건 등)이면 `required` 열에 true 를 쓴다.

## 4. 평가 실행

```sh
node tools/eval-notes.mjs eval --runs=eval-*.json --labels=labels.csv \
  [--tuning=tune-*.json] --out=<저장소 밖 디렉터리>
```

- `--runs`는 평가 세트, `--tuning`은 튜닝에 쓴 실행 기록. **같은 강의 id 가 양쪽에 있으면 오류로
  멈춘다** — 강의 단위로 튜닝/평가를 분리한다(제안서 §4.3).
- 라벨은 `lectureId + claimId`로 결합한다. lectureId 가 빈 라벨 행은 그 claimId 가 모든 실행에서
  유일할 때만 단다 — 다른 강의의 같은 claimId 를 섞지 않기 위해서다.

### 출력 지표 (경로별)

| 지표 | 정의 |
|---|---|
| false withhold | 사람이 supported 라 한 주장 중 시스템이 보류한 비율 |
| false accept | 사람이 contradicted/insufficient 라 한 주장 중 본문에 남긴 비율 |
| 응답 정확도 | 점수가 있는(미응답 아닌) 라벨 주장에서 score≥0.5 예측의 정확도 — ambiguous·미라벨 제외 |
| 판정 성공률 | 판정 대상(lecture 근거 주장) 중 점수가 돌아온 비율 — 미응답을 정확도에서 빼는 대신 따로 본다 |
| ECE | 점수 10구간의 |구간 지지율 − 평균 점수| 가중 평균. score 는 p(supported)로 읽는다 |
| 필수 항목 보존 | required 표시된 주장 중 본문 잔류 비율 (+그중 사람이 supported 확인한 수) |
| Cohen κ | 두 라벨러의 4범주 일치도(조정 전 라벨 기준) |
| 비용·지연 | run.costUsd 합계, run.ms·latencies 의 p50/p95 |

## 5. 한계 — 이 숫자로 확정하지 않는다

- 강의당 40·총 240개는 탐색 표본이다. false withhold 5% 차이도 신뢰구간 안에서 구분 못 할 수 있다.
  이 표본 크기는 **정확도 보증이 아니다**(제안서 §4.2).
- 층은 지면 슬롯 이름으로 추정한다 — 실제 의미 역할과 다를 수 있다.
- 임계값 재계산은 복구 모델의 실제 응답을 시뮬레이션하지 못한다. 복구 효과는 별도 호출 실험으로 잰다.
- shadow 의 status는 "실행했다면"의 가상 판정이다 — 실제 본문 변화는 preserve 실행과 비교해야 한다.
- 같은 claimId 가 여러 경로에 나타날 때 라벨 하나를 공유한다 — 라벨은 주장의 사실성에 대한 것이지
  경로의 출력에 대한 것이 아니다.
