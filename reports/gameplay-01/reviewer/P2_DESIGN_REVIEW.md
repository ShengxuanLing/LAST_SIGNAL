# GAMEPLAY-01 · P2 设计独立预审（Reviewer · 只读）

**结论：设计方向正确（复用现有 EchoController/Companion/Owner 链、默认 OFF、不造第二套框架），但有 3 个设计级阻断（B1–B3）必须在写代码前补齐；另有 6 条应在 P2 内处理的 Major。**
P1 冻结未被解冻：`World 90295aaa…`、`core 2afcb1d0…`、`GameScene 371fca31…` 与 P1 manifest 一致（我审查时实算）。
只读：未改 `src/`/`tests/`/CI，未提交/推送，未跑全量。

---

## 1. 审读范围

- 文档：`docs/gameplay/ECHO_COOP_BEHAVIOR.md`（295 行）、`docs/gameplay/COOP_LEVEL_DESIGN.md`（120 行）。
- 现码：`src/ai-native/{echo.ts,echoView.ts,companionFacet.ts,companionLink.ts,externalLinkController.ts}`、`src/world/World.ts`（`enqueueCompanionAction`/`confirmEchoAssist`/`stepFrame`）、`src/world/sim/core.ts`（`stepEcho`/`signalLegality`）、`src/world/sim/signalState.ts`、`src/scenes/PauseScene.ts`（ECHO 页）。

---

## 2. 阻断（设计不闭环，必须先修文档再实现）

### B1 离线确认路径缺失且与 §3.5 自相矛盾（最关键）

**事实（现码）**
- §2 的流水线是 `echoView → EchoController.observe/suggest → companionFacet suggestion → Owner CONFIRM → enqueueCompanionAction → next tick`。
- 但 `companionFacet`/`CompanionLink` 是 **bridge 侧**对象：没有 bridge 就没有 suggestion、没有 `pending()`、没有 Owner CONFIRM 入口。
- 离线时 echo 唯一有人类确认的能力是 **assist fire**（`World.confirmEchoAssist()` → `echoController.confirmAssist()` → core），**不含** scan/jam/toggle。
- `World.enqueueCompanionAction(kind,target)` 本身**不做 Owner 校验**（它是"已确认后的机械执行"）：`scan/jam` → `enqueueSignalCommand({actor:'echo'})`；`toggle-relay` → 带 `originRoomId` 守卫。也就是说：**授权在 UI/link 层，执行在 World 层**。

**因此 §3.5「离线也能 FOLLOW/HOLD/OBSERVE/RECOVER + switch-gated safe move」成立，但 §6「离线/无 bridge 时 echo 可被人类确认 scan/toggle 做非战斗合作」不成立。**

**最小安全可行路径（建议二选一，并写进文档）**

**方案 L（推荐：本地确认，零伪造）** —— 新增"本地提案"通道，不碰 session/cap：
1. `EchoController` 新增 `propose(view)`：仅在 `echoView` 的合法感知内产出
   `{ kind: 'scan'|'jam'|'toggle-relay', target?, reason, evidenceRef, expiresAtTick, provenance: 'local-echo' }`，**不执行、不入队**。
2. Pause ECHO 页新增 `CONFIRM (HUMAN) · LOCAL` 按钮（`menuKit`），与模型提案按钮**视觉与文案区分**：`OWNER CONFIRM · MODEL`。UI 明示"本地回声建议 / 无外部模型"。
3. 人类确认那一刻才调用现有 `World.enqueueCompanionAction(kind, target)`（scan/jam 用 `actor:'echo'`；toggle 的 `originRoomId` 在**确认时**取 `roomIdValue`，与现码一致）。
4. 在 `pendingCompanionIntent`/receipt 上补 `provenance: 'human-local' | 'owner-external'`（现在两条路共享同一个 `pendingCompanionIntent`，不记来源会让审计与测试无法区分）。
5. **禁止**：本地路径构造 `CompanionLink`、写入 `companionStatus`、显示 CONNECTED/pending/session/epoch/cap。
6. 验收（P2 测试）：离线确认 → 下一真实 tick 提交（core 状态变化）；无 bridge 时 UI 显示 `OFFLINE/NO MODEL`；本地确认后 `companionLink === null` 且 `companionStatus === 'OFF'`；外部路径行为逐字节不变。

**方案 F（更保守：P2 不做本地 echo scan/toggle）** —— 非战斗合作证据用 **fixture bridge + Owner 点击**，并在所有报告标注 `fixture`；同时把"离线只有 follow/observe/safe-move + assist"写成显式边界，不再宣称离线 scan/toggle。
两方案都可接受，但**文档必须选一个**；现在的写法会被实现者按 §2 做成"离线复用 facet"，那是不可行的。

### B2 "safe" 的判据里出现 `hazard tile`，但 `echoView` 没有 hazard 信息

- §3.2 允许条件写：`target ∈ 12 格感知 + explored + LOS` ∧ `isWalkableFromState` ∧ **"not a hazard tile"**。
- 现码 `EchoObservationInput` 只有 `echo/player/tick/drones/targets/isExplored/isOpaque/relay/hazards?`——**没有 hazard 数据**（我看的接口里没有 hazard 字段）；要实现"hazard tile"只能查隐藏地图 → 直接违反 §4 与"不得泄露未来/hidden map"。
- **最小修正（二选一）**：
  a) 删掉 hazard 判据，改为"**无感知到的 hostile 距目标格 < 2 格**"（用 `drones` 即可），或
  b) 把 hazard 定义成"echo 亲眼见过造成伤害的格子"（需要新证据类型，成本高于 P2）。
  建议 a。

### B3 "no world state is changed" 与事实冲突

- §3.2 写 safe move "no world state is changed"。但 safe move 会让 echo **真实移动**（core 的 `SimEchoState` 位置变化），这正是它的作用。
- **最小修正**：改成 "不改变**关键环境**：relay/route/portal/HP/energy 均不变；**仅** echo 位置变化（由同一 core tick 提交，并进入 receipt）"。否则审计时会被当成"没动却宣称动了"或反之。

---

## 3. Major（P2 内应处理）

### M1 Headless「共用」说法不准确
`EchoController` 在 `src/ai-native/echo.ts`，**不在** `src/world/sim`；`HeadlessWorld` 本身不持有它（只有 `worldHeadlessEcho.test.ts` 自己 new 一个）。`World.stepFrame` 的 echo intent 来自 `pendingCompanionIntent ?? echoIntentOverride ?? echoController.decide(view)`。
→ 改口径：「**执行**（`stepEcho`、`enqueueCompanionAction`、signal 命令）与 **纯策略模块**共享；Headless 通过 `echoIntentOverride` 驱动同一执行」。并要求 P2 自主策略**确定性、无隐藏随机、可重放**，否则 autonomy 事实上是 Rendered-only（和 P1 的 route 一样）。

### M2 记忆双份（本地 vs facet）必须有单一事实源
- `EchoController.memory`（本地，16/600，`ECHO_LIMITS`）与 `companionFacet` 的 memory（远端，`COMPANION_LIMITS` 只是**数字**转发 `ECHO_LIMITS`，`:24-25`）是两份数据。
- §2.1 的 `source: 'owner-confirmed'` 会把 Owner/外部 Agent 确认的动作写进**本地感知记忆** → 等于给 agent 一条"污染 echo 决策记忆"的通道。
- **最小修正**：本地策略记忆只接受 `source:'echo-perception'`；Owner/agent 的确认进**独立 audit ring**（不参与 `suggest`/`decide`）；UI 的 "seen clue" 只引用 perception 记忆。facet memory 只用于远端 `echo_memory` 工具展示，不回灌本地。

### M3 拒绝原因环拿不到真实数据
- 现码：`signalLegality` 只给 actor 位置与 LOS；range/LOS 拒绝统一返回 `E_PERMISSION`（我在 P1 实测：距 relay 6.9 格 → `E_PERMISSION`）；只有 `E_COOLDOWN`/`E_ENERGY_INSUFFICIENT`/`E_RETRYABLE` 有区分。
- §2.1 计划记录 `out_of_range / no_los` —— 拿不到。
- **最小修正**：要么在 `signalLegality`/`commitSignal*` 加 `E_OUT_OF_RANGE`/`E_NO_LOS`（小改，但**需要 Lead 决定是否解冻 P1 的 core 冻结**）；要么把环收敛为真实存在的四类 + UI 文案说明，不伪造细分。

### M4 既有负向门禁要写进设计并补回归
`externalLinkController.ts:306-321` **已经拒绝** external 的 `actor:'echo'` scan/jam（回 `E_PERMISSION`，注释写明"that is the Companion's domain…requires Owner UI confirmation"），但我在 tests 里**没找到**对应用例。
→ P2 §6 应把这条列为"既有强制边界"，并补一条 e2e：external owner 提交 `actor:'echo'` → 拒绝、echo 能量不变、relay 不变。

### M5 开关的持久化/撤销闭环要写死
`echoCooperationOptIn?: boolean`（缺省=false）之外，文档要明确：
- OFF（含从 ON→OFF）→ `echoController.clearIntent()` + 清 autonomy target，**不动** current mode（FOLLOW 保持）；
- 暂停/开启菜单 → 清 autonomy intent，但不清 mode；
- 死亡/新 R0 → 全部重置（与 `permission/echo` 现有 reset 一致）；
- 旧存档无字段 → false，不升级授权；
- external/AI owner → 开关只读（§3.4 已写，补"UI 显示 HUMAN OWNER ONLY"的具体文案来源）。

### M6 toggle-relay 的 `originRoomId` 必须在"确认时刻"取
现码 `enqueueCompanionAction('toggle-relay')` 用 `this.roomIdValue` 同步取值 ✓。文档要把"本地确认也在确认瞬间取房号、提案本身不缓存房号"写成硬约束，否则跨房 stale 提案会翻转新房间的 relay。

---

## 4. 已授权、无需再问用户（供 implementer 直接执行）

1. **P2 含有限自主**：`follow` / `observe` / **可验证安全移动**，单一开关、默认 OFF、人类开启；其余（scan/jam/toggle/assist/资源/不可逆）仍走 Owner 人类确认。用户已明确要求，不必再确认。
2. **Owner 不可绕过**：不新增 confirm 工具、不伪造 session/cap/CONNECTED；AI/external 对 ECHO 无新能力。
3. **不造第二套框架**：复用 `EchoController` + core 命令 + `menuKit`；`observe` 只加一个 `EchoMode` 值与一个 `decide` 分支。
4. **P4 只做最小纯函数**：把 P1 的 `p1RouteFor(relay, routes)` 迁到 `src/world/sim`（或 `src/signal`）作为唯一 route 规则 + authored 数据经现有 `spawn-*`/`link-*` 命令；**不要**通用 `LevelRule` registry/框架（文档 §3 的 "LevelRule" 措辞建议改成 `routeTargetFor`）。

---

## 5. 已核对为正确的设计点（不需改）

- `echoView` 只在 echo 自身 12 格 + explored + LOS 内报告 relay/drones/targets；`isOpaque` 参与 LOS；无 seed/map/future ✓（与 §4 一致）。
- TTL/cap 数字确实共用：`ECHO_LIMITS.{memoryEntries:16,memoryTtlTicks:600}`，`COMPANION_LIMITS` 直接引用 ✓。
- room 变更失效链存在：`clearForRoomTransition()` + `CompanionLink.enterRoom` 的 room generation + 旧 generation 建议被拒 ✓。
- reauth 语义描述正确：**session/epoch 不变**，只 `observation=null` + `cancelUnconfirmed()`（与我 P1/UI-REWORK 的实测一致）✓；文档没有再说成"会话被撤销" ✓。
- Owner cap 仍在 `#private`，agent bundle 无 confirm（`companionSurface` 门禁）✓；P2 文档未新增 agent 工具 ✓。
- §3.3（OFF 不禁旧手动、ON 不暗开 assist/scan/jam）与 §3.4（ai/external 只读）方向正确 ✓。
- P4 文档已把我在 P1 报的两条实测观察纳入（出生点与 relay 同格、6.9 > 6 的站门 jam 不可达）✓。

---

## 6. 非战斗合作证据链（建议最小方案）

- **首选 scan**（无持久环境改变、风险最小）：ECHO 在 12 格内感知到 relay → 本地建议 `SCAN (echo)` → 人类确认 → core `signal-scan actor:'echo'` 提交 → 证据写入（白名单字段）→ UI 显示"echo 看到的 relay 事实"。**真实 core 状态**：`device.actors.echo.energy` 扣减 + `evidence` 追加 + `signal-scanned` 事件。
- **次选 toggle-relay**（有 route 影响）：确认 → core `toggle-relay` + `originRoomId` 守卫 → `relay` 状态真实翻转 → P1 的 route/portal 跟随改变（Rendered 层）。
- **不得**只用文字/`confidence` 作为"合作价值"：`confidence` 只能来自规则命中（"relay 在感知内 ∧ LOS 通"），外部模型不得提供数值。

---

## 7. 未验证 / 边界

- 我**没有**运行任何 P2 代码（不存在）；本报告是设计 vs 现码的静态对照 + P1 实测经验的复用。
- 未验证 `EchoObservationInput` 是否已有 `hazards` 字段（我看到的接口没有；若 developer 打算新增，必须先证明它不来自隐藏地图）。
- 未验证 facet memory 是否会被 UI 读取（我只看代码结构）；M2 是设计层要求。
- 本轮无 gate（纯文档审查）。若 Lead 需要，我可以跑 `npx tsc --noEmit` 或对 `externalLinkController` 的 echo-actor 拒绝补一条 e2e 验证；但按本单"设计审查不机械写 tests"，留待 P2 实现阶段。

**阶段状态：P2 = 设计预审完成（3 阻断 + 6 Major 待修）；P1 仍为候选 PASS（tester 报告未齐，整体 GAMEPLAY-01 未 PASS）；P3/P4/P5 未开始。**
