// AI-NATIVE-02 P3-a fix — ONE pure echo observation projection for BOTH the
// rendered World and the headless runtime. No Phaser, no DOM, no state writes.
//
// Everything is centred on the echo itself: bounded grid radius, explored
// rooms and wall line-of-sight. Non-drone targets (including Boss) expose only
// public state; hidden/other-room actors never appear.

import { gridLineOfSight, WORLD_PERCEPTION } from '../ai-native/worldPerception';
import { ECHO_LIMITS, type EchoView, type EchoVisibleTarget } from '../ai-native/echo';
import type { SimEchoState } from './sim/core';

export interface EchoObservationActor {
  id: number;
  x: number;
  y: number;
  hp: number;
}

export interface EchoObservationTarget {
  id: number;
  kind: string;
  x: number;
  y: number;
  hp: number;
  isBoss: boolean;
}

export interface EchoObservationInput {
  echo: SimEchoState;
  player: { x: number; y: number };
  tick: number;
  drones: readonly EchoObservationActor[];
  targets: readonly EchoObservationTarget[];
  isExplored: (x: number, y: number) => boolean;
  isOpaque: (x: number, y: number) => boolean;
  /** The run's ONE Signal device, if the run has one. It is only reported
   *  when the ECHO itself perceives it (radius + explored + line of sight). */
  signal?: {
    deviceId: string; x: number; y: number; relay: string;
    powered: boolean; manualEnabled: boolean; jammedUntilTick: number;
  } | null;
  /** The ECHO's own finite resource account (never the player's). */
  energy?: { current: number; max: number };
  cooldowns?: { scanTicks: number; jamTicks: number };
}

export const ECHO_OBSERVATION_SCHEMA = 'last_signal.echo-observation.v1' as const;

export type EchoObservation = EchoView & {
  /** Attestation: this object was produced by buildEchoObservation (cropped). */
  schema: typeof ECHO_OBSERVATION_SCHEMA;
  perception: {
    center: { x: number; y: number };
    radiusTiles: number;
    requiresExplored: true;
    requiresLineOfSight: true;
  };
  targets: EchoVisibleTarget[];
};

/** Field-level crop attestation (survives JSON over the bridge). */
export function isEchoObservation(value: unknown): value is EchoObservation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  if (v.schema !== ECHO_OBSERVATION_SCHEMA) return false;
  const p = v.perception as Record<string, unknown> | undefined;
  if (!p || p.requiresExplored !== true || p.requiresLineOfSight !== true ||
      p.radiusTiles !== ECHO_LIMITS.perceptionTiles || !finite(p.center)) return false;
  const allowed = new Set(['schema', 'perception', 'tick', 'player', 'echo', 'drones', 'targets', 'energy', 'cooldowns', 'relay', 'objectiveBlocked', 'roomId']);
  for (const key of Object.keys(v)) if (!allowed.has(key)) return false;
  if (!Array.isArray(v.drones) || !Array.isArray(v.targets)) return false;
  const center = p.center as { x: number; y: number };
  const bounded = (item: unknown): boolean => {
    const a = item as Record<string, unknown>;
    return !!a && typeof a.x === 'number' && typeof a.y === 'number'
      && Math.hypot(a.x - center.x, a.y - center.y) < ECHO_LIMITS.perceptionTiles;
  };
  return (v.drones as unknown[]).every(bounded) && (v.targets as unknown[]).every(bounded);
}
function finite(value: unknown): value is { x: number; y: number } {
  const v = value as Record<string, unknown> | undefined;
  return !!v && typeof v.x === 'number' && Number.isFinite(v.x) && typeof v.y === 'number' && Number.isFinite(v.y);
}

function perceives(
  echo: SimEchoState, x: number, y: number,
  isExplored: (x: number, y: number) => boolean,
  isOpaque: (x: number, y: number) => boolean
): boolean {
  // Strictly INSIDE the shared radius (slice uses the same `< radius` rule).
  if (Math.hypot(x - echo.x, y - echo.y) >= ECHO_LIMITS.perceptionTiles) return false;
  return gridLineOfSight({ x, y }, {
    center: { x: echo.x, y: echo.y },
    radiusTiles: ECHO_LIMITS.perceptionTiles,
    isExplored,
    isOpaque,
    stepTiles: WORLD_PERCEPTION.losStepTiles
  });
}

export function buildEchoObservation(input: EchoObservationInput): EchoObservation {
  const { echo, isExplored, isOpaque } = input;
  const signal = input.signal;
  // The device is echo-only knowledge: no relay is reported unless the echo
  // perceives it right now through the SAME shared perception rule as actors.
  const perceivedRelay = signal && perceives(echo, signal.x, signal.y, isExplored, isOpaque)
    ? { id: signal.deviceId, x: signal.x, y: signal.y, state: signal.relay }
    : null;
  const drones = input.drones
    .filter((drone) => drone.hp > 0 && perceives(echo, drone.x, drone.y, isExplored, isOpaque))
    .slice(0, 32)
    .map((drone) => ({ id: drone.id, x: drone.x, y: drone.y, hp: drone.hp }));
  const targets: EchoVisibleTarget[] = input.targets
    .filter((target) => target.hp > 0 && perceives(echo, target.x, target.y, isExplored, isOpaque))
    .slice(0, 32)
    .map((target) => ({
      id: target.id, kind: target.kind, x: target.x, y: target.y,
      hp: target.hp, isBoss: target.isBoss
    }));
  return {
    schema: ECHO_OBSERVATION_SCHEMA,
    perception: {
      center: { x: echo.x, y: echo.y },
      radiusTiles: ECHO_LIMITS.perceptionTiles,
      requiresExplored: true,
      requiresLineOfSight: true
    },
    tick: input.tick,
    player: { x: input.player.x, y: input.player.y },
    echo: {
      x: echo.x, y: echo.y, hp: echo.data.hp,
      maxHp: echo.data.maxHp, aimYaw: echo.aimYaw
    },
    drones,
    targets,
    ...(perceivedRelay ? { relay: perceivedRelay } : {}),
    ...(perceivedRelay && signal && signal.relay !== 'ACTIVE' ? { objectiveBlocked: true } : {}),
    ...(input.energy ? { energy: input.energy } : {}),
    ...(input.cooldowns ? { cooldowns: input.cooldowns } : {})
  };
}
