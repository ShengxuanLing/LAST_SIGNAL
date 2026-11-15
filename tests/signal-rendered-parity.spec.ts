// AI-NATIVE-02 Task C — Rendered→Headless Signal parity export.
//
// Runs a REAL rendered Phaser instance with signal actions (scan/jam/toggle),
// exports initial state + ordered player/echo/signal inputs + canonical+events
// to reports/ai-native-02/signal/parity/. A companion vitest replays the same
// inputs in HeadlessWorld and compares canonical+events byte-by-byte.
//
// This is the actual rendered instance (not two Node same-seed runs).
// Includes scan/jam/TTL/relay, echo accounts, real damage/loot (reusing the
// old c3c-headless-parity driver pattern).

import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const OUT = path.resolve('reports/ai-native-02/signal/parity');

async function bootRun(page: any): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => localStorage.removeItem('lastSignal.save.v1'));
  await page.reload();
  await page.waitForFunction(() => (window as any).__game?.scene.isActive('MainMenuScene'));
  const newRun = await page.evaluate(() => {
    const g: any = (window as any).__game;
    for (const s of Object.values(g.scene.scenes) as any[]) {
      if (!g.scene.isActive(s.sys.settings.key)) continue;
      const t = s.children.list.find((c: any) => c.type === 'Text' && (c.text || '').trim().startsWith('NEW RUN') && c.visible !== false);
      if (t) return { x: t.x, y: t.y };
    }
    return null;
  });
  expect(newRun).not.toBeNull();
  await page.mouse.click(newRun!.x, newRun!.y);
  await page.waitForFunction(() => (window as any).__game?.scene.isActive('GameScene'));
}

test('Rendered signal export for Headless parity (scan/jam/toggle/echo/real damage)', async ({ page }) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  mkdirSync(OUT, { recursive: true });
  await bootRun(page);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  const result = await page.evaluate(async () => {
    const g: any = (window as any).__game;
    const gs: any = g.scene.getScene('GameScene');
    const w = gs.world;
    const p = { x: w.player.wx, y: w.player.wy };
    const room = w.currentRoom();
    const initial = JSON.parse(JSON.stringify(w.sim));
    const sequence: Array<{ ticks: number; intent: any; signalCommand?: any }> = [];
    const events: any[] = [];
    const neutral = { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false };
    w.resetSimulationAccumulator();
    const runStep = (intent: any, signalCommand?: any): void => {
      sequence.push({ ticks: 1, intent, signalCommand });
      if (signalCommand) {
        w.enqueueSignalCommand(signalCommand);
      }
      events.push(...w.stepFrame(1000 / 60 + 1e-6, intent));
    };
    // Spawn echo + signal device for a meaningful signal scenario.
    w.enableEcho();
    await new Promise((r) => setTimeout(r, 50));
    const echo = w.sim.echo;
    if (echo && !w.sim.signal) {
      w.enqueueSignalCommand({ type: 'spawn-signal-device', deviceId: 'relay_main', roomId: room?.id ?? 0, x: echo.x + 0.5, y: echo.y });
      w.stepFrame(1000 / 60 + 1e-6, neutral);
    }
    // 1) Echo scan: costs echo energy, records evidence.
    if (echo && w.sim.signal) {
      runStep(neutral, { type: 'signal-scan', actor: 'echo' });
    }
    // 2) Player jam: suppresses emission.
    if (w.sim.signal) {
      runStep(neutral, { type: 'signal-jam', actor: 'player' });
    }
    // 3) Toggle relay → ACTIVE (after jam expiry we need manualEnabled; here just toggle).
    if (w.sim.signal) {
      runStep(neutral, { type: 'toggle-relay', enabled: true });
    }
    // 4) Advance ticks for jam expiry + regen.
    for (let i = 0; i < 370; i += 1) {
      runStep(neutral);
    }
    // 5) Real damage: fire at the echo/target to generate enemy-hit events.
    const target = w.sim.echo;
    if (target) {
      for (let i = 0; i < 5; i += 1) {
        runStep({ ...neutral, fire: true, aim: { x: target.x, y: target.y } });
        runStep(neutral);
      }
    }
    const state = w.sim;
    return {
      initial,
      sequence,
      canonical: (await import('/src/world/sim/core.ts')).canonicalSimulationState(state),
      events: (await import('/src/world/sim/core.ts')).canonicalSimulationEvents(events),
      eventTypes: [...new Set(events.map((e: any) => e.type))],
      finalTick: state.tick,
      echoEnergy: state.echo ? state.echo.energy.energy : -1,
      playerHp: state.player.data.hp,
      signalRelay: state.signal ? state.signal.relay : null,
      signalManual: state.signal ? state.signal.manualEnabled : null,
      signalPowered: state.signal ? state.signal.powered : null,
      signalEvidence: state.signal ? state.signal.evidence.length : 0,
      dronesLeft: state.drones.length,
      projectilesLeft: state.projectiles.length,
      lootLeft: state.loot.length
    };
  });

  writeFileSync(path.join(OUT, 'initial.json'), JSON.stringify(result.initial, null, 2));
  writeFileSync(path.join(OUT, 'sequence.json'), JSON.stringify(result.sequence, null, 2));
  writeFileSync(path.join(OUT, 'rendered.json'), JSON.stringify({
    canonical: result.canonical,
    events: result.events,
    eventTypes: result.eventTypes,
    finalTick: result.finalTick,
    echoEnergy: result.echoEnergy,
    playerHp: result.playerHp,
    signalRelay: result.signalRelay,
    signalManual: result.signalManual,
    signalPowered: result.signalPowered,
    signalEvidence: result.signalEvidence,
    dronesLeft: result.dronesLeft,
    projectilesLeft: result.projectilesLeft,
    lootLeft: result.lootLeft
  }, null, 2));

  expect(result.eventTypes, 'should have signal events').toContain('signal-scanned');
  expect(result.eventTypes, 'should have jam events').toContain('signal-jammed');
  expect(result.eventTypes, 'should have relay events').toContain('signal-relay-changed');
  expect(result.signalRelay, 'relay should be ACTIVE after toggle').toBe('ACTIVE');
  expect(errors, `no console/page errors: ${errors.join(' | ')}`).toHaveLength(0);
});
