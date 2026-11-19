// READ-ONLY reviewer probe (no product/test change, no devserver, no port).
// Proves: (a) a confirmed ECHO scan executes on the FIRST processed core tick
// and that single tick emits exactly one signal-scanned event; (b) the
// enqueued->applied AUDIT gap equals the number of fixed ticks in the batch that
// drained it (post-batch sampling in BOTH rendered and headless runtimes), so a
// measured gap of 3 is a frame-phase sample, not 3 ticks of execution latency.
import { HeadlessWorld, neutralIntent } from '../../../src/ai-native/worldHeadless';
import { SIGNAL_TUNING } from '../../../src/signal/signalTuning';

function makeWorld(): { world: HeadlessWorld; roomId: number } {
  const world = new HeadlessWorld({ seed: 424242 });
  const roomId = world.identity.combatRoomId ?? 0;
  world.enableEcho();
  world.runSteps([{ ticks: 1, intent: neutralIntent() }]);
  const echo = world.state.echo!;
  world.enableSignalDevice({ deviceId: 'relay_main', roomId, x: echo.x, y: echo.y });
  world.runSteps([{ ticks: 1, intent: neutralIntent() }]);
  return { world, roomId };
}

function auditRows(world: HeadlessWorld, id: string) {
  return (world.echoAudit.recent(32) as any[]).filter((e) => e.proposalId === id)
    .map((e) => ({ tick: e.tick, result: e.result }));
}

function caseA(name: string, extraTicks: number, frozenBefore: boolean) {
  const { world } = makeWorld();
  const beforeEcho = world.signalView()?.echoEnergy as number;
  const proposal = world.proposeLocalEcho()!;
  const ok = world.confirmLocalEchoProposal(proposal.id, true);
  const pendingAfterConfirm = world.state.pendingCommands.length;
  let frozen: any = null;
  if (frozenBefore) {
    // No processed tick: nothing may execute while the sim is not stepping.
    const none = world.runSteps([{ ticks: 0, intent: neutralIntent() }]);
    frozen = {
      eventsWhileFrozen: none.length,
      pendingWhileFrozen: world.state.pendingCommands.length,
      echoEnergyWhileFrozen: world.signalView()?.echoEnergy,
      auditWhileFrozen: auditRows(world, proposal.id)
    };
  }
  const events = world.runSteps([{ ticks: extraTicks, intent: neutralIntent() }]);
  const scans = events.filter((e) => e.type === 'signal-scanned') as any[];
  const rows = auditRows(world, proposal.id);
  const enq = rows.find((r) => r.result === 'enqueued');
  const app = rows.find((r) => r.result === 'applied');
  const echo = world.state.echo;
  const result = {
    name, confirmOk: ok, pendingAfterConfirm, frozen,
    ticksInDrainingBatch: extraTicks,
    scansInBatch: scans.length,
    scanEnergy: scans[0]?.energy ?? null,
    echoEnergyBefore: beforeEcho,
    echoEnergyAfter: world.signalView()?.echoEnergy,
    echoEnergyDelta: beforeEcho - ((world.signalView()?.echoEnergy as number) ?? 0),
    expectedScanCost: SIGNAL_TUNING.SCAN_COST,
    auditEnqueuedTick: enq?.tick ?? null,
    auditAppliedTick: app?.tick ?? null,
    auditGap: enq && app ? app.tick - enq.tick : null,
    pendingAfterDrain: world.state.pendingCommands.length,
    echoHpAfter: echo?.data.hp ?? null
  };
  console.log(JSON.stringify(result));
  return result;
}

console.log('# probe start (read-only; no product/test change)');
caseA('A1 single processed tick (deterministic first-tick proof)', 1, false);
caseA('A2 frozen: confirm, NO processed tick, then 1 tick', 1, true);
caseA('A3 draining batch of 3 fixed ticks (sampling artefact)', 3, false);
caseA('A4 draining batch of 15 fixed ticks (MAX_TICKS_PER_FRAME)', 15, false);
console.log('# probe done');
