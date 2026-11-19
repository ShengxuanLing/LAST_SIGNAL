# C2 checkpoint barrier 独立复核（1d5a8d7）

- **被测提交**：`1d5a8d703b1ed66a7664df9712949a46240ed1ae`（短 `1d5a8d7`），父 `dd43b37d57283a7b4d8d28d158e5782a148a41f4`，HEAD 已在目标提交
- **分支**：`feat/ai-native-world-integration`；C3b 仍冻结；未读/未恢复 stash `@{0}`/`@{1}`；无生产源码 WIP
- **复核方式**：`git archive` 冻结快照 `D:/Project/lastsignal-c2checkpoint-review-1d5a8d7`（`node_modules` junction）；`git hash-object` 全量比对 → `ALL_TRACKED_FILES_MATCH`（1578/1578）
- **未重复 Tester 昂贵全量**：5 个 E2E 失败 + flaky 仍由 Tester triage；仅跑类型检查、定向单元（B12–B16）、两份 Node 参数脚本、以及自编独立探针（核心购买覆盖 + 浏览器 barrier）
- **结论：checkpoint barrier 本身正确并关闭了上轮“低 delta/暂停保存旧资源”阻断；但新增/暴露硬阻断——`set-player-data` 全对象覆盖会丢失已排队奖励/HP/XP，且 commit 不复验余额/安全房、无核心幂等。不宣称 C3 前置解冻，仍待 E2E。**

## 一、质量门一行结果（命令 → 结果 → 日志）

| 门 | 命令 | 结果 | 日志 |
|---|---|---|---|
| 类型检查 | `npm run typecheck` | PASS exit=0 | `gate-typecheck.log` |
| 定向单元 | `npx vitest run src/world/sim/core.test.ts src/world/sim/rewiring.test.ts src/world/sim/parity.test.ts` | PASS 26/26（含 B12–B16） | `gate-unit.log` |
| 房建生成参数（220 种 C1 参考） | `npx vite-node scripts/c2-room-generation-parity.ts` | PASS seeds=220 | `gate-room-gen-parity.log` |
| 拾取单位/远距可见循环参数 | `npx vite-node scripts/c2-loot-pickup-parity.ts` | PASS failures=0 | `gate-loot-pickup-parity.log` |
| 购买全对象覆盖探针（核心） | `npx vite-node reviewer-probe-purchase-overwrite.ts` | **FAIL failures=3**（A/C 覆盖丢失） | `gate-purchase-overwrite.log` |
| checkpoint barrier 探针（dev 5391） | `vite --port 5391` + probe | barrier 在低 delta/暂停/立即退出均拒绝捕获 | `gate-checkpoint-barrier.log` |

## 二、barrier 修复实际生效（PASS 部分）

- `World.hasUncommittedCommands()`：`pendingCommands.length > 0`（`World.ts:187`）。
- `World.captureCheckpoint()`：在 safeRoom 条件后再检查 `hasUncommittedCommands()`，为真则返回 `null`（`World.ts:1164`）。
- 调用者安全处理 `null`：
  - `GameScene.ts:124`：`if (firstCheckpoint) { writeCheckpoint }`，不崩溃，仅跳过首存。
  - `GameScene.saveCheckpoint()`（`:489`）：`if (!checkpoint) return false;`，且**未**清 `checkpointDirty`，下一帧重试。
  - `economy/main.ts`：`const saved = scene.saveCheckpoint(); if (saved) {...}`，未保存则保留 `pendingReward`/`pendingPurchase`。
- 浏览器 barrier 探针（`gate-checkpoint-barrier.log`，dev 5391）：
  - 低 delta（`stepFrame(1ms)`）：`pending=true`、`currencyUnchanged=true`、`captureNull=true` → 拒绝旧资源存档。
  - 暂停：`pending=true`、`captureNull=true` → 拒绝。
  - 立即退出：`captureNull=true`、`gs.saveCheckpoint()=false` → 旧 checkpoint 保留、dirty 不清。
  - 完整 tick 后：`pending=false`、`currencyGained=true`、捕获成功。
- 上一轮“低 delta/暂停保存旧资源”阻断 **已关闭**。`processCommands` 仍仅由 tick 调用，`new RNG(0)` 仍 `restore(state.rngState)`（未改动，沿用 5f49b24 结论）。

## 三、新增/暴露硬阻断：`set-player-data` 全对象覆盖

**根因**：adapter 在 `buySupply(before, supply)` 基于**提交前的整份 PlayerData 快照**算出 `purchased`（`structuredClone(player)`，扣价并 apply），`enqueueSetPlayerData` 只排一条 `set-player-data`；core `processCommands` 的 `set-player-data` 直接 `state.player.data = JSON.parse(JSON.stringify(command.data))` **整对象替换**，不合并、不按增量扣价、commit 不复验余额/安全房。

独立核心探针（`gate-purchase-overwrite.log`，真实 `buySupply`）：
- **A（先奖励后购买）FAIL**：`enqueueCurrency(20)` 后再 `set-player-data(purchased)`，一 tick 后 `currency=90`，**应为 110** → 房间清算奖励 20 被覆盖丢失。
- **B（先购买后奖励）PASS**：反序则奖励保留（110）→ 顺序敏感。
- **C（先回血/加经验后购买）FAIL**：`hp=40` 与 `xp=0` 被 `purchased` 旧快照覆盖（期望 hp 65 / xp 20）→ 回血、经验丢失。
- **D（commit 不复验余额）**：先把货币改成 0 再提交旧 `purchased`，仍落成 `currency=90` → 无 commit 期余额校验。
- **E（UI 双击≠核心幂等）**：同一旧快照连排两条 `set-player-data`，结果只付一次（90）、仅保留最后一件 → 无核心幂等/原子校验。

**可达性**：终端房清算 → `update()` 在顶部 `enqueueCurrency(payout)` 并 `pendingReward=payout`；玩家同帧/下一帧按 G 打开 Supply（`scene.pause()`），点击购买 → `enqueueSetPlayerData(purchased)`（快照不含未提交奖励）。暂停期间无 tick，恢复后一次 tick 依次执行 `[add-currency, set-player-data]` → **奖励被覆盖丢失**。属真实可复现路径，不是理论。

**修复条件（必须满足其一/组合）**：
1. 购买改为专用增量命令（如 `buy-supply {roomId,index,price,item}`），commit 时对**当前 canonical data** 重新校验 `currency >= price` 且仍处于安全房，再执行 `currency -= price` + `apply(item)`；禁止整对象替换。
2. 或 commit 时拒绝在 `pendingCommands` 非空/未提交奖励存在时应用整对象替换，改为按 delta 合并。
3. 或在 adapter 侧等 `!hasUncommittedCommands()`（commit barrier）后再从已提交数据计算 `purchased`，并对 core 加幂等 token（购买 id/nonce），保证双击/重放不重复扣费或重复发放。

> 结论：`set-player-data` 单条命令**不等于**安全交易——它只保证“原子替换”，不保证与排队事务的正确合成，也不做 commit 期校验/幂等。

## 四、`hasUncommittedCommands` 事务覆盖不完整（建议修复）

`hasUncommittedCommands()` 只看 `_sim.pendingCommands`，**未覆盖 `worldSpawns`**（`World.ts:134` 独立队列；`enqueueSpawnEnemy`/`enqueueSpawnBoss` 只 push 到 `worldSpawns`，由 `processWorldSpawns` 在下一 tick 前直写 core）。若在 `worldSpawns` 非空时捕获 checkpoint，恢复时这些 spawn 丢失。

当前被 `captureCheckpoint` 的 `boss/enemies/alive/rooms.spawned&&!cleared` 守卫部分掩盖（Boss 房 `spawned` 且未清 → 返回 null；Boss 存活 → 返回 null），**但 barrier 语义声明不完整**。建议：`return this._sim.pendingCommands.length > 0 || this.worldSpawns.length > 0;`。

## 五、B12–B16 是否有意义（非纯常量自证，但 B14/B16 不覆盖真实风险）

- B12（zero-dt 不提交）、B13（经济奖励 zero-dt 不提交/一 tick 提交一次/空转不重复）、B15（sub-tick 累积后一次提交）——测真实行为，非常量自证，有意义。
- **B14** 直接断言 `state.pendingCommands.length`（裸数组），**未测** `World.hasUncommittedCommands()`、也未覆盖 `worldSpawns` → 屏障方法本身无单测，属弱/自指。
- **B16** 只证明“`set-player-data` 一条命令原子应用全部字段”，恰好**展示的是危险的全量覆盖语义**，未测与排队奖励/回血/经验的合成 → 给出“原子=安全”的误导性安全感。
- 建议补：B17 覆盖“奖励在前 + 购买在后”的合成正确性；B18 覆盖 commit 期余额/安全房复验与幂等。

## 六、UI “Processing” 改动是否功能回归

- `#supply-feedback` 位于 `<dialog>` 内（`economy.html:25`，dialog 19–27）。购买时 `feedback='Processing X...'`，成功提示 `Purchased X.` 只在 `update()` 的 `committed && safe && saved` 分支设置；而 `update()` 是 `POST_UPDATE`，`scene.pause()`（Supply 打开）期间不运行，因此成功提示只在**关闭弹窗之后**才写入——此时 dialog 已关闭，提示不可见；`open()` 又会清空 feedback。
- 结果：**购买成功反馈实际不可见**（回归）；弹窗打开期间显示“Processing”且所有购买按钮被禁用、余额仍为未扣减旧值，直到关闭弹窗触发 commit/save。属 UX/功能回归，建议把成功/失败反馈移到 dialog 外可见区域或关闭前先 commit+save 再关闭。

## 七、仍待 E2E（Tester）

- 5 个 E2E 失败 + 1 flaky 仍待 Tester triage（本轮未重复）。
- 真实购买 + 重开（预算/装备/升级/存档恢复）需浏览器 E2E。
- 第三节“奖励+购买/回血+购买”覆盖丢失需在修复后做 E2E 回归。
- 直接调用 `captureCheckpoint` 的测试（`tests/ai-native-world.spec.ts:639`、`tests/c2-parity.spec.ts:370/592`）现可能因 pending 返回 null，需确认其 seeds/流程已清空 pendingCommands（否则偶发）。

## 八、C3 前置

**未解除。** `AI_NATIVE_ARCHITECTURE.md` 仍将 C3（Agent Gateway/MCP）列为 P2 完成条件，HUD 仍 `EXTERNAL NOT CONNECTED`，本轮无解冻迹象。因第三节硬阻断未关闭，不宣称 C3 前置解冻，不进入 C3 独立复核。

## 九、报告目录

`reports/ai-native-02/reviewer/c2-checkpoint-barrier/`：`REVIEW.md`（本文）、`gate-typecheck.log`、`gate-unit.log`、`gate-room-gen-parity.log`、`gate-loot-pickup-parity.log`、`gate-purchase-overwrite.log`、`gate-checkpoint-barrier.log`、`gate-dev-5391.log`、`probe-purchase-overwrite.ts`、`probe-checkpoint-barrier.mjs`。

所有运行均在冻结快照与独占端口（dev 5391）上进行；未修改生产源码/已有测试/配置；未切换共享分支、未合并/重置；未读取/恢复 stash。
