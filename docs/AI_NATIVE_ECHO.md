# AI-NATIVE-01 P5 — isolated minimal ECHO co-op

This is an **isolated test scenario** (`echo-coop-test`), not the formal story,
world, ECHO identity or production permission model. It exists to prove the
minimum legal human/ECHO collaboration loop on the **same authoritative model**.

## One world, two actors

- A single `SliceModel` owns the authoritative world: door/relay/guard, energy,
  cooldowns, evidence TTL and the shared tick. There is no second game per actor
  and no per-actor physics/Signal copy.
- Human and ECHO each have their own `actorId`, position, `sensorRange`, memory
  (bounded), goal and evidence set. ECHO has an action budget; the human owner
  controls pause/resume/takeover.
- Both act through **shared capability entries**, not copied formulas:
  `SliceModel.scanFrom(x, y, provenance, range)` (lab range/LOS),
  `SliceModel.jamFrom(x, y, target)` (same energy/cooldown/range/LOS),
  `SliceModel.canStandAt(x, y)`, `sharedCore.stepMovementAt`,
  `sharedCore.resolveTransitions`.
- The formal `station-zero` path is unchanged: the plain `SliceModel`/Player MCP
  tools behave exactly as before.

## The minimal legal chain

1. Human scans device **A** (door receiver); ECHO independently scans device
   **B** (seal source). Each sees only what its own position/`sensorRange`/LOS
   yields — the human does not see B and ECHO does not see A.
2. ECHO **shares a real field-whitelisted subset** of its own evidence to the
   human. Only `relationId`, `stateLabel` and `position` are selectable; `targetId`,
   `observedAtTick`/`expiresAtTick` (TTL), `roomId`, `sourceActionId` and
   `observerActorId` are fixed identity/source metadata that are always carried.
   An empty or unknown field list is rejected (`E_SCHEMA`), never treated as
   "share everything". Unselected fields are not projected into the recipient's
   evidence/visibleTargets/knownConnections/hypothesis basis, and the shared
   projection is a deep copy with no alias to the source evidence. Hidden state,
   RNG and the human's private evidence are never shared before an explicit share.
3. ECHO **proposes a hypothesis** with `confidence`/`uncertainty`. It stays
   `proposed` — never canonical — until the human acts.
4. Human **confirms** (or rejects). Only a confirmed hypothesis may execute.
5. ECHO executes the confirmed, shared-rule action (here: jam the receiver, which
   costs the same energy/cooldown and obeys the same target legality). The result
   updates ECHO memory/goal.
6. The human walks through the now-open door (`passed = true`). Every state
   change is a real rule outcome, not a hard-coded success flag.

The **refusal path** is equally real: executing an unconfirmed or rejected
hypothesis returns `E_PERMISSION` with **zero** state/resource change, and ECHO
calling owner management (`pause`/`resume`/`takeover`/`release`) is always
rejected.

## Observation and permissions

- `observe(actor)` returns a P0-valid `ObservationV1` with the actor's own
  `actorId`/position/evidence. Evidence carries its real
  `sourceActionId`/`observerActorId`/`observerPosition`/`sceneEpoch`; shared
  targets are marked `echo-shared`. Hidden-field and P0 validation are enforced.
- The P0 `ObservationV1` schema caps `hypotheses` at zero entries, so hypotheses
  are returned by the co-op surface (`status`, propose/confirm/reject responses),
  not injected into the P0 observation.
- `COMPANION` is bound to the **real ECHO actor** in this same world (not a
  separate entity-less session). It can only observe and take legal ECHO actions;
  it has no raw state, fixture or owner-management capability.
- Production Player registration and behavior are unchanged; the co-op tools are
  registered only on the `--dev` process and cannot be selected by a tool argument.

## Budget, cancellation, takeover, offline

- ECHO has a bounded action budget; a 0 budget returns `E_RESOURCE_LIMIT`.
- `cancelEcho` stops further ECHO actions (`E_CANCELLED`); a lost link returns
  `E_LINK_UNAVAILABLE` until restored.
- Human `pause`/`takeover` immediately stops ECHO motion and rejects its actions;
  the human keeps control.
- `offlineEchoPolicy` is a pure deterministic function of the **legal
  observation only**. It never reads `getState`, hidden state or RNG, and needs no
  external LLM; the same observation always yields the same proposal.

## Snapshot isolation

The co-op demo uses its own isolated schema
`last_signal.ai-native.echo-coop-snapshot.v1` (version 1). Each `CoopSession`
generates a per-instance secure-random `instanceId`/`sessionId` at construction
(no global Session registry), and a snapshot embeds and validates both plus a
per-instance `snapshotId`. Two same-seed instances can never accept each other's
frames. Authorization compares the **full canonical payload** recorded at issue
time (bounded to 64 issued frames); the public hash is integrity metadata only,
not an authorization token, so recomputing it cannot bypass a tamper check.
Unknown schema/version, forged `snapshotId`/`instanceId`/`sessionId`, missing
state, invalid positions/hypotheses/budget and cross-instance frames are all
rejected **atomically** (state and epoch unchanged); a valid frame can be restored
repeatedly, its epoch is monotonic, and a confirmation made after the snapshot is
not resurrected. It does not touch the published Player save key/version or add
required ECHO fields to old Player snapshots.

## Dev-only MCP tools and runnable demo

`game_coop_create` / `game_coop_status` / `game_coop_observe` / `game_coop_human`
/ `game_coop_echo` / `game_coop_advance` / `game_coop_snapshot` /
`game_coop_restore` / `game_coop_close` are registered **only** in the `--dev`
process. `src/ai-native/coopDemo.mts` spawns that dev server through the official
SDK client and runs the full chain plus the refusal/management/pause
counterexamples, so the Tester can call it directly:

```bash
npm run game:mcp:build
npx vite-node src/ai-native/coopDemo.mts
```

## Not implemented (explicit)

No formal ECHO identity/story/worldbuilding, no two-actor corridor geometry, no
production companion permissions, no external LLM requirement, and no change to
the main World or the published save schema/version.
