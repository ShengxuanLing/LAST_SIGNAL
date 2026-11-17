# GAMEPLAY-01 — Signal Interactions (P1 design, not implemented)

Status: **P1-A/B STAGE engineering candidate PASS (reviewer P1_FINAL_REVIEW, 12
hashes match); full tester report pending; not overall GAMEPLAY-01 PASS. The
route/portal layer is Rendered-only (boundary stated in §10); the reviewer's six
non-blocking findings are P3/P4 TODOs (§11), not fixed in P1.** This document
started as the frozen P1 design and now records the real implementation status,
including the exact data contracts and the remaining P2/P3/P4 boundaries.

Authority rule (non-negotiable): **all environment damage / perception / shooting /
Relay causality runs in `src/world/sim`**, evaluated by the same core tick as the
rendered World and the Headless World. The `World`/renderer adapter only enqueues
commands and renders events. No second hazard rule in `World.update` or the
renderer.

Reuse rule: use the **existing core drone + the existing relay device**. No new
turret entity, no general "alarm framework", no map-wide route framework.

---

## 0. Reused assets (no new system)

| Asset | Real code | Reuse |
|---|---|---|
| Relay device + Scan/Jam/toggle/power | `src/world/sim/signalState.ts`, `src/signal/*` | Unchanged costs/cooldowns/ranges/TTL |
| Relay output + exit gate | `src/signal/relay.ts` (`relayOutput`, `exitOpen`), `World.tryInteract` | Unchanged semantics: only `ACTIVE` opens the exit |
| Ranged enemy | core drone (`SimDroneState`, `stepDroneAi`, `stepDrones`) | The "linked sentry" is a drone whose attack is gated by the relay; no new entity |
| Room graph / portal | `World.placePortal`, `World.tryInteract`, `RunCheckpoint.portalTarget` | Authored room only; old rooms unchanged |
| HUD / menu feedback | `GameScene`, `ui/menuKit` | Reuse |

`JAMMED` is **not** `INACTIVE`. `relayOutput`/`exitOpen` stay exactly as they are
(only `ACTIVE` outputs). Jam is a temporary suppression of the relay output; it does
not change `manualEnabled` and does not become a manual "off".

---

## 1. Data contracts (authored slice only; old rooms unchanged)

### 1.1 Room link table (combat environment)

A room template (authored slice only) may carry:

```ts
interface SignalLinkSpec {
  deviceId: string;                 // the room's relay
  droneIds: number[];               // core drones linked to it
  effect: 'attack-suppression';     // the only P1 effect; no new damage type
}
```

- Passed to the core via the existing `room-enter` command (new optional
  `signalLink` field) or via a dedicated core command. It is **data**, not a rule
  in the adapter.
- Default: absent. Old rooms have no link and behave exactly as today.

### 1.2 Route table (route choice)

A room template may carry:

```ts
interface RouteSpec {
  target: number;                   // legal connected room id
  when: 'RELAY_ACTIVE' | 'RELAY_INACTIVE';
  label: string;                    // e.g. "SEAL A · ACTIVE"
}
interface RoomTemplate { routes?: RouteSpec[] } // optional; old rooms absent
```

- Only rooms with `routes` use the two-exit rule. Old rooms keep
  `placePortal`/`nextRoomTowardUnvisited` unchanged.
- Route match is exact: `RELAY_ACTIVE` means `relay === 'ACTIVE'`; `RELAY_INACTIVE`
  means `relay === 'INACTIVE'`. **`JAMMED` matches neither** (it is temporary).

### 1.3 Device initial state (make the danger real)

Add an optional initial-state field on device spawn:

```ts
interface SpawnSignalDeviceCommand {
  deviceId: string; roomId: number; x: number; y: number;
  initial?: { manualEnabled?: boolean; powered?: boolean }; // default false/true
}
```

- Legacy default stays `manualEnabled=false, powered=true` (INACTIVE).
- The authored P1 room sets `initial.manualEnabled = true` so the relay starts
  **ACTIVE**: the linked danger is real on entry and Jam has a job.

---

## 2. P1-A — combat environment: "RELAY YARD · LINKED SENTRY"

One small room, not a whole map.

- Layout: one relay at the room centre (initial **ACTIVE**), two core drones linked
  to it (`signalLink`), one unlinked drone or stalker for pressure, one exit seal.
- The linked drone keeps its existing `stepDroneAi` movement; the only change is
  that its **attack** is gated in the core:
  - relay output true (`ACTIVE`) → attack allowed;
  - relay `JAMMED` or `INACTIVE` → no new projectiles while suppressed; movement
    may continue (it is a suppression, not a stun).
- No new damage number is invented: the danger is the drone's real projectile
  damage from `ENEMY_STATS.drone`.

### 2.1 Solutions (both legal solo; ECHO not required)

| Solution | Steps | Cost | Trade-off |
|---|---|---|---|
| S1 Fight through | Ignore the relay; fight the linked drones under fire | 0 Energy | Higher damage taken |
| S2 Jam window | Scan (10) → Jam (25, <6 + LOS) → 360 ticks with linked attacks suppressed → clear → re-open the relay if needed | 35 Energy | Exit is closed while JAMMED; must wait/expire or toggle |
| S3 Manual off | Owner toggle relay OFF (INACTIVE) → linked attacks off indefinitely → clear → toggle ON to open the exit | 0 Energy | Exit gate closed while OFF; a real state change, not a free win |

- S2 and S3 are different causal solutions, not one forced path.
- The device starts ACTIVE, so S1 is a real (harder) choice and Jam is valuable.
- ECHO may OBSERVE the relay/link and assist, but the room is beatable solo on the
  same seed. No mechanism requires the ECHO.

### 2.2 Failure / blocked states (honest, no charge)

| Situation | Result |
|---|---|
| Out of Scan range (≥12) / Jam range (≥6) | `E_OUT_OF_RANGE`-equivalent block, no charge, HUD reason |
| No line of sight | `E_PERMISSION`/LOS block, no charge |
| Cooldown | `E_COOLDOWN`, no charge |
| Energy below cost | `E_ENERGY_INSUFFICIENT`, no charge |
| Paused | no tick; the command commits only after resume |
| No device | command is a no-op with a clear "NO DEVICE" reason |

### 2.3 Scan reveals only local legal links

- Scan evidence includes the relay and the **linked drone ids in the same room**
  within the 12-tile + LOS perception. It never reveals future rooms, hidden enemies,
  or the route outcome beyond what is locally observable.
- Evidence TTL is the real `SCAN_REVEAL_TICKS` (480), not the unused
  `EVIDENCE_TTL_TICKS` (300).

---

## 3. P1-B — route choice: "TWO SEALS" (data-driven, solo-legal)

- One route room with two exits to two different room variants that rejoin later.
- `routes: [ { target: R3a, when: 'RELAY_ACTIVE', label: 'SEAL A' },
             { target: R3b, when: 'RELAY_INACTIVE', label: 'SEAL B' } ]`.
- The relay state selects which exit is usable:
  - `ACTIVE` → SEAL A; `INACTIVE` → SEAL B; `JAMMED` → neither (temporary).
- Both routes are legal solo; the choice is a state decision (toggle relay), not a
  forced ECHO dependency.
- The chosen `portalTarget` persists (see §5). Toggling the relay later does not
  silently rewrite the chosen target; it only changes which exit is currently
  usable, so the player can toggle back.

### 3.1 Two concrete solutions (for the P1 demo)

- **Route A (ACTIVE):** keep the relay on, take SEAL A into a drone-heavy room, then
  toggle off later if needed.
- **Route B (INACTIVE):** toggle the relay off, take SEAL B into a resource/elite
  room, then toggle back on.
- Both are legal with no ECHO. The ECHO can observe the seal labels and assist, but
  the choice remains the human's.

---

## 4. Core implementation shape (when P1 starts)

All of this is `src/world/sim`:

1. `SimSignalDevice` already holds `manualEnabled/powered/relay/jammedUntilTick`.
2. Add an authored-room `signalLink` (drone ids + device id) to the core room state.
3. In `stepDrones`/`stepDroneAi`, compute `attackAllowed` from the linked device's
   `relayOutput(relay)`; when false, skip the attack/projectile spawn, keep movement.
4. In the core room/portal interaction (or a core `route` helper), choose the exit
   whose `when` matches `relay`; `JAMMED` matches neither.
5. The `World` adapter enqueues `room-enter`/`spawn-signal-device` with the authored
   data and renders events. It does **not** run a hazard rule.
6. Headless uses the same core state; parity tests compare canonical state/events.

No new `signal-*` event type is required for P1-A if the linked drone simply emits
fewer `projectile-spawned` events; the relay change events already exist. If a new
read-only HUD reason is needed, it is derived from existing state, not a new protocol.

---

## 5. Save / restore acceptance (verified schema fact)

- `RunCheckpoint.portalTarget: number | null` **already exists** (`src/types/index.ts:132`),
  is validated (`src/systems/RunCheckpoint.ts:121`), captured
  (`World.captureCheckpoint`), and restored (`World.restoreCheckpoint` →
  `placePortal(room, run.portalTarget)`).
- Therefore **P1-B needs no route schema change**: the chosen target is persisted by
  the existing field. The relay state (`manualEnabled/powered/jammedUntilTick/energy/
  evidence`) is persisted in `coreState.signal` and deep-validated.
- The linked drone state does not need saving: a checkpoint is only captured in a
  safe, cleared room with no live enemies.
- If a later design needs a distinct route id beyond the target room, that is a
  separate minimal schema change with an explicit migration and a review. Not P1-B.
- Death semantics unchanged: death = `finishRun(false)` → next NEW RUN is a new R0;
  only exit/refresh restores the checkpoint.

---

## 6. Seed / authoring / reproducibility

- Fixed seed for the P1 demo; the authored room template supplies relay position,
  linked drone ids, route targets and room variants. No `Math.random` in gameplay.
- Same seed + same input sequence → same relay/link/route result in Rendered and
  Headless.
- Counterfactual evidence is required for acceptance: same seed, with/without Jam,
  and with/without the relay link, showing the measured difference.

---

## 7. Solo vs human+ECHO comparison (P4 rule applied to P1 too)

Both must be able to finish the slice on the same seed; neither is a designed loss.
Record for both: completion time, damage dealt/taken, Energy spent, action count,
suggestions accepted, scan/jam usage. Do not claim ECHO is better by design; report
the measured direction. A "solo must fail" result is **not** a PASS condition.

---

## 8. Acceptance tests (tester-owned; developer provides the hooks)

| Check | Expected |
|---|---|
| Initial relay ACTIVE | linked drone fires on entry; exit gate open |
| Jam | linked drone fires 0 projectiles for `JAM_DURATION_TICKS`; relay `JAMMED`; exit gate closed |
| Jam expiry | relay returns to the manual/powered state; attacks resume; exit re-opens if ACTIVE |
| Manual OFF | linked attacks stop; exit closed; manual ON restores both |
| Scan | reveals relay + same-room linked ids only; no hidden future room; costs 10 |
| Route A/B | only the matching route is usable; `JAMMED` matches neither; both solo-legal |
| PortalTarget | chosen target persists through a safe checkpoint; restore places the same portal |
| Headless parity | same canonical state/events as Rendered for the same inputs |
| Death/refresh | death → new R0; exit/refresh → checkpoint restore |

Evidence labels: `fixture` for scripted tests, `agent (real model)` for a real bridge
session, `human` only for a real person. No human playtest yet →
**ENGINEERING PASS / HUMAN ACCEPTANCE PENDING.**

---

## 9. Out of scope (explicitly not P1)

- New turret entity, general alarm/perception framework, map-wide route system.
- New skills/abilities (only Scan/Jam/toggle/power).
- Changing `relayOutput`/`exitOpen` semantics, Owner/epoch behavior, or the pause
  enqueue → next real tick rule.
- Any hazard rule in `World`/renderer that Headless cannot reproduce.
- Two routes where only one is passable, or a forced solo death.

---

## 10. Implementation status (P1, real code)

### 10.1 Implemented and verified

| Area | Real code | Status |
|---|---|---|
| Authored scenario data | `src/config/p1Scenario.ts` (`P1Scenario`, `P1Route`, `p1RouteFor`, `P1_DEMO_SEED`) | implemented |
| Link relationship + validation | `src/world/sim/core.ts` `SimDroneState.relayDeviceId`; `link-drones-to-signal` validates device id, live drone, same room; emits `signal-linked { linkedIds, skippedIds }` | implemented; negative tests |
| New-fire gate | `core.ts` `stepDrones` reads `signalOutput(relay)`; only `step.attack` is nulled; projectiles are untouched | implemented; counterfactual tests |
| Device initial state | `spawn-signal-device.initial { manualEnabled, powered }`; demo sets ACTIVE | implemented |
| Jam semantics | existing Scan/Jam cost/cooldown/range/LOS/duration; JAMMED is temporary, never INACTIVE; expiry restores the manual/powered state | implemented; tests |
| Route rule | `src/signal/relay.ts` `routeMatches`; ACTIVE→A, INACTIVE→B, JAMMED/DISABLED→neither; legacy `relayOutput`/`exitOpen` unchanged | implemented; tests |
| Authored route portal | `World.setupP1Scenario` (filters boss/extraction, deterministic seed rotation, explicit failure), `updateP1RoutePortal`, route-aware `tryInteract`/`roomObjective` | implemented; rendered-only |
| Save | `RunCheckpoint.demo?: 'p1'` optional; `portalTarget` existing; `coreState.signal` existing; old saves stay valid | implemented; restore tests |
| Demo entry | `MainMenuScene` `DEMO 01 · LINKED SENTRY` (normal player entry; replace view keeps `demo`); no Settings/opt-in dance | implemented |
| HUD | `GameScene` derives COST/RANGE/JAM seconds from `SIGNAL_TUNING`; keys `T SCAN · Y JAM · R TOGGLE`; `LINK · FIRE ENABLED` / `LINK · NEW FIRE BLOCKED · OLD SHOTS STILL LIVE`; route-aware exit label; P1 objective on its own line | implemented |
| Checkpoint first write | `GameScene.checkpointWritten` keeps the "first write replaces any run" contract when the demo starts in a live room (first capture is legitimately null) | implemented |
| Rule tests | `src/world/sim/signalLink.test.ts` (9), `src/signal/relayRoutes.test.ts` (5) | implemented |

The design's original `room-enter.signalLink` idea is implemented as the minimal
core command `link-drones-to-signal` (same semantics, explicit validation and
receipt). No MCP/agent surface was added; only `World.spawnP1Sentry()` issues it.

### 10.2 Headless coverage / boundary

- **Shared and headless-verified**: the relay→linked-drone attack gate, JAMMED
  suppression of new fire, old-projectile persistence, expiry restore, unlinked
  drone independence, energy/cooldown/failure semantics, and the scan-evidence
  field whitelist all live in `src/world/sim` and are covered by
  `signalLink.test.ts` (headless core; no Phaser). The normal Rendered→Headless
  Signal parity gate is regenerated in an isolated tree and passes 3/3.
- **Rendered-only (explicit boundary)**: route selection, portal placement,
  `portalTarget` persistence, room clear/objective, and the demo entry are
  `World`/scene orchestration. Headless does not place portals or rooms; P1 does
  **not** claim full route parity. P4 later adds core level rules if needed.

### 10.3 Not implemented (kept out of P1)

- P2 ECHO low-risk allowlist UI/modes (FOLLOW/OBSERVE/safe movement, authorization
  switch) — design only in the P0 baseline.
- P3 full causal explanation/feedback rework — P1 ships only the necessary
  link/cost/range/jam/blocked-reason HUD.
- P4 formal multi-route level with full solo/co-op comparison — P1 has the authored
  Demo-01 two-route slice only.
- Any MCP permission/protocol extension; any second hazard rule outside the core.

### 10.4 Evidence (P1)

- Design/status: this file; baseline: `docs/gameplay/GAMEPLAY_01_BASELINE.md`.
- Rendered A/B: `reports/gameplay-01/developer/p1/final/` (manifest, screenshots,
  JSON with seed/inputs/before-after/events); old generation is marked obsolete.
- Isolated Rendered→Headless parity: `reports/gameplay-01/developer/p1/logs/parity-isolated-*.log`.
- Rule tests: `src/world/sim/signalLink.test.ts`, `src/signal/relayRoutes.test.ts`.
- All harnesses are fixtures/agent-driven; **no human playtest** →
  `ENGINEERING PASS / HUMAN ACCEPTANCE PENDING`.

---

## 11. P3/P4 follow-ups from the independent P1 review (NOT fixed in P1)

Source: `reports/gameplay-01/reviewer/P1_FINAL_REVIEW.md` §5/§6. These are
deliberately left open; P1 source stays frozen.

| # | Non-blocking finding | Reviewer evidence | Where it belongs |
|---|---|---|---|
| 1 | HUD detail contrast: `#5a7480` on `#05070c` = **4.07:1**, below WCAG AA 4.5 for the 10.63 CSS px compact text | `P1_FINAL_REVIEW.md` §3.7/§5.1; `audit` screenshot | **P3** — use a readable color (e.g. `#8fb8c8`) or larger text; this is a visual/accessibility fix, not a rule change |
| 2 | Player spawn and relay occupy the same tile (`distToRelay = 0.00`), so the device/label can be hidden under the player | §5.2 | **P3/P4** — authored layout should exclude the player spawn cell after `findWalkableInRoom` |
| 3 | An INACTIVE relay can still be jammed: `ok:true`, energy 100→76, relay JAMMED (a silent relay is made temporarily silent again) | §5.3 | **P3** — either reject with honest no-charge (`E_ALREADY_INACTIVE`) or keep it legal and show an explicit "already silent" hint; do not silently waste energy |
| 4 | Door is **6.9–7.0 tiles** from the relay (> `JAM_RANGE` 6), so "stand on the door, then jam" is **not naturally reachable**; the current test that teleports to the device is a fixture | §3.6/§5.4 | **P4** — move the device closer to the door or change the acceptance wording to "JAMMED ⇒ no portal ⇒ F blocked"; the fixture label must stay |
| 5 | Range/LOS rejection reuses `E_PERMISSION`, not a distinct range/LOS code | §3.6/§5.5 | **P3** — split `E_OUT_OF_RANGE` / `E_NO_LOS` for honest player feedback (keep the no-charge rule) |
| 6 | The natural walking path can detour through a room door and leave the room (walker ended in room 3) | §4/§5.6 | **P4** — record walk time/path length as a playability metric and review the layout; do not treat a walker failure as a product defect |

Also open (reviewer §6): reload→CONTINUE end-to-end restore, 3-seed route
exclusion, Headless route/portal equivalence, and the P4 solo/human+ECHO value
comparison were **not independently verified** by the reviewer. Developer evidence
exists for the first two and the runtime boundary is explicit; the final tester run
must re-check them, and P4 must add the headless-verifiable level rules. None of
these are claimed as P1 PASS.

**P1 status: stage engineering candidate PASS / full tester report pending / not
overall GAMEPLAY-01 PASS / HUMAN ACCEPTANCE PENDING.**
