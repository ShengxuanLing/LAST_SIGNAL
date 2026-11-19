# C3-c 事件历史 / 中途回放 最后定向复核（dcb4f14）

- **被测提交**：`dcb4f14fffceac0c3ef7c44725256b88e0a00cf9`（HEAD），父 `4cb59e9`
- **分支**：`feat/ai-native-world-integration`；未读/不恢复 WIP/stash；未改源/测试/配置/分支
- **快照**：`git archive` 冻结 `D:/Project/lastsignal-c3c-history-review-dcb4f14`；Python git blob SHA1 全量比对 → `ALL_TRACKED_FILES_MATCH`（1821/1821）
- **结论：上一轮的两个硬阻断（事件/快照历史不可变、mid-run replay 基线错位）均已关闭。** 仅剩 **20k 事件截断时 `exportFailure` 仍报 `replayable:true`** 的窄口问题（与 `eventsTruncated:true` 自相矛盾）。

## 一、质量门一行结果（命令 → 结果 → 路径）

| 门 | 命令 | 结果 | 路径 |
|---|---|---|---|
| 快照哈希 | Python blob SHA1 全量比对 | **PASS** 1821/1821 | `tree.ls` |
| 类型检查 | `npm run typecheck` | **PASS** exit=0 | `gate-typecheck.log` |
| 定向 unit（history replay / boundary / worldHeadless） | `npx vitest run ...` | **PASS** 29/29 | `gate-unit.log` |
| 独立历史/回放探针 | `vite-node reviewer-probe-history-final.mts` | 见下（仅 20k export flag FAIL） | `gate-probe-history.log` |
| 官方 SDK Dev/Player 探针 | `vite-node reviewer-probe-sdk-history.mts` | **PASS** 9/9 | `gate-probe-sdk-history.log` |
| 官方 MCP smoke | `vite-node src/ai-native/worldHeadlessMcpSmoke.mts` | **PASS**（含 dev_replay_history / dev_snapshot_boundary） | `gate-mcp-smoke.log` |

> 此前已独立通过的 Player 通道/输出/step duration/ledger/parity16 未重复全量；本单只做历史/回放最小回归。

## 二、原两个硬阻断：已关闭

### A. 事件/快照历史不可变 —— PASS
- 修复：core 在 emit 时对 `projectile-spawned`（玩家/敌方）、`loot-dropped`（击杀/房间/spawn-loot）、`player-reset.data` 调用 `cloneEventValue`（JSON 深拷贝，保留 IEEE-754 精度）；`snapshot()/restore()/fromFrame()/exportFailure()` 对 `events`/`actionLog` 用 `deepCopy`。
- 独立 probe：
  - snapshot 后推进 **40 tick** 与 **900 tick**，`frame`（events/actionLog/sim）JSON 完全不变；保存的 `projectile-spawned.projectile` 也不变（旧 probe 的 20.9369/0.7056 → 22.9965/0.5222 改写已消失）。
  - `restore`/`fromFrame` **双向隔离**：改输入 frame 不影响已恢复 world；改 live world 不影响已保存 frame；改 copy 不影响 source frame。
  - **未列出的 `drone-step` / 命中事件**：`drone-step.step` 不再共享 live `patrolPoints`（人为 push 后 DTO 不变）；`enemy-hit/player-hurt` 的 `hit` 是 fresh value object（改 live player 后 DTO 不变）。
- 判定：**原阻断 A 关闭。**

### B. mid-run replay 基线对齐 —— PASS
- 修复：`replay()` 以 `frame.events.length` 为 baseline，比较 **完整历史前缀**（expected vs frame.events）再比较**后续新段**；返回 `historyPreserved`、`eventsTruncated`、`baselineEvents`、`expectedNewEventsHash/actualNewEventsHash`；`sameEvents = historyPreserved && newEqual && firstDivergence===null`。
- 独立 probe（20 tick 历史 + 15 tick replay）：
  - 正例：`sameState=true`、`sameEvents=true`、`historyPreserved=true`、`firstDivergence=null`；
  - 篡改 baseline（frame.events[0]）：`historyPreserved=false`、`firstDivergence=0`；
  - 篡改后续动作（move 反向）：`sameEvents=false`、`firstDivergence >= baselineEvents`。
- 官方 SDK Dev：boundary snapshot → 继续同动作 → `world_headless_dev_replay` → sameState/sameEvents/firstDivergence=null；`exportFailure` boundary bundle → restore（epoch++）→ 跑同动作 → replay 成功；Player 的 step/observe 仍无 canonical。
- 判定：**原阻断 B 关闭。**

## 三、剩余窄口（需一行修复）

### 20k 事件截断时 `exportFailure` 仍报 `replayable:true`
- 代码：`worldHeadlessMcpTools.ts` `exportFailure()` 中 `replayable: boundary`，仅按 active/queued 判定；虽新增 `eventsRetained/eventsTruncated`，但截断时仍：
  ```
  boundary: "action", replayable: true,
  eventsRetained: 20000, eventsTruncated: true,
  note: "action-boundary export: full future state captured and replayable"
  ```
- 独立 probe（真实跑到 20k 事件窗口后 boundary 导出）：`eventsTruncated=true` 但 `replayable=true`，note 仍称“replayable” → 与 Lead 要求“20k 截断不能 replayable:true 假一致”冲突。
- `replay()` 本身在 20k 下已正确：返回 `eventsTruncated=true`，`sameEvents !== true`（历史前缀被截断，不假一致）；问题只在 `exportFailure` 的顶层 `replayable`/note。
- **修复条件**：`replayable = boundary && !eventsTruncated`；note 改为“history truncated; future state captured but history not fully replayable”；并补一条 20k 截断的 negative 断言（`replayable === false` 或显式 `historyComplete:false`）。阈值建议用 `eventTotal > eventsCount` 而非 `eventsCount >= 20000`，避免恰好 20k 的误报。

## 四、放行范围 / Signal

- **C3c Player：** 原两个硬阻断已关闭；Player 通道、输出、duration、ledger、history、mid-run replay 均通过。唯剩 20k `exportFailure.replayable` 窄口——若 Lead 要求 20k 语义完全正确，需先做上述一行修复；否则可在“20k 截断历史不完整、不可 replayable”显式文档下放行（但不能保留 `replayable:true`）。
- **P4 最低 Dev 能力：** Dev 的 real combat/perf/batch/parity + boundary snapshot/restore/replay + exportFailure bundle 重放均已通过；可放行范围为 **<20k 事件历史**；20k 截断需按上节修正/文档化。
- **Signal Combat：未实现**（`world_signal_status` 明确 `E_NOT_APPLICABLE`，未伪造）→ **AI-NATIVE-02 整体仍不能 PASS**。
- **真实 LLM 最小遭遇**：已在 `reports/ai-native-02/reviewer/lead-live/REVIEW.md` 独立确认可关 P2 最小 Agent 子项；本轮不写成未执行。

## 五、报告目录

`reports/ai-native-02/reviewer/c3c-history-final/`：`REVIEW.md`、`tree.ls`、`gate-typecheck.log`、`gate-unit.log`、`gate-probe-history.log`、`gate-probe-sdk-history.log`、`gate-mcp-smoke.log`、`gate-mcp-build.log`、`probe-history.mts`、`probe-sdk-history.mts`。

未修改生产源码/已有测试/配置/分支；未合并/重置；未读取/恢复共享 WIP/stash。
