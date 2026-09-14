# EEE2050 Lecture 3: Basic Semiconductor Physics
## 반도체 물리학 기초

---

## 📌 핵심 결론 (시험 중요도: ★★★)

| 항목 | 내용 | 근거 |
|------|------|------|
| **반도체 정의** | 도체와 절연체 사이의 중간 저항률을 가진 물질 | [20:08] |
| **에너지 갭(Eg)** | 반도체: 1~3 eV / 절연체: >5 eV / 도체: 0 eV (중첩) | [16:28], [17:48] |
| **실리콘 선호 이유** | 저가, 낮은 누설전류, 높은 항복전압, SiO₂ 절연층 형성 가능 | [33:48]~[40:00] |
| **트랜지스터 본질** | 저항 변조 소자 (Transfer Resistor) | [42:28] |
| **결정 구조 필수성** | IC 제조에 필수적 (원자 배열 규칙성이 전자 거동 예측 가능) | [25:48] |

---

## 1. 반도체의 에너지 밴드 구조

### 1.1 밴드(Band) 정의
**밴드**: 고체 내에서 전자가 점유할 수 있는 허용 에너지 상태의 집합

<svg width="100%" height="280" viewBox="0 0 900 280" xmlns="http://www.w3.org/2000/svg">
  <!-- 배경 -->
  <rect width="900" height="280" fill="#0a1428"/>
  
  <!-- 제목 -->
  <text x="450" y="25" font-size="18" font-weight="bold" fill="#e0e0e0" text-anchor="middle">
    에너지 밴드 구조 비교
  </text>
  
  <!-- 절연체 (Insulator) -->
  <g>
    <text x="150" y="55" font-size="14" font-weight="bold" fill="#64b5f6" text-anchor="middle">절연체</text>
    <text x="150" y="75" font-size="11" fill="#90caf9" text-anchor="middle">Eg &gt; 5 eV</text>
    
    <!-- 콘덕션 밴드 -->
    <rect x="100" y="90" width="100" height="20" fill="#ff6b6b" stroke="#ff8787" stroke-width="2"/>
    <text x="150" y="107" font-size="10" fill="#fff" text-anchor="middle">Conduction</text>
    
    <!-- 갭 -->
    <line x1="150" y1="115" x2="150" y2="155" stroke="#ffd54f" stroke-width="3" stroke-dasharray="5,5"/>
    <text x="165" y="138" font-size="10" fill="#ffd54f" font-weight="bold">큰 갭</text>
    
    <!-- 발렌스 밴드 -->
    <rect x="100" y="160" width="100" height="20" fill="#4fc3f7" stroke="#29b6f6" stroke-width="2"/>
    <text x="150" y="177" font-size="10" fill="#fff" text-anchor="middle">Valence</text>
  </g>
  
  <!-- 반도체 (Semiconductor) -->
  <g>
    <text x="450" y="55" font-size="14" font-weight="bold" fill="#64b5f6" text-anchor="middle">반도체 (Si)</text>
    <text x="450" y="75" font-size="11" fill="#90caf9" text-anchor="middle">Eg = 1.1 eV</text>
    
    <!-- 콘덕션 밴드 -->
    <rect x="400" y="100" width="100" height="20" fill="#ff6b6b" stroke="#ff8787" stroke-width="2"/>
    <text x="450" y="117" font-size="10" fill="#fff" text-anchor="middle">Conduction</text>
    
    <!-- 갭 -->
    <line x1="450" y1="125" x2="450" y2="145" stroke="#ffd54f" stroke-width="3" stroke-dasharray="5,5"/>
    <text x="465" y="138" font-size="10" fill="#ffd54f" font-weight="bold">작은 갭</text>
    
    <!-- 발렌스 밴드 -->
    <rect x="400" y="150" width="100" height="20" fill="#4fc3f7" stroke="#29b6f6" stroke-width="2"/>
    <text x="450" y="167" font-size="10" fill="#fff" text-anchor="middle">Valence</text>
  </g>
  
  <!-- 도체 (Conductor) -->
  <g>
    <text x="750" y="55" font-size="14" font-weight="bold" fill="#64b5f6" text-anchor="middle">도체</text>
    <text x="750" y="75" font-size="11" fill="#90caf9" text-anchor="middle">Eg = 0 eV</text>
    
    <!-- 중첩된 밴드 -->
    <rect x="700" y="100" width="100" height="35" fill="#81c784" stroke="#66bb6a" stroke-width="2" opacity="0.7"/>
    <text x="750" y="120" font-size="10" fill="#fff" text-anchor="middle">Conduction</text>
    <text x="750" y="135" font-size="10" fill="#fff" text-anchor="middle">&amp; Valence</text>
    <text x="750" y="155" font-size="10" fill="#ffd54f" font-weight="bold">(중첩)</text>
  </g>
  
  <!-- 범례 -->
  <g>
    <rect x="50" y="220" width="800" height="50" fill="#1a237e" stroke="#3949ab" stroke-width="1" rx="4"/>
    <text x="60" y="240" font-size="11" fill="#e0e0e0">
      • 발렌스 밴드: 원자핵 근처, 전자 밀집 (낮은 에너지)
    </text>
    <text x="60" y="260" font-size="11" fill="#e0e0e0">
      • 콘덕션 밴드: 원자핵 멀리, 자유전자 이동 가능 (높은 에너지)
    </text>
  </g>
</svg>

**[근거 ID: 07:48~17:48 | 중요도: 핵심]**

- **발렌스 밴드(Valence Band)**: 원자핵에 가까운 전자들이 점유하는 에너지 상태 (완전히 채워짐)
- **콘덕션 밴드(Conduction Band)**: 원자핵에서 먼 전자들이 점유하는 에너지 상태 (초기에 거의 비어있음)
- **에너지 갭(Energy Gap, Eg)**: 두 밴드 사이의 에너지 차이
  - 갭 내에는 **허용된 에너지 상태가 없음**

---

## 2. 재료별 에너지 갭 특성

### 2.1 세 가지 재료 분류

| 재료 | 에너지 갭 | 특징 | 전도성 |
|------|----------|------|--------|
| **절연체** | Eg > 5 eV | 전자 여기에 매우 큰 에너지 필요 | 극히 낮음 |
| **반도체** | 1 eV < Eg < 3 eV | 적절한 에너지로 전도성 제어 가능 | 중간 |
| **도체** | Eg ≈ 0 eV | 콘덕션 밴드와 발렌스 밴드 중첩 | 매우 높음 |

**[근거 ID: 16:28~20:08 | 중요도: 핵심]**

---

## 3. 반도체 재료 분류 체계

### 3.1 원소 반도체 vs 화합물 반도체

<svg width="100%" height="320" viewBox="0 0 900 320" xmlns="http://www.w3.org/2000/svg">
  <!-- 배경 -->
  <rect width="900" height="320" fill="#0a1428"/>
  
  <!-- 제목 -->
  <text x="450" y="30" font-size="18" font-weight="bold" fill="#e0e0e0" text-anchor="middle">
    반도체 재료 분류
  </text>
  
  <!-- 원소 반도체 (Elemental) -->
  <g>
    <rect x="50" y="60" width="350" height="240" fill="#1a237e" stroke="#3949ab" stroke-width="2" rx="6"/>
    <text x="225" y="85" font-size="14" font-weight="bold" fill="#64b5f6" text-anchor="middle">
      원소 반도체 (Group 4)
    </text>
    
    <!-- Si -->
    <rect x="70" y="105" width="310" height="50" fill="#1e3a8a" stroke="#2563eb" stroke-width="1" rx="3"/>
    <text x="80" y="125" font-size="12" font-weight="bold" fill="#60a5fa">Si (실리콘)</text>
    <text x="80" y="145" font-size="10" fill="#93c5fd">Eg = 1.1 eV | 원자 밀도: 5×10²² atoms/cm³</text>
    <text x="80" y="160" font-size="10" fill="#93c5fd">✓ 저가, 낮은 누설전류, SiO₂ 형성 가능</text>
    
    <!-- Ge -->
    <rect x="70" y="165" width="310" height="50" fill="#1e3a8a" stroke="#2563eb" stroke-width="1" rx="3"/>
    <text x="80" y="185" font-size="12" font-weight="bold" fill="#60a5fa">Ge (게르마늄)</text>
    <text x="80" y="205" font-size="10" fill="#93c5fd">Eg = 0.67 eV | 첫 트랜지스터 재료</text>
    <text x="80" y="220" font-size="10" fill="#ffa726">✗ 높은 누설전류, 낮은 항복전압</text>
    
    <!-- C -->
    <rect x="70" y="225" width="310" height="50" fill="#1e3a8a" stroke="#2563eb" stroke-width="1" rx="3"/>
    <text x="80" y="245" font-size="12" font-weight="bold" fill="#60a5fa">C (탄소)</text>
    <text x="80" y="265" font-size="10" fill="#93c5fd">Eg = 5.5 eV | 거의 사용 안 함</text>
  </g>
  
  <!-- 화합물 반도체 (Compound) -->
  <g>
    <rect x="500" y="60" width="350" height="240" fill="#1a237e" stroke="#3949ab" stroke-width="2" rx="6"/>
    <text x="675" y="85" font-size="14" font-weight="bold" fill="#64b5f6" text-anchor="middle">
      화합물 반도체
    </text>
    
    <!-- III-V -->
    <rect x="520" y="105" width="310" height="50" fill="#1e3a8a" stroke="#2563eb" stroke-width="1" rx="3"/>
    <text x="530" y="125" font-size="12" font-weight="bold" fill="#60a5fa">III-V 족</text>
    <text x="530" y="145" font-size="10" fill="#93c5fd">GaAs, InP | 고속 소자, 광전자</text>
    <text x="530" y="160" font-size="10" fill="#93c5fd">SpaceX 위성 태양전지 사용</text>
    
    <!-- IV-IV -->
    <rect x="520" y="165" width="310" height="50" fill="#1e3a8a" stroke="#2563eb" stroke-width="1" rx="3"/>
    <text x="530" y="185" font-size="12" font-weight="bold" fill="#60a5fa">IV-IV 족</text>
    <text x="530" y="205" font-size="10" fill="#93c5fd">SiGe, SiC | 고온 고전력 소자</text>
    <text x="530" y="220" font-size="10" fill="#93c5fd">SiC: 항복전압 매우 높음</text>
    
    <!-- II-VI, IV-VI -->
    <rect x="520" y="225" width="310" height="50" fill="#1e3a8a" stroke="#2563eb" stroke-width="1" rx="3"/>
    <text x="530" y="245" font-size="12" font-weight="bold" fill="#60a5fa">II-VI, IV-VI 족</text>
    <text x="530" y="265" font-size="10" fill="#93c5fd">CdTe, PbS | 특수 응용 (매우 작은 Eg)</text>
  </g>
</svg>

**[근거 ID: 27:19~32:28 | 중요도: 핵심]**

### 3.2 실리콘이 선호되는 이유

| 순위 | 이유 | 상세 설명 |
|------|------|----------|
| **1** | 저가 | 모래(SiO₂)에서 추출 가능 |
| **2** | 낮은 누설전류 | Ge(0.67 eV)보다 큰 Eg(1.1 eV) → 전류 제어 용이 |
| **3** | 높은 신뢰성 | 고온/고압에서 결정 구조 유지 |
| **4** | 높은 항복전압 | 전기적 파괴에 강함 |
| **5** | SiO₂ 형성 | 절연층 자연 형성 → 트랜지스터 제조 가능 |

**[근거 ID: 33:48~40:00 | 중요도: 핵심]**

---

## 4. 반도체 결정 구조

### 4.1 세 가지 구조 유형

<svg width="100%" height="300" viewBox="0 0 900 300" xmlns="http://www.w3.org/2000/svg">
  <!-- 배경 -->
  <rect width="900" height="300" fill="#0a1428"/>
  
  <!-- 제목 -->
  <text x="450" y="30" font-size="18" font-weight="bold" fill="#e0e0e0" text-anchor="middle">
    반도체 결정 구조 비교
  </text>
  
  <!-- 결정질 (Crystalline) -->
  <g>
    <text x="150" y="70" font-size="13" font-weight="bold" fill="#64b5f6" text-anchor="middle">
      결정질 (Crystalline)
    </text>
    
    <!-- 규칙적 격자 -->
    <g stroke="#4fc3f7" stroke-width="2" fill="none">
      <!-- 행 1 -->
      <circle cx="80" cy="100" r="6" fill="#81c784"/>
      <circle cx="120" cy="100" r="6" fill="#81c784"/>
      <circle cx="160" cy="100" r="6" fill="#81c784"/>
      <circle cx="200" cy="100" r="6" fill="#81c784"/>
      <line x1="80" y1="100" x2="200" y2="100"/>
      
      <!-- 행 2 -->
      <circle cx="80" cy="140" r="6" fill="#81c784"/>
      <circle cx="120" cy="140" r="6" fill="#81c784"/>
      <circle cx="160" cy="140" r="6" fill="#81c784"/>
      <circle cx="200" cy="140" r="6" fill="#81c784"/>
      <line x1="80" y1="140" x2="200" y2="140"/>
      
      <!-- 행 3 -->
      <circle cx="80" cy="180" r="6" fill="#81c784"/>
      <circle cx="120" cy="180" r="6" fill="#81c784"/>
      <circle cx="160" cy="180" r="6" fill="#81c784"/>
      <circle cx="200" cy="180" r="6" fill="#81c784"/>
      <line x1="80" y1="180" x2="200" y2="180"/>
      
      <!-- 수직선 -->
      <line x1="80" y1="100" x2="80" y2="180"/>
      <line x1="120" y1="100" x2="120" y2="180"/>
      <line x1="160" y1="100" x2="160" y2="180"/>
      <line x1="200" y1="100" x2="200" y2="180"/>
    </g>
    
    <text x="150" y="220" font-size="10" fill="#90caf9" text-anchor="middle">
      원자 완벽 배열
    </text>
    <text x="150" y="235" font-size="10" fill="#90caf9" text-anchor="middle">
      IC 제조 필수
    </text>
  </g>
  
  <!-- 다결정질 (Polycrystalline) -->
  <g>
    <text x="450" y="70" font-size="13" font-weight="bold" fill="#64b5f6" text-anchor="middle">
      다결정질 (Polycrystalline)
    </text>
    
    <!-- 여러 결정립 -->
    <!-- 결정립 1 -->
    <g stroke="#ffa726" stroke-width="2" fill="none">
      <circle cx="380" cy="100" r="5" fill="#81c784"/>
      <circle cx="410" cy="100" r="5" fill="#81c784"/>
      <circle cx="380" cy="130" r="5" fill="#81c784"/>
      <circle cx="410" cy="130" r="5" fill="#81c784"/>
      <line x1="380" y1="100" x2="410" y2="100"/>
      <line x1="380" y1="130" x2="410" y2="130"/>
      <line x1="380" y1="100" x2="380" y2="130"/>
      <line x1="410" y1="100" x2="410" y2="130"/>
    </g>
    
    <!-- 결정립 2 -->
    <g stroke="#ffa726" stroke-width="2" fill="none">
      <circle cx="440" cy="100" r="5" fill="#81c784"/>
      <circle cx="470" cy="115" r="5" fill="#81c784"/>
      <circle cx="440" cy="130" r="5" fill="#81c784"/>
      <circle cx="470" cy="145" r="5" fill="#81c784"/>
      <line x1="440" y1="100" x2="470" y2="115"/>
      <line x1="440" y1="130" x2="470" y2="145"/>
      <line x1="440" y1="100" x2="440" y2="130"/>
      <line x1="470" y1="115" x2="470" y2="145"/>
    </g>
    
    <!-- 결정립 3 -->
    <g stroke="#ffa726" stroke-width="2" fill="none">
      <circle cx="380" cy="160" r="5" fill="#81c784"/>
      <circle cx="410" cy="160" r="5" fill="#81c784"/>
      <circle cx="380" cy="190" r="5" fill="#81c784"/>
      <circle cx="410" cy="190" r="5" fill="#81c784"/>
      <line x1="380" y1="160" x2="410" y2="160"/>
      <line x1="380" y1="190" x2="410" y2="190"/>
      <line x1="380" y1="160" x2="380" y2="190"/>
      <line x1="410" y1="160" x2="410" y2="190"/>
    </g>
    
    <!-- 결정립계 표시 -->
    <line x1="425" y1="95" x2="425" y2="195" stroke="#ff6b6b" stroke-width="3" stroke-dasharray="3,3"/>
    <text x="430" y="145" font-size="9" fill="#ff6b6b" font-weight="bold">GB</text>
    
    <text x="450" y="220" font-size="10" fill="#90caf9" text-anchor="middle">
      여러 결정립 + 결정립계
    </text>
    <text x="450" y="235" font-size="10" fill="#90caf9" text-anchor="middle">
      (Grain Boundary)
    </text>
  </g>
  
  <!-- 비정질 (Amorphous) -->
  <g>
    <text x="750" y="70" font-size="13" font-weight="bold" fill="#64b5f6" text-anchor="middle">
      비정질 (Amorphous)
    </text>
    
    <!-- 무작위 배열 -->
    <g fill="#81c784" stroke="none">
      <circle cx="700" cy="100" r="5"/>
      <circle cx="750" cy="110" r="5"/>
      <circle cx="780" cy="95" r="5"/>
      <circle cx="720" cy="140" r="5"/>
      <circle cx="760" cy="155" r="5"/>
      <circle cx="800" cy="130" r="5"/>
      <circle cx="710" cy="180" r="5"/>
      <circle cx="770" cy="190" r="5"/>
      <circle cx="740" cy="165" r="5"/>
    </g>
    
    <text x="750" y="220" font-size="10" fill="#90caf9" text-anchor="middle">
      원자 무작위 배열
    </text>
    <text x="750" y="235" font-size="10" fill="#90caf9" text-anchor="middle">
      전자 거동 예측 불가
    </text>
  </g>
  
  <!-- 범례 -->
  <rect x="50" y="260" width="800" height="30" fill="#1a237e" stroke="#3949ab" stroke-width="1" rx="3"/>
  <text x="60" y="280" font-size="10" fill="#e0e0e0">
    GB (Grain Boundary): 인접한 두 결정립 사이의 경계 | IC 제조에는 결정질 필수 (원자 배열 규칙성 → 전자 거동 예측 가능)
  </text>
</svg>

**[근거 ID: 20:28~26:28 | 중요도: 핵심]**

| 구조 | 원자 배열 | 특징 | IC 사용 |
|------|----------|------|--------|
| **결정질** | 완벽 규칙 | 전자 거동 예측 가능 | ✓ 필수 |
| **다결정질** | 부분 규칙 + 결정립계 | 중간 특성 | △ 제한적 |
| **비정질** | 무작위 | 전자 거동 예측 불가 | ✗ 불가 |

---

## 5. 실리콘의 원자 구조와 공유결합

### 5.1 실리콘의 전자 배치

**원자번호 14 (Si)의 전자 배치:**
$$1s^2 \, 2s^2 \, 2p^6 \, 3s^2 \, 3p^2$$

**가전자(Valence Electrons):** 최외각 $3s^2 \, 3p^2$ → **4개 전자**

**[근거 ID: 43:48~47:08 | 중요도: 핵심]**

### 5.2 sp³ 하이브리드 오비탈과 공유결합

<svg width="100%" height="340" viewBox="0 0 900 340" xmlns="http://www.w3.org/2000/svg">
  <!-- 배경 -->
  <rect width="900" height="340" fill="#0a1428"/>
  
  <!-- 제목 -->
  <text x="450" y="30" font-size="18" font-weight="bold" fill="#e0e0e0" text-anchor="middle">
    실리콘 격자의 sp³ 공유결합 구조
  </text>
  
  <!-- 왼쪽: 에너지 준위 -->
  <g>
    <text x="100" y="70" font-size="12" font-weight="bold" fill="#64b5f6">에너지 준위</text>
    
    <!-- 1s² -->
    <rect x="30" y="90" width="140" height="15" fill="#4fc3f7" stroke="#29b6f6" stroke-width="1"/>
    <text x="100" y="103" font-size="10" fill="#fff" text-anchor="middle">1s² (핵 근처)</text>
    <text x="220" y="103" font-size="9" fill="#ffd54f">에너지 매우 낮음</text>
    
    <!-- 2s² 2p⁶ -->
    <rect x="30" y="115" width="140" height="15" fill="#4fc3f7" stroke="#29b6f6" stroke-width="1"/>
    <text x="100" y="128" font-size="10" fill="#fff" text-anchor="middle">2s² 2p⁶</text>
    <text x="220" y="128" font-size="9" fill="#ffd54f">에너지 낮음</text>
    
    <!-- 3s² 3p² (sp³ hybrid) -->
    <rect x="30" y="155" width="140" height="25" fill="#81c784" stroke="#66bb6a" stroke-width="2"/>
    <text x="100" y="168" font-size="10" fill="#fff" text-anchor="middle" font-weight="bold">3s² 3p²</text>
    <text x="100" y="180" font-size="9" fill="#fff" text-anchor="middle">(sp³ hybrid)</text>
    <text x="220" y="170" font-size="9" fill="#ffd54f">에너지 높음</text>
    <text x="220" y="185" font-size="9" fill="#ffd54f">→ 느슨하게 결합</text>
    
    <!-- 에너지 차이 표시 -->
    <line x1="15" y1="90" x2="15" y2="180" stroke="#ffd54f" stroke-width="2"/>
    <line x1="10" y1="90" x2="20" y2="90" stroke="#ffd54f" stroke-width="2"/>
    <line x1="10" y1="180" x2="20" y2="180" stroke="#ffd54f" stroke-width="2"/>
    <text x="5" y="140" font-size="9" fill="#ffd54f" text-anchor="end">큰 차이</text>
  </g>
  
  <!-- 오른쪽: 실리콘 격자 구조 -->
  <g>
    <text x="550" y="70" font-size="12" font-weight="bold" fill="#64b5f6">Si 격자 구조 (2D 표현)</text>
    
    <!-- 중앙 Si 원자 -->
    <circle cx="550" cy="150" r="12" fill="#ff6b6b" stroke="#ff8787" stroke-width="2"/>
    <text x="550" y="156" font-size="11" fill="#fff" text-anchor="middle" font-weight="bold">Si</text>
    
    <!-- 인접한 4개 Si 원자 -->
    <circle cx="480" cy="150" r="10" fill="#4fc3f7" stroke="#29b6f6" stroke-width="1"/>
    <circle cx="620" cy="150" r="10" fill="#4fc3f7" stroke="#29b6f6" stroke-width="1"/>
    <circle cx="550" cy="80" r="10" fill="#4fc3f7" stroke="#29b6f6" stroke-width="1"/>
    <circle cx="550" cy="220" r="10" fill="#4fc3f7" stroke="#29b6f6" stroke-width="1"/>
    
    <!-- 공유결합 (전자쌍) -->
    <line x1="520" y1="150" x2="540" y2="150" stroke="#81c784" stroke-width="3"/>
    <circle cx="530" cy="150" r="3" fill="#81c784"/>
    <text x="530" y="165" font-size="8" fill="#81c784" text-anchor="middle">e⁻ 쌍</text>
    
    <line x1="560" y1="150" x2="610" y2="150" stroke="#81c784" stroke-width="3"/>
    <circle cx="585" cy="150" r="3" fill="#81c784"/>
    
    <line x