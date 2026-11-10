# LAST SIGNAL — Human–Agent Co-op 技术设计（PHASE 4）

> 本阶段只完成设计审计，未授权实现
> Git 初始化统一表述：PHASE 0 Task 0.1，本阶段未授权，需用户确认后执行
> 项目 `D:/Project/LAST_SIGNAL` · 当前 `0.1.0` → 计划 `0.2.0` · Vite + TypeScript + Phaser 3.90（CANVAS）
> 愿景：*A Game for Humans and Agents*
> 本文件属于 **0.2.0 Technical Design & Architecture Audit** 的 6 个设计文档之一，**PHASE 4 — Human–Agent Co-op**。
> 本阶段**只做技术设计、架构审计与路线图，不实现任何功能**；下文除显式标注 `【已实现】` 的现状外，**全部为 0.2.0 设计提案**，逐项标注 `【需新建】` / `【需扩展】`。
> 统一事实基座为前置审计 `audit/FACTS.md`（尤其 §7.4 Co-op 统一口径、§7.5 七个必答问题、§4.2/§4.9 Player 与场景输入链、§6 不虚构白名单）；术语与阶段编号一律按该文件。
> 状态标签：`【已实现】`（现状）/ `【需扩展】`（在已有文件上加能力）/ `【需新建】`（全新模块或文件）/ `TBD — Requires User Decision`（需用户拍板）。

---

## 0. 文档定位、阶段编号与授权边界

**阶段编号（严格按 FACTS §7.1）**：

| 阶段 | 名称 | 与 0.2.0 交付节奏的关系 |
|---|---|---|
| PHASE 0 | 工程基线 | `0.2.0-alpha` = PHASE 0–1 |
| PHASE 1 | 可玩闭环与内容深度 | `0.2.0-alpha` = PHASE 0–1 |
| PHASE 2 | Signal 系统核心 | `0.2.0-beta` = PHASE 2 |
| **PHASE 3** | Agent Bridge 与本机 Harness 接入 | `0.2.0-rc` = PHASE 3–4 |
| **PHASE 4** | **Human–Agent Co-op（本文件）** | `0.2.0-rc` = PHASE 3–4 |
| PHASE 5 | 0.2.0 集成、加固与发布验收 | `0.2.0` = PHASE 5 |

- 现状基线（`0.1.0`）：项目 `0.1.0`；**本轮之前仅有 `docs/STYLE_GUIDE.md`（9791 字节，只读，本文件不得修改）；本轮新增 6 个设计文档**；当前不是 Git 仓库；源码中**没有任何 AI / Agent / 协作模式 / Signal 系统 / Bridge 实现**（FACTS §5 缺口 6）。
- 本阶段唯一交付物为 `docs/` 下 6 个新建设计文档；本文只写自身，不写 6 个文档之外的任何文件；不改源码、不装依赖、不初始化 Git、不提交 commit。另禁止修改 `docs/STYLE_GUIDE.md`、写 `dist/` / `test-results/` / `tests/screens/` / `node_modules/`、删除文件、创建 `.gitignore`。
- Git 初始化统一表述：**PHASE 0 Task 0.1，本阶段未授权，需用户确认后执行**。
- `TBD — Requires User Decision`（TBD-13）：若用户已有总计划书中的既定 PHASE 定义，**请以总计划书原文为准重新对齐阶段编号**；本文件按 FACTS §7.1 使用 PHASE 4。
- `TBD — Requires User Decision`（TBD-14）：`0.2.0-alpha` / `0.2.0-beta` / `0.2.0-rc` / `0.2.0` 的具体日期待用户决定。
- `TBD — Requires User Decision`（TBD-15）：Git 初始化授权问题——PHASE 0 Task 0.1，本阶段未授权，需用户确认后执行。

---

## 1. 现状基线（全部为 `【已实现】`，仅作设计落点核对）

- **输入链**：`GameScene.create()` 注册 `keydown-ESC` → `onPause()`、`keydown-I` → `toggleInventory()`、`keydown-F` → `this.world.tryInteract(this.world.player)`、`keydown-Q` → `switchWeapon(-1)`、`keydown-E` → `switchWeapon(1)`，并注册 `pointerdown` / `pointerup`（仅 `p.button === 0` 左键驱动 `this.fireHeld`）；另 `this.keys = this.input.keyboard!.addKey('SPACE')` 与一个空回调 `keydown_SPACE`。**WASD 与冲刺用的 `space` 实际由 `World` 构造函数**通过 `keyboard.addKey('W'/'A'/'S'/'D'/'SPACE')` 注册，并经 `Player.registerInput(keys, cursors)` 交给 `Player`（`GameScene.create()` 通过 `new World(this, map, save, callbacks)` 触发）。`Player.updateKeys()` 填 `input`，`Player.update(dt)` 做归一化、`IsoMath` 逆变换、`World.isWalkable()` 轴分离碰撞；`aimFromPointer()` 在 `GameScene.update()` 每帧由 `activePointer` 调用；`setFireHeld(this.fireHeld)` → `tryFire()` → `World.spawnProjectile()`。**当前鼠标右键没有任何绑定**；**当前没有装填按键**（`Player.update()` 自动递减 `WeaponState.reloadTimer`）；`GameScene.switchWeapon()` 是 `private` 方法。
- **暂停链**：`GameScene.paused` 为 `update()` 早退条件；`onPause()` → `paused=true` + `scene.launch('PauseScene')`；`PauseScene.create()` 内局部 `close()`（RESUME / CLOSE / ESC 回调触发）→ `scene.stop()` + `parent.onResume()` → `paused=false`；`GameScene.onLevelUp()` → `paused=true` + `cameras.main.setAlpha(0.5)` + `scene.launch('LevelUpScene',{level})`；`LevelUpScene.choose()` → `applyUpgrade()` + `parent.world.saveProgress()` + 180ms 后 `paused=false` / alpha 1；`GameScene.onDeath()` / `onBossWin()` → `scene.start('GameOverScene', {...})`。
- **HUD**：`GameScene.setupHud()` 创建全部 HUD 元素，`HUD_DEPTH = 500`；`lockHud()` 用 `cam.getWorldPoint(sx, sy)` 反投影屏幕锚点并设 `scale = 1/zoom`（源码为 `const z = this.cam.zoom || 1; const iz = 1 / z;`）；`refreshHud()` / `refreshMinimap()` / `refreshBoss()` 每帧刷新；`refreshBoss()` 文案为 `★ THE WARDEN — PHASE {boss.phase} ★`。**当前 HUD 没有 AI 状态面板**。
- **测试**：`tests/audit.spec.ts`（2 tests）、`tests/canvas.spec.ts`（1 test）、`tests/gameplay.spec.ts`（1 test）、`src/core/runtime.test.ts`（7 tests）。
- **结论**：`Mode A Human` / `Mode B Agent` / `Mode C Co-op`、Input Arbitration、AI 状态面板、Physical Core / Signal Core、协作专属内容**在当前源码中全部不存在**；下文均为 0.2.0 提案。

---

## 2. 三种游戏模式（`【需新建】` + `【需扩展】`）

> 本节全部为 0.2.0 设计提案。`【需新建】` 模式管理与模式状态机；`【需扩展】` `MainMenuScene` / `GameScene` / `HUD`。当前无模式概念（`【已实现】` = 无）。
> **统一口径（逐字）**：`Mode A Human` / `Mode B Agent` / `Mode C Co-op`；**Mode A 为默认且无 AI 时可独立运行**。

### 2.1 `Mode A Human`

- **定义**：纯人类单人模式。Agent Bridge 不连接或仅处于 `OFFLINE`；无 AI 时可独立运行；`GameScene` / `World` / `Player` 对 Bridge 零依赖。`【需新建】`
- **进入条件**：`MainMenuScene.create()` 的 `NEW RUN` 经 `scene.start('GameScene')` 默认进入；或由 `Mode B Agent` / `Mode C Co-op` 因心跳超时 / 断线 / `FAULT` 后自动降级进入。人类 `takeover` 只触发 `YIELDED`，**不改变模式**。`【需扩展】`
- **允许的操作**：人类拥有第 3 节表格中全部 10 项权限（移动 / 瞄准 / 开火 / 冲刺 / 装填 / 切枪 / 交互 / 升级三选一 / 暂停 / Signal 能力）；AI 状态面板固定显示 `OFFLINE`；所有 Agent 动作通道关闭，不产生 `action_request`。`【需扩展】`
- **退出条件**：用户在主菜单显式选择 `Mode B Agent` 或 `Mode C Co-op`（是否可在局内热切换见 TBD-02）；或显式确认 Bridge 连接并完成委托。任何退出都不得改变「无 AI 可玩」这一底线。`【需扩展】`

### 2.2 `Mode B Agent`

- **定义**：Bridge 连接后由 Agent 主要驱动物理与 Signal 动作，人类保留监督、暂停与接管。**不是「无人值守游戏」**：控制权铁律仍为**人类最高优先级**。`【需新建】`
- **进入条件**：用户显式选择 + PHASE 3 的 Bridge `hello` 成功 + Observation/Action schema 校验通过（协议细节属 PHASE 3，本文件不定义）；进入后状态面板为 `OBSERVING`。`【需扩展】`
- **允许的操作**：Agent 的 `action_move` 等 DTO 经 Bridge **落到 `Player` 输入层（与人类输入同层）**，不直接操作 Phaser 对象；人类可随时以任意有效输入触发 `takeover`；暂停 / 恢复 / 升级三选一 / 模式切换仍归人类（升级是否允许代选见 TBD-04）；结算场景期间 Agent 冻结。`【需扩展】`
- **退出条件**：心跳超时 / 断线 / `FAULT` 持续 → 自动 `FAULT` → `OFFLINE` + `Mode A Human`；人类显式切回；`GameOverScene` 结算结束本局。`【需扩展】`

### 2.3 `Mode C Co-op`

- **定义**：人类与 Agent 按 `Physical Core` / `Signal Core` 的权限分工协作；同帧人类与 Agent 输入冲突由 **Input Arbitration** 以**人类最高优先级**裁决。`【需新建】`
- **进入条件**：用户显式选择 + Bridge 连接 + 委托掩码（哪些通道委托给 Agent）确定；具体掩码见 TBD-06。`【需扩展】`
- **允许的操作**：人类持默认权限；Agent 仅在被委托的通道内写入同一 `Player` 输入层；状态面板在 `OBSERVING` / `PLANNING` / `EXECUTING` / `SIGNALING` / `YIELDED` 间流转；协作专属内容仅在本模式可作为挑战开放（第 7 节）。`【需扩展】`
- **退出条件**：断线 / 心跳超时降级到 `Mode A Human`；显式关闭委托；超时自动恢复委托到期后维持本模式（参数 TBD-07）；结算结束本局。`【需扩展】`

### 2.4 模式切换矩阵（`【需新建】`）

| 从 ↓ / 到 → | `Mode A Human` | `Mode B Agent` | `Mode C Co-op` |
|---|---|---|---|
| `Mode A Human` | —（默认态） | 需用户显式选择 + Bridge 连接 | 需用户显式选择 + Bridge 连接 + 委托掩码 |
| `Mode B Agent` | **自动**：断线 / 心跳超时 / `FAULT` 持续 → `FAULT` → `OFFLINE` + `Mode A Human` | — | 用户显式切换（是否允许热切换 TBD-02） |
| `Mode C Co-op` | **自动**：断线 / 心跳超时 / `FAULT` 持续 → `FAULT` → `OFFLINE` + `Mode A Human` | 用户显式切换（TBD-02） | —（`YIELDED` 是本模式内的让权态，不是模式切换） |

- 所有向 `Mode A Human` 的降级都是**立即、自动、不可由 Agent 单方撤销**的，且必须清空在途 Agent 动作（第 4.6 节）。`【需新建】`
- `YIELDED` 只表示 Agent 让权，**不改变模式**；人类 `takeover` → `YIELDED`，模式不变；`FAULT` 只表示故障，随后的自动降级才改变模式。`【需新建】`
- 切换是否允许在一局运行中发生、是否清空委托状态与在途动作、是否回退到检查点：`TBD — Requires User Decision`（TBD-02）。

### 2.5 选择 UI 落点（`【需扩展】`）

- 落点为 `MainMenuScene.create()` 现有三个按钮：`NEW RUN`（回调 `scene.start('GameScene')`）、`LOAD RUN · 暂未实现`、`CONTINUE · 暂未实现`（后两者为 dim 态，`_flash('暂未实现：读档尚未实现 (NOT IMPLEMENTED)')`），以及底部操作提示文本。
- 提案：模式选择入口挂在 `MainMenuScene.create()`，把选择结果作为**可选参数**传给 `scene.start('GameScene')`（现有 `GameScene.create(config: { seed?, isNewRun? })` 的 `SceneConfig` 只允许加可选字段，不得让无 Bridge 的 `NEW RUN` 变成必填）。
- 三个现有按钮如何复用（是否把两个 dim 按钮改造为模式入口、还是新增第 4/5 个按钮；`LOAD RUN` / `CONTINUE` 的真实读档属 PHASE 1，是否与模式选择合并；`scene.start('GameScene')` 传参是否扩展）：`TBD — Requires User Decision`（TBD-16）。
- `GameOverScene.create()` 的 `RETRY` / `NEW RUN` 与 `MAIN MENU` 也调用 `scene.start('GameScene')` / `scene.start('MainMenuScene')`，模式选择须覆盖这条重开路径。`【需扩展】`

### 2.6 具体默认模式与显式选择（`TBD — Requires User Decision`）

按 FACTS §7.4 统一口径，**Mode A Human 为默认且无 AI 时可独立运行**；但以下仍待用户拍板：

- `TBD — Requires User Decision`（TBD-01）：`NEW RUN` 是「无提示直接进 `Mode A Human`」还是「先弹模式选择」？是否允许用户把「上次使用的模式」写入存档并作为下次默认（涉及 `SaveData` 是否新增 `mode` 字段，属存档格式重大决策）？是否强制用户显式点选一次模式才允许开局？

---

## 3. 默认控制分工表（`【需扩展】` / `【需新建】`）

> 本节全部为 0.2.0 设计提案。「真实输入链」列为 `【已实现】` 事实核对；「人类权限 / Agent 权限 / 委托类别 / 提案状态」列为设计。
> 每一行的 Agent 侧动作都遵守 FACTS §7.5 第 3 问：**Action API 只发 DTO → Local Bridge → 落到 `Player` 输入层（与人类输入同层）**，不允许 Agent 直接改写 `wx/wy`、`sprite`、`data.weaponKey` 或任何 Phaser 对象。

| 动作项 | 真实输入链落点（`【已实现】`） | 人类权限 | Agent 权限 | 委托类别 | 提案状态 |
|---|---|---|---|---|---|
| 移动 | `World` 构造 `keyboard.addKey('W'/'A'/'S'/'D')` → `Player.registerInput()` → `updateKeys()` 填 `input` → `Player.update(dt)`（归一化 + `IsoMath` 逆变换 + `World.isWalkable()`） | 默认独占，随时可覆盖 | 仅 Mode B/C 且被委托时，经 `action_move` 写同一 `input` 槽 | 可委托 | `【需扩展】` |
| 瞄准 | `GameScene.update()` → `activePointer` → `Player.aimFromPointer(pointer)` → `cam.getWorldPoint()` → `World.screenToWorld()` → `aimYaw` | 默认独占，每帧覆盖式写入 | 经 `action_aim` 写同一 `aimYaw` 槽；不得直接旋转/设置 `sprite` | 可委托 | `【需扩展】` |
| 开火 | `GameScene.create()` 的 `pointerdown`/`pointerup`（`p.button === 0` 左键）→ `this.fireHeld` → `GameScene.update()` → `Player.setFireHeld(this.fireHeld)` → `tryFire()` → `World.spawnProjectile()` | 默认独占 | 经 `action_fire` 写同一 `_fireHeld` 槽 | 可委托 | `【需扩展】` |
| 冲刺 | `GameScene.create()` 注册 `this.keys = addKey('SPACE')` 与空 `keydown_SPACE`；实际判定在 `Player.update(dt)` 用 `cursors.space.isDown`（`World` 构造注册）→ `dashTimer` / `invuln` / `world.addShake(4)` | 默认独占 | 经 `action_dash` 写同一 `space` 槽 | 可委托 | `【需扩展】` |
| 装填 | **当前无独立输入键**：`Player.tryFire()` 弹匣打空置 `WeaponState.reloading/reloadTimer`，`Player.update()` 自动递减补满 `ammo` | 默认（自动） | `action_reload` 映射到该自动装填语义，不得直接改 `ammo` | 可委托（语义待定） | `【需扩展】` |
| 切枪 | `GameScene.create()` 的 `keydown-Q` / `keydown-E` → `GameScene.switchWeapon(-1/1)`（`private`），改 `data.weaponKey` | 默认独占 | `action_switch_weapon` 落点 `TBD — Requires User Decision`（`AGENT_BRIDGE_ARCHITECTURE.md` TBD-22 / `ARCHITECTURE_DECISIONS.md` ADR-04 的 TBD-07）：是新增 `Player` 输入层公开意图入口，还是复用 `GameScene.switchWeapon(dir)`（`private`）现有语义，须由用户拍板，不得预决；不得直接赋值 `data.weaponKey` | 可委托 | `【需扩展】` |
| 交互 | `keydown-F` → `GameScene.create()` → `World.tryInteract(this.world.player)`（命中门户则 `player.reset()` 到目标房间中心） | 默认独占 | `action_interact` 转成 F 槽事件，复用 `World.tryInteract()` | 可委托 | `【需扩展】` |
| 升级三选一 | `GameScene.onLevelUp(level)` → `paused=true` + `cameras.main.setAlpha(0.5)` + `scene.launch('LevelUpScene',{level})`；`LevelUpScene.choose()` → `applyUpgrade()` + `saveProgress()` + 180ms 后恢复 | 默认独占（任何模式都暂停等待人类） | 默认无权；是否允许 Mode B 代选见 TBD-04 | 委托待定（默认不委托） | `【需扩展】` |
| 暂停 | `keydown-ESC` → `GameScene.onPause()` → `paused=true` + `scene.launch('PauseScene')`；`PauseScene.create()` 内局部 `close()`（RESUME / CLOSE / ESC 回调触发）→ `scene.stop()` + `parent.onResume()`；`keydown-I` → `toggleInventory()`；`PauseScene` 的 `QUIT TO MENU` → `scene.stop('GameScene')` + `scene.start('MainMenuScene')` | **独占** | **永不委托**：Agent 只能被暂停影响，不能发起/解除暂停 | **永不委托** | `【需扩展】`（挂起/恢复 Agent 通道） |
| Signal 能力 | **当前无实现、无输入绑定**：`WEAPONS` 无 signal 字段、`Player.data.abilities` 为空、`GAME` 无 Signal 配置；`Scan`/`Jam`/`Decoy` 属 PHASE 2 | 默认（PHASE 2 人类可用） | `action_signal` 落到 `Signal Core` → 同一输入层的能力通道（数值/参数属 PHASE 2） | 可委托 | `【需新建】` + `【需扩展】` |

### 3.1 权限归类（明确结论）

- **默认归人类**：`Mode A Human` 下 10 项全部归人类；`Mode B Agent` / `Mode C Co-op` 下，人类仍保留每一项的最高裁决权，铁律逐字为：**人类最高优先级**。
- **可委托**（需显式委托掩码，TBD-06）：移动、瞄准、开火、冲刺、装填、切枪、交互、Signal 能力（8 项）。委托只让出「写入同一输入层的权利」，不让出「控制权」。
- **委托待定**：升级三选一 —— `TBD — Requires User Decision`（TBD-04）：是否允许 Agent 在 Mode B 自动调用 `LevelUpScene.choose()`？若允许，是否仍保留人类 180ms 确认窗口？升级暂停态是否允许 Agent 提交动作？
- **永不委托**（控制权与安全闸门，任何模式都不交给 Agent）：暂停 / 恢复（含 `GameScene.onPause()` / `onResume()` / `PauseScene.create()` 内局部 `close()`）、`takeover` 触发、模式切换、`QUIT TO MENU`、AI 状态面板的显示控制、断线降级决策。
- **装填语义**：`TBD — Requires User Decision`（TBD-03）：是否新增显式装填键位；PHASE 3 `action_reload` 是「主动请求装填」还是「等待 `Player.update()` 自动装填」。
- **Signal 键位**：`TBD — Requires User Decision`（TBD-05）：当前右键未绑定任何动作，Signal 能力由哪个键 / 鼠标键触发，是否在 `GameScene.create()` 新增注册。
- **委托粒度**：`TBD — Requires User Decision`（TBD-06）：Mode C 下哪些通道默认委托、是否提供逐通道开关、是否允许「只让出 `Signal Core`、保留 `Physical Core`」、`人类最高优先级` 的让权粒度是整局还是每通道。

---

## 4. ★ Input Arbitration（重点章节，`【需扩展】`）

> 本节全部为 0.2.0 设计提案。**控制权铁律逐字为：人类最高优先级**。本节结论与 FACTS §7.5 第 3 问（W3）「Agent 动作落到同一输入层」、第 5 问「如何保证人类输入优先」**完全一致，不得矛盾**。
> **跨文档统一口径**：Input Arbitration 落点统一为 —— `Player` 输入层合并器 = `【需扩展】`；独立 `InputArbitrator` / 新服务仅为备选且 `TBD — Requires User Decision`。

### 4.1 仲裁位置：放在 `Player` 输入层（结论）

- **结论**：仲裁逻辑 `【需扩展】` 落在 `src/entities/Player.ts` 的 `Player` 输入层，即 `registerInput()` / `updateKeys()` / `setFireHeld()` / `aimFromPointer()` 汇聚的**同一输入层**。Agent 的 `action_*` DTO 经 PHASE 3 Bridge 只写入该层的「Agent 输入槽」，与人类输入在同层合并后再由 `Player.update(dt)` 消费。`【需扩展】`
- **与 W3 一致性**：Agent 不直接操作 Phaser 内部对象；不序列化 `Phaser.Scene` / `World`；不直接写 `wx/wy`、`sprite`、`data.weaponKey`；`GameScene.create()` 的 Q/E/F/ESC 等真实注册仍是唯一入口语义，Agent 请求被翻译为「等价输入槽事件」而非新通道。`【需扩展】`
- **理由**：① 单一写入点，避免人类与 Agent 双写 `input` / `_fireHeld` / `aimYaw`；② 与现有 `GameScene.update()` → `world.update(dt)` → `Player.update(dt)` 帧循环一致，无需改动 `World.update()`；③ 无 AI 时该层自然退化为纯人类输入，`GameScene` / `World` / `Player` 对 Bridge 零依赖；④ 暂停时 `GameScene.paused` 早退直接冻结全部输入，无需额外开关。
- **落地形态**：`【需扩展】` 在 `Player` 内新增「人类输入槽 + Agent 输入槽 + 每帧合并器」；`updateKeys()` 之前完成合并，合并结果才写入 `this.input` / `_fireHeld` / `aimYaw`；`Player` 不 import 任何 Bridge / MCP 模块（由 `【需新建】` 的可选旁路在场景侧注入输入槽，注入失败即等价于 `Mode A Human`）。

### 4.2 备选：新服务（理由与取舍，必须写明）

- **备选方案描述**：独立 `InputArbitrator` / 新服务仅为备选且 `TBD — Requires User Decision`（当前源码中不存在任何 AI 或仲裁模块；FACTS §6.2 已明确 `InputArbitrator` 等均不是已存在的类，是否提取由用户拍板）。由它集中持有优先级表、动作队列、去抖计时、心跳、接管状态机，向 `Player` 输入层输出合并后的输入。
- **支持理由**：优先级与状态机集中、便于独立单元测试、跨场景（暂停 / 升级 / 结算）复用、动作队列与超时管理更清晰、与协议层（PHASE 3）解耦更整洁。
- **取舍与不采纳原因**：① 若 `GameScene` / `World` 显式依赖该服务，会破坏「Bridge 为可选旁路、`GameScene` / `World` / `Player` 零依赖」与「没有 AI 时游戏必须正常运行」； ② 若做成可选旁路但仍要在 `Player` 内保留最薄的合并点，则复杂度外移却产生**两个写入面**，与 W3「Agent 动作落到同一输入层」形成双重写入，冲突裁决反而更难保证； ③ 增加协议/生命周期耦合（谁创建、谁销毁、暂停时谁挂起），使 `PauseScene.create()` 内局部 `close()` / `LevelUpScene.choose()` 的恢复链路多一处状态需要同步； ④ PHASE 4 首个可运行版本应最小改动，符合本阶段「只做设计、不启动大规模功能开发」的边界。
- **结论**：本文件采用 4.1 的 `Player` 输入层内仲裁；「新服务」仅作为后续可提取重构的备选，是否提取、何时提取 `TBD — Requires User Decision`（TBD-02、TBD-06 一并决定）。**本结论不与 W3 矛盾**。

### 4.3 冲突处理：同帧覆盖、优先级、去抖与幂等、动作原子性

- **优先级顺序（从高到低）**：
  1. **人类最高优先级** —— 人类任意有效输入（含 `takeover`），同帧直接覆盖所有 Agent 写入；
  2. 安全 / 场景门控 —— `GameScene.paused`、`PauseScene`、`LevelUpScene`、`GameOverScene`；
  3. Agent 已获委托且正在执行的持续动作（`EXECUTING` / `SIGNALING`）；
  4. Agent 新到达的 `action_request` 队列；
  5. 空闲（全 `false` 输入槽）。
- **同帧冲突人类覆盖**：每帧在 `updateKeys()` 之前先合并两路输入；若同一通道（移动四方向、`_fireHeld`、`aimYaw`、`space` 槽、Q/E/F 槽、Signal 能力槽）人类存在有效输入，则丢弃该通道的 Agent 值；未被人类占用的通道才允许 Agent 值通过。**人类「无输入」不等于「释放委托」**，释放必须靠显式恢复或超时自动恢复（TBD-07），否则鼠标静止的每一帧都会被误判为让权。
- **去抖与幂等**：`【需扩展】` ① 边沿动作（切枪 Q/E、交互 F、冲刺 SPACE、装填、Signal 能力）以「动作 ID + 帧号」去重，重复 `action_request` 只执行一次；② 持续动作（移动、开火）以「设置状态」而非「累加」实现幂等，`setFireHeld(v)` 与 `input` 四方向天然幂等；③ `aimFromPointer()` 每帧覆盖式写入 `aimYaw`，不做增量；④ 人类 `keydown` 与 Agent 同帧同键只保留人类一份。去抖毫秒数、动作 ID 生命周期：`TBD — Requires User Decision`（TBD-07）。
- **动作原子性**：`【需扩展】` 一个 Agent 动作从 `action_request` → 执行 → `action_result` 视为一个原子事务；执行中被人类输入抢占则**整体取消**，回滚到动作开始前的「输入槽 / 委托状态」快照，**不回滚 `World` / `Player.data` 世界状态**（避免与确定性 RNG、`World.spawnProjectile()` 等已发生副作用冲突）；切枪、交互、装填等一次性状态变更必须在一帧内完成，不接受半途插入；单动作超时阈值 `TBD — Requires User Decision`（TBD-07）。

### 4.4 接管（takeover）

- **触发**：`【需扩展】` **人类任意有效输入立即触发接管**——同帧生效，不等待心跳、不等待当前 `action_result`。真实输入注册分两处：W/A/S/D 与 `cursors.space` 的 Key 对象由 `src/world/World.ts` 构造函数用 `kb.addKey`（或 `createKey`）创建，并经 `Player.registerInput()` 注入 `Player`；`GameScene.create()` 只注册 `SPACE`（空 `keydown_SPACE` 回调）/ `ESC` / `I` / `F` / `Q` / `E` 与 `pointerdown` / `pointerup`（仅 `p.button === 0` 左键）。两处产生的按键 / 状态变化均为有效输入（与第 1 节现状基线、`AGENT_BRIDGE_ARCHITECTURE.md`、`ARCHITECTURE_DECISIONS.md` 一致）；**每帧 `aimFromPointer()` 的被动指针位移是否算「有效输入」必须单独定义**（否则 Agent 永远无法保持委托）：`TBD — Requires User Decision`（TBD-07）。
- **取消 / 抢占正在执行的 Agent 动作**：`【需扩展】` 立即清空 Agent 输入槽、丢弃在途 `action_request` 队列、对当前 `EXECUTING` / `SIGNALING` 动作执行 4.3 的原子取消；向 Bridge 侧发出 `takeover` / `error` 类通知（协议属 PHASE 3，本文件不定义消息体）；AI 状态面板切到 `YIELDED`。
- **状态清理**：`【需扩展】` `_fireHeld` 交由人类 `setFireHeld()` 覆盖；`input` 四方向由 `updateKeys()` 覆盖；`aimYaw` 由 `aimFromPointer()` 覆盖；作废尚未落地的装填 / 切枪 / 交互 / Signal 一次性动作；清空动作 ID、`EXECUTING`/`SIGNALING` 计时与委托计时；**保持 `World` / `Player.data` / 相机 / 弹丸状态不变**（接管不是重置游戏）。
- **恢复委托的条件**：`【需新建】` ① **显式恢复** —— 人类通过 UI 或按键确认交还委托（触发方式 TBD-07）；② **超时自动恢复** —— 人类静默达到 N 秒、Bridge 心跳正常、且当前为 `Mode C Co-op` 时才允许（N 秒与是否需二次确认 TBD-07）；③ 处于 `Mode A Human` / `Mode B Agent`、断线、`FAULT`、暂停 / 升级 / 结算期间**一律不自动恢复**；④ 默认策略建议「不自动恢复」更安全，是否启用自动恢复 `TBD — Requires User Decision`（TBD-07）；⑤ 恢复后先进入 `OBSERVING` 再决定是否 `EXECUTING`，不回放被取消的队列。
- **留痕**：`【需扩展】` 每次接管与恢复都在 AI 状态面板写入 `YIELDED` ↔ `OBSERVING` / `EXECUTING` 的状态迁移，供人类核对。

### 4.5 暂停 / 恢复

- **与现有 `GameScene.paused` 的交互**：`【已实现】` `GameScene.update()` 首行 `if (this.paused) return;`，因此 `world.update(dt)`、`player.aimFromPointer(ptr)`、`player.setFireHeld(this.fireHeld)` 全停 → Agent 动作自然冻结。`【需扩展】` 但 Bridge 心跳与 `action_request` 队列必须显式挂起，避免暂停期间堆积的请求在 `onResume()` 瞬间集中爆发。
- **`onPause()` / `onResume()` / `PauseScene.create()` 内局部 `close()`**：`【已实现】` `keydown-ESC` → `onPause()` → `paused=true` + `scene.launch('PauseScene')`；`create()` 内局部 `close()`（RESUME / CLOSE / ESC 回调触发）→ `scene.stop()` + `parent.onResume()` → `paused=false`；**`PauseScene` 类没有 `close()` 方法**。`【需扩展】` `onResume()` 中先挂起恢复：清空暂停期队列 → 状态面板回 `OBSERVING` → 再按委托策略决定是否恢复 `EXECUTING`；`toggleInventory()`（`keydown-I` → `paused=true` + `scene.launch('PauseScene', {mode:'inventory'})`）走同一路径；`QUIT TO MENU` 显式 `scene.stop('GameScene')` 后必须释放 Agent 通道。
- **`LevelUpScene` 暂停态与 `cameras.main.setAlpha(0.5)`**：`【已实现】` `onLevelUp()` → `paused=true` + `cameras.main.setAlpha(0.5)` + `scene.launch('LevelUpScene',{level})`；`LevelUpScene.choose()` → 180ms 后 `paused=false` / alpha 1。`【需扩展】` `setAlpha(0.5)` 只影响渲染、不改变 `paused` 语义；状态面板同为 `HUD_DEPTH=500`，须在半透明叠加下仍按第 5 节色板保持可读；升级暂停期间 Agent 不提交动作（是否代选见 TBD-04）。
- **结算场景**：`【已实现】` `GameScene.onDeath()` / `onBossWin()` → `scene.start('GameOverScene', {...})`。`【需扩展】` GameScene 被替换时随 `shutdown` 释放 Bridge 通道与状态机，避免下一局残留委托。
- **Agent 在暂停 / 升级 / 结算下的行为**：`【需扩展】` 一律冻结 `PLANNING` / `EXECUTING` / `SIGNALING` 计时；不执行 `action_request`（收到则排队但不落地）、不发出成功的 `action_result`；心跳继续，以区分「暂停」与「断线」（心跳协议与阈值属 PHASE 3 + TBD-08）；面板可保持 `OBSERVING` 或 `YIELDED` 并显示冻结语义（最终文案 TBD-12）。

### 4.6 断线

- **心跳超时**：`【需扩展】` 以 PHASE 3 `ping` / 心跳判定连接存活；超时阈值、判定次数 `TBD — Requires User Decision`（TBD-08）。**心跳协议细节不在本文件定义**。
- **降级到 `Mode A Human`**：`【需新建】` 立即、自动、不可由 Agent 单方撤销；面板 `FAULT` → `OFFLINE`；`人类最高优先级` 在降级全程仍成立；降级不重开本局、不重置 `World` / `Player.data`。
- **进行中动作回滚**：`【需扩展】` 复用 4.3 的原子取消：清空 Agent 输入槽与在途队列、作废未落地的一次性动作、输入层恢复为「纯人类」；**不回滚世界状态**（弹丸、敌人、掉落、RNG 已发生副作用保持不变）。
- **重连策略**：`【需新建】` 退避重连 → 重连后先 `OBSERVING` 并同步公开 DTO（`observe_state` 等，属 PHASE 3）→ 再按用户策略决定是否恢复委托；重连次数 / 间隔、断线后是否强制降级且禁止自动回 `Mode C Co-op`：`TBD — Requires User Decision`（TBD-08）。
- **是否允许 Agent 续接**：`TBD — Requires User Decision`（TBD-08）：是否允许 Agent 在同一局内续接（不重开）？续接时是否补齐暂停 / 断线期间的公开 `observation`？这直接决定降级是「永久」还是「可恢复」。

---

## 5. AI 状态面板 7 种状态（`【需扩展】`）

> 本节全部为 0.2.0 设计提案，**逐字采用 FACTS §7.4 命名**：`OFFLINE`（未连接）、`OBSERVING`（观察中）、`PLANNING`（规划中）、`EXECUTING`（执行动作中）、`SIGNALING`（信号作业中）、`YIELDED`（已让权/人类接管）、`FAULT`（故障/超时/断线）。当前 HUD 无此面板（`【已实现】` = 无）。

### 5.1 状态定义表（`【需新建】` 状态机 + `【需扩展】` HUD）

| 状态 | 当前行为 | 触发条件 | 显示文案（候选） | 颜色语义（遵守 `docs/STYLE_GUIDE.md` 色板） | 退出条件 |
|---|---|---|---|---|---|
| `OFFLINE`（未连接） | 不读取 `observation`、不提交 `action_request`；输入层为纯人类；`Mode A Human` | 无 Bridge 连接；或降级完成；或用户确认关闭 Agent | `AGENT · OFFLINE / 未连接` | UI 中性灰 `#5a7480`（副文本 `#3d535d`、面板底 `#0d1822` / `#20303a`）；无情绪色 | Bridge `hello` 成功 → `OBSERVING` |
| `OBSERVING`（观察中） | 只接收公开 `observation` DTO，不写输入层 | 连接建立；或动作完成后；或恢复 / 重连后的初始态 | `AGENT · OBSERVING / 观察中` | 我方 / 系统主色 `#33e0ff`（低亮），文字冰白 `#eafaff` | 产出规划 → `PLANNING`；断线 → `FAULT`；降级 → `OFFLINE` |
| `PLANNING`（规划中） | 在 Agent 侧计算动作序列，不落地任何输入 | 收到有效 `observation` 且当前有委托权限 | `AGENT · PLANNING / 规划中` | 高光青 `#7ff0ff`（系统高亮脉冲） | 动作通过委托校验 → `EXECUTING` 或 `SIGNALING`；人类输入 → `YIELDED`；超时 → `FAULT` |
| `EXECUTING`（执行动作中） | 已获委托的 `Physical Core` 动作正在写入同一 `Player` 输入层 | `action_request` 经仲裁通过 | `AGENT · EXECUTING / 执行动作中` | 冰白 `#eafaff` 文字 + `#33e0ff` 青描边（进行中确认） | 动作完成 / 超时 / 原子取消 → `OBSERVING`；`takeover` → `YIELDED`；心跳超时 → `FAULT` |
| `SIGNALING`（信号作业中） | `Signal Core` 正在执行 Signal 能力 / 感知 / 环境交互（数值与能力定义属 PHASE 2） | `action_signal` 经仲裁通过且属于 `Signal Core` 通道 | `AGENT · SIGNALING / 信号作业中` | 金 `#ffd233`（色板「稀有 / 奖励 / 高威胁」语义，表示高价值特殊作业） | 作业结束 → `OBSERVING`；被人类抢占 → `YIELDED`；超时 → `FAULT` |
| `YIELDED`（已让权/人类接管） | 全部 Agent 输入槽清空、队列丢弃、在途动作取消；人类独占 | **人类任意有效输入立即触发 `takeover`**（4.4） | `AGENT · YIELDED / 人类接管` | 橙 `#ff8a3c`（色板「次要威胁 / 警示 / 菜单强调」，表示控制权转移，非错误） | 显式恢复 / 超时自动恢复（TBD-07）→ `OBSERVING`；断线 → `FAULT`；降级 → `OFFLINE` |
| `FAULT`（故障/超时/断线） | 冻结所有 Agent 动作，进入降级流程 | 心跳超时、动作超时、`action_request` schema 校验失败、WebSocket 断开 | `AGENT · FAULT / 故障·断线` | 红 `#ff3355`（色板「危险 / 主力敌对」） | 心跳超时 / 断线 / `FAULT` 持续 → 自动 `FAULT` → `OFFLINE` + `Mode A Human`；重连成功 → `OBSERVING`（是否续接 TBD-08） |

- **色板约束**：字体等宽 monospace、文字 `#eafaff`、副文本 `#8fb8c8` / `#5a7480`（`docs/STYLE_GUIDE.md` §5）；所有色值只取自色板 §2，「**禁止发明新色**」（§7 检查清单）；阵营归类按「我方青 / 威胁红橙紫金 / 中性灰」；**本文件不修改 `docs/STYLE_GUIDE.md`**。`【需扩展】`
- **单一状态**：面板为单值显示；多事件并发时的取值优先级（建议 `YIELDED` > `FAULT` > `SIGNALING` > `EXECUTING` > `PLANNING` > `OBSERVING` > `OFFLINE`）、最终文案与图标：`TBD — Requires User Decision`（TBD-09、TBD-12）。
- **隐藏信息**：面板只显示状态与可读文案，**不得**显示 `seed`、RNG 内部状态、未探索房间、敌人内部计时 / 巡逻点 / 状态（FACTS §7.5 第 6 问）。`【需扩展】`

### 5.2 UI 落点（`【需扩展】`，全部挂在现有 HUD 链上）

- `GameScene.setupHud()`：新增状态面板文本 / 指示条，一律 `setDepth(500)`（`HUD_DEPTH=500`），与现有 `hpBar` / `txtHp` / `txtStats` / `timer` 同层；沿用 `Graphics` 直接写 `originX/originY` 的既有写法。`【需扩展】`
- `lockHud()`：新增元素必须通过 `cam.getWorldPoint(sx, sy)` 把屏幕锚点反投影到世界坐标，并设 `scale = 1/zoom`（源码 `iz = 1 / z`），才能在相机滚动 / 缩放（`GAME.CAM_ZOOM_MIN` ~ `GAME.CAM_ZOOM_MAX`）时保持屏幕固定、大小不变。`【需扩展】`
- `refreshHud()`：每帧按当前状态刷新文案与颜色；`Mode A Human` 恒为 `OFFLINE`，不得因无 Bridge 而报错或空指针。`【需扩展】`
- `refreshMinimap()`：可选绘制 Agent 关注点标记（只叠加绘制，不改 `map.rooms` / `currentRoom()` 数据）。`【需扩展】`
- `refreshBoss()`：可在 `★ THE WARDEN — PHASE {boss.phase} ★` 旁并列显示协作 / `SIGNALING` 提示；**不改 Boss 血量、阶段、数值**。`【需扩展】`
- 面板锚点（是否复用 `txtStats` / `timer` / `txtRoom` 附近区域）、`cameras.main.setAlpha(0.5)` 半透明下的可读性、是否在 `refreshBoss()` 显示 Agent 状态：`TBD — Requires User Decision`（TBD-12）。

---

## 6. Physical Core / Signal Core 权限分工（`【需新建】` + `【需扩展】`）

> 本节全部为 0.2.0 设计提案。**统一口径逐字：只做权限分工，不做人格**。
> **必须明确：不做人格、不做对话角色、不引入拟人设定**。两个 Core 只是「权限域」的技术命名，不对应任何角色、意识、性格、情绪、台词或叙事主体；AI 状态面板的 7 种状态同样只是运行状态，不是人格表现。

### 6.1 能力边界（`【需新建】`）

| 权限域 | 能力范围 | 落点 | 明确不含 |
|---|---|---|---|
| `Physical Core` | 移动 / 瞄准 / 开火 / 冲刺等物理动作，以及装填 / 切枪 / 交互（F 键的门户传送） | 第 3 节表格中 `【已实现】` 的 `Player` 输入链：`registerInput()` / `updateKeys()` / `aimFromPointer()` / `setFireHeld()`、`GameScene.switchWeapon()`、`World.tryInteract()` | 不写 Signal 数据模型、不感知信号强度、不读隐藏信息 |
| `Signal Core` | Signal 能力 / 感知 / 环境交互（PHASE 2 的 `Scan` / `Jam` / `Decoy` 与信号感知） | `【需新建】` 能力通道，最终仍汇入同一 `Player` 输入层；其观察输入来自公开 DTO 白名单 | 不直接改 `wx/wy`、`sprite`、`data.weaponKey`、`_fireHeld`；不定义 Signal 数值（属 PHASE 2） |

- 注意区分两个「交互」：`Physical Core` 的交互指 `World.tryInteract()`（F 键门户）；`Signal Core` 的「环境交互」指 PHASE 2 中 Signal 对环境设施的作用，**两者不是同一机制，不得混写**。`【需新建】`
- `Signal Core` 依赖 PHASE 2 Signal 系统；本文件**不重复定义**数据模型字段、7 类信号、Signal Energy、能力参数、falloff 与坐标铁律。`【需新建】`

### 6.2 权限互斥与协同规则（`【需新建】`）

- **互斥**：每个动作通道同一时刻只有一个持有者（`人类` / `Agent-Physical Core` / `Agent-Signal Core`），以「通道锁」实现；同一通道的并发请求由 4.3 的优先级顺序裁决；`Physical Core` 与 `Signal Core` 是不同的通道集合，可并行，但**所有输出都必须经过同一个 Input Arbitration**，不允许任何 Core 绕过输入层直写世界状态。
- **协同**：`Signal Core` 的感知结果只能经**公开 DTO 白名单**输出（FACTS §7.5 第 6 问），供人类 / Agent 决策；决策产生的物理动作再由 `Physical Core` 通道落到 `Player` 输入层。`Signal Core` 不得把感知结果直接写成 `Player.data` 或 `World` 字段；两个 Core 之间不共享内部对象引用。
- **让权一致性**：`YIELDED` 或 `FAULT` 时**两个 Core 同时停止写入**；`OFFLINE` 时两个 Core 都不存在有效通道；`Mode A Human` 下只有人类一个持有者。
- **状态映射**：`EXECUTING` 对应 `Physical Core` 动作、`SIGNALING` 对应 `Signal Core` 作业；二者并发时按 5.1 的单一状态优先级取值（TBD-12）。

### 6.3 与 Input Arbitration 的关系（`【需扩展】`）

- 两个 Core 是「**谁可以请求什么**」的权限域；Input Arbitration 是「**谁的请求在同一输入层生效**」的裁决器。二者分层，不重叠、不互相替代。
- **人类最高优先级**对两个 Core 同时生效：人类任一有效输入可同时抢占 `Physical Core` 与 `Signal Core` 的通道。
- 仲裁**不创建新输入通道**，只做合并与覆盖，因此与 FACTS §7.5 第 3 问（W3）「Agent 动作落到同一输入层」保持一致；与 4.2 的「新服务」备选结论也不矛盾（两 Core 是逻辑划分，不是新增服务进程）。

### 6.4 命名与叙事包装（`TBD — Requires User Decision`）

- `TBD — Requires User Decision`（TBD-09）：`Physical Core` / `Signal Core` 的对外中文名称、7 种状态的最终文案与图标、是否允许任何叙事化表述；**用户需确认不会突破「不做人格、不做对话角色、不引入拟人设定」这条硬边界**。
- 两个 Core 的逻辑模块为 `【需新建】`（当前源码中不存在）；`Player` 输入层的合并点为 `【需扩展】`；`GameScene` / `World` / `Player` 对它们的依赖必须保持可选（第 8 节）。

---

## 7. 协作专属内容原则（`【需扩展】` / `【需新建】`）

> 本节全部为 0.2.0 设计提案，**当前均未实现，不得写成已实现**。协作数值、Signal 机制、协议一律不在本文件定义。

### 7.1 现状锚点（`【已实现】`）

- `src/world/MapGenerator.ts` 的 `assignRoles()` 与 `src/types/index.ts` 的 8 种 `RoomKind` 声明：`start | combat | resource | elite | shop | event | boss | extraction`。**真实差异**：`assignRoles()` 只赋 7 种（`extraction` 从未被赋值、也无任何运行时逻辑）；`MapGenerator.generate()` 内部已调 `assignRoles()`，`GameScene.buildMap()` 之后又显式调了一次 `assignRoles(gen, map.rooms, map.roomsOrder)`；`guaranteeReachable()` 保证全房间可达。
- `World.onEnterRoom()`（`private`）按 `spawnRoom` / 房间类型触发 `spawnForRoom()`（`private`，只对 `elite` / `shop` / 其他区分敌人数量）、`spawnBoss()`、`spawnResourceLoot()`、`placePortal()`；`World.updateRoom()` → `currentRoom()` → `onEnterRoom()`；`World.tryInteract()` 由 F 键触发房间传送。
- `Boss`（`src/entities/Boss.ts`，独立类、不继承 `Enemy`）三阶段：`Boss.hit()` 按 `_hp / maxHp()` 切换 `phase`（`>0.66 → 1`、`>0.33 → 2`、否则 `3`），切换时 `world.scene.events.emit('boss-phase', this.phase)`；phase 1 追击 + `shockwave()`，phase 2 中距环绕（`desired=6`）+ `summonDrones()` + `fireLaser()`，phase 3 不移动 + `fireLaser()` + 每 `_id % 3 === 0` 时 `shockwave()`。
- `Enemy.detects()`（`src/entities/Enemy.ts`）当前是**唯一感知入口、纯欧氏距离**，无视线 / 信号 / 噪声概念；`EnemyStateName` 的 `idle/patrol/detect/chase/attack/reposition/stun` 七个 case 真实存在，`'dead'` 只是类型声明。

### 7.2 「必须人机协作才可解」的设计原则（全部 `【需扩展】` / `【需新建】`）

- **房间层**：以现有 8 种 `RoomKind` 为锚点，`【需扩展】` `assignRoles()` / `Room` 增加**可选**协作标记（例如某 `event` / `elite` 房间标注需 `Physical Core` + `Signal Core` 有序提交），在 `World.onEnterRoom()` / `spawnForRoom()` 增加协作条件判定；**不得**改变 `MapGenerator.generate()` 的 `guaranteeReachable()` 可达性，也不得把协作房间放在唯一通路上。`【需扩展】`
- **敌人层**：协作敌人需要物理作用与 Signal 作用同时 / 有序命中才能解除状态；`【需扩展】` 只能落在真实集成点 `Enemy.detects()`、`Enemy.enterDetect()`、`Enemy.data.stateTimer/targetId/stunTimer/spawnRoom`、`Enemy.stateMachine()` 的 `detect` / `reposition` / `stun` case、`Enemy.stun()`、`World.spawnEnemy()`、`World.updateRoom()`、`ENEMY_STATS.aggroRange`、`WorldCallbacks.onRoomEntered/onRoomCleared`；Signal 感知阈值与 falloff 属 PHASE 2，**本文件不定义，不得写成已实现**。`【需扩展】`
- **谜题层**：`【需新建】` 协作谜题要求两类权限按序提交（例：Signal 先改变环境设施状态、Physical 再命中），且必须由 Input Arbitration 校验「两个通道分别由不同持有者在同一窗口内完成」；谜题状态只写入 `RoomInfo` / 房间级标记，不改 `MapData.tiles` 的 `wall/lava/water` 判定语义。`【需新建】`
- **Boss 层**：`【需扩展】` 在 `Boss` 三阶段上挂接协作窗口提示（例如 phase 2 / phase 3 的 `SIGNALING` 窗口），由 `GameScene.refreshBoss()` 显示；不改 `ENEMY_STATS.boss_warden` 数值、不改 `Boss.hit()` 阶段阈值、不改 `boss-phase` 事件语义。`【需扩展】`
- **具体玩法**（哪些 `RoomKind` 承载协作谜题、Boss 三阶段各自协作机制、「必须人机协作才可解」的判定边界、Mode A 单人替代解的形式、协作奖励与难度、`extraction` 是否启用）：`TBD — Requires User Decision`（TBD-10）。

### 7.3 硬约束：协作内容不能使 `Mode A Human` 单人不可通关

- **逐字约束**：**协作内容不能使 Mode A 单人不可通关**，对齐「没有 AI 时游戏必须正常运行」与 FACTS §7.5 第 7 问。`【需新建】`
- 主流程（首房 → `Boss` 胜利 → `GameOverScene`）在 `Mode A Human` 下必须始终单人可解；协作内容只能是**可选挑战房间 / 额外奖励 / 加速解 / 替代路径**，且必须提供人类仅用现有两处注册的真实人类输入链（W/A/S/D 与 `cursors.space` 由 `src/world/World.ts` 构造注册；`SPACE` / `ESC` / `I` / `F` / `Q` / `E` 与 `pointerdown` / `pointerup` 左键由 `GameScene.create()` 注册，见第 1 节）与 PHASE 2 人类可用 Signal 能力即可完成的**降级解**。`【需扩展】`
- `assignRoles()` 不得把协作房间放在唯一路径上；`guaranteeReachable()` 与 `tests/audit.spec.ts` 的固定种子流程（`menu -> movement -> fire -> kill -> loot -> upgrade -> pause -> teleport`）不得被任何协作门槛阻断。`【需扩展】`
- 「必须人机协作才可解」**只在 `Mode C Co-op` 的挑战语境内成立**，不能作为全局通关条件；若用户希望主流程也强制协作，则与本节约束冲突，必须显式拍板：`TBD — Requires User Decision`（TBD-10，含此冲突的取舍）。

---

## 8. ★ 没有 AI 时游戏必须正常运行（`【需扩展】` / `【需新建】`）

> 本节标题即 FACTS §7.4 的统一口径逐字表述：**没有 AI 时游戏必须正常运行**。以下全部为 0.2.0 设计提案与验收约束。

### 8.1 零依赖与默认态

- **Bridge 为可选旁路**：`【需新建】` PHASE 3 的 Game Client / Local Agent Bridge / Harness Adapter 链路只在用户显式选择 `Mode B Agent` / `Mode C Co-op` 时激活；`GameScene` / `World` / `Player` **零依赖**：不得 import Bridge / agent 模块，不得在 `create()` / `update()` 中因 Bridge 缺失而 `await`、抛错或改变帧循环。`【需扩展】`
- **Mode A Human 默认**：`【需扩展】` `MainMenuScene.create()` 的 `NEW RUN` → `scene.start('GameScene')` 在不连接 Bridge 时与 `0.1.0` 行为一致；`SceneConfig` 只允许新增**可选**字段，`GameScene.create(config)` 不得要求任何 Agent 参数。
- **断线降级**：`【需新建】` 心跳超时 / `FAULT` → 立即降级到 `Mode A Human`（4.6），输入层恢复纯人类；降级不重开本局、不重置 `World` / `Player.data`。
- **不可绕过**：`【需扩展】` `Player` 输入层在 `OFFLINE` 时不得存在任何 Agent 写入路径；`refreshHud()` 在无 Bridge 时正常显示 `OFFLINE`，不得空指针或 `console.error`（现有测试对 console error / pageerror 零容忍）。

### 8.2 既有测试在无 Agent 时须继续通过（`【已实现】` 基线）

| 测试文件 | 数量 | 逐字测试名 / 覆盖 |
|---|---:|---|
| `tests/audit.spec.ts` | 2 tests | `fixed-seed playability regression: menu -> movement -> fire -> kill -> loot -> upgrade -> pause -> teleport`；`P2 regression: boss bullets, screen-locked light, unlocked weapons, single UI sound` |
| `tests/canvas.spec.ts` | 1 test | `full HUD renders and stays locked during camera movement`（硬编码 `http://localhost:5199/`） |
| `tests/gameplay.spec.ts` | 1 test | `menu + gameplay render`（`PORT=5173`，写 `tests/screens/errors.json` 与截图） |
| `src/core/runtime.test.ts` | 7 tests | `round-trips a grid point through screen space`；`uses the 64x32 isometric grid`；`actually mutates PlayerData for every one of the 12 definitions`；`power raises damage, vitality raises maxHp and heals the delta`；`accepts a complete save`；`rejects malformed permanent numbers and non-array unlocks`；`rejects missing settings / stats instead of silently passing` |

- `【需扩展】` 四者均不得因新增模式 / 面板 / 仲裁改变断言语义：`tests/audit.spec.ts` 仍须断言 `NEW RUN` 只启动一次 `GameScene`、两个 dim 按钮不启动 `GameScene`、`paused` / `camAlpha` / 3 张升级卡 / Q/E 切枪 / 自动装填 / 屏锁光照 / Boss 弹速全部照旧；`tests/canvas.spec.ts` 仍须断言 10 个 HUD 区域有亮像素。
- `【需新建】` 任何 AI / Co-op 专属测试都必须是**新增**文件，不得成为上述 4 个既有测试的前置条件或改变其固定种子 `SEED=424242` / `seed:42` 的行为。

### 8.3 真实验收命令（本阶段只列命令、不执行）

- `npm run typecheck`（实际 `tsc --noEmit`）——`【需扩展】` 新增模式 / 状态类型后仍须退出码 0。
- `npm test`（实际 `vitest run`）——`【需扩展】` 期望 1 文件 / 7 tests passed。
- `npx playwright test`——`【需扩展】` 期望 4 passed、`CONSOLE ERRORS: 0`、无 `pageerror`。
  - **必须同时启动 5173 与 5199 两个 Vite dev server**：`tests/audit.spec.ts` / `tests/gameplay.spec.ts` 走 `http://localhost:5173/`，`tests/canvas.spec.ts` 硬编码 `http://localhost:5199/`。
  - **必须设置 `LS_SHOT_DIR`**（及 `--output`）把截图 / `errors.json` / 测试产物重定向到 workspace；本阶段禁止写入项目 `dist/` / `test-results/` / `tests/screens/` / `node_modules/`。
- `【需扩展】` 上述三条命令在**完全不启动 Bridge / MCP Server、不连接 Agent** 的情况下执行，即验证「没有 AI 时游戏必须正常运行」。
- 说明：本文件是设计文档，**本阶段不执行上述命令、不安装依赖、不产生任何验证产物**；命令仅作为 PHASE 4 实现与 PHASE 5 发布验收的判据。

---

## 9. 与 PHASE 2 / PHASE 3 文档的边界

> 本文件属 **PHASE 4**，只描述**模式 / 权限 / UI / 玩法**；**不重复定义网络协议与 Signal 数值**。结论不得与 FACTS §7.5 第 3 / 5 / 6 / 7 问矛盾。

### 9.1 与 `SIGNAL_SYSTEM_DESIGN.md`（PHASE 2）的边界

- 不定义 Signal 数据模型字段（`id / sourceId / type / position / intensity / radius / createdAt / duration / faction / metadata`）、7 类信号候选命名、Signal Energy 上限 / 恢复、`Scan` / `Jam` / `Decoy` 的消耗 / 半径 / 持续 / 冷却、确定性传播与 falloff、坐标铁律细则、武器-Signal 映射、`Enemy.detects()` 的阈值实现。
- 本文件只引用其**结论性接口**：「Signal 能力」作为 `Signal Core` 的权限范围、`SIGNALING` 作为状态名、协作内容需要 Signal 作用作为一类条件。所有 Signal 数值与实现细节**以 PHASE 2 文档为准**。`【需新建】` 的 `Signal Core` 依赖 PHASE 2，不越界定义。

### 9.2 与 `AGENT_BRIDGE_ARCHITECTURE.md`（PHASE 3）的边界

- 不定义 Local WebSocket Bridge / 独立 Node stdio MCP Server 的实现、消息类型（`hello / observation / action_request / action_result / event / error / takeover / ping`）、JSON schema、Observation API 6 工具（`observe_state` / `observe_entities` / `observe_map` / `observe_signals` / `observe_inventory` / `observe_events`）、Action API 9 工具（`action_move` / `action_aim` / `action_fire` / `action_dash` / `action_reload` / `action_switch_weapon` / `action_interact` / `action_signal` / `action_wait`）、心跳阈值、重连退避的具体实现与测试客户端。
- 本文件只引用其**前提**：三层架构逐字为 **Game Client / Local Agent Bridge / Harness Adapter**；链路逐字为 `Phaser Game <-> Local WebSocket Bridge <-> MCP Server <-> Local Harness`；MCP Server 为本机独立 Node **stdio** 进程；浏览器 WebSocket **只连 localhost**；双通道 = **MCP stdio + WebSocket**；Bridge 是可选旁路；Action DTO 落到 `Player` 输入层；Observation 由公开 DTO 白名单生成。
- **安全铁律（逐字，与 PHASE 3 一致）**：**不把 MCP 塞进 Phaser 核心**；**不允许 Agent 直接操作 Phaser 内部对象**；**不暴露隐藏信息**；**不把 API Key 放前端**。

### 9.3 与 FACTS §7.5 第 3 / 5 / 6 / 7 问的一致性核对

| 必答问题 | 本文件结论（不得矛盾） |
|---|---|
| 第 3 问：Agent 如何不直接操作 Phaser 对象 | 4.1 明确仲裁落在 `Player` 输入层，Agent 动作与人类输入同层合并（W3）；第 3 节每行禁止直写 `wx/wy` / `sprite` / `data.weaponKey`；6.2 禁止任何 Core 绕过输入层；观察数据由公开 DTO 生成，不序列化 `Phaser.Scene` / `World`。 |
| 第 5 问：如何保证人类输入优先 | 全文控制权铁律为**人类最高优先级**；4.3 同帧冲突人类覆盖；4.4 人类任意有效输入立即触发 `takeover`；4.5 / 4.6 暂停 / 恢复 / 断线自动降级到 `Mode A Human`；3.1 把暂停 / 接管 / 模式切换列为**永不委托**。 |
| 第 6 问：如何保证 AI 不拿隐藏信息 | 5.1 面板只显示状态与文案；6.2 感知结果只经公开 DTO 白名单；9.2 复用「不暴露隐藏信息」铁律。不输出未探索房间、敌人内部计时 / 巡逻点 / 状态、RNG 内部状态、`seed` 与存档内部字段（注意：`GameScene.seed` 真实存在、`GameOverScene.create()` 也向人类显示 `SEED {seed}`，但**不得**放进 Observation DTO）。白名单最终取舍与 schema 出参校验严格级别：`TBD — Requires User Decision`（TBD-11）。 |
| 第 7 问：如何保证无 AI 也能玩 | 第 8 节整节：Bridge 可选旁路、`GameScene` / `World` / `Player` 零依赖、`Mode A Human` 默认、断线降级、既有 4 个测试文件无 Bridge 仍须通过；7.3 追加「协作内容不能使 Mode A 单人不可通关」。 |

- `TBD — Requires User Decision`（TBD-11）：Observation DTO 白名单是否包含 Signal 强度、未探索房间、敌人 `stateTimer` / `patrolPoints` / `state`、`GameScene.seed`、RNG 内部状态与存档内部字段；以及 schema 出参校验的严格级别。请用户明确回答这些隐藏信息的具体取舍。

### 9.4 本阶段边界复述

- 本文件与同批次其余 5 个设计文档一样，**只交付设计，不实现**；本阶段唯一交付物为 `docs/` 下 6 个新建设计文档；本文只写自身，不写 6 个文档之外的任何文件；不改源码、不装依赖、不初始化 Git、不提交 commit；不修改 `docs/STYLE_GUIDE.md`、不产生构建 / 测试产物。Git 初始化：**PHASE 0 Task 0.1，本阶段未授权，需用户确认后执行**（TBD-15）。
- 核心玩法 / 控制权 / 安全的未定决策已在第 2–9 节逐项标 `TBD — Requires User Decision` 并写明具体问题，汇总见下一节。

---

## 本文件依据的源码文件

以下为撰写本文件时**逐一读取并核对**的真实项目文件（均为 `【已实现】` 现状，不含本阶段任何新增文件）：

- `src/scenes/GameScene.ts` —— `create()` 输入注册、`paused`、`onPause()` / `onResume()`、`switchWeapon()`、`setFireHeld()` / `aimFromPointer()` 调用、`setupHud()` / `lockHud()` / `refreshHud()` / `refreshMinimap()` / `refreshBoss()`、`HUD_DEPTH=500`、`cameras.main.setAlpha(0.5)`、`onDeath()` / `onBossWin()`。
- `src/scenes/MainMenuScene.ts` —— `create()` 三个按钮（`NEW RUN` / `LOAD RUN · 暂未实现` / `CONTINUE · 暂未实现`）与 `scene.start('GameScene')`。
- `src/scenes/PauseScene.ts` —— `create(config?: { mode?: 'pause' | 'inventory' })` 内局部 `const close = () => {...}`（由 RESUME / CLOSE 按钮与 `onEsc`（ESC）回调触发）、`showSettings()`、`_button()`、`QUIT TO MENU`；**类没有 `close()` 方法**；`parent.onResume()` 是 `src/scenes/GameScene.ts` 的方法。
- `src/scenes/LevelUpScene.ts` —— `choose()`、`applyUpgrade()`、`saveProgress()`、180ms 恢复与 `paused` / alpha 复位。
- `src/scenes/GameOverScene.ts` —— `create()` 结算、`SEED {seed}` 显示、`RETRY` / `NEW RUN` / `MAIN MENU` 的 `scene.start()` 路径。
- `src/entities/Player.ts` —— `registerInput()` / `updateKeys()` / `setFireHeld()` / `fireHeld()` / `aimFromPointer()` / `tryFire()` / `update(dt)`、`input` / `_fireHeld` / `aimYaw`、装填计时。
- `src/entities/Boss.ts` —— 三阶段、`Boss.hit()` 阶段切换、`fireLaser()` / `shockwave()` / `summonDrones()`、`boss-phase` 事件。
- `src/world/World.ts` —— 构造函数中的 WASD / SPACE 注册与 `registerInput()`、`tryInteract()`、`onEnterRoom()` / `spawnForRoom()` / `spawnBoss()`、`WorldCallbacks`、`update()` / `updateRoom()`。
- `src/world/MapGenerator.ts` —— `generate()`、`assignRoles()`、`roomDepth()`、`guaranteeReachable()`、8 种 `RoomKind` 的实际分配差异。
- `src/types/index.ts` —— `RoomKind`（8 种）、`PlayerData` / `WeaponState` / `EnemyStateName` / `SaveData` / `SAVE_VERSION=1` / `GameEventType`。
- `src/config/game.ts` —— `GAME`（`WINDOW_W/H`、`CAM_ZOOM_MIN/MAX`、`PIXEL_TO_TILE` 等）、`DEFAULT_SETTINGS`、`basePlayerData()`。
- `src/core/runtime.test.ts` —— 7 个 Vitest 测试名。
- `tests/audit.spec.ts` —— 2 个 Playwright 测试名、`PORT=5173` / `SEED=424242` / `LS_SHOT_DIR`。
- `tests/canvas.spec.ts` —— 1 个 Playwright 测试名、硬编码 `http://localhost:5199/`。
- `tests/gameplay.spec.ts` —— 1 个 Playwright 测试名、`PORT=5173`、`tests/screens/errors.json`。
- `docs/STYLE_GUIDE.md` —— 色板 §2、HUD 规则 §5、检查清单 §7（**只读引用，未修改**）。
- `package.json` —— `version: 0.1.0`、`typecheck` / `test` / `playwright` 脚本核对。

统一事实基座（非项目源码，仅作术语 / 阶段 / 口径依据）：前置审计 `audit/FACTS.md`（§4.2 / §4.9 / §6 / §7.1 / §7.4 / §7.5）。本文件未虚构任何现有文件、类、函数或测试；所有 `【需新建】` / `【需扩展】` 项均为 0.2.0 提案。

## 待用户确认事项

以下每一项均为 `TBD — Requires User Decision`，括号内为**需要用户明确回答的具体问题**；未确认前，本文件对应结论保持为设计提案、不得进入实现：

1. `TBD — Requires User Decision`（TBD-01 默认模式与显式选择）：按 FACTS §7.4「Mode A 为默认」，但 `MainMenuScene.create()` 的 `NEW RUN` 是「无提示直接进 `Mode A Human`」还是「先弹模式选择」？是否允许把「上次使用的模式」写入存档并作为下次默认（是否给 `SaveData` 新增 `mode` 字段）？是否强制用户显式点选一次模式才开局？
2. `TBD — Requires User Decision`（TBD-02 模式切换矩阵与存档格式）：是否允许一局运行中热切换 `Mode B Agent` / `Mode C Co-op` ↔ `Mode A Human`，还是只能在主菜单选择、开局后锁定？热切换时是否清空在途 Agent 动作与委托状态、是否回退到检查点？`SceneConfig` 是否新增可选 `mode` 字段、`SaveData` 是否新增字段（存档格式属重大决策）？「新服务」备选是否提取、何时提取？
3. `TBD — Requires User Decision`（TBD-03 装填语义）：当前源码没有独立装填键（`Player.update()` 自动装填），是否新增显式装填键位？PHASE 3 `action_reload` 是「主动请求装填」还是「等待自动装填」？是否允许 Agent 主动触发装填？
4. `TBD — Requires User Decision`（TBD-04 升级三选一）：`Mode B Agent` / `Mode C Co-op` 下是否允许 Agent 代选 `LevelUpScene.choose()`？若允许，是否仍保留人类 180ms 确认窗口？升级暂停态（`paused=true` + `cameras.main.setAlpha(0.5)`）是否允许 Agent 提交动作？
5. `TBD — Requires User Decision`（TBD-05 Signal 能力键位）：当前 `pointerdown` / `pointerup` 只处理 `p.button === 0`（左键）、右键无任何绑定；PHASE 2 的 `Scan` / `Jam` / `Decoy` 由哪个键 / 鼠标键触发？是否在 `GameScene.create()` 新增注册？
6. `TBD — Requires User Decision`（TBD-06 委托策略与让权粒度）：`Mode C Co-op` 下哪些通道默认委托给 Agent？是否提供逐通道开关（委托掩码）？是否允许「只让出 `Signal Core`、保留 `Physical Core`」？**人类最高优先级**的让权粒度是整局一次还是每通道独立？
7. `TBD — Requires User Decision`（TBD-07 仲裁与接管参数）：哪些算「人类任意有效输入」——每帧 `aimFromPointer()` 的被动指针位移是否计入？去抖毫秒数、单动作超时、动作 ID 生命周期？显式恢复委托的触发方式（哪个按键 / 哪个 UI 按钮）？超时自动恢复的秒数、是否默认启用、是否需要二次确认？暂停期间 `PLANNING` / `EXECUTING` 计时如何处理？
8. `TBD — Requires User Decision`（TBD-08 断线参数与续接）：心跳超时阈值与判定次数？退避重连次数 / 间隔？断线后是否强制降级 `Mode A Human` 且禁止自动回 `Mode C Co-op`？**是否允许 Agent 在同一局内续接（不重开）**？续接时是否补齐暂停 / 断线期间的公开 `observation`？
9. `TBD — Requires User Decision`（TBD-09 命名与叙事包装）：`Physical Core` / `Signal Core` 的对外中文名称、AI 状态面板 7 种状态的最终文案与图标、是否允许任何叙事化表述？请确认不会突破「不做人格、不做对话角色、不引入拟人设定」与「只做权限分工，不做人格」这两条硬边界。
10. `TBD — Requires User Decision`（TBD-10 协作专属玩法）：哪些 `RoomKind` 承载协作谜题、`extraction` 是否启用？`Boss` 三阶段各自的协作窗口是什么？「必须人机协作才可解」的判定边界如何界定？`Mode A Human` 的单人替代解采用什么形式？协作奖励与难度如何设定？若用户希望主流程也强制协作，请明确其与「协作内容不能使 Mode A 单人不可通关」约束冲突时的取舍。
11. `TBD — Requires User Decision`（TBD-11 隐藏信息白名单）：Observation DTO 是否包含 Signal 强度、未探索房间、敌人 `stateTimer` / `patrolPoints` / `state`、`GameScene.seed`（`GameOverScene` 已向人类显示 `SEED`，但 Agent 侧按 §7.5 第 6 问不应输出）、RNG 内部状态与存档内部字段？schema 出参校验采用何种严格级别？
12. `TBD — Requires User Decision`（TBD-12 面板 UI 细节）：AI 状态面板的屏幕锚点（是否复用 `txtStats` / `timer` / `txtRoom` 附近区域）、7 状态色值最终映射、状态并发时的取值优先级、是否在 `refreshBoss()` 显示 Agent 状态、`cameras.main.setAlpha(0.5)` 半透明叠加下的可读性标准？
13. `TBD — Requires User Decision`（TBD-13 阶段编号）：若用户已有总计划书中的既定 PHASE 定义，**请以总计划书原文为准重新对齐阶段编号**（本文件按 FACTS §7.1 使用 PHASE 4）。
14. `TBD — Requires User Decision`（TBD-14 版本日期）：`0.2.0-alpha`（PHASE 0–1）、`0.2.0-beta`（PHASE 2）、`0.2.0-rc`（PHASE 3–4）、`0.2.0`（PHASE 5）的具体日期？
15. `TBD — Requires User Decision`（TBD-15 Git 初始化授权）：**PHASE 0 Task 0.1，本阶段未授权，需用户确认后执行**；请确认是否在后续阶段授权初始化 Git 仓库。
16. `TBD — Requires User Decision`（TBD-16 模式选择 UI 落点）：`MainMenuScene.create()` 现有三个按钮（`NEW RUN` / `LOAD RUN · 暂未实现` / `CONTINUE · 暂未实现`）如何复用——把两个 dim 按钮改造为模式入口，还是新增第 4 / 第 5 个按钮？`LOAD RUN` / `CONTINUE` 的真实读档（PHASE 1）是否与模式选择合并？`scene.start('GameScene')` 的传参是否扩展、`GameOverScene` 的 `RETRY` / `NEW RUN` 重开路径如何沿用所选模式？
