# AI-NATIVE-02 C3-a 独立验证报告（Tester）

- Worker `y6en9ua8phanll8cqi8dd8ru`，专属目录 `reports/ai-native-02/tester/c3a-final/`
- 目标冻结提交：`c9ccce82620c4fa5d10303097f794d557f8d9c15`（父 `4cf1bc8b26a335661b36016a2ade5b23d87afc37`），分支 `feat/ai-native-world-integration`
- 范围：**仅新增 `worldProtocol.ts` / `worldGateway.ts` / `worldBridgeServer.ts` 及 6 个单测文件**；未接 World、未接 Scene、未端到端。`worldBridgeServer` 是 loopback HTTP 桥，`WorldGateway` 是会话/授权/幂等层，二者都不 import 模拟核心、不推进 tick —— **fake adapter 不是 World/Agent 接入**。
- 隔离：`git archive c9ccce8` → `D:/Project/AI-NATIVE-02-snapshots/c9ccce8`（仅该提交已跟踪文件 + `node_modules` junction）；没有固定端口，独立探针用 `startWorldBridge({port:0})` 绑定 127.0.0.1 临时端口（本次实际 `http://127.0.0.1:44050`），不与他人端口冲突；未切分支、未改源码/测试/配置、未读并发 WIP。
- 结论：**C3-a 连接层协议验证 PASS（新层无硬阻断）**；但**整体 C3 / 接管能力不可结案**：C2 有 Reviewer 架构阻断，C3-a 未端到端，另有 2 项已复现限制 + 1 项 origin 绑定限制（见 §7、§8）。

---

## 0. 同步的 C2 架构阻断（本报告明确记录，不重跑 C2 旧 gate）

Reviewer 对父提交 `4cf1bc8`（C2）判 **FAIL / 架构阻断**，报告 `reports/ai-native-02/reviewer/c2/REVIEW_C2.md`，五类问题：

1. 正常 `stepFrame` 路径下玩家弹丸伤不到非 drone/Boss（只有 test-only 路径覆盖）；
2. `Boss.fireLaser` 通过“兼容末元素”改写 core 玩家弹丸；
3. `projectiles` setter 清空 core / 弹丸 ID 重复；
4. legacy `hurt` 在 tick 外改 HP/位置且不产生事件；
5. 官方 parity 的 test-only 路径在暂停时仍推进。

我上一轮 C2 “PASS” **仅保留为测试范围结果，不算 C2 联合通过**；本轮不重跑 C2 旧 gate，后续以修复 commit 再验。**C3-a 协议成功不能外推为可接管 World**，C3 的端到端仍被 C2 阻断。

## 1. Gate 一行式（完整输出在 `c3a-final/`）

- PASS `npx tsc --noEmit`（快照）退出码 0 → `01-typecheck.log`
- PASS `npm test`（快照）**24 files / 375 tests** → `02-unit.log`
- PASS `npx vite build --outDir …/c3a-final/frozen-dist --emptyOutDir` 18.86s（保留基线 500kB chunk 警告）→ `03-build-frozen.log`
- PASS default StationZero MCP smoke：`initialize` + `tools/list` = **6 个 Player 工具**（`game_create_session/game_observe/game_step/game_execute_action/game_get_events/game_close_session`）→ `04-mcp-smoke.log`
- PASS `npx vite-node tester-c3a-http.ts`（真实 HTTP 桥，48/48 检查）→ `05-http-bridge-probe.log`
- PASS `npx vite-node tester-c3a-gateway.ts`（gateway 语义，45/45 检查）→ `06-gateway-probe.log`

## 2. 真实 HTTP 桥验证（48/48）

真实 `fetch` → 127.0.0.1 临时端口，fake token `test-token-c3a-…`（仅测试记录，从未使用真实凭证；响应中从未回显 token）。

| 组 | 覆盖与结果 |
| --- | --- |
| Origin | 缺失 Origin → 403；错误 Origin → 403 且**无** `Access-Control-Allow-Origin`；允许 Origin → 200，CORS 仅回显该 Origin、无 `*` |
| 预检 | 允许 Origin + OPTIONS → 204，`Access-Control-Allow-Headers` 含 authorization；缺失 Origin 的 OPTIONS → 403 |
| 凭证 | 无 Authorization → 401；错误 token → 401；token 永不出现在响应 |
| authorized | `authorized:false` → 403 `world.authorization_required`；protocolVersion 错误 → 403 |
| 握手 | 合法 → 200 `session/epoch=1`；同 Origin 重复握手 → 409 `world.duplicate_handshake`；session 绑定 handshake Origin |
| body | 9000 字节 → 413 `E_PAYLOAD_TOO_LARGE`；`text/plain` → 415；非法 JSON → 400；数组 body → 400；未知路由 → 404 |
| 观察 | 错误 epoch → 409；隐藏字段 `targetRoom` → 400；NaN 坐标 → 400；>32 drone → 400；合法 → 200 |
| 队列/ACK | `next-action` 不提前 applied；伪造 actionId → 400 且不消费真实 pending；错误 requestId → 400；合法 ACK → applied；同请求重放 → applied、`next-action=null`（**无重复队列**） |
| 跨 session | 用 session A 的凭证 ACK session B 的 action → 400，B 的 pending 仍存在 |
| yield/断线 | yield → epoch+1、旧 epoch → 409；心跳丢失 → LOST、epoch+1、旧 epoch 409、LOST 后重复握手 409、显式 close 后再握手 200 |
| close | close 后 heartbeat → 404；重新握手得到新 session、epoch=1 |

## 3. Gateway 语义（45/45）

- 授权/预算：`authorized:false` 拒绝；`maxSessions=2` 时第三会 429/E_RESOURCE_LIMIT；close 删除会话；dispose 清空。
- 观察白名单：`targetRoom`/`actorId` 等隐藏字段拒绝；错误 epoch 拒绝；合法 observation 接受。
- Actor 覆盖：action 中 `actorId`/`seed` 等额外字段被 strict schema 拒绝（**不存在 actor 覆盖通道**）。
- 幂等：同 requestId 同 payload → `replayed=true`、不重复入队；同 requestId 异 payload → `E_ID_PAYLOAD_MISMATCH`；同 actionId 异 payload → `E_ID_PAYLOAD_MISMATCH`；ACK 后重放返回 applied。
- **批内部分提交**：批 `[新 action, 冲突 action]` 整体拒绝，新 action **不会**被部分入队（`next-action` 仍只返回原 pending）。
- ACK 伪造/跨 session/错 requestId：均拒绝且不消费其他 session / 真实 pending；ACK appliedTick 超过 applyByTick → expired 并释放预算。
- TTL：tick 超期 → expired、`next-action=null`；壁钟 > `MAX_ACTION_WALL_MS=5000` → `E_ACTION_EXPIRED` 并释放 pending。
- 预算：`maxPendingActions=3` 填满后第 4 个 `E_RESOURCE_LIMIT`；ACK/expire 释放后再次提交成功。
- yield：epoch+1、pending/cache 清空；旧 epoch observation/ACK → 409；显式 re-authorize 只接受新 epoch。LOST 同理，不自动重连。
- 队列限制：批 >8、重复 actionId、ticks>120 均 schema 拒绝。

## 4. 已复现的限制 / Findings（非“新层硬阻断”，但 C3b 前必须处理或裁决）

### F1（中）旧 tick 观察可回滚白名单与延长 TTL
- 复现：`pushObservation(tick=105)` → 最新 tick 105；再 `pushObservation(tick=50)` 被接受（HTTP 200），`listSessions().tick` 变为 50；随后 `submitActions(ttl=10)` 的 `acceptedTick=50 / applyByTick=60`，而不是 105/115。
- 影响：延迟/重放的 observation 可以回滚“最新”白名单状态，并把 tick TTL 延长；gateway 未要求 tick 单调。
- 建议：每 session/epoch 要求 `tick >= lastObservation.tick`（或显式拒绝 stale）；TTL 基于最大已见 tick。

### F2（中）幂等缓存淘汰后重试可重新入队（潜在双执行）
- 复现：`maxCacheEntries=2`；提交 `req X / action A` 并 ACK applied；再提交 6 个新请求把 X/A 挤出缓存；重发 **完全相同的** `req X + action A` → `replayed:false`、`status:queued`，A 重新进入 pending（`next` 最终会再次返回）。
- 默认 `MAX_CACHE_ENTRIES=128` 大于 `MAX_PENDING_ACTIONS=32`，但长会话超过 128 条后仍可触发；重试就可能双执行。
- 建议：幂等窗口必须覆盖客户端重试时域（或持久化/按 requestId 单调窗口）；或拒绝已被淘汰但仍被复用的 requestId。

### F3（低/设计）允许 Origin 可驱动其他 session（session 未绑定 origin）
- 复现：允许列表 `[http://localhost:5173, http://localhost:5199]` 共享同一 token；用 5173 握手得到 session，再用 5199 发送该 session 的 observation → 200。
- 影响：token 是主认证，origin 只是 allowlist；一旦 token 泄漏，任一允许 origin 都可操作任意 session。本地 dev 桥风险有限，但“session/actor 绑定”不完整。
- 建议：每条请求校验 session.handshakeOrigin === Origin，或签发 per-session token。

### F4（设计限制，非缺陷）
- 桥**没有 action-submit HTTP 路由**（`submitActions` 只在 gateway/单测直接调用）；也**没有 re-authorize 路由**（LOST 后只能 close + 重新握手）。
- ACK 由浏览器权威；gateway 只校验 `appliedTick` 为整数且 ≤ applyByTick，无法证明真的执行（C3-a 信任模型，非 bug，但 C3b 需明确）。
- 所有验证均为**协议/HTTP 层**；没有真实 World/Player/Scene 接入，没有真实 Agent/LLM，不能把这些结果说成“可接管”。

## 5. 观察白名单 / 旧 tick 专项结论

- 白名单本身严格：只接受 `player/drones/projectiles/roomId/availableActions`，隐藏字段（`targetRoom` 等）拒绝，数组/数值有界。
- **但** F1 证明“最新观察”可被更低 tick 覆盖；虽然不直接泄露隐藏字段，但会回滚玩家可见状态并影响 TTL。这是本轮要求检查的核心点，必须修复后再进入 C3b 端到端。

## 6. 队列批内部分提交 / 重试双执行专项结论

- **批内无部分提交**：冲突发生在入队循环之后，任何冲突批次整体失败，新 action 不会入队（已验证）。
- **重试双执行风险存在于缓存淘汰**（F2），不在批内循环；需在 C3b 前明确幂等窗口策略。

## 7. 阻断与结论

| 项 | 结论 |
| --- | --- |
| C3-a 新增协议/HTTP 层 | **PASS（无硬阻断）**：48+45 项检查通过；鉴权、Origin、预检、body、TTL、yield、lost、ACK、预算释放、批内原子性均符合预期 |
| C3 整体 / 接管能力 | **不可结案**：C2 Reviewer 架构阻断（五类，父提交 4cf1bc8）；C3-a 未端到端；F1/F2/F3 未处理前不应宣称可接管 |
| 是否有阻断 | C3-a 本身：无；整体 C3：**有阻断（C2 + 未集成）** |

## 8. C3b 前置（建议顺序）

1. 先修 Reviewer 的 C2 五类架构阻断（玩家弹丸正常路径、Boss.fireLaser 不写 core 弹丸、projectiles setter/ID、legacy hurt 事件化、parity test-only 暂停不推进），并以正常帧路径回归。
2. 观察 tick 单调（F1）：拒绝 stale observation，TTL 基于最大 tick；补永久负向测试。
3. 幂等窗口策略（F2）：覆盖重试时域或持久化；明确 max cache/pending 与失败重试语义；补“淘汰后重试”负向测试。
4. Session→Origin 绑定或 per-session token（F3）。
5. 补齐 action-submit / re-authorize 的正式通道（或明确由其他层承担），再接入真实 World 适配器与真实 ACK；不得用 fake adapter 冒充。
6. 明确 ACK 信任模型与 appliedTick 约束（是否需要 `acceptedTick <= appliedTick <= applyByTick`）。

## 9. 复现

```bash
cd D:/Project/LAST_SIGNAL
git rev-parse c9ccce8
mkdir -p D:/Project/AI-NATIVE-02-snapshots/c9ccce8
git archive c9ccce8 | tar -x -C D:/Project/AI-NATIVE-02-snapshots/c9ccce8
powershell -NoProfile -Command "New-Item -ItemType Junction -Path 'D:\Project\AI-NATIVE-02-snapshots\c9ccce8\node_modules' -Target 'D:\Project\LAST_SIGNAL\node_modules'"
cd D:/Project/AI-NATIVE-02-snapshots/c9ccce8
npx tsc --noEmit && npm test
npx vite build --outDir "D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c3a-final/frozen-dist" --emptyOutDir
# default StationZero MCP smoke（stdio，6 个 Player 工具）
# 独立探针（复制到快照根运行后删除，避免污染：
cp D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c3a-final/probe-http-bridge.ts ./tester-c3a-http.ts
cp D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c3a-final/probe-gateway.ts ./tester-c3a-gateway.ts
npx vite-node tester-c3a-http.ts     # 48/48 PASS + F1/F3
npx vite-node tester-c3a-gateway.ts  # 45/45 PASS + F1/F2
rm tester-c3a-http.ts tester-c3a-gateway.ts
```

快照关键文件 MD5：`worldProtocol.ts 056ff292…`、`worldGateway.ts 57cc7ca3…`、`worldBridgeServer.ts afb0240d…`、三个 test 文件 `e864d828…/3c67babd…/b8fedaad…`；运行后复核一致（`00-frozen-state.log`、`07-final-state.log`）。活工作树在复核期间出现 C2 修复 WIP（`M src/world/sim/core.ts`、`M rules.ts`），未纳入本报告。
