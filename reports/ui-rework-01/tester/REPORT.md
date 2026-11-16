# UI-REWORK-01 — Tester report

被测树（本地，未提交、未 push、未 commit）

- 分支：`fix/ui-menu-layout-rework`
- HEAD：`0faf95cc1e6f55cdf23e07cd4fe1c05f5d478c48`（= 本地 main，含完整 AI-NATIVE-02）
- dirty：**是**。开发者未提交的实现改动 + 测试者的测试改动都在工作区：
  - `src/scenes/PauseScene.ts`（重写，sha256 `3f01ebae…`）
  - `src/scenes/GameScene.ts`（+30 行，`setHudVisible`，sha256 `aec3ff04…`）
  - `src/ui/menuKit.ts`（新增，sha256 `c20131b2…`）
  - `src/world/World.ts`（−13 行，Lead 指定的既有未提交修复，保留未动）
  - `src/` 合并 diff 的 sha256：`68c9cdb4eeb90442f07a8feffbd95126d24aee32401acac6fe5cbcac4ec1528d`
- 测试改动（全部在 `tests/`）：`tests/ui-menu-layout.spec.ts`（新增）、`tests/uiNav.ts`（新增）+ 11 个旧 spec 的导航适配，`git diff --stat tests/` = 11 files, 186 insertions(+), 129 deletions(-)。
- 证据目录：`reports/ui-rework-01/`（`before/`、`after/`、`logs/`、`tester/`）。未提交。

## 1. 用户四项完整回归（被测树 = 上述 dirty 树）

| # | 命令 | 结果 | 日志（绝对路径） |
|---|---|---|---|
| 1 | `npx tsc --noEmit` | **PASS**（0 error） | `D:\Project\LAST_SIGNAL\reports\ui-rework-01\logs\33-typecheck.log` |
| 2 | `npx vitest run` | **PASS** 745/745（65 files，165s） | `D:\Project\LAST_SIGNAL\reports\ui-rework-01\logs\32-unit.log` |
| 3 | `npm run build` | **PASS**（exit 0） | `D:\Project\LAST_SIGNAL\reports\ui-rework-01\logs\34-build.log` |
| 4 | `PORT=5433 npx playwright test --workers=1`（113 tests，37 spec） | **PASS 113/113**（13.7m） | `D:\Project\LAST_SIGNAL\reports\ui-rework-01\logs\37-final-e2e-full-rerun.log` |

第 4 项在最终确认轮（`37-...`）之前还跑过两轮：`28-e2e-full.log` = 112/113（P1 一次 `disabled AI does not move the player` 抖动，已修），`35-final-e2e-full.log` = 113/113。最终结论以 `37-` 为准（同一棵树、同一棵 spec）。

旧基线对照（同一份 spec，改 UI 之前）：E2E 91/93（P1 + P3-a 红）、unit 743/745（2 条 `spawnSync ETIMEDOUT`）。**没有沿用旧数字**，本报告所有计数都来自本轮实跑。

## 2. before / after 证据（6 个 viewport × 每个页面一张真实截图）

| 阶段 | 来源 | 截图 | 布局审计 |
|---|---|---|---|
| before | 干净 worktree `D:/tmp/ls-ui-before`（detached HEAD `0faf95c`，无开发者改动）dev :5434 | `reports/ui-rework-01/before/` **42 张** = 6 viewport × 7 页面（run-hud / pause / settings / inventory / pause-ai-on / echo / llm） | 每个 viewport **4 clipped + 30 overlaps**，`before/audit-before-<w>x<h>.json` |
| after | 工作区实现 dev :5433 | `reports/ui-rework-01/after/` **48 张** = 6 viewport × 8 页面（+ 独立的 `ai` hub 页与 `ai-on`） | 每个 viewport **0 clipped + 0 overlaps**，`after/audit-after-<w>x<h>.json` |

视口：1920x1080、1600x900、1366x768、1280x720、1024x768、800x600（1600x900 为额外无重叠检查，已含在 6 个之内单独审计）。

before 审计确认的真实缺陷（`before/audit-before-1280x720.json`，截图 `before-1280x720-echo.png` 一张图即可看到全部）：

1. `SIGNAL COLLABORATION` 开关建在 `(0,105)` 而没加进 wrap 容器 → 渲染在左上角、半截出界（4 个 clipped）。
2. 旧 settings 面板没有真正销毁：实测打开 SETTINGS → BACK → 进 ECHO 页，settings 面板仍压在 ECHO 页上（`before-1280x720-echo.png`），泄漏的箭头/面板/`EXTERNAL LINK SETUP` 与后续页面重叠。
3. `AUTHORIZE EXTERNAL AGENT`(y=622) 与 `ANY MOVE / FIRE INPUT TAKES HUMAN CONTROL`(y=625) 文字互相压叠。
4. `ECHO COMPANION >`(y=200) 与 `LLM COMPANION >`(y=230) 两个入口重叠。
5. 底部 `CONTINUE RESUMES…`/`CONTROL…` 等状态文字与 GameScene HUD 文字互相压叠（HUD 未隐藏）。
6. LLM 页 340px 宽按钮装不下 `ENABLE / RE-AUTHORIZE (HUMAN)` 这类长标签，标签溢出到相邻按钮。

after 同一审计全绿，且 HUD 在暂停时被 `GameScene.setHudVisible(false)` 收起 —— 这一点用 `before/…-pause.png` vs `after/…-pause.png` 对照即可看出。

## 3. 本任务新增测试（`tests/ui-menu-layout.spec.ts`，20 条；辅助 `tests/uiNav.ts`）

审计/截图（6 viewport × 2）：

- `capture <w>x<h>`：真实点击走完 run-hud → PAUSE → SETTINGS → INVENTORY → **AI & COMPANION** → AI CONTROL(ON/OFF) → ECHO → LLM 全链路并截图。
- `audit <w>x<h>`：结构审计断言
  - 可见可点击元素不得超出 1280x720 逻辑视口；
  - 不同控件不得重叠（同一按钮的 rect+label、非交互面板包含子项、label 位于自身 rect 内 = 合法父子例外；两个**可交互**控件互相包含、或任何部分相交 = 失败）；
  - 不可见元素不得可点击；
  - 六个 viewport 全部 0/0。

导航与 ESC 层级（`navigation: ESC walks exactly one level back`）：

- root ESC = 恢复游戏，暂停期间 `world.sim.tick` 不前进，HUD 恢复；
- `ai → pause`、`echo/llm → ai`、`settings → pause`、`inventory(从 pause 进) → pause`；
- 直接 `KeyI` 打开的单层 inventory：ESC 直接恢复游戏；
- DOM 表单：焦点在表单内按 ESC 只关表单、不导航、不关暂停层。

功能覆盖：

- `functional: settings change, persist and reset; AI local toggle`：MASTER ▶ 后写入存档并更新标签、RESET AUDIO 恢复 0.7/0.8、SCREEN SHAKE 标签跟随真实值、SIGNAL COLLABORATION 持久化、AI CONTROL 开关 + 恢复后 owner 变 ai/human。
- `functional: ECHO enable, mode and assist arming`：ENABLE ECHO 在**冻结的世界里不会立刻出现 actor**（没有假装），恢复后下一个真实 tick 才出现并显示真实 HP；FOLLOW/HOLD/MOVE-TO 切换；CONFIRM ASSIST → ASSIST ARMED → REVOKE；DISABLE 同样等到下一个真实 tick 才消失。
- `functional: LLM page is honest without a model; failure feedback; no secret leak`：未连接时显示 NOT CONNECTED / NO MODEL / no pending；无 pending 下点 CONFIRM/REJECT/DISCONNECT 无副作用；真实 Owner 表单提交到不可达 bridge → 显示真实 FAILED 反馈、无假 CONNECTED、token/ownerKey 从 DOM 清空且不出现在场景文本里。
- `functional: real pending proposal — Owner CONFIRM commits, REJECT does not`：真实 `startWorldBridge` + 官方 Companion MCP SDK 产生 pending → 只有渲染出 pending 后 CONFIRM/REJECT 才可点 → CONFIRM 在暂停时只入队（`hasPendingCompanionIntent === true`）→ 恢复后由下一个真实 tick 提交（pending 清空、tick 前进）→ 第二条 proposal 被 REJECT 后**不**产生入队 intent → DISCONNECT 后状态不再是 CONNECTED 且 CONFIRM/REJECT 变灰。
- `functional: level-up, death and restart keep the menu honest`：LevelUpScene 打开时 ESC 不恢复、tick 不前进，选卡后恢复；真实致死伤害进入 GameOverScene；`RETRY SAME SEED` 后是全新、未暂停、满血的一局，且暂停/恢复仍可用。

边界：

- `boundary: repeated open/close never stacks or leaves hidden controls`：4 轮开关 + 3 轮全页面往返，每个页面的可交互控件数量恒定、关闭后 0 个可交互对象、根页无残留子页标签。
- `boundary: keyboard focus, wheel and real click agree`：滚轮不拖动菜单、不产生越界；↑↓ 移动焦点、ENTER 激活焦点控件（进 INVENTORY）；UP 环绕到最后一个控件；用报告出的中心点真实点击 SETTINGS 有效。

## 4. 因 UI 导航变更而适配的旧测试（只改导航，不删断言、不弱化安全断言）

新增 `tests/uiNav.ts`（`toPauseRoot / openAiHub / openEcho / openLlm / openSettings / openExternalLinkSetup / resumeGame / clickLabel / waitForButton / labelCenter`），
把「在 Pause 根页直接点 ECHO/LLM/AUTHORIZE/AI CONTROL」改成「Pause 根 → AI & COMPANION → 控件」，把「ESC 一次关掉整个覆盖层」改成 ESC 链（逐层）。

| 文件 | 改动 |
|---|---|
| `c3b-external-link.spec.ts` | 3 处授权入口改走 AI hub；ESC 关闭改 `resumeGame` |
| `c3b-hard-disconnect.spec.ts` | 授权入口走 AI hub |
| `c3b-link-form.spec.ts` | SETTINGS→EXTERNAL LINK SETUP 改用页面导航；AI CONTROL 走 hub；表单内 ESC 断言改为新契约（只关表单、页面/控制权不变），CANCEL 行为单独断言 |
| `c3c-bridge-reclaim.spec.ts` | 授权入口走 AI hub；ESC→`resumeGame` |
| `companion-room-cancel.spec.ts` / `companion-room-race.spec.ts` | `LLM COMPANION >` → `openLlm`；ESC→`resumeGame` |
| `p3b-companion-owner.spec.ts` / `signal-coop-e2e.spec.ts` | 同上 + CONFIRM 前 `waitForButton`（LLM 页轮询真实 pending，只有渲染出来才可点，避免测试比 UI 先手） |
| `signal-sdk-negative.spec.ts` | 授权入口走 AI hub |
| `audit.spec.ts` | SETTINGS 页面化后按真实 `◀` 控件坐标点击、音量值改读真实百分比文本、QUIT TO MENU 按标签点击、ESC 从 settings 改为「回根页 + 再恢复」并保留「离开 settings 后游戏确实恢复」的原断言 |
| `ai-native-world.spec.ts` | AI CONTROL/ECHO/QUIT/SETTINGS 全部改按标签/页面导航；`settings panel opened` 改判 `page === 'settings'`；暂停标签断言改为新文案（`AI CONTROL: ON · LOCAL DETERMINISTIC DEMO` / `CONTROL  AI · LOCAL DEMO`，并新增「仍声明 EXTERNAL AGENT NOT CONNECTED」） |

### 4.1 顺带修正的测试夹具（Lead 指定的 invuln 问题）

`Player.invuln` 只有 getter（`src/entities/Player.ts:64` → `World.playerInvuln`），所以 `player.invuln = 1e9` / `= 0` 都是**静默空操作**；旧 spec 的「i 帧刷新」与「清 invuln 再击杀」都是无效夹具（这也是 P1/P3-a 长期红的根因）。本轮按真实 core 接口处理，未放宽任何断言：

- `stabilizeEvidenceRun`：改为 `World.enqueueHeal(...)`（真实 core 命令，下一 tick 提交），仅在 HP < 35% 时救命；敌人、开火、伤害全部保留，`evidence-fixture` 记录字段改为真实的 `hpToppedUpBelow35Pct` / `iframesWritten: false`（不再写 `onlyIFramesRefreshed: true` 这种与事实不符的声明）。
- P1 死亡步骤：不再写 `invuln = 0`，改为用真实 core tick 等残余 i 帧自然过期（最多 180 tick）后再 `hurt()`。
- P3-a 使用 `stabilizeEvidenceRun(page, false)`，保持完全真实的战斗。
- 结果：P1、F-04/F-05、P3-a 由长期红/抖动转为稳定绿（P1 连续 5 次隔离复跑全绿 + 最终全量绿）。

## 5. 过程中向 developer 提出、已修复的问题

1. `npx tsc --noEmit` 一度 32 个错（`Property 'W' does not exist on type 'UITokens'`，PauseScene 的 `UI.W/H` 与 art token 冲突）→ 已修，现为 0。
2. LLM 页 `MODEL  NOT CONNECTED` 文本框与 `ENABLE / RE-AUTHORIZE` 按钮相交 198px²（1280x720）→ 已修，现为 0 overlap。
3. 早期观察到「点击表单 AUTHORIZE 会同时触发下层 Phaser BACK」的间歇现象，在开发者后续修改后不再复现（本轮 20 条 UI 测试 + 3 次全量均未复现），仅记录、不作结论。

## 6. 说明与遗留

- 本任务 **未提交、未 push、未 merge**，所有改动留在工作区供 Lead/用户 review。
- 截图/日志中不含 token、Owner key、bridge 凭据（LLM 失败反馈用例显式断言 token/ownerKey 不出现在 DOM 输入框与场景文本中；截图只拍表单与菜单）。
- 早期几轮 P1 复跑曾写入 `reports/ai-native-02/evidence/`（该目录在本任务开始前已是 dirty）；自那之后所有跑动都设置 `LS_AI_EVIDENCE_DIR=reports/ui-rework-01/tester/evidence`，不再触碰 `/reports/ai-native-02`。
- `tests/ui-menu-layout.spec.ts` 默认 `UI_PHASE=auto`，全量回归时不会再覆盖 `before/`、`after/` 证据；重抓 before 需显式 `UI_GEN=old UI_PHASE=before`（对 HEAD 干净树运行的命令见本文件第 2 节）。
- 独立审查：本轮为测试者在真实浏览器/真实 core 上的实测；Lead 要求的 reviewer 独立审查不属本报告范围。
