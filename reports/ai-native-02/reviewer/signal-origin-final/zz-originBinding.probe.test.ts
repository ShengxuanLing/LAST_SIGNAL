// REVIEWER PROBE (not part of the frozen commit) — origin-room binding for the
// three control sources. Runs on c2a31af (candidate), 4b938a5 and c233e5c.
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
      if (tile.type !== 'floor' && tile.type !== 'spawn') continue;
      const probe = createSimulationState({ seed: 424242, map, playerData: playerData(), playerX: tile.x, playerY: tile.y });
      if (!isWalkableFromState(probe, tile.x, tile.y, 0.5)) continue;
      const s = probe;
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
  throw new Error('no start tile');
}
function otherRoomTile(s: SimulationState): { x: number; y: number; roomId: number } {
  for (const row of s.map.tiles) {
    for (const t of row) {
      if (t.type !== 'floor' && t.type !== 'spawn') continue;
      if (!isWalkableFromState(s, t.x, t.y, 0.5)) continue;
      const room = roomAt(s.map.rooms, t.x, t.y);
      if (room && room.id !== s.signal!.roomId) return { x: t.x, y: t.y, roomId: room.id };
    }
  }
  throw new Error('no other room tile');
}
const relayEvents = (evs: any[]) => evs.filter((e) => e.type === 'signal-relay-changed').length;
const playerRoom = (s: SimulationState) => roomAt(s.map.rooms, s.player.x, s.player.y)?.id ?? -1;

describe('origin-room binding (reviewer probe)', () => {
  it('O1 Companion toggle captured in the device room, committed before the teleport: legal ONCE', () => {
    const s = freshState();
    const far = otherRoomTile(s);
    const origin = playerRoom(s);
    expect(origin).toBe(s.signal!.roomId);
    enqueueCommand(s, { type: 'toggle-relay', enabled: true, originRoomId: origin } as never);
    enqueueCommand(s, { type: 'teleport-player', x: far.x, y: far.y, healToFull: true, migrateEcho: true });
    const evs = stepSimulationTicks(s, 1, neutral());
    const out = { relay: s.signal!.relay, manual: s.signal!.manualEnabled, events: relayEvents(evs), playerRoomAfter: playerRoom(s) };
    console.log('O1 ' + JSON.stringify(out));
    expect(s.signal!.relay).toBe('ACTIVE');
    expect(relayEvents(evs)).toBe(1);
  });

  it('O2 Companion toggle queued AFTER the teleport keeps the OLD origin: rejected, gate untouched', () => {
    const s = freshState();
    const far = otherRoomTile(s);
    const origin = playerRoom(s);
    enqueueCommand(s, { type: 'teleport-player', x: far.x, y: far.y, healToFull: true, migrateEcho: true });
    stepSimulationTicks(s, 1, neutral());
    const before = { relay: s.signal!.relay, manual: s.signal!.manualEnabled, powered: s.signal!.powered };
    enqueueCommand(s, { type: 'toggle-relay', enabled: true, originRoomId: origin } as never);
    const evs = stepSimulationTicks(s, 1, neutral());
    const out = { deviceRoom: s.signal!.roomId, playerRoom: playerRoom(s), after: { relay: s.signal!.relay, manual: s.signal!.manualEnabled, powered: s.signal!.powered }, events: relayEvents(evs) };
    console.log('O2 ' + JSON.stringify(out));
    expect(relayEvents(evs)).toBe(0);
    expect({ relay: s.signal!.relay, manual: s.signal!.manualEnabled, powered: s.signal!.powered }).toEqual(before);
  });

  it('O2b forged origin equal to the DEVICE room but not the current room is rejected too', () => {
    const s = freshState();
    const far = otherRoomTile(s);
    enqueueCommand(s, { type: 'teleport-player', x: far.x, y: far.y, healToFull: true, migrateEcho: true });
    stepSimulationTicks(s, 1, neutral());
    enqueueCommand(s, { type: 'toggle-relay', enabled: true, originRoomId: s.signal!.roomId } as never);
    const evs = stepSimulationTicks(s, 1, neutral());
    console.log('O2b ' + JSON.stringify({ events: relayEvents(evs), relay: s.signal!.relay }));
    expect(relayEvents(evs)).toBe(0);
    expect(s.signal!.relay).toBe('INACTIVE');
  });

  it('O2c forged origin equal to the CURRENT room but not the device room is rejected', () => {
    const s = freshState();
    const far = otherRoomTile(s);
    enqueueCommand(s, { type: 'teleport-player', x: far.x, y: far.y, healToFull: true, migrateEcho: true });
    stepSimulationTicks(s, 1, neutral());
    enqueueCommand(s, { type: 'toggle-relay', enabled: true, originRoomId: playerRoom(s) } as never);
    const evs = stepSimulationTicks(s, 1, neutral());
    console.log('O2c ' + JSON.stringify({ events: relayEvents(evs), relay: s.signal!.relay }));
    expect(relayEvents(evs)).toBe(0);
    expect(s.signal!.relay).toBe('INACTIVE');
  });

  it('O3 human R (no binding) from the NEW room still toggles the device left behind', () => {
    const s = freshState();
    const far = otherRoomTile(s);
    enqueueCommand(s, { type: 'teleport-player', x: far.x, y: far.y, healToFull: true, migrateEcho: true });
    stepSimulationTicks(s, 1, neutral());
    enqueueCommand(s, { type: 'toggle-relay', enabled: true });
    const evs = stepSimulationTicks(s, 1, neutral());
    const out = { relay: s.signal!.relay, manual: s.signal!.manualEnabled, events: relayEvents(evs), deviceRoom: s.signal!.roomId, playerRoom: playerRoom(s) };
    console.log('O3 ' + JSON.stringify(out));
    expect(s.signal!.relay).toBe('ACTIVE');
    expect(relayEvents(evs)).toBe(1);
  });

  it('O4 scan/jam unchanged: cross-room refused before charging', () => {
    const s = freshState();
    const far = otherRoomTile(s);
    enqueueCommand(s, { type: 'teleport-player', x: far.x, y: far.y, healToFull: true, migrateEcho: true });
    stepSimulationTicks(s, 1, neutral());
    const echoBefore = s.signal!.actors.echo.energy.energy;
    enqueueCommand(s, { type: 'signal-scan', actor: 'echo' });
    enqueueCommand(s, { type: 'signal-jam', actor: 'player' });
    stepSimulationTicks(s, 1, neutral());
    console.log('O4 ' + JSON.stringify({ echoEnergy: s.signal!.actors.echo.energy.energy, playerEnergy: s.signal!.actors.player.energy.energy }));
    expect(s.signal!.actors.echo.energy.energy).toBe(echoBefore);
    expect(s.signal!.actors.player.energy.energy).toBe(100);
  });

  it('O5 the binding survives a JSON clone (in-memory restore path) and stays out of the device state', () => {
    const s = freshState();
    const origin = playerRoom(s);
    enqueueCommand(s, { type: 'toggle-relay', enabled: true, originRoomId: origin } as never);
    const cloned = JSON.parse(JSON.stringify(s)) as SimulationState;
    const queued = cloned.pendingCommands.find((c) => c.type === 'toggle-relay') as any;
    console.log('O5 ' + JSON.stringify({ queued }));
    expect(queued?.originRoomId).toBe(origin);
    expect(JSON.stringify(s.signal)).not.toContain('originRoomId');
  });
});
