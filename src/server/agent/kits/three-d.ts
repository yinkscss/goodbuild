import type { CheckIssue } from "../checks";

import type { Kit } from "./registry";

/**
 * The 3D kit (D77): scenes, viewers and 3D games, on three.js with no wrapper library.
 *
 * Why plain three.js and not react-three-fiber and drei: two more packages (and drei is large), a
 * React-reconciler layer to keep in step with React 18, and a style the builder gets wrong more
 * often than the plain scene graph it knows well. The kit's `Scene3D` does the parts that go wrong
 * on a phone (sizing, pixel ratio, pausing, cleaning up, no-WebGL), and the builder writes the scene.
 *
 * three.js is too big for the in-browser bundler, so these projects get GoodBuild's own build
 * preview (D69) through `preview: "own"`. Nobody is asked.
 */

const SCENE_3D = `import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

/** What the player is pressing right now. Read it in the frame function; never store it in React state. */
export interface SceneInput {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  /** Space, Enter or the on-screen action button. */
  action: boolean;
  /** True only on the frame the action started: jump, shoot, start. */
  actionPressed: boolean;
  /**
   * The finger or mouse on the scene. x and y run from -1 to 1 with y up, which is what
   * THREE.Raycaster.setFromCamera takes. dx and dy are how far it moved since the last frame,
   * in the same units: use them to steer by dragging.
   */
  pointer: { x: number; y: number; dx: number; dy: number; down: boolean };
}

export interface SceneContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  canvas: HTMLCanvasElement;
  /** Keys, on-screen buttons and the pointer, already listening and cleaned up for you. */
  input: SceneInput;
  /** Run this when the scene goes away: stop a timer or remove a listener you added yourself. */
  onCleanup: (fn: () => void) => void;
}

/** Called every frame: dt is seconds since the last frame, time is seconds since the start. */
export type FrameFn = (dt: number, time: number) => void;

export type ControlButton = "left" | "right" | "up" | "down" | "action";

const KEYS: Record<string, ControlButton> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
  a: "left",
  d: "right",
  w: "up",
  s: "down",
  " ": "action",
  Enter: "action",
};
const LABELS: Record<ControlButton, string> = { left: "◀", right: "▶", up: "▲", down: "▼", action: "●" };
const NAMES: Record<ControlButton, string> = { left: "Left", right: "Right", up: "Up", down: "Down", action: "Action" };

function hasWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

/**
 * A 3D scene that fills its box. Build the scene in onReady (add meshes, lights, move the camera) and
 * return a frame function to animate it. onReady runs once. Sizing, a sharp but capped pixel ratio,
 * pausing in a hidden tab, drag-to-look controls (orbit), keyboard and touch input and cleaning up
 * are done here, so don't create a WebGLRenderer, a requestAnimationFrame loop or window key
 * listeners in the app.
 *
 * Give it a height with className (for example "h-[70vh] w-full"): a canvas in a box with no height is invisible.
 */
export function Scene3D({
  onReady,
  className = "h-[70vh] w-full",
  background = "#0b1020",
  orbit = false,
  touch = false,
  paused = false,
  controls = [],
  fallback = "3D isn't available on this device.",
}: {
  onReady: (ctx: SceneContext) => FrameFn | void;
  className?: string;
  background?: string;
  /** Let the person drag to turn the view and pinch to zoom. */
  orbit?: boolean;
  /** The scene is steered by a finger on it (a game): stops the page scrolling under that finger. */
  touch?: boolean;
  /** Hold the scene still (a start or game-over screen is up). The keyboard goes back to the page. */
  paused?: boolean;
  /** On-screen buttons for phones, under the scene. They set the same input the keys do. */
  controls?: ControlButton[];
  fallback?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const ready = useRef(onReady);
  ready.current = onReady;
  const pausedRef = useRef(paused);
  const [supported, setSupported] = useState(() => hasWebGL());
  const input = useRef<SceneInput>({ left: false, right: false, up: false, down: false, action: false, actionPressed: false, pointer: { x: 0, y: 0, dx: 0, dy: 0, down: false } });
  const held = useRef({ key: false, button: false });

  const setAction = () => {
    const state = input.current;
    const now = held.current.key || held.current.button;
    if (now && !state.action) state.actionPressed = true;
    state.action = now;
  };
  const letGo = () => {
    const state = input.current;
    state.left = state.right = state.up = state.down = false;
    state.pointer.down = false;
    held.current.key = held.current.button = false;
    state.action = state.actionPressed = false;
  };

  useEffect(() => {
    pausedRef.current = paused;
    // Nothing held when a round ends carries into the next one.
    if (paused) letGo();
  }, [paused]);

  useEffect(() => {
    const host = box.current;
    if (!host || !supported) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    } catch {
      // The browser said it had WebGL and then couldn't start it: show the plain message.
      setSupported(false);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(background);
    const canvas = renderer.domElement;
    canvas.style.display = "block";
    canvas.style.touchAction = orbit || touch ? "none" : "auto";
    host.appendChild(canvas);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
    camera.position.set(0, 1.5, 5);
    const orbiting = orbit ? new OrbitControls(camera, canvas) : null;
    if (orbiting) {
      orbiting.enableDamping = true;
      orbiting.enablePan = false;
    }

    const state = input.current;
    const onKey = (down: boolean) => (e: KeyboardEvent) => {
      const button = KEYS[e.key.length === 1 ? e.key.toLowerCase() : e.key];
      if (!button || pausedRef.current || e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable)) return;
      e.preventDefault();
      if (button === "action") {
        held.current.key = down;
        setAction();
      } else state[button] = down;
    };
    const keyDown = onKey(true);
    const keyUp = onKey(false);
    const place = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1;
      const y = -(((e.clientY - rect.top) / Math.max(rect.height, 1)) * 2 - 1);
      if (state.pointer.down) {
        state.pointer.dx += x - state.pointer.x;
        state.pointer.dy += y - state.pointer.y;
      }
      state.pointer.x = x;
      state.pointer.y = y;
    };
    const pointerDown = (e: PointerEvent) => {
      state.pointer.down = false;
      place(e);
      state.pointer.down = true;
    };
    const pointerUp = () => {
      state.pointer.down = false;
    };
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    canvas.addEventListener("pointerdown", pointerDown);
    canvas.addEventListener("pointermove", place);
    window.addEventListener("pointerup", pointerUp);
    window.addEventListener("pointercancel", pointerUp);
    // A key held while the window loses focus never sends its keyup.
    window.addEventListener("blur", letGo);

    const cleanups: Array<() => void> = [];
    const frame = ready.current({ scene, camera, renderer, canvas, input: state, onCleanup: (fn) => void cleanups.push(fn) }) as FrameFn | undefined;

    const resize = () => {
      const w = Math.max(1, host.clientWidth);
      const h = Math.max(1, host.clientHeight);
      renderer.setSize(w, h, false);
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);

    const clock = new THREE.Clock();
    let raf = 0;
    let time = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(clock.getDelta(), 0.1);
      if (document.visibilityState !== "visible") return;
      orbiting?.update();
      if (!pausedRef.current) {
        time += dt;
        frame?.(dt, time);
        state.actionPressed = false;
        state.pointer.dx = state.pointer.dy = 0;
      }
      renderer.render(scene, camera);
    };
    loop();

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      orbiting?.dispose();
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
      canvas.removeEventListener("pointerdown", pointerDown);
      canvas.removeEventListener("pointermove", place);
      window.removeEventListener("pointerup", pointerUp);
      window.removeEventListener("pointercancel", pointerUp);
      window.removeEventListener("blur", letGo);
      for (const fn of cleanups) {
        try {
          fn();
        } catch {
          /* one failed cleanup must not stop the rest */
        }
      }
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        mesh.geometry?.dispose();
        const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
        for (const m of mats) {
          for (const v of Object.values(m)) if (v instanceof THREE.Texture) v.dispose();
          m.dispose();
        }
      });
      renderer.dispose();
      canvas.remove();
    };
  }, [supported, background, orbit, touch]);

  const press = (button: ControlButton, down: boolean) => {
    if (button === "action") {
      held.current.button = down;
      setAction();
    } else input.current[button] = down;
  };

  if (!supported) return <div className={\`\${className} grid place-items-center rounded-xl border bg-muted p-6 text-center text-sm text-muted-foreground\`}>{fallback}</div>;
  const view = <div ref={box} className={\`\${className} overflow-hidden rounded-xl\`} />;
  // No wrapper without buttons, so a height given as a share of the parent ("h-full") still works.
  if (controls.length === 0) return view;
  return (
    <div>
      {view}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginTop: 12 }}>
        <div style={{ display: "flex", gap: 8 }}>
          {controls.filter((c) => c !== "action").map((c) => (
            <ControlKey key={c} button={c} press={press} />
          ))}
        </div>
        {controls.includes("action") && <ControlKey button="action" press={press} />}
      </div>
    </div>
  );
}

function ControlKey({ button, press }: { button: ControlButton; press: (button: ControlButton, down: boolean) => void }) {
  return (
    <button
      type="button"
      aria-label={NAMES[button]}
      onPointerDown={(e) => {
        e.preventDefault();
        press(button, true);
      }}
      onPointerUp={() => press(button, false)}
      onPointerLeave={() => press(button, false)}
      onPointerCancel={() => press(button, false)}
      onContextMenu={(e) => e.preventDefault()}
      className="grid size-14 place-items-center rounded-full bg-card text-xl text-foreground shadow active:bg-muted"
      style={{ touchAction: "none", userSelect: "none", WebkitUserSelect: "none" }}
    >
      {LABELS[button]}
    </button>
  );
}
`;

const GUIDE = `3D scenes and games, on three.js. The kit's file is src/three/Scene3D.tsx: use it, don't rewrite it.
- Scene3D is the screen. Give it onReady({ scene, camera, renderer }): add meshes and lights, place the camera, and return a frame function (dt, time) => void that moves things. Pass orbit for drag-to-look and pinch-to-zoom (a viewer, a gallery, a globe). Give it a height with className, for example "h-[70vh] w-full". It handles sizing, the pixel ratio, pausing in a hidden tab, cleaning up, and a plain message on a device with no WebGL. Never create a WebGLRenderer or your own requestAnimationFrame loop in the app, and never use react-three-fiber (it isn't available).
- Import three as \`import * as THREE from "three"\`. Helpers come from "three/examples/jsm/..." (OrbitControls is already in Scene3D). Nothing else is installed: no physics engine.
- Files: only the ones the person uploaded (listed in the context under Uploaded assets). A 3D model is a .glb: load it with GLTFLoader from "three/examples/jsm/loaders/GLTFLoader.js", with the path assets.<key>.src or a literal "/assets/<name>.glb", inside onReady, and add gltf.scene when it arrives (show the scene's lights and a short "Loading" message until then; keep the camera sensible for a model of unknown size by fitting it: compute a Box3, centre it, and set the camera distance from its size). An uploaded image can be a texture with TextureLoader and the same kind of path. Never load from a web address: the page can't reach other sites. No FBX, OBJ or Draco. If the person wants a model they haven't uploaded, build a stand-in from three.js shapes and say they can upload a .glb to replace it. Textures can also be made on a canvas (CanvasTexture).
- Phones first. Keep the scene to about 100,000 triangles. Use InstancedMesh for many copies of one thing (coins, trees, stars). Prefer MeshStandardMaterial or MeshLambertMaterial with one or two lights; no real-time shadows unless the person asked, and then one light with a 1024 map. Never create objects inside the frame function: make them once in onReady and change their position, rotation and scale. Multiply speeds by dt.
- Input comes from Scene3D: onReady's context has input, the same shape as the 2D kit's. input.left/right/up/down are held (arrow keys, WASD, or the on-screen buttons from controls={["left","right","action"]}); input.action is held and input.actionPressed is true for one frame (jump, shoot); input.pointer is the finger or mouse, x and y from -1 to 1 (to find what was tapped: raycaster.setFromCamera(new THREE.Vector2(input.pointer.x, input.pointer.y), camera)), with dx and dy for steering by dragging and down while it is pressed. Read input inside the frame function. Never add your own keydown or pointer listeners to window: they outlive the scene and fire twice. For anything else you start yourself (a timer, a listener), hand its undo to onCleanup(() => ...).
- Games: keep the game's state in a plain object in a useRef, never in React state that changes every frame. React state is only for the screen (start, playing, over) and for numbers shown outside the canvas, set when they change. Every game must be playable by touch: pass controls for on-screen buttons, or pass touch and steer with input.pointer (touch stops the page scrolling under the finger). Pass paused while the start or game-over screen is up: the scene holds still, time stops, and the keyboard goes back to the page so Enter presses Play. Add a Start button and a visible score or goal. The 2D games kit's sound, storage and juice helpers (src/game/) are available if the project has that kit: call add_kit("game-2d") for sound effects and a saved best score.
- Make it read as 3D: a ground or horizon for scale, fog that matches the background (scene.fog = new THREE.Fog(background, near, far)) so far things fade instead of popping, a camera that follows a little behind what the player steers (move it toward its target by a share of the distance each frame), and movement on what is collected or dangerous (a slow spin, a bob). A hit or a pickup needs feedback: a flash of colour on the material, a quick change of scale, a sound.
- Around the canvas, the app is normal React: a title, a short line about what to do, buttons, and the wallet parts the app needs. Tokens, prizes and entry fees follow the games guide: never a game of chance for money.
- Colours: pick a palette for the scene (three or four colours plus a background) and use it everywhere, with a light source that gives the shapes a clear lit side and a shaded side. A grey default-material scene looks unfinished.`;

export function threeDChecks(files: Record<string, string>): CheckIssue[] {
  const issues: CheckIssue[] = [];
  for (const [file, content] of Object.entries(files)) {
    if (!/^src\/.*\.(tsx?|jsx?)$/.test(file) || file.startsWith("src/lib/") || file === "src/three/Scene3D.tsx") continue;
    const find = (re: RegExp) => content.slice(0, Math.max(0, content.search(re))).split("\n").length;
    if (/new\s+(THREE\.)?WebGLRenderer\s*\(/.test(content)) {
      issues.push({ file, line: find(/new\s+(THREE\.)?WebGLRenderer\s*\(/), source: "guardrail", message: "Don't create a WebGLRenderer here. Use Scene3D (src/three/Scene3D.tsx): it sizes, pauses and cleans up the renderer for you." });
    }
    if (/\b(FBXLoader|OBJLoader|DRACOLoader|ImageBitmapLoader|FileLoader|KTX2Loader|@react-three|react-three-fiber)\b/.test(content)) {
      issues.push({ file, line: find(/\b(FBXLoader|OBJLoader|DRACOLoader|ImageBitmapLoader|FileLoader|KTX2Loader|@react-three|react-three-fiber)\b/), source: "guardrail", message: "Only GLTFLoader (for an uploaded .glb) and TextureLoader (for an uploaded image) are available, and react-three-fiber isn't installed. Build the rest from three.js shapes and CanvasTexture." });
    }
    // A model or texture comes from the person's uploads, at /assets/, never from another site.
    for (const m of content.matchAll(/\.load\(\s*["'`](https?:\/\/|\/\/)/g)) {
      issues.push({ file, line: content.slice(0, m.index).split("\n").length, source: "guardrail", message: "A model or image can't be loaded from a web address: the page can't reach other sites. Use an uploaded file at /assets/<name>, or build it from shapes." });
    }
  }
  return issues;
}

export const threeD: Kit = {
  id: "three-d",
  title: "3D",
  when: "a 3D scene, viewer or game: a spinning product or NFT viewer, a 3D gallery, a globe, a racing, flying or maze game, anything the person describes as 3D or WebGL",
  keywords: /\b(3-?d|three\.?js|webgl|metaverse|virtual (?:world|gallery|room)|voxel|first[- ]person|nft gallery|product viewer|spinning (?:cube|globe|logo)|globe)\b/i,
  packages: { three: "0.187.0" },
  files: { "src/three/Scene3D.tsx": SCENE_3D },
  // The first Scene3D (D77) had no input, no pause and no cleanup hook (D85). Today's takes the same props.
  superseded: { "src/three/Scene3D.tsx": ["aac2febe6c91591ff6e969dea761f67ca6717d1c880fb7a275caf5da9f004f23"] },
  guide: GUIDE,
  preview: "own",
  checks: threeDChecks,
  replaces: ["@react-three/fiber", "@react-three/drei", "react-three-fiber", "babylonjs", "@babylonjs/core"],
};
