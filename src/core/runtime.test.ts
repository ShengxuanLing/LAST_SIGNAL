// Real unit tests for the pure logic that the playability loop depends on.
// Closes the baseline gap where `npm test` exited 1 with "No test files found".
import { describe, it, expect } from 'vitest';
import { isoToScreen, screenToIso, IsoMath } from './iso';
import { applyUpgrade, UPGRADES, UPGRADE_LIST } from '../config/upgrades';
import { basePlayerData, GAME, SAVE_KEY } from '../config/game';
import { SaveSystem, validate } from '../systems/SaveSystem';
import { SAVE_VERSION, type PlayerData, type RunCheckpoint, type SaveData } from '../types';

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
    version: SAVE_VERSION, createdAt: '', updatedAt: '',
    permanent: {
      maxHpBonus: 0, speedBonus: 0, damageBonus: 0, critChanceBonus: 0, armorBonus: 0,
      xpBonus: 0, currencyBonus: 0, unlockedWeapons: ['pulse'], unlockedAbilities: [],
      cores: 0, runs: 0, bossesDefeated: 0, bestSeed: 0
    },
    settings: { masterVolume: 0.7, sfxVolume: 0.8, mouseDpi: 1, fullscreen: false, screenShake: true },
    stats: { enemiesKilled: 0, itemsCollected: 0, damageDealt: 0, playTimeSeconds: 0 }
  };
}

describe('run and permanent saves', () => {
  function storage(initial?: unknown) {
    const data = new Map<string, string>();
    if (initial) data.set(SAVE_KEY, JSON.stringify(initial));
    const store: Storage = {
      get length() { return data.size; },
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => { data.set(key, value); },
      removeItem: (key) => { data.delete(key); },
      clear: () => data.clear(),
      key: (index) => [...data.keys()][index] ?? null
    };
    return new SaveSystem({ useStorage: () => store });
  }

  function checkpoint(): RunCheckpoint {
    return {
      id: 'run-a', seed: 8, roomId: 0, position: { x: 4, y: 4 }, clearedRooms: [0],
      portalTarget: 1, rngState: 10, loot: [],
      player: { ...playerData(), currency: 42, upgrades: [{ key: 'power', level: 1 }] },
      stats: { kills: 3, items: 2, damage: 70, elapsedSeconds: 20 }
    };
  }

  it('migrates the previous profile without turning old ranks into currency', () => {
    const previous = save();
    const { cores, ...permanent } = previous.permanent;
    const system = storage({ ...previous, version: 1, permanent: { ...permanent, armorBonus: 3 } });
    expect(system.load()).toMatchObject({ version: SAVE_VERSION, permanent: { cores: 0, armorBonus: 3 } });
    expect(system.writeCheckpoint(checkpoint(), undefined)).toBe(true);
    expect(system.load().run?.player.currency).toBe(42);
    expect(system.load().permanent.damageBonus).toBe(0);
  });

  it('keeps the profile if the run is corrupt and rejects invalid writes', () => {
    const invalid = { ...checkpoint(), player: { ...playerData(), xpToNext: 0 } };
    const system = storage({ ...save(), permanent: { ...save().permanent, cores: 4 }, run: invalid });
    expect(system.load().run).toBeUndefined();
    expect(system.load().permanent.cores).toBe(4);
    expect(system.writeCheckpoint(invalid, undefined)).toBe(false);
  });

  it('clears completed runs, awards one core only on victory and rejects stale writes', () => {
    const system = storage();
    const run = checkpoint();
    expect(system.writeCheckpoint(run, undefined)).toBe(true);
    expect(system.writeCheckpoint({ ...run, id: 'run-b' }, run.id)).toBe(true);
    expect(system.writeCheckpoint(run, run.id)).toBe(false);
    expect(system.finishRun(run.id, true, run.seed, run.stats)).toBe(false);
    expect(system.finishRun('run-b', true, run.seed, run.stats)).toBe(true);
    expect(system.finishRun('run-b', true, run.seed, run.stats)).toBe(false);
    expect(system.load()).toMatchObject({ permanent: { cores: 1, bossesDefeated: 1, damageBonus: 0 }, stats: { itemsCollected: 2 } });
    expect(system.load().run).toBeUndefined();
    expect(system.buyTalent('damageBonus')).toBe(true);
    expect(system.buyTalent('damageBonus')).toBe(false);
    expect(system.writeCheckpoint(run, undefined)).toBe(true);
    expect(system.finishRun(run.id, false, run.seed, run.stats)).toBe(true);
    expect(system.load().permanent).toMatchObject({ cores: 0, bossesDefeated: 1, damageBonus: 1, runs: 2 });
  });
});

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
