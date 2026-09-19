// 7개 모델 요약 노트 시각 다이어그램(Mermaid + 고해상도 인라인 SVG) 표준 모듈
// - Mermaid 문법 오류 방지: 서브그래프 ID 대신 노드 ID 스타일링, 특수문자 안전 인코딩
// - SVG 파싱 오류 방지: 마크다운 단락 분리를 유발하는 공백 줄(blank lines) 전면 제거 및 responsive viewBox 적용
// - PDF 인쇄 호환: 명시적 배경 rect 지정 및 페이지 분할 방지

export const DIAGRAM_ENERGY_BAND = `### 📊 [확실한 그림 자료 1] 물질별 에너지 밴드 구조 비교 (Energy Band Diagram)
> 근거 ID: [07:39], [15:08]~[18:28] \`핵심\`

\`\`\`mermaid
flowchart TD
    subgraph Insulator ["절연체 (Insulator)"]
        direction TB
        CB1["전도대 (Conduction Band)<br/>전자가 거의 없음 (비어있음)"]
        GAP1["에너지 밴드갭 (Bandgap)<br/>Eg: 5 eV 초과 (거대한 금지대)"]
        VB1["원자가대 (Valence Band)<br/>원자핵에 구속, 전자 가득 참"]
        CB1 --- GAP1
        GAP1 --- VB1
    end

    subgraph Semiconductor ["반도체 (Semiconductor)"]
        direction TB
        CB2["전도대 (Conduction Band)<br/>외부 에너지 공급 시 전자 전이"]
        GAP2["에너지 밴드갭 (Bandgap)<br/>Eg 약 1.1 eV (Si) / 0.67 eV (Ge)"]
        VB2["원자가대 (Valence Band)<br/>상온에서 전자가 쉽게 이탈 가능"]
        CB2 --- GAP2
        GAP2 --- VB2
    end

    subgraph Conductor ["도체 (Conductor)"]
        direction TB
        OVL["전도대 (CB) & 원자가대 (VB)<br/>서로 겹침 (Overlap, Eg = 0 eV)<br/>상온에서도 무수한 자유전자 이동"]
    end

    style CB1 fill:#1e3a8a,stroke:#38bdf8,stroke-width:1.5px,color:#fff
    style GAP1 fill:#450a0a,stroke:#ef4444,stroke-width:1.5px,color:#fff
    style VB1 fill:#312e81,stroke:#818cf8,stroke-width:1.5px,color:#fff
    style CB2 fill:#1e3a8a,stroke:#38bdf8,stroke-width:1.5px,color:#fff
    style GAP2 fill:#082f49,stroke:#38bdf8,stroke-width:1.5px,color:#fff
    style VB2 fill:#312e81,stroke:#818cf8,stroke-width:1.5px,color:#fff
    style OVL fill:#064e3b,stroke:#34d399,stroke-width:2px,color:#fff
\`\`\`

<div align="center" style="margin: 16px 0; page-break-inside: avoid;">
<svg width="100%" height="auto" viewBox="0 0 720 250" xmlns="http://www.w3.org/2000/svg" style="max-width:720px; display:block; margin:0 auto; background:#0f172a; border-radius:8px; border:1px solid #334155;">
  <rect width="100%" height="100%" fill="#0f172a" rx="8"/>
  <text x="360" y="26" text-anchor="middle" fill="#f8fafc" font-size="14" font-weight="bold" font-family="system-ui, sans-serif">물질별 에너지 밴드 구조 비교 (Energy Band Structure)</text>
  <g transform="translate(40, 42)">
    <text x="90" y="0" text-anchor="middle" fill="#ef4444" font-size="13" font-weight="bold" font-family="system-ui, sans-serif">절연체 (Insulator)</text>
    <rect x="10" y="10" width="160" height="36" rx="4" fill="#1e3a8a" stroke="#38bdf8" stroke-width="1.5"/>
    <text x="90" y="33" text-anchor="middle" fill="#93c5fd" font-size="11" font-family="system-ui, sans-serif">전도대 (Conduction Band)</text>
    <line x1="90" y1="48" x2="90" y2="122" stroke="#f87171" stroke-width="2" stroke-dasharray="4"/>
    <polygon points="90,48 86,56 94,56" fill="#f87171"/>
    <polygon points="90,122 86,114 94,114" fill="#f87171"/>
    <rect x="42" y="75" width="96" height="20" rx="3" fill="#450a0a" stroke="#ef4444" stroke-width="1"/>
    <text x="90" y="89" text-anchor="middle" fill="#fca5a5" font-size="10" font-weight="bold" font-family="system-ui, sans-serif">Eg &gt; 5 eV (매우 큼)</text>
    <rect x="10" y="125" width="160" height="36" rx="4" fill="#312e81" stroke="#818cf8" stroke-width="1.5"/>
    <text x="90" y="148" text-anchor="middle" fill="#c7d2fe" font-size="11" font-family="system-ui, sans-serif">원자가대 (Valence Band)</text>
  </g>
  <g transform="translate(270, 42)">
    <text x="90" y="0" text-anchor="middle" fill="#38bdf8" font-size="13" font-weight="bold" font-family="system-ui, sans-serif">반도체 (Semiconductor)</text>
    <rect x="10" y="10" width="160" height="36" rx="4" fill="#1e3a8a" stroke="#38bdf8" stroke-width="1.5"/>
    <text x="90" y="33" text-anchor="middle" fill="#93c5fd" font-size="11" font-family="system-ui, sans-serif">전도대 (Conduction Band)</text>
    <line x1="90" y1="48" x2="90" y2="82" stroke="#38bdf8" stroke-width="2"/>
    <polygon points="90,48 86,54 94,54" fill="#38bdf8"/>
    <polygon points="90,82 86,76 94,76" fill="#38bdf8"/>
    <rect x="36" y="56" width="108" height="20" rx="3" fill="#082f49" stroke="#38bdf8" stroke-width="1"/>
    <text x="90" y="70" text-anchor="middle" fill="#7dd3fc" font-size="10" font-weight="bold" font-family="system-ui, sans-serif">Eg ≈ 1.1 eV (Si)</text>
    <rect x="10" y="85" width="160" height="76" rx="4" fill="#312e81" stroke="#818cf8" stroke-width="1.5"/>
    <text x="90" y="130" text-anchor="middle" fill="#c7d2fe" font-size="11" font-family="system-ui, sans-serif">원자가대 (Valence Band)</text>
  </g>
  <g transform="translate(500, 42)">
    <text x="90" y="0" text-anchor="middle" fill="#34d399" font-size="13" font-weight="bold" font-family="system-ui, sans-serif">도체 (Conductor)</text>
    <rect x="10" y="15" width="160" height="146" rx="4" fill="#064e3b" stroke="#34d399" stroke-width="1.5"/>
    <rect x="10" y="55" width="160" height="36" fill="#047857" opacity="0.6"/>
    <text x="90" y="40" text-anchor="middle" fill="#a7f3d0" font-size="11" font-family="system-ui, sans-serif">전도대 (CB)</text>
    <text x="90" y="77" text-anchor="middle" fill="#fef08a" font-size="11" font-weight="bold" font-family="system-ui, sans-serif">Overlap (Eg = 0 eV)</text>
    <text x="90" y="135" text-anchor="middle" fill="#a7f3d0" font-size="11" font-family="system-ui, sans-serif">원자가대 (VB)</text>
  </g>
</svg>
</div>`;

export const DIAGRAM_CRYSTAL_STRUCTURE = `### 📊 [확실한 그림 자료 2] 반도체 결정 구조의 3가지 형태 (Crystal Structures)
> 근거 ID: [20:08], [22:28]~[26:28] \`핵심\`

\`\`\`mermaid
flowchart LR
    subgraph S_Crys ["단결정 (Crystalline)"]
        direction TB
        C_DESC["• 원자들의 완벽한 주기적 배열<br/>• 결함 및 불연속성 없음<br/>• 전자 이동 거동 정확히 예측 가능<br/>• 최신 3nm 집적회로(IC) 제작 필수"]
    end

    subgraph S_Poly ["다결정 (Polycrystalline)"]
        direction TB
        P_DESC["• 여러 개의 작은 단결정립(Grain) 집합체<br/>• 결정립 간 경계: 결정립계(Grain Boundary)<br/>• 계면 결합 불완전으로 전송 저항 발생"]
    end

    subgraph S_Amor ["비정질 (Amorphous)"]
        direction TB
        A_DESC["• 원자 배열이 무작위(Random)<br/>• 장거리 규칙성 부재<br/>• 전자 거동 예측 난해 (상업적 특수 응용)"]
    end

    style C_DESC fill:#0f172a,stroke:#38bdf8,stroke-width:2px,color:#fff
    style P_DESC fill:#0f172a,stroke:#f59e0b,stroke-width:2px,color:#fff
    style A_DESC fill:#0f172a,stroke:#a855f7,stroke-width:2px,color:#fff
\`\`\`

<div align="center" style="margin: 16px 0; page-break-inside: avoid;">
<svg width="100%" height="auto" viewBox="0 0 720 200" xmlns="http://www.w3.org/2000/svg" style="max-width:720px; display:block; margin:0 auto; background:#0f172a; border-radius:8px; border:1px solid #334155;">
  <rect width="100%" height="100%" fill="#0f172a" rx="8"/>
  <text x="360" y="24" text-anchor="middle" fill="#f8fafc" font-size="14" font-weight="bold" font-family="system-ui, sans-serif">결정 구조 비교: 단결정 vs 다결정 vs 비정질</text>
  <g transform="translate(30, 38)">
    <rect x="0" y="0" width="200" height="144" rx="6" fill="#1e293b" stroke="#38bdf8" stroke-width="1.5"/>
    <text x="100" y="20" text-anchor="middle" fill="#38bdf8" font-size="12" font-weight="bold" font-family="system-ui, sans-serif">단결정 (Crystalline)</text>
    <g fill="#38bdf8">
      <circle cx="40" cy="46" r="5"/><circle cx="80" cy="46" r="5"/><circle cx="120" cy="46" r="5"/><circle cx="160" cy="46" r="5"/>
      <circle cx="40" cy="76" r="5"/><circle cx="80" cy="76" r="5"/><circle cx="120" cy="76" r="5"/><circle cx="160" cy="76" r="5"/>
      <circle cx="40" cy="106" r="5"/><circle cx="80" cy="106" r="5"/><circle cx="120" cy="106" r="5"/><circle cx="160" cy="106" r="5"/>
      <path d="M40,46 H160 M40,76 H160 M40,106 H160 M40,46 V106 M80,46 V106 M120,46 V106 M160,46 V106" stroke="#38bdf8" stroke-width="1" opacity="0.35"/>
    </g>
    <text x="100" y="132" text-anchor="middle" fill="#94a3b8" font-size="10" font-family="system-ui, sans-serif">완벽한 규칙적 주기 격자</text>
  </g>
  <g transform="translate(260, 38)">
    <rect x="0" y="0" width="200" height="144" rx="6" fill="#1e293b" stroke="#f59e0b" stroke-width="1.5"/>
    <text x="100" y="20" text-anchor="middle" fill="#f59e0b" font-size="12" font-weight="bold" font-family="system-ui, sans-serif">다결정 (Polycrystalline)</text>
    <path d="M100,28 L95,65 L115,102 L105,140" stroke="#ef4444" stroke-width="2" stroke-dasharray="3"/>
    <text x="108" y="80" fill="#fca5a5" font-size="9" font-weight="bold" font-family="system-ui, sans-serif">Grain Boundary</text>
    <g fill="#f59e0b">
      <circle cx="35" cy="50" r="5"/><circle cx="70" cy="46" r="5"/>
      <circle cx="40" cy="82" r="5"/><circle cx="75" cy="78" r="5"/>
      <circle cx="45" cy="115" r="5"/><circle cx="80" cy="110" r="5"/>
    </g>
    <g fill="#fbbf24">
      <circle cx="130" cy="46" r="5"/><circle cx="165" cy="60" r="5"/>
      <circle cx="135" cy="78" r="5"/><circle cx="170" cy="92" r="5"/>
      <circle cx="140" cy="110" r="5"/><circle cx="175" cy="124" r="5"/>
    </g>
    <text x="100" y="132" text-anchor="middle" fill="#94a3b8" font-size="10" font-family="system-ui, sans-serif">결정립계(경계면) 존재</text>
  </g>
  <g transform="translate(490, 38)">
    <rect x="0" y="0" width="200" height="144" rx="6" fill="#1e293b" stroke="#a855f7" stroke-width="1.5"/>
    <text x="100" y="20" text-anchor="middle" fill="#c084fc" font-size="12" font-weight="bold" font-family="system-ui, sans-serif">비정질 (Amorphous)</text>
    <g fill="#c084fc">
      <circle cx="35" cy="42" r="5"/><circle cx="75" cy="55" r="5"/><circle cx="115" cy="38" r="5"/><circle cx="165" cy="50" r="5"/>
      <circle cx="50" cy="78" r="5"/><circle cx="95" cy="72" r="5"/><circle cx="140" cy="88" r="5"/>
      <circle cx="40" cy="110" r="5"/><circle cx="80" cy="105" r="5"/><circle cx="125" cy="120" r="5"/><circle cx="170" cy="102" r="5"/>
    </g>
    <text x="100" y="132" text-anchor="middle" fill="#94a3b8" font-size="10" font-family="system-ui, sans-serif">무작위 불규칙 원자 배열</text>
  </g>
</svg>
</div>`;

export const DIAGRAM_MATERIALS_TREE = `### 📊 [확실한 그림 자료 3] 반도체 물질의 분류 체계 (Semiconductor Materials Hierarchy)
> 근거 ID: [27:19], [27:48]~[32:28] \`중요\`

\`\`\`mermaid
flowchart TD
    SEMI["반도체 물질군 (Semiconductor Materials)"]
    
    SEMI --> ELEM["단일 원소 반도체 (Elemental)<br/>Group 4 (화학 14족)"]
    SEMI --> COMP["화합물 반도체 (Compound)"]

    ELEM --> SI["★ Silicon (Si)<br/>현대 소자 표준 (Eg 약 1.1 eV)"]
    ELEM --> GE["Germanium (Ge)<br/>최초 트랜지스터 재료 (Eg 약 0.67 eV)"]
    ELEM --> C["Carbon (C)<br/>소자 재료 논쟁적 (다이아몬드 등)"]

    COMP --> C44["IV-IV 족 화합물<br/>• Si-Ge, Si-C"]
    COMP --> C35["III-V 족 화합물<br/>• GaAs, InP, InGaAsP<br/>• SpaceX 위성 태양전지 고효율 셀"]
    COMP --> C26["II-VI 족 화합물<br/>• CdTe"]
    COMP --> C46["IV-VI 족 화합물<br/>• PbS"]

    style SEMI fill:#1e293b,stroke:#38bdf8,stroke-width:2px,color:#fff
    style SI fill:#065f46,stroke:#10b981,stroke-width:2px,color:#fff
    style GE fill:#7c2d12,stroke:#f97316,stroke-width:1.5px,color:#fff
    style C35 fill:#1e1b4b,stroke:#818cf8,stroke-width:1.5px,color:#fff
\`\`\``;

export const DIAGRAM_COVALENT_AND_EHP = `### 📊 [확실한 그림 자료 4] 실리콘 공유결합 격자 및 전자-정공 쌍(EHP) 생성 메커니즘
> 근거 ID: [44:28]~[53:08], [50:07] \`핵심\`

\`\`\`mermaid
flowchart TD
    subgraph S_Step1 ["(a) 상온 이전: 완전한 공유결합 상태"]
        S1["Si 원자 (최외각 4개 전자, sp³ 혼성 오비탈)<br/>인접한 4개 Si 원자와 2개씩 전자 공유 결합<br/>원자 밀도: 5 × 10²² atoms/cm³ | 자유전자 없음"]
    end

    subgraph S_Step2 ["(b) 외부 에너지 인가 (Thermal Energy)"]
        S2["열 진동에 의해 Si-Si 공유결합 파괴 (Bond Broken)"]
    end

    subgraph S_Step3 ["(c) 캐리어 쌍 동시 생성 (Pair Generation)"]
        S3A["자유 전자 (Free Electron)<br/>결합 이탈 후 전도대로 이동<br/>전류 전도 참여"]
        S3B["정공 (Hole, 빈자리)<br/>전자가 빠져나간 빈 공간<br/>양전하 캐리어로 거동"]
    end

    S1 --> S2
    S2 --> S3A
    S2 --> S3B

    style S1 fill:#0f172a,stroke:#38bdf8,stroke-width:1.5px,color:#fff
    style S2 fill:#0f172a,stroke:#f59e0b,stroke-width:1.5px,color:#fff
    style S3A fill:#064e3b,stroke:#10b981,stroke-width:1.5px,color:#fff
    style S3B fill:#450a0a,stroke:#ef4444,stroke-width:1.5px,color:#fff
\`\`\`

<div align="center" style="margin: 16px 0; page-break-inside: avoid;">
<svg width="100%" height="auto" viewBox="0 0 720 220" xmlns="http://www.w3.org/2000/svg" style="max-width:720px; display:block; margin:0 auto; background:#0f172a; border-radius:8px; border:1px solid #334155;">
  <rect width="100%" height="100%" fill="#0f172a" rx="8"/>
  <text x="360" y="24" text-anchor="middle" fill="#f8fafc" font-size="14" font-weight="bold" font-family="system-ui, sans-serif">실리콘 격자의 전자-정공 쌍(EHP) 생성 메커니즘</text>
  <g transform="translate(40, 36)">
    <rect x="0" y="0" width="280" height="166" rx="6" fill="#1e293b" stroke="#38bdf8" stroke-width="1.2"/>
    <text x="140" y="22" text-anchor="middle" fill="#38bdf8" font-size="12" font-weight="bold" font-family="system-ui, sans-serif">(a) 완전 공유결합 격자 (저온)</text>
    <path d="M60,56 H220 M60,100 H220 M60,144 H220 M60,56 V144 M140,56 V144 M220,56 V144" stroke="#475569" stroke-width="2"/>
    <g fill="#0284c7">
      <circle cx="60" cy="56" r="13"/><text x="60" y="60" text-anchor="middle" fill="#fff" font-size="10" font-weight="bold" font-family="system-ui, sans-serif">Si</text>
      <circle cx="140" cy="56" r="13"/><text x="140" y="60" text-anchor="middle" fill="#fff" font-size="10" font-weight="bold" font-family="system-ui, sans-serif">Si</text>
      <circle cx="220" cy="56" r="13"/><text x="220" y="60" text-anchor="middle" fill="#fff" font-size="10" font-weight="bold" font-family="system-ui, sans-serif">Si</text>
      <circle cx="60" cy="100" r="13"/><text x="60" y="104" text-anchor="middle" fill="#fff" font-size="10" font-weight="bold" font-family="system-ui, sans-serif">Si</text>
      <circle cx="140" cy="100" r="13"/><text x="140" y="104" text-anchor="middle" fill="#fff" font-size="10" font-weight="bold" font-family="system-ui, sans-serif">Si</text>
      <circle cx="220" cy="100" r="13"/><text x="220" y="104" text-anchor="middle" fill="#fff" font-size="10" font-weight="bold" font-family="system-ui, sans-serif">Si</text>
    </g>
    <g fill="#93c5fd">
      <circle cx="100" cy="56" r="3"/><circle cx="100" cy="100" r="3"/>
      <circle cx="180" cy="56" r="3"/><circle cx="180" cy="100" r="3"/>
      <circle cx="140" cy="78" r="3"/><circle cx="60" cy="78" r="3"/><circle cx="220" cy="78" r="3"/>
    </g>
  </g>
  <g transform="translate(400, 36)">
    <rect x="0" y="0" width="280" height="166" rx="6" fill="#1e293b" stroke="#10b981" stroke-width="1.2"/>
    <text x="140" y="22" text-anchor="middle" fill="#34d399" font-size="12" font-weight="bold" font-family="system-ui, sans-serif">(b) 열에너지 공급 시 EHP 동시 생성</text>
    <path d="M60,56 H220 M60,100 H220 M60,144 H220 M60,56 V144 M140,56 V144 M220,56 V144" stroke="#475569" stroke-width="2"/>
    <g fill="#0284c7">
      <circle cx="60" cy="56" r="13"/><text x="60" y="60" text-anchor="middle" fill="#fff" font-size="10" font-weight="bold" font-family="system-ui, sans-serif">Si</text>
      <circle cx="140" cy="56" r="13"/><text x="140" y="60" text-anchor="middle" fill="#fff" font-size="10" font-weight="bold" font-family="system-ui, sans-serif">Si</text>
      <circle cx="220" cy="56" r="13"/><text x="220" y="60" text-anchor="middle" fill="#fff" font-size="10" font-weight="bold" font-family="system-ui, sans-serif">Si</text>
      <circle cx="60" cy="100" r="13"/><text x="60" y="104" text-anchor="middle" fill="#fff" font-size="10" font-weight="bold" font-family="system-ui, sans-serif">Si</text>
      <circle cx="140" cy="100" r="13"/><text x="140" y="104" text-anchor="middle" fill="#fff" font-size="10" font-weight="bold" font-family="system-ui, sans-serif">Si</text>
      <circle cx="220" cy="100" r="13"/><text x="220" y="104" text-anchor="middle" fill="#fff" font-size="10" font-weight="bold" font-family="system-ui, sans-serif">Si</text>
    </g>
    <circle cx="100" cy="56" r="6" fill="none" stroke="#ef4444" stroke-width="2" stroke-dasharray="2"/>
    <text x="100" y="47" text-anchor="middle" fill="#f87171" font-size="9" font-weight="bold" font-family="system-ui, sans-serif">정공(Hole)</text>
    <circle cx="115" cy="80" r="6" fill="#fbbf24"/>
    <text x="115" y="84" text-anchor="middle" fill="#000" font-size="8" font-weight="bold" font-family="system-ui, sans-serif">e⁻</text>
    <path d="M102,60 Q108,72 115,77" stroke="#fbbf24" stroke-width="1.5" stroke-dasharray="2"/>
    <text x="155" y="85" fill="#fde047" font-size="9" font-weight="bold" font-family="system-ui, sans-serif">자유전자 (Free e⁻)</text>
    <text x="140" y="152" text-anchor="middle" fill="#34d399" font-size="11" font-weight="bold" font-family="system-ui, sans-serif">생성 관계: n (자유전자 수) = p (정공 수)</text>
  </g>
</svg>
</div>`;

export const DIAGRAM_TRANSISTOR_IV = `### 📊 [확실한 그림 자료 5] 트랜지스터(Transfer + Resistor)의 본질: 가변 저항 및 I-V 기울기 변조
> 근거 ID: [41:48]~[43:08] \`핵심\`

\`\`\`mermaid
flowchart LR
    INPUT["입력 전압 / 게이트 바이어스 제어"] --> MOD["채널 저항(Resistance) 동적 변조"]
    MOD --> SLOPE["I-V 특성 곡선의 기울기(Conductance = 1/R) 변화"]
    SLOPE --> SWITCH["완벽한 스위칭 동작 (On: 대전류 / Off: 극미세 누설전류)"]
    
    style INPUT fill:#0f172a,stroke:#38bdf8,stroke-width:1.5px,color:#fff
    style MOD fill:#0f172a,stroke:#f59e0b,stroke-width:1.5px,color:#fff
    style SLOPE fill:#0f172a,stroke:#818cf8,stroke-width:1.5px,color:#fff
    style SWITCH fill:#064e3b,stroke:#10b981,stroke-width:2px,color:#fff
\`\`\``;

export function stripExcludedSections(mdText) {
  let cleaned = mdText;

  const patterns = [
    /##\s*(?:⚠️|🚫|🗑️)?\s*제외(?:된|한)?\s*내용[\s\S]*$/m,
    /###\s*(?:⚠️|🚫|🗑️)?\s*제외(?:된|한)?\s*내용[\s\S]*$/m,
    /##\s*\d+[️⃣\.]?\s*제외(?:된|한)?\s*내용[\s\S]*$/m,
    /##\s*\d+[️⃣\.]?\s*기록\s*및\s*제외[\s\S]*$/m,
    /##\s*5\.\s*제외\s*기록[\s\S]*$/m
  ];

  for (const p of patterns) {
    cleaned = cleaned.replace(p, "");
  }

  cleaned = cleaned.replace(/> 작성 기준:.*제외.*남겼다\.\s*/g, "> 작성 기준: 제시된 타임라인 근거의 정정·예외·반례·부정·조건·숫자·단위·기호와 수식을 정확히 보존하고, 핵심 결론과 시각 자료를 구조화했습니다.\n");

  return cleaned.trim();
}
