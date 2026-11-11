import { Composition } from "remotion";
import { PlatformLaunch } from "./Video";
import { TL } from "./theme";

export const RemotionRoot = () => (
  <Composition
    id="PlatformLaunch"
    component={PlatformLaunch}
    durationInFrames={Math.round(TL.duration * TL.fps)}
    fps={TL.fps}
    width={TL.width}
    height={TL.height}
  />
);
