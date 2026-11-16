# C3c 修复：事件历史不可变 + mid-run replay 基线

- 分支 `feat/ai-native-world-integration`；基线 `4cb59e9`（Reviewer 确认 Player intent/action-boundary 已过，剩事件历史浅拷贝与 mid-run replay 两项）。
- 本提交只修这两项，**不实现 P3、不改玩法、不接 Signal**；C3c/P4 仍需独立定向复核。

## 1. 阻断 A：事件历史不可变（core 投递即脱钩）

**根因**：`events.push({ type:'projectile-spawned', projectile })` 持有活 `SimProjectile`（后续 `stepProjectiles` 改 `pos/lifetime/pierce/hitIds`）；`loot-dropped` 持有活 `SimLoot`（`stepLoot` 改 `bob/x/y`）；`player-reset` 持有命令里的 `PlayerData`。`HeadlessWorld.snapshot/restore/fromFrame` 仅 `slice()`，历史引用仍活。

**修复**：
- `src/world/sim/core.ts` 新增 `cloneEventValue()`（JSON 深拷贝，保留完整 IEEE-754 精度，不圆整）。所有 `projectile-spawned`（3 处）、`loot-dropped`（6 处）、`player-reset`（1 处）在**投递时**改为值 DTO，事件不再引用可变 state。
- `HeadlessWorld.runSteps` 存的是这些值 DTO（不重复 clone）。
- `snapshot()` / `restore()` / `fromFrame()` 对 `events` / `actionLog` 做深拷贝（`sim` 本就 `cloneSimulationState`）；`exportFailure` 的 `tailEvents/actionLog` 也深拷贝。
- 结果：保存帧后继续 40+ tick/命中/销毁，`frame` JSON 不变；`restore`/`fromFrame` 后修改输入 frame 不会改活世界；`canonicalEvents()` 历史前缀稳定。
- 回归：`worldHeadlessHistoryReplay.test.ts`（core projectile/loot 事件不可变、snapshot 双向隔离、fromFrame 隔离）；`worldHeadlessSnapshotBoundary.test.ts` 的 post-restore 用例改为比较**完整历史**（baseline+continuation）而非“只比后续事件”。

## 2. 阻断 B：mid-run replay 按 frame.events 基线 offset 比较

**根因**：`replay()` 用 `replayEvents = replayWorld.runSteps(steps)`（仅后续事件）去对 `this.events`（完整历史），mid-run 必然 `firstDivergence=0`。

**修复**（`HeadlessWorld.replay`）：
- `baselineEvents = frame.events.length`。
- `replayWorld.events` = frame.events（基线）+ 新段（`runSteps` 追加）；不再用 `runSteps` 的返回值。
- **保留历史校验**：逐条比较 `this.events[0..baseline)` 与 `frame.events`；不一致 → `historyPreserved=false`，`firstDivergence` 指向真实索引。
- **新段校验**：比较 `this.events[baseline..]` 与 `replayWorld.events[baseline..]`（新增对新增），`firstDivergence = baseline + i`。
- `sameEvents = historyPreserved && newEqual && firstDivergence===null`；同时输出 `baselineEvents`、`historyPreserved`、`eventsTruncated`、full 与 new 段 hash（不圆整）。
- **20k 截断边界**：`baselineEvents >= HEADLESS_MAX_EVENTS` 标 `eventsTruncated:true`；若 `this.events` 已丢失 frame 前缀 → `historyPreserved=false`、`sameEvents=false`，**绝不把丢 prefix 当一致**。
- 失败导出附 `eventsRetained/eventsTruncated`，`replayable:true` 仍只给 boundary 且不误标 mid。
- 回归：tick0 正例；mid-run（20 tick → boundary snapshot → 15 tick continuation）`sameState/sameEvents=true`、`firstDivergence=null`；篡改基线历史 → `firstDivergence` 精确到该索引；不同后续动作 → `firstDivergence >= baselineEvents`（落在新段）。
- 官方 Dev MCP smoke 新增：mid-run `dev_replay` 历史一致 + 篡改基线 `firstDivergence=0`，并保留 boundary 拒收/restore。

## 3. Parity / 夹具刷新（因事件语义修正）

核心事件现在保存**投递时**的值（而非后续被改写的值），因此 C2/C3c 的 canonical events 夹具需要按新语义重生成：
- `npx playwright test tests/c2-parity.spec.ts` 重生成 `reports/ai-native-02/c2/parity/*`；`scripts/c2-node-parity.ts` 8/8、`c2-kill-parity` 13/13、`c2-room-generation-parity` 220 seed、`c2-loot-pickup-parity` PASS。
- C3c：`tests/c3c-headless-parity.spec.ts` 重生成 `rendered.json`；`scripts/c3c-rendered-headless-parity.mts` 16/16（真实击杀+loot，含全量 events 比较）。
- 这是**源码语义修正后的夹具刷新**，不是改断言/放宽比较。

## 4. 质量门（`reports/ai-native-02/c3c-history-replay-fix/logs/gate.log`）

| 门 | 结果 |
| --- | --- |
| typecheck | PASS |
| unit | PASS **40 files / 563 tests** |
| build / build:test / MCP 三入口 | PASS |
| 官方 SDK Player 裁剪/通道负向 | PASS |
| Headless MCP smoke（含 mid-run replay 历史） | PASS |
| Rendered↔Headless parity（含全量 events） | PASS 16/16 |
| C2 parity room/node/kill/loot | PASS |
| C2 存档/resume 定向（checkpoint/economy/resume-no-step） | PASS |
| 默认 StationZero MCP / `--world` smoke / lease smoke / token ACL / F-03 | PASS |
| C3b 定向 repeat ×3（16 用例） | PASS **48/48** |
| 全量 E2E（五视口 + C2 回归） | PASS **69/69** |

## 5. 剩余边界 / 不声称

- 本提交仍待独立 Reviewer 定向复核；通过前 C3c/P4 不放行，P3 实现继续冻结。
- `replay()` 的 20k 事件窗是显式边界：超出窗口的 prefix 会标 `eventsTruncated/historyPreserved=false`，不会伪装一致。
- Signal 未实现（`E_NOT_APPLICABLE`）；未新增 Energy/scan/jam。
- 未 merge/push/stash；C2 维持放行。
