# AI-NATIVE-02 C2 交付报告（首片 SimulationState / 固定 tick / Node-Rendered parity）

- 提交：**`4cf1bc8b26a335661b36016a2ade5b23d87afc37`**
- 父提交：`ff13ce3b0309148ed0c3cf72bc662ffafb4b4fc7`（P1 条件项收尾小补丁，独立提交）
- 分支：`feat/ai-native-world-integration`；未 push、未合并 main、未动 PR；`git status --porcelain` 仅 `?? reports/`。
- 范围：C2 首片（真实 start room + `drone` + `pulse` + player/drone 弹丸）；未做 C3 外部 Agent/MCP 接入，未实现 Signal，未宣称全 run Replay/stateHash。
- 独立复核：本提交尚未经独立 Reviewer/Tester 复核；C1 已获 Reviewer `reports/ai-native-02/reviewer/c1/REVIEW_C1.md` PASS（有限制、无阻断）与 Tester PASS，但 C1/C2 都不等于 P2 整体完成。

---

## 1. Gate 一行式（完整日志 `reports/ai-native-02/c2/logs/`）

- PASS `npm run typecheck` exit 0 → `final-typecheck.log`
- PASS `npm test` **353/353**（21 文件；含 C2 core/parity/rewiring） → `final-unit.log`
- PASS `npm run build` exit 0（保留既有 500kB chunk 警告） → `final-build.log`
- PASS `npm run game:mcp:build` exit 0 → `final-mcp-build.log`
- PASS `PORT=5173 npx playwright test --reporter=list --workers=1` **39/39**（旧 36 + C2 3；含五视口与旧 27 项） → `final-full-playwright.log`
- PASS 冻结快照 5334 `PORT=5334 … npx playwright test tests/ai-native-world.spec.ts --workers=1` **9/9** → `final-playwright-frozen-p1.log`（构建 `frozen-build.log`，预览 `preview-5334.log`）
- PASS `npx vite-node scripts/c2-node-parity.ts` / `npm run game:sim:parity` **8/8 PARITY_PASS** → `node-parity-final.log`（同初始 state/seed/sequence/ticks：Node vs Rendered canonical state/events 逐字一致，Node 重放两次也一致）
- 静态/证据：`src/world/sim/rewiring.test.ts`（纯模块无 Phaser/DOM/Math.random；适配器唯一调用；debug 镜像不存在）、`src/world/sim/parity.test.ts`（独立 legacy 公式对照）、`reports/ai-native-02/c2/parity/parity-{initial,sequence,rendered}.json`、`final-git-state.log`、`final-md5.log`、`final-commit.log`。
- 已关闭的中间失败：固定 tick 250ms 因浮点得到 14 ticks（epsilon 修正）；accumulator 残留 -2.8e-17（clamp 修正）；AI 快速传送/接战导致 Node 侧 300ms 采样漏掉位移（改为页面内 50ms 被动采样，阈值仍为 path>1.5、maxStep 0.1~3.2、真实 portal 交互）；audit/runtime/whale 旧回归因 player 弹丸/恢复/鲸鱼视觉迁移失败（补 `World.projectiles` 兼容视图、core ensureWalkable、`Player.syncVisual(dt)` 后全绿）。

---

## 2. 状态所有权与调用路径（唯一写源证明）

- **唯一写源**：`src/world/sim/core.ts` 的 `SimulationState` 拥有首片 player（位置/HP/data/timers/aim）、drone（位置/HP/data/attackTimer/wanderTimer）、player/drone 弹丸、`tick`、显式 `seed`、`rngState`、静态 MapData、`nextProjectileId`。
- **适配器只读渲染/采样**：
  - `Player.wx/wy/data/fireTimer/dashTimer/invuln/hurtTimer/aimYaw` 全部是 getter/setter → `World.sim.player`；`Player.sampleIntent()` 只采样意图，不含移动/开火规则；`Player.applyIntent/tryFire` 已删除。
  - `Enemy` 的 drone `wx/wy/_hp/data/attackTimer/wanderTimer` 全部 getter/setter → `World.sim.drones`；`attachSimDrone()` 绑定；drone `update()` 直接返回，FSM 只在 core。其他 kind 仍 legacy FSM。
  - `World` 的 `legacyProjectiles` 仅供 Boss/其他 enemy；`get projectiles()` 返回 legacy + core 视图（兼容旧回归读取），`set projectiles` 会清 core（旧测试清理路径）；core 弹丸由 `syncCoreEntities()` 创建/更新/销毁精灵。
- **调用路径**：`GameScene.update` → `Player.aimFromPointer` / `setFireHeld` → `Player.sampleIntent()` → `World.stepFrame(delta,intent)` → `stepSimulationTicks(state, ticks, intent)` → core 运动/瞄准/开火/弹丸/drone/伤害/死亡 → 有序 `SimEvent[]` → `World.applySimEvents()` 只做精灵/数字/音效/HUD/callback → `syncCoreEntities(dt)` 视觉同步 → `updateLegacy(dt)`（Boss/其他 kind/loot/portal/FX）。`World.sim` 是唯一可变权威。
- **固定 tick**：`SIM_TUNING` 60Hz，`MAX_FRAME_DELTA_MS=250`，`MAX_TICKS_PER_FRAME=15`；core 只吃整数 ticks；暂停/升级/背包/AI 开关/死亡/新局 `resetSimulationAccumulator()`；暂停不推进、恢复不追赶；250ms 用 epsilon+clamp 恰好 15 ticks，余量丢弃。
- **事件顺序**：core 先提交状态，再返回有序 `SimEvent[]`；适配器消费，不回写规则状态。C1 的 `lastMoveStep/lastWeaponSpec/lastProjectileData/lastDroneStep/lastHitResult` debug 镜像已删除，生产无消费者。
- **F-08**：`restoreCheckpoint` 先 `cloneCheckpoint(run)` 再赋值；`tests/c2-parity.spec.ts` 负向断言「恢复后改输入帧不改变活玩家 HP/坐标」。

---

## 3. Node/Rendered parity 证据

- `tests/c2-parity.spec.ts` 用真实 ESC 冻结 RAF，再通过 `World.stepSimulationTicksForTest(ticks,intent)` 的**受控意图队列**运行 20+120+12 ticks；不直接改 Scene 状态。它写出 `parity-initial.json` / `parity-sequence.json` / `parity-rendered.json`，并断言 `player-fired/drone-step/enemy-hit/enemy-died` 等真实事件。
- `scripts/c2-node-parity.ts`（vite-node，无 Phaser）读取同一 initial/sequence，在 Node 跑 `stepSimulationTicks`，与 Rendered 的 canonical state/events 逐字比较；同一 Node initial 重放两次也逐字一致。`PARITY_PASS checks=8 failures=0`。
- canonical **只包含已迁移范围**：seed/tick/rngState/mapSeed/mapMin、player 位置/HP/速度/伤害/crit/pierce/armor/dash/invuln/aim/weapon state、drones、projectiles。XP/currency/upgrades/loot/portal/Boss/其他 enemy 不进 canonical；事件只做 `1e-9` 浮点稳定化（cosmetic，不改变类型/顺序/伤害/死亡事实）。
- **不宣称**：全 run Replay、stateHash、Headless World、外部 Agent 战斗、Signal 玩法。`World.rng` 仍服务 legacy 掉落/传送门/敌人选择；`Math.random()` 仍在视觉（bob/星空/音频噪声）、Boss 召唤/掉落、新局 seed 等未迁移路径。

---

## 4. 子提交与证据归属

- **P1 收尾小补丁**：`ff13ce3b...`（只 docs/spec，3 文件；独立 stage，不含 C2 WIP）。冻结快照 5332 运行：typecheck PASS、`npm test` 344/344、build/MCP build PASS、P1 spec **9/9**、`shared control path -g --repeat-each=6` **6/6**；感知 E2E 已 `record('evidence-fixture', ...)`；阶段证据表逐项标注 `2d78e80`/`1aadd2e` 与 `p1-fixes-final`。日志 `reports/ai-native-02/p1-fixes-small/logs/`。
- **C2**：`4cf1bc8...`（15 文件，1709 insertions / 360 deletions）。证据 `reports/ai-native-02/c2/`：`logs/`、`parity/`、`evidence-frozen/`（P1 9 项冻结截图/日志）、`frozen-dist/`。
- 旧全量浏览器证据：`final-full-playwright.log` **39/39**，含 `tests/ai-native-world.spec.ts` 9 项、`tests/c2-parity.spec.ts` 3 项、旧 27 项；不是独立 Tester/Reviewer 验收。

---

## 5. 限制 / 未完成

- 只承诺真实 start room + `drone` + `pulse` + 已迁移 player/drone 弹丸；Boss、其他 enemy kind 的 `legacyStateMachine`、`Boss.hit`、`World.spawnEnemyProjectile`、loot/portal/升级/存档内容仍 legacy；不能把 canonical 当全 run state。
- 正式 World 仍无 Signal（Scan/Jam/Decoy/Relay/Bridge/Guard/Signal Energy 只在 Station Zero）；Signal 正式接入仍是总任务义务。
- 外部 Agent / LLM / Codex / MCP 未接入；HUD/菜单/文档持续 `LOCAL DETERMINISTIC` + `EXTERNAL NOT CONNECTED`。C3 真实外部 Agent 经正式通道战斗仍是 **P2 完成条件**，不重定义为 P3。
- F-03 `window.__game` 生产暴露、R-01/R-02/R-05/R-06/R-09、Human+ECHO、跨浏览器/触屏/高 DPI 未处理；C2 不宣称全游戏确定性/Replay。
- 本提交未经独立 Reviewer/Tester 复核；P1 修复复核与 C1 独立结论不能替代 C2 验收。

---

## 6. C3 下一步（P2 完成条件）

1. 正式 World Gateway/MCP：`WorldObservationV2/WorldActionV2`、epoch/requestId/actionId、actorRegistry/权限、`YIELDED`/人类优先、正常断线取消/降级/预算释放；只入队合法 `PlayerIntent`，不直接写 Scene。
2. 先修 F-03 `window.__game` 生产暴露，再接入外部 Agent；HUD 真实显示连接状态，不能本地 demo 冒充。
3. Signal 正式接入按真实设计另行实现；当前标记不支持。
4. 后续再把其他 enemy/Boss/loot/portal 逐步并入同一规则入口；当前不冒充全 World Core。

---

## 7. 复现

```bash
cd D:/Project/LAST_SIGNAL
git rev-parse HEAD                 # 4cf1bc8b26a335661b36016a2ade5b23d87afc37
npm run typecheck; npm test; npm run build; npm run game:mcp:build
# 全量浏览器（5173/5199 两 dev 端口同源码）
PORT=5173 npx playwright test --workers=1
# C2 parity（先由 c2-parity spec 生成 parity/*.json）
PORT=5173 npx playwright test tests/c2-parity.spec.ts --workers=1
npm run game:sim:parity
# 冻结 P1 9/9
cp -r dist reports/ai-native-02/c2/frozen-dist
npx vite preview --outDir reports/ai-native-02/c2/frozen-dist --port 5334 --strictPort
PORT=5334 npx playwright test tests/ai-native-world.spec.ts --workers=1
```
