# AI-NATIVE-02 P1 条件项收尾小补丁（独立提交，未混入 C2 WIP）

- 提交：**`ff13ce3b0309148ed0c3cf72bc662ffafb4b4fc7`**（amend 后；第一次临时提交 `b51bd17` 因 spec 语法错误已修正并 amend，不保留为独立提交）
- 父提交：`cdb594ed6b55dd7ac3a801dea9679ceabca2a66c`（C1）；分支 `feat/ai-native-world-integration`；未合并 main、未 push。
- 选择性 stage：`docs/AI_NATIVE_WORLD_CONTROL.md`、`docs/AI_NATIVE_PHASE_REPORTS.md`、`tests/ai-native-world.spec.ts` 共 3 文件；**C2 WIP 源码改动未 stage、未提交**（`git status --porcelain` 仍显示 C2 WIP + `?? reports/`）。
- 验收隔离：从 `git archive ff13ce3` 冻结快照 `D:/Project/AI-NATIVE-02-snapshots/ff13ce3-small` + node_modules junction 运行，`vite preview --port 5332 --strictPort`，不读共享工作树的 C2 WIP。

---

## 1. 三项收尾

1. **F-02 文档口径**：`AI_NATIVE_WORLD_CONTROL.md` 删除「只能看到当前房间 / 合法可见观察白名单 / `canWalk` 直接由 `World.isWalkable` 提供 / 保留当前房间敌人」等旧表述，统一为「12 tiles 有界网格半径 + 已探索房间 + 墙遮挡 LOS 的 `perceivedActors` 投影」与「`createLocalProbe()` ±1.5 tiles 有限、已探索局部探针」；图节点、接缝表、R-04/R-07 行同步。
2. **F-07 夹具与 commit 归属**：
   - 感知边界 E2E 新增 `record('evidence-fixture', ...)`，逐条列出 `bootRun` 固定 seed 注入、`spawnEnemy` 隐藏敌人、`enteredRooms.add`、**临时 `tile.type='wall'` 并恢复**、`spawnBoss`+`boss.wx/wy` 近/远改写及销毁清理、`portal.wx/wy` 近/远改写及恢复、NaN/±Infinity `canWalk` 探针、近距 `spawnEnemy` 目标；并声明该用例无 i-frames / HP / 坐标 / addXp / 合成伤害注入（但仍不是独立无夹具证据）。
   - spec 头部补充上述全部感知夹具，并区分 `reports/ai-native-02/tester/p1-final/`（父 `2d78e80`）与 `reports/ai-native-02/tester/p1-fixes-final/`（修复 `1aadd2e`）两类独立证据。
   - 阶段报告证据范围表新增「真实 commit」列：逐行标注 `2d78e80` / `1aadd2e` / 无；新增「开发者感知边界 E2E」行与「独立 Tester 修复提交无夹具探针」行（明确 `p1-fixes-final/`，不再只引用父提交 `p1-final/`）；明确父提交自然死亡探针不可用于 `1aadd2e` 签字、本提交无独立自然死亡探针、C2 WIP 不得混入上表。
3. **T-01 flaky `movingSamples > 2`**：没有降低阈值。改为**有界等待有效连续采样**：`MIN_SAMPLES=10`、`MAX_SAMPLES=40`（每轮 300ms，约 12s 上限），在 `movingSamples>=3 && pathLength>1.5 && maxStep<3.2 && (portalTransitions>0 || interactSamples>0)` 时停止；额外断言每个采样点 walkable、`portalTransitions>0` 时房间确实变化且跳变单独记录、所有阈值保持原值。`ai-samples` 记录 `boundedWindow.exhausted=false`、真实 `portalTransitions`/`interactSamples`/`pathLength`。

---

## 2. Gate 一行式（完整日志 `reports/ai-native-02/p1-fixes-small/logs/`）

- PASS `npm run typecheck` exit 0 → `typecheck.log`
- PASS `npm test` **344/344** → `unit.log`
- PASS `npx vite build --outDir .../frozen-dist --emptyOutDir` exit 0（保留既有 500kB chunk 警告） → `build.log`
- PASS `npm run game:mcp:build` exit 0 → `mcp-build.log`
- PASS `PORT=5332 npx playwright test tests/ai-native-world.spec.ts --list` 9 tests → `playwright-list.log`
- PASS `PORT=5332 LS_AI_EVIDENCE_DIR=.../evidence-frozen npx playwright test tests/ai-native-world.spec.ts --reporter=list --workers=1` **9/9** → `playwright-p1-once.log`
- PASS `PORT=5332 ... npx playwright test tests/ai-native-world.spec.ts -g "shared control path" --repeat-each=6 --workers=1` **6/6** → `playwright-repeat6.log`
- 状态/提交/预览：`commit.log`、`amend.log`、`preview-5332.log`；冻结快照路径见上文。

**中间失败（已关闭）**：首次 `b51bd17` 快照运行 Playwright 报 `SyntaxError: ... ai-native-world.spec.ts: Unexpected token (1188:0) / No tests found`，根因是插入 `record('evidence-fixture', ...)` 时漏了 `const probe = await page.evaluate(() => {` 行；已补回并 `git commit --amend` 为 `ff13ce3`，从新快照重跑全绿。`playwright-p1-once.log`（覆盖后）为 PASS，不保留旧失败日志冒充成功。

---

## 3. 证据

- `reports/ai-native-02/p1-fixes-small/evidence-frozen/`：冻结 9 项截图/操作日志；`operation-log-perception-bounds-1280x720.json` 首步为 `evidence-fixture`，第二步 `perception-probe`；`operation-log-control-flow-1280x720.json` 的 `ai-samples` 记录 `boundedWindow={min:10,max:40,exhausted:false}`、`movingSamples=4`、`portalTransitions=1`、`pathLength=7.62`。
- `reports/ai-native-02/p1-fixes-small/evidence-repeat6/`：6 次定向重复的操作日志（文件名相同，逐次覆盖，最终一次 PASS）。
- 独立 Tester 修复提交无夹具证据：`reports/ai-native-02/tester/p1-fixes-final/`（未修改、未删除）；父提交证据 `reports/ai-native-02/tester/p1-final/` 仍保留。

---

## 4. 边界 / 与 C2 的关系

- 本小补丁**可完全隔离**，不依赖任何 C2 WIP 源码/测试改动；冻结快照只含 `ff13ce3` 的已跟踪文件。C2 WIP 仍在工作树中，后续 C2 提交会单独说明并绑定新的 C2 证据，不把本补丁的 9/9、6/6 算作 C2 验收。
- 未修 F-03 / F-08 / R-01/R-02/R-05/R-06/R-09；外部 Agent、Headless World、Replay、Signal 仍未实现；HUD/文档持续 `EXTERNAL NOT CONNECTED`。
- 本补丁只改文档与测试可靠性，不改产品源码；未新增独立无夹具自然死亡证据，未宣称 P1 全量最终签字。
