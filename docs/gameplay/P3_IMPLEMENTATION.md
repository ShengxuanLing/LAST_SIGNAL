# GAMEPLAY-01 P3 — Presentation implementation status

Date: 2026-11-17. Status: **P3 v2 DISPLAY CANDIDATE — review fixes applied; no human
acceptance; P3 source uncommitted on top of P2 candidate 87a0fac.** The P2
core/World/echo/headless/Owner/Save/queue/restore rules were **not** changed. The
v1 manifest (`reports/gameplay-01/developer/p3/final/manifest.json`) and the early
screenshots are **superseded** (older wording/hashes) and are kept as history only;
the current freeze is `reports/gameplay-01/developer/p3/v2/manifest.json`.

P3 source whitelist (5 files: 4 display + 1 pure feedback test):

| File | Change |
|---|---|
| `src/ui/feedback.ts` (new, pure) | proposal/pending/audit/error/HUD copy; no state, no World/core import, no manager/store |
| `src/ui/feedback.test.ts` (new, pure) | 8 branch tests: Queued vs Done, generic permission, unknown/restored source, no raw fields on the default page, audit order |
| `src/scenes/PauseScene.ts` | LOCAL page short copy, WAITING, `RECENT ACTIONS` + `local-audit` page, ECHO-page layered signal detail, readable colors |
| `src/scenes/GameScene.ts` | 2-line Signal HUD, removed long cost/range/last block, readable colors |
| `src/ui/menuKit.ts` | dim-label color only (`#5a7480` → `#8fb8c8`); no layout change |

No `tests/**` edit, no commit/push, no P2 security/rule change, no P4 level change.

---

## 1. Old → new copy / stable fields

| Area | P2v3 default | P3 default | Stable field |
|---|---|---|---|
| Source | `LOCAL ECHO · NO EXTERNAL MODEL · HUMAN CONFIRM REQUIRED` | `LOCAL ECHO · A HUMAN CONFIRMS` (no blanket OFFLINE: the model link may be connected) | local page subtitle |
| Status | `ECHO HP 94/100 · FOLLOW · ASSIST SAFE · OWNER HUMAN · LOW-RISK OFF` | `Ready to confirm / Queued / No local suggestion · 94/100 HP · Following · Human owner` | `localStatus` |
| Action | `LOCAL · SCAN · target 8.0,45.0` | `Scan relay` + `Seen: relay in sight` | `localProposalText` |
| Cost/range | `COST 10 ECHO ENERGY · HUMAN CONFIRM REQUIRED` | `Cost: 10 echo energy · range 12 tiles` | same |
| Freshness | `EXPIRES tick 233 · room gen 1` | `Ready now` / `Cooling down · 12s` / `This suggestion expired` | same |
| Confirmation | `HUMAN CONFIRM REQUIRED` | `A human must confirm` | same |
| Expected/uncertain | `EXPECT …`, `UNCERTAIN …` | `Expect: reveal relay details`, `Only if still in sight and permitted` | same |
| Waiting | `WAITING FOR NEXT CORE TICK · local_id` + accepted tick/room gen | `Queued` status + `Waiting to resume`; `Queued: Scan relay · runs after you resume`; `Confirm and reject are paused`; core tick only in the audit | local page + `localConfirm`/`localReject` enabled state |
| Receipt | `LAST HUMAN-LOCAL · … · E_CODE @tick … · local_id` | `Done · relay scanned` / `Rejected · Not possible right now` / `Cancelled · …` / `Queued · …` + `Recent actions: N`; empty `No recent actions` | `localNoticeText` |
| Audit | no dedicated page; raw in last line | `RECENT ACTIONS` → `LOCAL AUDIT`; friendly line per entry (`You` / `Model (Owner)` + action + Queued/Done/Rejected/Cancelled + error explanation) **then** the raw id/tick/code/target/room gen traceability line; `as of opening`; empty `No recent actions` | new `localAudit`, `localAuditText` |
| Buttons | `CONFIRM (HUMAN) · LOCAL`, `REJECT LOCAL`, `BACK` | `CONFIRM (HUMAN)`, `REJECT`, `RECENT ACTIONS`, `BACK` | `localConfirm`, `localReject`, `btnLocalBack`, new `localAudit` |
| LLM footer | `COMMIT ON THE NEXT CORE TICK` | `Takes effect when you resume` | `llmFooter` |
| ECHO hint | `ASSIST READY: an enemy is inside … confirm below`; `#5a7480` | `Assist ready · enemy in sight`; `#8fb8c8` | `echoSuggest` |
| ECHO signal detail | none | 3 layered lines: `Scan 10 energy · 12 tiles · ready`; `Jam 25 energy · 6 tiles · ready`; `Link: …` | new `echoSignalDetail` |
| HUD signal | `RELAY …` + 5 detail lines (link, keys, cost, range, energy/last), `#5a7480` | `RELAY …` + `T SCAN · Y JAM · R TOGGLE · LINK …` (2 short lines); cost/range/seconds in Pause | `txtSignal`, `txtSignalDetail`, `txtEcho`, `txtHelp` kept |
| Dim/footer | `#5a7480` / `#48606b` | `#8fb8c8` in the P3 paths | `menuKit.labelDim`; Pause footers |

The local page uses the existing MenuPage/button grid: `LOW-RISK COOPERATION`,
`CONFIRM (HUMAN)`, `REJECT`, `RECENT ACTIONS`, `BACK`; the ECHO signal detail is a
bottom Pause row below `LOCAL COOPERATION >`; no new HUD coordinates. The audit
subpage uses the same MenuPage; ESC is `audit → local → echo → ai → pause → resume`.
The raw id/tick/generation/code are only on the audit page; the default waiting
copy says `Waiting to resume` / `Queued · runs after you resume` and never repeats
a raw id. Formatting never calls `proposeLocalEcho`, clears a guard, flushes or
auto-confirms; one proposal generation happens when entering LOCAL.

### 1.1 Test handles old → new

| Handle | P2v3 | P3 |
|---|---|---|
| `localConfirm` | `CONFIRM (HUMAN) · LOCAL` | `CONFIRM (HUMAN)` (same field) |
| `localReject` | `REJECT LOCAL` | `REJECT` (same field) |
| `btnLocalBack` | `BACK` | `BACK` (same) |
| `localAudit` | none | `RECENT ACTIONS` (new) |
| `localAuditText` | none | raw LOCAL AUDIT (new) |
| `echoSignalDetail` | none | 3-layer Pause signal detail (new) |
| `echoSuggest` | long assist sentence | short assist sentence; same field |
| `localStatus` / `localProposalText` / `localNoticeText` | all-caps block | short copy; same fields |
| `txtSignal` / `txtSignalDetail` / `txtEcho` / `txtHelp` | 5-line detail, `#5a7480` | 2-line signal, readable colors; same fields |
| Pause page | `local-coop` | plus `local-audit` |
| `MenuPage.buttons` | switch/confirm/reject/back | plus `RECENT ACTIONS` |

The local pending/restored semantics are unchanged: WAITING is the same single
action; CONFIRM/REJECT disabled; **Queued** means it runs after resume; only the
real core receipt shows Done/Failed/Cancelled. A restored unknown busy row would
read `Restored queued action` and is never labeled human-local/Model Owner.

---

## 2. Evidence (fixture/agent-driven; NOT human)

- Early P3 (before the wording polish; direction check only): `reports/gameplay-01/developer/p3/early/`
  (`local-proposal`, `local-waiting`, `local-audit`, `local-done`, `hud`, JSON/log).
  Early PASS; the raw P2 TTL phrase `expires in 2s` was removed; final says
  `Ready now`.
- P2v3 before: `reports/gameplay-01/developer/p3/before/`
  (`p2v3-local-proposal-1280x720.png`, `p2v3-hud-1280x720.png`, JSON/log) from the
  clean `git archive 87a0fac` tree. P2v3 local page is the all-caps block; HUD detail
  is 5 lines at `#5a7480`.
- P3 after six viewports: `reports/gameplay-01/developer/p3/matrix/{vp}/`
  (`proposal.png`, `waiting.png`, `audit.png`, `hud.png`, `done.png`, plus
  `resize-1366x768.png` at 1280), `summary.json`, `matrix.log`, `env.json`.
  Viewports: 1920x1080, 1600x900, 1366x768, 1280x720, 1024x768, 800x600.
- ECHO-page layered signal detail: `matrix/{vp}/echo-detail.png`,
  `echo-detail.json`, `echo-detail.log`.

Measured results (all PASS):

| Viewport | P3 min CSS px | P3 min contrast | outside | overlaps | ECHO detail min px/contrast |
|---|---|---|---|---|---|
| 1920x1080 | 18 | 9.46 | 0 | 0 | 18 / 8.59 |
| 1600x900 | 15 | 9.46 | 0 | 0 | 15 / 8.59 |
| 1366x768 | 12.8 | 9.46 | 0 | 0 | 12.8 / 8.59 |
| 1280x720 | 12 | 9.46 | 0 | 0 | 12 / 8.59 |
| 1024x768 | 12.8 | 9.46 | 0 | 0 | 12.8 / 8.59 |
| 800x600 | 10 | 9.46 | 0 | 0 | 10 / 8.59 |

- WAITING: CONFIRM/REJECT both false; same action; no second enqueue.
- Result: applied audit with proposal id; `Done · relay scanned`; after re-entry the
  page may offer a fresh proposal (P2 behavior).
- HUD: 2 signal lines; `txtEcho`/`txtHelp` kept; pause hides/restores the HUD as
  before.
- Focus: at 1280 the switch starts focused; DOWN moves to RECENT ACTIONS while
  CONFIRM/REJECT are disabled (the MenuPage skips disabled controls by design).
- Resize: 1280→1366→1280 local page min 12→12.8→12, no outside, page stays local.
- Repeated page build: PauseScene children 17→17 after BACK + LOCAL re-entry
  (destroy/no stacking).
- ESC: local → echo → ai → pause; the final close is the normal resume; the page
  property remains `pause` after close (scene inactive), no extra layer.

---

## 3. Gates (P3 v2; independent tree; own reports; original timeout)

Gate workdir `D:/tmp/gp01-p3-ui` (P3 v2 source copies; own reports); devroot the
same; `LAST_SIGNAL_ROOT` unset; c2/c3c not run. The main shared old reports were
not written. Source hashes in the isolated tree equal the main working tree
before/after.

- `npx tsc --noEmit` (unfiltered, isolated tree) → PASS(0) → `reports/gameplay-01/developer/p3/logs/p3v2-typecheck-isolated.log`
- `npx tsc --noEmit` (main working tree) → PASS(0) → `.../logs/p3v2-typecheck.log`
- `npx vitest run src/ui/feedback.test.ts` (isolated) → PASS 8/8 → `.../logs/p3v2-feedback-isolated.log`
- `npx vitest run src/ui/feedback.test.ts` (main) → PASS 8/8 → `.../logs/p3v2-feedback-targeted.log`
- Six-viewport v2 matrix → PASS 6/6; outside=0, overlaps=0, min CSS 10–18, contrast 9.46 → `.../logs/matrix-p3v2.run.log`, `.../matrix/summary.json`
- Audit page with 8 real entries at 800x600 → PASS: 8 entries / 21 lines, min 10 CSS, outside=0, single pending true, ESC→local-coop, scroll region measured inactive (content fits) → `.../logs/audit8.run.log`, `.../audit8/audit8.json`
- ECHO-page detail 6/6 (v2 source) → PASS; min CSS 10, contrast 8.59 → `.../logs/echo-detail-p3v2.run.log`, `.../matrix/echo-detail.json`
- HUD unchanged in v2 → carried over from v1 (2 signal lines, #8fb8c8); not re-run as a v2 change.
- `npm run build` / `npm run test:mcp-surface` → not re-run in v2 (no core/P2 change); v1 logs remain `build-final.log` / `surface-final.log`.
- Full 794 pure suite → not re-run in v2 (Tester owns full regression; no P2 change); v1 historical `strictunit-final.log` 794/794.

No P3 v2 copy unit tests were added beyond the 8 real feedback branches; the pure
module is otherwise covered by typecheck/build (v1) and the browser matrix.

## 4. Short human playtest plan (NOT executed; HUMAN PENDING)

1. **HumanOnly** — DEMO 01 without enabling ECHO; can the player read the HUD and
   clear/route without logs.
2. **LocalAI** — local deterministic demo; can the player explain what it is and
   that it is not a model.
3. **HumanEcho** — enable ECHO, read the local suggestion (target/seen/cost/range/
   freshness), confirm, wait, resume, see Done; then reject, switch auto off, take
   over and stop ECHO.
4. **Signal** — T/Y/R and the Pause signal detail; can the player state cost, range,
   remaining time and linked fire without a log.
5. **Proposal confirmation** — a local scan/toggle; WAITING; the audit page; raw id
   only in audit; explain Local vs Model Owner and whether anything was executed
   before it actually runs (the audit carries the raw tick).

Record comprehension, misreads, time and any invented-cause confusion. A fixture
run is not human acceptance; label every session honestly.

---

## 5. Failures / limits (do not over-claim)

- No human played; all screenshots are fixture/agent-driven. Not human acceptance,
  not proof of understanding, not a full Tester pass.
- The audit page is only exercised with one real entry in the matrix; the 8-entry
  page layout is not independently tested. At 800 the raw line wraps (complete, no
  overlap) but is dense. The early screenshot still shows the pre-polish
  `VIEW AUDIT`/`expires in 2s`; the final matrix uses `RECENT ACTIONS`/`Ready now`.
- The focus check skips disabled CONFIRM/REJECT while pending by design; it is not
  a keyboard-only full matrix. Double-click/pointer edge cases were not run.
- `E_PERMISSION` intentionally stays broad (`Action not permitted · check the target
  and permission`); the precise range/LOS split is a separate P3 rule decision, not
  invented here. `E_RETRYABLE` is not called cooldown.
- The P3 source changes no core/Owner/queue/restore rule; the P2 v3 fixed test tree
  at 87a0fac does not see these display changes. The real-model ECHO chain and the
  Tester full regression remain external.
- P4 remains out of scope: spawn/relay overlap, door-vs-jam layout, and the route
  Headless gap stay P4.
- The `#5a7480` replacement is limited to the P3 paths; other screens outside this
  whitelist are not part of this claim.

---

## 6. P3 freeze

The source hashes, docs hashes, gate logs, viewport summary, evidence list and
explicit not-claimed list are in
`reports/gameplay-01/developer/p3/final/manifest.json`. P3 stops after this freeze;
the independent reviewer/Tester acceptance is next. No commit/push, no P4.
