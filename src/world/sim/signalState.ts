// AI-NATIVE-02 P3-b B — authoritative Signal device state (pure, core-side).
//
// ONE optional device in ONE real room. Player and ECHO own INDEPENDENT finite
// energy accounts but share the same pure rules from src/signal. Every mutation
// is performed by the core tick (processCommands); adapters only enqueue
// commands. No Phaser, no map copy, no gameplay rebalance.

import {
  tryScan, tryJam, tickSignalResources, createSignalResources,
  scanDiscover, expireEvidence, currentRelayState, clearJam,
  createRelayControl, applyJamToRelay, withinScanRange, withinJamRange,
  validSignalResources, type SignalResources, type SignalEvidence, type RelayControlState
} from '../../signal/signalCore';
import { SIGNAL_TUNING } from '../../signal/signalTuning';
import { exitOpen, relayOutput, type RelayState } from '../../signal/relay';

export interface SimSignalDevice {
  readonly deviceId: string;
  readonly roomId: number;
  readonly x: number;
  readonly y: number;
  control: RelayControlState;
  /** Derived from control + tick; kept in canonical state for byte parity. */
  relay: RelayState;
  /** Owner-confirmed manual toggle intent; JAM never toggles this. */
  manualEnabled: boolean;
  powered: boolean;
  jammedUntilTick: number;
  /** Independent finite resources, same rules for both actors. */
  actors: { player: SignalResources; echo: SignalResources };
  evidence: SignalEvidence[];
}

export function createSignalDevice(input: {
  deviceId: string; roomId: number; x: number; y: number; tick: number;
}): SimSignalDevice {
  const control = createRelayControl();
  return {
    deviceId: input.deviceId,
    roomId: input.roomId,
    x: input.x,
    y: input.y,
    control,
    relay: currentRelayState(control, input.tick),
    manualEnabled: control.manualEnabled,
    powered: control.powered,
    jammedUntilTick: 0,
    actors: {
      player: createSignalResources('player'),
      echo: createSignalResources('echo')
    },
    evidence: []
  };
}

export type SignalActorKind = 'player' | 'echo';

export interface SignalCommandResult {
  ok: boolean;
  code?: string;
  energy?: number;
  cooldownTicks?: number;
  found?: boolean;
  relay?: RelayState;
}

/** Legal perception predicate is supplied by the caller (rendered/headless). */
export interface SignalLegality {
  hasLineOfSight: (x: number, y: number) => boolean;
  actorPosition: (actor: SignalActorKind) => { x: number; y: number } | null;
}

function legalScan(device: SimSignalDevice, actor: SignalActorKind, legality: SignalLegality): boolean {
  const pos = legality.actorPosition(actor);
  if (!pos) return false;
  return withinScanRange(pos, device, (x, y) => legality.hasLineOfSight(x, y));
}
function legalJam(device: SimSignalDevice, actor: SignalActorKind, legality: SignalLegality): boolean {
  const pos = legality.actorPosition(actor);
  if (!pos) return false;
  return withinJamRange(pos, device, (x, y) => legality.hasLineOfSight(x, y));
}

/** Commit a SCAN: single blocker, single charge, actor-local evidence TTL. */
export function commitSignalScan(
  device: SimSignalDevice, actor: SignalActorKind, tick: number,
  paused: boolean, legality: SignalLegality
): SignalCommandResult {
  const permitted = legalScan(device, actor, legality);
  const resources = device.actors[actor];
  const result = tryScan(resources, paused, false, permitted);
  if (!result.ok) return { ok: false, code: result.code };
  device.actors[actor] = result.resources;
  const pos = legality.actorPosition(actor)!;
  const found = scanDiscover(pos, [{
    id: device.deviceId, kind: 'relay', x: device.x, y: device.y
  }], (x, y) => legality.hasLineOfSight(x, y), tick, actor);
  device.evidence.push(...found);
  device.evidence = expireEvidence(device.evidence, tick);
  return {
    ok: true,
    found: found.length > 0,
    energy: result.resources.energy.energy,
    cooldownTicks: result.resources.cooldowns.scanCooldownTicks
  };
}

/** Commit a JAM: suppresses emission; never turns the relay ACTIVE. */
export function commitSignalJam(
  device: SimSignalDevice, actor: SignalActorKind, tick: number,
  paused: boolean, legality: SignalLegality
): SignalCommandResult {
  const permitted = legalJam(device, actor, legality);
  const resources = device.actors[actor];
  const result = tryJam(resources, paused, false, permitted);
  if (!result.ok) return { ok: false, code: result.code };
  device.actors[actor] = result.resources;
  const jammed = applyJamToRelay(device.control, tick);
  device.control = jammed;
  device.jammedUntilTick = jammed.jammedUntilTick;
  device.relay = currentRelayState(device.control, tick);
  return {
    ok: true,
    energy: result.resources.energy.energy,
    cooldownTicks: result.resources.cooldowns.jamCooldownTicks,
    relay: device.relay
  };
}

/** Human OWNER toggle. Powered and JAM state are preserved. */
export function commitToggleRelay(device: SimSignalDevice, enabled: boolean, tick: number): SignalCommandResult {
  device.manualEnabled = enabled;
  device.control = { ...device.control, manualEnabled: enabled, powered: device.powered };
  device.relay = currentRelayState(device.control, tick);
  return { ok: true, relay: device.relay };
}

export function commitSignalPower(device: SimSignalDevice, powered: boolean, tick: number): SignalCommandResult {
  device.powered = powered;
  device.control = { ...device.control, powered };
  device.relay = currentRelayState(device.control, tick);
  return { ok: true, relay: device.relay };
}

/** Fixed-tick resource/expiry/relay resolution. Paused ticks do not regen. */
export function tickSignalDevice(device: SimSignalDevice, tick: number, paused: boolean): RelayState | null {
  const previous = device.relay;
  device.actors.player = tickSignalResources(device.actors.player, paused);
  device.actors.echo = tickSignalResources(device.actors.echo, paused);
  const before = device.evidence.length;
  device.evidence = expireEvidence(device.evidence, tick);
  const expired = before > device.evidence.length;
  if (tick >= device.jammedUntilTick && device.control.jammedUntilTick !== 0) {
    device.control = clearJam(device.control);
    device.jammedUntilTick = 0;
  }
  device.relay = currentRelayState(device.control, tick);
  return expired || device.relay !== previous ? device.relay : null;
}

export function signalEvidenceVisible(device: SimSignalDevice, tick: number): boolean {
  return device.evidence.some((e) => tick < e.expiresAtTick);
}

export function signalExitOpen(device: SimSignalDevice | undefined): boolean {
  // No device => legacy portal behaviour is completely unchanged.
  return device ? exitOpen(device.relay) : true;
}

export function signalOutput(device: SimSignalDevice): boolean {
  return relayOutput(device.relay);
}

export const SIGNAL_LIMITS = SIGNAL_TUNING;


/** Strict checkpoint DTO validation (old saves have no signal at all). */
export function validSignalDevice(value: unknown): value is SimSignalDevice {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  const keys = ['deviceId', 'roomId', 'x', 'y', 'control', 'relay', 'manualEnabled', 'powered', 'jammedUntilTick', 'actors', 'evidence'];
  if (Object.keys(v).some((k) => !keys.includes(k))) return false;
  if (typeof v.deviceId !== 'string' || !v.deviceId || !Number.isInteger(v.roomId) ||
      typeof v.x !== 'number' || !Number.isFinite(v.x) || typeof v.y !== 'number' || !Number.isFinite(v.y)) return false;
  if (typeof v.manualEnabled !== 'boolean' || typeof v.powered !== 'boolean' ||
      typeof v.relay !== 'string' || !['ACTIVE', 'INACTIVE', 'JAMMED', 'DISABLED'].includes(v.relay) ||
      typeof v.jammedUntilTick !== 'number' || !Number.isFinite(v.jammedUntilTick) || v.jammedUntilTick < 0) return false;
  const control = v.control as Record<string, unknown> | undefined;
  if (!control || Object.keys(control).some((k) => !['manualEnabled', 'powered', 'jammedUntilTick', 'disposed'].includes(k))) return false;
  const actors = v.actors as Record<string, unknown> | undefined;
  if (!actors || !validSignalResources(actors.player) || !validSignalResources(actors.echo)) return false;
  if (!Array.isArray(v.evidence) || v.evidence.length > 64) return false;
  const evidenceKeys = ['id', 'kind', 'x', 'y', 'observedAtTick', 'expiresAtTick', 'observerActorId'];
  return v.evidence.every((entry) => {
    const e = entry as Record<string, unknown>;
    return !!e && typeof e === 'object' && !Array.isArray(e)
      && Object.keys(e).every((k) => evidenceKeys.includes(k))
      && typeof e.id === 'string' && typeof e.kind === 'string'
      && typeof e.x === 'number' && typeof e.y === 'number'
      && typeof e.observedAtTick === 'number' && typeof e.expiresAtTick === 'number'
      && (e.observerActorId === 'player' || e.observerActorId === 'echo');
  });
}
