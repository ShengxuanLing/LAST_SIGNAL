# AI-NATIVE-02 C2 当前态定向归因报告（59aa852 / 代码 3f97990）

- Worker `y6en9ua8phanll8cqi8dd8ru`，专属目录 `reports/ai-native-02/tester/c2-current-triage/`
- 目标冻结：`59aa85227dcf3c9dcb87d798aaaa7df15f7a2d6e`（父 = 代码提交 `3f97990d7871f099ce86848159b2ffeae00bb10e`），分支 `feat/ai-native-world-integration`
- 隔离：`git archive 59aa852` → `D:/Project/AI-NATIVE-02-snapshots/59aa852`（仅已跟踪文件 + node_modules junction）；专属端口 **5293**（自启自停）；未切分支、未改源码/测试/配置、**未读 stash**、未读并发 WIP；快照 MD5 首尾一致（`00-frozen-state.log` / `10-final-state.log`）。
- 结论：**5 个失败中 3 个源于同一个产品缺陷（升级等级未记录），2 个是契约不同步**；另有 2 个我在本轮独立发现的产品缺陷（房间在敌人出现前即被标记 cleared；磁吸半径把 90 像素当 90 格）。**C3b 仍冻结。**

---

## 1. Gate 一行式

- PASS `npx tsc --noEmit`（快照）退出码 0 → `01-typecheck.log`
- PASS `npm test`（快照）**25 files / 421 tests** → `02-unit.log`
- FAIL `PORT=5293 npx playwright test tests/audit.spec.ts tests/checkpoint.spec.ts tests/economy.spec.ts --workers=1` → **5 failed / 3 passed** → `03-five-e2e.log`
- PASS `PORT=5293 npx playwright test tests/supply-transaction.spec.ts --workers=1` → **3 passed (12.6s)** → `06-supply-transaction.log`

五个失败（同一 commit 复现，非旧快照结论）：

| 用例 | 失败断言 | 归因 |
| --- | --- | --- |
| `audit.spec.ts:65` | `expect(after.upgrades - levelUp.upgradesBefore).toBe(1)` → 收到 0 | **产品缺陷 A** |
| `checkpoint.spec.ts:61` | `expect.poll(inventory).toEqual({weapon:'scatter', buttons:[EQUIP@186, EQUIPPED@230, EQUIP@274]})` | **契约不同步 C**（装备本身正确） |
| `checkpoint.spec.ts:140` | `expect.poll(save.run.player.upgrades).toContainEqual({key,level:1})` → `[]` | **产品缺陷 A** |
| `checkpoint.spec.ts:185` | `expect.poll(save.run.player.upgrades.length).toBe(1)` → 0 | **产品缺陷 A** |
| `economy.spec.ts:11` | `expect(terminal).toBeVisible()` → 元素不存在 | **产品缺陷 B**（房间提前 cleared）+ 夹具未清怪 |

## 2. 产品缺陷 A：升级等级从未记录（3 个失败的共同根因）

- 源码：`src/world/sim/core.ts` 的 `case 'apply-upgrade'` 只调用 `applyUpgrade(def, state.player.data, command.level)`；而 `applyUpgrade` 仅执行 `def.apply(state, level)`（改数值），**不写 `data.upgrades`**。真正会 `data.upgrades.push({key, level})` 的 `applyUpgradeToPlayer()`（core.ts:303）在 59aa852 中**已无任何调用者**（全仓 grep 仅定义处）。
- 我的独立复现（`04-five-cases-probe.log` / `triage-five.json`）：在升级弹层点第一张卡后连续 24 次采样（每 70ms）：
  - 命令确实入队并被提交：点击后立刻 `pending=['apply-upgrade']`，随后 `pending=[]`、tick 前进；
  - **数值已生效**：`dmg 1 → 1.1`（`statApplied=true`）；
  - **等级未记录**：`upgrades` 始终 `[]`（`levelRecorded=false`），存档 `save.run.player.upgrades=[]`。
- 结论：**不是测试不同步，而是产品缺陷**。合法同步点已存在（命令在下一 tick 提交），测试等待再久也不会出现 `upgrades` 条目；6ac60b2 时代 `apply-upgrade` 走 `applyUpgradeToPlayer()`（会 push），3f97990 改成 `applyUpgrade()` 后丢失。
- **修复建议（开发者）**：`case 'apply-upgrade'` 改用 `applyUpgradeToPlayer(state, key, level)`（它同时 `applyUpgrade` 并记录 `{key, level}`），或在该 case 内显式 `data.upgrades.push/更新`。**可保留原断言**：原三个断言（audit:348、checkpoint:157、checkpoint:227）在修复后应直接通过，无需放宽。
- 附注：这条同时解释了 developer 报告里 “checkpoint:140/185 是同步点问题” 的归因不成立。

## 3. 产品缺陷 B：房间在敌人出现之前就被标记 cleared（economy:11）

- 我的独立复现（`05-room-clear-order.log` / `triage-room-clear-order.json`）：
  - tick 53（room-enter 命令入队那一刻）：`room 3 combat` 已 `cleared=1`，而 `alive=0`、`targets=0`；
  - tick 54（敌人真正生成）：`alive=3`、`targets=3`，但房间**已经是 cleared=1**；
  - 之后 6 次采样始终 `cleared=1` + 3 个活敌人。
- 根因：`World.updateRoom()` 在“本房间没有活敌人”时置 `r.cleared = true`；而 `onEnterRoom` 只**排队** room-enter 命令，敌人在**下一 tick** 才生成 → 房间在敌人存在之前就被判定为已清空。
- 影响：`economy.safeRoom()` 要求“当前房间 cleared 且无活敌人且地图上没有 spawned&&!cleared 的房间”，但我的探针显示当前 combat 房即使有 3 个活敌人也已 `cleared=1`；同时 economy 的 `update()` 会为已 cleared 的房间发 `+12 credits · room cleared` 一次性奖励 —— 玩家进入房间即被“结算”，**玩法语义被改变**（未打怪先拿钱）。
- 合法同步点：**不能靠多等一帧解决**（问题是时序语义，不是延迟）。可选修法：(a) `room-enter` 命令提交时同步把房间标记为“未清理”，即把 `cleared` 的判定延后到敌人真正生成之后的 tick；(b) 让 `updateRoom()` 只在房间已生成且敌人已结算（`r.spawned && worldSpawnsCommitted`）后才判定 cleared。
- 夹具侧：economy 测试必须**真正清掉房间敌人**（真实伤害路径）才能满足 `safeRoom()`；当前只穿门不杀怪，即使修好 B 也仍打不开终端。

## 4. 契约不同步 C：背包 EQUIP 的行标签不随提交刷新（checkpoint:61）

- 我的独立复现（同 `triage-five.json`）：
  - 点击 EQUIP 后立刻：`weapon='pulse'`、`pending=['equip-weapon']`、行标签仍是 `EQUIPPED@186 / EQUIP@230 / EQUIP@274`；
  - **一次正常 tick 后**：`weapon='scatter'`、`pending=[]`、事件 `player-equipped` → **装备规则本身正确**；
  - 但行标签仍是旧值（`EQUIPPED@186…`），因为 `PauseScene.refreshWeapons()` 只在**点击时**执行，早于提交。
- 结论：**装备提交无产品缺陷**；缺的是“提交后刷新 UI”。合法同步点：提交 tick 之后需要重新 `refreshWeapons()`（或让标签由 core 状态驱动）。测试若自行等待也不够——标签不会自己刷新，必须由产品侧在提交后刷新或提供可读的提交完成信号。

## 5. 本轮另外两个独立发现（产品缺陷，非测试问题）

### D. 磁吸半径单位错误（`08-loot-magnet.log` / `loot-magnet-log.json`）
- `core.stepLoot` 把 `p.data.pickupRange`（配置值 **90**，原本是像素）直接当作**网格距离**做磁吸：实测在**运行中**的游戏里放置掉落，20 格 → 立即被吸走并结算（currency 20→30）；40 格 → 被拖近（30.39→18.93）后结算；85 格 → 缓慢拖拽（84.04→70.03）仍未结算。
- 因此 5f49b24 报告里“20 格远处不会自动拾取（20 > 12.5）”只在**暂停/零 dt**时成立，运行中不成立；C1 的拾取阈值（12.5 格）实际不是有效拾取距离。
- 建议：磁吸阈值按 `pickupRange / PIXEL_TO_TILE`（=1.4 格）换算，或在 core 里显式区分像素/网格单位。

### E. 暂停时 `captureCheckpoint` 直接拒绝（有未提交命令时）
- `World.hasUncommittedCommands()` → `captureCheckpoint()` 在有 pending 时返回 `null`（1d5a8d7 引入的 barrier）。我实测：排队 1 条命令后 `captureCheckpoint` 的 `savedCurrency` 仍是旧值（70）且 `pending` 不进 checkpoint（`16-seam-contract` 同轮记录）。
- 这是 Reviewer 指出的 checkpointPending 缺口的延续：若玩家在“已购买但未提交”的窗口内退出/保存，采购结果会丢。修复方向应为**提交屏障**（保存前先提交 pending），而不是直接拒绝保存（否则玩家永远存不了档）。

## 6. 新增用例与无夹具短 smoke

- `tests/supply-transaction.spec.ts`（新增 3 例）：`PORT=5293 … --workers=1` → **3 passed**：购买在关闭时提交、只保存一次、重复点击被拦截；额度不足禁用全部报价；未提交购买在 reload 后被丢弃且保留上一个 checkpoint。
- 无夹具菜单接管短 smoke（`07-menu-smoke.log` / `menu-takeover-smoke.json`，真实菜单 + 真实按键，无任何夹具）：
  - 真实菜单 NEW RUN → `owner=human, mode=HUMAN`；
  - 真实暂停菜单点 `AI CONTROL` → `owner=ai, aiEnabled=true, action=ENGAGE`；
  - 真实 `KeyD` → `owner=human, aiEnabled=false`（夺回生效）；
  - 暂停时 `enqueueHeal/enqueueCurrency` **只入队**（HP/currency 不变，pending 2→2）；`stepFrame(0)` **0 事件、0 提交**；一次正常 tick 才提交（`player-healed/currency-gained`）；
  - 20 格掉落在本 smoke 中**被立即拾取**（与 §5-D 一致：运行中磁吸 90 格）。

## 7. CLI 冷启动与进程回收（只复核，不代修）

- `09-cli-coldstart.log`：连续 3 次**冷启动** `vite-node src/ai-native/headlessCli.ts --run --dev`：就绪 3.45–3.46s；`create/observe/quit` 三个响应均 `ok:true`（observe 带 observation）；`quit` 后 **22–24ms 内退出，exit code 0**，stderr 仅审计行（`channel=dev/test …` / `channel closed; instances released; exit 0`）。
- 结论：CLI 冷启动协议就绪与进程回收**可复核且正常**；未替 developer 修改任何 CLI 代码。

## 8. 与上一轮（5f49b24）的关系

上一轮 triage（`reports/ai-native-02/tester/c2-seam-triage/`，同批已知结论保留）已定位“命令只在下一 tick 提交 / 暂停零 dt 不写 / 公开 owner setter”三项；本轮在 59aa852 上确认：
- “升级同步点”问题**在 59aa852 仍失败**，但已确定**不是同步点问题而是缺陷 A**（等级丢失）；
- 上一轮 economy 结论“夹具未清怪”**不完整**：除夹具外还存在缺陷 B（房间提前 cleared）；
- 上一轮“20 格不拾取”的结论**需修正为仅在暂停时成立**（运行中被磁吸吞掉）。

## 9. 给开发者的明确修复清单（可保留原断言）

| # | 缺陷 | 位置 | 合法同步点 / 修法 | 原断言可否保留 |
| --- | --- | --- | --- | --- |
| A | 升级等级未记录（3 个失败） | `src/world/sim/core.ts` `case 'apply-upgrade'` | 改用 `applyUpgradeToPlayer()`（同时记录 `{key,level}`） | **可全部保留**（audit:348、checkpoint:157、checkpoint:227） |
| B | 房间在敌人生成前被标记 cleared | `src/world/World.ts` `updateRoom()` / `onEnterRoom()` | 让 `room-enter` 提交后再判定 cleared（或 `cleared` 由 core 持有） | economy 用例需同时真正清怪 |
| C | 背包 EQUIP 行标签不随提交刷新 | `src/scenes/PauseScene.ts` | 提交后 `refreshWeapons()`，或标签由 core 状态驱动 | checkpoint:94 可保留 |
| D | 磁吸半径单位（90 px 当 90 格） | `src/world/sim/core.ts` `stepLoot` | `pickupRange / PIXEL_TO_TILE` | 无直接断言 |
| E | 有 pending 时 checkpoint 直接拒绝 | `src/world/World.ts` `captureCheckpoint()` | 改为**提交屏障**（先提交 pending 再保存） | checkpoint 旧档用例可保留 |

## 10. 结论与限制

- **5 个失败中 3 个（audit:65、checkpoint:140、checkpoint:185）是同一个产品缺陷 A**；1 个是契约不同步 C（装备提交正确、UI 不刷新）；1 个由缺陷 B + 夹具未清怪共同造成。**不是“全是测试契约问题”**。
- 我另发现缺陷 D、E（本轮独立证据）。
- 通过项：`typecheck`、`421` 单测、`supply-transaction` 3 例、无夹具菜单接管 smoke、暂停零 dt 不写、CLI 冷启动与回收。
- 未覆盖：未重跑全量 E2E（本轮 5+3+探针）；C3b 仍冻结；无真实 Agent/World 端到端。
