// Reviewer-only P4 v2 negative probes (snapshot only; never copied into the repo).
import { describe, expect, it } from 'vitest';
import { buildP1Scenario, type P1BuildContext } from '../config/p1Scenario';
import { HeadlessWorld, generateRealMap, isHeadlessFrame } from '../ai-native/worldHeadless';
import { canonicalSimulationState, stepSimulationTicks, isWalkableFromState } from '../world/sim/core';

const idle = { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false } as any;
const SEEDS = [20261117, 20261118, 20261119];
const rows: any[] = [];

function mapBytes(map: any) {
  return JSON.stringify(map);
}

describe('P4 v2 negative probes', () => {
  it('F1: a failing layout leaves the map byte-identical (several failure modes)', () => {
    const cases: Array<[string, (ctx: P1BuildContext) => P1BuildContext]> = [
      ['no walkable cell in the authored room', (ctx) => ({ ...ctx, isWalkable: () => false })],
      ['only one cell (cannot host 2 sentries)', (ctx) => {
        const room = ctx.map.rooms.find((r) => r.kind === 'start') ?? ctx.map.rooms[0];
        const cx = room.gx + Math.floor(room.w / 2), cy = room.gy + Math.floor(room.h / 2);
        return { ...ctx, isWalkable: (x, y) => Math.abs(x - (cx + 0.5)) < 1.5 && Math.abs(y - (cy + 0.5)) < 1.5 };
      }],
      ['a tiny strip room (portals would collapse)', (ctx) => {
        const room = ctx.map.rooms.find((r) => r.kind === 'start') ?? ctx.map.rooms[0];
        return { ...ctx, isWalkable: (x, y) => x >= room.gx && x < room.gx + 2 && y >= room.gy && y < room.gy + 4 };
      }]
    ];
    for (const [name, mutate] of cases) {
      const map = generateRealMap(SEEDS[0]);
      const before = mapBytes(map);
      const ctx = mutate({ map, isWalkable: () => true });
      const scenario = buildP1Scenario(ctx);
      const after = mapBytes(map);
      rows.push({ f1: { name, scenario: scenario === null ? 'null' : 'built', unchanged: before === after } });
      expect(scenario, `${name}: builder fails visibly`).toBeNull();
      expect(after, `${name}: map bytes unchanged on failure`).toBe(before);
    }
  });

  it('F1: on success the map is mutated exactly once (two edges + kind)', () => {
    const map = generateRealMap(SEEDS[0]);
    const room = map.rooms.find((r) => r.kind === 'start') ?? map.rooms[0];
    const edgesBefore = [...room.connectedTo];
    const probeWorld: any = new HeadlessWorld({ seed: SEEDS[0] });
    const scenario = buildP1Scenario({
      map,
      isWalkable: (x, y, radius) => isWalkableFromState((probeWorld as any).sim, x, y, radius)
    });
    rows.push({ f1ok: { built: !!scenario, kind: room.kind, added: room.connectedTo.length - edgesBefore.length } });
    expect(scenario, 'a real generated map hosts the authored layout').not.toBeNull();
    expect(room.kind, 'authored room becomes combat').toBe('combat');
    expect(room.connectedTo.length, 'exactly the two route edges were added (or were already there)').toBeLessThanOrEqual(edgesBefore.length + 2);
    // idempotent on a second call with the same map
    const again = buildP1Scenario({ map, isWalkable: (x, y, radius) => isWalkableFromState((probeWorld as any).sim, x, y, radius) });
    rows.push({ f1idem: { built: !!again, edges: room.connectedTo.length, sameRoutes: JSON.stringify(again?.routes) === JSON.stringify(scenario?.routes) } });
    expect(JSON.stringify(again?.routes), 'rebuilding on the same map is stable').toBe(JSON.stringify(scenario?.routes));
  });

  it('F2: malformed authored scenes are all rejected (fail closed)', () => {
    const w = new HeadlessWorld({ seed: SEEDS[0], demo: true });
    stepSimulationTicks((w as any).sim, 3, idle); // relay committed -> routes.find is really exercised
    const good: any = JSON.parse(JSON.stringify(w.snapshot()));
    const roomIds = good.sim.map.rooms.map((r: any) => r.id);
    const bad: Array<[string, (f: any) => any]> = [
      ['routes not an array', (f) => { f.sim.authored.routes = { evil: true }; return f; }],
      ['routes empty', (f) => { f.sim.authored.routes = []; return f; }],
      ['routes length 3', (f) => { f.sim.authored.routes = [f.sim.authored.routes[0], f.sim.authored.routes[1], f.sim.authored.routes[0]]; return f; }],
      ['route null entry', (f) => { f.sim.authored.routes[1] = null; return f; }],
      ['target not in map', (f) => { f.sim.authored.routes[0].target = 9999; return f; }],
      ['target not a number', (f) => { f.sim.authored.routes[0].target = '1'; return f; }],
      ['when enum invalid', (f) => { f.sim.authored.routes[0].when = 'RELAY_MAYBE'; return f; }],
      ['portal NaN', (f) => { f.sim.authored.routes[0].portal = { x: NaN, y: 1 }; return f; }],
      ['portal Infinity', (f) => { f.sim.authored.routes[0].portal = { x: 1, y: Infinity }; return f; }],
      ['portal not numeric', (f) => { f.sim.authored.routes[0].portal = { x: '1', y: 1 }; return f; }],
      ['portal array', (f) => { f.sim.authored.routes[0].portal = [1, 2]; return f; }],
      ['label not a string', (f) => { f.sim.authored.routes[0].label = 42; return f; }],
      ['roomId not in map', (f) => { f.sim.authored.roomId = 4242; return f; }],
      ['startRoomId not in map', (f) => { f.sim.authored.startRoomId = -1; return f; }],
      ['id not p1', (f) => { f.sim.authored.id = 'p2'; return f; }],
      ['authored null', (f) => { f.sim.authored = null; return f; }],
      ['authored is a string', (f) => { f.sim.authored = 'p1'; return f; }]
    ];
    for (const [name, corrupt] of bad) {
      const frame = corrupt(JSON.parse(JSON.stringify(good)));
      const accepted = isHeadlessFrame(frame);
      rows.push({ f2bad: { name, accepted } });
      expect(accepted, `${name}: rejected`).toBe(false);
    }
    // legacy frames (no authored key) stay compatible
    const legacy: any = JSON.parse(JSON.stringify(good));
    delete legacy.sim.authored;
    rows.push({ f2legacy: { accepted: isHeadlessFrame(legacy) } });
    expect(isHeadlessFrame(legacy), 'legacy frame without authored stays accepted').toBe(true);
    // a structurally valid but unusual scene must not crash routeState
    const odd: any = JSON.parse(JSON.stringify(good));
    odd.sim.authored.routes = [{ target: roomIds[1] ?? roomIds[0], when: 'RELAY_ACTIVE' }]; // 1 route, no portal
    let threw: string | null = null;
    let value: any = null;
    try {
      const ww = HeadlessWorld.fromFrame(odd, false);
      value = ww.routeState;
    } catch (e) { threw = (e as Error).message; }
    rows.push({ f2odd: { accepted: isHeadlessFrame(odd), threw, target: value?.target ?? null, portal: value?.portal ?? null } });
    expect(isHeadlessFrame(odd), 'single-route scene without portal is accepted').toBe(true);
    expect(threw, 'routeState does not throw on the accepted shape').toBeNull();

    // three more structurally valid but weird scenes: none may throw
    const weird: Array<[string, (f: any) => any]> = [
      ['portal far outside the map', (f) => { f.sim.authored.routes[0].portal = { x: 1e6, y: -1e6 }; return f; }],
      ['route target points at the authored room itself', (f) => { f.sim.authored.routes[0].target = f.sim.authored.roomId; return f; }],
      ['startRoomId differs from roomId', (f) => { f.sim.authored.startRoomId = roomIds[roomIds.length - 1]; return f; }]
    ];
    const weirdOut: any[] = [];
    for (const [name, mutate] of weird) {
      const f = mutate(JSON.parse(JSON.stringify(good)));
      let t: string | null = null;
      let ok: any = null;
      try { const ww = HeadlessWorld.fromFrame(f, false); ok = ww.routeState; } catch (e) { t = (e as Error).message; }
      weirdOut.push({ name, accepted: isHeadlessFrame(f), threw: t, target: ok?.target ?? null, portal: ok?.portal ?? null });
      expect(isHeadlessFrame(f), name + ': accepted').toBe(true);
      expect(t, name + ': routeState does not throw').toBeNull();
    }
    rows.push({ f2weird: weirdOut });
  });

  it('F2: a rejected frame does not touch the live world', () => {
    const w = new HeadlessWorld({ seed: SEEDS[1], demo: true });
    stepSimulationTicks((w as any).sim, 3, idle);
    const before = canonicalSimulationState((w as any).sim);
    const frame: any = JSON.parse(JSON.stringify(w.snapshot()));
    frame.sim.authored.routes = { evil: true };
    const res: any = w.restore(frame);
    const after = canonicalSimulationState((w as any).sim);
    rows.push({ f2live: { ok: res.ok, code: res.code, unchanged: before === after } });
    expect(res.ok, 'restore rejects the bad frame').toBe(false);
    expect(res.code).toBe('E_SNAPSHOT_INVALID');
    expect(after, 'the live world is byte-identical after a rejected frame').toBe(before);
    expect(w.routeState, 'the live world still has its own route state').not.toBeNull();
  });

  it('P2 queue / busy guard do not regress through the Owner restore path', () => {
    const w = new HeadlessWorld({ seed: SEEDS[2], demo: true });
    w.enableEcho();
    w.runSteps([{ ticks: 2, intent: idle }]);
    const p = w.proposeLocalEcho();
    expect(p).not.toBeNull();
    expect(w.confirmLocalEchoProposal(p!.id, true)).toBe(true);
    const queued = (w as any).sim.pendingCommands.map((c: any) => c.type);
    const guard = JSON.parse(JSON.stringify(w.echoPendingLocal));
    const frame: any = JSON.parse(JSON.stringify(w.snapshot()));
    const accepted = isHeadlessFrame(frame);

    // Owner path: instance restore()
    const target = new HeadlessWorld({ seed: SEEDS[2], demo: true });
    const res: any = target.restore(frame);
    const restoredQueue = (target as any).sim.pendingCommands.map((c: any) => c.type);
    const restoredGuard = JSON.parse(JSON.stringify(target.echoPendingLocal));
    let fromFrameThrew: string | null = null;
    try { HeadlessWorld.fromFrame(frame, false).echoPendingLocal; } catch (e) { fromFrameThrew = (e as Error).message; }
    rows.push({
      p2: {
        accepted, queued, restoredQueue,
        guard, restoredGuard,
        restoredReconfirmRefused: target.confirmLocalEchoProposal(p!.id, true) === false,
        fromFrameThrew,
        sameRoute: JSON.stringify(target.routeState) === JSON.stringify(w.routeState)
      }
    });
    expect(accepted, 'the v2 validator accepts a real demo frame').toBe(true);
    expect((res as any).ok, 'restore accepts the real frame').toBe(true);
    expect(restoredQueue, 'queue preserved exactly through the Owner restore').toEqual(queued);
    expect(restoredGuard, 'guard state preserved through the Owner restore').toEqual(guard);
    expect(target.confirmLocalEchoProposal(p!.id, true), 'the saved id is not re-executable after restore').toBe(false);
    expect(JSON.stringify(target.routeState), 'route identity survives the Owner restore').toBe(JSON.stringify(w.routeState));
  });

  it('frame restore + continue: can a second confirm duplicate the queued command?', () => {
    const w = new HeadlessWorld({ seed: SEEDS[2], demo: true });
    w.enableEcho();
    w.runSteps([{ ticks: 2, intent: idle }]);
    const p = w.proposeLocalEcho();
    expect(p).not.toBeNull();
    expect(w.confirmLocalEchoProposal(p!.id, true)).toBe(true);
    const frame: any = JSON.parse(JSON.stringify(w.snapshot()));
    const target = new HeadlessWorld({ seed: SEEDS[2], demo: true });
    (target as any).restore(frame);
    const q0 = (target as any).sim.pendingCommands.map((c: any) => c.type);
    const guard0 = target.echoPendingLocal;
    // continue real play on the restored world
    target.runSteps([{ ticks: 1, intent: idle }]);
    const q1 = (target as any).sim.pendingCommands.map((c: any) => c.type);
    const p2 = target.proposeLocalEcho();
    const ok2 = p2 ? target.confirmLocalEchoProposal(p2.id, true) : false;
    const q2 = (target as any).sim.pendingCommands.map((c: any) => c.type);
    // and the raw-sim path for comparison (P2 v3 guard)
    const raw = HeadlessWorld.fromSimulationState(w.state, [w.demoScenario!.roomId]);
    const rawP = raw.proposeLocalEcho();
    const rawQ = (raw as any).sim.pendingCommands.map((c: any) => c.type);
    rows.push({ frameContinue: {
      q0, guardAfterRestore: guard0, afterTick: q1,
      newProposal: p2 ? p2.kind : null, secondConfirm: ok2, finalQueue: q2,
      rawPath: { guard: raw.echoPendingLocal, newProposal: rawP ? rawP.kind : null, queue: rawQ }
    } });
    expect(true).toBe(true);
  });

  it('frame restore: is the guard-loss window reachable before the queued command commits?', () => {
    const w = new HeadlessWorld({ seed: SEEDS[2], demo: true });
    w.enableEcho();
    w.runSteps([{ ticks: 2, intent: idle }]);
    const p = w.proposeLocalEcho();
    expect(w.confirmLocalEchoProposal(p!.id, true)).toBe(true);
    const frame: any = JSON.parse(JSON.stringify(w.snapshot()));
    const target = new HeadlessWorld({ seed: SEEDS[2], demo: true });
    (target as any).restore(frame);
    const immediate = target.proposeLocalEcho();
    const okImmediate = immediate ? target.confirmLocalEchoProposal(immediate.id, true) : false;
    const qImmediate = (target as any).sim.pendingCommands.map((c: any) => c.type);
    rows.push({ window: { guard: target.echoPendingLocal, immediateProposal: immediate ? immediate.kind : null, immediateConfirm: okImmediate, queueAfterImmediateConfirm: qImmediate } });
    expect(true).toBe(true);
  });

  it('log rows', () => { console.log('P4V2_PROBE ' + JSON.stringify(rows)); });
});
