// AI-NATIVE-02 C3-c — P4 Dev harness on the SAME headless core.
//
// Deterministic combat regression / baseline policy comparison / real perf.
// Everything here drives the REAL `HeadlessWorld` (real sim/core +
// MapGenerator + config). There is no empty-scene throughput and no invented
// gameplay. Policies are explicitly DETERMINISTIC BASELINES, not an AI agent.
//
// Signal Combat is not implemented in the main World; this module returns an
// explicit UNSUPPORTED result instead of faking it.

import { performance } from 'node:perf_hooks';
import { HeadlessWorld, neutralIntent, type HeadlessStatus } from './worldHeadless';
import type { SimulationIntent } from '../world/sim/core';

export type BaselinePolicyId = 'hold' | 'seek-and-fire';

export interface CombatStepPlan {
  readonly policy: BaselinePolicyId;
}

export interface CombatRunResult {
  readonly seed: number;
  readonly ticks: number;
  readonly status: HeadlessStatus;
  readonly kills: number;
  readonly shots: number;
  readonly damageTaken: number;
  readonly playerHp: number;
  readonly dronesAlive: number;
  readonly canonicalStateHash: string;
  readonly eventCount: number;
}

export interface CombatRegressionResult {
  readonly scenario: 'fixed-combat-regression';
  readonly policy: BaselinePolicyId;
  readonly seeds: number[];
  readonly maxTicks: number;
  readonly runs: CombatRunResult[];
  readonly aggregate: {
    runs: number; deaths: number; cleared: number; running: number; totalTicks: number;
    totalKills: number; totalShots: number; totalDamageTaken: number;
  };
}

export interface PolicyComparisonResult {
  readonly scenario: 'deterministic-baseline-comparison';
  readonly note: 'deterministic baselines, NOT an AI agent and NOT Signal Combat';
  readonly seeds: number[];
  readonly maxTicks: number;
  readonly results: Array<CombatRegressionResult['aggregate'] & { policy: BaselinePolicyId }>;
}

/**
 * One deterministic baseline step. Uses the SAME legal observation the Agent
 * sees (no full map / seed / RNG): aim at the nearest perceived live drone and
 * fire; otherwise hold still. `hold` never fires.
 */
export function baselineIntent(world: HeadlessWorld, policy: BaselinePolicyId): SimulationIntent {
  if (policy === 'hold') return neutralIntent();
  const observation = world.observation();
  const drones = observation.drones.filter((d) => d.hp > 0);
  if (drones.length === 0) return neutralIntent();
  let best = drones[0];
  let bestDist = Number.POSITIVE_INFINITY;
  for (const drone of drones) {
    const dist = Math.hypot(drone.x - observation.player.x, drone.y - observation.player.y);
    if (dist < bestDist) { best = drone; bestDist = dist; }
  }
  return {
    move: { x: 0, y: 0 }, dash: false, fire: true,
    aim: { x: best.x, y: best.y }, interact: false
  };
}

const POLICY_RECHECK_TICKS = 5;

/** Run a REAL combat encounter with a deterministic baseline policy. */
export function runCombat(
  seed: number,
  policy: BaselinePolicyId,
  maxTicks: number
): CombatRunResult {
  const world = new HeadlessWorld({ seed });
  let ticks = 0;
  while (ticks < maxTicks) {
    if (world.runStatus !== 'running') break;
    const chunk = Math.min(POLICY_RECHECK_TICKS, maxTicks - ticks);
    const intent = baselineIntent(world, policy);
    world.runSteps([{ ticks: chunk, intent }], chunk);
    ticks += chunk;
    world.refreshStatus();
  }
  const inspect = world.inspect();
  const state = world.state;
  return {
    seed,
    ticks: state.tick,
    status: world.runStatus,
    kills: inspect.kills as number,
    shots: inspect.shots as number,
    damageTaken: inspect.damageTaken as number,
    playerHp: (inspect.player as { hp: number }).hp,
    dronesAlive: inspect.liveDrones as number,
    canonicalStateHash: inspect.canonicalStateHash as string,
    eventCount: inspect.eventCount as number
  };
}

function aggregate(runs: CombatRunResult[]): CombatRegressionResult['aggregate'] {
  return {
    runs: runs.length,
    deaths: runs.filter((r) => r.status === 'dead').length,
    cleared: runs.filter((r) => r.status === 'cleared').length,
    running: runs.filter((r) => r.status === 'running').length,
    totalTicks: runs.reduce((n, r) => n + r.ticks, 0),
    totalKills: runs.reduce((n, r) => n + r.kills, 0),
    totalShots: runs.reduce((n, r) => n + r.shots, 0),
    totalDamageTaken: runs.reduce((n, r) => n + r.damageTaken, 0)
  };
}

export function combatRegression(
  seeds: readonly number[],
  maxTicks: number,
  policy: BaselinePolicyId = 'seek-and-fire'
): CombatRegressionResult {
  const runs = seeds.map((seed) => runCombat(seed, policy, maxTicks));
  return { scenario: 'fixed-combat-regression', policy, seeds: [...seeds], maxTicks, runs, aggregate: aggregate(runs) };
}

export function compareBaselinePolicies(
  seeds: readonly number[],
  maxTicks: number,
  policies: readonly BaselinePolicyId[] = ['hold', 'seek-and-fire']
): PolicyComparisonResult {
  const results = policies.map((policy) => {
    const runs = seeds.map((seed) => runCombat(seed, policy, maxTicks));
    return { policy, ...aggregate(runs) };
  });
  return {
    scenario: 'deterministic-baseline-comparison',
    note: 'deterministic baselines, NOT an AI agent and NOT Signal Combat',
    seeds: [...seeds],
    maxTicks,
    results
  };
}

export interface PerfSample {
  readonly ticksPerSession: number;
  readonly sessions: number;
  readonly wallMs: number;
  readonly cpuUserMs: number;
  readonly cpuSystemMs: number;
  readonly heapUsedBytes: number;
  readonly heapUsedTotalBytes: number;
  readonly totalEvents: number;
  readonly totalKills: number;
  readonly totalShots: number;
  /** Ticks that ran while at least one REAL enemy was alive (no empty scenes). */
  readonly liveCombatTicks: number;
  readonly runs: Array<{ seed: number; ticks: number; liveTicks: number; status: HeadlessStatus; events: number }>;
}

/**
 * REAL combat perf: N independent sessions, each running exactly `ticks` real
 * core ticks. When the encounter clears, a REAL enemy wave is re-spawned from
 * the real enemy config so the measured work is always combat work — never
 * empty-scene throughput. `liveCombatTicks` reports ticks with a live enemy.
 */
export function combatPerf(
  ticksPerSession: number,
  sessions: number,
  baseSeed = 910_000
): PerfSample {
  const cpu0 = process.cpuUsage();
  const wall0 = performance.now();
  const heap0 = process.memoryUsage().heapUsed;
  const runs: PerfSample['runs'] = [];
  let totalEvents = 0;
  let totalKills = 0;
  let totalShots = 0;
  let liveCombatTicks = 0;
  for (let i = 0; i < sessions; i += 1) {
    const seed = (baseSeed + i * 7919) >>> 0;
    const world = new HeadlessWorld({ seed });
    let ticks = 0;
    let liveTicks = 0;
    while (ticks < ticksPerSession) {
      world.refreshStatus();
      if (world.runStatus === 'dead') break;
      if (world.runStatus === 'cleared') {
        // Sustain a REAL wave (real EnemyData); never step an empty scene.
        world.spawnEnemies(['drone', 'drone']);
      }
      const chunk = Math.min(POLICY_RECHECK_TICKS, ticksPerSession - ticks);
      const intent = baselineIntent(world, 'seek-and-fire');
      const before = world.tick;
      world.runSteps([{ ticks: chunk, intent }], chunk);
      const ran = world.tick - before;
      ticks += ran;
      if (world.liveDrones > 0) liveTicks += ran;
    }
    const events = world.eventTotal;
    totalEvents += events;
    totalKills += world.killCount;
    totalShots += world.shotCount;
    liveCombatTicks += liveTicks;
    runs.push({ seed, ticks, liveTicks, status: world.runStatus, events });
  }
  const cpu = process.cpuUsage(cpu0);
  const wallMs = performance.now() - wall0;
  const heapUsedTotalBytes = process.memoryUsage().heapUsed;
  return {
    ticksPerSession, sessions,
    wallMs: Math.round(wallMs * 100) / 100,
    cpuUserMs: Math.round(cpu.user / 100) / 10,
    cpuSystemMs: Math.round(cpu.system / 100) / 10,
    heapUsedBytes: Math.max(0, heapUsedTotalBytes - heap0),
    heapUsedTotalBytes,
    totalEvents, totalKills, totalShots, liveCombatTicks,
    runs
  };
}

/** Main-World Signal Combat is NOT implemented. Never fake it. */
export function signalCombatStatus(): { ok: false; code: 'E_NOT_APPLICABLE'; messageKey: string } {
  return { ok: false, code: 'E_NOT_APPLICABLE', messageKey: 'world.signal_combat_unsupported' };
}
