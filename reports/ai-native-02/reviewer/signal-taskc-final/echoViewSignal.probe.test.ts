// REVIEWER PROBE (not part of the frozen commit) — independent negative checks
// for the new echo-only Signal projection in src/world/echoView.ts (363eb17).
import { describe, expect, it } from 'vitest';
import { buildEchoObservation, isEchoObservation } from '../world/echoView';
import { echoPlayerData } from '../world/sim/core';
import type { SimEchoState } from '../world/sim/core';

function echo(x: number, y: number): SimEchoState {
  return { actorId: 1, x, y, data: echoPlayerData(), dashTimer: 0, invuln: 0, hurtTimer: 0, fireTimer: 0, aimYaw: 0 };
}
const seen = () => true;
const clear = () => false;
const base = {
  echo: echo(0, 0), player: { x: 0, y: 0 }, tick: 5,
  drones: [], targets: [], isExplored: seen, isOpaque: clear
};
const device = (x: number, y: number, relay = 'INACTIVE') => ({
  deviceId: 'relay_main', x, y, relay,
  powered: true, manualEnabled: false, jammedUntilTick: 999
});

describe('echoView Signal projection (reviewer probe)', () => {
  it('hides the relay when it is outside the echo radius', () => {
    const v = buildEchoObservation({ ...base, signal: device(12, 0) }); // >= 12 tiles
    expect(v).not.toHaveProperty('relay');
    expect(v).not.toHaveProperty('objectiveBlocked');
  });
  it('hides the relay when the cell was never explored', () => {
    const v = buildEchoObservation({ ...base, isExplored: () => false, signal: device(3, 0) });
    expect(v).not.toHaveProperty('relay');
  });
  it('hides the relay behind a wall (LOS)', () => {
    const v = buildEchoObservation({ ...base, isOpaque: (x: number) => x > 1 && x < 3, signal: device(4, 0) });
    expect(v).not.toHaveProperty('relay');
  });
  it('reports only {id,x,y,state} — no powered/manual/jam deadline leak', () => {
    const v = buildEchoObservation({ ...base, signal: device(3, 0) });
    expect(v.relay).toEqual({ id: 'relay_main', x: 3, y: 0, state: 'INACTIVE' });
    const json = JSON.stringify(v);
    expect(json).not.toContain('manualEnabled');
    expect(json).not.toContain('jammedUntilTick');
    expect(json).not.toContain('jammedUntil');
    expect(json).not.toContain('powered');
  });
  it('objectiveBlocked only when a perceived relay is not ACTIVE', () => {
    expect(buildEchoObservation({ ...base, signal: device(3, 0, 'ACTIVE') })).not.toHaveProperty('objectiveBlocked');
    expect(buildEchoObservation({ ...base, signal: device(3, 0, 'JAMMED') }).objectiveBlocked).toBe(true);
    // An ACTIVELY unperceived device never sets the objective flag either.
    expect(buildEchoObservation({ ...base, signal: device(40, 0) })).not.toHaveProperty('objectiveBlocked');
  });
  it('passes the ECHO account through untouched and never the player account', () => {
    const v = buildEchoObservation({
      ...base, signal: device(3, 0),
      energy: { current: 65, max: 100 }, cooldowns: { scanTicks: 3, jamTicks: 480 }
    });
    expect(v.energy).toEqual({ current: 65, max: 100 });
    expect(v.cooldowns).toEqual({ scanTicks: 3, jamTicks: 480 });
  });
  it('the crop attestation accepts the Signal fields and rejects hidden ones', () => {
    const good = buildEchoObservation({ ...base, signal: device(3, 0) });
    expect((good as unknown as { relay?: unknown }).relay).toBeTruthy();
    // A hand-forged observation that injects hidden sim state must be refused.
    const forged = { ...good, signal: { powered: false } } as Record<string, unknown>;
    
    expect(isEchoObservation(forged)).toBe(false);
  });
});
