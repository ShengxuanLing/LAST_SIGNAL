// REVIEWER PROBE (not part of the frozen commit) — "confirmed before the room
// change but not yet committed": intent vs core-command carry-over.
import { describe, expect, it } from 'vitest';
import { basePlayerData, xpForLevel } from '../../config/game';
import { MapGenerator, assignRoles, guaranteeReachable } from '../MapGenerator';
import type { MapData, PlayerData } from '../../types';
import {
  canonicalSimulationEvents, createSimulationState, enqueueCommand,
  isWalkableFromState, stepSimulationTicks,
  type SimulationIntent, type SimulationState
} from './core';

const neutral = (): SimulationIntent => ({ move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false });
function playerData(): PlayerData {
  return {
    ...basePlayerData(), level: 1, xp: 0, xpToNext: xpForLevel(1), currency: 0,
    weaponKey: 'pulse',
    weapons: [{ key: 'pulse', level: 1, ammo: -1, magazine: -1, reloading: false, reloadTimer: 0 }],
    upgrades: [], abilities: []
  } as PlayerData;
}
function state(): SimulationState {
  const gen = new MapGenerator(424242);
  const map: MapData = gen.generate();
  assignRoles(gen, map.rooms, map.roomsOrder);
  guaranteeReachable(map);
  const s = createSimulationState({ seed: 424242, map, playerData: playerData(), playerX: 0, playerY: 0 });
  for (const row of map.tiles) {
    for (const tile of row) {
      if ((tile.type === 'floor' || tile.type === 'spawn') && isWalkableFromState(s, tile.x, tile.y, 0.5)) {
        s.player.x = tile.x; s.player.y = tile.y;
        enqueueCommand(s, { type: 'spawn-echo', x: tile.x + 1, y: tile.y });
        stepSimulationTicks(s, 1, neutral());
        enqueueCommand(s, {
          type: 'spawn-signal-device', deviceId: 'relay_main',
          roomId: 0, x: s.echo!.x, y: s.echo!.y, tick: s.tick
        } as never);
        stepSimulationTicks(s, 1, neutral());
        return s;
      }
    }
  }
  throw new Error('no walkable tile');
}
function farWalkable(s: SimulationState): { x: number; y: number } {
  for (const row of s.map.tiles) {
    for (const t of row) {
      if (t.type !== 'floor' && t.type !== 'spawn') continue;
      if (!isWalkableFromState(s, t.x, t.y, 0.5)) continue;
      if (Math.hypot(t.x - s.echo!.x, t.y - s.echo!.y) > 40) return { x: t.x, y: t.y };
    }
  }
  throw new Error('no far tile');
}

describe('confirmed-but-uncommitted action across a committed room boundary', () => {
  it('FIFO: a Signal core command queued BEFORE the teleport runs in the OLD room', () => {
    const s = state();
    const far = farWalkable(s);
    const device = { x: s.signal!.x, y: s.signal!.y };
    enqueueCommand(s, { type: 'signal-scan', actor: 'echo' });
    enqueueCommand(s, { type: 'teleport-player', x: far.x, y: far.y, healToFull: true, migrateEcho: true });
    const events = stepSimulationTicks(s, 1, neutral());
    const scan = events.find((e: any) => e.type === 'signal-scanned') as any;
    expect(scan, 'scan really ran').toBeTruthy();
    expect(scan.found, 'scan found the device at its OLD position').toBe(true);
    expect(s.echo!.x, 'echo migrated on the same tick').not.toBeCloseTo(device.x, 3);
    expect(s.signal!.actors.echo.energy.energy).toBeLessThan(100);
  });

  it('FIFO: the SAME command queued AFTER the teleport runs in the NEW room (residual)', () => {
    const s = state();
    const far = farWalkable(s);
    enqueueCommand(s, { type: 'teleport-player', x: far.x, y: far.y, healToFull: true, migrateEcho: true });
    enqueueCommand(s, { type: 'signal-scan', actor: 'echo' });
    const events = stepSimulationTicks(s, 1, neutral());
    const scan = events.find((e: any) => e.type === 'signal-scanned') as any;
    const dist = Math.hypot(s.echo!.x - s.signal!.x, s.echo!.y - s.signal!.y);
    const summary = { found: scan?.found, echoEnergy: s.signal!.actors.echo.energy.energy, distFromDevice: dist };
    console.log('FIFO_AFROOM ' + JSON.stringify(summary));
    // DOCUMENTS ACTUAL BEHAVIOUR: core SIGNAL LEGALITY refuses the out-of-range
    // actor BEFORE charging (tryScan -> E_PERMISSION), so a stale scan does NOT
    // cost energy and does NOT produce evidence in the new room.
    expect(dist).toBeGreaterThan(12);
    expect(scan.found).toBe(false);
    expect(s.signal!.actors.echo.energy.energy, 'out-of-range scan is refused, not charged').toBe(100);
    void canonicalSimulationEvents;
  });

  it('FIFO: a stale TOGGLE (no actor/range gate) CAN close the exit from the new room', () => {
    const s = state();
    const far = farWalkable(s);
    // make the relay ACTIVE before the transition (the normal state when the
    // player is allowed through a gated portal)
    enqueueCommand(s, { type: 'toggle-relay', enabled: true });
    stepSimulationTicks(s, 1, neutral());
    expect(s.signal!.relay).toBe('ACTIVE');
    // a confirmed toggle queued AFTER the portal teleport in the same tick
    enqueueCommand(s, { type: 'teleport-player', x: far.x, y: far.y, healToFull: true, migrateEcho: true });
    enqueueCommand(s, { type: 'toggle-relay', enabled: false });
    stepSimulationTicks(s, 1, neutral());
    const summary = { relay: s.signal!.relay, exitOpen: s.signal!.relay === 'ACTIVE', roomMoved: Math.hypot(s.echo!.x - s.signal!.x, s.echo!.y - s.signal!.y) > 12 };
    console.log('STALE_TOGGLE_AFROOM ' + JSON.stringify(summary));
    expect(summary.roomMoved).toBe(true);
    expect(s.signal!.relay, 'stale toggle flips the old-room device from the new room').toBe('INACTIVE');
  });
});
