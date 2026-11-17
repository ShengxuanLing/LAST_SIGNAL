# P2 final-v3 — raw-restore queue guard evidence

Status: P2 CANDIDATE (not overall PASS). This directory is the v3 evidence; the
v2 browser evidence under `reports/gameplay-01/developer/p2/final-v2/` is kept
unchanged. The old `demo02/` and old repeat-confirm remain known-bad.

## Reproduced RED (reviewer scenario)

- Reviewer: `reports/gameplay-01/reviewer/P2_V2_REVIEW.md` §2,
  `reports/gameplay-01/reviewer/p2-v2/headless-restore.mts/log`.
- Developer re-run before the fix: `restore-red.log` —
  `[4] restored {queued:1, guard:null}`, `[5] restored confirm {prop2, ok3:true,
  queued:2}`.

## Fix (minimal, no deletion / no fake local)

- `HeadlessWorld.fromSimulationState` keeps the core queue. If it contains an echo
  `signal-scan`/`signal-jam` or a `toggle-relay`, it rebuilds a conservative
  restored busy marker: exact command reference retained, `echoPendingLocal` is
  `{restored:true, proposalId:null, acceptedTick:null, kind}`, `propose` is null and
  `confirm` fails `E_ALREADY_PENDING`. The marker clears on the real core receipt,
  or after the command is no longer in `pendingCommands` (no deadlock). It is never
  labeled human-local and never fabricates a proposal id.
- Player/other-actor commands are preserved and left unmarked. An external Owner
  toggle is preserved (local confirm waits; the external tick still flips once).
  Room/clear-intent do not drop the restored guard while the command remains; only
  a full reset clears it. Explicit local cancel cannot delete an unknown restored
  command. A dead echo clears only an actually-local pending row (`E_ECHO_DEAD`).
- After the fix, the reviewer script: `restore-guard-reviewer.log` —
  `prop2:null`, `ok3:false`, `queued:1`.

## Headless tests (39 targeted total)

`src/ai-native/worldHeadlessEchoCoop.test.ts` now has 17 tests, including:

- restored scan/toggle: second confirm false, queue 1, one real tick/one signal
  change/one cost;
- player scan / external Owner toggle preserved without human-local labeling;
- room generation change does not clear the guard before the core;
- explicit local cancel does not delete the unknown restored command;
- dead echo does not leave a local guard stuck.

The restore test is `strict-targeted-v3.log`; the single earlier run is
`unit-v3-headless2.log`.

## Gates

- Typecheck: `logs/strict-typecheck-v3.log` PASS(0).
- Targeted 39/39: `logs/strict-targeted-v3.log`.
- Full pure original 15s/20s: `logs/strict-npm-test-v3.log` PASS 794/794.
- Build: `logs/build-final-v4.log` PASS.
- MCP surface: `logs/mcp-surface-final-v4.log` PASS 1/1.
- Fresh parity independent tree: `fresh-parity-export.log` (real Playwright 1/1),
  `fresh-parity-gate.log` (3/3), tree `D:/tmp/gp01-p2v3-parity` with its own
  reports. Main old `reports/ai-native-02/signal/parity` hash is unchanged
  (`1727d4e9…` before and after).
- v2 Rendered browser proof is kept in `final-v2/`; this v3 fix is Headless/parity
  only, no Rendered behavior change.

## Real save semantics

`RunCheckpoint.coreState` has no `pendingCommands`; `restoreCheckpoint` clears the
queue and resets the echo runtime. The checkpoint is pre-confirm, so a refresh
between a paused confirm and the next core tick loses that queued action. The UI
says `Queued`, never `Done`; after reload no pending receipt is resurrected.

## Lifecycle actual calls

`E_ROOM_CHANGED` and `E_ECHO_DISABLED` are called in the World; `E_LOCAL_REVOKED`
only in the explicit Headless test (no UI control); `E_ECHO_DEAD` in the dead-echo
drain; a new run goes through the core reset, so the unused `E_NEW_RUN` enum was
removed. Do not read this as each lifecycle enum having a UI test.

All browser evidence is fixture/agent-driven, not human acceptance and not a model
actor. No commit/push; P3 source remains waiting for the Lead order.
