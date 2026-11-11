// @vitest-environment node
import { chromium } from "playwright-core";
import { afterAll, describe, expect, it } from "vitest";

import { buildPublishedApp } from "@/server/publish/build";

import { checkApp } from "../checks";
import { closeRunCheckBrowser, runCheck } from "../run-check";
import { starterFiles } from "../template";
import { typeCheck } from "../type-check";
import { detectKits, kitById, kitIdsOf, withKit } from "./index";
import { SCORES_RULE_JSON, game2d, gameChecks, jsxTags } from "./game-2d";

const hasBrowser =
  Boolean(process.env.CI) ||
  (await chromium
    .launch({ headless: true })
    .then((b) => b.close().then(() => true))
    .catch(() => false));

/** A small game written the way the guide asks: state in a ref, three screens, dt, one-tap play. */
const GAME = `import { useRef, useState } from "react";
import { GameCanvas, type Frame } from "./game/GameCanvas";
import { declareGame, probe, spawned } from "./game/probe";
import { sfx } from "./game/sound";
import { bestScore, saveBest } from "./game/storage";

type Screen = "start" | "playing" | "over";

declareGame({ obstacles: ["pipe"] });

export default function App() {
  const [screen, setScreen] = useState<Screen>("start");
  const [score, setScore] = useState(0);
  const game = useRef({ y: 320, vy: 0, pipes: [] as { x: number; gap: number; passed: boolean }[], spawn: 0, score: 0, t: 0 });

  const start = () => {
    game.current = { y: 320, vy: 0, pipes: [], spawn: 0, score: 0, t: 0 };
    setScore(0);
    setScreen("playing");
  };

  const onFrame = ({ ctx, width, height, dt, input }: Frame) => {
    const g = game.current;
    if (input.actionPressed) {
      g.vy = -320;
      sfx.jump();
    }
    g.t += dt;
    const speed = 140 + g.t * 4;
    g.vy += 900 * dt;
    g.y += g.vy * dt;
    g.spawn -= dt;
    if (g.spawn <= 0) {
      g.pipes.push({ x: width + 40, gap: 180 + Math.random() * 280, passed: false });
      spawned("pipe");
      g.spawn = 1.5;
    }
    for (const p of g.pipes) {
      p.x -= speed * dt;
      if (!p.passed && p.x < 60) {
        p.passed = true;
        g.score += 1;
        setScore(g.score);
        sfx.coin();
      }
    }
    g.pipes = g.pipes.filter((p) => p.x > -60);
    // A point a second for staying up, plus one for each pipe passed.
    probe(g.score + Math.floor(g.t), 44, g.y, speed);
    if (g.y > height + 400 || g.y < -400) {
      saveBest(g.score, "flappy");
      sfx.lose();
      setScreen("over");
    }
    ctx.fillStyle = "#7dd3fc";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#16a34a";
    for (const p of g.pipes) {
      ctx.fillRect(p.x, 0, 50, p.gap - 80);
      ctx.fillRect(p.x, p.gap + 80, 50, height);
    }
    ctx.font = "36px sans-serif";
    ctx.fillText("🐤", 44, g.y);
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-4 p-4">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Campus Flap</h1>
        <p className="tabular-nums">Score {score}</p>
      </header>
      {screen === "playing" ? (
        <GameCanvas onFrame={onFrame} label="Campus Flap game" />
      ) : (
        <section className="rounded-lg bg-card p-6 text-center">
          <p>{screen === "over" ? "Game over. Best: " + bestScore("flappy") : "Tap to flap and fly through the gaps."}</p>
          <button type="button" onClick={start} className="mt-4 rounded-lg bg-primary px-6 py-3 text-primary-foreground">
            {screen === "over" ? "Play again" : "Play"}
          </button>
        </section>
      )}
    </main>
  );
}
`;

/** A game that keeps GameCanvas on the page and pauses it between rounds, with the feel helpers. */
const PAUSED_GAME = `import { useRef, useState } from "react";
import { GameCanvas, type Frame } from "./game/GameCanvas";
import { Particles, Popups, Shake, clamp, ease, hitRect } from "./game/juice";
import { declareGame, probe, spawned } from "./game/probe";

declareGame({ obstacles: ["block"] });

const particles = new Particles();
const shake = new Shake();
const popups = new Popups();

export default function App() {
  const [playing, setPlaying] = useState(false);
  const game = useRef({ x: 180, jumps: 0, frames: 0 });
  const out = useRef<HTMLParagraphElement>(null);

  const onFrame = ({ ctx, width, height, dt, input }: Frame) => {
    const g = game.current;
    g.frames += 1;
    if (input.right) g.x = clamp(g.x + 120 * dt, 0, width);
    if (g.frames === 1) spawned("block");
    probe(g.jumps, g.x, 300, 120);
    if (input.actionPressed) {
      g.jumps += 1;
      particles.burst(g.x, 300, { color: "#facc15" });
      shake.hit();
      popups.add(g.x, 280, "+1");
    }
    shake.update(dt);
    ctx.save();
    shake.apply(ctx);
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#38bdf8";
    ctx.fillRect(g.x - 15, 300 - 30 * ease.out(0.5), 30, 30);
    particles.update(dt);
    particles.draw(ctx);
    popups.update(dt);
    popups.draw(ctx);
    ctx.restore();
    void hitRect({ x: 0, y: 0, w: 1, h: 1 }, { x: 2, y: 2, w: 1, h: 1 });
    if (out.current) out.current.textContent = JSON.stringify({ right: input.right, jumps: g.jumps, frames: g.frames });
  };

  return (
    <main className="mx-auto max-w-md p-4">
      <p id="state" ref={out}>{"{}"}</p>
      {!playing && (
        <button id="play" type="button" onClick={() => setPlaying(true)}>
          Play
        </button>
      )}
      <GameCanvas
        onFrame={onFrame}
        onIdleFrame={({ ctx, width, height }) => {
          ctx.fillStyle = "#0f172a";
          ctx.fillRect(0, 0, width, height);
          ctx.fillStyle = "#38bdf8";
          ctx.fillRect(game.current.x - 15, 285, 30, 30);
        }}
        paused={!playing}
        controls={["left", "right", "action"]}
        label="Test game"
      />
    </main>
  );
}
`;

/** A racer built from the kit's blocks (D94): pools, a spawner, traffic, oncoming cars, a rival, power-ups, the HUD. */
const BLOCKS_GAME = `import { useRef, useState } from "react";
import { GameCanvas, type Frame } from "./game/GameCanvas";
import { buzz } from "./game/haptics";
import { drawHud } from "./game/hud";
import { Pool, Spawner, difficulty, lanes, pick } from "./game/world";
import { hitBox, newActor, offscreen, oncoming, place, rival, traffic } from "./game/npc";
import { Effects } from "./game/powerups";
import { hitRect } from "./game/juice";
import { declareGame, probe, spawned } from "./game/probe";

declareGame({ obstacles: ["slowCar", "oncoming"], powerups: ["shield"], npcs: ["rival"] });

const LANES = lanes(3, 360, 40);
const cars = new Pool(newActor, 24);
const pickups = new Pool(newActor, 8);
const spawner = new Spawner({ every: 1.2, fastest: 0.5, grace: 0.8 });
const powerSpawner = new Spawner({ every: 3, fastest: 2, grace: 2 });
const effects = new Effects();
const KINDS = ["slowCar", "oncoming", "rival"];

export default function App() {
  const [screen, setScreen] = useState<"start" | "playing" | "over">("start");
  const game = useRef({ lane: 1, t: 0, score: 0, spawns: 0 });

  const drawWorld = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
    ctx.fillStyle = "#111827";
    ctx.fillRect(0, 0, width, height);
    cars.each((c) => {
      ctx.fillStyle = c.kind === "rival" ? "#a855f7" : c.kind === "oncoming" ? "#f43f5e" : "#f97316";
      ctx.fillRect(c.x - c.w / 2, c.y - c.h / 2, c.w, c.h);
      if (c.warn > 0) ctx.fillRect(c.x + c.w / 2, c.y, 6, 6);
    });
    pickups.each((p) => {
      ctx.fillStyle = "#38bdf8";
      ctx.beginPath();
      ctx.arc(p.x, p.y, 14, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.fillStyle = effects.isActive("shield") ? "#38bdf8" : "#e11d48";
    ctx.fillRect(LANES[game.current.lane] - 22, 520, 44, 76);
  };

  const onFrame = ({ ctx, width, height, dt, input }: Frame) => {
    const g = game.current;
    g.t += dt;
    const level = difficulty(g.t, 60);
    const speed = 240 + level * 260;
    if (input.actionPressed) g.lane = input.pointer.x < width / 2 ? Math.max(0, g.lane - 1) : Math.min(2, g.lane + 1);
    if (spawner.tick(dt, level)) {
      const car = cars.get();
      if (car) {
        // Every kind in turn, so a short round meets them all.
        const kind = KINDS[g.spawns++ % KINDS.length];
        place(car, kind, LANES[Math.floor(Math.random() * 3)], -60, 40, 70);
        car.lane = LANES.indexOf(car.x);
        spawned(kind);
      }
    }
    if (powerSpawner.tick(dt, level)) {
      const p = pickups.get();
      if (p) {
        place(p, "shield", pick(LANES), -30, 28, 28);
        spawned("shield");
      }
    }
    const me = { x: LANES[g.lane] - 18, y: 524, w: 36, h: 68 };
    cars.each((c) => {
      if (c.kind === "oncoming") oncoming(c, dt, { speed: speed * 1.6 });
      else if (c.kind === "rival") rival(c, dt, { lane: g.lane }, { laneXs: LANES, drift: speed * 0.4 });
      else traffic(c, dt, { speed: speed * 0.7, laneXs: LANES });
      if (offscreen(c, width, height)) c.active = false;
      else if (hitRect(hitBox(c), me)) {
        if (effects.isActive("shield")) {
          effects.end("shield");
          c.active = false;
        } else {
          buzz("over");
          setScreen("over");
        }
      }
    });
    pickups.each((p) => {
      p.y += speed * dt;
      if (offscreen(p, width, height)) p.active = false;
      else if (hitRect(hitBox(p), me)) {
        p.active = false;
        effects.activate("shield", 4);
        buzz("collect");
      }
    });
    effects.update(dt);
    g.score += speed * dt * 0.05;
    probe(Math.floor(g.score), LANES[g.lane], 520, speed);
    drawWorld(ctx, width, height);
    drawHud(ctx, width, { score: g.score, distance: g.t * 10, effects });
  };

  const start = () => {
    game.current = { lane: 1, t: 0, score: 0, spawns: 0 };
    cars.clear();
    pickups.clear();
    effects.clear();
    spawner.reset();
    powerSpawner.reset();
    setScreen("playing");
  };

  return (
    <main className="mx-auto max-w-md space-y-3 p-4">
      <GameCanvas onFrame={onFrame} onIdleFrame={({ ctx, width, height }) => drawWorld(ctx, width, height)} paused={screen !== "playing"} label="Block Racer" />
      {screen !== "playing" && (
        <button type="button" onClick={start} className="rounded-lg bg-primary px-6 py-3 text-primary-foreground">
          {screen === "over" ? "Play again" : "Play"}
        </button>
      )}
    </main>
  );
}
`;

/** A game that runs but does nothing a game should (D94): no obstacles, no score, no control, never harder. */
const STUCK_GAME = `import { useState } from "react";
import { GameCanvas, type Frame } from "./game/GameCanvas";
import { declareGame, probe } from "./game/probe";

declareGame({ obstacles: ["rock"], powerups: ["star"] });

export default function App() {
  const [playing, setPlaying] = useState(false);
  const draw = ({ ctx, width, height }: Frame) => {
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#facc15";
    ctx.fillRect(160, 300, 40, 40);
  };
  const onFrame = (frame: Frame) => {
    probe(0, 180, 320, 100);
    draw(frame);
  };
  return (
    <main className="p-4">
      <GameCanvas onFrame={onFrame} onIdleFrame={draw} paused={!playing} label="Stuck" />
      {!playing && (
        <button type="button" onClick={() => setPlaying(true)}>
          Play
        </button>
      )}
    </main>
  );
}
`;

const project = (app: string) => ({ ...withKit(starterFiles(), game2d), "src/App.tsx": app });

/** The board's rule in dataRules.json, as the guide writes it, or another rule to test the check. */
const withScoresRule = (files: Record<string, string>, rule: unknown = JSON.parse("{" + SCORES_RULE_JSON + "}").scores) => {
  const rules = JSON.parse(files["src/lib/dataRules.json"] ?? "{}") as { collections?: Record<string, unknown> };
  return { ...files, "src/lib/dataRules.json": JSON.stringify({ ...rules, collections: { ...(rules.collections ?? {}), scores: rule } }, null, 2) };
};

/**
 * A lane racer written the way the D93 guide asks: the canvas drawn on every screen, free play,
 * one drawing shared with a Sprite, and the leaderboard from the kit.
 */
const BOARD_GAME = `import { useRef, useState } from "react";
import { GameCanvas, type Frame } from "./game/GameCanvas";
import { Leaderboard, PostScore } from "./game/Leaderboard";
import { useLeaderboard } from "./game/leaderboard";
import { declareGame, probe, spawned } from "./game/probe";
import { Sprite } from "./game/Sprite";
import { saveBest } from "./game/storage";

declareGame({ obstacles: ["slowCar"] });

function drawCar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, colour: string) {
  ctx.fillStyle = colour;
  ctx.fillRect(x + w * 0.15, y, w * 0.7, h);
  ctx.fillStyle = "#111827";
  ctx.fillRect(x + w * 0.25, y + h * 0.2, w * 0.5, h * 0.2);
}

const LANES = [90, 180, 270];

export default function App() {
  const [screen, setScreen] = useState<"start" | "playing" | "over">("start");
  const [score, setScore] = useState(0);
  const board = useLeaderboard();
  const game = useRef({ lane: 1, cars: [] as { lane: number; y: number }[], spawn: 0.8, distance: 0 });

  const drawWorld = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
    const g = game.current;
    ctx.fillStyle = "#1f2937";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#f9fafb";
    for (const x of [135, 225]) for (let y = (g.distance * 2) % 80; y < height; y += 80) ctx.fillRect(x - 2, y, 4, 40);
    for (const c of g.cars) drawCar(ctx, LANES[c.lane] - 25, c.y, 50, 80, "#f97316");
    drawCar(ctx, LANES[g.lane] - 25, 520, 50, 80, "#e11d48");
  };

  const onIdleFrame = ({ ctx, width, height }: Frame) => drawWorld(ctx, width, height);

  const onFrame = ({ ctx, width, height, dt, input }: Frame) => {
    const g = game.current;
    if (input.actionPressed) g.lane = input.pointer.x < width / 2 ? Math.max(0, g.lane - 1) : Math.min(2, g.lane + 1);
    g.distance += 300 * dt;
    g.spawn -= dt;
    if (g.spawn <= 0) {
      g.cars.push({ lane: Math.floor(Math.random() * 3), y: -80 });
      spawned("slowCar");
      g.spawn = 1.2;
    }
    const speed = 260 + g.distance / 40;
    for (const c of g.cars) c.y += speed * dt;
    probe(Math.floor(g.distance / 10), LANES[g.lane], 520, speed);
    g.cars = g.cars.filter((c) => c.y < height);
    if (g.cars.some((c) => c.lane === g.lane && c.y > 450 && c.y < 590)) {
      saveBest(Math.floor(g.distance / 10), "racer");
      setScore(Math.floor(g.distance / 10));
      setScreen("over");
    }
    drawWorld(ctx, width, height);
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(12, 12, 120, 36);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 18px sans-serif";
    ctx.fillText(String(Math.floor(g.distance / 10)), 24, 37);
  };

  const start = () => {
    game.current = { lane: 1, cars: [], spawn: 0.8, distance: 0 };
    setScreen("playing");
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-4 p-4">
      <header className="flex items-center gap-2">
        <Sprite draw={(ctx, w, h) => drawCar(ctx, 0, 0, w, h, "#e11d48")} width={32} height={48} label="Your car" />
        <h1 className="text-xl font-semibold">Lane Dash</h1>
      </header>
      <GameCanvas onFrame={onFrame} onIdleFrame={onIdleFrame} paused={screen !== "playing"} label="Lane Dash" />
      {screen !== "playing" && (
        <section className="space-y-3 rounded-lg bg-card p-4 text-center">
          <p>{screen === "over" ? "You crashed. Score " + score : "Tap left or right of the road to change lane."}</p>
          <button id="play" type="button" onClick={start} className="rounded-lg bg-primary px-6 py-3 text-primary-foreground">
            Play
          </button>
          {screen === "over" && <PostScore board={board} score={score} extra="red" />}
        </section>
      )}
      <Leaderboard board={board} title="Top racers" icon={() => <Sprite draw={(ctx, w, h) => drawCar(ctx, 0, 0, w, h, "#e11d48")} width={16} height={24} />} />
    </main>
  );
}
`;

describe("the 2D games kit", { timeout: 120_000 }, () => {
  afterAll(() => closeRunCheckBrowser());

  it("is picked for requests that are games, and not for ones that only mention the word", () => {
    const wants = (request: string) => detectKits(request, starterFiles()).includes(game2d);
    for (const yes of ["Build me a flappy bird game with a leaderboard", "A snake game for my class", "Make a game where you catch falling mangoes", "A quiz game about Lagos with G$ prizes", "an endless runner", "I want a simple puzzle game", "A memory game for kids"]) expect(wants(yes), yes).toBe(true);
    for (const no of ["A tip jar for our football club", "Tickets for the game on Saturday", "A page for our game night with an RSVP form", "Class voting", "A landing page for my coffee kiosk"]) expect(wants(no), no).toBe(false);
  });

  it("adds no packages, so a game costs nothing extra to download", () => {
    expect(game2d.packages).toEqual({});
    expect(kitIdsOf(project(GAME))).toEqual(["game-2d"]);
  });

  it("has starter files that pass the app check and the type check, with a game written the way the guide asks", async () => {
    const files = project(GAME);
    expect(checkApp(files).errors).toEqual([]);
    const types = await typeCheck(files);
    expect(types.ran).toBe(true);
    expect(types.issues).toEqual([]);
  });

  it.skipIf(!hasBrowser)("runs in a real browser: the run check presses Play, plays, and finds the game drawing", async () => {
    const r = await runCheck(project(GAME));
    expect(r.ran).toBe(true);
    expect(r.issues).toEqual([]);
  });

  it.skipIf(!hasBrowser)("catches a game that crashes once play starts, which loading the page alone would miss", async () => {
    const broken = GAME.replace("g.vy += 900 * dt;", "g.vy += 900 * dt;\n    (g as unknown as { enemies: number[] }).enemies.push(1);");
    const r = await runCheck(project(broken));
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0].message).toMatch(/crashed when it ran.*push/);
  });

  it("type-checks a game that pauses GameCanvas and uses the feel helpers", async () => {
    const files = project(PAUSED_GAME);
    expect(Object.keys(files)).toContain("src/game/juice.ts");
    expect(checkApp(files).errors).toEqual([]);
    const types = await typeCheck(files);
    expect(types.ran).toBe(true);
    expect(types.issues).toEqual([]);
  });

  it.skipIf(!hasBrowser)("lets the keyboard press Play, starts a round with nothing held, lets go of keys when focus is lost, and fits a short screen", async () => {
    const built = await buildPublishedApp({ files: project(PAUSED_GAME), assets: [], title: "Game", hasUndeployedContracts: false, forCheck: true });
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({ viewport: { width: 800, height: 420 } });
      const byPath = new Map(built.map((f) => [f.path, f]));
      await context.route("**/*", (route) => {
        const url = new URL(route.request().url());
        const file = byPath.get(url.pathname.replace(/^\//, "") || "index.html");
        return file && url.host === "app.test" ? route.fulfill({ status: 200, contentType: file.mime, body: Buffer.from(file.bytes) }) : route.abort();
      });
      const page = await context.newPage();
      await page.goto("http://app.test/");
      const state = async () => JSON.parse(await page.locator("#state").innerText()) as { right?: boolean; jumps?: number; frames?: number };
      // Paused: the loop isn't running, and Enter on the focused button is the page's, so it presses Play.
      await page.waitForTimeout(200);
      expect(await state()).toEqual({});
      await page.locator("#play").focus();
      await page.keyboard.press("Enter");
      await page.waitForFunction(() => document.getElementById("state")?.textContent?.includes("frames"));
      await page.waitForTimeout(150);
      // The key that pressed Play didn't become a jump.
      expect((await state()).jumps).toBe(0);
      // A key held when the window loses focus is let go.
      await page.keyboard.down("ArrowRight");
      await page.waitForTimeout(120);
      expect((await state()).right).toBe(true);
      await page.evaluate(() => window.dispatchEvent(new Event("blur")));
      await page.waitForTimeout(120);
      expect((await state()).right).toBe(false);
      await page.keyboard.up("ArrowRight");
      // Space is the game's while it runs.
      await page.keyboard.press("Space");
      await page.waitForTimeout(120);
      expect((await state()).jumps).toBe(1);
      // 420px tall: the whole canvas is on screen, not 640px of it.
      const box = await page.locator("canvas").boundingBox();
      expect(box!.height).toBeLessThan(420);
      expect(box!.width / box!.height).toBeCloseTo(360 / 640, 1);
    } finally {
      await browser.close();
    }
  });

  it("gives a project that still has the first GameCanvas today's, and never touches one that was changed", () => {
    const mine = "// my own canvas\n";
    expect(withKit({ ...project(GAME), "src/game/GameCanvas.tsx": mine }, game2d)["src/game/GameCanvas.tsx"]).toBe(mine);
    // The first (D72) and the one that never drew while paused (D93).
    expect(game2d.superseded?.["src/game/GameCanvas.tsx"]).toHaveLength(2);
  });

  it.skipIf(!hasBrowser)("catches a game that never draws", async () => {
    const blank = GAME.replace(/    ctx\.fillStyle = "#7dd3fc";[\s\S]*?ctx\.fillText\("🐤", 44, g\.y\);\n/, "    void ctx;\n    void width;\n");
    const r = await runCheck(project(blank));
    expect(r.issues.map((i) => i.message).join(" ")).toMatch(/canvas stayed blank/);
  });

  it("asks for onIdleFrame when GameCanvas is paused, even with arrow functions in its props", () => {
    const without = PAUSED_GAME.replace(/        onIdleFrame=\{[\s\S]*?\n        \}\}\n/, "");
    expect(without).not.toMatch(/onIdleFrame/);
    const errors = checkApp(project(without)).errors.filter((e) => /onIdleFrame/.test(e.message));
    expect(errors).toHaveLength(1);
    expect(errors[0].file).toBe("src/App.tsx");
    expect(gameChecks(project(PAUSED_GAME))).toEqual([]);
    // A canvas shown only while playing isn't paused, so it needs nothing.
    expect(gameChecks(project(GAME))).toEqual([]);
    expect(jsxTags('<GameCanvas onFrame={(f) => f.dt > 1} paused />', "GameCanvas")[0].text).toBe('<GameCanvas onFrame={(f) => f.dt > 1} paused />');
  });

  it("type-checks a game with the leaderboard, the post form and a sprite, and asks for the board's data rule", async () => {
    const files = project(BOARD_GAME);
    const missing = checkApp(files).errors.filter((e) => e.file === "src/lib/dataRules.json");
    expect(missing).toHaveLength(1);
    expect(missing[0].message).toContain(SCORES_RULE_JSON);
    const ruled = withScoresRule(files);
    expect(checkApp(ruled).errors).toEqual([]);
    const types = await typeCheck(ruled);
    expect(types.ran).toBe(true);
    expect(types.issues).toEqual([]);
    // A board anyone can post to without a wallet isn't what the owner chose.
    const anyone = withScoresRule(files, { create: "anyone", read: ["anyone"] });
    expect(checkApp(anyone).errors.some((e) => e.file === "src/lib/dataRules.json")).toBe(true);
  });

  it.skipIf(!hasBrowser)("runs in a real browser with the leaderboard on the page: the start screen is drawn and Play works with no wallet", async () => {
    const r = await runCheck(withScoresRule(project(BOARD_GAME)), { screenshots: true });
    expect(r.ran).toBe(true);
    expect(r.issues).toEqual([]);
    // The start screen and a moment of play on a phone, then the computer.
    expect(r.screenshots?.map((s) => s.shows ?? s.width)).toEqual(["start", "playing", 1280]);
  });

  it.skipIf(!hasBrowser)("catches a start screen that is an empty box, and one with no Play button", async () => {
    const blankStart = BOARD_GAME.replace(/onIdleFrame=\{onIdleFrame\}\s*/, "");
    const r = await runCheck(withScoresRule(project(blankStart)));
    expect(r.issues.map((i) => i.message).join(" ")).toMatch(/start screen shows the game area as an empty box/);
    const noButton = BOARD_GAME.replace(">\n            Play\n          </button>", ">\n            Drive\n          </button>");
    expect(noButton).not.toEqual(BOARD_GAME);
    const r2 = await runCheck(withScoresRule(project(noButton)));
    expect(r2.issues.map((i) => i.message).join(" ")).toMatch(/no Play button/);
  });

  it("type-checks a game built from the blocks: pools, a spawner, traffic, oncoming cars, a rival, power-ups and the HUD", async () => {
    const files = project(BLOCKS_GAME);
    expect(checkApp(files).errors).toEqual([]);
    const types = await typeCheck(files);
    expect(types.ran).toBe(true);
    expect(types.issues).toEqual([]);
  });

  it("asks for declareGame, spawned and probe in a game that has none", () => {
    const bare = GAME.replace(/import \{ declareGame, probe, spawned \} from "\.\/game\/probe";\n/, "").replace(/declareGame\(\{[^}]*\}\);\n/, "").replace(/\s*spawned\("pipe"\);/, "").replace(/\s*\/\/ A point a second[^\n]*\n\s*probe\([^\n]*/, "");
    expect(bare).not.toMatch(/declareGame|spawned|probe\(/);
    const message = checkApp(project(bare)).errors.map((e) => e.message).join(" ");
    expect(message).toMatch(/GoodBuild can't test this game yet/);
    expect(message).toMatch(/declareGame[\s\S]*spawned[\s\S]*probe/);
  });

  it.skipIf(!hasBrowser)("plays a game built from the blocks for real: rounds, Play again, and every kind it declared", async () => {
    const r = await runCheck(project(BLOCKS_GAME));
    expect(r.issues).toEqual([]);
    expect(r.note).toMatch(/played \d+ rounds?/);
    expect(r.note).toMatch(/saw .*slowCar/);
  });

  it.skipIf(!hasBrowser)("catches a game that runs but has no obstacles, no score, no control and never gets harder", async () => {
    const r = await runCheck(project(STUCK_GAME));
    const all = r.issues.map((i) => i.message).join("\n");
    expect(all).toMatch(/score never went up/);
    expect(all).toMatch(/Nothing got in the player's way/);
    expect(all).toMatch(/never appeared: "rock", "star"/);
    expect(all).toMatch(/never moved the player/);
    expect(all).toMatch(/didn't get harder/);
  });

  it.skipIf(!hasBrowser)("catches a game over with no Play again", async () => {
    const noAgain = GAME.replace('<button type="button" onClick={start}', '{screen === "start" && <button type="button" onClick={start}').replace("</button>\n        </section>", "</button>}\n        </section>");
    expect(noAgain).not.toEqual(GAME);
    const r = await runCheck(project(noAgain));
    expect(r.issues.map((i) => i.message).join(" ")).toMatch(/no Play again button/);
  });

  it.skipIf(!hasBrowser)("posts a score with a stand-in wallet, and catches a board that never shows it", async () => {
    const ok = await runCheck(withScoresRule(project(BOARD_GAME)));
    expect(ok.issues).toEqual([]);
    expect(ok.note).toMatch(/a score was posted and shown on the board/);
    // PostScore and Leaderboard on two different boards: the post works, but the board on screen never hears of it.
    const split = BOARD_GAME.replace("  const board = useLeaderboard();", "  const board = useLeaderboard();\n  const other = useLeaderboard();").replace("<PostScore board={board}", "<PostScore board={other}");
    const r = await runCheck(withScoresRule(project(split)));
    expect(r.issues.map((i) => i.message).join(" ")).toMatch(/didn't put it on the leaderboard/);
  });

  it.skipIf(!hasBrowser)("opens a MiniPay game as MiniPay, and catches a Connect wallet button there", async () => {
    const mini = (app: string) => ({ ...withKit(project(app), kitById("mini-app")!), "src/App.tsx": app });
    const clean = await runCheck(mini(GAME));
    expect(clean.issues).toEqual([]);
    expect(clean.note).toMatch(/MiniPay connected by itself|MiniPay wasn't asked/);
    const withButton = GAME.replace('<h1 className="text-xl font-semibold">Campus Flap</h1>', '<h1 className="text-xl font-semibold">Campus Flap</h1>\n        <button type="button">Connect wallet</button>');
    const r = await runCheck(mini(withButton));
    expect(r.issues.map((i) => i.message).join(" ")).toMatch(/Inside MiniPay the page shows a Connect wallet button/);
  });
});
