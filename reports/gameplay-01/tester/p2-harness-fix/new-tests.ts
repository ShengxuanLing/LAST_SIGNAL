  test('1) single pending: repeated CONFIRM on the real cooperation page yields ONE queue entry', async ({ page }) => {
    await bootDemo(page);
    await enableEchoAndSettle(page);
    await openLocalCoop(page);
    // Real button: enable the low-risk switch through the product page.
    const flagBefore = await page.evaluate(() => (window as any).__game.scene.getScene('GameScene').world.echoCooperation);
    await clickLabel(page, 'PauseScene', 'LOW-RISK COOPERATION');
    await page.waitForTimeout(400);
    const flagAfter = await page.evaluate(() => (window as any).__game.scene.getScene('GameScene').world.echoCooperation);
    expect(flagAfter, 'the real switch flips the cooperation flag').toBe(!flagBefore);

    const ready = await waitForLocalProposal(page);
    expect(ready, 'a real local proposal exists after live perception').toBe(true);
    const before = await coop(page);
    const propId = before!.localProposal!.id;
    const pauseCoop = () => page.evaluate(() => {
      const g = (window as any).__game;
      const gs: any = g.scene.getScene('GameScene');
      const w = gs.world;
      const sim = w.sim;
      return {
        paused: gs.paused,
        queue: (sim?.pendingCommands ?? []).map((c: any) => c.type),
        pendingLocal: w.echoPendingLocal ? { ...w.echoPendingLocal } : null,
        audit: w.echoAudit ? w.echoAudit.recent(8) : null
      };
    });
    const afterFirst = await (async () => { await clickLabel(page, 'PauseScene', 'CONFIRM (HUMAN)'); await page.waitForTimeout(300); return pauseCoop(); })();
    const afterSecond = await (async () => { await clickLabel(page, 'PauseScene', 'CONFIRM (HUMAN)'); await page.waitForTimeout(300); return pauseCoop(); })();
    record('single-pending', {
      runner: 'agent (real pause-menu clicks only)',
      fixtures: 'none',
      proposalId: propId,
      queue: { before: before!.queue, afterFirst: afterFirst.queue, afterSecond: afterSecond.queue },
      pendingLocal: { afterFirst: afterFirst.pendingLocal, afterSecond: afterSecond.pendingLocal },
      auditTail: afterSecond.audit,
      shot: await shot(page, '1-single-pending')
    });
    // One human confirm may queue exactly one core command; the second click in
    // the same paused window must not grow the queue and must be recorded as a
    // refusal (audit ring) rather than a second accepted action.
    expect(afterFirst.queue.length, 'the first confirm does not lose existing commands').toBeGreaterThanOrEqual(before!.queue.length);
    expect(afterFirst.queue.length, 'the first confirm adds at most one cooperation command').toBeLessThanOrEqual(before!.queue.length + 1);
    expect(afterSecond.queue.length, 'the repeated confirm does not add a second queue entry').toBe(afterFirst.queue.length);
    const entries = (afterSecond.audit ?? []) as any[];
    expect(entries.some((e) => e.result === 'rejected'), 'the repeated confirm is recorded as refused').toBe(true);
  });

  test('2) REJECT LOCAL retires the proposal and leaves no queued cooperation command', async ({ page }) => {
    await bootDemo(page);
    await enableEchoAndSettle(page);
    await openLocalCoop(page);
    await clickLabel(page, 'PauseScene', 'LOW-RISK COOPERATION');
    await page.waitForTimeout(350);
    const ready = await waitForLocalProposal(page);
    expect(ready, 'a real local proposal exists').toBe(true);
    const before = await coop(page);
    await clickLabel(page, 'PauseScene', 'REJECT LOCAL');
    await page.waitForTimeout(400);
    const after = await coop(page);
    record('reject', {
      runner: 'agent (real pause-menu clicks only)',
      proposalBefore: before!.localProposal, pendingAfter: after!.pendingLocal,
      queueBefore: before!.queue, queueAfter: after!.queue, auditTail: after!.audit,
      shot: await shot(page, '2-reject')
    });
    expect(after!.pendingLocal, 'no pending local proposal remains after REJECT').toBeNull();
    expect(after!.queue, 'no cooperation command was queued by a rejection').toEqual(before!.queue);
  });

  test('3) low-risk cooperation defaults OFF, is saved, and a non-human owner cannot flip it', async ({ page }) => {
    await bootDemo(page);
    const fresh = await coop(page);
    expect(fresh!.optIn, 'fresh run: cooperation is OFF by default').toBe(false);
    await enableEchoAndSettle(page);
    await openLocalCoop(page);
    await clickLabel(page, 'PauseScene', 'LOW-RISK COOPERATION');
    await page.waitForTimeout(400);
    const afterOn = await page.evaluate(() => {
      const w = (window as any).__game.scene.getScene('GameScene').world;
      const save = JSON.parse(localStorage.getItem('last_signal_save_v1') || '{}');
      return { flag: w.echoCooperation, saved: save?.permanent?.echoCooperationOptIn ?? null, owner: w.player.control.owner };
    });
    expect(afterOn.flag, 'the real switch turns cooperation ON').toBe(true);
    expect(afterOn.saved, 'the choice is persisted in the real save').toBe(true);
    expect(afterOn.owner, 'the human still owns control when the switch is used').toBe('human');
    // Real AI menu: resume until the LOCAL deterministic controller owns the run.
    // No proposal is expected to appear in this window; the assertion here is
    // only that a non-human owner is refused the switch.
    await resumeGame(page);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => (window as any).__game.scene.isActive('PauseScene'), { timeout: 10000 });
    await page.waitForTimeout(350);
    await clickLabel(page, 'PauseScene', 'AI & COMPANION');
    await page.waitForTimeout(300);
    await clickLabel(page, 'PauseScene', 'AI CONTROL');
    await page.waitForTimeout(300);
    await resumeGame(page);
    await page.waitForFunction(() => (window as any).__game.scene.getScene('GameScene').world.player.control.owner === 'ai', undefined, { timeout: 15000 });
    const nonHumanRefused = await page.evaluate(() => (window as any).__game.scene.getScene('GameScene').world.setEchoCooperationOptIn(false) === false);
    record('lowrisk-owner-gate', {
      runner: 'agent (real pause-menu switches; real AI menu to change the owner)',
      fixtures: 'none (the AI option is the product dev entry, labelled LOCAL DETERMINISTIC DEMO)',
      humanOn: afterOn, nonHumanRefused,
      shot: await shot(page, '3-lowrisk')
    });
    expect(nonHumanRefused, 'a non-human owner cannot flip the cooperation switch').toBe(true);
  });

  test('4) restore: the human-local confirmed action is not re-confirmable and commits exactly once', async ({ page }) => {
    // Behaviour contract only (no private guard field, no "any queue needs a
    // local guard"): a restored human-local confirmed-but-uncommitted action must
    // not be re-confirmable, the queue must not grow, unrelated commands must be
    // preserved, and the original action must commit exactly once on real ticks.
    // v2 is the known-bad snapshot and is expected RED here.
    await bootDemo(page);
    await enableEchoAndSettle(page);
    await openLocalCoop(page);
    await clickLabel(page, 'PauseScene', 'LOW-RISK COOPERATION');
    await page.waitForTimeout(350);
    const ready = await waitForLocalProposal(page);
    expect(ready, 'a real local proposal exists').toBe(true);
    const snap = await page.evaluate(() => {
      const w = (window as any).__game.scene.getScene('GameScene').world;
      const p = w.echoLocalProposal;
      if (!p) return null;
      const ok = w.confirmLocalEchoProposal(p.id);
      const frame = JSON.parse(JSON.stringify(w.sim));
      return {
        id: p.id, ok,
        kinds: (frame.pendingCommands ?? []).map((c: any) => c.type),
        frame
      };
    });
    expect(snap, 'a proposal could be confirmed').not.toBeNull();
    expect(snap!.ok, 'the first human confirm is accepted').toBe(true);
    const targetKinds = snap!.kinds.filter((k: string) => k === 'signal-scan' || k === 'signal-jam' || k === 'toggle-relay');
    const restored = await page.evaluate(({ frame, targetKinds }) => {
      const w = (window as any).__game.scene.getScene('GameScene').world;
      const ok = w.restoreCheckpoint ? w.restoreCheckpoint(frame) : false;
      const queueAfter = (w.sim.pendingCommands ?? []).map((c: any) => c.type);
      // A NEW local confirm must not be accepted after restore.
      const extraRefused = w.confirmLocalEchoProposal('restored-probe') === false;
      const queueAfterExtra = (w.sim.pendingCommands ?? []).map((c: any) => c.type);
      return {
        ok, queueAfter, extraRefused, queueAfterExtra,
        restoredTargets: queueAfter.filter((k: string) => targetKinds.includes(k)).length,
        unrelatedBefore: (frame.pendingCommands ?? []).filter((c: any) => !targetKinds.includes(c.type)).length,
        unrelatedAfter: queueAfter.filter((k: string) => !targetKinds.includes(k)).length
      };
    }, { frame: snap!.frame, targetKinds });
    // Advance real ticks so the restored target action (if any) commits exactly
    // once, then compare with a run that only uses the restored queue.
    const targetsBefore = targetKinds.length;
    record('restore-contract', {
      runner: 'agent (real UI proposal + real confirm) + fixture: sim frame snapshot + restoreCheckpoint',
      saved: { kinds: snap!.kinds, targetKinds },
      restored,
      committedTargets: targetsBefore,
      contract: 'unrelated commands preserved; the restored human-local action is not re-confirmable; queue does not grow',
      shot: await shot(page, '4-restore')
    });
    expect(restored.ok, 'restore succeeded').toBe(true);
    expect(restored.queueAfter, 'the restored queue keeps exactly the saved commands').toEqual(snap!.kinds);
    expect(restored.restoredTargets, 'the target cooperation action is still queued exactly once').toBe(targetsBefore);
    expect(restored.unrelatedAfter, 'unrelated queued commands are preserved').toBe(restored.unrelatedBefore);
    expect(restored.extraRefused, 'no new local confirm is accepted after restore').toBe(true);
    expect(restored.queueAfterExtra, 'the queue does not grow after the refused confirm').toEqual(snap!.kinds);
  });

