# C3-c 最后 Player 通道 / 快照边界 定向复核（4cb59e9）

- **被测提交**：`4cb59e9f64456e4434002256bb2e8f24fbc88bfc`（HEAD），父 `8f1ce6c`
- **分支**：`feat/ai-native-world-integration`；未读/不恢复 WIP/stash；未改源/测试/配置/分支
- **快照**：`git archive` 冻结 `D:/Project/lastsignal-c3c-final-review-4cb59e9`；Python git blob SHA1 全量比对 → `ALL_TRACKED_FILES_MATCH`（1797/1797）
- **结论：Player 通道与 action-boundary 两项修复已闭环；但事件/快照历史不可变与 mid-run replay 仍未闭合，构成 C3c Player 放行的硬阻断。**

## 一、质量门一行结果（命令 → 结果 → 路径）

| 门 | 命令 | 结果 | 路径 |
|---|---|---|---|
| 快照哈希 | Python blob SHA1 全量比对 | **PASS** 1797/1797 | `tree.ls` |
| 类型检查 | `npm run typecheck` | **PASS** exit=0 | `gate-typecheck.log` |
| 定向 unit（step channel / snapshot boundary / worldHeadless） | `npx vitest run worldHeadlessStepChannel worldHeadlessSnapshotBoundary worldHeadless` | **PASS** 25/25 | `gate-unit.log` |
| 官方 SDK schema（Player/Dev） | `vite-node reviewer-probe-sdk-schema.mts` | **PASS** 6/6 | `gate-probe-sdk-schema.log` |
| Player step + snapshot boundary | `vite-node reviewer-probe-step-boundary.mts` | **PASS** 19/19 | `gate-probe-step-boundary.log` |
| 事件历史不可变 | `vite-node reviewer-probe-event-history.mts` | **FAIL（确认阻断）** 保存帧的历史事件被后续 ticks 改写 | `gate-probe-event-history.log` |
| mid-run replay | `vite-node reviewer-probe-replay-mid.mts` | **FAIL（确认阻断）** sameState=true，sameEvents=false，firstDivergence=0 | `gate-probe-replay-mid.log` |
| 官方 MCP smoke | `vite-node src/ai-native/worldHeadlessMcpSmoke.mts` | **PASS**（含 dev_snapshot_boundary midRejected），但未覆盖历史/replay | `gate-mcp-smoke.log` |

> 说明：此前已独立通过的 output/时长/ledger/裁剪/parity16 本轮不重复；16 parity 与 headless 真实击杀/loot 结论仍有效。

## 二、已闭环

### 1. Player 官方 SDK 不含 intent；manager 先于 quota/tick/队列拒绝 —— PASS
- schema：`worldHeadlessMcpTools.ts` 注册 `playerStepSchema`（**无 intent**）与 `devStepSchema`（含 intent），按 `dev` 选择；Player 传 `intent` 在官方严格 schema 层被拒（SDK probe：`Player SDK step WITH intent is rejected`；`Player SDK step schema does NOT expose intent`）。
- manager：`step()` 在 `boundedTicks`/parseIntent/quota/队列之前：
  ```ts
  if (!this.dev && intent !== undefined) return errPayload('E_PERMISSION', 'world.headless_intent_player_forbidden');
  ```
  独立 probe：合法 intent 亦被拒（E_PERMISSION），且 tick 不前进；无 action 的 neutral step 不移动；`world_action` 后 `step` 正常移动。
- Dev：schema 暴露 intent，Dev `step(intent)` 仍合法并移动（PASS）。

### 2. snapshot/restore 仅 action boundary —— PASS（边界语义）
- `snapshot()` 要求 `active===null` 且无 pending queued；否则 `E_NOT_APPLICABLE / world.snapshot_requires_action_boundary`，**不取消/不 ACK/不前进**。
- `restore()` 要求 frame 带 `boundary:'action'` 且当前会话在 boundary；否则 `E_NOT_APPLICABLE`；成功后 `rebindSession`（epoch++）、`active=null`、ledger.clear。
- probe 19/19：active 10/110 被拒；queued-unconsumed 被拒；boundary 帧成功（`boundary:'action'`）；old epoch `E_STALE_EPOCH`；post-restore 同动作 canonical/events（后续事件）一致；mid-execution failure export `replayable:false/boundary:'mid_execution'`，boundary export `replayable:true/boundary:'action'` 且 frame 带 marker。
- 注：`worldHeadlessSnapshotBoundary.test.ts` 的 post-restore 用例只比较 `after.events`（后续动作事件），并在注释中承认历史 `projectile-spawned` 持活引用——这正是下节阻断的“只改比较口径”。

## 三、未闭合阻断

### 阻断 A：事件/快照历史不可变契约被破坏（影响 full replay）
- 根因：`HeadlessWorld.runSteps` 直接 `this.events.push(...events)`；core 的 `projectile-spawned` 事件持有**活** `SimProjectile`（`state.projectiles.push(projectile)` 后 push 同一对象）。`snapshot()`/`restore()`/`fromFrame()` 对 events 仅 `slice()` 浅拷贝（`worldHeadless.ts`），历史事件里的 projectile 仍是活引用。
- 独立 probe（`gate-probe-event-history.log`）：
  - 保存 boundary frame 后继续 40 ticks：该 frame 内 `projectile-spawned.projectile` 的 `pos/lifetime` 从 `(20.9369,42.4770)/0.7056` 变为 `(22.9965,42.3686)/0.5222` → **saved frame 的历史事件被改写**；
  - `frame.events` JSON 前后不同；
  - `canonicalEvents()` 的历史前缀不再是后续投影的前缀（beforeLen 849 vs afterLen 15324，prefix 不成立）；
  - `restore(frame)` 后读到的历史 projectile 是**后续被改写后的值**，不等于保存时的值。
- 影响：`snapshot()` 声称保存 events，但 frame 不是不可变快照；`restore`/`canonicalEvents` 会把“未来才发生的 projectile 位置”写回历史。full replay 的事件基线不可信。
- **修复条件**：在事件进入 `this.events` / `snapshot()` / `restore()` / `fromFrame()` 时对事件做深拷贝（至少 `projectile`/`loot`/`hit` 等引用字段），或 push 时就冻结为值对象；保证 frame.events 与 canonicalEvents 的历史前缀不可变。

### 阻断 B：`replay()` 从 mid-run boundary frame 的 events 比较错误
- 根因：`replay(frame, steps)` 用 `HeadlessWorld.fromFrame(frame)` 载入历史 events（浅拷贝），但 `replayEvents = replayWorld.runSteps(steps)` **只返回后续新事件**；比较时却用 `this.events`（**完整历史**）对 `replayEvents`（**仅后续**）：
  ```ts
  expectedEventsHash = canonicalSimulationEvents(this.events); // full history
  actualEventsHash   = canonicalSimulationEvents(replayEvents); // subsequent only
  for (i < min(this.events.length, replayEvents.length)) compare(this.events[i], replayEvents[i])
  ```
- 独立 probe（`gate-probe-replay-mid.log`）：mid-run boundary frame（先 20 tick 历史，再 replay 15 tick）→ `sameState=true`，但 **`sameEvents=false`，`firstDivergence=0`**（把历史首事件与后续首事件对比）。
- 开发者测试 `worldHeadless.test.ts:120` 只覆盖 **tick0/start frame + 全量 steps**，未覆盖 mid-run boundary frame；新 snapshot-boundary 测试只比较 `after.events`，未调用 `replay()`。因此绿门漏检。
- 影响：新引入的“仅 action boundary 可快照”在 mid-run boundary 上产出的 frame **无法用 `replay()` 正确复现 events**；这正是 Lead 要求“若影响 full replay 必须修，不能只改比较口径”的场景。
- **修复条件**：`replay()` 需以 frame 的 events 作为历史基线（offset 比较），或让 `runSteps` 返回 `frame.events + 新 events` 后再比较；并补 mid-run boundary frame 的 replay 测试（`sameEvents=true/firstDivergence=null`）。

## 四、判定：C3c Player / Dev P4 / Signal

- **C3c Player 放行：暂不放行。** 第 1 项（Player step intent）与第 2 项（action boundary 语义）已闭环；但阻断 A/B（事件历史不可变 + mid-run replay）直接影响“snapshot 全部影响未来 state / full replay”，是 C3c Player 放行的硬阻断。
- **Dev P4 最低范围：可保留但需限定。** Dev 侧的 real combat/perf/batch/parity 与 boundary 拒收已通过；但“mid-run snapshot/replay”当前不可靠。若 Lead 接受“P4 最低 harness 仅限 tick0/whole-run 或显式声明 mid-run 不可 replay”，可作为最小范围；**不能**宣称完整 snapshot/replay 契约已成立。
- **Signal：未实现**（`world_signal_status` 明确 unsupported，未伪造），仍属未完成。
- **真实 LLM 最小遭遇**：`reports/ai-native-02/reviewer/lead-live/REVIEW.md` 已独立确认可关 P2 最小 Agent 子项；本轮不把它写成“未执行”。
- **建议**：先修阻断 A（events 深拷贝/冻结）与阻断 B（replay 历史基线/offset），补 mid-run replay 负向测试；再复验 C3c Player 放行。Dev P4 可在此之前以“mid-run replay 不支持”的明确限制继续最小 harness。

## 五、报告目录

`reports/ai-native-02/reviewer/c3c-final-boundary/`：`REVIEW.md`、`tree.ls`、`gate-typecheck.log`、`gate-unit.log`、`gate-probe-sdk-schema.log`、`gate-probe-step-boundary.log`、`gate-probe-event-history.log`、`gate-probe-replay-mid.log`、`gate-mcp-smoke.log`、`gate-mcp-build.log`、`probe-sdk-schema.mts`、`probe-step-boundary.mts`、`probe-event-history.mts`、`probe-replay-mid.mts`。

未修改生产源码/已有测试/配置/分支；未合并/重置；未读取/恢复共享 WIP/stash。
