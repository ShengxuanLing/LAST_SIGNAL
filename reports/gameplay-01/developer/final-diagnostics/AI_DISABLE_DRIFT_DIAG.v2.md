# AI-disable drift — diagnosis **v2** (corrected wording)

Date: 2026-11-18. Worker: `q331nefqzzh4gzn0hdbmnxwh`.

> **Supersedes `AI_DISABLE_DRIFT_DIAG.md` (v1) in this directory.**
> v1's blanket verdict "NOT a product defect" was too broad and its "exact writers" list was
> incomplete. This v2 replaces those statements with what the evidence actually supports:
> *the mechanism is confirmed in one instrumented run; the run7 site itself is UNKNOWN.*
> No product source, test, manifest or frozen byte was changed; no gate was re-run; 0 model calls.
> Inputs: `reports/gameplay-01/reviewer/AI_DISABLE_TEST_REVIEW.md` (independent review of v1),
> `tests/ai-native-world.spec.ts` sha `ef1d2e92…`, product v4 (`World.ts` `349544bf…`,
> `core.ts` `f71523e1…`).

## 1. What v2 corrects (v1 → v2)

| v1 said | v2 says |
|---|---|
| "**Verdict: NOT a product defect**" | **Retracted as a run7 conclusion.** Fact: in **one instrumented run** (126 human-owned frames) the disabled AI delivered **no** intent. The **run7 site was never instrumented**, so the literal cause of that run is **UNKNOWN**. The most that can be claimed: real enemy knockback (and/or `ensureWalkableFromState` repositioning) under a neutral intent is *sufficient* to move the player, so the assertion's `hp`-equality precondition is unsound. |
| HP can be restored by "health loot / hpRegen" | **Incomplete**: the strongest in-window restorer is the spec's **own 100 ms keep-alive**: `setInterval(apply, 100)` with `if (hp > 0 && hp < maxHp * 0.35) w.enqueueHeal(maxHp - hp)` — installed at `tests/ai-native-world.spec.ts:280`, body at `:232-247`, **never cleared**. In this test, equal HP endpoints are *expected*, not a rare coincidence. Loot (`core.ts:1223-1229`) and `hpRegen` (`core.ts:941-943`) remain additional paths. |
| "`0.6941511 / 0.375 = 1.851` → two knockbacks" | **Only an inference, and not the only composition.** One hit contributes at most 0.375 per axis, so >0.375 needs **either ≥2 hits or 1 hit + a repositioning write** whose search is bounded only by 6 tiles (`ensureWalkableFromState`, `core.ts:850-867`). Which one happened in run7 is **UNKNOWN**. |
| "exact writers of `_sim.player.x/y`" = teleport command / movement / knockback | **Incomplete list.** Complete set today: ① per-tick recovery `ensureWalkableFromState` in `stepActorMovement` (`core.ts:1038-1048`, emits `player-moved` with `velocity{0,0}`); ② knockback `applyActorHit` (`core.ts:1193-1194`); ③ movement from `intent.move` (`core.ts:1062-1063`); ④ queued `teleport-player` commit (`core.ts:650-660`, gated by `pendingCommands`); ⑤ `World.setupP1Scenario` start (`World.ts:646`), `#resetPlayer` (`World.ts:1701-1709`, checkpoint/new-run only), and the dev-only `setPlayerPositionForTest` (`World.ts:115-120`). `Player.ensureWalkable()` (`Player.ts:146-152`) is defined but has **no call site** today. |
| "not a sampling race" / "only knockback" | Still: no separation/overlap/push routine exists in the sim, and the per-tick data shows no AI input — but the **run7 window's writer mix remains unproven**. |

## 2. KNOWN from the run7 failure (unchanged, verbatim)

`tests/ai-native-world.spec.ts:553` (inside the case declared at `:272`):
`x 115.32342141231187 → 116.01757253487142` = **+0.6941511225595463** over the 2500 ms window;
the `y` assertion never ran; the block only runs when `stationaryStart.hp === stationary.hp`.
Sequence: `:499` Escape → 450 ms → `:527` openAiHub → `:528` AI CONTROL → 550 ms + OFF asserts →
`:538` resume → 1500 ms → `stationaryStart` → 2500 ms no input → `:553`.

**UNKNOWN for run7 (must stay unknown):** no per-tick trace exists for that run; its enemies,
projectiles, damage, key flags, per-sample `intent`/`lastIntentOwner`, `walkable`, pause/authority
fields and level-up state were never persisted (`record()` throws before `saveLog()`). The
`operation-log-…-PASS-run-2256.json` and PASS screenshot are **pass-run** evidence and are not the
failure scene.

## 3. CONFIRMED — one instrumented run (scope: this run only)

From `diag/step-diag.json` (308 calls) and the reviewer's independent re-computation:

- human-owned frames after disable: **126**; `mode` HUMAN, `ctlPaused/gsPaused` false;
- non-zero `intent.move`: **0**; any movement key held: **0**; `pendingCommands != 0`: **0**;
- frames with movement: **5**, each 0.375 total, each with `lastIntentOwner='human'`, all with
  `move {0,0}` and all in the **same set** as the 5 frames with HP drop;
- nearest enemy on those frames: `drone` at 0.15 / 0.48 / 0.86 / 1.22 / 1.6 tiles;
- no HP increase in that run's human phase.

**Scope statement:** this proves *the disabled AI delivered no intent in this run*, not that
run7's scene had no AI intent. In this run the assertion was skipped because the endpoints' HP
differed (64 vs 49) — one more heal would have made it red.

## 4. CONFIRMED — code facts (read against the frozen v4 bytes)

- `resolvePlayerHit` (`src/world/sim/rules.ts:365-384`): knockback `24 / PIXEL_TO_TILE(64) = 0.375`,
  applied **per axis** only when that axis target is walkable; blocked entirely while `invuln > 0`.
- `damageAfterArmor` floor is **1** (`rules.ts:131-134`) ⇒ a real hit always changes HP; equal HP
  endpoints therefore require an in-window restore (§1).
- HP restore paths: the spec's keep-alive (`tests/ai-native-world.spec.ts:232-247,280`), health loot
  (`core.ts:1223-1229`), `hpRegen` (`core.ts:941-943`).
- AI gating after disable: `control.disableAi` clears `_aiEnabled`/sets `_owner='human'`
  (`src/ai-native/control.ts:174-189`), `resume()` restores `'human'` while `aiEnabled === false`
  (`:186`), `resolveIntent` asks the controller only when `owner === 'ai'`
  (`src/entities/Player.ts:209-236`); the only re-enable path is the Pause menu
  (`src/scenes/GameScene.ts:1203`).
- No separation/overlap/push code exists in the simulation (repo-wide search): the only non-intent
  movers are knockback and `ensureWalkableFromState` repositioning, plus the gated teleport command.

## 5. What the 0.694 number can and cannot mean

- One knockback contributes `0.375 * cos(angle)` per axis (≤ 0.375). So **`|Δx| = 0.694` cannot be
  one hit alone**.
- Compatible compositions: **≥2 hits** (e.g. 0.375 + 0.319) **or** **1 hit + a repositioning write**
  (`ensureWalkableFromState`, whose nearest-walkable search is bounded only by 6 tiles).
- Which one occurred in run7 is **UNKNOWN**: v2 records this as an inference with two branches, not
  as "two knockbacks".

## 6. Deterministic counterexample — kept, with corrected field naming

`diag/guard-hole.check.mts` + `diag/guard-hole.log.txt` (legacy) remain **untouched**; its heal is
the **real core command** `heal-player` (the same command `World.enqueueHeal` uses and the spec's
keep-alive uses), so the fixture is legitimate and stays. Because the reviewer noted the field name
`guardWouldSkip: false` reads as a contradiction next to `hpEqual: true`, a **v2 copy** renames it to
`positionAssertionRuns` and is saved separately — old red/white data is never rebuilt or overwritten:

- `diag/guard-hole.check.v2.mts` → `diag/guard-hole.v2.log.txt`
- semantics: `positionAssertionRuns = hpEqual` (true ⇒ the spec's position assertion **would run**,
  which is exactly the flake condition).

## 7. Limits of the diagnostic harness itself (stated honestly)

- The **original** diag copy (`diag/ai-native-world.diag.p4v4.spec.ts`) wraps
  `World.prototype.stepFrame` and **never restores the prototype**; there is no `finally` restore.
  It relied on the Playwright **page context ending with the test**, so later tests in the same
  file/session were *not* affected — but the copy is **not safe to reuse** without a restore.
- The v2 diagnostic copy (`diag/ai-native-world.diag2.p4v4.spec.ts`) adds a `try/catch/finally` that
  **persists the trace** even when an assertion throws, but it **also does not restore** the
  prototype (same page-context containment). Restoring it (and failing fast if the restore fails) is
  the first requirement for any tester adoption — see §8-2.
- Consequence: the traces prove what happened **in those runs**; they are not a claim about run7.

## 8. Minimal Tester contract (event-level attribution, not HP diff)

Adopt the reviewer's §5.2/§5.3 corrections. Minimum:

1. **Attribute with the events `stepFrame` returns**, not HP: `player-hurt` carries
   `hit.position`; `player-moved` carries `position` (also emitted by the recovery path).
2. **Wrap and restore**: patch `World.prototype.stepFrame`, and in `finally` restore the original
   (fail fast if the restore throws) + flush the trace to the evidence dir.
3. **Do not assert `pendingCommands.length === 0`**: this spec's 100 ms keep-alive legitimately
   enqueues `heal-player`. Record command types and only forbid `teleport-player` (the only queued
   command that writes the player position).
4. **Per-frame, unconditional**: `intent.move == {0,0}`, `fire === false`, `owner === 'human'`,
   `aiEnabled === false`, `lastIntentOwner === 'human'`.
5. **Window-level**: `aiActionCount` unchanged, `takeoverCount` unchanged, `lastAiAction === null`.
6. **Position assertion, two branches**:
   - `positionWriters = events.filter(player-hurt | player-moved | player-reset)`; if empty ⇒ require
     the frame position to be **bit-equal** to the pre-frame position (keep `1e-6`);
   - if not empty ⇒ require the post-frame position to be **bit-equal to the last writer's
     `position`** (i.e. all displacement is explained by real physics; AI contribution 0) and record
     the event type/damage/source.
   Do **not** use "HP unchanged" as the quiet-window predicate (regen/loot can change HP with no
   movement, which would only *skip* a valid assertion).
7. Require the window to be non-empty and to advance at least one tick (per-frame
   `tickBefore/tickAfter`; a `ticks === 0` first frame is normal).
8. Keep: no enemy clearing, no freezing, no teleport, no healing to manufacture a quiet window, no
   changes to budget/`maxMs`/`skip`, no widening of `toBeCloseTo(…, 6)`.

## 9. Status

- Product **v4 stays frozen** (`World.ts` `349544bf…`, `core.ts` `f71523e1…`; no source edit here).
- The failing assertion's precondition is unsound; the run7 literal cause stays **UNKNOWN**.
- This round re-ran **no gate** and made **no** product/test/manifest change; 0 model calls; no
  commit/push. Overall GAMEPLAY remains not a whole PASS; HUMAN ACCEPTANCE PENDING.
- Derivative copies: the tester package `…/run7-v4-final/ai-disable-drift/DEVELOPER_DIAG.md` and
  `FAILURE_TRACE.md` §7 were written from v1 and therefore carry the same over-broad verbatim
  wording. Their **data and hashes remain valid**, but their verdict sentence must be read as
  superseded by this v2; they were not edited in this round (Lead scoped the correction to this
  file only).

## 10. Artifacts (worktree cwd `D:/Project/LAST_SIGNAL/.cindy-worktrees/serene-leakey`)

| artifact | note |
|---|---|
| `diag/step-diag.json` `03a5e49a…` | v1 instrumented run (unchanged) |
| `diag/per-tick-trace-run2.json` `9cca777d…`, `-run3.json` `b64a8f03…` | v2 diagnostic runs with try/finally dump (unchanged) |
| `diag/guard-hole.check.mts` `6453240c…`, `diag/guard-hole.log.txt` | legacy counterexample (unchanged) |
| `diag/guard-hole.check.v2.mts` `568c1f01549a2168…`, `diag/guard-hole.v2.log.txt` `899d4e7b9d2611bc…` | renamed field `positionAssertionRuns` (new files; old script/log untouched) |
| `diag/ai-native-world.diag.p4v4.spec.ts` `0230ebd4…`, `…diag2…` `ba80279a…` | diagnostic copies (unchanged) |
