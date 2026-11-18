# TESTS FREEZE — v4 final tester-owned bytes (run4-v4-final)

Exactly these bytes produced the v4 records in `logs/`; the two exceptions are named explicitly:
- the **full Playwright 153/155** run used P2 `fbe7ca78…` (before the scene-restart driver guard),
- the v3 records (`run3-v3-final`) belong to the older P4 bytes listed in its `spec-versions/`.

| file | sha256 | archived identical |
|---|---|---|
| `tests/gameplay-01.spec.ts` | `a7db18857d49db266db7acf8a95d42c5e15b9f5f9a25f6583799cf95902a3743` | True |
| `tests/gameplay-02-echo-coop.spec.ts` | `5369049539b8d8b802cf285eabcfd105098678f47991d3535123eb3c1b96648e` | True |
| `tests/gameplay-03-feedback.spec.ts` | `d446a7683560236199638b3a15af92204e31ae781a239255221921bc0b3c254c` | unchanged (not snapshotted) |
| `tests/gameplay-04-coop-level.spec.ts` | `839e91fb99bd5865e13feb850e04fa5de478cb8ef9d9188340ace9ba0ba270b7` | True |
| `tests/gameplay-04-headless-restore.spec.ts` | `22ae61f769fe18a6debe72790628f97b90667dc9f2b3be94aa20863217e4bf55` | True |
| `tests/uiNav.ts` | `1cc431ab756ff56f2f2dc4ca52f50a4db1a1f22615fee7322d3492b13be3dd1c` | unchanged (not snapshotted) |
| `tests/ui-menu-layout.spec.ts` | `8aa12c9eda2840c8d696afba114288566dbb18f1d4a2c291398efe0e7b549c20` | unchanged (not snapshotted) |
| `playwright.config.ts` | `df6fcc565c57af53cd21a73e4a8a8bbb52e4902931b9bfbd90edd226a3429df7` | unchanged (not snapshotted) |

Spec byte history (never merged):

- P4 `17fe4a09…` → v3 full Playwright 150/155; P4 `50e74fdc…` → v3 P4 nine 9/9;
  P4 `839e91fb…` → v4 P4 nine 9/9 (the frozen final P4 bytes).
- P2 `fbe7ca78…` → v4 full 153/155; P2 `53690495…` → v4 P2 7/7 on the new bytes.
