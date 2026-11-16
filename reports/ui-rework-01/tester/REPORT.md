# UI-REWORK-01 — Tester 最终验收报告（冻结版）

日期：2026-11-16/17　测试执行者：Orca worker（tester，唯一 tests 书写者）
本报告 supersedes 先前的 `tester/REPORT.md`（WIP 阶段版本）。

## 1. 冻结校验（先做，结论有效的前提）

| 项 | 冻结值（Lead 订单） | 实测 | 结果 |
|---|---|---|---|
| `src/scenes/PauseScene.ts` | `3f01ebae1ffb5a4edd158268ba9476262cfb36b492bbc79eaea9dc006ab08e5e` | 同 | ✅ |
| `src/ui/menuKit.ts` | `c20131b2a402db12f1cb590754c4478c73269599f3611b1e1824fdd0f2becffd` | 同 | ✅ |
| `src/scenes/GameScene.ts` | `aec3ff04e443fba87e1b1d52b334e297c62ed9be5670caeeb5c4a2d283a726f0` | 同 | ✅ |

- 实现已由 Lead 本地提交：HEAD = **`eb83eb4`** `fix(ui): unify pause menus, companion management and responsive navigation`（父提交 `8b8418a` = `src/world/World.ts` 删除 13 行别名，Lead 指定的既有修复）。
- 工作区 dirty **只涉及 2 个测试文件**，实现与冻结 hash 完全一致：
  - `tests/ui-menu-layout.spec.ts`（新增 5 条本单要求的新覆盖、证据写入默认改 `UI_PHASE=auto`）
  - `tests/audit.spec.ts`（teleport 步骤改为等真实落点提交，见 §6/§10）
  - `git status --porcelain src/` = 空；`git diff --stat tests/` = 2 files, +26/−15。
- 结论：**冻结成立**，本节之后的所有数字都是在上述实现 hash 上跑出来的。

## 2. 用户四项完整回归

| # | 命令 | 结果 | 绝对日志 |
|---|---|---|---|
| 1 | `npm run typecheck` | **PASS** exit 0 | `D:\Project\LAST_SIGNAL\reports\ui-rework-01\logs\51-typecheck.log` |
| 2 | `npm test` | **PASS** 745/745（65 files） | `D:\Project\LAST_SIGNAL\reports\ui-rework-01\logs\52-npm-test.log` |
| 3 | `npm run build` | **PASS** exit 0 | `D:\Project\LAST_SIGNAL\reports\ui-rework-01\logs\53-build.log` |
| 4 | `PORT=5433 npx playwright test --workers=1` | 见下（118 tests，含本 spec **25** 条） | `…\logs\54-final-full-playwright.log`、`…\logs\60-final-full-playwright.log`、`…\logs\62-final-full-playwright-2.log` |

> 计数边界（回应 reviewer §1）：`37-…` 的 **113** 与 `62-…` 的 **118** 是**不同测试集合快照**（`37-` 跑在 `eb83eb4` 之前，本 spec 当时还没有现在的 25 条定义），不能当成「同一集合的通过率」。本 spec 目前每条运行计 **25** 条（6 capture + 6 audit + 13 单例），`62-…` 是当前集合的**单次全量绿**，不代表确定性稳定（前两轮各 117/118）。

第 4 项本轮共跑了 3 次全量，逐次如实记录：

| 运行 | 结果 | 唯一失败 | 隔离复跑 | 分类 |
|---|---|---|---|---|
| `54-…` | 117/118 | `audit.spec` `fixed-seed playability` → teleport 落点差 13 格（交互未发生） | 见 §10 | 已定位并修（轮询 `F` 前的落点同步 + 真实提交条件等待），修后 5/5 绿 |
| `60-…` | 117/118 | `whale-character.spec` → `whale-dash` 效果 5s 内未出现 | 3/3 PASS（`61-whale-isolate-1..3.log`） | 负载相关既有 flake，非本单改动 |
| `62-…` | **118/118 PASS** | — | — | 当前集合的单次全量绿 |

**没有任何一条失败被“放宽 timeout/弱化断言”处理**。`audit.spec` 的 teleport 步骤（返修后，见 §10）：去掉了 `.catch` 吞错，去掉“固定 500→1200ms sleep”，改为**两个真实条件等待**（先在 portal 格、再在目标落点且换房、最后 camera 收拢到原 120 阈值），几何断言（`< 0.01` 格、sprite 误差 `< 1`、camera `< 120`）一字未改。

### 2.1 最终全量运行

`PORT=5433 npx playwright test --workers=1` → **PASS 118/118（14.7m）**，日志
`D:\Project\LAST_SIGNAL\reports\ui-rework-01\logs\62-final-full-playwright-2.log`。
这一轮与冻结实现（PauseScene/menuKit/GameScene 三份 hash 均未变）和当时的测试文件对应；它是**单次**全量绿：两轮 117/118 的红均为与本单无关的既有 flake（§6 #2/#3/#5），隔离已复跑。返修后按 reviewer 建议只跑了针对性回归（§10），未再跑全量。

## 3. before / after 真实截图与结构审计

| 阶段 | 运行环境 | 截图 | 结构审计 |
|---|---|---|---|
| before | 干净 worktree `D:/tmp/ls-ui-before`（detached `0faf95c`，无任何实现改动），dev **:5434** | `reports/ui-rework-01/before/` **42 张** = 6 视口 × 7 页（run-hud/pause/settings/inventory/pause-ai-on/echo/llm） | 每个视口 **4 clipped + 30 overlaps**（`before/audit-before-*.json`，日志 `logs/36-recapture-before-pristine.log`） |
| after | 冻结实现，dev **:5433** | `reports/ui-rework-01/after/` **53 张** = 6 视口 × 8 页（含独立 `ai` hub、`ai-on`）+ 5 张交互过程图（owner form 填写/失败、connected、pending proposal、after reject） | 每个视口 **0 clipped + 0 overlaps**（`after/audit-after-*.json`，日志 `logs/50-after-capture-audit-frozen.log`、`logs/59-after-interaction-frozen.log`） |

视口：1920x1080、1600x900、1366x768、1280x720、1024x768、800x600（1600x900 为额外无重叠检查）。

- **before 证据是干净 HEAD 的真实运行**；最初一轮曾用共享工作区 dev（HMR 已加载开发者改动）抓到过被污染图，已移到 `tester/contaminated-before/` 且不用于任何结论。
- before 一张图可复现全部原始缺陷（`before-1280x720-echo.png`）：旧 settings 面板未销毁直接压在 ECHO 页、`SIGNAL COLLABORATION` 建在 `(0,105)` 半截出界、`AUTHORIZE EXTERNAL AGENT` 与 `ANY MOVE / FIRE…` 重叠、`ECHO COMPANION >` / `LLM COMPANION >` 两入口重叠、HUD 文字透过暂停层。
- after：同六视口全部 0 越界 / 0 重叠，且暂停时 HUD 由 `GameScene.setHudVisible(false)` 收起、恢复时还原。

## 4. 本单要求的覆盖项对照（全部实跑）

| 订单要求 | 覆盖 | 证据 |
|---|---|---|
| 六视口各主要页真实截图 | 6 视口 × 8 页 = 48 张 | `after/*.png`（`logs/50-…`） |
| CSS / 字体 | 六页所有 Phaser Text 都必须落在共享 mono 栈（`Consolas/…/monospace`，缺失即失败）；DOM 表单 computed `font-family`/`font-size ≥ 12px` | `audit: shared font stack…`（`logs/59-…`） |
| 合法父子例外重叠 | 同控件 rect+label（box 相同）、非交互面板包含子项、label 位于自身 rect 内 = 合法；两个**可交互**控件互相包含或任意部分相交 = 失败 | `audit <vp>`、`auditLayout()` |
| viewport | 可见可点击元素必须完全落在 1280x720 逻辑视口内 | `audit <vp>` |
| 点击 | 按渲染出的 label 真实点击（真实命中区，不是直接调 handler） | 全部导航/功能用例 |
| 滚动 | 滚轮不得拖动菜单元素、不得产生越界 | `boundary: keyboard focus, wheel and real click agree` |
| focus | ↑↓ 移动焦点、ENTER 激活焦点控件、UP 环绕；禁用控件永不被聚焦 | 同上 + `audit: …disabled…` |
| disabled | 无 pending 时 CONFIRM/REJECT 禁用：点击无副作用、键盘不可达 | `audit: …disabled…` |
| 销毁 / resize | 每个页面在 800→1600→1366→1280 视口切换下页面不变、控件数不增、布局审计 0 失败；离开再进入控件数恒定；关闭后 0 个可交互对象、无残留页标签 | `audit: …resize and destroy…`、`boundary: repeated open/close…` |
| HUD | 暂停时 HUD 隐藏、恢复后还原 | `navigation: ESC walks…`（`hudVisible`） |
| death / levelup / restart | LevelUpScene 打开时 ESC 不恢复且 tick 不动、选卡后恢复；真实致死 → GameOverScene；`RETRY SAME SEED` → 全新满血未暂停的一局，暂停/恢复仍可用 | `functional: level-up, death and restart…` |
| Settings 持久化重开与音量 | +10% 写入存档并更新标签 → 退出/恢复/重进仍显示同值且存档一致 → RESET AUDIO 回 0.7/0.8 并持久 | `functional: settings persist across reopen and reset` |
| EQUIP 键盘可达 | 真实 core 命令加第二把武器 → 物品栏按 `2` 只入队（core 未变、UI 显示 QUEUED）→ 恢复后下一个真实 tick 装备 → 重进显示 EQUIPPED | `functional: inventory EQUIP is keyboard reachable…` |
| 真实 bridge + Owner form 成功 | 本地 bridge + 官方 MCP SDK + 真实 owner key → CONNECTED，pending 渲染后才可确认 | `functional: real pending proposal…` |
| 失败反馈 | 不可达 bridge → 真实 FAILED 文案、无假 CONNECTED、token/ownerKey 从 DOM 清空且不出现在场景文本 | `functional: LLM page is honest…` |
| reauth 同实例原子 cap、旧建议失效 | 实时 link 打标记 → 人工 RE-AUTHORIZE → 仍 CONNECTED 且 `companionLink` 是**同一实例**（标记仍在）→ 旧 proposal 退役（CONFIRM 禁用、点击不入队）→ **同一 SDK 会话 observe 被拒（真实原因 `no_observation` / `E_LINK_UNAVAILABLE`：reauth 只清空已发布 observation、session/epoch 不变）** → 恢复真实 tick 让渲染侧重新发布 observation → 同会话 observe/suggest 成功 → CONFIRM 启用 → 人类 CONFIRM → `hasPendingCompanionIntent === true` → DISCONNECT 后 UI 如实离线 | `functional: owner re-authorize swaps capability…`（`tester/addendum/reauth-regression.log`） |
| pending 绑定 id / 过期不误确认 | proposal 带 ttl，真实 tick 过期后 CONFIRM 变灰、UI 显示 no pending、点击不入队 | `functional: an expired proposal is never confirmed` |
| Confirm / Reject / Disconnect | CONFIRM 暂停时只入队 → 恢复后真实 tick 提交；REJECT 不产生入队 intent；DISCONNECT 结束真实连接且按钮变灰 | `functional: real pending proposal…` |
| 不许造假 pending/connected | 所有 pending 都来自真实 bridge + 官方 SDK；无模型时显示 `STATE OFF` / `MODEL NOT CONNECTED` / `No pending proposal.`；错误 owner key 走既有协议显示 `FALLBACK:NO_MODEL` + `MODEL  OFFLINE`（未要求改成 CONNECTED） | 同上 + `…honest…` |
| ESC 层级 | root→恢复；ai→pause；echo/llm→ai；settings→pause；pause 进的 inventory→pause；直接 KeyI 的单层 inventory→恢复；表单内 ESC 只关表单 | `navigation: ESC walks exactly one level back` |
| 只读抓手 | `currentPage` / `uiObjects` / `uiButtons` 未强行依赖（测试用渲染结果与真实点击）；`btn*`、`confirmHandle`/`rejectHandle(.rect/.label/.enabled)`、`llmConfirm`/`llmReject` 别名按只读使用 | 全部 |

## 5. 旧测试适配（只改导航/页面模型，未删断言、未弱化安全断言）

新增 `tests/uiNav.ts`：`toPauseRoot / openAiHub / openEcho / openLlm / openSettings / openExternalLinkSetup / resumeGame / clickLabel / waitForButton / labelCenter / pausePage`。

| 文件 | 适配内容 |
|---|---|
| `ai-native-world.spec.ts` | AI CONTROL/ECHO/QUIT/SETTINGS 改按 label 与页面导航；`settings panel opened` 判 `page==='settings'`；暂停标签断言更新为冻结文案（`AI CONTROL: ON · LOCAL DETERMINISTIC DEMO`、`CONTROL  AI · LOCAL DEMO`）并**新增**“仍声明 EXTERNAL AGENT NOT CONNECTED”；invuln 夹具改为真实 core 接口（见 §6） |
| `audit.spec.ts` | SETTINGS 页面化后按真实 `◀` 控件点击、音量断言改读真实百分比文本、QUIT TO MENU 按 label 点击、ESC 从 settings 改为“回根页 + 再恢复”并保留“离开后游戏确实恢复”；teleport 步骤等真实提交 |
| `c3b-external-link.spec.ts` | 3 处授权入口改走 AI hub；ESC 关闭改 `resumeGame` |
| `c3b-hard-disconnect.spec.ts` / `c3c-bridge-reclaim.spec.ts` / `signal-sdk-negative.spec.ts` | 授权入口改走 AI hub（其余断言不动） |
| `c3b-link-form.spec.ts` | SETTINGS→EXTERNAL LINK SETUP 走页面导航；AI CONTROL 走 hub；表单内 ESC 断言改为冻结契约（只关表单、不导航、不关暂停层），CANCEL 行为单独断言 |
| `companion-room-cancel.spec.ts` / `companion-room-race.spec.ts` / `p3b-companion-owner.spec.ts` / `signal-coop-e2e.spec.ts` | `LLM COMPANION >` → `openLlm`；ESC 关闭 → `resumeGame`；CONFIRM 前 `waitForButton`（LLM 页轮询真实 pending，必须等它渲染出来再点，不抢跑） |

安全相关断言（伪 Origin/自重授权/假观察/模式翻转/Owner cap、MCP 无 confirm 工具、错误 key 不升级、FALLBACK 语义、房间代次退休建议、ACK/epoch 规则等）**一条都没有改动或删除**。

## 6. 每个失败的分类（诚实记录，含本轮亲眼看到的所有红）

| # | 失败 | 出现次数 | 分类与结论 | 依据 |
|---|---|---|---|---|
| 1 | `audit.spec` teleport 落点差 13 格（已换房但未到落点） | 1/3 全量（`54-…`） | **已定位并修**：轮询 `F` 前不存在“玩家已在 portal 格”的同步，`F` 可能在 reset 提交前就按了。修后 5/5 绿（`tester/addendum/audit-teleport-regression.log`） | §10 |
| 2 | `audit.spec` teleport 落点恒差 `hypot(0.2400691, 0.2880830) = 0.375` 格 | 1/6 有诊断的隔离跑（`tester/addendum/diag-teleport.log`）；修前 1/5（`58-…`） | **已定位并修（测试夹具）**：不是 `findWalkableInRoom` 与 core 语义不一致（core 的 `ensureWalkableFromState` 对可走格子原样返回），而是落点格子上站着被追踪的敌人，core 的**角色分离**把主角推开恰好 0.375 格（`diagnostic: diff.x=-0.2400691, diff.y=+0.2880830`，模长 0.375）。夹具改用既有 core 测试 seam `clearEnemiesForTest()` 隔离该机制后，5/5 绿 | §10 |
| 3 | `whale-character.spec` `whale-dash` 5s 未出现 | 1/3 全量（`60-…`） | **负载相关既有 flake**，未修（本单无权限/无必要） | 隔离 3/3 PASS（`61-…`）；该 spec 与 UI 无关 |
| 4 | `audit.spec` P2：Boss 子弹 16 vs 15 | 1 次（`tester/addendum/audit-full-file.log`） | **既有 flake**（前一阶段残留弹丸），未修 | 隔离 3/3 PASS（`tester/addendum/audit-p2-1..3.log`） |
| 5 | P1 / P3-a / F-04（历史上长期红） | 0（本单全绿） | **已按真实 core 接口重写夹具** | 见下 |
| 6 | 旧 spec 的 34 条导航型红（适配前） | 适配后清零 | **适配，不是回归** | `logs/17-…` |

关于历史上的 invuln 夹具（Lead 指定必须按真实接口处理）：`Player.invuln` 只有 getter（`Player.ts:64` → `World.playerInvuln`），`player.invuln = N` 是静默空操作。现改为
（a）`World.enqueueHeal`（真实 core 命令）仅在 HP<35% 时救命，敌人/开火/伤害保持真实；
（b）P1 死亡步骤用真实 tick 等残余 i 帧过期后再 `hurt()`；
（c）P3-a 用 `protect=false` 完全真实战斗；
（d）`evidence-fixture` 记录字段改为真实的 `hpToppedUpBelow35Pct: true` / `iframesWritten: false`，删除原先与事实不符的 `onlyIFramesRefreshed: true`。

## 7. 变更文件白名单（本任务范围内，共 17 个路径）

实现（已由 Lead 提交为 `eb83eb4`/`8b8418a`，本单未再改动，hash 与冻结一致）：
```
src/scenes/PauseScene.ts
src/scenes/GameScene.ts
src/ui/menuKit.ts
src/world/World.ts        (仅删除 13 行 spawnProjectile 别名，Lead 既有修复)
```

测试（tester 独占；新增 2 个、适配 11 个）：
```
tests/ui-menu-layout.spec.ts   (新增，25 条：6 capture + 6 audit + 13 单例)
tests/uiNav.ts                 (新增，共享导航/点击/等待助手)
tests/ai-native-world.spec.ts
tests/audit.spec.ts
tests/c3b-external-link.spec.ts
tests/c3b-hard-disconnect.spec.ts
tests/c3b-link-form.spec.ts
tests/c3c-bridge-reclaim.spec.ts
tests/companion-room-cancel.spec.ts
tests/companion-room-race.spec.ts
tests/p3b-companion-owner.spec.ts
tests/signal-coop-e2e.spec.ts
tests/signal-sdk-negative.spec.ts
```

证据/日志（本单目录，未触碰 `reports/ai-native-02/` 之外的他人证据）：
```
reports/ui-rework-01/before/           42 张 + audit-before-*.json
reports/ui-rework-01/after/            53 张 + audit-after-*.json（在冻结 commit 上重放过）
reports/ui-rework-01/logs/             全部命令完整输出（见各节引用）
reports/ui-rework-01/tester/REPORT.md  本文件
reports/ui-rework-01/tester/evidence/  P1/P3-a 操作日志（LS_AI_EVIDENCE_DIR）
reports/ui-rework-01/tester/contaminated-before/  被 HMR 污染的早期图（不作结论）
reports/ui-rework-01/tester/wip/       WIP 阶段审计与截图（不作最终结论）
reports/ui-rework-01/tester/probe*/    取证用临时探针（不进 tests/，不参与 CI）
```

## 8. 边界遵守声明

- 未 `push`、未 `PR`、未 `merge main`、**未 commit**（实现提交 `eb83eb4` 由 Lead 完成；本单只改 `tests/` 与 `reports/ui-rework-01/`）。
- 未修改 `src/`（冻结 hash 前后一致），未改 Owner 协议/epoch/权限/暂停入队语义。
- 未伪造 pending/connected：所有 pending 都经真实 bridge + 官方 MCP SDK；错误 owner key 按既有协议显示 FALLBACK/NO_MODEL，未要求改成 CONNECTED。
- 未删除任何旧断言；安全断言零改动；未通过放宽 timeout 追绿（`audit.spec` 的等待是等真实提交，不是缩窗口）。
- 截图/日志不含 token、owner key、bridge 凭据（LLM 失败用例显式断言两者不出现在输入框与场景文本）。
- 说明：冻结 commit 内已含 `after/` 的一版截图；本轮按要求在冻结实现上**重新生成**了 `after/`（同名，53 张，含我新增 5 条用例产生的 5 张交互图），因此 `git status` 里 `reports/ui-rework-01/after/*` 显示为修改/新增是预期行为。

## 9. 运行结论（全量 3 次）

- `54-…`：117/118（audit teleport，已定位并修，见 §10）
- `60-…`：117/118（whale dash 负载 flake，隔离 3/3 绿）
- `62-…`：**118/118 PASS**（当前集合的单次全量绿，14.7m）

本单范围内（UI-REWORK-01 的 **25** 条新测试 + 适配后的旧 UI 相关 spec）在三次全量中零本单失败；出现过的红都是与本单无关的既有 spec（audit 传送几何/P2 弹丸计数、whale dash），其中 teleport 的两类红已在返修中定位并修好（§10），其余保留为既有 flake 记录，未做任何掩盖。

## 10. 返修记录（回应 reviewer `TEST_ADDENDUM.md` 的 B1 / B2 阻断）

源码仍是冻结的 `eb83eb4`（三份 hash 未变，`git status -- src/` 为空）；本节只改 `tests/`，证据全部写在我自己的
`reports/ui-rework-01/tester/addendum/`，`UI_OUT_DIR` / `LS_SHOT_DIR` / `LS_AI_EVIDENCE_DIR` 三个环境变量在该目录下隔离使用。

### 10.1 B1 — teleport：去掉吞错与固定长等待，并定位 0.375 格真实原因

返修前（被 reviewer 指出）：`waitForFunction(...).catch(() => undefined)` 吞掉同步超时；`500→1200ms` 固定等待；报告里写了“已修”，但 reviewer 独立复现出恒定 `0.2400691` 偏移。

本轮先做**诊断**（`tester/addendum/diag-teleport.log`，6 次隔离跑，其中 1 次失败）：

```
expected {x:25,y:46}  actual {x:24.759930850125826,y:46.28808297984902}
diff {x:-0.2400691498741736, y:+0.28808297984902254}   |diff| = 0.375000000000
roomId 3 (combat)  portal {wx:31,wy:44,target:5}  input 全 false  intent.move {0,0}
pending ["move-target"]  echo false  paused false
```

结论（有源码依据，不是猜）：

- `World.tryInteract()` 的落点就是 `findWalkableInRoom(target)`，而 core 的 `teleport-player`
  只用 `ensureWalkableFromState(state, {x,y})`；该格子按 `PLAYER_RADIUS=0.5` 可走时**原样返回**，
  所以“期望值 vs core 落点”**不存在语义差**——reviewer 的方向（“可能是 findWalkable 与 core 语义不同”）被排除。
- 实测位移模长恰好 **0.375 格**（= 24px）且方向为单位向量，由此定位到 **角色分离**：落点格子上站着仍在被追踪的敌人，
  主角被 core 的分离/推出步骤推开。这是另一个机制（与传送落点无关），也是数值恒定的原因。
- 另一类“差 13 格”是 `F` 在 reset 提交前按下导致**交互没发生**（换房断言也会红）。

返修（`tests/audit.spec.ts`，净增约 40 行、删除 2 行）：

1. 删除 `.catch(() => undefined)`：reset 未落到 portal 格时**立刻**在该处失败，错误信息指向根因。
2. 删除“固定 500→1200ms”；改为三个**真实条件等待**（均无 catch）：
   - 玩家真正站到 portal 格（`<0.01`）；
   - `F` 后玩家**已在目标房间且落在预测落点**（`<0.01`，timeout 10s）；
   - camera 收拢到原断言的阈值 `< 120`（timeout 6s）。
3. 用**既有 core 测试 seam** 消除角色分离的干扰：`clearEnemiesForTest()` + `resetProjectilesForTest()`
   （同一个 spec 里既有的 ForTest 接口，注释写明原因与实测 0.375 证据）。
4. 几何/可玩性断言**一字未改**：`< 0.01` 格、`spriteErr < 1`、`room != beforeRoom`、`centerErr < 120`；没有把 expected 改成 actual。

验证：`PORT=5433 LS_SHOT_DIR=…/tester/addendum/shots npx playwright test tests/audit.spec.ts --grep "fixed-seed playability" --repeat-each=5 --workers=1`
→ **PASS 5/5**，`tester/addendum/audit-teleport-regression.log`；专项修前同条件 1/5~1/6 出现 0.375 偏移（`diag-teleport.log`、`addendum/../logs/58-…`）。

### 10.2 B2 — reauth：把“无 observation”写成真实原因，并恢复 post-swap 可用性覆盖

reviewer 指出的事实（我已按源码核对 `companionGateway.ts` / `companionFacet.ts`）：reauthorize **不改 session/epoch**，
只 `observation = null` + `cancelUnconfirmed()`；因此 `echo_observe` 的失败是**状态性拒绝**（必须先重新观察），
不是“旧会话被安全撤销”。原报告那句表述是错的，已删除。

返修（`tests/ui-menu-layout.spec.ts` 的 `functional: owner re-authorize…`）：

1. 负向断言改为真实原因：`ok === false` **且** payload 匹配 `no_observation|E_LINK_UNAVAILABLE`，注释写明“reauth 清空已发布 observation，agent 需重新观察后才能提案（非安全撤销）”。
2. 恢复被删掉的 post-swap 可用性 e2e（走真实渲染侧路径，不写 mock）：
   房间内放一个真实敌人 → `resumeGame()` 跑 >8 个真实 tick（渲染侧重新发布 observation）→ 再次进入 LLM 页 →
   **同一个** SDK 会话 `echo_observe` ok → `echo_suggest` ok → `CONFIRM` 按钮启用 → 人类点击 CONFIRM →
   `world.hasPendingCompanionIntent === true`。
3. 保留原有正向断言：同实例（打标记）、reauth 后 CONNECTED、旧 proposal 退役（CONFIRM 禁用 + 点击不入队）。
4. DISCONNECT 仍验证：状态不再 CONNECTED，页面文案为离线/未连接（`STATE CONNECTED` 不出现）。

验证：`PORT=5433 … npx playwright test tests/ui-menu-layout.spec.ts --grep "re-authorize" --repeat-each=2 --workers=1`
→ **PASS 2/2**，`tester/addendum/reauth-regression.log`。

### 10.3 文档计数与口径修正

- 本 spec 条数 **24 → 25**（6 capture + 6 audit + 13 单例），§2/§7 已改。
- 明确 **113（`37-…`）与 118（`62-…`）不是同一测试集合**：`37-` 跑在 `eb83eb4` 之前、当时本 spec 尚无现在的 25 条定义；
  不得把 113 当作本集合的历史通过率，也不得把 `62-` 的单次绿当作确定性稳定。
- 撤回「teleport flake 已修（靠加长等待）」与「旧会话被安全撤销」两处错误表述：前者改为“已定位到 0.375 格角色分离并用真实条件等待 + core seam 消除干扰，5/5 复跑绿”；后者改为“reauth 清空 observation（状态性拒绝），session/epoch 不变”，cap 原子替换由 `src/ai-native/ownerAuth.test.ts` 的 C3/C4 在协议层覆盖（非本 e2e）。

### 10.4 返修后回归（按订单只跑针对性，不跑全量）

| 命令 | 结果 | 日志 |
|---|---|---|
| `npm run typecheck` | **PASS**（0 error） | `D:\Project\LAST_SIGNAL\reports\ui-rework-01\tester\addendum\typecheck.log` |
| `npx playwright test tests/audit.spec.ts --grep "fixed-seed playability" --repeat-each=5 --workers=1` | **PASS 5/5** | `D:\Project\LAST_SIGNAL\reports\ui-rework-01\tester\addendum\audit-teleport-regression.log` |
| `npx playwright test tests/ui-menu-layout.spec.ts --grep "re-authorize" --repeat-each=2 --workers=1` | **PASS 2/2** | `D:\Project\LAST_SIGNAL\reports\ui-rework-01\tester\addendum\reauth-regression.log` |
| `npx playwright test tests/audit.spec.ts --workers=1`（整文件，含 P2） | 1 passed / **1 failed**（P2 弹丸 16 vs 15，既有 flake） | `D:\Project\LAST_SIGNAL\reports\ui-rework-01\tester\addendum\audit-full-file.log` |
| `npx playwright test tests/audit.spec.ts --grep "P2 regression" --repeat-each=3` | **PASS 3/3**（隔离不复现） | `D:\Project\LAST_SIGNAL\reports\ui-rework-01\tester\addendum\audit-p2-1..3.log` |

### 10.5 剩余问题（未修，明确留给 reviewer/Lead 判定）

1. `whale-character.spec`：`whale-dash` 效果在重负载全量里可能 5s 内未出现（隔离 3/3 绿）。与本单无关，未改。
2. `audit.spec` P2：Boss 弹丸计数偶发 16（隔离 3/3 绿），前一阶段残留弹丸的时序问题，未改（该断言非本单引入）。
3. `62-…` 的 118/118 是**单次**全量绿；本单没有主张“确定性永绿”。若需要更强的结论，需要重复全量（本单订单未要求）。
4. `after/` 证据是冻结 commit 上重跑的（字节变化属重跑重写，内容仍对应同一实现）；`before/` 未重写。
