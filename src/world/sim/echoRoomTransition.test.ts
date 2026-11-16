// Task C fix — a real ORDINARY portal transition must move the ECHO with the
// protagonist on the SAME core tick, and must not leave the old room's assist
// armed. Pure core regression (no Phaser / no bridge / no MCP).
//
// RED before the fix: `teleport-player` only moved the player, so the echo was
// left behind in the previous room (Lead evidence: player (115,44) vs echo
// (27.16,43.68) after room 3 -> 5) and the assist stayed armed.
//
// Run: npx vitest run src/world/sim/echoRoomTransition.test.ts

import { describe, expect, it } from 'vitest';
import { basePlayerData, xpForLevel } from '../../config/game';
import { MapGenerator, assignRoles, guaranteeReachable } from '../MapGenerator';
import type { MapData, PlayerData } from '../../types';
import {
  canonicalSimulationState, createSimulationState, enqueueCommand,
  isWalkableFromState, stepSimulationTicks,
  type SimulationIntent, type SimulationState
} from './core';

function playerData(): PlayerData {
  return {
    ...basePlayerData(), level: 1, xp: 0, xpToNext: xpForLevel(1), currency: 0,
    weaponKey: 'pulse',
    weapons: [{ key: 'pulse', level: 1, ammo: -1, magazine: -1, reloading: false, reloadTimer: 0 }],
    upgrades: [], abilities: []
  } as PlayerData;
}

function mapData(): MapData {
  const gen = new MapGenerator(424242);
  const map = gen.generate();
  assignRoles(gen, map.rooms, map.roomsOrder);
  guaranteeReachable(map);
  return map;
}

function state(): SimulationState {
  const map = mapData();
  const s = createSimulationState({ seed: 424242, map, playerData: playerData(), playerX: 0, playerY: 0 });
  for (const row of map.tiles) {
    for (const tile of row) {
      if ((tile.type === 'floor' || tile.type === 'spawn') && isWalkableFromState(s, tile.x, tile.y, 0.5)) {
        s.player.x = tile.x; s.player.y = tile.y;
        enqueueCommand(s, { type: 'spawn-echo', x: tile.x + 1, y: tile.y });
        stepSimulationTicks(s, 1, neutral());
        return s;
      }
    }
  }
  throw new Error('no walkable start tile');
}

const neutral = (): SimulationIntent => ({
  move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false
});

/** A walkable tile that is far away from the echo (another room area). */
function farWalkable(s: SimulationState, minDistance = 40): { x: number; y: number } {
  let best: { x: number; y: number; d: number } | null = null;
  for (const row of s.map.tiles) {
    for (const tile of row) {
      if (tile.type !== 'floor' && tile.type !== 'spawn') continue;
      if (!isWalkableFromState(s, tile.x, tile.y, 0.5)) continue;
      const d = Math.hypot(tile.x - s.echo!.x, tile.y - s.echo!.y);
      if (d >= minDistance && (!best || d > best.d)) best = { x: tile.x, y: tile.y, d };
    }
  }
  if (!best) throw new Error('no far walkable tile');
  return { x: best.x, y: best.y };
}

describe('ordinary portal transition moves the ECHO on the same tick', () => {
  it('migrateEcho=true lands the echo next to the protagonist, inside walkable ground', () => {
    const s = state();
    const before = { x: s.echo!.x, y: s.echo!.y };
    const far = farWalkable(s);

    enqueueCommand(s, { type: 'teleport-player', x: far.x, y: far.y, healToFull: true, migrateEcho: true });
    const events = stepSimulationTicks(s, 1, neutral());

    const echo = s.echo!;
    expect(echo.x, 'echo must NOT stay in the old room').not.toBe(before.x);
    expect(echo.y).not.toBe(before.y);
    expect(Math.hypot(echo.x - s.player.x, echo.y - s.player.y),
      'echo lands beside the protagonist').toBeLessThan(3.5);
    expect(isWalkableFromState(s, echo.x, echo.y, 0.5), 'echo lands on walkable ground').toBe(true);
    expect(events.some((e) => e.type === 'echo-moved' && e.actorId === echo.actorId)).toBe(true);
    expect(echo.data.hp, 'migration never damages the echo').toBe(echo.data.maxHp);
  });

  it('NEGATIVE CONTROL: without the flag the echo is deliberately left in place', () => {
    const s = state();
    const before = { x: s.echo!.x, y: s.echo!.y };
    const far = farWalkable(s);

    enqueueCommand(s, { type: 'teleport-player', x: far.x, y: far.y, healToFull: true });
    stepSimulationTicks(s, 1, neutral());

    expect(s.echo!.x, 'no migration requested => no migration happens').toBe(before.x);
    expect(s.echo!.y).toBe(before.y);
  });

  it('is deterministic: identical state + identical command => identical canonical state', () => {
    const a = state();
    const b = state();
    const farA = farWalkable(a);
    const farB = farWalkable(b);
    expect({ x: farA.x, y: farA.y }).toEqual({ x: farB.x, y: farB.y });

    enqueueCommand(a, { type: 'teleport-player', x: farA.x, y: farA.y, healToFull: true, migrateEcho: true });
    enqueueCommand(b, { type: 'teleport-player', x: farB.x, y: farB.y, healToFull: true, migrateEcho: true });
    const evA = stepSimulationTicks(a, 1, neutral());
    const evB = stepSimulationTicks(b, 1, neutral());

    expect(canonicalSimulationState(a)).toBe(canonicalSimulationState(b));
    expect(evA.map((e) => e.type)).toEqual(evB.map((e) => e.type));
  });
});
