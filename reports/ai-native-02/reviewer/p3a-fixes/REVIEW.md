# P3-a 三缺口修复 定向独立验收（212cd56）

- **被测提交**：`212cd5634ea4ef1e775294eab3ccfca8ecff3a1f`（HEAD，分支 `feat/ai-native-world-integration`）
- **链**：`39a43b2`(Task0) → `8b2de8e`(core echo) → `c3e1461`(rendered echo) → `b3930c5`(P3a 3/3，上轮基线) → `dd42239`(纯 companionFacet，P3b A) → `5537078`(修复 1/2) → `212cd56`(修复 2/2)
- **冻结**：`git -c core.autocrlf=false -c core.eol=lf archive 212cd56 | tar -x -C D:/Project/lastsignal-p3a-fixes-review-212cd56`；`node_modules` junction 指向共享依赖；Python 逐文件 git blob SHA1 → **ALL_TRACKED_FILES_MATCH（1945/1945, MISMATCH=0, MISSING=0）**
- **边界**：未改生产源码/已有测试/配置/分支；未 merge/reset；未读/恢复共享 WIP/stash；只审上轮三缺口 + 最小回归，未重复历史全量 E2E。凭据仅进程内随机假 token，日志/参数/URL 无 token。
- **结论**：**上轮三缺口（P3a-1/2/3）全部关闭，P3-a 可放行**；附带 frames 根 junction 修复关闭。新增 1 个非阻断残余（`validEchoActor` 数值上限过宽）+ 若干范围限制（见 §7），不掩盖。P3-b 仍不满足前置（LLM/Signal/energy 未实现）。

## 1. 缺口 1 — ActorTargetView / ActorCombatPort（legacy 敌人合法选/伤 ECHO）

| 检查项 | 结果 | 证据 |
|---|---|---|
| 只读观察面：`ActorTargetView`（readonly actorId/kind/x/y/hp/alive）+ `ActorCombatPort`（只读 target + `hurtTarget`） | **PASS** | `src/world/actorTarget.ts`；`Enemy.update(dt, ActorCombatPort)` / `Boss.update(dt, ActorCombatPort)`（不再收 `Player`） |
| 只把**该敌人可见**的 ECHO 列为候选（12 格 + 已探索 + 墙 LOS），nearest 存活 actor，平局保留玩家 | **PASS** | `World.isActorVisibleFrom` / `enemyCombatPort`；probe `ACTOR_FACADE_PASS` 6 项（nearest/tie/无 echo/死后改选/全死 null） |
| hunter(远程) / stalker(近战) / sentinel(近战) / Boss 真伤 ECHO、死后改选主角 | **PASS** | 渲染 E2E **3/3**：hunter `echoHurt=true`、`targetId='1'`、主角 HP 不变；`hp=1` 死后重选并伤主角；全种类 `hurt+locked`；Boss `bossHurt=true` |
| 全部 Boss 相位按所选 actor 计算 | **PASS（静态）** | `Boss.doAttack` phase1 `combat.hurtTarget`；phase2/3 `fireLaser(combat.target)`；shockwave 为真实 core 敌方弹道（`stepProjectiles` 命中 player/echo）。**运行时刻只断言了 phase1 近战**，phase2/3 未单独跑（§7） |
| facade 不伪 Player / 不写 core | **PASS** | `hurtTarget`：玩家走既有 `Player.hurt`（入队 pending hit），ECHO 走 `enqueueEchoHit`（`echo-hit` 命令）；仅 `bumpSimVersion()`，无 HP/位置直写；`processCommands` 是唯一提交点。probe：入队后 HP 不变、tick 后精确 -7 且带 `actorId` |
| echo 缺席行为不变 | **PASS** | 候选永远含玩家；无 echo 时 `targetId=0`（旧行为硬编码 0）；canonical 无 `echo` 键、无 `actorId/byActorId`；C2 官方 node parity `PARITY_PASS checks=8 failures=0`；`core echo.test.ts` 3 参逐 tick 一致 |
| 无友伤 + actorId 消歧 | **PASS** | echo/player 弹 `side:'player'` 只打敌；敌方弹命中 player/echo 由 `side` 决定而非 ownerId。probe 中 **drone id=1 与 ECHO_ACTOR_ID=1 共存**，`echo-fired`/弹道带显式 `actorId:1`、`enemy-hit` 带 `byActorId:1`，无 `player-hurt/echo-hurt`；legacy FSM 用 `targetActorKind` 明确 `player\|echo` |

## 2. 缺口 2 — 共享 echoView 与 Rendered↔Headless 新 parity（边界诚实性）

| 检查项 | 结果 | 证据 |
|---|---|---|
| 唯一共享投影，两端都调用 | **PASS** | `src/world/echoView.ts` `buildEchoObservation()` 纯 TS 无 Phaser/DOM/写状态；`World.echoView():245` 与 `HeadlessWorld.echoView():324` 均 `return buildEchoObservation(...)`，不再各自维护 |
| 含 `sim.targets` / Boss 合法公开数据 | **PASS** | `drones` + `targets` 都返回；target 字段严格 `id/kind/x/y/hp/isBoss`；独立 probe 在 headless `sim.targets` 放 hunter(77)/boss(78)/远 stalker(79) → 视图 `[77,78]`，79 不漏；`echoView.test.ts` 3/3、`worldHeadlessEcho.test.ts` 4/4 |
| 视野以 ECHO 为中心 / LOS / 隐藏投影不漏 | **PASS** | 半径 `ECHO_LIMITS.perceptionTiles=12`（两端 `WORLD_PERCEPTION.radiusTiles=12` 一致），`isExplored`+`isOpaque`+`gridLineOfSight`；probe 校验死/远/未探索/墙后全部丢弃；投影 JSON **零** `rngState/seed/map/pendingCommands/purchaseTransactions/nextProjectileId/loot/weapons/armor/...` 字段 |
| 跨端 parity 跑一次 | **PASS** | 渲染 spec `1/1` 导出 `initial/sequence/rendered.json`；Node `scripts/p3a-echo-rendered-parity.mts` → `P3A_ECHO_RENDERED_PARITY_PASS ticks=215 steps=208 echoHp=86`，canonical 与全量 events 逐字节相等；事件含 `enemy-hit/echo-fired/echo-hurt/enemy-died/loot-dropped/loot-collected` 与 `byActorId` |
| **static hunter 仅验证共享规则/观察，不等于 legacy FSM parity；报告边界是否诚实** | **PASS（诚实）** | 导出帧 `initial.pendingCommands=['spawn-loot']`（唯一显式 fixture），hunter 是静态 core target（legacy FSM idle、`stateTimer=1e9`），**无任何 legacy 命令被当两端共同决策回放**；spec 头、脚本头、开发者 `REPORT.md`「范围明示（Lead 裁定）」+「未完成边界（诚实）」四处都写明：严格字节 parity 只覆盖 core-managed actors，legacy FSM/AI 决策不在范围，由 `tests/p3a-enemy-target.spec.ts` 渲染 E2E 证明。未忽略 `targets` 字段掩盖差异（events 99374B 全量比较） |

**范围补充（不推翻诚实性）**：
- parity 比较的是 **canonical state/events**，不是两端 `echoView()` 输出字节；观察一致性靠「同一纯函数 + 单测 + 独立 probe」证明，不是跨端字节比较。
- parity 用 `World.stepFrame(..., echoIntentOverride)` 脚本化两端 intent（`sequence` 208 步每步都有 `echoIntent`），**绕过 EchoController 决策**；该第三参仅 dev/test（`__LAST_SIGNAL_DEV_TEST__`）诊断驱动使用，正常 `GameScene.stepFrame(delta,intent)` 与 Player/Dev MCP 工具面均无 `echoIntent`（`gate-mcp-surface.log`）。它不是真实 Agent/正常游玩 parity。
- 导出 spec 的 NEW RUN 未固定 seed（本次 `seed=983246596`，开发者日志 `ticks=212` / 本次 `ticks=215`，均 `steps=208 echoHp=86` 且自洽），是一次性对比而非固定种子回归门。
- 开发者 `REPORT.md` 引用的 `reports/ai-native-02/tester/p3a-final/P3A-FINAL-ACCEPTANCE.md` **不在冻结提交内**，未作为本轮验收证据。

## 3. 缺口 3 — restore/reset/echo death 授权复位 + HP + `validEchoActor`

| 检查项 | 结果 | 证据 |
|---|---|---|
| `Controller.reset()` 在 restore/reset/echo death 调用 | **PASS** | `echo.ts` 新增 `reset()`（follow/无 assist/无 suggestion/空 memory/neutral intent）；调用点 5 处：`resetProjectilesForTest:89`、`echo-death:1121`、`restoreCheckpoint:1571`、`reset():1586/1597`；静态日志 + 单测 2/2 |
| 旧档无 echo 后 enable 无旧 assist/memory/suggestion/开火 | **PASS** | 渲染 E2E `p3a-restore.spec.ts`：真 cleared-room checkpoint → restore → `assist=false, mode=follow, memory=0, suggestion=null, lastIntent=neutral`；可见 drone 仍 `intentFire=false, shots=0`；删 `coreState.echo` 旧档 → `assist=false, echoHp=100, intentFire=false, shots=0`；mode switch / reset 均撤销 |
| HP 来自存档，无回血/farm | **PASS** | E2E `echoHp=42`（存档值）、`playerHp=55`（存档值）互不污染；`reset()` 不重置 HP；`validEchoActor` 拒绝 `hp<0 / hp>maxHp / maxHp<=0` |
| `validEchoActor` 深验证：有限数 / 不注入技能 | **PASS** | `RunCheckpoint.ts` 全数值字段 `Number.isFinite` + 非负 + 上限；`actorId===1`、`weaponKey==='pulse'`、`weapons.length===1` 且 pulse level1/ammo-1/reloading false、`upgrades/abilities` 空。probe 27/27：NaN/Infinity/负值/错误 actorId/额外武器/非 pulse/免费 upgrades/abilities 全部拒绝 |
| 正常升级 / 基础 stats 能恢复不误拒 | **PASS** | probe 用 **core 真实 `registerEcho`** 构造：合法基础帧、damaged `hp=42`+运行计时器、以及同帧内**玩家**合法升级（level7 / scatter lvl3 / `power` lvl2 / ability）→ `validateCheckpoint` 全 true；旧档无 echo 仍合法；`cloneCheckpoint` 往返合法 |

**残余（非阻断，但须记录，见 §7）**：`ECHO_STAT_BOUNDS` 是**绝对上限而非基础值锁定**。probe 实测 `damage=99`(基础1)、`hpRegen=50`(基础0)、`cooldownReduced=1`(基础0)、`critDamage=99`(基础1.5)、`pierceCount=10`、`speed=1000`(基础220)、`armor=1000`(基础0)、`pickupRange=1000`、`xpGain=100`、以及 **`maxHp=10000 / hp=10000`(基础100)** 全部被接受。开发者报告「在 base-only 边界内 / 拒绝篡改 speed/armor」表述不准确（其单测只用了 `speed=999999`、`armor=5000` 这类越绝对值的值）。这是**篡改本地存档注入数值**的路径，不是 restore 回血；上轮我提的「echo 校验未深度校验」已由结构/有限数部分补上，但数值未钉到基础值。建议 P3-b 前把上限改为「基础值 ± 合理升级区间」或直接逐字段等于 `basePlayerData()` 基础值 + 明确允许的升级项。

## 4. 附带修复 — frames 根 junction

- `worldHeadlessMcpTools.ts` 新增 `isSafeFramesRoot(root)`（`lstat` 必须是普通目录且非符号链接），`resolveFrameFile` 在 `lexical/realpath` 与 size 检查**之前**先拒绝根本身为 junction；`restoreFile`/`replayFile` 共用该路径。
- 独立 probe 把**真实 `FRAME_DIR`** 换成指向外部目录的 junction（Windows `lstat` 报 `isDir:false,isLink:true`），`restoreFile` → `E_PERMISSION`，且控制组普通根 `restoreFile` 成功；随后清理恢复普通根。9/9 PASS。`c3cOwnerFile.test.ts` 7/7（含新根 junction 用例）。

## 5. 纯 companionFacet（不算 LLM）

- `src/ai-native/companionFacet.ts` 仅 `echo_observe / echo_suggest / echo_status` + 有界 memory（16 条 / TTL600 / 未确认≤8 / dedup 512 硬界），**无 confirm / owner / stepPlayer / Dev**，`setLink('fallback') → NO_MODEL` 不自动接管。
- 全仓 `src/scripts/tests` **零接线**（`NO_WIRING`），MCP 工具面无 `echo_observe/suggest/status`（`NO_MCP_TOOLS`）；`World`/`GameScene`/`MCP`/`UI` 均未 import。
- 因此它是纯 WIP 模块，**不是 LLM、不是外部 Agent、不产生任何权威**，不能作为 P3-b 完成度。开发者 `REPORT.md` 与 `p3b/A-companion.md` 对此明确「未 wire、不冒充 LLM」，边界诚实。

## 6. 门禁（逐行见 `GATES.md`）

| 门 | 结果 |
|---|---|
| typecheck / 定向 unit 8 文件 | PASS / **55/55** |
| `game:mcp:build` / `npm run build` / MCP 工具面静态 | PASS |
| frames 根 junction / actor facade / echoView / checkpoint 四个独立 probe | PASS（9/9、20/20、10/10、27/27） |
| 静态边界（facade / echo-hit / reset 调用点 / companionFacet 接线） | PASS |
| P3-a legacy+restore E2E **3 例** | **3/3 PASS** |
| 渲染 parity 导出 spec + Node 跨端字节 parity **一次** | **1/1 + P3A_ECHO_RENDERED_PARITY_PASS** |
| 最小回归：C2 无 echo node parity / 控制台 3 路 | `checks=8` PASS / `WORLD_CONSOLE_SMOKE_PASS` |

完整日志 `reports/ai-native-02/reviewer/p3a-fixes/`：`GATES.md`、`gate-*.log`、`probe-*.mts`、`pw-out-p3a-fixes*`。开发服务器为自有端口 **5409**（strictPort，用完即停），未占用 5173/他人端口。

## 7. 残余与范围限制（诚实，不掩盖）

1. **`validEchoActor` 数值上限过宽**（§3）：绝对 cap 非基础值锁定，`damage=99`、`hpRegen=50`、`cooldownReduced=1`、`maxHp=10000/hp=10000` 等均通过；开发者「base-only 边界」表述不准确。**不推翻本轮三缺口关闭**（结构/技能注入、有限数、正常升级不误拒均达标），但属真实未闭合项，建议 P3-b 前修。
2. **legacy FSM 跨端严格字节 parity 未承诺**：本轮未迁移 legacy 敌人 FSM 到 fixed-tick core；parity 的 hunter 静态、无 AI 决策回放。该边界在 spec/脚本/开发者报告三处明写，诚实；legacy 真选/真伤仅由渲染 E2E 证明，不是 Headless 字节 parity。
3. **parity 覆盖范围**：canonical state/events 逐字节；不含 `echoView()` 跨端字节比较、不含 `EchoController` 决策 parity（脚本化 `echoIntentOverride` 绕开）、seed 未固定（一次性对比）。
4. **Boss phase2/3 未运行断言**：E2E 只跑 phase1 近战；phase2/3 由静态代码（`fireLaser(combat.target)` + core 敌方弹道命中 echo）保证，未单独实测。
5. **dev 诊断面**：`echoIntentOverride` 是 `World.stepFrame` 公开第三参，仅 dev/test（`__LAST_SIGNAL_DEV_TEST__`）可达；Player/Dev MCP 与正常 `GameScene` 均不传，外部 Agent 无法借此驱动 echo。
6. **开发者报告外部引用**：`tester/p3a-final/P3A-FINAL-ACCEPTANCE.md` 不在冻结提交，未作为证据。
7. P3-a 的 ECHO 是**本地确定性策略**，不是 LLM；渲染 E2E ≠ Headless World；开发者自测已由本轮独立复跑，但仍是 fixture/dev facade 驱动，不等于真实模型完整 Run/Signal 遭遇。

## 8. 结论：P3-a 是否放行 / P3-b 前置

- **P3-a 放行**：上轮三缺口全部关闭（legacy nearest actor + facade 合法伤害 / 共享 echoView + 诚实范围的跨端字节 parity / restore 授权复位 + 深验证 + 独立 HP）；附带 frames 根 junction 也关闭。最小回归（C2 无 echo、控制台 3 路、typecheck、定向 unit、MCP/prod build）全绿。带 §7 的 1 个数值残余与 6 条范围限制，未以「条件通过」掩盖。
- **P3-b 前置（仍未满足）**：
  1. 修 §7-1 的 `validEchoActor` 数值上限（钉基础值或明确升级白名单），否则 LLM 权威接入后篡改存档可注入 ECHO 战力/HP；
  2. LLM Companion / Signal / energy **明确未实现**，`companionFacet.ts` 纯模块未 wire 到 gateway/UI/MCP/Owner confirm，不构成 LLM；
  3. 真实模型逐轮建议/确认仍需经正式工具由 Lead 执行（本轮 Owner 确认是游戏内 UI / dev fixture），本地确定性策略不得冒充外部 Agent；
  4. legacy FSM 若要求跨端严格字节 parity，需另行迁移到 fixed-tick core 并补非静态 hunter 的 parity 驱动；
  5. P3-b 的 wire 级 v1/v2 协商、Owner confirm 入口、AI/External 主角模式只读、断线 `NO_MODEL` 不假连接、五视口 label 仍不得显示假 external connected。

未修改生产源码/已有测试/配置/分支；未合并/重置；未读取/恢复共享 WIP/stash。
