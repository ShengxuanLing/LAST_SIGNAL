// AI-NATIVE-02 Task C — Rendered→Headless Signal parity export.
//
// Runs a REAL rendered Phaser instance with signal actions (scan/jam/toggle),
// exports initial state + ordered player/echo/signal inputs + canonical+events
// to reports/ai-native-02/signal/parity/. A companion vitest replays the same
// inputs in HeadlessWorld and compares canonical+events byte-by-byte.
//
// This is the actual rendered instance (not two Node same-seed runs).
// Includes scan/jam/TTL/relay, echo accounts, real damage/loot.

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
    const room = w.currentRoom();
    const neutral = { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false };
    const sequence: Array<{ kind: string; ticks?: number; intent?: any; signalCommand?: any; x?: number; y?: number; deviceId?: string; roomId?: number; type?: string; actor?: string; enabled?: boolean; powered?: boolean }> = [];
    const events: any[] = [];
    w.resetSimulationAccumulator();
    const runStep = (intent: any): void => {
      sequence.push({ kind: 'step', ticks: 1, intent });
      events.push(...w.stepFrame(1000 / 60 + 1e-6, intent));
    };
    // initial is taken BEFORE any mutation so HeadlessWorld can rebuild from it.
    const initial = JSON.parse(JSON.stringify(w.sim));
    // 0) Enable echo in HOLD mode so it does not move under AI control
    // (which would produce echo-moved events that the Node replay cannot
    // reproduce without echoIntent). Recorded in sequence for Headless replay.
    w.enableEcho();
    w.setEchoMode('hold');
    sequence.push({ kind: 'enableEcho', x: w.player.wx + 1, y: w.player.wy });
    sequence.push({ kind: 'setEchoMode', mode: 'hold' });
    runStep(neutral);
    // 1) Spawn the signal device beside the echo (recorded in sequence).
    const echo = w.sim.echo;
    if (echo && !w.sim.signal) {
      (w as any)._sim.pendingCommands.push({
        type: 'spawn-signal-device',
        deviceId: 'relay_main',
        roomId: room?.id ?? 0,
        x: echo.x + 0.5,
        y: echo.y
      });
      sequence.push({ kind: 'enableSignalDevice', deviceId: 'relay_main', roomId: room?.id ?? 0, x: echo.x + 0.5, y: echo.y });
      runStep(neutral);
    }
    // 2) Echo scan: costs echo energy, records evidence.
    if (echo && w.sim.signal) {
      sequence.push({ kind: 'signalCommand', type: 'signal-scan', actor: 'echo' });
      (w as any).enqueueSignalCommand({ type: 'signal-scan', actor: 'echo' });
      runStep(neutral);
    }
    // 3) Player jam: suppresses emission.
    if (w.sim.signal) {
      sequence.push({ kind: 'signalCommand', type: 'signal-jam', actor: 'player' });
      (w as any).enqueueSignalCommand({ type: 'signal-jam', actor: 'player' });
      runStep(neutral);
    }
    // 4) Toggle relay → ACTIVE.
    if (w.sim.signal) {
      sequence.push({ kind: 'signalCommand', type: 'toggle-relay', enabled: true });
      (w as any).enqueueSignalCommand({ type: 'toggle-relay', enabled: true });
      runStep(neutral);
    }
    // 5) Advance ticks for jam expiry + regen.
    for (let i = 0; i < 370; i += 1) {
      runStep(neutral);
    }
    // 6) Real damage: fire to generate enemy-hit events.
    const target = w.sim.echo;
    if (target) {
      for (let i = 0; i < 5; i += 1) {
        const fireIntent = { ...neutral, fire: true, aim: { x: target.x, y: target.y } };
        sequence.push({ kind: 'step', ticks: 1, intent: fireIntent });
        events.push(...w.stepFrame(1000 / 60 + 1e-6, fireIntent));
        runStep(neutral);
      }
    }
    const state = w.sim;
    const core = await import('/src/world/sim/core.ts');
    return {
      initial,
      sequence,
      canonical: core.canonicalSimulationState(state),
      events: core.canonicalSimulationEvents(events),
      eventTypes: [...new Set(events.map((e: any) => e.type))],
      finalTick: state.tick,
      echoEnergy: state.signal ? state.signal.actors.echo.energy.energy : -1,
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
