# C2 Resume Fix — Report

## Commit
Branch `feat/ai-native-world-integration` (not merged/pushed; stash untouched; C3b frozen).

## Blocker (from Reviewer ae72a67)
`GameScene.onResume()` forced `world.stepFrame(1000/60 + 1e-6, neutral)` on every
overlay close, advancing a full tick (enemies/projectiles/timers) regardless of
the real frame delta. `onLevelUpClosed()` had the same pattern.

## Fix
- `onResume()` no longer calls `stepFrame`. It only: `paused = false`,
  `control.resume()`, `clearHeldInput()`, `fireHeld = false`,
  `resetSimulationAccumulator()`, `refreshHud()`, and saves if `checkpointDirty`.
  Queued equip/upgrade/purchase stay pending (UI shows `QUEUED`) until a real
  `update(delta)` accumulates a full tick, then commit exactly once.
- `onLevelUpClosed()` no longer forces a tick; queued upgrade commits on the
  next real frame tick.
- The create-time initial tick (`GameScene.create`, line ~128) is unchanged; it
  is the accepted initialisation commit, not a resume path.

## Permanent regression — `tests/resume-no-step.spec.ts` (new)
1. Real `onPause()` → enqueue currency+heal → real `onResume()`: asserts
   tick/HP/currency/enemies/projectiles/timers are byte-identical after resume;
   a sub-tick `update(0, 5)` commits nothing; `update(0, 20)` advances exactly one
   tick and commits the queued commands once. Then real RAF (80ms) advances the
   tick (not permanently paused).
2. Real `LevelUpScene.choose()` + real `onLevelUpClosed()`: no advance on choose
   or close; sub-tick no commit; one full tick records the upgrade exactly once.
3. Real inventory open → shortcut equip (QUEUED) → close (real `onResume`) →
   normal production frames commit the equipped weapon exactly once.
No manual `stepFrame`/`commitTick` is used to reach the assertions.

## economy storage-failure retry restored
`tests/economy.spec.ts` gains a test that injects a real `Storage.setItem`
failure after the purchase commit: the UI shows `could not be saved` (never
`Purchased`), the in-memory commit deducted once, the on-disk checkpoint is
unchanged while storage fails, and after recovery the pending transaction saves
and completes exactly once (no double deduction). Balance math is unchanged.

## audit default-range coverage
`tests/audit.spec.ts` now also asserts that with the default `pickupRange`
(90px ≈ 1.4 tiles) a +18-tile drop stays on the ground during 90 normal frames,
in addition to the explicitly-annotated wide-magnet (40-tile) positive probe.

## Test contract changes
| Test | Change | Reason |
|------|--------|--------|
| checkbox inventory equip | (unchanged) still uses a legal `commitTick` sync point | overlay pauses the sim; the real no-advance path is covered by resume-no-step |
| audit loot | added default-range non-pickup assertion before the wide-magnet probe | prevent the wide fixture from masking default behaviour |
| economy | added storage-fail retry test | restore coverage removed earlier; assert no Purchased / no double deduct |

No price/reward/ledger/core-transaction behaviour changed.

## Gates (see logs/gate.log)
typecheck PASS · unit 429/429 PASS · build PASS · MCP build PASS ·
full E2E **53/53** PASS (five viewports included) · room/node/kill/loot parity
PASS · ledger probe PASS · resume-no-step 3/3 × 3 repeats PASS.

Full-suite run 1 failed `ai-native-world:257` and run 2 failed `vs01:131`; both
pass individually and 3× repeatedly (flake-evidence.log), and the failure points
are before any resume tick (pause-menu click / unrelated slice route). Run 3 was
fully green 53/53.

## Limits
- Base not merged/pushed; C3b still frozen.
- The two full-run flakes are environmental timing under sustained load, not
  caused by the resume change (no resume-path assertion is involved).
