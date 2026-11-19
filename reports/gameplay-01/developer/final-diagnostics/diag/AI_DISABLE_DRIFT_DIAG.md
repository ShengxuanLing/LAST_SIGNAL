# AI disable drift — diagnosis (`tests/ai-native-world.spec.ts:553`)

Date: 2026-11-18. Worker: `q331nefqzzh4gzn0hdbmnxwh`.
Input: frozen v4 product (`main d55e502`, ten sources = `manifest.v4.json`), tester spec
`tests/ai-native-world.spec.ts` (main `ef1d2e92`, unmodified), red log
`reports/gameplay-01/tester/p4-final/run7-v4-final/logs/full-e2e-155.log.txt`.

**Verdict: NOT a product defect. The AI applies no intent after disable; the observed drift is
real enemy knockback that the spec's `hp equal` guard fails to exclude. No product source was
changed; v4 stays frozen.**

## 0. Environment / inputs

| item | value |
|---|---|
| cwd | `D:/Project/LAST_SIGNAL/.cindy-worktrees/serene-leakey` |
| HEAD | `3819621c5faab56b114b6e5a560f8fe78c17709d` (branch base; v4 sources = `48b080d` + World `349544bf…`) |
| World sha256 | `349544bf5785dad072fb7bc3c904d0c80bb08f4619d7834a598d7e58ec05dc64` (v4, unchanged by this diagnosis) |
| port | my own **5471** (tester 5199/5492 untouched) |
| diagnostic spec (copy) | `diag/ai-native-world.diag.p4v4.spec.ts` `0230ebd4…` — a **copy** of the tester spec with a read-only `stepFrame` recorder added; `tests/**` untouched |
| recorder data | `diag/step-diag.json` `03a5e49a…` (308 per-call records), `diag/step-diag-summary.json` `bc0e7253…` |
| run log | `diag/diag-run1.log.txt` |
| deterministic core counterexample | `diag/guard-hole.check.mts` `6453240c…` → `diag/guard-hole.log.txt` |

## 1. What the failing assertion measures

`tests/ai-native-world.spec.ts:540-556`: after disabling AI from the pause menu and resuming,
the test waits 1500 ms (`stationaryStart`), waits another 2500 ms (`stationary`), then

```ts
if (stationaryStart!.hp === stationary!.hp) {
  expect(stationary!.grid.x).toBeCloseTo(stationaryStart!.grid.x, 6);   // ← red: 115.3234 → 116.0176
  expect(stationary!.grid.y).toBeCloseTo(stationaryStart!.grid.y, 6);
}
```

So the assertion runs only when the two HP samples are equal, and then requires the position to
be identical to 1e-6. Observed red: `x` moved **0.6941511225595463**.

## 2. CONFIRMED — the disabled AI applies no intent (per-tick evidence)

One instrumented run (308 `stepFrame` calls recorded read-only: owner/mode/aiEnabled/ctlPaused,
the exact `intent` passed to the core, key flags, pending core commands, player position + HP
before/after, nearest enemy). Human-owned phase after the disable:

| measurement | value |
|---|---|
| human-phase `stepFrame` calls | 126 |
| calls with **non-zero move intent** | **0** |
| calls with any movement key held | **0** |
| calls with queued core commands | **0** |
| calls where the position changed | **5** |
| calls where HP dropped | **5** (exactly the same 5 calls) |

All 5 movers have `move {x:0,y:0}`, `owner:'human'`, `aiEnabled:false`, `lastIntentOwner:'human'`,
`pendingCommands:0`, and a drone **0.15–1.6 tiles** away. Sample:

```
t=23866 owner=human aiEnabled=false move={0,0} keys={all false}
  (115.932,45.626) -> (116.299,45.547)  hp 100 -> 79   nearest drone d=0.15
t=24792 ... (116.299,45.547) -> (116.596,45.777)  hp 79 -> 71   nearest drone d=0.48
t=25357 ... (116.596,45.777) -> (116.938,45.930)  hp 71 -> 64   nearest drone d=0.86
```

Code path (exact writers of `_sim.player.x/y` inside a tick):
- `src/world/sim/rules.ts:365` `resolvePlayerHit` — real hit ⇒ `hp -= dmg` (`damageAfterArmor`
  floor is **1**, `rules.ts:132`) and knockback **24 px / PIXEL_TO_TILE 64 = 0.375 tiles**
  (per axis, only if that axis target is walkable).
- `src/world/sim/core.ts:1190-1196` `applyActorHit` writes `p.data.hp` **and** `p.x/p.y`.
- Movement only via `stepPlayerMovement(intent.move)` (`rules.ts:85-98`), and intent is neutral
  here; teleports only from `pendingCommands` (0 in every human-phase call).
- AI gating: `src/entities/Player.ts:209-236` — `owner === 'human'` ⇒ `intentFromHumanInput(...)`,
  no controller call; `control.disableAi('pause-menu')` (`src/ai-native/control.ts:174`) and
  `humanTakeover` (`:194`) clear `_aiEnabled`/`_owner`; `resume()` restores `'human'` while
  `aiEnabled === false`; only `GameScene.toggleAiControl()` (`:1205`) can re-enable.

**⇒ No AI residual action, no key-release leak, no queue boundary issue.** There is nothing to
fix in the product for this red.

## 3. CONFIRMED — why the `hp equal` guard does not exclude knockback

A hit always changes HP by at least 1 (`damageAfterArmor` floor) — but HP can be **restored
inside the same 2.5 s window** by the real core paths (health loot heals 30 in `stepLoot`,
`core.ts:1223-1229`; `hpRegen` upgrades tick in `tickActorTimers`, `core.ts:941-943`). So two
samples taken 2.5 s apart can be HP-equal while one or more knockbacks happened in between.

Deterministic counterexample using only real core code (`diag/guard-hole.check.mts`, run log
`diag/guard-hole.log.txt`):

```json
{ "moveIntent": {"x":0,"y":0}, "keysHeld": "none",
  "sample1": {"hp":100,"x":8.5,"y":45.5},
  "afterHit": {"hp":94,"x":8.875,"y":45.5},      // real resolvePlayerHit: damage + 0.375 knockback
  "sample2": {"hp":100,"x":8.875,"y":45.5},      // real heal-player core command
  "hpEqual": true, "movedDistanceTiles": 0.375,
  "verdict": "COUNTEREXAMPLE: equal HP at both samples while the player was knocked back" }
```

**⇒ The assertion's precondition is unsound: it treats "HP endpoints equal" as "no enemy
contact", which the product does not guarantee.**

## 4. INFERENCE about the exact run7 numbers (not directly observed)

- `0.6941511225595463 / 0.375 = 1.851` → consistent with **two** knockbacks along x whose
  per-axis components were partly clamped by walkability (e.g. 0.375 + 0.319).
- Because every real hit removes ≥1 HP, HP-equality at both endpoints means HP was restored
  in-window (loot/regen). The instrumented run shows the same physics with **no** restore
  (5 hits, HP 100→49), which is why the same product code produced a green run there: the guard
  skipped the position assertion (`hp` differed). That is exactly the flake: **same product
  behaviour, different HP endpoints.**
- Not reproduced as an exact 0.694 number here; no claim is made that the two hits were
  drone hits rather than other enemy kinds — only that the mover was real knockback.

Not the cause (ruled out by §2): AI intent after disable, held-key leak, queued command,
echo/companion push (no echo in this run), multi-frame sampling race (the movement is a
single-tick write, not a sampling artifact).

## 5. Minimal Tester-side plan (no product change, no sleep/timeout/threshold edits)

Replace "position must be identical" with the property the test actually wants — **the disabled
AI pipelines no movement** — and keep a position check only for a **verified no-contact window**:

1. Assert the control contract across the window (already exposed by the spec's `state()`):
   `owner === 'human'`, `aiEnabled === false`, `lastIntentOwner === 'human'`,
   `aiActionCount` unchanged, `lastAiAction === null`, `takeoverCount` unchanged.
2. Assert the **intent** is neutral at every sample: `state().intent.move` is `{0,0}`
   (`player.lastIntent.move` is already read by `state()`); this is the direct
   "AI did not move the player" fact.
3. If a positional check is still wanted, gate it on a real **no-contact** fact recorded in the
   same window instead of HP equality — e.g. count `player-hurt` by wrapping
   `world.stepFrame` read-only (as `diag/ai-native-world.diag.p4v4.spec.ts` does) and require
   `hurtCount === 0` **and** `hp` unchanged; otherwise record the knockback as expected physics
   and skip the position comparison for that window.
4. Never teleport the player or pause the enemies to make the window "quiet"; do not relax the
   `toBeCloseTo(…, 6)` precision for a no-contact window.

The three harness-readiness fixes in the tester report are unrelated and stay as they are.

## 6. Status

- Product: **no change** (v4 sources frozen, hashes unchanged; `manifest.v4.json` still valid).
- This diagnosis adds only `reports/gameplay-01/developer/p4-recovery/diag/**` (diagnostic copy,
  logs, counterexample). `tests/**` untouched; no commit/push; 0 model calls.
- Overall GAMEPLAY remains **not** a whole PASS; HUMAN ACCEPTANCE PENDING.


## 7. Update — bounded per-tick runs with try/finally (run2 / run3)

Two further bounded runs used a **new** diagnostic copy derived from the tester's frozen spec
(`diag/ai-native-world.diag2.p4v4.spec.ts`, sha `ba80279a…`, base spec `ef1d2e92…`) with a
read-only `stepFrame` recorder and a `try/finally` dump (so a thrown assertion still persists the
trace), on port 5471. The tester's failure package now carries the evidence:
`reports/gameplay-01/tester/p4-final/run7-v4-final/ai-disable-drift/` (DEVELOPER_DIAG.md,
developer-per-tick-trace-run2/3.json, developer-window-analysis-run2-run3.json).

| run | window | frames | movers (= knockbacks) | non-zero move intents | keys held | queue | HP endpoints | assert |
|---|---|---|---|---|---|---|---|---|
| run2 | 2 579 ms | 49 | 4/4 (`move {0,0}`, `ev.hurt 1`) | 0 | none | only `heal-player` (spec fixture) | 57 → 85 | **skipped** (HP differs) |
| run3 | 2 606 ms | 56 | 3/3 (same) | 0 | none | only `heal-player` | 41 → 72 | **skipped** (HP differs) |

- `owner` is only `human`, `aiEnabled` only `false` in both windows; no AI/echo/teleport command
  was ever queued.
- The spec's own stabilization fixture fires `heal-player` **inside** the measured window
  (run2: 28 → 100), which is one concrete way both HP samples can end equal while the player was
  knocked around.
- **Assertion-level red: UNREPRODUCED** (3 bounded runs total, all skipped the position assert).
  **Mechanism: CONFIRMED** by the per-tick data plus the deterministic core counterexample
  (`diag/guard-hole.check.mts`). Product source unchanged (v4 frozen).
