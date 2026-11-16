# AI-NATIVE-02 C3-a 交付报告（严格 World 协议 / 网关 / loopback 桥）

- 提交：**`c9ccce82620c4fa5d10303097f794d557f8d9c15`**
- 父提交：`4cf1bc8b26a335661b36016a2ade5b23d87afc37`（C2，独立验收中）
- 分支：`feat/ai-native-world-integration`；未 push、未合并 main；`git status --porcelain` 仅 `?? reports/`。
- 范围：**只做 C3-a 协议/权限/连接层**。未改 `World/Player/Enemy/GameScene/ControlAuthority`，未接 Rendered 执行，未造 core，未改 `mcpServer` 默认 Station Zero 面，未提交任何凭据。生产链路尚未连接 World；C3-b 才能接。

---

## 1. Gate 一行式（完整日志 `reports/ai-native-02/c3a/logs/`）

- PASS `npm run typecheck` exit 0 → `00-typecheck.log`
- PASS `npm test` **375/375**（24 文件；C3-a 新增 protocol 6 + gateway 10 + bridge 6 = 22） → `01-unit.log`
- PASS `npm run build` exit 0（保留既有 500kB chunk 警告） → `02-build.log`
- PASS `npm run game:mcp:build` exit 0 → `03-mcp-build.log`
- PASS `npx vite-node src/ai-native/mcpClient.mts`（默认 Station Zero Player/Dev 工具 smoke，含 create/step/observe/close、idempotency、Dev 隔离、scenario/batch/compare） → `04-station-zero-mcp-smoke.log`
- 状态/MD5/提交：`05-commit.log`、`06-final-git-state.log`、`07-final-md5.log`
- 中间失败已关闭：bridge full-suite 并行下 60ms LOST 使 queued action 变 stale（测试改为默认 1000ms LOST，心跳用例显式 60ms）；旧 epoch 预期由 403 修正为 409；TTL ACK 断言类型修正。最终复跑全绿。

---

## 2. 文件与接口（6 文件）

| 文件 | 内容 |
| --- | --- |
| `src/ai-native/worldProtocol.ts` | 严格 `WorldActionV1`（move/stop/aim/fire/interact，actionId、ticks/ttl 上限；拒绝 actorId/role/seed/未知名）、`WorldActionBatchV1`（≤8、actionId 唯一）、`WorldObservationV1`（player/drones/projectiles/room/tick/availableActions；拒绝 seed/map/rng/targetRoom/phase/未知字段）、`parse*`、canonical/fingerprint、边界常量 |
| `src/ai-native/worldGateway.ts` | 只存 session/link/epoch/latest post-commit observation/pending intents/cache；**无 SimulationState、无 tick 推进**；handshake 必须 authorized；request/action 幂等；TTL（tick 和 5000ms wall）与 `E_ACTION_EXPIRED`；queued≠applied ACK；yield/close cancel pending；heartbeat LOST；session/pending/cache 上限与释放 |
| `src/ai-native/worldBridgeServer.ts` | `127.0.0.1` 随机端口 HTTP JSON bridge；一次性 Bearer token（timingSafeEqual）；exact Origin allowlist（拒绝 `*`/任意网站）、CORS only allowed origin、OPTIONS；handshake 需 `authorized:true`；observation/heartbeat/next-action/action-ack/yield/close；body 上限；无 token 入 URL/响应/日志 |
| `worldProtocol.test.ts` | schema 正/负：actor/role/seed 拒绝、move dir/ticks/ttl/batch 上限、observation 白名单与隐藏字段、fingerprint |
| `worldGateway.test.ts` | 授权/预算、observation epoch/tick、queued→ack、request/action 幂等、异 payload、stale epoch、tick TTL、wall timeout、yield cancel、close 释放、LOST、pending/cache 上限 |
| `worldBridgeServer.test.ts` | 无/错 token、错 Origin、无 `*` CORS、preflight、authorized=false、重复 handshake、queue→next→ack（queued≠applied）、yield/close、heartbeat LOST 不自动重连、server close 释放 |

---

## 3. 权限/幂等/生命周期关键事实

- **queued ≠ applied**：`submitActions` 只返回 `{status:'queued', acceptedTick, applyByTick}`，不推进 observation/tick；只有浏览器 ACK 后 action cache 变 `applied`/`rejected`。
- **session/actor**：bridge handshake 创建 session，`WorldActionV1` 没有 `actorId/role/kind/seed`，严格 schema 拒绝覆盖；MCP 层后续只能从 session 绑定 PLAYER。
- **epoch**：yield/close/LOST 使旧 epoch 失效；旧 action `E_STALE_EPOCH`/`E_PREEMPTED`；yield 清 pending/request/action cache，必须显式 authorize 才能新 epoch。
- **idempotency**：同 `(session,epoch,requestId)` + 同 canonical payload 返回首次 receipt（`replayed:true`），不重复入队；同 requestId 异 payload `E_ID_PAYLOAD_MISMATCH`；同 actionId 异 payload 拒绝；action cache 有界。
- **TTL/超时**：action `ttlTicks` 默认 120（≤600），基于 latest observation tick 设 `applyByTick`；observation tick 超过即 expired；另有 5000ms wall timeout；ACK 超过 applyByTick 返回 expired，不补放。
- **预算/释放**：sessions ≤4、pending ≤32、cache ≤128；`closeSession`/`dispose`/bridge `close` 清 pending/cache/session；无自动重连。
- **断线**：heartbeat 超时把 session 标 `lost`、bump epoch、清 pending；bridge 保留 origin 绑定，重复 handshake 409，需显式 close/authorize，不自动接管。

---

## 4. 桥安全与凭据

- 仅 `127.0.0.1` + 随机端口；handshake 必须 `Authorization: Bearer <token>` + `authorized:true` + exact Origin；token 不在 URL query，不在响应，不 console/log。
- CORS 只回显 allowlist 中的 exact game origin，拒绝 `*`/任意网站；无凭证/错凭证/无授权/错 Origin/重复 handshake 均不能控制。
- body 上限 8192B（协议）/ bridge 可配置更小；JSON content-type 必需；错误只返回 code/messageKey，不回显 payload/token/堆栈。
- 测试 token 是测试源码里的固定假值，不是生产凭据；未写任何运行凭据/截图/提交。

---

## 5. 明确边界 / 未接 World

- **未改** `src/world/World.ts`、`Player.ts`、`Enemy.ts`、`GameScene.ts`、`ControlAuthority`；没有 Rendered execution/ExternalLinkClient/Pause UI/F03。
- **未改** `mcpServer.ts`；默认 Station Zero Player 6/Dev 10 工具保持原状，smoke 通过。`game_world_*` 尚未注册（C3-b）。
- **未创建** SimulationState/第二 World；gateway 不 import core、不 step、不持有仿真 state。
- **C2 仍独立验收中**：若 C2 报权威问题，C3-b Rendered 接线必须等修复，不以桥层掩盖；本提交不依赖 C2 runtime。
- 正式 World 仍无 Signal；C3-a 不提供 Scan/Jam/Decoy/Relay/Bridge/Guard 字段/工具，标 unsupported。外部 Agent/LLM 逐轮战斗尚未执行。
- 生产 `window.__game` 仍在 F03 待修；C3-b 再接 test build/UI。

---

## 6. C3-b 后续所需接口

1. `World.enqueueExternalIntent({session,epoch,action,applyByTick})` 仅入队并在 `Player.sampleIntent`/`stepFrame` 消费；`ackExternalAction` 回传 applied/rejected/tick；`yieldExternalLink` 在人类接管/暂停/死亡清 queue。
2. `ExternalLinkClient`：handshake、post observation（commit batch/按 observe 需求，不每 tick 全量推）、next-action、ack、yield、close、heartbeat；只在 test build 暴露。
3. Pause/Settings `EXTERNAL AI LINK` 人类显式 AUTHORIZE；HUD 真实显示 connected/yielded/lost；F03 test build `main.ts` 仅 `DEV || MODE==='test'` 暴露 `__game`，生产 static grep 为空。
4. `mcpServer --world` 注册 `game_world_list_sessions/observe/action/close`；`--world-headless` 才 `create/step`；Dev 工具不进入 world Player 面。
5. C3-c headless 同 initial state/seed/actions/ticks canonical parity；C3-d Lead 官方 MCP client 逐轮真实战斗 + Rendered 录屏/operation JSON。

## 7. 结论

C3-a 连接/权限/幂等基础可接受但**尚未端到端可用**；没有 World 接入、没有外部 Agent 实跑、没有声称可观看。等 Lead 派 C3-b，并在 C2 独立验收无 P0 权威阻断后实施 Rendered 接线。
