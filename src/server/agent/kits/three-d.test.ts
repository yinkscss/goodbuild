// @vitest-environment node
import { chromium } from "playwright-core";
import { afterAll, describe, expect, it } from "vitest";

import { needsOwnBuild } from "@/lib/preview-engine";
import { buildPublishedApp } from "@/server/publish/build";

import { checkApp } from "../checks";
import { closeRunCheckBrowser, runCheck } from "../run-check";
import { starterFiles } from "../template";
import { typeCheck } from "../type-check";

import { detectKits, kitIdsOf, packagesFor, withKit } from "./index";
import { game2d } from "./game-2d";
import { threeD, threeDChecks } from "./three-d";

/** Whether the browser here can draw WebGL at all: without it Scene3D shows its plain message and there is no scene to look at. */
const hasWebGL = await chromium
  .launch({ headless: true })
  .then(async (b) => {
    const page = await b.newPage();
    const ok = await page.evaluate(() => Boolean(document.createElement("canvas").getContext("webgl2") || document.createElement("canvas").getContext("webgl")));
    await b.close();
    return ok;
  })
  .catch(() => false);

const PAGE = `import * as THREE from "three";
import { Scene3D } from "./three/Scene3D";

export default function App() {
  return (
    <main className="mx-auto max-w-xl p-4">
      <h1 className="text-xl font-semibold">Spinning cube</h1>
      <Scene3D
        orbit
        onReady={({ scene, camera }) => {
          camera.position.set(0, 1, 4);
          scene.add(new THREE.AmbientLight("#ffffff", 0.6));
          const light = new THREE.DirectionalLight("#ffd9a0", 2);
          light.position.set(3, 4, 2);
          scene.add(light);
          const cube = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: "#8b5cf6" }));
          scene.add(cube);
          return (dt) => {
            cube.rotation.y += dt;
          };
        }}
      />
    </main>
  );
}
`;
/** A 3D lane dodger written the way the D113 guide asks: Scene3D paused between rounds, the probe, Hud3D, and Play again on the scene. */
const GAME_3D = `import { useRef, useState } from "react";
import * as THREE from "three";
import { declareGame, probe, spawned } from "./game/probe";
import { sfx } from "./game/sound";
import { Hud3D } from "./three/Hud3D";
import { Scene3D } from "./three/Scene3D";

declareGame({ style: "action", controls: ["sides", "keys"], obstacles: ["block"] });

type Screen = "start" | "playing" | "over";
const fresh = () => ({ x: 0, aim: 0, lastPointer: 0, t: 0, score: 0, spawn: 0.6, hits: 0, over: false, reset: true });

export default function App() {
  const [screen, setScreen] = useState<Screen>("start");
  const g = useRef(fresh());
  const world = useRef<{ player?: THREE.Mesh }>({});
  const start = () => {
    g.current = fresh();
    setScreen("playing");
  };

  return (
    <main className="mx-auto flex max-w-md flex-col gap-3 p-4">
      <h1 className="text-xl font-semibold">Lane Dash 3D</h1>
      <div className="relative">
        <Scene3D
          className="h-[60vh] w-full"
          touch
          paused={screen !== "playing"}
          onIdleFrame={(dt) => {
            if (world.current.player) world.current.player.rotation.y += dt;
          }}
          onReady={({ scene, camera, input }) => {
            scene.add(new THREE.HemisphereLight("#ffffff", "#334155", 2));
            const ground = new THREE.Mesh(new THREE.PlaneGeometry(8, 80), new THREE.MeshLambertMaterial({ color: "#334155" }));
            ground.rotation.x = -Math.PI / 2;
            ground.position.z = -30;
            const player = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: "#f97316" }));
            player.position.y = 0.5;
            world.current.player = player;
            scene.add(ground, player);
            const blocks = Array.from({ length: 12 }, () => {
              const m = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.4, 1.4), new THREE.MeshLambertMaterial({ color: "#38bdf8" }));
              m.visible = false;
              scene.add(m);
              return m;
            });
            camera.position.set(0, 4, 7);
            camera.lookAt(0, 0, -6);
            return (dt) => {
              const s = g.current;
              if (s.reset) {
                s.reset = false;
                for (const b of blocks) b.visible = false;
              }
              // A tap on a side of the scene, or Space, picks the side to steer to.
              if (input.pointer.x !== s.lastPointer) {
                s.aim = input.pointer.x < 0 ? -2.5 : 2.5;
                s.lastPointer = input.pointer.x;
              }
              if (input.left) s.aim = -2.5;
              if (input.right) s.aim = 2.5;
              if (input.actionPressed) s.aim = s.aim > 0 ? -2.5 : 2.5;
              s.x += (s.aim - s.x) * Math.min(1, dt * 8);
              player.position.x = s.x;
              s.t += dt;
              const speed = 12 + s.t * 0.8;
              s.spawn -= dt;
              if (s.spawn <= 0) {
                const b = blocks.find((m) => !m.visible);
                if (b) {
                  b.position.set([-2.5, 0, 2.5][Math.floor(Math.random() * 3)], 0.7, -40);
                  b.visible = true;
                  spawned("block");
                }
                s.spawn = Math.max(0.35, 1 - s.t * 0.02);
              }
              for (const b of blocks) {
                if (!b.visible) continue;
                b.position.z += speed * dt;
                if (b.position.z > 6) b.visible = false;
                else if (Math.abs(b.position.z) < 0.9 && Math.abs(b.position.x - s.x) < 1.1) {
                  b.visible = false;
                  s.hits += 1;
                  sfx.hit();
                }
              }
              s.score += dt * 10;
              probe(Math.floor(s.score), player.position.x, player.position.z, speed);
              if (s.hits >= 3 && !s.over) {
                s.over = true;
                setScreen("over");
              }
            };
          }}
        />
        <Hud3D read={() => ({ score: g.current.score, lives: 3 - g.current.hits })} />
        {screen !== "playing" && (
          <div className="absolute inset-x-0 bottom-6 flex flex-col items-center gap-2">
            {screen === "over" && <p className="rounded bg-black/60 px-3 py-1 text-white">Score {Math.floor(g.current.score)}</p>}
            <button type="button" onClick={start} className="rounded-lg bg-primary px-6 py-3 text-primary-foreground">
              {screen === "over" ? "Play again" : "Play"}
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
`;

/** A 3D game: both kits, as the runner turns on for one (D113). */
const game3d = (app = GAME_3D): Record<string, string> => ({ ...withKit(withKit(starterFiles(), threeD), game2d), "src/App.tsx": app });

const project = (app = PAGE): Record<string, string> => ({ ...withKit(starterFiles(), threeD), "src/App.tsx": app });

describe("the 3D kit", { timeout: 180_000 }, () => {
  afterAll(() => closeRunCheckBrowser());

  it("is picked for 3D requests and not for ordinary ones", () => {
    const wants = (r: string) => detectKits(r, starterFiles()).includes(threeD);
    for (const yes of ["A 3D viewer for my NFT art", "a three.js globe", "A first-person maze game", "a spinning cube"]) expect(wants(yes), yes).toBe(true);
    for (const no of ["A tip jar for our football club", "A flappy bird game", "A 2D platformer"]) expect(wants(no), no).toBe(false);
  });

  it("brings three.js, and the workspace gives these projects its own build preview", () => {
    expect(threeD.packages).toEqual({ three: "0.187.0" });
    expect(kitIdsOf(project())).toEqual(["three-d"]);
    expect(packagesFor(project())).toHaveProperty("three");
    expect(needsOwnBuild(project())).toBe(true);
    expect(needsOwnBuild(starterFiles())).toBe(false);
  });

  it("passes the app check and the type check with a scene written the way the guide asks", async () => {
    expect(checkApp(project()).errors).toEqual([]);
    const types = await typeCheck(project());
    expect(types.ran).toBe(true);
    expect(types.issues).toEqual([]);
  });

  it("refuses its own renderer, other loaders, web addresses and react-three-fiber", () => {
    const messages = (body: string) => threeDChecks(project(PAGE + body)).map((i) => i.message).join("\n");
    expect(messages("\nconst r = new THREE.WebGLRenderer();\n")).toMatch(/Scene3D/);
    expect(messages("\nconst l = new FBXLoader();\n")).toMatch(/GLTFLoader/);
    expect(messages('\nnew GLTFLoader().load("https://example.com/m.glb", () => {});\n')).toMatch(/web address/);
    // An uploaded model through GLTFLoader is the supported path.
    expect(messages('\nnew GLTFLoader().load("/assets/robot.glb", () => {});\nnew THREE.TextureLoader();\n')).toBe("");
    expect(threeDChecks(project())).toEqual([]);
  });

  it("publishes: three.js is bundled into the app", async () => {
    const out = await buildPublishedApp({ files: project(), assets: [], title: "Viewer", hasUndeployedContracts: false });
    const js = out.find((f) => /^app\.[0-9a-f]{12}\.js$/.test(f.path))!;
    expect(new TextDecoder().decode(js.bytes)).toContain("WebGLRenderer");
  });

  it("loads in a real browser without errors, with a scene or its plain no-WebGL message", async () => {
    const r = await runCheck(project());
    if (!r.ran) return; // no browser here: CI has one
    expect(r.issues).toEqual([]);
  });

  it("catches a scene with nothing in view, and leaves alone one that waits for an uploaded model", async () => {
    const lost = PAGE.replace("camera.position.set(0, 1, 4);", "camera.position.set(0, 1, 4);\n          camera.lookAt(0, 50, 100);").replace("orbit\n", "");
    const r = await runCheck(project(lost));
    if (!r.ran) return;
    // Only a browser that can draw WebGL can tell; one that can't shows the plain message and nothing is reported.
    if (hasWebGL) expect(r.issues.map((i) => i.message).join(" ")).toMatch(/nothing is in view/);
    else expect(r.issues).toEqual([]);
    expect((await runCheck(project())).issues).toEqual([]);
    const waiting = PAGE.replace("scene.add(cube);", 'void cube;\n          void new THREE.TextureLoader();');
    expect((await runCheck(project(waiting))).issues).toEqual([]);
  });

  it("type-checks a game that reads the scene's input, pauses and cleans up after itself", async () => {
    const game = `import { useState } from "react";
import * as THREE from "three";
import { Scene3D } from "./three/Scene3D";

export default function App() {
  const [playing, setPlaying] = useState(false);
  return (
    <main className="mx-auto max-w-xl p-4">
      <button type="button" onClick={() => setPlaying(true)}>Play</button>
      <Scene3D
        touch
        paused={!playing}
        controls={["left", "right", "action"]}
        onReady={({ scene, camera, input, onCleanup }) => {
          const ball = new THREE.Mesh(new THREE.SphereGeometry(0.5), new THREE.MeshLambertMaterial({ color: "#f59e0b" }));
          scene.add(ball, new THREE.HemisphereLight("#ffffff", "#334155", 2));
          const ray = new THREE.Raycaster();
          const timer = window.setInterval(() => undefined, 1000);
          onCleanup(() => window.clearInterval(timer));
          return (dt) => {
            if (input.left) ball.position.x -= 3 * dt;
            if (input.right) ball.position.x += 3 * dt;
            if (input.actionPressed) ball.position.y = 1;
            ball.position.x += input.pointer.dx * 4;
            if (input.pointer.down) ray.setFromCamera(new THREE.Vector2(input.pointer.x, input.pointer.y), camera);
          };
        }}
      />
    </main>
  );
}
`;
    expect(checkApp(project(game)).errors).toEqual([]);
    const types = await typeCheck(project(game));
    expect(types.ran).toBe(true);
    expect(types.issues).toEqual([]);
    const r = await runCheck(project(game));
    if (r.ran) expect(r.issues).toEqual([]);
  });

  it("a 3D game written the way the guide asks passes the app check and the type check (D113)", async () => {
    expect(checkApp(game3d()).errors).toEqual([]);
    const types = await typeCheck(game3d());
    expect(types.ran).toBe(true);
    expect(types.issues).toEqual([]);
  });

  it("plays a 3D game like a 2D one: start screen, Play, rounds, Play again and what it declared (D113)", async () => {
    const r = await runCheck(game3d());
    if (!r.ran || !hasWebGL) return;
    expect(r.issues).toEqual([]);
    expect(r.note).toMatch(/played \d+ rounds?, .*saw block/);
  });

  it("catches a 3D game whose controls do nothing, in 3D words (D113)", async () => {
    const stuck = GAME_3D.replace("s.x += (s.aim - s.x) * Math.min(1, dt * 8);", "");
    expect(stuck).not.toEqual(GAME_3D);
    const r = await runCheck(game3d(stuck));
    if (!r.ran || !hasWebGL) return;
    expect(r.issues.map((i) => i.message).join(" ")).toMatch(/never moved the player[\s\S]*x and z/);
  });

  it("reports a 3D game that never shows its scene when the browser has WebGL, instead of saying there's no WebGL (D119)", async () => {
    const hidden = GAME_3D.replace("        <Scene3D\n", "        {Boolean(0) && <Scene3D\n").replace("        />\n        <Hud3D", "        />}\n        <Hud3D");
    expect(hidden).toMatch(/Boolean\(0\) && <Scene3D[\s\S]*\/>\}\n {8}<Hud3D/);
    const r = await runCheck(game3d(hidden));
    if (!r.ran || !hasWebGL) return;
    expect(r.note).not.toMatch(/no WebGL/);
    expect(r.issues.length).toBeGreaterThan(0);
  });

  it("asks a 3D game with no probe calls for them (D113)", () => {
    const bare = GAME_3D.replace('import { declareGame, probe, spawned } from "./game/probe";\n', "")
      .replace(/declareGame\(\{[^}]*\}\);\n/, "")
      .replace(/\s*spawned\("block"\);/, "")
      .replace(/\s*probe\(Math\.floor[^\n]*/, "");
    expect(bare).not.toMatch(/declareGame|spawned|probe\(/);
    expect(checkApp(game3d(bare)).errors.map((e) => e.message).join(" ")).toMatch(/can't test this 3D game yet[\s\S]*declareGame[\s\S]*spawned[\s\S]*probe/);
  });

  it("takes the review's pictures of a 3D game from the screen, start and play, with the scene drawn (D113)", async () => {
    const r = await runCheck(game3d(), { screenshots: true });
    if (!r.ran || !hasWebGL) return;
    const shows = (r.screenshots ?? []).map((s) => s.shows);
    expect(shows).toContain("start");
    expect(shows).toContain("playing");
    // A picture of one flat colour compresses to almost nothing; a drawn scene doesn't.
    for (const shot of (r.screenshots ?? []).filter((s) => s.shows)) expect(shot.png.length).toBeGreaterThan(8_000);
  });

  it("holds the game still while the 3D context is lost, and comes back with a tap instead of a black box (D113, D119)", async () => {
    if (!hasWebGL) return;
    // The spinning cube, counting its frames.
    const counting = PAGE.replace("cube.rotation.y += dt;", "cube.rotation.y += dt;\n            (window as unknown as { cubeFrames: number }).cubeFrames = ((window as unknown as { cubeFrames?: number }).cubeFrames ?? 0) + 1;");
    expect(counting).not.toBe(PAGE);
    const built = await buildPublishedApp({ files: project(counting), assets: [], title: "Viewer", hasUndeployedContracts: false, forCheck: true });
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({ viewport: { width: 400, height: 700 } });
      const byPath = new Map(built.map((f) => [f.path, f]));
      await context.route("**/*", (route) => {
        const url = new URL(route.request().url());
        const file = byPath.get(url.pathname.replace(/^\//, "") || "index.html");
        return file && url.host === "app.test" ? route.fulfill({ status: 200, contentType: file.mime, body: Buffer.from(file.bytes) }) : route.abort();
      });
      const page = await context.newPage();
      await page.goto("http://app.test/");
      await page.waitForSelector("canvas[data-game-canvas]");
      // What a phone does when another app needs the memory.
      await page.evaluate(() => {
        const gl = document.querySelector("canvas")!.getContext("webgl2") ?? document.querySelector("canvas")!.getContext("webgl");
        gl!.getExtension("WEBGL_lose_context")!.loseContext();
      });
      const reload = page.getByRole("button", { name: /tap to reload/i });
      await reload.waitFor({ timeout: 3_000 });
      // Nothing plays on behind the message, so nothing can be hit or scored unseen.
      const frames = () => page.evaluate(() => (window as unknown as { cubeFrames?: number }).cubeFrames ?? 0);
      const lostAt = await frames();
      await page.waitForTimeout(500);
      expect(await frames()).toBe(lostAt);
      await reload.click();
      await page.waitForFunction(() => document.querySelectorAll("canvas[data-game-canvas]").length === 1 && !document.body.innerText.includes("Tap to reload"));
      // Reloaded before the browser gave the old context back: the new scene plays (D119).
      const reloadedAt = await frames();
      await page.waitForTimeout(500);
      expect(await frames()).toBeGreaterThan(reloadedAt);
      const r = await page.evaluate(() => {
        const c = document.querySelector("canvas")!;
        const gl = c.getContext("webgl2") ?? c.getContext("webgl");
        return Boolean(gl && !gl.isContextLost());
      });
      expect(r).toBe(true);
    } finally {
      await browser.close();
    }
  });

  it("plays again when the browser gives a lost 3D context back by itself, and never steps the old scene meanwhile (D119)", async () => {
    if (!hasWebGL) return;
    const counting = PAGE.replace("cube.rotation.y += dt;", "cube.rotation.y += dt;\n            (window as unknown as { cubeFrames: number }).cubeFrames = ((window as unknown as { cubeFrames?: number }).cubeFrames ?? 0) + 1;");
    const built = await buildPublishedApp({ files: project(counting), assets: [], title: "Viewer", hasUndeployedContracts: false, forCheck: true });
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({ viewport: { width: 400, height: 700 } });
      const byPath = new Map(built.map((f) => [f.path, f]));
      await context.route("**/*", (route) => {
        const url = new URL(route.request().url());
        const file = byPath.get(url.pathname.replace(/^\//, "") || "index.html");
        return file && url.host === "app.test" ? route.fulfill({ status: 200, contentType: file.mime, body: Buffer.from(file.bytes) }) : route.abort();
      });
      const page = await context.newPage();
      await page.goto("http://app.test/");
      await page.waitForSelector("canvas[data-game-canvas]");
      const frames = () => page.evaluate(() => (window as unknown as { cubeFrames?: number }).cubeFrames ?? 0);
      await page.evaluate(() => {
        const c = document.querySelector("canvas")!;
        const gl = c.getContext("webgl2") ?? c.getContext("webgl");
        const ext = gl!.getExtension("WEBGL_lose_context")!;
        (window as unknown as { giveBack: () => void }).giveBack = () => ext.restoreContext();
        ext.loseContext();
      });
      await page.getByRole("button", { name: /tap to reload/i }).waitFor({ timeout: 3_000 });
      const lostAt = await frames();
      await page.waitForTimeout(300);
      expect(await frames()).toBe(lostAt);
      await page.evaluate(() => (window as unknown as { giveBack: () => void }).giveBack());
      await page.waitForFunction(() => !document.body.innerText.includes("Tap to reload"), undefined, { timeout: 3_000 });
      const backAt = await frames();
      await page.waitForTimeout(500);
      expect(await frames()).toBeGreaterThan(backAt);
    } finally {
      await browser.close();
    }
  });

  it("counts two quick taps on one side as two presses there, even when the pointer moves before the frame (D119)", async () => {
    if (!hasWebGL) return;
    const app = PAGE.replace("onReady={({ scene, camera }) => {", "onReady={({ scene, camera, input }) => {").replace(
      "cube.rotation.y += dt;",
      "cube.rotation.y += dt;\n            const log = ((window as unknown as { taps?: string[] }).taps ??= []);\n            for (const p of input.pointer.presses) log.push(p.x < 0 ? \"left\" : \"right\");",
    );
    expect(app).toContain("input.pointer.presses");
    const built = await buildPublishedApp({ files: project(app), assets: [], title: "Viewer", hasUndeployedContracts: false, forCheck: true });
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({ viewport: { width: 400, height: 700 } });
      const byPath = new Map(built.map((f) => [f.path, f]));
      await context.route("**/*", (route) => {
        const url = new URL(route.request().url());
        const file = byPath.get(url.pathname.replace(/^\//, "") || "index.html");
        return file && url.host === "app.test" ? route.fulfill({ status: 200, contentType: file.mime, body: Buffer.from(file.bytes) }) : route.abort();
      });
      const page = await context.newPage();
      await page.goto("http://app.test/");
      await page.waitForSelector("canvas[data-game-canvas]");
      // Two taps on the left and a move to the right, all between two frames.
      await page.evaluate(() => {
        const c = document.querySelector("canvas")!;
        const r = c.getBoundingClientRect();
        const at = (type: string, fx: number) => new PointerEvent(type, { clientX: r.left + r.width * fx, clientY: r.top + r.height / 2, bubbles: true });
        c.dispatchEvent(at("pointerdown", 0.2));
        window.dispatchEvent(at("pointerup", 0.2));
        c.dispatchEvent(at("pointerdown", 0.25));
        c.dispatchEvent(at("pointermove", 0.8));
        window.dispatchEvent(at("pointerup", 0.8));
      });
      await page.waitForTimeout(300);
      expect(await page.evaluate(() => (window as unknown as { taps?: string[] }).taps ?? [])).toEqual(["left", "left"]);
    } finally {
      await browser.close();
    }
  });

  it("gives a project that still has the first Scene3D today's, and leaves a changed one alone", () => {
    const first = "x".repeat(10);
    const changed = { ...project(), "src/three/Scene3D.tsx": first };
    expect(withKit(changed, threeD)["src/three/Scene3D.tsx"]).toBe(first);
    expect(Object.keys(threeD.superseded ?? {})).toEqual(["src/three/Scene3D.tsx"]);
    // The first (D77), the one that didn't report rounds or come back from a lost context (D113), and the one that kept playing while lost (D119).
    expect(threeD.superseded?.["src/three/Scene3D.tsx"]).toHaveLength(3);
  });
});
