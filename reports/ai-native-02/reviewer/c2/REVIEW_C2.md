# AI-NATIVE-02 C2 独立验收（首片 SimulationState / 固定 tick / Node-Rendered parity）

- 复核对象：冻结提交 **`4cf1bc8b26a335661b36016a2ade5b23d87afc37`**（父 `ff13ce3b0309148ed0c3cf72bc662ffafb4b4fc7`，P1 收尾小补丁），15 文件。
- 冻结方式：`git -c core.autocrlf=false -c core.eol=lf archive 4cf1bc8 | tar -x -C D:/Project/lastsignal-c2-review-4cf1bc8` + `node_modules` junction；全库 tracked 文件 MD5 与 `git show 4cf1bc8:<path>` 逐字一致（`ALL_TRACKED_FILES_MATCH`，`gate-c2-git-state.log`）。
- 共享工作树：复核开始时 `HEAD=4cf1bc8`、仅 `?? reports/`；结束前已推进到 `c9ccce8…`（ahead 6）。**共享 WIP 一行未用于验收**；所有 gate 从冻结快照运行。未切共享分支、未改生产源码/测试/配置、未提交/合并；端口 5341/5343/5345 专用且已释放，未占用 5173/5199/5284。
- 报告/日志：`reports/ai-native-02/reviewer/c2/`。
- 红线：本地 controller ≠ 外部 Agent；Phaser/Playwright ≠ Headless World/Replay；夹具 drone/hunter/Boss 注入 ≠ 真实战斗通关；开发者自测 ≠ 独立验收。

---

## 0. 最终判定

**C2 阻断（不通过）**，不是“有条件 PASS”。

C2 的首片目标（`SimulationState` 单一权威、固定 60Hz、Node/Rendered parity）在**纯 core 规则**层面有大量通过项，但本提交存在**真实游戏回归与权威边界破坏**：

1. **B1（阻断）核心玩家弹丸无法伤害非 drone 敌人 / Boss**：正常 `World.stepFrame` 187 tick 后，drone `28→0`，hunter `61→61`、stalker `47→47`、Boss `2400→2400`。现有游戏仍会生成 hunter/stalker/sentinel 与 Boss；C2 没有限制只进 drone 房间，因此这是可直接游玩的回归。
2. **B2（阻断）`Boss.fireLaser` 通过兼容视图改写了权威 core 玩家弹丸**：`world.projectiles` getter 返回 `legacy + core`，`Boss.ts:119-122` 取最后一个并写 `proj.data.vel`；探针中 core 弹丸速度从 `(11.25,0)` 被改成 `(-0.6185,2.4223)`，Boss 自己的子弹反而未获得速度。
3. **B3（阻断）`World.projectiles` setter 直接清空 `sim.projectiles`**：兼容视图是写透的；探针 `core 1→0`。core/legacy 弹丸 id 还各自从 1 开始（探针两者 id 都是 1），兼容视图暴露的是可变 core 对象。
4. **B4（阻断）legacy `Player.hurt` 在 core tick/事件之外写 core player 状态**：`World.updateProjectiles:772`、`Boss.ts:93`、`Enemy.ts:229` 调用 `player.hurt`；探针直接改 `sim.player`：HP `100→90`、x `8→7.625`、invuln `0.3`，没有 `SimEvent`。这与“适配器只消费事件/唯一写源”的声称冲突。
5. **B5（阻断 parity 声称）官方 Node/Rendered parity 使用 test-only `stepSimulationTicksForTest`**：`World.ts:615-620` 是公开方法，绕过 `stepFrame`/accumulator/`updateLegacy`；探针在 `paused=true` 下仍把 core tick 从 `67→69`。它证明了 core 规则，不证明正常 World 执行路径；`c2-parity.spec.ts:137` 正是走这条路径。

因此：C2 不能作为合并候选；C1 已有的纯规则/部分固定 tick 成果保留，但 C2 必须先修 B1–B5（或由 Lead 明确缩减为“只允许 drone 房间且禁用/隐藏其他敌人”的实验沙箱，并重跑真实回归）。P1 三项收尾（文档、fixture/commit、flaky）在目标快照中**已关闭**，见 §3。

---

## 1. 独立 Gate（完整输出在 `reports/ai-native-02/reviewer/c2/`）

| 命令（冻结快照 cwd） | 结果 | 日志 |
| --- | --- | --- |
| `npm run typecheck` | **PASS** exit 0 | `gate-c2-typecheck.log` |
| `npm test` | **PASS** **21 files / 353 tests** | `gate-c2-unit.log` |
| `npm run build -- --outDir reviewer-dist` | **PASS** exit 0（既有 >500kB 警告） | `gate-c2-build.log` |
| `npx vite build --config vite.mcp.config.ts --outDir reviewer-mcp-dist` | **PASS** exit 0 | `gate-c2-mcp-build.log` |
| 冻结生产构建 + 5343：`PORT=5343 … npx playwright test tests/ai-native-world.spec.ts --workers=1` | **PASS** **9/9** | `gate-c2-playwright-p1.log` |
| 专属 dev 5341：`PORT=5341 … npx playwright test tests/c2-parity.spec.ts tests/checkpoint.spec.ts tests/audit.spec.ts --workers=1` | **PASS** **10/10**（C2 3 + 存档 5 + 旧回归 2） | `gate-c2-playwright-parity-regression.log` |
| `npx vite-node scripts/c2-node-parity.ts`（读取上述 parity 数据） | **PASS** **8/8 PARITY_PASS** | `gate-c2-node-parity.log` |
| P1 flaky 复验：`--grep "shared control path" --repeat-each=6`（冻结 5343） | **PASS** **6/6** | `gate-c2-repeat-control-flow.log` |
| 正常 `World.stepFrame` vs 直接 core 152 tick（自建探针） | **PASS** canonical 逐字相等，tick 218 / 218 | `gate-c2-stepframe-parity.log`、`probe-c2-stepframe-parity.mjs` |

说明：按「勿重复无关全量」未重跑 39 项全量 E2E；`boss-room.spec.ts`(5173)/`canvas.spec.ts`(5199) 硬编码端口未触碰。上述 gate 全部 PASS，**不代表 C2 通过**；下面 §4 的独立诊断探针是阻断依据。

---

## 2. 逐文件依据（15 文件）

| 文件 | 依据 | 结论 |
| --- | --- | --- |
| `src/world/sim/core.ts`（新增 558 行） | `:27-32` 60Hz/250ms/15 ticks；`:36-84` state 定义；`:114-145` 创建 state（`seed=map.seed`）；`:201-204` 每 tick 派生 RNG；`:224-241` player timers；`:243-290` 玩家开火；`:292-328` 玩家移动；`:330-385` drone；`:387-408` 玩家受伤；`:410-470` 弹丸（只检查 `state.drones`）；`:472-490` 整数 tick；`:519-542` canonical；`:544-557` 事件 1e-9 圆整 | core 纯 TS、固定 tick 成立；**B1/B4/B5 源头** |
| `src/world/sim/rules.ts` | `:306-309` `weaponCooldown`；`:321-338` `createEnemyProjectileData`；`:358-390` `resolvePlayerHit`；C1 的纯规则保留 | 纯函数正确；**与 `World.spawnEnemyProjectile` 重复**（H4） |
| `src/entities/Player.ts` | `:53-70` 所有 getter/setter 指向 `World.sim`；`:129-137` `syncVisual`；`:165-173` `reset`；`:208-216` `sampleIntent`；`:285-307` `hurt` 直接写 `sim.player` | 适配器**不是只读**：`hurt/reset` 仍写 core（B4） |
| `src/entities/Enemy.ts` | `:29-40` getter/setter；`:42-50` `attachSimDrone`；`:111-120` drone 直接 return；`:157` `legacyStateMachine`；`:222-235` legacy `doAttack` 调 `player.hurt` / `spawnEnemyProjectile`；`:240-258` `hit` 写 `_hp`/位置 | drone 单一 core；非 drone 仍 legacy 且能写 core player（B4） |
| `src/world/World.ts` | `:55-63` `projectiles` 合并 getter + 写透 setter；`:86-107` 创建 `sim`（seed=map.seed）；`:530-539` `spawnEnemyProjectile` 内联；`:592-610` `stepFrame`；`:615-620` `stepSimulationTicksForTest`；`:622-662` `applySimEvents`；`:694-709` `updateLegacy`；`:716-782` legacy 弹丸 + `player.hurt`；`:908-937` restore；`:889-905` capture | **B1/B2/B3/B4/B5 的集中点** |
| `src/entities/Boss.ts` | `:115-126` `fireLaser` 取 `world.projectiles[last]` 并写 `data.vel`；`:153-155` 仍 own armor | **B2 直接触发点**；Boss 未迁移 |
| `src/scenes/GameScene.ts` | `:359-368` 每帧 sampleIntent + `stepFrame`；`:510/527/564/578/611/616/657` `resetSimulationAccumulator()` | 固定 tick/暂停清累加器**通过** |
| `src/world/sim/core.test.ts`（155 行） | `:97-154` 4 例：整数 tick、真实地图移动、drone 击杀、clone 重放 | core Node 测试有效；**只覆盖 drone，不覆盖 legacy/Boss** |
| `src/world/sim/parity.test.ts`（211 行） | `:56-210` 独立 legacy 公式对照 damage/spec/projectile/swept/player hit/move/drone | 永久 parity **独立且可重复**；不覆盖 World 适配器/legacy 实体 |
| `src/world/sim/rewiring.test.ts`（90 行） | `:31-42` 声称 Player “only samples intents”；`:45-52` drone/legacy；`:54-65` World；`:67-73` GameScene | 静态门禁**不真实**：Player.hurt/reset 仍写 core（H5） |
| `tests/c2-parity.spec.ts`（195 行） | `:41-100` subframe/15 cap/pause；`:103-164` 用 `stepSimulationTicksForTest` 生成 parity；`:165-193` F-08 深拷贝 | 固定 tick/F-08 通过；**parity 走 test-only 路径（B5）** |
| `tests/ai-native-world.spec.ts` | P1 9 项；`:952-966` 感知夹具完整声明；bounded wait 在 `:317-383` | P1 三项收尾已修（§3） |
| `scripts/c2-node-parity.ts`（54 行） | `:12-26` 读硬编码 `reports/ai-native-02/c2/parity`；`:35-47` 8 检查 | Node 重放独立；路径未 env 化（H7） |
| `package.json` | 新增 `game:sim:parity` | 脚本可复现 |
| `docs/AI_NATIVE_PHASE_REPORTS.md` / `docs/AI_NATIVE_WORLD_CONTROL.md` | C2 段 `:174-185` / §6.5 `:196-203`；声称“唯一写源”“适配器只消费事件”“World.projectiles 只保留 legacy” | 边界声明部分过宽，见 §4/§6 |

---

## 3. P1 收尾三条件：**已关闭**
目标快照含父补丁 `ff13ce3`，逐项复核：
1. **文档一致**：`docs/AI_NATIVE_WORLD_CONTROL.md` 已无 `白名单观察/合法可见观察/只能看到当前房间` 旧串；唯一 `canWalk` 行 `:99` 已改为 `createLocalProbe(): ±1.5 tiles...不是全图 isWalkable oracle`。**PASS**。
2. **完整 fixture + commit 归属**：`docs/AI_NATIVE_PHASE_REPORTS.md:151-157` 表逐行标注 `2d78e80` / `1aadd2e` / 父提交；新增「开发者感知边界 E2E」行列出 `spawnEnemy`、`enteredRooms.add`、临时 `mid.type='wall'`、Boss/portal 坐标注入；`tests/ai-native-world.spec.ts:952-966` 有完整 `record('evidence-fixture', ...)`（含 `notFixtures`）。**PASS**。
3. **flaky 修法**：`tests/ai-native-world.spec.ts:317-383` 改为 `MIN_SAMPLES=10 / MAX_SAMPLES=40` 有界等待，要求 `motionValid` 且 `portalTransitions>0 || interactSamples>0`；断言仍是 `movingSamples>2` 但不再固定 14 帧。独立 `--repeat-each=6` **6/6 PASS**；P1 9/9 PASS。**PASS**。

注意：P1 flaky 修复只改善采样窗口，不等同于 C2 通过；P1 的 F-03/F-08（旧）/R-01 等仍有后续义务。

---

## 4. C2 关键问题（阻断）

### B1（阻断）核心玩家弹丸无法伤害 hunter/stalker/sentinel/Boss
- 位置：`core.ts:431-458` 只遍历 `state.drones`；`World.ts:694-709` `updateLegacy` 只处理非 drone 的 legacy FSM，**不处理 core 玩家弹丸与 legacy 敌人/Boss 的碰撞**；`World.ts:716-782` legacy 弹丸只处理 `legacyProjectiles`，而 C2 已删除 `World.spawnProjectile`，生产没有 legacy 玩家弹丸。
- 独立探针（正常 `World.stepFrame`，非 test-only）：`drone 28→0`，`hunter 61→61`，`stalker 47→47`，`Boss 2400→2400`；`coreProjectilesLeft=4`（弹丸未被消费）。见 `gate-c2-legacy-combat-probe.log`、`probe-c2-legacy-combat.mjs`。
- 影响：现有 `pickEnemyForRoom` 仍会生成 hunter/stalker/sentinel，Boss 房间仍可进入；玩家进入这些房间后无法造成伤害。C2 的“只承诺 start room + drone”不等于可以破坏其他房间；除非 Lead 明确接受“只允许 drone 房间”的沙箱并实际限制地图/房间，否则这是可玩的回归。
- 修复条件：把 core player 弹丸与**所有**现有敌人/Boss 的碰撞纳入同一权威提交（core 扩展为包含 legacy enemy 轻量状态，或由 adapter 将 core 弹丸命中 legacy 敌人作为受控事件/事务回写 core；不能双写）；补真实 hunter/stalker/sentinel/Boss 的命中/死亡测试（普通 `stepFrame` 路径）。

### B2（阻断）`Boss.fireLaser` 通过兼容视图改写 core 玩家弹丸
- 位置：`World.ts:55-63` getter `[...legacyProjectiles, ...coreProjectileViews.values()]`；`Boss.ts:115-126` `spawnEnemyProjectile` 后取 `world.projectiles[last]` 并写 `proj.data.vel`。当存在 core 玩家弹丸时，最后一个元素是 core `SimProjectile`（不是刚生成的 boss legacy 弹丸）。
- 独立探针：`compatibilityOrder.lastIsCore=true`；`Boss.fireLaser` 后 core 弹丸速度 `11.25,0 → -0.6185,2.4223`（`coreVelChanged=true`）；Boss 自己的弹丸速度为 0。见 `gate-c2-authority-probe.log`、`probe-c2-authority.mjs`。
- 影响：Boss 激光方向错误、玩家子弹被改向；直接改写 core 权威状态（不是只读兼容视图）。
- 修复条件：`Boss.fireLaser` 使用 `spawnEnemyProjectile` 的**返回值**（如 `shockwave`）；兼容 getter 不返回可变 core 对象；增加「玩家 core 弹丸存活时 Boss 激光仍正确」E2E。

### B3（阻断）`World.projectiles` setter 写透 core；ID 冲突
- 位置：`World.ts:58-63` setter 赋值 `legacyProjectiles` 后直接 `this.sim.projectiles = []`；getter 暴露 core `SimProjectile` 对象。`nextProjectileId` 与 legacy `projIdCounter` 各自从 1 开始（`core.ts:143`、`World.ts:75`、`:532`）。
- 独立探针：`w.projectiles=[]` 后 `sim.projectiles` `1→0`；同一场景 core/legacy id 都是 `1`；`lastDataKeys` 是 `SimProjectile`（无 `hitSet`）。见 `gate-c2-authority-probe.log`。
- 影响：旧测试/兼容代码可通过写 setter 清除权威弹丸，绕过 core 的 `SimEvent`/碰撞；兼容视图不是只读；ID 冲突使消费者无法用 id 区分。
- 修复条件：getter 返回只读副本（或仅 legacy 视图），写路径移入显式 test-only reset；core/legacy ID 统一分配；补「setter 不能清 core」「id 唯一」测试。

### B4（阻断）legacy `Player.hurt` 在 core tick/事件外写 core player 状态
- 位置：`Player.ts:285-307` 直接写 `this.data.hp`、`this.wx/wy`、`invuln/hurtTimer`（都指向 `sim.player`）；调用来源：`World.ts:771-772` legacy 敌方弹丸、`Boss.ts:93` Boss 近战、`Enemy.ts:229` 非 drone 近战。
- 独立探针：`Player.hurt(10,...)` 后 core 状态 HP `100→90`、x `8→7.625`、invuln `0.3`，**没有** `player-hurt` core 事件。见 `gate-c2-authority-probe.log`。
- 影响：C2 声称“适配器只消费事件/唯一写源”不成立；legacy 伤害可在 `stepFrame` 的 `updateLegacy` 阶段改写已提交 core 状态，Node/Rendered core parity 不会覆盖该变化；canonical 只抓最终 HP，不解释事件。
- 修复条件：legacy 伤害必须通过 core 的 `resolvePlayerHit`/事务并产生 `SimEvent`，或在 C2 阶段明确禁用 legacy 敌人伤害并记录；不得从 adapter 直接写 `sim.player`。补「legacy Boss/hunter 伤害 → core 事件/ canonical 一致」测试。

### B5（阻断 parity 声称）官方 Node/Rendered parity 走 `stepSimulationTicksForTest`
- 位置：`World.ts:615-620` 公开 `stepSimulationTicksForTest`：直接 `stepSimulationTicks` + `applySimEvents` + `syncCoreEntities(0)`，不经过 `stepFrame`/accumulator，不调用 `updateLegacy`；`tests/c2-parity.spec.ts:137` 使用它生成 Rendered canonical/events。它没有 dev/test 门禁，`window.__game` 暴露（F-03）。
- 独立探针：`GameScene.paused=true` 时调用 `stepSimulationTicksForTest(2, fire)`，core tick `67→69` 并产生 `player-fired/projectile-spawned`；即暂停/正常执行路径可被绕过。见 `gate-c2-authority-probe.log`。
- 补充：本 Reviewer 另用正常 `World.stepFrame`（每帧 1 tick）对同一 initial/sequence 跑 152 tick，与直接 core 的 canonical **逐字相等**（`stepFrameTick=218/coreTick=218/canonicalEqual=true`，`gate-c2-stepframe-parity.log`）。这说明 core 规则在正常 stepFrame 下也能一致，但**官方 parity 证据本身没有走该路径**；且 legacy/Boss 不在 parity 中。
- 修复条件：parity 必须驱动正常 `World.stepFrame`（控制固定 delta），或提供与 `stepFrame` 共用同一入口的测试 facade；`stepSimulationTicksForTest` 从生产 World 移出/严格 dev-gate；补「暂停不能通过 test helper 推进」「parity 覆盖 legacy 顺序」断言。

---

## 5. 高优先（非阻断，但 C3 前必须处理）

- **H1 canonical 完整性**：`canonicalSimulationState` 包含 materialized `speed/damage/crit/critDamage/pierce/armor/dashDuration/cooldownReduced/hpRegen/hp/maxHp/weapon state`，所以**当前已 materialize 的伤害/移动属性不会被 XP/upgrade 漏掉**（独立探针：只改 `upgrades` 数组/XP/level/dashCooldown 时 canonical 相等，改 `speed` 后 canonical 不等）。但 canonical **缺 `nextProjectileId`、`map.tiles`、`upgrades` 历史、XP/level/currency、`dashCooldown`**；探针显示 `nextProjectileId` 不同、地图 tile type 不同时 canonical 仍相等。若把 canonical 当全 run stateHash/Replay，会漏掉未来 ID/地图/升级差异。修复：补 `nextProjectileId`、地图稳定 hash/身份、所有会影响未来规则的字段；明确 XP/upgrade 只作 materialized 还是历史。`dashCooldown` 当前未被 Player 使用，但未来若启用必须纳入。
- **H2 per-tick RNG 是语义变化**：`stepSimulationTicks` 每 tick `new RNG(0); restore(deriveTickRngSeed(seed,tick))`（`core.ts:201-204,472-490`），`seed=map.seed`；与 C1/parent 的连续 `World.rng`（`map.seed*7919+1`）不是同一条 crit 序列。探针：先开火再采样与先不开火再采样，C2 的下一发 crit 相同（独立于历史），连续 RNG 的下一发不同（`continuousFirst=false, continuousSecond=true`）。这是**有意的确定性边界**，但必须明确“C2 不保持 C1 的 crit 序列”；若要求行为等价，需改为保存连续 RNG 快照或做分布/序列对照。
- **H3 restore 不是完整 core 恢复**：`World.restoreCheckpoint:908-937` 深拷贝 F-08 正确，但只重置 `sim.tick=0`、`sim.drones=[]`、`sim.projectiles=[]`；未恢复 core `rngState`/`sim.player` 的 `dashTimer/hurtTimer/aimYaw`，`sim.seed` 固定 map.seed。checkpoint 只保存 legacy `rngState`（`World.ts:902`）。安全房无敌人时影响有限，但不能称为完整 core restore。
- **H4 规则体仍有重复**：`World.spawnEnemyProjectile:530-539` 与 `createEnemyProjectileData`（`rules.ts:321-338`）公式重复；`Boss.hit:153-155` 仍 own armor；`Enemy.legacyStateMachine` 仍是非 drone FSM 副本。C2 报告已声明 legacy，但“单一实现”只对已迁移规则成立，C3 前需合并。
- **H5 静态 rewiring 门禁不真实**：`rewiring.test.ts:31-42` 断言 Player “only samples intents”，但 `Player.hurt/reset` 写 core；静态字符串不能证明“无写路径”。应加运行期断言：legacy 伤害只能经 core event/事务，`sim.player` 不能被 adapter 直接改。
- **H6 事件 1e-9 圆整**：`canonicalEventValue` 对所有事件数字 `toFixed(9)`；探针显示 `1e-10` 差异被抹平、`1e-8` 保留。`canonicalSimulationState` 未圆整，所以状态差异仍被抓；但事件-only 的 <1e-9 差异会被隐藏。当前 gameplay 数值远大于 1e-9，可接受，但要在文档中明确“仅 cosmetic，不用于 gameplay 断言”。
- **H7 test 隔离**：`tests/c2-parity.spec.ts:13` 与 `scripts/c2-node-parity.ts:12` 硬编码 `reports/ai-native-02/c2/parity`，没有 env 覆盖；独立运行会写快照路径，易与 developer 证据冲突。建议 `LS_C2_PARITY_DIR`。
- **H8 文档精度**：`AI_NATIVE_WORLD_CONTROL.md:197` 说“World 的 projectiles 只保留 legacy”，实际 getter 返回 legacy+core；`:200` 说“适配器只消费事件”，实际 `Player.hurt/reset`/`tryInteract`/`LevelUpScene` 可写 core。必须改为“已迁移 core 弹丸/玩家状态仍存在 adapter 写入口，C3 前收敛”。

---

## 6. 存档回归 / 固定 tick / debug

- **固定 tick**：`GameScene.ts:359-368` 每帧一次 `sampleIntent` + `stepFrame`；`SIM_TUNING` 60Hz/250ms/15 cap；暂停/升级/背包/死亡/新局/恢复均 `resetSimulationAccumulator`（`:510/527/564/578/611/616/657`）。C2 parity 3/3 覆盖 subframe/15 tick cap/pause freeze/no catch-up；**通过**。
- **存档**：`src/systems`/`config`/`types` 与父提交零 diff；`captureCheckpoint:889-905` 深拷贝；`restoreCheckpoint:908-937` 先 `cloneCheckpoint` 再赋值；F-08 负向 E2E 通过；`checkpoint.spec.ts` 5/5、`audit.spec.ts` 2/2。**PASS，但 H3 的 core tick/rng/timers 未持久化**。
- **debug 删除**：`git grep lastMoveStep/lastWeaponSpec/lastProjectileData/lastDroneStep/lastHitResult` 仅命中 `rewiring.test.ts` 的禁用断言，生产无消费者；**PASS**。但 `window.__game`（F-03）仍暴露 `sim`/`stepSimulationTicksForTest`。
- **Node 测试非自证**：`parity.test.ts` 用独立 legacy 公式对照纯规则（永久、可重复）；`core.test.ts` 用真实地图/WEAPONS/ENEMY_STATS/RNG；但只有 drone，没有 legacy/Boss，不能覆盖 B1/B4。`rewiring.test.ts` 是弱静态门禁（H5）。

---

## 7. 范围与 C3 前置

- C2 只迁移 start room + `drone` + `pulse` + player/drone 弹丸；Boss、其他 enemy kind、`Boss.hit`、`World.spawnEnemyProjectile`、loot/portal/升级/存档内容仍 legacy。**C2 不是完整 Core / Headless / Replay / 外部 Agent / Signal**。
- C3 前置（在 C2 修复后）：
  1. 先修 B1–B5；C2 不可作为合并候选。
  2. 统一 player/drone/legacy enemy/Boss 的弹丸碰撞与伤害事务；移除 adapter 直写 core。
  3. 统一 core/legacy projectile ID 与兼容视图只读；`Boss.fireLaser` 用返回值。
  4. parity 改为正常 `stepFrame` 路径；移除/严格 dev-gate `stepSimulationTicksForTest`。
  5. canonical 补 `nextProjectileId`/地图身份/影响未来规则的字段；明确 XP/upgrade 语义；决定 per-tick RNG 与 C1 行为差异是否接受。
  6. restore 持久化 core tick/rng/player timers，或明确 checkpoint 不覆盖 core。
  7. 再进入 C3：F-03 `window.__game` 收敛、正式 Gateway/MCP、Observation/Action V2、权限/断线/预算、真实外部 Agent；Signal 正式接入仍是总任务义务。
- 不得把本地 controller 当外部 Agent、浏览器自动化当 Headless、夹具 drone/hunter/Boss 当真实战斗；HUD/文档持续 `EXTERNAL NOT CONNECTED`。

---

## 8. 复现

```bash
cd D:/Project/LAST_SIGNAL
SNAP=/d/Project/lastsignal-c2-review-4cf1bc8
rm -rf "$SNAP" && mkdir -p "$SNAP"
git -c core.autocrlf=false -c core.eol=lf archive 4cf1bc8 | tar -x -C "$SNAP"
cmd //c "mklink /J D:\Project\lastsignal-c2-review-4cf1bc8\node_modules D:\Project\LAST_SIGNAL\node_modules"
cd "$SNAP"
npm run typecheck; npm test
npm run build -- --outDir reviewer-dist
node node_modules/vite/bin/vite.js preview --outDir reviewer-dist --port 5343 --strictPort
PORT=5343 LS_AI_EVIDENCE_DIR=<own>/evidence-p1 npx playwright test tests/ai-native-world.spec.ts --workers=1
node node_modules/vite/bin/vite.js --port 5341 --strictPort
PORT=5341 npx playwright test tests/c2-parity.spec.ts tests/checkpoint.spec.ts tests/audit.spec.ts --workers=1
npx vite-node scripts/c2-node-parity.ts
# 独立诊断（报告目录）
PORT=5345 node <own>/probe-c2-legacy-combat.mjs
PORT=5345 node <own>/probe-c2-authority.mjs
PORT=5345 node <own>/probe-c2-stepframe-parity.mjs
npx vite-node <own>/canonical-probe.ts   # 需按脚本注释放入快照或调整导入
```

---

## 9. 证据索引

- `gate-c2-typecheck.log`、`gate-c2-unit.log`、`gate-c2-build.log`、`gate-c2-mcp-build.log`
- `gate-c2-playwright-p1.log`（9/9）、`gate-c2-playwright-parity-regression.log`（10/10）、`gate-c2-node-parity.log`（8/8）、`gate-c2-repeat-control-flow.log`（6/6）
- `gate-c2-stepframe-parity.log`（正常 stepFrame canonical 相等）
- `gate-c2-canonical-probe.log`（canonical 遗漏/事件圆整/RNG 边界）
- `gate-c2-authority-probe.log`（B2/B3/B4/B5 硬证据）
- `gate-c2-legacy-combat-probe.log`（B1 硬证据）
- `gate-c2-git-state.log`（commit/parent/快照/最终共享状态）
- `parity/`（rendered initial/sequence/rendered JSON）
