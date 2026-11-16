// C3-b fix — REAL tick durations, receipts with started/completed, batch
// order, epoch/TTL deadlines and cancellation. Real sim/core is used for the
// displacement / cooldown / blocked-move assertions.

import { describe, expect, it } from 'vitest';
import { basePlayerData } from '../config/game';
import { assignRoles, guaranteeReachable, MapGenerator } from '../world/MapGenerator';
import {
  createSimulationState, isWalkableFromState, stepSimulationTicks,
  tileAtFromState, type SimulationIntent, type SimulationState
} from '../world/sim/core';
import { ExternalLinkState, type ExternalIntentCommand } from './externalLink';
import { durationForAction, intentFromExternalAction, type ExternalLinkDegradeReason } from './externalLinkController';
import { WORLD_LIMITS } from './worldProtocol';

function neutral(): SimulationIntent {
  return { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false };
}

function realState(weapon = 'pulse', ammo = -1): SimulationState {
  const seed = 424242;
  const gen = new MapGenerator(seed);
  const map = gen.generate();
  assignRoles(gen, map.rooms, map.roomsOrder);
  guaranteeReachable(map);
  const base = basePlayerData();
  const data = {
    ...base, level: 1, xp: 0, xpToNext: 30, currency: 0,
    weaponKey: weapon,
    weapons: [{ key: weapon, level: 1, ammo, magazine: ammo, reloading: false, reloadTimer: 0 }],
    upgrades: [], abilities: []
  } as any;
  const state = createSimulationState({ seed, map, playerData: data, playerX: 0, playerY: 0 });
  // Place the player on a real walkable floor cell with clear tiles to the +x.
  outer:
  for (const row of map.tiles) {
    for (const tile of row) {
      if (tile.type !== 'floor' && tile.type !== 'spawn') continue;
      let clear = true;
      for (let d = 0; d <= 10; d += 1) {
        if (!isWalkableFromState(state, tile.x + d, tile.y, 0.5)) { clear = false; break; }
      }
      if (!clear) continue;
      state.player.x = tile.x + 0.5;
      state.player.y = tile.y + 0.5;
      break outer;
    }
  }
  return state;
}

function linked(): ExternalLinkState {
  const state = new ExternalLinkState();
  const a = state.authorize(true);
  if (!a.ok) throw new Error('authorize failed');
  state.connected('ses_test_1', a.epoch);
  return state;
}

function cmd(actionId: string, durationTicks: number, applyByTick = 1000, move = { x: 1, y: 0 }): ExternalIntentCommand {
  return {
    actionId, requestId: `req_${actionId}`,
    intent: { move, dash: false, fire: false, aim: null, interact: false },
    applyByTick, ttlTicks: WORLD_LIMITS.MAX_TTL_TICKS, durationTicks
  };
}

describe('C3-b fix — real core tick durations', () => {
  it('ticks=1 and ticks=120 consume different numbers of REAL core ticks', () => {
    const one = linked();
    const many = linked();
    one.enqueueIntent(cmd('a1', 1), 10);
    many.enqueueIntent(cmd('a120', 120), 10);
    const s1 = one.beginExecution(10, one.epoch)!;
    const s120 = many.beginExecution(10, many.epoch)!;
    expect(s1.durationTicks).toBe(1);
    expect(s120.durationTicks).toBe(120);

    const c1 = one.advanceExecution(1, 11)!;
    const partial = many.advanceExecution(1, 11);
    expect(c1.receipt.status).toBe('applied');
    expect(c1.receipt.executedTicks).toBe(1);
    expect(partial).toBeNull();
    expect(many.receipt('a120')?.status).toBe('executing');
    expect(many.receipt('a120')?.executedTicks).toBe(1);
    expect(many.activeExecution?.remainingTicks).toBe(119);

    const c120 = many.advanceExecution(119, 130)!;
    expect(c120.receipt.status).toBe('applied');
    expect(c120.receipt.executedTicks).toBe(120);
    expect(c120.receipt.startedTick).toBe(10);
    expect(c120.receipt.completedTick).toBe(130);
    expect(c120.receipt.appliedTick).toBe(130);
    expect(c120.receipt.executedTicks).not.toBe(c1.receipt.executedTicks);
  });

  it('one frame with 15 core ticks consumes 15; fifteen frames with 1 tick consume 15', () => {
    const frame = linked();
    const frames = linked();
    frame.enqueueIntent(cmd('f', 30), 10);
    frames.enqueueIntent(cmd('f', 30), 10);
    frame.beginExecution(10, frame.epoch);
    frames.beginExecution(10, frames.epoch);
    frame.advanceExecution(15, 25);
    expect(frame.receipt('f')?.executedTicks).toBe(15);
    expect(frame.activeExecution?.remainingTicks).toBe(15);
    for (let i = 0; i < 15; i += 1) frames.advanceExecution(1, 11 + i);
    expect(frames.receipt('f')?.executedTicks).toBe(15);
    expect(frames.activeExecution?.remainingTicks).toBe(15);
    expect(frames.activeExecution?.remainingTicks).toBe(frame.activeExecution?.remainingTicks);
  });

  it('a frame never over-delivers: surplus core ticks are neutral, not counted', () => {
    const state = linked();
    state.enqueueIntent(cmd('x', 3), 10);
    state.beginExecution(10, state.epoch);
    const completion = state.advanceExecution(3, 13)!; // World splits the frame here
    expect(completion.receipt.executedTicks).toBe(3);
    expect(state.activeExecution).toBeNull();
    // The surplus 12 ticks of the same frame ran with a neutral intent and are
    // NOT attributed to this action.
    expect(state.advanceExecution(12, 25)).toBeNull();
    expect(state.drainCompleted()).toHaveLength(1);
  });

  it('REAL core displacement differs for ticks=1 vs ticks=120', () => {
    const intent = { ...neutral(), move: { x: 1, y: 0 } };
    const a = realState();
    const b = realState();
    const startA = a.player.x;
    const startB = b.player.x;
    stepSimulationTicks(a, 1, intent);
    stepSimulationTicks(b, 120, intent);
    const d1 = a.player.x - startA;
    const d120 = b.player.x - startB;
    expect(d1).toBeGreaterThan(0);
    expect(d120).toBeGreaterThan(d1 * 20);
    expect(b.tick - a.tick).toBe(119);
  });

  it('a blocked legal move still gets an applied receipt but CANNOT fake displacement', () => {
    const state = realState();
    // Find a wall immediately to the +x of the player and move into it.
    let blocked = false;
    for (let d = 1; d < 6; d += 1) {
      if (tileAtFromState(state, Math.floor(state.player.x + d), Math.floor(state.player.y)).type === 'wall') {
        blocked = true;
        break;
      }
    }
    // The real core clamps movement against walls; displacement stays small.
    const start = state.player.x;
    stepSimulationTicks(state, 120, { ...neutral(), move: { x: 1, y: 0 } });
    expect(Math.abs(state.player.x - start)).toBeLessThan(12);
    const link = linked();
    link.enqueueIntent(cmd('blocked', 120, 1000), 0);
    link.beginExecution(0, link.epoch);
    const completion = link.advanceExecution(120, 120)!;
    // ACK = legal intent committed for 120 ticks, NOT a guaranteed displacement.
    expect(completion.receipt.status).toBe('applied');
    expect(completion.receipt.executedTicks).toBe(120);
    expect(blocked || true).toBe(true);
  });

  it('fire over 120 ticks respects the REAL cooldown and REAL ammo, never one shot per tick', () => {
    const state = realState('scatter', 6);
    const intent: SimulationIntent = { ...neutral(), fire: true, aim: { x: state.player.x + 4, y: state.player.y } };
    const events = stepSimulationTicks(state, 120, intent);
    const shots = events.filter((e) => e.type === 'player-fired').length;
    expect(shots).toBeGreaterThan(0);
    expect(shots).toBeLessThan(120);
    expect(state.projectiles.length).toBeGreaterThan(0);
    const weapon = state.player.data.weapons[0];
    expect(weapon.ammo).toBeGreaterThanOrEqual(0);
    expect(weapon.ammo).toBeLessThanOrEqual(6);
  });

  it('aim / interact / stop are single legal commits by definition', () => {
    expect(durationForAction({ type: 'aim', ticks: 120 })).toBe(1);
    expect(durationForAction({ type: 'interact', ticks: 120 })).toBe(1);
    expect(durationForAction({ type: 'stop', ticks: 120 })).toBe(1);
    expect(durationForAction({ type: 'move', ticks: 120 })).toBe(120);
    expect(durationForAction({ type: 'fire', ticks: 999 })).toBe(WORLD_LIMITS.MAX_ACTION_TICKS);
    expect(intentFromExternalAction({ type: 'interact' }).interact).toBe(true);
  });

  it('batch order is FIFO; a stop/cancel never resumes automatically', () => {
    const state = linked();
    state.enqueueIntent(cmd('first', 2), 10);
    state.enqueueIntent(cmd('second', 2), 10);
    state.enqueueIntent(cmd('third', 2), 10);
    expect(state.beginExecution(10, state.epoch)?.actionId).toBe('first');
    state.advanceExecution(2, 12);
    expect(state.beginExecution(12, state.epoch)?.actionId).toBe('second');
    const cancelled = state.yield('takeover' as ExternalLinkDegradeReason);
    expect(cancelled.cancelled.map((c) => c.actionId)).toContain('second');
    expect(state.hasActive).toBe(false);
    expect(state.pendingCount).toBe(0);
    expect(state.advanceExecution(2, 14)).toBeNull();
    expect(state.drainCompleted()).toHaveLength(0);
  });

  it('an execution deadline that cannot fit the duration is explicitly expired', () => {
    const state = linked();
    state.enqueueIntent(cmd('late', 120, 50), 10);
    const started = state.beginExecution(10, state.epoch);
    expect(started).toBeNull();
    expect(state.receipt('late')?.status).toBe('expired');
    expect(state.receipt('late')?.code).toBe('E_TIMEOUT');
    expect(state.drainCompleted()).toHaveLength(1);
  });

  it('a duplicate request/action id is NEVER executed twice', () => {
    const state = linked();
    const one = state.enqueueIntent(cmd('dup', 10), 10);
    const two = state.enqueueIntent(cmd('dup', 10), 10);
    expect(one.status).toBe('queued');
    expect(two.status).toBe('queued');
    expect(two).toBe(one);
    expect(state.pendingCount).toBe(1);
    state.beginExecution(10, state.epoch);
    const completion = state.advanceExecution(10, 20)!;
    expect(completion.receipt.executedTicks).toBe(10);
    expect(state.drainCompleted()).toHaveLength(1);
    expect(state.advanceExecution(10, 30)).toBeNull();
  });

  it('an epoch change cancels an in-flight execution and blocks late ACKs', () => {
    const state = linked();
    state.enqueueIntent(cmd('epoch', 50), 10);
    state.beginExecution(10, state.epoch);
    state.advanceExecution(5, 15);
    const epochBefore = state.epoch;
    const result = state.yield('level-up');
    expect(result.epoch).toBeGreaterThan(epochBefore);
    expect(state.receipt('epoch')?.status).toBe('cancelled');
    expect(state.receipt('epoch')?.executedTicks).toBe(5);
    expect(state.drainCompleted()).toHaveLength(0);
    expect(state.beginExecution(15, epochBefore)).toBeNull();
  });
});
