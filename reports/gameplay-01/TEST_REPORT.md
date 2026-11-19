# GAMEPLAY-01 — final test report (run11, frozen v4 snapshot)

Owner: tester worker (`waz5reqy5nrsdvfko6p8n1ez`). This file is the single deliverable summary;
every number below is a real run on the frozen bytes, with its absolute log.

**Verdict (engineering, this snapshot): all gates green — 155/155 E2E, 859/859 unit at default
concurrency, typecheck 0, surface 1/1, build OK, fresh parity 3/3.**
**HUMAN ACCEPTANCE: PENDING** — every runner here is an agent (non-blind driver) or a labelled
`autoOwner`/seed fixture. Nothing in this report is a human playtest, and the project is **not**
declared a whole-project PASS. P5 layering: the final **stability regression + metrics
collection for P5 were executed** (they are part of run11), and the balance / playtest write-ups
exist in `docs/gameplay/GAMEPLAY_01_BALANCE.md` (the initial delivery was `0813c94e…`; its final documentation adds the test-generation boundary) and
`docs/gameplay/HUMAN_PLAYTEST.md` (sha256 `a9fd8a789fbb4feb…`), with the recorded decision that the
sample is too small to tune any number. What is **only a proposal** is the new enemy / resource
**presets** described in `docs/gameplay/P5_VARIANTS_PLAN.md` — not implemented, not shipped.

---

## 1. Frozen input for the final run

| item | value |
|---|---|
| independent tree | `D:/tmp/ls-p4-v4` (own `git clone` + own `npm ci`), branch `p4-v4` |
| HEAD | `3819621c5faab56b114b6e5a560f8fe78c17709d` |
| product sources | `manifest.v4.json` ten files, sha verified equal (see `HASHES-PRE-RUN.txt`) |
| `World.ts` | `349544bf5785dad072fb7bc3c904d0c80bb08f4619d7834a598d7e58ec05dc64` (`= main d55e502` logic) |
| pre-run conditions | `listeners 5199/5494 = 0` (only my own dev servers stopped), unit log header host CPU 28 % |
| pre/post hash check | every spec and source re-hashed after the run: `archived_identical=true` |
| archive | `reports/gameplay-01/tester/p4-final/run11-final-155/` (`HASHES-PRE-RUN.txt` holds freeze + post-run verification) |

### Final test bytes

| spec | sha256 |
|---|---|
| `tests/audit.spec.ts` | `6ea30e8b1338862eb00c1cc8a54b4687d9a23f8f152cad4e605faafbdbd6dcea` |
| `tests/ai-native-world.spec.ts` | `855eb948d31ef48060087f70bd403fe1da1fea2a55efd7c2507d85a7b6f9538b` |
| `tests/gameplay-01.spec.ts` | `a7db18857d49db266db7acf8a95d42c5e15b9f5f9a25f6583799cf95902a3743` |
| `tests/gameplay-02-echo-coop.spec.ts` | `4bc6288f6cbc123eb2ea7c13626141a786cc957ea353fd34f31cb28946ef6266` |
| `tests/gameplay-03-feedback.spec.ts` | `d446a7683560236199638b3a15af92204e31ae781a239255221921bc0b3c254c` |
| `tests/gameplay-04-coop-level.spec.ts` | `13a834644327ef29b30e0135d44f485de1728dafcfc7626a3a05abbdf7234df2` |
| `tests/gameplay-04-headless-restore.spec.ts` | `22ae61f769fe18a6debe72790628f97b90667dc9f2b3be94aa20863217e4bf55` |
| `tests/uiNav.ts` | `1cc431ab756ff56f2f2dc4ca52f50a4db1a1f22615fee7322d3492b13be3dd1c` |

`audit` and `ai-native-world` were integrated by the Lead in `a487b98`; the other six
were already committed in the feature branch at `2b67106`. Copies: `spec-snapshot/` (byte-identical) and the full
tester diff against `HEAD` in `run11-final-155/diff/`.

## 2. Gates — command → real result → absolute log

All logs live in `D:/Project/LAST_SIGNAL/reports/gameplay-01/tester/p4-final/run11-final-155/logs/`.

| # | command | result | exit | log | time (UTC) |
|---|---|---|---|---|---|
| 1 | `npm test` (**default** concurrency, original 20 s/15 s budgets) | **PASS 73 files / 859 tests**, 0 skipped | **0** | `1-unit-default.log.txt` | 23:15:02 → 23:18:37 |
| 2 | `npx tsc --noEmit` (sources only; project tsconfig excludes `tests/`) | **PASS**, 0 bytes stdout | **0** | `2-typecheck.log.txt` | 23:18:41 → 23:18:53 |
| 3a | `npm run test:mcp-surface` (bundle built this round) | **PASS 1/1** | **0** | `3a-mcp-surface.log.txt` | 23:19 |
| 3b | `npm run build` | **OK**, built in 10.5 s | **0** | `3b-build.log.txt` | 23:19 |
| 4 | `PORT=5199 npx playwright test --workers=1` (dual Vite 5199 + 5494 on this tree, all 155) | **PASS 155/155**, 0 skipped, 0 did-not-run | **0** | `4-full-playwright.log.txt` | 23:19 → 23:43 |
| 5 | `npm run test:parity` (fresh export after the run) | **PASS 3/3**, exports regenerated 00:36 local | **0** | `5-parity.log.txt` | 00:36 |

Runtime evidence written by the tests themselves during gate 4 (copied into `evidence/`):

- `boss-volley-events-FULL-RUN.json` — `spawnedTotal=16`, `volley=15` (all `ownerId 4`, speeds
  3 × 2.5 + 12 × 1.875), `others=1` (`{id 3, ownerId 1, kind plasma, source enemy, pos (22.56,44.32),
  vel (2.17,1.24)}`), `adapterMissing=0`, `pendingBefore=["spawn-enemy-projectile"]`.
  **The historical 16-vs-15 red path occurred in this green run** and is attributed by owner; nothing
  was filtered, cleared or loosened.
- `manual-disable-step-trace.json` — AI-disable window: 89 frames / 153 processed ticks,
  `dash {false}`, intent/move present, `owner {human}`, `aiEnabled {false}`, `move {(0,0)}`,
  3 real `player-hurt` frames, wrapper `restored:true`. The `noWriter` and overlay/GameOver
  branches were **not** triggered and are recorded as such.
- `full-run/` — the per-suite JSON evidence from this run: `p1-acceptance.json`,
  `p2-echo-coop.json`, `p3-*.json`, `p4-route-<seed>-<mode>.json` (6), `p4-layout-3seeds.json`,
  `p4-r1/r2/r2b` probes, `p4-reload-vs-replay.json`, `p4-reject-noconn.json` (35 files).

## 3. How the numbers must be read (no merging)

| record | bytes | result |
|---|---|---|
| run3 | P4 `17fe4a09` | 150/155 |
| run5 | P4 `8ccc3b29` / P2 `53690495` | 153/155 |
| run7 | ai-native-world `ef1d2e92` | 154/155 (ai-native red) |
| run9 | ai-native-world `855eb948` | 154/155 (legacy audit red) |
| **run11** | **audit `6ea30e8b` + ai-native-world `855eb948` + frozen P1/P2/P3/P4/probes** | **155/155, exit 0** |

These are five different byte sets; they are never stitched into one "155 pass".

- **Unit, default concurrency**: run11 measured **859/859 exit 0** with no dev servers running.
  The earlier default-concurrency run recorded **857/859** with two `runtime.test.ts` B7 CLI
  wall-clock timeouts while two dev servers were up; that risk is **not eliminated** and is kept.
- **Unit, bounded profile**: `npm test -- --maxWorkers=2 --minWorkers=1` → **859/73 exit 0**
  (run5). It is a separate, explicitly-labelled run-resource profile; it does not replace the
  default measurement and is not used to claim the default is green everywhere.
- Early phase records (P0 `7aa8b51`, P1 `c7e03c5`, early P2/P3 trees) are historical: their exact
  bytes are not reconstructible today and early model-run records were lost at the time. Nothing
  here retro-fixes those; they stay as recorded.
- The Tester's run11 made no model calls. Reviewer separately ran a v4 real-ECHO smoke
  (2 model requests, `reviewer/real-model-v4/`); it is not part of run11's gates.
  Earlier real-model experiments retain their own version and evidence boundaries.

## 4. Coverage map P0 → P5 (what is actually tested, and where)

Legend: **U** = vitest unit, **E** = rendered Playwright (real browser), **H** = headless Node
model, **M** = real model call, **R** = reviewer evidence.

| phase | original point | real evidence in this snapshot | limits |
|---|---|---|---|
| **P0** | baseline build/typecheck/unit/E2E green, no fake coverage | `tester/BASELINE_REPORT.md`, P0 tree `ls-p0-ci @7aa8b51` | older tree/bytes; not re-run for run11 |
| **P1** | DEMO-01 authored level: relay ACTIVE, T/Y costs, jam window, routes A/B, save→reload→CONTINUE, 3 seeds, HUD floors | **E** `gameplay-01.spec.ts` (`a7db1885`), evidence `p1-acceptance.json` (8 records incl. exact scan/jam cost from committed events, door-range reject, route A/B); **U** `src/signal/relayRoutes.test.ts`, `src/config/p1ScenarioLayout.test.ts` | authored-demo only; pointer-edge cases untested; HUD floor measured at 1280×720 |
| **P2** | ECHO local cooperation: one in-flight action, confirm/reject boundary, restore contract (single pending / exact queue / unknown-source guard), legacy save, 5 viewports | **E** `gameplay-02-echo-coop.spec.ts` (`4bc6288f`), evidence `p2-echo-coop.json` (single-pending, reject, low-risk gate, restore-contract, viewport, legacy-save, save-reload boundary/instant); **H** `src/ai-native/worldHeadlessRestoreSafety.test.ts` + `worldHeadlessFrameAuthored.test.ts`; **U** echo/audit suites | the LLM `CONNECTED` variant is not exercised; `OFF` records are no-connection samples, not disconnection tests; restore contract verified for the four documented entry points only |
| **P3** | feedback surfaces F1–F8 (real button states, live HUD sampling, CSS font floors, resize/reopen, queue honesty, disabled focus, audit window) | **E** `gameplay-03-feedback.spec.ts` (`d446a768`), evidence `p3-*.json` (six viewports, HUD 800/1280 with `scaleY×zoom=1`, echo detail, audit window, LLM footer); prior targeted archive `tester/p3/run32` | Done state only at 1280×720; pending only at 800/1920; pointer-only edges untested |
| **P4** | Demo-03 cooperative level: real 3-seed × HumanOnly/HumanEcho clears, natural door jam with exact event cost, F blocked while JAMMED, expiry restore, route switch, ECHO proposal→owner confirm on the next processed tick, reject/no-connection, checkpoint reload vs raw frame replay, portal centre | **E** `gameplay-04-coop-level.spec.ts` (`13a83464`) + `gameplay-04-headless-restore.spec.ts` (`22ae61f7`), evidence `p4-route-*`, `p4-layout-3seeds`, `p4-reload-vs-replay`, `p4-reject-noconn`, `p4-r1/r2/r2b`; **H** same-seed `HeadlessWorld` parity (own `map.rooms[id].cleared` + own `room-cleared` event), `fromFrame`/`replay` guard; **R** `reviewer/P4_TEST_REVIEW.md`, `P4_V2/V3/V4_REVIEW.md`; developer `manifest.v4.json` gates | driver is non-blind (reads canonical state to aim/route); owner confirm is an `autoOwner` fixture, not a human click; difficulty/balance not claimed; restored identity across *versions* (R3) untested |
| **P5** | final stability regression + metrics collection; balance/playtest write-up; *proposed* new state presets | **executed:** P5's stability regression and metrics collection are part of run11 (155/155), with the balance/playtest documents committed at `docs/gameplay/GAMEPLAY_01_BALANCE.md` (`0813c94e…`) and `docs/gameplay/HUMAN_PLAYTEST.md` (`a9fd8a78…`), whose recorded decision is **no numeric tuning** (sample too small); the low-energy/resource boundary remains a unit/fixture observation only | the new enemy/resource presets in `docs/gameplay/P5_VARIANTS_PLAN.md` are **not implemented** and must not be described as shipped; no new preset was tested; human acceptance pending |

Cross-cutting gates: **U** 859 tests/73 files (default profile), **H** headless parity + restore
suites, **E** 155 Playwright tests, **R** the reviewer reports listed above.

## 5. Fixtures vs legitimate scenarios (what each record really is)

- **Legitimate product scenarios driven by real input:** every movement/fire/scan/jam/toggle/interact
  in P1/P3/P4 is real keyboard/mouse; room clears come from real play (2–4 shots, 1.2–1.9 s).
- **Labelled fixtures (never used to prove completion):** seed override (menu `scene.start` wrapper),
  `autoOwner` ECHO enable + confirm via the product boundary, the legacy-save field removal in P2,
  and the audit spec's own boss/weapon dev-test setup. Scenario records label their fixtures;
  `audit.spec.ts` uses explicit dev-test setup and persisted measurement evidence, not a per-record `fixtures` field.
- **Not fixtures creating a "quiet" world:** no `clearEnemies`, no teleport, no heal, no enemy freeze,
  no `skip`. The AI-disable window explicitly records the spec's own 100 ms keep-alive
  (`heal-player` in the queue, by type) instead of asserting an empty queue.
- **Not tested at all:** R3 (cross-version authored identity), extreme fallback paths (broken
  checkpoint, corrupt frame beyond the documented validators), pointer-only edge cases
  (double-click during a page transition, drag), the LLM `CONNECTED` variant, difficulty/balance,
  and any human play. These are listed, not hidden, and no test was added just to make the final
  number look better.

## 6. Deliverables, paths and hashes

- This report: `reports/gameplay-01/TEST_REPORT.md`
- Final run archive: `reports/gameplay-01/tester/p4-final/run11-final-155/`
  - `HASHES-PRE-RUN.txt` (freeze + post-run verification + gate results + runtime evidence)
  - `logs/1-unit-default.log.txt`, `2-typecheck.log.txt`, `3a-mcp-surface.log.txt`,
    `3b-build.log.txt`, `4-full-playwright.log.txt`, `5-parity.log.txt`
  - `evidence/` (35 full-run JSON + boss/AI traces), `shots/`, `spec-snapshot/`,
    `source-snapshot/`, `diff/`
- Earlier rounds kept untouched: `run1-v1-targeted`, `run2-v2-targeted`, `run3-v3-final`,
  `run4-v4-final`, `run5-v4-final`, `run6-v4-inputs` (with `ERRATA.md`),
  `run7-v4-final` (+ `ai-disable-drift/`), `run8-ai-disable`, `run9-ai-disable-final`
  (+ `boss-volley-drift/`), `run10-boss-volley`.
- Final diff source for review: `run11-final-155/diff/tests.diff` (all tester-owned specs vs HEAD);
  the final `audit 6ea30e8b…` and `ai-native-world 855eb948…` bytes are integrated in `a487b98`.

## 7. Risks / open items

1. **Human acceptance pending** — no human has played; all evidence is agent/fixture.
2. **P5 is partly done and partly a proposal** — its final stability regression + metrics collection ran in
   run11 and the balance/playtest docs exist (no numeric tuning: sample too small); the new enemy/resource
   presets in `docs/gameplay/P5_VARIANTS_PLAN.md` are not implemented and are not claimed as shipped.
3. **Default-concurrency unit load risk** — B7 CLI tests are wall-clock bound; with two dev servers
   they timed out once (857/859). run11's 859/859 was measured without dev servers. Not claimed
   eliminated; the bounded profile is labelled separately.
4. **Two legacy specs are timing-sensitive** — `audit.spec.ts` boss volley (now attributed by
   `ownerId`) and `ai-native-world.spec.ts` AI-disable (now event-attributed). Both are green on
   the frozen bytes, both have their red evidence archived, neither was loosened.
5. **Coverage gaps** listed in §5 (R3, extreme fallbacks, pointer edges, `CONNECTED`, balance).
6. **The Tester run11 called no model**; it must not be cited as model evidence. Reviewer separately
   completed a v4 real-ECHO smoke (`reviewer/real-model-v4/`, archive d55e502, 2 model requests).
   Its trace has a stale snapshot literal; the provenance sidecars supply the actual version/hash boundary.

### Evidence directory index (file counts)

| directory | files |
|---|---|
| `tester/p4-final/run1-v1-targeted/` | 34 |
| `tester/p4-final/run10-boss-volley/` | 7 |
| `tester/p4-final/run11-final-155/` | 65 |
| `tester/p4-final/run2-v2-targeted/` | 36 |
| `tester/p4-final/run3-v3-final/` | 84 |
| `tester/p4-final/run4-v4-final/` | 76 |
| `tester/p4-final/run5-v4-final/` | 35 |
| `tester/p4-final/run6-v4-inputs/` | 30 |
| `tester/p4-final/run7-v4-final/` | 49 |
| `tester/p4-final/run8-ai-disable/` | 9 |
| `tester/p4-final/run9-ai-disable-final/` | 20 |
