import type { GameTemplate } from "./index";
import { KEEP_2D, appFor } from "./shared";

/**
 * Rhythm lanes (D150, genre templates): notes fall on the beat down four lanes; slide your pad under
 * them to play the tune, dodge the bombs, and keep the groove meter up. The beat quickens as you go.
 * Double points and slow time help. A canvas "action" game (D112). Original to GoodBuild.
 */

const ART = `// How everything looks and sounds. Change the colours, shapes and notes to fit the plan's look.

export const GAME_NAME = "Rhythm Lanes";
export const BEST_KEY = "rhythm-lanes";
export const LANES = 4;

export const COLOURS = {
  bgTop: "#1e1b4b",
  bgBottom: "#0f172a",
  lanes: ["#f472b6", "#38bdf8", "#facc15", "#4ade80"],
  pad: "#ffffff",
  bomb: "#111827",
  spark: "#f97316",
};

/** One note per lane, from a five-note scale, so any catch sounds right with the last. In hertz. */
export const NOTES = [392, 440, 523.25, 587.33];

export function drawBackground(ctx: CanvasRenderingContext2D, width: number, height: number, laneW: number, beat: number) {
  const bg = ctx.createLinearGradient(0, 0, 0, height);
  bg.addColorStop(0, COLOURS.bgTop);
  bg.addColorStop(1, COLOURS.bgBottom);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);
  for (let i = 0; i < LANES; i++) {
    ctx.fillStyle = COLOURS.lanes[i];
    // The lanes pulse gently on every beat.
    ctx.globalAlpha = 0.08 + 0.06 * (1 - beat);
    ctx.fillRect(i * laneW + 4, 0, laneW - 8, height);
  }
  ctx.globalAlpha = 1;
}

export function drawNote(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, lane: number) {
  ctx.fillStyle = COLOURS.lanes[lane];
  ctx.globalAlpha = 0.35;
  ctx.beginPath();
  ctx.arc(x, y, r + 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.beginPath();
  ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.3, 0, Math.PI * 2);
  ctx.fill();
}

export function drawBomb(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, time: number) {
  ctx.fillStyle = COLOURS.bomb;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#ef4444";
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = Math.floor(time * 10) % 2 ? COLOURS.spark : "#fde047";
  ctx.beginPath();
  ctx.arc(x + r * 0.6, y - r * 0.9, 4, 0, Math.PI * 2);
  ctx.fill();
}

/** A power-up: a ring with a letter. */
export function drawPickup(ctx: CanvasRenderingContext2D, x: number, y: number, kind: string, time: number) {
  const r = 15 + Math.sin(time * 6) * 2;
  ctx.strokeStyle = kind === "double" ? "#facc15" : "#a78bfa";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 15px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(kind === "double" ? "x2" : "S", x, y + 1);
  ctx.textAlign = "start";
  ctx.textBaseline = "alphabetic";
}

export function drawPad(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = COLOURS.pad;
  ctx.beginPath();
  ctx.roundRect?.(x, y, w, h, h / 2);
  if (!ctx.roundRect) ctx.rect(x, y, w, h);
  ctx.fill();
}

/** The groove meter: how much of the tune is still flowing. */
export function drawGroove(ctx: CanvasRenderingContext2D, width: number, height: number, groove: number) {
  ctx.fillStyle = "rgba(255,255,255,0.15)";
  ctx.fillRect(12, height - 14, width - 24, 6);
  ctx.fillStyle = groove > 0.3 ? "#4ade80" : "#ef4444";
  ctx.fillRect(12, height - 14, (width - 24) * Math.max(0, groove), 6);
}
`;

const GAME = `import { useRef, useState } from "react";
import { GameCanvas, type Frame } from "../game/GameCanvas";
import { GameMenu } from "../game/GameMenu";
import { GameOver } from "../game/GameOver";
import { GameSettings } from "../game/GameSettings";
import { Leaderboard, PostScore } from "../game/Leaderboard";
import { TopThree } from "../game/TopThree";
import { Combo, prefersReducedMotion } from "../game/extras";
import { buzz } from "../game/haptics";
import { drawBanner, drawHud } from "../game/hud";
import { Particles, Popups, Shake } from "../game/juice";
import { useLeaderboard } from "../game/leaderboard";
import { newActor, place } from "../game/npc";
import { Effects } from "../game/powerups";
import { declareGame, probe, spawned } from "../game/probe";
import { sfx, tone } from "../game/sound";
import { bestScore, saveBest } from "../game/storage";
import { Pool, difficulty } from "../game/world";
import { BEST_KEY, COLOURS, GAME_NAME, LANES, NOTES, drawBackground, drawBomb, drawGroove, drawNote, drawPad, drawPickup } from "./art";

// Everything the game has, by the names the code uses. Change it with the plan: every kind listed here
// must show up within the first 15 seconds of a round, and spawned(kind) is called when one appears.
declareGame({ style: "action", controls: ["sides", "tap", "keys"], obstacles: ["bomb"], powerups: ["double", "slow"] });

const WIDTH = 360;
const HEIGHT = 640;
const PAD_Y = 560;
const PAD_H = 16;
const LANE_W = WIDTH / LANES;
const PAD_W = LANE_W - 20;
const LIVES = 3;
/** Beats a minute at the start and at full speed. */
const BPM_START = 100;
const BPM_FULL = 170;
/** The order things first fall in, so a short round meets every kind; after that they're mixed. */
const FIRST = ["note", "note", "bomb", "note", "double", "note", "note", "bomb", "slow", "note"];
const LATER = ["note", "note", "note", "note", "note", "bomb", "bomb", "double", "slow"];

// Made once, reused every round: nothing is created while the game runs.
const falling = new Pool(newActor, 40);
const effects = new Effects();
const combo = new Combo();
const particles = new Particles(prefersReducedMotion() ? 40 : 160);
const popups = new Popups();
const shake = new Shake();

type Screen = "start" | "playing" | "paused" | "over";

const laneX = (lane: number) => lane * LANE_W + LANE_W / 2;
const fresh = () => ({ lane: 1, x: laneX(1), t: 0, score: 0, lives: LIVES, groove: 1, caught: 0, spawns: 0, beatIn: 0.8, beatPhase: 0, held: 0, hurt: 0 });

export default function Game() {
  const [screen, setScreen] = useState<Screen>("start");
  const [best, setBest] = useState(() => bestScore(BEST_KEY));
  const [result, setResult] = useState({ score: 0, caught: 0 });
  const board = useLeaderboard();
  const game = useRef(fresh());

  const drawWorld = (ctx: CanvasRenderingContext2D, width: number, height: number, time: number) => {
    const g = game.current;
    drawBackground(ctx, width, height, LANE_W, g.beatPhase);
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.fillRect(0, PAD_Y + PAD_H / 2, width, 2);
    falling.each((f) => {
      if (f.kind === "note") drawNote(ctx, f.x, f.y, 16, f.lane);
      else if (f.kind === "bomb") drawBomb(ctx, f.x, f.y, 16, time);
      else drawPickup(ctx, f.x, f.y, f.kind, time);
    });
    ctx.globalAlpha = g.hurt > 0 && Math.floor(time * 16) % 2 === 0 ? 0.4 : 1;
    drawPad(ctx, g.x - PAD_W / 2, PAD_Y, PAD_W, PAD_H);
    ctx.globalAlpha = 1;
    drawGroove(ctx, width, height, g.groove);
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
    const level = difficulty(g.t, 70);
    const pace = effects.isActive("slow") ? 0.6 : 1;
    const bpm = BPM_START + (BPM_FULL - BPM_START) * level;
    const beat = 60 / bpm;
    // Notes take two beats to fall to the pad, so they land on the beat.
    const fall = ((PAD_Y + 30) / (beat * 2)) * pace;

    // Moving: tap a lane, or press left and right to step one lane (held, it keeps stepping). A quick tap can
    // start and end between two frames, so actionPressed counts as well as a finger that's down.
    if (input.pointer.down || input.actionPressed) g.lane = Math.max(0, Math.min(LANES - 1, Math.floor(input.pointer.x / LANE_W)));
    const keys = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    if (keys) {
      g.held -= dt;
      if (g.held <= 0) {
        g.lane = Math.max(0, Math.min(LANES - 1, g.lane + keys));
        g.held = 0.16;
      }
    } else g.held = 0;
    g.x += (laneX(g.lane) - g.x) * Math.min(1, dt * 22);
    g.hurt = Math.max(0, g.hurt - dt);

    // A new thing falls on every beat.
    g.beatIn -= dt * pace;
    g.beatPhase = Math.max(0, g.beatIn / beat);
    if (g.beatIn <= 0) {
      g.beatIn += beat;
      const f = falling.get();
      if (f) {
        const kind = g.spawns < FIRST.length ? FIRST[g.spawns] : LATER[Math.floor(Math.random() * LATER.length)];
        g.spawns += 1;
        const lane = Math.floor(Math.random() * LANES);
        place(f, kind, laneX(lane), -20, 32, 32);
        f.lane = lane;
        if (kind !== "note") spawned(kind);
      }
    }

    falling.each((f) => {
      f.y += fall * dt;
      const atPad = f.y >= PAD_Y - 6 && f.y <= PAD_Y + PAD_H + 10;
      if (atPad && Math.abs(f.x - g.x) < PAD_W / 2) {
        f.active = false;
        if (f.kind === "note") {
          g.caught += 1;
          const points = 10 * combo.hit() * (effects.isActive("double") ? 2 : 1);
          g.score += points;
          g.groove = Math.min(1, g.groove + 0.06);
          popups.add(f.x, f.y - 24, "+" + points, "#ffffff");
          particles.burst(f.x, f.y, { color: COLOURS.lanes[f.lane] });
          tone(NOTES[f.lane], 0.18, { type: "triangle" });
          buzz("collect");
        } else if (f.kind === "bomb") {
          if (g.hurt <= 0) {
            g.lives -= 1;
            g.hurt = 1;
            combo.break();
            shake.hit(8);
            sfx.hit();
            buzz("hit");
            if (g.lives <= 0) end();
          }
        } else {
          effects.activate(f.kind, 6);
          popups.add(f.x, f.y - 24, f.kind === "double" ? "Double points!" : "Slow time!", "#ffffff");
          sfx.coin();
        }
        return;
      }
      if (f.y > height + 20) {
        f.active = false;
        // A missed note breaks the combo and drains the groove.
        if (f.kind === "note") {
          combo.break();
          g.groove -= 0.18;
          if (g.groove <= 0) end();
        }
      }
    });

    effects.update(dt);
    combo.update(dt);
    particles.update(dt);
    popups.update(dt);
    shake.update(dt);
    probe(Math.floor(g.score), g.x, PAD_Y, fall);

    ctx.save();
    shake.apply(ctx);
    drawWorld(ctx, width, height, time);
    particles.draw(ctx);
    popups.draw(ctx);
    ctx.restore();
    drawHud(ctx, width, { score: g.score, best, lives: g.lives, combo: combo.multiplier, effects });
    if (g.t < 1.6 && tip) drawBanner(ctx, width, height, "Tap a lane to catch the notes");
  };

  const start = () => {
    game.current = fresh();
    falling.clear();
    effects.clear();
    combo.break();
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
          <GameMenu
            className="absolute inset-x-4 bottom-24"
            title={GAME_NAME}
            tagline="Catch the notes on the beat. Dodge the bombs."
            best={best}
            onPlay={start}
            howTo={["Tap a lane or use the arrow keys to slide your pad.", "Catch the falling notes to play the tune; catches in a row build a combo.", "A bomb costs a life, and missed notes drain the groove meter. No lives or no groove, and the music stops."]}
            powerUps={[
              { name: "Double points", text: "notes score twice for a few seconds" },
              { name: "Slow time", text: "the notes fall slower for a few seconds" },
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
          <GameOver score={result.score} best={best} stats={[{ label: "Notes played", value: result.caught }]} onAgain={start} shareText={"I scored " + result.score + " in " + GAME_NAME}>
            <PostScore board={board} score={result.score} />
          </GameOver>
        )}
      </div>
      {screen !== "playing" && <GameSettings />}
      <Leaderboard board={board} title="Top players" />
    </div>
  );
}
`;

export const rhythmLanes: GameTemplate = {
  id: "rhythm-lanes",
  name: "Rhythm lanes",
  dims: "2d",
  style: "action",
  fits: "rhythm and music games: notes or beats falling down lanes to catch in time, tap to the beat, dance or drum games, anything with a tune that speeds up",
  kits: ["game-2d"],
  files: { "src/App.tsx": appFor("./play/art", "GAME_NAME"), "src/play/Game.tsx": GAME, "src/play/art.ts": ART },
  leaderboard: true,
  title: { from: "./play/art", name: "GAME_NAME" },
  brief: `This game starts from GoodBuild's Rhythm lanes template, a working, tested game: src/play/Game.tsx (the game), src/play/art.ts (the name, colours, the four notes and one drawing function per thing) and src/App.tsx. Reshape it to the plan instead of starting again:
- Rename it (GAME_NAME, BEST_KEY in art.ts) and restyle every drawing and colour to the plan's look. Change NOTES for a different tune (keep them from one scale so any catch sounds right).
- Make what falls and what helps the plan's: change FIRST, LATER, the beat (BPM_START, BPM_FULL) and what each thing does when caught, and keep declareGame listing exactly the kinds the game has, with spawned(kind) when one appears. Every kind must show up within the first 15 seconds.
- ${KEEP_2D}`,
};
