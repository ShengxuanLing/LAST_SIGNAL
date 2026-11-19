# C3-c 同核心 Headless MCP / P4 最低 harness 独立验收

- **被测提交**：`82734f639b5efa6683fd0ac046fa10ac93d9516a`（HEAD），父链 `122cafe`（LOST/CLOSED 重授权回收）→ `da7c169`（Task0 stop/凭据/lease）→ `8b9705d`
- **分支**：`feat/ai-native-world-integration`；未读/不恢复共享 WIP/stash；无源码 WIP
- **复核方式**：`git archive` 冻结精确 hash 快照 `D:/Project/lastsignal-c3c-review-82734f6`；Python 计算 git blob SHA1 全量比对 → `ALL_TRACKED_FILES_MATCH`（1753/1753）
- **补充证据**：Lead 亲自用冻结 `82734f6` 官方 MCP console `--headless`（非 Dev）完成 create→fire120→step120→observe cleared→close，见 `reports/ai-native-02/lead-headless/{REPORT.md,tool-io.jsonl}`；本复核用独立 probe 直接检查原始 step/API，不依赖 console 截断或现有 smoke。

## 一、结论（先给判定）

- **C3-c 不能 PASS。**
- **P4 “Player 权限/最小 harness” 不能 PASS**：非 Dev `world_headless_step` 原始返回泄漏 `canonicalState`/`canonicalEvents`，且 step 分包会提前 ACK 丢时长、stepCache 128 FIFO 淘汰后旧 request 可再推进、headless observation 未裁剪隐藏弹丸。
- **P3 实现继续冻结**（未达验收）。
- **C3-c 核心运行时/Dev harness 子项**（直接 core、真实地图敌人武器、snapshot/replay、真实 perf、确定性基线）**已通过**；但这些不能抵消 Player 权限阻断。
- **Signal 未实现**（`E_NOT_APPLICABLE`，未伪造），仍属整体任务未完成项。
- **真实 LLM 证据**：Lead 的 `reports/ai-native-02/lead-live/`（Rendered 单 drone）已由 Reviewer 确认可关 P2 最小 Agent 子项；本次 Headless MCP 最小遭遇**执行事实可保留**，但**权限未通过**，不代表完整 Run/P4 PASS。

## 二、硬阻断（必须修复）

### 阻断 1：非 Dev `world_headless_step` 原始结果泄漏 canonicalState/canonicalEvents
- 代码：`src/ai-native/worldHeadlessMcpTools.ts:239-240` 无条件
  ```ts
  canonicalState: record.world.canonicalState(),
  canonicalEvents: record.world.canonicalEvents(),
  ```
  加入 `step` 结果；`registerHeadlessWorldTools` 对非 Dev 使用同一 handler，无剥离。
- 独立 probe（`gate-probe-headless.log`，非 Dev `HeadlessWorldManager`）：`structuredContent` 含 `canonicalState`/`canonicalEvents`；`content[0].text` 同样含 `canonicalState` → **SDK/JSONL 都能拿到**。
- Lead 的 `lead-headless/tool-io.jsonl` 原始 `world_headless_step` 结果确实含 `canonicalState`（seed/rngState/mapHash/完整 player/projectiles/pendingCommands/purchaseTransactions）与 `canonicalEvents`（含 crit、隐藏 drone FSM、未感知位置）。
- Console 只做**终端显示裁剪**：`scripts/c3b-mcp-console.mts:150-151` 从 stdout 删除 `canonicalState/canonicalEvents`，但 `:61` 把**原始**结果（仅脱敏 token）写入 JSONL；SDK `structuredContent` 未裁剪。
- **证据缺口**：现有 `worldHeadlessMcpSmoke.mts` 19 项全 PASS 但**从未断言 canonical 不存在**（grep 0 次）→ 绿门漏检。
- 影响：Player 权限可读取 seed/RNG/完整地图标识/隐藏实体/隐藏事件，违反“Player 只获感知裁剪 Observation 与合法公开事件/receipt”。**P4 权限硬阻断。**

### 阻断 2：step 分包提前 ACK，丢弃动作剩余时长
- 代码：`worldHeadlessMcpTools.ts:188-217`：
  ```ts
  const span = Math.min(converted.ticks, boundedTicks - used); // step ticks 截断动作 duration
  ...
  applied.push({ ..., executedTicks: span, appliedTick: ... });
  ...
  this.gateway.ackAction({ result:'applied', appliedTick: a.appliedTick });
  ```
  当 `step(ticks=10)` 遇到 `fire ticks=120`：`span=10`，只跑 10 tick，随即把该 action **ACK 为 applied（executedTicks=10）** 并从 gateway pending 移除；剩余 110 tick **永久丢失**。
- 独立 probe（`gate-probe-headless.log`）：
  - `step10` → `applied[0].executedTicks=10`；
  - 再 `step110` → `applied` 为空（动作已不在队列），目标 drone **仍存活**（HP>0）；
  - 同一初始状态 `step120`（一次）→ drone **被击杀**、`status=cleared`。
  - 即：`10+110` 与 `120` 结果不同，分包丢时长。
- 这与 C3b 已建立的“durationTicks 跨 step/frame 真实消费”契约矛盾；MCP 测试只测单次 `step60/fire60`，未覆盖分包。
- **修复条件**：headless 动作应跨 step 维护 `remainingTicks`（类似 `ExternalLinkState.advanceExecution`），未耗尽前不得 ACK applied；`executedTicks` 应为累计真实 tick；ACK 只能在 duration 完整消费或明确取消/到期时发生。

### 阻断 3：stepCache 128 FIFO 淘汰后旧 requestId 可再次推进
- 代码：`HEADLESS_STEP_CACHE = 128`；`stepCache` + `stepOrder` FIFO，超过 128 `delete(oldest)`。
- 独立 probe：同一 session 用 requestId `R` step 一次（tick 前进），再发 128 个不同 requestId 的 step 把 `R` 淘汰；重放 `R`（同 payload）→ `replayed:false` 且 **tick 再次前进**（世界被再次推进）。
- 与 C3a/C2 “有界去重淘汰后可重放”同类问题再次出现；step 幂等性在 128 后失效。
- **修复条件**：达到上限时拒绝新 step（原子 `E_RESOURCE_LIMIT`）或保留不可重放墓碑/单调序号，不能淘汰后放行旧 request。

### 阻断 4：Headless observation 未裁剪隐藏弹丸
- 代码：`src/ai-native/worldHeadless.ts:318` `projectiles: s.projectiles.map(...)`，**没有** `isPerceivable` 过滤（drones/targets 已用 `perceived` 过滤）。
- 独立 probe：far/unperceivable 位置（(100.5,122.5)，`isPerceivable=false`）的 enemy projectile 仍出现在 `observation().projectiles`。
- 影响：Player 可看到未探索/墙后/远处弹丸，推断隐藏敌人；违反“隐藏弹丸”要求。**修复**：与 C3b `buildExternalObservation` 相同，用同一感知谓词过滤 projectiles，并补“远处/墙后弹丸不出现”的负向测试。

## 三、已通过 / 已闭环（非阻断）

| 项 | 结论 | 依据 |
|---|---|---|
| Headless 直接 core、非第二 World | PASS | `worldHeadless.ts` 仅 import `core/MapGenerator/config/worldObservation/worldPerception`，无 World/Phaser；`runSteps` 只调 `stepSimulationTicks` |
| 真实地图/敌人/武器 | PASS | 单测：真实生成地图/combat room/真实 drone/真实 pulse；真实 fire→hit→enemy-died→cleared、真实受伤、真实死亡 |
| 感知白名单（敌人/Boss/portal） | PASS（弹丸除外） | `buildWorldObservation` + `isPerceivable`；单测“observation is perception-cropped” |
| Rendered↔Headless 同路径 parity | PASS（8/8） | Playwright 导出真实 5 步 intent 序列 + 真实 drone，Node 用 `HeadlessWorld.fromSimulationState` 重放同一 core；state/events/finalTick/drones/projectiles 全一致；`real-combat-events` 含 `player-fired/drone-step` |
| Player create/step/action 权限（seed/actor/Dev） | 部分 PASS | 非 Dev create 拒绝 seed（`E_PERMISSION`）；Dev 工具 Player 全拒；stale epoch 拒绝；step 同 payload 幂等、异 payload `E_ID_PAYLOAD_MISMATCH`（但缓存淘汰破坏幂等，见阻断 3） |
| snapshot/restore/replay | PASS | 单测：snapshot 含 state/commands/RNG/ledger/map identity；restore bump epoch、拒绝 malformed；replay 同 canonical/events、`firstDivergence` 真实负向 |
| 批测确定性基线/真实 perf | PASS（Dev-only） | `dev_perf`：1000 ticks × 10 sessions 真实 combat，wall 7664ms、cpu 5953ms、heap ~47MB、events 30340、liveTicks 9200；`dev_batch/compare` 真实 kills/damage；`dev_batch_deterministic` hash；非空场景 |
| Task0 STOP 抢占/凭据/lease | PASS | `task0.test.ts` 9 项 + `c3c-bridge-reclaim.spec.ts` 2/2：STOP 抢占记录 executedTicks、无 active 不造假 receipt；token 从 globalThis 清理；lease 1000 周期有界、旧 lease 不复活；LOST 后新人类授权原子回收、live 连接不被静默替换（409） |
| Signal | 未实现（正确未伪造） | `signalCombatStatus()` 返回 `E_NOT_APPLICABLE / world.signal_combat_unsupported`；harness 明确“NOT Signal Combat” |

## 四、证据缺口

1. **parity 序列不含死亡/loot**：本次 rendered 导出 `dronesLeft=1`，eventTypes 仅 `player-moved/drone-step/player-fired/projectile-spawned/enemy-hit`（真实伤害，但无 `enemy-died`/loot）。Lead 要求“含真实伤害/死亡/loot”的 parity 未完全满足；死亡/受伤由 headless 单测覆盖，但**loot 既未在 parity、也未在 real-combat 单测断言**。建议 parity 增加击杀与 loot 的序列，单测断言 `loot-dropped`/`loot-collected`/currency/xp。
2. **smoke 漏检 canonical**：`worldHeadlessMcpSmoke.mts` 全绿但未检查 `canonicalState/canonicalEvents` 不存在；应增加非 Dev 原始 SDK 响应的负向断言（`structuredContent` + `content[].text` 均不含 canonical/seed/rng/map）。
3. **分包/cache 测试缺失**：现有 step 幂等测试只覆盖同 req 同 payload；未覆盖 `step10+step110` 与 128 淘汰重放。
4. **真实 LLM 证据范围**：Lead 的 headless 最小遭遇是“一次真实模型经 Player MCP 完成 fire→cleared”，不是完整 Run；且该次执行读取的是终端合法 observation（未用 canonical 选动作），但权限仍因原始结果泄漏而阻断。

## 五、C3c / P4 / Signal 判定

- **C3-c 核心运行时**：PASS（同核心、真实地图/敌人/武器、snapshot/replay、真实 perf）。
- **C3-c Player 权限面**：**FAIL**（阻断 1–4）。C3-c 不能整体 PASS。
- **P4 最低 harness（Dev）**：PASS（真实 batch/perf/确定性基线）。
- **P4 Player 权限**：**FAIL/BLOCKED**（canonical 泄漏）；**P4 不能 PASS**。
- **Signal**：未完成（明确 unsupported，未伪造）。
- **真实 LLM**：Rendered 最小 Agent 子项已由 Reviewer 确认；Headless 最小遭遇执行事实保留，但权限阻断，不能据此通过 P4。
- **建议**：继续冻结 P3 实现；先修阻断 1（非 Dev step 永不返回 canonical，且补 SDK 原始负向测试）、阻断 2（跨 step duration/ACK）、阻断 3（有界去重不淘汰放行）、阻断 4（projectile 感知裁剪），再补 parity 死亡/loot 与 smoke 断言。

## 六、工具验证日志（一行 PASS/FAIL + 命令 + 结果 + 路径）

| # | 命令 | 结果 | 路径 |
|---|---|---|---|
| 1 | `git archive 82734f6` + Python blob SHA1 全量比对 | **PASS** 1753/1753 | `reports/.../reviewer/c3c/`（本文） |
| 2 | `npm run typecheck` | **PASS** exit=0 | `gate-typecheck.log` |
| 3 | `npx vitest run worldHeadless\[.test\], worldHeadlessMcp, worldHeadlessHarness, task0` | **PASS** 37/37 | `gate-unit-c3c.log` |
| 4 | 独立 probe：非 Dev step 原始结果 | **FAIL（确认阻断）** canonicalState/canonicalEvents 泄漏 | `gate-probe-headless.log`、`probe-headless.mts` |
| 5 | 独立 probe：step10 + step110 vs step120 | **FAIL（确认阻断）** 提前 ACK、丢 110 tick、目标未死 | 同上 |
| 6 | 独立 probe：128 淘汰后旧 requestId | **FAIL（确认阻断）** replayed=false 且再次推进 | 同上 |
| 7 | 独立 probe：headless observation 隐藏弹丸 | **FAIL（确认阻断）** 远处不可感知弹丸仍出现 | `gate-probe-crop.log`、`probe-headless-crop.mts` |
| 8 | `npx playwright test c3c-headless-parity c3c-bridge-reclaim` | **PASS** 3/3 | `gate-e2e-c3c.log` |
| 9 | `npx vite-node scripts/c3c-rendered-headless-parity.mts` | **PASS** 8/8（但序列无 death/loot） | `gate-parity.log` |
| 10 | `npm run game:mcp:build` + `worldHeadlessMcpSmoke.mts` | **PASS** 19 项，但**未检查 canonical**（漏检） | `gate-mcp-build.log`、`gate-mcp-headless-smoke.log` |
| 11 | Lead 原始 `lead-headless/tool-io.jsonl` 检查 | **PASS（证据真实）**，step 返回含 canonical | `reports/ai-native-02/lead-headless/` |

> 失败关键错误：`world_headless_step` 非 Dev 结果含 `canonicalState`/`canonicalEvents`；`step10` 对 `fire120` 记 `executedTicks=10` 后 ACK applied；`stepCache` 128 FIFO 淘汰后旧 request 再推进；headless observation 未过滤 `s.projectiles`。

## 七、报告目录

`reports/ai-native-02/reviewer/c3c/`：`REVIEW.md`、`tree.ls`、`gate-typecheck.log`、`gate-unit-c3c.log`、`gate-probe-headless.log`、`gate-probe-crop.log`、`gate-e2e-c3c.log`、`gate-parity.log`、`gate-mcp-build.log`、`gate-mcp-headless-smoke.log`、`probe-headless.mts`、`probe-headless-crop.mts`、`pw-out-c3c/`。

未修改生产源码/已有测试/配置/分支；未合并/重置；未读取/恢复共享 WIP/stash；未把预写序列当作模型实跑。
