// AI-NATIVE-02 P1 fix (F-01/F-02) — bounded, pure grid perception for the real World.
//
// The controller must NOT receive a full-map collision oracle and must NOT see
// actors merely because they share a room id. Perception is defined in grid
// space only (no Phaser camera / pointer / scene access): a bounded radius
// around the player, an explored-room check, and a line-of-sight walk that
// stops at opaque wall cells.
//
// The World adapter supplies `isExplored` / `isOpaque` / `isWalkable`; those
// callbacks are internal to the adapter and are never handed to an agent.
// The only capability exported to the controller is `createLocalProbe()`, a
// short-range local probe (radius ~1.5 tiles) used for steering.

export interface GridPoint { x: number; y: number; }

/** Conservative, camera-independent perception envelope. */
export const WORLD_PERCEPTION = {
  /** Actors / boss / portal farther than this (grid tiles) are not perceived. */
  radiusTiles: 12,
  /** The only collision queries exposed to the controller. */
  probeRadiusTiles: 1.5,
  /** LOS sampling step in grid tiles. */
  losStepTiles: 0.25
} as const;

export function withinRadius(center: GridPoint, point: GridPoint, radius: number): boolean {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
  return Math.hypot(point.x - center.x, point.y - center.y) <= radius;
}

export interface LineOfSightOptions {
  center: GridPoint;
  radiusTiles: number;
  /** Only cells in rooms the player has actually entered count as known. */
  isExplored: (x: number, y: number) => boolean;
  /** Wall cells block sight; lava/water are walkability hazards, not sight blockers. */
  isOpaque: (x: number, y: number) => boolean;
  stepTiles?: number;
}

/**
 * Grid-only LOS. Rejects non-finite / out-of-radius / unexplored targets and
 * any sampled wall cell between the player and the target. No camera or
 * viewport object is consulted.
 */
export function gridLineOfSight(target: GridPoint, options: LineOfSightOptions): boolean {
  const { center } = options;
  if (!Number.isFinite(center.x) || !Number.isFinite(center.y)) return false;
  if (!withinRadius(center, target, options.radiusTiles)) return false;
  if (!options.isExplored(target.x, target.y)) return false;
  const distance = Math.hypot(target.x - center.x, target.y - center.y);
  const step = options.stepTiles ?? WORLD_PERCEPTION.losStepTiles;
  const samples = Math.max(1, Math.ceil(distance / step));
  for (let i = 1; i <= samples; i++) {
    const t = i / samples;
    const x = center.x + (target.x - center.x) * t;
    const y = center.y + (target.y - center.y) * t;
    if (!withinRadius(center, { x, y }, options.radiusTiles)) return false;
    if (!options.isExplored(x, y)) return false;
    if (options.isOpaque(x, y)) return false;
  }
  return true;
}

export interface LocalProbeOptions {
  center: GridPoint;
  probeRadiusTiles: number;
  isExplored: (x: number, y: number) => boolean;
  isWalkable: (x: number, y: number) => boolean;
}

/**
 * Bounded walkability capability for the local controller. Non-finite,
 * far-away and unexplored probes all return a uniform `false` and do NOT
 * consult the world's real terrain, so the callback cannot be used to scan
 * the map. Only short-range local probes (used by steering) reach `isWalkable`.
 */
export function createLocalProbe(options: LocalProbeOptions): (x: number, y: number) => boolean {
  return (x: number, y: number): boolean => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    if (!withinRadius(options.center, { x, y }, options.probeRadiusTiles)) return false;
    if (!options.isExplored(x, y)) return false;
    return options.isWalkable(x, y);
  };
}
