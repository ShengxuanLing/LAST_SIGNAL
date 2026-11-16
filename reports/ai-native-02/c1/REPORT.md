# AI-NATIVE-02 C1 交付报告（共享纯规则抽取 + 即时接线）

- 提交：**`cdb594ed6b55dd7ac3a801dea9679ceabca2a66c`**
- 父提交：`1aadd2e04ffaa2a367c2b382004aea305b61f3ec`（P1 条件项修复）
- 分支：`feat/ai-native-world-integration`；未 push、未合并 main、未动 PR；`git status --porcelain` 仅 `?? reports/`。
- 范围：**仅 C1**。未做 C2 固定 tick / RNG 归一 / 集中状态，未做 C3 外部 Agent，未实现 Signal，未改存档契约。
- 独立复核：Reviewer/Tester 正在对 P1 修复提交 `1aadd2e` 做冻结快照复核；**本 C1 提交尚未经独立复核**，下列 PASS 均为开发者自测。

---

## 1. Gate 一行式（完整日志 `reports/ai-native-02/c1/logs/`）

- PASS `npm run typecheck` exit 0 → `final-typecheck.log`（分小步 `step1-typecheck.log`）
- PASS `npm test` **344/344**（19 文件，新增 15 项：rules 11 + rewiring 4） → `final-unit.log`
- PASS `npm run build` exit 0（保留既有 500kB chunk 警告） → `final-build.log`
- PASS `npm run game:mcp:build` exit 0 → `final-mcp-build.log`
- PASS `PORT=5173 npx playwright test --reporter=list --workers=1` **36/36**（旧 27 + P1 8 + C1 1；含五视口） → `final-full-playwright.log`
- PASS 冻结快照 5284 `PORT=5284 LS_AI_EVIDENCE_DIR=reports/ai-native-02/c1/evidence-frozen npx playwright test tests/ai-native-world.spec.ts --reporter=list --workers=1` **9/9** → `final-playwright-frozen.log`
- PASS 纯模块静态门（无 `phaser` / `document` / `window` / `Math.random` / `Date.now` / `performance.now`） → `static-pure-module.log`；适配器 import → `rewiring-imports.log`
- 状态/MD5/提交：`00-state-precommit.log`、`final-git-state.log`、`final-md5.log`、`final-commit.log`。
- 中间失败（已关闭）：`pw-dev-5173.log` 关键错误 `expect(fired.bullet!.lifetime).toBeCloseTo(fired.spec.lifetime, 6); Expected 0.7222 Received 0.3222`（`lastProjectileData` 曾是活引用，帧推进递减了 lifetime）；改为 `spawnProjectile()` 保存深拷贝快照，定向复跑 `pw-c1-dev.log` PASS，最终全量复跑全绿。

---

## 2. 改动文件（10）

| 文件 | 内容 |
| --- | --- |
| `src/world/sim/rules.ts` **新** | 唯一纯规则模块：移动/轴分离碰撞/瞄准、武器 spec、弹丸创建（真实 `RNG`）、弹丸推进与扫掠命中、护甲伤害/击退、drone FSM、非 drone 共用移动/远程攻击助手；无 Phaser/DOM/未播种随机 |
| `src/world/sim/rules.test.ts` **新** | 11 项 Node 单测：真实 `MapGenerator(424242)` 房间配置 + `WEAPONS.pulse/scatter/plasma` + `ENEMY_STATS.drone/sentinel` + `RNG`；覆盖受阻、瞄准、射击、扫掠命中/墙、伤害/死亡、drone FSM、F-09 `IsoMath` |
| `src/world/sim/rewiring.test.ts` **新** | 4 项静态接线门：Player/Enemy/World/control 调用 `sim/rules`，旧内联规则体与 `private segmentPointDistance` 已删除 |
| `src/entities/Player.ts` | `applyIntent`→`stepPlayerMovement`、`setAimGrid`→`aimYawFromGrid`、`tryFire`→`buildWeaponSpec`、`hurt`→`damageAfterArmor`；新增只读证据 `lastMoveStep/lastWeaponSpec` |
| `src/entities/Enemy.ts` | `drone` 走 `stepDroneAi`，其他 kind 走 `legacyStateMachine`（无重复 drone 权威）；`hit`→`resolveEnemyHit`；移动/远程攻击助手调用 `axisSlideToward/rangedAttackDescriptor/distanceWithin`；新增 `lastDroneStep/lastHitResult` |
| `src/world/World.ts` | `spawnProjectile`→`createProjectileData`、`updateProjectiles`→`advanceProjectile/projectileHitsTarget`；删除 `segmentPointDistance` 与内联 crit/伤害/速度规则；新增 `lastProjectileData` 深拷贝快照 |
| `src/ai-native/control.ts` | `intentToWorldVelocity` / `screenDirectionTowardGrid` 委托 `sim/rules` 并使用 `IsoMath.TILE_W/H`（F-09），数值不变 |
| `tests/ai-native-world.spec.ts` | 新增 C1 Rendered 用例（真实键鼠）并扩展 `state()`：断言 `lastMoveStep/lastWeaponSpec/lastProjectileData/lastDroneStep/lastHitResult`；保留 P1 五视口与全部旧用例 |
| `docs/AI_NATIVE_WORLD_CONTROL.md` | 新增 §6.5 C1 状态所有权边界、§6.6 Signal 不支持；更新风险表与遗留 |
| `docs/AI_NATIVE_PHASE_REPORTS.md` | 新增 C1 阶段记录；更正 F-09 已修；明确 C3 仍是 P2 完成条件 |

---

## 3. 功能与「唯一实现」证明

- 抽取的是**真实内联规则体**，不是第二套 World：`Player.applyIntent` 的速度/碰撞/冲刺预算、`Player.setAimGrid`、`Player.tryFire` 的 spec、`World.spawnProjectile` 的暴击/伤害/弹丸、`World.updateProjectiles` 的推进/扫掠命中、`Enemy.hit` 的伤害/击退、drone FSM 全部改为调用 `src/world/sim/rules.ts`；旧函数体已删除。渲染/音效/回调/精灵销毁仍在适配层。
- 首片 `drone + pulse`；`buildWeaponSpec/createProjectileData/advanceProjectile/projectileHitsTarget/resolveEnemyHit` 对所有武器与敌人共用；单测显式验证 scatter（5 发、magazine）与 plasma（pierce+2）不回归；Boss.hit 仍是自己的旧公式，不在首片内。全量 36/36 Playwright + 344/344 单测证明旧行为与存档契约保持。
- **Phaser 调用迁移函数的证据**：
  - 静态：`rewiring.test.ts` 断言 4 个适配器 import/调用，且旧规则体字符串不存在；`static-pure-module.log` 证明纯模块无禁用依赖。
  - 运行：`reports/ai-native-02/c1/evidence-frozen/operation-log-c1-rendered-rules-1280x720.json` 记录 `Player.lastMoveStep.velocity = {3.4375,-3.4375}`（真实各向异性预算）、`lastWeaponSpec`（pulse，damage 12 / speed 11.25 / lifetime 0.7222）、`World.lastProjectileData`（damage 12、radius 0.2、lifetime 0.7222 快照）、`Enemy.lastDroneStep.state='attack'`、`Enemy.lastHitResult`（blocked=false、hp=-2、hitFlash 0.15、knockbackApplied=true），drone 被真实鼠标开火击杀（HP 24→0，移出 `world.enemies`）。
- F-09 只在移动预算范围修：`sim/rules.ts` 用 `IsoMath.TILE_W/H`，`control.ts` 默认值同步；未扩张其它历史清理。

---

## 4. 证据

`reports/ai-native-02/c1/`：
- `logs/`：全部 gate 完整输出、状态检查、静态门、接线门、提交与 MD5。
- `evidence-frozen/`：冻结快照 5284 的 9 项 Playwright 截图/连续截图/`operation-log-*.json`（含 C1 Rendered、五视口 HUD、P1 控制流/覆盖层/感知）。
- `evidence-dev/`、`screens/`：dev 端口中间证据；`frozen-dist/` 为冻结产物，仅取证。
- `new-e2e-test.txt` 为插入用例的临时文本文件，不属于源码提交。

---

## 5. 限制 / 明确未完成（不冒充权威核）

- **C1 不是完整 SimulationCore / 权威状态集中**：可变状态仍分散在 `Player` / `Enemy` / `World` 对象；`GameScene.update()` 仍是变长 `dt`，`World.rng` 仍由 World 持有；没有固定 tick、事件队列、`SimEvent[]`、canonical state、Replay/state hash、Node/Rendered parity。集中 `SimulationState` 与固定 60Hz tick、全部玩法 RNG 归一、呈现事件隔离是 **C2**，本轮未做。
- **没有 Headless / 外部 Agent**：HUD/菜单/文档持续 `LOCAL DETERMINISTIC` + `EXTERNAL NOT CONNECTED`；没有 MCP 改 Scene、没有假 LLM/Codex、没有系统键鼠。`game:headless`/MCP 仍只服务 Station Zero。
- **Signal 正式 World 不支持**：无 Scan/Jam/Decoy/Relay/Bridge/Guard/Signal Energy/设施状态机；`SIGNAL_SYSTEM_DESIGN.md` 是设计提案，实现只在 `src/slice/`。C1 没有发明 Signal；正式接入仍是 AI-NATIVE-02 总任务义务。
- **C3 真实外部 Agent 战斗仍是 P2 完成条件**，排在 C1/C2 依赖之后，**不重定义为 P3**；`reports/ai-native-02/p2-scope/SCOPE.md` 已更正该口径。
- 未修：F-03 `window.__game` 生产暴露、F-08 `restoreCheckpoint` 入参别名、R-01/R-02/R-05/R-06/R-09、`onLoot`/`statsSnapshot()`、Human+ECHO 正式双 Actor、其他敌人 FSM 的纯迁移、Boss 伤害公式统一。
- 本 C1 提交尚未经独立 Reviewer/Tester 复核；P1 修复提交的独立复核仍在进行，不能联合结案。

---

## 6. C2 下一步（依赖 C1）

1. 集中 `SimulationState`：把 `Player/Enemy/World` 上分散的可变状态收拢，适配层只读投影；保持 `SAVE_VERSION=2` / `finishRun` / checkpoint 语义。
2. 固定 60Hz tick 累加器（250ms / 15 tick 上限），`GameScene.update()` 只传 delta，不再把变长 dt 乘进规则。
3. 玩法 RNG 全部走 `SimulationRng.snapshot/restore`；视觉随机排除出 canonical state；`SimEvent[]` 把精灵/音效/HUD/灯光/回调彻底隔离。
4. Node core 与 Rendered adapter 的 canonical parity（同 seed/初始 state/有序 intent/tick 数），仍不宣称全游戏确定性。
5. C3 外部 Agent 网关（epoch/requestId/actionId/权限/正常断线、`world_*` MCP 工具、F-03 收敛、YIELDED）作为 **P2 完成条件**随后实施。

---

## 7. 复现

```bash
cd D:/Project/LAST_SIGNAL
git rev-parse HEAD            # cdb594ed6b55dd7ac3a801dea9679ceabca2a66c
npm run typecheck; npm test; npm run build; npm run game:mcp:build
cp -r dist reports/ai-native-02/c1/frozen-dist
npx vite preview --outDir reports/ai-native-02/c1/frozen-dist --port 5284 --strictPort
PORT=5284 LS_AI_EVIDENCE_DIR=reports/ai-native-02/c1/evidence-accept \
  npx playwright test tests/ai-native-world.spec.ts --reporter=line --workers=1
# 全量旧回归（boss-room 固定 5173 / canvas 固定 5199，两端口须同源码）
npm run dev -- --port 5173 --strictPort
npm run dev -- --port 5199 --strictPort
PORT=5173 npx playwright test --reporter=line --workers=1
```
