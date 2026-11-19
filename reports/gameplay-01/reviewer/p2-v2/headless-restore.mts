// P2 v2 — independent headless check: pending guard vs core queue across restore.
import { HeadlessWorld, neutralIntent } from '../../../../src/ai-native/worldHeadless';
const world = new HeadlessWorld({ seed: 424242 });
const roomId = world.identity.combatRoomId ?? 0;
world.enableEcho();
world.runSteps([{ ticks: 1, intent: neutralIntent() }]);
const echo = world.state.echo!;
world.enableSignalDevice({ deviceId: 'relay_main', roomId, x: echo.x, y: echo.y });
world.runSteps([{ ticks: 1, intent: neutralIntent() }]);
const prop = world.proposeLocalEcho();
console.log('[1] proposal', prop ? { id: prop.id, kind: prop.kind } : null);
if (!prop) process.exit(0);
const ok1 = world.confirmLocalEchoProposal(prop.id, true);
console.log('[2] confirm#1', JSON.stringify({ ok1, pending: world.echoPendingLocal?.proposalId ?? null, queued: world.state.pendingCommands.length }));
const ok2 = world.confirmLocalEchoProposal(prop.id, true);
console.log('[3] confirm#2 same id', JSON.stringify({ ok2, queued: world.state.pendingCommands.length, audit: world.echoAudit.last() }));
// restore the SAME core state (parity / restore path)
const restored = HeadlessWorld.fromSimulationState(world.state, [roomId]);
console.log('[4] restored', JSON.stringify({
  queued: restored.state.pendingCommands.length,
  guard: restored.echoPendingLocal?.proposalId ?? null,
  echo: restored.state.echo ? { hp: restored.state.echo.data.hp } : null
}));
const prop2 = restored.proposeLocalEcho();
const ok3 = prop2 ? restored.confirmLocalEchoProposal(prop2.id, true) : false;
console.log('[5] restored confirm', JSON.stringify({ prop2: prop2?.id ?? null, ok3, queued: restored.state.pendingCommands.length }));
