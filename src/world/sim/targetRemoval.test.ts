// Task C fix — the canonical answer to "were the 3 hunters a product bug?".
//
// A target that really dies (hp <= 0) is filtered out of `state.targets` by the
// SAME core tick, so normal death leaves no residue. A target that was only
// removed from the RENDERER (the old bootstrap fixture) stays alive in the core
// and keeps appearing in the MCP observation — which is exactly what the Lead
// saw. The fixed run helper therefore clears renderer + canonical state
// together (disclosed fixture), see lead-signal-model-live-fix/.
//
// Run: npx vitest run src/world/sim/targetRemoval.test.ts

import { describe, expect, it } from 'vitest';
import { basePlayerData, xpForLevel } from '../../config/game';
import { MapGenerator, assignRoles, guaranteeReachable } from '../MapGenerator';
import type { MapData, PlayerData } from '../../types';
import {
  createSimulationState, isWalkableFromState, stepSimulationTicks,
  type SimulationIntent, type SimulationState, type SimTarget
} from './core';

function neutral(): SimulationIntent {
  return { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false };
}

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
        s.player.x = tile.x; s.player.y = tile.y; return s;
      }
    }
  }
  return s;
}

function hunter(s: SimulationState, id: number, hp: number): SimTarget {
  return {
    id, kind: 'hunter', x: s.player.x + 2 + id, y: s.player.y,
    hp, maxHp: 59, armor: 0, radius: 0.5, isBoss: false, xpValue: 3, currencyValue: 1
  };
}

describe('normal death leaves no target residue (the fixture did)', () => {
  it('a dead target is removed from state.targets by the next core tick', () => {
    const s = state();
    const t = hunter(s, 1, 0);
    s.targets.push(t);
    stepSimulationTicks(s, 1, neutral());
    expect(s.targets.find((x) => x.id === 1)).toBeUndefined();
  });

  it('a LIVE target is NOT removed — so renderer-only clearing leaves a phantom threat', () => {
    const s = state();
    s.targets.push(hunter(s, 2, 59), hunter(s, 3, 59));
    stepSimulationTicks(s, 1, neutral());
    expect(s.targets.map((x) => x.id).sort()).toEqual([2, 3]);
    // This is exactly the stale state the old clear-enemies fixture produced:
    // the room looked empty on screen while the core still held 3 live hunters.
    expect(s.targets.every((x) => x.hp > 0)).toBe(true);
  });
});
