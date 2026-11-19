# P1 test 4 — P4 layout adaptation (prepared, NOT applied)

Status: **prepared only.** Applied to the *new P4 tree* when its manifest is frozen. The P3
clone and the current `tests/gameplay-01.spec.ts` stay untouched; the pre-P4 source is
archived with its hash (`P1_TEST4_ARCHIVE.txt`, sha256 `3b45b843…`), so this is a documented
product-layout change — **not** deleting an assertion to make a run green.

## Why it changes

The reviewer's pre-review (§8/M4) measured the new authored layout: relay↔portal is
1.00–2.24 tiles on every seed, so the door is *inside* `JAM_RANGE` (6) by construction, with
the core's own LOS sampling clear. The old assertion encoded the previous (far-relay)
placement:

```ts
expect(atDoor.distanceRelayDoor, 'authored door is farther than JAM_RANGE from the relay')
  .toBeGreaterThan(TUNE.JAM_RANGE);            // ← obsolete under the P4 layout
```

and the block that followed used a labelled `setPlayerPositionForTest` teleport to reach the
relay. Both disappear; the natural door *is* the jam spot now.

## Replacement (exact)

```ts
// The authored door is inside JAM_RANGE by construction (P4 layout), and the core's
// own LOS sampling clears the door→relay line: the door is naturally jam-usable.
expect(atDoor.distanceRelayDoor, 'authored door is inside JAM_RANGE (natural door layout)')
  .toBeLessThanOrEqual(TUNE.JAM_RANGE);
expect(atDoor.distanceRelayPlayer, 'the player standing on the door is also in range')
  .toBeLessThanOrEqual(TUNE.JAM_RANGE);

// --- natural jam from the real door position: no teleport, no fixture ---
const beforeJam = { energy: atDoor.energy, relay: atDoor.relayState };
await tapKey(page, 'KeyY');                    // real key: down -> real frame -> up
await page.waitForTimeout(500);
const jammed = await page.evaluate(() => {
  const w = (window as any).__game.scene.getScene('GameScene').world;
  const sig = w.signalView();
  return {
    relay: sig?.relay ?? null,
    energy: sig?.playerEnergy ?? null,
    portal: w.portal ? { target: w.portal.targetRoom } : null,
    routeTarget: w.p1RouteTarget ?? null,
    room: w.currentRoom()?.id ?? null
  };
});
expect(jammed.relay, 'a legal jam from the door is committed by the core').toBe('JAMMED');
expect(jammed.energy, 'the jam costs the real price').toBe(beforeJam.energy! - TUNE.JAM_COST);
expect(jammed.portal, 'a JAMMED relay leaves no route portal').toBeNull();
expect(jammed.routeTarget, 'a JAMMED relay has no selectable route').toBeNull();

// --- the safety property the old block proved, now reached naturally ---
await tapKey(page, 'KeyF');
await page.waitForTimeout(700);
const afterF = await page.evaluate(() => {
  const w = (window as any).__game.scene.getScene('GameScene').world;
  return { room: w.currentRoom()?.id ?? null };
});
expect(afterF.room, 'F at the door while JAMMED does not change rooms').toBe(jammed.room);

// --- expiry restores a selectable route, again without any fixture ---
await page.waitForFunction(() => {
  const w = (window as any).__game.scene.getScene('GameScene').world;
  return (w.signalView()?.relay ?? '') !== 'JAMMED';
}, undefined, { timeout: 60000 });
const recovered = await page.evaluate(() => {
  const w = (window as any).__game.scene.getScene('GameScene').world;
  const sig = w.signalView();
  return { relay: sig?.relay ?? null, portal: w.portal ? { target: w.portal.targetRoom } : null, routeTarget: w.p1RouteTarget ?? null };
});
expect(recovered.relay, 'the relay recovers after the jam expires').not.toBe('JAMMED');
expect(recovered.portal, 'the route portal is selectable again after expiry').not.toBeNull();
```

## What is kept verbatim (safety assertions — do not weaken)

- The rejected-jam case stays: a jam fired from outside range spends no energy and leaves the
  relay `ACTIVE`. With the new layout that attempt must come from a real position *outside*
  range (walk away first, e.g. 8+ tiles), otherwise the "rejected" branch is unreachable —
  it is rewritten as "walk out of range → real Y → nothing spent", not deleted.
- `F` at a JAMMED door does not change rooms, no route target, no portal.

## Input-driver note

Single-frame edges (`Y`, `F`) use the natural `keydown → at least one real frame → keyup`
(`tapKey`) instead of Phaser `press()`, which can lose `JustDown` at a frame boundary. This is
an input-driver fix; **no result threshold is relaxed**, and an unreproduced failure is never
relabelled "pre-existing flaky".

## Apply order (once the P4 manifest is frozen)

1. Pin the manifest and archive each source hash.
2. Replace the block above in `tests/gameplay-01.spec.ts` (P4 tree only).
3. Run the full P1 spec unfiltered; archive spec + log + hashes.
4. Run `tests/gameplay-04-coop-level.spec.ts` (prepared here) unfiltered.
5. Report PASS/FAIL/NOT RUN per check with absolute log paths.
