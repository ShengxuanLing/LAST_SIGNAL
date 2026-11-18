# GAMEPLAY-01 — Cooperative Level Design · **P4 update draft (v2)**

> **This file is the proposed replacement for `docs/gameplay/COOP_LEVEL_DESIGN.md`.**
> The main-repo draft is untracked and read-only from the developer worktree, so the
> update is delivered as this separate file: copy it over `COOP_LEVEL_DESIGN.md` when
> integrating. Status wording below reflects the *P4 v2 freeze candidate*
> (`reports/gameplay-01/developer/p4-recovery/manifest.v2.json`), not a final pass.

Status: **P4 ENGINEERING DELIVERED (v2 freeze) — HUMAN ACCEPTANCE PENDING. P5 open.**

---

## 1. Goal and non-goals

Goal: one formal World scene where **Human Only and Human + ECHO are both legally
completable**, with at least two legal solutions. Cooperative value is shown by
observation and division of labour, never by a forced dependency.

Non-goals: a new game mode, a second simulation, a map-wide route framework, a new
ECHO skill, or a "solo must fail" acceptance condition.

**Implemented as:** the authored DEMO-01 entry (`MainMenuScene` → `GameScene`,
`demo: 'p1'`) hosts the level; the P3 menu/HUD copy stays frozen and no
`DEMO 03` label was added.

---

## 2. Minimal level structure — IMPLEMENTED

```
R0 authored start room (relay ACTIVE + 2 linked core drones + two route seals)
  ├─ ACTIVE   → route A portal
  └─ INACTIVE → route B portal      (JAMMED/DISABLED → neither)
```

- Both routes are legal solo. **Measured**: 3 seeds × route A and route B completed by
  a solo scripted player with no ECHO connection (`gates/demo-matrix.log.txt`).
- No route, timer, door or mechanic requires the ECHO.
- Three legal play styles remain available: direct combat, Signal window
  (scan/jam), and ECHO-assisted with owner confirmation. The ECHO is never the only
  perceiver of a mandatory target.
- **Limitation (honest):** the level is one authored room plus normal generated
  neighbours; there is no authored R3A/R3B distinct encounter yet (P5 §6).

---

## 3. One rule, two presenters — IMPLEMENTED

```
Menu DEMO 01
  → World.setupP1Scenario() / HeadlessWorld({ demo: true })
  → buildP1Scenario(...)                     // ONE shared authored builder
  → core signal state (relay ACTIVE/INACTIVE/JAMMED/DISABLED)
  → routeTargetFor(relay, scenario.routes)   // ONE pure rule (src/signal/relay.ts)
  → Rendered: World.updateP1RoutePortal → makePortal(centre)
  → Headless: routeState (same map flag, same relay)
  → checkpoint: existing RunCheckpoint.demo / portalTarget / coreState.signal
```

- The route target derives from the **committed** core relay state only; no
  proposal/pending UI state and no callback order can change it.
- The room-clear flag has **one writer**: the core (`commitAuthoredRoomClear`,
  exactly one `room-cleared` per room). Rendered World and Headless both read
  `map.rooms[id].cleared`. Legacy non-authored runs are byte-identical.
- The authored identity lives in `SimulationState.authored`, so snapshot / restore /
  replay / raw-sim restore keep it; a corrupt frame is rejected by
  `isHeadlessFrame` (bounded validation) instead of throwing later.
- The layout builder is **all-or-nothing**: a map it cannot host returns `null`
  without mutating the room graph; the rendered entry then shows
  `DEMO 01 UNAVAILABLE` instead of silently degrading.

---

## 4. Variants (minimum) — PARTIAL

| Variant | Status | Evidence / gap |
|---|---|---|
| 3 seeded authored layouts (20261117/18/19) | **DONE** | route pair, device/sentry cells, portals vary per seed |
| Device offset from player spawn (P1 overlap fixed) | **DONE** | 3.16–4.24 tiles apart on the 5 probed seeds |
| Door inside jam range (natural standing jam) | **DONE** | relay↔door 1.0–2.24 tiles; cost 23–24 energy (25 − regen) |
| Disconnect variant (no bridge; OFFLINE shown honestly) | **PARTIAL** | ECHO-disabled runs complete; the rendered OFFLINE UI path is P3/P2-owned and was not re-verified here |
| Enemy composition variants | **NOT DONE (P5)** | `buildP1Scenario` places 2 existing `drone`s only |
| Resource/shop variants per route | **NOT DONE (P5)** | route targets are picked by rotation, not by kind preference |

---

## 5. Measurement — PARTIAL, with corrected definitions

Same seed, both runs. Read every number with these definitions:

| Metric | Definition that must be used | Anti-misreading |
|---|---|---|
| completion | **Rendered**: a real room transition through the authored portal, proven on **one seed** (20261117). **Headless**: a *route projection* (`room cleared` + route target + player inside the portal radius), no room transition | never write "3 seeds cleared in the game" |
| time | core ticks (60 Hz) | scripted waits must be excluded (`ticksExcludingScriptedHold`) |
| damage taken | `damageTaken` from real `player-hurt` events | 0 damage under scripted long-range fire is **not** a balance sample |
| energy | `netEnergyChange*` is a net delta (regen included); the real action cost is the event delta (`actualScanCost` = 10, door `jamCost` = 23–25) | never compare a net delta with an action cost |
| suggestions accepted / refused / expired | P2 audit rows; owner confirmation in scripted runs is a **FIXTURE** | not a human |
| route chosen | A (relay ACTIVE) / B (relay INACTIVE) | JAMMED is neither, by design |
| ECHO comparison | HumanOnly = **no ECHO connection**, not a disconnect test; ECHO tick delta must subtract the scripted reject cooldown | no "co-op is better" claim |

Measured direction on the v2 evidence: with the scripted 125-tick reject wait removed,
HumanEcho and HumanOnly are within ~3 ticks of each other; ECHO is **not** shown to be
better and not shown to be worse as a rule.

---

## 6. P5 gap: enemy / resource state variants (plan only, not implemented)

See `docs/gameplay/P5_VARIANTS_PLAN.md`. Summary: three **state presets of existing
mechanics** (linked/unlinked sentry mix, relay-initial-armed vs manual-arm, route
target chosen by room kind for a resource-vs-shop payoff), each reachable by normal
play, none requiring the ECHO, no new enemy kind, skill, tool or MCP surface.
Deliberately **not coded** before the v2 freeze so the reviewed bytes stay stable.

---

## 7. Ownership and status

| Area | Owner |
|---|---|
| Core level/route rule + authored data contract | developer (world/signal) |
| World presentation/portal/objective | developer (world) |
| ECHO observation/suggestion (P2) | developer (echo) |
| HUD/causal receipt (P3) | developer (UI) |
| E2E/regressions | tester |
| Independent review | reviewer |

No human playtest is implied by any automated run. The final status stays
**ENGINEERING PASS (P4 v2, pending independent re-review) / HUMAN ACCEPTANCE PENDING**
until a real person plays. P5, 3-seed rendered completion and the formal E2E remain open.
