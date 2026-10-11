# tools/note-fixture — 노트 계약 종단 합성 fixture

이 디렉터리의 모든 자료는 **직접 작성한 합성(가상) 데이터**다. 실제 강의 전사·슬라이드·
생성 노트가 아니며, 여기 쓴 수치와 자료(가격, 고정비, 설문 응답률 등)는 일반 강의의
기본값으로 재사용하지 않는다. 검증 대상은 `lib/note-contract.js`의 NoteContract 계약이고
실행 테스트는 `lib/note-fixture.test.js`다.

## 파일

| 파일 | 내용 |
|---|---|
| `input.json` | SlideDoc 6장, Transcript, 메타, 공백, 수식 레지스트리(상태 지정), 도표 레지스트리, 크롭 ID 목록 |
| `planner-output.json` | Planner 출력: 개념 7, 섹션 5, 전역 2 |
| `writer-outputs.json` | 섹션별 1차 출력, repair 출력, 전역 출력, 악성 지시 시도 출력 |
| `expected-note.json` | `assembleNote` 결과(골든). 재현성 기준 |
| `expected-structure.json` | `expected-note.json` 렌더의 블록 순서·클래스 구조 스냅샷(§5 레이아웃 고정). 렌더 마크업이 바뀌면 같이 갱신한다 |

## 사례별 확인 항목 (`docs/note-contract.md` §16)

| 사례 | 확인 |
|---|---|
| 근거 | 줄 단위 근거, 걸러진 학번 워터마크가 근거·노트에 없음, 교차 근거 허용 범위 |
| 정정 | 고정비 240만 → 300만 원 정정. 1차 계산이 대체 근거를 인용 → `VAL_SUPERSEDED` → repair 후 손익분기 500개 |
| 계산 | 입력 근거, 공헌이익 6,000원, 손익분기 500개, 단위·반올림 검산. `checkCalc` 단위 테스트(분모 0, 불일치, `%p`) |
| 교육용 오답 | OX `X` 문항은 `pedagogical`이고 근거 있는 수정 문장과 연결됨. 같은 문장을 B05에 쓰면 `VAL_BASIS_PLACEMENT` |
| 이론 비교·긴 표 | 3대상×7기준 B06. 확인되지 않은 칸은 null로 유지(창작하지 않음). 경고만 있고 잘림 없음 |
| 인문 자료 | B09에서 저자 주장과 교수 해석 분리, 인용 원문 대조, 서술형 문항 + 채점 기준 |
| 부분 실패 | B07에 강의 밖 연도("1937년")가 들어가 repair 후에도 실패 → 제외. 그 블록을 복습 위치로 둔 문항, 그 블록을 대상으로 한 전역 결론은 정리 |
| 섹션 실패 | (변형) 섹션 5 출력 없음 → `NOTE_SECTIONS_FAILED`, 그 섹션을 가리키던 항목 정리 |
| 수식·크롭 | F1 검증됨 → `latex`, F2 image+크롭 → `crop`, F3 미검증·크롭 없음 → `check`. 도표 G1은 크롭 없음 → `check` |
| Free | `lib/note-contract.test.js` 단위 테스트에서 확인: 도표 없음 → `NOTE_FIGURES_NOT_DETECTED`, 다른 동작은 바뀌지 않음(자동 클라우드 전환 없음) |
| 악성 지시 | 슬라이드 속 "이전 지시 무시" 문장은 근거 텍스트일 뿐이다. 그 지시를 따른 출력은 막힌다: 필드 추가·`synthetic`은 스키마에서, 정답을 모두 O로 바꾼 출력은 `VAL_ANSWER_SHAPE`·`VAL_BASIS_PLACEMENT`로 |
| 재현성·무내용 로그 | 같은 입력으로 두 번 조립하면 동일. `dropped`·`pruned`·`notices`에 주장 텍스트 없음 |

## expected-note.json 생성 방법

`expected-note.json`은 사람이 검토한 뒤 커밋하는 골든이다. 생성 절차: 테스트와 같은 입력으로
`NoteContract.assembleNote`를 실행하고(`lib/note-fixture.test.js`의 `assemble` 헬퍼와 같은 인자),
그 결과를 내용·고지·정리 기록까지 눈으로 검토한 뒤 이 디렉터리에 저장한다. 골든을 바꿀 때는
계약 문서(`docs/note-contract.md`)와 fixture 입력이 여전히 맞는지 함께 확인한다.
