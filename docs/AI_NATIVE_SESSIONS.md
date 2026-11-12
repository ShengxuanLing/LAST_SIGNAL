# AI-NATIVE-01 P2 — Observation / Action / Session Gateway

`src/ai-native/sessions.ts` is the **headless gateway** over the P1 `HeadlessGame`
(the single authoritative engine). It never re-implements rules/RNG/movement/snapshot
logic and never weakens a P0 closed schema.

> Allowed at this boundary: timers, `Date.now()`, `node:crypto`. Not allowed: Phaser/DOM.

## Trusted entry — lifecycle is a separate capability

| Handle | Created by | Exposes |
| --- | --- | --- |
| `PlayerSessionHandle` | `createProductionSession()` / `createTestSession()` | `step, observe, getEvents, cancelAction, moveTo, approach, scanTarget, interactWith, waitUntil`, and `start/close` (the agent may begin/finish its **own** run) |
| `OwnerSessionHandle` | `manager.createOwnerHandle(sessionId)` (server-only) | `start, pause, resume, reset, close` — **not reachable from a Player/Test handle** |
| `TestSessionHandle` | `createTestSession({ seed })` | Player methods **+** `snapshot, restore, replay, inspectState, injectFixture` |
| `CompanionSessionHandle` | `createCompanionSession()` | independent `actorId`; every call returns `E_NOT_APPLICABLE` (no ECHO in P0) |

- A **PLAYER** handle has **no** `pause` / `resume` / `reset` and no dev methods. Pause/resume/reset
  are a human/Gateway owner capability. Permissions are structural (method absence), not a JSON
  `role`/`dev`/`audience` check.
- **Production** rejects self-chosen `seed`/`fixture`/`dev`; the server generates the seed.
  **Test** sessions accept a deterministic `seed`.
- `snapshot`/`restore`/`replay` are dev/test only and keep the P1 issued-frame binding:
  a frame issued by one instance cannot be restored into another; a test frame cannot reach
  a production session (no restore method).
- **Session ids are independent of the seed** (random 24-hex, allocated per manager, never
  overwriting the map). Two sessions — even with a duplicate `seedProvider` — are distinct.
- `observe('debug')` is `E_PERMISSION`; full state is only via the test facet's `inspectState`.

## StepRequest — P0 closed schema + strict binding

`step(request)` first runs the P0 `validateStepRequestDetailed()`. It rejects, with **no tick
change** and no exception:

- non-array / `null` / `undefined` `actions`; unknown request fields (`role`, `dev`, `audience`,
  `kind`, `seed`, `fixture`, …);
- `ticks` that are `NaN` / `Infinity` / negative / fractional / non-number; bad
  `fromTick`/`epoch`/`sessionId` types.

Then it binds:

- `request.sessionId === session.id` (else `E_SESSION_NOT_FOUND`);
- `request.epoch === session.epoch` (else `E_STALE_EPOCH`);
- `request.fromTick === game.tick` (else `E_STALE_TICK` / `E_FUTURE_TICK`);
- every action's `sessionId` / `epoch` / `actorId` to this session/actor, and
  `targetTick === fromTick + 1` (the P0 validator enforces the exact next tick).

## Idempotency (request + action)

- **Request level:** the *same* `requestId` + a fully identical request is a network retry →
  the original `StepResult` is returned with **no tick advance and no resource charge**.
  Same `requestId` + a different request → `E_ID_PAYLOAD_MISMATCH`.
- **Action level:** a repeated `actionId` never re-executes or re-charges. The fingerprint covers
  `actorId`, `epoch`, `type` and `payload` (not the scheduling `targetTick`), so a repeat under a
  **new** `requestId` still advances the explicit `ticks` but returns the original receipt with
  `replayed: true`, `resourceWritesThisCall: 0`. Same id with different identity → `E_ID_PAYLOAD_MISMATCH`.
- **Same batch:** duplicate `actionId` + same identity executes once; the second receipt is
  `replayed: true`, mapped by index. The first receipt is never overwritten.
- Failed action receipts are cached and replayed (no re-execution/charge).

## Advanced actions (bounded, cancelable)

`move_to / approach / scan_target / interact_with / wait_until` are conveniences over the
underlying `move / scan / interact / wait` only: no teleport, no collision bypass, no hidden
target reads, no whole-map pathfinding. They yield a macrotask every batch (`BATCH_TICKS = 25`)
so cancellation can land.

Each call returns an **`AdvancedActionHandle`**: a `Promise` that also carries
`actionId` and `result`. You may instead pass `{ actionId }` in `opts`. The abort handle is
registered **synchronously**, so `cancelAction(id)` can hit before the first tick.

- `cancelAction(id)` → `E_CANCELLED`, no further ticks/charges; repeat cancel is idempotent
  (bounded history); an unmatched id returns `E_NOT_APPLICABLE` (never a fake success).
- One advanced action per session at a time; a re-entrant start is `E_RETRYABLE` (explicit policy).
- `maxTicks` / `maxWallMs` / `maxActionDurationTicks` are honoured → `E_TIMEOUT`.
- **`reset` / `close` / `restore` cancel every in-flight advanced action** and bump a generation
  token; an old action can never advance the new game/run/epoch.

## Lifecycle

`created → running → paused → running → finished → closed`. `start` begins the run. Death or
completion is `finished`; a new run needs the **owner** `reset` (new `runId`, new `epoch`, R0).
After `reset`/`restore`, old-epoch requests are `E_STALE_EPOCH`.

## Budgets, isolation, cleanup

- Hard caps: **10 sessions / 2 concurrent steps**. Manager options are validated (finite positive
  integers, no unknown keys, no NaN/Infinity/negative/fraction); exceeding the caps →
  `E_RESOURCE_LIMIT`, invalid options → `E_SCHEMA`.
- Per-session: idle/wall timeouts, ticks-per-step, actions-per-step, observation events,
  events-per-page, snapshot bytes. `SessionManager` is instance-level (a `Map`, never global).
- Timers are `unref()`ed; `manager.dispose()` clears every session and timer. `close` releases.

## Observation / events

`observe(detail)` returns a P0 `ObservationV1` validated by `validateObservationDetailed` and
checked with `hasHiddenField(_, ['role'])`. `summary` keeps present facts + available actions but
drops evidence/knowledge/hypotheses/events. `standard` includes a paginated event window.
Present facts are separated from historical evidence; hypotheses are never reported as confirmed.
Events keep total order, are capped, and `getEvents(cursor, limit)` reports `truncated`.

## Not implemented this round (explicit, not faked)

MCP / LLM / ECHO entities (P3/P5); cross-process `load`/import (foreign frames rejected by P1
binding); fixture injection (test facet returns `{ status: 'unavailable' }`).

## Independent Node client

`src/ai-native/sessionClient.mts` runs the real production route to **completion** (door/bridge),
then the dev/test facet and a real `cancelAction`. It is integration verification, not P4.

```
npx vite-node src/ai-native/sessionClient.mts
```
