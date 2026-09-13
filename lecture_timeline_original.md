[00:38] Gain Reduction due to Additional Path? / [그림] 왼쪽 그림은 MOSFET과 저항 Rd가 연결된 회로를 나타낸다. 입력电压 Vin이 있고, 출력电压 Vout이 있다. 오른쪽 그림은 MOSFET과 저항 Rpd가 연결된 회로를 나타낸다. 입력电压 Vin이 있고, 연결된 MOSFET을 통해 출력电压 Vout이 나온다.
[00:38] [음성] 여기서 또 다른 x가 추가된다면, 그러면 여기가 지금 3.3%라고 했을 때, 예를 들어서 저렇게 저렇게 하는 방법을 들었을 때, 얘가 과연 개인이 어떻게 바뀌는다고 했을 때, 개인이 줄어든다고 했고, 그 값은 이렇게 바뀌는다고 했어요. 그래서 이렇게 바뀌는 뭐냐면, 내가 원래 저녁에 예만 궁금해 줬는데, 이 패스로 같이 궁금해 줬어서, 우리가 돌려가, 원래 여기서 50mAh가 추가가 되었다면, 근데 지금 50mAh가 40mAh가 줄어드릴 수도 있는 거잖아요. 그래서 여기에서 볼치다운이 덜 된다.
[01:19] [음성] 제가 여기 50mm가 추가적으로 공급되는 걸 원래 50mm가 얘가 쏠리 훈련을 혼자서 다닫던 걸 60mm가 나눠서 한다면 내가 이거 알디의 전화 차이가 원래는 이 전류 변화에서 50mg이 밝은 전화가 이 발생했던 게 40mg이 밝은 정도로 전화 차이가 더 줄어들어서 마치 이 무슨 일이냐면 윙인이 올라갔을 때 우리가 혹시 덜 떨어지는 것 같더라. 하지만 그래서 개인이 더 줄어든 것 같더라. 이런 식으로 생각하면 해. 그니까 그냥 스모시가 나를 모델로 하면 어차피 여기 알디가 알디가 이렇게 바뀌는 거잖아요. 스모시가 나를 모델로 그러면 알디가 알디가 알겠습니다.
[01:59] Gain Reduction due to Additional Path?
 / [그림] NMOS 트랜지스터 회로 /
V_DD / R_d / V_out / ₇ V_in /
 / [그림] 추가 경로에서의 임피던스 분석 / 
V_out / 2V / R_d / 10mA / 40mV / V_in / ₇ V_in / ₇ V_out / 2V / R_x / ₇ 10mV / -g(m/Rx) /
 / [그림] 전체 회로 분석 / 
V_DD / R_d / V_out / R_d / ₇ V_in /
 / [그림] 추가 경로 이후 저항 R_d와 R_x의 개념적 연결 / 
R_d / R_d (|| Rx) /
[01:59] [음성] 그러면 알드드시아 알겠습니다만 그냥 죽어든거 알 수 있잖아요. 알죠. 근데 여러분. 그렇게 해봐. 10월 10월 모델로 그냥 KVAC에서 그냥 10월 그냥 가다드리면 말고 내가 해봐요. 무슨 일 일어나는 질 좀 이해하시면서 제가 여기 드리브는 패스가 이렇게 일어나서 하고 그래서 따라서 여기서 전화 및 적게 변하는 것에 대한 어떤 패션이 드셔를 좀. 제가 그걸 말씀드린 거고 그걸 이제 좀 다시 한번 살펴볼게요. 이제 없어서 제가 여기 여러분 이 패러로 정해 대해서 좀 좀 안으신 분들 있어서 굉장히 기초적인 내용을 다시 한번 조금 다루게요. 제가 오늘 한 번 해봐요.
[02:29] Parallel Resistor / [그림] 왼쪽에는 저항 $V_{x1} / I_x$가 세로로 표시되어 있고, 오른쪽에는 저항 $V_{x2} / I_x$가 세로로 표시되어 있다.
[02:34] Parallel Resistor / [그림] 두 개의 저항이 병렬로 연결되어 전압 V_y = 5V가 가해지고 각각의 별도 위치에 적은 별도 전압 V_x1과 별도 전류 I_x의 흐름이 나타나고 있다.
[02:39] [음성] 이 점이 1.2m가 들어간다면 1.2m가 들어간다고 하면. 여러분 어때요? 여기 걸린 전화비가 1.2m가 1.2m가 2.2m가 들어간다고 하면. 여기가 1.2m가 1.2m가
[03:19] [음성] 이 비수도 볼 때 여기서 여기들은 전류가 아니라 전류가 다를텐데 오무째에서 이 케이크 파괴가 아니라 똑같아야 되는 것 같아요. 그 벽렬한 정리가 되잖아요.
[03:59] [음성] 이 정도의 정보를 이렇게 정해진 것입니다.
[04:09] Parallel Resistor / [그림] 텍스트는 병렬 저항 회로를 설명하고 있습니다. 왼쪽은 간단한 회로도이며, 오른쪽은 병렬 회로에서의 전류 분배를 나타내는 그림입니다. / Vy = 5V © / Vx1 / Ix 1mA / Vy = 5V / I_k = (5kΩ) / I_2 = 2kΩ / Ix / Vx2 / Ix 1.0mA / 5V - 2kΩ / = 5V - 4kΩ
[04:39] [음성] 1.5.0.0.
[04:40] VDD = 3.3V / RD = 2k / VIN = 1V → 1.02V / Vout = 1.3V → 1.2V / Id = 1mA → 1.05mA / Small Signal Model vs. What Really Happens / [그림] 왼쪽 부분은 MOSFET 소자의 차동 증폭 회로를 나타내고 있으며, 입력 전압(VIN)에 따른 출력 전압(Vout)과 전류(Id)의 변화를 보여준다. / 오른쪽 부분은 MOSFET 소자의 실제 동작을 나타내고 있으며, 입력 전압(Vin)에 따라 기판 전압(Vgs)이 변하고, 기판 전류(Igmo)가 형성되어 출력 전압(Vout)과 전류(Id)를 제어한다. / Vout = 1.3V → 1.2V / RD = 2k
[05:19] [음성] 이 정도면 이 정도면
[05:35] Small Signal Model vs. What Really Happens / [그림] (작은 신호 모델과 실제 발생하는 일의 차이)
VDD = 3.3V / 1mA x 2kΩ ≈ 2V / 1.05mA x 2kΩ ≈ 2.1V / Vout = 1.3V ~ 1.2V / Id = 1mA ~ 1.05mA / 2k Ω / 50mA / Vin = 1V ~ 1.02V / [그림] (커패시터, 저항, 소스, 입력, 출력의 구성 요소가 있는 회로 동작 모델)
[05:45] VDD = 3.3V / 1.0mA x 2kΩ = 2V / 1.05mA x 2kΩ = 2(-1V) / Vout = 1.3V ~ 1.2V / Rd = 2kΩ / VIN = 1V → 1.02V / Id = 1mA → 1.05mA / Vgs = / vg / gm / Vout = / Rd = 2kΩ /

 Small Signal Model vs. What Really Happens
[05:59] [음성] (믿는 소리)
[06:40] [음성] 이 점이 안 배우면 1,200만 원을 받으면 1,200만 원을 받으면 1,200만 원
[06:50] In Small Signal Model, Fixed Voltage Node is just Ground / [그림]
[07:20] [음성] 그러면 각각 예전에 저를 어떻게 부어야 하는 걸까요? 제가 지금 올렸어요.
[08:00] [음성] 이 정도면 이 정도면
[08:01] In Small Signal Model, Fixed Voltage Node is just Ground / [그림] 작은 신호 모델에서는 고정 전압 노드가 접지일 뿐이다.
→ 918.75μA → 609.375μA → 506.25μA
3.3V 3.9V 4.5V 6V → 302.5μA
900μA 600μA 500μA 300μA
I<sub>B</sub> = 1000μA / [그림] IB = 1000μA
V<sub>in</sub> = 1.5V / [그림] Vin = 1.5V
100μA 1050μA 4k 500μA -1.7 4k -3.5
790.825μA -496.25μA
V<sub>out</sub> = / [그림] Vout =
[08:06] In Small Signal Model, Fixed Voltage Node is just Ground / [그림]

→ 918.75µA → 609.375µA → 506.25µA
3.3V 3.9V 4.5V 6V → 302.5µA
900µA 600µA 500µA 300µA
/ [그림]

V_out = 1.5V
/ [그림]

V_in =
/ [그림]

V_gs
Gm V_gs
[08:39] [음성] 이 점이 그러면 100만원. 이 점이 그러면 100만원. 이 점이 그러면
[09:11] In Small Signal Model, Fixed Voltage Node is just Ground / [그림]

3.3V / [그림]
3.9V / [그림]
4.5V / [그림]
6V / [그림]

Vin = / [그림]

Vout = / [그림]
[09:19] [음성] 이 기업은 20만 명이 될 것 같아요.
[09:59] [음성] 다음은 다음은
[10:07] In Small Signal Model, Fixed Voltage Node is just Ground / [그림]
[10:39] [음성] (믿은 소리)
[10:57] Added Path Reduces Voltage Change / [그림]
VDD = 3.3V / [그림]
Rd = 2k / [그림]
Vout = 1.3V / [그림]
Vin = 1V / [그림]
Id = 1mA / [그림]
Gain = -gm Rd / [그림]

/

3.3V / [그림]
3.9V / [그림]
4.5V / [그림]
6V / [그림]
900μA / [그림]
600μA / [그림]
500μA / [그림]
300μA / [그림]
2k / [그림]
4k / [그림]
6k / [그림]
15k / [그림]
1000μA / [그림]
800μA / [그림]
500μA / [그림]
-1.7V / [그림]
-3.5V / [그림]
Vout = 1.5V → 1.4625 / [그림]
Gain = -gm (R1/R2 / R3 / R4 / R5 / R6) / [그림]
[11:19] [음성] 이 부분은 전류가 되었다고 생각해요.
[11:32] In Small Signal Model,
Fixed Voltage Node is just Ground / [그림]

+0.972V + Comp / [그림] 2.15μA
-0.972V + Comp / [그림] 609.375μA ≈ 506.25μA
V_in = +20mV / [그림]
3.3V / [그림] 3.9V / [그림] 4.5V / [그림] 6V / [그림] 302.5μA
900μA / [그림] 600μA / [그림] 500μA / [그림]
1.5V / [그림]
V_out = / [그림]
V_out = / [그림]
-1.7V / [그림] -3.5V / [그림]
V_gs = 1.5V / [그림] 
gm_Vgs = +50μA / [그림]
-100mV / [그림]
50μA / [그림]
/ [그림] 2kΩ
[11:42] Added Path Reduces Voltage Change / [그림]

VDD = 3.3V / [그림]
Rd = 2k / [그림]
Vout = 1.3V / [그림]
Vin = 1V / [그림]
Id = 1mA / [그림]

Gain = -gm * Rd / [그림]

 / [그림]
3.3V 900µA 2k 
3.9V 600µA 4k 
4.5V 500µA 6k 
6V 300µA 15k 
Vout = 1.5V -> 1.4625 / [그림]
10k

 / [그림]
Vin = 1V 800µA -1.7V
/ 
Gain = -gm * (R1/R2/R3/R4/R5/R6) / [그림]
[11:47] In Small Signal Model, Fixed Voltage Node is just Ground / [그림] 이 그림은 작은 신호 모델에서의 고정 전압 노드가 접지임을 나타낸다.

Vin = +20mV / [그림] 이 주 입력 전압이 +20mV임을 나타낸다.

Vout = -37.5mV / [그림] 이 주 출력 전압이 -37.5mV임을 나타낸다.

gm_Vgs = +50μA / [그림] 이 gm_Vgs 값이 +50μA임을 나타낸다.

0.  0mV / [그림] 이 Vout이 신호에서 떨어진 크기임을 나타낸다.

-100mV / [그림] 이 다른 입력 신호의 크기를 나타낸다.

50μA / [그림] 이 다른入力 신호의 전류 크기를 나타낸다.

2kΩ / [그림] 이 다른入力 신호의 저항값을 나타낸다.
[12:00] [음성] 이걸로 그냥 이걸로 그냥 정한다고 이렇게 패러로 하고 만들어서 당하라고 생각하고 있는거에요. 이걸로 그냥 정한다고 이렇게 패러로 하고 만들어서 당하라고 생각하고 있는거에요. 이걸로 그냥 정한다고 이렇게 패러로 하고 있는거에요. 이걸로 그냥 정한다고 이렇게 패러로 하고 있는거에요. 이걸로 그냥
[12:17] Added Path Reduces Voltage Change / [그림: 두 개의 회로를 비교하는 그림이 표시되어 있다. 왼쪽 회로에는 MOSFET과 저항이 연결되어 있고, 오른쪽 회로에는 MOSFET과 다양한 저항들이 연결되어 있다.] VDD = 3.3V / Rd = 2k / Vin = 1V / Id = 1mA / Gain = -gmRd /  / 3.3V 900µA 2k / 3.9V 600µA 4k / 4.5V 500µA 6k / 6V 300µA 15k / Vout = 1.5V -> 1.4625 / Vin = 1V / Id = 1000µA / Gain = -gm(R1//R2//R3//R4//R5//R6)
[12:32] Channel Length Modulation Consideration in Large Signal Model / Id = 1/2 μCoxL (VGS - VTH)² (1 + λVDs) / = 1/2 μCoxL (VGS - VTH)² + λVDs 1/2 μCoxL (VGS - VTH)² / = Id0 + λId0 × VDS = Id0 + 1/r0VDS / [그림] MOSFET의 전류 모델을 두 가지 형태로 보여준다. 왼쪽에서 λ ≠ 0일 때의 모델이고, 오른쪽에서 λ = 0일 때의 모델이다. /
[12:40] [음성] 이 부분은 이 부분은
[13:02] Channel Length Modulation Consideration in Large Signal Model / Id = (1/2)μCoxL (VGS - VTH)² (1 + λVDS) / = (1/2)μCoxL (VGS - VTH)² + λVDS (1/2)μCoxL (VGS - VTH)² / = ID0 + λDO VDDS / λ0 / IDO + λDO VDDS / λ0 / λ ≠ 0 / [그림] MOSFET의 차단된 상태(λ=0)와 활성화된 상태(λ≠0) /
[13:12] Channel Length Modulation Consideration in Large Signal Model / Id = ½ μCoxL (VGS – VTH)² (1 + λVDS) / = ½ μCoxL (VGS – VTH)² + λVDS ½ μCoxL (VGS – VTH)² / = ID0 + VDS / Io / Io0 + VDS / rD / [그림] CMOS 트랜지스터의 전압-전류 특성 표기법: 왼쪽에는 채널 길이 변조가 발생하지 않는 상태(λ ≠ 0), 오른쪽에는 채널 길이 변조가 발생하지 않는 상태(λ = 0)에서 병렬 저항 ro가 추가된 상태
[13:17] Channel Length Modulation Consideration in Large Signal Model / Id = 1/2 μCox L (VGS - VTH)² (1 + λVDS) / = 1/2 μCox L (VGS - VTH)² + λVDS 1/2 μCox L (VGS - VTH)² / = Id0(VGS - VTH)² + λVDS / ID0 + 1/r0 / λ ≠ 0 / [그림] MOS 트랜지스터의 채널 길이 변조 모델 / λ = 0 / [그림] MOS 트랜지스터의 채널 길이 변조가 없는 모델
[13:20] [음성] 이 영상은 이 영상이 되었다고 생각해요.
[13:53] ID = 1/2 μCox L (VGS – VTH)² (1 + λVDS)
= 1/2 μCox L (VGS – VTH)² + λVDS 1/2 μCox L (VGS – VTH)² / rD
= ID0 + 1/rD
[그림] MOSFET 소자를 나타낸 그림과 저항로드를 나타낸 그림을 같다고 표현하고 있습니다.
[14:00] [음성] (모두는 소리)
[14:03] Gain of CS Amplifier / 
• w/ and w/o channel length modulation / 

[그림] CS 증폭기의 클램프 전류가 0일 때와 클램프 전류가 0이 아닐 때의 회로도
[14:39] [음성] 여기서 여기에서 VGS에서 지금 VGS에 변한 게서 증가하는 그런 대응을 얘도 공폐해 주고 얘도 공폐해 주고. 그렇기 때문에 원래 여기서 변하던 전압 대비 여기서 변하던 전압이 더 주로. 얘가 보호전 전류향이 더 다가져버리니까 이렇게 얘를 하시면 되겠어. 그래서 얘를 하시고 얘를 하시고 얘를 하시면 되겠어. 그러면 다시 그 과거 장렬을 더 강하게 저를 보러가서 강렬하겠습니다. 그래서 슬라이드 구울이 보시면 될 것 같고요. 슬라이드 구울이 보시면 될 것 같고요. 자 뭐야? 엠플립 바요. 어쨌든 뭐야 엠플립 바요는 제가 이걸 왜 계속 설명해 나면
[15:08] Input Resistance and Output Resistance /
• Input resistance, Rin is measured by /
[그림] Circuit B /
• Output resistance, Rout is measured by /
[그림] Circuit A
[15:13] Amplifier Will Be Connected with Other Circuits! / • Not only amplifier, but in any device, circuit, system, architecture accepting input and generating output, / • You should be aware of that / • Input of current circuit is from the something else's output / • Output of the current circuit will be connected to the something else's input / • Then, you should be questioning about: / • Is there any change or effect on output voltage according to the circuit which connected to the output node? / [그림] Circuit A와 Circuit B가 연결되어 있으며, Circuit A의 출력이 Circuit B의 입력으로 연결되어 있습니다.
[15:18] Can You Repeat "What Really Happens" / λ ≠ 0. / 7/2/cami. / OPEN additionally exists / (1) Current provided from additional part / (2) Current provided from original part / (3) Iт from original part / 4 V(t) / 5 Q(t) / Gain / 100mA / 80mA / 1mA / 1.14mA / Ro / Vin = 1 V + 0.2V / Vout = -100mV / -4 / Vout = -80mV / / [그림] 이 그림은 입력 전압(Vin)이 1V + 0.2V인 트랜지스터 회로의 입력과 출력을 나타내는 회로도다. / / [그림] 입력 전류가 1.14mA인 트랜지스터 회로의 입력과 출력 전압을 나타낸다.
[15:19] [음성] 이 컨셉이 필요한 것 같아요. 다른 애들이랑 섞이시죠. 여러분, 이런 식으로 이쁘면 안 되고 다양한 성격이 필요한 것 같아요. 다른 애들이랑 섞이시죠. 다른 애들이랑 섞이시죠. 다른
[15:23] Amplifier Will be Connected with Other Circuits! / Not only amplifier, but in any device, circuit, system, architecture accepting input and generating output, / You should be aware of that / Input of current circuit is from the something else's output / Output of the current circuit will be connected to the something else's input / Then, you should be questioning about: / Is there any change or effect on output voltage according to the circuit which connected to the output node? / [그림] Circuit A와 Circuit B가 연결되어 있고, Circuit B의 출력 노드가 다른 회로의 입력에 연결되는 것을 나타낸 다이어그램
[15:59] [음성] 지금 현재 배로가 있는 것 같아요.
[16:39] [음성] 그러면 인정상에 여러분 이런 질문을 할 수 있어야 되는거에요 지금 내가 만들어낸 해보이잖아요 지금 아무도 여기 안 됐으면 개인이 말해서GM 알리라서 내가 VIN 들어오면 VIN 지금 들어오면 다 좋아해 VIN 들어올께 그러면 VIN 아웃이 들어올 때 이 말해서GM 알리만 개인으로 이렇게 버티가 되잖아 나가면 내가 나가면 내가 아웃이 아웃이
[17:20] [음성] 내가 지금 출염를 하는 섭취에서 뭐냐에다 박힐 수가 있어요. 뭐냐에다 박힐 수가 있어요. 뭐냐
[17:49] At Output Stage, / How is it affected? Suppose that V_in is increased by small amount, which results in V_out decrease. / We saw similar situation before! / Path is added and output voltage magnitude is degraded. / [그림] MOSFET 기반 출력 단계의 회로 구성도
[18:00] [음성] 그러면 제가 석키크림이 있을 때는 여기가 minusgm, idg8gv, mkv, mkv,
[18:40] [음성] (너는 이 상황이 없어서 이 상황이 없어서
[19:20] [음성] (끝끝�
[19:59] [음성] 이 부분은 어떻게 발견이 되는 거죠?
[20:39] [음성] (돌려 비행기)
[21:19] [음성] 이 아이스크림이 비쌤의 레이저을 그냥 보면 여기 뭐 저항이 있는 거잖아요. 이 비쌤이 정신을 가지고 여기 가지고 우리지에 관광을 주장해 주면 됩니다. 그래서 어떤 것들은 도대체 제가 여기 주류를 연결해서. 그 정도에서 보이는. 보이는 저항처럼 동작하는 거잖아요. 그 정도에서 보이는 저항을 가지고. 그 정도는 여러분 저항이 있는 것들은 이렇게 해서 보이시는데요. 보이는 저항을 보이는 저항을 보이는 저
[21:36] At Output Stage, / How is it affected? Suppose that VIN is increased by small amount, which results in Vout decrease. / We saw similar situation before! / → Path is added and output voltage magnitude is degraded. / [그림] 저항 Rx와 입력 저항을 나타내는 그림
[21:46] At Output Stage, / How is it affected? Suppose that Vin is increased by small amount, which results in Vout decrease. / We saw similar situation before! / Path is added and output voltage magnitude is degraded. / Input resistence / Input resistance / Input / Resistance "seen" from Input /
[21:51] At Output Stage, / How is it affected? Suppose that V_in is increased by small amount, which results in V_out decrease. / We saw similar situation before! / Path is added and output voltage magnitude is degraded. / [그림]
[21:59] [음성] 이 x브에이스에 생기는 이 x브에이스에 벌싶은 거죠? 무슨 말이에요? 보세요. 이 x브에이스에 벌싶은 거죠. 이 x브에이스에 벌싶은 거죠. 이 x브에이스에
[22:40] [음성] 내가 x를 빌려 보냈다니. 여기 저한테 전화가 열나로 제정하면 이 x을 볼 수 있는 거잖아요. 그래서 왜냐하면 이 x는 x5xx는 vx라는 5mph이 되는 1mph. 이렇게 볼 수 있으니까. 자 x을 빌려면 여기서 잡혀서 빌려가저면 되고. 그래서 그 x는 x6. 그래서 x6. 그래서 x6. 그러면 내가 x6. 빌려. 빌려. 빌려
[23:20] [음성] (끝끝�
[24:00] [음성] 그래서 이 골에서 과학에 좀 어떻게 밀지카나죠? 그러면 만약에 이 프레스는 어떻게 돼요? 아우! 그러면! 여러분! 이 알림한 보이지! 이 알림한 보이지! 이 알림한 보이지 않아요! 이 알림한 보이지! 이 알림한 보이지! 이 알림
[24:27] At Output Stage, / 
- How is it affected? Suppose that Vin is increased by small amount, which results in Vout decrease. / 
- We saw similar situation before! / 
→ Path is added and output voltage magnitude is degraded. / 
[그림] / Circuit B를 나타낸 그림
[24:40] [음성] 이번에는 여러분 제가 이 콘서트 앱을 받으러 가보자면 무슨 말이냐 하면 제가 이렇게 이렇게 해줄 수 있다고요. 그리고 더 석퇴 비용가 됐어. 이렇게 됐어. 그러면 콘서트 앱을 받으러 지금 이렇게 하는게 아니라 제가 게임만 좋아진 거예요.
[24:52] At Output Stage, / How is it affected? Suppose that V_in is increased by small amount, which results in V_out decrease. / We saw similar situation before! / Path is added and output voltage magnitude is degraded. / [그림] 특정 회로 구성에 따른 입력 저항 및 출력 저항을 나타내는 다이어그램
[24:57] At Output Stage, / How is it affected? Suppose that Vin is increased by small amount, which results in Vout decrease. / We saw similar situation before! / Path is added and output voltage magnitude is degraded. / [그림] 논의하는 회로의 출력 단계에서 입력 신호의 작은 증가가 출력 전압 감소로 이어지는 경우를 설명하고 있습니다. 또한 이와 유사한 상황을 과거에 경험했으며, 이를 통해 출력 전압의 크기가 저하되는 경로 추가를 알 수 있습니다.
[25:20] [음성] 이 부분은 이 부분은
[25:59] [음성] 아우씨가 지금 간단하게 스프라이 드러나오는 거예요. 아우씨가 지금 아우씨가 지금 간단하게 스프라이 드러나오는 거예요. 아우씨가 지금 아우씨가 지금 아
[26:39] [음성] 이 부분은 이 부분을 만들어서 볼티로. 이 부분은 이 부분을 만들어서 볼티로. 이 부분을 만들어서 볼티로. 이 부분은 이 부분을 만들어서 볼티로. 이 부분은 이 부분을 만들어서 볼티로. 이 부분을 만들어서 볼티로. 이 부분
[27:19] [음성] 이 부분은 이 부분은
[27:22] At Output Stage, /
* How is it affected? Suppose that Vin is increased by small amount, which results in Vout decrease. /
* We saw similar situation before! /
→ Path is added and output voltage magnitude is degraded. /
/ [그림] MOSFET 기반 출력 소자에서의 출력 전압 변화와 출력 회로 변경을 나타내는 도표. 출력이 감소하는 이유를 설명하고 있다. /
[28:00] [음성] 이 정도면 이 정도면
[28:28] At Output Stage, / How is it affected? Suppose that V_in is increased by small amount, which results in V_out decrease / We saw similar situation before! / Path is added and output voltage magnitude is degraded. / Input resistance / Input / -q_in / (R_in + 1) / Circuit B / V_out / V_in / Circuit B / R_x / R_x = -Rsin / R_x = V_in / V_out + 1 / R_x = V_in / V_out / Resistance seen from Input / 10
[28:40] [음성] 이 정도면 이렇게 하면 되겠지?
[29:13] In General, /
* When output is voltage, and input is voltage, /
[그림] 회로 A와 회로 B가 점선으로 연결된 두 개의 상자 다이어그램 /
* Gain is changed by /
* Or, effective voltage transfer ratio is changed by
[29:20] [음성] 이 정도면 이 정도면
[30:00] [음성] 이 기계란과 섭취자의 연편이고요. 이 기계란과 섭취자의 연편이고요. 이 기
[30:28] In General, 
* When output is voltage, and input is voltage, 
/ [그림] 회로 A와 회로 B가 연결되어 있고, 회로 A의 출력은 회로 B의 입력에 연결되어 있을 수 있다. 회로 A와 회로 B 사이의 임피던스 관계를 보여준다.
* Gain is changed by 
/ [그림] 회로 A의 출력 전압(Vout)과 회로 A의 입력 전압(Vin) 사이에 저항(Rout)이 있고, 회로 B의 출력 전압(Vout)과 회로 B의 입력 전압(Vin) 사이에 저항(Rin)이 있다. 두 저항의 비율을 나타내는 식을 보여준다. 
/ Or, effective voltage transfer ratio is changed by 
/ [그림] 이 절연된 모듈의 그림과 각 모듈에 연결된 입력과 출력, 게인(Gain) 문구를 연결하고 있고, 분모에는 저항 Rout이, 분자에는 저항 Rin이 있고, 변하는 표기법(예: 굵은 글씨)을 이용한다.
[30:40] [음성] 이 부분은 이 부분은 부분은 이 부분은 이
[30:59] Input Resistance and Output Resistance /
• Input resistance, Rin is measured by / Circuit B /
• Output resistance, Rout is measured by / Circuit A /
[31:20] [음성] (끝끝�
[31:59] Input Resistance and Output Resistance / Impedance / Input resistance, Rin is measured by / [그림] Circuit B / Output resistance, Rout is measured by / [그림] Circuit A
[32:00] [음성] 이 정도면 이 정도면
[32:40] [음성] 여기가 0을 경렬해야 돼요. 여기가 3부터가 있으면 Vs-Vs-V
[33:19] Multiple Stage Gain? / How can you derive it? Vout/Vin. / Gain is not everything. Rin and Rout matter significantly. / [그림] 세 개의 증폭기 (A1, A2, A3)가 직렬로 연결된 회로도를 보여준다. 입력 신호 Vin이 첫 번째 증폭기 A1에 연결되고, 출력 신호 Vout이 세 번째 증폭기 A3에서 나온다. 각 증폭기 사이에는 적절한 저항(Rin, Rout)이 연결되어 있다.
[33:20] [음성] (끝끝�
[34:00] [음성] 그 다음에 그 다음에
[34:15] Multiple Stage Gain? /
• How can you derive it? Vout/Vin. /
• Gain is not everything. Rin and Rout matter significantly. /
/ [그림] 세 개의 증폭기 단계로 구성된 회로를 그리고 각각의 증폭기 단계에 Av1, Av2, Av3라는 이득이 표시되어 있다. Vin은 입력이고 Vout은 출력이며 세 개의 증폭기 단계는 직렬로 연결되어 있다. 각 단계의 출력은 다음 단계의 입력으로 연결되어 있으며, 각 증폭기 단계에는 입력 저항(Rin)과 출력 저항(Rout)이 표시되어 있다. /
Vout = Av1 * Av2 * Av3 * Vin /
(Rin * Rout) /
× Vin
[34:40] [음성] (모르기)
[34:45] Input Resistance and Output Resistance / Impedance / Input resistance, Rin is measured by / Circuit B / Output resistance Rout is measured by / Circuit A / [그림]
[34:50] In General, /
* When output is voltage, and input is voltage, /
Circuit A /--[그림]--/ Circuit B /
* Gain is changed by /
Or, effective voltage transfer ratio is changed by /
/
[35:05] Input Resistance and Output Resistance Impedance / Input resistance, R_in is measured by / [그림] Circuit B / [그림] Circuit A / Output resistance, R_out is measured by / [그림]
[35:10] Multiple Stage Gain? / How can you derive it? Vout / Vin. / Gain is not everything. Rin and Rout matter significantly. / [그림] 세 개의 연산 증폭기로 구성된 단계별 증폭 회로의 다이어그램. 입력은 Vin이고, 각각의 증폭기를 거쳐 출력은 Vout이 된다. / Vout = Av1 * Av2 * Av3 / Output Source / Rout / Rout / Rin / Av1 * Av2 * Av3 x Rin x Rin x Rin
[35:20] [음성] 이 영상은 이 영상에서 제가 곧하게 된 것 같아요. 이 영상이 엄청 좋아지고 여러분 이 브리지 개인과 이 분 앞에서 바ndhc같이 가야 하는게 염표가 생일 수 있는 거예요. 그럼 이렇게 가. 에이, 진짜 빨리 봐. 이 브리지 개인에 맞아서 쟤가 이렇게 끝나면 되니까. 아, 아,
[35:35] CS Amplifier /
• Can you derive Aᵣ, Rᵢn and Rout in CS Amplifier? /
• From now on, please see the three features at the same time. /
[그림] MOSFET 소자를 나타낸 것으로, 입력 커넥터 Vᵢn과 출력 커넥터 Vout이 있으며 MOSFET의 게이트 커패시터와 드레인 저항 Rd가 연결되어 있다. 소스 전압이 GND에 연결되어 있다. /
[36:00] [음성] 이 분앗을 보이시나요?
[36:40] [음성] (믿는 소리)
[36:55] CS Amplifier /
• Can you derive Av, Rin and Rout in CS Amplifier? /
• From now on, please see the three features at the same time. /
[그림] CS 증폭기의 입력-출력 전압 관계와 소수점 전압, 임피던스 등을 나타내는 도식 /
[37:20] [음성] 그러면 알람을 여기서 계속 봤습니다. 알람이 픽서 알람을 해서 계속 봤습니다. 그러면 알람이 픽서 알람을 해서 계속 봤습니다. 그러면 알람이 픽서 알람을 해서 계속 봤습니다. 알람이 픽서 알람이 픽서 알람이 �
[37:55] Gain of CS Amp w/ Ideal Current Source /
- Role of the current source is bias. What would be in the small signal world? /
- What is Gain? /
[그림] MOSFET 소자를 사용하는 전류 소스 회로의 개략도 /
- How can you implement current source? /
→ We should define a current source specifically.
[38:00] [음성] 이 정도면 이 정도면
[38:40] [음성] 전화벨이 없던 전화벨이 없던 전화벨
[39:20] [음성] 이 배로 바뀌면서 개인이 많이 얻어 주인야로 바뀌는 거죠. 그럼 이걸 이렇게 다시 그러면은은
[40:00] [음성] 이 프로토소스가 굉장히 잘 살려줄 수 있어? 너무 그런 거 보여주신 거에요? 아, 5만 얘가 정보할 수 있잖아. 이거 옮겨서 어떻게 시키면 안 되는 거예요? 그래서 옮겨서 어떻게 시키면 안 되는 거예요? 그래서 옮겨서 어떻게 시키면 안 되는 거예요? 옮겨서 어떻게 시키면 안 되는 거예요? 옮겨서 어떻게 시키면 안 되는 거예요
[40:40] [음성] 제가 알려드리는 게 아니고 엄청난 게 내가 50 변화는 말 들은 부하여지 변화는 말 들은 상관없이 항상 하고 다 1등 아이콘한 드릴 조금은 제가 저거 변화하는 사람들이 저를 계속 보여줄 수 있는 게 없을까 생각해보이는데 히어로 컨트롤을 하는 거예요. 이 히어로 컨트롤이 내가 전류가 2점을 안 잤나요? 전류 2점을 안 잤나요? 여러분 이럴까? 그러면? 세트위에 정해 가다면. 세트위에 정해 가다면. 아이가 나름. 인디테는. 나름. 인디테는. 세트위에 정해 가다면. 세트위에 정해 가다면. 아이가 나름. 인디테는. 나름. 인디테는. 세트위에 정해 가다면. 세트위에 정해 가다면. 세트위에 정해 가다�
[40:56] CS Amp w/ PMOS Current Source / Gain? Rout? / [그림] CS 증폭기 회로
[41:20] [음성] 이 쪽은 어떻게 보면 돼요? 이 쪽은 어떻게 보면 돼요? 내가 여기다 내가 내가
[42:00] [음성] 이 영상은 이 영상이 굉장히 큰일 납니다.
[42:27] CS Amp w/ PMOS Current Source / Gain? Rout? / [그림] 입력 신호 Vin이 PMOS MOSFET M1을 통해 전달되고, PMOS MOSFET M2가 현재 소스 역할을 하며 출력 수송 Vout를 형성하는 구성 요소의 블록 다이어그램 / Vb / VDD / vout / Vin / M1 / M2 / VDD / Saturation / Vps or Top / VDD / [그림] MOSFET의 전압-전류 특성을 나타내는 그래프. 그래프는 MOSFET이 포화 영역에서 작동할 때 Vgs에 따른 Id의 변화를 보여준다. / QA / -qm (Rp/Ro1) / -qm (Ro1/Ro1)
[42:57] Figure 7.11 shows a PMOS CS stage using an NMOS current source load. Compute the voltage gain of the circuit. / [그림] NMOS 전류 소스로 PMOS CS 단계를 나타낸 그림
[43:17] Dealing With PMOS /
[44:47] Dealing With PMOS / [그림] PMOS 트랜지스터의 기본 회로 구성 및 동작 이해를 위한 스케치
[45:17] Figure 7.11 shows a PMOS CS stage using an NMOS current source. Compute the voltage gain of the circuit. / [그림] PMOS CS stage using an NMOS current source.
[47:43] CS Stage w/ Diode-Connected Load /
• Can you derive the resistance of M2 seen from source? /
[49:53] CS Stage w/ Diode-Connected Load /
• Can you derive the resistance of M2 seen from source? /
[그림] CS Stage와 전압 분배 방법을 설명하는 회로도 /
VDD / V_out / M2 / M1 / Vin_o /  / Vo (from Diagram) / Rx (from Diagram) = 1/ gm (from Diagram) / gm_o = í (from Diagram) / g(m) = í (from Diagram) / Rx (from Diagram), -V_x = íx (from Diagram) / V_o (from Diagram) = íx (from Diagram) / gm_o = í (from Diagram) / V_x = íx + V_output (from Diagram) / ΔV_x ≈ ΔV_o (from Diagram) / gm_o = í (from Diagram) / Rx /
[51:34] CS Stage w/ Diode-Connected Load / [그림] 게이트를 통해 전류가 흐르는 NMOS 트랜지스터(M1)의 회로 구성도. 메모리 셀을 나타내는 논리 게이트가 있습니다. / [그림] 소스에 보이는 M2 트랜지스터의 저항을 소스에서 유도할 수 있나요? / VDD / Vout / Vin_o / M1 / M2 / [그림] Vout을 기준으로 작성된 다양한 계산과 적분이 표시되어 있습니다. / -gm(Vx) = -Ix / Rx = Vx / Ix / [그림] gm(V) = I / V / [그림] Vx = Vx - Vout / [그림] gm(V) = I / V / [그림] gm(I) = I / V / [그림] gm = V / Ix / [그림] dx / V = -1 / gm / [그림] dx / V = gm / -1 / gm / V / [그림] 19
[51:49] Example 7.2 Determine the voltage gain of the circuit shown in Fig. 7.13(a) if λ ≠ 0. / [그림] CS stage with diode-connected PMOS device.
[54:09] Determine the voltage gain of the circuit shown in Fig. 7.13(a) λ ≠ 0 /

Figure 7.13 CS stage with diode-connected PMOS device /

_In_ / M2 / _out_ / -Vout / Id /

_VDD_ /

_nMOS_ / _gm_ / _V_ /

/ [그림] CS stage with diode-connected PMOS device /
[54:40] CS Stage With Degradation / Gain? / [그림]

V_DD / R_D / [그림] / V_out / V_in / R_S / V_in / + / v_1 / g_m v_1 / R_D / v_out / R_S
[56:45] CS Stage With Degeneration /
• Gain? /
VDD /
Rd /
Vout /
Vin /
M /
Rs /
vin /
V1 /
gm V1 /
Rd /
Rs /
Vin (vgs) /
Vout /
- gm (m) x (Vgs - Vt) (Vout) Rs = gm (Vin - Vt) Rs /
[58:15] CS Stage With Degeneration /
Gain? /
/
/
/
/
/
/
/
/
/
/
/
/
/
/
/
/
/
/
/
/
/
/
/
/
/
/
/
/
/
[59:46] CS Stage With Degeneration /
• Gain? /
/ [그림] 전압 이득에 대한 회로도 표시 /
VDD /
Rd /
M1 /
Rs /
Vin /
vin1 /
gm / V1 /
Rd /
Vout /
Qs /
-q(m0) /
f(qm)Rs /
Vout = -IdRd /
Load = -IdLo /
(Vin) /
q(m0)Vin /
f(qm)Rs /
-q(m0)Vin * (Vin - Vn) /
f(qm)Rs /
-q(m0)Vin * (Vin - Vn) * Rs /
Vin /
/ [그림] 입력 전압에 대한 회로도 표시 /
gain = (1 / (f(qm)Rs)) /
[61:11] Compute the voltage gain of the circuit shown in Fig. 7.15(a) if λ = 0. / [그림 (a)] Example of CS stage with degeneration. / [그림 (b)] simplified circuit.
[61:51] Output Resistance? / When λ = 0, it is simple. But what if λ ≠ 0? / [그림] 왼쪽은 MOSFET 트랜지스터를 나타낸 회로도이며, 오른쪽은 MOSFET 모델 회로를 나타내고 있으며, λ는 이 모델에서 특정 파라미터를 나타낸다.
[63:52] Output Resistance? / When λ = 0, it is simple. But what if λ ≠ 0? / [그림] /  VDD / Rx / M1 / in / Rs / out / Rx / v1 / gm * v1 / ro / ix / vx / xs /  Rx (out) = (Rx / Ro) = Rout / 23
[65:02] Output Resistance? / When λ = 0, it is simple. But what if λ ≠ 0? / [그림] MOSFET 출력 회로
[66:08] Output Resistance? / When λ = 0, it is simple. But what if λ ≠ 0? /  / [그림]  / VDD /  RD / Vout /  / Mx / Vin /  / RS /  /  / v1  +  /  /  /  /  /  /  /  / ix /  / gm /  / v1  / ro / vx /  / RS /  / Rout  / = (vx) / (ix)  / (RII/Ro = Rout)  / vx = Rst ods
[68:55] Example Compute the output resistance of the circuit in Fig. 7.18(a) if M₁ and M₂ are identical. / Figure 7.18 (a) Example of CS stage with degeneration, (b) simplified circuit.
[69:30] Compute the output resistance of the circuit in Fig. 7.18(a) if M₁ and M₂ are identical. / [그림] CS 스타게 with degeneration, simplified circuit. / Rout / Fb + (τQ)q/x / / [그림]
[69:35] Example 7.9 Compute the output resistance of the circuit in Fig. 7.18(a) if M1 and M2 are identical. / [그림] 전체 회로의 블록 다이어그램을 나타낸다.

Figure 7.18 (a) Example of CS stage with degeneration, (b) simplified circuit. / [그림] 두 개의 MOSFET 소자를 가진 CS 단계의 회로를 나타내며, (a)는 백업 기법을 가진 CS 단계의 예시이고 (b)는 단순화된 회로이다.

Rout / [그림] 전체 회로의 출력 저항을 나타낸다.

Vb / [그림] 소스 전압을 나타낸다.

M1 / [그림] MOSFET 소자를 나타낸다.

M2 / [그림] MOSFET 소자를 나타낸다.

Rout / [그림] 출력 저항을 나타낸다.

R01 / [그림] 소스 접합 저항을 나타낸다.

gm2 / [그림] MOSFET 소자의 전압 이득을 나타낸다.
[70:16] Example 7.9 Compute the output resistance of the circuit in Fig. 7.18(a) if M₁ and M₂ are identical. / [그림] 두 개의 MOSFET 소자의 간단한 소 회로를 보여준다. (a) CS 구조의 탈규제화 / (b) 간략화된 회로
[70:21] Compute the output resistance of the circuit in Fig. 7.18(a) if M1 and M2 are identical. / [그림] Figure 7.18 (a) Example of CS stage with degeneration, (b) simplified circuit. / Rs + (τg + quxl/α) / Vo = / 1/gm / [그림]
[71:11] Example 7.10 / Determine the output resistance of the circuit in Fig. 7.19(a) and compare the result with that in the above example. Assume M₁ and M₂ are in saturation. / [그림] Figure 7.12 (a) Example of CS stage with degeneration, (b) simplified circuit.
[71:36] Determine the output resistance of the circuit in Fig. 7.19(a) and compare the result with that in the above example. Assume M₁ and M₂ are in saturation.

Figure 7.19 (a) Example of CS stage with degeneration, (b) simplified circuit. / [그림] 두 개의 MOSFET 소자를 나타내는 회로 두 가지를 비교하고 있다. 하나는 CS 스테이지에 레지스터를 추가한 복잡한 회로이고, 다른 하나는 이 회로를 단순화한 형태의 회로이다. 두 그림 모두 MOSFET 소자 M₁과 M₂를 포함하고 있으며, 각각 다른 방식으로 연결되었다.
[71:41] Determine the output resistance of the circuit in Fig. 7.19(a) and compare the result with that in the above example. Assume M₁ and M₂ are in saturation. / [그림] Figure 7.19 (a) Example of CS stage with degeneration, (b) simplified circuit. / Rout / R + r0₁ + gm/lsR0₁ / r0₂ /