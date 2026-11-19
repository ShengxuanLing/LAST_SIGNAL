# C2 增量购买事务 + checkpoint barrier 独立复核（59aa852 / 代码 3f97990）

- **被测提交**：`59aa85227dcf3c9dcb87d798aaaa7df15f7a2d6e`（HEAD；仅改报告第 2 行），**代码提交 `3f97990d7871f099ce86848159b2ffeae00bb10e`**（父 `1d5a8d703b1ed66a7664df9712949a46240ed1ae`）
- **分支**：`feat/ai-native-world-integration`；C3b 仍冻结；未读/未恢复 stash `@{0}`/`@{1}`；无源码 WIP
- **复核方式**：`git archive` 冻结精确 hash 快照 `D:/Project/lastsignal-c2purchase-review-59aa852`（`node_modules` junction）；`git hash-object` 全量比对 → `ALL_TRACKED_FILES_MATCH`（1584/1584）
- **未重复 Tester 昂贵全量**：5 个旧 E2E 失败 + flaky 仍由 Tester triage；本轮只跑新增/定向用例与独立探针
- **结论：上轮“set-player-data 覆盖丢失/不复验/无幂等”硬阻断已关闭（增量事务 + 提交期活状态校验 + 去重）；新增 2 个阻断——(a) 有界去重账本 FIFO 淘汰后同 tx 可重放（C3a 同类问题复现）；(b) `purchaseTransactions` 未纳入 canonical / 不随存档持久化 → 重放分叉。不宣称 C3 前置解冻，仍待 E2E。**

## 一、质量门一行结果（命令 → 结果 → 日志）

| 门 | 命令 | 结果 | 日志 |
|---|---|---|---|
| 类型检查 | `npm run typecheck` | PASS exit=0 | `gate-typecheck.log` |
| 定向单元（core/rewiring/parity/supplies） | `npx vitest run src/world/sim/core.test.ts src/world/sim/rewiring.test.ts src/world/sim/parity.test.ts src/config/supplies.test.ts` | PASS 45/45（含 B17–B24） | `gate-unit.log` |
| 房建生成参数（220 种 C1 参考） | `npx vite-node scripts/c2-room-generation-parity.ts` | PASS seeds=220 | `gate-room-gen-parity.log` |
| 拾取单位/远距可见循环参数 | `npx vite-node scripts/c2-loot-pickup-parity.ts` | PASS failures=0 | `gate-loot-pickup-parity.log` |
| 购买事务独立探针（核心，18 项） | `npx vite-node reviewer-probe-purchase-tx.ts` | PASS failures=0 | `gate-purchase-tx.log` |
| 恢复/重放边界独立探针（核心，12 项） | `npx vite-node reviewer-probe-restore-boundary.ts` | PASS failures=0 | `gate-restore-boundary.log` |
| 购买 UI 浏览器探针（dev 5393） | `vite --port 5393` + probe | PASS：挂起→关闭→提交→可见反馈→存档 | `gate-purchase-ui.log` |
| 生产门禁探针（preview 5394） | `vite preview --port 5394` + probe | PASS：set-player-data 被门禁 / 首存正常 | `gate-production-gating.log` |
| 新增 E2E（开发者 supply-transaction.spec.ts） | `PORT=5395 npx playwright test supply-transaction.spec.ts` | PASS 3/3 | `gate-supply-transaction-e2e.log` |
| 生产构建 | `npm run build` | PASS exit=0 | `gate-build.log` |

## 二、已关闭（逐条）

| 上轮问题 | 状态 | 依据 |
|---|---|---|
| 奖励+购买被整对象覆盖 | **已关闭** | 核心新增 `purchase-supply` 命令，commit 期在候选副本上 `currency -= price` + `applySupply` 后原子 swap；独立探针 `gate-purchase-tx.log`：奖励+heal+XP+买 → currency=100+20-16、hp=40+10+35、xp=20，全部保留 |
| commit 期不复验价格/安全房/余额/装备资格 | **已关闭** | `core.ts` `purchase-supply` 在 tick 内用**活状态**校验：offerKey 合法、玩家确在 `roomId`、是终端房、房已清、无未清房、HP>0、无存活 core 敌人、offer 资格+余额；探针：未知 offer / 错房 / 余额被改 0 / 敌人存活 → 全部拒绝且不改状态 |
| 价格/报价可被参数伪造 | **已关闭** | 命令只带 `transactionId / offerKey / roomId`，价格由 `SUPPLY_PRICES`（冻结）按 key 解析；探针：repair 扣 16；`buySupply` 仅 UI 预览，adapter 不再传 PlayerData |
| 原子扣费、重复 tx 不重执行 | **已关闭** | 同一 tx 第二次 → `Duplicate transaction` 拒绝且不二次扣费（探针 + B21） |
| UI 双击仅靠禁用按钮 | **已关闭（核心侧）** | 核心按 `transactionId` 幂等；UI 禁用按钮只是附加。同一 tx 双提交只扣一次、只留最后一件（探针 E）；不同 tx 重复购买同一武器被 “Already owned” 拒绝 |
| 成功反馈不可见（上轮 UI 回归） | **已关闭** | 成功走 `showOutcome()`：dialog 打开时写 `feedback`，否则写 dialog 外可见横幅 `#supply-reward`；浏览器探针：横幅文本 “Purchased Repair kit.”、`bannerVisible=true` |
| 生产 `enqueueSetPlayerData` 门禁 | **已关闭** | `World.enqueueSetPlayerData` 加 `World.assertDevTest()`；生产预览探针：`Error: dev/test only`；`enqueuePurchaseSupply` 正常可用；`processPendingCommands` 已不存在（`TypeError: ... is not a function`） |
| `hasUncommittedCommands` 未覆盖 worldSpawns | **已关闭** | 新增 `hasPendingSpawns()`，`hasUncommittedCommands() = pendingCommands.length>0 || hasPendingSpawns()`；生产探针：`enqueueSpawnEnemy` 后 `afterSpawn=true`、`hasPendingSpawns=true` |
| 首存 checkpoint 一步正常 tick | **已关闭** | `GameScene.create`：新跑时 `updateRoom()` 排 `room-enter` 后走**一次真实 `stepFrame`** 再捕获首存（不 flush）；生产探针 `firstCheckpointOk=true`；静态确认无 `processCommands` 外部调用 |
| 供给价格与 C1 一致 | **已关闭** | `SUPPLY_PRICES = {repair:16, calibration:28, weapon:40}`，与 C1 `cdb594e:src/economy/supplies.ts`（40/16/28）及基线 `860a0dd` **逐值相同**（源证据） |
| 暂停/低 delta/立即退出不保存旧资源 | **已关闭** | `captureCheckpoint` 在 pending 时返回 `null`；`saveCheckpoint` 返回 false 且不清 `checkpointDirty`；浏览器探针：pending 时 `pendingCaptureNull=true`；未提交购买刷新后仍为购买前存档（开发者 E2E 第 3 例 PASS） |

## 三、新增阻断 1：有界去重账本 FIFO 淘汰 → 同 tx 可重放（C3a 同类问题复现）

- 实现：`core.ts` `purchase-supply` 成功后 `state.purchaseTransactions.push(tx)`；若 `length > 256` 则 `splice(0, length-256)` **淘汰最旧**。
- 独立复现（`gate-purchase-tx.log` 场景 3）：
  - 预填 256 条账本（`old-0`…`old-255`）→ `old-0` 首次提交被正确判为 `Duplicate transaction`；
  - 再成功一次 `fresh-1` → 账本长度 257 → 淘汰 `old-0`；
  - **再次提交同一 `old-0` → `ok=true`，实际重新执行并再次扣费/发货**。
- 与 C3a 的既定契约冲突（对比 `src/ai-native/worldGateway.ts`）：
  - C3a 对同类“会话去重记录”采用**到达上限即原子拒绝**（`if (s.dedupRecords + newRecordCount > this.maxDedupRecords) return E_RESOURCE_LIMIT`），不靠淘汰放行；
  - C3a 在 YIELD/LOST 时用 `archiveCaches()` 把缓存转入“已淘汰集合”并保持总数不变，明确注释“so an old request cannot execute in the next epoch”。
  - 本实现改用 FIFO 淘汰，使旧 tx id 可再次执行 —— **同类问题再次出现**。
- 影响面：单局内购买次数 > 256 才会触发（正常玩法极难达到），但这是**协议层可被 Agent/外部调用方主动构造**的路径；且 `purchaseTransactions` 不持久化，跨存档/恢复后重放窗口更宽。
- **修复条件**：(1) 采用 C3a 同款策略——账本达到上限时**拒绝**新购买（并返回明确 reason，如 `Too many transactions`），不淘汰；或 (2) 淘汰时把已淘汰 id 记入“不可重放”墓碑集合（计数受限），使旧 tx 永不再执行；或 (3) 若 tx id 含会话 epoch/seed 派生且会话内单调，则重放需校验 epoch 单调性。

## 四、新增阻断 2：`purchaseTransactions` 未纳入 canonical / 不随存档持久化 → 重放分叉

- `canonicalSimulationState()`（`core.ts`）**不含** `purchaseTransactions`（已逐字段核对 `CanonicalSimulationState` 接口与实现）。
- `World.captureCheckpoint()` **不含** `purchaseTransactions`；`restoreCheckpoint()` 明确 `this._sim.purchaseTransactions = []`。
- 独立复现（`gate-purchase-tx.log` 场景 4）：两个状态仅 ledger 不同 → `canonicalSimulationState` **相等**；但对同一 tx id，A（已记账）拒绝、B（空账本）执行成功 → **行为分叉**，而 canonical 比较不可见。这违反“canonical 覆盖所有影响未来演化的核心字段”的既有约定。
- 恢复边界复核（`gate-restore-boundary.log`，12/12）：恢复后**同一 tx id 可再次执行并再次扣费**（session-only 去重）；但**不会造成重复商品**：恢复后的存档若已持有该武器 → “Already owned” 拒绝；武器满级 → “Max level” 拒绝。故“已购买重复”由 offer 资格守卫兜住，但**扣费类交易（repair/calibration）**在恢复后重放同一 tx 会再次扣费（本次探针已证实）。
- **修复条件**：把 `purchaseTransactions` 纳入 canonical 投影与 checkpoint（或明确声明其为纯会话态且不参与重放语义，并禁止同一 tx 跨恢复重放——例如 tx id 绑定 runId/epoch，恢复时提升 epoch 使旧 tx 失效）。

## 五、会话授权 / 存档恢复边界（复核结论）

- 会话授权：`purchase-supply` 无显式“授权/额度”字段，依赖的是**活状态安全条件**（在终端房、房已清、无敌人、余额足、offer 合规）。这足以防止越权购买，但**没有与 C3a 会话/额度体系的显式绑定**；当前 C3b 冻结，未要求，故列为**观察项**而非阻断。
- 存档恢复边界：已验证恢复不会继承未提交命令/生成物（`restoreCheckpoint` 清 `pendingCommands`/`purchaseTransactions`/`worldSpawns`），不会残留 pending 购买。
- 开发者 E2E 第 3 例（未提交购买刷新 → 保留购买前存档）PASS，与独立探针一致。

## 六、B14–B24 与新增单测的有效性（是否只是常量自证）

- B17（原子扣费 + 固定价）、B18（奖励+购买顺序无关）、B19（heal+XP+购买复合）、B20（余额不足原子拒绝 + 重复 id 仍拒绝）、B21（重复 id 最多扣一次）、B22/B22b（不安全房/活体敌人拒绝）、B23（未知 offer 拒绝且不改状态）、B24（commit 期装备变更被尊重）：均断言**真实状态与事件**，非常量自证，且与本轮独立探针结论一致。
- `src/config/supplies.test.ts`（7 例）与 `rewiring.test.ts` 新增静态断言：分别覆盖纯度/价格/资格，以及 `hasPendingSpawns`/`worldSpawns.length > 0`/`assertDevTest`/economy 不含 `enqueueSetPlayerData` —— 有效，但 `rewiring` 属**源码字符串断言**，只能防止结构性回退，不能替代行为证据（已由本轮探针补足）。
- **仍缺**：账本上限淘汰后的重放行为、canonical 包含 ledger、恢复后同 tx 重放扣费 —— 三项均无单测（本轮探针首次暴露）。

## 七、仍待 E2E（Tester）

- 5 个旧 E2E 失败 + 1 flaky 仍待 Tester triage（developer 正处理），本轮未重复。
- 需在修复阻断 1/2 后回归：连续购买次数达上限后的拒绝行为、恢复后重放同 tx 的扣费行为、canonical 完整性（Node/渲染 parity 脚本应纳入 ledger）。
- 新增 `tests/supply-transaction.spec.ts` 3 例本轮独立复跑 **3/3 PASS**（端口 5395，未与其他套件组合）。

## 八、C3 前置

**未解除。** `AI_NATIVE_ARCHITECTURE.md` 仍将 C3（Agent Gateway/MCP）列为 P2 完成条件，HUD 仍 `EXTERNAL NOT CONNECTED`，本轮无解冻迹象。因第三节/第四节阻断未关闭，**不宣称 C3 前置解冻**，不进入 C3 独立复核。

## 九、报告目录

`reports/ai-native-02/reviewer/c2-purchase-final/`：`REVIEW.md`（本文）、`gate-typecheck.log`、`gate-unit.log`、`gate-room-gen-parity.log`、`gate-loot-pickup-parity.log`、`gate-purchase-tx.log`、`gate-restore-boundary.log`、`gate-purchase-ui.log`、`gate-production-gating.log`、`gate-supply-transaction-e2e.log`、`gate-build.log`、`gate-dev-5393.log`、`gate-preview-5394.log`、`probe-purchase-tx.ts`、`probe-restore-boundary.ts`、`probe-purchase-ui.mjs`、`probe-production-gating.mjs`、`pw-out-supply/`。

所有运行均在冻结快照与独占端口（dev 5393/5395、preview 5394）上进行；未修改生产源码/已有测试/配置；未切换共享分支、未合并/重置；未读取/恢复 stash。
