# GAMEPLAY-01 P4 — recovery developer delivery (formal DEMO-01 cooperative level)

Date: 2026-11-18. Worker: Orca replacement developer (`q331nefqzzh4gzn0hdbmnxwh`).
Status: **ENGINEERING DELIVERED / FROZEN for independent review — HUMAN ACCEPTANCE PENDING.**
No model calls were made in this round (0). Nobody played this build by hand.

## 0. Baseline (verified, not claimed)

| Item | Value |
|---|---|
| cwd for every command | `D:/Project/LAST_SIGNAL/.cindy-worktrees/serene-leakey` |
| branch / HEAD | `cindy/serene-leakey` / `3819621c5faab56b114b6e5a560f8fe78c17709d` |
| commits made here | **0** (no commit / push / PR / merge) |
| main repo | `feat/gameplay-01-ai-cooperation` @ `3819621`, 4 dirty src files kept **read-only**, untouched |
| node deps | own `npm ci` in this worktree (`npm-ci.log.txt`) |

The four P4 candidate files were copied in as an explicit input patch. Their sha256 matched the
Lead/pre-review numbers exactly (`incoming/before-hash.log.txt`, `incoming/after-copy-hash.log.txt`):
World `84eac073…`, Headless `2ad18443…`, p1Scenario `d6dd9a48…`, relay `6fc7ba40…`.
Provenance is still **unknown** — a patch proves bytes, not authorship. Nothing in this report
treats those bytes as an authority; every claim below is re-tested on this tree.

## 1. Defects fixed (reviewer M-list)

### M1 — one authoritative room-clear commit (was: two different answers)
Before: Headless derived `cleared` from live drones; World/`core.descend`/`GameScene` read
`map.rooms[id].cleared`, which the Headless tick never set → 5 seeds diverged.

Now (`src/world/sim/core.ts`):
- `commitAuthoredRoomClear(state, events)` runs inside the core tick, **only** when
  `state.authored` exists (so every legacy run stays byte-identical). It commits
  `map.rooms[id].cleared = true` once, when the room has committed its own generation
  (`spawned`), no `room-enter` for it is still queued, no live drone spawned in it and no live
  target inside its bounds, then emits exactly one `room-cleared` event.
- `HeadlessWorld.routeState.roomCleared` now reads that same `map.rooms[id].cleared`
  (no drone count, no second rule).
- The rendered World only **reacts** to `room-cleared` (`World.applySimEvents`): seal, authored
  portal, `onRoomCleared`. It never re-writes the flag for the authored room.

Test: `worldHeadlessDemoRoute.test.ts` — "M1: the core clears the room exactly once and the
presenter reads the same flag" asserts the map flag, `routeState.roomCleared` and exactly one
`room-cleared` event.
Pre-existing duplicated `r.cleared = true` block in `World.updateRoom` (present before `1a6306f`) is
**untouched** (out of scope, not a P4 regression). The authored room never reaches it because the
core commits the clear first; P4 statistics count `room-cleared` events (once per room).

### M2 — demo / route identity survives snapshot, restore, replay, raw-sim restore
The authored scene identity now lives **inside the core state** (`SimulationState.authored`:
`{ id, roomId, startRoomId, routes[] }`, data only) and is part of the canonical projection.
Consequences:
- `HeadlessWorld.demoScenario` is a getter over `sim.authored` → `restore()`, `fromFrame()`,
  `fromSimulationState()` and `replay()` all keep the demo identity (the old `Object.create`
  field-initializer hole is gone).
- The route target/portal are always **re-derived from the committed relay state**
  (`routeTargetFor`), never inherited from a saved `portalTarget`.
- `World.restoreCheckpoint` now re-derives the authored portal (`updateP1RoutePortal`) instead of
  placing a legacy portal from the saved `portalTarget`.
- P2 single-pending, the unknown-restored marker and the exact core command queue are untouched.

### M3 — visible failure instead of silent degradation
`buildP1Scenario` returns **null** when the map cannot host a legal layout:
no second route, no walkable authored cell (no wall/centre pseudo-success), two routes collapsing
onto one cell, no device cell separated from the player start, or fewer than two distinct sentry
cells. `World.setupP1Scenario` turns that into the visible `p1ScenarioError`
(→ `DEMO 01 UNAVAILABLE` notice), `HeadlessWorld` throws.
Tests: `relayRoutes.test.ts` "P4 authored builder fails visibly (M3)" (3 synthetic maps) + a 5-seed
distinctness check.

### M5 / M6 — start-room identity and the documented hash delta
- `P1Scenario.startRoomId` is captured **before** the authored `kind` mutation; the builder picks
  the real `kind === 'start'` room instead of hardcoding `rooms[0]`.
- `HeadlessWorld.identity.startRoomId` (constructor and `fromSimulationState`) uses the captured id,
  so a restored demo world reports the same identity as a fresh one.
- M6 is documented in the builder: a demo map's hash differs from the same seed as an ordinary run
  (kind mutation + two `connectedTo` edges). Parity tooling must not compare them blindly.

### M7 — portal presentation == interaction point
`makePortal` now takes a **cell centre**; sprite, `F · R-xx` label, glow and `wx/wy` all use that
one point. Legacy callers pass `cellCentre(cell)`, the authored route passes the already-centred
authored portal. Rendered evidence asserts the presented portal equals the authored route portal
`{x: 11.5, y: 49.5}` on seed 20261117 (was half a tile off).

## 2. Design status vs `docs/gameplay/COOP_LEVEL_DESIGN.md`

| Design point | Status | Notes / limitation |
|---|---|---|
| §2 one authored deck slice, R0 start + linked sentry room with two route seals | **implemented** (authored start room, relay ACTIVE, 2 linked drones, route A/B portals) | The authored room IS the start room; `kind` becomes `combat` (as in P1) |
| §2 both routes legal solo, no ECHO dependency | **implemented + measured** | 3 seeds × route A and route B completed solo (`gates/demo-matrix.log.txt`) |
| §2 S3 ECHO-assisted is never stronger | **implemented** (same confirm boundary, no secret info) | ECHO runs measured **slower**, see §4 |
| §3 one pure shared rule, no second simulation | **implemented** | `routeTargetFor` + `buildP1Scenario` consumed by World and Headless |
| §3 portalTarget/checkpoint remains the persisted choice, old saves valid | **implemented** | `RunCheckpoint` fields unchanged; no save-format bump; old saves stay valid |
| §4 three seeds, device variants, disconnect variant | **partially**: 3 seeds ✓, device distinct from spawn ✓, door inside JAM_RANGE ✓; enemy/resource composition still comes from the existing generator (no new variants) | no new enemy kinds were authored |
| §5 metrics (time/damage/energy/actions/suggestions/route) | **implemented for the Headless driver**; rendered runs record time/hp/portal/route only | rendered ECHO suggestion metrics are the tester's E2E scope |
| §6 ownership/sequence | respected | no `tests/**`, no P3 menu/HUD change |

Known design-level limitation (honest): the authored fight is **short** under scripted fire
(2 kills in ~58 ticks), the player takes **0 damage** in all scripted runs, and the two route
portals are 1.0–4.1 tiles from the device — so the "two-branch decision" is spatially tight.
This is the P4 layout as authored; re-tuning distances/HP is a design decision that belongs to the
Lead, not a silent change here.

## 3. Rendered evidence (real input, seed 20261117)

`rendered/p4-demo.p4.spec.ts` → `gates/rendered-p4-evidence.log.txt` → **PASS 2/2**.
Data: `rendered/evidence/p4-rendered-evidence.json`. Shots: `rendered/shots/p4-1..7-*.png`.

| Step | Measured |
|---|---|
| real menu entry (`DEMO 01`) | scenario active, `startRoomId == roomId == 0`, relay `ACTIVE`, linked fire on, HUD `RELAY ACTIVE · EXIT OPEN`, energy 100 |
| layout | device (11.5, 48.5) vs player start (8.5, 45.5) = **4.24** apart; sentries (10.5,42.5) and (4.5,44.5) |
| before clear | `map.rooms[0].cleared = false`, **no portal** (`p4-1-early-playable.png`) |
| clear by REAL mouse fire | 2 shots, 2 kills, HP 100 → 94, tick 161; `cleared = true`; portal `{11.5, 49.5}` target R-01 (`p4-2`) |
| stand on the authored door | portal↔relay distance **1.00** (inside `JAM_RANGE` 6) — natural jam, no teleport |
| press `Y` at the door | relay `JAMMED`, route target `null`, portal **removed**, room stays cleared (`p4-4`) |
| press `F` while JAMMED | **no room change** (safety assertion intact) |
| jam expiry (~6 s) | relay `ACTIVE`, portal and route R-01 **restored** from the committed relay (`p4-5`) |
| `F` at the door | room 0 → **room 1** (route target) (`p4-6`) |
| exit/refresh → `CONTINUE` | authored identity kept, room restored cleared, portal re-derived = saved `{11.5, 49.5}` (`p4-7`) |

Rendered runs are labelled: real menu/keyboard/mouse input (agent), **NON-BLIND** steering
(direction chosen from canonical coordinates), no owner-confirm, **no human**.

## 4. Headless matrix (real intents, 3 seeds)

`driver/demoRun.mts` → `gates/demo-matrix.log.txt`, per-run JSON in `runs/`.
Real intents only; no `clearEnemies`/teleport/heal; the Owner confirmation is a **fixture**
(`confirmLocalEchoProposal(id, true)`, declared as such in every run note).

| seed | mode | completed | route | ticks (s) | damage taken | kills | ECHO suggestions | accept→effect |
|---|---|---|---|---|---|---|---|---|
| 20261117 | HumanOnly | ✅ | R-01 ACTIVE | 110 (1.83) | 0 | 2 | — | — |
| 20261117 | HumanEcho | ✅ | R-01 ACTIVE | 238 (3.97) | 0 | 2 | scan rejected → scan accepted | **1 tick**, echo energy 100→90, scanCD 119, evidence 1 |
| 20261117 | HumanEcho (reject only) | ✅ | R-01 ACTIVE | 237 | 0 | 2 | scan rejected (never accepted) | — |
| 20261117 | HumanOnly route B | ✅ | R-02 INACTIVE | 92 | 0 | 2 | — (1 manual R toggle) | — |
| 20261118 | HumanOnly / HumanEcho / reject / route B | ✅ ×4 | R-02 / R-05 | 114 / 242 / 241 / 109 | 0 | 2 | same shape | 1 tick |
| 20261119 | HumanOnly / HumanEcho / reject / route B | ✅ ×4 | R-05 / R-03 | 109 / 237 / 236 / 96 | 0 | 2 | same shape | 1 tick |

Honest reading:
- **Both routes are legal solo on all three seeds**; no seed requires ECHO.
- **Rejecting every suggestion still completes** (reject-only rows) and **ECHO offline == HumanOnly**.
- The ECHO was **not better**: HumanEcho took ~2× the ticks because the human-refusal cooldown was
  played out. No "co-op is faster" claim is made.
- Damage taken is 0 in every scripted run; that is what the authored encounter produced, not a
  hidden heal (no heal call exists in the driver).
- Every run re-checks recovery: snapshot→restore, `fromFrame`, `fromSimulationState` all return the
  same route identity (`recovery.routeIdentityEqual = true` in all 12 rows).

## 5. Gates (one line each; logs under `gates/`)

- `npx tsc --noEmit` → **PASS** → `gates/typecheck.log.txt`
- `npx vitest run src/signal/relayRoutes.test.ts src/ai-native/worldHeadlessDemoRoute.test.ts` → **PASS** (26 tests) → `gates/new-src-tests.log.txt`
- `npx vitest run src/` → **PASS 70/70 files, 818 tests** → `gates/src-unit-suite-rerun.log.txt`
  (first run: 2 `ownerAuth.test.ts` failures `fetch failed / bad port` under parallel load; the file
  passes alone — `gates/ownerAuth-isolation.log.txt` — and in the re-run; untouched files, environmental)
- `npm run build` → **PASS** → `gates/build.log.txt`
- `npm run test:mcp-surface` → **PASS** → `gates/mcp-surface.log.txt`
- rendered P4 evidence spec → **PASS 2/2** → `gates/rendered-p4-evidence.log.txt`
- existing `tests/gameplay-01.spec.ts` test 1 (unmodified) → **PASS** → `gates/rendered-smoke-p1-test1.log.txt`
- `tests/checkpoint.spec.ts` + `tests/echo-portal-migration.spec.ts` + `tests/economy.spec.ts` → **PASS 9/9** → `gates/rendered-smoke-portal-specs.log.txt`
- headless matrix → **PASS 12/12** → `gates/demo-matrix.log.txt`

No threshold, timeout, assertion or test file was relaxed or edited. Full E2E belongs to Tester.

## 6. Hand-off

- Patch: `patch/p4-src-fix.patch` (tracked `src/` changes vs `3819621`, sha256 `fb5374da…`),
  new test file copied at `patch/new-files/src/ai-native/worldHeadlessDemoRoute.test.ts`.
- Tester (owns `tests/**`): the old P1 assertion `distanceRelayDoor > JAM_RANGE` now fails **by
  design**; the door is naturally jammable at 1.0 tile. Replace it with the natural-jam story that
  this delivery already measured in the rendered run (stand at door → `Y` → portal gone → `F` does
  not change room → expiry restores the route), keeping the range-refusal branch with a genuinely
  distant stand.
- Reviewer: focus on (a) the core clear commit being the single writer and firing once,
  (b) `SimulationState.authored` in the canonical hash (demo-only), (c) `makePortal` now taking
  centres for legacy callers too (verified by 9 portal/checkpoint/economy specs),
  (d) ECHO confirm is a fixture, not a human.
