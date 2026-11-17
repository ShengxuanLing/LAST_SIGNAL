// GAMEPLAY-01 P1 — authored relay→drone attack link (pure core).
//
// Real counterfactual: the SAME seed/positions, with and without JAM. A linked
// drone must fire while the relay outputs, stop NEW fire while JAMMED, and resume
// after expiry; an unlinked drone is unaffected; already-fired projectiles stay.
import { describe, expect, it } from 'vitest';
import { basePlayerData, xpForLevel } from '../../config/game';
import { buildEnemyData } from '../../config/enemies';
import { MapGenerator, assignRoles, guaranteeReachable } from '../MapGenerator';
import type { MapData, PlayerData } from '../../types';
import {
  createSimulationState, enqueueCommand, isWalkableFromState, registerDrone,
  stepSimulationTicks, type SimulationIntent, type SimulationState, type SimEvent
} from './core';
import { SIGNAL_TUNING } from '../../signal/signalTuning';

const LINKED_ID = 1;
const UNLINKED_ID = 2;
const DEVICE_ID = 'relay_main';

function playerData(): PlayerData {
  return {
    ...basePlayerData(), level: 1, xp: 0, xpToNext: xpForLevel(1), currency: 0,
    weaponKey: 'pulse',
    weapons: [{ key: 'pulse', level: 1, ammo: -1, magazine: -1, reloading: false, reloadTimer: 0 }],
    upgrades: [], abilities: []
  } as PlayerData;
}

function realMap(): MapData {
  const gen = new MapGenerator(424242);
  const map = gen.generate();
  assignRoles(gen, map.rooms, map.roomsOrder);
  guaranteeReachable(map);
  return map;
}

const neutral = (): SimulationIntent => ({ move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false });

function baseState(): SimulationState {
  const map = realMap();
  const state = createSimulationState({ seed: 424242, map, playerData: playerData(), playerX: 0, playerY: 0 });
  let player: { x: number; y: number } | null = null;
  let spots: Array<{ x: number; y: number }> = [];
  for (const row of map.tiles) {
    for (const tile of row) {
      if (tile.type !== 'floor' && tile.type !== 'spawn') continue;
      if (!isWalkableFromState(state, tile.x, tile.y, 0.5)) continue;
      const candidates: Array<{ x: number; y: number }> = [];
      for (const [dx, dy] of [[3, 0], [-3, 0], [0, 3], [0, -3], [2, 1], [-2, -1], [1, 2], [-1, -2]]) {
        if (isWalkableFromState(state, tile.x + dx, tile.y + dy, 0.5)) candidates.push({ x: tile.x + dx, y: tile.y + dy });
        if (candidates.length >= 2) break;
      }
      if (candidates.length >= 2) { player = { x: tile.x, y: tile.y }; spots = candidates; break; }
    }
    if (player) break;
  }
  if (!player) throw new Error('no walkable player/sentry layout');
  state.player.x = player.x;
  state.player.y = player.y;
  const data = buildEnemyData('drone', 0, 0);
  registerDrone(state, { id: LINKED_ID, x: spots[0].x, y: spots[0].y, hp: data.stats.maxHp, data, attackTimer: 0, wanderTimer: 1000 });
  const data2 = buildEnemyData('drone', 0, 0);
  registerDrone(state, { id: UNLINKED_ID, x: spots[1].x, y: spots[1].y, hp: data2.stats.maxHp, data: data2, attackTimer: 0, wanderTimer: 1000 });
  enqueueCommand(state, {
    type: 'spawn-signal-device', deviceId: DEVICE_ID, roomId: 0,
    x: player.x, y: player.y, initial: { manualEnabled: true, powered: true }
  });
  stepSimulationTicks(state, 1, neutral());
  return state;
}

function linkEvent(state: SimulationState, deviceId: string, droneIds: number[]): SimEvent | undefined {
  enqueueCommand(state, { type: 'link-drones-to-signal', deviceId, droneIds });
  return stepSimulationTicks(state, 1, neutral()).find((e) => e.type === 'signal-linked');
}

function makeState(): SimulationState {
  const state = baseState();
  // Authored initial ACTIVE, then link only the first drone.
  linkEvent(state, DEVICE_ID, [LINKED_ID]);
  return state;
}

function shots(events: SimEvent[], ownerId: number): number {
  return events.filter((e) => e.type === 'projectile-spawned' && e.projectile.ownerId === ownerId).length;
}

describe('authored relay→drone attack link (core)', () => {
  it('valid link reports linkedIds and stores the device id', () => {
    const state = baseState();
    const event = linkEvent(state, DEVICE_ID, [LINKED_ID]);
    expect(event && event.type === 'signal-linked' ? event.linkedIds : []).toEqual([LINKED_ID]);
    expect(event && event.type === 'signal-linked' ? event.skippedIds : []).toEqual([]);
    expect(state.drones.find((d) => d.id === LINKED_ID)?.relayDeviceId).toBe(DEVICE_ID);
  });

  it('wrong device id creates no link and reports the skipped id', () => {
    const state = baseState();
    const event = linkEvent(state, 'not_the_device', [LINKED_ID]);
    expect(event && event.type === 'signal-linked' ? event.linkedIds : []).toEqual([]);
    expect(event && event.type === 'signal-linked' ? event.skippedIds : []).toEqual([LINKED_ID]);
    expect(state.drones.find((d) => d.id === LINKED_ID)?.relayDeviceId).toBeUndefined();
  });

  it('cross-room drone is not linked to a device in another room', () => {
    const state = baseState();
    const crossRoom = state.drones.find((d) => d.id === UNLINKED_ID)!;
    crossRoom.data.spawnRoom = 1;
    const event = linkEvent(state, DEVICE_ID, [UNLINKED_ID]);
    expect(event && event.type === 'signal-linked' ? event.linkedIds : []).toEqual([]);
    expect(event && event.type === 'signal-linked' ? event.skippedIds : []).toEqual([UNLINKED_ID]);
    expect(crossRoom.relayDeviceId).toBeUndefined();
  });

  it('dead drone is not linked and cannot be linked later', () => {
    const state = baseState();
    const dead = state.drones.find((d) => d.id === LINKED_ID)!;
    dead.hp = 0;
    const event = linkEvent(state, DEVICE_ID, [LINKED_ID]);
    expect(event && event.type === 'signal-linked' ? event.linkedIds : []).toEqual([]);
    expect(event && event.type === 'signal-linked' ? event.skippedIds : []).toEqual([LINKED_ID]);
    expect(dead.relayDeviceId).toBeUndefined();
  });

  it('ACTIVE starts the linked drone firing; the unlinked drone is independent', () => {
    const state = makeState();
    expect(state.signal?.relay).toBe('ACTIVE');
    expect(state.drones.find((d) => d.id === LINKED_ID)?.relayDeviceId).toBe(DEVICE_ID);
    expect(state.drones.find((d) => d.id === UNLINKED_ID)?.relayDeviceId).toBeUndefined();
    const events = stepSimulationTicks(state, 240, neutral());
    expect(shots(events, LINKED_ID), 'linked drone opens fire while ACTIVE').toBeGreaterThan(0);
    expect(shots(events, UNLINKED_ID), 'unlinked drone opens fire independently').toBeGreaterThan(0);
  });

  it('JAM suppresses NEW linked shots; unlinked keeps firing; old projectiles stay', () => {
    const state = makeState();
    const warmup = stepSimulationTicks(state, 240, neutral());
    expect(shots(warmup, LINKED_ID)).toBeGreaterThan(0);
    const beforeIds = new Set(state.projectiles.map((p) => p.id));
    expect(beforeIds.size, 'there is a live projectile before jam').toBeGreaterThan(0);

    enqueueCommand(state, { type: 'signal-jam', actor: 'player' });
    const jamEvents = stepSimulationTicks(state, 1, neutral());
    const jam = jamEvents.find((e) => e.type === 'signal-jammed');
    expect(jam && jam.type === 'signal-jammed' ? jam.ok : false).toBe(true);
    expect(state.signal?.relay).toBe('JAMMED');
    expect(state.signal?.actors.player.energy.energy).toBe(SIGNAL_TUNING.ENERGY_MAX - SIGNAL_TUNING.JAM_COST);
    const jamCd = state.signal?.actors.player.cooldowns.jamCooldownTicks ?? 0;
    // processCommands sets the full cooldown, then this tick's tickSignalDevice
    // decrements it once; assert the real post-tick value is live.
    expect(jamCd).toBeGreaterThan(0);
    expect(jamCd).toBeLessThanOrEqual(SIGNAL_TUNING.JAM_CD_TICKS);
    // Already-fired projectiles are not erased by the jam.
    const afterIds = new Set(state.projectiles.map((p) => p.id));
    expect([...beforeIds].some((id) => afterIds.has(id)), 'a pre-jam projectile is still in flight').toBe(true);

    const suppressed = stepSimulationTicks(state, 180, neutral());
    expect(shots(suppressed, LINKED_ID), 'linked drone fires 0 new shots while JAMMED').toBe(0);
    expect(shots(suppressed, UNLINKED_ID), 'unlinked drone is unaffected').toBeGreaterThan(0);
  });

  it('jam expiry restores the manual/powered state and linked fire', () => {
    const state = makeState();
    stepSimulationTicks(state, 240, neutral());
    enqueueCommand(state, { type: 'signal-jam', actor: 'player' });
    stepSimulationTicks(state, 1, neutral());
    expect(state.signal?.relay).toBe('JAMMED');
    // JAM_DURATION_TICKS + a margin; manual=true and powered=true => ACTIVE.
    stepSimulationTicks(state, SIGNAL_TUNING.JAM_DURATION_TICKS + 5, neutral());
    expect(state.signal?.relay).toBe('ACTIVE');
    const resumed = stepSimulationTicks(state, 240, neutral());
    expect(shots(resumed, LINKED_ID), 'linked drone fires again after expiry').toBeGreaterThan(0);
  });

  it('a jam while already jammed fails with no extra energy charge', () => {
    const state = makeState();
    enqueueCommand(state, { type: 'signal-jam', actor: 'player' });
    stepSimulationTicks(state, 1, neutral());
    const energyAfterFirst = state.signal!.actors.player.energy.energy;
    enqueueCommand(state, { type: 'signal-jam', actor: 'player' });
    const events = stepSimulationTicks(state, 1, neutral());
    const second = events.find((e) => e.type === 'signal-jammed');
    expect(second && second.type === 'signal-jammed' ? second.ok : true).toBe(false);
    expect(second && second.type === 'signal-jammed' ? second.code : '').toBe('E_RETRYABLE');
    expect(state.signal!.actors.player.energy.energy).toBe(energyAfterFirst);
  });

  it('scan evidence is local relay facts only (no hidden future)', () => {
    const state = makeState();
    enqueueCommand(state, { type: 'signal-scan', actor: 'player' });
    const events = stepSimulationTicks(state, 1, neutral());
    const scan = events.find((e) => e.type === 'signal-scanned');
    expect(scan && scan.type === 'signal-scanned' ? scan.ok : false).toBe(true);
    const evidence = scan && scan.type === 'signal-scanned' ? scan.evidence as Array<Record<string, unknown>> : [];
    expect(evidence.length).toBeGreaterThan(0);
    const allowed = ['expiresAtTick', 'id', 'kind', 'observedAtTick', 'observerActorId', 'x', 'y'];
    for (const entry of evidence) {
      expect(Object.keys(entry).sort()).toEqual(allowed);
      expect(entry.kind).toBe('relay');
      expect(entry.id).toBe(DEVICE_ID);
    }
    // The evidence object must not contain room ids / future targets.
    expect(JSON.stringify(evidence)).not.toMatch(/future|targets|roomId|nextRoom/i);
  });
});
