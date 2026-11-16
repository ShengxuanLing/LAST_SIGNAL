# AI-NATIVE-02 C3-a 修复独立验收（F1/F2/F3 + 内存边界）

- Worker `y6en9ua8phanll8cqi8dd8ru`，专属目录 `reports/ai-native-02/tester/c3a-fixes-final/`
- 目标冻结提交：`0ac1814ffbe0a206954d7941f6c4d323413f9eec`（完整 hash；父 `a8232c8772024a40ac2efe46aa616e31aa88bdec`），分支 `feat/ai-native-world-integration`
- 隔离：`git archive 0ac1814` → `D:/Project/AI-NATIVE-02-snapshots/0ac1814`（仅已跟踪文件 + `node_modules` junction）；独立临时 HTTP 端口（ephemeral，实际由桥自选）；未切共享分支、未改源码/测试/配置、未读取/恢复 `stash@{0}`（C3-b prep 保持原样）。
- 旧探针已按**正确契约**重写，不是简单把旧断言翻转：F1 断言 stale 被拒且 TTL 基线不变；F2 断言淘汰后重试返回 `E_RETRY_AFTER_EVICTION` 且不重入队；F3 断言 ACK 下界/上界与逐操作 Origin 绑定。
- **结论：C3-a F1/F2/F3 功能契约 PASS（新探针 34/34 + 29/29）**；但发现**接 C3b 前必须修的有界性问题**（F2 修复引入无上限 `evictedRequestIds/evictedActionIds`），另有 1 个残余 Origin 绑定缺口（close）。C2 架构不由本单判定。

---

## 1. Gate 一行式（完整输出均在 `c3a-fixes-final/`）

- PASS `npx tsc --noEmit`（快照）退出码 0 → `01-typecheck.log`
- PASS `npm test`（快照）**24 files / 381 tests** → `02-unit.log`
- PASS `npx vite build --outDir …/c3a-fixes-final/frozen-dist` 11.29s（保留基线 500kB chunk 警告）→ `03-build.log`
- PASS `npm run game:mcp:build`（`dist-mcp/mcpServer.mjs 301.12 kB`）→ `03b-mcp-build.log`
- PASS default StationZero MCP smoke：`initialize` + `tools/list` = **6 个 Player 工具** → `04-mcp-smoke.log`
- PASS `npx vite-node tester-c3a-fixes-gateway.ts`（F1/F2/F3 + 预算/缓存/内存，34/34）→ `05-gateway-fixes-probe.log`
- PASS `npx vite-node tester-c3a-fixes-http.ts`（真实 HTTP 桥，29/29）→ `06-http-fixes-probe.log`

## 2. F1（旧 tick 回滚 / TTL 基线）——已关闭

- 真实 HTTP：tick 5 后发送 tick 4 → **409 `E_STALE_TICK`**；`listSessions().tick` 仍为 5。
- TTL 基线：stale 之后 `submitActions(ttl=10)` → `acceptedTick=5 / applyByTick=15`（不再从 4/50 延长）。
- **同 tick 冲突策略**：同 tick 的新 observation 被接受，**last-write-wins**（白名单内容更新，tick/TTL 基线仍为该 tick）。这是当前实现策略；若要求同 tick 内容冲突必须拒绝，需在 C3b 前明确。
- **epoch 重置**：yield → epoch 2；显式 `gateway.authorize(session, 2)` 后，epoch 2 的 tick 1 被接受、TTL 基线为 1（合法重置）。注意：桥仍**没有 re-authorize 路由**，HTTP 侧只能 close + 重新握手（见 §5 F4）。

## 3. F2（淘汰后重试双执行）——功能已关闭，但引入无界内存（必须修）

- 小缓存（`maxCacheEntries=2`）淘汰后：
  - 重发同一 `requestId + payload` → **`E_RETRY_AFTER_EVICTION`**，不重入队；
  - 用新 requestId + 已淘汰 actionId → **`E_RETRY_AFTER_EVICTION`**，不重入队；
  - `pending` 中不再出现被淘汰的 action。
- **批原子性**：批 `[新 action, 已淘汰 action, 新 action]` 整体拒绝，两个新 action 均未部分入队。
- **必须修（接 C3b 前置硬问题）**：`evictedRequestIds` / `evictedActionIds` 是**无上限 Set**（源码注释明确“NOT capped”；只有审计 ring 有上限）。
  - 3000 次 submit+ACK（`maxCacheEntries=2`）后：两个 Set 各 **2998** 个 id；每 1000 次线性增长（998 → 1998 → 2998）；堆增量约 +15.4MB（未强制 GC，仅指示性）。
  - **epoch/断线释放**：`yieldSession` 清 pending/cache 但**不释放**两个 Set（仍 2998/2998）；`reapExpired`（LOST）同样不释放；只有 `closeSession` 删除整个 session（对象可 GC）和 `dispose` 清空所有 session 才释放。
  - 没有“每会话总操作上限 / 单调水位 / 有界窗口”策略；requestId/actionId 是随机 hex，不能直接用单调水位，需要协议层序号或显式会话操作配额。
  - 结论：**F2 的“防双执行”不能以无界内存换取**。C3b 前必须给出有界策略（会话操作上限 + 明确资源错误、或有界幂等窗口 + 协议序号水位、或持久化去重），否则长会话内存无限增长。

## 4. F3（Origin 绑定 / ACK 边界）——基本关闭，close 有残余缺口

- ACK 边界已收紧：`appliedTick < acceptedTick` → `E_SCHEMA`；`== acceptedTick` → applied；`== applyByTick` → applied；`> applyByTick` → expired。满足 `accepted <= applied <= deadline`。
- 逐操作 Origin 绑定（session 由 5173 握手，用 5199 同 token）：
  - observation / heartbeat / next-action / action-ack / yield 全部 **403 `world.origin_mismatch`**；
  - 同 Origin 的操作正常（next-action 200、ACK applied）。
- **残余缺口（中）**：`/world-link/close` **未调用 `originMatches`**。实测 5199 用同一 token 可以 close 5173 握手的 session（200），即跨允许 Origin 可以强制断开别人的会话。建议 close 同样校验 session 的 handshakeOrigin。
- token/CORS/未授权仍严格：无/错 Origin 403 且无 CORS；预检 204 且只回显允许 Origin；无/错 token 401、token 不回显；`authorized:false` 403；重复握手 409；body 9000B 413。

## 5. 其余契约与设计限制

- 缓存/预算：request/action cache 受 `maxCacheEntries` 限制；pending 受 `maxPendingActions` 限制；ACK/过期后预算释放；`close` 删除 session、`dispose` 清空。
- Bounded 缓存与 unbounded evicted Set 的对比已实测：cache 稳定 ≤2、pending 0，而 evicted Set 线性增长（§3）。
- F4（沿用上轮，非缺陷）：桥无 action-submit HTTP 路由（`submitActions` 只经 gateway/单测），无 re-authorize 路由（LOST/YIELD 后只能 close+重新握手）；ACK 仍由浏览器权威，gateway 只做范围校验；**没有真实 World/Player/Scene 接入，也没有真实 Agent/LLM，fake adapter 不算接入**。
- 目标父链包含 C2 修复提交 `a8232c8`，但 **C2 架构是否通过由 Reviewer 独立判定**，本报告不外推整体通过，也不把 C3-a 协议结果说成可接管。

## 6. 硬阻断 / 限制 / 可接线判断

| 项 | 判定 |
| --- | --- |
| F1 旧 tick 回滚 | **已关闭**（stale 409、TTL 基线不变、epoch 重置合法） |
| F2 淘汰后重试双执行 | **功能关闭**（E_RETRY_AFTER_EVICTION、无重入队、批原子） |
| F2 无界内存 | **C3b 前必须修（硬问题）**：无上限 evicted Set、yield/LOST 不释放、无会话操作上限/水位；长会话内存无限增长 |
| F3 逐操作 Origin / ACK 边界 | **基本关闭**；**close 未绑定 Origin**（中等残余） |
| token/CORS/未授权 | 严格拒绝，PASS |
| C2 架构 | **本单不判**；由 Reviewer 独立负责；不因本报告通过而外推 |
| 可接线判断 | C3-a 语义层面可在修完无界内存 + C3b 决策（同 tick 冲突、re-authorize/action-submit 通道）后接线；**当前不可宣称可接管** |

## 7. 复现

```bash
cd D:/Project/LAST_SIGNAL
git rev-parse 0ac1814          # 0ac1814ffbe0a206954d7941f6c4d323413f9eec
mkdir -p D:/Project/AI-NATIVE-02-snapshots/0ac1814
git archive 0ac1814 | tar -x -C D:/Project/AI-NATIVE-02-snapshots/0ac1814
powershell -NoProfile -Command "New-Item -ItemType Junction -Path 'D:\Project\AI-NATIVE-02-snapshots\0ac1814\node_modules' -Target 'D:\Project\LAST_SIGNAL\node_modules'"
cd D:/Project/AI-NATIVE-02-snapshots/0ac1814
npx tsc --noEmit && npm test
npx vite build --outDir "D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c3a-fixes-final/frozen-dist" --emptyOutDir
npm run game:mcp:build
cp D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c3a-fixes-final/probe-gateway-fixes.ts ./tester-c3a-fixes-gateway.ts
cp D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c3a-fixes-final/probe-http-fixes.ts ./tester-c3a-fixes-http.ts
npx vite-node tester-c3a-fixes-gateway.ts   # 34/34 PASS + 内存 findings
npx vite-node tester-c3a-fixes-http.ts      # 29/29 PASS + close 残余
rm tester-c3a-fixes-gateway.ts tester-c3a-fixes-http.ts
```

快照哈希：`worldGateway.ts e5c3990e…`、`worldBridgeServer.ts fea3403e…`、`worldGateway.test.ts 5e710d16…`、`worldBridgeServer.test.ts 1543011e…`、`protocol.ts 193440ba…`、`core.ts b0259e96…`、`World.ts 7093b37e…`、`Boss.ts 044fb93c…`；首尾一致（`00-frozen-state.log` / `07-final-state.log`）。`stash@{0}` 未读未恢复。
