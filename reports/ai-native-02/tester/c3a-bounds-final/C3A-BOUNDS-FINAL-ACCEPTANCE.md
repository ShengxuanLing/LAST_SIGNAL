# AI-NATIVE-02 C3-a 有界资源 / Origin 最终独立复核（a53bfa7）

- Worker `y6en9ua8phanll8cqi8dd8ru`，专属目录 `reports/ai-native-02/tester/c3a-bounds-final/`
- 目标冻结提交：`a53bfa7036b2f491e354565f53ffcb8e36c40318`（父 `0ac1814ffbe0a206954d7941f6c4d323413f9eec`），分支 `feat/ai-native-world-integration`
- 隔离：`git archive a53bfa7` → `D:/Project/AI-NATIVE-02-snapshots/a53bfa7`（仅该提交已跟踪文件 + `node_modules` junction）；探针只在本报告目录；真实 HTTP 桥使用 127.0.0.1 临时端口。未切共享分支、未改源码/测试/配置、**未读取/恢复任何 stash**（复核时 `stash@{0}`=“C3a extra quota tests paused for C2 round2”、`stash@{1}`=“C3-b prep WIP paused for C2 fixes”，只读取了 stash 名称，未读其内容）。
- 活工作树存在未提交 `M src/ai-native/worldGateway.test.ts`（开发者并行 WIP），**未纳入验收**；所有验证来自 git 提交快照。
- 结论：**C3-a 有界性/Origin 最终复核 PASS（267 + 31 项正确契约检查全过，无 findings）**；F1/F2/F3 关闭；从 C3-a 协议层看**可以允许 C3b 协议接线**，但仍不声称 World/Agent 端到端，C2 架构由 Reviewer 独立判，不因本报告外推。

---

## 1. Gate 一行式（完整输出在 `c3a-bounds-final/`）

- PASS `npx tsc --noEmit`（快照）退出码 0 → `01-typecheck.log`
- PASS `npm test`（快照）**24 files / 391 tests** → `02-unit.log`
- PASS `npx vite build --outDir …/c3a-bounds-final/frozen-dist` 13.78s（保留基线 500kB chunk 警告）→ `03-build.log`
- PASS `npm run game:mcp:build`（301.22 kB）→ `03b-mcp-build.log`
- PASS default StationZero MCP smoke：`initialize` + `tools/list` = **6 个 Player 工具**，与 C3-a/C3-b 无关的 StationZero 默认通道无回归 → `04-mcp-smoke.log`
- PASS `npx vite-node tester-bounds-gateway.ts`（**267/267** 正确契约检查，0 findings）→ `05-gateway-bounds-probe.log`
- PASS `npx vite-node tester-bounds-http.ts`（真实 HTTP 桥，**31/31** 检查，0 findings）→ `06-http-bounds-probe.log`

> 旧探针未作为验收依据；本报告使用按 a53bfa7 新契约重写的探针，不接受“33/35”之类混合结果。

## 2. 512 硬配额（cache + evicted 总计）—— PASS

默认 gateway（`MAX_DEDUP_RECORDS=512`、`maxCacheEntries=128`）长流量 400 次 submit+ACK（每次 1 request + 1 action）：

| ops | dedup | reqCache | actCache | evReq | evAct | total | pending |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 100 | 200 | 100 | 100 | 0 | 0 | 200 | 0 |
| 200 | 400 | 128 | 128 | 72 | 72 | 400 | 0 |
| 256 | **512** | 128 | 128 | 128 | 128 | **512** | 0 |
| 300 | 512 | 128 | 128 | 128 | 128 | 512 | 0 |
| 400 | 512 | 128 | 128 | 128 | 128 | 512 | 0 |

- 每个检查点 `dedupRecords === cache+evicted 总数`，从未超过 512；第 **257** 次新提交开始整批 `E_RESOURCE_LIMIT`（`world.session_quota`），此后 300/400 次均保持 512。
- 极小 cache 长流量（`maxCacheEntries=2`、quota=64，32 次 submit+ACK）：8/16/24/32 次检查点分别为 16/32/48/64，始终 `total=dedup=2*ops`，eviction 与 ACK 边缘无重复计数；第 33 次起 `E_RESOURCE_LIMIT`，之后保持 64。
- **保留去重集合的语义**：evicted 集合用于在一个会话内记住已淘汰的 request/action，防止淘汰后重试再次入队/执行；它由同一个 `dedupRecords` 硬配额约束，**不是无界内存**。`yield/LOST` 只把 cache 归档进 evicted（总数不变），不释放；`close` 删除 session、`dispose` 清空所有 session 才释放。该设计在 quota 内是有限的。

## 3. 旧 retry / 批原子性 / 预算 —— PASS

- 淘汰后的同 requestId+payload、或新 requestId+已淘汰 actionId：均 `E_RETRY_AFTER_EVICTION`，不重入队；quota 已满时同样优先返回该拒绝，不会二次执行或二次收费。
- 批配额原子失败：quota=8、已有 6 条时提交“2 个新 action”的批（需 3 条）→ 整批 `E_RESOURCE_LIMIT`，`dedupRecords`/cache/evicted/pending 全部不变，新 requestId/actionId 均未落库；随后“1 action”批恰好补到 8 成功。
- pending 预算独立：`maxPendingActions=2` 时第 3 个 `E_RESOURCE_LIMIT world.pending_limit`，ACK 后释放并可再提交；过期/ACK 不消耗 dedup 记录数。
- 失败路径不先收费/不泄露：
  - schema 错误 → `E_SCHEMA`，dedup/pending 不变，错误 request/action id 不进入 cache/evicted；
  - 同 requestId 异 payload → `E_ID_PAYLOAD_MISMATCH`，无新增记录；
  - 同 actionId 异 payload → 拒绝、无新增记录；
  - quota 满时的 payload mismatch → 观察到的错误为 `E_RESOURCE_LIMIT`（quota 检查先于指纹校验；**未收费、未泄漏 id**）；schema 错误仍在 quota 前返回 `E_SCHEMA`；
  - ACK 错误 requestId / appliedTick < acceptedTick → 拒绝、pending 不被消费、无收费。

## 4. yield / LOST / authorize / close / dispose —— PASS

- `yield`：epoch+1、pending/cache 清空，cache 归档进 evicted（总数仍 8/8，不增长）；旧 request 重试仍 `E_RETRY_AFTER_EVICTION`；显式 `authorize(epoch+1)` 后新 work 仍受同一 quota 限制（8 已满 → `E_RESOURCE_LIMIT`），不能借 epoch 绕开。
- LOST 同理：`reapExpired` 只归档不释放，重新 `authorize` 后 quota 仍有效。
- `close`：session 被删除，原集合可 GC；同 Origin close 200，close 后 heartbeat 404。
- `dispose`：所有 session 清空。
- **新 handshake 需显式 `authorized:true`**：`authorized:false` 或无该字段 → 403 `world.authorization_required`；`true` 才创建新 session，新 session `dedupRecords=0`、quota 重新可用。注意这是 API 显式确认标志，不是可验证的人类身份。

## 5. Origin 绑定 / 同 tick / 认证 —— PASS

- **close 跨 Origin**：5199 用同一 token close 5173 握手的 session → **403 `world.origin_mismatch`**；原 session 仍存活（heartbeat 200、observation 200），随后同 Origin close 200。
- 其他受权操作（observation/heartbeat/next-action/action-ack/yield）在上一轮已验证 Origin 绑定；本轮 close 缺口已关闭。
- **同 tick 同 payload**：HTTP 200，幂等，不改变 latest；**同 tick 异 payload**：HTTP **409 `E_TICK_CONFLICT`**，latest tick 仍为 10，TTL 基线仍 10/15；之后同 tick 原 payload 再次提交仍幂等。
- **旧 tick**：HTTP 409 `E_STALE_TICK`，latest/TTL 基准不回滚（acceptedTick 仍 10）。
- **新 epoch**：`yield` → epoch 2；显式 `gateway.authorize` 后，epoch 2 的 tick 1 被接受，TTL 基线重置为 1（旧 epoch 仍 409）。桥本身仍无 re-authorize 路由（需 close+新握手或 gateway 层显式授权）。
- 认证/CORS 严格：无/错 Origin 403 且无 CORS；预检 204 只回显允许 Origin；无/错 token 401 且 token 不回声；`authorized:false`/缺失 403；重复握手 409；body 9000B 413。

## 6. ACK 边界与 pending/cleanup —— PASS

- ACK 契约：`appliedTick < acceptedTick` → `E_SCHEMA`；`== acceptedTick` → applied；`== applyByTick` → applied；`> applyByTick` → expired。
- pending：满 2 拒绝第 3，ACK 后释放；tick/wall 过期释放；`dedupRecords` 不因 ACK/过期增加。

## 7. 精确 commit / 快照哈希

- commit `a53bfa7036b2f491e354565f53ffcb8e36c40318`，父 `0ac1814ffbe0a206954d7941f6c4d323413f9eec`
- 快照关键 MD5：`worldGateway.ts 64ef84cc…`、`worldGateway.test.ts 1df62d7c…`、`worldBridgeServer.ts 746b5fdb…`、`worldBridgeServer.test.ts 23b03b0e…`、`worldProtocol.ts d4c70a84…`、`protocol.ts d67bef1f…`；首尾复核一致（`00-frozen-state.log` / `07-final-state.log`）
- 产物：`frozen-dist/index.html 20911c99…`、`main-DNaeVFYl.js 2b4247e8…`

## 8. F1/F2/F3 状态、C3b 判断与限制

| 项 | 状态 |
| --- | --- |
| F1 旧 tick 回滚 / TTL 基准 | **关闭**（stale 409、同 tick 同 payload 幂等、异 payload 409、TTL 不回滚） |
| F2 淘汰后重试双执行 | **关闭**（E_RETRY_AFTER_EVICTION、不重入队、批原子），且去重集合由 512 硬配额界定，不再无界 |
| F3 Origin 绑定 / ACK 边界 | **关闭**（逐操作 Origin、close 也绑定、ACK accepted<=applied<=deadline） |
| 512 有界内存 | **PASS**：cache+evicted <=512，长流量稳定；yield/LOST 保留但总数不变，close/dispose 释放 |
| C3b 协议接线 | 从 C3-a 协议层看**允许进入 C3b 接线**；但 C2 架构由 Reviewer 独立验收，且当前没有 World/Agent 端到端，**不得宣称可接管** |
| 限制 | 配额是会话生命周期硬上限（512 条 record）；达到后必须 close + 经显式 `authorized:true` 的新 handshake（无自动轮换/GC 策略）；HTTP 仍无 action-submit / re-authorize 路由；ACK 仍由浏览器权威；新 handshake 的“人类确认”只是 `authorized:true` API 标志，不是身份验证；协议层不等于 World/Agent 接入 |

## 9. 复现

```bash
cd D:/Project/LAST_SIGNAL
git rev-parse a53bfa7          # a53bfa7036b2f491e354565f53ffcb8e36c40318
mkdir -p D:/Project/AI-NATIVE-02-snapshots/a53bfa7
git archive a53bfa7 | tar -x -C D:/Project/AI-NATIVE-02-snapshots/a53bfa7
powershell -NoProfile -Command "New-Item -ItemType Junction -Path 'D:\Project\AI-NATIVE-02-snapshots\a53bfa7\node_modules' -Target 'D:\Project\LAST_SIGNAL\node_modules'"
cd D:/Project/AI-NATIVE-02-snapshots/a53bfa7
npx tsc --noEmit && npm test
npx vite build --outDir "D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c3a-bounds-final/frozen-dist" --emptyOutDir
npm run game:mcp:build
cp D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c3a-bounds-final/probe-bounds-gateway.ts ./tester-bounds-gateway.ts
cp D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c3a-bounds-final/probe-bounds-http.ts ./tester-bounds-http.ts
npx vite-node tester-bounds-gateway.ts   # 267/267 PASS
npx vite-node tester-bounds-http.ts      # 31/31 PASS
rm tester-bounds-gateway.ts tester-bounds-http.ts
```
