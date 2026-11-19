# 门禁逐行 — c2a31af 来源绑定定向复核

被测：`c2a31af609b8305ce5917d88d0a425a4af24a29c`（父 `4b938a5…`）
快照：`D:\review-origin\snap`（2048 tracked，逐 blob diff=0）；对照 `D:\review-tail\snap`（4b938a5）、`D:\review-race\snap`（c233e5c）
端口：自有 **5533**（启动前确认空闲、启动后核对命令行、结束仅 kill 自己 PID，0 残留）
本目录：`D:\Project\LAST_SIGNAL\reports\ai-native-02\reviewer\signal-origin-final\`

| # | 结论 | 门禁 | 实际命令 | 结果 | 日志（绝对路径） |
|---|---|---|---|---|---|
| 1 | **PASS** | 精确 hash + 父 + 隔离快照 | `git rev-parse c2a31af; git rev-parse c2a31af^; git archive \| tar -x` + 全量 `git hash-object` vs `git ls-tree` | `c2a31af…`，父 `4b938a5…`；**2048 文件 diff 0 行** | `…\tracked-blobs-c2a31af.txt`、`…\tracked-blobs-snapshot.txt` |
| 2 | **PASS** | 类型检查 | `npx tsc --noEmit` | exit 0，0 字节 | `…\logs\gate-typecheck.log` |
| 3 | **PASS** | MCP 构建 | `npx vite build --config vite.mcp.config.ts` | exit 0 | `…\logs\gate-mcp-build.log` |
| 4 | **PASS** | 相关 unit（core Signal / headless / 房界 / companion） | `npx vitest run signalCombat signalState companionGateway companionRoomGeneration worldHeadlessSignal` | **59/59 passed**（5 文件；含新增三顺序 + scan/jam 范围拒绝四例） | `…\logs\gate-tail-units.log` |
| 5 | **PASS** | Owner 最小回归 | `npx vitest run ownerAuth companionBridge worldBridgeServer companionFacet companionInsights` | **48/48 passed**（5 文件） | `…\logs\gate-owner-minimal.log` |
| 6 | **PASS** | 三顺序 + 双伪造 origin（我的核心探针） | `npx vitest run src/world/sim/zz-originBinding.probe.test.ts` | **c2a31af 7/7**：O1 旧房确认、teleport 前提交→ACTIVE/1 event；**O2 旧 origin 过门后提交→拒（relay/manual/powered 不变，0 events）**；O2b origin=设备房≠当前房→拒；O2c origin=当前房≠设备房→拒；**O3 人类 R 无 binding 跨房→ACTIVE/1 event**；O4 scan/jam 不扣费；O5 JSON clone 保留 binding | `…\logs\probe-origin-binding-c2a31af.log`（源码 `…\zz-originBinding.probe.test.ts`） |
| 7 | **PASS（对照）** | 同一探针在 4b938a5 与 c233e5c | `npx vitest run src/world/sim/zz-originBinding.probe.test.ts`（各自快照） | **4b938a5：O3 失败**（`expected 'INACTIVE' to be 'ACTIVE'`，人类 R 回归）；**c233e5c：O2/O2b/O2c 失败**（无来源保护）。失败集合互补，证明 c2a31af 是“按来源绑定”而非换位置 | `…\logs\probe-origin-binding-4b938a5.log`、`…\logs\probe-origin-binding-c233e5c.log` |
| 8 | **PASS** | 仓库新增真实 UI 规格 | `PORT=5533 npx playwright test tests/signal-human-crossroom.spec.ts --project chromium` | **1 passed**（R 控制旧房设备） | `…\logs\gate-human-crossroom-spec.log` |
| 9 | **PASS** | 与 c233 同 spec 的浏览器对照 | `PORT=5533 npx playwright test tests/zz-crossroom-human-toggle.spec.ts`（c233 基线用 5532 跑的同一份） | c2a31af：房 5 `toggleRelay(false)` → INACTIVE/manual=false/exitOpen=false/HUD `EXIT CLOSED`；按 R → ACTIVE/EXIT OPEN。**与 c233 基线逐字段相同**（4b938a5 时两者都是 no-op） | `…\logs\probe-browser-human-toggle-c2a31af.log`（c233 基线见 `…\reviewer\signal-tail-final\logs\probe-browser-human-toggle-c233e5c.log`） |
| 10 | **PASS** | Agent 不能伪造 originRoomId | `npx vitest run src/zz-probe/originForge.probe.test.ts` | `echo_suggest{…,originRoomId:3}` → `MCP error -32602: Unrecognized key: "originRoomId"`（**网络前**拒绝）；同调用去掉该字段 → 到网络层失败（`E_NOT_APPLICABLE`），证明 schema 是唯一闸门 | `…\logs\probe-agent-forge.log`（源码 `…\originForge.probe.test.ts`） |
| 11 | **PASS** | 来源可达性（源码） | `grep -rn "originRoomId" src/ --include=*.ts`（排除测试） | 只有 `core.ts:133/565/567`（类型+校验）与 `World.ts:316/400`（唯一产出点，在 `enqueueCompanionAction` 内，取 `roomIdValue`=确认时当前房）；`toggleRelay/playerSignal*/enqueueSignalCommandByActor` 全不带 binding | 源码（快照，同 #1 hash） |
| 12 | **PASS** | 跨端（core 有改动） | `PORT=5533 npx playwright test tests/signal-rendered-parity.spec.ts` + `npx vitest run src/ai-native/signalRenderedHeadlessParity.test.ts` | 导出 1 passed；重放 **3/3 passed**（逐字节 + 分歧负向 + 缺文件必红） | `…\logs\gate-parity-export.log`、`…\logs\gate-parity-replay.log` |
| 13 | **PASS（源码级）** | core 拒绝不发事件 / 收据语义 | 见 #6 O2 + 读 `core.ts:556-575`、`GameScene.ts` apply 闭包 | 拒绝时 `break` 在 `events.push` 前 → 0 events、设备三字段不变；收据仍是“确认已投递并被 tick 消费”（`enqueueSignalCommand` 返回 true → `postApplied`）。**未扩大到“所有 action 物理效果”**；toggle 被拒时无事件痕迹属记录项 | `…\logs\probe-origin-binding-c2a31af.log` |
| 14 | **PASS（源码级）** | binding 的持久/恢复表现 | 读 `core.ts:1326-1328/1351/1383`、`types/index.ts:98-109` | `cloneSimulationState` 为 JSON 深拷贝 → binding 保留；`canonicalSimulationState` 含 `pendingCommands` → 保留（O5 实测）；`CoreCheckpointState` **不持久化 pendingCommands**（既有行为）→ 不存在“有命令无 binding”的恢复态 | 同 #1 快照 |
| 15 | **NOT RUN（按指令）** | 全量单测 / 完整 Run / 新模型回合 / 跨平台 | — | 上一轮已关闭的 stale 回执与 notify 竞态不重开 | — |

## 失败行

无 FAIL。两条**记录项**（非阻断）：

1. `probe-origin-binding-4b938a5.log`（对照用的旧提交，非被测）：
   `× O3 human R (no binding) from the NEW room still toggles the device left behind` → `expected 'INACTIVE' to be 'ACTIVE'`（这正是本轮修好的回归）。
2. `probe-origin-binding-c233e5c.log`（对照用的更旧提交）：
   `× O2 / O2b / O2c`（当时无来源保护）。
