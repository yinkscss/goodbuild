import React, { useEffect, useState } from "react";
import { AbsoluteFill, Audio, Sequence, continueRender, delayRender, staticFile } from "remotion";
import { CardSpec, TL, sec } from "./theme";
import { loadFonts } from "./fonts";
import { Hook } from "./scenes/Hook";
import { Slams } from "./scenes/Slams";
import { Card } from "./scenes/Card";
import { Outro } from "./scenes/Outro";

const span = (a: number, b: number) => ({ from: sec(a), durationInFrames: sec(b) - sec(a) });

export const GamesLaunch: React.FC = () => {
  const [handle] = useState(() => delayRender("fonts"));
  const [ready, setReady] = useState(false);
  useEffect(() => {
    loadFonts().then(() => {
      setReady(true);
      continueRender(handle);
    });
  }, [handle]);
  if (!ready) return null;

  const cards = TL.cards as CardSpec[];
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <Audio src={staticFile("music.wav")} />
      <Sequence {...span(TL.hook.start, TL.hook.end)} name="hook">
        <Hook />
      </Sequence>
      <Sequence {...span(TL.slams.start, TL.slams.end)} name="slams">
        <Slams />
      </Sequence>
      {cards.map((c, i) => (
        <Sequence key={c.id} {...span(c.start, c.end)} name={c.id}>
          <Card spec={c} index={i} total={cards.length} />
        </Sequence>
      ))}
      <Sequence {...span(TL.outro.start, TL.outro.end)} name="outro">
        <Outro />
      </Sequence>
    </AbsoluteFill>
  );
};
