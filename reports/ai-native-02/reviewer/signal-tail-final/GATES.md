# 门禁逐行 — 4b938a5 两尾项定向复核

被测：`4b938a5f02af319b8eaebeabff3dc1708cbdf4da`（父 `c233e5c…`）
快照：`D:\review-tail\snap`（2047 tracked，逐 blob diff=0）；对照快照 `D:\review-race\snap`（c233e5c）
端口：**5531**（4b938a5）/ **5532**（c233e5c），均为我自己启动并核对命令行后清理；5376 为他人 preview 进程，未触碰
本目录：`D:\Project\LAST_SIGNAL\reports\ai-native-02\reviewer\signal-tail-final\`

| # | 结论 | 门禁 | 实际命令 | 结果 | 日志（绝对路径） |
|---|---|---|---|---|---|
| 1 | **PASS** | 精确 hash + 父 + 隔离快照 | `git rev-parse 4b938a5; git rev-parse 4b938a5^; git archive \| tar -x` + 全量 `git hash-object` vs `git ls-tree` | `4b938a5…`，父 `c233e5c…`；**2047 文件 diff 0 行** | `…\tracked-blobs-4b938a5.txt`、`…\tracked-blobs-snapshot.txt` |
| 2 | **PASS** | 类型检查 | `npx tsc --noEmit` | exit 0，0 字节 | `…\logs\gate-typecheck.log` |
| 3 | **PASS** | MCP 构建 | `npx vite build --config vite.mcp.config.ts` | exit 0 | `…\logs\gate-mcp-build.log` |
| 4 | **PASS** | 相关 unit（含 core Signal / headless / 房界） | `npx vitest run companionGateway companionRoomGeneration companionRoomBoundary signalState signalCombat worldHeadlessSignal` | **61/61 passed**（6 文件） | `…\logs\gate-signal-tail-units.log` |
| 5 | **PASS** | Owner 最小回归 | `npx vitest run ownerAuth companionBridge worldBridgeServer companionFacet companionInsights` | **48/48 passed**（5 文件） | `…\logs\gate-owner-minimal.log` |
| 6 | **PASS** | 跨端新导出（core 有改动） | `PORT=5531 npx playwright test tests/signal-rendered-parity.spec.ts --project chromium` | 1 passed | `…\logs\gate-parity-export.log` |
| 7 | **PASS** | 跨端重放 3 例 | `npx vitest run src/ai-native/signalRenderedHeadlessParity.test.ts` | **3/3 passed**（逐字节 + 分歧负向 + 缺文件必红） | `…\logs\gate-parity-replay.log` |
| 8 | **PASS** | 尾项 1：stale 回执证据 | `npx vitest run src/zz-probe/staleReceipt.probe.test.ts` | **5/5**：S1 省略→拒；S2 错世代→拒；S3 错房号→拒；S4 原世代+原房→**applied**；S5 非 stale 省略→接受 | `…\logs\probe-stale-receipt.log`（源码 `…\staleReceipt.probe.test.ts`） |
| 9 | **FAIL（scope 回归）** | 尾项 2：跨房 toggle 在 core 的双排序 | `npx vitest run src/world/sim/zz-crossRoomToggle.probe.test.ts`（4b938a5 与 c233e5c 各一次） | 4b938a5：T1 房内 ACTIVE/1 event；**T2 过门后 toggle → INACTIVE/0 events（静默拒绝）**；T3 teleport 前的 toggle → ACTIVE/1 event；T4 跨房 scan/jam 不扣费。c233e5c：**T2 → ACTIVE/1 event（正常）** | `…\logs\probe-core-crossroom-toggle-4b938a5.log`、`…\logs\probe-core-crossroom-toggle-c233e5c.log` |
| 10 | **FAIL（人类操作回归）** | 真实浏览器：过门后人类 R / 玩家 toggle | `PORT=5531 npx playwright test tests/zz-crossroom-human-toggle.spec.ts`（4b938a5）与 `PORT=5532 …`（c233e5c） | 4b938a5：房 5 里 `world.toggleRelay(false)` 与按 **R** 均 no-op（HUD 仍 `RELAY ACTIVE … EXIT OPEN`）；c233e5c：`toggleRelay(false)` → `RELAY INACTIVE … EXIT CLOSED`，再按 R → 回到 `ACTIVE`（双向可用）。两次均 `optInVia:"pause-ui"`（真实设置面板） | `…\logs\probe-browser-human-toggle-4b938a5.log`、`…\logs\probe-browser-human-toggle-c233e5c.log`（源码 `…\zz-crossroom-human-toggle.spec.ts`） |
| 11 | **PASS（含 1 条源码推断）** | core 拒绝是否发事件 / 收据是否假 applied | 同上 #9 + 读 `core.ts`/`World.ts`/`GameScene.ts` | 拒绝时**不发** `signal-relay-changed`（T2 events=0）；但 `enqueueSignalCommand` 仍返回 true → 渲染端会 postApplied（**源码推断**；我浏览器探针里 `enqueueCompanionAction` 返回 false 是因为该 run 未 enable echo，已披露） | `…\logs\probe-core-crossroom-toggle-4b938a5.log` |
| 12 | **PASS** | 人类控制未被其它路径连带限制 | 读 `core.ts` `signal-power` 分支；跑 #4 | 只有 toggle 分支加了房号守卫；scan/jam 走既有 legality（不扣费）；无设备时 `break` 在守卫前（旧行为不变） | `…\logs\gate-signal-tail-units.log` |
| 13 | **NOT RUN（按指令）** | 全量单测 / 完整 Run / 新模型回合 | — | 上一轮已关闭的在途竞态与 A/B/C 不重开 | — |

## 失败行（最相关输出）

1. **#9 core 对照（T2）**
   - 4b938a5：`PROBE_T2 {"deviceRoom":5,"playerRoom":0,"relay":"INACTIVE","manual":false,"events":0}`
   - c233e5c：`PROBE_T2 {"deviceRoom":5,"playerRoom":0,"relay":"ACTIVE","manual":true,"events":1}`
2. **#10 浏览器对照**
   - 4b938a5：`"afterApiToggle":{"relay":"ACTIVE","manual":true,"exitOpen":true,"hud":"RELAY ACTIVE | … · EXIT OPEN"},"afterKeyToggle":{…同前…}`
   - c233e5c：`"afterApiToggle":{"relay":"INACTIVE","manual":false,"exitOpen":false,"hud":"RELAY INACTIVE | … · EXIT CLOSED"},"afterKeyToggle":{"relay":"ACTIVE","manual":true,…}`
