import pathlib

src = pathlib.Path("tests/audit.spec.ts")
dst = pathlib.Path("reports/gameplay-01/developer/p4-recovery/diag/audit-boss-volley.diag.p4v4.spec.ts")
s = src.read_text(encoding="utf-8")

s = s.replace(
    "import { mkdirSync } from 'node:fs';",
    "import { mkdirSync, writeFileSync } from 'node:fs';",
    1,
)
s = s.replace(
    "import { clickLabel, resumeGame } from './uiNav';",
    "import { clickLabel, resumeGame } from '../../../../../tests/uiNav';",
    1,
)
s = s.replace(
    """const SHOT_DIR = process.env.LS_SHOT_DIR
  ? path.resolve(process.env.LS_SHOT_DIR)
  : path.resolve('screens');""",
    """const SHOT_DIR = process.env.LS_SHOT_DIR
  ? path.resolve(process.env.LS_SHOT_DIR)
  : path.resolve('screens');
// DIAG (developer): a NEW output directory; the tester's evidence is never overwritten.
const DIAG_DIR = process.env.LS_DIAG_DIR
  ? path.resolve(process.env.LS_DIAG_DIR)
  : path.resolve('reports/gameplay-01/developer/p4-recovery/diag');
const RUN_TAG = process.env.LS_DIAG_TAG ?? 'run';""",
    1,
)

old = """    boss.attackTimer = 999999; boss.stateTimer = 999999; // freeze auto-attacks
    const c0 = w.simFixture.projectiles.length;
    boss.phase = 2; boss.fireLaser(pl); boss.shockwave();
    w.resetSimulationAccumulator();
    w.stepFrame(1000 / 60 + 1e-6, neutral);
    const created = w.projectiles.slice(c0);"""

new = """    boss.attackTimer = 999999; boss.stateTimer = 999999; // freeze auto-attacks
    const c0 = w.simFixture.projectiles.length;
    const preDiag = {
      coreIds: w.simFixture.projectiles.map((q: any) => q.id),
      coreLen: w.simFixture.projectiles.length,
      adapterIds: w.projectiles.map((q: any) => q.data.id),
      adapterLen: w.projectiles.length,
      queued: w.simFixture.pendingCommands.map((c: any) => `${c.type}${c.ownerId !== undefined ? '#' + c.ownerId : ''}`),
      droneAlive: (w.simFixture.drones ?? []).filter((d: any) => d.hp > 0).length,
      enemiesAlive: (w.enemies ?? []).filter((e: any) => e.alive).length,
      bossId: boss._id, bossPhase: boss.phase, bossAttackTimer: boss.attackTimer, bossStateTimer: boss.stateTimer
    };
    boss.phase = 2; boss.fireLaser(pl); boss.shockwave();
    const queuedAfterCalls = w.simFixture.pendingCommands.map((c: any) => `${c.type}${c.ownerId !== undefined ? '#' + c.ownerId : ''}`);
    w.resetSimulationAccumulator();
    const stepEvents: any[] = (w.stepFrame(1000 / 60 + 1e-6, neutral) as any[]) ?? [];
    const created = w.projectiles.slice(c0);
    const postDiag = {
      coreIds: w.simFixture.projectiles.map((q: any) => q.id),
      coreLen: w.simFixture.projectiles.length,
      adapterIds: w.projectiles.map((q: any) => q.data.id),
      adapterLen: w.projectiles.length,
      queued: w.simFixture.pendingCommands.map((c: any) => `${c.type}${c.ownerId !== undefined ? '#' + c.ownerId : ''}`),
      droneAlive: (w.simFixture.drones ?? []).filter((d: any) => d.hp > 0).length,
      spawned: stepEvents.filter((e: any) => e.type === 'projectile-spawned').map((e: any) => ({
        id: e.projectile.id, ownerId: e.projectile.ownerId, source: e.projectile.source,
        kind: e.projectile.kind, vel: { x: e.projectile.vel.x, y: e.projectile.vel.y },
        pos: { x: e.projectile.pos.x, y: e.projectile.pos.y }
      })),
      eventTypes: stepEvents.map((e: any) => e.type)
    };"""

if old not in s:
    raise SystemExit("anchor A not found")
s = s.replace(old, new, 1)

old2 = """    return {
      count: created.length,"""
new2 = """    return {
      count: created.length,
      createdIds: created.map((q: any) => q.data.id),
      preDiag, queuedAfterCalls, postDiag,"""
if old2 not in s:
    raise SystemExit("anchor B not found")
s = s.replace(old2, new2, 1)

old3 = """  expect(bossInit.count, 'laser(3) + shockwave(12) bullets created').toBe(15);"""
new3 = """  // DIAG: persist the full attribution BEFORE the assertion can throw.
  {
    mkdirSync(DIAG_DIR, { recursive: true });
    writeFileSync(path.join(DIAG_DIR, `boss-volley-${RUN_TAG}.json`), JSON.stringify(bossInit, null, 2));
  }
  expect(bossInit.count, 'laser(3) + shockwave(12) bullets created').toBe(15);"""
if old3 not in s:
    raise SystemExit("anchor C not found")
s = s.replace(old3, new3, 1)

dst.write_text(s, encoding="utf-8")
print("boss volley diag spec written", len(s))
