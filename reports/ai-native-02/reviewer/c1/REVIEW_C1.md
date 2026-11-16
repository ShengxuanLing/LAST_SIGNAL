# AI-NATIVE-02 C1 纯战斗规则迁移 · 独立审查

- 复核对象：冻结提交 **`cdb594ed6b55dd7ac3a801dea9679ceabca2a66c`**（父 `1aadd2e04ffaa2a367c2b382004aea305b61f3ec`），10 文件变更；**不是**共享工作树的 C2/WIP。
- 冻结方式：`git -c core.autocrlf=false -c core.eol=lf archive cdb594e | tar -x -C D:/Project/lastsignal-c1-review-cdb594e` + `node_modules` junction；全库 tracked 文件 MD5 与 `git show cdb594e:<path>` 逐字一致（`ALL_TRACKED_FILES_MATCH`，`gate-c1-git-state.log`）。默认 archive 会因 `core.autocrlf=true` 转 CRLF，故显式关闭。
- 共享工作树：复核期间 developer 已推进 C2（结束时 `HEAD=ff13ce3b…`，`M src/entities/{Enemy,Player}.ts`、`M src/world/sim/{rules.ts,rewiring.test.ts}`、`?? src/world/sim/core.ts` 等）。**该 WIP 一行未用于验收**；所有 gate 从冻结快照运行。未切共享分支、未改生产源码/测试/配置、未提交/合并，端口 5331/5333 专用且跑完释放，未占用 5173/5199/5284。
- 报告/日志：`reports/ai-native-02/reviewer/c1/`。
- 红线：本地 controller ≠ 外部 Agent；Phaser/Playwright ≠ Headless World/Replay；夹具注入的 drone/scatter/plasma ≠ 真实战斗通关；开发者/Tester 自测不作为本结论。

---

## 0. 最终判定

**C1 PASS（有限制，无阻断）**。

- C1 的目标是把**当前已存在的规则体**抽到唯一纯模块并让 Phaser 适配器即时调用；它**不是**完整 SimulationCore / 集中状态 / 固定 tick / RNG 归一 / Headless / parity / 外部 Agent。按 Lead 裁定，**不得因 C2 尚未完成而判 C1 失败**，但后续义务必须全部保留。
- 本轮独立验证：旧内联公式在 Player/Enemy/World/control 中确已删除；drone 分支唯一；伤害/护甲/暴击/击退/扫掠/穿透/武器 spec/RNG 调用顺序与父提交逐值等价（286 项 parity 检查全过）；存档契约无回归；debug 镜像不是第二权威；19 文件 344 单测、9 浏览器用例、7 项针对性存档/旧回归均 PASS。
- 高优先项均为**文档精度 / 测试强度 / C2 前置义务**，不是 C1 功能回归；P1 三项收尾（F-02 文档、F-07 表、flaky 断言）**不在本提交**，不得当作已通过，也未等待其提交。

---

## 1. 独立 Gate（完整输出在 `reports/ai-native-02/reviewer/c1/`）

| 命令（冻结快照 cwd） | 结果 | 日志 |
| --- | --- | --- |
| `npm run typecheck` | **PASS** exit 0 | `gate-c1-typecheck.log` |
| `npm test` | **PASS** **19 files / 344 tests** | `gate-c1-unit.log` |
| `npm run build -- --outDir reviewer-dist` | **PASS** exit 0（既有 >500kB 警告） | `gate-c1-build.log` |
| `npx vite-node reviewer-parity-probe.ts`（自建独立 parity 探针） | **PASS** **286 checks / 0 failures / PARITY_PASS** | `gate-c1-parity.log`、`parity-probe.ts` |
| 冻结生产构建 + 专属 5331：`PORT=5331 … npx playwright test tests/ai-native-world.spec.ts --workers=1` | **PASS** **9/9**（含 C1 用例） | `gate-c1-playwright-p1.log` |
| 专属 dev 5333 针对性回归：`PORT=5333 … npx playwright test tests/checkpoint.spec.ts tests/audit.spec.ts --workers=1` | **PASS** **7/7**（存档 5 + 旧回归 2） | `gate-c1-playwright-regression.log` |

说明：按「勿重复无关全量」未重跑 35 项全量 E2E；`boss-room.spec.ts`(5173)/`canvas.spec.ts`(5199) 硬编码端口未触碰。Tester 的 344/9 声称与独立复跑一致。

---

## 2. 逐文件依据（10 文件）

| 文件 | 依据 | 结论 |
| --- | --- | --- |
| `src/world/sim/rules.ts`（新增 461 行） | `:13-16` 仅 import 真实 `GAME`/`IsoMath`/`RNG`(type)/`types`(type)，**无 Phaser/DOM/墙钟/Math.random**；`:24-37` 各向异性速度、`:52-65` 轴分离、`:85-98` 移动/冲刺、`:100-105` aim、`:132-135` 护甲、`:154-170` 武器 spec、`:186-209` 弹丸（真实 `rng.float()` 每发一次）、`:215-235` 扫掠、`:254-262` 弹丸推进、`:284-304` 敌人 hit/击退、`:372-461` drone FSM | 唯一纯规则模块；不是完整 Core（`:3-7` 明写） |
| `src/entities/Player.ts` | `:17` 引入纯规则；`:177` `aimYawFromGrid`；`:226-236` `stepPlayerMovement` 结果直接写回 `wx/wy/dashTimer`；`:335-344` `buildWeaponSpec` 传给 `spawnProjectile`；`:360` `damageAfterArmor`；`:40-41` 仅 debug 镜像 | 旧内联移动/aim/spec/armor 公式已删；真实状态由纯结果驱动 |
| `src/entities/Enemy.ts` | `:10` 引入；`:100` `if (kind==='drone')` → `:101` `stepDroneAi` → `:132-150` `applyDroneStep` 写回真实状态/位置/攻击；`:127` 其他 kind 才走 `:157` `legacyStateMachine`；`:216/235/245` `axisSlideToward`；`:262` `rangedAttackDescriptor`；`:271-288` `resolveEnemyHit` 写回 `_hp`/位置 | **drone 分支唯一**；旧 `stateMachine`/`distanceTo` 内联公式删除；非 drone FSM 仍为 legacy 副本（C2） |
| `src/world/World.ts` | `:20` 引入；`:496-522` `createProjectileData` 每发调用（真实 `this.rng`），`lastProjectileData` 为**拷贝**；`:615-620` `advanceProjectile`；`:637` `projectileHitsTarget`；`:524` `spawnEnemyProjectile` 仍内联（C2）；`:783-802` `captureCheckpoint`/`restoreCheckpoint` 未改 | 弹丸创建/推进/扫掠旧内联体已删；存档无回归 |
| `src/ai-native/control.ts` | `:14-15` 委托 `screenVelocityToGridVelocity`/`gridDirectionToScreenDirection` 并用 `IsoMath.TILE_W/H`；`:72-80` 默认值不再硬编码 64/32 | F-09 修复；纯模块边界未破（`rules.ts` 无 Phaser） |
| `src/world/sim/rules.test.ts`（新增 302 行） | **11 例**（Tester 报告写「12 例」，实测 11；`grep -c '  it('`）；用真实 `MapGenerator(424242)`/`WEAPONS`/`ENEMY_STATS`/`RNG`/`GAME`，覆盖受阻移动、aim、pulse/scatter/plasma spec、真实 RNG 弹丸、扫掠/墙、drone FSM、armor/stun | 非「假规则」；但见 H-1：部分断言自证、无 old-vs-new parity |
| `src/world/sim/rewiring.test.ts`（新增 56 行） | 4 例静态字符串门禁：断言三个适配器 import `sim/rules`、旧公式串消失、control 用 IsoMath | 弱门禁；本轮以源码阅读 + 286 项 parity + 浏览器行为补足 |
| `tests/ai-native-world.spec.ts` | 新增第 9 个用例 `:1023-1139`：真实键盘移动、真实鼠标开火、真实 drone HP 下降（`:1130`），并读 `lastMoveStep/lastWeaponSpec/lastProjectileData/lastDroneStep/lastHitResult` | 不只验证镜像；仍属**夹具浏览器证据**（spawn 1 drone，声明在 `:1053`） |
| `docs/AI_NATIVE_WORLD_CONTROL.md` | 新增 §6.5 `:182-188`、§6.6 `:190-193`；明写 C1 不是权威核、C2/C3 义务；但 `:173` 旧行仍写「F-09 硬编码残留」与 `:174`「F-09 已修」冲突；`:185`「旧内联规则体已删除」措辞过宽；`AI_NATIVE_PHASE_REPORTS.md:167` 声称「覆盖旧全量回归」与 Tester §7「未重跑全量 35」不一致（见 H-2） | 边界声明基本正确，精度需修 |
| `docs/AI_NATIVE_PHASE_REPORTS.md` | 新增 C1 段 `:160-168`；明写 C2 固定 tick/RNG 归一/事件队列/parity 未完成、C3 外部 Agent 是 P2 完成条件、Signal 未实现 | 后续义务保留，未冒充完成 |

未变更：`src/systems/*`、`src/config/*`、`src/types/*`、`src/scenes/GameScene.ts`、`src/entities/Boss.ts`（`git diff --name-only 1aadd2e cdb594e -- src/systems src/config src/types` 为空）。

---

## 3. 重点核查结论

### 3.1 旧规则体真正去掉 / drone 分支唯一 — **通过**
- 适配器内旧串全部消失（`grep` 结果 `NONE`）：`const reduction = 1 - Math.min(0.75`、`const tx = sx / (IsoMath.TILE_W / 2)`、`const crit = this.rng.float() < spec.critChance`、`private segmentPointDistance(`、`const kb = 16 / GAME.PIXEL_TO_TILE`、`w.kind === 'scatter' ? 5 : 1`。
- `stepDroneAi` 只在 `Enemy.ts:101` 被 drone 分支调用；`:127` 的 `legacyStateMachine` 仅 `kind!=='drone'` 时执行，不再是 drone 的第二权威。
- **范围限定**：`Enemy.legacyStateMachine`（`:157`）、`Boss.hit` 自带 `0.6/(armor+120)/min2` 公式（`Boss.ts:153-155`）、`World.spawnEnemyProjectile`（`:524`）仍是 legacy 内联；这是 C2 合并对象，**不是 C1 的「旧函数+新 core」双 drone 权威**。

### 3.2 伤害 / armor / crit / 击退 / 扫掠 / 穿透 / 武器行为等价 — **通过（独立 parity 286 项）**
自建 `parity-probe.ts` 以父提交 1aadd2e 的精确内联公式逐值对照，0 失败：
- `damageAfterArmor` vs `Math.max(1, amount*(1-Math.min(0.75,armor/(armor+80))))`，6 armor × 6 amount。
- `buildWeaponSpec` vs 父 `Player.tryFire` 内联 spec，覆盖 `WEAPONS` 全部 key（pulse/scatter/plasma/arc），逐字段比对 `damage/speed/critBase/critDamage/critChance/pierce/lifetime/kind/magazine/shots/spread`；plasma `pierceCount+2`、scatter `shots=5` 保持。
- `createProjectileData` vs 父 `World.spawnProjectile` 内联：每把武器每发比对 `id/ownerId/side/pos/vel/damage/lifetime/radius/crit/pierce/hitSet`，并用**同一 seed 的两个 RNG** 断言 `rngOld.snapshot() === rngNew.snapshot()` → **每发恰好 1 次 `rng.float()`、顺序一致**；散射 5 发角度 `(i/(shots-1)-0.5)*spread*shots` 一致。
- `advanceProjectile` vs 父 `updateProjectiles` 内联（含 wall/bounds/lifetime）；`projectileHitsTarget`/`segmentPointDistance` vs 父扫掠公式。
- `resolveEnemyHit` vs 父 `Enemy.hit`（armor、stun 拦截、`hitFlash=0.15`、`kb=16/64`、墙阻挡 `isWalkable(...,0.4)`），3 armor × 2 stun × 2 walk。
- `stepPlayerMovement`/`axisSlide` vs 父 `applyIntent`（各向异性预算、dashTimer 递减后判 `<=0`、轴分离碰撞），4 组输入。
- `stepDroneAi` 关键转移 vs 父 `stateMachine`：idle→patrol、detect 双递减、attack 远程描述符/冷却、stun 双递减→chase、patrol 墙阻挡。
- 浏览器侧：C1 用例 `:1130` 断言真实 `enemy._hp < setup.enemyHp`；Tester 独立探针另证 pulse 击杀 drone、scatter 5 发、plasma pierce、drone 远程真实掉血（无 HP 写入）。

### 3.3 RNG 调用顺序 / 所有权 — **通过（C1 范围），C2 有坑**
- 父 `World.ts:498` 的 `this.rng.float() < spec.critChance` 移到 `sim/rules.ts:194` `input.rng.float()`，仍传 `World.rng` 实例（`World.ts:509`），每发一次、顺序不变；`killEnemy` 的两次 `rng.float()`（`World.ts:737-738`）未动。
- **C2 坑**：`World.rng` 仍由 World 持有；`spawnLoot` bob 默认 `Math.random()`（`World.ts:550`）、`killBoss` 掉落 `Math.random()`（`World.ts:753`）、`Boss` 召唤 `Math.random()`（`Boss.ts:142`）、`GameScene` 新局 seed `Math.random()`（`GameScene.ts:99`）都还在。C2 未拆分「玩法 RNG / 视觉随机」前不得宣称全玩法 seeded RNG、Replay 或 state hash。

### 3.4 存档不回归 — **通过**
- `src/systems`/`config`/`types` 与父提交零 diff；`World.captureCheckpoint` 仍 `cloneCheckpoint()` 深拷贝（`:791`），`restoreCheckpoint`（`:802`）未改；`SAVE_VERSION=2`、`finishRun` 死亡清 run、退出/刷新恢复 checkpoint 语义未动。
- 针对性 `tests/checkpoint.spec.ts` 5/5 PASS（含「death routes to Game Over and clears the run checkpoint」「resume reuses checkpoint id and restores HP」）；`runCheckpoint.test.ts` 2 例在 344 内；`tests/audit.spec.ts` 2/2 PASS（menu→fire→kill→loot→upgrade→pause→teleport、Boss 弹丸/灯光）。
- **残留**：F-08 `restoreCheckpoint(run)` 仍把入参 `run.player` 别名给活玩家（`World.ts:811`），线上 `GameScene` 用 `saveSystem.load()` 临时对象故当前安全；不是 C1 引入，保留 P2。

### 3.5 Node 测试非自证 / debug 快照不是第二权威 — **通过（有限制）**
- `rules.test.ts` 用真实 `MapGenerator(424242)`、`WEAPONS`、`ENEMY_STATS.drone`、`RNG`、`GAME`，不是假规则；`rewiring.test.ts` 是弱字符串门禁。
- **但**仓库内**没有**「父提交旧公式 vs 新纯函数」的永久 parity 测试；`rules.test.ts:151-152`（`step.velocity` 对齐同模块 `screenVelocityToGridVelocity`）、`:202`（`data.damage` 对齐自身公式）属自证式断言。本轮用独立 `parity-probe.ts`（286 项）补足，但 C2 应把它固化进仓库（见 H-1）。
- debug 镜像 `Player.lastMoveStep/lastWeaponSpec`、`Enemy.lastDroneStep/lastHitResult`、`World.lastProjectileData`：`grep -rn` 显示**只有定义与赋值**，生产代码零读取；`lastProjectileData` 是 `pos/vel/hitSet` 拷贝（`World.ts:518-520`）；C1 浏览器用例同时断言真实位置/弹丸/HP（`:1060-1064`、`:1121-1130`）。**不是第二权威**。C2 外部 Agent 接入前应移除或 dev-gate 这些字段。

### 3.6 344 单测 / 9 浏览器证据的声称边界 — **已核实**
- `npm test`：19 文件 / **344 tests**（其中新增 `rules.test.ts` 11、`rewiring.test.ts` 4 = 15；Tester 报告写 `rules.test.ts 12 例` 为笔误）。包含旧 329 项，无删减。
- 冻结 preview 5331：`tests/ai-native-world.spec.ts` **9/9 PASS** = 控制流 1 + 五视口 5 + F-04/F-05 覆盖层 1 + F-01/F-02 感知 1 + **C1 新用例 1**。0 console/page error。
- **边界**：这 9 项是渲染 Phaser World + 页内键鼠 + 已声明夹具（i-frames / addXp / spawnEnemy / 第二武器 / 合成伤害 / C1 单 drone），**不是**真实战斗通关、不是外部 LLM/Codex/MCP Agent、不是 Headless World/Replay、不是真人验收。Tester 另附无夹具自然受伤/死亡探针属独立证据类，但同样不是真人/外部 Agent。全量 35 项 E2E、跨浏览器/触屏/高 DPI 未重跑（按「勿重复无关全量」）。

---

## 4. 阻断 / 高优先 / 限制

### 阻断
**无**。C1 目标（抽取规则体 + 即时接线 + 行为等价）在冻结提交上成立；C2 缺失按 Lead 裁定不判 C1 失败。

### 高优先（非阻断，须带入 C2 / P1 收尾）
- **H-1 测试强度**：仓库缺永久 old-vs-new parity harness；`rewiring.test.ts` 仅字符串门禁，`rules.test.ts` 有自证断言。修复条件：把本轮 `parity-probe.ts` 固化为 `src/world/sim/parity.test.ts`，并加 Node/Rendered canonical parity（C2 验收项）。
- **H-2 文档精度**：`docs/AI_NATIVE_WORLD_CONTROL.md:185`「旧的内联规则体已删除，没有保留两套权威」措辞过宽——`Enemy.legacyStateMachine:157`（非 drone FSM 副本）、`Boss.hit`（自带公式）、`World.spawnEnemyProjectile:524` 仍内联；`:173` 与 `:174` F-09 状态自相矛盾；`docs/AI_NATIVE_PHASE_REPORTS.md:167` 写「覆盖旧全量回归」，但 Tester §7 明言未重跑全量 35，本轮独立也只跑 9 + 7 针对性。修复条件：改为「已抽取的规则体在适配层中唯一；下列 legacy 仍在 C2 合并清单」，删/改 `:173`，并把 `:167` 改为「P1 五视口 + 针对性存档/旧回归，未重跑全量 35」。
- **H-3 debug 镜像**：`last*` 目前证据-only，但 C2 集中状态后若继续保留易被误用为第二权威。修复条件：C2 接入外部 Agent 前移除或 `DEV` 门禁。
- **H-4 C2 状态集中坑（重点）**：
  1. **不要做「镜像状态」**：`SimulationState` 必须成为唯一写源，Phaser 对象只读渲染；否则 Player/Enemy/World 上残留的可变字段会与 Core 分叉，正是 C1 文档 `:186` 警告的「两套权威」。
  2. **RNG 归一**：`World.rng` 现同时服务 crit 与掉落，且 4 处 `Math.random()` 仍在（见 3.3）。C2 必须显式拆分玩法/视觉 RNG 并把 RNG state 纳入快照；在此之前不宣称 replay/stateHash。
  3. **固定 tick**：`GameScene.update()` 仍变长 `dt`（`GameScene.ts:362`）。引入 60Hz 累加器时必须用本轮 parity 式断言守住移动/弹丸/drone FSM 逐值等价，避免「重构即改平衡」。
  4. **合并剩余 legacy**：`legacyStateMachine`、`Boss.hit`、`spawnEnemyProjectile`、其他 enemy kind 必须并到同一规则入口；不能只把 drone 搬完就宣布 Core 完成。
  5. **存档契约**：不得改 `SAVE_VERSION=2` / key / `finishRun` 死亡清 run / 退出刷新恢复 checkpoint；顺带修 F-08 restore 入参别名。
  6. **事件/调试**：`SimEvent[]` 应是提交后有序事实，`last*` debug 镜像不得进入事件权威；`window.__game`（F-03）生产暴露仍在，外部 Agent 通道必须走正式 Gateway/MCP，不能靠页内全局。
  7. **验收隔离**：developer 正并发改 `src/world/sim/core.ts`（共享工作树已出现 `?? src/world/sim/core.ts`）；C2 独立验收仍须 `git archive` 冻结快照，禁止把 WIP 当已通过。
  8. **不重定义阶段**：C3 真实外部 Agent 经正式通道战斗仍是 **P2 完成条件**（文档 `:188`）；Signal 正式接入仍是总任务义务（§6.6）；不得用本地 demo / 浏览器自动化 / 假 Headless 冒充。
- **H-5 P1 三项收尾未包含**：cdb594e 中 `docs/AI_NATIVE_WORLD_CONTROL.md:14,35,68,99,162` 的「当前房间即可见 / canWalk 直接 isWalkable」残留、F-07 感知 E2E 夹具行缺失、`tests/ai-native-world.spec.ts:357` `movingSamples>2` flaky 断言**都还在**。P1 收尾已派 developer，**本单不等待、不把将来修复当已通过**；它们不是 C1 阻断项。

### 限制（不构成阻断）
1. C1 仅抽取并接线 Player / Enemy(drone) / World 的既有规则体 + control 速度预算；**不是** SimulationCore / 固定 tick / 事件队列 / RNG 所有权 / Headless / 跨端 parity / 外部 Agent。
2. 首片 `drone + pulse`；`buildWeaponSpec`/`createProjectileData`/`advanceProjectile`/`projectileHitsTarget`/`resolveEnemyHit` 对所有武器/非 Boss 敌人共用，scatter/plasma 由 parity + Tester 探针覆盖；**Boss 与其他 enemy kind 仍 legacy**。
3. `spawnEnemyProjectile` 内联、`Boss.hit` 自带护甲、`legacyStateMachine` 副本仍在（C2）。
4. debug 镜像只在测试读，未发现驱动真实状态；但仓库无永久 parity 测试。
5. 浏览器仅 Chromium + 5 桌面视口；未跑全量 35、跨浏览器/触屏/高 DPI；500kB chunk 警告为基线既有。
6. `window.__game` F-03、F-08 restore 别名、F-09 已修但文档旧行未清；R-01/R-02/R-05/R-06/R-09 全部保留。
7. 结论只绑定 `cdb594e`；共享工作树已前进到 `ff13ce3…` + C2 WIP，未纳入。

---

## 5. 复现

```bash
cd D:/Project/LAST_SIGNAL
SNAP=/d/Project/lastsignal-c1-review-cdb594e
rm -rf "$SNAP" && mkdir -p "$SNAP"
git -c core.autocrlf=false -c core.eol=lf archive cdb594e | tar -x -C "$SNAP"
cmd //c "mklink /J D:\Project\lastsignal-c1-review-cdb594e\node_modules D:\Project\LAST_SIGNAL\node_modules"
cd "$SNAP"
npm run typecheck; npm test
npm run build -- --outDir reviewer-dist
# 独立 parity
cp /d/Project/LAST_SIGNAL/reports/ai-native-02/reviewer/c1/parity-probe.ts reviewer-parity-probe.ts
npx vite-node reviewer-parity-probe.ts
# 浏览器（专属端口）
node node_modules/vite/bin/vite.js preview --outDir reviewer-dist --port 5331 --strictPort
PORT=5331 LS_AI_EVIDENCE_DIR=<own>/evidence-c1-p1 npx playwright test tests/ai-native-world.spec.ts --workers=1
node node_modules/vite/bin/vite.js --port 5333 --strictPort
PORT=5333 npx playwright test tests/checkpoint.spec.ts tests/audit.spec.ts --workers=1
```
