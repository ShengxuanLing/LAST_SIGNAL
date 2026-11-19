# 4b938a5 两尾项定向复核 — stale 回执 + 跨房 pending toggle

- 被测：`4b938a5f02af319b8eaebeabff3dc1708cbdf4da`（父 `c233e5cfeae0473a70878cb25608d30d88f9c976`，已解析完整 hash）
- 隔离：`git archive 4b938a5` → `D:\review-tail\snap`，**2047 tracked 文件**，`git ls-tree -r 4b938a5`（blob sha1/路径）vs 快照内 `git hash-object` → **diff 0 行**
- 对照：`c233e5c` 快照 `D:\review-race\snap`（上一轮已冻结），同一份探针在两处各跑一次
- 边界：只读冻结源码/测试/配置；未读 WIP/stash；未 merge/push/reset；原模型/失败证据未动；**独占端口**（4b938a5 用 5531，c233 用 5532；都不是他人端口），用完仅关自己的 vite（已核对命令行后清理）；secret 零日志

## 结论（一句话）

**尾项 1（stale 回执证据）已关闭；尾项 2（跨房 pending toggle）功能目标达成，但引入了人类操作回归（scope 偏移）——不建议按现状关闭。**
`commitToggleRelay` 的房号守卫加在 **core 的 `processCommands`/`commitToggleRelay`**，对**所有来源**生效（人类 R、玩家 API、Companion 确认、headless dev 工具），判据是“提交时玩家当前房 ≠ 设备房”。而本设计里**一局只有一个设备、跨房后设备留在出生房**，于是**第一次过门之后，人类 R / 玩家自己的 toggle 永久变成静默 no-op**（两个方向都不行）。真实的浏览器对照：c233e5c 里同样的操作能 INACTIVE↔ACTIVE 来回切；4b938a5 里完全不动。建议把绑定改为“旧 Companion 建议所属的房号/世代”（在命令里携带 origin room/generation），而不是一刀切按玩家当前房禁人。

## 1) 尾项 1：stale 回执证据 — 关闭

`markApplied` 现在对**已被房界作废（`record.stale`）**的记录要求 `execution.generation` **与** `execution.roomId` 都存在且等于记录值；非 stale 记录保持旧宽松契约。我的确定性探针 5/5（`staleReceipt.probe.test.ts`）：

| 用例 | 结果 |
|---|---|
| S1 stale + 省略 execution | **拒** `E_STALE_GENERATION applied_generation_mismatch`，收据仍是 `cancelled/room_changed` |
| S2 stale + 错 generation | 拒 |
| S3 stale + 对 generation、错 roomId | 拒 |
| S4 stale + **原世代与原房**的真实迟到回执 | **接受**，收据 `applied / appliedTick 44`（真相不因到达顺序翻转） |
| S5 非 stale + 省略 execution | 接受（旧客户端兼容保持不变） |

上一轮我报的“省略世代可把 cancelled 翻成 applied”缺口**已被堵住**。

## 2) 尾项 2：跨房 pending toggle — 目标达成，但人类控制退化（阻断）

### 2.1 代码事实
- `src/world/sim/core.ts` `case 'toggle-relay'`：`const currentRoom = roomAt(state.map.rooms, state.player.x, state.player.y)` → `commitToggleRelay(device, enabled, tick, currentRoom?.id)`；`!result.ok` 时 `break`（不发 `signal-relay-changed`）。
- `src/world/sim/signalState.ts` `commitToggleRelay(..., currentRoomId?)`：`if (currentRoomId !== undefined && device.roomId !== currentRoomId) return { ok:false, code:'E_PERMISSION' }`。
- 该函数是 **core 唯一 toggle 提交点**，其输入只有 device/enabled/tick/玩家房号——**无法区分来源**（人类 R、`World.playerSignal*`/`toggleRelay`、`enqueueCompanionAction('toggle-relay')`、headless dev 命令都走同一条）。
- 佐证：本提交把 **测试夹具** 从 `roomId: 0` 改成“玩家实际所在房”（`worldHeadlessHarness.ts`、`worldHeadlessSignal.test.ts`、`signalState.test.ts`、`signalCombat.test.ts`）。测试需要搬设备才能继续通过，本身说明合法语义被改变了。

### 2.2 core 层对照（同一探针，两个提交）
`zz-crossRoomToggle.probe.test.ts`（设备在房 5，玩家过门后在房 0）：

| 用例 | c233e5c | 4b938a5 |
|---|---|---|
| T1 房内 toggle（基线） | ACTIVE, manual=true, 1 event | ACTIVE, manual=true, 1 event（不变） |
| **T2 过门后人类/玩家 toggle** | **ACTIVE, manual=true, 1 event** | **INACTIVE, manual=false, 0 events（静默拒绝）** |
| T3 toggle 排在 teleport 之前（旧房合法一次） | ACTIVE, 1 event | ACTIVE, 1 event（不变 ✓ 目标语义） |
| T4 跨房 scan/jam | 不扣费 | 不扣费（echo 100→100，player 100） |

### 2.3 真实浏览器对照（真实 opt-in UI + 真实 portal，同一 spec 两边各跑一次）
`zz-crossroom-human-toggle.spec.ts`（设备在房 3；房内先 toggle 成 ACTIVE → 真实过门到房 5，设备留在房 3）：

| 房 5 里的操作 | c233e5c | 4b938a5 |
|---|---|---|
| `world.toggleRelay(false)`（玩家 API 路径） | **INACTIVE**, manual=false, exitOpen=false, HUD `RELAY INACTIVE … EXIT CLOSED` | **ACTIVE 不变**, HUD `RELAY ACTIVE … EXIT OPEN`（no-op） |
| 按键盘 **R**（真实键位） | **ACTIVE**（又切回，双向可用） | **ACTIVE 不变**（no-op） |

- 两次运行 `optInVia: "pause-ui"`，即真实 Pause→SETTINGS→SIGNAL COLLABORATION 路径（没有用 API 兜底）。
- 结论：**人类 R 从“可用”退化为“静默失效”**，且过门后整局都失效（设备不会回迁）。玩家没有任何反馈（HUD 不变、无错误提示、`world.toggleRelay()` 仍返回 true）。

### 2.4 附带发现：core 拒绝会被记成 applied（源码推断 + 部分复现）
- core 拒绝时 `break` 且不发事件（T2 实测 `events=0`），但 `World.enqueueSignalCommand` 只要 `sim.signal` 存在就返回 **true** → `GameScene.apply` 返回 true → `pendingCompanionReceipt` 被设置 → 下一 tick `postApplied` → gateway 记 `applied(appliedTick)`。
- 我的浏览器探针里 `enqueueCompanionAction('toggle-relay')` 返回 **false**，但那是因为本次 run **没有 enable echo**（该函数先检查 echo 存活），不是房号守卫；有 echo 时它会返回 true。故这条标注为**源码推断**，需要时再用带 echo 的回合复核。
- 影响：Companion 确认一次被 core 拒绝的跨房 toggle，会留下一条“applied 但什么都没发生”的收据（真实执行与收据不符）。

### 2.5 与 Lead 边界的对照
- Lead 明确“不得改人类 R 全局设备控制”。当前实现虽然保持了设备留原房的设计，却把**人类全局控制**改成了“必须与设备同房”——这正是要求排除的改动。
- 期望的修法（供参考，我不改代码）：把房号/世代绑定放在**命令产生端**——`enqueueCompanionAction('toggle-relay')` 用建议的 `roomId/generation` 生成命令（例如 `toggle-relay { enabled, originRoomId, originGeneration }`），`commitToggleRelay` 只拒绝“携带旧房/旧世代”的命令；`world.toggleRelay()`（人类 R）不带 origin，保持全局可用。这样既能拦住旧 Companion toggle，也不会动人类控制。

## 3) 其他必须核对的点

| 项 | 结论 | 依据 |
|---|---|---|
| `signal-power` 是否被连带限制 | **否** | 该 case 未改；只有 toggle 路径加了房号守卫 |
| echo 与 player 独立源 | **不变** | scan/jam 走 `signalLegality`（actor 位置/半径/LOS），本提交未改；`signalState/signalCombat` 61 例通过 |
| 无 Signal 设备的旧行为 | **不变** | `if (!device) break` 在守卫之前；`signalView()` 仍 null → 传送门常开；单测覆盖旧档无设备 |
| scan/jam 被拒是否扣费 | **不扣费** | T4：echo 100→100、player 100；`tryScan/tryJam` 在 `permitted=false` 时先返回 `E_PERMISSION`，不进入 charge |
| core 拒绝是否发事件 | toggle **不发**（`break` 在 `events.push` 之前） | T2 `events=0`；但 `signal-jammed` 事件在 scan/jam 拒绝时仍会发（**既有行为**，本提交未改，仅记录） |
| 回归 | 通过 | tsc 0、MCP build 0、相关 unit **61/61**、Owner 最小回归 **48/48**、parity 新导出 1/1 + 重放 **3/3**（core 有改动故重生） |

## 4) 可关闭 / 不可关闭

**可关闭（本轮）**
1. stale 回执证据（省略/错世代/错房号一律拒；原世代+原房的真实迟到回执仍记 applied；非 stale 保持宽松）。
2. 跨房 pending toggle **防误关门**这一目标本身：T2/T3 与浏览器证据表明“teleport 之后的旧 toggle 不会改变 relay/exitOpen”，且“teleport 之前的 toggle 仍合法执行一次”。

**不可关闭（需改后再验）**
1. **人类操作回归**：过门后人类 R / 玩家 toggle 从成功退化为静默 no-op（c233↔4b938a5 浏览器实测对照）。这是 scope 偏移，不是授权玩法变更。
2. **core 拒绝 → 收据 applied**（源码推断）：需在命令端携带 origin，或在拒绝时让渲染端拿到明确失败，避免假 applied。
3. 附带：测试夹具为适配守卫而把设备搬进玩家房（说明合法语义被改），修好守卫后应回退这些夹具改动或另加“跨房人类 toggle 可用”的用例守住行为。

**未跑（按指令不重开）**：全量单测、完整 Run、新模型回合、跨端以外的平台；c233e5c 已关闭的在途竞态/A/B/C 不重开。

## 5) 现场记录（避免歧义）

- 我第一次尝试浏览器探针时误用了 **5531 之前的 5376**，那里被**他人进程**（`D:\Project\lastsignal-c2seam-review-5f49b24` 的 `vite preview --port 5376`）占用，页面里没有本仓的 Signal 设置项；该次结果作废、未计入结论，我也没有动他人进程。正式数据全部来自我自己的 5531（4b938a5）/5532（c233e5c），并在日志开头核对了 `vite ready` 与监听进程命令行。
