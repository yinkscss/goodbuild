import type { CheckIssue } from "../checks";

import { HAPTICS, HUD, NPC, POWERUPS, PROBE, WORLD } from "./game-blocks";
import { LEADERBOARD_TS, LEADERBOARD_TSX, SPRITE } from "./game-files";
import type { Kit } from "./registry";

/**
 * 2D games (D72). No game engine and no new packages: a canvas, a frame loop, touch and keyboard
 * input, a few synthesised sounds and a saved best score. That keeps a game a few kilobytes on top
 * of the app, which matters on the phones and data plans most players here have, and it runs in
 * both previews and inside MiniPay.
 *
 * The starter files hold the parts that are easy to get subtly wrong (scaling for sharp pixels, a
 * loop that pauses in a hidden tab, input that works for a thumb and for a keyboard), so the
 * builder writes the game and not the plumbing.
 */

const GAME_CANVAS = `import { useEffect, useRef, type CSSProperties } from "react";
import { checkRound, checkTick, stepsPerFrame } from "./probe";

/** What the player is pressing right now. Read it in onFrame; never store it in React state. */
export interface GameInput {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  /** Space, Enter, a tap or click on the game, or the on-screen action button. */
  action: boolean;
  /** True only on the frame the action started: use it for jump, shoot or "tap to start". */
  actionPressed: boolean;
  /** The finger or mouse on the game, in game coordinates. */
  pointer: { x: number; y: number; down: boolean };
}

/** One frame: where to draw, how much time passed, and the input. */
export interface Frame {
  ctx: CanvasRenderingContext2D;
  /** The game's own size, whatever the screen: draw in these coordinates. */
  width: number;
  height: number;
  /** Seconds since the last frame, never more than 1/30. Multiply every speed by it. */
  dt: number;
  /** Seconds the game has been running (not counting pauses). */
  time: number;
  input: GameInput;
}

export type ControlButton = "left" | "right" | "up" | "down" | "action";

const KEYS: Record<string, ControlButton> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
  a: "left",
  d: "right",
  w: "up",
  s: "down",
  " ": "action",
  Enter: "action",
};

const LABELS: Record<ControlButton, string> = { left: "◀", right: "▶", up: "▲", down: "▼", action: "●" };
const NAMES: Record<ControlButton, string> = { left: "Left", right: "Right", up: "Up", down: "Down", action: "Action" };

/**
 * The game's screen. It keeps the game at a fixed size in its own coordinates (360 x 640 by
 * default, a phone held upright) and scales it to fit, sharp on any screen. onFrame is called about
 * 60 times a second with the time step and the input; update the game there, then draw it.
 * While paused is true (the start and game-over screens), onFrame isn't called: onIdleFrame is,
 * so those screens show the game world (the road, the parked car) instead of an empty box. Draw
 * there only; don't move the game on or check for hits. Nothing runs while the tab is hidden.
 */
export function GameCanvas({
  width = 360,
  height = 640,
  paused = false,
  onFrame,
  onIdleFrame,
  controls = [],
  label = "Game",
  maxHeight,
  className,
  style,
}: {
  width?: number;
  height?: number;
  paused?: boolean;
  onFrame: (frame: Frame) => void;
  /**
   * Draws the start and game-over screens while paused: the game world standing still or drifting
   * slowly behind the menu. Draw only; never end the round, play a sound or score here.
   */
  onIdleFrame?: (frame: Frame) => void;
  /** On-screen buttons for phones. Leave empty when a tap anywhere is the only control. */
  controls?: ControlButton[];
  /** What a screen reader calls the game. */
  label?: string;
  /**
   * The tallest the game may be, as a CSS length. By default it leaves room for a top row (and the
   * on-screen buttons), so the whole game fits on a short or sideways phone without scrolling.
   */
  maxHeight?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef(onFrame);
  const idleRef = useRef(onIdleFrame);
  const pausedRef = useRef(paused);
  const input = useRef<GameInput>({ left: false, right: false, up: false, down: false, action: false, actionPressed: false, pointer: { x: 0, y: 0, down: false } });
  const held = useRef({ key: false, pointer: false, button: false });

  /** Let go of every key, button and finger. */
  const release = () => {
    const state = input.current;
    state.left = state.right = state.up = state.down = false;
    state.action = state.actionPressed = false;
    state.pointer.down = false;
    held.current.key = held.current.pointer = held.current.button = false;
  };

  useEffect(() => {
    frameRef.current = onFrame;
    idleRef.current = onIdleFrame;
    pausedRef.current = paused;
    // A tap on Play, or a key held when the game ended, must not carry into the next round as a jump.
    if (paused) release();
  }, [onFrame, onIdleFrame, paused]);

  // GoodBuild's check counts rounds: one starts when the game runs and ends when it pauses or leaves the page.
  useEffect(() => {
    checkRound(!paused);
    return () => checkRound(false);
  }, [paused]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    // Draw at the screen's real resolution so shapes and text stay sharp.
    const ratio = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);

    const state = input.current;
    const setAction = () => {
      const now = held.current.key || held.current.pointer || held.current.button;
      if (now && !state.action) state.actionPressed = true;
      state.action = now;
    };
    const onKey = (down: boolean) => (e: KeyboardEvent) => {
      const button = KEYS[e.key.length === 1 ? e.key.toLowerCase() : e.key];
      if (!button) return;
      // While the game isn't running the keys belong to the page: Enter and Space must still press
      // a focused Play button, and the arrows must still scroll.
      if (pausedRef.current) return;
      // Don't take keys from a form field elsewhere on the page.
      const target = e.target as HTMLElement | null;
      if (target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable)) return;
      // Ctrl, Cmd and Alt combinations are the browser's.
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      e.preventDefault();
      if (button === "action") {
        held.current.key = down;
        setAction();
      } else state[button] = down;
    };
    const keyDown = onKey(true);
    const keyUp = onKey(false);
    const place = (e: PointerEvent) => {
      const box = canvas.getBoundingClientRect();
      state.pointer.x = ((e.clientX - box.left) / box.width) * width;
      state.pointer.y = ((e.clientY - box.top) / box.height) * height;
    };
    const pointerDown = (e: PointerEvent) => {
      place(e);
      state.pointer.down = true;
      held.current.pointer = true;
      setAction();
    };
    const pointerUp = () => {
      state.pointer.down = false;
      held.current.pointer = false;
      setAction();
    };
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    canvas.addEventListener("pointerdown", pointerDown);
    canvas.addEventListener("pointermove", place);
    window.addEventListener("pointerup", pointerUp);
    window.addEventListener("pointercancel", pointerUp);
    // A key held while the window loses focus never sends its keyup: without this the player keeps running.
    const letGo = () => {
      state.left = state.right = state.up = state.down = false;
      state.pointer.down = false;
      held.current.key = held.current.pointer = held.current.button = false;
      setAction();
    };
    window.addEventListener("blur", letGo);
    document.addEventListener("visibilitychange", letGo);

    let raf = 0;
    let last = 0;
    let time = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      // A long gap (a hidden tab, a slow frame) must not make everything jump.
      const dt = Math.min((now - (last || now)) / 1000, 1 / 30);
      last = now;
      if (document.hidden) return;
      if (pausedRef.current) {
        // The start and game-over screens: the world is drawn, the game doesn't move on.
        if (!idleRef.current) return;
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        idleRef.current({ ctx, width, height, dt, time, input: state });
        return;
      }
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      // One step per frame. While GoodBuild checks the game it runs a few, so a short check covers a long round.
      const steps = stepsPerFrame();
      for (let i = 0; i < steps; i++) {
        time += dt;
        checkTick(dt);
        frameRef.current({ ctx, width, height, dt, time, input: state });
        state.actionPressed = false;
      }
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
      canvas.removeEventListener("pointerdown", pointerDown);
      canvas.removeEventListener("pointermove", place);
      window.removeEventListener("pointerup", pointerUp);
      window.removeEventListener("pointercancel", pointerUp);
      window.removeEventListener("blur", letGo);
      document.removeEventListener("visibilitychange", letGo);
    };
  }, [width, height]);

  const press = (button: ControlButton, down: boolean) => {
    if (button === "action") {
      held.current.button = down;
      const state = input.current;
      const now = held.current.key || held.current.pointer || held.current.button;
      if (now && !state.action) state.actionPressed = true;
      state.action = now;
    } else input.current[button] = down;
  };

  // As wide as the game's own size, and no taller than the screen has room for.
  const room = maxHeight ?? (controls.length > 0 ? "calc(100vh - 14rem)" : "calc(100vh - 9rem)");
  const fit = "min(" + width + "px, calc(" + room + " * " + (width / height).toFixed(4) + "))";
  return (
    <div className={className} style={{ width: "100%", maxWidth: fit, minWidth: Math.min(width, 200), marginInline: "auto", ...style }}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={label}
        // touch-action stops the page scrolling or zooming under a thumb that is playing.
        style={{ display: "block", width: "100%", aspectRatio: width + " / " + height, touchAction: "none", userSelect: "none", borderRadius: 12 }}
      />
      {controls.length > 0 && (
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginTop: 12 }}>
          <div style={{ display: "flex", gap: 8 }}>
            {controls.filter((c) => c !== "action").map((c) => (
              <ControlKey key={c} button={c} press={press} />
            ))}
          </div>
          {controls.includes("action") && <ControlKey button="action" press={press} />}
        </div>
      )}
    </div>
  );
}

function ControlKey({ button, press }: { button: ControlButton; press: (button: ControlButton, down: boolean) => void }) {
  return (
    <button
      type="button"
      aria-label={NAMES[button]}
      onPointerDown={(e) => {
        e.preventDefault();
        press(button, true);
      }}
      onPointerUp={() => press(button, false)}
      onPointerLeave={() => press(button, false)}
      onPointerCancel={() => press(button, false)}
      onContextMenu={(e) => e.preventDefault()}
      className="grid size-14 place-items-center rounded-full bg-card text-xl text-foreground shadow active:bg-muted"
      style={{ touchAction: "none", userSelect: "none", WebkitUserSelect: "none" }}
    >
      {LABELS[button]}
    </button>
  );
}
`;

const SOUND = `// Small game sounds made in the browser, so a game has sound with no audio files to download.
// Browsers only allow sound after the player has tapped or pressed something; before that these do nothing.

let audio: AudioContext | null = null;
let muted = false;

try {
  muted = window.localStorage.getItem("game-muted") === "1";
} catch {
  /* storage is blocked: sound stays on */
}

function context(): AudioContext | null {
  if (muted) return null;
  try {
    audio ??= new AudioContext();
    if (audio.state === "suspended") void audio.resume();
    return audio;
  } catch {
    return null;
  }
}

/** One note. frequency in Hz, seconds long. slideTo bends the pitch (up for a jump, down for a hit). */
export function tone(frequency: number, seconds = 0.12, options: { type?: OscillatorType; slideTo?: number; volume?: number; delay?: number } = {}) {
  const ctx = context();
  if (!ctx) return;
  const start = ctx.currentTime + (options.delay ?? 0);
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = options.type ?? "square";
  osc.frequency.setValueAtTime(frequency, start);
  if (options.slideTo) osc.frequency.exponentialRampToValueAtTime(options.slideTo, start + seconds);
  gain.gain.setValueAtTime(options.volume ?? 0.12, start);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + seconds);
  osc.connect(gain).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + seconds);
}

/** Ready-made sounds. Call them from the game: sfx.jump(), sfx.coin(). */
export const sfx = {
  jump: () => tone(320, 0.14, { slideTo: 640 }),
  coin: () => {
    tone(880, 0.07);
    tone(1320, 0.12, { delay: 0.07 });
  },
  hit: () => tone(200, 0.2, { type: "sawtooth", slideTo: 60 }),
  tap: () => tone(520, 0.05, { type: "triangle" }),
  win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.14, { delay: i * 0.1, type: "triangle" })),
  lose: () => [392, 330, 262].forEach((f, i) => tone(f, 0.18, { delay: i * 0.13, type: "triangle" })),
};

export function isMuted(): boolean {
  return muted;
}

export function setMuted(value: boolean) {
  muted = value;
  try {
    window.localStorage.setItem("game-muted", value ? "1" : "0");
  } catch {
    /* fine */
  }
}
`;

const STORAGE = `// The player's best score, kept in their browser. For a leaderboard other people can see, use
// useLeaderboard from src/game/leaderboard.ts as the game guide describes.

export function bestScore(game = "game"): number {
  try {
    return Number(window.localStorage.getItem("best:" + game)) || 0;
  } catch {
    return 0;
  }
}

/** Save the score if it beats the best. Returns true when it is a new best. */
export function saveBest(score: number, game = "game"): boolean {
  if (score <= bestScore(game)) return false;
  try {
    window.localStorage.setItem("best:" + game, String(score));
  } catch {
    /* storage is blocked: the score just isn't remembered */
  }
  return true;
}
`;

const JUICE = `// The small things that make a game feel good: bursts of particles, a screen shake, numbers that
// float up, easing, and collision tests. Nothing here allocates while the game runs.

export const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
export const lerp = (from: number, to: number, t: number) => from + (to - from) * t;
/** A random number from low up to high. */
export const rand = (low: number, high: number) => low + Math.random() * (high - low);

/** Easing: give each a number from 0 to 1 and get the eased 0 to 1 back. */
export const ease = {
  out: (t: number) => 1 - Math.pow(1 - t, 3),
  in: (t: number) => t * t * t,
  inOut: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  /** Overshoots a little, then settles: a pop. */
  back: (t: number) => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2),
};

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Two rectangles overlap. x and y are the top-left corner. */
export const hitRect = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
/** Two circles overlap. */
export const hitCircle = (ax: number, ay: number, ar: number, bx: number, by: number, br: number) => (ax - bx) * (ax - bx) + (ay - by) * (ay - by) < (ar + br) * (ar + br);
/** A circle overlaps a rectangle. */
export const hitCircleRect = (cx: number, cy: number, r: number, rect: Rect) => {
  const dx = cx - clamp(cx, rect.x, rect.x + rect.w);
  const dy = cy - clamp(cy, rect.y, rect.y + rect.h);
  return dx * dx + dy * dy < r * r;
};

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  total: number;
  size: number;
  color: string;
}

/**
 * Bursts of small squares: a coin picked up, a block broken, a landing. Make one per game
 * (const particles = new Particles()) outside onFrame, call burst() when something happens, and
 * update(dt) then draw(ctx) on every frame, after the game is drawn.
 */
export class Particles {
  private pool: Particle[] = [];
  private next = 0;
  gravity = 600;

  constructor(max = 160) {
    for (let i = 0; i < max; i++) this.pool.push({ x: 0, y: 0, vx: 0, vy: 0, life: 0, total: 1, size: 3, color: "#fff" });
  }

  burst(x: number, y: number, options: { count?: number; color?: string; speed?: number; life?: number; size?: number } = {}) {
    const count = options.count ?? 12;
    for (let i = 0; i < count; i++) {
      const p = this.pool[this.next];
      this.next = (this.next + 1) % this.pool.length;
      const angle = Math.random() * Math.PI * 2;
      const speed = (options.speed ?? 180) * (0.4 + Math.random() * 0.6);
      p.x = x;
      p.y = y;
      p.vx = Math.cos(angle) * speed;
      p.vy = Math.sin(angle) * speed;
      p.total = p.life = (options.life ?? 0.5) * (0.6 + Math.random() * 0.4);
      p.size = options.size ?? 4;
      p.color = options.color ?? "#ffffff";
    }
  }

  update(dt: number) {
    for (const p of this.pool) {
      if (p.life <= 0) continue;
      p.life -= dt;
      p.vy += this.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  draw(ctx: CanvasRenderingContext2D) {
    for (const p of this.pool) {
      if (p.life <= 0) continue;
      ctx.globalAlpha = Math.max(p.life / p.total, 0);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }
}

/**
 * A screen shake for a hit or a crash. hit() starts one; on every frame call update(dt), then
 * ctx.save(), apply(ctx), draw the game, ctx.restore(). Keep it short and small: it is a jolt.
 */
export class Shake {
  private left = 0;
  private total = 1;
  private strength = 0;

  hit(strength = 8, seconds = 0.25) {
    this.strength = strength;
    this.left = this.total = seconds;
  }

  update(dt: number) {
    if (this.left > 0) this.left = Math.max(this.left - dt, 0);
  }

  apply(ctx: CanvasRenderingContext2D) {
    if (this.left <= 0) return;
    const power = this.strength * (this.left / this.total);
    ctx.translate((Math.random() * 2 - 1) * power, (Math.random() * 2 - 1) * power);
  }
}

interface Popup {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
}

/** Words that float up and fade: "+10", "Perfect!". add() one, then update(dt) and draw(ctx) every frame. */
export class Popups {
  private items: Popup[] = [];

  add(x: number, y: number, text: string, color = "#ffffff") {
    if (this.items.length < 24) this.items.push({ x, y, text, color, life: 0.8 });
  }

  update(dt: number) {
    for (const p of this.items) {
      p.life -= dt;
      p.y -= 40 * dt;
    }
    if (this.items.length && this.items[0].life <= 0) this.items.shift();
  }

  draw(ctx: CanvasRenderingContext2D, font = "bold 18px sans-serif") {
    ctx.font = font;
    ctx.textAlign = "center";
    for (const p of this.items) {
      if (p.life <= 0) continue;
      ctx.globalAlpha = clamp(p.life / 0.4, 0, 1);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, p.x, p.y);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = "start";
  }
}
`;

const GUIDE = `2D games. The kit's files are in src/game/: use them, don't rewrite them.

Free play first. Anyone can open the game and play straight away: no wallet, no sign-in, no account. The best score is kept on the device (saveBest). A wallet is asked for only when the player chooses to post a score on the leaderboard, buy something, or pay an entry, and the page says so at that moment. Never put Play behind a wallet, and never block the game while a wallet or the leaderboard loads.

The screen
- GameCanvas (src/game/GameCanvas.tsx) is the screen. Give it onFrame({ ctx, width, height, dt, time, input }) and do everything there: update the game, then draw it. It scales a fixed game size (360 x 640 by default: a phone held upright; pass width and height for another shape) to fit any screen, so always draw in game coordinates, never in pixels of the window.
- Three screens: start, playing, game over. Pass paused={screen !== "playing"} AND onIdleFrame. While paused, onFrame isn't called; onIdleFrame is, so the start and game-over screens show the game world (the road and the parked car, the level behind the menu) instead of an empty box. onIdleFrame only draws: it may drift the background slowly with dt, but it never moves the game on, checks hits, scores or plays sounds. Write one drawWorld(ctx, g) used by both, so they can't drift apart.
- The start screen: the game's name, one line on how to play, the best score, and a big Play button (a <button> with the word Play or Start). Over the canvas or under it, but the canvas is always drawn. The game-over screen: the score, the best ("New best!" when it is), Play again, and the leaderboard if the game has one.
- Keep the game's state in a useRef object (player, enemies, score), NOT in useState: state that changes 60 times a second must not re-render React. Use useState only for which screen is showing and for a number the page shows outside the canvas, updated when it changes, not every frame.
- Multiply every speed by dt (seconds), so the game runs the same on a slow phone: x += speed * dt. Never count frames.
- Input: input.left/right/up/down are held directions (arrow keys, WASD or the on-screen buttons). input.action is held, input.actionPressed is true for one frame when it starts (jump, shoot, flap). input.pointer is the finger or mouse in game coordinates. Every game must be playable with a thumb alone: either one-tap play (the whole canvas is the button) or pass controls={["left","right","action"]} for on-screen buttons. For lanes, a tap on the left or right half of the canvas (input.pointer.x < width / 2) changes lane. Keyboard works by itself.
- The score is drawn on the canvas during play, in a panel at the top that is easy to read on any background (a dark rounded box with white text), with whatever else the game counts (distance, coins, lives). The page around the canvas may show it too.

What makes it a game
- Obstacles, challenges, power-ups and computer-controlled characters (NPCs: traffic, rivals, enemies, chasers) are the game. Build every one the plan names, each with its own look and its own behaviour, and give each a name in the code (type: "oncoming" | "slowCar" | "oil"). If the plan named none, pick at least two kinds of obstacle and one power-up that fit the game.
- The first obstacle arrives within 3 seconds of Play, after a short grace moment. A player must meet everything the game has within the first 15 seconds of a round: introduce each kind early, then mix them.
- NPCs act like someone: traffic changes lane with a blink first, a chaser speeds up when far and slows when close, a rival tries to block. Signal before acting, so a player can react, and keep it fair: never spawn something the player can't avoid.
- Power-ups: each one does something you can see (a shield ring, coins flying to you, a speed trail), lasts a few seconds with a shrinking bar in the score panel, and makes a sound when picked up and when it ends.
- Difficulty rises with time or score (speed, spawn rate, more kinds at once), with a cap so it stays playable.
- A clear way to lose, feedback on every action (a sound AND something seen), and a reason to play again (the best score, "New best!"). Hit boxes a little smaller than what is drawn.
- Feel (src/game/juice.ts): this is what separates a game from a demo, so use it. new Particles() for a burst when something is collected, broken or landed on (particles.burst(x, y, { color })). new Shake() for a jolt on a hit (shake.hit()). new Popups() for "+10" floating up. Make each ONCE outside onFrame (in the game's useRef or at module level), and on every frame: shake.update(dt); ctx.save(); shake.apply(ctx); draw the game; particles.update(dt); particles.draw(ctx); popups.update(dt); popups.draw(ctx); ctx.restore(). ease.out, ease.back and lerp are there for movement that isn't linear. Collisions: hitRect(a, b), hitCircle(...), hitCircleRect(...).
- Sound: sfx.jump(), sfx.coin(), sfx.hit(), sfx.tap(), sfx.win(), sfx.lose() from src/game/sound.ts, or tone(frequency, seconds) for your own. Offer a mute button (isMuted, setMuted).

Building blocks (src/game/): use them instead of writing your own
- world.ts: Pool (reuse cars, coins and bullets instead of making new ones each frame), Spawner (things on a timer that come faster as difficulty rises, the first after a short grace), difficulty(seconds) from 0 to 1, lanes(n, width) for lane games, pick(items, weights).
- npc.ts: computer-controlled characters on one shape, Actor (new Pool(newActor, 24), place(a, kind, x, y)): traffic (overtaken, blinks then changes lane), oncoming (rushes at you, headlights first), chaser (follows, faster when far), patrol (back and forth), shooter (warns, then fires), rival (races beside you and blocks your lane after blinking). Each sets a.warn from 0 to 1 while it gets ready: draw a blinker, flash or "!" then. hitBox(a) is a little smaller than what is drawn; offscreen(a, width, height) says when to set active = false.
- powerups.ts: new Effects(); effects.activate("shield", 5), isActive("magnet"), remaining("boost"), update(dt, onEnd). shield, magnet, slow, double, boost and life have colours ready.
- hud.ts: drawHud(ctx, width, { score, best, distance, lives, combo, effects }) is the score panel, with a shrinking bar for each running power-up. Call it last in onFrame. drawBanner(ctx, width, height, "Shield!") for a moment's message.
- haptics.ts: buzz("hit"), buzz("collect"), buzz("over") on phones that vibrate, off with mute.

GoodBuild tests the game (src/game/probe.ts). Its check opens the game, presses Play with no wallet and plays it, and these three calls tell it what happened. They do nothing for real players. Write all three:
- declareGame({ obstacles: [...], powerups: [...], npcs: [...] }) once at module level, naming every kind the game has with the same short names the code uses (the kinds the plan named: "oncoming", "oil", "nitro", "rival").
- spawned(kind) every time one of them is created.
- probe(score, player.x, player.y, speed) once per frame in onFrame while playing, with the current score, the player's position and the game's speed (what rises as it gets harder).
The check then reports, for the builder to fix: a score that never rises, no obstacle in the first 3 seconds, a declared kind that never appears in the first 15 seconds of a round, controls that don't move the player, a game that doesn't get harder, and a Play again that doesn't start a new round.

Drawing
- Draw with shapes, gradients and emoji (ctx.fillRect, ctx.arc, ctx.fillText with a big font): a game needs no image files. Clear the canvas at the start of every frame. Use the theme's mood for colours but choose them for contrast inside the game. If the user uploaded images, draw them with an Image loaded from their /assets/ path.
- Draw each thing once, as a function: drawCar(ctx, x, y, w, h, colour). Use it in the game, and outside the game with <Sprite draw={(ctx, w, h) => drawCar(ctx, 0, 0, w, h, colour)} width={96} height={128} /> from src/game/Sprite.tsx: garage cards, the store, the start screen, leaderboard rows. Never redraw the same thing a second way in SVG or CSS. A thing shown in a card is at least 64px, big enough to recognise.
- Performance on a cheap phone: no new objects or arrays inside onFrame where you can reuse them, at most a few hundred things on screen, remove what leaves the screen, no shadows or filters on many shapes.

Page layout
- The game is the page. A compact top row (name, best score, mute; a wallet button only if the game sells something), the canvas centred, controls under it.

Leaderboard (when the plan asks for one; the owner decided that posting a score needs a wallet)
- Use the kit, never your own: const board = useLeaderboard() from src/game/leaderboard.ts, <Leaderboard board={board} icon={(e) => ...} /> and, on the game-over screen, <PostScore board={board} score={score} extra={carId} /> from src/game/Leaderboard.tsx. The board loads for everyone without a wallet; PostScore asks for the wallet only when they tap Post, and explains it first.
- Add this rule to src/lib/dataRules.json under "collections", exactly: "scores": {"create": "signed-in", "read": ["anyone"], "fields": {"name": "string", "score": "number", "extra": "string"}}. Each wallet keeps one best score; the board shows the top 10 with "(you)" on the player's row.
- In a game that works in MiniPay, MiniPay allows no sign-in signature, so the MiniPay leaderboard contract kit is on as well: follow its guide (pass chain: to useLeaderboard). Don't remove the leaderboard for MiniPay players.
- Show the top 3 on the start screen as well when there's room. Scores come from players' own devices: Leaderboard says so already.

Money in a game (only when the user asks for entry fees, prizes or things to buy):
- A paid tournament is allowed: players pay a G$ entry, the pot goes to the winner or the top few. Write a contract in contracts/ following the contract rules: entries with transferAndCall, a deadline, a refund to every player if nothing is settled within a set time after the deadline, and custom errors.
- A score comes from the player's own device, so a contract can't trust it. Don't write a contract that pays whoever submits the biggest number. Use an organiser who settles: the contract's owner calls a function naming the winners after the deadline, and the page says plainly that the organiser confirms the results. For a turn-based game with simple rules (noughts and crosses, a guessing duel between two players who both commit), the contract can run the rules itself instead.
- The winner must be decided by play. Never build a game for money where chance alone picks the winner (a lottery, a dice roll, a slot machine, a random draw among payers): refuse that and offer a skill game or a free draw instead.
- Things to buy (cars, skins, level ups, extra lives, a season pass): an ERC-1155 or a simple purchases mapping paid in G$, read by the game to unlock them. Keep the game fair and fun without paying: the starter items are free, and anything bought is shown with Sprite exactly as the game draws it.
- Several people playing together (a room, taking turns, a lobby): load the multiplayer guide. There is no live connection, so it suits turn-based and lobby games, not fast action games.

Before you finish, check: the canvas draws on the start screen (onIdleFrame), Play works with no wallet, the first obstacle comes within 3 seconds, every obstacle, power-up and NPC the plan named is in the game and in declareGame, spawned and probe are called, the score shows on the canvas while playing (drawHud), game over shows Play again, and the leaderboard rule is in dataRules.json if there is a board.`;

/** The leaderboard's data rule, as the guide writes it (D92). */
export const SCORES_RULE_JSON = '"scores": {"create": "signed-in", "read": ["anyone"], "fields": {"name": "string", "score": "number", "extra": "string"}}';

/** Each opening tag of a component, props and all: a ">" inside {...} (an arrow function) doesn't end it. */
export function jsxTags(content: string, name: string): { at: number; text: string }[] {
  const tags: { at: number; text: string }[] = [];
  const re = new RegExp("<" + name + "\\b", "g");
  for (const m of content.matchAll(re)) {
    let depth = 0;
    let quote = "";
    let i = m.index + m[0].length;
    for (; i < content.length; i++) {
      const ch = content[i];
      if (quote) {
        if (ch === quote && content[i - 1] !== "\\") quote = "";
      } else if (ch === '"' || ch === "'" || ch === "`") quote = ch;
      else if (ch === "{") depth++;
      else if (ch === "}") depth--;
      else if (ch === ">" && depth === 0) break;
    }
    tags.push({ at: m.index, text: content.slice(m.index, i + 1) });
  }
  return tags;
}

const lineOf = (content: string, re: RegExp) => content.slice(0, Math.max(0, content.search(re))).split("\n").length;

/**
 * What the game guide asks for that the files can show (D92): the start screen is drawn, and a
 * leaderboard has the rule it needs and, in a MiniPay game, the contract passed to it.
 */
export function gameChecks(files: Record<string, string>): CheckIssue[] {
  const issues: CheckIssue[] = [];
  const own = Object.entries(files).filter(([f]) => /^src\/.*\.(tsx|jsx)$/.test(f) && !f.startsWith("src/game/") && !f.startsWith("src/lib/"));
  for (const [file, content] of own) {
    // Each <GameCanvas ...> tag that is paused but has nothing to draw while paused.
    for (const tag of jsxTags(content, "GameCanvas")) {
      if (/\bpaused\s*=/.test(tag.text) && !/\bonIdleFrame\s*=/.test(tag.text)) {
        issues.push({
          file,
          line: content.slice(0, tag.at).split("\n").length,
          source: "guardrail",
          message: "GameCanvas is paused on the start and game-over screens but has no onIdleFrame, so those screens show an empty box. Pass onIdleFrame={({ ctx, width, height }) => drawWorld(ctx, ...)} that draws the game world (no movement, hits or sounds).",
        });
      }
    }
  }
  // The game reports to GoodBuild's check (D93): without the probe it can only be looked at, not tested.
  const canvas = own.find(([, c]) => /<GameCanvas\b/.test(c));
  if (canvas) {
    const all = own.map(([, c]) => c).join("\n");
    const missing = [/\bdeclareGame\s*\(/.test(all) ? "" : "declareGame({ obstacles, powerups, npcs }) once at module level", /\bspawned\s*\(/.test(all) ? "" : "spawned(kind) whenever an obstacle, power-up or character is created", /\bprobe\s*\(/.test(all) ? "" : "probe(score, player.x, player.y, speed) once per frame in onFrame"].filter(Boolean);
    if (missing.length) {
      issues.push({
        file: canvas[0],
        line: lineOf(canvas[1], /<GameCanvas\b/),
        source: "paths",
        message: `GoodBuild can't test this game yet. Add, from src/game/probe.ts: ${missing.join("; ")}. They do nothing for real players.`,
      });
    }
  }
  const usesBoard = own.find(([, c]) => /\buseLeaderboard\s*\(/.test(c));
  if (usesBoard) {
    const [file, content] = usesBoard;
    const name = /useLeaderboard\(\s*\{[^}]*\bcollection\s*:\s*["']([a-z][a-z0-9_-]*)["']/.exec(content)?.[1] ?? "scores";
    let rule: unknown;
    try {
      rule = (JSON.parse(files["src/lib/dataRules.json"] ?? "{}") as { collections?: Record<string, unknown> }).collections?.[name];
    } catch {
      rule = undefined;
    }
    const r = (typeof rule === "object" && rule ? rule : {}) as { create?: unknown; read?: unknown };
    const readsAnyone = rule === "public-read" || (Array.isArray(r.read) && r.read.includes("anyone"));
    const signedIn = rule === "public-read" || r.create === undefined || r.create === "signed-in";
    if (!rule || !readsAnyone || !signedIn) {
      issues.push({
        file: "src/lib/dataRules.json",
        source: "paths",
        message: `The leaderboard in ${file} needs its rule in src/lib/dataRules.json under "collections": ${name === "scores" ? SCORES_RULE_JSON : SCORES_RULE_JSON.replace('"scores"', `"${name}"`)}. Everyone reads the board; posting needs a wallet.`,
      });
    }
    if (files["contracts/GameBoard.sol"] !== undefined && !own.some(([, c]) => /\bgameBoard\s*\(/.test(c) && /\bchain\s*:/.test(c))) {
      issues.push({
        file,
        line: lineOf(content, /\buseLeaderboard\s*\(/),
        source: "paths",
        message: 'MiniPay players can\'t post to the leaderboard: make const miniPayBoard = gameBoard(GameBoardAbi, GameBoardAddress[chain.id]) once at module level (gameBoard from src/game/chainBoard.ts, GameBoardAbi and GameBoardAddress from the contracts folder, chain from src/lib/chain.ts) and pass useLeaderboard({ chain: miniPayBoard }).',
      });
    }
  }
  return issues;
}

export const game2d: Kit = {
  id: "game-2d",
  title: "2D games",
  when: "a game of any kind: arcade, platformer, puzzle, runner, clicker, quiz or card game, with or without a leaderboard, entry fee or prizes",
  keywords:
    /\b(arcade|platformer|flappy|tetris|pong|breakout|space invaders|endless runner|clicker game|snake game|puzzle game|quiz game|card game|memory game|mini[- ]?games?|video games?|2d games?|browser games?|playable|(?:build|make|create|want)(?: me| us)? an? (?:\w+ ){0,3}game|a game (?:where|about|like|with|in which|for)|games? (?:with|where) (?:a )?(?:leaderboard|high ?scores?|levels|prizes|entry))\b/i,
  packages: {},
  files: {
    "src/game/GameCanvas.tsx": GAME_CANVAS,
    "src/game/sound.ts": SOUND,
    "src/game/storage.ts": STORAGE,
    "src/game/juice.ts": JUICE,
    "src/game/Sprite.tsx": SPRITE,
    "src/game/leaderboard.ts": LEADERBOARD_TS,
    "src/game/Leaderboard.tsx": LEADERBOARD_TSX,
    "src/game/probe.ts": PROBE,
    "src/game/world.ts": WORLD,
    "src/game/npc.ts": NPC,
    "src/game/powerups.ts": POWERUPS,
    "src/game/hud.ts": HUD,
    "src/game/haptics.ts": HAPTICS,
  },
  // The first GameCanvas (D72): Enter and Space couldn't press Play, and a key held through a lost focus stuck (D85).
  // ...and the second never drew while paused, so every start screen was an empty box (D92).
  superseded: { "src/game/GameCanvas.tsx": ["b8d7fc83dc5ae09f096f37446f8ba12273a2b502aba2acb827f4a8c541901c08", "f5a2cd6e74f9d834f917de93c6b5ff39dc8accc07f44f2d956eddab47798563c"],
    // Its comment pointed at useCollection for leaderboards (D92).
    "src/game/storage.ts": ["ad445565329f58a977216f4ed062c26609a13e2afd9e14a96e7b114e6eae65fa"],
  },
  guide: GUIDE,
  replaces: ["phaser", "kaplay", "kaboom", "pixi.js", "matter-js", "howler"],
  checks: gameChecks,
};
