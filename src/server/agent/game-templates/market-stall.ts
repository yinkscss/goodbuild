import type { GameTemplate } from "./index";
import { appFor } from "./shared";

/**
 * Market stall (D150, genre templates part 2): an idle and clicker game in short shifts. Tap to serve
 * customers; spend what you earn on helpers who serve by themselves and on better prices. Upgrades stay
 * on this device between shifts, so every shift earns more: the idle part. A rush customer now and then
 * doubles takings for a moment. Each shift is a round with a score (D112), so it can go on the board.
 * Original to GoodBuild.
 */

const SHOP = `// The stall, its upgrades and how they add up, apart from the screen. Change the names, prices and
// numbers to fit the plan (a bakery, a farm, a space mine).

export const GAME_NAME = "Market Stall";
export const BEST_KEY = "market-stall";
/** Seconds in one shift. */
export const SHIFT = 10;

export interface Upgrade {
  id: string;
  name: string;
  /** What the first one costs; each one after costs COST_GROWTH times more. */
  cost: number;
  /** Coins a tap earns, added per one owned. */
  perTap: number;
  /** Coins a second, added per one owned. */
  perSecond: number;
}

export const COST_GROWTH = 1.6;

export const UPGRADES: Upgrade[] = [
  { id: "sign", name: "Brighter sign", cost: 15, perTap: 1, perSecond: 0 },
  { id: "helper", name: "Helper", cost: 40, perTap: 0, perSecond: 2 },
  { id: "cart", name: "Second cart", cost: 120, perTap: 3, perSecond: 4 },
  { id: "van", name: "Delivery van", cost: 400, perTap: 0, perSecond: 15 },
];

/** How many of each upgrade the player owns. */
export type Owned = Record<string, number>;

export const priceOf = (u: Upgrade, owned: Owned) => Math.round(u.cost * Math.pow(COST_GROWTH, owned[u.id] ?? 0));
export const perTap = (owned: Owned) => 1 + UPGRADES.reduce((s, u) => s + u.perTap * (owned[u.id] ?? 0), 0);
export const perSecond = (owned: Owned) => UPGRADES.reduce((s, u) => s + u.perSecond * (owned[u.id] ?? 0), 0);

const SAVE_KEY = "market-stall-save";

/** The stall as it was left: upgrades and coins in the till. Kept on this device only. */
export function loadStall(): { owned: Owned; till: number } {
  try {
    const raw = JSON.parse(localStorage.getItem(SAVE_KEY) ?? "{}") as { owned?: Owned; till?: number };
    return { owned: raw.owned ?? {}, till: Math.max(0, Number(raw.till) || 0) };
  } catch {
    return { owned: {}, till: 0 };
  }
}

export function saveStall(owned: Owned, till: number) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ owned, till: Math.floor(till) }));
  } catch {
    // Private windows may refuse. The stall just starts fresh next time.
  }
}
`;

const GAME = `import { useEffect, useRef, useState } from "react";
import { GameOver } from "../game/GameOver";
import { GameSettings } from "../game/GameSettings";
import { Leaderboard, PostScore } from "../game/Leaderboard";
import { TopThree } from "../game/TopThree";
import { firstTime } from "../game/extras";
import { buzz } from "../game/haptics";
import { useLeaderboard } from "../game/leaderboard";
import { declareGame, moved, probe, round, spawned } from "../game/probe";
import { sfx } from "../game/sound";
import { bestScore, saveBest } from "../game/storage";
import { BEST_KEY, GAME_NAME, SHIFT, UPGRADES, loadStall, perSecond, perTap, priceOf, saveStall, type Owned } from "./shop";

// A game played with buttons, in short shifts, with a rush power-up. Keep this in step with what the game has.
declareGame({ style: "puzzle", controls: ["buttons"], powerups: ["rush"] });

/** A rush customer doubles takings for this many seconds. */
const RUSH_SECONDS = 3;

type Screen = "start" | "playing" | "over";

export default function Game() {
  const [screen, setScreen] = useState<Screen>("start");
  const [owned, setOwned] = useState<Owned>(() => loadStall().owned);
  const [till, setTill] = useState(() => loadStall().till);
  const [earned, setEarned] = useState(0);
  const [rush, setRush] = useState(false);
  const [best, setBest] = useState(() => bestScore(BEST_KEY));
  const [tip] = useState(() => firstTime("market-stall-tip"));
  const board = useLeaderboard();
  const earnedRef = useRef(0);
  const tillRef = useRef(till);
  const ownedRef = useRef(owned);
  ownedRef.current = owned;
  const rushLeft = useRef(0);
  const rushAt = useRef(0);
  const bar = useRef<HTMLDivElement>(null);

  const earn = (coins: number) => {
    const amount = coins * (rushLeft.current > 0 ? 2 : 1);
    earnedRef.current += amount;
    tillRef.current += amount;
    setEarned(Math.floor(earnedRef.current));
    setTill(Math.floor(tillRef.current));
    probe(Math.floor(earnedRef.current));
  };

  const finish = () => {
    const final = Math.floor(earnedRef.current);
    probe(final);
    round(false);
    saveStall(ownedRef.current, tillRef.current);
    if (saveBest(final, BEST_KEY)) setBest(final);
    sfx.win();
    setScreen("over");
  };

  // The shift's clock, the helpers' takings and the rush customer, every frame while a shift runs.
  const finishRef = useRef(finish);
  finishRef.current = finish;
  useEffect(() => {
    if (screen !== "playing") return;
    let raf = 0;
    let last = performance.now();
    let left = SHIFT;
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      left = Math.max(0, left - dt);
      if (bar.current) bar.current.style.width = (left / SHIFT) * 100 + "%";
      const auto = perSecond(ownedRef.current) * dt;
      if (auto > 0) earn(auto);
      rushLeft.current = Math.max(0, rushLeft.current - dt);
      setRush(rushLeft.current > 0);
      // One rush customer each shift, a few seconds in.
      rushAt.current -= dt;
      if (rushAt.current <= 0 && rushAt.current > -dt) {
        rushLeft.current = RUSH_SECONDS;
        spawned("rush");
        sfx.coin();
      }
      if (left === 0) return finishRef.current();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [screen]);

  const serve = () => {
    if (screen !== "playing") return;
    moved();
    earn(perTap(owned));
    sfx.tap();
    buzz("tap");
  };

  const buy = (id: string) => {
    const u = UPGRADES.find((x) => x.id === id);
    if (!u || screen !== "playing") return;
    const price = priceOf(u, owned);
    if (tillRef.current < price) return;
    moved();
    tillRef.current -= price;
    setTill(Math.floor(tillRef.current));
    const next = { ...owned, [id]: (owned[id] ?? 0) + 1 };
    setOwned(next);
    saveStall(next, tillRef.current);
    sfx.coin();
    buzz("collect");
  };

  const start = () => {
    earnedRef.current = 0;
    rushLeft.current = 0;
    rushAt.current = 2 + Math.random() * 3;
    setEarned(0);
    setRush(false);
    setScreen("playing");
    round(true);
    probe(0);
    sfx.tap();
  };

  // Leaving the page mid-shift ends the round for the check.
  useEffect(() => () => round(false), []);

  return (
    <div className="mx-auto w-full max-w-md space-y-4">
      <div className="relative min-h-[460px] overflow-hidden rounded-2xl bg-card p-4 shadow">
        <TopThree board={board} className="absolute right-3 top-3" />
        {screen === "start" && (
          <div className="flex min-h-[420px] flex-col items-center justify-center gap-4 text-center">
            <h2 className="text-2xl font-semibold">{GAME_NAME}</h2>
            <p className="text-muted-foreground">Serve as many customers as you can in a {SHIFT}-second shift. Spend your takings on upgrades: they stay for every shift after.</p>
            {tip && <p className="text-sm">Helpers serve by themselves. Watch for the rush: takings double.</p>}
            <p className="text-sm tabular-nums">
              In the till: {till} · Per tap: {perTap(owned)} · Per second: {perSecond(owned)}
            </p>
            {best > 0 && <p className="text-sm">Best shift: {best}</p>}
            <button type="button" onClick={start} className="w-full rounded-xl bg-primary px-6 py-3 text-lg font-semibold text-primary-foreground">
              Start a shift
            </button>
          </div>
        )}
        {screen === "playing" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between pr-24 text-sm tabular-nums">
              <span>This shift: {earned}</span>
              <span>Till: {till}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div ref={bar} className="h-full bg-primary" style={{ width: "100%" }} />
            </div>
            {rush && <p className="text-center font-semibold text-primary">Rush! Takings doubled</p>}
            <div data-game-area className="space-y-3">
              <button type="button" onClick={serve} className={"w-full rounded-2xl py-10 text-2xl font-bold text-primary-foreground transition-transform active:scale-95 " + (rush ? "bg-accent" : "bg-primary")}>
                Serve +{perTap(owned) * (rush ? 2 : 1)}
              </button>
              <div className="grid grid-cols-2 gap-2">
                {UPGRADES.map((u) => {
                  const price = priceOf(u, owned);
                  return (
                    <button key={u.id} type="button" disabled={till < price} onClick={() => buy(u.id)} className="rounded-xl border bg-background p-2 text-left text-sm disabled:opacity-40">
                      <span className="block font-medium">
                        {u.name} ({owned[u.id] ?? 0})
                      </span>
                      <span className="text-muted-foreground">{price} coins</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
        {screen === "over" && (
          <GameOver score={earned} best={best} stats={[{ label: "In the till", value: till }]} onAgain={start} shareText={"I took " + earned + " in one shift at " + GAME_NAME}>
            <PostScore board={board} score={earned} />
          </GameOver>
        )}
      </div>
      {screen !== "playing" && <GameSettings />}
      <Leaderboard board={board} title="Best shifts" />
    </div>
  );
}
`;

export const marketStall: GameTemplate = {
  id: "market-stall",
  name: "Market stall",
  dims: "2d",
  style: "puzzle",
  fits: "idle, clicker and tycoon games: tap to earn, buy upgrades and helpers that earn by themselves, grow a shop, farm, factory or mine, played in short shifts",
  kits: ["game-2d"],
  files: { "src/App.tsx": appFor("./play/shop", "GAME_NAME"), "src/play/Game.tsx": GAME, "src/play/shop.ts": SHOP },
  leaderboard: true,
  title: { from: "./play/shop", name: "GAME_NAME" },
  brief: `This game starts from GoodBuild's Market stall template, a working, tested game: src/play/shop.ts (the name, the shift length, the upgrades and how they add up, and the save on this device), src/play/Game.tsx (the game) and src/App.tsx. Reshape it to the plan instead of starting again:
- Rename it (GAME_NAME, BEST_KEY) and make the stall and upgrades the plan's (a bakery, a farm, a space mine): names, prices, what each adds per tap and per second. Restyle it to the plan's look.
- Keep the shifts: a round has to end for a score to go on the board and for GoodBuild's check, so the idle part is the upgrades carrying over between shifts, not a game that never ends.
- Keep what makes it work: round(true) when a shift starts and round(false) when it ends, moved() on every tap and purchase, probe(score) when the shift's takings change, the buttons inside <div data-game-area>, spawned("rush") for the rush, GameOver with PostScore, free play with no wallet.`,
};
