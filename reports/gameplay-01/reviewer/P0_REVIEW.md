# GAMEPLAY-01 · P0 独立基线审查（Reviewer · 只读）

**结论：P0 审计完成；工程验收未完成（CI 仍红、P0 未跑完整测试）；HUMAN ACCEPTANCE PENDING。** 基线可用于开发，但「绿」的定义必须先修正——`main` 的 CI 目前是红的，且红的原因是**测试非密闭（依赖本地未提交产物 + 缺构建步骤）**，不是产品缺陷。最终 `ENGINEERING PASS` 必须在 CI 密闭、全部指标通过后才允许写；本报告不预先给出。

- 仓库：`D:/Project/LAST_SIGNAL`，分支 `feat/gameplay-01-ai-cooperation`，HEAD = `main` = `origin/main` = **`7aa8b51`**（`Merge UI-REWORK-01 menu layout rework into main`），tracked 工作树干净（未跟踪的旧证据/`Start-LAST-SIGNAL.cmd`/`developer/` 原样保留）。
- 我全程只读 src/tests/CI，未改任何源码/测试/工作流；证据只写 `reports/gameplay-01/reviewer/`；未 push / 未 commit / 未清理。

---

## 1. 「main 是否真的包含能力」核验（不是把 slice 当正式 World）

`7aa8b51` 树内含（`git ls-tree`，受版本控制）：197 个 `src/` 文件、39 个 `tests/` 文件，关键面：

| 面 | 位置（受控） | 判定 |
|---|---|---|
| 共享权威核心 | `src/world/sim/core.ts`（1400 行，`createSimulationState/stepSimulationTicks/SimCommand/SimEvent`）、`sim/rules.ts`（541 行纯规则）、`sim/signalState.ts` | **代码已实装** |
| Rendered 适配层 | `src/world/World.ts`（2109 行）+ `WorldRenderer`、`src/scenes/*` | **代码已实装**（适配层，非第二套权威） |
| Headless | `src/ai-native/worldHeadless.ts`、`headlessCli.ts`、`worldHeadlessMcpServer.ts` | **代码已实装** |
| Signal | `src/signal/{signalCore,relay,signalTuning}.ts` + `sim/signalState.ts` | **代码已实装**（scan/jam/relay/toggle/energy/cooldown） |
| ECHO | `src/ai-native/{echo,echoView,echoController*}.ts`、`sim/core.ts` 的 `SimEchoState` | **代码已实装**（独立 actor、自有 HP/感知） |
| Companion / Owner | `companionFacet/Gateway/Link/ownerAuth/ownerPairing` + `worldBridgeServer` | **代码已实装**（cap 私有、无 confirm 工具） |
| 本地 AI（demo 控制器） | `src/ai-native/control.ts`、`world.sim` 的 `PlayerIntent` 路径 | **代码已实装**（明确标注 LOCAL DETERMINISTIC DEMO） |
| UI 重构 | `src/ui/menuKit.ts`、`src/scenes/PauseScene.ts`、`tests/{ui-menu-layout.spec.ts,uiNav.ts}` | **已合入 main**（`eb83eb4`+`4ff3725`+`213341b`） |
| StationZero / VS-00 | `src/slice/*`（`rules.ts` 头注释：`VS-00 minimal causal model: Scan -> Jam -> Door`，纯 TS 无 Phaser，自带 room/corridor） | **隔离原型**，**不是**正式 World；不得把 `SliceScene`/corridor 演示当作正式玩法证据 |
| 低风险自主 | 全仓 `grep autonomy|autoConfirm|lowRisk` = **0 命中** | **不存在**（仅接口/设计层面都没有）；任何“已能自主”的表述都不成立 |

**单权威约束**（可执行证据，非口头）：`src/world/sim/rewiring.test.ts` 断言 `World.ts` 必须含 `createSimulationState/stepSimulationTicks/stepFrame/applySimEvents/syncCoreEntities/resetSimulationAccumulator/MAX_TICKS_PER_FRAME`、且**不得**含 `this.player.update(dt)`、不得含 `spawnProjectile(ownerId`；`GameScene` 必须 `sampleIntent()` + `world.stepFrame(delta, intent)`（`GameScene.ts:488-489`）。

---

## 2. 最新 CI 失败：根因（独立复核，含干净树复现）

失败 run：`gh run 44144683104`（`main` push，2m36s，failure）；我抓了失败日志：`reports/gameplay-01/reviewer/logs/ci-44144683104-failed.log`（731 行）。**失败发生在「单元测试」步骤，E2E 根本没跑到**：`Test Files 2 failed | 63 passed (65)`、`Tests 4 failed | 741 passed (745)`。

四项失败归为**两类非密闭依赖**：

1. **依赖被 gitignore 的构建产物**：`src/ai-native/companionSurface.test.ts:12`
   `expect(existsSync(resolve('dist-mcp/companionMcpServer.mjs')), 'npm run game:mcp:build must run first')` → CI 的 `.github/workflows/ci.yml` **没有 `npm run game:mcp:build` 步骤**，而 `.gitignore:6` 忽略 `dist-mcp/`。测试自己在消息里写了“必须先构建”，工作流却没做。
2. **依赖 E2E 生成、从未提交的证据文件**：`src/ai-native/signalRenderedHeadlessParity.test.ts`
   - `FAILS when parity product files are missing` → `expected 3 to be 0`（CI 三个文件都不存在，计数就是 3）
   - 另两条 → `ENOENT … reports/ai-native-02/signal/parity/{initial,sequence}.json`
   - 这三个 JSON 由 **`tests/signal-rendered-parity.spec.ts`（Playwright）** 写（该 spec `:135-137` `writeFileSync`），而 CI 顺序是 **`npm test` 先于 Playwright** → **逻辑上永远不可能满足**；`git ls-files` 对该目录 = 空（未跟踪、也未被 ignore），所以唯一来源就是本机跑过 E2E 的残留。

**干净树复现（我的独立实验）**：`git archive 7aa8b51 | tar -x -C D:/tmp/ci-sim`（无 `dist-mcp`、无 `reports/`），`node_modules` 走 junction，然后只跑这两个文件：

- 干净树：**FAIL 4/4**，错误行与 CI 逐条一致（`npm run game:mcp:build must run first` / `expected 3 to be 0` / 两条 `ENOENT … initial.json|sequence.json`）→ `reports/gameplay-01/reviewer/logs/cleansim-two-unit-files.log`
- 本机工作区：**PASS 4/4** → `reports/gameplay-01/reviewer/logs/local-two-unit-files.log`

→ 结论：**「本机 745/745」是残留产物带来的绿，不是干净环境可复现的绿。** 任何 GAMEPLAY-01 的“全绿”声明都必须标注环境（是否为干净 clone / 是否跑过 E2E / `dist-mcp` 是否已构建）。

**还有一层潜在红（CI 修掉上面两项后才会暴露）**：E2E 侧有 **7 个 spec** 直接 spawn `dist-mcp/{companionMcpServer,worldMcpServer}.mjs`（`c3b-hard-disconnect`、`companion-room-cancel`、`companion-room-race`、`p3b-companion-owner`、`signal-coop-e2e`、`signal-sdk-negative`、`ui-menu-layout`）。CI 从未构建 `dist-mcp` → 这些 spec 在干净 CI 里必然失败。**因此 CI 需要两个独立修复：先建 MCP bundle，再解决 parity 产物的产生顺序/提交策略。**

**我不建议的“修法”**：把 `dist-mcp` 提交进库、或把 parity 断言改成 `if (missing) it.skip`、或放宽 `missing===0`。这会直接毁掉这两条门禁的意义（它们本来就是“缺产物必须红”的硬门）。

**建议的最小修复（供 Lead 决策，P0 不改）**
- (a) CI 增加 `npm run game:mcp:build`（在 `npm test` 之前），并把 `dist-mcp` 纳入 cache 或每次构建；
- (b) 把 `signalRenderedHeadlessParity` 从 `npm test` 拆成**独立 gate**（在 Playwright 产生 `reports/ai-native-02/signal/parity/*` 之后运行，例如 `npm run test:parity`），CI 里排在 E2E 之后；或改为**无浏览器生成**导出（headless export script）后作为单测前置；
- (c) 等价的“本地可复现的干净 gate”应成为 GAMEPLAY-01 每个阶段的必跑项（见 §6 证据要求）。

---

## 3. 权限 / 安全边界审计

| 边界 | 实现位置 | 现状 | 风险/缺口 |
|---|---|---|---|
| Owner 能力不可被 Agent 触碰 | `companionLink` 把 `ownerCap` 放在 **ESM `#private`**；`companionSurface.test.ts` 断言 agent bundle 只含 `echo_observe/suggest/status/memory`、**不含** `echo_confirm/echo_reject/companion-decision` | **强制**（且有门禁） | 该门禁本身依赖 `dist-mcp`（见 §2），CI 里实际未执行 → 在 CI 绿之前，这条安全断言**没有在 CI 生效** |
| 确认必须人类 | 暂停 UI 的 CONFIRM/REJECT → `CompanionLink.decide()` → 渲染侧 `enqueueCompanionAction` → 下一 core tick 提交 | **强制**（e2e 有真实 pending + confirm + `hasPendingCompanionIntent` 断言） | 但“点击 CONFIRM 的人”在自动测试里是 Playwright —— 属**测试夹具**，不是人类验收（见 §7） |
| 原子换 cap / 旧建议失效 | `companionGateway.authorize(reauthorize)`：`facet.reauthorize()`（`cancelUnconfirmed()` + `lastObservation=null`）+ 清 `observation/decisions/requests`；session/epoch **不变** | **强制**；`ownerAuth.test.ts` C3/C4 覆盖 | 旧 agent 会话仍有效（只被清 observation），报告措辞不得写成“安全撤销”（我在 UI-REWORK 已纠过一次） |
| room / generation 失效 | `companionFacet.generation` 仅在**已提交的换房**时 bump；旧 generation 的 decision 被拒；`CompanionLink.#inCurrentRoom` 过滤 | **强制** | 无缺口（有 `companionRoomGeneration/RoomBoundary/RoomCancel` 单测） |
| 内存 TTL / 上限 | `COMPANION_LIMITS.MEMORY_TTL_TICKS`（`:484` cutoff）+ `MEMORY_ENTRIES` 上限 | **强制** | 无缺口 |
| 暂停只入队、真实 tick 提交 | `GameScene.onResume()` 只重置累加器、不 flush；`pendingCompanionReceipt` 记 generation/roomId | **强制** | 无缺口（`resume-no-step` + `tester` e2e） |
| 外部 Agent 不能驱动 ECHO | `setOwnerMode('external')` → companion `READ_ONLY`；ECHO 只由 core 的 `echo` 规则/assist 状态驱动 | **强制** | 建议 P2 增加一条 e2e 负向断言（external owner 时 echo 不响应 agent 的 suggest） |
| 低风险自主（无需 Owner 确认） | — | **不存在** | ⚠️ 未来 P2/P3 若要做，必须新建**显式 allowlist + 预算 + 审计日志**；当前任何“自主协作”宣称都是假的 |
| Dev 态对 Player 不可见 | `__game` 只在 `__LAST_SIGNAL_DEV_TEST__`（dev/test 构建）挂载（`src/main.ts:41` + `vite.config.ts:11`）；Headless dev 命令需 `--dev` | **强制**（生产构建剥离） | P1 需补一条“Player MCP 的 observation 不含 dev-only 字段”的断言（现有 `worldHeadlessSignal.test.ts` 只证明 dev 命令存在且计费） |

---

## 4. 玩法一致性（Reality Engineering 六步）现状

| 步骤 | 当前是否可玩到 | 证据/缺口 |
|---|---|---|
| 观察 | 部分 | Signal 有 scan 揭示、ECHO 有 12 格感知；HUD 展示 echo/relay/energy。但**因果标签薄**：玩家看到“RELAY OFF / device”但不容易看到“为什么这次 scan 成功、那次失败” |
| 假设 | **弱** | 没有“假设/预期”的显式玩法载体（无 pending hypothesis、无预期对照）。这是 P1/P3 的**核心新增**，不能靠文档宣称 |
| 实验 | 部分 | 有 cost/cooldown/TTL 的真实后果（`signalState`/`companionFacet`），玩家可重复施放对比；但缺少“同一 seed 下 A/B 对照”的玩家可见机制 |
| 理解 | 弱 | 效果可观测（route/damage/energy/HP），但**归因**依赖 HUD 文本；没有“因为 X，所以 Y”的游戏内回执（companion 有 receipt，但那是 Owner 面，不是玩家面） |
| 操纵 | 部分 | relay/jam/scan/toggle 是真杠杆；但“杠杆影响路线”目前只在 signal 门控房间体现 |
| 结果 | 部分 | 影响跑团（通行/伤害/资源）；但缺少“两条合法路线（Human Only / Human+ECHO）各自可完成、且可测差异”的**对比证据**（不要求独狼失败） |

→ **当前最多算“具备可用的因果零件”，还不是 Reality Engineering 体验**；P1–P4 的价值就在于把它变成玩家能自己观察-假设-验证的闭环，而不是继续加工具/加测试。

---

## 5. P1–P4 最小可验收场景（developer 顺序：Signal → ECHO → UI 反馈 → 关卡）

> 每个阶段都必须：真实核心（`sim/core.ts`）内实现、Rendered 与 Headless 同规则、无第二套 World、Owner 协议零改动、Save/死亡语义零改动、证据用固定 seed 可复现。**夹具（Playwright 点击/自动 Owner/脚本化人类式输入）不计入人类验收；工程 PASS 也必须等全部指标（含 CI 密闭）通过才可写，测试绿本身不等于工程 PASS。**

### P1 · Signal 战斗/路线（最小场景）
- **场景**：单房间 + 1 relay + 1 guard + 1 隐蔽通路。玩家：scan 揭示 relay 链路 → jam 抑制 guard 射击 → toggle relay 开门 → 通过。
- **验收（必须全是玩家视角可观测的）**：
  1. 能量/冷却/TTL **可见且真实扣减**（HUD + 数值日志双证）；
  2. **反事实**：同一 seed、同一输入序列去掉 `jam` → guard 开火造成可测伤害；加上 `jam` → 伤害为 0（这是“真实玩法改善”的判据，不是“新增 API”）；
  3. 失败态诚实：能量不足/超距/无视线时必须明确拒绝，且不是 UI 假绿；
  4. 无 Owner/agent 参与——纯人类单机即可完成。
- **仅工程能力（不算玩法改善）**：新增 MCP 工具、schema 版本、单测数量、Headless 参数。

### P2 · ECHO 合法观察（不是炮台）
- **场景**：ECHO 独立走位 + 12 格锥形感知；敌人在锥外时**绝不**开火；玩家通过 ECHO 的观察得到一条自己看不到的信息（例如锥内敌人/relay），据此决定路线。
- **负向断言（必须）**：锥外敌人存在 60 tick 内 `echoShotsFired === 0`；assist 未确认时 `echo` 不攻击；`external` owner 下 agent 的 suggest 不改变 echo 行为。
- **正向断言**：确认 assist 后 echo 真实开火并造成独立伤害；echo 受伤不影响主角 HP。
- **判据**：ECHO 的**信息价值**必须进入玩家的决策（P3 的 UI 要能证明“玩家因为 echo 的观察改了动作”），否则只是“多了一个自动单位”。

### P3 · UI 反馈（把因果讲清楚）
- **场景**：不打开 dev console，玩家能在一屏内看到：当前可用的 Signal 动作与其成本/冷却、ECHO 的观察范围与最近一次观察、最近一次动作的**因果回执**（做了什么→因为什么→结果如何）。
- **验收**：五个视口（1920/1600/1366/1280/1024/800）无重叠/无越界、最小文本 ≥10 CSS px（沿用 UI-REWORK 的审计器）；**新文案必须来自真实状态**，禁止假 connected/假 pending；键盘可达（↑↓/ENTER）+ 鼠标一致。
- **仅工程能力**：组件重构、`menuKit` 抽象、测试数量。

### P4 · 关卡设计（两条合法路线，不造强制依赖）
- **场景**：同一关卡必须支持 **Human Only** 与 **Human + ECHO** 两条合法通关路线；通过观察与分工体现协作价值，**不制造强制依赖**。
- **验收**：
  1. **Human Only 可完成**：固定 seed 可 3/3 完成，完成条件只依赖玩家自己的观察/操作，不需要 bridge、不需要 ECHO、不需要 agent；
  2. **Human + ECHO 也可完成**：同一 seed 同样可 3/3 完成（不预设 ECHO 一定更优）；
  3. **比较实测价值**：时间、受伤/造成伤害、Energy 消耗、操作次数、建议接受率 等项目，两条路线各取 3 次实测并列数据；任一方向都可能更优，报告只陈述数字，禁止写“协作必然更优”；
  4. **拒绝与离线路径保留**：ECHO 的建议可被拒绝且拒绝后仍能走完 Human+ECHO 路线；无 bridge/ECHO 离线状态下仍能完成 Human Only；
  5. **无强制依赖**：不存在“必须靠 ECHO 才能通过/必须接 bridge 才能通过”的门；`Owner`/`agent` 不参与时不得被隐式要求联机；
  6. 成功路径上有 ≥2 个“玩家自己的假设被验证”的节点（P3 的回执可引用）；差异必须来自玩家可见的因果，不是隐藏数值调整；
  7. 死亡/存档语义不变：死亡=`finishRun` → 新 R0，不恢复 checkpoint；仅退出/刷新恢复最近 checkpoint。

### 「真实 Gameplay 改善」vs「仅工程能力」判定表（建议写进 FINAL_REPORT）
| 可算真实玩法改善 | 只算工程能力 |
|---|---|
| 玩家可观测的新因果 + 反事实（有/无该动作结果不同） | 新增 MCP 工具/协议版本/schema |
| 固定 seed 可复现的路线或结果差异 | 单测/E2E 条数增加 |
| 玩家能在游戏内自己提出并验证假设（无需 dev console） | 重构、抽象、类型收紧 |
| **两条合法路线（Human Only / Human+ECHO）均可完成且有可测差异**（时间/伤害/Energy/操作次数/建议接受） | 关卡增加隐藏门槛或强制依赖 |
| 失败态诚实且可归因 | Headless/Rendered parity 本身（这是前提，不是体验） |

---

## 6. 证据真实性与边界（必须写进后续所有报告）

1. **环境标注**：每条“全绿”必须写：干净 clone 还是本地工作区、是否跑过 E2E（`dist-mcp` 是否构建）、`reports/` 是否有未跟踪产物。当前 `745/745`、`113/118` 等历史数字**都是在含未跟踪产物的本机跑出来的**，不是干净环境结果（§2 已用干净树证伪）。
2. **玩家 vs 夹具**：Playwright 点击、自动 Owner 夹具、脚本化“人类式输入”**全部是测试夹具**，报告必须标注 `fixture`；`真实 LLM 会话` 只能标 `agent (real model)`；**任何人形自动化都不得写成“真人验收”**。
3. **auto-Owner 陷阱**：`ownerAuth.test.ts` 的 C3/C4 与旧 P3b 夹具里的“自动确认”证明的是**协议正确**，不是**人类可用性**；不得用于 HUMAN ACCEPTANCE。
4. **可复现性**：玩法证据必须给 seed + 输入序列 + 前后状态 + 反事实对照；仅截图+文字不算。
5. **结论口径**：本文为 **P0 审计完成 / 工程验收未完成 / HUMAN ACCEPTANCE PENDING**。后续无真人亲玩时，一律 `HUMAN ACCEPTANCE PENDING`；`ENGINEERING PASS` 只有在 CI 密闭 + 全部指标通过后才可写。

---

## 7. 我本轮跑的针对性 gate（一行一条）

| 命令 | 结果 | 日志（绝对路径） |
|---|---|---|
| `cd /d/tmp/ci-sim && npx vitest run src/ai-native/signalRenderedHeadlessParity.test.ts src/ai-native/companionSurface.test.ts`（`7aa8b51` 干净归档树，无 `dist-mcp`/`reports`） | **FAIL**（4 failed） | `D:/Project/LAST_SIGNAL/reports/gameplay-01/reviewer/logs/cleansim-two-unit-files.log` |
| `npx vitest run src/ai-native/signalRenderedHeadlessParity.test.ts src/ai-native/companionSurface.test.ts`（本机工作区） | **PASS**（2 files / 4 tests） | `D:/Project/LAST_SIGNAL/reports/gameplay-01/reviewer/logs/local-two-unit-files.log` |
| `npx vitest run src/world/sim/rewiring.test.ts src/world/sim/core.test.ts src/ai-native/ownerAuth.test.ts src/ai-native/companionRoomGeneration.test.ts` | **PASS**（4 files / 53 tests） | `D:/Project/LAST_SIGNAL/reports/gameplay-01/reviewer/logs/authority-invariants.log` |
| `gh run view 44144683104 --log-failed`（CI 失败日志，只读） | 已落盘（731 行） | `D:/Project/LAST_SIGNAL/reports/gameplay-01/reviewer/logs/ci-44144683104-failed.log` |

未跑全量 vitest / 全量 Playwright（按 P0 约束，避免与 tester 争用）。

---

## 8. 未验证 / 需要 Lead 决策

**未验证**：正式 World 的实际可玩性手感；ECHO 感知锥的实际体感；Signal 三件套的真实数值平衡；Rendered↔Headless 字节 parity 在干净环境（依赖 §2 的产物）；Save/死亡的真实跑团体验；UI 五视口在 GAMEPLAY-01 新内容下的表现（今日审计是 UI-REWORK 基线）。

**建议 Lead 在 P1 之前先定三件事**：
1. **CI 密闭性**先修还是后修？（我建议先修：否则后面每个阶段的“绿”都不可信）
2. 是否允许 P2/P3 **新增显式低风险自主 allowlist**？（当前完全不存在；若不做，就别在体验设计里承诺“自主”）
3. 证据目录与命名规范（`reports/gameplay-01/<role>/`）与“fixture/agent/human”标签是否强制写进验收清单（我建议强制）。

**报告后停手，不轮询。**

---

## 9. 修订记录

- **v2（GAMEPLAY-01 Lead 约束纠正）**：① §5 的 P4 验收从“独狼确定性失败 / 合作确定性成功”改为 **Human Only 与 Human+ECHO 两条合法路线均可完成**，以「时间 / 伤害 / Energy / 操作次数 / 建议接受」的实测对比体现协作价值，**不预设 ECHO 更优、不造强制依赖**；拒绝与离线路径必须保留。② 全文口径从“整体只能 ENGINEERING PASS”改为 **P0 审计完成 / 工程验收未完成 / HUMAN ACCEPTANCE PENDING**，`ENGINEERING PASS` 仍待 CI 密闭与全部指标通过。③ 其余原结论（CI 非密闭根因、能力分类、权限边界、证据标签）不变。
