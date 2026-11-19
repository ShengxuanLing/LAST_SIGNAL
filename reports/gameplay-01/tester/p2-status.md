# GAMEPLAY-01 P2 test-body status (tester)

- Spec (mine): `tests/gameplay-02-echo-coop.spec.ts`
  sha256 `a8a793a1fc4da861aea901adf45a5e457feaf3c7aef3af6d25308aed3ba7e24f`（含 run3 之后的 harness 对齐注释改动，不覆盖已跑日志）。
- v2 known-bad tree kept at `D:\tmp\ls-p2-accept` (base 5aa90d8 + 10 P2 sources, own npm ci).
  Its 10 source hashes and the restore-counterexample signature are archived in
  `reports/gameplay-01/tester/p2-v2-known-bad.md`. **Not overwritten, not reused for v3.**
- v3 goes to a NEW tree `D:\tmp\ls-p2-v3-accept` (fixed commit + exact v3 manifest whitelist).

## What the file contains (no env gate, no skips)

`npx playwright test tests/gameplay-02-echo-coop.spec.ts` executes all tests directly.
No `P2_V3_FROZEN` gate, no `test.skip`, no `test.fixme` placeholders. Unimplemented
coverage is listed as TODO below, never as a passing/skip test.

## Current state (run on the v2 tree, `logs/p2-spec-run3.log`)

The file executes but **5/6 tests fail on harness/API alignment**, i.e. P2 evidence is
not yet produced. Concrete causes measured, each with the fix direction:

1. `echo actor exists` → null: enabling the ECHO is a **queued core command**; my test
   asserted immediately. Fix: enable → resume one real tick (`resumeGame`) → re-open the
   echo page, exactly like the P1 spec does.
2. `proposeLocalEcho()` → null: same root cause (no echo actor yet).
3. `control.takeover` is not a function: the non-human owner gate must use the real
   authority API (`ControlAuthority` takeover path) with its real name.
4. Overlap assertion on the ECHO page: needs the same-control exemption used in
   `tests/ui-menu-layout.spec.ts` (rect + its own label share the box; panels contain
   children). Current check flags legitimate pairs.
5. Cooperation toggle: the real UI is `LOCAL COOPERATION >` → `LOW-RISK COOPERATION: OFF`
   page (PauseScene), not a direct `setEchoCooperationOptIn` call. Test must click the
   real buttons and only then read the flag.

## Restore guard (v3 acceptance contract)

Test 4 encodes the v3 contract and is **expected RED on v2**:
restored core queue must equal the saved queue, a restored non-empty queue must carry its
pending guard, and a NEW confirm after restore must be refused (queue must not grow).
v2 fails exactly this (queue 1 / guard null → new proposal → queue 2).

## TODO (not implemented, tracked here)

- second toggle while the first is in flight (needs the toggle UI hook),
- external actor cannot act as ECHO (E_PERMISSION negative through the official SDK),
- formal HeadlessWorld decision parity for the cooperation policy,
- model-side ECHO chain (Magpie `group/elisa`) — waits for the reviewer's security PASS.

## Honest gate statements

- **No P2 gate has passed.** This session produced no `npm test`/parity/E2E claim for P2.
- The earlier `tsc` run that filtered out the P2 source errors is **not** a typecheck
  result and must not be reported as PASS; a full unfiltered `npm run typecheck` must be
  run on the v3 tree and any remaining source error goes back to the Lead.
- Full suite accounting must include every skipped / did-not-run test; the shared 125
  run stays non-green (117 passed / 4 failed / 4 skipped by the then-serial P1 file).

## Harness-fix round (per Lead's drive-fix order)

Done in `tests/gameplay-02-echo-coop.spec.ts` (sha256 `5cfe7560…`, typechecks clean):

- Added the real-UI helpers the fix needs and verified against the frozen v2 tree:
  `resumeGame()` (real ESC chain), `enableEchoAndSettle()` (real `ENABLE ECHO` click →
  resume → wait for core `echoActor` **and** a real tick increase → reopen page),
  `openLocalCoop()` (real `LOCAL COOPERATION >` page), `waitForLocalProposal()` (bounded,
  runs real ticks between attempts; never treats `null` while paused as a product failure).
- Real cooperation page discovered and used: `LOCAL COOPERATION >` →
  `LOW-RISK COOPERATION: OFF/ON`, `CONFIRM (HUMAN) · LOCAL`, `REJECT LOCAL`; the switch
  persists `permanent.echoCooperationOptIn` in the real save.
- Non-human owner path documented: real `AI & COMPANION` → `AI CONTROL` → resume until
  `control.owner === 'ai'`, then the switch must refuse. No fake `takeover`/owner writes.

Remaining wire-up (next edit, same file):
1. tests 1–3 must be converted to the real-UI flow (currently still call the product API
   directly); tests 1/2 then assert queue non-growth and the audit `rejected` entry.
2. viewport test: apply the `tests/ui-menu-layout.spec.ts` legal-overlap rules
   (same-control rect+label, non-interactive panel containing children, no two different
   interactive rects intersecting, no hidden-but-interactive).
3. restore test: behaviour contract only for the human-local confirmed-but-uncommitted
   action (no "any non-empty queue must have a guard"); unrelated commands preserved,
   new confirm refused, queue does not grow, original action commits exactly once.
   v2 stays the expected-RED counterexample.

Logs from the earlier run are kept and marked **harness-invalid** (5 reds were API/timing
mismatches, not product findings): `logs/p2-spec-run3.log`. This round produced no P2 gate
result; nothing here is a P2 PASS.
