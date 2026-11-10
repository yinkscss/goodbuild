// @vitest-environment node
import { chromium } from "playwright-core";
import { afterAll, describe, expect, it } from "vitest";

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

  it.skipIf(!hasBrowser)("catches a game that never draws", async () => {
    const blank = GAME.replace(/    ctx\.fillStyle = "#7dd3fc";[\s\S]*?ctx\.fillText\("🐤", 44, g\.y\);\n/, "    void ctx;\n    void width;\n");
    const r = await runCheck(project(blank));
    expect(r.issues.map((i) => i.message).join(" ")).toMatch(/canvas stayed blank/);
  });
});
