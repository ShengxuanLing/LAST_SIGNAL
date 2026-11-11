import { canFit, gridLineOfSight, ROOM, type Cell } from './room';

export const CORRIDOR = {
  template: 'station-zero-r2-v1',
  width: 26,
  height: 14,
  spawn: { x: 2.5, y: 10.5 },
  relay: { x: 8.5, y: 9.5 },
  farControl: { x: 18.5, y: 9.5 },
  bridgePort: { x: 10.5, y: 9.5 },
  guard: { x: 5.5, y: 6.5 },
  shores: { west: { x: 9.5, y: 9.5 }, east: { x: 16.5, y: 9.5 } },
  bridge: { left: 10, right: 16, top: 8, bottom: 11 },
  controlRange: 2.25,
  transitionTicks: 90,
  dangerHp: 20,
  maxHp: 100,
} as const;

export type Shore = keyof typeof CORRIDOR.shores;

export function corridorTile(x: number, y: number): 'wall' | 'chasm' | 'floor' {
  if (x <= 0 || x >= CORRIDOR.width - 1 || y <= 0 || y >= CORRIDOR.height - 1) return 'wall';
  return x >= CORRIDOR.bridge.left && x < CORRIDOR.bridge.right ? 'chasm' : 'floor';
}

export function isBridgeCell(x: number, y: number): boolean {
  const { left, right, top, bottom } = CORRIDOR.bridge;
  return x >= left && x < right && y >= top && y < bottom;
}

function walkable(x: number, y: number, bridgePassable: boolean): boolean {
  return corridorTile(x, y) === 'floor' || (bridgePassable && isBridgeCell(x, y));
}

export function canStandInCorridor(x: number, y: number, bridgePassable: boolean): boolean {
  return canFit(x, y, (cx, cy) => walkable(cx, cy, bridgePassable));
}

export function corridorLineOfSight(from: Cell, to: Cell, bridgePassable: boolean): boolean {
  return gridLineOfSight(from.x, from.y, to.x, to.y, (x, y) => !walkable(x, y, bridgePassable));
}

export function occupiesBridge({ x, y }: Cell): boolean {
  const { left, right, top, bottom } = CORRIDOR.bridge;
  const r = ROOM.playerRadius;
  return x + r >= left && x - r <= right && y + r >= top && y - r <= bottom;
}

export function shoreOf({ x }: Cell): Shore {
  return x < CORRIDOR.bridge.left ? 'west' : 'east';
}

export function nearControl(position: Cell, bridgePassable: boolean): boolean {
  return [CORRIDOR.relay, CORRIDOR.farControl].some((control) =>
    Math.hypot(position.x - control.x, position.y - control.y) < CORRIDOR.controlRange &&
    corridorLineOfSight(position, control, bridgePassable));
}

/** Flood-fill valid player centres, so a valid but isolated shore also fails loading. */
function reachable(start: Cell, goal: Cell, bridgePassable: boolean): boolean {
  const queue: Cell[] = [start];
  const seen = new Set<string>();
  for (let i = 0; i < queue.length; i++) {
    const { x, y } = queue[i];
    if (x === goal.x && y === goal.y) return true;
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nx = x + dx;
      const ny = y + dy;
      const key = `${nx},${ny}`;
      if (seen.has(key) || !canStandInCorridor(nx, ny, bridgePassable)) continue;
      seen.add(key);
      queue.push({ x: nx, y: ny });
    }
  }
  return false;
}

export function validateCorridorTemplate(): boolean {
  const { spawn, relay, farControl, guard, shores } = CORRIDOR;
  return [spawn, relay, farControl, guard, shores.west, shores.east].every(({ x, y }) =>
    canStandInCorridor(x, y, false)) &&
    reachable(spawn, shores.west, false) &&
    reachable(shores.west, relay, false) &&
    reachable(shores.east, farControl, false) &&
    !reachable(shores.west, shores.east, false) &&
    reachable(shores.west, shores.east, true);
}
