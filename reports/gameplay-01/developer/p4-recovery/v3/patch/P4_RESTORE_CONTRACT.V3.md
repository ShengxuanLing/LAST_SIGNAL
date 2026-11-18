# GAMEPLAY-01 P4 v3 — restore safety contract: **actual entry-point coverage**

Date: 2026-11-18. This document **withdraws the historical blanket wording** that
"P2 single-pending / restore is safe on all restore paths". That statement was too broad:
independent review of the v2 freeze (`P4_V2_REVIEW.md`, R1/R2) proved two entry points did
**not** uphold it. The statement below replaces it and names only the paths actually
verified, after the minimal v3 fixes.

## 1. Withdrawn claim

> ~~"P2 single-pending / exact queue / unknown-source restored guard is preserved on
> every restore path."~~

Why withdrawn: on v2 bytes, `snapshot() → restore(frame)` kept the queued echo `signal-scan`
but **dropped** the busy guard (`echoPendingLocal === null`), so a second proposal could be
confirmed into the same queue (R1). On the same bytes, `fromFrame()` (used by `replay`) left
`echoController` undefined because `Object.create` bypasses class-field initialisation, so
reading `echoPendingLocal` or running steps threw (R2). Both predate v2 (base `3819621`),
but they are real failure paths and are now closed.

## 2. The contract that DOES hold (v3)

For a queued echo `signal-scan`/`signal-jam` or a `toggle-relay` with unknown provenance,
**each of the following four owner-restore entry points**:

1. `HeadlessWorld.fromSimulationState(sim, enteredRooms)` — the pre-existing correct path,
2. `HeadlessWorld.restore(frame)` — R1 fixed by rebuilding the guard after the frame is applied,
3. `HeadlessWorld.fromFrame(frame, bumpEpoch)` — R2 fixed by initialising the same
   `EchoController` / `EchoAuditRing` / pending fields as (1),
4. `HeadlessWorld.replay(frame, steps)` — inherits (3) because it builds its replay world
   with `fromFrame`,

now produces the **same conservative busy guard**:
`echoPendingLocal = { restored: true, proposalId: null, kind }`; `proposeLocalEcho()`
returns `null`; `confirmLocalEchoProposal(anyId, true)` returns `false` with an
`E_ALREADY_PENDING` **rejection** audit row (never an applied/enqueued human-local row);
the core queue is byte-exact (other actors' commands are untouched); the original command
commits exactly once on the next real tick (scan −10 echo energy, toggle one relay flip);
the guard clears by its real receipt with no deadlock.

No new controller framework was introduced: `restoreSignalGuard()` in
`src/ai-native/worldHeadless.ts` reuses the existing `findRestoredSignal()` classifier and
`EchoController.setRestoredPending()` marker. `restore()` first calls the existing
`echoController.reset()` session boundary (the same one the rendered checkpoint uses), so
an old local proposal cannot survive into the restored world.

## 3. Different semantics — NOT part of this contract

`src/systems/RunCheckpoint.ts` / `World.captureCheckpoint` intentionally **drop uncommitted
commands**: a paused confirmation is restored to the pre-confirm safe checkpoint
("Queued ≠ Done"). That is a different, deliberate product contract and was not changed by
v3. Do not merge it with the frame/raw-sim contract above.

## 4. Limit R3 (listed, not fixed this round)

`sim.authored` (core/Headless identity) and `World.p1Scenario` (rendered identity) are both
rebuilt by the same builder on the same version, so they agree today. Across **versions**,
an old checkpoint can carry an `authored` table produced by a different builder; the v3
fixes do not reconcile that cross-version identity, and the Lead has scoped it out of this
round. Status: **documented limitation**, not a P4/P5 blocker claimed as closed.

## 5. Evidence

- Red (v2 bytes): `reports/gameplay-01/developer/p4-recovery/v3/red-repro.log.txt` — 8 failures.
- Green (v3): `reports/gameplay-01/developer/p4-recovery/v3/green-repro.log.txt` — 8/8.
- Targeted tests: `src/ai-native/worldHeadlessRestoreSafety.test.ts`.
- Boundaries: `v3/gates/v3-boundary.log.txt` (17 files, 221 tests),
  `v3/gates/v3-parity.log.txt` (3/3), `v3/gates/v3-typecheck.log.txt` (0 errors).
