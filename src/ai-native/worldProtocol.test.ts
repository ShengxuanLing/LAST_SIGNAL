// AI-NATIVE-02 C3-a — strict World protocol tests.

import { describe, expect, it } from 'vitest';
import {
  WORLD_LIMITS, WORLD_PROTOCOL_VERSION, WORLD_SCHEMA_V1, parseWorldAction,
  parseWorldActionBatch, parseWorldObservation, worldActionFingerprint,
  worldBatchFingerprint
} from './worldProtocol';

const aid = (n: number) => `aid_${n.toString(16).padStart(24, '0')}`;
const rid = (n: number) => `req_${n.toString(16).padStart(24, '0')}`;

function observation(epoch = 1, tick = 10) {
  return {
    schema: WORLD_SCHEMA_V1,
    protocolVersion: WORLD_PROTOCOL_VERSION,
    epoch,
    tick,
    roomId: 0,
    player: { x: 5, y: 5, hp: 100, maxHp: 100, aimYaw: 0.5, weaponKey: 'pulse', ammo: -1, magazine: -1 },
    drones: [{ id: 1, kind: 'drone', x: 7, y: 5, hp: 24, state: 'chase' }],
    projectiles: [{ id: 2, side: 'player', kind: 'pulse', x: 6, y: 5, vx: 1, vy: 0, damage: 12, lifetime: 0.5 }],
    availableActions: ['move', 'stop', 'aim', 'fire', 'interact']
  };
}

describe('C3-a WorldActionV1 strict schema', () => {
  it('accepts the five first-slice actions and rejects actor/seed/role overrides', () => {
    const actions = [
      { type: 'move', actionId: aid(1), dir: { x: 1, y: 0 }, ticks: 10 },
      { type: 'stop', actionId: aid(2) },
      { type: 'aim', actionId: aid(3), target: { x: 7, y: 5 } },
      { type: 'fire', actionId: aid(4), target: { x: 7, y: 5 }, ticks: 20 },
      { type: 'interact', actionId: aid(5) }
    ];
    for (const action of actions) expect(parseWorldAction(action).ok, action.type).toBe(true);
    for (const bad of [
      { ...actions[0], actorId: 'act_0000000000000000' },
      { ...actions[0], role: 'PLAYER' },
      { ...actions[0], seed: 1 },
      { type: 'move', actionId: aid(9), dir: { x: 0, y: 0 }, ticks: 1 },
      { type: 'move', actionId: aid(9), dir: { x: 1, y: 0 }, ticks: WORLD_LIMITS.MAX_ACTION_TICKS + 1 },
      { type: 'scan', actionId: aid(9) }
    ]) {
      const result = parseWorldAction(bad);
      expect(result.ok, JSON.stringify(bad)).toBe(false);
      if (!result.ok) expect(result.code).toBe('E_SCHEMA');
    }
  });

  it('batch is strict, bounded, and actionIds are unique', () => {
    const ok = parseWorldActionBatch({
      actions: [{ type: 'stop', actionId: aid(1) }],
      ttlTicks: 60
    });
    expect(ok.ok).toBe(true);
    const duplicate = parseWorldActionBatch({
      actions: [{ type: 'stop', actionId: aid(1) }, { type: 'stop', actionId: aid(1) }]
    });
    expect(duplicate.ok).toBe(false);
    const tooMany = parseWorldActionBatch({
      actions: Array.from({ length: WORLD_LIMITS.MAX_ACTIONS_PER_BATCH + 1 }, (_, i) => ({ type: 'stop', actionId: aid(i + 1) }))
    });
    expect(tooMany.ok).toBe(false);
    expect(parseWorldActionBatch({ actions: [{ type: 'stop', actionId: aid(1) }], ttlTicks: WORLD_LIMITS.MAX_TTL_TICKS + 1 }).ok).toBe(false);
    expect(parseWorldActionBatch({ actions: [{ type: 'stop', actionId: aid(1) }], actorId: 'x' }).ok).toBe(false);
  });

  it('fingerprints are deterministic and payload-sensitive', () => {
    const a = { type: 'move', actionId: aid(1), dir: { x: 1, y: 0 }, ticks: 5 } as const;
    const b = { ...a, dir: { x: 0, y: 1 } };
    expect(worldActionFingerprint(a)).toBe(worldActionFingerprint({ ...a, dir: { x: 1, y: 0 } }));
    expect(worldActionFingerprint(a)).not.toBe(worldActionFingerprint(b));
    const batch = { actions: [a], ttlTicks: 10 };
    expect(worldBatchFingerprint(batch)).toBe(worldBatchFingerprint({ actions: [a], ttlTicks: 10 }));
    expect(worldBatchFingerprint(batch)).not.toBe(worldBatchFingerprint({ actions: [b], ttlTicks: 10 }));
  });
});

describe('C3-a WorldObservationV1 whitelist', () => {
  it('accepts the player-visible first-slice observation', () => {
    const result = parseWorldObservation(observation());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.player.hp).toBe(100);
      expect(result.value.drones).toHaveLength(1);
      expect(result.value.projectiles).toHaveLength(1);
    }
  });

  it('rejects seed/map/rng/targetRoom/phase and other hidden fields', () => {
    for (const extra of [
      { seed: 1 }, { rngState: 1 }, { map: {} }, { tiles: [] },
      { targetRoom: 1 }, { phase: 2 }, { role: 'PLAYER' }
    ]) {
      const result = parseWorldObservation({ ...observation(), ...extra });
      expect(result.ok, JSON.stringify(extra)).toBe(false);
    }
  });

  it('bounds arrays and validates numeric fields', () => {
    const tooManyDrones = {
      ...observation(),
      drones: Array.from({ length: WORLD_LIMITS.MAX_OBSERVATION_DRONES + 1 }, (_, i) => ({
        id: i, kind: 'drone', x: 0, y: 0, hp: 1, state: 'idle'
      }))
    };
    expect(parseWorldObservation(tooManyDrones).ok).toBe(false);
    expect(parseWorldObservation({ ...observation(), tick: -1 }).ok).toBe(false);
    expect(parseWorldObservation({ ...observation(), player: { ...observation().player, hp: Number.NaN } }).ok).toBe(false);
    expect(parseWorldObservation({ ...observation(), availableActions: ['scan'] }).ok).toBe(false);
  });
});
