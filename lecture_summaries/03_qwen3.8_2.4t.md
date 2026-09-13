# Qwen3.8 2.4T-A95B 학습 요약 노트

- 모델 ID: `qwen/qwen3.8-2.4t-a95b`
- 생성 시간: 124.4초
- 생성 글자 수: 39553자

---

We need answer in Korean. User asks to produce structured study notes from lecture transcript/slide OCR about MOSFET amplifiers, small-signal, parallel resistors/additional path reducing gain, large vs small signal, DC voltage sources AC ground, etc. Must include 3 axes: key conceptual questions, math formulations/derivations, practical applications. Use Markdown, LaTeX. No meta/intro. Need deeply structured, complete. Need analyze content and synthesize. Need likely cover: additional path Rx reduces gain because load at output becomes RD || Rx (or parallel combination of many resistances/current paths), current change from transistor divides, voltage change at output reduced. Small-signal fixed DC nodes ground because DC sources have zero incremental impedance (ideal), only changes matter, VDD AC short to ground. Large signal vs small signal: example VDD=3.3V, RD=2k, Vin 1 ->1.02 V, Vout 1.3 ->1.2 V, Id 1 ->1.05 mA? Need reconcile numbers. There are OCR inconsistencies: 50mAh? probably 50 µA? Slide: VDD=3.3V RD=2k VIN=1V ->1.02V Vout=1.3V ->1.2V Id=1mA ->1.05mA. But if RD=2k, Id=1mA -> drop 2V, Vout=1.3V fits VDD 3.3. If Id changes +50 µA (1.05 mA) drop=2.1V, Vout=1.2V. So ∆Vin=20 mV, ∆Id=50 µA => gm=∆Id/∆Vgs=50µA/20mV=2.5 mA/V. Gain small signal = -gm RD = -2.5m*2k=-5. ∆Vout=-5*20mV=-100mV, from 1.3 to 1.2 V. Good. OCR mentions 1mA x 2k=2V, 1.05mA x2k=2.1V. Good. Then with additional path maybe gain smaller, output change less, e.g. Vout=1.5 ->1.4625? ∆=-37.5mV for +20mV input? Gain=-1.875? Need infer from slide: Added Path Reduces Voltage Change: VDD=3.3V, Rd=2k, Vin=1V, Id=1mA, Gain=-gmRd. Then parallel resistors maybe 2k,4k,6k,15k,10k? Vout=1.5 ->1.4625, Gain=-gm(R1//R2//R3//R4//R5//R6). Another slide: Vin=+20mV, Vout=-37.5mV, gm_Vgs=+50μA, 2kΩ. If gain -1.875, effective load=|Av|/gm=1.875/2.5m=750Ω. Maybe parallel combination of something equals 750Ω? If RD=2k || Rx = 750 -> Rx=1.2k. There is mention 10k? Need not force exact. Can present general with illustrative numeric example: no extra path gain -5, ∆Vout=-100mV. With extra path Rx=1.2k gives R_eff=750Ω, gain=-1.875, ∆Vout=-37.5mV. That matches OCR Vout=1.5->1.4625? If baseline 1.5, +20mV input gives -37.5mV, output 1.4625. Good. So use that as numerical example. Need mention if extra current source/path provides DC current and incremental conductance. Additional path could be load resistor, current source output resistance, next-stage input resistance. It shunts AC output node to AC ground or another fixed voltage, reducing incremental resistance at output. Thus voltage swing for same gm vgs current reduces. Current division: total small-signal current from controlled source splits between RD and Rx; only portion through RD creates output voltage? Actually output voltage is node voltage relative to ground; if both RD to VDD (AC ground) and Rx to AC ground, both are parallel to ground. The controlled current source pulls current from output node to ground (NMOS drain to source). KCL: g_m v_gs = v_out/R_D + v_out/R_x (assuming source ground and current direction), so v_out = -g_m v_gs (R_D || R_x)? Need signs. Typically small-signal: drain current increment id = g_m vgs flows into drain (from drain to source? depends). Output node has RD to AC ground; KCL: (v_out/RD) + g_m v_in = 0 -> v_out=-g_m RD v_in if only RD. With Rx: v_out(1/RD+1/Rx)+g_m vin=0 => Av=-g_m(RD||Rx). Good. We can derive.

Need cover channel length modulation: large signal Id=1/2 μCox (W/L?) (VGS-VTH)^2(1+λ VDS) = ID0 + λ ID0 VDS ≈ ID0 + VDS/r_o, where r_o=1/(λ ID0) (more precisely 1/(λ ID) or (1/λ+VDS?)). Small signal includes r_o parallel with RD/load, gain = -g_m (R_D || r_o || R_L...). If λ=0 ideal current source infinite ro. PMOS current source load: gain = -g_m (r_o1 || r_o2) maybe if active load. Diode-connected load resistance ~1/g_m (if λ=0) or (1/g_m)||r_o; gain approx -g_m1/(g_m2 + 1/r_o2? ) maybe -g_m1 (1/g_m2 || r_o2) ~ -g_m1/g_m2. Degeneration: source resistor R_S reduces gain: Av = -g_m R_D / (1+g_m R_S) if λ=0 and bypass cap? If not bypassed. More exact with ro maybe. Output resistance with degeneration: Rout ≈ r_o(1+g_m R_S)+R_S (or if looking into drain with source degeneration). If λ=0 Rout=R_D (or infinite looking into transistor? Need mention). Example with M1/M2 identical? Could be source follower? But user focus mostly additional path, small signal, DC ground, large vs small. But transcript includes CS amp with current source, PMOS current source, diode-connected load, degeneration, output resistance. We need likely incorporate to be complete. But user's requested 3 axes around those concepts. We can include sections for these advanced topics but not overdo? Desired oververbosity 9, so detailed. Need produce final only notes, no intro. Must use Korean. Need ensure LaTeX correct. Need maybe include table of numerical large vs small. Need standard inline $...$, block $$...$$. Need ensure no unsupported weird. Use Markdown.

Need think through exact content to produce.

Structure:
# MOSFET 증폭기: 추가 경로에 의한 이득 감소, 소신호/대신호, AC 접지, 임피던스 통합 노트

Maybe no intro. Start with ## 1. 핵심 질문과 직관적 답변

Questions:
1. 추가 경로 Rx가 생기면 왜 이득이 감소하나?
- 출력 노드 incremental resistance 감소. 동일 gm vgs 전류가 더 많은 경로로 나누어짐. 전압 변화 vout = -id * R_eq. R_eq = RD||Rx... smaller.
- Thevenin/Norton: transistor is VCCS, load resistance converts current to voltage. Additional path increases conductance, lowers resistance, lowers conversion gain.
- If Rx is next stage input resistance or current source finite output resistance, it loads output.

2. 소신호에서 DC 전압원은 왜 AC ground?
- Small signal analyzes changes around bias. Ideal DC source has constant voltage: ΔV=0, incremental impedance 0. Node fixed at DC potential is small-signal short to ground. VDD becomes AC ground; large capacitors short at signal freq; bias current sources open? Actually ideal current source has infinite incremental impedance, but fixed current node? Need clarify: fixed DC voltage node = AC ground if ideal voltage source. Fixed DC current source = open for AC (infinite impedance). But slide says fixed voltage node just ground. Also if supply has nonzero impedance, use that impedance not short.

3. 대신호와 소신호 차이?
- Large signal uses nonlinear I-V, actual DC operating point changes; small signal linearizes derivative at Q-point. For small ∆, ∆ID≈gm∆VGS. If ∆ large, gm changes, output swing may clip, ro nonlinear, threshold/body effects, etc. Example: exact square-law vs tangent.
- Use numbers: Q point: VDD=3.3, RD=2k, ID=1mA, Vout=1.3. Vin=1 to 1.02, ID=1 to1.05, Vout=1.3 to1.2. gm=50µA/20mV=2.5mS. Av=-5. Large signal computed by Ohm's law: Vout=VDD-IDRD. Small-signal: ∆Vout=-gmRD∆vin = -100mV. Matches if small. If additional path, small-signal predicts reduced gain; large signal would also show less voltage change due to extra DC/AC current path.

4. 왜 전류 분배가 중요한가? 추가 경로 전류가 원래 RD 전류 변화를 줄이나?
- Explain with example: without Rx, ∆ID=50µA all through RD => ∆VRD=100mV. With Rx, total transistor ∆ current? Actually controlled source still gm vgs =50µA? If output voltage less, current through RD changes less; extra path takes rest. KCL: ∆ID=∆IRD+∆IRx. If Req=750, vout=-37.5mV, ∆IRD=vout/RD=-18.75µA? sign, ∆IRx=vout/Rx=-31.25µA. Sum=-50µA. So RD current change only 18.75µA, voltage change 37.5mV. Good. Need present sign carefully: increase Vin raises ID (pulls more current from node to ground), node voltage falls; current through RD from VDD to node? If Vout falls, voltage across RD increases, so IRD increases? Let's set small-signal currents. Node voltage vout negative. RD to AC ground: current from node to ground through RD is vout/RD (negative, meaning actual current flows from ground to node? Hmm). Better to talk magnitudes: extra path absorbs part of incremental current, so less incremental voltage develops across RD. Use KCL with directions: define g_m v_in current drawn from output node to ground. Resistors from node to AC ground conduct current from node to ground equal v_out/R. If v_out negative, current is negative, i.e. flows into node, supplying the g_m current. Magnitudes: |v_out|/RD + |v_out|/Rx = g_m v_in. So only part of g_m v_in is balanced by RD. Good.

5. 다단 증폭기에서 Rin/Rout가 왜 중요한가?
- Next stage input resistance loads previous output: effective gain = Av_open * Rin_next/(Rin_next + Rout_prev) for voltage transfer. Need formulas.
- Multiple stage total gain not just product of intrinsic gains; include loading factors.

6. What is resistance seen from input/output? maybe include. Input resistance of CS is high (gate open) but with bias resistors etc. Output resistance is RD||ro||...; with degeneration increased.

7. Current source load: ideal current source in small signal? infinite resistance, so gain -gm ro? Actually if ideal current source load infinite incremental impedance, gain infinite in simplified model; real finite ro. PMOS current source load: load is PMOS ro, gain -gmN (roN||roP). Need explain role bias; in small signal ideal current source is open (high R) not short. But fixed DC voltage node ground.

8. Diode-connected load: why ~1/gm? Gate-drain short, small-signal looking into drain/source? For diode-connected MOS in saturation, i = gm vgs + vds/ro, vgs=vds, so incremental resistance = 1/(gm+1/ro) ≈1/gm. Used as load gives gain ≈ -gm1/(gm2+...) or -gm1/gm2.

9. Source degeneration: why gain less and linearized? R_S introduces negative feedback: input vgs = vin - vs, vs=id RS. id = gm vgs => id = gm(vin-idRS) => id = gm/(1+gmRS) vin. Av = -id RD / vin = -gm RD/(1+gmRS). With ro maybe. Output resistance increased.

Need maybe include questions under key conceptual. But need not too many.

Then ## 2. 수식 및 유도
Subsections:
2.1 DC/large signal operating point
- For NMOS CS with RD: saturation Id = 1/2 μnCox (W/L)(VGS-VTH)^2(1+λVDS). If λ=0. Vout = VDD - ID RD. Need Q point example.
- Numerical: VDD=3.3V, RD=2kΩ, IDQ=1mA, VOUTQ=1.3V. Vin changes 20mV, ID changes 50µA, new Vout=3.3 - 1.05mA*2k=1.2V. ∆Vout=-0.1V. Large signal gain over small interval = -0.1/0.02=-5.

2.2 Small signal model and gm
- Define gm = ∂ID/∂VGS|Q. Square law λ=0: gm = μnCox(W/L)(VGS-VTH) = 2ID/(VGS-VTH) = sqrt(2 μnCox(W/L) ID). With λ: plus? gm approximately same, ro=1/(λID).
- ∆ID ≈ gm ∆vGS. Example gm=50µA/20mV=2.5mS.

2.3 Basic CS gain without extra path
- Small-signal: gate input vin, source ground, drain node vout, RD to AC ground. KCL: gm vin + vout/RD + vout/ro =0 (if include ro). Therefore Av = -gm (RD||ro). If ro ignored, -gmRD. Numeric -2.5mS*2k=-5.

2.4 Additional parallel path Rx
- Add Rx from output to AC ground (or to fixed voltage). KCL: gm vin + vout(1/RD+1/Rx+1/ro...)=0. Av=-gm (RD||Rx||ro...). Derive using parallel resistance. If Rx=1.2kΩ, RD||Rx=750Ω, Av=-1.875. For ∆Vin=20mV, ∆Vout=-37.5mV. Currents: gm vin=50µA; |vout|/RD=18.75µA, |vout|/Rx=31.25µA, sum=50µA. Thus RD current/voltage change reduced. Need align signs maybe with magnitude table.
- More general additional path not necessarily to ground: if to a small-signal fixed voltage, same as ground; if to another node with signal, must include its relation (e.g., feedback). If finite source impedance, use impedance.

2.5 Parallel resistor math and current divider
- For two resistors: Req = R1||R2 = R1R2/(R1+R2), conductances add. If node voltage v, currents i1=v/R1, i2=v/R2. If total current I injected into node, v=I Req. Current divider: i1=I * R2/(R1+R2) if current entering node split to ground? For conductances: i1=I G1/(G1+G2). Need include.

2.6 AC ground concept mathematically
- Let node voltage = V_DC + v_ac. For ideal voltage source VDD: v_ac=0. Incremental resistance ∂V/∂I=0. Therefore replace with short to ground in small-signal. For fixed bias voltage similarly. For capacitor at signal freq: impedance 1/jωC≈0 -> AC short. For ideal current source: I_DC constant, ∆I=0 -> incremental impedance ∞ -> open. But real current source has ro parallel.

2.7 Large vs small signal linearization error
- Taylor expansion: ID(VGS+∆v) ≈ ID(VGS) + gm∆v + 1/2 g_m' ∆v^2... Error if square law: exact ∆ID = gm ∆v + (1/2)k ∆v^2. Relative error = ∆v/[2(VGS-VTH)]? Let's derive: ID=k/2 (Vov)^2, gm=k Vov. Exact for ∆: ∆ID = k/2[(Vov+∆)^2 - Vov^2] = k Vov ∆ + k/2 ∆^2 = gm∆ + (1/2)k∆^2. Ratio nonlinear term/linear = ∆/(2Vov). If ∆=20mV, Vov=0.2? error 5%; maybe. Use qualitatively.
- Also RD large-signal Vout=VDD-IDRD exactly linear in ID if RD fixed; small-signal matches for incremental. But if extra path includes nonlinear device, small-signal uses local resistance.

2.8 Loading of stages: Rin/Rout
- Model amplifier A: Thevenin output: v_oc = A_v0 v_in, series Rout. Load Rin_B. Actual v_out = v_oc * Rin_B/(Rout+Rin_B). Effective voltage gain from A input to B input = A_v0 * Rin_B/(Rout+Rin_B). If multiple stages: total = ∏ A_vi * loading factors. Maybe include formula:
$$\frac{v_{out}}{v_{in}} = A_{v1}\frac{R_{in2}}{R_{in2}+R_{out1}} A_{v2}\frac{R_{in3}}{R_{in3}+R_{out2}}\cdots$$
- Input resistance measured by test voltage/current at input with independent sources zeroed: Rin=vx/ix. Output resistance by turning off independent input sources (voltage sources short, current sources open), apply test source at output: Rout=vx/ix. Include dependent sources remain.

2.9 Channel length modulation and active loads
- Id = ID0(1+λVDS). ro = [∂ID/∂VDS]^{-1} ≈ 1/(λID0). Gain CS with ro: -gm(RD||ro). Current source load: load resistance is ro of current source; gain -gmN (roN||roP). Ideal current source ro→∞ -> gain limited by transistor ro? Actually if both ideal infinite? In a simple NMOS with ideal current source load and no RD, output node only controlled source and ideal current source, small-signal resistance infinite -> infinite gain in simplified model; in reality ro limits.
- PMOS current source: if PMOS load gate bias fixed, source to VDD AC ground, drain at output; small-signal equivalent is ro_p from output to AC ground (and maybe gm_p vsg=0 if gate/source fixed), so parallel with NMOS ro. Gain = -g_mn (r_on || r_op). If PMOS diode? no.

2.10 Diode-connected load
- For M2 diode-connected (gate-drain short), small-signal from drain to source: test vx, current ix = gm vx + vx/ro, so R = vx/ix = 1/(gm+1/ro)= (1/gm)||ro. CS with diode load gain: Av = -g_m1 (R_load) = -g_m1 (1/g_m2 || r_o2 || maybe r_o1). If λ=0 and neglect body: Av≈-g_m1/g_m2. If include ro: -g_m1 (r_o1 || 1/g_m2 || r_o2?) Need be precise: NMOS driver M1 drain node, load PMOS diode-connected from VDD to out. Small-signal: M1 current source g_m1 vgs1 with ro1 to ground? Source ground. Load diode PMOS: source to VDD AC ground, gate/drain output. For PMOS diode, incremental resistance from output to AC ground is 1/g_m2 || r_o2. M1 ro from output to ground too. Thus total R_out = r_o1 || (1/g_m2 || r_o2). Gain = -g_m1 [r_o1 || r_o2 || 1/g_m2]. If λ=0 and ro1,ro2∞, -g_m1/g_m2.

2.11 Source degeneration
- With R_S unbypassed: small signal: v_gs = v_in - i_d R_S; i_d = g_m v_gs (ignore ro) => i_d = g_m(v_in - i_d R_S) => i_d = g_m/(1+g_mR_S) v_in. Output v_out = -i_d R_D. Av = -g_m R_D/(1+g_m R_S). If include ro and R_D, more complex: effective transconductance G_m = g_m/(1+g_m R_S) approximately; output resistance looking into drain ≈ r_o(1+g_m R_S)+R_S. With R_D, Rout = R_D || that. If source bypass capacitor, at signal R_S shorted -> gain returns to -gmRD; at low frequency degeneration.
- Degeneration reduces gain but increases linearity, input/output impedance, bandwidth maybe.

Need include numerical example for degeneration? Maybe optional.

Then ## 3. 실전 활용
- Check output loading: whenever a node drives next circuit, replace next circuit by Rin (or impedance) in parallel. If gain lower than expected, suspect loading by Rx, finite ro, bias network, measurement instrument (oscilloscope 1MΩ||15pF), current source finite ro.
- To prevent gain degradation: buffer with source follower/op-amp, increase Rin of next stage (use MOS gate, cascode, bootstrapping), lower Rout of driving stage if voltage transfer? Actually for voltage output, want Rout << Rin to avoid loss. Use source follower (low Rout), common-drain, unity-gain buffer. Use cascode to increase output resistance of current source load? For gain, increase effective load resistance: active load, cascode current source, longer channel, higher ro. But if load is next stage, isolate with buffer.
- Impedance separation: design each stage with input impedance high, output impedance low for voltage amplifiers, or account for matching.
- Small-signal drawing tips: 1) find DC bias, 2) short DC voltage sources to ground, open DC current sources (or replace with ro), short large capacitors at midband, 3) replace MOSFET by gm vgs current source and ro, 4) identify all resistances from output node to AC ground: RD, ro, load, bias, next stage, 5) combine in parallel for gain. 6) For input, gate current zero -> Rin set by bias resistors, but Miller effect at high freq.
- Pitfalls: confusing DC ground with physical ground; forgetting VDD is AC ground; treating ideal current source as short; forgetting ro; forgetting loading of next stage; using large-signal resistor values when device is nonlinear; sign errors; assuming gain product without loading; assuming source resistor bypassed when not; body effect; capacitors not short at low freq; measuring with probe loading.
- Exam strategy: If question says additional path/resistor attached to output, immediately write R_eff = R_D || R_x || r_o || R_in,next. If asks fixed voltage node, replace with ground. If asks large vs small, compute Q point then gm, compare ∆. If asks multi-stage, draw cascade with Rin/Rout and voltage dividers.
- Design examples: Want gain magnitude ≥ target: choose RD or active load such that gm R_eff target, but ensure output swing headroom: Vout_Q = VDD - ID R_D; RD too large limits swing. If need high Rout for current source load, cascode. If need low Rout to drive load, source follower or feedback.
- Use test-source method for Rin/Rout: zero independent sources, apply v_x/i_x; keep dependent sources. For output resistance with input shorted (vin=0), vgs may not be zero if source not grounded due to degeneration; derive.

Need maybe include a table of example without/with Rx:
Columns: Condition, R_eff, Av, ∆Vin, ∆Vout, current through RD etc.
Numerical: Q maybe VoutQ=1.3 or 1.5? Use consistent. The slide has with Rx baseline Vout=1.5->1.4625, maybe use separate. For basic example Q=1.3. For added path example set Q=1.5? Need avoid inconsistency. Can say "강의 슬라이드의 추가 경로 예시를 재구성하면" with Vout_Q=1.5, ∆Vout=-37.5mV. But if RD=2k and ID? If Vout=1.5, drop=1.8V -> ID=0.9mA. gm maybe still 2.5mS. If Rx=1.2k, DC current through Rx? If Rx to ground, DC current 1.5/1.2=1.25mA, so transistor ID maybe 0.9mA+? Hmm not consistent. But small-signal only. Better present small-signal incremental numbers not DC. Could use baseline no path Vout_Q=1.3. With path, Q changes; but incremental gain uses local R_eff. We can say "DC 바이어스는 달라질 수 있으나, 소신호 등가에서는 추가 경로의 증분 저항만 병렬로 붙는다." Example: If R_eff=750Ω, ∆Vout=-37.5mV for 20mV input. This matches slide. Don't overstate DC values.

Need ensure math sign. For additional path: KCL at output node with small-signal ground at VDD and source. Let current from controlled source flow from drain to source (down) = g_m v_gs. Node voltage v_o. Resistive currents leaving node to ground = v_o/R_D + v_o/R_x. KCL: v_o/R_D + v_o/R_x - g_m v_in? Wait if controlled current source draws current from node to ground, leaving node is g_m v_in. Then sum leaving = v_o/RD + v_o/Rx + g_m vin =0? Actually no external current injection, sum leaving =0? Let's define currents leaving positive: through resistors to ground: v_o/R. Controlled source current leaves node to ground: g_m v_in. KCL leaving sum =0? That would v_o/R + g_m vin =0 -> v_o negative. Yes if vin positive, v_o = -g_m R vin. Good. If using currents entering node, sign similar. We'll write KCL: $g_m v_{in} + v_{out}/R_D + v_{out}/R_x =0$, giving negative. This assumes current source from output to ground. Good.

Need include current division magnitudes:
With Rx=1.2k, R_eff=750, vout=-37.5mV, current through RD magnitude = 37.5mV/2k=18.75µA, through Rx=37.5/1.2k=31.25µA, total=50µA. Without Rx, current through RD=50µA. Good.

Need mention additional path can be a resistor to another signal node; then not simply parallel. If that node is fixed/incremental ground, parallel; if it has gain/feedback, modify. E.g., source degeneration path creates feedback not simple output shunt.

Need include "Fixed voltage node is just ground" maybe with example of multiple supply voltages 3.3, 3.9, 4.5, 6V all become AC ground if ideal. If resistor network from outputs to these fixed supplies, those ends go to ground in small-signal.

Need maybe include "3.3V, 5V DC node AC ground" question. Answer: because small-signal variables are deviations; a fixed node has zero deviation. Mathematically $V_{node}=V_{DC}+v_{ac}$, $v_{ac}=0$. An ideal voltage source has $v=constant$ regardless of current => incremental resistance 0, so short. Not physically shorting DC to ground for DC analysis; only for AC incremental analysis.

Need mention large signal vs small signal "괴리": small signal only valid for sufficiently small variations around Q. If ∆Vin too large, gm changes with VGS, device may leave saturation, output clipped, ro nonlinear. Example: if ∆Vin=200mV not 20mV, linear gain -5 predicts -1V output; actual may not follow because Vout near rail or triode, gm variation. Use Taylor error.

Need include maybe body effect? not central but pitfall.

Need maybe include "병렬 저항 및 옴의 법칙 기반 전류 분배 공식". Provide formulas.

Need include "실제 수치 대입하여 대신호 해석과 소신호 해석 결과 대조". We'll include table.

Need perhaps include lecture OCR weird "Rpd"? Probably RD. Use RD.

Need final output in Korean, no meta. Need ensure complete, no cut. Use headings.

Potential final structure:

# MOSFET 증폭기 학습 요약 노트

## 1. 핵심 질문과 직관적 답변
### Q1. 추가 경로 Rx가 왜 전압 이득을 줄이는가?
... formulas and intuitive current split.
### Q2. 왜 DC 전압원은 AC 접지인가?
...
### Q3. 대신호와 소신호 차이는?
...
### Q4. 다음 단계 연결, Rin/Rout为何重要?
...
### Q5. 전류원/다이오드/디제너레이션 etc? maybe.

Maybe too many Q. But okay.

## 2. 수식과 유도
### 2.1 DC 바이어스와 대신호 관계
### 2.2 gm 정의와 선형화
### 2.3 기본 CS 이득
### 2.4 추가 경로 병렬 부하 이득
### 2.5 전류 분배 수치 예시
### 2.6 AC 접지와 테스트 소스 임피던스
### 2.7 채널 길이 변조, 능동 부하, 다이오드 부하, 디제너레이션

Need maybe combine to avoid huge but still structured.

## 3. 실전 회로 설계 및 시험 활용
### 3.1 이득 저하 방지/버퍼링
### 3.2 소신호 등가회로 5단계
### 3.3 함정 체크리스트
### 3.4 시험 문제 풀이 패턴

Need include tables.

Need ensure all LaTeX valid. Use \parallel maybe $R_D \parallel R_x$. Use $$ ... $$. Need maybe avoid Unicode issues? Korean okay.

Let's draft in detail.

Need maybe mention $R_x$ could be $R_{in,next}$, $r_{o,load}$, bias resistor, probe. If path to $V_{DD}$, since VDD AC ground, path is to ground. If path to another fixed bias voltage, same.

Detailed derivations:

Large signal:
Assume NMOS saturation, λ=0:
$$I_D = \frac{1}{2} k_n' \frac{W}{L} (V_{GS}-V_{TH})^2 = \frac{1}{2}K_n (V_{OV})^2$$
$$V_{OUT}=V_{DD}-I_D R_D$$
If λ:
$$I_D=I_{D0}(1+\lambda V_{DS})$$
$$r_o = \left(\frac{\partial I_D}{\partial V_{DS}}\right)^{-1}\approx \frac{1}{\lambda I_{D0}}$$
Small:
$$g_m = \left.\frac{\partial I_D}{\partial V_{GS}}\right|_Q$$
For square law:
$$g_m=K_n V_{OV} = \sqrt{2K_n I_D}=\frac{2I_D}{V_{OV}}$$
where $K_n=\mu_n C_{ox}W/L$ maybe.

Basic gain with ro:
KCL: $g_m v_{in}+v_{out}(1/R_D+1/r_o)=0$ => $A_v=-g_m(R_D\parallel r_o)$.

With Rx:
$$g_m v_{in} + v_{out}\left(\frac{1}{R_D}+\frac{1}{R_x}+\frac{1}{r_o}+\cdots\right)=0$$
$$A_v=-g_m\left(R_D\parallel R_x\parallel r_o\parallel\cdots\right)$$

Current divider:
If total small-signal current $i_t = g_m v_{in}$ is sunk from node, node voltage magnitude $|v_o|=i_t R_{eq}$. Current through $R_D$:
$$|i_{R_D}|=\frac{|v_o|}{R_D}=i_t\frac{R_{eq}}{R_D}=i_t\frac{G_D}{G_D+G_x+...}?$$ Wait $R_eq/R_D = (1/(Gtot))/R_D = 1/(R_D Gtot)=G_D/Gtot? Since G_D=1/RD, Req=1/Gtot, Req/RD=1/(RD Gtot)=G_D/Gtot. Yes current through RD = i_t G_D/Gtot. For two: $i_RD = i_t R_x/(R_D+R_x)$? Check: conductance divider: current through RD = i_t * G_D/(G_D+G_x)=i_t*(1/RD)/(1/RD+1/Rx)=i_t*Rx/(RD+Rx). Yes. For RD=2k, Rx=1.2k, current through RD =50µA*1.2/(3.2)=18.75µA. Good. Include both formulas.

Numerical table:
Q without extra path:
- $V_{DD}=3.3V$, $R_D=2kΩ$, $I_{DQ}=1mA$, $V_{OUTQ}=1.3V$.
- $\Delta V_{in}=20mV$, $\Delta I_D=50µA$, $g_m=2.5mS$.
- Large new: $I_D=1.05mA$, $VOUT=3.3-2.1=1.2V$, $\Delta VOUT=-100mV$, gain=-5.
- Small: $A_v=-2.5mS*2k=-5$.
With extra path:
- $R_x=1.2kΩ$ (reconstructed), $R_eff=2k||1.2k=750Ω$, $A_v=-1.875$, $\Delta Vout=-37.5mV$ for 20mV. Currents: RD 18.75µA, Rx 31.25µA, sum 50µA. This demonstrates less voltage change.
Need maybe if slide says Vout 1.5->1.4625, mention "출력 DC 바이어스가 1.5V인 슬라이드 예시에서는 1.4625V로 37.5mV만 변화". But if inconsistent, can say "슬라이드의 수치(예: $1.5\to1.4625$V)는 동일한 $\Delta V_{out}=-37.5$mV를 의미한다." Good.

Large vs small table maybe:
| 구분 | 대신호 | 소신호 |
| ... |

Need include "소신호 모델에서 고정 전압 노드 접지" derivation:
Let $v(t)=V_{DC}+v_s(t)$. For ideal DC source $V_{DC}$ constant, $dv=0$. Small signal voltage between node and ground is $v_s=0$. Resistance $r = dv/di=0$. Therefore short. If supply has impedance $Z_{DD}$, then not ground but $Z_{DD}$ to ground. If node is fixed by large capacitor, at midband capacitor is short. If node is bias current source: $i=I_{DC}$ constant, $di=0$, $r=di/dv? Actually incremental impedance = dv/di = ∞, open. Real current source $r_o$ parallel.

Need include "고정 전압원 vs 고정 전류원" because lecture likely only fixed voltage node ground; but students confuse current source.

Practical:
- Buffering: If $R_{in,next}$ comparable to $R_{out,prev}$, voltage divider loss. Use source follower: $R_{out}\approx 1/g_m$ (with degeneration maybe), high input. Use op-amp voltage follower. Use cascode to increase output resistance for gain stage but then for driving low load need buffer. Impedance strategy: voltage amplifier: $R_{in}$ high, $R_{out}$ low. Transimpedance/current amp different.
- Increase effective load: $R_D$ bigger but headroom tradeoff; active load high ro; cascode current mirror. But if load is external, cannot just increase RD; buffer.
- Degeneration: reduce gain intentionally for linearity, set gain by resistor ratio if $g_mR_S\gg1$: $A_v\approx -R_D/R_S$. Good design takeaway.
- For PMOS current source load: gain limited by parallel ro; to increase use cascode, longer L, lower current (higher ro but gm tradeoff). Ensure both transistors in saturation: output swing range.

Small-signal drawing tips:
1. Identify DC supplies and bias nodes. For midband AC: short ideal voltage supplies to ground, open ideal current sources; replace with $r_o$ if nonideal.
2. Capacitors: coupling/bypass large -> short; if low frequency include impedance.
3. MOSFET: gate open (infinite input), source to ground if bypassed; if source resistor unbypassed include it; dependent current source $g_m v_{gs}$ from drain to source; $r_o$ between drain/source.
4. Combine resistances at output. Determine $R_{out,node}$ as parallel of all incremental paths to AC ground. Gain = $-G_m R_{out,node}$ where $G_m$ is effective transconductance from input to output current. For degeneration $G_m = g_m/(1+g_mR_S)$.
5. For loading: insert $R_{in,next}$ as parallel load; for previous source impedance use voltage divider at input.

Pitfalls:
- Forgetting $r_o$ or $R_L$; using $-g_mR_D$ when load attached.
- Assuming $V_{DD}$ open because it's a supply; in AC it's ground if ideal.
- Assuming current source load is short/open incorrectly: ideal current source is open for AC (high impedance), not ground; but its terminal to fixed supply may be AC ground through source? Clarify: A current source connected from VDD to output: VDD is AC ground, current source incremental impedance from output to ground is infinite if ideal, so no shunt; real ro from output to ground.
- Shorting signal sources incorrectly: When measuring Rout, independent voltage sources short, current sources open, but dependent sources remain. If input signal source has internal resistance, keep it.
- Sign: common-source inverts. If source not grounded, $v_{gs}=v_g-v_s$, feedback changes sign/magnitude.
- Large-signal DC changes: adding Rx changes Q-point; must re-bias before small-signal.
- Probe/loading: scope 1MΩ/10-15pF can reduce high-frequency/high-impedance node gain.

Exam patterns:
- "Additional path appears at output" -> draw small-signal, replace other end with AC ground if fixed, compute parallel.
- "What really happens?" -> explain current division and reduced voltage swing.
- "Fixed voltage node?" -> ground.
- "Derive Av, Rin, Rout" -> use test source.
- "Multi-stage gain" -> multiply intrinsic gains with voltage divider factors.

Need maybe include "Rin, Rout definitions" formulas:
$$R_{in} = \left.\frac{v_x}{i_x}\right|_{\text{input test, independent sources off}}$$
$$R_{out} = \left.\frac{v_x}{i_x}\right|_{\text{output test, input source off}}$$
For CS with gate bias: $R_{in}\approx R_G$ (or $R_1||R_2$); MOS gate DC infinite. With source degeneration, input resistance at gate remains high (unless bias), but output resistance increases. For common-drain etc.

Need maybe include "Resistance seen from input" from transcript: maybe $R_x = V_in/I_x$? But not clear. We can keep general.

Need maybe include "Output stage affected? Suppose Vin increased small amount results Vout decrease. We saw similar situation before! Path is added and output voltage magnitude degraded." Use in Q.

Need maybe include "Can you repeat what really happens" with current provided from additional part, original part, total. We can phrase: When output node voltage tries to change, additional path sources/sinks current opposing change. If output node falls, current through path changes in direction that supplies part of the increased NMOS drain current, so original RD has to change less current, hence less voltage drop change. This is like loading.

Need maybe discuss "additional path current can be from a PMOS current source or next stage". If Vin increases, NMOS pulls more current, output falls. The extra path (e.g., resistor to VDD) then provides more current due to increased voltage across it? Actually if output falls, resistor to VDD has larger voltage drop, so current through it increases, helping supply the extra NMOS current. Thus RD current change less? Wait RD is also resistor to VDD. If extra path is another resistor to VDD, total pull-up conductance bigger. For same NMOS current increase, output only needs to fall enough for the combined pull-up resistors to increase current by that amount. So smaller fall. Good.

Need include "병렬 저항: 같은 전압이 걸리므로 전류는 저항에 반비례".

Potential issue: In small-signal, if $R_x$ is from output to ground, then output resistance lower. If $R_x$ is from output to $V_{DD}$, VDD AC ground. If to another supply, ground. If to a node with signal $v_y$, current is $(v_o-v_y)/R_x$; then not just parallel; can produce feedback or feedthrough.

Need maybe include "effective voltage transfer ratio changed by Rin/(Rin+Rout)" from slides. Use formula.

Need maybe include "Gain is not everything. Rin and Rout matter significantly." Good.

Need maybe include "Multiple Stage Gain" formula. Use:
$$A_{v,total} = A_{v1}^{(oc)} \frac{R_{in2}}{R_{in2}+R_{out1}} A_{v2}^{(oc)} \frac{R_{in3}}{R_{in3}+R_{out2}} A_{v3}^{(oc)} \frac{R_L}{R_L+R_{out3}}$$
if final load. Maybe include source resistance factor at input: $v_{in1}=v_s R_{in1}/(R_{in1}+R_s)$. Good.

Need maybe include "CS amplifier with ideal current source" question:
- Role of current source is bias. In small-signal, ideal current source has infinite impedance, so if it replaces RD as load, the small-signal load resistance becomes very large; gain ideally very large, practically limited by $r_o$ of transistor and current source. If current source is connected to fixed supply, the supply end is AC ground, but the current source itself is not a short; it is an open/incremental high resistance.
- PMOS current source load: if gate bias fixed and source at VDD AC ground, $v_{sg}=0$ small-signal, so no $g_m$ current; only $r_{op}$ from drain to source. So load is $r_{op}$.

Need maybe include "Diode-connected load" because slides. Derive resistance seen from source? Actually slide says "resistance of M2 seen from source" maybe for source follower? But diode-connected load usually from drain. We can derive general. For diode-connected MOS (gate tied to drain), looking into drain (or source if source is output? Need be careful). In a CS with diode-connected PMOS load, load resistance at output is $1/g_{m2}$ parallel $r_{o2}$. If asked "seen from source" of diode-connected device? For a diode-connected transistor with gate and drain tied to a fixed node, looking into source gives $1/g_m$ maybe? Actually source follower output resistance looking into source with gate/drain AC ground is $1/g_m$ (if body effect ignored). Slide has equations: $R_x = V_x/I_x$, $-g_m V_x = -I_x$, $V_o = I_x? $ maybe. Could be deriving source resistance of diode-connected load? Let's parse OCR: "CS Stage w/ Diode-Connected Load • Can you derive the resistance of M2 seen from source? [그림] VDD / V_out / M2 / M1 / Vin_o / Vo (from Diagram) / Rx (from Diagram) = 1/ gm ... -V_x = íx ... V_o = íx ... gm_o = í ... V_x = íx + V_output ... ΔV_x ≈ ΔV_o ..." Hmm maybe they derive small-signal resistance looking into source of a diode-connected transistor is 1/gm. But in a diode-connected load (gate/drain to VDD?), if PMOS gate and drain connected? Wait CS stage with diode-connected load: PMOS M2 gate and drain connected to output? Actually diode-connected PMOS load has gate and drain tied together at output, source to VDD. Then looking into drain (output) from node to VDD gives 1/gm. If "seen from source" maybe source is output? Maybe not. But standard result: diode-connected MOS small-signal resistance between drain/source (with gate tied to one terminal) is 1/gm (if ro ignored). We'll state both: looking into drain/source of diode-connected device with the other terminal AC ground yields ~1/gm. Use generic test derivation: if gate and drain shorted and source is test node? Let's not overcomplicate. State: A MOS with gate and drain shorted behaves as a resistor of approximately $1/g_m$ between the shorted node and source (or between source and shorted node, depending on which terminal is output), ignoring body effect and $r_o$. Include ro: $1/(g_m+g_{mb}+1/r_o)$ if body effect. For PMOS load, load resistance $\approx 1/g_{m2}$.

Need maybe include "Degeneration output resistance example with M1 and M2 identical" maybe not necessary. But to be complete, include formula for output resistance with source degeneration:
Looking into drain of transistor with source resistance $R_S$ and $r_o$:
$$R_{out} \approx r_o \left(1+g_m R_S\right) + R_S$$
if $g_m r_o \gg1$, or more exact $R_{out}=r_o + R_S + g_m r_o R_S$ (assuming body effect ignored and gate AC ground). If there is degeneration transistor M2 etc. For CS stage with degeneration and load $R_D$, output node includes $R_D$ in parallel with this. If M1/M2 identical maybe $R_{out}\approx 2r_o + ...$? Not enough. Could mention test-source method rather than exact example.

Need ensure no false statements. For source degeneration output resistance exact with gate grounded: apply vx at drain, source voltage vs = ix? Let's derive: MOS small-signal with ro, gm vgs, source resistor RS to ground, gate AC ground. Test voltage vx at drain, current ix entering drain. vgs = -vs. KCL at source: current through RS = vs/RS leaving source to ground. Currents entering source from ro and dependent? Need signs. Standard result looking into drain: $R_{out}=r_o + (1+g_m r_o)R_S$ (if body effect ignored). Yes = r_o + R_S + g_m r_o R_S. Good. If $R_S=0$, ro. If ro∞ and RS? infinite? With ideal current source? okay. If $R_D$ present, total Rout = R_D || that. For λ=0, ro∞? Actually if λ=0, looking into drain of ideal MOS with source resistor is infinite? In simple model current source controlled by vgs; if gate grounded and source resistor, applying vx doesn't change id? Let's see λ=0, ro open, dependent source current = gm vgs = -gm vs. Source node current from dependent source enters? KCL gives vs? If no ro, drain current independent of drain voltage, so output resistance infinite if source resistor? But in common-source with source degeneration and finite RD, output resistance at drain node includes RD; transistor itself high. However if source bypass? infinite. But in practical with ro finite, increased. The lecture says "Output Resistance? When λ=0, it is simple. But what if λ≠0?" likely when λ=0 Rout=R_D maybe. If looking from output including RD, yes Rout=R_D because transistor drain looks open (current source). With λ≠0, ro in parallel; with degeneration ro boosted. We can state.

Need maybe include "CS Amp w/ Ideal Current Source" gain: If load is ideal current source, incremental load infinite, so gain infinite in ideal model; with ro, $A_v=-g_m r_o$ (or -gm(roN||roP)). If PMOS current source, output resistance of PMOS current source is $r_{op}$, NMOS output resistance $r_{on}$, gain $-g_{mn}(r_{on}||r_{op})$. If source degeneration, effective gm lower.

Need maybe include "Input resistance/output resistance measured by test source" in math.

Need maybe include "Fixed voltage node ground" with examples: 3.3V, 3.9V, 4.5V, 6V all AC ground if ideal. The slide has currents with different supplies and resistors maybe showing added parallel paths. We can say any fixed bias node is AC ground; resistors connected to those nodes become connected to ground in AC.

Need maybe include "Additional path reduces voltage change" intuitive with conductance. Maybe use Norton equivalent: transistor small-signal is current source $g_m v_{in}$ in parallel with output conductance. Load is resistance. Output voltage = current × resistance. Adding path increases conductance, reduces resistance. This is central.

Need maybe include "what really happens" in large signal: Suppose Vin increases, NMOS current increases. Without extra path, extra current must come through RD, causing larger voltage drop across RD and lowering Vout. With extra path, some extra current comes from/through extra path, so RD current changes less, voltage drop changes less, Vout changes less. Therefore gain lower. Good.

Need maybe include mathematical derivation of current division in large signal? For resistor to VDD: $I_{RD}=(VDD-Vout)/RD$, $I_{Rx}=(V_{fixed}-Vout)/Rx$. KCL at output: $I_D=I_{RD}+I_{Rx}$ (depending directions). Differentiate:
$$dI_D = -dVout(1/R_D+1/R_x)$$? Let's derive signs: If NMOS drain current increases (positive dID), output voltage decreases (dVout negative). Current through RD from VDD to node = (VDD-Vout)/RD. Its incremental change dI_RD = -dVout/RD (positive if Vout falls). Extra path similarly. KCL: dI_D = dI_RD + dI_Rx = -dVout(1/RD+1/Rx). Thus $dVout = -dI_D /(1/RD+1/Rx)= -g_m dVin (RD||Rx)$. This is a nice large-signal differentiation bridging. Include.

Need maybe include sign conventions clearly.

Need maybe include table for currents with sign? Use magnitudes to avoid confusion.

Need maybe mention "소신호 선형화 근사 오차" formula with $V_{OV}$. For square-law:
$$\frac{\Delta I_{D,exact}-g_m\Delta v}{g_m\Delta v}=\frac{\Delta v}{2V_{OV}}$$ for positive change. If $V_{OV}=0.2V$, ∆=20mV, error 5%; if ∆=2mV, 0.5%. This helps. But if using numbers gm=2.5mS, ID=1mA