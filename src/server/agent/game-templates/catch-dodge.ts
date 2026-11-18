import type { GameTemplate } from "./index";
import { KEEP_2D, appFor } from "./shared";

/**
 * Catch and dodge (D117): move a basket along the bottom, catch the fruit that falls, dodge the rocks,
 * and watch the bird that crosses the sky dropping eggs. A magnet pulls fruit in, slow time gives a
 * breather. Lives, a catch combo, the leaderboard on the game. Original to GoodBuild.
 */

const ART = `// How everything in the game looks. Each thing is drawn by one function, used in the game and in
// Sprite cards outside it. Change the colours and shapes to fit the plan's look.

export const GAME_NAME = "Catch and Dodge";
export const BEST_KEY = "catch-dodge";

export const COLOURS = {
  skyTop: "#0ea5e9",
  skyBottom: "#bae6fd",
  ground: "#65a30d",
  basket: "#b45309",
  fruit: "#ef4444",
  leaf: "#16a34a",
  rock: "#57534e",
  egg: "#fef3c7",
  bird: "#1e293b",
  magnet: "#f472b6",
  slow: "#a78bfa",
};

/** The basket, filling the box x, y, w, h. */
export function drawBasket(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = COLOURS.basket;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w * 0.85, y + h);
  ctx.lineTo(x + w * 0.15, y + h);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.25)";
  ctx.lineWidth = 2;
  for (let i = 1; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(x + w * 0.06 * i, y + (h / 4) * i);
    ctx.lineTo(x + w - w * 0.06 * i, y + (h / 4) * i);
    ctx.stroke();
  }
}

export function drawFruit(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.fillStyle = COLOURS.fruit;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = COLOURS.leaf;
  ctx.beginPath();
  ctx.ellipse(x + r * 0.3, y - r * 1.05, r * 0.45, r * 0.22, -0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.45)";
  ctx.beginPath();
  ctx.arc(x - r * 0.35, y - r * 0.35, r * 0.25, 0, Math.PI * 2);
  ctx.fill();
}

export function drawRock(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.fillStyle = COLOURS.rock;
  ctx.beginPath();
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const k = i % 2 ? 0.8 : 1;
    ctx.lineTo(x + Math.cos(a) * r * k, y + Math.sin(a) * r * k);
  }
  ctx.closePath();
  ctx.fill();
}

export function drawEgg(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.fillStyle = COLOURS.egg;
  ctx.beginPath();
  ctx.ellipse(x, y, r * 0.8, r, 0, 0, Math.PI * 2);
  ctx.fill();
}

/** The bird, wings flapping with time. */
export function drawBird(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, time: number) {
  const flap = Math.sin(time * 12) * w * 0.25;
  ctx.fillStyle = COLOURS.bird;
  ctx.beginPath();
  ctx.ellipse(x, y, w * 0.3, w * 0.18, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x - w * 0.1, y);
  ctx.lineTo(x - w * 0.5, y - flap);
  ctx.lineTo(x + w * 0.1, y);
  ctx.lineTo(x + w * 0.5, y - flap);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#f59e0b";
  ctx.beginPath();
  ctx.moveTo(x + w * 0.28, y - 3);
  ctx.lineTo(x + w * 0.42, y);
  ctx.lineTo(x + w * 0.28, y + 3);
  ctx.fill();
}

/** A power-up: a glowing disc with a letter. */
export function drawPickup(ctx: CanvasRenderingContext2D, x: number, y: number, kind: string, time: number) {
  const colour = kind === "magnet" ? COLOURS.magnet : COLOURS.slow;
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
  ctx.fillText(kind === "magnet" ? "M" : "S", x, y + 1);
  ctx.textAlign = "start";
  ctx.textBaseline = "alphabetic";
}

export function drawSky(ctx: CanvasRenderingContext2D, width: number, height: number, groundY: number) {
  const sky = ctx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, COLOURS.skyTop);
  sky.addColorStop(1, COLOURS.skyBottom);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = COLOURS.ground;
  ctx.fillRect(0, groundY, width, height - groundY);
}
`;

const GAME = `import { useRef, useState } from "react";
import { GameCanvas, type Frame } from "../game/GameCanvas";
import { GameOver } from "../game/GameOver";
import { GameSettings } from "../game/GameSettings";
import { Leaderboard, PostScore } from "../game/Leaderboard";
import { Sprite } from "../game/Sprite";
import { TopThree } from "../game/TopThree";
import { Combo, firstTime, prefersReducedMotion } from "../game/extras";
import { buzz } from "../game/haptics";
import { drawBanner, drawHud } from "../game/hud";
import { Particles, Popups, Shake, hitCircle } from "../game/juice";
import { useLeaderboard } from "../game/leaderboard";
import { newActor, patrol, place, shooter } from "../game/npc";
import { Effects } from "../game/powerups";
import { declareGame, probe, spawned } from "../game/probe";
import { sfx } from "../game/sound";
import { bestScore, saveBest } from "../game/storage";
import { Pool, Spawner, difficulty } from "../game/world";
import { BEST_KEY, COLOURS, GAME_NAME, drawBasket, drawBird, drawEgg, drawFruit, drawPickup, drawRock, drawSky } from "./art";

// Everything the game has, by the names the code uses. Change it with the plan: every kind listed here
// must show up within the first 15 seconds of a round, and spawned(kind) is called when one appears.
declareGame({ style: "action", controls: ["drag", "sides", "keys"], obstacles: ["rock"], powerups: ["magnet", "slow"], npcs: ["bird"] });

const WIDTH = 360;
const HEIGHT = 640;
const GROUND = 600;
const BASKET_Y = 560;
const BASKET_W = 76;
const BASKET_H = 40;
const LIVES = 3;
/** The order things first fall in, so a short round meets every kind; after that they're mixed. */
const FIRST = ["fruit", "rock", "fruit", "magnet", "fruit", "rock", "slow"];
const LATER = ["fruit", "fruit", "fruit", "rock", "rock", "magnet", "slow"];

// Made once, reused every round: nothing is created while the game runs.
const falling = new Pool(newActor, 30);
const bird = newActor();
const spawner = new Spawner({ every: 0.75, fastest: 0.3, grace: 0.4 });
const effects = new Effects();
const combo = new Combo();
const particles = new Particles(prefersReducedMotion() ? 40 : 160);
const popups = new Popups();
const shake = new Shake();

type Screen = "start" | "playing" | "paused" | "over";

const fresh = () => ({ x: WIDTH / 2, target: WIDTH / 2, t: 0, score: 0, lives: LIVES, caught: 0, spawns: 0, hurt: 0 });

export default function Game() {
  const [screen, setScreen] = useState<Screen>("start");
  const [best, setBest] = useState(() => bestScore(BEST_KEY));
  const [result, setResult] = useState({ score: 0, caught: 0 });
  const [tip] = useState(() => firstTime("catch-dodge-controls"));
  const board = useLeaderboard();
  const game = useRef(fresh());

  const drawWorld = (ctx: CanvasRenderingContext2D, width: number, height: number, time: number) => {
    const g = game.current;
    drawSky(ctx, width, height, GROUND);
    if (bird.active) {
      drawBird(ctx, bird.x, bird.y, bird.w, time);
      // A wobble before it drops an egg: fair warning.
      if (bird.warn > 0) {
        ctx.fillStyle = "#fbbf24";
        ctx.font = "bold 18px sans-serif";
        ctx.fillText("!", bird.x - 3, bird.y - 22);
      }
    }
    falling.each((f) => {
      if (f.kind === "fruit") drawFruit(ctx, f.x, f.y, f.w / 2);
      else if (f.kind === "rock") drawRock(ctx, f.x, f.y, f.w / 2);
      else if (f.kind === "egg") drawEgg(ctx, f.x, f.y, f.w / 2);
      else drawPickup(ctx, f.x, f.y, f.kind, time);
    });
    if (effects.isActive("magnet")) {
      ctx.strokeStyle = COLOURS.magnet;
      ctx.globalAlpha = 0.4;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(g.x, BASKET_Y + BASKET_H / 2, 110, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.globalAlpha = g.hurt > 0 && Math.floor(time * 16) % 2 === 0 ? 0.4 : 1;
    drawBasket(ctx, g.x - BASKET_W / 2, BASKET_Y, BASKET_W, BASKET_H);
    ctx.globalAlpha = 1;
  };

  const end = () => {
    const g = game.current;
    const score = Math.floor(g.score);
    sfx.lose();
    buzz("over");
    if (saveBest(score, BEST_KEY)) setBest(score);
    setResult({ score, caught: g.caught });
    setScreen("over");
  };

  const onFrame = (frame: Frame) => {
    const { ctx, width, height, dt, time, input } = frame;
    const g = game.current;
    g.t += dt;
    const level = difficulty(g.t, 80);
    // Slow time makes everything fall at half speed for a few seconds.
    const pace = effects.isActive("slow") ? 0.5 : 1;
    const fall = (170 + level * 260) * pace;

    // Moving: drag along the bottom, tap where to go, or hold left or right.
    // The arrows move the basket at a steady speed; a finger sets where it glides to.
    const keys = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    if (input.pointer.down) g.target = input.pointer.x;
    if (keys) g.target = g.x + keys * 360 * dt;
    g.target = Math.max(BASKET_W / 2, Math.min(width - BASKET_W / 2, g.target));
    if (keys) g.x = g.target;
    g.x += (g.target - g.x) * Math.min(1, dt * 14);
    g.hurt = Math.max(0, g.hurt - dt);

    if (spawner.tick(dt, level)) {
      const f = falling.get();
      if (f) {
        const kind = g.spawns < FIRST.length ? FIRST[g.spawns] : LATER[Math.floor(Math.random() * LATER.length)];
        g.spawns += 1;
        const size = kind === "rock" ? 34 : kind === "fruit" ? 28 : 30;
        place(f, kind, 30 + Math.random() * (width - 60), -30, size, size);
        if (kind !== "fruit") spawned(kind);
      }
    }
    // The bird flies in after two seconds and crosses back and forth, dropping eggs after a wobble.
    if (!bird.active && g.t > 2) {
      place(bird, "bird", -30, 96, 54, 30);
      bird.active = true;
      bird.dir = 1;
      bird.timer = 1.5;
      spawned("bird");
    }
    if (bird.active) {
      patrol(bird, dt * pace, { from: 30, to: width - 30, speed: 90 + level * 60 });
      if (shooter(bird, dt * pace, { every: 2.4 - level, warnFor: 0.6 })) {
        const egg = falling.get();
        if (egg) place(egg, "egg", bird.x, bird.y + 16, 22, 22);
      }
    }

    const basketX = g.x;
    const basketY = BASKET_Y + BASKET_H / 2;
    falling.each((f) => {
      // The magnet pulls fruit toward the basket.
      if (f.kind === "fruit" && effects.isActive("magnet") && Math.abs(f.x - basketX) < 110 && f.y > 300) f.x += (basketX - f.x) * Math.min(1, dt * 5);
      f.y += fall * (f.kind === "rock" ? 1.25 : 1) * dt;
      if (f.y > GROUND) {
        f.active = false;
        if (f.kind === "fruit") combo.break();
        return;
      }
      if (!hitCircle(f.x, f.y, f.w / 2, basketX, basketY, BASKET_W / 2 - 6)) return;
      f.active = false;
      if (f.kind === "fruit") {
        g.caught += 1;
        const points = 10 * combo.hit();
        g.score += points;
        popups.add(f.x, f.y - 20, "+" + points, "#ffffff");
        particles.burst(f.x, f.y, { color: COLOURS.fruit });
        sfx.coin();
        buzz("collect");
      } else if (f.kind === "magnet" || f.kind === "slow") {
        effects.activate(f.kind, 6);
        popups.add(f.x, f.y - 20, f.kind === "magnet" ? "Magnet!" : "Slow time!", "#ffffff");
        sfx.coin();
      } else if (g.hurt <= 0) {
        // A rock or an egg: lose a life, with a moment to recover.
        g.lives -= 1;
        g.hurt = 1;
        combo.break();
        shake.hit(8);
        sfx.hit();
        buzz("hit");
        if (g.lives <= 0) end();
      }
    });

    effects.update(dt);
    combo.update(dt);
    particles.update(dt);
    popups.update(dt);
    shake.update(dt);
    g.score += dt * 4;
    probe(Math.floor(g.score), g.x, BASKET_Y, fall);

    ctx.save();
    shake.apply(ctx);
    drawWorld(ctx, width, height, time);
    particles.draw(ctx);
    popups.draw(ctx);
    ctx.restore();
    drawHud(ctx, width, { score: g.score, best, lives: g.lives, combo: combo.multiplier, effects });
    if (g.t < 1.5 && tip) drawBanner(ctx, width, height, "Drag to catch the fruit");
  };

  const start = () => {
    game.current = fresh();
    falling.clear();
    bird.active = false;
    effects.clear();
    combo.break();
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
            <div className="flex items-center justify-center gap-3">
              <Sprite draw={(ctx, w, h) => drawBasket(ctx, 0, 0, w, h)} width={72} height={40} label="Your basket" />
              <div className="text-left">
                <h2 className="text-lg font-semibold">{GAME_NAME}</h2>
                <p className="text-sm text-muted-foreground">Drag to catch the fruit. Dodge rocks and eggs.</p>
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
          <GameOver score={result.score} best={best} stats={[{ label: "Fruit caught", value: result.caught }]} onAgain={start} shareText={"I scored " + result.score + " in " + GAME_NAME}>
            <PostScore board={board} score={result.score} />
          </GameOver>
        )}
      </div>
      {screen !== "playing" && <GameSettings />}
      <Leaderboard board={board} title="Top catchers" icon={() => <Sprite draw={(ctx, w, h) => drawFruit(ctx, w / 2, h / 2 + 2, w / 2 - 3)} width={18} height={20} />} />
    </div>
  );
}
`;

export const catchDodge: GameTemplate = {
  id: "catch-dodge",
  name: "Catch and dodge",
  dims: "2d",
  style: "action",
  fits: "catching games: something falls and you catch the good things and dodge the bad (fruit, coins, stars, raindrops), with a basket, a bucket or a character along the bottom",
  kits: ["game-2d"],
  files: { "src/App.tsx": appFor("./play/art", "GAME_NAME"), "src/play/Game.tsx": GAME, "src/play/art.ts": ART },
  leaderboard: true,
  title: { from: "./play/art", name: "GAME_NAME" },
  brief: `This game starts from GoodBuild's Catch and dodge template, a working, tested game: src/play/Game.tsx (the game), src/play/art.ts (the name, colours and one drawing function per thing) and src/App.tsx. Reshape it to the plan instead of starting again:
- Rename it (GAME_NAME, BEST_KEY in art.ts) and restyle every drawing and colour to the plan's look: the basket, what falls, the bird. Keep one drawing function per thing, used in the game and in Sprite.
- Make what falls and what helps the plan's: change FIRST, LATER, the bird and what each does when caught, and keep declareGame listing exactly the kinds the game has, with spawned(kind) when one appears. Every kind must show up within the first 15 seconds.
- ${KEEP_2D}`,
};
