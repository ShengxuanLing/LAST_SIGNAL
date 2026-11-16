# AI-NATIVE-02 C2 第二轮阻断修复（事务化，待独立重验）

本提交针对 Reviewer `reports/ai-native-02/reviewer/c2-fixes/REVIEW_C2_FIXES.md` 对 `a8232c8` 的判定：B1/B2/B3/B5 已关闭，B4 部分，B6/B7/B8/H2/H5/H8/H9/H10 仍阻断/高优先。修复方向不是继续堆兼容 setter，而是把 canonical 写入收敛到 core 事务/命令，适配器只提交合法命令并消费事实。

## 1. 事务所有权

| 状态 | 唯一写入者 | 适配器入口 |
|---|---|---|
| player HP/位置/XP/等级/货币/timers/upgrades | `SimulationState` + core 事务 | `enqueuePlayerHit`、`World.addPlayerXp`、`World.healPlayer`、`World.addCurrency`、`World.applyUpgradeChoice`、`applySimEvents` 消费 |
| drone HP/位置/FSM/timers | core `stepDrones` | `registerDrone` 初始快照 + 渲染同步 |
| 非 drone/Boss target HP/位置 | core 弹丸 / `set-target-hp` / `move-target` 命令 | `registerTarget` 深拷贝、`World.enqueueTargetMove`、`World.enqueueTargetHp` |
| 弹丸 | core | `World.spawnEnemyProjectile` 返回句柄；`World.projectiles` 只读副本 |
| 击杀 XP/货币/等级/掉落 RNG | core `awardEnemyKill` | `enemy-died` + `xp-gained/currency-gained/player-healed/player-levelup` 事件 |
| 升级材料化 | core `applyUpgradeToPlayer` | `World.applyUpgradeChoice`（LevelUpScene 不再改 `player.data`） |
| 玩家 reset | World owner 初始化/房间切换边界 | `Player.reset` 注释明确 owner-only；普通 adapter 不调用 |
| 瞄准 | core tick 从 intent 提交 | `Player.setAimGrid` 只记录 pendingAim，`sampleIntent` 交给 core |

## 2. 逐项修复

- **B4（阻断）**：`applyPendingPlayerHits` 在首次死亡后丢弃后续 hit；`applyCorePlayerHit` 对 blocked hit 直接返回，不发 `player-hurt`、不写 HP/位置/音效/震屏；只在 HP 由 >0 变 <=0 时发一次 `player-death`。永久回归：`core.test.ts` B4、`c2-parity.spec.ts` B4（同帧双致命 death=1/hurt=1/blocked=0）。
- **B6（阻断）**：击杀 XP/货币/等级与掉落 RNG 移入 core `awardEnemyKill`；`killEnemy`/`killBoss` 不再 `addXp`/写货币/掉 RNG/`Math.random` 掉落。core 按 C1 顺序：两次 loot roll → XP。新增真实击杀 Node/Rendered parity：`tests/c2-parity.spec.ts` B6 生成 drone+hunter 真实击杀 + 后续射击 fixture，`scripts/c2-kill-parity.ts` 13/13 比较 canonical/events/XP/货币/后续射击；Reviewer 真实击杀探针现 `equal:true`（rendered/core XP 8、货币 4 一致）。
- **B7（阻断）**：`registerTarget` 深拷贝；`Enemy`/`Boss` 删除 `set wx/wy/_hp` 与 legacy `hit()`，getter 只读 core target；移动通过 `World.enqueueTargetMove` 命令在下一 tick 提交；`Enemy.update` 用 core `_hp` 判定存活。`Player.setAimGrid` 改为 pending intent；`LevelUpScene` 通过 `World.applyUpgradeChoice`；`collectLoot`/economy 走 core 交易。永久回归：`core.test.ts` B7、`rewiring.test.ts` 静态门。
- **B8（高优先）**：`World.spawnBoss` target radius 恢复 `getRadius()+1`（4.0）；`c2-parity` B1–B4 断言 `bossRadius=4`。
- **H2（高优先）**：core 连续 RNG `RNG(seed*7919+1)` 按 C1 顺序消费 crit → 击杀两次 loot roll → 下一发 crit；`core.test.ts` H2 用独立 RNG 参考序列断言 shot1/shot2 crit 一致。**限制**：`World.rng` 仍服务 portal/敌人选择/资源掉落等 adapter 决策，不宣称全玩法单 RNG；仅承诺 crit+击杀掉落顺序。
- **H9**：`resetProjectilesForTest`/`clearEnemiesForTest` 加 `import.meta.env` 严格 dev/test 门禁；生产 preview 探针抛 `Error: dev/test only`；`tests/audit.spec.ts` 清理改用显式 helper。
- **H10**：非 Boss `enemy-hit` 在 `applySimEvents` 写 `enemy.data.hitFlash` 并 `applyVisual/project`；`c2-parity` H10 回归。
- **H5/H8**：`docs/AI_NATIVE_PHASE_REPORTS.md` 与 `docs/AI_NATIVE_WORLD_CONTROL.md` 的 C2 段落改写为最终实现（core targets/commands、连续 RNG、stepFrame parity、真实击杀 parity、396/44 门禁）；删除“projectiles 只 legacy / per-tick RNG / test-only parity / 353/39”旧口径。
- **F-08/H3/H1/H4**：保留并扩展 canonical `pendingCommands`；checkpoint 恢复 core 契约；BOSS/Enemy 弹丸统一 core 构造。

## 3. 验证（完整日志 `reports/ai-native-02/c2-fixes-round2/logs/`）

| 结果 | 命令 | 结果 | 路径 |
|---|---|---|---|
| PASS | `npm run typecheck` | exit 0 | `01-typecheck.log` |
| PASS | `npx vitest run` | 24 files / 396 tests | `02-unit.log` |
| PASS | `npm run build` | built in 9.73s | `03-build.log` |
| PASS | `npm run game:mcp:build` | 301.22 kB | `04-mcp-build.log` |
| PASS | default MCP smoke | 6 Player tools | `05-mcp-smoke.log` |
| PASS | full Playwright `--workers=1` | 44/44（含五视口） | `pw-all.log` |
| PASS | `scripts/c2-node-parity.ts` | 8/8 | `06-node-parity.log` |
| PASS | `scripts/c2-kill-parity.ts` | 13/13（真实击杀+奖励+后续射击） | `07-kill-parity.log` |
| PASS | Reviewer browser probe | B4 death=1/hurt=1/blocked=0；B3 只读/ID 唯一；legacy target setter 无效；helper 门禁 | `08-reviewer-browser.log` |
| PASS | Reviewer kill parity probe | `equal:true`，XP/货币一致 | `09-reviewer-kill-parity.log` |
| PASS | Reviewer checkpoint probe | tick/rng/pid 恢复，旧档兼容 | `10-reviewer-checkpoint.log` |
| PASS | H9 production probe | helpers 抛 `dev/test only` | `11-h9-production.log` |
| FAIL（旧契约探针，预期翻转） | Reviewer canonical-rng probe | `registerTarget` 同对象/引用两项失败（深拷贝即 B7 修复）；其手动 RNG 对照未包含 core 击杀 loot，实际 core H2 回归已证明顺序 | `reviewer-canonical-rng.log` |

说明：Reviewer 的 browser probe 中 B1/B2 原始 fixture 仍使用已删除的 `_hp`/`wx/wy` setter，因此其 raw before/after 不再作为有效夹具；永久 B1/B4/B6 回归改用 `enqueueTargetHp`/`enqueueTargetMove` 命令。Reviewer browser probe 的 B4、B3、target legacy setter、helper 门禁断言为 PASS。

## 4. 限制与边界

- 仍未迁移：非 drone FSM 的决策细节（只提交 target move 命令）、portal/房间生成/资源掉落种类、存档策略、视觉 RNG。`World.rng` 与 core RNG 仍是两条流，只承诺 core crit+击杀掉落顺序与 C1 一致，不宣称全 run C1/Replay 等价。
- `Player.reset` 仍是 World owner 初始化/房间切换边界；普通 adapter 不调用。ranged legacy attack 仍调用 core `spawnEnemyProjectile` 事务（core-owned，但不在 tick 内入队）。
- 正式 World 无 Signal；C3 真实外部 Agent 战斗仍是 P2 完成条件。C3-b 冻结，未接 World、未合并 main。
- Stash：`stash@{0}` 是本轮开始前暂停的 C3-a extra quota tests；`stash@{1}` 是 C3-b prep WIP，均未读/未恢复/未并入本提交。
- 本提交**不宣称 C2 通过**；等待 Reviewer 独立重验。
