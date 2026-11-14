import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { basePlayerData } from './game';
import {
  LOAN_WEAPONS, SUPPLY_PRICES, applySupply, clearReward, isSupplyOfferKey,
  loanWeaponFor, supplyOfferPurchaseBlocker, supplyPrice, terminalRooms
} from './supplies';
import type { PlayerData, Room } from '../types';

function player(overrides: Partial<PlayerData> = {}): PlayerData {
  const base = basePlayerData();
  return {
    ...base,
    level: 1, xp: 0, xpToNext: 30, currency: 100,
    weaponKey: 'pulse',
    weapons: [{ key: 'pulse', level: 1, ammo: -1, magazine: -1, reloading: false, reloadTimer: 0 }],
    upgrades: [], abilities: [],
    ...overrides
  } as PlayerData;
}

function room(id: number, kind: Room['kind'], connectedTo: number[] = []): Room {
  return { id, kind, gx: id * 20, gy: 0, w: 10, h: 8, connectedTo, cleared: false, spawned: false };
}

describe('supply offer config', () => {
  it('prices are fixed config values and not caller-parameterised', () => {
    expect(Object.isFrozen(SUPPLY_PRICES)).toBe(true);
    expect(supplyPrice('repair')).toBe(16);
    expect(supplyPrice('calibration')).toBe(28);
    expect(supplyPrice('weapon')).toBe(40);
  });

  it('only stable offer keys are legal', () => {
    expect(isSupplyOfferKey('repair')).toBe(true);
    expect(isSupplyOfferKey('calibration')).toBe(true);
    expect(isSupplyOfferKey('weapon')).toBe(true);
    expect(isSupplyOfferKey('bogus')).toBe(false);
    expect(isSupplyOfferKey('weapon:scatter')).toBe(false);
  });

  it('loan weapon is deterministic from seed + room and inside the pool', () => {
    for (const seed of [1, 424242, 999]) {
      for (const roomId of [0, 1, 2, 3]) {
        const key = loanWeaponFor(seed, roomId);
        expect(LOAN_WEAPONS).toContain(key);
        expect(loanWeaponFor(seed, roomId)).toBe(key);
      }
    }
  });

  it('terminal rooms cover shop/elite and the first rewarded room after start', () => {
    const rooms = [room(0, 'start', [1, 2]), room(1, 'combat'), room(2, 'shop'), room(3, 'elite')];
    const terminals = terminalRooms(rooms);
    expect(terminals.has(2)).toBe(true); // shop
    expect(terminals.has(3)).toBe(true); // elite
    expect(terminals.has(1)).toBe(true); // first connected room with reward > 0
    expect(terminals.has(0)).toBe(false);
    expect(clearReward(room(1, 'combat'))).toBe(12);
    expect(clearReward(room(3, 'elite'))).toBe(24);
    expect(clearReward(room(0, 'start'))).toBe(0);
  });

  it('purchase blockers reflect real eligibility and balance', () => {
    expect(supplyOfferPurchaseBlocker('repair', player({ hp: 100, maxHp: 100 }), 1, 1)).toBe('Health full');
    expect(supplyOfferPurchaseBlocker('repair', player({ hp: 50, maxHp: 100 }), 1, 1)).toBeUndefined();
    expect(supplyOfferPurchaseBlocker('weapon', player({ currency: 0 }), 1, 1)).toBe('Not enough credits');
    const owned = loanWeaponFor(1, 1);
    const withLoan = player({ weapons: [
      { key: 'pulse', level: 1, ammo: -1, magazine: -1, reloading: false, reloadTimer: 0 },
      { key: owned, level: 1, ammo: -1, magazine: -1, reloading: false, reloadTimer: 0 }
    ] });
    expect(supplyOfferPurchaseBlocker('weapon', withLoan, 1, 1)).toBe('Already owned');
  });

  it('applySupply repairs (capped), calibrates the equipped weapon, and adds the loan', () => {
    const hp = player({ hp: 90, maxHp: 100 });
    applySupply('repair', hp, 1, 1);
    expect(hp.hp).toBe(100);

    const cal = player({ weapons: [{ key: 'scatter', level: 1, ammo: 8, magazine: 8, reloading: false, reloadTimer: 0 }], weaponKey: 'scatter' });
    applySupply('calibration', cal, 1, 1);
    expect(cal.weapons[0].level).toBe(2);

    const buy = player();
    applySupply('weapon', buy, 1, 1);
    expect(buy.weapons.some((w) => w.key === loanWeaponFor(1, 1))).toBe(true);
    expect(buy.weaponKey).toBe(loanWeaponFor(1, 1));
  });

  it('does not import DOM/Phaser (pure config)', () => {
    const source = readFileSync(new URL('./supplies.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/from ['"]phaser/);
    expect(source).not.toMatch(/\b(?:document|window)\./);
  });
});
