# DeepSeek V4 Flash 0731 강의 요약 노트

- **모델 ID**: `deepseek/deepseek-v4-flash-0731`
- **생성 소요 시간**: 80.2초
- **본문 분량**: 19,801자
- **기준 강의**: EEE2050 Lecture 3: Basic Semiconductor Physics
- **특징**: 모델 고유의 독자적인 인라인 SVG 벡터 다이어그램 자체 생성

> **작성 기준**: 타임라인 근거의 정정·예외·반례·부정·조건·숫자·단위·기호와 수식을 완벽히 보존하고, 잡음·반복 인사는 완전 배제했으며 제외 사유 설명은 일절 포함하지 않았습니다.

---

## 핵심 요약 (시험 중요 내용)

| 항목 | 내용 | 중요도 |
|------|------|--------|
| **에너지 밴드 갭 (Eg)** | 절연체: Eg > 5eV, 반도체: 1eV < Eg < 3eV, 도체: Eg = 0eV (밴드 중첩) | 핵심 |
| **대표 반도체 Eg** | Si: 1.1eV, Ge: 0.67eV | 핵심 |
| **밴드 정의** | 고체 내 전자가 점유 가능한 허용 에너지 상태들의 집합 | 핵심 |
| **밴드 갭 정의** | 전자가 점유할 수 없는 에너지 상태가 존재하지 않는 영역 | 핵심 |
| **Si 원자 밀도** | 5 × 10²² atoms/cm³ | 중요 |
| **Si 원자가 전자** | 4개 (3s² 3p²) → sp³ 혼성 오비탈 형성 | 핵심 |
| **트랜지스터 정의** | 저항을 변조(modulate)할 수 있는 소자 (Transfer + Resistor) | 핵심 |

---

## 1. 에너지 밴드 구조와 물질 분류

### 1.1 에너지 밴드의 개념

**밴드(Band)**: 고체 내에서 전자가 점유할 수 있는 허용 에너지 상태들의 집합

- **원자가 밴드(Valence Band)**: 핵에 강하게 결합된 전자들로 완전히 채워진 상태
  - 핵에 가까운 전자 → 인력(attraction force)이 강함 → 낮은 에너지 상태
  - 전자들이 완전히 점유(full)되어 있음
- **전도 밴드(Conduction Band)**: 핵으로부터 자유로워 전류 흐름에 기여할 수 있는 전자들이 존재하는 높은 에너지 상태
  - 초기 상태: 전자가 거의 없음 → 전류 흐름 없음
  - 전자가 전도 밴드로 이동하려면 외부 에너지 인가 필요

**에너지 갭(Energy Gap, Eg)**: 원자가 밴드와 전도 밴드 사이의 에너지 간격
- 이 영역에는 전자가 점유할 수 있는 상태가 존재하지 않음
- "밴드 갭에는 전자가 거주할 수 있는 집(상태)이 없다"

### 1.2 물질별 에너지 밴드 구조 비교

| 물질 | Eg 값 | 전도 특성 |
|------|--------|-----------|
| 절연체 | > 5eV | 높은 저항 (High resistivity) |
| 반도체 | 1eV ~ 3eV | 중간 저항 (Intermediate resistivity) |
| 도체 | 0eV (밴드 중첩) | 낮은 저항 (Low resistivity) |

<div align="center" style="margin: 16px 0; page-break-inside: avoid;">
<svg width="100%" height="auto" viewBox="0 0 800 400" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" style="stop-color:#1a1a2e;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#16213e;stop-opacity:1" />
    </linearGradient>
    <linearGradient id="cbGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" style="stop-color:#4ecdc4;stop-opacity:0.8" />
      <stop offset="100%" style="stop-color:#45b7d1;stop-opacity:0.8" />
    </linearGradient>
    <linearGradient id="vbGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" style="stop-color:#f7d794;stop-opacity:0.8" />
      <stop offset="100%" style="stop-color:#f5cd79;stop-opacity:0.8" />
    </linearGradient>
  </defs>
  <rect width="800" height="400" fill="url(#bgGrad)" rx="10"/>
  <!-- Title -->
  <text x="400" y="35" text-anchor="middle" fill="#ffffff" font-size="18" font-weight="bold" font-family="Arial">에너지 밴드 구조 비교</text>
  <!-- Insulator Section -->
  <text x="130" y="70" text-anchor="middle" fill="#ff6b6b" font-size="16" font-weight="bold" font-family="Arial">절연체 (Insulator)</text>
  <text x="130" y="90" text-anchor="middle" fill="#ff6b6b" font-size="13" font-family="Arial">Eg > 5eV</text>
  <rect x="55" y="110" width="150" height="50" fill="url(#cbGrad)" rx="5"/>
  <text x="130" y="140" text-anchor="middle" fill="#1a1a2e" font-size="12" font-weight="bold" font-family="Arial">전도 밴드 (CB)</text>
  <!-- Large band gap -->
  <rect x="55" y="165" width="150" height="100" fill="none" stroke="#ff6b6b" stroke-width="2" stroke-dasharray="5,5" rx="5"/>
  <text x="130" y="210" text-anchor="middle" fill="#ff6b6b" font-size="14" font-weight="bold" font-family="Arial">Eg > 5eV</text>
  <text x="130" y="230" text-anchor="middle" fill="#ff6b6b" font-size="11" font-family="Arial">(매우 큰 갭)</text>
  <rect x="55" y="270" width="150" height="50" fill="url(#vbGrad)" rx="5"/>
  <text x="130" y="300" text-anchor="middle" fill="#1a1a2e" font-size="12" font-weight="bold" font-family="Arial">원자가 밴드 (VB)</text>
  <!-- Semiconductor Section -->
  <text x="400" y="70" text-anchor="middle" fill="#4ecdc4" font-size="16" font-weight="bold" font-family="Arial">반도체 (Semiconductor)</text>
  <text x="400" y="90" text-anchor="middle" fill="#4ecdc4" font-size="13" font-family="Arial">1eV < Eg < 3eV</text>
  <rect x="325" y="110" width="150" height="50" fill="url(#cbGrad)" rx="5"/>
  <text x="400" y="140" text-anchor="middle" fill="#1a1a2e" font-size="12" font-weight="bold" font-family="Arial">전도 밴드 (CB)</text>
  <!-- Small band gap -->
  <rect x="325" y="165" width="150" height="40" fill="none" stroke="#4ecdc4" stroke-width="2" stroke-dasharray="5,5" rx="5"/>
  <text x="400" y="190" text-anchor="middle" fill="#4ecdc4" font-size="13" font-weight="bold" font-family="Arial">Eg ≈ 1.1eV (Si)</text>
  <rect x="325" y="210" width="150" height="50" fill="url(#vbGrad)" rx="5"/>
  <text x="400" y="240" text-anchor="middle" fill="#1a1a2e" font-size="12" font-weight="bold" font-family="Arial">원자가 밴드 (VB)</text>
  <!-- Conductor Section -->
  <text x="670" y="70" text-anchor="middle" fill="#f7d794" font-size="16" font-weight="bold" font-family="Arial">도체 (Conductor)</text>
  <text x="670" y="90" text-anchor="middle" fill="#f7d794" font-size="13" font-family="Arial">Eg = 0eV (중첩)</text>
  <!-- Overlapping bands -->
  <rect x="595" y="110" width="150" height="50" fill="url(#cbGrad)" rx="5"/>
  <text x="670" y="140" text-anchor="middle" fill="#1a1a2e" font-size="12" font-weight="bold" font-family="Arial">전도 밴드 (CB)</text>
  <rect x="595" y="140" width="150" height="50" fill="url(#vbGrad)" rx="5" opacity="0.7"/>
  <text x="670" y="170" text-anchor="middle" fill="#1a1a2e" font-size="12" font-weight="bold" font-family="Arial">원자가 밴드 (VB)</text>
  <!-- Overlap indicator -->
  <path d="M 595 130 L 745 130" stroke="#ff6b6b" stroke-width="3" fill="none"/>
  <text x="670" y="125" text-anchor="middle" fill="#ff6b6b" font-size="11" font-weight="bold" font-family="Arial">밴드 중첩 (Eg = 0)</text>
  <!-- Energy axis -->
  <line x1="30" y1="100" x2="30" y2="330" stroke="#ffffff" stroke-width="2"/>
  <polygon points="30,100 25,115 35,115" fill="#ffffff"/>
  <text x="20" y="95" text-anchor="end" fill="#ffffff" font-size="12" font-family="Arial">E</text>
  <text x="15" y="120" text-anchor="end" fill="#ffffff" font-size="10" font-family="Arial">높음</text>
  <text x="15" y="320" text-anchor="end" fill="#ffffff" font-size="10" font-family="Arial">낮음</text>
  <!-- Legend -->
  <text x="400" y="360" text-anchor="middle" fill="#ffffff" font-size="12" font-family="Arial">전도성: 도체 > 반도체 > 절연체</text>
  <text x="400" y="380" text-anchor="middle" fill="#ffffff" font-size="11" font-family="Arial">저항: 절연체 > 반도체 > 도체</text>
</svg>
</div>

### 1.3 전도 메커니즘

- **절연체**: Eg가 매우 커서(>5eV) 전자를 전도 밴드로 여기시키기 위해 매우 큰 에너지 필요 → 전도 어려움
- **도체**: 전도 밴드와 원자가 밴드가 중첩되어 에너지 갭이 0 → 작은 에너지로도 전자 자유롭게 이동 가능
- **반도체**: 중간 정도의 Eg(1~3eV) → 적절한 에너지 인가로 전도 가능

---

## 2. 반도체 결정 구조

### 2.1 결정 구조의 분류

| 구조 | 원자 배열 | 특징 |
|------|-----------|------|
| **단결정 (Crystalline)** | 원자가 규칙적으로 잘 정렬 | IC 제작에 필수 |
| **다결정 (Polycrystalline)** | 여러 결정립이 결합된 구조 | 결정립계(Grain Boundary) 존재 |
| **비정질 (Amorphous)** | 원자가 무질서하게 배열 | 최근 상업적으로 중요 |

<div align="center" style="margin: 16px 0; page-break-inside: avoid;">
<svg width="100%" height="auto" viewBox="0 0 900 350" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bgGrad2" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" style="stop-color:#0f3460;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#1a1a2e;stop-opacity:1" />
    </linearGradient>
  </defs>
  <rect width="900" height="350" fill="url(#bgGrad2)" rx="10"/>
  <text x="450" y="30" text-anchor="middle" fill="#ffffff" font-size="18" font-weight="bold" font-family="Arial">반도체 결정 구조 비교</text>
  <!-- Crystalline Section -->
  <text x="150" y="65" text-anchor="middle" fill="#4ecdc4" font-size="15" font-weight="bold" font-family="Arial">단결정 (Crystalline)</text>
  <!-- Regular lattice -->
  <g transform="translate(50, 80)">
    <!-- Grid lines -->
    <line x1="0" y1="0" x2="200" y2="0" stroke="#4ecdc4" stroke-width="1" opacity="0.3"/>
    <line x1="0" y1="50" x2="200" y2="50" stroke="#4ecdc4" stroke-width="1" opacity="0.3"/>
    <line x1="0" y1="100" x2="200" y2="100" stroke="#4ecdc4" stroke-width="1" opacity="0.3"/>
    <line x1="0" y1="150" x2="200" y2="150" stroke="#4ecdc4" stroke-width="1" opacity="0.3"/>
    <line x1="0" y1="0" x2="0" y2="200" stroke="#4ecdc4" stroke-width="1" opacity="0.3"/>
    <line x1="50" y1="0" x2="50" y2="200" stroke="#4ecdc4" stroke-width="1" opacity="0.3"/>
    <line x1="100" y1="0" x2="100" y2="200" stroke="#4ecdc4" stroke-width="1" opacity="0.3"/>
    <line x1="150" y1="0" x2="150" y2="200" stroke="#4ecdc4" stroke-width="1" opacity="0.3"/>
    <line x1="200" y1="0" x2="200" y2="200" stroke="#4ecdc4" stroke-width="1" opacity="0.3"/>
    <!-- Atoms -->
    <circle cx="0" cy="0" r="12" fill="#4ecdc4" opacity="0.9"/>
    <circle cx="50" cy="0" r="12" fill="#4ecdc4" opacity="0.9"/>
    <circle cx="100" cy="0" r="12" fill="#4ecdc4" opacity="0.9"/>
    <circle cx="150" cy="0" r="12" fill="#4ecdc4" opacity="0.9"/>
    <circle cx="200" cy="0" r="12" fill="#4ecdc4" opacity="0.9"/>
    <circle cx="0" cy="50" r="12" fill="#4ecdc4" opacity="0.9"/>
    <circle cx="50" cy="50" r="12" fill="#4ecdc4" opacity="0.9"/>
    <circle cx="100" cy="50" r="12" fill="#4ecdc4" opacity="0.9"/>
    <circle cx="150" cy="50" r="12" fill="#4ecdc4" opacity="0.9"/>
    <circle cx="200" cy="50" r="12" fill="#4ecdc4" opacity="0.9"/>
    <circle cx="0" cy="100" r="12" fill="#4ecdc4" opacity="0.9"/>
    <circle cx="50" cy="100" r="12" fill="#4ecdc4" opacity="0.9"/>
    <circle cx="100" cy="100" r="12" fill="#4ecdc4" opacity="0.9"/>
    <circle cx="150" cy="100" r="12" fill="#4ecdc4" opacity="0.9"/>
    <circle cx="200" cy="100" r="12" fill="#4ecdc4" opacity="0.9"/>
    <circle cx="0" cy="150" r="12" fill="#4ecdc4" opacity="0.9"/>
    <circle cx="50" cy="150" r="12" fill="#4ecdc4" opacity="0.9"/>
    <circle cx="100" cy="150" r="12" fill="#4ecdc4" opacity="0.9"/>
    <circle cx="150" cy="150" r="12" fill="#4ecdc4" opacity="0.9"/>
    <circle cx="200" cy="150" r="12" fill="#4ecdc4" opacity="0.9"/>
  </g>
  <text x="150" y="300" text-anchor="middle" fill="#4ecdc4" font-size="11" font-family="Arial">규칙적인 격자 배열</text>
  <!-- Polycrystalline Section -->
  <text x="450" y="65" text-anchor="middle" fill="#f7d794" font-size="15" font-weight="bold" font-family="Arial">다결정 (Polycrystalline)</text>
  <g transform="translate(350, 80)">
    <!-- Grain 1 -->
    <rect x="0" y="0" width="80" height="80" fill="none" stroke="#f7d794" stroke-width="2"/>
    <circle cx="20" cy="20" r="8" fill="#f7d794" opacity="0.8"/>
    <circle cx="50" cy="20" r="8" fill="#f7d794" opacity="0.8"/>
    <circle cx="20" cy="50" r="8" fill="#f7d794" opacity="0.8"/>
    <circle cx="50" cy="50" r="8" fill="#f7d794" opacity="0.8"/>
    <!-- Grain 2 (rotated) -->
    <rect x="80" y="0" width="80" height="80" fill="none" stroke="#f7d794" stroke-width="2"/>
    <circle cx="100" cy="20" r="8" fill="#f7d794" opacity="0.8"/>
    <circle cx="130" cy="20" r="8" fill="#f7d794" opacity="0.8"/>
    <circle cx="100" cy="50" r="8" fill="#f7d794" opacity="0.8"/>
    <circle cx="130" cy="50" r="8" fill="#f7d794" opacity="0.8"/>
    <!-- Grain 3 -->
    <rect x="0" y="80" width="80" height="80" fill="none" stroke="#f7d794" stroke-width="2"/>
    <circle cx="20" cy="100" r="8" fill="#f7d794" opacity="0.8"/>
    <circle cx="50" cy="100" r="8" fill="#f7d794" opacity="0.8"/>
    <circle cx="20" cy="130" r="8" fill="#f7d794" opacity="0.8"/>
    <circle cx="50" cy="130" r="8" fill="#f7d794" opacity="0.8"/>
    <!-- Grain 4 (different orientation) -->
    <rect x="80" y="80" width="80" height="80" fill="none" stroke="#f7d794" stroke-width="2"/>
    <circle cx="110" cy="100" r="8" fill="#f7d794" opacity="0.8"/>
    <circle cx="130" cy="120" r="8" fill="#f7d794" opacity="0.8"/>
    <circle cx="100" cy="130" r="8" fill="#f7d794" opacity="0.8"/>
    <circle cx="140" cy="100" r="8" fill="#f7d794" opacity="0.8"/>
    <!-- Grain boundaries -->
    <line x1="80" y1="0" x2="80" y2="160" stroke="#ff6b6b" stroke-width="3" stroke-dasharray="4,2"/>
    <line x1="0" y1="80" x2="160" y2="80" stroke="#ff6b6b" stroke-width="3" stroke-dasharray="4,2"/>
  </g>
  <text x="450" y="300" text-anchor="middle" fill="#ff6b6b" font-size="11" font-family="Arial">결정립계 (Grain Boundary) 존재</text>
  <!-- Amorphous Section -->
  <text x="750" y="65" text-anchor="middle" fill="#a29bfe" font-size="15" font-weight="bold" font-family="Arial">비정질 (Amorphous)</text>
  <g transform="translate(650, 80)">
    <!-- Random atoms -->
    <circle cx="20" cy="30" r="8" fill="#a29bfe" opacity="0.8"/>
    <circle cx="60" cy="15" r="8" fill="#a29bfe" opacity="0.8"/>
    <circle cx="100" cy="40" r="8" fill="#a29bfe" opacity="0.8"/>
    <circle cx="140" cy="20" r="8" fill="#a29bfe" opacity="0.8"/>
    <circle cx="30" cy="70" r="8" fill="#a29bfe" opacity="0.8"/>
    <circle cx="80" cy="60" r="8" fill="#a29bfe" opacity="0.8"/>
    <circle cx="120" cy="80" r="8" fill="#a29bfe" opacity="0.8"/>
    <circle cx="50" cy="110" r="8" fill="#a29bfe" opacity="0.8"/>
    <circle cx="90" cy="120" r="8" fill="#a29bfe" opacity="0.8"/>
    <circle cx="140" cy="110" r="8" fill="#a29bfe" opacity="0.8"/>
    <circle cx="20" cy="140" r="8" fill="#a29bfe" opacity="0.8"/>
    <circle cx="70" cy="140" r="8" fill="#a29bfe" opacity="0.8"/>
    <circle cx="110" cy="140" r="8" fill="#a29bfe" opacity="0.8"/>
    <!-- Random connections -->
    <line x1="20" y1="30" x2="60" y2="15" stroke="#a29bfe" stroke-width="1" opacity="0.4"/>
    <line x1="60" y1="15" x2="100" y2="40" stroke="#a29bfe" stroke-width="1" opacity="0.4"/>
    <line x1="30" y1="70" x2="80" y2="60" stroke="#a29bfe" stroke-width="1" opacity="0.4"/>
    <line x1="80" y1="60" x2="120" y2="80" stroke="#a29bfe" stroke-width="1" opacity="0.4"/>
    <line x1="50" y1="110" x2="90" y2="120" stroke="#a29bfe" stroke-width="1" opacity="0.4"/>
  </g>
  <text x="750" y="300" text-anchor="middle" fill="#a29bfe" font-size="11" font-family="Arial">무질서한 원자 배열</text>
  <!-- IC application note -->
  <rect x="50" y="315" width="800" height="25" fill="#16213e" rx="5"/>
  <text x="450" y="332" text-anchor="middle" fill="#4ecdc4" font-size="12" font-family="Arial">IC 제작에는 단결정 실리콘 필수: 원자 배열이 규칙적이어야 전자 거동 예측 가능</text>
</svg>
</div>

### 2.2 단결정의 중요성

- **IC 제작에 단결정 실리콘이 필수인 이유**: 
  - 원자 배열이 규칙적이어야 실리콘 내부에서 전자의 거동을 정확히 예측할 수 있음
  - 최신 공정은 3nm 기술 노드까지 진행 → 수십 nm 수준의 정밀한 제어 필요
  - 원자 배열이 불규칙하면 전자 거동 예측 불가 → 소자 특성 제어 불가

---

## 3. 반도체 재료 분류

### 3.1 주기율표에서의 반도체 재료

**4족 원소 (단원소 반도체)**:
- **Si (실리콘)**: 현대 반도체 산업의 대표 물질
- **Ge (게르마늄)**: 최초의 트랜지스터(point contact)에 사용, 현재는 제한적 사용
- C (탄소): 논란의 여지가 있어 제외

**화합물 반도체**:
- **III-V족**: GaAs, InP 등
- **IV-IV족**: Si-Ge, Si-C
- **II-VI족**: CdTe
- **IV-VI족**: PbS
- **3원계/4원계**: (InₓGa₁₋ₓ)(AsyP₁₋y)

<div align="center" style="margin: 16px 0; page-break-inside: avoid;">
<svg width="100%" height="auto" viewBox="0 0 900 400" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bgGrad3" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#1a1a2e;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#0f3460;stop-opacity:1" />
    </linearGradient>
  </defs>
  <rect width="900" height="400" fill="url(#bgGrad3)" rx="10"/>
  <text x="450" y="35" text-anchor="middle" fill="#ffffff" font-size="18" font-weight="bold" font-family="Arial">반도체 재료 분류 체계</text>
  <!-- Elemental Section -->
  <rect x="50" y="60" width="380" height="150" fill="#16213e" rx="10" stroke="#4ecdc4" stroke-width="2"/>
  <text x="240" y="85" text-anchor="middle" fill="#4ecdc4" font-size="16" font-weight="bold" font-family="Arial">단원소 반도체 (Elemental)</text>
  <text x="240" y="105" text-anchor="middle" fill="#4ecdc4" font-size="12" font-family="Arial">4족 원소 단일 원소</text>
  <!-- Si box -->
  <rect x="80" y="120" width="100" height="60" fill="#4ecdc4" rx="8" opacity="0.9"/>
  <text x="130" y="150" text-anchor="middle" fill="#1a1a2e" font-size="20" font-weight="bold" font-family="Arial">Si</text>
  <text x="130" y="170" text-anchor="middle" fill="#1a1a2e" font-size="11" font-family="Arial">Eg = 1.1eV</text>
  <!-- Ge box -->
  <rect x="200" y="120" width="100" height="60" fill="#45b7d1" rx="8" opacity="0.9"/>
  <text x="250" y="150" text-anchor="middle" fill="#1a1a2e" font-size="20" font-weight="bold" font-family="Arial">Ge</text>
  <text x="250" y="170" text-anchor="middle" fill="#1a1a2e" font-size="11" font-family="Arial">Eg = 0.67eV</text>
  <!-- C box (excluded) -->
  <rect x="320" y="120" width="80" height="60" fill="#555" rx="8" opacity="0.5"/>
  <text x="360" y="150" text-anchor="middle" fill="#aaa" font-size="20" font-weight="bold" font-family="Arial">C</text>
  <text x="360" y="170" text-anchor="middle" fill="#aaa" font-size="10" font-family="Arial">제외</text>
  <!-- Compound Section -->
  <rect x="470" y="60" width="380" height="150" fill="#16213e" rx="10" stroke="#f7d794" stroke-width="2"/>
  <text x="660" y="85" text-anchor="middle" fill="#f7d794" font-size="16" font-weight="bold" font-family="Arial">화합물 반도체 (Compound)</text>
  <text x="660" y="105" text-anchor="middle" fill="#f7d794" font-size="12" font-family="Arial">두 종류 이상의 원소 결합</text>
  <!-- III-V -->
  <rect x="490" y="120" width="80" height="60" fill="#f7d794" rx="8" opacity="0.9"/>
  <text x="530" y="145" text-anchor="middle" fill="#1a1a2e" font-size="14" font-weight="bold" font-family="Arial">III-V</text>
  <text x="530" y="165" text-anchor="middle" fill="#1a1a2e" font-size="10" font-family="Arial">GaAs, InP</text>
  <!-- IV-IV -->
  <rect x="580" y="120" width="80" height="60" fill="#f5cd79" rx="8" opacity="0.9"/>
  <text x="620" y="145" text-anchor="middle" fill="#1a1a2e" font-size="14" font-weight="bold" font-family="Arial">IV-IV</text>
  <text x="620" y="165" text-anchor="middle" fill="#1a1a2e" font-size="10" font-family="Arial">Si-Ge, Si-C</text>
  <!-- II-VI -->
  <rect x="670" y="120" width="80" height="60" fill="#e77f67" rx="8" opacity="0.9"/>
  <text x="710" y="145" text-anchor="middle" fill="#1a1a2e" font-size="14" font-weight="bold" font-family="Arial">II-VI</text>
  <text x="710" y="165" text-anchor="middle" fill="#1a1a2e" font-size="10" font-family="Arial">CdTe</text>
  <!-- IV-VI -->
  <rect x="760" y="120" width="70" height="60" fill="#e15f41" rx="8" opacity="0.9"/>
  <text x="795" y="145" text-anchor="middle" fill="#1a1a2e" font-size="14" font-weight="bold" font-family="Arial">IV-VI</text>
  <text x="795" y="165" text-anchor="middle" fill="#1a1a2e" font-size="10" font-family="Arial">PbS</text>
  <!-- Application examples -->
  <rect x="50" y="230" width="800" height="150" fill="#16213e" rx="10"/>
  <text x="450" y="260" text-anchor="middle" fill="#ffffff" font-size="15" font-weight="bold" font-family="Arial">응용 분야</text>
  <!-- SpaceX solar cells -->
  <rect x="80" y="280" width="340" height="80" fill="#0f3460" rx="8" stroke="#4ecdc4" stroke-width="1"/>
  <text x="250" y="305" text-anchor="middle" fill="#4ecdc4" font-size="13" font-weight="bold" font-family="Arial">SpaceX 위성 태양전지</text>
  <text x="250" y="325" text-anchor="middle" fill="#4ecdc4" font-size="11" font-family="Arial">고성능 III-V 화합물 반도체 사용</text>
  <text x="250" y="345" text-anchor="middle" fill="#4ecdc4" font-size="11" font-family="Arial">(GaAs 계열)</text>
  <!-- Si vs Ge -->
  <rect x="480" y="280" width="340" height="80" fill="#0f3460" rx="8" stroke="#f7d794" stroke-width="1"/>
  <text x="650" y="305" text-anchor="middle" fill="#f7d794" font-size="13" font-weight="bold" font-family="Arial">Si vs Ge 선택 이유</text>
  <text x="650" y="325" text-anchor="middle" fill="#f7d794" font-size="11" font-family="Arial">Si: Eg 큼 → off-current 작음</text>
  <text x="650" y="345" text-anchor="middle" fill="#f7d794" font-size="11" font-family="Arial">Ge: Eg 작음 → off-current 큼</text>
</svg>
</div>

### 3.2 실리콘(Si)이 게르마늄(Ge)보다 선호되는 이유

| 구분 | 실리콘 (Si) | 게르마늄 (Ge) |
|------|-------------|---------------|
| **비용** | 훨씬 저렴 | 고가 |
| **차단 전류 (Off-current)** | 훨씬 작음 (Eg=1.1eV) | 큼 (Eg=0.67eV) |
| **고온 안정성** | 우수 | 고온에서 쉽게 파괴 |
| **항복 전압** | 높음 | 낮음 |
| **SiO₂ 형성** | 자연 산화막 형성 가능 | 해당 없음 |

**Off-current가 중요한 이유**:
- 트랜지스터와 다이오드는 스위치로 사용됨
- 스위치의 ON/OFF 상태가 명확히 구분되어야 함
- Off-current가 작을수록 스위치 성능 우수
- Ge는 Eg가 작아 bias를 인가하지 않아도 전류가 흐름 → 스