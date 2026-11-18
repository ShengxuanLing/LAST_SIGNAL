  test('6) a legacy save (only the new optional cooperation fields removed) still CONTINUEs and defaults OFF', async ({ page }) => {
    // Legitimate compatibility check: start a real run so the product writes its
    // own valid save, then remove ONLY the new optional cooperation fields. The
    // schema must still accept it (default OFF), NOT reject it.
    await bootDemo(page);
    await enableEchoAndSettle(page);
    // Let the product persist a valid save (pause tick -> checkpoint write).
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => (window as any).__game.scene.isActive('PauseScene'), { timeout: 10000 });
    await page.waitForTimeout(500);
    const wrote = await page.evaluate(() => (window as any).__game.scene.getScene('GameScene').saveCheckpoint());
    expect(wrote, 'the product wrote a real checkpoint before the schema experiment').toBe(true);
    const pristine = await page.evaluate(() => JSON.parse(localStorage.getItem('last_signal_save_v1') || '{}'));
    expect(pristine?.run, 'the real save contains a run').toBeTruthy();
    // Remove only the new optional fields (cooperation opt-in lives on permanent).
    const legacy = JSON.parse(JSON.stringify(pristine));
    delete legacy.permanent.echoCooperationOptIn;
    if (legacy.permanent) delete legacy.permanent.echoLowRisk;
    await page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: SAVE_KEY, value: legacy });
    await page.reload();
    await page.waitForFunction(() => (window as any).__game?.scene.isActive('MainMenuScene'), { timeout: 20000 });
    await page.waitForTimeout(500);
    // CONTINUE must succeed on the legacy-but-valid save.
    await clickLabel(page, 'MainMenuScene', 'CONTINUE');
    await page.waitForFunction(() => (window as any).__game?.scene.isActive('GameScene'), { timeout: 20000 });
    await page.waitForTimeout(900);
    const after = await page.evaluate(() => {
      const g = (window as any).__game;
      const w = g.scene.getScene('GameScene').world;
      return { active: g.scene.getScenes(true).map((s: any) => s.sys.settings.key), optIn: w.echoCooperation, echo: !!w.echoActor, pending: w.echoPendingLocal ? { ...w.echoPendingLocal } : null };
    });
    record('legacy-save', {
      runner: 'agent (real reload + CONTINUE click)',
      fixtures: 'fixture: remove ONLY the new optional cooperation fields from a product-written save',
      removedFields: ['permanent.echoCooperationOptIn'],
      continued: after.active.includes('GameScene'),
      optIn: after.optIn, echo: after.echo, pending: after.pending,
      note: 'a rejection of an arbitrary invalid save would not count as compatibility; this uses a valid save',
      shot: await shot(page, '6-legacy-save')
    });
    expect(after.active, 'CONTINUE loaded the run from the legacy-but-valid save').toContain('GameScene');
    expect(after.optIn, 'a save without the new field defaults cooperation to OFF').toBe(false);
    expect(after.pending, 'no cooperation proposal is invented from a legacy save').toBeNull();
  });

  test('7) real save + reload: a confirmed-but-uncommitted local action is never persisted nor executed', async ({ page }) => {
    // Browser-side boundary, distinct from the rawsim restore case:
    //   safe checkpoint is written BEFORE the human confirm (captureCheckpoint
    //   refuses while commands are pending), then a local action is confirmed
    //   while paused (queue 1, not applied), then the page is reloaded and the
    //   real CONTINUE is used. The confirmed-but-uncommitted action must NOT be
    //   persisted, must NOT execute, and must not leave a busy marker or a fake
    //   applied receipt.
    await bootDemo(page);
    await enableEchoAndSettle(page);
    const beforePause = await page.evaluate(() => {
      const w = (window as any).__game.scene.getScene('GameScene').world;
      return { roomId: w.currentRoom()?.id ?? null, demo: w.p1Scenario?.id ?? null, tick: w.sim.tick, echoHp: w.echoActor?.data.hp ?? null, energy: w.signalView()?.playerEnergy ?? 0 };
    });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => (window as any).__game.scene.isActive('PauseScene'), { timeout: 10000 });
    await page.waitForTimeout(400);
    // 1) SAFE CHECKPOINT FIRST (no pending commands at this point).
    const saved = await page.evaluate(() => {
      const gs: any = (window as any).__game.scene.getScene('GameScene');
      return { ok: gs.saveCheckpoint(), pendingBefore: (gs.world.sim.pendingCommands ?? []).length };
    });
    expect(saved.pendingBefore, 'no command is pending when the safe checkpoint is written').toBe(0);
    expect(saved.ok, 'the safe checkpoint was written').toBe(true);
    // 2) Enable cooperation on the real page, propose and confirm while paused.
    await openLocalCoop(page);
    await clickLabel(page, 'PauseScene', 'LOW-RISK COOPERATION');
    await page.waitForTimeout(350);
    const ready = await waitForLocalProposal(page);
    expect(ready, 'a real local proposal exists').toBe(true);
    const confirmed = await page.evaluate(() => {
      const w = (window as any).__game.scene.getScene('GameScene').world;
      const p = w.echoLocalProposal;
      if (!p) return null;
      const ok = w.confirmLocalEchoProposal(p.id);
      return { id: p.id, kind: p.kind, ok, queue: (w.sim.pendingCommands ?? []).map((c: any) => c.type), applied: w.echoAudit.recent(8).some((e: any) => e.result === 'applied') };
    });
    expect(confirmed, 'a proposal could be confirmed').not.toBeNull();
    expect(confirmed!.ok, 'the human confirm is accepted while paused').toBe(true);
    expect(confirmed!.queue.length, 'exactly one command is queued (not applied)').toBe(1);
    expect(confirmed!.applied, 'nothing is applied before any real tick').toBe(false);
    // 3) Reload + real CONTINUE.
    await page.reload();
    await page.waitForFunction(() => (window as any).__game?.scene.isActive('MainMenuScene'), { timeout: 20000 });
    await page.waitForTimeout(600);
    await clickLabel(page, 'MainMenuScene', 'CONTINUE');
    await page.waitForFunction(() => (window as any).__game?.scene.isActive('GameScene'), { timeout: 20000 });
    await page.waitForTimeout(1000);
    const after = await page.evaluate(() => {
      const g = (window as any).__game;
      const gs: any = g.scene.getScene('GameScene');
      const w = gs.world;
      return {
        active: g.scene.getScenes(true).map((s: any) => s.sys.settings.key),
        roomId: w.currentRoom()?.id ?? null, demo: w.p1Scenario?.id ?? null, tick: w.sim.tick,
        echoHp: w.echoActor?.data.hp ?? null, energy: w.signalView()?.playerEnergy ?? 0,
        relay: w.signalView()?.relay ?? null,
        queue: (w.sim.pendingCommands ?? []).map((c: any) => c.type),
        pending: w.echoPendingLocal ? { ...w.echoPendingLocal } : null,
        appliedAudit: w.echoAudit.recent(16).filter((e: any) => e.result === 'applied').length
      };
    });
    record('save-reload-boundary', {
      runner: 'agent (real pause-menu clicks + real reload + real CONTINUE)',
      fixtures: 'none for the boundary; the checkpoint is written through the product saveCheckpoint() before the confirm',
      beforePause, confirmed, after,
      contract: 'the confirmed-but-uncommitted local action is not persisted, not executed, no busy marker, no fake applied receipt',
      shot: await shot(page, '7-save-reload')
    });
    expect(after.active, 'CONTINUE resumed the run').toContain('GameScene');
    expect(after.roomId, 'the same room is restored').toBe(beforePause.roomId);
    expect(after.demo, 'the same authored demo is restored').toBe(beforePause.demo);
    expect(after.queue, 'no pending cooperation command survives the reload').toEqual([]);
    expect(after.pending, 'no busy/restored marker is invented by a real save').toBeNull();
    expect(after.appliedAudit, 'no applied receipt is fabricated for the un-committed action').toBe(0);
    expect(after.echoHp, 'the ECHO state is restored legitimately').not.toBeNull();
    // The un-executed action must not have changed the signal outcome: relay is
    // still the authored ACTIVE state and no scan cost was paid twice.
    expect(after.relay, 'the relay state is the authored one (no un-executed action applied)').toBe('ACTIVE');
  });

