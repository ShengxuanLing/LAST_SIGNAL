import pathlib

p = pathlib.Path("reports/gameplay-01/developer/p4-recovery/diag/ai-native-world.diag2.p4v4.spec.ts")
s = p.read_text(encoding="utf-8")

s = s.replace(
    "import { SAVE_KEY } from '../src/config/game';",
    "import { SAVE_KEY } from '../../../../../src/config/game';",
)
s = s.replace(
    "import { clickLabel, openAiHub, openEcho, resumeGame } from './uiNav';",
    "import { clickLabel, openAiHub, openEcho, resumeGame } from '../../../../../tests/uiNav';",
)

recorder = r"""
const GAME_W = 1280;
const GAME_H = 720;
// DIAG (developer): a NEW output directory; the tester's package is never overwritten.
const DIAG_DIR = process.env.LS_DIAG_DIR
  ? path.resolve(process.env.LS_DIAG_DIR)
  : path.resolve('reports/gameplay-01/developer/p4-recovery/diag');
const RUN_TAG = process.env.LS_DIAG_TAG ?? 'run';

/** Read-only per-stepFrame recorder. Persisted from a finally block, so a thrown
 *  assertion still leaves the whole trace on disk. */
async function installTrace(page: Page): Promise<void> {
  await page.evaluate(() => {
    const g: any = (window as any).__game;
    const gs: any = g.scene.getScene('GameScene');
    const w = gs.world;
    const proto = Object.getPrototypeOf(w);
    if (proto.__lsTraceInstalled) return;
    proto.__lsTraceInstalled = true;
    const orig = proto.stepFrame;
    const rows: any[] = [];
    const marks: any[] = [];
    (window as any).__lsTrace = { rows, marks, startedAt: Math.round(performance.now()) };
    (window as any).__lsMark = (name: string) => {
      const sim = w._sim;
      const ctl = w.player.control.snapshot();
      marks.push({
        name, t: Math.round(performance.now()), simTick: sim.tick,
        x: sim.player.x, y: sim.player.y, hp: sim.player.data.hp,
        owner: ctl.owner, mode: ctl.mode, aiEnabled: ctl.aiEnabled, ctlPaused: ctl.paused,
        gsPaused: gs.paused, lastIntentOwner: w.player.lastIntentOwner,
        lastIntent: JSON.parse(JSON.stringify(w.player.lastIntent ?? null)),
        keys: { ...w.player.input }, fireHeld: w.player.fireHeld(),
        queued: (sim.pendingCommands as any[]).map((c: any) => `${c.type}${c.actor ? ':' + c.actor : ''}`),
        enemies: (w.enemies as any[]).length, projectiles: (sim.projectiles as any[]).length,
        aiActionCount: ctl.aiActionCount, takeoverCount: ctl.takeoverCount
      });
    };
    proto.stepFrame = function (delta: number, intent: any, ...rest: any[]) {
      const sim = this._sim;
      const tickBefore = sim.tick;
      const bx = sim.player.x;
      const by = sim.player.y;
      const hpBefore = sim.player.data.hp;
      const ctl = this.player.control.snapshot();
      const queued = (sim.pendingCommands as any[]).map((c: any) => `${c.type}${c.actor ? ':' + c.actor : ''}`);
      const out = orig.call(this, delta, intent, ...rest);
      const events: any[] = Array.isArray(out) ? out : [];
      const after = sim.player;
      if (rows.length < 40000) {
        let nearest: any = null;
        for (const e of (this.enemies as any[]) ?? []) {
          const d = Math.hypot(e.wx - after.x, e.wy - after.y);
          if (!nearest || d < nearest.d) nearest = { d: Math.round(d * 1000) / 1000, kind: e.data?.kind ?? null, hp: e._hp ?? null };
        }
        rows.push({
          t: Math.round(performance.now()),
          simTickBefore: tickBefore, simTickAfter: sim.tick, ticks: sim.tick - tickBefore,
          owner: ctl.owner, mode: ctl.mode, aiEnabled: ctl.aiEnabled, ctlPaused: ctl.paused,
          intent: {
            move: { x: intent?.move?.x ?? null, y: intent?.move?.y ?? null },
            dash: !!intent?.dash, fire: !!intent?.fire,
            aim: intent?.aim ? { x: intent.aim.x, y: intent.aim.y } : null,
            interact: !!intent?.interact
          },
          lastIntentOwner: this.player.lastIntentOwner,
          bx, by, ax: after.x, ay: after.y, dx: after.x - bx, dy: after.y - by,
          hpBefore, hpAfter: after.data.hp,
          keys: { ...this.player.input }, fireHeld: this.player.fireHeld(),
          queued,
          enemies: (this.enemies as any[]).length, nearest,
          projectiles: (sim.projectiles as any[]).length,
          ev: {
            hurt: events.filter((e) => e.type === 'player-hurt').length,
            heal: events.filter((e) => e.type === 'player-healed').length,
            loot: events.filter((e) => e.type === 'loot-collected').length,
            death: events.filter((e) => e.type === 'player-death').length
          },
          walkable: this.isWalkable(after.x, after.y, 0.5)
        });
      }
      return out;
    };
  });
}
"""
s = s.replace("const GAME_W = 1280;\nconst GAME_H = 720;", recorder, 1)

s = s.replace(
    """      actor: 'test-harness (not the controller)'
    });
    let st = await state(page);""",
    """      actor: 'test-harness (not the controller)'
    });
    await installTrace(page);
    let st = await state(page);""",
)

old = """    await resumeGame(page); // AI hub -> pause root -> resume
    // Let the resume tick drain any intent that was already queued when the
    // human disabled the controller (the core commits queued intents on the
    // next tick; that is legal and not the AI driving again).
    await page.waitForTimeout(1500);
    const stationaryStart = await state(page);
    expect(stationaryStart!.owner, 'human owns control once the run settles').toBe('human');
    await page.waitForTimeout(2500);
    const stationary = await state(page);
    expect(stationary!.owner, 'human still owns control after disable').toBe('human');
    expect(stationary!.aiEnabled, 'AI stays disabled (no self-reclaim)').toBe(false);
    expect(stationary!.lastAiAction, 'AI action state cleared after disable').toBeNull();
    expect(stationary!.txtControl, 'HUD returns to HUMAN').toContain('HUMAN');
    if (stationaryStart!.hp === stationary!.hp) {
      // No enemy knockback involved: the disabled AI must not move the player.
      expect(stationary!.grid.x, `disabled AI does not move the player (x ${stationary!.grid.x} vs ${stationaryStart!.grid.x})`).toBeCloseTo(stationaryStart!.grid.x, 6);
      expect(stationary!.grid.y, `disabled AI does not move the player (y ${stationary!.grid.y} vs ${stationaryStart!.grid.y})`).toBeCloseTo(stationaryStart!.grid.y, 6);
    }
    record('manual-disable', { owner: stationary!.owner, takeoverCount: stationary!.takeoverCount, reason: disabled!.lastTakeoverReason });"""

new = """    let stationaryStart: any = null;
    let stationary: any = null;
    let assertOutcome = 'not-reached';
    let thrown: string | null = null;
    try {
      await resumeGame(page); // AI hub -> pause root -> resume
      // Let the resume tick drain any intent that was already queued when the
      // human disabled the controller (the core commits queued intents on the
      // next tick; that is legal and not the AI driving again).
      await page.waitForTimeout(1500);
      stationaryStart = await state(page);
      await page.evaluate(() => (window as any).__lsMark?.('stationaryStart'));
      expect(stationaryStart!.owner, 'human owns control once the run settles').toBe('human');
      await page.waitForTimeout(2500);
      stationary = await state(page);
      await page.evaluate(() => (window as any).__lsMark?.('stationary'));
      expect(stationary!.owner, 'human still owns control after disable').toBe('human');
      expect(stationary!.aiEnabled, 'AI stays disabled (no self-reclaim)').toBe(false);
      expect(stationary!.lastAiAction, 'AI action state cleared after disable').toBeNull();
      expect(stationary!.txtControl, 'HUD returns to HUMAN').toContain('HUMAN');
      if (stationaryStart!.hp === stationary!.hp) {
        assertOutcome = 'asserted-equal-hp';
        // No enemy knockback involved: the disabled AI must not move the player.
        expect(stationary!.grid.x, `disabled AI does not move the player (x ${stationary!.grid.x} vs ${stationaryStart!.grid.x})`).toBeCloseTo(stationaryStart!.grid.x, 6);
        expect(stationary!.grid.y, `disabled AI does not move the player (y ${stationary!.grid.y} vs ${stationaryStart!.grid.y})`).toBeCloseTo(stationaryStart!.grid.y, 6);
        assertOutcome = 'asserted-equal-hp-passed';
      } else {
        assertOutcome = 'skipped-hp-differs';
      }
      record('manual-disable', { owner: stationary!.owner, takeoverCount: stationary!.takeoverCount, reason: disabled!.lastTakeoverReason });
    } catch (error) {
      thrown = (error as Error).message;
      throw error;
    } finally {
      const dump = await page.evaluate(() => (window as any).__lsTrace ?? { rows: [], marks: [] });
      mkdirSync(DIAG_DIR, { recursive: true });
      writeFileSync(path.join(DIAG_DIR, `per-tick-trace-${RUN_TAG}.json`), JSON.stringify({ ...dump, stationaryStart, stationary, assertOutcome, thrown }, null, 0));
      writeFileSync(path.join(DIAG_DIR, `per-tick-summary-${RUN_TAG}.json`), JSON.stringify({
        runTag: RUN_TAG, rows: (dump.rows ?? []).length, marks: (dump.marks ?? []).length,
        assertOutcome, thrown,
        stationaryStart: stationaryStart ? { x: stationaryStart.grid, hp: stationaryStart.hp, owner: stationaryStart.owner, intent: stationaryStart.intent, enemies: stationaryStart.enemies, inputFlags: stationaryStart.inputFlags } : null,
        stationary: stationary ? { x: stationary.grid, hp: stationary.hp, owner: stationary.owner, intent: stationary.intent, enemies: stationary.enemies, inputFlags: stationary.inputFlags } : null
      }, null, 2));
    }"""

if old not in s:
    raise SystemExit("anchor block not found")
s = s.replace(old, new, 1)
p.write_text(s, encoding="utf-8")
print("diag2 written", len(s))
