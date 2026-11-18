# GAMEPLAY-01 P4 — **v2 freeze candidate** (F1/F2 fixes + corrected metric definitions)

Date: 2026-11-18. Worker: Orca replacement developer (`q331nefqzzh4gzn0hdbmnxwh`).
Supersedes `P4_RECOVERY_DEV_REPORT.md` (v1). Status:
**ENGINEERING DELIVERED (v2) — FROZEN for independent re-review — HUMAN ACCEPTANCE PENDING.**
0 model calls. Nobody played this build by hand.

## 0. Baseline and freeze protection

| Item | Value |
|---|---|
| cwd for every command | `D:/Project/LAST_SIGNAL/.cindy-worktrees/serene-leakey` |
| branch / HEAD | `cindy/serene-leakey` / `3819621c5faab56b114b6e5a560f8fe78c17709d` |
| commits by this worker | **0** (no commit / push / PR / merge) |
| main repo | untouched: four dirty `src` files still `84eac073…`, `2ad18443…`, `d6dd9a48…`, `6fc7ba40…` |
| v1 archive | `v1-freeze/` — 7 sources, v1 manifest, v1 rendered evidence JSON, 7 v1 screenshots, `FREEZE-HASHES.log.txt` (archived **before** any v2 edit) |

The independent final review verified the v1 bytes by hash; those exact bytes are now archived
so the v1→v2 delta is auditable. v2 changed **two** sources (`p1Scenario.ts`, `worldHeadless.ts`)
and added **two** test files; `core.ts` and `World.ts` are byte-identical to v1.

## 1. F1 — layout is all-or-nothing (reproduced first, then fixed)

Reproduced exactly as the reviewer described, in this order:

1. Wrote `src/config/p1ScenarioLayout.test.ts` (negative first) → **3 failures**:
   ```
   FAIL  single-walkable-cell room: returns null and leaves kind/connectedTo untouched
   → map bytes must be identical after a failed build:
     expected '[{"id":0,"kind":"combat","connectedTo…'
     to be    '[{"id":0,"kind":"start","connectedTo"…'
   ```
   Same failure for "completely unwalkable room" and "two walkable cells too close".
2. Fixed `buildP1Scenario`: the route pair, `closestWalkable`, the portal-distinctness check,
   `relaySpot` and `sentrySpots` are all evaluated **before** the map is touched; only then do
   the two `connectedTo` edges and `kind = 'combat'` get written, in one step. No rollback and
   no generic transaction layer.
3. Re-run → **6/6 PASS**. The success-path layout is unchanged (same cells on 20261117/18/19),
   because only the write ordering moved.

Consequence for the product path: a rendered `DEMO 01 UNAVAILABLE` no longer leaves behind a
half-mutated map (`kind: 'combat'`, extra `connectedTo` edges) with an unspawned room.

## 2. F2 — bounded frame validation for the authored scene (reproduced first, then fixed)

1. Wrote `src/ai-native/worldHeadlessFrameAuthored.test.ts` (negative first) →
   **all 17 malformed-frame cases were ACCEPTED** by `isHeadlessFrame`, e.g.
   `routes` as an object, empty/3-entry routes, non-numeric or unknown `target`, unknown
   `when`, non-object portal, `portal.x` as string, `NaN`, `Infinity`, unknown/missing
   `roomId`/`startRoomId`, unknown `id`.
2. Fixed `isHeadlessFrame` with a small, data-shape-only `isValidAuthoredScene(value, rooms)`:
   `id === 'p1'`; `roomId`/`startRoomId` are numbers that exist in `sim.map.rooms`; `routes`
   is an array of length 1..2; each route has a numeric `target` that exists in the map, a
   `when` of `RELAY_ACTIVE`/`RELAY_INACTIVE`, an optional string `label`, and an optional portal
   whose `x`/`y` are **finite** numbers.
3. Re-run → **22/22 PASS**: every bad frame is refused with `E_SNAPSHOT_INVALID` (and
   `fromFrame` throws) **without damaging the live world**; a frame with **no** `authored` key
   (every pre-P4 frame, and all ordinary non-demo frames) is still accepted and restores with
   `routeState === null`; a valid demo frame restores the same identity.
   P2 exact-queue / unknown-restored-busy behaviour was not touched and stays covered by the
   boundary suite below.

There is no new validation file: the check lives next to `isHeadlessFrame` in
`src/ai-native/worldHeadless.ts` (one function, no new module surface).

## 3. F3 — the door-jam cost is now an assertion, not a side note

`rendered/p4-demo.p4.spec.ts` now asserts the real standing-jam cost at the authored door
(`JAM_COST` 25, `src/signal/signalTuning.ts`): measured **100 → 77 = 23** (25 − 2 points of
regen), asserted `>= 23 && <= 25`, alongside the existing route/portal/cleared/F assertions.
Re-run PASS 2/2 (`gates/v2-rendered-evidence.log.txt`).

## 4. F5 — metric definitions corrected (no run was re-executed to look better)

The 12 v1 runs are kept byte-for-byte and explained in `runs/README.md`. Only the **driver**
changed so future runs carry correct, self-describing fields:

| Old field | New field | Meaning |
|---|---|---|
| `signal.energySpentEcho` (net) | `signal.netEnergyChangeEcho` | net delta, regen included — **not** an action cost |
| — | `signal.actualScanCost` / `actualJamCost` | real cost of the last accepted action from its own event delta (scan = **10**) |
| — | `scriptedRejectHoldTicks`, `ticksExcludingScriptedHold` | isolates the script's 125-tick wait after a human refusal |
| `offLineSimulated: false` | `connectionState: 'no-echo-connection' \| 'echo-enabled-local'` | HumanOnly = **no connection**, not a disconnect test |
| — | `completedKind: 'headless-route-projection'` | `completed` is a projection, never a rendered transition |
| — | `balanceSample: false` | 0 damage is a recorded fact, not a balance conclusion |

Single v2 driver smoke (`runs/driver-v2-smoke-20261117-human-echo.json`), not a replacement
matrix: `ticks 238 → ticksExcludingScriptedHold 113` (HumanOnly is 110) — i.e. the "~128 tick
ECHO penalty" was almost entirely the scripted wait, and `actualScanCost 10` matches
`SCAN_COST` while `netEnergyChangeEcho 6` was regen-diluted. The v1 matrix numbers and their
readings are unchanged and documented in `runs/README.md`.

Narrative corrections applied everywhere in v2 (report + docs):
`completed` = Headless route projection (rendered completion is proven on **one** seed);
0 damage is not a balance sample; HumanOnly is not offline; the ECHO tick delta is scripted
waiting; `netEnergyChange` is not a cost.

## 5. Gates (v2, command → result → log)

| gate | command | result | log |
|---|---|---|---|
| typecheck | `npx tsc --noEmit` | **PASS** (0 errors) | `gates/v2-typecheck.log.txt` |
| new + changed source tests | `npx vitest run p1ScenarioLayout worldHeadlessFrameAuthored relayRoutes worldHeadlessDemoRoute` | **PASS 54/54 (4 files)** | `gates/v2-new-tests.log.txt` |
| boundary (Owner/P2/restore/replay/checkpoint/core/parity-unit) | `npx vitest run` 17 files incl. `ownerAuth`, `echoCoop`, `worldHeadlessEchoCoop`, `coop`, `control`, `runtime`, `core/runtime`, `canonicalStability`, `runCheckpoint`, `core`, `rules`, `echoRoomTransition`, `signalState`, `world/sim/parity`, `worldHeadlessHistoryReplay`, `worldHeadlessSnapshotBoundary`, `worldHeadlessEcho` | **PASS 221/221** | `gates/v2-boundary.log.txt` |
| parity hard gate | `npm run test:parity` | **PASS 3/3** | `gates/v2-parity.log.txt` |
| parity product regeneration | `PORT=5471 npx playwright test tests/signal-rendered-parity.spec.ts` (unmodified tester file, writes **inside this worktree**) | **PASS 1/1** | `gates/v2-parity-product.log.txt` |
| rendered evidence (real input) | `PORT=5471 npx playwright test -c rendered/pw.p4.config.ts` | **PASS 2/2** (now includes the jam cost assertion) | `gates/v2-rendered-evidence.log.txt` |
| build | `npm run build` | **PASS** | `gates/v2-build.log.txt` |
| MCP surface | `npm run test:mcp-surface` | **PASS 1/1** | `gates/v2-mcp-surface.log.txt` |
| driver smoke | `npx vite-node driver/demoRun.mts --seed 20261117 --mode human-echo` | **PASS** (new fields present) | `gates/demo-matrix.log.txt` (v1 matrix) + `runs/driver-v2-smoke-*.json` |

Full 818-unit-suite and full E2E were **not** repeated (Lead's instruction): the v1 full run is
`gates/src-unit-suite-rerun.log.txt` (70/70 files, 818 tests). No threshold, timeout or
assertion was relaxed; `tests/**` was not edited.

Note on the parity gate: the product JSON files under `reports/ai-native-02/signal/parity/`
did not exist in a fresh worktree, so they were generated **inside this worktree** by the
unmodified tester spec. The main repo's parity artifacts were not written to.

## 6. Evidence inventory (unchanged runs kept, new v2 items added)

- `runs/` — 12 v1 runs (kept) + `README.md` (field mapping and reading rules) + one v2 smoke.
- `rendered/` — v2 evidence JSON and 7 screenshots (v1 copies in `v1-freeze/`).
- `v1-freeze/` — the exact bytes the independent review verified.
- `patch/p4-src-fix-v2.patch` — tracked `src` diff vs `3819621`; new files under
  `patch/new-files/`; docs under `patch/docs/`.
- `manifest.v2.json` — full whitelist with sha256, gate map, artifacts.

## 7. Limits carried into the FINAL statement (also in `docs/gameplay/P4_TEST_AND_FINAL_LIMITS.md`)

- Rendered completion is proven on **one seed** (20261117). 3 seeds are Headless projections.
- 0 damage in the scripted runs is not a balance sample.
- HumanOnly = no ECHO connection; the disconnect/offline path was not exercised.
- Owner confirmation in scripted runs is a fixture, never a human.
- ECHO tick deltas must exclude the scripted reject wait.
- P5 (new enemy/resource variants) is a plan only — `docs/gameplay/P5_VARIANTS_PLAN.md`.
- The pre-existing duplicated room-clear block in `World.updateRoom` is untouched by decision;
  the authored room never reaches it.
- HUMAN ACCEPTANCE PENDING; overall GAMEPLAY is not PASS.
