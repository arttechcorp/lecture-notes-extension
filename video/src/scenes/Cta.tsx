import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

const enter = (frame: number, fps: number, delay: number) => {
  const opacity = interpolate(frame - delay, [0, 20], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const y = spring({ frame: frame - delay, fps, config: { damping: 200 } });
  const translateY = interpolate(y, [0, 1], [40, 0]);
  return { opacity, transform: `translateY(${translateY}px)` };
};

export const Cta: React.FC = () => {
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
            fontFamily: "var(--sans)",
            fontWeight: 800,
            fontSize: 84,
            lineHeight: 1.25,
            letterSpacing: "-0.03em",
            color: "var(--ink)",
            marginBottom: 64,
          }}
        >
          강의는 그대로, 노트는 자동으로.
        </div>

        <div
          style={{
            ...enter(frame, fps, 10),
            display: "flex",
            alignItems: "center",
            backgroundColor: "var(--ink)",
            color: "var(--paper)",
            borderRadius: 20,
            padding: "36px 56px",
            fontFamily: "var(--sans)",
            fontWeight: 700,
            fontSize: 36,
          }}
        >
          Summrizei 무료로 시작
          <span style={{ marginLeft: 16 }}>↗</span>
        </div>

        <div
          style={{
            ...enter(frame, fps, 15),
            fontFamily: "var(--sans)",
            fontSize: 26,
            color: "var(--muted)",
            marginTop: 32,
          }}
        >
          summrizei.com
        </div>

        <div
          style={{
            ...enter(frame, fps, 20),
            fontFamily: "var(--serif)",
            fontSize: 30,
            color: "var(--ink)",
            marginTop: 96,
          }}
        >
          Summr<span style={{ fontStyle: "italic" }}>i</span>zei
          <span style={{ color: "var(--accent)" }}>.</span>
        </div>
      </div>
    </AbsoluteFill>
  );
};
