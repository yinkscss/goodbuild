export interface Tilt {
  /** Degrees around the X axis (positive tips the top away). */
  rx: number;
  /** Degrees around the Y axis (positive turns the right side away). */
  ry: number;
}

export interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Map a pointer position inside a box to a small 3D tilt, so the hero render
 * leans toward the cursor. Clamped to ±max degrees; the centre is level.
 */
export function tiltFromPointer(x: number, y: number, rect: RectLike, max = 6): Tilt {
  if (rect.width <= 0 || rect.height <= 0) return { rx: 0, ry: 0 };
  const nx = Math.min(1, Math.max(-1, ((x - rect.left) / rect.width) * 2 - 1));
  const ny = Math.min(1, Math.max(-1, ((y - rect.top) / rect.height) * 2 - 1));
  return { rx: round(-ny * max), ry: round(nx * max) };
}

/** Ease a value toward a target; used per animation frame for smooth follow. */
export function approach(current: number, target: number, factor = 0.12): number {
  const next = current + (target - current) * factor;
  return Math.abs(target - next) < 0.01 ? target : next;
}

function round(n: number) {
  return Math.round(n * 100) / 100 || 0;
}
