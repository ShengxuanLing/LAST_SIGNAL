// Real unit tests for the pure logic that the playability loop depends on.
// Closes the baseline gap where `npm test` exited 1 with "No test files found".
import { describe, it, expect } from 'vitest';
import { isoToScreen, screenToIso, IsoMath } from './iso';
import { applyUpgrade, UPGRADES, UPGRADE_LIST } from '../config/upgrades';
import { basePlayerData, GAME } from '../config/game';
import { validate } from '../systems/SaveSystem';
import type { PlayerData, SaveData } from '../types';

function playerData(): PlayerData {
  return {
    ...basePlayerData(), level: 1, xp: 0, xpToNext: 30, currency: 0,
    weaponKey: 'pulse',
    weapons: [{ key: 'pulse', level: 1, ammo: -1, magazine: -1, reloading: false, reloadTimer: 0 }],
    upgrades: [], abilities: []
  } as PlayerData;
}

function save(): SaveData {
  return {
    version: 1, createdAt: '', updatedAt: '',
    permanent: {
      maxHpBonus: 0, speedBonus: 0, damageBonus: 0, critChanceBonus: 0, armorBonus: 0,
      xpBonus: 0, currencyBonus: 0, unlockedWeapons: ['pulse'], unlockedAbilities: [],
      runs: 0, bossesDefeated: 0, bestSeed: 0
    },
    settings: { masterVolume: 0.7, sfxVolume: 0.8, mouseDpi: 1, fullscreen: false, screenShake: true },
    stats: { enemiesKilled: 0, itemsCollected: 0, damageDealt: 0, playTimeSeconds: 0 }
  };
}

describe('iso projection', () => {
  it('round-trips a grid point through screen space', () => {
    const g = { x: 17.5, y: 45.25 };
    const s = isoToScreen(g.x, g.y);
    const back = screenToIso(s.x, s.y);
    expect(back.x).toBeCloseTo(g.x, 6);
    expect(back.y).toBeCloseTo(g.y, 6);
  });

  it('uses the 64x32 isometric grid', () => {
    expect(IsoMath.TILE_W).toBe(64);
    expect(IsoMath.TILE_H).toBe(32);
    expect(GAME.TILE_W).toBe(64);
    expect(GAME.TILE_H).toBe(32);
    expect(isoToScreen(1, 0)).toEqual({ x: 32, y: 16 });
    expect(isoToScreen(0, 1)).toEqual({ x: -32, y: 16 });
  });
});

describe('applyUpgrade', () => {
  it('actually mutates PlayerData for every one of the 12 definitions', () => {
    expect(UPGRADE_LIST.length).toBe(12);
    for (const def of UPGRADE_LIST) {
      const state = playerData();
      const before = JSON.stringify(state);
      applyUpgrade(def, state, 1);
      expect(JSON.stringify(state), `upgrade ${def.key} must change state`).not.toBe(before);
    }
  });

  it('power raises damage, vitality raises maxHp and heals the delta', () => {
    const a = playerData();
    applyUpgrade(UPGRADES.power, a, 1);
    expect(a.damage).toBeCloseTo(1.1, 6);

    const b = playerData();
    applyUpgrade(UPGRADES.vitality, b, 1);
    expect(b.maxHp).toBe(115);
    expect(b.hp).toBe(115);
  });
});

describe('validate', () => {
  it('accepts a complete save', () => {
    expect(validate(save())).toBe(true);
  });

  it('rejects malformed permanent numbers and non-array unlocks', () => {
    const bad = save() as any;
    bad.permanent.maxHpBonus = 'nope';
    expect(validate(bad)).toBe(false);

    const bad2 = save() as any;
    bad2.permanent.unlockedWeapons = 'pulse';
    expect(validate(bad2)).toBe(false);
  });

  it('rejects missing settings / stats instead of silently passing', () => {
    const bad = save() as any;
    delete bad.settings;
    expect(validate(bad)).toBe(false);
    expect(validate(null)).toBe(false);
    expect(validate({ version: 1 })).toBe(false);
  });
});
