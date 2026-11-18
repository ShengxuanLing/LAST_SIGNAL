# GAMEPLAY-01 · P4 recovery 冻结候选 · 独立最终审查

审查者：独立只读。日期：2026-11-18。范围：**P4 recovery 冻结候选的工程验收**，不代替 P4/P5/整体 GAMEPLAY
通过，不含真人验收（`HUMAN ACCEPTANCE PENDING`）。无模型调用、无 `src/`/`tests/` 修改、未 commit/push。

## 0. 固定输入与来源（先核字节，再谈结论）

| 项 | 值 |
|---|---|
| 候选工作树 | `D:\Project\LAST_SIGNAL\.cindy-worktrees\serene-leakey`，branch `cindy/serene-leakey` |
| HEAD | `3819621c5faab56b114b6e5a560f8fe78c17709d`，`commitsMadeByThisWorker: 0`（与主仓 feat 分支同 HEAD） |
| manifest | `…\reports\gameplay-01\developer\p4-recovery\manifest.json`（UTF-8，`freeze.state = FROZEN for independent Reviewer/Tester`） |
| 交付白名单 7 文件 | 我逐一对 manifest 的 sha256 与工作树实际字节：**7/7 完全一致**（下表） |
| 我的快照 | `git archive 3819621` + 7 个交付字节 → `D:\tmp\gp01-p4f`；`node_modules` 为只读 junction |
| 端口 | 我自己的 **5495**（未用 tester 5199/5492、开发 5471）；审查结束已关 |
| 主仓四 dirty | 未使用、未改动（候选工作树是独立 worktree） |
| 源 freeze | 审查期间 7 文件 hash 未变，我也未热读任何后续修订 |

| 文件 | manifest sha256（前16） | 我实测 | 结论 |
|---|---|---|---|
| `src/world/sim/core.ts` | `f71523e1ccd04828` | `f71523e1ccd04828` | PASS |
| `src/config/p1Scenario.ts` | `799f0dddf750f51d` | `799f0dddf750f51d` | PASS |
| `src/ai-native/worldHeadless.ts` | `0df873b40bdcbace` | `0df873b40bdcbace` | PASS |
| `src/world/World.ts` | `3ff4f7e3ad7310d8` | `3ff4f7e3ad7310d8` | PASS |
| `src/signal/relay.ts` | `6fc7ba4028812b65` | `6fc7ba4028812b65` | PASS |
| `src/signal/relayRoutes.test.ts` | `097bfc6f64346c07` | `097bfc6f64346c07` | PASS |
| `src/ai-native/worldHeadlessDemoRoute.test.ts` | `11c812f737e31183` | `11c812f737e31183` | PASS |

manifest 自述：四个 P4 候选文件是“从主仓工作树拷入的输入 patch，来源未验证，hash 是实际使用字节的指纹”。
本审查同样**不把 provenance 当成作者权威**，只看这 7 份字节的行为与边界。

## 1. Gate（命令 → 结果 → 绝对日志）

| gate | 命令 | 结果 | 日志 |
|---|---|---|---|
| typecheck | `npx tsc --noEmit`（我，快照内） | **PASS 0 `error TS`**, TSC_EXIT=0 | `D:\Project\LAST_SIGNAL\reports\gameplay-01\reviewer\p4f-typecheck.log` |
| 新增源测试 | `npx vitest run src/signal/relayRoutes.test.ts src/ai-native/worldHeadlessDemoRoute.test.ts` | **PASS 26/26（2 文件）** | `…\reviewer\p4f-26tests.log` |
| Owner / P2 / headless / checkpoint / core 边界 | `npx vitest run` ownerAuth, echoCoop, worldHeadlessEchoCoop, coop, control, runtime, canonicalStability, runCheckpoint, core, rules, echoRoomTransition, signalState, parity | **PASS 186/186（13 文件）** | `…\reviewer\p4f-boundary.log` |
| 我的 headless 探针（9 项） | `npx vitest run src/reviewer/p4f-probe.test.ts`（仅我的快照） | **PASS 9/9** | `…\reviewer\p4f-headless-probe.log` |
| 我的浏览器探针（门位 Jam 成本） | `PORT=5495 npx playwright test -c _review-p4f.config.ts` | **PASS 1/1（13.2s）** | `…\reviewer\p4f-rendered-probe.log`；数据 `…\reviewer\p4f-rendered\p4f-door-jam-cost.json`，图 `…\p4f-rendered\p4f-door-jam-cost.png` |
| 开发者自测（抽查核对） | typecheck / 26 测试 / build / mcp-surface / rendered 2 条 | 均 PASS，日志在 `…\p4-recovery\gates\*.log.txt` | 我只作交叉核对，未把自测当独立证据 |

未重跑：完整 818 单测、全量 E2E（Lead 指定 tester 负责）。

## 2. 我上一轮 P4_PRE_REVIEW 的 M1/M2/M3/M5/M7 —— 逐条闭环判定

### M1（清除状态两套真相）→ **CLOSED**
- 核心现在是唯一权威：`core.ts:1405 commitAuthoredRoomClear()`，在 `stepSimulationTicks` 的 tick 末尾调用
  （`core.ts:1386`）。四个前置：`authored` 存在、`room.spawned`、**无 pending `room-enter`**、房间内无活 drone、
  无活 target 落在房间 bounds 内；写完 `map.rooms[id].cleared = true` 并推 `room-cleared` 事件，且由
  `if (room.cleared) return` 保证**恰好一次**。
- 我实测（3 个 seed，fixture 杀 authored 哨兵）：提交 tick 上 `room-cleared` **恰好 1 次**，后续 60 tick **0 次**，
  `map.rooms[roomId].cleared === true`，`routeState.roomCleared === true`。
  可达的三个闸门单独验证：未 spawned → 不清；活 drone → 不清；房间内活 target → 不清（全部 `cleared:false, events:0`）。
- World 只响应不另清：`World.ts:2061 case 'room-cleared'` → clearRoomSeal / 作者门户 / `onRoomCleared`，
  **不写 flag**。旧 `updateRoom` 清房块（`World.ts:1187-1205`）仍存在，但 `!r.cleared` 使其在作者房间永远跳过；
  调用顺序已核：`stepSimulationTicks`（核心提交）→ `applySimEvents`（响应）→ `updateLegacy/updateRoom`，
  所以渲染侧**一次提交、一次回调**。
- Headless 读同一 flag：`worldHeadless.ts:393 routeState` 用 `room.spawned && room.cleared`，不再数 drones。
- 真实运行也印证：`runs/20261117-human-echo.json` 的事件直方图 `"room-cleared": 1`（真实 runSteps 打出来的）。

### M2（headless 无 route 身份 / 不随快照恢复）→ **CLOSED**
- 作者身份进了**核心状态**：`SimulationState.authored`（`core.ts:183` 区间，`SimAuthoredScene`），并入
  `canonicalSimulationState`（`core.ts:1474` 区间）。
- 我的探针在一次真实 clear 后，对 **snapshot → restore / fromFrame / fromSimulationState** 四条路径同时比对：
  `roomCleared`、`target`、`portal` 与活世界**逐字段相同**；`identity.startRoomId` 三条恢复路径均为 `0`，
  与新建 demo 一致（M5 同源问题一并解决）。
- `replay(frame, steps)`：`ok/sameState/sameEvents` 全 `true`（`authored` 在 frame 里）。
- Player 面不泄漏：`observation()` 的 JSON 中既无 `authored` 也无 `routes`（实测 `hasAuthored:false`）；
  `routeState` / `demoScenario` 只被新测试与开发者驱动使用，未进任何 Player 工具或观察投影。

### M3（静默 fallback：叠格 / 墙内伪成功）→ **CLOSED**
- `p1Scenario.ts`：`closestWalkable` 现在返回 `Vec2 | null`，`sentrySpots` / `relaySpot` 也返回 `null`；
  `buildP1Scenario` 在任一步为 null 时整体返回 `null`，并额外做**互异性**校验：
  `ROUTE_CELL_SEPARATION 1.5`（两条路线门户不得同格）、`DEVICE_PLAYER_SEPARATION 1.5`（设备≠玩家起点）、
  `SENTRY_SEPARATION 2`（两只哨兵不叠）。墙内/同格伪成功不再可能。
- 但仍有一个**残留**（见 §4 F1）：null 失败时地图已被半突变。

### M5（`rooms[0]` 硬编码 / start kind 被抹掉后 identity 为 null）→ **CLOSED**
- `buildP1Scenario` 先按 `kind === 'start'` 找房（fail 才退 `rooms[0]`），并在 `kind` 改动**之前**捕获
  `startRoomId`；`World`（`World.ts:640` 区间）与 `Headless`（`worldHeadless.ts:342` 区间）都把它写进 `sim.authored`。
- `HeadlessWorld.fromSimulationState` 现在优先用 `sim.authored.startRoomId`（`worldHeadless.ts:882`），
  不再依赖已被改成 `combat` 的 kind；我实测 fresh/restore/fromFrame/fromState 四者 `startRoomId` 全部为 `0`。

### M7（门户贴图与交互点半格偏移）→ **CLOSED**
- `makePortal(target, center)` 现在只接受**格中心**（`World.ts:1399`），贴图/标签/光晕/交互点 `wx,Sy` 同一个点。
- 所有 legacy 调用都显式转中心：`cellCentre()`（`World.ts:1422`）包住 `findWalkableInRoom()` 与
  `placePortalForTarget()` 的整数格坐标；我核过 `findWalkableInRoom` 返回确为整数格（`World.ts:1461-1475`），
  因此**没有二次 +0.5**。作者路线直接传 `route.portal`（本来就是中心）。
- 渲染实测：作者门户 `{x:11.5,y:49.5}` 与路线门户完全相等，交互点/贴图一致（我的浏览器探针也站到了
  `dist 0.13` 的同一点上并按 Y 成功 Jam）。

## 3. 其余指定检查

| 检查 | 结论 | 依据 |
|---|---|---|
| 清除提交的前置条件 | PASS | 见 M1；`pending room-enter` 闸门在当前 tick 顺序下**不可达**（`processCommands` 在提交前已消费该命令），属防御性代码，我未能构造出触发（记录为防御性，不计为已验证行为） |
| World 不另清 / 不重复回调 | PASS | §2 M1；顺序与 `!r.cleared` 双重保证 |
| 非 demo 行为不变 | PASS | 探针：普通世界无 `authored`、无 `room-cleared`、canonical 无 `authored` 键；186 条边界测试（含 `parity.test.ts`）全绿 |
| 作者数据在 5 条路径留存 + 边界校验 | **部分 FAIL** | 5 条路径留存 PASS；`isHeadlessFrame` 不校验 `authored` → 外来 frame 可注入坏 `routes` 并在 `routeState` 抛错（F2） |
| P2 exact queue / unknown restored guard 不退化 | PASS | 探针：demo 上 confirm 后 queue `['signal-scan']` 恰好 1，`fromSimulationState` 后 queue 完全一致，guard `{restored:true, proposalId:null}`，旧 id 与任意新 id 均被拒，busy 期间不出新提案 |
| World 恢复作者门户 derive 真实 relay | PASS | `World.ts:2494` 区间：作者房间恢复时 `lastP1RouteTarget=-1 → updateP1RoutePortal()`，不继承 `portalTarget`；渲染证据 `rendered-restore`：saved==restored==作者格，`authored` 存活，`startRoomId 0` |
| 布局 null 失败不残留半突变 | **FAIL** | 见 F1 |
| `startRoomId` 与 identity 正确 | PASS | 见 M5 |
| `makePortal` 中心坐标 + 所有 legacy 调用 | PASS | 见 M7 |
| 权限/Owner/epoch 不变 | PASS | 7 文件 diff 中无 owner/permission/epoch/queue 规则改动；`ownerAuth`/`control`/`runtime` 测试全绿 |
| RunCheckpoint 字段不变 | PASS | `src/systems/RunCheckpoint.ts` 不在白名单、未被改；`runCheckpoint.test.ts` 绿 |

## 4. 新发现（本轮实测，均有日志）

### F1（MEDIUM，需修）布局 null 失败会留下半突变地图
`p1Scenario.ts:185-189` 先写 `connectedTo` 两条边并 `room.kind='combat'`，之后才做
`closestWalkable/relaySpot/sentrySpots` 的 null 判定（`:191` 起）。我构造“房间只容得下 1 格”的探针，结果：

```
scenario: null
before: { kind: 'start', connectedTo: [3] }
after : { kind: 'combat', connectedTo: [3,1,2] }   mutated: true
```

Headless 走 `throw`（世界被丢弃，无害）；但 **Rendered World 会保留这张被改过的地图**（`World.ts:620` 区间
返回 false，只设 `p1ScenarioError`），于是 start 房变成未 spawned、未 cleared 的 `combat` 房，房间图也被改。
修法：把布局计算与地图突变拆开（先全算完，再一次性写入），或失败时回滚 `kind/connectedTo` 三项。

### F2（LOW-MEDIUM）`isHeadlessFrame` 不校验 `authored`，坏 frame 会让 `routeState` 抛错
`worldHeadless.ts:1173 isHeadlessFrame` 只校验 schema/version/tick/seed/rng/pending/purchase/drones/
projectiles/map.rooms/events/actionLog/enteredRooms/epoch/status/mapIdentity。我的探针把一个合法 frame 的
`sim.authored.routes` 改成对象：

```
accepted: true            // isHeadlessFrame 接受
routeThrew: "routes.find is not a function"   // routeState 抛错
```

Owner 恢复出来的世界在调用 `routeState` 时崩（测试/驱动会先中招；Player 工具目前不暴露 routeState，所以
不是 Player 泄漏）。修法：在 `isHeadlessFrame` 里对 `authored` 做有界结构校验（id/roomId/startRoomId 为数字、
`routes` 数组且 ≤2、`target` 数字、`when` 枚举），或在 `routeState` 里容错。

### F3（LOW，已被我补测）开发者的 Rendered 证据没有断言“门位 Jam 成本”
`rendered/p4-demo.p4.spec.ts` 只断 `relay JAMMED / target null / portal null / cleared 保持 / F 不改房间 /
expiry 恢复 / F 进入 / 保存重载`，成本只体现为顺带记录的 `energy: 77`。我用独立浏览器探针补齐：
真实走到作者门位（`dist 0.13`，与 relay 相距 1 格），按 **Y**：

```
before { energy: 100, relay: 'ACTIVE', routeTarget: 1 }
after  { energy: 76,  relay: 'JAMMED', routeTarget: null }
delta 24  (= JAM_COST 25 − 1 点回气)
```

→ 门位 Jam 的真实成本成立、路线目标随即关闭。数据 `…\reviewer\p4f-rendered\p4f-door-jam-cost.json`。
建议 tester/P5 把这条成本断言并入正式 E2E（我这条只是审查探针）。

### F4（LOW）Headless 的 `completed` 仍是投影级
驱动以 `world.routeState.completed` 收尾（`driver/demoRun.mts:299-305`），Headless 没有房间切换；
真实切换只在 Rendered 的 **单 seed**（20261117）上被证明（`rendered-route-entry`：room 0 → 1）。
因此“3 seeds 通关”是 **Headless 投影级** 结论，不得表述成“3 seeds 在渲染世界里通关”。
另：`interact` 在 Headless 里只是被 tick 消费，不构成门户入口证据。

### F5（LOW，指标口径）12 条 headless 全 0 伤害，且 ECHO 变体被脚本冷却拖长
- 12 条：`damageTaken` 全部为 0、`kills` 全 2、`hp` 100→100；而 Rendered 那条真实战斗是 100→94（6 点伤害）。
  说明 Headless 自动驾驶“远程点杀”根本不吃伤害，**不是平衡样本**。
- `human-echo` 比 `human-only` 多约 128 tick（238 vs 110），来源是脚本里“拒绝后硬等 125 tick”
  （`driver/demoRun.mts:207`），不是 ECHO 的代价。报告已如实写明“ECHO 并没有更好”，但读数字时不能把
  tick 差当成协作成本。
- `signal.energySpentEcho` 是**净差值**（例：6），真实扫描成本要看
  `proposals.lastAcceptToEffectDetail.echoEnergyBefore/After = 100 → 90`（= SCAN_COST 10）。两者不要混用。

### F6（LOW，P5 缺口）没有新增敌人/资源变体
`buildP1Scenario` 只挑既有 `kind` 的房间与 2 只既有 `drone`，没有新敌种、新资源配比；开发者报告也写
“partially”。按 Lead 要求列入 P5 缺口，不作为 P4 缺陷。

### F7（INFO，已裁决）旧 P1 门距断言仍会失败
`tests/gameplay-01.spec.ts:578`（属 `test('4) standing at the door: natural Y is range-rejected…')`）
仍断言 `distanceRelayDoor > JAM_RANGE`，而 P4 布局门距 = 1 格（开发者证据 `distanceRelayDoor: 1`，我也实测 1）。
按产品裁决：门边允许自然 Jam，改为“自然 Jam 阻断出口”，不挪门、不删 Jam 禁用安全语义——由 tester 执行。
开发者只跑了 `-g '1) real menu entry'`（未碰这条），**没有**偷偷改测试。

### F8（INFO，既有）`World.updateRoom` 的清房块仍是重复两份
`World.ts:1187-1205` 的 `r.cleared=true / clearRoomSeal / placePortal / onRoomCleared` 各写两次（P3 之前就在）。
作者房间因核心先提交而整体跳过，**P4 不触发**；但非 demo 房间仍会双回调，未来若把 P4 指标接到
`onRoomCleared` 上需要先修。不是本轮改动引入。

## 5. 证据审核（developer 的 12 headless + 2 rendered）

**12 条 headless（3 seed × {human-only, human-only-routeB, human-echo, human-echo-reject}）**

- 全部 `completed: true`，`kills 2`，`routeChosen` 与变体一致（A=ACTIVE / B=INACTIVE），`toggles 1`。
- `human-echo-reject`：`scans 0`、`energySpentEcho 0` → **拒绝链真无执行**（不是“拒了但还是打了”）。
- `human-echo`：`scans 1`、接受效果落在**下一 tick**（`lastAcceptToEffectTicks 1`）、
  `relayBefore==relayAfter`（扫描不改 relay，符合规则）、`evidence 1`、echo 能量 100→90 → 真实。
- `offLineSimulated: false` 且 `human-only` 从未调用 `enableEcho` → **这是“无连接样本”，不是断线测试**；
  报告也如此表述。真正的断线/离线路径不在本候选证据里。
- 标注诚实：`NON-BLIND`（自动驾驶读 canonical 坐标，不是感知/不是人）、`OWNER FIXTURE`
  （`confirmLocalEchoProposal(id, true)`，≠真人）、无 clear/teleport/heal。
- 恢复面：每条 run 都带 snapshot→restore→fromSimulationState，`restoreOk true`、
  `routeIdentityEqual true`、`fromSimulationStateStartRoomId == freshStartRoomId`。

**2 条 rendered（单 seed 20261117）**

- A：菜单进入无 fallback、作者场景含 `startRoomId`、relay ACTIVE+linked fire、初始未清无门户、
  真实 3 发清房、`room.cleared true`、门户=作者格、JAM 后 `target/portal null` 且 `cleared` 保持、
  JAM 时 F 不改房间、expiry 恢复、F 进入 route target。
- B：reload + CONTINUE → 清房状态与作者门户“重新推导后”与保存值相等、`authored` 存活、`startRoomId 0`。
- 截图 7 张（`rendered/shots/p4-1..7`），JSON 9 条记录；证据链完整。
- 局限（报告自己也承认）：**只有 1 个 seed 的 Rendered 证据**，不能外推 3 seeds；F blocked 在门户为 null 时
  本来就是 no-op，属“间接证明”。

## 6. 判定

- **P4 recovery 工程质量：PASS（局部）**。我在自己的树、哈希一致的 7 份字节上复现了：typecheck 0、
  26 条新源测试、186 条边界测试、9 项 headless 探针、1 条浏览器探针；M1/M2/M3/M5/M7 全部闭环，
  非 demo 行为与 P2 队列/守卫未退化，权限未变。
- **不通过项（提交前应修或明确接受）**：
  1. **F1** 布局 null 失败留下半突变地图（Rendered 侧）——一行级重构可解决，建议修。
  2. **F2** `isHeadlessFrame` 不校验 `authored`，坏 frame 令 `routeState` 抛错——建议加有界校验。
  3. F3 门位 Jam 成本目前只有我的审查探针，正式 E2E 还没断言（tester 侧补）。
- **口径必须保持**：Headless 通关是投影级、3 seeds 只有 Headless；Rendered 只 1 seed；12 条全 0 伤害不是平衡
  结论；`HumanOnly` ≠ 断线测试；ECHO 确认是 fixture，不是真人。旧 P1 门距断言（F7）由 tester 改写，
  不要求恢复 `>6`。
- **整体 GAMEPLAY 不是 PASS**：P5（新敌/资源变体、对比指标、正式 3-seed Rendered）、真人验收仍开放。

## 7. 本轮未验证

- 完整 818 单测、全量 E2E、`npm run build`（我未重跑；只核了开发者日志 PASS）。
- 3 seeds 的 Rendered 通关、真人操作、断线/离线路径、P5 平衡结论。
- 开发者 12 条 headless 的驱动我只读代码与 JSON，未重跑其脚本（我的 9 项探针覆盖同一批边界）。
- 除 5495 探针外无第二次浏览器运行；`rendered/shots` 与我的 `p4f-rendered` 未逐像素比对。
