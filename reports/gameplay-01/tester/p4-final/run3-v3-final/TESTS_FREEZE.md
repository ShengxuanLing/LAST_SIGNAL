# TESTS FREEZE — final tester-owned bytes used for the P4 v3 run (run3-v3-final)

Frozen at: HEAD 3819621c5faab56b114b6e5a560f8fe78c17709d + manifest.v3 10 sources / 4 docs.
Every hash below is the byte-identical content archived under `spec-snapshot/` (the run
logs were produced from exactly these bytes; the readiness fix landed before the archived
P4-nine / P1-seven / probe / portal runs).

| file | sha256 | archived copy identical | role |
|---|---|---|---|
| `tests/gameplay-01.spec.ts` | `a7db18857d49db266db7acf8a95d42c5e15b9f5f9a25f6583799cf95902a3743` | True | P1 acceptance (P4 layout adaptation + readiness wait) |
| `tests/gameplay-02-echo-coop.spec.ts` | `fbe7ca78f56a8f699ea3ba3571916eb5b45d4267def637aefd4bbad782db842c` | True | P2 acceptance (readiness wait) |
| `tests/gameplay-03-feedback.spec.ts` | `d446a7683560236199638b3a15af92204e31ae781a239255221921bc0b3c254c` | not snapshot (unchanged file) | P3 acceptance (unchanged, 3819621) |
| `tests/gameplay-04-coop-level.spec.ts` | `50e74fdc1ac9b6012ea794ad6a6f294c50f3576e9edad73cadaa89f53ce57575` | True | P4 nine (new) |
| `tests/gameplay-04-headless-restore.spec.ts` | `22ae61f769fe18a6debe72790628f97b90667dc9f2b3be94aa20863217e4bf55` | True | R1/R2/R2b restore probes (new) |
| `tests/uiNav.ts` | `1cc431ab756ff56f2f2dc4ca52f50a4db1a1f22615fee7322d3492b13be3dd1c` | not snapshot (unchanged file) | shared menu nav helper (not tester-owned; unchanged) |
| `tests/ui-menu-layout.spec.ts` | `8aa12c9eda2840c8d696afba114288566dbb18f1d4a2c291398efe0e7b549c20` | not snapshot (unchanged file) | UI-REWORK-01 menu spec (unchanged, 3819621) |
| `playwright.config.ts` | `df6fcc565c57af53cd21a73e4a8a8bbb52e4902931b9bfbd90edd226a3429df7` | not snapshot (unchanged file) | runner config (unchanged) |
| `tsconfig.json` | `c2602851d8eddf78d36594e77deafb98698d8d8f1dc61fc84316bfe1b90fad50` | not snapshot (unchanged file) | unfiltered typecheck config (unchanged; includes src/scripts only) |

**Helpers**: none of the tester specs imports a project helper. `gameplay-01`, `gameplay-02`,
`gameplay-03`, `gameplay-04-coop-level` and `gameplay-04-headless-restore` are self-contained
(their own probe/eval/driver functions); `ui-menu-layout` is the only spec that uses
`tests/uiNav.ts`, which is unmodified from 3819621

**What must NOT change for v4 review**: the driver logic, the assertions, the timeouts and the
thresholds above. The only v4 action planned is a new `src/world/World.ts` sha check plus
re-running the two red legacy portal cases and the P4/P1 targeteds.

## Spec byte history (each record belongs to ONE version — never merged)

| sha256 | produced | archived at |
|---|---|---|
| `17fe4a09…c60e` | the **full Playwright 150/155** run (run3) | `spec-versions/gameplay-04-coop-level.17fe4a09.spec.ts` |
| `50e74fdc…7575` | the later **P4 nine 9/9 targeted** run (evidence extension only) | `spec-versions/…-50e74fdc.spec.ts` |
| `839e91fb…70b7` | **final frozen bytes**: +3 assertions (one clear commit, echo receipt/cost, real companionStatus) and the 3-seed echo/clear targeted 7/7 | `spec-versions/…-839e91fb.spec.ts` |

The 150/155 full-suite result belongs to `17fe4a09` and is **not** evidence for the later bytes;
the 9/9 belongs to `50e74fdc`; the frozen `839e91fb` has only the 7-test targeted record
(`logs/post-freeze/p4-targeted-839e91fb.log.txt`) until the v4 full chain runs on it.
