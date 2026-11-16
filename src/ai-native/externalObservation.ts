// AI-NATIVE-02 C3-b fix — pure, perception-cropped agent observation.
//
// Extracted from the rendered controller so the projection can be unit-tested
// WITHOUT Phaser. It never sees the full map, seed, RNG state, pending commands
// or purchase ledger. Projectiles are cropped with the SAME bounded
// grid-radius + explored-room + line-of-sight predicate that the player's
// `buildWorldObservation` uses for actors/boss/portal.

import type { WorldObservationV1 } from './worldObservation';
import { WORLD_SCHEMA_V1, WORLD_PROTOCOL_VERSION } from './worldProtocol';
import type { ExternalClientObservation } from './externalLinkClient';

export interface ExternalObservationInput {
  readonly epoch: number;
  readonly tick: number;
  readonly view: WorldObservationV1;
  readonly playerData: {
    weaponKey: string;
    weapons: ReadonlyArray<{ key: string; ammo: number; magazine: number }>;
  };
  readonly aimYaw: number;
  readonly drones: ReadonlyArray<{ id: number; kind: string; x: number; y: number; hp: number; state: string }>;
  readonly targets: ReadonlyArray<{ id: number; kind: string; x: number; y: number; hp: number }>;
  readonly projectiles: ReadonlyArray<{
    id: number; side: 'player' | 'enemy'; kind: string;
    pos: { x: number; y: number }; vel: { x: number; y: number };
    damage: number; lifetime: number;
  }>;
  /** The rendered World's legal perception predicate (read-only capability). */
  readonly isPerceivable: (x: number, y: number) => boolean;
}

/**
 * Build the C3-a `WorldObservationV1` wire payload. Hidden projectile state is
 * NOT returned: a projectile behind a wall, in an unexplored/other room, or
 * outside the bounded radius is dropped for BOTH sides (player and enemy).
 */
export function buildExternalObservation(input: ExternalObservationInput): ExternalClientObservation {
  const perceivedIds = new Set(input.view.perceivedActors.map((a) => a.id));
  const visibleActors = [
    ...input.drones.filter((d) => perceivedIds.has(d.id)),
    ...input.targets.filter((t) => perceivedIds.has(t.id)).map((t) => ({
      id: t.id, kind: t.kind, x: t.x, y: t.y, hp: t.hp, state: 'alive'
    }))
  ];
  const weapon = input.playerData.weapons.find((w) => w.key === input.playerData.weaponKey);
  const projectiles = input.projectiles
    .filter((p) => input.isPerceivable(p.pos.x, p.pos.y))
    .map((p) => ({
      id: p.id, side: p.side, kind: p.kind,
      x: p.pos.x, y: p.pos.y, vx: p.vel.x, vy: p.vel.y,
      damage: p.damage, lifetime: p.lifetime
    }));
  return {
    schema: WORLD_SCHEMA_V1,
    protocolVersion: WORLD_PROTOCOL_VERSION,
    epoch: input.epoch,
    tick: input.tick,
    roomId: input.view.roomId,
    player: {
      x: input.view.player.x, y: input.view.player.y,
      hp: input.view.player.hp, maxHp: input.view.player.maxHp,
      aimYaw: input.aimYaw,
      weaponKey: input.playerData.weaponKey,
      ammo: weapon?.ammo ?? -1,
      magazine: weapon?.magazine ?? -1
    },
    drones: visibleActors.map((a) => ({
      id: a.id, kind: a.kind, x: a.x, y: a.y, hp: a.hp, state: a.state
    })),
    projectiles,
    availableActions: ['move', 'stop', 'aim', 'fire', 'interact']
  };
}
