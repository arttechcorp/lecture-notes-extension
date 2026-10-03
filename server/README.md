# Summrizei 파일럿 서비스

Node.js 22 이상, 추가 의존성/빌드 없이 `node server/index.js`. 기본 바인딩은 `127.0.0.1:8788`이다. Vercel 정적 랜딩에 이 파일을 올리는 것만으로 API가 생기지 않는다.

운영자 OpenRouter 키는 서버에서만 사용한다. 계정은 두 종류다.

- **정적 토큰 계정**(`APP_TOKENS_JSON`): 운영·개발·테스트용. 한도는 `ACCOUNT_LIMITS_JSON`, 장부는 JSON 파일(`usage.json`)이라 **상태를 보존하는 단일 프로세스**로 실행한다.
- **Supabase 계정**(`SUPABASE_URL` 설정 시): 확장이 Supabase Auth 로그인으로 받은 액세스 토큰(JWT)을 `Authorization: Bearer`로 보낸다. 한도·예약·사용량 원장이 Postgres에 있어 이 계정의 요청 처리는 서버에 상태를 남기지 않는다(아래 "Supabase 계정과 장부"). 소비자 결제(Paddle) 연동은 아직 없다. 등급은 `admin_grant_plan()`으로 수동 부여한다.

## 설정

실제 값은 비밀 관리 도구로 주입하고 Git/셸 기록에 남기지 않는다. 아래 값은 형식 설명용 자리표시자다.

```text
OPENROUTER_API_KEY=<운영자 키, 확장에 넣지 않음>
EXTENSION_ORIGIN=chrome-extension://<실제 32자 확장 ID>
APP_TOKENS_JSON={"pilot-user":"<계정마다 고유한 32자 이상 난수 앱 토큰>"}
ALLOWED_MODELS=["google/gemini-2.5-flash-lite"]
OPENROUTER_PROVIDERS_JSON={"google/gemini-2.5-flash-lite":["<검증한 공급자 식별자>"]}
ALLOWED_STT_MODELS=["microsoft/mai-transcribe-2"]
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
# Supabase 계정(선택, 아래 절 참고). SUPABASE_URL을 켜면 나머지 둘이 필수다.
SUPABASE_URL=https://<프로젝트 ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<서비스 롤 키, 서버 전용>
USAGE_DIGEST_KEY=<32자 이상 난수, 서버 전용>
SUPABASE_JWT_SECRET=<HS256 프로젝트일 때만>
VAULT_BUCKET=vault
PLAN_FEATURES_JSON={"essential":{"features":["vision","stt","judge","background"]}}
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

## Supabase Edge Function 배포 (확장만 불러와 테스트할 때)

확장의 기본 서비스 주소는 `https://rppknkhbiivyurhvljoi.supabase.co/functions/v1/api`다(`lib/settings.js` `SERVICE_URL`). 로컬 node 서버 없이, 저장소 폴더를 Chrome에 "압축해제된 확장 프로그램"으로 불러와 Google로 로그인하면 이 함수를 쓴다.

- 코드: `supabase/functions/api/index.js`(진입) → `adapter.js`(Deno `Request` ↔ 서버 처리기의 Node 모양 req/res) → `server.bundle.js`(`server/index.js`와 그 의존 `server/*`·`lib/*`를 묶은 생성 파일).
- 서버 코드를 고치면 묶음을 다시 만든다: `node tools/build-edge.mjs`. 커밋된 묶음이 소스와 다르면 `tools/edge-api.test.mjs`가 실패한다.
- 함수 설정은 `supabase/config.toml` `[functions.api]`다. 게이트웨이 JWT 검사는 끄고 서버가 직접 검증한다(Supabase 로그인 JWT와 개발용 정적 토큰을 함께 받기 위해).
- `SUPABASE_URL`·`SUPABASE_SERVICE_ROLE_KEY`는 Edge 런타임이 넣어 준다. 나머지는 비밀값으로 한 번 넣는다(값은 셸 기록에 남지 않게 `--env-file`을 권한다).

```bash
supabase secrets set --env-file <저장소 밖의 env 파일>
```

| 이름 | 값 |
|---|---|
| `OPENROUTER_API_KEY` | 운영자 OpenRouter 키 |
| `OPENROUTER_PROVIDERS_JSON` | 요약·계획·작성·비전·판정 모델별 ZDR 공급자 태그(아래 "설정"과 같다) |
| `ALLOWED_MODELS` | 요약·계획·작성 모델 목록(JSON 배열) |
| `ALLOWED_VISION_MODELS` | 비전 모델 목록 |
| `ALLOWED_STT_MODELS` | `["microsoft/mai-transcribe-2"]` |
| `ALLOWED_JUDGE_MODELS` | 선택. 판정 모델 |
| `EXTENSION_ORIGIN` | `chrome-extension://gllijdanodakjamndimlpgmhokaakpod`(저장소 경로에서 계산한 개발용 ID. `chrome://extensions`에서 확인) |
| `USAGE_DIGEST_KEY` | 32자 이상 무작위 문자열(요청 본문 해시용 HMAC 키) |

배포(Docker 불필요):

```bash
node tools/build-edge.mjs
supabase functions deploy api --use-api
supabase functions deploy delete-account --use-api
```

배포 뒤 확인: 확장 설정 → Google 로그인 → 사이드 패널 계정 메뉴에 등급이 보이고, 유료 등급(`entitlements`에 `essential`)이면 "백그라운드로 처리" 카드가 나온다.

한계:
- 워커는 짧게 살아서 서버 메모리의 캐시·동시성 세마포어·분당 버킷은 워커마다 따로다. 한도·중복 요청은 Postgres가 판정하므로 정확성에는 영향이 없다.
- 요청 하나는 150초 안에 응답해야 한다(Edge 유휴 제한). 제공자 호출 상한은 120초다.
- 정적 토큰 계정(`APP_TOKENS_JSON`)의 파일 장부와 보관함은 `/tmp`(워커 수명)라 남지 않는다. Edge에서는 Supabase 로그인 계정으로 시험한다.

## Supabase 계정과 장부

`SUPABASE_URL`을 설정하면 정적 토큰 계정에 더해 JWT 계정이 생긴다. 정적 토큰이 먼저 비교되고 일치하지 않으면 JWT로 검증한다. Supabase를 켠 배포는 `APP_TOKENS_JSON` 없이(JWT 계정만) 기동할 수 있다. 키 없이 켜면 기동을 거부한다.

| 환경 변수 | 설명 |
|---|---|
| `SUPABASE_URL` | 프로젝트 원점(`https://<ref>.supabase.co`, 경로 없음. 개발용 loopback만 http 허용). JWT의 `iss`는 `<SUPABASE_URL>/auth/v1`과 같아야 한다 |
| `SUPABASE_SERVICE_ROLE_KEY` | PostgREST RPC·표, Storage, Auth admin(계정 삭제) 호출 전용(`apikey` + `Authorization: Bearer`). JWKS 호출에는 보내지 않는다. 확장·로그·오류 본문에 넣지 않는다 |
| `USAGE_DIGEST_KEY` | 32자 이상. 요청 본문 digest를 HMAC-SHA256으로 만드는 서버 비밀. 없으면 기동 거부 |
| `SUPABASE_JWT_SECRET` | 선택(32자 이상). 있으면 **HS256만** 받고 JWKS는 쓰지 않는다. 없으면 JWKS의 **ES256/RS256만** 받는다. 레거시 HS256 프로젝트면 설정하고, 비대칭 서명 키로 옮겼다면 지운다 |
| `VAULT_BUCKET` | 선택(기본 `vault`). JWT 계정의 보관함 암호문을 두는 Storage 버킷 이름(영문·숫자·`_`·`-`, 63자 이하). **비공개 버킷**이어야 하고 서버가 만들지 않는다 — 대시보드에서 직접 만든다(아래 설정 순서 3) |
| `PLAN_FEATURES_JSON` | 선택. 등급별 `{features, models}`. 기본값 `free: {features: [], models: [요약 lite 모델]}`, `essential`·`professional`: `{features: ["vision","stt","judge","background"], models: ALLOWED_MODELS 전체}`. 등급 이름·가격·한도는 `plans` 표(`supabase/schema-v2.sql`)가 원본이다. 빠진 키는 기본값을 유지하고 모르는 기능 이름이나 `ALLOWED_MODELS` 밖의 모델은 기동 거부 |

**설정 순서** (Supabase CLI. 저장소는 `supabase/.temp`로 프로젝트에 연결돼 있고, 원격 설정은 `supabase/config.toml`이 선언한다)

1. 스키마: `supabase db query --linked -f supabase/schema.sql` → `supabase db query --linked -f supabase/schema-v2.sql`(둘 다 멱등). `plans` 한도는 자리표시 값(`placeholder=true`)이니 확정 값으로 고친다.
2. Auth: Google 로그인을 켠다(운영 프로젝트는 이미 켜져 있다). 확장 리디렉트 URL은 `config.toml`의 `auth.additional_redirect_urls`에 넣고 `supabase config diff`로 확인한 뒤 `supabase config push`. `config.toml`이 선언하지 않은 원격 값은 push가 건드리지 않는다. 액세스 토큰 수명은 기본 1시간을 유지한다(짧을수록 탈취 피해가 작다). 익명 로그인은 서버가 거절한다(`is_anonymous`).
3. 보관함 버킷: `config.toml`의 `[storage.buckets.vault]`(비공개, 50 MiB, `application/json`)를 `supabase seed buckets --linked`로 만든다. 크기 제한은 envelope 최대치(약 22 MiB) 이상이어야 한다. 정책(RLS)은 추가하지 않는다 — 접근은 서버의 서비스 롤 키만 쓴다. 버킷이 없으면 JWT 계정의 보관함 저장이 `503 vault_store_failed`로 실패한다. 이름을 바꾸면 `VAULT_BUCKET`도 같이 바꾼다.
4. 서버에 `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `USAGE_DIGEST_KEY`를 비밀 관리 도구로 주입한다(HS256 프로젝트면 `SUPABASE_JWT_SECRET`도). `USAGE_DIGEST_KEY`를 바꾸면 그 순간 진행 중이던 requestId의 재시도가 `idempotency_content_mismatch`로 보일 수 있다.
5. (선택) `PLAN_FEATURES_JSON`. 테스트 계정 등급: 확장에서 한 번 로그인한 뒤 `supabase db query --linked "insert into entitlements (user_id, plan, starts_at, source) select id, 'essential', now(), 'manual' from auth.users where email = '<이메일>'"`. `admin_grant_plan()`은 어드민 JWT(`is_admin()`)로 부를 때만 통과하므로 CLI에서는 이 insert를 쓴다.
6. 기동 후 JWT로 `GET /v1/me`를 호출해 `plan`·`features`를 확인한다. 정적 토큰이 더 필요 없으면 `APP_TOKENS_JSON`을 비운다.

운영 프로젝트(`rppknkhbiivyurhvljoi`, 시드니)에는 2026-10-03에 2·3과 `schema-v2.sql`을 적용했다(`schema.sql`은 그 전에 적용돼 있었다).

**토큰 검증** (Node `crypto`만 사용). 서명이 맞은 뒤에만 클레임을 본다:

- `exp`는 5초 여유(`nbf`도), `aud`는 `authenticated`(문자열 또는 배열), `iss`는 `<SUPABASE_URL>/auth/v1`, `role`은 `authenticated`, `sub`는 uuid. anon·service_role 키 JWT와 익명 로그인은 여기서 걸린다.
- `alg`는 헤더가 아니라 설정이 정한다(`none`, HS/RS 혼동, JWKS만 설정한 서버에서의 HS256은 모두 거절). ES256 토큰은 EC P-256 키, RS256은 2048비트 이상 RSA 키로만 검증한다.
- JWKS(`<SUPABASE_URL>/auth/v1/.well-known/jwks.json`)는 10분 캐시한다. 모르는 `kid`는 10초에 한 번까지만 다시 받아 키 회전을 따라가므로 회전 직후 최대 10초간 새 키 토큰이 401일 수 있다. 다시 받기에 실패하면 가진 키로 계속 검증하고, 키가 하나도 없을 때만 `auth_unavailable`(503, 재시도 가능)이다. Supabase 호출은 모두 5초 제한, 리다이렉트 금지, 응답 256 KiB 제한이다(보관함 Storage 업로드·다운로드만 60초, 다운로드 응답 24 MiB).
- 로그아웃·폐기된 토큰은 `exp`까지 유효하다(서버가 세션을 조회하지 않는다).
- 만료된 토큰은 `401 token_expired`(서명이 맞는 토큰에만), 나머지 실패는 `401 unauthorized`다. 클라이언트는 `token_expired`면 갱신 토큰으로 새 토큰을 받아 한 번 다시 보내고 `unauthorized`면 다시 로그인한다.

**장부**: JWT 계정은 `reserve_usage`/`settle_usage` RPC(`${SUPABASE_URL}/rest/v1/rpc/...`)를 쓴다. 의미는 파일 장부와 같다(사전 예약 → 제공자 호출 → 정산, 보고되지 않은 비용은 예약 유지).

- 예약 결과 매핑: `duplicate` → 409 `request_already_reserved_or_processed`, `digest_mismatch` → 400 `idempotency_content_mismatch`, `quota_exceeded` → 429 `quota_exceeded`. 예약이 성공하기 전에는 제공자를 부르지 않는다. 예약이 안 되면(Supabase 중단·시간 초과·예상 밖 응답) 503 `usage_store_failed`(재시도 가능, **새 requestId**로 — 응답을 잃은 예약은 DB에 남았을 수 있고 예약은 자동 재시도하지 않는다)이다.
- 정산: 보고된 비용은 마이크로달러(`ceil(USD x 1e6)`), 미보고는 `null`(DB가 예약액을 청구), 제공자에 아무것도 안 보낸 환불 경로는 `refunded`, 그 밖의 실패는 `error`다. 출력 잘림(`llm_output_truncated`)은 `error`에 보고된 비용을 싣는다. 정산은 한 번 더 시도한다(DB가 `already_settled`로 멱등 처리). 정산이 끝내 실패하면 이미 만든 결과는 그대로 돌려주고 예약은 `reserved`로 남아 비용이 보수적으로 잡힌다(`usage_reservations_open_idx`로 찾아 대조). 환불 정산이 실패하면 같은 requestId 재시도를 약속할 수 없어 `usage_store_failed`로 답한다.
- 원장 메타데이터: `stage`(`summary.chunk`, `vision.full`, `stt`, `judge.<task>`, `plan`, `write.<stage>`), `provider`(`openrouter`/`groq`), `model`, 토큰 수, `audio_seconds`, `images`, 프롬프트·스키마 버전, `error_code`, `latency_ms`, `client_version`(`x-client-version`). `host`와 `job_id`는 신뢰할 출처가 없어 보내지 않는다. `usage_events` CHECK와 모양이 다른 값은 정산 전체가 거절되지 않도록 `null`로 바꾼다. 강의 텍스트·이미지·음성은 어떤 RPC 본문에도 없다.
- digest: 파일 장부는 기존 SHA-256, JWT 계정은 `HMAC-SHA256(USAGE_DIGEST_KEY, 요청 본문 정규형)`이라 DB에 사전 공격이 가능한 해시가 남지 않는다.
- 인식 분량: `/v1/stt`는 선언 길이를 올림한 분(`ceil(durationSec/60)`)을 `p_minutes`로 예약한다(`plans.monthly_minutes_cap`). 비용은 제공자가 잰 길이로 따로 정산한다.
- 동시 처리 수(`ACCOUNT_CONCURRENCY`), 분당 요청 수(`ACCOUNT_RATE_PER_MIN`), 모델별 제공자 슬롯은 모든 계정에 메모리에서 센다. 월 한도·전역 상한(`global_caps`)은 DB가 판정하므로 `MAX_REQUESTS`/`MAX_COST_CENTS`/`GLOBAL_COST_CENTS`와 `ACCOUNT_LIMITS_JSON`은 JWT 계정에 적용되지 않는다.

**등급·기능**: JWT 계정은 `effective_plan(user)`가 돌려준 등급 이름을 `PLAN_FEATURES_JSON`(기본값 포함)으로 옮겨 모델·기능을 정한다. 모르는 등급과 `null`은 `free`로 닫힌다. 장부를 쓰는 POST 라우트는 사용자별로 30초 캐시한 등급을 쓰고 `GET /v1/me`는 항상 새로 읽는다. 한도 자체는 매 예약마다 DB가 판정하므로 캐시가 한도를 늦추지 않는다. `FEATURE_FLAGS_JSON`은 등급과 무관하게 계속 우선한다.

**`GET /v1/me`**: 모든 계정이 `{accountId, models, features, config, quota, noteSpecVersion, promptVersion}`을 받는다. `noteSpecVersion`·`promptVersion`은 `/v1/plan`·`/v1/write` 응답과 같은 값(`lib/note-contract.js`의 `NOTE_SPEC_VERSION`, `server/prompts.js`의 `PROMPT_VERSION`)이라 클라이언트가 호출 전에 맞는지 본다(`config.promptVersion`은 비전·판정용 원격 설정으로 별개다). JWT 계정은 `accountId`가 `sub`이고 `plan`이 더해지며 `quota`는 DB 값이다: `{month, requests, maxRequests, minutes, maxMinutes, spentCents, maxCents}`(상한이 `null`이면 무제한, 등급 줄이 없으면 `maxCents` 0). 정적 계정의 `quota`는 기존 모양이다. 첫 `/v1/me`에서 `profiles` 줄을 `on_conflict=user_id` + `resolution=ignore-duplicates`로 한 번 만든다(이미 있는 등급은 건드리지 않고, 실패해도 `/v1/me`는 막지 않으며 다음 호출이 다시 시도한다).

**보관함(`/v1/vault`)**: 요청·응답 모양, 검증(`lib/vault.js`), 상태 코드, 오류 코드, 한도(항목 100개, 200 MiB)는 계정 종류와 무관하게 같고 저장소만 다르다.

- 정적 토큰 계정: `VAULT_DIR`의 파일(아래 "데이터와 운영 경계").
- JWT 계정: 서버 디스크에는 아무것도 쓰지 않는다. envelope JSON은 비공개 Storage 버킷(`VAULT_BUCKET`)의 `<user_id>/<object_id>`에, 목록·용량은 `vault_objects` 행에 둔다. `user_id`는 검증된 토큰의 `sub`뿐이라 다른 사용자의 객체에는 닿을 수 없다. 객체 이름에 `.json`을 붙이지 않는다 — `storage_path`의 CHECK가 `.`을 막고 계정 삭제가 이 칸을 그대로 Storage 경로로 읽는다. 서비스 롤 키로 업로드는 `POST /storage/v1/object/<bucket>/<path>` + `x-upsert: true`, 읽기는 `GET`(행이 있을 때만), 삭제는 `DELETE /storage/v1/object/<bucket>` `{prefixes}`(없는 객체에도 200이라 멱등)이고 행은 PostgREST로 upsert/삭제한다. PUT은 올리기 전에 이 사용자의 행으로 개수·용량(덮어쓸 때는 자기 크기 제외)을 따져 넘으면 `413 archive_quota_exceeded`다. 읽고-쓰기라 같은 사용자의 동시 PUT 몇 개는 한도를 약간 넘길 수 있다.
- **쓰기 순서는 Storage 먼저, 행은 그다음이다**(PUT도 DELETE도). Storage가 실패하면 표는 그대로라 행이 있으면 객체가 있다. 실패는 `503 vault_store_failed`이고 같은 요청을 그대로 다시 보내도 안전하다. 행 쓰기만 실패하면 객체만 남는데 목록·용량·읽기에 안 잡히고, 같은 id의 PUT 재시도가 덮어쓰고 DELETE가 지운다(표와 버킷을 대조해 치우는 청소는 아직 없다). DELETE에서 Storage 삭제 뒤 행 삭제가 실패하면 행이 남아 읽기가 503이고 DELETE 재시도가 정리한다.
- 계정 삭제(RPC `delete_account_data` → Storage 객체 → auth 사용자)는 아래 `DELETE /v1/account`가 부른다. 랜딩의 회원 탈퇴는 같은 세 단계를 Edge Function `supabase/functions/delete-account`로 한다(Postgres는 `protect_objects_delete` 트리거 때문에 Storage 객체를 지울 수 없다). 행 없는 고아 객체도 그때 `<user_id>/` 접두사 목록으로 치운다.

**계정 삭제(`DELETE /v1/account`)**: Supabase 로그인(JWT) 계정 전용이다. 본문 없이 호출하고 대상은 토큰의 `sub` 하나뿐이다. 정적 토큰 계정은 `403 account_not_deletable`(재시도 불가)이고 Supabase를 부르지 않는다. 순서는 `schema-v2.sql`의 `delete_account_data` 주석과 같다(`docs/architecture-v2.md` §9, D8).

1. **RPC `delete_account_data(p_user)`**: 해지 예약 없는 결제 구독(`entitlements`의 `source='payment'`)이 남아 있으면 아무것도 지우지 않고 `active_subscription`으로 거절한다 → `409 account_has_active_subscription`(재시도 불가). 아니면 프로필·권리·잔액·예약·보관함 행·피드백을 지우고 `usage_events`는 `user_id`를 null로 만들어 집계만 남긴다. 이 검사 때문에 맨 앞이다.
2. **Storage 객체**: (남아 있으면) `vault_objects.storage_path`가 가리키는 객체와, `POST /storage/v1/object/list/<버킷>` `{prefix:"<user_id>/",limit:100,offset,sortBy}`로 읽은 `<user_id>/` 아래 객체 전부(행 없는 고아 포함)를 `DELETE /storage/v1/object/<버킷>` `{prefixes}`로 100개씩 일괄 삭제한다. 접두사 목록으로 찾으므로 1단계가 행을 지운 뒤에도 빠짐없다. 지울 것이 없으면 삭제를 부르지 않는다(빈 `prefixes`는 Storage가 거절한다).
3. **auth 사용자**: `DELETE ${SUPABASE_URL}/auth/v1/admin/users/<id>`(서비스 롤 키). 이미 없으면(404) 성공으로 센다.

단계마다 멱등이라 어디서 끊겨도 같은 요청을 다시 보내면 남은 일을 마친다. 한 단계가 실패하면 뒤 단계는 부르지 않고 `503 account_delete_failed`(재시도 가능, 같은 요청 그대로)로 답한다. 성공하면 `{deleted:true}`이고, 그 사용자의 등급 캐시·프로필 upsert 기억·분당 요청 버킷을 서버 메모리에서 지운다. 한계:

- 토큰은 `exp`까지 유효해서(서버가 세션을 조회하지 않는다) 삭제 뒤에도 서명 검사는 통과한다. DB 표는 모두 `auth.users` FK라 행은 다시 만들어지지 않지만 Storage 업로드에는 FK가 없어, 삭제와 겹친 PUT이 객체를 남길 수 있다. 같은 DELETE를 한 번 더 보내면 접두사 목록이 치운다.
- 접두사 아래 하위 폴더는 따라가지 않고(서버는 `<user_id>/<object_id>`만 만든다) 1만 개를 넘으면 지우지 않고 `503`이다.
- Storage 목록 응답 모양과 admin 삭제 응답은 가짜 Supabase 테스트로만 확인했다. 배포 전에 테스트 계정으로 한 번 실행해 `<user_id>/` 아래 객체가 모두 사라지는지 본다.

## 데이터와 운영 경계

- 요청/응답 본문을 로깅하지 않는다. 역방향 프록시·APM·오류 수집 도구에도 본문/Authorization 로깅을 끈다.
- 추론 텍스트는 서비스·OpenRouter 제공자 메모리에서 일시 평문 처리된다. 요청은 HTTPS로 전송하고 ZDR/학습 거부/공급자 고정/fallback 금지를 요청한다. 실제 계약과 처리 국가를 따로 검증한다.
- 보관함은 확장에서 암호화한 AES-GCM envelope만 허용한다. 계정/문서/종류 AAD, 엄격한 필드 검증, 최대 평문 16 MiB에 해당하는 envelope, 계정당 100개/200 MiB를 제한한다. Storage에는 envelope JSON만 올라가고 `vault_objects`에는 크기·시각·경로(제목 없음)만 남는다.
- 서버는 암호·복호화 키를 받지 않는다. 암호 분실 복구는 없다. `DELETE /v1/vault/:id`는 현재 보관 파일을 삭제한다. 백업이 있다면 백업 파기 기간과 처리 방법은 운영자가 별도로 정해야 한다.
- 파일 경로는 서비스만 쓰는 전용 디렉터리로 지정한다. 일반 사용자나 다른 프로세스가 파일/심볼릭 링크를 교체할 수 있는 경로를 쓰지 않는다.
- 실제 서비스는 영속 볼륨과 HTTPS reverse proxy를 갖춘 별도 호스트에서 운영한다. 본문 버퍼의 임시 디스크 기록, 스왑/코어 덤프, 접근 기록·백업·키 관리도 점검한다. 개발용 localhost 외에 확장 서비스 URL은 HTTPS만 허용한다.

## 사용량·중복 요청

(정적 토큰 계정. JWT 계정은 위 "Supabase 계정과 장부"의 RPC가 같은 일을 한다.) 추론 호출 전에 요청 ID와 본문 해시, 예약액을 `usage.json`에 원자적으로 기록한다. 같은 ID 재요청은 409로 차단한다. 같은 ID에 다른 본문은 400이다. 결과 평문은 저장하지 않으므로 서버 재시작 후 결과를 재전송하지 않는다. 클라이언트가 응답을 받지 못했다면 새 요청은 비용이 다시 발생할 수 있다.

실제 비용이 숫자로 보고되면 0.000001 USD 단위로 올림해 원장을 보정한다. 비용 누락·취소·실패 시 예약액을 유지한다. 요청 시작과 완료 시 월이 바뀌는 경우를 포함해 이 원장은 사용 제한을 위한 보수적 장치다. 최종 정산은 공급자 자료와 대조한다.

원장 JSON이 손상되면 기동을 거부한다. 임의로 원장을 삭제하면 이력이 없어지므로 백업을 복구하고 비용을 대조해야 한다. 한 원장 파일을 여러 프로세스/서버리스 인스턴스가 함께 쓰면 안전하지 않다. 확장 전에 DB 트랜잭션으로 예약·중복 방지를 이전한다.

오류 응답은 `{error:{code,message,retryable,retryAfterMs}}` 봉투다. 인증·저장소 오류는 `unauthorized`(401), `token_expired`(401), `auth_unavailable`(503, 재시도 가능), `usage_store_failed`(503, 재시도 가능, 새 requestId), `vault_store_failed`(503, 재시도 가능, JWT 계정의 보관함 Storage·`vault_objects` 호출 실패 — 같은 요청을 그대로 다시 보낸다)다. 같은 requestId는 멱등하며 중복은 409다. 제공자 호출이 나간 뒤 실패하면 예약은 "uncertain"으로 남아 비용을 보수적으로 잡으므로 5xx 뒤 재시도는 새 requestId(예: 원본 + "-r1")를 써야 한다. `provider_busy`는 제공자에 아무것도 보내지 않은 요청이라 예약이 정확히 되돌아가며 같은 requestId로 재시도할 수 있다. `retryable`과 `retryAfterMs`는 429 재시도 대기 힌트다.

## 화면 인식(비전)

`POST /v1/vision`은 슬라이드 프레임 한 장을 구조화된 SlideDoc으로 옮긴다. 본문은 정확히 `{model, requestId, slideId, t0, t1, image, mode}`다. `image`는 `data:image/jpeg;base64,` 한 덩어리(디코드 후 최대 1.5 MiB), `mode`는 `full` 또는 `reread`(수식·표 영역을 2배로 잘라 다시 읽는 모드)다. 응답은 `{slideDoc, usage, promptVersion, schemaVersion}`이고 `slideDoc`은 `Contracts.SCHEMAS.slideDoc`을 따른다.

제공자에게는 slideDoc 스키마에서 검증 전용 키워드를 뺀 strict JSON Schema(`response_format: json_schema`, 이름 `slide_doc`)를 내리고 `id`·`status`는 서버가 채운다. 형식 실패(출력 잘림·JSON 파손·계약 불일치)는 같은 제공자로 한 번만 재시도한다. 프레임은 zero-retention 제공자(`zdr`, `data_collection:"deny"`, fallback 금지)로만 보내고 서버에는 저장하지 않는다.

## 음성 인식(STT)

`POST /v1/stt`는 OpenRouter `POST /api/v1/audio/transcriptions`에 `microsoft/mai-transcribe-2`로 오디오 청크를 넘겨 전사한다(설계 D16, 운영자 OpenRouter 키 하나로 된다). 본문은 정확히 `{model, requestId, t0, durationSec, lang, prompt, audio}`다. `audio`는 `data:audio/wav;base64,`(백그라운드 작업이 보내는 16 kHz 모노 WAV) 또는 `data:audio/mp4;base64,`(m4a) 한 덩어리(디코드 후 최대 12 MiB, 길이 최대 330초), `lang`은 `ko`/`en`, `prompt`는 1000자 이하(빈 문자열 허용), 요청 본문 상한은 17 MB다. 응답은 `{transcript, usage:{audioSec,costUsd}, promptVersion, schemaVersion}`이고 `transcript`는 `Contracts.SCHEMAS.transcript`다.

- 공급자 요청: JSON `input_audio:{data(base64), format:"wav"|"m4a"}`, `response_format:"verbose_json"`, `timestamp_granularities:["segment","word"]`. 최상위 `prompt`는 이 모델이 무시하므로 보내지 않고, `prompt`의 쉼표 구분 용어를 `provider.options.azure.phraseList.phrases`(최대 100개·각 50자)로 보낸다.
- 단어는 응답 최상위 배열로 오며 중간 시각을 품는 세그먼트에 붙인다. Whisper 품질값(`no_speech_prob` 등)은 없어 null이고, 환각 필터는 클라이언트의 VAD·문구 목록이 맡는다.
- MAI 문서는 WAV·MP3·FLAC만 적는다. m4a는 받아 주는지 확인하지 못해, 백그라운드 작업은 WAV로 보낸다. OpenRouter 업로드 상한은 25 MB, 상류 처리 제한은 60초다.

`ALLOWED_STT_MODELS`에는 `STT_RATES`에 단가가 있는 모델만 넣는다(`["microsoft/mai-transcribe-2"]`, $0.10/h). 비어 있으면(기본) `/v1/stt`는 어떤 모델에도 `invalid_model`로 답한다. 최소 청구 10초. 예약은 클라이언트 선언 `durationSec`으로 잡고, 정산은 응답의 `usage.cost`(USD)가 있으면 그 값, 없으면 `max(선언값, 제공자가 보고한 duration)` × 단가다.

오디오는 메모리에서만 다뤄져 OpenRouter로 전달되고 원장·로그·오류 본문에 남지 않는다(멱등 digest에는 base64의 sha256만 들어간다). OpenRouter의 공급자 라우팅 설정(ZDR 등)은 전사 요청에 적용되지 않으므로, 보존 조건은 OpenRouter·Azure의 정책으로 확인한다(`docs/policy-drafts-v2.md` §0). 제공자 HTTP 오류(429 `provider_busy` 포함)는 과금이 없다고 확정할 수 있어 예약을 정확히 되돌리고 같은 requestId를 재사용할 수 있다. 200인데 출력이 계약을 어기는 경우 등 그 밖의 실패는 예약을 유지한다.

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
- 노트 양식(블록 종류, 스키마, 요청/출력 계약)은 `lib/note-contract.js`에서, 프롬프트 형식 규칙·한도·생성 파라미터는 `server/prompts.js`(`PROMPT_VERSION`)에서 온다. 버전이 다른 요청은 모양 검사 전에 `409 note_spec_mismatch`다. 프롬프트·요청/출력 스키마·생성 파라미터는 `server/prompts.js`(`PROMPT_VERSION`)가 관리한다.
- 호출 방식은 요약과 같다: OpenRouter strict `json_schema`(검증 전용 키워드는 뺀 스키마), `temperature:0`, 지원 모델(Anthropic 제외)에는 `seed`, `zdr`·`data_collection:"deny"`·fallback 금지. 시스템 본문이 앞이고 입력이 뒤이며 캐시 모델에는 `cache_control`을 찍는다. 출력은 `Contracts.validate`로 검증하고 형식 실패(`repair` 개수 불일치 포함)만 같은 모델로 한 번 재시도한다.
- `finish_reason=length`는 한도를 키워 재시도하지 않고 `422 llm_output_truncated`(재시도 불가)로 답한다. 클라이언트가 섹션을 나눠 새 requestId로 다시 보낸다. 환불이 아니다: 제공자가 보고한 금액만 청구하고(미보고면 예약 유지) 같은 requestId는 다시 쓸 수 없다.
- 입력 토큰은 바이트/4로 어림해 plan 40k, write 16k·global 24k를 넘으면 `request_too_large`다. 출력 상한은 plan 8k, write 8k·global 4k 토큰(`server/prompts.js`의 `LIMITS.tokens`). 알 수 없는 필드는 `unexpected_field`, 모양 위반은 `request_rejected`다.

## 확인

```text
node --test lib/*.test.js server/*.test.js
```

HTTP 통합 테스트는 합성 자료와 모의 제공자만 사용한다. 인증, 계정별 암호문, 삭제, 변조, 요청 중복, 재시작, 공급자 정책, 비용 누락 및 계정별 모델/횟수 제한을 확인한다. 실제 강의 본문을 파일 fixture·테스트 로그·Headroom에 넣지 않는다.

브라우저 합성 검증은 설치된 Playwright 모듈 경로를 `PLAYWRIGHT_MODULE`, Chrome 실행 파일을 `CHROME_PATH`로 지정하고 `node tools/browser-smoke.cjs`를 실행한다. 설치된 MV3 확장의 tabCapture 권한 흐름과 2시간 부하 시험은 별도다.

가격과 암호화의 한계는 [가격·보안 검토](../docs/pricing-security-review.md), 구현 상태는 [PRD](../docs/architecture-prd.md)를 따른다.
