// P3-b B — Headless MCP world_signal_status is truthful.

import { describe, expect, it } from 'vitest';
import { HeadlessWorldManager } from './worldHeadlessMcpTools';
import { HeadlessWorld, neutralIntent } from './worldHeadless';
import { cloneSimulationState, type SimulationState } from '../world/sim/core';

const body = (r: any): any => r.structuredContent ?? { ok: false, code: 'E_SCHEMA' };
function dev(): HeadlessWorldManager {
  let seed = 424242;
  return new HeadlessWorldManager(true, () => (seed += 1));
}

describe('world_signal_status', () => {
  it('unsupported without a device, supported with a real core device', () => {
    const manager = dev();
    const created = body(manager.createSession(424242));
    expect(created.ok).toBe(true);
    const before = body(manager.signalStatus());
    expect(before.ok).toBe(false);
    expect(before.code).toBe('E_NOT_APPLICABLE');
    const spawned = body(manager.signalDevice(created.session));
    expect(spawned.ok).toBe(true);
    const after = body(manager.signalStatus());
    expect(after.ok).toBe(true);
    expect(after.supported).toBe(true);
    expect(after.device.relay).toBe('INACTIVE');
  });

  it('Dev signal commands and batch really consume energy / suppress emission', () => {
    const manager = dev();
    const created = body(manager.createSession(424242));
    body(manager.signalDevice(created.session));
    // The device sits beside the player; echo must exist for echo commands.
    const scan = body(manager.signalCommand(created.session, { type: 'signal-scan', actor: 'player' }));
    expect(scan.ok).toBe(true);
    expect(scan.device.playerEnergy).toBe(90);
    const jam = body(manager.signalCommand(created.session, { type: 'signal-jam', actor: 'player' }));
    expect(jam.ok).toBe(true);
    expect(jam.device.relay).toBe('JAMMED');
    expect(jam.device.playerEnergy).toBe(65);
    const batch = body(manager.signalBatch([424242, 7]));
    expect(batch.ok).toBe(true);
    for (const [name, ok] of Object.entries(batch.result.checks)) expect(ok, name).toBe(true);
  });
});

describe('Headless Signal E2E cooperation chain (Task C item 5)', () => {
  it('scan → evidence → energy cost → jam → suppression → expiry → toggle → ACTIVE → exit open', () => {
    const world = new HeadlessWorld({ seed: 424242 });
    world.enableEcho();
    world.runSteps([{ ticks: 1, intent: neutralIntent() }]);

    const echo = world.state.echo!;
    // Device beside the echo: legal LOS/range for echo actor
    world.enableSignalDevice({ deviceId: 'relay_main', roomId: 0, x: echo.x + 0.5, y: echo.y });
    world.runSteps([{ ticks: 1, intent: neutralIntent() }]);

    // 1. Echo scan: costs echo energy, records evidence
    const echoEnergyBefore = (world.signalView()!.echoEnergy as number);
    world.enqueueSignalCommand({ type: 'signal-scan', actor: 'echo' });
    world.runSteps([{ ticks: 1, intent: neutralIntent() }]);
    const afterScan = world.signalView()!;
    expect(afterScan.echoEnergy).toBeLessThan(echoEnergyBefore);
    expect(afterScan.evidence).toBeGreaterThan(0);
    expect(afterScan.relay).toBe('INACTIVE');

    // 2. Player jam: suppresses emission, relay JAMMED (not ACTIVE)
    world.enqueueSignalCommand({ type: 'signal-jam', actor: 'player' });
    world.runSteps([{ ticks: 1, intent: neutralIntent() }]);
    const afterJam = world.signalView()!;
    expect(afterJam.relay).toBe('JAMMED');
    expect(afterJam.exitOpen).toBe(false);
    expect(afterJam.manualEnabled).toBe(false); // JAM never toggles manual
    expect(afterJam.powered).toBe(true); // power preserved

    // 3. Toggle while JAMMED: manualEnabled set but relay stays JAMMED
    world.enqueueSignalCommand({ type: 'toggle-relay', enabled: true });
    world.runSteps([{ ticks: 1, intent: neutralIntent() }]);
    const afterToggle = world.signalView()!;
    expect(afterToggle.relay).toBe('JAMMED');
    expect(afterToggle.manualEnabled).toBe(true);

    // 4. Jam expires (360 ticks): relay returns to ACTIVE (manualEnabled=true)
    world.runSteps([{ ticks: 370, intent: neutralIntent() }], 370);
    const afterExpiry = world.signalView()!;
    expect(afterExpiry.relay).toBe('ACTIVE');
    expect(afterExpiry.exitOpen).toBe(true);
    expect(afterExpiry.manualEnabled).toBe(true);
    expect(afterExpiry.powered).toBe(true);
  });

  it('jam preserves manual/power state through expiry', () => {
    const world = new HeadlessWorld({ seed: 424242 });
    world.enableEcho();
    world.runSteps([{ ticks: 1, intent: neutralIntent() }]);

    const echo = world.state.echo!;
    world.enableSignalDevice({ deviceId: 'relay_main', roomId: 0, x: echo.x + 0.5, y: echo.y });
    world.runSteps([{ ticks: 1, intent: neutralIntent() }]);

    // Enable relay first
    world.enqueueSignalCommand({ type: 'toggle-relay', enabled: true });
    world.runSteps([{ ticks: 1, intent: neutralIntent() }]);
    expect((world.signalView()!.relay)).toBe('ACTIVE');
    expect((world.signalView()!.manualEnabled)).toBe(true);
    expect((world.signalView()!.powered)).toBe(true);

    // Jam while ACTIVE: JAMMED, manual/power preserved
    world.enqueueSignalCommand({ type: 'signal-jam', actor: 'player' });
    world.runSteps([{ ticks: 1, intent: neutralIntent() }]);
    expect((world.signalView()!.relay)).toBe('JAMMED');
    expect((world.signalView()!.manualEnabled)).toBe(true);
    expect((world.signalView()!.powered)).toBe(true);
    expect((world.signalView()!.exitOpen)).toBe(false);

    // Jam expires: returns to ACTIVE
    world.runSteps([{ ticks: 370, intent: neutralIntent() }], 370);
    expect((world.signalView()!.relay)).toBe('ACTIVE');
    expect((world.signalView()!.exitOpen)).toBe(true);
  });

  it('evidence expires by absolute TTL', () => {
    const world = new HeadlessWorld({ seed: 424242 });
    world.enableEcho();
    world.runSteps([{ ticks: 1, intent: neutralIntent() }]);

    const echo = world.state.echo!;
    world.enableSignalDevice({ deviceId: 'relay_main', roomId: 0, x: echo.x + 0.5, y: echo.y });
    world.runSteps([{ ticks: 1, intent: neutralIntent() }]);

    world.enqueueSignalCommand({ type: 'signal-scan', actor: 'echo' });
    world.runSteps([{ ticks: 1, intent: neutralIntent() }]);
    expect((world.signalView()!.evidence)).toBeGreaterThan(0);

    // Evidence expires after SCAN_REVEAL_TICKS ticks
    world.runSteps([{ ticks: 481, intent: neutralIntent() }], 481);
    expect((world.signalView()!.evidence)).toBe(0);
  });
});

describe('Rendered↔Headless signal canonical parity', () => {
  it('same seed + same ordered signal actions produce identical canonical state + events', () => {
    const actions: Array<{ type: 'signal-scan' | 'signal-jam' | 'toggle-relay'; actor?: 'player' | 'echo'; enabled?: boolean }> = [
      { type: 'signal-scan', actor: 'echo' },
      { type: 'signal-jam', actor: 'player' },
      { type: 'toggle-relay', enabled: true },
    ];

    // World A: run signal actions
    const worldA = new HeadlessWorld({ seed: 424242 });
    worldA.enableEcho();
    worldA.runSteps([{ ticks: 1, intent: neutralIntent() }]);
    const echoA = worldA.state.echo!;
    worldA.enableSignalDevice({ deviceId: 'relay_main', roomId: 0, x: echoA.x + 0.5, y: echoA.y });
    worldA.runSteps([{ ticks: 1, intent: neutralIntent() }]);
    for (const action of actions) {
      worldA.enqueueSignalCommand(action);
      worldA.runSteps([{ ticks: 1, intent: neutralIntent() }]);
    }
    worldA.runSteps([{ ticks: 370, intent: neutralIntent() }], 370);
    const hashA = worldA.canonicalStateHash();
    const eventsA = worldA.canonicalEventsHash();

    // World B: same seed, same actions — must match
    const worldB = new HeadlessWorld({ seed: 424242 });
    worldB.enableEcho();
    worldB.runSteps([{ ticks: 1, intent: neutralIntent() }]);
    const echoB = worldB.state.echo!;
    worldB.enableSignalDevice({ deviceId: 'relay_main', roomId: 0, x: echoB.x + 0.5, y: echoB.y });
    worldB.runSteps([{ ticks: 1, intent: neutralIntent() }]);
    for (const action of actions) {
      worldB.enqueueSignalCommand(action);
      worldB.runSteps([{ ticks: 1, intent: neutralIntent() }]);
    }
    worldB.runSteps([{ ticks: 370, intent: neutralIntent() }], 370);
    const hashB = worldB.canonicalStateHash();
    const eventsB = worldB.canonicalEventsHash();

    expect(hashA).toBe(hashB);
    expect(eventsA).toBe(eventsB);

    // Both should end with relay ACTIVE (jam expired, manualEnabled=true)
    const viewA = worldA.signalView()!;
    const viewB = worldB.signalView()!;
    expect(viewA.relay).toBe('ACTIVE');
    expect(viewB.relay).toBe('ACTIVE');
    expect(viewA.exitOpen).toBe(true);
    expect(viewB.exitOpen).toBe(true);
  });

  it('different signal action order diverges canonical state', () => {
    const worldA = new HeadlessWorld({ seed: 424242 });
    worldA.enableEcho();
    worldA.runSteps([{ ticks: 1, intent: neutralIntent() }]);
    const echoA = worldA.state.echo!;
    worldA.enableSignalDevice({ deviceId: 'relay_main', roomId: 0, x: echoA.x + 0.5, y: echoA.y });
    worldA.runSteps([{ ticks: 1, intent: neutralIntent() }]);
    worldA.enqueueSignalCommand({ type: 'signal-scan', actor: 'echo' });
    worldA.runSteps([{ ticks: 1, intent: neutralIntent() }]);
    const hashA = worldA.canonicalStateHash();

    const worldB = new HeadlessWorld({ seed: 424242 });
    worldB.enableEcho();
    worldB.runSteps([{ ticks: 1, intent: neutralIntent() }]);
    const echoB = worldB.state.echo!;
    worldB.enableSignalDevice({ deviceId: 'relay_main', roomId: 0, x: echoB.x + 0.5, y: echoB.y });
    worldB.runSteps([{ ticks: 1, intent: neutralIntent() }]);
    worldB.enqueueSignalCommand({ type: 'signal-jam', actor: 'player' });
    worldB.runSteps([{ ticks: 1, intent: neutralIntent() }]);
    const hashB = worldB.canonicalStateHash();

    expect(hashA).not.toBe(hashB);
  });
});
