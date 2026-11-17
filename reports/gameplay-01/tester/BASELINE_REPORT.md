# GAMEPLAY-01 · P0 基线 / 玩法审计报告（tester）

> 本文是**工程基线证据**，不是人类验收。全篇没有真人试玩；所有输入都由 Agent（真实鼠标/键盘事件）或既有 fixture 产生，
> 每条结论都标注 runner / fixtures / 不能证明什么。最终口径见 §9：`ENGINEERING PASS` / `HUMAN ACCEPTANCE PENDING`。

## 0. 冻结与环境（本报告所有数字只属于这个快照）

| 项 | 值 |
|---|---|
| 被测树 | **独立干净克隆** `D:\tmp\ls-p0-ci`（不是共享 `D:/Project/LAST_SIGNAL`） |
| commit | `7aa8b51e37b688144a036a0a8b021efdf0be83bd`（7aa8b51） |
| 干净度 | `git status --porcelain` 只有我自己生成的 `?? reports/ai-native-02/signal/`（parity 产物）；src/tests 零修改 |
| 依赖 | 克隆内自行 `npm ci`（node v24.20.0 / npm 11.19.0），未借用共享树 node_modules |
| 前置产物 | 克隆内自行生成：`npm run game:mcp:build`（19:41）、渲染侧 parity 导出（19:45）；未拷贝共享树任何 dist/parity |
| 隔离结论 | 共享目录之后的 P1/CI 改动（含 c7e03c5）不会影响该克隆；后续复测另开新目录 |
| 证据 | `reports/gameplay-01/tester/{logs,evidence,shots,ui,playtest}`（`LS_SHOT_DIR` / `P0_EVIDENCE_DIR` / `UI_OUT_DIR` 指定） |

## 1. 四项门禁（同一克隆 @7aa8b51）

| 命令 | 结果 | 日志（绝对路径） |
|---|---|---|
| `npm run typecheck` | **PASS**（0 error） | `D:\Project\LAST_SIGNAL\reports\gameplay-01\tester\logs\baseline-1-typecheck-clone.log` |
| `npm run build` | **PASS**（exit 0） | `D:\Project\LAST_SIGNAL\reports\gameplay-01\tester\logs\baseline-2-build-clone.log` |
| `npm test`（**无任何前置**，复现 CI） | **FAIL 739/745**（4 文件 6 红） | `…\logs\ci-repro-1-npm-test-clean.log` |
| `npm test`（仅 `game:mcp:build` 后） | **FAIL 742/745**（1 文件 3 红 = parity） | `…\logs\ci-repro-4-npm-test-after-mcp-build.log` |
| `npm test`（+ 渲染侧 parity 导出后） | **PASS 745/745** | `…\logs\ci-repro-6-npm-test-after-parity.log` |
| `PORT=5460 npx playwright test --workers=1` | **FAIL 117/118**（1 红：P3-a） | `…\logs\baseline-3-playwright-full-clone.log` |

`npm test` 的三种状态是**同一棵树**，只差前置产物；全部日志保留，prepared 状态逐条标明。

### 1.1 CI 依赖缺口（独立复现，不对着旧日志抄）

无前置时 6 红里 **4 红与 GitHub run 44144683104 完全同类**：

1. `src/ai-native/companionSurface.test.ts` → `npm run game:mcp:build must run first: expected false to be true`
   （需要 `dist-mcp/companionMcpServer.mjs` 等构建产物）。
2. `src/ai-native/signalRenderedHeadlessParity.test.ts`（3 条）→ `expected 3 to be +0` + `ENOENT … reports/ai-native-02/signal/parity/initial.json` / `sequence.json`
   （需要 `tests/signal-rendered-parity.spec.ts` 在真实渲染实例跑一次才产出）。

另外 2 红（`worldBridgeServer.test.ts` 心跳 LOST、`worldHeadlessSnapshotBoundary.test.ts` restore 边界）在隔离复跑 **14/14 PASS**（`…\logs\ci-repro-2-extra-two-isolated.log`），归为负载/时序，不是缺口。

**可靠前置顺序（本克隆实测可用）**：
`npm ci` → `npm run game:mcp:build` → 起 dev server → `npx playwright test tests/signal-rendered-parity.spec.ts`（真实渲染导出）→ `npm test` → `npm run build` → 全量 Playwright。
注：CI 目前把 `npm test` 放在所有 Playwright 之前，因此 parity 那 3 条在 CI 里**必然**拿不到产物；这正是 developer 已提交的 CI 分组 patch（741 纯单测 + 1 surface + 3 parity = 745）要解决的事，本报告只提供基线证据，不改 CI。

**重要口径**：本克隆里 `npm test` 的 745 是 **prepared** 结果（前置由我生成）。所以“缺构建导致没跑”不能当作 permission/Owner 类检查的 PASS；仓库里依赖 `dist-mcp` 的 surface/权限断言，只有在构建产物存在时才算真正执行过。

## 2. 六项真实体验审计（Agent 驱动真实输入）

harness：`reports/gameplay-01/tester/playtest/playtest.spec.ts` + `playtest.config.ts`（在克隆内跑，念 `D:/tmp/ls-p0-ci`，证据写回本仓库该目录）。指标 JSON：`reports/gameplay-01/tester/evidence/playtest-p0.json`；日志 `…\logs\p0-playtest.log`（**PASS 5/5**）。

### 2.1 人类式战斗（runner=agent，真实 WASD + 鼠标点射；无 seed 覆盖、无 Dev seam、无救命）
- 走到 combat 房（room 3，用真实按键移动 + `F` 进房），6 次真实鼠标点击开火：**伤害 0→48**，**HP 100→56**（真被怪打到），tick +202，用时 11.9s，房间内 3 个敌人。
- 证明：真实输入 → 真实 core 伤害/受伤/tick。**不能证明**：人类操作水平、平衡、通关。

### 2.2 Local AI 战斗（runner=agent 点暂停菜单 + **LOCAL DETERMINISTIC** 控制器；不是 LLM、不是人类）
- 8s 窗口：AI 动作数 1→12，**伤害 0→162**，**击杀 0→2**，tick +169，从 start 房进入 combat 房，owner=ai，玩家 HP 100→100。

### 2.3 ECHO 协作（runner=agent；**autoOwner fixture**：Owner CONFIRM 是自动点击，不是人类）
- 先在 combat 房（3 敌人）打开 ECHO 页 → ENABLE（core 命令，下一 tick 才落地）→ 恢复 1 tick 后 echo 出现（hp 100/100）→ 再进页面 CONFIRM ASSIST（armed false→true）→ 恢复 4s：**伤害 126 / 击杀 2**，echo 自身 HP 100→89（独立受伤），echo 弹丸计数 1。
- 不能证明：真人 Owner 确认、ECHO 一定更优。**不做策略优劣判断**。

### 2.4 Signal 操作（runner=agent；真实 Settings 点击 + 真实 T/Y/R 键）
- 先通过 Settings 打开 `SIGNAL COLLABORATION`（存档 false→true，持久化），**退出到菜单用 REPLACE AND START 重开一局**（设备只在开局生成的房间里），随后：
  - 基线：device `relay_main` @room0，relay INACTIVE，playerEnergy 100；
  - `T`（scan）：playerEnergy **100→92**，evidence 0→1，playerScanCD 89；
  - `Y`（jam）：relay **JAMMED**，jammedUntilTick 454；
  - `R`（toggle relay）：relay 状态继续变化（见 JSON 全字段）。
- 口径备注：`world.signalView()` 在没有设备的 run 里返回 null（我第一版测到 null，已复测纠正）；首版数据保留在日志/JSON 历史里。

### 2.5 关卡推进（runner=agent，真实移动/开火/`F`；无 addXp）
- 真实战斗 2 击杀 → **LevelUpScene 真实弹出**并真实选择：level **1→2**，xp 6/74，用时 10.7s。

### 2.6 Headless / 规则层（与浏览器分开跑）
| 命令 | 结果 | 日志 |
|---|---|---|
| `npm run game:sim:parity` | **PASS** `PARITY_PASS checks=8 failures=0` | `…\logs\headless-1-sim-parity.log` |
| `npx vite-node src/ai-native/worldMcpSmoke.mts` | **PASS** `WORLD_MCP_SMOKE_PASS` | `…\logs\headless-2-world-mcp-smoke.log` |
| `npx vite-node src/ai-native/worldHeadlessMcpSmoke.mts` | **PASS** `HEADLESS_MCP_SMOKE_PASS` | `…\logs\headless-3-headless-mcp-smoke.log` |
| `npx vite-node scripts/c3c-rendered-headless-parity.mts` | **PASS** `C3C_RENDERED_HEADLESS_PARITY_PASS tick=27 events=59` | `…\logs\headless-4-c3c-node-parity.log` |
| `npx vite-node scripts/c3b-f03-gate.mts` | **PASS** `F03_PRODUCTION_GATE_PASS` | `…\logs\headless-5-f03-gate.log` |

注：c3c 重放依赖全量 Playwright 里 `tests/c3c-headless-parity.spec.ts` 的导出（本次全量跑已产出，属 prepared）。

## 3. 失败与 flake 分类（保留全部失败）

| 现象 | 复现次数 | 分类 | 证据 |
|---|---|---|---|
| 全量 1 红：`ai-native-world.spec.ts` P3-a `protagonist HP is unaffected by echo damage`（期望 100，实得 82） | 全量 1/1 红 + **隔离 3/3 红** | **该 commit 上的确定性失败**（不是负载 flake）：这台机上真人式/自动跑都会在观察窗口里被真实敌人打到，断言把“echo 伤害不该打到主角”与“任何东西都不得伤到主角”混在一起 | `baseline-3-playwright-full-clone.log`、`flake-p3a-1..3.log` |
| `audit.spec` P2 Boss 弹丸 16 vs 15 | 隔离 2/2 **PASS**（本快照未复现） | 既有 flake（前一阶段残留弹丸），非本任务 | `flake-p2-boss-1..2.log` |
| `whale-character.spec` `whale-dash` | 隔离 2/2 **PASS**（本快照未复现） | 既有 flake | `flake-whale-1..2.log` |
| `npm test` 2 红（bridge 心跳 / headless restore） | 隔离 14/14 PASS | 负载/时序 | `ci-repro-2-extra-two-isolated.log` |

## 4. 真实模型（LLM）能力：**BLOCKED / 未测**

- 只检查“配置是否存在”，不读取也不输出任何密钥：`OPENAI_API_KEY / ANTHROPIC_API_KEY / GEMINI_API_KEY / LAST_SIGNAL_WORLD_BRIDGE_URL / LAST_SIGNAL_WORLD_TOKEN / LLM_BRIDGE_URL` 在本机**全部 UNSET**。
- 因此**没有**用真实模型跑过 P0；§2.2 的 Local AI 是 **deterministic 控制器，不是 LLM**，§2.3 的 Owner 确认是 **autoOwner fixture，不是真人**。
- 结论：真实 LLM 体验 = **BLOCKED（缺配置/连接）**；需要既有正式授权链 + 真实模型 bridge 才能开测，届时另行标注 agent(real model)。

## 5. 本轮发现的基线问题（按优先级）

**P0（会直接让 CI/验收失真）**
1. CI 顺序缺陷：`npm test` 早于 `dist-mcp` 构建与渲染侧 parity 导出 → 4 条必然红（§1.1）。复现与修正顺序已给出；CI 本身未改。
2. **“缺前置 = 未执行”必须视为未验证**：依赖 `dist-mcp` 的 surface/权限类断言（MCP 工具面、Owner cap 面）在没有构建产物时根本没跑，不能记作安全 PASS。
3. `tests/ui-menu-layout.spec.ts` 里有硬编码的输出目录守卫：`UI_OUT_DIR` 必须位于 `reports/ui-rework-01` 下，否则**整套 Playwright 在加载期直接崩**（我方首次全量尝试即因此失败：`report_safe_guard … UI_OUT_DIR must stay under reports/ui-rework-01`）。这会阻止“新任务用自己的证据目录”，建议后续由实现方放宽为“不得写入 before/after 既有目录”。

**P1（影响证据强度，不影响产品可玩）**
4. P3-a 在该 commit 上确定性红（§3）；需要把“echo 伤害不影响主角”与“窗口内无其它伤害源”解耦（例如窗口内清敌对或在断言里区分伤害来源）。属**测试断言问题**，本轮不改 tests。
5. `world.signalView()` 在无设备 run 返回 null、opt-in 中途打开不会给当前 run 追加设备（必须重开一局）——测量口径要注意，不是 bug。
6. 敌人实例没有 `roomId` 字段（只有 `_wx/_wy/_data`），跨房敌人筛选需要按距离/在场判断。

## 6. 未完成 / 明确列出

1. **完整 Playwright 未全绿**：117/118，唯一红是 §3 的 P3-a（确定性）。未用 skip/放宽阈值处理。
2. **真人试玩：无**（`HUMAN ACCEPTANCE PENDING`）；本报告所有“人类式”输入均为 Agent 驱动。
3. **真实 LLM 体验：BLOCKED**（无配置）。
4. **solo 可完成性 / seed 变体矩阵**：仅设计，未执行（P0 范围内未做通关判定）。计划：≥3 个真实 seed，人类式 Agent 操作，分别记录时间/伤害/Energy/操作次数/建议接受，**不预设 ECHO 更优、不以 solo 失败作为任何 PASS 条件**（遵守 P4 人类独立可完成）。
5. **P4 双路线（Human Only / Human+ECHO）** 的正式对比：属于后续阶段，本轮不做。

## 7. 指标口径（可复现）

- **time**：从 `bootRun` 到该 item 结束的墙钟毫秒（含菜单操作），同时给 core tick 差值。
- **damage**：`GameScene.damageDealt` 的差值（玩家造成的伤害；echo 击杀会经核心结算进入该计数，故 §2.3 的 126 含 echo 贡献，已注明）。
- **HP**：`world.player.data.hp` 前后值（不是“受伤次数”）。
- **Energy**：`world.signalView()` 的 `playerEnergy/echoEnergy` 前后值（无设备时 null，见 §5.5）。
- **Signal 次数**：真实按键 T/Y/R 各一次，配合 `evidence`/`relay`/`*ScanCD`/`*JamCD` 前后值。
- **ECHO 建议/接受/失败/完成率**：本 P0 只记录了 1 次 autoOwner 接受与 assist 生效；**未构造多次建议样本，因此不计算“接受率/完成率”**（避免用 1 个样本编造比率）；后续 P1/P4 再按“建议总数 = suggestEcho 非空次数 / 接受 = Owner 确认次数 / 过期或替换 = 失败”统计。

## 8. 一行一条（复核用）

- `npm run typecheck` → PASS(0 error) → `D:\Project\LAST_SIGNAL\reports\gameplay-01\tester\logs\baseline-1-typecheck-clone.log`
- `npm run build` → PASS(exit 0) → `…\logs\baseline-2-build-clone.log`
- `npm test`（无前置）→ FAIL 739/745(4 files/6) → `…\logs\ci-repro-1-npm-test-clean.log`
- `npm test`（+game:mcp:build）→ FAIL 742/745(1 file/3) → `…\logs\ci-repro-4-npm-test-after-mcp-build.log`
- `npm test`（+parity export）→ PASS 745/745 → `…\logs\ci-repro-6-npm-test-after-parity.log`
- `PORT=5460 npx playwright test --workers=1` → FAIL 117/118（P3-a 确定性）→ `…\logs\baseline-3-playwright-full-clone.log`
- `playtest 5 items` → PASS 5/5 → `…\logs\p0-playtest.log` + `…\evidence\playtest-p0.json`
- `game:sim:parity` → PASS(8 checks) → `…\logs\headless-1-sim-parity.log`
- `worldMcpSmoke` → PASS → `…\logs\headless-2-world-mcp-smoke.log`
- `worldHeadlessMcpSmoke` → PASS → `…\logs\headless-3-headless-mcp-smoke.log`
- `c3c rendered↔headless node parity` → PASS(tick=27) → `…\logs\headless-4-c3c-node-parity.log`
- `c3b-f03 gate` → PASS → `…\logs\headless-5-f03-gate.log`
- `P3-a isolation ×3` → FAIL 3/3（确定性）→ `…\logs\flake-p3a-1..3.log`
- `P2 boss bullets ×2` → PASS 2/2 → `…\logs\flake-p2-boss-1..2.log`
- `whale dash ×2` → PASS 2/2 → `…\logs\flake-whale-1..2.log`

## 9. 结论

- 工程口径：**ENGINEERING BASELINE RECORDED**（门禁与玩法证据齐全、失败与前置全部公开）；全量 Playwright 仍有 1 条该 commit 上的确定性红（P3-a），因此不宣称“全绿”。
- 人类口径：**HUMAN ACCEPTANCE PENDING**（无真人试玩、无真实 LLM、无 solo 通关矩阵）。
