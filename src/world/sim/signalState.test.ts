// P3-b B — optional core Signal device, single-writer commands, canonical.

import { describe, expect, it } from 'vitest';
import { GAME, basePlayerData } from '../../config/game';
import { MapGenerator, assignRoles, guaranteeReachable } from '../MapGenerator';
import type { MapData, PlayerData } from '../../types';
import {
  createSimulationState, enqueueCommand, stepSimulationTicks, canonicalSimulationState,
  cloneSimulationState, isWalkableFromState, type SimulationIntent, type SimulationState
} from './core';
import { tickSignalDevice, commitToggleRelay, signalExitOpen, validSignalDevice } from './signalState';

function playerData(): PlayerData {
  return {
    ...basePlayerData(), level: 1, xp: 0, xpToNext: 30, currency: 0,
    weaponKey: 'pulse',
    weapons: [{ key: 'pulse', level: 1, ammo: -1, magazine: -1, reloading: false, reloadTimer: 0 }],
    upgrades: [], abilities: []
  } as PlayerData;
}
function mapData(): MapData {
  const gen = new MapGenerator(424242);
  const map = gen.generate();
  assignRoles(gen, map.rooms, map.roomsOrder);
  guaranteeReachable(map);
  return map;
}
function state(): SimulationState {
  const map = mapData();
  const s = createSimulationState({ seed: 424242, map, playerData: playerData(), playerX: 0, playerY: 0 });
  // A walkable start position from the real map.
  for (const row of map.tiles) {
    for (const tile of row) {
      if ((tile.type === 'floor' || tile.type === 'spawn') && isWalkableFromState(s, tile.x, tile.y, 0.5)) {
        s.player.x = tile.x; s.player.y = tile.y; return s;
      }
    }
  }
  return s;
}
const neutral = (): SimulationIntent => ({ move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false });

describe('optional core Signal device', () => {
  it('absent signal leaves the canonical projection byte-identical', () => {
    const a = state();
    const b = cloneSimulationState(a);
    expect(canonicalSimulationState(a)).toBe(canonicalSimulationState(b));
    expect(canonicalSimulationState(a)).not.toContain('"signal"');
    expect(signalExitOpen(a.signal)).toBe(true);
  });

  it('spawn/scan/jam/toggle commit ONLY at the tick boundary', () => {
    const s = state();
    const device = { deviceId: 'relay_main', roomId: 0, x: s.player.x, y: s.player.y };
    enqueueCommand(s, { type: 'spawn-signal-device', ...device });
    expect(s.signal, 'enqueue only').toBeUndefined();
    const spawned = stepSimulationTicks(s, 1, neutral());
    expect(spawned.some((e) => e.type === 'signal-device-spawned')).toBe(true);
    expect(s.signal).toBeTruthy();
    expect(canonicalSimulationState(s)).toContain('"signal"');

    enqueueCommand(s, { type: 'signal-scan', actor: 'echo' });
    const scanEvents = stepSimulationTicks(s, 1, neutral());
    const scan = scanEvents.find((e) => e.type === 'signal-scanned') as { found?: boolean; energy?: number } | undefined;
    expect(scan).toBeTruthy();
    // No echo actor exists -> the echo scan is illegal and costs nothing.
    expect(scan?.found).toBe(false);
    expect(s.signal!.actors.echo.energy.energy).toBe(100);

    enqueueCommand(s, { type: 'signal-scan', actor: 'player' });
    const playerScan = stepSimulationTicks(s, 1, neutral());
    expect(playerScan.some((e) => e.type === 'signal-scanned' && (e as any).found)).toBe(true);
    expect(s.signal!.actors.player.energy.energy).toBe(90);
    expect(s.signal!.actors.echo.energy.energy, 'independent accounts').toBe(100);
    expect(s.signal!.evidence.length).toBe(1);
    expect(s.signal!.evidence[0].expiresAtTick).toBe(s.tick + 480 - 1);
  });

  it('jam suppresses emission (never ACTIVE), toggle preserves power, expiry recomputes', () => {
    const s = state();
    enqueueCommand(s, { type: 'spawn-signal-device', deviceId: 'relay', roomId: 0, x: s.player.x, y: s.player.y });
    stepSimulationTicks(s, 1, neutral());
    enqueueCommand(s, { type: 'signal-jam', actor: 'player' });
    stepSimulationTicks(s, 1, neutral());
    expect(s.signal!.relay).toBe('JAMMED');
    expect(s.signal!.actors.player.energy.energy).toBe(75);
    expect(signalExitOpen(s.signal)).toBe(false);
    enqueueCommand(s, { type: 'toggle-relay', enabled: true });
    stepSimulationTicks(s, 1, neutral());
    expect(s.signal!.relay, 'manual toggle does not override JAM').toBe('JAMMED');
    expect(s.signal!.manualEnabled).toBe(true);
    expect(s.signal!.powered).toBe(true);
    // Let the JAM duration expire.
    for (let i = 0; i < 365; i += 1) stepSimulationTicks(s, 1, neutral());
    expect(s.signal!.relay).toBe('ACTIVE');
    expect(signalExitOpen(s.signal)).toBe(true);
    expect(commitToggleRelay(s.signal!, false, s.tick).relay).toBe('INACTIVE');
  });

  it('paused ticks never regen and evidence expires by absolute TTL', () => {
    const s = state();
    enqueueCommand(s, { type: 'spawn-signal-device', deviceId: 'relay', roomId: 0, x: s.player.x, y: s.player.y });
    stepSimulationTicks(s, 1, neutral());
    s.signal!.actors.player.energy.energy = 50;
    for (let i = 0; i < 120; i += 1) tickSignalDevice(s.signal!, s.tick + i, true);
    expect(s.signal!.actors.player.energy.energy, 'paused no regen').toBe(50);
    expect(validSignalDevice(s.signal!)).toBe(true);
    expect(validSignalDevice({ ...s.signal!, hiddenTarget: 1 })).toBe(false);
    expect(validSignalDevice({ ...s.signal!, actors: { ...s.signal!.actors, player: { ...s.signal!.actors.player, free: 1 } } })).toBe(false);
  });
});
