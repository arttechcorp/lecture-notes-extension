# Phase 0 벤치 런북 (v2)

모델·임계값을 정하는 측정 절차다. 숫자는 이 문서의 4장 표에만 커밋하고, **골든셋(강의 음성·전사·슬라이드)은 저장소 밖**에 둔다. stt-bench·judge-bench 는 저장소 안의 경로를 거절한다(vision-bench 에는 이 검사가 없으므로 슬라이드 폴더와 `BENCH_OUT` 위치를 직접 확인한다). 예상 비용은 합계 $2 안팎(추정, `server/index.js` 단가표 기준)이다. 벤치 요청은 실제 강의를 제공자(OpenRouter, Groq)로 보내므로 **본인이 접근 권한을 가진 강의만** 쓰고 ZDR 설정(2장)을 먼저 확인한다.

| 순서 | 할 일 | 절 |
|---|---|---|
| 1 | 골든셋 3강의 준비 | 1 |
| 2 | 키·ZDR·서버 기동·스모크 | 2 |
| 3 | A1 STT → A2 비전 → A3 판정 (A5는 보류) | 3 |
| 4 | B1/B2 사이트 진단 (어드민 "소스 진단" 탭) | 3 |
| 5 | 표 채우기 → 결정 규칙 적용 → 기록 | 4, 5 |

## 1. 골든셋 (저장소 밖)

```
~/summrizei-golden/
  bench.env.local            # 서버 환경 변수 (2장). *.env.local 은 gitignore 패턴과도 맞다
  finance-4522310/           # 강의 1 재무 (수식 슬라이드 slide-006~017) — 튜닝용
  circuits/                  # 강의 2 회로 (도식·표·수식) — 검증용
  talk-heavy/                # 강의 3 말 위주 (잡담·공지 많음) — 튜닝용
```

강의 폴더 하나의 구성:

```
<강의>/
  audio/                     # stt-bench 의 골든 폴더
    chunk-001.m4a            # 오디오 청크 (audio/mp4, 5분 이하, 8MB 이하)
    chunk-001.txt            # 사람이 교정한 참조 전사 (필수)
    chunk-001.terms.txt      # (선택) 이 청크의 슬라이드 용어, 한 줄에 하나. 없으면 terms.txt
    chunk-001.json           # (선택) {"t0":0,"durationSec":298.4,"lang":"ko"}
    terms.txt                # 강의 용어 목록 (슬라이드·과목 용어집)
    silence-001.m4a + silence-001.txt(빈 파일)   # 환각률 측정용 무음 청크 (3.A1)
  slides/                    # vision-bench 의 슬라이드 폴더: slide-001.jpg ... (가림 처리 전 원본 프레임, 긴 변 1280~1600px, 1.5MB 이하)
  slides-ref/                # 비전 정답 (아래 형식), 수식·표·워터마크가 있는 장만 작성
    slide-006.json
  judge/items.jsonl          # judge-bench 의 라벨 파일 (아래 형식)
```

**만드는 법** (ffmpeg, `brew install ffmpeg`):

```bash
cd ~/summrizei-golden/finance-4522310 && mkdir -p audio slides slides-ref judge
# 5분 청크 (한 줄에 한 청크, 시작 초를 바꿔 반복). 강의당 최소 3청크(15분), 권장 4~6청크
for i in 0 1 2 3; do n=$(printf "%03d" $((i+1))); ffmpeg -y -ss $((i*300)) -t 300 -i lecture.mp4 -vn -ac 1 -ar 16000 -c:a aac -b:a 64k audio/chunk-$n.m4a; done
# 무음 청크 (환각률용) 3개
for i in 1 2 3; do ffmpeg -y -f lavfi -i anullsrc=r=16000:cl=mono -t 60 -c:a aac -b:a 64k audio/silence-00$i.m4a; : > audio/silence-00$i.txt; done
# 슬라이드 프레임: 30초마다 한 장 (슬라이드 파일이 따로 있으면 그것을 JPEG 로 내보낸다)
ffmpeg -i lecture.mp4 -vf "fps=1/30,scale=1280:-2" -q:v 3 slides/slide-%03d.jpg
```

참조 전사는 가장 강한 모델 초안을 사람이 **전부 듣고 고친다**(초안 모델에 유리하게 편향되기 쉬우므로 후보와 다른 엔진 초안을 권장). 강의당 권장 분량: 슬라이드 30장(정답 JSON은 10~15장), 판정 항목은 아래 표.

**비전 정답** `slides-ref/<슬라이드파일명>.json` (필드는 모두 선택):

```json
{
  "formulas": ["PV=\\frac{C}{1+r}"],
  "figures": [{"kind": "table", "bbox": {"x": 0.1, "y": 0.5, "w": 0.6, "h": 0.3}, "cells": [["연도", "현금흐름"], ["1", "100"]]}],
  "roles": [{"text": "4522310", "role": "watermark"}, {"text": "12", "role": "page_number"}],
  "text": "제목과 본문 글자 전체 (CER 용)"
}
```

bbox 는 이미지 왼쪽 위가 (0,0), x·y·w·h 는 0~1 비율이다. role 은 `title body header footer watermark page_number figure_label` 중 하나다.

**판정 라벨** `judge/items.jsonl` (한 줄에 한 항목, `context` 는 선택):

```json
{"task":"utterance","itemId":"u-001","text":"도함수는 순간 변화율입니다","label":"lecture"}
{"task":"importance","itemId":"i-001","text":"[슬라이드] 현재가치 공식 [발화] 이게 시험에 나옵니다","label":5}
{"task":"boilerplate","itemId":"b-001","text":"컴퓨터공학과 2024","context":"12개 슬라이드에 반복","label":"yes"}
{"task":"figure","itemId":"f-001","text":"표: 연도별 현금흐름","context":"이 표를 보시면 ...","label":"core"}
{"task":"support","itemId":"s-001","text":"할인율이 오르면 현재가치는 내려간다","context":"(인용한 근거 발화)","label":"supported"}
```

최소 분량(3강의 합계): importance 200, utterance 150, boilerplate 50, figure 30, support 60 (supported/unsupported 절반씩; unsupported 는 근거와 숫자·부정을 바꿔 만든다).

**라벨링 가이드** (서버 프롬프트와 같은 정의를 쓴다):

| 과제 | 라벨 | 정의 |
|---|---|---|
| T1 utterance | lecture / example / admin / chatter | 수업 주제를 직접 설명 / 이해를 돕는 사례·비유 / 출석·과제·시험 일정·화면 안내 / 주제와 무관한 말·추임새·농담 |
| T2 importance (3단계) | **1** 낮음 | 시험·복습에 필요 없음: 잡담, 공지, 이미 끝난 내용의 되풀이 |
| | **3** 보통 | 이해를 돕는 보조: 예시, 배경, 도입·연결, 부연 |
| | **5** 높음 | 시험에 나올 만한 핵심: 정의, 공식·정리, 절차의 핵심 단계, 결론, 교수가 강조한 내용 |
| T3 boilerplate | yes / no | 여러 슬라이드에 반복되는 머리글·바닥글·워터마크·학번·이름·강의명·쪽번호 / 강의 내용 |
| T4 figure | core / supporting / decorative | 주제 설명에 필요 / 도움이 되지만 없어도 이해 / 로고·배경·장식 |
| T5 support | supported / unsupported | 근거가 노트 문장의 내용을 담고 있음 / 근거에 없거나 어긋남 |

T2 규칙: 슬라이드 글과 발화를 합쳐 판단하고, 애매하면 3, 한 유닛에 5와 1이 섞이면 5로 한다. 서버는 1~5를 내므로 사람 라벨(1/3/5)과의 **정확히 일치율은 낮게 나온다. T2 의 판단 지표는 "±1 이내 비율"** 이다. 두 사람이 같은 50개를 독립 라벨링해 일치율이 80% 미만이면 가이드를 고친 뒤 시작한다.

## 2. 키·서버

1. **OpenRouter**: 키 발급. 설정에서 ZDR 을 켠다. 요청마다 `zdr:true` 로 보내므로 **퍼스트파티 태그(openai, anthropic, google-ai-studio)를 고정하면 404** 가 난다. 모델별 엔드포인트 태그 확인: `curl -s https://openrouter.ai/api/v1/models/openai/gpt-4.1-nano/endpoints | python3 -m json.tool | grep -E '"tag"|logprobs'` (`logprobs`, `top_logprobs` 지원 태그여야 한다). 비전 모델도 같은 방식으로 `response_format`/`structured_outputs` 지원을 확인한다(저장소의 `tools/openrouter-endpoint-probe.mjs` 가 `lib/openrouter-client.js` 에 핀된 모델의 태그·지원 파라미터를 같은 API로 점검한다 — 벤치 후보처럼 핀이 없는 모델은 curl 로 직접 본다).
2. **Groq**(A1 기준선을 잴 때만. 설계 D16으로 운영 STT는 OpenRouter다): 키 발급 후 **조직(Organization) 설정에서 ZDR 을 켠다**(요청 단위로 못 켠다; 메뉴 이름은 콘솔 버전에 따라 다를 수 있다). 키 확인: `curl -s https://api.groq.com/openai/v1/models -H "authorization: Bearer $GROQ_API_KEY" | head -c 200`.
3. **환경 파일** `~/summrizei-golden/bench.env.local` (값은 자리표시자):

```bash
export OPENROUTER_API_KEY='sk-or-v1-...'
export GROQ_API_KEY='gsk_...'
export EXTENSION_ORIGIN='chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'   # 벤치에서는 형식만 맞으면 된다
export APP_TOKENS_JSON='{"bench":"<openssl rand -hex 24 로 만든 48자>"}'
export ALLOWED_MODELS='["google/gemini-2.5-flash-lite"]'
export ALLOWED_VISION_MODELS='["google/gemini-2.5-flash-lite","google/gemini-3.8-flash"]'
export ALLOWED_STT_MODELS='["whisper-large-v3-turbo","whisper-large-v3"]'
export ALLOWED_JUDGE_MODELS='["openai/gpt-4.1-nano"]'
export OPENROUTER_PROVIDERS_JSON='{"google/gemini-2.5-flash-lite":["google-vertex"],"google/gemini-3.8-flash":["google-vertex/global"],"openai/gpt-4.1-nano":["<1번에서 확인한 ZDR 가능 태그>"]}'
export ACCOUNT_LIMITS_JSON='{"bench":{"models":["google/gemini-2.5-flash-lite"],"maxRequests":5000,"maxCostCents":2000,"features":["vision","stt","judge"]}}'
export VAULT_DIR="$HOME/summrizei-golden/server-data"
export USAGE_STATE_FILE="$HOME/summrizei-golden/server-data/usage.json"
# 기능 스위치(기본 모두 켬): export FEATURE_FLAGS_JSON='{"stt":false}' 처럼 끈다
```

   비전 후보를 더 늘리려면 모델을 `ALLOWED_VISION_MODELS`, `OPENROUTER_PROVIDERS_JSON` 에 넣는다. `mistralai/ministral-8b-2512`와 `qwen/qwen3-vl-8b-instruct`는 이미 단가표에 있다. 그 외 `VISION_RATES`에 없는 모델(gpt-5.4-nano, qwen3-vl-32b, gemini-3.5-flash-lite)은 단가 한 줄을 `server/index.js` 에 추가해야 호출된다. Mistral OCR 과 Mathpix 는 OpenRouter 밖이라 이 서버로 돌릴 수 없다(수식 크롭 수동 비교만).
   벤치는 정적 토큰 계정만으로 돌아간다 — `SUPABASE_URL` 계열은 넣지 않는다(설정하면 JWT 계정이 생기고 `SUPABASE_SERVICE_ROLE_KEY`·`USAGE_DIGEST_KEY`가 필수가 된다). `REMOTE_CONFIG_JSON`의 `minClientVersion`을 올리면 `x-client-version` 헤더를 보내지 않는 벤치 도구가 `426 client_upgrade_required`를 받으니 벤치에서는 기본값으로 둔다. 새 라우트 `/v1/plan`·`/v1/write`도 같은 토큰 인증과 `ALLOWED_MODELS`·계정 한도를 쓴다(A5 측정에 사용).
4. **기동** (저장소 루트, Node 22 이상, 127.0.0.1:8788 에만 열린다):

```bash
set -a; source ~/summrizei-golden/bench.env.local; set +a
node server/index.js
# 다른 터미널
export TOKEN='<APP_TOKENS_JSON 의 bench 토큰>'
curl -s -H "authorization: Bearer $TOKEN" http://127.0.0.1:8788/v1/me | python3 -m json.tool   # features 에 vision, stt, judge 가 보여야 한다
```

5. **스모크 (돈을 쓰기 전 확인)**: 슬라이드 1장 폴더로 `node tools/vision-bench.mjs`, 청크 1개 폴더로 `node tools/stt-bench.mjs`, 판정 3줄짜리 jsonl 로 `node tools/judge-bench.mjs` 를 먼저 돌린다. 실패하면 서버는 제공자 오류 본문을 숨기므로(`provider_failed_or_invalid_output`), 1번의 `curl` 로 제공자를 직접 호출해 태그·키를 확인한다.

## 3. 테스트별 절차

공통: 결과 파일은 골든 폴더 쪽에만 쓴다(기본은 입력 폴더의 `results/`). stt-bench·judge-bench 는 `--out=<dir>` 로 바꿀 수 있지만 저장소 밖 경로만 받는다. 지연은 클라이언트에서 잰 요청 시간이고, 원가는 서버가 돌려준 `usage.costUsd` 다.

### A1 STT (Groq turbo / large-v3, 용어 프롬프트 켬·끔)

> **2026-10-03 변경(설계 D16)**: STT는 OpenRouter의 `microsoft/mai-transcribe-2`로 정했다. 서버 `/v1/stt`가 아직 Groq 구현이라, 아래 명령은 전환 전까지 Groq 기준선 측정에만 쓴다. 전환 뒤에는 같은 도구에 모델 `microsoft/mai-transcribe-2`를 넘겨 재고, 먼저 m4a 청크가 그대로 받아지는지 확인한다. MAI-Transcribe 2는 `prompt`를 무시하므로 용어 켬·끔은 `phraseList`로 비교한다.

- **입력**: `<강의>/audio` (청크, 참조 전사, 용어 목록).
- **명령** (모델·강의마다 한 번씩):

```bash
for m in whisper-large-v3-turbo whisper-large-v3; do
  for d in finance-4522310 circuits talk-heavy; do
    node tools/stt-bench.mjs ~/summrizei-golden/$d/audio http://127.0.0.1:8788 "$TOKEN" $m --prompt=both
  done
done
```

- **출력**: `<audio>/results/stt-bench-<시각>.json` (청크별 행과 가설 전문) 과 `.md` (청크별 표 + 켬/끔 요약 + 차이). 터미널 마지막 줄에 `.md` 경로가 나온다.
- **지표** (`tools/bench-metrics.mjs`): 한국어 CER = 공백·문장부호 제거(NFC) 후 코드포인트 Levenshtein / 참조 길이(참조가 비면 가설도 비면 0, 아니면 1). micro CER = 편집거리 합 / 참조 길이 합. 용어 재현율 = 용어(같은 정규화)가 가설에 부분 문자열로 있는 비율. 지연 p50/p90 = 선형 보간 백분위수. 원가/시간 = 총 원가 / (총 오디오 초 / 3600). "켬" 프롬프트는 용어를 `, `로 이어 마지막 400자만 쓴다(Whisper 는 끝 224토큰만 본다).
- **무음 환각률**: `silence-*.m4a` 와 빈 참조를 청크로 함께 돌리면 그 청크의 CER 이 0% 면 정상, 100% 면 환각(무음에 글자를 낸 것)이다. 환각률 = CER 100% 인 무음 청크 / 전체 무음 청크. 서버는 필터 없이 원문을 돌려주므로 이 값은 VAD 게이트·환각 필터를 거치기 **전** 수치다.
- **이 도구로 측정하지 않는 것**: 단어 정렬 오차, 청크 경계 중복·누락(후속 `pipeline-bench`), RTZR·Scribe v2(서버 어댑터 없음; 도입 시 레지스트리에 추가한 뒤 같은 도구로 측정).

### A2 비전 (슬라이드 → SlideDoc)

- **입력**: `<강의>/slides` (JPEG), `<강의>/slides-ref` (정답).
- **명령** (모델·강의마다):

```bash
for m in google/gemini-2.5-flash-lite google/gemini-3.8-flash; do
  BENCH_OUT=~/summrizei-golden/finance-4522310/vision-$(echo $m | tr '/' '_').json \
    node tools/vision-bench.mjs ~/summrizei-golden/finance-4522310/slides http://127.0.0.1:8788 "$TOKEN" $m
done
# 채점 (부록의 score-vision.mjs 를 ~/summrizei-golden/ 에 저장해 둔다)
node ~/summrizei-golden/score-vision.mjs "$PWD" ~/summrizei-golden/finance-4522310/vision-google_gemini-2.5-flash-lite.json ~/summrizei-golden/finance-4522310/slides-ref
```

- **출력**: 터미널에 슬라이드별 시간·블록/수식/도표 수·LaTeX, 합계 시간·원가, 실패 수. `BENCH_OUT` JSON 에 슬라이드별 `slideDoc` 전체(강의 내용 포함, 저장소 밖에 둘 것). 채점 스크립트가 아래 지표를 출력한다.
- **지표**: KaTeX 파싱률 = 모델 `latex` 중 `Formulas.parseOk`(번들된 KaTeX)가 통과한 비율. 수식 일치율 = 참조 수식 중 `formulaMatch`(정규화 LaTeX 동일: `\dfrac`/`\frac`, `\left\right`, 바깥 `$`, 공백 무시)로 모델 수식 하나와 짝지어진 비율(수식당 한 번). 표 셀 F1 = (행,열) 위치와 정규화 텍스트가 같은 셀 기준 2·일치 / (정답 셀 + 모델 셀), 참조 표마다 가장 많이 맞는 모델 표와 짝짓는다. bbox = 참조 도표마다 `bboxIoU` 가 가장 큰 모델 도표의 IoU, 0.5 이상이면 적중. 역할 정확도 = 참조 (텍스트, 역할)마다 그 텍스트를 담은 모델 블록 중 역할이 같은 것이 있는 비율(블록을 못 찾으면 오답, "찾은 비율"을 같이 본다). 한국어 CER = 제목·본문·머리글·도표 라벨만 이은 글자와 참조 `text` 의 CER 평균. 오류율 = vision-bench 의 실패 장 / 전체.
- **`reread`**: vision-bench 는 `full` 모드만 보낸다. 재판독 후보는 수식 슬라이드에서 상위 모델의 수식 일치율로 고른다.

### A3 판정 (gpt-4.1-nano 로그확률)

- **입력**: `<강의>/judge/items.jsonl` (1장의 라벨).
- **명령** (강의마다; 튜닝용 2강의 + 검증용 1강의를 따로 돌려 결과를 구분해 둔다):

```bash
for d in finance-4522310 talk-heavy circuits; do
  node tools/judge-bench.mjs ~/summrizei-golden/$d/judge/items.jsonl http://127.0.0.1:8788 "$TOKEN" openai/gpt-4.1-nano --batch=50
done
```

- **출력**: `<jsonl 폴더>/results/judge-bench-<시각>.json` (항목별 확률·정답 여부) 과 `.md` (과제별 표 + 신뢰도 구간 표).
- **지표**: 정확도 = 확률 argmax 가 정답 라벨(보류=빈 확률은 오답으로 센다). 응답 정확도 = 보류 제외. ECE = 확률 상위 라벨의 신뢰도를 10칸 동폭 구간으로 나눠 Σ (구간 n/전체 N)·|구간 정확도 − 구간 평균 신뢰도|. T2 는 ±1 이내 비율. 지연 p50/p90 은 요청당, 원가는 1000건당 환산.
- **비교 대상**: Jev 는 접근 권한이 생기면 서버 모델 레지스트리(`JUDGE_MODELS`)에 추가해 같은 명령으로 돌린다(지금은 미구현). Planner 단독은 Planner 가 생긴 뒤(Phase 6) 측정한다.

### A5 Planner·Writer (보류)

노트 스펙 확정(Phase 6~7) 후에 채운다. 4장 표만 자리를 잡아 둔다.

### B1/B2 백그라운드 미디어 사이트 진단

어드민에 **"소스 진단" 탭이 이미 들어와 있다**(`admin.html`의 세 번째 탭). 탭을 고르고 [진단]을 누르면 `webRequest` 권한을 요청한 뒤 10초간 그 탭의 `media`·`xmlhttprequest` 요청만 관찰한다 — 재생 중이어야 한다. 결과 카드는 메모리에만 두고(최대 10장) 저장하지 않는다.

1. 개발자 모드로 확장을 로드하고 `chrome://extensions` 에서 확장 ID 를 확인해 `chrome-extension://<ID>/admin.html` 을 연다(웹스토어 패키지에는 포함되지 않는다).
2. 사이트마다 본인 계정으로 강의 영상 페이지를 열고, "소스 진단" 탭에서 그 탭을 골라 [진단]을 누른 뒤 10초 안에 영상을 재생한다. 카드에 나오는 판정(verdict), 후보 종류(hls/dash/mp4), 보호조치(EXT-X-KEY·ContentProtection 감지 시 "보호된 스트림 · 중단"), 재생목록·렌디션·I-frame, Range, Referer(required/not-required/unknown — DNR 세션 규칙으로 페이지 Referer 재시도까지 자동으로 시험하고 끝나면 규칙을 해제한다)를 4장의 사이트 표에 옮겨 적는다(열 이름이 다르면 가장 가까운 열에). 단일 mp4 후보는 DRM 여부를 판별하지 않는다("판별 안 함"). 진단이 끝나면 [webRequest 권한 해제]로 권한을 되돌릴 수 있다.
3. B2 추가 확인(손으로 기록): 서드파티 쿠키 차단을 켠 상태에서 한 번 더 / 서명 URL 만료(일시정지 후 몇 분 뒤 재개 시 403 이면 "일시정지 후 탭 재요청" 동작) / Worker 의 교차 출처 fetch 허용 여부(안 되면 offscreen 이 fetch).
4. 암호화·DRM 사이트는 "백그라운드 불가, 실시간 모드 제안"으로 기록한다. 우회하지 않는다.

## 4. 결과 표 (채울 곳)

날짜·커밋·서버 단가표 버전을 표 위에 한 줄로 적는다. 단위: CER·재현율·일치율 %, 지연 초, 원가 USD.

**A1 STT** (행: 모델 × 프롬프트 × 강의)

| 모델 | 프롬프트 | 강의 | micro CER | 평균 CER | 용어 재현율 | 지연 p50 | 지연 p90 | 원가/시간 | 무음 환각률 | 비고 |
|---|---|---|---|---|---|---|---|---|---|---|
| whisper-large-v3-turbo | 끔 | 재무 | | | | | | | | |
| whisper-large-v3-turbo | 켬 | 재무 | | | | | | | | |
| whisper-large-v3 | 끔 | 재무 | | | | | | | | |
| whisper-large-v3 | 켬 | 재무 | | | | | | | | |
| (같은 4행을 회로, 말 위주에 복사) | | | | | | | | | | |
| RTZR / Scribe v2 | - | - | 어댑터 없음 | | | | | | | |

**A2 비전** (행: 모델 × 강의)

| 모델 | 강의 | KaTeX 파싱률 | 수식 일치율 | 표 셀 F1 | bbox IoU≥0.5 | 역할 정확도 | 글자 CER | 지연 평균/p90 | 원가/장 | 오류율 |
|---|---|---|---|---|---|---|---|---|---|---|
| google/gemini-2.5-flash-lite | 재무 | | | | | | | | | |
| google/gemini-3.8-flash | 재무 | | | | | | | | | |
| (모델·강의 조합마다 행 추가) | | | | | | | | | | |

**A3 판정** (행: 과제 × 모델, 튜닝 강의 / 검증 강의 구분)

| 과제 | 모델 | 구분 | n | 정확도 | 응답 정확도 | ECE | 보류 | ±1(T2) | 지연 p50/p90 | 원가/1000건 |
|---|---|---|---|---|---|---|---|---|---|---|
| T1 utterance | gpt-4.1-nano | 튜닝 | | | | | | - | | |
| T1 utterance | gpt-4.1-nano | 검증 | | | | | | - | | |
| T2 importance | gpt-4.1-nano | 튜닝 / 검증 | | | | | | | | |
| T3 boilerplate, T4 figure, T5 support | gpt-4.1-nano | 튜닝 / 검증 | | | | | | - | | |
| (모든 과제) | Jev | - | 접근 대기 | | | | | | | |
| (모든 과제) | Planner 단독 | - | Phase 6 | | | | | | | |

**임계값** (튜닝 강의에서 정하고 검증 강의로 확인)

| 항목 | 튜닝값 | 튜닝 지표 | 검증 지표 | 채택 |
|---|---|---|---|---|
| 판정 θ_low / θ_high (과제별) | | | | |
| STT 환각 필터 (`no_speech_prob`, `avg_logprob`, `compression_ratio`) | 0.6 / -1.0 / 2.4 (기본) | | | |
| 용어 프롬프트 길이 | 400자 | | | |

**A5 Planner·Writer** (보류): 후보 | 품질 루브릭 | 2회 재현성 | 원가 — 모두 비움.

**B1/B2 사이트 매트릭스**

| 사이트 | 소스 종류 | 암호화/DRM | 인증(쿠키·Referer) | 서명 URL 만료 | Worker fetch | 백그라운드 가능 | 비고 |
|---|---|---|---|---|---|---|---|
| LearnUs | | | | | | | |
| Moodle (mp4) | | | | | | | |
| Panopto | | | | | | | |
| Kaltura | | | | | | | |
| Zoom 녹화 | | | | | | | |
| Coursera | | | | | | | |
| YouTube | 실시간 모드만 | | | | | 아니오 | |

## 5. 결정 규칙

모델 선택은 3강의 합산과 강의별 **최악값**을 함께 본다. **임계값은 재무+말 위주(튜닝)로 정하고 회로(검증)로 확인한다.** 검증값이 아래 허용치를 넘게 나빠지면 그 임계값을 채택하지 않고 튜닝 자료를 늘린다. 숫자는 초기 제안이며 사용자가 조정한다.

| 영역 | 통과 조건 | 선택 | 검증 허용치 |
|---|---|---|---|
| STT 모델 | micro CER 이 최저값 + 1.0%p 이내, 용어 재현율이 최고값 - 2.0%p 이내 | 통과한 모델 중 원가/시간 최저 | 회로 CER 이 튜닝 대비 + 1.5%p 이내 |
| 용어 프롬프트 | 용어 재현율 + 2.0%p 이상, CER 악화 0.5%p 이하 | 켬 | 같은 방향 유지 |
| 비전 모델 | KaTeX 파싱률 ≥ 95%, 수식 일치율 ≥ 85%, 표 셀 F1 ≥ 0.90, bbox 적중 ≥ 80%, 역할 정확도 ≥ 95%, 오류율 ≤ 2% | 통과한 모델 중 원가/장 최저. 수식 일치율 최고 모델을 `reread` 후보로 | 강의별 최악값도 통과 |
| 판정 모델 | T1·T3·T5 정확도 ≥ 90%, T2 ±1 이내 ≥ 90%, T4 ≥ 85%, ECE ≤ 0.10, 보류 ≤ 5% | 통과한 모델 중 원가/지연 낮은 쪽 | 정확도 하락 ≤ 3%p |
| 판정 θ | θ_high = 튜닝 자료에서 상위 라벨 정밀도 ≥ 95% 를 처음 만족하는 최소 확률, θ_low = 반대 방향 정밀도 ≥ 95% 를 만족하는 최대 확률 | θ_low ~ θ_high 사이는 Planner 로 넘김(지우지 않음) | 검증 정밀도 하락 ≤ 3%p |
| 원가 | 위 선택을 합친 값이 SLO(유료 ≤ 200원/강의시간 ≈ $0.14, 1달러 = 1,400원)를 만족 | 못 맞추면 가장 비싼 항목부터 한 단계 낮은 후보로 재선택 | |

통과한 후보가 없으면 상위 모델을 기본으로 올리고 원가를 다시 계산한다.

**결과 기록 위치**
1. 숫자: 이 문서 4장 표(커밋).
2. 모델·단가 결정: `docs/architecture-v2.md` §10.1(비전), §10.2(STT), §10.3(판정) 표의 "권장"과 실측 열.
3. 서버 레지스트리: `server/index.js` 의 `VISION_RATES`, `STT_RATES`, `JUDGE_MODELS` 와 운영 환경 변수 `ALLOWED_VISION_MODELS`, `ALLOWED_STT_MODELS`, `ALLOWED_JUDGE_MODELS`, `OPENROUTER_PROVIDERS_JSON`(태그·ZDR 확인 결과 포함). `server/README.md` 의 기본값 설명도 맞춘다.
4. 임계값: STT 환각 필터와 판정 θ 는 해당 모듈 상수에 넣고 `docs/architecture-v2.md` §6.2, §6.4 에 값과 근거를 적는다. 프롬프트나 스키마를 바꿨으면 `REMOTE_CONFIG_JSON` 의 `promptVersion` 을 올린다.

## 부록. score-vision.mjs

`~/summrizei-golden/score-vision.mjs` 로 저장해 쓴다(저장소 밖). 저장소의 `tools/bench-metrics.mjs`, 번들 KaTeX, `lib/formulas.js` 를 가져다 쓰며 네트워크를 쓰지 않는다. 사용: `node ~/summrizei-golden/score-vision.mjs "$PWD" <bench-out.json> <slides-ref>` (저장소 루트에서).

```js
// score-vision.mjs — vision-bench 결과(BENCH_OUT)를 사람이 만든 참조(slides-ref)와 비교한다. 네트워크 없음.
// 사용: node score-vision.mjs <저장소 경로> <bench-out.json> <참조폴더>
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const [repo, outFile, refDir] = process.argv.slice(2);
if (!repo || !outFile || !refDir) { console.error("사용: node score-vision.mjs <저장소 경로> <bench-out.json> <참조폴더>"); process.exit(1); }
const { koreanCER, formulaMatch, bboxIoU } = await import(pathToFileURL(path.join(repo, "tools/bench-metrics.mjs")).href);
const req = createRequire(path.join(repo, "score.js"));
const katex = req("./lib/vendor/katex/katex.min.js"), { parseOk } = req("./lib/formulas.js");
const norm = s => String(s ?? "").normalize("NFC").replace(/\s+/gu, "").toLowerCase();
const cellsOf = rows => rows.flatMap((r, y) => r.map((c, x) => [y + "," + x, norm(c)])).filter(([, t]) => t);

const a = { slides: 0, hypF: 0, parsed: 0, refF: 0, matched: 0, refFig: 0, hit: 0, iou: 0, tp: 0, refCells: 0, hypCells: 0, roles: 0, found: 0, roleOk: 0, cerSum: 0, cerN: 0 };
for (const s of JSON.parse(fs.readFileSync(outFile, "utf8"))) {
  const refFile = path.join(refDir, path.parse(s.file).name + ".json");
  if (!s.slideDoc || !fs.existsSync(refFile)) continue; // 실패한 슬라이드·참조 없는 슬라이드는 건너뛴다
  const ref = JSON.parse(fs.readFileSync(refFile, "utf8")), doc = s.slideDoc;
  a.slides++;
  // KaTeX 파싱률: 모델이 latex 로 낸 수식 전체가 대상이다.
  const hyp = doc.formulas.map(f => f.latex).filter(Boolean);
  a.hypF += hyp.length; a.parsed += hyp.filter(l => parseOk(l, katex)).length;
  // 수식 일치율: 참조 수식마다 정규화 LaTeX 가 같은 모델 수식 하나와 짝짓는다(수식당 한 번).
  const pool = [...hyp];
  for (const r of ref.formulas || []) { a.refF++; const i = pool.findIndex(h => formulaMatch(r, h)); if (i >= 0) { a.matched++; pool.splice(i, 1); } }
  // bbox: 참조 도표마다 가장 많이 겹치는 모델 도표의 IoU.
  for (const g of ref.figures || []) { a.refFig++; const best = Math.max(0, ...doc.figures.map(h => bboxIoU(g.bbox, h.bbox))); a.iou += best; if (best >= 0.5) a.hit++; }
  // 표 셀 F1(위치 기준): 참조 표마다 셀이 가장 많이 맞는 모델 표를 한 번씩만 짝짓는다.
  const tables = doc.figures.filter(h => h.kind === "table" && h.cells), used = new Set();
  for (const g of (ref.figures || []).filter(x => x.kind === "table" && x.cells)) {
    const rc = cellsOf(g.cells); let bi = -1, btp = -1, bh = 0;
    tables.forEach((h, i) => { if (used.has(i)) return; const hc = new Map(cellsOf(h.cells)); const tp = rc.filter(([k, t]) => hc.get(k) === t).length; if (tp > btp) { btp = tp; bi = i; bh = hc.size; } });
    a.refCells += rc.length;
    if (bi >= 0) { used.add(bi); a.tp += btp; a.hypCells += bh; }
  }
  // 역할 정확도: 참조의 (텍스트, 역할) 쌍마다 그 텍스트를 담은 모델 블록을 찾는다.
  for (const r of ref.roles || []) {
    a.roles++;
    const hits = doc.blocks.filter(b => norm(b.text).includes(norm(r.text)));
    if (hits.length) { a.found++; if (hits.some(b => b.role === r.role)) a.roleOk++; }
  }
  // 슬라이드 글자 CER: 제목·본문·머리글·도표 라벨만 이어 붙여 참조 text 와 비교한다.
  if (typeof ref.text === "string") {
    const txt = doc.blocks.filter(b => ["title", "body", "header", "figure_label"].includes(b.role)).map(b => b.text).join(" ");
    a.cerSum += koreanCER(ref.text, txt); a.cerN++;
  }
}
const pct = (x, y) => y ? (100 * x / y).toFixed(1) + "% (" + x + "/" + y + ")" : "-";
console.log(`채점한 슬라이드 ${a.slides}장`);
console.log("KaTeX 파싱률        ", pct(a.parsed, a.hypF));
console.log("수식 일치율(재현율) ", pct(a.matched, a.refF), "· 정밀도", pct(a.matched, a.hypF));
console.log("표 셀 F1            ", a.refCells + a.hypCells ? (2 * a.tp / (a.refCells + a.hypCells)).toFixed(3) : "-", `(정답 ${a.refCells}셀 · 모델 ${a.hypCells}셀 · 일치 ${a.tp})`);
console.log("도표 bbox IoU>=0.5  ", pct(a.hit, a.refFig), "· 평균 최대 IoU", a.refFig ? (a.iou / a.refFig).toFixed(3) : "-");
console.log("역할 정확도         ", pct(a.roleOk, a.roles), "· 블록을 찾은 비율", pct(a.found, a.roles));
console.log("슬라이드 글자 CER   ", a.cerN ? (100 * a.cerSum / a.cerN).toFixed(1) + "%" : "-");
```
