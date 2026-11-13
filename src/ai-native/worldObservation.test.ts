// AI-NATIVE-02 P1 fix — perception projection tests (F-02).
//
// Current-room membership is NOT sufficient. The World adapter decides
// `isPerceivable` via bounded grid radius + explored rooms + LOS; these tests
// use an explicit predicate to cover far, wall-blocked, unentered-room,
// chased-in, boss and portal cases at the DTO boundary.

import { describe, expect, it } from 'vitest';
import { buildWorldObservation, type WorldObservationInput } from './worldObservation';
import { pickTarget, type LocalControllerView } from './localController';

function baseInput(isPerceivable: (x: number, y: number) => boolean): WorldObservationInput {
  return {
    player: { x: 5, y: 5, alive: true, hp: 80, maxHp: 100 },
    roomId: 2,
    enemies: [
      { id: 11, kind: 'drone', x: 7, y: 5, alive: true, roomId: 2 },
      { id: 12, kind: 'stalker', x: 30, y: 30, alive: true, roomId: 2 }, // far, same room
      { id: 13, kind: 'hunter', x: 6, y: 6, alive: false, roomId: 2 },  // dead
      { id: 14, kind: 'hunter', x: 5.5, y: 5.5, alive: true, roomId: 4 } // chased in
    ],
    boss: { id: 21, x: 40, y: 40, alive: true, hp: 500, maxHp: 900, roomId: 2 },
    portal: { x: 6, y: 8, targetRoom: 9 },
    perception: {
      basis: 'grid-radius+explored+line-of-sight',
      center: { x: 5, y: 5 },
      radiusTiles: 12,
      probeRadiusTiles: 1.5,
      requiresExplored: true,
      requiresLineOfSight: true
    },
    isPerceivable
  };
}

describe('WorldObservationV1 perception projection', () => {
  it('keeps own public state and only perceived living actors', () => {
    const obs = buildWorldObservation(baseInput((x, y) => Math.hypot(x - 5, y - 5) <= 12));
    expect(obs.protocolVersion).toBe(1);
    expect(obs.player).toEqual({ x: 5, y: 5, alive: true, hp: 80, maxHp: 100 });
    expect(obs.roomId).toBe(2);
    // 12 is far (same room) and 13 is dead; 14 chased in from another room and IS perceived.
    expect(obs.perceivedActors.map((a) => a.id)).toEqual([11, 14]);
  });

  it('current room alone is not sufficient: a wall-blocked same-room actor is excluded', () => {
    const obs = buildWorldObservation(baseInput((x, y) =>
      Math.hypot(x - 5, y - 5) <= 12 && !(x === 7 && y === 5)));
    expect(obs.perceivedActors.map((a) => a.id)).not.toContain(11);
    expect(obs.perceivedActors.map((a) => a.id)).toContain(14);
  });

  it('hides a far / unperceived boss and exposes no phase', () => {
    const obs = buildWorldObservation(baseInput((x, y) => Math.hypot(x - 5, y - 5) <= 12));
    expect(obs.boss).toBeNull();
    const withBoss = buildWorldObservation({
      ...baseInput((x, y) => Math.hypot(x - 5, y - 5) <= 12),
      boss: { id: 21, x: 6, y: 6, alive: true, hp: 500, maxHp: 900, roomId: 2 }
    });
    expect(withBoss.boss).toEqual({ id: 21, x: 6, y: 6, hp: 500, maxHp: 900 });
    expect(JSON.stringify(withBoss)).not.toContain('phase');
  });

  it('exposes a perceived portal position only, never its destination room', () => {
    const near = buildWorldObservation(baseInput(() => true));
    expect(near.portal).toEqual({ x: 6, y: 8 });
    expect(JSON.stringify(near)).not.toContain('targetRoom');
    const hidden = buildWorldObservation(baseInput(() => false));
    expect(hidden.portal).toBeNull();
    expect(hidden.perceivedActors).toEqual([]);
    expect(hidden.boss).toBeNull();
  });

  it('declares the visibility basis and contains no seed / map / internal fields', () => {
    const obs = buildWorldObservation(baseInput((x, y) => Math.hypot(x - 5, y - 5) <= 12));
    expect(obs.visibilityBasis).toBe('grid-radius+explored+line-of-sight');
    expect(obs.perception.requiresExplored).toBe(true);
    expect(obs.perception.requiresLineOfSight).toBe(true);
    expect(Object.keys(obs)).toEqual([
      'protocolVersion', 'visibilityBasis', 'perception', 'player',
      'roomId', 'perceivedActors', 'boss', 'portal'
    ]);
    const json = JSON.stringify(obs);
    for (const forbidden of ['seed', 'rng', '"map"', 'tiles', 'spawned', 'cleared', 'currentRoomId', 'phase', 'won', 'hitFlash']) {
      expect(json).not.toContain(forbidden);
    }
  });

  it('controller target selection only sees the perceived actor list', () => {
    const obs = buildWorldObservation(baseInput((x, y) => Math.hypot(x - 5, y - 5) <= 12));
    const view: LocalControllerView = {
      ready: obs.player.alive,
      player: { x: obs.player.x, y: obs.player.y, alive: obs.player.alive },
      roomId: obs.roomId,
      enemies: obs.perceivedActors.map(({ id, kind, x, y, alive }) => ({ id, kind, x, y, alive })),
      boss: null,
      portal: obs.portal ? { x: obs.portal.x, y: obs.portal.y } : null,
      canWalk: () => true,
      timeSeconds: 0
    };
    // Both perceived actors are candidates; the nearest (14) must win.
    expect(pickTarget(view)?.id).toBe(14);
  });
});
