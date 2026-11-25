import type { GameTemplate } from "./index";
import { KEEP_2D, appFor } from "./shared";

/**
 * Platform hop (D150, genre templates): a side-scrolling platformer. The world runs left, faster as you
 * go; jump across gaps, over spikes, and onto the beetles that walk the ledges; collect coins. A shield
 * takes one hit, double points doubles everything for a while. Three lives. Canvas "action" (D112).
 * Original to GoodBuild.
 */

const ART = `// How everything in the game looks. Each thing is drawn by one function. Change the colours and
// shapes to fit the plan's look.

export const GAME_NAME = "Platform Hop";
export const BEST_KEY = "platform-hop";

export const COLOURS = {
  skyTop: "#38bdf8",
  skyBottom: "#e0f2fe",
  hills: "#86efac",
  ground: "#92400e",
  grass: "#22c55e",
  hero: "#f97316",
  spike: "#475569",
  beetle: "#7c3aed",
  coin: "#facc15",
  shield: "#38bdf8",
  double: "#facc15",
};

export function drawSky(ctx: CanvasRenderingContext2D, width: number, height: number, scroll: number) {
  const sky = ctx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, COLOURS.skyTop);
  sky.addColorStop(1, COLOURS.skyBottom);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);
  // Hills drift slower than the ledges, for depth.
  ctx.fillStyle = COLOURS.hills;
  for (let i = -1; i < 4; i++) {
    const x = i * 180 - ((scroll * 0.3) % 180);
    ctx.beginPath();
    ctx.ellipse(x + 90, height - 120, 120, 90, 0, Math.PI, 0);
    ctx.fill();
  }
}

export function drawLedge(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, bottom: number) {
  ctx.fillStyle = COLOURS.ground;
  ctx.fillRect(x, y, w, bottom - y);
  ctx.fillStyle = COLOURS.grass;
  ctx.fillRect(x, y, w, 10);
}

/** The hero: a round runner whose legs move while running. */
export function drawHero(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, time: number, onGround: boolean) {
  const step = onGround ? Math.sin(time * 18) * size * 0.18 : size * 0.2;
  ctx.strokeStyle = "#1f2937";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(x - size * 0.15, y + size * 0.3);
  ctx.lineTo(x - size * 0.2 + step, y + size * 0.55);
  ctx.moveTo(x + size * 0.15, y + size * 0.3);
  ctx.lineTo(x + size * 0.2 - step, y + size * 0.55);
  ctx.stroke();
  ctx.fillStyle = COLOURS.hero;
  ctx.beginPath();
  ctx.arc(x, y, size * 0.42, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(x + size * 0.14, y - size * 0.08, size * 0.12, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#111827";
  ctx.beginPath();
  ctx.arc(x + size * 0.18, y - size * 0.08, size * 0.06, 0, Math.PI * 2);
  ctx.fill();
}

export function drawSpikes(ctx: CanvasRenderingContext2D, x: number, y: number, w: number) {
  ctx.fillStyle = COLOURS.spike;
  const n = Math.max(1, Math.round(w / 14));
  for (let i = 0; i < n; i++) {
    ctx.beginPath();
    ctx.moveTo(x + (i * w) / n, y);
    ctx.lineTo(x + ((i + 0.5) * w) / n, y - 18);
    ctx.lineTo(x + ((i + 1) * w) / n, y);
    ctx.fill();
  }
}

export function drawBeetle(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, time: number) {
  ctx.fillStyle = COLOURS.beetle;
  ctx.beginPath();
  ctx.ellipse(x, y, w / 2, w / 3, 0, Math.PI, 0);
  ctx.fill();
  ctx.strokeStyle = "#111827";
  ctx.lineWidth = 3;
  const k = Math.sin(time * 14) * 3;
  ctx.beginPath();
  ctx.moveTo(x - w / 3, y);
  ctx.lineTo(x - w / 3 - k, y + 6);
  ctx.moveTo(x + w / 3, y);
  ctx.lineTo(x + w / 3 + k, y + 6);
  ctx.stroke();
}

export function drawCoin(ctx: CanvasRenderingContext2D, x: number, y: number, time: number) {
  const squash = Math.abs(Math.cos(time * 4));
  ctx.fillStyle = COLOURS.coin;
  ctx.beginPath();
  ctx.ellipse(x, y, 9 * squash + 2, 11, 0, 0, Math.PI * 2);
  ctx.fill();
}

/** A power-up: a glowing disc with a letter. */
export function drawPickup(ctx: CanvasRenderingContext2D, x: number, y: number, kind: string, time: number) {
  const r = 14 + Math.sin(time * 6) * 2;
  ctx.fillStyle = kind === "shield" ? COLOURS.shield : COLOURS.double;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#0f172a";
  ctx.font = "bold 14px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(kind === "shield" ? "S" : "x2", x, y + 1);
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
import { prefersReducedMotion } from "../game/extras";
import { buzz } from "../game/haptics";
import { drawBanner, drawHud } from "../game/hud";
import { Particles, Popups, Shake, hitRect } from "../game/juice";
import { useLeaderboard } from "../game/leaderboard";
import { newActor, place } from "../game/npc";
import { Effects } from "../game/powerups";
import { declareGame, probe, spawned } from "../game/probe";
import { sfx } from "../game/sound";
import { bestScore, saveBest } from "../game/storage";
import { Pool, difficulty } from "../game/world";
import { BEST_KEY, GAME_NAME, drawBeetle, drawCoin, drawHero, drawLedge, drawPickup, drawSky, drawSpikes } from "./art";

// Everything the game has, by the names the code uses. Change it with the plan: every kind listed here
// must show up within the first 15 seconds of a round, and spawned(kind) is called when one appears.
declareGame({ style: "action", controls: ["tap", "sides", "keys"], obstacles: ["gap", "spike"], powerups: ["shield", "double"], npcs: ["beetle"] });

const WIDTH = 360;
const HEIGHT = 640;
const BOTTOM = HEIGHT;
const HERO = 36;
const GRAVITY = 1900;
const JUMP = 760;
const LIVES = 3;
/** What sits on each new ledge, in order at first so a short round meets every kind; then mixed. */
const FIRST = ["coin", "spike", "beetle", "shield", "coin", "double", "spike", "coin"];
const LATER = ["coin", "coin", "spike", "spike", "beetle", "beetle", "shield", "double", "none"];

// Made once, reused every round: nothing is created while the game runs.
const ledges = new Pool(newActor, 12);
const things = new Pool(newActor, 24);
const effects = new Effects();
const particles = new Particles(prefersReducedMotion() ? 40 : 160);
const popups = new Popups();
const shake = new Shake();

type Screen = "start" | "playing" | "paused" | "over";

const fresh = () => ({ x: 90, y: 440, vy: 0, onGround: true, t: 0, scroll: 0, score: 0, coins: 0, lives: LIVES, hurt: 0, ledges: 0, lastEnd: 0, gaps: 0 });

export default function Game() {
  const [screen, setScreen] = useState<Screen>("start");
  const [best, setBest] = useState(() => bestScore(BEST_KEY));
  const [result, setResult] = useState({ score: 0, coins: 0 });
  const board = useLeaderboard();
  const game = useRef(fresh());

  /** A new ledge to the right of the last, with a gap before it and something on it. */
  const addLedge = (level: number) => {
    const g = game.current;
    const l = ledges.get();
    if (!l) return;
    const first = g.ledges === 0;
    const gap = first ? 0 : 50 + Math.random() * (40 + level * 70);
    const w = first ? 420 : 150 + Math.random() * 140;
    const y = first ? 470 : 400 + Math.random() * 140;
    place(l, "ledge", g.lastEnd + gap, y, w, BOTTOM - y);
    if (gap > 0) {
      g.gaps += 1;
      spawned("gap");
    }
    g.lastEnd = l.x + w;
    g.ledges += 1;
    if (first) return;
    const kind = g.ledges - 2 < FIRST.length ? FIRST[g.ledges - 2] : LATER[Math.floor(Math.random() * LATER.length)];
    const t = kind === "none" ? null : things.get();
    if (!t) return;
    if (kind === "spike") place(t, "spike", l.x + w * 0.4, y, 42, 18);
    else if (kind === "beetle") {
      place(t, "beetle", l.x + w * 0.6, y, 34, 22);
      t.dir = -1;
      t.timer = l.x;
      t.warn = l.x + w;
    } else if (kind === "coin") place(t, "coin", l.x + w * 0.5, y - 60, 22, 22);
    else place(t, kind, l.x + w * 0.5, y - 70, 30, 30);
    if (kind !== "coin") spawned(kind);
  };

  const drawWorld = (ctx: CanvasRenderingContext2D, width: number, height: number, time: number) => {
    const g = game.current;
    drawSky(ctx, width, height, g.scroll);
    ledges.each((l) => drawLedge(ctx, l.x, l.y, l.w, BOTTOM));
    things.each((t) => {
      if (t.kind === "spike") drawSpikes(ctx, t.x - t.w / 2, t.y, t.w);
      else if (t.kind === "beetle") drawBeetle(ctx, t.x, t.y, t.w, time);
      else if (t.kind === "coin") drawCoin(ctx, t.x, t.y, time);
      else drawPickup(ctx, t.x, t.y, t.kind, time);
    });
    if (effects.isActive("shield")) {
      ctx.strokeStyle = "#38bdf8";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(g.x, g.y, HERO * 0.7, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = g.hurt > 0 && Math.floor(time * 16) % 2 === 0 ? 0.4 : 1;
    drawHero(ctx, g.x, g.y, HERO, time, g.onGround);
    ctx.globalAlpha = 1;
  };

  const end = () => {
    const g = game.current;
    const score = Math.floor(g.score);
    sfx.lose();
    buzz("over");
    if (saveBest(score, BEST_KEY)) setBest(score);
    setResult({ score, coins: g.coins });
    setScreen("over");
  };

  /** A hit or a fall: the shield takes it, else a life goes and the hero comes back on the next ledge. */
  const hurt = (fell: boolean) => {
    const g = game.current;
    if (g.hurt > 0) return;
    if (!fell && effects.isActive("shield")) {
      effects.end("shield");
      g.hurt = 0.8;
      sfx.hit();
      return;
    }
    g.lives -= 1;
    g.hurt = 1.4;
    shake.hit(8);
    sfx.hit();
    buzz("hit");
    if (g.lives <= 0) return end();
    if (fell) {
      let back: { x: number; y: number } | null = null;
      ledges.each((l) => {
        if (!back && l.x + l.w > g.x + 20) back = { x: Math.max(l.x + 30, g.x), y: l.y - HERO };
      });
      const spot = back as { x: number; y: number } | null;
      g.x = spot ? Math.min(WIDTH - 40, spot.x) : g.x;
      g.y = spot ? spot.y - 40 : 300;
      g.vy = 0;
    }
  };

  const onFrame = (frame: Frame) => {
    const { ctx, width, height, dt, time, input } = frame;
    const g = game.current;
    g.t += dt;
    const level = difficulty(g.t, 90);
    const speed = 170 + level * 230;
    const move = speed * dt;
    g.scroll += move;
    g.score += move * 0.05 * (effects.isActive("double") ? 2 : 1);

    // The world runs left. New ledges join on the right as the last one comes into view.
    ledges.each((l) => {
      l.x -= move;
      if (l.x + l.w < -20) l.active = false;
    });
    g.lastEnd -= move;
    while (g.lastEnd < width + 200) addLedge(level);

    // Moving: left and right shift the hero along the screen; a tap, Space or up jumps when on a ledge.
    const keys = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    g.x = Math.max(24, Math.min(width - 24, g.x + keys * 220 * dt));
    if ((input.actionPressed || input.up) && g.onGround) {
      g.vy = -JUMP;
      g.onGround = false;
      sfx.jump();
    }
    g.vy += GRAVITY * dt;
    const before = g.y;
    g.y += g.vy * dt;
    g.onGround = false;
    // Land on a ledge only when coming down onto its top.
    ledges.each((l) => {
      const top = l.y - HERO * 0.55;
      if (g.vy >= 0 && before <= top + 2 && g.y >= top && g.x > l.x - 8 && g.x < l.x + l.w + 8) {
        g.y = top;
        g.vy = 0;
        g.onGround = true;
      }
    });
    if (g.y > height + 60) hurt(true);
    g.hurt = Math.max(0, g.hurt - dt);

    const me = { x: g.x - HERO * 0.35, y: g.y - HERO * 0.4, w: HERO * 0.7, h: HERO * 0.9 };
    things.each((t) => {
      t.x -= move;
      if (t.kind === "beetle") {
        // Walks its ledge back and forth (its ends kept in timer and warn).
        t.timer -= move;
        t.warn -= move;
        t.x += t.dir * 50 * dt;
        if (t.x < t.timer + 20) t.dir = 1;
        if (t.x > t.warn - 20) t.dir = -1;
      }
      if (t.x < -40) {
        t.active = false;
        return;
      }
      const box = t.kind === "spike" ? { x: t.x - t.w / 2, y: t.y - 16, w: t.w, h: 16 } : t.kind === "beetle" ? { x: t.x - t.w / 2, y: t.y - t.h, w: t.w, h: t.h } : { x: t.x - t.w / 2, y: t.y - t.h / 2, w: t.w, h: t.h };
      if (!hitRect(me, box)) return;
      if (t.kind === "coin") {
        t.active = false;
        g.coins += 1;
        const points = 10 * (effects.isActive("double") ? 2 : 1);
        g.score += points;
        popups.add(t.x, t.y - 16, "+" + points, "#ffffff");
        sfx.coin();
        buzz("collect");
      } else if (t.kind === "shield" || t.kind === "double") {
        t.active = false;
        effects.activate(t.kind, t.kind === "shield" ? 30 : 7);
        popups.add(t.x, t.y - 16, t.kind === "shield" ? "Shield!" : "Double points!", "#ffffff");
        sfx.coin();
      } else if (t.kind === "beetle" && g.vy > 0 && g.y < t.y - t.h * 0.4) {
        // Landing on a beetle: it's gone, and the hero bounces.
        t.active = false;
        g.vy = -JUMP * 0.6;
        g.score += 25;
        popups.add(t.x, t.y - 30, "+25", "#ffffff");
        particles.burst(t.x, t.y, { color: "#7c3aed" });
        sfx.coin();
      } else hurt(false);
    });

    effects.update(dt);
    particles.update(dt);
    popups.update(dt);
    shake.update(dt);
    probe(Math.floor(g.score), g.x, g.y, speed);

    ctx.save();
    shake.apply(ctx);
    drawWorld(ctx, width, height, time);
    particles.draw(ctx);
    popups.draw(ctx);
    ctx.restore();
    drawHud(ctx, width, { score: g.score, best, lives: g.lives, effects });
    if (g.t < 1.6 && tip) drawBanner(ctx, width, height, "Tap to jump");
  };

  const start = () => {
    game.current = fresh();
    ledges.clear();
    things.clear();
    effects.clear();
    addLedge(0);
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
          controls={["left", "right", "action"]}
          label={GAME_NAME}
        />
        <TopThree board={board} className="absolute right-2 top-14" />
        {screen === "start" && (
          <GameMenu
            className="absolute inset-x-4 bottom-24"
            title={GAME_NAME}
            tagline="Jump the gaps. Hop the spikes. Grab the coins."
            best={best}
            onPlay={start}
            howTo={["Tap or press Space to jump.", "Jump across gaps and over spikes. Land on a beetle from above to squash it.", "Falling, spikes or walking into a beetle cost a life. Three lives."]}
            powerUps={[
              { name: "Shield", text: "takes one hit for you" },
              { name: "Double points", text: "everything scores twice for a while" },
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
          <GameOver score={result.score} best={best} stats={[{ label: "Coins", value: result.coins }]} onAgain={start} shareText={"I scored " + result.score + " in " + GAME_NAME}>
            <PostScore board={board} score={result.score} />
          </GameOver>
        )}
      </div>
      {screen !== "playing" && <GameSettings />}
      <Leaderboard board={board} title="Top hoppers" />
    </div>
  );
}
`;

export const platformHop: GameTemplate = {
  id: "platform-hop",
  name: "Platform hop",
  dims: "2d",
  style: "action",
  fits: "platformers and side-scrollers: run and jump across ledges and gaps, hop over spikes, stomp on enemies, collect coins (any hero: a runner, an animal, a robot)",
  kits: ["game-2d"],
  files: { "src/App.tsx": appFor("./play/art", "GAME_NAME"), "src/play/Game.tsx": GAME, "src/play/art.ts": ART },
  leaderboard: true,
  title: { from: "./play/art", name: "GAME_NAME" },
  brief: `This game starts from GoodBuild's Platform hop template, a working, tested game: src/play/Game.tsx (the game), src/play/art.ts (the name, colours and one drawing function per thing) and src/App.tsx. Reshape it to the plan instead of starting again:
- Rename it (GAME_NAME, BEST_KEY in art.ts) and restyle every drawing and colour to the plan's look: the hero, the ledges, the spikes and beetles, the coins.
- Make the obstacles, enemies and pick-ups the plan's: change FIRST, LATER and what each does on contact, the jump (GRAVITY, JUMP) and how fast it speeds up, and keep declareGame listing exactly the kinds the game has, with spawned(kind) when one appears. Every kind must show up within the first 15 seconds.
- ${KEEP_2D}`,
};
