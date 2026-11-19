# GAMEPLAY-01 — CI Hermeticity: approved minimal patch (PREPARED, NOT APPLIED)

Status: **prepared patch / design only.** Nothing here is applied while the tester's
P0 baseline on `7aa8b51` is still being frozen. The Lead will forward the tester
baseline lock; only then does this worker apply the config/CI changes.

Approved decisions incorporated (this supersedes the earlier proposal):
- One lightweight integration config with an exact `include`; the CLI positional
  filter selects one gate file per stage (no two duplicate configs).
- `npm test` stays the pure unit gate.
- `test:mcp-surface` builds `dist-mcp` **once**, then runs the surface check. CI must
  **not** repeat `game:mcp:build`.
- `test:parity` runs only after the real Playwright Rendered→Headless export.
- No `ci:verify` runner, no extra `test:e2e` script; minimal scripts/config/CI steps
  plus a documented local command order.
- No `dist-mcp` or parity snapshot commits; no new `skip`; `.gitignore` unchanged.
- The two existing artifact tests keep their exact assertions and "missing = FAIL".
- `tests/**` remains tester-owned; this patch does not edit it.

---

## 1. Exact minimal patch (to apply after the lock)

### 1.1 `vitest.config.ts` — default pure unit gate

```diff
 export default defineConfig({
   test: {
     globals: true,
     environment: 'node',
     include: ['src/**/*.test.ts'],
+    // Two artifact-dependent gates live in vitest.integration.config.ts.
+    // They are not skipped: each is executed by its own npm script/CI step.
+    exclude: [
+      '**/node_modules/**',
+      'src/ai-native/companionSurface.test.ts',
+      'src/ai-native/signalRenderedHeadlessParity.test.ts'
+    ],
     coverage: {
```

### 1.2 `vitest.integration.config.ts` — NEW, one config, two files

```ts
import { defineConfig } from 'vitest/config';

// Artifact/integration gates. The CLI positional filter picks exactly one file
// per stage:
//   vitest run -c vitest.integration.config.ts src/ai-native/companionSurface.test.ts
//   vitest run -c vitest.integration.config.ts src/ai-native/signalRenderedHeadlessParity.test.ts
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'src/ai-native/companionSurface.test.ts',
      'src/ai-native/signalRenderedHeadlessParity.test.ts'
    ]
  }
});
```

### 1.3 `package.json` — only scripts added

```diff
   "test": "vitest run",
+  "test:mcp-surface": "npm run game:mcp:build && vitest run -c vitest.integration.config.ts src/ai-native/companionSurface.test.ts",
+  "test:parity": "vitest run -c vitest.integration.config.ts src/ai-native/signalRenderedHeadlessParity.test.ts",
   "test:watch": "vitest",
```

No other script changes. `game:mcp:build`, `build`, `playwright` keep their meaning.

### 1.4 `.github/workflows/ci.yml` — step order only

```diff
       - name: 单元测试
         run: npm test

+      - name: MCP bundle + agent-surface permission gate
+        run: npm run test:mcp-surface
+
       - name: 生产构建
         run: npm run build

-      # ... existing 5173 + 5199 dev servers and Playwright step ...
+      # Existing 5173 + 5199 dev servers stay; clear ONLY the runner's own
+      # generated parity files (never a shared local reports path).
+      - name: 清理 runner 内 parity 生成文件（仅 runner 工作区）
+        run: |
+          set -euo pipefail
+          parity_dir="${{ github.workspace }}/reports/ai-native-02/signal/parity"
+          mkdir -p "$parity_dir"
+          rm -f "$parity_dir/initial.json" "$parity_dir/sequence.json" "$parity_dir/rendered.json"
+
+      # ... existing Playwright step ...
+
+      - name: Rendered→Headless parity gate (after Playwright)
+        run: npm run test:parity
```

Placement rule (authoritative):
1. `npm test` — pure unit
2. `npm run test:mcp-surface` — builds `dist-mcp` once + surface check
3. `npm run build`
4. clear the three runner-generated parity files under `${{ github.workspace }}` — before Playwright
5. Playwright — uses `dist-mcp`, writes parity products
6. `npm run test:parity` — after Playwright; fails if products are missing

There is **no** separate `game:mcp:build` step.

```
npm ci
npx playwright install --with-deps chromium
npm run typecheck
npm test
npm run test:mcp-surface          # builds dist-mcp once
npm run build
# clear only the three runner-generated parity files in this fresh tree
rm -f reports/ai-native-02/signal/parity/{initial,sequence,rendered}.json
vite 5173 + 5199
npx playwright test               # uses dist-mcp; writes parity products
npm run test:parity
```

No separate `game:mcp:build` step.

### 1.5 Local reproduction (no new runner)

Documented order, run manually by a developer in a **fresh independent tree**
(`git archive 7aa8b51`/new worktree or a fresh clone), never in the shared working
repo (that would destroy historical evidence):

```bash
# in the fresh tree
npm run typecheck
npm test
npm run test:mcp-surface            # builds dist-mcp
npm run build
node -e "console.log(Date.now())" > /tmp/playwright-start.txt   # record start
npx playwright test tests/signal-rendered-parity.spec.ts
# verify the 3 products exist and their mtime >= the recorded start time
stat -c '%Y %n' reports/ai-native-02/signal/parity/{initial,sequence,rendered}.json
npm run test:parity                 # reads the just-written products
```

Add this to `CONTRIBUTING.md` (a short section) or the GAMEPLAY-01 report template.

---

## 2. Freshness: "a new run must not consume old reports residue"

No `generatedAt` field and no extra spec line. Enforcement without touching
`tests/**`:

1. **CI clean checkout**: the parity products are untracked, so a fresh CI job
   starts with none. Before Playwright, the CI step clears **only** the three
   runner-generated files under `${{ github.workspace }}/reports/ai-native-02/signal/parity/`
   (`rm -f`, no `rm -rf` of a shared path, never a local developer path).
2. **Same-job ordering**: `test:parity` runs after Playwright in the same job, so
   the products cannot come from a different job.
3. **Local acceptance**: run in a fresh independent tree (archive/worktree/new
   clone), record the Playwright start time and the three files' mtimes, and require
   `mtime >= start`. Missing files must fail. Do **not** delete shared-repo
   historical evidence; any negative/deletion test happens only in an explicitly
   isolated temp directory.

The parity test still fails loudly (`expected 3 to be 0` / `ENOENT`) when products
are absent. No skip, no hidden fallback.

---

## 3. Gates preserved (negative proof)

| Check | Expected after patch |
|---|---|
| clean archive + `npm ci` + `npm test` | PASS (no `dist-mcp`, no `reports/`) |
| `vitest run -c vitest.integration.config.ts src/ai-native/companionSurface.test.ts` without a build | **FAIL** with `npm run game:mcp:build must run first` |
| `npm run test:mcp-surface` | PASS (builds, then checks) |
| delete parity products + `npm run test:parity` | **FAIL** `expected 3 to be 0` / `ENOENT` |
| Playwright (7 dist-mcp specs) + `npm run test:parity` | PASS |

The two FAIL rows are the proof the safety gates still bite.

---

## 4. Ownership / handoff

| Item | Owner |
|---|---|
| `package.json`, `vitest.config.ts`, `vitest.integration.config.ts`, `.github/workflows/ci.yml`, `CONTRIBUTING.md` short section | developer (this worker), after the Lead forwards the tester lock |
| `src/ai-native/companionSurface.test.ts`, `src/ai-native/signalRenderedHeadlessParity.test.ts` | developer for config/order only; assertions unchanged |
| `tests/signal-rendered-parity.spec.ts` | tester (unchanged; no extra line) |
| New GAMEPLAY-01 E2E regressions | tester |

No change is applied until the Lead confirms the tester P0 baseline is locked.