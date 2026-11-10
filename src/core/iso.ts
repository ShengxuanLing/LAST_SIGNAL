// Isometric projection utilities.
// We use "iso world space": a point (x, y) maps to screen via the diamond projection.
// tileWidth x tileHeight default to 64 x 32.

import { Vec2 } from '../types';

export class IsoMath {
  static TILE_W = 64;
  static TILE_H = 32;

  constructor(public tileW = IsoMath.TILE_W, public tileH = IsoMath.TILE_H) {}

  /** Project a world point to screen coordinates. */
  toScreen(x: number, y: number, z = 0): Vec2 {
    return {
      x: (x - y) * (this.tileW / 2),
      y: (x + y) * (this.tileH / 2) - z
    };
  }

  /** Inverse: screen point to world. z ignored (assumed ground). */
  toWorld(sx: number, sy: number): Vec2 {
    const tx = sx / (this.tileW / 2);
    const ty = sy / (this.tileH / 2);
    return {
      x: (tx + ty) / 2,
      y: (ty - tx) / 2
    };
  }

  /** Project a grid cell corner (gx, gy) to its top-center screen point. */
  toCellScreen(gx: number, gy: number, z = 0): Vec2 {
    return this.toScreen(gx, gy, z);
  }

  /** Sort key for depth ordering: entities deeper in the world (higher x+y) draw later. */
  static depthKey(x: number, y: number, z = 0): number {
    return x + y + z * 0.001; // z rarely affects depth ordering
  }
}

export function isoToScreen(x: number, y: number, tileW = 64, tileH = 32, z = 0): Vec2 {
  return {
    x: (x - y) * (tileW / 2),
    y: (x + y) * (tileH / 2) - z
  };
}

export function screenToIso(sx: number, sy: number, tileW = 64, tileH = 32): Vec2 {
  const tx = sx / (tileW / 2);
  const ty = sy / (tileH / 2);
  return { x: (tx + ty) / 2, y: (ty - tx) / 2 };
}
