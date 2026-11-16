# AI-NATIVE-02 P0/P1 独立最终验收报告（Tester）

- Worker `y6en9ua8phanll8cqi8dd8ru`，专属目录 `reports/ai-native-02/tester/p1-final/`
- 结论：**P1 PASS（无阻断）**，附 §6 限制；不宣称真实外部 Agent / 真人 / Headless Agent 证据。
- 证据类别：**自动化 Playwright + 页内 page.keyboard/page.mouse 输入**（非系统键鼠、非真人游玩）；被测 AI 是 HUD 明示的 `LOCAL DETERMINISTIC` 本地确定性控制器。

## 1. 被测冻结状态

| 项 | 值 |
| --- | --- |
| commit | `2d78e8057f8e8729c30eaa083fac8dc6360df34f` |
| 父提交 | `860a0dd78fb741896c2f1433742603dd91e37fc8` |
| 分支 | `feat/ai-native-world-integration` |
| `git status --porcelain` | `?? reports/`（无已跟踪源码/测试/配置改动） |
| 源码 MD5 | `00-frozen-state.log`（验收前后复核一致，见 `08-final-state.log`） |
| 产物 | 本 Worker 自行 `npx vite build --outDir .../p1-final/frozen-dist --emptyOutDir` 生成，MD5 见 `02-frozen-artifacts.log` |
| 服务 | `vite preview --outDir <我的 frozen-dist> --port 5282 --strictPort`（启动前 `netstat` 确认 5282 FREE；未动 5173/5199/5281） |

## 2. Gate 一行式结果（完整输出均在日志）

- PASS `npm run typecheck` 退出码 0 → `06-typecheck.log`
- PASS `npm test` 16 files / **321 tests** → `07-unit.log`
- PASS `npx vite build --outDir "…/p1-final/frozen-dist" --emptyOutDir` 11.19s（保留既有 500kB chunk 警告）→ `01-build-frozen.log`
- PASS `PORT=5282 LS_AI_EVIDENCE_DIR=…/p1-final/evidence npx playwright test tests/ai-native-world.spec.ts --reporter=line --workers=1 --output=…/p1-final/pw-out` → **6 passed (1.1m)** → `03-playwright-final.log`
- PASS `node …/probe-normal-run.mjs http://localhost:5282/`（无夹具短演示）→ `04-normal-run-probe.log` + `normal-run-log.json`
- PASS `node …/probe-natural-death-wall.mjs http://localhost:5282/`（无夹具长演示/自然死亡/墙邻域）→ `05-natural-death-wall-probe.log` + `natural-death-wall-log.json`

## 3. P1 六项 Playwright 复核（独立执行，--workers=1，端口 5282）

对 `2d78e80` 冻结产物重跑开发者 spec 的 6 项，全通过：

1. `shared control path, AI run, disable/takeover, level-up takeover, pause/death/restart/exit`
2. HUD `1920x1080`
3. HUD `1366x768`
4. HUD `1280x720`
5. HUD `1024x768`
6. HUD `800x600`

关键操作日志（`evidence/operation-log-control-flow-1280x720.json`）摘录：
- 默认 `owner=human`、`CONTROL HUMAN`、`LOCAL DETERMINISTIC DEMO · EXTERNAL NOT CONNECTED`；暂停菜单 `AI CONTROL: OFF`。
- `NEW RUN → ESC → AI CONTROL ON → ESC` 后 `mode=AI`；14 次采样 `pathLength=7.503` tiles、`maxStep=2.349`、**所有采样点 walkable**、动作 `ENGAGE/INTERACT/TRAVEL`、1 次合法传送门房间转场（combat→elite）、1 次真实升级弹层选择。
- 观察白名单：其他房间敌人 id 10 不在 `visibleIds/intentEnemyIds`，`hasTargetRoom=false`，自身 HP 保留。
- 暂停：`mode=PAUSED`、位置与 `aiActionCount` 冻结；菜单显示 `AI CONTROL: ON · LOCAL DEMO`。
- **暂停 OFF**：`owner→human`、`aiEnabled=false`、`reason=pause-menu`、`takeoverCount=1`、OFF 后 2.5s 不自抢、`txtControl=HUMAN`。
- **夺回**：按 KeyD 后 `reason=human-input`、`maxTrackStep=0.648`（无瞬移）、位置 walkable、2s 内保持 human。
- **升级弹层接管**：弹层仍打开时按 W → `owner=human`、`takeoverCount=3`、AI 关闭，选卡后 `paused=false` 且仍 human。
- 死亡（spec 内 `invuln=0 + hurt(999999)` 强制伤害）→ `GameOverScene`、human、AI off、存档 run 清空；RETRY 后新局 `human / aiActionCount=0 / takeoverCount=0`；checkpoint 捕获帧不随活状态变异；QUIT TO MENU 正常；0 console/page error。

> 该 spec 的主控制流用例使用 `stabilizeEvidenceRun()` **每 100ms 刷新 `invuln`**（测试夹具，避免采样被战斗死亡打断）；其 AI 连续采样不是真实生存/战斗证据。死亡是通过真实 `hurt()` 路径但以强制伤害触发。

## 4. 五分辨率 HUD + 实际视觉查看

逻辑分辨率恒为 1280x720（`Phaser.Scale.FIT + CENTER_BOTH`），实测 CSS 画布与最小右列物理字高：

| 视口 | canvas CSS | 缩放 | 最小物理字高 | 实际看图结论 |
| --- | --- | --- | --- | --- |
| 1920x1080 | 1920x1080 | 1.5 | 19.5px | — |
| 1366x768 | 1365.33x768 | 1.067 | 13.87px | **已看图**：右列 7 行、左上 HP/XP、左下提示完整清晰，无裁切/重叠 |
| 1280x720 | 1280x720 | 1.0 | 13px | — |
| 1024x768 | 1024x576（上下各 96px 黑边） | 0.8 | 10.4px | **已看图**：`CONTROL AI · LOCAL DETERMINISTIC` / `AI ACTION` / `AI TARGET` / `EXTERNAL NOT CONNECTED` 均可辨认，无裁切；黑边为 FIT letterbox |
| 800x600 | 800x450（上下各 75px 黑边） | 0.625 | 8.125px | **已看图**：7 行右列与左下提示都在画布内、字偏小但可辨认，无截断/重叠；黑边为 FIT letterbox |

截图：`evidence/hud-ai-*.png`；rect/字高数据：`evidence/operation-log-hud-*.json`。所有分辨率断言包含：canvas 完整在视口内、14 个 HUD 对象在逻辑边界内、右列 7 行互不重叠、最小物理字高 ≥7.5px、AI 模式运行、0 console/page error。

## 5. 独立无夹具探针（本 Worker 新增，仅放 p1-final）

### 5.1 `probe-normal-run.mjs`（20s 短演示，无夹具）
声明：**不刷新无敌帧、不写 HP/坐标、不调 `hurt()/addXp()/spawnEnemy()`、不注入 seed**；只做真实 `NEW RUN → ESC → AI CONTROL ON → ESC` 与页内键鼠。
- 100 次 200ms 采样，`invuln` 范围 0–0.967s（自然受击无敌，**无 1e9 夹具值**）。
- 真实 HP：100 → 最低 6.53 → 25.36（自然受伤 + 自然回复）；20s 内未自然死亡，AI 一直持有控制权（100/100 采样 `lastIntentOwner=ai`），动作 `ENGAGE/TRAVEL/MOVE`，经历 combat/elite 房间与 **2 次自然升级弹层**（用真实 `1` 键选卡）。
- 墙碰撞：100/100 采样 `walkable=true`，同房间 97 步 `maxStep=1.724`、均值 0.200，无穿墙/瞬移。
- 三种真实人类输入夺回全部 PASS：`KeyD` 移动 / 鼠标开火 / `KeyF` 交互 → 均 `owner=human, aiEnabled=false, reason=human-input`。
- 暂停 OFF 独立复核 PASS：`AI CONTROL: ON` → 暂停冻结 → 点 OFF → `reason=pause-menu` → 恢复后 2s 仍 human、无自抢。
- 0 console/page error；连续截图 `evidence-normal/00..04`。

### 5.2 `probe-natural-death-wall.mjs`（较长正常运行 + 自然死亡）
同为无夹具；71 次 250ms 采样：
- **自然升级弹层接管**（无 `addXp` 注入）：弹层打开时位置/动作冻结，`KeyW` 一键夺回 → `owner=human, aiEnabled=false, reason=human-input`，弹层仍打开；按 `1` 选卡后仍 human、AI 不自抢。截图 `evidence-natural/01-natural-levelup-overlay.png`（已看图：LEVEL 2 / 三张升级卡 / HUD `CONTROL PAUSED`）。
- **自然死亡**：HP 100 → 0，真实 `SIGNAL LOST` GameOver（截图 `03-end.png`，seed 302883557，KILLS 9 / DAMAGE DEALT 1110 / TIME 0:28），`owner=human, aiEnabled=false, mode=PAUSED`，存档 `run` 已清空。真实点 `RETRY SAME SEED` → 新局 `CONTROL HUMAN / AI ACTION — / AI TARGET — / HP 100`（截图 `04-restart.png`，已看图），`actionCount=0, takeoverCount=0`。
- 墙碰撞邻域：71/71 采样 walkable，2 次采样紧邻墙，同房间 67 步 `maxStep=2.472`、均值 0.273；源码复核 `Player.applyIntent()` 的轴分离 `isWalkable(nx, wy)` / `isWalkable(wx, ny)` 与 `World.isWalkable(...,0.5)`（四角采样 wall/lava/water 拒绝），AI 意图与人类共用该路径。
- invuln 0–0.983s，未被夹具刷新；0 console/page error。

> 这两次探针是**自动化**证据，不是真人游玩/真实外部 Agent；自然死亡也不代表 P2 战斗胜利或战斗能力承诺，只记录真实生存→受伤→死亡行为。

## 6. 限制与未覆盖（不构成 P1 阻断）

1. **没有外部 Agent**：HUD/菜单/文档一致 `LOCAL DETERMINISTIC` + `EXTERNAL NOT CONNECTED`；本轮未接入 LLM/Codex/MCP Agent，未把本地控制器或 Playwright 自动化当成真实 Agent。
2. **不是 Headless World / Replay**：正式 World 是 Phaser 渲染 + 变长 dt + 视觉随机；`game:headless`/MCP 只覆盖 Station Zero 规则核心。本轮无 World 纯权威核、固定 tick、跨端 parity。
3. 主控制流 spec 的连续 AI 采样带 i-frames 夹具；独立无夹具探针已补真实受伤/自然死亡证据，但**均不宣称战斗胜利**。
4. 只覆盖 Chromium + 5 个指定桌面视口；无跨浏览器/触屏/缩放 DPI 验收；无系统键鼠注入。
5. `npm run build` 的 500kB chunk 警告为基线既有；生产构建 minify 类名，spec 已改用 Phaser scene key（本次冻结产物验证可用）。
6. 800x600 物理字高 8.125px 为可读性下限，实际看图可辨认但偏小，建议后续 UI 阶段评估放大。
7. 未重跑与 P1 无关的全量 33 项 E2E（避免内存/端口干扰）；已有旧回归由开发者自测记录，本单不重复冒充独立验收。

## 7. 复现步骤（我的独立路径）

```bash
cd D:/Project/LAST_SIGNAL
git rev-parse HEAD                      # 2d78e80...
git status --porcelain                  # 仅 ?? reports/
netstat -ano | grep ":5282 "            # 先确认 FREE

# 冻结产物到本 Worker 专属目录
npx vite build --outDir "D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/p1-final/frozen-dist" --emptyOutDir
node node_modules/vite/bin/vite.js preview --outDir "D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/p1-final/frozen-dist" --port 5282 --strictPort

# 六项 P1 Playwright（新终端）
PORT=5282 LS_AI_EVIDENCE_DIR="D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/p1-final/evidence" \
  npx playwright test tests/ai-native-world.spec.ts --reporter=line --workers=1 \
  --output="D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/p1-final/pw-out"

# 两个无夹具独立探针
node reports/ai-native-02/tester/p1-final/probe-normal-run.mjs http://localhost:5282/
node reports/ai-native-02/tester/p1-final/probe-natural-death-wall.mjs http://localhost:5282/

# 视觉复核：打开 evidence/hud-ai-800x600.png 与 evidence/hud-ai-1024x768.png
```

日志、截图、操作 JSON 全部在 `reports/ai-native-02/tester/p1-final/`；本 Worker 未写其他 Worker 的证据目录，未使用/强杀其他端口进程。
