// P3-a fix — checkpoint restore must never re-arm echo assist or heal it.
//
// Fixture disclosure: the spec prepares a legal cleared-room checkpoint with
// owner/dev facades and restores it through the real World path. Echo HP,
// controller policy and old-save compatibility are all real state.

import { expect, test } from '@playwright/test';

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

test('restore clears echo assist/memory/intent, keeps HP, and old saves need new confirmation', async ({ page }) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await bootRun(page);

  const prepared = await page.evaluate(() => {
    const gs: any = (window as any).__game.scene.getScene('GameScene');
    const w = gs.world;
    const neutral = { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false };
    w.clearEnemiesForTest();
    w.enableEcho();
    w.stepFrame(1000 / 60 + 1e-6, neutral); // commit spawn-echo
    // Arm assist, hold mode, seed bounded memory and a non-neutral intent.
    w.setEchoMode('hold');
    w.confirmEchoAssist();
    w.echoController.observe(w.echoView()!);
    w.echoController.decide(w.echoView()!);
    w.simFixture.echo!.data.hp = 42;
    w.simFixture.player.data.hp = 55;
    // Legal cleared-room checkpoint: boss rooms stay outside the cleared set
    // (the real restoreCheckpoint rejects them).
    for (const r of w.map.rooms) {
      if (r.kind === 'boss') continue;
      r.cleared = true;
      r.spawned = true;
    }
    const frame = w.captureCheckpoint('p3a-restore', 424242, { kills: 0, items: 0, damage: 0, elapsedSeconds: 0 });
    if (frame) frame.portalTarget = null; // deterministic fixture for the restore predicate
    return {
      frame,
      armedBefore: w.echoAssistArmed,
      memoryBefore: w.echoController.memory.length,
      modeBefore: w.echoMode,
      echoHpBefore: w.echoActor!.data.hp,
      playerHpBefore: w.simFixture.player.data.hp
    };
  });

  expect(prepared.frame, 'a real cleared-room checkpoint was captured').not.toBeNull();
  expect(prepared.armedBefore).toBe(true);
  expect(prepared.modeBefore).toBe('hold');
  expect(prepared.echoHpBefore).toBe(42);

  const restored = await page.evaluate((frame) => {
    const gs: any = (window as any).__game.scene.getScene('GameScene');
    const w = gs.world;
    const ok = w.restoreCheckpoint(frame);
    const echo = w.echoActor;
    const c = w.echoController;
    // Capture the reset state BEFORE any new observation/decision.
    const cleared = {
      assist: w.echoAssistArmed,
      mode: w.echoMode,
      memory: c.memory.length,
      suggestion: c.suggestion,
      lastIntent: { ...c.lastIntent, move: { ...c.lastIntent.move } },
      echoHp: echo?.data.hp ?? null,
      playerHp: w.simFixture.player.data.hp
    };
    // A real drone is visible to the echo, but must NOT be fired at.
    const room = w.currentRoom();
    if (echo) w.spawnEnemy('drone', echo.x + 1, echo.y, room?.id ?? 0, 1);
    const view = w.echoView();
    const intent = view ? c.decide(view) : null;
    return {
      ok, ...cleared,
      intentFire: intent?.fire ?? null,
      shots: w.echoShotsFired
    };
  }, prepared.frame);

  expect(restored.ok, 'restore succeeded').toBe(true);
  expect(restored.assist, 'old assist confirmation was revoked').toBe(false);
  expect(restored.mode, 'restore falls back to follow').toBe('follow');
  expect(restored.memory, 'old memory was cleared').toBe(0);
  expect(restored.suggestion).toBeNull();
  expect(restored.lastIntent.move).toEqual({ x: 0, y: 0 });
  expect(restored.echoHp, 'echo HP came from the checkpoint, no free heal').toBe(42);
  expect(restored.playerHp, 'player HP came from the checkpoint').toBe(prepared.playerHpBefore);
  expect(restored.intentFire, 'no fire without a NEW owner confirmation').toBe(false);
  expect(restored.shots).toBe(0);

  // Old save (no echo field) -> restore -> enable again: still no assist.
  const oldSave = await page.evaluate((frame) => {
    const gs: any = (window as any).__game.scene.getScene('GameScene');
    const w = gs.world;
    const legacy = JSON.parse(JSON.stringify(frame));
    delete legacy.coreState.echo;
    const ok = w.restoreCheckpoint(legacy);
    const noEcho = w.echoActor === null;
    w.enableEcho();
    const neutral = { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false };
    w.stepFrame(1000 / 60 + 1e-6, neutral);
    const view = w.echoView();
    const intent = view ? w.echoController.decide(view) : null;
    return {
      ok, noEcho,
      assist: w.echoAssistArmed,
      echoHp: w.echoActor?.data.hp ?? null,
      intentFire: intent?.fire ?? null,
      shots: w.echoShotsFired
    };
  }, prepared.frame);

  expect(oldSave.ok).toBe(true);
  expect(oldSave.noEcho, 'old save restored without an echo actor').toBe(true);
  expect(oldSave.echoHp, 'a newly enabled echo starts at base HP').toBe(100);
  expect(oldSave.assist, 'old save cannot inherit an assist confirmation').toBe(false);
  expect(oldSave.intentFire).toBe(false);
  expect(oldSave.shots).toBe(0);

  // Mode switch / reset clear commands too.
  const lifecycle = await page.evaluate(() => {
    const gs: any = (window as any).__game.scene.getScene('GameScene');
    const w = gs.world;
    w.confirmEchoAssist();
    w.echoController.observe(w.echoView()!);
    const armed = w.echoAssistArmed;
    w.setEchoMode('hold');
    const afterMode = w.echoAssistArmed;
    w.confirmEchoAssist();
    w.reset();
    return { armed, afterMode, afterReset: w.echoAssistArmed, modeAfterReset: w.echoMode };
  });
  expect(lifecycle.armed).toBe(true);
  expect(lifecycle.afterMode, 'mode switch revokes assist').toBe(false);
  expect(lifecycle.afterReset, 'restart revokes assist').toBe(false);
  expect(lifecycle.modeAfterReset).toBe('follow');

  expect(errors, `no console/page errors: ${errors.join(' | ')}`).toHaveLength(0);
});
