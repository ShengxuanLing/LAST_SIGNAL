# GAMEPLAY-01 P4 — **v4** legacy portal centre-walkability fix

Date: 2026-11-18. Worker: `q331nefqzzh4gzn0hdbmnxwh`.
Status: **ENGINEERING DELIVERED (v4) — FROZEN for independent re-review — HUMAN ACCEPTANCE PENDING.**
0 model calls. No commit / push / merge. Main repo sources not written by me.

## 0. Input and freeze

- Worktree `D:/Project/LAST_SIGNAL/.cindy-worktrees/serene-leakey`, HEAD `3819621` (base of the
  integrated branch), 0 commits by this worker. The Lead's integrated v3 commit `48b080d` was
  verified **byte-identical** to my ten v3 sources before touching anything.
- v3 bytes are archived at `v3-freeze/` (10 sources + 4 docs + `manifest.v3.json` +
  `FREEZE-HASHES.log.txt`), next to the existing `v1-freeze/` and `v2-freeze/`.
- This round changes **exactly one source**: `src/world/World.ts`. No test, config, save,
  rendered or doc file changed; P5 stays plan-only.

## 1. The regression (from the tester's run3, reproduced here first)

| Symptom | Command | RED log |
|---|---|---|
| `start room portal is walkable` = false | `PORT=5471 npx playwright test tests/runtime-bugs.spec.ts -g 'cleared room always offers an exit portal'` | `v4/red/runtime-bugs-start-room-portal.log.txt` |
| `player.reset(portal.wx, portal.wy)` never stands on the portal in 8 s | `PORT=5471 npx playwright test tests/audit.spec.ts -g 'fixed-seed playability regression'` | `v4/red/audit-portal-stand.log.txt` |

Both reproduced with the unmodified specs on the v3 bytes, exactly as reported.

Root cause: the legacy candidate loop probed the **tile corner**
(`isWalkable(tile.x, tile.y, 0.5)`), while `makePortal` presents the beacon at the
**cell centre**. A radius-0.5 probe at a corner only touches the four cells around that corner;
at the centre it requires all four neighbours to be free. A corner cell can therefore pass the
probe while the player cannot stand on the beacon — and if the player cannot stand there, the
interaction/teleport target is unreachable.

## 2. Fix (minimal, one coordinate system)

In `src/world/World.ts`:

- New `findWalkableCentreInRoom(r, near?)`: probes `cellCentre(tile)` with radius 0.5 and
  **returns that same centre**. One point for validation and presentation — no two coordinate
  systems.
- `placePortalForTarget()` uses it (nearest to the target room centre) and passes the result
  straight to `makePortal(target, centre)`; the old corner→centre conversion is gone.
- The two deck-exit portal placements (`placePortal`, extraction/exit-unlocked branches) use the
  same helper instead of `cellCentre(findWalkableInRoom(r))`.
- `findWalkableInRoom()` is **kept as the position helper** (corner probe matches the position
  where a player/boss/loot is actually placed) and is now documented as positions-only, with a
  pointer that portals must use the centre helper. Its probe semantics are unchanged, so spawns,
  landings and boss placement are untouched.
- `makePortal` still takes a cell centre; the authored route path (`updateP1RoutePortal` →
  `makePortal(target, route.portal)`) is untouched, so the P4 natural-jam behaviour and its
  earlier evidence stand unchanged.

Degenerate case: if a room has no centre-qualifying cell, the helper falls back to the same
room-centre cell the old code used (a room still gets a beacon) — no new failure mode.

## 3. Green evidence

| Gate | Result | Log |
|---|---|---|
| runtime-bugs start-room portal (unmodified spec) | **PASS 1/1** | `v4/green/runtime-bugs-start-room-portal.log.txt` |
| audit fixed-seed playability (unmodified spec, portal stand within 8 s) | **PASS 1/1** | `v4/green/audit-portal-stand.log.txt` |
| typecheck `npx tsc --noEmit` | **PASS** (0 errors) | `v4/gates/v4-typecheck.log.txt` |
| checkpoint + economy + echo-portal-migration + signal-human-crossroom | **PASS 10/10** | `v4/green/portal-checkpoint-required.log.txt` |
| the same plus companion-room-cancel + companion-room-race | 14/15 — `companion-room-race.spec.ts:274` flaked under load, **3/3 isolated** (P2 race, unrelated, no assertion touched) | `v4/green/portal-checkpoint-targeted.log.txt`, `v4/green/companion-room-race-isolated.log.txt` |
| authored P1 rendered regression (`tests/gameplay-01.spec.ts`) | 6/7 — the single failure is the **known stale** `:578` door-distance assertion (product decision F7; tester-owned rewrite) | `v4/green/authored-p4-p1.log.txt` |

`tests/gameplay-04-coop-level.spec.ts` is not present at this base (it is a tester-added spec);
the authored P4 path is unchanged by this fix and was covered by the tester's own run3 (9/9).

No assertion, timeout, teleport expectation or threshold was modified; `tests/**` is untouched.
The audit spec's teleport remains a **geometry fixture for standing**, not a natural-completion
claim, and the P4 natural jam flow evidence is unchanged.

## 4. Hand-off

- `manifest.v4.json` — all 10 source sha256, 4 doc sha256, v3→v4 exact diff, patch hashes,
  red/green/gate mapping, test-inventory note.
- `v4/patch/v3-to-v4-World.diff` (77 lines, the whole change), `v4/patch/World.v4.ts`,
  `v4/patch/World-vs-HEAD.patch`.
- Freeze: v1/v2/v3/v4 archives preserved. Do not edit the frozen sources after this hand-off.

Limits unchanged: Headless completion is a route projection; rendered completion is one seed;
0 damage is not a balance sample; HumanOnly = no connection; owner confirmation in scripts is a
fixture; P5 plan-only; R3 cross-version identity open; HUMAN ACCEPTANCE PENDING; overall
GAMEPLAY is **not** a whole PASS.
