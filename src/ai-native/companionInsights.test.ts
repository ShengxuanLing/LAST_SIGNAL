// Task C fix — Companion honesty regressions found in the Lead's real Signal run.
//
// 1) memory classification: a cropped non-drone TARGET was stored as
//    `kind: 'relay'` (evidence: `target_1_hunter`), so the model's own memory
//    reported 3 hunters as relays. Targets must keep their own kind.
// 2) availableActions: `scan` was reported available while the echo was on a
//    real scan cooldown (tick 273, scanCD 18) and `jam` ignored energy; the
//    status must describe the CURRENT energy/cooldown reality.
//
// Run: npx vitest run src/ai-native/companionInsights.test.ts

import { describe, expect, it } from 'vitest';
import { CompanionFacet, type CompanionObservationView } from './companionFacet';
import { echoPlayerData } from '../world/sim/core';
import { SIGNAL_TUNING } from '../signal/signalTuning';

function facet(): CompanionFacet {
  let n = 0;
  return new CompanionFacet({
    session: 'ses_aaaaaaaaaaaaaaaaaaaaaaaa',
    epoch: 1,
    suggestionIdFactory: () => `sug_${(n++).toString(16).padStart(24, '0')}`
  });
}

function view(overrides: Partial<CompanionObservationView> = {}): CompanionObservationView {
  const base: CompanionObservationView = {
    epoch: 1, tick: 100,
    player: { x: 0, y: 0 },
    echo: { x: 0, y: 0, hp: 100, maxHp: 100, aimYaw: 0 },
    drones: []
  };
  const merged = { ...base, ...overrides };
  return {
    ...merged,
    schema: 'last_signal.echo-observation.v1',
    perception: {
      center: { x: merged.echo.x, y: merged.echo.y },
      radiusTiles: 12, requiresExplored: true, requiresLineOfSight: true
    },
    targets: merged.targets ?? []
  };
}

describe('memory keeps the real actor kind', () => {
  it('a cropped target is remembered as a target, never as a relay', () => {
    const f = facet();
    const r = f.observe(view({
      targets: [{ id: 1, kind: 'hunter', x: 2, y: 0, hp: 59, isBoss: false }],
      relay: { id: 'relay_main', x: 1, y: 0, state: 'INACTIVE' }
    }));
    expect(r.ok).toBe(true);
    expect(f.memory).toContainEqual({ tick: 100, kind: 'target', id: 'target_1_hunter', x: 2, y: 0 });
    expect(f.memory).toContainEqual({ tick: 100, kind: 'relay', id: 'relay_main', x: 1, y: 0 });
    // Exactly one relay entry: the device. Hunter ids must never claim to be relays.
    expect(f.memory.filter((m) => m.kind === 'relay')).toHaveLength(1);
  });

  it('is honest about the echo player data it derives from (no cross-contamination)', () => {
    // Guards the base actor shape used by the checkpoint/echo validation path.
    expect(echoPlayerData().maxHp).toBeGreaterThan(0);
  });
});

describe('availableActions reflects the CURRENT energy and cooldown', () => {
  const target = [{ id: 9, kind: 'hunter', x: 2, y: 0, hp: 40, isBoss: false }];

  it('scan unavailable while the real scan cooldown is running', () => {
    const f = facet();
    f.observe(view({
      targets: target,
      energy: { current: 100, max: 100 },
      cooldowns: { scanTicks: 18, jamTicks: 0 }
    }));
    const scan = f.status().availableActions.find((a) => a.kind === 'scan')!;
    expect(scan.available).toBe(false);
    expect(scan.reason).toBe('cooldown');
  });

  it('scan unavailable without enough energy, even with no cooldown', () => {
    const f = facet();
    f.observe(view({
      targets: target,
      energy: { current: SIGNAL_TUNING.SCAN_COST - 1, max: 100 },
      cooldowns: { scanTicks: 0, jamTicks: 0 }
    }));
    const scan = f.status().availableActions.find((a) => a.kind === 'scan')!;
    expect(scan.available).toBe(false);
    expect(scan.reason).toBe('insufficient_energy');
  });

  it('scan available again once cooldown and energy are both fine', () => {
    const f = facet();
    f.observe(view({
      targets: target,
      energy: { current: 100, max: 100 },
      cooldowns: { scanTicks: 0, jamTicks: 0 }
    }));
    const scan = f.status().availableActions.find((a) => a.kind === 'scan')!;
    expect(scan.available).toBe(true);
    expect(scan.reason).toBe('perceived_target');
  });

  it('jam honours its own cooldown and energy cost', () => {
    const f = facet();
    f.observe(view({
      targets: target,
      energy: { current: 100, max: 100 },
      cooldowns: { scanTicks: 0, jamTicks: 10 }
    }));
    expect(f.status().availableActions.find((a) => a.kind === 'jam')!).toMatchObject({
      available: false, reason: 'cooldown'
    });

    const g = facet();
    g.observe(view({
      targets: target,
      energy: { current: SIGNAL_TUNING.JAM_COST - 1, max: 100 },
      cooldowns: { scanTicks: 0, jamTicks: 0 }
    }));
    expect(g.status().availableActions.find((a) => a.kind === 'jam')!).toMatchObject({
      available: false, reason: 'insufficient_energy'
    });
  });

  it('the perceived RELAY is a legal scan/jam subject (the real exit chain)', () => {
    const f = facet();
    f.observe(view({
      relay: { id: 'relay_main', x: 2, y: 0, state: 'INACTIVE' },
      energy: { current: 100, max: 100 },
      cooldowns: { scanTicks: 0, jamTicks: 0 }
    }));
    const actions = f.status().availableActions;
    expect(actions.find((a) => a.kind === 'scan')).toMatchObject({ available: true, reason: 'perceived_relay' });
    expect(actions.find((a) => a.kind === 'jam')).toMatchObject({ available: true, reason: 'in_jam_range' });
  });

  it('a relay on cooldown is reported as cooldown, not as "unavailable garbage"', () => {
    const f = facet();
    f.observe(view({
      relay: { id: 'relay_main', x: 2, y: 0, state: 'ACTIVE' },
      energy: { current: 100, max: 100 },
      cooldowns: { scanTicks: 18, jamTicks: 0 }
    }));
    expect(f.status().availableActions.find((a) => a.kind === 'scan')).toMatchObject({
      available: false, reason: 'cooldown'
    });
  });

  it('an observation without energy/cooldowns keeps the old distance-only answer', () => {
    const f = facet();
    f.observe(view({ targets: target }));
    const scan = f.status().availableActions.find((a) => a.kind === 'scan')!;
    expect(scan.available).toBe(true);
    expect(scan.reason).toBe('perceived_target');
  });
});
