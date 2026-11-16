// C3-c — P4 harness tests: deterministic combat regression, baseline policy
// comparison, REAL perf (no empty scenes) and explicit Signal unsupported.

import { describe, expect, it } from 'vitest';
import {
  combatPerf, combatRegression, compareBaselinePolicies, runCombat, signalCombatStatus
} from './worldHeadlessHarness';

describe('C3-c harness — deterministic combat regression', () => {
  it('runs a REAL encounter and is reproducible for a fixed seed', () => {
    const a = runCombat(424242, 'seek-and-fire', 600);
    const b = runCombat(424242, 'seek-and-fire', 600);
    expect(a.ticks).toBeGreaterThan(0);
    expect(a.shots).toBeGreaterThan(0);
    expect(a.status).not.toBe('running');
    expect(a.canonicalStateHash).toBe(b.canonicalStateHash);
    expect(a.eventCount).toBe(b.eventCount);
  });

  it('batch regression aggregates real per-seed outcomes', () => {
    const result = combatRegression([424242, 777], 600);
    expect(result.scenario).toBe('fixed-combat-regression');
    expect(result.runs).toHaveLength(2);
    expect(result.aggregate.runs).toBe(2);
    expect(result.aggregate.totalShots).toBeGreaterThan(0);
    expect(result.aggregate.totalKills).toBeGreaterThan(0);
    expect(result.aggregate.deaths + result.aggregate.cleared).toBe(2);
  });

  it('baseline comparison is explicitly NOT an AI agent / NOT Signal Combat', () => {
    const result = compareBaselinePolicies([424242, 777], 600);
    expect(result.note).toContain('NOT an AI agent');
    expect(result.results.map((r) => r.policy)).toEqual(['hold', 'seek-and-fire']);
    const hold = result.results.find((r) => r.policy === 'hold')!;
    const fight = result.results.find((r) => r.policy === 'seek-and-fire')!;
    expect(hold.totalShots).toBe(0);
    expect(fight.totalShots).toBeGreaterThan(0);
    expect(fight.totalTicks).toBeLessThan(hold.totalTicks + 1);
  });
});

describe('C3-c harness — REAL perf', () => {
  it('runs 1000 ticks x 10 sessions of real combat (no empty scene)', () => {
    const sample = combatPerf(1000, 10);
    expect(sample.sessions).toBe(10);
    expect(sample.runs).toHaveLength(10);
    expect(sample.runs.reduce((n, r) => n + r.ticks, 0)).toBe(10_000);
    expect(sample.liveCombatTicks, 'most ticks had a live enemy').toBeGreaterThan(5_000);
    expect(sample.totalEvents).toBeGreaterThan(0);
    expect(sample.wallMs).toBeGreaterThan(0);
    expect(sample.cpuUserMs).toBeGreaterThan(0);
    expect(Number.isFinite(sample.heapUsedTotalBytes)).toBe(true);
  }, 120_000);
});

describe('C3-c / P3-b harness — Signal', () => {
  it('without a device Signal is explicitly unsupported (never faked)', () => {
    const status = signalCombatStatus();
    expect(status.supported).toBe(false);
    expect(status.code).toBe('E_NOT_APPLICABLE');
    expect(status.messageKey).toContain('signal');
  });

  it('with a real device it is supported and the batch drives REAL core state', async () => {
    const { signalCombatBatch } = await import('./worldHeadlessHarness');
    const result = signalCombatBatch([424242, 1337, 7]);
    expect(result.runs).toHaveLength(3);
    for (const [name, ok] of Object.entries(result.checks)) {
      expect(ok, name).toBe(true);
    }
    expect(signalCombatStatus(result.runs[0] as never).supported).toBe(true);
  });
});
