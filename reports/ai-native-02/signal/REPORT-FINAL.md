# AI-NATIVE-02 Task C（Signal 协作）— 最终可复核交付清单 REPORT-FINAL

> 本文件的唯一目的：让独立 Reviewer/Tester 在不信任任何口述结论的前提下，按命令重跑、按 hash 比对、按边界判断能关什么、不能关什么。
> 本轮（Lead 指令：源码冻结）**只写 reports/docs**，未改任何源码/测试/配置。

- 工作目录：`D:\Project\LAST_SIGNAL`
- 分支：`feat/ai-native-world-integration`（未合并 main、未 push、未 rebase、未动 stash）
- 冻结 HEAD：`363eb173207bb5adaa0a21cd1af348dc92f29827`（2026-11-16 00:27:57 +0100）
- 本轮负责人：worker `b7un4i0h7x3eqmtfrnyw8v65`
- 状态口径：**9 项门禁本机全 PASS；Task C 整体不宣布完成**（缺真实人类确认验收、缺独立 Reviewer 复核、缺独立多 seed 门禁）

---

## 1. 提交链（Task C 相关，全部在冻结快照内）

| commit | 时间 | 说明 |
|---|---|---|
| `c1cc2dd8714ff953e75be70dc3d68349506d50d9` | 2026-11-15 19:43 | Task C scene 2：Relay 设备 + Owner Signal HUD + player scan/jam（**已由 reviewer/signal-scene2 复核 PASS**） |
| `5037c8245a5b175b248584f03523352b9318e141` | 2026-11-15 20:58 | Signal Relay 协作修复：Q/E 仅切武器、Signal 改 T/Y/R、humanTakeover 先于 core 提交、opt-in 持久化、设备仅在 opt-in 后 spawn、v2 外部动作、signalView 双账号 |
| `50e1ce83cde07cb1fb336fa500027e5fb7e60d8e` | 2026-11-15 21:12 | 外部 Signal 仅允许 `actor='player'`（`actor='echo'` → `E_PERMISSION`）；Headless 链路测试 + Rendered↔Headless canonical parity |
| `d100c928fd25c1f9b045c92531686f4fd35e7135` | 2026-11-15 21:17 | 删除误导性 `scripts/c3c-signal-sdk.mts`（它绕过官方 SDK 直连 HeadlessWorld）及其 package.json 条目 |
| `4b2ab0d175af46a988325b526ffd56104e5b7626` | 2026-11-15 21:26 | 新增 Playwright 合作链/parity 导出 spec、vitest parity 重放硬门禁、worldProtocol v2 schema 测试、runtime CLI 超时 15s→30s |
| `363eb173207bb5adaa0a21cd1af348dc92f29827` | 2026-11-16 00:27 | **本轮**：echo 观察投影补 Signal 设备/自身能量/objectiveBlocked；合作链 E2E 改真实房间进入 spawn + 关门负向证据 + 9 张截图；新增官方 SDK 权限矩阵 spec |

`363eb17` 实际改动文件（`git show --name-only 363eb17`，9 个，全部 tracked）：

```
src/ai-native/companionFacet.ts
src/ai-native/companionMcpTools.ts
src/ai-native/signalRenderedHeadlessParity.test.ts
src/ai-native/worldHeadless.ts
src/world/World.ts
src/world/echoView.ts
tests/signal-coop-e2e.spec.ts
tests/signal-rendered-parity.spec.ts
tests/signal-sdk-negative.spec.ts
```

---

## 2. 冻结快照 vs 本目录产物（重要，勿混淆）

- `git archive 363eb17` 得到的快照**只含源码/测试/配置**；本目录 `reports/ai-native-02/signal/**` 全部是 **untracked 产物**，**没有随 363eb17 提交**。
- 因此：Reviewer 在冻结快照内**看不到**本报告引用的日志、截图、parity JSON；必须按第 3、4 节的命令自行重跑生成，或用工作区（当前工作树）里的现成产物做比对。
- 本目录产物不参与任何 hash 冻结；唯一可冻结的是 commit SHA 与源码内容。**不得把本目录产物当“已随提交交付”**。

产物清单与 sha256（工作区当前值，仅供比对；重跑后应完全一致，parity 除外见下文）：

| 产物 | 绝对路径 | sha256 |
|---|---|---|
| 全量单测日志 | `D:\Project\LAST_SIGNAL\reports\ai-native-02\signal\e2e\full-vitest-20261116-002119.log` | `cae1242cc0eb4034bc1bc3af4eb06a3528d5000fc285b2f5071d5ec1de079d4a` |
| 类型检查日志（空文件） | `…\signal\e2e\tsc-final.log` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`（0 字节） |
| parity 导出日志 | `…\signal\parity\parity-export-run.log` | `401fd914fb8c54f1731dc9399cd6d9597dec8682c80e50f102bdebb893be861e` |
| parity 重放门禁日志 | `…\signal\parity\parity-replay-gate.log` | `c93df4a3dafd3496274664108008bab4e35b4c8ec8fda2d22ecfa5c9f569bce6` |
| 合作链 E2E 日志 | `…\signal\e2e\coop-run-7.log` | `61f5485623a00b452953e33aecc36d18b291bf82d5cdaa9b7729f55ef7e413b7` |
| SDK 权限矩阵日志 | `…\signal\e2e\sdk-negative-run-3.log` | `7a048b1aa16f043316b14c7d397c97cde73c4e163b9cbd8741fb956c44c811e3` |
| 4 文件合跑日志 | `…\signal\e2e\signal-suite-final.log` | `1c8416008afedd5cd4df6cc1ea9a52fa957c4a88ca3c229b7a26718469f521dd` |
| 客户端构建日志 | `…\signal\e2e\vite-build.log` | `214e9fd7a93843875e402f331dbc7034285148a9e0366925e520e70eca380915` |
| MCP 构建日志 | `…\signal\e2e\mcp-build.log` | `fd90b7583299e63616ad95257ecbd93e1c32e47be4bc199112a23e0a5e239a96` |
| 步骤操作日志 | `…\signal\e2e\OPERATION-LOG.txt` | 见文件 |
| 9 张里程碑截图 | `…\signal\e2e\screens\01…09*.png` | 见第 6 节（含 04/05 同 hash 的诚实说明） |

parity 三件套（**每次重跑都会变**，因为导出含真实会话 id/epoch/tick 与真实伤害过程；比对口径是“同一次导出的三件套内部自洽 + 重放后 canonical/events 完全相等”，不是跨次 hash 相等）：

| 产物 | 大小 | sha256（本次导出） |
|---|---|---|
| `…\signal\parity\initial.json` | 2,431,934 B | `23ba79e9310418dda6e865648357c8f18db5adf5a0b40cf7e19dc5ad9b433efe` |
| `…\signal\parity\sequence.json` | 80,749 B | `c3ffbcfcac82b1dad2bfa0da877d9a24b6bec16057a77c961b0fb3ea00be81d4` |
| `…\signal\parity\rendered.json` | 108,312 B | `03a5c49c378e25764ff6f451ed7d23b65874524d4454edaaf20c038faf550e5c` |

`tsc-final.log` 为 0 字节是**真实结果**（`npx tsc --noEmit` 无任何输出、exit 0），不是漏跑。

---

## 3. 门禁逐条（命令 / 结果 / 日志）

前置：真实 Vite dev server 在 5173（`HTTP 200`），`dist-mcp/` 已构建。Playwright spec 内的 bridge/companion MCP 子进程由测试自己启动与关闭。

| # | 门禁 | 命令（在 `D:\Project\LAST_SIGNAL` 下） | 结果 | 日志（绝对路径） |
|---|---|---|---|---|
| 1 | 类型检查（全仓） | `npx tsc --noEmit` | PASS，exit 0，无输出 | `D:\Project\LAST_SIGNAL\reports\ai-native-02\signal\e2e\tsc-final.log` |
| 2 | 全量单测 | `npx vitest run` | PASS **713/713** 用例，59 文件，163.63s | `…\signal\e2e\full-vitest-20261116-002119.log` |
| 3 | Rendered→Headless Signal 字节级重放（硬门禁） | `npx vitest run src/ai-native/signalRenderedHeadlessParity.test.ts` | PASS 3/3 | `…\signal\parity\parity-replay-gate.log` |
| 4 | 真实浏览器 parity 导出 | `npx playwright test tests/signal-rendered-parity.spec.ts --project chromium` | PASS 1/1（4.5s） | `…\signal\parity\parity-export-run.log` |
| 5 | 真实 Signal 合作链 UI E2E | `npx playwright test tests/signal-coop-e2e.spec.ts --project chromium` | PASS 1/1（8.3s） | `…\signal\e2e\coop-run-7.log` |
| 6 | 官方 MCP SDK 权限矩阵 | `npx playwright test tests/signal-sdk-negative.spec.ts --project chromium` | PASS 1/1（11.0s） | `…\signal\e2e\sdk-negative-run-3.log` |
| 7 | 信号相关 Playwright 合跑（4 文件 5 用例） | `npx playwright test tests/signal-coop-e2e.spec.ts tests/signal-rendered-parity.spec.ts tests/signal-sdk-negative.spec.ts tests/p3b-companion-owner.spec.ts --project chromium` | PASS 5/5（28.0s） | `…\signal\e2e\signal-suite-final.log` |
| 8 | 客户端构建 | `npx vite build` | PASS（built in 10.09s） | `…\signal\e2e\vite-build.log` |
| 9 | MCP 服务端构建 | `npm run game:mcp:build` | PASS（built in 1.28s） | `…\signal\e2e\mcp-build.log` |

最省事的复现顺序（严格）：
```powershell
npm run game:mcp:build
npm run dev                                   # 另开一个终端，保持 5173
npx tsc --noEmit
npx vitest run
npx playwright test tests/signal-rendered-parity.spec.ts --project chromium   # 先生成三件套
npx vitest run src/ai-native/signalRenderedHeadlessParity.test.ts             # 再重放比对（顺序不可颠倒）
npx playwright test tests/signal-coop-e2e.spec.ts --project chromium
npx playwright test tests/signal-sdk-negative.spec.ts --project chromium
```

---

## 4. parity：导出顺序、重放顺序、负向证据

**导出（真实浏览器，`tests/signal-rendered-parity.spec.ts`）**
1. 真实 NEW RUN（真实地图/房型），抓 `initial`（**在任何改动之前**，含第一段真实 step）。
2. 记录有序 `sequence`（字段级精确）：
   - `enableEcho`（位置 = 玩家 +1 格）、`enableSignalDevice{deviceId:'relay_main', roomId, x = echo.x + 0.5, y = echo.y}`（贴着 echo，保证 echo 侧 LOS/距离合法）；
   - `signalCommand`：`signal-scan(actor:'echo')` → `signal-jam(actor:'player')` → `toggle-relay(enabled:true)`；
   - 370 个中性 `step`（让 jam 窗口 360 tick 真实到期，同时走冷却/回能）；
   - 随后 5 次真实 `step` 开火（产生真实 enemy-hit / damage 事件）。
3. 抓 `rendered`：完整 canonical JSON 字符串 + 完整事件列表。
4. 落盘：`initial.json` / `sequence.json` / `rendered.json`。

**重放（Node vitest，`src/ai-native/signalRenderedHeadlessParity.test.ts`，硬门禁）**
1. 测试 1：若三件套缺失或字段不全 → **直接失败**（不允许“没有产物就当通过”）。
2. 测试 2：`HeadlessWorld.fromSimulationState(initial, [])` → 按 `sequence` 顺序重放（操作类条目不 push tick，tick 只由 `kind:'step'` 提供，保证 pendingCommands 一 tick 一 commit）→
   - `canonicalState()` 字符串**逐字节相等**；
   - 事件列表**逐条相等**（含 `signal-scanned` / `signal-jammed` / `signal-relay-changed` / jam 到期）；
   - 关键 Signal 字段（relay / manualEnabled / powered / jammedUntilTick / 双账号能量 / 冷却 / evidence 数 / exitOpen）一致。
3. 测试 3（负向）：翻转首个 `signalCommand` 的 `actor`（echo→player）后必须**产生差异**——证明上面的“相等”不是因为比较被架空。

已排除过的假绿手段（供 Reviewer 反向检查）：不使用两次同 seed 的 Node↔Node 比较；不比较 hash 代替内容；不允许缺失产物跳过；不修改 tick 对齐方式绕过。

---

## 5. 默认 run 与 opt-in 路径（本轮 E2E 真实覆盖）

**默认（未 opt-in）NEW RUN = 旧行为**
- 无 Relay 设备；HUD 显示 `RELAY OFF · NO DEVICE`；传送门常开；`canonicalSimulationState` 中不含 `"signal"`（单测 `signalCombat.test.ts` 亦有断言）。

**opt-in 路径（人类显式开启后）**
1. `Pause → SETTINGS → SIGNAL COLLABORATION · OFF → ON`（持久化到 `save.permanent.signalCollaborationOptIn`）；`BACK` 关闭设置，`Escape` 恢复。
2. 走过当前仍开着的门 → 进入新房间时**由 World 自己**入队 `spawn-signal-device` → core 在 tick 边界创建 `relay_main`（`roomId` = 新房间，位置 = 房间中心），初始 `INACTIVE` / `powered=true` / `manualEnabled=false`；`signalView().exitOpen === false`。
3. 本轮 E2E 的**负向证据**：在 `INACTIVE` 状态下把主角放到门上并 `requestInteract()`，等待 1.2s 真实帧后房间号**不变**（门确实不可通过）。
4. Companion 建议 → Owner CONFIRM → 下一真实 core tick 提交 `toggle-relay(enabled=true)` → relay `ACTIVE` → 门开；再建议 `scan` → CONFIRM → 只扣 echo 账号 → 人类过门成功（room 3 → 5）。
5. jam 期间 relay 为 `JAMMED`（永不 `ACTIVE`），`manualEnabled`/`powered` 不变；到期回到 jam 前的规则（单测覆盖 INACTIVE 与手动 ACTIVE 两种前态）。

事件名：`signal-device-spawned` / `signal-scanned` / `signal-jammed` / `signal-relay-changed` / `signal-evidence-expired` / `signal-energy`。

---

## 6. 夹具（fixture）边界 —— 本轮到底证明了什么、没证明什么

**E2E `tests/signal-coop-e2e.spec.ts`（无 sim.signal 注入）**
- 真实：NEW RUN、Pause 面板点击、opt-in、房间进入与设备 spawn、关门、`requestInteract()`、Owner CONFIRM、真实 core tick、能量扣减、过门、官方 Companion MCP stdio 调用。
- 夹具（必须标注）：① 用 `world.player.reset(portal.wx, portal.wy)` 把主角摆到门上（位置夹具，不是 AI 寻路）；② `echo_suggest` 的建议**由测试直接调官方 SDK 传入**，是 **fixture 标注的建议，不是 LLM 输出**（日志里就是 `fixture suggest …`）；③ 用 `world.enableEcho()` 生成 echo（等价于 UI 的 `ENABLE ECHO`，但走的是控制台）。
- 9 张截图（`…\signal\e2e\screens\`）是连续里程碑，**不是**录屏；其中 `04-companion-connected.png` 与 `05-companion-observation.png` **sha256 相同**（`c36b6cc4…`）——因为观察是 SDK 侧读取、画面 UI 未变化，如实披露，不当作两张不同画面。

**SDK 矩阵 `tests/signal-sdk-negative.spec.ts`**
- 真实：官方 `@modelcontextprotocol/sdk` 客户端 + `dist-mcp/worldMcpServer.mjs` 子进程 + 真实 bridge + 真实渲染 GameScene + 真实收据（`rejected:E_PERMISSION` / `applied`）。
- 夹具：设备由测试**注入**一个与 core 同构的 `SimSignalDevice`（该 spec 目的不是验证 spawn 路径，spawn 已由 E2E 覆盖）；能量扣费因为会再生，用页面内 16ms 采样取最小值证明。
- 结论：v1 形状 `scan` 缺 `actor` → 工具层拒绝（不入队/不扣费/无收据）；`actor='echo'` → 渲染控制器 `E_PERMISSION`（两账号都不扣、队列为空、relay 不变）；`actor='player'` scan/jam 真实扣 `SCAN_COST`/`JAM_COST`；jam → `JAMMED`，到期回 `INACTIVE`，manual/power 不变。

**本轮 E2E 顺带纠正的旧假设（避免 Reviewer 误判）**：Signal 建议确认后**不会**产生 `hasPendingCompanionIntent`（那是 move/aim/fire/stop 的通道）；它入队的是真实 core 命令。因此断言改成“暂停期间队列里恰好 1 条 `toggle-relay(enabled:true)`”，这才是真实语义。

**本轮修掉的真实功能缺口**：`buildEchoObservation` 原先不含 Signal 设备，导致 echo **永远无法真正感知继电器**（`perceived_relay` 只能靠伪造观察通过，`no_perceived_target` 永远成立）。现在 `src/world/echoView.ts` 只在“共享感知半径 + 已探索 + LOS”通过时输出 `relay`，并输出 echo 自身 `energy`/`cooldowns` 与 `objectiveBlocked`；`World.ts` 与 `worldHeadless.ts` 传同一份输入（仍然只有一套投影/一套规则）。

---

## 7. 真实模型证据 vs 本轮 fixture（不要混用）

**已存在的“真实模型”证据（本工作区可复核）**

| 目录 | 性质 | 边界 |
|---|---|---|
| `reports\ai-native-02\lead-echo-model-live\` | **真实 Lead 模型**驱动的 Companion：2 轮 `echo_suggest(fire, perceived_hostile)` → Owner UI 确认 → 真实 tick 生效（drone 被击杀，HUD 真实变化）；原始 MCP I/O `tool-io.jsonl`、Owner 记录 `owner-ui.jsonl`、截图 `round-*.png`、录像 `video/`、适配器 `owner-bootstrap-and-agent-adapter.mts`；冻结提交 `d690848` | ① 是 **ECHO/Companion** 侧，不是 Signal 协作；② Owner 确认是**自动化点击**，不是真人验收；③ 当时 `echo_status.pending` 会把已确认建议仍显示为 proposed（该问题后来由 `receipts` 只读账本修掉，见第 8 节） |
| `reports\ai-native-02\lead-echo-live\FAILURE.md` + `failure.png` | 更早一次**失败**回合，按要求原样保留 | 不得当作成功证据 |
| `reports\ai-native-02\p3b\evidence\companion-console-io.jsonl` | Companion 控制台 I/O 记录 | 接口/操作证据，不等于模型自主决策 |

**不可复核的引用（必须说明）**：`reports\ai-native-02\c3c\REPORT.md` 提到过一次真实 LLM 单 drone 遭遇（冻结 `8b9705d`，证据目录 `reports\ai-native-02\lead-live-drone\`），但该目录**在当前工作区不存在**，本轮无法复核；因此本报告不把它计为已确认证据。

**本轮（`363eb17`）的性质**：**没有任何 LLM 参与**。所有建议都是测试代码通过官方 SDK 直接传入的 fixture；因此本轮**不构成**“模型自主协作”的证据，只证明“通道/权限/规则/真实 tick 提交/资源扣减/门控”这条骨架是真的。

---

## 8. 正式工具最短运行说明（人类 + 已有工具，不新造 SDK）

### 8.1 启动（3 个终端）
```powershell
# T1 前端（必须 5173，Playwright 的 baseURL 默认也是它）
npm run dev

# T2 构建 MCP 产物（companionMcpServer.mjs / worldMcpServer.mjs 都在 dist-mcp）
npm run game:mcp:build

# T3 桥（只在 loopback 监听，打印非密信息；token 与 Owner key 只落到私有文件）
npm run game:world:bridge
# 打印：BRIDGE_URL / ORIGIN / TOKEN_FILE / TOKEN_ACL / OWNER_KEY_FILE / OWNER_KEY_ACL
# 不打印：TOKEN 内容、OWNER_KEY 内容
```

### 8.2 游戏内（人类操作，真实 UI，无全局预注入）
1. `NEW RUN` 开始。
2. **opt-in**：`Escape → SETTINGS → SIGNAL COLLABORATION · OFF → ON → BACK → Escape`。
3. **ECHO**：`Escape → ECHO COMPANION > → ENABLE ECHO`（面板内按钮）。
4. **Relay**：走过当前门进入下一个房间 → `relay_main` 以 `INACTIVE` 出现，HUD 显示 `INACTIVE`；此时门已上锁。
5. **授权 Companion**：`Escape → LLM COMPANION >`，在面板内那张**原生 DOM 表单**（标题 `COMPANION · HUMAN OWNER PAIRING`）里填三项（字段就在面板内，明文不进日志、不进 URL）：
   - `BRIDGE URL` = 上面打印的 `BRIDGE_URL`（前端校验只接受 `http://127.0.0.1:PORT` 或 `http://localhost:PORT`）
   - `TOKEN` = 读取 `TOKEN_FILE` 的**内容**（人类自己读）
   - `OWNER PAIRING KEY · from host private OWNER_KEY_FILE` = 读取 `OWNER_KEY_FILE` 的**内容**（必须是 64 位 hex；一次性，用后清除；**Agent 子进程环境里没有它**）
   然后点 `ENABLE / RE-AUTHORIZE (HUMAN)`，直到状态显示 `COMPANION CONNECTED`（否则是 `NO_MODEL` / `READ_ONLY`，没有假的连接态）。

### 8.3 官方 Companion MCP：四个工具与 schema
服务端：`node dist-mcp/companionMcpServer.mjs`，环境仅需
`LAST_SIGNAL_WORLD_BRIDGE_URL` + (`LAST_SIGNAL_WORLD_TOKEN` 或 `LAST_SIGNAL_WORLD_TOKEN_FILE`)。
**没有 confirm 工具**（人类只能在游戏 UI 里确认）。

| 工具 | 参数（strictObject） | 说明 |
|---|---|---|
| `echo_observe` | `{}` | 只返回 echo 合法感知：`relay`（只有真感知到才出现）、`drones`、`targets`、echo 自身 `energy/cooldowns`、`objectiveBlocked`；不含 seed/map/RNG/隐藏状态 |
| `echo_suggest` | `requestId` = `/^req_[0-9a-f]{24}$/`、`suggestionId` = `/^sug_[0-9a-f]{24}$/`、`kind ∈ {move,aim,fire,scan,jam,toggle-relay}`、`reason ∈ {perceived_hostile,perceived_relay,no_perceived_target,objective_blocked}`、可选 `target{x,y}`、可选 `confidence ∈ [0,1]`、可选 `ttlTicks ∈ [1, MAX_TTL_TICKS]` | 只提议，永不执行 |
| `echo_status` | `{}` | 返回 `status`、`pending`（仍未被决定的建议）、`receipts[]`（真实账本：`status ∈ confirmed/rejected/applied/expired`、`decidedAtTick`、`appliedTick`） |
| `echo_memory` | `{}` | `memoryEntries` / `memoryTtlTicks`（有界记忆，不含原始隐藏记忆） |

**合法 Signal 建议（reason 必须被真实感知支撑）**
- `scan`：需要**已感知到设备**（`reason: perceived_relay`）或设备存在但未 ACTIVE（`objective_blocked`）；感知半径严格 < 12。
- `jam`：需要严格 < 6 格且 LOS（`reason: perceived_relay` / `objective_blocked`）。
- `toggle-relay`：无需 target，`reason: perceived_relay`（或 `objective_blocked`）。
- ⚠️ **`no_perceived_target` 只在“既无 drone 也无 relay”时合法**。一旦设备被感知到，用它会被 `E_SCHEMA companion.reason_unobserved` 拒绝——这是本轮踩过并记录的真实坑，不要误判为缺陷。
- 建议 `target` 必须落在 echo 自身感知内，否则 `E_ILLEGAL_TARGET companion.target_unperceived`。

### 8.4 Owner CONFIRM 如何真实生效（不是“点了就改状态”）
1. 人类在 `LLM COMPANION >` 面板看到 `CONFIRM FIRST PROPOSAL (OWNER)`，点击。
2. 浏览器用**自己持有的** Owner capability 调 `/world-link/companion-decision`（记录 `decidedAtTick` = 当前真实 tick），随后**在本地**把已确认动作入队（Signal 类 = 入队真实 core 命令）。
3. **暂停期间 world tick 冻结**：命令保持 queued（`world.sim.pendingCommands` 可见），**没有 flush、没有跳 tick**。
4. `Escape` 恢复 → 下一个真实 core tick 提交 → relay/能量/事件真实变化。
5. 之后浏览器 `POST /world-link/companion-applied` 写 `appliedTick` 回执，并推送**提交后**观察。
6. 模型侧读 `echo_status` → `receipts[]` 里能看到 `confirmed(decidedAtTick)` 与 `applied(appliedTick)`；`echo_observe` 读到的是提交后的真实世界。**不要再用 `pending` 判断是否执行**（旧模型证据里的老问题已由此修掉）。

### 8.5 清理（每轮结束）
```powershell
# 1) 桥进程：Ctrl+C 即可 —— 它会自动删除 TOKEN_FILE 与 Owner key 私有目录
#    （scripts/c3b-bridge.mts 的 SIGINT/SIGTERM/stdin-end 分支）
# 2) Companion/World MCP 子进程：Ctrl+C 或客户端 client.close()（释放独立 Agent 租约）
# 3) 前端：Ctrl+C 结束 npm run dev
# 4) 校验没有密文外泄：token 只存在于 TOKEN_FILE；日志/截图中只应有 <redacted>
# 5) 可选（只在需要重跑 parity 时）：删除上一次导出
Remove-Item -Recurse -Force D:\Project\LAST_SIGNAL\reports\ai-native-02\signal\parity\*.json
```
> 注意：`tests/*.spec.ts` 自行 `startWorldBridge` 并 `deleteSecureTokenFile`，跑测试不会留下桥进程；但**不会**替你关掉 5173 的 dev server。

---

## 9. 多 seed Signal 批次：已有命令、真实门限、缺口

**已有的两条真实入口（都在冻结快照内）**
1. 单测（推荐，Reviewer 直接跑）：
   ```powershell
   npx vitest run src/ai-native/worldHeadlessHarness.test.ts src/world/sim/signalCombat.test.ts src/ai-native/worldHeadlessSignal.test.ts
   ```
   - `signalCombatBatch([424242, 1337, 7])`：3 seed，逐 seed 真实 core 状态与 hash。
2. MCP dev 工具（最多 10 seed，1..10）：
   ```powershell
   node dist-mcp/worldHeadlessMcpServer.mjs --dev
   # 客户端调用：world_headless_dev_signal_batch { "seeds": [424242, 1337, 7] }
   ```

**批次真实门限（`worldHeadlessHarness.ts` 的 `checks`，必须全为 true）**

| check | 真实门限 |
|---|---|
| `scan_cost_10` | 每个 seed 的 echo 能量 === 90（SCAN_COST 10） |
| `jam_cost_25` | 每个 seed 的 echo 能量 === 65 |
| `scan_cd_120` | 扫描冷却 ∈ [118, 120] tick |
| `jam_cd_480` | jam 冷却 ∈ [478, 480] tick |
| `jam_is_not_active` | jam 后与 toggle 后都必须是 `JAMMED`（永不 `ACTIVE`） |
| `expiry_recomputes_active` | 360 tick 到期后 relay 回到 `ACTIVE` 且 `exitOpen === true` |
| `evidence_found` | 扫描 evidence 数 > 0 |
| `deterministic_per_seed` | `seed:canonicalStateHash` 集合大小 === seed 数（不同 seed 不同状态） |

**缺口（明确 NOT RUN）**：没有把多 seed 批次做成**独立 Playwright / npm 门禁**。它目前只包含在全量单测（第 3 节 #2）里。按 Lead 指令本轮**不扩张**新增门禁。

---

## 10. NOT RUN / 未验证（不得当作通过）

- **NOT RUN**：真实 LLM 参与本轮 Signal 协作（本轮建议全为 fixture；旧模型的真实证据只覆盖 ECHO 的 fire 两轮，且为自动化 Owner 确认，非真实人类验收）。
- **NOT RUN**：真实人类（非自动化点击）完成一次 Owner CONFIRM 的验收。
- **NOT RUN**：多 seed Signal 批次的独立门禁（见第 9 节）。
- **NOT RUN**：跨机器 / 跨操作系统复跑（全部数据来自本机 Windows、单 Playwright worker）。
- **NOT RUN**：独立 Reviewer/Tester 对 `363eb17` 的复核（正在进入）。
- **不可复核**：`reports\ai-native-02\lead-live-drone\`（被旧报告引用但本工作区不存在）。
- **未做（按指令/边界）**：未合并 main、未 push、未 rebase、未读写/恢复 stash、未改他人 WIP、未动原始报错会话、未改历史失败目录、未提交 reports 产物。

---

## 11. Reviewer 建议的复核路径（最小充分集）

1. `git archive 363eb17` 取冻结快照；确认 9 个 tracked 文件与第 1 节一致。
2. 在快照内跑第 3 节 #1/#2/#3（纯 Node，无需浏览器）——这三条即可验证“一套规则、字节级一致、无假绿”。
3. 需要端到端时再起 dev server，跑 #4/#5/#6（顺序：#4 生成 → #3 重放 → #5/#6 UI）。
4. 对照第 6 节逐条检查“哪些是夹具”，特别是：E2E 里没有写 `sim.signal`、SDK 矩阵里写了（且已标注）；截图 04/05 同 hash。
5. 对照第 7 节区分“旧模型真实证据”与“本轮 fixture”，不要把两者相加当作“模型已完成 Signal 协作”。
6. 需要人工验收时，按第 8 节 runbook 由**真人**填表并点击 CONFIRM（这是目前唯一还缺的终局证据）。
