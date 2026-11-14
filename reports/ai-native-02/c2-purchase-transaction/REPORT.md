# C2 Purchase Transaction — Report

## Commit
`24f0a80` on `feat/ai-native-world-integration` (D:\Project\LAST_SIGNAL)

## Intent
Close the gap left by 1d5a8d7: the economy adapter pre-deducted on a `PlayerData`
snapshot and enqueued a whole-object `set-player-data`, so a purchase could
overwrite queued reward/HP/XP/equipment changes and was never re-validated at
commit time. This change adds a minimal, atomic core `purchase-supply` command.

## What changed

### 1. Pure supply rules — `src/config/supplies.ts` (new)
- Stable offer keys: `repair | calibration | weapon`.
- Prices fixed in `SUPPLY_PRICES` (16 / 28 / 40), `Object.freeze`d. No price is
  passed through a command argument, so neither an Agent nor a caller can
  override it.
- `loanWeaponFor(seed, roomId)` derives the offered weapon deterministically;
  callers only pass the `weapon` offer key.
- `supplyOfferPurchaseBlocker` (eligibility + balance), `applySupply` (effect),
  `terminalRooms`, `roomAt`, `clearReward` are reused by core and UI.
- No DOM/Phaser imports (static purity test).

`src/economy/supplies.ts` now delegates to this module for display; `buySupply`
remains only as a UI preview helper.

### 2. Core atomic command — `src/world/sim/core.ts`
- `SimCommand` adds `{ type: 'purchase-supply'; transactionId; offerKey; roomId }`
  (no price, no PlayerData).
- `processCommands` validates **at commit time against real live state**:
  1. idempotency: `transactionId` already in `purchaseTransactions` → reject
     `Duplicate transaction`;
  2. legal offer key → reject `Unknown offer`;
  3. player inside `roomId` → `Not in this terminal`;
  4. room is a terminal → `Not a supply terminal`;
  5. room cleared → `Room not cleared`;
  6. no spawned-but-uncleared room → `Clear remaining rooms first`;
  7. player alive → `Player is down`;
  8. no live core drone/boss/target → `Clear remaining threats`;
  9. offer eligibility + balance → real reason (e.g. `Not enough credits`).
- On success: clone player, deduct the fixed price, apply the effect, swap the
  player data atomically. On any rejection: no mutation.
- Emits `supply-purchase-result` receipt `{ transactionId, offerKey, roomId, ok,
  reason?, price, currency, hp, weaponKey }`.
- `SimulationState.purchaseTransactions: string[]` is a session dedup ledger
  (bounded to 256, not persisted). Reset on restore.
- Because `processCommands` runs sequentially in enqueue order, a queued reward
  (`add-currency`) and a purchase commit in either order to the same final
  state, and each purchase sees prior committed changes.

### 3. World wiring — `src/world/World.ts`
- `enqueuePurchaseSupply(transactionId, offerKey, roomId)` queues the command.
- `getSupplyReceipt(transactionId)` returns the committed receipt.
- `applySimEvents` stores `supply-purchase-result` receipts.
- **Barrier covers all uncommitted generation**: `hasPendingSpawns()` (real
  `worldSpawns` API) and `hasUncommittedCommands()` = core pending commands OR
  pending spawns. `captureCheckpoint` returns `null` while either is pending.
- `restoreCheckpoint` clears `pendingCommands`, `purchaseTransactions`,
  `worldSpawns` (restore never inherits uncommitted work).
- `enqueueSetPlayerData` is now dev/test-guarded (`assertDevTest()`): a normal
  live Player cannot wholesale-write HP/currency. Production purchases no longer
  use it.

### 4. Checkpoint capture after a real tick — `src/scenes/GameScene.ts`
- On a new run, `updateRoom()` queues the initial `room-enter`; one real
  `stepFrame` tick commits it, then the first checkpoint is captured. No flush.

### 5. Economy UI — `src/economy/main.ts`
- `purchase()` only records a pending transaction and enqueues `purchase-supply`;
  it no longer builds or sends a `PlayerData` snapshot.
- While the dialog is open the Phaser scene is paused, so no tick runs: the UI
  shows **"Close the terminal to complete your purchase of X."** (never a
  permanent "Processing") and disables buttons (double-click guard).
- Closing the dialog resumes the scene; the next tick commits; the receipt then
  drives the outcome:
  - success → save checkpoint, then show `Purchased X.` in the visible banner
    (`#supply-reward`, outside the dialog);
  - rejection → show the real reason and re-enable buttons;
  - storage failure → single retry message, retried on later frames.
- `destroy()` discards pending reward/purchase: exit or refresh before commit
  returns to the last committed checkpoint, with no false success.

## Verification highlights
- Reward-then-buy and buy-then-reward both end at the same currency/HP (B18).
- Heal + XP + purchase composite keeps every committed change (B19).
- Insufficient balance rejects atomically; the same tx id stays rejected even if
  balance later rises (B20); duplicate tx id deducts at most once (B21).
- Unsafe room, pending other rooms, and live core enemies all reject (B22,
  B22b); unknown offer rejects (B23).
- Equipment change before calibration is honored at commit (B24).
- Zero-tick frame commits nothing; one normal tick commits (B17).
- E2E: purchase commits on close and saves once; duplicate click blocked;
  committed purchase survives reload; insufficient credits disables offers;
  uncommitted purchase is discarded on reload and the last checkpoint is kept.

## Gates
See `logs/gate.log` (one line per gate). Summary:
- typecheck / build / MCP build: PASS
- targeted unit (core 24, supply-config 7, rewiring 10): PASS
- new E2E `tests/supply-transaction.spec.ts`: 3/3 PASS
- full unit: 420/421 — the single failure is `runtime.test.ts` CLI subprocess
  cold-start timeout (measured 6310 ms > vitest 5000 ms; evidence in
  `logs/cli-coldstart.log`); the same test passed in a prior warm run.
- full E2E: 43 passed / 5 failed (was 37/8 at 1d5a8d7).

## Remaining failures (existing E2E under Tester triage — NOT modified)
| Test | Reason |
|------|--------|
| audit.spec.ts:65 | Pre-existing contract (sync reads) |
| checkpoint.spec.ts:61 | weaponKey read before tick commit |
| checkpoint.spec.ts:140 | upgrade read before tick commit |
| checkpoint.spec.ts:185 | checkpoint timing |
| economy.spec.ts:11 | Legacy key-press/flow assumptions; new DOM-button regression passes |

These were not modified per instruction. Detection note: `economy.spec.ts:11`
uses a synthetic `g` key press; the new regression drives the real
`#supply-open` DOM button and passes, so the production path is covered.

## Known limits
- The dedup ledger is session-scoped (not saved); reload discards an uncommitted
  transaction and restores the last checkpoint (by design, to avoid enlarging
  the save).
- `purchaseTransactions` is intentionally excluded from canonical state (it does
  not affect RNG/gameplay), so Node vs rendered parity is unchanged.

## Not merged to main; stash untouched; C3b still frozen.
