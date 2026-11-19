# AI-NATIVE-02 Task C（Signal 最新阶段）— 独立复核 REVIEW-CONTINUATION

> 本文件是**接续复核**：原独立 reviewer 会话 `e64cb79a-82d3-4feb-9811-b99909fd8bf6` 因累计 input token 上限中断，其历史**未重试、未归档**；我从冻结 hash 重新起算，只做 Task C Signal 最新阶段审查，且**不采信任何口述结论与旧报告**（包括 `reports/ai-native-02/signal/REPORT-FINAL.md`、`reports/ai-native-02/reviewer/signal-scene2/`，两者仅作路标）。
> 逐门证据与命令见同目录 `GATES.md`；所有日志在 `…\signal-taskc-final\logs\`。

- 被测：`363eb173207bb5adaa0a21cd1af348dc92f29827`（分支 `feat/ai-native-world-integration`），增量范围 `5037c82 → 50e1ce8 → 4b2ab0d → 363eb17`
- 隔离：`git archive 363eb17` → `D:\review-tc-final\snap`，2039/2039 tracked blob 与提交逐一 `git hash-object` 相等（0 行 diff）；复核前后工作区 tracked 无漂移
- 端口：自有 `5173` 之外的 strictPort `5371`，未 kill 任何他人进程；未 merge/push/reset/worktree 变更；未读 WIP/stash
- 结论口径：**Signal 骨架（感知/权限/规则/真实 tick 提交/资源扣减/门控/跨端字节一致）本机独立复核 PASS；不宣布“Task C 完成”，不宣布“模型已完成 Signal 协作”，不宣布“真人验收通过”**

---

## 0. 独立复核矩阵（对应 Lead 的 5 条）

| # | Lead 要求 | 结论 | 依据（运行证据） |
|---|---|---|---|
| 1 | shared echoView relay 须 echo 自身 radius+explored+LOS 可感知；只公开 Signal / echo energy+CD / objectiveBlocked，不漏隐藏实体 | **PASS**（其中“无单元测试”是记录项） | 门禁 #10（我自写 7 条负向/正向探针）+ 代码只读审计 |
| 2 | Agent 仅 token/lease 的 observe/suggest/status/memory；Owner 独立 host 私钥握手 + cap 确认；Player v2 scan/jam 仅 `actor='player'`，`echo` → `E_PERMISSION` 且不扣费、不消费其他队列；v1 不静默重解；Owner 确认只入队下一正常 tick 恰一次，reject/duplicate/expired 不执行 | **PASS（渲染/桥接面）**；**headless 面有 1 处纵深防御缺口（不可达，非阻断）** | 门禁 #8（官方 SDK 矩阵）、#9（Owner 旧攻击回归 2 例）、#7（恰 1 条 toggle-relay 入队）+ 代码审计 `externalLinkController.ts:313-322`、`worldBridgeServer.ts:266-276/316/333`、`ownerAuth.test.ts` C1-C8 |
| 3 | 正式 Pause opt-in（默认无 relay）→ World 自生成设备 INACTIVE 挡门 → Companion 感知 relay + fixture 建议 → OwnerUI 确认 → ACTIVE 开门 → echo scan 独立扣能 → 实际 portal 下一房 → 观测/memory/receipts | **PASS**（receipts 内容与“下一房”由我补证） | 门禁 #7（10 个 STEP 真实 UI）+ #11（我自写探针：room `0→3→5` 具体房间）。receipts 账本本身只在单测覆盖（见限制） |
| 4 | `tests/signal-rendered-parity.spec.ts` 导出 initial/pending + 完整有序输入；`signalRenderedHeadlessParity.test.ts` 逐字节比 state+events、负向改 actor 分歧、缺文件必须红；不可两 Node 同 seed 冒充 | **PASS** | 门禁 #3（干净 archive 缺产物 → 3/3 红，证明门禁不空转）、#4（快照内真实浏览器重新导出）、#5（3/3 绿，字节相等）。我用**自己新导出的**三件套复核，不依赖开发者产物 |
| 5 | 独立隐藏 relay 负向、官方 SDK 原始 actor 伪造负向、Owner 旧攻击最小回归；判断是否允许 Lead 真实模型 Signal 回合 | **PASS**（前两项 3 由 #10/#8/#9 覆盖）；模型回合判断见第 6 节 | 同 #8/#9/#10 |

---

## 1. echo 侧 Signal 感知（点 1）

**一套投影、两处调用**：`src/world/echoView.ts#buildEchoObservation` 是唯一投影；`src/world/World.ts:257-283`（渲染）与 `src/ai-native/worldHeadless.ts:332-364`（headless）传入**同一份输入**（`deviceId/x/y/relay/powered/manualEnabled/jammedUntilTick`、`signal.actors.echo` 的 energy/cooldowns），因此不存在“两套规则”。

- 感知规则与 actor 完全一致：`Math.hypot < ECHO_LIMITS.perceptionTiles`（=12，严格小于）+ `gridLineOfSight`（`isExplored` + `isOpaque`）。`companionFacet` 的 `PERCEPTION_TILES` 也引用同一个 `ECHO_LIMITS.perceptionTiles`（12），无第二套常量。
- 输出形状仅 `relay: {id,x,y,state}` + `objectiveBlocked` + `energy` + `cooldowns`。`state` 是 HUD 已公开的中继状态；`powered`/`manualEnabled`/`jammedUntilTick` **不出现**在观察里（我的探针逐键断言，含 `JSON.stringify` 全文不含这些字段名）。
- `objectiveBlocked` 只在“真的感知到且 relay !== 'ACTIVE'”时出现；未被感知的设备不会把该标志带出来（探针覆盖）。
- `energy/cooldowns` 取自 `signal.actors.echo`，玩家账户不传导；`max` 用共享的 `SIGNAL_TUNING.ENERGY_MAX`。
- 上游还有第二道裁剪：`companionGateway.pushObservation` 顶层白名单（`relay/objectiveBlocked/energy/cooldowns` 在列）、`companionFacet.observe` 用 `isEchoObservation` 重新验证并**重建** relay（只保留 id/x/y/state），所以即使伪造观察也无法把隐藏字段带进来。

**记录项**：冻结提交里**没有**这条新投影的单元测试（`src/ai-native/echoView.test.ts` 对 `signal` 0 覆盖）。功能正确性由我的探针 `…\signal-taskc-final\echoViewSignal.probe.test.ts`（7/7）独立证明；建议后续把“隐藏 relay 负向”并入仓库测试。

## 2. 权限与提交语义（点 2）

- **Agent 面**：`dist-mcp/companionMcpServer.mjs` 只注册 `echo_observe / echo_suggest / echo_status / echo_memory`，**没有** confirm/reject（`companionMcpTools.ts:133-150`）。桥接侧 agent 路由白名单（`worldBridgeServer.ts:266-276`）只含 attach/observation/action-submit/agent-*/companion-observation/companion-suggest/companion-status/companion-memory；`companion-decision`、`companion-authorize`、`companion-suggestions`、`companion-mode`、`companion-applied` **不在** agent 路由里，且都要求 `capOk(session, ownerCap[, epoch])`。
- **Owner 面**：`handshake` 必须 host 私有 `ownerKey`（`worldBridgeServer.ts:326-340`，agent 只有 token，无法自握手）；Owner capability 由桥在握手时签发、同 Owner 重授权**原子换发**（旧 cap 立即失效）；Owner 路径仍要求 `Origin` 匹配。
- **Player v2 `actor='echo'`**：渲染控制器在入队前拒绝——写 `rejected:E_PERMISSION` 收据、`beginExecution` 后直接返回，**不调用** `enqueueSignalCommandByActor`，因此不扣 player 账户、不扣 echo 账户、不留队列（SDK 矩阵测试 2 断言 `playerEnergy=100`、`echoEnergy=100`、`pending=0`、`relay=INACTIVE`）。
- **`actor='player'`**：真实入队 → 下一 core tick 由 `processCommands` 提交，扣 `SCAN_COST`/`JAM_COST`（SDK 矩阵用 16ms 采样拿到最小值证明真扣），echo 账户不动；jam 只抑制发射（`JAMMED`，`manualEnabled/ powered` 不变），到期回到前态 `INACTIVE`。
- **v1 不静默重解**：`worldActionBatchSchema` 用 v2 判别联合，scan/jam 必须带 `actor`；v1 形状 `{type:'scan',actionId,ticks}` 被 schema 拒绝（SDK 矩阵测试 1：`isError`、不入队、不扣费、无收据）。⚠️ 实现给的是 `E_SCHEMA`，而 `worldProtocol.ts:175-177` 注释写的是 `E_VERSION_UNSUPPORTED`——注释与实现不符（属性成立，错误码文案需修）。
- **Owner 确认语义**：确认只产生“恰好一条”待提交 core 命令（E2E 断言 `pendingCommands` 里 `toggle-relay` 恰 1 条，且暂停期间**没有**早写状态）；恢复后由下一真实 tick 提交一次；`decisions` 集合使重复决策 `E_RETRYABLE companion.decision_exists`（`ownerAuth.test.ts` C7“duplicate/replayed decisions cannot double-execute”通过），TTL 过期/AI 模式/陈旧 epoch 均拒绝（`companionGateway.test.ts:114`、`ownerAuth.test.ts` C5/C6）。

**非阻断缺口**：headless `world_action` 分支（`worldHeadlessMcpTools.ts:420-425`）把 `na.actor ?? 'player'` 直接入队，缺少渲染侧那条 `E_PERMISSION`。今天**不可达**（非 dev headless 会话没有任何创建 Relay 设备的入口：`spawn-signal-device` 只来自渲染 World 的 opt-in，或 `HeadlessWorld.enableSignalDevice`/dev 工具），所以不是可利用漏洞，但建议补齐以防将来 headless 侧开出设备入口时变成旁路。

## 3. 正式 opt-in 全链（点 3）

真实链路（门禁 #7 的 10 个 STEP，全部通过；日志含 9 张截图路径）：

1. 默认 NEW RUN：`RELAY OFF · NO DEVICE`、`sim.signal` 不存在（旧行为不变）。
2. `Escape → SETTINGS → SIGNAL COLLABORATION · OFF → ON → BACK → Escape`，持久化 `save.permanent.signalCollaborationOptIn`（`PauseScene.ts:489-506`）。
3. 过门进新房 → **World 自己**在 room-enter 里入队 `spawn-signal-device`（`World.ts:779-791`，`relay_main`，房间中心），core 在 tick 边界创建：`INACTIVE / powered=true / manualEnabled=false`，`signalView().exitOpen===false`。
4. 负向：INACTIVE 时把主角放到门上 `requestInteract()`，等 1.2s 真实帧，房间号不变（门确实锁）。
5. Companion 授权（Pause 面板原生表单 → 真实 handshake，拿到浏览器侧 ownerCap）→ `echo_observe` **真的**感知到 `relay_main (INACTIVE)` 且带自身 `energy 100/100` → fixture 标注的 `echo_suggest(toggle-relay, perceived_relay)` → 面板 `CONFIRM FIRST PROPOSAL` → 暂停期间队列恰 1 条 `toggle-relay(enabled=true)` → 恢复后下一 tick `ACTIVE`，HUD `ACTIVE`。
6. 第二轮：fixture `echo_suggest(scan)` → CONFIRM → 下一 tick 只扣 echo 账户（`100 → 90`），玩家账户更高、未被扣。
7. 真实 portal：`exitOpen===true`，`requestInteract()` 后离开当前房间。
8. `echo_memory` / `echo_status` 仍可用。

**我补齐的两处弱断言**：
- 原 E2E 的“过门”只等到 `currentRoomId !== 上一房`，实测拿到的是过渡态 `-1`；我的探针（`zz-portal-probe.spec.ts`）额外等到**具体房间号**：`room 0 → 3 → 5`，且 INACTIVE 阶段同样的 interact 不会改变房间——所以“实际进入下一房”成立，不是只看过渡态。
- `receipts[]` 的 `confirmed(decidedAtTick)/applied(appliedTick)` 内容没有在真实链里断言（第 10 步只断言工具返回 `ok`）；该账本仅由单测 `companionGateway.test.ts:136` 覆盖。

## 4. Rendered↔Headless 字节级跨端（点 4）

- 导出（真实浏览器、真实 Phaser 场景）：`initial` 取**任何改动之前**的完整 `sim`；有序 `sequence` 记录 `enableEcho`（位置 = 玩家 +1 格）、`setEchoMode('hold')`、`enableSignalDevice`（贴在 echo 旁，保证 echo 侧 LOS/距离合法）、`signal-scan(actor:'echo')`、`signal-jam(actor:'player')`、`toggle-relay(true)`、370 个中性 step（jam 360 tick 到期 + 回能/冷却）、5 次真实开火（产生真实命中/伤害事件）。**设备是 fixture 注入**（直接 push `pendingCommands`），这一点在 spec 里写清楚；跨端比对的合法性不依赖设备来源。
- 重放（Node/HeadlessWorld）：tick **仅**由 `kind:'step'` 条目驱动，操作类条目不 push tick，保证“一 tick 一 commit”；比较 `canonicalState()` 与 `canonicalEvents()` **字符串逐字节相等**（不是 hash 代替内容），并核对 relay/manual/powered/echoEnergy。
- 负向：翻转首个 `signalCommand` 的 `actor`（echo→player）后**必须**产生分歧（3/3 通过），说明上面的相等不是比较被架空。
- 缺文件必红：在**干净 archive**（无 parity 产物）跑同一测试 → 3/3 全红（门禁 #3）。这说明它不是“没产物就当通过”，也说明**全量单测 713/713 不是自足的**：必须先跑导出 spec 生成 untracked 三件套，再跑重放与全量。
- 我用**自己新导出**的三件套复核：`sequence.json` sha256 与开发者的一致（`c3ffbcfc…`），`initial/rendered` 因会话 id/epoch/伤害过程不同而变——与开发者报告的口径一致；重放仍然逐字节相等。

## 5. 负向矩阵（点 5 前半）

- **隐藏 relay 负向（我独立写、独立跑）**：超出 12 格半径 / 未探索 / 墙后 → 无 `relay`、无 `objectiveBlocked`；感知到才出现，且只 `{id,x,y,state}`；`objectiveBlocked` 仅在感知到且非 ACTIVE；`isEchoObservation` 拒绝带多余字段的伪造观察。7/7 通过。
- **官方 SDK 原始 actor 伪造负向**（门禁 #8，真 `@modelcontextprotocol/sdk` 客户端 + `dist-mcp/worldMcpServer.mjs` 子进程 + 真 bridge + 真渲染 GameScene + 真收据）：v1 形状无 actor → 工具层拒绝（不入队/不扣费/无收据）；`actor='echo'` → `rejected:E_PERMISSION`（两账户都不扣、队列为空、relay 不变）；`actor='player'` scan/jam 真扣费；jam → `JAMMED` → 到期 `INACTIVE`，`manualEnabled/powered` 不变。**该 spec 的设备是明确标注的 fixture 注入**（spawn 路径由 E2E 覆盖）。
- **Owner 旧攻击最小回归**（门禁 #9 的 `p3b-companion-owner.spec.ts` 2 例 + 全量单测里 `ownerAuth.test.ts` C1-C8、`companionBridge.test.ts`、`worldBridgeServer.test.ts`）：C1 无 host 私钥自握手 403；C2 token+公开 Origin 自授权失败；C3 agent 无法替换人类 cap；C4 同 key 原子换发旧 cap 立即失效；C5 无 cap 的伪造观察被拒；C6 无 cap 的 mode 翻转被拒；C7 重复/重放决策不二次执行；C8 显式 disconnect 退回 NO_MODEL 且不自动重连（浏览器侧“硬杀 agent 后需重新 Owner 授权”同样通过）。

## 6. 是否允许 Lead 跑“真实模型 Signal 回合”

**允许，但按下列 scope 起跑**（这是我能给出的判断，不代替 Lead 决策）：

- 前置：`opt-in ON` + 已过门拿到 `relay_main`（`INACTIVE`）+ `ENABLE ECHO` + Pause 面板真人/宿主填表授权（agent 环境里没有 `OWNER_KEY`）。
- 模型侧只用 `dist-mcp/companionMcpServer.mjs` 的 4 个工具；`echo_observe` 现在**确实**会返回 `relay`，所以 `reason:'perceived_relay'` 是“有感知支撑”的合法理由。设备一旦被感知到，就**不能**再用 `no_perceived_target`（会 `E_SCHEMA companion.reason_unobserved`），这是真坑。
- 合法 Signal 建议：`scan`（感知到设备）、`toggle-relay`（无需 target）、`jam`（<6 格 + LOS）；`target` 必须落在 echo 自身感知内，否则 `E_ILLEGAL_TARGET`。
- 确认只能靠人在 UI 点 `CONFIRM FIRST PROPOSAL`；模型侧**永远**看不到 confirm 工具，也不能自己确认。回合结束应留 `tool-io.jsonl` + 截图，并明确写出“Owner 确认是自动化点击还是真人”。
- 不能据此宣称：真人验收、模型自主协作已达标、多 seed 稳定性、跨端以外的平台。

**不允许/不建议**：把这一轮回合算作“Task C 完成”；用 headless dev 工具伪造 `actor='echo'` 当作“Companion 完成”；把旧 `lead-echo-model-live`（ECHO fire 两轮、自动化 Owner 确认、冻结 `d690848`）与 Signal 混算。

## 7. 可放行范围 / 阻断 / 限制

**可放行（本机独立复核 PASS，且我用自己的快照与自己的导出复现）**
1. Signal 感知投影“一套规则、两处调用”，隐藏实体不外泄（含隐藏 relay 负向）。
2. Agent/Owner 权限边界：4 个只读+建议工具、无 confirm、host 私钥握手 + Owner capability 确认、旧攻击回归。
3. Player v2 `scan/jam` 的 `actor` 权限与真实扣费；v1 形状不被静默重解。
4. Owner 确认 → 恰一条命令 → 下一真实 tick 提交一次；重复/过期/拒绝不执行。
5. 正式 opt-in 全链（默认无 relay → 自生成 INACTIVE 挡门 → 感知+建议 → Owner 确认 → ACTIVE 开门 → echo 独立扣能 → 实际进入具体下一房）。
6. Rendered↔Headless 字节级一致（真实浏览器导出 + 真实重放 + 负向分歧 + 缺文件必红）。
7. 门禁数字复核：`tsc` 0、MCP 构建 0、全量 **713/713**、4 文件 **5/5**、合作链 1/1、SDK 矩阵 1/1。

**阻断**：无。我没有发现可利用的越权/绕过/隐藏状态泄漏；也没发现能假绿的门禁（干净 archive 下 parity 门禁确实变红）。

**新发现限制与建议修复（不阻断本次放行）**
1. `echoView` 新 Signal 投影无仓库内单元测试（我探针 7/7 通过）→ 建议把隐藏 relay 负向并入 `src/ai-native/echoView.test.ts`。
2. headless `world_action` 的 `actor='echo'` 缺 `E_PERMISSION`（当前不可达，纵深防御）→ 建议与渲染侧对齐。
3. `worldProtocol.ts:175-177` 注释写 `E_VERSION_UNSUPPORTED`，实现是 `E_SCHEMA` → 改注释或改码。
4. 全量单测不自足：`713/713` 依赖 untracked 的 `reports/ai-native-02/signal/parity/*.json`；干净 clone 需先导出再重放（门禁 #3 为证）。建议在 CI/runbook 固化成“先导出后重放”的两步，或让重放测试在缺产物时给出明确指引。
5. 合作链 E2E 的“过门”与 `receipts` 断言偏弱（我已用探针补“具体下一房”；receipts 内容仍只有单测覆盖）。
6. 既有 nit：`companionFacet.ts:57-58` 的 `availableActions` 使用了不在 `COMPANION_REASONS` 里的 reason `'perceived_target'`（早于本 delta）。

**明确 NOT RUN**
- 真实 LLM 驱动的 Signal 回合；真人（非自动化点击）Owner CONFIRM；多 seed Signal 独立门禁；跨机器/跨 OS 复跑。
- 未做（按边界）：merge/push/reset/rebase、读写 stash、改他人 WIP、kill 他人进程、动原始报错会话、覆盖既有报告目录。

## 8. 与开发者/旧报告口径的差异（避免误读）

| 说法 | 我的复核结论 |
|---|---|
| “9 项门禁本机全 PASS / 713/713” | **成立**，但全量单测依赖 untracked parity 产物；干净 archive 直接跑会红（我复现了红，再按顺序复现了绿） |
| “缺文件必须红” | **成立**（干净 archive 3/3 红） |
| “E2E 过门进入下一房” | 原断言只能证明过渡态；我补证到具体房间 `3 → 5` |
| “echo_observe 会返回 relay” | **成立**，且只含 `{id,x,y,state}`；`powered/manualEnabled/jammedUntilTick` 不外泄（我逐键断言） |
| “本轮没有任何 LLM 参与” | **成立**；现有真实模型证据只覆盖 ECHO 的 fire 两轮（`lead-echo-model-live`，自动化确认，冻结 `d690848`），不能算 Signal |
| 旧 `reviewer/signal-scene2`（仅 `c1cc2dd` 核心 PASS，3 个探针脚本 Bug NOT RUN） | 我只把它当路标；本轮的渲染/SDK/跨端证据全部由我重新生成 |
| `REPORT-FINAL.md`（297 行、untracked） | 仅作路标，未采信其结论；其日志/截图/parity 不在 archive 内，我已全部重生 |
