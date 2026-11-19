# 246469b 现场修复最小补丁 — 独立复核

- 被测：`246469b7d7e82bb469f62f80f293b0702af46588`（父 `363eb173207bb5adaa0a21cd1af348dc92f29827`，已解析完整 hash）
- 隔离：`git archive 246469b` → `D:\review-fix\snap`，**2043 tracked 文件**；`git ls-tree -r 246469b`（blob sha1/路径）vs 快照内 `git hash-object` 全量比对 → **diff 0 行**
- 复核者：独立 worker `mmxu9qr3pny4jua138sycuoq`；只读冻结源码 + 只读证据；自有 dev `strictPort 5372`（用完仅关自己的进程，5173 等他人端口未动）；secret 零日志；未改源码/测试/配置/分支，未 merge/push/reset/rebase，未读 WIP/stash，未覆盖任何原有证据目录
- 逐门一行见 `GATES.md`；日志在 `…\reviewer\signal-field-fix\logs\`

## 结论（一句话）

**246469b 不能整体放行。** 三类修复本身经我独立复核通过（echo 同 tick 跨房迁移 + 本地 assist/记忆/意图清理、memory 真实分型、availableActions 的 energy/CD/严格半径与 relay 主体）；**第四类“跨房旧建议失效”未修**：World 只清了本地 `EchoController` 与 `pendingCompanionIntent`，**没有通知 bridge 的 `CompanionGateway`/`Facet` 作废旧房未确认建议**。我用两条独立证据确认了这个缺口（见下节）。**新修复需新 hash 再验，我不为任何未冻结 hash 背书。**

## 跨房旧建议缺口（阻断项）— 我的独立定界

**机制（冻结源码逐点）**
1. 过门时 `World.tryInteract` 的 portal 分支只做三件事：`echoController.clearForRoomTransition()`、`pendingCompanionIntent = null`、`enqueueTeleport(..., migrateEcho=true)`（`src/world/World.ts:946-952`）。它**没有**触碰 `companionLink`（浏览器侧）或任何 gateway 路由。
2. 建议本体存在 **bridge 进程**的 `CompanionGateway → CompanionFacet.suggestions` 里，只有四种作废路径：`setLink(!connected)`、`setOwnerMode(!human)`、stale-epoch reauthorize、TTL 过期（`companionFacet.ts:468-490` 与 `companionGateway.ts:96-112/272-282`）。**房间切换不在其中，epoch 也不变。**
3. `CompanionGateway.decide()` 只校验 session/epoch、是否仍 pending（含 TTL）、是否已决策（`companionGateway.ts:226-250`）——**从不把建议的 `reason` 重新对照“当前观察”**。
4. 浏览器 `CompanionLink.decide()` 拿到 ok 后直接 `config.apply(kind, target, id)` → `World.enqueueCompanionAction`（`GameScene.ts:930-936`），同样不做观察校验。
5. 因此：旧房未确认建议在新房仍出现在 `pending`，Owner 一点 `CONFIRM FIRST PROPOSAL (OWNER)` 就会以**旧房坐标/旧房语义**入队并提交真实 core 命令。

**证据 A（我自己的 Node 级机制证明，可重复）** `logs\probe-cross-room-stale-nodelevel.log`（源码 `crossRoomStale.probe.test.ts`）
- 推 room A 观察（`relay_main` 在 1 格外、`objectiveBlocked=true`）→ `echo_suggest(scan, perceived_relay)` 成功；
- 再推“迁移后”观察（echo 到 (27.2,43.7)、player (115,44)、**无 relay 字段**）→ `pushObservation` ok，且新的 `availableActions.scan.reason = 'out_of_range'`（**说明第三类修复是对的**）；
- 旧建议仍在 `pending`；`decide(confirm, tick=140)` **返回 ok，`decidedAtTick=140`**。
- 结论：缺口是 gateway 层语义，不是 UI 层偶发。

**证据 B（Tester 的真实浏览器链，我核对了原始 json/log）** `reports/ai-native-02/tester/signal-field-fix/11-cross-room-suggestion.json` + `12-cross-room-suggestion.log`
- X03 room A `echo_suggest{kind:'fire', target:{10,45}}` 未确认 → X04 `pending` 含 `sug_d302…` → X05 真实 portal `roomA 0 → roomB 3` → X06 过门后 `pendingAfter` **仍含同一 id** → X07 Owner 真实确认 `decided=true`，下一 tick `projectiles=1`、echo 位移到 `(25.88,46.36)`、`roomId=3`、`staleApplied=true`。
- 我核对了这 7 条的判定与数值，与我的机制结论一致。

**严重度定界（不夸大）**
- **不**绕过 Owner 授权、**不**泄漏隐藏状态、**不**破门控、**不**是 agent 自我确认：确认仍是浏览器侧 ownerCap + 真实 UI 点击。
- 影响是“跨房后仍可确认旧房建议并按旧房语义执行”：`fire/move/aim` → 朝旧坐标做一次真实动作；`scan/jam` → 扣 echo 真能量（scan 在新房 `found=false`）；`toggle-relay` → **可能把 ACTIVE 翻成 INACTIVE，使新房出口重新锁上**（代码推断：`enqueueCompanionAction('toggle-relay')` → `enabled:!manualEnabled` → `currentRelayState` 非 ACTIVE → `exitOpen=false`；我**未**实跑这一条，属推断）。
- 可恢复：玩家按 `R` 即可手动 toggle（`GameScene.ts:433`，只要求 `sim.signal` 存在，不限房间）；TTL 上限 600 tick（10s，默认 120 tick）会把窗口自然关闭。所以是**必须修的正确性/授权时效缺陷**，不是硬锁死。
- 与源码注释的关系：`World.ts:945-949` 注释说“armed assist + pending companion intent + echo memory are dropped”，字面准确（指本地字段），但容易被读成“Companion 权威已清”。**建议**：注释显式说明“bridge 侧未确认建议不在本次清理范围（已知缺口）”，或在同一处补作废调用。

**最小修复建议（供开发者参考，我不改代码）**
- 首选：过门时由浏览器调用一个新的“作废旧建议”语义（或 `companion-mode` 往返 `human→human` 不可行，需要新路由），并让 `decide()` 对 `suggestion.createdAtTick` 与当前 `lastObservation.tick` / 房号/epoch 世代绑定；
- 仅靠 `reasonObserved(reason, 最新观察)` 重新校验**不够**：`perceived_hostile` 在新房若仍有敌人会照样通过（旧坐标的 `fire` 仍会被放行），所以必须做“房间/世代”级别的作废，而不是只重算 reason。

## 其余修复项的独立结论

### 1) echo 同 tick 跨房迁移（PASS，含负向）
- 命令契约：`teleport-player` 新增**可选** `migrateEcho?: boolean`；`World.enqueueTeleport(x,y,healToFull,migrateEcho=false)`（`World.ts:1142`）。全仓仅 3 处产生该命令：`Player.ensureWalkable`（false）、`Player.reset`（false）、真实 portal（`true,true`，`World.ts:952`）——**无 flag 不搬**成立。
- 同 tick 可行走邻位：`ensureWalkableFromState(state, {x: recovered.x+1, y: recovered.y})`（`core.ts:596`），走 `isWalkableFromState`（wall/lava/water 四点采样、半径 0.5），确定性螺旋回退，**无 RNG**；地图是全局网格（`state.map` + `mapMinX/mapMinY`），所以目标房坐标已可判定，不存在“用旧房 tile 判新房”的时序陷阱。
- 事件：`echo-moved{actorId, position, velocity, dashTimer, dashStarted}`，与 `SimEvent` 联合类型逐字段一致（`core.ts:192`）。
- 负向/边界（我的独立判断 + 部分自测）：`state.echo` 不存在或 `data.hp<=0` 时**不迁移、不发事件**（`&&` 短路，`core.ts:595`）——**冻结提交没有为这两种情况写单测**（`echoRoomTransition.test.ts` 只有 flag/负控/确定性 3 例），属于覆盖缺口而非行为缺陷；`hold` 模式在 rendered spec 的负向例里被使用（`echo-portal-migration.spec.ts:130`）。
- 确定性：我复核到 `canonicalSimulationState` 不含 `pendingCommands`，故新增可选字段不影响跨端 canonical；该文件的 3/3 单测通过，其中“同 state+同命令→同 canonical”是逐字节断言。

### 2) 本地权威清理（PASS，范围有限）
`EchoController.clearForRoomTransition()`（`echo.ts:130-138`）：清 `assistConfirmed`、`suggestion`、`memory`、`lastIntent`、`moveTarget`，并把 `move-to` 归一到 `follow`，**保留人类选的 hold/follow**（与注释一致）。World 在 portal 分支同一处调用，并清 `pendingCompanionIntent`。**它不清** bridge 侧未确认建议——即上面的阻断项。

### 3) memory 分型（PASS）
`companionFacet.ts:522-528`：drone→`'drone'`，裁剪 target→**`'target'`**（id 仍 `target_<id>_<kind>`），relay→`'relay'`；类型 `CompanionMemoryEntry.kind` 扩为 `'drone'|'relay'|'target'`。原先编码 bug 的那条断言已改正（`companionFacet.test.ts:79`）。`companionInsights.test.ts:46-57` 断言“只有一个 relay 条目且是 `relay_main`”。**真正修掉了**（不只是改注释）。

### 4) availableActions（PASS，含一处措辞级残留）
- 严格半径：scan `< COMPANION_LIMITS.PERCEPTION_TILES`（= `ECHO_LIMITS.perceptionTiles` = 12）与核心 `SCAN_RADIUS=12` 的 `withinSignalRange` 同为严格 `<`；jam `< 6` 与 `JAM_RANGE=6` 一致。
- energy/CD：`scanTicks>0 → 'cooldown'`、`energy < SCAN_COST(10) → 'insufficient_energy'`，与 `scanBlocker` 的判定顺序/阈值一致；jam 同理用 `JAM_COST(25)`、`jamTicks>0`。
- relay 作为合法主体：`inScanRange = hostile<12 || relay<12`；relay 距 echo 2 格时不再误报 `out_of_range`（这直接修掉 Lead 现场看到的 `availableActions.scan=true` + `scanCD=18` 矛盾）。
- 旧观测兼容：`energy/cooldowns/relay` 都是可选；缺失时退回“只看距离”的旧行为（`companionInsights.test.ts:150-155` 断言）。
- 残留（非阻断）：① `availableActions.reason` 的取值域（`out_of_range/cooldown/insufficient_energy/perceived_relay/perceived_target/in_jam_range`）**不等于** `echo_suggest.reason` 的枚举（`perceived_hostile|perceived_relay|no_perceived_target|objective_blocked`），模型若照抄会被 `E_SCHEMA reason_invalid` 拒；② 核心允许“空扫描”（照扣 10），而 hint 在“无任何 subject”时给 `available:false`——比核心更严，属产品口径选择，不会造成“提示可用但核心拒绝”；③ jam 处于 `jamRemainingTicks>0` 时核心是 `E_RETRYABLE`，hint 给 `cooldown`（`available:false` 正确，仅理由措辞不同，因 `jamRemainingTicks` 未进观察）。

### 5) 残敌分类（PASS，分类正确）
`targetRemoval.test.ts` 证明：**真实死亡（hp<=0）由下一 core tick 从 `state.targets` 移除**（产品行为），**活着的 target 不会被移除**——所以 Lead 现场看到的 3 个 `hp=59` 残敌是“只清了渲染层”的夹具残留。修好的 run helper 同时清渲染+canonical，属**夹具改进**，不作为战斗证明。分类（三真产品问题 + 一夹具问题）**核实成立**：真产品问题 = 迁移/记忆分型/可用性；夹具问题 = 残敌。

## 设备是否留原房：是设计，不是缺陷（但必须写清后果）

- 冻结源码里没有任何迁移 `state.signal` 的代码；`World` 的 `signalDeviceSpawned` 保证**一局一个设备**，`exitOpen` 只看该设备状态（全局），不看玩家所在房间。
- 因此跨房后：设备留在它的出生房；echo 已随玩家迁走 → 新房 `echo_observe` **不再包含 relay**（距离 ~88 格）→ `perceived_relay` 不再成立、`objectiveBlocked` 不再出现，`echo_suggest` 的 Signal 类建议在新房**无法再生**（这本身是诚实的裁剪，我上一轮已验证裁剪真实）。
- 但门控仍然工作（设备 ACTIVE 时任何门的出口都是开的），所以前向推进不受影响：Signal 协作在本设计下是**“一次房间内的机制”**，跨房后模型侧 Signal 能力自然消失。
- **注意**：正因为设备留原房，跨房 stale `toggle-relay` 的后果被放大——玩家在新房看不到设备 HUD 的现场感，只能靠阅读 HUD 文本或按 R 纠错（这条我标注为推断，未实跑）。

## 可放行 / 阻断 / 非阻断

**可放行（本轮独立复核 PASS，scope 限 246469b 的这三类修复）**
1. echo 与玩家**同 tick** 跨房迁移、落点为新房可行走邻位、发 `echo-moved`、无 flag 不搬、确定性；`hold` 不被改动。
2. 本地权威清理：assist / 旧记忆 / `pendingCompanionIntent` / `lastIntent` / `moveTarget`，`move-to`→`follow`。
3. memory 真实分型（target≠relay≠drone），原错误断言已改正。
4. `availableActions` 的严格半径/energy/CD 与核心一致，relay 为合法主体，旧观测兼容。
5. 残敌属夹具残留（真实死亡会被移除）。
6. 回归：新 unit 14/14、Owner/权限最小回归 45/45、新 portal E2E 2/2、合作链 10 步 1/1、SDK 矩阵 1/1、parity 新导出 1/1 + 重放 3/3、tsc 0、MCP 构建 0。

**阻断（必须修后才能整体放行）**
- **跨房旧建议仍可被 Owner 确认并执行**（我的 Node 探针 + Tester X07 双证）。风险面：`fire/move/aim` 旧坐标动作、`scan/jam` 白扣 echo 能量、`toggle-relay` 可能让新房出口重新上锁（推断未跑）。修好需新 hash，我再验。

**非阻断（记录，不阻断本次放行）**
1. 冻结提交内**没有** dead-echo / no-echo 的迁移负向单测（行为正确、覆盖缺失）。
2. `availableActions.reason` 词表 ≠ `echo_suggest.reason` 枚举（模型照抄会被拒）。
3. jam 在 `jamRemainingTicks>0` 时理由措辞 `cooldown` vs 核心 `E_RETRYABLE`。
4. `World.ts:945-949` 注释未点明“bridge 侧建议不在清理范围”，易误读。
5. 我的浏览器级跨房探针 **NOT RUN**（脚本 bug：授权后未关闭 Pause 就 `toggleRelay`，20s 超时；按指令不循环探针，机制证据已由 Node 探针 + Tester 浏览器证据覆盖）。

**未跑（按指令不重复无关全量）**：全量单测（Tester 报 727/727）、C2 resume/checkpoint、CD 恢复（Tester `probe-cd-recovery` 5/5）、截图逐张查看。

## 并发变更披露（我只报元数据，未读内容）

- 复核开始时（01:44 前后）：`git rev-parse HEAD` = `246469b…`，`git status --porcelain -uno` = **0 行**，所有门禁都在该状态 + `git archive` 快照上执行。
- 复核收束时（01:53）：`git status -uno` 显示 **5 个 tracked 文件被修改**（`companionFacet.ts`、`companionGateway.ts`、`companionLink.ts`、`worldBridgeServer.ts`、`GameScene.ts`）——正是跨房建议作废所需的文件面，应为开发者按 Lead 派单所做的最小修。
- 按边界：**我没有读这些未提交改动，也没有为任何新 hash 背书**；本报告全部结论只对 `246469b` 成立。新提交出现后需重新冻结 hash 再验（重点复验 #12/#13 那条负向）。

## 与 Tester 报告的差异

无实质冲突。Tester 的 X07 FAIL 与我的机制结论一致；我补充的是：① 缺口发生在 `CompanionGateway.decide()` 缺少“当前观察/房间世代”重校验，而不是 UI 或 core；② 新 `availableActions` 在**同一**场景下已经正确报 `out_of_range`，说明两类修复互不掩盖；③ 修复建议必须做房间/世代级作废，仅重算 `reasonObserved` 不足。
