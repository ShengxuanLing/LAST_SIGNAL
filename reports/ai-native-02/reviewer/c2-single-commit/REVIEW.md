# C2 单提交旁路修复 独立复核报告（dd43b37）

- **被测提交**：`dd43b37d57283a7b4d8d28d158e5782a148a41f4`（短 `dd43b37`），父 `5f49b243ba5cf41587ddb26b92ef3289d94181ca`，HEAD 已在目标提交
- **分支**：`feat/ai-native-world-integration`；C3b 仍冻结；不读/不恢复 stash `@{0}`/`@{1}`
- **复核方式**：`git archive` 冻结快照（路径 `D:/Project/lastsignal-c2single-review-dd43b37`，`node_modules` junction）；`git hash-object` 全量比对 → `ALL_TRACKED_FILES_MATCH`（1576/1576）
- **未重复 Tester 昂贵全量**：5 个 E2E 失败 + 1 flaky 待 Tester triage；仅跑类型检查、定向单元（含新增 B13）、两份 Node 参数脚本、以及自编头部提交边界探针
- **结论：旁路已关闭；新增潜在阻断（checkpointPending“下一帧”未保证提交前保存）；仍待 E2E 验收；不宣称 C3 前置解冻**

## 一、实际修改（dd43b37 相对 5f49b24，仅 src 与测试）

| 文件 | 变更 |
|---|---|
| `src/world/World.ts` | **删除了 `processPendingCommands()`**（8 行），即 `new RNG(0)` 离提交偏写路径 |
| `src/economy/main.ts` | 房间清算奖金：`enqueueCurrency(payout)` 后**不再** `processPendingCommands()`，改 `checkpointPending=true`；保存条件加 `!justEnqueued`（下一帧再保存）。购买：`enqueueSetPlayerData(purchased)` 后 `checkpointPending=true`，移除了内联 `saveCheckpoint()` + 回滚逻辑 |
| `src/world/sim/core.test.ts` | 新增 **B13**：paused/zero-dt 经济奖励不提交；普通 tick 提交一次并带事件；稳定 RNG |

## 二、质量门一行结果（命令 → 结果 → 日志）

| 门 | 命令 | 结果 | 日志 |
|---|---|---|---|
| 类型检查 | `npm run typecheck` | PASS exit=0 | `gate-typecheck.log` |
| 定向单元 | `npx vitest run src/world/sim/core.test.ts src/world/sim/rewiring.test.ts src/world/sim/parity.test.ts` | PASS 23/23（含 B13） | `gate-unit.log` |
| 房建生成参数（220 种 C1 参考） | `npx vite-node scripts/c2-room-generation-parity.ts` | PASS seeds=220 | `gate-room-gen-parity.log` |
| 拾取单位/远距可见循环参数 | `npx vite-node scripts/c2-loot-pickup-parity.ts` | PASS failures=0 | `gate-loot-pickup-parity.log` |
| 提交边界探针（enqueue→tick 只 commit 一次） | `npx vite-node reviewer-probe-commit-boundary.ts` | PASS failures=0 | `gate-commit-boundary.log` |

## 三、旁路关闭确认（核心问题项）

### 1. processCommands 只被 tick 合法调用 —— 已确认
全仓库 `processCommands` 仅调用点：`src/world/sim/core.ts:910`，位于 `stepSimulationTicks` 的 tick 循环内。`World.ts` 仅在注释中引用，不再调用。`World.processPendingCommands` 已彻底删除（全仓库 `grep processPendingCommands` → NONE）。

### 2. new RNG(0) 不另起流；如存在须恢复 rng 快照 —— 已确认
`src/world/sim/core.ts:906`：`const rng = new RNG(0); rng.restore(state.rngState);`。`RNG.restore` 实现为 `this.state = state >>> 0`（`src/core/random.ts:84`），即**恢复 canonical 快照**，不另起独立 RNG 流。`createSimulationState` 的 `new RNG(seed*7919+1)`（line 185）是首次种子化，亦正常。无其他裸 `new RNG(0)` 偏写路径。

### 3. 普通路径无 flush / 同步写 —— 已确认
- `World.ts` 中不再直接调用 `addCoreCurrency`/`healCorePlayer`/`addCorePlayerXp`/`applyCoreUpgrade`/`spawnCoreLoot`（仅 import + 注释）。
- `_sim.player.data` 直接赋值仅在私有 `#setPlayerData`（line 760），仅由 `restoreCheckpoint`（owner 恢复边界）调用。
- `enqueueHeal/Currency/ApplyUpgrade/AddXp/SpawnLoot/SetPlayerData/EquipWeapon/Teleport` 均仅 `enqueueCommand`，不再同步改 `_sim`。
- 经济模块：房间清算 `enqueueCurrency` 不再跟 `processPendingCommands()` flush；购买 `enqueueSetPlayerData` 不再内联 `saveCheckpoint()`。

### 4. 单次提交、无重复 commit —— 已确认（B13 + 独立探针）
B13 与 `gate-commit-boundary.log` 均证实：enqueue 后 zero-dt 状态不变；一 tick commit 一次并发 `currency-gained` 事件；第二 tick 空转无重复 commit、无新事件；`rngState` 单一连续流、空转稳定。经济奖励**只提交一次**。

## 四、新增潜在阻断：checkpointPending“下一帧”不等于“命令已提交”

**`checkpointPending` 仅延迟一帧保存，并不保证命令在保存前已被 tick 提交。** 这在低 delta（不够一 tick）、暂停、购买在 Pause UI、退出/刷新前等场景下，可能保存旧资源或丢交易。

证据链（均已静态确认）：
1. `World.captureCheckpoint()`（`src/world/World.ts:1150`）**不包含 `pendingCommands`**（只记 `coreState.tick/rngState`、`player`、`loot` 等）。
2. `World.restoreCheckpoint()`（`src/world/World.ts:1178`）**不恢复 `pendingCommands`**，而是清空 `drones/targets/projectiles/pendingPlayerHits/loot` 并从 `run.loot` 重建。若保存时命令仍 pending，恢复后该货币/升级/装备**丢失**。
3. 保存时机依赖 `GameScene.update` 的 `stepFrame(delta)` 是否恰好跑了一 tick：
   - 低 delta（本帧未凑够一 tick）：命令仍 pending，`saveCheckpoint()` 却会把**未提交前**的快照写入存档 → 恢复后资源比预期少。
   - 暂停：`GameScene.update` `if (this.paused) return;`，不跑 stepFrame，命令不提交；且 `safeRoom()` 在 paused 时返回 `undefined`，阻止保存，但 `checkpointPending` 会一直悬空。
   - 购买在 Pause UI：`enqueueSetPlayerData` 立即显示 `Purchased` 且设 `checkpointPending=true`，但数据未提交；若在下一 tick 前退出/刷新，**交易丢失**。
   - 退出/刷新：若在命令被 tick 提交前关闭，pending 命令与存档同步机会一起丢失。

Lead 指南要求：“应以提交 receipt/tick 事件或明确 pending 耗尽确认，不能靠下一帧猜测。” 现行 `!justEnqueued` 仅靠一帧猜测，**不满足该要求**。

**建议修复**：保存前显式确认 `world.sim.pendingCommands.length === 0`（或等待一个 commit receipt / tick 事件），再写 `captureCheckpoint`；或在 `captureCheckpoint` 中把 `pendingCommands` 纳入存档并在 `restoreCheckpoint` 中重演，避免交易丢失。此项建议提交给 Lead 决策是否升级为正式阻断，并由 Tester 做 E2E 确认（购买后立即退出、低帧率下房间清算奖金存档、Pause UI 中购买再恢复）。

## 五、B13 是否有意义（非自证）

**有意义，非自证。** B13 断言的是 core 的真实行为（zero-dt 不变、一 tick commit 一次并发事件、空转无重复、RNG 稳定），而非对自身实现的循环引用。本轮独立探针 `gate-commit-boundary.log` 用不同代码路径（直接 `stepSimulationTicks` + `enqueueSpawnLoot`）复现了同一结论，互为佐证。可计入验收，但不足以替代 E2E 对“购买→存档→重开”的端到端验证。

## 六、仍待 E2E 验收（不宣称 C3 前置解冻）

- Tester 尚未 triage 的 5 个 E2E 失败 + 1 flaky（dd43b37 自测 399 单测通过，但 E2E 未全绿）。
- 真实购买 + 重开、存档恢复正确性（预算/装备/升级）需浏览器 E2E 确认。
- 第四节所述 `checkpointPending` 场景（低 delta/暂停/Pause UI 购买/退出刷新）的数据丢失或旧资源存档，需 E2E 确认是否形成实际数据损坏。
- C3：`AI_NATIVE_ARCHITECTURE.md` 仍将 C3（Agent Gateway/MCP）列为 P2 完成条件，HUD 仍 `EXTERNAL NOT CONNECTED`，本轮无任何 C3 解冻迹象。**不宣称 C3 前置解冻**，不进入 C3 独立复核。

## 七、报告目录

`reports/ai-native-02/reviewer/c2-single-commit/`：含 `REVIEW.md`（本文）、全部 gate 日志（`gate-typecheck.log`、`gate-unit.log`、`gate-room-gen-parity.log`、`gate-loot-pickup-parity.log`、`gate-commit-boundary.log`）与独立探针（`probe-commit-boundary.ts`）。

所有运行均在冻结快照与独占端口上进行；未修改生产源码/已有测试/配置；未切换共享分支、未合并/重置；未读取/恢复 stash。
