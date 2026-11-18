# boss volley 15 vs 16 — evidence package (tester, read-only)

This package contains ONLY artifacts from the failing runs. Nothing was re-run, no test/`product` byte
was changed, and the assertion `toBe(15)`, the 3-laser/12-shockwave expectation, the speed,
visibility and 0.5 s movement assertions are all left exactly as they are.

## the two records that show the drift

- full run9: `../../logs/full-e2e-155.log.txt` → 154/155, exit 1, only failure
  `tests/audit.spec.ts:575` … `Expected 15 / Received 16` (excerpt here)
- the same case isolated on the identical bytes: `../../logs/diag-audit-boss-bullets-isolated.log.txt`
  → FAIL 1/1, same 16 (excerpt here)
- isolated FAIL means this is not a once-off full-suite artifact; the previous run7 full run on the
  same frozen product sources had this case GREEN. Both observations are kept; neither is removed.

## audit.spec bytes (UNCHANGED)

- `audit.spec.ts.lf-head`  sha256 72617cc260ce34d2fc6080034ec526c77a76500aa6913e7d58785bd907321553 (git HEAD bytes, LF)
- `audit.spec.ts.crlf`     sha256 fe43dc48a6164218113b84947860420b1fa3f52196a42697391e10a8b9582eff (working-tree bytes, CRLF)
- content identical modulo CRLF: YES (`git diff HEAD -- tests/audit.spec.ts` is empty aside from EOL)
- `bossInit-code-region.txt`: the exact block that produces the count (lines ~740-800)

## UNKNOWN — explicitly not persisted (do not infer)

`bossInit` is a LOCAL object inside `page.evaluate`; the failing assertion throws before anything is
written, and the test has no record/flush for it (`mkdirSync` only prepares the shots dir). Therefore:

- the actual 16-bullet array (ids, positions, velocities, visible flags) is **UNKNOWN**;
- which bullet is the 16th and which entity fired it is **UNKNOWN**;
- the pending command queue at that moment is **UNKNOWN**;
- `simFixture.projectiles.length` (the `c0` baseline) and the adapter slice boundary at that moment are
  **UNKNOWN**;
- drone/boss projectile events of that stepFrame are **UNKNOWN** (not captured).
`playwright-error-context.md` is attached only for completeness: it contains the error text and the
test source excerpt, NOT the runtime objects.

## clues handed over (developer/main-repo reading, NOT verified here)

- `c0` is taken from `w.simFixture.projectiles.length` while `created` comes from
  `w.projectiles.slice(c0)` — two different collections;
- `q.spr.destroy()` / `resetProjectilesForTest()` may not clear the core projectile list, so `c0` can
  differ from the adapter index;
- another drone may fire during the same `stepFrame` and land inside the adapter slice window.
These are leads only: the count must be explained per projectile ID/event, not filtered away.

## frozen context of this round

- FINAL spec bytes (frozen before run9): ai-native-world 855eb948d31ef48060087f70bd403fe1da1fea2a55efd7c2507d85a7b6f9538b

  P1 a7db18857d49db266db7acf8a95d42c5e15b9f5f9a25f6583799cf95902a3743

  P2 4bc6288f6cbc123eb2ea7c13626141a786cc957ea353fd34f31cb28946ef6266

  P4 13a834644327ef29b30e0135d44f485de1728dafcfc7626a3a05abbdf7234df2

  probes 22ae61f769fe18a6debe72790628f97b90667dc9f2b3be94aa20863217e4bf55

- v4 product sources (ten manifest files, unchanged):
  src/world/sim/core.ts                          f71523e1ccd04828381ddfa0224db68ccaa890d41a98b3dd100c050e4bc36bf6
  src/config/p1Scenario.ts                       76367087a719b8a7395b3a3dd10c9952552db33b66a1ca5f5a0dd045a0d4c2b7
  src/ai-native/worldHeadless.ts                 7382d6f090e5da6b6ae005d85b0768ba623ef52dbe6799cc1c54dfe889e54316
  src/world/World.ts                             349544bf5785dad072fb7bc3c904d0c80bb08f4619d7834a598d7e58ec05dc64
  src/signal/relay.ts                            6fc7ba4028812b655e63fb92b90d7f193ea155e62ae683e7875540028c770a89
  src/signal/relayRoutes.test.ts                 097bfc6f64346c07f38860348e62194e9f7948976925a4db92a0fb15209b3423
  src/ai-native/worldHeadlessDemoRoute.test.ts   11c812f737e31183d8a0a24e5962a0f93dbd7782b41911756c1066f1205a1ef4
  src/config/p1ScenarioLayout.test.ts            8b12cbf22b786f9d198d2d61d7eab97e711ad11cbf002b45b58aaed8b2556ce6
  src/ai-native/worldHeadlessFrameAuthored.test.ts 93447a608519432dfb87bc9178e2b2466508bb7961c8afc1f6c90ed1eba75e21
  src/ai-native/worldHeadlessRestoreSafety.test.ts ec4139ffbfc47d9b493d19377e9a8d6908a79dc808f2c1718cc590f338fb8652

- run9 outcome kept as is: 154/155 (exit 1). run3/run5/run7 are NOT merged into a 155 pass.
- P5 variants plan-only, HUMAN ACCEPTANCE PENDING, default-concurrency unit (857/859) risk open.
