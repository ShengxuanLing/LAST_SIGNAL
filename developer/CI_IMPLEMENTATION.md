# GAMEPLAY-01 — CI Hermeticity Implementation

Status: **implemented in the working tree (uncommitted); verified in an independent
clean tree.** No `src/` gameplay, `tests/**`, `.gitignore`, or Owner protocol changed.
No push/PR/merge/commit.

Branch: `feat/gameplay-01-ai-cooperation`, base `7aa8b51`.
Independent verification tree: `D:/tmp/gp01-ci-clean` (`git archive HEAD` of
`7aa8b51` + only the four patch files + own `npm ci`/`node_modules`). It has no
`dist-mcp/` and no `reports/ai-native-02/signal/parity/` before the run, so no
shared workspace residue was consumed.

---

## 1. File whitelist (only these four)

| File | Change |
|---|---|
| `package.json` | Added `test:mcp-surface` and `test:parity` scripts only. |
| `vitest.config.ts` | Added `exclude` for the two artifact tests (default unit gate stays `src/**/*.test.ts`). |
| `vitest.integration.config.ts` | **New**, one config, exact `include` of the two artifact tests; the CLI positional filter selects one per stage. |
| `.github/workflows/ci.yml` | Added `test:mcp-surface` after unit; runner-scoped parity cleanup before Playwright; `test:parity` after Playwright. Dual Vite server lifecycle and failure cleanup unchanged. |

Not changed: `src/**` gameplay, `tests/**`, `.gitignore`, Owner/epoch/protocol,
`dist-mcp/`, `reports/**` historical evidence.

### Freeze hashes (sha256)

```
8559605217b249acb1a1c5489d1c56c640f2e048eab207ea839b573bc71d15a3  package.json
386918779064a526f0be293b7efa8be48eaa8b2c04cb1183f7b724389084e1d8  vitest.config.ts
e5cac51e3c523ee2a645990459491f2954983fbfbca6652ea1e207d671aa5ab4  vitest.integration.config.ts
f532bc46c666bcbb9ed3117896ec6b29929c3743b70cb7709a6503e7c93eb9c4  .github/workflows/ci.yml
```

(Also in `reports/gameplay-01/developer/ci-verify/patch-sha256.txt`.)

---

## 2. CI order (implemented)

```
npm ci
npx playwright install --with-deps chromium
npm run typecheck
npm test                       # pure unit, 741 tests (two artifact files excluded)
npm run test:mcp-surface       # builds dist-mcp once + surface permission gate (1)
npm run build
# clear ONLY the 3 runner-generated parity files under ${{ github.workspace }}
vite 5173 + 5199
npx playwright test            # uses dist-mcp; writes the real Rendered parity export
npm run test:parity            # Rendered→Headless gate (3), after the export
```

No separate `game:mcp:build` step (the surface gate builds once). No `ci:verify`,
no extra `test:e2e`, no cache. The two Vite servers are still started/stopped by
the existing step with its `trap` + final cleanup.

`npm test` coverage accounting: **745 = 741 pure unit + 1 surface + 3 parity**.
The two artifact tests are still on disk and still run in CI, just in their
prerequisite-correct stages; none are skipped.

Freshness: the CI step removes only
`${{ github.workspace }}/reports/ai-native-02/signal/parity/{initial,sequence,rendered}.json`
(`rm -f`, never `rm -rf`, never a local/shared path). Local verification uses the
independent clean tree above and records the Playwright start epoch + the three
files' mtimes.

---

## 3. Gates (one line each; full output in the absolute log)

Verification cwd: `D:/tmp/gp01-ci-clean` (clean archive + patch). Logs are under
`D:/Project/LAST_SIGNAL/reports/gameplay-01/developer/ci-verify/`.

| Command | Result | Absolute log |
|---|---|---|
| `npx tsc --noEmit` | **PASS** (0 errors) | `D:/Project/LAST_SIGNAL/reports/gameplay-01/developer/ci-verify/typecheck.log` |
| `npm test` (pure unit) | **PASS** (741/741, 63 files) | `D:/Project/LAST_SIGNAL/reports/gameplay-01/developer/ci-verify/npm-test-pure.log` |
| `npx vitest run -c vitest.integration.config.ts src/ai-native/companionSurface.test.ts` (no `dist-mcp`) | **FAIL expected** (1/1 failed, `npm run game:mcp:build must run first`) | `D:/Project/LAST_SIGNAL/reports/gameplay-01/developer/ci-verify/negative-surface-no-bundle.log` |
| `npm run test:mcp-surface` | **PASS** (build + 1/1) | `D:/Project/LAST_SIGNAL/reports/gameplay-01/developer/ci-verify/test-mcp-surface.log` |
| `npm run test:parity` (no rendered export) | **FAIL expected** (3/3 failed, `expected 3 to be +0` / `ENOENT initial.json/sequence.json`) | `D:/Project/LAST_SIGNAL/reports/gameplay-01/developer/ci-verify/negative-parity-no-export.log` |
| `PORT=5399 npx playwright test tests/signal-rendered-parity.spec.ts --workers=1` (isolated port 5399; only this spec) | **PASS** (1/1) | `D:/Project/LAST_SIGNAL/reports/gameplay-01/developer/ci-verify/playwright-rendered-export.log` |
| `npm run test:parity` (after the real export) | **PASS** (3/3) | `D:/Project/LAST_SIGNAL/reports/gameplay-01/developer/ci-verify/test-parity-after-export.log` |
| `npm run build` | **PASS** | `D:/Project/LAST_SIGNAL/reports/gameplay-01/developer/ci-verify/build.log` |

### Freshness evidence (local, independent tree)

`reports/gameplay-01/developer/ci-verify/parity-freshness.txt`:

```
playwright_start_epoch=1794942074
1794942084 reports/ai-native-02/signal/parity/initial.json
1794942084 reports/ai-native-02/signal/parity/sequence.json
1794942084 reports/ai-native-02/signal/parity/rendered.json
```

All three products were written 10 s after the Playwright start and before
`test:parity`, proving the gate consumed this run's export, not old residue.

---

## 4. What is intentionally NOT done

- No `generatedAt` field, no extra spec line (per decision ③).
- No generic `ci:verify` runner / cache / extra `test:e2e`.
- No `dist-mcp` or parity snapshot committed; no `.gitignore` change.
- No full Playwright run here (tester owns the full suite); only the single
  `signal-rendered-parity.spec.ts` on an isolated port 5399 was run to generate the
  real export. The tester's 5173/5199 were not touched.
- No Signal/gameplay source changes; `SIGNAL_INTERACTIONS.md` remains the frozen P1
  direction and is not implemented.

## 5. Residual notes

- The CI `test:parity` step runs after the Playwright step; the Playwright step's
  `trap` stops the Vite servers on exit, which is fine (parity needs no server).
- If the full Playwright step fails, `test:parity` does not run (primary failure is
  the E2E red). If the Rendered export is skipped/failed, `test:parity` fails loudly.
- Local `npm run test:parity` requires a fresh rendered export; use a fresh tree as
  above or accept the clear "missing product" failure rather than a stale pass.
