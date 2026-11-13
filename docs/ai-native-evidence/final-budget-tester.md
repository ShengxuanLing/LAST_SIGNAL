# AI-NATIVE-01 · 最终混合预算小修 — Tester 独立验收报告

> 判定：**PASS**（无 BLOCKED）。固定版 HEAD `903096ddd1402658d1bf662af2cb9c2b41f04015`，developer 已停写。本轮为 P0–P5 全部验收后的最后一项小修验收，完成后仅剩最终材料/PR 交付。

## 1. 范围与稳定 MD5

Lead 指定 6 个 MD5 **逐一 MATCH**，且 before/after **STABLE**（`final-budget-tester-md5-before.log` / `-after.log`）：

| 文件 | MD5 |
|---|---|
| `src/ai-native/sessions.ts` | `409f1f1a100f02193da594a649da0b37` |
| `src/ai-native/coop.ts` | `f10d1dc489cd631db30927daf0b288ab` |
| `src/ai-native/harness.ts` | `87e64a008e46913652d440d37e49992c` |
| `src/ai-native/mcpServer.ts` | `c35de76ee3a377963e6de660960c108a` |
| `src/ai-native/budget.test.ts` | `81fc9161ade605f858580f690933b63f` |
| `src/ai-native/budgetClient.mts` | `5ee666ac66d6a973b766f728e9d4b640` |

**无 slice / 浏览器 / 正式 ECHO / World / 旧档 / key / version 变更**：working tree 中 `src/slice/*`、`tests/*` 均无改动；`src/slice/rules.ts = 96947c32…`、`sharedCore.ts = f8ee3a30…`、`fullState.ts = be780b90…` 与 P5 终版逐字一致。HEAD 提交内亦无本轮浏览器改动。

## 2. Gate 汇总（命令 | PASS/FAIL | 绝对日志路径）

| 命令 | 结果 | 日志 |
|---|---|---|
| 6 文件 MD5 比对 | PASS | `D:/Project/AI-NATIVE-01-evidence/final-budget-tester-md5-before.log` |
| `npm run typecheck` | PASS | `D:/Project/AI-NATIVE-01-evidence/final-budget-tester-typecheck.log` |
| `npm run build` | PASS | `D:/Project/AI-NATIVE-01-evidence/final-budget-tester-build.log` |
| `npm run game:mcp:build` | PASS | `D:/Project/AI-NATIVE-01-evidence/final-budget-tester-mcp-build.log` |
| `npm test`（全量） | PASS（13 files / **292**） | `D:/Project/AI-NATIVE-01-evidence/final-budget-tester-unit.log` |
| `npx vite-node p4-final-tester-replay.mts`（P4 replay） | PASS（5/5） | `D:/Project/AI-NATIVE-01-evidence/final-budget-tester-p4-replay.log` |
| `npx vite-node src/ai-native/coopDemo.mts` | PASS | `D:/Project/AI-NATIVE-01-evidence/final-budget-tester-coop-demo.log` |
| `npx vite-node final-budget-tester-sdk.mts`（**独立官方 SDK 混合预算探针**） | PASS（13/13） | `D:/Project/AI-NATIVE-01-evidence/final-budget-tester-sdk.log` |
| `npx vite-node final-budget-tester-direct.mts`（**独立直连预算语义探针**） | PASS（12/12） | `D:/Project/AI-NATIVE-01-evidence/final-budget-tester-direct.log` |
| 稳定 MD5 前后 | PASS（STABLE） | `D:/Project/AI-NATIVE-01-evidence/final-budget-tester-md5-after.log` |

单行 gate 表：`D:/Project/AI-NATIVE-01-evidence/final-budget-tester-gate-summary.log`。

**纯 Node 预算改动，未再跑浏览器 E2E**（Lead 明确无需；且无 slice/浏览器变更）。P5 终版节点证据 **287 单测 + 23 E2E（两次）** 保留不抹除；本轮为 **292 单测**（新增 `budget.test.ts` 5 例：287+5=292），与 P5 节点证据的映射见 §4。

## 3. 独立探针结果（不依赖 developer `budgetClient.mts`）

### 3.1 官方 SDK 混合预算探针（`final-budget-tester-sdk.mts`，13/13 PASS）

自建 `Client` + `StdioClientTransport` 连接 `--dev` MCP，单进程内一份共享 `ProcessSessionBudget(10)` 注入 `SessionManager` + `CoopManager`：

- **B1** 5 普通 + 5 coop = 10 slots 全部创建成功。
- **B2** 第 11 个普通 **与** 第 11 个 coop 均 `E_RESOURCE_LIMIT`（共享上限）。
- **B3/B4** 关闭一个普通 + 一个 coop → 各归还 1 slot，新建普通 **和** 新建 coop 都成功；跨类型释放（关普通→建 coop）也成立。
- **B5** 非法创建（bad seed）被拒且**不吃 slot**，下一个合法创建成功。
- **B6/B7** 10 个 coop 填满预算 → 第 11 个 coop `E_RESOURCE_LIMIT`。
- **B8** 满 coop 时 `game_run_scenario` → `E_RESOURCE_LIMIT`（scenario 走真实 slot）。
- **B9** 满 coop 时 `game_run_batch`（2 seeds）→ 每个 run 均 `E_RESOURCE_LIMIT`（Harness batch 走真实 slot，非绕过）。
- **B10** 关闭 3 个 coop 后 `run_scenario` + `run_batch` 均恢复成功（slot 归还）。
- **B11/B12** 全关后重建 10 个混合会话全部成功、第 11 个仍被拒 → **close/dispose 无残留**，上限仍精确为 10。
- **B13** dev MCP 进程释放（无泄漏）。

### 3.2 直连预算语义探针（`final-budget-tester-direct.mts`，12/12 PASS）

直接 import `createProcessSessionBudget` / `createSessionManager` / `CoopManager`，验证对象级语义：

- **D1/D12** `ProcessSessionBudget` 是普通 per-instance 对象、非全局单例：两个独立 budget 互不影响；未注入时各 manager 自带独立预算。
- **D2/D3** 同一注入 budget：5+5=10 → `used=10`；第 11 个普通抛 `E_RESOURCE_LIMIT`、第 11 个 coop 返回 `E_RESOURCE_LIMIT`，`used` 仍 10。
- **D4/D5/D6** 普通 `remove`、coop `close` 各归还 slot（10→9→8），两类重建后回到 10。
- **D7** 双 manager `dispose` 后 `used→0`，**无残留**。
- **D8/D9** **失败 constructor 不吃 slot**：注入抛异常的 `clock` 令 `Session` 构造在 `tryAcquire` 之后抛错 → `used=0`；随后健康 manager 在同一 budget 上仍能占满 3 slots。
- **D10/D11** coop 侧同样：令 `CoopSession` 构造抛错 → `used=0`，随后 2 个合法 coop 仍可创建。

## 4. 与既有节点证据的映射（不抹除历史）

| 节点 | 全量单测 | 浏览器 E2E | 说明 |
|---|---|---|---|
| P5 终版（`f2dfe8b1…`） | **287**（12 files） | **23 passed × 2**（`p5-final-tester-e2e.log` / `-run2.log`） | 当时已通过；本轮未改 slice/浏览器 |
| 最终预算小修（`f10d1dc4…`） | **292**（13 files，+ `budget.test.ts` 5 例） | 未重跑（纯 Node 预算改动，无浏览器/slice 变更，Lead 明确无需） | 292 = 287 + 5；P5 的 23 E2E 结论继续有效 |

- 本轮仅 `src/ai-native/{sessions,coop,harness,mcpServer}.ts` + `budget.test.ts` + `budgetClient.mts` 变更；`rules.ts`/`sharedCore.ts`/`fullState.ts` 与 P5 终版 MD5 一致。
- P4 Player replay 不变（tick 501 / HP100 / E96 / 29 events，5/5）；Player 6 工具矩阵不变。
- 更早轮次 pre-fix / V1–V5 / P4 全部失败与修复历史均保留于各自 `p*-*-*.log`，未抹除。

## 5. 边界

- 只读源码/仓库测试；未 commit/切分支；未扩新功能/正式 ECHO/World/旧档/key/version；未改 Lead 的最终材料（`docs/AI_NATIVE_FINAL_REPORT.md`、`docs/ai-native-evidence/`、`examples/ai-native/*` 未触碰）。
- 仅写项目外 `final-budget-tester-*` 日志/探针与本报告、自有测试报告最终 budget 节。
- 稳定 MD5 前后一致；dev MCP 进程释放，无残留。

## 6. 结论

**最终混合预算小修独立验收 = PASS**：6 个固定 MD5 匹配且稳定；typecheck/build/MCPbuild/全量 292/P4 replay/coopDemo 全绿；独立官方 SDK 探针（13 项）与直连语义探针（12 项）验证普通 5+coop 5 共享 10 slots、第 11 双向拒绝、关闭不同类型归还、失败 constructor 不吃 slot、full-coop 挡 `run_scenario`/`run_batch` 且释放后恢复、close/dispose 无残留；纯 Node 改动无需浏览器，P5 的 23 E2E 证据继续有效。无 BLOCKED 项。
