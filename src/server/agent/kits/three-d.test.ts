// @vitest-environment node
import { afterAll, describe, expect, it } from "vitest";

import { needsOwnBuild } from "@/lib/preview-engine";
import { buildPublishedApp } from "@/server/publish/build";

import { checkApp } from "../checks";
import { closeRunCheckBrowser, runCheck } from "../run-check";
import { starterFiles } from "../template";
import { typeCheck } from "../type-check";

import { detectKits, kitIdsOf, packagesFor, withKit } from "./index";
import { threeD, threeDChecks } from "./three-d";

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

  it("refuses its own renderer, outside model files and react-three-fiber", () => {
    const messages = (body: string) => threeDChecks(project(PAGE + body)).map((i) => i.message).join("\n");
    expect(messages("\nconst r = new THREE.WebGLRenderer();\n")).toMatch(/Scene3D/);
    expect(messages("\nconst l = new THREE.TextureLoader();\n")).toMatch(/CanvasTexture/);
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
});
