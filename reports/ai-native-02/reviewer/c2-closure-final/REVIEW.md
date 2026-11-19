# C2 回归闭环与购买 ledger 最终独立验收（ae72a67）

- **被测提交**：`ae72a67f92c5c9c5ebde9f4163db086911a3106e`（HEAD），父链 `a1d07f7 → 3a28d4f → 6eb2ba0 → c2b0215 → 59aa852`
- **代码提交**：`c2b0215`（回归闭环：升级记录/房间清算顺序/装备刷新/拾取单位）、`6eb2ba0`（购买 ledger 硬配额 + canonical/checkpoint 持久化）、`3a28d4f`（CLI 冷启动预算测试）；`a1d07f7`（文档）、`ae72a67`（刷新 parity 夹具）
- **分支**：`feat/ai-native-world-integration`；C3b 仍冻结；未读/未恢复 stash `@{0}`/`@{1}`；无源码 WIP
- **复核方式**：`git archive` 冻结精确 hash 快照 `D:/Project/lastsignal-c2closure-review-ae72a67`（`node_modules` junction）；`git hash-object` 全量比对 → `ALL_TRACKED_FILES_MATCH`（1600/1600）
- **未重复无关全量**：只跑定向 unit、全部 unit（快）、相关 4 个 E2E spec、以及自编独立探针
- **结论：先前 ledger/canonical/恢复/拾取/升级/房间清算等硬阻断均已闭环；但发现 1 个新阻断——`GameScene.onResume()` 在恢复时强制 `stepFrame` 一 tick（违反“暂停不推进/恢复只正常帧”）。因此 C2 尚未最终闭环，C3b 暂不允许。**

## 一、质量门一行结果（命令 → 结果 → 日志）

| 门 | 命令 | 结果 | 日志 |
|---|---|---|---|
| 类型检查 | `npm run typecheck` | PASS exit=0 | `gate-typecheck.log` |
| 全部 unit | `npx vitest run` | PASS 429/429（26 files） | `gate-unit-full.log` |
| 定向 unit | `npx vitest run core/rewiring/parity/purchaseLedger/supplies` | PASS 53/53 | `gate-unit.log` |
| 房建生成参数（220 种 C1 参考） | `npx vite-node scripts/c2-room-generation-parity.ts` | PASS seeds=220 | `gate-room-gen-parity.log` |
| 拾取单位参数 | `npx vite-node scripts/c2-loot-pickup-parity.ts` | PASS failures=0 | `gate-loot-pickup-parity.log` |
| Node 参数 | `npx vite-node scripts/c2-node-parity.ts` | PASS checks=8 failures=0 | `gate-node-parity.log` |
| Kill 参数 | `npx vite-node scripts/c2-kill-parity.ts` | PASS checks=13 failures=0 | `gate-kill-parity.log` |
| 独立 ledger/升级/canonical 探针 | `npx vite-node reviewer-probe-ledger-upgrade.ts` | PASS 23/23 | `gate-ledger-upgrade.log` |
| 独立旧档兼容/深拷贝探针 | `npx vite-node reviewer-probe-old-save-ledger.ts` | PASS 8/8 | `gate-old-save-ledger.log` |
| 开发者 ledger 探针 | `npx vite-node reports/ai-native-02/c2-purchase-ledger/probe-ledger.ts` | PASS failures=0 | `gate-dev-probe-ledger.log` |
| 暂停/恢复强制 tick 探针（dev 5396） | vite + probe | **发现 onResume 强制 +1 tick** | `gate-pause-roomenter.log` |
| pendingRoomEnters 探针（dev 5397） | vite + probe | PASS：生成提交前不 clear | `gate-pending-roomenters.log` |
| 相关 E2E（supply-transaction/purchase-ledger/economy/checkpoint） | `PORT=5398 npx playwright test ...` | PASS 10/10 | `gate-e2e-closure.log` |

## 二、逐项闭环复核

### 1. Ledger 硬配额 64、无淘汰、满额旧 tx 不重扣 —— **已闭环**
- 代码：`PURCHASE_LEDGER_CAP = 64`；达到上限时新 tx 直接 `Supply ledger full` 拒绝，**从不 splice/淘汰**；重复 id 在校验之前即 `Duplicate transaction`，原记录不覆盖。
- 独立探针 `gate-ledger-upgrade.log`：预填 64 条后，旧 tx 仍判 Duplicate 且不重扣；新 tx 拒绝 `ledger full`；长度恒为 64；`t0` 仍在（未淘汰）；`new-at-cap` 未记录。
- 开发者 `probe-ledger.ts` 与 `purchaseLedger.test.ts`（6 例）同结论。

### 2. 成功/拒绝一次计费；重复 tx 异 payload —— **已闭环**
- 代码：在通过结构性校验与“活状态校验”后、blocker 判定前 `push(tx)`；因此**成功与 blocker 拒绝（余额不足/满血/满级/已拥有）各记一次**；结构性拒绝（未知 offer、错房、未清房、威胁、非法 id、满额、重复）在 push 前返回，不占额度。
- 探针：成功记一次；第二次成功记一次；满血 blocker 拒绝记一次；重复拒绝不追加；未知 offer 不消耗额度。异 payload（同 tx 先 repair 后 weapon）→ Duplicate 拒绝，无额外扣费/无武器加入。

### 3. canonical 含账本 / 恢复深拷贝 / 旧档兼容 / 新档清空 —— **已闭环**
- `canonicalSimulationState` 现含 `purchaseTransactions`；`captureCheckpoint.coreState` 含之；`cloneCheckpoint` 经 JSON 深拷贝。探针：同账本 canonical 相等、异账本不等；clone 深拷贝（改 clone 不影响源）。
- `restoreCheckpoint` 不再清空，改为从 `run.coreState.purchaseTransactions` 恢复；旧档无该字段 → `[]`（`validateCheckpoint` 明确“absent is valid”）。
- `validateCheckpoint`：缺字段有效；≤64 且无重复有效；>64 / 重复 / 空串 / 超 128 字符无效（探针 8/8）。
- 新 run `createSimulationState` 账本为空（探针）。
- `purchaseLedger.test.ts` 覆盖“恢复后同 id 不重扣（成功与拒绝两种）”。

### 4. receipt 缓存界限 / 重复 tx 异 payload —— **已闭环**
- `World.applySimEvents` 对 `supplyReceipts` 超 `PURCHASE_LEDGER_CAP` 时按插入序删最旧（bounded UI cache；核心账本仍为权威）。异 payload 重复见第 2 项。

### 5. A：升级条目与数值不重复 —— **已闭环**
- `core.processCommands` `apply-upgrade` 现由核心同时记录进度：`find(key)` 存在则更新 `level`，否则 push；不再产生重复条目。`LevelUpScene` 传 `newLevel=(prog?.level??0)+1`。
- 探针：同 key 二次升级 → 单条记录、level=2、效果按 1.08² 生效。

### 6. B：pendingRoomEnters 防未生成就 clear / 发奖一次 —— **已闭环**
- `onEnterRoom` 不再同步 `r.spawned=true`，改为 `pendingRoomEnters.add`；`updateRoom` 的 clear 判定加 `!pendingRoomEnters.has(id)`；`room-generated` 事件（或 Boss `spawnBoss`）才 `spawned=true` 并移出 pending；`hasPendingSpawns()` 含 `pendingRoomEnters`。
- 探针（dev 5397，正确时序）：进入新房后 `pendingSize=1 / spawned=false / cleared=false / hasUncommitted=true / enemies=0`；手动 `updateRoom()` 仍 `cleared=false`（不早清）；下一 tick 提交后 `pendingSize=0 / spawned=true / enemies=3 / cleared=false`；清敌后 `cleared=true`（仅一次）。
- 另修 `roomResourceCount`：仅 `resource/shop` 房生成资源（C1 语义），普通/起始房不再掉资源；已由 220 种房建 parity 覆盖。

### 7. D：拾取单位修正（PIXEL_TO_TILE）—— **已闭环**
- `core.stepLoot`：`pickupRadius = (pickupRange ?? 3) / GAME.PIXEL_TO_TILE`（`PIXEL_TO_TILE=64`；base `pickupRange=90` → ≈1.4 格磁吸）；拾取阈值仍为 `PLAYER_RADIUS + 12` 格。
- 探针/参数：远 20/40/85 格在 120 tick 后仍在地面、货币不变；对角 ~19.8 格不收集；近 1 格收集；小 `pickupRange=2` 不收集远处；大 `pickupRange=40*64` 可达并收集 30 格。`B25` 单测与 `c2-loot-pickup-parity.ts` 同结论。

### 8. 经济购买增量/安全房/保存 barrier、房间 RNG220、核心唯一提交、Owner 门禁 —— **未回退**
- economy 用 `enqueuePurchaseSupply`（增量）；`safeRoom` 在打开/购买时校验；保存 barrier 由 `captureCheckpoint`（pending → null）+ `settlePurchase`（`committed && safe` 才保存）承担。
- `hasUncommittedCommands = pendingCommands || hasPendingSpawns(worldSpawns||pendingRoomEnters)`。
- `processCommands` 全仓库唯一调用点 `core.ts:974`（tick 内）；`processPendingCommands` 已不存在；`enqueueSetPlayerData` 仍 `World.assertDevTest()`（Owner/fixture 门禁）。
- room-gen 220 / node 8 / kill 13 / loot 全 PASS；相关 E2E 10/10 PASS。

## 三、新增阻断：`GameScene.onResume()` 恢复时强制一 tick

- 位置：`src/scenes/GameScene.ts` `onResume()`：
  ```ts
  this.world.resetSimulationAccumulator();
  this.world.stepFrame(1000 / 60 + 1e-6, { move:{x:0,y:0},dash:false,fire:false,aim:null,interact:false });
  ```
  调用者：`PauseScene` 关闭（`parent.onResume()`，pause/inventory 两种模式）。
- 独立探针 `gate-pause-roomenter.log`：
  - 暂停中 `gs.update(0, 1000)` → tick 不变（`pauseNoAdvance=true`，tick 68→68）——暂停本身正确。
  - `gs.onResume()` → **tick +1（`onResumeAdvance=1`）**，与真实 delta 无关。
- 违反 Lead 明确要求“必须保证暂停不推进 / 恢复只正常帧”与“delta 不足 tick 不得错误提交”：`onResume` 用固定 `1000/60+1e-6` 强制推进一整 tick，会推进敌人/弹丸/计时器，并在 delta 不足时也提交排队命令（equip/upgrade/purchase）。
- 同类模式另见 `onLevelUpClosed`（line ~536，pre-existing）与 create 首存（line ~128，初始化的正常 tick，Lead 上轮已接受）；本次新增的是 **onResume**。
- **注意测试遮蔽**：`tests/checkpoint.spec.ts` 新增 `commitTick()` 手工 `stepFrame` 并注释“The inventory overlay itself never steps the sim”，用同步点绕过真实 `onResume` 路径，因此现有 E2E 不会暴露该强制 tick。
- **修复条件**：`onResume()` 移除强制 `stepFrame`，仅 `paused=false` + `control.resume()` + `resetSimulationAccumulator()`，让随后的正常 `update(delta)` 累积到完整 tick 再提交；QUEUED 标签在正常提交前保持“QUEUED”即可（无需立即 EQUIPPED）。如需“关闭即提交”，应以“待提交”状态呈现而非强制 tick。

## 四、观察项（非阻断，但需同步说明）

1. `tests/audit.spec.ts` 的 loot 步骤现显式设 `w.playerDataFixture.pickupRange = 40 * 64`（注释“give this probe a wide magnet”），使 +18 格掉落在 600ms 内可见地被拉入。夹具**已明确标注**，但该正向断言不再覆盖默认 `pickupRange`（90px≈1.4 格）；默认远距不吸由 `c2-parity` B11 与单位探针覆盖。建议在 audit 内同时断言“默认范围下 18 格不掉落”，避免读者误以为是默认行为。
2. `tests/economy.spec.ts` 删除了原“Storage 不可用 → 购买未保存提示”的用例，改为正常购买流；`settlePurchase` 的“保存失败单次重试”分支现无 E2E 覆盖（代码仍在）。建议补回一个 storage-fail 用例或标注为已知覆盖缺口。
3. `checkpoint.spec.ts` 的 `commitTick` 属**测试同步点**（inventory 不 step）；已在注释中说明，但它绕过 `onResume`，是第三节讨论的一部分。

## 五、结论与 C3b 判定

- **先前硬阻断**（ledger 淘汰重放、canonical 缺失、恢复重扣/旧档、receipt 无界、升级重复、房间早清、拾取单位错误）——**均已闭环**。
- **仍余 1 个阻断**：`GameScene.onResume()` 强制 tick（违反“恢复只正常帧”）。因此 **C2 尚未最终闭环**。
- **C3b：暂不允许。** 该阻断是 `PauseScene`/恢复路径的核心行为，属 C2 验收明确项；且 C2 不是 P2 整体（`AI_NATIVE_ARCHITECTURE.md` 仍把 C3 列为 P2 完成条件，HUD 仍 `EXTERNAL NOT CONNECTED`）。待修复 `onResume` 强制 tick 并回归（暂停/恢复不推进、delta 不足不提交、QUEUED 正常提交）后，方可判 C2 闭环并讨论 C3b。
- 另外建议：补回 economy storage-fail 覆盖、明确 audit 宽磁吸夹具语义（第四节）。

## 六、报告目录

`reports/ai-native-02/reviewer/c2-closure-final/`：`REVIEW.md`（本文）、`gate-typecheck.log`、`gate-unit.log`、`gate-unit-full.log`、`gate-room-gen-parity.log`、`gate-loot-pickup-parity.log`、`gate-node-parity.log`、`gate-kill-parity.log`、`gate-ledger-upgrade.log`、`gate-old-save-ledger.log`、`gate-dev-probe-ledger.log`、`gate-pause-roomenter.log`、`gate-pending-roomenters.log`、`gate-e2e-closure.log`、`gate-dev-5396/5397/5398.log`、`probe-pause-roomenter.mjs`、`probe-pending-roomenters.mjs`、`pw-out-closure/`。

所有运行均在冻结快照与独占端口（dev 5396/5397/5398）上进行；未修改生产源码/已有测试/配置；未切换共享分支、未合并/重置；未读取/恢复 stash。
