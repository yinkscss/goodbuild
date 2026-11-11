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

  it("gives a project that still has the first Scene3D today's, and leaves a changed one alone", () => {
    const first = "x".repeat(10);
    const changed = { ...project(), "src/three/Scene3D.tsx": first };
    expect(withKit(changed, threeD)["src/three/Scene3D.tsx"]).toBe(first);
    expect(Object.keys(threeD.superseded ?? {})).toEqual(["src/three/Scene3D.tsx"]);
  });
});
