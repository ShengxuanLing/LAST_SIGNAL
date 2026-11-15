# C3-c Player 权限阻断修复（Reviewer 4 项）

- 分支 `feat/ai-native-world-integration`；基线 `82734f6`（C3c 冻结验收）。本提交只修 Player 权限/执行/裁剪，**不改玩法、不接 Signal、不恢复 P3 实现**。
- Reviewer 报告：`reports/ai-native-02/reviewer/c3c/REVIEW.md`（Player 权限 FAIL，core/Dev PASS）。
- Lead 的 Headless 最小遭遇**执行事实保留**，但当时原始结果泄漏 canonical，**不能作为 P4 PASS**；本提交修复后仍需独立重验。

## 1. 阻断 1：非 Dev 原始结果泄漏 canonical（已修）

- `HeadlessWorldManager` 现在是**唯一**输出构造点，Player 面用显式**白名单**（不是删字段）：
  - `publicObservation()`：只保留 `schema/protocolVersion/epoch/tick/roomId/player/drones/projectiles/availableActions`（裁剪后的 `WorldObservationV1`）。
  - `step`：`{ok,schema,session,epoch,requestId,fromTick,toTick,ticks,blockTicks,status,executing,applied,rejected,observation,eventCount,events}` —— **无** `canonicalState/canonicalEvents/seed/map/rng/隐藏 entity`。
  - `action`：只回 `{session,epoch,requestId,acceptedTick,applyByTick,replayed,actions:[{actionId,status,applyByTick,code?}]}`。
  - `create/list/observe/close` 同样白名单；`seed` 只在 Dev 面出现。
- **公开事件按观测裁剪**：新增 `headlessPublicEvents.ts`（显式 per-type allowlist）。`drone-step`/`room-generated`/`player-reset` 永不出现在 Player 面；`enemy-hit/enemy-died/loot-dropped/enemy-spawned/projectile-*` 仅在 `isPerceivable(x,y)` 时出现；`loot-dropped` 输出扁平公共字段（不再是 owner `loot` 形状）。
- **幂等 cache 重放**同样走白名单（Dev 才带 canonical）；错误/异常只回 `code/messageKey/path`，`exportFailure`/`snapshot`/`inspect`/`replay` 仍仅 Dev。
- 证据：`src/ai-native/worldHeadlessPlayerCrop.mts` 用**官方 SDK** 直接检查原始 `structuredContent` 与 `content[0].text`（递归禁词 + 顶层键白名单），并验证 Dev 仍保留完整 owner 证据 → `PLAYER_CROP_NEGATIVE_PASS`。

## 2. 阻断 2：step 分包提前 ACK（已修，跨 step 持久执行）

- 新增共享纯规则 `src/ai-native/actionExecution.ts`：`consumeExecutionTicks(remaining, coreTicks)`。**Rendered 的 `ExternalLinkState.advanceExecution` 与 Headless step 共用**这一条 duration 规则，不再各写一套。
- `HeadlessSession.active` 跨 step 保存 `{actionId,requestId,intent,actionType,durationTicks,remainingTicks,startedTick,applyByTick,epoch}`：
  - 短 step 只消费 `remaining` 中可用的 tick，**不 ACK**，返回 `executing{executedTicks,remainingTicks}`；
  - 只有 duration 完整消费（或明确取消/到期）才 ACK `applied/rejected`；
  - 与 Rendered 一致：`move/fire` 用 action `ticks`，`aim/interact/stop` 1 tick；FIFO；`stop` 抢占 active（记 `executedTicks`，`E_PREEMPTED`）；TTL 超 `applyByTick` → `E_TIMEOUT`；epoch 变化 → `E_STALE_EPOCH`。
- 证据：`step10` 后 `executing={executedTicks:10,remainingTicks:110}`、`applied=[]`；`step110` 后 `applied[0].executedTicks=120`、`appliedTick=120`；与一次 `step120` 的 `canonicalState`/`canonicalEvents`/status 完全一致（单测断言字符串相等）。

## 3. 阻断 3：stepCache 128 淘汰后可再推进（已修，硬配额 + 墓碑）

- 新增 `src/ai-native/headlessRequestLedger.ts`：
  - **去重集合硬界** `MAX_REQUESTS=256`：满时**原子拒绝**新请求（`E_RESOURCE_LIMIT`，不推进、不收费），从不淘汰去重项。
  - **响应缓存** `MAX_RESPONSES=128` 可淘汰，但被淘汰的 id 进入有界**墓碑**（`MAX_EVICTED=512`）；重放该 id → `E_RETRY_AFTER_EVICTION`，**绝不会再次推进**。
  - 同 id 不同 payload（或跨域）→ `E_ID_PAYLOAD_MISMATCH`。
  - **`step` 与 `action` 共用一个 requestId 命名空间**，跨域复用不能绕过去重。
  - Dev `restore/loadRoom/spawnEnemies` 会 bump epoch 后**清空 ledger 与 active**；旧 epoch 请求先被 epoch 校验拒绝。
- 证据：131 次 step 后重放首个 requestId → `E_RETRY_AFTER_EVICTION` 且 tick 不前进；第 257 个不同 requestId → `E_RESOURCE_LIMIT` 且 tick 不前进；action 用过的 id 再用于 step → `E_ID_PAYLOAD_MISMATCH`。

## 4. 阻断 4：Headless 弹丸未裁剪（已修，复用同一投影）

- `HeadlessWorld.observation()` 不再手写 projection，改用 **`buildExternalObservation`**（C3b 同一纯函数）：`drones/targets` 用 `perceivedActors`，`projectiles` 用同一个 `isPerceivable`（12 格 + 已探索 + LOS）。
- 新增 `HeadlessWorld.isPerceivablePosition`。墙后/他房/远距弹丸不再出现在 Player observation。
- 证据：单测远/墙后/不可感知弹丸被裁剪；parity 与 Rendered 使用同一路径。

## 5. Parity：真实击杀 + 真实 loot + 资源状态/事件

- `tests/c3c-headless-parity.spec.ts` 改为**自适应序列**：真实 `drone` → 逐 tick 瞄准其当前位置开火直到 `enemy-died` → 记录真实意图序列 → 移动至掉落点（若仍在场）。
- `rendered.json` 增加 `lootLeft/currency/xp/level/playerHp`；Node 重放比较这些值。
- 结果：`C3C_RENDERED_HEADLESS_PARITY_PASS finalTick=27 events=59 kills=1 lootLeft=0 currency=4 xp=8`，16/16 项（state/events/finalTick/drones/projectiles/loot/currency/xp/level/HP + `enemy-died`/`loot-dropped`/`loot-collected`）。
- 说明：当前真实拾取阈值较大，击杀掉落通常在同一次遭遇内被 `stepLoot` 自动拾取；因此断言的是**真实 loot 落地 + 真实拾取事件 + 资源状态**，不是夹具注入。未改玩法阈值。

## 6. Player intent 审计

- `parsePlayerIntent` 改为**严格 allowlist**：顶层键必须恰好 `aim,dash,fire,interact,move`；`move/aim` 只允许 `x,y`；拒绝 `hp/seed/position/weaponKey/...` 等注入；非有限/超界拒绝；`move` 模长 >1 时归一化（即使未来 core 不再归一化，也不会超速）。
- MCP zod schema 仍是 `strictObject`，SDK 层先拒绝未知字段；manager 再校验一次（双保险）。
- 幂等 fingerprint 使用**归一化后的 intent**，避免同一语义被当作不同 payload。

## 7. 其他要求

- `worldHeadlessMcpSmoke.mts` 增加**权限负向**（Player 调 Dev 工具被拒、Player create 带 seed 被拒）与跨 step/canonical 断言，不再只看工具列表。
- Dev `restore` 返回新 epoch 且旧 epoch step 被拒；`exportFailure` 仅 Dev，返回真实文件路径（Player 面 `E_PERMISSION` 且无 path）。
- 日志：`reports/ai-native-02/c3c-player-crop-fix/logs/`（每行 PASS/FAIL + 命令 + 结果 + 路径）。

## 8. 质量门（`reports/ai-native-02/c3c-player-crop-fix/logs/gate.log`）

| 门 | 结果 |
| --- | --- |
| typecheck | PASS |
| unit | PASS **38 files / 542 tests** |
| build / build:test / MCP 三入口 | PASS |
| 官方 SDK Player 裁剪负向 | PASS `PLAYER_CROP_NEGATIVE_PASS`（structured + text） |
| Headless MCP smoke（Player+Dev） | PASS（含权限负向、跨 step、无 canonical） |
| Rendered↔Headless parity | PASS 16/16（真实击杀 + loot + 资源） |
| 默认 StationZero MCP / `--world` smoke / lease smoke | PASS |
| token ACL / F-03（prod/test/custom mode） | PASS |
| C3b 定向 repeat ×3（16 用例） | PASS **48/48** |
| 全量 E2E（五视口 + C2 回归） | PASS **69/69** |

## 9. 未完成 / 不声称

- 本修复**仍待独立 Reviewer 重验**；在通过前 P4 不能 PASS，P3 实现继续冻结。
- 真实 LLM 的 Headless 最小遭遇执行事实保留，但“权限通过”需重验后的原始证据。
- Signal 未实现（`E_NOT_APPLICABLE`）；未新增虚构 Energy/scan/jam。
- 未 merge/push/stash；C2 维持放行。
