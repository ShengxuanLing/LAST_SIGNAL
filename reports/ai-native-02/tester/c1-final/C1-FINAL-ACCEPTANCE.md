# AI-NATIVE-02 C1 独立验证报告（Tester）

- Worker `y6en9ua8phanll8cqi8dd8ru`，专属目录 `reports/ai-native-02/tester/c1-final/`
- 目标冻结提交：`cdb594ed6b55dd7ac3a801dea9679ceabca2a66c`（父 `1aadd2e04ffaa2a367c2b382004aea305b61f3ec`），分支 `feat/ai-native-world-integration`
- 隔离方式：`git archive cdb594e` → `D:/Project/AI-NATIVE-02-snapshots/cdb594e`（仅该提交已跟踪文件，`node_modules` 用 junction 指向仓库），在该快照内自建产物、专属空闲端口 **5284**。**未切共享分支、未改生产源码/已有测试/配置、未读混合 WIP**。
- 结论：**PASS，无阻断**；限制见 §7。C1 不是完整 Core / Headless / parity / 外部 Agent。

## 1. 冻结与隔离事实

| 项 | 值 |
| --- | --- |
| 提交/父 | `cdb594e…` / `1aadd2e…` |
| 快照目录 | `D:/Project/AI-NATIVE-02-snapshots/cdb594e` |
| 关键文件 MD5 | `rules.ts e6d234ac…`、`rules.test.ts 860b3a02…`、`rewiring.test.ts e39b2945…`、`Enemy.ts 59c0b5c7…`、`Player.ts 416b44a5…`、`World.ts 9bfbcb62…`、`control.ts 780c8cf4…`、`tests/ai-native-world.spec.ts 95649e5d…`、`package.json c10e0913…`、`playwright.config.ts e3839101…`（完整见 `00-frozen-state.log`，收尾复核一致见 `09-final-state.log`） |
| 产物 | `npx vite build --outDir …/c1-final/frozen-dist --emptyOutDir`；`index.html cda8290d…`、`main-DV54l372.js a3dcb216…`、`enemies-DECEO9yH.js e140d1ed…`（`04-frozen-artifacts.log`） |
| 端口 | 启动前 `netstat` 确认 **5284 FREE**；我自己的 `vite preview --port 5284 --strictPort`；未触碰 5173/5199 等他人端口，结束时只停止我自己启动的 PID 824 |
| 活工作树 | 复核期间 developer 已开始 C2 WIP（`09-final-state.log`：M `Enemy.ts`/`Player.ts`/`World.ts`/`sim/rules.ts`、?? `src/world/sim/core.ts`），但我用的 git 提交快照文件哈希与产物哈希首尾完全一致 → 结论只绑定 `cdb594e`，**未混入 C2/WIP，也未混用 1aadd2e / 2d78e80 证据** |

## 2. Gate 一行式（完整输出均在日志）

- PASS `npx tsc --noEmit`（快照）退出码 0 → `01-typecheck.log`
- PASS `npm test`（快照）**19 files / 344 tests** → `02-unit.log`
- PASS `npx vite build --outDir "…/c1-final/frozen-dist" --emptyOutDir` 24.32s（保留基线 500kB chunk 警告）→ `03-build-frozen.log`
- PASS `PORT=5284 LS_AI_EVIDENCE_DIR=…/c1-final/evidence npx playwright test tests/ai-native-world.spec.ts --reporter=line --workers=1 --output=…/c1-final/pw-out` → **9 passed (1.8m)** → `05-playwright-final.log`
- PASS `node …/probe-c1-rules.mjs http://localhost:5284/`（独立渲染 World 规则探针，夹具已声明）→ `06-c1-rules-probe.log` + `c1-rules-log.json`
- PASS `node …/probe-normal-run.mjs http://localhost:5284/`（复用上轮**无夹具**短演示）→ `07-normal-run-probe.log` + `normal-run-log.json`
- PASS `node …/probe-pause-off.mjs http://localhost:5284/`（无夹具，干净复核暂停 OFF）→ `08-pause-off-probe.log` + `pause-off-log.json`

## 3. 9 个 P1+C1 用例（--workers=1，端口 5284，五视口）

控制流 1 + HUD `1920x1080/1366x768/1280x720/1024x768/800x600` 5 + F-04/F-05 覆盖层归属 1 + F-01/F-02 感知边界 1 + **C1 新用例** `C1: rendered World applies the shared pure rules (movement, aim, pulse fire, drone FSM, hit)` 1 = **9/9 PASS**，0 console/page error。

五视口实测（`evidence/operation-log-hud-*.json`）：1920x1080 (1.5 / 19.5px)、1366x768 (1.067 / 13.87px)、1280x720 (1 / 13px)、1024x768 (0.8 / 13.6px)、800x600 (0.625 / 10.625px)；逻辑恒 1280x720。**实际打开查看** `evidence/hud-ai-800x600.png`：左下 `ESC PAUSE · ANY MOVE / FIRE / F TAKES HUMAN CONTROL` 与右上控制四行均完整可读、无裁切/遮挡。

## 4. 纯规则 344 单测与“假规则 / debug 镜像”检查

- C1 新增 `src/world/sim/rules.ts`（461 行纯 TS：无 Phaser / DOM / 墙钟 / `Math.random`；用真实 `WEAPONS` / `ENEMY_STATS` / `GAME` / `IsoMath` / `RNG` / `MapGenerator`），`rules.test.ts`（302 行，12 例：真实生成房间的 `axisSlide` 拒墙、`stepPlayerMovement` 速度/冲刺、`aimYawFromGrid`、pulse spec 与 scatter/plasma 回归、真实 RNG 弹丸、swept hit + `resolveEnemyHit` 击杀 drone / stun / armor、drone FSM idle→patrol→detect→chase / 墙阻挡 / 远程攻击 / stun 双递减），`rewiring.test.ts`（4 例静态源码接线检查）。
- **不是假规则**：`Player.applyIntent()` 把 `stepPlayerMovement()` 的 `position/velocity/dashTimer` 直接写回 `wx/wy/dashTimer`；`Player.tryFire()`/`hurt()` 用 `buildWeaponSpec()` / `damageAfterArmor()`；`Enemy.update()` 对 drone 调 `stepDroneAi()` 并由 `applyDroneStep()` 写回真实状态/位置，`hit()` 用 `resolveEnemyHit()` 写回 `_hp` 与位置；`World.spawnProjectile()` 对每发调 `createProjectileData()` 并生成真实 Phaser 弹丸；`updateProjectiles()` 用 `advanceProjectile()` / `projectileHitsTarget()`。旧内联公式在 Player/Enemy/World 中已删除（Boss 仍保留自己的独立护甲公式，非 C1 范围）。
- **不是只验证 debug 镜像**：C1 浏览器用例确实读 `lastMoveStep` / `lastWeaponSpec` / `lastProjectileData` / `lastDroneStep` / `lastHitResult`，但这些字段都是**同一个纯规则结果**的快照，该结果同时驱动真实位置 / 弹丸 / HP；用例还断言了真实 drone HP 下降至死亡（`enemyHp=0`、`stillInWorld=false`）。`rewiring.test.ts` 是较弱的字符串接线门禁，我另以源码阅读 + 独立渲染探针补足运行时证据。
- **本轮独立补强**（`06-c1-rules-probe.log`）：直接读真实 `world.projectiles`（真实弹丸对象）而不仅镜像，验证 5 发散射弹、plasma pierce、drone FSM 状态与真实玩家掉血。

## 5. drone / pulse 伤害、墙碰撞、旧武器 scatter / plasma（独立探针）

`probe-c1-rules.mjs` 明确声明夹具：spawn 2 只 drone、给玩家加入 scatter/plasma 两把武器并 equip；**不刷新无敌帧、不写 HP/坐标、不调 addXp/hurt**。

| 项 | 实测 | 判定 |
| --- | --- | --- |
| pulse 打 drone | 真实 drone HP 28 → 被击杀并从 `world.enemies` 移除；飞行的真实玩家弹丸 1 发；`spec damage=12 / speed=11.25(=720/64) / lifetime=0.7222(=520/720) / shots=1`；C1 用例日志 `lastHit.blocked=false, enemyHp=0, stillInWorld=false` | ✅ |
| 旧武器 scatter | 一次开火生成 **5 发真实玩家弹丸**、5 个不同角度、角跨度 **2.5 rad**(=spread 0.5×5)、`magazine=8` 且 ammo 8→7；`buildWeaponSpec` shots=5 | ✅ |
| 旧武器 plasma | `spec.pierce = pierceCount 0 + 2 = 2`、真实弹丸 `pierce=2`、`speed=5.9375(=380/64)`、`damage=42`、单发；`buildWeaponSpec` 单测断言 3+2=5 | ✅ |
| 墙碰撞 | 人类按住 `KeyD` 16×100ms 采样：16/16 `walkable=true`、maxStep 0.567（无穿墙/瞬移）；Node 单测 `axisSlide` 在真实生成地图上拒绝墙格、接受地板；无夹具自然运行 93 采样全 walkable、maxStep 1.951 | ✅ |
| drone FSM / 远程伤害 | 真实 drone 状态 `patrol → detect → attack`、`lastDroneStep` 非 null、观察到敌方弹丸 1 发、玩家 HP **93→86**（drone 远程真实伤害，无任何 HP 写入） | ✅ |

## 6. 无夹具短冒烟（接管 / 受伤 / 自然死亡）

`probe-normal-run.mjs`（复用上轮，无夹具：不刷新 i-frames、不写 HP/坐标、不注入 seed、真实 `NEW RUN → ESC → AI CONTROL ON → ESC`）：
- 93 次 200ms 采样，真实 HP **100 → 0** 并自然进入 `GameOverScene`（seed 561091355，0 console/page error）；AI 动作 `ENGAGE/TRAVEL/MOVE`、93 采样中 AI 持有、combat/elite 两房间、2 次自然升级弹层。
- 真实点 `RETRY SAME SEED` → 新局 `owner=human / aiEnabled=false / actionCount=0 / takeoverCount=0 / hp=100`。
- 三种真实输入夺回全 PASS：`KeyD` 移动 / 鼠标开火 / `KeyF` 交互，`reason=human-input`。
- 墙碰撞 93/93 walkable、同房间 90 步 max 1.951、均值 0.231。
- 复用探针的 `pauseOff.pass=false` 是**时序假象**：`pause-off-enable-ai` 时 `active=["GameScene","LevelUpScene"]`，ESC 被升级弹层消费、ON/OFF 标签为空、点 640,540 落到升级卡导致夺回。已用干净的 `probe-pause-off.mjs` 复验：`AI CONTROL: ON` → 暂停冻结 → 点 OFF → `reason=pause-menu` → 恢复后 2s 仍 human、不自抢，**PASS**。

> 证据性质：以上全部是自动化 Playwright + 页内键鼠；本地确定性控制器不是外部 LLM/Codex/MCP Agent，Phaser 浏览器测试不是 Headless World/Replay。spec 用例 1/7 的 i-frames（+第二把武器）与我的 C1 探针的 drone/scatter/plasma 注入均为**声明过的夹具**；无夹具短冒烟是真实受伤/自然死亡，但不宣称 P2 战斗胜利或真人证据。

## 7. 限制与未覆盖（不构成阻断）

1. C1 只抽取并接线了 Player / Enemy(drone) / World 的规则体；**不是**集中式 SimulationCore / 固定 tick / 事件队列 / RNG 所有权 / Headless World / 跨端 parity / 外部 Agent（C2+ 范围）。Boss 护甲与其他敌人种类仍走各自 legacy 逻辑。
2. `rewiring.test.ts` 是静态源码字符串门禁，单看较弱；但源码实际接线与渲染运行时行为已独立验证。
3. C1 浏览器用例对移动/FSM 的断言主要经由 debug 快照字段；真实移动/FSM/伤害由我的独立探针与 P1 控制流用例补足，未发现“只验证镜像而不改真实状态”的伪造。
4. 仅 Chromium + 5 个桌面视口；未重跑与 C1 无关的全量 35 项 E2E（避免内存/端口干扰）；未做跨浏览器 / 触屏 / 高 DPI 验收。
5. `npm run build` 的 500kB chunk 警告为基线既有；生产构建 minify 类名，用例已用 Phaser scene key。
6. 800x600 最小物理字高 10.625px，属小字号但实测可读。
7. 结论只适用于 `cdb594e`；复核期间活工作树已出现 C2 WIP，未纳入验收。

## 8. 复现步骤

```bash
cd D:/Project/LAST_SIGNAL
git rev-parse cdb594e                     # cdb594e...
mkdir -p D:/Project/AI-NATIVE-02-snapshots/cdb594e
git archive cdb594e | tar -x -C D:/Project/AI-NATIVE-02-snapshots/cdb594e
powershell -NoProfile -Command "New-Item -ItemType Junction -Path 'D:\Project\AI-NATIVE-02-snapshots\cdb594e\node_modules' -Target 'D:\Project\LAST_SIGNAL\node_modules'"
cd D:/Project/AI-NATIVE-02-snapshots/cdb594e
npx tsc --noEmit && npm test
npx vite build --outDir "D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c1-final/frozen-dist" --emptyOutDir
node node_modules/vite/bin/vite.js preview --outDir "<上述 frozen-dist>" --port 5284 --strictPort
# 另一终端（快照目录）
PORT=5284 LS_AI_EVIDENCE_DIR="D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c1-final/evidence" \
  npx playwright test tests/ai-native-world.spec.ts --reporter=line --workers=1 \
  --output="D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c1-final/pw-out"
# 仓库根执行三支独立探针
cd D:/Project/LAST_SIGNAL
node reports/ai-native-02/tester/c1-final/probe-c1-rules.mjs http://localhost:5284/
node reports/ai-native-02/tester/c1-final/probe-normal-run.mjs http://localhost:5284/
node reports/ai-native-02/tester/c1-final/probe-pause-off.mjs http://localhost:5284/
# 视觉复核：打开 evidence/hud-ai-800x600.png
```
