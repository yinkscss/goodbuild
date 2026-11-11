import { STABLECOINS } from "@/config/stablecoins";

/**
 * The 2D game kit's building blocks (D94): spawning, computer-controlled characters, power-ups, the
 * score panel, vibration, and the probe GoodBuild's run check reads to test a game. Small files, no
 * packages, nothing allocated while the game runs. Kept beside game-2d.ts so that file stays readable.
 */

export const PROBE = `// GoodBuild's game check. The run check opens the game in a browser and plays it; these calls
// tell it what happened, so it can test that the score rises, obstacles arrive, every kind of
// obstacle, power-up and character the plan named shows up, and the controls move the player.
// In a published game, and for every real player, each call returns straight away and does nothing.
//
//   declareGame({ obstacles: ["oncoming", "oil"], powerups: ["nitro", "shield"], npcs: ["rival"] }); // once, at module level
//   spawned("oil");                          // whenever one is created
//   probe(score, player.x, player.y, speed); // once per frame in onFrame

export interface GameCatalogue {
  /** Things that get in the way: "oncoming", "oil", "gap", "spike". */
  obstacles?: string[];
  /** Things to pick up: "nitro", "shield", "magnet". */
  powerups?: string[];
  /** Computer-controlled characters: "rival", "police", "bird". */
  npcs?: string[];
}

interface Round {
  start: number;
  end?: number;
  frames: number;
  score0?: number;
  scoreMax?: number;
  speed0?: number;
  speedMax?: number;
  xMin?: number;
  xMax?: number;
  yMin?: number;
  yMax?: number;
  /** Seconds of play before the first obstacle or character appeared. */
  firstHazard?: number;
}

interface Check {
  on: boolean;
  /** Game steps per screen frame while checking, so a few seconds cover a long round. */
  speed?: number;
  time: number;
  rounds: Round[];
  /** Each kind's first appearance, in seconds of play. */
  seen: Record<string, number>;
  declared?: GameCatalogue;
  probes: number;
}

function check(): Check | undefined {
  if (typeof window === "undefined") return undefined;
  const c = (window as unknown as { __gbGame?: Check }).__gbGame;
  return c && c.on ? c : undefined;
}

function playing(c: Check): Round | undefined {
  const r = c.rounds[c.rounds.length - 1];
  return r && r.end === undefined ? r : undefined;
}

/** Name every kind of obstacle, power-up and character the game has. Once, at module level. */
export function declareGame(catalogue: GameCatalogue): void {
  const c = check();
  if (c) c.declared = { obstacles: [...(catalogue.obstacles ?? [])], powerups: [...(catalogue.powerups ?? [])], npcs: [...(catalogue.npcs ?? [])] };
}

/** Something was just created: an obstacle, a power-up or a character, by the name declareGame gave it. */
export function spawned(kind: string): void {
  const c = check();
  if (!c) return;
  if (!(kind in c.seen)) c.seen[kind] = c.time;
  const r = playing(c);
  const d = c.declared;
  const hazard = !d || Boolean(d.obstacles?.includes(kind) || d.npcs?.includes(kind));
  if (r && hazard && r.firstHazard === undefined) r.firstHazard = c.time - r.start;
}

/** Once per frame while playing: the score, where the player is, and how fast the game is going. */
export function probe(score: number, x: number, y: number, speed: number): void {
  const c = check();
  const r = c && playing(c);
  if (!c || !r) return;
  c.probes++;
  r.frames++;
  if (r.score0 === undefined) {
    r.score0 = r.scoreMax = score;
    r.speed0 = r.speedMax = speed;
    r.xMin = r.xMax = x;
    r.yMin = r.yMax = y;
    return;
  }
  if (score > r.scoreMax!) r.scoreMax = score;
  if (speed > r.speedMax!) r.speedMax = speed;
  if (x < r.xMin!) r.xMin = x;
  if (x > r.xMax!) r.xMax = x;
  if (y < r.yMin!) r.yMin = y;
  if (y > r.yMax!) r.yMax = y;
}

// For GameCanvas only.

/** How many game steps to run per screen frame: 1, or more while GoodBuild checks the game. */
export function stepsPerFrame(): number {
  return Math.max(1, Math.min(8, Math.floor(check()?.speed ?? 1)));
}

/** One game step of dt seconds was played. The check's own clock: a remounted canvas starts its time at 0 again. */
export function checkTick(dt: number): void {
  const c = check();
  if (c) c.time += dt;
}

/** The game started (playing) or stopped (not playing): a round begins or ends. */
export function checkRound(isPlaying: boolean): void {
  const c = check();
  if (!c) return;
  const r = playing(c);
  if (isPlaying && !r) c.rounds.push({ start: c.time, frames: 0 });
  else if (!isPlaying && r) r.end = c.time;
}
`;

export const WORLD = `// Spawning and difficulty: what makes a game a game rather than a demo.

/** A random number from low up to high. */
const between = (low: number, high: number) => low + Math.random() * (high - low);

/**
 * Objects reused instead of made new every frame: cars, coins, bullets. Make one pool per kind, once,
 * outside onFrame. get() hands back a free one (or null when all are busy: skip that spawn).
 *   const cars = new Pool(() => ({ active: false, x: 0, y: 0, kind: "oncoming" }), 24);
 *   const car = cars.get(); if (car) { car.x = ...; spawned(car.kind); }
 *   cars.each((c) => { c.y += speed * dt; if (c.y > height) c.active = false; });
 */
export class Pool<T extends { active: boolean }> {
  readonly items: T[] = [];

  constructor(make: () => T, size = 32) {
    for (let i = 0; i < size; i++) {
      const item = make();
      item.active = false;
      this.items.push(item);
    }
  }

  get(): T | null {
    for (const item of this.items) {
      if (!item.active) {
        item.active = true;
        return item;
      }
    }
    return null;
  }

  each(fn: (item: T) => void): void {
    for (const item of this.items) if (item.active) fn(item);
  }

  /** The first active item that passes, or undefined: use it for hits. */
  find(test: (item: T) => boolean): T | undefined {
    for (const item of this.items) if (item.active && test(item)) return item;
    return undefined;
  }

  count(): number {
    let n = 0;
    for (const item of this.items) if (item.active) n++;
    return n;
  }

  clear(): void {
    for (const item of this.items) item.active = false;
  }
}

/** How hard the game is: 0 at the start, rising to 1 after full seconds of play, never past 1. */
export function difficulty(seconds: number, full = 90): number {
  return Math.min(1, Math.max(0, seconds / full));
}

/**
 * Something on a timer that comes faster as the game gets harder. The first one arrives after
 * grace seconds (keep it short: a player must meet an obstacle within 3 seconds), then every
 * "every" seconds at the start down to "fastest" at full difficulty, never two closer than "fastest".
 *   const traffic = new Spawner({ every: 1.6, fastest: 0.55 });
 *   if (traffic.tick(dt, difficulty(time))) spawnCar();
 */
export class Spawner {
  private wait: number;

  constructor(private readonly options: { every: number; fastest: number; grace?: number; jitter?: number }) {
    this.wait = options.grace ?? 1.2;
  }

  tick(dt: number, level = 0): boolean {
    this.wait -= dt;
    if (this.wait > 0) return false;
    const { every, fastest, jitter = 0.25 } = this.options;
    const gap = every + (fastest - every) * Math.min(1, Math.max(0, level));
    this.wait = Math.max(fastest, gap * between(1 - jitter, 1 + jitter));
    return true;
  }

  /** For a new round. */
  reset(grace = this.options.grace ?? 1.2): void {
    this.wait = grace;
  }
}

/** The centre x of each of n lanes across the game's width, with margin left and right. */
export function lanes(n: number, width: number, margin = 0): number[] {
  const inner = width - margin * 2;
  return Array.from({ length: n }, (_, i) => margin + (inner / n) * (i + 0.5));
}

/** One item from a list. Weights, when given, make some come up more often. */
export function pick<T>(items: readonly T[], weights?: readonly number[]): T {
  if (!weights) return items[Math.floor(Math.random() * items.length)];
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i] ?? 0;
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}
`;

export const NPC = `// Computer-controlled characters: traffic, oncoming cars, chasers, patrols, shooters and rivals.
// Each is fair by default: it signals before it acts (warn rises from 0 to 1 while it gets ready:
// draw a blinker, a flash or a "!" while warn > 0), so a player can react.

export interface Actor {
  active: boolean;
  /** The name you gave declareGame: "oncoming", "rival". */
  kind: string;
  x: number;
  y: number;
  w: number;
  h: number;
  vx: number;
  vy: number;
  /** Which lane it is in, for lane games. */
  lane: number;
  /** Seconds until its next move. */
  timer: number;
  /** 0 to 1 while it signals its next move. Draw something while it is above 0. */
  warn: number;
  /** -1 or 1: which way its next move goes. */
  dir: number;
}

/** A fresh actor, for a Pool: new Pool(newActor, 24). */
export function newActor(): Actor {
  return { active: false, kind: "", x: 0, y: 0, w: 40, h: 70, vx: 0, vy: 0, lane: 0, timer: 0, warn: 0, dir: 1 };
}

/** Put an actor in place for a new life. */
export function place(a: Actor, kind: string, x: number, y: number, w = a.w, h = a.h): Actor {
  a.kind = kind;
  a.x = x;
  a.y = y;
  a.w = w;
  a.h = h;
  a.vx = a.vy = 0;
  a.warn = 0;
  a.timer = 1 + Math.random() * 2;
  a.dir = Math.random() < 0.5 ? -1 : 1;
  return a;
}

/** Slide toward a lane's x, a little each frame. */
function steer(a: Actor, laneXs: readonly number[], dt: number, rate = 6) {
  const target = laneXs[a.lane] ?? a.x;
  a.x += (target - a.x) * Math.min(1, rate * dt);
}

/**
 * Traffic you overtake: moves down the screen at speed (how fast the road scrolls past it) and now
 * and then changes lane, blinking for warnFor seconds first.
 */
export function traffic(a: Actor, dt: number, o: { speed: number; laneXs: readonly number[]; changeEvery?: number; warnFor?: number }): void {
  a.y += o.speed * dt;
  a.timer -= dt;
  const warnFor = o.warnFor ?? 0.7;
  if (a.timer <= warnFor && a.timer > 0) a.warn = 1 - a.timer / warnFor;
  if (a.timer <= 0) {
    const next = a.lane + a.dir;
    if (next >= 0 && next < o.laneXs.length) a.lane = next;
    a.dir = Math.random() < 0.5 ? -1 : 1;
    a.timer = (o.changeEvery ?? 2.5) * (0.7 + Math.random() * 0.6);
    a.warn = 0;
  }
  steer(a, o.laneXs, dt);
}

/** Coming straight at the player, fast: headlights first (warn is 1 while it is above the screen). */
export function oncoming(a: Actor, dt: number, o: { speed: number }): void {
  a.y += o.speed * dt;
  a.warn = a.y < 0 ? 1 : 0;
}

/** Follows the target, faster when far and slower when close, never above maxSpeed: tense but escapable. */
export function chaser(a: Actor, dt: number, target: { x: number; y: number }, o: { speed: number; maxSpeed?: number }): void {
  const dx = target.x - a.x;
  const dy = target.y - a.y;
  const distance = Math.hypot(dx, dy) || 1;
  const speed = Math.min(o.maxSpeed ?? o.speed * 1.6, o.speed * (0.6 + Math.min(distance, 400) / 400));
  a.vx = (dx / distance) * speed;
  a.vy = (dy / distance) * speed;
  a.x += a.vx * dt;
  a.y += a.vy * dt;
}

/** Back and forth between from and to along x (or y). */
export function patrol(a: Actor, dt: number, o: { from: number; to: number; speed: number; axis?: "x" | "y" }): void {
  const axis = o.axis ?? "x";
  a[axis] += a.dir * o.speed * dt;
  if (a[axis] <= Math.min(o.from, o.to)) a.dir = 1;
  if (a[axis] >= Math.max(o.from, o.to)) a.dir = -1;
}

/** Fires on a timer, after warning for warnFor seconds. True on the frame it fires: spawn the shot then. */
export function shooter(a: Actor, dt: number, o: { every: number; warnFor?: number }): boolean {
  a.timer -= dt;
  const warnFor = o.warnFor ?? 0.6;
  a.warn = a.timer <= warnFor && a.timer > 0 ? 1 - a.timer / warnFor : 0;
  if (a.timer > 0) return false;
  a.timer = o.every * (0.8 + Math.random() * 0.4);
  a.warn = 0;
  return true;
}

/**
 * A rival racing beside the player: holds a little ahead, and every so often blinks, then moves into
 * the player's lane to block. Moves up the screen when the player is slower, down when faster.
 */
export function rival(a: Actor, dt: number, player: { lane: number }, o: { laneXs: readonly number[]; drift?: number; blockEvery?: number; warnFor?: number }): void {
  a.y += (o.drift ?? 0) * dt;
  a.timer -= dt;
  const warnFor = o.warnFor ?? 0.8;
  a.warn = a.timer <= warnFor && a.timer > 0 ? 1 - a.timer / warnFor : 0;
  if (a.timer <= 0) {
    a.lane = player.lane;
    a.timer = (o.blockEvery ?? 3) * (0.8 + Math.random() * 0.4);
    a.warn = 0;
  }
  steer(a, o.laneXs, dt, 4);
}

/** True when it has left the screen by more than margin: set active = false then. */
export function offscreen(a: Actor, width: number, height: number, margin = 120): boolean {
  return a.x < -margin || a.x > width + margin || a.y < -margin * 3 || a.y > height + margin;
}

/** The actor's hit box, a little smaller than what is drawn, so near misses feel fair. x, y is its centre. */
export function hitBox(a: Actor, shrink = 0.8): { x: number; y: number; w: number; h: number } {
  const w = a.w * shrink;
  const h = a.h * shrink;
  return { x: a.x - w / 2, y: a.y - h / 2, w, h };
}
`;

export const POWERUPS = `// Power-ups that last a few seconds: a shield, a magnet, slow motion, double score, a boost.
//   const effects = new Effects();             // once, outside onFrame
//   effects.activate("shield", 5);             // when one is picked up
//   if (effects.isActive("shield")) ...        // in the game's rules
//   effects.update(dt, (name) => sfx.tap());   // every frame; the callback runs when one ends
//   drawHud(ctx, width, { score, effects });   // shows each one's shrinking bar

export type EffectName = "shield" | "magnet" | "slow" | "double" | "boost" | "life" | (string & {});

/** Colours for the bars of the common effects. Others get the accent. */
export const EFFECT_COLOURS: Record<string, string> = {
  shield: "#38bdf8",
  magnet: "#f472b6",
  slow: "#a78bfa",
  double: "#facc15",
  boost: "#fb923c",
  life: "#4ade80",
};

export class Effects {
  private left = new Map<string, number>();
  private total = new Map<string, number>();

  /** Start one, or top it up if it's already running. */
  activate(name: EffectName, seconds: number): void {
    const now = this.left.get(name) ?? 0;
    const next = Math.max(now, seconds);
    this.left.set(name, next);
    this.total.set(name, Math.max(next, this.total.get(name) ?? 0));
  }

  isActive(name: EffectName): boolean {
    return (this.left.get(name) ?? 0) > 0;
  }

  /** Seconds left, 0 when it isn't running. */
  remaining(name: EffectName): number {
    return Math.max(0, this.left.get(name) ?? 0);
  }

  /** 1 when it has just started, falling to 0 as it runs out. */
  fraction(name: EffectName): number {
    const total = this.total.get(name) ?? 0;
    return total > 0 ? Math.min(1, this.remaining(name) / total) : 0;
  }

  /** End one now (a shield that took a hit). */
  end(name: EffectName): void {
    this.left.delete(name);
    this.total.delete(name);
  }

  update(dt: number, onEnd?: (name: string) => void): void {
    for (const [name, left] of this.left) {
      const next = left - dt;
      if (next > 0) {
        this.left.set(name, next);
      } else {
        this.left.delete(name);
        this.total.delete(name);
        onEnd?.(name);
      }
    }
  }

  /** Each running effect, for drawing. */
  each(fn: (name: string, fraction: number) => void): void {
    for (const name of this.left.keys()) fn(name, this.fraction(name));
  }

  clear(): void {
    this.left.clear();
    this.total.clear();
  }
}
`;

export const HUD = `import type { Effects } from "./powerups";
import { EFFECT_COLOURS } from "./powerups";

// The score panel at the top of the game: easy to read on any background, the same in every game.
// Call drawHud last in onFrame, after the game and the particles.

/** A dark rounded box to put text on. */
export function drawPanel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, radius = 12): void {
  ctx.fillStyle = "rgba(10, 12, 20, 0.62)";
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
  ctx.fill();
}

/**
 * The score, and whatever else the game counts. distance in metres, lives as hearts, combo as "x3",
 * and a shrinking bar for each running power-up under the panel.
 */
export function drawHud(
  ctx: CanvasRenderingContext2D,
  width: number,
  o: { score: number; best?: number; distance?: number; lives?: number; combo?: number; effects?: Effects; accent?: string; font?: string },
): void {
  const font = o.font ?? "system-ui, sans-serif";
  const panelW = Math.min(width - 24, 200);
  drawPanel(ctx, 12, 12, panelW, o.distance !== undefined || o.best !== undefined ? 58 : 44);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 26px " + font;
  ctx.fillText(Math.floor(o.score).toLocaleString(), 24, 44);
  ctx.font = "12px " + font;
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  const under = [o.distance !== undefined ? Math.floor(o.distance) + " m" : "", o.best !== undefined ? "Best " + Math.floor(o.best).toLocaleString() : ""].filter(Boolean).join("  ·  ");
  if (under) ctx.fillText(under, 24, 62);
  if (o.combo && o.combo > 1) {
    ctx.fillStyle = o.accent ?? "#facc15";
    ctx.font = "bold 18px " + font;
    ctx.textAlign = "right";
    ctx.fillText("x" + o.combo, 12 + panelW - 12, 40);
    ctx.textAlign = "left";
  }
  if (o.lives !== undefined) {
    ctx.font = "18px " + font;
    ctx.textAlign = "right";
    ctx.fillText("❤".repeat(Math.max(0, Math.min(5, o.lives))), width - 16, 38);
    ctx.textAlign = "left";
  }
  let row = 0;
  o.effects?.each((name, fraction) => {
    const y = 78 + row * 14;
    ctx.fillStyle = "rgba(10, 12, 20, 0.5)";
    ctx.fillRect(12, y, panelW, 8);
    ctx.fillStyle = EFFECT_COLOURS[name] ?? o.accent ?? "#ffffff";
    ctx.fillRect(12, y, panelW * fraction, 8);
    row++;
  });
}

/** A big centred message over the game: "Ready?", "Shield!", "Level 2". */
export function drawBanner(ctx: CanvasRenderingContext2D, width: number, height: number, text: string, colour = "#ffffff"): void {
  ctx.font = "bold 32px system-ui, sans-serif";
  const w = Math.min(width - 32, ctx.measureText(text).width + 48);
  drawPanel(ctx, (width - w) / 2, height / 2 - 34, w, 56, 16);
  ctx.fillStyle = colour;
  ctx.textAlign = "center";
  ctx.fillText(text, width / 2, height / 2 + 6);
  ctx.textAlign = "left";
}
`;

export const HAPTICS = `import { isMuted } from "./sound";

// A small buzz on phones that can (most Android phones; iPhones ignore it). Off with the mute button,
// or on its own with the Vibration switch (GameSettings).
const PATTERNS = { tap: 10, collect: [12, 30, 12], hit: 60, over: [80, 60, 120] } as const;

let on = true;
try {
  on = window.localStorage.getItem("game-haptics") !== "0";
} catch {
  /* storage is blocked: vibration stays on */
}

export function hapticsOn(): boolean {
  return on;
}

export function setHaptics(value: boolean): void {
  on = value;
  try {
    window.localStorage.setItem("game-haptics", value ? "1" : "0");
  } catch {
    /* fine */
  }
}

export function buzz(kind: keyof typeof PATTERNS = "tap"): void {
  if (!on || isMuted()) return;
  try {
    navigator.vibrate?.(PATTERNS[kind] as number | number[]);
  } catch {
    /* not allowed here: nothing to do */
  }
}
`;

export const CHAIN_TX = `import { createWalletClient, custom, erc20Abi, type Abi, type Address } from "viem";

import { chain, publicClient, writeContract } from "../lib/chain";
import { connectWallet, isMiniPay, walletProvider } from "../lib/goodbuild/wallet";

/** Dollar coins that can pay Celo's network fee, per network (MiniPay players hold these, not CELO). */
const FEE_COINS: Record<string, { address: string; decimals: number; feeCurrency: string }[]> = __FEE_COINS__;

/**
 * Send a contract call from a game and wait for it. In a browser it is a normal wallet transaction.
 * Inside MiniPay the network fee is paid in the first dollar coin the player has a few cents of, as
 * a plain (legacy) transaction, which is what MiniPay accepts.
 */
export async function sendGameTx(args: { address: Address; abi: Abi; functionName: string; args?: readonly unknown[] }) {
  if (!isMiniPay()) return writeContract(args);
  const account = await connectWallet();
  const feeCurrency = await feeCoin(account);
  const wallet = createWalletClient({ account, chain, transport: custom(walletProvider()!) });
  const hash = await wallet.writeContract({ ...args, feeCurrency, type: "legacy" } as never);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("That didn't go through. Nothing was taken except the network fee. Please try again.");
  return receipt;
}

async function feeCoin(owner: Address): Promise<Address> {
  for (const coin of FEE_COINS[String(chain.id)] ?? []) {
    try {
      const balance = (await publicClient.readContract({ address: coin.address as Address, abi: erc20Abi, functionName: "balanceOf", args: [owner] } as never)) as bigint;
      if (balance >= 10n ** BigInt(coin.decimals) / 100n) return coin.feeCurrency as Address;
    } catch {
      /* this coin can't be read here: try the next */
    }
  }
  throw new Error("This needs a few cents in USDm, USDT or USDC for the network fee. Add cash and try again.");
}
`.replace(
  "__FEE_COINS__",
  JSON.stringify(
    Object.fromEntries(Object.entries(STABLECOINS).map(([chainId, coins]) => [chainId, Object.values(coins).map((c) => ({ address: c.address, decimals: c.decimals, feeCurrency: c.feeCurrency }))])),
    null,
    2,
  ),
);
