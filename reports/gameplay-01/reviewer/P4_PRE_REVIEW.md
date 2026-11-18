# P4 PRE-REVIEW — static architecture / provenance review of the 4-file candidate

Reviewer: independent, read-only. Date: 2026-11-18.
Scope: **architecture + source-boundary static review only.** Not final acceptance, no model calls, no full suite.

## 0. Inputs and provenance (pinned, not assumed authoritative)

Snapshot built by me, cwd `D:\tmp\gp01-p4pre`:

```
git archive 1a6306f | tar -x            # real branch feat/gameplay-01-ai-cooperation
+ the 4 current worktree bytes (the candidate patch under review)
D:\tmp\gp01-p4pre\node_modules -> junction to the shared install (read-only use)
```

| File | sha256 (first 16) as given by the Lead | my snapshot before | my snapshot after |
|---|---|---|---|
| `src/config/p1Scenario.ts` | `d6dd9a48e7a929ec` | `d6dd9a48e7a929ec` | `d6dd9a48e7a929ec` |
| `src/world/World.ts` | `84eac073b43accff` | `84eac073b43accff` | `84eac073b43accff` |
| `src/ai-native/worldHeadless.ts` | `2ad184433290ad4a` | `2ad184433290ad4a` | `2ad184433290ad4a` |
| `src/signal/relay.ts` | `6fc7ba4028812b65` | `6fc7ba4028812b65` | `6fc7ba4028812b65` |

All four hashes match the Lead's numbers and are unchanged across the review → **PASS**
(`D:\Project\LAST_SIGNAL\reports\gameplay-01\reviewer\p4-pre-probe.log`, BEFORE/AFTER markers).
The four files' provenance is still unknown; nothing below treats them as an authority — the
review only asks whether **these bytes**, as a patch, are architecturally sound.

Diff size vs `1a6306f`: `p1Scenario +147/−2`, `World +18/−80`, `worldHeadless +87/−14`, `relay +11/−0`.
The `World −80` is the route/sentry code that moved into the shared module (§2), not deleted behaviour.

Evidence run (one small probe, no full suite):

- `npx vitest run src/reviewer/p4-pre-probe.test.ts` (snapshot only; the file is **not** in the repo) → **PASS 2/2** → `D:\Project\LAST_SIGNAL\reports\gameplay-01\reviewer\p4-pre-probe.log`
- Probe content: pure `routeTargetFor` truth table + one headless demo probe over 5 seeds
  (`20261117/18/19/1/42`) measuring layout distances, jam-at-door legality with the core's own LOS
  sampling, and the `cleared` gate. Drones are killed by a **declared fixture** (unit-level gate probe,
  not a play claim).

## 1. Verdict summary

| # | Check | Result |
|---|---|---|
| 2 | one shared rule, consumed by formal World **and** Headless | **PASS** |
| 3 | route completion gating (uncleared room / JAMMED / cross-room) | **PASS for World**, **FAIL for Headless parity** (M1) |
| 4 | scenario restore consistency, no Owner bypass | **PASS** (World), **FAIL** route replay in Headless (M2) |
| 5 | R0 / death rule untouched | **PASS** |
| 6 | legacy non-demo path unchanged | **PASS** |
| 7 | minimal function, no second simulation | **PASS** (with the M1 caveat) |
| 8 | layout: no silent overlap, jam-at-door natural | **PASS on data**, **FAIL** old P1 assertion (M4) |
| 9 | silent fallbacks (overlap / unwalkable pseudo-success) | **FAIL** (M3) |
| 10 | authored map mutation / room-graph validity | **PASS**, two nits (M5, M6) |
| 11 | portal presentation vs interaction point | **FAIL** (M7, half-tile offset) |
| 12 | missing evidence: 3-seed legal completion, contrast metrics, headless input chain, source unit tests | **FAIL** (M8–M11) |

No blocking finding against the *architecture*: the shared-rule shape is right. Line-level fixes below.

## 2. One rule, two presenters — PASS

- `relay.ts:19-30` `routeTargetFor(relay, routes)` — pure, no World/map import, delegates to the
  existing `routeMatches` (`relay.ts:12-17`). `p1RouteFor` (`p1Scenario.ts:39-42`) stays as the
  route-object wrapper; both go through `routeMatches`, so there is **one** predicate, not two.
- World consumes it: `World.ts:703-708` `p1RouteTarget` → `routeTargetFor(...)`; portal derivation
  `World.ts:666-695` (`p1RouteFor(...).target`, same rule).
- Headless consumes it: `worldHeadless.ts:379` inside `routeState`.
- The authored builder is shared, not copied: `p1Scenario.ts:138-181` `buildP1Scenario`;
  World `World.ts:622-626`; Headless `worldHeadless.ts:301-303`.
- Walkability input equivalence (the one place where "shared builder" could secretly diverge):
  World passes `this.isWalkable` (`World.ts:976-989`, 4 corners, wall/lava/water blocked) while
  Headless passes `isWalkableFromState` (`sim/core.ts:841-855`, same 4 corners, same blocked set,
  same out-of-bounds = wall). Semantics match → same cells for the same seed. **PASS (static)**;
  dynamic equality is UNVERIFIED because the World path needs a Phaser boot (§15).

## 3. Route completion, uncleared room, JAMMED, cross-room — World PASS, Headless FAIL (M1)

World (correct, and unchanged in shape from P1):
- `World.ts:676-681` — no portal at all while `room.cleared` is false;
- `World.ts:1478-1494` — entry requires the P1 room cleared **and** `Math.hypot(...) < 2.0`;
- `World.ts:695` — `JAMMED`/`DISABLED` ⇒ `target === null` ⇒ `clearPortal()` (jam closes the exit,
  it does not delete the safety assertion — matches the product decision).

**M1 (must fix before P4 evidence).** Headless re-derives "cleared" from a different source and the
headless core never sets the flag the World gates on:

- `worldHeadless.ts:376-377` `roomCleared = live drones in room === 0`, while the World reads
  `map.rooms[id].cleared` (`World.ts:676`) and `core.ts:748-749` rejects on the same map flag.
- `worldHeadless.ts:332-336` sets `combatRoom.cleared = false` and nothing in the headless tick path
  ever sets it to `true` (`grep cleared src/ai-native/worldHeadless.ts` → only `:332`, plus the
  `status='cleared'` at `:803`, which is a different field).
- Measured consequence on all 5 seeds: after the authored drones die, `routeState.roomCleared === true`
  while `map.rooms[roomId].cleared === false` → **DIVERGES=True** (probe rows in the log). A headless
  report would therefore claim "route completed" in a state where the rendered gate, the core
  `descend` gate and `GameScene.ts:794` would all still refuse.
- Fix: make §routeState read the same authoritative flag and add the core rule that sets it
  (e.g. a `room-cleared` step in the core when the authored sentries die), or explicitly document that
  headless completion is a *lower* bound and assert `map.rooms[roomId].cleared` instead of drones.
  Whatever is chosen, World and Headless must not answer with two different states.
- Also note `roomCleared` ignores `room.spawned` and pending room-enters, both of which the World
  requires (`World.ts:1177-1179`).

Cross-room: route targets are normal rooms; boss/extraction are excluded (`p1Scenario.ts:143-149`) —
**PASS**.

## 4. Scenario restore / Owner boundary — PASS (World), FAIL (Headless replay, M2)

- Call order on a restored run is correct: `GameScene.ts:171` `setupP1Scenario()` (rebuilds authored
  data, teleports to `playerStart`) **before** `GameScene.ts:176` `restoreCheckpoint()` (which then
  writes the saved player position). Authored cells are deterministic from the seed, so the rebuild
  matches the saved scenario.
- No stale route target after restore: `World.ts:637` `lastP1RouteTarget = -1` at setup and
  `World.ts:672-681` resets it when the room is not cleared / not current, so the portal is always
  re-derived from the committed relay state instead of an inherited value. **PASS**
- Owner/permission: the patch adds no command, no queue rule and no restore rule. Headless
  `routeState` is a **getter**; nothing in it can complete a route, toggle the relay or write a
  receipt. `enqueueCommand` for `spawn-signal-device` / `link-drones-to-signal`
  (`worldHeadless.ts:331-334`) mirrors the product path (`World.ts:653-664`) and does not touch
  Owner/epoch/queue/restore code. **PASS — no bypass.**

**M2.** Headless has no route/portal checkpoint or replay: `HeadlessWorldFrame` (snapshot
`worldHeadless.ts:896-915`) and `restore()` (`:916-944`) carry no demo/route fields, and
`fromSimulationState` (`:823-869`) leaves `demoScenario` undefined because `Object.create` bypasses
the field initializer → `routeState === null` silently after any restore/replay. P4_LEVEL_PLAN §4
("Headless: ... replay/restore from `portalTarget`") and §5.3 ("Add a replay test for route target +
portal after restore") are therefore **not implemented**.

## 5. R0 / death rule — PASS

- No P4 byte touches death: `GameScene.ts` is not in the patch at all; `onDeath()`
  (`GameScene.ts:919-938`) still ends the run via `saveSystem.finishRun(..., false, ...)` and starts
  `GameOverScene`. Death ⇒ new run ⇒ new R0; only exit/refresh restores the last checkpoint. Unchanged.
- The authored spawn move (`World.ts:633-636`) writes the sim position directly, which is safe here
  because `Player.wx` proxies `world.playerX` (`entities/Player.ts:60`), so sprite/camera follow on the
  next update; it runs only when the scenario is created (`World.ts:619` guard) i.e. at R0, never on a
  restored or in-progress run. **PASS**
- Note (not a defect): because `room.kind` becomes `combat` and `cleared=false`, R0 is no longer a
  "safe cleared" room in the demo, which is exactly why `RunCheckpoint` (`systems/RunCheckpoint.ts:121`)
  still requires the current room to be in `clearedRooms` — P2's checkpoint semantics stay intact.

## 6. Legacy non-demo path — PASS

- Headless: the original construction is preserved verbatim in the `else` branch
  (`worldHeadless.ts:335-347`) — `findPlacement` + one drone at `placement.drone`, same as `1a6306f`.
- World: the legacy portal path (`World.ts:1395-1401` `placePortalForTarget`, entry gate
  `:1482-1488` "only ACTIVE opens", `:1489-1494` deck exit) is untouched; the authored branch is
  entered only when `this.p1Scenario` exists.
- `p1Scenario` stays `null` for old rooms, so nothing new runs.

## 7. Minimal function, not a second simulation — PASS (caveat M1)

The patch adds one pure function plus one data builder; it does not add a rule engine, a `LevelRule`
registry, a second `SimulationState`, or a presentational copy of combat. The caveat is §3/M1: the
*route rule* is single, but the *route state* is still computed twice, and the two do not agree.

## 8. Layout measured on 5 seeds — PASS on the data, FAIL on one stale assertion (M4)

Probe (fixture kills, declared): `…\p4-pre-probe.log` `P4_PROBE_ROWS`.

| seed | player↔relay | relay↔portal A/B | portal A↔B | drone↔portal min | jam at door (core range+LOS) | route kinds |
|---|---|---|---|---|---|---|
| 20261117 | 4.24 | 1.00 / 1.00 | 2.00 | 5.10 | in-range ✓ LOS ✓ (both) | combat, resource |
| 20261118 | 3.61 | 2.00 / 2.24 | 4.12 | 5.10 | ✓ / ✓ | resource, elite |
| 20261119 | 3.16 | 1.41 / 1.00 | 2.24 | 7.07 | ✓ / ✓ | elite, combat |
| 1 | 4.24 | 1.00 / 1.00 | 2.00 | 7.62 | ✓ / ✓ | combat, resource |
| 42 | 3.61 | 2.00 / 2.24 | 4.12 | 5.44 | ✓ / ✓ | resource, elite |

- P1's two layout defects from the plan are genuinely gone: spawn ≠ device cell (3.16–4.24 apart) and
  the door is inside `JAM_RANGE` by construction, with the **core's own** LOS sampling clear
  (`core.ts:466-476` replicated in the probe) → the "stand on the door, jam" action is naturally
  reachable. **PASS**
- Route targets are always adjacent rooms of the start room on these seeds (`nonAdjacentRouteNodes: 0`),
  so the `connectedTo` pushes (`p1Scenario.ts:155-159`) are no-ops here.

**M4 (tester, per the product decision).** `tests/gameplay-01.spec.ts:578`
`expect(atDoor.distanceRelayDoor).toBeGreaterThan(TUNE.JAM_RANGE)` now **must fail** (1.0–2.24 < 6).
Replace it with the natural-jam assertion: the door is *within* jam range, jamming from the door makes
the route target `null` and removes the portal (not "move the door back"), then jam expiry restores a
selectable route. Keep the existing jam-blocks-exit safety assertions untouched. The old
"vehicle/fixture teleport" note in the same block becomes obsolete (the jam is now natural).

Design note (not a defect): relay↔portal 1.0 tile and portal↔portal 2.0 tiles collapse the route
decision and the device into one corner; the second route is 2–4 tiles from the first, so a player
standing on A can almost touch B. Fine mechanically, but if the intent was a two-branch choice, the
authored distances should be raised (still < `JAM_RANGE`, e.g. relay↔portal 3.5–4.5, portal↔portal ≥ 6).

## 9. Silent fallbacks — FAIL (M3)

Three fallbacks degrade silently instead of failing visibly:

1. `p1Scenario.ts:98` `if (candidates.length === 0) return [{ ...relay }, { ...relay }];` — two sentries
   on the relay cell (stacked enemies on the device). The plan's §5.1 explicitly forbids overlap.
2. `p1Scenario.ts:128` `let best: Vec2 = { ...player };` — if no walkable cell qualifies, the relay is
   placed on the player's own cell (the exact defect P4 was supposed to remove).
3. `p1Scenario.ts:56-78` `closestWalkable` starts from `best = target` (the room centre) and returns it
   unchanged when nothing probes walkable → a portal cell in a wall; `routeState.portal` then exists and
   `playerAtPortal` (≤2.0) can be true next to an unreachable point → "walkable pseudo-success".
   Portal A/B can also collapse onto one cell (`:165` only *penalises* reuse; a room with one walkable
   cell still yields identical portals) — no check, no error.

None of these occur on the 5 measured seeds, so they are latent, not observed. Fix: return `null`
(and let `p1ScenarioError` show a visible notice, as `World.ts:627-630` already does) when the authored
cells cannot be placed, or assert distinctness (portal A ≠ B, relay ≠ playerStart, sentry ≠ relay/player).

## 10. Authored map mutation / room graph — PASS with two nits (M5, M6)

- Mutations are limited to the authored contract: `connectedTo` pushes (idempotent, `:155-159`) and
  `room.kind = 'combat'` (`:161`); guarded by `targets.length < 2 → null` (`:151`) **before** any
  mutation. Deterministic for a given seed because both presenters iterate the same `map.rooms` order.
  Room-graph validity on 5 seeds: route targets adjacent, never boss/extraction. **PASS**
- **M5.** `p1Scenario.ts:142` hardcodes `ctx.map.rooms[0]` as the authored room instead of the room
  with `kind === 'start'`. On the 5 seeds rooms[0] *is* the start room, but after `:161` the map no
  longer contains any `'start'` room, so a later `map.rooms.find(kind === 'start')` returns `undefined`
  — which already happens in `worldHeadless.ts:859` inside `fromSimulationState`: a restored demo world
  reports `startRoomId: null` while a fresh one reports `0`, so the identity hash of a restored demo run
  differs from the fresh one. Fix: capture the start room id before the mutation (or keep the kind and
  add a separate `authoredDemo` flag), and use it in the builder.
- **M6.** The identity hash is taken **after** the mutation (`worldHeadless.ts:355-362`), which is the
  right order for "hash the state you actually run", but it means demo and non-demo worlds with the same
  seed hash differently — parity tooling must not compare them without accounting for it. Document it.

## 11. Portal presentation vs interaction point — FAIL (M7)

`p1RouteTarget` passes the authored cell **centre** (`p1Scenario.ts:167` `x + 0.5`), and
`World.ts:687` forwards it to `makePortal(target, route.portal)`, but `makePortal`
(`World.ts:1390`) assumes a **tile corner** and adds half a tile:

```ts
const s = this.worldToScreen(best.x + 0.5, best.y + 0.5);   // World.ts:1390
this.portal = { spr, targetRoom: target, wx: best.x, wy: best.y };  // World.ts:1402
```

so for the authored route the beacon sprite, its `F · R-xx` label and its glow are drawn **half a tile
away** from the real interaction point (`wx/wy`, which is correct and matches the Headless ≤2.0 rule).
Legacy callers pass integer tile coords (`World.ts:1366-1375`), which is why the `+0.5` exists.
Fix (one line): pass `{ x: route.portal.x - 0.5, y: route.portal.y - 0.5 }`, or make `makePortal` take
centre coordinates and update the legacy caller. This also matters for the §8 question "is the door
visually usable next to the device": right now the art sits between cells.

## 12. Missing evidence for P4 acceptance — FAIL (M8–M11)

Not implemented in these bytes (checked by absence of code, not by reading a claim):

- **M8** 3-seed legal-completion runs. There is no driver that clears the authored room by *playing* and
  walks to a portal with real intents; `routeState` is a read-only projection. Probe kills are a fixture.
- **M9** HumanOnly vs HumanEcho contrast metrics (time, damage, energy, action count, acceptance
  failures). Nothing measures them; `COOP_LEVEL_DESIGN.md` §"metrics" is still a draft.
- **M10** Headless input chain: no `runSteps`-based scenario that produces a clear + route completion
  (and no route/portal in the frame/replay, §4/M2).
- **M11** Source unit tests: `grep -rl "routeTargetFor\|buildP1Scenario\|routeState\|demoScenario" src/ --include=*.test.ts`
  → **no file**. P4_LEVEL_PLAN §3 requires `src/signal/relayRoutes.test.ts` + a headless
  route/portal/checkpoint replay test. My probe is reviewer-side only and is not committed.
- Also absent: a **DEMO 03 · TWO ROUTES** entry (no `DEMO 03`/`TWO ROUTES` string anywhere in `src/`),
  so the new layout is only reachable through the existing `p1` demo id.

## 13. Pre-existing defect observed (not part of this patch, do not attribute to P4)

`World.ts:1184-1191` sets `r.cleared = true`, clears the seal, places the portal and fires
`onRoomCleared` **twice** for the same clear (identical duplicated block). Present in `1a6306f:World.ts`
as well. It will double-count clears in any P4 metric that counts room-clear events;
it is safe to fix while touching this file, but it is not a P4 regression.

## 14. Ordered fix list for the developer

1. **M1** (blocking for P4 evidence): one authoritative cleared state for World and Headless; assert the
   same `map.rooms[id].cleared` the rendered gate uses, and make the core set it when the authored
   sentries die. Until then no headless "route completed" evidence may be reported.
2. **M2** (blocking for the plan's §4/§5.3): add `demo`/`routeTarget`/`portal` to the headless frame and
   `fromSimulationState`, so `routeState` survives snapshot/restore/replay; add the replay test.
3. **M3**: replace the three silent fallbacks with `null` + visible `p1ScenarioError`, or assert
   distinctness of portal A/B, relay and playerStart.
4. **M7**: fix the half-tile portal offset (one line) — it is the only *visible* bug found.
5. **M5/M6**: capture the start-room id before mutating `kind`; document the demo-vs-non-demo hash delta.
6. **M4** (tester): replace `tests/gameplay-01.spec.ts:578` with the natural-jam-blocks-exit assertion;
   the layout is correct, the old assertion is the defect.
7. **M8–M11**: 3-seed legal-completion driver + HumanOnly/HumanEcho metrics + headless input chain +
   the two source test files. These are the difference between "architecture sound" and "P4 accepted".

## 15. Not verified here (UNVERIFIED, by design)

- World-vs-Headless authored-cell equality **dynamically** (would need a Phaser boot; verified statically
  through identical probe semantics, §2).
- Any human playtest, any full E2E/unit/build run, any model chain, P4/P5 acceptance.
- Whether the merged P4 branch reproduces these bytes later — this review is pinned to the 4 hashes above.
- Visual result of the fixed layout (screenshots) — belongs to the P4 run evidence, not to this static pass.
