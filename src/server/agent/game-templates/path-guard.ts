import type { GameTemplate } from "./index";
import { KEEP_2D, appFor } from "./shared";

/**
 * Path guard (D150, genre templates part 2): a tower defense game. Crawlers and runners walk a winding
 * path; tap open ground to build a tower that shoots the nearest one by itself; every one that gets
 * through costs a life. Kills pay for more towers. A frost crystal, tapped, slows them all. Waves grow
 * quickly, so a round lasts minutes, not hours. Canvas "action" with one control, the tap (D112).
 * Original to GoodBuild.
 */

const ART = `// How everything looks, and the path. Change the colours, shapes and PATH to fit the plan's look.

export const GAME_NAME = "Path Guard";
export const BEST_KEY = "path-guard";

/** The path the walkers follow, corner by corner, in game coordinates (360 x 640). */
export const PATH: Array<[number, number]> = [
  [-20, 130],
  [290, 130],
  [290, 270],
  [70, 270],
  [70, 410],
  [290, 410],
  [290, 540],
  [380, 540],
];
export const PATH_WIDTH = 44;

export const COLOURS = {
  grass: "#bbf7d0",
  grassDark: "#86efac",
  path: "#d6b98c",
  tower: "#334155",
  towerTop: "#38bdf8",
  shot: "#fde047",
  crawler: "#65a30d",
  runner: "#dc2626",
  frost: "#7dd3fc",
};

export function drawField(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.fillStyle = COLOURS.grass;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = COLOURS.grassDark;
  for (let y = 20; y < height; y += 60) for (let x = (y / 3) % 40; x < width; x += 70) ctx.fillRect(x, y, 4, 8);
  ctx.strokeStyle = COLOURS.path;
  ctx.lineWidth = PATH_WIDTH;
  ctx.lineJoin = "round";
  ctx.beginPath();
  PATH.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.stroke();
}

export function drawTower(ctx: CanvasRenderingContext2D, x: number, y: number, aim: number) {
  ctx.fillStyle = COLOURS.tower;
  ctx.fillRect(x - 14, y - 14, 28, 28);
  ctx.strokeStyle = COLOURS.towerTop;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + Math.cos(aim) * 18, y + Math.sin(aim) * 18);
  ctx.stroke();
  ctx.fillStyle = COLOURS.towerTop;
  ctx.beginPath();
  ctx.arc(x, y, 7, 0, Math.PI * 2);
  ctx.fill();
}

/** A walker: a crawler is round and slow, a runner small and quick. hp shows as a bar above it. */
export function drawWalker(ctx: CanvasRenderingContext2D, x: number, y: number, kind: string, hp: number, full: number, time: number) {
  const r = kind === "runner" ? 10 : 14;
  const wobble = Math.sin(time * (kind === "runner" ? 20 : 10)) * 2;
  ctx.fillStyle = kind === "runner" ? COLOURS.runner : COLOURS.crawler;
  ctx.beginPath();
  ctx.ellipse(x, y + wobble * 0.3, r, r - 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#111827";
  ctx.fillRect(x - 12, y - r - 8, 24, 4);
  ctx.fillStyle = "#4ade80";
  ctx.fillRect(x - 12, y - r - 8, 24 * Math.max(0, hp / full), 4);
}

export function drawShot(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
  ctx.strokeStyle = COLOURS.shot;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

export function drawFrost(ctx: CanvasRenderingContext2D, x: number, y: number, time: number) {
  const r = 16 + Math.sin(time * 6) * 2;
  ctx.fillStyle = COLOURS.frost;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + time;
    ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fill();
}
`;

const GAME = `import { useRef, useState } from "react";
import { GameCanvas, type Frame } from "../game/GameCanvas";
import { GameOver } from "../game/GameOver";
import { GameSettings } from "../game/GameSettings";
import { Leaderboard, PostScore } from "../game/Leaderboard";
import { TopThree } from "../game/TopThree";
import { firstTime, prefersReducedMotion } from "../game/extras";
import { buzz } from "../game/haptics";
import { drawBanner, drawHud } from "../game/hud";
import { Particles, Popups, Shake } from "../game/juice";
import { useLeaderboard } from "../game/leaderboard";
import { newActor, place } from "../game/npc";
import { Effects } from "../game/powerups";
import { declareGame, probe, spawned } from "../game/probe";
import { sfx } from "../game/sound";
import { bestScore, saveBest } from "../game/storage";
import { Pool, Spawner, difficulty } from "../game/world";
import { BEST_KEY, COLOURS, GAME_NAME, PATH, PATH_WIDTH, drawField, drawFrost, drawShot, drawTower, drawWalker } from "./art";

// Everything the game has, by the names the code uses. Change it with the plan: every kind listed here
// must show up within the first 15 seconds of a round, and spawned(kind) is called when one appears.
declareGame({ style: "action", controls: ["tap"], obstacles: ["crawler", "runner"], powerups: ["frost"] });

const WIDTH = 360;
const HEIGHT = 640;
const LIVES = 10;
const START_COINS = 120;
const TOWER_COST = 50;
const TOWER_RANGE = 95;
const FIRE_EVERY = 0.55;
/** The order walkers first come in, so a short round meets both; then mixed. */
const FIRST = ["crawler", "crawler", "runner", "crawler", "runner"];
const LATER = ["crawler", "crawler", "runner"];

// Path lengths, worked out once, so a walker's place is just how far along it is.
const SEGMENTS = PATH.slice(1).map(([x, y], i) => {
  const [px, py] = PATH[i];
  return { x0: px, y0: py, dx: x - px, dy: y - py, len: Math.hypot(x - px, y - py) };
});
const PATH_LENGTH = SEGMENTS.reduce((s, g) => s + g.len, 0);

/** Where a walker is when it has gone this far along the path. */
function along(distance: number): { x: number; y: number } {
  let d = distance;
  for (const s of SEGMENTS) {
    if (d <= s.len) return { x: s.x0 + (s.dx * d) / s.len, y: s.y0 + (s.dy * d) / s.len };
    d -= s.len;
  }
  const last = PATH[PATH.length - 1];
  return { x: last[0], y: last[1] };
}

/** Is this point on the path (or too close to build on)? */
function onPath(x: number, y: number): boolean {
  return SEGMENTS.some((s) => {
    const t = Math.max(0, Math.min(1, ((x - s.x0) * s.dx + (y - s.y0) * s.dy) / (s.len * s.len)));
    return Math.hypot(x - (s.x0 + s.dx * t), y - (s.y0 + s.dy * t)) < PATH_WIDTH / 2 + 14;
  });
}

// Made once, reused every round: nothing is created while the game runs. An actor's timer is how far
// along the path it is, warn its hit points, and w its full hit points.
const walkers = new Pool(newActor, 40);
const towers = new Pool(newActor, 30);
const shots = new Pool(newActor, 30);
const spawner = new Spawner({ every: 1.1, fastest: 0.35, grace: 0.5 });
const effects = new Effects();
const particles = new Particles(prefersReducedMotion() ? 40 : 160);
const popups = new Popups();
const shake = new Shake();

type Screen = "start" | "playing" | "paused" | "over";

const fresh = () => ({ t: 0, score: 0, lives: LIVES, coins: START_COINS, kills: 0, spawns: 0, lastX: WIDTH / 2, lastY: 0, frost: null as { x: number; y: number; left: number } | null, frostIn: 6 });

export default function Game() {
  const [screen, setScreen] = useState<Screen>("start");
  const [best, setBest] = useState(() => bestScore(BEST_KEY));
  const [result, setResult] = useState({ score: 0, kills: 0 });
  const [tip] = useState(() => firstTime("path-guard-controls"));
  const board = useLeaderboard();
  const game = useRef(fresh());

  const drawWorld = (ctx: CanvasRenderingContext2D, width: number, height: number, time: number) => {
    const g = game.current;
    drawField(ctx, width, height);
    towers.each((t) => drawTower(ctx, t.x, t.y, t.dir));
    walkers.each((w) => drawWalker(ctx, w.x, w.y, w.kind, w.warn, w.w, time));
    shots.each((s) => drawShot(ctx, s.x, s.y, s.vx, s.vy));
    if (g.frost) drawFrost(ctx, g.frost.x, g.frost.y, time);
    if (effects.isActive("frost")) {
      ctx.fillStyle = COLOURS.frost;
      ctx.globalAlpha = 0.15;
      ctx.fillRect(0, 0, width, height);
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = "#0f172a";
    ctx.font = "bold 16px sans-serif";
    ctx.fillText("Coins " + g.coins + "  ·  Tower " + TOWER_COST, 14, height - 16);
  };

  const end = () => {
    const g = game.current;
    const score = Math.floor(g.score);
    sfx.lose();
    buzz("over");
    if (saveBest(score, BEST_KEY)) setBest(score);
    setResult({ score, kills: g.kills });
    setScreen("over");
  };

  /** A tap: take the frost crystal if it's there, else build a tower on open ground if there's money. */
  const tapAt = (x: number, y: number) => {
    const g = game.current;
    if (g.frost && Math.hypot(x - g.frost.x, y - g.frost.y) < 30) {
      g.frost = null;
      effects.activate("frost", 4);
      popups.add(x, y - 20, "Frozen!", "#ffffff");
      sfx.coin();
      return;
    }
    let crowded = false;
    towers.each((t) => {
      if (Math.hypot(t.x - x, t.y - y) < 32) crowded = true;
    });
    if (crowded || onPath(x, y) || y > HEIGHT - 40 || y < 70) return;
    if (g.coins < TOWER_COST) {
      popups.add(x, y - 20, "Need " + TOWER_COST, "#ef4444");
      return;
    }
    const t = towers.get();
    if (!t) return;
    place(t, "tower", x, y, 28, 28);
    t.timer = 0;
    t.dir = -Math.PI / 2;
    g.coins -= TOWER_COST;
    g.lastX = x;
    g.lastY = y;
    sfx.tap();
    buzz("tap");
  };

  const onFrame = (frame: Frame) => {
    const { ctx, width, height, dt, time, input } = frame;
    const g = game.current;
    g.t += dt;
    const level = difficulty(g.t, 45);
    const pace = effects.isActive("frost") ? 0.35 : 1;
    const speed = (38 + level * 70) * pace;

    if (input.actionPressed) tapAt(input.pointer.x, input.pointer.y);

    // Walkers come in faster and tougher as the round goes on.
    if (spawner.tick(dt, level)) {
      const w = walkers.get();
      if (w) {
        const kind = g.spawns < FIRST.length ? FIRST[g.spawns] : LATER[Math.floor(Math.random() * LATER.length)];
        g.spawns += 1;
        const hp = Math.round((kind === "runner" ? 2 : 4) * (1 + level * 4));
        const start = along(0);
        place(w, kind, start.x, start.y, hp, hp);
        w.timer = 0;
        w.warn = hp;
        spawned(kind);
      }
    }
    // A frost crystal turns up now and then; tap it before it fades.
    g.frostIn -= dt;
    if (g.frostIn <= 0 && !g.frost) {
      g.frost = { x: 40 + Math.random() * (width - 80), y: 90 + Math.random() * (height - 220), left: 5 };
      g.frostIn = 12;
      spawned("frost");
    }
    if (g.frost) {
      g.frost.left -= dt;
      if (g.frost.left <= 0) g.frost = null;
    }

    walkers.each((w) => {
      w.timer += speed * (w.kind === "runner" ? 1.7 : 1) * dt;
      const at = along(w.timer);
      w.x = at.x;
      w.y = at.y;
      if (w.timer >= PATH_LENGTH) {
        // Got through: a life gone.
        w.active = false;
        g.lives -= 1;
        shake.hit(6);
        sfx.hit();
        buzz("hit");
        if (g.lives <= 0) end();
      }
    });

    // Each tower shoots the walker in range that's furthest along, every so often.
    shots.each((s) => {
      s.timer -= dt;
      if (s.timer <= 0) s.active = false;
    });
    towers.each((t) => {
      t.timer -= dt;
      if (t.timer > 0) return;
      let target: typeof t | null = null;
      walkers.each((w) => {
        if (Math.hypot(w.x - t.x, w.y - t.y) <= TOWER_RANGE && (!target || w.timer > target.timer)) target = w;
      });
      const hit = target as typeof t | null;
      if (!hit) return;
      t.timer = FIRE_EVERY;
      t.dir = Math.atan2(hit.y - t.y, hit.x - t.x);
      const s = shots.get();
      if (s) {
        place(s, "shot", t.x, t.y, 0, 0);
        s.vx = hit.x;
        s.vy = hit.y;
        s.timer = 0.08;
      }
      hit.warn -= 1;
      if (hit.warn <= 0) {
        hit.active = false;
        g.kills += 1;
        g.coins += hit.kind === "runner" ? 12 : 10;
        g.score += hit.kind === "runner" ? 15 : 10;
        particles.burst(hit.x, hit.y, { color: hit.kind === "runner" ? COLOURS.runner : COLOURS.crawler });
        sfx.coin();
      }
    });

    g.score += dt;
    effects.update(dt);
    particles.update(dt);
    popups.update(dt);
    shake.update(dt);
    // Where the last tower went up: it changes only when the player builds one.
    probe(Math.floor(g.score), g.lastX, g.lastY, speed);

    ctx.save();
    shake.apply(ctx);
    drawWorld(ctx, width, height, time);
    particles.draw(ctx);
    popups.draw(ctx);
    ctx.restore();
    drawHud(ctx, width, { score: g.score, best, lives: g.lives, effects });
    if (g.t < 2 && tip) drawBanner(ctx, width, height, "Tap the grass to build a tower");
  };

  const start = () => {
    game.current = fresh();
    walkers.clear();
    towers.clear();
    shots.clear();
    effects.clear();
    spawner.reset();
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
          <div className="absolute inset-x-4 bottom-24 space-y-3 rounded-2xl bg-card/95 p-4 text-center shadow-lg">
            <h2 className="text-lg font-semibold">{GAME_NAME}</h2>
            <p className="text-sm text-muted-foreground">Tap the grass to build towers ({TOWER_COST} coins). They shoot whatever walks the path. Every one that gets through costs a life.</p>
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
          <GameOver score={result.score} best={best} stats={[{ label: "Stopped", value: result.kills }]} onAgain={start} shareText={"I scored " + result.score + " in " + GAME_NAME}>
            <PostScore board={board} score={result.score} />
          </GameOver>
        )}
      </div>
      {screen !== "playing" && <GameSettings />}
      <Leaderboard board={board} title="Top guards" />
    </div>
  );
}
`;

export const pathGuard: GameTemplate = {
  id: "path-guard",
  name: "Path guard",
  dims: "2d",
  style: "action",
  fits: "tower defense games: enemies walk a path and you build towers, turrets or plants beside it that shoot them by themselves, waves that get harder, defend a base, castle, garden or ship",
  kits: ["game-2d"],
  files: { "src/App.tsx": appFor("./play/art", "GAME_NAME"), "src/play/Game.tsx": GAME, "src/play/art.ts": ART },
  leaderboard: true,
  title: { from: "./play/art", name: "GAME_NAME" },
  brief: `This game starts from GoodBuild's Path guard template, a working, tested game: src/play/Game.tsx (the game), src/play/art.ts (the name, colours, the PATH and one drawing function per thing) and src/App.tsx. Reshape it to the plan instead of starting again:
- Rename it (GAME_NAME, BEST_KEY in art.ts) and restyle every drawing and colour to the plan's look: the field, the path, the towers, the walkers. Change PATH for a different map (keep it inside 360 x 640).
- Make the walkers, towers and pick-ups the plan's: change FIRST, LATER, their hit points and speed, the tower's cost, range and rate, and keep declareGame listing exactly the kinds the game has, with spawned(kind) when one appears. Every kind must show up within the first 15 seconds. Keep waves growing fast enough that a round ends in a few minutes.
- Keep the probe reporting where the last tower went up: it changes only when the player builds one, which is how GoodBuild sees the tap works.
- ${KEEP_2D}`,
};
