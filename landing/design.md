---
name: Alt (Alt Note)
description: Design system extracted from altalt.io (AI Lecture & Meeting Note Taker)
version: 1.0.0
theme: light
colors:
  background: "#F7F7F4"
  foreground: "oklch(14.5% 0 0)"
  primary: "oklch(20.5% 0 0)"
  primary-foreground: "oklch(98.5% 0 0)"
  secondary: "oklch(97% 0 0)"
  secondary-foreground: "oklch(20.5% 0 0)"
  muted: "oklch(97% 0 0)"
  muted-foreground: "oklch(55.6% 0 0)"
  accent: "oklch(97% 0 0)"
  accent-foreground: "oklch(20.5% 0 0)"
  accent-brand: "#FF5600"
  accent-brand-subtle: "rgba(255, 86, 0, 0.08)"
  card: "oklch(100% 0 0)"
  card-foreground: "oklch(14.5% 0 0)"
  card-glass: "rgba(255, 255, 255, 0.3)"
  card-glass-solid: "rgba(255, 255, 255, 0.8)"
  border: "oklch(92.2% 0 0)"
  border-subtle: "rgba(0, 0, 0, 0.1)"
  surface-dark: "#000000"
  surface-dark-card: "#18181B"
  text-dark-contrast: "#F4F4F5"
  text-dark-muted: "rgba(255, 255, 255, 0.6)"
  destructive: "oklch(47% 0.245 27.325)"
  ring: "oklch(87% 0 0)"
  speakers:
    speaker-1: "oklch(64.6% 0.222 41.116)"
    speaker-2: "oklch(60% 0.118 184.704)"
    speaker-3: "oklch(39.8% 0.07 227.392)"
typography:
  fonts:
    sans: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Pretendard", "astaSans", sans-serif'
    serif: '"Hedvig Letters Serif", Georgia, serif'
    mono: '"Geist Mono", Menlo, Monaco, Consolas, monospace'
  display-hero:
    fontFamily: "{typography.fonts.sans}"
    fontSize: "48px"
    fontWeight: "600"
    lineHeight: "60px"
    letterSpacing: "-0.025em"
  heading-section:
    fontFamily: "{typography.fonts.sans}"
    fontSize: "24px"
    fontWeight: "600"
    lineHeight: "32px"
    letterSpacing: "-0.02em"
  heading-card:
    fontFamily: "{typography.fonts.sans}"
    fontSize: "18px"
    fontWeight: "600"
    lineHeight: "26px"
    letterSpacing: "-0.01em"
  body-lg:
    fontFamily: "{typography.fonts.sans}"
    fontSize: "16px"
    fontWeight: "400"
    lineHeight: "26px"
  body-md:
    fontFamily: "{typography.fonts.sans}"
    fontSize: "14px"
    fontWeight: "400"
    lineHeight: "22px"
  body-sm:
    fontFamily: "{typography.fonts.sans}"
    fontSize: "13px"
    fontWeight: "400"
    lineHeight: "19px"
  editorial-quote:
    fontFamily: "{typography.fonts.serif}"
    fontSize: "24px"
    fontWeight: "400"
    lineHeight: "36px"
  eyebrow:
    fontFamily: "{typography.fonts.sans}"
    fontSize: "11px"
    fontWeight: "500"
    lineHeight: "16px"
    letterSpacing: "0.05em"
  code-metric:
    fontFamily: "{typography.fonts.mono}"
    fontSize: "11px"
    fontWeight: "500"
    lineHeight: "14px"
    letterSpacing: "0.02em"
rounded:
  sm: "4px"
  DEFAULT: "8px"
  md: "10px"
  lg: "14px"
  xl: "18px"
  full: "9999px"
spacing:
  container-max: "1280px"
  padding-section-y: "80px"
  padding-container-x: "32px"
  grid-gap: "0px"
  cell-padding: "24px"
effects:
  backdrop-blur-xl: "blur(24px)"
  backdrop-blur-sm: "blur(8px)"
  shadow-glass: "0 20px 40px -15px rgba(0, 0, 0, 0.05)"
---

# Alt (Alt Note) Design System Specification

## 1. Overview & Visual Identity

Alt의 디자인 시스템은 **스위스 모더니즘(Swiss Style Grid)** 과 **차분한 앰비언트 인터페이스(Calm Ambient Interface)** 의 결합을 지향합니다.

1. **따뜻한 질감의 베이스 (Warm Paper Canvas)**: 차가운 순백색(`#FFFFFF`) 대신 미세한 온기가 도는 린넨/페이퍼 톤(`#F7F7F4`)을 캔버스 기본 색상으로 사용합니다.
2. **엄격한 스위스 그리드 (Connected Swiss Grid)**: 카드 간 간격을 벌리는 대신 1px 얇은 선(`border-black/10`)과 음수 마진(`-mt-px`, `-ml-px`)을 통해 경계선을 맞물리게 연결하는 테이블 그리드 구조를 채택했습니다.
3. **듀얼 레이어 글래스모피즘 (Dual-Layer Glassmorphism)**: macOS 네이티브 데스크톱 앱의 깊이감을 표현하기 위해 `backdrop-blur-xl`과 반투명 흰색 레이어(`bg-white/30`, `bg-white/80`)를 중첩 배치합니다.
4. **절제된 강렬한 포인트 (Safety Orange #FF5600)**: 전체 UI는 무채색 흑백과 차분한 그레이로 절제하고, 온디바이스 AI 코어 엔진의 압도적 성능(SOTA, CoreML 처리 속도) 및 무료 무제한 핵심 가치에만 선명한 오렌지(`#FF5600`)를 단일 액센트로 적용합니다.

---

## 2. Colors

### 2.1 Base & Surfaces
- **Canvas Background (`#F7F7F4`)**: 페이지 최외곽 배경색. 눈의 피로도를 낮추는 미색 바탕.
- **Surface Foreground (`oklch(14.5% 0 0)` / `#18181B`)**: 본문 기본 텍스트 및 강한 강조 텍스트.
- **Muted Foreground (`oklch(55.6% 0 0)` / `#71717A`)**: 보조 설명문, 캡션, 비활성 탭 레이블.
- **Border (`oklch(92.2% 0 0)` / `rgba(0, 0, 0, 0.1)`)**: 그리드 셀 구분선 및 컨테이너 테두리.

### 2.2 Brand & Accents
- **Brand Accent Orange (`#FF5600`)**: 제품의 기술적 우위(속도, SOTA, 무제한)를 드러내는 유일한 액센트.
- **Subtle Orange Background (`rgba(255, 86, 0, 0.08)`)**: 오렌지 뱃지 또는 하이라이트 배경.

### 2.3 Dark Tech Surface (On-Device Showcase)
- **Engine Container (`#000000`)**: CoreML 및 로컬 AI 엔진의 전문성을 강조하는 순수 블랙 섹션.
- **Engine Card (`#18181B`)**: 블랙 섹션 내부 카드.
- **Engine Metrics Text (`#FFFFFF`, `#F4F4F5`, `rgba(255, 255, 255, 0.6)`)**: 벤치마크 그래프 및 지표 표기.

### 2.4 Speaker Diarization Palette
- **화자 1 (Speaker 1)**: `oklch(64.6% 0.222 41.116)` (웜 코랄/오렌지)
- **화자 2 (Speaker 2)**: `oklch(60% 0.118 184.704)` (민트/청록)
- **화자 3 (Speaker 3)**: `oklch(39.8% 0.07 227.392)` (인디고/소프트 블루)

---

## 3. Typography Hierarchy

### 3.1 Typefaces
- **Primary Sans (`ui-sans-serif, system-ui, astaSans, Pretendard`)**: 내비게이션, 타이틀, 일반 본문, 버튼 등 인터페이스 전반.
- **Editorial Serif (`Hedvig Letters Serif`)**: "맥락을 더 많이 쌓을수록, AI가 당신을 더 잘 이해해요."와 같은 서사적 인용구, 브랜드 철학 문장에 제한적으로 사용.
- **Technical Mono (`Geist Mono`)**: 음성 타임스탬프(`13:25:37`), 인코딩 레이턴시(`272.7 ms`), 벤치마크 지표(`tabular-nums`).

### 3.2 Hierarchy Rules
1. **Hero Main Headline**: `48px` (Mobile: `32px`), Weight `600`, Line-height `1.2`, Letter-spacing `-0.025em`, Color `#18181B`.
2. **Section Heading (H3)**: `24px` (Desktop: `36px`), Weight `600`, Line-height `1.25`, Letter-spacing `-0.02em`.
3. **Card Heading**: `18px` ~ `24px`, Weight `600`.
4. **Body Text**: `14px` ~ `16px`, Weight `400`, Line-height `1.6`, Color `#27272A` / `#71717A`.
5. **Eyebrow / Small Badge**: `11px` ~ `13px`, Weight `500`, Letter-spacing `0.05em`, Uppercase.
6. **Editorial Serif Quote**: `20px` ~ `30px`, Font-family Serif, Weight `400`, Line-height `1.4`.

---

## 4. Spacing & Layout Architecture

### 4.1 Grid & Container
- **Max Width**: `1280px` (`max-w-7xl`). 중앙 정렬(`mx-auto`).
- **Horizontal Padding**: 모바일 `16px` (`px-4`), 데스크톱 `32px` (`px-8`).
- **Vertical Spacing**: 섹션 간 여백 `40px` (모바일) ~ `80px` (데스크톱).

### 4.2 Swiss Connected Border System
- 개별 카드가 독립적으로 떠 있는 형태가 아니라, 바둑판처럼 경계선을 공유하는 스위스 그리드 방식:
  - Container: `border border-black/10`
  - Child Cells: `-mt-px -ml-px border border-black/10`
  - Responsive: 데스크톱 `grid-cols-4` 또는 `grid-cols-3`, 태블릿 `grid-cols-2`, 모바일 `grid-cols-1`.
  - Tile Background: `bg-background/50 backdrop-blur-sm` 또는 `bg-foreground/5`.

---

## 5. Shapes, Border Radii & Elevation

### 5.1 Border Radii
- **Pill (Full Radius)**: `rounded-full` (9999px) — 상단 공지 뱃지, 필터 탭, 헤더 내비게이션 버튼.
- **App Mock Window**: `rounded-xl` (`14px`) 또는 `rounded-2xl` (`18px`).
- **Primary Action Button**: `rounded-[14px]`.
- **Inner Embedded Containers**: `rounded-lg` (`10px` / `--radius: .625rem`).
- **Connected Grid Tiles**: `rounded-none` (`0px`) — 경계선 맞물림 처리.

### 5.2 Elevation & Glass Effects
- 평면적인 섀도우 남용을 배제하고, 반투명 블러 레이어로 층위 구분:
  - Background: `bg-background` (`#F7F7F4`)
  - Glass Layer 1: `bg-white/30 backdrop-blur-xl border border-border/50`
  - Glass Layer 2 (Inner Card): `bg-white/80 rounded-lg`
  - Subtle Highlight: `bg-foreground/5`

---

## 6. Key Component Specifications

### 6.1 Navigation Bar
- 높이: `60px`, 상단 고정(`sticky top-0 z-50`).
- 배경: `bg-background` (`#F7F7F4`), 테두리 없이 매끄럽게 본문 캔버스와 연결.
- 링크 버튼: `h-8 px-3 rounded-full text-[13px] font-medium text-foreground hover:bg-black/5`.
- 언어 선택 및 로그인: 캡슐형 둥근 버튼.

### 6.2 Hero Section & Notification Pill
- **Notification Pill**: `rounded-full bg-white/70 border border-black/10 px-3.5 py-1 text-[13px]`.
- **Primary CTA Button**:
  - Background: `oklch(20.5% 0 0)` (Dark Carbon `#202020`)
  - Text: `oklch(98.5% 0 0)` (`#FAFAFA`), `14px font-medium`
  - Radius: `14px`, Height: `44px`, Padding: `0 16px`
  - Split button: 우측 드롭다운 버튼과 구분선 결합.
- **Helper Caption**: `Requires macOS 14.4+` (`text-[12px] text-muted-foreground`).

### 6.3 App Preview Window
- 탭 스위처: `회의할 때` / `강의 들을 때` (세그먼트 컨트롤) + `음성인식` / `요약` / `퀴즈` / `채팅`.
- 발화자 점유율: 가로 프로그레스 바 (화자 1, 2, 3 컬러 블록).
- 실시간 타임라인:
  - 타임스탬프: `text-[11px] font-mono text-muted-foreground` (`Geist Mono`).
  - 번역 액션 버튼: `text-[12px] px-2 py-0.5 rounded border border-black/10 hover:bg-black/5`.

### 6.4 CoreML Benchmark Showcase Card
- 순수 블랙 배경(`bg-black rounded-2xl p-6 text-white`).
- 헤더: `고성능 AI 모델을 개인 PC에서도 가볍고 빠르게 돌리기 위해, 핵심 엔진을 직접 설계했어요.`
- 벤치마크 차트:
  - 오렌지 프로그레스 바(`bg-[#FF5600]`)로 빠른 속도(15배, 39배) 시각화.
  - 지표 수치: `tabular-nums font-mono text-[11px] text-white/90`.

### 6.5 Use Case Matrix & Narrative Block
- 9칸 시나리오 타일: 학교 수업, 온라인 강의, 세미나, 컨퍼런스, 회의, 유저 인터뷰, 면접, 1on1, IR 피칭.
- 세리프 철학 콜아웃: `Hedvig Letters Serif`, 폰트 크기 `24px~30px`, 줄바꿈 호흡 조절.

---

## 7. Do's and Don'ts

### Do:
- 캔버스 배경에 순백색 대신 따뜻한 `#F7F7F4`를 고수할 것.
- 스위스 그리드 타일에는 둥근 모서리 대신 직각과 `-mt-px -ml-px` 경계선 연결을 적용할 것.
- 숫자, 시간, 벤치마크 지표에는 항상 `Geist Mono`와 `tabular-nums`를 부여할 것.
- 오렌지 색상(`#FF5600`)은 제품의 기술적 우위 및 핵심 콜아웃에만 엄격하게 한정할 것.
- 맥OS 데스크톱 앱 쇼케이스는 `backdrop-blur-xl`과 반투명 중첩 카드로 구현할 것.

### Don'ts:
- 원색 계열(쨍한 블루, 그린 등)을 액센트로 혼용하지 말 것 (오렌지 단일 강조 유지).
- 카드마다 과도한 드롭 섀도우(`shadow-2xl` 등)를 부여하여 평면성을 깨뜨리지 말 것.
- 서사적 인용구 외의 일반 본문이나 버튼에 세리프 폰트를 남용하지 말 것.
- 경계선 두께를 2px 이상으로 두껍게 설정하지 말 것 (모든 구분선은 1px의 정밀한 선형태 유지).
