# C3c 修复：Player step-intent 旁路 + Dev snapshot 边界

- 分支 `feat/ai-native-world-integration`；基线 `8f1ce6c`（Reviewer 确认输出/弹丸/10+110/ledger/kill-loot 已通过，剩 intent + snapshot active 两项）。
- 本提交只修这两个边界，**不实现 P3、不改玩法、不接 Signal**；C3c/P4 仍需独立重验后才放行。

## 1. Player step-intent 旁路（Tester F2）

**契约**：非 Dev Player 的 `world_headless_step` **不接受任何 `intent`**。唯一合法通道是 `world_action` 入队 → `step` 推进。

- **官方 MCP schema 层**：Player 注册的 `world_headless_step` 输入 schema **根本不包含** `intent` 字段（`strictObject`），SDK 在进入 manager 前直接拒绝。
- **manager 层（防直调）**：`HeadlessWorldManager.step` 非 Dev 检测到 `intent !== undefined` 立即返回 `E_PERMISSION / world.headless_intent_player_forbidden`，且在**任何 quota 预留 / tick 推进 / 队列处理之前**，因此被拒绝的请求不推进、不收费、不改队列，同一 `requestId` 仍可用于法步。
- **未入队时 neutral**：`step` 只推进已排队的 `world_action`，其余 tick 用 neutral（玩家不移动、不开火）。
- **Dev 保留**：Dev `step` 仍接受严格 `intent` 用于 fixture/replay（未知字段/`hp`/`seed` 拒绝，`move` 模长 >1 归一化，不超速）。
- 工具描述与控制台帮助同步：Player 必须 `act` 再 `step`；仅 Dev 可 `step <ticks> [intentJson]`。

回归：
- 单测 `worldHeadlessStepChannel.test.ts`（5）：直调 intent → `E_PERMISSION` 且 tick/配额不变；neutral 不移动/不开火；`act(move)+step` 真实移动；Dev intent 生效；Dev 仍拒非法 intent。
- 官方 SDK smoke（Player）：`world_headless_step` 带**合法** intent 也被拒；拒绝后 tick 不变；neutral step 位置/弹丸不变；`act+step` 真实移动。
- 官方 SDK 原生负向脚本 `worldHeadlessPlayerCrop.mts`：Player step 带 intent（合法或注入 hp/seed/extra）全部拒绝。

## 2. Dev snapshot active 缺口（Reviewer 阻断）

**契约**：`world_headless_dev_snapshot` 只在 **ACTION BOUNDARY** 允许 —— session 无 active 执行且无未处理排队动作。

- 执行中 / 排队未消费 → `E_NOT_APPLICABLE / world.snapshot_requires_action_boundary`，**不取消、不 ACK、不推进**，active 的 `remainingTicks` 原样保留。
- 成功帧新增 `boundary: "action"`（frame 与结果都标记），文档/工具描述标为 *action-boundary snapshot*。
- `world_headless_dev_restore`：
  - 只接受 `boundary === "action"` 的帧（缺标记 → `world.snapshot_requires_action_boundary`）；
  - 当前 session 也必须处于 boundary（否则 `world.restore_requires_action_boundary`），避免静默丢弃在途/排队动作；
  - restore 后 epoch 严格递增、ledger/active 清空；核心 `pendingCommands` 属于未来状态，随帧保存/恢复（不构成不完整）。
- **失败导出**：`world_headless_dev_export_failure` 附 `manager{boundary:'action'|'mid_execution', replayable, active{startedTick,executedTicks,remainingTicks,durationTicks,...}, queuedActions, ledger}`。执行中导出 `replayable:false`、`note` 明确 “INCOMPLETE … remaining ticks are NOT in the frame”，且**不**给 frame 打 boundary 标记；只有 boundary 导出才是完整/可重放。
- **Dev inspect** 同步暴露 `manager.boundary/active/queuedActions/ledger`，仍可诊断。

回归（`worldHeadlessSnapshotBoundary.test.ts` 7 + SDK smoke）：
- `fire120 → step10 → snapshot` 被拒；active 仍 `remaining=110`、tick/ledger 不变；
- `step110` 完成后 snapshot 成功（`boundary='action'`）→ restore `epoch++`；
- 同一序列（含 restore 与不含 restore）之后的动作 canonical state **与后续动作 events 完全一致**；
- 排队未执行 snapshot 被拒且队列保留；
- restore 拒绝无标记帧 & 当前 session 非 boundary；
- `exportFailure` 执行中标 `mid_execution/replayable:false` 且带 active 摘要，boundary 时 `replayable:true`；
- 官方 SDK Dev：执行中 snapshot 被拒、完成后成功 restore。

> 说明：比较“后续动作 events”时使用该 step 产生的事件，而非整段历史的 `canonicalEvents`。历史 `projectile-spawned` 事件持有活动弹丸引用（既有 C2 投影细节），整段比较会受引用变异影响；state 与后续动作事件一致才是 restore 正确性的判据。

## 3. 质量门（`reports/ai-native-02/c3c-step-channel-fix/logs/gate.log`）

| 门 | 结果 |
| --- | --- |
| typecheck | PASS |
| unit | PASS **39 files / 554 tests** |
| build / build:test / MCP 三入口 | PASS |
| 官方 SDK Player 裁剪/通道负向 | PASS `PLAYER_CROP_NEGATIVE_PASS` |
| Headless MCP smoke（Player+Dev，含通道/边界） | PASS `HEADLESS_MCP_SMOKE_PASS` |
| Rendered↔Headless parity（真实击杀+loot） | PASS 16/16 |
| 默认 StationZero MCP / `--world` smoke / lease smoke | PASS |
| token ACL / F-03（prod/test/custom mode） | PASS |
| C3b 定向 repeat ×3（16 用例） | PASS **48/48** |
| 全量 E2E（五视口 + C2 回归） | PASS **69/69** |

## 4. 剩余边界 / 未声称

- 本修复仍待独立 Reviewer 定向复核；通过前 C3c/P4 不放行，P3 实现继续冻结。
- Headless 真实 LLM 最小遭遇的“权限通过”需用本提交重跑原始 SDK 证据。
- Signal 未实现（`E_NOT_APPLICABLE`）；未新增 Energy/scan/jam。
- 未 merge/push/stash；C2 维持放行。
