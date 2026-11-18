# GAMEPLAY-01 P5 — enemy / resource **state presets** (minimal plan, NOT implemented)

Date: 2026-11-18. Scope: **planning document only.** No source, test, config, save or
content file is changed by this file. It exists because P4 v2 freeze deliberately keeps
the reviewed bytes stable; P5 variants are designed here so the next round can code
them against a fixed contract.

Reviewer finding F6: P4 has **no** new enemy or resource variant — `buildP1Scenario`
places 2 existing `drone`s and picks route targets by rotation. P5 must close that gap
without inventing a new enemy kind, skill, tool, MCP surface or a second simulation.

---

## 1. Design constraint (non-negotiable)

Every P5 variant must be a **state preset of mechanics that already exist in the core**:

| Existing mechanic | Where it already lives |
|---|---|
| `drone` enemy with `relayDeviceId` link gating (linked drones only fire while the relay outputs) | `src/world/sim/core.ts` `stepDrones` (`attackAllowed = !linked || signalOutput(signal)`) |
| Relay manual/power/initial state, JAM suppression | `spawn-signal-device` `initial`, `commitToggleRelay`, `commitSignalJam` |
| Room kinds (`combat` / `elite` / `resource` / `shop`) drive enemy mix and loot/terminal generation | `pickEnemyKindForRoom`, `room-enter`, `terminalRooms` |
| Core loot (`currency` / `health`) and supply terminals | `state.loot`, `purchase-supply` |

So a preset is **authored data + at most passing ids**, never a new rule.

---

## 2. The three presets

### V1 — Sentry link mix (`linked` × `unlinked`)
- **Data:** 2 drones on the authored sentry cells; only the first id is included in
  `link-drones-to-signal`. The unlinked drone fires regardless of relay state (existing
  rule), so JAM no longer fully disarms the encounter.
- **Why it is legal solo:** the unlinked drone is an ordinary `drone`; bullets/cover and
  the existing 12-tile weapon work unchanged.
- **Measures:** does the human's "Y JAM then clear" window still buy time? Distinguishes
  "relay window" from "relay autopilot".

### V2 — Relay initial state as a preset (`armed` × `manual-arm`)
- **Data:** `initial: { manualEnabled: true, powered: true }` (today, ACTIVE) **or**
  `{ manualEnabled: false, powered: true }` (INACTIVE → route B open first, no linked
  fire until the human presses `R`).
- **Why it is legal solo:** `R` is an existing human control; route B is already legal.
- **Measures:** whether the level reads differently when the player must arm the device
  instead of the device starting hot. Also splits route A/B first-choice pressure.

### V3 — Route payoff by room kind (`resource` × `shop`/`elite`)
- **Data:** instead of rotating route targets (`li = seed % targets.length`), each seed
  declares a **preferred kind** per branch: branch A prefers `resource` (core loot), branch
  B prefers `shop` (a supply terminal) or `elite` (harder mix) — taken from rooms the
  generator already produced. If the preferred kind is absent, the current rotation
  fallback applies and the preset is recorded as `degraded` (never silent).
- **Why it is legal solo:** both rooms are ordinary generated rooms reachable by the same
  portal rule; no new content.
- **Measures:** route choice becomes a real risk/reward decision (time + damage vs credits).

Preset selection stays deterministic from the seed (`seed → {variant, initial, kindPreference}`),
so 3 authored seeds × 3 presets remain reproducible and comparable.

---

## 3. Files to touch (planned, minimal)

| File | Planned change |
|---|---|
| `src/config/p1Scenario.ts` | authored preset table: `linkedDroneCount` (or per-drone `linked: boolean`), `initial` variant, `preferKind` per route, `degraded` reason flag. Builder stays pure, Phaser-free, and all-or-nothing (P4 F1 contract). |
| `src/world/World.ts` | `spawnP1Sentry()` passes only the authored linked ids to `link-drones-to-signal` (no new rule). |
| `src/ai-native/worldHeadless.ts` | same id subset in the demo constructor; `routeState` unchanged. |
| `src/world/sim/core.ts` | **expected: no change** (link gating and `initial` already exist). If a change is truly needed, it must be data-only and reviewed separately. |
| `src/config/p1Scenario*.test.ts`, `src/ai-native/worldHeadlessDemoRoute*.test.ts` | extend existing files: preset data invariants + per-preset legal completion. |

**Explicitly out of scope:** `src/config/enemies.ts` (no new stats/kind), new loot kinds,
new abilities, any `LevelRule` framework, any new MCP tool, `tests/**` (tester-owned).

---

## 4. Balance targets (what "good" means, per preset)

Measured on 20261117/18/19 with the existing Headless driver (real intents, ECHO off and on):

1. **Solo-legal, not ECHO-forced:** HumanOnly completes both branches on all 3 seeds,
   ends with **≥ 40 % HP**, and no step requires the ECHO.
2. **Readable difference:** each preset differs from the baseline on ≥ 1 axis by a margin
   larger than run-to-run noise — time **≥ 10 %**, damage **≥ 3 HP**, or credits **≥ 20**.
3. **Relay semantics visible:** with the relay INACTIVE preset, the linked drones emit
   **zero** projectiles before `R` arms the device; with the unlinked preset, a drone keeps
   firing inside the JAM window.
4. **Route payoff:** the `resource` branch yields loot and the `shop`/`elite` branch yields a
   terminal/harder mix; the choice is not cosmetic.
5. **No new content:** event histogram contains only existing event types/kinds.

---

## 5. Measurable failures (a preset is unacceptable if any holds)

| # | Failure | How it is detected |
|---|---|---|
| 1 | Solo run cannot complete on any seed (death before clear, or portal unreachable) | driver/Headless `completed: false` with `terminalStatus: 'dead'` |
| 2 | A preset requires the ECHO (some step impossible without echo) | ECHO-off run fails while ECHO-on succeeds **on the same seed** |
| 3 | Two presets are indistinguishable | all metric deltas below the §4.2 margin |
| 4 | Link gating is ignored (unlinked/linked distinction has no effect) | linked drone emits projectiles while relay is INACTIVE/JAMMED |
| 5 | The authored layout degrades silently | `degraded` flag set without a recorded reason, or a map mutation on `null` |
| 6 | Scope violation | any new enemy kind, loot kind, skill, tool or MCP surface in the diff |
| 7 | Door-jam safety story breaks | portal not `null` while JAMMED, or `cleared` flips back on jam |

---

## 6. Sequencing

1. P4 v2 freezes (no further P4 bytes).
2. Tester lands the P4 E2E assertions (natural door jam cost, F blocked, expiry restore,
   route entry) — see `docs/gameplay/P4_TEST_AND_FINAL_LIMITS.md`.
3. P5 codes V1 → V3 in that order (V1 is the smallest: one id subset), each with its own
   rule test and a driver row, then a rendered check on 1 seed per preset.
4. Only after that: 3-seed **rendered** completion and any balance claim.

Until then the P4 statement stays: **engineering delivered, HUMAN ACCEPTANCE PENDING,
P5 open, no balance conclusion.**
