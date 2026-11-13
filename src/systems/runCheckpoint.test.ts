// AI-NATIVE-02 P1 — checkpoint frame deep-copy regression (review R-03).

import { describe, expect, it } from 'vitest';
import { basePlayerData } from '../config/game';
import { WEAPONS } from '../config/weapons';
import type { RunCheckpoint } from '../types';
import { cloneCheckpoint, validateCheckpoint } from './RunCheckpoint';

function makeRun(): RunCheckpoint {
  const base = basePlayerData();
  return {
    id: 'run-frame-1',
    seed: 424242,
    roomId: 0,
    position: { x: 3, y: 4 },
    clearedRooms: [0],
    portalTarget: null,
    rngState: 123456,
    player: {
      ...base,
      level: 1, xp: 0, xpToNext: 30, currency: 10,
      weaponKey: 'pulse',
      weapons: [{ key: 'pulse', level: 1, ammo: -1, magazine: -1, reloading: false, reloadTimer: 0 }],
      upgrades: [],
      abilities: []
    },
    loot: [{ x: 2, y: 2, kind: 'currency', key: 'currency', amount: 4, bob: 0.5 }],
    stats: { kills: 0, items: 0, damage: 0, elapsedSeconds: 2 }
  };
}

describe('cloneCheckpoint', () => {
  it('accepts a valid frame and returns a valid independent copy', () => {
    const run = makeRun();
    expect(validateCheckpoint(run)).toBe(true);
    const clone = cloneCheckpoint(run);
    expect(validateCheckpoint(clone)).toBe(true);
    expect(clone).not.toBe(run);
    expect(clone.position).not.toBe(run.position);
    expect(clone.clearedRooms).not.toBe(run.clearedRooms);
    expect(clone.player).not.toBe(run.player);
    expect(clone.player.weapons).not.toBe(run.player.weapons);
    expect(clone.loot).not.toBe(run.loot);
    expect(clone.loot[0]).not.toBe(run.loot[0]);
    expect(clone.stats).not.toBe(run.stats);
    expect(clone.player).toEqual(run.player);
    expect(clone.loot).toEqual(run.loot);
  });

  it('does not mutate when the live frame changes after capture', () => {
    const run = makeRun();
    const captured = cloneCheckpoint(run);
    // Simulate the live World continuing to update the same objects.
    run.player.hp = 1;
    run.player.weapons[0].ammo = 0;
    run.player.weapons[0].reloading = true;
    run.position.x = 99;
    run.clearedRooms.push(1);
    run.loot[0].x = 50;
    run.stats.kills = 7;
    expect(captured.player.hp).toBe(100);
    expect(captured.player.weapons[0].ammo).toBe(-1);
    expect(captured.player.weapons[0].reloading).toBe(false);
    expect(captured.position.x).toBe(3);
    expect(captured.clearedRooms).toEqual([0]);
    expect(captured.loot[0].x).toBe(2);
    expect(captured.stats.kills).toBe(0);
    // The captured frame is still a valid save payload.
    expect(Object.keys(WEAPONS)).toContain(captured.player.weaponKey);
  });
});
