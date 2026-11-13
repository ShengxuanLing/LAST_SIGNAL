# AI-NATIVE-01 P0 — 基线补全测试报告

> 文件归属：Tester Worker（只拥有本文件与项目外证据目录 `D:/Project/AI-NATIVE-01-evidence/`）。
> 未修改任何源码、测试、测试配置、`package.json`；未切换分支、未 `git add`、未 commit。
> 依据：7 份指定设计文档（`GAME_DESIGN_BIBLE.md`、`REALITY_ENGINEERING_RULES.md`、`AGENT_BRIDGE_ARCHITECTURE.md`、`DESIGN_DECISION_REGISTER.md`、`ARCHITECTURE_DECISIONS.md`、`VERTICAL_SLICE_IMPLEMENTATION_PLAN.md`、`VS_00_IMPLEMENTATION.md`）与本轮 P0 契约文档 `AI_NATIVE_ARCHITECTURE.md` / `AI_NATIVE_PROTOCOL.md` / `AI_NATIVE_PERMISSION_MODEL.md`（后三份由其他 Worker 产出，本报告只引用、不修改）。ALIGN-01 六份报告本 Worker 未在仓库内找到，不编造其内容。

| 项 | 值 |
| --- | --- |
| 执行时间 | 2026-11-12 18:11–18:18 (+0100) |
| 分支 / HEAD | `feat/ai-native-runtime` / `c656f788227f44efec993315bfb65a323e398377`（= `origin/main`，0 提交 ahead） |
| 共享目录 | `D:/Project/LAST_SIGNAL` |
| 证据目录 | `D:/Project/AI-NATIVE-01-evidence/`（项目外） |
| 执行模式 | headless（无可见浏览器、无全局键鼠、无焦点抢占） |

---

## 1. 结论

**P0 基线全绿，无回归失败，无需上报阻断项。**

- 全旧 Playwright 回归 **23/23 PASS**（9 个 spec 文件，0 skipped / 0 failed），`CONSOLE ERRORS: 0`。
- Vitest **63/63 PASS**（Leader 日志，引用），本 Worker 独立 `npx tsc --noEmit` **PASS**。
- 默认生产构建（Leader 日志，引用）与 **economy 独立构建 PASS**（`--outDir` 指向项目外，仓库 `dist/` 未被写入）。
- 测试完整性：所有测试/配置/`package.json` 的 md5 在会话前后完全一致，`git diff --exit-code HEAD` = 0；**没有删除、跳过或放宽任何旧测试**。
- 旧档边界未被触碰：`last_signal_station_zero_vs00_v1` / `last_signal_save_v1` / `SAVE_VERSION=2` 均未被本轮测试写入或改写；E5/E6/E7/E8 与 checkpoint 用例全部通过，死亡→Game Over 清 run 与"死亡即新局"契约一致。

本轮唯一的 FAIL 是**有意设计的负向对照**（见 §5），用于文档化"必须先启动 5173/5199 双 dev server"这一环境前置条件，不是旧回归失败。

---

## 2. Gate 汇总（命令 | PASS/FAIL | 日志绝对路径）

完整机读版：`D:/Project/AI-NATIVE-01-evidence/p0-tester-gate-summary.log`

### 2.1 Leader 提供的既有日志（本 Worker **未执行**，仅记录/核验结果，不冒充自己执行）

| 命令 | 结果 | 日志绝对路径 |
| --- | --- | --- |
| `npm run typecheck` | PASS（引用：仅 npm banner，无 tsc 错误） | `D:/Project/AI-NATIVE-01-evidence/p0-typecheck.log` |
| `npm test` | PASS（引用：5 files / **63 tests passed**） | `D:/Project/AI-NATIVE-01-evidence/p0-test.log` |
| `npm run build` | PASS（引用：`✓ built in 7.63s`） | `D:/Project/AI-NATIVE-01-evidence/p0-build.log` |
| 三份日志溯源 / 编码核验 | PASS（记录） | `D:/Project/AI-NATIVE-01-evidence/p0-tester-leader-logs.log` |

### 2.2 本 Worker 实际执行的 gates

| 命令 | 结果 | 日志绝对路径 |
| --- | --- | --- |
| `npm run` + `package.json` scripts/deps 读取 | PASS | `D:/Project/AI-NATIVE-01-evidence/p0-tester-package-scripts.log` |
| `npx playwright --version` / `npm ls ...` / 浏览器清单 / headless 标志检查 | PASS | `D:/Project/AI-NATIVE-01-evidence/p0-tester-playwright-deps.log` |
| `git rev-parse` / `status` / `log` / `diff`（基线） | PASS | `D:/Project/AI-NATIVE-01-evidence/p0-tester-git-baseline.log` |
| `netstat` 5173/5199 + `curl` + PID/命令行（运行前） | PASS | `D:/Project/AI-NATIVE-01-evidence/p0-tester-ports-before.log` |
| 服务复用决策 + 进程/清理记录 | PASS（记录） | `D:/Project/AI-NATIVE-01-evidence/p0-tester-services.log` |
| `md5sum` 全部测试/配置/`package.json`（会话前） | PASS | `D:/Project/AI-NATIVE-01-evidence/p0-tester-md5-before.log` |
| `npx tsc --noEmit`（本 Worker 独立 LSP 复跑，exit 0） | PASS | `D:/Project/AI-NATIVE-01-evidence/p0-tester-lsp-typecheck.log` |
| `LS_SHOT_DIR=D:/Project/AI-NATIVE-01-evidence/shots npx playwright test --output D:/Project/AI-NATIVE-01-evidence/playwright-results` | **PASS 23/23** | `D:/Project/AI-NATIVE-01-evidence/p0-tester-playwright.log` |
| `npx vite build --config vite.economy.config.ts --outDir D:/Project/AI-NATIVE-01-evidence/economy-dist` | **PASS**（exit 0） | `D:/Project/AI-NATIVE-01-evidence/p0-tester-economy-build.log` |
| smoke：双端口 200 / 外部产物 / `CONSOLE ERRORS: 0` | PASS | `D:/Project/AI-NATIVE-01-evidence/p0-tester-smoke.log` |
| `md5sum` 会话后 + 前后 diff + `git diff --exit-code HEAD` | PASS（MATCH / 0） | `D:/Project/AI-NATIVE-01-evidence/p0-tester-md5-after.log` |
| `git status` / `diff` / HEAD / untracked（终态） | PASS | `D:/Project/AI-NATIVE-01-evidence/p0-tester-git-final.log` |
| 服务终态存活 + 清理记录 | PASS | `D:/Project/AI-NATIVE-01-evidence/p0-tester-services-final.log` |
| `PORT=5999 npx playwright test tests/gameplay.spec.ts --reporter=line`（负向对照，预期失败） | **FAIL(expected)** | `D:/Project/AI-NATIVE-01-evidence/p0-tester-playwright-no-server-repro.log` |

失败项最相关单行错误（负向对照）：`Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:5999/`

---

## 3. 原有回归覆盖（10 类，全部实测 PASS）

E2E 由 `npx playwright test` 全量执行，**未加 `--grep`、未 skip、未改断言**；单测数量取自 Leader 的 `p0-test.log`（63/63）。

| 回归域 | 覆盖用例 | 数量 | 结果 |
| --- | --- | --- | --- |
| 默认游戏（菜单→移动→射击→击杀→掉落→升级→暂停→传送；P2 回归） | `tests/audit.spec.ts`（`fixed-seed playability regression` / `P2 regression`）、`tests/gameplay.spec.ts`（`menu + gameplay render`） | 3 | PASS |
| Station Zero（独立 `/station-zero.html` 入口、Scan→Jam→Door、存档隔离） | `tests/vs00.spec.ts`、`tests/vs01.spec.ts`（均 goto `/station-zero.html`） | 13 | PASS |
| Economy（`/economy.html` 信用点获取/消费/checkpoint 恢复） | `tests/economy.spec.ts` | 1 | PASS |
| VS-00 | `tests/vs00.spec.ts`（E1–E9，含 E5/E6/E7/E8 存档隔离与坏档锁写）、`src/slice/vs00.rules.test.ts`(28)、`src/slice/vs00.room.test.ts`(3) | 9 + 31 | PASS |
| VS-01（走廊 relay/桥/致命失稳） | `tests/vs01.spec.ts`（4）、`src/slice/vs01.corridor.test.ts`(14) | 4 + 14 | PASS |
| R2（Guard 感知 / `station-zero-r2-v1`） | `src/slice/corridorGuard.test.ts`（`describe('R2 guard perception')`, 3）、`tests/vs01.spec.ts` 的 `route B ... guard Jam`（1，含 `template:'station-zero-r2-v1'` fixture） | 3 + 1 | PASS |
| checkpoint / 死亡 | `tests/checkpoint.spec.ts`（`resume reuses the checkpoint id...` / `death routes to Game Over and clears the run checkpoint`）、`tests/vs01.spec.ts`（`a lethal collapse clears the run and permits a fresh start`） | 2 + 1 | PASS |
| Boss | `tests/boss-room.spec.ts`（`camera bounds and shake ... addShake(18)`）、`tests/audit.spec.ts` P2 回归（boss bullets / 屏震有界） | 1 + 1 | PASS |
| Canvas / HUD（硬编码 `5199`） | `tests/canvas.spec.ts`（`full HUD renders and stays locked during camera movement`） | 1 | PASS |
| runtime bugs（视口缩放/文本/墙对齐/弹丸清理/清房出口） | `tests/runtime-bugs.spec.ts`（2） | 2 | PASS |
| 纯逻辑单测（iso 投影 / `applyUpgrade` / `validate`） | `src/core/runtime.test.ts` | 15 | PASS |

合计：Playwright **23 passed (1.1m)** / Vitest **63 passed**（引用 Leader 日志）。`tests/gameplay.spec.ts` 报 `CONSOLE ERRORS: 0`；`audit`/`gameplay` 对 `console.error` / `pageerror` 零容忍用例均通过。

---

## 4. 服务、进程与后台执行记录

- **先检查端口**：`netstat` 显示 `5173` → PID **1804**、`5199` → PID **23492**，两者均为 `node.exe ... vite.js --port <N> --strictPort`（父进程 24828 / 6200），返回 200 且 `<title>LAST SIGNAL</title>`，`/station-zero.html`、`/economy.html` 也均 200。
- **不杀他人进程**：两个服务均属其他 Worker/进程，本 Worker **启动 0 个进程、终止 0 个进程**，直接复用；`--strictPort` 下启动重复实例必然失败，复用是唯一安全选择。
- **清理记录**：N/A（本 Worker 无自有子进程）。终态复核见 `p0-tester-services-final.log`：两端口仍 LISTENING、PID 不变、仍返回 200；仅有测试产生的 `TIME_WAIT` 连接（属正常 TCP 回收）。
- **headless / 不占桌面**：`playwright.config.ts` 无 `headless:false` / `--headed` / `--ui`，使用 `chromium_headless_shell-1254`；全部输入为 CDP 页内 `page.keyboard` / `page.mouse`，全库 grep 未发现任何 OS 级输入 API（`p0-tester-playwright-deps.log`）。无可见浏览器窗口、无全局键鼠注入、无前台焦点改变。
- **产物全部项目外**：
  - `LS_SHOT_DIR = D:/Project/AI-NATIVE-01-evidence/shots`（15 个截图文件）
  - `--output = D:/Project/AI-NATIVE-01-evidence/playwright-results`（0 条目：23/23 全通过，无失败产物）
  - `--outDir = D:/Project/AI-NATIVE-01-evidence/economy-dist`（`economy.html` / `index.html` / `assets/`）
  - 仓库内 `tests/screens/`、`test-results/`、`dist/` 均未被本 Worker 写入（`git status --porcelain` 为空；economy 构建前后 `dist/` 全部文件 md5 一致）。

---

## 5. 真实失败 / 非阻断发现

1. **旧回归失败：0**。无 `pageerror`、无 `console.error`、无 skipped。
2. **负向对照（预期失败，非回归）**：`PORT=5999 npx playwright test tests/gameplay.spec.ts --reporter=line` → `ERR_CONNECTION_REFUSED`。最小复现：不启动 5173/5199 时直接跑 `npx playwright test`（`playwright.config.ts` 无 `webServer`，`tests/canvas.spec.ts` 硬编码 5199）。这是 `CONTRIBUTING.md §2` 与 `AGENT_BRIDGE_ARCHITECTURE.md §10.3` 已文档化的前置条件，本轮通过复用既有服务满足，不构成阻断。
3. **构建告警（非失败）**：默认构建与 economy 构建均出现 `Some chunks are larger than 500 kB`（`enemies-*.js` 1,487 kB / 1,565 kB）；economy 构建另有 `outDir is not inside project root and will not be emptied`（`--outDir` 在项目外的预期提示）。两者 exit 0，产出完整。
4. **证据日志质量风险（建议 Leader 修正，不影响结论）**：Leader 的三份 `p0-*.log` 为 **UTF-16LE** 编码（PowerShell `>` 默认），不便机器解析；日志内没有记录 `exit code`。`p0-build.log` 中还有一段 PowerShell `NativeCommandError` 记录（npm 把 vite 的 chunk 警告写 stderr，被 Windows PowerShell 包装成 `RemoteException`），其后仍有 `✓ built in 7.63s`，故不是构建失败，但容易被误读。建议后续统一 `2>&1 | Tee-Object -FilePath ... -Encoding utf8` 并附 `$LASTEXITCODE`。完整解码视图见 `p0-tester-leader-logs.log`。

---

## 6. 测试完整性（未删 / 未放宽）

| 检查 | 结果 |
| --- | --- |
| 9 个 spec 文件 / 23 个 `test()` 块，5 个 vitest 文件 / 63 用例 | 与运行前一致 |
| 会话前 vs 会话后全部测试/配置/`package.json` md5 | **MATCH**（见 `p0-tester-md5-before.log` / `p0-tester-md5-after.log`） |
| `git diff --exit-code HEAD -- tests/ src/ package.json ...configs` | **0**（无改动） |
| `git diff --cached` | 空（本 Worker 未 `git add`） |
| 终态 `git status --short` | 仅 3 份**其他 Worker** 的未跟踪契约文档 + 本文件；无源码/测试改动 |

---

## 7. 本 Worker 实际交付的文件 / 接口 / 未完成与风险

**交付文件**
- 仓库内：`docs/AI_NATIVE_TEST_REPORT.md`（本文件，唯一拥有）。
- 项目外：`D:/Project/AI-NATIVE-01-evidence/` 下 16 份 `p0-tester-*.log`（含 `p0-tester-gate-summary.log`）、`shots/`（15 个截图）、`playwright-results/`（0 条目，无失败产物）、`economy-dist/`、`p1-acceptance-checklist.md`。该证据目录为多 Worker 共享，另有 `p0-architecture-*` / `p0-review-*` 等他人日志，均不属于本 Worker。
- 未修改 `src/`、`tests/`、`package.json`、`vite*.ts`、`vitest.config.ts`、`playwright.config.ts`；未 commit、未切分支。

**接口**：本 Worker 作为 Tester **不新增运行时接口**。P1 验收依据已核对 P0 契约声明的接口/类型：`last_signal.ai-native.{envelope,dto,observation,event,snapshot,replay,debug}.v1`、`SessionDescriptorV1` / `ActorV1`、`ActionRequestV1` / `SessionCommandV1` / `StepResultV1` / `ErrorV1`、`ObservationV1` / `ObservationEvidenceV1` / `DebugInspectionV1`、`AI_NATIVE_LIMITS_V1`、PLAYER/COMPANION/DEVELOPER 权限矩阵、§6 错误码枚举、§7 固定 tick 全序与 §8 事件全序。**这些目前都是文档契约，尚无实现代码**（`src/ai-native/protocol.ts` 不存在），本报告不把它们当作已实现功能。

**未完成 / 风险（不冒充已完成）**
- P0 三份契约文档由其他 Worker 产出且仍为**未跟踪文件**，未纳入 commit；`src/ai-native/protocol.ts` 与最小 schema 校验测试尚未出现 —— 按 §14 汇报制度，P0 阶段提交由 Leader 整合，本 Worker 未 commit。
- **口径差异需 Leader 确认**：任务书要求"ALIGN-01 六份报告目前未找到，不能编造"，而 `docs/AI_NATIVE_ARCHITECTURE.md` §A-N1 / §4.1 声明"六份已逐份阅读 / 在仓库外找到"。本 Worker 在仓库内确实未找到，无法核实仓库外证据，故不引用其具体结论，仅按已存在的 P0 契约文档条款编写 P1 清单。
- **确定性范围**：`src/` 仍存在 7 处 `Math.random()`（`GameScene.ts:85`、`LevelUpScene.ts:117`、`World.ts:433,644`、`Boss.ts:142`、`GraphicsFactory.ts:57`、`AudioSystem.ts:66`），主 World 为变长 dt、非完全确定性。P0 只把 `station-zero-r1-r2` 纯规则核心纳入确定性承诺，不得宣称全游戏确定性（对齐 `ARCHITECTURE_DECISIONS.md` ADR-08、`AI_NATIVE_ARCHITECTURE.md` §6 / A-N3）。
- **R9 / 死亡语义 / 旧档**：`src/slice/rules.ts` 的 `reveal` 目前仍是 `scanRevealTicks` 计时器门控的布尔集合，`storage.ts` 只存 `scanRemaining`/`scanReveal` 计数器；尚无 `ObservationEvidenceV1`（位置/观察 tick/目标 ID/过期语义）。P2 前不得让证据参与 AI/ECHO 决策，restore 时绝不重扫。"死亡=新局（`finished(died)`→`reset`→新 R0）"与"退出/刷新恢复最近 checkpoint"必须在 P1 分开测试，不得混淆（对齐 `AI_NATIVE_PERMISSION_MODEL.md` §3.1）。
- **headless CLI / MCP / 新测试**属 P1+ 范围，本轮未测（P0 只做基线补全）。
- **环境前置**：`playwright.config.ts` 无 `webServer`，双 dev server 缺一即全量 E2E 失败；建议 P1 起在 CI/脚本中显式启动与回收，或由 Leader 决定是否加入 `webServer`（属配置改动，本 Worker 未动）。

---

## 8. P1 验收清单（确定性 / 隔离 / R9）

完整可执行版另存于 `D:/Project/AI-NATIVE-01-evidence/p1-acceptance-checklist.md`。要点：

- **确定性**：固定 tick / pause 不推进 / resume 不补时；同 `initialSnapshot + actions + kernelVersion` → 相同 `finalStateHash` 与 `eventsHash`；`issuedAtMs`/`transportSeq`/墙钟/`Math.random()` 不得影响权威结果；`protocol.ts` 纯 TS 静态检查；事件 `(tick,phase,ordinal,actorId,eventId)` 全序；1000/10000 ticks + 10 sessions 基准；明确只覆盖 `station-zero-r1-r2`。
- **隔离**：10 个 session 并行时 10 类状态互不共享；无全局可变单例；跨 session `restore`/`replay`/`actionId`/`actorId` 全拒；`production` 参数不得升级为 Dev / `detail:"debug"` 被拒 / 隐藏字段黑名单逐项断言；Dev `dev` 段导出前剥离并重算 hash；死亡=新局且旧档 key/版本不变；`close`/`reset`/epoch 的资源回收与幂等缓存清理；后台执行不占桌面。
- **R9**：Scan 事务内原子写证据、空扫证据为空、非法零费无证据；证据字段完整；保存/恢复同一原子快照且 restore **绝不调用 scan/LOS**；同一 snapshot 两次 restore 证据与 TTL 完全一致；旧档无证据→清空并提示重扫、不覆写旧档；旧观察不自动升格当前事实 / Canonical。
- **每阶段通用 gate**：typecheck / vitest / build / economy build / 全旧 Playwright + 测试 md5 与 `git diff --exit-code`，日志全部落 `D:/Project/AI-NATIVE-01-evidence/`；任一隐藏信息泄漏、跨 session 污染、死亡续局、旧档覆写或重大回归 → 立即上报阻断。

---

## 9. P1 独立验收（PRE-FIX；阻断未关闭，**非最终验收**）

> 本节 supersedes 本文件此前任何「P1 可通过」前提。`p1-tester-*.log`（159/159 单测、23/23 E2E、R9 79 项、CLI 5 场景、性能）与 `p1-fix-tester-*.log` 全部标记为 **pre-fix**，不得作为最终 P1 验收。
> 依据：独立 Reviewer `D:/Project/AI-NATIVE-01-evidence/p1-review.md`（7 类真实反例）；本 Worker 独立复现报告 `D:/Project/AI-NATIVE-01-evidence/p1-fix-tester-report.md`。

**阶段判定：P1 = BLOCKED（7/7 阻断独立确认）。**

| 阻断 | 独立复现关键行 | 日志 |
| --- | --- | --- |
| B1 浏览器帧批 vs Node 逐 tick 转场采样分叉 | `batchEnteredCorridor:false` / `perTickEnteredAtTick:1` / `DIVERGES:true` | `p1-fix-tester-probes.log` |
| B2 `observe()` 泄漏 `guard.behavior` / 原始 `reveal` / `corridorReveal`，`validateObservationDetailed()` 返回 `E_SCHEMA` | `LEAKS:true` | `p1-fix-tester-probes.log` |
| B3 过期证据=免费 Scan（过期 4515 tick 仍 `revealDoorReceiver:true`、`energy:100`）+ 进 R2 保留 R1 证据 | `FREE_SCAN:true` / `RETAINED_IN_R2:true` | `p1-fix-tester-probes.log` |
| B4 跨 seed / 伪造 `restore` 任意写（teleport、fake `passed`、`energy=1e9`、哈希可省略） | `CROSS_SEED_ACCEPTED:true` / `FORGED_WRITE_ACCEPTED:true` | `p1-fix-tester-probes.log`、`p1-fix-tester-cli.log` |
| B5 0 步 replay canonical state 因 `epoch+1` / `accumulatorMs` 清零必然漂移 | `src=sha256:365c3e… rep=sha256:8e66…` | `p1-fix-tester-probes.log`、`p1-fix-tester-cli.log` |
| B6 CLI `replay` 无 audience 闸门直出 `seed/rngState/model` | `REPLAY_BYPASSES_AUDIENCE_GATE` | `p1-fix-tester-cli.log` |
| B7 坏 `actions`/`steps` 静默降级、`quit` 不主动退出 | `BAD_ACTIONS_SILENTLY_ACCEPTED` | `p1-fix-tester-cli.log` |

**假阴性更正**：上一轮 `p1-tester-r9.log` 的 79/79 PASS 只验证「restore 不重扫」正常路径，**漏测** B3 的过期证据与跨房间残留；不得用它抵消 B3。

**绿灯不抵消阻断**：`npm run typecheck` PASS、`npm test` 159/159 PASS、`npm run build` / economy 构建 PASS、双端口全旧 Playwright 23/23 PASS、1000/10000 ticks 与 10 实例性能测量 PASS —— 全部为 pre-fix 快照，且**不能**替代上述真实反例。日志见 `p1-fix-tester-gate-summary.log`。

**证据范围 / 并发变更**：B1–B7 探针全程 md5 UNCHANGED（pre-fix 快照，见 `p1-fix-tester-source-snapshot-after.log`）；Developer 于 21:06:01 改 `src/slice/fullState.ts`、21:07:16 改 `src/slice/rules.ts`（见 `p1-fix-tester-concurrency.log`）。本 Worker 未对修复后源码复测、未等待/轮询；Leader 待 developer 终态另派复测。

**边界**：CLI 是本机显式 Dev/test 验证进程，`audience:"dev"` 为自述字符串，不构成 Player Gateway 权限验收；固定动作序列的合法门桥链路不是真实 AI 通关（P4）。`__testSetPosition` 直接钩子不可达，但 B4 的 `restore` 是等价写面。旧档 key/版本未变；旧 v1 无 evidence 的降级路径正常，但 B3 的过期 evidence 与跨房间残留必须修。

修复后须重新执行 B1–B7 最小反例 + 本文件 §8 清单 + 全套 gate，由 Leader 验收后再推进 P2。

---

## 10. P1 修复版独立复验（FIXED 快照）

> 本轮对 **FIXED snapshot**（HEAD `95e8da35dcaff9000ae0147ef3ec80b0e0a085fc`，md5 见 `p1-final-tester-source-snapshot.log`）独立复验，**不沿用任何 pre-fix 通过结论**。md5 在整个复验期间 **UNCHANGED**，证据可作为该快照的验收依据。完整报告：`D:/Project/AI-NATIVE-01-evidence/p1-tester-final.md`；gate 汇总：`p1-final-tester-gate-summary.log`。

**判定：B1–B7 最小反例全部 CLOSED。** 唯一待裁决项为 B4 的 Dev-only 同 session 仅改位置 restore 仍可写/可跨门（不跨 seed/session、非 Player 通道）。P2 权限系统未实现，按指示不单独判失败。

| 阻断 | 修复版复验关键行 | 结果 |
| --- | --- | --- |
| B1 帧批 vs 逐 tick | `B1_production_parity | browserEnteredAtTick=1 == nodeEnteredAtTick=1, same positions, PARITY:true`（新 `onCommit` 生产路径；旧 2 参帧末探针仅对照、非生产） | CLOSED |
| B2 隐藏 observe | `labValidate:"OK", labHidden:null, role:"PLAYER", omittedFieldCount:19`；无 reveal/corridorReveal/behavior；封闭 schema 拒绝额外 seed/reveal/guard | CLOSED |
| B3 过期证据 / 跨房间 | `evidenceCount:0, scanRevealTicks:0, evidenceRescanRequired:true, energy:100`；r2 evidence:0；未来证据存档层拒绝 | CLOSED |
| B4 跨 seed / 伪造 restore | `seed mismatch` / `passed flag without a door-pass event` / 区间拒绝 / CLI 强制 hash；合法 restore 正常 | CLOSED（最小反例） |
| B5 0 步 replay 哈希 | `canonicalEqualAfterRestore:true, replayCanonicalEqualSource:true`，accumulator 10→10（epoch 不入哈希）；CLI src/rep hash 相同 | CLOSED |
| B6 私有帧通道 | `--dev` 进程通道；受限通道 snapshot/restore/replay 全 `E_PERMISSION`，`audience:"dev"` 不升级；create 不回显 seed | CLOSED |
| B7 坏 actions / quit | actions/steps 非数组→`E_SCHEMA`；17th 实例→`E_RESOURCE_LIMIT`；quit 无需 EOF 即 exit 0 | CLOSED |

**残余（供 Leader 判定）**：`B4_forged_position_only` — 同 session、仅改 `playerX/Y`（`passed=false`）的 Dev 帧仍被 restore 接受，下一步可按位置合法 `markPassed` 并进走廊（`DEV_RESTORE_CAN_CROSS_DOOR:true`）。不跨 seed/session、仅在显式 `--dev` 进程内、非 Player/Companion 通道；若要求 restore 为“只读回放”，需再收紧位置来源校验。

**Gate（FIXED）**：`npm run typecheck` PASS、`npm test` **181/181** PASS、`npm run build` PASS、economy 构建 PASS、双端口全旧 Playwright **23/23** PASS、性能 10 项正确性 PASS；均 pre-fix 分离，日志 `p1-final-tester-*`。真实 `npm run game:headless`（`--dev`）与受限 `vite-node --run` 两通道实测；合法门桥链仅用 move/scan/jam/interact/wait（无 `__testSetPosition`），tick 518 完成。

**边界**：CLI 是本机显式 Dev/test 验证进程，`audience` 为历史参数且不再升级权限；固定动作序列不是真实 AI 通关（P4）；旧档 key/版本未变；未改源码/测试/配置、未 commit、未切分支。pre-fix 失败历史保留在 `p1-fix-tester-*` 与本文 §9。

---

## 11. P1 最终残留验收（B3-1 / B4，FINAL residual snapshot）

> 本轮仅复验 B3-1 正常存档与 B4 签发帧完整 payload 绑定 + 正常 restore/replay 正向；B1/B2/B5/B6/B7 上轮已关闭且本轮源码 md5 一致，未见新变化。完整报告：`D:/Project/AI-NATIVE-01-evidence/p1-tester-residual-final.md`；门禁：`p1-residual-tester-gate-summary.log`。

**判定：P1 = PASS（通过）。** 7 个关键文件 md5 与 Lead 提供值逐项 MATCH，且整个复验期间 UNCHANGED。

| 项 | 复验关键行 | 结果 |
| --- | --- | --- |
| B3-1 正常走廊存档 | `corridorEvidenceCount:3 all r2, TTL consistent, rescanRequired:false, noFreshScanEnergyEqual:true`；saved→load→restore 证据与 TTL 正确 | CLOSED |
| B3-1 错房间 / TTL 不一致 | 错房间 `saveSlice=false & loadSlice=rejected`；TTL 与时钟不一致 `saveSlice=false` | CLOSED |
| B4 同 session 仅改位置 + 重算公开 hash | `E_SNAPSHOT_INVALID "snapshot content does not match the issued frame"` | CLOSED |
| B4 跨 seed / 同 seed 异实例 / 伪造 passed | `source seed mismatch` / `not issued by this instance or was evicted (max 64)` / `passed flag set but no DOOR_PASSED event` | CLOSED |
| B4 有界 64 FIFO | 签发 65 帧 → 最旧被驱逐（拒），最新可恢复；同一签发帧可多次恢复 | CLOSED |
| B4 正常 restore / 0 步 replay | `replayCanonicalEqualsSource:true`，replay 不改变活实例 | CLOSED |
| 真实 CLI `--dev` | 签发 `snap_…` → 原样 restore/replay 通过；tamper+重算 hash 拒；跨进程导入拒；quit 无需 EOF 即 exit 0 | CLOSED（22/22） |

**Gate（FINAL residual）**：`npm run typecheck` PASS、`npm test` **186/186** PASS、`tests/vs00.spec.ts`+`tests/vs01.spec.ts` **13/13** PASS（双端口，产物项目外）。日志 `p1-residual-tester-*`。

**边界**：公开 hash 只表完整性、不是授权；“Dev 可 fixture”不作为 restore 任意写的理由——该写面已由签发内容绑定关闭。跨进程任意导入明确不支持且实测被拒。未改源码/测试/配置、未 commit、未切分支。P2 权限系统不在本轮，未据此判 P1 失败。原失败历史保留在 §9/§10 与 `p1-fix-tester-*` / `p1-final-tester-*`。

---

## 12. P2 正式独立验收（BLOCKED，FIXED P2 snapshot）

> FIXED P2 snapshot：HEAD `8a5b7c250b6a878c77bfee99b65163ba2c907b5d`；5 个 P2 关键文件 md5 与 Lead 提供值逐项 MATCH，复验期间 UNCHANGED；`src/slice/` 无改动（13 E2E 引用）。完整报告：`D:/Project/AI-NATIVE-01-evidence/p2-tester-report.md`；门禁：`p2-tester-gate-summary.log`。

**判定：P2 = BLOCKED。** 验收套件 `p2-tester-api.ts` 36 checks / 3 FAIL（B7/D2/E1），另有同批重复 actionId 回执缺陷（C4/C5）。

**通过**：Production PLAYER 句柄仅用底层合法动作完成整条门桥路线（`crossed=true && completed=true`，tick 518，room r2；非仅 passed；无 fixture/`getState`）；P0 `ObservationV1` 输出校验 + 无隐藏字段；角色/Dev 结构分离（Player 无 snapshot/restore/replay/inspectState/injectFixture）；summary/standard/debug 权限；未知 action 字段 `E_SCHEMA`、foreign actor `E_UNKNOWN_ACTOR`、stale epoch `E_STALE_EPOCH`、COMPANION `E_NOT_APPLICABLE`；跨批幂等与失败缓存；AbortSignal 取消与 waitUntil 超时；close 清理；多 manager 隔离、idle 回收、dispose、事件分页。基线：typecheck PASS、**218/218**、build PASS、真实 Node 客户端 exit 0。

**阻断缺陷（最小反例见 `p2-tester-repro.log`）**：
| 缺陷 | 关键行 | 结果 |
| --- | --- | --- |
| E1 `reset` 期间在飞高级动作污染新 run | `tickImmediatelyAfterReset:0 -> tickAfterReset:175` | **状态污染，阻断** |
| D2 `cancelAction` 无法取消在飞高级动作 | `tickA:75 -> tickB:200`（只需 AbortSignal） | **要求内能力失效，阻断** |
| B7 StepRequest 外来 `sessionId` 被接受并执行 | `foreign sessionId accepted, toTick:3` | **闭合校验缺口，阻断** |
| C4/C5 同批重复 actionId 回执错误 | 只扣一次费，但结果为 `E_COOLDOWN`+`E_INTERNAL_TRANSACTION`；跨批重放返回被覆盖的最后回执 | 幂等回执缺陷 |

**非阻断**：`observe('debug')` 拒绝码为 `E_INTERNAL_TRANSACTION`（应 `E_PERMISSION`）；自定义 `seedProvider` 重复 seed 会导致 sessionId 冲突并被 Map 覆盖；developer 的 `sessionClient.mts` 只到 passed（样例，非 gate）。

**未实现范围（不判失败）**：MCP / LLM / ECHO 实体、跨进程 load/import、P4 AI 自主游玩；`injectFixture` 返回 unavailable。

**边界**：未改源码/测试/配置、未 commit、未切分支；全程 headless。原失败历史保留在 §9–§11。

---

## 13. P2 阻断修复轮独立复现（PRE-FIX，BLOCKED）

> PRE-FIX 快照：HEAD `8a5b7c250b6a878c77bfee99b65163ba2c907b5d`；md5 与冻结值一致、全程 UNCHANGED。**不是最终 P2 验收；218 旧测试全绿不通过 P2。** 完整报告：`D:/Project/AI-NATIVE-01-evidence/p2-fix-tester-report.md`；门禁：`p2-fix-tester-gate-summary.log`。

**判定：P2 = BLOCKED（pre-fix）。** 独立探针 38 项检查：**29 FAIL / 9 PASS**，Reviewer B1–B6 与 Lead 幂等/owner/预算裁决全部复现。

| 组 | 关键失败行 | 结果 |
| --- | --- | --- |
| B1 closed schema | `actions:null` 抛 `TypeError`；`actions:"x"` 静默执行；`ticks:NaN` → `E_INTERNAL_TRANSACTION`；`role/dev/audience` 被忽略执行；非法 requestId 执行 | FAIL |
| B2 绑定 | foreign `request.sessionId` / `action.sessionId` / `action.epoch` / `targetTick=current+5` 均执行 | FAIL |
| B3 同批重复 id | 结果 `[E_COOLDOWN, E_INTERNAL_TRANSACTION]`，energy 只扣一次但回执错位 | FAIL |
| B4/Lead 幂等 | 同 requestId 完整重试仍推进 tick（1→2）；同 requestId 异 payload 未拒绝；actionId 指纹不含 epoch | FAIL |
| B5 预算 | `maxSessions 11/1000`、`maxConcurrentSteps 3/64` 被接受；`1.5/NaN` 被接受；非整数 limits 被静默取整 | FAIL |
| B6/owner | PLAYER 句柄有 `pause/resume/reset` 且均 ok；无独立 owner handle | FAIL |
| R3 cancelAction | 在飞高级动作 tick 75→275，cancelAction 无效（仅 AbortSignal 有效） | FAIL |
| R4 reset 竞态 | 在飞动作期间 reset，新 run tick 0→**175**（状态污染） | FAIL |

**通过项**：真实 PLAYER 全路线（crossed && completed, tick 518, 无 fixture/getState）；AbortSignal 取消后停 tick；past targetTick → E_STALE_TICK；step epoch → E_STALE_EPOCH；缓存先于 stale targetTick；新 requestId 重复 actionId 不二次扣费；maxSessions 0/-1/Infinity 被拒。typecheck PASS、218/218、build PASS（均 pre-fix，仅记录，不作 P2 通过依据）。

**未实现范围（不据此判失败）**：MCP/LLM/ECHO、跨进程 load、P4。修复后须复跑本 38 项探针 + 218 单测 + 13 E2E。原失败历史保留（§12 与 `p2-tester-*`）。

---

## 14. P2 事务残留定向复验（PRE-FIX 稳定快照，BLOCKED）

> 稳定快照：`sessions.ts a323faac…` / `test 40cf16…` / `client 480034…` / `protocol 7dbbde…` / `runtime 459166…`；HEAD `8a5b7c2…`。Developer 于 23:06:52 起改源码（当前 `e6ca754a…`），后续为 MID-WRITE 已排除。完整报告：`D:/Project/AI-NATIVE-01-evidence/p2-residual-tester-report.md`；门禁：`p2-residual-tester-gate-summary.log`。

**判定：P2 = BLOCKED（仅事务残留）。** bad-hasher 复现：`createSessionManager({hasher:()=>'bad-hash'})` → `step` 返回 `E_INTERNAL_TRANSACTION`，但 `observe().tick` 已 0→1；同一 `requestId` 重试 → `E_STALE_TICK`，不是原结果。对照（good hasher）正常。

| 项 | 结果 | 关键行 |
| --- | --- | --- |
| T1 结构化错误、无异常 | PASS | `E_INTERNAL_TRANSACTION` |
| T2 失败不留下已推进状态 | FAIL | `tickAfterFirst=1` |
| T3 同 requestId 重试返回相同失败/原结果 | FAIL | `first=E_INTERNAL_TRANSACTION, second=E_STALE_TICK` |
| T4 事务残留 | FAIL | `RESIDUAL_CONFIRMED=true` |

**已关闭（同一稳定快照，引用上轮 49/49）**：B1 closed schema、B2 绑定、B3 同批去重、B4 requestId/actionId 幂等、B5 10/2 预算、B6 Player/Owner 拆分、真实 Player 全门桥、AbortSignal/`cancelAction`、owner.reset 竞态、close/restore 竞态、重复 seed/多 manager、idle/dispose、debug `E_PERMISSION`。typecheck / 225 单测 / build / sessionClient（同 md5）引用通过，未重复全套。

**MID-WRITE 排除**：定向 `sessions.test.ts` 命中 Developer 中间态（`captureRollback is not a function`），14 失败**非产品回归**，已在日志顶部标注并排除。

**修复方向**：`game.step` 前保存 pre-step snapshot 并在校验失败时原子回滚（或提交前完成 result 预校验）；失败 requestId 写幂等失败 entry，重试不得 `E_STALE_TICK`。修复终态由 Leader 另派残留定向复测。原失败历史保留（§12–§13、`p2-review-final.md`）。

---

## 15. P2 最终事务残留定向验收（PASS）

> 快照：HEAD `8a5b7c250b6a878c77bfee99b65163ba2c907b5d`；`sessions.ts e6ca754a…`、`test e6109981…`、`runtime 58413a99…`、`protocol 7dbbde…`、`client 480034…`；md5 全程 UNCHANGED。完整报告：`D:/Project/AI-NATIVE-01-evidence/p2-tester-transaction-final.md`；门禁：`p2-transaction-final-tester-gate-summary.log`。

**判定：P2 = PASS。** 事务残留（result 校验在 `game.step` 提交后）已关闭。

| ID | 要求 | 结果 |
| --- | --- | --- |
| T1 | 坏 hasher → 结构化 `E_INTERNAL_TRANSACTION` | PASS |
| T2 | 校验失败原子回滚 tick/energy/events/epoch | PASS（tick 0→0） |
| T3 | 同 requestId 重试返回同一失败（非 `E_STALE_TICK`） | PASS |
| T4 | 同 requestId 异 payload → `E_ID_PAYLOAD_MISMATCH` | PASS |
| T5 | rollback 后同 actionId 新请求干净执行（无 action-cache 污染） | PASS（`replayed=false`, tick+1） |
| T6/T7 | 抛异常 hasher 无逃逸、无提交、重试同一失败 | PASS |
| T8 | 失败不驱逐已签发快照、不 bump epoch | PASS（epoch 0→0, restore ok） |
| T9 | `postStateHash === canonicalState(issued snapshot)` | PASS |
| T10 | good-hasher 对照：identical retry 返回原结果、无额外 tick | PASS |

**回归**：此前 49 项探针在新 md5 复跑 **49/49 PASS**（B1–B6、真实 Player 全门桥、owner/Player 拆分、10/2 预算、同批/跨批幂等、`cancelAction`、owner.reset/close/restore 竞态、debug 权限、重复 seed/多 manager、idle/dispose），无退步。

**Gate**：事务探针 10/10、49 回归、`npm run typecheck`、43 定向、真实 `sessionClient.mts`（exit 0）均 PASS；全量 229 与 build 同 md5 引用 developer 日志（未重复全套）；未重跑无关 E2E（slice 未改）。

**实现要点**：runtime 非签发内部接缝 `captureInternalState/restoreInternalState/canonicalStateInternal/eventLog`；sessions 在 `game.step` 前 captureRollback，失败/抛异常时 applyRollback（含 idempotency cache）并返回脱敏错误；request cache 存成功/失败完整响应；`syncEvents`/`postStateHash` 不再逐步签发。

**边界**：未扩 MCP/World/ECHO/旧档、未删/放宽测试、未 commit/切分支；headless；无残留进程。pre-fix 历史保留（§12–§14、`p2-review-final.md`）。

---

## 16. P3 MCP 原始请求幂等残留定向复验（PRE-FIX，BLOCKED）

> 快照：HEAD `5d4fe912…`；`harness f78bfefa…` / `mcpServer c358c10b…` / `mcpClient 755bcd0b…` / `harness.test 8377be06…` / `sessions d9d66875…`；md5 复验前后 UNCHANGED。完整报告：`D:/Project/AI-NATIVE-01-evidence/p3-fix-tester-report.md`；门禁：`p3-fix-tester-gate-summary.log`。

**判定：P3 = BLOCKED（仅 MCP 原始请求幂等残留）。** 官方 SDK 复现：`game_step` / `game_execute_action` 在**省略 `fromTick`/`actionId`**、同一 `requestId`、字节相同工具参数重试时，第二次返回 `E_ID_PAYLOAD_MISMATCH`；tick 未推进。

| ID | 场景 | 结果 |
| --- | --- | --- |
| R1 | `game_step` 同 requestId + 相同参数（省略 fromTick/actionId） | FAIL（step2 `E_ID_PAYLOAD_MISMATCH`） |
| R2 | 重试是否推进 tick | PASS（未推进） |
| R3 | 同 requestId + 不同参数 | PASS（正确冲突） |
| R4 | 对照：显式 fromTick+actionId 重试 | PASS（说明缺口是省略默认被动态补全） |
| R5 | `game_execute_action` 同 requestId + 相同参数（省略 actionId/fromTick） | FAIL |
| R6 | 重试是否推进 tick | PASS |
| R7 | `game_execute_action` 显式 fromTick/targetTick/actionId 重试 | FAIL（`executeAction` 未传显式调度字段，无隐藏绕过） |
| R8 | Dev `game_step` 同 requestId + 相同参数 | FAIL |

**成因**：`harness.step` 每次用当前 tick 补 `fromTick`、未传 `actionId` 时随机生成新 id；Session `payloadFingerprint` 因此变化 → 冲突。P2 下层幂等本身正确，修复不得放宽 `sessions.ts` 指纹校验来掩盖上层补全。

**其余 P3（同 md5，引用通过）**：独立官方 SDK 31/31（Player 6 工具/无 Dev、合法整链 tick 518、P0 DTO、事件分页、Dev 16 工具、fixture 审计、inspect signal/Guard/collision、snapshot/step/restore/replay、scenario/batch 2 seeds×2 strategies、compare、多 session、cancel/timeout、bad handle/cross-session、10/8 预算、stdout 纯 JSON-RPC、无 npm banner、无网络/OS 输入、exit 0）；typecheck / 251 单测 / build / MCP build / client 同 md5 通过。未发现其他真实缺陷。

**修复方向**：Harness/MCP 按 requestId 缓存**原始请求（未补全）→结果**；或强制显式 fromTick/actionId 且缺省拒绝；`game_execute_action` 必须传递显式调度字段。补官方 Client 回归（省略默认参数的同 requestId 重试必须返原结果且不推进）。P3 待 Developer 终态另派定向复验。原 P3 历史保留（`p3-review.md`、`p3-tester-*`）。

---

## 17. P3 MCP 原始请求幂等最终定向验收（PASS）

> 快照：HEAD `5d4fe912…`；`harness 6f119818…` / `mcpServer c358c10b…` / `mcpClient 51fee6a2…` / `harness.test f25c8ab7…` / `sessions 63ee4e3f…` / `runtime 58413a99…`；md5 全程 UNCHANGED。完整报告：`D:/Project/AI-NATIVE-01-evidence/p3-tester-final.md`；门禁：`p3-final-tester-gate-summary.log`。

**判定：P3 = PASS。** MCP 原始请求幂等残留已关闭；此前 31 项回归与新增定向缓存全部通过。

| 组 | 关键结果 |
| --- | --- |
| 原 8 项幂等（R1–R8） | 全部 PASS：`game_step`/`game_execute_action`（Player 与 Dev）在同 requestId + **字节相同**工具参数（省略 fromTick/actionId）下返回原结果、tick 不推进；同 requestId 不同参数仍 `E_ID_PAYLOAD_MISMATCH`；显式值路径同样幂等 |
| 定向缓存（C1–C6） | domain 不冲突；session 隔离；失败动作/请求级失败回执缓存（tick 不变）；fixture 清 epoch 缓存 + 显式旧 epoch `E_STALE_EPOCH`；restore 清缓存且同 requestId 在恢复态重新执行（scan 扣 10、tick+1） |
| 此前 31 项回归 | 全部 PASS（Player 6/Dev 16 分面、合法整链 tick 518、P0 DTO、fixture 审计、inspect、snapshot/restore/replay、scenario/batch 2×2、compare、多 session、cancel/timeout、bad handle、10/8 预算、stdout 纯 JSON-RPC、无 npm banner、无网络/OS 输入、exit 0） |
| Gate | typecheck PASS、29 定向 PASS；258 全量与 build 同 md5 引用 developer 日志（未重复全套）；MCP build PASS；md5 稳定 |

**实现核对**：Harness 以 `(session, epoch, domain, requestId)` 缓存**原始参数**、先查再补默认；domain 隔离映射；失败回执缓存；fixture/restore 清缓存；P2 Session 指纹/事务校验未放宽。

**边界**：未扩 P4/P5、未改主 World/旧档/全局 MCP 配置、未 commit/切分支、未删/放宽测试；`dist-mcp` 为未跟踪生成物未提交。pre-fix 失败历史保留（§16、`p3-review.md`、`p3-fix-tester-*`）。

---

## 18. P3 强制 epoch 契约最终定向验收（PASS）

> 快照：HEAD `5d4fe912…`；`harness 1db66499…` / `mcpServer 83f600c9…` / `mcpClient 475b77c7…` / `harness.test 56e0e6d6…` / `sessions b87fe02f…` / `runtime 58413a99…`；md5 全程 UNCHANGED。完整报告：`D:/Project/AI-NATIVE-01-evidence/p3-tester-epoch-final.md`；门禁：`p3-epoch-final-tester-gate-summary.log`。

**判定：P3 = PASS。** `game_step`/`game_execute_action`（含 advanced）强制 epoch，校验先于缓存/补默认；缺省/非整数拒绝、旧 epoch `E_STALE_EPOCH`；正例带 epoch、省略 fromTick/actionId 的字节相同重试返回原结果且不推进。fixture/restore 递增 epoch（restore = max(prev+1, engine)）；旧/缺/新 epoch 行为符合契约；advanced 无 epoch 无写入。

| 组 | 关键结果 |
| --- | --- |
| A | create/observe 返回 epoch；缺失/非整数 epoch（step/execute_action/advanced）拒绝且无状态改变；旧 epoch `E_STALE_EPOCH` |
| B | 8 项幂等（Player/Dev step、execute_action；带 epoch、省略 fromTick/actionId）全部返回原结果、不推进；同 requestId 不同参数冲突；显式字段控制通过 |
| C | domain/session 隔离；失败动作回执缓存；fixture epoch 0→1 旧拒/缺拒/新执行；restore epoch 1→2 旧拒/缺拒/新执行 |
| D | advanced 无 epoch 无写入；带 epoch 启动后 cancelAction 停 tick、超预算 timeout |
| E/F | 真实 Player 门桥整链 tick 518（每步带 epoch，P0 DTO 通过）；Dev fixture/scenario/batch/compare；stdout 纯 JSON-RPC、无 npm banner、exit 0、无网络/OS 输入 |
| Gate | typecheck PASS、32 定向 PASS；261 全量与 build 同 md5 引用 developer 日志；MCP build PASS；md5 稳定 |

**实现核对**：epoch 在缓存/补默认前校验；MCP schema 强制 epoch；create/observe 返回 epoch；fixture/restore 递增 epoch；原有原始参数缓存与 P2 指纹/事务校验未放宽。

**边界**：未扩 P4/P5、未改主 World/旧档/全局 MCP 配置、未 commit/切分支、未删/放宽测试；`dist-mcp` 未跟踪生成物未提交；未跑浏览器 E2E（slice 未改）。pre-fix 失败历史保留（§16–§17、`p3-review.md`、`p3-fix-tester-*`）。

---

## 19. AI-NATIVE-01 · P4 — 真实外部 Codex Player 执行验收（Tester 只读核实）

**任务**：独立核实 P4 真实执行，不冒充脚本；可审计；开发者修源码期间先交原始执行证据。

**不可变记录**
- `D:/Project/AI-NATIVE-01-evidence/p4-codex-live.jsonl`：600142 B，SHA256 `0ba5cdb4f305527bd9de12e01a987c1dc5d7a2d3bed4c86eb940d418a09aea52`（校验匹配）。
- start `2026-11-12T23:06:59.607Z` → closed `2026-11-12T23:11:17.534Z`（墙钟约 257.9 s）；request 23 / result 22（22 次工具调用 + quit）。
- 桥 `p4-agent-bridge.mjs` 只 import 官方 MCP SDK + `node:readline`/`fs`/`perf_hooks`；无 game/scenario/route/strategy/map import（已读源确认中立）。

**Player-only / 无作弊**
- 工具名仅 Player 6：`game_create_session`×1、`game_observe`×2、`game_execute_action`×4、`game_step`×13、`game_get_events`×1、`game_close_session`×1；无 `run_scenario`/`run_batch`/`inject_fixture`/`snapshot`/`restore`/`inspect_state` 等 Dev 调用。
- 参数无 `seed`/`fixture`/`dev`/`devTicket`/`role`/`kind`；`game_create_session` 参数为 `{}`。
- 17 次 mutation 为模型逐次决策（含 `decision` 自然语言理由，见 `p4-tester-original.md` §4）；非固定脚本、非 `run_scenario`。

**逐条结果（22 调用）要点**
- 决策序列：`scan(E_SCHEMA)→scan(OK)→interact(拒绝)→jam(OK)→move→move→scan→shoot_guard→move→shoot_guard+move→move→interact(relay)→wait(89)→move→move→move→move`。
- 终态：tick **501**、energy **96**、hp **100**、room `station-zero-r2`、passed/crossed/completed = true/true/true。
- 有序公开事件 **29** 条（types：SESSION_CREATED, ACTION_ACCEPTED, ACTION_REJECTED, DOOR_PASSED, ROOM_ENTERED, JAM_EXPIRED, DOOR_STATE_CHANGED, RELAY_STATE_CHANGED, BRIDGE_STATE_CHANGED, GUARD_LINK_CHANGED, SCAN_EVIDENCE_EXPIRED, EAST_CROSSED, RUN_COMPLETED）。

**两处错误 origin（逐字，不掩盖）**
- `E_SCHEMA`：模型请求 `action.payload={}` 缺 `type`（公开 `ActionPayloadV1` 形状错误）→ `step request rejected`；模型用 `payload:{type:'scan'}` 重试成功（tick 1，扣 10 Energy），**无状态写入**。
- `E_LINK_UNAVAILABLE`：普通 `interact targetId=tgt_lab_door_receiver` 被激活的 source→receiver 封条链路按域拒绝（actionResult/rejected，cost 0，actorId `act_508db05fc88ab1a2`，actionId `aid_86de469ae29552d8b62125a6`）；随后 `jam` 合法解封。corridor（R2）阶段无被拒绝动作。
- **嵌套 session 引用（真实边界缺陷，需报告）**：公开 opaque 句柄 `ses_f09b11ac0567951eadd6dccd` 用于 top-level `session`/`sessionId`、`game_get_events` 的 `events[*].sessionId`、`result.sessionId`/`result.actionResults[*].sessionId`；但 **内部 Session.id `ses_8249e0cbadeb5177e10dc4a8`** 泄漏在 `observation.events[*].sessionId` 与 `result.observation.events[*].sessionId`（observation 内嵌事件窗口未走 opaque 句柄）。应修复 observation 事件窗口的 sessionId 归一化，不掩盖。

**独立重放（官方 Player MCP，当前 P3 稳定版 HEAD `ddcd7e9`）**
- `npx vite-node p4-tester-replay.mts`：从原始记录读取决策（type/payload/ticks），在**新建 production session** 上按序执行；不用 developer client、不 `run_scenario`。
- 结果 6/6 PASS：R0 新建 production session；R1/R2 终态一致（tick 501 / energy 96 / HP 100 / crossed+completed / room r2）；R3 有序事件 29 条逐条一致（忽略 opaque 身份 / seedHash）；R4 每条决策 tick 与 action-result code 序列一致（0 diff）；R5 决策序列 Player-only、无 Dev。

**透明度**
- 模型 Token / 内部推理用量：**null（不可获取，不杜撰）**；**未把 22 次工具调用写成 22 次模型调用**。

**Gate 汇总（命令 | PASS/FAIL | 日志绝对路径）**
| 命令 | 结果 | 日志 |
|---|---|---|
| `sha256sum p4-codex-live.jsonl` | PASS（匹配） | `D:/Project/AI-NATIVE-01-evidence/p4-tester-original.md` |
| `node p4-tester-parse.mjs` | PASS | `D:/Project/AI-NATIVE-01-evidence/p4-tester-trace-analysis.json` |
| `npx vite-node p4-tester-replay.mts` | PASS（6/6） | `D:/Project/AI-NATIVE-01-evidence/p4-tester-replay.log` |
| `npm run game:mcp:build`（HEAD ddcd7e9） | PASS | `D:/Project/AI-NATIVE-01-evidence/p4-tester-mcp-build.log` |
| 源码 md5 前后 | PASS | `D:/Project/AI-NATIVE-01-evidence/p4-tester-stability.log` |

**判定**：**P4 原始执行证据 = PASS**（记录不可变、Bridge 中立、Player-only、模型逐次决策、22 调用可逐条对上、终态与 29 事件正确、当前 P3 稳定版可独立重放复现）。发现 1 个需修网关缺陷（observation 事件窗口泄漏内部 `sessionId`），影响 P4 关闭但不影响执行证据真实性；待开发者修复后再做 diff 复验。

**边界**：未 commit/切分支、未改主 World/旧档/全局 MCP 配置、未扩 P4/P5；测试者只读、开发者独写源码；证据全部在 `D:/Project/AI-NATIVE-01-evidence/`（`p4-*`），`dist-mcp` 未提交。

### 19.1 P4 反馈修复 / 交付 — 最终独立验收（修前/修后差异复验）

**判定：PASS**（全部 gate 通过，无 BLOCKED）。

- **源码稳定 MD5**：HEAD `ddcd7e9`（工作区含未提交修复）；Lead 指定 6 文件 MD5 逐一 MATCH（runtime `ca541510…`、sessions `b55541f7…`、server `0f7e5876…`、p4.test `6a92c0e5…`、rules `5f527b78…`、fullState `be780b90…`）；全量快照 `p4-final-source-md5.txt`。
- **原记录不变**：`p4-codex-live.jsonl` SHA256 `0ba5cdb4…` 未改；`p4-codex-live.jsonl.gz` 解压流 SHA256 = `0ba5cdb4…`（一致）。
- **构建/测试矩阵**：typecheck PASS、`npm run build` PASS、`game:mcp:build` PASS；`npx vitest run src/ai-native`（P4 目标）PASS = 5 files / 192 tests；`npm test` 全量 PASS = 11 files / 266 tests；`npx playwright test`（slice/evidence 变更已复跑）PASS = 23 passed（含 `runtime-bugs.spec.ts`）。
- **官方 Player MCP 重放原 trace（修复版）**：`p4-final-tester-replay.mts` 用原不可变 `p4-codex-live.jsonl` 决策，在全新 production session（非 `--dev`、不 restore/run_scenario）重放 → F1 终态 501/HP100/E96/crossed+completed/room r2、F2 29 事件无差异、F3 每条决策 tick/code 序列一致、F4 嵌套 sessionId 统一 opaque（无 `ses_8249…`、无外来 `ses_`）、F5 两处拒绝（E_SCHEMA + E_LINK_UNAVAILABLE）原样复现。
- **5 个真实运行缺陷修复确认**（独立）：`P1` 走廊 `observerPosition` == 当时 `self.position`；`P2`/`P3` evidence `sourceActionId`/`observerActorId` == 实际 scan actionId/公开 actorId；`P4` 走廊 `knownConnections` 投影 `rel_corridor_relay_bridge`/`rel_corridor_relay_perception`。
- **中性客户端/样例/restore 原样**：`agentClient.mts` 仅 6 Player 工具、Dev `game_snapshot` 合法 session 下被拒、stdout 纯 JSONL、退出 0（C1–C6 PASS）；样例 `p4-player-trace.json` 保留 E_SCHEMA 重试（开发者重放 `expectedSchemaFailures:1`）；interact 拒绝样例记作 `status:"rejected"`（与线上 `ok:false/E_LINK_UNAVAILABLE` 口径略异，属采样简化，原 JSONL 未改）；Dev 仅质量验证（p4.test.ts restore 用例在 266 全量内通过），未混入原 Agent。
- **边界**：仅读源码/仓库测试；未 commit/切分支、未改主 World、未扩 P5、未改原 trace；tester 仅追加 `p4-tester-final.md` 与本节。重放仅验证原真实执行，不当作第二次 AI；模型 Token/内部推理仍 null，不杜撰。

---

## 20. AI-NATIVE-01 · P5 — 隔离双 Actor（ECHO co-op）固定版最终验收（Tester 只读）

**任务**：对固定版（HEAD `56e4902`，P5 未 commit）独立完成 P5 最终验收，纳入此前 V1–V5 复核、R1/R2/R3 修复，不等待/轮询。

**判定：PASS**（全部 gate 通过，无 BLOCKED）。报告：`D:/Project/AI-NATIVE-01-evidence/p5-tester-final.md`。

**固定版稳定 MD5（Lead 指定 = 实测，before/after STABLE）**：coop `f2dfe8b1b6b521916fdf25038e33a504`、test `40de8152c8e248eadc058c7f0fab7829`、demo `03cfa101958fc95d348827b8055019cd`、server `5a6f369d2edbd7286aa7f3ab3a667f0c`、rules `96947c32b5879b7c4eeeb327efa38761`、sharedCore `f8ee3a302a6ebc4abb492ba9c428fa32`。

**Gate（命令 | PASS/FAIL | 日志）**：typecheck PASS、`npm run build` PASS、`game:mcp:build` PASS、`npx vitest run src/ai-native/coop.test.ts` 目标 21 PASS、`npm test` 全量 287 PASS、`coopDemo.mts` PASS、P4 replay PASS(5/5)、完整 23 E2E 两次均 PASS(23)；独立直连帧/快照探针 23/23 PASS、官方 Dev MCP 真实双 Actor 探针 27/27 PASS。日志见 `p5-final-tester-*`。

**R1/R2/R3 修复核实**：同 seed 两实例 `instanceId`/`sessionId` 随机且互不相同；A 帧在 B 恢复 → `E_SNAPSHOT_INVALID` 原子拒绝；伪造 `snapshotId`/`instanceId`/`sessionId` 拒绝；篡改 payload 并**重算公有 hash 仍拒绝**（授权用 issued 完整 canonical 串）；共享可选字段仅 `relationId`/`stateLabel`/`position`，空/未知 `E_SCHEMA`、非自有 `E_ILLEGAL_TARGET`、双向裁剪。

**快照语义**：64 淘汰、同一 issued 帧可重复恢复、epoch 单调递增、恢复旧帧后新 confirm 不复活（完整替换）；双 Actor 完整恢复无 alias（恢复后改帧不影响 live）。

**V1–V5**：V1 共享投影裁剪（未选字段脱敏，doc 与实现一致）；V2 `EchoStatus` 仅 `humanActorId`、无 human position/goal/evidence/memory；V3 snapshot 深拷贝；V5 `proposeHypothesis` 深冻结 `deepClone(plan)`；全部经独立反例验证关闭（更早的 pre-fix 初检记录保留于 `p5-fix-tester-lead-findings.log`，不抹除）。

**真实合作链（官方 Dev MCP）**：HumanA 扫 receiver / EchoB 独立扫 seal source（A/B 不同、互不可见）→ echo share 自有子集 → hypothesis 不 canonical → 未确认/拒绝执行 `E_PERMISSION` 零副作用 → human confirm → echo 合法 Jam → door `JAMMED_OPEN` → human 过门 `passed=true`；pause/takeover/cancel 停 ECHO 且 human 可继续、预算耗尽 `E_RESOURCE_LIMIT`、offline 确定性；Player 面仍 6 工具无 coop、P4 replay 不变。

**边界**：只读源码/仓库测试；未 commit/切分支、未扩正式 ECHO/World/旧档/key/version；只写项目外 `p5-final-tester-*` 与本节；fixture 明确 `test:true` 仅初态、不计合作行动。

---

## 21. AI-NATIVE-01 · 最终混合预算小修（Tester 只读独立验收）

**任务**：P0–P5 全部验收后的最后一项小修（共享进程会话预算）；完成后仅剩最终材料/PR 交付。固定版 HEAD `903096ddd1402658d1bf662af2cb9c2b41f04015`（停写）。

**判定：PASS**（无 BLOCKED）。报告：`D:/Project/AI-NATIVE-01-evidence/final-budget-tester.md`，单行 gate 表 `final-budget-tester-gate-summary.log`。

**稳定 MD5（Lead 指定 = 实测，before/after STABLE）**：sessions `409f1f1a…`、coop `f10d1dc4…`、harness `87e64a00…`、server `c35de76e…`、budget.test `81fc9161…`、budgetClient `5ee666ac…`。`src/slice/*` 与 `tests/*` 无改动；`rules.ts`/`sharedCore.ts`/`fullState.ts` MD5 与 P5 终版一致。

**Gate**：typecheck PASS、`npm run build` PASS、`game:mcp:build` PASS、`npm test` 全量 **292**（13 files）PASS、P4 replay PASS(5/5)、`coopDemo.mts` PASS；独立官方 SDK 混合预算探针 `final-budget-tester-sdk.mts` **13/13**、独立直连预算语义探针 `final-budget-tester-direct.mts` **12/12**。纯 Node 预算改动，未重跑浏览器（Lead 明确无需，且无 slice/浏览器变更）。

**独立探针要点**（不依赖 developer `budgetClient.mts`）：单进程一份 `ProcessSessionBudget(10)` 注入 `SessionManager`+`CoopManager`；普通 5+coop 5=10 成功，第 11 个普通/coop 均 `E_RESOURCE_LIMIT`；关闭普通+coop 各归还 slot、跨类型释放成立；非法创建不吃 slot；10 coop 填满后 `run_scenario`/`run_batch` 拒绝且关闭释放后恢复（Harness batch 走真实 slot）；close/dispose 后 10 个新会话全成功、上限仍精确 10、进程释放。直连验证：budget 为普通 per-instance 对象非全局；失败 constructor（Session/CoopSession 构造抛错）不吃 slot；dispose 归还全部 `used→0`；未注入时各 manager 独立预算。

**节点证据映射（不抹除）**：P5 终版 = **287** 单测 + **23 E2E×2**（`p5-final-tester-e2e.log`/`-run2.log`）；本轮 = **292** 单测（+`budget.test.ts` 5 例），无浏览器/slice 变更故 23 E2E 结论继续有效。更早 pre-fix / V1–V5 / P4 历史均保留。

**边界**：只读源码/仓库测试；未 commit/切分支、未扩正式 ECHO/World/旧档/key/version、未改 Lead 最终交付材料；仅写项目外 `final-budget-tester-*` 与本节。
