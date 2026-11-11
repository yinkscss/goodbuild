import cues from "./cues.json";
import script from "./script.json";

export const FPS = 30;
export const CUES = cues;
export const UI = script.ui;
export const scene = (id: string) => (cues.scenes as Record<string, { start: number; end: number }>)[id];
type W = { w: string; start: number; end: number };
export const line = (id: string) => (cues.lines as Record<string, { start: number; end: number; text: string; words: W[] }>)[id];

/** Start time (s) of the spoken word matching `pat` in a line. nth = -1 for the last match. Throws if missing, so a script edit can't silently desync the visuals. */
export const wt = (id: string, pat: string | RegExp, nth = 0): number => {
  const re = typeof pat === "string" ? new RegExp(pat, "i") : pat;
  const hits = line(id).words.filter((w) => re.test(w.w));
  if (!hits.length) throw new Error(`cue: no word matching ${pat} in line ${id}`);
  const h = nth < 0 ? hits[hits.length + nth] : hits[nth];
  if (!h) throw new Error(`cue: match #${nth} of ${pat} missing in line ${id}`);
  return h.start;
};
export const ls = (id: string) => line(id).start;
export const le = (id: string) => line(id).end;
export const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
/** 0 -> 1 over `dur` seconds starting at t0. */
export const prog = (t: number, t0: number, dur = 0.3) => clamp01((t - t0) / dur);
export const easeOut = (p: number) => 1 - Math.pow(1 - p, 3);
export const easeBack = (p: number, k = 1.9) => 1 + (k + 1) * Math.pow(p - 1, 3) + k * Math.pow(p - 1, 2);
