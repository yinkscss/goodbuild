import type { GameTemplate } from "./index";
import { KEEP_3D, appFor } from "./shared";

/**
 * Kart track (D117): a kart on a winding road that never ends. The road bends left and right and the
 * player steers to stay on it: off the road the kart slows and scores less, and the tyre walls cost a life. Cones and barrels sit on
 * the road, a rival kart weaves ahead to be overtaken, coins and a boost lie along the way. Three hits
 * and the race is over. Unlike the 3D runner there are no lanes: the curves are the game.
 * Original to GoodBuild: named for how it plays.
 */

const LOOK = `// How everything looks. Each thing is built by one function from three.js shapes, made once and reused.
// Change the colours and shapes to fit the plan's look.
import * as THREE from "three";

export const GAME_NAME = "Kart Track";
export const BEST_KEY = "kart-track";

export const COLOURS = {
  sky: "#7dd3fc",
  grass: "#4d7c0f",
  road: "#3f3f46",
  kerbA: "#ef4444",
  kerbB: "#f8fafc",
  kart: "#2563eb",
  rival: "#f59e0b",
  cone: "#f97316",
  barrel: "#b91c1c",
  coin: "#facc15",
  boost: "#22d3ee",
};

/** Half the road's width: steer to keep the kart inside it. */
export const ROAD_HALF = 3.4;
/** How long one piece of road is. */
export const SEGMENT = 3;

/** A kart: a body, a seat and four wheels. */
export function makeKart(colour: string): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.35, 1.8), new THREE.MeshLambertMaterial({ color: colour }));
  body.position.y = 0.35;
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 0.5), new THREE.MeshLambertMaterial({ color: "#111827" }));
  seat.position.set(0, 0.7, 0.3);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 12), new THREE.MeshLambertMaterial({ color: "#fde68a" }));
  head.position.set(0, 1.1, 0.25);
  g.add(body, seat, head);
  const wheel = new THREE.CylinderGeometry(0.25, 0.25, 0.25, 12);
  const tyre = new THREE.MeshLambertMaterial({ color: "#0a0a0a" });
  for (const [x, z] of [[-0.62, -0.6], [0.62, -0.6], [-0.62, 0.6], [0.62, 0.6]]) {
    const w = new THREE.Mesh(wheel, tyre);
    w.rotation.z = Math.PI / 2;
    w.position.set(x, 0.25, z);
    g.add(w);
  }
  return g;
}

export function makeCone(): THREE.Mesh {
  return new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.9, 12), new THREE.MeshLambertMaterial({ color: COLOURS.cone }));
}

export function makeBarrel(): THREE.Mesh {
  return new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.9, 14), new THREE.MeshLambertMaterial({ color: COLOURS.barrel }));
}

export function makeCoin(): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.08, 16), new THREE.MeshLambertMaterial({ color: COLOURS.coin, emissive: "#854d0e" }));
  m.rotation.x = Math.PI / 2;
  return m;
}

export function makeBoostPad(): THREE.Mesh {
  return new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.06, 1.4), new THREE.MeshLambertMaterial({ color: COLOURS.boost, emissive: "#0e7490" }));
}

/** One piece of road, SEGMENT long, with red and white kerbs on both sides. */
export function makeRoadPiece(index: number): THREE.Group {
  const g = new THREE.Group();
  const road = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_HALF * 2, SEGMENT + 0.05), new THREE.MeshLambertMaterial({ color: COLOURS.road }));
  road.rotation.x = -Math.PI / 2;
  g.add(road);
  const kerb = new THREE.MeshLambertMaterial({ color: index % 2 ? COLOURS.kerbA : COLOURS.kerbB });
  for (const side of [-1, 1]) {
    const k = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.08, SEGMENT), kerb);
    k.position.set(side * (ROAD_HALF + 0.2), 0.04, 0);
    g.add(k);
  }
  return g;
}

export function makeGrass(): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshLambertMaterial({ color: COLOURS.grass }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = -0.02;
  return m;
}
`;

const GAME = `import { useRef, useState } from "react";
import * as THREE from "three";
import { GameOver } from "../game/GameOver";
import { GameSettings } from "../game/GameSettings";
import { Leaderboard, PostScore } from "../game/Leaderboard";
import { TopThree } from "../game/TopThree";
import { firstTime } from "../game/extras";
import { buzz } from "../game/haptics";
import { useLeaderboard } from "../game/leaderboard";
import { Effects } from "../game/powerups";
import { declareGame, probe, spawned } from "../game/probe";
import { sfx } from "../game/sound";
import { bestScore, saveBest } from "../game/storage";
import { Spawner, difficulty } from "../game/world";
import { Hud3D } from "../three/Hud3D";
import { Scene3D } from "../three/Scene3D";
import { BEST_KEY, COLOURS, GAME_NAME, ROAD_HALF, SEGMENT, makeBarrel, makeBoostPad, makeCoin, makeCone, makeGrass, makeKart, makeRoadPiece } from "./look";

// Everything the game has, by the names the code uses. Change it with the plan: every kind listed here
// must show up within the first 15 seconds of a round, and spawned(kind) is called when one appears.
declareGame({ style: "action", controls: ["drag", "tap", "keys"], obstacles: ["cone", "barrel"], powerups: ["coin", "boost"], npcs: ["rival"] });

const FAR = -80;
const PIECES = 30;
const LIVES = 3;
/** The order things first arrive in, so a short round meets every kind; after that they're mixed. */
const FIRST = ["cone", "coin", "rival", "barrel", "boost"];
const LATER = ["cone", "cone", "barrel", "coin", "coin", "rival", "boost"];

type Thing = { kind: string; mesh: THREE.Object3D; offset: number; z: number; active: boolean; passed: boolean };
type Screen = "start" | "playing" | "paused" | "over";

const spawner = new Spawner({ every: 0.8, fastest: 0.35, grace: 0.6 });
const effects = new Effects();

/** Where the road's middle is, sideways, at a distance s along it: two waves make bends that never repeat exactly. */
const middle = (s: number) => Math.sin(s / 38) * 5 + Math.sin(s / 15) * 1.6;

const fresh = () => ({ x: 0, target: 0, distance: 0, t: 0, score: 0, coins: 0, passed: 0, lives: LIVES, hurt: 0, spawns: 0, lastPointer: -9, over: false, reset: true });

export default function Game() {
  const [screen, setScreen] = useState<Screen>("start");
  const [best, setBest] = useState(() => bestScore(BEST_KEY));
  const [result, setResult] = useState({ score: 0, coins: 0, passed: 0 });
  const [tip] = useState(() => firstTime("kart-track-controls"));
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
    setResult({ score, coins: g.coins, passed: g.passed });
    setScreen("over");
  };

  const start = () => {
    game.current = fresh();
    effects.clear();
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
          controls={["left", "right"]}
          onIdleFrame={(_dt, time) => {
            // The start screen swings slowly round the kart.
            const c = view.current.camera;
            if (c) {
              c.position.set(Math.sin(time * 0.4) * 3, 3, 6);
              c.lookAt(0, 0.6, -6);
            }
          }}
          onReady={({ scene, camera, input }) => {
            view.current.camera = camera;
            scene.fog = new THREE.Fog(COLOURS.sky, 30, 85);
            scene.add(new THREE.HemisphereLight("#ffffff", "#365314", 1.5));
            const sun = new THREE.DirectionalLight("#ffffff", 1.3);
            sun.position.set(4, 10, 3);
            scene.add(sun, makeGrass());
            const kart = makeKart(COLOURS.kart);
            scene.add(kart);
            camera.position.set(0, 3, 6);
            camera.lookAt(0, 0.6, -6);

            // Made once and reused: the road pieces move along the bends as the kart drives.
            const pieces = Array.from({ length: PIECES }, (_, i) => {
              const p = makeRoadPiece(i);
              scene.add(p);
              return p;
            });
            const make: Record<string, () => THREE.Object3D> = { cone: makeCone, barrel: makeBarrel, coin: makeCoin, boost: makeBoostPad, rival: () => makeKart(COLOURS.rival) };
            const things: Thing[] = [];
            for (const kind of Object.keys(make)) {
              for (let i = 0; i < 5; i++) {
                const mesh = make[kind]();
                mesh.visible = false;
                scene.add(mesh);
                things.push({ kind, mesh, offset: 0, z: FAR, active: false, passed: false });
              }
            }
            const placeRoad = (distance: number) => {
              const shift = distance % SEGMENT;
              pieces.forEach((p, i) => {
                const z = -i * SEGMENT + shift;
                const s = distance - z;
                p.position.set(middle(s), 0, z);
                // Turn each piece along the road: its slope there.
                p.rotation.y = -Math.atan(middle(s + 0.5) - middle(s - 0.5));
              });
            };
            placeRoad(0);
            /** Lose a life, with a moment to recover. */
            const hit = () => {
              const g = game.current;
              if (g.hurt > 0) return;
              g.lives -= 1;
              g.hurt = 1;
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
              const here = middle(g.distance);
              const onRoad = Math.abs(g.x - here) < ROAD_HALF;
              const boosted = effects.isActive("boost");
              const speed = (16 + level * 14) * (onRoad ? 1 : 0.55) * (boosted ? 1.4 : 1) * (g.hurt > 0 ? 0.7 : 1);

              // Steering: put a finger where the kart should go (or tap there), or hold left or right.
              if (input.pointer.down || input.pointer.x !== g.lastPointer) {
                g.target = input.pointer.x * 7;
                g.lastPointer = input.pointer.x;
              }
              if (input.left) g.target = g.x - 9 * dt * 4;
              if (input.right) g.target = g.x + 9 * dt * 4;
              g.target = Math.max(-9, Math.min(9, g.target));
              const before = g.x;
              g.x += (g.target - g.x) * Math.min(1, dt * 5);
              g.distance += speed * dt;
              g.hurt = Math.max(0, g.hurt - dt);
              // Tyre walls line the track: run wide into them and it costs a life, and you bounce back.
              if (Math.abs(g.x - here) > ROAD_HALF + 1.4) {
                g.x = here + Math.sign(g.x - here) * (ROAD_HALF + 0.6);
                g.target = g.x;
                hit();
              }
              kart.position.set(g.x, 0, 0);
              kart.rotation.y = -(g.x - before) / Math.max(dt, 0.001) * 0.04;
              kart.visible = g.hurt <= 0 || Math.floor(g.t * 12) % 2 === 0;
              placeRoad(g.distance);

              if (spawner.tick(dt, level)) {
                const kind = g.spawns < FIRST.length ? FIRST[g.spawns] : LATER[Math.floor(Math.random() * LATER.length)];
                g.spawns += 1;
                const t = things.find((x) => !x.active && x.kind === kind);
                if (t) {
                  t.active = true;
                  t.passed = false;
                  t.z = FAR;
                  t.offset = (Math.random() * 2 - 1) * (ROAD_HALF - 0.8);
                  t.mesh.visible = true;
                  spawned(kind);
                }
              }

              for (const t of things) {
                if (!t.active) continue;
                // The rival drives too, a little slower than you, weaving across the road.
                if (t.kind === "rival") {
                  t.z += speed * 0.35 * dt;
                  t.offset = Math.sin(g.t * 1.3 + t.z * 0.1) * (ROAD_HALF - 1);
                } else t.z += speed * dt;
                const x = middle(g.distance - t.z) + t.offset;
                t.mesh.position.set(x, t.kind === "cone" || t.kind === "barrel" ? 0.45 : t.kind === "coin" ? 0.6 : 0.03, t.z);
                if (t.kind === "coin") t.mesh.rotation.z += dt * 4;
                if (t.z > 6) {
                  t.active = false;
                  t.mesh.visible = false;
                  continue;
                }
                if (t.kind === "rival" && !t.passed && t.z > 1.2) {
                  t.passed = true;
                  g.passed += 1;
                  g.score += 50;
                  sfx.coin();
                }
                if (Math.abs(t.z) > 0.9 || Math.abs(x - g.x) > 0.95) continue;
                if (t.kind === "coin") {
                  t.active = false;
                  t.mesh.visible = false;
                  g.coins += 1;
                  g.score += 20;
                  sfx.coin();
                  buzz("collect");
                } else if (t.kind === "boost") {
                  t.active = false;
                  t.mesh.visible = false;
                  effects.activate("boost", 3);
                  sfx.jump();
                } else if (g.hurt <= 0 && !boosted) {
                  // A cone, a barrel or the rival.
                  t.active = false;
                  t.mesh.visible = false;
                  hit();
                }
              }

              effects.update(dt);
              g.score += speed * dt * (onRoad ? 0.5 : 0.15);
              probe(Math.floor(g.score), kart.position.x, kart.position.z, speed);
              camera.position.x += (g.x * 0.7 - camera.position.x) * Math.min(1, dt * 4);
              camera.position.y = 3;
              camera.position.z = 6;
              camera.lookAt(middle(g.distance + 10) * 0.7, 0.6, -8);
            };
          }}
        />
        <Hud3D
          read={() => {
            const running: { name: string; fraction: number }[] = [];
            effects.each((name, fraction) => running.push({ name, fraction }));
            return { score: game.current.score, best, lives: game.current.lives, label: "Coins " + game.current.coins, effects: running };
          }}
        />
        <TopThree board={board} className="absolute right-2 top-2" />
        {screen === "start" && (
          <div className="absolute inset-x-4 bottom-6 space-y-3 rounded-2xl bg-card/95 p-4 text-center shadow-lg">
            <h2 className="text-lg font-semibold">{GAME_NAME}</h2>
            <p className="text-sm text-muted-foreground">Hold your thumb where the kart should go and follow the bends. Off the road you slow down; the tyre walls cost a life.</p>
            {tip && <p className="text-sm">Overtake the orange kart for a bonus. Blue pads are a boost.</p>}
            {best > 0 && <p className="text-sm">Your best: {best}</p>}
            <button type="button" onClick={start} className="w-full rounded-xl bg-primary px-6 py-3 text-lg font-semibold text-primary-foreground">
              Play
            </button>
          </div>
        )}
        {screen === "over" && (
          <GameOver
            score={result.score}
            best={best}
            stats={[
              { label: "Coins", value: result.coins },
              { label: "Overtakes", value: result.passed },
            ]}
            onAgain={start}
            shareText={"I scored " + result.score + " in " + GAME_NAME}
          >
            <PostScore board={board} score={result.score} />
          </GameOver>
        )}
      </div>
      {screen !== "playing" && <GameSettings />}
      <Leaderboard board={board} title="Top drivers" />
    </div>
  );
}
`;

export const kartTrack: GameTemplate = {
  id: "kart-track",
  name: "Kart track",
  dims: "3d",
  style: "action",
  fits: "3D driving with steering and no lanes: karts, cars, bikes or boats on a winding road or river, following the bends, overtaking a rival",
  kits: ["three-d", "game-2d"],
  files: { "src/App.tsx": appFor("./play/look", "GAME_NAME"), "src/play/Game.tsx": GAME, "src/play/look.ts": LOOK },
  leaderboard: true,
  title: { from: "./play/look", name: "GAME_NAME" },
  brief: `This game starts from GoodBuild's Kart track template, a working, tested 3D game: src/play/Game.tsx (the game in Scene3D), src/play/look.ts (the name, colours, the road's width and one function per thing, built from three.js shapes) and src/App.tsx. Reshape it to the plan instead of starting again:
- Rename it (GAME_NAME, BEST_KEY in look.ts) and restyle the karts, the road and the things on it to the plan's look.
- Change the bends (middle()), the obstacles, pick-ups and rival to the plan's: change FIRST, LATER, the make functions and what each does on contact, and keep declareGame listing exactly the kinds the game has, with spawned(kind) when one appears. Every kind must show up within the first 15 seconds.
- The kart stays at z = 0 and the road moves past it: keep it that way, so probe sees only the steering.
- ${KEEP_3D}`,
};
