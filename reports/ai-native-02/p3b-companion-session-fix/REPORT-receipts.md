# P3-b status receipts + paused observation publish (state-consistency fix)

Found in the Lead's real model run: `echo_status.pending` still listed two
already-confirmed-executed suggestions with `status: proposed`, while the Owner
panel showed `WAITING no proposal`; and the paused `echo_observe` lagged the
real post-commit state (cached tick 58 HP100 vs real tick 61 HP94).

## Fix

- `CompanionGateway.status()` now returns:
  - `pending` = ONLY undecided proposals (`facet.pendingSuggestions()` minus the
    session's decided ids), and `status.pendingSuggestions` = that real count.
  - `receipts` = read-only truthful ledger state, one entry per suggestion:
    `confirmed | rejected | applied | expired`, with real `decidedAtTick` and
    `appliedTick`. No Owner secret / private data.
  - `CompanionDecisionRecord` gains `appliedTick` (set only by `markApplied`).
  - expired receipts come from the facet's existing `evicted` set (TTL/cancel)
    via a new read-only `expiredSuggestionIds()`; the facet dedup semantics are
    unchanged, only aggregated for truthful reporting.
- Official `echo_status` tool returns `receipts` too.
- Post-commit observation publish: after a confirmed action's receipt is posted,
  and on entering Pause, GameScene pushes the latest committed observation (no
  tick advance, no per-frame fake increment). Before confirm, `proposed`
  behavior is unchanged.

## Gates

- typecheck PASS; unit 674/674; MCP build PASS; companion E2E 2/2.
- Duplicate decision never re-executes (`E_RETRYABLE` on decide + applied).
- New gateway test asserts pending excludes decided, count matches, receipts
  report applied/rejected with real ticks.
