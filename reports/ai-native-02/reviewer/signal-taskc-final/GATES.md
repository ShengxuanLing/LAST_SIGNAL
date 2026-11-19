# Task C（Signal）最新阶段门禁 — 独立复核（continuation）

- 被测冻结：`363eb173207bb5adaa0a21cd1af348dc92f29827`（分支 `feat/ai-native-world-integration`）
- 复核者：独立 worker `mmxu9qr3pny4jua138sycuoq`（接续中断会话 `e64cb79a-…`，不重试其历史）
- 复核时间：2026-11-16（本机 Windows，Node v24.20.0，vitest 2.1.9，Playwright 1.65.0）
- 隔离方式：`git archive 363eb17` → `D:\review-tc-final\snap`（2039 tracked 文件），`node_modules` 用 junction 指向工作区依赖；**不读 WIP/stash，不 merge/push/reset，不 kill 他人进程**
- dev server：**自有 strictPort 5371**（`npx vite --port 5371 --strictPort`，root = 隔离快照）
- 所有 Playwright spec 通过 `PORT=5371` 使用上述端口

## 冻结一致性

| 结论 | 检查 | 命令 / 结果 | 产物 |
|---|---|---|---|
| PASS | 快照 = 提交（逐 blob） | `git ls-tree -r 363eb17`（2039 条）vs 快照内 `git hash-object` 全量比对 → `diff` 0 行 | `D:\Project\LAST_SIGNAL\reports\ai-native-02\reviewer\signal-taskc-final\tracked-blobs-363eb17.txt`、`…\tracked-blobs-snapshot.txt` |
| PASS | 工作区无漂移（复核前后） | `git status --porcelain -uno` → 0 行；复核结束后重新 `git ls-tree -r HEAD` 比对 → 完全一致 | 同上（`tracked-blobs-363eb17.txt`） |

> 说明：工作区 tracked 内容与 363eb17 逐字节相同（所有未提交内容均为 `??` 未跟踪产物），因此我在隔离快照内跑的一切等价于在冻结 hash 上跑。

## 门禁逐行

| # | 结论 | 门禁 | 实际命令（cwd = `D:\review-tc-final\snap`） | 结果 | 日志（绝对路径） |
|---|---|---|---|---|---|
| 1 | **PASS** | 类型检查（冻结快照全仓） | `npx tsc --noEmit` | exit 0，无输出（0 字节） | `D:\Project\LAST_SIGNAL\reports\ai-native-02\reviewer\signal-taskc-final\logs\gate-typecheck-snapshot.log` |
| 2 | **PASS** | MCP 服务端构建 | `npx vite build --config vite.mcp.config.ts` | exit 0，built in 1.36s，产出 `dist-mcp/{worldMcpServer,companionMcpServer,worldHeadlessMcpServer}.mjs` | `…\logs\gate-mcp-build-snapshot.log` |
| 3 | **FAIL（预期红，证明不是假绿）** | 干净 archive 缺 parity 产物时必须红 | `npx vitest run src/ai-native/signalRenderedHeadlessParity.test.ts`（快照内 `reports/ai-native-02/signal/parity/` 不存在） | exit 1，3/3 用例失败（缺文件测试 + 重放 + 负向） | `…\logs\gate-parity-clean-archive-red.log` |
| 4 | **PASS** | 真实浏览器导出 parity 三件套（快照内重新生成） | `PORT=5371 npx playwright test tests/signal-rendered-parity.spec.ts --project chromium` | 1 passed（6.4s）；`initial.json` 2,431,934 B / `sequence.json` 80,749 B / `rendered.json` 108,312 B | `…\logs\gate-parity-export.log` |
| 5 | **PASS** | Rendered→Headless 字节级重放（硬门禁） | `npx vitest run src/ai-native/signalRenderedHeadlessParity.test.ts` | 3/3 passed（含“缺文件必红”与“actor 翻转必须分歧”） | `…\logs\gate-parity-replay.log` |
| 6 | **PASS** | 全量单测（快照，parity 产物已就位） | `npx vitest run` | 59 文件 / **713 passed (713)**，167.51s | `…\logs\gate-vitest-full.log` |
| 7 | **PASS** | 真实 Signal 合作链 UI E2E | `PORT=5371 npx playwright test tests/signal-coop-e2e.spec.ts --project chromium` | 1 passed（10.2s）；10 个 STEP 全过，9 张截图生成 | `…\logs\gate-coop-e2e.log` |
| 8 | **PASS** | 官方 MCP SDK 权限矩阵 | `PORT=5371 npx playwright test tests/signal-sdk-negative.spec.ts --project chromium` | 1 passed（9.6s） | `…\logs\gate-sdk-matrix.log` |
| 9 | **PASS** | 4 文件 5 用例合跑（含 Companion/Owner 旧攻击回归） | `PORT=5371 npx playwright test tests/signal-coop-e2e.spec.ts tests/signal-rendered-parity.spec.ts tests/signal-sdk-negative.spec.ts tests/p3b-companion-owner.spec.ts --project chromium` | **5 passed**（28.0s） | `…\logs\gate-suite-4files.log` |
| 10 | **PASS** | 独立隐藏 relay 负向（复核者自写探针，快照内） | `npx vitest run src/zz-probe/echoViewSignal.probe.test.ts` | 7/7 passed：超出半径 / 未探索 / 墙后 → 无 relay；relay 只含 `{id,x,y,state}`（无 `powered`/`manualEnabled`/`jammedUntilTick`）；`objectiveBlocked` 仅“感知到且非 ACTIVE”；energy/cooldowns 为 echo 自身账户；伪造多余字段被 `isEchoObservation` 拒绝 | `…\logs\probe-echoview-hidden-relay.log`（探针源码 `…\signal-taskc-final\echoViewSignal.probe.test.ts`） |
| 11 | **PASS** | 独立 portal→“实际下一房”（复核者自写探针，快照内） | `PORT=5371 npx playwright test tests/zz-portal-probe.spec.ts --project chromium` | 1 passed：room `0 → 3 → 5`；INACTIVE 时 interact 后房间不变（负向），ACTIVE 后进入**具体** 5 号房（非 `-1` 过渡态） | `…\logs\probe-portal-next-room.log`（探针源码 `…\signal-taskc-final\zz-portal-probe.spec.ts`） |
| 12 | **NOT RUN** | 真实 LLM（模型）驱动的 Signal 回合 | — | 本轮全部建议均为 fixture；不宣称“模型完成 Signal 协作” | — |
| 13 | **NOT RUN** | 真人（非自动化点击）Owner CONFIRM 验收 | — | Playwright `mouse.click` 走真实 UI 与真实 ownerCap，但不是真人 | — |
| 14 | **NOT RUN** | 多 seed Signal 批次的独立门禁 | — | 该批次只包含在全量单测内，未做成独立 Playwright/npm 门禁（按 Lead 指令不扩张） | — |
| 15 | **NOT RUN** | 跨机器/跨 OS 复跑 | — | 全部数据来自本机 Windows 单 worker | — |

## 复核过程中发现的非阻断问题（不影响本轮放行口径，但应记录）

1. **`src/ai-native/echoView.ts` 的新 Signal 投影没有任何单元测试**：`src/ai-native/echoView.test.ts` 只覆盖 drone/target 裁剪，`signal`/`energy`/`cooldowns` 三分支 0 覆盖（`grep "signal:" src/ai-native/echoView.test.ts` → 0）。功能正确性由我用探针 #10 独立证明，但冻结提交内缺这条回归，建议后续补 `echoView.test.ts` 用例（隐藏 relay 负向最该进仓库）。
2. **headless `world_action` 的 v2 scan/jam 缺 `actor==='echo'` 拒绝**：`src/ai-native/worldHeadlessMcpTools.ts:420-425` 把 `na.actor ?? 'player'` 直接入队，而渲染侧 `src/ai-native/externalLinkController.ts:313-322` 会 `E_PERMISSION` 拒绝。当前非 dev 的 headless player 会话没有任何创建 Relay 设备的入口（`spawn-signal-device` 仅来自渲染 World 的 opt-in 或 `HeadlessWorld.enableSignalDevice` / dev 工具），所以**今天不可达**；属于纵深防御缺口，不是可利用漏洞。建议在 headless 分支补齐同一拒绝并加用例。
3. **`worldProtocol.ts:175-177` 注释与实现不符**：注释写“v1 客户端请求 scan/jam 必须收到 `E_VERSION_UNSUPPORTED`”，实际 `worldActionSchemaV2` 要求 `actor`，v1 形状得到 `E_SCHEMA`（SDK 矩阵测试 1 断言的也是 schema 拒绝）。关键性质（不静默重解）成立，只是错误码与注释不一致。
4. **合作链 E2E 的两处断言偏弱**（产品行为已被我的探针 #11 补齐）：① 过门断言只等 `currentRoomId !== roomBefore`，实测拿到的是过渡态 `-1`，而我在探针里等到具体房间 5 才断言；② 第 10 步只断言 `echo_status` 返回 ok，没有校验 `receipts[]` 的 `confirmed(decidedAtTick)`/`applied(appliedTick)`（该账本只在单测 `companionGateway.test.ts:136` 覆盖）。另：toggle-relay 队列断言精确到 1 条，scan 队列只断言“存在”，未断言恰一次。
5. **既有 nit（非本轮 delta）**：`companionFacet.ts:57-58` 的 `availableActions` 里写的 reason `'perceived_target'` 不在 `COMPANION_REASONS` 枚举内（来自 `f16741a`，早于本 delta），仅为提示文案字段，不影响 `echo_suggest` 校验。

## 复现最短路径（在隔离快照或干净 archive 内）

```powershell
cd D:\review-tc-final\snap           # 或任意 git archive 363eb17 的目录（需可解析 node_modules）
npx tsc --noEmit
npx vite build --config vite.mcp.config.ts
npx vite --port 5371 --strictPort    # 另开终端保持
$env:PORT=5371
npx playwright test tests/signal-rendered-parity.spec.ts --project chromium   # 先生成三件套（缺则必然红）
npx vitest run src/ai-native/signalRenderedHeadlessParity.test.ts             # 再重放
npx vitest run                                                               # 713/713
npx playwright test tests/signal-coop-e2e.spec.ts tests/signal-sdk-negative.spec.ts tests/p3b-companion-owner.spec.ts --project chromium
```

顺序不可颠倒：`reports/ai-native-02/signal/parity/*.json` 是 **untracked**，不在冻结快照内；干净 archive 直接跑全量单测必然红（门禁 #3 就是这条证据）。
