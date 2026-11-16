# C2 Regression Closure — Report

## Commits (branch `feat/ai-native-world-integration`, not merged/pushed)
- `c2b0215` — product fixes A–D + test/parity sync
- `6eb2ba0` — purchase ledger hard quota + canonical/checkpoint persistence
- `3a28d4f` — bounded CLI cold-start budget + process reap

Parent base: `59aa852` (docs) / `3f97990` (purchase transaction code).

## Authoritative triage
Followed `reports/ai-native-02/tester/c2-current-triage/C2-CURRENT-TRIAGE.md`
(target 59aa852): 3 of the 5 failures were one product bug (upgrade level not
recorded), 1 was stale inventory UI, 1 was room-cleared-before-enemies + fixture;
plus two independently found bugs (loot magnet units, checkpoint save window).

## A — upgrade level recorded (3 failures)
`core.processCommands` `apply-upgrade` applied the effect but never wrote
`player.data.upgrades`. Fixed to apply once and atomically record `{key, level}`
(update existing progress or push). Committed state and saved checkpoints now
match. Original assertions in `audit:65`, `checkpoint:152`, `checkpoint:197` are
preserved unchanged.

## B — room only cleared after its generation commits
`onEnterRoom`/`spawnBoss` previously set `r.spawned = true` while the generation
command/spawn was still queued, so `updateRoom()` cleared the room (and the
economy paid the clear reward) before any enemy existed. Now rooms enter
`pendingRoomEnters`; `r.spawned` is set when `room-generated` (or `spawnBoss`)
actually commits, and `updateRoom()` requires `spawned && !pendingRoomEnters`.
Also restored C1 resource-loot eligibility (`roomResourceCount` only for
resource/shop rooms, previously the start/combat rooms wrongly dropped loot).
`hasPendingSpawns()`/`hasUncommittedCommands()` include pending generation.
The economy test now clears the room's core enemies before expecting a reward
(real clear, no premature payout).

## C — inventory equip UI follows the commit
Equip is queued and commits on the resume tick (overlay pauses the sim). Added
`World.getPendingEquipWeapon()` (read-only), `PauseScene.update()` refresh keyed
on `weaponKey|pending`, `QUEUED` pending label, and `GameScene.onResume()` runs
one normal tick to commit overlay commands. No hidden flush; the test keeps its
`EQUIPPED` assertion and uses a legal tick after number-key switches.

## D — loot magnet units (pixels -> tiles)
`core.stepLoot` compared `pickupRange` (pixels, 90) against grid-tile distances,
making a 90-tile vacuum. Now `pickupRadius = pickupRange / GAME.PIXEL_TO_TILE`
(1.4 tiles); pickup threshold stays C1 `PLAYER_RADIUS + 12`. Verified in normal
running: loot at 20/40/85 tiles stays for 120+ ticks; near loot collects; a
larger `pickupRange` reaches farther. `B11`, the Node loot-parity script and a
new Node unit test (B25) all assert the corrected contract.

## E — checkpoint save barrier (from 1d5a8d7; kept)
`captureCheckpoint` still refuses while uncommitted work exists; callers retry
after a normal tick. `onResume`/create commit via real ticks; uncommitted
purchases are discarded on exit and the last checkpoint is kept. No flush.

## Purchase ledger (separate commit 6eb2ba0)
Reviewer blockers (FIFO-256 eviction replay; ledger absent from canonical/
checkpoint) fixed with a minimal hard quota:
- `PURCHASE_LEDGER_CAP = 64`: at the cap new transactions are atomically
  rejected (`Supply ledger full`); existing ids are never evicted.
- Each processed id (success or rejection) consumes capacity once; repeats are
  stable duplicates and never overwrite the record/resources.
- `purchaseTransactions` is in `canonicalSimulationState` and the optional
  `coreState` checkpoint field; restore deep-copies and preserves it (legacy
  checkpoints without it load as empty); `RunCheckpoint` validates bounded
  length, well-formed ids, uniqueness (tampered/oversized rejected).
- World receipts are a bounded UI cache, not authority. No SAVE_VERSION/key
  change; new run starts empty; same-run restore does not reset the ledger.
- Tests: 6 ledger unit tests, static contract asserts, `tests/purchase-ledger.spec.ts`
  (rendered purchase, same-run replay, reload restore replay), corrected
  Reviewer-style probe.

## CLI cold-start (3a28d4f)
`CliChannel.next` now has a bounded 15s protocol-readiness budget and kills/
reaps its own child on timeout; restore test wraps in try/finally + `close()`;
both real-CLI tests set a bounded 20s per-test timeout (no global relaxation).
Verified with 6 independent cold starts (3 restore + 3 quit), each ~4.5–4.7s.

## Test contract changes (explicit)
| Test | Before | After | Why legal |
|------|--------|-------|-----------|
| audit.spec loot probe | relied on 90-tile vacuum to collect +18 loot | sets a wide (40-tile) `pickupRange` fixture for the probe | preserves "visible then collected" intent with correct units |
| checkpoint.spec inventory | expected EQUIPPED with no tick after number-key switch | adds `commitTick()` after `3`/`2` | overlay pauses sim; equip commits on a normal tick |
| economy.spec | expected clear reward without killing enemies; old snapshot purchase + storage rollback | kills room's core enemies; purchases via close→commit→receipt, keeping all currency math (82+reward−16−40−28) | room is only cleared after real kill; purchase contract is atomic command + receipt |
| c2-parity B11 | 20-tile magnet collection | 20/40/85 stay 120+ ticks; near collects; large-range positive | corrected pixel→tile magnet contract |

## Gates (see logs/gate.log)
typecheck PASS · unit 429/429 PASS · build PASS · MCP build PASS ·
full E2E 49/49 PASS (five viewports included) · room/node/kill/loot parity PASS ·
purchase-ledger probe PASS · CLI 6/6 independent cold starts PASS.

Previously failing E2E now pass: `audit:65`, `checkpoint:71/152/197`,
`economy:11` (plus new `purchase-ledger` and `supply-transaction`).

## Limits
- Base is not merged/pushed; stash untouched; C3b still frozen.
- Re-run the five-viewport HUD tuple only within the full E2E (all five passed).
- The purchase ledger cap is a hard 64; exceeding it rejects new purchases by
  design (UI shows the real reason).
