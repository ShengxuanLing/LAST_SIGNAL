# UI-REWORK-01 · 首版 diff 级复核（Reviewer，只读）

- 复核对象（工作树，未提交）：`src/ui/menuKit.ts`（新）、`src/scenes/PauseScene.ts`（重写 988 行）、`src/scenes/GameScene.ts`（+25，`setHudVisible`）；对照基线 `0faf95c`。
- 我未修改任何 src/tests 文件；只跑针对性 gate，日志在 `reports/ui-rework-01/reviewer/logs/`。
- 证据分层（按 Lead 要求）：
  - **静态证据**：源码行号、`npx tsc`、针对性 vitest 子集。凡标「静态」的结论只由代码阅读得出。
  - **浏览器证据**：实现者首版截图 `developer/pause-{root,llm,settings,ai,echo,inventory}-1280x720.png` + `developer/pause-smoke.json`（实现者自测脚本，26/26 step ok）。我**在 1280×720 上实看图**（root/llm/settings 三张）。多视口/多分辨率矩阵仍待 tester 的 `tests/ui-menu-layout.spec.ts` 冻结后跑。

## 0. Gate 结果（命令 → 结果 → 日志绝对路径）

| 命令 | 结果 | 日志 |
|---|---|---|
| `npx tsc --noEmit` | **PASS**（0 error） | `D:/Project/LAST_SIGNAL/reports/ui-rework-01/reviewer/logs/tsc.log` |
| `npx vitest run src/ai-native/ownerAuth.test.ts src/ai-native/worldBridgeServer.test.ts src/ai-native/companionGateway.test.ts src/ai-native/companionFacet.test.ts src/ai-native/companionRoomGeneration.test.ts src/world/sim/rewiring.test.ts src/world/sim/signalState.test.ts` | **PASS**（7 files / 69 tests） | `D:/Project/LAST_SIGNAL/reports/ui-rework-01/reviewer/logs/vitest-owner-protocol.log` |

> 未跑全量 vitest / 全量 Playwright（避免与 tester 同时满载，按 Lead 指示只跑针对性 gate）。因此**本报告不是最终 PASS**。

## 1. R1–R9 闭环判定

| R | 状态 | 依据 |
|---|---|---|
| R1 底部压字 | **已闭环** | 新 root：按钮 168/230/292/354/416（h=50），STATUS 头 474、六行 500–600（行距 20 > 12px 字高），footer 698。无重叠；浏览器截图一致。 |
| R2 长按钮越界 | **已闭环** | `menuKit.BTN_W=460` + `wordWrap: width w-28`；实测最长标签 `ENABLE / RE-AUTHORIZE (HUMAN)` / `CONFIRM FIRST PROPOSAL (OWNER)`（29 字 ≈ 320px）与 `ASSIST ARMED — CLICK TO REVOKE` 都在框内；截图 LLM 页确认。 |
| R3 Companion 入口散落 | **已闭环** | `ECHO COMPANION >`/`LLM COMPANION >` 收进 `AI & COMPANION` 页，同列同栅格（y=378/440，stride 62），不再硬编码 (140,200/230)。 |
| R4 惰性 Text/陈旧引用 | **已闭环** | 不再在 `update()` 建对象；改为 `MenuPage` 拥有/统一 `destroy()`，且 `navigate()`/`shutdown` 都重置 `lastStatusSig`/`lastCompanionSig`，各页字段在 `destroyPage()` 置 null。 |
| R5 Signal 开关漏容器 | **已闭环** | Settings 页 `signalBtn`（y=380）由 `p.button` 创建，随页销毁；截图 SETTINGS 页可见 SIGNAL 分组与开关。 |
| R6 HUD 干扰 | **已闭环（有 1 个遗漏）** | `GameScene.setHudVisible(false/true)` + `refreshHud` 在隐藏时短路；退出/QUIT/shutdown 三条路径都恢复；root 页用 STATUS 块替代 HUD 状态行。遗漏见 M5（deck 到达公告不在 hudObjects）。 |
| R7 小屏可读性 | **未闭环** | `UI.SMALL_FONT=12`（`menuKit.ts:24`），无 compact 分支；800×600 下 FIT 0.625 → 7.5 CSS px，正是 `GameScene` F-06 明确拒绝的尺寸。详见 B2。 |
| R8 reauth 死分支 | **未闭环（BLOCKER）** | `openOwnerForm()`（`PauseScene.ts:533-544`）先置 `'companion-reauth'`，再调 `openExternalLinkForm('companion')`，而 `:820` `this.linkFormMode = mode` 把它覆盖回 `'companion'` → `:939` 的 reauth 分支仍不可达；`reauthorizeCompanion` 全仓库唯一调用点 `:940` 因此是死代码（`grep -rn reauthorizeCompanion src/` 只此一处 + GameScene:1127 定义）。详见 B1。 |
| R9 确认对象不明确 | **部分闭环** | 列表现在有 kind/reason/target/resource 且折行；空列表时 CONFIRM/REJECT 置灰 + `decide()` 二次校验 → 禁空确认成立。但「点下去作用于哪个对象」仍只写 `pending[0]`，见 B3；另有新增的焦点抢占风险 B4。 |

## 2. 阻断/重要问题（已按可直接修的方式给出）

### B1（BLOCKER，静态）R8 仍在：live link 的 re-authorize 走错分支
- 事实链：`openOwnerForm()` → `linkFormMode='companion-reauth'`；`openExternalLinkForm('companion')`（`:820`）→ `linkFormMode='companion'`；提交时 `:939` 判定失败 → 落到 `:952` `authorizeCompanion()`。
- 后果：已有 live link 时点「ENABLE / RE-AUTHORIZE (HUMAN)」会**重新握手并新建 `CompanionLink`**（`GameScene.ts` 内 `this.companionLink = new CompanionLink(...)`），旧实例不 dispose（heartbeat/定时器残留），且**绕过 `reauthorizeCompanion()` 的原子换 cap + 取消旧建议**语义；Lead 明确要求验证的「原子 cap 替换、取消旧建议」这条链在 UI 上不可达。
- 修法（一行）：`openOwnerForm()` 的两条路径都传 `openExternalLinkForm('companion-reauth')`（或 `'companion'`），并删掉函数里那两行预先赋值（`:538`/`:542`），让 `:820` 成为唯一赋值点。
- 修好后的验证（协议侧已被测试覆盖，未改协议）：`src/ai-native/ownerAuth.test.ts` C4「same human atomically swaps the capability」+ C3「agent cannot replace the human capability」已在本次 gate 通过，UI 只要真正调到 `reauthorizeCompanion` 即可。

### B2（MAJOR，静态）R7 小屏不可读
- `UI.SMALL_FONT=12 / BODY_FONT=14 / BTN_FONT=18 / TITLE_FONT=42` 全是固定逻辑 px；`src/ui/menuKit.ts` 与 `PauseScene.ts` 内**没有**任何 `compact`/`window.innerWidth` 判断（`grep` 为空）。
- 800×600（FIT 0.625）→ 12px→7.5、14px→8.75 CSS px；root 的六行 STATUS 与 698 行 footer 是最小字。
- 建议：在 `UI` 令牌里加 compact 变体（如 SMALL 16 / BODY 17 / BTN 20 / TITLE 40，`BTN_STRIDE` 收到 56），用与 `GameScene` 同一个判据 `Math.min(innerWidth/1280, innerHeight/720) < 0.85` 在 `PauseScene.create()` 时选定；菜单对象都是一次性建/销毁，切 compact 只需重建页面。注意：FIT 下逻辑尺寸不变，故 resize 不需要重排，但**开着菜单时 resize** 不会换字号（可接受，需在报告里写明）。

### B3（MAJOR，静态）R9 的「当前对象」仍未钉住
- `refreshPending()`（`:582`）渲染的是 `pending.slice(0,3)` 的**快照**（`:579` 每秒刷新一次），而 `decide()`（`:546`）点下时重新 `pending()` 再取 `pending[0]`。人读到的第 1 行与真正被确认的对象之间没有绑定：新建议插入、旧建议过期都会让两者错位；列表也没有标出哪一行是 `pending[0]`。
- 建议：渲染时记下 `pending[0].suggestionId`，`decide(id, action)` 只认该 id（`/^……$/` 二次校验该 id 仍存在），并在第一行前加 `▶ CONFIRM THIS` 标记；这样「确认必须对应屏幕上那一行」可被测试断言（例如两分钟内插入新建议仍只确认原 id）。

### B4（MAJOR，静态）焦点抢占 → 可能误按 ENTER 确认
- `setDecideEnabled(true)`（`:610-615`）在**每次** `refreshPending()` 成功（即每 ~60 帧/有建议时）都 `focusButton(this.llmConfirm)`；`finishButtons()` 也会在页面构建后把焦点设到第一个 enabled 按钮。用户在 llm 页把焦点移到 BACK/DISCONNECT 后，约 1 秒内焦点会被拉回 CONFIRM，此时按 ENTER 即确认（`activate()` 只看 `enabled`）。
- 建议：只在「pending 数量 0 → >0」的**首次**转变时聚焦一次，且用户已用 ↑↓ 手动导航过就不再自动改焦点；周期性刷新永不移动焦点。

### B5（MINOR，静态）HUD 恢复/隐藏的完整性
- `setHudVisible` 覆盖 `hudObjects` + `banners`；`GameScene.ts:265` 的 deck 到达公告（`scrollFactor(0)`、`depth 501`、2.3s 后自毁）不在 `hudObjects` 里 → 若在它存活期间暂停，它会浮在覆盖层之上。建议把它并入 `hudObjects`（或在暂停时不显示）。
- `close()` 在 120ms 淡出 tween **之前**就 `setHudVisible(true)`，HUD 会在遮罩未完全消失时先亮；建议挪到 tween `onComplete`（`onResume()` 之前一帧）。
- `refreshHud()` 在隐藏时整段短路（`:575`），包含末尾的 `audio.setVolumes(...)`；当前没影响（恢复时 `onResume→refreshHud(0)` 会跑），但值得在注释里写明「隐藏期间 HUD 不刷新是刻意的」。

### B6（MINOR，静态）DOM 表单与敏感数据
- 表单外部链接分支（`:966`）在**已经显式传参**给 `authorizeExternalAgent(bridgeUrl, token, ownerKey)` 的同时，还把 `{bridgeUrl, token}` 写进 `globalThis.__externalLinkConfig`。虽然 `authorizeExternalAgent` 第一件事就是 `delete` 掉它，但这是不必要的「原始 token 进 window 全局」瞬时窗口。建议删掉这次写入（AI 页的 `authorizeExternalFromConfig()` 读全局是宿主注入的兼容路径，不受影响）。
- ESC 关不掉表单：`onEsc` 的 `if (this.domForm) return;`（`:141`）实际是死代码——表单 root 在冒泡阶段 `stopPropagation`，Phaser 根本收不到 ESC；用户只能点 CANCEL。建议在 `root` 内加 `keydown` ESC → `closeExternalLinkForm()`（只关表单，不影响暂停层），并同步更新提示文案。
- 其余保持正确：`token/ownerKey` 提交后立即清空、`type=password`、`data-testid` 未变、`clearOwnerPairing` 在失败路径调用、`reset`/`refreshStatusTexts` 未触碰协议。

### B7（MINOR，静态）零碎
1. `MenuPage.beginRegion/endRegion`（`menuKit.ts:249/259`）**没有任何调用点**，`endRegion` 还 `void bandTop`（忽略上边界）。即「scroll」目前只是死代码；请删掉或在报告中不要声称支持滚动。
2. `finishButtons()` 注释写「pointer hover also sets focus」，但 `pointerover` 只 `setFillStyle`，不改 `handle.focused`；注释与实现不一致（要么 hover 时 `setFocus`，要么改注释）。
3. `refreshEcho()`（`:457`）自带 `frame % 10` 节流，而 `buildEcho()` 也直接调一次；从别页导航到 echo 时若当前帧号不是 10 的倍数，STATUS/MOVEMENT/ASSIST 三行会先空 ≤10 帧（截图时序可能拍到空行）。建议进入页面时用 `force` 刷新一次。
4. 键盘可达性：Settings 的音量 `◀ ▶`（`volRow`）与 Inventory 的 `EQUIP` 行都不是 `MenuPage.button`，键盘 ↑↓ 到不了；而页脚写着「↑↓ SELECT · ENTER ACTIVATE」，暗示全键盘可操作。建议把这些也做成 button（或明确页面提示为「鼠标」）。

## 3. 给 tester 的同步项（不是产品缺陷，但会让新 spec 误红）

- **导航深度变了**：root 只有 RESUME / INVENTORY / SETTINGS / AI & COMPANION / QUIT；`ECHO COMPANION >`、`LLM COMPANION >`、`AI CONTROL` 都在 **AI & COMPANION** 页。`tests/ui-menu-layout.spec.ts` 现在从 root 直接 `clickText(..., 'ECHO COMPANION')`，会取不到（除非先点 `AI & COMPANION`）；`clickText(..., 'AI CONTROL')` 会命中 root 的**状态行** `AI CONTROL: OFF`（非交互）而不是按钮——静默点空。
- **字符串变更**：`SIGNAL COLLABORATION · OFF` → `SIGNAL COLLABORATION: OFF`（中点变冒号）；`ENABLE / RE-AUTHORIZE (HUMAN)`、`CONFIRM FIRST PROPOSAL (OWNER)`、`MODE: HOLD POSITION`、`MODE: MOVE TO AIM`、`CONFIRM ASSIST FIRE`、`ECHO COMPANION >`、`LLM COMPANION >`、`SETTINGS`、`INVENTORY`、`QUIT TO MENU`、`RESUME` 都还在。
- **coordinate 锚点**：旧 (140,200)、(640,420/540/480) 全部失效（Lead 已决定 tester 按可见组件适配）；Inventory 的 `EQUIP` 行仍保留 x=420、y=186/230/274 与 `input.enabled` 语义（`checkpoint.spec.ts` 依赖），这点实现者做得对，tester 不要改它。
- ECHO 页与 LLM 页的 BACK 现在回 **AI & COMPANION**（不是 root）；root ESC = 恢复游戏，面板内 ESC = 上一层。断言请按层级写。

## 4. 我本轮**没有**验证的（不要当 PASS 依据）

- 多视口/多分辨率（1024×768、800×600、1366×768、1600×900、1920×1080）的真实重叠与可读性 —— 待 tester 的 layout audit 冻结后跑。
- 真实 companion/owner 全链路（真模型或夹具）与 reauth 原子性 —— **B1 修好前这条链在 UI 上不可达**，无法给出 PASS。
- 全量 vitest / 全量 Playwright 基线对照（743/745、91/93）—— 本轮未跑。
- Settings 四个分组的真状态持久化（读 `saveSystem` 的代码路径正确，但没有浏览器重开验证）。

**结论：首版在「版面」上确实把 R1–R6 做对了（浏览器证据支持），但 R7 未做、R8 未闭环、R9 还有 B3/B4 两个风险点；在 B1 修好并给出多视口证据之前不能宣称 PASS。**
