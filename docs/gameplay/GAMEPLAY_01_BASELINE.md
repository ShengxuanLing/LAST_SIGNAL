# GAMEPLAY-01 — P0 Baseline & Capability Audit

Status: **ENGINEERING BASELINE ONLY.** No human playtest was performed, so this is
not `HUMAN ACCEPTANCE`. Nothing below claims a measured PASS that was not actually
run; the one mechanism I ran is marked **scripted fixture** with its evidence path.

Branch: `feat/gameplay-01-ai-cooperation` (from `main` = `origin/main` `7aa8b51`).
This P0 phase changed **no `src/` and no `tests/`**; it added this document, one
read-only probe harness in `developer/`, and evidence under `reports/gameplay-01/`.

Evidence paths:
- Probe harness: `developer/gameplay01_signal_probe.mjs`
- Probe evidence: `reports/gameplay-01/developer/signal-probe.{run.log,log,json,png}`
- Probe result (scripted fixture, not human): **PASS** (6/6 mechanism steps, 0
  console/page errors). See §6.

---

## 0. What this phase is / is not

| This phase | Not this phase |
|---|---|
| Actual call-chain audit of the real World and its sim | New gameplay implementation |
| Capability matrix (implemented / prototype / interface / doc) | New MCP tools or protocol fields |
| Player-visible decision + feedback gap list | Claims of "fun", "understood" or "accepted" |
| P1–P4 minimal implementation designs + ownership | Editing `src/`, `tests/`, `World.ts`, or old reports |
| One real mechanism run as a scripted fixture | Human acceptance / "player understood it" |

### Evidence classification (mandatory in every GAMEPLAY-01 report)

| Label | Meaning |
|---|---|
| `fixture` | Playwright/scripted input, auto-Owner click, seeded save, injected state. Never called a human. |
| `agent (real model)` | A real LLM/MCP session using the real bridge/token. |
| `human` | A real person played the build. |

This P0 has **no `human` evidence**. The Signal probe is `fixture`. The whole
phase is therefore **ENGINEERING PASS / HUMAN ACCEPTANCE PENDING**; no later
automated run may relabel itself as human acceptance. Owner auto-clicks prove
protocol correctness, not human usability.

---

## 1. The experience the task asks for vs the current build

Intended loop: **observe → hypothesize → experiment → understand → manipulate → result.**

Current build reality (all four are implemented *mechanics*, not yet a Reality
Engineering loop):

1. **Combat + rooms exist** (drone core + legacy enemy FSM + boss + room graph).
2. **Signal exists as an opt-in side system** (one relay device, Scan/Jam/Owner
   toggle/power + exit gate). It is **not** in a default NEW RUN and has **no
   combat effect**; it only opens/keeps the exit.
3. **ECHO exists as a deterministic companion** (follow/hold/move-to, bounded
   12-tile perception, human-confirmed assist fire) plus an external-LLM
   *suggestion* interface (no confirm capability outside the human UI).
4. **The room graph has branches, but the player does not choose a branch**: the
   portal auto-targets the next unvisited room. There is no two-route decision.

So the missing layer is not "more skills"; it is:
- Signal that *changes the combat environment or a route*, not only an exit gate;
- a **real branch choice** the player can understand and own;
- ECHO modes that map to the same observe/support/interact vocabulary;
- feedback that explains *why* a Signal/ECHO action changed (or did not change) the world.

---

## 2. Capability matrix

Tags: **[IMPLEMENTED]** real code path; **[ISOLATED PROTOTYPE]** separate entry,
not the main World; **[INTERFACE ONLY]** protocol/contract without gameplay;
**[DOC ONLY]** design text, no runtime.

| Capability | Tag | Real code / evidence | Notes / limits |
|---|---|---|---|
| Authoritative 60 Hz sim (player, drones, projectiles, loot, signal, echo) | IMPLEMENTED | `src/world/sim/core.ts` (`stepSimulationTicks`, `processCommands`), `rules.ts` | Non-drone enemies + boss + rooms + checkpoint are adapter/legacy; core header is stale about Signal (Signal is core now). |
| Anisotropic movement budget (screen→iso grid) | IMPLEMENTED | `src/world/sim/rules.ts` `screenVelocityToGridVelocity`; `src/ai-native/control.ts` `intentToWorldVelocity` | Do not assume uniform 220/64; verified in code, not re-measured here. |
| Weapon fire + projectiles (pulse/scatter/plasma/arc) | IMPLEMENTED | `src/config/weapons.ts`, `rules.ts` `buildWeaponSpec`, `stepPlayer` | Drone uses core; other enemies use legacy `Enemy.doAttack` → `spawn-enemy-projectile` command. |
| Drone AI (chase/attack/wander) in core | IMPLEMENTED | `rules.ts` `stepDroneAi`, `stepDrones` | Other kinds (`stalker/sentinel/hunter/sentry/shiver/slag`) are `SimTarget` HP/pos mirrors driven by the legacy `Enemy` class. |
| Boss (phased, legacy) | IMPLEMENTED | `src/entities/Boss.ts`, `World.spawnBoss`, `SimTarget` HP | Boss attacks are legacy; HP/pos are mirrored into the core target registry. |
| Room graph + roles + sector decks | IMPLEMENTED | `src/world/MapGenerator.ts` `assignRoles`, `src/config/dungeon.ts` (`SECTORS`, `encounter`) | No explicit player route choice; portal auto-targets. |
| One Signal device + Scan/Jam/toggle/power + exit gate | IMPLEMENTED (opt-in only) | `src/world/sim/signalState.ts`, `src/signal/signalCore.ts`, `src/signal/relay.ts`, `World.updateRoom`/`tryInteract`/`signalView` | Spawns only if `save.permanent.signalCollaborationOptIn`; one device per run; gate only (`exitOpen = relay==='ACTIVE'`). |
| Signal combat link (Jam affects enemy perception/alarm) | DOC ONLY | `docs/SIGNAL_SYSTEM_DESIGN.md` §4/§7/§9 proposals | Not implemented in the main World; no enemy perception link. |
| Third ability Decoy / 7 signal types | DOC ONLY | `docs/SIGNAL_SYSTEM_DESIGN.md` §4/§6 | Only Scan + Jam exist. |
| ECHO actor + follow/hold/move-to + assist fire | IMPLEMENTED | `src/ai-native/echo.ts` `EchoController.decide`, `src/world/World.ts` `enableEcho/stepFrame`, `echoView.ts` | Modes are only FOLLOW/HOLD/MOVE-TO. No OBSERVE/SUPPORT/INTERACT/RECOVER. |
| ECHO bounded perception + memory | IMPLEMENTED | `echoView.ts` (`buildEchoObservation`), `echo.ts` `observe`/`memory` | Memory is recorded but **not used in decisions**; `clearForRoomTransition` invalidates on room change. |
| ECHO suggestion facet (move/aim/fire/scan/jam/toggle-relay) | INTERFACE ONLY | `src/ai-native/companionFacet.ts`, `companionGateway.ts`, `companionLink.ts` | No confirm capability for the agent; the human Owner confirms in the UI; room generation/epoch/room barrier enforced. |
| Local deterministic AI player | IMPLEMENTED | `src/ai-native/localController.ts`, `control.ts`, `Player.resolveIntent` | Same `PlayerIntent` path as human; bounded perception + local probe; labelled "LOCAL DETERMINISTIC DEMO". |
| External agent Player control (C3) | IMPLEMENTED | `externalLinkController.ts`, `worldGateway.ts`, `enqueueExternalIntent`/`takeExternalIntent` | Intent-only, same legal execution path; human authorize; paused enqueue → next real tick. Not an LLM loop by itself. |
| Observation/action protocol (player crop + echo crop) | IMPLEMENTED | `worldObservation.ts`, `echoView.ts`, `worldProtocol.ts` | Grid radius + explored + LOS; no seed/map/portal destination/hidden state. |
| Headless World + parity/replay | IMPLEMENTED | `src/ai-native/worldHeadless.ts` (`runSteps`, `snapshot/restore/replay`, canonical hashes) | Same core as rendered; used by tests. |
| Save/checkpoint (run, position, rooms, loot, RNG, echo, signal, purchase ledger) | IMPLEMENTED | `src/systems/RunCheckpoint.ts`, `World.captureCheckpoint/restoreCheckpoint`, `SaveSystem` | Checkpoint only in safe cleared state; death = `finishRun(false)` → run removed, next NEW RUN is a new R0 (only exit/refresh resumes the checkpoint). |
| HUD (vitals/weapon/room/hostiles/AI/ECHO/SIGNAL/minimap/objective) | IMPLEMENTED | `src/scenes/GameScene.ts` `setupHud/refreshHud/refreshSignalHud` | See §5 for the feedback gaps. |
| Two legal routes / persistent route choice | DOC ONLY | `docs/VERTICAL_SLICE_LEVEL_DESIGN.md`, `VERTICAL_SLICE_EXPERIENCE_FLOW.md` | Main World portal has one auto target. |
| Station Zero slice (R0–R4, door/bridge) | ISOLATED PROTOTYPE | `src/slice/*`, `station-zero.html` → `src/slice/main.ts` → `SliceScene` | Independent Phaser entry; **does not** import `src/main.ts`; shares `src/signal` primitives and `src/slice/tuning.ts` re-exports `SIGNAL_TUNING`. Do not conflate with the main World. |

### 2.1 Three coordinate worlds (must not be conflated)

- **Main World** (`index.html` → `src/main.ts`): `MainMenu → GameScene → Pause/LevelUp/GameOver`, authoritative `SimulationState` + Phaser adapters + `World`.
- **Station Zero slice** (`/station-zero.html` → `src/slice/main.ts` → `SliceScene`): independent `SliceModel` + corridor/door rules, shares only `src/signal` primitive functions and tuning numbers.
- **Headless** (`src/ai-native/worldHeadless.ts`): no Phaser/DOM, same `SimulationState`/rules as the main World; used by MCP/parity.

### 2.2 Real call chain (main World)

```
GameScene.update()
  → Player.sampleIntent()                 // human | local AI | external intent
  → World.stepFrame(delta, intent)
      → processWorldSpawns / room-enter / spawn-signal-device
      → EchoController.decide(echoView()) // echo intent from its own 12-tile view
      → stepSimulationTicks(state, ticks, intent, echoIntent)
          → processCommands (signal-scan/jam/toggle/power, spawn, set-target-hp, …)
          → tickSignalDevice (energy regen, cooldown, evidence TTL, jam expiry, relay)
          → stepPlayer / stepEcho / stepDrones / stepProjectiles / stepLoot
      → applySimEvents (Phaser feedback)
      → syncCoreEntities / updateLegacy
  → lockHud / refreshHud / refreshSignalHud / refreshMinimap
```

`World.stepFrame` only steps when `GameScene.paused === false`; a paused overlay
accumulates no ticks, so a paused confirmation commits on the next *real* tick
after resume (boundary preserved).

---

## 3. Fact corrections / stale claims found during the audit

1. `src/world/sim/core.ts` header says "Signal … remain adapter/legacy" — **stale**:
   Signal is now core (`signalState.ts`, `processCommands`, `tickSignalDevice`).
2. `SIGNAL_TUNING.EVIDENCE_TTL_TICKS = 300` is not used by `evidenceExpiry()`,
   which uses `SCAN_REVEAL_TICKS = 480` (`src/signal/signalCore.ts`). The evidence
   TTL is 480 ticks in practice. Do not quote 300 as the live value.
3. `companion toggle-relay` commit checks the **player's** current room plus the
   device room (`processCommands` `originRoomId` guard), not the echo's room. The
   echo can only "interact" through a human-confirmed command whose origin room
   still matches at commit time.
4. The main World portal is gated by the relay only **when a device exists**; a
   default run (no opt-in) has no device and the portal is always open
   (`signalExitOpen(undefined) === true`).

---

## 4. Player-visible decisions today

| Decision | Real? | Where | Notes |
|---|---|---|---|
| Fight / kite / dash / weapon switch | Yes | `GameScene` input, `Player`, `core` | Strong, always available. |
| Level-up upgrade choice | Yes | `LevelUpScene` | 3 weighted cards; commits next tick. |
| Equip weapon / inventory | Yes | `PauseScene` inventory (`menuKit` after UI-REWORK) | Queued equip commits next tick. |
| AI local demo on/off; external authorize | Yes | Pause menu (`AI & COMPANION` → LLM/ authorize) | Owner-only; no fake connected state. |
| ECHO enable / mode / assist confirm | Yes (opt-in) | Pause → AI & COMPANION → ECHO | FOLLOW/HOLD/MOVE-TO + confirm assist fire. |
| Signal opt-in, Scan, Jam, toggle relay | Yes but **hidden by default** | Settings → SIGNAL COLLABORATION; in-run T/Y/R | One relay, exit-gate only. |
| Which room/route next | **No real choice** | `placePortal` → `nextRoomTowardUnvisited` | Backtracking only when all visited; no branch picker. |

---

## 5. Repeated meaningless operations & feedback gaps

### 5.1 Repeated / low-information operations

- **Scan when the relay is already discovered still costs 10 energy** and pushes
  another evidence entry (`scanDiscover` has no "already known" gate; evidence is
  only TTL-expired). A player can burn energy with no new information.
- **Jam while already jammed** is correctly blocked (`E_RETRYABLE`, no charge), but
  the HUD does not show the remaining jam ticks, so the player cannot tell when it
  is worth pressing again.
- **Toggle relay with no device** returns `false` silently (`enqueueSignalCommand`
  returns false when `_sim.signal` is null); the HUD shows `RELAY OFF · NO DEVICE`
  but the key press has no explicit failure reason.
- **ECHO follow while already within standoff** produces no movement and no
  "holding" cue beyond the mode label; the player cannot tell "arrived" from
  "blocked".
- **Portal in a cleared room always points at the same auto-chosen target**; walking
  back and forth does not create a decision, only traversal.

### 5.2 Information / feedback gaps (relative to the intended loop)

| Missing feedback | Current state | Evidence |
|---|---|---|
| What Scan actually discovered | HUD shows `RELAY <state> | e:.. p:.. … · EXIT` but not "relay discovered"/"link discovered", nor the evidence list. The `signal-scanned` event carries `found` + `evidence`, but the HUD ignores it. | `GameScene.refreshSignalHud`; core `signal-scanned` event |
| Jam remaining duration | HUD shows relay state color only; `signalView.jammedUntilTick` exists but is not rendered. | `refreshSignalHud` |
| Why the exit is closed | HUD shows `EXIT CLOSED`; the objective text does not say "activate the relay". `roomObjective` says `EXIT LOCKED · CLEAR OTHER ROOMS` for deck exits, not "relay inactive". | `World.roomObjective`, `tryInteract` |
| Skill costs / ranges before committing | Player must know Scan=10, Jam=25, Scan radius 12, Jam radius 6 from docs; the HUD shows only current energy. | `SIGNAL_TUNING`, HUD |
| Two energy accounts | `e:` / `p:` abbreviations; not labelled "ECHO energy" / "PLAYER energy". | `refreshSignalHud` |
| ECHO memory / source / TTL | HUD shows mode/assist/suggestion; no target source, age or expiry. | `txtEcho` |
| ECHO "why not firing" | `ASSIST SAFE` / `CONFIRM FIRE` only; no range/LOS reason. | `EchoController.suggest` |
| AI plan / reason | HUD shows `AI ACTION`/`AI TARGET` (last committed), not intent or next step. | `ControlAuthority.snapshot` |
| Pending Owner proposal at a glance | Only visible in Pause → LLM; not on the run HUD. | `companionLink.pending`, UI-REWORK panel |
| Route/room meaning | Portal label shows target room id + kind; no "why this route" or alternative. | `World.makePortal` |
| Death/continue semantics | Death removes the run (`finishRun(false)`); only exit/refresh restores the checkpoint. The HUD does not state this at the moment of death. | `SaveSystem.finishRun`, `GameScene.onDeath` |

---

## 6. The one mechanism I actually ran (scripted fixture)

Harness: `developer/gameplay01_signal_probe.mjs` (Chromium, own dev server on
`127.0.0.1:5188`; no `src`/`tests` edits). Fixture: the save is pre-seeded with
`permanent.signalCollaborationOptIn = true` so the real opt-in path spawns the
device; the probe then uses the game's own `playerSignalScan`, `playerSignalJam`,
`toggleRelay` and waits on the live loop. **Not human acceptance.**

Measured steps (`reports/gameplay-01/developer/signal-probe.run.log`):

1. Device spawned from the real opt-in save: `relay=INACTIVE`, `exitOpen=false`, `energy=100`, `evidence=0`.
2. Scan: energy `100→90` (SCAN_COST 10), scan cooldown set (`116`), `evidence=1` (relay discovered).
3. Jam: energy `90→65` (JAM_COST 25), `relay=JAMMED`, `exitOpen=false`, `manual=false` (jam is not a toggle).
4. Manual toggle while jammed: `manual=true`, `relay` stays `JAMMED`, `exitOpen=false` (no bypass).
5. Jam expiry (~360 ticks): `relay=ACTIVE` (`manual && powered`), `exitOpen=true`.
6. Independent accounts: player `95` (regen after spend), echo `100` untouched; player jam cooldown running.

Result: **PASS (scripted fixture).** This proves the Signal cost/relay/exit
mechanism is real and deterministic. It does **not** prove combat value, route
choice, readability, or fun.

Not measured here (must be measured by tester before any P1 claim):
- Scan/Jam in a live combat room with enemies; whether Jam changes the fight.
- Two-route choice; whether the player can perceive the alternatives.
- ECHO follow/hold/observe/support under real enemy pressure.
- Save/restore of a route choice; death → new R0 vs checkpoint resume.
- Performance/frame-time with the added Signal link.

---

## 7. P1 — two real Signal interactions (minimal, no new skill pile)

Goal: make the relay matter in a fight and in a route decision, reusing the
existing `SimSignalDevice`, `RelayState`, Scan/Jam costs and the existing Owner
toggle. No new ability enum.

### P1-A — Combat environment: relay-fed alarm/turret (reuse Jam)

- Authored room data gets one `SignalLink` for the room: `{ source: deviceId,
  effect: 'alarm' | 'suppress-turret', activeWhen: 'RELAY_ACTIVE' }`.
- Behaviour: when the relay is `ACTIVE`, the room runs the hazard (e.g., a slow
  suppression turret or an alarm that buffs enemies); `JAMMED` suppresses it for
  `JAM_DURATION_TICKS`; `INACTIVE` leaves it inactive.
- Player loop: **Scan (10)** to discover the relay/link → **Jam (25, <6 tiles,
  LOS)** to buy a safe window → use the window to fight or cross.
- Reuses: `relayOutput`, `commitSignalJam`, `tickSignalDevice`, `signalView`.
- No protocol change: the room template is `src/config/dungeon.ts` data, and the
  World reads `_sim.signal.relay` when updating the hazard; the hazard itself is a
  data flag consumed by the existing room/enemy adapter.

### P1-B — Route choice: relay state selects one of two legal exits (reuse toggle/Jam)

- A room template declares two `RouteOption`s: `{ targetRoom, requires:
  'RELAY_ACTIVE' | 'RELAY_INACTIVE', label }`.
- The portal interaction presents both options; the one whose `requires` matches the
  current relay state is passable. The player chooses by toggling the relay (Owner
  action) or by jamming it (temporary window), then using the portal.
- Reuses: `commitToggleRelay`, `currentRelayState`, `exitOpen`, `placePortal`,
  `tryInteract`.
- Persistent consequence: the chosen target room is saved in the checkpoint
  (`portalTarget` already exists); the other route remains a legal alternative if
  the player returns and flips the relay.
- No new skill: it is a data-driven route table + a two-option portal prompt.

### P1 acceptance shape (tester)

- A combat room where `JAMMED` measurably changes the hazard (damage/attacks per
  second), with Scan/Jam costs identical to §6.
- A route room where both routes are legal, and the portal only opens the route
  matching the current relay state; the chosen target persists through a safe
  checkpoint.
- No new `SimCommand`, no new `signal-*` event, no protocol field.

---

## 8. P2 — ECHO capability mapping (reuse actor/action, no new skills)

Existing: `EchoController` FOLLOW/HOLD/MOVE-TO + human-confirmed assist fire; bounded
12-tile perception; 16-entry/600-tick memory; `clearForRoomTransition`; external
suggestion kinds `move/aim/fire/scan/jam/toggle-relay`.

Minimal mapping (all reuse the same core intent path):

| Requested mode | Implementation | Reuse |
|---|---|---|
| FOLLOW | Current `follow` (standoff 3 tiles) | exists |
| HOLD | Current `hold` (no movement) | exists |
| OBSERVE | A mode that records perceived actors + relay and returns a neutral intent (no fire) | `echoView` + `EchoController.observe`; no new command |
| SUPPORT | Current assist fire (human confirm) + scan/jam suggestions | `confirmEchoAssist`, `companionFacet` availability |
| INTERACT | Human-confirmed `toggle-relay` on the perceived relay; the echo must be the one perceiving it | `companionFacet` kind `toggle-relay` + existing `originRoomId`/room barrier |
| RECOVER | Deterministic fallback to FOLLOW/return to a safe point when HP ≤ threshold; no healing skill | `follow` + existing `setEchoMode` |

Task memory (lightweight, not a second map):
- `CompanionMemoryEntry` gains `source: 'drone' | 'relay' | 'target'`,
  `expiresAtTick`, `roomGeneration`; entries expire by TTL (`ECHO_LIMITS`) and are
  invalidated synchronously on room change (`enterRoom` / `clearForRoomTransition`).
- The rendered and headless paths already share the room-generation barrier
  (`CompanionLink.enterRoom`, gateway room generation); no new protocol.

Offline strategy + low-risk authorization (corrected P2 scope):
- Without an external model, the echo uses only the deterministic policy above
  (FOLLOW/HOLD/OBSERVE, assist fire only after human confirm). No autonomous
  relay toggle.
- **New P2 allowlist is explicit and minimal**: `follow`, `observe`, and
  *verifiable safe movement* (move to a currently perceived, walkable, non-hazard
  cell inside the echo's own 12-tile view). It is enabled only by a **single, clear
  switch in Pause → AI & COMPANION → ECHO** that defaults to **OFF**; existing saves
  are not upgraded to consent. The human can pause/revoke it at any time; it is
  bounded (per-window budget) and audited (one local log line per action).
- Everything else stays on the existing Owner formal confirmation: resource
  spending (scan/jam), important environment changes (relay/toggle), irreversible
  actions, and assist fire. No auto-confirm, no new confirm capability, no Dev
  state sharing. The allowlist never reads hidden state.
- Offline/no-model is shown honestly as offline; the UI never fakes a connected
  model or a pending proposal that does not exist.
- Task memory carries `source`, `expiresAtTick` (TTL) and `roomGeneration`; entries
  are invalidated synchronously on a committed room change and on epoch change.
- External suggestions remain `move/aim/fire/scan/jam/toggle-relay`; the human Owner
  still confirms; TTL, epoch, room generation and stale-proposal refusal are
  unchanged.
- Current fact: no autonomy/allowlist code exists (`grep autonomy|autoConfirm|lowRisk`
  = 0 hits). P2 creates it explicitly; nothing today may be described as autonomous.

---

## 9. P3 — feedback via the existing `menuKit` (no new framework)

Reuse `src/ui/menuKit.ts` + the UI-REWORK `PauseScene` patterns:
- A run-HUD `SIGNAL` line that shows: relay state, jam remaining ticks, player/echo
  energy labelled, and the last Scan result ("RELAY DISCOVERED", "LINK 1").
- A contextual interaction panel (near the relay) built with `MenuPage`/`createButton`
  showing costs (`SCAN 10`, `JAM 25`), ranges, and the blocked reason
  (`OUT OF RANGE`, `NO LOS`, `COOLDOWN`, `INSUFFICIENT ENERGY`) before/after the press.
- A pending Owner proposal card (kind · reason · target · resource · confirmable)
  that mirrors §6 of the UI-REWORK panel, plus the selected proposal id.
- ESP/NPC feedback through the existing HUD rows, not new overlays.

Ownership: `src/scenes/GameScene.ts` (HUD text only) + `src/scenes/PauseScene.ts`
/ `src/ui/menuKit.ts` (reuse). No protocol change.

---

## 10. P4 — one formal World slice with two legal routes (corrected)

Scope: **one formal main-World slice**, not a new game and not the Station Zero
prototype.

- Fixed sector deck (e.g., deck 0, `RELAY YARD`) with an authored room template:
  `R0 start → R1 combat (relay hazard) → R2 route room (two exits) → R3 boss`.
- Two legal routes at R2: `ROUTE A` requires relay `ACTIVE`; `ROUTE B` requires
  relay `INACTIVE`/`JAMMED`. Both are **legal for a solo human** and for
  human+ECHO; they lead to different room variants (enemy/resource mix) and rejoin
  before R3.
- **Solo parity is a hard requirement, not a failure:** a solo human must be able
  to finish the slice on the same seed with the same rules. No gate, door, timer or
  mechanic may require the ECHO. Cooperative value is shown through observation
  and division of labour, never through a forced dependency.
- Do **not** use "solo fails 3/3 / co-op succeeds 3/3" as a PASS condition. That
  premise is superseded by this P0 correction.
- Co-op is measured, not assumed better: same seed, run both `human solo` and
  `human + ECHO`, and report time / damage dealt / damage taken / Energy spent /
  action count / suggestions accepted / scan-jam usage. The report must state the
  measured direction honestly; ECHO may be faster, slower, or neutral.
- Seed variants (deterministic, no `Math.random` in gameplay): device position
  (center vs offset), enemy composition via `encounter(seed, deck, roomId, kind)`,
  resource count via `roomResourceCount`. A seed must reproduce the same variant.
- Entry: `NEW RUN` (main game) with the slice template active; the Signal opt-in is
  enabled by the slice template (not a global default) so the first-time player
  meets it. A dev-only seed can be used for capture, but the playable entry is the
  normal `NEW RUN`.
- Checkpoint: the chosen `portalTarget` is already saved; the relay/echo state is
  already in `coreState`; death still ends the run (new R0), exit/refresh restores
  the checkpoint.

---

## 11. File ownership (proposed P1–P4)

| Area | Files | Owner |
|---|---|---|
| Signal device/command/relay rules | `src/world/sim/signalState.ts`, `src/world/sim/core.ts`, `src/signal/*` | developer (signal) |
| World integration / room template / route table | `src/world/World.ts`, `src/config/dungeon.ts`, `src/config/game.ts` | developer (world) |
| ECHO policy / task memory | `src/ai-native/echo.ts`, `src/world/echoView.ts`, `src/ai-native/companionFacet.ts` | developer (echo) |
| Feedback / HUD / interaction panel | `src/scenes/GameScene.ts`, `src/scenes/PauseScene.ts`, `src/ui/menuKit.ts` | developer (UI) |
| Headless parity / contracts | `src/ai-native/worldHeadless.ts`, `src/ai-native/worldProtocol.ts` | developer (protocol), tester verifies |
| Tests (new regressions) | `tests/**` | tester only |
| Independent review | read-only | reviewer |

Hard boundaries (unchanged): no Owner protocol / epoch / permission / paused
enqueue→real-tick change; `World.ts`’s pre-existing diff is not part of this phase
(it is the current branch state, not edited here); no push/PR/merge; no `git add -A`.

---

## 12. Earliest playable demo entries

| Entry | What the player can do today | Use for P1/P4 |
|---|---|---|
| `index.html` → `NEW RUN` | Normal run, no relay by default; Pause → Settings → SIGNAL COLLABORATION ON then enter a room to spawn the relay | P1-A/P1-B authored room; P4 slice |
| `index.html` → `SECTOR RUN` | Deck-based run, boss/extraction per sector | P4 fixed deck |
| `index.html` → Pause → AI & COMPANION | ECHO enable/modes/assist; LLM pairing form | P2 demo |
| `/station-zero.html` | Independent Station Zero door/bridge slice | Do **not** use as the main-World acceptance target |

---

## 13. What must be measured by the tester (no PASS claimed here)

1. P1-A: hazard DPS/attack rate with relay `ACTIVE` vs `JAMMED`, same seed.
2. P1-B: both routes reachable; portal gated by relay state; chosen target persists.
3. P2: FOLLOW/HOLD/OBSERVE/SUPPORT/INTERACT/RECOVER in real enemy pressure; memory
   TTL and room-generation invalidation; offline (no bridge) still playable; the
   P2 allowlist is off by default, only acts when the human enables it, and never
   auto-confirms a resource/irreversible/assist action.
4. P3: cost/blocked-reason/pending-proposal feedback readable at 1280×720 and
   800×600 (reuse the UI-REWORK audit).
5. P4: same seed → same variants; two legal routes; **solo human can finish the
   slice**; death → new R0; exit/refresh → checkpoint restore.
6. Performance/frame-time and no console/page errors.

### 13.1 Solo vs human+ECHO comparison matrix (P4, same seed)

| Metric | human solo | human + ECHO | Direction (measured, not assumed) |
|---|---|---|---|
| Completion time | | | |
| Damage dealt | | | |
| Damage taken | | | |
| Energy spent (player + echo) | | | |
| Action count (input/commands) | | | |
| Suggestions accepted | n/a | | |
| Scan / Jam usage | | | |

Rules: both cells must be a legal completion; no cell may be a designed loss. The
report states the measured direction and does not claim ECHO is superior.

Until those are measured, the status remains
**ENGINEERING BASELINE / HUMAN ACCEPTANCE PENDING.**

---

## 14. CI hermeticity prerequisite (proposal only — no changes in P0)

`main` CI is red for a **test-hermeticity** reason, not a product defect:
`npm test` contains `companionSurface.test.ts` (needs the gitignored `dist-mcp`
bundle) and `signalRenderedHeadlessParity.test.ts` (needs Rendered↔Headless
products written by Playwright), while CI runs `npm test` before any MCP build and
before Playwright. See `reports/gameplay-01/reviewer/P0_REVIEW.md` §2.

A minimal, gate-preserving proposal is in
`reports/gameplay-01/developer/CI_HERMETICITY_PROPOSAL.md`. It does **not** skip,
exclude-and-never-run, commit `dist-mcp`, or commit parity evidence: the surface
check becomes a build-then-check gate and the parity check becomes a post-E2E
gate, both still failing loudly when their artifact is missing.

---

## 15. P0 actual experience / test results (tester, independent clone)

**Status of this section: ENGINEERING BASELINE RECORDED — not an overall engineering
PASS, and not human acceptance.** Every input below is agent-driven (real
mouse/keyboard) or an existing fixture; no human played. Real-LLM = **BLOCKED** (no
configuration present).

Sources (tester-owned, read-only here):
- `reports/gameplay-01/tester/BASELINE_REPORT.md`
- `reports/gameplay-01/tester/evidence/playtest-p0.json`
- `reports/gameplay-01/tester/logs/p0-playtest.log`
- `reports/gameplay-01/tester/logs/baseline-3-playwright-full-clone.log`
- `reports/gameplay-01/tester/logs/headless-1..5-*.log`

### 15.1 Environment and gates (same independent clone)

| Item | Value |
|---|---|
| Tree | independent clean clone `D:\tmp\ls-p0-ci` (not the shared workspace) |
| Commit | `7aa8b51` |
| Dependencies | own `npm ci` (node v24.20.0 / npm 11.19.0) |
| Prerequisites generated in-clone | own `npm run game:mcp:build`, own rendered parity export; no shared `dist/`/parity copied |
| Isolation | later shared-tree P1/CI changes (including `c7e03c5`) cannot affect this clone |

| Command | Result | Log (absolute) |
|---|---|---|
| `npm run typecheck` | **PASS (0)** | `D:\Project\LAST_SIGNAL\reports\gameplay-01\tester\logs\baseline-1-typecheck-clone.log` |
| `npm run build` | **PASS** | `…\tester\logs\baseline-2-build-clone.log` |
| `npm test` (no prerequisites) | **FAIL 739/745** (4 files / 6 tests) | `…\tester\logs\ci-repro-1-npm-test-clean.log` |
| `npm test` (after `game:mcp:build` only) | **FAIL 742/745** (1 file / 3 tests = parity) | `…\tester\logs\ci-repro-4-npm-test-after-mcp-build.log` |
| `npm test` (after the real rendered parity export) | **PASS 745/745 (prepared)** | `…\tester\logs\ci-repro-6-npm-test-after-parity.log` |
| `PORT=5460 npx playwright test --workers=1` | **FAIL 117/118** (P3-a deterministic) | `…\tester\logs\baseline-3-playwright-full-clone.log` |
| P3-a isolation ×3 | **FAIL 3/3** (deterministic on this commit) | `…\tester\logs\flake-p3a-1..3.log` |
| P2 boss bullets ×2 | **PASS 2/2** (flake not reproduced) | `…\tester\logs\flake-p2-boss-1..2.log` |
| whale dash ×2 | **PASS 2/2** (flake not reproduced) | `…\tester\logs\flake-whale-1..2.log` |
| 2 unit failures isolated | **PASS 14/14** (load/timing) | `…\tester\logs\ci-repro-2-extra-two-isolated.log` |

The 745 is **prepared**: it requires the MCP bundle and the real rendered parity
export. It is *not* a clean no-prerequisite result and must not be used as a P1
PASS. The CI split (`c7e03c5`) addresses the ordering, but it is not pushed and
GitHub Actions has not been verified; P1 does not inherit the historical 745.

### 15.2 Six real runs (agent-driven; not human)

| # | Scenario | Measured | Label |
|---|---|---|---|
| 1 | human-like combat (real WASD + mouse clicks, no seed override/dev seam/rescue) | damage **0→48**, HP **100→56**, 11.9 s, tick +202, 3 enemies in the room | agent |
| 2 | local deterministic AI (pause menu; not an LLM) | 8 s: actions **1→12**, damage **0→162**, kills **0→2**, tick +169, HP 100→100 | agent + local demo |
| 3 | ECHO assist (Owner CONFIRM auto-clicked) | damage **126**, kills **2**, ECHO HP **100→89** (independent damage), echo projectiles 1 | agent + **autoOwner fixture** |
| 4 | Signal T/Y/R (real Settings click + real keys; opt-in needs a **new run** for the device) | relay INACTIVE, energy 100; `T` energy **100→92**, evidence **0→1**, scanCD 89; `Y` relay **JAMMED**, jammedUntilTick 454; `R` changes relay | agent |
| 5 | level-up during real combat | LevelUpScene really appeared, choice made, level **1→2**, xp 6/74, 10.7 s | agent |
| 6 | headless/rule gates | `game:sim:parity` PASS (8 checks); world MCP smoke PASS; headless MCP smoke PASS; c3c rendered↔headless parity PASS (prepared, tick=27); F-03 gate PASS | prepared where noted |

### 15.3 Limits (do not over-claim)

- No human played; no real LLM (all model/bridge config unset) → **HUMAN ACCEPTANCE
  PENDING**, real LLM **BLOCKED**.
- P3-a's 1/1 + isolation 3/3 red is a **test-assertion issue on this commit**: it
  conflates "echo damage must not hit the protagonist" with "nothing may damage the
  protagonist in the window"; it is not a product regression. Tester owns the fix.
- No solo-completion matrix and no P4 dual-route comparison were run in P0.
- `tests/ui-menu-layout.spec.ts` currently hard-guards its output root under
  `reports/ui-rework-01`; a different evidence root crashes the whole Playwright
  load. Tester is authorized to adjust that evidence-root guard.
- AI-NATIVE-02 historical numbers are not this round's result. The P0 baseline has
  a real deterministic E2E red and is recorded as such.

**P0 status: ENGINEERING BASELINE RECORDED / HUMAN ACCEPTANCE PENDING.**

---

## 16. Post-P0 model connection update (2026-11-17; does not rewrite §15)

The P0 record in §15 stays historical: at P0 time no model/bridge configuration was
present, so real-LLM was **BLOCKED**. This section records only the later connection
fact and must not be read back into P0.

- The user chose to reuse the existing Magpie local API. The Lead's safe projection
  probe recorded endpoint `http://127.0.0.1:3425/v1`, `wireProtocol=openai-chat`,
  route/model `group/elisa`; `GET /v1/models` returned HTTP 200 and a real
  `POST /v1/chat/completions` returned a non-empty `OK` (6.9 s). No Authorization
  header was used and no key was exported. Probe evidence:
  `reports/gameplay-01/model/magpie-connection-probe.json`,
  `reports/gameplay-01/model/CONNECTION_SCOPE.txt`.
- This means the **connection** is usable. A reviewer also ran one bounded real-model
  **Player combat** smoke on fixed snapshot `b6a98e5` (isolated runtime/build,
  official observe/action MCP tools only, 4 real requests, room cleared with real
  core events): `reports/gameplay-01/reviewer/REAL_MODEL_CONNECTIVITY_AND_SMOKE.md`.
  That is ENGINEERING PASS, not human acceptance.
- It does **not** mean the P2 game model chain is verified: legal ECHO observation
  → model suggestion → human Owner confirm/reject/disconnect is still a post-freeze
  reviewer/E2E step. P2's local proposal is deterministic and offline; it must never
  be presented as a real-model result.
- The production Bridge/Owner authorization path is unchanged. No Bridge secret or
  Owner key is sent to the model, and a new Bridge connection still requires human
  authorization. The Magpie API endpoint and the World Bridge URL are different
  things and must not be conflated.
