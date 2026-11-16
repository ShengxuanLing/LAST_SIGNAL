# AI-NATIVE-02 P1 条件项修复 · 独立复核

- 复核对象：冻结提交 **`1aadd2e04ffaa2a367c2b382004aea305b61f3ec`**（父 `2d78e8057f8e8729c30eaa083fac8dc6360df34f`），10 文件补丁；**不是**共享工作树的后续 C1 代码。
- 冻结方式：`git -c core.autocrlf=false -c core.eol=lf archive 1aadd2e | tar -x -C D:/Project/lastsignal-p1fix-review-1aadd2e` + `node_modules` junction；全库 tracked 文件 MD5 与 `git show 1aadd2e:<path>` 逐字一致（`ALL_TRACKED_FILES_MATCH`，见 `gate-fix-git-state.log`）。默认 `git archive` 会因 `core.autocrlf=true` 转成 CRLF，故显式关闭。
- 共享工作树状态：复核结束时 `HEAD=cdb594ed6b55dd7ac3a801dea9679ceabca2a66c`（developer 的 C1 提交 + WIP：`M src/entities/{Enemy,Player}.ts`、`M src/world/World.ts`、`?? src/world/sim/*`）。**该 WIP 一行未用于验收**；所有 gate 均从上述冻结快照运行。见 `gate-fix-git-state.log`。
- 报告/日志：`reports/ai-native-02/reviewer/p1-fixes/`。未改生产源码/测试/配置，未切共享分支、未提交/合并，未占用 5173/5199/5281/5283，未强杀无关进程。
- 红线遵守：本地 controller ≠ 外部 Agent；Phaser/Playwright ≠ Headless；i-frames/合成伤害/临时地形变更 ≠ 真实战斗；开发者自测 329/35/8 不作为本结论。

---

## 0. 最终 P1 判定

**P1 PASS（有条件）**。

- F-01（有界 `canWalk`）、F-04（背包/升级/暂停 UI 归属）、F-05（移动/开火/F 接管）、F-06（800×600 字号）**关闭**。
- F-02 的**代码/测试关闭**，但文档尚残留「当前房间即可见 / canWalk 直接来自 isWalkable」旧口径 → **文档部分未关闭**。
- F-07 证据范围表**已建立但部分关闭**：缺「感知边界 E2E」专用夹具行与 commit 归属说明。
- 另发现一个**父提交既有**的 flaky 断言（`movingSamples > 2`），不是 1aadd2e 引入，但使「35/35」不可稳定复现；不阻断本次修复判定，须单独修。
- F-03（`window.__game` 生产暴露）、F-08、F-09 不在本单范围，保持 P2/P4 未处理，不得因本轮 PASS 删除。

条件（完成前不得宣称「P1 全量最终签字」）：①修 F-02 文档残留行；②补全 F-07 表/spec 夹具声明与 commit 归属；③稳定既有 flaky 断言。三项均为文档/测试可靠性，非产品功能回归。

---

## 1. 独立 Gate（完整输出在 `reports/ai-native-02/reviewer/p1-fixes/`）

| 命令（均在冻结快照 cwd） | 结果 | 日志 |
| --- | --- | --- |
| `npm run typecheck` | **PASS** exit 0 | `gate-fix-typecheck.log` |
| `npm test` | **PASS** 17 files / **329 tests** | `gate-fix-unit.log` |
| `npm run build -- --outDir reviewer-dist` | **PASS** exit 0（既有 >500kB 警告） | `gate-fix-build.log` |
| `npx vite build --config vite.mcp.config.ts --outDir reviewer-mcp-dist` | **PASS** exit 0 | `gate-fix-mcp-build.log` |
| 冻结生产构建 + 专属 5323：`PORT=5323 LS_AI_EVIDENCE_DIR=... npx playwright test tests/ai-native-world.spec.ts --workers=1` | **PASS** **8/8**（含新增 overlay / perception 两例） | `gate-fix-playwright-p1.log` |
| 专属 dev 5321 回归 run1：9 个 PORT 感知 spec | **FAIL** 32/33，唯一失败为既有 flaky 断言：`expect(movingSamples).toBeGreaterThan(2)` → `Expected: > 2 / Received: 2` (`tests/ai-native-world.spec.ts:336`) | `gate-fix-playwright-regression.log` |
| 同一命令 run2 | **PASS** **33/33** | `gate-fix-playwright-regression-run2.log` |
| 6 次重复同一 control-flow 用例：fix 1aadd2e | **5 passed / 1 failed**（同一 flaky 断言） | `gate-fix-repeat6.log` |
| 6 次重复同一 use case：父 2d78e80 对照 | **5 passed / 1 failed**（同一 flaky 断言） | `gate-parent-repeat6.log` |
| 独立感知探针（自建 `probe-perception.mjs`，5323） | **PASS** 负向全通过 | `probe-perception.log` |
| 独立 AI 行为对照探针（fix / parent） | **PASS**（无 BLOCKED、远探针全拒、动作分布近似） | `probe-ai-movement-fix.log`、`probe-ai-movement-parent.log` |

说明：
- `tests/boss-room.spec.ts`(硬编码 5173)、`tests/canvas.spec.ts`(硬编码 5199) 因并发 C1 与端口隔离边界未独立重跑；二者不在 10 文件内，developer 全量 35/35 仅为自测交叉核对。已独立覆盖其余 33 项。
- run1 失败不是环境串端口：两次回归都从冻结快照的 5321 dev server 启动并校验 `/src/main.ts` 可用；重复实验在冻结 **preview** 5323 上同样 1/6 失败，父提交同样 1/6 失败。
- 全部端口（5321/5323/5327）跑完已释放；`5173/5199/5281/5283` 未占用。

---

## 2. 逐项关闭结论

### F-01 `canWalk` 有界碰撞 oracle — **关闭**
- 实现：`src/ai-native/worldPerception.ts:17-24`（radius 12 / probe 1.5 / LOS step 0.25）、`:78-84` `createLocalProbe()`：非有限 → 超 1.5 tiles → 未探索 一律 `false`，**不调用** `isWalkable`；`src/world/World.ts:191-196` 用 `createLocalProbe` 替换原全图 `isWalkable` 闭包；`src/ai-native/localController.ts:33-39` 契约注释同步。
- 负向测试：`src/ai-native/worldPerception.test.ts:21-26`（远距）、`:70-87`（远地板/远墙同值 `false` + `calls===0` + NaN/±Inf）、`:55-68`（近距合法探针仍可用）；`tests/ai-native-world.spec.ts:862-993` 正式 World E2E 断言 `canWalkFarFloor === canWalkFarWall === false`、`explored-but-far=false`、`nonFiniteRejected=true`、近距 `true`。
- 独立复核证据：`probe-perception.log` → `farFloor.canWalk=false`、`farWall.canWalk=false`、`nonFinite=[false,false,false]`、`near.canWalk=true`；`gate-fix-playwright-p1.log` 8/8。
- 结论：远距/墙后/未探索/非有限查询统一拒绝且不泄漏地形比特；**F-01 关闭**（作用域为 controller 输入投影；F-03 页面级边界另计）。

### F-02 有界感知（半径 + 已探索 + LOS） — **代码关闭 / 文档部分未关闭**
- 实现：`src/ai-native/worldPerception.ts:46-63` `gridLineOfSight()`；`src/world/World.ts:202-230` `roomIdAt/isExploredCell/isOpaqueCell/isPerceivable`；`src/world/World.ts:238-269` 敌人/Boss/portal 全部经 `isPerceivable`；`src/ai-native/worldObservation.ts:79-102` 字段改 `perceivedActors`、增 `visibilityBasis`/`perception`，`portal` 丢 `targetRoom`，`boss` 无 `phase`。**不再以 `spawnRoom===currentRoom` 当可见**。
- 负向测试：`worldPerception.test.ts:28-42`（墙后、未探索）、`:44-52`（非有限）；`worldObservation.test.ts:37-51`（同房间墙后排除、他房追入可见）、`:53-62`（无 phase）、`:64-72`（无 targetRoom、portal 隐藏）、`:74-87`（无 seed/map/内部字段）；E2E `tests/ai-native-world.spec.ts:975-993`（远/墙后/未探索/Boss/portal/near 全断言）。
- 独立复核证据：`probe-perception.log` → `visibilityBasis=grid-radius+explored+line-of-sight`、`requiresExplored/requiresLineOfSight=true`、`hiddenUnexplored=false`、`hiddenExploredButFar=false`、`nearVisible=true`、`behindWall=false`、`bossNear=true/bossFar=false`、`portalNear=true/portalFar=false`、`hasTargetRoom=false`、`hasPhase=false`；`evidence-p1/operation-log-perception-bounds-1280x720.json` 同值。
- **文档残留（未关闭）**：`docs/AI_NATIVE_WORLD_CONTROL.md`（1aadd2e 版本）仍写过时口径：
  - `:14` 「`World.intentView()`（白名单观察）」
  - `:35` 图节点「合法可见观察白名单」
  - `:68` 「AI 只能看到**当前房间**与传送门位置」（与「他房追入可见 / 同房间墙后不可见」矛盾）
  - `:99` 「`canWalk(x,y)` // 由 `World.isWalkable(x,y,0.5)` 提供」（实际是 `createLocalProbe`）
  - `:162` R-04 行「保留自身 HP、**当前房间敌人**」
  这些与 `worldObservation.ts:1-12`、`AI_NATIVE_WORLD_CONTROL.md:104-115,148-149` 的新口径冲突。修复条件：统一改为「有界感知投影 / perceivedActors / ±1.5 tiles 局部探针」，删「当前房间即可见」。
- 另注：E2E 的 `hiddenVisibleUnexplored=false` 同时被「半径 >12」解释，单独看不能证明 explored 过滤；该过滤由 `worldPerception.test.ts:36-42` 在半径内目标证明。建议补一条「近距但未进入房间」E2E 负例，避免断言被半径掩盖。

### F-04 背包 / 升级 / 暂停 UI 归属 — **关闭**
- 实现：`src/scenes/GameScene.ts:640-650` `toggleInventory()` 补 `control.pause()` + `clearHeldInput()` + `fireHeld=false` + `refreshHud()`；`:225-235` `pointerDownOnUi()` 用 `hitTestPointer` 区分 UI 点击；`:237-243` `takeoverFromHumanInput()`；`:508/:524/:605/:614/:626` 在升级开/关、暂停/恢复、AI 开关时显式 `refreshHud()`，F-10 的 HUD 停留 `AI` 问题一并消除。
- 证据：本轮 `evidence-p1/operation-log-overlay-ownership-1280x720.json` → `inventory-open: mode=PAUSED, authorityPaused=true, fireHeld=false`；`ui-equip-click: weaponKey=scatter, owner=ai, fireHeld=false`；`inventory-close-no-takeover: owner=ai`；`levelup-card-ui-click: owner=ai`；`pause-settings-ui-click: owner=ai, settingsOpened=true`；`inventory-key-takeover / inventory-f-takeover / inventory-pointer-takeover / levelup-KeyF-takeover / levelup-pointer-takeover` 均 `owner=human` 且关闭后不自抢。`gate-fix-playwright-p1.log` 第 7 例 PASS。
- 结论：背包/暂停/升级覆盖层都冻结 authority、清残留输入、UI 点击归 UI、关闭后不自动回切 AI；**F-04 关闭**。

### F-05 移动 / 开火 / F 接管 — **关闭**
- 实现：`src/scenes/GameScene.ts:155-161` 暂停态 `keydown-F` 改为 `takeoverFromHumanInput()` 且不交互；`:169-178` 非 UI `pointerdown` 触发接管（UI 点击早退）；`:182-188` W/A/S/D/SPACE 覆盖层内接管；HUD `:298-306`（`txtHelp` 在 `:306`）文案改 `ANY MOVE / FIRE / F TAKES HUMAN CONTROL`。
- 证据：同上 overlay log 的 5 个 takeover 步骤；`gate-fix-playwright-p1.log` 8/8；第 1 例 `human-takeover`/`levelup-takeover` 仍 PASS。
- 结论：覆盖层期间移动键、F、非 UI 鼠标均可夺回且 overlay 不关闭；UI 卡片/菜单/EQUIP 点击不误判为开火；**F-05 关闭**。

### F-06 800×600 小窗口字号 — **关闭（含独立人工判读）**
- 实现：`src/scenes/GameScene.ts:53-60,253-303` 紧凑视口（`scale<0.85`）放大右列/提示逻辑字号到 17/16px、行距拉开、提示色 `#8fb8c8`；`tests/ai-native-world.spec.ts:655-672` 断言改名为几何检查（`≥10 CSS px`），`geometryOnly:true, readabilityClaim:false`。
- 独立实测（本轮 `evidence-p1/`）：`operation-log-hud-800x600.json` → `scale=0.625`、最小状态行 `txtAgentLink 10.625 CSS px`、提示行 `10 CSS px`、色 `#8fb8c8`、文案含 `ANY MOVE / FIRE / F TAKES HUMAN CONTROL`；五视口最小状态行 19.5 / 13.87 / 13 / 13.6 / 10.625 CSS px，提示 21 / 14.93 / 14 / 12.8 / 10。
- 独立看图：已查看本轮 `evidence-p1/hud-ai-800x600.png`（原生 800×600）：右列 7 行与左下提示完整、无裁切/重叠、字明显放大、提示高对比，**可辨，无需放大**。这是本 Reviewer 的独立判读，不是开发者看图。
- 结论：8.125px 下限已提升到 10/10.625px，几何与人工判读均满足；**F-06 关闭**。低优先残留：`setupHud()` 只在 create 时按 `window.innerWidth` 计算布局，运行中 resize 不重排（不影响本单五视口验收）。

### F-07 证据范围表 — **部分关闭**
- 已建立：`docs/AI_NATIVE_PHASE_REPORTS.md:147-155` 五行表，区分「开发者夹具证据 / 独立 Tester 无夹具证据 / 外部 Agent 未实现」；`tests/ai-native-world.spec.ts:14-20` 头部声明夹具；`docs/AI_NATIVE_WORLD_CONTROL.md:204` 两类证据说明。Tester 无夹具探针文件真实存在且无 `invuln/addXp/spawnEnemy` 注入（只读核对 `reports/ai-native-02/tester/p1-final/probe-*.mjs`）。
- **未关闭点**：
  1. 新增的 `tests/ai-native-world.spec.ts:862-993` 感知边界 E2E 使用额外夹具：`spawnEnemy`、`w.enteredRooms.add(other.id)`、**临时把地砖 `type` 改成 `wall`**、`spawnBoss` + 改 `boss.wx/wy`、改 `portal.wx/wy`、固定 seed；该用例**没有** `record('evidence-fixture', ...)`（对比 `:241`、`:688` 有），`operation-log-perception-bounds-1280x720.json` 只有 `perception-probe` 一步；spec 头部 `:14-20` 与阶段报告表 `:151` 也未列出这些状态变更。墙遮挡是**测试临时改地形**，不是真实地图生成，必须显式标注。
  2. 表中「独立 Tester 无夹具」两行未写明**属于父提交 2d78e80**；`p1-fixes/REPORT.md:§3` 写了，但阶段报告表本身易被读成 1aadd2e 的独立无夹具验收。本轮独立复核的 8/8 与 33/33 仍来自带夹具 spec；本提交**尚无独立无夹具探针**。
- 修复条件：表增一行「开发者感知边界 E2E」并列出上述夹具 + `fixture-scoped wall`；在 perception 测试内加 `record('evidence-fixture', {...})`；两行 Tester 证据加「父提交 2d78e80，非本提交」；明确「本提交无独立无夹具证据」。**不阻断 P1 功能判定**，但 F-07 不能标「完全关闭」。

---

## 3. 回归与测试真实性补充

### T-01（中；既有，非本提交引入）`movingSamples > 2` flaky
- 位置：`tests/ai-native-world.spec.ts:336`（1aadd2e 版本；父 2d78e80 为 `:322` 同类断言）。
- 证据：冻结 preview 上 fix **5/6**、parent **5/6** 同样 1 次失败，错误均为 `Expected: > 2 / Received: 2`（`gate-fix-repeat6.log`、`gate-parent-repeat6.log`）；全量回归 run1 32/33、run2 33/33。独立 AI 行为探针：fix `moving=7, ENGAGE=33, MOVE=1, TRAVEL=6, BLOCKED=0`，parent `moving=8, ENGAGE=32, MOVE=2, TRAVEL=6, BLOCKED=0`，动作分布近似、无新增 BLOCKED、远探针全拒（`probe-ai-movement-fix.log`/`-parent.log`），说明**不是 F-01 有界探针导致 AI 卡死**。
- 成因：14 帧 ×300ms 采样窗口内 AI 多数时间处于 `ENGAGE`（停 + 开火），`movingSamples` 对击杀/升级/帧时序敏感；成功轮也只有 5。属父提交的测试稳定性缺陷。
- 影响：不能把 developer 的「35/35」写成可稳定复现；**不判 1aadd2e 失败**。修复条件：改用 `waitForFunction` 等到位移、延长采样窗，或断言 `pathLength>1.5 || aiActionCount>1` 而非固定 `>2`；保留 `ai-samples` 明细。

### 未跑/未改
- 未独立重跑 `boss-room.spec.ts`(5173)、`canvas.spec.ts`(5199)：硬编码端口 + 并发 C1，按边界未占用；不在 10 文件内。
- 未把本地 controller 称为外部 Agent、未把 Phaser/Playwright 称为 Headless、未把 i-frames/合成伤害/临时墙称为真实战斗；HUD/文档仍 `EXTERNAL NOT CONNECTED`。
- F-03 `window.__game`（`src/main.ts:37`）、F-08 `World.ts:811` restore 入参别名、F-09 `control.ts:70` 硬编码 64/32 均**未处理**，按边界保留 P2/P4；`worldObservation.ts:3-6` 已明确本投影不是安全边界。

---

## 4. 复现命令（冻结，不碰共享工作树）

```bash
cd D:/Project/LAST_SIGNAL
SNAP=/d/Project/lastsignal-p1fix-review-1aadd2e
rm -rf "$SNAP" && mkdir -p "$SNAP"
git -c core.autocrlf=false -c core.eol=lf archive 1aadd2e04ffaa2a367c2b382004aea305b61f3ec | tar -x -C "$SNAP"
cmd //c "mklink /J D:\Project\lastsignal-p1fix-review-1aadd2e\node_modules D:\Project\LAST_SIGNAL\node_modules"
cd "$SNAP"
npm run typecheck; npm test
npm run build -- --outDir reviewer-dist
node node_modules/vite/bin/vite.js preview --outDir reviewer-dist --port 5323 --strictPort
PORT=5323 LS_AI_EVIDENCE_DIR=<own-report-dir>/evidence-p1 npx playwright test tests/ai-native-world.spec.ts --workers=1
node node_modules/vite/bin/vite.js --port 5321 --strictPort
PORT=5321 npx playwright test <9 个 PORT 感知 spec> --workers=1
```

---

## 5. 给 Lead / Developer 的关闭条件清单

1. [ ] 修 `docs/AI_NATIVE_WORLD_CONTROL.md:14,35,68,99,162` 的「当前房间/可见白名单/直接 isWalkable」残留 → F-02 文档闭环。
2. [ ] F-07：感知 E2E 内加 `record('evidence-fixture', ...)`，阶段报告表增感知夹具行（含临时 `tile.type='wall'`、Boss/portal 坐标变更、`enteredRooms.add`），并给 Tester 无夹具行标「父提交 2d78e80」。
3. [ ] 稳定 `tests/ai-native-world.spec.ts:336` 的既有 flaky 断言；在此之前不得称 35/35 可重复。
4. [ ] 可选：补一条「近距但未进入房间」E2E 负例，使 `unexplored` 断言不被半径掩盖；`setupHud()` 支持运行中 resize 重排。
5. [ ] P2/P4 继续保留 F-03/F-08/F-09/R-01/R-02/R-05/R-06/R-09 与外部 Agent 接入义务，不得随本轮 PASS 删除。
