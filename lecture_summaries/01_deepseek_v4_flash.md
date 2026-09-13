# DeepSeek V4 Flash 0731 학습 요약 노트

- 모델 ID: `deepseek/deepseek-v4-flash-0731`
- 생성 시간: 64.4초
- 생성 글자 수: 12366자

---

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