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

// P3-a: optional echo actor in the checkpoint frame.
function echoFrame() {
  const run = makeRun();
  run.coreState = {
    tick: 120, rngState: 999, nextProjectileId: 4, purchaseTransactions: [],
    playerTimers: { dashTimer: 0, invuln: 0, hurtTimer: 0, fireTimer: 0.1, aimYaw: 0.5 },
    echo: {
      actorId: 1, x: 5, y: 6,
      data: { ...run.player, hp: 80, maxHp: 100, currency: 0, upgrades: [], abilities: [] },
      dashTimer: 0, invuln: 0, hurtTimer: 0, fireTimer: 0.2, aimYaw: 1
    }
  };
  return run;
}

describe('checkpoint echo actor', () => {
  it('round-trips a valid echo frame without sharing the live object', () => {
    const run = echoFrame();
    expect(validateCheckpoint(run)).toBe(true);
    const captured = cloneCheckpoint(run);
    expect(validateCheckpoint(captured)).toBe(true);
    expect(captured.coreState!.echo).not.toBe(run.coreState!.echo);
    // Mutating the live frame must not change the captured one.
    run.coreState!.echo!.x = 99;
    run.coreState!.echo!.data.hp = 1;
    expect(captured.coreState!.echo!.x).toBe(5);
    expect(captured.coreState!.echo!.data.hp).toBe(80);
  });

  it('accepts normal runtime damage, angles, positions and weapon/hit timers', () => {
    const run = echoFrame();
    const echo = run.coreState!.echo!;
    echo.data.hp = 1;                 // survived a real hit
    echo.data.aimYaw = -2.5;          // facing is runtime state
    echo.x = 12.25;
    echo.y = -3.5;
    echo.invuln = 0.5;
    echo.hurtTimer = 0.25;
    echo.fireTimer = 0.3;
    echo.dashTimer = 0.1;
    echo.aimYaw = 1.2;
    echo.data.weapons[0].reloadTimer = 0.2;
    expect(validateCheckpoint(run)).toBe(true);
    const playerUpgrades = makeRun();
    playerUpgrades.player.upgrades.push({ key: 'power', level: 3 });
    expect(validateCheckpoint(playerUpgrades), 'player upgrades are still legal').toBe(true);
  });

  it('old saves without an echo stay valid (solo compatibility)', () => {
    const run = makeRun();
    run.coreState = {
      tick: 1, rngState: 1, nextProjectileId: 1, purchaseTransactions: [],
      playerTimers: { dashTimer: 0, invuln: 0, hurtTimer: 0, fireTimer: 0, aimYaw: 0 }
    };
    expect(validateCheckpoint(run)).toBe(true);
    expect(cloneCheckpoint(run).coreState!.echo).toBeUndefined();
  });

  it('rejects malformed echo payloads', () => {
    const bad = [
      { hp: -1, maxHp: 100 },
      { hp: 101, maxHp: 100 },
      { hp: 10, maxHp: 0 }
    ];
    for (const data of bad) {
      const run = echoFrame();
      run.coreState!.echo!.data.hp = data.hp;
      run.coreState!.echo!.data.maxHp = data.maxHp;
      expect(validateCheckpoint(run)).toBe(false);
    }
    // Every absolute-upper-bound-only tamper that Reviewer/Tester flagged must
    // now be rejected: base stats are EXACT, not merely <= an arbitrary cap.
    const tampered: Array<[string, number]> = [
      ['damage', 99], ['hpRegen', 50], ['cooldownReduced', 1], ['critDamage', 99],
      ['pierceCount', 10], ['speed', 1000], ['armor', 1000], ['pickupRange', 1000],
      ['xpGain', 100], ['maxHp', 10000]
    ];
    for (const [key, value] of tampered) {
      const bad = echoFrame();
      (bad.coreState!.echo!.data as unknown as Record<string, number>)[key] = value;
      expect(validateCheckpoint(bad), `${key}=${value} must be rejected`).toBe(false);
    }
    const tamperedXp = echoFrame();
    tamperedXp.coreState!.echo!.data.xp = 100;
    expect(validateCheckpoint(tamperedXp)).toBe(false);
    const tamperedCurrency = echoFrame();
    tamperedCurrency.coreState!.echo!.data.currency = 100;
    expect(validateCheckpoint(tamperedCurrency)).toBe(false);
    const tamperedSkills = echoFrame();
    tamperedSkills.coreState!.echo!.data.upgrades.push({ key: 'damage', level: 1 });
    expect(validateCheckpoint(tamperedSkills), 'no free upgrades from a save').toBe(false);
    const tamperedWeapon = echoFrame();
    tamperedWeapon.coreState!.echo!.data.weapons.push({ key: 'scatter', level: 1, ammo: 8, magazine: 8, reloading: false, reloadTimer: 0 });
    expect(validateCheckpoint(tamperedWeapon), 'no extra weapons from a save').toBe(false);
    const wrongWeapon = echoFrame();
    wrongWeapon.coreState!.echo!.data.weaponKey = 'scatter';
    expect(validateCheckpoint(wrongWeapon)).toBe(false);
    const notFinite = echoFrame();
    notFinite.coreState!.echo!.x = Number.NaN;
    expect(validateCheckpoint(notFinite)).toBe(false);
  });
});
