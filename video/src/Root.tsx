import { Composition } from "remotion";
import { LaunchVideo, TOTAL_FRAMES } from "./LaunchVideo";

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="LaunchVideo"
      component={LaunchVideo}
      durationInFrames={TOTAL_FRAMES}
      fps={30}
      width={1080}
      height={1920}
    />
  );
};
