// REVIEWER PROBE (not part of the frozen commit) — mechanism proof for the
// cross-room stale suggestion gap on 246469b: after a NEW observation that no
// longer perceives the relay (i.e. the echo moved to another room), the gateway
// still accepts an Owner confirm of the OLD proposal and reports it decided.
// This is the Node-level twin of the tester's browser probe X07.
import { describe, expect, it } from 'vitest';
import { WorldGateway } from '../ai-native/worldGateway';
import { CompanionGateway } from '../ai-native/companionGateway';
import { companionAvailableActions } from '../ai-native/companionFacet';

const ORIGIN = 'http://localhost:5399';

function setup() {
  const gateway = new WorldGateway();
  const linked = gateway.linkSession({ authorized: true, origin: ORIGIN, nowMs: 1000 });
  if (!linked.ok) throw new Error('link failed');
  const companion = new CompanionGateway(gateway);
  companion.authorize(linked.session, linked.epoch, 'human');
  return { companion, session: linked.session, epoch: linked.epoch };
}

function observation(overrides: Record<string, unknown> = {}) {
  const base: Record<string, any> = {
    epoch: 1, tick: 100,
    player: { x: 25, y: 46 },
    echo: { x: 26, y: 46, hp: 100, maxHp: 100, aimYaw: 0 },
    drones: [],
    targets: [],
    relay: { id: 'relay_main', x: 25, y: 46, state: 'INACTIVE' },
    objectiveBlocked: true,
    energy: { current: 100, max: 100 },
    cooldowns: { scanTicks: 0, jamTicks: 0 },
    ...overrides
  };
  return {
    ...base,
    schema: 'last_signal.echo-observation.v1',
    perception: {
      center: { x: base.echo.x, y: base.echo.y },
      radiusTiles: 12, requiresExplored: true, requiresLineOfSight: true
    }
  };
}

describe('cross-room stale suggestion (reviewer probe)', () => {
  it('gateway confirms an OLD proposal after a NEW observation no longer perceives it', () => {
    const { companion, session, epoch } = setup();
    const A = companion.pushObservation(session, epoch, observation());
    expect(A.ok).toBe(true);

    const sug = companion.suggest({
      session, epoch,
      requestId: 'req_' + 'a'.repeat(24),
      suggestionId: 'sug_' + 'b'.repeat(24),
      kind: 'scan',
      reason: 'perceived_relay',
      ttlTicks: 600
    });
    expect(sug.ok, JSON.stringify(sug)).toBe(true);

    // The real room transition: echo now stands in the NEXT room, so the relay
    // is out of perception and no longer part of the observation at all.
    const B = companion.pushObservation(session, epoch, observation({
      tick: 140,
      echo: { x: 27.2, y: 43.7, hp: 100, maxHp: 100, aimYaw: 0 },
      player: { x: 115, y: 44 },
      relay: undefined,
      objectiveBlocked: undefined
    }));
    expect(B.ok, JSON.stringify(B)).toBe(true);
    if (B.ok) {
      expect((B.value as any).relay, 'the new observation really has no relay').toBeNull();
      expect(companionAvailableActions(B.value as any).find((a) => a.kind === 'scan')?.reason)
        .toBe('out_of_range');
    }

    // The stale proposal is STILL pending ...
    const pending = companion.pending(session, epoch);
    const pendingIds = (pending.ok ? pending.value : []).map((p) => p.suggestionId);
    expect(pendingIds).toContain('sug_' + 'b'.repeat(24));

    // ... and an Owner CONFIRM of it is still accepted (no re-grounding).
    const decided = companion.decide({
      session, epoch, suggestionId: 'sug_' + 'b'.repeat(24),
      decision: 'confirm', tick: 140
    });
    expect(decided.ok, `stale confirm result: ${JSON.stringify(decided)}`).toBe(true);
    if (decided.ok) {
      expect(decided.value.decidedAtTick).toBe(140);
      expect(decided.value.applied).toBe(false);
    }
  });
});
