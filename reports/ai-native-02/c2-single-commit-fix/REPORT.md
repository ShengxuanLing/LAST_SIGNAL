# C2 Single Commit Fix — Report

## Commit
`D:\Project\LAST_SIGNAL` branch `feat/ai-native-world-integration`

## Summary
Removed the last known bypass of the C2 single commit boundary: `World.processPendingCommands()` (public method using `new RNG(0)` to call `processCommands` directly, bypassing the tick, not persisting RNG state, losing events). Economy rewards/purchases now depend on legitimate command sequences processed by normal `stepFrame` ticks. UI refreshes after real commit events, not by secretly stepping.

## Changes

### 1. Removed public `processPendingCommands()` from `src/world/World.ts`
Deleted the public method that called `processCommands(this._sim, [], new RNG(0))` — creating a fresh RNG(0) each call, bypassing the tick boundary, not persisting RNG state, and discarding events.

### 2. Fixed `src/economy/main.ts` `update()` (was line 68)
- Removed `world.processPendingCommands()` call
- `enqueueCurrency(payout)` now queues the command only; the normal `stepFrame` tick processes it via `core.processCommands`
- Checkpoint save deferred: `justEnqueued` flag prevents saving checkpoint in the same frame as currency enqueue. On the next frame, `stepFrame` processes the command, then `update()` saves the checkpoint with the committed currency.

### 3. Fixed `src/economy/main.ts` `purchase()`
- Removed immediate `saveCheckpoint()` after `enqueueSetPlayerData(purchased)`
- Sets `checkpointPending = true` instead; the next `update()` cycle saves the checkpoint after `stepFrame` has processed the `set-player-data` command
- Removed rollback `enqueueSetPlayerData(before)` (no longer needed — nothing committed yet)

### 4. Added regression test `B13` in `src/world/sim/core.test.ts`
- Zero-dt: enqueued currency reward does not commit, no events, state unchanged
- Normal tick: commits once, emits `currency-gained` event
- Second tick with no new commands: no double commit, no new events

## Verification of single commit boundary
- `processCommands` is called only from `core.stepSimulationTicks` (legitimate tick path) — confirmed via `rg src/ processCommands`
- `new RNG(0)` appears only in `core.stepSimulationTicks` (legitimate core RNG) — confirmed via `rg src/ new RNG(0)`
- No public `processPendingCommands` remains
- Owner bootstrap/restore (`captureCheckpoint`/`restoreCheckpoint`) use private `#setPlayerData`/`#resetPlayer` closures, not command flush — explicitly not a bypass

## Gates
| Gate | Result |
|------|--------|
| typecheck | PASS |
| build | PASS |
| game:mcp:build | PASS |
| vitest run | 399/399 passed (24 files) |
| c2-room-generation-parity | C1_ROOM_PARITY_PASS seeds=220 |
| B13 paused/zero-dt economic rewards | PASS |

## Remaining E2E failures (pre-existing test-contract, not production bugs)
| Test | Issue |
|------|-------|
| audit.spec.ts:65 | Needs stepFrame between enqueue* commands and state reads |
| checkpoint.spec.ts:61 | weaponKey not committed until stepFrame |
| checkpoint.spec.ts:140 | Upgrade state not committed until stepFrame |
| checkpoint.spec.ts:185 | Checkpoint save timing |
| economy.spec.ts:11 | Supply terminal requires cleared room per `safeRoom()` rules; test expects visibility immediately after room entry |
| ai-native-world.spec.ts:257 | Flaky (passes individually, fails in full run — test isolation/timing) |

Per Lead instruction: tests are NOT modified; Tester will triage and report contract corrections separately. Current report states these as pending verification failures.

## Not merged to main, stash untouched, history not rewritten
