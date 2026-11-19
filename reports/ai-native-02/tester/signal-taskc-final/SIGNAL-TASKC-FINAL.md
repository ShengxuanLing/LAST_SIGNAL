# Task C `363eb17` 独立端到端定向验收

**结论：PASS（精确 scope，当前阶段）。** 三个新 spec（signal-coop-e2e / signal-rendered-parity / signal-sdk-negative）与必要最小回归（companion-owner、C2 resume/storage、Owner 攻链）全部独立通过；parity 三件套实际重新导出后重放字节一致，缺文件不假绿，改 actor 确会分歧；五视口 Signal/两账户 HUD 真实查看并留截图。

## 冻结

- 目标：`363eb173207bb5adaa0a21cd1af348dc92f29827`（父 `4b2ab0d175af46a988325b526ffd56104e5b7626`；链 `5037c82 → 4b2ab0d → 363eb17`）
- HEAD 于冻结时同目标值；工作区 WIP 未读取、未使用
- `git archive 363eb17 | tar -x` → `D:/Project/AI-NATIVE-02-snapshots/363eb17`；**2039 文件**
- **tracked 文件 hash 比对**：`git ls-tree` blob sha1 vs `git hash-object --stdin-paths`（应用 git eol 过滤器）→ **mismatch=0 / 2039**（`00-tracked-hash-check.log`；CRLF 工作区被 git filter 归一后与 blob 完全一致）；二次解包 `diff -rq` 零差异（`00-archive-diff.log`）；全量 sha256（`00-all-files.sha256`）
- 未改生产源码/测试/配置/分支，未 merge/push/rebase，未读 WIP/stash。自有服务 dev strictPort 5392，用完仅清理 5392，其他端口（5173/5176/5393/5394/5396/5397）未动。产物 token/ownerKey/cap 扫描零命中；Agent 仅 token/lease。

## 门禁逐行（完整 `gate-summary.log`，全部 PASS）

| 门 | 命令 | 结果 |
|---|---|---|
| 冻结+tracked hash | `git archive` + `git hash-object` vs `git ls-tree` | 2039 文件 mismatch=0，diff=0 |
| MCP build（先） | `npx vite build --config vite.mcp.config.ts` | exit=0 |
| typecheck | `npx tsc --noEmit` | exit=0 |
| **signal-coop-e2e** | `PORT=5392 npx playwright test tests/signal-coop-e2e.spec.ts` | **1 passed**（10 步） |
| **signal-rendered-parity 导出** | `PORT=5392 npx playwright test tests/signal-rendered-parity.spec.ts` | **1 passed**；重导 initial/sequence/rendered |
| **parity 重放+分歧负向** | `npx vitest run src/ai-native/signalRenderedHeadlessParity.test.ts` | **3 passed**（字节一致；改 actor 分歧） |
| **parity 缺文件不假绿** | 移走三件套后 `-t "FAILS when parity product files are missing"` | **FAIL expected 3 to be 0**（非 skip），已还原 |
| **signal-sdk-negative** | `PORT=5392 npx playwright test tests/signal-sdk-negative.spec.ts` | **1 passed** |
| 隐藏 relay 负向 | `npx vite-node probe-hidden-relay.mts` | **5/5 PASS** |
| companion-owner 回归 | `PORT=5392 npx playwright test tests/p3b-companion-owner.spec.ts` | **2 passed** |
| C2 resume 回归 | `PORT=5392 npx playwright test tests/resume-no-step.spec.ts` | **3 passed** |
| C2 storage/checkpoint | `PORT=5392 npx playwright test tests/checkpoint.spec.ts -g "resume reuses the checkpoint id and restores saved HP"` | **1 passed** |
| Owner 攻链 | `npx vite-node probe-owner-attack.mts` | **19 SECURE / 0 VULNERABLE** |
| 五视口 HUD | `npx vite-node probe-viewports.mts` | **5/5 PASS**（800×600~1920×1080） |

## 真实合作链（signal-coop-e2e，10 步全过）

1. 默认 NEW RUN：无 relay 设备，HUD `RELAY OFF · NO DEVICE`。
2. Pause → Settings → `SIGNAL COLLABORATION · OFF` 点击 → 面板显示 `· ON`（显式 opt-in）→ BACK 关闭。
3. 真实房间进入（opt-in 已开）：World 自发生成唯一 `relay_main`，`INACTIVE`、manual OFF、powered、exit CLOSED、player/echo 各 100。
3b. **INACTIVE 真挡门**：玩家在门口交互，房间号不变（portal 拒绝）。
4. Pause UI 真实 masked 表单授权 Companion（owner key from host fixture），`CONNECTED`。
5. 官方 Companion SDK `echo_observe` 真实感知 `relay_main INACTIVE`，携 echo 自有能量 100/100。
5b. **fixture suggest `toggle-relay`**（非 LLM），Owner UI CONFIRM 在暂停态**只入队** 1 条 `toggle-relay`（无提前状态写）。
7. 恢复后下一真实 core tick 提交：relay `ACTIVE`，gated exit open。
8. **fixture suggest `scan`** → Owner CONFIRM → 恢复 → 下一真实 tick 只扣 **echo** 账户 100→90，human player 账户未扣。
9. **真实 portal 转场**：ACTIVE 下玩家门口交互 → room 3→5。
10. `echo_memory` / `echo_status` 全链后仍可用；无 console/page 错误。

## Parity（实际重导 → 重放 → 负向）

- 重新运行 rendered 导出，覆盖生成 `initial.json` / `sequence.json` / `rendered.json`（时间戳新生）。
- vitest 重放：`canonicalState` 与 `canonicalEvents` **字符串级字节一致**；relay/manual/powered/echoEnergy 一致；signal-scanned/jammed/relay-changed 事件齐全。
- **缺文件不假绿**：移走三件套后 `missing===0` 断言 FAIL（`expected 3 to be 0`），非静默 skip；已还原。
- **改动作应分歧**：负向用例把首个 signalCommand 的 `actor` 翻转（echo↔player），canonicalState 必不相同 → PASS。

## 官方 SDK 负向/正向矩阵（signal-sdk-negative）

- v1 形 `{type:'scan'}`（缺 actor）→ 工具 schema `isError=true`，**不扣费/不入队/无 receipt**。
- `actor:'echo'` 从外部 Player 侧 → 渲染控制器 **`rejected:E_PERMISSION`**，player/echo 账户都不扣、无队列消费、relay 不变。
- `actor:'player'` scan → 真实提交，player 采样最低 ≤ 100-10，echo 恒 100，CD>0，队列清零。
- `actor:'player'` jam → 真实付费 ≤100-25；`jammedUntilTick>tick`、manualEnabled 仍 false、powered 仍 true、relay `JAMMED`（不 ACTIVE）、echo 恒 100。
- jam 到期 → relay 回到 `INACTIVE`（保持 manual OFF、powered 不变、echo 未被玩家动作扣费）。

## 隐藏 relay 负向（probe-hidden-relay，5/5）

`buildEchoObservation`：范围内+已探索+LOS → relay 上报；**超范围 / 未探索 / 无 LOS / 无设备 → relay 字段缺失**（echo-only 知识，不泄露隐藏设备）。

## 五视口 HUD（5/5）

800×600 / 1024×768 / 1280×720 / 1366×768 / 1920×1080 实际渲染：HUD 显示 `RELAY ... | e:100 p:91 echoScanCD:0t/jamCD:0t playerScanCD:1xx t/jamCD:0t`，两账户独立、CD 以 tick 单位 `t`；截图 `evidence/hud-*.png`。

## 夹具/边界（不冒充盲测）

- **coop-e2e**：用 `w.player.reset(portal.wx, portal.wy)` 把玩家放到门口、`w.player.requestInteract()` 直接触发交互（非盲走位）；但门控本身真实（INACTIVE 拒绝 / ACTIVE 放行）。
- **sdk-negative**：`injectDevice` 直接写 `w._sim.signal = {...}`（夹具注入，非自然 opt-in spawn）。
- **parity spec**：在 `page.evaluate` 内直接 `w.stepFrame(...)` 驱动（夹具驱动，非实时帧）。
- spec 清存档用 `lastSignal.save.v1`，实际 key 为 `last_signal_save_v1`（fresh context 无存档，不影响默认无设备；记为观察）。
- Signal 建议均为**夹具（fixture）**，非模型、非真人确认。

## 历史 LLM 上下文（不写成“从未跑 LLM”）

历史已有 **Rendered/Headless Player 最小模型遭遇** 与 **d690848 ECHO 两轮模型建议**的独立确认（见既有各轮报告）。本轮 Signal 建议是夹具，不是模型输出，也不是真人确认；两者不混淆。

## 精确范围与剩余阻断

- **可发布（精确 scope）**：Task C Signal 合作链的真实 UI 流程（opt-in → 设备 → INACTIVE 门控 → Companion 观察 → 夹具建议 → Owner 确认只入队 → 恢复提交 → echo 独立扣能 → 真实 portal 转场 → obs/memory/status）；Rendered→Headless Signal parity 字节一致与负向；官方 SDK v1/echo/player 权威矩阵；隐藏 relay 负向；五视口 HUD；companion-owner / C2 resume/storage / Owner 攻链不回归。
- **剩余阻断 / 未覆盖**：① 真实 LLM 逐轮建议（本轮为夹具，Lead 侧另有两轮模型击杀证据，不在本单）；② 合作/parity 之外的全架构未重跑（按指示）；③ 上述夹具边界（玩家定位/设备注入/stepFrame 驱动）不构成盲测；④ spec 存档 key 与实际 `last_signal_save_v1` 不一致（观察，非阻断）。

## 路径

`reports/ai-native-02/tester/signal-taskc-final/`
`00-freeze.log` / `00-all-files.sha256` / `00-archive-diff.log` / `00-tracked-hash-check.log` / `01-mcp-build.log` / `02-coop-e2e.log` / `03-parity-export.log` / `04-sdk-negative.log` / `05-parity-replay.log` / `06-parity-missing.log` / `07-companion-owner.log` / `08-c2-resume.log` / `09-owner-attack.json` / `10-c2-storage.log` / `11-viewports.json` / `12-viewports.log` / `13-hidden-relay.json` / `14-hidden-relay.log` / `15-typecheck.log` / `gate-summary.log` / `evidence/coop/*.png` / `evidence/hud-*.png` / `evidence/{initial,sequence,rendered}.json` / `probe-*.mts`
