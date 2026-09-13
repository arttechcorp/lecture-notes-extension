# 6개 AI 에이전트 강의 요약 비교 종합 보고서

> 분석 대상 강의: `lecture_timeline_original.md` (MOSFET 증폭기, 소신호 모델, 전압 이득 및 추가 경로 분석)
> 평가 일시: 2026-09-13

## 1. 모델별 실행 성능 요약

| 모델명 | OpenRouter 모델 ID | 응답 시간 | 생성 글자 수 | 상태 |
|---|---|:---:|:---:|:---:|
| **DeepSeek V4 Flash 0731** | `deepseek/deepseek-v4-flash-0731` | 64.4초 | 12366자 | ✅ 성공 |
| **Qwen3.5 122B-A10B** | `qwen/qwen3.5-122b-a10b` | 34.3초 | 8043자 | ✅ 성공 |
| **Qwen3.8 2.4T-A95B** | `qwen/qwen3.8-2.4t-a95b` | 124.4초 | 39553자 | ✅ 성공 |
| **Gemini 3.1 Flash-Lite** | `google/gemini-3.1-flash-lite` | 6.8초 | 3084자 | ✅ 성공 |
| **Claude Haiku 4.5** | `anthropic/claude-haiku-4.5` | 59.5초 | 12200자 | ✅ 성공 |
| **Claude Sonnet 5** | `anthropic/claude-sonnet-5` | 76.5초 | 8572자 | ✅ 성공 |

---

## 2. 모델별 요약문 전문

### [DeepSeek V4 Flash 0731] (deepseek/deepseek-v4-flash-0731)

*소요 시간: 64.4초 / 생성 분량: 12366자*

# MOSFET 증폭기 핵심 학습 요약 노트

## 1. 핵심적인 질문 던지기 (Key Conceptual Questions & Deep Dives)

### Q1. 왜 출력단에 추가 경로(Additional Path, $R_x$)가 생기면 전체 전압 이득(Gain)이 감소하는가?

**핵심 답변:**

출력 노드에서 드레인 전류 $I_D$가 일정할 때, 전압 변화량은 $\Delta V_{out} = -\Delta I_D \times R_{eq}$로 결정됩니다. 여기서 $R_{eq}$는 출력 노드에서 바라본 등가 저항입니다.

추가 경로 $R_x$가 없다면:
- 드레인 전류 변화 $\Delta I_D$가 전부 $R_D$에 흘러 $\Delta V_{out} = -\Delta I_D \cdot R_D$ 만큼의 큰 전압 변화가 발생합니다.

추가 경로 $R_x$가 생기면:
- $\Delta I_D$가 $R_D$와 $R_x$ 두 경로로 분배됩니다.
- 결과적으로 $R_D$에 흐르는 전류가 줄어들어 $\Delta V_{out} = -\Delta I_D \cdot (R_D \parallel R_x)$ 로 감소합니다.
- 즉, **같은 전류 변화량이라도 병렬 저항이 낮아져 전압 스윙(Voltage Swing)이 작아집니다.**

**직관적 비유:** 강의에서 언급한 것처럼, 50mA의 물이 혼자서 관을 통과할 때 수위 변화가 크지만, 60mA로 나뉘어 흐르면 각 관에서의 수위 변화가 작아지는 것과 같습니다. 이것이 "드라이브 패스(Drive Path)가 추가되면 전압 변화가 덜 발생하는" 이유입니다.

**수식적 요약:**
$$
A_v = \frac{v_{out}}{v_{in}} = -g_m (R_D \parallel R_x)
$$

$R_x$가 작을수록 병렬 합성이 작아지므로 이득이 더 크게 감소합니다.

---

### Q2. 소신호 모델(Small-Signal Model)에서 왜 3.3V, 5V 같은 고정 직류 전압원(DC Node)은 접지(AC Ground)로 취급되는가?

**핵심 답변:**

소신호 해석은 **동작점(Quiescent Point) 주변의 미세한 변화만**을 다룹니다. 전압원이 "고정"되어 있다는 것은 아무리 신호가 인가되어도 그 노드의 전압이 변하지 않는다는 뜻입니다.

- $V_{DD} = 3.3V$가 인가된 노드는 신호 입장에서 **항상 일정한 전압**이므로 변화량이 0입니다.
- 변화량이 0인 노드는 $\Delta V = 0$ 즉, **AC적으로 접지(Ground)** 와 동일합니다.
- DC 전원이 내부적으로 이상적인 Source라면 AC 임피던스가 0이므로 소신호 모델에서 Short로 처리됩니다.

**왜 중요한가?**

소신호 등가회로를 그릴 때 $V_{DD}$ 노드를 AC Ground로 처리하면:
- $R_D$의 한쪽 끝이 접지에 연결된 것과 동일해집니다.
- 회로가 단순한 병렬/직렬 저항 네트워크로 환원됩니다.

**실전 팁:** 소신호 등가회로를 그릴 때 다음 순서를 기억하세요:
1. DC 전압원 → AC Ground (단락)
2. DC 전류원 → Open (개방)
3. 커패시터 → Short (결합 커패시터의 경우)

---

### Q3. 대신호(Large Signal)의 실제 전압/전류 변화와 소신호 선형화 근사 사이에는 어떤 괴리가 있는가?

**핵심 답변:**

대신호 해석은 MOSFET의 비선형 전달 특성 $I_D = \frac{1}{2}\mu_n C_{ox}\frac{W}{L}(V_{GS}-V_{TH})^2$ 을 그대로 사용합니다. 반면 소신호 해석은 동작점에서의 미분값인 $g_m$을 이용해 **선형 근사(Linear Approximation)** 를 수행합니다.

**실제 예시 (강의 슬라이드에서):**

| 파라미터 | 대신호 (실제) | 소신호 (선형 근사) |
|---|---|---|
| $V_{IN}$ | 1.0V → 1.02V (+20mV) | +20mV |
| $I_D$ | 1.00mA → 1.05mA (+50µA) | +50µA (정확히 일치) |
| $V_{OUT}$ | 1.3V → 1.2V (-100mV) | -100mV |
| 이득 계산 | $A_v = \frac{1.2-1.3}{1.02-1.0} = -5$ | $A_v = -g_m R_D = -5$ |

**괴리의 핵심:**

1. **$g_m$의 변화:** 실제로 $V_{GS}$가 변하면 $g_m$도 변하지만, 소신호 해석은 동작점의 $g_m$을 고정합니다.
   $$
   g_m = \frac{\partial I_D}{\partial V_{GS}} = \mu_n C_{ox}\frac{W}{L}(V_{GS}-V_{TH})
   $$
   
2. **2차 효과 무시:** 채널 길이 변조($\lambda$), 바디 효과 등을 소신호 모델에서는 $r_o$라는 선형 소자로 흡수합니다.

3. **선형성 가정:** 입력 변화가 충분히 작을 때만 유효합니다. 변화가 커질수록 고조파가 발생하고 실제 출력과 소신호 예측 간의 오차가 커집니다.

**공학적 의미:** 소신호 해석은 "동작점 근처에서의 기울기"를 이용한 것이므로, **증폭기 설계 시 DC 바이어스가 제대로 설정되어야** 정확한 소신호 해석이 가능합니다.

---

## 2. 수식 제시 및 수학적 유도 (Mathematical Formulations & Derivations)

### 2.1 소신호 전압 이득: $A_v = \frac{v_{out}}{v_{in}} = -g_m (R_D \parallel R_x)$

**회로 상황:**
- CS (Common Source) 증폭기
- 드레인 저항 $R_D$ 연결
- 출력 노드에 추가 저항 $R_x$ 병렬 연결

**유도 과정:**

1단계: MOSFET 소신호 모델에서 드레인 전류 변화
$$
i_d = g_m \cdot v_{gs}
$$

2단계: 출력 노드에 KCL 적용
$$
i_d = i_{R_D} + i_{R_x}
$$

3단계: 두 병렬 저항에 걸리는 공통 전압이 $v_{out}$이므로
$$
v_{out} = -i_d (R_D \parallel R_x)
$$

4단계: $v_{gs} = v_{in}$ 이므로 (입력이 게이트에 직접 인가)
$$
A_v = \frac{v_{out}}{v_{in}} = \frac{-g_m v_{in} (R_D \parallel R_x)}{v_{in}} = -g_m (R_D \parallel R_x)
$$

**병렬 저항 합성:**
$$
R_D \parallel R_x = \frac{R_D \cdot R_x}{R_D + R_x}
$$

**수치 예시:**
- $R_D = 2\text{k}\Omega$, $R_x = 2\text{k}\Omega$일 때
- $R_D \parallel R_x = 1\text{k}\Omega$
- $g_m = 5\text{mS}$라면 $A_v = -5\text{mS} \times 1\text{k}\Omega = -5$

추가 경로가 없다면 $A_v = -5\text{mS} \times 2\text{k}\Omega = -10$ 가 되어 **2배의 이득 감소**가 발생합니다.

---

### 2.2 트랜스컨덕턴스 $g_m$ 및 드레인 전류 변화량 $\Delta I_D$

MOSFET 포화 영역 전류 모델:
$$
I_D = \frac{1}{2}\mu_n C_{ox}\frac{W}{L}(V_{GS} - V_{TH})^2
$$

$g_m$은 $V_{GS}$에 대한 $I_D$의 미분:
$$
g_m = \frac{\partial I_D}{\partial V_{GS}} = \mu_n C_{ox}\frac{W}{L}(V_{GS} - V_{TH}) = \frac{2I_D}{V_{GS} - V_{TH}}
$$

**대신호 변화량 vs 소신호 변화량:**

대신호 변화:
$$
\Delta I_D = \frac{1}{2}\mu_n C_{ox}\frac{W}{L}\left[(V_{GS}+\Delta V_{GS} - V_{TH})^2 - (V_{GS} - V_{TH})^2\right]
$$

전개하면:
$$
\Delta I_D = \frac{1}{2}\mu_n C_{ox}\frac{W}{L}\left[2(V_{GS}-V_{TH})\Delta V_{GS} + \Delta V_{GS}^2\right]
$$

소신호 근사 ($\Delta V_{GS}$가 작을 때 $\Delta V_{GS}^2 \approx 0$):
$$
\Delta I_D \approx \mu_n C_{ox}\frac{W}{L}(V_{GS}-V_{TH})\Delta V_{GS} = g_m \cdot \Delta V_{GS}
$$

**강의 슬라이드 수치 검증:**
- $V_{GS} = 1V$, $V_{TH} = 0.5V$, $\frac{1}{2}\mu_n C_{ox}\frac{W}{L} = 2\text{mA/V}^2$ 라면
- $I_D = 2 \times (0.5)^2 = 0.5\text{mA}$
- $g_m = 4 \times 0.5 = 2\text{mS}$
- $\Delta V_{GS} = 20\text{mV}$일 때 $\Delta I_D = 2\text{mS} \times 20\text{mV} = 40\mu\text{A}$

대신호 계산과 비교:
$$
\Delta I_D = 2[(0.52)^2 - (0.5)^2] = 2[0.2704 - 0.25] = 40.8\mu\text{A}
$$

오차는 단 $0.8\mu\text{A}$ (2%)로, 입력 변화가 작을수록 소신호 근사가 정확합니다.

---

### 2.3 병렬 임피던스 합성 및 옴의 법칙에 기반한 전류 분배 공식

**병렬 저항의 전류 분배:**

두 병렬 저항 $R_1$, $R_2$에 총 전류 $I_{total}$이 흐를 때:
$$
I_{R_1} = I_{total} \cdot \frac{R_2}{R_1 + R_2}, \quad I_{R_2} = I_{total} \cdot \frac{R_1}{R_1 + R_2}
$$

**증명:**

병렬 회로에서 두 저항의 전압은 동일하므로:
$$
V = I_{R_1} R_1 = I_{R_2} R_2 = I_{total} (R_1 \parallel R_2)
$$

따라서:
$$
I_{R_1} = \frac{V}{R_1} = I_{total} \cdot \frac{R_1 \parallel R_2}{R_1} = I_{total} \cdot \frac{\frac{R_1 R_2}{R_1+R_2}}{R_1} = I_{total} \cdot \frac{R_2}{R_1+R_2}
$$

**소신호 CS 증폭기에서의 적용:**

$R_D = 2\text{k}\Omega$, $R_x = 2\text{k}\Omega$, $\Delta I_D = 50\mu\text{A}$일 때:
$$
\Delta I_{R_D} = 50\mu\text{A} \times \frac{2\text{k}\Omega}{2\text{k}\Omega+2\text{k}\Omega} = 25\mu\text{A}
$$

$\Delta I_{R_x}$도 동일하게 $25\mu\text{A}$입니다.

출력 전압 변화:
$$
\Delta V_{out} = -\Delta I_{R_D} \times R_D = -25\mu\text{A} \times 2\text{k}\Omega = -50\text{mV}
$$

추가 경로가 없었다면:
$$
\Delta V_{out} = -50\mu\text{A} \times 2\text{k}\Omega = -100\text{mV}
$$

즉, 이득이 절반으로 줄어듭니다.

---

### 2.4 대신호 해석과 소신호 해석의 수치 대조

**회로 조건:**
- $V_{DD} = 3.3V$
- $R_D = 2\text{k}\Omega$
- $V_{IN}$: $1V \rightarrow 1.02V$ (+20mV)

**대신호 해석 (실제):**

MOSFET이 포화 영역에서 동작한다고 가정 ($V_{GS} - V_{TH} = 0.5V$, $K = \frac{1}{2}\mu_n C_{ox}\frac{W}{L} = 2\text{mA/V}^2$):

- $V_{IN} = 1.0V$일 때:
  $$
  I_D = K(V_{GS} - V_{TH})^2 = 2 \times (0.5)^2 = 0.5\text{mA}
  $$
  $$
  V_{OUT} = V_{DD} - I_D R_D = 3.3 - 0.5 \times 2 = 2.3V
  $$

- $V_{IN} = 1.02V$일 때:
  $$
  I_D = 2 \times (0.52)^2 = 0.5408\text{mA}
  $$
  $$
  V_{OUT} = 3.3 - 0.5408 \times 2 = 2.2184V
  $$

실제 이득:
$$
A_v = \frac{2.2184 - 2.3}{1.02 - 1.0} = \frac{-0.0816}{0.02} = -4.08
$$

**소신호 해석:**

동작점에서의 $g_m$:
$$
g_m = \frac{2I_D}{V_{GS}-V_{TH}} = \frac{2 \times 0.5}{0.5} = 2\text{mS}
$$

소신호 이득:
$$
A_v = -g_m R_D = -2 \times 2 = -4
$$

**결과 비교:**
| 해석 방법 | 이득 | 오차 |
|---|---|---|
| 대신호 (정확) | -4.08 | 기준 |
| 소신호 (근사) | -4.00 | 2% |

입력 변화가 2%일 때 소신호 근사의 오차도 약 2% 수준임을 확인할 수 있습니다.

---

### 2.5 채널 길이 변조(Channel Length Modulation)를 고려한 모델

포화 영역에서:
$$
I_D = \frac{1}{2}\mu_n C_{ox}\frac{W}{L}(V_{GS} - V_{TH})^2(1 + \lambda V_{DS})
$$

전개:
$$
I_D = I_{D0} + \lambda V_{DS} I_{D0} = I_{D0} + \frac{V_{DS}}{r_o}
$$

여기서:
$$
I_{D0} = \frac{1}{2}\mu_n C_{ox}\frac{W}{L}(V_{GS} - V_{TH})^2
$$
$$
r_o = \frac{1}{\lambda I_{D0}}
$$

**물리적 의미:** $\lambda \neq 0$이면 드레인 전압이 증가할수록 전류가 증가합니다. 이는 유효 채널 길이가 짧아지기 때문입니다. 소신호 모델에서는 이를 $r_o$라는 병렬 저항으로 표현합니다.

**CS 증폭기 이득 (λ 고려):**
$$
A_v = -g_m (R_D \parallel r_o)
$$

**수치 예시:**
- $\lambda = 0.05\text{V}^{-1}$, $I_{D0} = 1\text{mA}$ → $r_o = 20\text{k}\Omega$
- $R_D = 2\text{k}\Omega$ → $R_D \parallel r_o \approx 1.82\text{k}\Omega$
- $A_v = -g_m \times 1.82\text{k}\Omega$

$r_o$가 무한대($\lambda = 0$)일 때보다 이득이 $1.82/2 = 91\%$ 수준으로 감소합니다.

---

## 3. 실전 회로 설계에서의 활용법 (Practical Applications & Engineering Takeaways)

### 3.1 이득 저하를 막기 위한 버퍼링/임피던스 분리 전략

**문제 상황:**
CS 증폭기의 출력에 다음 단의 입력 저항 $R_{in}$이 연결되면:
$$
A_{v,eff} = -g_m (R_D \parallel R_{in})
$$

$R_{in}$이 작을수록 이득이 심각하게 감소합니다.

**해결 전략 1: 소스 팔로워(Source Follower) 버퍼 사용**
- CS 증폭기 다음에 공통 드레인(Common Drain) 단을 배치합니다.
- 소스 팔로워는 높은 입력 저항($\approx \infty$)과 낮은 출력 저항($\approx 1/g_m$)을 가집니다.
- 출력 저항이 낮아지면 다음 단의 입력 저항이 이득에 미치는 영향이 줄어듭니다.

**해결 전략 2: 높은 출력 임피던스 확보**
- 출력 임피던스를 높이기 위해 Cascode 구조를 사용합니다.
- Cascode는 출력 저항을 $g_m r_o^2$ 수준으로 증가시켜 부하 효과(Loading Effect)를 최소화합니다.

**설계 예시:**

$$
A_{v,effective} = A_{v,open} \times \frac{R_{in,next}}{R_{out} + R_{in,next}}
$$

$R_{out} = 2\text{k}\Omega$, $R_{in,next} = 2\text{k}\Omega$일 때 전달 효율은 $2/(2+2) = 50\%$입니다. 즉, 이득이 절반으로 줄어듭니다.

버퍼를 추가하여 $R_{out} = 100\Omega$로 만들면:
$$
\frac{R_{in}}{R_{out}+R_{in}} = \frac{2}{0.1+2} = 95.2\%
$$

이득 감소가 5% 미만으로 줄어듭니다.

**설계 원칙:**
1. **전압 증폭기(CS)** 는 높은 입력/출력 임피던스를 가져야 함
2. **전류 증폭기(CG)** 는 낮은 입력/높은 출력 임피던스가 적합
3. **버퍼(SF/CD)** 는 높은 입력/낮은 출력 임피던스로 임피던스 변환

---

### 3.2 소신호 등가회로를 빠르게 그려서 해석하는 실전 팁

**팁 1: 소신호 모델 작성 순서**
1. 모든 DC 전압원을 접지로 처리 ($V_{DD}$, $V_{SS}$, $V_B$ 등)
2. 모든 DC 전류원을 Open으로 처리 ($I_{bias}$ 등)
3. 커패시터는 주파수에 따라 Short 또는 Open 처리
4. MOSFET을 소신호 모델($g_m v_{gs}$ 전류원과 $r_o$)로 교체
5. $V_{DD}$ 노드는 Ground이므로 $R_D$의 한쪽 끝이 Ground에 연결됨

**팁 2: 출력 저항 계산법**
- 입력을 접지시킨 후 출력에 테스트 전압 $v_x$를 인가
- $R_{out} = \frac{v_x}{i_x}$

**CS 증폭기 출력 저항:**
$$
R_{out} = R_D \parallel r_o
$$

**Degeneration ($R_S$)이 있는 CS 증폭기 출력 저항:**
$$
R_{out} = R_D \parallel [r_o + (1 + g_m r_o) R_S]
$$

**팁 3: 전압 이득 계산에서의 함정**
- 게이트 입력 전압과 소스 전압의 차이가 $v_{gs}$임을 주의
- Degeneration이 있으면:
$$
A_v = \frac{-g_m R_D}{1 + g_m R_S}
$$
전개 과정:
$$
v_{in} = v_{gs} + g_m v_{gs} R_S = v_{gs}(1 + g_m R_S)
$$
$$
v_{out} = -g_m v_{gs} R_D
$$
$$
A_v = \frac{v_{out}}{v_{in}} = \frac{-g_m R_D}{1 + g_m R_S}
$$

---

### 3.3 시험 문제 풀이 접근법

**문제: CS 증폭기의 이득을 구하시오 (λ ≠ 0)**

**풀이 절차:**

1단계: 동작점 계산
$$
I_D = \frac{1}{2}\mu_n C_{ox}\frac{W}{L}(V_{GS}-V_{TH})^2(1+\lambda V_{DS})
$$

2단계: 소신호 파라미터 계산
$$
g_m = \sqrt{2\mu_n C_{ox}\frac{W}{L} I_D} = \frac{2I_D}{V_{GS}-V_{TH}}
$$
$$
r_o = \frac{1}{\lambda I_D}
$$

3단계: 소신호 등가회로 작성

4단계: 이득 계산
$$
A_v = -g_m (R_D \parallel r_o)
$$

**문제: Diode-Connected Load의 저항 계산**

게이트와 드레인이 연결된 MOSFET($M_2$)의 소스에서 바라본 저항:
$$
R_{x} = \frac{1}{g_{m2}} \parallel r_{o2}
$$

유도:
- 게이트-드레인이 단락되어 $v_{gs} = v_{ds} = -v_x$
- $i_x = g_m v_{gs} + \frac{v_{ds}}{r_o} = g_m v_x + \frac{v_x}{r_o}$
- $R_x = \frac{v_x}{i_x} = \frac{1}{g_m} \parallel r_o \approx \frac{1}{g_m}$ ($r_o \gg 1/g_m$일 때)

---

### 3.4 흔히 범하는 함정(Pitfalls)

**함정 1: $V_{DD}$를 소신호 모델에서 그대로 두는 실수**
- $V_{DD}$는 DC 전압원이므로 AC적으로 접지입니다.
- $V_{DD}$ 노드가 접지라면 $R_D$는 출력 노드와 Ground 사이에 연결된 것과 동일합니다.

**함정 2: $g_m$의 단위와 수치 오류**
- $g_m$의 단위는 S(Siemens, A/V)입니다.
- 예: $g_m = 2\text{mS} = 0.002\text{A/V}$, $R_D = 2\text{k}\Omega$
- $A_v = -2\text{mS} \times 2\text{k}\Omega = -(0.002)(2000) = -4$

**함정 3: Degeneration이 있는 회로에서 $v_{gs}$를 입력 전압과 혼동**
- $v_{gs} = v_{in} - v_s = v_{in} - g_m v_{gs} R_S$
- 즉 $v_{gs} = \frac{v_{in}}{1+g_m R_S}$
- 이득이 그대로 $g_m R_D$가 아니라 분모에 $1+g_m R_S$가 추가됩니다.

**함정 4: 출력 저항 계산 시 입력 신호원 처리**
- 출력 저항 계산 시 입력은 접지시켜야 합니다.
- 입력 신호원 $v_{in}$은 0V로 하지만, 내부 저항 $R_S$는 회로에 포함되어야 합니다.

**함정 5: 병렬 저항 합성 시 극단값 확인**
- $R_D \parallel R_x$에서 $R_x \to \infty$이면 $R_D \parallel R_x \to R_D$ (추가 경로가 없는 것과 동일)
- $R_x \to 0$이면 $R_D \parallel R_x \to 0$ (출력이 단락되어 이득이 0)

---

### 3.5 다단 증폭기(Multistage) 설계에서의 핵심

**다단 연결 시 전체 이득:**
$$
A_{v,total} = A_{v1} \times \frac{R_{in2}}{R_{out1} + R_{in2}} \times A_{v2} \times \frac{R_{in3}}{R_{out2} + R_{in3}} \times A_{v3}
$$

각 단의 무부하 이득 곱에 **로딩 효과(Loading Effect)** 를 반영한 전압 분배 비율을 곱해야 합니다.

**설계 전략:**
1. 각 단의 $R_{in}$을 최대화하고 $R_{out}$을 최소화
2. 증폭기 사이에 버퍼 사용
3. $R_{out1} \ll R_{in2}$이 되도록 설계하면 로딩 효과 최소화

**수치 예시:**
- $A_{v1} = -10$, $R_{out1} = 2\text{k}\Omega$
- $A_{v2} = -10$, $R_{in2} = 2\text{k}\Omega$
- 단순 곱: $A_v = 100$ (잘못된 계산)
- 실제: $A_v = -10 \times \frac{2}{2+2} \times (-10) = -10 \times 0.5 \times (-10) = 50$
- 절반으로 감소한 것을 확인할 수 있습니다.

---

### 3.6 실전 설계 체크리스트

**CS 증폭기 설계 시 확인 사항:**

- [ ] MOSFET이 포화 영역에서 동작하는가? ($V_{DS} > V_{GS} - V_{TH}$)
- [ ] DC 바이어스 전류가 설계 의도대로 설정되었는가?
- [ ] 입력 신호의 진폭이 선형 영역(소신호 조건)을 유지하는가?
- [ ] 다음 단의 $R_{in}$이 이득에 미치는 영향을 고려했는가?
- [ ] $r_o$의 영향을 무시할 수 있는가? (λ가 작고 $r_o \gg R_D$인 경우)
- [ ] 주파수 응답에서 커패시터의 영향은? (결합 커패시터, 바이패스 커패시터 등)

**이득 저하를 방지하는 설계 원칙:**
1. 출력 저항이 낮은 버퍼 추가
2. Cascode 구조로 $R_{out}$ 증가
3. 부하의 입력 저항을 높이기 위한 임피던스 변환

**핵심 공식 요약:**
| 구조 | 전압 이득 | 출력 저항 |
|---|---|---|
| CS (저항 부하) | $-g_m (R_D \parallel r_o)$ | $R_D \parallel r_o$ |
| CS (Degeneration) | $\frac{-g_m R_D}{1+g_m R_S}$ | $R_D \parallel [r_o + (1+g_m r_o) R_S]$ |
| CS (Diode-connected load) | $\frac{-g_{m1}}{g_{m2}}$ | $\frac{1}{g_{m2}} \parallel r_{o1}$ |
| CS (Current source load) | $-g_{m1} (r_{o1} \parallel r_{o2})$ | $r_{o1} \parallel r_{o2}$ |

이 공식들을 숙지하고 각각의 유도 과정을 이해하면 어떤 변형 회로가 나와도 소신호 모델을 그리고 수식을 직접 유도할 수 있습니다.

---

### [Qwen3.5 122B-A10B] (qwen/qwen3.5-122b-a10b)

*소요 시간: 34.3초 / 생성 분량: 8043자*

# MOSFET 증폭기 회로 분석 및 설계 마스터 노트: 소신호 모델, 병렬 임피던스, 그리고 실제 동작의 괴리

이 노트는 MOSFET 증폭기 회로의 핵심 원리인 **소신호 모델 (Small-Signal Model)**, **병렬 경로에 의한 이득 감소**, **대신호 vs 소신호 해석의 차이**, 그리고 **DC 전압원의 AC 접지화** 개념을 깊이 있게 다룹니다. 제공된 강의 녹취록과 슬라이드 데이터를 바탕으로, 이론적 수식 유도부터 실전 설계 팁까지 체계적으로 정리했습니다.

---

## 1. 핵심적인 질문 던지기 (Key Conceptual Questions & Deep Dives)

강의의 본질을 꿰뚫는 4 가지 핵심 질문에 대한 직관적 답변과 심층 해석입니다.

### Q1. 왜 출력단에 추가 경로 (Additional Path, $R_x$) 가 생기면 전체 전압 이득 ($A_v$) 이 감소하는가?
*   **직관적 설명:** 전류는 저항이 가장 낮은 길을 따라 흐르려는 성질이 있습니다. 원래 MOSFET 의 드레인 전류 ($g_m v_{gs}$) 는 부하 저항 $R_D$를 통해 흐르며 전압 강하 ($v_{out} = -i_d R_D$) 를 일으켰습니다. 여기에 병렬로 추가 경로 $R_x$가 연결되면, 생성된 전류가 $R_D$와 $R_x$ 사이에서 **분류 (Current Division)**됩니다.
*   **심층 해석:** MOSFET 은 전류 제어 소자입니다. 입력 전압 변화에 의해 생성된 전류 $g_m v_{gs}$의 총량은 동일하지만, 이 전류가 흐르는 **등가 저항 (Equivalent Resistance)**이 $R_D$에서 $R_D \parallel R_x$로 줄어들게 됩니다. 옴의 법칙 ($V = I \times R$) 에 따라 전류가 일정할 때 저항이 작아지면 전압 강하 (출력 전압 변화량) 도 작아지므로, 결과적으로 전압 이득이 감소합니다.
    *   *강의 예시:* 50mA 의 전류가 $R_D$ 하나만 있을 때는 모두 $R_D$에 전압을 만드나, $R_x$가 생기면 50mA 중 일부 (예: 40mA) 만 $R_D$로 흘러 전압 변화가 줄어듭니다.

### Q2. 소신호 모델에서 왜 3.3V, 5V 같은 고정 직류 전압원 (DC Node) 은 접지 (AC Ground) 로 취급되는가?
*   **직관적 설명:** 소신호 해석은 "변화량"을 다루는 것입니다. 3.3V 전압원은 시간이 지나도 전압 값이 변하지 않습니다. 즉, **변화량 ($\Delta V$) 이 0**입니다.
*   **심층 해석:** 소신호 모델은 회로의 선형화된 등가회로로, DC 오프셋을 제거하고 AC 신호만 분석합니다.
    *   $v_{DC} = \text{Constant} \implies \frac{d(v_{DC})}{dt} = 0 \implies v_{ac} = 0$
    *   전압 변화가 0 인 노드는 AC 관점에서 전위가 변하지 않는다는 뜻이므로, 모든 AC 신호가 흐르는 기준점인 **접지 (Ground)**와 동일한 역할을 합니다. 따라서 $V_{DD}$는 소신호 회로에서 바로 땅 (Ground) 으로 연결된 것으로 간주합니다.

### Q3. 대신호 (Large Signal) 의 실제 전압/전류 변화와 소신호 선형화 근사 사이에는 어떤 괴리가 있는가?
*   **직관적 설명:** MOSFET 의 $I_D - V_{GS}$ 특성은 2 차 함수 (포화 영역) 로 비선형입니다. 소신호 모델은 이 곡선의 특정 점 (Bias Point) 에서 접선 (선형) 으로만 근사합니다. 신호가 너무 크면 이 접선과 실제 곡선 사이의 오차가 커져 선형성이 깨집니다.
*   **심층 해석:**
    *   **대신호:** $I_D = \frac{1}{2}\mu C_{ox} \frac{W}{L} (V_{GS} - V_{TH})^2$ 공식을 사용하여 정확한 전류 값을 계산합니다. $V_{GS}$가 1V 에서 1.02V 로 변할 때, 전류 변화는 곡선의 기울기를 따라 정확히 계산됩니다.
    *   **소신호:** $i_d = g_m v_{gs}$를 사용합니다. 여기서 $g_m$은 바이어스 점에서의 순간 기울기입니다.
    *   **괴리:** 입력 신호가 작을 때 ($\Delta V_{in} \approx 20mV$) 는 두 결과가 거의 일치하지만, 입력 신호가 커지면 소신호 모델은 실제 전류 변화량을 과소 또는 과대 평가하게 되어 왜곡 (Distortion) 이 발생합니다. 강의 예시 ($1V \to 1.02V$) 에서 소신호 예측값과 실제 계산값 ($1.3V \to 1.2V$) 을 비교하여 이 오차를 확인해야 합니다.

### Q4. 출력 저항 ($R_{out}$) 이 높을수록 다음 단계로 신호를 전달할 때 왜 문제가 되는가?
*   **직관적 설명:** 출력 저항이 높다는 것은 전압원을 내부에서 "약하게" 만든다는 뜻입니다. 부하 ($R_{in, next}$) 가 연결되면 전압 분배 효과로 인해 실제 전달되는 전압이 줄어듭니다.
*   **심층 해석:** 증폭기 A 의 출력과 증폭기 B 의 입력이 연결될 때, 증폭기 A 의 출력 저항 ($R_{out,A}$) 과 증폭기 B 의 입력 저항 ($R_{in,B}$) 이 직렬로 연결되어 전압 분배기를 형성합니다.
    *   전달되는 전압: $V_{actual} = V_{ideal} \times \frac{R_{in,B}}{R_{in,B} + R_{out,A}}$
    *   $R_{out,A}$가 크면 분모가 커져 전달 전압이 급격히 감소하므로, **이득 (Gain) 이 기대치보다 낮아집니다.**

---

## 2. 수식 제시 및 수학적 유도 (Mathematical Formulations & Derivations)

강의 내용을 기반으로 한 핵심 수식들의 유도 및 수치 해석입니다.

### 2.1 병렬 저항에 의한 전압 이득 감소 유도
MOSFET 의 드레인 노드에 $R_D$와 추가 경로 $R_x$가 병렬로 연결된 경우를 가정합니다.

1.  **소신호 전류 생성:**
    입력 전압 변화 $v_{in}$이 게이트 - 소스 전압 $v_{gs}$에 적용되면, MOSFET 은 전류원 $g_m v_{gs}$를 생성합니다.
    $$ i_d = g_m v_{gs} $$
    (단, $v_{gs} = v_{in}$ assuming source is grounded)

2.  **등가 부하 저항 계산:**
    출력 노드에서 바라본 총 저항 $R_{eq}$는 $R_D$와 $R_x$의 병렬 합입니다.
    $$ R_{eq} = R_D \parallel R_x = \frac{R_D R_x}{R_D + R_x} $$

3.  **출력 전압 및 이득 유도:**
    생성된 전류 $i_d$가 $R_{eq}$를 통해 흐르면서 전압 강하를 일으킵니다. 전류 방향이 드레인으로 들어가는 방향이므로 출력 전압은 감소합니다 (반전 증폭).
    $$ v_{out} = -i_d \times R_{eq} = - (g_m v_{in}) (R_D \parallel R_x) $$
    $$ A_v = \frac{v_{out}}{v_{in}} = -g_m (R_D \parallel R_x) $$

    *   **해석:** $R_x$가 무한대 ($\infty$) 인 경우 $A_v = -g_m R_D$가 되지만, $R_x$가 유한한 값이면 $R_D \parallel R_x < R_D$이므로 $|A_v|$가 감소합니다.

### 2.2 트랜스컨덕턴스 ($g_m$) 및 전류 변화량
강의 예시 데이터 ($V_{DD}=3.3V, R_D=2k\Omega, I_D=1mA, V_{in}=1V$) 를 활용합니다.

*   **트랜스컨덕턴스 정의:**
    $$ g_m = \frac{\partial I_D}{\partial V_{GS}} \approx \frac{\Delta I_D}{\Delta V_{GS}} $$
    포화 영역에서 $I_D = \frac{1}{2} k_n (V_{GS} - V_{TH})^2$일 때, $g_m = \sqrt{2 k_n I_D} = \frac{2 I_D}{V_{GS} - V_{TH}}$입니다.

*   **수치 예시 (강의 데이터 기반):**
    *   초기 상태: $V_{in} = 1V$, $I_D = 1mA$, $V_{out} = 3.3V - (1mA \times 2k\Omega) = 1.3V$.
    *   입력 변화: $V_{in}$이 $1V \to 1.02V$ ($\Delta V_{in} = +20mV$) 로 증가.
    *   **대신호 해석 (실제):**
        *   $V_{GS}$가 증가하면 $I_D$는 2 차 함수적으로 증가합니다.
        *   강의에 따르면 $I_D$가 $1mA \to 1.05mA$ ($\Delta I_D = 50\mu A$) 로 변화했다고 가정합니다.
        *   $V_{out}$ 변화: $\Delta V_{out} = -\Delta I_D \times R_D = -50\mu A \times 2k\Omega = -100mV$.
        *   새로운 $V_{out} = 1.3V - 0.1V = 1.2V$.
    *   **소신호 해석 (근사):**
        *   $g_m \approx \frac{\Delta I_D}{\Delta V_{GS}} = \frac{50\mu A}{20mV} = 2.5 mS$.
        *   예측 이득: $A_v = -g_m R_D = -2.5mS \times 2k\Omega = -5$.
        *   예측 출력 변화: $v_{out} = A_v \times v_{in} = -5 \times 20mV = -100mV$.
        *   결과: 이 작은 신호 구간에서는 대신호와 소신호 해석이 일치함을 확인합니다.

### 2.3 채널 길이 변조 (Channel Length Modulation) 효과
$\lambda \neq 0$인 경우, 드레인 전류 식은 다음과 같습니다.
$$ I_D = \frac{1}{2} \mu C_{ox} \frac{W}{L} (V_{GS} - V_{TH})^2 (1 + \lambda V_{DS}) $$
이를 정리하면:
$$ I_D = I_{D0} (1 + \lambda V_{DS}) = I_{D0} + \frac{V_{DS}}{r_o} $$
여기서 $r_o = \frac{1}{\lambda I_{D0}}$는 MOSFET 의 출력 저항입니다.
*   **영향:** $r_o$는 $R_D$와 병렬로 연결되므로, 실제 이득은 $A_v = -g_m (R_D \parallel r_o)$가 됩니다. $r_o$가 유한하므로 이득이 이상적인 경우보다 감소합니다.

### 2.4 다단 증폭기 (Multi-Stage) 의 전체 이득
연결된 두 증폭기 (A, B) 가 있을 때, 전체 이득은 단순히 $A_{v1} \times A_{v2}$가 아닙니다.
$$ V_{out, total} = V_{in} \times A_{v1} \times \left( \frac{R_{in,2}}{R_{in,2} + R_{out,1}} \right) \times A_{v2} $$
*   **핵심:** 두 단계 사이의 **부하 효과 (Loading Effect)**를 고려해야 합니다. $R_{in,2}$가 $R_{out,1}$보다 충분히 크지 않으면 전체 이득이 급격히 떨어집니다.

---

## 3. 실전 회로 설계에서의 활용법 (Practical Applications & Engineering Takeaways)

이론을 실제 설계 및 시험 문제 풀이에 적용하기 위한 구체적인 지침입니다.

### 3.1 이득 저하를 막기 위한 버퍼링 및 임피던스 분리 전략
*   **문제 인식:** 고임피던스 출력 ($R_{out}$이 큰 증폭기) 을 저임피던스 입력 ($R_{in}$이 작은 다음 단계) 에 직접 연결하면 전압 분배로 인해 이득이 사라집니다.
*   **해결책 (버퍼링):**
    *   **Source Follower (Common Drain) 활용:** 출력 임피던스를 낮추고 입력 임피던스를 높이는 버퍼를 증폭기와 부하 사이에 삽입합니다.
    *   **임피던스 매칭:** $R_{out, stage1} \ll R_{in, stage2}$가 되도록 설계합니다. 일반적으로 $1/10$ 이하로 유지하는 것이 안전합니다.
*   **설계 팁:** "다음 단계가 내 출력을 얼마나 끌어당기는가?"를 항상 질문하고, $R_{out}$ 계산 시 부하 저항을 반드시 병렬로 고려하십시오.

### 3.2 소신호 등가회로를 빠르게 그려서 해석하는 실전 팁
1.  **DC 제거:** 모든 DC 전압원 ($V_{DD}, V_{SS}$) 을 접지 (Ground) 로 단락합니다. 커패시터는 AC 단락 (Short) 으로 가정합니다 (충분히 큰 용량일 경우).
2.  **소자 변환:**
    *   MOSFET $\to$ 전압 제어 전류원 ($g_m v_{gs}$) 과 출력 저항 ($r_o$) 병렬 연결.
    *   저항은 그대로 둡니다.
3.  **노드 식별:**
    *   게이트 (Gate): 입력 전압 $v_{in}$이 직접 연결됨.
    *   소스 (Source): 접지 또는 $R_S$가 연결됨 (소스 저항이 있으면 $v_{gs} = v_{in} - v_s$).
    *   드레인 (Drain): 부하 저항 ($R_D$) 과 다음 단계의 입력 저항 ($R_{in, next}$) 이 병렬로 연결된 노드.
4.  **직관적 계산:**
    *   $v_{out} = - (g_m v_{gs}) \times R_{total\_load}$
    *   $R_{total\_load}$는 드레인 노드에 연결된 **모든** 저항의 병렬 합 ($R_D \parallel R_x \parallel r_o \parallel R_{in, next}$) 입니다.

### 3.3 흔히 범하는 함정 (Pitfalls) 및 주의사항
*   **함정 1: DC 전압원을 AC 신호로 오해.**
    *   $V_{DD}=3.3V$라고 해서 AC 분석에서도 3.3V 가 유지되는 것이 아닙니다. AC 분석에서는 0V(접지) 입니다.
*   **함정 2: 추가 경로 ($R_x$) 무시.**
    *   회로도에 보이지 않는 부하 저항이나 측정 장비의 입력 임피던스를 무시하면 이득을 과대평가합니다. "어디에 전류가 새어 나가는가?"를 항상 확인하십시오.
*   **함정 3: 선형성 범위 초과.**
    *   소신호 모델을 사용하여 큰 신호 ($> 100mV$) 를 분석하면 오류가 발생합니다. $v_{gs}$가 $V_{GS}-V_{TH}$의 10% 이내인지 확인하고, 아니면 대신호 해석 (SPICE 시뮬레이션 또는 그래프 해석) 을 사용해야 합니다.
*   **함정 4: 출력 저항 계산 오류.**
    *   $R_{out}$을 구할 때 독립 전압원은 접지로, 독립 전류원은 개방으로 만듭니다. 하지만 $g_m v_{gs}$와 같은 의존 전류원은 **제거하지 않고** 유지해야 합니다. $v_{gs}$를 0 으로 만드는 조건 (게이트-소스 단락) 을 적용하여 $R_{out}$을 구하는 것이 핵심입니다.

### 3.4 시험 문제 풀이를 위한 체크리스트
1.  **회로 식별:** CS (Common Source), CG (Common Gate), CD (Source Follower) 중 어느 구조인가?
2.  **부하 확인:** $R_D$ 외에 병렬로 연결된 저항 ($R_x$, $r_o$, 다음 단계 $R_{in}$) 이 있는가?
3.  **모델 적용:** $\lambda=0$인지 $\lambda \neq 0$인지 확인하여 $r_o$ 포함 여부 결정.
4.  **공식 적용:** $A_v = -g_m (R_D \parallel \dots)$ 또는 $A_v = \frac{R_D}{1/g_m + R_S}$ (Degeneration) 등 상황에 맞는 공식 선택.
5.  **단위 확인:** $g_m$은 mS, $R$은 $k\Omega$일 때 곱셈 시 $10^{-3} \times 10^3 = 1$이 되어 단위가 무차원 (Gain) 이 되는지 확인.

이 요약 노트는 MOSFET 증폭기 설계의 기초를 다지고, 복잡한 회로도에서도 핵심 물리 현상을 직관적으로 파악할 수 있도록 돕는 나침반이 될 것입니다.

---

### [Qwen3.8 2.4T-A95B] (qwen/qwen3.8-2.4t-a95b)

*소요 시간: 124.4초 / 생성 분량: 39553자*

We need answer in Korean. User asks to produce structured study notes from lecture transcript/slide OCR about MOSFET amplifiers, small-signal, parallel resistors/additional path reducing gain, large vs small signal, DC voltage sources AC ground, etc. Must include 3 axes: key conceptual questions, math formulations/derivations, practical applications. Use Markdown, LaTeX. No meta/intro. Need deeply structured, complete. Need analyze content and synthesize. Need likely cover: additional path Rx reduces gain because load at output becomes RD || Rx (or parallel combination of many resistances/current paths), current change from transistor divides, voltage change at output reduced. Small-signal fixed DC nodes ground because DC sources have zero incremental impedance (ideal), only changes matter, VDD AC short to ground. Large signal vs small signal: example VDD=3.3V, RD=2k, Vin 1 ->1.02 V, Vout 1.3 ->1.2 V, Id 1 ->1.05 mA? Need reconcile numbers. There are OCR inconsistencies: 50mAh? probably 50 µA? Slide: VDD=3.3V RD=2k VIN=1V ->1.02V Vout=1.3V ->1.2V Id=1mA ->1.05mA. But if RD=2k, Id=1mA -> drop 2V, Vout=1.3V fits VDD 3.3. If Id changes +50 µA (1.05 mA) drop=2.1V, Vout=1.2V. So ∆Vin=20 mV, ∆Id=50 µA => gm=∆Id/∆Vgs=50µA/20mV=2.5 mA/V. Gain small signal = -gm RD = -2.5m*2k=-5. ∆Vout=-5*20mV=-100mV, from 1.3 to 1.2 V. Good. OCR mentions 1mA x 2k=2V, 1.05mA x2k=2.1V. Good. Then with additional path maybe gain smaller, output change less, e.g. Vout=1.5 ->1.4625? ∆=-37.5mV for +20mV input? Gain=-1.875? Need infer from slide: Added Path Reduces Voltage Change: VDD=3.3V, Rd=2k, Vin=1V, Id=1mA, Gain=-gmRd. Then parallel resistors maybe 2k,4k,6k,15k,10k? Vout=1.5 ->1.4625, Gain=-gm(R1//R2//R3//R4//R5//R6). Another slide: Vin=+20mV, Vout=-37.5mV, gm_Vgs=+50μA, 2kΩ. If gain -1.875, effective load=|Av|/gm=1.875/2.5m=750Ω. Maybe parallel combination of something equals 750Ω? If RD=2k || Rx = 750 -> Rx=1.2k. There is mention 10k? Need not force exact. Can present general with illustrative numeric example: no extra path gain -5, ∆Vout=-100mV. With extra path Rx=1.2k gives R_eff=750Ω, gain=-1.875, ∆Vout=-37.5mV. That matches OCR Vout=1.5->1.4625? If baseline 1.5, +20mV input gives -37.5mV, output 1.4625. Good. So use that as numerical example. Need mention if extra current source/path provides DC current and incremental conductance. Additional path could be load resistor, current source output resistance, next-stage input resistance. It shunts AC output node to AC ground or another fixed voltage, reducing incremental resistance at output. Thus voltage swing for same gm vgs current reduces. Current division: total small-signal current from controlled source splits between RD and Rx; only portion through RD creates output voltage? Actually output voltage is node voltage relative to ground; if both RD to VDD (AC ground) and Rx to AC ground, both are parallel to ground. The controlled current source pulls current from output node to ground (NMOS drain to source). KCL: g_m v_gs = v_out/R_D + v_out/R_x (assuming source ground and current direction), so v_out = -g_m v_gs (R_D || R_x)? Need signs. Typically small-signal: drain current increment id = g_m vgs flows into drain (from drain to source? depends). Output node has RD to AC ground; KCL: (v_out/RD) + g_m v_in = 0 -> v_out=-g_m RD v_in if only RD. With Rx: v_out(1/RD+1/Rx)+g_m vin=0 => Av=-g_m(RD||Rx). Good. We can derive.

Need cover channel length modulation: large signal Id=1/2 μCox (W/L?) (VGS-VTH)^2(1+λ VDS) = ID0 + λ ID0 VDS ≈ ID0 + VDS/r_o, where r_o=1/(λ ID0) (more precisely 1/(λ ID) or (1/λ+VDS?)). Small signal includes r_o parallel with RD/load, gain = -g_m (R_D || r_o || R_L...). If λ=0 ideal current source infinite ro. PMOS current source load: gain = -g_m (r_o1 || r_o2) maybe if active load. Diode-connected load resistance ~1/g_m (if λ=0) or (1/g_m)||r_o; gain approx -g_m1/(g_m2 + 1/r_o2? ) maybe -g_m1 (1/g_m2 || r_o2) ~ -g_m1/g_m2. Degeneration: source resistor R_S reduces gain: Av = -g_m R_D / (1+g_m R_S) if λ=0 and bypass cap? If not bypassed. More exact with ro maybe. Output resistance with degeneration: Rout ≈ r_o(1+g_m R_S)+R_S (or if looking into drain with source degeneration). If λ=0 Rout=R_D (or infinite looking into transistor? Need mention). Example with M1/M2 identical? Could be source follower? But user focus mostly additional path, small signal, DC ground, large vs small. But transcript includes CS amp with current source, PMOS current source, diode-connected load, degeneration, output resistance. We need likely incorporate to be complete. But user's requested 3 axes around those concepts. We can include sections for these advanced topics but not overdo? Desired oververbosity 9, so detailed. Need produce final only notes, no intro. Must use Korean. Need ensure LaTeX correct. Need maybe include table of numerical large vs small. Need standard inline $...$, block $$...$$. Need ensure no unsupported weird. Use Markdown.

Need think through exact content to produce.

Structure:
# MOSFET 증폭기: 추가 경로에 의한 이득 감소, 소신호/대신호, AC 접지, 임피던스 통합 노트

Maybe no intro. Start with ## 1. 핵심 질문과 직관적 답변

Questions:
1. 추가 경로 Rx가 생기면 왜 이득이 감소하나?
- 출력 노드 incremental resistance 감소. 동일 gm vgs 전류가 더 많은 경로로 나누어짐. 전압 변화 vout = -id * R_eq. R_eq = RD||Rx... smaller.
- Thevenin/Norton: transistor is VCCS, load resistance converts current to voltage. Additional path increases conductance, lowers resistance, lowers conversion gain.
- If Rx is next stage input resistance or current source finite output resistance, it loads output.

2. 소신호에서 DC 전압원은 왜 AC ground?
- Small signal analyzes changes around bias. Ideal DC source has constant voltage: ΔV=0, incremental impedance 0. Node fixed at DC potential is small-signal short to ground. VDD becomes AC ground; large capacitors short at signal freq; bias current sources open? Actually ideal current source has infinite incremental impedance, but fixed current node? Need clarify: fixed DC voltage node = AC ground if ideal voltage source. Fixed DC current source = open for AC (infinite impedance). But slide says fixed voltage node just ground. Also if supply has nonzero impedance, use that impedance not short.

3. 대신호와 소신호 차이?
- Large signal uses nonlinear I-V, actual DC operating point changes; small signal linearizes derivative at Q-point. For small ∆, ∆ID≈gm∆VGS. If ∆ large, gm changes, output swing may clip, ro nonlinear, threshold/body effects, etc. Example: exact square-law vs tangent.
- Use numbers: Q point: VDD=3.3, RD=2k, ID=1mA, Vout=1.3. Vin=1 to 1.02, ID=1 to1.05, Vout=1.3 to1.2. gm=50µA/20mV=2.5mS. Av=-5. Large signal computed by Ohm's law: Vout=VDD-IDRD. Small-signal: ∆Vout=-gmRD∆vin = -100mV. Matches if small. If additional path, small-signal predicts reduced gain; large signal would also show less voltage change due to extra DC/AC current path.

4. 왜 전류 분배가 중요한가? 추가 경로 전류가 원래 RD 전류 변화를 줄이나?
- Explain with example: without Rx, ∆ID=50µA all through RD => ∆VRD=100mV. With Rx, total transistor ∆ current? Actually controlled source still gm vgs =50µA? If output voltage less, current through RD changes less; extra path takes rest. KCL: ∆ID=∆IRD+∆IRx. If Req=750, vout=-37.5mV, ∆IRD=vout/RD=-18.75µA? sign, ∆IRx=vout/Rx=-31.25µA. Sum=-50µA. So RD current change only 18.75µA, voltage change 37.5mV. Good. Need present sign carefully: increase Vin raises ID (pulls more current from node to ground), node voltage falls; current through RD from VDD to node? If Vout falls, voltage across RD increases, so IRD increases? Let's set small-signal currents. Node voltage vout negative. RD to AC ground: current from node to ground through RD is vout/RD (negative, meaning actual current flows from ground to node? Hmm). Better to talk magnitudes: extra path absorbs part of incremental current, so less incremental voltage develops across RD. Use KCL with directions: define g_m v_in current drawn from output node to ground. Resistors from node to AC ground conduct current from node to ground equal v_out/R. If v_out negative, current is negative, i.e. flows into node, supplying the g_m current. Magnitudes: |v_out|/RD + |v_out|/Rx = g_m v_in. So only part of g_m v_in is balanced by RD. Good.

5. 다단 증폭기에서 Rin/Rout가 왜 중요한가?
- Next stage input resistance loads previous output: effective gain = Av_open * Rin_next/(Rin_next + Rout_prev) for voltage transfer. Need formulas.
- Multiple stage total gain not just product of intrinsic gains; include loading factors.

6. What is resistance seen from input/output? maybe include. Input resistance of CS is high (gate open) but with bias resistors etc. Output resistance is RD||ro||...; with degeneration increased.

7. Current source load: ideal current source in small signal? infinite resistance, so gain -gm ro? Actually if ideal current source load infinite incremental impedance, gain infinite in simplified model; real finite ro. PMOS current source load: load is PMOS ro, gain -gmN (roN||roP). Need explain role bias; in small signal ideal current source is open (high R) not short. But fixed DC voltage node ground.

8. Diode-connected load: why ~1/gm? Gate-drain short, small-signal looking into drain/source? For diode-connected MOS in saturation, i = gm vgs + vds/ro, vgs=vds, so incremental resistance = 1/(gm+1/ro) ≈1/gm. Used as load gives gain ≈ -gm1/(gm2+...) or -gm1/gm2.

9. Source degeneration: why gain less and linearized? R_S introduces negative feedback: input vgs = vin - vs, vs=id RS. id = gm vgs => id = gm(vin-idRS) => id = gm/(1+gmRS) vin. Av = -id RD / vin = -gm RD/(1+gmRS). With ro maybe. Output resistance increased.

Need maybe include questions under key conceptual. But need not too many.

Then ## 2. 수식 및 유도
Subsections:
2.1 DC/large signal operating point
- For NMOS CS with RD: saturation Id = 1/2 μnCox (W/L)(VGS-VTH)^2(1+λVDS). If λ=0. Vout = VDD - ID RD. Need Q point example.
- Numerical: VDD=3.3V, RD=2kΩ, IDQ=1mA, VOUTQ=1.3V. Vin changes 20mV, ID changes 50µA, new Vout=3.3 - 1.05mA*2k=1.2V. ∆Vout=-0.1V. Large signal gain over small interval = -0.1/0.02=-5.

2.2 Small signal model and gm
- Define gm = ∂ID/∂VGS|Q. Square law λ=0: gm = μnCox(W/L)(VGS-VTH) = 2ID/(VGS-VTH) = sqrt(2 μnCox(W/L) ID). With λ: plus? gm approximately same, ro=1/(λID).
- ∆ID ≈ gm ∆vGS. Example gm=50µA/20mV=2.5mS.

2.3 Basic CS gain without extra path
- Small-signal: gate input vin, source ground, drain node vout, RD to AC ground. KCL: gm vin + vout/RD + vout/ro =0 (if include ro). Therefore Av = -gm (RD||ro). If ro ignored, -gmRD. Numeric -2.5mS*2k=-5.

2.4 Additional parallel path Rx
- Add Rx from output to AC ground (or to fixed voltage). KCL: gm vin + vout(1/RD+1/Rx+1/ro...)=0. Av=-gm (RD||Rx||ro...). Derive using parallel resistance. If Rx=1.2kΩ, RD||Rx=750Ω, Av=-1.875. For ∆Vin=20mV, ∆Vout=-37.5mV. Currents: gm vin=50µA; |vout|/RD=18.75µA, |vout|/Rx=31.25µA, sum=50µA. Thus RD current/voltage change reduced. Need align signs maybe with magnitude table.
- More general additional path not necessarily to ground: if to a small-signal fixed voltage, same as ground; if to another node with signal, must include its relation (e.g., feedback). If finite source impedance, use impedance.

2.5 Parallel resistor math and current divider
- For two resistors: Req = R1||R2 = R1R2/(R1+R2), conductances add. If node voltage v, currents i1=v/R1, i2=v/R2. If total current I injected into node, v=I Req. Current divider: i1=I * R2/(R1+R2) if current entering node split to ground? For conductances: i1=I G1/(G1+G2). Need include.

2.6 AC ground concept mathematically
- Let node voltage = V_DC + v_ac. For ideal voltage source VDD: v_ac=0. Incremental resistance ∂V/∂I=0. Therefore replace with short to ground in small-signal. For fixed bias voltage similarly. For capacitor at signal freq: impedance 1/jωC≈0 -> AC short. For ideal current source: I_DC constant, ∆I=0 -> incremental impedance ∞ -> open. But real current source has ro parallel.

2.7 Large vs small signal linearization error
- Taylor expansion: ID(VGS+∆v) ≈ ID(VGS) + gm∆v + 1/2 g_m' ∆v^2... Error if square law: exact ∆ID = gm ∆v + (1/2)k ∆v^2. Relative error = ∆v/[2(VGS-VTH)]? Let's derive: ID=k/2 (Vov)^2, gm=k Vov. Exact for ∆: ∆ID = k/2[(Vov+∆)^2 - Vov^2] = k Vov ∆ + k/2 ∆^2 = gm∆ + (1/2)k∆^2. Ratio nonlinear term/linear = ∆/(2Vov). If ∆=20mV, Vov=0.2? error 5%; maybe. Use qualitatively.
- Also RD large-signal Vout=VDD-IDRD exactly linear in ID if RD fixed; small-signal matches for incremental. But if extra path includes nonlinear device, small-signal uses local resistance.

2.8 Loading of stages: Rin/Rout
- Model amplifier A: Thevenin output: v_oc = A_v0 v_in, series Rout. Load Rin_B. Actual v_out = v_oc * Rin_B/(Rout+Rin_B). Effective voltage gain from A input to B input = A_v0 * Rin_B/(Rout+Rin_B). If multiple stages: total = ∏ A_vi * loading factors. Maybe include formula:
$$\frac{v_{out}}{v_{in}} = A_{v1}\frac{R_{in2}}{R_{in2}+R_{out1}} A_{v2}\frac{R_{in3}}{R_{in3}+R_{out2}}\cdots$$
- Input resistance measured by test voltage/current at input with independent sources zeroed: Rin=vx/ix. Output resistance by turning off independent input sources (voltage sources short, current sources open), apply test source at output: Rout=vx/ix. Include dependent sources remain.

2.9 Channel length modulation and active loads
- Id = ID0(1+λVDS). ro = [∂ID/∂VDS]^{-1} ≈ 1/(λID0). Gain CS with ro: -gm(RD||ro). Current source load: load resistance is ro of current source; gain -gmN (roN||roP). Ideal current source ro→∞ -> gain limited by transistor ro? Actually if both ideal infinite? In a simple NMOS with ideal current source load and no RD, output node only controlled source and ideal current source, small-signal resistance infinite -> infinite gain in simplified model; in reality ro limits.
- PMOS current source: if PMOS load gate bias fixed, source to VDD AC ground, drain at output; small-signal equivalent is ro_p from output to AC ground (and maybe gm_p vsg=0 if gate/source fixed), so parallel with NMOS ro. Gain = -g_mn (r_on || r_op). If PMOS diode? no.

2.10 Diode-connected load
- For M2 diode-connected (gate-drain short), small-signal from drain to source: test vx, current ix = gm vx + vx/ro, so R = vx/ix = 1/(gm+1/ro)= (1/gm)||ro. CS with diode load gain: Av = -g_m1 (R_load) = -g_m1 (1/g_m2 || r_o2 || maybe r_o1). If λ=0 and neglect body: Av≈-g_m1/g_m2. If include ro: -g_m1 (r_o1 || 1/g_m2 || r_o2?) Need be precise: NMOS driver M1 drain node, load PMOS diode-connected from VDD to out. Small-signal: M1 current source g_m1 vgs1 with ro1 to ground? Source ground. Load diode PMOS: source to VDD AC ground, gate/drain output. For PMOS diode, incremental resistance from output to AC ground is 1/g_m2 || r_o2. M1 ro from output to ground too. Thus total R_out = r_o1 || (1/g_m2 || r_o2). Gain = -g_m1 [r_o1 || r_o2 || 1/g_m2]. If λ=0 and ro1,ro2∞, -g_m1/g_m2.

2.11 Source degeneration
- With R_S unbypassed: small signal: v_gs = v_in - i_d R_S; i_d = g_m v_gs (ignore ro) => i_d = g_m(v_in - i_d R_S) => i_d = g_m/(1+g_mR_S) v_in. Output v_out = -i_d R_D. Av = -g_m R_D/(1+g_m R_S). If include ro and R_D, more complex: effective transconductance G_m = g_m/(1+g_m R_S) approximately; output resistance looking into drain ≈ r_o(1+g_m R_S)+R_S. With R_D, Rout = R_D || that. If source bypass capacitor, at signal R_S shorted -> gain returns to -gmRD; at low frequency degeneration.
- Degeneration reduces gain but increases linearity, input/output impedance, bandwidth maybe.

Need include numerical example for degeneration? Maybe optional.

Then ## 3. 실전 활용
- Check output loading: whenever a node drives next circuit, replace next circuit by Rin (or impedance) in parallel. If gain lower than expected, suspect loading by Rx, finite ro, bias network, measurement instrument (oscilloscope 1MΩ||15pF), current source finite ro.
- To prevent gain degradation: buffer with source follower/op-amp, increase Rin of next stage (use MOS gate, cascode, bootstrapping), lower Rout of driving stage if voltage transfer? Actually for voltage output, want Rout << Rin to avoid loss. Use source follower (low Rout), common-drain, unity-gain buffer. Use cascode to increase output resistance of current source load? For gain, increase effective load resistance: active load, cascode current source, longer channel, higher ro. But if load is next stage, isolate with buffer.
- Impedance separation: design each stage with input impedance high, output impedance low for voltage amplifiers, or account for matching.
- Small-signal drawing tips: 1) find DC bias, 2) short DC voltage sources to ground, open DC current sources (or replace with ro), short large capacitors at midband, 3) replace MOSFET by gm vgs current source and ro, 4) identify all resistances from output node to AC ground: RD, ro, load, bias, next stage, 5) combine in parallel for gain. 6) For input, gate current zero -> Rin set by bias resistors, but Miller effect at high freq.
- Pitfalls: confusing DC ground with physical ground; forgetting VDD is AC ground; treating ideal current source as short; forgetting ro; forgetting loading of next stage; using large-signal resistor values when device is nonlinear; sign errors; assuming gain product without loading; assuming source resistor bypassed when not; body effect; capacitors not short at low freq; measuring with probe loading.
- Exam strategy: If question says additional path/resistor attached to output, immediately write R_eff = R_D || R_x || r_o || R_in,next. If asks fixed voltage node, replace with ground. If asks large vs small, compute Q point then gm, compare ∆. If asks multi-stage, draw cascade with Rin/Rout and voltage dividers.
- Design examples: Want gain magnitude ≥ target: choose RD or active load such that gm R_eff target, but ensure output swing headroom: Vout_Q = VDD - ID R_D; RD too large limits swing. If need high Rout for current source load, cascode. If need low Rout to drive load, source follower or feedback.
- Use test-source method for Rin/Rout: zero independent sources, apply v_x/i_x; keep dependent sources. For output resistance with input shorted (vin=0), vgs may not be zero if source not grounded due to degeneration; derive.

Need maybe include a table of example without/with Rx:
Columns: Condition, R_eff, Av, ∆Vin, ∆Vout, current through RD etc.
Numerical: Q maybe VoutQ=1.3 or 1.5? Use consistent. The slide has with Rx baseline Vout=1.5->1.4625, maybe use separate. For basic example Q=1.3. For added path example set Q=1.5? Need avoid inconsistency. Can say "강의 슬라이드의 추가 경로 예시를 재구성하면" with Vout_Q=1.5, ∆Vout=-37.5mV. But if RD=2k and ID? If Vout=1.5, drop=1.8V -> ID=0.9mA. gm maybe still 2.5mS. If Rx=1.2k, DC current through Rx? If Rx to ground, DC current 1.5/1.2=1.25mA, so transistor ID maybe 0.9mA+? Hmm not consistent. But small-signal only. Better present small-signal incremental numbers not DC. Could use baseline no path Vout_Q=1.3. With path, Q changes; but incremental gain uses local R_eff. We can say "DC 바이어스는 달라질 수 있으나, 소신호 등가에서는 추가 경로의 증분 저항만 병렬로 붙는다." Example: If R_eff=750Ω, ∆Vout=-37.5mV for 20mV input. This matches slide. Don't overstate DC values.

Need ensure math sign. For additional path: KCL at output node with small-signal ground at VDD and source. Let current from controlled source flow from drain to source (down) = g_m v_gs. Node voltage v_o. Resistive currents leaving node to ground = v_o/R_D + v_o/R_x. KCL: v_o/R_D + v_o/R_x - g_m v_in? Wait if controlled current source draws current from node to ground, leaving node is g_m v_in. Then sum leaving = v_o/RD + v_o/Rx + g_m vin =0? Actually no external current injection, sum leaving =0? Let's define currents leaving positive: through resistors to ground: v_o/R. Controlled source current leaves node to ground: g_m v_in. KCL leaving sum =0? That would v_o/R + g_m vin =0 -> v_o negative. Yes if vin positive, v_o = -g_m R vin. Good. If using currents entering node, sign similar. We'll write KCL: $g_m v_{in} + v_{out}/R_D + v_{out}/R_x =0$, giving negative. This assumes current source from output to ground. Good.

Need include current division magnitudes:
With Rx=1.2k, R_eff=750, vout=-37.5mV, current through RD magnitude = 37.5mV/2k=18.75µA, through Rx=37.5/1.2k=31.25µA, total=50µA. Without Rx, current through RD=50µA. Good.

Need mention additional path can be a resistor to another signal node; then not simply parallel. If that node is fixed/incremental ground, parallel; if it has gain/feedback, modify. E.g., source degeneration path creates feedback not simple output shunt.

Need include "Fixed voltage node is just ground" maybe with example of multiple supply voltages 3.3, 3.9, 4.5, 6V all become AC ground if ideal. If resistor network from outputs to these fixed supplies, those ends go to ground in small-signal.

Need maybe include "3.3V, 5V DC node AC ground" question. Answer: because small-signal variables are deviations; a fixed node has zero deviation. Mathematically $V_{node}=V_{DC}+v_{ac}$, $v_{ac}=0$. An ideal voltage source has $v=constant$ regardless of current => incremental resistance 0, so short. Not physically shorting DC to ground for DC analysis; only for AC incremental analysis.

Need mention large signal vs small signal "괴리": small signal only valid for sufficiently small variations around Q. If ∆Vin too large, gm changes with VGS, device may leave saturation, output clipped, ro nonlinear. Example: if ∆Vin=200mV not 20mV, linear gain -5 predicts -1V output; actual may not follow because Vout near rail or triode, gm variation. Use Taylor error.

Need include maybe body effect? not central but pitfall.

Need maybe include "병렬 저항 및 옴의 법칙 기반 전류 분배 공식". Provide formulas.

Need include "실제 수치 대입하여 대신호 해석과 소신호 해석 결과 대조". We'll include table.

Need perhaps include lecture OCR weird "Rpd"? Probably RD. Use RD.

Need final output in Korean, no meta. Need ensure complete, no cut. Use headings.

Potential final structure:

# MOSFET 증폭기 학습 요약 노트

## 1. 핵심 질문과 직관적 답변
### Q1. 추가 경로 Rx가 왜 전압 이득을 줄이는가?
... formulas and intuitive current split.
### Q2. 왜 DC 전압원은 AC 접지인가?
...
### Q3. 대신호와 소신호 차이는?
...
### Q4. 다음 단계 연결, Rin/Rout为何重要?
...
### Q5. 전류원/다이오드/디제너레이션 etc? maybe.

Maybe too many Q. But okay.

## 2. 수식과 유도
### 2.1 DC 바이어스와 대신호 관계
### 2.2 gm 정의와 선형화
### 2.3 기본 CS 이득
### 2.4 추가 경로 병렬 부하 이득
### 2.5 전류 분배 수치 예시
### 2.6 AC 접지와 테스트 소스 임피던스
### 2.7 채널 길이 변조, 능동 부하, 다이오드 부하, 디제너레이션

Need maybe combine to avoid huge but still structured.

## 3. 실전 회로 설계 및 시험 활용
### 3.1 이득 저하 방지/버퍼링
### 3.2 소신호 등가회로 5단계
### 3.3 함정 체크리스트
### 3.4 시험 문제 풀이 패턴

Need include tables.

Need ensure all LaTeX valid. Use \parallel maybe $R_D \parallel R_x$. Use $$ ... $$. Need maybe avoid Unicode issues? Korean okay.

Let's draft in detail.

Need maybe mention $R_x$ could be $R_{in,next}$, $r_{o,load}$, bias resistor, probe. If path to $V_{DD}$, since VDD AC ground, path is to ground. If path to another fixed bias voltage, same.

Detailed derivations:

Large signal:
Assume NMOS saturation, λ=0:
$$I_D = \frac{1}{2} k_n' \frac{W}{L} (V_{GS}-V_{TH})^2 = \frac{1}{2}K_n (V_{OV})^2$$
$$V_{OUT}=V_{DD}-I_D R_D$$
If λ:
$$I_D=I_{D0}(1+\lambda V_{DS})$$
$$r_o = \left(\frac{\partial I_D}{\partial V_{DS}}\right)^{-1}\approx \frac{1}{\lambda I_{D0}}$$
Small:
$$g_m = \left.\frac{\partial I_D}{\partial V_{GS}}\right|_Q$$
For square law:
$$g_m=K_n V_{OV} = \sqrt{2K_n I_D}=\frac{2I_D}{V_{OV}}$$
where $K_n=\mu_n C_{ox}W/L$ maybe.

Basic gain with ro:
KCL: $g_m v_{in}+v_{out}(1/R_D+1/r_o)=0$ => $A_v=-g_m(R_D\parallel r_o)$.

With Rx:
$$g_m v_{in} + v_{out}\left(\frac{1}{R_D}+\frac{1}{R_x}+\frac{1}{r_o}+\cdots\right)=0$$
$$A_v=-g_m\left(R_D\parallel R_x\parallel r_o\parallel\cdots\right)$$

Current divider:
If total small-signal current $i_t = g_m v_{in}$ is sunk from node, node voltage magnitude $|v_o|=i_t R_{eq}$. Current through $R_D$:
$$|i_{R_D}|=\frac{|v_o|}{R_D}=i_t\frac{R_{eq}}{R_D}=i_t\frac{G_D}{G_D+G_x+...}?$$ Wait $R_eq/R_D = (1/(Gtot))/R_D = 1/(R_D Gtot)=G_D/Gtot? Since G_D=1/RD, Req=1/Gtot, Req/RD=1/(RD Gtot)=G_D/Gtot. Yes current through RD = i_t G_D/Gtot. For two: $i_RD = i_t R_x/(R_D+R_x)$? Check: conductance divider: current through RD = i_t * G_D/(G_D+G_x)=i_t*(1/RD)/(1/RD+1/Rx)=i_t*Rx/(RD+Rx). Yes. For RD=2k, Rx=1.2k, current through RD =50µA*1.2/(3.2)=18.75µA. Good. Include both formulas.

Numerical table:
Q without extra path:
- $V_{DD}=3.3V$, $R_D=2kΩ$, $I_{DQ}=1mA$, $V_{OUTQ}=1.3V$.
- $\Delta V_{in}=20mV$, $\Delta I_D=50µA$, $g_m=2.5mS$.
- Large new: $I_D=1.05mA$, $VOUT=3.3-2.1=1.2V$, $\Delta VOUT=-100mV$, gain=-5.
- Small: $A_v=-2.5mS*2k=-5$.
With extra path:
- $R_x=1.2kΩ$ (reconstructed), $R_eff=2k||1.2k=750Ω$, $A_v=-1.875$, $\Delta Vout=-37.5mV$ for 20mV. Currents: RD 18.75µA, Rx 31.25µA, sum 50µA. This demonstrates less voltage change.
Need maybe if slide says Vout 1.5->1.4625, mention "출력 DC 바이어스가 1.5V인 슬라이드 예시에서는 1.4625V로 37.5mV만 변화". But if inconsistent, can say "슬라이드의 수치(예: $1.5\to1.4625$V)는 동일한 $\Delta V_{out}=-37.5$mV를 의미한다." Good.

Large vs small table maybe:
| 구분 | 대신호 | 소신호 |
| ... |

Need include "소신호 모델에서 고정 전압 노드 접지" derivation:
Let $v(t)=V_{DC}+v_s(t)$. For ideal DC source $V_{DC}$ constant, $dv=0$. Small signal voltage between node and ground is $v_s=0$. Resistance $r = dv/di=0$. Therefore short. If supply has impedance $Z_{DD}$, then not ground but $Z_{DD}$ to ground. If node is fixed by large capacitor, at midband capacitor is short. If node is bias current source: $i=I_{DC}$ constant, $di=0$, $r=di/dv? Actually incremental impedance = dv/di = ∞, open. Real current source $r_o$ parallel.

Need include "고정 전압원 vs 고정 전류원" because lecture likely only fixed voltage node ground; but students confuse current source.

Practical:
- Buffering: If $R_{in,next}$ comparable to $R_{out,prev}$, voltage divider loss. Use source follower: $R_{out}\approx 1/g_m$ (with degeneration maybe), high input. Use op-amp voltage follower. Use cascode to increase output resistance for gain stage but then for driving low load need buffer. Impedance strategy: voltage amplifier: $R_{in}$ high, $R_{out}$ low. Transimpedance/current amp different.
- Increase effective load: $R_D$ bigger but headroom tradeoff; active load high ro; cascode current mirror. But if load is external, cannot just increase RD; buffer.
- Degeneration: reduce gain intentionally for linearity, set gain by resistor ratio if $g_mR_S\gg1$: $A_v\approx -R_D/R_S$. Good design takeaway.
- For PMOS current source load: gain limited by parallel ro; to increase use cascode, longer L, lower current (higher ro but gm tradeoff). Ensure both transistors in saturation: output swing range.

Small-signal drawing tips:
1. Identify DC supplies and bias nodes. For midband AC: short ideal voltage supplies to ground, open ideal current sources; replace with $r_o$ if nonideal.
2. Capacitors: coupling/bypass large -> short; if low frequency include impedance.
3. MOSFET: gate open (infinite input), source to ground if bypassed; if source resistor unbypassed include it; dependent current source $g_m v_{gs}$ from drain to source; $r_o$ between drain/source.
4. Combine resistances at output. Determine $R_{out,node}$ as parallel of all incremental paths to AC ground. Gain = $-G_m R_{out,node}$ where $G_m$ is effective transconductance from input to output current. For degeneration $G_m = g_m/(1+g_mR_S)$.
5. For loading: insert $R_{in,next}$ as parallel load; for previous source impedance use voltage divider at input.

Pitfalls:
- Forgetting $r_o$ or $R_L$; using $-g_mR_D$ when load attached.
- Assuming $V_{DD}$ open because it's a supply; in AC it's ground if ideal.
- Assuming current source load is short/open incorrectly: ideal current source is open for AC (high impedance), not ground; but its terminal to fixed supply may be AC ground through source? Clarify: A current source connected from VDD to output: VDD is AC ground, current source incremental impedance from output to ground is infinite if ideal, so no shunt; real ro from output to ground.
- Shorting signal sources incorrectly: When measuring Rout, independent voltage sources short, current sources open, but dependent sources remain. If input signal source has internal resistance, keep it.
- Sign: common-source inverts. If source not grounded, $v_{gs}=v_g-v_s$, feedback changes sign/magnitude.
- Large-signal DC changes: adding Rx changes Q-point; must re-bias before small-signal.
- Probe/loading: scope 1MΩ/10-15pF can reduce high-frequency/high-impedance node gain.

Exam patterns:
- "Additional path appears at output" -> draw small-signal, replace other end with AC ground if fixed, compute parallel.
- "What really happens?" -> explain current division and reduced voltage swing.
- "Fixed voltage node?" -> ground.
- "Derive Av, Rin, Rout" -> use test source.
- "Multi-stage gain" -> multiply intrinsic gains with voltage divider factors.

Need maybe include "Rin, Rout definitions" formulas:
$$R_{in} = \left.\frac{v_x}{i_x}\right|_{\text{input test, independent sources off}}$$
$$R_{out} = \left.\frac{v_x}{i_x}\right|_{\text{output test, input source off}}$$
For CS with gate bias: $R_{in}\approx R_G$ (or $R_1||R_2$); MOS gate DC infinite. With source degeneration, input resistance at gate remains high (unless bias), but output resistance increases. For common-drain etc.

Need maybe include "Resistance seen from input" from transcript: maybe $R_x = V_in/I_x$? But not clear. We can keep general.

Need maybe include "Output stage affected? Suppose Vin increased small amount results Vout decrease. We saw similar situation before! Path is added and output voltage magnitude degraded." Use in Q.

Need maybe include "Can you repeat what really happens" with current provided from additional part, original part, total. We can phrase: When output node voltage tries to change, additional path sources/sinks current opposing change. If output node falls, current through path changes in direction that supplies part of the increased NMOS drain current, so original RD has to change less current, hence less voltage drop change. This is like loading.

Need maybe discuss "additional path current can be from a PMOS current source or next stage". If Vin increases, NMOS pulls more current, output falls. The extra path (e.g., resistor to VDD) then provides more current due to increased voltage across it? Actually if output falls, resistor to VDD has larger voltage drop, so current through it increases, helping supply the extra NMOS current. Thus RD current change less? Wait RD is also resistor to VDD. If extra path is another resistor to VDD, total pull-up conductance bigger. For same NMOS current increase, output only needs to fall enough for the combined pull-up resistors to increase current by that amount. So smaller fall. Good.

Need include "병렬 저항: 같은 전압이 걸리므로 전류는 저항에 반비례".

Potential issue: In small-signal, if $R_x$ is from output to ground, then output resistance lower. If $R_x$ is from output to $V_{DD}$, VDD AC ground. If to another supply, ground. If to a node with signal $v_y$, current is $(v_o-v_y)/R_x$; then not just parallel; can produce feedback or feedthrough.

Need maybe include "effective voltage transfer ratio changed by Rin/(Rin+Rout)" from slides. Use formula.

Need maybe include "Gain is not everything. Rin and Rout matter significantly." Good.

Need maybe include "Multiple Stage Gain" formula. Use:
$$A_{v,total} = A_{v1}^{(oc)} \frac{R_{in2}}{R_{in2}+R_{out1}} A_{v2}^{(oc)} \frac{R_{in3}}{R_{in3}+R_{out2}} A_{v3}^{(oc)} \frac{R_L}{R_L+R_{out3}}$$
if final load. Maybe include source resistance factor at input: $v_{in1}=v_s R_{in1}/(R_{in1}+R_s)$. Good.

Need maybe include "CS amplifier with ideal current source" question:
- Role of current source is bias. In small-signal, ideal current source has infinite impedance, so if it replaces RD as load, the small-signal load resistance becomes very large; gain ideally very large, practically limited by $r_o$ of transistor and current source. If current source is connected to fixed supply, the supply end is AC ground, but the current source itself is not a short; it is an open/incremental high resistance.
- PMOS current source load: if gate bias fixed and source at VDD AC ground, $v_{sg}=0$ small-signal, so no $g_m$ current; only $r_{op}$ from drain to source. So load is $r_{op}$.

Need maybe include "Diode-connected load" because slides. Derive resistance seen from source? Actually slide says "resistance of M2 seen from source" maybe for source follower? But diode-connected load usually from drain. We can derive general. For diode-connected MOS (gate tied to drain), looking into drain (or source if source is output? Need be careful). In a CS with diode-connected PMOS load, load resistance at output is $1/g_{m2}$ parallel $r_{o2}$. If asked "seen from source" of diode-connected device? For a diode-connected transistor with gate and drain tied to a fixed node, looking into source gives $1/g_m$ maybe? Actually source follower output resistance looking into source with gate/drain AC ground is $1/g_m$ (if body effect ignored). Slide has equations: $R_x = V_x/I_x$, $-g_m V_x = -I_x$, $V_o = I_x? $ maybe. Could be deriving source resistance of diode-connected load? Let's parse OCR: "CS Stage w/ Diode-Connected Load • Can you derive the resistance of M2 seen from source? [그림] VDD / V_out / M2 / M1 / Vin_o / Vo (from Diagram) / Rx (from Diagram) = 1/ gm ... -V_x = íx ... V_o = íx ... gm_o = í ... V_x = íx + V_output ... ΔV_x ≈ ΔV_o ..." Hmm maybe they derive small-signal resistance looking into source of a diode-connected transistor is 1/gm. But in a diode-connected load (gate/drain to VDD?), if PMOS gate and drain connected? Wait CS stage with diode-connected load: PMOS M2 gate and drain connected to output? Actually diode-connected PMOS load has gate and drain tied together at output, source to VDD. Then looking into drain (output) from node to VDD gives 1/gm. If "seen from source" maybe source is output? Maybe not. But standard result: diode-connected MOS small-signal resistance between drain/source (with gate tied to one terminal) is 1/gm (if ro ignored). We'll state both: looking into drain/source of diode-connected device with the other terminal AC ground yields ~1/gm. Use generic test derivation: if gate and drain shorted and source is test node? Let's not overcomplicate. State: A MOS with gate and drain shorted behaves as a resistor of approximately $1/g_m$ between the shorted node and source (or between source and shorted node, depending on which terminal is output), ignoring body effect and $r_o$. Include ro: $1/(g_m+g_{mb}+1/r_o)$ if body effect. For PMOS load, load resistance $\approx 1/g_{m2}$.

Need maybe include "Degeneration output resistance example with M1 and M2 identical" maybe not necessary. But to be complete, include formula for output resistance with source degeneration:
Looking into drain of transistor with source resistance $R_S$ and $r_o$:
$$R_{out} \approx r_o \left(1+g_m R_S\right) + R_S$$
if $g_m r_o \gg1$, or more exact $R_{out}=r_o + R_S + g_m r_o R_S$ (assuming body effect ignored and gate AC ground). If there is degeneration transistor M2 etc. For CS stage with degeneration and load $R_D$, output node includes $R_D$ in parallel with this. If M1/M2 identical maybe $R_{out}\approx 2r_o + ...$? Not enough. Could mention test-source method rather than exact example.

Need ensure no false statements. For source degeneration output resistance exact with gate grounded: apply vx at drain, source voltage vs = ix? Let's derive: MOS small-signal with ro, gm vgs, source resistor RS to ground, gate AC ground. Test voltage vx at drain, current ix entering drain. vgs = -vs. KCL at source: current through RS = vs/RS leaving source to ground. Currents entering source from ro and dependent? Need signs. Standard result looking into drain: $R_{out}=r_o + (1+g_m r_o)R_S$ (if body effect ignored). Yes = r_o + R_S + g_m r_o R_S. Good. If $R_S=0$, ro. If ro∞ and RS? infinite? With ideal current source? okay. If $R_D$ present, total Rout = R_D || that. For λ=0, ro∞? Actually if λ=0, looking into drain of ideal MOS with source resistor is infinite? In simple model current source controlled by vgs; if gate grounded and source resistor, applying vx doesn't change id? Let's see λ=0, ro open, dependent source current = gm vgs = -gm vs. Source node current from dependent source enters? KCL gives vs? If no ro, drain current independent of drain voltage, so output resistance infinite if source resistor? But in common-source with source degeneration and finite RD, output resistance at drain node includes RD; transistor itself high. However if source bypass? infinite. But in practical with ro finite, increased. The lecture says "Output Resistance? When λ=0, it is simple. But what if λ≠0?" likely when λ=0 Rout=R_D maybe. If looking from output including RD, yes Rout=R_D because transistor drain looks open (current source). With λ≠0, ro in parallel; with degeneration ro boosted. We can state.

Need maybe include "CS Amp w/ Ideal Current Source" gain: If load is ideal current source, incremental load infinite, so gain infinite in ideal model; with ro, $A_v=-g_m r_o$ (or -gm(roN||roP)). If PMOS current source, output resistance of PMOS current source is $r_{op}$, NMOS output resistance $r_{on}$, gain $-g_{mn}(r_{on}||r_{op})$. If source degeneration, effective gm lower.

Need maybe include "Input resistance/output resistance measured by test source" in math.

Need maybe include "Fixed voltage node ground" with examples: 3.3V, 3.9V, 4.5V, 6V all AC ground if ideal. The slide has currents with different supplies and resistors maybe showing added parallel paths. We can say any fixed bias node is AC ground; resistors connected to those nodes become connected to ground in AC.

Need maybe include "Additional path reduces voltage change" intuitive with conductance. Maybe use Norton equivalent: transistor small-signal is current source $g_m v_{in}$ in parallel with output conductance. Load is resistance. Output voltage = current × resistance. Adding path increases conductance, reduces resistance. This is central.

Need maybe include "what really happens" in large signal: Suppose Vin increases, NMOS current increases. Without extra path, extra current must come through RD, causing larger voltage drop across RD and lowering Vout. With extra path, some extra current comes from/through extra path, so RD current changes less, voltage drop changes less, Vout changes less. Therefore gain lower. Good.

Need maybe include mathematical derivation of current division in large signal? For resistor to VDD: $I_{RD}=(VDD-Vout)/RD$, $I_{Rx}=(V_{fixed}-Vout)/Rx$. KCL at output: $I_D=I_{RD}+I_{Rx}$ (depending directions). Differentiate:
$$dI_D = -dVout(1/R_D+1/R_x)$$? Let's derive signs: If NMOS drain current increases (positive dID), output voltage decreases (dVout negative). Current through RD from VDD to node = (VDD-Vout)/RD. Its incremental change dI_RD = -dVout/RD (positive if Vout falls). Extra path similarly. KCL: dI_D = dI_RD + dI_Rx = -dVout(1/RD+1/Rx). Thus $dVout = -dI_D /(1/RD+1/Rx)= -g_m dVin (RD||Rx)$. This is a nice large-signal differentiation bridging. Include.

Need maybe include sign conventions clearly.

Need maybe include table for currents with sign? Use magnitudes to avoid confusion.

Need maybe mention "소신호 선형화 근사 오차" formula with $V_{OV}$. For square-law:
$$\frac{\Delta I_{D,exact}-g_m\Delta v}{g_m\Delta v}=\frac{\Delta v}{2V_{OV}}$$ for positive change. If $V_{OV}=0.2V$, ∆=20mV, error 5%; if ∆=2mV, 0.5%. This helps. But if using numbers gm=2.5mS, ID=1mA

---

### [Gemini 3.1 Flash-Lite] (google/gemini-3.1-flash-lite)

*소요 시간: 6.8초 / 생성 분량: 3084자*

본 노트는 MOSFET 증폭기 회로의 동작 원리, 소신호 모델의 핵심 개념, 그리고 회로 설계 시 발생하는 이득 저하 현상에 대한 심층 분석을 담고 있습니다.

---

## 1. 핵심적인 질문 던지기 (Key Conceptual Questions & Deep Dives)

### Q1. 출력단에 추가 경로(Additional Path, $R_x$)가 생기면 왜 전압 이득이 감소하는가?
*   **직관적 답변:** 전류의 분기(Current Division) 때문입니다. 트랜지스터(MOSFET)가 전압 제어 전류원으로서 일정한 전류 변화($\Delta I_D$)를 생성할 때, 이 전류가 부하 저항($R_D$)으로만 흘러야 전압 변동폭($\Delta V_{out} = \Delta I_D \times R_D$)이 최대가 됩니다. 하지만 병렬로 $R_x$와 같은 추가 경로가 생기면, $\Delta I_D$가 두 경로로 나누어져 흐르게 되어 $R_D$에 흐르는 전류가 줄어들고, 결과적으로 출력 전압 변동폭이 작아져 이득이 감소합니다.
*   **수학적 관점:** 합성 저항이 $R_D \parallel R_x$가 되며, $R_D \parallel R_x < R_D$이므로 전체 이득 $A_v = -g_m(R_D \parallel R_x)$의 크기는 감소합니다.

### Q2. 왜 고정 DC 전압원(예: 3.3V, 5V)은 소신호 모델에서 접지(AC Ground)로 취급되는가?
*   **직관적 답변:** 소신호 해석은 "변화량($\Delta$)"에만 집중하기 때문입니다. 고정된 DC 전압원은 일정한 전위를 유지하므로, 아주 작은 AC 신호가 입력되어도 그 전위는 변하지 않습니다($\Delta V_{DC} = 0$). 변화량이 0이라는 것은 전위 차이가 없다는 뜻이므로, AC 관점에서는 회로의 기준점인 접지와 동일한 상태(등전위)로 간주하는 것입니다.

### Q3. 대신호(Large Signal)와 소신호(Small Signal) 해석의 괴리는 무엇인가?
*   **해석의 차이:** 대신호 해석은 트랜지스터의 비선형 특성(제곱 법칙 등)을 그대로 고려하며, 입력 전압의 변화가 클 때 사용합니다. 반면, 소신호 해석은 특정 동작점(Q-point) 근처에서 트랜지스터 특성 곡선을 **선형(Linear)**으로 근사하여 해석합니다. 이 과정에서 $\Delta V_{GS}$가 충분히 작아야만 선형 근사가 유효하며, 입력이 커질수록 비선형성에 의해 소신호 모델로 예측한 결과와 실제 값 사이에 오차가 발생합니다.

---

## 2. 수식 제시 및 수학적 유도 (Mathematical Formulations)

### 소신호 이득 유도
MOSFET 증폭기의 드레인 전류 변화량 $\Delta I_D$는 트랜스컨덕턴스 $g_m$과 입력 전압 변화 $v_{in}$의 곱으로 정의됩니다.
$$\Delta I_D = g_m \cdot v_{in}$$
출력 노드에서 저항 $R_D$와 $R_x$가 병렬로 연결된 경우, 출력 전압 변화 $v_{out}$은 옴의 법칙에 의해 다음과 같습니다.
$$v_{out} = -\Delta I_D \cdot (R_D \parallel R_x) = -g_m (R_D \parallel R_x) v_{in}$$
따라서 전압 이득 $A_v$는 다음과 같이 도출됩니다.
$$A_v = \frac{v_{out}}{v_{in}} = -g_m (R_D \parallel R_x)$$

### 실제 수치 대입 예시
*   **조건:** $R_D = 2\text{k}\Omega$, $V_{in}$ 변화 $20\text{mV}$, $g_m \approx 2.5\text{mS}$
*   **이상적(단일 경로):** $\Delta V_{out} = - (2.5\text{mS} \times 20\text{mV}) \times 2\text{k}\Omega = -100\text{mV}$
*   **추가 경로($R_x = 2\text{k}\Omega$ 시):** $R_{eq} = 2\text{k} \parallel 2\text{k} = 1\text{k}\Omega$
*   **결과:** $\Delta V_{out} = - (2.5\text{mS} \times 20\text{mV}) \times 1\text{k}\Omega = -50\text{mV}$
    *   **분석:** 추가 경로에 의해 출력 전압 변화폭이 절반으로 줄어들었음을 확인할 수 있습니다.

---

## 3. 실전 회로 설계에서의 활용법 (Practical Applications)

### 이득 저하를 막기 위한 버퍼링 전략
*   **임피던스 분리:** 출력 노드에 부하(Load)가 연결되어 이득이 떨어지는 것을 방지하려면, **소스 팔로워(Source Follower, 공통 드레인)** 구조를 버퍼로 삽입하십시오. 이 버퍼는 출력 임피던스를 낮춰 다음 단으로 신호를 잘 전달하면서도, 앞단의 이득 소자에는 높은 부하 저항 효과를 제공합니다.

### 소신호 등가회로 해석 실전 팁
1.  **DC 전압원은 모두 접지로 전환:** 회로를 그리기 전 $V_{DD}$를 접지로 바꾸는 과정을 먼저 수행하십시오.
2.  **노드 식별:** 입력, 출력, 소스 단자를 명확히 구분하고 $g_m v_{gs}$ 종속 전류원을 그립니다.
3.  **함정 주의(Pitfalls):**
    *   **채널 길이 변조($\lambda \neq 0$):** 단순 $g_m$ 모델만 사용하면 안 됩니다. 드레인-소스 사이에 출력 저항 $r_o$를 반드시 포함하여 계산하십시오.
    *   **병렬 경로 누락:** 설계 시 출력 노드에 연결된 모든 능동/수동 소자를 검토하십시오. 다른 단으로 넘어가는 입력 저항($R_{in}$)도 출력 노드 입장에서는 병렬로 연결된 저항($R_x$)으로 간주해야 합니다.

### 실전 설계 흐름
*   단계별 이득 계산 시 $A_{v,total} = A_{v1} \cdot A_{v2} \cdot A_{v3}$ 형태를 취하되, 각 단계 사이의 **부하 효과(Loading Effect)**를 반영하기 위해 각 단의 $R_{out}$과 다음 단의 $R_{in}$을 반드시 고려한 전압 분배 법칙($\frac{R_{in}}{R_{in}+R_{out}}$)을 이득 식에 포함해야 합니다.

---

### [Claude Haiku 4.5] (anthropic/claude-haiku-4.5)

*소요 시간: 59.5초 / 생성 분량: 12200자*

# MOSFET 증폭기 회로 학습 요약 노트

## 1. 핵심적인 질문 던지기 (Key Conceptual Questions & Deep Dives)

### 1.1 "왜 출력단에 추가 경로(Rx)가 생기면 전체 전압 이득이 감소하는가?"

#### 문제의 본질
기본 MOSFET 공통 소스(Common Source, CS) 증폭기에서 드레인 저항 $R_D$만 있을 때의 이득:
$$A_v = -g_m R_D$$

그런데 출력 노드에 추가 경로(예: 후단의 입력 저항 $R_x$)가 병렬로 연결되면, 실제 부하 임피던스가 변한다.

#### 직관적 설명

**전류 분배 관점:**
- 드레인 전류 $I_D$ 변화량이 $R_D$ 하나에만 떨어지지 않는다
- 추가 경로 $R_x$로도 일부 전류가 흘러간다
- 결과적으로 $R_D$ 양단의 전압 변화가 줄어든다

**구체적 수치 예시** (강의 자료 기반):
- 원래: $\Delta I_D = 50\text{ mA}$가 $R_D=2\text{k}\Omega$를 통해 흘러 $\Delta V = 100\text{ mV}$ 발생
- 추가 경로 후: 같은 $\Delta I_D$가 $R_D \parallel R_x$로 분산
  - 만약 $R_x = 2\text{k}\Omega$라면 병렬 저항은 $1\text{k}\Omega$
  - $\Delta V = 50\text{ mV}$ (50% 감소)

#### 병렬 저항의 원리

두 저항이 병렬 연결되었을 때:
$$R_{\text{eq}} = \frac{R_1 \cdot R_2}{R_1 + R_2} = \frac{1}{\frac{1}{R_1} + \frac{1}{R_2}}$$

**옴의 법칙 적용:**
$$V = I \cdot R_{\text{eq}} < I \cdot R_1 \quad \text{(if } R_2 \text{ exists)}$$

따라서:
$$|A_v| = g_m |R_D \parallel R_x| < g_m R_D$$

---

### 1.2 "소신호 모델(Small-Signal Model)에서 왜 DC 전압원(3.3V, 5V)은 AC 접지가 되는가?"

#### 문제의 핵심

강의에서 반복되는 개념:
> "고정 직류 전압 노드는 소신호 모델에서 그냥 접지일 뿐이다"

#### 수학적 근거

**시간 함수 분석:**
- 공급 전압: $V_{DD}(t) = 3.3 + v_{dd}(t)$
  - DC 성분: $V_{DD} = 3.3\text{ V}$ (상수)
  - AC 성분: $v_{dd}(t) = 0$ (이상적 전원)

**신호 분해:**
$$V_{DD}(t) = \underbrace{3.3}_{\text{DC}} + \underbrace{0}_{\text{AC}} = \text{상수}$$

**소신호 해석에서:**
- 미분 관점: $\frac{dV_{DD}}{dt} = 0$
- 즉, AC 성분 변화가 없으므로 동적 임피던스 = 0
- 임피던스 0인 노드는 AC 접지 역할

#### 실전 의미

**회로 분석 단계:**
1. **DC 해석**: $V_{DD} = 3.3\text{ V}$는 바이어스 조건 설정에 사용
2. **AC 해석**: $V_{DD}$ 노드를 그라운드로 취급
   - 예: 드레인에서 공급전 경로도 AC 접지로 보임

**예제 (강의 자료):**
$$V_{in} = 1.0\text{ V} \to 1.02\text{ V} \quad (\Delta V_{in} = +20\text{ mV})$$
$$V_{out} = 1.3\text{ V} \to 1.2\text{ V} \quad (\Delta V_{out} = -100\text{ mV})$$

AC 소신호 해석:
$$v_{in} = +20\text{ mV}, \quad v_{out} = -100\text{ mV}$$

$V_{DD}$는 이 AC 신호 계산에 명시적으로 나타나지 않음 (이미 DC 동작점에 포함됨)

---

### 1.3 "대신호(Large Signal) 해석과 소신호(Small Signal) 선형화 근사 사이의 괴리는 무엇인가?"

#### 근본 차이

**대신호 분석 (Nonlinear):**
$$I_D = \frac{1}{2}\mu_n C_{ox}\frac{W}{L}(V_{GS} - V_{TH})^2(1 + \lambda V_{DS})$$

**소신호 분석 (Linear Approximation):**
Taylor 급수 전개를 통해 선형화:
$$\Delta I_D = \frac{\partial I_D}{\partial V_{GS}}\Big|_{Q} \Delta V_{GS} + \frac{\partial I_D}{\partial V_{DS}}\Big|_{Q} \Delta V_{DS}$$
$$= g_m \cdot v_{gs} + \frac{1}{r_o} \cdot v_{ds}$$

#### 강의 예시를 통한 비교

| 항목 | 대신호 | 소신호 |
|------|--------|--------|
| 입력 변화 | $V_{in}: 1.0 \to 1.02\text{ V}$ | $v_{in} = +20\text{ mV}$ |
| 출력 변화 | $V_{out}: 1.3 \to 1.2\text{ V}$ | $v_{out} = -100\text{ mV}$ |
| 드레인 전류 변화 | $I_D: 1.0 \to 1.05\text{ mA}$ | $\Delta I_D = +50\text{ μA}$ |
| 이득 | $\frac{\Delta V_{out}}{\Delta V_{in}} = \frac{-100\text{ mV}}{+20\text{ mV}} = -5$ | $A_v = -g_m R_D$ (선형) |

#### 괴리 발생 원인

**1) 채널 길이 변조 (Channel Length Modulation):**

대신호 드레인 전류 방정식:
$$I_D = \frac{1}{2}\mu_n C_{ox}\frac{W}{L}(V_{GS} - V_{TH})^2 \cdot \underbrace{(1 + \lambda V_{DS})}_{\text{중요}}$$

$\lambda \neq 0$이면 $V_{DS}$ 변화가 $I_D$에도 영향:
- $V_{DS}$ ↓ $\Rightarrow$ $(1 + \lambda V_{DS})$ ↓ $\Rightarrow$ $I_D$ ↓
- 입력이 증가해도 출력이 감소하면서 추가 전류 감소 효과 발생

**강의에서의 표현:**
> "원래 50mA가 공급되었다면, 이제 40mA만 공급되는 것 같다."

이는 $\lambda \neq 0$ 효과를 설명한 것.

**2) 비선형성의 누적:**
- 대신호: 실제 포물선(quadratic) 관계
- 소신호: 동작점 주변 직선 근사
- 입력 변화가 작을 때만 근사 오차 < 5%

---

## 2. 수식 제시 및 수학적 유도 (Mathematical Formulations & Derivations)

### 2.1 소신호 전압 이득 유도 (Without Additional Path)

#### 회로 구성
- 공통 소스 증폭기 (CS Amplifier)
- 드레인 저항: $R_D$
- 로드 임피던스: 없음 (또는 무한대)

#### 소신호 등가회로 분석

MOSFET 소신호 모델 (채널 길이 변조 무시, $\lambda = 0$):
- **트랜스컨덕턴스 소스**: $g_m v_{gs}$ (드레인-소스 간)
- **동적 저항**: 무시 ($\lambda = 0$)

#### 노드 분석

출력 노드 (드레인):
$$v_{out} = -(g_m v_{gs}) \cdot R_D$$

입력-게이트 관계 (소스 접지):
$$v_{gs} = v_{in}$$

#### 최종 이득 공식

$$\boxed{A_v = \frac{v_{out}}{v_{in}} = -g_m R_D}$$

**부호 해석:**
- 음수: 180° 위상 역전
- 크기: $|A_v| = g_m R_D$에 비례

---

### 2.2 추가 경로(Rx)로 인한 이득 감소 유도

#### 회로 구성
드레인 노드에 $R_x$(후단 입력 저항)가 병렬 연결:

```
      VDD
       |
      RD
       |
    +--+--+---- Vout
    |     |
   M1   Rx (후단 입력 저항)
    |     |
   GND   GND
```

#### 병렬 임피던스 계산

출력 노드에서 본 부하:
$$R_{\text{load}} = R_D \parallel R_x = \frac{R_D \cdot R_x}{R_D + R_x}$$

#### 개선된 이득 공식

$$v_{out} = -(g_m v_{gs}) \cdot (R_D \parallel R_x)$$

$$\boxed{A_v' = \frac{v_{out}}{v_{in}} = -g_m (R_D \parallel R_x)}$$

#### 이득 감소 비율

$$\frac{A_v'}{A_v} = \frac{R_D \parallel R_x}{R_D} = \frac{R_x}{R_D + R_x}$$

**특수 경우:**
- $R_x = R_D$이면: $\frac{A_v'}{A_v} = \frac{1}{2}$ (50% 감소)
- $R_x \gg R_D$이면: $\frac{A_v'}{A_v} \approx 1$ (거의 영향 없음)
- $R_x \ll R_D$이면: $\frac{A_v'}{A_v} \approx 0$ (거의 모두 소실)

#### 강의 수치 적용

**주어진 조건:**
- $R_D = 2\text{ k}\Omega$
- $R_x = 10\text{ k}\Omega$ (또는 다른 값)
- $I_D = 1\text{ mA}$ (동작점)

**트랜스컨덕턴스 추정:**
$$g_m = \sqrt{2\mu_n C_{ox}\frac{W}{L}I_D}$$

예를 들어 $g_m = 50\text{ mS}$라 하면:
- 원래 이득: $A_v = -50\text{ mS} \times 2\text{ k}\Omega = -100$
- 추가 경로 후: $R_{\text{load}} = \frac{2k \times 10k}{2k + 10k} = \frac{20k}{12k} = 1.67\text{ k}\Omega$
- 새로운 이득: $A_v' = -50\text{ mS} \times 1.67\text{ k}\Omega = -83.5$

**이득 감소: $\frac{83.5}{100} = 83.5\%$ (약 16.5% 감소)**

---

### 2.3 채널 길이 변조(Channel Length Modulation) 포함 시 이득 수정

#### 대신호 드레인 전류 방정식 ($\lambda \neq 0$)

포화 영역에서:
$$I_D = \frac{1}{2}\mu_n C_{ox}\frac{W}{L}(V_{GS} - V_{TH})^2(1 + \lambda V_{DS})$$

#### 선형화 분해

전개:
$$I_D = \underbrace{\frac{1}{2}\mu_n C_{ox}\frac{W}{L}(V_{GS} - V_{TH})^2}_{I_{D0}} + \underbrace{\lambda \cdot \frac{1}{2}\mu_n C_{ox}\frac{W}{L}(V_{GS} - V_{TH})^2}_{계수} \cdot V_{DS}$$

$$I_D = I_{D0} + \underbrace{\frac{\lambda I_{D0}}{1}}_{\text{기울기}} \cdot V_{DS}$$

**저항 형태로:**
$$I_D = I_{D0} + \frac{V_{DS}}{r_o}$$

여기서 **출력 저항(output resistance)**:
$$\boxed{r_o = \frac{1}{\lambda I_{D0}} = \frac{V_A}{I_D}}$$

$V_A$: Early Voltage (= $1/\lambda$)

#### 소신호 모델 ($\lambda \neq 0$인 경우)

MOSFET 소신호 모델:
- 드레인에서: $g_m v_{gs}$ (입력 제어 전류원)
- **동시에**: $r_o$ (드레인-소스 간 병렬 저항)

#### 수정된 이득 (추가 경로 없음)

드레인 노드 임피던스:
$$Z_D = R_D \parallel r_o = \frac{R_D \cdot r_o}{R_D + r_o}$$

$$\boxed{A_v = -g_m (R_D \parallel r_o)}$$

#### 수정된 이득 (추가 경로 $R_x$ 포함)

삼중 병렬:
$$Z_{\text{eff}} = R_D \parallel r_o \parallel R_x$$

$$\boxed{A_v'' = -g_m (R_D \parallel r_o \parallel R_x)}$$

#### 강의 예시 계산

**가정:**
- $V_{DD} = 3.3\text{ V}$
- $R_D = 2\text{ k}\Omega$
- $I_D = 1\text{ mA}$
- $\lambda = 0.05\text{ V}^{-1}$ (일반적 90nm 공정)
- $V_A = \frac{1}{\lambda} = 20\text{ V}$

**출력 저항:**
$$r_o = \frac{V_A}{I_D} = \frac{20}{1\text{ mA}} = 20\text{ k}\Omega$$

**이득 (λ = 0):**
$$A_v = -g_m \times R_D = -50\text{ mS} \times 2\text{ k}\Omega = -100$$

**이득 (λ ≠ 0):**
$$R_{\text{eq}} = R_D \parallel r_o = \frac{2k \times 20k}{2k + 20k} = \frac{40k}{22k} = 1.82\text{ k}\Omega$$
$$A_v = -50\text{ mS} \times 1.82\text{ k}\Omega = -91$$

**채널 길이 변조 효과: 약 9% 이득 감소**

---

### 2.4 병렬 저항 합성 공식 및 현재 분배

#### 기본 병렬 저항 공식

$n$개 저항 병렬:
$$\frac{1}{R_{\text{eq}}} = \sum_{i=1}^{n} \frac{1}{R_i}$$

**2개 저항:**
$$R_{\text{eq}} = \frac{R_1 R_2}{R_1 + R_2}$$

#### 전류 분배 (분압 역 관계)

두 저항 $R_1, R_2$가 병렬, 총 전류 $I_{\text{tot}}$:

$$I_1 = \frac{R_2}{R_1 + R_2} \cdot I_{\text{tot}}$$

$$I_2 = \frac{R_1}{R_1 + R_2} \cdot I_{\text{tot}}$$

**중요:** 저항이 작은 분지에 더 많은 전류 흐름

#### 강의 예시 (병렬 저항 기초 검토)

**주어진 조건:**
- 두 저항: $R_1 = 5\text{ k}\Omega, R_2 = 4\text{ k}\Omega$
- 인가 전압: $V = 5\text{ V}$

**등가 저항:**
$$R_{\text{eq}} = \frac{5k \times 4k}{5k + 4k} = \frac{20k}{9k} \approx 2.22\text{ k}\Omega$$

**총 전류:**
$$I_{\text{tot}} = \frac{V}{R_{\text{eq}}} = \frac{5}{2.22k} = 2.25\text{ mA}$$

**분지 전류:**
$$I_1 = \frac{V}{R_1} = \frac{5}{5k} = 1\text{ mA}$$
$$I_2 = \frac{V}{R_2} = \frac{5}{4k} = 1.25\text{ mA}$$

**검증:** $I_1 + I_2 = 1 + 1.25 = 2.25\text{ mA} = I_{\text{tot}}$ ✓

---

### 2.5 소신호 vs 대신호 분석 대조

#### 대신호 전체 계산 예

**주어진 조건:**
$$V_{DD} = 3.3\text{ V}, \quad R_D = 2\text{ k}\Omega$$

**동작점 (DC):**
$$V_{in,DC} = 1.0\text{ V}$$

MOSFET 특성 (포화):
$$I_D = \frac{1}{2}\mu_n C_{ox}\frac{W}{L}(V_{GS} - V_{TH})^2$$

가정: 트랜지스터가 설계되어 $I_{D,DC} = 1\text{ mA}$일 때 $V_{GS,DC} = 1.0\text{ V}$

$$V_{out,DC} = V_{DD} - I_D \cdot R_D = 3.3 - 1.0\text{ mA} \times 2\text{ k}\Omega = 3.3 - 2.0 = 1.3\text{ V}$$

**입력 신호 인가 (AC + DC):**
$$V_{in}(t) = 1.0 + 0.02\cos(\omega t) \text{ V}$$

**$t=0^+$ (신호 최대값):**
$$V_{in} = 1.02\text{ V} \Rightarrow V_{GS} = 1.02\text{ V}$$

**새로운 드레인 전류 (보존을 위해 $\mu_n C_{ox}\frac{W}{L}$항 동일하다고 가정):**

$I_D \propto (V_{GS} - V_{TH})^2$ 형태이고, 
- $\Delta V_{GS} = +0.02\text{ V}$
- 동작점 $V_{GS} = 1.0\text{ V}$

근사적으로:
$$\Delta I_D \approx g_m \cdot \Delta V_{GS}$$

$g_m$을 구하려면:
$$g_m = \frac{\partial I_D}{\partial V_{GS}}\bigg|_{Q} = \mu_n C_{ox}\frac{W}{L}(V_{GS,DC} - V_{TH})$$

가정: $V_{GS,DC} - V_{TH} = 0.2\text{ V}$ (과드라이브 전압)

$$\Delta I_D = g_m \times 0.02$$

실제 강의 수치 ($I_D: 1.0 \to 1.05\text{ mA}$):
$$\Delta I_D = 0.05\text{ mA} = 50\text{ μA}$$

$$g_m = \frac{50\text{ μA}}{20\text{ mV}} = 2.5\text{ mS}$$

**출력 전압 변화:**
$$\Delta V_{out} = -\Delta I_D \times R_D = -50\text{ μA} \times 2\text{ k}\Omega = -100\text{ mV}$$

$$V_{out}(신호\text{ 최대}) = 1.3 - 0.1 = 1.2\text{ V}$$

**대신호 이득:**
$$A_{v,\text{large}} = \frac{\Delta V_{out}}{\Delta V_{in}} = \frac{-100\text{ mV}}{+20\text{ mV}} = -5 \text{ V/V}$$

#### 소신호 계산

**소신호 모델:**
$$A_v = -g_m R_D = -2.5\text{ mS} \times 2\text{ k}\Omega = -5 \text{ V/V}$$

**결과:**
$$v_{out} = -5 \times v_{in} = -5 \times 20\text{ mV} = -100\text{ mV}$$

#### 대조 및 해석

| 항목 | 대신호 | 소신호 |
|------|--------|--------|
| 입력 신호 크기 | ±20 mV | ±20 mV (정의상 작음) |
| 이득 계산 | 전체 비선형 방정식 | 선형 미분 근사 |
| 결과 | $A_v = -5$ | $A_v = -5$ |
| 일치도 | ✓ 완벽 일치 |
| 이유 | 신호가 충분히 작아서 비선형성 무시 가능 |

**만약 입력이 크다면?**
$$V_{in} = 1.0 + 0.1\cos(\omega t) \text{ V} \quad (±100\text{ mV})$$

대신호: 비선형 포물선 특성으로 인해 결과 왜곡
소신호: 여전히 선형 근사 (오류 발생)

---

## 3. 실전 회로 설계에서의 활용법 (Practical Applications & Engineering Takeaways)

### 3.1 이득 저하를 막기 위한 임피던스 분리 전략

#### 문제 상황

**회로 연결 시나리오:**
```
[Amplifier A] ─── [Amplifier B]
    Rout           Rin
   (출력)    Vout  (입력)
```

A의 출력이 B의 입력으로 직결되면, A의 이득이 $R_{out}$ 때문에 감소:

$$V_{B,\text{actual}} = V_{A} \times \frac{R_{in}}{R_{out} + R_{in}}$$

#### 해결 전략 1: 버퍼 증폭기 삽입

**아이디어:** 높은 입력 저항, 낮은 출력 저항을 가진 중간 단계 추가

```
[Amp A] ─── [Buffer] ─── [Amp B]
Rout₁     Rout_buf   Rin₂
(낮음)    (높은 Rin)  (낮음)
         (낮은 Rout)
```

**버퍼 특징:**
- 입력 저항 $R_{in,buf} \gg R_{out,A}$ → A의 이득 보호
- 출력 저항 $R_{out,buf} \ll R_{in,B}$ → B는 거의 최대 이득 달성

**실전 예:**
- MOSFET 공통 드레인(CD) 또는 이미터 팔로워(Emitter Follower)
- 이득: ~1 V/V (이득 손실 없음)
- 높은 입력 저항, 낮은 출력 저항

#### 해결 전략 2: 임피던스 정합 (Impedance Matching)

**조건:**
$$R_{out,A} = R_{in,B}$$

**효과:**
- 전력 전달 최대화 (단, 전압 전달은 50% → 실제 설계에서는 차선책)
- RF/마이크로파에서 중요

#### 해결 전략 3: CS 증폭기에 카스코드(Cascode) 구성

**구조:**
```
      VDD
       |
      RD  ← 출력 부하
       |
   [M1 (CS)]  ← 신호 증폭
       |
   [M2 (CG)]  ← 출력 임피던스 증가
       |
      GND
```

**효과:**
- M2가 중간 버퍼 역할
- M1의 효과적 출력 저항 증대
- 외부 부하 변화에 덜 민감

**이득 향상:**
$$A_v = -g_{m1}(R_D \parallel r_{o1} \parallel (r_{o2} + R_D)) \approx -g_{m1} \times R_D$$

(조건: $r_{o2} \gg R_D$이면 이득 향상)

---

### 3.2 소신호 등가회로를 빠르게 그려서 해석하는 실전 팁

#### 단계 1: 회로 간략화 (Simplification)

**DC 성분 제거:**
- 모든 DC 전원(VDD, GND)을 그대로 유지 (위치 기준점으로)
- **모든 DC 전압원은 AC 단락**(short)으로 취급
- 예: 3.3V 소스는 AC 관점에서 그라운드

**원본 회로:**
```
        VDD(AC접지)
         |
        RD
         |
      +--+--+
      |  M  |---- Vout
  Vin-+G    D
      | |
      +--+
        |
       GND
```

**AC 등가회로:**
```
         0 (AC접지)
         |
        RD
         |
      +--+--+
      |  M  |---- vout
  vin-+G    D
      | |  gm·vgs
      +--+
        |
        0 (GND)
```

#### 단계 2: MOSFET 소신호 모델 치환

**MOSFET 소신호 모델:**

```
  게이트     드레인
    |         |
    v_gs      +--[r_o]---+
    |         |           |
    +----g_m·v_gs         |
         |                |
       소스               |
         |
        GND
```

**$\lambda = 0$인 경우 (간단함):**
```
  게이트
    |
    v_gs
    |
    +----g_m·v_gs ──┬──> (드레인)
         |          |
       소스         GND
         |
        GND
```

#### 단계 3: 노드 분석 (Nodal Analysis)

**기본 방정식:**
$$v_{out} = I_D \times R_D$$

**전류 KCL (드레인 노드):**
$$g_m v_{gs} = \frac{v_{out}}{R_D}$$

**입력-게이트 관계 (소스 연결된 경우):**
$$v_{gs} = v_{in}$$

**결과:**
$$A_v = \frac{v_{out}}{v_{in}} = -g_m R_D$$

#### 실전 예제 1: CS 증폭기 (저항 부하)

**원본 회로:**
```
      VDD = 5V
         |
        10k (RD)
         |

---

### [Claude Sonnet 5] (anthropic/claude-sonnet-5)

*소요 시간: 76.5초 / 생성 분량: 8572자*

# MOSFET 증폭기 회로: 추가 경로에 의한 이득 감소와 소신호 모델링 완전 정리

---

## 1. 핵심적인 질문 던지기 (Key Conceptual Questions & Deep Dives)

### Q1. 왜 출력단에 추가 경로(Additional Path, $R_x$)가 생기면 전체 전압 이득(Gain)이 감소하는가?

**직관적 이해:**
원래 회로에서는 MOSFET이 만들어내는 신호 전류 $g_m v_{in}$이 전부 $R_D$ 한 곳으로만 흘러가서 전압 변화를 만들었다. 그런데 출력 노드에 $R_x$라는 새로운 경로가 추가되면, 같은 전류가 **두 개의 경로로 분배(current splitting)**된다.

- 원래: $\Delta I_D$가 전부 $R_D$를 통해 흐름 → $\Delta V_{out} = -\Delta I_D \cdot R_D$
- 이후: $\Delta I_D$가 $R_D$와 $R_x$로 나뉘어 흐름 → $R_D$로 흐르는 전류가 줄어듦 → $\Delta V_{out}$의 크기가 작아짐

즉, "전류원이 봐야 하는 부하 저항"이 $R_D$에서 $R_D \parallel R_x$로 줄어들기 때문에, 같은 전류를 흘려도 만들어지는 전압 변화(=이득)가 줄어드는 것이다. 이는 옴의 법칙 $V=IR$에서 $R$이 작아지면 $V$가 작아지는 것과 동일한 원리다.

**강의에서 제시된 수치 예시:**
- 원래 $R_D$만 있을 때: $\Delta I_D = 50\mu A$의 변화로 특정 $\Delta V_{out}$ 발생
- $R_x$ 경로 추가 후: 같은 $\Delta V_{gs}$에 대해 $R_D$ 쪽으로는 $40\mu A$만 흐르게 되어 $\Delta V_{out}$이 더 작아짐 (Voltage drop이 "덜" 발생)

---

### Q2. 소신호 모델(Small-Signal Model)에서 왜 3.3V, 5V 같은 고정 직류 전압원(DC Node)은 접지(AC Ground)로 취급되는가?

**핵심 원리: 소신호 = 미분(변화량) 개념**

소신호 해석은 DC 동작점(bias point) 근처에서의 **작은 변화(variation)**만을 다룬다. $V_{DD}=3.3\text{V}$는 시간에 대해 **절대 변하지 않는 고정값**이므로:

$$\Delta V_{DD} = 0$$

소신호 모델은 오직 "변화량"만 추적하는 선형화된 모델이기 때문에, 변화가 0인 노드는 회로적으로 **AC 신호 관점에서 접지와 동일**하게 취급된다. 즉:

$$v_{DD,ac} = \frac{\partial V_{DD}}{\partial t} = 0 \;\Rightarrow\; \text{AC ground}$$

**흔한 오해 주의:** 이것은 DC 전위가 0V라는 뜻이 아니다. DC 관점에서는 여전히 3.3V가 걸려 있다. 다만 **AC(소신호) 관점에서만** 이 노드는 흔들리지 않는 기준점, 즉 접지처럼 작동한다는 것이다. 이 개념이 없으면 회로에 존재하는 여러 DC 바이어스 노드($V_{DD}$, $V_B$ 등)를 소신호 등가회로로 그릴 때 큰 혼란을 겪는다.

---

### Q3. 대신호(Large Signal)의 실제 전압/전류 변화와 소신호 선형화 근사 사이에는 어떤 괴리가 있는가?

강의 슬라이드의 핵심 수치 비교(Small Signal Model vs. What Really Happens):

| 항목 | 대신호(실제) | 소신호(근사) |
|---|---|---|
| $V_{in}$ | $1\text{V} \to 1.02\text{V}$ (실제 20mV 증가) | $\Delta v_{in}=20\text{mV}$ |
| $I_D$ | $1\text{mA} \to 1.05\text{mA}$ | $\Delta I_D = g_m \Delta v_{in}$ |
| $V_{out}$ | $1.3\text{V} \to 1.2\text{V}$ | $\Delta v_{out} = -g_m R_D \Delta v_{in}$ |

**괴리의 본질:**
- 대신호에서는 $I_D = \frac{1}{2}\mu C_{ox}\frac{W}{L}(V_{GS}-V_{TH})^2$라는 **비선형(제곱) 관계**를 그대로 따른다. 따라서 $\Delta V_{in}$이 커지면 $\Delta I_D$는 정확히 비례하지 않는다.
- 소신호 모델은 이 비선형 곡선을 동작점에서 **접선(1차 미분, $g_m$)으로 근사**한 것이다:
$$g_m = \frac{\partial I_D}{\partial V_{GS}}\bigg|_{Q\text{-point}}$$
- 따라서 $\Delta V_{in}$이 작을 때는 근사 오차가 미미하지만, $\Delta V_{in}$이 커질수록(예: 강의에서 $V_{in}$이 20mV, 100mV로 커지는 예시) 실제 대신호 결과와 소신호 예측값의 오차가 커진다.
- **채널 길이 변조($\lambda \ne 0$)**를 고려하면 이 괴리는 더 복잡해진다. $V_{DS}$의 변화가 $I_D$에도 영향을 주므로, 출력저항 $r_o$라는 추가 소신호 파라미터가 필요해진다.

---

### Q4. 회로가 다른 회로와 연결될 때 왜 항상 $R_{in}$, $R_{out}$을 함께 고려해야 하는가?

**핵심 통찰:** "Amplifier는 항상 다른 회로와 연결된다."

현실의 증폭기는 진공 속에 홀로 존재하지 않는다. 입력은 이전 단(stage)의 출력에서 오고, 출력은 다음 단의 입력으로 연결된다. 이때:

- 현재 회로의 **출력 노드**는 다음 단(Circuit B)의 **입력 임피던스($R_{in}$)**를 하나의 추가 부하 경로로 "보게" 된다.
- 이는 Q1에서 다룬 "추가 경로 $R_x$"와 정확히 동일한 현상이다! $R_x$의 실체가 바로 다음 단의 $R_{in}$인 것이다.

따라서 이상적인 상황(무한 부하 임피던스 가정)에서 계산한 이득 $A_v = -g_m R_D$는 실제 연결 시 **반드시 감소**하며, 실전 설계/시험 문제에서는 이 부하 효과(loading effect)를 항상 고려해야 한다.

---

## 2. 수식 제시 및 수학적 유도 (Mathematical Formulations & Derivations)

### 2.1 기본 CS 증폭기의 소신호 전압 이득

$$A_v = \frac{v_{out}}{v_{in}} = -g_m R_D$$

- $g_m$: 트랜스컨덕턴스, 입력 전압 변화에 대한 출력 전류 변화의 비율
- $R_D$: 드레인 부하 저항
- 음수(-) 부호: 입력이 증가하면 $I_D$가 증가 → $R_D$에서 전압 강하 증가 → $V_{out}$ 감소 (180° 위상 반전)

### 2.2 추가 경로($R_x$) 존재 시 이득 변화

병렬 저항의 합성:
$$\frac{1}{R_{eq}} = \frac{1}{R_D} + \frac{1}{R_x} \quad\Rightarrow\quad R_{eq} = R_D \parallel R_x = \frac{R_D R_x}{R_D + R_x}$$

새로운 이득:
$$A_v' = -g_m (R_D \parallel R_x) = -g_m \cdot \frac{R_D R_x}{R_D + R_x}$$

**유도 과정 (KCL 기반):**
1. 노드 방정식: 드레인 노드에서 나가는 전류의 합 = 들어오는 전류
$$g_m v_{gs} = \frac{v_{out}}{R_D} + \frac{v_{out}}{R_x}$$
2. 좌변은 트랜지스터가 제공하는 신호 전류, 우변은 두 경로로 분배되는 전류
3. $v_{out}$으로 정리:
$$-g_m v_{gs} = v_{out}\left(\frac{1}{R_D}+\frac{1}{R_x}\right)$$
$$v_{out} = -g_m v_{gs} \cdot (R_D \parallel R_x)$$

$R_x \to \infty$이면 $R_D \parallel R_x \to R_D$이므로 원래 이득으로 복귀함을 확인할 수 있다. (검증)

### 2.3 병렬 저항의 전류 분배 (Current Divider)

강의의 Parallel Resistor 예제 ($V_y=5\text{V}$, $R_1$, $R_2$ 병렬):

전체 전류:
$$I_x = \frac{V_y}{R_1 \parallel R_2}$$

각 저항으로의 분배 전류:
$$I_{R_1} = I_x \cdot \frac{R_2}{R_1+R_2}, \qquad I_{R_2} = I_x \cdot \frac{R_1}{R_1+R_2}$$

이 원리가 CS 증폭기의 출력단에서 $g_m v_{gs}$라는 전류원이 $R_D$와 $R_x$로 나뉘어 흐르는 것과 **완전히 동일한 구조**이다.

### 2.4 대신호 vs 소신호 수치 대조 (강의 예제 기반)

**주어진 조건:** $V_{DD}=3.3\text{V}$, $R_D=2\text{k}\Omega$, 초기 $I_D = 1\text{mA}$, $V_{out}=1.3\text{V}$

**대신호 관점:**
$$V_{out} = V_{DD} - I_D R_D = 3.3 - (1\text{mA})(2\text{k}\Omega) = 1.3\text{V}$$
입력이 $V_{in}: 1\text{V}\to 1.02\text{V}$로 변할 때:
$$I_D: 1\text{mA} \to 1.05\text{mA}, \qquad V_{out}: 1.3\text{V}\to 1.2\text{V}$$
실제 변화량: $\Delta V_{out} = -0.1\text{V} = -100\text{mV}$, $\Delta V_{in}=20\text{mV}$
$$A_{v,\text{large-signal}} = \frac{-100\text{mV}}{20\text{mV}} = -5$$

**소신호 관점:**
$$g_m = \frac{\Delta I_D}{\Delta V_{GS}} = \frac{0.05\text{mA}}{20\text{mV}} = 2.5\text{mA/V}$$
$$A_{v,\text{small-signal}} = -g_m R_D = -(2.5\text{mA/V})(2\text{k}\Omega) = -5$$

동작점 근처 작은 변화에서는 두 결과가 거의 일치하지만, $\Delta V_{in}$이 커질수록 (예: 슬라이드의 100mV 입력 예제) 제곱 법칙의 비선형성 때문에 오차가 발생한다.

### 2.5 채널 길이 변조 ($\lambda \neq 0$) 고려 시 대신호 모델

$$I_D = \frac{1}{2}\mu C_{ox}\frac{W}{L}(V_{GS}-V_{TH})^2(1+\lambda V_{DS})$$

이를 전개하면:
$$I_D = \underbrace{\frac{1}{2}\mu C_{ox}\frac{W}{L}(V_{GS}-V_{TH})^2}_{I_{D0}} + \lambda I_{D0} \cdot V_{DS}$$

$$I_D = I_{D0} + \frac{1}{r_o}V_{DS}, \qquad r_o \equiv \frac{1}{\lambda I_{D0}}$$

- $I_{D0}$: $\lambda=0$일 때의 이상적 드레인 전류 (바이어스 전류)
- $r_o$: 출력저항 (channel length modulation에 의한 유한 저항), $V_{DS}$ 변화가 $I_D$에도 영향을 준다는 것을 의미
- 소신호 모델에서 $r_o$는 드레인-소스 사이에 **병렬 저항**으로 등가화됨

**$\lambda \neq 0$일 때의 CS 증폭기 이득:**
$$A_v = -g_m (R_D \parallel r_o)$$

$r_o$ 역시 $R_x$와 같은 "추가 경로"로 작용하여 이득을 낮추는 요소임을 알 수 있다 — 이는 Q1의 개념이 실전 트랜지스터 모델에 그대로 적용되는 사례다.

### 2.6 CS Stage with Degeneration (소스 저항 추가)

$$v_{out} = -g_m v_1 R_D, \qquad v_{in} = v_1 + g_m v_1 R_S$$

$v_1$으로 정리:
$$v_1 = \frac{v_{in}}{1+g_m R_S}$$

이득:
$$A_v = \frac{v_{out}}{v_{in}} = \frac{-g_m R_D}{1+g_m R_S}$$

$g_m R_S \gg 1$인 경우 근사:
$$A_v \approx -\frac{R_D}{R_S}$$

이 결과는 $g_m$의 비선형성/공정 변동에 덜 민감한 안정적 이득을 제공하며, 실전 설계에서 negative feedback의 대표적 예시로 활용된다.

### 2.7 다단(Multi-stage) 증폭기의 전체 이득

$$\frac{v_{out}}{v_{in}} = A_{v1}\cdot\frac{R_{in2}}{R_{out1}+R_{in2}} \cdot A_{v2}\cdot\frac{R_{in3}}{R_{out2}+R_{in3}}\cdot A_{v3}$$

일반화하면:
$$\text{Effective Gain} = \prod_{k} A_{vk} \times \prod_{k} \frac{R_{in,(k+1)}}{R_{out,k}+R_{in,(k+1)}}$$

각 단 사이의 임피던스 매칭 비율(voltage divider term)이 곱해지면서 이상적인 개별 이득의 곱보다 항상 **작아진다**는 것이 핵심이다.

---

## 3. 실전 회로 설계에서의 활용법 (Practical Applications & Engineering Takeaways)

### 3.1 이득 저하 방지를 위한 설계 전략

| 문제 상황 | 원인 | 해결 전략 |
|---|---|---|
| 다음 단 연결 시 이득 감소 | $R_{in,next}$가 $R_D$와 병렬 부하 형성 | **버퍼(Buffer) 삽입**: 출력저항이 매우 낮은 Source Follower(CS→CD)로 임피던스 분리 |
| $r_o$에 의한 이득 제한 | 채널 길이 변조로 $r_o$가 유한값 | **Cascode 구조** 사용 → $R_D$ 대신 매우 큰 등가 출력저항 확보 |
| 입력단 부하 효과 | 이전 단 출력저항 $R_{out}$이 크면 입력 신호 손실 | 입력저항이 매우 높은 단(CG 아님, CS의 게이트 등)으로 신호를 받도록 설계 |
| 이득의 공정/온도 변동 | $g_m$이 바이어스에 민감 | **Source Degeneration ($R_S$)** 적용 → $A_v \approx -R_D/R_S$로 안정화 (negative feedback) |

**설계 체크리스트:**
1. 각 단(Stage)마다 반드시 $A_v$, $R_{in}$, $R_{out}$ **세 가지를 동시에** 계산할 것 (강의에서 반복 강조된 "세 가지를 동시에 보라"는 원칙).
2. 스테이지를 연결하기 전에 항상 "다음 단의 $R_{in}$이 내 출력에 어떤 추가 경로로 작용하는가?"를 질문할 것.
3. 이상적 이득 $-g_m R_D$은 항상 **상한값(upper bound)**이며, 실제 시스템에서는 로딩 효과로 인해 항상 이보다 작다는 것을 전제로 설계 마진을 둘 것.

### 3.2 소신호 등가회로를 빠르게 그리는 실전 팁

1. **DC 전원 노드는 즉시 접지로 대체**: $V_{DD}$, $V_B$(바이어스 전압원) 등 시간에 대해 변하지 않는 모든 노드를 소신호 회로에서는 지면(ground)으로 단축시켜 그린다.
2. **트랜지스터를 종속 전류원($g_m v_{gs}$)과 $r_o$의 병렬 조합으로 치환**: $\lambda=0$ 가정 시 $r_o$ 생략, $\lambda \neq 0$이면 반드시 $r_o$를 $D$-$S$ 사이에 추가.
3. **커패시터(결합/바이패스 커패시터)는 AC 관점에서 단락(short)으로 취급**: 충분히 큰 커패시터는 신호 주파수에서 임피던스 0으로 간주.
4. **출력저항($R_{out}$) 계산 시**: 입력 신호원을 0으로 죽이고($v_{in}=0$), 출력 노드에 테스트 전류원 $i_x$를 인가하여 $R_{out}=v_x/i_x$로 구한다.
5. **입력저항($R_{in}$) 계산 시**: 출력을 개방(open)한 상태에서 입력에 테스트 전압/전류를 인가하여 구한다.

### 3.3 흔히 범하는 함정 (Pitfalls)

- **함정 1**: "$A_v=-g_mR_D$만 외워서 답으로 제출" → 문제에 부하($R_L$, 다음 단, $r_o$)가 명시되어 있다면 반드시 병렬 합성($R_D \parallel R_L \parallel r_o$)을 적용해야 함.
- **함정 2**: DC 바이어스 전압원을 소신호 회로에서 그대로 유지 → 회로가 불필요하게 복잡해지고 오류 유발. **반드시 AC 접지로 치환**해야 함.
- **함정 3**: 대신호 수치(예: $\Delta V_{in}=100\text{mV}$처럼 큰 신호)에 소신호 선형 공식을 그대로 적용 → 오차가 커짐. 소신호 근사는 "작은 변화"에서만 유효함을 항상 전제할 것.
- **함정 4**: 채널 길이 변조($\lambda$)를 무시하고 $r_o \to \infty$로 가정한 상태에서 정밀한 이득/출력저항을 요구하는 문제를 풀이 → 문제에서 "$\lambda \neq 0$"이라고 명시하면 반드시 $r_o$를 포함해 재계산.
- **함정 5**: Multi-stage 이득을 단순히 개별 이득의 곱($A_{v1}\times A_{v2}\times A_{v3}$)으로만 계산 → 스테이지 간 $R_{out}$-$R_{in}$ 전압분배 손실을 놓치는 대표적 실수. 반드시 단 사이의 임피던스 비율 항을 곱해야 정확한 전체 이득이 나온다.

---

