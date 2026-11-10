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

export interface SceneContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  canvas: HTMLCanvasElement;
}

/** Called every frame: dt is seconds since the last frame, time is seconds since the start. */
export type FrameFn = (dt: number, time: number) => void;

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
 * pausing in a hidden tab, drag-to-look controls (orbit) and cleaning up are done here, so don't
 * create a WebGLRenderer or a requestAnimationFrame loop in the app.
 *
 * Give it a height with className (for example "h-[70vh] w-full"): a canvas in a box with no height is invisible.
 */
export function Scene3D({
  onReady,
  className = "h-[70vh] w-full",
  background = "#0b1020",
  orbit = false,
  fallback = "3D isn't available on this device.",
}: {
  onReady: (ctx: SceneContext) => FrameFn | void;
  className?: string;
  background?: string;
  /** Let the person drag to turn the view and pinch to zoom. */
  orbit?: boolean;
  fallback?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const ready = useRef(onReady);
  ready.current = onReady;
  const [supported] = useState(() => hasWebGL());

  useEffect(() => {
    const host = box.current;
    if (!host || !supported) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    } catch {
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(background);
    renderer.domElement.style.display = "block";
    renderer.domElement.style.touchAction = orbit ? "none" : "auto";
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
    camera.position.set(0, 1.5, 5);
    const controls = orbit ? new OrbitControls(camera, renderer.domElement) : null;
    if (controls) {
      controls.enableDamping = true;
      controls.enablePan = false;
    }
    const frame = ready.current({ scene, camera, renderer, canvas: renderer.domElement }) as FrameFn | undefined;

    const resize = () => {
      const w = Math.max(1, host.clientWidth);
      const h = Math.max(1, host.clientHeight);
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);

    const clock = new THREE.Clock();
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (document.visibilityState !== "visible") return;
      const dt = Math.min(clock.getDelta(), 0.1);
      controls?.update();
      frame?.(dt, clock.elapsedTime);
      renderer.render(scene, camera);
    };
    loop();

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      controls?.dispose();
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
      renderer.domElement.remove();
    };
  }, [supported, background, orbit]);

  if (!supported) return <div className={\`\${className} grid place-items-center rounded-xl border bg-muted p-6 text-center text-sm text-muted-foreground\`}>{fallback}</div>;
  return <div ref={box} className={\`\${className} overflow-hidden rounded-xl\`} />;
}
`;

const GUIDE = `3D scenes and games, on three.js. The kit's file is src/three/Scene3D.tsx: use it, don't rewrite it.
- Scene3D is the screen. Give it onReady({ scene, camera, renderer }): add meshes and lights, place the camera, and return a frame function (dt, time) => void that moves things. Pass orbit for drag-to-look and pinch-to-zoom (a viewer, a gallery, a globe). Give it a height with className, for example "h-[70vh] w-full". It handles sizing, the pixel ratio, pausing in a hidden tab, cleaning up, and a plain message on a device with no WebGL. Never create a WebGLRenderer or your own requestAnimationFrame loop in the app, and never use react-three-fiber (it isn't available).
- Import three as \`import * as THREE from "three"\`. Helpers come from "three/examples/jsm/..." (OrbitControls is already in Scene3D). Nothing else is installed: no physics engine, no loaders for outside files.
- No outside files yet. Build everything from three.js shapes (BoxGeometry, SphereGeometry, TorusKnotGeometry, ExtrudeGeometry, Shape, LatheGeometry, Points) and make textures on a canvas (CanvasTexture) or with vertex colors. Don't load .glb models or image URLs from anywhere: the page can't reach other sites, and uploaded 3D models aren't supported yet. If the person wants a specific model, say it comes later and build a stand-in from shapes.
- Phones first. Keep the scene to about 100,000 triangles. Use InstancedMesh for many copies of one thing (coins, trees, stars). Prefer MeshStandardMaterial or MeshLambertMaterial with one or two lights; no real-time shadows unless the person asked, and then one light with a 1024 map. Never create objects inside the frame function: make them once in onReady and change their position, rotation and scale. Multiply speeds by dt.
- Games: keep the game's state in a plain object in a useRef, never in React state that changes every frame. React state is only for the screen (start, playing, over) and for numbers shown outside the canvas, set when they change. Controls must work by touch: on-screen buttons or a drag on the canvas (pointerdown, pointermove) as well as the keyboard. Add a Start button and a visible score or goal. The 2D games kit's sound and storage helpers (src/game/) are available if the project has that kit.
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
    if (/\b(GLTFLoader|FBXLoader|OBJLoader|DRACOLoader|TextureLoader|ImageBitmapLoader|FileLoader)\b/.test(content) || /\b(@react-three|react-three-fiber)\b/.test(content)) {
      issues.push({ file, line: find(/\b(GLTFLoader|FBXLoader|OBJLoader|DRACOLoader|TextureLoader|ImageBitmapLoader|FileLoader|@react-three|react-three-fiber)\b/), source: "guardrail", message: "Loading models or images from files isn't available in 3D apps yet, and react-three-fiber isn't installed. Build the scene from three.js shapes and make textures with CanvasTexture." });
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
  guide: GUIDE,
  preview: "own",
  checks: threeDChecks,
};
