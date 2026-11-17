# GAMEPLAY-01 · P2 独立审查（Reviewer · 只读 + 独立浏览器）

**结论：BLOCKER 1 项（human-local 确认可重复入队）；其余源码边界基本符合 B1–B3/M1–M6，但 5 视口 UI 矩阵与完整 fail-closed 矩阵我未跑。P2 不能 PASS。**
只读：未改 src/tests/manifest；未提交；未抢 tester 5480/P1 clone；用自起 5484（已关）与 `reports/gameplay-01/reviewer/p2/` 证据。

## 0. 冻结校验

- manifest `source_whitelist` 11 项，我逐项实算：**10 项 hash 完全一致**；`src/ai-native/runtime.test.ts` 不一致（manifest `3f9cb376…` vs 工作区 `d8fbefdc…`）。
- `git diff dcd1955 -- src/ai-native/runtime.test.ts` = **空** → 该文件已**恢复为 HEAD 原始阈值**（Lead 要求）；按 Lead 口径：**manifest 里这条应删除，只有 10 个有效源**。文件本身无需改动。
- P2 dirty 源 = `echo.ts`、`worldHeadless.ts`、`PauseScene.ts`、`SaveSystem.ts`、`types/index.ts`、`World.ts` + 4 个新测试/新模块。

## 1. BLOCKER：暂停期间可重复确认，同一 tick 多次入队

我独立在**真实浏览器**（DEMO 01 → ESC → AI & COMPANION → ECHO COMPANION → 启 ECHO → resume 一 tick → 再暂停 → LOCAL COOPERATION）复现：

| 动作 | 实测（tick 102，全程 paused） |
|---|---|
| 初次进入 | proposal `local_102_1`（scan），CONFIRM **enabled** |
| 第 1 次 CONFIRM | 立刻生成新 proposal **`local_102_2`**，CONFIRM **仍 enabled**，`pendingCommands = 1`，audit `enqueued @102` |
| 第 2 次 CONFIRM（同一 tick，无任何 tick 推进） | 又生成 **`local_102_3`**，**`pendingCommands = 2`** |

证据：`reports/gameplay-01/reviewer/p2/browser-local.log`（`[1]`/`[2]`/`[3]` 行）、截图 `after-confirm-paused-1280x720.png`。
开发者的 `demo02.json` 里 `confirmedPaused.proposal.id = local_110_2` 且 `paused:true` 也是同一现象（confirm 之后立刻再生一个 proposal）。

**影响**
- `scan`：第 2 条在 commit 时被 core 的 cooldown 拒绝（不会重复扣能），但 audit/UI 会显示两条 enqueued，且人类以为确认了两次。
- `toggle-relay`：**两次 toggle 在同一次提交里相互抵消** → 人类的第一次意图被静默撤销（资源价为 0，但环境状态被反转），这是误导性的"重复操作"。
- 可以无限重复（每次 confirm 都新增一条 pending），没有"等待真实 receipt"的门。

**最小修复（必须）**
1. World 侧记录 `pendingLocalEcho = { proposalId, acceptedTick, kind, target }`；`confirmLocalEchoProposal` 在存在未结算 pending 时直接拒绝（`E_ALREADY_PENDING`），并在 audit 记 `rejected`。
2. `EchoController.propose` 在有未结算 pending 时**不再再生 proposal**（或生成的 proposal 标记 `blockedByPending` 且 UI 不可确认）。
3. UI：CONFIRM 在 pending 期间 disabled，文案显示 `WAITING FOR NEXT CORE TICK`；同时把 audit 的 `applied/rejected` 关联到 `proposalId`（现在只记 tick）。
4. 回归测试：**paused 连续两次 CONFIRM ⇒ 只有 1 条 queued action**；resume 后 audit 为 applied 且可再次提案。

（当前 UI 文案本身是对的：`CONFIRMED · ENQUEUED FOR THE NEXT CORE TICK`，且 audit 变 `applied` 后会清掉 ENQUEUED —— 这点符合"不把 enqueued 当 applied"，问题只在"可重复确认"。）

## 2. 已核对的源码边界（B1–B3 / M1–M6）

| 项 | 结论 |
|---|---|
| B1 离线确认路径 | **已实现**：`confirmLocalEchoProposal(id)` 校验 echo alive / owner===human / id===当前提案 / 未 rejected / 未过期 / `roomGeneration` 相同 / 目标仍合法（用**新** `echoView` 重算，无隐藏地图）→ `originRoomId` 在确认时取 → `enqueueCompanionActionInternal(..., 'human-local', originRoomId)` → `consumeLocalProposal`。不创建 CompanionLink/session/epoch/cap；UI 显示 `OFFLINE/NO MODEL`（我实测 `companionLink` 不涉及，页面状态 `ECHO OFFLINE · DISABLED`/`LOW-RISK OFF`）。 |
| B2 "safe" 判据 | 已删 hazard：`canWalk` = 12 格内 + explored + LOS + `isWalkable`；安全移动另加"无感知 hostile 距目标 <2 格"。无隐藏地图读取。 |
| B3 措辞 | 文档改为"仅 echo 位置变化"，policy 只调 `stepEcho`。 |
| M1 Headless | `worldHeadless` 持有**同一个** `EchoController`，`runSteps` 在无 diagnostic override 时用 controller 决策；`fromSimulationState` 现在初始化 controller（`restore` 路径）。**我未跑 headless 同控制器用例**（见 §4）。 |
| M2 记忆 | `echo.ts` 只接受 `source:'echo-perception'`；`echoAudit.ts` 独立 ring（cap 32），不被 `suggest/decide` 读取。 |
| M3 拒绝码 | 只记真实 core 码（`E_COOLDOWN/E_ENERGY_INSUFFICIENT/E_RETRYABLE/E_PAUSED/E_PERMISSION`）+ 本地 `E_OWNER_NOT_HUMAN/E_STALE_ID/E_EXPIRED/E_STALE_ROOM/E_REJECTED/E_TARGET_NOT_LEGAL`；未伪造 out_of_range/no_los。 |
| M4 external `actor:'echo'` | 既有拒绝仍在（`externalLinkController` 未改）；**我未跑该 e2e**。 |
| M5 开关 | `SaveSystem` 可选字段默认 false；`setEchoCooperationOptIn` 只允许 owner human，OFF 只清自主不改手动模式；我实测 `LOW-RISK COOPERATION: OFF` 默认、点击后 label/存档一致（`[5]` 输出需看日志；本轮日志在 [4] 之后中断，开关持久化仅代码级确认）。 |
| M6 originRoomId | 确认时取 `roomIdValue`，提案只存 `roomGeneration` ✓。 |

## 3. 我跑的 gate

| 命令 | 结果 | 日志 |
|---|---|---|
| `npx vitest run echoCoop worldHeadlessEchoCoop SaveSystem.echoCoop echo echoView runtime.test` | **PASS**（6 files / **76 tests**，含恢复阈值后的 runtime.test） | `D:/Project/LAST_SIGNAL/reports/gameplay-01/reviewer/p2/p2-unit-1.log` |
| `PORT=5484 npx playwright test -c reports/gameplay-01/reviewer/p2/pw.p2.config.ts --workers=1`（真实菜单 → DEMO 01 → 暂停页 → LOCAL COOPERATION） | **FAIL**（用例尾段导航断言失败；**但 blocker 的 `[1][2][3]` 已完整记录**） | `D:/Project/LAST_SIGNAL/reports/gameplay-01/reviewer/p2/browser-local.log` |

## 4. 未测 / 明确边界（不计入 PASS）

1. **5 视口 UI 矩阵**（800/1024/1280/1366/1920 的边界、CSS≥10、键盘焦点、ESC 逐层、关闭残留、敏感信息、父子重叠）—— 我只在 1280×720 截了一张 local 页（`local-page-1280x720.png`），**其余未跑**。
2. **完整 fail-closed 矩阵**：过期、错 id、换房、owner 变 external/AI、echo 死亡、断线后仍 basic offline —— 只做了代码核对，未逐项实测。
3. **Headless 同 controller 用例**（不用 `echoIntentOverride`、restore 初始化、相同 tick 输入、记忆生命周期）—— 未跑。
4. **fresh Rendered parity**（用独立新产物、不消费旧 signal reports）—— 未跑；旧 `reports/ai-native-02/signal/parity` 与新事件形状不一致的问题仍存在（developer 已知）。
5. 模型链：本轮按 Lead 要求**未发任何 Magpie 请求**（等安全验收后再接）。
6. `demo02.json` 的 pause/resume 细节：`proposalState/confirmedPaused` 的 `echo.hp=94` 一致（**暂停期间未掉血**）；resume 后 88 属旧弹命中，与"暂停伤害"无关 —— 与 Lead 判断一致。echoEnergy 100→97 我只看到 proposal cost=10 与后续快照，**未逐 tick 验证提交帧扣 10 + regen**。

## 5. 阶段结论

- **BLOCKER 1**（human-local 可重复确认 → 同 tick 多次入队）必须修复后才能给 P2 PASS。
- 其余 B/M 项在源码层看起来闭环，但我只跑了 76 条 P2 单测 + 一次 1280×720 浏览器流程，**UI 矩阵与 fail-closed 矩阵未验**。
- P1 tester 独立 accept 树不受影响；P1 的"无辅助清房未通过"仍不能被 P2 覆盖。
