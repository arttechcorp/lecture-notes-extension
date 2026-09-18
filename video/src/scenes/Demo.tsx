// 960×600 가로 목업을 세로 화면에 담기 위해, 프레임에 따라 화면을 밀고 당긴다.
// 캡처 중에는 강의 화면을, 노트 생성 중에는 노트 패널을 크게 잡는다.
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { Mockup } from '../mockup/Mockup';
import { CAPTURE_END_FRAME } from '../mockup/timeline';

const VIEWPORT = { width: 1080, height: 1400, top: 300 };
/** [스케일, 캔버스 좌표계에서 화면 중앙에 둘 지점] */
const FULL = [1.15, 480, 300] as const;
const LECTURE = [1.95, 285, 300] as const;
const NOTE = [2.1, 760, 330] as const;

const KEYFRAMES = [0, 40, 75, CAPTURE_END_FRAME - 20, CAPTURE_END_FRAME + 20];
const SHOTS = [FULL, FULL, LECTURE, LECTURE, NOTE];

const captionFor = (frame: number) =>
  frame < CAPTURE_END_FRAME ? '화면과 말소리를 그대로 읽습니다' : '읽은 내용이 학습 노트가 됩니다';

export const Demo: React.FC = () => {
  const frame = useCurrentFrame();
  const ease = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
  const scale = interpolate(frame, KEYFRAMES, SHOTS.map((s) => s[0]) as number[], ease);
  const cx = interpolate(frame, KEYFRAMES, SHOTS.map((s) => s[1]) as number[], ease);
  const cy = interpolate(frame, KEYFRAMES, SHOTS.map((s) => s[2]) as number[], ease);

  return (
    <AbsoluteFill style={{ background: 'var(--ground)' }}>
      <div
        style={{
          position: 'absolute',
          top: VIEWPORT.top,
          left: 0,
          width: VIEWPORT.width,
          height: VIEWPORT.height,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: 960,
            transformOrigin: '0 0',
            transform: `translate(${VIEWPORT.width / 2 - cx * scale}px, ${VIEWPORT.height / 2 - cy * scale}px) scale(${scale})`,
          }}
        >
          <Mockup />
        </div>
      </div>

      <div
        style={{
          position: 'absolute',
          top: 128,
          width: '100%',
          textAlign: 'center',
          font: `500 46px/1.5 var(--sans)`,
          letterSpacing: '-.02em',
          color: 'var(--ink)',
          padding: '0 80px',
          boxSizing: 'border-box',
        }}
      >
        {captionFor(frame)}
      </div>

      <div
        style={{
          position: 'absolute',
          bottom: 90,
          width: '100%',
          textAlign: 'center',
          font: `500 40px/1 var(--serif)`,
          letterSpacing: '-.025em',
          color: 'var(--ink)',
        }}
      >
        Summr<span style={{ fontStyle: 'italic' }}>i</span>zei
        <span style={{ color: 'var(--accent)' }}>.</span>
      </div>
    </AbsoluteFill>
  );
};
