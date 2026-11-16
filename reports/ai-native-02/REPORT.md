# AI-NATIVE-02 P0 → P1 交付报告（Developer / 自测，非独立验收）

- 提交时间：2026-11-13
- Phase：**P0 接缝核查 + P1 正式 World 可见本地确定性接管**（P2–P5 未做）
- Branch：`feat/ai-native-world-integration`
- 基线：`860a0dd78fb741896c2f1433742603dd91e37fc8`（origin/main，AI-NATIVE-01 已合并）
- Commit：**`2d78e8057f8e8729c30eaa083fac8dc6360df34f`**
- 状态：已提交 P0/P1；**未 push、未合并 main、未创建/更新 PR**。`git status --porcelain` 仅剩未跟踪的 `reports/`（证据，不随提交）。
- 源码所有权：本轮仅此 Worker 写入；独占 `src/world/World.ts`、`src/entities/Player.ts`、`src/scenes/GameScene.ts` 及新增 AI/HUD/测试文件。

---

## 1. 一行式 Gate 摘要

- PASS `npm run typecheck` exit 0 — `reports/ai-native-02/final-typecheck.log`（基线 `p0-baseline-typecheck.log`）
- PASS `npm test` 321/321（基线 292/292） — `reports/ai-native-02/final-unit.log`（基线 `p0-baseline-unit.log`）
- PASS `npm run build` exit 0（保留既有 500kB chunk 警告） — `reports/ai-native-02/final-build.log`（基线 `p0-baseline-build.log`）
- PASS `npm run game:mcp:build` exit 0 — `reports/ai-native-02/final-mcp-build.log`
- PASS `PORT=5281 LS_AI_EVIDENCE_DIR=reports/ai-native-02/evidence-frozen npx playwright test tests/ai-native-world.spec.ts --reporter=list --workers=1` 6/6 — `reports/ai-native-02/final-playwright-frozen.log`
- PASS `PORT=5173 LS_SHOT_DIR=reports/ai-native-02/screens npx playwright test --reporter=list --workers=1` 33/33（旧 27 + 新 6） — `reports/ai-native-02/p1-full-playwright.log`
- 历史失败（已关闭）：`p1-playwright-ai-world.log`（生产构建 class 名压缩 / LevelUpScene 暂停 / 传送门合法房间跳变 / 战斗死亡打断采样）、`p1-playwright-frozen.log` 中间轮次、`debug-single.log`。**最终复跑全绿**。

完整输出均在 `reports/ai-native-02/*.log`；冻结源码状态 `frozen-source-state.log`、`final-source-md5.log`（比对 MATCH）；提交与 git 状态 `final-commit.log`、`final-git-state.log`。

---

## 2. Changed Files（14）

| 文件 | 作用 |
| --- | --- |
| `src/ai-native/control.ts` | `PlayerIntent`、人类输入适配、`intentToWorldVelocity`（真实各向异性移动预算）、`ControlAuthority` 状态机 |
| `src/ai-native/localController.ts` | 本地确定性控制器：目标选择/移动/停止/交火/传送门交互/防卡死，只返回意图 |
| `src/ai-native/worldObservation.ts` | 合法可见观察白名单 `WorldObservationV1` |
| `src/ai-native/control.test.ts` | 21 项：意图、各向异性预算、控制器决策/确定性、所有权/暂停/夺回/死亡/重启 |
| `src/ai-native/worldObservation.test.ts` | 6 项：隐藏敌人/Boss phase/portal targetRoom 过滤，公开状态保留 |
| `src/systems/RunCheckpoint.ts` + `src/systems/runCheckpoint.test.ts` | `cloneCheckpoint()` 深拷贝（R-03）+ 2 项单测 |
| `src/entities/Player.ts` | `applyIntent()` 唯一执行入口、`setAimGrid()` 共用瞄准、`requestInteract()`、`clearHeldInput()`、人类安全夺回 |
| `src/world/World.ts` | `observationView()` / `intentView()` 只读适配；`captureCheckpoint()` 深拷贝 |
| `src/scenes/GameScene.ts` | 控制 HUD 4 行 + 操作提示、`toggleAiControl()` 开发入口、暂停/升级/死亡/重启/退出所有权与残留输入清理、升级弹层内移动键夺回 |
| `src/scenes/PauseScene.ts` | `AI CONTROL: OFF/ON · LOCAL DEMO` 按钮与真实性/操作说明 |
| `tests/ai-native-world.spec.ts` | 正式 World 浏览器证据：控制流 + 5 分辨率 HUD |
| `docs/AI_NATIVE_WORLD_CONTROL.md` | 接缝图、最小接口、操作说明、风险处置与遗留 |
| `docs/AI_NATIVE_PHASE_REPORTS.md` | AI-NATIVE-02 P0/P1 阶段记录 |

---

## 3. Implemented Features

1. **同一合法执行路径**：人类与本地 controller 都产生 `PlayerIntent`，经 `Player.applyIntent()` 走同一各向异性移动、轴分离 `World.isWalkable(x,y,0.5)`、`setAimGrid()`、`tryFire()`、`World.tryInteract()`、冲刺与视觉/音效；控制器不写坐标、HP、Phaser 对象，不伪造 pointer，不读 camera，不 import Station Zero runtime。
2. **AI 可见行为**：最近当前房间敌人优先、进入射程停止并开火、无敌人时走向传送门并交互、墙体阻塞报告 BLOCKED、确定性防卡死绕行；HUD 显示**实际执行**的最近动作/目标与计数。
3. **真实标签**：`CONTROL AI · LOCAL DETERMINISTIC`、`LOCAL DETERMINISTIC DEMO · EXTERNAL NOT CONNECTED`、暂停菜单 `EXTERNAL AGENT NOT CONNECTED`；`externalAgentConnected: false` 是常量真值。
4. **人类安全控制**：任意 WASD/SPACE/开火/F 当帧夺回并关闭本地演示；升级弹层覆盖时移动键同样可夺回（真实产品行为，不靠测试先关弹层）；暂停菜单可 OFF；暂停/恢复按启用状态继续；AI 不自抢。
5. **生命周期**：暂停/升级/死亡/新 R0/场景退出均回收所有权并清理方向键、`fireHeld`、交互排队、控制器记忆；死亡仍 `finishRun` 清 checkpoint、新局 R0；退出/刷新恢复最近安全点；存档结构与 `SAVE_VERSION=2` 未改。
6. **P1 直接相关审查风险**：R-03 深拷贝+测试；R-04 白名单（仅当前房间存活敌人、当前房间 Boss 公开 HP、传送门位置；隐藏房间/敌人/Boss phase/portal targetRoom/seed 不外泄）；R-07 使用正式 World 碰撞谓词；R-08 共用 grid 瞄准入口；R-10 诚实标签；不因黑名单删掉合法公开状态。
7. **开发入口**：正式游戏 Pause 菜单第五个按钮；左下 HUD 常驻操作说明；文档含完整步骤。

---

## 4. Demo Evidence（冻结快照 / 专属端口 5281 / `--workers=1`）

- 代码来源：`npm run build` → `reports/ai-native-02/frozen-dist`（冻结产物），`npx vite preview --outDir reports/ai-native-02/frozen-dist --port 5281 --strictPort`；无 HMR。
- 截图：`reports/ai-native-02/evidence-frozen/`：`hud-human-1280x720.png`、`pause-ai-entry-1280x720.png`、`pause-ai-off-1280x720.png`、`ai-run-00/03/06/09/12.png`（连续取样）、`ai-active-hud-1280x720.png`、`levelup-ai-paused-1280x720.png`、`death-ownership-1280x720.png`、`hud-ai-{1920x1080,1366x768,1280x720,1024x768,800x600}.png`。
- 操作日志：`operation-log-control-flow-1280x720.json`（16 步）、`operation-log-hud-<分辨率>.json`（5 份，含 rect、缩放、物理字号）。
- 实测要点：AI 14 帧采样、pathLength 9.478 tiles、5 帧非零移动意图、同房间最大步长 2.733 tiles、全部采样点 walkable、1 次合法传送门房间转场（`combat → elite`）；白名单排除其他房间敌人 `#10`，`targetRoom` 不外泄；暂停菜单在 AI 运行时显示 `ON · LOCAL DEMO`，手动 OFF 后 2.5s 不自抢；升级弹层内按 W 夺回且弹层保持打开；死亡清 run 且 ownership 回 human；新局无残留；checkpoint 捕获帧在活状态变异后保持不变。
- 五分辨率 HUD 全部在逻辑 `[0,1280]x[0,720]` 内、右列 7 行互不重叠、画布完整可见；缩放后最小行高 19.5 / 13.87 / 13 / 10.4 / **8.125** CSS px（800x600，与 Tester 预估一致），并保存截图供人工判读。
- 测试夹具说明：仅由 Playwright 每 100ms 刷新 i-frames（防止无关战斗死亡打断控制流采样），**不改 HP/坐标、不由控制器执行**；死亡仍用真实 `hurt()`（先清 i-frames）验证。连续截图不是真人验收，也不代表外部 Agent。

---

## 5. Known Limitations / 明确未完成

- 未接入外部 LLM / Codex / MCP Agent；`externalAgentConnected=false` 是真实状态。现有 MCP/Headless 只服务 Station Zero，未进入 Phaser Scene。
- 主 World 仍是 Phaser + 规则耦合、变长 dt、玩法/视觉随机混合；**没有纯 `WorldCore`、固定 60Hz tick、全玩法 seeded RNG、Replay/state hash、跨端 parity**。按 Lead 裁定这些是 **P2/P4 架构风险**，本轮不重构、不冒充实现。
- `Human + ECHO` 正式双 Actor、长期记忆、世界观/剧情未实现；`coop.ts` 仍是隔离 Headless 测试实体。
- Station Zero runtime 的 actor 标签、reset 换 seed、`__testSetPosition` 门禁（R-05/R-06）留 P2/P4；`onLoot` 空回调、`statsSnapshot()` 恒 0（R-09）未处理。
- 传送门转场是既有 `World.tryInteract()` 规则，会 `Player.reset()` 重置 i-frames；测试通过夹具刷新避免战斗死亡干扰，未改玩法。
- `ensureWalkable()` 的既有脱困瞬移仍在正式玩家路径中，AI 不直接触发；统一 `canStand` 属后续纯核重构。
- 视觉随机（`Math.random()` bob/掉落/召唤）与玩法随机未区分归档；固定 seed 只用于证据复现，不要求每局强制换图。
- 500kB chunk 警告为既有构建警告；`boss-room.spec.ts` 固定 5173、`canvas.spec.ts` 固定 5199，不能靠 PORT 隔离，全量回归时两个端口必须对应同一源码快照。

---

## 6. Reviewer Result / 独立验收状态

- Reviewer 已完成**基线只读风险审查**：`reports/ai-native-02/reviewer/REVIEW_P0P1_WORLD_MIGRATION_RISK.md`（R-01–R-10）；Tester 已完成**基线门与清单**：`reports/ai-native-02/tester/BASELINE-VERIFICATION.md`、`P1-ACCEPTANCE-CHECKLIST.md`。
- **两者均尚未对本 `2d78e80` 实现做独立最终验收**；本报告的 PASS 全部是 Developer 自测，不得冒充独立验收或真人验收。
- 无独立 Reviewer 的实现签字；请 Lead 另派 Tester / Reviewer 复核。

---

## 7. 启动说明（供独立验收）

```bash
# 冻结快照 + 专属端口（推荐 P1 spec，无 HMR）
cd D:/Project/LAST_SIGNAL
git checkout feat/ai-native-world-integration
git rev-parse HEAD        # 2d78e8057f8e8729c30eaa083fac8dc6360df34f
npm run build
cp -r dist reports/ai-native-02/frozen-dist
npx vite preview --outDir reports/ai-native-02/frozen-dist --port 5281 --strictPort
PORT=5281 LS_AI_EVIDENCE_DIR=reports/ai-native-02/evidence-accept \
  npx playwright test tests/ai-native-world.spec.ts --reporter=line --workers=1

# 旧测试全量回归（需 dev server；audit 动态 import /src）
npm run dev -- --port 5173 --strictPort
npm run dev -- --port 5199 --strictPort   # 若已有同源码 dev server 需先确认其对应本提交
PORT=5173 LS_SHOT_DIR=reports/ai-native-02/screens-accept \
  npx playwright test --reporter=line --workers=1

# 单元/类型/构建
npm run typecheck; npm test; npm run build; npm run game:mcp:build
```

操作中真实入口：主菜单 NEW RUN → ESC → `AI CONTROL: OFF` → `ON · LOCAL DEMO` → ESC 恢复；任意移动/开火/F 夺回，ESC 暂停，Pause 菜单可再次 OFF。

---

## 8. Next Phase

1. Lead 派独立 Tester / Reviewer 对 `2d78e8057f8e8729c30eaa083fac8dc6360df34f` 做最终验收（含源码、冻结快照、五分辨率截图、操作日志）。
2. 独立验收通过后再派 P2：按 R-01/R-02 评估纯 `WorldCore` / 固定 tick / parity 的重构成本与风险，不在 P1 抢跑。
3. P3–P5 再处理外部 Agent 正式通道、Replay/确定性、Human+ECHO 正式双 Actor；当前一律标记未完成。
