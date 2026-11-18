# GAMEPLAY-01 P3 — Player-understandable feedback (minimal design)

Date: 2026-11-17. Status: **IMPLEMENTED CANDIDATE (display only).** The P3 source
changes (PauseScene, GameScene HUD, menuKit color, pure `src/ui/feedback.ts`) are
on top of P2 candidate `87a0fac`; no P2 core/Owner/queue/restore rule changed. See
`docs/gameplay/P3_IMPLEMENTATION.md` for the copy table, evidence, six-viewport
measurements and limits. This design remains the contract; no human acceptance is
claimed.

Scope: make the existing LOCAL/core feedback readable and honest without changing
rules, permissions, core semantics or the P2 single-pending contract.

Non-goals:

- No new generic state/feedback manager, protocol, MCP tool, coordinates or page.
- No model private reasoning, hidden causes or invented failure reasons.
- No P4 level/layout work: the P1 spawn/relay overlap and door-vs-jam distance are
  explicitly left to P4.
- No core error-code change in this design; the P1 `E_PERMISSION` range/LOS split
  and the INACTIVE-jam hint remain separate P3 decisions if the Lead includes them.

---

## 1. Problems this fixes

1. The P2 local page is a large all-caps block mixing state, action, evidence,
   cost, expiry, room generation, accepted tick and raw proposal ids. The player has
   to parse `LOCAL · SCAN · target 8.0,45.0`, `SEEN perceived_relay · evidence
   relay:relay_main · @tick 113`, `EXPIRES tick 233 · room gen 1`, `COST 10 ECHO
   ENERGY · HUMAN CONFIRM REQUIRED`, and audit `LAST HUMAN-LOCAL · LOCAL-CONFIRM ·
   REJECTED · E_ALREADY_PENDING @tick 113 · local_does_not_exist`.
2. Local/offline and model/Owner sources are not visually distinct enough; the
   default must never imply a model exists.
3. The P1 HUD detail uses `#5a7480` on `#05070c` = **4.07:1**, below WCAG AA 4.5 for
   the 10.63 CSS px compact text (P1 review §3.7/§5.1; `SIGNAL_INTERACTIONS.md` §11).
4. Cost, range and remaining seconds are concatenated into long strings instead of
   layered rows.
5. The combat HUD can grow into a large block; the default should stay short and
   details should be expandable in the existing bounded HUD region.

---

## 2. Copy principles

- **Short natural language first.** State → action → seen basis → cost/availability
  → who confirms → queued/result. Body copy is sentence case; the established
  title/button typography can stay as-is.
- **Raw ids/codes/ticks/room generation are audit detail only.** The default page
  shows none of `local_113_1`, `@tick`, `room gen`, `E_ALREADY_PENDING`.
- **Source is explicit.** `LOCAL ECHO · OFFLINE` for the local path; `MODEL · OWNER`
  only for the existing external `owner-external` path. Never show both; never
  invent a link/session for local.
- **Only real receipts.** `Queued` means queued; `Done` only after the core applied
  event; `Rejected`/`Failed`/`Cancelled` use the real code/reason. No predicted
  success.
- **No invented causes.** If the core says `E_PERMISSION`, show “Not permitted”, not
  “out of range” or “no line of sight”. If a precise code exists, use it.
- **One pending action stays one action.** WAITING names the same action, not a new
  proposal; CONFIRM/REJECT stay disabled; no repeated enqueue.

---

## 3. Local page copy contract

### 3.1 States

| State | Default line | Detail/action |
|---|---|---|
| No echo | `Echo is offline` | `Enable ECHO first` |
| Ready | `Echo can help with the relay` | `Scan relay` / `Change relay route` |
| Waiting | `Waiting to resume` | `Queued: Scan relay · runs after you resume` |
| Done | `Done · relay scanned` | action + real result |
| Rejected | `Rejected · not sent` | no resource spent |
| Failed | `Scan failed · cooling down` | real code/remaining; no invented cause |
| Cancelled | `Cancelled · echo disabled` | explicit lifecycle reason |

### 3.2 Field copy (v2 final wording)

| Field | Current P2 (default) | Proposed default | Detail-only |
|---|---|---|---|
| Source | `LOCAL ECHO · NO EXTERNAL MODEL · HUMAN CONFIRM REQUIRED` | `LOCAL ECHO · A HUMAN CONFIRMS` (OFFLINE only when the link is really absent) | `human-local` |
| Status | `ECHO HP 94/100 · FOLLOW · ASSIST SAFE · OWNER HUMAN · LOW-RISK OFF` | `Ready · 94/100 HP · Following` | owner/assist/switch |
| Action | `LOCAL · SCAN · target 8.0,45.0` | `Scan relay` | `scan` |
| Seen | `SEEN perceived_relay · evidence relay:relay_main · @tick 113` | `Relay in sight` | `perceived_relay`, `relay:relay_main`, tick |
| Cost | `COST 10 ECHO ENERGY · HUMAN CONFIRM REQUIRED` | `Cost 10 echo energy` | numeric tuning source |
| Range | inside the long `RANGE · ...` line | `Within 12 tiles` (only if shown) | tiles |
| Availability | `EXPIRES tick 233 · room gen 1` | `Ready now` / `Cooling down · 12s` | expiry tick, room gen |
| Confirm | `HUMAN CONFIRM REQUIRED` | `A human must confirm` | — |
| Waiting | `WAITING FOR NEXT CORE TICK · local_113_1` + accepted/room gen | `Waiting to resume` + `Queued: Scan relay · runs after you resume` | proposal id, accepted tick, room gen (audit only) |
| Audit entry | raw id/code/tick only | friendly source/result/explanation first, raw id/code/tick below | raw traceability line |
| Result | `CONFIRMED · ENQUEUED FOR THE NEXT CORE TICK` / audit all-caps | `Done · relay scanned` | applied tick, proposal id, code |
| Reject | `LOCAL PROPOSAL REJECTED BY HUMAN` | `Rejected · not sent` | `E_USER_REJECTED` |
| Audit | `LAST HUMAN-LOCAL · ... · E_ALREADY_PENDING @tick 113 · local_does_not_exist` | collapsed `Audit` row | full row with id/tick/room gen/code |

The expandable audit row is the only place for the raw proposal id, accepted tick,
room generation and exact code. The default waiting line does not repeat the id;
internally it is the same action id and the same single pending command.

### 3.3 Source distinction

| Source | Badge | Who confirms | What may be shown |
|---|---|---|---|
| Local echo, offline | `LOCAL ECHO · OFFLINE` | `CONFIRM (HUMAN)` | local proposal, local receipt, real core result |
| Existing external model path | `MODEL · OWNER` | existing Owner confirm | model action/summary, real result; never private reasoning |
| Legacy/no device | `NO RELAY` | — | no proposal |

The local page never renders `MODEL`, a session, a cap or `CONNECTED` when the
external path is absent. The model path never renders a local proposal as model
output.

---

## 4. Event / receipt → UI mapping

No row invents a cause. `code` is the real core/local code; if the code is broad
(e.g. `E_PERMISSION`), the copy stays broad.

| Event/code | UI default | Notes |
|---|---|---|
| local confirm accepted | `Queued · runs after you resume` | audit `enqueued`; no resource spent yet |
| `signal-scanned` ok | `Done · relay scanned` | real core applied; evidence updated |
| `signal-jammed` ok | `Jam active · <remaining>s` | remaining from the view/tuning |
| `signal-relay-changed` | `Relay route changed` | toggle applied once |
| `E_COOLDOWN` | `Not ready · cooling down` | remaining seconds in detail |
| `E_ENERGY_INSUFFICIENT` | `Not enough echo energy` | echo's own account |
| `E_PAUSED` | `Paused` | core paused state |
| `E_PERMISSION` | `Not possible right now` | no invented range/LOS cause; precise split is separate |
| `E_RETRYABLE` | `Try again` | no hidden reason |
| `E_ALREADY_PENDING` | `Already queued` | WAITING; no second enqueue |
| `E_OWNER_NOT_HUMAN` | `Only a human can confirm` | AI/external read-only |
| `E_STALE_ID` | `This suggestion changed` | refresh; no action |
| `E_EXPIRED` | `This suggestion expired` | no action |
| `E_STALE_ROOM` | `The room changed` | refresh |
| `E_REJECTED` | `This suggestion was rejected` | no action |
| `E_TARGET_NOT_LEGAL` | `The relay is no longer in sight` | real target legality |
| `E_USER_REJECTED` | `Rejected · not sent` | no resource spent |
| `E_ECHO_UNAVAILABLE` | `Echo is unavailable` | no action |
| `E_NOT_APPLICABLE` | `This action is not available` | no action |
| `E_ECHO_DISABLED` / `E_ROOM_CHANGED` / `E_LOCAL_REVOKED` / `E_NEW_RUN` / `E_ECHO_DEAD` | `Cancelled · <plain reason>` | local lifecycle cancel, with id in audit |

The audit detail shows the exact code and proposal id. The UI never shows model
chain-of-thought, hidden state or a predicted result.

---

## 5. Combat HUD (short default + expandable detail)

Reuse the existing `GameScene` signal HUD region (`txtSignal` / `txtSignalDetail`)
and menuKit tokens; do not add scattered coordinates or a new manager.

### 5.1 Default (2 short lines, bounded)

- Line 1: `RELAY ACTIVE · ROUTE A` (or `RELAY INACTIVE · ROUTE B`, `JAMMED · ROUTE
  BLOCKED`), colour from the real relay state.
- Line 2: `T Scan · Y Jam · R Toggle` (short keys) and, when linked, a short
  `Link · new fire off` (the full “old shots still live” sentence goes to detail).

### 5.2 Expandable detail (same region)

Rows, not one concatenated sentence:

```
Scan   cost 10e · range 12t · ready
Jam    cost 6e  · range 6t  · 2.5s left
Link   new fire off · old shots still live
Echo   94/100 HP · 92 energy
Last   scan done · tick 114
```

- Cost is energy, range is tiles, remaining is seconds; units are labelled once per
  row. No `COST ... · RANGE ... · JAM ...s` long line.
- Expand/collapse is a small affordance in the same HUD region (no new page). The
  default must not occlude the play area; the detail is bounded to the existing HUD
  block.
- Detail text uses `#8fb8c8` (or `#eafaff` for emphasis) on the dark HUD background;
  the P1 `#5a7480` 4.07:1 value is retired. Target **≥4.5:1** for the compact
  (10.63 CSS px) text; if a colour still misses, raise the compact detail size, not
  the amount of text. The P3 implementation must record the measured contrast.

---

## 6. Controls and safety retained

- Stop ECHO / disable echo, reject, human takeover, disable low-risk auto, and the
  recent result remain available. The local page keeps `REJECT`, `BACK`, and the
  existing `DISABLE ECHO` on the ECHO page; no new control surface.
- While one local action is pending, CONFIRM and REJECT are disabled and the page
  says WAITING. The pending row is the same action; a second click/direct boundary
  call still fails `E_ALREADY_PENDING` and does not enqueue.
- Switch OFF withdraws only autonomous movement; it does not cancel an already
  human-confirmed action. Echo disable/room change/revoke cancel explicitly and
  show `Cancelled` with the real lifecycle reason.
- AI/external ownership remains read-only for local confirm/switch.
- **Real save/refresh:** the checkpoint is captured before a paused confirm and
  does not carry the queued action. If the player refreshes between `Queued` and the
  next core tick, the action is lost; the UI must never have claimed `Done`. After
  reload the proposal may return, but no pending receipt is resurrected. Say `Queued
  · runs after you resume`, not “executed”.

---

## 7. File whitelist

This round: **`docs/gameplay/AI_FEEDBACK.md` only.** No `src/`, `tests/`, config,
save or package change; no commit/push.

After the Lead's formal P3 order (proposed, not started):

| File | Allowed change |
|---|---|
| `src/scenes/PauseScene.ts` | local-page copy/state rendering; waiting disabled; audit expandable |
| `src/scenes/GameScene.ts` | short HUD default + expandable detail; contrast; layered rows |
| `src/ui/menuKit.ts` | only a shared detail-toggle/typography helper if needed; no new layout coordinates |
| `src/ui/feedback.ts` (new, pure) | event/code → copy mapping; no state, no World/core import |
| `src/ui/feedback.test.ts` | pure mapping tests |
| `docs/gameplay/AI_FEEDBACK.md` | design/status updates |

Not allowed in P3: `src/world/sim/**` rules, Owner/epoch/permissions, new MCP tools,
new page/manager, generic state store, P4 layout, `tests/**` (tester-owned).

---

## 8. Five-viewport verification matrix

Check at **800×600, 1024×768, 1280×720, 1366×768, 1920×1080** (compact/normal tokens
as resolved by the real CSS scale):

1. Default local page: no raw id/tick/room gen; source badge clear; no all-caps
   paragraph; no clipping/overlap.
2. WAITING: same action wording; CONFIRM/REJECT disabled; no repeated confirm;
   audit row expandable; no second enqueue.
3. Done/Rejected/Failed/Cancelled: real receipt/result; no invented reason; raw
   code/id only in audit detail.
4. Combat HUD: default short, does not occlude the play area; expandable detail
   bounded; cost/range/remaining on separate rows; contrast ≥4.5:1 measured on the
   compact text.
5. Controls: stop/disable, reject, takeover, switch OFF, recent result; keyboard
   focus/ESC layers; no duplicate objects; no sensitive/private text.
6. At 800×600 compact: effective CSS text ≥10 px; no text outside the logical page.

The reviewer's earlier 5-viewport/fail-closed matrix remains open; this design does
not claim it.

---

## 9. Understandability playtest questions (future, labelled)

Scenario: real DEMO 01, enable ECHO, open LOCAL COOPERATION, confirm a scan while
paused, resume; then a toggle and a disable/cancel. Fixture/agent-driven evidence is
not human acceptance; a real human session must be labelled `human`.

Ask after each state:

1. What did the ECHO suggest, and what will it do?
2. Who confirmed it — you, a model, or the game?
3. Is this local/offline or a model? How can you tell?
4. What does it cost, and when does it happen?
5. What does “Waiting to resume” mean? Can you confirm again?
6. Did it actually happen? What was the result?
7. If it failed or was rejected, why — and was any reason invented?
8. How would you stop the ECHO, reject, take over, or turn off auto?
9. Did you see the same action twice or a raw id on the default page?
10. Which text was hard to read (contrast/size), and did the HUD block the fight?

Record correct/incorrect answers, time to answer, and confusion points. Do not call
a fixture run human acceptance.

---

## 10. Left to P4 (not P3)

- P1 spawn/relay overlap (player and relay on the same tile) — P4 authored layout.
- Door-vs-jam distance (door 6.9–7.0 tiles vs JAM_RANGE 6; teleport fixture) — P4
  layout/acceptance wording.
- Solo vs human+ECHO level comparison and the minimal route rule — P4.

P3 does not move the relay, change jam range or rewrite the level.

---

## 11. Verification isolation (process note)

Shared old evidence under `reports/ai-native-02/c2/**` and `c3c/**` must not be
written by P3 gates. Current writers are the tester-owned Playwright specs
`tests/c2-parity.spec.ts` (`reports/ai-native-02/c2/parity`,
`c2-fixes-round2/parity-kill`) and `tests/c3c-headless-parity.spec.ts`
(`reports/ai-native-02/c3c/parity`); `tests/signal-rendered-parity.spec.ts` writes
the signal parity files. The pure `src/ai-native/c3cOwnerFile.test.ts` and
`worldHeadlessSnapshotBoundary.test.ts` also use `reports/ai-native-02/c3c/frames`.
Future gates must run in an independent tree with `LAST_SIGNAL_ROOT` pointing at
that tree and must not write the shared old reports. The existing modified files are
preserved for the Lead; this design does not restore or delete them.
