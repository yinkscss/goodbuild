import type { GameTemplate } from "./index";

/**
 * Lane racer (D114): three lanes, traffic to overtake, oncoming cars, a rival who blocks, oil that makes
 * you slide, nitro and a shield, near-miss combos, the leaderboard on the game. Every kind it has appears
 * in the first few seconds, so the check sees them all. Built from the games kit's blocks, nothing else.
 * Original to GoodBuild: named for how it plays, not after any existing game.
 */

const ART = `// How everything in the game looks. Each thing is drawn by one function, used in the game and in
// Sprite cards outside it. Change the colours and shapes to fit the plan's look.

export const GAME_NAME = "Lane Racer";
export const BEST_KEY = "lane-racer";

export const COLOURS = {
  grass: "#14532d",
  road: "#1f2937",
  line: "#e5e7eb",
  player: "#e11d48",
  slowCar: "#f97316",
  oncoming: "#facc15",
  rival: "#a855f7",
  oil: "#020617",
  nitro: "#22d3ee",
  shield: "#38bdf8",
};

/** A car seen from above, filling the box x, y, w, h. Headlights point up unless facingDown. */
export function drawCar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, colour: string, facingDown = false) {
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.fillRect(x + w * 0.12, y + h * 0.06, w * 0.8, h * 0.95);
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.roundRect(x + w * 0.1, y, w * 0.8, h, w * 0.22);
  ctx.fill();
  ctx.fillStyle = "#0f172a";
  ctx.fillRect(x + w * 0.22, y + h * (facingDown ? 0.62 : 0.2), w * 0.56, h * 0.18);
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.fillRect(x + w * 0.22, y + h * 0.45, w * 0.56, h * 0.08);
  ctx.fillStyle = "#fef9c3";
  const lightY = facingDown ? y + h * 0.92 : y + h * 0.02;
  ctx.fillRect(x + w * 0.16, lightY, w * 0.16, h * 0.06);
  ctx.fillRect(x + w * 0.68, lightY, w * 0.16, h * 0.06);
}

/** The road, scrolled by distance so it moves. */
export function drawRoad(ctx: CanvasRenderingContext2D, width: number, height: number, distance: number, laneXs: readonly number[]) {
  ctx.fillStyle = COLOURS.grass;
  ctx.fillRect(0, 0, width, height);
  const left = laneXs[0] - 50;
  const right = laneXs[laneXs.length - 1] + 50;
  ctx.fillStyle = COLOURS.road;
  ctx.fillRect(left, 0, right - left, height);
  ctx.fillStyle = COLOURS.line;
  for (let i = 0; i < laneXs.length - 1; i++) {
    const x = (laneXs[i] + laneXs[i + 1]) / 2;
    for (let y = (distance % 80) - 80; y < height; y += 80) ctx.fillRect(x - 2, y, 4, 40);
  }
  ctx.fillRect(left, 0, 4, height);
  ctx.fillRect(right - 4, 0, 4, height);
}

export function drawOil(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.fillStyle = COLOURS.oil;
  ctx.beginPath();
  ctx.ellipse(x, y, r, r * 0.6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(148,163,184,0.35)";
  ctx.beginPath();
  ctx.ellipse(x - r * 0.3, y - r * 0.15, r * 0.3, r * 0.15, 0, 0, Math.PI * 2);
  ctx.fill();
}

/** A power-up: a glowing disc with a letter. */
export function drawPickup(ctx: CanvasRenderingContext2D, x: number, y: number, kind: string, time: number) {
  const colour = kind === "nitro" ? COLOURS.nitro : COLOURS.shield;
  const r = 15 + Math.sin(time * 6) * 2;
  ctx.fillStyle = colour;
  ctx.globalAlpha = 0.3;
  ctx.beginPath();
  ctx.arc(x, y, r + 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#0f172a";
  ctx.font = "bold 16px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(kind === "nitro" ? "N" : "S", x, y + 1);
  ctx.textAlign = "start";
  ctx.textBaseline = "alphabetic";
}
`;

const GAME = `import { useRef, useState } from "react";
import { GameCanvas, type Frame } from "../game/GameCanvas";
import { GameOver } from "../game/GameOver";
import { GameSettings } from "../game/GameSettings";
import { Leaderboard, PostScore } from "../game/Leaderboard";
import { Sprite } from "../game/Sprite";
import { TopThree } from "../game/TopThree";
import { Combo, firstTime, nearMiss, prefersReducedMotion } from "../game/extras";
import { buzz } from "../game/haptics";
import { drawBanner, drawHud } from "../game/hud";
import { Particles, Popups, Shake, hitRect } from "../game/juice";
import { useLeaderboard } from "../game/leaderboard";
import { hitBox, newActor, offscreen, oncoming, place, rival, traffic, type Actor } from "../game/npc";
import { Effects } from "../game/powerups";
import { declareGame, probe, spawned } from "../game/probe";
import { sfx } from "../game/sound";
import { bestScore, saveBest } from "../game/storage";
import { Pool, Spawner, difficulty, lanes } from "../game/world";
import { BEST_KEY, COLOURS, GAME_NAME, drawCar, drawOil, drawPickup, drawRoad } from "./art";

// Everything the game has, by the names the code uses. Change it with the plan: every kind listed here
// must show up within the first 15 seconds of a round, and spawned(kind) is called when one appears.
declareGame({ style: "action", controls: ["sides", "keys"], obstacles: ["slowCar", "oncoming", "oil"], powerups: ["nitro", "shield"], npcs: ["rival"] });

const WIDTH = 360;
const HEIGHT = 640;
const LANES = lanes(3, WIDTH, 50);
const PLAYER_Y = 520;
const CAR_W = 44;
const CAR_H = 76;
/** The order cars first arrive in, so a short round meets every kind; after that they're mixed. */
const CAR_KINDS = ["slowCar", "oncoming", "rival"];
const POWER_KINDS = ["nitro", "shield"];

// Made once, reused every round: nothing is created while the game runs.
const cars = new Pool(newActor, 24);
const oil = new Pool(newActor, 6);
const pickups = new Pool(newActor, 6);
const carSpawner = new Spawner({ every: 1.1, fastest: 0.45, grace: 0.6 });
const oilSpawner = new Spawner({ every: 3.2, fastest: 1.8, grace: 1.6 });
const powerSpawner = new Spawner({ every: 4, fastest: 3, grace: 2.4 });
const effects = new Effects();
const combo = new Combo();
const particles = new Particles(prefersReducedMotion() ? 40 : 160);
const popups = new Popups();
const shake = new Shake();

type Screen = "start" | "playing" | "paused" | "over";

const fresh = () => ({ lane: 1, x: LANES[1], t: 0, distance: 0, score: 0, spawns: 0, powers: 0, slip: 0, nearMisses: 0, wasLeft: false, wasRight: false, passed: new Set<Actor>() });

export default function Game() {
  const [screen, setScreen] = useState<Screen>("start");
  const [best, setBest] = useState(() => bestScore(BEST_KEY));
  const [result, setResult] = useState({ score: 0, distance: 0, nearMisses: 0 });
  const [tip] = useState(() => firstTime("lane-racer-controls"));
  const board = useLeaderboard();
  const game = useRef(fresh());

  const drawWorld = (ctx: CanvasRenderingContext2D, width: number, height: number, time: number) => {
    const g = game.current;
    drawRoad(ctx, width, height, g.distance, LANES);
    oil.each((o) => drawOil(ctx, o.x, o.y, o.w / 2));
    pickups.each((p) => drawPickup(ctx, p.x, p.y, p.kind, time));
    cars.each((c) => {
      const colour = c.kind === "rival" ? COLOURS.rival : c.kind === "oncoming" ? COLOURS.oncoming : COLOURS.slowCar;
      drawCar(ctx, c.x - c.w / 2, c.y - c.h / 2, c.w, c.h, colour, c.kind === "oncoming");
      // A blinker before a lane change or a block: fair warning.
      if (c.warn > 0 && Math.floor(time * 8) % 2 === 0) {
        ctx.fillStyle = "#fbbf24";
        ctx.fillRect(c.dir < 0 ? c.x - c.w / 2 - 4 : c.x + c.w / 2 - 2, c.y - c.h / 2 + 6, 6, 10);
      }
    });
    if (effects.isActive("shield")) {
      ctx.strokeStyle = COLOURS.shield;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(g.x, PLAYER_Y, 50, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (effects.isActive("boost")) {
      ctx.fillStyle = "rgba(34,211,238,0.5)";
      ctx.fillRect(g.x - 10, PLAYER_Y + CAR_H / 2, 20, 30);
    }
    ctx.save();
    ctx.translate(g.x, PLAYER_Y);
    ctx.rotate(g.slip > 0 ? Math.sin(g.slip * 30) * 0.3 : 0);
    drawCar(ctx, -CAR_W / 2, -CAR_H / 2, CAR_W, CAR_H, COLOURS.player);
    ctx.restore();
  };

  const end = () => {
    const g = game.current;
    const score = Math.floor(g.score);
    sfx.lose();
    buzz("over");
    shake.hit(12);
    if (saveBest(score, BEST_KEY)) setBest(score);
    setResult({ score, distance: Math.floor(g.distance / 10), nearMisses: g.nearMisses });
    setScreen("over");
  };

  const onFrame = (frame: Frame) => {
    const { ctx, width, height, dt, time, input } = frame;
    const g = game.current;
    g.t += dt;
    const level = difficulty(g.t, 75);
    const speed = (240 + level * 300) * (effects.isActive("boost") ? 1.5 : 1);

    // Steering: tap a side of the road, or press left or right. Oil takes the wheel away for a moment.
    if (g.slip <= 0) {
      if (input.actionPressed) g.lane = input.pointer.x < width / 2 ? Math.max(0, g.lane - 1) : Math.min(LANES.length - 1, g.lane + 1);
      if (input.left && !g.wasLeft) g.lane = Math.max(0, g.lane - 1);
      if (input.right && !g.wasRight) g.lane = Math.min(LANES.length - 1, g.lane + 1);
    }
    g.wasLeft = input.left;
    g.wasRight = input.right;
    g.slip = Math.max(0, g.slip - dt);
    g.x += (LANES[g.lane] - g.x) * Math.min(1, dt * 12);
    g.distance += speed * dt;

    if (carSpawner.tick(dt, level)) {
      const car = cars.get();
      if (car) {
        const kind = g.spawns < CAR_KINDS.length ? CAR_KINDS[g.spawns] : CAR_KINDS[Math.floor(Math.random() * CAR_KINDS.length)];
        g.spawns += 1;
        const lane = Math.floor(Math.random() * LANES.length);
        place(car, kind, LANES[lane], -60, CAR_W, CAR_H);
        car.lane = lane;
        spawned(kind);
      }
    }
    if (oilSpawner.tick(dt, level)) {
      const o = oil.get();
      if (o) {
        place(o, "oil", LANES[Math.floor(Math.random() * LANES.length)], -40, 56, 56);
        spawned("oil");
      }
    }
    if (powerSpawner.tick(dt, level)) {
      const p = pickups.get();
      if (p) {
        const kind = POWER_KINDS[g.powers++ % POWER_KINDS.length];
        place(p, kind, LANES[Math.floor(Math.random() * LANES.length)], -30, 30, 30);
        spawned(kind);
      }
    }

    const me = { x: g.x - CAR_W * 0.4, y: PLAYER_Y - CAR_H * 0.4, w: CAR_W * 0.8, h: CAR_H * 0.8 };
    cars.each((c) => {
      if (c.kind === "oncoming") oncoming(c, dt, { speed: speed * 1.5 });
      // A rival keeps pace a little ahead and blinks before cutting into your lane.
      else if (c.kind === "rival") rival(c, dt, { lane: g.lane }, { laneXs: LANES, drift: speed * 0.35 });
      else traffic(c, dt, { speed: speed * 0.6, laneXs: LANES });
      if (offscreen(c, width, height, 160)) {
        c.active = false;
        g.passed.delete(c);
        return;
      }
      const box = hitBox(c);
      if (hitRect(box, me)) {
        if (effects.isActive("shield") || effects.isActive("boost")) {
          effects.end("shield");
          c.active = false;
          particles.burst(c.x, c.y, { color: COLOURS.shield });
          sfx.hit();
          shake.hit(6);
        } else end();
        return;
      }
      // A near miss: passing close scores a bonus and builds the combo.
      if (!g.passed.has(c) && nearMiss(me, box) && Math.abs(c.y - PLAYER_Y) < 30) {
        g.passed.add(c);
        g.nearMisses += 1;
        const bonus = 25 * combo.hit();
        g.score += bonus;
        popups.add(g.x, PLAYER_Y - 60, "Close! +" + bonus, "#fde68a");
        sfx.tap();
      }
    });
    oil.each((o) => {
      o.y += speed * dt;
      if (o.y > height + 60) o.active = false;
      else if (g.slip <= 0 && Math.abs(o.x - g.x) < 30 && Math.abs(o.y - PLAYER_Y) < 34) {
        g.slip = 0.7;
        shake.hit(5);
        buzz("hit");
        sfx.hit();
        combo.break();
      }
    });
    pickups.each((p) => {
      p.y += speed * dt;
      if (p.y > height + 40) p.active = false;
      else if (hitRect(hitBox(p, 1), me)) {
        p.active = false;
        effects.activate(p.kind === "nitro" ? "boost" : "shield", p.kind === "nitro" ? 3 : 6);
        particles.burst(p.x, p.y, { color: p.kind === "nitro" ? COLOURS.nitro : COLOURS.shield });
        popups.add(p.x, p.y, p.kind === "nitro" ? "Nitro!" : "Shield!", "#ffffff");
        sfx.coin();
        buzz("collect");
      }
    });

    effects.update(dt);
    combo.update(dt);
    particles.update(dt);
    popups.update(dt);
    shake.update(dt);
    g.score += speed * dt * 0.05 * (effects.isActive("boost") ? 2 : 1);
    probe(Math.floor(g.score), g.x, PLAYER_Y, speed);

    ctx.save();
    shake.apply(ctx);
    drawWorld(ctx, width, height, time);
    particles.draw(ctx);
    popups.draw(ctx);
    ctx.restore();
    drawHud(ctx, width, { score: g.score, best, distance: g.distance / 10, combo: combo.multiplier, effects });
    if (g.t < 1.5 && tip) drawBanner(ctx, width, height, "Tap left or right to change lane");
  };

  const start = () => {
    game.current = fresh();
    cars.clear();
    oil.clear();
    pickups.clear();
    effects.clear();
    combo.break();
    carSpawner.reset();
    oilSpawner.reset();
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
          controls={["left", "right"]}
          label={GAME_NAME}
        />
        <TopThree board={board} className="absolute right-2 top-14" />
        {screen === "start" && (
          <div className="absolute inset-x-4 bottom-24 space-y-3 rounded-2xl bg-card/95 p-4 text-center shadow-lg">
            <div className="flex items-center justify-center gap-3">
              <Sprite draw={(ctx, w, h) => drawCar(ctx, 0, 0, w, h, COLOURS.player)} width={40} height={68} label="Your car" />
              <div className="text-left">
                <h2 className="text-lg font-semibold">{GAME_NAME}</h2>
                <p className="text-sm text-muted-foreground">Tap left or right to change lane. Pass close for combo points.</p>
              </div>
            </div>
            {best > 0 && <p className="text-sm">Your best: {best}</p>}
            <button type="button" onClick={start} className="w-full rounded-xl bg-primary px-6 py-3 text-lg font-semibold text-primary-foreground">
              Play
            </button>
          </div>
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
              { label: "Distance", value: result.distance + " m" },
              { label: "Near misses", value: result.nearMisses },
            ]}
            onAgain={start}
            shareText={"I scored " + result.score + " in " + GAME_NAME}
          >
            <PostScore board={board} score={result.score} />
          </GameOver>
        )}
      </div>
      {screen !== "playing" && <GameSettings />}
      <Leaderboard board={board} title="Top drivers" icon={() => <Sprite draw={(ctx, w, h) => drawCar(ctx, 0, 0, w, h, COLOURS.player)} width={14} height={24} />} />
    </div>
  );
}
`;

const APP = `import Game from "./play/Game";
import { GAME_NAME } from "./play/art";

export default function App() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-4 p-4">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{GAME_NAME}</h1>
      </header>
      <Game />
    </main>
  );
}
`;

export const laneRacer: GameTemplate = {
  id: "lane-racer",
  name: "Lane racer",
  dims: "2d",
  style: "action",
  fits: "racing and driving games, endless runners on lanes, dodging traffic, police chases, anything with lanes and cars, bikes or runners",
  kits: ["game-2d"],
  files: { "src/App.tsx": APP, "src/play/Game.tsx": GAME, "src/play/art.ts": ART },
  leaderboard: true,
  title: { from: "./play/art", name: "GAME_NAME" },
  brief: `This game starts from GoodBuild's Lane racer template, a working, tested game: src/play/Game.tsx (the game), src/play/art.ts (the name, colours and one drawing function per thing) and src/App.tsx. Reshape it to the plan instead of starting again:
- Rename it (GAME_NAME, BEST_KEY in art.ts) and restyle every drawing and colour to the plan's look. Keep one drawing function per thing, used in the game and in Sprite.
- Make the obstacles, power-ups and characters the plan's: change CAR_KINDS, POWER_KINDS, the spawners and what each does, and keep declareGame listing exactly the kinds the game has, with spawned(kind) when one appears. Every kind must show up within the first 15 seconds.
- Keep what makes it work: the probe calls, GameCanvas paused with onIdleFrame, the Pools and Spawners (nothing created per frame), GameOver on the game with PostScore, free play with no wallet.
- Add the plan's extras from src/game/extras.ts where they fit.`,
};
