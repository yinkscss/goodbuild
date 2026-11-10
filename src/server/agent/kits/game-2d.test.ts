// @vitest-environment node
import { chromium } from "playwright-core";
import { afterAll, describe, expect, it } from "vitest";

import { buildPublishedApp } from "@/server/publish/build";

import { checkApp } from "../checks";
import { closeRunCheckBrowser, runCheck } from "../run-check";
import { starterFiles } from "../template";
import { typeCheck } from "../type-check";
import { detectKits, kitIdsOf, withKit } from "./index";
import { game2d } from "./game-2d";

const hasBrowser =
  Boolean(process.env.CI) ||
  (await chromium
    .launch({ headless: true })
    .then((b) => b.close().then(() => true))
    .catch(() => false));

/** A small game written the way the guide asks: state in a ref, three screens, dt, one-tap play. */
const GAME = `import { useRef, useState } from "react";
import { GameCanvas, type Frame } from "./game/GameCanvas";
import { sfx } from "./game/sound";
import { bestScore, saveBest } from "./game/storage";

type Screen = "start" | "playing" | "over";

export default function App() {
  const [screen, setScreen] = useState<Screen>("start");
  const [score, setScore] = useState(0);
  const game = useRef({ y: 320, vy: 0, pipes: [] as { x: number; gap: number; passed: boolean }[], spawn: 0, score: 0 });

  const start = () => {
    game.current = { y: 320, vy: 0, pipes: [], spawn: 0, score: 0 };
    setScore(0);
    setScreen("playing");
  };

  const onFrame = ({ ctx, width, height, dt, input }: Frame) => {
    const g = game.current;
    if (input.actionPressed) {
      g.vy = -320;
      sfx.jump();
    }
    g.vy += 900 * dt;
    g.y += g.vy * dt;
    g.spawn -= dt;
    if (g.spawn <= 0) {
      g.pipes.push({ x: width + 40, gap: 180 + Math.random() * 280, passed: false });
      g.spawn = 1.5;
    }
    for (const p of g.pipes) {
      p.x -= 140 * dt;
      if (!p.passed && p.x < 60) {
        p.passed = true;
        g.score += 1;
        setScore(g.score);
        sfx.coin();
      }
    }
    g.pipes = g.pipes.filter((p) => p.x > -60);
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
      <GameCanvas onFrame={onFrame} paused={!playing} controls={["left", "right", "action"]} label="Test game" />
    </main>
  );
}
`;

const project = (app: string) => ({ ...withKit(starterFiles(), game2d), "src/App.tsx": app });

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
    expect(game2d.superseded?.["src/game/GameCanvas.tsx"]).toHaveLength(1);
  });

  it.skipIf(!hasBrowser)("catches a game that never draws", async () => {
    const blank = GAME.replace(/    ctx\.fillStyle = "#7dd3fc";[\s\S]*?ctx\.fillText\("🐤", 44, g\.y\);\n/, "    void ctx;\n    void width;\n");
    const r = await runCheck(project(blank));
    expect(r.issues.map((i) => i.message).join(" ")).toMatch(/canvas stayed blank/);
  });
});
