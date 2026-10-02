# Summrizei 파일럿 서비스

Node.js 22 이상, 추가 의존성/빌드 없이 `node server/index.js`. 기본 바인딩은 `127.0.0.1:8788`이다. **상태를 보존하는 단일 프로세스**로 실행한다. Vercel 정적 랜딩에 이 파일을 올리는 것만으로 API가 생기지 않는다.

운영자 OpenRouter 키는 서버에서만 사용한다. 확장에는 서비스 URL과 별도로 발급한 앱 토큰을 입력한다. 현재 수동 토큰 발급은 내부 파일럿용이며 소비자 가입·로그인·토큰 갱신·Paddle 권한 연동은 포함하지 않는다.

## 설정

실제 값은 비밀 관리 도구로 주입하고 Git/셸 기록에 남기지 않는다. 아래 값은 형식 설명용 자리표시자다.

```text
OPENROUTER_API_KEY=<운영자 키, 확장에 넣지 않음>
EXTENSION_ORIGIN=chrome-extension://<실제 32자 확장 ID>
APP_TOKENS_JSON={"pilot-user":"<계정마다 고유한 32자 이상 난수 앱 토큰>"}
ALLOWED_MODELS=["google/gemini-2.5-flash-lite"]
OPENROUTER_PROVIDERS_JSON={"google/gemini-2.5-flash-lite":["<검증한 공급자 식별자>"]}
GROQ_API_KEY=<운영자 Groq 키 — ALLOWED_STT_MODELS가 비어 있지 않으면 필수>
ALLOWED_STT_MODELS=["whisper-large-v3-turbo"]
VAULT_DIR=<서비스 전용 영속 볼륨의 절대 경로>
USAGE_STATE_FILE=<같은 영속 볼륨>/usage.json
MAX_REQUESTS=10000
MAX_COST_CENTS=1500
GLOBAL_COST_CENTS=15000
PORT=8788
FEATURE_FLAGS_JSON={"vision":true}
REMOTE_CONFIG_JSON={"minClientVersion":"0.0.0"}
ACCOUNT_CONCURRENCY=12
PROVIDER_CONCURRENCY_JSON={"google/gemini-2.5-flash-lite":16}
PROVIDER_QUEUE_MS=10000
ACCOUNT_RATE_PER_MIN=300
```

`OPENROUTER_PROVIDERS_JSON`은 필수다. 값은 공급사 이름이 아니라 **모델별 엔드포인트 태그**이며 모델마다 다르다(`google/gemini-2.5-flash-lite`는 `google-vertex`, `google/gemini-3.8-flash`는 `google-vertex/global`). `https://openrouter.ai/api/v1/models/<model>/endpoints`로 태그·ZDR·구조화 출력 지원을 확인하고 넣는다. 없는 태그를 넣으면 요약 요청이 400으로 실패한다. 임의 공급자 fallback을 허용하지 않는다. 공급자가 없거나 필수 파라미터를 지원하지 않으면 요청이 실패하는 것이 정상이다.

`MAX_REQUESTS`는 기본 계정의 UTC 달력 월 요청 수(기본 10000)이고 강의 편수가 아니다. 요청 수는 거친 안전망일 뿐 진짜 상한은 아래 비용 캡이다(유료 강의 1시간이 150회 안팎을 부른다). `MAX_COST_CENTS`는 계정당 월 USD 센트, `GLOBAL_COST_CENTS`는 전체 계정 월 USD 센트다. 500센트는 $5다. 각 계정별 모델과 상한을 좁히려면 다음을 추가한다.

```json
{
  "pilot-user": {
    "models": ["google/gemini-2.5-flash-lite"],
    "maxRequests": 100,
    "maxCostCents": 100
  }
}
```

위 JSON을 `ACCOUNT_LIMITS_JSON`에 지정한다. 명시하지 않은 계정은 전역 기본 한도를 상속한다. 환경 파일의 토큰을 교체/제거하고 서비스를 재시작하면 해당 토큰을 회수할 수 있다. 결제 플랜 권한은 클라이언트가 선택한 모델을 믿지 않고 서버 설정으로 판정한다.

현재 RATES는 2026-09-11 확인한 후보 단가다. 제공자 요금이 바뀌면 예약 계산을 갱신해야 한다. OpenRouter 키 자체에도 비용 한도를 설정해 이중으로 제한한다. 비용 상한은 결제 및 소매 단위 차감 시스템을 대신하지 않는다.

`FEATURE_FLAGS_JSON`은 기능별 전역 스위치다. `false`로 지정한 기능은 계정 권한과 무관하게 `/v1/me` 목록과 라우트에서 꺼진다(기본 `{}` = 모두 켬). `REMOTE_CONFIG_JSON`은 클라이언트에 내려가는 원격 설정으로 기본값 `{concurrency:{download:4,decode:1,stt:4,vision:8,judge:2,write:8},throughputMbps:50,minClientVersion:"0.0.0",promptVersion:"v1",schemaVersion:1}` 위에 병합된다. 알 수 없는 키나 0 이하 수치는 기동을 거부한다. `minClientVersion`보다 낮은 `x-client-version` 헤더의 클라이언트는 426을 받는다. `ACCOUNT_CONCURRENCY`는 계정당 동시 진행 요청 상한(기본 12), `PROVIDER_CONCURRENCY_JSON`은 모델별 제공자 동시 슬롯(기본 16), `PROVIDER_QUEUE_MS`는 슬롯 대기 상한(기본 10000, 넘으면 `provider_busy`), `ACCOUNT_RATE_PER_MIN`은 계정당 분당 POST 상한(기본 300)이다.

## 데이터와 운영 경계

- 요청/응답 본문을 로깅하지 않는다. 역방향 프록시·APM·오류 수집 도구에도 본문/Authorization 로깅을 끈다.
- 추론 텍스트는 서비스·OpenRouter 제공자 메모리에서 일시 평문 처리된다. 요청은 HTTPS로 전송하고 ZDR/학습 거부/공급자 고정/fallback 금지를 요청한다. 실제 계약과 처리 국가를 따로 검증한다.
- 보관함은 확장에서 암호화한 AES-GCM envelope만 허용한다. 계정/문서/종류 AAD, 엄격한 필드 검증, 최대 평문 16 MiB에 해당하는 envelope, 계정당 100개/200 MiB를 제한한다.
- 서버는 암호·복호화 키를 받지 않는다. 암호 분실 복구는 없다. `DELETE /v1/vault/:id`는 현재 보관 파일을 삭제한다. 백업이 있다면 백업 파기 기간과 처리 방법은 운영자가 별도로 정해야 한다.
- 파일 경로는 서비스만 쓰는 전용 디렉터리로 지정한다. 일반 사용자나 다른 프로세스가 파일/심볼릭 링크를 교체할 수 있는 경로를 쓰지 않는다.
- 실제 서비스는 영속 볼륨과 HTTPS reverse proxy를 갖춘 별도 호스트에서 운영한다. 본문 버퍼의 임시 디스크 기록, 스왑/코어 덤프, 접근 기록·백업·키 관리도 점검한다. 개발용 localhost 외에 확장 서비스 URL은 HTTPS만 허용한다.

## 사용량·중복 요청

추론 호출 전에 요청 ID와 본문 해시, 예약액을 `usage.json`에 원자적으로 기록한다. 같은 ID 재요청은 409로 차단한다. 같은 ID에 다른 본문은 400이다. 결과 평문은 저장하지 않으므로 서버 재시작 후 결과를 재전송하지 않는다. 클라이언트가 응답을 받지 못했다면 새 요청은 비용이 다시 발생할 수 있다.

실제 비용이 숫자로 보고되면 0.000001 USD 단위로 올림해 원장을 보정한다. 비용 누락·취소·실패 시 예약액을 유지한다. 요청 시작과 완료 시 월이 바뀌는 경우를 포함해 이 원장은 사용 제한을 위한 보수적 장치다. 최종 정산은 공급자 자료와 대조한다.

원장 JSON이 손상되면 기동을 거부한다. 임의로 원장을 삭제하면 이력이 없어지므로 백업을 복구하고 비용을 대조해야 한다. 한 원장 파일을 여러 프로세스/서버리스 인스턴스가 함께 쓰면 안전하지 않다. 확장 전에 DB 트랜잭션으로 예약·중복 방지를 이전한다.

오류 응답은 `{error:{code,message,retryable,retryAfterMs}}` 봉투다. 같은 requestId는 멱등하며 중복은 409다. 제공자 호출이 나간 뒤 실패하면 예약은 "uncertain"으로 남아 비용을 보수적으로 잡으므로 5xx 뒤 재시도는 새 requestId(예: 원본 + "-r1")를 써야 한다. `provider_busy`는 제공자에 아무것도 보내지 않은 요청이라 예약이 정확히 되돌아가며 같은 requestId로 재시도할 수 있다. `retryable`과 `retryAfterMs`는 429 재시도 대기 힌트다.

## 화면 인식(비전)

`POST /v1/vision`은 슬라이드 프레임 한 장을 구조화된 SlideDoc으로 옮긴다. 본문은 정확히 `{model, requestId, slideId, t0, t1, image, mode}`다. `image`는 `data:image/jpeg;base64,` 한 덩어리(디코드 후 최대 1.5 MiB), `mode`는 `full` 또는 `reread`(수식·표 영역을 2배로 잘라 다시 읽는 모드)다. 응답은 `{slideDoc, usage, promptVersion, schemaVersion}`이고 `slideDoc`은 `Contracts.SCHEMAS.slideDoc`을 따른다.

제공자에게는 slideDoc 스키마에서 검증 전용 키워드를 뺀 strict JSON Schema(`response_format: json_schema`, 이름 `slide_doc`)를 내리고 `id`·`status`는 서버가 채운다. 형식 실패(출력 잘림·JSON 파손·계약 불일치)는 같은 제공자로 한 번만 재시도한다. 프레임은 zero-retention 제공자(`zdr`, `data_collection:"deny"`, fallback 금지)로만 보내고 서버에는 저장하지 않는다.

## 음성 인식(STT)

`POST /v1/stt`는 Groq Whisper에 오디오 청크를 multipart로 넘겨 전사한다. 본문은 정확히 `{model, requestId, t0, durationSec, lang, prompt, audio}`다. `audio`는 `data:audio/mp4;base64,` 한 덩어리(디코드 후 최대 8 MiB, 길이 최대 330초), `lang`은 `ko`/`en`, `prompt`는 1000자 이하(빈 문자열 허용), 요청 본문 상한은 12 MB다. 응답은 `{transcript, usage:{audioSec,costUsd}, promptVersion, schemaVersion}`이고 `transcript`는 `Contracts.SCHEMAS.transcript`다.

`ALLOWED_STT_MODELS`에는 `STT_RATES`에 단가가 있는 모델만 넣는다. 비어 있으면(기본) `/v1/stt`는 어떤 모델에도 `invalid_model`로 답한다. 과금은 오디오 시간당이다: `whisper-large-v3-turbo` $0.04/h, `whisper-large-v3` $0.111/h, 최소 청구 10초. 예약은 클라이언트 선언 `durationSec`으로 잡고 정산은 `max(선언값, 제공자가 보고한 duration)`으로 확정한다 — 제공자가 실제 음성 길이로 청구하기 때문이다.

오디오는 메모리에서만 디코드돼 Groq로 전달되고 원장·로그·오류 본문에 남지 않는다(멱등 digest에는 base64의 sha256만 들어간다). Groq의 zero data retention은 요청 단위로 설정할 수 없으므로 Groq 조직 설정에서 미리 켜둬야 한다. 제공자 HTTP 오류(429 `provider_busy` 포함)는 과금이 없다고 확정할 수 있어 예약을 정확히 되돌리고 같은 requestId를 재사용할 수 있다. 200인데 출력이 계약을 어기는 경우 등 그 밖의 실패는 예약을 유지한다.

## 판정(judge)

`POST /v1/judge`는 다섯 가지 판정 과제를 한 라우트로 처리한다. 본문은 정확히 `{task, model, requestId, items}`이고 `items`는 `{itemId(1~64자, 요청 안에서 고유), text(1~8000자), context(선택, 8000자 이하)}` 객체 1~200개다. `items` 직렬화 총량은 64 KiB, 요청 본문 상한은 70000바이트다. 응답은 `{results:[{itemId,task,probs,score,model}], usage:{promptTokens,completionTokens,costUsd}, promptVersion, schemaVersion}`이고 각 결과는 `Contracts.SCHEMAS.judgeResult`를 따른다.

과제와 라벨(선택지 알파벳은 라벨 순서대로 A, B, C…): `utterance`=lecture/example/admin/chatter, `importance`="1"~"5", `boilerplate`=yes/no, `figure`=core/supporting/decorative, `support`=supported/unsupported. score는 `importance`가 기댓값(1~5), `boilerplate`가 p(yes), `support`가 p(supported)이고 `utterance`·`figure`는 null이다.

호출은 항목당 한 번이다. `max_tokens:1, temperature:0, logprobs:true, top_logprobs:10`으로 알파벳 한 글자만 받고 top_logprobs에서 라벨 글자의 확률 질량을 모아 라벨끼리 다시 정규화한다. 상위 10개에 라벨 글자가 하나도 없으면 그 항목은 `probs:[], score:null`의 "판정 없음"으로 돌아가고 클라이언트가 플래너로 넘긴다. 모델은 `JUDGE_MODELS` 레지스트리가 `via`(호출 방식)와 단가를 묶어 결정한다 — 다른 종류의 판정 제공자를 추가해도 `via` 구현만 더하면 돼서 클라이언트는 안 바뀐다.

`ALLOWED_JUDGE_MODELS`는 `JUDGE_MODELS` 키의 JSON 배열이다. 미설정 시 기본값은 `["openai/gpt-4.1-nano"]`이지만 `OPENROUTER_PROVIDERS_JSON`에 해당 모델의 비어 있지 않은 제공자 목록이 있을 때만이고, 없으면 `[]`다. 허용된 판정 모델은 요약·비전과 마찬가지로 명시적 제공자 목록이 필수다. `gpt-4.1-nano`에는 반드시 ZDR 가능한 엔드포인트 태그를 넣는다 — `zdr:true` 요청이라 자사(1P) 태그는 제공자가 거절한다.

비용은 다른 라우트와 같은 예약·정산을 쓴다: 예약은 `항목당 (입력 바이트+시스템 프롬프트)×입력 단가 + 1토큰×출력 단가`의 1.2배, 정산은 각 호출이 보고한 `usage.cost` 합계다. 항목 텍스트는 멱등 digest에 sha256 해시로만 들어가고 저장되지 않는다. 항목 단위 제공자 슬롯은 대기 타임아웃·환불 표시가 없는 "patient" 모드다 — 일부 항목이 이미 결제된 뒤 예약을 되돌리면 공짜 호출이 되므로, 하나라도 나간 뒤 실패하면 예약을 유지하고 첫 실패에서 나머지 호출을 중단한다.

## 노트 계획·작성(plan/write)

`POST /v1/plan`(본문 ≤ 256 KB)은 IR 전체를 받아 섹션 계획을 1회 만들고, `POST /v1/write`(본문 ≤ 64 KB)는 섹션별로 병렬 호출해 블록을 쓴다. 둘 다 Free 포함 전 계정이 쓴다 — 등급 기능 검사 없이 `/v1/summary`와 같은 계정 한도(`ALLOWED_MODELS`, `ACCOUNT_LIMITS_JSON`의 모델·비용 상한)와 `RATES`·제공자 태그를 쓴다.

- `plan`: `{model, requestId, noteSpecVersion, ir:{units:[Unit]}, formulas:[{id:"F12", status}]}` → `{plan, usage, promptVersion, schemaVersion, noteSpecVersion}`. 유닛은 `Contracts.SCHEMAS.unit`으로 검증한다.
- `write`: `{model, requestId, noteSpecVersion, stage, …}` → `{blocks, usage, promptVersion, schemaVersion, noteSpecVersion}`. `stage`별 추가 필드는 `section`: `{section, units, registry:[{id, latex|null, status}]}`, `global`: `{sections:[{sectionId, title, blocks}]}`, `repair`: `{section, units, registry, repair:[{index, block, errors:[{code, detail}]}]}`다. `repair`는 정확히 `repair.length`개의 블록을 같은 순서로 돌려준다.
- 노트 양식(블록 종류, 스키마, 한도, 프롬프트 형식 규칙)은 `lib/note-spec.js` 한 곳에서만 온다. 지금은 자리표시자(`NOTE_SPEC_VERSION="placeholder-0"`)이고, 양식 설계 산출물이 이 파일을 대체해도 라우트는 바뀌지 않는다. 버전이 다른 요청은 모양 검사 전에 `409 note_spec_mismatch`다. 프롬프트·요청/출력 스키마·생성 파라미터는 `server/prompts.js`(`PROMPT_VERSION`)가 관리한다.
- 호출 방식은 요약과 같다: OpenRouter strict `json_schema`(검증 전용 키워드는 뺀 스키마), `temperature:0`, 지원 모델(Anthropic 제외)에는 `seed`, `zdr`·`data_collection:"deny"`·fallback 금지. 시스템 본문이 앞이고 입력이 뒤이며 캐시 모델에는 `cache_control`을 찍는다. 출력은 `Contracts.validate`로 검증하고 형식 실패(`repair` 개수 불일치 포함)만 같은 모델로 한 번 재시도한다.
- `finish_reason=length`는 한도를 키워 재시도하지 않고 `422 llm_output_truncated`(재시도 불가)로 답한다. 클라이언트가 섹션을 나눠 새 requestId로 다시 보낸다. 환불이 아니다: 제공자가 보고한 금액만 청구하고(미보고면 예약 유지) 같은 requestId는 다시 쓸 수 없다.
- 입력 토큰은 바이트/4로 어림해 plan 40k, write 12k를 넘으면 `request_too_large`다. 출력 상한은 plan 8k, write 4k 토큰(`NoteSpec.limits.tokens`). 알 수 없는 필드는 `unexpected_field`, 모양 위반은 `request_rejected`다.

## 확인

```text
node --test lib/*.test.js server/*.test.js
```

HTTP 통합 테스트는 합성 자료와 모의 제공자만 사용한다. 인증, 계정별 암호문, 삭제, 변조, 요청 중복, 재시작, 공급자 정책, 비용 누락 및 계정별 모델/횟수 제한을 확인한다. 실제 강의 본문을 파일 fixture·테스트 로그·Headroom에 넣지 않는다.

브라우저 합성 검증은 설치된 Playwright 모듈 경로를 `PLAYWRIGHT_MODULE`, Chrome 실행 파일을 `CHROME_PATH`로 지정하고 `node tools/browser-smoke.cjs`를 실행한다. 설치된 MV3 확장의 tabCapture 권한 흐름과 2시간 부하 시험은 별도다.

가격과 암호화의 한계는 [가격·보안 검토](../docs/pricing-security-review.md), 구현 상태는 [PRD](../docs/architecture-prd.md)를 따른다.
