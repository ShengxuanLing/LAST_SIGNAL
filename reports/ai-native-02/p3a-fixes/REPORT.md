# P3-a Reviewer 三缺口修复（分支 `feat/ai-native-world-integration`）

- 基线：P3-a `b3930c5`；P3-b 纯 Companion WIP `dd42239` 保留，**未混入本修复**，也未接 core/Signal/LLM。
- 独立验收参考：`reports/ai-native-02/reviewer/p3a/REVIEW.md`、`reports/ai-native-02/tester/p3a-final/P3A-FINAL-ACCEPTANCE.md`（Tester 已给 core drone+echo 13/13、360 tick、全 events 105KB 的真实跨端字节 parity）。
- 提交：`5537078`（纯 core/actor/投影/存档验证）、本提交（World/Enemy/Boss/Headless 接线与证据）。
- 未 merge/push/stash；`stash@{0}`/`stash@{1}` 原样。

## 1. Legacy 敌人合法选择/伤害 ECHO

- 新增纯模块 `src/world/actorTarget.ts`：`ActorTargetView`（只读）、`ActorCombatPort`（只读目标 + 合法伤害命令 facade）、`chooseNearestActor`（最近存活 actor，平局保留玩家）。
- `src/world/World.ts`：`enemyCombatPort(self)` 只把**该敌人可见**（同一 `gridLineOfSight` 12 格 + 已探索 + 墙遮挡）的 ECHO 列为候选；`hurtTarget` 对玩家走既有 `Player.hurt`（仍由 core 提交 pending hit），对 ECHO 走新 `echo-hit` 命令。**没有**把可写 Player/echo 对象交给敌人，也没有 legacy 直接写 core。
- `src/world/sim/core.ts`：`echo-hit` 在 `processCommands` 的同 tick 提交 `applyActorHit`（死亡后不再二次触发）；echo 事件带 `actorId`，echo 弹道带 `actorId`，`enemy-hit` 仅 echo 弹道附 `byActorId`（无 echo 时 canonical 字节不变）。
- `src/entities/Enemy.ts` / `Boss.ts`：`update(dt, ActorCombatPort)`；`data.targetId` 记录所选 actorId，`data.targetActorKind` 明确 `player|echo`（与 drone id 1 消歧）。hunter/stalker/sentinel/Boss 的近战、远程弹道、Boss 相位攻击都按所选 actor 计算。
- **复现 → 修复实证**：`tests/p3a-enemy-target.spec.ts` 在旧行为（强制只选玩家）下 FAIL（`logs/gap1-e2e-red.log`：`legacy enemy damaged the echo…`），恢复后 PASS（`logs/gap1-e2e.log`）。另有 hunter/stalker/sentinel/Boss 全种类真伤测试与“ECHO 死后重选主角”测试。

## 2. Headless `echoView` 漏 `sim.targets` / 单一共享投影

- 新增 `src/world/echoView.ts`：`buildEchoObservation()` 是**唯一**纯观察投影，以 ECHO 自己为中心，12 格 + 已探索 + LOS；同时返回 `drones` 与 `targets`（非 drone / Boss 的公共 `id/kind/x/y/hp/isBoss`），不回 seed/RNG/map/隐藏 target。
- `World.echoView()` 与 `HeadlessWorld.echoView()` 都调用它，不再各自维护一份漂移的投影；`EchoController` 的 aim/suggest 同时考虑 drones + targets；目标线也覆盖 targets。
- `src/ai-native/echoView.test.ts`（纯投影：Boss 公共状态、死亡/隐藏/墙遮挡过滤）、`src/ai-native/worldHeadlessEcho.test.ts`（Headless 真的看到 `sim.targets`）永久化了该缺口。
- **真实跨端 parity**：`tests/p3a-echo-parity.spec.ts` 从渲染 World 导出 initial frame + 逐 tick 的 player/echo 有序 intents + canonical/full events；`scripts/p3a-echo-rendered-parity.mts` 用同一 core 重放并**逐字节**比较（`P3A_ECHO_RENDERED_PARITY_PASS ticks=212 steps=208`），含 `echo-fired`/`echo-hurt`/`enemy-died`/`loot-dropped`/`loot-collected`/`byActorId`。
- **范围明示（Lead 裁定）**：严格跨端字节 parity 以已迁移的 core-managed actors 为主。该 parity 里的非 drone hunter 是**静态 core target**（legacy FSM 保持 idle、没有 AI 决策、没有可回放的 legacy 命令），legacy FSM/AI 决策**不在**该 parity 范围；没有忽略任何 `targets` 字段掩盖差异。Tester 报告的 tick58（11.0661 vs 11.1）属于 legacy adapter AI 决策，本轮不全面迁移敌人 FSM。Legacy 真实选/伤 ECHO 由上面的渲染 E2E 证明。

## 3. restore 清旧授权 / 独立 HP / 旧档兼容

- `EchoController.reset()`：follow、无 assist、无 suggestion、空 memory、neutral intent；`World.restoreCheckpoint()`、`World.reset()`、`echo-death` 均调用；模式切换继续撤销 assist。
- `restoreCheckpoint` 的 ECHO HP **逐值取自存档**（不免费回血）；旧档无 `echo` 字段仍能恢复，之后 `enableEcho()` 不会继承任何开火授权，必须人类重新确认。
- `src/systems/RunCheckpoint.ts` `validEchoActor()`：深验证 echo.data 全部数值字段有限且在 base-only 边界内（speed/armor/damage/crit/…）、`weaponKey=pulse` 且只有一把 pulse、`upgrades/abilities` 为空、HP 不越 maxHp；拒绝篡改 speed/armor 或注入免费技能（`runCheckpoint.test.ts`）。
- `tests/p3a-restore.spec.ts`：真 cleared-room checkpoint → restore → assist/mode/memory/intent 全清、echo HP=42 且玩家 HP=55 互相独立、可见 drone 也不会开火；旧档（删 `coreState.echo`）恢复后重新 enable 仍 `assist=false`；mode switch / reset 也清命令。

## 附带低成本残余

- **actorId 消歧**：echo 事件/弹道带 `actorId`，`enemy-hit` 用 `byActorId`，legacy FSM 用 `targetActorKind`；全部是增量字段，无 echo 的 C2/C3c canonical 不变。
- **frames 根 junction**：`worldHeadlessMcpTools.ts` 新增 `isSafeFramesRoot()`，`resolveFrameFile` 先 `lstat` 根必须是普通目录（与内部链接同一规则）；`c3cOwnerFile.test.ts` 用真实 junction 根验证拒绝。
- **命令仍全 core tick**：确认/存档没有强制 flush；没有共享 HP/能量/ledger。

## 门禁（`logs/gate.log` 等，每行 PASS/FAIL + 命令 + 结果 + 路径）

| 门 | 结果 |
| --- | --- |
| typecheck（含 scripts） | PASS |
| unit | PASS **627 tests / 48 files** |
| build / build:test / MCP build | PASS |
| Headless smoke / 20k stdio / Player crop 负向 / 控制台真实启动 | PASS |
| `P3A_ECHO_RENDERED_PARITY_PASS`（Node↔Rendered 字节） | PASS |
| `C3C_RENDERED_HEADLESS_PARITY_PASS` / C2 `PARITY_PASS checks=8` | PASS |
| P3-a + 五视口 HUD `ai-native-world.spec.ts` | **10/10 PASS** |
| P3-a 修复 E2E（legacy 全种类/Boss + restore） | **3/3 PASS** |
| C2 parity + C3-b external-link + C3-c headless parity | **19/19 PASS** |
| 旧行为复现（只选玩家） | `gap1-e2e-red.log` FAIL → 修复后 `gap1-e2e.log` PASS |

日志目录：`reports/ai-native-02/p3a-fixes/logs/`。渲染 parity 的 `initial/sequence/rendered.json` 由 spec 生成（大文件，已 gitignore，不入库）；可重跑 `PORT=<dev> npx playwright test tests/p3a-echo-parity.spec.ts` 再 `npx vite-node scripts/p3a-echo-rendered-parity.mts`。

## 未完成边界（诚实）

- 本轮没有迁移 legacy 敌人 FSM 到 fixed-tick core；其跨端严格字节 parity 不在承诺内（Lead 已按 Tester 实证缩范围）。
- 没有实现 LLM Companion / Signal / energy；`companionFacet.ts` 只是纯 WIP 模块，没有 wire 到 gateway/UI/MCP，也没有 Owner confirm 接线。
- 真实模型逐轮建议仍由 Lead 后续经正式工具执行；本轮 Owner 确认是游戏内真实 UI/测试夹具，报告不冒充 LLM。
- P3-b/Signal 的 A/B/C 实施待本修复独立复核通过后再继续。
