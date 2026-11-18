# AI-disable drift — developer per-tick diagnosis (KNOW / INFER / UNKNOWN separated)

Added by the developer next to the tester's failure package. **No product source was changed**
(v4 stays frozen: `World.ts` `349544bf…`, `core.ts` `f71523e1…`). No spec/assertion/threshold was
changed; the two diagnostic runs are a **new independent spec** (a copy in the developer tree), not
the tester's file.

Commands / environment (all logs are permanent):

| item | value |
|---|---|
| cwd | `D:/Project/LAST_SIGNAL/.cindy-worktrees/serene-leakey` |
| HEAD | `3819621c5faab56b114b6e5a560f8fe78c17709d` (v4 sources; main product `d55e502` = same ten sources) |
| port | **5471** (tester 5199/5492 untouched) |
| diagnostic spec (copy of the base-sha file + read-only recorder + try/finally dump) | `reports/gameplay-01/developer/p4-recovery/diag/ai-native-world.diag2.p4v4.spec.ts` `ba80279a…` |
| recorder | wraps `World.prototype.stepFrame` read-only; per call: owner/mode/aiEnabled/paused, the **exact intent passed to the core**, key flags, queued core commands, player pos/HP before→after, enemies near, projectiles, and the **events that call returned** (`player-hurt`/`player-healed`/`loot-collected`/`player-death`) |
| persistence | `try { measurement + assertions } catch { record; rethrow } finally { dump rows + marks }` → a thrown assertion still writes the trace |
| run2 log | `developer-diag-run2.log.txt` |
| run3 log | `developer-diag-run3.log.txt` |
| per-tick data | `developer-per-tick-trace-run2.json` `9cca777d…`, `-run3.json` `b64a8f03…` |
| per-window analysis | `developer-window-analysis-run2-run3.json` `ef9b05fc…` |

## 1. Gate results

| gate | result | evidence |
|---|---|---|
| red assertion reproduced at the assertion level | **UNREPRODUCED** in 3 bounded runs (1 earlier diag copy + run2 + run3). All 3 passed; the position assertion was **skipped** each time because the two HP samples differed | run2/run3 summaries: `assertOutcome: "skipped-hp-differs"`, `thrown: null` |
| product applies an AI intent after disable | **FAILURE (i.e. no AI intent) — CONFIRMED absent** | run2: window 2 579 ms / 49 frames, **0** non-zero move intents, keys never held, `owner` only `human`, `aiEnabled` only `false`; run3: 2 606 ms / 56 frames, same |
| movement mechanism | **CONFIRMED: real `player-hurt` knockback** | every mover in both windows is a knockback: `move {0,0}`, all key flags false, `ev.hurt: 1`, HP drop, drone 0.30–1.69 tiles away (run2: 4/4 movers; run3: 3/3) |
| core separation / collision push | **CONFIRMED absent** (source) | in `src/world/sim/core.ts` the player's `x/y` are written only by: teleport command (`:653-654`), stuck-recovery inside the movement step (`:1040-1041`), movement from `intent.move` (`:1062-1063`), knockback (`:1193-1194`). A repo-wide search finds no separation/overlap/push routine |
| queued core commands during the window | **CONFIRMED: only the spec's own heal fixture** | run2/run3 window: the only queued command ever seen is `heal-player` (from `stabilizeEvidenceRun`, which fires below 35 % HP); no AI/echo/teleport command |
| HP restored inside the window | **CONFIRMED** | run2: `heal-player` 28 → 100 at t≈25 044 ms, inside the measured window; run3: same fixture fired once |
| `hp equal` guard is unsound | **CONFIRMED (deterministic, real core)** | `guard-hole.check.mts` (see developer tree): real `resolvePlayerHit` knockback + real `heal-player` command ⇒ endpoints HP **100 → 100** while the position moved **0.375** tile |

## 2. What the per-tick data shows (run2 window, 2 579 ms)

```
start mark: x 115.7447 y 46.6437 hp 57  owner human aiEnabled false keys.all=false queued=[] lastIntentOwner=human
end   mark: x 116.1304 y 47.6412 hp 85  owner human aiEnabled false keys.all=false queued=[] lastIntentOwner=human
delta: (+0.3857, +0.9975)   hp endpoints differ ⇒ position assertion SKIPPED (this is why the run is green)

mover 1: dx +0.364 dy -0.089  move {0,0}  ev.hurt 1  hp 57→36  nearest drone 0.694
mover 2: dx +0.128 dy +0.353  move {0,0}  ev.hurt 1  hp 36→28  nearest drone 0.956
mover 3: dx -0.110 dy +0.358  move {0,0}  ev.hurt 1  hp 100→93 nearest drone 1.331   ← after the fixture heal
mover 4: dx +0.004 dy +0.375  move {0,0}  ev.hurt 1  hp 93→85  nearest drone 1.692
window events: 4 × player-hurt, 1 × player-healed (the queued heal-player), 0 loot, 0 death
```

run3 (2 606 ms / 56 frames) is the same shape: 3 movers, all knockback, `move {0,0}`, no keys,
one fixture `heal-player`, endpoints HP 41 → 72 (⇒ skipped), delta (−0.2761, +0.2591).

## 3. INFERENCE for the run7 failure (explicitly not directly observed)

The failing run has only the two X values and the fact that HP was equal (the guard ran). A real
hit always removes ≥ 1 HP (`damageAfterArmor` floor), so **HP equality at both samples requires an
in-window restore** — the same paths observed here (the spec's own `heal-player` fixture and/or
loot/regen). Two knockbacks with partly wall-clamped components fit `0.6941511225595463`
(≈ 1.85 × the 0.375 knockback constant) — e.g. `+0.375` and `+0.319`.

Consequence: the failing assertion's premise ("HP equal ⇒ no enemy contact ⇒ the disabled AI must
not move the player") is not guaranteed by the product. The drift is **physics**, not AI control.

## 4. UNKNOWN — must not be inferred from this package

For the **run7 failure itself** we still do not have (and this package does not invent): the
enemies alive, projectiles, damage taken, held-key flags, per-sample `intent`/`lastIntentOwner`,
`walkable`, pause/authority fields, level-up state, or any per-tick trace. We therefore do **not**
claim which enemy hit, which heal fired, or that no key was ever held *in that run*. The
`operation-log-…-PASS-run-2256.json` and the PASS screenshot remain **pass-run** evidence only.

## 5. Minimal Tester-side change (no product change, no sleep/timeout/threshold edits)

1. Assert the **control property** across the window: `owner === 'human'`, `aiEnabled === false`,
   `lastIntentOwner === 'human'`, `aiActionCount` unchanged, `lastAiAction === null`,
   `takeoverCount` unchanged.
2. Assert the **selected intent** is neutral at every sample: `state().intent.move` is `{0,0}`
   (already exposed by the spec's `state()`), which is the direct "the disabled AI did not move
   the player" fact.
3. If a positional check is kept, gate it on a real **no-contact** fact recorded in the same
   window (count `player-hurt` by wrapping `world.stepFrame` read-only, as this diagnostic does;
   require `hurtCount === 0` **and** `hp` unchanged) instead of HP equality. Otherwise record the
   knockback as expected physics and skip the comparison for that window.
4. Keep the `1e-6` precision for a genuinely contact-free window; do not pause enemies or teleport
   the player to manufacture one.

## 6. Verdict

- Product: **no defect, no change** (v4 frozen; hashes in `developer-diagnostic-hashes.txt`).
- Assertion-level red: **UNREPRODUCED** in bounded attempts; mechanism **CONFIRMED**.
- The tester's record stands (154/155); the fix belongs in the test's attribution, not in the
  product's physics.
