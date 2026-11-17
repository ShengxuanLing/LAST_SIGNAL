# UI-REWORK-01 · 独立审计（Reviewer，只读源码）

- 基线：分支 `fix/ui-menu-layout-rework` @ `0faf95c`（= 本地 main），工作树 dirty 仅 `src/world/World.ts` −13 行（spawnProjectile 别名删除，**必须保留**）+ 未跟踪 `Start-LAST-SIGNAL.cmd`。
- 审计时点：src/ 与 tests/ **尚未有 UI 重构改动**，`reports/ui-rework-01/` 下只有本文件。以下为「现状根因 + 验收清单」，供 developer/tester 对齐，实现到位后按 §D/§F 复核。
- 已读范围：`src/main.ts`、`src/scenes/PauseScene.ts`（全 724 行）、`src/scenes/GameScene.ts`（HUD/pause/companion/external）、`src/scenes/MainMenuScene.ts`、`src/ai-native/companionLink.ts`、`tests/*.spec.ts` 相关断言、`node_modules/phaser` 键盘/输入实现。

---

## A. 根因表（证据 = 当前源码行号，可直接复核）

| # | 现象 | 证据 | 严重度 |
|---|---|---|---|
| R1 | 底部状态互相压字（用户图 2 的「ANY MOVE…」压住「AUTHORIZE EXTERNAL AGENT」） | `PauseScene.ts:257`（`authorizeExternal`，**y=622**）与 `PauseScene.ts:287`（`ANY MOVE / FIRE INPUT TAKES HUMAN CONTROL`，**y=625**），两者均 `setOrigin(0.5)`，间距 3px < 字高 12px → 必然重叠（echo 面板同一句在 `:351`，y=650） | **BLOCKER** |
| R2 | 长按钮文字越出按钮框（用户图 1） | `_button()` 固定 `w=340`（`PauseScene.ts:715-725`），标签 20px monospace + `letterSpacing:3` ≈ 15px/字；`ENABLE / RE-AUTHORIZE (HUMAN)`、`CONFIRM FIRST PROPOSAL (OWNER)`（29 字 ≈ 435px）、`AI CONTROL: OFF · LOCAL DEMO`（28 字 ≈ 420px）、`ASSIST ARMED — CLICK TO REVOKE`（30 字 ≈ 450px）均溢出框 80–110px。无 `wordWrap`、无 `setMaxWidth`、无宽度测量 | **BLOCKER** |
| R3 | Pause 左侧 Companion 入口「散落」 | `PauseScene.ts:297`：`echoLink` 硬编码 `(140, 200)`，`PauseScene.ts:290`：`companionLink` 硬编码 `(140, 230)`；`origin(0,0)+padding(10,8)` → 两块约占 192–227 / 222–257（字体度量相关），**边缘相接甚至重叠 ≈2–5px**，且 x=140 与居中列 640 无任何栅格关系，视觉上脱离菜单 | **BLOCKER** |
| R4 | HUD 干扰 + 暂停态出现「飘」的 COMPANION 文字 | `PauseScene.ts:71-81`：`companionStatusText` 在 **`update()` 里**惰性 `this.add.text(GAME.WINDOW_W/2, 420, …)`；420 正是 **SETTINGS 按钮中心**（`PauseScene.ts:227`），创建后位于其上层 → 直接压在按钮上；且 `shutdown`（`PauseScene.ts:120-131`）只清了 `externalStatusText/controlText/lastExternalSig`，**没有** 清 `companionStatusText` 与 `lastCompanionSig` → `scene.restart()`（INVENTORY/SETTINGS/AI/ECHO/COMPANION 全靠 restart）后要么写到已销毁 Text，要么因 sig 相同而永久不再重建 | **MAJOR** |
| R5 | Settings 面板里的 SIGNAL COLLABORATION 开关不在面板内 | `PauseScene.ts:492` 创建 `signalToggle = this.add.text(0, 105, …)`，但 `PauseScene.ts:518` 只 `wrap.add([reset, hint, back, linkSetup])` —— **漏加 signalToggle**。它因此渲染在场景坐标 `(0,105)`＝覆盖层左上角、面板（250–1030 × 248–558）之外、正好压住被 dim 的 vitals HUD 区；面板里 405 处只剩 RESET AUDIO | **BLOCKER**（功能可达性 + HUD 干扰） |
| R6 | 「底部状态重叠」的第二层：暂停时 GameScene HUD 仍在画同一批状态 | `PauseScene.ts:99` 的 dim 只有 `alpha 0.82`，GameScene HUD 未被隐藏；`GameScene.ts:394-428 lockHud()` 把 HUD 钉在逻辑 `(20..1260, 676/698)` 屏幕坐标；`PauseScene` 又在 585/605/622/625/655 复写 CONTROL/EXTERNAL 状态 → **两套重复状态叠在同一带**，字重/颜色不同，读起来互相干扰 | **MAJOR** |
| R7 | Pause 固定 GAME 尺寸、没有 compact 规则 → 小窗口不可读 | HUD 有 F-06 compact 分支（`GameScene.ts:337-356`：`scale<0.85` → 16/17px、`helpY=WINDOW_H-52`）；`PauseScene` **全部**用 12–20px 固定值。800×600 → FIT 0.625 → 暂停菜单 12px 逻辑字 = **7.5 CSS px**（HUD 明确拒绝过的尺寸） | **MAJOR** |
| R8 | 「ENABLE / RE-AUTHORIZE」的 re-authorize 分支永远走不到 | `PauseScene.ts:394` 先 `linkFormMode='companion-reauth'`，紧接 `openExternalLinkForm('companion')`；而 `PauseScene.ts:545` `this.linkFormMode = mode` **把它覆盖成 'companion'** → `666` 的 reauth 分支 dead code。结果：已有 live link 时点该按钮走 `authorizeCompanion()` 重新握手并 **新建 CompanionLink**（`GameScene.ts:1041`），旧实例未 dispose（heartbeat/定时器泄漏），且**绕过了「原子换 cap + 取消旧建议」的语义** | **MAJOR**（Owner 边界；修法只需改 UI 层，不动协议） |
| R9 | Owner 确认看不见自己要确认的东西 | `PauseScene.ts:402/409`：CONFIRM/REJECT 都作用 `pending[0]`，而列表 `listText`（`PauseScene.ts:363`，`void pending().then` 回填）是**多条拼接的单行文本、无 wordWrap、无逐条 id/时间**（4 条 × kind/reason/target 会顶出 1280 右边界）。人能点「确认」但无法对应到具体建议 | **MAJOR**（Owner 安全可用性，不涉及协议改动） |
| R10 | ESC 语义在面板内不统一 | `PauseScene.ts:116` 全局 `keydown-ESC → close()`；Settings 内提示写 `ESC RESUME`（`PauseScene.ts:487`）而实际是**关掉整个暂停层并恢复游戏**；DOM 表单打开时 `root` 在冒泡阶段 `stopPropagation`（`PauseScene.ts:628-635`），ESC 被吞，只能用 CANCEL 关表单 | MINOR（但属「清晰可操作」验收面） |
| R11 | 结构性根因：没有一个共享布局模型 | 每个面板手写绝对坐标（44/56/58/60/80 混用间距），按钮助手在两个 Scene 各写一份（`MainMenuScene.ts:157` `_button(..., w, ...)` 收宽度参数，`PauseScene.ts:715` `_button` 写死 340），没有「行模型 / 测量 / clamp / compact 缩放」三件事 | **MAJOR**（决定这次修完会不会再犯） |

### 已核实为**不是**问题（避免被误改）
- 坐标系统本身是**单一**的：`main.ts` 用 `Phaser.Scale.FIT` + 固定 1280×720，所有场景共用同一逻辑坐标系；`lockHud()` 用 `cam.getWorldPoint()` + 逆缩放把 HUD 钉在屏幕坐标。所以「多套坐标」的实际来源是**缺少共享布局常量 + PauseScene 无 compact 规则**，不是相机/缩放错算。禁止为了「对齐」去改相机、`lockHud()`、`WorldRenderer._lockLightToScreen()`。
- DOM 表单的键盘隔离是**对的**：Phaser `KeyboardManager` 在 `window` 上以**冒泡阶段**注册（`node_modules/phaser/src/input/keyboard/KeyboardManager.js:229-232`），表单 `root` 在冒泡阶段 `stopPropagation` → Phaser 既收不到键，也不会对 `SPACE`（`addKey` 默认 capture）`preventDefault` 破坏输入。不要用 `preventDefault`/focus hack 去「修」它。
- ESC 不会双触发，但**机制不是「GameScene 被 pause」**：`onPause()` 只设 `this.paused = true` + `scene.launch('PauseScene')`，GameScene **并未 `scene.pause()`**，它的 KeyboardPlugin 全程活跃、`update()` 靠 `if (this.paused) return`（`GameScene.ts:450`）短路。ESC 同时进两个 handler，但 GameScene 的 `onPause()` 有 `if (this.paused) return`（`GameScene.ts:886`）→ 空转；`I`/`Q`/`E` 同样有 `this.paused` 守卫（`GameScene.ts:1138/1148`），`F` 是显式 takeover 分支，`T/Y/R` 在 `update()` 里受 `!this.paused` 保护。→ 重构时**不要**改成 `scene.pause()`/`scene.sleep()` 来「隔离键盘」，也不要新增无 `paused` 守卫的 GameScene 键处理。

---

## B. 坐标/尺寸契约（改动前必须与 tester 对齐）

逻辑空间恒为 1280×720；`tests` 里同时存在**坐标点击**与**文字定位点击**两类，前者是硬约束：

| 目标 | 逻辑坐标 | 引用 |
|---|---|---|
| SETTINGS | (640, 420) | `audit.spec.ts:397`、`c3b-link-form.spec.ts:54`、`ai-native-world.spec.ts:916` |
| AI CONTROL | (640, 540) | `ai-native-world.spec.ts:207/295/497` |
| QUIT TO MENU | (640, 480) | `ai-native-world.spec.ts:679`、`audit.spec.ts:479` |
| ECHO COMPANION > | (140, 200) | `ai-native-world.spec.ts:1302/1333/1369/1403` |
| echo 面板项 | (640, 412) / (640, 524) / (640, 592) | `ai-native-world.spec.ts:1335/1371/1409` |
| Settings 内部 | master −(480,300)、sfx −(480,340)、shake(640,370)、reset audio(640,405) | `audit.spec.ts:409-428` |

文字定位点击（`clickText`，遍历 `PauseScene.children.list`，含容器递归）依赖这些**字符串必须继续存在**：
`'ECHO COMPANION >'`、`'LLM COMPANION >'`、`'SETTINGS'`、`'INVENTORY'`、`'AI CONTROL'`、`'BACK'`、`'SIGNAL COLLABORATION · OFF/ON'`、`'ENABLE / RE-AUTHORIZE'`、`'CONFIRM FIRST PROPOSAL'`。

> 结论：**布局可以重排，但要么保留上表锚点，要么 tester 同步改断言。** developer 必须在提交里给出「新锚点 vs 旧锚点」对照，reviewer 按表逐条核对；`(140,200)` 是本次要动的目标之一，属于**预期迁移**，必须显式通知 tester，不得让它静默红。

---

## C. 必须守住的边界（改 UI 不许碰）

1. **Owner 授权/epoch/动作校验**：不得改 `worldBridgeServer`、`companionGateway|Facet`、`ownerAuth`、`ownerPairing`、`CompanionLink.decide/authorize` 的语义；R8 的修复只允许改 `PauseScene` 的 `linkFormMode` 传参。
2. **暂停确认入队 → 下一 core tick 提交**：`GameScene.ts:500-509`（`postApplied` / `pendingCompanionReceipt` / generation+roomId）与 `onResume()`「不强制推进 tick、不 flush」的注释语义不得变；UI 只能读状态。
3. **不得造假**：`NOT CONNECTED · NO MODEL (no fake connected state)`、`COMPANION OFF/NO_MODEL/READ_ONLY`、`EXTERNAL AGENT NOT CONNECTED`、`CONTROL HUMAN · HUMAN ONLY` 等诚实标签必须保留原意，不允许为了版面好看改成「已连接/LLM 就绪」。
4. **不得删功能入口**：Inventory / Settings / AI local demo / External agent / ECHO / Signal opt-in / LLM Companion / QUIT 全部仍需从 ESC 页面可达，且 `I` 关背包、`ESC` 开暂停的键位语义不变。
5. **保留**：`src/world/World.ts` −13 行未提交修复；`Start-LAST-SIGNAL.cmd`；所有既有 `reports/**` 证据。禁止 `git add -A`、禁止清理/覆盖他人证据。

---

## D. 验收清单（实现到达后逐项 PASS/FAIL，缺一即不 PASS）

### D1. 版面（ESC 暂停页，第一优先）
- [ ] 所有可点元素**不重叠**：以每个元素 `getBounds()` 两两求交，重叠数 = 0（含文字溢出框的可见范围）。
- [ ] 底部状态带任意两行基线间距 ≥ 字高 ×1.5；`AUTHORIZE EXTERNAL AGENT` 与提示行不再共位。
- [ ] 每个按钮标签宽度 ≤ 按钮宽度 − 2×内边距（对 4 个面板的全部标签实测，含最长 `ASSIST ARMED — CLICK TO REVOKE`）。
- [ ] 所有元素落在 1280×720 安全区内（x∈[16,1264], y∈[16,704]），无越界。
- [ ] ECHO / LLM Companion 入口与主菜单列同一栅格（对齐同一 x、行距一致、间距 ≥ 8px），视觉上不再孤立在左侧。
- [ ] 暂停态下 HUD 与覆盖层不再出现同一状态的重复两行（或明确：HUD 状态带被覆盖层替代/压暗到不可读，二选一，需在证据里说明选择）。
- [ ] 1280×720、1920×1080、1366×768、1024×768、800×600 **五视口**截图各一张，均无重叠、无越界、最小字号 CSS px ≥ 10。
- [ ] compact（scale<0.85，如 800×600）下暂停菜单字号与 HUD compact 规则同源，不出现 7.5 CSS px。

### D2. 面板与交互（INVENTORY / SETTINGS / ECHO / COMPANION / AI / QUIT）
- [ ] Settings：SIGNAL COLLABORATION 开关**在面板内**且可点、状态与 `save.permanent.signalCollaborationOptIn` 同步；RESET AUDIO 仍可点（两者不得共位）；MASTER/SFX/SHAKE 三行仍独立生效。
- [ ] Settings 的 ESC 行为有单一明确语义并在提示文案中如实描述（建议：ESC 回暂停菜单，BACK 亦回菜单；若保持 ESC=恢复游戏，则提示不得写 `ESC RESUME` 之外的东西，且测试覆盖）。
- [ ] ECHO 面板：ENABLE/DISABLE、FOLLOW/HOLD/MOVE、ASSIST CONFIRM/REVOKE 全部可点且状态刷新正确（点后无「闪一下变空」的 restart 抖动；若仍用 restart，需证明文案/状态在 1 帧内正确）。
- [ ] COMPANION 面板：`STATE` 与 `COMPANION OFF/NO_MODEL/READ_ONLY/CONNECTED` 呈现一致，不出现掉字/重影（R4）。
- [ ] COMPANION 每条建议单独成行、可辨识（kind/reason/target/新鲜度），CONFIRM/REJECT 只作用于**屏幕上标注的那一条**（R9）。
- [ ] 有 live link 时点「ENABLE / RE-AUTHORIZE (HUMAN)」走 reauth 路径（`reauthorizeCompanion`），错误 key 时提示 `RE-AUTH FAILED — active connection unchanged` 且旧连接仍 CONNECTED（R8）。
- [ ] DOM 表单：URL/TOKEN/OWNER KEY 可正常输入（含 SPACE/W/A/S/D/ESC 不泄漏到 Phaser），提交后密码框立即清空、CANCEL 可关；表单在窗口 1280 逻辑 / 大屏 letterbox 下都可读且不与 canvas 冲突（明确「覆盖整个视口」是设计选择还是缺陷）。

### D3. 回归与证据
- [ ] `npm run typecheck` = 0 error（日志路径写进报告）。
- [ ] `npm test`：以已知基线 **743/745** 为参照，新增失败即阻断；仍失败的两条必须是既有 `P1 invuln` / `P3a 环境伤害`。
- [ ] `npm run build` 通过。
- [ ] 完整 Playwright：已知基线 **91/93**；本次必须证明 RESTART 后条数不退步，且 §B 表中的坐标/文案用例逐条给出 PASS 或「已由 tester 迁移」的证据。
- [ ] 截图/操作日志落在 `reports/ui-rework-01/<子目录>/`，不得覆盖 `reports/ai-native-02/**` 既有证据。
- [ ] 最终本地提交（不 push、不 PR、不 merge main），diff 只含 UI/布局与必要测试，且 `git status` 里 `src/world/World.ts` −13 行仍原样保留。

---

## E. 高风险点 / 禁止做法

1. **不要**把按钮宽度改成「正好装下最长文案」的一次性魔法值 —— 会引入下一次文案溢出。要么测量文本宽度并 `clamp`/`wordWrap`，要么给行模型固定列宽 + 自动缩字号下限。
2. **不要**用 `setScrollFactor(0)`/改相机/改 `lockHud()` 的办法「让暂停页对齐 HUD」：HUD 的位置由 `getWorldPoint()` 每帧重算，任何 off-by-one 只在某个 zoom 下暴露（历史坑：zoom-around-center 偏移）。
3. **不要**在 `update()` 里创建 GameObject（R4 的成因）。暂停层的一切对象必须在 `create()` 建、在 `shutdown` 里置空，sig 缓存必须同批重置。
4. **不要**把 `scene.restart({mode})` 换成自绘「伪面板」而漏掉 `shutdown` 清理：`keydown-I`、`keydown-1..4`、DOM 表单、tween 都靠 `shutdown` 收尾，漏一个就是双触发/幽灵监听。
5. **不要**动 Owner 协议、epoch、`enqueueCompanionAction`、`pendingCompanionReceipt`、暂停确认后「下一 tick 提交」的语义来「顺手修」R8/R9。
6. **不要**为了让 E2E 绿而放宽断言、加 `waitForTimeout` 掩盖布局抖动；锚点迁移必须显式记录。
7. **不要**引入新的全局布局魔数散落在多个 Scene；建议（developer 决定实现形式）：`src/scenes/ui/layout.ts` 单一来源 + `row()`/`measure()`/`clampText()` 三个原语，PauseScene 与 MainMenuScene 共用 `_button`（MainMenuScene 版本已有 `w` 参数）。

## F. 实现到达时我要复核的 diff 区域

1. `src/scenes/PauseScene.ts`：`create()` 各分支坐标、`_button()`、`refreshExternalLabels()`、`showSettings()` 的容器归属、`openExternalLinkForm()` 的 `linkFormMode`、`shutdown` 清理项。
2. `src/scenes/GameScene.ts`：只允许「暂停时隐藏/压暗 HUD 状态带」一类改动；`lockHud()`、`onPause()/onResume()`、`authorizeCompanion/reauthorizeCompanion`、`pendingCompanionReceipt` **逐行确认未改**。
3. `src/scenes/MainMenuScene.ts` / `LevelUpScene.ts` / `GameOverScene.ts`：若共用新布局模块，确认没有引入同名标签导致 `clickText` 命中多个 Text（`findText` 返回第一个命中，重复标签会点错）。
4. `tests/**`（tester 领地）：只看是否同步了 §B 的锚点，不代改。
5. 是否有新增 `__game` 调试钩子/假状态注入（禁止）。

## G. 机器可验证的「协议未变」证据（我会跑的针对性 gate）

- `npx vitest run src/ai-native/ownerAuth.test.ts src/ai-native/worldBridgeServer.test.ts src/ai-native/companionGateway* src/ai-native/worldSim*.test.ts src/world/sim/rewiring.test.ts`（Owner/epoch/预热校验 + 本次 R1 相关 rewiring 断言）
- `npx playwright test tests/p3b-companion-owner.spec.ts tests/companion-room-cancel.spec.ts tests/companion-room-race.spec.ts tests/c3b-link-form.spec.ts tests/c3b-hard-disconnect.spec.ts tests/resume-no-step.spec.ts`
- `npx playwright test tests/audit.spec.ts tests/ai-native-world.spec.ts tests/signal-coop-e2e.spec.ts`（覆盖 §B 坐标/文案锚点、INVENTORY/SETTINGS/SIGNAL opt-in/ECHO 全链路）
- 输出规则：`命令 → PASS/FAIL（计数）→ 日志绝对路径`，失败附最相关错误一行。
