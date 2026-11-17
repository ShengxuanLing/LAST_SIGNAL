# GAMEPLAY-01 — P2 Implementation Status (ECHO local cooperation)

Date: 2026-11-17. Branch: `feat/gameplay-01-ai-cooperation` (P1 committed; P2 changes
uncommitted in the working tree).

Status: **FROZEN CANDIDATE — independent review pending. Not human acceptance.**
This document records what P2 actually implements, what it deliberately does not,
and the evidence. The design/contract remains
`docs/gameplay/ECHO_COOP_BEHAVIOR.md`; the B/M answers remain
`docs/gameplay/P2_DESIGN_RESPONSE.md`.

---

## 1. Implemented (source)

### 1.1 Pure ECHO policy — `src/ai-native/echo.ts`

- Existing FOLLOW / HOLD / MOVE-TO preserved. Added an explicit **OBSERVE** mode.
  HOLD and manual MOVE-TO take priority over any autonomy; OBSERVE never fires.
- Local perception memory is **only** `source:'echo-perception'`; cap 16, TTL 600
  ticks, entries carry `kind`, `expiresAtTick` and `roomGeneration`. A committed
  room change (`setRoomGeneration`) clears memory, proposal, rejection cooldown and
  safe target. Relay memory is last-seen only (no hidden state field).
- `EchoLocalProposal` from a legal `EchoView` only: `id/kind/target/reason/
  evidenceRef/observedTick/expiresAtTick/roomGeneration/provenance:'local-echo'/
  expectation/uncertainty/cost/needsConfirm`. Kinds: `scan` (real `SCAN_RADIUS`,
  echo energy + scan cooldown) or `toggle-relay` (real `JAM_RANGE`). Proposing does
  **not** execute anything.
- An existing proposal is revalidated on every refresh: if its action/target is no
  longer legal (e.g. after a scan cooldown starts) or the perceived relay moved, it
  is replaced; the page never displays a stale action.
- **One in-flight local action:** a human confirm moves the proposal into
  `pendingLocalProposal` (`markLocalPending`), which blocks `propose` and makes
  `validateLocalProposal` return `E_ALREADY_PENDING`. It clears only after the real
  core applied/rejected receipt or an explicit lifecycle cancel; the World removes
  the exact queued command before clearing.
- `validateLocalProposal` is pure and fail-closed: `E_OWNER_NOT_HUMAN`, `E_STALE_ID`,
  `E_EXPIRED`, `E_STALE_ROOM`, `E_REJECTED`.
- Human rejection clears the proposal, records the rejected id, and blocks
  re-proposal for 120 ticks.
- Low-risk switch: `setAutonomy(false)` clears only the autonomously chosen
  movement, never the manual mode. Safe-move candidates require: within echo
  perception (12 tiles), explored + LOS + walkable, no perceived hostile within
  2 tiles of the target, not the player's cell. If the view cannot prove a cell,
  the controller stops (the UI wording is "reduce visible risk", not a future
  safety promise).
- `reset()` clears mode/memory/proposal/assist/intent for checkpoint restore,
  death and new R0. The saved switch itself is owned by the World.

### 1.2 Bounded audit (not perception) — `src/ai-native/echoAudit.ts`

Separate ring (cap 32) of human-local / owner-external decisions with
`tick/action/target/result/code`. It is never read by `suggest`/`decide`; it cannot
pollute ECHO perception memory.

### 1.3 World boundary — `src/world/World.ts`

- `echoPolicyView()` extends `echoView` with a bounded `canWalk` check (explored +
  LOS + walkable + within 12) and the persisted switch; no hidden hazard/future read.
- `proposeLocalEcho()` only produces a non-executing proposal.
- `confirmLocalEchoProposal(id)` is the only local-confirm boundary. It validates:
  echo alive, human owner, current displayed id, not consumed/rejected/expired,
  current room generation, target still legally perceived, then takes
  `originRoomId` **at confirmation**, runs the same core action/energy/cooldown
  checks, enqueues for the next tick only, and sets `provenance:'human-local'`.
  The agent cannot forge this provenance. It never creates a CompanionLink,
  session, epoch, cap or `CONNECTED` state.
- **Single pending guard:** `pendingLocalAction` records
  `{proposalId, acceptedTick, kind, target, roomGeneration, originRoomId, command}`.
  Any second confirm (UI or direct boundary call) while it exists, or while any
  signal command is unsettled, fails closed with `E_ALREADY_PENDING`, records the
  attempt against the attempted id, and does not enqueue, overwrite the pending row
  or touch the queued command. The applied/rejected audit row carries the
  `proposalId`; a different action's receipt cannot clear the local row.
- **Lifecycle:** room-generation change, echo disable and explicit revoke call
  `cancelPendingLocalAction`, which removes THIS exact command from core, records
  `cancelled` with the proposal id and only then clears the guard. A new run/reset
  clears after the core reset. Owner becoming non-human does **not** retroactively
  cancel an already human-confirmed command; it blocks new local confirms. The
  low-risk switch OFF only withdraws autonomous movement and never cancels the
  confirmed action. The external Owner path keeps its existing semantics.
- `rejectLocalEchoProposal(id)` clears and records the rejection.
- `setEchoCooperationOptIn` is human-only; AI/external ownership is read-only.
  OFF clears autonomous intent/target but not the manual mode; pause/death/new R0
  reset the per-run runtime (`reset()` + pending intents/audit) without silently
  enabling the saved switch.
- The external Owner path stays `provenance:'owner-external'` and its
  `enqueueCompanionAction` contract is unchanged.
- Room change invalidates memory/proposal/pending local signal; signal results
  settle the pending audit as `applied` or `rejected` with the real core code.

### 1.4 Pause UI — `src/scenes/PauseScene.ts`

- New `ECHO LOCAL COOPERATION` page, reached from `AI & COMPANION → ECHO COMPANION
  → LOCAL COOPERATION`.
- Clearly separate from the OWNER/MODEL surface: `CONFIRM (HUMAN) · LOCAL`,
  `REJECT LOCAL`, the `LOW-RISK COOPERATION: ON/OFF` switch (default OFF), and a
  `LOCAL ECHO · NO EXTERNAL MODEL · HUMAN CONFIRM REQUIRED` subtitle.
- Shows the proposal (kind/target/evidence/tick/expiry/room generation/expect/
  uncertainty/cost), the switch/owner status, disabled states for AI/external or
  no proposal, the last human-local result, and the applied result after the real
  tick (the stale "ENQUEUED" line is superseded by `LAST … APPLIED`).
- While the single action is in flight it shows
  `WAITING FOR NEXT CORE TICK · <proposalId>` and disables CONFIRM/REJECT; the
  waiting id is the same id as the confirmed action, not a new proposal.
- Compact 800×600: 16 logical px SMALL_FONT under the 0.625 FIT scale = 10 CSS px;
  no text outside the 1280×720 logical page.

### 1.5 Persistence — `src/types/index.ts`, `src/systems/SaveSystem.ts`

Optional `permanent.echoCooperationOptIn?: boolean`, default **false**. A legacy
save lacking the field stays false (not consented); a malformed value fails
validation and upgrades to false. An explicit ON/OFF persists.

### 1.6 Formal headless entry — `src/ai-native/worldHeadless.ts`

- Holds the **same** `EchoController`, `autonomyEnabled`, room generation, local
  proposal/confirm/reject. `runSteps` uses the controller decision when no
  diagnostic `echoIntent` is supplied; P2 autonomy tests do not hand-write an echo
  override.
- `fromSimulationState` (the restore factory) now initializes the controller; this
  was a real bug found by the parity gate (the old factory bypassed class fields).
- Local confirm takes the same validations (with an explicit `ownerHuman` argument
  for tests) and enqueues only for the next core tick.
- The Headless also records `pendingLocalAction`, rejects a second confirm with
  `E_ALREADY_PENDING`, removes the exact queued command on explicit cancel, and
  settles the audit row with the proposal id only when the real tick event is
  processed.

### 1.7 Raw-sim restore / queue guard (v3)

The reviewer’s `headless-restore.log` reproduced this: `fromSimulationState` cloned
`pendingCommands` but dropped the local guard, so `propose`/`confirm` could enqueue
a second command (queue 2). That was a restore/parity boundary, not the normal
checkpoint path.

- The restore keeps the core queue **exactly as-is**. If it contains an echo
  `signal-scan`/`signal-jam` or a `toggle-relay`, the Headless rebuilds a
  conservative restored busy marker: the exact command reference is retained, no
  command is deleted, and it is never presented as a human-local proposal/receipt.
- `proposeLocalEcho` is null, `echoPendingLocal` reports
  `{restored:true, proposalId:null, acceptedTick:null, kind}`, and any confirm fails
  `E_ALREADY_PENDING` until the real core receipt or the queue drains. The
  controller has the same `restoredPendingKind` busy state, so the guard holds even
  without the UI.
- The true receipt clears the marker without fabricating a human-local applied
  audit row. A command the core consumed/dropped with no event clears the marker
  only after it is no longer in `pendingCommands` (no deadlock).
- Other actors’ commands (player scan, spawn, move, etc.) are preserved and are not
  labeled human-local. An external Owner toggle is indistinguishable, so it blocks
  a new local confirm but is not deleted; its own tick still flips once.
- Room/generation changes and clear-intent do not drop the restored marker while the
  core command remains. Only a full reset clears it. A genuinely local pending row
  is canceled by the exact-command lifecycle path; an unknown restored row is not
  treated as local by `cancelPendingLocalEcho`.
- Echo death: a queued **local** command that the core drops without a receipt is
  cleared as `cancelled · E_ECHO_DEAD` (actual object/command state), so the guard
  cannot stick. A restored unknown command is never assigned that local receipt.
- Lifecycle calls actually present: `E_ROOM_CHANGED` and `E_ECHO_DISABLED` in the
  World; `E_LOCAL_REVOKED` only in the explicit Headless cancel test (no UI control);
  `E_ECHO_DEAD` in the dead-echo drain; a new run goes through the core reset and
  `resetEchoCooperationRuntime`, so the `E_NEW_RUN` enum was removed rather than
  claimed as a tested call. These are code/targeted-test boundaries, not UI tests.
- **Real save semantics:** `RunCheckpoint.coreState` does not include
  `pendingCommands`; `restoreCheckpoint` explicitly clears them and resets the echo
  runtime. The checkpoint is the pre-confirm safe state. A refresh between a paused
  confirm and the next core tick loses that queued action; the UI must say `Queued`
  and never claim it executed. After reload the proposal may return; the pending row
  is not resurrected.

## 2. Deliberately not implemented in P2

- **No real model call in core or P2 product path.** P2's local proposal is
  deterministic and offline. The existing external Bridge/Owner path is unchanged;
  a model can use it only through the existing formal authorization flow.
- No auto scan/jam/toggle/assist and no auto Owner confirmation; no second control
  system or generic AI framework.
- No hidden hazard/future knowledge in safe move; no acceptance of an unproven
  cell; no "reduce risk" guarantee.
- No new core signal error codes: P2 only surfaces real core codes
  (`E_COOLDOWN`, `E_ENERGY_INSUFFICIENT`, `E_RETRYABLE`, `E_PAUSED`, `E_PERMISSION`).
- P1 route/portal/objective/demo entry remains Rendered orchestration; P2 does not
  claim full ECHO Rendered↔Headless route parity. P4's minimal route rule is not
  started.
- P3 causal receipts/HUD beautification and P4 cooperative level work are not
  started.
- No human acceptance: the browser run below is fixture/agent-driven; no human
  played and no real model was used as the actor.

## 3. Verification (this working tree, 2026-11-17)

All commands were run in `D:/Project/LAST_SIGNAL`; full output is in
`reports/gameplay-01/developer/p2/logs/`.

| Gate | Result | Log |
|---|---|---|
| `npx tsc --noEmit` (strict tree) | PASS (0) | `strict-typecheck-v3.log` |
| P2 targeted source rules (39) | PASS 39/39 (19 echo policy + 17 headless + 3 save) | `strict-targeted-v3.log` |
| `npm test` (full pure, **original** 15s/20s thresholds) | **PASS 794/794** (68 files; 39 new P2 source tests) | `strict-npm-test-v3.log` |
| `npm run build` | PASS | `build-final-v4.log` |
| `npm run test:mcp-surface` | PASS 1/1 (production surface build + permission gate) | `mcp-surface-final-v4.log` |
| Raw-sim restore review repro | before fix: queue 1, guard null, second confirm → queue 2 (RED, preserved) | `final-v3/restore-red.log` |
| Raw-sim restore after fix (reviewer script) | queue 1, no proposal, second confirm false, queue stays 1 | `final-v3/restore-guard-reviewer.log` |
| Headless restore targeted scan/toggle/non-local/room/cancel/death | PASS 17/17 headless tests | `strict-targeted-v3.log`, `unit-v3-headless2.log` |
| Fresh Rendered→Headless parity, independent tree | **PASS 3/3** after a real Playwright export (1/1) in `D:/tmp/gp01-p2v3-parity`; main old signal parity hash unchanged | `final-v3/fresh-parity-export.log`, `final-v3/fresh-parity-gate.log` |
| Demo-02 final-v2 repeat-confirm proof (kept) | PASS (fixture/agent-driven; not human acceptance) | `final-v2/repeat-confirm.json` |
| Demo-02 final-v2 precise timing (kept) | PASS: paused tick 96 HP94/energy100 frozen; first commit −10; damage after resume | `final-v2/demo02-timing.json` |
| Local page compact 800×600 | pre-fix proposal-page check only; reviewer UI matrix owns 5 viewports | `demo02/demo02-local-800.json`, screenshot |

The earlier `npm-test-final.log` 780/780 was produced with a **relaxed** CLI
timeout (15s→30s, vitest 20s→35s). That timeout change was **reverted** exactly to
HEAD and is not in the whitelist; the relaxed run is kept only as
`obsolete-config` evidence and is **not** a gate. The pre-fix strict run (779/780)
was stale; v2 strict was 786/786; the current v3 strict is **794/794 PASS**. No
assertion/source was relaxed to obtain green.

The fresh parity used an independent tree (`D:/tmp/gp01-p2v3-parity`) with its own
`reports/ai-native-02/signal/parity`; the main old signal fixture was hashed before
and after and is unchanged. The old stale tree is not consumed as a PASS.

Known gate note: the legacy **AI-NATIVE-02** `test:parity` fixture under
`reports/ai-native-02/signal/parity/` is stale relative to the current signal event
shape (its rendered export predates P1/P2). CI regenerates those three files from
the real Playwright export before running `npm run test:parity`; old evidence is
not overwritten here. **Fresh parity has not been generated/verified in this
candidate**; the old stale fixture is not treated as a PASS. P2's own headless
same-policy gate is the new `worldHeadlessEchoCoop` test above. Full ECHO
E2E/fresh parity remains a tester task.

## 4. Demo-02 evidence (offline local cooperation)

Run: `node reports/gameplay-01/developer/p2/demo02-local-coop.mjs` on a real Vite
build at 1280×720. Label: **fixture/agent-driven** (mouse clicks are scripted);
**not human acceptance** and **not a real model**.

**Known-bad (pre-fix):** the original `demo02/` run and
`demo02-local-coop.mjs` predate the single-pending guard. Its
`confirmedPaused` immediately produced a second proposal (`local_110_2`), the
reviewer's BLOCKER1. Do not use that run as current evidence; it is kept
unmodified and marked known-bad. The post-fix evidence is `final-v2/` below.

**Final-v2 (post-fix, 2026-11-17):**

- Scan at paused tick **113**: confirm → `pending=local_113_1`, `pendingCommands=1`,
  CONFIRM disabled, page shows `WAITING FOR NEXT CORE TICK · local_113_1`; a UI
  second click and direct boundary calls with the same or a wrong id return false
  with `E_ALREADY_PENDING`; queue stays **1**. Resume first commit tick **114**:
  evidence 1, echo energy **90** (−10), applied audit with the proposal id, queue 0.
- Toggle at paused tick **216**: confirm → `local_216_2`, queue **1**, second direct
  confirm false/`E_ALREADY_PENDING`; switch ON/OFF and owner→AI leave the pending and
  queue at **1** (switch OFF only withdraws autonomy; AI cannot add a confirm).
  Resume tick **217** flips `manualEnabled true→false` exactly once, audit applied
  with `local_216_2`, queue 0.
- Fresh-run disable lifecycle: scan pending `local_88_1`; `DISABLE ECHO` removes the
  exact command, audit `cancelled · E_ECHO_DISABLED · local_88_1`, queue contains
  only `remove-echo`; after resume the ECHO is removed and queue is 0.
- 0 page errors. All clicks are fixture-driven, not human.

Timing final-v2: paused tick **96**, ECHO HP **94**, echo energy **100**, evidence
0; 1.2 s later identical; confirm at tick 96 records only `enqueued`; 1.2 s later
still identical, no applied. First core receipt/audit tick **97**, first sampled
commit frame **98**: energy **90** (exactly −10), evidence 1, HP still 94. Later
regen returns energy (98/100); HP first drops at tick **183 → 88** (after resume,
not paused).

The pre-fix `demo02` observations below are retained for history only; their exact
ticks/energy are not the current evidence.

Observed in the P1 demo scenario (`DEMO 01 · LINKED SENTRY`, seed 20261117):

- Initial: relay ACTIVE; no ECHO; `echoCooperation=false`;
  `companionLink=null`, `companionStatus='OFF'`.
- Human enables ECHO from the real ECHO page; spawn commits on resume; ECHO alive.
- Local page proposes `LOCAL · SCAN`, target `8.0,45.0`, evidence
  `relay:relay_main`, `@tick 110`, cost `10 ECHO ENERGY`, provenance `local-echo`;
  the low-risk switch is OFF and the confirm is available (human-only action).
- Click `CONFIRM (HUMAN) · LOCAL` while paused: audit `human-local · scan ·
  enqueued`; no core change yet.
- **Pause timing (two points):** paused tick **103**, ECHO HP **94**, echo
  energy **100**, evidence **0**; 1.2 s later the same tick/HP/energy/evidence.
  Clicking CONFIRM while paused gives only audit `human-local · scan · enqueued`
  (tick 103); 1.2 s later still tick 103, HP 94, energy 100, evidence 0, **no
  `applied`**. The paused simulation and ECHO accounts are frozen.
- **Resume first commit:** the first applied core frame is tick **104**: evidence
  **1**, echo energy **90** (exactly −10 = the proposal's 10-energy cost), audit
  `human-local · scan · applied`, player energy 100. ECHO HP at the commit frame is
  still **94**.
- **Later:** echo regeneration brings energy back (99 at tick 212, 100 later); the
  earlier `100→97` sample was a net post-regeneration reading, not a cost of 3.
  ECHO HP first drops at tick **183 → 88**, i.e. **damage occurs after resume**, not
  while paused. `companionLink` stays null and `companionStatus` stays OFF.
- After the scan cooldown starts, the page refreshes to a legal
  `LOCAL · TOGGLE-RELAY` proposal instead of offering the stale scan.
- Switch: default OFF; ON persists (`save.echoCooperationOptIn=true`), OFF
  persists false; manual mode is not changed.
- Reject: no energy change, audit `human-local · toggle-relay · rejected ·
  E_USER_REJECTED`, proposal cleared.
- AI control ownership: local switch and confirm are both disabled; AI cannot
  enable/confirm.
- 0 page errors. Exact tick values depend on menu navigation.

Artifacts:
`reports/gameplay-01/developer/p2/demo02/`
`demo02-local-proposal-1280x720.png`,
`demo02-local-after-scan-1280x720.png`,
`demo02-local-audit-1280x720.png`,
`demo02-ai-owner-readonly-1280x720.png`,
`demo02-local-800x600.png`, `demo02.json`, `demo02-local-800.json`,
`demo02-timing.json`, `demo02-timing.log`,
`demo02-timing-confirmed-paused-1280x720.png`,
`demo02-timing-after-resume-1280x720.png`.

Post-fix artifacts:
`reports/gameplay-01/developer/p2/final-v2/`
`repeat-confirm.json`, `repeat-confirm.log`,
`scan-waiting-1280x720.png`, `scan-after-1280x720.png`,
`toggle-waiting-1280x720.png`, `toggle-switch-off-pending-1280x720.png`,
`toggle-ai-owner-pending-1280x720.png`, `toggle-after-1280x720.png`,
`disable-pending-cancelled-1280x720.png`,
`demo02-timing.json`, `demo02-timing.log`,
`demo02-timing-confirmed-paused-1280x720.png`,
`demo02-timing-after-resume-1280x720.png`, `KNOWN_BAD.md`.

### 4.1 v3 raw-restore evidence (old v2 kept)

The v2 browser proof above remains valid (Rendered repeat-confirm). v3 addresses the
Headless/parity restore boundary found by the reviewer:

- `final-v3/restore-red.log`: reproduced RED — restored queue 1 but guard null,
  then a new proposal/confirm → queue 2.
- `final-v3/restore-guard-reviewer.log`: after the fix — `prop2:null`, confirm
  false, queue stays 1.
- `src/ai-native/worldHeadlessEchoCoop.test.ts` (17 headless tests): restored scan
  and toggle each execute exactly one tick/one signal change/one cost, second
  confirm false, queue 1; player/other-actor commands preserved without
  human-local labeling; external Owner toggle preserved while local is blocked;
  room generation does not clear the restored guard before the core; explicit local
  cancel cannot delete the unknown restored command; dead-echo local row does not
  stick.
- Fresh independent parity: real Playwright export 1/1 plus 3/3 parity gates in
  `D:/tmp/gp01-p2v3-parity`; the main old signal parity hash was unchanged.
- Real save: `RunCheckpoint.coreState` has no `pendingCommands`, and
  `restoreCheckpoint` clears the queue + resets the echo runtime. A refresh between
  a paused confirm and the next core tick loses the queued action; the UI says
  `Queued`, never applied; the checkpoint is the pre-confirm safe state.

## 5. Real-model connection status (does not rewrite P0)

At P0 the real-LLM path was BLOCKED (no configuration). That is preserved as the
P0 fact. Post-P0, the Lead's safe connection probe recorded that the user's
existing Magpie local endpoint is reachable:

- endpoint `http://127.0.0.1:3425/v1`, `wireProtocol=openai-chat`;
- route/model `group/elisa`;
- `GET /v1/models` HTTP 200 and a real `POST /v1/chat/completions` returned a
  non-empty `OK` (6.9 s); no Authorization header and no key exported;
- probe evidence in `reports/gameplay-01/model/magpie-connection-probe.json` and
  `CONNECTION_SCOPE.txt` (Lead-owned).

This only says the **connection** is usable. A reviewer also ran one bounded,
real-model **Player combat** smoke against the fixed snapshot `b6a98e5` (isolated
runtime/build; only official observe/action MCP tools; 4 real `/chat/completions`
requests; the model saw only the legal projection and the room was cleared with
real core events). Evidence: `reports/gameplay-01/reviewer/REAL_MODEL_CONNECTIVITY_AND_SMOKE.md`,
`reports/gameplay-01/reviewer/real-model/console-5.log` and
`trace-2026-11-17T20-55-14-035Z.json`. That is **ENGINEERING PASS, not human
acceptance**, and it does not verify the ECHO chain.

The **P2 game model chain** (legal ECHO observation → model suggestion → human
Owner confirm/reject/disconnect) is **not yet verified**; it is the next
post-freeze step. P2 does not call a model from core. The external model path
remains the existing formal Bridge/Owner authorization path; no Bridge secret or
Owner key is sent to the model, and a new bridge connection still needs human
authorization. Do not call a local proposal a real-model result.

## 6. Reviewer attention / known limits

- The P1 scenario's ECHO takes real sentry damage **after resume** (HP 94 at the
  pause/commit, first drop tick 183 → 88); the paused sim is frozen. The local
  scan is still valid. P2 does not tune combat.
- Strict full-suite result is **PASS 794/794** at the original 15s/20s thresholds
  (`strict-npm-test-v3.log`); the v2 786/786 run and the old 780/780 relaxed run are
  historical (`obsolete-config` for the latter). No timeout/assertion relaxation is
  in the tree or whitelist.
- The post-fix repeated-confirm proof is `final-v2/repeat-confirm.json`; the old
  `demo02` repeat-confirm behavior is known-bad and must not be cited as PASS.
- The v3 restore guard keeps the raw-sim queue instead of deleting it; unknown
  commands are not labeled local, and the reviewer’s real restore script now
  rejects the second confirm with queue 1. The real checkpoint path is
  pre-confirm and loses a queued action on refresh; this is documented, not
  presented as executed.
- Lifecycle calls actually present: `E_ROOM_CHANGED`/`E_ECHO_DISABLED` in World,
  `E_LOCAL_REVOKED` in the explicit Headless test (no UI control), `E_ECHO_DEAD`
  in the dead-echo drain; new run goes through core reset (the `E_NEW_RUN` enum was
  removed). No claim that every lifecycle enum was UI-tested.
- Fresh parity was generated in an independent tree; old reports were not consumed.
  The reviewer 5-viewport/fail-closed and external-owner e2e matrices remain open.
- Local scan/toggle are human-authorized resource/environment actions and are
  available even when the low-risk movement switch is OFF; the switch governs only
  autonomous safe movement.
- The proposal TTL/cooldown values are P2 constants (120/120 ticks) and are
  intentionally conservative; review may want them in tuning.
- `EchoAuditRing` is display/audit only; it is bounded and never feeds policy.
- No real human acceptance and no model-driven E2E yet; independent review and
  tester E2E follow the freeze. P2 stops here (no P3/P4).
