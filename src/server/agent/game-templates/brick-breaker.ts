import type { GameTemplate } from "./index";
import { KEEP_2D, appFor } from "./shared";

/**
 * Brick breaker (D117): bounce a ball off a paddle to break a wall of bricks. Tough bricks take two
 * hits, a drifter slides across the middle and drops bombs, a wide paddle and extra balls fall as
 * power-ups. Lives, a fresh wall each time one is cleared, the leaderboard on the game.
 * Original to GoodBuild: named for how it plays.
 */

const ART = `// How everything in the game looks. Each thing is drawn by one function, used in the game and in
// Sprite cards outside it. Change the colours and shapes to fit the plan's look.

export const GAME_NAME = "Brick Breaker";
export const BEST_KEY = "brick-breaker";

export const COLOURS = {
  back: "#0f172a",
  grid: "rgba(148,163,184,0.08)",
  paddle: "#38bdf8",
  ball: "#f8fafc",
  rows: ["#f43f5e", "#f97316", "#facc15", "#4ade80", "#60a5fa"],
  hard: "#94a3b8",
  drifter: "#a855f7",
  bomb: "#ef4444",
  wide: "#22d3ee",
  multi: "#f472b6",
};

export function drawPaddle(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = COLOURS.paddle;
  ctx.fillRect(x + h / 2, y, w - h, h);
  ctx.beginPath();
  ctx.arc(x + h / 2, y + h / 2, h / 2, 0, Math.PI * 2);
  ctx.arc(x + w - h / 2, y + h / 2, h / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.fillRect(x + h / 2, y + 2, w - h, 3);
}

export function drawBall(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.fillStyle = COLOURS.ball;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

/** A brick in the box x, y, w, h. hits is how many more hits it takes: a tough brick shows a crack after one. */
export function drawBrick(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, colour: string, hits = 1, tough = false) {
  ctx.fillStyle = colour;
  ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
  ctx.fillStyle = "rgba(255,255,255,0.25)";
  ctx.fillRect(x + 1, y + 1, w - 2, 3);
  if (tough) {
    ctx.strokeStyle = "rgba(15,23,42,0.6)";
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 4, y + 4, w - 8, h - 8);
    if (hits === 1) {
      ctx.beginPath();
      ctx.moveTo(x + w * 0.3, y + 2);
      ctx.lineTo(x + w * 0.45, y + h * 0.6);
      ctx.lineTo(x + w * 0.6, y + h - 2);
      ctx.stroke();
    }
  }
}

export function drawDrifter(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, warn: number) {
  ctx.fillStyle = COLOURS.drifter;
  ctx.fillRect(x - w / 2, y - h / 2, w, h);
  ctx.fillStyle = warn > 0 ? "#fde047" : "#f5d0fe";
  ctx.beginPath();
  ctx.arc(x - w * 0.2, y, h * 0.2, 0, Math.PI * 2);
  ctx.arc(x + w * 0.2, y, h * 0.2, 0, Math.PI * 2);
  ctx.fill();
}

export function drawBomb(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, time: number) {
  ctx.fillStyle = COLOURS.bomb;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = Math.floor(time * 10) % 2 ? "#fde047" : "#ffffff";
  ctx.fillRect(x - 2, y - r - 5, 4, 5);
}

/** A power-up: a capsule with a letter. */
export function drawPickup(ctx: CanvasRenderingContext2D, x: number, y: number, kind: string) {
  ctx.fillStyle = kind === "wide" ? COLOURS.wide : COLOURS.multi;
  ctx.fillRect(x - 18, y - 9, 36, 18);
  ctx.fillStyle = "#0f172a";
  ctx.font = "bold 13px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(kind === "wide" ? "W" : "+3", x, y + 1);
  ctx.textAlign = "start";
  ctx.textBaseline = "alphabetic";
}

export function drawBack(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.fillStyle = COLOURS.back;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = COLOURS.grid;
  for (let x = 0; x < width; x += 24) ctx.fillRect(x, 0, 1, height);
  for (let y = 0; y < height; y += 24) ctx.fillRect(0, y, width, 1);
}
`;

const GAME = `import { useRef, useState } from "react";
import { GameCanvas, type Frame } from "../game/GameCanvas";
import { GameMenu } from "../game/GameMenu";
import { GameOver } from "../game/GameOver";
import { GameSettings } from "../game/GameSettings";
import { Leaderboard, PostScore } from "../game/Leaderboard";
import { Sprite } from "../game/Sprite";
import { TopThree } from "../game/TopThree";
import { Combo, firstTime, prefersReducedMotion } from "../game/extras";
import { buzz } from "../game/haptics";
import { drawBanner, drawHud } from "../game/hud";
import { Particles, Popups, Shake, hitCircleRect, hitRect } from "../game/juice";
import { useLeaderboard } from "../game/leaderboard";
import { newActor, patrol, place, shooter } from "../game/npc";
import { Effects } from "../game/powerups";
import { declareGame, probe, spawned } from "../game/probe";
import { sfx } from "../game/sound";
import { bestScore, saveBest } from "../game/storage";
import { Pool, Spawner, difficulty } from "../game/world";
import { BEST_KEY, COLOURS, GAME_NAME, drawBack, drawBall, drawBomb, drawBrick, drawDrifter, drawPaddle, drawPickup } from "./art";

// Everything the game has, by the names the code uses. Change it with the plan: every kind listed here
// must show up within the first 15 seconds of a round, and spawned(kind) is called when one appears.
declareGame({ style: "action", controls: ["drag", "sides", "keys"], obstacles: ["hardBrick", "bomb"], powerups: ["wide", "multi"], npcs: ["drifter"] });

const WIDTH = 360;
const HEIGHT = 640;
const PADDLE_Y = 580;
const PADDLE_H = 14;
const BALL_R = 7;
const COLS = 7;
const ROWS = 5;
const BRICK_W = (WIDTH - 24) / COLS;
const BRICK_H = 22;
const TOP = 110;
const LIVES = 3;
const POWER_KINDS = ["wide", "multi"];

type Ball = { active: boolean; x: number; y: number; vx: number; vy: number; stuck: number };
type Brick = { active: boolean; x: number; y: number; hits: number; tough: boolean; colour: string };

// Made once, reused every round: nothing is created while the game runs.
const balls = new Pool<Ball>(() => ({ active: false, x: 0, y: 0, vx: 0, vy: 0, stuck: 0 }), 3);
const bricks = new Pool<Brick>(() => ({ active: false, x: 0, y: 0, hits: 1, tough: false, colour: "" }), COLS * ROWS);
const falling = new Pool(newActor, 10);
const drifter = newActor();
const powerSpawner = new Spawner({ every: 4, fastest: 3.5, grace: 2.5 });
const effects = new Effects();
const combo = new Combo();
const particles = new Particles(prefersReducedMotion() ? 40 : 160);
const popups = new Popups();
const shake = new Shake();

type Screen = "start" | "playing" | "paused" | "over";

const fresh = () => ({ x: WIDTH / 2, target: WIDTH / 2, t: 0, score: 0, lives: LIVES, walls: 0, broken: 0, powers: 0, needWall: true, hurt: 0 });

export default function Game() {
  const [screen, setScreen] = useState<Screen>("start");
  const [best, setBest] = useState(() => bestScore(BEST_KEY));
  const [result, setResult] = useState({ score: 0, broken: 0, walls: 0 });
  const [tip] = useState(() => firstTime("brick-breaker-controls"));
  const board = useLeaderboard();
  const game = useRef(fresh());

  const paddleW = () => (effects.isActive("wide") ? 130 : 82);

  const drawWorld = (ctx: CanvasRenderingContext2D, width: number, height: number, time: number) => {
    const g = game.current;
    drawBack(ctx, width, height);
    bricks.each((b) => drawBrick(ctx, b.x, b.y, BRICK_W, BRICK_H, b.colour, b.hits, b.tough));
    if (drifter.active) drawDrifter(ctx, drifter.x, drifter.y, drifter.w, drifter.h, drifter.warn);
    falling.each((f) => (f.kind === "bomb" ? drawBomb(ctx, f.x, f.y, 9, time) : drawPickup(ctx, f.x, f.y, f.kind)));
    balls.each((b) => drawBall(ctx, b.x, b.y, BALL_R));
    ctx.globalAlpha = g.hurt > 0 && Math.floor(time * 16) % 2 === 0 ? 0.4 : 1;
    drawPaddle(ctx, g.x - paddleW() / 2, PADDLE_Y, paddleW(), PADDLE_H);
    ctx.globalAlpha = 1;
  };

  /** A new wall: the top rows are tough, one more tough row with each wall cleared. */
  const buildWall = () => {
    const g = game.current;
    bricks.clear();
    const tough = Math.min(ROWS - 1, 1 + g.walls);
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const b = bricks.get();
        if (!b) continue;
        b.x = 12 + c * BRICK_W;
        b.y = TOP + r * BRICK_H;
        b.tough = r < tough;
        b.hits = b.tough ? 2 : 1;
        b.colour = b.tough ? COLOURS.hard : COLOURS.rows[r % COLOURS.rows.length];
      }
    }
    spawned("hardBrick");
  };

  /** A ball resting on the paddle, launched by itself a moment later: no tap needed to start. */
  const serve = () => {
    const b = balls.get();
    if (!b) return;
    b.x = game.current.x;
    b.y = PADDLE_Y - BALL_R - 1;
    b.vx = 0;
    b.vy = 0;
    b.stuck = 0.6;
  };

  const end = () => {
    const g = game.current;
    const score = Math.floor(g.score);
    sfx.lose();
    buzz("over");
    if (saveBest(score, BEST_KEY)) setBest(score);
    setResult({ score, broken: g.broken, walls: g.walls });
    setScreen("over");
  };

  const loseLife = () => {
    const g = game.current;
    if (g.hurt > 0) return;
    g.lives -= 1;
    g.hurt = 1.2;
    combo.break();
    shake.hit(8);
    sfx.hit();
    buzz("hit");
    if (g.lives <= 0) end();
  };

  const onFrame = (frame: Frame) => {
    const { ctx, width, height, dt, time, input } = frame;
    const g = game.current;
    g.t += dt;
    const level = difficulty(g.t, 90);
    const speed = 330 + level * 220;
    if (g.needWall) {
      g.needWall = false;
      buildWall();
      serve();
    }

    // Moving the paddle: drag along the bottom, tap where to go, or hold left or right.
    // The arrows move the paddle at a steady speed; a finger sets where it glides to.
    const keys = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    if (input.pointer.down) g.target = input.pointer.x;
    if (keys) g.target = g.x + keys * 420 * dt;
    const half = paddleW() / 2;
    g.target = Math.max(half, Math.min(width - half, g.target));
    if (keys) g.x = g.target;
    g.x += (g.target - g.x) * Math.min(1, dt * 16);
    g.hurt = Math.max(0, g.hurt - dt);

    // The drifter slides in after two seconds and drops a bomb after a blink.
    if (!drifter.active && g.t > 2) {
      place(drifter, "drifter", 40, 320, 56, 20);
      drifter.active = true;
      drifter.timer = 1.4;
      spawned("drifter");
    }
    if (drifter.active) {
      patrol(drifter, dt, { from: 40, to: width - 40, speed: 70 + level * 50 });
      if (shooter(drifter, dt, { every: 3.2 - level, warnFor: 0.6 })) {
        const bomb = falling.get();
        if (bomb) {
          place(bomb, "bomb", drifter.x, drifter.y + 14, 18, 18);
          spawned("bomb");
        }
      }
    }
    if (powerSpawner.tick(dt, level)) {
      const p = falling.get();
      if (p) {
        const kind = POWER_KINDS[g.powers++ % POWER_KINDS.length];
        place(p, kind, 40 + Math.random() * (width - 80), TOP + ROWS * BRICK_H, 36, 18);
        spawned(kind);
      }
    }

    const paddle = { x: g.x - half, y: PADDLE_Y, w: paddleW(), h: PADDLE_H };
    balls.each((b) => {
      if (b.stuck > 0) {
        b.stuck -= dt;
        b.x = g.x;
        if (b.stuck <= 0) {
          const a = -Math.PI / 2 + (Math.random() - 0.5) * 0.8;
          b.vx = Math.cos(a) * speed;
          b.vy = Math.sin(a) * speed;
        }
        return;
      }
      // Keep the ball at the current speed as the game speeds up.
      const now = Math.hypot(b.vx, b.vy) || 1;
      b.vx = (b.vx / now) * speed;
      b.vy = (b.vy / now) * speed;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.x < BALL_R || b.x > width - BALL_R) {
        b.vx = -b.vx;
        b.x = Math.max(BALL_R, Math.min(width - BALL_R, b.x));
      }
      if (b.y < BALL_R + 70) {
        b.vy = Math.abs(b.vy);
        b.y = BALL_R + 70;
      }
      if (b.y > height + 20) {
        b.active = false;
        return;
      }
      // Off the paddle: where it lands steers it, the edges send it out wide.
      if (b.vy > 0 && hitCircleRect(b.x, b.y, BALL_R, paddle)) {
        const off = Math.max(-1, Math.min(1, (b.x - g.x) / half));
        const a = -Math.PI / 2 + off * 1.05;
        b.vx = Math.cos(a) * speed;
        b.vy = Math.sin(a) * speed;
        b.y = PADDLE_Y - BALL_R - 1;
        sfx.tap();
      }
      if (drifter.active && hitCircleRect(b.x, b.y, BALL_R, { x: drifter.x - drifter.w / 2, y: drifter.y - drifter.h / 2, w: drifter.w, h: drifter.h })) {
        b.vy = b.y < drifter.y ? -Math.abs(b.vy) : Math.abs(b.vy);
      }
      let bounced = false;
      bricks.each((k) => {
        if (bounced || !hitCircleRect(b.x, b.y, BALL_R, { x: k.x, y: k.y, w: BRICK_W, h: BRICK_H })) return;
        bounced = true;
        // Bounce off the side it hit: whichever overlap is smaller.
        const dx = Math.min(Math.abs(b.x - k.x), Math.abs(b.x - (k.x + BRICK_W)));
        const dy = Math.min(Math.abs(b.y - k.y), Math.abs(b.y - (k.y + BRICK_H)));
        if (dx < dy) b.vx = -b.vx;
        else b.vy = -b.vy;
        k.hits -= 1;
        if (k.hits > 0) {
          sfx.tap();
          return;
        }
        k.active = false;
        g.broken += 1;
        const points = (k.tough ? 25 : 10) * combo.hit();
        g.score += points;
        popups.add(k.x + BRICK_W / 2, k.y, "+" + points, "#ffffff");
        particles.burst(k.x + BRICK_W / 2, k.y + BRICK_H / 2, { color: k.colour });
        sfx.coin();
        buzz("collect");
      });
    });
    let live = 0;
    balls.each(() => live++);
    if (live === 0) {
      loseLife();
      if (g.lives > 0) serve();
    }
    let left = 0;
    bricks.each(() => left++);
    if (left === 0) {
      g.walls += 1;
      g.score += 200;
      popups.add(width / 2, height / 2, "Wall cleared! +200", "#fde68a");
      sfx.win();
      g.needWall = true;
      balls.clear();
    }

    falling.each((f) => {
      f.y += (f.kind === "bomb" ? 220 : 150) * dt;
      if (f.y > height + 20) {
        f.active = false;
        return;
      }
      if (!hitRect({ x: f.x - f.w / 2, y: f.y - f.h / 2, w: f.w, h: f.h }, paddle)) return;
      f.active = false;
      if (f.kind === "bomb") loseLife();
      else if (f.kind === "wide") {
        effects.activate("wide", 8);
        popups.add(f.x, f.y - 20, "Wide paddle!", "#ffffff");
        sfx.coin();
      } else {
        // Two more balls from where the first one is.
        let from: Ball | null = null;
        balls.each((b) => (from = from ?? b));
        for (let i = 0; i < 2; i++) {
          const b = balls.get();
          const src = from as Ball | null;
          if (!b || !src) break;
          b.x = src.x;
          b.y = src.y;
          b.vx = (i ? 1 : -1) * speed * 0.6;
          b.vy = -speed * 0.8;
          b.stuck = 0;
        }
        popups.add(f.x, f.y - 20, "Extra balls!", "#ffffff");
        sfx.coin();
      }
    });

    effects.update(dt);
    combo.update(dt);
    particles.update(dt);
    popups.update(dt);
    shake.update(dt);
    g.score += dt * 2;
    probe(Math.floor(g.score), g.x, PADDLE_Y, speed);

    ctx.save();
    shake.apply(ctx);
    drawWorld(ctx, width, height, time);
    particles.draw(ctx);
    popups.draw(ctx);
    ctx.restore();
    drawHud(ctx, width, { score: g.score, best, lives: g.lives, combo: combo.multiplier, effects });
    if (g.t < 1.5 && tip) drawBanner(ctx, width, height, "Drag the paddle");
  };

  const start = () => {
    game.current = fresh();
    balls.clear();
    bricks.clear();
    falling.clear();
    drifter.active = false;
    effects.clear();
    combo.break();
    powerSpawner.reset();
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
            tagline="Break every brick. Dodge the bombs."
            art={<Sprite draw={(ctx, w, h) => drawBrick(ctx, 0, 0, w, h, COLOURS.rows[0])} width={64} height={28} label="A brick" />}
            best={best}
            onPlay={start}
            howTo={["Drag, tap a side or use the arrow keys to move the paddle.", "Keep the ball up and break the bricks; tough ones take two hits.", "Dodge the drifter's bombs. Losing the ball costs a life; a cleared wall brings a new one."]}
            powerUps={[
              { name: "Wide paddle", text: "a longer paddle for a while" },
              { name: "Extra balls", text: "more balls in play at once" },
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
          <GameOver
            score={result.score}
            best={best}
            stats={[
              { label: "Bricks", value: result.broken },
              { label: "Walls cleared", value: result.walls },
            ]}
            onAgain={start}
            shareText={"I scored " + result.score + " in " + GAME_NAME}
          >
            <PostScore board={board} score={result.score} />
          </GameOver>
        )}
      </div>
      {screen !== "playing" && <GameSettings />}
      <Leaderboard board={board} title="Top breakers" icon={() => <Sprite draw={(ctx, w, h) => drawBrick(ctx, 0, 0, w, h, COLOURS.rows[1])} width={22} height={12} />} />
    </div>
  );
}
`;

export const brickBreaker: GameTemplate = {
  id: "brick-breaker",
  name: "Brick breaker",
  dims: "2d",
  style: "action",
  fits: "bounce-a-ball games: a paddle at the bottom, a ball, a wall of bricks or blocks to break (any theme: ice, candy, space)",
  kits: ["game-2d"],
  files: { "src/App.tsx": appFor("./play/art", "GAME_NAME"), "src/play/Game.tsx": GAME, "src/play/art.ts": ART },
  leaderboard: true,
  title: { from: "./play/art", name: "GAME_NAME" },
  brief: `This game starts from GoodBuild's Brick breaker template, a working, tested game: src/play/Game.tsx (the game), src/play/art.ts (the name, colours and one drawing function per thing) and src/App.tsx. Reshape it to the plan instead of starting again:
- Rename it (GAME_NAME, BEST_KEY in art.ts) and restyle every drawing and colour to the plan's look: the paddle, the ball, the bricks, the drifter. Keep one drawing function per thing, used in the game and in Sprite.
- Make the bricks, power-ups and characters the plan's: change buildWall, POWER_KINDS, the drifter and what each does, and keep declareGame listing exactly the kinds the game has, with spawned(kind) when one appears. Every kind must show up within the first 15 seconds. The wall is built inside onFrame (needWall), not in start().
- ${KEEP_2D}`,
};
