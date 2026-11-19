/**
 * GAMEPLAY-01 P4 — real Demo-03 headless trials (HumanOnly vs HumanEcho).
 *
 * Event/metrics only: no model request, no human playtest. The driver reads the
 * canonical headless state to record metrics and therefore labels itself
 * NON-BLIND. Inputs are real per-tick intents/legacy Signal commands; the ECHO
 * proposal is the local-only path and the confirm is an Owner/human fixture.
 */
import { writeFileSync } from 'node:fs';
import { HeadlessWorld } from '../../../../src/ai-native/worldHeadless';
import { P1_DEMO_SEED } from '../../../../src/config/p1Scenario';

type Trial = {
  seed: number; mode: 'HumanOnly' | 'HumanEcho';
  startedTick: number; endedTick: number; ticks: number;
  playerHpStart: number; playerHpEnd: number; playerHpLoss: number;
  echoHpStart: number | null; echoHpEnd: number | null; echoHpLoss: number | null;
  playerEnergy: number; echoEnergy: number | null;
  signalOps: number; suggestions: number; accepted: number; rejected: number;
  acceptanceFailureRate: number | null;
  routeTarget: number | null; routeLabel: string | null; routePortal: { x: number; y: number } | null;
  completed: boolean; roomCleared: boolean; relay: string | null;
  kills: number; echoScan: string; nonBlind: true;
  scenario: { player: { x: number; y: number }; relay: { x: number; y: number }; drones: Array<{ x: number; y: number }>; routes: Array<{ target: number; when: string; portal?: { x: number; y: number } }> };
  initialEvents: string[];
};

function runTrial(seed: number, mode: 'HumanOnly' | 'HumanEcho'): Trial {
  const hw = new HeadlessWorld({ seed, demo: true, echoAutonomy: false });
  const scenario = hw.demoScenario!;
  const hpStart = hw.playerHp;
  const events0 = hw.runSteps([{ ticks: 1, intent: null }]).map((e) => e.type);
  let suggestions = 0, accepted = 0, rejected = 0, signalOps = 0;
  let echoScan = 'not-run';
  let echoHpStart: number | null = null, echoEnergy: number | null = null;
  if (mode === 'HumanEcho') {
    // Owner/dev fixture: spawn the echo at the relay-side cell, then let its
    // real local proposal pass through the human confirm and a real tick.
    const ex = scenario.relay.x - 1, ey = scenario.relay.y - 1;
    hw.enableEcho(ex, ey);
    hw.runSteps([{ ticks: 2, intent: null }]);
    echoHpStart = hw.state.echo?.data.hp ?? null;
    const proposal = hw.proposeLocalEcho();
    suggestions += proposal ? 1 : 0;
    if (proposal) {
      const ok = hw.confirmLocalEchoProposal(proposal.id);
      if (ok) accepted += 1; else rejected += 1;
      hw.runSteps([{ ticks: 3, intent: null }]);
      signalOps += 1;
      const after = hw.routeState;
      const sv = hw.signalView() as Record<string, unknown>;
      echoEnergy = typeof sv.echoEnergy === 'number' ? sv.echoEnergy : null;
      const audit = hw.echoAudit.recent(32);
      const last = audit.filter((e) => e.proposalId === proposal.id).at(-1);
      echoScan = last ? `${last.result}${last.code ? ':' + last.code : ''}` : 'no-audit';
      if (audit.some((e) => e.proposalId === proposal.id && e.result === 'rejected')) rejected += 1;
      void after;
    }
  }
  // Same deterministic combat/route input for both modes.
  for (let i = 0; i < 400; i += 1) {
    const st = hw.state;
    const live = st.drones.filter((d) => d.hp > 0)
      .sort((a, b) => Math.hypot(a.x - st.player.x, a.y - st.player.y) - Math.hypot(b.x - st.player.x, b.y - st.player.y));
    const near = live[0];
    const route = hw.routeState;
    if (near) {
      hw.runSteps([{ ticks: 1, intent: { move: { x: 0, y: 0 }, dash: false, fire: true, aim: { x: near.x, y: near.y }, interact: false } }]);
    } else if (route?.portal) {
      const dx = route.portal.x - st.player.x, dy = route.portal.y - st.player.y;
      const len = Math.hypot(dx, dy) || 1;
      hw.runSteps([{ ticks: 1, intent: { move: { x: dx / len, y: dy / len }, dash: false, fire: false, aim: null, interact: false } }]);
    } else break;
    if (hw.routeState?.completed) break;
  }
  const end = hw.routeState;
  const sv = hw.signalView() as Record<string, unknown>;
  const route = end?.target !== null && end?.target !== undefined ? scenario.routes.find((r) => r.target === end.target) : undefined;
  const audit = hw.echoAudit.recent(32);
  const echoHpEnd = hw.state.echo?.data.hp ?? null;
  return {
    seed, mode, startedTick: 0, endedTick: hw.tick, ticks: hw.tick,
    playerHpStart: hpStart, playerHpEnd: hw.playerHp, playerHpLoss: Math.max(0, hpStart - hw.playerHp),
    echoHpStart, echoHpEnd, echoHpLoss: echoHpStart !== null && echoHpEnd !== null ? Math.max(0, echoHpStart - echoHpEnd) : null,
    playerEnergy: typeof sv.playerEnergy === 'number' ? sv.playerEnergy : 100,
    echoEnergy: echoEnergy ?? (typeof sv.echoEnergy === 'number' ? sv.echoEnergy : null),
    signalOps, suggestions, accepted, rejected,
    acceptanceFailureRate: suggestions > 0 ? rejected / suggestions : null,
    routeTarget: end?.target ?? null, routeLabel: route?.label ?? null, routePortal: end?.portal ?? null,
    completed: !!end?.completed, roomCleared: !!end?.roomCleared, relay: end?.relay ?? null,
    kills: hw.killCount, echoScan, nonBlind: true,
    scenario: {
      player: scenario.playerStart ?? { x: 0, y: 0 }, relay: scenario.relay,
      drones: scenario.drones.map((d) => ({ x: d.x, y: d.y })),
      routes: scenario.routes.map((r) => ({ target: r.target, when: r.when, ...(r.portal ? { portal: r.portal } : {}) }))
    },
    initialEvents: events0
  };
}

const seeds = [P1_DEMO_SEED, P1_DEMO_SEED + 1, P1_DEMO_SEED + 2];
const trials: Trial[] = [];
for (const seed of seeds) {
  for (const mode of ['HumanOnly', 'HumanEcho'] as const) trials.push(runTrial(seed, mode));
}
const out = {
  schema: 'last_signal.p4.demo03.trials.v1',
  generatedBy: 'reports/gameplay-01/developer/p4/demo03-headless.mts',
  modelRequests: 0, humanPlaytests: 0, nonBlind: true,
  seeds, trials
};
writeFileSync(new URL('./evidence/demo03-headless.json', import.meta.url), JSON.stringify(out, null, 2));
for (const t of trials) {
  console.log(`${t.seed} ${t.mode}: ticks=${t.ticks} hpLoss=${t.playerHpLoss} energy=${t.playerEnergy} signalOps=${t.signalOps} suggestions=${t.suggestions} acceptFail=${t.acceptanceFailureRate} target=${t.routeTarget} completed=${t.completed} echo=${t.echoScan}`);
}
