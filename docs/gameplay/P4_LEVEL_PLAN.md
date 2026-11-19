# GAMEPLAY-01 P4 — Cooperative level plan (read-only preparation)

Date: 2026-11-17. Status: **READ-ONLY P4 PREPARATION — not implemented.** Written
after the P3 v2 display freeze (`reports/gameplay-01/developer/p3/v2/manifest.json`).
No `src/`, `tests/`, config, save or P4 code is changed here. P4 starts only after
the Lead's formal implementation order; P3 v2 remains the current display candidate.

## 1. Objective

Formal-World DEMO-01 cooperative level with two legal routes, built on the P1
authored slice:

- **HumanOnly** and **HumanEcho** can both legally complete. A solo run must never
  be forced to fail; ECHO value is measured, not assumed.
- Rejecting local/ECHO suggestions, or playing with ECHO offline, must still leave a
  legal route to clear.
- Three authored seeds (P1 demo variants 20261117/18/19 or a documented successor)
  must each expose at least one legal route; no seed may require ECHO.
- Acceptance metrics: time, damage taken, player/ECHO energy, action count
  (move/fire/interact + T/Y/R), and acceptance failures (clear/route failures).
  Compare HumanOnly vs HumanEcho honestly; no "solo must fail" PASS.

## 2. Minimal shared core rule (no LevelRule framework)

The current route rule is Rendered-only:

- `src/config/p1Scenario.ts` owns authored `P1Route`/`P1Scenario` and
  `p1RouteFor(relay, routes)`.
- `src/signal/relay.ts` owns `routeMatches` (ACTIVE→A, INACTIVE→B, JAMMED/DISABLED→
  neither).
- `World.updateP1RoutePortal`/`p1RouteTarget` derive the Rendered portal.
- `HeadlessWorld` has no portal/route state today; P1 explicitly does not claim full
  route parity.

P4 adds **one minimal pure function**, not a framework:

```ts
// proposed shared location: src/signal/relay.ts (pure; no World/map import)
routeTargetFor(relay: RelayState | null, routes: ReadonlyArray<{ target: number; when: RouteWhen }>): number | null
```

Author data stays in `src/config/p1Scenario.ts` (`P1Scenario.routes`, room, relay and
drone positions). The Rendered presenter and the Headless route/checkpoint state
call the same function. No `LevelRule` registry, no generic route engine, no new
hazard/rule in `World` that Headless cannot replay.

## 3. Minimal file whitelist (proposed; not written now)

| File | Allowed P4 change |
|---|---|
| `src/signal/relay.ts` | add the pure `routeTargetFor`; keep `routeMatches` semantics |
| `src/config/p1Scenario.ts` | authored DEMO-01 layout: relay/door/spawn positions, routes, seeds; no framework |
| `src/world/World.ts` | presenter only: use `routeTargetFor`, portal placement, no duplicated rule |
| `src/ai-native/worldHeadless.ts` | same route target/portal state; replay/checkpoint of `portalTarget`; no Rendered-only rule |
| `src/types/index.ts` / `src/systems/RunCheckpoint.ts` | only if the existing `RunCheckpoint.portalTarget` needs a route companion field; prefer the existing field |
| `src/signal/relayRoutes.test.ts` | rule tests: each relay state → target, JAMMED neither, authored data seeds |
| `src/ai-native/worldHeadless*.test.ts` | Headless route/portal/checkpoint replay |

No `tests/**` edit (tester-owned); no `src/world/sim/core.ts` combat rewrite; no
Owner/epoch/permission/queue/restore change; no new MCP surface; no P3 copy edit
unless a later display order explicitly includes it.

## 4. Call chain (one rule, two presenters)

```
Menu DEMO 01
  → World.setupP1Scenario() (authored P1Scenario)
  → core signal state (relay ACTIVE/INACTIVE/JAMMED/DISABLED)
  → routeTargetFor(relay, scenario.routes)         // shared pure rule
      → Rendered: World.updateP1RoutePortal → placePortalForTarget(room, target)
      → Headless: route target/portal state → replay/restore from portalTarget
  → checkpoint: existing RunCheckpoint.portalTarget (+ coreState.signal)
```

The route target is derived from the committed core relay state only; no
proposal/pending UI state and no frame-local callback order may change it. The
P1 legacy `relayOutput`/`exitOpen` semantics stay unchanged for old rooms.

## 5. Layout and checkpoint checks

1. **Spawn/relay overlap:** P1 places player spawn and relay on the same cell
   (`distToRelay = 0.00`). P4 authored layout must exclude the player spawn cell
   after `findWalkableInRoom`; the device/label must not hide under the player.
2. **Portal–jam distance:** P1 door is 6.9–7.0 tiles from the relay, while
   `SIGNAL_TUNING.JAM_RANGE` is 6, so "stand on the door then jam" is not naturally
   reachable (the current teleport test is a fixture). P4 chooses a documented
   layout (move device/door or change the acceptance wording) and records it; the
   fixture label stays until it is naturally reachable.
3. **Checkpoint compatibility:** keep `RunCheckpoint.demo`, `portalTarget`,
   `coreState.signal`, `coreState.echo`; old saves without the field stay valid;
   restore must not inherit a stale route target if the relay state changed; the
   P2 single-pending/queue/restore rules are not modified by P4. Add a replay test
   for route target + portal after restore.

## 6. DEMO-03 plan (proposal only)

- Entry `DEMO 03 · TWO ROUTES` (normal player entry; replace view keeps the demo id;
  no Settings/opt-in dance).
- Authored room with relay + linked sentry + two route portals; relay/door/spawn
  corrected per §5. The route rule is the shared `routeTargetFor`; Rendered and
  Headless agree on the target.
- Three seeds (20261117/18/19 or documented successor), each with a legal route;
  route exclusion and no ECHO-only seed.
- Runs: **HumanOnly** (ECHO not enabled), **HumanEcho** (ECHO enabled, local
  confirm/reject, offline/reject still clear), and the **speculative** comparison
  with per-run time/damage/energy/actions/acceptance-failure metrics.
- Evidence: real menu/World screenshots, run JSON (seed/inputs/events/metrics),
  Headless route/checkpoint replay, and a declared fixture/human label. No human
  playtest is claimed unless a human actually plays.
- P1 "no-assist clear" tester finding is not fixed by P2/P3; P4 must re-check the
  layout/route and record the result honestly.

## 7. Stop point

This document is preparation only. P4 implementation waits for the Lead's formal
order after P3 v2 independent acceptance. No P4 source, tests, config, save or
commit is made now; P3 v2 remains frozen for re-review.
