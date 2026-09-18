# Qwen3.8 2.4T-A95B 강의 요약 노트

- **모델 ID**: `qwen/qwen3.8-2.4t-a95b`
- **생성 소요 시간**: 563.0초
- **본문 분량**: 23,128자
- **기준 강의**: EEE2050 Lecture 3: Basic Semiconductor Physics
- **특징**: 모델 고유의 독자적인 인라인 SVG 벡터 다이어그램 자체 생성

> **작성 기준**: 타임라인 근거의 정정·예외·반례·부정·조건·숫자·단위·기호와 수식을 완벽히 보존하고, 잡음·반복 인사는 완전 배제했으며 제외 사유 설명은 일절 포함하지 않았습니다.

---

## 0. 최우선 핵심 결론 — 시험에 가장 중요한 내용

- **반도체는 도체와 절연체 사이의 전기 전도도를 갖는 재료**이며, 집적회로(IC)에서는 일반적으로 **결정성 반도체**가 사용된다. `[20:08]` `[핵심]`
- **에너지 밴드갭 \(E_g\)** 은 전도대와 원자가대 사이의 에너지 간격이며, **밴드갭 구간에는 전자가 점유할 수 있는 허용 상태가 없다**. `[17:08]` `[18:28]` `[핵심]`
- 재료 구분의 핵심 기준  
  - **절연체**: \(E_g > 5\ \text{eV}\) — 큰 에너지 필요  
  - **도체**: 전도대와 원자가대가 겹침, \(E_g \approx 0\ \text{eV}\)  
  - **반도체**: \(E_g\)가 중간, 대략 \(1\ \text{eV}\) 수준, 근거에서 \(1\sim3\ \text{eV}\) 표현도 있음  
  `[16:28]` `[17:08]` `[핵심]`
- 대표 반도체의 밴드갭  
  - **Si**: \(E_g \approx 1.1\ \text{eV}\)  
  - **Ge**: \(E_g \approx 0.67\ \text{eV}\)  
  `[17:48]` `[33:48]` `[핵심]`
- **원자가대**는 전자로 거의 가득 차 있고, **전도대**에는 초기에 전자가 거의 없다. 전류 흐름은 전도대의 전자와 관련된다. `[12:28]` `[13:08]` `[핵심]`
- **단결정 실리콘**은 원자가 규칙적으로 배열되어 전자 거동을 예측할 수 있기 때문에 IC 칩 제작에 중요하다. `[25:48]` `[26:28]` `[핵심]`
- **실리콘이 저마늄보다 선호되는 이유**는 다음 5가지로 정리된다.  
  1. 훨씬 저렴함  
  2. 차단 전류가 훨씬 작음  
  3. 고온에서 Ge보다 안정적  
  4. 항복 전압이 더 높음  
  5. 절연체 \(\text{SiO}_2\)를 쉽게 형성할 수 있음  
  `[33:48]` `[34:28]` `[37:48]` `[38:28]` `[39:48]` `[40:00]` `[핵심]`
- **실리콘 원자 밀도**: \(5 \times 10^{22}\ \text{atoms/cm}^3\)  
  **실리콘의 원자가 전자 수**: 4개  
  `[50:07]` `[핵심]`
- 실리콘에서 열 또는 작은 에너지가 가해지면 공유결합이 끊어지고 **자유전자 1개와 정공 1개가 동시에 생성**된다. 따라서 진성 실리콘에서  
  \[
  n = p
  \]
  이다. 여기서 \(n\)은 자유전자, \(p\)는 정공이다. `[51:08]` `[52:28]` `[핵심]`
- **트랜지스터**는 **Transfer + Resistor**의 합성어로, 본질은 **저항을 변조하는 소자**이다. \(I\)-\(V\) 곡선에서는 기울기 변화로 나타난다. `[41:48]` `[42:28]` `[43:08]` `[핵심]`

---

## 1. 핵심 수치와 조건 요약

| 항목 | 값/내용 | 단위/조건 | 의미 | 근거 | 중요도 |
|---|---:|---|---|---|---|
| 절연체 밴드갭 | \(E_g > 5\) | eV | 전자를 전도대로 올리려면 큰 에너지 필요 | `[16:28]` | 핵심 |
| 도체 밴드 구조 | 전도대-원자가대 겹침 | \(E_g \approx 0\) | 작은 에너지로 전도 가능 | `[16:28]` | 핵심 |
| 반도체 밴드갭 | 대략 \(1\), 근거에서 \(1\sim3\) 언급 | eV | 도체와 절연체 사이 | `[17:08]` | 핵심 |
| Si 밴드갭 | \(1.1\) | eV | 실리콘 대표값 | `[17:48]` | 핵심 |
| Ge 밴드갭 | \(0.67\) | eV | 저마늄 대표값 | `[33:48]` | 핵심 |
| Si 원자 밀도 | \(5 \times 10^{22}\) | atoms/cm³ | 실리콘 격자의 원자 수 밀도 | `[50:07]` | 핵심 |
| Si 원자가 전자 | 4 | 개 | 공유결합 4개 형성 | `[50:07]` | 핵심 |
| 전기공학 족 표기 | 14족 → 4족 | — | 전기공학에서는 10을 제거하고 표기 | `[27:48]` | 참고 |
| 현대 IC 스케일 예시 | 3 nm급 언급 | nm | 결정 질서가 중요한 이유 | `[25:48]` | 참고 |

---

## 2. 보존된 수식과 관계

| 원식/관계 | 변수와 단위 | 적용 조건 | 직관적 의미 | 근거 | 중요도 |
|---|---|---|---|---|---|
| \(E_g = E_C - E_V\) | \(E_g, E_C, E_V\): 에너지, eV | 전도대와 원자가대 사이 | 전자가 전도대로 이동하기 위해 넘어야 하는 에너지 장벽 | `[17:08]` `[18:28]` | 핵심 |
| \(n = p\) | \(n\): 자유전자, \(p\): 정공, 개수 또는 농도 | 진성/도핑되지 않은 실리콘, 전자-정공 쌍 생성 | 전자 하나가 결합에서 벗어나면 정공 하나가 동시에 생김 | `[52:28]` | 핵심 |
| \(I\)-\(V\) 기울기 변화 | \(I\): 전류, A; \(V\): 전압, V | 트랜지스터 동작 | 기울기가 변한다는 것은 유효 저항 또는 전도도가 변한다는 의미 | `[42:28]` | 중요 |

---

## 3. 에너지 밴드 구조와 반도체의 정의

### 3.1 밴드와 에너지 상태

- **밴드**란 고체 안에서 전자가 점유할 수 있는 **허용된 에너지 상태들의 집합**이다. `[08:28]` `[핵심]`
- **에너지 상태**는 직관적으로 “전자가 앉을 수 있는 자리”로 이해할 수 있다. `[09:08]` `[핵심]`
- **원자가대**는 원자핵에 더 강하게 속박된 전자들이 차지하는 낮은 에너지 밴드이다. 전자로 가득 차 있다. `[11:08]` `[12:28]` `[핵심]`
- **전도대**는 원자가대보다 높은 에너지에 있으며, 초기에는 전자가 거의 없다. 전도대에 전자가 있어야 전류 흐름과 연결된다. `[10:28]` `[13:08]` `[핵심]`
- 고체가 전도성을 가지려면 원자가대의 전자가 에너지를 받아 전도대로 이동해야 한다. `[14:28]` `[핵심]`

### 3.2 재료별 밴드갭 비교

| 재료 | 밴드 구조 | 밴드갭 \(E_g\) | 전기적 결과 | 근거 | 중요도 |
|---|---|---:|---|---|---|
| 절연체 | 전도대와 원자가대 사이 큰 간격 | \(> 5\ \text{eV}\) | 전자를 전도대로 올리기 매우 어려움 | `[15:08]` `[16:28]` | 핵심 |
| 반도체 | 중간 크기 밴드갭 | 대략 \(1\ \text{eV}\), 근거에서 \(1\sim3\ \text{eV}\) 언급 | 적당한 에너지로 전도 가능 | `[16:28]` `[17:08]` | 핵심 |
| 도체 | 전도대와 원자가대 겹침 | \(0\ \text{eV}\) | 작은 에너지로 전자가 이동 가능 | `[16:28]` `[19:48]` | 핵심 |

### 3.3 밴드갭의 물리적 의미

- 밴드갭 구간에는 **허용된 에너지 상태가 없다**.  
- 따라서 밴드갭 안에는 **전자가 존재할 수 없다**. `[18:28]` `[핵심]`
- 저항률 관점에서  
  - 낮은 저항률 → 도체  
  - 높은 저항률 → 절연체  
  - 중간 저항률 → 반도체  
  로 구분된다. `[20:08]` `[핵심]`

<div align="center" style="margin: 16px 0; page-break-inside: avoid;">
<svg width="100%" height="auto" viewBox="0 0 960 360" xmlns="http://www.w3.org/2000/svg">
  <rect width="960" height="360" fill="#0b1026"/>
  <text x="480" y="36" fill="#e6ecff" font-size="28" text-anchor="middle" font-family="Arial, sans-serif">에너지 밴드 구조 비교</text>
  <!-- Insulator -->
  <rect x="20" y="56" width="290" height="284" rx="18" fill="#101836" stroke="#3b4f86" stroke-width="1.5"/>
  <text x="165" y="86" fill="#93c5fd" font-size="22" text-anchor="middle" font-family="Arial, sans-serif">절연체</text>
  <rect x="60" y="104" width="210" height="42" rx="10" fill="#f97316" opacity="0.9"/>
  <text x="165" y="130" fill="#0b1026" font-size="16" text-anchor="middle" font-weight="bold" font-family="Arial, sans-serif">전도대</text>
  <rect x="60" y="252" width="210" height="42" rx="10" fill="#14b8a6" opacity="0.95"/>
  <text x="165" y="278" fill="#0b1026" font-size="16" text-anchor="middle" font-weight="bold" font-family="Arial, sans-serif">원자가대</text>
  <line x1="165" y1="150" x2="165" y2="248" stroke="#e2e8f0" stroke-width="2"/>
  <path d="M160 158 L165 148 L170 158" fill="none" stroke="#e2e8f0" stroke-width="2"/>
  <path d="M160 240 L165 250 L170 240" fill="none" stroke="#e2e8f0" stroke-width="2"/>
  <text x="185" y="205" fill="#f8fafc" font-size="16" font-family="Arial, sans-serif">Eg &gt; 5 eV</text>
  <circle cx="85" cy="273" r="5" fill="#e2e8f0"/>
  <circle cx="115" cy="273" r="5" fill="#e2e8f0"/>
  <circle cx="145" cy="273" r="5" fill="#e2e8f0"/>
  <circle cx="175" cy="273" r="5" fill="#e2e8f0"/>
  <circle cx="205" cy="273" r="5" fill="#e2e8f0"/>
  <circle cx="235" cy="273" r="5" fill="#e2e8f0"/>
  <text x="165" y="322" fill="#cbd5e1" font-size="14" text-anchor="middle" font-family="Arial, sans-serif">큰 갭 → 전자 여기 어려움</text>
  <!-- Semiconductor -->
  <rect x="330" y="56" width="290" height="284" rx="18" fill="#101836" stroke="#3b4f86" stroke-width="1.5"/>
  <text x="475" y="86" fill="#93c5fd" font-size="22" text-anchor="middle" font-family="Arial, sans-serif">반도체</text>
  <rect x="370" y="150" width="210" height="42" rx="10" fill="#f97316" opacity="0.9"/>
  <text x="475" y="176" fill="#0b1026" font-size="16" text-anchor="middle" font-weight="bold" font-family="Arial, sans-serif">전도대</text>
  <rect x="370" y="252" width="210" height="42" rx="10" fill="#14b8a6" opacity="0.95"/>
  <text x="475" y="278" fill="#0b1026" font-size="16" text-anchor="middle" font-weight="bold" font-family="Arial, sans-serif">원자가대</text>
  <line x1="475" y1="196" x2="475" y2="248" stroke="#e2e8f0" stroke-width="2"/>
  <path d="M470 204 L475 194 L480 204" fill="none" stroke="#e2e8f0" stroke-width="2"/>
  <path d="M470 240 L475 250 L480 240" fill="none" stroke="#e2e8f0" stroke-width="2"/>
  <text x="495" y="210" fill="#f8fafc" font-size="15" font-family="Arial, sans-serif">Eg ≈ 1 eV</text>
  <text x="495" y="228" fill="#f8fafc" font-size="13" font-family="Arial, sans-serif">Si 1.1 eV</text>
  <text x="495" y="244" fill="#f8fafc" font-size="13" font-family="Arial, sans-serif">Ge 0.67 eV</text>
  <circle cx="395" cy="273" r="5" fill="#e2e8f0"/>
  <circle cx="425" cy="273" r="5" fill="#e2e8f0"/>
  <circle cx="455" cy="273" r="5" fill="#e2e8f0"/>
  <circle cx="485" cy="273" r="5" fill="#e2e8f0"/>
  <circle cx="515" cy="273" r="5" fill="#e2e8f0"/>
  <circle cx="545" cy="273" r="5" fill="#e2e8f0"/>
  <circle cx="430" cy="171" r="5" fill="#fde68a"/>
  <text x="475" y="322" fill="#cbd5e1" font-size="14" text-anchor="middle" font-family="Arial, sans-serif">중간 갭 → 제어 가능</text>
  <!-- Conductor -->
  <rect x="640" y="56" width="300" height="284" rx="18" fill="#101836" stroke="#3b4f86" stroke-width="1.5"/>
  <text x="790" y="86" fill="#93c5fd" font-size="22" text-anchor="middle" font-family="Arial, sans-serif">도체</text>
  <rect x="680" y="150" width="220" height="60" rx="12" fill="#f97316" opacity="0.55"/>
  <rect x="680" y="180" width="220" height="60" rx="12" fill="#14b8a6" opacity="0.65"/>
  <text x="790" y="172" fill="#e2e8f0" font-size="15" text-anchor="middle" font-family="Arial, sans-serif">전도대</text>
  <text x="790" y="226" fill="#0b1026" font-size="15" text-anchor="middle" font-weight="bold" font-family="Arial, sans-serif">원자가대</text>
  <text x="790" y="270" fill="#f8fafc" font-size="16" text-anchor="middle" font-family="Arial, sans-serif">밴드 겹침, Eg ≈ 0</text>
  <circle cx="710" cy="205" r="5" fill="#e2e8f0"/>
  <circle cx="745" cy="195" r="5" fill="#e2e8f0"/>
  <circle cx="780" cy="210" r="5" fill="#e2e8f0"/>
  <circle cx="815" cy="190" r="5" fill="#e2e8f0"/>
  <circle cx="850" cy="205" r="5" fill="#e2e8f0"/>
  <text x="790" y="322" fill="#cbd5e1" font-size="14" text-anchor="middle" font-family="Arial, sans-serif">작은 에너지로 전도</text>
</svg>
</div>

**그림 1.** 절연체, 반도체, 도체의 에너지 밴드 구조 비교 `[07:39]` `[16:28]` `[핵심]`

---

## 4. 반도체의 결정 구조: 단결정, 다결정, 비정질

### 4.1 세 가지 구조 비교

| 구조 | 원자 배열 | 특징 | 근거 | 중요도 |
|---|---|---|---|---|
| 비정질 Amorphous | 원자가 무작위로 배치 | 장범위 규칙성 없음 | `[22:28]` | 중요 |
| 단결정 Crystalline | 원자가 규칙적으로 정렬 | 전자 거동 예측에 유리, IC용 핵심 | `[23:08]` `[26:28]` | 핵심 |
| 다결정 Polycrystalline | 여러 결정립이 붙어 있음 | 결정립계 존재, 단결정과 비정질 사이 | `[23:48]` `[24:28]` | 중요 |

### 4.2 결정립계

- 다결정에서 각각의 규칙적 영역을 **결정립, grain**이라 볼 수 있다.  
- 서로 다른 결정립이 만나면 경계가 생기며, 이를 **결정립계, grain boundary**라 한다. `[24:28]` `[중요]`

### 4.3 IC에서 단결정이 중요한 이유

- 현대 IC 기술은 나노미터 스케일이며, 근거에서 3 nm급 기술이 언급된다. `[25:48]` `[참고]`
- 실리콘 원자가 규칙적으로 배열되어 있지 않으면 전자 거동을 추정하기 어렵다.  
- 그래서 **잘 정렬된 결정성 실리콘**이 칩 제작에 중요하다. `[26:28]` `[핵심]`
- 한편, 비정질 반도체도 최근 상업적으로 중요해졌다는 점이 언급된다. `[20:08]` `[참고]`

<div align="center" style="margin: 16px 0; page-break-inside: avoid;">
<svg width="100%" height="auto" viewBox="0 0 960 340" xmlns="http://www.w3.org/2000/svg">
  <rect width="960" height="340" fill="#0b1026"/>
  <text x="480" y="36" fill="#e6ecff" font-size="28" text-anchor="middle" font-family="Arial, sans-serif">반도체 결정 구조 비교</text>
  <!-- Crystalline -->
  <rect x="20" y="56" width="290" height="264" rx="18" fill="#101836" stroke="#3b4f86" stroke-width="1.5"/>
  <text x="165" y="86" fill="#93c5fd" font-size="22" text-anchor="middle" font-family="Arial, sans-serif">단결정</text>
  <g stroke="#3b82f6" stroke-width="1.4" opacity="0.75">
    <path d="M70 120 H260 M70 160 H260 M70 200 H260 M70 240 H260"/>
    <path d="M70 120 V240 M117.5 120 V240 M165 120 V240 M212.5 120 V240 M260 120 V240"/>
  </g>
  <g fill="#93c5fd">
    <circle cx="70" cy="120" r="6"/><circle cx="117.5" cy="120" r="6"/><circle cx="165" cy="120" r="6"/><circle cx="212.5" cy="120" r="6"/><circle cx="260" cy="120" r="6"/>
    <circle cx="70" cy="160" r="6"/><circle cx="117.5" cy="160" r="6"/><circle cx="165" cy="160" r="6"/><circle cx="212.5" cy="160" r="6"/><circle cx="260" cy="160" r="6"/>
    <circle cx="70" cy="200" r="6"/><circle cx="117.5" cy="200" r="6"/><circle cx="165" cy="200" r="6"/><circle cx="212.5" cy="200" r="6"/><circle cx="260" cy="200" r="6"/>
    <circle cx="70" cy="240" r="6"/><circle cx="117.5" cy="240" r="6"/><circle cx="165" cy="240" r="6"/><circle cx="212.5" cy="240" r="6"/><circle cx="260" cy="240" r="6"/>
  </g>
  <text x="165" y="292" fill="#cbd5e1" font-size="14" text-anchor="middle" font-family="Arial, sans-serif">규칙적 격자</text>
  <!-- Polycrystalline -->
  <rect x="330" y="56" width="290" height="264" rx="18" fill="#101836" stroke="#3b4f86" stroke-width="1.5"/>
  <text x="475" y="86" fill="#93c5fd" font-size="22" text-anchor="middle" font-family="Arial, sans-serif">다결정</text>
  <polygon points="360,120 440,105 470,160 400,190" fill="#172554" stroke="#60a5fa" stroke-width="1.5"/>
  <polygon points="470,160 560,120 590,190 510,220" fill="#172554" stroke="#60a5fa" stroke-width="1.5"/>
  <polygon points="400,190 510,220 470,270 380,250" fill="#172554" stroke="#60a5fa" stroke-width="1.5"/>
  <g fill="#93c5fd">
    <circle cx="390" cy="135" r="5"/><circle cx="420" cy="125" r="5"/><circle cx="440" cy="150" r="5"/>
    <circle cx="500" cy="150" r="5"/><circle cx="535" cy="145" r="5"/><circle cx="555" cy="170" r="5"/>
    <circle cx="420" cy="215" r="5"/><circle cx="455" cy="235" r="5"/><circle cx="480" cy="250" r="5"/>
  </g>
  <path d="M470 160 L400 190 L510 220" fill="none" stroke="#fbbf24" stroke-width="2.5" stroke-dasharray="7 5"/>
  <text x="475" y="292" fill="#cbd5e1" font-size="14" text-anchor="middle" font-family="Arial, sans-serif">결정립계 Grain Boundary</text>
  <!-- Amorphous -->
  <rect x="640" y="56" width="300" height="264" rx="18" fill="#101836" stroke="#3b4f86" stroke-width="1.5"/>
  <text x="790" y="86" fill="#93c5fd" font-size="22" text-anchor="middle" font-family="Arial, sans-serif">비정질</text>
  <g stroke="#64748b" stroke-width="1.3" opacity="0.8">
    <line x1="680" y1="130" x2="725" y2="155"/>
    <line x1="725" y1="155" x2="705" y2="205"/>
    <line x1="760" y1="120" x2="805" y2="145"/>
    <line x1="805" y1="145" x2="845" y2="120"/>
    <line x1="780" y1="190" x2="830" y2="220"/>
    <line x1="700" y1="250" x2="760" y2="260"/>
  </g>
  <g fill="#94a3b8">
    <circle cx="680" cy="130" r="6"/><circle cx="725" cy="155" r="6"/><circle cx="705" cy="205" r="6"/>
    <circle cx="760" cy="120" r="6"/><circle cx="805" cy="145" r="6"/><circle cx="845" cy="120" r="6"/>
    <circle cx="780" cy="190" r="6"/><circle cx="830" cy="220" r="6"/><circle cx="700" cy="250" r="6"/>
    <circle cx="760" cy="260" r="6"/><circle cx="870" cy="240" r="6"/><circle cx="880" cy="170" r="6"/>
  </g>
  <text x="790" y="292" fill="#cbd5e1" font-size="14" text-anchor="middle" font-family="Arial, sans-serif">무작위 배열</text>
</svg>
</div>

**그림 2.** 단결정, 다결정, 비정질 구조 비교 `[20:08]` `[22:28]` `[23:48]` `[중요]`

---

## 5. 반도체 재료 분류

### 5.1 주기율표 표기

- 화학에서는 14족으로 부르지만, 전기공학 반도체 물리에서는 편의상 **4족**으로 표기한다.  
- 이는 10을 제거한 표기 방식이다. `[27:48]` `[참고]`

### 5.2 단원소 반도체와 화합물 반도체

| 분류 | 예시 | 비고 | 근거 | 중요도 |
|---|---|---|---|---|
| 4족 단원소 | Si, Ge | 대표 반도체 재료 | `[29:08]` | 핵심 |
| 4족 단원소 | C | 논쟁적 재료로 언급, 본 강의 대표 논의에서는 무시 | `[29:08]` | 참고 |
| 4족 단원소 | Sn, Pb | 밴드갭이 매우 작아 반도체 소자에 자주 사용되지 않음 | `[32:28]` | 참고 |
| IV-IV 화합물 | Si–Ge, Si–C | 4족-4족 화합물 | `[27:19]` | 중요 |
| III-V 화합물 | InP, GaAs | 근거 슬라이드에는 III-IV로 표기된 항목이나, InP·GaAs는 III-V 조합 | `[27:19]` `[31:08]` | 중요 |
| II-VI 화합물 | CdTe | 2족-6족 화합물 | `[27:19]` | 참고 |
| IV-VI 화합물 | PbS | 4족-6족 화합물 | `[27:19]` | 참고 |
| 4원계 화합물 | \((\text{In}_x\text{Ga}_{1-x})(\text{As}_y\text{P}_{1-y})\) | 조성 변수 \(x, y\)로 재료 특성 조정 가능 | `[27:19]` | 참고 |

### 5.3 Ge에서 Si로의 전환

- 최초의 점접촉 트랜지스터는 **Ge** 재료로 만들어졌다. `[30:28]` `[참고]`
- Ge는 여러 문제를 보였고, 이후 연구자들은 **Si**로 전환했다. `[30:28]` `[중요]`
- Si는 현대 소자 역사에서 가장 대표적인 반도체 재료이다. `[30:28]` `[핵심]`
- III-V 계열 등 화합물 반도체는 고성능 태양전지, 위성 전원 등 특수 응용에서 중요하게 언급된다. `[31:08]` `[참고]`

<div align="center" style="margin: 16px 0; page-break-inside: avoid;">
<svg width="100%" height="auto" viewBox="0 0 960 420" xmlns="http://www.w3.org/2000/svg">
  <rect width="960" height="420" fill="#0b1026"/>
  <text x="480" y="36" fill="#e6ecff" font-size="28" text-anchor="middle" font-family="Arial, sans-serif">반도체 재료 분류 체계</text>
  <rect x="330" y="60" width="300" height="50" rx="14" fill="#1d4ed8" stroke="#93c5fd" stroke-width="1.5"/>
  <text x="480" y="92" fill="#ffffff" font-size="20" text-anchor="middle" font-family="Arial, sans-serif">반도체 재료</text>
  <path d="M480 110 C480 140, 240 130, 240 160" fill="none" stroke="#93c5fd" stroke-width="2"/>
  <path d="M480 110 C480 140, 720 130, 720 160" fill="none" stroke="#93c5fd" stroke-width="2"/>
  <rect x="100" y="160" width="280" height="54" rx="14" fill="#101836" stroke="#3b4f86" stroke-width="1.5"/>
  <text x="240" y="193" fill="#e6ecff" font-size="19" text-anchor="middle" font-family="Arial, sans-serif">단원소 반도체</text>
  <rect x="580" y="160" width="280" height="54" rx="14" fill="#101836" stroke="#3b4f86" stroke-width="1.5"/>
  <text x="720" y="193" fill="#e6ecff" font-size="19" text-anchor="middle" font-family="Arial, sans-serif">화합물 반도체</text>
  <rect x="70" y="240" width="150" height="46" rx="12" fill="#172554" stroke="#60a5fa"/>
  <text x="145" y="269" fill="#bfdbfe" font-size="18" text-anchor="middle" font-family="Arial, sans-serif">Si</text>
  <rect x="240" y="240" width="150" height="46" rx="12" fill="#172554" stroke="#60a5fa"/>
  <text x="315" y="269" fill="#bfdbfe" font-size="18" text-anchor="middle" font-family="Arial, sans-serif">Ge</text>
  <text x="240" y="315" fill="#94a3b8" font-size="14" text-anchor="middle" font-family="Arial, sans-serif">C는 논쟁적 재료로 언급</text>
  <text x="240" y="335" fill="#94a3b8" font-size="14" text-anchor="middle" font-family="Arial, sans-serif">Sn, Pb는 갭이 매우 작음</text>
  <rect x="500" y="240" width="180" height="46" rx="12" fill="#172554" stroke="#60a5fa"/>
  <text x="590" y="269" fill="#bfdbfe" font-size="16" text-anchor="middle" font-family="Arial, sans-serif">IV-IV: SiGe, SiC</text>
  <rect x="700" y="240" width="180" height="46" rx="12" fill="#172554" stroke="#60a5fa"/>
  <text x="790" y="269" fill="#bfdbfe" font-size="16" text-anchor="middle" font-family="Arial, sans-serif">III-V: InP, GaAs</text>
  <rect x="500" y="300" width="180" height="46" rx="12" fill="#172554" stroke="#60a5fa"/>
  <text x="590" y="329" fill="#bfdbfe" font-size="16" text-anchor="middle" font-family="Arial, sans-serif">II-VI: CdTe</text>
  <rect x="700" y="300" width="180" height="46" rx="12" fill="#172554" stroke="#60a5fa"/>
  <text x="790" y="329" fill="#bfdbfe" font-size="16" text-anchor="middle" font-family="Arial, sans-serif">IV-VI: PbS</text>
  <rect x="560" y="360" width="320" height="44" rx="12" fill="#172554" stroke="#fbbf24"/>
  <text x="720" y="388" fill="#fde68a" font-size="14" text-anchor="middle" font-family="Arial, sans-serif">(InxGa1-x)(AsyP1-y)</text>
</svg>
</div>

**그림 3.** 반도체 재료 분류 체계 `[27:19]` `[중요]`

---

## 6. 실리콘이 저마늄보다 선호되는 이유

| 이유 | 물리적/공정적 의미 | 근거 | 중요도 |
|---|---|---|---|
| 1. 가격 | Si가 Ge보다 훨씬 저렴 | `[34:28]` | 핵심 |
| 2. 차단 전류 | Si의 차단 전류가 훨씬 작음; 밴드갭과 관련 | `[35:08]` | 핵심 |
| 3. 고온 안정성 | Ge 결정은 고온에서 쉽게 손상될 수 있음 | `[37:48]` | 핵심 |
| 4. 항복 전압 | Si의 항복 전압이 더 높음; 고전압에서 더 신뢰성 있음 | `[38:28]` | 핵심 |
| 5. \(\text{SiO}_2\) 형성 | Si 표면에 절연체 \(\text{SiO}_2\)를 쉽게 형성 가능 | `[39:48]` | 핵심 |

### 6.1 밴드갭과 전류 제어

- Ge의 밴드갭은 \(0.67\ \text{eV}\)로 작다. `[33:48]` `[핵심]`
- 밴드갭이 너무 작으면 전류를 제어하기 어렵다. `[33:48]` `[핵심]`
- 따라서 더 큰 밴드갭을 가진 Si가 선호된다. `[33:48]` `[핵심]`

### 6.2 스위칭 소자와 차단 전류

- 트랜지스터와 다이오드는 종종 스위치로 사용된다.  
- 스위치의 **off 상태 전류**가 작을수록 좋다. `[37:08]` `[핵심]`
- Ge는 차단 전류 관점에서 좋은 스위치 재료로 불리하다. `[37:08]` `[중요]`

### 6.3 \(\text{SiO}_2\)의 중요성

- \(\text{SiO}_2\)는 절연체이다. `[39:48]` `[핵심]`
- 실리콘 위에 쉽게 형성할 수 있어 소자 구조 형성에 유리하다. `[39:48]` `[핵심]`
- 절연막을 이용해 커패시터 구조를 만들 수 있으며, 이는 트랜지스터 구현과 연결된다. `[41:08]` `[참고]`

---

## 7. 실리콘 원자 구조와 공유결합

### 7.1 실리콘의 전자 배치

- 실리콘은 원자가 전자 4개를 가진 4족 원소이다. `[46:28]` `[50:07]` `[핵심]`
- 원자가 전자는 바깥쪽 \(3s\), \(3p\) 준위에 해당하며, 이 두 에너지 준위는 서로 매우 가깝다. `[45:08]` `[중요]`
- 이 근접한 에너지 준위들은 **\(sp^3\) 혼성 궤도**를 형성한다. `[47:08]` `[핵심]`

### 7.2 공유결합 형성

- \(sp^3\) 혼성 궤도에 있는 4개의 전자는 핵으로부터 상대적으로 멀리 있어 느슨하게 속박되어 있다. `[47:48]` `[중요]`
- 이 전자들은 인접한 실리콘 원자의 전자와 결합하려고 한다. `[47:48]` `[핵심]`
- 그 결과 실리콘은 인접한 4개의 원자와 **공유결합**을 형성한다. `[50:07]` `[핵심]`

### 7.3 실리콘 격자의 기본 수치

| 물리량 | 값 | 의미 | 근거 | 중요도 |
|---|---:|---|---|---|
| 원자 밀도 | \(5 \times 10^{22}\ \text{atoms/cm}^3\) | 단위 부피당 Si 원자 수 | `[50:07]` | 핵심 |
| 원자가 전자 수 | 4 | 공유결합 수 결정 | `[50:07]` | 핵심 |
| 최근접 이웃 수 | 4 | 4개의 공유결합 형성 | `[50:07]` | 핵심 |

---

## 8. 전자-정공 쌍 생성 메커니즘

### 8.1 결합 끊김과 캐리어 생성

- 실리콘 격자에 열 또는 작은 에너지가 가해지면 공유결합 하나가 끊어질 수 있다. `[51:08]` `[핵심]`
- 결합에서 벗어난 전자는 **자유전자**가 된다. `[51:48]` `[핵심]`
- 전자가 빠져나간 자리에는 빈 자리가 생기며, 이를 **정공**이라 한다. `[51:48]` `[핵심]`

### 8.2 전자와 정공의 동수 발생

- 자유전자 하나가 생성되면 동시에 정공 하나가 생성된다. `[52:28]` `[핵심]`
- 따라서 도핑되지 않은 진성 실리콘에서는  
  \[
  n = p
  \]
  이다. `[52:28]` `[핵심]`
- 여기서  
  - \(n\): 자유전자 수 또는 농도  
  - \(p\): 정공 수 또는 농도  
  이다.

### 8.3 온도 효과

- 온도가 올라가면 전자가 격자에서 자유로워질 수 있다. `[50:07]` `[핵심]`
- 이는 열적 에너지가 공유결합을 끊는 데 기여하기 때문이다. `[50:07]` `[51:08]` `[핵심]`

<div align="center" style="margin: 16px 0; page-break-inside: avoid;">
<svg width="100%" height="auto" viewBox="0 0 960 380" xmlns="http://www.w3.org/2000/svg">
  <rect width="960" height="380" fill="#0b1026"/>
  <text x="480" y="36" fill="#e6ecff" font-size="28" text-anchor="middle" font-family="Arial, sans-serif">실리콘 격자의 전자-정공 쌍 생성</text>
  <text x="120" y="80" fill="#fbbf24" font-size="18" font-family="Arial, sans-serif">열 에너지</text>
  <path d="M180 95 C240 120, 280 120, 330 145" fill="none" stroke="#fbbf24" stroke-width="3"/>
  <path d="M320 136 L335 148 L317 151" fill="#fbbf24"/>
  <!-- Si atoms -->
  <circle cx="360" cy="180" r="26" fill="#1d4ed8" stroke="#93c5fd" stroke-width="2"/>
  <text x="360" y="187" fill="#ffffff" font-size="16" text-anchor="middle" font-family="Arial, sans-serif">Si</text>
  <circle cx="560" cy="180" r="26" fill="#1d4ed8" stroke="#93c5fd" stroke-width="2"/>
  <text x="560" y="187" fill="#ffffff" font-size="16" text-anchor="middle" font-family="Arial, sans-serif">Si</text>
  <circle cx="360" cy="290" r="26" fill="#1d4ed8" stroke="#93c5fd" stroke-width="2"/>
  <text x="360" y="297" fill="#ffffff" font-size="16" text-anchor="middle" font-family="Arial, sans-serif">Si</text>
  <circle cx="560" cy="290" r="26" fill="#1d4ed8" stroke="#93c5fd" stroke-width="2"/>
  <text x="560" y="297" fill="#ffffff" font-size="16" text-anchor="middle" font-family="Arial, sans-serif">Si</text>
  <!-- intact bonds -->
  <line x1="386" y1="180" x2="534" y2="180" stroke="#93c5fd" stroke-width="3" opacity="0.0"/>
  <line x1="360" y1="206" x2="360" y2="264" stroke="#93c5fd" stroke-width="3"/>
  <line x1="560" y1="206" x2="560" y2="264" stroke="#93c5fd" stroke-width="3"/>
  <line x1="386" y1="290" x2="534" y2="290" stroke="#93c5fd" stroke-width="3"/>
  <line x1="382" y1="200" x2="538" y2="270" stroke="#93c5fd" stroke-width="3"/>
  <line x1="382" y1="270" x2="538" y2="200" stroke="#93c5fd" stroke-width="3"/>
  <!-- broken bond -->
  <line x1="386" y1="180" x2="440" y2="180" stroke="#f87171" stroke-width="3" stroke-dasharray="8 6"/>
  <line x1="490" y1="180" x2="534" y2="180" stroke="#f87171" stroke-width="3" stroke-dasharray="8 6"/>
  <!-- hole -->
  <circle cx="465" cy="180" r="12" fill="#0b1026" stroke="#f8fafc" stroke-width="2"/>
  <text x="465" y="186" fill="#f8fafc" font-size="14" text-anchor="middle" font-family="Arial, sans-serif">+</text>
  <text x="465" y="145" fill="#f8fafc" font-size="16" text-anchor="middle" font-family="Arial, sans-serif">정공 h+</text>
  <!-- free electron -->
  <circle cx="680" cy="120" r="12" fill="#fde68a" stroke="#fbbf24" stroke-width="2"/>
  <text x="680" y="126" fill="#0b1026" font-size="14" text-anchor="middle" font-family="Arial, sans-serif">-</text>
  <text x="735" y="105" fill="#fde68a" font-size="16" text-anchor="middle" font-family="Arial, sans-serif">자유전자 e-</text>
  <path d="M545 165 C600 145, 630 135, 663 125" fill="none" stroke="#fde68a" stroke-width="2.5"/>
  <path d="M653 118 L668 124 L654 132" fill="#fde68a"/>
  <rect x="250" y="330" width="460" height="38" rx="12" fill="#101836" stroke="#3b4f86"/>
  <text x="480" y="355" fill="#e6ecff" font-size="18" text-anchor="middle" font-family="Arial, sans-serif">sp³ 공유결합 절단 → 자유전자 + 정공, n = p</text>
</svg>
</div>

**그림 4.** 열적 여기에 의한 전자-정공 쌍 생성 `[50:07]` `[51:08]` `[52:28]` `[핵심]`

---

## 9. 트랜지스터의 본질: Transfer Resistor

### 9.1 이름의 의미

- 트랜지스터는 **Transfer**와 **Resistor**의 합성어이다. `[41:48]` `[핵심]`
- 핵심 정의는 “트랜지스터는 자신의 저항을 변조할 수 있는 소자”이다. `[43:08]` `[핵심]`

### 9.2 \(I\)-\(V\) 곡선에서의 의미

- \(I\) 대 \(V\) 특성을 그리면, 동작 조건에 따라 곡선의 기울기가 달라질 수 있다. `[42:28]` `[중요]`
- 기울기가 달라진다는 것은 전압-전류 관계에서 유효 저항이 달라진다는 뜻이다. `[42:28]` `[중요]`
- 따라서 트랜지스터는 단순히 도통/차단만 하는 소자가 아니라, **저항 값을 제어하는 소자**로 이해할 수 있다. `[43:08]` `[핵심]`

<svg width="100%" height="auto" viewBox="0 0 960 340" xmlns="http://www.w3.org/2000/svg">
  <rect width="960" height="340" fill="#0