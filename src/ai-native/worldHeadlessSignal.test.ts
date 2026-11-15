// P3-b B — Headless MCP world_signal_status is truthful.

import { describe, expect, it } from 'vitest';
import { HeadlessWorldManager } from './worldHeadlessMcpTools';

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
