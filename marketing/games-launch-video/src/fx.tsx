import React from "react";
import { AbsoluteFill, Easing, interpolate, random, staticFile, useCurrentFrame } from "remotion";
import { fitText } from "@remotion/layout-utils";
import { SAFE } from "./theme";

export const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** Film grain: a noise tile jumped to a random offset every frame. */
export const Grain: React.FC<{ opacity?: number }> = ({ opacity = 0.13 }) => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill
      style={{
        backgroundImage: `url(${staticFile("grain.png")})`,
        backgroundSize: "256px 256px",
        backgroundPosition: `${Math.floor(random(`gx${f}`) * 256)}px ${Math.floor(random(`gy${f}`) * 256)}px`,
        mixBlendMode: "overlay",
        opacity,
        pointerEvents: "none",
      }}
    />
  );
};

/** Hard punch-in: big -> 1 in a few frames. */
export const punch = (f: number, from = 1.45, frames = 4) =>
  interpolate(f, [0, frames], [from, 1], { ...clamp, easing: Easing.out(Easing.exp) });

/** Decaying camera shake offsets. */
export const shake = (f: number, amp = 18, frames = 9, seed = "s") => {
  const d = interpolate(f, [0, frames], [1, 0], clamp);
  return {
    x: (random(`${seed}x${f}`) - 0.5) * 2 * amp * d,
    y: (random(`${seed}y${f}`) - 0.5) * 2 * amp * d,
    r: (random(`${seed}r${f}`) - 0.5) * 2 * 1.2 * d,
  };
};

/** One-frame (or two) full-screen colour flash at the start of a cut. */
export const Flash: React.FC<{ color: string; frames?: number }> = ({ color, frames = 1 }) => {
  const f = useCurrentFrame();
  if (f >= frames) return null;
  return <AbsoluteFill style={{ background: color }} />;
};

export const fit = (
  text: string,
  fontFamily: string,
  fontWeight: string | number,
  max: number,
  width = SAFE.w,
  fontStyle?: string,
) => {
  const { fontSize } = fitText({
    text,
    withinWidth: width,
    fontFamily,
    fontWeight,
    additionalStyles: fontStyle ? { fontStyle } : undefined,
  });
  // headroom for negative tracking / italics overhang
  return Math.min(max, fontSize * 0.94);
};

/** Text with chromatic (pink / lilac) ghost copies that collapse onto it. */
export const Chroma: React.FC<{
  f: number;
  style: React.CSSProperties;
  children: string;
  a?: string;
  b?: string;
  frames?: number;
  dist?: number;
}> = ({ f, style, children, a = "#FF85D9", b = "#C9B3F0", frames = 7, dist = 26 }) => {
  const d = interpolate(f, [0, frames], [dist, 0], { ...clamp, easing: Easing.out(Easing.quad) });
  const o = interpolate(f, [0, frames], [0.9, 0], clamp);
  const base: React.CSSProperties = { ...style, position: "relative", whiteSpace: "nowrap" };
  return (
    <div style={base}>
      {o > 0 && (
        <>
          <div style={{ position: "absolute", inset: 0, color: a, opacity: o, transform: `translate(${-d}px, ${d * 0.3}px)` }}>
            {children}
          </div>
          <div style={{ position: "absolute", inset: 0, color: b, opacity: o, transform: `translate(${d}px, ${-d * 0.3}px)` }}>
            {children}
          </div>
        </>
      )}
      <div style={{ position: "relative" }}>{children}</div>
    </div>
  );
};
