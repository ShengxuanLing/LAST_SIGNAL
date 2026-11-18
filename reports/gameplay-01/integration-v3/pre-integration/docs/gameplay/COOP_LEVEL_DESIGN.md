# GAMEPLAY-01 — Cooperative Level Design (P4 draft, NOT implemented)

Status: **minimal structure draft only.** No source/test/config change is made by
this document. P4 starts after P1/P2/P3 are committed and reviewed.

---

## 1. Goal and non-goals

Goal: one formal World scene where **Human Only and Human + ECHO are both legally
completable**, with at least two legal solutions. Cooperative value is shown by
observation and division of labour, never by a forced dependency.

Non-goals: a new game mode, a second simulation, a map-wide route framework, a new
ECHO skill, or a "solo must fail" acceptance condition. The P1 authored Demo-01
(two routes, Rendered-only) is the seed, not the finished P4 level.

---

## 2. Minimal level structure

One authored sector deck template (not the whole game):

```
R0 start (safe)
R1 LINKED SENTRY (relay ACTIVE + 2 linked core drones; the P1-A room)
R2 TWO SEALS (route A = relay ACTIVE, route B = relay INACTIVE; JAMMED = neither)
R3A / R3B different encounters/resource mixes
R4 boss/extraction (both routes rejoin; existing exit rules)
```

- Both routes are legal solo; no route, timer, door or mechanic may require the
  ECHO. ECHO is observation/support/assist, not a key.
- At least two legal solutions:
  1. **S1 direct combat** — fight the linked sentry under fire; use manual relay
     OFF/ON for the route decision.
  2. **S2 Signal window** — scan → jam (or manual OFF) to suppress new linked
     fire, clear, then choose route A/B.
  3. **S3 ECHO-assisted** (optional) — the human enables the ECHO, observes the
     relay/link, and uses Owner-confirmed scan/toggle suggestions; the human still
     fights and chooses the route. This must be no stronger than what a solo human
     can do on the same seed (same rules, no secret information).
- The ECHO is never the only perceiver of a mandatory target. Anything the ECHO
  sees is also reachable by the solo human through normal movement/scan.

---

## 3. Closing the P1 Rendered-only route gap (for Headless)

P1 route/portal is Rendered orchestration. P4 moves the **key level rule** into the
shared core (pure), so Headless can verify the same outcome without a second
simulation:

- The minimal pure `routeTargetFor`/`p1RouteFor` function (the same rule P1 uses)
  moves into the shared core (`src/world/sim` or `src/signal`) and computes the
  legal route target from the committed relay state + authored route table:
  `ACTIVE→A`, `INACTIVE→B`, `JAMMED/DISABLED→none`. No generic `LevelRule`
  registry/framework.
- The authored room seeds (device position/initial state, linked drone ids, route
  targets, enemy/resource variants) are data, passed through the same core
  `room-enter`/spawn commands; the core owns the link/gate/route state.
- `World` remains the presenter: it places the portal and objective from the core
  state; it does not own a second route rule.
- `portalTarget`/checkpoint remain the persisted choice; `coreState.signal`
  persists the relay state. Old saves stay valid.
- Headless test: same authored data + same tick inputs → same legal route target;
  the Rendered adapter is checked to only read the core result. No copied logic,
  no general level framework.

---

## 4. Variants (minimum)

- **3 seeds** (deterministic; e.g. 20261117/18/19): route targets/pairs, sentry
  positions, enemy/resource composition vary; each seed is reproducible.
- **Device variants**: relay offset from the player spawn (fix P1's spawn/relay
  overlap), and a variant where the door is within/without jam range (fix P1's
  6.9 > 6 unreachable standing-jam observation; the acceptance wording must match).
- **Enemy variants**: linked drones + unlinked pressure; no new enemy kind.
- **Resource variants**: resource/shop rooms on one route; the other route trades
  resources for a harder encounter (or vice versa).
- **Disconnect variant**: no bridge/model; the ECHO local policy works; the level is
  still completable; UI shows OFFLINE, never a fake connected state.

---

## 5. Measurement (no assumed superiority)

Same seed, run both:

| Metric | Human Only | Human + ECHO | Direction (measured) |
|---|---|---|---|
| completion time | | | |
| damage dealt | | | |
| damage taken | | | |
| Energy spent (player + echo) | | | |
| action count | | | |
| suggestions accepted / refused / expired | n/a | | |
| scan/jam usage | | | |
| route chosen (A/B) | | | |

Rules: both cells must be a legal completion; no cell may be a designed loss; the
report states the measured direction and never claims the ECHO is better by design.
The P1 reviewer's walking-path detour and door-distance observations are recorded as
playability metrics, not hidden.

---

## 6. Ownership and sequence (proposed)

| Area | Owner |
|---|---|
| Core level/route rule + authored data contract | developer (world/signal) |
| World presentation/portal/objective | developer (world) |
| ECHO observation/suggestion (P2) | developer (echo) |
| HUD/causal receipt (P3) | developer (UI) |
| E2E/regressions | tester |
| Independent review | reviewer |

Sequence: P1 commit → P2 ECHO allowlist → P3 minimal causal feedback → P4 level +
solo/co-op matrix. P4 does not start before P2/P3 are reviewed. No human playtest is
implied by any automated run; the final status remains
`ENGINEERING PASS / HUMAN ACCEPTANCE PENDING` until a real human plays.
