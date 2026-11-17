# GAMEPLAY-01 · P1 (DEMO 01 · LINKED SENTRY) 验收测试报告（tester）

> 阶段口径：**P1 候选阶段的 ENGINEERING 证据**（本阶段必要条件均已跑通并给出日志），
> 但 **不是**整工程 PASS：P2/P3–P5、真实模型在游戏内的链路、人类试玩均未完成 →
> `HUMAN ACCEPTANCE PENDING`。所有“Agent”输入均为自动化真实鼠标/键盘，不是真人。

## 0. 冻结快照（本报告全部数字只属于这份树）

| 项 | 值 |
|---|---|
| 隔离树（绝对路径） | `D:\tmp\ls-p1-accept`（独立 `git clone`，自装 `npm ci`，node v24.20.0 / npm 11.19.0） |
| 基底 commit | `c7e03c5d0377fbdc09cae8e5fb69fc10f006754d` |
| P1 源 | 按 `reports/gameplay-01/developer/p1/final/manifest.json` 白名单逐文件拷贝，**12/12 SHA256 全部一致**（= 400a73e 的 12 个源文件内容，基底仍是 c7e03c5；未 pull P2） |
| 测试快照 | 2 个已审 P0 修复文件 + 本任务新 spec，见 §7 哈希 |
| 隔离确认 | 真实 `node_modules` 目录（无 junction/symlink）、无共享 worktree、dev server 只服务本树；共享树 P2 改动无法通过 HMR/链接影响本树。证据只写入共享 `reports/gameplay-01/tester/**` |

## 1. 门禁（同一棵 P1 树，完整日志见 §8）

| # | 命令 | 结果 | 绝对日志 |
|---|---|---|---|
| 1 | `npm run typecheck` | **PASS**（0 error） | `D:\Project\LAST_SIGNAL\reports\gameplay-01\tester\logs\p1-gate-1-typecheck.log` |
| 2 | `npm test`（纯单测） | **PASS 755/755（65 files）** | `…\logs\p1-gate-2-npm-test.log` |
| 3 | `npm run test:mcp-surface`（含 `game:mcp:build`） | **PASS 1/1** | `…\logs\p1-gate-3-mcp-surface.log` |
| 4 | `npm run build` | **PASS**（exit 0） | `…\logs\p1-gate-4-build.log` |
| 5 | `PORT=5480 npx playwright test --workers=1` | **FAIL 117 passed / 4 failed / 4 did not run（125）** | `…\logs\p1-gate-5-playwright-full.log` |
| 6a | Parity 真实导出 `tests/signal-rendered-parity.spec.ts` | **PASS**，产物 mtime 22:22 > 本轮 E2E 起点（21:54） | `…\logs\p1-gate-6a-parity-export.log` |
| 6b | `npm run test:parity`（导出之后） | **PASS 3/3** | `…\logs\p1-gate-6-parity.log` |
| 7 | 新 E2E `tests/gameplay-01.spec.ts`（单独跑） | **PASS 7/7（1.4m）** | `…\logs\p1-spec-final.log` |

计数分组与历史不同，按本树实际报：755（纯单测，含 14 条新 P1 源规则测试）+ 1（mcp-surface）+ 3（parity）= 759 条单测/集成；Playwright 侧 125 条（含 7 条新 P1 E2E）。**没有沿用旧 745/118。**

### 1.1 全量 Playwright 的 4 个失败（逐条分类，均保留日志）

| 失败 | 复现情况 | 分类 | 日志 |
|---|---|---|---|
| `ai-native-world.spec.ts` HUD 五视口 ×2（1920、1280）：`AI running at this viewport` 期望 `AI` 实得 `PAUSED` | 隔离跑该 spec **5/5 PASS** | 负载/时序 flake（非 P1 回归） | `…\logs\p1-iso-hud.log` |
| `gameplay-01.spec.ts` test 3（route B）：`room cleared by real play` false | 隔离跑 **PASS**（10.9s） | 负载/时序 flake（我的驾驶循环在重负载下清房变慢） | `…\logs\p1-iso-routeb.log` |
| `vs01.spec.ts` route B：先 `2.7 > 2.6`，后 `10.6 vs 10.5` | P1 树 3 次中 2 次红；**基底 c7e03c5（无 P1 源）3 次中 1 次红，同一 10.6 vs 10.5** | **既有 flake，非 P1 引入** | `…\logs\p1-iso-vs01*.log`、`…\logs\base-vs01-1..3.log` |
| `4 did not run` | Playwright 汇总行（未执行），**不计入通过** | 按未验证处理 | 同上 |

## 2. 新 E2E：`tests/gameplay-01.spec.ts`（7 条，逐一说明“证明了什么”）

入口一律是**真实主菜单按钮** `DEMO 01 · LINKED SENTRY`（Agent 真实点击，非场景直启）。

| # | 断言/测量 | 实测结果（证据：`evidence/p1-acceptance.json`） |
|---|---|---|
| 1 | 真实 T 扫 → 证据与冷却；真实 Y 干扰 → JAMMED + 成本；JAMMED 时 linked fire 关闭、无 route；过期后回 ACTIVE 且 route A 恢复 | scanΔ=9（含回能；成本 10）、jamΔ=22（成本 25）、relay `ACTIVE→JAMMED→ACTIVE`、`routeTarget` `null→1`、linkedFire `true→false→true`、jamRemaining 332→0 |
| 2 | **路线 A：真实战斗清房 + 真实行走 + F 进入**（无瞬移/无救命/无清敌） | 策略=jam-first（起手格就在 JAM_RANGE 内，玩家可达）；fight `cleared:true`（shots=3, hp 100），随后真实按键走到门 → F → 房间 `0→1`（routes[0]），全程 6.2s |
| 3 | **路线 B：真实 R 关闭 relay（人类控制，不是 jam）→ 另一条 authored route** | manual `false`，routeTarget=2，portal target=2，真实行走 + F → 房间 `0→2`（routes[1]） |
| 4 | **站门自然 Y 被射程拒绝** + **fixture jam 后门不可穿** | 门到 relay 实测 **6.403 > JAM_RANGE 6**；自然按 Y：relay 仍 ACTIVE、能量 100→100（**未扣费**）；fixture（`setPlayerPositionForTest(relay)` 再真实按 Y）→ JAMMED、portal 为 null、再真实走到门按 F → **房间不变** |
| 5 | **真实存档 → 页面 reload → CONTINUE** | reload + 真实点击 CONTINUE 后：同房间、manual=false、routeTarget 保持 2、authored scenario 重新挂载 |
| 6 | 3 个 seed（20261117 / 4242 / 7） | 每个 seed 要么 authored 场景成立、要么给出显式 `p1ScenarioError`（**不会静默降级**）；记录每 seed 的 routes/drones |
| 7 | HUD + 菜单在 1920/1366/1280/1024/800（1600 额外可选，本轮取前五） | 全部视口：HUD 字号 ≥10 CSS px、无越界、无意外重叠；暂停页文字字号同样达标；暂停根页 ESC 正常恢复；objective 文案存在 |

### 2.1 明确“没有证明什么”

- **纯战斗（不 jam / 不关 relay）清房**：在 linked sentry 持续开火下可能阵亡；本轮没有把它当 PASS 条件（Lead 明确禁止以 solo 必败作验收），也**没有**用清敌/瞬移把它变绿。战斗数据只作输入/结果记录。
- **路线判定用的是 Jam / R 两种**玩家合法操作，不是“先杀光再击杀等价”的假验收。
- `evidence/p1-acceptance.json` 里 fixture 字段逐条标注（如 test 4 的 `setPlayerPositionForTest(relay)`、autoOwner 未使用）。

## 3. Headless 边界（如实列未覆盖）

- 本轮已验证的 headless/规则面：`npm test` 中的 P1 源规则测试（`src/signal/relayRoutes.test.ts`、`src/world/sim/signalLink.test.ts`，14 条新增）通过；`npm run game:sim:parity`、`worldMcpSmoke`、`worldHeadlessMcpSmoke`、`c3c` node parity、`c3b-f03` 在 P0 报告里已跑（不同树，不混用）。
- **未覆盖**：DEMO 01 的 authored route/portal/relay 门控在 HeadlessWorld 中的等价性由 **Rendered-only** 路径实现（`updateP1RoutePortal` 在 World 适配层），本轮**没有** headless route 对等测试；旧的 signal parity 产物不能拿来证明新关卡等价。这是 P1 之后的明确缺口。

## 4. 真实模型（连接状态更新，不冒充）

- 按 Lead 更新：Magpie 本地 API（`127.0.0.1:3425/v1`，路线 `group/elisa`）**连接可用**，Lead 已做安全探测；历史 P0 的 `BLOCKED` 保留为当时事实。
- **游戏内真实模型链路本轮未验证**（P1 不涉及）：本报告里的 “Local AI / ECHO” 一律是 deterministic 控制器或 autoOwner 夹具，**不是真实 LLM**，也不代表 ECHO 优于人类。

## 5. 与 P0 的边界

- P0 基线（`D:\tmp\ls-p0-ci` @ 7aa8b51）**未被改动**，其报告 `reports/gameplay-01/tester/BASELINE_REPORT.md` 保持原样。
- 本树已纳入两个已审 P0 测试修复（sha 见 §7），因此不再重复已知的 P3-a 红与 UI 目录崩溃。

## 6. 证据与产物

- 指标 JSON：`reports/gameplay-01/tester/evidence/p1-acceptance.json`
- 截图：`reports/gameplay-01/tester/shots/p1-*.png`（6 张：1-jammed、1-relay-expired、2-route-a、3-route-b、4-door-range-reject、5-continue；test 6/7 以 JSON 指标为准）
- 日志：`reports/gameplay-01/tester/logs/p1-*`（门禁、隔离复跑、失败原件全部保留）
- Playwright 自产报告：`D:\tmp\ls-p1-accept\test-results\`（隔离树内）

## 7. 哈希

P1 源（12/12 与 manifest 一致，逐条见 `manifest.json`）：
```
371fca31… GameScene.ts        964b655c… MainMenuScene.ts
4c5e51b3… signal/relay.ts     244f1082… systems/RunCheckpoint.ts
a36a4c2e… types/index.ts      90295aaa… world/World.ts
2afcb1d0… sim/core.ts         3b905c70… sim/rules.ts
ac71e51c… sim/signalState.ts  1b87c1e3… config/p1Scenario.ts
3dab67b6… relayRoutes.test.ts d2c8daad… signalLink.test.ts
```
测试（本树实际字节）：
```
8dde19a7153c72b3ed58e8663bc70829a57f153c782aec9e48735aecb07e49f7  tests/gameplay-01.spec.ts   (新增，7 条)
23f4961dd0cf076ed92bff6b4730e84c4a9e45fa54687a638925ffbd7c7c2d8e  tests/ai-native-world.spec.ts (已审 P0 修复)
8aa12c9eda2840c8d696afba114288566dbb18f1d4a2c291398efe0e7b549c20  tests/ui-menu-layout.spec.ts (已审 P0 修复)
```

## 8. 一行一条（复核用）

- `npm run typecheck` → PASS(0) → `D:\Project\LAST_SIGNAL\reports\gameplay-01\tester\logs\p1-gate-1-typecheck.log`
- `npm test` → PASS 755/755 → `…\logs\p1-gate-2-npm-test.log`
- `npm run test:mcp-surface` → PASS 1/1 → `…\logs\p1-gate-3-mcp-surface.log`
- `npm run build` → PASS(0) → `…\logs\p1-gate-4-build.log`
- `PORT=5480 npx playwright test --workers=1` → FAIL 117/121 执行（4 failed / 4 did not run，125 总数）→ `…\logs\p1-gate-5-playwright-full.log`
- `npx playwright test tests/gameplay-01.spec.ts` → PASS 7/7 → `…\logs\p1-spec-final.log`
- `tests/signal-rendered-parity.spec.ts`（真实导出）→ PASS → `…\logs\p1-gate-6a-parity-export.log`
- `npm run test:parity` → PASS 3/3 → `…\logs\p1-gate-6-parity.log`
- 隔离复跑：HUD 视口 → PASS 5/5（`…\p1-iso-hud.log`）；route B → PASS（`…\p1-iso-routeb.log`）；vs01 route B → 2 红/3（`…\p1-iso-vs01*.log`），基底树同样 1 红/3（`…\base-vs01-1..3.log`）→ 既有 flake。

## 9. 结论

- **P1 阶段（DEMO 01 · Linked Sentry）：ENGINEERING PASS（本阶段必要条件全部通过并留证）**。
- 全量 Playwright **4 红已分类**：3 条可在隔离复跑转绿（负载），1 条在无 P1 的基底树上同样复现（既有 flake）；**未 skip、未放宽断言/超时**。
- 未完成：Headless route 等价（Rendered-only）、P2/P3–P5、游戏内真实模型链、人类试玩 → `HUMAN ACCEPTANCE PENDING`。
- 未 commit / 未 push；源 hash 与 12 项冻结一致，未改 src。

---

## 10. 返修（reviewer P1_TEST_REVIEW 的 2 必改 + 2 标注）

新测试快照：`tests/gameplay-01.spec.ts` sha256 = `e1c01a959314d0967e4fd14624fcc906ded2dac89ac3fde0d6f56238cdad027b`（旧 `8dde19a7…` 已被本版取代；P1 源与两个 P0 修复文件 hash 未动）。
新证据目录：`reports/gameplay-01/tester/p1-v2/`（`evidence/`、`shots/`），日志前缀 `p1-v2-*`。**历史 `p1-gate-*` / `p1-spec-final*` / `p1-iso-*` 全部保留未覆盖。**

### 10.1 改动（仅本 spec）

1. **移除 `mode: 'serial'`**：7 条测试各自 `bootDemo` 走真实菜单、无跨 test 状态；默认顺序 + `--workers=1` 仍顺序执行，一次失败不再连带丢弃后续 4 条。每 test 预算仍 `240000 ms`，断言/阈值/超时一律未放宽。
2. **seed 正向要求**（manifest 20261117/18/19）：逐 seed 断言 `p1Scenario` 存在、`p1ScenarioError === null`、恰有两条 route、两条 route 目标互异且**都不是 boss/extraction**、authored 房间为 combat，并要求三 seed 的真实布局（route 对或哨兵位）至少两种不同；**“报错但给了提示”不再算通过**。旧的 4242 / 7 记录保留为先前观察，本轮未造自然反例，因此错误分支记为“未覆盖”。
3. **Scan/Jam 精确扣费**：只读包装**现有** `world.stepFrame`（不额外 step、不改输入、不改行为）捕获提交事件，取提交批次内最后一个带 `energy` 的事件（无则取该批 pre-tick 能量）作为“前值”，断言 `signal-scanned.energy === before - 10`、`signal-jammed.energy === before - 25`，并断言 `actorId === 0`（player）与 `ok !== false`；regen 事件单独计数。net 值仅作观测保留。
4. **驾驶者标注**：`fightUntilCleared` 明确为 **non-blind**——方向/瞄准读 canonical state（`world.enemies`、`_data.hp`、world→screen 投影），移动/开火是真实键鼠事件、不写状态；因此**不是人类盲测**，也**不是合法 Player 模型链**（模型侧合法观察另有 dcd1955 证据，不混用）。
5. 驾驶节奏调整只改按键/开火**保持时长**（approach 300ms、fire 360ms、开火距离阈值按真实攻击范围 5 格取 4.5），未改任何通关/伤害/几何断言阈值。

### 10.2 本轮结果（新快照）

- `PORT=5480 npx playwright test tests/gameplay-01.spec.ts --workers=1` → **PASS 7/7（1.4m）** → `D:\Project\LAST_SIGNAL\reports\gameplay-01\tester\logs\p1-v2-spec-full.log`
- `npm run typecheck`（P1 树，TS 有改动）→ **PASS(0)** → `…\logs\p1-v2-typecheck.log`
- 精确扣费（`p1-v2/evidence/p1-acceptance.json`）：`exactScanCost = 10`、`exactJamCost = 25`，提交批次内 regen 事件数 0（net 100→90→65 仅作观测）。
- seed 正向：20261117 → routes `[1:combat, 2:resource]`；20261118 → `[2:resource, 5:elite]`；20261119 → `[5:elite, 3:combat]`；三者 `p1=true / error=null / drones=2`，**distinctLayouts = 3**。

### 10.3 对上一版报告的两处更正（诚实修正）

1. **“117 passed / 4 failed / 4 did not run” 的 4 条未执行**：不是随机跳过，而是**我自己的 spec 当时用了 serial 模式**——test 3（route B）失败后，同文件 test 4–7 被跳过。现已移除 serial；但那 4 条在新快照里跑绿 **不等于**旧全量补算，两者是不同测试快照，旧日志原样保留。
2. **HUD `PAUSED` 与 route B 的“非回归”表述撤回**：当时只有 isolated 绿，**不能**据此断言源无回归。本轮补了 HUD 的诊断（`…\logs\p1-diag-hud.log`）：采样窗口内 AI 真实升级 → `active=["GameScene","LevelUpScene"]`、`levelUpActive=true`、`level=2 xp=6/74`、`tick=227`、`owner='ai' aiEnabled=true` → 世界被**等级选择遮罩**暂停，`mode` 因此为 `PAUSED`（不是控制权丢失）。结论改为：**负载推测**（AI 在墙钟窗口内升级），修复建议是在该 spec 采样前用既有的 `clearLevelUp()` 关掉升级遮罩（属测试前置，不放宽断言），需 Lead 批准后才改共享 ai-native-world.spec。
   - route B：隔离 3/3 绿（`…\logs\p1-routeb-diag-1..3.log`：每次 `cleared=true`、3 shots、hp 100、约 2.2s），但**无双基线对照**，仍标“isolated 绿，负载推测”。
   - `vs01` route B：P1 树 2/3 红 + **基底 c7e03c5（无 P1 源）1/3 红且同一 `10.6 vs 10.5`** → 可称既有 flake，原断言 `2.6` / `10.5` 未放宽。

### 10.4 本轮门禁一行一条

- `npm run typecheck`（P1 树）→ PASS(0) → `D:\Project\LAST_SIGNAL\reports\gameplay-01\tester\logs\p1-v2-typecheck.log`
- `npx playwright test tests/gameplay-01.spec.ts --workers=1` → PASS 7/7 → `…\logs\p1-v2-spec-full.log`
- 诊断：HUD 暂停原因 → 记录（非 gate）→ `…\logs\p1-diag-hud.log`
- 诊断：route B 隔离 3 次 → PASS 3/3 → `…\logs\p1-routeb-diag-1..3.log`

### 10.5 仍未关闭（不冒充全量绿）

- 本轮**没有**重跑 125 条全量（按订单只跑新 7 条 + 定向诊断）；因此整体 P1 回归**仍非绿**，`117/4/4` 的历史结论与失败全部保留。
- HUD 前置与 route B 的负载假设未做双基线对照（vs01 才做过）。
- 纯战斗（不 jam / 不关 relay）清房可能阵亡，未作 PASS 条件、也未用清敌/瞬移替代。
- Headless route 等价仍未覆盖（Rendered-only）；真人试玩无 → `HUMAN ACCEPTANCE PENDING`；游戏内真实模型链未验。
