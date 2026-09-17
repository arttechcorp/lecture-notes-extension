# 강의 요약 비교 (6개 LLM, via OpenRouter)

## DeepSeek V4 Flash 0731

`deepseek/deepseek-v4-flash-0731`

## 강의 주제 개요

이 강의는 MOSFET CS(Common-Source) 증폭기의 핵심 성능 지표인 **전압 이득(Av), 입력 저항(Rin), 출력 저항(Rout)** 을 함께 보는 능력을 기르는 데 초점을 맞춥니다. 단순히 "이득 = -gm·RD"라는 공식을 암기하는 것을 넘어, 다음을 이해하는 것이 목표입니다.

- 실제 회로에서 **추가 경로(부하)** 가 생기면 출력 전압 변화 폭이 줄어드는 현상(loading 효과)
- small-signal 해석에서 **고정 전압 노드(VDD)가 AC 접지**가 되는 이유
- 채널 길이 변조(λ ≠ 0)가 대신호 모델과 소신호 모델에 반영되는 방식 (즉, r₀ 저항의 출현)
- 증폭기가 **다른 회로와 연결될 때** 이득이 단순 곱이 아니라 입력/출력 저항에 의해 변하는 이유
- Diode-Connected Load의 저항(1/gm) 유도
- Source Degeneration(소스 저항)이 이득과 출력 저항에 미치는 영향

---

## 시간 순 핵심 흐름 (타임스탬프 구간별로 다루는 개념)

### 1) [00:38 ~ 04:39] 추가 경로에 의한 이득 감소 + 병렬 저항 복습
- 기존 CS 증폭기 출력에 **추가적인 신호 경로(저항)가 병렬로 붙으면**, 출력 노드에서 보는 전압 변화가 줄어든다.
- 전류가 여러 경로로 나뉘어 흐르기 때문에, 원래 RD만으로 흐르던 전류 변화량이 분산되어 **출력 전압 스윙이 감소**한다.
- 이를 위해 병렬 저항의 기초를 복습: V_y = 5V, I_x = 1mA 등의 예시로 전류 분배 원리를 확인.

### 2) [04:40 ~ 12:17] Small-Signal Model vs. 실제 동작, 고정 전압 노드는 접지
- VDD = 3.3V, RD = 2kΩ, VIN = 1V → 1.02V일 때, Vout = 1.3V → 1.2V, Id = 1mA → 1.05mA 등 **실제 대신호 동작**을 먼저 확인.
- **"In Small Signal Model, Fixed Voltage Node is just Ground"** — VDD처럼 전압이 고정된 노드는 소신호 해석에서 AC 접지로 간주한다.
- 이 때문에 추가된 경로(부하 저항)는 모두 **출력 노드에서 병렬**로 보인다.
- 예: 부하로 2k, 4k, 6k, 15k, 10k 등 여러 저항이 추가되면 이득은  
  Gain = -gm·(R₁//R₂//R₃//R₄//R₅//R₆) 형태로 감소한다.  
  (구체적인 예: Vout = 1.5V → 1.4625V로 변화 폭 축소)

### 3) [12:32 ~ 14:39] 채널 길이 변조(Channel Length Modulation, λ)
- 대신호 전류 식:  
  I_D = ½μCox(W/L)(V_GS - V_TH)²(1 + λV_DS)
- 이를 전개하면:  
  I_D = I_D0 + λV_DS·I_D0 = I_D0 + V_DS/r₀  
  여기서 **r₀ = 1/(λI_D0)** 가 유도된다.
- λ ≠ 0인 경우, MOSFET은 **I_D0 전류원과 병렬 저항 r₀**로 모델링된다.

### 4) [15:08 ~ 21:51] 입력 저항/출력 저항의 정의와 "연결"의 관점
- Rin: 입력 노드에서 바라다본 저항 (Circuit B 기준)
- Rout: 출력 노드에서 바라다본 저항 (Circuit A 기준)
- **증폭기는 다른 회로와 연결된다.** 입력은 앞 단의 출력이고, 출력은 다음 단의 입력이 된다.
- 그렇다면 반드시 물어야 할 질문:  
  *"출력 노드에 연결된 회로 때문에 출력 전압이 영향을 받지 않을까?"*
- 답: 받는다. 경로가 추가되면 출력 전압 크기가 감소한다(loading).

### 5) [29:13 ~ 35:20] 일반화: 다단 증폭기 이득과 임피던스
- 출력이 전압, 입력이 전압인 경우, **이득(전압 전달 비율)은 Rout와 다음 단 Rin의 분배비**에 의해 변한다.
- Vout = A_v1·A_v2·A_v3·Vin 이 단순 곱처럼 보여도, 각 단 사이에서  
  **Rout_prev와 Rin_next가 전압 분배기**를 형성하므로 실제 이득은 감소한다.
- 즉, **Gain이 전부가 아니다. Rin과 Rout이 결정적으로 중요하다.**

### 6) [35:35 ~ 45:17] CS 증폭기의 Av, Rin, Rout 및 전류원 부하
- CS 증폭기에서 Av, Rin, Rout를 **동시에** 유도하는 것이 중요하다.
- 이상적 전류원 부하의 소신호 관점: 이상적 전류원은 **AC 개방(저항 ∞)**.
- PMOS를 전류원 부하로 쓰는 회로: PMOS의 출력 저항 r₀₂가 출력 노드에 병렬로 보이므로  
  Gain = -gm₁·(r₀₁ ∥ r₀₂) 형태가 된다.

### 7) [47:43 ~ 54:09] CS Stage with Diode-Connected Load (다이오드 연결 부하)
- 게이트와 드레인이 연결된 MOSFET(M2)의 저항을 소스에서 유도:  
  **R_x = V_x / I_x = 1/gm** (λ = 0일 때)
- λ ≠ 0인 경우, 1/gm과 r₀가 병렬로 보인다: R_x = (1/gm) ∥ r₀ ≈ 1/gm
- 즉, 다이오드 연결 PMOS를 부하로 쓰면 이득은 대략 **-gm₁/gm₂**가 된다.
- (Example 7.2: λ ≠ 0인 경우의 전압 이득 계산)

### 8) [54:40 ~ 71:41] CS Stage with Degeneration (소스 저항 RS)
- **Gain 유도 (λ=0):**
  - Vout = -I_D·R_D
  - I_D = gm·V_GS, V_GS = V_in - I_D·R_S
  - V_in = V_GS + I_D·R_S = V_GS(1 + gm·R_S)
  - 따라서 **Av = -gm·R_D / (1 + gm·R_S)**
  - gm·R_S ≫ 1이면 Av ≈ -R_D/R_S — 즉, gm에 무관하게 저항비로 이득이 결정된다.
- **출력 저항 유도 (λ≠0):**
  - 입력을 AC 접지시키고 출력에 테스트 전압 v_x를 인가.
  - v_gs = -i_x·R_S
  - v_x = i_x·R_S + (i_x - gm·v_gs)·r₀  
    = i_x·R_S + (i_x + gm·i_x·R_S)·r₀
  - 따라서 **v_x/i_x = r₀ + R_S + gm·R_S·r₀**
  - 출력 저항은 여기에 R_D가 병렬: **Rout = R_D ∥ (r₀ + R_S + gm·R_S·r₀)**
- **Example 7.9/7.10:** M1(디제너레이션)과 M2(전류원)가 동일한 경우  
  **Rout = (R_S + r₀₁ + gm·R_S·r₀₁) ∥ r₀₂**  
  만약 M1, M2가 동일하면 결과적으로 Rout ≈ r₀ 수준으로 제한된다.

---

## 핵심 개념 및 수식 (유도 과정 포함, 개념 간 연결 설명)

### 1) CS 증폭기의 기본 이득: 왜 -gm·RD인가?
- MOSFET은 입력 전압(V_GS)을 전류(gm·V_GS)로 변환하는 **전압 제어 전류원**이다.
- 출력 전류가 저항 R_D에 흐르면 출력 전압은 -gm·V_GS·R_D가 된다. (위상 반전)
- 따라서 Av = Vout/Vin = -gm·R_D.
- 여기서 음의 부호는 CS 증폭기의 **입력-출력 위상 반전** 특성이다.

### 2) 채널 길이 변조: r₀의 출현
대신호 전류 식에서:

\[
I_D = \frac{1}{2}\mu C_{ox}\frac{W}{L}(V_{GS}-V_{TH})^2 (1+\lambda V_{DS})
\]

여기서 \((1+\lambda V_{DS})\) 항은 V_DS 증가 시 유효 채널 길이가 줄어들어 전류가 증가하는 현상을 반영한다. 이를 분해하면:

\[
I_D = I_{D0} + \lambda V_{DS}I_{D0} = I_{D0} + \frac{V_{DS}}{r_0}
\]

즉, **MOSFET은 I_D0 전류원에 병렬 저항 r₀ = 1/(λI_D0)이 추가된 형태**로 모델링된다.  
소신호 해석에서 이 r₀는 출력 노드에서 다른 저항들과 병렬로 결합된다.

→ **CS 이득(λ≠0):** Av = -gm·(R_D ∥ r₀)  
r₀가 R_D보다 작으면 이득이 크게 감소할 수 있으므로, λ가 작은(즉 r₀가 큰) 트랜지스터가 좋은 증폭기다.

### 3) "고정 전압 노드는 AC 접지"의 의미
- VDD는 DC 전원으로 고정되어 있다.
- small-signal 분석에서는 **DC 바이어스 성분을 제거하고 변화량(AC 신호)만 본다.**
- VDD 노드는 어떤 AC 변화도 없으므로, AC 관점에서 전위가 0 = 접지와 동일하다.
- 따라서 Vout과 VDD 사이에 연결된 모든 저항(R_D, 부하 등)은 **출력 노드와 AC 접지 사이의 병렬 저항**으로 보인다.

이것이 "추가 경로가 출력 전압 변화를 줄인다(Added Path Reduces Voltage Change)"의 핵심이다.  
예를 들어 원래 이득이 -gm·R_D였다면, 추가 경로 R_x가 생기면:  
Gain = -gm·(R_D ∥ R_x)로 감소한다.

### 4) 로딩 효과(Loading Effect): 다단 이득의 진실
- Circuit A의 출력에 Circuit B가 연결되면:
  - Circuit A의 출력 저항 R_out과 Circuit B의 입력 저항 R_in이 **전압 분배기**를 형성한다.
  - 실제 전달되는 전압:

\[
V_{in,B} = V_{out,A} \times \frac{R_{in,B}}{R_{out,A} + R_{in,B}}
\]

- 따라서 다단 증폭기의 전체 이득:

\[
\frac{V_{out}}{V_{in}} = A_{v1} \times \frac{R_{in2}}{R_{out1}+R_{in2}} \times A_{v2} \times \frac{R_{in3}}{R_{out2}+R_{in3}} \times A_{v3}
\]

- **Rin이 크고 Rout이 작은 증폭기**일수록 loading 손실이 적다.  
  이 때문에 "이득만 보지 말고 Rin, Rout을 함께 봐라"는 강조가 반복된다.

### 5) Diode-Connected Load 저항 = 1/gm
- 게이트-드레인이 연결된 MOSFET(M2)에 테스트 전압 v_x를 인가하면:
  - V_GS = v_x (게이트와 드레인이 같으므로)
  - I_x = gm·v_x
  - 따라서 **R_x = v_x/I_x = 1/gm** (λ=0)
- λ≠0이면 r₀도 병렬로 추가: R_x = (1/gm) ∥ r₀ ≈ 1/gm (보통 gm이 지배적)
- 이 부하를 CS 단에 쓰면: Av = -gm₁ × (1/gm₂ ∥ r₀₁ ∥ r₀₂) ≈ -gm₁/gm₂  
  → gm 비율로 이득이 정해지므로 공정 변화에 강건하다.

### 6) Source Degeneration: gm을 "낮추는" 대신 Rout을 "높이는" 기법
- 소스에 R_S를 넣으면 V_in이 전부 V_GS로 걸리지 않고 일부가 R_S에 걸린다.
- 즉, 실질 트랜스컨덕턴스가 감소한다:

\[
G_m = \frac{i_d}{v_{in}} = \frac{g_m}{1+g_m R_S}
\]

- 따라서 이득: Av = -G_m·R_D = **-gm·R_D/(1+gm·R_S)**
- gm·R_S ≫ 1일 때 Av ≈ -R_D/R_S → gm과 무관하게 저항비로 결정 (선형성 향상)
- 반면 출력 저항은 크게 증가한다:

\[
R_{out} = r_o + R_S + g_m R_S r_o \approx r_o(1+g_m R_S)
\]

- 이는 전류원 부하 설계에서 매우 중요하다. Rout이 커야 이상적 전류원에 가깝기 때문.
- R_S가 클수록 Rout이 커지지만 이득이 줄어드는 **trade-off**가 존재.

### 7) 두 MOSFET이 있는 디제너레이션 회로 (Example 7.9/7.10)
- M1(소스에 R_S)과 M2(전류원 역할)가 병렬로 출력 노드를 구동한다면:
- M1 쪽에서 바라본 출력 저항: R_S + r₀₁ + gm·R_S·r₀₁
- M2 쪽의 출력 저항: r₀₂
- 전체 Rout = (R_S + r₀₁ + gm·R_S·r₀₁) ∥ r₀₂
- **M1과 M2가 동일하면** 첫 항이 r₀보다 훨씬 크므로 병렬 결과는 r₀에 가깝게 제한된다.  
  → 전류원의 출력 저항(r₀₂)이 전체 출력 저항의 상한을 결정한다.

---

## 헷갈리기 쉬운 포인트 / 자주 하는 실수

1. **VDD를 소신호 해석에서 접지로 바꾸지 않는 실수**
   - VDD는 DC 전원이므로 AC 신호 입장에서 전위 변화가 없다 → 반드시 AC 접지 처리.
   - 이걸 놓치면 출력 노드에서 저항들의 병렬 관계를 잘못 파악하게 된다.

2. **λ = 0과 λ ≠ 0을 혼동**
   - λ = 0: MOSFET은 완벽한 전류원 → 출력에서 본 저항 무한대 → Rout = R_D
   - λ ≠ 0: r₀ = 1/(λI_D0) 병렬 저항 추가 → Rout = R_D ∥ r₀
   - 문제에서 λ를 명시하지 않으면 보통 λ=0으로 가정하지만, 문제 조건을 항상 확인할 것.

3. **Diode-Connected Load의 저항을 r₀로 착각**
   - 다이오드 연결 MOSFET은 게이트와 드레인이 단락되어 **1/gm**의 저항으로 보인다.
   - 이 값은 보통 r₀보다 훨씬 작으므로(수백 Ω 수준), 이득은 -gm₁/gm₂로 결정된다.

4. **Degeneration 이득 공식에서 부호나 분모를 틀리는 실수**
   - Av = -gm·R_D/(1 + gm·R_S)이다.  
     "소스 저항이 생기면 이득이 줄어든다"는 직관과 맞다.  
     분모의 gm·R_S 항을 빼먹는 실수가 많다.

5. **"이득이 크면 좋은 증폭기"라는 오해**
   - 이득만 크고 Rout이 크면 다음 단 연결 시 전압 분배로 이득이 깎인다.
   - 다단 설계에서는 각 단의 Rin과 Rout을 함께 고려해야 실제 전체 이득이 산출된다.

6. **Rout 측정 시 입력을 AC 접지시키는 것을 잊는 실수**
   - 출력 저항을 계산할 때는 입력 전압원을 0(AC 접지)으로 두고 테스트 전압을 출력에 인가해야 한다.

---

## 복습 체크리스트 (자가 점검 질문)

1. CS 증폭기의 이득이 -gm·R_D인 이유를 small-signal 모델로 설명할 수 있는가?
2. 채널 길이 변조(λ)가 있을 때, r₀ = 1/(λI_D0)가 유도되는 과정을 쓸 수 있는가? 그 r₀는 회로에서 어디에 병렬로 붙는가?
3. "고정 전압 노드는 접지"라는 말의 의미를, VDD=3.3V 회로에서 소신호 등가 회로로 변환하며 설명할 수 있는가?
4. 출력 노드에 추가 저항(경로)이 생기면 왜 이득이 감소하는가? 병렬 저항 개념으로 설명할 수 있는가?
5. Rin과 Rout이 각각 "어느 쪽에서 바라본 저항"인지 정의할 수 있는가?
6. 두 증폭기를 직렬 연결할 때, Rout과 Rin이 어떻게 전압 분배를 만들어 전체 이득을 낮추는지 수식으로 유도할 수 있는가?
7. Diode-Connected Load의 저항이 1/gm인 이유를 테스트 전압법으로 유도할 수 있는가? λ≠0이면 어떻게 달라지는가?
8. CS Stage에 소스 저항 R_S가 있을 때:
   - Av가 -gm·R_D/(1+gm·R_S)로 유도되는 과정을 쓸 수 있는가?
   - Rout = R_D ∥ (r₀ + R_S + gm·R_S·r₀) 유도 과정을 설명할 수 있는가?
   - 왜 디제너레이션이 출력 저항을 증가시키는가?
9. Example 7.9/7.10에서 M1, M2가 동일할 때 Rout이 어떻게 제한되는지 설명할 수 있는가?
10. "Gain is not everything. Rin and Rout matter significantly."라는 말의 의미를 구체적인 회로 예시와 함께 설명할 수 있는가?

---

## 확인이 필요한 불명확한 부분 (STT 노이즈로 인해 판독 불가능했던 구간)

- **[00:38 ~ 02:29]**: 강사 음성에서 "50mAh", "40mAh", "3.3%", "40mg" 등 잘못 인식된 수치가 많음. 이 구간의 정확한 예시 수치는 불명확하지만, **추가 경로에 의한 이득 감소**의 개념적 흐름은 명확함.
- **[42:57 ~ 45:17]**: Figure 7.11의 PMOS CS stage 이득 계산 결과가 OCR에서 "QA / -qm (Rp/Ro1) / -qm (Ro1/Ro1)"로 깨져 있음. 문맥상 Av = -gm₁(r₀₁ ∥ r₀₂)로 추정되지만, 정확한 식은 교재 확인 필요.
- **[51:49 ~ 54:09]**: Example 7.2(diode-connected PMOS, λ≠0)의 최종 이득 수식이 슬라이드에서 선명하게 추출되지 않음. Av = -gm₁·(r₀₁ ∥ r₀₂ ∥ 1/gm₂)로 수렴할 것으로 판단되나, 교재(Figure 7.13) 확인 필요.
- **[70:16 ~ 71:41]**: Example 7.9의 최종 결과 수식이 "Rs + (τg + quxl/α)", "Fb + (τQ)q/x" 등으로 심하게 왜곡됨. 마지막 슬라이드의 "Rout = (R + r₀₁ + gm·R_S·r₀₁) ∥ r₀₂" 형태로 보이나, 중간 유도 과정의 일부 표기는 미확인.
- **[15:18]**의 "(1) Current provided from additional part / (2) Current provided from original part / (3) Iт from original part ... Gain / 100mA / 80mA / 1mA / 1.14mA / Ro" 구간은 전류 분배 예시로 보이나, 구체적인 회로 구성과 수치의 연결 관계는 음성 노이즈로 불명확.

---

## Qwen3.5 122B-A10B

`qwen/qwen3.5-122b-a10b`

## 강의 주제 개요
본 강의는 **Common Source (CS) Amplifier**의 기본 동작 원리를 넘어, 실제 회로 설계에서 필수적인 **부하 효과 (Loading Effect)**, **입출력 임피던스 (Input/Output Resistance)**, 그리고 **Small-Signal Model**을 활용한 정밀한 분석 방법을 다룹니다. 특히 채널 길이 변조 (Channel Length Modulation) 와 소스 디게네레이션 (Source Degeneration) 이 증폭기의 이득 (Gain) 및 출력 임피던스에 미치는 영향을 심층적으로 분석합니다.

## 시간 순 핵심 흐름 (타임스탬프 구간별로 다루는 개념)

1.  **00:38 ~ 04:40: 병렬 경로와 이득 감소 (Gain Reduction)**
    *   출력 노드에 추가적인 경로 (병렬 저항) 가 생기면 전류가 분배되어 출력 전압 변화량이 줄어듦을 설명.
    *   기본 병렬 저항 회로 이론 복습 ($V_y=5V$, 전류 분배 등).
2.  **04:40 ~ 10:07: Small-Signal Model 과 실제 동작 비교**
    *   DC 바이어스 점 ($V_{DD}=3.3V, I_D=1mA$) 에서 작은 신호 ($\Delta V_{in}$) 가 인가되었을 때의 실제 전류/전압 변화 분석.
    *   Small-Signal Model 에서 고정 전압 노드 (VDD 등) 는 **AC Ground**로 취급됨을 강조.
3.  **12:32 ~ 14:03: 채널 길이 변조 (Channel Length Modulation, CLM)**
    *   Large Signal Model 에 $\lambda$ 항을 도입하여 $V_{DS}$에 따른 $I_D$ 변화 설명.
    *   이를 Small-Signal Model 에서 출력 저항 $r_o$로 모델링 ($r_o \approx 1/(\lambda I_D)$).
4.  **15:13 ~ 35:35: 임피던스 매칭과 다단 증폭기 (Loading Effect)**
    *   회로 A 의 출력이 회로 B 의 입력에 연결될 때 발생하는 부하 효과.
    *   $R_{out}$과 $R_{in}$의 관계에 따른 전압 이득 감소 (전압 분배 원리).
    *   다단 증폭기 (Multiple Stage) 전체 이득은 각 단의 이득 곱에 임피던스 영향이 곱해짐.
5.  **38:00 ~ 47:43: 전류 소스 부하 (Current Source Load)**
    *   이상적인 전류 소스와 PMOS/NMOS 전류 소스를 이용한 CS 증폭기 구성.
    *   Small-Signal 에서 전류 소스는 높은 출력 저항 ($r_o$) 을 가짐.
6.  **47:43 ~ 54:09: 다이오드 연결 부하 (Diode-Connected Load)**
    *   MOSFET 을 다이오드처럼 연결했을 때의 저항 ($1/g_m$) 유도.
    *   이를 부하로 사용할 때의 이득 분석.
7.  **54:40 ~ 71:41: 소스 디게네레이션 (Source Degeneration)**
    *   소스에 저항 $R_S$를 추가했을 때의 이득 감소 및 선형성 개선 효과.
    *   $\lambda \neq 0$일 때 디게네레이션이 적용된 회로의 **출력 저항 ($R_{out}$) 유도** (가장 중요한 분석 포인트).

## 핵심 개념 및 수식 (유도 과정 포함, 개념 간 연결 설명)

### 1. Small-Signal Model 과 AC Ground
*   **개념:** DC 전압원 ($V_{DD}$) 은 전압 변화가 없으므로 ($\Delta V = 0$), Small-Signal 분석 시 **접지 (Ground)**로 간주합니다.
*   **연결:** 이를 통해 회로 해석이 단순화되며, $V_{out}$의 변화는 오직 소자의 Small-Signal 파라미터 ($g_m, r_o$) 와 저항에 의해 결정됩니다.

### 2. 채널 길이 변조 (CLM) 와 출력 저항 $r_o$
*   **Large Signal 식:**
    $$I_D = \frac{1}{2} \mu C_{ox} \frac{W}{L} (V_{GS} - V_{TH})^2 (1 + \lambda V_{DS})$$
*   **Small-Signal 모델링:**
    위 식을 $V_{DS}$에 대해 미분하거나 선형화하면, MOSFET 의 드레인 - 소스 사이에는 저항 $r_o$가 병렬로 연결된 것으로 볼 수 있습니다.
    $$r_o \approx \frac{1}{\lambda I_D}$$
*   **의미:** $\lambda = 0$ (이상적) 이면 $r_o = \infty$ (전류 소스), $\lambda \neq 0$이면 유한한 $r_o$가 존재하여 이득이 제한됩니다.

### 3. 부하 효과 (Loading Effect) 와 다단 이득
*   **상황:** 증폭기 A (출력 저항 $R_{out,A}$) 가 증폭기 B (입력 저항 $R_{in,B}$) 를 구동할 때.
*   **전압 분배:**
    $$V_{in,B} = V_{out,A} \cdot \frac{R_{in,B}}{R_{in,B} + R_{out,A}}$$
*   **전체 이득:**
    $$A_{v,total} = A_{v,A} \cdot \left( \frac{R_{in,B}}{R_{in,B} + R_{out,A}} \right) \cdot A_{v,B}$$
*   **핵심:** $R_{in,B}$가 크고 $R_{out,A}$가 작아야 부하 손실이 적습니다.

### 4. 소스 디게네레이션 (Source Degeneration) 의 출력 저항
*   **회로:** 소스에 저항 $R_S$가 있는 CS Amplifier.
*   **목표:** 드레인에서 바라본 출력 저항 $R_{out}$ 구하기 ($\lambda \neq 0$).
*   **유도 과정 (Test Source Method):**
    1.  게이트를 접지 ($V_{in}=0$) 하고 드레인에 테스트 전압 $V_x$를 인가하여 전류 $I_x$를 측정.
    2.  소스 전압 $V_s = I_x R_S$ (게이트가 0 이므로 $V_{gs} = -V_s$).
    3.  드레인 전류 $I_x$는 $r_o$를 통과하는 전류와 $g_m V_{gs}$ 전류의 합 (KCL).
    4.  $I_x = \frac{V_x - V_s}{r_o} + g_m V_{gs} = \frac{V_x - I_x R_S}{r_o} - g_m I_x R_S$
    5.  정리하면:
        $$R_{out} = \frac{V_x}{I_x} = r_o + R_S + g_m r_o R_S \approx r_o (1 + g_m R_S)$$
*   **의미:** 디게네레이션은 출력 저항을 약 $(1 + g_m R_S)$배 증가시킵니다. 이는 전류 소스의 이상적인 성질 (높은 임피던스) 에 가깝게 만듭니다.

## 헷갈리기 쉬운 포인트 / 자주 하는 실수

1.  **병렬 경로와 이득 감소:**
    *   **오해:** "저항이 추가되면 전류가 더 많이 흐르니 이득이 커진다?"
    *   **정리:** 출력 노드에 병렬로 저항 (또는 경로) 이 추가되면, MOSFET 이 만들어낸 신호 전류 ($g_m V_{gs}$) 가 해당 병렬 저항으로도 분배됩니다. 결과적으로 $R_D$에 걸리는 전압 변화 ($\Delta V_{out}$) 가 줄어들어 **이득이 감소**합니다.
2.  **Small-Signal Ground:**
    *   **오해:** "VDD 는 항상 전압이 있으므로 Ground 가 아니다."
    *   **정리:** Small-Signal 분석에서는 **변화량 ($\Delta$)**만 봅니다. VDD 는 일정한 DC 전압이므로 변화량이 0 이며, 이는 AC Ground 와 동일합니다.
3.  **디게네레이션 출력 저항 유도:**
    *   **오해:** "출력 저항은 그냥 $R_D$와 $r_o$의 병렬이다."
    *   **정리:** 소스에 $R_S$가 있을 때, 피드백 효과로 인해 $r_o$가 증폭되어 보입니다. 단순히 $r_o || R_D$가 아니라, $r_o(1+g_m R_S)$ 항이 포함된 식을 기억해야 합니다.
4.  **다이오드 연결 저항:**
    *   **오해:** "MOSFET 이므로 저항이 무한대다."
    *   **정리:** 게이트와 드레인이 연결된 (Diode-Connected) MOSFET 은 소스에서 바라볼 때 약 $1/g_m$의 저항으로 동작합니다.

## 복습 체크리스트 (자가 점검 질문)

1.  [ ] **Small-Signal Model:** DC 전압원 (VDD) 을 Small-Signal 회로에서 어떻게 처리하는가?
2.  [ ] **CLM:** 채널 길이 변조 파라미터 $\lambda$가 0 이 아닐 때, MOSFET 의 Small-Signal 모델에 어떤 소자가 추가되는가? 그 값은 무엇인가?
3.  [ ] **Loading Effect:** 증폭기 1 의 출력 저항이 증폭기 2 의 입력 저항보다 클 때, 전체 이득은 어떻게 변하는가?
4.  [ ] **Degeneration Gain:** 소스 저항 $R_S$가 있는 CS 증폭기의 전압 이득 ($A_v$) 은 대략 얼마인가? ($R_S \gg 1/g_m$인 경우)
5.  [ ] **Degeneration Rout:** 소스 저항 $R_S$가 있을 때, 드레인에서 바라본 출력 저항 ($R_{out}$) 은 $r_o$에 비해 어떻게 변하는가? (증가/감소 및 배수)
6.  [ ] **Diode Load:** 게이트와 드레인이 연결된 MOSFET 의 소스에서 바라본 저항 값은 무엇인가?

## 확인이 필요한 불명확한 부분 (STT 노이즈로 인해 판독 불가능했던 구간)

*   **00:38 ~ 01:19:** "50mAh", "40mAh", "3.3%" 등의 표현이 나오는데, 이는 전류 단위 (mA) 나 비율 (%) 의 오타로 추정되나 정확한 수치와 문맥 (예: 전류 분배 비율) 을 확인하기 어렵습니다.
*   **02:29 ~ 04:40:** "1.2m", "2.2m", "10월" 등의 표현이 나오며, 이는 저항 값 (k$\Omega$) 이나 전류 값 (mA) 의 STT 오류일 가능성이 높습니다. 구체적인 예제 수치는 강의 슬라이드를 직접 확인해야 합니다.
*   **08:01 ~ 09:19:** "918.75μA", "609.375μA" 등 매우 구체적인 전류 값이 나오지만, 어떤 조건 (VGS, VDS 등) 에서 계산된 값인지 STT 텍스트만으로는 추론이 불가능합니다.
*   **15:19, 19:20, 23:20, 31:20, 34:40:** "끝끝", "믿는 소리", "모르기" 등 의미 없는 텍스트가 반복되어 해당 시간대의 구체적인 설명 내용을 파악할 수 없습니다. (대부분 예제 풀이 과정이나 질문 응답으로 추정됨)
*   **51:34 ~ 51:49:** 수식 유도 과정에서 "íx", "í" 등의 기호가 나오는데, 이는 $I_x$ (전류) 나 $V_x$ (전압) 의 OCR 오류로 보입니다.

---

## Qwen3.8 2.4T-A95B

`qwen/qwen3.8-2.4t-a95b`



## 강의 주제 개요

이 강의는 **MOSFET Common-Source Amplifier, 즉 CS Amplifier의 전압 이득이 실제로 어떻게 결정되는지**를 중심으로 진행된다. 핵심 질문은 다음과 같다.

1. 출력 노드에 추가 경로가 생기면 왜 gain이 줄어드는가?
2. Small-signal model에서 고정 전압 노드는 왜 ground로 취급되는가?
3. Channel length modulation은 gain과 output resistance에 어떻게 반영되는가?
4. 증폭기는 다른 회로와 연결되므로 왜 `Rin`과 `Rout`을 반드시 함께 봐야 하는가?
5. Current-source load, diode-connected load, source degeneration이 CS amplifier의 gain과 resistance를 어떻게 바꾸는가?

전체 흐름은 단순히 `Gain = -gmRd`를 외우는 것이 아니라,  
**출력 노드에서 전류 변화가 전압 변화로 얼마나 변환되는지**, 그리고 그 변환 비율을 결정하는 **등가 저항**을 찾는 훈련에 가깝다.

---

## 시간 순 핵심 흐름

| 타임스탬프 구간 | 주제 | 핵심 내용 |
|---|---|---|
| `[00:38] ~ [02:29]` | Gain Reduction due to Additional Path | 출력 노드에 추가 전류 경로 `Rx`가 생기면 출력 전압 변화가 줄어든다. 직관적으로는 전류가 분산되어 `Rd`에 걸리는 전압 변화가 감소한다. |
| `[02:29] ~ [04:40]` | Parallel Resistor | 추가 경로는 병렬 저항으로 해석된다. 병렬 연결에서는 전압이 같고 전류가 나뉘므로 등가 저항이 감소한다. |
| `[04:40] ~ [06:50]` | Small Signal Model vs. What Really Happens | DC bias 점에서 작은 변화가 생길 때 `ΔVin`, `ΔId`, `ΔVout` 관계를 통해 `gm`과 gain을 계산한다. 예: `RD = 2kΩ`, `ΔId = 50μA`, `ΔVin = 20mV`이면 `gm = 2.5mS`, `Av ≈ -5`. |
| `[06:50] ~ [12:32]` | Fixed Voltage Node is just Ground | Small-signal model에서 `VDD`처럼 고정된 전압 노드는 AC ground이다. 따라서 `VDD`에 연결된 저항은 small-signal에서 ground로 연결된 저항처럼 보인다. |
| `[10:57] ~ [12:32]` | Added Path Reduces Voltage Change | 여러 추가 경로가 있으면 small-signal에서 모두 병렬 저항으로 묶인다. 유효 load 저항이 줄어들어 gain magnitude가 감소한다. |
| `[12:32] ~ [15:08]` | Channel Length Modulation | `λ ≠ 0`이면 MOSFET drain-source 사이에 출력 저항 `ro`가 존재한다. Gain은 `-gm(RD || ro)` 형태로 수정된다. |
| `[15:08] ~ [35:35]` | Input Resistance / Output Resistance / Multi-stage Loading | 증폭기는 항상 앞뒤 회로와 연결된다. 따라서 `Rin`, `Rout`을 정의하고, stage 간 voltage division까지 포함해서 전체 gain을 계산해야 한다. |
| `[35:35] ~ [42:57]` | CS Amplifier with Current Source Load | Ideal current source는 small-signal에서 매우 큰 저항으로 보인다. 실제 MOS current source는 `ro`를 가지며, gain은 `-gm(ro1 || ro2)` 형태가 된다. |
| `[42:57] ~ [54:40]` | PMOS / Diode-Connected Load | PMOS도 small-signal에서는 source 기준 전압으로 해석한다. Diode-connected MOSFET는 대략 `1/gm`의 저항으로 보인다. |
| `[54:40] ~ [71:41]` | CS Stage with Degeneration | Source에 저항 또는 능동 소자가 들어가면 gain은 감소하지만 output resistance는 증가한다. Gain은 `-gmRD / (1 + gmRS)` 형태로 변한다. |

---

## 핵심 개념 및 수식

### 1. 추가 경로가 생기면 왜 gain이 줄어드는가?

기본 NMOS CS amplifier를 생각하자.

- 입력: `Vin`
- 부하 저항: `RD`
- 출력: `Vout`
- MOSFET은 small-signal에서 전류원 `gm vgs`로 모델링된다.

출력 노드에서 전류 변화를 생각하면, 원래는 MOSFET의 drain 전류 변화가 대부분 `RD`를 통해 전압 변화로 나타난다.

그런데 출력 노드에 추가 경로 `Rx`가 생기면, 같은 전류 변화가 `RD`와 `Rx`로 나뉜다.  
결과적으로 출력 노드에서 보이는 등가 저항이 줄어들고, 전류 변화 대비 전압 변화가 작아진다.

즉,

\[
R_{\text{eff}} = R_D \parallel R_x
\]

이고, small-signal gain은

\[
A_v = \frac{v_{out}}{v_{in}}
= -g_m R_{\text{eff}}
= -g_m (R_D \parallel R_x)
\]

가 된다.

여기서 중요한 직관은 다음과 같다.

> 추가 경로가 전류를 더 공급하거나 빼앗아가면, 출력 노드의 전압 변화는 오히려 줄어든다.  
> 왜냐하면 출력 노드의 전압 변화는 “전류 변화 × 그 노드에서 보이는 저항”이기 때문이다.

---

### 2. 병렬 저항의 기본 관계

두 저항 `R1`, `R2`가 병렬로 연결되어 있으면 양단 전압은 같다.  
전류는 각 저항으로 나뉜다.

\[
I_{\text{total}} = I_1 + I_2
\]

\[
I_1 = \frac{V}{R_1}, \quad I_2 = \frac{V}{R_2}
\]

따라서 등가 저항은

\[
\frac{1}{R_{\text{eq}}}
=
\frac{1}{R_1}
+
\frac{1}{R_2}
\]

또는

\[
R_{\text{eq}} = R_1 \parallel R_2
=
\frac{R_1 R_2}{R_1 + R_2}
\]

이다.

이 개념이 중요한 이유는, 출력 노드에 연결된 여러 저항적 경로가 small-signal에서 모두 병렬로 보이기 때문이다.

---

### 3. Small-signal gain 유도: 기본 CS amplifier

로그에 나타난 예시 수치를 중심으로 보면 다음과 같은 동작점이 등장한다.

- `VDD = 3.3V`
- `RD = 2kΩ`
- `VIN = 1V → 1.02V`
- `Id = 1mA → 1.05mA`
- `Vout = 1.3V → 1.2V`

입력 변화는

\[
\Delta V_{in} = 1.02V - 1V = 20mV
\]

드레인 전류 변화는

\[
\Delta I_D = 1.05mA - 1mA = 50\mu A
\]

따라서 transconductance는

\[
g_m = \frac{\Delta I_D}{\Delta V_{GS}}
= \frac{50\mu A}{20mV}
= 2.5mS
\]

출력 전압 변화는 `RD`에 걸리는 전압 변화의 부호가 반대가 된다.

\[
\Delta V_{out}
=
-\Delta I_D R_D
=
-(50\mu A)(2k\Omega)
=
-100mV
\]

따라서 gain은

\[
A_v =
\frac{\Delta V_{out}}{\Delta V_{in}}
=
\frac{-100mV}{20mV}
=
-5
\]

이고, 이는

\[
A_v = -g_m R_D
= -(2.5mS)(2k\Omega)
= -5
\]

와 일치한다.

즉, small-signal model은 실제 DC 값이 변하는 과정을 선형화해서 다음과 같이 단순화한 것이다.

\[
v_{out} = -g_m v_{in} R_D
\]

---

### 4. Small-signal model에서 고정 전압 노드는 ground

강의에서 반복되는 중요한 개념은 다음과 같다.

> Fixed voltage node is just ground in small-signal model.

예를 들어 `VDD`는 DC적으로는 일정한 전압원이다.  
하지만 small-signal 입장에서 보면 `VDD`의 변화량은 0이다.

\[
\Delta V_{DD} = 0
\]

따라서 small-signal에서는 `VDD` 노드를 AC ground로 취급한다.

그러면 `RD`는 DC적으로는 `VDD`와 출력 노드 사이에 있지만, small-signal에서는 출력 노드와 ground 사이에 연결된 저항처럼 보인다.

이 개념이 중요한 이유는 다음과 같다.

- `VDD`에 연결된 저항은 small-signal에서 ground로 연결된 저항이다.
- 일정한 bias 전압에 연결된 추가 경로도 small-signal에서는 ground로 가는 경로다.
- 따라서 여러 경로가 병렬로 묶인다.

예를 들어 출력 노드에서 `RD`, `R1`, `R2`, ...가 모두 고정 전압 노드로 연결되어 있다면 small-signal에서 이들은 모두 ground로 연결된 병렬 저항이다.

\[
R_{\text{out,load}}
=
R_D \parallel R_1 \parallel R_2 \parallel \cdots
\]

그리고 gain은

\[
A_v = -g_m R_{\text{out,load}}
\]

가 된다.

로그에서 `Vout = -37.5mV`와 `gm vgs = 50μA`가 함께 보이는 부분은, 원래 `2kΩ`이었다면 `100mV`가 바뀌었을 출력 전압이 추가 경로 때문에 더 작게 변했음을 의미한다.

만약 같은 `50μA` 전류 변화에 대해 출력 변화가 `-37.5mV`라면, 유효 저항은

\[
R_{\text{eff}}
=
\frac{37.5mV}{50\mu A}
=
750\Omega
\]

으로 해석할 수 있다.  
즉, 추가 경로로 인해 출력 노드 저항이 `2kΩ`에서 `750Ω` 수준으로 줄어든 예시로 볼 수 있다.

---

### 5. Channel length modulation와 `ro`

MOSFET의 large-signal drain 전류는 이상적으로

\[
I_D =
\frac{1}{2}\mu_n C_{ox}\frac{W}{L}
(V_{GS}-V_{TH})^2
\]

이지만, channel length modulation을 고려하면 다음과 같이 쓴다.

\[
I_D =
\frac{1}{2}\mu_n C_{ox}\frac{W}{L}
(V_{GS}-V_{TH})^2
(1+\lambda V_{DS})
\]

편의상

\[
I_{D0}
=
\frac{1}{2}\mu_n C_{ox}\frac{W}{L}
(V_{GS}-V_{TH})^2
\]

라고 하면,

\[
I_D
=
I_{D0}(1+\lambda V_{DS})
=
I_{D0}
+
\lambda I_{D0} V_{DS}
\]

로 쓸 수 있다.

이 식은 `VDS`가 증가할수록 `ID`가 약간 증가한다는 뜻이다.  
즉, drain-source 사이에 유한한 출력 저항이 존재한다.

Small-signal output resistance는

\[
r_o
=
\left(
\frac{\partial I_D}{\partial V_{DS}}
\right)^{-1}
\approx
\frac{1}{\lambda I_D}
\]

로 정의된다.

따라서 MOSFET small-signal model에는 `gm vgs` 전류원과 함께 `ro`가 drain-source 사이에 병렬로 들어간다.

기본 CS amplifier의 gain은 이제 다음과 같이 수정된다.

\[
A_v =
-g_m (R_D \parallel r_o)
\]

만약 다음 단의 입력 저항이나 외부 load가 있다면 그것까지 병렬로 포함된다.

\[
A_v =
-g_m
(
R_D \parallel r_o \parallel R_L
)
\]

이 부분이 중요한 이유는, `RD`만 보고 gain을 계산하면 실제보다 gain을 과대평가할 수 있기 때문이다.

---

### 6. Input Resistance와 Output Resistance의 정의

증폭기는 단독으로 끝나지 않는다.  
앞 단의 출력은 현재 단의 입력이 되고, 현재 단의 출력은 다음 단의 입력이 된다.

따라서 다음 두 저항이 중요하다.

#### Input resistance

\[
R_{in}
=
\frac{v_{in}}{i_{in}}
\]

입력 단자에서 봤을 때 얼마나 전류를 요구하는지를 나타낸다.

CS amplifier의 경우 MOSFET gate는 DC적으로 거의 전류가 흐르지 않으므로, 저주파 small-signal에서 `Rin`은 매우 크다.  
이상적으로는 open circuit에 가깝다.

하지만 실제 회로에서는 bias 저항, gate 누설, capacitance 등이 영향을 줄 수 있다.

#### Output resistance

\[
R_{out}
=
\left.
\frac{v_x}{i_x}
\right|_{\text{input source zero}}
\]

출력 단자에서 봤을 때의 Thevenin 저항이다.  
출력 저항을 구할 때는 독립 전압원을 short, 독립 전류원을 open으로 두고 test source를 인가한다.

중요한 점은 dependent source, 예를 들어 `gm vgs`는 그대로 둔다는 것이다.

기본 CS amplifier에서 출력 저항은 대략

\[
R_{out}
=
R_D \parallel r_o
\]

이다.

만약 load가 추가로 연결되면, 실제 출력 전압은 이 `Rout`과 다음 단의 `Rin` 사이의 voltage division에 의해 결정된다.

---

### 7. Stage 간 연결과 loading 효과

Circuit A의 출력이 Circuit B의 입력으로 연결되는 상황을 생각하자.

Circuit A의 open-circuit 출력 전압이 `vout,A`이고 출력 저항이 `Rout,A`이며, Circuit B의 입력 저항이 `Rin,B`라면, 실제로 Circuit B가 받는 전압은

\[
v_{in,B}
=
v_{out,A}
\frac{R_{in,B}}{R_{out,A}+R_{in,B}}
\]

가 된다.

따라서 전체 전압 이득은 단순히 각 stage의 이상적 gain을 곱한 값이 아니다.

예를 들어 3-stage amplifier가 있다면 개념적으로 다음과 같이 쓸 수 있다.

\[
\frac{v_{out}}{v_{in}}
=
A_{v1}
\cdot
\frac{R_{in2}}{R_{out1}+R_{in2}}
\cdot
A_{v2}
\cdot
\frac{R_{in3}}{R_{out2}+R_{in3}}
\cdot
A_{v3}
\cdot
\frac{R_L}{R_{out3}+R_L}
\]

즉,

> Gain is not everything. `Rin` and `Rout` matter significantly.

이 문장이 이 구간 강의의 핵심이다.

---

### 8. Ideal current source load를 가진 CS amplifier

CS amplifier에서 `RD` 대신 current source를 load로 사용할 수 있다.

DC적으로 current source는 일정한 bias 전류를 공급한다.  
Small-signal에서 ideal current source는 저항이 무한대인 소자다.

즉, ideal current source는 출력 노드를 ground 쪽으로 shunt하지 않는다.  
따라서 출력 노드에서 보이는 저항이 커지고, gain도 커질 수 있다.

하지만 실제 MOSFET current source는 `ro`를 가진다.  
따라서 NMOS 입력 transistor `M1`과 PMOS current-source load `M2`가 있다면 gain은 대략

\[
A_v
=
-g_{m1}
(
r_{o1}
\parallel
r_{o2}
)
\]

가 된다.

만약 `λ = 0`이라고 가정해서 `ro`가 무한대라면, ideal current source load만 남은 CS amplifier의 gain은 이론적으로 매우 커진다.  
하지만 실제 설계에서는 channel length modulation, load, 다음 단 입력 저항, 출력 swing 제한 등이 gain을 결정한다.

---

### 9. PMOS를 다룰 때의 관점

PMOS는 NMOS와 전압 극성이 다르지만, small-signal 해석의 기본 구조는 비슷하다.

중요한 것은 **source를 기준으로 `vgs` 또는 `vsg`를 해석**하는 것이다.

예를 들어 PMOS의 source가 `VDD`에 연결되어 있고, gate가 고정 bias 전압을 가진다면, small-signal에서 `VDD`는 AC ground이므로 PMOS gate-source 전압 변화는 0에 가까울 수 있다.

이 경우 PMOS current source는 small-signal에서 주로 `ro`만 기여한다.

만약 PMOS가 diode-connected 상태라면 gate와 drain이 묶여 있으므로 small-signal 저항이 달라진다.

---

### 10. Diode-connected MOSFET의 저항

Diode-connected MOSFET는 gate와 drain이 연결된 구조다.

Small-signal에서 drain/gate 노드에 test voltage `vx`를 인가했다고 하자.  
Source가 ground에 연결되어 있다면,

\[
v_{gs} = v_x
\]

이고,

\[
v_{ds} = v_x
\]

이다.

따라서 drain 전류는

\[
i_x
=
g_m v_x
+
\frac{v_x}{r_o}
\]

이다.

그러므로 diode-connected MOSFET가 보이는 저항은

\[
R_x
=
\frac{v_x}{i_x}
=
\frac{1}{g_m + \frac{1}{r_o}}
\]

또는

\[
R_x
=
r_o \parallel \frac{1}{g_m}
\]

이다.

보통

\[
g_m r_o \gg 1
\]

이므로,

\[
R_x \approx \frac{1}{g_m}
\]

으로 근사한다.

따라서 CS amplifier의 load가 diode-connected MOSFET라면, gain은 대략

\[
A_v
\approx
-\frac{g_{m1}}{g_{m2}}
\]

형태가 된다.

좀 더 정확히는 `ro`들을 포함하여

\[
A_v
=
-g_{m1}
\left(
r_{o1}
\parallel
r_{o2}
\parallel
\frac{1}{g_{m2}}
\right)
\]

로 볼 수 있다.

---

### 11. Source degeneration이 있는 CS amplifier

Source에 저항 `RS`가 들어가면 입력 전압이 그대로 `vgs`로 걸리지 않는다.  
일부는 `RS`에 걸리는 전압으로 사용된다.

즉,

\[
v_{gs}
=
v_{in} - v_s
\]

이고,

\[
v_s
=
i_d R_S
\]

이다.

`λ = 0`일 때,

\[
i_d = g_m v_{gs}
\]

이므로,

\[
i_d
=
g_m (v_{in} - i_d R_S)
\]

\[
i_d + g_m R_S i_d
=
g_m v_{in}
\]

\[
i_d
=
\frac{g_m}{1+g_m R_S}
v_{in}
\]

출력 전압은

\[
v_{out}
=
-i_d R_D
\]

이므로 gain은

\[
A_v
=
\frac{v_{out}}{v_{in}}
=
-\frac{g_m R_D}{1+g_m R_S}
\]

가 된다.

이 식은 다음과 같이도 쓸 수 있다.

\[
A_v
=
-\frac{R_D}{R_S + \frac{1}{g_m}}
\]

즉, source degeneration은 gain을 줄이지만, 그 대신 선형성과 출력 저항 특성을 개선할 수 있다.

---

### 12. Source degeneration과 output resistance

`λ ≠ 0`일 때, source degeneration은 output resistance를 증가시킨다.

Gate가 AC ground라고 두고 drain에서 바라본 저항을 생각하자.  
Test voltage `vx`를 drain에 인가하면 source 전압 `vs`가 올라가고, 이는 `vgs`를 감소시킨다.  
결과적으로 같은 `vx`에 대해 전류가 덜 흐르므로 저항이 커진다.

표준적인 결과는 다음과 같다.

\[
R_{out,\text{transistor}}
=
r_o
+
R_S
+
g_m r_o R_S
\]

또는

\[
R_{out,\text{transistor}}
=
r_o(1+g_m R_S)+R_S
\]

이다.

만약 drain에 `RD`가 함께 있다면 전체 출력 저항은

\[
R_{out}
=
R_D
\parallel
\left[
r_o(1+g_m R_S)+R_S
\right]
\]

가 된다.

로그 후반의 Example들에서 `M1`과 `M2`가 identical한 경우를 다루는 부분은, source degeneration 저항을 다른 MOSFET로 구현한 경우로 보인다.  
예를 들어 degeneration 저항이 diode-connected MOSFET의 `1/gm` 정도라면,

\[
R_S \approx \frac{1}{g_{m2}}
\]

로 둘 수 있고, 출력 저항은 대략

\[
R_{out}
\approx
r_{o1}
+
\frac{1}{g_{m2}}
+
g_{m1}r_{o1}\frac{1}{g_{m2}}
\]

가 된다.

만약 `M1`과 `M2`가 비슷해서 `gm1 ≈ gm2`라면,

\[
R_{out}
\approx
2r_{o1}
\]

정도로 증가하는 효과를 기대할 수 있다.  
다만 이 부분의 정확한 회로도와 수치는 로그상에서 일부 불명확하다.

---

## 헷갈리기 쉬운 포인트 / 자주 하는 실수

### 1. 추가 경로가 생기면 전류가 늘어나서 출력이 더 커진다고 오해하는 경우

추가 경로가 전류를 더 공급하거나 빼앗아가면, 출력 노드 전압 변화는 오히려 줄어든다.  
핵심은 전류량이 아니라 **출력 노드에서 보이는 등가 저항**이다.

\[
v_{out} = -i_{signal} R_{\text{eff}}
\]

`R_eff`가 줄어들면 같은 전류 변화에 대해 전압 변화가 줄어든다.

---

### 2. `VDD`를 small-signal에서도 실제 전압원으로 그대로 두는 실수

Small-signal에서는 DC 전압원의 변화량이 0이므로 AC ground로 취급한다.

따라서 `VDD`에 연결된 저항은 small-signal에서 ground에 연결된 저항이다.

이걸 놓치면 병렬 저항 관계를 잘못 그린다.

---

### 3. Ideal current source를 small-signal에서 short로 오해하는 경우

DC current source는 일정한 전류를 공급하지만, small-signal impedance는 매우 크다.  
이상적인 current source는 small-signal에서 open circuit에 가깝다.

따라서 current-source load는 출력 노드의 저항을 키워 gain을 높이는 방향으로 작용한다.

---

### 4. `Gain = -gmRD`만 기억하고 `ro`와 load를 무시하는 경우

`λ ≠ 0`이면 MOSFET 자체의 `ro`가 존재한다.  
또한 다음 단의 입력 저항도 load로 작용한다.

따라서 실제 gain은 보통

\[
A_v = -g_m R_{\text{total}}
\]

이며,

\[
R_{\text{total}}
=
R_D
\parallel
r_o
\parallel
R_{\text{load}}
\parallel
\cdots
\]

이다.

---

### 5. Stage gain을 단순히 곱하는 실수

여러 stage가 연결되어 있을 때 전체 gain은 단순히

\[
A_{v1}A_{v2}A_{v3}
\]

가 아니다.

각 stage 사이에는 반드시 voltage division이 들어간다.

\[
\frac{R_{in,\text{next}}}{R_{out,\text{prev}} + R_{in,\text{next}}}
\]

를 곱해야 한다.

---

### 6. PMOS의 부호를 NMOS와 동일하게 기계적으로 처리하는 실수

PMOS는 전류 방향과 전압 극성이 다르다.  
하지만 small-signal에서는 각 transistor의 source를 기준으로 `vgs` 또는 `vsg`를 정의하면 혼동을 줄일 수 있다.

중요한 것은 “어떤 단자가 AC ground인지”, “source가 어디인지”이다.

---

### 7. Diode-connected MOSFET를 단순 short로 보는 실수

Diode-connected MOSFET는 gate와 drain이 물리적으로 연결되어 있지만, small-signal 저항은 0이 아니다.

대략

\[
R \approx \frac{1}{g_m}
\]

이다.

따라서 diode-connected load는 큰 저항이 아니라 상대적으로 작은 저항성 load로 작용한다.  
이 경우 gain은 `-gmRD`처럼 크게 나오기 어렵고, 보통 `gm` 비율로 결정된다.

---

### 8. Source degeneration이 gain만 줄인다고 생각하는 경우

Source degeneration은 gain을 줄이지만, 다음과 같은 효과가 있다.

- 입력 전압 대비 `vgs` 변화가 줄어들어 선형성이 개선된다.
- 출력 저항이 증가한다.
- Gain이 `gm`보다 저항 비율에 더 의존하게 된다.

따라서 단순히 “나빠지는 것”이 아니라 설계적으로 중요한 trade-off다.

---

### 9. Output resistance를 구할 때 dependent source까지 끄는 실수

`Rout`을 구할 때 독립 source는 zero로 만든다.

- 독립 전압원: short
- 독립 전류원: open

하지만 dependent source, 예를 들어 `gm vgs`는 그대로 두고 test source를 인가해야 한다.

---

## 복습 체크리스트

아래 질문들에 스스로 답할 수 있는지 확인해보자.

1. 출력 노드에 추가 저항 경로 `Rx`가 생기면 gain은 왜 감소하는가?
2. 추가 경로가 있을 때 small-signal load 저항은 어떻게 표현되는가?
3. 병렬 저항에서 전압과 전류는 각각 어떤 관계를 가지는가?
4. `VDD`는 small-signal model에서 왜 ground로 취급되는가?
5. 다음 DC 변화가 주어졌을 때 `gm`과 `Av`를 계산할 수 있는가?  
   - `ΔVin = 20mV`
   - `ΔId = 50μA`
   - `RD = 2kΩ`
6. Channel length modulation을 고려할 때 MOSFET small-signal model에 무엇이 추가되는가?
7. `ro`를 고려했을 때 기본 CS amplifier의 gain 식은 어떻게 바뀌는가?
8. `Rin`과 `Rout`은 각각 어떻게 정의하는가?
9. 앞 단의 출력이 다음 단의 입력으로 연결될 때 실제 입력 전압은 어떻게 계산하는가?
10. Multi-stage amplifier에서 전체 gain을 계산할 때 왜 stage 사이 voltage division을 고려해야 하는가?
11. Ideal current source load의 small-signal 저항은 얼마인가?
12. 실제 MOSFET current source load의 small-signal 저항은 무엇으로 결정되는가?
13. PMOS current source load를 small-signal로 그릴 때 gate와 source는 어떻게 취급되는가?
14. Diode-connected MOSFET의 small-signal 저항은 어떻게 유도하는가?
15. Diode-connected load를 가진 CS amplifier의 gain은 대략 어떤 형태로 결정되는가?
16. Source degeneration 저항 `RS`가 있을 때 gain 식을 유도할 수 있는가?
17. Source degeneration이 output resistance를 증가시키는 이유는 무엇인가?
18. `λ ≠ 0`일 때 degenerated CS stage의 출력 저항은 대략 어떻게 표현되는가?
19. Gain, `Rin`, `Rout`을 동시에 본다는 것은 왜 중요한가?
20. “Gain이 크다”는 것만으로 좋은 amplifier라고 단정할 수 없는 이유는 무엇인가?

---

## 확인이 필요한 불명확한 부분

다음은 STT 노이즈와 OCR 부정확성 때문에 강의 의도를 단정하기 어려운 구간들이다.

1. `[00:38] ~ [01:19]` 구간  
   - “3.3%”, “50mAh”, “40mAh”, “60mm” 등의 표현은 원래 전류 변화량, 예를 들어 `50μA`, `40μA` 등을 말한 것으로 추정되나 정확한 수치는 확인이 어렵다.

2. `[01:59]`의 추가 경로 임피던스 분석 그림  
   - `10mA`, `40mV`, `10mV`, `-gm/Rx` 등으로 보이는 텍스트가 있으나, 정확한 회로 조건과 수식은 판독이 불완전하다.

3. `[08:01] ~ [11:32]` 구간의 여러 전류/전압 표  
   - `918.75μA`, `609.375μA`, `506.25μA`, `302.5μA`, `-1.7V`, `-3.5V`, `+0.972V` 등이 나타나지만, 각 값이 어떤 조건에서 계산된 것인지 명확하지 않다.

4. `[28:28]` 부근의 `R_x` 관련 식  
   - `R_x = -Rsin`, `R_x = V_in / V_out + 1`, `R_x = V_in / V_out` 등으로 OCR되어 있어 원본 수식을 복원하기 어렵다.  
   - 가능성으로는 loading resistance, feedback resistance, 또는 Miller 효과 관련 저항 변환이 섞였을 수 있으나 단정은 피해야 한다.

5. `[42:27]`의 PMOS current source load gain 식  
   - `-qm (Rp/Ro1)`, `-qm (Ro1/Ro1)` 등으로 보여 원래는 `-gm (ro1 || ro2)` 또는 유사한 표현이었을 가능성이 높다.  
   - 하지만 정확한 표기와 회로 조건은 추가 확인이 필요하다.

6. Figure 7.11, 7.13, 7.15, 7.18, 7.19 관련 예제  
   - 로그상에서 각 figure의 정확한 topology와 예제 답안이 완전히 드러나지 않는다.  
   - 특히 Example 7.9, Example 7.10에서 `M1`과 `M2`가 identical하다는 조건 하의 output resistance 비교는 회로도가 불명확하여 정확한 수치 해석이 어렵다.

7. Body effect 포함 여부  
   - 로그에는 body effect에 대한 명확한 언급이 없다.  
   - 따라서 source degeneration이나 PMOS load 해석에서 body effect를 포함했는지 여부는 확인이 필요하다.

---

## Gemini 3.1 Flash-Lite

`google/gemini-3.1-flash-lite`

이 강의는 아날로그 IC 설계의 핵심인 **CS(Common Source) Amplifier**를 중심으로, 실제 회로 환경에서 발생하는 **Gain Reduction(이득 감소)** 현상과 이를 해석하기 위한 **Small-Signal Model**의 활용, 그리고 **Degeneration** 및 **Output Resistance**의 개념을 다룹니다.

---

## 1. 강의 주제 개요
*   **핵심 질문:** 왜 실제 회로에서는 이론적인 Gain($-g_m R_D$)보다 이득이 낮게 측정되는가?
*   **주요 내용:**
    *   추가적인 경로(Additional Path)가 이득에 미치는 영향
    *   Small-Signal Model과 실제 동작의 차이 이해
    *   Channel Length Modulation($\lambda \neq 0$)의 고려
    *   CS Amplifier의 Degeneration(소스 저항 추가) 효과 및 출력 저항($R_{out}$) 계산

---

## 2. 시간 순 핵심 흐름
*   **[00:38 ~ 04:40] Gain Reduction:** 회로에 추가적인 경로가 생기면 전류가 분산되어 $R_D$ 양단의 전압 변화가 줄어들고, 결과적으로 Gain이 감소함을 병렬 저항 개념으로 설명.
*   **[04:40 ~ 12:00] Small-Signal vs. Real:** Small-signal model에서 고정 전압 노드를 Ground로 처리하는 이유와, 실제 회로에서 발생하는 전압 변화가 어떻게 Gain을 깎아먹는지 분석.
*   **[12:32 ~ 14:03] Channel Length Modulation:** $\lambda \neq 0$일 때 MOSFET의 출력 저항($r_O$)이 회로에 미치는 영향.
*   **[15:13 ~ 35:20] Multi-stage & Impedance:** 증폭기가 다른 회로와 연결될 때 $R_{in}$, $R_{out}$이 전체 Gain에 미치는 영향(Loading Effect).
*   **[47:43 ~ 61:11] Diode-Connected Load & Degeneration:** 소스에 저항($R_S$)을 추가하여 선형성을 높이고 Gain을 조절하는 기법.
*   **[61:51 ~ 71:41] Output Resistance Calculation:** $\lambda \neq 0$ 조건에서 $R_{out}$을 구하는 방법.

---

## 3. 핵심 개념 및 수식
### 1) Gain Reduction (병렬 저항 효과)
회로에 추가적인 경로($R_x$)가 생기면, 전체 부하 저항은 $R_D \parallel R_x$가 됩니다.
*   **이유:** 원래 $R_D$로만 흐르던 전류가 다른 경로로 분산되어, 출력 노드의 전압 변화($\Delta V_{out}$)가 작아지기 때문입니다.
*   **수식:** $A_v = -g_m (R_D \parallel R_x)$

### 2) Channel Length Modulation ($\lambda \neq 0$)
MOSFET의 $I_D$는 $V_{DS}$에 따라 미세하게 변합니다.
*   **수식:** $I_D = \frac{1}{2}\mu_n C_{ox} \frac{W}{L} (V_{GS}-V_{TH})^2 (1 + \lambda V_{DS})$
*   **Small-Signal 해석:** 이를 모델링하면 드레인-소스 사이에 저항 $r_O = \frac{1}{\lambda I_{D0}}$가 병렬로 연결된 것으로 간주합니다.

### 3) Source Degeneration
소스 단에 저항 $R_S$를 추가하면:
*   **Gain:** $A_v \approx -\frac{g_m R_D}{1 + g_m R_S}$
*   **의미:** $R_S$가 피드백 역할을 하여 이득을 낮추는 대신, 회로의 선형성을 높이고 입력 임피던스를 증가시킵니다.

---

## 4. 헷갈리기 쉬운 포인트 / 자주 하는 실수
*   **"고정 전압 노드는 항상 Ground인가?"**: Small-signal 해석 시 $V_{DD}$를 Ground로 두는 것은 AC 관점에서 전압 변화가 없기 때문입니다. 하지만 실제 회로에서는 노드 간의 임피던스 관계를 항상 고려해야 합니다.
*   **$R_{in}$과 $R_{out}$의 혼동**: 증폭기를 연결할 때, 앞 단의 $R_{out}$과 뒷 단의 $R_{in}$이 전압 분배를 일으켜 실제 이득이 이론치보다 낮아지는 'Loading Effect'를 간과하지 마세요.
*   **$\lambda$의 영향**: $\lambda$가 0이 아니면 $r_O$가 항상 존재하며, 이는 Gain을 감소시키는 부하로 작용합니다.

---

## 5. 복습 체크리스트 (자가 점검)
1.  왜 회로에 경로가 추가되면 Gain이 감소하는가? (전류 분배와 전압 변화량의 관계)
2.  Small-signal model에서 $r_O$는 어디에 위치하며, 어떤 역할을 하는가?
3.  Source Degeneration($R_S$)이 있을 때와 없을 때의 Gain 차이를 수식으로 유도할 수 있는가?
4.  두 증폭기를 직렬로 연결할 때, 전체 Gain은 단순 곱($A_{v1} \times A_{v2}$)인가? (Loading effect 고려)

---

## 6. 확인이 필요한 불명확한 부분
*   [01:19] STT상 "50mAh", "40mAh" 등 전류 단위와 수치가 혼용되어 있으나, 문맥상 전압 변화($mV$)를 설명하는 과정으로 보입니다. 수치 자체보다는 **"전류 변화가 분산되어 전압 변화가 줄어든다"**는 개념적 흐름에 집중하세요.
*   [08:06] 타임라인 내 수치 변화($918.75\mu A \dots$)는 특정 회로 예제의 시뮬레이션 결과로 보이나, 일반적인 설계 원칙을 이해하는 데는 지장이 없습니다.

---

## Claude Haiku 4.5

`anthropic/claude-haiku-4.5`

# 강의 주제 개요

이 강의는 **Common Source (CS) Amplifier의 특성 분석**을 중심으로, 회로에 추가 경로(additional path)가 생겼을 때 이득이 어떻게 감소하는지를 다룹니다. 핵심은 다음과 같습니다:

1. **Small-signal model vs. 실제 동작**: 이상적인 모델과 현실의 차이 이해
2. **병렬 저항의 개념**: 추가 경로로 인한 임피던스 변화
3. **Channel length modulation (λ ≠ 0)**: MOSFET의 출력 저항 ro 고려
4. **입출력 임피던스의 중요성**: 다단 증폭기 설계에서 Rin, Rout의 영향
5. **CS Amplifier의 변형**: 전류 소스 부하, 다이오드 연결 부하, 소스 디제너레이션(source degeneration)

---

## 시간 순 핵심 흐름 (타임스탬프 구간별)

### [00:38~01:59] 추가 경로에 의한 이득 감소 현상

**핵심 개념:**
- 기본 CS 증폭기에서 드레인 저항 Rd만 있을 때: 출력 전압 변화가 크다
- 추가 경로(Rx)가 병렬로 연결되면: 유효 부하 저항이 감소 → 출력 전압 변화가 작아짐
- 예시: 입력 변화 50mA → 40mA로 감소하면, 출력 전압 변화도 줄어듦

**물리적 의미:**
전류가 여러 경로로 분산되므로, 같은 입력 신호에 대해 드레인 전류의 변화량이 감소하고, 결과적으로 Vout의 변화도 작아진다.

---

### [02:29~04:09] 병렬 저항(Parallel Resistor) 복습

**기본 원리:**
- 두 저항이 병렬 연결되면, 같은 전압이 양쪽에 가해짐
- 전류는 저항값에 반비례하여 분배됨
- 예: Vy = 5V, R1 = 5kΩ, R2 = 2kΩ일 때
  - I1 = 5V / 5kΩ = 1mA
  - I2 = 5V / 2kΩ = 2.5mA
  - 전체 전류 = 3.5mA

**회로 설계에서의 의미:**
추가 경로가 생기면 유효 저항 = (Rd × Rx) / (Rd + Rx) 로 감소한다.

---

### [04:40~05:45] Small-signal Model vs. 실제 동작

**핵심 차이점:**

| 항목 | Small-signal Model | 실제 동작 |
|------|-------------------|---------|
| 바이어스점 | 고정 | 고정 |
| 입력 신호 | 작은 신호만 고려 | 신호에 따라 동작점 변함 |
| 출력 임피던스 | Rd만 고려 | Rd와 ro (channel length modulation) |
| 이득 | -gm × Rd | -gm × (Rd ∥ ro) |

**구체적 예시:**
- VDD = 3.3V, Rd = 2kΩ, Id = 1mA
- Vout = 3.3V - 1mA × 2kΩ = 1.3V
- Vin 변화: 1V → 1.02V (+20mV)
- Vout 변화: 1.3V → 1.2V (-100mV)
- 이는 small-signal gain = -100mV / 20mV = -5 V/V

---

### [06:50~08:06] Small-signal Model에서 고정 전압 노드는 접지

**중요한 개념:**
- Small-signal 분석에서는 DC 바이어스점이 고정되어 있다고 가정
- 따라서 VDD, VSS 같은 전원은 AC 신호 관점에서 **접지(ground)**로 취급
- 이는 AC 신호 경로 분석을 단순화함

**실무적 의미:**
- 회로 해석 시 DC 성분과 AC 성분을 분리
- 커패시터는 AC 신호는 통과, DC는 차단
- 전원 라인은 AC 임피던스 관점에서 0Ω

---

### [10:57~12:17] 추가 경로가 이득을 감소시키는 메커니즘

**상황 분석:**

원래 회로:
- Gain = -gm × Rd
- 예: gm = 50mS, Rd = 2kΩ → Gain = -100 V/V

추가 경로 후:
- Gain = -gm × (Rd ∥ Rx ∥ R3 ∥ ...)
- 유효 부하 저항이 감소 → 이득 크기 감소

**핵심 통찰:**
이는 앞서 본 "병렬 저항" 개념과 동일하다. 추가 경로는 드레인 노드에서 보는 임피던스를 감소시킨다.

---

### [12:32~13:53] Channel Length Modulation (λ ≠ 0) 고려

**MOSFET 전류 방정식:**

$$I_D = \frac{1}{2}\mu C_{ox}\frac{W}{L}(V_{GS} - V_{TH})^2(1 + \lambda V_{DS})$$

이를 정리하면:

$$I_D = I_{D0} + \frac{\lambda I_{D0}}{1} \cdot V_{DS} = I_{D0} + \frac{V_{DS}}{r_o}$$

여기서 $r_o = \frac{1}{\lambda I_{D0}}$ (출력 저항)

**물리적 의미:**
- λ = 0: 이상적 MOSFET (출력 저항 무한대)
- λ ≠ 0: 실제 MOSFET (출력 저항 ro 유한)
- ro는 드레인 노드에 병렬로 연결된 저항처럼 작용

**회로 해석에서의 영향:**
- 실제 이득: $A_v = -g_m(R_d \parallel r_o)$
- ro가 작을수록 이득이 더 감소

---

### [14:03~15:23] CS Amplifier의 이득 (Channel length modulation 포함)

**일반적 형태:**

$$A_v = -g_m(R_d \parallel r_o)$$

**이득이 감소하는 두 가지 원인:**
1. **추가 경로**: 외부 회로에서 드레인 노드로 연결되는 임피던스
2. **Channel length modulation**: MOSFET 내부의 출력 저항 ro

---

### [15:08~15:59] 입출력 임피던스의 중요성

**왜 Rin과 Rout이 중요한가?**

증폭기는 독립적으로 존재하지 않고, 항상 다른 회로와 연결된다:
- 입력: 신호원 → 증폭기 입력
- 출력: 증폭기 출력 → 다음 단계 입력

**정의:**
- **Rin (입력 저항)**: 증폭기 입력 노드에서 보는 임피던스
- **Rout (출력 저항)**: 증폭기 출력 노드에서 보는 임피던스 (입력 단락)

---

### [21:36~24:57] 출력 단계에서의 추가 경로 효과

**상황:**
- Vin 증가 → Vout 감소 (반전 증폭)
- 출력 노드에 다음 단계의 입력 저항 Rin이 연결됨
- 이는 드레인 노드에 추가 경로를 만듦

**결과:**
- 유효 부하 저항: Rd ∥ Rin
- 이득 감소: $A_v = -g_m(R_d \parallel R_{in,next})$

**핵심 개념:**
출력 저항 Rout는 "출력 노드에서 보는 임피던스"이며, 이것이 다음 단계의 입력 저항과 분압을 형성한다.

---

### [29:13~30:28] 다단 증폭기의 이득 계산

**일반 원칙:**

두 회로 A, B가 연결될 때, 전체 이득은:

$$A_{total} = A_A \times \frac{R_{in,B}}{R_{out,A} + R_{in,B}}$$

**다단 증폭기:**

$$A_{total} = A_1 \times \frac{R_{in,2}}{R_{out,1} + R_{in,2}} \times A_2 \times \frac{R_{in,3}}{R_{out,2} + R_{in,3}} \times A_3$$

**설계 원칙:**
- Rout는 작을수록 좋음 (다음 단계에 영향 최소화)
- Rin은 클수록 좋음 (이전 단계에 부하 최소화)

---

### [35:35~42:27] CS Amplifier의 세 가지 특성 (Av, Rin, Rout)

**CS Amplifier 기본 구조:**
- 입력: 게이트 (고임피던스)
- 출력: 드레인 (Rd 부하)
- 소스: 접지 또는 디제너레이션 저항

**세 가지 특성을 동시에 고려해야 하는 이유:**
1. **Av**: 신호 증폭 정도
2. **Rin**: 입력 신호원에 대한 부하
3. **Rout**: 출력이 다음 단계에 미치는 영향

---

### [42:27~49:53] PMOS CS Stage 및 다이오드 연결 부하

**PMOS CS Stage:**
- NMOS 전류 소스를 부하로 사용
- 이득: $A_v = -g_{m1}(r_{o1} \parallel r_{o2})$
- 두 MOSFET의 출력 저항이 병렬로 작용

**다이오드 연결 부하 (Diode-connected Load):**
- M2의 게이트를 드레인에 연결
- M2는 항상 포화 영역에서 동작
- M2의 드레인에서 보는 저항: $R_x = \frac{1}{g_{m2}}$

**유도 과정:**
$$V_x = V_x - V_{out}$$
$$-g_m V_x = I_x$$
$$R_x = \frac{V_x}{I_x} = \frac{1}{g_m}$$

---

### [51:34~61:11] CS Stage with Diode-Connected Load 분석

**회로 구성:**
- M1: 입력 MOSFET (CS 구조)
- M2: 다이오드 연결 부하
- 출력 저항: $R_{out} = r_{o1} \parallel \frac{1}{g_{m2}} \parallel r_{o2}$

**이득 계산 (λ = 0):**
$$A_v = -g_{m1} \times \frac{1}{g_{m2}}$$

**이득 계산 (λ ≠ 0):**
$$A_v = -g_{m1}(r_{o1} \parallel \frac{1}{g_{m2}} \parallel r_{o2})$$

---

### [54:40~61:51] CS Stage with Source Degeneration

**소스 디제너레이션의 목적:**
- 소스 저항 Rs를 추가하여 회로의 선형성 개선
- 이득 감소 (trade-off)
- 입출력 임피던스 변화

**이득 계산 (λ = 0):**

Small-signal 분석:
- 게이트 입력: vin
- 소스 전압: vs = gm × v1 × Rs (여기서 v1 = vin - vs)
- 따라서: vs = gm × (vin - vs) × Rs
- vs(1 + gm × Rs) = gm × vin × Rs
- vs = gm × vin × Rs / (1 + gm × Rs)

출력 전압:
$$v_{out} = -g_m v_1 \times R_d = -g_m(v_{in} - v_s) \times R_d$$

$$A_v = \frac{v_{out}}{v_{in}} = \frac{-g_m R_d}{1 + g_m R_s}$$

**물리적 의미:**
- 분모의 (1 + gm × Rs)를 "피드백 인수"라 함
- Rs가 클수록 이득이 감소
- 하지만 입력 임피던스와 선형성이 개선됨

---

### [63:52~70:21] 출력 저항 계산 (Source Degeneration 포함)

**λ = 0일 때:**
$$R_{out} = R_d$$

**λ ≠ 0일 때:**

출력 노드에서 테스트 전압 vx를 인가하면:
- M1의 게이트-소스 전압 변화: Δvgs = -Δvs (소스가 vx에 따라 변함)
- 소스 전류: Δis = gm × Δvgs + vx / ro
- 출력 전류: ix = Δis + vx / Rd

따라서:
$$R_{out} = \frac{v_x}{i_x} = R_d \parallel (r_o + g_m \times r_o \times R_s)$$

$$R_{out} = R_d \parallel r_o(1 + g_m R_s)$$

**핵심:**
- Source degeneration은 출력 저항도 증가시킴 (ro에 (1 + gm × Rs) 인수 추가)
- 이는 회로의 임피던스 특성을 개선

---

### [68:55~71:41] 복합 구조 예제 (M1, M2 동일)

**회로 구성:**
- M1: 입력 MOSFET (소스 디제너레이션 있음)
- M2: 전류 소스 부하 (또는 다이오드 연결)

**출력 저항:**
$$R_{out} = r_{o1}(1 + g_{m1}R_s) \parallel r_{o2}$$

또는 M2가 다이오드 연결일 때:
$$R_{out} = r_{o1}(1 + g_{m1}R_s) \parallel \frac{1}{g_{m2}} \parallel r_{o2}$$

---

## 핵심 개념 및 수식 (유도 과정 포함)

### 1. 병렬 저항 (Parallel Resistance)

**기본 공식:**
$$R_{eq} = \frac{R_1 \times R_2}{R_1 + R_2} = \frac{1}{\frac{1}{R_1} + \frac{1}{R_2}}$$

**회로 설계에서의 의미:**
- 추가 경로가 생기면 유효 저항이 감소
- 예: Rd = 2kΩ, Rx = 4kΩ → Req = 1.33kΩ

---

### 2. Channel Length Modulation (λ ≠ 0)

**MOSFET 전류 방정식:**
$$I_D = \frac{1}{2}\mu C_{ox}\frac{W}{L}(V_{GS} - V_{TH})^2(1 + \lambda V_{DS})$$

**정리:**
$$I_D = I_{D0}(1 + \lambda V_{DS})$$

여기서 $I_{D0} = \frac{1}{2}\mu C_{ox}\frac{W}{L}(V_{GS} - V_{TH})^2$

**출력 저항 정의:**
$$r_o = \frac{\partial V_{DS}}{\partial I_D}\bigg|_{V_{GS}=const} = \frac{1}{\lambda I_{D0}}$$

**물리적 의미:**
- λ는 채널 길이 변조 계수 (channel length modulation parameter)
- 드레인-소스 전압이 증가하면 채널 길이가 감소 → 전류 증가
- ro는 이 효과를 저항으로 모델링한 것

---

### 3. CS Amplifier의 이득

**이상적 경우 (λ = 0, ro → ∞):**
$$A_v = -g_m R_d$$

**실제 경우 (λ ≠ 0):**
$$A_v = -g_m(R_d \parallel r_o)$$

**다음 단계와 연결된 경우:**
$$A_v = -g_m(R_d \parallel r_o \parallel R_{in,next})$$

**유도:**
- 드레인 전류: id = gm × vgs
- 드레인 전압: vd = -id × (Rd ∥ ro ∥ Rin,next)
- 이득: Av = vd / vin = -gm × (Rd ∥ ro ∥ Rin,next)

---

### 4. 다단 증폭기의 이득

**두 단계 연결:**

$$A_{total} = A_1 \times \frac{R_{in,2}}{R_{out,1} + R_{in,2}} \times A_2$$

**유도 과정:**
1. 첫 번째 단계 출력: V1 = A1 × Vin
2. 분압: V1' = V1 × Rin,2 / (Rout,1 + Rin,2)
3. 두 번째 단계 출력: Vout = A2 × V1'
4. 전체: Vout/Vin = A1 × A2 × Rin,2 / (Rout,1 + Rin,2)

**다단 증폭기:**
$$A_{total} = \prod_{i=1}^{n-1} \left(A_i \times \frac{R_{in,i+1}}{R_{out,i} + R_{in,i+1}}\right) \times A_n$$

---

### 5. CS Amplifier with Source Degeneration

**회로 구성:**
- 소스에 저항 Rs 추가
- 드레인에 부하 저항 Rd

**이득 계산 (λ = 0):**

Small-signal 등가 회로:
- 입력: vin
- 게이트-소스 전압: vgs = vin - vs
- 소스 전압: vs = gm × vgs × Rs = gm × (vin - vs) × Rs

정리:
$$v_s(1 + g_m R_s) = g_m v_{in} R_s$$
$$v_s = \frac{g_m R_s}{1 + g_m R_s} v_{in}$$

드레인 전류:
$$i_d = g_m v_{gs} = g_m(v_{in} - v_s) = \frac{g_m}{1 + g_m R_s} v_{in}$$

출력 전압:
$$v_{out} = -i_d R_d = -\frac{g_m R_d}{1 + g_m R_s} v_{in}$$

**이득:**
$$A_v = \frac{v_{out}}{v_{in}} = -\frac{g_m R_d}{1 + g_m R_s}$$

**특수한 경우:**
- Rs = 0: Av = -gm × Rd (일반적인 CS 증폭기)
- Rs → ∞: Av → -Rd / Rs (저항 분압 모드)

---

### 6. 출력 저항 (Output Resistance)

**정의:**
출력 노드에 테스트 전압 vx를 인가했을 때, 입력을 단락(vin = 0)한 상태에서 흐르는 전류 ix에 대해:
$$R_{out} = \frac{v_x}{i_x}$$

**CS Amplifier (λ = 0):**
$$R_{out} = R_d$$

**CS Amplifier with Source Degeneration (λ ≠ 0):**

테스트 신호 vx 인가:
- 소스 전압 변화: Δvs = -Δvx (출력과 소스가 함께 움직임)
- 게이트-소스 전압 변화: Δvgs = 0 - Δvs = Δvx
- 소스에서의 전류: is = gm × Δvx + vx / ro
- 드레인에서의 전류: ix = is + vx / Rd

$$R_{out} = \frac{v_x}{i_x} = R_d \parallel (r_o + g_m r_o R_s) = R_d \parallel r_o(1 + g_m R_s)$$

**물리적 의미:**
- Source degeneration은 출력 저항을 증가시킴
- (1 + gm × Rs) 인수: 피드백 인수 (feedback factor)

---

### 7. 다이오드 연결 부하 (Diode-Connected Load)

**구조:**
- M2의 게이트를 드레인에 연결
- M2는 항상 포화 영역에서 동작

**M2의 드레인에서 보는 저항:**

테스트 신호 vx 인가:
- 게이트-소스 전압 변화: Δvgs = Δvx (게이트와 드레인이 같음)
- 드레인 전류: Δid = gm × Δvx
- 저항: Rx = vx / id = 1 / gm

$$R_x = \frac{1}{g_{m2}}$$

**이득 (λ = 0):**
$$A_v = -g_{m1} \times \frac{1}{g_{m2}}$$

**이득 (λ ≠ 0):**
$$A_v = -g_{m1}(r_{o1} \parallel \frac{1}{g_{m2}} \parallel r_{o2})$$

---

## 헷갈리기 쉬운 포인트 / 자주 하는 실수

### 1. Small-signal Model에서 전원은 접지가 아니다?

**오해:**
"Small-signal 분석에서 VDD를 접지로 취급하는 것은 잘못된 것 아닌가?"

**정정:**
- **DC 관점**: VDD는 고정된 전압 (예: 3.3V)
- **AC 신호 관점**: VDD는 변하지 않으므로, AC 신호 경로에서는 0V (접지)
- 즉, **AC 임피던스 관점에서만** VDD를 접지로 취급
- 이는 회로 해석을 단순화하기 위한 **수학적 도구**일 뿐

**실무 팁:**
회로를 분석할 때 DC 성분과 AC 성분을 명확히 분리하세요.

---

### 2. 이득이 감소하는 이유를 "부하 저항 감소"로만 생각하기

**오해:**
"추가 경로가 생기면 이득이 감소한다"는 것을 단순히 외우기

**정정:**
**근본 원인:**
1. 드레인 노드의 유효 임피던스 감소
2. 같은 드레인 전류 변화에 대해 전압 변화가 작아짐
3. 결과적으로 이득 = gm × (유효 부하) 감소

**수식으로 이해:**
$$A_v = -g_m R_{eff}$$
$$R_{eff} = R_d \parallel R_x \parallel R_{in,next}$$

추가 경로가 생기면 Reff가 감소 → Av 감소

---

### 3. Channel Length Modulation (λ)의 의미 혼동

**오해:**
"λ는 그냥 작은 파라미터일 뿐, 무시해도 된다"

**정정:**
- λ는 MOSFET의 **비이상적 특성**을 나타냄
- 실제 MOSFET은 항상 λ ≠ 0
- 출력 저항 ro = 1/(λ × ID0)는 회로 성능에 **큰 영향**
- 특히 이득, 출력 임피던스, 주파수 응답에 중요

**설계 관점:**
- 이득을 높이려면 ro를 크게 (λ를 작게) 해야 함
- 채널 길이 L을 크게 하면 λ 감소 (면적 증가의 trade-off)

---

### 4. 입출력 임피던스를 "단순한 저항값"으로만 생각하기

**오해:**
"Rin과 Rout은 그냥 입력/출력에 있는 저항이다"

**정정:**
- **Rin**: 입력 신호원이 "보는" 임피던스
  - 신호원의 내부 저항과 분압을 형성
  - 작을수록 신호 손실 적음
- **Rout**: 출력 노드에서 "보는" 임피던스
  - 다음 단계의 입력 저항과 분압을 형성
  - 작을수록 다음 단계에 영향 적음

**다단 증폭기에서:**
$$A_{total} = A_1 \times \frac{R_{in,2}}{R_{out,1} + R_{in,2}} \times A_2 \times \cdots$$

Rout,1이 크면 Rin,2와 분압 → 전체 이득 감소

---

### 5. Source Degeneration의 trade-off 이해 부족

**오해:**
"Source degeneration은 이득을 감소시키므로 나쁘다"

**정정:**
Source degeneration의 **장점:**
1. **선형성 개선**: 입력 신호에 대한 응답이 더 선형적
2. **입력 임피던스 증가**: 신호원에 대한 부하 감소
3. **출력 임피던스 증가**: 다음 단계와의 임피던스 매칭 개선
4. **주파수 응답 개선**: 대역폭 확대

**trade-off:**
- 이득 감소: Av = -gm × Rd / (1 + gm × Rs)
- Rs가 클수록 이득 감소, 하지만 선형성 개선

**설계 원칙:**
필요한 이득과 선형성의 균형을 맞춰 Rs 선택

---

### 6. 다이오드 연결 부하의 저항을 1/gm으로 계산하는 과정 생략

**오해:**
"다이오드 연결 부하의 저항은 1/gm이다" (이유 없이 외우기)

**정정:**
**유도 과정:**

다이오드 연결: Vg = Vd

테스트 신호 vx 인가:
- 게이트 전압 변화: Δvg = Δvx
- 드레인 전압 변화: Δvd = Δvx (같음)
- 게이트-소스 전압 변화: Δvgs = Δvg - Δvs = Δvx - 0 = Δvx
- 드레인 전류 변화: Δid = gm × Δvgs = gm × Δvx
- 저항: Rx = Δvx / Δid = 1/gm

**핵심:**
게이트와 드레인이 연결되어 있으므로, 게이트-소스 전압 변화 = 드레인 전압 변화

---

### 7. 출력 저항 계산에서 피드백 인수 (1 + gm × Rs) 이해 부족

**오해:**
"출력 저항 = ro + gm × ro × Rs 이건 그냥 공식이다"

**정정:**
**물리적 의미:**

테스트 신호 vx 인가 (입력 단락):
1. 드레인 전압 상승 → 소스 전압도 상승 (Rs를 통해)
2. 게이트-소스 전압 감소 → 드레인 전류 감소
3. 이는 **음의 피드백** 효과
4. 결과: 출력 저항 증가

**수식:**
$$R_{out} = r_o(1 + g_m R_s)$$

- (1 + gm × Rs): 피드백 인수
- gm × Rs >> 1이면 Rout ≈ gm × ro × Rs (매우 큼)

**설계 의미:**
Source degeneration은 출력 저항을 크게 만들어 회로를 더 "경직"되게 함 (stiff)

---

## 복습 체크리스트 (자가 점검 질문)

### 기본 개념 이해

- [ ] 병렬 저항 공식을 유도할 수 있는가?
- [ ] Small-signal model에서 왜 전원을 접지로 취급하는가?
- [ ] Channel length modulation (λ)이 무엇이고, 왜 중요한가?
- [ ] 출력 저항 ro = 1/(λ × ID0)를 유도할 수 있는가?

### CS Amplifier 분석

- [ ] 기본 CS 증폭기의 이득 Av = -gm × Rd를 유도할 수 있는가?
- [ ] λ ≠ 0일 때 이득이 어떻게 변하는가?
- [ ] 다음 단계의 입력 저항이 이득에 미치는 영향을 설명할 수 있는가?

### 입출력 임피던스

- [ ] Rin과 Rout의 정의를 명확히 할 수 있는가?
- [ ] 다단 증폭기에서 Rin과 Rout이 전체 이득에 미치는 영향을 설명할 수 있는가?
- [ ] 왜 Rout는 작고 Rin은 커야 하는가?

### Source Degeneration

- [ ] Source degeneration이 이득을 감소시키는 이유를 설명할 수 있는가?
- [ ] Source degeneration의 장점은 무엇인가?
- [ ] 이득 공식 Av = -gm × Rd / (1 + gm × Rs)를 유도할 수 있는가?
- [ ] 출력 저항 공식 Rout = Rd ∥ ro(1 + gm × Rs)를 유도할 수 있는가?

### 다이오드 연결 부하

- [ ] 다이오드 연결 부하의 저항이 1/gm인 이유를 설명할 수 있는가?
- [ ] 다이오드 연결 부하를 사용할 때의 이득은?
- [ ] 다이오드 연결 부하의 장점과 단점은?

### 종합 설계 문제

- [ ] 주어진 CS 증폭기 회로에서 Av, Rin, Rout을 모두 계산할 수 있는가?
- [ ] 두 개의 CS 증폭기를 연결했을 때 전체 이득을 계산할 수 있는가?
- [ ] 이득을 높이려면 어떤 설계 변수를 조정해야 하는가?
- [ ] 선형성을 개선하려면 어떤 설계 변수를 조정해야 하는가?

---

## 확인이 필요한 불명확한 부분 (STT 노이즈로 인해 판독 불가능했던 구간)

### 1. [00:38~01:59] 음성 부분

**문제:**
"50mAh가 추가가 되었다면, 근데 지금 50mAh가 40mAh가 줄어드릴 수도 있는 거잖아요"

**해석:**
- 원래 드레인 전류 변화: 50mA
- 추가 경로 후 드레인 전류 변화: 40mA (감소)
- 결과: 출력 전압 변화도 감소

**확인 필요:**
정확한 수치가 무엇인지, 그리고 이것이 어떤 시뮬레이션 결과인지

---

### 2. [01:19~01:59] 음성 부분

**문제:**
"60mm가 나눠서 한다면 내가 이거 알디의 전화 차이가 원래는 이 전류 변화에서 50mg이 밝은 전화가 이 발생했던 게 40mg이 밝은 정도로"

**해석:**
전류가 여러 경로로 분산되면서 각 경로의 전류 변화가 감소한다는 의미로 보임

**확인 필요:**
정확한 전류값과 경로 분석

---

### 3. [08:01~09:19] 음성 부분

**문제:**
"918.75μA → 609.375μA → 506.25μA" 등의 수치가 나타나지만, 이것이 무엇을 나타내는지 불명확

**해석:**
아마도 다양한 바이어스 조건에서의 드레인 전류 값으로 보임

**확인 필요:**
이 수치들이 어떤 회로 조건에서 나온 것인지

---

### 4. [15:18~15:23] "Can You Repeat What Really Happens" 섹션

**문제:**
"100mA, 80mA, 1mA, 1.14mA" 등의 수치와 "Ro" 표기가 있지만 맥락이 불명확

**해석:**
아마도 추가 경로가 있을 때와 없을 때의 전류 비교로 보임

**확인 필요:**
정확한 회로 구성과 이 수치들의 의미

---

### 5. [21:59~24:00] 음성 부분

**문제:**
"이 x브에이스에 벌싶은 거죠" 등 단어가 명확하지 않음

**해석:**
아마도 "이 Rx에 대해서" 또는 "이 추가 저항에 대해서"라는 의미로 보임

**확인 필요:**
정확한 용어와 설명

---

### 6. [40:40~41:20] CS Amp with PMOS Current Source 섹션

**문제:**
"-qm (Rp/Ro1), -qm (Ro1/Ro1)" 등의 표기가 명확하지 않음

**해석:**
아마도 이득 계산 과정에서 gm과 ro의 조합으로 보임

**확인 필요:**
정확한 이득 공식과 유도 과정

---

### 7. [51:34~51:49] Diode-Connected Load 섹션

**문제:**
"Rx = Vx / Ix, gm(V) = I / V" 등의 표기가 혼재되어 있음

**해석:**
다이오드 연결 부하의 저항을 유도하는 과정으로 보임

**확인 필요:**
정확한 유도 과정과 최종 결과

---

### 8. [59:46~61:11] CS Stage with Degeneration 이득 계산

**문제:**
"gain = (1 / (f(qm)Rs))" 등의 표기가 명확하지 않음

**해석:**
아마도 이득 = -gm × Rd / (1 + gm × Rs) 형태로 보임

**확인 필요:**
정확한 이득 공식

---

### 9. [63:52~68:55] 출력 저항 계산 섹션

**문제:**
"Rout = (vx) / (ix), (RII/Ro = Rout)" 등의 표기가 혼재

**해석:**
출력 저항을 계산하는 과정으로 보임

**확인 필요:**
정확한 계산 과정과 최종 공식

---

## 추가 학습 자료 추천

### 개념 강화를 위한 연습 문제

**문제 1:** 
기본 CS 증폭기에서 gm = 50mS, Rd = 2kΩ, ro = 10kΩ일 때:
- (a) λ = 0인 경우 이득을 계산하시오
- (b) λ ≠ 0인 경우 이득을 계산하시오
- (c) 다음 단계의 Rin = 5kΩ이 연결된 경우 이득을 계산하시오

**문제 2:**
Source degeneration이 있는 CS 증폭기에서 gm = 50mS, Rd = 2kΩ, Rs = 100Ω일 때:
- (a) 이득을 계산하시오
- (b) Source degeneration이 없는 경우와 비교하시오
- (c) Rs를 200Ω으로 증가시키면 이득이 어떻게 변하는가?

**문제 3:**
다이오드 연결 부하를 사용하는 CS 증폭기에서 gm1 = 50mS, gm2 = 30mS, ro1 = 10kΩ, ro2 = 15kΩ일 때:
- (a) λ = 0인 경우 이득을 계산하시오
- (b) λ ≠ 0인 경우 이득을 계산하시오

---

## 최종 정리: 강의의 핵심 메시지

이 강의의 **가장 중요한 메시지**는 다음과 같습니다:

### 1. "추가 경로 = 이득 감소"의 원리 이해

회로에 추가 경로가 생기면:
- 드레인 노드의 유효 임피던스 감소
- 같은 입력 신호에 대해 출력 전압 변화 감소
- 결과: 이득 감소

이는 **병렬 저항** 개념으로 완전히 설명됨.

### 2. Small-signal Model의 한계 인식

Small-signal model은 편리하지만:
- Channel length modulation (λ ≠ 0) 무시
- 실제 출력 저항 ro 무시
- 다음 단계의 입력 저항 영향 무시

**실제 설계에서는 이 모든 요소를 고려해야 함.**

### 3. 입출력 임피던스의 중요성

증폭기는 독립적으로 존재하지 않음:
- 입력: 신호원의 내부 저항과 분압
- 출력: 다음 단계의 입력 저항과 분압

**다단 증폭기의 전체 이득은 각 단계의 Av, Rin, Rout의 조합으로 결정됨.**

### 4. 설계의 Trade-off 이해

모든 설계 변수는 trade-off 관계:
- **이득 vs. 선형성**: Source degeneration
- **이득 vs. 출력 저항**: Channel length modulation
- **이득 vs. 입력 임피던스**: 부하 저항 선택

**최적 설계는 이 trade-off를 균형있게 조정하는 것.**

---

이 강의 자료가 여러분의 아날로그 IC 설계 학습에 도움이 되기를 바랍니다!

---

## Claude Sonnet 5

`anthropic/claude-sonnet-5`

# 전자회로 강의 요약: Loading Effect와 CS Amplifier의 Gain/Rin/Rout 분석

## 강의 주제 개요

이 강의는 **"실제 회로에서 증폭기가 다른 회로와 연결될 때 발생하는 영향"**을 중심 주제로 다룹니다. 핵심 흐름은 다음과 같습니다:

1. 이상적인 small-signal model에서 벗어나 **추가 경로(additional path)가 생기면 Gain이 왜 줄어드는지** 직관적으로 이해
2. Small-signal model의 근본 원리(고정 전압 노드 = ground) 복습
3. 이를 바탕으로 **Rin, Rout의 정의와 필요성** 학습
4. **Multi-stage amplifier**에서 Rin/Rout이 전체 Gain에 미치는 영향
5. **CS Amplifier**를 대상으로 실제로 Av, Rin, Rout을 유도하는 연습 (ideal current source, PMOS current source, diode-connected load, degeneration 등 다양한 topology)

즉, "이상적인 Av = -gmRd"만 외우는 것이 아니라, **실제 연결 상황에서 Rin/Rout까지 고려한 정확한 회로 해석 능력**을 기르는 것이 이 강의의 목표입니다.

---

## 시간 순 핵심 흐름

| 구간 | 내용 |
|---|---|
| 00:38~02:29 | Additional path가 생겼을 때 Gain이 감소하는 현상을 직관적으로 소개 (Rd와 Rx가 병렬로 보이는 상황) |
| 02:29~04:40 | Parallel Resistor 기초 복습 (전류 분배, KVL/KCL 적용) |
| 04:40~10:57 | Small-signal model vs. 실제 동작 비교. VDD처럼 고정된 노드는 small-signal 관점에서 ground로 취급됨을 예시로 설명 |
| 10:57~12:32 | "Added Path Reduces Voltage Change" 개념을 수치 예제로 재확인 |
| 12:32~14:03 | Channel Length Modulation(λ)을 large-signal model에 반영 → ro 개념 도출 |
| 14:03~15:13 | Channel length modulation이 있을 때와 없을 때 CS Amplifier의 Gain 비교 |
| 15:13~15:18 | **Rin, Rout의 정의** 최초 제시 (Circuit A/B 구조로 측정 방법 설명) |
| 15:23~29:13 | 출력 노드에 다른 회로가 연결되었을 때 Vout이 어떻게 영향받는지 반복 설명 (Rx가 "보이는 저항"으로 작용) |
| 29:13~35:10 | **General case**: Voltage in, Voltage out 시스템에서 Gain이 Rout/(Rout+Rin)에 의해 어떻게 변하는지, Multi-stage에서 각 단의 Rin/Rout이 곱해지는 형태로 전체 Gain에 영향을 줌 |
| 35:35~37:55 | CS Amplifier에서 Av, Rin, Rout을 동시에 구하는 것이 왜 중요한지 강조 |
| 37:55~40:56 | Ideal current source를 bias로 사용하는 CS Amp의 Gain 유도 |
| 40:56~47:43 | PMOS current source를 사용하는 CS Amp, PMOS 취급 방법 설명 |
| 47:43~54:09 | Diode-connected load를 가진 CS stage에서 M2의 저항(1/gm)을 source에서 바라본 관점으로 유도 |
| 54:09~61:11 | **CS Stage with Degeneration**의 Gain 유도 (Rs가 소스에 추가된 경우) |
| 61:11~71:41 | Degeneration이 있는 CS stage의 **Output Resistance**를 λ=0, λ≠0 두 가지 경우로 유도, 이후 두 개의 MOSFET(M1, M2)을 사용하는 example들로 확장 |

---

## 핵심 개념 및 수식 (유도 과정 및 연결 관계)

### 1. Additional Path가 Gain을 줄이는 이유

기본 CS amp에서는:
$$V_{out} = V_{DD} - I_D R_D, \quad Gain = -g_m R_D$$

여기에 출력 노드에 또 다른 경로(저항 Rx)가 추가되면, 전체 출력 전류가 Rd와 Rx로 나뉘어 흐르게 됩니다. 결과적으로 Rd 하나만 있을 때보다 **유효 저항이 Rd || Rx로 감소**하므로:
$$Gain = -g_m (R_D \| R_x)$$

→ **"경로가 늘어나면 전류가 분산되어 전압 변화량이 작아진다"**는 직관이 핵심입니다. 이는 이후 Rin/Rout 개념, degeneration, current source load 등 모든 topology 분석에서 반복적으로 사용되는 사고방식입니다.

### 2. Small-Signal Model: 고정 전압 노드 = Ground

VDD, GND처럼 **DC 관점에서 값이 고정된 노드는 small-signal(AC) 관점에서는 변화가 없으므로 접지(0V)로 취급**합니다. 이는 이후 모든 small-signal 회로 해석(KVL/KCL 적용)의 기본 전제이며, 여기서 실수하면 이후 Rin, Rout, Gain 계산이 전부 틀어집니다.

### 3. Channel Length Modulation과 ro

Large-signal model:
$$I_D = \frac{1}{2}\mu C_{ox}\frac{W}{L}(V_{GS}-V_{TH})^2(1+\lambda V_{DS})$$

이를 전개하면:
$$I_D = I_{D0} + \lambda I_{D0} V_{DS} = I_{D0} + \frac{V_{DS}}{r_o}, \quad r_o = \frac{1}{\lambda I_{D0}}$$

→ **λ≠0일 때 MOSFET의 drain-source 사이에 저항 ro가 추가로 존재**하는 것으로 모델링됩니다. 이 ro가 바로 앞서 배운 "additional path"의 실체이며, CS Amp의 Gain에 직접 영향을 줍니다:
$$Gain = -g_m(R_D \| r_o)$$

### 4. Rin, Rout의 정의와 필요성

- **Rin**: 회로의 입력에서 "보이는" 저항. Circuit B(다음 단)의 입력 쪽에서 test voltage/current를 걸어 측정
- **Rout**: 회로의 출력에서 "보이는" 저항. Circuit A(이전 단)의 출력을 0으로 만들고(즉 입력 소스 제거) 출력 노드에 test source를 걸어 측정

**왜 필요한가?** 실제 회로는 항상 앞뒤에 다른 회로와 연결되므로, 단독 Gain(-gmRd)만으로는 실제 동작을 설명할 수 없습니다. Circuit A의 출력이 Circuit B의 입력에 연결될 때:
$$\text{effective gain} = A_{v,ideal} \times \frac{R_{in,B}}{R_{out,A}+R_{in,B}}$$

이는 전압 분배(voltage divider) 형태이며, **Rout이 작고 Rin이 클수록 loading effect가 적어 이상적인 Gain에 가까워짐**을 의미합니다.

### 5. Multi-Stage Gain

3단 증폭기 연결시:
$$\frac{V_{out}}{V_{in}} = A_{v1}A_{v2}A_{v3} \times \prod \frac{R_{in,k+1}}{R_{out,k}+R_{in,k+1}}$$

→ 각 단의 **Rin/Rout 비율이 전체 Gain에 곱해지는 형태로 반영**되므로, 개별 단의 Gain만 크다고 전체 성능이 좋아지는 것이 아님을 보여줍니다.

### 6. CS Stage with Degeneration (Rs 추가)

Source에 Rs가 추가되면 KVL로:
$$V_{gs} = V_{in} - I_D R_S$$
$$V_{out} = -g_m V_{gs} R_D = -g_m(V_{in}-I_DR_S)R_D$$

정리하면:
$$Gain = \frac{-g_m R_D}{1+g_m R_S}$$

→ **Rs가 negative feedback 역할을 하여 Gain을 감소시키지만 선형성(linearity)을 개선**하는 효과가 있습니다. 이는 "additional path" 개념과는 다른 방식(source 쪽 feedback)으로 Gain을 줄이는 사례입니다.

### 7. Degeneration의 Output Resistance (λ≠0)

Rout을 구할 때는 입력을 0으로 놓고 출력에 test current ix를 흘려 vx를 구합니다:
$$v_1 = -i_x R_S \text{ (Rs를 통해 흐르는 전류에 의한 gate-source voltage)}$$
$$v_x = i_x r_o + g_m v_1 r_o + i_x R_S$$

정리하면:
$$R_{out} = r_o + R_S + g_m r_o R_S = r_o(1+g_m R_S) + R_S$$

→ **Degeneration은 Gain은 낮추지만 Rout은 오히려 증가**시킨다는 점이 이후 current-mirror, cascode 등에서 중요하게 작용합니다.

---

## 헷갈리기 쉬운 포인트 / 자주 하는 실수

1. **"Gain이 줄어든다" = "저항이 병렬로 줄어든다"는 직관은 맞지만, 항상 단순 병렬(Rd||Rx)로 끝나는 것은 아님.** Degeneration처럼 source 쪽에 저항이 붙는 경우는 feedback 구조이므로 Gain 공식이 $-g_mR_D/(1+g_mR_S)$ 형태로 달라짐. 단순히 "저항이 추가되면 병렬로 계산"이라고 기계적으로 적용하면 안 됨.

2. **VDD/GND를 small-signal 회로에서 지우는 것을 빠뜨리는 실수.** Large-signal 회로도를 그대로 두고 KVL을 쓰면 안 되고, 반드시 고정 전압원은 short(접지)로 교체한 후 해석해야 함.

3. **Rin/Rout을 구할 때 "무엇을 0으로 놓아야 하는지" 혼동.** Rout을 구할 때는 입력 소스(Vin)를 0으로 놓고 출력에 test source를 걸어야 하며, 반대로 Rin은 출력 쪽 조건과 무관하게 입력에서 바로 봐야 함.

4. **λ=0 가정(ideal MOSFET)과 λ≠0(실제 MOSFET, ro 존재)의 결과를 혼용하는 실수.** λ=0일 때 Rout 계산은 간단(단순히 RD 등)하지만, λ≠0이면 ro가 추가되어 식이 복잡해짐(특히 degeneration이 있는 경우 Rout에 (1+gmRs) 배수가 곱해짐).

5. **Diode-connected load의 저항이 1/gm이라는 결과를 "당연한 공식"으로 외우기보다, KCL(Ix = gm·Vx, Rx = Vx/Ix = 1/gm) 유도 과정을 기억할 것.** 시험에서 변형된 topology가 나오면 유도할 수 있어야 함.

6. **PMOS 회로 해석 시 전류 방향과 gm의 부호 처리를 NMOS와 혼동하기 쉬움.** "Dealing with PMOS" 파트에서 강조된 것처럼, PMOS는 source가 위(VDD 쪽)에 있고 전류 방향이 반대이므로 주의.

---

## 복습 체크리스트 (자가 점검 질문)

1. CS Amplifier의 출력 노드에 외부 저항 Rx가 추가로 연결되면 Gain이 어떻게 바뀌는지, KCL 관점에서 설명할 수 있는가?
2. Small-signal model에서 "고정 전압 노드는 ground로 취급한다"는 원칙을 회로도에 직접 적용해볼 수 있는가? (VDD를 지우고 회로를 다시 그릴 수 있는가?)
3. Channel length modulation이 있을 때 $I_D = I_{D0} + V_{DS}/r_o$ 식을 스스로 유도할 수 있는가? ro의 정의(=1/λI_D0)를 설명할 수 있는가?
4. Rin과 Rout을 측정하는 절차(Circuit A/B를 이용한 방법)를 각각 설명하고, 왜 서로 다른 조건(입력 제거 vs 그대로 유지)에서 측정하는지 이해하고 있는가?
5. Multi-stage amplifier의 전체 Gain 공식에서 Rin, Rout 항이 왜 곱해지는지, voltage divider 관점으로 설명할 수 있는가?
6. CS Amp (ideal current source load / PMOS current source load / diode-connected load / degeneration) 각각의 topology에서 Av, Rin, Rout을 스스로 유도할 수 있는가?
7. Degeneration이 있는 CS stage에서 Gain은 감소하지만 Rout은 오히려 증가하는 이유를 직관적으로 설명할 수 있는가? (Negative feedback 관점)
8. Diode-connected load의 저항이 1/gm이 되는 이유를 KCL로 유도할 수 있는가?
9. λ=0일 때와 λ≠0일 때 Rout 계산 결과가 어떻게 달라지는지, 두 경우를 구분해서 계산할 수 있는가?
10. Example 7.9, 7.10처럼 M1, M2 두 개의 MOSFET이 함께 있는 회로에서 Rout을 구하는 절차(어느 것을 test source로 볼지, 어느 그림을 단순화(simplified circuit)로 바꿀지)를 스스로 설명할 수 있는가?

---

## 확인이 필요한 불명확한 부분 (STT 노이즈로 판독 불가능했던 구간)

- **[00:38]~[01:59]**: 음성 STT가 심하게 깨져 있어 "50mA/60mA/40mA" 등 구체적 수치의 정확한 의미와 상호관계가 불명확함. 슬라이드의 "10mA, 40mV, -g(m/Rx)" 등과 매칭이 명확하지 않으므로 실제 강의 자료(슬라이드 원본)로 재확인 필요.
- **[08:01]~[11:47] 구간의 수치들** (918.75μA, 609.375μA, 506.25μA, 3.3V/3.9V/4.5V/6V 등): OCR로 추출된 숫자들이 어떤 회로 조건(예: 서로 다른 VDD 값에 따른 bias current 변화)에 대응하는지 음성 설명이 거의 소실되어 정확한 문맥 파악이 어려움.
- **[42:27] "QA / -qm(Rp/Ro1) / -qm(Ro1/Ro1)"** 부분은 OCR 오류로 추정되며(g_m 오타 가능성), 실제 PMOS current source의 Gain 수식이 어떤 형태인지 원본 슬라이드 확인 필요.
- **[47:43]~[51:34] 구간의 diode-connected load 유도 과정 중 일부 표기** ("gm_o = í", "dx/V = -1/gm" 등)가 OCR 노이즈로 수식이 뒤섞여 있어, 정확한 유도 순서는 교재(Razavi 등) Figure 7.13 관련 설명과 대조 확인이 필요.
- **[69:30]~[71:41] Example 7.9, 7.10의 최종 Rout 수식** ("Rs + (τQ)q/x", "R + r01 + gm/IsR01/r02" 등)은 OCR 오류가 심해 정확한 최종 답을 이 로그만으로 복원할 수 없음. 교재 원문 또는 강의 슬라이드 원본으로 반드시 재확인 필요.

---

