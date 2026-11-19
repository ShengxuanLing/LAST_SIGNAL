# FIX-REPORT-5 — 人类 R 跨房控制回归（4b938a5）

- Commit: `c2a31af609b8305ce5917d88d0a425a4af24a29c`
- Parent: `4b938a5f02af319b8eaebeabff3dc1708cbdf4da`
- Branch: `feat/ai-native-world-integration`
- Scope: 5 files, +182/−35
- 未 merge / 未 push / 未 stash / 未改旧 evidence

## 1. 复核 Tester 结论

已读 `reports/ai-native-02/tester/signal-tail-final/SIGNAL-TAIL-FINAL.md` 及
`probe-humanR-crossroom.mts` / `probe-humanR-ui.mts`。确认：

- stale applied 世代门控与 notify 竞态两项本身通过。
- `4b938a5` 的 `commitToggleRelay(..., currentRoomId)` 是**来源无关的全局房间 guard**：
  提交时只要 `device.roomId !== player.roomId` 就拒绝，无法区分
  “旧房 Companion 确认的陈旧命令”与“玩家在新房主动按 R”。
- 真实 UI 对照：c233 在 room B 按 R → APPLIED；4b938a5 → REJECTED。
  该行为回归不作为新玩法规则接受。

## 2. 最小修复：命令来源绑定

- `SimCommand.toggle-relay` 新增 **内部可选** `originRoomId`。仅
  `World.enqueueCompanionAction('toggle-relay')` 在 Owner 确认执行时同步写入
  `this.roomIdValue`；人类 R `World.toggleRelay()` 与 Owner/dev 命令**不带**该字段。
- `core.processCommands` 只在 `originRoomId !== undefined` 时复验：
  `originRoomId === device.roomId` 且 `originRoomId === 玩家当前房间`；否则直接
  `break`，不写 relay/manual/power/exit，也不发 `signal-relay-changed`。
- `commitToggleRelay` 恢复原签名，**删除**广泛 `currentRoom === device.roomId` guard。
- `originRoomId` 未进入任何 MCP / Agent schema；Agent 无法构造该内部字段，也未放宽
  Owner/Actor 权限。scan/jam 仍由核心 range/LOS/cooldown 合法性拦截。

## 3. 三控制同测

`src/world/sim/signalCombat.test.ts`：

1. Companion 绑定命令在旧房入队，随后同一 tick 真实 `teleport-player`：
   toggle 在旧房合法提交一次，relay ACTIVE、exitOpen true、仅 1 个事件。
2. 先提交真实 teleport 到 B，再提交 `originRoomId = A` 的 Companion 命令：
   拒绝，ACTIVE/exitOpen 不变，0 个 `signal-relay-changed`。
3. 人类 R 在 B 无绑定：旧房设备 ACTIVE → INACTIVE、exitOpen false、1 个事件
   （恢复 c233 全局控制）。

另有 scan/jam 跨房不扣能量、不写 evidence 的原测试保留。

真实 UI：`tests/signal-human-crossroom.spec.ts`（opt-in save → NEW RUN → 真实房间
spawn 设备 → room A 按 R ACTIVE → 真实 portal A→B → room B 按 R → INACTIVE）。
未注入隐藏设备，未创建新房间设备。

## 4. 回归门禁（每条一行）

| 命令 | 结果 | 日志绝对路径 |
|---|---|---|
| `npx tsc --noEmit` | PASS exit 0（0 字节） | `D:\Project\LAST_SIGNAL\reports\ai-native-02\signal-fix\tsc-7.log` |
| `npm run game:mcp:build` | PASS exit 0 | `D:\Project\LAST_SIGNAL\reports\ai-native-02\signal-fix\mcp-build-7.log` |
| `npm run build` | PASS exit 0 | `D:\Project\LAST_SIGNAL\reports\ai-native-02\signal-fix\vite-build-5.log` |
| 5 个 Signal/Companion 定向 unit | PASS 59/59 | `D:\Project\LAST_SIGNAL\reports\ai-native-02\signal-fix\targeted-5.log` |
| `signalCombat.test.ts`（含三控制） | PASS 32/32 | `D:\Project\LAST_SIGNAL\reports\ai-native-02\signal-fix\signal-combat-green-5.log` |
| 恢复广泛 room guard 的 RED（人类 R 必须失败） | RED 1 failed：`expected 'ACTIVE' to be 'INACTIVE'` | `D:\Project\LAST_SIGNAL\reports\ai-native-02\signal-fix\RED-humanR-global.log` |
| 真实 UI R 跨房对照 | PASS 1/1（A ACTIVE → portal B → R INACTIVE） | `D:\Project\LAST_SIGNAL\reports\ai-native-02\signal-fix\playwright-humanR-global.log` |
| stale applied 省略证据仍拒 | PASS 1/1 | `D:\Project\LAST_SIGNAL\reports\ai-native-02\signal-fix\stale-applied-still-refused.log` |
| notify 竞态 T1/T2/T3 仍拒 | PASS 3/3 | `D:\Project\LAST_SIGNAL\reports\ai-native-02\signal-fix\notify-race-still-refused.log` |
| 8 个 Playwright 真实浏览器 spec（含 co-op/SDK/Owner/portal/race/parity 导出） | PASS 13/13（43.8s） | `D:\Project\LAST_SIGNAL\reports\ai-native-02\signal-fix\playwright-final-5.log` |
| 新导出 rendered→headless replay | PASS 3/3（字节一致 + 分歧负向） | `D:\Project\LAST_SIGNAL\reports\ai-native-02\signal-fix\parity-replay-5.log` |
| 完整全量（修完串行一次） | PASS 743/743（64 files） | `D:\Project\LAST_SIGNAL\reports\ai-native-02\signal-fix\full-suite-final-5.log` |

未出现本轮负载失败。上一轮 `full-suite-4.log` 的 heartbeat 单例失败属已知 CPU 饥饿，
未修改相关代码，本轮全量未复现。

## 5. NOT RUN

- Reviewer 对本 commit 的独立定向复核。
- Lead 真实模型跨房 Signal 重跑。
- Tester 独立复跑。
- 真实人类（非 auto-click）Owner 验收；Playwright 中的按键与 portal 位置仍为已披露夹具。
