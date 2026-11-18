# GAMEPLAY-01 · P4 v2 冻结候选 · 增量独立审查（F1 / F2 + 指标口径）

审查者：独立只读。日期：2026-11-18。范围：**P4 v2 增量（F1 布局全有或全无、F2 有界 frame 校验、指标口径）**。
上一轮 `P4_FINAL_REVIEW.md`（v1）**原样保留**，其结论对 v1 字节仍成立；本文只对 v2 生效。
无模型调用、无 `src/`/`tests/` 修改、未 commit/push；不代替整体 GAMEPLAY 通过，真人验收仍 `PENDING`。

## 0. 固定输入（先核字节）

| 项 | 值 |
|---|---|
| 候选工作树 | `D:\Project\LAST_SIGNAL\.cindy-worktrees\serene-leakey`（独立 worktree，主仓四 dirty 未使用） |
| HEAD | `3819621c5faab56b114b6e5a560f8fe78c17709d`，`commitsMadeByThisWorker: 0`，未 push |
| manifest | `…\reports\gameplay-01\developer\p4-recovery\manifest.v2.json`（`freeze.state = FROZEN for independent re-review (v2)`） |
| 我的快照 | `git archive 3819621` + v2 九个源 + 三个文档 → `D:\tmp\gp01-p4v2`（`node_modules` 只读 junction） |
| 端口 / 浏览器 | 本轮无需浏览器（产品渲染源与 v1 相同）；未用 tester 5199/5492 与开发 5471 |
| v1 冻结件 | `…\p4-recovery\v1-freeze\{manifest.v1.json, rendered-evidence.v1.json, rendered-shots-v1, src, FREEZE-HASHES.log.txt}` 存在且未被覆盖 |

**12 个交付文件 sha256 与 manifest 逐一相同（9 源 + 3 文档）**，审查前后再核一次仍不变：

```
core f71523e1  p1Scenario 76367087  worldHeadless 56253ef7  World 3ff4f7e3  relay 6fc7ba40
relayRoutes.test 097bfc6f  worldHeadlessDemoRoute.test 11c812f7  p1ScenarioLayout.test 8b12cbf2
worldHeadlessFrameAuthored.test 93447a60
docs: COOP_LEVEL_DESIGN.P4-UPDATE 7c9a19bf  P5_VARIANTS_PLAN 80094d2d  P4_TEST_AND_FINAL_LIMITS b3ec418c
```

其中 `core` / `World` / `relay` / `relayRoutes.test` / `worldHeadlessDemoRoute.test` 五个文件与 v1
**逐字节相同**（manifest 标为 unchanged-since-v1），变更只有 `p1Scenario.ts`（F1）与 `worldHeadless.ts`（F2），
另加两个新测试文件。

## 1. Gate（命令 → 结果 → 绝对日志）

| gate | 命令 | 结果 | 日志 |
|---|---|---|---|
| typecheck | `npx tsc --noEmit`（我，快照内） | **PASS 0 `error TS`**, TSC_EXIT=0 | `D:\Project\LAST_SIGNAL\reports\gameplay-01\reviewer\p4v2-typecheck.log` |
| v2 源测试（54 条） | `npx vitest run relayRoutes + worldHeadlessDemoRoute + p1ScenarioLayout + worldHeadlessFrameAuthored` | **PASS 54/54（4 文件）** | `…\reviewer\p4v2-tests.log` |
| 我的 F1/F2 负向探针 | `npx vitest run src/reviewer/p4v2-probe.test.ts`（仅我的快照） | 6 通过 / 1 主动失败（见 R1，是我故意断言“守卫应保留”暴露的既有缺口） | `…\reviewer\p4v2-probe.log` |

未跑（按 Lead 指示 targeted 即可）：完整 818、全量 E2E、build、v1 的浏览器证据重跑（产品渲染源未变）。

## 2. F1（布局全有或全无）→ **CLOSED**

`buildP1Scenario` 现在先算完整布局（`playerStart / portalA / portalB / 互异性 / relay / sentries`），
全部通过后才在**一个提交块**里写两条 `connectedTo` 边与 `kind='combat'`（`p1Scenario.ts:191-215` 区间，
注释明确 “ONE commit step … no rollback, no partial mutation”）。

我的独立负向探针（3 种失败模式，各自独立地图）：

| 失败模式 | builder | 地图字节 |
|---|---|---|
| 作者房间无可走格 | `null` | **unchanged: true** |
| 只有一格（容不下 2 只哨兵） | `null` | **unchanged: true** |
| 窄条房间（两个门户会重叠） | `null` | **unchanged: true** |

成功路径：`kind start → combat`、`connectedTo` 恰 +2 条边；第二遍重建（同一地图）`routes` 完全相同（幂等），
没有重复加边。开发者自己的 `p1ScenarioLayout.test.ts` 另外覆盖“设备避不开玩家起点”这一失败模式，同样断言
`graphBytes(map)` 不变。

→ 上一轮 F1（null 失败留半突变）**已闭环**：失败时地图字节不变，成功时一次性提交。

## 3. F2（有界 authored frame 校验）→ **CLOSED**

`isHeadlessFrame` 现在对 `sim.authored` 走 `isValidAuthoredScene(value, map.rooms)`（`worldHeadless.ts:1180-1208`）：
`id === 'p1'`、`roomId/startRoomId` 必须存在于本帧 `map.rooms`、`routes` 数组长度 1..2、每个 `target` 数字且在
房间集内、`when` 必须是 `RELAY_ACTIVE|RELAY_INACTIVE`、`label` 可缺省但必须是字符串、`portal` 可缺省但 `x/y`
必须是有限数字。**`sim.authored === undefined` 直接放行**（旧帧兼容）。

我的负向探针（17 种坏形状，全部 `accepted: false`）：
routes 非数组 / 空数组 / 长度 3 / 元素 null / target 不在 map / target 非数字 / when 非法 /
portal NaN / portal Infinity / portal 非数字 / portal 是数组 / label 非字符串 / roomId 不在 map /
startRoomId 不在 map / id 不是 p1 / authored=null / authored 是字符串。

正向与边界：
- **旧帧兼容**：删掉 `authored` 键的帧 → `accepted: true`（并且 `restore().ok === true`、`routeState===null`、
  `demoScenario===null`，不抛错）。
- **fail-closed 且不污染活世界**：把坏帧交给 `restore()` → `{ok:false, code:'E_SNAPSHOT_INVALID'}`，
  活世界 `canonicalSimulationState` **前后逐字节相同**，`routeState` 仍是自己的。
- **“accepted 但容易崩”的形状**（我先让 relay 真正提交，确保 `routes.find` 被执行到，再逐项试）：
  单路线无 portal → `target 1`、`portal null`、不抛错；portal 远在地图外（±1e6）→ `target 1`、不抛错；
  路线 target 指向作者房自己 → `target 0`、不抛错；`startRoomId` 与 `roomId` 不同 → `target 1`、不抛错。
  校验没有把非法形状放进来，也不是“权限扩大”——它只是给 Owner 帧加结构门槛，语义少见的合法帧照常可用。
- `fromFrame(坏帧)` 仍按既有契约 `throw(/invalid headless frame/)`（开发者测试也断这条）。

→ 上一轮 F2（坏 frame 让 `routeState` 抛 `routes.find is not a function`）**已闭环**。

## 4. 剩余问题（都不是 v2 引入，但必须记录）

### R1（MEDIUM，既有 P2 缺口，非 v2 回归）frame `restore()` 会丢“单一 pending”守卫 → 可产生重复队列
我按 Lead 的“P2 queue/busy 不回归”做了 direct 探针，实测：

```
confirm 后 queue = ['signal-scan']，guard = {proposalId:'local_2_1', kind:'scan', …, restored:false}
snapshot → new World → restore(frame)
  → queue 仍 = ['signal-scan']          （队列保留，OK）
  → echoPendingLocal = null             （守卫丢失）
  → 立即 proposeLocalEcho() → 'scan'；confirm → true
  → queue = ['signal-scan','signal-scan']   ← **同一动作排队两次**
```

对照：走 `fromSimulationState`（P2 v3 修过的 raw-sim 路径）时守卫是
`{restored:true, proposalId:null}`，`proposeLocalEcho()` 返回 null，不会重复。

探针里这一条是**故意断言失败**的（`guard state preserved through the Owner restore: expected null to deeply
equal {proposalId:'local_2_1',…}`），用来把缺口钉在日志里；不是产品测试，不进仓库。

结论与归属：`restore()` / `proposeLocalEcho` / `confirmLocalEchoProposal` 的实现在 v1→v2 与基座 `3819621`
**逐字节未变**（`git diff 3819621 -- worldHeadless.ts` 对这三处 0 命中），所以**不是 v2 回归**，是 P2 v3 只修了
`fromSimulationState`、没修 frame 路径的既有缺口。但对 P5 驱动/tester 是真实陷阱：任何“snapshot → restore →
继续给建议”的用法都会绕过 single-pending。
建议（1 处，约 3 行）：`restore()` 里对 `frame.sim.pendingCommands` 复用 `fromSimulationState` 的
`findRestoredSignal` 逻辑重建保守守卫（`restored:true, proposalId:null`）。

### R2（LOW，既有）`fromFrame()` 没有 `echoController` → `echoPendingLocal` 抛错
`HeadlessWorld.fromFrame` 用 `Object.create` 绕过字段初始化，且未像 `fromSimulationState` 那样补
`(world as any).echoController = new EchoController()`。我的探针直接读到：

```
Cannot read properties of undefined (reading 'restoredPendingKind')   （worldHeadless.ts:582）
```

基座 `3819621` 同样缺这行（`git show 3819621:src/ai-native/worldHeadless.ts` 的 `fromFrame` 无 `echoController`），
**非 v2 引入**；`routeState` 不受影响，所以 demo 路线回放能跑，但任何在 `fromFrame` 世界上读 echo 守卫的代码会崩。
建议同样一行补上。

### R3（INFO，版本漂移）`sim.authored` 与 `World.p1Scenario` 可能不同源
World 渲染用的是自己重建的 `p1Scenario`，而 `sim.authored` 在恢复后会变成 checkpoint 里保存的那份；
同一版本下两者由同一 builder 确定性生成、必然一致，但**跨版本**（保存时的构建算法不同）就可能分叉，
于是“渲染路线目标”与“headless/身份路线目标”不同。属版本兼容问题，不是 v2 缺陷；若将来要长期存档，
建议 World 恢复时优先采用 `sim.authored` 或断言两者相等。

## 5. 指标与文档口径核对（Lead 指定逐项）

| 要求 | 实际 | 判定 |
|---|---|---|
| 仅 Headless 投影 | 驱动写 `completedKind: 'headless-route-projection'`；文档明写“3 seeds 只在 Headless 路线投影，Rendered 只 1 seed” | PASS |
| 同一脚本 125 wait 扣除 | 驱动有 `scriptedRejectHoldTicks` 与 `ticksExcludingScriptedHold`；文档写明“≈128 tick 差来自脚本 125 tick 等待，扣掉后 ECHO ≈ HumanOnly+3” | PASS |
| net energy 不冒 actual cost | 字段改名 `netEnergyChangePlayer/Echo`，另有 `actualScanCost`/`actualJamCost`；文档写明“旧 energySpentEcho 是净差，真成本看 actualScanCost(10)/事件 100→90” | PASS |
| HumanOnly 无连接 ≠ 断线 | 驱动 `connectionState: 'no-echo-connection' \| 'echo-enabled-local'`，`offLineSimulated:false`；文档 T 列同样澄清 | PASS |
| P5 只有计划未实现 | `P5_VARIANTS_PLAN.md` 自述 plan only；`P4_TEST_AND_FINAL_LIMITS.md` 明确“P4 无新敌/资源变体” | PASS |
| rendered Jam 新断言是净差容差、不是精确 25 | `p4-demo.p4.spec.ts:317-325` 断言 `jamCost ∈ [JAM_COST-2, JAM_COST]`（23–25）；文档 T6 同步写“rendered run (v2 adds the cost)”，并注明 exact 25 由 tester 用真实事件断言 | PASS（口径正确，未被冒称精确 25） |

三个文档（`COOP_LEVEL_DESIGN.P4-UPDATE.md` / `P5_VARIANTS_PLAN.md` / `P4_TEST_AND_FINAL_LIMITS.md`）
hash 与 manifest 一致，内容与代码行为对得上；我按要求把它们视为**真实草稿**，最终集成由 Lead 决定。

## 6. 判定与建议

- **v2 增量：F1 CLOSED，F2 CLOSED**，且不是“放宽断言换取通过”：F1 用“地图字节不变”作为硬断言，
  F2 用 17 种坏形状 + fail-closed + 活世界不变 + 旧帧兼容四条线共同证明。
- **我的 gate 全绿**：typecheck 0、54/54 源测试、我的探针里 F1/F2 相关 5 项全过。
- **冻结完整性**：审查期间 HEAD `3819621`、12 个交付文件 hash 全部未变；v1 冻结件未被覆盖。
- **建议本地集成**：可以。集成前只建议处理 **R1**（frame `restore()` 守卫重建，3 行）与顺手 **R2**
  （`fromFrame` 补 `echoController` 一行）；两者都是既有缺口、不影响 v2 判定，但会直接影响 P5 驱动/tester
  若用“snapshot → restore → 继续建议”的话。
- **口径必须保持**：Headless 通关是投影级；3 seeds 非 Rendered；0 伤害不是平衡样本；`HumanOnly` 是无连接样本
  而非断线测试；ECHO 确认是 fixture 不是真人；旧 `>JAM_RANGE` 断言由 tester 改写。
- **整体 GAMEPLAY 仍不是 PASS**：P5（新敌/资源变体、对照指标、正式 3-seed Rendered）与真人验收开放。

## 7. 本轮未验证

- 完整 818 单测、全量 E2E（含 v2 的 rendered spec）、`npm run build` —— 按 Lead 指示交给 tester 正式全链。
- 渲染层行为：v2 未改任何渲染源（`World.ts`/`GameScene` 与 v1 同字节），故未重跑浏览器；门位 Jam 成本仍以
  我 v1 审查的实测（delta 24）与开发者 v2 新断言为准。
- 我的探针中“frame restore 守卫丢失”是**故意失败**的那一条，用于固定证据；它不是产品测试，不进仓库。
