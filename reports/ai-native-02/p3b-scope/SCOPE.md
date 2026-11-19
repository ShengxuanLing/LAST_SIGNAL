# P3-b 接缝评估：真实 LLM Companion 与 Signal 最小正式接入

- 分支：`feat/ai-native-world-integration`；基线：`b3930c5`（P3-a 3/3）。
- 本轮**只读**：未改源码/测试/配置，未提交 docs-only 到功能分支；本文件仅存于 `reports/ai-native-02/p3b-scope/`。
- 目的：给 Lead 一份可直接派实施的接缝、权限、文件所有权、测试与提交拆分。**不预写策略**（模型自主 suggest，不走固定脚本）。

## 0. 口径更正（必须进入阶段报告）

真实模型遭遇目前有**两份独立确认**，不是唯一一次：

1. Rendered：`reports/ai-native-02/reviewer/lead-live/REVIEW.md`（浏览器 + 正式 Player MCP）。
2. Headless：`reports/ai-native-02/reviewer/lead-headless-cropped/REVIEW.md`（权限修复后，官方 SDK、无浏览器、无 Dev）。

两份都是**最小单 drone 遭遇**，均非完整 Run；ECHO 当前仍是**本地确定性策略**，没有 LLM 参与。P4 文件/Signal 整体仍未 PASS。

`b3930c5` 只读检查未发现 core 硬阻断（typecheck/unit/ECHO parity 均绿）；若 Reviewer/Tester 发现阻断，实施顺序第一项先修，再接 P3-b。

---

## 1. 现有接缝（file:line 事实）

### 1.1 Echo actor（P3-a 已落地，可直接扩展）

- `src/world/sim/core.ts`
  - `SimEchoState`：独立 `actorId`、位置/HP/冷却/朝向；`data` 是独立 base+pulse，无玩家升级。
  - `SimEvent`（168+）：`echo-moved/fired/hurt/death/spawned/despawned`；`SimProjectile.source` 已含 `echo`。
  - `stepSimulationTicks(state, ticks, intent, echoIntent?)`（1125）：同 tick 单权威，`stepEcho` 在 `stepPlayer` 与 `stepDrones` 之间。
  - `SimCommand`（104）：已有 `spawn-echo` / `remove-echo`；**没有** Signal 命令。
- `src/ai-native/echo.ts`
  - `EchoController`：`mode`、`decide(view)`、`suggest(view)`、`confirmAssist`、`memory`（≤16/TTL 600）、`snapshotState/loadState`。
  - `EchoView` 只含 echo 自己的位置/HP + 已感知 drones；**没有**设备/能量。
- `src/world/World.ts`
  - `echoView()`（236）以 echo 为中心、12 格 + 已探索 + LOS；`enableEcho/disableEcho/setEchoMode/confirmEchoAssist`（259-283）。
  - `stepFrame`（1048）在 tick 前 `decide`，把 `echoIntent` 传给同一 core。
  - `tryInteract`（773）目前只看 portal；`placePortal`（655）与房间清除（601-636）。

### 1.2 C3 传输/权限（必须复用，不建第二协议/World）

- `src/ai-native/worldProtocol.ts`
  - `WORLD_SCHEMA_V1` / `WORLD_PROTOCOL_VERSION=1`（25-26）；`WORLD_LIMITS`（28-50，含 `MAX_PENDING_ACTIONS=32`、`MAX_DEDUP_RECORDS=512`、`MAX_PAYLOAD_BYTES=8192`）。
  - `worldActionSchema`（52-66）：只有 `move/stop/aim/fire/interact`，**无 actor 字段**；`strictObject`。
  - `worldObservationSchema`（100-135）：只有 player + drones + projectiles + `availableActions`。
  - `parseWorldAction/parseWorldActionBatch/parseWorldObservation`（144-165）与 `worldActionFingerprint/worldBatchFingerprint`（167-175）。
- `src/ai-native/worldGateway.ts`
  - `linkSession`（143）人类显式授权；`submitActions`（258）epoch + observation 前置 + request/action 双层幂等 + 硬 dedup 上限 + pending 上限 + 驱逐 tombstone。
  - `nextAction`（367）/`ackAction`（395）/`heartbeat`（465）/`reapExpired`（508）。
  - Session 状态含 `pending`、`requestCache`、`actionCache`、`evicted*`（92-112）。
- `src/ai-native/agentLease.ts`
  - `AgentLeaseRegistry`（58）：`issue/renew/release/reap`，独立 agent lease（与浏览器 heartbeat 分离），硬 SIGKILL 过期。
- `src/ai-native/worldBridgeServer.ts`
  - 路由（85-128）：`/world-link/{attach, observation(GET/POST), action-submit, agent-renew, agent-status, agent-disconnect, heartbeat, next-action, action-ack, yield, close}`；agent 侧 token-only、renderer 侧 Origin 检查（87-95）。
- `src/ai-native/externalLink.ts`
  - `ExternalLinkState`（125）：`authorize/enqueueIntent/beginExecution/advanceExecution/preemptActive/yield/disconnect`；epoch/generation 防旧动作。
- `src/ai-native/control.ts`
  - `ControlAuthority`（106）：`owner: human|ai|external`、`enableAi`（162）、`humanTakeover`（194）、`modeLabel`（275）。
- `src/ai-native/sessions.ts`
  - `CompanionSessionHandle`（228）与 `companionHandle`（1531）已是 **capability closure**，不是新协议；P3-b 沿用“能力分面”做法。
- `src/ai-native/coop.ts`（隔离测试实体，**不复制整 World**）
  - `humanConfirm`（498）/`executeHypothesis`（523）：“只有 confirmed 才能 execute”；`companionHandle`（739）没有 confirm；`echoManagementAttempt`（558）显式 `E_PERMISSION`。P3-b 的权限语义照此，但绑定正式 World。

### 1.3 Signal 真实规则来源（slice 纯 rules，不复制 World）

- `src/slice/tuning.ts`：`ENERGY_MAX=100`、`REGEN_PER_SEC=5`、`SCAN_COST=10`、`SCAN_CD_TICKS=120`、`SCAN_REVEAL_TICKS=480`、`SCAN_RADIUS=12`、`JAM_COST=25`、`JAM_CD_TICKS=480`、`JAM_DURATION_TICKS=360`、`JAM_RANGE=6`。
- `src/slice/rules.ts`：`scanCost`（270）、`scan`（284）、`scanFrom(x,y)`（312，ECHO 共享能量/冷却）、`jam`（347）、`jamFrom(x,y)`（378）、`interact`（409）。
- `src/slice/corridor.ts`：`relayState`（66）、`reading`（100）、`setEnabled/toggle/setJammed`（200-214）、`jamGuard`（171）、`scan`（175）。
- 主 World 现状：**无 Energy/冷却/设备状态机**；`world_signal_status` 在 headless MCP 固定返回 `E_NOT_APPLICABLE`（`src/ai-native/worldHeadlessMcpTools.ts:965/1096`，`worldHeadlessHarness.ts:228`）。HUD 文字不得冒充 Signal。

---

## 2. Companion facet（P3-b）

### 2.1 传输：复用 C3-a envelope，加 Actor 维度（不建第二协议）

- `worldProtocol` **v2 增量**（详见 §4）：
  - `worldActionSchemaV2` 增加 `actor: 'player' | 'echo'`（v1 缺省等价 player，永不改变 v1 语义）。
  - echo 允许的动作：`move | stop | aim | fire | scan | jam`；**禁止** `interact`（人类/owner 的设备交互）与任何 owner 命令。
  - 新 `worldCompanionObservationV1`：`{ schema, protocolVersion, epoch, tick, actor: 'echo', echo: {x,y,hp,maxHp,aimYaw}, perceived: {drones, relay?}, energy: {current,max,regenPerSec}, cooldowns: {scan,jam}, memory: EchoMemoryEntry[] }`——只来自 `echoView()`，不含 seed/RNG/map/隐藏实体。
  - 新 `worldSuggestionV1`：`{ suggestionId, actorId: 1, kind, target?, reasonKey, confidence?, expiresAtTick }`——`reasonKey` 是**枚举**，不是自由文本，避免模型把 hidden 信息塞进 UI。
- 路由（沿用 `/world-link/*`，agent token-only / renderer Origin）：
  - `GET  /world-link/companion-observation` → 新 observation（agent）
  - `POST /world-link/companion-suggest` → 提交 suggestion（agent）
  - `POST /world-link/companion-confirm` → **owner/human only**：浏览器 Origin + 没有 agent token 路径；把 suggestion 转成真正的 pending action
  - `POST /world-link/companion-reject` → owner 丢弃
  - 复用 `attach/agent-renew/agent-status/agent-disconnect/heartbeat/yield/close`，**不新增 lease**。
- 有界 dedup：suggestion 与 action 共用 gateway 的 `requestId/actionId` 命名空间；新增 `suggestions` 有界表（建议 **8 条**/session，TTL ≤ `WORLD_LIMITS.MAX_TTL_TICKS=600`，按 tick 过期；驱逐写 tombstone，重试返回 `E_RETRY_AFTER_EVICTION`）。总数仍受 `MAX_DEDUP_RECORDS=512` 硬上限约束。

### 2.2 权限矩阵（关键）

| 能力 | Agent（ECHO） | Owner/人类（浏览器） | Player Agent | Dev |
| --- | --- | --- | --- | --- |
| `companion-observation` | ✅ 仅 echo 感知 | ✅ 只读 UI | ❌ | ❌ |
| `companion-suggest` | ✅ 只能 propose | ❌（不代提） | ❌ | ❌ |
| `companion-confirm/reject` | ❌ 永远 `E_PERMISSION` | ✅ 显式点击 | ❌ | ❌ |
| `scan/jam/move/aim/fire`（echo） | ❌ 直接执行 | ✅ 由 confirm 转 action | ❌ | ❌ |
| `interact`/relay toggle | ❌ | ✅（owner 交互） | ✅（player 自身） | ❌ |
| `world_headless_dev_*` / `world_signal` 调试 | ❌ | ❌ | ❌ | ✅ 仅 Dev 服务器 |

- Agent **不能 confirm 自己**：`companion-confirm` 路由不在 agent 路由白名单（`worldBridgeServer.ts:90-95`），且 `WorldGateway` 校验请求来源能力（owner capability closure，不接受 token-only）。
- Agent **不能 stepPlayer/Dev**：companion MCP surface 只注册 companion 工具；不 import core、不注册 `world_headless_dev_*`。与现有 `worldMcpServer.ts`（core-free）同一原则。
- **UI 与 AI 玩家互斥**：`companion-confirm` 要求 `ControlAuthority.owner === 'human'` 且 `aiEnabled === false`；AI/External 控制玩家时 Companion 面板只读并显示 `OWNER CONTROL UNAVAILABLE · <AI|EXTERNAL>`，suggestion 可观察但不可确认。启用 ECHO 与启用本地 AI 控制互斥（互斥在 UI 层 + gateway 校验双重保证）。

### 2.3 断线与 fallback（真实，不伪装）

- agent lease 过期 / `agent-disconnect` / SIGKILL：
  - gateway 丢弃该 session 的未确认 suggestions；
  - HUD/面板显示 `ECHO LOCAL FALLBACK · NO MODEL`（沿用 P3-a 本地 `EchoController` 策略继续跟随/站桩，**不显示 connected**）；
  - 人类仍可随时 confirm 剩余已确认动作或关闭 ECHO。
- 模型侧断线由现有 `agentLease.reap` + `/agent-status` 驱动；浏览器 heartbeat 不能延长 agent 权限（C3-b 已实现，不重做）。

### 2.4 真实 SDK 逐轮操作工具（给 Lead 用，不预写策略）

- 新增 `scripts/p3b-companion-console.mts`（复用官方 SDK 客户端与现有 `c3b-mcp-console.mts` 的 redacted JSONL 约定）：
  - `attach` → 复用 token/env，只显示 `session/epoch/actor=echo`；
  - `echo_observe` → 打印 bounded observation + memory（≤16）；
  - `echo_suggest <kind> <target?> <reasonKey>` → **只提交 suggestion**，不执行；
  - `confirm`/`reject` **不在此 console**：由真实游戏 Pause 面板的人类点击完成（Agent 进程没有该能力）；
  - `memory` → 打印当前有界 memory；`quit`。
  - 每轮记录 `tick/epoch/suggestionId/kind/decided/confirmed/appliedTick`，用于“真实模型逐轮”证据；模型自己决定每轮 suggest，不由脚本预写。
- 证据：`reports/ai-native-02/p3b/evidence/`（连续截图 + JSONL），与 P3-a 相同的“命令可运行，不只 SDK 通过”标准。

---

## 3. Signal 最小正式接入（主 World）

### 3.1 选择的一处真实机制

**一个 Relay 设备**（`SignalRelay`）绑定一个真实房间的出口 portal：

- 设备状态：`manualEnabled`、`powered`、`jammedTicks`、`relay = INACTIVE|ACTIVE|JAMMED|DISABLED`（与 `corridor.ts:66` 相同判定）。
- 共享能量：`energy ∈ [0,100]`，`REGEN_PER_SEC=5`（与 slice 相同），**player 与 echo 共用同一权威池**。
- 冷却/成本：scan 10 / CD 120 / reveal 480 / radius 12 / LOS；jam 25 / CD 480 / duration 360 / range 6 / LOS；toggle 0。
- Portal 门控：仅当该房间存在 relay 设备时，`tryInteract` 要求 `relay === 'ACTIVE'`；**没有设备的现有 run/C2/C3 行为完全不变**（opt-in）。
- 真实推进：`relay` 从 `INACTIVE` → `ACTIVE` 后 portal 可交互，进入下一房间（真实状态改变，不是 HUD 文案）。

### 3.2 规则落点（不复制 slice 整 World）

- 新增 `src/world/sim/signal.ts`（纯 TS，无 Phaser）：
  - `createSignalState({relay})`、`signalScan(state, actorPos)`、`signalJam(state, actorPos, target)`、`toggleRelay(state)`、`tickSignal(state, dt)`（能量回复/冷却/状态迁移）。
  - 公式、常量、错误码（`E_COOLDOWN`/`E_ENERGY_INSUFFICIENT`/`E_ILLEGAL_TARGET`）直接移植 `rules.ts:270-420` 与 `corridor.ts:66-214`；**不引入新平衡数值**。
- `core.ts` 增量：
  - `SimulationState.signal?: SimSignalState`（缺省不存在 → 旧行为不变）；
  - `SimCommand` 增 `scan-signal { actor: 'player'|'echo' }`、`jam-signal { actor, target: 'relay'|'source' }`、`toggle-relay`（owner）；
  - `SimEvent` 增 `signal-scanned { actor, found, reveal }`、`signal-jammed { actor, target, duration }`、`relay-changed { relay, manualEnabled, powered }`；
  - `stepSignal` 在 `processCommands` 后、actor 移动前执行（同 tick 单权威），能量/冷却按整数 tick；canonical 投影含 `signal`（仅存在时）。
- 设备放置：`World.enableSignalDevice(roomId)`（owner/dev）或 P3-b demo 的 run 选项 `signal: true`；默认 run **不启用**，避免改变 C2/C3 冻结行为。
- 观察映射：echo 的 `echoView()` 增加 `relay`（仅当 LOS+范围）；`worldCompanionObservationV1.perceived.relay` 只在感知成功时出现。
- 合法动作映射：
  - `scan` → `scan-signal{actor:'echo'}`（建议→确认后执行）；
  - `jam` → `jam-signal{actor:'echo', target:'source'}`（清除干扰窗口）；
  - `toggle` → **owner 交互**，不经 Agent；Echo 只能 `suggest('interact')`。
- 合作场景（确认后的真实链路）：
  1. echo `scan`（消耗 10 能量）→ 发现 relay；
  2. echo `suggest('interact')`（或 `jam` 清除干扰）；
  3. Owner 在 Pause 面板点击 confirm；
  4. core 执行 `toggle-relay` → `relay=ACTIVE`；
  5. portal 解锁，玩家真实进入下一房间（progress）。
- Headless 与 Rendered：`HeadlessWorld` 复用同一个 `src/world/sim/signal.ts` 与同一命令；`scripts/p3b-signal-parity.mts` 验证同 seed/动作序列 canonical 一致（Node 双侧 + 渲染侧 E2E 真 portal 推进）。
- 显式隔离：不复制 `src/slice/room.ts`/`corridor.ts` 的设施地图、Bridge/Guard/Decoy；主 World 只接入这一个 relay 设备。设施内容与 P3-b 核心解耦。

### 3.3 不做什么

- 不做 Bridge/Guard/Decoy/多设备/多房间 Signal 战役；
- 不把 HUD 文案当 Signal；
- 不发明新能量上限/新平衡；只用 slice 既有常量；
- 不改变默认 run 的 C1/C2 行为（无设备 = 旧行为）。

---

## 4. P3-c Signal Combat 批测与 MCP 版本迁移

### 4.1 版本策略（dual-accept，绝不改 v1 语义）

- `worldProtocol`：新增 `WORLD_SCHEMA_V2 = 'last_signal.world.v2'`、`WORLD_PROTOCOL_VERSION = 2`；保留 v1 的 `parseWorldAction`/`parseWorldObservation` 用于旧客户端。
- v2 增量：`actor`、`scan/jam`、`worldCompanionObservationV1`、`worldSuggestionV1`、`capabilities.signal`。v1 批次（无 actor）继续等价 `actor='player'`。
- Gateway：`submitActions` 接受 v1/v2；v2 的 echo 动作走 suggestion 路径；v1 的动作 id/含义不变。
- MCP 工具结果：`world_signal_status` 保持同名，结果增加 `supported: boolean`、`capabilities: { signal: 'supported'|'unsupported', signalVersion: 1, actors: ['player','echo'] }`、`relay` 状态；无设备时仍返回 `E_NOT_APPLICABLE`（`world.signal_combat_unsupported`）——**旧客户端不会看到语义突变的 `ok:true`**。
- 迁移兼容：旧 v1 客户端请求 `scan/jam` → `E_VERSION_UNSUPPORTED`（明确升级提示），而不是静默 `E_SCHEMA`；新服务器同时接受 v1/v2。
- AI-NATIVE-01 P4 的 `AI_NATIVE_UNSUPPORTED_ACTIONS_V1`（`aim/fire/decoy`）属于 StationZero 协议，不在本阶段改动；P3-c 只对主 World Signal 做批测与迁移。

### 4.2 P3-c 批测（后续单，不在本轮）

- 多 seed 的 Signal 批测：能量耗尽、scan/jam 冷却、relay 状态迁移、portal 解锁、断线 fallback；
- 渲染/Headless canonical 一致性 N seeds；
- MCP 工具结果 version/capability 的旧/新客户端各一组；
- 失败必须显式 `E_*`，不允许 HUD 假装。

---

## 5. 文件所有权 / 依赖 / 测试

| 文件 | 归属 | 依赖 | 测试 |
| --- | --- | --- | --- |
| `src/world/sim/signal.ts`（新） | 纯规则，无 Phaser | `core.ts` 类型、slice 常量（移植副本或引用 `slice/tuning`） | `signal.test.ts`（能量/冷却/范围/LOS/状态迁移） |
| `src/world/sim/core.ts` | 单写者扩展 | `signal.ts`、现有 echo | `echo.test.ts` 扩展 + `signal.test.ts` |
| `src/ai-native/worldProtocol.ts` | v2 增量 | protocol v1 | `worldProtocol.test.ts`（v1/v2 双解析、未知字段、payload 上限） |
| `src/ai-native/worldGateway.ts` | suggestion 有界表 + 权限 | protocol v2、lease | `worldGateway.test.ts`（agent 不能 confirm、dedup/tombstone/TTL） |
| `src/ai-native/worldBridgeServer.ts` | 3 条 companion 路由 | gateway、lease | `worldBridgeServer.test.ts`（Origin vs token、confirm 拒绝） |
| `src/ai-native/worldMcpTools.ts` | companion MCP surface | 无 core | `worldMcpIntegration.mts` |
| `src/ai-native/worldHeadlessMcpTools.ts` | headless companion + `world_signal_status` | headless core | `worldHeadlessMcp.test.ts`、`worldHeadlessEcho.test.ts` |
| `src/world/World.ts` | relay 设备 + portal 门控 + echo 观察 | core signal | `tests/p3b-signal.spec.ts` |
| `src/scenes/GameScene.ts` / `PauseScene.ts` | Companion 面板 + owner confirm + 互斥 | World | Playwright E2E |
| `src/ai-native/echo.ts` | `suggest`/`memory` 扩展（可选 relay 目标） | — | `echo.test.ts` |
| `scripts/p3b-companion-console.mts`（新） | 真实 SDK 逐轮工具 | MCP 客户端 | 启动/quit 烟测 + 真模型记录 |
| `scripts/p3b-signal-parity.mts`（新） | 一致性 | signal/core | 双侧 canonical 对比 |

依赖方向：`signal.ts` ← `core.ts` ← `World.ts`/`HeadlessWorld`；`worldProtocol` ← `gateway` ← `bridge`/MCP。**禁止** `signal.ts` import `World`/Phaser；**禁止** companion MCP import core。

---

## 6. 小提交步骤（2–3 个）

1. **Commit A（core Signal + 单测）**：`src/world/sim/signal.ts`、`core.ts` 增量、`signal.test.ts`；无 UI/World 行为变化（`signal?` 缺省不存在）。
2. **Commit B（Companion facet 传输/权限）**：`worldProtocol` v2 增量、`worldGateway` suggestion 表 + actor 权限、`worldBridgeServer` 路由、companion MCP 工具、`p3b-companion-console.mts`、单测。
3. **Commit C（World/Headless 接线 + UI + 证据）**：`World` relay 设备/portal 门控/echo 观察、`HeadlessWorld` signal 命令、Pause Companion 面板 + owner confirm + 与 AI 玩家互斥、`p3b-signal-parity.mts`、Playwright E2E、报告/截图。若过大，可拆 C1（World/headless）与 C2（UI/E2E）。

每个提交独立 typecheck/build/单测绿；Evidence 与 P3-a 同标准：一行 PASS/FAIL + 命令 + 结果 + 路径。

---

## 7. 需要 Lead 裁定的 3 点（默认建议）

1. **Portal 门控 vs 其他真实效果**：默认“relay ACTIVE 解锁该房间出口 portal”，最贴近 slice 的 bridge 语义且可直接推进；备选是“解锁该房间 supply/cache”，但推进感弱。
2. **移动类 suggestion 是否逐条确认**：默认 `scan/jam/fire/interact` 必须逐条 owner confirm；`move/stop/aim` 在 owner 已开启的 ECHO 模式内自动执行（与 P3-a 一致），否则逐条确认会不可用。
3. **v1 客户端遇到 `scan/jam`**：默认返回 `E_VERSION_UNSUPPORTED` 并提示升级，而非 `E_SCHEMA` 或静默降级；服务器 dual-accept v1/v2。

## 8. 明确不在本轮

- 真实 LLM 实施（本轮只给接缝与工具设计）；P3-c 批测执行；Bridge/Guard/Decoy/多设备；设施地图复制；第二协议/第二 World；任何“假 connected”；把 HUD 文案当 Signal。
- 未 merge/push/stash；`stash@{0}`/`stash@{1}` 保持原样。
