# AI-NATIVE-02 C3-a — 修复提交（关闭 Tester 复现的 F1/F2/F3）

本提交修复 Tester 在 `c9ccce8`（C3-a 最终验收）中复现并记录的 F1/F2/F3 三项限制。C3-a 连接层（协议/网关/桥）本身 PASS，但未端到端；本提交只收紧网关/桥的语义与边界，**不**接 World/Scene、不混入 C2 修复提交（`a8232c8`）、不重启 C3-b World 接线。

## 缺陷关闭对照

| 项 | Tester 复现 | 修复 | 验证 |
|---|---|---|---|
| **F1**（中）旧 tick 观察可回滚白名单与延长 TTL | `pushObservation(tick=105)` 后 `pushObservation(tick=50)` 被接受，最新 tick 变 50、TTL 从 105/115 延长 | `WorldGateway.pushObservation` 要求 `tick >= lastObservation.tick`（同 tick 允许、不回滚；更低 tick 返回 `E_STALE_TICK`，不更新白名单/TTL 基线） | `worldGateway.test.ts` F1：stale 拒绝、最新 tick 仍为 5；同 tick 允许；更新观察推进基线至 9 |
| **F2**（中）幂等缓存淘汰后重试可重新入队（潜在双执行） | `maxCacheEntries=2` 下 ACK 后挤出缓存，重发相同 `req X + action A` → `replayed:false` 重新入队 | `SessionState` 新增 `evictedRequestIds`/`evictedActionIds`；`trimCache` 在淘汰时记录 id（**永久**拒绝，集合不随缓存上限裁剪）；新增 `E_RETRY_AFTER_EVICTION`。重发被淘汰的 req/action → 拒绝，不重入队 | `worldGateway.test.ts` F2：tiny cache + 淘汰 + 负向重试返回 `E_RETRY_AFTER_EVICTION`（请求级与动作级） |
| **F3**（低/设计）允许 Origin 可驱动其他 session | 允许列表 `[5173, 5199]` 共享 token，用 5199 发送 5173 握手的 session 的 observation → 200 | `worldBridgeServer` 每个受权操作（observation/heartbeat/next-action/action-ack/yield）校验 `session.handshakeOrigin === Origin`，不符返回 `403 world.origin_mismatch`；`ackAction` 要求 `acceptedTick <= appliedTick <= applyByTick`，拒绝未来/假 ACK | `worldGateway.test.ts` F3（ACK 边界）、`worldBridgeServer.test.ts` 每操作 Origin 绑定：5199 对 5173 握手的 session 做 observe/ACK/yield 均 403，5173 正常 |

## 设计边界（F4 / 信任模型）

- 桥**没有** action-submit HTTP 路由（符合 F4：`submitActions` 只经 gateway/单测直接调用）；也**没有** re-authorize 路由（LOST 后只能 close + 重新握手）。正式动作只经 Player MCP 进入，HTTP 不再额外开控制路由。
- ACK 由浏览器权威；网关只校验 `appliedTick` 为整数且落在 `[acceptedTick, applyByTick]`；`E_STALE_TICK` 现在映射为 HTTP 409（与 epoch 冲突同级）。
- 重授权（re-authorize）仍是显式 close + 人类确认新 handshake，无自动接管；`yieldSession`/`reapExpired` 清空 pending/cache，旧 epoch 观察/ACK 返回 409。

## 验证（全过）

- `npm run typecheck`：通过。
- `npm test`（vitest）：**381/381**（新增 `worldGateway.test.ts` F1/F2/F3、`worldBridgeServer.test.ts` Origin 绑定）。
- `npm run build`、`npm run game:mcp:build`：通过。
- 复用 Tester 两探针重跑（`reports/ai-native-02/tester/c3a-final/probe-http-bridge.ts`、`probe-gateway.ts`）：
  - 原 Tester 记录的两项 finding `observation-old-tick-accepted`、`allowed-origin-can-drive-other-session` 现已**消失**（F1/F3 关闭）。
  - 原先编码 buggy 行为的少量探针断言翻转：`gateway-queue-ok`（依赖 cross-origin 被接受）、`stale-observation-rejected`（期望 `E_STALE_EPOCH`）、`cache-eviction-retry-still-idempotent`（期望淘汰后重放）——正好证明三项缺陷已关闭，并由上述永久回归覆盖。
  - 日志：`reports/ai-native-02/c3a-fixes/logs/c3a-http-probe.log`、`c3a-gateway-probe.log`。

## 残余与下一步

- C3-a 仍是协议/HTTP 层验证，**没有**真实 World/Player/Scene 接入、没有真实 Agent/LLM；不得把这些结果说成「可接管」。
- C3-b（真实外部 Agent 经正式通道战斗）仍被 C2 阻断项（已先关闭）与「未端到端」挡住；C3-b 预研 WIP 以 stash 保留（`stash@{0}: C3-b prep WIP paused for C2 fixes`），未丢、未并入本提交。
- 独立验收另行分配。
