# GAMEPLAY-01 · P1-A 中期独立审查（Reviewer · 只读）

**结论：P1-A 无阻断项（BLOCKER=0）；但证据集版本不齐，且 P1-B 有几处会咬人的设计风险。**
本审查是**中期**：B 仍在开发、源码仍在小步变动，**不是冻结版、不是最终 PASS**。

## 0. 审查快照（源码可能仍在变）

| 文件 | 我审查时的 SHA256（前 16） | 备注 |
|---|---|---|
| `src/world/sim/core.ts` | `00d67ce0d8257f96` | 审查全程未变 |
| `src/world/World.ts` | `cd84d045609fb3e9` | 审查全程未变 |
| `src/signal/relay.ts` | `4c5e51b39efabf25` | 未变 |
| `src/config/p1Scenario.ts` | `1b87c1e39836d0a0` | 未变 |
| `src/systems/RunCheckpoint.ts` | `244f1082433e2b83` | 未变 |
| `src/scenes/GameScene.ts` | `51d7ad43adae` → **`61847c8f241b`** | **审查期间被改动过**（HUD 细节），下文凡涉及 GameScene 的结论以我读到的两版并集为准 |

只读：未改 `src/`/`tests/`，未提交/push，未碰 tester 的独立 P0 clone 与其端口。证据只写 `reports/gameplay-01/reviewer/`。

## 1. 已验证（有代码/实测证据）

### 1.1 反事实真实：链接只抑制"新开火"
- 核心：`stepDrones` 从 core 态取链接（`drone.relayDeviceId === state.signal.deviceId`），`attackAllowed = !linked || signalOutput(linked)`，只把 `step.attack = null`（新开火）——**不触碰 `state.projectiles`**，所以在飞的弹丸继续存在、继续造成伤害。
- `signalOutput(relay) = (relay === 'ACTIVE')`（`src/signal/relay.ts:41`），与 HUD 用的 `p1LinkedFireEnabled`（`signal.relay === 'ACTIVE'`）**判据完全一致**，HUD 不会与 core 打架。
- 实现者实跑证据 `reports/gameplay-01/developer/p1/demo-A-verify.json` 自洽且与代码一致：
  - `ACTIVE`：`linkedFire:true`，`linkedShots:[2,3]`，hp 94；
  - `JAMMED`：energy 100→77（jam 25 扣费 + regen）、`linkedFire:false`、`linkedShots:[3]`（旧弹仍在）、**hp 88→82 持续掉血**（旧弹命中，反事实成立）；
  - `jamRemaining` 330→161 逐 tick 递减；到期后 `ACTIVE` + `linkedFire:true`。
- 新单测 `src/world/sim/signalLink.test.ts` 覆盖：ACTIVE 时 linked 开火 / unlinked 独立；JAM 后 linked **0 新弹**、unlinked 照打、旧弹仍在；到期恢复；重复 jam → `E_RETRYABLE` 且**不重复扣能**；scan 证据白名单只含 relay 事实（无 `roomId`/`future`/`targets`）。

### 1.2 路由/出口语义（P1-B 的规则基础）
- 新 `routeMatches`：`ACTIVE→RELAY_ACTIVE`、`INACTIVE→RELAY_INACTIVE`、**JAMMED/DISABLED 两不匹配**；旧 `relayOutput`/`exitOpen` 语义未改（`src/signal/relayRoutes.test.ts` 4 个状态全断言）。

### 1.3 旧 run 行为不变
- `p1Scenario` 默认 `null`；`link-drones-to-signal` 只由 `World.spawnP1Sentry()` 发出；`stepDrones` 在 `linked === null` 时 `attackAllowed = true` → 普通 run 的 drone 行为逐字节不变。
- `spawn-signal-device` 新增的 `initial` 是可选字段，`worldHeadless.ts` 的 dev 路径**不传**它 → headless 旧行为不变。

### 1.4 存档/回退
- `RunCheckpoint.demo?: 'p1'` 为可选；`validateCheckpoint` 只在 `demo !== undefined` 时校验取值 → **旧存档无 `demo` 仍合法**。
- `restoreCheckpoint` 先 `setupP1Scenario()`（重建 route 边）再校验 `portalTarget`（`connectedTo.includes`）→ 演示存档的 `portalTarget` 不会因缺边而被判不兼容。
- 恢复时 `_sim.drones = []`（既有行为），`relayDeviceId` 不会被错误继承；`coreState.signal` 原样恢复（含 `relay`/`jammedUntilTick`）→ 恢复后 `signalOutput` 判据即正确。
- `toCheckpoint` 只在演示 run 写 `demo`，普通 run 存档字节不变。

### 1.5 单权威 / MCP 暴露
- 链接挂载逻辑在 **core**（`processCommands` + `stepDrones`）；World 只发命令与读态，**没有在 adapter 另跑 hazard 因果**（route→portal 属关卡编排，见 §3 边界说明）。
- `link-drones-to-signal` 全仓库只出现在 `sim/core.ts`、`World.ts`、`world/sim/signalLink.test.ts` —— **不在任何 MCP/gateway/agent 面**（`externalLinkController` 的 signal 动作仍是既有 scan/jam 两条，未扩）。
- 玩家/agent 无法直接触发 `initial` 或 link 命令。

### 1.6 HUD 诚实性（Lead 要求的改名已落地）
- 源码已删 `DRONES SAFE/FIRING`，现为 `LINK · FIRE ENABLED` / `LINK · NEW FIRE BLOCKED · OLD SHOTS STILL LIVE`。
- 实拍复核 `reports/gameplay-01/developer/p1/demo-A-v2-jammed-1280x720.png`（20:31:40，晚于源码 20:30:55 改动）确认渲染正确：`RELAY JAMMED · EXIT CLOSED` + `LINK · NEW FIRE BLOCKED · OLD SHOTS STILL LIVE` + `SCAN 10 · JAM 25 · R 12/6 · JAM 321t` + `PLAYER 78 · ECHO 100 · LAST JAM OK`，右对齐 4 行、无越界、与其它 HUD 不重叠。

### 1.7 主菜单入口
- 新按钮 `DEMO 01 · LINKED SENTRY`（y=640，w=420）与底部帮助文本（y=690）间距 20px **不重叠**；已有存档时走 `view:'replace'` 且 `REPLACE AND START` 保留 `demo`（`MainMenuScene.ts:77-79`）→ 不会丢掉演示标记。

## 2. 我跑的针对性 gate

| 命令 | 结果 | 日志 |
|---|---|---|
| `npx vitest run src/world/sim/signalLink.test.ts src/signal/relayRoutes.test.ts src/world/sim/signalState.test.ts src/world/sim/signalCombat.test.ts src/world/sim/rewiring.test.ts src/world/sim/core.test.ts` | **PASS**（6 files / 82 tests） | `D:/Project/LAST_SIGNAL/reports/gameplay-01/reviewer/logs/p1a-targeted-unit.log` |
| `npx tsc --noEmit` | **PASS**（0 error） | `D:/Project/LAST_SIGNAL/reports/gameplay-01/reviewer/logs/p1a-typecheck.log` |

未跑全量（741/118 属 tester），未自己起浏览器跑 Demo（用实现者证据 + 代码/单测交叉核对）。

## 3. 未测 / 未验证（不得当 PASS 依据）

1. **我没有亲跑 Demo-A 的浏览器流程**（只读代码 + 单测 + 实现者证据/截图）。solo 可达性、手感、HUD 在实际五视口下的表现未由我实测。
2. **P1-B 全部未实现/未验证**：ACTIVE/INACTIVE 两条 route 的端到端、JAMMED 两不匹配的玩家可见后果、`portalTarget` 跨存档持久、双路线价值对比。
3. **Headless 侧 P1 无法验证**：`p1Scenario`/route/portal 只在 `World`（Rendered 适配层）存在；core 只共享"链接→抑制开火"这一条因果。→ 结论：**"Headless/Rendered 共用"目前只对因果成立，对关卡/路线不成立**（可接受，但必须写明边界，见 §4.5）。
4. 完整 741 单测/118 E2E 未跑；`rewiring` 我跑了 PASS，但新增 `signal-scanned/signal-jammed` 事件字段对 canonical/parity 的影响未做字节级复核（旧导出快照已过时，属预期）。

## 4. 非阻断发现（建议在 P1 冻结前处理，按严重度）

**4.1 HUD 数字硬编码且与目标行用词冲突（建议先修，属"诚实 UI"）**
`GameScene.ts:800` 写死 `'SCAN 10 · JAM 25 · R 12/6'`；`World.ts:912` 写死 `'CLEAR THE LINKED SENTRY · SCAN 12 / JAM <6 / R TOGGLE RELAY'`。两处「SCAN/JAM」含义不同（一行是**能耗**，一行是**半径/范围**），玩家会读成"SCAN 12 与 SCAN 10 打架"。且 `World.ts` 已 import `SIGNAL_TUNING`，改为由 `SIGNAL_TUNING.{SCAN_COST,JAM_COST,SCAN_RADIUS,JAM_RANGE}` 派生是几行的事。

**4.2 core 的 link 命令校验偏薄（与 Lead 要求有差距，但当前不可被滥用）**
`link-drones-to-signal` 只校验 `drone.hp > 0`：不校验设备存在、不校验**同房间**、不拒绝"别设备"（会存下一个惰性链接），未知 id **静默跳过且无事件**。今天唯一的签发者是 `World.spawnP1Sentry()`（只 link 本房间刚 spawn 的 drone），且 `stepDrones` 里 `deviceId` 不匹配即视为未链接（**fail-open**，不会误抑制），所以不可利用；但建议补：设备存在 + 同房间 + 目标有效时发一条 `signal-linked` 事件（含被跳过的 id），并加三条负向单测。

**4.3 路由候选没有房间类型过滤（P1-B 风险）**
`setupP1Scenario()` 取 `room.connectedTo` 的前两个（不足则取任意房间），**不过滤 boss/exit/shop 房**，并向 `connectedTo` 里 push 边。若 route A/B 落到 boss 房或出口房，演示会被破坏（或变成跳关）。建议：候选只收 `kind === 'combat' | 'resource'` 之类，并在不足 2 个时**显式失败**而不是静默。

**4.4 演示可能静默降级**
`setupP1Scenario()` 在 `targets.length < 2` 时直接 `return`（`p1Scenario` 保持 null）→ `spawnP1Sentry()` 也直接 return → 玩家从主菜单点 DEMO 却进了一个**普通 run**，没有任何提示。建议：无法组建演示时给明确提示（菜单 notice 或场景内提示），不要静默。

**4.5 边界声明缺失（Headless / 关卡编排）**
route→portal 的决策在 `World.updateP1RoutePortal()`（每帧由 `updateRoom()` 驱动），不在 core。这是"关卡编排"而非"hazard 因果"，**我判定为可接受**，但必须在文档/报告里写明"P1 的路线/传送门是 Rendered 适配层行为，Headless 不承诺"；否则将来会被当成 parity 缺口。

**4.6 JAMMED 时传送门消失的边界（P1-B 需专门测）**
`p1RouteFor` 在 JAMMED 返回 null → `updateP1RoutePortal` 会 `clearPortal()`。玩家站在门上时按 R/被 jam，门会消失；`tryInteract` 依赖 `this.portal` 非空，行为应安全但需要一条"站在 portal 上被 jam"的用例。另：JAMMED 期间存档 → `portalTarget: null`；恢复后需验证"到期或 R 切 INACTIVE 后，路线与门能正确重建"。

**4.7 观感/可读性（小）**
- `roomObjective` 直接暴露内部房间号 `R-xx`；`'JAM <6'` 这种开发者记号对玩家不友好。
- L1 右列新增 `txtSignalDetail` 共 3 行：1280×720 实测无重叠，但 compact（17px）下需在五视口复核（属 P3 范围，不属本单）。

## 5. P1-B 风险清单（先给设计/测试清单，不预设结论）

1. **两条 route 的真端到端**：ACTIVE→A、INACTIVE→B 各自**可完成**；不是"一条必败"。要记录：时间/受伤/Energy/操作次数/建议接受率 的双路线实测。
2. **JAMMED 两不匹配**：JAMMED 期间无门；站在门上被 jam；JAMMED 期间存档 → 恢复后门能重建。
3. **目标持久**：`portalTarget` 跨存档（含 JAMMED/null）、跨"重新进入该房间"（`onEnterRoom` 是否重建门）、跨 `R` 切换的实时更新。
4. **路由候选质量**：候选房过滤（4.3）、不足两个时的显式失败（4.4）。
5. **死亡/退出语义不变**：死亡 = `finishRun` → 新 R0；仅退出/刷新恢复 checkpoint（演示 run 也一样）。
6. **CHECKPOINT 兼容**：旧存档（无 `demo`）→ 正常 run；演示存档在不支持的代码版本上应被判不兼容而不是崩溃。
7. **HUD 数字来源**：P1-B 上线前把 §4.1 的硬编码换成 `SIGNAL_TUNING` 派生，否则调平衡时 HUD 立刻说谎。

## 6. 证据版本问题（需要在冻结时统一）

`reports/gameplay-01/developer/p1/` 里混了两代证据：

- **旧代**：`demo-A-start/after-1280x720.png`（20:22）、`demo-A-active/jammed/manual-off-1280x720.png`（20:27）、`demo-A-*-early-1280x720.png`（20:31:24）—— 我实看 jammed-early 图，HUD 仍是旧文案 `SCAN 10 · JAM 25 · R 12/6 · JAM 324t · DRONES SAFE · LAST JAM OK`（单行版）。
- **新代**：`demo-A-v2-{active,jammed,manual-off}-1280x720.png`（20:31:39–51，晚于源码改动）—— 与当前源码一致。

→ **最终审查只能采信 v2（以及冻结后重跑的新证据）**；旧代图必须标注/归档，否则日后会被误当成当前实现的样子。`demo-A-verify.json` 的**状态数值**仍成立（它记录的是 core 状态，不是 HUD 文本），但它的 `objective` 字段也是旧文案。

## 7. 结论

- **阻断项：0**（代码层面无安全/单权威/存档/权限退化；MCP 未暴露内部命令；旧 run 行为不变）。
- **可信度结论：P1-A 的因果链（relay→新开火抑制、旧弹继续、unlinked 不受影响、到期恢复、scan 证据白名单）已被代码 + 单测 + 实现者实跑三方交叉确认。**
- **但不可当最终 PASS**：B 未完成、证据两代混杂、HUD 数字硬编码、core link 校验偏薄、路由候选未过滤。
- 建议 Lead 在冻结 P1 时要求：统一证据代次 + §4.1/4.2/4.3/4.4 处理 + §5 的 B 清单逐条给用例。
