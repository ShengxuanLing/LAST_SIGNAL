# GAMEPLAY-01 · P3 feedback UI — test report (run32, F1–F8 + G1-a/G2 closed)

Run tree: `D:\tmp\ls-p3-accept` @ `0083e20` (`0083e2077960…`) + p3/v2 manifest (5 sources),
dev port **5492**. No product change, no model call, no `skip`, no timeout/assertion
relaxation, no injected proposal, no commit/push.

| item | value |
|---|---|
| spec | `tests/gameplay-03-feedback.spec.ts` |
| spec sha256 (final, run32) | `d446a7683560236199638b3a15af92204e31ae781a239255221921bc0b3c254c` |
| previous spec sha (run31) | `3544ee6e1b196c85da9cd62b8b0abac00a54e0638bdcf481faa98615a91bd180` |
| helpers | none — the spec is self-contained |
| archive | `run32/` (`source-snapshot/HASHES.txt`, spec snapshot, `source-snapshot/src`, logs, evidence, shots) |
| canonical copy | `spec-src/gameplay-03-feedback.spec.ts` (same sha256 as the archived snapshot) |
| product src | **unchanged**; hashes of the 5 manifest sources in `run32/source-snapshot/HASHES.txt` |
| run30 / run31 | **retained, not overwritten**; `run31/MEASUREMENT_SUPERSEDED.md` marks the one wrong HUD record |

## Gates (unfiltered, real run)

| gate | command | result | log |
|---|---|---|---|
| P3 UI spec | `PORT=5492 npx playwright test tests/gameplay-03-feedback.spec.ts --workers=1` | **PASS 7/7 (1.3 m), skip 0, `EXIT=0`** | `D:\Project\LAST_SIGNAL\reports\gameplay-01\tester\p3\run32\logs\p3-ui.log` (header line records workdir, spec sha256, commit; last line `EXIT=0`) |
| typecheck (G2) | `npx tsc --noEmit` (unfiltered, whole tree) | **PASS, 0 `error TS`, stdout 0 bytes, `exit_code=0`** | `D:\Project\LAST_SIGNAL\reports\gameplay-01\tester\p3\run32\logs\typecheck.log` |
| targeted, before the full run | `… -g "5\)"` | PASS (10.6 s) | `run32\logs\case5-targeted.log` (same spec bytes; header/sha recorded in `p3-ui.log`) |

The typecheck log is no longer an empty file: it records `workdir`, `HEAD`, spec sha256, the
four source hashes, the exact command, the stdout/stderr block (0 bytes — tsc prints nothing
on success, which is normal), `stdout_is_empty=yes`, `error_TS_lines=0` and the real
`exit_code=0`. Nothing was back-filled into the run31 log.

## G1-a (MAJOR, measurement) — closed: HUD is 10.0 / 10.625 CSS at 800×600

`hudSample()` now computes

```
css = fontSize × textScaleY × cam.zoom × (canvasCSSwidth / cam.width)
```

and records `fontSize / scaleX / scaleY / zoom / canvasScale / bounds / css` per line, so the
number can be re-derived. The live HUD is inverse-scaled by `lockHud()` (`scaleY = 1/zoom`,
re-pinned with `getWorldPoint` every frame), so the zoom cancels — asserted, not assumed:

| viewport | zoom | scaleY | canvasScale | 16 px lines | 17 px lines | lines |
|---|---|---|---|---|---|---|
| **800×600** | 0.8 | 1.25 | 0.625 | **10.0 CSS** | **10.625 CSS** | 20 |
| **1280×720** | 0.8 | 1.25 | 1.0 | **16.0 CSS** | **17.0 CSS** | 20 |

`run32/evidence/p3-hud-live-800.json`: `sizes [10, 10.625]`, `scaleY [1.25]`, `logical [16, 17]`,
`inverseScaleProduct = 1` for every line; `p3-hud-live-1280.json`: `sizes [16, 17]`.

Assertions now applied at **both** viewports (case 5):
`locked-HUD lines > 0`, `every visible line ≥ 10 CSS px`, `scaleY × zoom = 1 (±0.02)`,
`every 16 px line ≈ 10.0 / 16.0` and `17 px line ≈ 10.625 / 17.0` matching the viewport, and
`every line inside cam.worldView`. No `>= 10` was relaxed; the run31 claim that the HUD sits
below the floor is **withdrawn** (it was `17 × 0.8 × 0.625 = 8.5`, zoom multiplied twice).

## G2 (exit code) — closed

See the typecheck row above: explicit `exit_code=0` plus the empty-stdout fact in the same
file, per run, with command/cwd/HEAD/hashes. `logs/p3-ui.log` ends with `EXIT=0` for the spec.

## F1–F8 (unchanged, re-verified on `d446a768`)

| id | what the spec now proves | run32 evidence |
|---|---|---|
| F1 | real handle fields (`enabled`, derived `disabled`), bounded `waitButtonEnabled`; Ready → CONFIRM `enabled:true`; pending → CONFIRM **and** REJECT `enabled:false`; second click cannot duplicate | `p3-ready-before-confirm.json`, `p3-queued-after-confirm.json` (`{enabled:false, disabled:true}`, `queue ['signal-scan']`) |
| F2 | HUD sampled while `PauseScene` inactive / `GameScene` live, `texts>0`, signal+echo visible with real copy, in-frame via `cam.worldView`; paused → HUD hidden asserted | `p3-hud-live-800/1280.json`, `p3-echo-detail.json` (`pausedHud.signalVisible:false`) |
| F3 | no fictional `aiSource/modelState`; local page never says OFFLINE (unconditional); real `GameScene.companionStatus` (`'OFF'`); LLM page consistent with it | `p3-resize-reopen.json`, `p3-llm-footer.json` (`companionStatus:'OFF'`, no `COMPANION CONNECTED`) |
| F4 | CSS px floor for the menu surfaces with `logical`+`cssScale`+`css` recorded, non-empty sample per viewport | `p3-six-viewports.json`: scale 0.625/0.8/1.0/1.067/1.25/1.5, `sample 11`, `tiny []` ×8 |
| F5 | names match scope: default ×6 viewports, pending only 800/1920, **no Done at any viewport**; Done captured once at 1280 bound to the original `proposalId` | `p3-done-receipt.json` (`page local-coop`, receipt `enqueued`+`applied`), `run32/shots/p3-02-done-receipt.png` |
| F6 | all page objects counted, 800 → 1920 → 1280, exact equality on the same viewport and after reopen, unique labels | `p3-resize-reopen.json`: `17/17/17/17`, reopened `17` |
| F7 | `currentPage === 'local-coop'` before the sweep and on every round; Enter only performs real navigation; queue/pending unchanged and pending id survives | `p3-disabled-focus.json`: `rounds` all `local-coop`, `lastFocused ['BACK']`, `afterEnterPage 'echo'` |
| F8 | page window == last 8 of the internal audit stack, plus injected 209 inside / 200 outside, `numbered === window length` | `p3-audit.json`: `window8.newest [202…209]`, `numbered 8`, `f8_scope` field states the limit |

**F8 wording is deliberately narrow**: the assertion is *internal window consistency* (the page
renders the same 8 records the audit model returns as its last 8) plus the 209-in / 200-out
bracket. It is **not** an independent verification of what was drawn, and the report does not
claim one.

## Cases (run32, all PASS)

| case | coverage |
|---|---|
| 1 | six viewports × **default** state (labels, ≥10 CSS px floor in CSS px, no raw ids/ticks/hex, no overlapping rects); **pending** only at 800 / 1920 |
| 2 | proposal → Ready + real `CONFIRM` `enabled` → real click → WAITING/QUEUED, pending = that id, queue 1, second click cannot duplicate and stays disabled → real resume → applied audit for the same id → Done/receipt at 1280 |
| 3 | pending: both handles really disabled, never focused, Enter cannot add a command, pending+queue survive navigation |
| 4 | audit window == last 8 of the internal stack (+209 in / 200 out), ≥10 CSS px floor, no overlap, ESC/BACK round trip, pending/queue untouched |
| 5 | live HUD at **800 and 1280**: non-empty, real signal/echo copy, ≥10 CSS px, `scaleY×zoom=1`, per-size CSS numbers, in-frame; then the paused echo page (HUD hidden, text floor, no `undefined`/`NaN`) |
| 6 | resize 800 → 1920 → 1280 exact object counts + reopen, unique labels, no fake OFFLINE, real `companionStatus` |
| 7 | LLM page `llm`, footer "Takes effect when you resume", state consistent with the real status, screenshot |

Screenshots: `run32/shots/p3-01-six-viewports.png`, `p3-02-proposal-result.png`,
`p3-02-done-receipt.png`, `p3-04-audit.png`, `p3-05-hud-live-800.png`,
`p3-05-hud-live.png`, `p3-05-echo-detail.png`, `p3-07-llm-footer.png`.
JSON records: `run32/evidence/p3-*.json` (each seam labelled `fixture:`).

## Not covered (explicit)

- Real pointer-only edges (double-click during a page transition, drag) — not attempted.
- Done/result state at viewports other than 1280×720; pending state at the four viewports
  other than 800×600 / 1920×1080.
- The LLM `CONNECTED`/online variant: no real connection, no model call; the page is asserted
  only against the real status (`OFF`).
- The audit 8-record window is exercised with a labelled layout fixture and proves internal
  consistency only (see F8 above).
- P2 / ui-menu suites were not re-run: no product or shared-source change.

## Retained history

- `run30` (spec `7aecf216…`): first green run; its gaps are the F1–F8 items above.
- `run31` (spec `3544ee6e…`): F1–F8 landed, but its HUD CSS numbers were computed with the
  zoom applied twice. The files are untouched; `run31/MEASUREMENT_SUPERSEDED.md` records that
  the 8–8.5 CSS figure is a measurement error superseded by `run32`, not a product finding.
- `run28`, `run29`: earlier pre-fix iterations, unchanged.
