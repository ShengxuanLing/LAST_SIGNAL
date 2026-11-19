# P4 acceptance — pending decisions (recorded 2026-05-10, not yet implemented)

Status: **recorded, not executed.** P3 stays on its own tree; nothing here changes the P1
history tests in the P3 clone. The P4 work starts only after the frozen P4 manifest arrives.

## Source of truth (corrected)

- Real main repo branch: `feat/gameplay-01-ai-cooperation` @ **`1a6306f`** (not `main` @ `0faf95c`
  as the developer reported).
- P3 stays pinned at `7007ce2` **or** the original 5-source manifest already used
  (`D:\tmp\ls-p3-accept` @ `0083e20` + p3/v2 manifest).
- Do **not** pull the four dirty P4 trees.

## Product ruling that obsoletes one P1 assertion under P4

The P4 plan places the relay **beside the door**, so the natural door is Jam-reachable.

- `P1 test 4` asserts `distanceRelayDoor > JAM_RANGE`. Under the P4 layout that assertion is
  **obsolete** — it encodes the old (far) relay placement.
- Keep it in P1 as **historical evidence**; do not edit the P1 history test in the P3 clone.
- Under the frozen P4 tree, replace it with two explicit layout checks:
  1. from the **real door position Y**, a legal Jam is reachable (natural reachability);
  2. that Jam nulls the **real portal** and `F` does **not** change room;
  3. the real cost (`25`) and the expiry recovery behave as specified.
- Do **not** move the relay back to the far position to chase a green run.
- Do **not** prove natural reachability with `setPlayerPositionForTest`.

## Input-driver note (applies to future interaction cases)

Phaser `press()` can lose `JustDown` when the frame boundary swallows it. Where a case
depends on a single-frame edge, drive the **natural** sequence — `keydown` → at least one
real frame → `keyup` — and label it as an **input-driver fix**. This never relaxes a result
threshold, and an unreproduced failure must not be relabelled "pre-existing flaky".

## Ownership

Tests are owned by QA only; the Developer does not edit `tests/`.

## Gates for the P4 round (when it starts)

- Unfiltered `npm run typecheck`.
- The full P4 acceptance spec(s), no `skip`, no timeout/assertion relaxation.
- Per-run archive: actual spec + helpers, source manifest, before/after hashes, permanent
  `.log.txt`; PASS/FAIL with absolute log paths and the key failure line.
- No commit, no push.
