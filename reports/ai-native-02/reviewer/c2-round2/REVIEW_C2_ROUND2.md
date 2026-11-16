# AI-NATIVE-02 C2 第二轮事务修复独立验收（0df1514）

- 复核对象：**`0df1514103f796c361fe1a1bf1985e6c2205f1a1`**（父 `a53bfa7036b2f491e354565f53ffcb8e36c40318`），17 文件；对照 `reports/ai-native-02/reviewer/c2-fixes/REVIEW_C2_FIXES.md` 的 B4/B6/B7/B8/H2/H5/H8/H9/H10 与旧主 World 回归。
- 冻结方式：`git -c core.autocrlf=false -c core.eol=lf archive 0df1514 | tar -x -C D:/Project/lastsignal-c2round2-review-0df1514` + `node_modules` junction；全库 tracked 文件 MD5 与 `git show 0df1514:<path>` 逐字一致（`ALL_TRACKED_FILES_MATCH`，`gate-round2-git-state.log`）。
- 共享工作树：开始 `HEAD=0df1514`、仅 `?? reports/`；复核中未读共享 WIP；**`stash@{0}`（C3a extra quota tests）与 `stash@{1}`（C3-b prep WIP）均未 restore/read**（`gate-round2-git-state.log`）。未切共享分支、未提交/合并、未改生产源码/测试/配置。
- 独立端口：5357/5359/5361，已释放；未占用 5173/5199/5284；未强杀无关进程。
- 报告/日志：`reports/ai-native-02/reviewer/c2-round2/`。
- 红线：本地 controller ≠ 外部 Agent；Phaser/Playwright ≠ Headless；夹具战斗 ≠ 真实战斗；开发者 396/44 自测 ≠ 独立验收。

---

## 0. 最终判定

**C2 第二轮修复仍阻断（不通过）**。不是“绿色计数 PASS”。

已关闭：
- **B4**：两次致命 queued hit 现在 `deathCount=1, hurtCount=1, blockedHurt=0`；blocked hit 不发 `player-hurt`；invuln 不入队。
- **B6（core 奖励部分）**：真实击杀 Node/Rendered kill parity 13/13；XP/货币/事件/后续射击逐字一致；`killEnemy/killBoss` 不再写 XP/货币。
- **B8**：Boss target radius 恢复 `getRadius()+1=4.0`，独立探针 `bossRadius=4`。
- **H9**：`resetProjectilesForTest`/`clearEnemiesForTest`/`stepSimulationTicksForTest` production 均抛 `Error: dev/test only`。
- **H10**：非 Boss `enemy-hit` 写入 `hitFlash`；独立 dev 探针 `sawHit=true, hitFlash=0.1333`，官方 H10 PASS。
- **B1/B2/B3/B5/H3/H4/H6**：核心碰撞/激光/只读视图/dev gate/checkpoint/single projectile/事件无圆整，均 PASS。

仍阻断/未完全关闭：
1. **公开 live 引用可绕写（B7 部分）**：`World.sim`、`w.sim.targets`、`w.player.data` 仍是公开活对象；独立探针 `target.hp=3` 后 `enemy._hp=3`，`w.sim.player.data.hp=1` 后 `player.data.hp=1`。`registerTarget` 深拷贝和 getter 只读只保护“输入/适配器 setter”，没有保护公开 `sim`/targets/player.data。
2. **tick 外 core 写（B9）**：`World.spawnEnemyProjectile` 由 legacy `Enemy.doAttack`/`Boss.fireLaser` 在 `updateLegacy` 中直接调用，立即写 `sim.projectiles`，无 `SimEvent`；独立探针 paused `tick` 不变而 core 弹丸 `3→4`。`Boss.summonDrones`/`World.updateRoom` 的 `spawnEnemy` 同样在 tick 外写 `sim.drones/targets`。官方 parity 通过冻住 legacy 攻击避免该路径，不能代表普通运行。
3. **adapter 事务旁路（B10）**：`World.collectLoot` 直接 `healPlayer/addCurrency`；`World.healPlayer/addCurrency/addPlayerXp` 直接写 core；`LevelUpScene` 调 `World.applyUpgradeChoice` 直接改 core；`Player.reset`/`World.tryInteract` 直接改 HP/位置；`economy/main.ts:67` 直接 `addCurrency`。独立探针：`spawnLoot+stepFrame(0)` 货币 `128→138` 但 **无 `currency-gained` 事件**；`healPlayer(5)` HP `1→6`；`applyUpgradeChoice('speed',1)` speed `220→237.6`，均不在 tick/事件事务内。
4. **击杀掉落行为回归（B11）**：core `awardEnemyKill` 直接把 currency/heal 加给玩家，`World.killEnemy/killBoss` 不再 `spawnLoot`；旧主 World 的可见击杀掉落（货币/生命）消失，资源房 loot 仍在。B6 的 XP/货币 parity 通过，但“掉落”与旧行为不等价。
5. **P1 生产冻结回归（B12/证据）**：新 H9 gate 后 `tests/ai-native-world.spec.ts:1057` 在 P1 感知用例调用 `clearEnemiesForTest()`；冻结 preview 上抛 `Error: dev/test only`，P1 spec **8/9 FAIL**（`gate-round2-playwright-p1.log`）；dev server 9/9 PASS（`gate-round2-playwright-p1-dev.log`）。开发者 44/44 是 dev，不覆盖冻结生产 P1；这是测试契约回归。
6. **H2 C1 边界（部分）**：core 多序列（0/1/2 kill）`crit→loot→crit` 与独立 RNG reference 均 PASS（`gate-round2-rng-multi.log`）；但 `World.rng` 仍服务 `pickEnemyForRoom`/`spawnResourceLoot`/portal，core RNG 是另一条流；C1 同一 `World.rng` 的真实房间/掉落消费会改变下一发 crit，C2 core 不会。开发者文档已承认“只承诺 core crit+击杀掉落”，但 Lead 要求的“真实调用顺序与 C1”未完全满足。
7. **H5/H8 文档/静态断言**：`AI_NATIVE_WORLD_CONTROL.md:197/204` 仍称“只读 target/唯一写源/Player.reset owner-only/适配器只消费事件”，与公开 `sim` live refs、`tryInteract`/loot/LevelUp/economy 旁路不符；`rewiring.test.ts` 仍未覆盖这些旁路。文档 Gates 396/44 与实际独立 gate 部分不一致（我们未重跑全 44，只跑 15+8+13+9+4 等）。

---

## 1. 独立 Gate（完整输出 `reports/ai-native-02/reviewer/c2-round2/`）

| 命令（冻结快照 cwd） | 结果 | 日志 |
| --- | --- | --- |
| `npm run typecheck` | **PASS** exit 0 | `gate-round2-typecheck.log` |
| `npm test` | **PASS** **24 files / 396 tests** | `gate-round2-unit.log` |
| `npm run build -- --outDir reviewer-dist` | **PASS** exit 0 | `gate-round2-build.log` |
| `npx vite build --config vite.mcp.config.ts --outDir reviewer-mcp-dist` | **PASS** exit 0 | `gate-round2-mcp-build.log` |
| 专属 dev 5361：`c2-parity` + `checkpoint` + `audit` | **PASS** **15/15** | `gate-round2-playwright-parity-regression.log` |
| `npx vite-node scripts/c2-node-parity.ts` | **PASS** **8/8** | `gate-round2-node-parity.log` |
| `npx vite-node scripts/c2-kill-parity.ts` | **PASS** **13/13** | `gate-round2-kill-parity.log` |
| 专属 dev 5361：runtime/whale/gameplay | **PASS** **4/4** | `gate-round2-playwright-runtime.log` |
| 独立 core RNG 多序列（0/1/2 kill） | **PASS** 9/9 | `gate-round2-rng-multi.log` |
| 独立 H10 flash（dev） | **PASS** `hitFlash=0.1333` | `gate-round2-flash-probe.log` |
| 独立 checkpoint coreState + 旧档 | **PASS** | `gate-round2-checkpoint-probe.log` |
| 冻结生产 5359：`tests/ai-native-world.spec.ts` | **FAIL 8/9**（`Error: dev/test only` @ `clearEnemiesForTest`；P1 F-01/F-02 用例失败） | `gate-round2-playwright-p1.log` |
| 同 spec 在 dev 5361 | **PASS 9/9**（证明失败来自 dev gate 测试契约，不是产品逻辑差异） | `gate-round2-playwright-p1-dev.log` |
| 独立浏览器 B1–B4/H9/H10/B9/target/live-ref/loot 探针 | **执行 PASS**，发现 B7/B9/B10/B11 阻断 | `gate-round2-browser-probe.log` |

说明：未重跑 44 项全量；`boss-room.spec.ts`(5173)/`canvas.spec.ts`(5199) 硬编码端口未触碰。**P1 生产冻结 FAIL 是明确回归**，不能以 dev 9/9 口头解释为全 PASS。

---

## 2. 逐项复验

### B4 — **关闭**
- `core.ts:480-489` 首次死亡后 break；`:595-603` blocked 直接返回、不发事件；独立浏览器 `q1/q2=true,pending=2,deathCount=1,hurtCount=1,blockedHurt=0`；官方 B4 PASS。
- 备注：`q2` 仍返回 true（排队语义）；无重复事件，可接受。

### B6 — **core 奖励关闭；旧掉落行为另见 B11**
- `awardEnemyKill` core 事务（`core.ts:262-282`），`World.killEnemy/killBoss` 只表现；kill parity 13/13。
- 但 `awardEnemyKill` 直接 `addCurrency/healPlayer`，不 `spawnLoot`；旧击杀掉落对象/拾取流程丢失（B11）。
- 真实击杀 Node/Rendered canonical/events/XP/currency/post-shot 13/13；官方 B6 15/15。

### B7 — **部分关闭**
- `registerTarget` 深拷贝（`core.ts:195-199`）；`Enemy/Boss` 删除 `wx/wy/_hp` setter 与 `hit()`；移动经 `enqueueTargetMove`（`World.ts:577-584`，`Enemy.ts:187-223`，`Boss.ts:90-103`）；`Enemy.update` 用 core `_hp`。
- 独立探针 `targetEnemy._hp=7`/`wx=999` 被忽略（getter-only），target 未变；官方 B7 通过。
- **未关闭**：`World.sim` public、`sim.targets` live、`player.data` getter live；探针 `target.hp=3` 后 `enemy._hp=3`，`w.sim.player.data.hp=1` 后 `player.data.hp=1`。公开对象可绕写权威状态。

### B8 — **关闭**
- `World.spawnBoss:566-570` `radius: getRadius()+1`；浏览器 `bossRadius=4`；Boss 死亡 PASS。

### H2 — **部分关闭**
- core 多序列（0/1/2 kill）与 reference RNG 9/9 PASS；`core.test` H2 single sequence PASS。
- `World.rng` 与 core RNG 两条流；`pickEnemyForRoom`/`spawnResourceLoot`/portal 的 legacy 消费会改变 C1 同流下一发 crit，C2 core 不消费；真实 C1 全序不等价。文档已限“只承诺 core crit+击杀 loot”，但 Lead 要求的真实 C1 顺序未完全满足。
- 旧 `World.rng` 仍用于房间/资源掉落；首片结果与 C1 不完全一致。

### H9/H10 — **关闭**
- H9：production `resetProjectilesForTest`/`clearEnemiesForTest`/`stepSimulationTicksForTest` 抛 `dev/test only`（`gate-round2-browser-probe.log`）。
- H10：dev 独立 `sawHit=true, hitFlash=0.1333`；`World.applySimEvents:727-741` 写 `enemy.data.hitFlash`/`applyVisual`。

### H3/H1/H4/H6 — **通过**
- checkpoint coreState tick/rng/pid/timers 恢复；旧档无 coreState `okOld=true,tick=0`；损坏 timer NaN 拒绝；canonical 字段/事件精度 PASS；duplicate enemy projectile 已统一。

### H5/H8 — **未完全关闭（文档/静态）**
- docs `AI_NATIVE_WORLD_CONTROL.md:197/204` 的“唯一写源/只读 target/Player.reset owner-only/适配器只消费事件”与 `w.sim` live、`collectLoot`/`LevelUpScene`/`tryInteract`/economy 旁路不符；`rewiring.test` 未覆盖这些旁路。
- docs gate 396/44 与独立 gate 不完全一致（未重跑全 44）。

---

## 3. 阻断问题（文件/行/证据/修复条件）

### R2-1（阻断）公开 live 引用可绕写 core
- 行：`World.ts:48` `sim!: SimulationState` 公开；`core.ts:107-113` targets/player data；`Player.ts:53-55` `data` getter 返回 `sim.player.data`；`Enemy/Boss` getter 返回 target；`w.sim.targets` 公开。
- 证据：`gate-round2-browser-probe.log` → `targetHp0=61`，`targetEnemy._hp=7` 被忽略（read-only getter），但 `target.hp=3` 后 `enemySeesCore=3`；`w.sim.player.data.hp=1` 后 `playerSeesLive=1`。
- 影响：任何页内脚本/适配器可绕过 `enqueueTargetHp`/`enqueuePlayerHit`/commands 直接改 HP/位置；与“唯一写源/只读 getter”冲突；Node canonical 可被外部绕写。
- 修复：`sim`/`targets`/`player.data` 对外只读/deep-freeze（或仅在 dev/test 暴露）、World 只暴露 snapshot/命令入口；补「公开引用写入被拒」测试。

### R2-2（阻断）tick 外 core 弹丸/召唤/房间写
- 行：`World.spawnEnemyProjectile:616-621` 立即 `spawnCoreEnemyProjectile` + `syncCoreEntities`；`Enemy.doAttack:225-237`（ranged）在 `updateLegacy:813-818` 调它；`Boss.fireLaser:139-158`、`Boss.summonDrones`；`World.updateRoom/spawnEnemy` 在 tick 外 register。
- 证据：浏览器探针 paused `tickBefore=303,tickAfter=303`，但 `sim.projectiles` `3→4`；无 `projectile-spawned` 事件/commit。官方 parity 通过 `e.data.state='stun'`/`attackTimer=1000` 冻住 legacy 攻击，未覆盖普通运行。
- 影响：可改变已提交 canonical、绕过 tick/事件序；Node 重放不包含这些外部写入；唯一 commit 被破坏。
- 修复：把 legacy ranged/召唤/房间生成改为 `pendingCommands`（如 `spawn-projectile`/`spawn-target`）在下一 core tick 提交并产事件；`World.spawnEnemyProjectile` 改成 enqueue-only 或 owner/dev 初始化；补「legacy 攻击→下一 tick 事件/Node parity」测试。

### R2-3（阻断）adapter 事务旁路（loot/economy/LevelUp/Player.reset/tryInteract）
- 行：`World.collectLoot:853-864` 直接 `healPlayer/addCurrency`；`World.healPlayer:602-604`、`addCurrency:607-609`、`addPlayerXp:595-599` 直接写 core；`LevelUpScene:164` `applyUpgradeChoice` 直接 core；`Player.reset:168-176` 直接 HP/位置；`World.tryInteract:486-498` 调 reset；`economy/main.ts:67` `addCurrency`。
- 证据：`gate-round2-browser-probe.log` → `spawnLoot+stepFrame(0)` currency `128→138`，但 `lootEvent=false`；`healPlayer(5)` HP `1→6`；`applyUpgradeChoice('speed',1)` speed `220→237.6`；无 tick/事件。
- 影响：普通 adapter/UI/economy 仍可 tick 外改 core；canonical/Node 在 loot/升级/房间切换后不等价；`Player.reset` 被 `tryInteract` 普通调用，非 owner-only。
- 修复：`collectLoot`/economy/Player.heal/addXp 改用 `enqueueHeal`/`enqueueCurrency`/`enqueueCommand('add-xp'/'apply-upgrade')`；`LevelUpScene` 走 pending command；`tryInteract` 用 core room-transition command 或明确 owner-only 并 gate；补「loot/升级/传送后 Node vs Rendered」测试。

### R2-4（阻断）击杀掉落回归
- 行：`core.awardEnemyKill:262-282` 直接 `addCurrency/healPlayer`，不 `spawnLoot`；`World.killEnemy:883-889` 只 destroy/stats；`World.killBoss:891-899` 只表现；`World.spawnResourceLoot` 仅资源房。
- 影响：旧主 World 击杀掉落的可见货币/生命对象消失，改为即时加值；拾取流程/经济节奏改变；B6 XP/货币 parity 只验证数值，不验证旧主 World 掉落行为。
- 修复：core 发 `loot-drop`/`loot-collected` 事实/命令，或 adapter 依据 core 奖励事件生成可见掉落并保留旧 `collectLoot` 语义；补「击杀后 loot 对象/拾取/经济」回归。

### R2-5（阻断/证据）P1 冻结生产回归
- 行：`tests/ai-native-world.spec.ts:1057` P1 感知用例调用 `w.clearEnemiesForTest()`；`World.clearEnemiesForTest:84-97` 严格 dev/test gate。
- 证据：冻结 preview 5359 `P1 8/9`，关键错误 `Error: dev/test only` at `clearEnemiesForTest`；dev 5361 `9/9`。
- 影响：P1 官方冻结证据不再绿色；开发者 44/44 是 dev，不覆盖生产 frozen；这是测试契约回归，不是产品逻辑差异。
- 修复：P1 spec 在生产可用路径下清理（或把该 fixture 拆到 dev-only spec 并明确不用于生产冻结），不要用 dev-gated helper 冒充生产清理；重新生成冻结 P1 证据。

### R2-6（高优先/未完全）H2 C1 真实顺序
- 证据：core 多序列 0/1/2 kill 与 reference PASS；但 `World.rng` 仍用于 `pickEnemyForRoom:523`/`spawnResourceLoot:531`/portal；C1 同一 RNG 的消费会改变下一发 crit，core 不消费；C2 core 与 legacy 两条流。
- 影响：核心内部确定性成立；C1 真实房间/资源/portal 序不 preserved。若 Lead 要 C1 等价，这是阻断；若接受“仅 core crit+kill loot”，必须文档/验收口径明确，不能只用一个特挑序列。
- 修复：继续分离则补 C1 对照矩阵与边界声明；要等价则把 legacy 消费纳入 core 或使用同一 RNG 并记录。

### R2-7（高优先/文档）H5/H8 静态与文档
- 行：`AI_NATIVE_WORLD_CONTROL.md:197/204` “只读 target/唯一写源/Player.reset owner-only/适配器只消费事件” 与 live `sim`、`collectLoot`、`LevelUpScene`、`tryInteract`、economy 旁路不符；`rewiring.test` 未覆盖 `w.sim`/commands bypass；docs `396/44` 与独立 gate 部分不一致（未重跑全 44）。
- 修复：更新文档为“World 内部 owner init vs adapter command 边界”，列出仍直接写 core 的入口；静态门加负向断言；不要以 dev 全绿代替生产 P1。

---

## 4. P1 / 存档 / 首片范围 / C3 前置

- P1：dev 9/9；冻结生产 **8/9 FAIL**（R2-5）；P1 三条件文档/fixture/flaky 本身已修，但生产 P1 证据需重跑。
- 存档：checkpoint 15/15 中的 5 项 + 独立 checkpoint 探针 PASS；旧档无 coreState 兼容；coreState tick/rng/pid/timers 恢复；F-08 深拷贝 PASS。
- 首片：core 已覆盖全部 enemy/Boss 弹丸碰撞、HP/位置命令、XP/货币/升级；非 drone FSM 决策仍 legacy，移动经 command；portal/房间生成/资源掉落种类/存档策略/视觉仍 adapter。
- C3 前置**未解除**：至少先修 R2-1/R2-2/R2-3/R2-4/R2-5；H2/H5/H8 同步明确；之后 C3 Gateway/MCP、F-03 `__game` 收敛、Observation/Action V2、权限/断线/预算、Signal。不得用 dev 44/44 或 kill 13/13 覆盖生产 P1 8/9；不得把本地 controller/浏览器自动化/夹具战斗当外部 Agent/Headless/真人。

---

## 5. 复现

```bash
cd D:/Project/LAST_SIGNAL
SNAP=/d/Project/lastsignal-c2round2-review-0df1514
rm -rf "$SNAP" && mkdir -p "$SNAP"
git -c core.autocrlf=false -c core.eol=lf archive 0df1514 | tar -x -C "$SNAP"
cmd //c "mklink /J D:\Project\lastsignal-c2round2-review-0df1514\node_modules D:\Project\LAST_SIGNAL\node_modules"
cd "$SNAP"
npm run typecheck; npm test
npm run build -- --outDir reviewer-dist
node node_modules/vite/bin/vite.js preview --outDir reviewer-dist --port 5359 --strictPort
PORT=5359 LS_AI_EVIDENCE_DIR=<own>/evidence-p1 npx playwright test tests/ai-native-world.spec.ts --workers=1
node node_modules/vite/bin/vite.js --port 5361 --strictPort
PORT=5361 npx playwright test tests/c2-parity.spec.ts tests/checkpoint.spec.ts tests/audit.spec.ts --workers=1
npx vite-node scripts/c2-node-parity.ts
npx vite-node scripts/c2-kill-parity.ts
PORT=5357 node <own>/probe-round2-browser.mjs
npx vite-node <own>/rng-multi-probe.ts   # 放入快照/调整路径
```

## 6. 证据索引

`gate-round2-{typecheck,unit,build,mcp-build,playwright-parity-regression,node-parity,kill-parity,playwright-runtime,rng-multi,flash-probe,checkpoint-probe,playwright-p1,playwright-p1-dev,browser-probe,git-state}.log`；`probe-round2-{browser,flash,checkpoint}.mjs`；`rng-multi-probe.ts`；`parity-kill/`。
