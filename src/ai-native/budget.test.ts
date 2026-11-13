/**
 * AI-NATIVE-01 P5 final — shared per-process session budget.
 *
 * Ordinary Player/Dev sessions and isolated coop worlds compete for the SAME
 * budget object, so one process can never hold more than the total cap.
 */
import { describe, expect, it } from 'vitest';
import { createSessionManager, createProcessSessionBudget } from './sessions';
import { CoopManager } from './coop';

const FIXTURE = { test: true as const, human: { x: 6.5, y: 5.5 }, echo: { x: 6.5, y: 3.5 } };

describe('shared per-process session budget', () => {
  it('5 ordinary sessions + 5 coop worlds are allowed; the 11th of either kind is rejected', () => {
    const budget = createProcessSessionBudget(10);
    const manager = createSessionManager({ maxSessions: 10, budget });
    const coop = new CoopManager(10, budget);
    const sessions: string[] = [];
    for (let i = 0; i < 5; i += 1) sessions.push(manager.createTestSession({ seed: i }).sessionId);
    const coops: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const res = coop.create({ seed: 100 + i, fixture: FIXTURE });
      expect(res.ok).toBe(true);
      if (res.ok) coops.push(res.value.handle);
    }
    expect(budget.used).toBe(10);
    expect(() => manager.createTestSession({ seed: 9 })).toThrow();
    expect(coop.create({ seed: 199, fixture: FIXTURE }).ok).toBe(false);
    expect(budget.used).toBe(10);
    manager.dispose();
    coop.dispose();
  });

  it('closing either kind releases a slot so a new session can be created', () => {
    const budget = createProcessSessionBudget(10);
    const manager = createSessionManager({ maxSessions: 10, budget });
    const coop = new CoopManager(10, budget);
    for (let i = 0; i < 10; i += 1) manager.createTestSession({ seed: i });
    expect(budget.used).toBe(10);
    // close one via the manager's own path
    const first = [...(manager as unknown as { sessions: Map<string, unknown> }).sessions.keys()][0];
    manager.remove(first);
    expect(budget.used).toBe(9);
    expect(() => manager.createTestSession({ seed: 42 })).not.toThrow();
    expect(budget.used).toBe(10);
    coop.dispose();
    manager.dispose();
  });

  it('a coop close releases its slot too', () => {
    const budget = createProcessSessionBudget(2);
    const coop = new CoopManager(2, budget);
    const a = coop.create({ seed: 1, fixture: FIXTURE });
    const b = coop.create({ seed: 2, fixture: FIXTURE });
    expect(a.ok && b.ok).toBe(true);
    expect(budget.used).toBe(2);
    expect(coop.create({ seed: 3, fixture: FIXTURE }).ok).toBe(false);
    if (a.ok) {
      expect(coop.close(a.value.handle)).toBe(true);
      expect(budget.used).toBe(1);
    }
    expect(coop.create({ seed: 4, fixture: FIXTURE }).ok).toBe(true);
    coop.dispose();
  });

  it('a rejected creation does not consume budget', () => {
    const budget = createProcessSessionBudget(4);
    const manager = createSessionManager({ maxSessions: 4, budget });
    expect(() => manager.createTestSession({ seed: -1 })).toThrow(); // schema error
    expect(budget.used).toBe(0);
    expect(() => manager.createTestSession({ seed: 1 })).not.toThrow();
    expect(budget.used).toBe(1);
    manager.dispose();
  });

  it('each manager keeps its own default budget when none is injected', () => {
    const a = createSessionManager({ maxSessions: 10 });
    const b = createSessionManager({ maxSessions: 10 });
    a.createTestSession({ seed: 1 });
    a.createTestSession({ seed: 2 });
    expect(a.size).toBe(2);
    expect(b.size).toBe(0);
    expect(() => b.createTestSession({ seed: 1 })).not.toThrow();
    a.dispose();
    b.dispose();
  });
});
