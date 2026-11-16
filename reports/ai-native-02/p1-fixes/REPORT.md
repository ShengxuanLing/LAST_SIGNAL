# AI-NATIVE-02 P1 条件项修复报告（Developer 自测，待独立复核）

- 修复提交：**`1aadd2e04ffaa2a367c2b382004aea305b61f3ec`**
- 父提交：`2d78e8057f8e8729c30eaa083fac8dc6360df34f`（Tester PASS / Reviewer 条件 PASS）
- 分支：`feat/ai-native-world-integration`；未 push、未合并 main、未动 PR；`git status --porcelain` 仅 `?? reports/`。
- 本单范围：**只修 F-01/F-02/F-04/F-05/F-06/F-07**；未实施 P2 源码，未做全量重构，未引入外部 Agent / 假 LLM / 假 Headless。
- 独立复核状态：Reviewer `REVIEW_P1_IMPLEMENTATION.md` 与 Tester `p1-final/P1-FINAL-ACCEPTANCE.md` 的对象都是**父提交 2d78e80**；本修复提交**尚未经独立 Reviewer/Tester 复核**，以下 PASS 均为开发者自测。

---

## 1. Gate 一行式（完整输出在 `reports/ai-native-02/p1-fixes/logs/`）

- PASS `npm run typecheck` exit 0 → `final-typecheck.log`
- PASS `npm test` **329/329**（17 文件；新增 `worldPerception.test.ts` 8 项） → `final-unit.log`
- PASS `npm run build` exit 0（保留既有 500kB chunk 警告） → `final-build.log`
- PASS `npm run game:mcp:build` exit 0 → `final-mcp-build.log`
- PASS `PORT=5173 npx playwright test --reporter=list --workers=1` **35/35**（旧 27 + 新 8，含五视口） → `final-full-playwright.log`
- PASS 冻结快照 5283 `PORT=5283 LS_AI_EVIDENCE_DIR=reports/ai-native-02/p1-fixes/evidence-frozen npx playwright test tests/ai-native-world.spec.ts --reporter=list --workers=1` **8/8** → `final-playwright-frozen.log`
- 状态检查与 MD5：`final-git-state.log`、`final-md5.log`、`final-commit.log`；P2 只读评估状态：`reports/ai-native-02/p2-scope/logs/00-git-state.log`、`01-typecheck.log`、`02-unit.log`、`03-method-inventory.log`、`04-source-facts.log`、`05-state-after-fixes.log`。

历史中间失败（已关闭）：`pw-dev-5173.log` 中 800x600 几何阈值 8.125px、以及 `enableAiViaPause` 在 AI 已 ON 时误把按钮点成 OFF；修复分别为紧凑视口字号/行距重排与测试按当前状态决定是否开启，最终复跑全绿。

---

## 2. 改动文件（10）

| 文件 | 修复 |
| --- | --- |
| `src/ai-native/worldPerception.ts` **新** | `WORLD_PERCEPTION`（radius 12 / probe 1.5 / LOS step 0.25）、`gridLineOfSight()`、`createLocalProbe()`；纯网格，无 camera |
| `src/ai-native/worldPerception.test.ts` **新** | 8 项：远距、墙后、未探索、非有限、局部探针无地形泄漏、探针半径 < 感知半径 |
| `src/ai-native/worldObservation.ts` | 撤回「当前房间即可见」；`visibleActors`→`perceivedActors`，新增 `visibilityBasis` 与 `perception` 描述；敌人/Boss/portal 一律经 `isPerceivable` 过滤 |
| `src/ai-native/worldObservation.test.ts` | 6 项重写：同房间墙后排除、他房追入可见、Boss/portal 位置、无 targetRoom/phase/seed/map |
| `src/ai-native/localController.ts` | `canWalk` 契约改为有界局部探针说明 |
| `src/world/World.ts` | 新增 `roomIdAt/isExploredCell/isOpaqueCell/isPerceivable`；`observationView()` 传感知谓词；`intentView()` 用 `createLocalProbe` 替换全图 oracle；`ready` 纳入 `!control.paused` |
| `src/scenes/GameScene.ts` | F-04/05：背包 `control.pause()+clearHeldInput()+refreshHud`；覆盖层内 W/A/S/D/SPACE、非 UI 鼠标、F 夺回；`pointerDownOnUi()` 用 `hitTestPointer` 区分 UI 点击与开火；暂停/恢复/升级/开关 AI 刷新 HUD；F-06 紧凑视口放大右列与提示、提高对比度、拉开行距 |
| `tests/ai-native-world.spec.ts` | 新增 2 个正式 World 用例（覆盖层所有权 + 有界感知）；五视口断言改名几何检查（≥10 CSS px）、检查提示颜色/文案/几何；状态读取增加 `fireHeld/inputFlags/weaponKey/visibilityBasis`；头部标注夹具与独立无夹具证据区别 |
| `docs/AI_NATIVE_WORLD_CONTROL.md` | 感知、覆盖层所有权、可读性、证据范围、F-03 未修等口径 |
| `docs/AI_NATIVE_PHASE_REPORTS.md` | 独立验收状态更正 + 「P1 条件项修复」+ **证据范围表**（F-07） |

---

## 3. 每项修复的实测结果

**F-01/F-02（感知与 `canWalk`）** — `evidence-frozen/operation-log-perception-bounds-1280x720.json`：
- `visibilityBasis = grid-radius+explored+line-of-sight`；`requiresExplored/requiresLineOfSight = true`。
- 远处真实地板/墙的 `canWalk` 均为 `false` 且相等（不泄漏地形）；标记已探索后仍 `false`；`NaN/±Infinity` 全部拒绝；近距合法探针 `true`。
- 未进入房间敌人不可感知；该房间标记已探索但仍远距也不可感知；近距无遮挡同房间敌人可感知；把中间地砖临时改为墙后同一敌人不可感知；近处 Boss/portal 可感知、远处不可；`targetRoom`、`phase` 不外泄。
- 单测另有远距、墙后、未探索、非有限、局部探针不调用地形谓词等负向断言。

**F-04/F-05（覆盖层所有权）** — `operation-log-overlay-ownership-1280x720.json`：
- 背包打开：`mode=PAUSED`、`authorityPaused=true`、`fireHeld=false`、方向键全清。
- EQUIP 点击：武器变为 `scatter`，`owner` 仍 `ai`、`aiEnabled=true`、无残留 fire；CLOSE 后 AI 恢复（无夺回时）。
- 背包内 `KeyW` / `KeyF` / 非 UI 鼠标点击均可夺回；关闭后 `owner=human`、`aiEnabled=false`，1.2s 后仍 human（不自抢）。
- 升级卡片点击与暂停菜单 SETTINGS 点击都归 UI，不夺回；升级弹层内 `KeyF` / 非 UI 鼠标同样可夺回，选卡后仍 human。

**F-06（800x600 可读性）** — `operation-log-hud-800x600.json` + `hud-ai-800x600.png`：
- 五视口最小状态行 CSS 字高：19.5 / 13.87 / 13 / 13.6 / **10.625**（800x600）；提示行 21 / 14.93 / 14 / 12.8 / **10**，颜色 `#8fb8c8`，文案含 `ANY MOVE / FIRE / F TAKES HUMAN CONTROL`。
- 右列 7 行互不重叠、全部在逻辑画布内；测试断言明确写 `geometryOnly: true, readabilityClaim: false`，不再用 7.5px 阈值冒充 readable。
- 开发者人工看图结论：修复后 800x600 截图右列 7 行与左下提示完整、无裁切/重叠、字号明显放大且提示高对比，可辨；这是开发者看图，不冒充独立人工验收。

**F-07（证据范围）** — 阶段报告新增表格，逐类标注：
- 夹具证据：固定 seed 注入 `scene.start`、i-frames 每 100ms 刷新、`addXp` 升级、`spawnEnemy` 隐藏敌人、`hurt(999999)` 合成伤害、第二武器 fixture → 只证明控制流/几何/清理/投影。
- 独立无夹具证据：`reports/ai-native-02/tester/p1-final/` 的 `probe-normal-run.mjs` / `probe-natural-death-wall.mjs` 记录自然受伤（100→6.53→25.36）、自然升级、自然死亡（HP 100→0）、真实键鼠夺回、墙碰撞合法性；**该证据属于父提交 2d78e80，不是本修复提交的独立复验**。
- 外部 Agent / Headless World / Replay：全部未实现，HUD/菜单/文档持续 `EXTERNAL NOT CONNECTED`。

---

## 4. 已知限制 / 未完成

- F-03 未修：`window.__game` 生产暴露仍在；`WorldObservationV1` 是 controller 输入投影，不是页面级隐藏信息边界，P2 外部 Agent 接入前必须收敛（已写入 P2 范围评估）。
- F-08 未修：`restoreCheckpoint(run)` 仍把入参 `run.player` 别名给活玩家；线上 `GameScene` 用 `saveSystem.load()` 临时对象，当前安全。
- F-09 未修：`intentToWorldVelocity` 默认 64/32 未引用 `IsoMath.TILE_W/H`。
- F-10 顺带修复：暂停/背包/升级/恢复时显式 `refreshHud()`，HUD 模式不再停留在 `AI`。
- R-01/R-02/R-05/R-06/R-09、固定 tick、纯 `WorldCore`、全玩法 seeded RNG、Replay/state hash、跨端 parity、外部 Agent 经正式 MCP 通道、Human+ECHO 正式双 Actor、Signal 玩法均未实现；本轮没有宣称其中任何一项完成。
- 本修复提交的 Playwright 证据仍使用 i-frames/addXp/spawnEnemy/固定 seed 等夹具；独立 Tester 的无夹具探针与 Reviewer 条件 PASS 都针对父提交，**本提交需 Lead 另派独立复核**。

---

## 5. 复现命令

```bash
cd D:/Project/LAST_SIGNAL
git rev-parse HEAD            # 1aadd2e04ffaa2a367c2b382004aea305b61f3ec
npm run typecheck; npm test; npm run build; npm run game:mcp:build

# 冻结快照 + 专属端口（无 HMR）
cp -r dist reports/ai-native-02/p1-fixes/frozen-dist
npx vite preview --outDir reports/ai-native-02/p1-fixes/frozen-dist --port 5283 --strictPort
PORT=5283 LS_AI_EVIDENCE_DIR=reports/ai-native-02/p1-fixes/evidence-accept \
  npx playwright test tests/ai-native-world.spec.ts --reporter=line --workers=1

# 旧回归（boss-room 固定 5173 / canvas 固定 5199；两端口须同源码）
npm run dev -- --port 5173 --strictPort
npm run dev -- --port 5199 --strictPort
PORT=5173 npx playwright test --reporter=line --workers=1
```

P2/P4 只读范围评估见 `reports/ai-native-02/p2-scope/SCOPE.md`（含三个连续小步、文件所有权、验收命令、规模/工期与推荐最小方案）；未实施任何 P2 源码。
