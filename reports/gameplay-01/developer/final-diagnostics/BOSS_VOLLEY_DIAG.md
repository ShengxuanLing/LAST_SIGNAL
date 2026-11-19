# Boss volley 16 vs 15 — diagnosis (`tests/audit.spec.ts:780`, P2 boss bullets)

Date: 2026-11-19. Worker: `q331nefqzzh4gzn0hdbmnxwh`.
Input: product **v4 frozen** (`World.ts` `349544bf…`, `core.ts` `f71523e1…` — read-only),
tester spec `tests/audit.spec.ts` `ef…` (unmodified), run9 logs
`reports/gameplay-01/tester/p4-final/run9-ai-disable-final/logs/full-e2e-155.log.txt` and
`…/diag-audit-boss-bullets-isolated.log.txt`.

**Verdict: the 16th projectile is NOT a boss shot and NOT an adapter/core index skew. It is a
real legacy-enemy `spawn-enemy-projectile` command that was already pending at `c0` and committed
in the measured step. The boss itself emitted exactly 15. The test's "all new projectiles ==
laser(3)+shockwave(12)" model is what fails — product unchanged.**

## 0. Environment (absolute)

| item | value |
|---|---|
| cwd | `D:/Project/LAST_SIGNAL/.cindy-worktrees/serene-leakey` |
| HEAD | `3819621c5faab56b114b6e5a560f8fe78c17709d` (v4 product sources; main = `d55e502`) |
| port | **5471** (tester 5199/5492 untouched) |
| diagnostic spec | `…/p4-recovery/diag/audit-boss-volley.diag.p4v4.spec.ts` (copy of the tester file + read-only before/after recording; the tester file is untouched) |
| config | `…/p4-recovery/diag/pw.bossdiag.config.ts` |
| run1 (green) | `…/p4-recovery/diag/boss-run1.log.txt` → `boss-volley-bossrun1.json` |
| run2 (**red reproduced**) | `…/p4-recovery/diag/boss-run2.log.txt` → `boss-volley-bossrun2.json` |
| deterministic core counterexample | `…/p4-recovery/diag/boss-volley.check.mts` → `boss-volley-check.log.txt` |

Two bounded targeted runs (budget 2/2). The tester's `tests/audit.spec.ts` was not modified.

## 1. CONFIRMED — red reproduced locally with per-event attribution

`bossRun2` failed with `Expected 15 / Received 16` at `:780`, and the recorder captured:

```
preDiag.coreLen = 1, adapterLen = 1   (in sync, ids [3])
preDiag.queued  = ["spawn-enemy-projectile#1"]        ← ALREADY PENDING before fireLaser/shockwave
preDiag.droneAlive = 0, enemiesAlive = 3, bossId = 4
queuedAfterCalls = 15 × "spawn-enemy-projectile#4"
postDiag.coreLen = 16, adapterLen = 16                ← core and adapter agree (NO index skew)
spawned events   = 16:  ownerId 1 × 1  +  ownerId 4 × 15
extra event      = { id 3, ownerId 1, source "enemy", kind "plasma",
                     pos (22.58, 44.33), vel (2.17, 1.24) }   ← a DIFFERENT enemy, far from the boss
boss volley      = exactly 15 (ids 4..18), speeds 3 × 2.5 (laser) + 12 × 1.875 (shockwave)
created          = w.projectiles.slice(c0) = [3..18] = 16 entries
```

So the extra entry is a real projectile whose `projectile-spawned` event belongs to **owner 1**,
not the boss. Its command sat in `pendingCommands` at `c0`, i.e. it was queued on the **previous**
frame and committed inside the measured step.

## 2. CONFIRMED — same bytes, green run, and why

`bossRun1` (same spec copy, same product bytes) passed:

```
preDiag.queued = []       → nothing pending
spawned = 15, all ownerId 4, core/adapter 16/16 (1 pre-existing + 15)
```

The only difference between the two runs is **whether a legacy enemy fired on the frame before the
measurement**. That is deterministic event attribution, not load flakiness: the run2 recorder shows
the pending command and its owner before the measured step even starts.

## 3. CONFIRMED — mechanism in code

- `Boss.fireLaser()` spawns 3 and `Boss.shockwave()` spawns 12 via
  `World.spawnEnemyProjectile` (`src/entities/Boss.ts:165-188`), which **enqueues**
  `spawn-enemy-projectile` on the core (`src/world/World.ts:1781-1784`); the core commits them on
  the next tick (`core.ts` command handling → `projectile-spawned`).
- Legacy (non-drone) enemies fire through the same enqueue path from `enemyCombatPort` during
  `World.updateLegacy`, which runs **after** the ticks and the adapter sync of that frame. Their
  command therefore becomes pending and is committed by the **next** `stepFrame` — exactly the one
  the test measures.
- The test freezes only the **boss** (`attackTimer = stateTimer = 999999`), so other enemies are
  free to fire. `droneAlive = 0` shows it was not a drone FSM shot.
- The step's returned events already carry the attribution the test needs
  (`projectile-spawned.projectile.ownerId`).

## 4. CONFIRMED — deterministic core counterexample

`diag/boss-volley.check.mts` (real core APIs only: `enqueueCommand('spawn-enemy-projectile')` +
`stepSimulationTicks`): 15 boss commands + 1 pending command from owner 1 in the same tick →

```json
{ "pendingBeforeTick": 1, "spawnedEvents": 16, "byOwner": { "1": 1, "4": 15 },
  "bossEvents": 15, "coreProjectiles": 16,
  "verdict": "COUNTEREXAMPLE: 16 spawn events while the boss itself contributed exactly 15" }
```

## 5. Ruled out (each with evidence, not assertion)

| hypothesis | verdict | evidence |
|---|---|---|
| boss fired 16 this time | **ruled out** | boss-attributed events = exactly 15 in the red run; the 16th has `ownerId 1` |
| adapter/core index skew (`c0` from core, slice from adapter) | **ruled out for this red** | `coreLen === adapterLen` (16/16) after the step, and the extra entry has a matching real `projectile-spawned` event |
| legacy sprite cleanup desync | **ruled out** | `resetProjectilesForTest()` clears both the sprite map and `_sim.projectiles`; pre-state 1/1 matches ids `[3]` |
| drone shot | **ruled out** | `droneAlive = 0`; owner 1 is a legacy enemy |
| old queued command from the **boss** | **ruled out** | the pending command's owner is 1, not the boss id 4 |

Note (not a cause of this red, but a latent fragility): the test mixes representations —
`c0 = w.simFixture.projectiles.length` (**core**) then `w.projectiles.slice(c0)` (**adapter view
map**). That only works while both are equal and insertion-ordered. An id-level diff removes the
coupling even though it is synced today.

## 6. UNKNOWN (kept unknown)

- Which enemy kind owns id 1 in the tester's run9 (my recorder logged owner id, not kind). The
  mechanism does not depend on it.
- Whether the tester's run9 16 came from exactly this path: their run has no per-event trace. What
  is proven is that the same product bytes and the same spec produce 16 with this attribution, and
  that the mechanism fully explains it.

## 7. Minimal Tester plan (exact values kept; nothing hidden)

1. Take the events returned by the measured `stepFrame` and split by **owner**:
   ```ts
   const spawns = stepEvents.filter(e => e.type === 'projectile-spawned');
   const volley = spawns.filter(e => e.projectile.ownerId === boss._id);
   const others = spawns.filter(e => e.projectile.ownerId !== boss._id);
   expect(volley.length, 'laser(3) + shockwave(12) from the boss').toBe(15);   // exact, unchanged
   record('boss-volley-others', others.map(e => ({ ownerId, kind, pos, vel }))); // attributed, not hidden
   ```
2. Build the checked bullet list from the **volley ids** instead of `slice(c0)`:
   `const ids = new Set(volley.map(e => e.projectile.id)); const created = w.projectiles.filter(q => ids.has(q.data.id));`
   — this removes the core/adapter coupling and keeps every existing assertion (3×2.5, 12×1.875,
   all visible, inside the viewport, still alive/moved after 0.5 s).
3. For the 0.5 s survival check, track the same `ids` (the unrelated enemy shot may legitimately
   die or leave the viewport and must not be counted as a volley bullet).
4. Do not change 15 to `>= 15`, do not filter the extra shot out of the record, do not clear
   enemies, do not freeze other enemies to manufacture a quiet frame.
5. Optional hardening (not required): step once with a neutral intent and re-read `c0` right before
   the volley call, then assert `pendingCommands` contains no `spawn-enemy-projectile` before the
   calls — but the event-level owner split already makes the assertion exact.

## 8. Status

- Product **v4 unchanged** (no source edit this round); no test edit; no whole-suite re-run.
- The red is a **test model** issue (counting every spawn in the step as the boss volley), not a
  legacy-flaky excuse: the 16th is identified by owner, position and pending command.
- Overall GAMEPLAY remains not a whole PASS; HUMAN ACCEPTANCE PENDING.

## 9. Artifact hashes (this round)

`diag/audit-boss-volley.diag.p4v4.spec.ts`, `diag/boss-run1.log.txt`, `diag/boss-run2.log.txt`,
`diag/boss-volley-bossrun1.json`, `diag/boss-volley-bossrun2.json`,
`diag/boss-volley.check.mts`, `diag/boss-volley-check.log.txt`, `diag/pw.bossdiag.config.ts` —
see the `sha256sum` block printed in the worker report; product v4 hashes unchanged
(`World 349544bf…`, `core f71523e1…`).
