import { describe, expect, it } from 'vitest';
import { routeMatches, relayOutput, exitOpen, type RelayState } from './relay';

// GAMEPLAY-01 P1 — the authored route condition is exact:
// ACTIVE matches RELAY_ACTIVE, INACTIVE matches RELAY_INACTIVE, and JAMMED /
// DISABLED match NEITHER (temporary suppression is not a manual state).
describe('authored relay route condition', () => {
  it('ACTIVE selects only the ACTIVE route', () => {
    expect(routeMatches('ACTIVE', 'RELAY_ACTIVE')).toBe(true);
    expect(routeMatches('ACTIVE', 'RELAY_INACTIVE')).toBe(false);
  });
  it('INACTIVE selects only the INACTIVE route', () => {
    expect(routeMatches('INACTIVE', 'RELAY_ACTIVE')).toBe(false);
    expect(routeMatches('INACTIVE', 'RELAY_INACTIVE')).toBe(true);
  });
  it('JAMMED matches neither route', () => {
    expect(routeMatches('JAMMED', 'RELAY_ACTIVE')).toBe(false);
    expect(routeMatches('JAMMED', 'RELAY_INACTIVE')).toBe(false);
  });
  it('DISABLED matches neither route', () => {
    expect(routeMatches('DISABLED', 'RELAY_ACTIVE')).toBe(false);
    expect(routeMatches('DISABLED', 'RELAY_INACTIVE')).toBe(false);
  });
  it('the legacy output/exit gate is unchanged', () => {
    const states: RelayState[] = ['ACTIVE', 'INACTIVE', 'JAMMED', 'DISABLED'];
    for (const state of states) {
      expect(relayOutput(state)).toBe(state === 'ACTIVE');
      expect(exitOpen(state)).toBe(state === 'ACTIVE');
    }
  });
});
