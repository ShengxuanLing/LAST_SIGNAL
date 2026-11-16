// AI-NATIVE-02 P1 fix (F-02) — legal perception projection for the real World.
//
// This is a *controller input projection*, not a security boundary: the page
// still has `window.__game` (baseline issue F-03, unresolved) and `World`'s
// public fields. It deliberately contains no seed, RNG, full map, unentered
// room metadata, portal destination, boss phase or internal timers.
//
// "Perceived" is now defined by the caller's `isPerceivable(x, y)` predicate,
// which the World adapter implements with a bounded grid radius + explored-room
// check + LOS (see `worldPerception.ts`). Current room membership alone is NOT
// sufficient, and an actor that chased in from another room IS perceivable when
// it is actually within the bounded, unobstructed grid range.

import type { GridPoint } from './worldPerception';

export interface ObservedActorInput {
  id: number;
  kind: string;
  x: number;
  y: number;
  alive: boolean;
  /** Spawn room, informational only; NOT used as a visibility predicate. */
  roomId: number;
}

export interface ObservedBossInput {
  id: number;
  x: number;
  y: number;
  alive: boolean;
  hp: number;
  maxHp: number;
  roomId: number;
}

export interface PerceptionDescriptor {
  basis: 'grid-radius+explored+line-of-sight';
  center: GridPoint;
  radiusTiles: number;
  probeRadiusTiles: number;
  requiresExplored: true;
  requiresLineOfSight: true;
}

export interface WorldObservationInput {
  player: { x: number; y: number; alive: boolean; hp: number; maxHp: number };
  roomId: number | null;
  enemies: ObservedActorInput[];
  boss: ObservedBossInput | null;
  /** Portal position is visible only if perceivable; its destination is NOT. */
  portal: { x: number; y: number; targetRoom: number } | null;
  perception: PerceptionDescriptor;
  /** True only for bounded, explored, unobstructed grid positions. */
  isPerceivable: (x: number, y: number) => boolean;
}

export interface PerceivedActor {
  id: number;
  kind: string;
  x: number;
  y: number;
  alive: boolean;
}

/** Stable whitelisted projection shared by Player/AI adapters. */
export interface WorldObservationV1 {
  protocolVersion: 1;
  /** Explicit basis: not "everything in the current room is visible". */
  visibilityBasis: 'grid-radius+explored+line-of-sight';
  perception: PerceptionDescriptor;
  player: { x: number; y: number; alive: boolean; hp: number; maxHp: number };
  roomId: number | null;
  perceivedActors: PerceivedActor[];
  /** Boss HP is rendered by the HUD, so it is legal observation. */
  boss: { id: number; x: number; y: number; hp: number; maxHp: number } | null;
  portal: { x: number; y: number } | null;
}

export function buildWorldObservation(input: WorldObservationInput): WorldObservationV1 {
  const perceivedActors: PerceivedActor[] = [];
  for (const enemy of input.enemies) {
    if (!enemy.alive) continue;
    if (!input.isPerceivable(enemy.x, enemy.y)) continue;
    perceivedActors.push({ id: enemy.id, kind: enemy.kind, x: enemy.x, y: enemy.y, alive: true });
  }
  const boss = input.boss && input.boss.alive && input.isPerceivable(input.boss.x, input.boss.y)
    ? { id: input.boss.id, x: input.boss.x, y: input.boss.y, hp: input.boss.hp, maxHp: input.boss.maxHp }
    : null;
  const portal = input.portal && input.isPerceivable(input.portal.x, input.portal.y)
    ? { x: input.portal.x, y: input.portal.y }
    : null;
  return {
    protocolVersion: 1,
    visibilityBasis: 'grid-radius+explored+line-of-sight',
    perception: { ...input.perception, center: { ...input.perception.center } },
    player: { ...input.player },
    roomId: input.roomId,
    perceivedActors,
    boss,
    // Intentionally drop targetRoom: it is not rendered to the player.
    portal
  };
}
