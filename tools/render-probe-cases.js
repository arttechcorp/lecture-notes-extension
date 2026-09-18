// 자동 생성 — tools/diagram-violation-probe.mjs 로 수집한 실제 모델 출력에서 뽑았다.
// 손으로 고치지 말 것. 재생성하려면 프로브를 다시 돌려 수확본에서 다시 뽑는다.
// 대상: 재무(NPV/IRR) · 관리회계(제조간접비) · 아날로그회로(MOSFET) 3개 도메인, 3개 모델.
window.PROBE_CASES = [
  {
    "id": "bare_no_fence_1",
    "kind": "bare_no_fence",
    "label": "펜스 없는 실제 모델 도식 #1",
    "markdown": "### 관계 도식\n\n모델이 펜스 없이 내보낸 실제 출력.\n\nflowchart TD\n    subgraph S1 [\"증폭기 스테이지 간 연결\"]\n        A[\"Circuit A (출력단)\"] -->|\"Vout 연결\"| B[\"Circuit B (입력단: 추가 경로 형성)\"]\n    end",
    "expect": "diagram"
  },
  {
    "id": "bare_no_fence_2",
    "kind": "bare_no_fence",
    "label": "펜스 없는 실제 모델 도식 #2",
    "markdown": "### 관계 도식\n\n모델이 펜스 없이 내보낸 실제 출력.\n\n\"flowchart TD\"\n    A[\"MOSFET + Rd Circuit<br>Vin --> Vout\"]\n    B[\"MOSFET + Rpd Circuit<br>Vin --> Vout\"]",
    "expect": "diagram"
  },
  {
    "id": "bare_no_fence_3",
    "kind": "bare_no_fence",
    "label": "펜스 없는 실제 모델 도식 #3",
    "markdown": "### 관계 도식\n\n모델이 펜스 없이 내보낸 실제 출력.\n\nflowchart TD\n    A[\"Circuit A (증폭단)\"] -->|\"출력 신호 노드 연결\"| B[\"Circuit B (후속 회로)\"]\n    B --> C[\"출력 노드에 회로 B의 입력 저항(추가 병렬 경로) 부하 발생\"]\n    C --> D[\"전체 등가 부하 저항 감소\"]\n    D --> E[\"출력 전압 진폭 및 이득 저하 (Output Degraded)\"]",
    "expect": "diagram"
  },
  {
    "id": "bare_no_fence_4",
    "kind": "bare_no_fence",
    "label": "펜스 없는 실제 모델 도식 #4",
    "markdown": "### 관계 도식\n\n모델이 펜스 없이 내보낸 실제 출력.\n\n\"flowchart TD\"\n    A[\"Resistor Rx1<br>Vx1 / Ix\"]\n    B[\"Resistor Rx2<br>Vx2 / Ix\"]\n    C[\"Parallel Resistors<br>Vy = 5V<br>Ix --> Rx1, Rx2\"]\n    D[\"Current Distribution<br>Vy = 5V<br>Ix --> I1, I2\"]\n    E[\"Example 1:<br>Ix = 1mA<br>Rx1 = 5kΩ\"]\n    F[\"Example 2:<br>Ix = 1mA<br>Rx2 = 4kΩ\"]\n    G[\"Calculation details<br>I_k = (5V) / (5kΩ) = 1mA\"]\n    H[\"Calculation details<br>I_2 = (5V) / (4kΩ) = 1.25mA\"]\n    C --> A\n    C --> B\n    C --> D\n    A --> E\n    B --> F\n    E --> G\n    F --> H",
    "expect": "diagram"
  },
  {
    "id": "bare_no_fence_5",
    "kind": "bare_no_fence",
    "label": "펜스 없는 실제 모델 도식 #5",
    "markdown": "### 관계 도식\n\n모델이 펜스 없이 내보낸 실제 출력.\n\nflowchart TD\n  subgraph Stage1 [\"선행 회로 (Circuit A)\"]\n    A_In[\"입력 (Input)\"] --> A_Core[\"증폭 코어\"]\n    A_Core --> A_Out[\"출력 노드 (Output Node)\"]\n  end\n  subgraph Stage2 [\"후속 회로 (Circuit B)\"]\n    B_In[\"입력단 (후속 회로 부하 저항)\"] --> B_Out[\"출력 (Output)\"]\n  end\n  A_Out -->|\"연결에 따른 유효 부하 저항 감소\"| B_In\n  B_In -.->|\"출력 전압 변동폭 감쇠 유발\"| A_Out",
    "expect": "diagram"
  },
  {
    "id": "fenced_with_dollars_1",
    "kind": "fenced_with_dollars",
    "label": "$ 포함 도식 (펜스됨) #1",
    "markdown": "### 도식\n\n```mermaid\nflowchart TD\n    A[\"직접재료비 $8\"] --> C\n    B[\"직접노무비 $5\"] --> C\n    D[\"제조간접비 배부액 $1 (예정배부율 $10/시간 적용)\"] --> C\n    C[\"총제조원가 집계\"] --> E[\"단위당 제품원가 $14\"]\n```",
    "expect": "diagram"
  },
  {
    "id": "fenced_with_dollars_2",
    "kind": "fenced_with_dollars",
    "label": "$ 포함 도식 (펜스됨) #2",
    "markdown": "### 도식\n\n```mermaid\nflowchart TD\n    A[\"직접재료비 ($8)\"] --> C[\"총제조원가 집계\"]\n    B[\"직접노무비 ($5)\"] --> C\n    D[\"제조간접비 배부액 ($1)\"] --> C\n    C --> E[\"단위당 제품원가 ($14)\"]\n```",
    "expect": "diagram"
  },
  {
    "id": "fenced_with_dollars_3",
    "kind": "fenced_with_dollars",
    "label": "$ 포함 도식 (펜스됨) #3",
    "markdown": "### 도식\n\n```mermaid\nflowchart TD\n  subgraph Input [\"원가 요소\"]\n    dm[\"직접재료비 $8\"]\n    dl[\"직접노무비 $5\"]\n    mo[\"제조간접비 배부액 $1\"]\n    rate[\"예정배부율 $10/시간 적용\"]\n  end\n  rate --> mo\n  dm --> total[\"총제조원가 집계\"]\n  dl --> total\n  mo --> total\n  total --> unit[\"단위당 제품원가 $14\"]\n```",
    "expect": "diagram"
  },
  {
    "id": "fenced_with_dollars_4",
    "kind": "fenced_with_dollars",
    "label": "$ 포함 도식 (펜스됨) #4",
    "markdown": "### 도식\n\n```mermaid\nflowchart TD\n    subgraph Inputs [\"기초 예상 데이터\"]\n        N1[\"예상 제조간접비: $20,000\"]\n        N2[\"예상 배부기준: 2,000시간\"]\n    end\n    N1 --> R[\"예정배부율 = ?\"]\n    N2 --> R\n```",
    "expect": "diagram"
  },
  {
    "id": "fenced_with_dollars_5",
    "kind": "fenced_with_dollars",
    "label": "$ 포함 도식 (펜스됨) #5",
    "markdown": "### 도식\n\n```mermaid\nflowchart TD\n    C1[\"직접재료비 $8\"]\n    C2[\"직접노무비 $5\"]\n    C3[\"제조간접비 배부액 $1\"]\n    Rate[\"예정배부율 $10/시간 적용\"]\n    Total[\"총제조원가 집계\"]\n    Unit[\"단위당 제품원가 $14\"]\n\n    Rate -.-> C3\n    C1 --> Total\n    C2 --> Total\n    C3 --> Total\n    Total --> Unit\n```",
    "expect": "diagram"
  },
  {
    "id": "fenced_subgraph_1",
    "kind": "fenced_subgraph",
    "label": "subgraph 포함 도식 #1",
    "markdown": "### 도식\n\n```mermaid\n\"flowchart TD\"\n    subgraph \"Circuit 1 (Single Path)\"\n        A[\"VDD = 3.3V<br>RD = 2kΩ\"]\n        B[\"Vin = 1V<br>Id = 1mA<br>Gain = -gmRd\"]\n        A --> B\n    end\n    subgraph \"Circuit 2 (Added Paths)\"\n        C[\"3.3V<br>900µA<br>2kΩ\"]\n        D[\"3.9V<br>600µA<br>4kΩ\"]\n        E[\"4.5V<br>500µA<br>6kΩ\"]\n        F[\"6V<br>300µA<br>15kΩ\"]\n        G[\"Vout = 1.5V -> 1.4625V\"]\n        H[\"Vin = 1V\"]\n        I[\"Id = 1000µA\"]\n        J[\"Gain = -gm(R1//R2//R3//R4//R5//R6)\"]\n        C -- affects --> G\n        D -- affects --> G\n        E -- affects --> G\n        F -- affects --> G\n        H --> I\n        I --> J\n    end\n```",
    "expect": "diagram"
  },
  {
    "id": "fenced_subgraph_2",
    "kind": "fenced_subgraph",
    "label": "subgraph 포함 도식 #2",
    "markdown": "### 도식\n\n```mermaid\nflowchart TD\n    subgraph S1 [\"증폭기 스테이지 간 연결\"]\n        A[\"Circuit A (출력단)\"] -->|\"Vout 연결\"| B[\"Circuit B (입력단: 추가 경로 형성)\"]\n    end\n```",
    "expect": "diagram"
  },
  {
    "id": "fenced_subgraph_3",
    "kind": "fenced_subgraph",
    "label": "subgraph 포함 도식 #3",
    "markdown": "### 도식\n\n```mermaid\nflowchart TD\n  subgraph Stage1 [\"선행 회로 (Circuit A)\"]\n    A_In[\"입력 (Input)\"] --> A_Core[\"증폭 코어\"]\n    A_Core --> A_Out[\"출력 노드 (Output Node)\"]\n  end\n  subgraph Stage2 [\"후속 회로 (Circuit B)\"]\n    B_In[\"입력단 (후속 회로 부하 저항)\"] --> B_Out[\"출력 (Output)\"]\n  end\n  A_Out -->|\"연결에 따른 유효 부하 저항 감소\"| B_In\n  B_In -.->|\"출력 전압 변동폭 감쇠 유발\"| A_Out\n```",
    "expect": "diagram"
  },
  {
    "id": "fenced_subgraph_4",
    "kind": "fenced_subgraph",
    "label": "subgraph 포함 도식 #4",
    "markdown": "### 도식\n\n```mermaid\nflowchart TD\n  subgraph StageA [\"Circuit A (Amplifier)\"]\n    InA[\"Input Node\"] --> CoreA[\"MOSFET Gain Stage\"]\n    CoreA --> OutNode[\"Output Node Vout\"]\n    OutNode --> RDA[\"RD (Original Pull-up)\"]\n  end\n  subgraph StageB [\"Circuit B (Next Stage)\"]\n    RinB[\"Input Resistance (Rx)\"]\n  end\n  OutNode --> RinB\n  RinB -.-> Degrade[\"Added Parallel Path: Degrades Output Gain Magnitude\"]\n```",
    "expect": "diagram"
  },
  {
    "id": "fenced_subgraph_5",
    "kind": "fenced_subgraph",
    "label": "subgraph 포함 도식 #5",
    "markdown": "### 도식\n\n```mermaid\nflowchart TD\n  subgraph CKT_A [\"Circuit A (Current Circuit)\"]\n    InA[\"Input\"]\n    OutA[\"Output Node\"]\n  end\n  subgraph CKT_B [\"Circuit B (Next Circuit)\"]\n    InB[\"Input Resistance\"]\n    OutB[\"Output Node\"]\n  end\n  InA --> OutA\n  OutA --> InB\n  InB --> OutB\n```",
    "expect": "diagram"
  },
  {
    "id": "legacy_graph_1",
    "kind": "legacy_graph",
    "label": "graph TD + 따옴표 없는 subgraph (구형) #1",
    "markdown": "### 도식\n\n```mermaid\n\"flowchart TD\"\n    subgraph \"Circuit 1 (Single Path)\"\n        A[\"VDD = 3.3V<br>RD = 2kΩ\"]\n        B[\"Vin = 1V<br>Id = 1mA<br>Gain = -gmRd\"]\n        A --> B\n    end\n    subgraph \"Circuit 2 (Added Paths)\"\n        C[\"3.3V<br>900µA<br>2kΩ\"]\n        D[\"3.9V<br>600µA<br>4kΩ\"]\n        E[\"4.5V<br>500µA<br>6kΩ\"]\n        F[\"6V<br>300µA<br>15kΩ\"]\n        G[\"Vout = 1.5V -> 1.4625V\"]\n        H[\"Vin = 1V\"]\n        I[\"Id = 1000µA\"]\n        J[\"Gain = -gm(R1//R2//R3//R4//R5//R6)\"]\n        C -- affects --> G\n        D -- affects --> G\n        E -- affects --> G\n        F -- affects --> G\n        H --> I\n        I --> J\n    end\n```",
    "expect": "diagram"
  },
  {
    "id": "legacy_graph_2",
    "kind": "legacy_graph",
    "label": "graph TD + 따옴표 없는 subgraph (구형) #2",
    "markdown": "### 도식\n\n```mermaid\ngraph TD\n    subgraph 증폭기 스테이지 간 연결\n        A[\"Circuit A (출력단)\"] -->|\"Vout 연결\"| B[\"Circuit B (입력단: 추가 경로 형성)\"]\n    end\n```",
    "expect": "diagram"
  },
  {
    "id": "legacy_graph_3",
    "kind": "legacy_graph",
    "label": "graph TD + 따옴표 없는 subgraph (구형) #3",
    "markdown": "### 도식\n\n```mermaid\ngraph TD\n  subgraph 선행 회로 (Circuit A)\n    A_In[\"입력 (Input)\"] --> A_Core[\"증폭 코어\"]\n    A_Core --> A_Out[\"출력 노드 (Output Node)\"]\n  end\n  subgraph 후속 회로 (Circuit B)\n    B_In[\"입력단 (후속 회로 부하 저항)\"] --> B_Out[\"출력 (Output)\"]\n  end\n  A_Out -->|\"연결에 따른 유효 부하 저항 감소\"| B_In\n  B_In -.->|\"출력 전압 변동폭 감쇠 유발\"| A_Out\n```",
    "expect": "diagram"
  },
  {
    "id": "legacy_graph_4",
    "kind": "legacy_graph",
    "label": "graph TD + 따옴표 없는 subgraph (구형) #4",
    "markdown": "### 도식\n\n```mermaid\ngraph TD\n  subgraph Circuit A (Amplifier)\n    InA[\"Input Node\"] --> CoreA[\"MOSFET Gain Stage\"]\n    CoreA --> OutNode[\"Output Node Vout\"]\n    OutNode --> RDA[\"RD (Original Pull-up)\"]\n  end\n  subgraph Circuit B (Next Stage)\n    RinB[\"Input Resistance (Rx)\"]\n  end\n  OutNode --> RinB\n  RinB -.-> Degrade[\"Added Parallel Path: Degrades Output Gain Magnitude\"]\n```",
    "expect": "diagram"
  },
  {
    "id": "legacy_graph_5",
    "kind": "legacy_graph",
    "label": "graph TD + 따옴표 없는 subgraph (구형) #5",
    "markdown": "### 도식\n\n```mermaid\ngraph TD\n  subgraph Circuit A (Current Circuit)\n    InA[\"Input\"]\n    OutA[\"Output Node\"]\n  end\n  subgraph Circuit B (Next Circuit)\n    InB[\"Input Resistance\"]\n    OutB[\"Output Node\"]\n  end\n  InA --> OutA\n  OutA --> InB\n  InB --> OutB\n```",
    "expect": "diagram"
  },
  {
    "id": "currency_pair_1",
    "kind": "currency_pair",
    "label": "한 줄에 통화 두 번 #1",
    "markdown": "회계연도 시작 전, 예상 제조간접비를 예상 배부기준으로 나누어 시간당 예정배부율을 계산함. 예: 예상 제조간접비 $20,000 ÷ 예상 직접노무시간 2,000시간 = 시간당 $10.",
    "expect": "text"
  },
  {
    "id": "currency_pair_2",
    "kind": "currency_pair",
    "label": "한 줄에 통화 두 번 #2",
    "markdown": "계산된 예정배부율을 실제 발생한 배부기준에 적용하여 각 제품에 제조간접비를 배부함. 예: 제품 A (직접노무시간 150시간) → 150시간 × $10/시간 = $1,500 배부.",
    "expect": "text"
  },
  {
    "id": "currency_pair_3",
    "kind": "currency_pair",
    "label": "한 줄에 통화 두 번 #3",
    "markdown": "개별 제품 생산에 소요된 직접재료비, 직접노무비, 배부된 제조간접비를 합산하여 단위당 제품원가를 계산함. 예: 직접재료 $8 + 직접노무 $5 + 배부 간접비 ($0.1시간 × $10/시간 = $1) = 총 $14.",
    "expect": "text"
  },
  {
    "id": "currency_pair_4",
    "kind": "currency_pair",
    "label": "한 줄에 통화 두 번 #4",
    "markdown": "회계 기간 종료 후, 실제 발생한 제조간접비와 예정 배부액 간의 차이를 파악하고, 이를 각 제품 원가에 반영하여 조정함. 예: 실제 간접비 $21,000 → 예정 배부액 $20,000 → $1,000 과소 배부 → 추가 배부.",
    "expect": "text"
  },
  {
    "id": "currency_pair_5",
    "kind": "currency_pair",
    "label": "한 줄에 통화 두 번 #5",
    "markdown": "회계연도 시작 전 예상 제조간접비 $20,000와 예상 직접노무시간 2,000시간을 기준으로 시간당 $10의 예정배부율 계산",
    "expect": "text"
  },
  {
    "id": "inline_math_1",
    "kind": "inline_math",
    "label": "실제 인라인 수식 #1",
    "markdown": "Output Stage Analysis: When an input voltage ($V_{in}$) increases slightly, causing the output voltage ($V_{out}$) to decrease, it's often due to an added path that degrades the output voltage magnitude. This is a scenario observed previously where additional circuitry impacts the output.",
    "expect": "math"
  },
  {
    "id": "inline_math_2",
    "kind": "inline_math",
    "label": "실제 인라인 수식 #2",
    "markdown": "The calculation $1.05mA \times 2k\text{Ω} = 2(-1V)$ in evidence e-15 seems to have a discrepancy. $1.05mA \times 2k\text{Ω} = 2.1V$. The negative sign and the resulting voltage value are unclear without further context.",
    "expect": "math"
  },
  {
    "id": "inline_math_3",
    "kind": "inline_math",
    "label": "실제 인라인 수식 #3",
    "markdown": "The formula $I_d = \text{Id0} + \text{λId0} \times V_{DS}$ presented in e-36 and e-38 contains potential notation inconsistencies (e.g., $\text{λDO}$ vs $\text{λ}I_{d0}$). The final form $I_d = I_{d0} + \frac{V_{DS}}{r_0}$ is clearer.",
    "expect": "math"
  },
  {
    "id": "inline_math_4",
    "kind": "inline_math",
    "label": "실제 인라인 수식 #4",
    "markdown": "The notation $Io$ and $Io0$ in e-39 seem to be typos and likely refer to $I_{d0}$.",
    "expect": "math"
  },
  {
    "id": "inline_math_5",
    "kind": "inline_math",
    "label": "실제 인라인 수식 #5",
    "markdown": "What are the specific values for $V_{DD}$, $R_D$, $V_{in}$, and $g_m$ used in the calculation of 'Gain = -gmRd' and the subsequent values presented in e-35?",
    "expect": "math"
  },
  {
    "id": "display_math_1",
    "kind": "display_math",
    "label": "실제 formulas[].latex #1",
    "markdown": "$$\\text{Gain} = -g_m R_D$$",
    "expect": "math"
  },
  {
    "id": "display_math_2",
    "kind": "display_math",
    "label": "실제 formulas[].latex #2",
    "markdown": "$$I_d = \\frac{1}{2} \\mu C_{ox} \\frac{W}{L} (V_{GS} - V_{TH})^2 (1 + \\lambda V_{DS})$$",
    "expect": "math"
  },
  {
    "id": "display_math_3",
    "kind": "display_math",
    "label": "실제 formulas[].latex #3",
    "markdown": "$$I_d = I_{d0} + \\frac{V_{DS}}{r_0}$$",
    "expect": "math"
  },
  {
    "id": "display_math_4",
    "kind": "display_math",
    "label": "실제 formulas[].latex #4",
    "markdown": "$$r_0 = \\frac{1}{\\lambda I_{d0}}$$",
    "expect": "math"
  },
  {
    "id": "display_math_5",
    "kind": "display_math",
    "label": "실제 formulas[].latex #5",
    "markdown": "$$I_d = \\frac{1}{2} \\mu C_{ox} L (V_{GS} - V_{TH})^2 (1 + \\lambda V_{DS})$$",
    "expect": "math"
  }
];
