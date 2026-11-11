import { Composition } from "remotion";
import { MiniPayExplainer } from "./Video";
import { CUES, FPS } from "./cues";

export const RemotionRoot = () => (
  <Composition id="MiniPayExplainer" component={MiniPayExplainer} durationInFrames={Math.round(CUES.duration * FPS)} fps={FPS} width={1080} height={1920} />
);
