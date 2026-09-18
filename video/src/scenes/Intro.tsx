import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

const enter = (frame: number, fps: number, delay: number) => {
  const opacity = interpolate(frame - delay, [0, 20], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const y = spring({ frame: frame - delay, fps, config: { damping: 200 } });
  const translateY = interpolate(y, [0, 1], [30, 0]);
  return { opacity, transform: `translateY(${translateY}px)` };
};

export const Intro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "var(--ground)",
        justifyContent: "center",
        alignItems: "center",
        padding: "0 100px",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
        <div
          style={{
            ...enter(frame, fps, 0),
            fontFamily: "var(--serif)",
            fontSize: 56,
            color: "var(--ink)",
            marginBottom: 24,
          }}
        >
          Summr<span style={{ fontStyle: "italic" }}>i</span>zei
          <span style={{ color: "var(--accent)" }}>.</span>
        </div>

        <div
          style={{
            ...enter(frame, fps, 5),
            fontFamily: "var(--sans)",
            fontSize: 26,
            fontWeight: 600,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "var(--muted)",
            marginBottom: 40,
          }}
        >
          LESS TRANSCRIBING. MORE UNDERSTANDING.
        </div>

        <div
          style={{
            ...enter(frame, fps, 10),
            fontFamily: "var(--sans)",
            fontWeight: 800,
            fontSize: 104,
            lineHeight: 1.15,
            letterSpacing: "-0.03em",
            color: "var(--ink)",
            marginBottom: 48,
          }}
        >
          온라인 강의 딸깍.
        </div>

        <div
          style={{
            ...enter(frame, fps, 15),
            fontFamily: "var(--sans)",
            fontSize: 34,
            lineHeight: 1.6,
            color: "var(--muted)",
          }}
        >
          영상 다운로드 없이
          <br />
          동영상/실시간 강의의 요약 노트를 내가 쓰던 노트앱으로.
        </div>
      </div>
    </AbsoluteFill>
  );
};
