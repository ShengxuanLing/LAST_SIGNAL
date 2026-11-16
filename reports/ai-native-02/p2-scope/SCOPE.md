# AI-NATIVE-02 P2/P4 范围评估：最小共享 Simulation Core（只读评估，未写源码）

- 评估基线：修复提交 `1aadd2e04ffaa2a367c2b382004aea305b61f3ec`（父 `2d78e805...`），分支 `feat/ai-native-world-integration`。
- 范围口径：**正式 World 的一个真实房间 + 一类真实敌人 `drone` + 一种武器 `pulse`**，不是 Station Zero、不是 Headless 假扮 Phaser、不是第二套战斗规则。
- 证据：本目录 `logs/00-git-state.log`、`01-typecheck.log`、`02-unit.log`、`03-method-inventory.log`、`04-source-facts.log`；独立只读调查结论见文末「协议/MCP/Signal 核对」。
- 结论：**推荐先做 C1+C2 两步**（纯规则抽取 + 固定 tick/RNG/呈现事件隔离）；外部 Agent 网关 C3 是 **P2 的完成条件**（不重定义为 P3），排在依赖之后；P2 不能顺带宣称 Headless/Replay/LLM/Codex。

---

## 1. 必须抽取 / 修改的真实函数（按当前源码）

### 1.1 规则侧（必须变成纯 TS，无 Phaser/DOM/Camera）

| 现有位置 | 函数 / 状态 | 处理 |
| --- | --- | --- |
| `src/ai-native/control.ts` | `intentToWorldVelocity()`、`PlayerIntent`、`intentFromHumanInput()` | 已经纯 TS；作为共享移动预算与意图 DTO 保留，C1 只补 `IsoMath.TILE_W/H` 引用（F-09） |
| `src/entities/Player.ts` | `applyIntent()` 各向异性移动 + 轴分离碰撞、`setAimGrid()`、`tryFire()` 组 spec、`update()` 的 fireTimer/reload/invuln/hpRegen、`hurt()` 伤害/击退/死亡、`addXp()` | 规则部分抽到 `src/world/sim/player.ts`；`project()`、`whaleEffects`、`setTint/setAlpha`、`audio.ui/shoot/hurt`、`world.addShake` 留适配层 |
| `src/world/World.ts` | `isWalkable()`、`tileAt()`、`_computeBounds()`（静态地图）、`spawnProjectile()` 的 crit/伤害/速度/半径、`updateProjectiles()` 的扫掠命中 `segmentPointDistance()`、`killEnemy()`、`updateCamera()` 无规则 | 抽 `sim/world.ts` / `sim/combat.ts`；`addProjectileSprite()`、`p.spr.setPosition/destroy`、`addDamageNumber/addHitFx`、`callbacks.onStats`、`audio.bossroar` 留适配层 |
| `src/entities/Enemy.ts` | `drone` 的 `update()/stateMachine()/detects()/moveToPlayer()/doAttack()/hit()`、`initHp()`、`distanceTo()` | 抽 `sim/enemy.ts`，只保留 drone FSM 与 `ENEMY_STATS.drone`；`project()`、`sprite.setRotation/setTint`、`applyVisual()` 留适配层 |
| `src/config/weapons.ts` / `src/config/enemies.ts` | `WEAPONS.pulse`、`ENEMY_STATS.drone` | 已是纯数据，只读复用；**禁止**把 Station Zero `SLICE.MOVE_SPEED/canFit/TICK_HZ` 搬来覆盖正式 World 参数 |
| `src/world/World.ts` | `currentRoom()`、`updateRoom()`、`onEnterRoom()`（房间状态）、`captureCheckpoint()/restoreCheckpoint()` 的 `rngState` | C1 先把「单房间静态 MapData + 当前房间 id」作为纯输入；房间转场/portal/loot/boss/level-up 明确**不纳入首个 parity 切片** |
| `src/core/random.ts` | `RNG` (Mulberry32) / `snapshot()/restore()` | 纯 TS，复用为 `SimulationRng`；不得再在玩法路径用 `Math.random()` |

### 1.2 呈现 / 生命周期侧（留在 Phaser 适配层，不得进 core）

`GameScene.update()`（`dt = delta/1000` → `world.update(dt)`）、`worldToScreen/screenToWorld`、`WorldRenderer.updateLight()`、`GameScene.refreshHud/refreshMinimap/refreshBoss/lockHud/cam.shake`、`World.addDamageNumber/addHitFx/addShake`、`audio.*`、`spr/sprite.destroy()`、`saveSystem.writeCheckpoint/finishRun`、`LevelUpScene`、`PauseScene`、HUD/`ControlAuthority` 的人类输入与接管。这些只消费 core 事件与 core 状态，不写规则状态。

---

## 2. 状态所有权

| 状态 | 唯一所有者 | 禁止 |
| --- | --- | --- |
| 玩家 `wx/wy/hp/maxHp/cooldown/reload/invuln/aimYaw/weaponKey/weapons` | `SimulationCore.state.player` | Phaser Scene、Gateway、AI 直接写 `player.wx/hp` |
| drone `wx/wy/hp/state/attackTimer/wanderTimer`、弹丸 `pos/vel/lifetime/damage/hitSet` | `SimulationCore.state.enemies/projectiles` | 在 `Enemy`/`World` 里保留第二份可变副本 |
| 固定 tick 计数、玩法 RNG state、击杀/伤害事件序号 | `SimulationCore` | 以 `Date.now()` / `delta` 当权威 |
| 当前房间 id、静态 `MapData`（只读）、探索集合 | `SimulationCore` 输入/只读投影 | 把未探索房间、全图 `isWalkable` 结果交给外部 Agent |
| epoch/requestId/actionId/actorRegistry/幂等缓存/session 生命周期 | `WorldGateway`（C3） | 由 Action 参数覆盖或由 Scene 自增 |
| 精灵、相机、灯光、HUD、音频、存档序列化、UI 覆盖层 | Phaser 适配层 | 把这些塞进 `SimulationState` 或 Observation |
| 人类/本地 controller 意图队列 | `ControlAuthority` + `GameScene.submitIntent()` | Gateway 直接改 `scene.world.player.*` |

---

## 3. 固定 tick 与玩法 RNG 方案

- **固定 tick**：`src/world/sim/tuning.ts` 定义 `TICK_HZ=60`、`TICK_MS=1000/60`、`MAX_FRAME_DELTA_MS=250`、`MAX_TICKS_PER_FRAME=15`（数值参考 `src/slice/tuning.ts`，但独立常量，不 import Station Zero 规则）。`SimulationCore.step(frameDeltaMs, orderedIntents)` 用累加器推进整数 tick；动作在目标 tick 预提交，逐 tick 顺序固定：玩家移动 → drone FSM/攻击 → 弹丸推进与扫掠命中 → 伤害/死亡 → 事件提交。`GameScene.update()` 只传 `delta`，不再把 `dt` 直接乘进规则；首版渲染直接读 tick 后状态，不做插值（需记录手感风险）。
- **玩法 RNG**：`SimulationRng` 复用 `RNG`，seed 由 run 显式注入；`GameScene.create()` 新局 `Math.floor(Math.random()*1e9)` 仅在无显式 seed 的用户入口使用，parity/测试必须注入固定 seed。所有影响玩法的随机改走它：`spawnProjectile()` 暴击、`placePortal()` 目标、`pickEnemyForRoom()`、`spawnResourceLoot()`、`killEnemy()` 掉落、`killBoss()` 掉落坐标、`Boss.ts:142` 召唤角、`LevelUpScene.pickWeighted()` 升级卡、`spawnLoot()` 的 `bob`（因会进 checkpoint）。`snapshot()/restore()` 持久化 `rngState`。
- **视觉 RNG**：`GraphicsFactory` 星空、`AudioSystem` 噪声等纯表现随机可保留 `Math.random()` 或用独立 `visualRng`，但**不得进入 canonical state / checkpoint / parity 投影**。静态 gate：`grep -rn "Math.random" src/world/sim src/entities/Player.ts src/entities/Enemy.ts src/world/World.ts` 在玩法路径应为 0（表现调用点单独白名单登记）。

---

## 4. 呈现副作用隔离

`core.step()` 返回 `SimEvent[]`（类型化、有序）：`player-moved`, `projectile-spawned/removed`, `enemy-hit`, `enemy-died`, `player-hurt`, `damage-number`, `hit-fx`, `shake`, `sound`, `stats-delta`, `room-entered`, `player-death`。适配层在 tick 后消费：创建/销毁精灵、定位 sprite、伤害数字、hit flash、屏幕震动、音效、HUD/小地图/灯光、callback `onStats/onLevelUp/onDeath`、存档。当前混合点（`04-source-facts.log`）：`World.updateProjectiles()` 内 `p.spr.setPosition/destroy` + `addDamageNumber` + `callbacks.onStats`；`Player.tryFire()` 内 `audio.shoot`；`Player.hurt()` 内 `audio.hurt/addShake/project`；`World.killEnemy()` 内 `sprite.destroy/spawnLoot`；`World.update()` 内 `renderer.updateLight`。C2 必须把它们全部改为事件消费，否则 Headless 会拖 Phaser。

---

## 5. 对旧主 World 的影响 / 禁止复制规则

- `World.update(dt)` 从「规则+呈现一体」退化为「调用 `core.step()` + 消费事件 + 呈现」；`Player.update()`、`Enemy.update()`、`World.updateProjectiles()` 不再各自持有第二份规则，改为调用 `sim/*` 导出的纯函数。
- 首个切片只 parity 验证 **固定 seed 的 start room + drone + pulse + 玩家移动/开火/受击/击杀**；portal/loot/boss/其他敌人/其他武器/升级/存档仍走既有适配层，但**不得另写一份规则**：要么也调用同一 `sim` 原语，要么明确留在旧函数且文档登记为待迁移，不能同时存在旧 `updateProjectiles()` 与新 `core.updateProjectiles()` 两套实现。
- 旧测试必须全部保留：`tests/audit.spec.ts`、`checkpoint.spec.ts`、`canvas.spec.ts`、`runtime-bugs.spec.ts`、`vs00/vs01`、`ai-native-world.spec.ts` 等；`SAVE_VERSION=2`、key `last_signal_save_v1`、死亡 `finishRun`→新 R0、退出/刷新恢复 checkpoint 语义不变。
- 风险：变长 dt → 60Hz 会改变手感/弹丸命中/敌人攻击节奏；精灵生命周期与事件顺序错位会产生幽灵弹丸；RNG 拆分会改变既有固定 seed 的回归期望（需重新冻结截图/统计）。

---

## 6. Headless / Rendered parity 的可验证边界

**可验证**：同一 `seed` + 同一单房间 `MapData` + 同一初始 `SimulationState` + 同一有序 `PlayerIntent` 序列 + 同一 tick 数 → 同一 canonical 投影：`player.wx/wy/hp/cooldown/aimYaw`、`drone.wx/wy/hp/state`、弹丸 `pos/vel/damage/lifetime/hitSet`、死亡/伤害事件类型与顺序、`rngState`。Node 侧 `src/world/sim/*.test.ts` 直接跑 core；Rendered 侧 `tests/world-parity.spec.ts` 通过 dev-only `GameScene.submitIntent()` 入队意图（只入队，不写坐标/HP），按页内句柄读取 canonical 投影，两边 JSON 逐字比较。

**不可验证 / 明确排除**：Phaser sprite/camera/HUD/音频/DOM、墙钟与 FPS、`Math.random` 视觉抖动、`LevelUpScene` 卡池、存档对象、跨房间 portal、其他敌人/武器/Boss、`window.__game` 页面级访问、外部 LLM 延迟。不能把 Playwright 跑 Phaser 叫「Headless 核心」，也不能把 parity 说成「全游戏确定性/Replay 已完成」。

---

## 7. P2 外部 Agent 网关：复用既有 MCP，不向 Scene 写状态

- **可直接复用**：`src/ai-native/protocol.ts` 纯原语（`canonicalJson`、`payloadFingerprint`、`hasHiddenField`、`checkIdempotency`、`compareActionOrder/EventOrder`、`validateActionPermission`、`validateActionDeadline`）；`sessions.ts` 的 `(sessionId, epoch, requestId, actionId)` 幂等/actor 绑定/`ProcessSessionBudget`/close-dispose 模式；`mcpServer.ts` 的官方 MCP stdio + `zod.strictObject` + Player/Dev 工具隔离 + `transport.onclose/SIGINT/SIGTERM` cleanup；`harness.ts` 的 epoch 先于缓存校验与原始参数缓存模式；`docs/AI_NATIVE_PERMISSION_MODEL.md` 的 YIELDED/takeover/断线降级契约。
- **不可直接复用**：`Session`/`Harness`/`HeadlessGame` 类本身、`ActionTypeV1`/`ObservationV1`/`SnapshotV1.state` 形状、`kernelVersion='station-zero-r1-r2@1'`、ROUTE_A/fixture/corridor 语义。`sessions.ts:626/670` 固定 `createGame({scenario:'station-zero'})`；`mcpServer.ts` 全部 handler 走 Harness→Station Zero。
- **最小新接口**：`WorldObservationV2`（白名单构造→schema→黑名单终检，含 `epoch/tick/perceivedActors/ownState/availableActions`，无 seed/RNG/全图/portal targetRoom/Boss phase）、`WorldActionV2`（`move/stop/aim/fire/interact`，`requestId/actionId/epoch/actorId` 必填）、`WorldGateway`（不可变 actorRegistry、权限分面、幂等缓存、预算、pause/resume 由人类/Owner 独占、close 正常断线）。
- **通道**：新增 `world_*` MCP 工具（独立 `--world` 进程或新工具前缀），Gateway 只把合法 `PlayerIntent` 入队到 `GameScene.submitIntent()`（渲染会话）或 `SimulationCore`（Headless 会话）；**禁止** `scene.world.player.wx = ...` / MCP 改 Scene / 伪造 pointer / 系统键鼠。人类输入立即 `YIELDED`、清 Agent intent、不自动回切；正常断线（close/transport EOF）取消在途动作、bump epoch、降回人类控制、释放预算，恢复需新握手。
- **前置阻断**：F-03 `window.__game` 生产暴露必须先收敛为 dev/test 句柄；`ControlAuthority` 需新增 `externalOwner` 状态与真实 HUD（未连接时仍 `EXTERNAL NOT CONNECTED`，不允许本地 demo 冒充）；当前 `YIELDED` 在正式 World 尚未实现（仅契约文档），不得宣称已有。

---

## 8. Signal：正式 World 当前真实支持项

- **主 World 没有任何 Signal 玩法**：`docs/SIGNAL_SYSTEM_DESIGN.md` 明确是 0.2.0 设计提案、`【需新建】`，`src/` 无 `SignalSystem/ScanAbility/JamAbility/DecoyAbility`。`WorldCallbacks` 只有 level/death/room/loot/stats/boss；`Enemy.detects()` 是纯欧氏 `aggroRange`；`RoomKind` 无 Signal 类型。
- 现有「门/通道」只是 `MapGenerator.doorways` 地砖、`WorldRenderer` 装饰、`World.placePortal/tryInteract` 的房间跳转；不是 SEALED/JAMMED 门状态机。
- Scan/Jam/Interact/ShootGuard、Relay/Bridge/Guard、ObservationEvidence、Signal Energy、设施状态机、7 类信号全部只在 `src/slice/` 的 Station Zero 里实现。**不得**把「正式 World 已支持 Signal」写进 P2 计划；P2 切片只能复用纯网格 LOS/碰撞思想，不能发明玩法。

---

## 9. 三个可连续提交的小步（文件所有权 / 验收 / 规模）

| 提交 | 内容 | 文件所有权（单一写者） | 验收命令（日志写 `reports/ai-native-02/p2-scope/`） | 规模 / 风险 |
| --- | --- | --- | --- | --- |
| **C1 纯规则抽取 + 立即 rewiring** | 新增 `src/world/sim/{types,tuning,movement,combat,player,enemy,rng}.ts` 与 `*.test.ts`；把 `Player.applyIntent/tryFire/hurt`、`World.isWalkable/spawnProjectile/updateProjectiles/segmentPointDistance/killEnemy`、`Enemy` drone FSM 改为调用纯函数，行为不变 | Worker A：`src/world/sim/*`；Worker B：`src/entities/Player.ts`、`src/world/World.ts`、`src/entities/Enemy.ts`、`src/scenes/GameScene.ts`；`src/config/*` 只读 | `npm run typecheck`；`npm test`（≥329 + 新纯单测）；`npm run build`；`PORT=5173 npx playwright test --workers=1`（≥35）；纯单测覆盖各向异性/四角碰撞/扫掠命中/drone 死亡；静态断言 `sim/*` 无 `Phaser`/`Math.random` | 新增约 350–500 LOC、迁移约 150–250 LOC；2–3 人日；**中风险**：规则迁移必须零行为变化 |
| **C2 固定 tick + seeded RNG + 事件隔离** | 新增 `src/world/sim/core.ts`、`events.ts`、`src/world/SimulationAdapter.ts`；`GameScene.update` 改累加器；`World.update` 退化；呈现副作用迁到事件消费；拆分玩法/视觉 RNG | Worker A：`sim/core.ts/events.ts`；Worker B：`GameScene.ts`、`World.ts`、`WorldRenderer.ts`；测试 `src/world/sim/fixedTick.test.ts`、`tests/world-parity.spec.ts` | 上面全部 + 固定 tick 单测（250ms 上限/15 tick 上限/同 seed 同意图同结果）+ 玩法路径 `Math.random` 静态 gate + 五视口 Playwright + checkpoint/存档旧用例；`reports/ai-native-02/p2-scope/logs/C2-*.log` | 新增约 300–450 LOC、改动约 200–300 LOC；2–3 人日；**高风险**：手感/命中/精灵生命周期/既有固定 seed 截图需重冻结 |
| **C3 外部 Agent 网关 + MCP world 工具 + parity（P2 完成条件）** | 新增 `src/ai-native/worldProtocol.ts`、`worldGateway.ts`、`worldMcpTools.ts`、`tests/world-parity.spec.ts`；`mcpServer.ts` 加 `--world` 注册；`ControlAuthority` 加 external/YIELDED；F-03 收敛 `window.__game`；文档 | Worker C：`src/ai-native/*`（新文件）、`mcpServer.ts`、`main.ts`；Worker B：`GameScene.ts` 的 `submitIntent()`；文档 `docs/AI_NATIVE_*` | 官方 MCP Client smoke（observe/action/close）+ epoch/requestId 负向单测 + 正常断线降级 + Node/Rendered parity + 独立 Reviewer/Tester 双验收 | 新增约 600–900 LOC；3–5 人日；**高风险**：协议/权限/外部通道，必须等 F-03 与独立复核 |

**工期调整**：P2+P4 不是 1 个小迭代；C1+C2 至少 4–6 人日 + 1 轮独立 gate，C3 再加 3–5 人日 + 1 轮独立 gate，总计约 7–11 人日、2 轮独立复核。原「P2 真实战斗与 P4 共用规则」若合并交付需按 2 周排期，不能压缩到单次提交。

---

## 10. 推荐最小方案

**先做 C1 + C2，C3 仍是 P2 完成条件**（排在其后，不是 P3 新阶段）。具体边界：
- 固定 seed 的真实 start room（由现有 `MapGenerator` 生成，不新造关卡），只模拟 `drone` + `pulse` + 玩家移动/开火/受击/击杀；portal/loot/boss/level-up/其他敌人武器留在适配层，文档明确「未迁移」而不是「已 parity」。
- 先把规则抽成唯一纯函数并让 Phaser 调用，禁止保留旧函数同时新增 core 函数（防第二套规则）；再上固定 tick、玩法 RNG、事件队列；最后用 Node core 与 Rendered adapter 的 canonical 投影做 parity。
- 外部 Agent 只复用协议原语/MCP 进程模式，不复用 Station Zero `Session` 类；Gateway 只入队 `PlayerIntent`，不写 Scene 状态；HUD 继续保持 `EXTERNAL NOT CONNECTED` 直到真正接入。
- 不实现、不宣称 Signal 玩法、Headless World 全量迁移、Replay/state hash、LLM/Codex、Human+ECHO 正式双 Actor；R-01/R-02 义务随 C1/C2 部分推进但 P4 才关闭。C3 真实外部 Agent 战斗仍是 P2 完成条件，不得用本地 demo / 浏览器自动化冒充。

> 本评估只读，未修改任何生产源码/测试/配置；日志与报告均在 `reports/ai-native-02/p2-scope/`。后续实现由 Lead 另行派单。

## 附：协议/MCP/Signal 只读核对（独立 scout 结论摘要）

- `runtime.ts` 的 `HeadlessGame` 只驱动 `SliceModel/Corridor/FullSliceState`，固定 60Hz、显式 `ticks`、无墙钟；`createGame` 拒绝非 `station-zero/headless`。不能驱动 `World`/`GameScene`。
- `sessions.ts` 的 `Session` 固定 `createGame({scenario:'station-zero'})`，`adaptAction`/`allowedActions`/`snapshot` 全绑定 Station Zero；可复用幂等/epoch/预算/close 模式，不可复用类。
- `mcpServer.ts` 无 export，Player 6 工具 / Dev 工具靠进程参数隔离；`transport.onclose`/`SIGINT`/`SIGTERM` 统一 cleanup；`ProcessSessionBudget(10)` 由 MCP 进程注入。
- `AI_NATIVE_PROTOCOL.md` 确定性承诺只覆盖 `station-zero-r1-r2`；`YIELDED` 只有契约，正式 `src/` 无实现；`AI_NATIVE_PERMISSION_MODEL.md` 要求断线清 intent、降回人类、重新握手。
- `SIGNAL_SYSTEM_DESIGN.md` 为设计提案，正式 World 无 Signal；Scan/Jam/Relay/Bridge/Guard 只在 `src/slice/`。
