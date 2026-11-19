  test('4) rawsim restore: a restored human-local action is busy, not re-confirmable, and commits exactly once', async () => {
    // v3 behaviour contract, exercised through the FORMAL headless restore entry
    // (World.restoreCheckpoint only accepts a full RunCheckpoint and refuses to
    // capture while commands are pending, so the confirmed-but-uncommitted case
    // can only be expressed as a raw sim → HeadlessWorld.fromSimulationState).
    // No private guard field name is asserted: the public contract is
    //   echoPendingLocal = { restored: true, kind, proposalId: null }
    // plus: a new local confirm is refused, the unrelated queue is preserved,
    // and the restored action executes exactly once on a real tick.
    const world = new HeadlessWorld({ seed: 424242 });
    const roomId = world.identity.combatRoomId ?? 0;
    world.enableEcho();
    world.runSteps([{ ticks: 1, intent: neutralIntent() }]);
    const echo = world.state.echo!;
    world.enableSignalDevice({ deviceId: 'relay_main', roomId, x: echo.x, y: echo.y });
    world.runSteps([{ ticks: 1, intent: neutralIntent() }]);
    const proposal = world.proposeLocalEcho();
    expect(proposal, 'a local proposal exists before the restore').not.toBeNull();
    expect(world.confirmLocalEchoProposal(proposal!.id, true), 'the human confirm is accepted').toBe(true);
    const queuedKinds = world.state.pendingCommands.map((c) => c.type);
    expect(queuedKinds.length, 'exactly one cooperation command is queued').toBe(1);

    const restored = HeadlessWorld.fromSimulationState(world.state, [roomId]);
    const busy = restored.echoPendingLocal;
    record('restore-contract', {
      runner: 'agent (headless formal entry, no human)',
      fixtures: 'fixture: raw sim snapshot + HeadlessWorld.fromSimulationState (the documented v3 restore seam)',
      saved: { kinds: queuedKinds },
      restored: { busy, queue: restored.state.pendingCommands.map((c) => c.type) },
      contract: 'restored action is busy (unknown provenance), a new local confirm is refused, unrelated commands kept, exactly one execution'
    });
    expect(busy, 'the restored queue is marked busy').toMatchObject({ restored: true, kind: proposal!.kind, proposalId: null });
    expect(restored.proposeLocalEcho(), 'no new proposal is produced while busy').toBeNull();
    expect(restored.confirmLocalEchoProposal(proposal!.id, true), 'the saved human-local id is not executable again').toBe(false);
    expect(restored.confirmLocalEchoProposal('local_restored_other', true), 'an arbitrary new local id is refused').toBe(false);
    expect(restored.state.pendingCommands.map((c) => c.type), 'the restored queue keeps exactly the saved command').toEqual(queuedKinds);

    const events = restored.runSteps([{ ticks: 1, intent: neutralIntent() }]);
    const scans = events.filter((e): e is Extract<typeof e, { type: 'signal-scanned' }> => e.type === 'signal-scanned');
    expect(scans.length, 'the restored action executes exactly once').toBe(1);
    expect(scans[0].energy, 'the restored scan is charged the exact cost').toBe(SIGNAL_TUNING.ENERGY_MAX - SIGNAL_TUNING.SCAN_COST);
    expect(restored.state.pendingCommands, 'the queue is drained after the commit').toHaveLength(0);
    expect(restored.echoPendingLocal, 'the busy marker is cleared after the commit').toBeNull();
    expect(restored.echoAudit.recent().some((e) => e.action === 'scan' && e.result === 'applied'),
      'no fabricated human-local applied receipt is created by a restore').toBe(false);
    await shot(page, '4-restore');
  });

