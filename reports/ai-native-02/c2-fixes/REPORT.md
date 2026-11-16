# AI-NATIVE-02 C2 — 修复提交（关闭独立审查 B1–B5，扩大权威核范围）

本提交修复 `4cf1bc8`（C2 首片）被独立 Reviewer 判为 **阻断** 的 B1–B5，并把权威核从「drone+pulse 首片」扩大到覆盖全部 enemy kind / Boss 的弹丸碰撞与伤害、统一的弹丸 id、tick 外不直写 core 的玩家受伤事务、以及可恢复 core 契约的 checkpoint。C3（真实外部 Agent Gateway/MCP）不在本提交范围，单独提交处理。

## 阻断项关闭对照

| Reviewer 阻断 | 根因 | 修复 | 验证 |
|---|---|---|---|
| **B1** 非 drone/Boss 不被 core 弹丸伤害（187 tick 后 hunter 61→61、stalker 47→47、Boss 2400→2400） | core 弹丸只检测 `drones`，`targets` 尚未纳入 | `SimulationState.targets[]` + `registerTarget`/`enqueuePlayerHit`；`stepProjectiles` 玩家弹丸同时检测 drones 与 targets（Boss 走 `resolveBossHit` 护甲公式），死亡事件后过滤 `targets` | `tests/c2-parity.spec.ts` B1–B4：hunter/stalker/sentinel 全部掉血/死亡，Boss 可被 core 弹丸击杀 |
| **B2** Boss 激光改写 player 弹丸（core 弹丸 `(11.25,0)` 被改成 `(-0.6185,2.4223)`） | `Boss.fireLaser` 取 `world.projectiles[last]` 改 `proj.data.vel` | `Boss.fireLaser` 改用 `spawnEnemyProjectile` 返回句柄并显式设 `vel`；core 弹丸速度不再被 legacy 改写 | B1–B4 断言 player 弹丸 `vel` 在 `fireLaser` 前后不变，且激光生成自己的移动弹丸 |
| **B3** 兼容 setter 清空 core（core 1→0） | `World.projectiles` setter 直接写 `sim.projectiles` | `World.projectiles` 改为只读 core **副本**；setter 为 no-op；唯一显式重置是 `resetProjectilesForTest`；id 由 `sim.nextProjectileId` 统一，兼容视图不暴露可变 core 对象 | B1–B4 断言 `view.some(v => sim.projectiles.includes(v.data)) === false` 且 `setter` 后 `core.length` 不变 |
| **B4** legacy `player.hurt` 直写 core 无事件 | `World.updateProjectiles`/`Boss.ts:93`/`Enemy.ts:229` 调 `player.hurt` 直改 `sim.player` | `Player.hurt` 改为 `enqueuePlayerHit`（tick 外不直写 core）；下一个 core tick 以 `player-hurt`/`player-death` 事件提交；adapter 经 `applySimEvents` 消费 | B1–B4 断言 `hurt` 调用后 `sim.player.data.hp` 不变、`queued===true`、下一 tick 掉血且 events 含 `player-hurt` |
| **B5** 暂停测试门禁绕过（paused 仍推进 core） | `stepSimulationTicksForTest` 在 `paused=true` 仍推进 | `stepSimulationTicksForTest` 改为 `import.meta.env` 严格 dev/test 门禁（生产 `MODE!=='test'` 抛错）；parity 改用正常 `stepFrame`/累加器路径 | `c2-parity.spec.ts` 3 项用 `stepFrame` 累加器；`scripts/c2-node-parity.ts` 8/8 通过；`stepFrame` 暂停不推进 |

## 顺带补强（H1/H2/H3/H6/F-08）

- **H1 canonical 权威化**：`canonicalSimulationState` 扩展 `mapHash`、完整 `player.data`、timers、`targets`、`pendingPlayerHits`、`nextProjectileId`；`canonicalSimulationEvents` 去除圆整、只排除 cosmetic `drone-step.faceAngle`。新增 `core.test.ts` H1/H6 断言。
- **H2 连续 RNG**：core 用连续流 `new RNG(seed*7919+1)`（保留 C1 `World.rng` 初始 seed 与调用顺序，crit 序列不变），跨 tick 保留 `rngState`；移除每 tick 派生。新增 `core.test.ts` H2 断言。
- **H3 checkpoint 恢复 core 契约**：`captureCheckpoint` 记录 `coreState`，`restoreCheckpoint` 恢复 `tick/rngState/timers/nextProjectileId`（消除伪 restore），`CoreCheckpointState` 经 `validateCheckpoint` 校验。新增 `c2-parity.spec.ts` H3 回归。
- **合并重复 enemy projectile 构造**：`World.spawnEnemyProjectile`、`Boss.fireLaser`、`drone 远程` 全部经 core `createEnemyProjectileData` / `spawnCoreEnemyProjectile`，半径统一 `/ (input.pixelToTile ?? GAME.PIXEL_TO_TILE)`。

## 边界与残留限制

- 仍只经正式 World 与 `window.__game`（dev/test 暴露）；不伪造 Headless / 外部 Agent；正式 World 无 Signal；C3 真实外部 Agent 战斗仍是 P2 完成条件。
- `stepSimulationTicksForTest` 仅供 dev/test 诊断，不得作为官方 Node/Rendered parity 证据（parity 走 `stepFrame`）。
- legacy `World.rng` / 视觉 `Math.random` 仍服务掉落/传送门/Boss 召唤/新局 seed 等未迁移路径；不宣称全玩法视觉 seeded RNG / 全 run stateHash。
- 本提交**不**混入 C3-a（F1/F2/F3）修复，C3-a 单独提交；C3-b 预研 WIP 仍以 stash 保存（`stash@{0}: C3-b prep WIP paused for C2 fixes`），未丢失、未并入本提交。

## 验证（全过）

- `npm run typecheck`：通过。
- `npm test`（vitest）：**377/377**（含 C2 新增 B1–B4/H1/H2/H3/H6）。
- 全量 Playwright：**41/41**（含 `c2-parity` 5 项、五视口 HUD、旧 E2E；注意并行 workers=2 下死亡断言偶发不稳，已改为死亡步骤显式提交排队命中，workers=1 全绿）。
- Node/Rendered parity：`scripts/c2-node-parity.ts` 8/8（`npm run game:sim:parity`）。
- Reviewer 探针复跑：`probe-c2-legacy-combat.mjs`、`probe-c2-authority.mjs` 退出 0。

日志目录：`reports/ai-native-02/c2-fixes/logs/`（一行 PASS/FAIL + 命令 + 结果 + 路径）。
- `pw-c2-parity.log`、`pw-c2-b1.log`、`pw-c2-h3.log`、`pw-runtime.log`、`pw-ainative.log`、`pw-death.log`、`pw-all.log`、`pw-all1.log`
- `node-parity.log`
