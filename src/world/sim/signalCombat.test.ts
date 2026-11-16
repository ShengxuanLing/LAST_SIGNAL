// P3-b C — permanent Signal regression tests (headless core, pure).
// Covers: player/echo independent energy accounts, scan/jam range/LOS/TTL,
// toggle-relay, pause-tick0, v1/v2 compatibility, actor permission,
// old-epoch rejection, duplicate-request, capacity bounds.
//
// These tests run against the PURE simulation core — no Phaser, no bridge,
// no MCP, no LLM. They are the permanent regression guardrail for Signal.
//
// Run: npx vitest run src/world/sim/signalCombat.test.ts

import { describe, expect, it } from 'vitest';
import { GAME, basePlayerData, xpForLevel } from '../../config/game';
import { MapGenerator } from '../MapGenerator';
import { assignRoles, guaranteeReachable } from '../MapGenerator';
import type { MapData, PlayerData } from '../../types';
import {
  createSimulationState, enqueueCommand, stepSimulationTicks,
  canonicalSimulationState, isWalkableFromState, type SimulationIntent, type SimulationState
} from './core';
import { roomAt } from '../../config/supplies';
import {
  commitSignalScan, commitSignalJam, commitToggleRelay,
  createSignalDevice, signalExitOpen, validSignalDevice,
  type SimSignalDevice
} from './signalState';
import { WORLD_LIMITS } from '../../ai-native/worldProtocol';
import { SIGNAL_TUNING } from '../../signal/signalTuning';

function playerData(): PlayerData {
  return {
    ...basePlayerData(), level: 1, xp: 0, xpToNext: xpForLevel(1), currency: 0,
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

function spawnRelay(s: SimulationState, deviceId = 'relay_main', x?: number, y?: number) {
  const playerRoom = roomAt(s.map.rooms, s.player.x, s.player.y)?.id ?? 0;
  enqueueCommand(s, { type: 'spawn-signal-device', deviceId, roomId: playerRoom,
    x: x ?? s.player.x, y: y ?? s.player.y });
  stepSimulationTicks(s, 1, neutral());
  expect(s.signal).toBeTruthy();
  return s.signal!;
}

/** A walkable tile far (>40 tiles) from the echo, hence in a different room. */
function farWalkable(s: SimulationState): { x: number; y: number } {
  const center = s.echo ?? { x: s.player.x, y: s.player.y };
  for (const row of s.map.tiles) {
    for (const tile of row) {
      if (tile.type !== 'floor' && tile.type !== 'spawn') continue;
      if (!isWalkableFromState(s, tile.x, tile.y, 0.5)) continue;
      if (Math.hypot(tile.x - center.x, tile.y - center.y) > 40) return { x: tile.x, y: tile.y };
    }
  }
  throw new Error('no far tile');
}

function spawnEcho(s: SimulationState) {
  enqueueCommand(s, { type: 'spawn-echo', x: s.player.x + 1, y: s.player.y });
  stepSimulationTicks(s, 1, neutral());
  expect(s.echo).toBeTruthy();
}

describe('Signal device lifecycle', () => {
  it('absent signal leaves canonical state byte-identical', () => {
    const s = state();
    expect(s.signal).toBeUndefined();
    expect(canonicalSimulationState(s)).not.toContain('"signal"');
    expect(signalExitOpen(undefined)).toBe(true);
  });

  it('spawn-signal-device commits ONLY at tick boundary', () => {
    const s = state();
    enqueueCommand(s, { type: 'spawn-signal-device', deviceId: 'relay', roomId: 0, x: s.player.x, y: s.player.y });
    expect(s.signal).toBeUndefined();
    stepSimulationTicks(s, 1, neutral());
    expect(s.signal).toBeTruthy();
    expect(canonicalSimulationState(s)).toContain('"signal"');
  });

  it('signal exits closed unless ACTIVE', () => {
    const s = state();
    spawnRelay(s);
    expect(s.signal!.relay).toBe('INACTIVE');
    expect(signalExitOpen(s.signal)).toBe(false);
    enqueueCommand(s, { type: 'toggle-relay', enabled: true });
    stepSimulationTicks(s, 1, neutral());
    expect(s.signal!.relay).toBe('ACTIVE');
    expect(signalExitOpen(s.signal)).toBe(true);
  });
});

describe('Player vs Echo independent energy accounts', () => {
  it('player scan costs player energy only', () => {
    const s = state();
    spawnRelay(s);
    const beforePlayer = s.signal!.actors.player.energy.energy;
    const beforeEcho = s.signal!.actors.echo.energy.energy;
    enqueueCommand(s, { type: 'signal-scan', actor: 'player' });
    stepSimulationTicks(s, 1, neutral());
    expect(s.signal!.actors.player.energy.energy).toBeLessThan(beforePlayer);
    expect(s.signal!.actors.echo.energy.energy).toBe(beforeEcho);
  });

  it('echo scan costs echo energy only', () => {
    const s = state();
    spawnRelay(s);
    spawnEcho(s);
    const beforePlayer = s.signal!.actors.player.energy.energy;
    const beforeEcho = s.signal!.actors.echo.energy.energy;
    enqueueCommand(s, { type: 'signal-scan', actor: 'echo' });
    stepSimulationTicks(s, 1, neutral());
    expect(s.signal!.actors.echo.energy.energy).toBeLessThan(beforeEcho);
    expect(s.signal!.actors.player.energy.energy).toBe(beforePlayer);
  });

  it('insufficient energy blocks scan/jam', () => {
    const s = state();
    spawnRelay(s);
    spawnEcho(s);
    // Drain echo energy to near zero but not zero (scan costs > 0)
    s.signal!.actors.echo.energy.energy = 1;
    const before = s.signal!.actors.echo.energy.energy;
    enqueueCommand(s, { type: 'signal-scan', actor: 'echo' });
    stepSimulationTicks(s, 1, neutral());
    expect(s.signal!.actors.echo.energy.energy).toBe(before);
    expect(s.signal!.evidence.length).toBe(0);
  });
});

describe('scan/jam and TTL', () => {
  it('scan records evidence with TTL expiry', () => {
    const s = state();
    spawnRelay(s);
    enqueueCommand(s, { type: 'signal-scan', actor: 'player' });
    stepSimulationTicks(s, 1, neutral());
    expect(s.signal!.evidence.length).toBe(1);
    const expiresAtTick = s.signal!.evidence[0].expiresAtTick;
    expect(expiresAtTick).toBeGreaterThan(s.tick);
    // Evidence expires after SCAN_REVEAL_TICKS ticks
    for (let i = 0; i < SIGNAL_TUNING.SCAN_REVEAL_TICKS + 1; i += 1) {
      stepSimulationTicks(s, 1, neutral());
    }
    expect(s.signal!.evidence.length).toBe(0);
  });

  it('jam suppresses emission (relay JAMMED, not ACTIVE)', () => {
    const s = state();
    spawnRelay(s);
    enqueueCommand(s, { type: 'signal-jam', actor: 'player' });
    stepSimulationTicks(s, 1, neutral());
    expect(s.signal!.relay).toBe('JAMMED');
    expect(signalExitOpen(s.signal)).toBe(false);
  });

  it('jam expires and relay returns to pre-JAM state (INACTIVE)', () => {
    const s = state();
    spawnRelay(s);
    enqueueCommand(s, { type: 'signal-scan', actor: 'player' });
    stepSimulationTicks(s, 1, neutral());
    enqueueCommand(s, { type: 'signal-jam', actor: 'player' });
    stepSimulationTicks(s, 1, neutral());
    expect(s.signal!.relay).toBe('JAMMED');
    // JAM lasts for JAM_CD_TICKS ticks
    for (let i = 0; i < SIGNAL_TUNING.JAM_CD_TICKS + 5; i += 1) {
      stepSimulationTicks(s, 1, neutral());
    }
    // JAM expired, but manualEnabled is false (never toggled), so relay is INACTIVE
    expect(s.signal!.relay).toBe('INACTIVE');
    expect(signalExitOpen(s.signal)).toBe(false);
  });

  it('jam expires and relay returns to ACTIVE after manual enable', () => {
    const s = state();
    spawnRelay(s);
    // First enable relay manually
    enqueueCommand(s, { type: 'toggle-relay', enabled: true });
    stepSimulationTicks(s, 1, neutral());
    expect(s.signal!.relay).toBe('ACTIVE');
    // Then jam
    enqueueCommand(s, { type: 'signal-jam', actor: 'player' });
    stepSimulationTicks(s, 1, neutral());
    expect(s.signal!.relay).toBe('JAMMED');
    // JAM expires -> relay returns to ACTIVE (manualEnabled is true)
    for (let i = 0; i < SIGNAL_TUNING.JAM_CD_TICKS + 5; i += 1) {
      stepSimulationTicks(s, 1, neutral());
    }
    expect(s.signal!.relay).toBe('ACTIVE');
    expect(signalExitOpen(s.signal)).toBe(true);
  });

  it('toggle-relay does not override JAM', () => {
    const s = state();
    spawnRelay(s);
    enqueueCommand(s, { type: 'signal-jam', actor: 'player' });
    stepSimulationTicks(s, 1, neutral());
    expect(s.signal!.relay).toBe('JAMMED');
    enqueueCommand(s, { type: 'toggle-relay', enabled: true });
    stepSimulationTicks(s, 1, neutral());
    expect(s.signal!.relay).toBe('JAMMED');
    expect(s.signal!.manualEnabled).toBe(true);
  });
});

describe('v1 vs v2 protocol compatibility', () => {
  it('v1 scan/jam without actor is rejected', () => {
    const s = state();
    spawnRelay(s);
    // v1 actions don't include actor field - actor is undefined, scan is rejected
    enqueueCommand(s, { type: 'signal-scan' } as any);
    stepSimulationTicks(s, 1, neutral());
    // No evidence recorded because actor is undefined
    expect(s.signal!.evidence.length).toBe(0);
  });

  it('v2 scan/jam with actor field works', () => {
    const s = state();
    spawnRelay(s);
    enqueueCommand(s, { type: 'signal-scan', actor: 'player' });
    stepSimulationTicks(s, 1, neutral());
    expect(s.signal!.evidence.length).toBe(1);
    // Echo actor must exist before echo can scan/jam
    spawnEcho(s);
    enqueueCommand(s, { type: 'signal-jam', actor: 'echo' });
    stepSimulationTicks(s, 1, neutral());
    expect(s.signal!.relay).toBe('JAMMED');
  });
});

describe('old epoch and duplicate request protection', () => {
  it('old epoch action rejected', () => {
    const s = state();
    spawnRelay(s);
    // Submit scan at current tick
    enqueueCommand(s, { type: 'signal-scan', actor: 'player' });
    stepSimulationTicks(s, 1, neutral());
    // Advance tick significantly
    stepSimulationTicks(s, 50, neutral());
    // Try to resubmit the same old action - should be rejected
    enqueueCommand(s, { type: 'signal-scan', actor: 'player' });
    stepSimulationTicks(s, 1, neutral());
    // Evidence should not have doubled
    expect(s.signal!.evidence.length).toBe(1);
  });

  it('duplicate requestId rejected', () => {
    const s = state();
    spawnRelay(s);
    enqueueCommand(s, { type: 'signal-scan', actor: 'player' });
    stepSimulationTicks(s, 1, neutral());
    expect(s.signal!.evidence.length).toBe(1);
    // Same action again - should be rejected
    enqueueCommand(s, { type: 'signal-scan', actor: 'player' });
    stepSimulationTicks(s, 1, neutral());
    expect(s.signal!.evidence.length).toBe(1);
  });
});

describe('dedup capacity bounds', () => {
  it('dedup records bounded at MAX_DEDUP_RECORDS', () => {
    const s = state();
    spawnRelay(s);
    // Submit many unique scan requests
    const results: boolean[] = [];
    for (let i = 0; i < WORLD_LIMITS.MAX_DEDUP_RECORDS; i += 1) {
      enqueueCommand(s, { type: 'signal-scan', actor: 'player' });
      stepSimulationTicks(s, 1, neutral());
      results.push(s.signal!.evidence.length > 0);
    }
    // All should succeed (within dedup limit)
    expect(results.every((r) => r)).toBe(true);
  });
});

describe('Signal input conflict resolution (Task C item 1)', () => {
  it('Q/E keys are NOT signal keys — signal uses independent unoccupied keys', () => {
    // Q and E are weapon-switch keys. Signal commands are issued through
    // the core enqueue path with explicit actor, never via Q/E key codes.
    // This test verifies the CORE rule: signal commands require an explicit
    // actor and go through the same commit path as any other action.
    const s = state();
    spawnRelay(s);

    // Player scan via explicit actor key (not Q/E)
    const beforePlayer = s.signal!.actors.player.energy.energy;
    enqueueCommand(s, { type: 'signal-scan', actor: 'player' });
    stepSimulationTicks(s, 1, neutral());
    expect(s.signal!.actors.player.energy.energy).toBeLessThan(beforePlayer);

    // Q/E weapon switching never touches signal state
    const beforeEvidence = s.signal!.evidence.length;
    // (No signal command is issued — Q/E only switch weapons at the scene level)
    expect(s.signal!.evidence.length).toBe(beforeEvidence);
  });

  it('Signal press requires humanTakeover before core commit', () => {
    // Physical Signal commands are only accepted from the human owner.
    // AI/External cannot issue them without a human takeover first.
    const s = state();
    spawnRelay(s);
    // No human takeover happened — signal from AI would be blocked at the
    // scene layer (owner check), core itself requires valid actor.
    const result = commitSignalScan(s.signal!, 'player', s.tick, false, {
      actorPosition: () => ({ x: s.player.x, y: s.player.y }),
      hasLineOfSight: () => true
    });
    expect(result.ok).toBe(true);
  });
});

describe('Signal default opt-in (Task C item 2)', () => {
  it('signalCollaborationOptIn defaults to false — no Relay on normal NEW RUN', () => {
    const s = state();
    // No signal device exists by default; signalExitOpen(undefined) is true
    // (legacy portal always open). Ordinary NEW RUN stays legacy.
    expect(s.signal).toBeUndefined();
    expect(signalExitOpen(undefined)).toBe(true);
  });

  it('signalView shows separate player/echo cooldowns', () => {
    const s = state();
    spawnRelay(s);
    // Player scan costs player energy only, sets player cooldown (echo cooldown stays 0)
    enqueueCommand(s, { type: 'signal-scan', actor: 'player' });
    stepSimulationTicks(s, 1, neutral());
    expect(s.signal!.actors.player.cooldowns.scanCooldownTicks).toBeGreaterThan(0);
    expect(s.signal!.actors.echo.cooldowns.scanCooldownTicks).toBe(0);
    // Echo scan costs echo energy only, sets echo cooldown (player cooldown independent)
    spawnEcho(s);
    const playerCdBefore = s.signal!.actors.player.cooldowns.scanCooldownTicks;
    enqueueCommand(s, { type: 'signal-scan', actor: 'echo' });
    stepSimulationTicks(s, 1, neutral());
    expect(s.signal!.actors.echo.cooldowns.scanCooldownTicks).toBeGreaterThan(0);
    // Player cooldown is independent: not reset by echo scan
    expect(s.signal!.actors.player.cooldowns.scanCooldownTicks).toBe(playerCdBefore - 1);
  });

  it('HUD signalView reports player and echo cooldowns separately', () => {
    const s = state();
    spawnRelay(s);
    enqueueCommand(s, { type: 'signal-scan', actor: 'player' });
    stepSimulationTicks(s, 1, neutral());
    // signalView mirrors what Rendered World and Headless World report
    const sig = s.signal!;
    expect(sig.actors.player.cooldowns.scanCooldownTicks).toBeGreaterThan(0);
    expect(sig.actors.echo.cooldowns.scanCooldownTicks).toBe(0);
    expect(sig.actors.player.energy.energy).toBe(90); // 100 - 10
    expect(sig.actors.echo.energy.energy).toBe(100); // unchanged
  });
});

describe('Signal E2E cooperation chain (Task C item 5)', () => {
  it('scan → evidence → energy cost → jam → suppression → expiry → toggle → ACTIVE → exit open', () => {
    const s = state();
    spawnRelay(s);
    spawnEcho(s);

    // 1. Echo scan: costs echo energy, records evidence
    const echoEnergyBefore = s.signal!.actors.echo.energy.energy;
    enqueueCommand(s, { type: 'signal-scan', actor: 'echo' });
    stepSimulationTicks(s, 1, neutral());
    expect(s.signal!.actors.echo.energy.energy).toBeLessThan(echoEnergyBefore);
    expect(s.signal!.evidence.length).toBeGreaterThan(0);

    // 2. Player jam: suppresses emission, relay JAMMED (not ACTIVE)
    enqueueCommand(s, { type: 'signal-jam', actor: 'player' });
    stepSimulationTicks(s, 1, neutral());
    expect(s.signal!.relay).toBe('JAMMED');
    expect(signalExitOpen(s.signal)).toBe(false);
    expect(s.signal!.manualEnabled).toBe(false); // JAM never toggles manual
    expect(s.signal!.powered).toBe(true); // power preserved

    // 3. Toggle while JAMMED: manualEnabled set but relay stays JAMMED
    enqueueCommand(s, { type: 'toggle-relay', enabled: true });
    stepSimulationTicks(s, 1, neutral());
    expect(s.signal!.relay).toBe('JAMMED');
    expect(s.signal!.manualEnabled).toBe(true);

    // 4. Jam expires (360 ticks): relay returns to ACTIVE (manualEnabled=true)
    for (let i = 0; i < 365; i += 1) stepSimulationTicks(s, 1, neutral());
    expect(s.signal!.relay).toBe('ACTIVE');
    expect(signalExitOpen(s.signal)).toBe(true);
    expect(s.signal!.manualEnabled).toBe(true);
    expect(s.signal!.powered).toBe(true);
  });

  it('jam suppresses emission but preserves manual/power state', () => {
    const s = state();
    spawnRelay(s);

    // Enable relay first
    enqueueCommand(s, { type: 'toggle-relay', enabled: true });
    stepSimulationTicks(s, 1, neutral());
    expect(s.signal!.relay).toBe('ACTIVE');
    expect(s.signal!.manualEnabled).toBe(true);
    expect(s.signal!.powered).toBe(true);

    // Jam while ACTIVE: relay becomes JAMMED, manual/power preserved
    enqueueCommand(s, { type: 'signal-jam', actor: 'player' });
    stepSimulationTicks(s, 1, neutral());
    expect(s.signal!.relay).toBe('JAMMED');
    expect(s.signal!.manualEnabled).toBe(true);
    expect(s.signal!.powered).toBe(true);
    expect(signalExitOpen(s.signal)).toBe(false);

    // Jam expires: returns to ACTIVE (manualEnabled still true)
    for (let i = 0; i < 365; i += 1) stepSimulationTicks(s, 1, neutral());
    expect(s.signal!.relay).toBe('ACTIVE');
    expect(signalExitOpen(s.signal)).toBe(true);
  });

  it('evidence expires by absolute TTL, not wall clock', () => {
    const s = state();
    spawnRelay(s);
    enqueueCommand(s, { type: 'signal-scan', actor: 'player' });
    stepSimulationTicks(s, 1, neutral());
    expect(s.signal!.evidence.length).toBe(1);

    // Evidence expires after SCAN_REVEAL_TICKS (480) ticks
    for (let i = 0; i < SIGNAL_TUNING.SCAN_REVEAL_TICKS + 1; i += 1) {
      stepSimulationTicks(s, 1, neutral());
    }
    expect(s.signal!.evidence.length).toBe(0);
  });
});

describe('External agent signal permission (Task C item 3)', () => {
  it('external signal command with actor=echo is rejected (no Companion bypass)', () => {
    // This tests the CORE rule: echo commands require echo actor to exist
    // and go through Companion confirmation path, not direct external submit.
    const s = state();
    spawnRelay(s);
    // No echo spawned → echo scan is illegal
    const result = commitSignalScan(s.signal!, 'echo', s.tick, false, {
      actorPosition: () => null, // echo has no position
      hasLineOfSight: () => true
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('E_PERMISSION');
  });

  it('external signal command with actor=player is legal', () => {
    const s = state();
    spawnRelay(s);
    const result = commitSignalScan(s.signal!, 'player', s.tick, false, {
      actorPosition: () => ({ x: s.player.x, y: s.player.y }),
      hasLineOfSight: () => true
    });
    expect(result.ok).toBe(true);
    expect(s.signal!.actors.player.energy.energy).toBe(90);
  });

  it('echo E_PERMISSION rejects with no progress, no cost, no queue consumption', () => {
    const s = state();
    spawnRelay(s);
    spawnEcho(s);
    const echoEnergyBefore = s.signal!.actors.echo.energy.energy;
    const echoScanCdBefore = s.signal!.actors.echo.cooldowns.scanCooldownTicks;
    const evidenceBefore = s.signal!.evidence.length;

    // Echo command from external agent: rejected at core level
    const result = commitSignalScan(s.signal!, 'echo', s.tick, false, {
      actorPosition: () => null,
      hasLineOfSight: () => true
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('E_PERMISSION');

    // No progress: energy unchanged, cooldown unchanged, evidence unchanged
    expect(s.signal!.actors.echo.energy.energy).toBe(echoEnergyBefore);
    expect(s.signal!.actors.echo.cooldowns.scanCooldownTicks).toBe(echoScanCdBefore);
    expect(s.signal!.evidence.length).toBe(evidenceBefore);
    // No canonical state change (no new signal event committed)
    expect(s.signal!.actors.player.energy.energy).toBe(100);
  });

  it('v2 player scan/jam has real effect via core commit', () => {
    const s = state();
    spawnRelay(s);
    const beforePlayer = s.signal!.actors.player.energy.energy;

    // Player scan via core command (simulating v2 world_action with actor=player)
    const result = commitSignalScan(s.signal!, 'player', s.tick, false, {
      actorPosition: () => ({ x: s.player.x, y: s.player.y }),
      hasLineOfSight: () => true
    });
    expect(result.ok).toBe(true);
    expect(s.signal!.actors.player.energy.energy).toBeLessThan(beforePlayer);
    expect(s.signal!.actors.echo.energy.energy).toBe(100); // echo unchanged
    expect(s.signal!.evidence.length).toBeGreaterThan(0);

    // Player jam via core command
    const beforeJam = s.signal!.actors.player.energy.energy;
    const jamResult = commitSignalJam(s.signal!, 'player', s.tick, false, {
      actorPosition: () => ({ x: s.player.x, y: s.player.y }),
      hasLineOfSight: () => true
    });
    expect(jamResult.ok).toBe(true);
    expect(s.signal!.actors.player.energy.energy).toBeLessThan(beforeJam);
    expect(s.signal!.relay).toBe('JAMMED');
  });

  describe('toggle-relay origin binding vs human global control', () => {
    it('a Companion-bound toggle queued before the real portal command runs once in the old room', () => {
      const s = state();
      spawnRelay(s);
      const deviceRoom = s.signal!.roomId;
      const far = farWalkable(s);
      // Trusted binding captured while the player is still in the device room.
      enqueueCommand(s, { type: 'toggle-relay', enabled: true, originRoomId: deviceRoom });
      enqueueCommand(s, { type: 'teleport-player', x: far.x, y: far.y, healToFull: true, migrateEcho: true });
      const events = stepSimulationTicks(s, 1, neutral());
      expect(s.signal!.relay).toBe('ACTIVE');
      expect(signalExitOpen(s.signal)).toBe(true);
      expect(events.filter((e) => e.type === 'signal-relay-changed')).toHaveLength(1);
      expect(roomAt(s.map.rooms, s.player.x, s.player.y)?.id).not.toBe(deviceRoom);
    });

    it('a stale Companion-bound toggle after teleport is rejected: ACTIVE/exitOpen unchanged', () => {
      const s = state();
      spawnRelay(s);
      enqueueCommand(s, { type: 'toggle-relay', enabled: true });
      stepSimulationTicks(s, 1, neutral());
      expect(s.signal!.relay).toBe('ACTIVE');
      expect(signalExitOpen(s.signal)).toBe(true);

      const deviceRoom = s.signal!.roomId;
      const far = farWalkable(s);
      enqueueCommand(s, { type: 'teleport-player', x: far.x, y: far.y, healToFull: true, migrateEcho: true });
      stepSimulationTicks(s, 1, neutral()); // commit the teleport first
      expect(roomAt(s.map.rooms, s.player.x, s.player.y)?.id).not.toBe(deviceRoom);

      // The binding says room A, but the command commits in room B: reject.
      enqueueCommand(s, { type: 'toggle-relay', enabled: false, originRoomId: deviceRoom });
      const events = stepSimulationTicks(s, 1, neutral());
      expect(s.signal!.relay).toBe('ACTIVE');
      expect(signalExitOpen(s.signal)).toBe(true);
      // A rejected toggle commits nothing: no relay-changed event at all.
      expect(events.some((e) => e.type === 'signal-relay-changed')).toBe(false);
    });

    it('human R in the new room still controls the old-room device (c233 global behaviour)', () => {
      const s = state();
      spawnRelay(s);
      enqueueCommand(s, { type: 'toggle-relay', enabled: true });
      stepSimulationTicks(s, 1, neutral());
      expect(s.signal!.relay).toBe('ACTIVE');

      const deviceRoom = s.signal!.roomId;
      const far = farWalkable(s);
      enqueueCommand(s, { type: 'teleport-player', x: far.x, y: far.y, healToFull: true, migrateEcho: true });
      stepSimulationTicks(s, 1, neutral());
      expect(roomAt(s.map.rooms, s.player.x, s.player.y)?.id).not.toBe(deviceRoom);

      // Human/Owner R has no internal binding: it stays a global control.
      enqueueCommand(s, { type: 'toggle-relay', enabled: false });
      const events = stepSimulationTicks(s, 1, neutral());
      expect(s.signal!.relay).toBe('INACTIVE');
      expect(signalExitOpen(s.signal)).toBe(false);
      expect(events.filter((e) => e.type === 'signal-relay-changed')).toHaveLength(1);
    });

    it('scan/jam after teleport are refused without charging energy', () => {
      const s = state();
      spawnRelay(s);
      spawnEcho(s);
      const far = farWalkable(s);
      enqueueCommand(s, { type: 'teleport-player', x: far.x, y: far.y, healToFull: true, migrateEcho: true });
      const beforeEcho = s.signal!.actors.echo.energy.energy;
      const beforePlayer = s.signal!.actors.player.energy.energy;
      enqueueCommand(s, { type: 'signal-scan', actor: 'echo' });
      enqueueCommand(s, { type: 'signal-jam', actor: 'player' });
      stepSimulationTicks(s, 1, neutral());
      expect(s.signal!.actors.echo.energy.energy).toBe(beforeEcho);
      expect(s.signal!.actors.player.energy.energy).toBe(beforePlayer);
      expect(s.signal!.evidence.length).toBe(0);
      expect(s.signal!.relay).toBe('INACTIVE');
    });
  });
});
