# GAMEPLAY-01 · P2 v2 阻断修复独立复测

**结论：v1 的 BLOCKER（暂停重复确认）已关闭（Rendered 实测 + core/headless 单测双向证据）；但发现一个新的 restore 边界缺陷（headless `fromSimulationState` 丢 guard 留队列 → 可重复入队）。P2 仍不整体 PASS。**
只读 src/tests，未提交；未动 tester 的 P1 隔离树/5480；自起 5485（已关）；本轮**未发任何 Magpie 请求**。

## 0. 冻结核对

- manifest 现 **10 个有效源**，我逐项实算 SHA256：**10/10 一致**；`src/ai-native/runtime.test.ts` **不在 manifest 内**，且 `git diff dcd1955 -- src/ai-native/runtime.test.ts` = **空**（原 15s/20s 阈值保留）✓。
- HEAD `dcd1955`，P2 未提交；旧 `demo02/` 与旧 `repeat-confirm` 已标 KNOWN_BAD，新证据在 `final-v2/`（本轮我未消费旧代做结论）。

## 1. B1 复测：单 pending 生效（真实浏览器，tick 129）

| 步骤 | 实测（`reviewer/p2-v2/browser-confirm.log` 的 `[1]`–`[4]`） |
|---|---|
| 初始 | `local_129_1`（scan），CONFIRM enabled，paused，tick 129 / HP 94 / echoEnergy 100 / echoHP 94 |
| 第 1 次 CONFIRM（暂停中） | `pending = local_129_1@129`、**queued = 1**、`echoLocalProposal = null`、**CONFIRM disabled**、notice `WAITING…local_129_1`、audit `enqueued + proposalId`；**tick/HP/echoEnergy/echoHP 全部不变** ✓ |
| 直接再确认（same id / wrong id） | 都返回 `false`，**queued 仍 1**，pending 未被覆写，audit `E_ALREADY_PENDING` ✓ |
| resume 后提交 | 捕获 core 事件 `signal-scanned {actorId:1, ok:true, energy:90, cooldownTicks:120}` → **energy 精确 = 100 − SCAN_COST(10)**（不是区间/含 regen 的净差）✓ |
| 结算 | `pending = null`、**queued = 0**、audit `applied @tick130 · proposalId local_129_1`（**由自己的 receipt 结算并关联 proposalId**）✓ |

→ **v1 的重复确认阻断在 Rendered 路径已关闭**，且"暂停只入队、下一 tick 提交、不把 enqueued 当 applied"成立。

**toggle 单次翻转**：我的浏览器探针两次都拿到 scan 提案（等太久 scan 冷却已过），**未在浏览器复现 toggle**；但开发者 headless 用例 `repeated toggle confirm flips the relay exactly once` 在我本轮跑的 124 条里 **PASS**，其断言覆盖：`pendingCommands=1`、二次 confirm 为 false、`signal-relay-changed` 恰好 1 次、`manualEnabled` 翻转一次、audit 关联 proposalId —— toggle 路径在 core/headless 层已证。

## 2. 新发现（非 v1 blocker，但影响 restore/parity 保证）

`HeadlessWorld.fromSimulationState(sim, [roomId])` 会把 **core 队列**一起克隆（我实测 `queued = 1`），但把 `pendingLocalAction` 置 **null**；此时 `proposeLocalEcho()` 又能生成同一提案，`confirmLocalEchoProposal` **成功** → **`queued = 2`**（`reviewer/p2-v2/headless-restore.log` 的 `[4]`/`[5]`）。即"已确认未提交"的状态在 restore 后**失去 guard 但保留队列**。

- **真实存档路径安全**：`coreState` **不含 `pendingCommands`**，`restoreCheckpoint` 显式 `_sim.pendingCommands = []` → 不会重复；**边界**是"已确认但未提交的动作在存档/恢复后丢失"，而 checkpoint 正常在暂停时（确认前）写入。
- **受影响面**：headless restore / parity frame restore（`world_headless_dev_restore` 等）—— 对 `toggle-relay` 会变成两次翻转（互相抵消）。
- **最小修复**：`fromSimulationState` 恢复时**丢弃队列中的 local signal 命令**（与真实存档一致），或据队列重建 guard；并加一条 targeted 测试（restore 后 `confirm` 必须 `false` 或队列为 1）。

## 3. 其它核对

- **生命周期 cancel**：`cancelPendingLocalAction` 在 World 只有 **room change**（:477）与 **echo disable**（:871）两个调用点；`E_LOCAL_REVOKED / E_NEW_RUN / E_ECHO_DEAD` 只有枚举、无 World 调用点（`reset()` 清 guard、新 run 为 new World、死亡后队列已无意义）。→ "显式 revoke / 死亡 / 新 run" **未实测**（UI 也没有 revoke 控件），只能算代码层可解释，不能算已验证。
- **memory/audit**：`echo.ts` 记忆只收 `source:'echo-perception'`、cap 16/TTL 600；`echoAudit` 独立 ring 不被 `suggest/decide` 读取（代码 + 开发者单测，均在我的 124 条里 PASS）。
- **低风险开关**：`setEchoCooperationOptIn` 仅 human，OFF 只清自主；HOLD 优先于自主（`propose/decide` 分支）——代码核对 + 单测，浏览器未逐项复测。
- **生产 Player / external**：Player 面无 confirm/dev 字段、external `actor:'echo'` 仍被 `E_PERMISSION` 拒绝（代码未变）——**未跑 e2e**。

## 4. 五视口（本地 ECHO 页）

`[vp]` 结果：`outside=0`，最小 CSS 字号 **18 / 12.8 / 12 / 12.8 / 10**（1920/1366/1280/1024/800，全部 ≥10）；ESC 从 local → echo 逐层回退 ✓；截图 `v2-local-{1920x1080,1366x768,1280x720,1024x768,800x600}.png`。

## 5. Gate（一行一条）

| 命令 | 结果 | 日志 / 证据 |
|---|---|---|
| `npx vitest run echoCoop worldHeadlessEchoCoop SaveSystem.echoCoop echo echoView runtime.test ownerAuth externalLink companionFacet` | **PASS**（9 files / 124 tests） | `D:/Project/LAST_SIGNAL/reports/gameplay-01/reviewer/p2-v2/unit-targeted.log` |
| `npx vite-node reports/gameplay-01/reviewer/p2-v2/headless-restore.mts` | **FAIL（发现）**：restore 后 `queued=1, guard=null`，再 confirm → `queued=2` | `D:/Project/LAST_SIGNAL/reports/gameplay-01/reviewer/p2-v2/headless-restore.log` |
| `PORT=5485 npx playwright test -c reports/gameplay-01/reviewer/p2-v2/pw.p2v2.config.ts --workers=1 --grep "single-pending"` | **PASS（[1]–[4] 全绿）**；末尾我自己的 toggle 断言用了 scan 提案 → 该条失败**是我探针的预期写错**，不是产品 | `D:/Project/LAST_SIGNAL/reports/gameplay-01/reviewer/p2-v2/browser-confirm.log` |
| `PORT=5485 … --grep "five viewports"` | **PASS**（5 视口 outside=0、minCss≥10、ESC 逐层） | `D:/Project/LAST_SIGNAL/reports/gameplay-01/reviewer/p2-v2/browser.log` |

## 6. 未测（不计入 PASS）

1. 浏览器 toggle 单次翻转（只在 headless/core 层证）。
2. 拒绝矩阵逐项实测：TTL 过期 / stale id / generation 变化 / 目标不可见 / echo 死亡 / 非 human / 低能 / cooldown —— 开发者单测覆盖（我跑的 124 条 PASS），但**没有我自己的浏览器场景**。
3. 真实存档/刷新在 pending 时的端到端（只做了代码+字段核对与本 headless 探针）。
4. fresh Rendered↔Headless parity（未用新目录/新导出）——未做。
5. external-owner e2e（`actor:'echo'` 拒绝）——未跑。
6. 真实模型 ECHO 链——按指示**0 请求**。

## 7. 结论

- **v1 重复确认 BLOCKER：已关闭**（Rendered 实测 + core/headless 单测）。
- **新阻断（限 restore/parity）**：`fromSimulationState` 丢 guard 留队列 → 重复入队；修法与测试见 §2。
- P2 仍 **不是**整体 PASS：上述未测项 + P3/P4/P5 + 人类验收均未完成。
