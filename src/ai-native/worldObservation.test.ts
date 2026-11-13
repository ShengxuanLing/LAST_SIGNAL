// AI-NATIVE-02 P1 — legal observation whitelist tests (review R-04).
//
// The local controller must decide only from what a player can actually see.
// These tests prove that unentered-room enemies, a boss in another room and the
// portal destination never enter the projection, while legal public state
// (own stats, current-room actors, boss HP already shown by the HUD) survives.

import { describe, expect, it } from 'vitest';
import { buildWorldObservation } from './worldObservation';
import { pickTarget, type LocalControllerView } from './localController';

function baseInput() {
  return {
    player: { x: 5, y: 5, alive: true, hp: 80, maxHp: 100 },
    roomId: 2,
    enemies: [
      { id: 11, kind: 'drone', x: 7, y: 5, alive: true, roomId: 2 },
      { id: 12, kind: 'stalker', x: 30, y: 30, alive: true, roomId: 4 },
      { id: 13, kind: 'hunter', x: 6, y: 6, alive: false, roomId: 2 }
    ],
    boss: { id: 21, x: 40, y: 40, alive: true, hp: 500, maxHp: 900, roomId: 8 },
    portal: { x: 6, y: 8, targetRoom: 9 }
  };
}

describe('WorldObservationV1 whitelist', () => {
  it('keeps own public state and only current-room living actors', () => {
    const obs = buildWorldObservation(baseInput());
    expect(obs.protocolVersion).toBe(1);
    expect(obs.player).toEqual({ x: 5, y: 5, alive: true, hp: 80, maxHp: 100 });
    expect(obs.roomId).toBe(2);
    expect(obs.visibleActors.map((a) => a.id)).toEqual([11]);
  });

  it('hides a boss that is not in the current room and exposes no phase', () => {
    const obs = buildWorldObservation(baseInput());
    expect(obs.boss).toBeNull();
    const withBoss = buildWorldObservation({
      ...baseInput(),
      boss: { id: 21, x: 6, y: 6, alive: true, hp: 500, maxHp: 900, roomId: 2 }
    });
    expect(withBoss.boss).toEqual({ id: 21, x: 6, y: 6, hp: 500, maxHp: 900 });
    expect(JSON.stringify(withBoss)).not.toContain('phase');
  });

  it('exposes the portal position but never its destination room', () => {
    const obs = buildWorldObservation(baseInput());
    expect(obs.portal).toEqual({ x: 6, y: 8 });
    expect(JSON.stringify(obs)).not.toContain('targetRoom');
    expect(JSON.stringify(obs)).not.toContain('"9"');
  });

  it('contains no seed, map, room-graph or internal AI fields', () => {
    const obs = buildWorldObservation({ ...baseInput(), roomId: null } as any);
    const keys = Object.keys(obs);
    expect(keys).toEqual(['protocolVersion', 'player', 'roomId', 'visibleActors', 'boss', 'portal']);
    const json = JSON.stringify(buildWorldObservation(baseInput()));
    for (const forbidden of ['seed', 'rng', 'map', 'tiles', 'spawned', 'cleared', 'currentRoomId', 'phase', 'won', 'hitFlash']) {
      expect(json).not.toContain(forbidden);
    }
  });

  it('controller target selection only sees whitelisted actors', () => {
    const obs = buildWorldObservation(baseInput());
    const view: LocalControllerView = {
      ready: obs.player.alive,
      player: { x: obs.player.x, y: obs.player.y, alive: obs.player.alive },
      roomId: obs.roomId,
      enemies: obs.visibleActors.map(({ id, kind, x, y, alive }) => ({ id, kind, x, y, alive })),
      boss: null,
      portal: obs.portal ? { x: obs.portal.x, y: obs.portal.y } : null,
      canWalk: () => true,
      timeSeconds: 0
    };
    expect(pickTarget(view)?.id).toBe(11);
  });

  it('a null room hides all actors and the portal is still position-only', () => {
    const obs = buildWorldObservation({ ...baseInput(), roomId: null });
    expect(obs.visibleActors).toEqual([]);
    expect(obs.boss).toBeNull();
    expect(obs.portal).toEqual({ x: 6, y: 8 });
  });
});
