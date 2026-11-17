import type { GameTemplate } from "./index";

/**
 * Runner 3D (D116): run down a three-lane track, change lane with a tap or a key, jump low barriers,
 * dodge crates and a drone that sweeps across, grab coins and a shield. The games kit's probe, Spawner,
 * difficulty, Effects, sound and leaderboard work in Scene3D as in 2D; Hud3D is the score panel.
 * Original to GoodBuild: named for how it plays.
 */

const LOOK = `// How everything looks. Each thing is built by one function from three.js shapes, made once and reused.
// Change the colours and shapes to fit the plan's look.
import * as THREE from "three";

export const GAME_NAME = "Runner 3D";
export const BEST_KEY = "runner-3d";

export const COLOURS = {
  sky: "#0f172a",
  track: "#334155",
  line: "#e2e8f0",
  player: "#f97316",
  crate: "#a16207",
  barrier: "#ef4444",
  drone: "#a855f7",
  coin: "#facc15",
  shield: "#38bdf8",
};

export function makePlayer(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 0.6, 4, 8), new THREE.MeshLambertMaterial({ color: COLOURS.player }));
  body.position.y = 0.7;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 12, 12), new THREE.MeshLambertMaterial({ color: "#fde68a" }));
  head.position.y = 1.35;
  g.add(body, head);
  return g;
}

export function makeCrate(): THREE.Mesh {
  return new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.2), new THREE.MeshLambertMaterial({ color: COLOURS.crate }));
}

/** A low barrier across one lane: jump it. */
export function makeBarrier(): THREE.Mesh {
  return new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.4, 0.3), new THREE.MeshLambertMaterial({ color: COLOURS.barrier, emissive: "#7f1d1d" }));
}

export function makeDrone(): THREE.Mesh {
  return new THREE.Mesh(new THREE.OctahedronGeometry(0.5), new THREE.MeshLambertMaterial({ color: COLOURS.drone, emissive: "#3b0764" }));
}

export function makeCoin(): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.08, 16), new THREE.MeshLambertMaterial({ color: COLOURS.coin, emissive: "#854d0e" }));
  m.rotation.x = Math.PI / 2;
  return m;
}

export function makeShieldPickup(): THREE.Mesh {
  return new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.1, 8, 20), new THREE.MeshLambertMaterial({ color: COLOURS.shield, emissive: "#0c4a6e" }));
}

/** The track: three lanes with lines, long enough to fade into the fog. */
export function makeTrack(laneXs: readonly number[]): THREE.Group {
  const g = new THREE.Group();
  const width = laneXs[laneXs.length - 1] - laneXs[0] + 3;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(width, 220), new THREE.MeshLambertMaterial({ color: COLOURS.track }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.z = -90;
  g.add(floor);
  for (let i = 0; i < laneXs.length - 1; i++) {
    const line = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 220), new THREE.MeshBasicMaterial({ color: COLOURS.line }));
    line.rotation.x = -Math.PI / 2;
    line.position.set((laneXs[i] + laneXs[i + 1]) / 2, 0.01, -90);
    g.add(line);
  }
  return g;
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
import { BEST_KEY, COLOURS, GAME_NAME, makeBarrier, makeCoin, makeCrate, makeDrone, makePlayer, makeShieldPickup, makeTrack } from "./look";

// Everything the game has, by the names the code uses. Change it with the plan: every kind listed here
// must show up within the first 15 seconds of a round, and spawned(kind) is called when one appears.
declareGame({ style: "action", controls: ["sides", "keys"], obstacles: ["crate", "barrier"], powerups: ["coin", "shield"], npcs: ["drone"] });

const LANES = [-2, 0, 2];
const FAR = -70;
/** The order things first arrive in, so a short round meets every kind; after that they're mixed. */
const KINDS = ["crate", "coin", "barrier", "drone", "shield"];

type Thing = { kind: string; mesh: THREE.Object3D; lane: number; active: boolean; sweep: number };
type Screen = "start" | "playing" | "paused" | "over";

const spawner = new Spawner({ every: 0.9, fastest: 0.4, grace: 0.5 });
const effects = new Effects();

const fresh = () => ({ lane: 1, x: 0, y: 0, vy: 0, t: 0, score: 0, coins: 0, spawns: 0, lastPointer: 0, wasLeft: false, wasRight: false, over: false, reset: true });

export default function Game() {
  const [screen, setScreen] = useState<Screen>("start");
  const [best, setBest] = useState(() => bestScore(BEST_KEY));
  const [result, setResult] = useState({ score: 0, coins: 0 });
  const [tip] = useState(() => firstTime("runner-3d-controls"));
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
    setResult({ score, coins: g.coins });
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
          controls={["left", "right", "action"]}
          onIdleFrame={(_dt, time) => {
            // The start screen drifts slowly round the runner.
            const c = view.current.camera;
            if (c) {
              c.position.set(Math.sin(time * 0.3) * 1.5, 4.4, 7.5);
              c.lookAt(0, 0.6, -8);
            }
          }}
          onReady={({ scene, camera, input }) => {
            view.current.camera = camera;
            scene.fog = new THREE.Fog(COLOURS.sky, 20, 70);
            scene.add(new THREE.HemisphereLight("#ffffff", "#1e293b", 1.6));
            const sun = new THREE.DirectionalLight("#ffffff", 1.2);
            sun.position.set(3, 8, 4);
            scene.add(sun, makeTrack(LANES));
            const player = makePlayer();
            scene.add(player);
            const ring = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.05, 8, 32), new THREE.MeshBasicMaterial({ color: COLOURS.shield }));
            ring.rotation.x = Math.PI / 2;
            ring.position.y = 0.1;
            player.add(ring);
            camera.position.set(0, 4.4, 7.5);
            camera.lookAt(0, 0.6, -8);

            // Made once and reused: nothing is created while the game runs.
            const make: Record<string, () => THREE.Object3D> = { crate: makeCrate, barrier: makeBarrier, drone: makeDrone, coin: makeCoin, shield: makeShieldPickup };
            const things: Thing[] = [];
            for (const kind of KINDS) {
              for (let i = 0; i < 6; i++) {
                const mesh = make[kind]();
                mesh.visible = false;
                scene.add(mesh);
                things.push({ kind, mesh, lane: 0, active: false, sweep: 0 });
              }
            }

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
              const level = difficulty(g.t, 75);
              const speed = 14 + level * 16;

              // Steering: tap a side of the track or press left or right. Space or the action button jumps.
              if (input.pointer.x !== g.lastPointer) {
                g.lane = input.pointer.x < 0 ? Math.max(0, g.lane - 1) : Math.min(LANES.length - 1, g.lane + 1);
                g.lastPointer = input.pointer.x;
              }
              if (input.left && !g.wasLeft) g.lane = Math.max(0, g.lane - 1);
              if (input.right && !g.wasRight) g.lane = Math.min(LANES.length - 1, g.lane + 1);
              g.wasLeft = input.left;
              g.wasRight = input.right;
              if (input.actionPressed && g.y <= 0) {
                g.vy = 7;
                sfx.jump();
              }
              g.vy -= 20 * dt;
              g.y = Math.max(0, g.y + g.vy * dt);
              g.x += (LANES[g.lane] - g.x) * Math.min(1, dt * 12);
              player.position.set(g.x, g.y, 0);
              player.rotation.x = g.y > 0 ? -0.3 : Math.sin(g.t * 14) * 0.08;
              ring.visible = effects.isActive("shield");

              if (spawner.tick(dt, level)) {
                const kind = g.spawns < KINDS.length ? KINDS[g.spawns] : KINDS[Math.floor(Math.random() * KINDS.length)];
                g.spawns += 1;
                const t = things.find((x) => !x.active && x.kind === kind);
                if (t) {
                  t.active = true;
                  t.lane = Math.floor(Math.random() * LANES.length);
                  t.sweep = Math.random() * Math.PI * 2;
                  t.mesh.visible = true;
                  t.mesh.position.set(LANES[t.lane], kind === "barrier" ? 0.2 : kind === "drone" ? 1 : 0.6, FAR);
                  spawned(kind);
                }
              }

              for (const t of things) {
                if (!t.active) continue;
                const m = t.mesh;
                m.position.z += speed * dt;
                if (t.kind === "drone") {
                  // The drone sweeps from lane to lane, slowly enough to read.
                  t.sweep += dt * 1.6;
                  m.position.x = Math.sin(t.sweep) * 2.2;
                  m.rotation.y += dt * 3;
                }
                if (t.kind === "coin" || t.kind === "shield") m.rotation.z += dt * 4;
                if (m.position.z > 6) {
                  t.active = false;
                  m.visible = false;
                  continue;
                }
                const close = Math.abs(m.position.z) < 0.7 && Math.abs(m.position.x - g.x) < 0.9;
                if (!close) continue;
                if (t.kind === "coin") {
                  t.active = false;
                  m.visible = false;
                  g.coins += 1;
                  g.score += 25;
                  sfx.coin();
                  buzz("collect");
                } else if (t.kind === "shield") {
                  t.active = false;
                  m.visible = false;
                  effects.activate("shield", 6);
                  sfx.coin();
                } else if (t.kind === "barrier" && g.y > 0.5) {
                  // Cleared it with a jump.
                } else {
                  t.active = false;
                  m.visible = false;
                  if (effects.isActive("shield")) {
                    effects.end("shield");
                    sfx.hit();
                    buzz("hit");
                  } else end();
                }
              }

              effects.update(dt);
              g.score += speed * dt * 0.5;
              probe(Math.floor(g.score), player.position.x, player.position.z, speed);
              camera.position.x += (g.x * 0.5 - camera.position.x) * Math.min(1, dt * 4);
              camera.position.y = 4.4;
              camera.position.z = 7.5;
              camera.lookAt(camera.position.x, 0.6, -8);
            };
          }}
        />
        <Hud3D
          read={() => {
            const running: { name: string; fraction: number }[] = [];
            effects.each((name, fraction) => running.push({ name, fraction }));
            return { score: game.current.score, best, label: "Coins " + game.current.coins, effects: running };
          }}
        />
        <TopThree board={board} className="absolute right-2 top-2" />
        {screen === "start" && (
          <div className="absolute inset-x-4 bottom-6 space-y-3 rounded-2xl bg-card/95 p-4 text-center shadow-lg">
            <h2 className="text-lg font-semibold">{GAME_NAME}</h2>
            <p className="text-sm text-muted-foreground">Tap left or right to change lane, the round button to jump. Grab coins, dodge crates and the drone.</p>
            {tip && <p className="text-sm">Red barriers are low: jump them.</p>}
            {best > 0 && <p className="text-sm">Your best: {best}</p>}
            <button type="button" onClick={start} className="w-full rounded-xl bg-primary px-6 py-3 text-lg font-semibold text-primary-foreground">
              Play
            </button>
          </div>
        )}
        {screen === "over" && (
          <GameOver score={result.score} best={best} stats={[{ label: "Coins", value: result.coins }]} onAgain={start} shareText={"I scored " + result.score + " in " + GAME_NAME}>
            <PostScore board={board} score={result.score} />
          </GameOver>
        )}
      </div>
      {screen !== "playing" && <GameSettings />}
      <Leaderboard board={board} title="Top runners" />
    </div>
  );
}
`;

const APP = `import Game from "./play/Game";
import { GAME_NAME } from "./play/look";

export default function App() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-4 p-4">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{GAME_NAME}</h1>
      </header>
      <Game />
    </main>
  );
}
`;

export const runner3d: GameTemplate = {
  id: "runner-3d",
  name: "3D runner",
  dims: "3d",
  style: "action",
  fits: "3D runners, 3D racing or dodging down a track, anything the person calls 3D with lanes",
  kits: ["three-d", "game-2d"],
  files: { "src/App.tsx": APP, "src/play/Game.tsx": GAME, "src/play/look.ts": LOOK },
  leaderboard: true,
  title: { from: "./play/look", name: "GAME_NAME" },
  brief: `This game starts from GoodBuild's 3D runner template, a working, tested 3D game: src/play/Game.tsx (the game in Scene3D), src/play/look.ts (the name, colours and one function per thing, built from three.js shapes) and src/App.tsx. Reshape it to the plan instead of starting again:
- Rename it (GAME_NAME, BEST_KEY in look.ts) and restyle the shapes and colours to the plan's look. Keep building each thing once and reusing it.
- Make the obstacles, pick-ups and characters the plan's: change KINDS, the make functions and what each does on contact, and keep declareGame listing exactly the kinds the game has, with spawned(kind) when one appears. Every kind must show up within the first 15 seconds.
- Keep what makes it work: the probe calls with x and z, Scene3D paused with onIdleFrame, Hud3D, GameOver with PostScore, free play with no wallet.`,
};
