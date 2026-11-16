# AI-NATIVE-02 C3 范围决策（只读，不写生产源码/测试/配置）

- 基线：`4cf1bc8b26a335661b36016a2ade5b23d87afc37`（C2；Reviewer/Tester 独立验收中），分支 `feat/ai-native-world-integration`。
- 本单只写 `reports/ai-native-02/c3-scope/`；未改源码/测试/配置，未提交/切分支/合并。
- 核心判断：**Rendered 浏览器必须继续持有唯一权威 `SimulationState` 与 tick；stdio MCP 进程只能做 Gateway + 本地桥，不得为可观看会话另建/镜像 core。** Headless 只用同一 core 在 Node 独立会话复现，不能冒充可观看会话。

---

## 0. 先报告的核心风险（实现前必须接受/决策）

1. **双权威风险最高**：若 MCP 进程为 rendered 会话也跑 `stepSimulationTicks` 或缓存一份 `SimulationState`，浏览器与 MCP 会分叉。方案强制 rendered 会话 MCP 只存「最近 post-commit observation + pending actions」，不存仿真状态；action 只以 `PlayerIntent` 入队浏览器，浏览器 ack 后才算提交。
2. **C2 尚未独立验收**：C2 的 `World.sim` 唯一写源、combined `World.projectiles` 兼容视图、暂停/tick 语义仍待 Reviewer/Tester。C3 实现应在 C2 无 P0 authority 阻断后开始；若 C2 发现权威问题，C3 暂停而不是在桥层做补丁。
3. **F-03 是外部 Agent 接入前置**：生产 `window.__game` 必须移除；测试需要单独 test build。否则“外部 Agent 经 MCP”与“页内全局直接读全图”边界不成立。
4. **C2 RNG 边界**：core 用显式 `seed+tick` RNG，但 `World.rng` 仍服务 loot/portal/敌人选择，视觉/Boss/新局 seed 仍有 `Math.random()`；C3 observation 不能泄漏 seed/RNG/full map，也不能宣称全 run Replay。
5. **桥传输/安全**：loopback + 随机端口 + 一次性 token；不能监听公网。CORS 仅允许游戏 origin；token 只写 stderr/一次性 UI，不进 MCP stdout、不落普通日志。
6. **动作竞态**：浏览器帧/固定 tick 与 MCP 往返延迟必须由 `applyByTick`/TTL、epoch、idempotency、ack 解决；过期 action 不得在后续 tick 补放。
7. **人类接管竞态**：人类输入/暂停/升级/背包/死亡必须立即 YIELDED、取消在途 action、bump epoch、拒绝旧请求；不能自动回切外部 Agent。
8. **Signal 不存在**：正式 World 无 Scan/Jam/Decoy/Relay/Bridge/Guard/Signal Energy；C3 工具/观察不得出现 Signal 字段或工具，标 unsupported。

---

## 1. 连接拓扑与 tick 所有权

```text
MCP client (Lead/Agent, stdio)
  -> last-signal-world MCP process (stdio + loopback HTTP bridge)
       - session/link/epoch/action TTL/idempotency/actor binding
       - latest post-commit observation (read-only)
       - pending PlayerIntent actions (no SimulationState)
  -> HTTP loopback (127.0.0.1:random, token)
  -> Rendered game test build (browser)
       - World.sim = ONLY authority + fixed 60Hz tick
       - ExternalLinkClient: handshake/push observation/poll action/ack/yield
       - World external intent queue -> PlayerIntent at next tick
       - human input -> ControlAuthority YIELDED immediately
```

- **Rendered tick owner**：浏览器 `GameScene.update` → `World.stepFrame` → fixed core。MCP **没有** rendered `step` 工具；`game_world_step` 对 rendered 返回 `E_NOT_APPLICABLE`。
- **Observation**：浏览器在每次 `World.stepFrame` 后（节流）推 `WorldObservationV1`；MCP `game_world_observe` 读最近 post-commit 快照，可 `afterTick` 长轮询至 1s。MCP 不计算/改写观察。
- **Action**：MCP `game_world_action` 只入队 `WorldActionV1`（`PlayerIntent` 片段）；浏览器按 epoch/actionId/TTL 校验后，在下一个 tick 通过 `World.enqueueExternalIntent` 进入 `Player.sampleIntent` 同一路径；ack 带 `appliedTick`/`rejected`。MCP 不写 Scene/Player 坐标/HP。
- **Headless**：仅 `--world-headless` 进程可选；MCP 进程拥有一个 `SimulationState`，`game_world_step` 推进同一 `stepSimulationTicks`。用于 owner 复现，不对 Agent 暴露 seed/fixture；不能宣称“正在观看的会话”。

---

## 2. 最小通信入口（loopback HTTP JSON，避免新依赖）

MCP 进程在 `--world` 时启动 `http.createServer`（`127.0.0.1` 随机端口），启动 stderr 打印：
`WORLD_LINK http://127.0.0.1:<port> token=<256-bit>`（token 不入 stdout 协议）。

| 方法/路径 | 方向 | 用途 |
| --- | --- | --- |
| `POST /world-link/handshake` | browser→MCP | `{token, protocolVersion:1, gameBuild:'test', origin}`；返回 `{session, epoch:1}`；一个浏览器连接一个 rendered session |
| `POST /world-link/observation` | browser→MCP | post-commit `WorldObservationV1`；MCP 只保存最新，按 session/epoch |
| `POST /world-link/heartbeat` | browser→MCP | 1s 心跳；3 次丢失标记 `link-lost` |
| `GET /world-link/next-action?session&epoch&afterAction` | browser→MCP | 长轮询 100ms；返回一条 pending `WorldActionV1` 或 204 |
| `POST /world-link/action-ack` | browser→MCP | `{session,epoch,actionId,requestId,appliedTick,result:'applied'|'rejected',code}`；解决 MCP action promise |
| `POST /world-link/yield` | browser→MCP | `{session,epoch,reason:'human-input'|'pause'|'close'}`；MCP 标 YIELDED、bump epoch、取消 pending、拒绝旧请求 |
| `POST /world-link/close` | browser/MCP | 正常断开；取消 pending、释放 session、HUD 断开；不自动重连 |

- Token 必须是 handshake 一次性交换；后续请求 `Authorization: Bearer <token>`；只允许 loopback 和配置的 game origin（CORS）；不接受公网/其他 origin。
- 不采用 WebSocket 以免新增 `ws` 依赖；50–100ms 轮询对战斗足够。若后续需要更低延迟，再单独评估 `ws`，不改变协议语义。

---

## 3. 授权 / 生命周期 / 契约

### 3.1 外部 AI 显式授权

- 正式游戏 Pause/Settings 增加 **EXTERNAL AI LINK** 区域：显示 bridge URL/token 输入、`AUTHORIZE EXTERNAL AGENT` 按钮、当前 link/session/epoch；默认 `OFF`。
- 人类必须点击授权才创建 rendered session；本地确定性 demo 仍是独立开关，不能自动变成外部会话。
- HUD：未连接继续 `EXTERNAL NOT CONNECTED`；授权并 handshake 后显示 `EXTERNAL AGENT CONNECTED` + session handle + tick；`YIELDED` 显示 `HUMAN CONTROL / LINK YIELDED`；断线显示 `LINK LOST`，不自动恢复。
- MCP 不能创建 rendered session，也不能从外部参数改 role/kind/seed/token。

### 3.2 epoch / requestId / actionId / actor

- 复用现有 `sessions.ts` 的模式：`(sessionId, epoch, requestId)` 请求幂等；`(sessionId, epoch, actionId)` 动作幂等；同 requestId 不同 payload `E_ID_PAYLOAD_MISMATCH`；同 actionId 不重复执行，返回首次 receipt。
- epoch 在 handshake/authorize、人类接管、暂停/恢复、reset/restore/死亡/新 run、close 时递增；旧 epoch → `E_STALE_EPOCH`，在途 action 取消。
- actor 在 handshake 绑定为 `PLAYER`（不可变 registry）；`WorldActionV1` 不接受 `actorId/role/kind/seed`；请求体出现即 `E_SCHEMA`。
- timed action：`ttlTicks` 默认 120（2s，60Hz），`applyByTick = acceptedTick + ttlTicks`；浏览器只在该范围应用；过期 ack `E_ACTION_EXPIRED`，不补放。MCP `actionTimeoutMs` 默认 3000，超时返回 `E_ACTION_TIMEOUT` 并取消 pending。

### 3.3 YIELDED / 断线 / 人类优先

- 人类任意 WASD/SPACE/鼠标开火/F、ESC/暂停、升级/背包覆盖层、死亡/退出 → `ControlAuthority.humanTakeover()`/`pause` 立即清空 external intent；`ExternalLinkClient` POST `/yield`。
- MCP 收到 yield：session 状态 `YIELDED`，bump epoch，取消 pending，所有未完成 action reject `E_YIELDED`；不自动 resume。人类必须再次显式授权才能新建 epoch。
- 心跳丢失/transport close/MCP SIGINT/SIGTERM/stdin close：MCP cleanup 取消 pending、关闭 HTTP、释放 session；浏览器检测不到心跳 → `LINK LOST`、回 human，不自动重连。
- 死亡沿用 `finishRun → 新 R0`；link 自动 YIELDED/关闭，不把死亡当 checkpoint 续局。

---

## 4. 官方 MCP 工具与 Dev 隔离

**World MCP 进程（`--world`，Player 面）只注册：**

| 工具 | 参数（最小） | 行为 |
| --- | --- | --- |
| `game_world_list_sessions` | 无 | 列出已授权 rendered link 的 opaque `session`、`epoch`、`tick`、`link:connected/yielded/lost`；不返回 seed/map |
| `game_world_observe` | `{session, afterTick?, timeoutMs?}` | 最近 post-commit `WorldObservationV1`；可长轮询；无 seed/RNG/全图 |
| `game_world_action` | `{session, epoch, requestId, actionId, actions:[WorldActionV1], ttlTicks?, timeoutMs?}` | 只入队 intent；等待浏览器 ack，返回 `accepted/appliedTick` 或错误；idempotent |
| `game_world_close_session` | `{session}` | 关闭 link、取消 pending、释放；不自动重连 |

**Headless-only（`--world-headless`，owner 复现；不注册到 `--world` rendered 进程）：**

- `game_world_create_session`（server 生成 seed；`--world-headless --dev` 才允许显式 seed）
- `game_world_step`（`{session,ticks,actions?}`，Node core 推进）
- `game_world_observe` / `game_world_action` / `game_world_close_session`

**Dev 隔离**：`game_inject_fixture`、`game_snapshot/restore`、`game_replay`、`game_run_scenario/compare_runs`、任何 seed/fixture 只在 owner Dev 进程；rendered Agent 不可见。`--dev` 不得把 Dev 工具加入 `--world` rendered 面。默认 Station Zero MCP 的 6 Player/10 Dev 工具保持原状，不与 `game_world_*` 混注册。

**协议复用**：复用 `protocol.ts` 的 `AiNativeEnvelopeV1`/错误码/canonicalJson/payloadFingerprint/checkIdempotency/compareEventOrder；复用 `sessions.ts` 的预算/幂等/epoch/close 模式；**不复制** `Session`/`Harness` 类（绑 Station Zero）。
**确需新 schema**：`WorldActionV1`（move/stop/aim/fire/interact + ticks/ttl）与 `WorldObservationV1`（player/drones/projectiles/room/tick/availableActions），因为 `ActionTypeV1` 是 door/relay/guard 语义、`ObservationV1` 是 Station Zero door/relay/bridge 白名单；不是完整 worldV2 平行协议，只加首片 payload，共享 envelope/校验/幂等。

---

## 5. 实际可执行的 Lead 外部 Agent 流程（非预写战斗）

前置：C2 冻结验收无 P0 阻断；F-03 test build 已合并；C3 实现完成。

1. `npm run build:test`（新增 test build，`main.ts` 仅 `DEV || MODE==='test'` 暴露 test handle；生产 build 静态 grep `__game` 必须为空）；`npx vite preview --outDir dist-test --port 5335 --strictPort`。  
2. 另终端：`npx vite-node src/ai-native/mcpServer.ts --world`；stderr 得到 `WORLD_LINK ... token=...`。  
3. 游戏 NEW RUN → Pause → **EXTERNAL AI LINK** 粘贴 URL/token → `AUTHORIZE EXTERNAL AGENT`；HUD 变 `EXTERNAL AGENT CONNECTED`，记录 session/epoch/tick。  
4. Lead 的官方 MCP Client（不是预写路线脚本）依次：`game_world_list_sessions` → `game_world_observe` → 根据当前 `player/drones/projectiles` 自行选择动作 → `game_world_action`（例如 `move` 接近/`aim`/`fire`，带 `requestId/actionId/epoch`）→ 读 ack 的 `appliedTick` → 再 observe；循环直到真实 drone 死亡/玩家受伤。每轮记录 tool 参数、observation、ack、screenshot。  
5. 人类按任意移动/开火/F/ESC 可随时 YIELDED；MCP 旧 action 被取消，需人类再次显式授权。  
6. 录屏/证据：Playwright `recordVideo`/连续截图 + bridge action/ack JSON；不把本地 demo/脚本当真实 Agent 证据。  
7. 无窗口复现：owner 从 rendered 初始 observation/owner Dev snapshot 取同初始 state（不向 Agent 泄漏 seed/map），启动 `--world-headless --dev`，用同一有序 `WorldActionV1` 列表 `game_world_step`，比较 canonical state/events；仅证明 core 复现，不冒充可观看会话。

---

## 6. F-03 生产移除 / 测试入口

- `src/main.ts` 改为：`if (import.meta.env.DEV || import.meta.env.MODE === 'test') (window as any).__game = game;`。
- `vite.config.ts` 增加 test build 入口（`vite build --mode test --outDir dist-test`）；生产 `npm run build` 不含 handle。静态 gate：`grep -R "__game" dist` 必须无命中；test build 允许命中并显式标注。
- 现有 Playwright 全部改用 test build（`dist-test`），保留 `window.__game` 读取；新增 helper 断言 test build 才存在 handle；生产 preview 只用于 F-03 静态/手工无 handle 验证。`window.__game` 不再是生产攻击面，但页面级安全边界仍需 C3 Gateway token。
- 兼容测试：C1/C2 已硬编码 `window.__game` 的 spec 不改断言，只切换 test build；`c2-parity.spec` 仍用 dev/test build 动态 import core。所有证据标注 test build，不称生产。

---

## 7. 文件所有权（C3 实现阶段，单一写者）

| 范围 | 文件 |
| --- | --- |
| A 协议/Gateway/桥 | 新增 `src/ai-native/worldProtocol.ts`（仅 `WorldActionV1`/`WorldObservationV1` + 复用 import）、`worldGateway.ts`（session/epoch/idempotency/TTL/ack）、`worldBridgeServer.ts`（loopback HTTP/token/CORS）、`worldMcpTools.ts`；改 `src/ai-native/mcpServer.ts`（`--world`/`--world-headless` 注册；不改 Station Zero 默认面） |
| B Rendered 适配 | 新增 `src/world/ExternalLinkClient.ts`；改 `src/world/World.ts`（external intent queue/ack/yield，不写 Scene 状态）、`src/entities/Player.ts`/`src/ai-native/control.ts`（external owner/YIELDED）、`src/scenes/GameScene.ts`/`PauseScene.ts`（LINK UI/授权/断线）、`src/main.ts`（F-03） |
| C 测试/构建/证据 | `vite.config.ts`、`package.json`（`build:test`/`world` scripts）、`playwright.config.ts`/tests helper、新增 `tests/c3-world-link.spec.ts`、`src/ai-native/worldProtocol.test.ts`、`scripts/c3-headless-parity.ts`；`docs/AI_NATIVE_WORLD_CONTROL.md`/阶段报告 |

依赖：C2 冻结验收 → F-03 test build → A 协议/桥 + B 页面 link（同一小步） → C 浏览器证据/headless parity → 独立 Reviewer/Tester。**不得**两个写者同时改 `World.ts`/`mcpServer.ts`。

---

## 8. 最小实现顺序 / 验收命令

1. **C3-a 协议与桥**：`worldProtocol.ts`/`worldGateway.ts`/`worldBridgeServer.ts`、loopback token、session/epoch/action TTL；Node 单测 handshake、idempotency、stale epoch、TTL、disconnect/YIELDED；`npm run typecheck`、定向 vitest、`npm run build`。
2. **C3-b Rendered link**：F-03 test build + Pause LINK UI + ExternalLinkClient + World intent queue/ack + human takeover；`tests/c3-world-link.spec.ts`：人类授权→真实 observe/action→HUD/tick/ack；人类按键 YIELDED；断线不自动重连；`npm test`、全量 Playwright（test build）。
3. **C3-c Headless reproduction**：`--world-headless` + `game_world_step` + `scripts/c3-headless-parity.ts`；同 initial state/seed/actions/ticks canonical 比较；`npm run game:sim:parity` 之外新增 C3 parity 日志。
4. **C3-d 外部 Agent 实跑**：Lead 用官方 MCP client 逐轮 observe→choose→action，Rendered 录屏/operation JSON；独立 Reviewer/Tester 从冻结 commit 复核。C3 完成条件是真实外部 Agent 经正式 Player 通道完成非预写战斗；本地 demo/脚本/Playwright 自动化不能替代。

---

## 9. 边界与明确不支持

- 只做首片（start room + drone + pulse + C2 已迁移 player/drone 弹丸）；Boss/其他 enemy kind/loot/portal/升级/存档 legacy，不扩成全 World 无头化。
- 正式 World **没有 Signal**：C3 不提供 Scan/Jam/Decoy/Relay/Bridge/Guard 工具或字段；Signal 接入仍是总任务义务，当前标 unsupported。
- 不新增第二协议栈；共享 envelope/错误/幂等/排序原语，只加 `WorldActionV1`/`WorldObservationV1` 首片 payload。
- 不直接写 Scene、不伪造 pointer、不系统键鼠模拟、不把脚本/本地 demo 当外部 Agent；`window.__game` 仅 test build，生产静态无 handle。
- 不宣称全 run Replay/stateHash/Headless World；C2 的 canonical 只覆盖已迁移范围，C3 不扩大承诺。

## 10. Gate（本单只读）

- PASS `npm run typecheck` exit 0 → `reports/ai-native-02/c3-scope/logs/02-typecheck.log`
- PASS `npm test` **353/353** → `reports/ai-native-02/c3-scope/logs/03-unit.log`
- Git/源事实 → `00-git-state.log`、`01-source-facts.log`
- 未写生产源码/测试/配置；未提交/切分支/合并；未启动任何服务/端口。
