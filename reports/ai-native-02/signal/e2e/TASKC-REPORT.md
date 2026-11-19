# AI-NATIVE-02 Task C — Signal collaboration: execution evidence

Commit: `363eb17` (previous in the same chain: `5037c82`, `50e1ce8`, `d100c92`, `4b2ab0d`)
Branch: `feat/ai-native-world-integration` (NOT merged with main, NOT pushed)
Date: 2026-11-16
Worker: `b7un4i0h7x3eqmtfrnyw8v65`

All paths below are absolute on the developer machine
(`D:\Project\LAST_SIGNAL\reports\ai-native-02\signal\...`).

## Gate results (this session, commit 363eb17)

| # | Gate | Command | Result | Log |
|---|------|---------|--------|-----|
| 1 | TypeScript (whole repo) | `npx tsc --noEmit` | PASS (exit 0, no output) | `e2e/tsc-final.log` |
| 2 | Full unit suite | `npx vitest run` | PASS 713/713 tests, 59 files, 163.63s | `e2e/full-vitest-20261116-002119.log` |
| 3 | Rendered→Headless Signal parity (hard gate) | `npx vitest run src/ai-native/signalRenderedHeadlessParity.test.ts` | PASS 3/3 | `parity/parity-replay-gate.log` |
| 4 | Rendered parity export (real browser) | `npx playwright test tests/signal-rendered-parity.spec.ts --project chromium` | PASS 1/1 (4.5s) | `parity/parity-export-run.log` |
| 5 | Signal cooperation chain E2E (rendered UI) | `npx playwright test tests/signal-coop-e2e.spec.ts --project chromium` | PASS 1/1 (8.3s) | `e2e/coop-run-7.log` |
| 6 | Official-SDK Signal authority matrix | `npx playwright test tests/signal-sdk-negative.spec.ts --project chromium` | PASS 1/1 (11.0s) | `e2e/sdk-negative-run-3.log` |
| 7 | Combined signal Playwright suite (4 files / 5 tests) | `npx playwright test tests/signal-coop-e2e.spec.ts tests/signal-rendered-parity.spec.ts tests/signal-sdk-negative.spec.ts tests/p3b-companion-owner.spec.ts --project chromium` | PASS 5/5 (28.0s) | `e2e/signal-suite-final.log` |
| 8 | Client build | `npx vite build` | PASS (built in 10.09s) | `e2e/vite-build.log` |
| 9 | MCP server build | `npm run game:mcp:build` | PASS (built in 1.28s) | `e2e/mcp-build.log` |

Precondition for 4–7: a real Vite dev server on port 5173 (`HTTP 200`), started and
managed by this worker (`/tmp/vite-dev.log`).

## What gate 5 proves (real rendered UI, no dev injection)

`tests/signal-coop-e2e.spec.ts` — 10 logged steps, 9 screenshots (`e2e/screens/`):

1. Default NEW RUN is legacy: `RELAY OFF · NO DEVICE`, portal open.
2. Pause → SETTINGS → `SIGNAL COLLABORATION · OFF` → ON is persisted/visible.
3. The real portal interact enters a NEW room and the World itself spawns
   `relay_main` (INACTIVE, powered, manual OFF); `signalView().exitOpen === false`.
   No `sim.signal` object is written by the test.
4. NEGATIVE: with the relay INACTIVE, interacting with the gated exit does NOT
   change the room (exit really impassable).
5. Human OWNER authorization in the Pause UI reaches `COMPANION CONNECTED`.
6. `echo_observe` (official Companion MCP SDK) reports the perceived device
   `relay_main` in state `INACTIVE` plus the echo's own `energy 100/100`.
7. Fixture-labeled `echo_suggest(toggle-relay, perceived_relay)` is accepted
   (grounded in real perception, not a fake observation).
8. Owner `CONFIRM FIRST PROPOSAL` queues exactly one `toggle-relay(enabled:true)`
   core command while the world tick is frozen (no early state write).
9. The next real core tick commits it: relay `ACTIVE`, HUD `ACTIVE`, exit opens.
10. A confirmed echo `scan` is committed by the next real core tick and charges
    ONLY the echo account (100 → 90); the player account stays higher.
11. The human advances through the now-open gated portal (room 3 → 5).
12. `echo_memory` / `echo_status` still served after the chain; zero console or
    page errors.

## What gate 6 proves (official MCP SDK > real bridge > real rendered game)

`tests/signal-sdk-negative.spec.ts` drives `dist-mcp/worldMcpServer.mjs` with the
official `@modelcontextprotocol/sdk` client:

* v1-shaped `scan` **without** `actor` → tool error; nothing queued, no energy
  spent, no receipt created.
* `actor:'echo'` → bridge queues, rendered controller rejects with
  `E_PERMISSION`; neither the player nor the echo account is charged, no queued
  command remains, relay untouched.
* `actor:'player'` scan → receipt `applied`, the player account really pays
  `SCAN_COST` (sampled in-page because energy regenerates), echo account stays 100.
* `actor:'player'` jam → receipt `applied`, player pays `JAM_COST`, relay becomes
  `JAMMED` (never `ACTIVE`), `manualEnabled` stays false, `powered` stays true.
* Jam expiry returns the relay to `INACTIVE` with manual/power unchanged.

## What gate 3 proves (byte parity, not two same-seed runs)

`tests/signal-rendered-parity.spec.ts` exports `initial.json`, `sequence.json`,
`rendered.json` from a REAL browser session (scan, jam, toggle, echo spawn,
neutral ticks, real damage). `src/ai-native/signalRenderedHeadlessParity.test.ts`
rebuilds `HeadlessWorld.fromSimulationState(...)`, replays the exact ordered
actions and asserts byte-identical canonical state + full event list, plus a
negative test where a divergent action order must differ.

## Source changes in this commit

* `src/world/echoView.ts` — `buildEchoObservation` now emits the echo-perceived
  device (`relay`, only inside the shared perception radius + explored + LOS),
  `objectiveBlocked` while that device is not ACTIVE, and the echo's own
  `energy`/`cooldowns`.
* `src/world/World.ts`, `src/ai-native/worldHeadless.ts` — both pass the same
  Signal input into that ONE projection (no second rule set, rendered/headless
  stay identical).
* `src/ai-native/companionFacet.ts`, `companionMcpTools.ts` — `toggle-relay` is a
  legal Companion suggestion kind.
* `tests/signal-coop-e2e.spec.ts` — real opt-in → real room-enter spawn → real
  Owner flow; negative exit-gating proof; screenshots + STEP log.
* `tests/signal-sdk-negative.spec.ts` — NEW official-SDK authority matrix.
* `tests/signal-rendered-parity.spec.ts` — structured export sequence.
* `src/ai-native/signalRenderedHeadlessParity.test.ts` — hard gate rewrite.

## NOT RUN / limits (explicit)

* NOT RUN: a real LLM producing the Companion suggestions — suggestions here are
  fixture-labeled (`fixture suggest toggle-relay …`), and this report never
  claims an LLM playthrough.
* NOT RUN: multi-seed Signal Combat batch as a separate Playwright gate in this
  session (covered by `src/world/sim/signalCombat.test.ts` inside gate 2).
* NOT RUN: cross-machine / other-OS runs; all numbers are from this Windows
  machine, single Playwright worker.
* NOT DONE by design: no merge with `main`, no push, no rebase, no stash
  operations; the errored developer session was left untouched.
* The parity artifacts are large (2.4 MB `initial.json`); they are evidence files
  and stay untracked.
