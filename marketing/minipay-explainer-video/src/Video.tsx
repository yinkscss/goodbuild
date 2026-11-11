import React, { useEffect, useState } from "react";
import { AbsoluteFill, Audio, continueRender, delayRender, staticFile, useCurrentFrame } from "remotion";
import { C } from "./theme";
import { loadFonts } from "./fonts";
import { Grain } from "./fx";
import { Captions } from "./Captions";
import { StepRail } from "./StepRail";
import { CUES, FPS, easeOut, prog, scene } from "./cues";
import { HookScene } from "./scenes/HookScene";
import { WhatScene } from "./scenes/WhatScene";
import { DeployScene } from "./scenes/DeployScene";
import { PublishScene } from "./scenes/PublishScene";
import { MiniPayScene } from "./scenes/MiniPayScene";
import { ListScene } from "./scenes/ListScene";
import { OutroScene } from "./scenes/OutroScene";

const ORDER: [string, React.FC<{ t: number }>][] = [
  ["hook", HookScene], ["what", WhatScene], ["deploy", DeployScene], ["publish", PublishScene],
  ["minipay", MiniPayScene], ["list", ListScene], ["outro", OutroScene],
];
const RAIL: Record<string, number> = { deploy: 0, publish: 1, minipay: 2, list: 3 };

export const MiniPayExplainer: React.FC = () => {
  const [handle] = useState(() => delayRender("fonts"));
  const [ready, setReady] = useState(false);
  useEffect(() => {
    loadFonts().then(() => { setReady(true); continueRender(handle); });
  }, [handle]);
  const frame = useCurrentFrame();
  if (!ready) return null;
  const t = frame / FPS;
  const cur = ORDER.find(([id]) => t >= scene(id).start - 1e-6 && t < scene(id).end - 1e-6) ?? ORDER[ORDER.length - 1];
  const [id, Scene] = cur;
  const sc = scene(id);
  const since = t - sc.start;
  // hard cut with a quick pink wipe sliding off to the right
  const wipe = id === "hook" ? 1 : prog(t, sc.start, 0.25);
  const rail = RAIL[id];
  const railIn = rail === undefined ? 0 : easeOut(prog(t, sc.start + 0.1, 0.3));
  return (
    <AbsoluteFill style={{ background: C.ink }}>
      <Audio src={staticFile("audio.wav")} />
      <Scene t={t} />
      {rail !== undefined && <StepRail active={rail} inT={railIn} />}
      <Captions t={t} />
      {wipe < 1 && <div style={{ position: "absolute", inset: 0, background: C.pink, transform: `translateX(${easeOut(wipe) * 112}%)`, borderLeft: `0 solid ${C.ink}` }} />}
      <Grain opacity={0.05} />
    </AbsoluteFill>
  );
};
