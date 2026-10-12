# mis-sol-hai — Mistral OCR 4.1 · Sol · Haiku 5.5 노트 생성 기획 (개정 2)

개정: 2026-10-09 (초안 2026-10-08). 기준 코드: `6ce94a8` `w/dev` v2.7.0. 상태: **설계안 — 미구현·실모델 미실험·미배포.** `mis-sol-hai`는 숨은 실험 프로파일 ID다(확장 버전 아님).
개정 이유: 사용자가 워크플로우와 핵심 포인트를 새로 정했다(§1). 초안의 JEV 검증, Haiku 단가 논리, Liner 미고려, Mistral 파라미터 누락을 고쳤다.

## 1. 목표와 핵심 포인트

**워크플로우 (사용자 확정)**
1. 강의 영상을 슬라이드별로 캡처해 원래 강의안을 재구성한다. 교수의 필기가 담기도록 **다음 슬라이드로 넘어가기 직전** 화면을 캡처한다.
2. 강의 음성을 STT로 옮긴다(기존 경로).
3. 슬라이드 캡처를 Mistral OCR 4.1로 인식한다.
4. Sol이 강의 내용으로 노트를 구성한다 — 레이아웃은 **사용자가 준 예시 PDF로 만든 기존 블록 양식**을 항상 따른다.
5. Haiku 5.5가 섹션 본문을 쓴다(구조화 JSON → 결정론적 렌더러가 HTML).
6. 합친 결과(렌더된 HTML)를 기존 Sol 세션에 보내 **1회** 피드백하고 부분 재작성한다.

**핵심 포인트**
- 교수 필기는 따로 강조해 기재한다.
- 슬라이드 전체 내용을 흐름대로 담고, 교수가 음성으로 강조·반복·오래 설명한 부분은 **볼드 처리나 부가 설명**으로 드러낸다(강조된 것만 남기는 방식이 아니다).
- 슬라이드에 없고 교수가 말로만 한 내용은 **"슬라이드에 없는 설명"**으로 따로 적는다.
- LLM 입력 프롬프트와 제약은 핵심만 쓴다(§7).

**비목표**: Liner Visualization API, JEV(판정·근거 지지), 모델이 직접 쓰는 HTML, 강의마다 예시 PDF 업로드, 블록 종류 추가, 실시간 캡처 모드 변경(1차는 백그라운드 생성만), 다른 모델로의 자동 폴백, 무료 온디바이스 OCR 경로 변경.

## 2. 결정 기록

| # | 쟁점 | 결정 | 기존 구현과의 차이 |
|---|---|---|---|
| D1 | Haiku 출력 | 구조화 JSON(SectionDraft 계약) → 기존 결정론적 렌더러 | 없음 — 보관 형식·검증·수리 유지 |
| D2 | 레이아웃 | 기존 블록 양식(B01~B18, 예시 PDF 기반)을 항상 따른다. Sol은 카탈로그 안에서 블록 배정만 | 새 요소(필기·말로만·볼드)를 카탈로그 안에서 표현해야 함(§5) |
| D3 | 범위 | 모든 슬라이드를 흐름 순서로 담고 강조는 볼드·부가 설명 | 섹션 순서 = 슬라이드 순서, 커버리지 단위 = 슬라이드 |
| D4 | 강조 판단 | 로컬 결정론적 신호 → 숫자로 Sol에 전달, 판단은 Sol | JEV 중요도 판정(judging) 제거 |
| D5 | 캡처 시점 | 다음 전환 직전 프레임. 마지막 슬라이드는 영상 끝 직전. 같은 슬라이드 재방문 시 기존 캡처 삭제·재캡처 | 지금은 전환 후 첫 정지 프레임 |
| D6 | 필기 구분 | 같은 슬라이드의 첫/마지막 프레임 차이 영역 ∩ OCR 블록 = 필기. 필기는 해석한 문장으로 노트에 반영하고 원본 크롭은 싣지 않는다 | OCR이 못 읽은 필기만 이미지 해석 호출 추가 |
| D7 | 말로만 한 내용 | "슬라이드에 없는 설명" — B12 곁설명의 새 종류 | B12 kind 하나 추가 |
| D8 | 피드백 | 렌더 HTML을 Sol에 보내 부분 재작성, 1회. 섹션 재작성은 영상 10분당 최대 1개(가장 중요한 섹션부터) | review 입력이 주장 요약 → HTML |
| D9 | API 경로 | Liner에 있는 모델은 Liner, 없는 모델(Haiku 5.5)은 OpenRouter, OCR은 Mistral 직접 | Liner 라우팅은 현재 GPT-6 Sol/Luna만(메인 체크아웃 미커밋 변경) |
| D10 | 검증 | JEV 제외 — 결정론적 검증 + Sol 피드백만 | 근거 지지 판정(SUPPORT_OUTCOMES) 경로 꺼짐 |

## 3. 공식 문서로 확인한 계약 (2026-10-09 재확인)

### 3.1 Mistral OCR 4.1 — 서버에서 직접 호출
출처: [모델 카드](https://docs.mistral.ai/models/ocr-4-1), [OCR processor](https://docs.mistral.ai/studio/document-processing/basic_ocr), [API reference](https://docs.mistral.ai/api/endpoint/ocr).

- ID `mistral-ocr-4-1`, GA 2026-07-16, `POST /v1/ocr`. 별칭 `mistral-ocr-4`·`mistral-ocr-latest`는 재현 실험에 쓰지 않는다.
- 가격 $4/1,000 pages, annotations $5/1,000 pages. Batch(`/v1/batch`)는 쓰지 않는다.
- 요청: `document:{type:"image_url", image_url:"data:image/jpeg;base64,…"}`(마스킹된 프레임, 메모리에서), `include_blocks:true`(OCR 4+), `confidence_scores_granularity:"block"`, `table_format:"html"`, **`extract_header:true`·`extract_footer:true`**(기본 false — 켜서 머리·바닥글을 `pages[].header/footer`로 분리 받고, 지울지는 기존 boilerplate 규칙이 정한다), `include_image_base64:false`.
- 응답: `pages[].{index, markdown, images, tables, hyperlinks, header, footer, dimensions, confidence_scores, blocks}`, `model`, `usage_info`, `document_annotation`. 블록 = `type`(text/title/list/table/image/equation/caption/code/references/aside_text/header/footer/signature), `top_left_x/y`·`bottom_right_x/y`, `content`, `confidence_scores{average_content_confidence_score, minimum_content_confidence_score, block_type_confidence_score}`, table→`table_id`, image→`image_id`. 읽기 순서 보존. 텍스트 없는 블록의 content 신뢰도는 null.
- **bbox는 문단 단위**(모델 카드 "paragraph-level") — 문단보다 작은 크롭 불가. 단어 단위는 신뢰도만.
- 좌표 단위는 공식 문서에 없다 → 표식이 있는 합성 이미지로 실측해 고정한다.
- 손글씨 전용 블록 타입은 없다 → 필기 판별은 D6(프레임 차이)으로 한다.
- ZDR: pay-as-you-go 조직의 승인된 ZDR가 `/v1/ocr`에 적용된다([안내](https://help.mistral.ai/en/articles/347612-can-i-activate-zero-data-retention-zdr)). 실강의 전송 전 조직 설정을 확인한다.

### 3.2 Haiku 5.5 — OpenRouter
출처: [Haiku 5.5 개요](https://platform.claude.com/docs/en/models/haiku-5-5/overview), OpenRouter `/api/v1/models`(2026-10-09 조회).
- OpenRouter `anthropic/claude-haiku-5.5`: 1M context, $0.10/$0.50 per MTok, `structured_outputs`·`response_format`·`reasoning_effort` 지원. Liner에는 없다(`haiku-latest`는 4.5 가격).
- 공식: 100K 초과 프롬프트는 $0.50/$2.50, cache read $0.01/MTok, 기본 effort medium, `temperature/top_p/top_k` 비기본값은 400, thinking 블록은 만든 계정에서만 유효(멀티턴 재전송 금지 — 작성은 독립 호출이라 무관).
- 단가는 Luna와 같다. 교체 근거는 품질·수리율 실측이어야 한다.

### 3.3 Sol — Liner
- `openai/gpt-6.1-sol` $2/$10, Liner Responses. Liner 제약: `store:false`만, `previous_response_id`·`reasoning` 입력 항목·`input_file`은 400, `include`는 추가 데이터를 돌려주지 않음, `temperature/top_p` 무시. **"기존 Sol 세션"은 이력 재전송 + 접두 캐시**이며 암호화 reasoning 재생은 기대하지 않는다(현 `server/note-session.js:206`의 `include` 요청이 Liner에서 무엇을 받는지 1회 확인 후 정리).
- Liner Responses는 `json_schema`+`strict`를 지원한다 → editorial·review 출력을 strict 스키마로 받는다(직전 run의 editorial 형식 오류 대응).

## 4. 단계별 설계

### 4.1 캡처 (D5) — `lib/visual-gate.js`, `lib/background-job.js`
- 게이트에 "직전 프레임" 모드: 정지 판정된 프레임을 후보로 계속 갱신해 쥐고, **다음 전환이 확정되면 후보(전환 직전 마지막 정지 프레임)를 제출**한다. 메모리에는 슬라이드당 후보 1장 + 첫 프레임 저해상도 썸네일 1장만.
- 영상 끝: 마지막 슬라이드는 영상 끝 직전 프레임을 제출한다(종료 시 flush).
- 재방문: 새 슬라이드를 이전 모든 슬라이드의 썸네일과 비교해 같은 슬라이드면 **기존 캡처·OCR 결과를 지우고 새 캡처로 대체**한다. 발화 근거는 지우지 않고 대체된 슬라이드에 다시 묶는다. 방문 횟수는 강조 신호로 쓴다.
- 키프레임 간격 2초(`KEY_EVERY`) 그대로 — 직전 프레임은 전환보다 최대 2초 이르다. 판서가 전환 2초 안에 끝나는 경우의 누락은 실측 후 간격 조정을 검토.
- 웹캠·영상 타일 제외 규칙(EMA 마스크), 워터마크 마스킹, 전체 슬라이드 크롭 금지는 유지.

### 4.2 필기 판별 (D6) — 새 `lib/ink-diff.js`
- 같은 슬라이드의 첫 썸네일과 마지막 캡처를 같은 해상도로 비교 → 새로 생긴 획 영역 마스크(커서·웹캠 타일 제외).
- 마스크와 겹치는 OCR 블록 = `ink:true`.
- 겹치지만 OCR 텍스트가 없거나 신뢰도가 낮은 필기 영역은 그 영역 이미지(메모리)를 작성 모델(Haiku 5.5, 이미지 입력)에 근거로 넘겨 **해석한 문장**으로 반영한다(해석 근거는 `ink:true`, `basis`는 필기 해석). 노트에는 크롭을 싣지 않고, 이미지는 호출 후 버린다. 해석 불가면 그 필기는 빠졌다는 진단 코드만 남긴다.
- 정확도(필기 놓침·인쇄 글자 오표시)를 실험 지표로 잰다.

### 4.3 강조 신호 (D4) — 새 `lib/emphasis.js`, 모델 없음
슬라이드·발화 유닛마다 아래 값을 계산해 plan 입력에 숫자로 싣는다. 가중합은 하지 않고 성분을 그대로 넘겨 Sol이 판단한다.
- 체류: 슬라이드 구간의 발화 초(재방문 합산) / 강의 슬라이드 중앙값
- 반복: 슬라이드 핵심어가 강의 전체 발화에 다시 나온 횟수
- 강조어: 기존 `EMPHASIS_WORDS`(중요·시험 등) 발화 근처 출현
- 재방문 횟수, 필기 면적
판정 모델(JEV judging)은 끈다.

### 4.4 Sol 계획·편집 계획 (Liner)
- 섹션 순서 = 슬라이드 순서. 모든 슬라이드는 정확히 한 섹션에 배정(제목·빈 슬라이드는 "내용 없음" 표시 허용).
- 블록은 기존 카탈로그(B03·B05~B14·B18) 중에서만 고른다. 강조 상위 지점에 부가 설명(B12 hint/background)을, 말로만 한 내용에 B12 `slide_absent`를 배정한다.
- plan·editorial은 현 v2/v3 경로(접두 P) 재사용.

### 4.5 Haiku 작성 (OpenRouter)
- 섹션별 독립 호출. 입력 = 섹션 계획 + 그 섹션 근거(슬라이드 OCR·필기 표시·발화) + 용어집. 출력 = 기존 SectionDraft JSON.
- provider schema는 정적 구조만(블록 ID별 키 대신 `{blockId, reason}[]`), 정확한 대응은 로컬 검증. 응답은 `finish_reason`/잘림·거부를 먼저 보고 JSON 검증.

### 4.6 표시 규칙 — 렌더러가 근거에서 계산 (모델이 마크업하지 않음)
- **강조**: 인용 근거의 강조 신호가 임계 이상인 주장은 렌더러가 강조 표시(시안 1B: 볼드 + 연한 형광 밑줄, 인쇄 시 실선 밑줄). 임계는 파일럿에서 정한다.
- **교수 필기**: `ink:true` 근거를 인용한 주장에 필기 표시(시안 2B: 점선 밑줄 + 펜 아이콘). 크롭 원본은 싣지 않는다.
- **슬라이드에 없는 설명**: B12 `slide_absent`. 근거가 발화뿐이고 슬라이드 OCR과 겹치지 않아야 한다(로컬 검사). 라벨은 정확히 "슬라이드에 없는 설명"(시안 3B: 연한 배경 + 마이크 아이콘, 인쇄 시 왼쪽 굵은 테두리).
- 이를 위해 Note JSON에 근거 메타 사이드카(`unitId → {source: slide|speech, ink, emphasis}`)를 versioned 필드로 추가한다.

### 4.7 Sol 피드백 1회 (D8)
- 렌더된 HTML에서 CSS·스크립트·크롭 바이트를 빼고 `data-block`·`data-claim` ID를 남긴 축약 HTML을 기존 Sol 이력 뒤에 보낸다.
- 출력(strict 스키마) = 기존 REVIEW_OPS(term_fix·claim_edit·dedupe·relation_fix·relink_asset) + `request_section_redo`.
- 섹션 재작성 상한 = `max(1, floor(영상 분 / 10))`, Sol이 매긴 중요도 순. 재작성은 Haiku가 Sol 지시로 수행하고 같은 검증·원복 규칙을 탄다. 2회차 피드백은 없다.

## 5. 레이아웃 고정 (사용자 요청 "항상 그 레이아웃") — 추가로 할 일
1. **레이아웃 버전 고정**: `NoteSpec` 블록 카탈로그·문서 순서를 "레이아웃 v1"로 선언. 블록·순서 변경은 사용자 승인 사항으로 하고 note-spec 버전을 올린다.
2. **골든 노트 회귀 검사**: 사용자가 승인한 샘플 노트 1개를 고정 픽스처로 두고, 렌더 HTML의 블록 순서·클래스 구조 스냅샷을 테스트로 비교한다. 릴리스마다 PDF를 한 번 눈으로 확인한다. 원본 참고 교재 PDF는 저작권 자료라 저장소에 넣지 않는다.
3. **새 표시 시안**: 1B·2B·3B 확정(2026-10-09, [시안](https://claude.ai/artifact/2mDqVvBEcummPH33WjVJyg)). B안은 흑백 인쇄에서 약해지므로 `@media print` 대체 표시를 둔다. 추가 강조·개념 구조화 표현 7개 전부 채택(2차 시안): 시험 배지, 반복 ×N, 핵심 용어 첫 등장 굵게, 조건·예외 마커, 인과 흐름(→), 대비 쌍(A ↔ B), 교수 강조 인용(40자). 렌더러가 데이터로 켜고 섹션당 상한을 코드로 강제하며, 한 주장에 굵은 표시는 하나만.
6. **슬롯 라벨 숨김**: 개념 설명의 "쉬운 풀이"·"범위" 같은 슬롯 라벨은 생성 때 내부 구조로만 쓰고 화면·PDF에는 표시하지 않는다(전 모드 공통). 2026-10-09 최종: 숨김은 B05 슬롯 라벨과 B08 의사결정 6칸(들여쓴 목록)만. B06·B08 판단/범위·B09·B18 라벨과 B10~B17 필드 라벨, 타입 배지, 구조 이름은 유지.
7. **못 읽은 필기 전송 승인**(2026-10-09): OCR이 못 읽은 필기 영역은 유료·클라우드 인식 동의 범위에서 Haiku에 이미지로 보내 해석한다. 저장하지 않고 호출 후 해제. AGENTS.md 크롭 범위에 예외로 기록.
4. Haiku·Sol 어느 쪽도 스타일을 만들지 않는다 — 블록 선택과 본문만.
5. 양식 고정 문구는 humanize한다(워커 배정됨, §10).

## 6. 비용·지연 (추정 — 실측 아님)
| 단계 | 근거 | 75분 강의 추정 |
|---|---|---|
| OCR | 슬라이드 60장 × $4/1,000 | $0.24 |
| Sol plan+editorial | 직전 sol-luna-2 run 실측 $0.097+$0.073 | ~$0.17 |
| Haiku 작성 | 섹션 8개 × (입력 ~15K, 출력 ~4K) | ~$0.03 |
| Sol 피드백 | 축약 HTML ~30K 입력 + 출력 ~5K | ~$0.11 |
| Haiku 재작성 | 최대 7개(75분) | ~$0.03 |
- 원장: OCR은 `usage_info.pages_processed` 기준 페이지 과금(토큰 0으로 위장 금지), Haiku는 OpenRouter `usage.cost`, Sol은 Liner `usage.cost`. 마이크로 단위 누적.
- 예약: OCR = 예상 페이지 × 단가 × 최대 시도. 429/5xx만 제한 재시도, 400·미지원은 설정 오류로 중단.

## 7. 프롬프트 원칙 (사용자 요청)
- 단계별 지시는 핵심 규칙만, 짧게. **스키마·검증기로 강제할 수 있는 제약은 프롬프트에 쓰지 않는다.**
- 공용 서문 없이 단계 지시만. 같은 말 반복·예외 나열·당부 문장 금지.
- 강의 원문 속 지시문은 데이터로만 취급한다는 한 줄은 유지.
- 프롬프트 길이를 버전과 함께 기록해 늘어나면 리뷰에서 걸린다.

## 8. 변경 지점 (구현 승인 후)
| 묶음 | 파일 | 비고 |
|---|---|---|
| 프로파일 | `lib/note-profiles.js`(레지스트리, 진행 중) 에 `mis-sol-hai` 한 줄 | 단계→모델: plan·editorial·review=Sol(Liner), draft=Haiku 5.5(OpenRouter) |
| 라우팅 | `server/llm.js` Liner 대상 목록을 모델 목록으로, OpenRouter 기본 | 메인의 미커밋 Liner 변경과 합친 뒤 |
| 캡처 | `lib/visual-gate.js`, `lib/background-job.js` | 직전 프레임·끝 flush·재방문 대체 |
| 필기·강조 | 새 `lib/ink-diff.js`, `lib/emphasis.js` | 순수 함수 + 단위 테스트 |
| OCR | 새 `server/ocr-mistral.js`, `server/index.js` vision 분기, `lib/vision-client.js` | 응답 → slideDoc 정규화, 페이지 과금 |
| 계약·렌더 | `lib/note-contract.js`(B12 `slide_absent`, 근거 메타), `lib/note-spec.js`·`lib/note-render.js`(볼드·필기 표시) | 보관 형식 필드 추가 → 호환 검토, 버전 규칙 적용 |
| 피드백 | `lib/stages.js` review 입력을 축약 HTML로, 재작성 상한 | 기존 REVIEW_OPS 재사용 |
| 프롬프트 | `server/prompts.js` mis-sol-hai 단계 지시 | §7 |
| 배포물 | Edge 번들·landing vendor | 통합 때 1회 |

## 9. 검증과 실험
- 단위: 직전 프레임 선택·끝 flush·재방문 대체, 프레임 차이 마스크, 강조 신호 계산, OCR 응답 정규화(null·빈·다중 페이지·표 bbox 누락), B12 `slide_absent` 검사, 볼드 임계, 재작성 상한 계산, 골든 노트 구조 스냅샷.
- 실험: 같은 강의 3개(lec1~3)로 sol-luna-3 기준선 대비. 한 번에 하나씩 바꿔 원인을 분리한다 — (A) 캡처·OCR만, (B) 작성 Haiku만, (C) 전체.
- 지표: 슬라이드 커버리지, 필기 재현율·오표시, 강조 표시 정밀도(사람 표본), "슬라이드에 없는 설명" 정확성(사람 표본 — JEV가 없으므로 근거 없는 주장 비율도 사람이 감사), 단계별 비용·지연 p50/p95, 부분 완료율.
- 채택: 같은 자료 블라인드 비교에서 치명적 회귀 없음. 숫자 합격선은 파일럿 분포를 보고 본 실험 전에 고정.

## 10. 진행 상황
- 2026-10-09 구현 완료, w/dev 로컬 통합(v2.8.0, `3781954`): 프로파일 레지스트리, humanize, L1 캡처·L2 Mistral OCR·L3 강조 신호·L4 렌더 표시·L5 모델 경로·L6 Sol 검수·L7 배선·L8 라벨 숨김. 레인마다 Haiku 검토 → 수정 → 통합. 게이트 1554 통과/0 실패, CWS dry-run 통과.
- 2026-10-09 서버 배포 완료(2.8.0.1, Haiku 공급자 amazon-bedrock 수정 포함). 운영 허용 목록에 Haiku 5.5·mistral-ocr-4-1 추가. 배포 중 비밀값을 먼저 바꿔 약 수 분간 전체 503이 있었다.
- 미실행: push, CWS 업로드, 유료 실강의 실험.

## 11. 요구사항 추적
| 사용자 요구 | 반영 |
|---|---|
| 전환 직전 캡처(필기 포함) | D5, §4.1 |
| 마지막 슬라이드 = 영상 끝 직전, 재방문 시 삭제·재캡처 | §4.1 |
| STT | §1 (기존 경로) |
| Mistral OCR | §3.1, §8 |
| 예시 PDF 레이아웃 항상 준수 | D2, §5 |
| Haiku로 작성 | D1, §4.5 |
| 기존 Sol 세션 피드백, HTML, 부분 재작성, 1회, 10분당 1섹션 | D8, §4.7 |
| 필기 강조 | D6, §4.2, §4.6 |
| 전체 흐름 유지 + 강조는 볼드·부가 설명 | D3, §4.4, §4.6 |
| 말로만 한 내용 = "슬라이드에 없는 설명" | D7, §4.6 |
| JEV 제외 | D10, §4.3 |
| Liner 우선, 없으면 OpenRouter, Visualization 미사용 | D9, §3.2~3.3, §1 비목표 |
| 프롬프트 핵심만 | §7 |
| 양식 문구 humanize | §5-5, §10 |
| 다양한 실험 대비 코드 준비 | §10 레지스트리 |
