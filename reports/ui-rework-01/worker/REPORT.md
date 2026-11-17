# UI-REWORK-01 — worker report (implementation)

Branch: `fix/ui-menu-layout-rework` (local, based on `0faf95c`). **Not committed** —
the Lead commits by whitelist.

Write scope used: `src/scenes/PauseScene.ts` (rewritten), new `src/ui/menuKit.ts`,
`src/scenes/GameScene.ts` (HUD visibility only). `tests/` untouched. The existing
uncommitted `src/world/World.ts` 13-line `spawnProjectile` alias removal is
preserved unchanged. `Start-LAST-SIGNAL.cmd` and all prior reports untouched.

## 1. Source changes

| File | Change |
|---|---|
| `src/ui/menuKit.ts` (new) | Shared `UI` tokens (PAD/GAP/BTN_W/BTN_H/STRIDE/fonts), `createButton()` (one interactive rect + one wrapped label; hover, keyboard focus, disabled, tones), `MenuPage` (owns and destroys every object it creates; UP/DOWN/ENTER focus; optional region wheel-scroll). |
| `src/scenes/PauseScene.ts` (rewrite) | Single-page-at-a-time navigator (`pause→ai→{echo,llm}`, `pause→{inventory,settings}`). Layered ESC. Independent status footer. Grouped settings. Honest ECHO/LLM status + pending proposals. Existing DOM Owner/bridge form preserved verbatim in contract. |
| `src/scenes/GameScene.ts` (+25) | `hudObjects` list + `setHudVisible()`; `refreshHud()` no-ops while hidden. HUD hidden on every menu, restored on resume. No gameplay/collision/camera change. |

`developer/AUDIT.md` documents the root causes (R1–R8) and the fix design.

## 2. Behaviour / design

* **Pause root** — exactly five entries: `RESUME`, `INVENTORY`, `SETTINGS`,
  `AI & COMPANION`, `QUIT TO MENU`, plus a separate `STATUS` block:
  `CONTROL …`, `AI CONTROL: OFF`, `EXTERNAL AGENT  NOT CONNECTED`, `ECHO …`,
  `LLM COMPANION …`, `SIGNAL COLLABORATION · …`. No overlapping rows (the old
  leftover unnamed “ANY MOVE” text and the 585/605/622/625 stack are gone).
* **AI & COMPANION** — collects every AI surface: `AI CONTROL: OFF|ON · LOCAL
  DEMO` (local deterministic only), `ECHO COMPANION >`, `LLM COMPANION >`,
  `AUTHORIZE EXTERNAL AGENT`, `BACK`. States are labelled `HUMAN · LOCAL
  DETERMINISTIC DEMO · EXTERNAL AGENT`.
* **ECHO** — real actor HP / mode / assist / suggestion; enable-disable, three
  movement modes, confirm/revoke assist, back.
* **LLM** — real link state (`OFF / CONNECTED / FALLBACK:NO_MODEL /
  READ_ONLY`), real error, and each pending proposal shows kind · reason ·
  target · resource · `CONFIRMABLE`. `REJECT` and `CONFIRM (OWNER)` are
  disabled while there is no proposal. Connection config is a separate masked
  DOM form (token + owner pairing key `type=password`, cleared after submit,
  never logged/global). Owner authorization/`decide`/epoch/commit-on-next-tick
  logic is unchanged.
* **Settings** — only real persisted settings, grouped AUDIO (master/sfx/reset),
  DISPLAY (screen shake), SIGNAL (collaboration opt-in), CONNECTION (external
  link setup). The old `reset`/`signalToggle` same-(0,105) collision is gone.
* **Inventory** — same real data/queued-equip semantics; preserved the existing
  control coordinates (`EQUIP/EQUIPPED` Text at y 186/230/274, `CLOSE` at
  y=660) so the checkpoint test still passes.
* **Navigation / input** — leaving a page destroys all its objects (hidden ⇒ not
  interactive; no duplicates). ESC walks one level back; root ESC resumes. A
  direct `KeyI` inventory is a single-level overlay (I/ESC resumes), matching
  prior behaviour.
* **HUD** — hidden during menus, restored on resume. Text is never cleared, so
  no state is faked.

## 3. Compatibility

Preserved: DOM form IDs/fields/buttons (`external-link-form`,
`external-link-status`, `bridgeUrl`/`token`/`ownerKey`, AUTHORIZE/CANCEL),
owner pairing semantics, external-link authorize path, companion
`pending/decide/disconnect`, echo assist/modes, checkpoint/pause semantics,
`Start-LAST-SIGNAL.cmd`, and the `World.ts` fix.

Intentionally changed (tests must follow; tester owns adaptation):
* Top-level pause no longer hosts `ECHO COMPANION` / `LLM COMPANION` /
  `AI CONTROL` / `AUTHORIZE EXTERNAL AGENT` directly — they live under
  `AI & COMPANION`.
* ESC from a sub-page returns one level instead of resuming.
* Settings is grouped and no longer a single `Container`; volume arrows are at
  new positions.

Stable handgrips exposed on `PauseScene` (all clickable; `ButtonHandle` has
`.rect`, `.label`, `.enabled`): `btnResume`, `btnInventory`, `btnSettings`,
`btnAi`, `btnQuit`, `btnAiControl`, `btnEcho`, `btnLlm`,
`btnAuthorizeExternal`, `btnAiBack`, `btnEchoToggle`, `btnEchoBack`,
`btnEchoAssist`, `btnInventoryClose`, `btnSettingsBack`, `btnLinkSetup`,
`btnEnable`, `btnDisconnect`, `btnLlmBack`, `confirmHandle`, `rejectHandle`.
Text labels keep the established strings.

## 4. Verification (real runs, logs under `reports/ui-rework-01/worker/logs/`)

| Command | Result | Log |
|---|---|---|
| `npx tsc --noEmit` | **PASS** (0 errors) | `typecheck-final.log` |
| `npm test` | **745 / 745 PASS** (65 files) | `unit-1.log` |
| `npm run build` | **PASS** | `build-final.log` |
| `npx playwright test tests/checkpoint.spec.ts tests/resume-no-step.spec.ts` | **8 / 8 PASS** | `e2e-checkpoint-resume-final.log` |
| Worker live smoke (`capture-pause.mjs`) | **27 / 27 PASS** | `pause-smoke-final2.log` |
| Worker layout audit (`audit-layout.mjs`, six viewports, all six surfaces) | **0 clipping / 0 overlap / 0 hidden-interactive** | `layout-audit-final.log` |
| Full Playwright, pre-tester-adaptation | **60 passed / 35 failed** | `e2e-full-pre-tester.log` |

The 35 full-suite failures are **all** old-test navigation/label assumptions,
not source regressions; every one fails before reaching its assertions:
`ai-native-world` (7: old `AI CONTROL`/`ECHO`/`QUIT` coordinates),
`audit` (1: old SETTINGS coordinate + old `Container` settings),
`c3b-external-link` (9), `c3b-hard-disconnect` (1), `c3b-link-form` (3),
`c3c-bridge-reclaim` (2), `companion-room-cancel` (2), `companion-room-race`
(3), `p3b-companion-owner` (2), `signal-sdk-negative` (1),
`signal-coop-e2e` (1), `ui-menu-layout` (2: tester file still written for the
old root navigation). Example evidence: `HUD fully visible…` fails at
`enableAiViaPause` because `AI CONTROL` moved one level down, not at the HUD
geometry assertions; `authorization control is present` fails because
`AUTHORIZE EXTERNAL AGENT` is now on the AI page.

The full suite must be re-run after the tester adapts navigation; the source is
ready for that.

## 5. Remaining risks

1. Tester adaptation of the specs above is required before the E2E gate is green.
2. `ui-menu-layout.spec.ts` still navigates the old root; it must click
   `AI & COMPANION` before ECHO/LLM/AI CONTROL, and expect layered ESC.
3. The disabled Confirm/Reject controls keep an interactive rectangle and gate
   activation by `.enabled` so they remain one control (no audit overlap);
   tests should read `.enabled`, not `input.enabled`.
4. LLM pending is polled once/second while the LLM page is open (real state, no
   forced tick); it never advances the core.
5. Layout is authored for the fixed 1280×720 logical canvas (Phaser FIT); all
   six CSS viewports were audited and are clean.

---

# Round 2 — B1–B7 / F1–F3 返修（冻结候选）

Freeze hashes (sha256):
- `src/scenes/PauseScene.ts` `3f01ebae1ffb5a4edd158268ba9476262cfb36b492bbc79eaea9dc006ab08e5e`
- `src/ui/menuKit.ts` `c20131b2a402db12f1cb590754c4478c73269599f3611b1e1824fdd0f2becffd`
- `src/scenes/GameScene.ts` `aec3ff04e443fba87e1b1d52b334e297c62ed9be5670caeeb5c4a2d283a726f0`
- `src/world/World.ts` unchanged: `git diff --numstat` = `0 13` (the exact −13 alias removal), hash `967a1fa1dd54883ba8e6e984a64c3dc232766f0c9c00518073f5a6e42f7aeff7`.
No `UI.W` / `UI.H` references exist in `src/`; `npx tsc --noEmit` = 0 errors on the frozen tree.

## B1 (BLOCKER) — reauth dead branch
`openOwnerForm()` now calls `openExternalLinkForm('companion-reauth')` directly on a live link; the mode is set only by the form function. Real bridge + SDK smoke (`reauth-smoke.ts`, 11/11):
first authorize CONNECTED → real SDK `echo_observe`+`echo_suggest` creates 1 pending → ENABLE/RE-AUTHORIZE opens the reauth form → **same `CompanionLink` instance** (no new link / heartbeat leak) → CONNECTED → **old pending proposal cancelled (1→0)**.
Wrong-key observation: `CompanionLink.authorize()` clears its cap and sets `FALLBACK:NO_MODEL` on any rejected reauth (pre-existing protocol-layer behaviour, untouched). The UI no longer claims "unchanged" when it is not: it reports `RE-AUTH FAILED — link FALLBACK:NO_MODEL`. If the intended semantics are "wrong key leaves CONNECTED", that needs an authorized change in `companionLink.ts` (out of this UI scope).

## B2/R7 — compact tokens + real resize
`UI_COMPACT` (SMALL 16 / BODY 17 / BTN 20 / TITLE 40 / STRIDE 56) selected by the same `scale < 0.85` criterion as GameScene F-06. Effective CSS minima measured by the reviewer harness: **800×600 min 10.00 css px, 1024×768 min 12.80 css px, below10=0**. Resize while paused flips tokens and rebuilds the page (1280→800→1280 verified, object count 20→20→20, no duplicates).

## B3 — rendered pending bound to `suggestionId`
The first rendered row is marked `▶` and `selectedSuggestionId` is bound to it. Confirm/Reject re-fetch and act only on that id; if it changed/expired they refuse (`PROPOSAL CHANGED OR EXPIRED — NOT SENT`) and never substitute a new `pending[0]`. Verified: `selectedSuggestionId === pending[0].suggestionId`, `confirmHandle.enabled === true`.

## B4 — no focus steal
`setDecideEnabled` no longer calls `focusButton`; periodic pending polls never move focus. `finishButtons` focuses the first safe control (CONNECTION enable), never Confirm.

## B5 — HUD completeness
Deck-arrival announcement is pushed into `GameScene.hudObjects` and hides with the HUD (smoke: 23/23 HUD objects hidden while paused including the announcement). HUD restore moved to the close-tween completion (`scene.stop()` → shutdown) so it no longer brightens before the dim fades.

## B6 — form secrets + ESC
Removed the `globalThis.__externalLinkConfig = {bridgeUrl, token}` write from the external branch. ESC inside the form closes only the form (`stopPropagation` preserved; harness: `ESC closes the pairing form` ok, globals empty). Added a Phaser full-screen transparent blocker while the form is open, because a leaked submit pointer was activating the BACK button underneath (reauth smoke caught it; now fixed).

## B7 — misc
- Wheel scroll sign fixed (`offset - sign(dy)*24`); the old `+` clamped to 0. Real handler + real wheel verify shifts the inventory region 756→684.
- Volume `◀ ▶` are real buttons in keyboard focus (harness: reachable). Inventory `EQUIP` rows are focusable via a focus adapter with a visible text-background highlight (checkpoint.spec's `x=420 / y=186/230/274 / input.enabled` contract preserved).
- `refreshEcho(force)` renders immediately on entry.
- `endRegion` no longer ignores its top bound (parameter removed).
- Removed implementation copy: no "no fake connected state" / "no placeholders"; LLM title is `LLM COMPANION`, body explains Owner confirm, sections are `CONNECTION` / `PENDING PROPOSAL` / actions footer, empty is `No pending proposal.` Root status rows reduced and de-duplicated.

## Test observation interface (added)
`PauseScene` now exposes `get currentPage(): Page`, `get uiObjects(): GameObject[]`, `get uiButtons(): ButtonHandle[]`; `MenuPage.objects` and `MenuPage.buttons` are readable. `btn*` handles kept; `confirmHandle`/`rejectHandle` are the real controls; `llmConfirm`/`llmReject` are read-only aliases (no duplicate controls). ESC contract matches the Lead spec exactly (root resume; ai→root; echo/llm→ai; settings→root; pause inventory I/ESC→root; direct KeyI inventory I/ESC→resume; DOM form ESC only closes the form).

## Round-2 gates (absolute log paths)
- `npx tsc --noEmit` → PASS(0) → `D:/Project/LAST_SIGNAL/reports/ui-rework-01/worker/logs/FREEZE-typecheck.log`
- `npm run build` → PASS → `.../FREEZE-build.log`
- live pause smoke (30 checks, incl. currentPage/uiObjects/uiButtons) → PASS(30/30) → `.../FREEZE-pause-smoke2.log`
- strict 6-viewport layout audit → PASS(0 findings) → `.../FREEZE-layout-audit.log`
- redirected reviewer 800/1024 harness → 25/26 each → `.../FREEZE-audit-800-1024.log` (the only failure is the harness's own mutually-exclusive `settings keyboard focus stays on buttons only`, which requires the volume arrows to be NOT reachable while the same harness's `settings volume arrows keyboard-reachable` requires them reachable; the reviewer must update that stale check)
- targeted Playwright (checkpoint + resume-no-step) → PASS(8/8) → `.../FREEZE-e2e-targeted.log`
- reauth smoke (real bridge + SDK + Owner form) → PASS(11/11) → `.../FREEZE-reauth.log`
- extras smoke (resize / EQUIP keyboard / wheel scroll) → PASS(10/10) → `.../extras-smoke8.log`

The redirected reviewer copy differs from the reviewer original by one line: after the (now passing) "ESC closes the pairing form" check it re-opens the form before the masking checks, because the original assumed the form stayed open. The reviewer originals under `reports/ui-rework-01/reviewer/` are untouched.
