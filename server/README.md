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
VAULT_DIR=<서비스 전용 영속 볼륨의 절대 경로>
USAGE_STATE_FILE=<같은 영속 볼륨>/usage.json
MAX_REQUESTS=500
MAX_COST_CENTS=500
GLOBAL_COST_CENTS=5000
PORT=8788
```

`OPENROUTER_PROVIDERS_JSON`은 필수다. 실제 모델의 제공자 식별자와 ZDR/구조화 출력 지원을 확인하고 넣는다. 임의 공급자 fallback을 허용하지 않는다. 공급자가 없거나 필수 파라미터를 지원하지 않으면 요청이 실패하는 것이 정상이다.

`MAX_REQUESTS`는 기본 계정의 UTC 달력 월 요청 수이고 강의 편수가 아니다. `MAX_COST_CENTS`는 계정당 월 USD 센트, `GLOBAL_COST_CENTS`는 전체 계정 월 USD 센트다. 500센트는 $5다. 각 계정별 모델과 상한을 좁히려면 다음을 추가한다.

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

## 확인

```text
node --test lib/*.test.js server/*.test.js
```

HTTP 통합 테스트는 합성 자료와 모의 제공자만 사용한다. 인증, 계정별 암호문, 삭제, 변조, 요청 중복, 재시작, 공급자 정책, 비용 누락 및 계정별 모델/횟수 제한을 확인한다. 실제 강의 본문을 파일 fixture·테스트 로그·Headroom에 넣지 않는다.

브라우저 합성 검증은 설치된 Playwright 모듈 경로를 `PLAYWRIGHT_MODULE`, Chrome 실행 파일을 `CHROME_PATH`로 지정하고 `node tools/browser-smoke.cjs`를 실행한다. 설치된 MV3 확장의 tabCapture 권한 흐름과 2시간 부하 시험은 별도다.

가격과 암호화의 한계는 [가격·보안 검토](../docs/pricing-security-review.md), 구현 상태는 [PRD](../docs/architecture-prd.md)를 따른다.
