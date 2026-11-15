# P3-a 可见 ECHO 同伴（Actor 核心 → 渲染实体/模式 UI → 存档/一致性/演示）

- 分支 `feat/ai-native-world-integration`；P3-a 小步提交：核心 actor `8b2de8e`、渲染实体/模式 UI `c3e1461`、存档/一致性/演示（本提交）。
- 前置：Task0 Owner 文件/预算/控制台修复已单独提交 `39a43b2`（不在本报告范围）。
- P3-b（LLM Companion）与 Signal/能量未在本阶段实现，保持显式 UNSUPPORTED。

## 1. Actor 核心（`src/world/sim/core.ts`）

- 新增 `SimEchoState`：独立 `actorId`、位置、HP、冷却、朝向、invuln/hurt/dash 计时；`data` 是**独立构造**的 `basePlayerData()` + 武器 `pulse`，无任何玩家升级/技能/货币共享。
- 抽取并复用既有 pure 规则：`tickActorTimers`、`fireActor`、`stepActorMovement`、`applyActorHit`；玩家与 ECHO 调用同一套（冷却、弹匣/换弹、暴击、击退、无敌帧、碰撞）。
- 同一 tick 单权威：`stepSimulationTicks(state, ticks, intent, echoIntent?)` 在 `stepPlayer` 之后、`stepDrones` 之前执行 `stepEcho`；`echoIntent` 只来自 P3-a 策略层，Player MCP 面不提供该字段。
- 敌人合法选择 ECHO：`chooseActorTarget` 取最近的存活 actor（玩家或 ECHO），melee/远程弹道都可命中 ECHO（`echo-hurt`/`echo-death`），诊断 `targetId` 置为 1。
- 无 ECHO 时：canonical 投影不含 `echo` 键，3 参 `stepSimulationTicks` 与旧行为逐 tick 完全一致（单测对比 canonical 字符串）。
- 事件为不可变值：`echo-moved/fired/hurt/death/spawned/despawned`，弹道 `source:'echo'`，`ownerId:1`。

## 2. 渲染实体 / 模式 UI（`src/world/World.ts`、`GameScene`、`PauseScene`）

- `EchoController`（`src/ai-native/echo.ts`，纯 TS，无 Phaser）：`follow / hold / move-to`；`decide(view)` 只读 ECHO **自己的** 12 格 + LOS 感知（`echoView()` 以 ECHO 为中心、要求已探索房间与 LOS），记忆有界（16 条 / 600 tick TTL）；**辅助开火必须由人类显式确认**，模式切换/撤销/死亡/接管立即清空；不会自动索敌开火。
- 可见表现：代码绘制圆形本体 + 朝向楔形（随 `aimYaw` 旋转）、指向最近感知目标的细线、受伤/死亡透明度变化；死亡独立于主角（主角死亡仍走 `finishRun`→新 R0）。
- HUD：右侧新增第 8 行 `ECHO`（HP / 模式 / ASSIST SAFE|ARMED / CONFIRM FIRE），五视口（1920×1080 … 800×600）不重叠、可读。
- 指令入口：Pause 菜单左侧 `ECHO COMPANION >` → ECHO 面板（ENABLE/DISABLE、FOLLOW、HOLD、MOVE TO AIM、SUGGEST、CONFIRM/REVOKE ASSIST、BACK）。不占用任何游戏按键（避开 G 等 Supply 键）。
- 人类始终控制主角：`enableEcho()` 通过 `takeoverFromHumanInput()` 生效；外部 Player 控制不会夺取 ECHO 指令权，也不会被 ECHO 夺取。

## 3. 存档 / 一致性 / 演示

- 检查点：`CoreCheckpointState.echo?`（深拷贝）；旧存档无 `echo` 仍合法；`validateCheckpoint` 拒绝 HP 越界/非有限/非 pulse 的畸形 payload；运行时 `capture/restore` 往返。
- `HeadlessWorld`：`enableEcho()`（命令在 tick 边界提交）、`echoView()`（与渲染侧同一感知实现）、`runSteps` 的 `echoIntent`（仅 owner/dev 驱动，Player MCP 不计入）。
- Node 一致性脚本 `scripts/p3a-echo-parity.mts`：
  - 同 seed/输入两次独立运行 → canonical state/events 完全相同；
  - tick-180 边界快照 + 策略状态恢复 → 继续到 tick-360 与不中断运行 canonical 完全一致；
  - ECHO 真实开火并击杀真实 drone（初始 HP 27 → 消失）；
  - canonical 含 `echo`。
- 真实浏览器 E2E（`tests/ai-native-world.spec.ts` 的 P3-a 用例）：Pause 面板启用 → FOLLOW 跟随且不重叠 → HOLD 站桩 → 生成真实 drone → **确认前 0 发** → 确认后 ECHO 真实击杀 → 主角远离后 ECHO 被真实打伤（主角 HP 不变）→ HUD 状态；连续截图 4 张。

## 门禁（`reports/ai-native-02/p3a/logs/gate.log`）

| 门 | 结果 |
| --- | --- |
| typecheck（含 scripts） | PASS |
| unit | PASS **602 tests / 47 files** |
| build / MCP build | PASS |
| `P3A_ECHO_PARITY_PASS` | PASS |
| Headless smoke / 20k stdio / Player crop 负向 / 控制台真实启动 | PASS |
| `ai-native-world.spec.ts`（含 P3-a、五视口 HUD） | **10/10 PASS** |
| C2 parity + C3-b external-link + C3-c headless parity | **19/19 PASS** |
| 全量 E2E | PASS **70/70**（`logs/pw-full-e2e.log`） |

## 证据

- 截图（`reports/ai-native-02/p3a/evidence/`）：`p3a-echo-1-enabled`、`-2-armed`、`-3-killed`、`-4-hurt`（1280×720）。
- 操作日志：`operation-log-p3a-echo-1280x720.json`（启用/跟随/站桩/确认/击杀/独立受伤的真实坐标与 HP）。
- 日志：`reports/ai-native-02/p3a/logs/`（每行 PASS/FAIL + 命令 + 结果 + 路径）。

## 限制与诚实边界

- 本阶段 ECHO 是**本地确定性策略**，不是 LLM；HUD/面板不显示“已连接外部模型”。未连接时不会有假的 connected 状态。
- Node/Rendered 共享同一 core + `EchoController`；本轮未新增字节级 rendered↔headless ECHO 对比驱动（渲染侧由真实浏览器 E2E 验证同一 core 的 HP/伤害/HUD）。主角的既有 rendered↔headless 字节一致性仍由 C3-c 门禁覆盖。
- Lead 用冻结 `87d6ae0` 官方 SDK 完成的真实模型 Headless 最小单 drone 遭遇（`reports/ai-native-02/lead-headless-cropped/`）仍是目前唯一的真实模型遭遇；P3-a 未跑真实 LLM，也不声称完整 Run/P4 通过。
- Signal/能量、P3-b LLM Companion 明确未实现；无免费技能、无脉冲外武器、无隐藏实体读取。
- 未 merge/push/stash；单写者边界未变（`processCommands` 仍是唯一状态提交点，`enqueue*` 只校验/入队）。
