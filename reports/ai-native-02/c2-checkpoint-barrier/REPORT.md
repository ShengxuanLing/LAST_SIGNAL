# C2 Checkpoint Barrier — Report

## Commit
`D:\Project\LAST_SIGNAL` branch `feat/ai-native-world-integration`

## Summary
Replaced the `checkpointPending` frame-guessing mechanism with a verifiable committed barrier (`hasUncommittedCommands()`). Checkpoint only captures fully committed transactions. Purchase deduction + equipment/item use the same atomic `set-player-data` core command. UI shows pending (not success) until checkpoint is saved. Uncommitted transactions are cancelled on exit/refresh.

## Changes

### 1. `src/world/World.ts` — committed barrier + capture guard

**Added `hasUncommittedCommands()`:**
```ts
hasUncommittedCommands(): boolean {
    return this._sim.pendingCommands.length > 0;
}
```
This is the committed barrier: true while commands are enqueued but not yet consumed by `core.processCommands`.

**Added guard in `captureCheckpoint()`:**
```ts
if (this.hasUncommittedCommands()) return null;
```
Checkpoint refuses to capture when commands are pending. Only fully committed transactions can be saved.

**Removed `processPendingCommands()`** (done in previous commit dd43b37).

### 2. `src/economy/main.ts` — commit-tracking supply terminal

**Replaced `checkpointPending` boolean** with `pendingReward` (number) and `pendingPurchase` (object|null).

**Room clear reward flow:**
1. Detect newly cleared room → `enqueueCurrency(payout)` → `pendingReward = payout`
2. Next `update()` cycle: `!hasUncommittedCommands() && safe` → `scene.saveCheckpoint()` → `pendingReward = 0`
3. If `stepFrame` processes 0 ticks (paused, low delta): `hasUncommittedCommands()` is true → don't save → wait for next frame

**Purchase flow:**
1. Double-click guard: `if (this.pendingPurchase) return;` — prevents duplicate deduction
2. `buySupply(before, supply)` → `enqueueSetPlayerData(purchased)` (atomic: currency deduction + equipment/item in one command)
3. `pendingPurchase = { roomId, index, name, price }` → feedback shows "Processing..." (not success)
4. `renderStock` disables all purchase buttons while `pendingPurchase` is set
5. Next `update()` cycle: `!hasUncommittedCommands() && safe` → `scene.saveCheckpoint()` → on success: feedback shows "Purchased X", `pendingPurchase = null`

**Paused UI purchase:**
- GameScene.update returns early when paused → stepFrame doesn't run → command stays pending
- `hasUncommittedCommands()` is true → don't save → wait for resume
- On resume: stepFrame commits → saveCheckpoint → report success

**Exit/refresh before commit:**
- `destroy()` discards `pendingReward` and `pendingPurchase`
- Commands never committed → on reload, restore from last committed checkpoint state
- No partial success shown

**Cross-check with GameScene:**
- SupplyTerminal calls `scene.saveCheckpoint()` directly (after barrier check)
- GameScene's `checkpointDirty` mechanism operates independently
- Both write to the same `saveSystem.writeCheckpoint` — idempotent (same data)

### 3. Regression tests (src/world/sim/core.test.ts)

| Test | Verifies |
|------|----------|
| B12 | Zero-tick frame: no state mutation, commands stay pending |
| B13 | Zero-dt economic reward: no commit; normal tick commits once with events |
| B14 | Committed barrier: hasUncommittedCommands true while pending, false after tick |
| B15 | Sub-tick multi-frame: multiple zero-tick frames commit nothing |
| B16 | set-player-data atomic: currency + equipment change together in one command |

## Verification of Single Commit Boundary

| Check | Result |
|-------|--------|
| `processCommands` called only from `core.stepSimulationTicks` | PASS (rg confirmed) |
| `new RNG(0)` only in core RNG stream | PASS (rg confirmed) |
| No public `processPendingCommands` | PASS (deleted) |
| `captureCheckpoint` refuses uncommitted state | PASS (guard added) |
| Owner bootstrap/restore uses private closures | PASS (#setPlayerData/#resetPlayer) |

## Unit Conformance to Original Spec

| Original Spec Item | Conformant | Notes |
|-------------------|------------|-------|
| enqueue* only validate/queue | YES | All methods queue-only |
| core.processCommands sole state mutator | YES | All state changes via processCommands |
| stepFrame(0)/paused no state change | YES | B12/B13/B15 tests |
| C1 enemy/resource/portal algorithms | YES | Via core RNG commands |
| Owner capabilities private | YES | #setPlayerData/#resetPlayer only |
| enqueueSetPlayerData as public command | YES | Queues set-player-data command |
| Human equip/upgrade via commands | YES | enqueueEquipWeapon/enqueueApplyUpgrade |
| 200+ seed C1 parity | YES | C1_ROOM_PARITY_PASS seeds=220 |
| Committed barrier for checkpoint | YES | hasUncommittedCommands() guard |
| Purchase atomic (deduction + item) | YES | enqueueSetPlayerData replaces all data |
| Double-click protection | YES | pendingPurchase guard + disabled buttons |
| Exit/refresh cancels uncommitted | YES | destroy() discards pending state |

## Gates
| Gate | Result |
|------|--------|
| typecheck | PASS |
| build | PASS |
| game:mcp:build | PASS |
| vitest run | 402/402 passed (24 files) |
| c2-room-generation-parity | C1_ROOM_PARITY_PASS seeds=220 |

## Remaining E2E Failures (test-contract, handled by Tester)
These tests expect synchronous state changes after `enqueue*` calls, which violates the new command-only contract. Per Lead instruction: tests NOT modified; Tester will triage.

| Test | Issue |
|------|-------|
| audit.spec.ts:65 | Sync state reads after enqueue* |
| checkpoint.spec.ts:61 | weaponKey read before stepFrame commit |
| checkpoint.spec.ts:140 | Upgrade state read before stepFrame commit |
| checkpoint.spec.ts:160 | Checkpoint save timing after enqueueCurrency |
| checkpoint.spec.ts:185 | Checkpoint save timing on resume |
| checkpoint.spec.ts:304 | Checkpoint save timing on death |
| economy.spec.ts:11 | Supply terminal + checkpoint timing |
| ai-native-world.spec.ts:257 | Flaky (passes individually) |

**Fixed:** `runtime-bugs.spec.ts:246` — now passes (was failing before this change).

## Not merged to main, stash untouched, history not rewritten
