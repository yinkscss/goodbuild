import type { GameTemplate } from "./index";
import { KEEP_3D, appFor } from "./shared";

/**
 * Sky rings (D117): fly a little plane through rings in the sky. Steer up, down, left and right by
 * holding a finger where the plane should go; rings in a row build a combo. Floating rocks and a hawk
 * that crosses your path cost a life, a boost doubles the points for a moment. Fuel burns all the time and
 * only rings refill it, so the rings are the game. Three lives.
 * Original to GoodBuild: named for how it plays.
 */

const LOOK = `// How everything looks. Each thing is built by one function from three.js shapes, made once and reused.
// Change the colours and shapes to fit the plan's look.
import * as THREE from "three";

export const GAME_NAME = "Sky Rings";
export const BEST_KEY = "sky-rings";

export const COLOURS = {
  sky: "#93c5fd",
  sea: "#1d4ed8",
  plane: "#ef4444",
  wing: "#f8fafc",
  ring: "#facc15",
  rock: "#78716c",
  hawk: "#78350f",
  boost: "#22d3ee",
  cloud: "#ffffff",
};

/** How far the plane can fly from the middle, sideways and up and down. */
export const REACH = { x: 4.2, low: 1, high: 6.2 };

/** The plane, nose pointing away from the camera. */
export function makePlane(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.28, 1.6, 10), new THREE.MeshLambertMaterial({ color: COLOURS.plane }));
  body.rotation.x = Math.PI / 2;
  const wings = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.06, 0.5), new THREE.MeshLambertMaterial({ color: COLOURS.wing }));
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.45, 0.35), new THREE.MeshLambertMaterial({ color: COLOURS.plane }));
  tail.position.set(0, 0.25, 0.7);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.05, 0.25), new THREE.MeshLambertMaterial({ color: COLOURS.wing }));
  fin.position.set(0, 0.05, 0.7);
  g.add(body, wings, tail, fin);
  return g;
}

/** A ring to fly through, facing the plane. */
export function makeRing(): THREE.Mesh {
  return new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.12, 10, 32), new THREE.MeshLambertMaterial({ color: COLOURS.ring, emissive: "#854d0e" }));
}

export function makeRock(): THREE.Mesh {
  return new THREE.Mesh(new THREE.DodecahedronGeometry(0.95), new THREE.MeshLambertMaterial({ color: COLOURS.rock, flatShading: true }));
}

/** A hawk: a body and two wings that flap. */
export function makeHawk(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 10), new THREE.MeshLambertMaterial({ color: COLOURS.hawk }));
  body.scale.set(1, 0.8, 1.6);
  const wing = new THREE.BoxGeometry(0.9, 0.05, 0.4);
  const mat = new THREE.MeshLambertMaterial({ color: COLOURS.hawk });
  const left = new THREE.Mesh(wing, mat);
  left.position.x = -0.6;
  left.name = "left";
  const right = new THREE.Mesh(wing, mat);
  right.position.x = 0.6;
  right.name = "right";
  g.add(body, left, right);
  return g;
}

export function makeBoost(): THREE.Mesh {
  return new THREE.Mesh(new THREE.OctahedronGeometry(0.45), new THREE.MeshLambertMaterial({ color: COLOURS.boost, emissive: "#0e7490" }));
}

export function makeCloud(): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: COLOURS.cloud, transparent: true, opacity: 0.85 });
  for (const [x, y, r] of [[0, 0, 1.2], [1.1, -0.2, 0.9], [-1.1, -0.2, 0.9]]) {
    const puff = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 10), mat);
    puff.position.set(x, y, 0);
    g.add(puff);
  }
  return g;
}

export function makeSea(): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshLambertMaterial({ color: COLOURS.sea }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = -4;
  return m;
}
`;

const GAME = `import { useRef, useState } from "react";
import * as THREE from "three";
import { GameMenu } from "../game/GameMenu";
import { GameOver } from "../game/GameOver";
import { GameSettings } from "../game/GameSettings";
import { Leaderboard, PostScore } from "../game/Leaderboard";
import { TopThree } from "../game/TopThree";
import { Combo } from "../game/extras";
import { buzz } from "../game/haptics";
import { useLeaderboard } from "../game/leaderboard";
import { Effects } from "../game/powerups";
import { declareGame, probe, spawned } from "../game/probe";
import { sfx } from "../game/sound";
import { bestScore, saveBest } from "../game/storage";
import { Spawner, difficulty } from "../game/world";
import { Hud3D } from "../three/Hud3D";
import { Scene3D } from "../three/Scene3D";
import { BEST_KEY, COLOURS, GAME_NAME, REACH, makeBoost, makeCloud, makeHawk, makePlane, makeRing, makeRock, makeSea } from "./look";

// Everything the game has, by the names the code uses. Change it with the plan: every kind listed here
// must show up within the first 15 seconds of a round, and spawned(kind) is called when one appears.
declareGame({ style: "action", controls: ["drag", "tap", "keys"], obstacles: ["rock"], powerups: ["ring", "boost"], npcs: ["hawk"] });

const FAR = -70;
const LIVES = 3;
/** The order things first arrive in, so a short round meets every kind; after that they're mixed. */
const FIRST = ["ring", "rock", "ring", "hawk", "rock", "boost"];
const LATER = ["ring", "ring", "ring", "rock", "rock", "rock", "hawk", "boost"];

type Thing = { kind: string; mesh: THREE.Object3D; active: boolean; vx: number };
type Screen = "start" | "playing" | "paused" | "over";

const spawner = new Spawner({ every: 0.75, fastest: 0.35, grace: 0.5 });
const effects = new Effects();
const combo = new Combo();
const MID = (REACH.low + REACH.high) / 2;
/** Fuel burns every second; each ring tops it up. Run dry and the flight is over. */
const FUEL = { full: 100, burn: 7, ring: 22 };

const fresh = () => ({ x: 0, y: MID, tx: 0, ty: MID, t: 0, score: 0, rings: 0, fuel: FUEL.full, lives: LIVES, hurt: 0, spawns: 0, lastX: -9, lastY: -9, over: false, reset: true });

export default function Game() {
  const [screen, setScreen] = useState<Screen>("start");
  const [best, setBest] = useState(() => bestScore(BEST_KEY));
  const [result, setResult] = useState({ score: 0, rings: 0 });
  const board = useLeaderboard();
  const game = useRef(fresh());
  const view = useRef<{ camera?: THREE.PerspectiveCamera }>({});

  const end = () => {
    const g = game.current;
    if (g.over) return;
    g.over = true;
    const score = Math.floor(g.score);
    sfx.lose();
    buzz("over");
    if (saveBest(score, BEST_KEY)) setBest(score);
    setResult({ score, rings: g.rings });
    setScreen("over");
  };

  const start = () => {
    game.current = fresh();
    effects.clear();
    combo.break();
    spawner.reset();
    sfx.tap();
    setScreen("playing");
  };

  return (
    <div className="mx-auto w-full max-w-md space-y-4">
      <div className="relative">
        <Scene3D
          className="h-[68vh] max-h-[640px] w-full"
          background={COLOURS.sky}
          touch
          paused={screen !== "playing"}
          controls={["left", "right", "up", "down"]}
          onIdleFrame={(_dt, time) => {
            // The start screen drifts slowly round the plane.
            const c = view.current.camera;
            if (c) {
              c.position.set(Math.sin(time * 0.35) * 2.5, MID + 1.2, 6);
              c.lookAt(0, MID, -8);
            }
          }}
          onReady={({ scene, camera, input }) => {
            view.current.camera = camera;
            scene.fog = new THREE.Fog(COLOURS.sky, 25, 75);
            scene.add(new THREE.HemisphereLight("#ffffff", "#1e3a8a", 1.6));
            const sun = new THREE.DirectionalLight("#ffffff", 1.2);
            sun.position.set(3, 10, 5);
            scene.add(sun, makeSea());
            const plane = makePlane();
            plane.position.set(0, MID, 0);
            scene.add(plane);
            camera.position.set(0, MID + 1.2, 6);
            camera.lookAt(0, MID, -8);

            // Made once and reused: nothing is created while the game runs.
            const clouds = Array.from({ length: 8 }, (_, i) => {
              const c = makeCloud();
              c.position.set((i % 2 ? 1 : -1) * (7 + Math.random() * 6), Math.random() * 8, -i * 10);
              scene.add(c);
              return c;
            });
            const make: Record<string, () => THREE.Object3D> = { ring: makeRing, rock: makeRock, hawk: makeHawk, boost: makeBoost };
            const things: Thing[] = [];
            for (const kind of Object.keys(make)) {
              for (let i = 0; i < 6; i++) {
                const mesh = make[kind]();
                mesh.visible = false;
                scene.add(mesh);
                things.push({ kind, mesh, active: false, vx: 0 });
              }
            }
            /** Lose a life, with a moment to recover. */
            const hit = () => {
              const g = game.current;
              if (g.hurt > 0) return;
              g.lives -= 1;
              g.hurt = 1;
              combo.break();
              sfx.hit();
              buzz("hit");
              if (g.lives <= 0) end();
            };

            return (dt) => {
              const g = game.current;
              if (g.reset) {
                g.reset = false;
                for (const t of things) {
                  t.active = false;
                  t.mesh.visible = false;
                }
              }
              g.t += dt;
              const level = difficulty(g.t, 80);
              const boosted = effects.isActive("boost");
              const speed = (18 + level * 16) * (boosted ? 1.3 : 1);

              // Steering: hold a finger where the plane should go (or tap there), or hold the arrows.
              if (input.pointer.down || input.pointer.x !== g.lastX || input.pointer.y !== g.lastY) {
                g.tx = input.pointer.x * REACH.x;
                g.ty = MID + input.pointer.y * (REACH.high - REACH.low) * 0.6;
                g.lastX = input.pointer.x;
                g.lastY = input.pointer.y;
              }
              // The arrows steer at a steady speed; a finger sets where the plane glides to.
              const keyX = (input.right ? 1 : 0) - (input.left ? 1 : 0);
              const keyY = (input.up ? 1 : 0) - (input.down ? 1 : 0);
              if (keyX) g.tx = g.x + keyX * 5 * dt;
              if (keyY) g.ty = g.y + keyY * 5 * dt;
              g.tx = Math.max(-REACH.x, Math.min(REACH.x, g.tx));
              g.ty = Math.max(REACH.low, Math.min(REACH.high, g.ty));
              const dx = keyX ? g.tx - g.x : (g.tx - g.x) * Math.min(1, dt * 5);
              const dy = keyY ? g.ty - g.y : (g.ty - g.y) * Math.min(1, dt * 5);
              g.x += dx;
              g.y += dy;
              g.hurt = Math.max(0, g.hurt - dt);
              plane.position.set(g.x, g.y, 0);
              // Bank into turns and tip the nose with climbs.
              plane.rotation.z = -dx / Math.max(dt, 0.001) * 0.08;
              plane.rotation.x = dy / Math.max(dt, 0.001) * 0.05;
              plane.visible = g.hurt <= 0 || Math.floor(g.t * 12) % 2 === 0;

              for (const c of clouds) {
                c.position.z += speed * 0.6 * dt;
                if (c.position.z > 8) c.position.z -= 80;
              }

              if (spawner.tick(dt, level)) {
                const kind = g.spawns < FIRST.length ? FIRST[g.spawns] : LATER[Math.floor(Math.random() * LATER.length)];
                g.spawns += 1;
                const t = things.find((x) => !x.active && x.kind === kind);
                if (t) {
                  t.active = true;
                  t.mesh.visible = true;
                  const y = REACH.low + Math.random() * (REACH.high - REACH.low);
                  if (kind === "hawk") {
                    // A hawk comes in from one side and crosses the plane's path.
                    const side = Math.random() < 0.5 ? -1 : 1;
                    t.mesh.position.set(side * 9, y, FAR * 0.6);
                    t.vx = -side * (5 + level * 4);
                  } else t.mesh.position.set((Math.random() * 2 - 1) * REACH.x, y, FAR);
                  spawned(kind);
                }
              }

              for (const t of things) {
                if (!t.active) continue;
                const m = t.mesh;
                const was = m.position.z;
                m.position.z += speed * dt;
                if (t.kind === "hawk") {
                  m.position.x += t.vx * dt;
                  const flap = Math.sin(g.t * 14) * 0.5;
                  const left = m.getObjectByName("left");
                  const right = m.getObjectByName("right");
                  if (left) left.rotation.z = flap;
                  if (right) right.rotation.z = -flap;
                  m.rotation.y = t.vx > 0 ? Math.PI / 2 : -Math.PI / 2;
                }
                if (t.kind === "rock") m.rotation.x += dt;
                if (t.kind === "boost") m.rotation.y += dt * 3;
                if (m.position.z > 6) {
                  t.active = false;
                  m.visible = false;
                  continue;
                }
                const off = Math.hypot(m.position.x - g.x, m.position.y - g.y);
                if (t.kind === "ring") {
                  // Through the ring as it passes: points, and more for rings in a row. Missing one breaks the combo.
                  if (was < 0 && m.position.z >= 0) {
                    if (off < 1.05) {
                      const points = 30 * combo.hit() * (boosted ? 2 : 1);
                      g.score += points;
                      g.rings += 1;
                      g.fuel = Math.min(FUEL.full, g.fuel + FUEL.ring);
                      sfx.coin();
                      buzz("collect");
                    } else combo.break();
                  }
                  continue;
                }
                if (Math.abs(m.position.z) > 0.9 || off > (t.kind === "boost" ? 1 : 1.15)) continue;
                t.active = false;
                m.visible = false;
                if (t.kind === "boost") {
                  effects.activate("boost", 4);
                  sfx.jump();
                } else hit();
              }

              g.fuel -= FUEL.burn * dt;
              if (g.fuel <= 0) end();
              effects.update(dt);
              combo.update(dt);
              g.score += speed * dt * 0.3;
              probe(Math.floor(g.score), plane.position.x, plane.position.y, speed);
              camera.position.x += (g.x * 0.6 - camera.position.x) * Math.min(1, dt * 4);
              camera.position.y += (g.y + 1.2 - camera.position.y) * Math.min(1, dt * 4);
              camera.position.z = 6;
              camera.lookAt(camera.position.x * 0.5, g.y * 0.6 + MID * 0.4, -8);
            };
          }}
        />
        <Hud3D
          read={() => {
            const running: { name: string; fraction: number }[] = [];
            effects.each((name, fraction) => running.push({ name, fraction }));
            return { score: game.current.score, best, lives: game.current.lives, label: "Fuel " + Math.max(0, Math.ceil(game.current.fuel)) + "%" + (combo.multiplier > 1 ? "  ·  x" + combo.multiplier : ""), effects: running };
          }}
        />
        <TopThree board={board} className="absolute right-2 top-2" />
        {screen === "start" && (
          <GameMenu
            className="absolute inset-x-4 bottom-6"
            title={GAME_NAME}
            tagline="Fly through the rings. Miss the rocks and the hawk."
            best={best}
            onPlay={start}
            howTo={["Hold your finger where the plane should fly, or use the arrow keys.", "Each ring tops up your fuel; rings in a row build a combo.", "Rocks and the hawk cost a life. Three lives, and an empty tank ends the flight."]}
            powerUps={[
              { name: "Ring", text: "points and fuel" },
              { name: "Boost", text: "doubles your points for a few seconds" },
            ]}
            wallet
          />
        )}
        {screen === "over" && (
          <GameOver score={result.score} best={best} stats={[{ label: "Rings", value: result.rings }]} onAgain={start} shareText={"I scored " + result.score + " in " + GAME_NAME}>
            <PostScore board={board} score={result.score} />
          </GameOver>
        )}
      </div>
      {screen !== "playing" && <GameSettings />}
      <Leaderboard board={board} title="Top pilots" />
    </div>
  );
}
`;

export const skyRings: GameTemplate = {
  id: "sky-rings",
  name: "Sky rings",
  dims: "3d",
  style: "action",
  fits: "3D flying games steered up, down and sideways: planes, birds, dragons, drones or spaceships flying through rings or gates and dodging things in the air or under water",
  kits: ["three-d", "game-2d"],
  files: { "src/App.tsx": appFor("./play/look", "GAME_NAME"), "src/play/Game.tsx": GAME, "src/play/look.ts": LOOK },
  leaderboard: true,
  title: { from: "./play/look", name: "GAME_NAME" },
  brief: `This game starts from GoodBuild's Sky rings template, a working, tested 3D game: src/play/Game.tsx (the game in Scene3D), src/play/look.ts (the name, colours, how far the plane can fly and one function per thing, built from three.js shapes) and src/App.tsx. Reshape it to the plan instead of starting again:
- Rename it (GAME_NAME, BEST_KEY in look.ts) and restyle the plane, the rings and everything in the sky to the plan's look.
- Tune FUEL to the plan (or take it out if the plan has another way to end a flight). Make the obstacles, pick-ups and characters the plan's: change FIRST, LATER, the make functions and what each does on contact, and keep declareGame listing exactly the kinds the game has, with spawned(kind) when one appears. Every kind must show up within the first 15 seconds.
- The plane stays at z = 0 and the sky moves past it: keep it that way, so probe sees only the steering (x and y).
- ${KEEP_3D}`,
};
