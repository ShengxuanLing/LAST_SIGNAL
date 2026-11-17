# GAMEPLAY-01 · CI 密闭性 patch 独立审查（Reviewer）

**结论：PASS —— 4 文件最小 patch 达成 `main` CI 非密闭依赖的修复目标；无阻断；未发现权限退化；本轮只是「工程前置」，不是玩法成果。**

- 只读审查：未改 `src/`/`tests/`/config/CI，未 push/commit，未碰 tester 的 5173/5199 与其 clone，也未改 developer 的 `D:/tmp/gp01-ci-clean`。我的独立验证树另建 `D:/tmp/gp01-rev-clean`（结束后未删，可复核）。
- 远端 GitHub CI：**未验证**（禁止 push，因此没有新的 Actions run）。本报告结论仅覆盖本地干净树复现 + 工作流静态解析。

## 1. 冻结与 patch 边界

| 文件 | 实测 SHA256 | 与 Lead 给定 |
|---|---|---|
| `package.json` | `8559605217b249ac…71d15a3` | ✅ |
| `vitest.config.ts` | `386918779064a526…9084e1d8` | ✅ |
| `vitest.integration.config.ts`（新） | `e5cac51e3c523ee2…71aa5ab4` | ✅ |
| `.github/workflows/ci.yml` | `f532bc46c666bcbb…3e7c93eb9c4` | ✅ |

`git status`（排除他人未跟踪证据）只有这 4 个文件 + `docs/gameplay/`（新增文档）。**`src/**` 与 `tests/**` 零改动** → 两个 gate 测试文件的**原断言、`missing === 0` 语义、`no_observation` 等断言一字未动**（这是本轮最关键的"不退化为放宽"证据）。

## 2. 745 = 741 + 1 + 3 的去向（实测，不是读配置猜）

我在自己的干净树里用 `vitest list` 直接数，而不是只看配置文本：

| 命令 | 结果 | 日志 |
|---|---|---|
| `npx vitest list -c vitest.config.ts` | **741 条测试**，其中 `companionSurface` / `signalRenderedHeadlessParity` 命中 **0** | `logs/rev-vitest-list-unit.log` |
| `npx vitest list -c vitest.integration.config.ts` | **4 条** = surface 1 + parity 3 | `logs/rev-vitest-list-integration.log` |

→ `exclude` 真正生效（不是写了没跑）；`include` 精确到两个文件；两个 gate 文件仍在磁盘上、仍在 CI 里执行，**没有 skip**。Accounting 745 = 741 + 1 + 3 成立。

## 3. 我独立复现的正/负向门禁（含缺失必须 FAIL）

| # | 命令（我的干净树 `D:/tmp/gp01-rev-clean`） | 结果 | 日志 |
|---|---|---|---|
| G1 | `npx vitest run -c vitest.integration.config.ts src/ai-native/companionSurface.test.ts`（**无** `dist-mcp`） | **FAIL 1/1**，报 `npm run game:mcp:build must run first` —— 明确红，不 skip | `logs/rev-negative-surface-no-bundle.log` |
| G2 | `npm run test:mcp-surface`（= 构建 + 该 gate） | **PASS 1/1**，`built in 1.44s`；产物含 `companionMcpServer/worldMcpServer/mcpServer/worldHeadlessMcpServer.mjs` | `logs/rev-test-mcp-surface.log` |
| G3 | `npm run test:parity`（**无**真实导出） | **FAIL 3/3**，`expected 3 to be +0` + 两条 `ENOENT … initial.json/sequence.json` | `logs/rev-negative-parity-no-export.log` |
| G4 | `PORT=5491 npx playwright test tests/signal-rendered-parity.spec.ts --workers=1`（自带 vite:5491） | **PASS 1/1**（20.8s），写出 3 个产物；mtime = start+28s | `logs/rev-playwright-export.log`、`logs/rev-parity-freshness.txt` |
| G5 | `npm run test:parity`（真实导出之后） | **PASS 3/3** | `logs/rev-test-parity-after-export.log` |
| G6 | `npx tsc --noEmit` | **PASS**（0 error，日志 0 字节） | `logs/rev-typecheck.log` |

开发者日志我也逐条核对，与我的独立结果一致（`reports/gameplay-01/developer/ci-verify/`）：`npm-test-pure.log` = 63 files / **741 passed**；`negative-surface-no-bundle.log` 含 "must run first"；`negative-parity-no-export.log` = `3 failed`；`test-mcp-surface.log` = built 1.31s + 1 passed；`test-parity-after-export.log` = 3 passed；`playwright-rendered-export.log` = 1 passed；`parity-freshness.txt` = mtime +10s；`typecheck.log` = 0 字节。

## 4. 顺序、单次构建与生命周期

- **顺序**（YAML 实解析，非肉眼）：`npm ci → playwright install → typecheck → npm test(741) → test:mcp-surface(构建+1) → npm run build → 清理 3 个 parity 产物 → 双 Vite + Playwright → test:parity(3) → 停止 server(if: always)`。与 developer 文档一致。
- **bundle 只构建一次**：CI 里 `game:mcp:build` 只出现一次（由 `test:mcp-surface` 间接调用，`ci.yml:35`）；`npm run build` 是前端构建，不产出 `dist-mcp`。`grep` 确认无第二处。
- **7 个 spawn E2E 的前置**：这些 spec 需要的 `worldMcpServer.mjs` / `companionMcpServer.mjs` 都在 G2 的产物里，且该步在 Playwright 之前 → 前置满足（`c3b-hard-disconnect`、`companion-room-*`、`p3b-companion-owner`、`signal-coop-e2e`、`signal-sdk-negative`、`ui-menu-layout`）。
- **parity 在真实导出之后**：清理（3 个固定文件）在 Playwright 前 → 导出必须本 run 产生；我的 freshness 实测 mtime 晚于 start 28s，且导出后 gate 3/3 通过。
- **清理范围**：`rm -f "${{ github.workspace }}/reports/ai-native-02/signal/parity/{initial,sequence,rendered}.json"` —— 三个具名文件、限定 runner workspace，**没有 `rm -rf`、没有共享/本地路径**；不会碰 tester 本地 `reports/`。
- **双 Vite 生命周期与失败清理未变**：`trap stop_servers EXIT`、两个 pidfile、末尾 `if: always()` 停止步骤原样保留；新增步骤均在既有块之外。

## 5. 权限与安全：无退化

- 4 个文件里没有任何 Owner/epoch/权限/协议改动；`package.json` 只加了两个 npm script；CI 只是增步骤。
- surface gate 仍是原来的"agent bundle 不得出现 confirm/owner 接口"门禁，且现在**真的会在 CI 执行**（此前因缺 bundle 而红/未执行）。
- 未新增任何 dev 后门、未放宽任何断言、未提交 `dist-mcp`/parity 快照、未改 `.gitignore`。
- → 无 BLOCKER。

## 6. 与我上一轮建议的差异（均属可接受的最小化）

| 我建议的 | 本 patch | 判定 |
|---|---|---|
| `dist-mcp` 缓存 | 未做 | 可接受（构建约 1.3–1.5s，非瓶颈；缓存留待需要时） |
| 通用 `ci:verify` runner | 未做 | 可接受（本单只要最小前置） |
| R5（Player/Dev 泄露产物扫描）、R6（external-owner e2e/UI） | 未做 | 按 Lead 决策留到 P2 跟进；**不属于本 patch 的退化** |
| 提交 parity 快照 | 未做 | 正确（2.4MB 且与代码强耦合） |

## 7. 非阻断观察（5 条，建议记录不必本轮修）

1. `vitest.config.ts` 覆写了 `exclude` 默认值（保留了 `**/node_modules/**`）。因 `include` 收窄为 `src/**/*.test.ts`，目前无影响；若将来放宽 `include`，需补回默认项（`**/dist/**` 等）。
2. 清理步骤是**具名三文件**：将来若 parity 新增第 4 个产物，不会被清理（且无人察觉）。建议在 gate 内部加"产物集合 = 固定 3 个"的断言（属测试侧，非本单）。
3. **本地** `npm run test:parity` 没有 freshness 检查：对着旧导出跑会**假绿**（CI 有 fresh runner + 显式清理，故 CI 安全）。developer 文档已提示；若要更严，可后续加 mtime/哈希校验。
4. 若 Playwright 步失败，`test:parity` 不执行（job 已红）。语义正确，但这意味着 parity gate 只在 E2E 绿时被评估 —— 需要知道这一点，避免把它当成独立于 E2E 的门。
5. `test:mcp-surface` 每次都会重建 bundle（无缓存判断）。成本可接受（<2s），但重复执行时会有一次多余构建。

## 8. 未验证范围（明确）

- **远端 Actions 真实执行**：禁止 push → 没有新 run；`${{ github.workspace }}` 在 runner 上的展开、动作版本、runner 无缓存情况下的耗时都未实测。
- **完整 741 单测**：我未重跑（避免与 tester 争用），只做 `vitest list` 计数 741 + 核对 developer 的 741 全绿日志；若后续出现新问题再补跑。
- **完整 Playwright（118）**：属 tester，本轮只跑 `tests/signal-rendered-parity.spec.ts` 单文件生成导出（自带 5491 端口）。
- **`npm ci`**：我的树用 `node_modules` junction（developer 已用真实 `npm ci` 验证）；`package-lock.json` 未被 patch 改动（`git status` 无该文件），故 `npm ci` 合法性不受影响。

## 9. 证据目录

- 我的日志：`reports/gameplay-01/reviewer/logs/rev-*.log`（6 个 gate + freshness + list）。
- developer 证据：`reports/gameplay-01/developer/ci-verify/`（8 个日志/文本，逐条核对一致）。
- 我的独立树：`D:/tmp/gp01-rev-clean`（`git archive 7aa8b51` + 4 文件 patch，起跑无 `dist-mcp`、无 `reports/ai-native-02/signal`）。
