import type { GameTemplate } from "./index";
import { KEEP_2D, appFor } from "./shared";

/**
 * Cave flyer (D117): hold to climb, let go to sink, and fly a little craft through a winding cave.
 * Rock columns rise from the floor and hang from the roof, bats flutter toward you, gems score and a
 * shield takes one hit. The cave walls push you back rather than ending the run, so a first try lasts.
 * Original to GoodBuild: named for how it plays.
 */

const ART = `// How everything in the game looks. Each thing is drawn by one function, used in the game and in
// Sprite cards outside it. Change the colours and shapes to fit the plan's look.

export const GAME_NAME = "Cave Flyer";
export const BEST_KEY = "cave-flyer";

export const COLOURS = {
  air: "#1e1b4b",
  rock: "#44403c",
  rockEdge: "#78716c",
  craft: "#f59e0b",
  window: "#38bdf8",
  pillar: "#57534e",
  bat: "#c026d3",
  gem: "#34d399",
  shield: "#38bdf8",
};

/** The craft, centred on x, y, tilted by tilt (radians). */
export function drawCraft(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, tilt = 0, flame = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(tilt);
  if (flame > 0) {
    ctx.fillStyle = "#fb923c";
    ctx.beginPath();
    ctx.moveTo(-size * 0.5, -size * 0.15);
    ctx.lineTo(-size * (0.75 + flame * 0.3), 0);
    ctx.lineTo(-size * 0.5, size * 0.15);
    ctx.fill();
  }
  ctx.fillStyle = COLOURS.craft;
  ctx.beginPath();
  ctx.ellipse(0, 0, size * 0.55, size * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = COLOURS.window;
  ctx.beginPath();
  ctx.ellipse(size * 0.15, -size * 0.08, size * 0.18, size * 0.12, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** A rock column from the roof (fromTop) or the floor, x to x + w, reaching to tipY. */
export function drawPillar(ctx: CanvasRenderingContext2D, x: number, w: number, tipY: number, fromTop: boolean, height: number) {
  ctx.fillStyle = COLOURS.pillar;
  ctx.beginPath();
  if (fromTop) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x + w, 0);
    ctx.lineTo(x + w * 0.75, tipY);
    ctx.lineTo(x + w * 0.25, tipY);
  } else {
    ctx.moveTo(x, height);
    ctx.lineTo(x + w, height);
    ctx.lineTo(x + w * 0.75, tipY);
    ctx.lineTo(x + w * 0.25, tipY);
  }
  ctx.closePath();
  ctx.fill();
}

export function drawBat(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, time: number) {
  const flap = Math.sin(time * 18) * size * 0.35;
  ctx.fillStyle = COLOURS.bat;
  ctx.beginPath();
  ctx.arc(x, y, size * 0.22, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x - size * 0.6, y - flap);
  ctx.lineTo(x - size * 0.3, y + size * 0.1);
  ctx.moveTo(x, y);
  ctx.lineTo(x + size * 0.6, y - flap);
  ctx.lineTo(x + size * 0.3, y + size * 0.1);
  ctx.fill();
}

export function drawGem(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.fillStyle = COLOURS.gem;
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r * 0.8, y);
  ctx.lineTo(x, y + r);
  ctx.lineTo(x - r * 0.8, y);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.fillRect(x - r * 0.2, y - r * 0.5, r * 0.25, r * 0.4);
}

export function drawShieldPickup(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.strokeStyle = COLOURS.shield;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = COLOURS.shield;
  ctx.globalAlpha = 0.3;
  ctx.fill();
  ctx.globalAlpha = 1;
}

/** The cave: roof and floor follow top(x) and bottom(x). */
export function drawCave(ctx: CanvasRenderingContext2D, width: number, height: number, top: (x: number) => number, bottom: (x: number) => number) {
  ctx.fillStyle = COLOURS.air;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = COLOURS.rock;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  for (let x = 0; x <= width; x += 12) ctx.lineTo(x, top(x));
  ctx.lineTo(width, 0);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(0, height);
  for (let x = 0; x <= width; x += 12) ctx.lineTo(x, bottom(x));
  ctx.lineTo(width, height);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = COLOURS.rockEdge;
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (let x = 0; x <= width; x += 12) ctx.lineTo(x, top(x));
  ctx.stroke();
  ctx.beginPath();
  for (let x = 0; x <= width; x += 12) ctx.lineTo(x, bottom(x));
  ctx.stroke();
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
import { Particles, Popups, Shake, hitCircle, hitCircleRect } from "../game/juice";
import { useLeaderboard } from "../game/leaderboard";
import { newActor, place } from "../game/npc";
import { Effects } from "../game/powerups";
import { declareGame, probe, spawned } from "../game/probe";
import { sfx } from "../game/sound";
import { bestScore, saveBest } from "../game/storage";
import { Pool, Spawner, difficulty } from "../game/world";
import { BEST_KEY, COLOURS, GAME_NAME, drawBat, drawCave, drawCraft, drawGem, drawPillar, drawShieldPickup } from "./art";

// Everything the game has, by the names the code uses. Change it with the plan: every kind listed here
// must show up within the first 15 seconds of a round, and spawned(kind) is called when one appears.
declareGame({ style: "action", controls: ["hold", "tap", "keys"], obstacles: ["pillar"], powerups: ["gem", "shield"], npcs: ["bat"] });

const WIDTH = 360;
const HEIGHT = 640;
const CRAFT_X = 90;
const CRAFT_R = 16;
/** The order things first arrive in, so a short round meets every kind; after that they're mixed. */
const FIRST = ["pillar", "gem", "bat", "pillar", "shield"];
const LATER = ["pillar", "pillar", "bat", "gem", "gem", "shield"];

// Made once, reused every round: nothing is created while the game runs.
const things = new Pool(newActor, 20);
const spawner = new Spawner({ every: 1.3, fastest: 0.6, grace: 0.8 });
const effects = new Effects();
const combo = new Combo();
const particles = new Particles(prefersReducedMotion() ? 40 : 160);
const popups = new Popups();
const shake = new Shake();

type Screen = "start" | "playing" | "paused" | "over";

const fresh = () => ({ y: HEIGHT / 2, vy: 0, t: 0, distance: 0, score: 0, gems: 0, spawns: 0, narrow: 0 });

export default function Game() {
  const [screen, setScreen] = useState<Screen>("start");
  const [best, setBest] = useState(() => bestScore(BEST_KEY));
  const [result, setResult] = useState({ score: 0, distance: 0, gems: 0 });
  const [tip] = useState(() => firstTime("cave-flyer-controls"));
  const board = useLeaderboard();
  const game = useRef(fresh());

  // The roof and the floor wind with distance; they close in a little as the run goes on.
  const top = (x: number) => {
    const d = game.current.distance + x;
    return 56 + game.current.narrow + Math.sin(d / 190) * 34 + Math.sin(d / 71) * 14;
  };
  const bottom = (x: number) => {
    const d = game.current.distance + x;
    return HEIGHT - 56 - game.current.narrow + Math.sin(d / 160 + 2) * 34 + Math.sin(d / 63) * 14;
  };

  const drawWorld = (ctx: CanvasRenderingContext2D, width: number, height: number, time: number, thrust = 0) => {
    const g = game.current;
    drawCave(ctx, width, height, top, bottom);
    things.each((t) => {
      if (t.kind === "pillar") drawPillar(ctx, t.x - t.w / 2, t.w, t.dir < 0 ? t.h : height - t.h, t.dir < 0, height);
      else if (t.kind === "bat") {
        drawBat(ctx, t.x, t.y, t.w, time);
        if (t.warn > 0) {
          ctx.fillStyle = "#fbbf24";
          ctx.font = "bold 18px sans-serif";
          ctx.fillText("!", t.x - 3, t.y - 20);
        }
      } else if (t.kind === "gem") drawGem(ctx, t.x, t.y, t.w / 2);
      else drawShieldPickup(ctx, t.x, t.y, t.w / 2);
    });
    if (effects.isActive("shield")) {
      ctx.strokeStyle = COLOURS.shield;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(CRAFT_X, g.y, CRAFT_R + 12, 0, Math.PI * 2);
      ctx.stroke();
    }
    drawCraft(ctx, CRAFT_X, g.y, CRAFT_R * 2.4, Math.max(-0.5, Math.min(0.5, g.vy / 700)), thrust);
  };

  const end = () => {
    const g = game.current;
    const score = Math.floor(g.score);
    sfx.lose();
    buzz("over");
    shake.hit(12);
    if (saveBest(score, BEST_KEY)) setBest(score);
    setResult({ score, distance: Math.floor(g.distance / 10), gems: g.gems });
    setScreen("over");
  };

  const onFrame = (frame: Frame) => {
    const { ctx, width, height, dt, time, input } = frame;
    const g = game.current;
    g.t += dt;
    const level = difficulty(g.t, 80);
    const speed = 170 + level * 190;
    g.narrow = level * 60;

    // Flying: hold (a finger, Space or the up arrow) to climb, let go to sink. A moment of hover at the start.
    const climbing = input.action || input.up;
    if (g.t > 0.8) {
      g.vy += (climbing ? -1500 : 900) * dt;
      g.vy = Math.max(-380, Math.min(420, g.vy));
    }
    g.y += g.vy * dt;
    // The walls push back: a scrape costs the combo, never the run.
    const roof = top(CRAFT_X) + CRAFT_R;
    const floor = bottom(CRAFT_X) - CRAFT_R;
    if (g.y < roof || g.y > floor) {
      g.y = Math.max(roof, Math.min(floor, g.y));
      g.vy *= -0.3;
      if (combo.multiplier > 1) combo.break();
      particles.burst(CRAFT_X, g.y, { color: "#a8a29e", count: 4 });
    }
    g.distance += speed * dt;

    if (spawner.tick(dt, level)) {
      const t = things.get();
      if (t) {
        const kind = g.spawns < FIRST.length ? FIRST[g.spawns] : LATER[Math.floor(Math.random() * LATER.length)];
        g.spawns += 1;
        const x = width + 40;
        const gapTop = top(x);
        const gapBottom = bottom(x);
        if (kind === "pillar") {
          // A column from the roof or the floor that leaves at least a third of the gap open.
          const fromTop = Math.random() < 0.5;
          place(t, kind, x, 0, 44, 0);
          t.dir = fromTop ? -1 : 1;
          const reach = (gapBottom - gapTop) * (0.35 + Math.random() * 0.25);
          t.h = fromTop ? gapTop + reach : height - (gapBottom - reach);
        } else {
          place(t, kind, x, gapTop + 40 + Math.random() * Math.max(10, gapBottom - gapTop - 80), kind === "bat" ? 34 : 26, kind === "bat" ? 34 : 26);
          t.timer = 0.8;
        }
        spawned(kind);
      }
    }

    things.each((t) => {
      t.x -= speed * dt * (t.kind === "bat" ? 1.25 : 1);
      if (t.x < -60) {
        t.active = false;
        return;
      }
      if (t.kind === "bat") {
        // A bat flutters, then turns toward the craft after a warning.
        t.timer -= dt;
        t.warn = t.timer > 0 && t.timer < 0.5 ? 1 - t.timer / 0.5 : 0;
        if (t.timer <= 0) t.y += Math.sign(g.y - t.y) * 70 * dt;
        t.y += Math.sin(time * 6 + t.x / 40) * 40 * dt;
      }
      let hit = false;
      if (t.kind === "pillar") {
        const box = t.dir < 0 ? { x: t.x - t.w * 0.35, y: 0, w: t.w * 0.7, h: t.h } : { x: t.x - t.w * 0.35, y: height - t.h, w: t.w * 0.7, h: t.h };
        hit = hitCircleRect(CRAFT_X, g.y, CRAFT_R * 0.8, box);
      } else hit = hitCircle(CRAFT_X, g.y, CRAFT_R, t.x, t.y, t.w * 0.4);
      if (!hit) return;
      t.active = false;
      if (t.kind === "gem") {
        g.gems += 1;
        const points = 20 * combo.hit();
        g.score += points;
        popups.add(t.x, t.y - 20, "+" + points, "#ffffff");
        particles.burst(t.x, t.y, { color: COLOURS.gem });
        sfx.coin();
        buzz("collect");
      } else if (t.kind === "shield") {
        effects.activate("shield", 6);
        popups.add(t.x, t.y - 20, "Shield!", "#ffffff");
        sfx.coin();
      } else if (effects.isActive("shield")) {
        effects.end("shield");
        particles.burst(t.x, t.y, { color: COLOURS.shield });
        shake.hit(6);
        sfx.hit();
      } else end();
    });

    effects.update(dt);
    combo.update(dt);
    particles.update(dt);
    popups.update(dt);
    shake.update(dt);
    g.score += speed * dt * 0.05;
    probe(Math.floor(g.score), CRAFT_X, g.y, speed);

    ctx.save();
    shake.apply(ctx);
    drawWorld(ctx, width, height, time, climbing ? 1 : 0);
    particles.draw(ctx);
    popups.draw(ctx);
    ctx.restore();
    drawHud(ctx, width, { score: g.score, best, distance: g.distance / 10, combo: combo.multiplier, effects });
    if (g.t < 1.5 && tip) drawBanner(ctx, width, height, "Hold to climb");
  };

  const start = () => {
    game.current = fresh();
    things.clear();
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
          <GameMenu
            className="absolute inset-x-4 bottom-24"
            title={GAME_NAME}
            tagline="Fly through the cave. Miss the rocks and bats."
            art={<Sprite draw={(ctx, w, h) => drawCraft(ctx, w / 2, h / 2, w * 0.8)} width={64} height={40} label="Your craft" />}
            best={best}
            onPlay={start}
            howTo={["Hold anywhere (or Space) to climb; let go to sink.", "Fly between the rock columns and away from the bats.", "Gems score points. A crash ends the run; the cave walls only push you back."]}
            powerUps={[
              { name: "Gem", text: "extra points" },
              { name: "Shield", text: "takes one hit for you" },
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
              { label: "Distance", value: result.distance + " m" },
              { label: "Gems", value: result.gems },
            ]}
            onAgain={start}
            shareText={"I scored " + result.score + " in " + GAME_NAME}
          >
            <PostScore board={board} score={result.score} />
          </GameOver>
        )}
      </div>
      {screen !== "playing" && <GameSettings />}
      <Leaderboard board={board} title="Top pilots" icon={() => <Sprite draw={(ctx, w, h) => drawCraft(ctx, w / 2, h / 2, w * 0.9)} width={22} height={14} />} />
    </div>
  );
}
`;

export const caveFlyer: GameTemplate = {
  id: "cave-flyer",
  name: "Cave flyer",
  dims: "2d",
  style: "action",
  fits: "one-touch flying games: hold to rise and let go to fall through a cave, a tunnel, the sky or under water (a craft, a rocket, a bird, a fish, a balloon)",
  kits: ["game-2d"],
  files: { "src/App.tsx": appFor("./play/art", "GAME_NAME"), "src/play/Game.tsx": GAME, "src/play/art.ts": ART },
  leaderboard: true,
  title: { from: "./play/art", name: "GAME_NAME" },
  brief: `This game starts from GoodBuild's Cave flyer template, a working, tested game: src/play/Game.tsx (the game), src/play/art.ts (the name, colours and one drawing function per thing) and src/App.tsx. Reshape it to the plan instead of starting again:
- Rename it (GAME_NAME, BEST_KEY in art.ts) and restyle every drawing and colour to the plan's look: the craft, the cave, the columns, the bats. Keep one drawing function per thing, used in the game and in Sprite.
- Make the obstacles, pick-ups and characters the plan's: change FIRST, LATER and what each does on contact, and keep declareGame listing exactly the kinds the game has, with spawned(kind) when one appears. Every kind must show up within the first 15 seconds. Keep the walls pushing back rather than ending the run unless the plan asks otherwise.
- ${KEEP_2D}`,
};
