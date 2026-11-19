# C3-c Player 修复独立重验（8f1ce6c / 代码 593786b）

- **被测提交**：`8f1ce6c06eaf95d03a2c6e7c9fc1e3f8c7a1c8f3`（HEAD），父 `593786b`（fix），祖父 `9e67d02`（ECHO 文档）
- **分支**：`feat/ai-native-world-integration`；未读/不恢复 WIP/stash；未改源/测试/分支
- **快照**：`git archive` 冻结 `D:/Project/lastsignal-c3c-player-review-8f1ce6c`；Python 计算 git blob SHA1 全量比对 → `ALL_TRACKED_FILES_MATCH`（1777/1777）
- **结论：C3-c Player 仍不能 PASS；P4 权限仍阻断；P3 继续冻结。** 上轮 4 个阻断中 3 个已闭环（canonical 泄漏、step 分包丢时长、ledger 淘汰重放、隐藏弹丸），但 **Player `step(intent)` 仍可绕过 action/TTL（硬阻断）**，且 **snapshot 不保存 active execution，restore 会丢 duration（未闭合）**。

## 一、质量门一行结果（命令 → 结果 → 路径）

| 门 | 命令 | 结果 | 路径 |
|---|---|---|---|
| 快照哈希 | Python blob SHA1 全量比对 | **PASS** 1777/1777 | `tree.ls` |
| 类型检查 | `npm run typecheck` | **PASS** exit=0 | `gate-typecheck.log` |
| 定向 unit | `npx vitest run worldHeadlessPlayerCrop worldHeadless worldHeadlessMcp worldHeadlessHarness task0` | **PASS** 57/57 | `gate-unit.log` |
| Rendered↔Headless parity（16 项） | Playwright export + `scripts/c3c-rendered-headless-parity.mts` | **PASS** 16/16，kills=1 lootLeft=0 currency=4 xp=8 | `gate-e2e-parity.log`、`gate-parity.log` |
| 官方 MCP smoke | `npx vite-node src/ai-native/worldHeadlessMcpSmoke.mts` | **PASS**（含 step10/110/replay 无 canonical 断言） | `gate-mcp-smoke.log` |
| 独立 Player 输出/时长/ledger 探针 | `vite-node reviewer-probe-c3c-player.mts` | 见下（含 1 个阻断） | `gate-probe-player-fixes.log` |
| 独立官方 SDK Player intent 探针 | `vite-node reviewer-probe-sdk-intent.mts` | **FAIL（确认阻断）** 非 Dev step 接受 intent | `gate-probe-sdk-intent.log` |
| 独立弹丸裁剪探针 | `vite-node reviewer-probe-crop2.mts` | **PASS** 远处隐藏弹丸已裁剪 | `gate-probe-crop.log` |
| 独立 parity 负向对照 | `vite-node reviewer-probe-parity-negative.mts` | **PASS** 改输入后 canonical/events 改变 | `gate-probe-parity-negative.log` |

## 二、已闭环（上轮问题）

| 上轮问题 | 结论 | 依据 |
|---|---|---|
| 非 Dev step 泄漏 canonicalState/canonicalEvents | **已闭环** | `worldHeadlessMcpTools.ts` 结果仅在 `this.dev` 时加 canonical；`publicObservation` 显式白名单；probe：`structuredContent`/`content[].text` 均无 canonical；smoke 也新增断言 |
| 隐藏弹丸泄漏 | **已闭环** | `worldHeadless.observation()` 改用 `buildExternalObservation`（同 rendered 感知裁剪）；probe：不可感知远处 enemy 弹丸不再出现 |
| 隐藏事件（drone-step/room-generated/player-reset/墙后位置） | **已闭环** | `headlessPublicEvents.ts` 显式 per-type 白名单；实体事件仅 `isPerceivable` 时输出；probe/smoke 无隐藏 FSM |
| step10 提前 ACK 丢 110 tick | **已闭环** | 新增 `active` 跨 step 持久 + `actionExecution.consumeExecutionTicks`；probe：step10 `executing` 无 applied，step110 `executedTicks=120`；10+110 与 120 的 canonical/events/observation 完全一致 |
| stepCache 128 FIFO 淘汰后旧 request 再推进 | **已闭环** | `HeadlessRequestLedger`：硬界 256（满则原子 `E_RESOURCE_LIMIT`，不推进）、响应缓存 128 淘汰即墓碑（重放 `E_RETRY_AFTER_EVICTION`）；probe 验证 |
| 跨 action/step 同 id | **已闭环** | 共享 requestId 命名空间；action→step 同 id → `E_ID_PAYLOAD_MISMATCH`；不同 payload 同 id 同理 |
| parity 无真实击杀/loot | **已闭环** | 新 parity 序列真实击杀 drone + 移动到掉落物拾取；16/16 PASS（kills=1, lootLeft=0, currency=4, xp=8）；负向对照：关掉 fire 后 canonical/events 改变 |

## 三、硬阻断（仍未闭合）

### 阻断 1：Player（非 Dev）`world_headless_step` 仍接受 `intent`，绕过 action/TTL 授权
- 代码：`worldHeadlessMcpTools.ts:673-675` 的 `world_headless_step` 注册对 **dev 与非 dev 使用同一 schema**：
  ```ts
  z.strictObject({ session, epoch, requestId, ticks, intent: intentSchema.optional() })
  ```
  `step()` 在 `intent !== undefined` 时 `parsePlayerIntent` 并在 `fill` tick 直接使用（`parsedIntent ?? neutralIntent()`），不经过 `action` 队列、不做 action TTL/applyByTick 校验。
- 独立 manager 探针：非 Dev `step(..., 10, {move:{x:1,y:0},...})` → `ok=true` 且玩家 x 改变。
- 独立**官方非 Dev MCP SDK** 探针（`dist-mcp/worldHeadlessMcpServer.mjs`，无 `--dev`）：`world_headless_step` 带 `intent` 两次均被接受，玩家被任意移动；同时确认无 canonical（canonical 已修）。
- 现有测试只测“合法 intent 形状”和“坏 intent 拒绝”，未测“Player 是否应完全禁止 intent”；因此该阻断未被绿门覆盖。
- **判定：硬阻断。** 严格 schema 只防任意 HP/seed 写入，不等于 Action TTL 授权；Player 仍可用 step(intent) 逐 tick 驱动移动/开火，绕过 action 队列与 TTL。
- **修复条件**：非 Dev 的 `world_headless_step` schema **移除 `intent`**（仅 Dev 注册带 intent 的版本）；manager 在 `!dev` 时若收到 intent 直接 `E_PERMISSION`；补“官方非 Dev SDK step 带 intent 被拒”的负向测试。

### 阻断 2：snapshot 不保存 active execution，restore 丢 duration（未闭合）
- `HeadlessWorldFrame`（`worldHeadless.ts:69`）只含 `sim/events/actionLog/enteredRooms/status/kills/shots/damageTaken/mapIdentity`，**没有 `active`（remainingTicks/epoch）也没有 request ledger**；`HeadlessWorldManager.snapshot()` 只返回 `record.world.snapshot()`；`restore()` 后 `record.active = null` 且 `ledger.clear()`。
- 独立 probe：120-tick move 执行 10 tick 后 `snapshot()` 帧无 `active`；restore 后再 step110 **不会**补完剩余 110（玩家几乎未继续移动）；同样序列不 restore 则正常完成（`executedTicks=120`）。
- 影响：中途快照/恢复会**静默丢弃** active action（无 cancelled receipt），replay 从该帧继续必与原 run 分叉，违反“snapshot 覆盖所有影响未来 state”的要求。Lead 已点明“save snapshot 只 sim 不 active 会丢 duration 也要明确”——当前实现属于**未闭合**。
- **修复条件（二选一）**：把 `active`（及 ledger 或明确的“action cancelled at snapshot”标记）纳入 frame 并在 restore 时恢复/明确取消；或在 snapshot 时拒绝/声明“仅 action 边界可快照”，并在 restore 返回明确的 `E_ACTIVE_ACTION_DROPPED`/cancelled receipt，避免静默丢时长。

## 四、其他核对（非阻断）

- **epoch/资源拒绝不部分推进**：probe 中 ledger 满后新 step `E_RESOURCE_LIMIT` 且 tick 不变；stale epoch `E_STALE_EPOCH`；restore/loadRoom/spawnEnemies 都 bump epoch 并清 active/ledger。PASS。
- **观测白名单**：`publicObservation` 只含 schema/epoch/tick/roomId/player/drones/projectiles/availableActions；无 seed/map/RNG/pending/ledger。PASS。
- **Task0（da7c169）**：STOP 抢占（记录 executedTicks，无 active 不造假 receipt）、token 从 globalThis 清理、lease 1000 周期有界旧 lease 不复活、LOST 后新授权原子回收/live 不被静默替换——`task0.test.ts` 9 项 + reclaim E2E 通过（本轮定向 unit 已覆盖）。
- **Dev-only detail**：canonical/snapshot/inspect/loadRoom/spawnEnemies/batch/compare/perf 仅 Dev 注册；Player 调用 `E_PERMISSION`。PASS。
- **perf/批测**：`dev_perf` 1000 ticks × 10 sessions 真实 combat（events 30340、liveTicks 9200、cpu/wall 有值），非空场景；`dev_batch/compare` 真实 kills/damage；`dev_batch_deterministic` 同 hash。PASS（Dev-only）。
- **Signal/ECHO**：`world_signal_status` 明确 `E_NOT_APPLICABLE`（未伪造）；`9e67d02` 仅为 ECHO 文档评估，无实现。仍属未完成。
- **真实 LLM**：Lead 的 Rendered 单 drone 已由 Reviewer 确认可关 P2 最小 Agent 子项；本次 Headless 最小遭遇执行事实保留，但 Player 权限因阻断 1 不能 PASS；非完整 Run。

## 五、可放行范围 / P3 / P4 判定

- **可放行（子项）**：Headless 同核心运行时、真实地图/敌人/武器、真实击杀/loot、16 项 parity、canonical/公开事件/弹丸裁剪、跨 step duration、ledger 有界、Task0。
- **不可放行**：C3-c Player 权限面（阻断 1：step intent 绕过；阻断 2：snapshot active 丢失）。**C3-c 整体不能 PASS；P4 权限不能 PASS；P3 继续冻结。**
- **下一步**：修阻断 1（Player step 去 intent + SDK 负向测试）与阻断 2（frame 保存 active 或显式取消边界），再复验；Signal/ECHO 仍未实现，不能宣称 P2/P4 完成。

## 六、报告目录

`reports/ai-native-02/reviewer/c3c-player-fixes/`：`REVIEW.md`、`tree.ls`、`gate-typecheck.log`、`gate-unit.log`、`gate-e2e-parity.log`、`gate-parity.log`、`gate-mcp-smoke.log`、`gate-probe-player-fixes.log`、`gate-probe-sdk-intent.log`、`gate-probe-crop.log`、`gate-probe-parity-negative.log`、`probe-player-fixes.mts`、`probe-sdk-intent.mts`、`probe-crop.mts`、`probe-parity-negative.mts`、`pw-out-parity/`。

未修改生产源码/已有测试/配置/分支；未合并/重置；未读取/恢复共享 WIP/stash；未把预写序列当作模型实跑。
