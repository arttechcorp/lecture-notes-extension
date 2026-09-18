import { AbsoluteFill, Sequence } from 'remotion';
import './styles.css';
import { Intro } from './scenes/Intro';
import { Demo } from './scenes/Demo';
import { Cta } from './scenes/Cta';

export const INTRO_FRAMES = 90;
export const DEMO_FRAMES = 450;
export const CTA_FRAMES = 120;
export const TOTAL_FRAMES = INTRO_FRAMES + DEMO_FRAMES + CTA_FRAMES;

export const LaunchVideo: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: 'var(--ground)' }}>
      <Sequence durationInFrames={INTRO_FRAMES}>
        <Intro />
      </Sequence>
      <Sequence from={INTRO_FRAMES} durationInFrames={DEMO_FRAMES}>
        <Demo />
      </Sequence>
      <Sequence from={INTRO_FRAMES + DEMO_FRAMES} durationInFrames={CTA_FRAMES}>
        <Cta />
      </Sequence>
    </AbsoluteFill>
  );
};
