// C3-b fix — observation perception cropping + strict schema negative tests.
// Projectiles behind walls, in other/unexplored rooms or beyond the bounded
// radius must NOT be returned, for EITHER side. Legal near projectiles stay.

import { describe, expect, it } from 'vitest';
import { buildExternalObservation, type ExternalObservationInput } from './externalObservation';
import { parseWorldObservation, WORLD_SCHEMA_V1 } from './worldProtocol';
import type { WorldObservationV1 } from './worldObservation';

function view(perceivedIds: number[]): WorldObservationV1 {
  return {
    protocolVersion: 1,
    visibilityBasis: 'grid-radius+explored+line-of-sight',
    perception: {
      basis: 'grid-radius+explored+line-of-sight',
      center: { x: 10, y: 10 },
      radiusTiles: 12,
      probeRadiusTiles: 1.5,
      requiresExplored: true,
      requiresLineOfSight: true
    },
    player: { x: 10, y: 10, alive: true, hp: 100, maxHp: 100 },
    roomId: 3,
    perceivedActors: perceivedIds.map((id) => ({ id, kind: 'drone', x: 11, y: 10, alive: true })),
    boss: null,
    portal: null
  };
}

function projectile(id: number, x: number, y: number, side: 'player' | 'enemy' = 'enemy') {
  return {
    id, side, kind: 'plasma', pos: { x, y }, vel: { x: 1, y: 0 }, damage: 6, lifetime: 2
  };
}

function input(overrides: Partial<ExternalObservationInput> = {}): ExternalObservationInput {
  return {
    epoch: 1,
    tick: 42,
    view: view([1]),
    playerData: { weaponKey: 'pulse', weapons: [{ key: 'pulse', ammo: -1, magazine: -1 }] },
    aimYaw: 0.25,
    drones: [{ id: 1, kind: 'drone', x: 11, y: 10, hp: 24, state: 'idle' }],
    targets: [],
    projectiles: [],
    isPerceivable: () => true,
    ...overrides
  };
}

describe('C3-b fix — observation projectile cropping', () => {
  it('keeps a legal near projectile and drops far / wall-behind / other-room ones', () => {
    // The predicate models bounded radius + explored room + LOS: only points
    // inside the player's known room and within reach are perceivable.
    const isPerceivable = (x: number, y: number): boolean =>
      x >= 9 && x <= 13 && y >= 9 && y <= 11;
    const observation = buildExternalObservation(input({
      isPerceivable,
      projectiles: [
        projectile(1, 11, 10, 'player'),   // legal near, player side
        projectile(2, 12, 10, 'enemy'),    // legal near, enemy side
        projectile(3, 40, 40, 'enemy'),    // far away -> hidden
        projectile(4, 25, 10, 'enemy'),    // other room -> hidden
        projectile(5, 11, 30, 'enemy')     // behind wall / unexplored -> hidden
      ]
    }));
    expect(observation.projectiles.map((p) => p.id)).toEqual([1, 2]);
    expect(observation.projectiles.find((p) => p.id === 2)?.side).toBe('enemy');
  });

  it('an enemy projectile behind a wall is NOT inferable from the payload', () => {
    const observation = buildExternalObservation(input({
      isPerceivable: (x) => x < 11, // wall at x=11 blocks everything beyond
      projectiles: [projectile(9, 14, 10, 'enemy')]
    }));
    expect(observation.projectiles).toHaveLength(0);
  });

  it('drones/targets stay cropped by the player perception whitelist', () => {
    const observation = buildExternalObservation(input({
      view: view([1]),
      drones: [
        { id: 1, kind: 'drone', x: 11, y: 10, hp: 24, state: 'idle' },
        { id: 2, kind: 'stalker', x: 60, y: 60, hp: 40, state: 'idle' }
      ],
      targets: [{ id: 3, kind: 'boss_warden', x: 70, y: 70, hp: 100 }],
      projectiles: []
    }));
    expect(observation.drones.map((d) => d.id)).toEqual([1]);
  });

  it('the produced payload passes the strict C3-a schema and carries no hidden state', () => {
    const observation = buildExternalObservation(input({
      projectiles: [projectile(1, 11, 10)]
    }));
    const parsed = parseWorldObservation(observation);
    expect(parsed.ok).toBe(true);
    expect(observation.schema).toBe(WORLD_SCHEMA_V1);
    const serialized = JSON.stringify(observation).toLowerCase();
    for (const hidden of ['"seed":', '"rngstate":', '"map":', '"tiles":', '"pendingcommands":', '"purchasetransactions":', '"hiddengoal":', '"fullmap":', '"token":']) {
      expect(serialized).not.toContain(hidden);
    }
  });

  it('strict schema NEGATIVE tests: extra hidden fields and missing schema are rejected', () => {
    const base = buildExternalObservation(input());
    expect(parseWorldObservation({ ...base, seed: 99 }).ok).toBe(false);
    expect(parseWorldObservation({ ...base, rngState: 1 }).ok).toBe(false);
    expect(parseWorldObservation({ ...base, map: { rooms: [] } }).ok).toBe(false);
    expect(parseWorldObservation({ ...base, hiddenGoal: 'boss' }).ok).toBe(false);
    const { schema: _schema, ...noSchema } = base;
    expect(parseWorldObservation(noSchema).ok).toBe(false);
    expect(parseWorldObservation({ ...base, epoch: -1 }).ok).toBe(false);
    expect(parseWorldObservation({ ...base, projectiles: [{ ...base.projectiles[0], x: NaN } as never] }).ok).toBe(false);
  });

  it('a hidden projectile cannot be recovered through an unfiltered field', () => {
    const observation = buildExternalObservation(input({
      isPerceivable: () => false,
      projectiles: [projectile(77, 99, 99, 'enemy')]
    }));
    expect(JSON.stringify(observation)).not.toContain('99');
    expect(observation.projectiles).toHaveLength(0);
  });
});
