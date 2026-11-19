// REVIEWER PROBE (not part of the frozen commit) — cross-room toggle semantics.
// Runs identically on c233e5c (control) and 4b938a5 to compare human/player
// toggle behaviour when the run's ONE device stays in the room it spawned in.
import { describe, expect, it } from 'vitest';
import { basePlayerData, xpForLevel } from '../../config/game';
import { MapGenerator, assignRoles, guaranteeReachable } from '../MapGenerator';
import type { MapData, PlayerData } from '../../types';
import {
  createSimulationState, enqueueCommand, isWalkableFromState, stepSimulationTicks,
  type SimulationIntent, type SimulationState
} from './core';
import { roomAt } from '../../config/supplies';

const neutral = (): SimulationIntent => ({ move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false });
function playerData(): PlayerData {
  return {
    ...basePlayerData(), level: 1, xp: 0, xpToNext: xpForLevel(1), currency: 0,
    weaponKey: 'pulse',
    weapons: [{ key: 'pulse', level: 1, ammo: -1, magazine: -1, reloading: false, reloadTimer: 0 }],
    upgrades: [], abilities: []
  } as PlayerData;
}
function freshState(): SimulationState {
  const gen = new MapGenerator(424242);
  const map: MapData = gen.generate();
  assignRoles(gen, map.rooms, map.roomsOrder);
  guaranteeReachable(map);
  for (const row of map.tiles) {
    for (const tile of row) {
      if ((tile.type === 'floor' || tile.type === 'spawn') && isWalkableFromState(
        createSimulationState({ seed: 424242, map, playerData: playerData(), playerX: tile.x, playerY: tile.y }), tile.x, tile.y, 0.5)) {
        const s = createSimulationState({ seed: 424242, map, playerData: playerData(), playerX: tile.x, playerY: tile.y });
        const startRoom = roomAt(s.map.rooms, tile.x, tile.y)!;
        enqueueCommand(s, { type: 'spawn-echo', x: tile.x + 1, y: tile.y });
        stepSimulationTicks(s, 1, neutral());
        enqueueCommand(s, {
          type: 'spawn-signal-device', deviceId: 'relay_main',
          roomId: startRoom.id, x: s.echo!.x, y: s.echo!.y
        } as never);
        stepSimulationTicks(s, 1, neutral());
        return s;
      }
    }
  }
  throw new Error('no start tile');
}
function farTileInOtherRoom(s: SimulationState): { x: number; y: number; roomId: number } {
  const devRoom = s.signal!.roomId;
  for (const row of s.map.tiles) {
    for (const t of row) {
      if (t.type !== 'floor' && t.type !== 'spawn') continue;
      if (!isWalkableFromState(s, t.x, t.y, 0.5)) continue;
      const room = roomAt(s.map.rooms, t.x, t.y);
      if (room && room.id !== devRoom) return { x: t.x, y: t.y, roomId: room.id };
    }
  }
  throw new Error('no other room tile');
}
const relayEvent = (evs: any[]) => evs.filter((e) => e.type === 'signal-relay-changed').length;

describe('cross-room toggle (reviewer probe)', () => {
  it('T1 in-room toggle still works (baseline)', () => {
    const s = freshState();
    expect(roomAt(s.map.rooms, s.player.x, s.player.y)!.id).toBe(s.signal!.roomId);
    enqueueCommand(s, { type: 'toggle-relay', enabled: true });
    const evs = stepSimulationTicks(s, 1, neutral());
    console.log('PROBE_T1 ' + JSON.stringify({ relay: s.signal!.relay, manual: s.signal!.manualEnabled, events: relayEvent(evs) }));
    expect(s.signal!.relay).toBe('ACTIVE');
    expect(relayEvent(evs)).toBe(1);
  });

  it('T2 HUMAN toggle from the NEW room while the device stayed behind', () => {
    const s = freshState();
    const far = farTileInOtherRoom(s);
    enqueueCommand(s, { type: 'teleport-player', x: far.x, y: far.y, healToFull: true, migrateEcho: true });
    stepSimulationTicks(s, 1, neutral());
    const roomNow = roomAt(s.map.rooms, s.player.x, s.player.y)!.id;
    expect(roomNow).not.toBe(s.signal!.roomId);
    // exactly what the human R key / a legitimate player toggle issues
    enqueueCommand(s, { type: 'toggle-relay', enabled: true });
    const evs = stepSimulationTicks(s, 1, neutral());
    const out = {
      deviceRoom: s.signal!.roomId, playerRoom: roomNow,
      relay: s.signal!.relay, manual: s.signal!.manualEnabled, events: relayEvent(evs)
    };
    console.log('PROBE_T2 ' + JSON.stringify(out));
    // THIS IS THE BEHAVIOURAL COMPARISON TARGET (asserted as fact below by the runner)
    expect(out.relay).toBe(process.env.EXPECT_T2_RELAY ?? out.relay);
    expect(out.events).toBe(Number(process.env.EXPECT_T2_EVENTS ?? out.events));
  });

  it('T3 toggle queued BEFORE the teleport in the same tick executes in the OLD room', () => {
    const s = freshState();
    const far = farTileInOtherRoom(s);
    enqueueCommand(s, { type: 'toggle-relay', enabled: true });
    enqueueCommand(s, { type: 'teleport-player', x: far.x, y: far.y, healToFull: true, migrateEcho: true });
    const evs = stepSimulationTicks(s, 1, neutral());
    const out = { relay: s.signal!.relay, playerRoom: roomAt(s.map.rooms, s.player.x, s.player.y)!.id, events: relayEvent(evs) };
    console.log('PROBE_T3 ' + JSON.stringify(out));
    expect(out.relay).toBe(process.env.EXPECT_T3_RELAY ?? out.relay);
  });

  it('T4 cross-room scan/jam are refused by legality and never charged', () => {
    const s = freshState();
    const far = farTileInOtherRoom(s);
    enqueueCommand(s, { type: 'teleport-player', x: far.x, y: far.y, healToFull: true, migrateEcho: true });
    stepSimulationTicks(s, 1, neutral());
    const before = s.signal!.actors.echo.energy.energy;
    enqueueCommand(s, { type: 'signal-scan', actor: 'echo' });
    enqueueCommand(s, { type: 'signal-jam', actor: 'player' });
    const evs = stepSimulationTicks(s, 1, neutral());
    const out = {
      echoEnergyBefore: before, echoEnergyAfter: s.signal!.actors.echo.energy.energy,
      playerEnergy: s.signal!.actors.player.energy.energy,
      scanned: evs.filter((e) => e.type === 'signal-scanned').map((e: any) => e.found),
      jammed: evs.filter((e) => e.type === 'signal-jammed').length
    };
    console.log('PROBE_T4 ' + JSON.stringify(out));
    expect(out.echoEnergyAfter).toBe(before);
    expect(out.playerEnergy).toBe(100);
  });
});
