// Developer analysis of the per-tick traces (deterministic; reads the JSON dumps only).
// Usage: node diag/analyze-traces.mjs <diagDir> > analysis.txt
import { readFileSync } from 'node:fs';
import path from 'node:path';

const dir = process.argv[2] ?? 'reports/gameplay-01/developer/p4-recovery/diag';

function load(name) {
  return JSON.parse(readFileSync(path.join(dir, name), 'utf8'));
}

function windowStats(trace, label) {
  const marks = trace.marks ?? [];
  if (marks.length < 2) return { label, error: 'missing marks' };
  const [m0, m1] = marks;
  const win = trace.rows.filter((r) => r.t >= m0.t && r.t <= m1.t);
  const movers = win.filter((r) => Math.abs(r.dx) > 1e-9 || Math.abs(r.dy) > 1e-9);
  return {
    label,
    windowMs: m1.t - m0.t,
    frames: win.length,
    movers: movers.length,
    moversAllKnockback: movers.every((r) =>
      r.intent.move.x === 0 && r.intent.move.y === 0 && r.ev.hurt > 0 &&
      !r.keys.up && !r.keys.down && !r.keys.left && !r.keys.right),
    nonzeroMoveIntents: win.filter((r) => r.intent.move.x !== 0 || r.intent.move.y !== 0).length,
    keysHeld: win.some((r) => r.keys.up || r.keys.down || r.keys.left || r.keys.right),
    hurts: win.reduce((a, r) => a + r.ev.hurt, 0),
    heals: win.reduce((a, r) => a + r.ev.heal, 0),
    queuedCommands: [...new Set(win.flatMap((r) => r.queued))],
    owners: [...new Set(win.map((r) => r.owner))],
    aiEnabled: [...new Set(win.map((r) => r.aiEnabled))],
    startMark: { x: m0.x, y: m0.y, hp: m0.hp, owner: m0.owner, keys: m0.keys, lastIntentOwner: m0.lastIntentOwner },
    endMark: { x: m1.x, y: m1.y, hp: m1.hp, owner: m1.owner, keys: m1.keys, lastIntentOwner: m1.lastIntentOwner },
    posDelta: [+(m1.x - m0.x).toFixed(6), +(m1.y - m0.y).toFixed(6)],
    hpEqual: m0.hp === m1.hp,
    assertOutcome: trace.assertOutcome,
    thrown: trace.thrown,
    moverRows: movers.map((r) => ({
      t: r.t, dx: +r.dx.toFixed(4), dy: +r.dy.toFixed(4), move: r.intent.move, ev: r.ev,
      hp: [r.hpBefore, r.hpAfter], nearestEnemyTiles: r.nearest ? r.nearest.d : null,
      queued: r.queued
    }))
  };
}

const out = { dir, runs: [] };
for (const tag of ['run2', 'run3']) {
  try {
    out.runs.push(windowStats(load(`per-tick-trace-${tag}.json`), tag));
  } catch (error) {
    out.runs.push({ label: tag, error: String(error) });
  }
}
console.log(JSON.stringify(out, null, 2));
