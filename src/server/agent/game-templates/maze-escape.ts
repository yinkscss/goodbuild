import type { GameTemplate } from "./index";
import { KEEP_3D, appFor } from "./shared";

/**
 * Maze escape (D117): a 3D maze seen from above. Find the key, then the door, before the torch burns
 * out. Guards walk their corridors back and forth, spikes rise and fall on a beat, gems add time to the
 * torch. Each door opens on a new maze; today's mazes are the same for everyone. Swipe, tap a side or
 * use the arrows to step from cell to cell. Original to GoodBuild: an exit and a key, no dots or chasers.
 */

const LOOK = `// How everything looks. Each thing is built by one function from three.js shapes, made once and reused.
// Change the colours and shapes to fit the plan's look.
import * as THREE from "three";

export const GAME_NAME = "Maze Escape";
export const BEST_KEY = "maze-escape";

export const COLOURS = {
  back: "#0c0a09",
  floor: "#292524",
  wall: "#57534e",
  wallTop: "#a8a29e",
  player: "#38bdf8",
  guard: "#dc2626",
  spikes: "#e7e5e4",
  gem: "#34d399",
  key: "#facc15",
  door: "#7c2d12",
  doorOpen: "#22c55e",
};

/** How wide one cell of the maze is. */
export const CELL = 1.6;

export function makePlayer(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.4, 0.8, 16), new THREE.MeshLambertMaterial({ color: COLOURS.player }));
  body.position.y = 0.4;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 14, 14), new THREE.MeshLambertMaterial({ color: "#fde68a" }));
  head.position.y = 1.0;
  // The torch the player carries: a warm light that moves with them.
  const torch = new THREE.PointLight("#fdba74", 2.2, 9, 1.2);
  torch.position.y = 1.6;
  g.add(body, head, torch);
  return g;
}

export function makeGuard(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.9, 0.7), new THREE.MeshLambertMaterial({ color: COLOURS.guard }));
  body.position.y = 0.45;
  const eye = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.05), new THREE.MeshBasicMaterial({ color: "#fef08a" }));
  eye.position.set(0, 0.65, 0.36);
  g.add(body, eye);
  return g;
}

/** A square of spikes that rises out of the floor. */
export function makeSpikes(): THREE.Group {
  const g = new THREE.Group();
  const cone = new THREE.ConeGeometry(0.14, 0.6, 8);
  const mat = new THREE.MeshLambertMaterial({ color: COLOURS.spikes });
  for (let i = 0; i < 9; i++) {
    const s = new THREE.Mesh(cone, mat);
    s.position.set(((i % 3) - 1) * 0.42, 0.3, (Math.floor(i / 3) - 1) * 0.42);
    g.add(s);
  }
  return g;
}

export function makeGem(): THREE.Mesh {
  return new THREE.Mesh(new THREE.OctahedronGeometry(0.3), new THREE.MeshLambertMaterial({ color: COLOURS.gem, emissive: "#065f46" }));
}

export function makeKey(): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: COLOURS.key, emissive: "#854d0e" });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.06, 8, 16), mat);
  const stem = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.5, 0.08), mat);
  stem.position.y = -0.38;
  const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 0.08), mat);
  tooth.position.set(0.1, -0.56, 0);
  g.add(ring, stem, tooth);
  return g;
}

/** The way out: a door in a frame, locked until the key is found. */
export function makeDoor(): THREE.Mesh {
  return new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.5, 0.25), new THREE.MeshLambertMaterial({ color: COLOURS.door }));
}

/** Every wall block of the maze, drawn as one shape many times. */
export function makeWalls(max: number): THREE.InstancedMesh {
  const m = new THREE.InstancedMesh(new THREE.BoxGeometry(CELL, 1.2, CELL), new THREE.MeshLambertMaterial({ color: COLOURS.wall }), max);
  m.count = 0;
  return m;
}

export function makeFloor(size: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshLambertMaterial({ color: COLOURS.floor }));
  m.rotation.x = -Math.PI / 2;
  return m;
}
`;

const GAME = `import { useRef, useState } from "react";
import * as THREE from "three";
import { GameOver } from "../game/GameOver";
import { GameSettings } from "../game/GameSettings";
import { Leaderboard, PostScore } from "../game/Leaderboard";
import { TopThree } from "../game/TopThree";
import { dailySeed, firstTime, seededRandom } from "../game/extras";
import { buzz } from "../game/haptics";
import { useLeaderboard } from "../game/leaderboard";
import { declareGame, probe, spawned } from "../game/probe";
import { sfx } from "../game/sound";
import { bestScore, saveBest } from "../game/storage";
import { Hud3D } from "../three/Hud3D";
import { Scene3D } from "../three/Scene3D";
import { BEST_KEY, CELL, COLOURS, GAME_NAME, makeDoor, makeFloor, makeGem, makeGuard, makeKey, makePlayer, makeSpikes, makeWalls } from "./look";

// Everything the game has, by the names the code uses. Change it with the plan: every kind listed here
// must show up within the first 15 seconds of a round, and spawned(kind) is called when one appears.
declareGame({ style: "action", controls: ["swipe", "tap", "keys"], obstacles: ["spikes"], powerups: ["gem", "key"], npcs: ["guard"] });

/** Cells across: an odd number, walls between the paths. */
const SIZE = 13;
const LIVES = 3;
/** Seconds of torch at the start, the most it can hold, and what a gem adds. */
const TORCH = { start: 20, max: 35, gem: 5, door: 12 };
const GEMS = 4;
const SPIKES = 3;

type Dir = { x: number; z: number };
const DIRS: Record<string, Dir> = { up: { x: 0, z: -1 }, down: { x: 0, z: 1 }, left: { x: -1, z: 0 }, right: { x: 1, z: 0 } };
type Guard = { cells: { x: number; z: number }[]; at: number; dir: number; mesh: THREE.Object3D; active: boolean };
type Spike = { x: number; z: number; phase: number; mesh: THREE.Object3D; active: boolean };
type Gem = { x: number; z: number; mesh: THREE.Object3D; active: boolean };
type Screen = "start" | "playing" | "paused" | "over";

/** A maze for this level: true is a wall. The same for everyone today. */
function buildMaze(level: number): boolean[][] {
  const rand = seededRandom(dailySeed() + level * 7919);
  const wall = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => true));
  const stack = [{ x: 1, z: 1 }];
  wall[1][1] = false;
  while (stack.length) {
    const c = stack[stack.length - 1];
    const next = Object.values(DIRS)
      .map((d) => ({ x: c.x + d.x * 2, z: c.z + d.z * 2, d }))
      .filter((n) => n.x > 0 && n.z > 0 && n.x < SIZE - 1 && n.z < SIZE - 1 && wall[n.z][n.x]);
    if (!next.length) {
      stack.pop();
      continue;
    }
    const n = next[Math.floor(rand() * next.length)];
    wall[c.z + n.d.z][c.x + n.d.x] = false;
    wall[n.z][n.x] = false;
    stack.push({ x: n.x, z: n.z });
  }
  // A few extra openings, so there's more than one way round a guard.
  for (let i = 0; i < 8; i++) {
    const x = 1 + Math.floor(rand() * (SIZE - 2));
    const z = 1 + Math.floor(rand() * (SIZE - 2));
    if ((x + z) % 2 === 1) wall[z][x] = false;
  }
  return wall;
}

const fresh = () => ({ x: 1, z: 1, level: 0, torch: TORCH.start, t: 0, score: 0, gems: 0, mazes: 0, lives: LIVES, hurt: 0, hasKey: false, keyX: 0, keyZ: 0, visited: new Set<number>(), wall: [] as boolean[][], build: true, over: false, acc: { x: 0, y: 0 }, wasDown: false, last: null as { x: number; y: number } | null, held: { up: false, down: false, left: false, right: false } });

export default function Game() {
  const [screen, setScreen] = useState<Screen>("start");
  const [best, setBest] = useState(() => bestScore(BEST_KEY));
  const [result, setResult] = useState({ score: 0, mazes: 0, gems: 0 });
  const [tip] = useState(() => firstTime("maze-escape-controls"));
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
    setResult({ score, mazes: g.mazes, gems: g.gems });
    setScreen("over");
  };

  const start = () => {
    game.current = fresh();
    sfx.tap();
    setScreen("playing");
  };

  const at = (x: number, z: number) => new THREE.Vector3((x - (SIZE - 1) / 2) * CELL, 0, (z - (SIZE - 1) / 2) * CELL);

  return (
    <div className="mx-auto w-full max-w-md space-y-4">
      <div className="relative">
        <Scene3D
          className="h-[68vh] max-h-[640px] w-full"
          background={COLOURS.back}
          touch
          paused={screen !== "playing"}
          controls={["left", "right", "up", "down"]}
          onIdleFrame={(_dt, time) => {
            // The start screen circles slowly over the maze.
            const c = view.current.camera;
            if (c) {
              c.position.set(Math.sin(time * 0.25) * 8, 16, Math.cos(time * 0.25) * 8);
              c.lookAt(0, 0, 0);
            }
          }}
          onReady={({ scene, camera, input }) => {
            view.current.camera = camera;
            scene.add(new THREE.HemisphereLight("#e7e5e4", "#1c1917", 0.9));
            const moon = new THREE.DirectionalLight("#ffffff", 0.6);
            moon.position.set(-3, 10, 4);
            scene.add(moon, makeFloor(SIZE * CELL));

            // Made once and reused: each new maze only moves them.
            const walls = makeWalls(SIZE * SIZE);
            scene.add(walls);
            const player = makePlayer();
            scene.add(player);
            const door = makeDoor();
            scene.add(door);
            const key = makeKey();
            scene.add(key);
            const guards: Guard[] = Array.from({ length: 3 }, () => ({ cells: [], at: 0, dir: 1, mesh: makeGuard(), active: false }));
            const spikes: Spike[] = Array.from({ length: SPIKES }, () => ({ x: 0, z: 0, phase: 0, mesh: makeSpikes(), active: false }));
            const gems: Gem[] = Array.from({ length: GEMS }, () => ({ x: 0, z: 0, mesh: makeGem(), active: false }));
            for (const thing of [...guards, ...spikes, ...gems]) {
              thing.mesh.visible = false;
              scene.add(thing.mesh);
            }
            const matrix = new THREE.Matrix4();
            camera.position.set(0, 16, 8);
            camera.lookAt(0, 0, 0);

            /** Lay out a fresh maze: walls, door, key, gems, spikes and guards. */
            const layout = () => {
              const g = game.current;
              const rand = seededRandom(dailySeed() + g.level * 104729 + 1);
              g.wall = buildMaze(g.level);
              g.x = 1;
              g.z = 1;
              player.position.copy(at(1, 1));
              g.hasKey = false;
              g.visited = new Set([g.z * SIZE + g.x]);
              let n = 0;
              for (let z = 0; z < SIZE; z++) {
                for (let x = 0; x < SIZE; x++) {
                  if (!g.wall[z][x]) continue;
                  matrix.setPosition(at(x, z).setY(0.6));
                  walls.setMatrixAt(n++, matrix);
                }
              }
              walls.count = n;
              walls.instanceMatrix.needsUpdate = true;
              door.position.copy(at(SIZE - 2, SIZE - 2)).setY(0.75);
              (door.material as THREE.MeshLambertMaterial).color.set(COLOURS.door);

              // Open cells by how far they are from the start, for placing things fairly.
              const far = new Map<number, number>([[1 * SIZE + 1, 0]]);
              const queue = [{ x: 1, z: 1 }];
              while (queue.length) {
                const c = queue.shift()!;
                for (const d of Object.values(DIRS)) {
                  const x = c.x + d.x;
                  const z = c.z + d.z;
                  if (!g.wall[z]?.[x] && !far.has(z * SIZE + x)) {
                    far.set(z * SIZE + x, far.get(c.z * SIZE + c.x)! + 1);
                    queue.push({ x, z });
                  }
                }
              }
              const open = [...far.entries()].filter(([i, d]) => d > 2 && i !== (SIZE - 2) * SIZE + (SIZE - 2));
              const take = (minDistance: number) => {
                const choices = open.filter(([, d]) => d >= minDistance);
                const pick = choices.length ? choices : open;
                const [i] = pick[Math.floor(rand() * pick.length)];
                open.splice(open.findIndex(([j]) => j === i), 1);
                return { x: i % SIZE, z: Math.floor(i / SIZE) };
              };
              const maxDistance = Math.max(...far.values());
              const k = take(Math.floor(maxDistance * 0.5));
              g.keyX = k.x;
              g.keyZ = k.z;
              key.visible = true;
              key.position.copy(at(k.x, k.z)).setY(0.8);
              spawned("key");
              for (const gem of gems) {
                const c = take(0);
                Object.assign(gem, c, { active: true });
                gem.mesh.visible = true;
                gem.mesh.position.copy(at(c.x, c.z)).setY(0.5);
              }
              spawned("gem");
              spikes.forEach((s, i) => {
                const c = take(3);
                Object.assign(s, c, { active: true, phase: i * 0.8 });
                s.mesh.visible = true;
                s.mesh.position.copy(at(c.x, c.z));
              });
              spawned("spikes");
              // Guards walk the longest straight corridors, one more with each maze (up to three).
              const runs: { x: number; z: number }[][] = [];
              for (const d of [DIRS.right, DIRS.down]) {
                for (let z = 1; z < SIZE - 1; z++) {
                  for (let x = 1; x < SIZE - 1; x++) {
                    if (g.wall[z][x] || !g.wall[z - d.z]?.[x - d.x]) continue;
                    const run = [];
                    for (let cx = x, cz = z; !g.wall[cz]?.[cx]; cx += d.x, cz += d.z) run.push({ x: cx, z: cz });
                    if (run.length >= 3 && !run.some((c) => c.x + c.z < 4)) runs.push(run);
                  }
                }
              }
              runs.sort((a, b) => b.length - a.length);
              guards.forEach((guard, i) => {
                guard.active = i < Math.min(runs.length, 1 + g.level);
                guard.mesh.visible = guard.active;
                if (!guard.active) return;
                guard.cells = runs[i];
                guard.at = 0;
                guard.dir = 1;
              });
              if (guards.some((guard) => guard.active)) spawned("guard");
            };

            /** Lose a life: back to the start of this maze, with a moment to recover. */
            const hit = () => {
              const g = game.current;
              if (g.hurt > 0) return;
              g.lives -= 1;
              g.hurt = 1.2;
              g.x = 1;
              g.z = 1;
              // Straight back to the start, so only the player's own steps move them.
              player.position.copy(at(1, 1));
              sfx.hit();
              buzz("hit");
              if (g.lives <= 0) end();
            };

            /** One step, if no wall is in the way. */
            const step = (dir: Dir) => {
              const g = game.current;
              const x = g.x + dir.x;
              const z = g.z + dir.z;
              if (g.wall[z]?.[x] !== false) return;
              g.x = x;
              g.z = z;
              sfx.tap();
              const cell = z * SIZE + x;
              if (!g.visited.has(cell)) {
                g.visited.add(cell);
                g.score += 2;
              }
              for (const gem of gems) {
                if (gem.active && gem.x === x && gem.z === z) {
                  gem.active = false;
                  gem.mesh.visible = false;
                  g.gems += 1;
                  g.score += 25;
                  g.torch = Math.min(TORCH.max, g.torch + TORCH.gem);
                  sfx.coin();
                  buzz("collect");
                }
              }
              if (!g.hasKey && x === g.keyX && z === g.keyZ) {
                g.hasKey = true;
                key.visible = false;
                g.score += 50;
                (door.material as THREE.MeshLambertMaterial).color.set(COLOURS.doorOpen);
                sfx.win();
              }
              if (g.hasKey && x === SIZE - 2 && z === SIZE - 2) {
                // Out! A new maze, a bonus for the torch left, and a little more torch.
                g.mazes += 1;
                g.score += 100 + Math.floor(g.torch) * 2;
                g.torch = Math.min(TORCH.max, g.torch + TORCH.door);
                g.level += 1;
                g.build = true;
                sfx.win();
              }
            };

            return (dt) => {
              const g = game.current;
              if (g.build) {
                g.build = false;
                layout();
              }
              g.t += dt;
              g.torch -= dt;
              g.hurt = Math.max(0, g.hurt - dt);
              if (g.torch <= 0) end();

              // Moving: a swipe, a tap on a side of the screen, or the arrows (each press is one step).
              const p = input.pointer;
              // The first frame only notes where the pointer is.
              g.last ??= { x: p.x, y: p.y };
              g.acc.x += p.dx;
              g.acc.y += p.dy;
              const released = (g.wasDown && !p.down) || (!p.down && (p.x !== g.last.x || p.y !== g.last.y || Math.hypot(g.acc.x, g.acc.y) > 0.1));
              if (released) {
                const swipe = Math.hypot(g.acc.x, g.acc.y) > 0.1;
                const v = swipe ? g.acc : { x: p.x, y: p.y };
                if (Math.abs(v.x) > Math.abs(v.y)) step(v.x < 0 ? DIRS.left : DIRS.right);
                else step(v.y > 0 ? DIRS.up : DIRS.down);
              }
              if (!p.down) g.acc = { x: 0, y: 0 };
              g.wasDown = p.down;
              g.last = { x: p.x, y: p.y };
              for (const name of ["up", "down", "left", "right"] as const) {
                if (input[name] && !g.held[name]) step(DIRS[name]);
                g.held[name] = input[name];
              }

              // The player glides to their cell.
              const target = at(g.x, g.z);
              player.position.lerp(target, Math.min(1, dt * 14));
              player.visible = g.hurt <= 0 || Math.floor(g.t * 12) % 2 === 0;
              key.rotation.y += dt * 2;
              for (const gem of gems) gem.mesh.rotation.y += dt * 2;

              // Guards walk back and forth along their corridor, a little faster as time goes on.
              const pace = 1.6 + g.level * 0.4 + Math.min(1.2, g.t / 40);
              for (const guard of guards) {
                if (!guard.active) continue;
                guard.at += guard.dir * pace * dt;
                const last = guard.cells.length - 1;
                if (guard.at >= last || guard.at <= 0) {
                  guard.at = Math.max(0, Math.min(last, guard.at));
                  guard.dir = -guard.dir;
                }
                const i = Math.floor(guard.at);
                const a = at(guard.cells[i].x, guard.cells[i].z);
                const b = at(guard.cells[Math.min(last, i + 1)].x, guard.cells[Math.min(last, i + 1)].z);
                guard.mesh.position.lerpVectors(a, b, guard.at - i);
                guard.mesh.lookAt(guard.dir > 0 ? b : a);
                if (guard.mesh.position.distanceTo(player.position) < CELL * 0.55) hit();
              }

              // Spikes rise for a second, then sink, on a beat. They tremble just before they rise.
              for (const s of spikes) {
                if (!s.active) continue;
                const beat = (g.t + s.phase) % 2.4;
                const up = beat < 1;
                s.mesh.position.y = up ? 0 : beat > 2 ? -0.45 + Math.sin(g.t * 40) * 0.04 : -0.6;
                if (up && s.x === g.x && s.z === g.z) hit();
              }

              probe(Math.floor(g.score), player.position.x, player.position.z, pace);
              camera.position.x += (player.position.x - camera.position.x) * Math.min(1, dt * 4);
              camera.position.y = 11;
              camera.position.z += (player.position.z + 6 - camera.position.z) * Math.min(1, dt * 4);
              camera.lookAt(camera.position.x, 0, camera.position.z - 6);
            };
          }}
        />
        <Hud3D read={() => ({ score: game.current.score, best, lives: game.current.lives, label: "Torch " + Math.max(0, Math.ceil(game.current.torch)) + "s" + (game.current.hasKey ? "  ·  Key ✓" : "") })} />
        <TopThree board={board} className="absolute right-2 top-2" />
        {screen === "start" && (
          <div className="absolute inset-x-4 bottom-6 space-y-3 rounded-2xl bg-card/95 p-4 text-center shadow-lg">
            <h2 className="text-lg font-semibold">{GAME_NAME}</h2>
            <p className="text-sm text-muted-foreground">Swipe or tap a side to step. Find the key, then the door, before your torch burns out.</p>
            {tip && <p className="text-sm">Gems add time to the torch. Mind the guards and the spikes.</p>}
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
              { label: "Mazes escaped", value: result.mazes },
              { label: "Gems", value: result.gems },
            ]}
            onAgain={start}
            shareText={"I scored " + result.score + " in " + GAME_NAME}
          >
            <PostScore board={board} score={result.score} />
          </GameOver>
        )}
      </div>
      {screen !== "playing" && <GameSettings />}
      <Leaderboard board={board} title="Top escapers" />
    </div>
  );
}
`;

export const mazeEscape: GameTemplate = {
  id: "maze-escape",
  name: "Maze escape",
  dims: "3d",
  style: "action",
  fits: "3D maze, dungeon or escape-room games: find a key or an exit against the clock, avoid guards and traps, collect treasure on the way",
  kits: ["three-d", "game-2d"],
  files: { "src/App.tsx": appFor("./play/look", "GAME_NAME"), "src/play/Game.tsx": GAME, "src/play/look.ts": LOOK },
  leaderboard: true,
  title: { from: "./play/look", name: "GAME_NAME" },
  brief: `This game starts from GoodBuild's Maze escape template, a working, tested 3D game: src/play/Game.tsx (the maze, its rules and the game in Scene3D), src/play/look.ts (the name, colours, the cell size and one function per thing, built from three.js shapes) and src/App.tsx. Reshape it to the plan instead of starting again:
- Rename it (GAME_NAME, BEST_KEY in look.ts) and restyle the walls, the player, the guards and the treasure to the plan's look.
- Change the rules the plan asks for (maze SIZE, TORCH, GEMS, SPIKES, how guards move), and keep declareGame listing exactly the kinds the game has, with spawned(kind) when one appears. Every kind must show up within the first 15 seconds: layout() places them all at the start of each maze.
- ${KEEP_3D}`,
};
