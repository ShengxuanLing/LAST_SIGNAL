# AI-NATIVE-02 P1 验收清单与可复用证据流程

- 对象：**正式 World 可见 AI 接管**（Phaser `index.html` / `GameScene` / `src/world/World.ts`），不是 Station Zero 切片，也不是 headless 核心。
- 本单只读，**不新增测试代码**；以下验收项凡尚未实现/未覆盖的一律标 `pending`。
- 真实性红线：本阶段的“AI”是 HUD 明示的 **LOCAL DETERMINISTIC** 本地确定性控制器，**不是真实 LLM**；不得写成外部 Agent/Codex 接入。headless/浏览器自动化不等于 Headless Agent 通道；开发者自测不能当独立验收。

---

## 0. 统一证据要求（每个验收项都要满足）

1. 记录被验收对象的 `git rev-parse HEAD` + `git status --porcelain` + 关键文件 MD5；仅接受**冻结**状态（见 §5 流程），开发中快照标注为 pre-check。
2. 识别实际运行的代码来源（冻结快照路径 / 端口），并在日志首行写明。
3. 浏览器交互只用页内 API：`page.keyboard` / `page.mouse` / `page.evaluate`；**禁止** OS 级键鼠（nut-js/robotjs/…）。
4. 每个截图标注：视口、缩放、内部逻辑分辨率；截图落仓库外或本 Worker 专属目录。
5. 每项保留完整日志，一行式 PASS/FAIL 回报 Lead。

## 1. 环境与入口（本单已核查）

| ID | 项 | 状态 | 依据 |
| --- | --- | --- | --- |
| E1 | 基线 typecheck/unit/build 在 clean 860a0dd 全 PASS（292 单测） | ✅ done | `BASELINE-VERIFICATION.md` §2 |
| E2 | 正式 World Playwright 入口可运行（PORT 感知用例在隔离端口跑通） | ✅ done | `07-pw-world-5280.log` 6 passed |
| E3 | 端口隔离方案可用（`PORT` + 自建 dev server / 冻结快照） | ✅ done | `04/07/10` 日志 |
| E4 | 硬编码 5173/5199 用例无法与开发者实例并发隔离 | ✅ 已定性 | §5，`08-pw-hardcoded-port.log` |
| E5 | 无 OS 级输入 API | ✅ done | 全库 grep + `BASELINE-VERIFICATION.md` §4 |
| E6 | 最终 P1 spec 入口：`tests/ai-native-world.spec.ts`（开发中，未跟踪） | ⏳ pending | 需冻结后确认存在且随最终提交 |

## 2. 可见 AI 接管（visible takeover） — pending

**要求**：人类在暂停菜单开启 AI 后，恢复游戏即可看到 AI 真正驱动世界上的人类角色（移动/交火/互动），HUD 明示控制权与“未连接外部 Agent”。

独立验证方法（页内句柄，冻结后重跑）：
- `gs.world.player.control.snapshot()` → `owner==='ai'`、`mode==='AI'`、`externalAgentConnected===false`；
- HUD 文本：`gs.txtControl` 含 `LOCAL DETERMINISTIC`；`gs.txtAgentLink` 含 `EXTERNAL NOT CONNECTED`；`gs.txtAiAction`/`gs.txtAiTarget` 随运行变化；
- 采样玩家 `grid (wx,wy)` 与 `lastIntentOwner==='ai'`，要求**真实位移**（多帧不同位置）与动作序列 `aiActionCount>1`；
- 截图：开启前/后 HUD 对比；确认画面上是可见角色的行为，不是 HUD 数字自证。

证据要求：≥8 个连续采样（位置+action+target+intentOwner）、2 张以上截图、0 console/page error。

当前状态依据：WIP 快照可观察到 `mode=AI · LOCAL DETERMINISTIC`、`ENGAGE`、真实移动（`13-takeover-probe-wip.log`）；但开发中 spec 在“位移点数 >2”上曾失败（`14-pw-wip-p1-precheck.log`）。**最终判定 pending。**

## 3. 停止（stop / disable） — pending（覆盖缺口）

**要求**：AI 激活时，从暂停菜单把 `AI CONTROL` 切回 `OFF`，恢复后 AI 立即停止、控制权回到 human，且不会自行重新接管。

独立验证方法：
- 暂停菜单点 `AI CONTROL: ON · LOCAL DEMO`（`PauseScene` 逻辑坐标 640,540）→ 恢复（ESC/`RESUME`）；
- 断言 `aiEnabled===false`、`owner==='human'`、`lastTakeoverReason==='pause-menu'`、`takeoverCount` 递增；
- 恢复后再采样 ≥3s：玩家位置不再因 AI 改变，`lastAiAction` 清零，HUD 回到 `HUMAN`。

当前状态：**开发中 spec 未覆盖“AI 运行中手动关闭”路径**（只覆盖人类按键夺回）。需补测或由独立验收脚本覆盖 → `pending`。

## 4. 安全夺回（human reclaim） — pending（已有 WIP 覆盖，待独立复验）

**要求**：AI 持有时，人类任意移动/开火/交互输入**当帧**夺回；不得瞬移、不得卡死、AI 不得立刻反抢。

独立验证方法：
- AI 运行中记录 `before={grid, hp}`；
- `page.keyboard.down('KeyD')` 450ms 后 `up`；断言 `owner==='human'`、`aiEnabled===false`、`takeoverCount===1`、`lastTakeoverReason==='human-input'`、`lastIntentOwner==='human'`；
- 玩家位移连续（`grid` 变化且未跳到非法位置）；随后 ≥2s 内 `owner` 保持 human。
- **注意**：采样期间若 AI 升级触发 `LevelUpScene`，按键会被 `LevelUpScene` 吃掉 → 必须等/关掉升级覆盖层后再做夺回，否则假失败（WIP 实测 `13-takeover-probe-wip.log`）。
- 另需覆盖第二名夺回场景：开 AI → 停止 → 再开 AI → 再按键夺回，`takeoverCount` 正确累加。

## 5. 暂停（pause） — pending（已有 WIP 覆盖，待独立复验）

**要求**：ESC 暂停后世界与 AI 完全冻结；暂停菜单显示控制归属；恢复后按之前的启用状态继续（AI 若仍启用则继续 AI）。

独立验证方法：
- AI 运行中 ESC → 断言 `gs.paused===true`、`control.paused===true`、`mode==='PAUSED'`；
- 相隔 ~900ms 两次采样 `grid` 完全相同（`toBeCloseTo(…,6)`），且 `aiActionCount` 不增长；
- ESC 恢复 → `gs.paused===false` 且 `owner==='ai'`（若仍启用）；
- 菜单文本 `CONTROL  AI · LOCAL DETERMINISTIC DEMO` / `EXTERNAL AGENT  NOT CONNECTED`。

## 6. 死亡（death） — pending（已有 WIP 覆盖，待独立复验）

**要求**：死亡结束本局，控制权与 AI 状态显式回收；GameOver 过渡期不得有残留 AI 意图；本局 run checkpoint 清除、永久数据不受影响（沿用既有 GDD-03 口径）。

独立验证方法：
- 走真实死亡路径：`gs.world.player.invuln=0; gs.world.player.hurt(999999, player.wx+1, player.wy)`（或既有 `world.onPlayerDeath()`，但优先真实受伤路径）；
- 断言进入 `GameOverScene`、`owner==='human'`、`aiEnabled===false`、`control.paused===true`、采样期间无 AI 动作增长；
- localStorage：`last_signal_save_v1.run` 被清、`permanent` 不变；
- 新开一局：`owner==='human'`、`aiEnabled===false`、`aiActionCount===0`、`takeoverCount===0`（无跨局残留）。

## 7. 五种分辨率验收 — pending（当前仅覆盖 3/5）

要求视口：`1920x1080`、`1366x768`、`1280x720`、`1024x768`、`800x600`。

每个分辨率都要：
1. `page.setViewportSize({width,height})` 后启动固定种子真实 run，开启 AI 并运行 ≥2s；
2. 画布完整可见：`rect.x>=0 && rect.y>=0 && rect.x+w<=innerWidth+1 && rect.y+h<=innerHeight+1`；
3. HUD 右列 7 行（weapon/room/enemies/control/aiAction/aiTarget/agentLink）都在逻辑 `[0,1280]x[0,720]` 内、宽高 >0、互不重叠；
4. 控制行含 `LOCAL DETERMINISTIC`、链接行含 `EXTERNAL NOT CONNECTED`；
5. 可读性：`物理字号 = 逻辑字号 × 缩放`，800x600 最小 ≈8.1px（13×0.625），需记录并人工看截图；
6. 截图 + 0 console/page error。

当前状态：开发中 spec 的循环只含 `1920x1080`、`1024x768`（+ 默认 1280x720）→ **`1366x768`、`800x600` 未覆盖，pending**。点击/HUD 采样必须按 §6 的 canvas 缩放变换（`13-takeover-probe`/`12-resolution-probe` 已验证换算正确）。

## 8. 诚实性与边界 — 每轮都要断言

- HUD/暂停菜单/报告都不得出现“外部 LLM/Codex 已接入”“真实 AI 通关”等表述；必须出现 `LOCAL DETERMINISTIC` 与 `EXTERNAL NOT CONNECTED`。
- 本地确定性控制器不得越权：不得直接写坐标/HP（源码只返回 `PlayerIntent`，由 `Player.applyIntent` 执行）——验收可用“暂停时 AI 不推进”“夺回后 AI 不动作”间接证明。
- headless 通道（`game:headless` / MCP）只证明 Node 侧规则核心，不能替代浏览器 World 的可见验收。
- 报告附 commit + 工作树状态；开发中快照一律标注 pre-check。

---

## 5'. 可复用证据流程（最终验收执行顺序）

> 冻结与运行命令（Windows / 本仓库实测）

```powershell
# 0) 记录被测状态
git rev-parse HEAD; git status --porcelain
md5sum src/entities/Player.ts src/scenes/GameScene.ts src/scenes/PauseScene.ts src/world/World.ts src/ai-native/*.ts tests/ai-native-world.spec.ts

# 1) 冻结快照（仓库外，避免与开发者共享工作树/HMR 干扰）
$SNAP = "$env:TEMP\ai-native-02-accept\ws"
robocopy "D:\Project\LAST_SIGNAL" $SNAP /E /XD node_modules .git dist dist-mcp reports test-results screens tests\screens
New-Item -ItemType Junction -Path "$SNAP\node_modules" -Target "D:\Project\LAST_SIGNAL\node_modules"

# 2) 专属端口起 dev server（strictPort 防止串端口；不用 5173/5199）
#    cwd = $SNAP
node node_modules/vite/bin/vite.js --port 5281 --strictPort

# 3) 从快照跑正式 World E2E（隔离端口/产物/截图）
#    cwd = $SNAP
$env:PORT='5281'; $env:LAST_SIGNAL_ROOT=$SNAP
$env:LS_SHOT_DIR='D:\Project\LAST_SIGNAL\reports\ai-native-02\tester\shots'
npx playwright test tests/ai-native-world.spec.ts --reporter=line --workers=1 --output=reports\ai-native-02\tester\pw-out-accept
```

- 需要跑 `audit`/`runtime-bugs` 时用同一快照（`audit` 依赖 dev server 的 `/src` 动态导入；`runtime-bugs` 需 `LAST_SIGNAL_ROOT` 指向快照）。
- `canvas.spec.ts`(5199) / `boss-room.spec.ts`(5173) 无法隔离：只有确认这两个端口上的 server 对应**同一冻结快照**且无编辑时才能纳入；否则单独说明或交 Lead 决策。
- 跑前确认无游离 chromium/node；一次一个 spec；单 spec 失败仍保留 `error-context.md` 与截图。
- 分辨率验收按 §7 的 5 个视口逐一执行，截图命名 `hud-ai-<w>x<h>.png`，并保存 HUD 文本与 rect 数据。
- 每轮结束：一行式 PASS/FAIL + 命令 + 结果 + 日志路径回报 Lead；失败附最相关一行错误。

## 6'. 与开发中 spec 的差距清单（供 Lead 排期）

| 缺口 | 说明 |
| --- | --- |
| 1366x768 / 800x600 | 开发中 spec 未覆盖，需补 |
| AI 运行中“停止” | 未覆盖暂停菜单把 AI 关掉的路径 |
| 夺回时的升级覆盖层 | 未处理 `LevelUpScene` 会吞按键的问题（flaky 风险） |
| 可读性断言 | 只断言 HUD 在逻辑边界内，未断言缩放后的物理字号/清晰度 |
| 500kB chunk 警告 | `npm run build` 既有警告，非本阶段阻断，保持记录 |
| 硬编码端口用例 | 影响并发隔离，需 Lead 决定是否后续统一为 `PORT` |
