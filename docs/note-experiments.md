# 노트 실험 프로파일

실험 모드(숨은 설정 `devNoteMode`)의 단계→모델·세션 계약은 `lib/note-profiles.js` 표 하나가 단일 출처다.
클라이언트(`offscreen.js` 모델 선택, `lib/stages.js` 라우팅)와 서버(`server/index.js` 허용 판정, `server/note-session.js` 봉투 검증)가 같은 파일을 읽는다.

## 새 실험 모드 추가 절차

1. `lib/note-profiles.js` `PROFILES` 에 항목 하나를 추가한다:
   - `id`: `devNoteMode` 값. `family`(`independent`|`session`|`v2`), `session`(`null`|`chain`|`fork`),
     `stages`(`{<단계>:{model, transport:"session"|"independent"|"packet"}}`), `clientModels`({plan,write}), `options`(정규화 함수 또는 null).
   - transport 뜻은 파일 머리 주석 참고. `packet`은 "세션 XOR 패킷"(sol-luna-3 repair 참고).
2. 새 단계·요청 칸이 필요하면 `server/prompts.js`의 `REQUEST`/`STAGE`(프롬프트·스키마)를 먼저 추가한다 — 표만으로는 새 단계가 안 생긴다.
3. `lib/note-profiles.test.js` 3종이 자동으로 새 항목을 검사한다(불변식은 전 행 순회). 동치 표는 기존 7개만 덮는다 — 새 모드는 직접 기대값을 쓴다.
4. `lib/settings.js`의 `devNoteMode` 허용 목록에 새 id를 추가해야 숨은 설정으로 켤 수 있다(validateSettings 화이트리스트).
5. 실행: `chrome.storage.local`의 `devNoteMode`에 id를 넣고 노트 생성. 비교 실험은 `tools/note-session-experiment.mjs --mode <id>`.

## 하지 말 것

- 모드 이름 문자열 비교·목록을 다른 파일에 새로 만들지 말 것 — 전부 `NoteProfiles` 헬퍼(`get`·`ids`·`isV2`·`isLunaV2`·`stageModel`·`serverRoute`)에서 파생한다.
- 모르는 모드·단계·모델을 조용히 폴백하지 말 것 — 거절(`NOTE_MODE_INVALID`·`invalid_model_or_stage`)이 계약이다.
- 레지스트리에 없는 단계를 표에 "미래용"으로 미리 넣지 말 것 — 서버가 허용하는 단계만 적는다.
