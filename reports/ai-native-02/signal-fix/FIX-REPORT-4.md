# FIX-REPORT-4 — 跨房间 Signal 命令残留（Reviewer 两个非阻断残留）

- Commit: `4b938a5f02af319b8eaebeabff3dc1708cbdf4da`
- Parent: `c233e5c`
- Branch: `feat/ai-native-world-integration`
- Scope: 9 tracked files, +184/−26
- 未 merge / 未 push / 未 stash / 未改动旧 evidence

## 1. `markApplied` 不再把已取消记录翻成 applied

`CompanionGateway.markApplied` 在 `record.stale` 时强制要求显式 `execution.generation` 与
`execution.roomId` 同时等于记录本身；缺任一或不等 → `E_STALE_GENERATION
companion.applied_generation_mismatch`。非 stale 记录保持旧兼容：省略 evidence 仍接受，
给出但不等仍拒绝。因此普通旧 generation 的迟到真实回执仍可如实记录，而 construct/old client
省略证据不能伪造 applied。

证据：
- `src/ai-native/companionGateway.test.ts` 新增 stale 记录矩阵（省略 / 错 generation /
  错 room / 原 generation+room）。
- `src/ai-native/companionRoomGeneration.test.ts` 原 stale 成功用例补 `roomId: ROOM_A`。

## 2. 已确认的 `toggle-relay` 绑定产生它的房间

`commitToggleRelay(device, enabled, tick, currentRoomId?)`：当 `currentRoomId` 提供且
`device.roomId !== currentRoomId` 时返回 `E_PERMISSION`，不写 `manualEnabled / control /
relay`，`core.ts` 在 `!result.ok` 时直接 `break`，因此不发 `signal-relay-changed`。
`core.ts` 在 commit 时用 `roomAt(...)` 取玩家当前房间。

结果：
- `confirm 入队 → 同一 tick 的真实 portal 命令`：toggle 仍在旧房间执行一次，随后传送；
  relay/exit 变化属于旧房间。
- `先传送 → 旧 toggle 后到`：拒绝，relay/exitOpen 不变，无 commit 事件。
- 新房间合法 toggle / scan / jam 行为不变；scan/jam 原本就由核心合法性拦截，不会扣新房间能量
  或写重复 evidence。

## 3. 测试夹具修正

Signal 夹具原先硬编码 `roomId: 0`，在真实房间 id 非 0 时会被新绑定规则拒绝。现统一用
`roomAt(state.map.rooms, player)` 取实际房间：`signalState.test.ts`、`signalCombat.test.ts`、
`worldHeadlessSignal.test.ts`、`worldHeadlessHarness.ts`。

## 4. 门禁（每条一行）

| 命令 | 结果 | 日志绝对路径 |
|---|---|---|
| `npx tsc --noEmit` | PASS exit 0（0 字节） | `D:\Project\LAST_SIGNAL\reports\ai-native-02\signal-fix\tsc-6.log` |
| `npm run game:mcp:build` | PASS exit 0 | `D:\Project\LAST_SIGNAL\reports\ai-native-02\signal-fix\mcp-build-6.log` |
| `npm run build` | PASS exit 0 | `D:\Project\LAST_SIGNAL\reports\ai-native-02\signal-fix\vite-build-4.log` |
| `npx vitest run` | PASS 743/743（64 files） | `D:\Project\LAST_SIGNAL\reports\ai-native-02\signal-fix\full-suite-final.log` |
| 6 个 Signal/Companion 定向文件 | PASS 60/60 | `D:\Project\LAST_SIGNAL\reports\ai-native-02\signal-fix\targeted-4.log` |
| `signalCombat.test.ts`（含双顺序） | PASS 32/32 | `D:\Project\LAST_SIGNAL\reports\ai-native-02\signal-fix\signal-combat-order.log` |
| 去掉房间 guard 的 RED（双顺序之一必须失败） | RED 1 failed / 3 passed | `D:\Project\LAST_SIGNAL\reports\ai-native-02\signal-fix\RED-toggle-room.log` |
| 7 个 Playwright 真实浏览器 spec | PASS 12/12（35.0s） | `D:\Project\LAST_SIGNAL\reports\ai-native-02\signal-fix\playwright-final-4.log` |
| 真实 rendered→headless replay | PASS 3/3 | `D:\Project\LAST_SIGNAL\reports\ai-native-02\signal-fix\parity-replay-4.log` |
| `worldBridgeServer.test.ts` + `agentLease.test.ts` 隔离复跑 | PASS 15/15 | `D:\Project\LAST_SIGNAL\reports\ai-native-02\signal-fix\recheck-bridge-lease-2.log` |

说明：第一次并行全量跑（`full-suite-4.log`）出现已知 CPU 饥饿型
`worldBridgeServer` heartbeat→409 单例失败；随后隔离复跑 15/15 通过，最终完整全量
`full-suite-final.log` 743/743 通过。未修改相关代码。

## 5. NOT RUN

- Reviewer 对本 commit 的独立定向复核。
- Lead 真实模型跨房间 Signal 重跑。
- Tester 独立复跑。
- 真实人类（非 auto-click）Owner 验收。
