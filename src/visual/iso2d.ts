// Small isometric drawing kit for Canvas 2D baking and Phaser Graphics.
// Purely geometric; shared by the environment baker and the Signal layer.
import type { Pt } from './themes';

/** World (cell units, z in unscaled px) -> screen px. Supplied by the host scene. */
export type Projector = (x: number, y: number, z?: number) => Pt;

export function makeProjector(base: (x: number, y: number) => Pt, scale: number): Projector {
  return (x, y, z = 0) => {
    const p = base(x, y);
    return { x: p.x, y: p.y - z * scale };
  };
}

/** Screen-space half-axes of an iso circle of world radius `r`. */
export function isoEllipse(r: number, scale: number): { rx: number; ry: number } {
  return { rx: 45.2548 * r * scale, ry: 22.6274 * r * scale };
}

export interface PathSink {
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
}

export function polyPath(g: PathSink, pts: readonly Pt[]): void {
  g.beginPath();
  g.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
  g.closePath();
}

/** Corners of the axis-aligned world rectangle [x0,x1]x[y0,y1] at height z. */
export function rectAt(P: Projector, x0: number, y0: number, x1: number, y1: number, z = 0): Pt[] {
  return [P(x0, y0, z), P(x1, y0, z), P(x1, y1, z), P(x0, y1, z)];
}

/** The three visible faces of an iso box (top, +x/SE face, +y/SW face). */
export function prismFaces(P: Projector, x0: number, y0: number, x1: number, y1: number, h: number, base = 0): {
  top: Pt[]; east: Pt[]; south: Pt[];
} {
  return {
    top: rectAt(P, x0, y0, x1, y1, base + h),
    east: [P(x1, y0, base), P(x1, y1, base), P(x1, y1, base + h), P(x1, y0, base + h)],
    south: [P(x0, y1, base), P(x1, y1, base), P(x1, y1, base + h), P(x0, y1, base + h)],
  };
}

export function lerpPt(a: Pt, b: Pt, t: number): Pt {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
