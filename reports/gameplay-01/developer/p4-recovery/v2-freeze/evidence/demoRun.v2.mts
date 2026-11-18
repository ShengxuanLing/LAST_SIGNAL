// GAMEPLAY-01 P4 — DEMO-01/DEMO-03 cooperative level driver (EVIDENCE, not a test).
//
// Runs the FORMAL Headless World on the SAME authored scenario the rendered
// World builds (`src/config/p1Scenario.ts` → `HeadlessWorld({ demo: true })`)
// and plays it with REAL intents only:
//   - `runSteps` + SimulationIntent (move/aim/fire/interact)
//   - `enqueueSignalCommand` (scan/jam/toggle-relay) committed by the core tick
//   - the P2 local ECHO proposal path (propose → OWNER FIXTURE confirm → next
//     real tick state change), never a direct state write
// It never calls clearEnemies/teleport/heal and never writes `room.cleared`.
//
// NON-BLIND DECLARATION: the autopilot reads canonical coordinates (`sim.player`,
// `sim.drones`, authored route portals) through the public Headless API. This is
// a scripted engineering driver, NOT a human playtest and NOT a perception claim:
// a human ECHO would only see the bounded `echoView()`.
//
// Usage: npx vite-node <this file> -- --seed 20261117 --mode human-only --out <json>

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  HeadlessWorld, NEUTRAL_INTENT
} from '../../../../../src/ai-native/worldHeadless';
import type { SimulationIntent } from '../../../../../src/world/sim/core';

interface Args { seed: number; mode: 'human-only' | 'human-echo' | 'human-echo-reject'; out: string; maxTicks: number; want: 'RELAY_ACTIVE' | 'RELAY_INACTIVE'; }

function parseArgs(argv: string[]): Args {
  const get = (name: string, fallback?: string): string => {
    const i = argv.indexOf(`--${name}`);
    if (i >= 0 && argv[i + 1] !== undefined) return argv[i + 1];
    if (fallback !== undefined) return fallback;
    throw new Error(`missing --${name}`);
  };
  return {
    seed: Number(get('seed')),
    mode: get('mode') as Args['mode'],
    out: get('out'),
    maxTicks: Number(get('max-ticks', '9000')),
    want: get('want', 'RELAY_ACTIVE') as Args['want']
  };
}

const TICK_MS = 1000 / 60;

interface StepRecord {
  tick: number;
  action: string;
  detail?: Record<string, unknown>;
}

interface Metrics {
  seed: number;
  mode: string;
  demoId: string | null;
  roomId: number | null;
  startRoomId: number | null;
  routes: unknown;
  routeChosen: number | null;
  routeWhen: string | null;
  completed: boolean;
  /** `completed` is the HEADLESS route projection (room cleared + a route target
   *  + the player inside the portal radius). It is NOT a rendered room
   *  transition and must never be reported as "3 seeds cleared in the game". */
  completedKind: 'headless-route-projection';
  terminalStatus: string;
  ticks: number;
  /** Ticks the SCRIPT waited out the ECHO reject cooldown (125) — not ECHO cost. */
  scriptedRejectHoldTicks: number;
  ticksExcludingScriptedHold: number;
  elapsedSeconds: number;
  /** HumanOnly = no ECHO connection was made (NOT a disconnect/offline test). */
  connectionState: 'no-echo-connection' | 'echo-enabled-local';
  /** 0 damage under scripted long-range fire is NOT a balance sample. */
  balanceSample: false;
  playerHpStart: number;
  playerHpEnd: number;
  damageTaken: number;
  kills: number;
  shots: number;
  echoShots: number;
  signal: {
    scans: number;
    jams: number;
    toggles: number;
    energyStartPlayer: number | null;
    energyStartEcho: number | null;
    energyEndPlayer: number | null;
    energyEndEcho: number | null;
    /** NET change (start - end). Regeneration makes this smaller than the real
     *  cost; use `actualScanCost`/`actualJamCost` for what the action cost. */
    netEnergyChangePlayer: number | null;
    netEnergyChangeEcho: number | null;
    /** Real cost of the last ACCEPTED signal action, from its own event delta. */
    actualScanCost: number | null;
    actualJamCost: number | null;
  };
  proposals: {
    offered: number;
    accepted: number;
    rejected: number;
    failed: number;
    kinds: string[];
    lastAcceptToEffectTicks: number | null;
    lastAcceptToEffectDetail: Record<string, unknown> | null;
  };
  actions: number;
  events: Record<string, number>;
  roomClearedAtTick: number | null;
  echoEnabled: boolean;
  notes: string[];
}

/** Real fire intent aimed at a canonical target position. */
function aimAndFire(target: { x: number; y: number }): SimulationIntent {
  return { move: { x: 0, y: 0 }, dash: false, fire: true, aim: { x: target.x, y: target.y }, interact: false };
}

function moveToward(from: { x: number; y: number }, to: { x: number; y: number }): SimulationIntent {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  return { move: { x: dx / len, y: dy / len }, dash: false, fire: false, aim: null, interact: false };
}

function countEvents(world: HeadlessWorld): Record<string, number> {
  const out: Record<string, number> = {};
  const events = world.eventsSlice(0, Math.min(world.eventTotal, 20000));
  for (const event of events) out[event.type] = (out[event.type] ?? 0) + 1;
  return out;
}

function run(args: Args): Metrics {
  const world = new HeadlessWorld({ seed: args.seed, demo: true, echoAutonomy: false });
  const steps: StepRecord[] = [];
  const notes: string[] = [];
  const signalCounts = { scans: 0, jams: 0, toggles: 0 };
  const proposals = { offered: 0, accepted: 0, rejected: 0, failed: 0, kinds: [] as string[],
    lastAcceptToEffectTicks: null as number | null, lastAcceptToEffectDetail: null as Record<string, unknown> | null };
  let actions = 0;
  let scriptedRejectHoldTicks = 0;
  let roomClearedAtTick: number | null = null;
  let routeChosen: number | null = null;
  let routeWhen: string | null = null;
  let lastAccepted: { kind: string; tick: number } | null = null;
  let proposedOnce = false;

  const authored = world.demoScenario;
  if (!authored) throw new Error('demo scenario missing on a demo world');
  const routeA = authored.routes.find((r) => r.when === 'RELAY_ACTIVE');
  const routeB = authored.routes.find((r) => r.when === 'RELAY_INACTIVE');
  if (!routeA?.portal || !routeB?.portal) throw new Error('authored route portals missing');

  const step = (intent: SimulationIntent, action: string, detail?: Record<string, unknown>): void => {
    world.runSteps([{ ticks: 1, intent }]);
    actions += 1;
    pulseLastAccepted();
    steps.push({ tick: world.tick, action, ...(detail ? { detail } : {}) });
  };

  /** The accepted proposal's real effect must land on a LATER tick than the
   *  confirm, via the core command queue (never a direct state write). */
  const pulseLastAccepted = (): void => {
    if (!lastAccepted || proposals.lastAcceptToEffectTicks !== null) return;
    proposals.lastAcceptToEffectTicks = world.tick - lastAccepted.tick;
  };

  const hpStart = world.playerHp;
  const view0 = world.signalView();
  const energyStart = {
    player: (view0?.playerEnergy as number | undefined) ?? null,
    echo: (view0?.echoEnergy as number | undefined) ?? null
  };

  // ---- phase 1: fight the authored linked sentries with real intents --------
  // HumanOnly: direct combat (S1). HumanEcho: the SAME fight, with the ECHO
  // enabled and ONE owner-confirmed local proposal (S3), no stronger rule.
  if (args.mode !== 'human-only') {
    const echoSpawn = world.enableEcho();
    world.runSteps([{ ticks: 2, intent: NEUTRAL_INTENT }]);
    steps.push({ tick: world.tick, action: 'echo-enabled', detail: { x: echoSpawn.x, y: echoSpawn.y } });
  }

  let guard = 0;
  while (guard < args.maxTicks) {
    guard += 1;
    if (energyStart.player === null) {
      const v = world.signalView();
      if (v) {
        energyStart.player = (v.playerEnergy as number | undefined) ?? null;
        energyStart.echo = (v.echoEnergy as number | undefined) ?? null;
      }
    }
    const route = world.routeState;
    if (!route) throw new Error('routeState missing mid-run');
    if (roomClearedAtTick === null && route.roomCleared) roomClearedAtTick = world.tick;

    const liveDrones = world.state.drones.filter((d) => d.hp > 0 && d.data.spawnRoom === route.roomId);
    if (liveDrones.length > 0) {
      const me = world.state.player;
      const target = liveDrones.reduce((best, d) => {
        const dd = Math.hypot(d.x - me.x, d.y - me.y);
        const bd = Math.hypot(best.x - me.x, best.y - me.y);
        return dd < bd ? d : best;
      }, liveDrones[0]);
      const dist = Math.hypot(target.x - me.x, target.y - me.y);
      // A real player closes to weapon range, then fires while strafing.
      if (dist > 5.5) step(moveToward(me, target), 'approach-sentry', { dist });
      else step(aimAndFire(target), 'fire-sentry', { dist });
      continue;
    }

    // ---- phase 2: ECHO local proposal → OWNER FIXTURE confirm → real tick ---
    if (args.mode !== 'human-only' && !proposedOnce) {
      proposedOnce = true;
      // (a) A rejection first: the human refuses an ECHO suggestion. The level
      // must still be completable, and a refusal must not lock the run.
      const rejected = world.proposeLocalEcho();
      if (rejected) {
        proposals.offered += 1;
        proposals.kinds.push(`${rejected.kind}:rejected-by-human`);
        const ok = world.rejectLocalEchoProposal(rejected.id);
        if (ok) proposals.rejected += 1; else proposals.failed += 1;
        steps.push({ tick: world.tick, action: 'echo-proposal-rejected', detail: { kind: rejected.kind, id: rejected.id } });
        // The human keeps playing through the echo's own reject cooldown.
        for (let i = 0; i < 125; i += 1) {
          step(NEUTRAL_INTENT, 'hold-after-reject');
          scriptedRejectHoldTicks += 1;
        }
      }
      if (args.mode === 'human-echo-reject') {
        // REJECT-ONLY variant: the human refuses every suggestion. The run must
        // still reach a legal completion (a refusal never locks the level).
        continue;
      }
      // (b) A second, ACCEPTED suggestion: owner FIXTURE confirmation (not a
      // human), committed by the next real tick.
      const proposal = world.proposeLocalEcho();
      if (proposal) {
        proposals.offered += 1;
        proposals.kinds.push(`${proposal.kind}:accepted`);
        const tickBefore = world.tick;
        const before = world.signalView();
        // OWNER FIXTURE: the owner accepts through the same confirm boundary a
        // human UI uses. This run is labelled FIXTURE, never "a human played".
        const confirmed = world.confirmLocalEchoProposal(proposal.id, true);
        if (!confirmed) {
          proposals.failed += 1;
          steps.push({ tick: world.tick, action: 'echo-proposal-confirm-failed', detail: { kind: proposal.kind } });
        } else {
          proposals.accepted += 1;
          lastAccepted = { kind: proposal.kind, tick: tickBefore };
          steps.push({ tick: world.tick, action: 'echo-proposal-confirmed-by-owner-fixture', detail: { kind: proposal.kind, id: proposal.id } });
        }
        // The next REAL tick commits the queued core command.
        world.runSteps([{ ticks: 1, intent: NEUTRAL_INTENT }]);
        actions += 1;
        const after = world.signalView();
        if (lastAccepted) {
          proposals.lastAcceptToEffectTicks = world.tick - lastAccepted.tick;
          proposals.lastAcceptToEffectDetail = {
            kind: lastAccepted.kind,
            relayBefore: before?.relay ?? null,
            relayAfter: after?.relay ?? null,
            echoEnergyBefore: (before?.echoEnergy as number | undefined) ?? null,
            echoEnergyAfter: (after?.echoEnergy as number | undefined) ?? null,
            echoScanCdAfter: (after?.echoScanCD as number | undefined) ?? null,
            evidenceAfter: (after?.evidence as number | undefined) ?? null,
            changed: JSON.stringify(before) !== JSON.stringify(after)
          };
        }
        steps.push({
          tick: world.tick, action: 'post-confirm-real-tick',
          detail: {
            relay: after?.relay ?? null, echoEnergy: (after?.echoEnergy as number | undefined) ?? null,
            evidence: (after?.evidence as number | undefined) ?? null
          }
        });
      } else {
        proposals.failed += 1;
        steps.push({ tick: world.tick, action: 'echo-proposal-unavailable' });
      }
      continue;
    }

    // ---- phase 3: choose a route and walk to its authored portal ------------
    let route2 = world.routeState;
    if (!route2) throw new Error('routeState missing after clear');
    // The human's REAL manual relay control (R) selects the other legal branch.
    if (route2.relay !== args.want && signalCounts.toggles === 0) {
      world.enqueueSignalCommand({ type: 'toggle-relay', enabled: args.want === 'RELAY_ACTIVE' });
      signalCounts.toggles += 1;
      world.runSteps([{ ticks: 2, intent: NEUTRAL_INTENT }]);
      actions += 2;
      steps.push({ tick: world.tick, action: 'toggle-relay', detail: { want: args.want, relay: world.routeState?.relay ?? null } });
      continue;
    }
    if (route2.target === null) {
      // Nothing selectable (JAMMED/DISABLED): the human presses R once.
      world.enqueueSignalCommand({ type: 'toggle-relay', enabled: args.want === 'RELAY_ACTIVE' });
      signalCounts.toggles += 1;
      world.runSteps([{ ticks: 2, intent: NEUTRAL_INTENT }]);
      actions += 2;
      continue;
    }
    const portal = route2.portal;
    if (!portal) throw new Error('no portal after cleared');
    if (routeChosen === null) {
      routeChosen = route2.target;
      routeWhen = route2.relay;
      steps.push({ tick: world.tick, action: 'route-chosen', detail: { target: routeChosen, when: routeWhen } });
    }
    const me = world.state.player;
    const dist = Math.hypot(portal.x - me.x, portal.y - me.y);
    if (dist > 0.4) {
      step(moveToward(me, portal), 'walk-to-portal', { dist, target: routeChosen });
      continue;
    }
    // F: the same interact intent the human presses. The Headless routeState is
    // the legal-completion projection; the rendered World uses the same portal.
    world.runSteps([{ ticks: 1, intent: { ...NEUTRAL_INTENT, interact: true } }]);
    actions += 1;
    steps.push({ tick: world.tick, action: 'interact-at-portal', detail: { target: routeChosen } });
    route2 = world.routeState;
    if (route2?.completed) break;
    if (world.runStatus === 'dead') break;
  }

  const acceptedCost = (kind: 'scan' | 'jam'): number | null => {
    const detail = proposals.lastAcceptToEffectDetail as Record<string, unknown> | null;
    if (!detail || detail.kind !== kind) return null;
    const before = detail.echoEnergyBefore as number | null | undefined;
    const after = detail.echoEnergyAfter as number | null | undefined;
    if (typeof before !== 'number' || typeof after !== 'number') return null;
    return before - after;
  };

  const finalRoute = world.routeState;
  const events = countEvents(world);
  const viewEnd = world.signalView();
  const energyEnd = {
    player: (viewEnd?.playerEnergy as number | undefined) ?? null,
    echo: (viewEnd?.echoEnergy as number | undefined) ?? null
  };
  const metrics: Metrics = {
    seed: args.seed,
    mode: args.mode,
    demoId: authored.id,
    roomId: authored.roomId,
    startRoomId: world.identity.startRoomId ?? null,
    routes: authored.routes,
    routeChosen,
    routeWhen,
    completed: finalRoute?.completed === true,
    terminalStatus: world.runStatus,
    completedKind: 'headless-route-projection',
    ticks: world.tick,
    scriptedRejectHoldTicks,
    ticksExcludingScriptedHold: world.tick - scriptedRejectHoldTicks,
    elapsedSeconds: Number((world.tick * TICK_MS / 1000).toFixed(2)),
    connectionState: args.mode === 'human-only' ? 'no-echo-connection' : 'echo-enabled-local',
    balanceSample: false,
    playerHpStart: hpStart,
    playerHpEnd: world.playerHp,
    damageTaken: world.damageTotal,
    kills: world.killCount,
    shots: world.shotCount,
    echoShots: world.echoShotCount,
    signal: {
      scans: events['signal-scanned'] ?? 0,
      jams: events['signal-jammed'] ?? 0,
      toggles: events['signal-relay-changed'] ?? 0,
      energyStartPlayer: energyStart.player,
      energyStartEcho: energyStart.echo,
      energyEndPlayer: energyEnd.player,
      energyEndEcho: energyEnd.echo,
      netEnergyChangePlayer: energyStart.player !== null && energyEnd.player !== null
        ? energyStart.player - energyEnd.player : null,
      netEnergyChangeEcho: energyStart.echo !== null && energyEnd.echo !== null
        ? energyStart.echo - energyEnd.echo : null,
      actualScanCost: acceptedCost('scan'),
      actualJamCost: acceptedCost('jam')
    },
    proposals,
    actions,
    events,
    roomClearedAtTick,
    echoEnabled: args.mode !== 'human-only',
    notes: [
      'NON-BLIND: the scripted autopilot reads canonical sim positions via the public Headless API; it is not a perception claim and not a human playtest.',
      'OWNER FIXTURE: proposal confirmation uses confirmLocalEchoProposal(id, true); no human played.',
      'No clearEnemies/teleport/heal was used; the room is cleared by real fire intents and the map flag is committed by the core.',
      'completed = HEADLESS route projection only (this driver has no room transition). Rendered completion is proven separately on one seed.',
      'HumanOnly means NO ECHO connection was created. This is not a disconnect/offline test.',
      'damageTaken is a recorded fact, not a balance sample; scripted long-range fire takes 0 damage.',
      'Any HumanEcho tick delta includes scriptedRejectHoldTicks of scripted waiting; use ticksExcludingScriptedHold and never read it as the cost of cooperation.',
      'Signal energy: netEnergyChange* is a net delta (regeneration included). The real cost of an accepted action is actualScanCost/actualJamCost from its own event.',
      ...notes
    ]
  };

  // Route-state recovery evidence: snapshot → restore → same route identity.
  const frame = world.snapshot();
  const restored = new HeadlessWorld({ seed: args.seed, demo: true });
  const restoreResult = restored.restore(frame);
  const fromState = HeadlessWorld.fromSimulationState(world.state, [authored.roomId]);
  const recovery = {
    restoreOk: (restoreResult as any).ok === true,
    snapshotRoute: frame.sim.authored ?? null,
    restoredRoute: restored.routeState,
    fromSimulationStateRoute: fromState.routeState,
    fromSimulationStateStartRoomId: fromState.identity.startRoomId,
    freshStartRoomId: world.identity.startRoomId,
    routeIdentityEqual: JSON.stringify(restored.routeState) === JSON.stringify(finalRoute)
  };

  const out = { metrics, recovery, steps: steps.slice(0, 4000) };
  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, JSON.stringify(out, null, 2));
  return metrics;
}

const args = parseArgs(process.argv.slice(2));
const metrics = run(args);
// eslint-disable-next-line no-console
console.log(JSON.stringify(metrics, null, 2));
