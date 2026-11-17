# GAMEPLAY-01 — ECHO Cooperation Behavior (P2 design, revised after review)

Status: **DESIGN CONTRACT — P2 IMPLEMENTED CANDIDATE.** The implementation and
verification status is now `docs/gameplay/P2_IMPLEMENTATION.md` (2026-11-17;
frozen candidate, independent review pending, not human acceptance). This document
remains the behavior/permission contract. At P2 design time real-LLM testing was
BLOCKED (no configuration); post-P0 the Lead's Magpie `group/elisa` **connection**
is reachable, but the P2 game model chain is not yet verified and nothing here is
faked as a real model.

This revision resolves `reports/gameplay-01/reviewer/P2_DESIGN_REVIEW.md` B1–B3 and
M1–M6. B1 chooses **option L (local proposal + human local confirmation)**; option F
is rejected. The B/M mapping is in `docs/gameplay/P2_DESIGN_RESPONSE.md`.

---

## 0. Real structures this design reuses (audited facts)

| Piece | Real code | What it is / is not |
|---|---|---|
| Echo actor + execution | `src/world/sim/core.ts` `SimEchoState`, `stepEcho`, `processCommands` | execution is **core**; the echo is an independent actor with its own HP/weapon/energy |
| Echo policy | `src/ai-native/echo.ts` `EchoController` (`follow/hold/move-to`, `assistConfirmed`, `suggestion`, `memory`, `observe/suggest/decide`, `clearForRoomTransition`, `reset`) | a **pure policy module in `src/ai-native`**, NOT in `src/world/sim`; it returns a `SimulationIntent` |
| Echo observation | `src/world/echoView.ts` `buildEchoObservation` | 12-tile strict radius + explored + LOS; relay only when the echo perceives it; own energy/cooldowns; no seed/map/future/hazard field |
| Companion facet | `src/ai-native/companionFacet.ts` | bridge/model suggestion kinds `move/aim/fire/scan/jam/toggle-relay`, reasons, TTL/cap memory; **no confirm tool** |
| Owner link | `src/ai-native/companionLink.ts`, `worldBridgeServer.ts`, `ownerAuth.ts` | Owner capability `#private`; `pending/decide`; heartbeat; room generation; reauth cancels unconfirmed. **Does not exist when there is no bridge.** |
| World integration | `src/world/World.ts` `enableEcho/disableEcho/setEchoMode/confirmEchoAssist/revokeEchoAssist`, `echoView`, `enqueueCompanionAction`, `pendingCompanionIntent`, `stepFrame` | `enqueueCompanionAction` is the **mechanical post-confirmation executor**; it performs no Owner check itself. Authorization is above it. |
| External echo guard | `src/ai-native/externalLinkController.ts` | external `actor:'echo'` scan/jam is rejected `E_PERMISSION` today (Companion/Owner domain) |
| Authority | `src/ai-native/control.ts` `ControlAuthority` | human/ai/external, paused, takeover, honest labels |
| UI | `src/scenes/PauseScene.ts` ECHO page, `src/ui/menuKit.ts` | existing enable/disable/modes/assist; no local proposal UI yet |
| Save | `src/types/index.ts`, `src/systems/SaveSystem.ts` | `permanent.signalCollaborationOptIn`; **no ECHO cooperation field today** |

Policy vs execution is explicit: `EchoController` decides; `stepEcho`/`enqueueCompanionAction`
execute. The policy is shared by the Rendered and Headless **entries**, but it is not
"inside the core".

---

## 1. Modes/actions (minimal mapping; no second controller)

| Requested | Design | Reuse | New (minimal) |
|---|---|---|---|
| FOLLOW | current `follow` (standoff 3) | `EchoController.decide`, `stepEcho` | none |
| HOLD | current `hold` | same | none |
| OBSERVE | new manual mode + bounded observation (neutral intent, no fire/move) | `echoView`, `EchoController.observe` | one `EchoMode` value + one `decide` branch |
| SUPPORT | current assist fire (human confirm) + existing `scan/jam` Owner suggestions | `confirmEchoAssist`, `companionFacet` | none (UI presents) |
| INTERACT | human-confirmed `toggle-relay` on a relay the echo perceives | `enqueueCompanionAction('toggle-relay')`, existing origin-room guard | local proposal + local confirm boundary |
| RECOVER | deterministic fallback to FOLLOW/return when echo HP ≤ threshold; no healing/resource | `follow`, `setEchoMode` | one policy branch |

No new skill, damage, actor, behavior tree, or agent tool.

---

## 2. B1 — Local proposal path (option L), no fake bridge

Offline there is no `CompanionLink`: no session/epoch/cap, no `pending()`, no
`owner-external` confirm. P2 therefore adds a **local-only proposal channel** that
never constructs a link or claims a model.

### 2.1 `EchoController.propose(legalView)`

Pure and non-executing. It may only use the echo's legal `EchoView` and returns at
most one local proposal:

```ts
interface EchoLocalProposal {
  id: string;                         // local, e.g. `local_<tick>_<n>`
  kind: 'scan' | 'jam' | 'toggle-relay';
  target?: { x: number; y: number } | null;
  reason: string;                     // real local reason (perceived relay etc.)
  evidenceRef: string;                // evidence/perception entry id, not hidden state
  observedTick: number;
  expiresAtTick: number;              // bounded TTL
  roomGeneration: number;             // the proposal is room-generation bound
  provenance: 'local-echo';           // fixed by the policy; agent cannot set it
}
```

- It does **not** enqueue, does **not** mutate HP/energy/world, and does **not**
  create a `CompanionLink` or write `companionStatus`.
- It is derived from the same legal view; no hidden map/future/hazard.

#### 2.1.1 Exactly one in-flight human-local action

The World (and the formal Headless) records one
`pendingLocalAction { proposalId, acceptedTick, kind, target, roomGeneration,
originRoomId, command }`:

- After a successful confirm the controller moves the proposal to
  `pendingLocalProposal`; `propose` returns `null` and `validateLocalProposal`
  returns `E_ALREADY_PENDING` until a real core applied/rejected receipt or an
  explicit lifecycle cancel.
- A second confirm — same id, a newly proposed id, or a direct boundary call —
  fails closed with `E_ALREADY_PENDING`, records the attempt with its proposal id,
  enqueues nothing and does not overwrite the pending row/queued command.
- The UI shows `WAITING FOR NEXT CORE TICK · <proposalId>` and disables
  CONFIRM/REJECT; the id is the same action, not a new proposal.
- Audit/receipt rows carry `proposalId`; a different action's receipt cannot clear
  the local pending row.
- Lifecycle: room-generation change, echo disable and explicit revoke call the
  cancel path, which removes **this exact command** from core, records `cancelled`
  with the proposal id, and only then clears the guard. New run/reset clears after
  the core reset. Owner becoming non-human does not retroactively cancel an already
  human-confirmed command; it blocks new local confirms. Switch OFF only withdraws
  autonomous movement. The external Owner path is unchanged.
- Raw-sim restore/parity: `fromSimulationState` keeps the core queue. If it
  contains an echo scan/jam or a relay toggle, the Headless rebuilds a conservative
  **restored busy** marker (`restored:true`, no proposal id, never human-local):
  `propose` is null and any confirm fails `E_ALREADY_PENDING` until the real receipt
  or the queue drains. The exact command is not deleted, other actors' commands are
  untouched, and an external Owner toggle is preserved (the local confirm waits).
  Room/clear-intent do not drop the marker while the command remains; only a real
  reset does. A dead echo can clear only an actually-local row (`E_ECHO_DEAD`), never
  an unknown restored/external one.
- Real save: the checkpoint `coreState` does not carry `pendingCommands` and restore
  clears them. It is the pre-confirm safe state; a refresh between a paused confirm
  and the next core tick loses the queued action. UI says `Queued`, never `Done`,
  and does not resurrect the pending row after reload.

### 2.2 Human local confirmation boundary

Pause → AI & COMPANION → ECHO shows the local proposal with a button
**`CONFIRM (HUMAN) · LOCAL`** (menuKit). A model proposal, if a real bridge exists,
uses a **separate** label **`OWNER CONFIRM · MODEL`**. The two are visually and
textually distinct; neither auto-confirms.

The event handler must **not** call `enqueueCompanionAction` directly. It calls a
single minimal world boundary:

```ts
World.confirmLocalEchoProposal(id: string): boolean
```

It validates, in this order:
1. echo exists and `echo.data.hp > 0`;
2. `player.control.owner === 'human'` (ai/external cannot use it);
3. the proposal exists, its `id === id`, it is the currently displayed proposal,
   not expired (`tick < expiresAtTick`), not already rejected/consumed;
4. `proposal.roomGeneration === current roomGeneration` (the committed room
   generation, not a cached old room);
5. the target/action is still legal and visible from the current `echoView`
   (same `companionAvailableActions`/core legality; range/LOS/cooldown/energy);
6. only then: take `originRoomId = this.roomIdValue` **at confirmation time**
   (never from the proposal), enqueue the existing command for the **next** tick,
   and set `provenance: 'human-local'` (the boundary is the only setter).

- `provenance` is added to `pendingCompanionIntent`/the receipt:
  `'human-local' | 'owner-external'`. The agent cannot pass or forge it.
- The external/Owner path keeps `'owner-external'`; intent/receipt/audit provenance
  are distinguishable and never mixed.
- The local path does **not** expose an MCP tool, does not use `__game` in
  production, and the UI operation is a real human click. Automated Owner clicks are
  labeled `fixture`; the low-risk switch never auto-confirms.
- Offline a human can complete meaningful **scan** and **toggle-relay** (non-combat
  cooperation) through this real click and the same core rejection path. The UI
  shows `OFFLINE / NO MODEL`; `companionLink === null`, `companionStatus === 'OFF'`.
  It never fakes a session/cap/CONNECTED.

Why not option F: it would make the offline non-combat cooperation impossible or
claim a fixture bridge as the only path; option L keeps it offline and honest
without impersonating the external Owner capability.

---

## 3. B2/B3 — safe movement criteria and what it changes

### 3.1 Verifiable criteria (no hidden hazard)

`echoView` has **no hazard field**. "Safe move" therefore uses only verifiable,
perception-local predicates:

- target is strictly inside the echo's 12-tile perception, in an explored room, with
  LOS (`buildEchoObservation` gives the same predicates);
- `isWalkableFromState(echo, x, y, 0.5)` is true (same core collision);
- **no perceived hostile is within 2 tiles of the target cell** (from the same
  `drones`/`targets` view);
- target is not the player's cell; one bounded move window; no path through
  unexplored/unseen cells.

If perception cannot prove these, the behavior is named **"reduce visible risk"**
(not "safe"), and the echo stops/asks for instruction. It never promises future
safety and never queries the hidden map/hazard.

### 3.2 What a move changes

- Only the echo's own position, committed by the same core tick and recorded in the
  receipt.
- It does **not** change the relay, route, portal, player HP, or energy. Never claim
  "no world state changed"; claim "only the echo moved".

The P3 hazard evidence (`hazards` field) is out of P2; if it is ever added, the
design must prove it comes from the echo's own observation, not the hidden map.

---

## 4. M2 — one memory source, separate audit ring

- Local policy memory (`EchoController.memory`) accepts **only**
  `source: 'echo-perception'`. It is the only input to `suggest`/`decide`, and the UI
  "seen clue" references only this memory.
- Owner/agent confirmations go to a **separate bounded audit ring** (e.g. 32
  entries, TTL) with `provenance`/tick/action/result. It is **not** read by the policy
  and cannot pollute perception memory.
- The bridge facet memory remains for the remote `echo_memory` display only; it is
  not fed back into the local policy.
- Caps: existing `ECHO_LIMITS` 16 entries / 600 ticks; `COMPANION_LIMITS` already
  points to the same numbers. Device observations keep `observedAtTick`/expiry and
  are labeled last-seen; room transition/gen invalidation as below.

---

## 5. M3 — failure codes: real only

- Current core distinguishes `E_COOLDOWN`, `E_ENERGY_INSUFFICIENT`, `E_RETRYABLE`,
  `E_PAUSED`, and uses `E_PERMISSION` for range/LOS. P2 records **only** the real
  returned code plus verifiable local confirmation rejections (id mismatch,
  expired, wrong owner, room generation changed, target no longer visible/legal).
- P2 does **not** invent `E_OUT_OF_RANGE`/`E_NO_LOS`. If P3 wants a precise split, it
  is a separate minimal change to `signalLegality`/`commitSignal*` with Lead
  approval; it is not slipped into P2.
- No failure is charged twice; a failed confirm enqueues nothing.

---

## 6. M5 — switch persistence and revocation

### 6.1 One human switch, default OFF

- Location: Pause → AI & COMPANION → ECHO, a single `LOW-RISK COOPERATION` toggle
  built with `menuKit`. New persisted field
  `permanent.echoCooperationOptIn?: boolean`; missing/old save = **false**; existing
  saves are not upgraded to consent.
- It is a human local consent, not an Owner capability.

### 6.2 Lifecycle (hard rules)

| Event | Effect |
|---|---|
| OFF, including ON→OFF | `echoController.clearIntent()` + clear the autonomy target; **current manual mode is unchanged** (FOLLOW stays) |
| Pause / open the ECHO page | clear the autonomy intent/target; do not change the manual mode |
| Death / new R0 | reset the per-run echo/autonomy runtime (intent/target/audit ring) consistently with the existing echo/permission reset; the saved human switch is not silently changed |
| Old save without the field | false; no auto-consent |
| external/AI owner | switch is read-only, UI shows `HUMAN OWNER ONLY`; the agent cannot toggle it |

The switch enables only `follow`/`observe`/verifiable movement. It never turns
scan/jam/toggle/assist/resource/irreversible into automatic actions.

### 6.3 Existing manual `enableEcho` + FOLLOW is preserved

- Enabling the echo and choosing FOLLOW/HOLD/MOVE-TO is an explicit human command
  today; it remains exactly as today with the switch OFF.
- The switch OFF does not disable the echo or force a mode; the switch ON does not
  secretly enable assist/scan/jam or turn the echo into a turret.
- Turning the switch ON does not change the current manual mode; it only permits
  the allowlisted observe/safe-move behavior. Turning it OFF returns to the pre-P2
  manual behavior and clears autonomously chosen targets.

---

## 7. M6 — `toggle-relay` origin is taken at confirmation

- The local proposal stores `roomGeneration`, **never** the room id.
- `confirmLocalEchoProposal(id)` reads `originRoomId = roomIdValue` at the
  confirmation instant and passes it to the existing `enqueueCompanionAction`
  path (same as the current Owner path).
- A stale proposal from another room cannot flip the new room's relay; the
  generation/room check refuses it before enqueue.
- The proposal is not a cached command; it is re-validated at confirmation.

---

## 8. M1 — policy location and Headless participation

- `EchoController` is a **pure policy in `src/ai-native`**, not in `src/world/sim`.
  The **execution** (`stepEcho`, `enqueueCompanionAction`, signal commands) is core.
- The policy is deterministic, with no hidden RNG and no adapter state; the same
  `EchoController` and `buildEchoObservation` are used by the Rendered and the
  formal headless runtime.
- Minimal integration: both entries must call the policy in their tick loop when no
  explicit diagnostic override is supplied. The current
  `pendingCompanionIntent ?? echoIntentOverride ?? echoController.decide(view)`
  precedence means an override bypasses the policy; **autonomy evidence may not be a
  hand-written `echoIntentOverride`**. The headless entry must hold the same policy
  instance (with the same `autonomyEnabled` flag) and use its decision, not a
  scripted intent, for autonomy tests.
- The switch state is passed into the policy as `autonomyEnabled` from the saved
  field; it is not a hidden adapter flag. The Rendered and headless entries load the
  same default/OFF value.
- The policy and execution are shared; the P1 route/portal remains Rendered-only
  (explicit boundary, see §10). P2 autonomy is testable in the pure policy + the
  headless entry, not only in the browser.

---

## 9. ai / external, offline, feedback

- **ai/external owner**: local confirm is disabled (`owner !== human`), the switch is
  read-only (`HUMAN OWNER ONLY`), and the agent gains no new capability. The external
  link still rejects `actor:'echo'` scan/jam with `E_PERMISSION`; P2 adds a
  regression for it (echo energy and relay unchanged), plus a production Player
  tool-surface check (no confirm/dev fields).
- **Offline**: local follow/hold/observe/recover and the switch-gated movement work;
  local scan/toggle works only through the human `CONFIRM (HUMAN) · LOCAL` and the
  same core rejection path. UI shows `OFFLINE / NO MODEL`; no fake session/cap/
  connected/pending.
- **Feedback (P2 minimal)**: switch/mode/assist, the perceived relay, the local
  proposal (action/target/reason/confidence/cost/needs-confirm) and the last real
  failure. Reuse `menuKit`; no new framework. **P3** adds causal receipts derived
  only from real events (`signal-scanned`, `signal-relay-changed`, `echo-fired`,
  `echo-moved`, `echo-hurt`, `signal-linked`), never model internals.

---

## 10. Headless boundary (unchanged P1 route boundary)

- Shared and headless-verifiable: echo perception, local proposal legality, echo
  movement/fire/scan/jam execution, TTL/room-generation invalidation, real failure
  codes, and the pure `EchoController` decisions.
- **Rendered-only**: route selection/portal placement/`portalTarget`/room objective
  (same as P1). P2 does not claim full route parity. P4 later moves only the
  minimal `routeTargetFor`/`p1RouteFor` pure rule into the shared core; no generic
  level framework.

---

## 11. File ownership and action/permission matrix

### 11.1 Ownership

| Area | Files | Owner |
|---|---|---|
| Echo policy/modes/local proposal/memory | `src/ai-native/echo.ts` | developer (echo) |
| Echo observation | `src/world/echoView.ts` | developer (echo) |
| Companion facet suggestion/memory (bridge path) | `src/ai-native/companionFacet.ts` | developer (echo) |
| World local-confirm boundary / provenance / switch state | `src/world/World.ts` | developer (echo/world) |
| Authorization UI | `src/scenes/PauseScene.ts`, `src/ui/menuKit.ts` | developer (UI) |
| Persisted switch | `src/types/index.ts`, `src/systems/SaveSystem.ts` | developer (echo) |
| Direct rule tests | `src/**/*.test.ts` (new) | developer |
| E2E/regressions | `tests/**` | tester only |
| Independent review | read-only | reviewer |

### 11.2 Matrix

| Action | Actor/trigger | Switch OFF | Switch ON | Owner confirm | Resource | Headless | ai/external |
|---|---|---|---|---|---|---|---|
| FOLLOW/HOLD (manual) | ECHO, explicit mode | allowed (existing) | allowed | no | none | shared | no new permission |
| OBSERVE (manual) | ECHO, explicit mode | allowed | allowed | no | none | shared | no new permission |
| local `propose(scan/jam/toggle)` | ECHO policy | shown, no execute | shown, no execute | **human local click** | none until confirm | pure policy | disabled (human only) |
| confirm local | human UI | allowed | allowed | human local | same core cost (scan/jam) | core command | not available |
| model proposal confirm | human Owner | n/a without bridge | n/a without bridge | **Owner formal** | core cost | bridge path | no agent confirm |
| safe move | ECHO policy | **no autonomous** | allowed if criteria hold | no | none | shared policy | no new permission |
| assist fire | ECHO | only after confirm | only after confirm | **Owner** | projectile | core | no auto-confirm |
| scan/jam/toggle | ECHO/core | only after human confirm | only after human confirm | **human local or Owner** | echo energy | core | external echo rejected |
| RECOVER | ECHO policy | fallback only | fallback only | no | none | shared | no new permission |

The switch never converts an Owner-confirmed action into an automatic one.

---

## 12. Meaningful test plan (P2, after the Lead order)

1. **Default OFF/old save**: no field → false; manual enableEcho+FOLLOW/HOLD/MOVE-TO
   unchanged; no autonomous target; no auto scan/jam/toggle/assist; no energy spent.
2. **Local proposal**: `propose(view)` yields only legal local scan/toggle (and jam
   if enabled); no execution; id/target/evidenceRef/observedTick/expiry/roomGeneration/
   provenance are correct; hidden map/future never appear.
3. **Local confirm boundary**: wrong id/expired/rejected/room generation changed/
   target no longer visible/owner not human all refuse with no enqueue; a valid
   confirm enqueues for the next tick with `provenance:'human-local'` and
   `originRoomId` taken at confirm; external path remains `owner-external`; no
   `CompanionLink` is created offline, `companionStatus==='OFF'`.
4. **Switch ON**: only follow/observe/verifiable move; criteria use the echo view,
   walkable terrain, no perceived hostile within 2 tiles, not the player cell; the
   echo position changes only; relay/route/portal/HP/energy unchanged. If criteria
   cannot be proven, the behavior is labeled "reduce visible risk" and stops.
5. **Switch lifecycle**: OFF/revoke clears autonomy intent/target, keeps the manual
   mode; pause clears autonomy intent, keeps the mode; death/new R0 resets the
   runtime; old save false; ai/external read-only with `HUMAN OWNER ONLY`.
6. **Memory**: local memory only `echo-perception`; Owner/agent decisions in a
   separate bounded audit ring that never feeds `suggest`/`decide`; TTL 16/600;
   room/generation invalidation; device last-seen expiry; reauth cancels unconfirmed
   model suggestions.
7. **Failure codes**: only real codes (cooldown/energy/retryable/permission) plus
   local boundary rejections; no invented out-of-range/no-LOS; no double charge.
8. **Offline**: local proposal + human confirm for scan/toggle works; UI
   `OFFLINE / NO MODEL`; no fake session/cap/connected; the core rejection path is
   real.
9. **Headless**: same pure policy + execution; both entries use the policy (not a
   hand-written override) for autonomy; canonical state/events; no second policy.
10. **External/AI negative**: external `actor:'echo'` rejected `E_PERMISSION` (echo
    energy/relay unchanged); production Player tool surface has no confirm/dev
    fields; agent cannot toggle the switch; `purePlayer` observation has no Dev.
11. **P3 (later)**: causal receipts only from real events; no model reasoning.

P2 implementation is blocked until P1 is committed and the Lead issues the formal
P2 order. This document changes no source/test/config.
