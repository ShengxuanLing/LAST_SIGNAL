// AI-NATIVE-02 P3-b — shared Signal finite-resource pure primitives.
//
// NO Phaser, NO DOM, NO facility map, NO second World. Both the frozen Station
// Zero slice and the future main-World Signal device call these functions, so
// energy/regen/cooldown/scan discovery/evidence TTL/JAM suppression cannot
// drift into two rule sets. Geometry (walls, LOS, device positions) is supplied
// by the caller as a predicate; this module never imports a slice map.

import { SIGNAL_TUNING } from './signalTuning';
import { relayState, type RelayState } from './relay';

export type SignalActorKind = 'player' | 'echo';
export type SignalBlockCode =
  | 'E_PAUSED' | 'E_PERMISSION' | 'E_COOLDOWN'
  | 'E_ENERGY_INSUFFICIENT' | 'E_RETRYABLE';

export interface SignalEnergyAccount {
  energy: number;
  regenAcc: number;
}

export interface SignalCooldownState {
  scanCooldownTicks: number;
  scanRevealTicks: number;
  jamCooldownTicks: number;
  jamRemainingTicks: number;
}

/** One actor's OWN resources. Player and ECHO never share a pool or ledger. */
export interface SignalResources {
  readonly actor: SignalActorKind;
  readonly energy: SignalEnergyAccount;
  readonly cooldowns: SignalCooldownState;
}

export interface SignalEvidence {
  readonly id: string;
  readonly kind: string;
  readonly x: number;
  readonly y: number;
  readonly observedAtTick: number;
  readonly expiresAtTick: number;
  readonly observerActorId: SignalActorKind;
}

export interface RelayControlState {
  readonly manualEnabled: boolean;
  readonly powered: boolean;
  readonly jammedUntilTick: number;
  readonly disposed: boolean;
}

export function createSignalResources(actor: SignalActorKind): SignalResources {
  return {
    actor,
    energy: { energy: SIGNAL_TUNING.ENERGY_MAX, regenAcc: 0 },
    cooldowns: {
      scanCooldownTicks: 0, scanRevealTicks: 0,
      jamCooldownTicks: 0, jamRemainingTicks: 0
    }
  };
}

/** Real fixed-tick regen: 1 energy per 12 ticks, capped; paused NEVER regens. */
export function tickEnergyAccount(account: SignalEnergyAccount, paused: boolean): SignalEnergyAccount {
  if (paused) return { ...account };
  if (account.energy >= SIGNAL_TUNING.ENERGY_MAX) return { energy: account.energy, regenAcc: 0 };
  const regenAcc = account.regenAcc + 1;
  if (regenAcc < SIGNAL_TUNING.REGEN_TICKS) return { energy: account.energy, regenAcc };
  const energy = account.energy + 1;
  return { energy, regenAcc: energy >= SIGNAL_TUNING.ENERGY_MAX ? 0 : regenAcc - SIGNAL_TUNING.REGEN_TICKS };
}

/** Fixed-tick cooldown/expiry decay. Paused ticks do not advance anything. */
export function tickCooldowns(cooldowns: SignalCooldownState, paused: boolean): SignalCooldownState {
  if (paused) return { ...cooldowns };
  const dec = (value: number): number => Math.max(0, value - 1);
  return {
    scanCooldownTicks: dec(cooldowns.scanCooldownTicks),
    scanRevealTicks: dec(cooldowns.scanRevealTicks),
    jamCooldownTicks: dec(cooldowns.jamCooldownTicks),
    jamRemainingTicks: dec(cooldowns.jamRemainingTicks)
  };
}

export function tickSignalResources(resources: SignalResources, paused: boolean): SignalResources {
  return {
    actor: resources.actor,
    energy: tickEnergyAccount(resources.energy, paused),
    cooldowns: tickCooldowns(resources.cooldowns, paused)
  };
}

export function scanBlocker(
  resources: SignalResources, paused: boolean, failed: boolean
): SignalBlockCode | null {
  if (paused) return 'E_PAUSED';
  if (failed) return 'E_PERMISSION';
  if (resources.cooldowns.scanCooldownTicks > 0) return 'E_COOLDOWN';
  if (resources.energy.energy < SIGNAL_TUNING.SCAN_COST) return 'E_ENERGY_INSUFFICIENT';
  return null;
}

export function jamBlocker(
  resources: SignalResources, paused: boolean, failed: boolean,
  active = resources.cooldowns.jamRemainingTicks > 0
): SignalBlockCode | null {
  if (paused) return 'E_PAUSED';
  if (failed) return 'E_PERMISSION';
  if (active) return 'E_RETRYABLE';
  if (resources.cooldowns.jamCooldownTicks > 0) return 'E_COOLDOWN';
  if (resources.energy.energy < SIGNAL_TUNING.JAM_COST) return 'E_ENERGY_INSUFFICIENT';
  return null;
}

/** An empty scan is legal and STILL costs 10 energy (slice R1 semantics). */
export function chargeScan(resources: SignalResources): SignalResources {
  return {
    actor: resources.actor,
    energy: { ...resources.energy, energy: resources.energy.energy - SIGNAL_TUNING.SCAN_COST },
    cooldowns: {
      ...resources.cooldowns,
      scanCooldownTicks: SIGNAL_TUNING.SCAN_CD_TICKS,
      scanRevealTicks: SIGNAL_TUNING.SCAN_REVEAL_TICKS
    }
  };
}

export function chargeJam(resources: SignalResources, affectsDevice = true): SignalResources {
  return {
    actor: resources.actor,
    energy: { ...resources.energy, energy: resources.energy.energy - SIGNAL_TUNING.JAM_COST },
    cooldowns: {
      ...resources.cooldowns,
      jamCooldownTicks: SIGNAL_TUNING.JAM_CD_TICKS,
      jamRemainingTicks: affectsDevice
        ? SIGNAL_TUNING.JAM_DURATION_TICKS
        : resources.cooldowns.jamRemainingTicks
    }
  };
}

/** Evidence is actor-local and expires by absolute tick, never by wall clock. */
export function evidenceExpiry(tick: number): number {
  return tick + SIGNAL_TUNING.SCAN_REVEAL_TICKS;
}

export function expireEvidence(evidence: readonly SignalEvidence[], tick: number): SignalEvidence[] {
  return evidence.filter((entry) => tick < entry.expiresAtTick);
}

/** One shared bounded range + LOS predicate (radius is owned here, map is not). */
export function withinSignalRange(
  center: { x: number; y: number }, target: { x: number; y: number },
  radius: number, hasLineOfSight: (x: number, y: number) => boolean
): boolean {
  return Math.hypot(center.x - target.x, center.y - target.y) < radius
    && hasLineOfSight(target.x, target.y);
}

export function withinScanRange(
  center: { x: number; y: number }, target: { x: number; y: number },
  hasLineOfSight: (x: number, y: number) => boolean
): boolean {
  return withinSignalRange(center, target, SIGNAL_TUNING.SCAN_RADIUS, hasLineOfSight);
}

export function withinJamRange(
  center: { x: number; y: number }, target: { x: number; y: number },
  hasLineOfSight: (x: number, y: number) => boolean
): boolean {
  return withinSignalRange(center, target, SIGNAL_TUNING.JAM_RANGE, hasLineOfSight);
}

export function scanDiscover<T extends { id: string; kind: string; x: number; y: number }>(
  center: { x: number; y: number }, entries: readonly T[],
  hasLineOfSight: (x: number, y: number) => boolean,
  tick: number, observerActorId: SignalActorKind
): SignalEvidence[] {
  return entries
    .filter((entry) => withinScanRange(center, entry, hasLineOfSight))
    .map((entry) => ({
      id: entry.id, kind: entry.kind, x: entry.x, y: entry.y,
      observedAtTick: tick,
      expiresAtTick: evidenceExpiry(tick),
      observerActorId
    }));
}

/** JAM suppresses emission; it never counts as a manual toggle or as power. */
export function applyJamToRelay(control: RelayControlState, tick: number): RelayControlState {
  return { ...control, jammedUntilTick: tick + SIGNAL_TUNING.JAM_DURATION_TICKS };
}

export function clearJam(control: RelayControlState): RelayControlState {
  return { ...control, jammedUntilTick: 0 };
}

export function currentRelayState(control: RelayControlState, tick: number): RelayState {
  return relayState(
    control.manualEnabled, control.powered,
    tick < control.jammedUntilTick, control.disposed
  );
}

export function createRelayControl(overrides: Partial<RelayControlState> = {}): RelayControlState {
  return { manualEnabled: false, powered: true, jammedUntilTick: 0, disposed: false, ...overrides };
}

/**
 * Checkpoint-safe validation for the future core Signal state: finite resource
 * ranges are EXACT (no `energy=9999`, no negative cooldowns) and no free-skill
 * fields can be injected. Runtime values (energy/timers) may vary within the
 * real bounds; this is NOT a per-frame equality check.
 */
export function validSignalResources(value: unknown): value is SignalResources {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  if (v.actor !== 'player' && v.actor !== 'echo') return false;
  for (const forbidden of ['upgrades', 'abilities', 'weaponKey', 'maxHp', 'damage']) {
    if (forbidden in v) return false;
  }
  const energy = v.energy as Record<string, unknown> | undefined;
  const cd = v.cooldowns as Record<string, unknown> | undefined;
  if (!energy || typeof energy !== 'object' || !cd || typeof cd !== 'object') return false;
  const intRange = (n: unknown, max: number): boolean =>
    typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 && n <= max;
  return intRange(energy.energy, SIGNAL_TUNING.ENERGY_MAX)
    && intRange(energy.regenAcc, SIGNAL_TUNING.REGEN_TICKS - 1)
    && intRange(cd.scanCooldownTicks, SIGNAL_TUNING.SCAN_CD_TICKS)
    && intRange(cd.scanRevealTicks, SIGNAL_TUNING.SCAN_REVEAL_TICKS)
    && intRange(cd.jamCooldownTicks, SIGNAL_TUNING.JAM_CD_TICKS)
    && intRange(cd.jamRemainingTicks, SIGNAL_TUNING.JAM_DURATION_TICKS);
}
