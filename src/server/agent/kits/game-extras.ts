/**
 * The 2D game kit's extras (D95): what makes people play again. Near misses and combos, missions that
 * feed a season's tiers, a daily challenge, a ghost of your best run, coins earned by playing, a first
 * run tip, sharing a score, and the game-over panel on the game itself with the top three beside it.
 * The owner's Neon Drift build asked for each of the last three by hand; now they come ready.
 */

export const EXTRAS = `// Extras that make people come back. Each is small, keeps what it saves on this device, and does
// nothing until the game uses it.

function load<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage is blocked: it just isn't remembered */
  }
}

// --- Near misses and combos

/** True when two boxes don't touch but pass within margin of each other: worth a bonus. */
export function nearMiss(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }, margin = 18): boolean {
  const overlap = a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  if (overlap) return false;
  return a.x - margin < b.x + b.w && a.x + a.w + margin > b.x && a.y - margin < b.y + b.h && a.y + a.h + margin > b.y;
}

/**
 * A combo: each hit() within window seconds of the last raises the multiplier (x2, x3, up to max);
 * a pause longer than that, or break(), resets it. Show it with drawHud's combo.
 */
export class Combo {
  count = 0;
  private left = 0;

  constructor(private readonly window = 2.5, private readonly max = 5) {}

  hit(): number {
    this.count += 1;
    this.left = this.window;
    return this.multiplier;
  }

  get multiplier(): number {
    return Math.min(this.max, 1 + Math.floor(this.count / 2));
  }

  update(dt: number): void {
    if (this.left <= 0) return;
    this.left -= dt;
    if (this.left <= 0) this.count = 0;
  }

  break(): void {
    this.count = 0;
    this.left = 0;
  }
}

// --- Coins earned by playing

/** Coins kept on this device, earned in runs and spent on things that unlock by play. */
export const coins = {
  get: () => load<number>("game:coins", 0),
  add(n: number) {
    save("game:coins", Math.max(0, coins.get() + Math.floor(n)));
  },
  /** False (and nothing spent) when there aren't enough. */
  spend(n: number): boolean {
    const have = coins.get();
    if (n > have) return false;
    save("game:coins", have - n);
    return true;
  },
};

// --- Missions and season tiers

export interface Mission {
  id: string;
  /** What the player sees: "Collect 20 coins". */
  text: string;
  /** The stat it counts and how many: { stat: "coins", goal: 20 }. */
  stat: string;
  goal: number;
  /** Season XP it gives when done. */
  xp?: number;
  /** Counts within one run only (survive 60 seconds), not across runs. */
  oneRun?: boolean;
}

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Three missions a day, picked from the game's list the same way for everyone that day. Track stats
 * as they happen (missions.track("coins", 1)), call missions.endRun() at game over, show missions.list.
 * Finished missions add season XP; seasonTier(xp) says which reward tier that reaches.
 */
export class Missions {
  private state: { day: string; ids: string[]; progress: Record<string, number>; done: string[] };
  private run: Record<string, number> = {};

  constructor(private readonly all: Mission[], private readonly perDay = 3) {
    const saved = load<Missions["state"] | null>("game:missions", null);
    this.state = saved && saved.day === today() ? saved : this.newDay();
  }

  /** Today's missions, picked the same way for everyone. */
  private newDay(): Missions["state"] {
    const rand = seededRandom(dailySeed());
    const pool = [...this.all];
    const ids: string[] = [];
    while (pool.length && ids.length < this.perDay) ids.push(pool.splice(Math.floor(rand() * pool.length), 1)[0].id);
    const state = { day: today(), ids, progress: {}, done: [] };
    save("game:missions", state);
    return state;
  }

  /** A game left open past midnight moves on to the new day's missions. */
  private current(): Missions["state"] {
    if (this.state.day !== today()) {
      this.state = this.newDay();
      this.run = {};
    }
    return this.state;
  }

  get list(): Array<Mission & { progress: number; done: boolean }> {
    this.current();
    return this.state.ids
      .map((id) => this.all.find((m) => m.id === id))
      .filter((m): m is Mission => Boolean(m))
      .map((m) => ({ ...m, progress: Math.min(m.goal, m.oneRun ? this.run[m.stat] ?? 0 : this.state.progress[m.stat] ?? 0), done: this.state.done.includes(m.id) }));
  }

  /** Count a stat. Returns the missions this finished, to celebrate (a popup, a sound). */
  track(stat: string, amount = 1): Mission[] {
    this.current();
    this.run[stat] = (this.run[stat] ?? 0) + amount;
    this.state.progress[stat] = (this.state.progress[stat] ?? 0) + amount;
    const finished: Mission[] = [];
    for (const m of this.list) {
      if (!m.done && m.stat === stat && m.progress >= m.goal) {
        this.state.done.push(m.id);
        seasonXp.add(m.xp ?? 100);
        finished.push(m);
      }
    }
    save("game:missions", this.state);
    return finished;
  }

  /** Call at game over: one-run counts start again. */
  endRun(): void {
    this.run = {};
  }
}

/** XP towards the season's tiers, kept on this device. */
export const seasonXp = {
  get: () => load<number>("game:season-xp", 0),
  add(n: number) {
    save("game:season-xp", seasonXp.get() + n);
  },
};

/** Which tier an amount of XP reaches, from a list of thresholds ([0, 300, 800, 1500]). Tiers marked pass need the season pass. */
export function seasonTier(xp: number, tiers: Array<{ xp: number; reward: string; pass?: boolean }>, hasPass = false) {
  let reached = -1;
  tiers.forEach((t, i) => {
    if (xp >= t.xp) reached = i;
  });
  const next = tiers[reached + 1];
  return {
    tier: reached,
    /** Rewards the player has earned and may claim (pass tiers only with the pass). */
    unlocked: tiers.slice(0, reached + 1).filter((t) => !t.pass || hasPass),
    next,
    /** 0 to 1 towards the next tier. */
    progress: next ? (xp - (tiers[reached]?.xp ?? 0)) / (next.xp - (tiers[reached]?.xp ?? 0)) : 1,
  };
}

// --- A daily challenge

/** The same number for everyone on the same day: seed a run so everyone races the same course. */
export function dailySeed(day = today()): number {
  let h = 2166136261;
  for (const ch of day) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

/** A random-number function that gives the same sequence for the same seed. Use it in place of Math.random in a daily run. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- A ghost of the best run

/**
 * Records where the player was every tenth of a second, and keeps the path of the best run on this
 * device. During a run, ghost.at(time) gives where the best run was then: draw it faintly.
 */
export class Ghost {
  private path: number[] = [];
  private best: { score: number; path: number[] };
  private last = -1;

  constructor(private readonly key = "game:ghost") {
    this.best = load(key, { score: 0, path: [] as number[] });
  }

  start(): void {
    this.path = [];
    this.last = -1;
  }

  record(time: number, x: number, y: number): void {
    const slot = Math.floor(time * 10);
    if (slot === this.last || this.path.length > 6000) return;
    this.last = slot;
    this.path.push(Math.round(x), Math.round(y));
  }

  /** Keep this run if it beat the best. */
  finish(score: number): void {
    if (score > this.best.score && this.path.length) {
      this.best = { score, path: this.path };
      save(this.key, this.best);
    }
  }

  at(time: number): { x: number; y: number } | null {
    const i = Math.floor(time * 10) * 2;
    return i + 1 < this.best.path.length ? { x: this.best.path[i], y: this.best.path[i + 1] } : null;
  }
}

// --- Small things

/** True the first time it's called for this key on this device: show a one-line tip, once. */
export function firstTime(key: string): boolean {
  if (load<boolean>("game:seen:" + key, false)) return false;
  save("game:seen:" + key, true);
  return true;
}

/** Share a score with the phone's share sheet (WhatsApp and the rest), or copy it where there is none. */
export async function shareScore(text: string, url = window.location.href): Promise<"shared" | "copied" | "failed"> {
  try {
    if (navigator.share) {
      await navigator.share({ text, url });
      return "shared";
    }
    await navigator.clipboard.writeText(text + " " + url);
    return "copied";
  } catch {
    return "failed";
  }
}

/** The person asked their device for less motion: use less shake and fewer particles. */
export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}
`;

export const GAME_OVER_TSX = `import { useState, type ReactNode } from "react";
import { Share2 } from "lucide-react";

import { Button } from "../components/ui/button";
import { shareScore } from "./extras";

/**
 * The game-over panel, ON the game: put it inside the box that holds GameCanvas
 * (<div className="relative"> <GameCanvas ... /> {screen === "over" && <GameOver ... />} </div>), so
 * Play again is where the player's thumb already is, with nothing to scroll to. Under it, pass the
 * post-score form as children (<PostScore ... />) and it sits in the same panel.
 */
export function GameOver({
  score,
  best,
  stats = [],
  onAgain,
  againLabel = "Play again",
  shareText,
  children,
}: {
  score: number;
  best: number;
  /** A few more numbers from the run: [{ label: "Distance", value: "1,240 m" }, { label: "Coins", value: 32 }]. */
  stats?: Array<{ label: string; value: ReactNode }>;
  onAgain: () => void;
  againLabel?: string;
  /** Offer Share with this text ("I drove 1,240 m in Neon Drift"). */
  shareText?: string;
  children?: ReactNode;
}) {
  const [shared, setShared] = useState<string | null>(null);
  const newBest = score > 0 && score >= best;
  return (
    <div role="dialog" aria-label="Game over" className="absolute inset-x-3 bottom-3 max-h-[85%] overflow-y-auto rounded-2xl bg-card/95 p-4 text-foreground shadow-xl backdrop-blur">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm text-muted-foreground">Game over</p>
        {newBest && <p className="text-sm font-semibold text-accent">New best!</p>}
      </div>
      <p className="text-4xl font-bold tabular-nums">{Math.floor(score).toLocaleString()}</p>
      <dl className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
        <div className="rounded-lg bg-muted p-2">
          <dt className="text-muted-foreground">Best</dt>
          <dd className="text-sm font-semibold tabular-nums">{Math.floor(Math.max(best, score)).toLocaleString()}</dd>
        </div>
        {stats.slice(0, 5).map((s) => (
          <div key={s.label} className="rounded-lg bg-muted p-2">
            <dt className="text-muted-foreground">{s.label}</dt>
            <dd className="text-sm font-semibold tabular-nums">{s.value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-3 flex gap-2">
        <Button className="min-h-12 flex-1 text-base" onClick={onAgain} autoFocus>
          {againLabel}
        </Button>
        {shareText && (
          <Button variant="outline" className="min-h-12" aria-label="Share your score" onClick={async () => setShared((await shareScore(shareText)) === "copied" ? "Copied" : null)}>
            <Share2 className="size-4" />
            {shared ?? "Share"}
          </Button>
        )}
      </div>
      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}
`;

export const TOP_THREE_TSX = `import type { ReactNode } from "react";
import { Trophy } from "lucide-react";

import type { BoardEntry, LeaderboardState } from "./leaderboard";

/** The top three, small enough for the race screen itself: over a corner of the canvas or just above it. */
export function TopThree({ board, icon, className = "" }: { board: LeaderboardState; icon?: (entry: BoardEntry) => ReactNode; className?: string }) {
  const top = board.top.slice(0, 3);
  if (!top.length) return null;
  return (
    <ol aria-label="Top three" className={"space-y-0.5 rounded-xl bg-card/90 px-3 py-2 text-xs shadow " + className}>
      {top.map((e, i) => (
        <li key={e.wallet} className={"flex items-center gap-2 " + (e.wallet === board.account ? "font-semibold" : "")}>
          {i === 0 ? <Trophy className="size-3 text-accent" aria-hidden /> : <span className="w-3 text-center text-muted-foreground">{i + 1}</span>}
          {icon?.(e)}
          <span className="max-w-24 truncate">{e.name}</span>
          <span className="ml-auto tabular-nums">{e.score.toLocaleString()}</span>
        </li>
      ))}
    </ol>
  );
}
`;

export const SETTINGS_TSX = `import { useState } from "react";

import { Switch } from "../components/ui/switch";
import { hapticsOn, setHaptics } from "./haptics";
import { isMuted, setMuted } from "./sound";

/** Sound and vibration switches, remembered on this device. Put it on the start screen or behind a settings button. */
export function GameSettings({ className = "" }: { className?: string }) {
  const [sound, setSound] = useState(() => !isMuted());
  const [buzz, setBuzz] = useState(() => hapticsOn());
  return (
    <div className={"space-y-3 " + className}>
      <label className="flex min-h-11 items-center justify-between gap-3 text-sm">
        Sound
        <Switch
          checked={sound}
          onCheckedChange={(on: boolean) => {
            setMuted(!on);
            setSound(on);
          }}
        />
      </label>
      <label className="flex min-h-11 items-center justify-between gap-3 text-sm">
        Vibration
        <Switch
          checked={buzz}
          onCheckedChange={(on: boolean) => {
            setHaptics(on);
            setBuzz(on);
          }}
        />
      </label>
    </div>
  );
}
`;
