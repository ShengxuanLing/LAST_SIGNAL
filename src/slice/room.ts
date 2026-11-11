// VS-00 fixed room geometry. Pure data/helpers (no Phaser), so it is Node-testable.
// Cells are integer (i,j); positions are cell centers (i+0.5, j+0.5).

export interface Cell { x: number; y: number; }

export const ROOM = {
  width: 14,
  height: 10,
  wallX: 7,
  // The two door cells are a dynamic passable overlay, not static wall.
  doorCells: [{ x: 7, y: 4 }, { x: 7, y: 5 }] as Cell[],
  spawn: { x: 3.5, y: 5.5 },
  // Door receiver is the Jam target; the seal source is read-only and always present.
  receiver: { x: 7.5, y: 5.0 },
  source: { x: 7.5, y: 3.5 },
  sourceCell: { x: 7, y: 3 } as Cell,
  eastThresholdX: 8.0,
  exit: { x: 12.5, y: 5.5 },
  playerRadius: 0.35,
} as const;

/** Door opening rectangle in world units: cells (7,4) and (7,5). */
export const DOOR_RECT = { minX: 7, maxX: 8, minY: 4, maxY: 6 } as const;

export function isDoorCell(cx: number, cy: number): boolean {
  return ROOM.doorCells.some((c) => c.x === cx && c.y === cy);
}

export function isBorderWallCell(cx: number, cy: number): boolean {
  return cx <= 0 || cy <= 0 || cx >= ROOM.width - 1 || cy >= ROOM.height - 1;
}

export function isStaticWallCell(cx: number, cy: number): boolean {
  if (isBorderWallCell(cx, cy)) return true;
  return cx === ROOM.wallX && !isDoorCell(cx, cy);
}

/** Walkability for the slide-in collision. `doorPassable` comes from the rule model. */
export function isWalkableCell(cx: number, cy: number, doorPassable: boolean): boolean {
  if (cx < 0 || cy < 0 || cx >= ROOM.width || cy >= ROOM.height) return false;
  if (isBorderWallCell(cx, cy)) return false;
  if (cx === ROOM.wallX) return isDoorCell(cx, cy) ? doorPassable : false;
  return true;
}

export function distanceToReceiver(x: number, y: number): number {
  return Math.hypot(x - ROOM.receiver.x, y - ROOM.receiver.y);
}

export function distanceToSource(x: number, y: number): number {
  return Math.hypot(x - ROOM.source.x, y - ROOM.source.y);
}

/**
 * Occupancy uses the SAME AABB footprint as Scene.canStand: the player's square
 * [x-r,x+r] x [y-r,y+r] overlaps the door opening rectangle. This treats edges
 * and corners as occupied, so the door never closes on a player's body.
 */
export function isOccupyingDoor(x: number, y: number, radius = ROOM.playerRadius): boolean {
  const minX = x - radius;
  const maxX = x + radius;
  const minY = y - radius;
  const maxY = y + radius;
  return maxX >= DOOR_RECT.minX && minX <= DOOR_RECT.maxX && maxY >= DOOR_RECT.minY && minY <= DOOR_RECT.maxY;
}

export function canFit(x: number, y: number, walkable: (cx: number, cy: number) => boolean): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  const r = ROOM.playerRadius;
  return [[x, y], [x - r, y - r], [x + r, y - r], [x - r, y + r], [x + r, y + r]]
    .every(([sx, sy]) => walkable(Math.floor(sx), Math.floor(sy)));
}

/**
 * Minimal same-room supercover LOS using grid-line (DDA) traversal.
 * - walks cell to cell; at an exact corner crossing it checks BOTH adjacent
 *   side cells (the 4-cell neighbourhood), so a diagonal cannot slip through a corner;
 * - excludes the start and end cells (RER "去两端");
 * - `allow` exempts the seal source's own cell (source is embedded in the partition).
 * Dynamic door cells are not static walls, so a sealed door still lets Scan see the source.
 */
export function hasLineOfSight(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  allow?: Cell
): boolean {
  return gridLineOfSight(ax, ay, bx, by, (x, y) =>
    isStaticWallCell(x, y) && !(allow && allow.x === x && allow.y === y));
}

export function gridLineOfSight(
  ax: number, ay: number, bx: number, by: number,
  isBlocked: (cx: number, cy: number) => boolean,
): boolean {
  const startX = Math.floor(ax);
  const startY = Math.floor(ay);
  const endX = Math.floor(bx);
  const endY = Math.floor(by);
  if (startX === endX && startY === endY) return true;

  const blocked = (cx: number, cy: number): boolean => {
    if ((cx === endX && cy === endY) || (cx === startX && cy === startY)) return false;
    return isBlocked(cx, cy);
  };

  const dx = bx - ax;
  const dy = by - ay;
  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  const tDeltaX = stepX === 0 ? Infinity : 1 / adx;
  const tDeltaY = stepY === 0 ? Infinity : 1 / ady;
  let tMaxX = stepX === 0 ? Infinity : (stepX > 0 ? startX + 1 - ax : ax - startX) / adx;
  let tMaxY = stepY === 0 ? Infinity : (stepY > 0 ? startY + 1 - ay : ay - startY) / ady;

  let cx = startX;
  let cy = startY;
  let guard = 0;
  while ((cx !== endX || cy !== endY) && guard++ < 10000) {
    if (Math.abs(tMaxX - tMaxY) < 1e-9) {
      // Exact corner: both side cells are touched before entering the diagonal cell.
      const nx = cx + stepX;
      const ny = cy + stepY;
      if (blocked(nx, cy) || blocked(cx, ny)) return false;
      cx = nx;
      cy = ny;
      tMaxX += tDeltaX;
      tMaxY += tDeltaY;
    } else if (tMaxX < tMaxY) {
      cx += stepX;
      tMaxX += tDeltaX;
    } else {
      cy += stepY;
      tMaxY += tDeltaY;
    }
    if (cx === endX && cy === endY) break;
    if (blocked(cx, cy)) return false;
  }
  return true;
}
