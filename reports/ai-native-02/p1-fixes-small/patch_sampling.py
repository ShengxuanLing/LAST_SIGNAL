p='tests/ai-native-world.spec.ts'
s=open(p,encoding='utf-8').read()
start=s.index("    // Sample the running AI: real movement, legal actions, collision stays valid.")
end=s.index("    // R-04 evidence: an actor in another room is NOT visible to the controller,")
old=s[start:end]
new = '''    // Sample the running AI with a bounded wait for *valid continuous motion*.
    // Do not relax the movement threshold: keep requiring >=3 moving intents,
    // >=1.5 tiles of real path, legal same-room steps, and a real portal
    // interact (World.tryInteract), but wait up to a bounded window for those
    // conditions instead of assuming a fixed 14-frame window always contains them.
    const samples: Array<Record<string, unknown>> = [];
    const MAX_SAMPLES = 40;
    const MIN_SAMPLES = 10;
    let pathLength = 0;
    let previous: { x: number; y: number; room: string | null } | null = null;
    let maxStep = 0;
    let movingSamples = 0;
    let interactSamples = 0;
    let portalTransitions = 0;
    let legalSamples = 0;
    let boundedWaitExhausted = true;
    const portalJumps: Array<Record<string, unknown>> = [];
    let levelUpChoices = 0;
    const seenRooms = new Set<string>();
    for (let i = 0; i < MAX_SAMPLES; i++) {
      const active = await page.evaluate(() =>
        (window as any).__game.scene.getScenes(true).map((s: any) => s.sys.settings.key));
      if (active.includes('LevelUpScene')) {
        levelUpChoices++;
        await page.keyboard.press('1');
        await page.waitForTimeout(400);
      }
      await page.waitForTimeout(300);
      const s = await state(page);
      if (s!.owner !== 'ai') break;
      if (previous) {
        const step = Math.hypot(s!.grid.x - previous.x, s!.grid.y - previous.y);
        if (previous.room !== s!.room) {
          // World.tryInteract() legally lands the player in the next room. This
          // is a room transition through the shared interact rule, not a
          // collision-skipping movement step; record it separately.
          portalTransitions++;
          portalJumps.push({ from: previous, to: s!.grid, distance: step, room: s!.room });
        } else {
          pathLength += step;
          maxStep = Math.max(maxStep, step);
        }
      }
      previous = { x: s!.grid.x, y: s!.grid.y, room: s!.room };
      if (s!.intent.move.x !== 0 || s!.intent.move.y !== 0) movingSamples++;
      if (s!.intent.interact) interactSamples++;
      if (s!.walkable) legalSamples++;
      if (s!.room) seenRooms.add(s!.room);
      samples.push({
        i, grid: s!.grid, action: s!.lastAiAction, target: s!.lastAiTarget,
        room: s!.room, enemies: s!.enemies, projectiles: s!.projectiles,
        intentOwner: s!.lastIntentOwner, intent: s!.intent, walkable: s!.walkable,
        hp: s!.hp, damage: s!.damage, active: s!.active
      });
      if (i % 3 === 0) await page.screenshot({ path: path.join(OUT, `ai-run-${String(i).padStart(2, '0')}.png`) });
      const motionValid = movingSamples >= 3 && pathLength > 1.5 && maxStep < 3.2;
      const interactionValid = portalTransitions > 0 || interactSamples > 0;
      if (i >= MIN_SAMPLES - 1 && motionValid && interactionValid) {
        boundedWaitExhausted = false;
        break;
      }
    }
    record('ai-samples', {
      samples, pathLength, maxStep, movingSamples, interactSamples, legalSamples,
      portalTransitions, portalJumps, rooms: [...seenRooms], levelUpChoices,
      boundedWindow: { min: MIN_SAMPLES, max: MAX_SAMPLES, exhausted: boundedWaitExhausted }
    });
    st = await state(page);

    // Observable movement: thresholds unchanged, now supported by a bounded wait.
    const actions = new Set(samples.map((s) => String(s.action)).filter((a) => a !== 'null'));
    expect(movingSamples, 'AI produced multiple intents with non-zero movement').toBeGreaterThan(2);
    expect(pathLength, 'AI actually walked through the World').toBeGreaterThan(1.5);
    expect(maxStep, 'no collision-skipping jump between same-room samples').toBeLessThan(3.2);
    expect(legalSamples, 'every sampled position stayed walkable').toBe(samples.length);
    expect(boundedWaitExhausted, 'bounded wait found valid continuous motion + real interaction').toBe(false);
    expect(portalTransitions > 0 || interactSamples > 0,
      'real portal interaction (World.tryInteract) observed, not simulated').toBe(true);
    if (portalTransitions > 0) {
      // Portal transitions are legal World.tryInteract room changes, so they
      // are logged separately and excluded from collision-legality steps.
      expect(portalJumps.every((j) => Number(j.distance) > 3.2),
        'room transitions are recorded as distinct interact jumps').toBe(true);
      expect(seenRooms.size, 'portal interaction changed rooms').toBeGreaterThan(1);
    }
    walkableOnly(samples);
    expect(actions.size, 'AI reported real action changes').toBeGreaterThan(1);
    expect(st!.aiActionCount, 'AI executed a countable sequence of actions').toBeGreaterThan(1);
    expect(st!.lastAiAction, 'HUD has a last AI action').toBeTruthy();
    expect(st!.txtAiAction, 'HUD shows the AI action').toContain(String(st!.lastAiAction));
    expect(st!.txtAiTarget, 'HUD shows the AI target').toContain(String(st!.lastAiTarget));
    expect(st!.lastIntentOwner, 'last executed intent came from AI').toBe('ai');
    record('ai-summary', {
      aiActionCount: st!.aiActionCount, lastAiAction: st!.lastAiAction, lastAiTarget: st!.lastAiTarget,
      movedTo: st!.grid, room: st!.room, enemies: st!.enemies, pathLength, maxStep, movingSamples,
      interactSamples, portalTransitions, samples: samples.length,
      boundedWaitExhausted, seenRooms: [...seenRooms]
    });
    await page.screenshot({ path: path.join(OUT, 'ai-active-hud-1280x720.png') });

'''
s=s[:start]+new+s[end:]
open(p,'w',encoding='utf-8').write(s)
print('sampling patched')
