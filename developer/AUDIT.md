# UI-REWORK-01 — Menu / HUD audit

Owner of this file: UI-REWORK-01 implementation worker.
Write scope: `src/scenes/PauseScene.ts` (rewritten), new `src/ui/menuKit.ts`,
`src/scenes/GameScene.ts` (HUD visibility hook only). Tests are owned by the
tester; this worker does not edit `tests/`.

Evidence: user screenshots (Pause left-column Companion links "散落"; bottom
status stacked/overlapping; LLM long button text overflowing its frame; HUD
bleeding through the pause overlay). Real code + live DOM inspection.

## 1. Inventory of UI surfaces that can be on screen at once

| Surface | File | Kind |
|---|---|---|
| HUD (vitals / weapon / hostiles / AI rows / signal / minimap / stats / help) | `GameScene.ts` (`setupHud`, `lockHud`, `refreshHud`) | screen-space Phaser objects, depth `DEPTH.hud=500` |
| Pause root | `PauseScene.ts` `mode='pause'` | Phaser objects + dim |
| Inventory | `PauseScene.ts` `mode='inventory'` | Phaser objects |
| ECHO companion | `PauseScene.ts` `echoPanel()` | Phaser objects |
| LLM companion / Owner confirm | `PauseScene.ts` `companionPanel()` | Phaser objects |
| Settings (+ Signal opt-in, external-link setup entry) | `PauseScene.ts` `showSettings()` | Phaser objects in a `Container` + interactive blocker rect |
| External-link / Owner-pairing form | `PauseScene.ts` `openExternalLinkForm()` | native DOM `<form>` appended to `<body>`, `z-index: 2147483000` |
| Level-up | `LevelUpScene.ts` | Phaser objects |
| Main menu / game over | `MainMenuScene.ts` / `GameOverScene.ts` | Phaser objects |

## 2. Root causes (ranked, all verified in source)

### R1 — Pause root has two layout systems at once
The centered button column uses `x = GAME.WINDOW_W/2` (640) while the two
Companion entries are hard-pinned to the far left:
`add.text(140, 200, 'ECHO COMPANION >')` and `add.text(140, 230, 'LLM
COMPANION >')` (`PauseScene.ts` `mode==='pause'`). They also use
`.setPadding(10,8,10,8)`, so their hit bounds are wider than the glyphs.
Result: the two entries visually "散落" outside the menu column. There is no
shared grid.

### R2 — Bottom status stack overlaps itself (direct object collision)
On the pause root, in one 70px band (y 585–655) five independent text rows are
created at once (all `setOrigin(0.5)`):
`controlText` y=585 → `externalStatusText` y=605 → `authorizeExternal` y=622 →
an **unnamed leftover** `add.text(..., 625, 'ANY MOVE / FIRE INPUT TAKES HUMAN
CONTROL')` (never stored, so never cleaned up) → `companionStatusText` (created
lazily at y=420 in `refreshExternalLabels`, unrelated) → footer y=655.
`authorizeExternal`(622) and the unnamed "ANY MOVE"(625) overlap by construction.
The AI/EXTERNAL/echo rows repeat the information that already lives in the HUD
top-right (`txtControl`/`txtAgentLink`/`txtEcho`), and the footer duplicates the
HUD's help line.

### R3 — LLM panel long labels overflow their button frame
`companionPanel()` builds every button with a fixed width `_button()` = **340px**
but the labels are `fontSize 20px`, `letterSpacing 3`:
`CONFIRM FIRST PROPOSAL (OWNER)` / `ENABLE / RE-AUTHORIZE (HUMAN)` render wider
than 340px (visible in the screenshot). No `wordWrap`, no width measurement, no
shared label/width contract.

### R4 — LLM pending list is a single unwrapped line
`companionPanel().redraw()` joins up to 4 pending suggestions with
`'   |   '` into one `add.text(...).setOrigin(0.5)` with no `wordWrap`. Any
real reason/target text runs off the right edge. It also does not distinguish
confirmable vs not, and Confirm/Reject stay enabled with zero proposals.

### R5 — No honest status/progress; no layered ESC; no input ownership
* ESC has exactly one handler that always `close()`s the whole PauseScene, even
  from Settings/ECHO/LLM/Inventory ⇒ no "逐层返回".
* Sub-pages are opened with `this.scene.restart({mode})` and the previous page's
  objects are only removed by the restart; while a sub-page is up, the root
  buttons still exist underneath as live interactive objects, so a click that
  misses the sub-page content can hit a root button (no input ownership).
* The AI/ECHO/LLM state text is re-derived ad-hoc; there is no single truthful
  status source. `companionStatusText` is created at a hard-coded y=420.

### R6 — Settings panel is a fixed 780×310 box with internal collisions
`showSettings()` places `reset` and `signalToggle` at the **same** `(0,105)`
inside the `wrap` container ⇒ the "RESET AUDIO" and "SIGNAL COLLABORATION"
labels overlap. `hint`(0,175) and `linkSetup`(0,210) are inside the 310-tall
panel while the panel is centered at y=403 (spans 248–558) — `wrap` sits at
y=300 so a child at +210 = 510 is inside, but a child at +175=475 ("ESC RESUME"
hint) sits *under* the panel edge region and the panel rectangle is painted
behind text (audit rule: a non-interactive Rectangle under text is an overlap).
Settings are also not grouped: audio, screen shake, signal opt-in and external
link setup are interleaved with no section headers, and there is no scroll.

### R7 — HUD is not hidden while a menu is open
`onPause()` freezes the world but leaves every HUD object visible at
`DEPTH.hud=500`; the pause dim is only alpha 0.82, so the HUD (top-right AI
rows, minimap, stats, help) bleeds through the paused menu (screenshot 2 and
the AI/LLM screenshots show `LOCAL DETERMINISTIC DEMO · EXTERNAL NOT
CONNECTED`, `SURVEY MAP · 2/5`, `CONTROL PAUSED` behind the menu). There is no
"降级 / 恢复" path.

### R8 — Inconsistent visual grammar across menus
Button widths across menus: 340 (`PauseScene._button`), 360/450/520
(`MainMenuScene._button`), 230×300 cards (`LevelUpScene`). No shared
padding/gap/font/wrap tokens; hover/focus/disabled states differ per scene.

## 3. Constraints preserved (must not regress)

* Human Owner authorization semantics (`authorizeExternalAgent`,
  `authorizeCompanion`, `reauthorizeCompanion`, `decide`) and the DOM pairing
  form (`data-testid="external-link-form"`, fields `bridgeUrl`/`token`/
  `ownerKey`, `data-testid="external-link-status"`, buttons AUTHORIZE/CANCEL,
  token/ownerKey always `type=password`, cleared after submit, typing isolated
  from Phaser window keyboard listeners).
* `epoch`, permission/action validation, and "pause → confirm enqueued → commit
  on next real core tick" semantics.
* Do not fake connected/设置 state: no external agent ⇒ `NOT CONNECTED`; no
  model ⇒ `NO_MODEL`; local AI demo labelled `LOCAL DETERMINISTIC DEMO`.
* World collision, movement, camera follow/zoom and the `spawnProjectile` alias
  removal in `World.ts` are out of scope for this task.

## 4. Fix design

* New `src/ui/menuKit.ts`: token set (`UI.PAD/GAP/BTN_W/BTN_H/STRIDE`, fonts,
  tones) + `MenuPage` (owns every object it creates, destroys them on leaving
  the page), `createButton()` with shared hover / keyboard-focus / disabled /
  word-wrap behaviour, `statLines()` helper. No framework, Phaser only.
* `PauseScene` becomes a single-page-at-a-time navigator with a parent map
  (`pause→null`, `inventory→pause`, `settings→pause`, `ai→pause`,
  `echo→ai`, `llm→ai`). ESC = one level back; root ESC = resume. Leaving a page
  destroys its objects, so hidden objects are never interactive.
* Pause root = exactly five entries: `RESUME`, `INVENTORY`, `SETTINGS`,
  `AI & COMPANION`, `QUIT TO MENU`, plus an **independent status footer**
  (control owner, external link, echo, LLM companion, signal), visually
  separated from the buttons and no longer overlapping the HUD because the HUD
  is hidden.
* `AI & COMPANION` collects every AI sub-surface: `AI CONTROL` (local
  deterministic), `ECHO COMPANION`, `LLM COMPANION`.
* ECHO / LLM pages report the real state: echo actor HP/mode/assist/suggestion,
  companion link status/error, and each pending proposal's kind / target /
  reason / resource cost / confirmable state. Confirm & Reject are disabled
  while there is no proposal.
* Settings grouped by the real settings object: AUDIO (master/sfx/reset),
  DISPLAY (screen shake), SIGNAL (collaboration opt-in), CONNECTION (external
  link setup). No invented settings.
* `GameScene.setHudVisible(bool)` hides the HUD while a menu is open and
  restores it on resume.

## 5. Verification plan

* `npm run typecheck`, `npm test`, `npm run build`.
* Full Playwright suite (known baseline: unit 743/745, E2E 91/93; the two
  known failing E2E are P1 read-only invuln assignment and P3a environmental
  damage).
* `tests/ui-menu-layout.spec.ts` (tester-owned) for six viewports.
