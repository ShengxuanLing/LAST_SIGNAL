# AI-disable drift (full run7, one failure) — trace package for the developer

**This is a packaging/analysis task only.** Nothing was re-run at load, no product or test byte was
touched, and the failure is not re-labelled.

## 1. What failed (verbatim, from the frozen run)

- Run: `run7-v4-final/logs/full-e2e-155.log.txt` (155 executed, 154 passed, `exit_code=1`,
  18:5x→21:49 UTC, dual Vite 5199+5494 on `D:/tmp/ls-p4-v4`, HEAD `3819621`).
- Case: `tests/ai-native-world.spec.ts:272`
  `AI-NATIVE-02 P1 real World › shared control path, AI run, disable/takeover, level-up takeover, pause/death/restart/exit`
- Assertion: `tests/ai-native-world.spec.ts:553`
  `expect(stationary!.grid.x, ...) .toBeCloseTo(stationaryStart!.grid.x, 6)`
  `Error: disabled AI does not move the player (x 116.01757253487142 vs 115.32342141231187)`
  → **0.6941511225595463 tiles of +x drift** over the 2500 ms window. The `y` assertion was never
  reached (the `x` one threw first), and `record('manual-disable', …)` was never written.
- Same bytes, isolated: **PASS 1/1 in 46.6 s** (`logs/diag-ai-native-world-isolated.log.txt`).
  That pass does **not** prove the drift is non-product; it only shows the case is not deterministic
  under identical bytes.

## 2. Exact input sequence around the failure (spec bytes `ef1d2e92…`, unchanged base file)

Line numbers are from `ai-native-world.spec.ts.basesha-ef1d2e92` in this directory.

| # | step | call (line) | waits |
|---|---|---|---|
| 1 | pause via keyboard | `page.keyboard.press('Escape')` (:499) | 450 ms → `paused` sample |
| 2 | pause freeze probe | 2 × `state(page)` | 900 ms wait, asserts no move + no AI actions |
| 3 | open AI hub | `openAiHub(page)` (:527) | — |
| 4 | **disable AI** | `clickLabel(page, 'PauseScene', 'AI CONTROL')` (:528) | 550 ms → `disabled` sample |
| 5 | OFF assertions + screenshot | (`pause-ai-off-1280x720.png`) | — |
| 6 | resume | `resumeGame(page)` (:538) — AI hub → pause root → resume | **1500 ms** → `stationaryStart` |
| 7 | settle window | *(no input at all)* | **2500 ms** → `stationary` |
| 8 | **failing assertion** | `:553` (x), `:554` (y), guarded by `hp` equality | — |

There is **no input** between steps 6 and 8: the drift happened while the test only waited.

## 3. What the harness actually sampled, and what it did not

`state(page)` (same file, `:97-143`) would have captured, at both instants:
`active`, `paused`, `aiEnabled`, `owner`, `authorityPaused`, `mode/modeLabel`, `lastAiAction`,
`lastAiTarget`, `aiActionCount`, `takeoverCount`, `lastTakeoverReason`, `externalAgentConnected`,
`grid{x,y}`, `intent{move,fire,aim,interact}`, `lastIntentOwner`, `walkable`, `enemies`, `projectiles`,
`hp`, `damage`, `fireHeld`, `playerFireHeld`, `inputFlags`, `weaponKey`, HUD texts.

**But none of it is persisted for the failure.** `record()` only appends to an in-memory log and
`saveLog()` writes at the end of the case, so a throw at `:553` loses `stationaryStart`, `stationary`,
`disabled` and the earlier steps of that run. The failure log contains **only** the `x` value pair.

### Unknown (must be marked unknown, not inferred)

For the failing run we do **not** have: enemies alive, projectiles, damage taken, `fireHeld`,
`playerFireHeld`, `inputFlags`, per-sample `intent`, `lastIntentOwner`, `walkable`, `paused`,
`authorityPaused`, level-up state, or any owner/takeover transition during the 1500 ms + 2500 ms
windows. We also have no per-tick trace, no collision/separation data and no kernel of the
authority/AI intent stream. In particular the question "was it a residual queued intent, a held key,
a collision push, or an authority gap?" is **unanswered by this evidence**.

Only two constraints come from the case itself: `hp` was equal at both samples (that is why the
assertion block ran at all — the test skips it on damage), and the player ended `+0.694` on x.

## 4. Reference evidence that is *not* failure evidence (clearly labelled)

From the **isolated PASS run on the same bytes** (`operation-log-control-flow-PASS-run-2256.json`,
written 22:56 local), for orientation only:

- `pause-freeze`: frozen grid `x=115.34810190957649, y=44.98482804044955`, `aiActionCount=32`.
- `manual-disable`: `owner "human"`, `takeoverCount 1`, `reason "pause-menu"` — the pass run recorded
  **no movement** after disable (the assertion block completed).
- `pause-ai-off-PASS-run-2256.png`: the HUD state right after the disable in that pass run.

These are pass-run values; they must not be cited as the failing run's state.

## 5. Source under test (all read-only shas; sources are the frozen v4 set)

```
ef1d2e92826d8dad98ed959b185ec251484d450764925a4781b68201516f2125 *tests/ai-native-world.spec.ts
2a015c597c596b1901f50567b8d3f94733c6fc8cd44f63b674c09d6c7e89e9b4 *src/entities/Player.ts
dd839b0e5cedf55a735c07515a92f0c249abca5091fbe7b82fdbef5b62f13ecb *src/ai-native/localController.ts
349544bf5785dad072fb7bc3c904d0c80bb08f4619d7834a598d7e58ec05dc64 *src/world/World.ts
f71523e1ccd04828381ddfa0224db68ccaa890d41a98b3dd100c050e4bc36bf6 *src/world/sim/core.ts
11af218697007584f9ea336aacd26a35d1ac3d67d915b2dc3cf665999e714e75 *src/scenes/GameScene.ts
```

`World.ts` and `core.ts` are two of the ten manifest.v4 files; `Player.ts`, `localController.ts` and
`GameScene.ts` are untouched base bytes at `3819621` (not part of any P4 manifest).

## 6. What the tester will not do

- No change to `ai-native-world.spec.ts`, no widened tolerance, no added fixed sleep.
- No repeat of the full 155 to chase a green number; the 154/155 record stands.
- Nothing here is a product verdict; the mechanism is left to the developer's per-tick
  intent/authority/input/collision diagnosis.

Package contents: `failure-excerpt.log.txt`, `ai-native-world.spec.ts.basesha-ef1d2e92`,
`operation-log-control-flow-PASS-run-2256.json`, `pause-ai-off-PASS-run-2256.png`, `source-shas.txt`.


## 7. Developer per-tick diagnosis (added; product v4 frozen, no source change)

See `DEVELOPER_DIAG.md` (hashes in `developer-diagnostic-hashes.txt`; per-tick data in
`developer-per-tick-trace-run2.json` / `-run3.json`; window analysis in
`developer-window-analysis-run2-run3.json`; run logs `developer-diag-run2.log.txt` /
`developer-diag-run3.log.txt`).

- New independent diagnostic spec (a copy of this package's `basesha-ef1d2e92` file with a
  read-only `stepFrame` recorder and a `try/finally` dump), run on port 5471.
- **Assertion-level red: UNREPRODUCED** in three bounded runs — each run's two HP samples differed,
  so the position assertion was skipped. That is recorded, not hidden.
- **Mechanism CONFIRMED:** in the measured 2.5 s windows every player movement is a real
  `player-hurt` knockback with the core intent `move {0,0}`, no key flags set, `owner=human`,
  `aiEnabled=false`, no queued AI command; the only queued command is the spec's own `heal-player`
  fixture, which restored HP inside the window (28 → 100 in run2). A deterministic core
  counterexample (`guard-hole.check.mts`) shows equal HP endpoints **with** a 0.375-tile knockback.
- **UNKNOWN for the run7 failure itself:** no per-tick trace, enemies, projectiles, keys or intents
  of that run exist; the PASS-run operation log/screenshot remain pass-run evidence only.
- **Product: no change**; the drift is physics, and the assertion's "HP equal ⇒ no contact" premise
  is the defect. Suggested minimal test attribution is in `DEVELOPER_DIAG.md` §5.
