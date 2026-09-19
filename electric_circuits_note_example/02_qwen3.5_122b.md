# Qwen3.5 122B-A10B 강의 요약 노트

- **모델 ID**: `qwen/qwen3.5-122b-a10b`
- **생성 소요 시간**: 46.3초
- **본문 분량**: 17,040자
- **기준 강의**: EEE2050 Lecture 3: Basic Semiconductor Physics
- **특징**: 모델 고유의 독자적인 인라인 SVG 벡터 다이어그램 자체 생성

> **작성 기준**: 타임라인 근거의 정정·예외·반례·부정·조건·숫자·단위·기호와 수식을 완벽히 보존하고, 잡음·반복 인사는 완전 배제했으며 제외 사유 설명은 일절 포함하지 않았습니다.

---

**강의 요약 및 핵심 학습 노트**

## 1. 핵심 결론 (Key Conclusions) & 시험 중요 포인트
*   **반도체의 본질:** 전도성 (Conductivity) 이 도체와 절연체 사이에 위치하며, 외부 에너지 (열, 빛 등) 에 의해 전기적 성질이 조절 가능한 물질.
*   **에너지 밴드 갭 ($E_g$):** 전자가 가전자대 (Valence Band) 에서 전도대 (Conduction Band) 로 이동하기 위해 필요한 최소 에너지.
    *   **절연체:** $E_g > 5 \text{ eV}$ (전류 흐름 불가).
    *   **반도체:** $E_g \approx 1 \sim 3 \text{ eV}$ (실리콘 $1.1 \text{ eV}$, 게르마늄 $0.67 \text{ eV}$).
    *   **도체:** $E_g = 0 \text{ eV}$ (밴드 중첩으로 자유 전자 존재).
*   **실리콘 (Si) 의 우위성:** 게르마늄 (Ge) 대비 더 큰 밴드갭 (누설 전류 감소), 높은 열적 안정성, 높은 항복 전압, 그리고 **$\text{SiO}_2$ (산화막) 형성 능력**이 있어 현대 IC 기술의 핵심 재료임.
*   **트랜지스터의 정의:** "Transfer Resistor"의 합성어로, 전압/전류에 따라 저항값을 변조 (Modulate) 하여 전류를 제어하는 소자.
*   **EHP 생성:** 열적 여기에 의해 공유결합이 끊어지면 **자유전자 (Free Electron)**와 **정공 (Hole)**이 쌍으로 생성됨 ($n = p$).

---

## 2. 반도체 물리 기초 (Basic Semiconductor Physics)

### 2.1 에너지 밴드 구조 (Energy Band Structure)
고체 내 전자가 점유할 수 있는 허용된 에너지 상태 (Allowed Energy States) 를 '밴드'라고 정의한다.
*   **가전자대 (Valence Band, VB):** 원자핵에 강하게 결합되어 있으며, 전자가 꽉 차 있는 (Fully Occupied) 낮은 에너지 준위.
*   **전도대 (Conduction Band, CB):** 원자핵에서 멀리 떨어져 loosely bound 되어 있으며, 전류 흐름에 기여할 수 있는 높은 에너지 준위.
*   **금지대 (Band Gap, $E_g$):** VB 와 CB 사이에 전자가 존재할 수 없는 에너지 영역.

<div align="center" style="margin: 16px 0; page-break-inside: avoid;">
<svg width="100%" height="auto" viewBox="0 0 800 300" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" style="stop-color:#1a2b4c;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#0d1b2a;stop-opacity:1" />
    </linearGradient>
    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="2" result="blur"/>
      <feComposite in="SourceGraphic" in2="blur" operator="over"/>
    </filter>
  </defs>
  <!-- Background -->
  <rect width="800" height="300" fill="url(#bgGrad)" rx="10" ry="10"/>
  <!-- Title -->
  <text x="400" y="30" text-anchor="middle" font-family="Arial, sans-serif" font-size="18" fill="#ffffff" font-weight="bold">Material Energy Band Comparison</text>
  <!-- Grid Lines (Energy Axis) -->
  <line x1="50" y1="250" x2="750" y2="250" stroke="#4a5568" stroke-width="1" stroke-dasharray="5,5"/>
  <text x="30" y="255" text-anchor="end" font-family="Arial" font-size="12" fill="#a0aec0">Energy (E)</text>
  <!-- Insulator -->
  <g transform="translate(100, 50)">
    <text x="0" y="-10" text-anchor="middle" font-family="Arial" font-size="14" fill="#fbbf24" font-weight="bold">Insulator</text>
    <!-- Valence Band -->
    <rect x="-40" y="100" width="80" height="20" fill="#e53e3e" opacity="0.8"/>
    <text x="0" y="115" text-anchor="middle" font-family="Arial" font-size="10" fill="#fff">Valence Band</text>
    <!-- Band Gap -->
    <line x1="-40" y1="80" x2="40" y2="80" stroke="#fbbf24" stroke-width="2" stroke-dasharray="4,2"/>
    <text x="0" y="70" text-anchor="middle" font-family="Arial" font-size="12" fill="#fbbf24">$E_g > 5 \text{ eV}$</text>
    <!-- Conduction Band -->
    <rect x="-40" y="20" width="80" height="20" fill="#4299e1" opacity="0.3"/>
    <text x="0" y="35" text-anchor="middle" font-family="Arial" font-size="10" fill="#fff">Conduction Band</text>
  </g>
  <!-- Semiconductor -->
  <g transform="translate(400, 50)">
    <text x="0" y="-10" text-anchor="middle" font-family="Arial" font-size="14" fill="#48bb78" font-weight="bold">Semiconductor</text>
    <!-- Valence Band -->
    <rect x="-40" y="100" width="80" height="20" fill="#e53e3e" opacity="0.8"/>
    <text x="0" y="115" text-anchor="middle" font-family="Arial" font-size="10" fill="#fff">Valence Band</text>
    <!-- Band Gap -->
    <line x1="-40" y1="80" x2="40" y2="80" stroke="#48bb78" stroke-width="2" stroke-dasharray="4,2"/>
    <text x="0" y="70" text-anchor="middle" font-family="Arial" font-size="12" fill="#48bb78">$E_g \approx 1.1 \text{ eV}$ (Si)</text>
    <!-- Conduction Band -->
    <rect x="-40" y="20" width="80" height="20" fill="#4299e1" opacity="0.3"/>
    <text x="0" y="35" text-anchor="middle" font-family="Arial" font-size="10" fill="#fff">Conduction Band</text>
  </g>
  <!-- Conductor -->
  <g transform="translate(700, 50)">
    <text x="0" y="-10" text-anchor="middle" font-family="Arial" font-size="14" fill="#ed8936" font-weight="bold">Conductor</text>
    <!-- Overlapping Bands -->
    <rect x="-40" y="60" width="80" height="60" fill="#4299e1" opacity="0.6"/>
    <rect x="-40" y="60" width="80" height="60" fill="#e53e3e" opacity="0.4"/>
    <text x="0" y="95" text-anchor="middle" font-family="Arial" font-size="10" fill="#fff">Overlap</text>
    <text x="0" y="115" text-anchor="middle" font-family="Arial" font-size="12" fill="#ed8936">$E_g = 0 \text{ eV}$</text>
  </g>
</svg>
</div>

### 2.2 결정 구조 (Crystal Structure)
반도체 소자 제조에는 원자 배열의 규칙성이 필수적이다.
1.  **단결정 (Crystalline):** 원자가 장거리 규칙적으로 배열됨. 전자 이동 예측 가능 $\rightarrow$ **IC 제조용**.
2.  **다결정 (Polycrystalline):** 여러 작은 단결정 (Grain) 이 모여있으며, 그 경계를 **결정립계 (Grain Boundary)**라 함.
3.  **비정질 (Amorphous):** 원자 배열이 무질서함 (Randomly organized).

<div align="center" style="margin: 16px 0; page-break-inside: avoid;">
<svg width="100%" height="auto" viewBox="0 0 800 250" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <pattern id="gridPattern" width="20" height="20" patternUnits="userSpaceOnUse">
      <circle cx="10" cy="10" r="4" fill="#cbd5e0"/>
    </pattern>
  </defs>
  <rect width="800" height="250" fill="#1a202c" rx="10"/>
  <text x="400" y="30" text-anchor="middle" font-family="Arial" font-size="16" fill="#fff" font-weight="bold">Semiconductor Crystal Structures</text>
  <!-- Crystalline -->
  <g transform="translate(50, 60)">
    <text x="0" y="-10" text-anchor="middle" font-family="Arial" font-size="12" fill="#63b3ed">Crystalline (Single)</text>
    <rect x="0" y="0" width="150" height="150" fill="#2d3748" stroke="#63b3ed" stroke-width="2"/>
    <!-- Regular Lattice -->
    <g transform="translate(20, 20)">
      <circle cx="0" cy="0" r="5" fill="#63b3ed"/>
      <circle cx="30" cy="0" r="5" fill="#63b3ed"/>
      <circle cx="60" cy="0" r="5" fill="#63b3ed"/>
      <circle cx="90" cy="0" r="5" fill="#63b3ed"/>
      <circle cx="0" cy="30" r="5" fill="#63b3ed"/>
      <circle cx="30" cy="30" r="5" fill="#63b3ed"/>
      <circle cx="60" cy="30" r="5" fill="#63b3ed"/>
      <circle cx="90" cy="30" r="5" fill="#63b3ed"/>
      <circle cx="0" cy="60" r="5" fill="#63b3ed"/>
      <circle cx="30" cy="60" r="5" fill="#63b3ed"/>
      <circle cx="60" cy="60" r="5" fill="#63b3ed"/>
      <circle cx="90" cy="60" r="5" fill="#63b3ed"/>
      <circle cx="0" cy="90" r="5" fill="#63b3ed"/>
      <circle cx="30" cy="90" r="5" fill="#63b3ed"/>
      <circle cx="60" cy="90" r="5" fill="#63b3ed"/>
      <circle cx="90" cy="90" r="5" fill="#63b3ed"/>
    </g>
    <text x="75" y="170" text-anchor="middle" font-family="Arial" font-size="10" fill="#a0aec0">Perfect Order</text>
  </g>
  <!-- Polycrystalline -->
  <g transform="translate(325, 60)">
    <text x="0" y="-10" text-anchor="middle" font-family="Arial" font-size="12" fill="#f6ad55">Polycrystalline</text>
    <rect x="0" y="0" width="150" height="150" fill="#2d3748" stroke="#f6ad55" stroke-width="2"/>
    <!-- Grain 1 -->
    <path d="M0,0 L75,0 L75,75 L0,75 Z" fill="#2d3748"/>
    <g transform="translate(10, 10)">
      <circle cx="0" cy="0" r="4" fill="#f6ad55"/>
      <circle cx="20" cy="0" r="4" fill="#f6ad55"/>
      <circle cx="40" cy="0" r="4" fill="#f6ad55"/>
      <circle cx="0" cy="20" r="4" fill="#f6ad55"/>
      <circle cx="20" cy="20" r="4" fill="#f6ad55"/>
      <circle cx="40" cy="20" r="4" fill="#f6ad55"/>
    </g>
    <!-- Grain 2 (Rotated) -->
    <path d="M75,0 L150,0 L150,75 L75,75 Z" fill="#2d3748"/>
    <g transform="translate(85, 10) rotate(45)">
      <circle cx="0" cy="0" r="4" fill="#f6ad55"/>
      <circle cx="20" cy="0" r="4" fill="#f6ad55"/>
      <circle cx="40" cy="0" r="4" fill="#f6ad55"/>
      <circle cx="0" cy="20" r="4" fill="#f6ad55"/>
      <circle cx="20" cy="20" r="4" fill="#f6ad55"/>
      <circle cx="40" cy="20" r="4" fill="#f6ad55"/>
    </g>
    <!-- Grain Boundary Line -->
    <line x1="75" y1="0" x2="75" y2="150" stroke="#fff" stroke-width="2" stroke-dasharray="2,2"/>
    <text x="75" y="170" text-anchor="middle" font-family="Arial" font-size="10" fill="#a0aec0">Grain Boundary</text>
  </g>
  <!-- Amorphous -->
  <g transform="translate(600, 60)">
    <text x="0" y="-10" text-anchor="middle" font-family="Arial" font-size="12" fill="#fc8181">Amorphous</text>
    <rect x="0" y="0" width="150" height="150" fill="#2d3748" stroke="#fc8181" stroke-width="2"/>
    <!-- Random Atoms -->
    <circle cx="20" cy="30" r="4" fill="#fc8181"/>
    <circle cx="60" cy="20" r="4" fill="#fc8181"/>
    <circle cx="100" cy="40" r="4" fill="#fc8181"/>
    <circle cx="30" cy="80" r="4" fill="#fc8181"/>
    <circle cx="80" cy="70" r="4" fill="#fc8181"/>
    <circle cx="120" cy="90" r="4" fill="#fc8181"/>
    <circle cx="40" cy="120" r="4" fill="#fc8181"/>
    <circle cx="90" cy="110" r="4" fill="#fc8181"/>
    <circle cx="130" cy="130" r="4" fill="#fc8181"/>
    <circle cx="10" cy="140" r="4" fill="#fc8181"/>
    <text x="75" y="170" text-anchor="middle" font-family="Arial" font-size="10" fill="#a0aec0">Random Arrangement</text>
  </g>
</svg>
</div>

---

## 3. 반도체 재료 분류 및 실리콘의 특성

### 3.1 재료 분류 체계
반도체는 구성 원소의 종류에 따라 분류된다. (전기공학 관점: 주족 번호 - 10 사용)

| 분류 | 원소/화합물 예시 | 특징 |
| :--- | :--- | :--- |
| **단원소 (Elemental)** | Si (Silicon), Ge (Germanium) | 4 족 원소. 가장 기본적. |
| **IV-IV 화합물** | Si-Ge, Si-C | 실리콘 기반 합금. |
| **III-V 화합물** | GaAs, InP | 고속 소자, 광소자 (SpaceX 태양전지 등). |
| **II-VI / IV-VI** | CdTe, PbS | 특수 목적 (적외선 감지 등). |

> **참고:** 탄소 (C) 는 반도체로 간주하지 않음 (다이아몬드 형태는 절연체, 그래핀은 특수).

### 3.2 왜 실리콘 (Si) 인가? (vs 게르마늄 Ge)
현대 반도체 산업이 실리콘을 선호하는 5 가지 핵심 이유:

1.  **비용 (Cost):** Si 는 지각에 풍부하여 매우 저렴함.
2.  **오프 전류 (Cut-off Current):** Si 의 밴드갭 ($1.1 \text{ eV}$) 이 Ge ($0.67 \text{ eV}$) 보다 커서, 열적 여기에 의한 누설 전류가 훨씬 작음. 스위칭 특성이 우수함.
3.  **열적 안정성:** 고온에서도 결정 구조가 쉽게 파괴되지 않음.
4.  **항복 전압 (Breakdown Voltage):** Si 가 더 높은 전압을 견딜 수 있음.
5.  **산화막 형성 ($\text{SiO}_2$):** Si 는 산화되어 고품질의 절연체 $\text{SiO}_2$를 형성할 수 있음. 이는 MOSFET 의 게이트 산화막 및 캐패시터 제작에 필수적임. (Ge 는 양호한 자연 산화막을 형성하지 못함).

---

## 4. 실리콘 격자와 전자 - 정공 쌍 (EHP) 생성

### 4.1 원자 구조 및 공유결합
*   **Si 원자:** 원자번호 14. 전자 배치 $[Ne] 3s^2 3p^2$.
*   **sp³ 혼성 오비탈:** $3s$와 $3p$ 오비탈이 혼합되어 4 개의 동일한 에너지 준위를 가진 sp³ 오비탈을 형성.
*   **4 개의 원자가 전자:** 각 Si 원자는 4 개의 전자를 가지고 있어, 이웃한 4 개의 Si 원자와 **공유결합 (Covalent Bond)**을 형성하여 정사면체 구조 (Diamond Lattice) 를 만듦.

### 4.2 전자 - 정공 쌍 (Electron-Hole Pair, EHP) 생성 메커니즘
열적 에너지 ($kT$) 나 외부 에너지가 공급되면 공유결합이 끊어진다.
1.  **자유전자 (Free Electron):** 결합에서 이탈하여 자유롭게 이동하는 전자.
2.  **정공 (Hole):** 전자가 빠져나간 빈 자리. 양 (+) 전하를 띤 것처럼 행동하는 가상 입자.
3.  **동시 생성:** 전자가 하나 생성되면 반드시 정공 하나도 함께 생성됨 ($n = p$). 이를 **EHP 생성**이라 함.

<div align="center" style="margin: 16px 0; page-break-inside: avoid;">
<svg width="100%" height="auto" viewBox="0 0 800 350" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="atomGrad" cx="50%" cy="50%" r="50%">
      <stop offset="0%" style="stop-color:#fbd38d;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#dd6b20;stop-opacity:1" />
    </radialGradient>
  </defs>
  <rect width="800" height="350" fill="#1a202c" rx="10"/>
  <text x="400" y="30" text-anchor="middle" font-family="Arial" font-size="16" fill="#fff" font-weight="bold">EHP Generation Mechanism in Silicon Lattice</text>
  <!-- Left: Perfect Lattice -->
  <g transform="translate(50, 80)">
    <text x="0" y="-10" text-anchor="middle" font-family="Arial" font-size="12" fill="#68d391">Perfect Covalent Bond</text>
    <!-- Central Atom -->
    <circle cx="75" cy="75" r="15" fill="url(#atomGrad)" stroke="#fff" stroke-width="2"/>
    <text x="75" y="80" text-anchor="middle" font-family="Arial" font-size="10" fill="#000" font-weight="bold">Si</text>
    <!-- Neighbors -->
    <circle cx="75" cy="25" r="12" fill="#cbd5e0"/>
    <circle cx="125" cy="75" r="12" fill="#cbd5e0"/>
    <circle cx="75" cy="125" r="12" fill="#cbd5e0"/>
    <circle cx="25" cy="75" r="12" fill="#cbd5e0"/>
    <!-- Bonds (Lines with electrons) -->
    <line x1="75" y1="60" x2="75" y2="37" stroke="#fff" stroke-width="2"/>
    <circle cx="75" cy="48" r="3" fill="#f6e05e"/> <!-- Shared electron -->
    <line x1="88" y1="75" x2="113" y2="75" stroke="#fff" stroke-width="2"/>
    <circle cx="100" cy="75" r="3" fill="#f6e05e"/>
    <line x1="75" y1="90" x2="75" y2="113" stroke="#fff" stroke-width="2"/>
    <circle cx="75" cy="101" r="3" fill="#f6e05e"/>
    <line x1="62" y1="75" x2="37" y2="75" stroke="#fff" stroke-width="2"/>
    <circle cx="50" cy="75" r="3" fill="#f6e05e"/>
    <text x="75" y="150" text-anchor="middle" font-family="Arial" font-size="10" fill="#a0aec0">All bonds intact</text>
  </g>
  <!-- Arrow for Energy Input -->
  <path d="M250,150 L300,150" stroke="#f6ad55" stroke-width="3" marker-end="url(#arrowhead)"/>
  <text x="275" y="140" text-anchor="middle" font-family="Arial" font-size="12" fill="#f6ad55">Thermal Energy</text>
  <!-- Right: Broken Bond (EHP) -->
  <g transform="translate(400, 80)">
    <text x="0" y="-10" text-anchor="middle" font-family="Arial" font-size="12" fill="#fc8181">Broken Bond (EHP)</text>
    <!-- Central Atom with Hole -->
    <circle cx="75" cy="75" r="15" fill="url(#atomGrad)" stroke="#fff" stroke-width="2"/>
    <text x="75" y="80" text-anchor="middle" font-family="Arial" font-size="10" fill="#000" font-weight="bold">Si</text>
    <!-- Neighbors -->
    <circle cx="75" cy="25" r="12" fill="#cbd5e0"/>
    <circle cx="125" cy="75" r="12" fill="#cbd5e0"/>
    <circle cx="75" cy="125" r="12" fill="#cbd5e0"/>
    <circle cx="25" cy="75" r="12" fill="#cbd5e0"/>
    <!-- Broken Top Bond -->
    <line x1="75" y1="60" x2="75" y2="37" stroke="#fff" stroke-width="2" stroke-dasharray="2,2"/>
    <text x="75" y="30" text-anchor="middle" font-family="Arial" font-size="10" fill="#fc8181">Hole (+)</text>
    <!-- Free Electron -->
    <circle cx="140" cy="40" r="5" fill="#f6e05e" stroke="#fff" stroke-width="1"/>
    <text x="140" y="30" text-anchor="middle" font-family="Arial" font-size="10" fill="#f6e05e">Free e⁻</text>
    <line x1="75" y1="60" x2="135" y2="45" stroke="#f6e05e" stroke-width="1" stroke-dasharray="2,2"/>
    <!-- Other intact bonds -->
    <line x1="88" y1="75" x2="113" y2="75" stroke="#fff" stroke-width="2"/>
    <circle cx="100" cy="75" r="3" fill="#f6e05e"/>
    <line x1="75" y1="90" x2="75" y2="113" stroke="#fff" stroke-width="2"/>
    <circle cx="75" cy="101" r="3" fill="#f6e05e"/>
    <line x1="62" y1="75" x2="37" y2="75" stroke="#fff" stroke-width="2"/>
    <circle cx="50" cy="75" r="3" fill="#f6e05e"/>
    <text x="75" y="150" text-anchor="middle" font-family="Arial" font-size="10" fill="#a0aec0">n = p (Equal generation)</text>
  </g>
</svg>
</div>

---

## 5. 트랜지스터의 본질: 저항 변조 (Resistance Modulation)

### 5.1 용어의 유래
*   **Tran**sfer (전달) + **Resis**tor (저항) = **Transistor**
*   **정의:** 입력 신호 (전압 또는 전류) 에 따라 소자의 **저항값을 변화시켜 출력 전류를 제어**하는 소자.

### 5.2 I-V 곡선과 저항 제어
*   옴의 법칙 ($R = V/I$) 에 따르면, $I-V$ 곡선의 기울기 (Slope) 는 전도도 ($1/R$) 를 의미한다.
*   트랜지스터는 게이트 전압 등을 조절하여 채널의 저항을 변화시키고, 결과적으로 $I-V$ 곡선의 기울기를 바꾼다.
*   **스위칭 동작:**
    *   **OFF 상태:** 저항이 매우 큼 (기울기 $\approx 0$) $\rightarrow$ 전류 차단.
    *   **ON 상태:** 저항이 매우 작음 (기울기 큼) $\rightarrow$ 전류 통과.

<div align="center" style="margin: 16px 0; page-break-inside: avoid;">
<svg width="100%" height="auto" viewBox="0 0 600 300" xmlns="http://www.w3.org/2000/svg">
  <rect width="600" height="300" fill="#1a202c" rx="10"/>
  <text x="300" y="30" text-anchor="middle" font-family="Arial" font-size="16" fill="#fff" font-weight="bold">Transistor: Transfer of Resistance</text>
  <!-- Axes -->
  <line x1="50" y1="250" x2="550" y2="250" stroke="#a0aec0" stroke-width="2"/>
  <line x1="50" y1="250" x2="50" y2="50" stroke="#a0aec0" stroke-width="2"/>
  <text x="550" y="260" text-anchor="end" font-family="Arial" font-size="12" fill="#a0aec0">Voltage (V)</text>
  <text x="30" y="50" text-anchor="start" font-family="Arial" font-size="12" fill="#a0aec0">Current (I)</text>
  <!-- OFF State (High Resistance) -->
  <path d="M50,250 Q150,240 250,245" stroke="#fc8181" stroke-width="3" fill="none" stroke-dasharray="5,5"/>
  <text x="150" y="230" text-anchor="middle" font-family="Arial" font-size="12" fill="#fc8181">OFF (High R)</text>
  <text x="150" y="220" text-anchor="middle" font-family="Arial" font-size="10" fill="#a0aec0">Slope $\approx$ 0</text>
  <!-- ON State (Low Resistance) -->
  <path d="M50,250 L250,100" stroke="#48bb78" stroke-width="3" fill="none"/>
  <text x="150" y="160" text-anchor="middle" font-family="Arial" font-size="12" fill="#48bb78">ON (Low R)</text>
  <text x="150" y="150" text-anchor="middle" font-family="Arial" font-size="10" fill="#a0aec0">Steep Slope</text>
  <!-- Control Arrow -->
  <path d="M300,180 L300,120" stroke="#f6ad55" stroke-width="2" marker-end="url(#arrowhead)"/>
  <text x="300" y="110" text-anchor="middle" font-family="Arial" font-size="12" fill="#f6ad55">Control Signal</text>
  <text x="300" y="190" text-anchor="middle" font-family="Arial" font-size="12" fill="#f6ad55">Modulates R</text>
</svg>
</div>