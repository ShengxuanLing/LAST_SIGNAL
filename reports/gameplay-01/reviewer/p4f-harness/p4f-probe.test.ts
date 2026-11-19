// Reviewer-only P4 final probe (snapshot only — never copied into the repo).
import { describe, expect, it } from 'vitest';
import { HeadlessWorld, generateRealMap } from '../ai-native/worldHeadless';
import { buildP1Scenario } from '../config/p1Scenario';
import { isHeadlessFrame } from '../ai-native/worldHeadless';
import { canonicalSimulationState, stepSimulationTicks, enqueueCommand } from '../world/sim/core';

const idle = { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false } as any;
const SEEDS = [20261117, 20261118, 20261119];
const rows: any[] = [];

describe('P4 final probe', () => {
  it('core commits the authored room clear exactly once, and only for authored scenes', () => {
    for (const seed of SEEDS) {
      const w = new HeadlessWorld({ seed, demo: true });
      const authored = w.demoScenario!;
      expect(authored, 'authored identity lives in the core state').not.toBeNull();
      const roomId = authored.roomId;
      stepSimulationTicks((w as any).sim, 3, idle);
      const beforeKill = (w as any).sim.map.rooms[roomId].cleared;
      // fixture kill of the authored sentries (unit-level gate probe, not a play claim)
      for (const d of (w as any).sim.drones) if (d.data.spawnRoom === roomId) d.hp = 0;
      const ev1 = stepSimulationTicks((w as any).sim, 1, idle);
      const clearEvents1 = ev1.filter((e: any) => e.type === 'room-cleared').length;
      const cleared = (w as any).sim.map.rooms[roomId].cleared;
      const ev2 = stepSimulationTicks((w as any).sim, 60, idle);
      const clearEvents2 = ev2.filter((e: any) => e.type === 'room-cleared').length;
      rows.push({ seed, beforeKill, clearEvents1, cleared, clearEvents2, routeCleared: w.routeState!.roomCleared });
      expect(beforeKill, 'not cleared while the sentries live').toBe(false);
      expect(clearEvents1, 'exactly one room-cleared event on the commit tick').toBe(1);
      expect(cleared, 'the core wrote the authoritative map flag').toBe(true);
      expect(clearEvents2, 'no second commit on later ticks').toBe(0);
      expect(w.routeState!.roomCleared, 'headless reads the same flag').toBe(true);
    }
  });

  it('reachable clear guards: unspawned room, live drone, live target inside the room', () => {
    // (a) not spawned -> no clear
    const a = new HeadlessWorld({ seed: SEEDS[0], demo: true });
    const sa: any = (a as any).sim;
    const roomId = a.demoScenario!.roomId;
    for (const d of sa.drones) if (d.data.spawnRoom === roomId) d.hp = 0;
    sa.map.rooms[roomId].spawned = false;
    const evA = stepSimulationTicks(sa, 1, idle);
    // (b) live drone -> no clear
    const b = new HeadlessWorld({ seed: SEEDS[0], demo: true });
    const sb: any = (b as any).sim;
    const evB = stepSimulationTicks(sb, 3, idle);
    // (c) live target inside the room bounds -> no clear
    const c = new HeadlessWorld({ seed: SEEDS[0], demo: true });
    const sc: any = (c as any).sim;
    for (const d of sc.drones) if (d.data.spawnRoom === roomId) d.hp = 0;
    const room = sc.map.rooms[roomId];
    sc.targets.push({ id: 999, kind: 'drone', x: room.gx + 1.5, y: room.gy + 1.5, hp: 5, maxHp: 5, armor: 0, radius: 0.5, isBoss: false, xpValue: 1, currencyValue: 1 });
    const evC = stepSimulationTicks(sc, 1, idle);
    rows.push({
      guards: {
        unspawned: { cleared: sa.map.rooms[roomId].cleared, events: evA.filter((e: any) => e.type === 'room-cleared').length },
        liveDrone: { cleared: sb.map.rooms[roomId].cleared, events: evB.filter((e: any) => e.type === 'room-cleared').length },
        liveTarget: { cleared: sc.map.rooms[roomId].cleared, events: evC.filter((e: any) => e.type === 'room-cleared').length }
      }
    });
    expect(sa.map.rooms[roomId].cleared, 'unspawned authored room never clears').toBe(false);
    expect(sb.map.rooms[roomId].cleared, 'live sentry blocks the clear').toBe(false);
    expect(sc.map.rooms[roomId].cleared, 'a live target inside the room blocks the clear').toBe(false);
  });

  it('ordinary (non-demo) runs are unchanged: no authored state, no new event, same canonical shape', () => {
    const plain = new HeadlessWorld({ seed: 12345 });
    const sim: any = (plain as any).sim;
    expect(sim.authored, 'no authored identity on an ordinary run').toBeUndefined();
    expect(plain.routeState, 'routeState is null without an authored scene').toBeNull();
    const canonical = canonicalSimulationState(sim);
    expect(canonical.includes('"authored"'), 'canonical state has no authored key for legacy runs').toBe(false);
    for (const d of sim.drones) d.hp = 0;
    const ev = stepSimulationTicks(sim, 5, idle);
    rows.push({ plain: { authored: !!sim.authored, clearEvents: ev.filter((e: any) => e.type === 'room-cleared').length } });
    expect(ev.filter((e: any) => e.type === 'room-cleared').length, 'legacy runs never emit room-cleared').toBe(0);
  });

  it('authored identity + route survive snapshot/restore/fromFrame/fromSimulationState', () => {
    const w = new HeadlessWorld({ seed: SEEDS[1], demo: true });
    const sim: any = (w as any).sim;
    for (const d of sim.drones) if (d.data.spawnRoom === w.demoScenario!.roomId) d.hp = 0;
    stepSimulationTicks(sim, 2, idle);
    const live = w.routeState!;
    const frame = w.snapshot();
    const restored = new HeadlessWorld({ seed: SEEDS[1], demo: true });
    const r = restored.restore(frame);
    const fromState = HeadlessWorld.fromSimulationState(w.state, [w.demoScenario!.roomId]);
    const fromFrame = HeadlessWorld.fromFrame(frame, false);
    const shapes = {
      restored: restored.routeState, fromState: fromState.routeState, fromFrame: fromFrame.routeState
    };
    rows.push({
      survival: {
        live, restored: shapes.restored, fromState: shapes.fromState, fromFrame: shapes.fromFrame,
        liveStartRoomId: w.identity.startRoomId,
        fromStateStartRoomId: fromState.identity.startRoomId,
        fromFrameStartRoomId: fromFrame.identity.startRoomId
      }
    });
    expect((r as any).ok).toBe(true);
    for (const [name, rs] of Object.entries(shapes)) {
      expect(rs, `${name}: routeState survives`).not.toBeNull();
      expect(rs!.roomCleared, `${name}: the committed clear survives`).toBe(true);
      expect(rs!.portal, `${name}: the authored portal survives`).toEqual(live.portal);
      expect(rs!.target, `${name}: the route target matches the live run`).toBe(live.target);
    }
    expect(fromState.identity.startRoomId, 'fromSimulationState reports the pre-mutation start room').toBe(w.identity.startRoomId);
    expect(fromFrame.identity.startRoomId, 'fromFrame reports the pre-mutation start room').toBe(w.identity.startRoomId);
    expect(w.identity.startRoomId, 'fresh demo start room id is the authored room').toBe(w.demoScenario!.startRoomId);
  });

  it('P2 exact queue + unknown restored guard do not regress with the demo', () => {
    const w = new HeadlessWorld({ seed: SEEDS[2], demo: true });
    const roomId = w.demoScenario!.roomId;
    w.enableEcho();
    w.runSteps([{ ticks: 2, intent: idle }]);
    const proposal = w.proposeLocalEcho();
    rows.push({ proposal: proposal ? { kind: proposal.kind } : null });
    expect(proposal, 'a local proposal exists on the demo world').not.toBeNull();
    expect(w.confirmLocalEchoProposal(proposal!.id, true), 'human confirm accepted').toBe(true);
    const queued = (w as any).sim.pendingCommands.map((c: any) => c.type);
    const restored = HeadlessWorld.fromSimulationState(w.state, [roomId]);
    const busy: any = restored.echoPendingLocal;
    rows.push({ queueGuard: { queued, restoredQueue: (restored as any).sim.pendingCommands.map((c: any) => c.type), busy } });
    expect(queued.length, 'exactly one queued command').toBe(1);
    expect((restored as any).sim.pendingCommands.map((c: any) => c.type), 'queue preserved exactly').toEqual(queued);
    expect(busy, 'restored guard is conservative (unknown provenance)').toMatchObject({ restored: true, proposalId: null });
    expect(restored.confirmLocalEchoProposal(proposal!.id, true), 'the saved id is not re-executable').toBe(false);
    expect(restored.confirmLocalEchoProposal('local_other', true), 'an arbitrary id is refused').toBe(false);
    expect(restored.proposeLocalEcho(), 'no new proposal while busy').toBeNull();
  });

  it('a foreign frame cannot inject an authored scene that leaks into route state', () => {
    const w = new HeadlessWorld({ seed: SEEDS[0], demo: true });
    stepSimulationTicks((w as any).sim, 3, idle); // relay committed -> routeTargetFor will touch routes
    const frame: any = JSON.parse(JSON.stringify(w.snapshot()));
    // corrupt / foreign authored data: routes is not an array
    frame.sim.authored = { id: 'p1', roomId: 0, startRoomId: 0, routes: { evil: true } };
    const accepted = isHeadlessFrame(frame);
    let routeThrew: string | null = null;
    let routeValue: any = null;
    try {
      const restored = HeadlessWorld.fromFrame(frame, false);
      routeValue = restored.routeState;
    } catch (e) {
      routeThrew = (e as Error).message;
    }
    rows.push({ foreignFrame: { accepted, routeThrew, routeValue: routeValue === undefined ? 'undefined' : (routeValue === null ? null : 'object') } });
    // record only: the reviewer reports whatever the product really does
    expect(accepted).toBe(true);
  });

  it('replay of a demo frame keeps the authored identity; Player observation never carries it', () => {
    const w = new HeadlessWorld({ seed: SEEDS[0], demo: true });
    const steps = [{ ticks: 2, intent: idle }];
    const frame = w.snapshot();
    w.runSteps(steps);
    const rp = w.replay(frame, steps);
    const obs = w.observation();
    const obsJson = JSON.stringify(obs);
    rows.push({
      replay: { ok: rp.ok, sameState: rp.sameState, sameEvents: rp.sameEvents, authoredInFrame: !!(frame as any).sim.authored },
      observation: { hasAuthored: obsJson.includes('authored'), hasPortalRoute: obsJson.includes('"routes"') }
    });
    expect(rp.ok, 'replay of a demo frame is deterministic and accepted').toBe(true);
    expect(rp.sameState, 'replayed canonical state matches').toBe(true);
    expect(obsJson.includes('"authored"'), 'the player-facing observation carries no authored identity').toBe(false);
  });

  it('a layout null failure must not leave a half-mutated map', () => {
    const map = generateRealMap(SEEDS[0]);
    const room = map.rooms.find((r) => r.kind === 'start') ?? map.rooms[0];
    const before = {
      kind: room.kind,
      connectedTo: [...room.connectedTo]
    };
    // isWalkable that only accepts the room's centre cell -> cannot host 2 sentries
    const cx = room.gx + Math.floor(room.w / 2), cy = room.gy + Math.floor(room.h / 2);
    const scenario = buildP1Scenario({
      map,
      isWalkable: (x, y) => Math.abs(x - (cx + 0.5)) < 1.5 && Math.abs(y - (cy + 0.5)) < 1.5
    });
    const after = { kind: room.kind, connectedTo: [...room.connectedTo] };
    rows.push({ nullLayout: { scenario: scenario === null, before, after, mutated: JSON.stringify(before) !== JSON.stringify(after) } });
    expect(scenario, 'the builder fails visibly instead of pseudo-succeeding').toBeNull();
  });

  it('log rows', () => { console.log('P4F_PROBE ' + JSON.stringify(rows)); });
});
