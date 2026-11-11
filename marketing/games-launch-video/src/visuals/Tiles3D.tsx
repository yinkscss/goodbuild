import React, { useMemo } from "react";
import { ThreeCanvas } from "@remotion/three";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { Easing, interpolate } from "remotion";
import { C } from "../theme";
import { clamp } from "../fx";
import type { VisualProps } from "../scenes/Card";

/** The 2x2 glass-tile logo, built in three.js and spun in real 3D. */
const Env: React.FC = () => {
  const { gl, scene } = useThree();
  useMemo(() => {
    const pm = new THREE.PMREMGenerator(gl);
    scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  }, [gl, scene]);
  return null;
};

const TILES: { pos: [number, number]; color: string; delay: number }[] = [
  { pos: [-0.62, 0.62], color: "#FFFFFF", delay: 0 },
  { pos: [0.62, 0.62], color: C.lilac, delay: 2 },
  { pos: [-0.62, -0.62], color: "#B49AF0", delay: 4 },
  { pos: [0.62, -0.62], color: C.pink, delay: 6 },
];

const Scene: React.FC<{ f: number }> = ({ f }) => {
  const geo = useMemo(() => new RoundedBoxGeometry(1.05, 1.05, 0.42, 6, 0.2), []);
  const spinY = -0.9 + f * 0.075 + interpolate(f, [0, 10], [-2.2, 0], { ...clamp, easing: Easing.out(Easing.cubic) });
  const tiltX = 0.38 + Math.sin(f / 14) * 0.18;
  return (
    <>
      <Env />
      <ambientLight intensity={0.5} />
      <directionalLight position={[3, 4, 5]} intensity={2.2} color="#ffffff" />
      <pointLight position={[-4, -1, 3]} intensity={30} color={C.pink} />
      <pointLight position={[4, -2, 2]} intensity={24} color={C.lilac} />
      <group rotation={[tiltX, spinY, 0.12]}>
        {TILES.map((t, i) => {
          const p = interpolate(f, [t.delay, t.delay + 8], [0, 1], { ...clamp, easing: Easing.out(Easing.back(2.2)) });
          const z = interpolate(f, [t.delay, t.delay + 8], [3.5, 0], { ...clamp, easing: Easing.out(Easing.cubic) });
          const breathe = 1 + 0.06 * Math.sin(f / 9 + i);
          return (
            <mesh key={i} geometry={geo} position={[t.pos[0] * breathe, t.pos[1] * breathe, z]} scale={p}>
              <meshPhysicalMaterial
                color={t.color}
                roughness={0.08}
                metalness={0.05}
                clearcoat={1}
                clearcoatRoughness={0.05}
                iridescence={1}
                iridescenceIOR={1.6}
                transmission={0.35}
                thickness={0.6}
                transparent
                opacity={0.94}
                emissive={t.color}
                emissiveIntensity={0.18}
              />
            </mesh>
          );
        })}
      </group>
    </>
  );
};

export const Tiles3D: React.FC<VisualProps> = ({ f, w, h }) => {
  const s = Math.floor(Math.min(w, h));
  return (
    <div style={{ width: s, height: s, position: "relative" }}>
      <div style={{ position: "absolute", inset: "12%", borderRadius: "50%", background: `radial-gradient(circle, ${C.pink}55, transparent 65%)`, filter: "blur(30px)" }} />
      <ThreeCanvas width={s} height={s} camera={{ position: [0, 0, 4.6], fov: 40 }} gl={{ antialias: true, alpha: true }}>
        <Scene f={f} />
      </ThreeCanvas>
    </div>
  );
};
