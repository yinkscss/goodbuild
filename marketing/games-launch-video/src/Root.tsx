import { Composition } from "remotion";
import { GamesLaunch } from "./Video";
import { TL } from "./theme";

export const RemotionRoot = () => (
  <Composition
    id="GamesLaunch"
    component={GamesLaunch}
    durationInFrames={Math.round(TL.duration * TL.fps)}
    fps={TL.fps}
    width={TL.width}
    height={TL.height}
  />
);
