import type { GameTemplate } from "./index";
import { KEEP_2D, appFor } from "./shared";

/**
 * Crane stack (D150, genre templates part 2): a block swings on a crane; tap to drop it on the tower.
 * What hangs over the edge is cut off, so the blocks get narrower unless you drop true; a perfect drop
 * keeps the full width and scores a bonus. Gusts of wind push the swing; a wide block and slow swing
 * help. A miss ends the round. Canvas "action" with one control, the tap (D112). Original to GoodBuild.
 */

const ART = `// How everything in the game looks. Change the colours and shapes to fit the plan's look.

export const GAME_NAME = "Crane Stack";
export const BEST_KEY = "crane-stack";

export const COLOURS = {
  skyTop: "#fde68a",
  skyBottom: "#fef3c7",
  ground: "#78716c",
  crane: "#334155",
  blocks: ["#f97316", "#0ea5e9", "#22c55e", "#e11d48", "#a855f7", "#eab308"],
  wind: "#64748b",
  wide: "#22c55e",
  slow: "#a78bfa",
};

export function drawSky(ctx: CanvasRenderingContext2D, width: number, height: number, ground: number) {
  const sky = ctx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, COLOURS.skyTop);
  sky.addColorStop(1, COLOURS.skyBottom);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = COLOURS.ground;
  ctx.fillRect(0, ground, width, height - ground);
}

/** One block of the tower, its colour picked by its height. */
export function drawBlock(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, level: number) {
  ctx.fillStyle = COLOURS.blocks[level % COLOURS.blocks.length];
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = "rgba(255,255,255,0.3)";
  ctx.fillRect(x, y, w, 4);
  ctx.strokeStyle = "rgba(0,0,0,0.2)";
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
}

/** The crane arm and its cable down to the swinging block. */
export function drawCrane(ctx: CanvasRenderingContext2D, width: number, x: number, cableTop: number, blockY: number) {
  ctx.strokeStyle = COLOURS.crane;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(0, cableTop);
  ctx.lineTo(width, cableTop);
  ctx.stroke();
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, cableTop);
  ctx.lineTo(x, blockY);
  ctx.stroke();
}

/** A gust: streaks across the sky the way the wind blows. */
export function drawWind(ctx: CanvasRenderingContext2D, width: number, y: number, dir: number, time: number) {
  ctx.strokeStyle = COLOURS.wind;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 3;
  for (let i = 0; i < 4; i++) {
    const x = ((time * 260 * dir + i * 97) % width + width) % width;
    ctx.beginPath();
    ctx.moveTo(x, y + i * 14);
    ctx.lineTo(x - 30 * dir, y + i * 14);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/** A pick-up floating beside the crane: a disc with a letter. */
export function drawPickup(ctx: CanvasRenderingContext2D, x: number, y: number, kind: string, time: number) {
  const r = 14 + Math.sin(time * 6) * 2;
  ctx.fillStyle = kind === "wide" ? COLOURS.wide : COLOURS.slow;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#0f172a";
  ctx.font = "bold 14px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(kind === "wide" ? "W" : "S", x, y + 1);
  ctx.textAlign = "start";
  ctx.textBaseline = "alphabetic";
}
`;

const GAME = `import { useRef, useState } from "react";
import { GameCanvas, type Frame } from "../game/GameCanvas";
import { GameMenu } from "../game/GameMenu";
import { GameOver } from "../game/GameOver";
import { GameSettings } from "../game/GameSettings";
import { Leaderboard, PostScore } from "../game/Leaderboard";
import { TopThree } from "../game/TopThree";
import { firstTime, prefersReducedMotion } from "../game/extras";
import { buzz } from "../game/haptics";
import { drawBanner, drawHud } from "../game/hud";
import { Particles, Popups, Shake } from "../game/juice";
import { useLeaderboard } from "../game/leaderboard";
import { Effects } from "../game/powerups";
import { declareGame, probe, spawned } from "../game/probe";
import { sfx } from "../game/sound";
import { bestScore, saveBest } from "../game/storage";
import { difficulty } from "../game/world";
import { BEST_KEY, GAME_NAME, drawBlock, drawCrane, drawPickup, drawSky, drawWind } from "./art";

// Everything the game has, by the names the code uses. Change it with the plan: every kind listed here
// must show up within the first 15 seconds of a round, and spawned(kind) is called when one appears.
declareGame({ style: "action", controls: ["tap"], obstacles: ["wind"], powerups: ["wide", "slow"] });

const WIDTH = 360;
const HEIGHT = 640;
const GROUND = 600;
const BLOCK_H = 28;
const START_W = 180;
/** Within this many pixels of the block below, a drop counts as perfect: no cut, a bonus. */
const PERFECT = 5;
/** How far down the tower scrolls so the top stays in view. */
const TOP_ROW = 300;
/** The order pick-ups and gusts come in at first, one per block dropped, so a short round meets them all. */
const FIRST = ["wind", "none", "wide", "none", "slow", "wind"];
const LATER = ["none", "none", "none", "wind", "wind", "wide", "slow"];

const effects = new Effects();
const particles = new Particles(prefersReducedMotion() ? 40 : 160);
const popups = new Popups();
const shake = new Shake();

type Screen = "start" | "playing" | "paused" | "over";
type Block = { x: number; w: number };
type Falling = { x: number; y: number; w: number; vy: number } | null;

const fresh = () => ({
  tower: [{ x: WIDTH / 2 - START_W / 2, w: START_W }] as Block[],
  swingT: 0,
  hangX: WIDTH / 2,
  hangW: START_W,
  falling: null as Falling,
  t: 0,
  score: 0,
  perfects: 0,
  wind: 0,
  windLeft: 0,
  pickup: "" as string,
  drops: 0,
  landed: WIDTH / 2,
  gustIn: 2,
});

export default function Game() {
  const [screen, setScreen] = useState<Screen>("start");
  const [best, setBest] = useState(() => bestScore(BEST_KEY));
  const [result, setResult] = useState({ score: 0, height: 0 });
  const [tip] = useState(() => firstTime("crane-stack-controls"));
  const board = useLeaderboard();
  const game = useRef(fresh());

  /** Screen y of a tower row (0 is the ground row), scrolled so the top stays in view. */
  const rowY = (row: number) => {
    const top = game.current.tower.length - 1;
    const scroll = Math.max(0, GROUND - BLOCK_H * (top + 1) - TOP_ROW) * -1;
    return GROUND - BLOCK_H * (row + 1) + scroll;
  };

  const drawWorld = (ctx: CanvasRenderingContext2D, width: number, height: number, time: number) => {
    const g = game.current;
    drawSky(ctx, width, height, GROUND);
    g.tower.forEach((b, i) => drawBlock(ctx, b.x, rowY(i), b.w, BLOCK_H, i));
    const hangY = rowY(g.tower.length) - 120;
    if (g.windLeft > 0) drawWind(ctx, width, 110, Math.sign(g.wind) || 1, time);
    if (g.pickup) drawPickup(ctx, width - 36, 140, g.pickup, time);
    drawCrane(ctx, width, g.hangX, 60, hangY);
    if (!g.falling) drawBlock(ctx, g.hangX - g.hangW / 2, hangY, g.hangW, BLOCK_H, g.tower.length);
    else drawBlock(ctx, g.falling.x, g.falling.y, g.falling.w, BLOCK_H, g.tower.length);
  };

  const end = () => {
    const g = game.current;
    const score = Math.floor(g.score);
    sfx.lose();
    buzz("over");
    if (saveBest(score, BEST_KEY)) setBest(score);
    setResult({ score, height: g.tower.length - 1 });
    setScreen("over");
  };

  /** Pick-ups and gusts, one chance per block dropped. */
  const nextEvent = () => {
    const g = game.current;
    const kind = g.drops < FIRST.length ? FIRST[g.drops] : LATER[Math.floor(Math.random() * LATER.length)];
    if (kind === "wind") {
      g.wind = (Math.random() < 0.5 ? -1 : 1) * (60 + Math.random() * 60);
      g.windLeft = 3;
      spawned("wind");
    } else if (kind !== "none") {
      g.pickup = kind;
      spawned(kind);
    }
  };

  const onFrame = (frame: Frame) => {
    const { ctx, width, height, dt, time, input } = frame;
    const g = game.current;
    g.t += dt;
    const level = difficulty(g.t, 60);
    // The swing quickens as the tower grows; slow time halves it for a while.
    const swing = (1.6 + level * 2.2 + g.tower.length * 0.04) * (effects.isActive("slow") ? 0.5 : 1);
    // A gust in the first seconds, then one now and then.
    g.gustIn -= dt;
    if (g.gustIn <= 0) {
      g.wind = (Math.random() < 0.5 ? -1 : 1) * (60 + Math.random() * 60);
      g.windLeft = 3;
      g.gustIn = 9 - level * 4;
      spawned("wind");
    }
    g.windLeft = Math.max(0, g.windLeft - dt);
    const push = g.windLeft > 0 ? g.wind : 0;

    if (!g.falling) {
      g.swingT += dt * swing;
      g.hangX = width / 2 + Math.sin(g.swingT) * (width / 2 - g.hangW / 2 - 8) * 0.9 + push * 0.4;
      // One control: a tap (or Space) lets the block go.
      if (input.actionPressed) {
        g.falling = { x: g.hangX - g.hangW / 2, y: rowY(g.tower.length) - 120, w: g.hangW, vy: 0 };
        sfx.tap();
      }
    } else {
      const f = g.falling;
      f.vy += 2200 * dt;
      f.y += f.vy * dt;
      f.x += push * dt;
      const target = rowY(g.tower.length);
      if (f.y >= target) {
        const below = g.tower[g.tower.length - 1];
        const left = Math.max(f.x, below.x);
        const right = Math.min(f.x + f.w, below.x + below.w);
        g.falling = null;
        g.drops += 1;
        if (right - left <= 2) {
          // Missed the tower: the block tumbles away and the round ends.
          shake.hit(10);
          sfx.hit();
          return end();
        }
        let placed: Block;
        if (Math.abs(f.x - below.x) <= PERFECT) {
          placed = { x: below.x, w: below.w };
          g.perfects += 1;
          g.score += 25;
          popups.add(below.x + below.w / 2, target - 10, "Perfect +25", "#ffffff");
          sfx.coin();
          buzz("collect");
        } else {
          placed = { x: left, w: right - left };
          particles.burst(f.x < below.x ? left : right, target + BLOCK_H / 2, { color: "#78716c" });
          buzz("tap");
        }
        g.tower.push(placed);
        g.score += 10;
        g.landed = placed.x + placed.w / 2;
        // A pick-up beside the crane is taken by the next drop that lands.
        g.hangW = placed.w;
        if (g.pickup === "wide") {
          g.hangW = START_W;
          popups.add(width / 2, 200, "Wide block!", "#ffffff");
        } else if (g.pickup === "slow") {
          effects.activate("slow", 6);
          popups.add(width / 2, 200, "Slow swing!", "#ffffff");
        }
        g.pickup = "";
        nextEvent();
      }
    }

    effects.update(dt);
    particles.update(dt);
    popups.update(dt);
    shake.update(dt);
    // Where the last block landed and how high the tower is: these change only when the player drops one.
    probe(Math.floor(g.score), g.landed, g.tower.length, swing);

    ctx.save();
    shake.apply(ctx);
    drawWorld(ctx, width, height, time);
    particles.draw(ctx);
    popups.draw(ctx);
    ctx.restore();
    drawHud(ctx, width, { score: g.score, best, effects });
    if (g.t < 1.6 && tip) drawBanner(ctx, width, height, "Tap to drop the block");
  };

  const start = () => {
    game.current = fresh();
    effects.clear();
    sfx.tap();
    setScreen("playing");
  };

  return (
    <div className="mx-auto w-full max-w-md space-y-4">
      <div className="relative">
        <GameCanvas
          width={WIDTH}
          height={HEIGHT}
          onFrame={onFrame}
          onIdleFrame={({ ctx, width, height, time }) => drawWorld(ctx, width, height, time)}
          paused={screen !== "playing"}
          onHidden={() => setScreen("paused")}
          label={GAME_NAME}
        />
        <TopThree board={board} className="absolute right-2 top-14" />
        {screen === "start" && (
          <GameMenu
            className="absolute inset-x-4 bottom-24"
            title={GAME_NAME}
            tagline="Drop the swinging block. Build the tallest tower."
            best={best}
            onPlay={start}
            howTo={["Tap (or press Space) to drop the swinging block.", "What hangs over the edge is cut off; a perfect drop keeps the full width and scores a bonus.", "Wind pushes the swing. Miss the tower and it's over."]}
            powerUps={[
              { name: "Wide block", text: "the next blocks are wider" },
              { name: "Slow swing", text: "the crane swings slower for a few seconds" },
            ]}
            wallet
          />
        )}
        {screen === "paused" && (
          <button type="button" onClick={() => setScreen("playing")} className="absolute inset-x-6 bottom-24 rounded-xl bg-primary py-3 text-lg font-semibold text-primary-foreground">
            Resume
          </button>
        )}
        {screen === "over" && (
          <GameOver score={result.score} best={best} stats={[{ label: "Tower height", value: result.height }]} onAgain={start} shareText={"I stacked " + result.height + " blocks in " + GAME_NAME}>
            <PostScore board={board} score={result.score} />
          </GameOver>
        )}
      </div>
      {screen !== "playing" && <GameSettings />}
      <Leaderboard board={board} title="Tallest towers" />
    </div>
  );
}
`;

export const craneStack: GameTemplate = {
  id: "crane-stack",
  name: "Crane stack",
  dims: "2d",
  style: "action",
  fits: "stacking and timing games: drop swinging blocks, boxes, floors or cakes to build the tallest tower, one tap to drop, anything about building high",
  kits: ["game-2d"],
  files: { "src/App.tsx": appFor("./play/art", "GAME_NAME"), "src/play/Game.tsx": GAME, "src/play/art.ts": ART },
  leaderboard: true,
  title: { from: "./play/art", name: "GAME_NAME" },
  brief: `This game starts from GoodBuild's Crane stack template, a working, tested game: src/play/Game.tsx (the game), src/play/art.ts (the name, colours and one drawing function per thing) and src/App.tsx. Reshape it to the plan instead of starting again:
- Rename it (GAME_NAME, BEST_KEY in art.ts) and restyle every drawing and colour to the plan's look: what's stacked, the crane, the sky.
- Make the gusts and pick-ups the plan's: change FIRST, LATER, nextEvent and how fast the swing quickens, and keep declareGame listing exactly the kinds the game has, with spawned(kind) when one appears. Every kind must show up within the first 15 seconds.
- Keep the probe reporting where the last block landed and the tower's height: they change only when the player drops a block, which is how GoodBuild sees the tap works.
- ${KEEP_2D}`,
};
