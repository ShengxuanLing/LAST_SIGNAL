# c2a31af 来源绑定（originRoomId）定向复核 — 两个尾项是否闭环

- 被测：`c2a31af609b8305ce5917d88d0a425a4af24a29c`（父 `4b938a5f02af319b8eaebeabff3dc1708cbdf4da`，已解析完整 hash）
- 隔离：`git archive c2a31af` → `D:\review-origin\snap`，**2048 tracked 文件**，`git ls-tree -r c2a31af`（blob sha1/路径）vs 快照内 `git hash-object` → **diff 0 行**
- 对照快照：`D:\review-tail\snap`（4b938a5）、`D:\review-race\snap`（c233e5c），同一探针三处各跑一次
- 边界：只读冻结源码/测试/配置；未读 WIP/stash；未 merge/push/reset；原模型/失败证据未动；自有 **5533**（已核对进程命令行后清理，0 残留；5173 与他人 5376 未动）；secret 零日志

## 结论

**两个尾项都已闭环，人类 R 回归已关闭，且没有把守卫泛化到其它来源。**
1. **stale/旧 Companion 命令**：`originRoomId` 只在 `World.enqueueCompanionAction('toggle-relay')` 里同步取值；core 只在 `originRoomId !== undefined` 时做“origin == 设备房 && origin == 玩家当前房”双重校验，不匹配则 `break`（不改 relay/manual/power/exit，不发事件）。旧房命令在过门后提交被拒（O2/O2b/O2c 实测）。
2. **人类 R**：`commitToggleRelay` 的宽房号守卫已删除；`world.toggleRelay()`/键盘 R 不带 binding，跨房仍可双向控制留在旧房的设备。核心探针 O3 通过，真实浏览器与 c233 基线逐字段一致（INACTIVE↔ACTIVE 双向）。
3. **Agent 无法伪造**：`originRoomId` 只出现在 `core.ts` 的类型/校验与 `World.ts:400` 一个产出点；官方 Companion MCP 实测 `echo_suggest{originRoomId}` → `MCP error -32602 Unrecognized key`（网络前拒绝），而同一调用去掉该字段就能到网络层（证明 schema 是唯一闸门）。

## 1) 三顺序同测（核心探针 7/7，c2a31af）

| 用例 | c233e5c | 4b938a5 | **c2a31af** |
|---|---|---|---|
| O1 Companion 命令在旧房确认、teleport 前提交 | ACTIVE/1 event | ACTIVE/1 event | **ACTIVE/1 event（合法一次）** |
| O2 teleport 后提交旧 origin 命令 | **ACTIVE/1 event（未保护）** | 拒（但用的是玩家房规则） | **拒：relay INACTIVE / manual false / powered true / 0 events** |
| O2b origin=设备房但≠玩家当前房 | 未保护 | 拒 | **拒** |
| O2c origin=玩家当前房但≠设备房 | 未保护 | 拒 | **拒** |
| O3 人类 R（无 binding）在新房控制旧房设备 | ACTIVE/1 event | **INACTIVE（回归）** | **ACTIVE/1 event（恢复）** |
| O4 跨房 scan/jam | 不扣费 | 不扣费 | 不扣费（echo 100、player 100） |
| O5 JSON clone 保留 binding、设备状态不含该字段 | — | — | **保留 originRoomId=5；`JSON.stringify(signal)` 无该字段** |

三提交同一探针的失败集合互补：c233 失败 O2/O2b/O2c，4b938a5 失败 O3，c2a31af 全过 —— 说明这次是**按来源绑定**，不是把守卫换个位置。

## 2) 真实浏览器（自有 5533）

- 仓库新增 `tests/signal-human-crossroom.spec.ts`：**1/1 passed**（真实 UI 下 R 控制旧房设备）。
- 我沿用上一轮与 c233 对照的同一份 spec（真实 Pause→SETTINGS→SIGNAL COLLABORATION opt-in、真实 portal）：
  - `optInVia: "pause-ui"`；房 3 内 toggle → ACTIVE/exitOpen true；真实过门到房 5（设备留房 3 ACTIVE）。
  - 房 5 `world.toggleRelay(false)` → **INACTIVE / manual=false / exitOpen=false / HUD `RELAY INACTIVE … EXIT CLOSED`**（与 c233 基线**逐字段相同**）。
  - 再按真实 **R** → **ACTIVE / manual=true / exitOpen=true / HUD `RELAY ACTIVE … EXIT OPEN`**（与 c233 基线相同，双向可用）。

## 3) 来源与可达性（源码逐点）

| 问题 | 结论 |
|---|---|
| `originRoomId` 由谁产出 | 仅 `World.enqueueCompanionAction('toggle-relay')`（`World.ts:396-402`），取 `this.roomIdValue` = **确认执行那一刻**的 `currentRoomId`，**不是**建议对象里的 `roomId` |
| 是否有第二个产出点 | 无。全仓 `grep originRoomId`（非测试）只有 `core.ts:133/565/567` 与 `World.ts:316/400` |
| Agent 能否伪造 | 不能。Companion MCP `echo_suggest` 是 `z.strictObject`，实测未知键 → `-32602 Unrecognized key: originRoomId`（网络前）；headless dev 命令同样是 `strictObject{session,type,actor,enabled,powered}`，无该字段；`world_action` v2 协议根本没有 `toggle-relay` |
| 外部/玩家链路 | `toggleRelay()` / `playerSignalScan/Jam()` / `enqueueSignalCommandByActor`（外部 v2 只有 scan/jam）都不带 binding → 走 c233 全局语义 |
| 旧建议对象是否还需 link 屏障 | 仍需要。binding 反映的是“确认时玩家所在房”，若一个旧房建议在**同房**被确认，binding 与设备房一致、不会被拒 —— 挡住跨房旧对象的是 `CompanionLink` 的 room/generation/lifecycle 屏障（上一轮已关闭的 A/B/C）。两层互补：屏障挡旧对象，binding 挡“确认后、提交前跨房”。 |
| 队列待提交是否真受保护 | 是。命令对象带 origin，core 在提交时对“设备房”和“玩家当前房”各比一次（O2/O2b/O2c）。`cloneSimulationState` 与 `canonicalSimulationState` 都保留该字段（O5 + `core.ts:1383`），所以内存快照/重放不会丢 binding。 |
| checkpoint/restore 会不会丢 | 不会出现“有命令没 binding”的状态：`CoreCheckpointState` 本身**不持久化 `pendingCommands`**（`types/index.ts:98-109`，既有行为），恢复后队列为空，谈不上丢字段。 |
| `currentRoomId` 可能是 -1 吗 | 过门瞬间 `tryInteract` 会把 `currentRoomId` 置 -1，但那条路径只在**未暂停**帧执行，而 Owner 确认只在**暂停**时发生，二者互斥；即便取到 -1，core 也会因 `origin !== device.roomId` 拒绝（安全方向）。 |

## 4) core 拒绝 vs 收据语义（按你的边界，不扩大）

- 拒绝时 core `break` 在 `events.push` **之前**：不改 relay/manual/power/exit，**不发** `signal-relay-changed`（O2 实测 0 events）。
- 但已确认命令的收据链没变：`enqueueSignalCommand` 只要设备存在就返回 true → `GameScene.apply` 返回 true → 置 `pendingCompanionReceipt` → 下一 tick `postApplied` → gateway 记 `applied`。**即：收据表达“确认已投递并被 tick 消费”，不表达“Signal 物理效果发生”**。
- 这是既有语义（scan 在范围外也会 `applied` + `found:false`），本轮**没有扩大**到“所有 action 必须物理生效”。唯一值得记录的差别：scan/jam 被拒时仍会发 `signal-scanned/jammed` 事件（可观察），而 toggle 被拒**什么事件都不发**，所以“applied 但设备没动”在事件流里没有对应痕迹（只能看设备状态）。这条是**源码推断 + core 侧实测（0 events）**；收据部分需要带 echo 的回合才能端到端复现，本轮未跑。判为非阻断，建议在 `world_signal_status` 或事件里补一条“command refused”痕迹即可。

## 5) 可关闭 / 限制

**可关闭**
1. 旧 Companion 跨房 toggle 防误执行（三顺序 + 双伪造 origin 全部符合预期）。
2. 人类 R 全局设备控制恢复，且与 c233 基线逐字段一致（核心 + 真实浏览器）。
3. Agent 侧不可伪造 `originRoomId`（schema 级拒绝，已实测）。
4. 来源绑定不误伤：scan/jam、signal-power、无设备旧行为、外部 v2 路径均未改。
5. 回归：tsc 0、MCP 构建 0、相关 unit **59/59**、Owner 最小回归 **48/48**、新 spec 1/1、parity 新导出 1/1 + 重放 **3/3**。

**真实限制（非阻断，记录用）**
1. 收据是“投递确认”而非“物理效果”；toggle 被拒时既不改状态也不发事件，因此外部只能从设备状态判断（见第 4 节）。
2. 观测/对账口径：`canonicalSimulationState` **包含** `pendingCommands`（于是也包含 `originRoomId`），而 rendered parity 导出器的 `sequence` 只记录 `{type,enabled,powered,actor}`。今天 parity 两边都用 `enqueueSignalCommand` 直发（不带 origin），所以 3/3 绿；将来若把**Companion 确认的 toggle**放进 parity 场景，导出器需要一并记录 `originRoomId`，否则字节比对会分歧。这是潜在的观测/对账缺口，不影响当前运行语义。
3. 4b938a5 把测试夹具改成“设备生成在玩家房”（`worldHeadlessHarness.ts`、`worldHeadlessSignal.test.ts`、`signalState.test.ts`）**未回退**；本身更贴近真实，但“设备在别的房”的组合现在只由 `signalCombat.test.ts` 新增的三例覆盖。
4. `originRoomId` 的语义是“确认时玩家所在房”，因此“玩家离开又回到设备房后再确认旧建议”会被放行（origin==current==device）。这与“同房合法”一致，但如果你希望旧建议**永不**跨过任何房界生效，需要再加 suggestion 世代校验（属产品口径决定，非本轮缺陷）。
5. 未跑（按指令）：全量单测、完整 Run、新模型回合、跨平台。

## 6) 现场记录

- 本轮端口：自有 `5533`，启动前确认空闲，启动后核对监听进程命令行为 `D:\review-origin\snap\...\vite --port 5533`，结束时只 kill 该 PID（0 残留）。他人 `5376`（`D:\Project\lastsignal-c2seam-review-5f49b24` 的 vite preview）与 `5173` 未动。
- 所有日志全文落盘在 `logs/`；`logs-sha256.txt` 可校验。
