# C2 Round-3 独立复核报告（仅针对上轮遗留项）

- **被测提交**：`6ac60b2092402e778b6d0b9c9e02a4b0148a1cce`（短 `6ac60b2`），父 `0df1514`
- **分支**：`feat/ai-native-world-integration`（C3b 仍冻结）
- **复核方式**：`git archive` 冻结快照（路径 `D:/Project/lastsignal-c2round3-review-6ac60b2`，`node_modules` 通过 junction 复用）；全部被跟踪文件 MD5 与 `git show <commit>:<path>` 一致（`ALL_TRACKED_FILES_MATCH`，见 `gate-round3-git-state.log`）
- **共享工作树状态**：本地存在未提交 WIP 与 stash，仅作为元数据列出，**未读取/未恢复**，不作为验收证据；所有验收均在冻结快照上运行
- **C3 前置**：**未解除**（见末节）

## 一、质量门概览（本轮已跑，引用日志不重复无关项）

| 门 | 命令 | 结果 | 日志 |
|---|---|---|---|
| 类型检查 | `npm run typecheck` | PASS (exit 0) | `gate-round3-typecheck.log` |
| 单元测试 | `npm test` | PASS，396→**397 passed (24 files)** | `gate-round3-unit.log` |
| 构建 | `npm run build` | PASS | `gate-round3-build.log` |
| MCP 构建 | `npm run mcp:build` | PASS | `gate-round3-mcp-build.log` |
| Playwright 回归 | `npx playwright test ai-native-world c2-parity checkpoint audit economy runtime-bugs gameplay whale-character` | PASS（ok 12–25） | `gate-round3-playwright-regression.log` |
| P1 生产预览 | `ai-native-world.spec.ts`（production 预览，端口 5373） | **9/9 PASS** | `gate-round3-playwright-p1-production.log` |
| P1 dev 复跑 | 共享控制 ×3（dev） | PASS | `gate-round3-p1-dev-repeat.log` |
| Node 参数 | `scripts/c2-node-parity.ts` | **8/8 PASS** | `gate-round3-node-parity.log` |
| Kill 参数 | `scripts/c2-kill-parity.ts` | **13/13 PASS** | `gate-round3-kill-parity.log` |
| 生产边界探针 | 冻结 production 预览（无 dev fixture） | 见 `gate-round3-production-probe.log` | `gate-round3-production-probe.log` |
| Kill→loot→拾取→后续射击 一致性 | dev（rendered vs Node core） | 见 `gate-round3-kill-loot-parity.log` | `gate-round3-kill-loot-parity.log` |
| 生成队列 / 房间直写 | dev | 见 `gate-round3-spawn-queue.log` | `gate-round3-spawn-queue.log` |
| C1 对照（RNG/分布） | 200+ seed 对照探针 | 见 `gate-round3-c1-compare.log` | `gate-round3-c1-compare.log` |

参数数据副本：`parity/`（initial/rendered/sequence）、`parity-kill/`（kill-initial/rendered/sequence）。

## 二、逐项结论

| 上轮项 | 本轮结论 | 一句话依据 |
|---|---|---|
| **B7 / R2-1**（`_sim` 私有隔离 + 普通公开 API 不可直写） | **PASS（含残留）** | `sim`/`sim.player.data`/`sim.targets`/`player.data` 深冻结，严格赋值被忽略；dev fixture 在生产抛 `dev/test only`；但 `ownerSetPlayerData/healPlayer/addCurrency/addPlayerXp/equipWeapon/ownerMovePlayer/ownerResetPlayer/spawnEnemy/spawnBoss/spawnLoot` 为**约定式 owner 路径，非能力门禁**（见下残留） |
| **B9**（tick 外 core 直写） | **PASS** | Boss `fireLaser`/`shockwave` 改为 `enqueueCommand`；探针 `laserEnqueued=true`；`stepFrame` 中 `processWorldSpawns` 在 tick 前提交 |
| **B10 / R2-3**（loot/economy/LevelUp/reset/tryInteract 走命令） | **PASS** | `collectLoot`→core 事务；`healPlayer/addCurrency/addPlayerXp` 入队/核心事务；`LevelUpScene.enqueueApplyUpgrade`；`tryInteract`→`enqueueTeleport`；`Player.reset` 经 `ownerResetPlayer`（owner） |
| **B11 / R2-4**（kill-loot 回归） | **PASS** | kill 参数 **13/13**；`kill-rendered.json` 事件链 `enemy-died→loot-dropped→xp-gained→currency-gained→loot-collected→player-healed` 完整；见 `gate-round3-kill-loot-parity.log` Phase A/D |
| **R2-5**（P1 冻结生产不得用 `clearEnemiesForTest`） | **PASS（生产分支清洁；组合套件偶发抖动）** | 冻结 production 预览 P1 **9/9**，`clearEnemiesForTest` 在 `import.meta.env.DEV` 为 false 时被排除；dev 分支仍保留该门禁调用（仅 dev），不污染生产路径；但 `npm test` 全量组合时 P1 spec 偶发失败（dev 门禁路径），建议隔离 |
| **H2 / R3**（房间确定性 / 不偷偷改 RNG） | **PASS（核心连续性）；附带发现** | 200+ seed 探针：核心前 5 个 crit 布尔与 C1 **0 失配**，RNG 顺序连续；但**房间生成 RNG 已移除**（见 R2-2/发现） |
| **R2-2**（普通房间敌人/资源/传送确定性 + 生成队列） | **部分 FAIL** | Boss/召唤/`enqueueSpawnEnemy`/`enqueueSpawnBoss` 走 `worldSpawns` 队列，下一 tick 提交、无生成 `SimEvent`（正确）；但**普通房间生成 `spawnForRoom`/`spawnResourceLoot`/`placePortal` 仍在 `onEnterRoom` 中直写 core、脱 tick、无事件**（见 `gate-round3-spawn-queue.log` `roomGen.directWrite=true`，targets 3→8）；文档“房间敌人生成改为命令入队”**与实现不符** |

## 三、关键证据与说明

### B7 / R2-1 — 快照隔离满足；owner 方法为约定门禁
- 生产边界探针（`gate-round3-production-probe.log`）：`Object.isFrozen(w.sim)`/`sim.player.data`/`sim.targets`/`player.data` 均为 `true`；`w.sim.player.data.hp=1` 等严格赋值 `no-throw` 且 canonical 不变（`hp` 仍 100）；`simFixture`/`playerDataFixture`/`setPlayerPositionForTest`/`clearEnemiesForTest`/`stepSimulationTicksForTest` 在生产均抛 `dev/test only`。
- 残留：`ownerSetPlayerData` 等“owner”公开方法**无运行时能力校验**，且被生产代码调用（P1 生产 spec 第 791 行注入第二武器；`economy/main.ts` 购买 restore/save；`World.restoreCheckpoint` 调 `ownerResetPlayer`/`ownerSetPlayerData`）。这些是**所有者初始化/恢复**路径，按约定仅 owner 使用、不用于普通对局交互；但没有任何权限令牌/能力边界阻止普通代码调用。`enqueueHeal/enqueueCurrency/enqueueApplyUpgrade` 等**已正确改为仅入队**，不在生产绕过 HP/资源/升级权限。结论：**未为 P1 去 dev 门禁而放开 Owner setter 的“危险形态”不存在（P1 走的是合法的 owner 注入），但 owner 方法本身靠约定隔离**——建议后续加一个 owner-capability 闭包以防误用。

### B9 — 已修复
- `Boss.fireLaser`/`shockwave` 不再直改返回的弹丸句柄，改为 `enqueueCommand`；探针 `laserEnqueued=true`（命令入队，core 在下一 tick 提交）。c2-parity B2 仍绿。

### B10 / R2-3 — 已修复
- 资源/经济/升级/拾取均已 core 事务化或命令化；`LevelUpScene` 用 `enqueueApplyUpgrade`；`tryInteract` 用 `enqueueTeleport`（仅合法走格、校验落点）；`Player.reset` 经 owner 恢复。生产边界探针中 `enqueueHeal(50)/enqueueCurrency(10)/enqueueApplyUpgrade/spawnLoot/spawnEnemyProjectile` 在 `stepFrame(0)`（暂停）下**仅入队、不提交**（`pendingCommands=6`，canonical 不变）；`stepFrame(>0)` 才按序提交（`player-healed→currency-gained→player-upgraded→xp-gained→loot-dropped→projectile-spawned→player-moved`，顺序与入队一致，无重复消费）。

### B11 / R2-4 — 已修复（kill-loot 行为恢复）
- kill 参数 **13/13** 通过；`parity-kill/kill-rendered.json` 显示可见 loot 掉落、拾取、经验/货币增加，canonical `loot` 与 `pendingCommands` 在拾取后归零。
- 独立 dev 探针（`gate-round3-kill-loot-parity.log`）Phase A：合法开火击杀 drone，rendered 与 Node core 的 **canonical 与 events 完全一致**，事件类型含 `enemy-died/loot-dropped/xp-gained/currency-gained/loot-collected/player-healed`；Phase D：击杀后补射一枪，rendered==Node（canonical/events/`rngState` 全一致）。证明 **Node/渲染 kill→可见loot→资源/事件→后续射击一致**。
- “合法移动拾取”的补充说明：受地图几何与武器射程约束，击杀掉落在 C1 拾取阈值（PLAYER_RADIUS+12）内，会在同 tick 自动收集，**无需移动**；移动意图本身的确定性已通过 Phase C（260 tick 移动，rendered==Node canonical/events）验证。未能在单一直线走廊（16–30 格连续可走）上复现“走 >12.5 格手动拾取”的场景（地图无此几何），此为地图/手感限制，非一致性缺陷。

### R2-5 — 生产分支清洁
- 冻结 production 预览 `ai-native-world.spec.ts` **9/9**；其中 `clearEnemiesForTest()` 仅在 `import.meta.env.DEV` 真时执行，生产路径不含该 dev 调用。dev 分支保留该门禁调用属预期。注意：`npm test` 全量组合运行时 P1 spec 偶发失败（dev 门禁路径抖动），建议将 P1 生产用例与 dev 门禁用例拆分，避免组合套件偶发。

### H2 / R3 — 核心连续 + C1 参照；但有分布变化发现
- C1 对照探针（`gate-round3-c1-compare.log`，200+ seed）：核心前 5 个 crit 布尔与 C1 **0 失配**；`World.rng` 在目标实现中对房间/传送/资源**零消费**（`targetWorldRngConsumption=0`），核心 `RNG(seed*7919+1)` 连续、单一、已种子化（H5/H8 满足）。
- 但**房间生成已不再使用 `World.rng`**：目标实现中 `placePortal` 取 `neighbors[0]`、`pickEnemyForRoom` 按 `r.id` 固定、`spawnResourceLoot` 按 `(r.id+i)%2` 决定 kind（无 `rng.pick`/`rng.int`）。与 C1（`860a0dd`）对照：enemy 失配 2200/3600、portal 失配 600/1200、sentinel 在 elite 房被完全剔除、约 5600 次旧 `World.rng` 消费被移除。**这是一次玩法分布变更**，并非“偷偷删除 RNG 破坏确定性”——核心仍是确定性种子 RNG，但房间敌人/传送的**分布相对 C1 已改变**。文档称“core 唯一玩法 RNG”为真；文档称“房间敌人生成改为命令入队”为假（见 R2-2）。**是否接受该分布变化需 Lead 决策**（不牺牲原玩法 vs 统一种子来源）。

### R2-2 — 部分失败（文档夸大于实际）
- **正确部分**：`enqueueSpawnEnemy`/`enqueueSpawnBoss`（含 Boss 召唤 ring）入 `worldSpawns`，由 `stepFrame` 开头 `processWorldSpawns` 在 tick 前统一提交；探针（`gate-round3-spawn-queue.log`）：入队后 `targets`/`drones` 不变、`worldSpawns=3`；下一 tick 后 `targets=3`、`worldSpawns=0`，且**无 spawn `SimEvent`**。Boss `fireLaser` 命令入队（`laserEnqueued=true`）。
- **不一致部分**：普通房间进入 `onEnterRoom`→`spawnForRoom`/`spawnResourceLoot`/`placePortal` **仍直接调用 `spawnEnemy`/`spawnLoot`/portal 写入 core，脱 tick、无命令、无事件**。探针 `roomGen.directWrite=true`（`targets` 3→8，房间进入瞬间直接注入 5 个敌人）。这与 `docs/AI_NATIVE_WORLD_CONTROL.md`“房间敌人生成改为命令入队，走 `World.stepFrame` 统一提交”**不符**。`MapGenerator.ts`/`core/random.ts`/`roomdepth.ts`/`config/enemies.ts` 相对 C1 未改（`git diff --stat 860a0dd 6ac60b2` 为空），非这些文件所致。

## 四、C3 前置是否解除

**未解除。** 依据本轮与历史证据：
- `AI_NATIVE_ARCHITECTURE.md` 仍写明 C3（Agent Gateway / MCP）是 **P2 完成条件**，外部 Agent 必须走“正式信道 + 权限 + 断线预算”接入；HUD 仍显示 `EXTERNAL NOT CONNECTED`。本轮提交 `6ac60b2` 的架构/控制/HUD 文档与代码**无任何 C3 解冻迹象**。
- 既有红线继续成立，且本轮复查再次确认：
  - **本地确定性控制器 ≠ 外部 Agent**：`LocalController`（`src/ai-native/localController.ts`）是唯一对接 core 的本地控制器；外部 Agent 接口（Gateway/MCP）仍冻结。
  - **Phaser/Playwright 浏览器 ≠ Headless World**：所有参数/一致性验证走 `World.stepFrame` + core，浏览器仅作渲染/事件回流；`window.__game` 仍作为调试/测试桥，未收敛为正式外部接口。
  - **i-frame/合成命中 fixture ≠ 真实战斗**：kill 参数用真实子弹命中（`enqueuePlayerHit`/弹丸碰撞），非 i-frame；本轮回填的“合法 fixture”为 `simFixture`/`playerDataFixture`/`clearEnemiesForTest` 等 dev 门禁，且生产边界探针**未使用任何 dev fixture**。
  - **开发者自测 ≠ 独立验收**：本报告所有结论基于冻结快照上的独立探针与门日志，未采纳开发者自述。

## 五、结论

- **C2 Round-3：PASS（条件接受）**——上轮功能性回归（B7 活引用、B9 laser、B10 经济/loot、B11 kill-loot）均已闭环；参数 8/8、kill 13/13、P1 生产 9/9、核心连续性+H2 参考通过；`kill→可见loot→资源/事件→后续射击` 渲染/Node 一致性已验证。
- **残留需 Lead 决策/跟进**：
  1. **R2-2 文档/架构不一致**：普通房间生成仍直写 core、脱 tick、无事件；建议要么改为命令入队（与文档一致），要么修正文档表述。
  2. **H2/R3 分布变化**：房间敌人/传送分布相对 C1 已改变（非确定性破坏，而是玩法分布变更），需 Lead 确认是否接受。
  3. **B7 残留**：owner 方法为约定门禁、非能力门禁；建议加 owner-capability 闭包。
  4. **R2-5 组合套件偶发**：P1 spec 在 `npm test` 全量组合时偶发失败（dev 门禁路径），建议拆分生产/ dev 用例。
- **C3：前置未解除，仍不可独立接受。** 在 C3 解冻并完成外部 Agent Gateway/MCP、权限/断线/预算、Observation/Action V2、`window.__game` 收敛与 Signal 验收前，不进入 C3 独立复核。

> 日志与探针位置：`reports/ai-native-02/reviewer/c2-round3/`（含 `gate-round3-*.log`、`parity/`、`parity-kill/`、三个 `probe-round3-*.mjs`、C1 对照 `gate-round3-c1-compare.log`）。所有运行均在冻结快照与独占端口（dev 5371 / production 预览 5373）上进行，未修改生产源码/既有测试/配置，未切换共享分支、未合并/重置。
