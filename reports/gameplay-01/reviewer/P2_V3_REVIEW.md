# GAMEPLAY-01 · P2 v3 最终独立复测（只读 + 独立快照运行）

**结论：v2 的 raw-restore 重复窗口已关闭；本轮复核范围内无阻断。P2 v3 = 阶段 PASS（不是整体 GAMEPLAY PASS，不是人类验收）。**
所有脚本都在**独立临时快照** `D:/tmp/gp01-p2v3` 里执行（`git archive 2c4584c` + manifest 10 源 + 自有 `node_modules` junction），日志头部记录了 cwd / 脚本路径 / 源 hash；未使用共享 cwd 生成任何输出，**0 次 Magpie 请求**。

## 0. 冻结

- HEAD `2c4584c`；manifest `source_whitelist` **10/10 SHA256 一致**；`runtime.test.ts` 不在 manifest 且 `git diff 2c4584c -- …/runtime.test.ts` 为空（原 15s/20s 保留）✓。
- 快照内 10 个文件的字节尺寸也与 manifest 一致（`size-mismatch []`）。

## 1. v2 反例精确复跑（同一脚本逻辑）

| 项 | v2（旧） | v3（本轮实测） |
|---|---|---|
| restore 后队列 | queue 1，guard **null** | queue 1，**exact command JSON 完全保留**，guard `restored:true` |
| restore 后 proposal | 可再生成 `local_2_1` | `proposeLocalEcho() = null` |
| restore 后 confirm | **true → queue 2** | **false，`E_ALREADY_PENDING`** |
| 真实 tick | — | `signal-scanned.energy = 90`（100→90，**精确 = SCAN_COST**）；guard 由真实 receipt / 命令离队解除；`pendingAfter = null`；随后 propose 恢复（`local_3_1`）→ **无死锁** |
| toggle | 未测 | `toggle-transport`：queue 1、二次 confirm false、`signal-relay-changed` **恰好 1 次**、manual 翻转一次、audit `applied + proposalId` |

证据：`reviewer/p2-v3/headless-v3.log` 的 `A1_restore/A2_tick/A3_after_settle/B1_toggle`。

## 2. 扩展场景（同一脚本）

| 项 | 实测 |
|---|---|
| 混合命令不误删 | 队列 `[local scan, signal-power]`（2）→ `cancel` 后 **仅剩 `signal-power`（1）**，audit 只记 local 的 `cancelled + proposalId`，随后真实 tick 里 `signal-power` **正常应用**（`signal-relay-changed`）→ 未误删、未把他人命令伪标 `human-local` |
| 未知 raw marker | `pending = {proposalId:null, acceptedTick:null, restored:true}`；confirm → **false `E_ALREADY_PENDING`**；**不捏造授权来源**（audit 只是拒绝记录） |
| 无对应事件也不死锁 | 若无设备使 scan 无事件，命令离队后 guard 自动清（`pending:null, queued:0`） |
| dead echo | `cancelPendingLocalEcho('E_ECHO_DEAD')` → guard 清、audit `cancelled+proposalId`，**其他命令 `signal-power` 保留** |
| room change | 同上（`E_ROOM_CHANGED`），其他命令保留 |
| 真实 Controller 驱动 | 全部经 `proposeLocalEcho / confirmLocalEchoProposal / runSteps`（官方 headless 入口），**没有** `echoIntentOverride` |

## 3. 浏览器单 pending（这次拿到 toggle）

`reviewer/p2-v3/browser.log`（cwd=快照，spec=`_review/pw.p2v3.config.ts`，devRoot=快照:5486，2 passed / 32.2s）

- scan：confirm 后 **queue 1**、`WAITING…local_102_1`、**confirm+reject 都 disabled**、tick/energy 未变；双击（按钮已禁用）+ 直接 same/wrong id → 全 false、queue 1、`E_ALREADY_PENDING`。
- 短 resume 后：**audit `applied @tick103` 带同一 `proposalId`**、queue 0、pending null（"enqueued ≠ applied" 文案行为正确）。
- 第二次在 scanCD=94 时提案为 **`toggle-relay`** → confirm 后 queue 1 → resume 后 **manual true→false 恰好一次**，audit `applied + proposalId` ✓。
- REJECT：`proposal=null`、queue 0、audit `E_USER_REJECTED`、confirm disabled ✓。
- 800×600 spotcheck：`outside=0`、`minCss=10` ✓（v2 已做过 5 视口 10/10；v3 只动 restore guard，UI 未变，故 5 视口沿用 v2 证据 + 本次 800 spotcheck，**不宣称 v3 全 5 视口复跑**）。

## 4. 存档/refres​h 边界（静态核对）

- 真实 `RunCheckpoint.coreState` **不含 `pendingCommands`**，`restoreCheckpoint` 显式 `_sim.pendingCommands = []`。
- checkpoint 在 `onPause` 阶段写入（早于人类确认），因此"暂停确认后刷新/恢复"回到**确认前**的 checkpoint，队列与 guard 都不存在 → **不会产生重复**；同时**已确认未提交的动作会丢失**，这是明确边界。
- `echoAudit` 是运行时环，不写入存档 → **不可能恢复出假 receipt**；UI 文案是 `CONFIRMED · ENQUEUED FOR THE NEXT CORE TICK`，`applied` 由真实 tick 的 receipt 覆盖。
- 该模型与 headless restore（队列会持久）不同，所以 v3 的 restored-marker 只在 headless/parity 侧需要，语义正确。

## 5. 其它已核对（代码 + 本轮 98 条 targeted 单测）

- 生产 Player 面无 confirm/dev 字段；external `actor:'echo'` 仍 `E_PERMISSION`（`externalLink.test.ts` / `ownerAuth.test.ts` 在快照内 **PASS**）。
- memory 16/600 只收 `echo-perception`；`echoAudit` 独立环不被 `suggest/decide` 读取（代码 + `echoCoop` 单测）。
- 低风险 OFF/旧 save OFF/HOLD 优先/开关撤销只清自主（代码 + `SaveSystem.echoCoop` 单测）。

## 6. Gate（一行一条）

| 命令（均在独立快照 cwd 执行） | 结果 | 日志 |
|---|---|---|
| `npx vite-node _p2v3.mts`（A–E 全部场景） | **PASS**（A1/A2/A3/B1/C1/C2/D1/D2/E1/E2 均符合预期） | `D:/Project/LAST_SIGNAL/reports/gameplay-01/reviewer/p2-v3/headless-v3.log` |
| `npx vitest run echoCoop worldHeadlessEchoCoop SaveSystem.echoCoop runtime.test ownerAuth externalLink` | **PASS**（6 files / **98 tests**） | `D:/Project/LAST_SIGNAL/reports/gameplay-01/reviewer/p2-v3/unit-targeted.log` |
| `PORT=5486 npx playwright test -c _review/pw.p2v3.config.ts --workers=1` | **PASS**（2 passed / 32.2s） | `D:/Project/LAST_SIGNAL/reports/gameplay-01/reviewer/p2-v3/browser.log` |

## 7. 未独立验证（不计入 PASS）

1. **fresh Rendered↔Headless parity**：developer 的 `final-v3/fresh-parity-export.log`（23:07）+ `fresh-parity-gate.log`（3 passed）存在且时间晚于源冻结，但**我没有独立生成**新的导出/新目录复跑 → 记为"dev 证据，未独立验证"。
2. **完整 794**：未跑（Lead 指定不重复全量；Tester 将跑全链）。
3. **5 视口全量复跑**：只做 800×600 spotcheck，其余沿用 v2（UI 未变）。
4. **拒绝矩阵逐项**：TTL / stale id / generation / 目标不可见 / nonhuman / 死亡 / 低能 / cooldown —— 由 98 条 targeted 单测覆盖（PASS），但**没有我自己的独立场景**逐项复现。
5. **真实 Magpie ECHO 链**：本轮 **0 次模型请求**（按指示，等安全验收后由 Lead 派固定预算链）。

## 8. 阶段判定与下一步

- **P2 v3：阶段 PASS**（raw-restore 关闭 + 单 pending 在 Rendered 浏览器与 headless 双路径均成立）。仍然**不是**整体 GAMEPLAY PASS：P3/P4/P5、真实模型 ECHO 链、人类验收均未完成 → `HUMAN ACCEPTANCE PENDING`。
- 安全验收通过后，真实 Magpie ECHO 链的最小计划（供 Lead 派单）：
  1. 环境：独立快照 cwd + 独立端口；模型仅 `group/elisa`；**≤12 次请求 / 每次 ≤1024 tokens / 显式 wall clock**；失败保留不重试。
  2. 链路：`echo_observe`（正式投影）→ 模型输出严格 JSON `{decision:'accept'|'reject'|'wait'}` 或直接选择 Owner 可见的 proposal → **Owner 确认由 fixture 点击完成并标注 fixture**（绝不称人类）→ 真实 core tick → 记录 `signal-scanned/jammed/relay-changed`、energy、relay、audit 的 `proposalId`。
  3. 反向：模型不可 confirm（无该工具）；断线/无 bridge 时 UI 显示 OFFLINE，但仍可走 local 人工确认路径（不伪造 CONNECTED）。
  4. 记录：请求 id/延迟/usage、模型可见观察、选择、真实结果与 tick；不保存内部 reasoning。

---

## 9. 最终复测（committed `87a0fac` 独立快照，P3 已开始后）

Lead 已把 v3 冻结为 **`87a0fac`**；P3 只做显示、但共享工作树会混版本，所以我在**新的独立快照**里重跑了全部关键门禁：

- 快照：`git archive 87a0fac` → `D:/tmp/gp01-p2v3-final`（自有 `node_modules` junction），cwd = 快照，dev root = 快照:5487；日志头记录 cwd/spec/hash。
- **内容一致性**：`git diff --stat 87a0fac -- <10 sources>` = **空**（内容与 v3 manifest 10 源完全一致）。唯一 hash 差异是 `src/ai-native/echoCoop.test.ts`（manifest `e05b488a…` vs archive `3a7dfd88…`）—— **纯 CRLF 差异**（git 内容 diff 为空），与 §0 的 GameScene CRLF 现象同类，**不是内容或版本差异**。
- 快照内 hash 首尾记录：运行前后 `echo.ts / worldHeadless.ts / World.ts / PauseScene.ts` hash **完全不变**（未改动快照）。

| 命令（cwd = `D:/tmp/gp01-p2v3-final`） | 结果 | 日志 |
|---|---|---|
| `npx vite-node _p2v3.mts` | **PASS**（A1/A2/A3/B1/C1/C2/D1/D2/E1/E2 **与 2c4584c+manifest 跑法逐项一致**） | `reviewer/p2-v3/headless-v3-87a0fac.log` |
| `npx vitest run echoCoop worldHeadlessEchoCoop SaveSystem.echoCoop runtime.test ownerAuth externalLink` | **PASS**（6 files / **98 tests**） | `reviewer/p2-v3/unit-87a0fac.log` |
| `PORT=5487 npx playwright test -c _review/pw.p2v3.config.ts --workers=1` | **PASS**（2 passed / 28.5s；scan 单 pending + toggle 单翻 + reject + 800×600 spotcheck） | `reviewer/p2-v3/browser-87a0fac.log` |

**最终结论（committed 87a0fac）：P2 v3 阶段 PASS** —— v2 的 raw-restore 重复窗口确认关闭（队列保留/不伪造来源/只执行一次/Rendered 与 headless 双路径一致）；Rendered 单 pending、cancel 精确移除、真实 checkpoint 与 rawsim 语义差异均如 §1–§4 所述。仍**不是**整体 GAMEPLAY PASS，也**不是**人类验收（`HUMAN ACCEPTANCE PENDING`）；fresh parity / 完整 794 / 5 视口全量 / 拒绝矩阵逐项 / 真实 Magpie ECHO 链仍未独立验证（同 §7）。
