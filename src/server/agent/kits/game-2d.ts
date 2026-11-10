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
 * The loop stops while paused is true or the tab is hidden, and starts again by itself.
 */
export function GameCanvas({
  width = 360,
  height = 640,
  paused = false,
  onFrame,
  controls = [],
  label = "Game",
  className,
  style,
}: {
  width?: number;
  height?: number;
  paused?: boolean;
  onFrame: (frame: Frame) => void;
  /** On-screen buttons for phones. Leave empty when a tap anywhere is the only control. */
  controls?: ControlButton[];
  /** What a screen reader calls the game. */
  label?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef(onFrame);
  const pausedRef = useRef(paused);
  const input = useRef<GameInput>({ left: false, right: false, up: false, down: false, action: false, actionPressed: false, pointer: { x: 0, y: 0, down: false } });
  const held = useRef({ key: false, pointer: false, button: false });

  useEffect(() => {
    frameRef.current = onFrame;
    pausedRef.current = paused;
  }, [onFrame, paused]);

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
      // Don't take keys from a form field elsewhere on the page.
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
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

    let raf = 0;
    let last = 0;
    let time = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      // A long gap (a hidden tab, a slow frame) must not make everything jump.
      const dt = Math.min((now - (last || now)) / 1000, 1 / 30);
      last = now;
      if (pausedRef.current || document.hidden) return;
      time += dt;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      frameRef.current({ ctx, width, height, dt, time, input: state });
      state.actionPressed = false;
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

  return (
    <div className={className} style={{ width: "100%", maxWidth: width, marginInline: "auto", ...style }}>
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

const STORAGE = `// The player's best score, kept in their browser. For a leaderboard other people can see, save
// scores with useCollection (src/lib/useDb.ts) as the game guide describes.

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

const GUIDE = `2D games. The kit's files are in src/game/: use them, don't rewrite them.
- GameCanvas (src/game/GameCanvas.tsx) is the screen. Give it onFrame({ ctx, width, height, dt, time, input }) and do everything there: update the game, then draw it. It scales a fixed game size (360 x 640 by default: a phone held upright; pass width and height for another shape) to fit any screen, so always draw in game coordinates, never in pixels of the window.
- Keep the game's state in a useRef object (player, enemies, score), NOT in useState: state that changes 60 times a second must not re-render React. Use useState only for which screen is showing ("start" | "playing" | "over") and for a number the page shows outside the canvas, updated when it changes, not every frame.
- Multiply every speed by dt (seconds), so the game runs the same on a slow phone: x += speed * dt. Never count frames.
- Input: input.left/right/up/down are held directions (arrow keys, WASD or the on-screen buttons). input.action is held, input.actionPressed is true for one frame when it starts (jump, shoot, flap, start). input.pointer is the finger or mouse in game coordinates. Every game must be playable with a thumb alone: either one-tap play (the whole canvas is the button) or pass controls={["left","right","action"]} to GameCanvas for on-screen buttons. Keyboard works by itself.
- Three screens: a start screen that says how to play in one line and has a Play button, the game, and a game-over screen with the score, the best score and Play again. Pause is automatic when the tab is hidden; pass paused while a screen other than the game is up.
- Draw with shapes, gradients and emoji (ctx.fillRect, ctx.arc, ctx.fillText with a big font): a game needs no image files. Clear the canvas at the start of every frame. Use the theme's mood for colours but choose them for contrast inside the game. If the user uploaded images, draw them with an Image loaded from their /assets/ path.
- Sound: sfx.jump(), sfx.coin(), sfx.hit(), sfx.tap(), sfx.win(), sfx.lose() from src/game/sound.ts, or tone(frequency, seconds) for your own. Offer a mute button (isMuted, setMuted).
- Score: bestScore() and saveBest(score) from src/game/storage.ts keep the best in the browser.
- Make it a game, not a demo: difficulty that rises (speed, spawn rate) with the score, a clear way to lose, feedback on every action (a sound, a flash, a number that pops), and a reason to play again (best score). Keep collision simple: rectangles or circles.
- Performance on a cheap phone: no new objects or arrays inside onFrame where you can reuse them, at most a few hundred things on screen, remove what leaves the screen, no shadows or filters on many shapes.
- Page layout: the game is the page. A compact top row (name, score, mute, ConnectButton only if the game uses a wallet), the canvas centred, controls under it. The game must be playable WITHOUT a wallet; ask for one only when the player saves a score on a leaderboard, pays an entry or claims a prize.

A leaderboard other people can see (no contract needed): save each finished game with useCollection("scores") from src/lib/useDb.ts (load the app-data guide) and show the top 10. Say on the page that scores are reported by players' own devices.

Money in a game (only when the user asks for entry fees, prizes or things to buy):
- A paid tournament is allowed: players pay a G$ entry, the pot goes to the winner or the top few. Write a contract in contracts/ following the contract rules: entries with transferAndCall, a deadline, a refund to every player if nothing is settled within a set time after the deadline, and custom errors.
- A score comes from the player's own device, so a contract can't trust it. Don't write a contract that pays whoever submits the biggest number. Use an organiser who settles: the contract's owner calls a function naming the winners after the deadline, and the page says plainly that the organiser confirms the results. For a turn-based game with simple rules (noughts and crosses, a guessing duel between two players who both commit), the contract can run the rules itself instead.
- The winner must be decided by play. Never build a game for money where chance alone picks the winner (a lottery, a dice roll, a slot machine, a random draw among payers): refuse that and offer a skill game or a free draw instead.
- Things to buy (skins, extra lives, a pass): an ERC-1155 or a simple purchases mapping paid in G$, read by the game to unlock them. Keep the game fair to play without paying.
- Several people playing together (a room, taking turns, a shared leaderboard that updates): load the multiplayer guide. There is no live connection, so it suits turn-based and lobby games, not fast action games.`;

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
  },
  guide: GUIDE,
};
