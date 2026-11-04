/**
 * Hero "building" visual (DESIGN_SYSTEM §8 fix 1): chrome and violet blocks stacked
 * into a contract shape, with the final block dropping in and snapping into place.
 * Pure SVG (no image asset), drawn isometrically. Shading colours are illustration
 * tones derived from the violet/ink tokens; no pink, so the screen keeps its pink budget.
 */

type Material = "chrome" | "violet";
interface Block {
  x: number;
  y: number;
  z: number;
  m: Material;
}

const S = 48; // block edge in px
const C = Math.cos(Math.PI / 6);

function project(x: number, y: number, z: number): [number, number] {
  return [(x - y) * C * S, (x + y) * 0.5 * S - z * S];
}

function poly(points: Array<[number, number, number]>): string {
  return points
    .map(([x, y, z]) => project(x, y, z))
    .map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`)
    .join(" ");
}

function faces({ x, y, z }: Pick<Block, "x" | "y" | "z">) {
  return {
    top: poly([[x, y, z + 1], [x + 1, y, z + 1], [x + 1, y + 1, z + 1], [x, y + 1, z + 1]]),
    left: poly([[x, y + 1, z], [x + 1, y + 1, z], [x + 1, y + 1, z + 1], [x, y + 1, z + 1]]),
    right: poly([[x + 1, y, z], [x + 1, y + 1, z], [x + 1, y + 1, z + 1], [x + 1, y, z + 1]]),
    outline: poly([
      [x, y, z + 1], [x + 1, y, z + 1], [x + 1, y, z], [x + 1, y + 1, z], [x, y + 1, z], [x, y + 1, z + 1],
    ]),
  };
}

const grid = (z: number, cells: Array<[number, number]>, m: Material): Block[] =>
  cells.map(([x, y]) => ({ x, y, z, m }));

const BLOCKS: Block[] = [
  ...grid(0, [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1], [0, 2], [1, 2], [2, 2]], "chrome"),
  ...grid(1, [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [0, 2]], "violet"),
  ...grid(2, [[0, 0], [1, 0], [0, 1]], "violet"),
  ...grid(3, [[0, 0]], "chrome"),
];
const SNAP: Block = { x: 1, y: 1, z: 2, m: "violet" };

// Painter's order for unit voxels: back (small x+y+z) first.
const depth = (b: Block) => b.x + b.y + b.z;
const ordered = [...BLOCKS].sort((a, b) => depth(a) - depth(b));

function Cube({ b }: { b: Block }) {
  const f = faces(b);
  return (
    <g>
      <polygon points={f.left} fill={`url(#gb-${b.m}-left)`} />
      <polygon points={f.right} fill={`url(#gb-${b.m}-right)`} />
      <polygon points={f.top} fill={`url(#gb-${b.m}-top)`} stroke="#fff" strokeOpacity={0.55} strokeWidth={1} />
    </g>
  );
}

export function BuildingBlocks({ className }: { className?: string }) {
  // Bounds: x−y spans −3..3, height from the crown (z=4) to the front corner.
  const minX = -3 * C * S - 8;
  const width = 6 * C * S + 16;
  const minY = -4 * S - 70; // headroom for the dropping block
  const height = 3 * S - minY + 60;
  const snap = faces(SNAP);
  const floor = project(1.5, 1.5, 0);

  return (
    <svg
      viewBox={`${minX.toFixed(0)} ${minY.toFixed(0)} ${width.toFixed(0)} ${height.toFixed(0)}`}
      className={className}
      overflow="visible"
      role="img"
      aria-label="Chrome and violet blocks snapping together into a smart contract"
    >
      <defs>
        <linearGradient id="gb-chrome-top" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset="1" stopColor="#E6E3EC" />
        </linearGradient>
        <linearGradient id="gb-chrome-left" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#DAD6E3" />
          <stop offset="1" stopColor="#ABA5BB" />
        </linearGradient>
        <linearGradient id="gb-chrome-right" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#8F889F" />
          <stop offset="1" stopColor="#5D5670" />
        </linearGradient>
        <linearGradient id="gb-violet-top" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#D9C2EE" />
          <stop offset="1" stopColor="#9465C0" />
        </linearGradient>
        <linearGradient id="gb-violet-left" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7D48AB" />
          <stop offset="1" stopColor="#592E81" />
        </linearGradient>
        <linearGradient id="gb-violet-right" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#47225F" />
          <stop offset="1" stopColor="#1A0D26" />
        </linearGradient>
        <radialGradient id="gb-floor">
          <stop offset="0" stopColor="#592E81" stopOpacity="0.28" />
          <stop offset="1" stopColor="#592E81" stopOpacity="0" />
        </radialGradient>
        <filter id="gb-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="10" />
        </filter>
      </defs>

      <ellipse cx={floor[0]} cy={floor[1] + S * 1.75} rx={S * 2.55} ry={S * 0.55} fill="url(#gb-floor)" />

      {ordered
        .filter((b) => depth(b) <= depth(SNAP))
        .map((b) => (
          <Cube key={`${b.x}${b.y}${b.z}`} b={b} />
        ))}

      {/* Target slot: dashed ghost and a soft glow under the landing block. */}
      <polygon points={snap.outline} fill="none" stroke="#592E81" strokeOpacity={0.5} strokeWidth={1.5} strokeDasharray="5 5" />
      <polygon points={snap.top} fill="#592E81" opacity={0.35} filter="url(#gb-glow)" />

      <g className="animate-snap motion-reduce:animate-none" style={{ transformBox: "view-box" }}>
        <Cube b={SNAP} />
      </g>

      {/* Blocks in front of the snap slot are drawn after it. */}
      {ordered
        .filter((b) => depth(b) > depth(SNAP))
        .map((b) => (
          <Cube key={`f${b.x}${b.y}${b.z}`} b={b} />
        ))}
    </svg>
  );
}
