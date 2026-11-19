# GAMEPLAY-01 · P4 acceptance — PREPARATION report (nothing run against the dirty tree)

Date: 2026-05-10. Owner: QA (worker). Sources: main repo `feat/gameplay-01-ai-cooperation`
@ `1a6306f` for API reading only. **No product source touched**; the 4 P4-candidate files sit
in the worktree `M` but were not used for any acceptance run.

## Gates in this round

| check | command | result | log |
|---|---|---|---|
| prepared spec compiles | `tsc -p <tmp> --noEmit` pinned to the spec file | **PASS** (0 errors) | — (no log kept: no artifact, temp config removed) |
| prepared spec is discoverable, not skipped | `npx playwright test tests/gameplay-04-coop-level.spec.ts --list` | **PASS — 9 tests, skip 0** | in-message output only; re-runnable |
| P4 acceptance run | `PORT=… playwright test gameplay-04…` | **NOT RUN** — no frozen P4 manifest | — |
| P1 test-4 adaptation applied | — | **NOT RUN** — P4 tree not frozen | — |

`NOT RUN` is deliberate: the reviewer's pre-review has M1 (headless `roomCleared` diverges from
`map.rooms[id].cleared`), M2 (headless restore drops the route state), M3 (silent layout
fallbacks) and M7 (half-tile portal sprite offset) open. Running now would either produce reds
that are not product verdicts, or tempt a fake green. No `skip`, no timeout change, no gate.

## Deliverables

1. `tests/gameplay-04-coop-level.spec.ts` (sha256 `aa6b2298…`, snapshot in
   `tester/p4-prep/spec-snapshot/`), 9 tests, all real bodies:
   - 6 route runs: seeds **20261117/18/19 × HumanOnly/HumanEcho**, same seed per pair.
     Entry = the ordinary **DEMO 01** menu click (which shows the Demo-03 authored level in
     P4); non-default seeds are a declared `fixture: seed override` on the same entry.
     Real keys/mouse only: walk, aim, fire, `F`, `Y`. No `clearEnemies`, no teleport, no heal.
     Strategy coverage: observe (probe before acting), scan/jam (`Y` at the door), manual
     fire, route `F`.
     ECHO path: real local proposal → **Owner auto-confirm fixture** → real non-combat state
     change, recorded as accepted/applied, never assumed better than HumanOnly.
     Jam block: door within `JAM_RANGE` (natural), jam costs the real `25`, portal becomes
     `null`, `F` does not change room, expiry restores a selectable route.
     Completion gate: **`map.rooms[id].cleared` only** (`0 drones` is recorded, never used);
     the same seed's `HeadlessWorld.map.rooms[id].cleared` must agree (M1).
     Metrics recorded per run: elapsed ms, damage (hp start/end), energy, signal ops,
     suggestions accepted/rejected/applied, ticks. No ECHO advantage is asserted.
   - reject + offline: a rejected proposal leaves the relay not-JAMMED and the route still
     legally traversable; the model state is recorded, never faked.
   - **archive vs reload vs raw replay**: captured checkpoint bytes (archive) vs a real page
     reload + resume (route re-derived from the relay state) vs a headless replay of the same
     seed (must answer a route state, not `null` — M2).
   - portal presentation vs interaction point (M7: sprite centre ≤ 0.5 tile from the
     interaction point) and 3-seed layout validity (spawn ≠ device, door ≤ `JAM_RANGE`,
     layouts genuinely differ).
2. `tester/p4-prep/P1_TEST4_ADAPTATION.md` — exact replacement block for P1 test 4, applied to
   the P4 tree only: old `distanceRelayDoor > JAM_RANGE` and its `setPlayerPositionForTest`
   teleport go; natural door-position jam, real `25`, `portal === null`, real `F` no room
   change, expiry restores the route. Safety assertions kept; the rejected-jam case is
   rewritten (walk out of range) rather than deleted.
3. `tester/p4-prep/p1-test4.pre-p4.ts.txt` (sha256 `3b45b843…`) — the pre-P4 test body,
   archived so the change is a documented layout change, not an assertion deleted for green.
4. `tester/P4_PENDING_DECISIONS.md` — the product ruling (relay beside the door; P1 history
   kept; natural keydown→frame→keyup for single-frame edges; no `setPlayerPositionForTest`
   proof of reachability; unreproduced failures are not "pre-existing flaky").

## Explicitly NOT covered / NOT claimed

- No PASS is claimed for any P4 product behaviour; only the spec's own compilability and
  discoverability are green.
- Headless **input-chain** contrast (real per-tick intents vs browser play) still waits for
  the frozen manifest and the source unit-test interface; this spec only cross-checks the
  authoritative `cleared` flag per seed.
- P5-style full regression (P2/P3/Owner/reauth/save/headless) is out of scope this round.
- No commit, no push, no model call, no shared/old reports written.

## Next action on receipt of the frozen manifest

Pin + hash each source → apply the P1 test-4 adaptation → run the full P1 spec unfiltered →
run `gameplay-04-coop-level.spec.ts` unfiltered → archive spec/helpers/hashes/logs → report
PASS/FAIL/NOT RUN with absolute paths, and paste the key failure line for anything red.
