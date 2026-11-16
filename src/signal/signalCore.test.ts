// P3-b — shared Signal pure rules (finite resources, relay, evidence).

import { describe, expect, it } from 'vitest';
import { SIGNAL_TUNING } from './signalTuning';
import { SLICE } from '../slice/tuning';
import {
  applyJamToRelay, chargeJam, chargeScan, clearJam, createRelayControl,
  createSignalResources, currentRelayState, evidenceExpiry, expireEvidence,
  jamBlocker, scanBlocker, scanDiscover, tickCooldowns, tickEnergyAccount,
  tickSignalResources, withinJamRange, withinScanRange
} from './signalCore';
import { buildRelayReading, exitOpen, nextBridge, relayOutput, relayState } from './relay';

describe('shared tuning (one set of numbers)', () => {
  it('slice SLICE values ARE the shared Signal values', () => {
    for (const key of ['ENERGY_MAX', 'REGEN_PER_SEC', 'REGEN_TICKS', 'SCAN_COST', 'SCAN_CD_TICKS',
      'SCAN_REVEAL_TICKS', 'SCAN_RADIUS', 'JAM_COST', 'JAM_CD_TICKS', 'JAM_DURATION_TICKS', 'JAM_RANGE'] as const) {
      expect(SLICE[key], key).toBe(SIGNAL_TUNING[key]);
    }
    expect([SIGNAL_TUNING.ENERGY_MAX, SIGNAL_TUNING.REGEN_PER_SEC, SIGNAL_TUNING.SCAN_COST,
      SIGNAL_TUNING.SCAN_CD_TICKS, SIGNAL_TUNING.SCAN_RADIUS, SIGNAL_TUNING.SCAN_REVEAL_TICKS,
      SIGNAL_TUNING.JAM_COST, SIGNAL_TUNING.JAM_CD_TICKS, SIGNAL_TUNING.JAM_DURATION_TICKS,
      SIGNAL_TUNING.JAM_RANGE]).toEqual([100, 5, 10, 120, 12, 480, 25, 480, 360, 6]);
  });
});

describe('independent finite energy accounts', () => {
  it('player and echo each start at 100 and never share a pool', () => {
    const player = createSignalResources('player');
    const echo = createSignalResources('echo');
    const spent = chargeScan(player);
    expect(player.energy.energy).toBe(100); // pure: no mutation
    expect(spent.energy.energy).toBe(90);
    expect(echo.energy.energy).toBe(100);
    expect(spent.actor).toBe('player');
  });

  it('regens 1 per 12 real ticks, caps at 100 and does NOT regen while paused', () => {
    let account = { energy: 90, regenAcc: 0 };
    for (let i = 0; i < 11; i++) account = tickEnergyAccount(account, false);
    expect(account).toEqual({ energy: 90, regenAcc: 11 });
    account = tickEnergyAccount(account, false);
    expect(account).toEqual({ energy: 91, regenAcc: 0 });
    const paused = tickEnergyAccount(account, true);
    expect(paused).toEqual(account);
    const full = tickEnergyAccount({ energy: 100, regenAcc: 7 }, false);
    expect(full).toEqual({ energy: 100, regenAcc: 0 });
  });

  it('cooldown decay is tick-based and paused ticks change nothing', () => {
    const cd = { scanCooldownTicks: 2, scanRevealTicks: 1, jamCooldownTicks: 1, jamRemainingTicks: 1 };
    expect(tickCooldowns(cd, true)).toEqual(cd);
    expect(tickCooldowns(cd, false)).toEqual({
      scanCooldownTicks: 1, scanRevealTicks: 0, jamCooldownTicks: 0, jamRemainingTicks: 0
    });
    expect(tickSignalResources(createSignalResources('echo'), true)).toEqual(createSignalResources('echo'));
  });
});

describe('scan / jam gate and charge', () => {
  it('scan costs 10, CD 120, reveal 480 and an empty scan still charges', () => {
    const base = createSignalResources('player');
    expect(scanBlocker(base, false, false)).toBeNull();
    const charged = chargeScan(base);
    expect(charged.energy.energy).toBe(90);
    expect(charged.cooldowns.scanCooldownTicks).toBe(120);
    expect(charged.cooldowns.scanRevealTicks).toBe(480);
    expect(scanBlocker(charged, false, false)).toBe('E_COOLDOWN');
    expect(scanBlocker(base, true, false)).toBe('E_PAUSED');
    expect(scanBlocker(base, false, true)).toBe('E_PERMISSION');
    const low = { ...base, energy: { energy: 9, regenAcc: 0 } };
    expect(scanBlocker(low, false, false)).toBe('E_ENERGY_INSUFFICIENT');
  });

  it('jam costs 25, CD 480, duration 360 and guard-jam keeps the relay countdown', () => {
    const base = createSignalResources('echo');
    expect(jamBlocker(base, false, false)).toBeNull();
    const charged = chargeJam(base);
    expect(charged.energy.energy).toBe(75);
    expect(charged.cooldowns.jamCooldownTicks).toBe(480);
    expect(charged.cooldowns.jamRemainingTicks).toBe(360);
    expect(jamBlocker(charged, false, false)).toBe('E_RETRYABLE');
    const guardOnly = chargeJam(base, false);
    expect(guardOnly.cooldowns.jamRemainingTicks).toBe(0);
    expect(jamBlocker(guardOnly, false, false)).toBe('E_COOLDOWN');
  });
});

describe('scan discovery / evidence TTL', () => {
  it('uses 12-tile radius + LOS, records actor provenance and expires at tick+480', () => {
    const center = { x: 0, y: 0 };
    const los = () => true;
    expect(withinScanRange(center, { x: 11, y: 0 }, los)).toBe(true);
    expect(withinScanRange(center, { x: 13, y: 0 }, los)).toBe(false);
    expect(withinJamRange(center, { x: 5, y: 0 }, los)).toBe(true);
    expect(withinJamRange(center, { x: 7, y: 0 }, los)).toBe(false);
    expect(withinScanRange(center, { x: 1, y: 0 }, () => false)).toBe(false);

    const found = scanDiscover(center, [
      { id: 'relay', kind: 'relay', x: 1, y: 0 },
      { id: 'hidden', kind: 'relay', x: 2, y: 0 },
      { id: 'far', kind: 'relay', x: 40, y: 0 }
    ], (x) => x < 1.5, 10, 'echo');
    expect(found.map((e) => e.id)).toEqual(['relay']);
    expect(found[0]).toMatchObject({
      observedAtTick: 10, expiresAtTick: evidenceExpiry(10), observerActorId: 'echo'
    });
    expect(expireEvidence(found, 10 + 479)).toHaveLength(1);
    expect(expireEvidence(found, 10 + 480)).toHaveLength(0);
  });
});

describe('relay state / JAM suppression', () => {
  it('JAM suppresses emission; it is NOT a toggle and does NOT restore power', () => {
    const off = createRelayControl();
    expect(currentRelayState(off, 0)).toBe('INACTIVE');
    const jammed = applyJamToRelay(off, 100);
    expect(currentRelayState(jammed, 100)).toBe('JAMMED');
    expect(currentRelayState(jammed, 100 + SIGNAL_TUNING.JAM_DURATION_TICKS)).toBe('INACTIVE');
    expect(jammed.manualEnabled).toBe(false);
    expect(jammed.powered).toBe(true);
    expect(relayOutput(currentRelayState(jammed, 100))).toBe(false);
    expect(exitOpen(currentRelayState(jammed, 100))).toBe(false);
    // Clearing JAM does not auto-enable: a manual owner toggle is still needed.
    const cleared = clearJam(jammed);
    expect(currentRelayState(cleared, 100)).toBe('INACTIVE');
    const enabled = { ...cleared, manualEnabled: true };
    expect(currentRelayState(enabled, 100)).toBe('ACTIVE');
    expect(exitOpen(currentRelayState(enabled, 100))).toBe(true);
  });

  it('relayState / buildRelayReading / nextBridge keep slice semantics', () => {
    expect(relayState(true, true, true, false)).toBe('JAMMED');
    expect(relayState(true, true, false, false)).toBe('ACTIVE');
    expect(relayState(false, true, false, false)).toBe('INACTIVE');
    expect(relayState(true, true, false, true)).toBe('DISABLED');
    const reading = buildRelayReading(false, true, 'JAMMED', 'UNAVAILABLE', 0);
    expect(reading.effectiveOutput).toBe(false);
    expect(reading.bridgeFeed).toBe(false);
    expect(reading.bridgePassable).toBe(false);
    expect(Object.isFrozen(reading)).toBe(true);
    const transition = nextBridge({ bridge: 'UNAVAILABLE', deadline: 0 }, true, 5, 30);
    expect(transition).toEqual({ bridge: 'TRANSITIONING', deadline: 35 });
    expect(nextBridge(transition, false, 10, 30)).toEqual({ bridge: 'UNAVAILABLE', deadline: 0 });
  });
});

describe('validSignalResources (checkpoint-safe)', () => {
  it('accepts normal runtime spend/cooldowns and rejects over-range or free skills', async () => {
    const { validSignalResources } = await import('./signalCore');
    expect(validSignalResources(createSignalResources('echo'))).toBe(true);
    const spent = chargeJam(chargeScan(createSignalResources('player')));
    expect(validSignalResources(spent)).toBe(true);
    const tampered = [
      { ...createSignalResources('echo'), energy: { energy: 9999, regenAcc: 0 } },
      { ...createSignalResources('echo'), energy: { energy: -1, regenAcc: 0 } },
      { ...createSignalResources('echo'), cooldowns: { scanCooldownTicks: 999, scanRevealTicks: 0, jamCooldownTicks: 0, jamRemainingTicks: 0 } },
      { ...createSignalResources('echo'), upgrades: [{ key: 'power', level: 3 }] },
      { ...createSignalResources('echo'), abilities: ['dash'] },
      { ...createSignalResources('echo'), actor: 'boss' }
    ];
    for (const value of tampered) expect(validSignalResources(value)).toBe(false);
  });
});

describe('single-gate scan/jam charge and strict Signal DTO', () => {
  it('charges exactly once, never negative, and checks scenario permission first', async () => {
    const m = await import('./signalCore');
    const base = m.createSignalResources('echo');
    const denied = m.tryScan(base, false, false, false);
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.code).toBe('E_PERMISSION');
    expect(base.energy.energy).toBe(100);
    const first = m.tryScan(base, false, false, true);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.resources.energy.energy).toBe(90);
    const second = m.tryScan(first.resources, false, false, true);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe('E_COOLDOWN');
    expect(first.resources.energy.energy, 'no double deduction').toBe(90);
    const jam = m.tryJam(first.resources, false, false, true);
    expect(jam.ok).toBe(true);
    if (!jam.ok) return;
    expect(jam.resources.energy.energy).toBe(65);
    expect(jam.resources.energy.energy).toBeGreaterThanOrEqual(0);
  });

  it('rejects nested free / hiddenTarget extras in checkpoint Signal state', async () => {
    const m = await import('./signalCore');
    const base = m.createSignalResources('player') as unknown as Record<string, unknown>;
    const withFree = { ...base, free: { energy: 9999 } };
    expect(m.validSignalResources(withFree)).toBe(false);
    const nested = { ...base, energy: { energy: 50, regenAcc: 0, free: true } };
    expect(m.validSignalResources(nested)).toBe(false);
    expect(m.validSignalResources(base)).toBe(true);
  });
});
