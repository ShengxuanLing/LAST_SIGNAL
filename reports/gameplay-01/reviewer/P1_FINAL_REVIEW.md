# GAMEPLAY-01 · P1 冻结候选 · 独立验收（Reviewer）

**结论：P1-A/B 在本审查范围与已跑证据下 = 工程层面 PASS（无闭环阻断）；HUMAN ACCEPTANCE PENDING；P2–P5 未完成，不得称为整个 GAMEPLAY-01 PASS。**
同时列出 6 条非阻断问题与 4 项「我没有独立验证」的缺口（见 §5、§6），这些不能计入 PASS 依据。

- 分支 `feat/gameplay-01-ai-cooperation`，基座 `c7e03c5` + 12 文件 P1 patch。
- 我全程只读 `src/`/`tests/`：未改、未提交、未 push；未碰 tester 的独立 P0 clone 与端口（我自起 5481，已关闭）。
- 证据只写 `reports/gameplay-01/reviewer/`（`P1_FINAL_REVIEW.md`、`logs/`、`audit/`、`p1/` 截图）。

## 1. 冻结校验（先于结论）

- `manifest.json` 的 `frozenSource` 共 **12 项**，我逐项实算 SHA256：**0 项不一致**。
  PauseScene→不适用；关键项：`GameScene 371fca31…`、`World 90295aaa…`、`core 2afcb1d0…`、`p1Scenario 1b87c1e3…`、`signalLink.test d2c8daad…`、`relayRoutes.test 3dab67b6…`。
- 我在浏览器审查**前后各取一次 hash**（`logs/p1final-hash-before.txt` / `-after.txt`）：**完全一致**（`GameScene/World/core/p1Scenario`），即本轮证据对应同一冻结源。
- 工作树里 `tests/ai-native-world.spec.ts` 的 dirty 属 tester 正在改 P3a（非 developer 越权）；我未触碰。

## 2. 我独立跑的 gate（一行一条）

| 命令 | 结果 | 日志（绝对路径） |
|---|---|---|
| `npx vitest run src/world/sim/signalLink.test.ts src/signal/relayRoutes.test.ts src/world/sim/signalState.test.ts src/world/sim/signalCombat.test.ts src/world/sim/rewiring.test.ts src/world/sim/core.test.ts` | **PASS**（6 files / 82 tests） | `D:/Project/LAST_SIGNAL/reports/gameplay-01/reviewer/logs/p1a-targeted-unit.log` |
| `npx tsc --noEmit` | **PASS**（0 error） | `D:/Project/LAST_SIGNAL/reports/gameplay-01/reviewer/logs/p1a-typecheck.log` |
| `PORT=5481 npx playwright test -c reports/gameplay-01/reviewer/audit/pw.p1.config.ts --workers=1`（真实主菜单入口 + 真实键盘） | **3 passed / 1 failed**（A、B、C 中 B 的第二次步行失败；详见 §4） | `D:/Project/LAST_SIGNAL/reports/gameplay-01/reviewer/logs/p1final-browser.log` |
| 同上 `--grep "C: independent"`（专项重跑两条路线步行） | **PASS**（1 test，两条路线均成功过门） | `D:/Project/LAST_SIGNAL/reports/gameplay-01/reviewer/logs/p1final-browser-C.log` |

我的 harness：`reports/gameplay-01/reviewer/audit/{p1-final.reviewer.spec.ts,pw.p1.config.ts}`；截图 `reports/gameplay-01/reviewer/p1/`。

## 3. 已独立验证（数字来自真实浏览器，非实现者证据）

### 3.1 从**真实主菜单**进入，不是私有 spawn
点击 `DEMO 01 · LINKED SENTRY` → `GameScene` + `world.p1Scenario` 存在；两只 drone（id 1/2）`relayDeviceId = relay_main`、`spawnRoom = 0`；routes = `{1: RELAY_ACTIVE}` / `{2: RELAY_INACTIVE}`；objective `CLEAR THE LINKED SENTRY · T SCAN · Y JAM · R TOGGLE`。

### 3.2 因果链（按**唯一 `projectile-spawned` 事件**计数，不看数组长度）
我在页面内只读地包了一层 `world.stepFrame` 收集 core 事件，按 projectile id 去重：

| 阶段 | 实测 |
|---|---|
| ACTIVE | 敌弹唯一 spawn 事件 **4**（id 1,2,3,4），HP 100→94 |
| JAMMED（按 Y） | 新增敌弹 spawn **0**；jam 计时 166 tick 倒数；**HP 94→88**，且 jam 时在场敌弹 2 发 → **旧弹继续伤害** |
| 到期 | relay 回 ACTIVE，新增 **3**（id 5,6,7）→ 恢复开火 |
| R → INACTIVE | 新增 **0** |
| R → ACTIVE | 新增 **4**（id 8–11） |

→ 「relay 输出只抑制新开火、旧弹不消失」得到**独立反事实确证**。

### 3.3 路由与 JAMMED 门
- ACTIVE → 门 target **1**（room kind `combat`）；R→INACTIVE → 门 target **2**（`resource`）——**实时切换**，且**均非 boss/extraction**（kernel 规则成立）。
- 按 Y 后 `portal === null`（JAMMED 两不匹配）→ 暂停存档：`run.demo === 'p1'`、`run.portalTarget === null`、`coreState.signal.relay === 'JAMMED'`；恢复后按 F **不换房**。
- 到期后（manual 保持 ON）门回 **target 1**（route A 恢复）。

### 3.4 真实键盘行走通过（无 teleport / 无临时无敌 fixture）
- **Route A**：BFS 路径 + WASD 长按 → 到达门格（dist 0.54, room 0）→ 按 F → **进入 room 1**（目标 A）✓（`p1final-browser.log` 与 `-C` 两次均成功）。
- **Route B**：R→INACTIVE → 门 target 2 → 真实步行到门（dist 0.64, room 0）→ F → **进入 room 2** ✓（`p1final-browser-C.log`，截图 `p1/walk-route-B.png`）。
- 我使用的唯一 fixture：`clearEnemiesForTest()`（清房以便出现门，已标注）+ 读取事件的 hook。**未**用 `setPlayerPositionForTest`，两条过门都由真实键盘行走 + 真实 F 完成。

### 3.5 core 链接校验与信息面
- `link-drones-to-signal` 现在校验：设备存在 + `deviceId` 匹配 + 活敌 + **同房间**（`spawnRoom === device.roomId`），并发出 `signal-linked { deviceId, linkedIds, skippedIds }`（**无静默跳过**）。
- 单测覆盖：正确链接、**错设备 id**、**跨房间**、**死敌人**、room transition（`signalLink.test.ts` 均断言 `skippedIds`），我本轮 82 tests 全绿。
- `link-drones-to-signal` 仍**不在**任何 MCP/gateway/agent 面（全仓只在 core/World/core-test）。
- Scan 证据白名单：字段仅 `expiresAtTick/id/kind/observedAtTick/observerActorId/x/y`，且不含 roomId/future/targets（单测 + 我复核代码）。

### 3.6 失败态（range/LOS/energy/cooldown）
- 站在门格（距 relay **6.9–7.0 格 > JAM_RANGE 6**）按 Y → `feedback {ok:false, code:'E_PERMISSION'}`，relay 保持 ACTIVE、**不扣能**（真实拒绝，不是假成功）。
- 重复 jam（已 JAMMED）→ `E_RETRYABLE` 且不重复扣能（单测）；能量不足/冷却由既有 `signalLegality` 断言（单测 + 我在 demo 中看到 jam 后能量 100→77 的真实扣费）。

### 3.7 800×600 compact 与菜单
- 新增 HUD 明细文本：逻辑 17px × 0.625 = **10.63 CSS px ≥ 10** ✓；与其它 HUD 文本 **0 重叠**（>1px 面积判定）；`LINK · FIRE ENABLED` / `NEW FIRE BLOCKED · OLD SHOTS STILL LIVE` 文案正确，COST/RANGE 由 `SIGNAL_TUNING` 派生（不再硬编码）。
- 主菜单 `DEMO 01` 与底部帮助行垂直间距 **50px**，在 800×600 下不重叠；有存档时的 replace 视图保留 `demo`（代码 + 早前审查）。
- 截图：`reports/gameplay-01/reviewer/p1/p1-compact-800x600.png`、`p1-menu-800x600.png`。

## 4. 未闭环但**不是产品缺陷**的一条（我的 harness 脆弱）

`B` 用例的第二次步行（route B，重启 demo 后）在我的 walker 下失败：玩家走进了 room 3、门因离开房间被清（`[walk] end … room:3, portal:null`）。同一路线在**专项 C 用例**中重跑成功并过门（room 2）。
→ 判定：**walker 非确定性 / 我的寻路实现问题**，非游戏缺陷；同时说明「从出生点到门的自然路径在个别布局下会经过门洞绕行」，已记入 §5 的 P4 观察。

## 5. 非阻断问题（6 条，建议 P3/P4 处理）

1. **HUD 明细对比度不足 AA**：`#5a7480` on `#05070c` = **4.07:1**，而该文本在 800×600 是 10.63 CSS px（小字），WCAG AA 要求 4.5:1。建议换 `#8fb8c8`（≈9.5:1）或增大字号。截图已存档。
2. **玩家出生点与 relay 设备同格**：实测 `distToRelay = 0.00`（冻结版同一 seed），初始视角里设备/标签可能被玩家压住；建议 authored 场景在 `findWalkableInRoom` 后排除玩家出生格。视觉/可读性问题。
3. **对 INACTIVE 的 relay 仍可 jam**：实测（同一冻结源的一次迭代）INACTIVE 时按 Y → `JAMMED`、能量 100→76、`ok:true`。语义上是「把已静默的继电器再临时静默」，玩家白花 25 能量；建议拒绝（honest no-charge）或明确允许并在 UI 提示「已静默」。
4. **门与 relay 距离 > JAM_RANGE**：门格距 relay 6.9–7.0 格，所以「站在门上再 jam」**在自然玩法里不可达**（走到门前 jam 必被 range 拒绝）。若验收要求「站门 jam 不能过」，需要调整布局（把设备移近门）或改验收口径为「JAMMED ⇒ 无门 ⇒ F 不通过」。
5. **range 拒绝码是 `E_PERMISSION`**：距离/LOS 类拒绝复用权限码，对玩家反馈文案（honest failure）不精确，建议区分 `E_OUT_OF_RANGE`/`E_NO_LOS`。
6. **自然步行路径可能绕行**：walker 两次从出生点走向门时经房间门洞走到 room 3（门因此在离房后被清）。属布局/可达性观察，P4 应记录「步行到门的时间/路径长度」作为可玩性指标。

## 6. 我没有独立验证的（不得计入 PASS）

1. **存档→刷新→CONTINUE 的完整回放**：我只验证了「JAMMED 时存档内容」（`demo:'p1'` + `portalTarget:null` + `signal.relay:'JAMMED'`），**没有**做 reload 后 CONTINUE 恢复并观察门重建的端到端；仓库里也没有覆盖 `demo` 恢复的单测。属 developer 证据 + 代码阅读，需在冻结验收里单独跑。
2. **3 seed 的候选房间排除**：我只验证了 1 个 seed（`P1_DEMO_SEED`）的 route 目标为 combat/resource；manifest 声称的多 seed 轮换未独立复核。
3. **Headless**：链接/抑制/旧弹/到期/失败/scan 白名单在 `sim` 与 82 单测里共享（真共用）；但 **routes/portal/portalTarget 明确是 Rendered-only**，我未验证任何 headless 关卡等价性 —— 与 `SIGNAL_INTERACTIONS.md §10.2` 的边界声明一致，P4 才补关键关卡规则一致；旧 parity gate 只证明旧选定序列。
4. **P4 价值对比 / 人类亲玩**：solo 与 human+ECHO 的时间/伤害/Energy/操作次数/建议接受率未测（P1 只有 authored 双路线苗子）；**无人类试玩** → `HUMAN ACCEPTANCE PENDING`。所有证据只属 fixture / agent / 我的自动 harness，**没有任何真人验收**，autoOwner 也是夹具。

## 7. 阶段状态（明确不冒充整体）

| 阶段 | 状态 |
|---|---|
| P0 基线 | 完成（tester 独立 7aa8b51 报告；CI 密闭性已由 `c7e03c5` 修复） |
| P1-A/B（本单） | **工程候选 PASS**（本轮独立复现因果/路由/门/存档字段/失败态/compact HUD） |
| P2 ECHO allowlist | 未实现 |
| P3 完整因果反馈 | 未实现（P1 只做了必要 HUD） |
| P4 正式关卡 + 双路线价值对比 | 未实现（P1 仅 authored 两条 route 苗子） |
| P5 / real LLM / 人类验收 | 未完成；realLLM 配置缺失 = BLOCKED；human = PENDING |

**判定：P1 冻结候选在工程层面通过（无阻断）；不构成 GAMEPLAY-01 整体 PASS。**
