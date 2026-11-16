import { describe, expect, it } from 'vitest';
import {
  canonicalSimulationState, createSimulationState, enqueueCommand, stepSimulationTicks,
  type SimulationIntent, type SimulationState
} from './core';
import { MapGenerator, assignRoles, guaranteeReachable } from '../MapGenerator';
import { terminalRooms, PURCHASE_LEDGER_CAP, TRANSACTION_ID_MAX_LENGTH } from '../../config/supplies';
import { basePlayerData } from '../../config/game';
import { validateCheckpoint } from '../../systems/RunCheckpoint';
import type { PlayerData, RunCheckpoint } from '../../types';

const NEUTRAL: SimulationIntent = { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false };

function makeState(opts: { currency?: number; hp?: number } = {}): { state: SimulationState; roomId: number } {
  const gen = new MapGenerator(424242);
  const map = gen.generate();
  assignRoles(gen, map.rooms, map.roomsOrder);
  guaranteeReachable(map);
  const pd: PlayerData = {
    ...basePlayerData(), level: 1, xp: 0, xpToNext: 30, currency: opts.currency ?? 200,
    hp: opts.hp ?? 40, weaponKey: 'pulse',
    weapons: [{ key: 'pulse', level: 1, ammo: -1, magazine: -1, reloading: false, reloadTimer: 0 }],
    upgrades: [], abilities: []
  };
  const state = createSimulationState({ seed: 424242, map, playerData: pd, playerX: 5, playerY: 5 });
  const terminals = terminalRooms(map.rooms);
  const room = map.rooms.find((r) => terminals.has(r.id))!;
  state.player.x = room.gx + room.w / 2;
  state.player.y = room.gy + room.h / 2;
  for (const r of map.rooms) { r.cleared = true; r.spawned = true; }
  state.drones = [];
  state.targets = [];
  return { state, roomId: room.id };
}

function receipt(events: ReturnType<typeof stepSimulationTicks>) {
  return events.find((e): e is Extract<typeof e, { type: 'supply-purchase-result' }> =>
    e.type === 'supply-purchase-result');
}

function checkpointWith(ledger?: string[]): RunCheckpoint {
  const player: PlayerData = {
    ...basePlayerData(), level: 1, xp: 0, xpToNext: 30, currency: 10,
    hp: 50, weaponKey: 'pulse',
    weapons: [{ key: 'pulse', level: 1, ammo: -1, magazine: -1, reloading: false, reloadTimer: 0 }],
    upgrades: [], abilities: []
  };
  return {
    id: 'run-ledger', seed: 424242, stats: { kills: 0, items: 0, damage: 0, elapsedSeconds: 0 },
    roomId: 0, position: { x: 5, y: 5 }, clearedRooms: [0], portalTarget: null, rngState: 1,
    player, loot: [],
    coreState: {
      tick: 1, rngState: 1,
      playerTimers: { dashTimer: 0, invuln: 0, hurtTimer: 0, fireTimer: 0, aimYaw: 0 },
      nextProjectileId: 1,
      ...(ledger === undefined ? {} : { purchaseTransactions: ledger })
    }
  };
}

describe('purchase ledger determinism and bounded replay protection', () => {
  it('hard-caps the ledger: new tx rejected at cap, size unchanged, oldest still rejected', () => {
    const { state, roomId } = makeState();
    state.purchaseTransactions = Array.from({ length: PURCHASE_LEDGER_CAP }, (_, i) => `old-${i}`);
    const before = state.player.data.currency;

    enqueueCommand(state, { type: 'purchase-supply', transactionId: 'fresh-1', offerKey: 'repair', roomId });
    const rejected = receipt(stepSimulationTicks(state, 1, NEUTRAL));
    expect(rejected?.ok).toBe(false);
    expect(rejected?.reason).toBe('Supply ledger full');
    expect(state.purchaseTransactions).toHaveLength(PURCHASE_LEDGER_CAP);
    expect(state.player.data.currency).toBe(before);

    // The oldest id is still present and still rejected (no eviction replay).
    enqueueCommand(state, { type: 'purchase-supply', transactionId: 'old-0', offerKey: 'repair', roomId });
    const dup = receipt(stepSimulationTicks(state, 1, NEUTRAL));
    expect(dup?.reason).toBe('Duplicate transaction');
    expect(state.player.data.currency).toBe(before);
    expect(state.purchaseTransactions).toHaveLength(PURCHASE_LEDGER_CAP);
  });

  it('a repeated id with a different offer/room stays a stable duplicate without mutation', () => {
    const { state, roomId } = makeState({ currency: 200 });
    enqueueCommand(state, { type: 'purchase-supply', transactionId: 'tx-1', offerKey: 'repair', roomId });
    expect(receipt(stepSimulationTicks(state, 1, NEUTRAL))?.ok).toBe(true);
    const after = state.player.data.currency;

    enqueueCommand(state, { type: 'purchase-supply', transactionId: 'tx-1', offerKey: 'weapon', roomId });
    const conflict = receipt(stepSimulationTicks(state, 1, NEUTRAL));
    expect(conflict?.ok).toBe(false);
    expect(conflict?.reason).toBe('Duplicate transaction');
    expect(state.player.data.currency).toBe(after);
    expect(state.purchaseTransactions.filter((id) => id === 'tx-1')).toHaveLength(1);
  });

  it('ledger is part of canonical state (same ledger => same future; different ledger => different canonical)', () => {
    const a = makeState();
    const b = makeState();
    a.state.purchaseTransactions = ['tx-x'];
    b.state.purchaseTransactions = ['tx-x'];
    expect(canonicalSimulationState(a.state)).toBe(canonicalSimulationState(b.state));

    b.state.purchaseTransactions = ['tx-y'];
    expect(canonicalSimulationState(a.state)).not.toBe(canonicalSimulationState(b.state));

    // Same canonical => identical subsequent transaction result.
    const c = makeState();
    c.state.purchaseTransactions = ['tx-x'];
    enqueueCommand(a.state, { type: 'purchase-supply', transactionId: 'tx-x', offerKey: 'repair', roomId: a.roomId });
    enqueueCommand(c.state, { type: 'purchase-supply', transactionId: 'tx-x', offerKey: 'repair', roomId: c.roomId });
    const ra = receipt(stepSimulationTicks(a.state, 1, NEUTRAL));
    const rc = receipt(stepSimulationTicks(c.state, 1, NEUTRAL));
    expect(ra?.reason).toBe(rc?.reason);
    expect(canonicalSimulationState(a.state)).toBe(canonicalSimulationState(c.state));
  });

  it('success survives restore: retrying the same id after a cloned restore does not re-deduct', () => {
    const { state, roomId } = makeState({ currency: 100 });
    enqueueCommand(state, { type: 'purchase-supply', transactionId: 'tx-ok', offerKey: 'repair', roomId });
    expect(receipt(stepSimulationTicks(state, 1, NEUTRAL))?.ok).toBe(true);
    const savedCurrency = state.player.data.currency;
    expect(state.purchaseTransactions).toContain('tx-ok');

    // Simulate checkpoint capture + restore into a fresh state.
    const restored = JSON.parse(JSON.stringify(state)) as SimulationState;
    enqueueCommand(restored, { type: 'purchase-supply', transactionId: 'tx-ok', offerKey: 'repair', roomId });
    const retry = receipt(stepSimulationTicks(restored, 1, NEUTRAL));
    expect(retry?.reason).toBe('Duplicate transaction');
    expect(restored.player.data.currency).toBe(savedCurrency);
  });

  it('rejection survives restore: retrying a failed id after restore never deducts', () => {
    const { state, roomId } = makeState({ currency: 5 });
    enqueueCommand(state, { type: 'purchase-supply', transactionId: 'tx-fail', offerKey: 'weapon', roomId });
    expect(receipt(stepSimulationTicks(state, 1, NEUTRAL))?.reason).toBe('Not enough credits');
    expect(state.purchaseTransactions).toContain('tx-fail');

    const restored = JSON.parse(JSON.stringify(state)) as SimulationState;
    restored.player.data.currency = 500; // enough now, but the id is already processed
    enqueueCommand(restored, { type: 'purchase-supply', transactionId: 'tx-fail', offerKey: 'weapon', roomId });
    const retry = receipt(stepSimulationTicks(restored, 1, NEUTRAL));
    expect(retry?.reason).toBe('Duplicate transaction');
    expect(restored.player.data.currency).toBe(500);
  });

  it('checkpoint validation accepts old (no ledger) and valid ledgers, rejects tampered/oversized', () => {
    expect(validateCheckpoint(checkpointWith(undefined))).toBe(true);
    expect(validateCheckpoint(checkpointWith(['a', 'b']))).toBe(true);
    expect(validateCheckpoint(checkpointWith([]))).toBe(true);
    // oversized
    expect(validateCheckpoint(checkpointWith(Array.from({ length: PURCHASE_LEDGER_CAP + 1 }, (_, i) => `t${i}`)))).toBe(false);
    // duplicate ids
    expect(validateCheckpoint(checkpointWith(['dup', 'dup']))).toBe(false);
    // non-string / empty / too long
    expect(validateCheckpoint(checkpointWith(['ok', 5 as unknown as string]))).toBe(false);
    expect(validateCheckpoint(checkpointWith(['']))).toBe(false);
    expect(validateCheckpoint(checkpointWith(['x'.repeat(TRANSACTION_ID_MAX_LENGTH + 1)]))).toBe(false);
  });
});
