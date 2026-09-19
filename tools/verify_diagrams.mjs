import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  DIAGRAM_ENERGY_BAND,
  DIAGRAM_CRYSTAL_STRUCTURE,
  DIAGRAM_MATERIALS_TREE,
  DIAGRAM_COVALENT_AND_EHP,
  DIAGRAM_TRANSISTOR_IV
} from "./apply_visual_diagrams_and_remove_excluded.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <script src="https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js"></script>
</head>
<body>
  <h1>Mermaid Test</h1>
  <div id="logs"></div>
  <script>
    const logDiv = document.getElementById('logs');
    window.errors = [];
    window.onerror = (msg, url, line) => {
      window.errors.push({ msg, url, line });
      logDiv.innerHTML += '<p style="color:red">ERROR: ' + msg + '</p>';
    };
    mermaid.initialize({ startOnLoad: false, theme: 'default' });

    const diagrams = [
      { id: 'ENERGY_BAND', code: \`flowchart TD
    subgraph Insulator ["절연체 (Insulator)"]
        direction TB
        CB1["전도대 (Conduction Band)<br/>전자가 거의 없음 (비어있음)"]
        GAP1["에너지 밴드갭 (Bandgap)<br/>Eg > 5 eV (매우 큼: 전자 이동 불가)"]
        VB1["원자가대 (Valence Band)<br/>원자핵에 강하게 구속, 전자 가득 참"]
        CB1 --- GAP1 --- VB1
    end

    subgraph Semiconductor ["반도체 (Semiconductor)"]
        direction TB
        CB2["전도대 (Conduction Band)<br/>외부 에너지 공급 시 전자 전이"]
        GAP2["에너지 밴드갭 (Bandgap)<br/>Eg ≈ 1.1 eV (Si) / 0.67 eV (Ge)"]
        VB2["원자가대 (Valence Band)<br/>상온에서 전자가 쉽게 이탈 가능"]
        CB2 --- GAP2 --- VB2
    end

    subgraph Conductor ["도체 (Conductor)"]
        direction TB
        OVL["전도대 (CB) & 원자가대 (VB)<br/>서로 겹침 (Overlap, Eg = 0 eV)<br/>상온에서도 무수한 자유전자가 이동"]
    end

    style Insulator fill:#1e293b,stroke:#ef4444,stroke-width:2px,color:#fff
    style Semiconductor fill:#1e293b,stroke:#38bdf8,stroke-width:2px,color:#fff
    style Conductor fill:#1e293b,stroke:#10b981,stroke-width:2px,color:#fff\` },
      
      { id: 'CRYSTAL_STRUCTURE', code: \`flowchart LR
    subgraph Crystalline ["단결정 (Crystalline)"]
        direction TB
        C_DESC["• 원자들의 완벽한 주기적 배열<br/>• 결함 및 불연속성 없음<br/>• 전자 이동 거동 정확히 예측 가능<br/>• 최신 3nm 집적회로(IC) 제작에 필수"]
    end

    subgraph Polycrystalline ["다결정 (Polycrystalline)"]
        direction TB
        P_DESC["• 여러 개의 작은 단결정립(Grain) 집합체<br/>• 결정립 간 경계: 결정립계(Grain Boundary)<br/>• 계면 결합 불완전으로 전송 저항 발생"]
    end

    subgraph Amorphous ["비정질 (Amorphous)"]
        direction TB
        A_DESC["• 원자 배열이 무작위(Random)<br/>• 장거리 규칙성(Long-range order) 부재<br/>• 전자 거동 예측 난해 (상업적 특수 응용)"]
    end

    style Crystalline fill:#0f172a,stroke:#38bdf8,stroke-width:2px,color:#fff
    style Polycrystalline fill:#0f172a,stroke:#f59e0b,stroke-width:2px,color:#fff
    style Amorphous fill:#0f172a,stroke:#a855f7,stroke-width:2px,color:#fff\` },
      
      { id: 'MATERIALS_TREE', code: \`flowchart TD
    SEMI["반도체 물질군 (Semiconductor Materials)"]
    
    SEMI --> ELEM["단일 원소 반도체 (Elemental)<br/>Group 4 (화학 14족)"]
    SEMI --> COMP["화합물 반도체 (Compound)"]

    ELEM --> SI["★ Silicon (Si)<br/>현대 소자 표준 (Eg ≈ 1.1 eV)"]
    ELEM --> GE["Germanium (Ge)<br/>최초 트랜지스터 재료 (Eg ≈ 0.67 eV)"]
    ELEM --> C["Carbon (C)<br/>소자 재료 논쟁적 (다이아몬드 등)"]

    COMP --> C44["IV-IV 족 화합물<br/>• Si-Ge, Si-C"]
    COMP --> C35["III-V 족 화합물<br/>• GaAs, InP, InGaAsP<br/>• SpaceX 위성 태양전지 고효율 셀"]
    COMP --> C26["II-VI 족 화합물<br/>• CdTe"]
    COMP --> C46["IV-VI 족 화합물<br/>• PbS"]

    style SEMI fill:#1e293b,stroke:#38bdf8,stroke-width:2px,color:#fff
    style SI fill:#065f46,stroke:#10b981,stroke-width:2px,color:#fff
    style GE fill:#7c2d12,stroke:#f97316,stroke-width:1.5px,color:#fff
    style C35 fill:#1e1b4b,stroke:#818cf8,stroke-width:1.5px,color:#fff\` },

      { id: 'COVALENT_AND_EHP', code: \`flowchart TD
    subgraph Step1 ["(a) 상온 이전: 완전한 공유결합 상태 (Covalent Bonds)"]
        S1["Si 원자 (최외각 4개 전자, sp³ 혼성 오비탈)<br/>인접한 4개 Si 원자와 2개씩 전자 공유하여 결합<br/>원자 밀도: 5 × 10²² atoms/cm³ | 자유전자 없음"]
    end

    subgraph Step2 ["(b) 외부 에너지 인가 (Thermal Energy / T 상승)"]
        S2["열 진동에 의해 Si-Si 공유결합 파괴 (Bond Broken)"]
    end

    subgraph Step3 ["(c) 캐리어 쌍 동시 생성 (Carrier Pair Generation)"]
        S3A["자유 전자 (Free Electron)<br/>결합에서 빠져나와 전도대로 이동<br/>전류 전도 기여"]
        S3B["정공 (Hole, 빈자리)<br/>전자가 빠져나간 빈 공간<br/>양전하 캐리어로 거동"]
    end

    Step1 --> Step2
    Step2 --> S3A
    Step2 --> S3B

    style Step1 fill:#0f172a,stroke:#38bdf8,stroke-width:1.5px,color:#fff
    style Step2 fill:#0f172a,stroke:#f59e0b,stroke-width:1.5px,color:#fff
    style Step3 fill:#0f172a,stroke:#10b981,stroke-width:1.5px,color:#fff\` },

      { id: 'TRANSISTOR_IV', code: \`flowchart LR
    INPUT["입력 전압 / 게이트 바이어스 제어"] --> MOD["채널 저항(Resistance) 동적 변조"]
    MOD --> SLOPE["I-V 특성 곡선의 기울기(Conductance = 1/R) 변화"]
    SLOPE --> SWITCH["완벽한 스위칭 동작 (On: 대전류 / Off: 극미세 누설전류)"]
    
    style INPUT fill:#0f172a,stroke:#38bdf8,stroke-width:1.5px,color:#fff
    style MOD fill:#0f172a,stroke:#f59e0b,stroke-width:1.5px,color:#fff
    style SLOPE fill:#0f172a,stroke:#818cf8,stroke-width:1.5px,color:#fff
    style SWITCH fill:#064e3b,stroke:#10b981,stroke-width:2px,color:#fff\` }
    ];

    async function runTest() {
      for (const d of diagrams) {
        try {
          const { svg } = await mermaid.render('render_' + d.id, d.code);
          logDiv.innerHTML += '<p style=\"color:green\">SUCCESS: ' + d.id + ' (svg len: ' + svg.length + ')</p>';
        } catch (e) {
          logDiv.innerHTML += '<p style=\"color:red\">FAIL: ' + d.id + ': ' + e.message + '</p>';
        }
      }
      document.title = 'DONE';
    }
    runTest();
  </script>
</body>
</html>`;

fs.writeFileSync(path.join(ROOT, "test_mermaid.html"), html, "utf8");
console.log("Created test_mermaid.html");
