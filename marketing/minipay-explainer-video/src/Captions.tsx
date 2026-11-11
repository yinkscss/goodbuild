import React from "react";
import { C, F, SAFE } from "./theme";
import { CUES, line } from "./cues";

type W = { w: string; start: number; end: number };
const chunk = (words: W[]): W[][] => {
  // split at sentence ends, then split long sentences into even parts of at most 7 words
  const segs: W[][] = [];
  let cur: W[] = [];
  for (const w of words) {
    cur.push(w);
    if (/[.?!:]$/.test(w.w)) { segs.push(cur); cur = []; }
  }
  if (cur.length) segs.push(cur);
  const out: W[][] = [];
  for (const sg of segs) {
    const n = Math.ceil(sg.length / 7);
    const size = Math.ceil(sg.length / n);
    for (let i = 0; i < sg.length; i += size) out.push(sg.slice(i, i + size));
  }
  return out;
};

/** Word-by-word captions in the bottom safe area, synced to the narration. */
export const Captions: React.FC<{ t: number; dark?: boolean }> = ({ t }) => {
  const ids = Object.keys(CUES.lines);
  const id = ids.find((k) => t >= line(k).start - 0.04 && t < line(k).end + 0.22);
  if (!id) return null;
  const l = line(id);
  const chunks = chunk(l.words);
  let ci = chunks.findIndex((c) => t < c[c.length - 1].end + 0.0001);
  if (ci < 0) ci = chunks.length - 1;
  const words = chunks[ci];
  const appear = Math.min(1, (t - (words[0].start - 0.04)) / 0.12);
  const out = t > l.end ? Math.max(0, 1 - (t - l.end) / 0.22) : 1;
  return (
    <div style={{ position: "absolute", left: SAFE.x, width: SAFE.w, bottom: 1920 - SAFE.bottom, display: "flex", justifyContent: "center", opacity: Math.min(appear, out) }}>
      <div style={{ background: "rgba(255,255,255,.96)", borderRadius: 40, padding: "30px 38px", boxShadow: "0 30px 70px -30px rgba(18,10,28,.55)", textAlign: "center", fontFamily: F.ui, fontWeight: 700, fontSize: 46, lineHeight: 1.32, letterSpacing: "-0.01em", maxWidth: SAFE.w, boxSizing: "border-box", transform: `translateY(${(1 - Math.min(appear, 1)) * 14}px)` }}>
        {words.map((w, i) => {
          const state = t >= w.end ? "past" : t >= w.start ? "now" : "next";
          return (
            <span key={i} style={{ display: "inline-block", padding: "0 8px", margin: "2px 0", borderRadius: 14, color: state === "next" ? "rgba(17,17,17,.28)" : C.ink, background: state === "now" ? C.pink : "transparent" }}>
              {w.w}
            </span>
          );
        })}
      </div>
    </div>
  );
};
