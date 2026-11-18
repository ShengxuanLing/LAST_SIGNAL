# GAMEPLAY-01 P4 — **v3 freeze candidate** (R1/R2 restore-entry fixes)

Date: 2026-11-18. Worker: `q331nefqzzh4gzn0hdbmnxwh`.
Status: **ENGINEERING DELIVERED (v3) — FROZEN for independent re-review — HUMAN ACCEPTANCE PENDING.**
0 model calls. No commit / push / merge.

## 0. Freeze and baseline

- cwd `D:/Project/LAST_SIGNAL/.cindy-worktrees/serene-leakey`, HEAD `3819621`, branch
  `cindy/serene-leakey`, 0 commits by this worker.
- Main repo's four dirty sources are untouched (re-verified after the work:
  `84eac073…`, `2ad18443…`, `d6dd9a48…`, `6fc7ba40…`).
- **Before** any v3 edit the v2 bytes were archived at `v2-freeze/` (9 sources + 3 docs +
  v2 manifest + driver/evidence/patch copies + `FREEZE-HASHES.log.txt`). v1 archive remains.
- v2→v3 exact diff: **2 files modified** (`src/ai-native/worldHeadless.ts`,
  `docs/gameplay/P4_TEST_AND_FINAL_LIMITS.md`) and **2 files added**
  (`src/ai-native/worldHeadlessRestoreSafety.test.ts`, `docs/gameplay/P4_RESTORE_CONTRACT.V3.md`).
  Every other source, doc, run and screenshot is byte-identical to v2.

## 1. R1 — frame `restore()` lost the single-pending guard (fixed)

Review reproduction: `confirm` → queue `['signal-scan']`, guard `{proposalId:'local_2_1',…}`;
after `snapshot → restore(frame)` the queue survived but `echoPendingLocal === null`, so a
second proposal could be confirmed into `['signal-scan','signal-scan']`.

I wrote the negative test **first** (`src/ai-native/worldHeadlessRestoreSafety.test.ts`):
against v2 bytes it produced **8 failures** (`v3/red-repro.log.txt`), including
`R1: a queued unknown-provenance signal must mark busy: expected null not to be null` and
R2's `TypeError: Cannot read properties of undefined (reading 'restoredPendingKind')`.

Fix (only in `worldHeadless.ts`):
- module-level `restoreSignalGuard(world, sim)` reuses the existing `findRestoredSignal()`
  and `EchoController.setRestoredPending()`. It clears the old `pendingLocalAction`,
  rebuilds `restoredSignalCommand` from the exact queued command, and marks the conservative
  busy state (`restored:true`, `proposalId:null`). It never fabricates a human-local receipt,
  never deletes the original command, and leaves other actors' commands byte-exact.
- `restore()` applies an authority/session boundary first: `echoController.reset()` (the same
  full reset the rendered checkpoint uses) + `pendingLocalAction = null`, then the shared guard.

## 2. R2 — `fromFrame()` had no echo runtime (fixed)

`Object.create` bypassed class fields, so `echoPendingLocal` / `runSteps` threw and `replay`
(which builds via `fromFrame`) crashed. Fix mirrors `fromSimulationState`: initialise the
**same** `EchoController`, `EchoAuditRing`, `echoRoomGeneration`, `pendingLocalAction`,
`lastEnqueuedSignalCommand`, `restoredSignalCommand`, then call the same
`restoreSignalGuard`. No new controller framework, no new module.

## 3. What the red→green tests prove

8/8 green (`v3/green-repro.log.txt`), for **scan and toggle each**:
- exactly **1** queued command survives restore (`restore` and `fromFrame`) byte-exact;
- guard is `{restored:true, proposalId:null, kind}`; `proposeLocalEcho()` → `null`;
  `confirmLocalEchoProposal(oldOrAnyId)` → `false` with `E_ALREADY_PENDING`;
- **no** applied/enqueued human-local audit row for the restored command (the only row is the
  honest rejection of the second confirm);
- one real tick commits the original command **exactly once** (scan: echo energy −10 and one
  `signal-scanned`; toggle: one `signal-relay-changed`, ACTIVE→INACTIVE), queue drains, guard
  clears by its real receipt and a new proposal is possible again (no deadlock);
- a mixed queue (player scan + echo scan) keeps **both** commands and executes both once;
- `fromSimulationState` returns the same guard projection as `restore`/`fromFrame`;
- `replay` (via `fromFrame`) is `ok/sameState/sameEvents` on a guarded frame;
- old frames without echo/authored still restore and run without a guard or a crash.

## 4. Contract wording withdrawn / narrowed

The historical blanket "P2 restore is safe on all paths" claim is **withdrawn**. New doc
`docs/gameplay/P4_RESTORE_CONTRACT.V3.md` lists only the four actually covered owner-restore
entry points: `fromSimulationState`, `restore(frame)`, `fromFrame`, `replay`. It also states
that `RunCheckpoint` intentionally **drops uncommitted commands** (different, unchanged
semantics; "Queued ≠ Done"). `P4_TEST_AND_FINAL_LIMITS.md` T12 was narrowed likewise and a
§2b correction added. **R3** (cross-version identity between `sim.authored` and
`World.p1Scenario`) is listed as a documented limitation, not fixed in this round.

## 5. Gates (command → result → absolute log)

| gate | result | log |
|---|---|---|
| `npx vitest run src/ai-native/worldHeadlessRestoreSafety.test.ts` (RED, v2 bytes) | **FAIL 8/8 (intended)** | `v3/red-repro.log.txt` |
| same (GREEN, v3) | **PASS 8/8** | `v3/green-repro.log.txt` |
| `npx tsc --noEmit` | **PASS** (0 errors) | `v3/gates/v3-typecheck.log.txt` |
| restore-safety + 4 v2 source test files | **PASS 62/62 (5 files)** | `v3/gates/v3-src-tests.log.txt` |
| 17 P2 / restore / replay / parity-unit / checkpoint / core boundary files | **PASS 221/221** | `v3/gates/v3-boundary.log.txt` |
| `npm run test:parity` (product generated inside this worktree in v2) | **PASS 3/3** | `v3/gates/v3-parity.log.txt` |

Not re-run by instruction: full 818 suite, full E2E, build. No rendered source changed in v3,
so v1/v2 rendered evidence is unchanged. No threshold/timeout/assertion was relaxed;
`tests/**` and the P2 Owner capability/confirmation protocol were not modified.

## 6. Hand-off

- `manifest.v3.json` — all source hashes, exact v2→v3 diff list, patch hashes, red/green and gates.
- `v3/patch/v2-to-v3-worldHeadless.diff` + `v2-to-v3-limits-doc.diff` — the two incremental diffs.
- `v3/patch/worldHeadlessRestoreSafety.test.ts` + `P4_RESTORE_CONTRACT.V3.md` — the two new files.
- `v3/patch/p4-src-fix-v3-full.patch` — full diff from HEAD for integration.
- Freeze: v1, v2, v3 archives all preserved; **do not edit the frozen sources** after this hand-off.

Limits carried forward: Headless completion is a route projection; rendered completion is one
seed; 0 damage is not a balance sample; HumanOnly = no connection (not a disconnect test);
owner confirmation in scripts is a fixture; P5 variants are plan-only; R3 cross-version identity
open; HUMAN ACCEPTANCE PENDING; overall GAMEPLAY not PASS.
