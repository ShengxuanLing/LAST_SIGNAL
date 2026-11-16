# AI-NATIVE-02 C2 阻断修复独立验收（a8232c8）

- 复核对象：**`a8232c8772024a40ac2efe46aa616e31aa88bdec`**（父 `c9ccce82620c4fa5d10303097f794d557f8d9c15`，C3-a），16 文件补丁；对照 `reports/ai-native-02/reviewer/c2/REVIEW_C2.md` 的 B1–B5/H1–H8 逐项复验。
- 冻结方式：`git -c core.autocrlf=false -c core.eol=lf archive a8232c8 | tar -x -C D:/Project/lastsignal-c2fix-review-a8232c8` + `node_modules` junction；全库 tracked 文件 MD5 与 `git show a8232c8:<path>` 逐字一致（`ALL_TRACKED_FILES_MATCH`，`gate-c2fix-git-state.log`）。
- 共享工作树：复核开始 `HEAD=a8232c8`、仅 `?? reports/`；结束时已推进到 `0ac1814…`（ahead 8），并有 **`stash@{0}: C3-b prep WIP paused for C2 fixes`**。**共享 HEAD/WIP/stash 均未用于验收，未 restore/read stash**；所有 gate 从冻结快照运行。未切共享分支、未提交/合并、未改生产源码/测试/配置。
- 独立端口：5351/5353/5355；跑完已释放，未占用 5173/5199/5284。
- 报告/日志：`reports/ai-native-02/reviewer/c2-fixes/`。
- 红线：本地 controller ≠ 外部 Agent；Phaser/Playwright ≠ Headless；夹具注入 ≠ 真实战斗/真人验收；开发者 377/41 自测 ≠ 独立验收。

---

## 0. 最终判定

**C2 修复仍阻断（不通过）**。B1/B2/B3/B5 已关闭，但 B4 只部分关闭，并新增/暴露了 canonical parity、target 权威、C1 RNG 顺序、Boss 命中盒等阻断/高优先问题。不能给 PASS。

已关闭：
- **B1 关闭**：正常 `stepFrame` 下 hunter/stalker/sentinel/Boss 均被 core 弹丸伤害/击杀（独立探针 20→0/0/0，Boss 死亡）。
- **B2 关闭**：`Boss.fireLaser` 不再改写 player 弹丸；独立探针 `beforeVel=afterVel=(11.25,0)`，激光生成 3 个自有移动弹丸。
- **B3 关闭**：`World.projectiles` 返回 core 副本，setter no-op，ID 唯一；独立探针 `viewIsCore=false`、`coreAfterSetter` 不变、`idsUnique=true`，嵌套 `pos/vel/hitIds/hitSet` 改动不影响 core。
- **B5 关闭**：`stepSimulationTicksForTest` 在 production 抛 `Error: dev/test only`；官方 c2-parity 改用 `stepFrame` 累加器；暂停 freeze 5/5。
- **H1 大部分关闭**：canonical 含 `mapHash`/完整 `player.data`/timers/`targets`/`pendingPlayerHits`/`nextProjectileId`；事件不再 1e-9 圆整，只排除 `drone-step.faceAngle`（独立 Node probe 全 PASS）。
- **H3 关闭**：checkpoint `coreState` 恢复 tick/rng/nextProjectileId；旧存档无 `coreState` 仍可恢复；`coreState` 结构校验存在。
- **H4 关闭**：`World.spawnEnemyProjectile`/Boss/Enemy 都走 core `createEnemyProjectileData`/`spawnCoreEnemyProjectile`；旧内联构造已删。
- **H6 关闭**：事件不再圆整；`1e-10` 差异保留。
- **P1 / 存档不回归**：P1 9/9、P1 flaky 6/6、checkpoint 5/5、audit 2/2、runtime/whale/gameplay 4/4；旧存档无 coreState 恢复 PASS。

仍阻断/未关闭（详见 §4）：
1. **B4 部分关闭**：队列不即时写 core、下一 tick 提交是对的；但一次队列里两次致命 hit 会发出 **2 个 `player-death` + 2 个 `player-hurt`（其中 1 个 blocked）**，`applySimEvents` 对 blocked `player-hurt` 仍播放受伤音效/震屏。幽灵事件/重复死亡。
2. **B6 canonical / Node-Rendered parity 在真实击杀后不成立**：`World.applySimEvents` 的 `killEnemy` 走 legacy `player.addXp`/currency/loot（并可触发升级），而 Node core 只发 `enemy-died`；canonical 现在含完整 `player.data`，独立探针在击杀死 drone 后 **rendered canonical ≠ core canonical**（rendered XP 8 / currency 4，core 0/0）。官方 parity 序列没有击杀，所以 8/8 是“无击杀样本”的绿色。
3. **B7 target 权威仍非单写**：`registerTarget` 不复制对象，`attachSimTarget` 把初始 HP/位置写入同一 target；之后 `Enemy.wx/wy`、`Boss.wx/wy` 的 legacy FSM 每帧写 target 位置；`Enemy.hit`/`Boss.hit` 仍存在并写 target HP；`Enemy.update` 还用 stale `__hp` 判断存活。HP/位置的“来源”是同一对象，但不是唯一 writer。
4. **B8 Boss 命中盒回归**：父 C2 `World.ts:760` 用 `boss.getRadius() + 1`（4.0）；修复提交 `World.ts:544` 把 `radius: this.boss.getRadius()`（3.0）写入 target，`stepProjectiles` 用 target.radius → Boss 命中盒缩小 1 tile，行为不等价。
5. **H2 连续 RNG 与 C1 顺序不等价**：core 现在连续 `RNG(seed*7919+1)`，但与 legacy `World.rng` 是**两条流**；C1 的 `World.rng` 同时消费 crit 与 kill loot。独立探针：C1 在 loot 后下一发 crit 与 C2 core 不同（c1Shot2=false, c2Shot2=true）。开发者“crit 序列不变”只在不发生 legacy RNG 消费时成立。
6. **H5/H8/H9/H10 文档与测试边界**：`rewiring.test` 仍声称 Player 只采样意图，但 `Player.reset`/`LevelUpScene`/`tryInteract` 仍可写 core；阶段报告 `AI_NATIVE_PHASE_REPORTS.md:177-183` 仍残留“projectiles 只 legacy / per-tick RNG / stepSimulationTicksForTest parity / 353/39”旧口径；`World.resetProjectilesForTest` 公开无 dev gate；非 Boss target 的 `enemy-hit` 没有写 `enemy.data.hitFlash`（视觉不闪）；旧 `tests/audit` 仍用 no-op `w.projectiles=[]` 清理（核心弹丸不清）。

---

## 1. 独立 Gate（完整输出 `reports/ai-native-02/reviewer/c2-fixes/`）

| 命令（冻结快照 cwd） | 结果 | 日志 |
| --- | --- | --- |
| `npm run typecheck` | **PASS** exit 0 | `gate-c2fix-typecheck.log` |
| `npm test` | **PASS** **24 files / 377 tests** | `gate-c2fix-unit.log` |
| `npm run build -- --outDir reviewer-dist` | **PASS** exit 0（既有 >500kB 警告） | `gate-c2fix-build.log` |
| `npx vite build --config vite.mcp.config.ts --outDir reviewer-mcp-dist` | **PASS** exit 0 | `gate-c2fix-mcp-build.log` |
| 冻结生产 5353：`PORT=5353 … npx playwright test tests/ai-native-world.spec.ts --workers=1` | **PASS** **9/9** | `gate-c2fix-playwright-p1.log` |
| 专属 dev 5351：`PORT=5351 … npx playwright test tests/c2-parity.spec.ts tests/checkpoint.spec.ts tests/audit.spec.ts --workers=1` | **PASS** **12/12**（C2 5 + 存档 5 + 旧回归 2） | `gate-c2fix-playwright-parity-regression.log` |
| `npx vite-node scripts/c2-node-parity.ts` | **PASS** **8/8 PARITY_PASS** | `gate-c2fix-node-parity.log` |
| 专属 dev 5351：`runtime-bugs`/`whale-character`/`gameplay` | **PASS** **4/4** | `gate-c2fix-playwright-runtime.log` |
| P1 flaky：`--grep "shared control path" --repeat-each=6`（冻结 5353） | **PASS** **6/6** | `gate-c2fix-repeat-p1.log` |
| 独立 canonical/RNG/target/checkpoint Node 探针 | **PASS** 13 checks / 0 failures（但发现 H2 语义差异） | `gate-c2fix-canonical-rng-probe.log` |
| 独立浏览器 B1–B4 / 权威 / 只读 / target / helper 探针 | **执行 PASS**，发现 B4 重复死亡（见下） | `gate-c2fix-browser-probe.log` |
| 独立 checkpoint coreState/旧档探针 | **PASS** | `gate-c2fix-checkpoint-probe.log` |
| 独立“真实击杀后 canonical parity”探针 | **FAIL 诊断**：`equal=false`，rendered XP/currency 8/4 vs core 0/0 | `gate-c2fix-parity-kill-probe.log` |

说明：未重跑 41 项全量；`boss-room.spec.ts`(5173)/`canvas.spec.ts`(5199) 硬编码端口未触碰。Gate 全绿不代表 C2 通过；上面的诊断探针是阻断依据。

---

## 2. 逐项复验 B1–B5

### B1 非 drone/Boss 命中 — **关闭**
- 实现：`core.ts:519-563` targets 循环；`World.spawnEnemy:526-530`/`spawnBoss:541-546` registerTarget/attach；`resolveBossHit`（`rules.ts:338-343`）。
- 独立正常 `stepFrame` 探针：hunter/stalker/sentinel 20→0 全部移除，Boss 死亡；`gate-c2fix-browser-probe.log`。
- 备注：Boss 命中盒半径回归见 B8。

### B2 Boss 激光串扰 — **关闭**
- 实现：`Boss.ts:143-158` 用 `spawnEnemyProjectile` 返回值，不再读 `world.projectiles`；`World.spawnEnemyProjectile:551-556` 走 core。
- 独立探针：player core 弹丸 `(11.25,0)` 前后不变，Boss 生成 3 个自有移动弹丸；`gate-c2fix-browser-probe.log`。

### B3 兼容视图 / setter / ID — **关闭**
- 实现：`World.ts:55-66` getter 返回 core 副本（`pos/vel/hitIds/hitSet` 均复制），setter no-op；`resetProjectilesForTest:69-73`；`core.ts:163/201` 统一 `nextProjectileId`。
- 独立探针：`viewIsCore=false`、setter 后 core 数量不变、ids `[18,22,23,24]` 唯一、嵌套修改不影响 core；`gate-c2fix-browser-probe.log`。
- **遗留**：`resetProjectilesForTest` 仍公开无 dev gate；旧 `tests/audit` 的 `w.projectiles=[]` 现在 no-op，清理不生效（H9）。

### B4 legacy `Player.hurt` 队列/事件 — **部分关闭**
- 实现：`Player.ts:285-291` 只 `world.enqueuePlayerHit`；`World.ts:630-633`；`core.ts:340-350` 下一 tick `applyPendingPlayerHits`。
- 独立探针：`hpAfterCall=100`（不直写）、`pending=1`、下一 tick `90`；invuln 时 `hurt` 返回 false、不排队；**通过基础队列**。
- **未关闭**：两次致命 hit 在同一队列：`q1=true,q2=true,pendingDeath=2,deathCount=2,hurtCount=2,blockedHurt=1`。`applyCorePlayerHit`（`core.ts:443-464`）对 blocked hit 也 push `player-hurt`，对 hp<=0 再 push `player-death`；`World.applySimEvents:685-692` 对 blocked `player-hurt` 仍 `audio.hurt()`/`addShake(6)`，`player-death` 会调用 `onPlayerDeath` 两次（GameScene guard 只防重复结算，不防重复事件/反馈）。修复：队列在首次死亡/blocked 后停止；`applyCorePlayerHit` 只有非 blocked 才发 `player-hurt`，只有实际 hp 从 >0 到 <=0 才发 `player-death`；`applySimEvents` 只对未 blocked 事件做反馈；加「同帧双致命 hit」测试。
- **备注**：`Player.hurt` 的返回值现在表示“排队成功”，不是“已造成伤害”；q2=true 与旧语义不同，需在接口注释/测试中明确。

### B5 step helper / parity 路径 — **关闭**
- `World.ts:639-646` 用 `import.meta.env`：production 探针得到 `Error: dev/test only`；`c2-parity.spec.ts:129-142` 改用 `stepFrame` + accumulator；暂停 freeze/15 cap 5/5；node parity 8/8。
- **遗留**：`stepSimulationTicksForTest` 在 dev 仍可推进 paused core（仅诊断用）；`resetProjectilesForTest` 未 gate。

---

## 3. H1–H8 复验

| 项 | 结论 | 证据 |
| --- | --- | --- |
| H1 canonical map/targets/timers/pending/nextId | **大部分关闭** | Node probe：`mapHash`/`targets`/`pendingPlayerHits`/`nextProjectileId`/timers/full player.data 均在；但真实击杀后 canonical 与 Node core 不一致（B6） |
| H2 连续 RNG / C1 顺序 | **未关闭（语义差异）** | core 连续 `RNG(seed*7919+1)`（`core.ts:130-145,566-583`）；独立 probe：C1 的 `World.rng` 在 loot 后与 C2 core 下一发 crit 不同（c1Shot2=false/c2Shot2=true）。core 与 legacy World.rng 是两条流；开发者“crit 序列不变”不成立 |
| H3 checkpoint coreState/旧档 | **关闭** | `RunCheckpoint.ts:28-38,67-72`；独立探针 tick 107/rng/pid 前后一致；旧档无 coreState `ok=true,tick=0,oldRng=expectedOldRng`；坏 timer NaN 被拒 |
| H4 重复 enemy projectile | **关闭** | `World.ts:551-556` 走 core `spawnEnemyProjectile`；`rules.ts:321-338` 单实现；Boss/Enemy 使用返回值 |
| H5 静态接线门禁 | **部分关闭** | `rewiring.test.ts` 改为检查 `enqueuePlayerHit`，但 `Player.reset`/`tryInteract`/`LevelUpScene` 仍可写 core；仍不是严格单写 |
| H6 1e-9 事件圆整 | **关闭** | `core.ts:638-643` 不再圆整，仅排除 `faceAngle`；独立 probe `1e-10` 差异保留 |
| H7 parity 路径 / helper gate | **关闭** | c2-parity 5/5 走 `stepFrame`；production helper throws；`resetProjectilesForTest` 另见 H9 |
| H8 文档/范围 | **未关闭（文档陈旧）** | `AI_NATIVE_PHASE_REPORTS.md:177` 仍“projectiles 只 legacy”、`:179` 仍 per-tick RNG、`:181` 仍 `stepSimulationTicksForTest` parity、`:183` 仍 353/39；与目标 377/41、连续 RNG、stepFrame parity 矛盾。`AI_NATIVE_WORLD_CONTROL.md:197` “唯一写源”仍忽略 adapter 写 core 的 `Player.reset/tryInteract/LevelUpScene` |

---

## 4. 阻断/高优先问题（具体行与修复条件）

### B4（阻断/未关闭）队列双致命 hit 产生重复 death/blocked hurt
- 行：`core.ts:340-350` `applyPendingPlayerHits` 无死/阻塞短路；`:443-464` 总是 push `player-hurt`，hp<=0 再 push `player-death`；`World.ts:685-692` 不检查 `hit.blocked`。
- 证据：`gate-c2fix-browser-probe.log` → `q1=true,q2=true,pendingDeath=2,deathCount=2,hurtCount=2,blockedHurt=1`。
- 影响：一个 tick 内两次 legacy 命中（多敌人同帧）会产生重复死亡事件/受伤音效/震屏；事件顺序/Node parity 失真。
- 修复：`applyPendingPlayerHits` 在 `p.data.hp<=0` 后 break；`applyCorePlayerHit` 仅在 `!hit.blocked` 时 push `player-hurt`（或分开 `player-hurt-blocked` 且 adapter 不反馈），仅在实际由 >0 到 <=0 时 push `player-death`；`applySimEvents` 只对非 blocked 反馈；加同帧双致命测试。

### B6（阻断）真实击杀后 Rendered canonical ≠ Node/core canonical
- 行：`World.ts:800-810` `killEnemy` 走 legacy `this.rng`/`player.addXp`/currency；`core.ts:612-633` canonical 含完整 `player.data`；`core.ts:519-559` core 只发 `enemy-died`，不发 XP/currency。
- 证据：`gate-c2fix-parity-kill-probe.log` → `equal:false`，`renderedXp=8/renderedCurrency=4`，`coreXp=0/coreCurrency=0`；official c2-parity 序列没有击杀，所以 8/8 未覆盖真实击杀。
- 影响：Node/Rendered parity 只在无击杀样本成立；任何击杀/掉落/升级都会破坏 canonical；不能作为“真实相同规则”的验收。
- 修复：把 XP/currency/level/loot 产生的玩家状态纳入 core 事务（core 发事件/提交），或 canonical 明确区分 core-owned 与 adapter-owned 并用两段对比；补「击杀/掉落/升级后 Node vs Rendered canonical」测试。

### B7（阻断/高优先）`registerTarget` 不复制且 target 位置由 legacy FSM 写
- 行：`core.ts:177-179` `registerTarget` 直接 push；`World.ts:526-530/541-546` 创建 target；`Enemy.ts:53-58`/`Boss.ts:67-72` `attachSimTarget` 把 `_wx/_wy/__hp` 写入 target；`Enemy.ts:32-40`/`Boss.ts:31-36` getter 指 target；`Enemy.ts:119-128` legacy `update` 用 stale `__hp` 判断存活；`Enemy.ts:248-266`/`Boss.ts:185-201` `hit` 仍写 target；`World.ts:730-743` `updateLegacy` 每帧让 Enemy/Boss 写 target 位置。
- 证据：Node probe `registerTarget` 返回/存储同一对象；浏览器 probe `targetLinked=true`，`targetEnemy._hp=7` 后 target.hp=7，`target.hp=9` 后 enemy._hp=9。**HP/位置不是单一 writer**；`__hp`/legacy `hit` 是潜在双写。
- 影响：target 的 HP/位置既被 core 弹丸命中写，又被 legacy FSM/旧 hit 写；`canonical` 的 target 状态会随 adapter 更新，Node core 不会。与“target 状态唯一权威”冲突。
- 修复：明确 target 字段所有权；legacy FSM 只读/提交移动事件，不直接写 target；删除/封禁 `Enemy.hit`/`Boss.hit` 的 target 写路径，或将其改为 `enqueue` 核心事务；`Enemy.update` 用 target.hp 而不是 `__hp`；补「target HP/位置只有一个 writer」测试。

### B8（高优先/行为回归）Boss 命中盒 4.0 → 3.0
- 行：父 `c9ccce8:World.ts:760` `boss.getRadius() + 1`；修复 `World.ts:544` `radius: this.boss.getRadius()`；`core.ts:519-559` 使用 `target.radius`。
- 影响：Boss 被弹丸命中范围缩小 1 tile；B1 的 Boss 死亡测试在近距离仍通过，但实际战斗 DPS/命中行为不等价。
- 修复：target radius 使用 `boss.getRadius() + 1`（或与旧 `World.updateProjectiles` 同一常量），加 3.5/4.1 tile 边界命中测试。

### H2（高优先/未关闭）C1 RNG 顺序不等价
- 行：`core.ts:130-145` core `RNG(seed*7919+1)` 独立；`World.ts:99` legacy `this.rng` 同 seed 但独立；`World.killEnemy:805-806` 的 loot RNG 仍走 `this.rng`。
- 证据：`gate-c2fix-canonical-rng-probe.log` → C1 在两次 loot float 后下一发 crit=false，C2 core 下一发 crit=true（`c1Shot2=false, c2Shot2=true`）。
- 影响：C2 不是 C1 的 crit 序列等价实现；只保证“core 内部确定性”。如果 Lead 要行为等价，这是阻断；如果接受分离 RNG，必须改文档/验收口径，不得声称“crit 序列不变”。
- 修复：若要 C1 顺序，core 与 legacy 共享同一 RNG 或记录 C1 消费点；若分离，文档明确“C2 crit 序列与 C1 不同”，加分布/序列对照而非等价断言。

### H8（高优先/文档）阶段报告与文档陈旧
- `AI_NATIVE_PHASE_REPORTS.md:177` “World 的 projectiles 仅保留 legacy”与 `World.ts:55-66` 只返回 core 矛盾；`:179` “per-tick RNG”与 `core.ts:566-583` 连续 RNG 矛盾；`:181` “stepSimulationTicksForTest parity”与 `c2-parity.spec.ts:129-142` stepFrame 矛盾；`:183` “353/39/8”与目标 377/41/8 不一致。
- `AI_NATIVE_WORLD_CONTROL.md:197` “唯一写源”忽略 `Player.reset`/`tryInteract`/`LevelUpScene` 仍写 core；`:200` “适配器只消费事件”不成立（`Player.hurt` 入队虽不直写，但 reset/interact/升级仍会写）。
- 修复：更新阶段报告与实际门禁、RNG、projectiles、target 权威；不要把 377/41 写成 353/39；明确 C2 core 与 legacy adapter 的边界。

### H9/H10（高优先/测试与视觉）
- `World.resetProjectilesForTest:69-73` 公开无 dev gate；`tests/audit.spec.ts:176/209/235/648` 仍用 no-op `w.projectiles=[]` 清理，核心弹丸不会被清；测试隔离可能在旧回归中造成串扰（当前 12/12 通过，但清理语义不实）。
- `World.applySimEvents:662-674` 非 Boss `enemy-hit` 不写 `enemy.data.hitFlash`/不 `project()`，旧 `Enemy.hit` 会写入 `hitFlash=0.15` 并 `project()`；非 Boss 命中视觉反馈丢失。修复：`applySimEvents` 写入 `hitFlash` 并 `project()`，加视觉/状态测试。

---

## 5. P1 / 存档 / 首片范围与 C3 前置

- P1 三条件：**关闭**。文档旧串已删；F-07 表有 `2d78e80`/`1aadd2e` 与感知夹具行；E2E `record('evidence-fixture')` 完整；bounded wait 20–80 样本；P1 9/9 + repeat 6/6。
- 存档：旧档无 coreState 仍兼容；新 coreState 恢复 tick/rng/nextId/timers；`cloneCheckpoint` 深拷贝；checkpoint 5/5 + audit 2/2。**但 coreState 校验只 `Number.isFinite`，负 timer/aim 等未做范围校验**（低）。
- 首片范围仍：start room + drone + pulse + 现扩大的 targets 碰撞；Boss/其他 FSM、loot/portal/升级/存档内容仍 legacy；C2 不宣称全 run Replay/Headless/外部 Agent/Signal。
- C3 前置**未解除**：先修 B4/B6/B7/B8/H2/H8/H9/H10（至少 B4/B6/B7/B8/H2），再进入 C3 的 Gateway/MCP、F-03 `__game` 收敛、Observation/Action V2、权限/断线/预算、Signal；C3 外部 Agent 仍是 P2 完成条件。不得把 8/8 parity（无击杀样本）当全 run parity，也不得把本地 controller/浏览器自动化/夹具战斗当真实 Agent/Headless/真人验收。

---

## 6. 复现

```bash
cd D:/Project/LAST_SIGNAL
SNAP=/d/Project/lastsignal-c2fix-review-a8232c8
rm -rf "$SNAP" && mkdir -p "$SNAP"
git -c core.autocrlf=false -c core.eol=lf archive a8232c8 | tar -x -C "$SNAP"
cmd //c "mklink /J D:\Project\lastsignal-c2fix-review-a8232c8\node_modules D:\Project\LAST_SIGNAL\node_modules"
cd "$SNAP"
npm run typecheck; npm test
npm run build -- --outDir reviewer-dist
node node_modules/vite/bin/vite.js preview --outDir reviewer-dist --port 5353 --strictPort
PORT=5353 LS_AI_EVIDENCE_DIR=<own>/evidence-p1 npx playwright test tests/ai-native-world.spec.ts --workers=1
node node_modules/vite/bin/vite.js --port 5351 --strictPort
PORT=5351 npx playwright test tests/c2-parity.spec.ts tests/checkpoint.spec.ts tests/audit.spec.ts --workers=1
npx vite-node scripts/c2-node-parity.ts
# 独立诊断（报告目录）
PORT=5355 node <own>/probe-c2fix-browser.mjs
PORT=5351 node <own>/probe-c2fix-checkpoint.mjs
PORT=5351 node <own>/probe-c2fix-parity-kill.mjs
npx vite-node <own>/canonical-rng-probe.ts   # 需放入快照/调整路径
```

## 7. 证据索引

`gate-c2fix-{typecheck,unit,build,mcp-build,playwright-p1,playwright-parity-regression,node-parity,playwright-runtime,repeat-p1,canonical-rng-probe,browser-probe,checkpoint-probe,parity-kill-probe,git-state}.log`；`probe-c2fix-{browser,checkpoint,parity-kill}.mjs`；`canonical-rng-probe.ts`；`parity/`。
