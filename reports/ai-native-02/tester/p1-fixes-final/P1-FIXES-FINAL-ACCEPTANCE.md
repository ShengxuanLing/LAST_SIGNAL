# AI-NATIVE-02 P1 修复（1aadd2e）独立复核报告（Tester）

- Worker `y6en9ua8phanll8cqi8dd8ru`，专属目录 `reports/ai-native-02/tester/p1-fixes-final/`
- 被测冻结提交：`1aadd2e04ffaa2a367c2b382004aea305b61f3ec`（父 `2d78e8057f8e8729c30eaa083fac8dc6360df34f`），分支 `feat/ai-native-world-integration`
- 复核方式：**git 提交快照**（`git archive 1aadd2e` → `D:/Project/AI-NATIVE-02-snapshots/1aadd2e`，仅含该提交的已跟踪文件）+ 我自建产物 + 专属空闲端口 **5283**；**未切共享分支、未改生产源码/已有测试/配置**，未读任何混合 WIP 作为验收依据。
- 结论：**P1 修复复核 PASS（无阻断）**；限制见 §6。

## 1. 冻结与隔离事实

| 项 | 值 |
| --- | --- |
| 提交 | `1aadd2e04ffaa2a367c2b382004aea305b61f3ec`（父 `2d78e80`） |
| 快照目录 | `D:/Project/AI-NATIVE-02-snapshots/1aadd2e`（`git archive` 导出，`node_modules` 用 junction 指向本仓库，未写入仓库） |
| 快照关键文件 MD5 | `src/ai-native/control.ts` `6add954f…`、`localController.ts` `4200bc75…`、`worldObservation.ts` `90387f89…`、`worldPerception.ts` `ace49526…`、`Player.ts` `df4f1bbe…`、`GameScene.ts` `57bd80d9…`、`World.ts` `dd6cd9be…`、`tests/ai-native-world.spec.ts` `fbe02eb0…`、`package.json` `c10e0913…`、`playwright.config.ts` `e3839101…`（完整见 `00-frozen-state.log`） |
| 产物 | 我在快照目录执行 `npx vite build --outDir …/p1-fixes-final/frozen-dist --emptyOutDir` → `01-build-frozen.log`；产物 MD5 `index.html db9ac2ea…`、`main-BHL6CEAE.js 35caaef2…`、`enemies-BNiJs2lu.js 337ed58b…`（`02-frozen-artifacts.log`） |
| 端口 | 启动前 `netstat` 确认 **5283 FREE**；用我自己的 `vite preview --outDir <我的 frozen-dist> --port 5283 --strictPort`；未触碰 5173/5199/5281/5282 或他人端口，结束时只停止我自己启动的 PID |
| 活工作树 | `git status --porcelain` = `?? reports/`（无已跟踪改动）；本次未在活工作树构建或测试，避免与并行开发混合 |

## 2. Gate 一行式（完整输出在同目录日志）

- PASS `npx tsc --noEmit`（快照目录）退出码 0 → `10-typecheck.log`
- PASS `npm test`（快照目录）**16 files / 329 tests** → `06-unit.log`
- PASS `npx vite build --outDir "…/p1-fixes-final/frozen-dist" --emptyOutDir` 12.79s（保留基线既有 500kB chunk 警告）→ `01-build-frozen.log`
- PASS `PORT=5283 LS_AI_EVIDENCE_DIR=…/p1-fixes-final/evidence npx playwright test tests/ai-native-world.spec.ts --reporter=line --workers=1 --output=…/p1-fixes-final/pw-out` → **8 passed (1.8m)** → `03-playwright-final.log`
- PASS `node …/probe-normal-run.mjs http://localhost:5283/`（复用上轮无夹具短演示）→ `04-normal-run-probe.log` + `normal-run-log.json`
- PASS `node …/probe-pointer-overlay.mjs http://localhost:5283/` → `05-pointer-overlay-probe.log` + `pointer-overlay-log.json`
- PASS `node …/probe-inventory-paused.mjs http://localhost:5283/` → `07-inventory-probe.log` + `inventory-log.json`
- PASS `node …/probe-resume-after-inventory.mjs http://localhost:5283/` → `08-resume-after-inventory-probe.log` + `resume-after-inventory-log.json`
- PASS `node …/probe-no-reclaim.mjs http://localhost:5283/` → `09-no-reclaim-probe.log` + `no-reclaim-log.json`

## 3. 八个 P1 用例（独立执行，--workers=1，端口 5283）

| # | 用例 | 结果 |
| --- | --- | --- |
| 1 | `shared control path, AI run, disable/takeover, level-up takeover, pause/death/restart/exit` | PASS |
| 2–6 | HUD `1920x1080` / `1366x768` / `1280x720` / `1024x768` / `800x600` | PASS ×5 |
| 7 | `F-04/F-05: inventory/pause/level-up overlay ownership, UI clicks vs fire/F takeover` | PASS |
| 8 | `F-01/F-02: perception radius, occlusion, unexplored rooms, boss/portal and bounded canWalk` | PASS |

全部 8 项 0 console/page error；操作日志 `evidence/operation-log-*.json`（control-flow / 5×hud / overlay-ownership / perception-bounds）。

## 4. 五分辨率 HUD + 实际看图

逻辑分辨率恒 1280x720；实测 canvas 与最小右列物理字高（C1 紧凑 HUD 后已改善）：

| 视口 | canvas CSS | 缩放 | 最小物理字高 | 对比父提交 2d78e80 |
| --- | --- | --- | --- | --- |
| 1920x1080 | 1920x1080 | 1.5 | 19.5px | 同 |
| 1366x768 | 1365.33x768 | 1.067 | 13.87px | 同 |
| 1280x720 | 1280x720 | 1.0 | 13px | 同 |
| 1024x768 | 1024x576（上下 96px 黑边） | 0.8 | **13.6px** | 10.4px → **+3.2px** |
| 800x600 | 800x450（上下 75px 黑边） | 0.625 | **10.625px** | 8.125px → **+2.5px** |

**实际查看** `evidence/hud-ai-800x600.png` 与 `evidence/hud-ai-1024x768.png`：
- 800x600：左下提示行 `ESC PAUSE · ANY MOVE / FIRE / F TAKES HUMAN CONTROL` 完整可读；右上控制列 `CONTROL AI · LOCAL DETERMINISTIC` / `AI ACTION ENGAGE ×10` / `AI TARGET HOSTILE #1 hunter` / `LOCAL DETERMINISTIC DEMO · EXTERNAL NOT CONNECTED` 四行齐全、无裁切、无相互遮挡，也未被世界元素压住（该区域为深色背景）；黑边为 FIT letterbox。
- 1024x768：同样四行控制列 + 左上 HP/XP + 左下提示清晰可读，无遮挡、无截断。

## 5. 重点项独立复核（我的无夹具探针，不依赖开发者自测）

### 5.1 背包 PAUSED / 输入清空（`probe-inventory-paused.mjs`）
`KeyI` 开背包：`mode=PAUSED`、`authorityPaused=true`、`gamePaused=true`、`fireHeld=false`、`playerFireHeld=false`、四个方向标志全 false、`txtControl="CONTROL PAUSED"`；**开背包本身不构成夺回**（owner 仍 ai、aiEnabled=true）；关闭后仍 ai、不自抢、`fireHeld=false`。→ PASS

### 5.2 UI 点击不夺回 / 非 UI 鼠标夺回（`probe-pointer-overlay.mjs`）
| 场景 | 结果 |
| --- | --- |
| 无覆盖层时世界区域鼠标按下（逻辑 800,400） | **夺回**：owner ai→human、aiEnabled=false、`reason=human-input` ✅ |
| 暂停菜单 UI 点击（INVENTORY 按钮） | **不夺回**：owner 仍 ai、aiEnabled=true；关闭覆盖层后仍 ai（无自抢）✅ |
| 覆盖层打开时非 UI 位置鼠标按下（逻辑 100,100） | **夺回**：owner→human、`reason=human-input` ✅ |

覆盖层内移动键 / F 夺回、升级卡片 UI 点击不夺回、暂停菜单 SETTINGS UI 点击不夺回，由 1aadd2e 第 7 项用例覆盖并由我的操作日志 `evidence/operation-log-overlay-ownership-1280x720.json` 记录（`inventory-open` / `ui-equip-click` / `inventory-close-no-takeover` / `levelup-card-ui-click` / `pause-settings-ui-click` / `levelup-KeyF-takeover` / `levelup-pointer-takeover`）。

### 5.3 关闭不自抢（`probe-no-reclaim.mjs`）
AI 持有 → `KeyI` 开背包 → 单一 `KeyW` 夺回（覆盖层保持打开，owner human、`aiEnabled=false`、`takeoverCount=1`、`reason=human-input`）→ 点 CLOSE 关闭 → 1.8s 后仍 owner=human、`aiEnabled=false`、`actionCount` 未增长、`txtControl=CONTROL HUMAN`。→ PASS

### 5.4 观察局部 / 遮挡拒绝（用例 8 操作日志 `evidence/operation-log-perception-bounds-1280x720.json`）
`visibilityBasis=grid-radius+explored+line-of-sight`、`radiusTiles=12`、`requiresExplored=true`、`requiresLineOfSight=true`；远处地板/远处墙 `canWalk=false`（即使标记为已探索仍 false）、`NaN/Infinity` 被拒；未探索房间敌人不可见、已探索但超距不可见、近处可见、**近处但被墙遮挡不可见**；Boss/传送门近可见远不可见；`targetRoom`/`phase` 不外泄；`perceivedIds=[2]`。→ PASS

### 5.5 复用上轮无夹具短演示（`probe-normal-run.mjs`，本提交）
无夹具声明：**不刷新无敌帧、不写 HP/坐标、不调 `hurt()/addXp()/spawnEnemy()`、不注入 seed**；只做真实 `NEW RUN → ESC → AI CONTROL ON → ESC` 与页内键鼠。
- 100 次 200ms 采样：真实 HP **100 → 最低 17**（自然受伤，未使用夹具），AI 持续持有（100/100 `lastIntentOwner=ai`），动作 `ENGAGE/TRAVEL/MOVE`，combat/elite 两房间，**2 次自然升级弹层**（真实 `1` 键选卡）。
- 墙碰撞：100/100 采样 walkable=true，同房间 97 步 max 1.951、均值 0.222，无穿墙/瞬移。
- 夺回：`KeyD` 移动 ✅、`KeyF` 交互 ✅；`fire-mouse` 一项在该探针里记为失败，但**根因是点击当时正好有自然升级弹层打开**（日志 `fire-mouse-enable-ai` 的 active=`["GameScene","LevelUpScene"]`）→ 按 C1 语义“UI 点击不夺回”属**预期行为**，不是缺陷；我另用 `probe-pointer-overlay` 在无覆盖层条件下重测世界区域鼠标按下 → **夺回成功**（见 5.2）。
- 暂停 OFF 独立复核 PASS（`AI CONTROL: ON` → 暂停冻结 → 点 OFF → `reason=pause-menu` → 恢复后仍 human、不自抢）。
- 0 console/page error；连续截图 `evidence-normal/`。

### 5.6 关闭覆盖层后权限是否恢复（`probe-resume-after-inventory.mjs`）
`KeyI` 开背包 → ESC 关闭：200/400/800ms 三次采样均为 `mode=AI`、`authorityPaused=false`、`gamePaused=false`，`actionCount` 4→5→8 持续增长（AI 真的恢复行动）；其后 1500ms 采样出现**自然升级弹层**，此时 `mode=PAUSED` 属覆盖层冻结的预期表现（弹层未结算时世界与权限均冻结），关闭/选卡后恢复。→ PASS（此前一次读数显示 “CONTROL PAUSED”，经此探针定位为覆盖层时序，非权限卡死）

## 6. 限制与未覆盖（不构成阻断）

1. **仍无外部 Agent**：HUD/暂停菜单一致 `LOCAL DETERMINISTIC` + `EXTERNAL NOT CONNECTED`；本轮未接入 LLM/Codex/MCP Agent，未把本地控制器或 Playwright 自动化当作真实 Agent/真人证据。
2. **不是 Headless World / Replay**：正式 World 仍为 Phaser 渲染、变长 dt、含视觉随机；`game:headless`/MCP 仍只覆盖 Station Zero 规则核心。
3. 用例 1/7 仍使用 i-frames 刷新（及用例 7 的第二把武器）作为夹具，**其连续 AI 采样不是真实生存/战斗证据**；我已另补无夹具真实受伤演示（5.5），**不宣称 P2 战斗胜利**。
4. 只覆盖 Chromium + 5 个指定桌面视口；无跨浏览器 / 触屏 / 高 DPI 验收；无系统键鼠注入。
5. `npm run build` 的 500kB chunk 警告为基线既有；生产构建 minify 类名，用例已改用 Phaser scene key（本次冻结产物验证通过）。
6. 800x600 最小物理字高 10.625px，较父提交改善但仍属小字号；建议后续 UI 阶段继续评估。
7. 本轮只复核 P1 修复范围（8 个 P1 用例 + 相关单测 329），**未重跑与 P1 无关的全量 35 项 E2E**，避免内存与端口干扰。
8. C1 后续可能还有新提交；本报告结论仅适用于 `1aadd2e`，不得混用父提交 `2d78e80` 的证据（上一轮证据在 `reports/ai-native-02/tester/p1-final/`，本轮在 `p1-fixes-final/`，两者目录隔离）。

## 7. 复现步骤

```bash
cd D:/Project/LAST_SIGNAL
git rev-parse 1aadd2e                  # 1aadd2e...
mkdir -p D:/Project/AI-NATIVE-02-snapshots/1aadd2e
git archive 1aadd2e | tar -x -C D:/Project/AI-NATIVE-02-snapshots/1aadd2e
# node_modules junction（不重复安装）
powershell -NoProfile -Command "New-Item -ItemType Junction -Path 'D:\Project\AI-NATIVE-02-snapshots\1aadd2e\node_modules' -Target 'D:\Project\LAST_SIGNAL\node_modules'"
cd D:/Project/AI-NATIVE-02-snapshots/1aadd2e
npx vite build --outDir "D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/p1-fixes-final/frozen-dist" --emptyOutDir
node node_modules/vite/bin/vite.js preview --outDir "D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/p1-fixes-final/frozen-dist" --port 5283 --strictPort
# 另开终端
cd D:/Project/AI-NATIVE-02-snapshots/1aadd2e
PORT=5283 LS_AI_EVIDENCE_DIR="D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/p1-fixes-final/evidence" \
  npx playwright test tests/ai-native-world.spec.ts --reporter=line --workers=1 \
  --output="D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/p1-fixes-final/pw-out"
# 无夹具独立探针（在仓库根执行，node_modules 可见）
cd D:/Project/LAST_SIGNAL
node reports/ai-native-02/tester/p1-fixes-final/probe-normal-run.mjs http://localhost:5283/
node reports/ai-native-02/tester/p1-fixes-final/probe-pointer-overlay.mjs http://localhost:5283/
node reports/ai-native-02/tester/p1-fixes-final/probe-inventory-paused.mjs http://localhost:5283/
node reports/ai-native-02/tester/p1-fixes-final/probe-resume-after-inventory.mjs http://localhost:5283/
node reports/ai-native-02/tester/p1-fixes-final/probe-no-reclaim.mjs http://localhost:5283/
# 视觉复核：打开 evidence/hud-ai-800x600.png 与 evidence/hud-ai-1024x768.png
```
