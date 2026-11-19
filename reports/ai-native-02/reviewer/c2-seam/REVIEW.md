# C2 Seam 独立复核报告（5f49b24）

- **被测提交**：`5f49b243ba5cf41587ddb26b92ef3289d94181ca`（短 `5f49b24`），父 `ccc3eb08d01b1999c596c55b43a3a11a521c7ab0`
- **分支**：`feat/ai-native-world-integration`；C3b 仍冻结；不读/不恢复 stash `@{0}`/`@{1}`
- **复核方式**：`git archive` 冻结快照（路径 `D:/Project/lastsignal-c2seam-review-5f49b24`，`node_modules` junction）；`git hash-object` 全量比对 → `ALL_TRACKED_FILES_MATCH`（1574/1574）
- **本轮不重跑昂贵全量 5 个 E2E 失败（Tester 负责）**：仅跑类型检查、定向单元、两份 Node 参数脚本、以及自编独立探针
- **结论：未全绿。** `ccc3eb0` 的“同步回退”已被 5f49b24 **大部分撤销**，但 `World.processPendingCommands()` 仍未清除，属**未关闭阻断**；不宣称 C3 解冻

## 一、质量门一行结果（命令 → 结果 → 日志）

| 门 | 命令 | 结果 | 日志 |
|---|---|---|---|
| 类型检查 | `npm run typecheck` | PASS exit=0 | `gate-typecheck.log` |
| 定向单元 | `npx vitest run src/world/sim/core.test.ts src/world/sim/rewiring.test.ts src/world/sim/parity.test.ts` | PASS 22/22（含 B12 zero-dt） | `gate-unit.log` |
| 房建生成参数（220 种 C1 参考） | `npx vite-node scripts/c2-room-generation-parity.ts` | PASS seeds=220 | `gate-room-gen-parity.log` |
| 拾取单位/远距可见循环参数 | `npx vite-node scripts/c2-loot-pickup-parity.ts` | PASS failures=0 | `gate-loot-pickup-parity.log` |
| 生产构建 | `npm run build` | PASS exit=0 | `gate-build.log` |
| 生产预览探针（5376） | `vite preview --port 5376` + probe | fixture 门禁 OK；processPendingCommands 未门禁 | `gate-seam-production.log`、`gate-seam-gating.log` |
| 独立探针：RNG(0) 离提交偏写 | `npx vite-node reviewer-seam-probe-rng0.ts` | 证实离核心 RNG 的偏写（见下） | `gate-seam-rng0.log` |

## 二、实际修复（5f49b24 相对 ccc3eb0）

| 项目 | 状态 | 依据 |
|---|---|---|
| enqueue* 完全只入队、core 唯一提交 | **已修复** | `enqueueHeal/Currency/ApplyUpgrade/AddXp/SpawnLoot/SetPlayerData/EquipWeapon/Teleport` 均仅 `enqueueCommand`，不再同步改 `_sim`；`setPlayerPosition`、`addPlayerXpDirectly` 方法已删除 |
| Player.reset / addXp / equipWeapon / heal | **已修复** | `reset` 仅 `enqueueTeleport`（不再同步 setPlayerPosition）；`addXp`→`enqueueAddXp`；`heal`→`enqueueHeal`；`equipWeapon`→`enqueueEquipWeapon` |
| paused / zero-dt 不提交任何状态 | **已修复** | 新增单元 B12：命令入队但不 tick，HP/货币/位置/loot/targets/drones/tick 均不变；`stepFrame(0)` 只入队不 commit |
| 房间敌人/传送/资源走命令（非直写） | **部分** | 非 Boss 房改为 `room-enter` 命令（敌人由 core 提交）；但 `spawnResourceLoot`/`placePortal` 仍由适配器同步直写（与上一轮同类残留一致） |
| 传送目标由核心 RNG 决定（savedPortalTarget: null） | **已修复** | `onEnterRoom` 传 `savedPortalTarget: null`；core `room-enter` 用 `rngCandidate.pick(neighbors)`，门户目标并入单一核心 RNG 流 |
| Owner 能力真私有（非 owner 方法无门禁） | **已修复** | `ownerResetPlayer/ownerMovePlayer/ownerSetPlayerData` 已移除；改为私有 `#resetPlayer`/`#setPlayerData`，仅在 `restoreCheckpoint`（owner 恢复边界）使用 |
| 生产 helper/fixture 门禁 | **已修复** | `simFixture/playerDataFixture/stepSimulationTicksForTest/setPlayerPositionForTest/clearLootForTest/clearEnemiesForTest/resetProjectilesForTest` 在生产预览均抛 `dev/test only` |
| 原 C1 种子算法/概率/池 + 220 种参考真实 | **PASS** | `scripts/c2-room-generation-parity.ts` 用独立复现的 C1 算法（`pickEnemy`/`enemyCount`/`resourceCount`/`ref.int(0,1)`）与核心 `room-enter` 逐室对比，220 种全部一致（敌人种、资源种、传送目标），且 `state.rngState === ref.snapshot()`（单一 RNG 流）；非对当前实现自证（引用函数与 C1 算法一致，经代码复核） |
| loot 单位还原 + 远距可见循环 | **PASS** | `stepLoot`：pickupRange 以网格单位控制磁吸；20 格远掉落在 drop 时 HP/货币不变且留在地面；磁吸拉近后在 `PLAYER_RADIUS+12` 内拾取；`pickupRange` 升级缩放磁吸半径；掉血药拾取回血；单元脚本全部 PASS |

## 三、未关闭阻断（blocker）

**`World.processPendingCommands()`（ccc3eb0 遗留）尚未清除——`ccc3eb0` 的“同步回退”未彻底消除。**

- 定位：`src/world/World.ts:194`：
  ```ts
  processPendingCommands(): void {
    processCommands(this._sim, [], new RNG(0));
    this.bumpSimVersion();
  }
  ```
- 调用点：`src/economy/main.ts:68`（房间清算奖金 `world.enqueueCurrency(payout)` 后紧跟 `world.processPendingCommands()`），属**普通游戏路径**，非 owner/restore。
- 问题：它绕过 tick 累加器，直接以 `new RNG(0)`（种子 0 的一次性 RNG）提交待处理命令，**不恢复/不持久化 `state.rngState`，且丢弃产生的 `SimEvent`**。独立探针 `gate-seam-rng0.log` 证实：同一 `room-enter` 命令，经 `stepSimulationTicks`（核心 RNG，`rng.restore(state.rngState)`）提交后 `rngState` 变为 `1767624616`，而经 `processCommands(state, [], new RNG(0))` 提交后 `rngState` 仍为 `0`（未动核心 RNG）。即系统里存在第二个 RNG 源与第二条提交通路，违反“唯一 RNG 消费 / core 唯一提交 / tick 外不得旁路”。
- 生产预览探针 `gate-seam-gating.log` 证实：`processPendingCommands` 在生产中 **未门禁（NO-THROW）**，可被普通路径调用；而全部 dev fixture 均已正确门禁。

建议修复：移除 `World.processPendingCommands`，改让 `economy/main.ts` 通过正常 `stepFrame` 累加器提交房间清算奖金（或把 `processPendingCommands` 改为在 tick 内使用核心 RNG 并持久化 `rngState`），以彻底消除 ccc3eb0 的同步回退并满足“enqueue 只入队、core 唯一提交”。

## 四、C3 前置

**未解除。** `AI_NATIVE_ARCHITECTURE.md` 仍写明 C3（Agent Gateway / MCP）是 P2 完成条件，外部 Agent 需走正式信道 + 权限 + 断线预算，HUD 仍显示 `EXTERNAL NOT CONNECTED`。`5f49b24` 无任何 C3 解冻迹象。因上述 `processPendingCommands` 阻断未消除，**不宣称 C3 解冻，不进入 C3 独立复核**。

## 五、报告目录

`reports/ai-native-02/reviewer/c2-seam/`：含 `REVIEW.md`（本文）、全部 gate 日志（`gate-typecheck.log`、`gate-unit.log`、`gate-room-gen-parity.log`、`gate-loot-pickup-parity.log`、`gate-build.log`、`gate-seam-preview-5376*.log`、`gate-seam-production.log`、`gate-seam-gating.log`、`gate-seam-rng0.log`）与独立探针（`probe-seam-production.mjs`、`probe-seam-gating.mjs`、`reviewer-seam-probe-rng0.ts`）。

所有运行均在冻结快照与独占端口（生产预览 5376）上进行；未修改生产源码/已有测试/配置；未切换共享分支、未合并/重置；未读取/恢复 stash。
