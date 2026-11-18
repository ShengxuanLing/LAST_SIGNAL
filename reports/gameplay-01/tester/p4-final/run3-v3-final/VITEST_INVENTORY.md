# vitest inventory of the v3 run — 73 files / 859 tests, parsed per file from logs/unit-npm-test.log.txt

Vitest config: include `src/**/*.test.ts`, exclude `companionSurface.test.ts` and
`signalRenderedHeadlessParity.test.ts` (those two run in the integration stage:
`npm run test:mcp-surface` and `npm run test:parity`, both executed and green here).

## Delta relative to what the reviewer can check

| set | files | tests |
|---|---|---|
| **measured on the reviewed bytes (`npm test`, this run)** | **73** | **859** |
| base `3819621` unit subset (same include/exclude) | 69 | not measured separately |
| test files added by the manifest (4) | +4 | +46 (measured, see table below) |
| `src/signal/relayRoutes.test.ts` extended by the manifest | (in the 69) | 16 now; at HEAD it had 5 `it(` blocks, two of them loop-generated |

`npm test` = 859 tests / 73 files / exit 0. The exclude list is unchanged
(`companionSurface.test.ts`, `signalRenderedHeadlessParity.test.ts`), and those two run in
the integration stage (`npm run test:mcp-surface` 1/1, `npm run test:parity` 3/3 — both green
on this snapshot).

The 4 added files are exactly the manifest-delivered ones (sha256 equal to `manifest.v3.json`)
and `git status` shows no other `src/**` file changed:

| sha256 | file | tests | delivered in |
|---|---|---|---|
| `11c812f737e31183…` | `worldHeadlessDemoRoute.test.ts` | 10 | v1 |
| `93447a608519432d…` | `worldHeadlessFrameAuthored.test.ts` | 22 | v2 |
| `8b12cbf22b786f9d…` | `p1ScenarioLayout.test.ts` | 6 | v2 |
| `ec4139ffbfc47d9b…` | `worldHeadlessRestoreSafety.test.ts` | 8 | v3 |

## The developer number (818 / 70) vs this snapshot

I cannot reproduce 818/70 on the reviewed bytes and will not merge it into my numbers:
- 859 − 46 (new files) = 813 would only hold if `relayRoutes.test.ts` had not grown, but the
  manifest explicitly extends it (16 tests now vs 5 `it(` blocks at HEAD, two of them loops).
- 818 − 813 = 5, i.e. it is not "base + one of the delivered files" either; the developer's
  own v3 note says the full 818 suite was **not** re-run for v3.

What is checkable and what I sign: **73 files / 859 tests / exit 0** on these bytes, with the
per-file table below and `logs/unit-npm-test.log.txt`.

## Per-file counts

| file | tests |
|---|---|
| `src/ai-native/agentLease.test.ts` | 8 |
| `src/ai-native/budget.test.ts` | 5 |
| `src/ai-native/c3bBridge.test.ts` | 9 |
| `src/ai-native/c3bControl.test.ts` | 5 |
| `src/ai-native/c3cExportFlag.test.ts` | 5 |
| `src/ai-native/c3cOwnerFile.test.ts` | 7 |
| `src/ai-native/canonicalStability.test.ts` | 6 |
| `src/ai-native/companionBridge.test.ts` | 1 |
| `src/ai-native/companionFacet.test.ts` | 23 |
| `src/ai-native/companionGateway.test.ts` | 7 |
| `src/ai-native/companionInsights.test.ts` | 9 |
| `src/ai-native/companionRoomBoundary.test.ts` | 2 |
| `src/ai-native/companionRoomGeneration.test.ts` | 9 |
| `src/ai-native/control.test.ts` | 21 |
| `src/ai-native/coop.test.ts` | 21 |
| `src/ai-native/echo.test.ts` | 8 |
| `src/ai-native/echoCoop.test.ts` | 19 |
| `src/ai-native/echoView.test.ts` | 3 |
| `src/ai-native/externalLink.test.ts` | 11 |
| `src/ai-native/externalLinkDuration.test.ts` | 11 |
| `src/ai-native/externalLinkLifecycle.test.ts` | 6 |
| `src/ai-native/externalObservation.test.ts` | 6 |
| `src/ai-native/harness.test.ts` | 32 |
| `src/ai-native/ownerAuth.test.ts` | 8 |
| `src/ai-native/p4.test.ts` | 5 |
| `src/ai-native/protocol.test.ts` | 72 |
| `src/ai-native/runtime.test.ts` | 40 |
| `src/ai-native/sessions.test.ts` | 43 |
| `src/ai-native/task0.test.ts` | 9 |
| `src/ai-native/worldBridgeServer.test.ts` | 7 |
| `src/ai-native/worldGateway.test.ts` | 23 |
| `src/ai-native/worldHeadless.test.ts` | 13 |
| `src/ai-native/worldHeadlessDemoRoute.test.ts` | 10 **NEW** |
| `src/ai-native/worldHeadlessEcho.test.ts` | 4 |
| `src/ai-native/worldHeadlessEchoCoop.test.ts` | 17 |
| `src/ai-native/worldHeadlessFrameAuthored.test.ts` | 22 **NEW** |
| `src/ai-native/worldHeadlessHarness.test.ts` | 6 |
| `src/ai-native/worldHeadlessHistoryReplay.test.ts` | 9 |
| `src/ai-native/worldHeadlessMcp.test.ts` | 11 |
| `src/ai-native/worldHeadlessPlayerCrop.test.ts` | 19 |
| `src/ai-native/worldHeadlessRestoreSafety.test.ts` | 8 **NEW** |
| `src/ai-native/worldHeadlessSignal.test.ts` | 7 |
| `src/ai-native/worldHeadlessSnapshotBoundary.test.ts` | 7 |
| `src/ai-native/worldHeadlessStepChannel.test.ts` | 5 |
| `src/ai-native/worldObservation.test.ts` | 6 |
| `src/ai-native/worldPerception.test.ts` | 8 |
| `src/ai-native/worldProtocol.test.ts` | 9 |
| `src/config/p1ScenarioLayout.test.ts` | 6 **NEW** |
| `src/config/supplies.test.ts` | 7 |
| `src/core/runtime.test.ts` | 15 |
| `src/signal/relayRoutes.test.ts` | 16 |
| `src/signal/signalCore.test.ts` | 12 |
| `src/slice/corridorGuard.test.ts` | 3 |
| `src/slice/evidence.test.ts` | 11 |
| `src/slice/vs00.room.test.ts` | 3 |
| `src/slice/vs00.rules.test.ts` | 28 |
| `src/slice/vs01.corridor.test.ts` | 14 |
| `src/systems/SaveSystem.echoCoop.test.ts` | 3 |
| `src/systems/runCheckpoint.test.ts` | 7 |
| `src/ui/feedback.test.ts` | 8 |
| `src/world/actorTarget.test.ts` | 4 |
| `src/world/dungeon.test.ts` | 2 |
| `src/world/sim/core.test.ts` | 25 |
| `src/world/sim/echo.test.ts` | 11 |
| `src/world/sim/echoRoomTransition.test.ts` | 3 |
| `src/world/sim/parity.test.ts` | 4 |
| `src/world/sim/purchaseLedger.test.ts` | 6 |
| `src/world/sim/rewiring.test.ts` | 11 |
| `src/world/sim/rules.test.ts` | 11 |
| `src/world/sim/signalCombat.test.ts` | 32 |
| `src/world/sim/signalLink.test.ts` | 9 |
| `src/world/sim/signalState.test.ts` | 4 |
| `src/world/sim/targetRemoval.test.ts` | 2 |
