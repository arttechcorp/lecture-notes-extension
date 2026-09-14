// 순수 고해상도 벡터 SVG 그래픽 모듈 (Mermaid 코드 블록 완전 배제)
// - 마크다운 파서의 단락 분리 오류를 방지하기 위해 빈 줄(blank lines)이 전혀 없음
// - 반응형 viewBox 및 자체 배경 rect 포함으로 다크/라이트 테마 및 PDF 인쇄 시 100% 무결성 보장

export const SVG_ENERGY_BAND = `<div align="center" style="margin: 16px 0; page-break-inside: avoid;">
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

export const SVG_CRYSTAL_STRUCTURE = `<div align="center" style="margin: 16px 0; page-break-inside: avoid;">
<svg width="100%" height="auto" viewBox="0 0 720 200" xmlns="http://www.w3.org/2000/svg" style="max-width:720px; display:block; margin:0 auto; background:#0f172a; border-radius:8px; border:1px solid #334155;">
  <rect width="100%" height="100%" fill="#0f172a" rx="8"/>
  <text x="360" y="24" text-anchor="middle" fill="#f8fafc" font-size="14" font-weight="bold" font-family="system-ui, sans-serif">반도체 결정 구조 비교 (Crystal Structures)</text>
  <g transform="translate(30, 38)">
    <rect x="0" y="0" width="200" height="144" rx="6" fill="#1e293b" stroke="#38bdf8" stroke-width="1.5"/>
    <text x="100" y="20" text-anchor="middle" fill="#38bdf8" font-size="12" font-weight="bold" font-family="system-ui, sans-serif">단결정 (Crystalline)</text>
    <g fill="#38bdf8">
      <circle cx="40" cy="46" r="5"/><circle cx="80" cy="46" r="5"/><circle cx="120" cy="46" r="5"/><circle cx="160" cy="46" r="5"/>
      <circle cx="40" cy="76" r="5"/><circle cx="80" cy="76" r="5"/><circle cx="120" cy="76" r="5"/><circle cx="160" cy="76" r="5"/>
      <circle cx="40" cy="106" r="5"/><circle cx="80" cy="106" r="5"/><circle cx="120" cy="106" r="5"/><circle cx="160" cy="106" r="5"/>
      <path d="M40,46 H160 M40,76 H160 M40,106 H160 M40,46 V106 M80,46 V106 M120,46 V106 M160,46 V106" stroke="#38bdf8" stroke-width="1" opacity="0.35"/>
    </g>
    <text x="100" y="132" text-anchor="middle" fill="#94a3b8" font-size="10" font-family="system-ui, sans-serif">완벽한 주기적 격자 (IC 칩 필수)</text>
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

export const SVG_MATERIALS_TREE = `<div align="center" style="margin: 16px 0; page-break-inside: avoid;">
<svg width="100%" height="auto" viewBox="0 0 720 220" xmlns="http://www.w3.org/2000/svg" style="max-width:720px; display:block; margin:0 auto; background:#0f172a; border-radius:8px; border:1px solid #334155;">
  <rect width="100%" height="100%" fill="#0f172a" rx="8"/>
  <text x="360" y="24" text-anchor="middle" fill="#f8fafc" font-size="14" font-weight="bold" font-family="system-ui, sans-serif">반도체 물질의 화학 원소 분류 체계 (Periodic Table Classification)</text>
  <rect x="250" y="38" width="220" height="34" rx="5" fill="#1e293b" stroke="#38bdf8" stroke-width="1.5"/>
  <text x="360" y="60" text-anchor="middle" fill="#f8fafc" font-size="12" font-weight="bold" font-family="system-ui, sans-serif">반도체 재료 (Semiconductors)</text>
  <path d="M300,72 L180,105 M420,72 L540,105" stroke="#64748b" stroke-width="1.5"/>
  <g transform="translate(60, 105)">
    <rect x="0" y="0" width="240" height="96" rx="5" fill="#1e293b" stroke="#10b981" stroke-width="1.5"/>
    <text x="120" y="20" text-anchor="middle" fill="#34d399" font-size="12" font-weight="bold" font-family="system-ui, sans-serif">단일 원소 반도체 (Group 4 / 14족)</text>
    <text x="16" y="44" fill="#f8fafc" font-size="11" font-family="system-ui, sans-serif">• <tspan fill="#38bdf8" font-weight="bold">Si (실리콘)</tspan>: 현대 소자 표준 (Eg ≈ 1.1 eV)</text>
    <text x="16" y="66" fill="#f8fafc" font-size="11" font-family="system-ui, sans-serif">• <tspan fill="#fb923c" font-weight="bold">Ge (게르마늄)</tspan>: 최초 트랜지스터 (Eg ≈ 0.67 eV)</text>
    <text x="16" y="86" fill="#94a3b8" font-size="10" font-family="system-ui, sans-serif">• C (탄소): 소자 재료 논쟁적 (다이아몬드 등)</text>
  </g>
  <g transform="translate(420, 105)">
    <rect x="0" y="0" width="240" height="96" rx="5" fill="#1e293b" stroke="#818cf8" stroke-width="1.5"/>
    <text x="120" y="20" text-anchor="middle" fill="#a5b4fc" font-size="12" font-weight="bold" font-family="system-ui, sans-serif">화합물 반도체 (Compound)</text>
    <text x="16" y="44" fill="#f8fafc" font-size="10.5" font-family="system-ui, sans-serif">• <tspan fill="#c084fc" font-weight="bold">III-V족</tspan>: GaAs, InP (SpaceX 위성 태양전지)</text>
    <text x="16" y="66" fill="#f8fafc" font-size="10.5" font-family="system-ui, sans-serif">• <tspan fill="#c084fc">IV-IV족</tspan>: Si-Ge, Si-C</text>
    <text x="16" y="86" fill="#94a3b8" font-size="10" font-family="system-ui, sans-serif">• II-VI족(CdTe), IV-VI족(PbS)</text>
  </g>
</svg>
</div>`;

export const SVG_COVALENT_AND_EHP = `<div align="center" style="margin: 16px 0; page-break-inside: avoid;">
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
    <text x="140" y="152" text-anchor="middle" fill="#94a3b8" font-size="10" font-family="system-ui, sans-serif">최외각 4개 전자(sp³ 혼성) 완전 결합</text>
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

export const SVG_TRANSISTOR_IV = `<div align="center" style="margin: 16px 0; page-break-inside: avoid;">
<svg width="100%" height="auto" viewBox="0 0 720 180" xmlns="http://www.w3.org/2000/svg" style="max-width:720px; display:block; margin:0 auto; background:#0f172a; border-radius:8px; border:1px solid #334155;">
  <rect width="100%" height="100%" fill="#0f172a" rx="8"/>
  <text x="360" y="24" text-anchor="middle" fill="#f8fafc" font-size="14" font-weight="bold" font-family="system-ui, sans-serif">트랜지스터(Transfer + Resistor)의 본질: 가변 저항 및 I-V 기울기 변조</text>
  <g transform="translate(30, 42)">
    <rect x="0" y="0" width="180" height="110" rx="6" fill="#1e293b" stroke="#38bdf8" stroke-width="1.2"/>
    <text x="90" y="25" text-anchor="middle" fill="#38bdf8" font-size="11" font-weight="bold" font-family="system-ui, sans-serif">1. 입력 전압 (Vin)</text>
    <text x="90" y="55" text-anchor="middle" fill="#cbd5e1" font-size="10" font-family="system-ui, sans-serif">게이트/바이어스 전압</text>
    <text x="90" y="75" text-anchor="middle" fill="#cbd5e1" font-size="10" font-family="system-ui, sans-serif">인가에 따른 제어</text>
  </g>
  <path d="M220,97 L250,97" stroke="#38bdf8" stroke-width="2" marker-end="url(#arrow)"/>
  <g transform="translate(260, 42)">
    <rect x="0" y="0" width="190" height="110" rx="6" fill="#1e293b" stroke="#f59e0b" stroke-width="1.2"/>
    <text x="95" y="25" text-anchor="middle" fill="#fbbf24" font-size="11" font-weight="bold" font-family="system-ui, sans-serif">2. 저항 변조 (Modulation)</text>
    <text x="95" y="55" text-anchor="middle" fill="#cbd5e1" font-size="10" font-family="system-ui, sans-serif">채널 내부 저항(R)</text>
    <text x="95" y="75" text-anchor="middle" fill="#cbd5e1" font-size="10" font-family="system-ui, sans-serif">동적 가변 제어</text>
  </g>
  <path d="M460,97 L490,97" stroke="#f59e0b" stroke-width="2"/>
  <g transform="translate(500, 42)">
    <rect x="0" y="0" width="190" height="110" rx="6" fill="#1e293b" stroke="#10b981" stroke-width="1.2"/>
    <text x="95" y="25" text-anchor="middle" fill="#34d399" font-size="11" font-weight="bold" font-family="system-ui, sans-serif">3. I-V 기울기 및 스위칭</text>
    <text x="95" y="55" text-anchor="middle" fill="#cbd5e1" font-size="10" font-family="system-ui, sans-serif">기울기(= 1/R) 변화</text>
    <text x="95" y="75" text-anchor="middle" fill="#a7f3d0" font-size="10" font-weight="bold" font-family="system-ui, sans-serif">On(통전) / Off(차단)</text>
  </g>
</svg>
</div>`;
