# AI-NATIVE-02 C3-a 有界性修复（会话配额 / close Origin / 同 tick 冲突）

本提交只改 gateway / bridge / 对应单测 / 必要协议与文档，**不恢复 C3-b stash、不接 World、不合并 main**。目标是在接 C3b 前关闭 Tester 对 `0ac1814` 复验提出的两个硬问题（无界 evicted 集合、close 未绑定 Origin）以及同 tick last-write-wins 的契约风险。

## 1. 会话生命周期硬操作配额

- **常量/参数**：`WORLD_LIMITS.MAX_DEDUP_RECORDS = 512`；`WorldGatewayOptions.maxDedupRecords` 可覆盖（测试使用 4/6/8/16/32 等小值）。
- **计数对象**：每个 session 的 `requestCache + actionCache + evictedRequestIds + evictedActionIds` 总记录数，以 `dedupRecords` 严格计数；任意时刻 `总记录数 === dedupRecords <= maxDedupRecords`。
- **检查位置**：`submitActions` 解析批后，先处理已接受 request 的缓存 replay / evicted 拒绝，再计算本批新增 requestId + actionId 数；**在任何指纹校验/入队前**检查 `dedupRecords + newCount <= maxDedupRecords`。超限整批返回 `E_RESOURCE_LIMIT / world.session_quota`：
  - 不部分计费、不部分入队；
  - 不自动换 epoch、不清/丢去重记录；
  - 已接受 request 的重试仍返回缓存 replay 或 `E_RETRY_AFTER_EVICTION`，不会重新执行。
- **淘汰**：`trimCache` 把被淘汰 id 移入 evicted 集合并计入同一配额；`evicted` 集合不再无界，而是由配额硬界约束。
- **yield/LOST**：`archiveCaches` 把 cache 记录归档进 evicted 集合（总数不变），保留去重拒绝能力；配额不重置，后续新操作继续受同一上限约束，不能借 epoch 轮换绕开配额扩张。
- **close/dispose**：`closeSession` 删除整个 session（集合可 GC），`dispose` 清空全部 session；显式 `authorize` 重授权由人类调用，不自动恢复控制。重新开始需显式 close + 新 handshake（新 session 新配额）。
- **pending 预算**：`maxPendingActions` 仍独立生效；ACK/过期释放后继续提交，且始终满足 dedup 配额。
- **避免双计**：若 pending action 的 actionCache receipt 曾被淘汰（id 在 evicted 集合），过期/ACK 写回时先 `evictedActionIds.delete(id)` 再写 cache，保证一个 id 只占一条记录。

## 2. `/world-link/close` Origin 绑定

`closeLink` 现在与其他受权操作一样调用 `originMatches(req, options.gateway, session)`；不同允许 Origin 用同一 token 关闭别人 session → `403 E_PERMISSION / world.origin_mismatch`，session 保持存在；握手 Origin 可正常 close。

## 3. 同 tick 观察冲突

- 同 epoch、同 tick、payload 相同 → 幂等返回 `{ok:true,tick}`，不改变权威内容。
- 同 epoch、同 tick、payload 不同 → `E_TICK_CONFLICT`（HTTP 409 `world.observation_conflict`），不覆盖 latest；要改变内容必须提交新的 commit tick。
- 更低 tick → `E_STALE_TICK`（HTTP 409），不回滚 latest / TTL 基线。
- `yield`/`LOST`：epoch+1、清空 `lastObservation`；显式 `authorize` 后新 epoch 允许 tick 重置；去重记录保留，旧 request 仍被 `E_RETRY_AFTER_EVICTION` 拒绝。

## 4. 验证（完整日志 `reports/ai-native-02/c3a-bounds-fix/logs/`）

| 结果 | 命令 | 结果 | 日志 |
|---|---|---|---|
| PASS | `npm run typecheck` | exit 0 | `01-typecheck.log` |
| PASS | `npx vitest run` | 24 files / **391 tests** | `02-unit.log` |
| PASS | `npm run build` | built in 11.51s | `03-build.log` |
| PASS | `npm run game:mcp:build` | built in 1.00s | `04-mcp-build.log` |
| PASS | default StationZero MCP smoke | initialize + tools/list = **6 Player tools** | `05-mcp-smoke.log` |
| EXPECTED-FAIL（旧契约） | `npx vite-node probe-gateway-fixes.ts` | 33/35；失败项为旧断言 `same-tick-policy-last-write-wins`、`evicted-sets-bounded`（该断言在“有界”时反而失败）；长流量 checkpoints 稳定 254/254/2/2 = 512，`unbounded-evicted-id-memory` finding 已消失 | `06-gateway-probe.log` |
| EXPECTED-FAIL（旧契约） | `npx vite-node probe-http-fixes.ts` | 29/30；失败项为旧断言 `same-tick-allowed-last-write-wins`；F1/F2/F3 功能契约检查通过 | `07-http-probe.log` |

旧探针的 `evicted-sets-not-released-on-yield/lost` findings 是**新契约要求保留去重记录**的结果：归档后总数仍为 512，不增长；close/dispose 才释放。Tester 的修正契约探针应断言“有界 + 保留 + close 释放”，而不是旧的“yield 释放”。

## 5. 记忆上界

- 每 session 去重记录硬上界：`MAX_DEDUP_RECORDS = 512`（request+action 合计；cache 与 evicted 合计）。
- 实测默认配置 3000 次 submit+ACK：1000/2000/3000 次检查点均为 `evictedReq=254, evictedAct=254, reqCache=2, actCache=2`，合计 **512**；不再随操作线性增长。
- pending 另有 `MAX_PENDING_ACTIONS`；sessions 另有 `MAX_SESSIONS`；close/dispose 释放。

## 6. 边界

- 没有真实 World/Player/Scene 接入，没有真实 Agent/LLM；C3-a 仍是协议/HTTP 层。
- HTTP 仍无 action-submit / re-authorize 路由（正式动作经 Player MCP；LOST/YIELD 后只能 close + 人类确认的新 handshake）。
- C3-b 继续冻结，`stash@{0}: C3-b prep WIP paused for C2 fixes` 未读未恢复；C3b 仍待独立验收。
