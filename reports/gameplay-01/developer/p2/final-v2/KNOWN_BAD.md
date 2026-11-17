# P2 final-v2 — known-bad pre-fix evidence (not PASS)

The following evidence predates the single-pending local-action fix and must not be
used as current evidence. It is kept unmodified.

1. **Reviewer BLOCKER1 repeat-confirm**:
   `reports/gameplay-01/reviewer/P2_FINAL_REVIEW.md` §1,
   `reports/gameplay-01/reviewer/p2/browser-local.log` (`[1]`/`[2]`/`[3]`),
   `reports/gameplay-01/reviewer/p2/after-confirm-paused-1280x720.png`.
   Pre-fix: paused tick 102, first CONFIRM generated `local_102_2` with CONFIRM still
   enabled; second CONFIRM generated `local_102_3`; `pendingCommands` went 1 → 2.
   This is the blocker; fixed in `final-v2/repeat-confirm.json`.

2. **Developer pre-fix demo02**:
   `reports/gameplay-01/developer/p2/demo02/demo02.json` and the
   `demo02-local-coop.mjs` run. Its `confirmedPaused` immediately contained a new
   proposal (`local_110_2`), the same pre-fix behavior. It was not overwritten.

3. **Old demo02 timing**: the pre-fix `demo02/demo02-timing.json` remains for
   history; the post-fix timing is `final-v2/demo02-timing.json` (paused frozen,
   first commit −10, damage after resume).

4. **Old relaxed full-suite run**: `reports/gameplay-01/developer/p2/logs/npm-test-final.log`
   (780/780) used the reverted CLI timeout relaxation; it is `obsolete-config`, not a
   gate. The current strict run is `strict-npm-test-v2.log` (786/786 at the original
   thresholds).

The post-fix evidence is in this directory: `repeat-confirm.json/log`, the scan /
toggle / switch / AI / disable screenshots, and `demo02-timing.json/log`.
All browser evidence is fixture/agent-driven; not human acceptance; no model actor.
