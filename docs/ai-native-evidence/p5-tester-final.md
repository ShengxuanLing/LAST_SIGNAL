# P5 FINAL — 隔离双 Actor（ECHO co-op）固定版独立验收

> Tester 只读独立验收（不跑/不复用 developer demo 作为唯一依据）。固定版 HEAD `56e4902044a3dae94c6b7cca1d7eceb46b29a947`（P5 未 commit）。

## 0. 判定

**P5 固定版最终验收 = PASS**（全部 gate 通过，无 BLOCKED）。

Lead 指定的 6 个固定版 MD5 逐一匹配；typecheck / build / MCP build / 目标 21 / 全量 287 / demo / P4 replay / 完整 23 E2E（两次）全绿；独立直连探针（帧/快照/共享/状态 23 项）与官方 Dev MCP 真实双 Actor 探针（27 项）全绿；R1/R2/R3、64 淘汰、重复合法 restore、epoch 单调、旧确认不复活、双 Actor 完整恢复无 alias、V1/V2/V3/V5 全部关闭；Player 6 工具不变、P4 replay 不变；稳定 MD5 前后一致。

## 1. 稳定 MD5（固定版，编辑已停）

| 文件 | MD5（Lead 指定 = 实测） |
|---|---|
| `src/ai-native/coop.ts` | `f2dfe8b1b6b521916fdf25038e33a504` |
| `src/ai-native/coop.test.ts` | `40de8152c8e248eadc058c7f0fab7829` |
| `src/ai-native/coopDemo.mts` | `03cfa101958fc95d348827b8055019cd` |
| `src/ai-native/mcpServer.ts` | `5a6f369d2edbd7286aa7f3ab3a667f0c` |
| `src/slice/rules.ts` | `96947c32b5879b7c4eeeb327efa38761` |
| `src/slice/sharedCore.ts` | `f8ee3a302a6ebc4abb492ba9c428fa32` |

稳定证据：`p5-final-tester-md5-before.log` 与 `p5-final-tester-md5-after.log` 逐行一致（STABLE）。

## 2. Gate 汇总（命令 | PASS/FAIL | 日志绝对路径）

| 命令 | 结果 | 日志 |
|---|---|---|
| Lead 6 文件 MD5 比对 | PASS（逐一 MATCH） | `D:/Project/AI-NATIVE-01-evidence/p5-final-tester-md5-before.log` |
| `npm run typecheck` | PASS | `D:/Project/AI-NATIVE-01-evidence/p5-final-tester-typecheck.log` |
| `npm run build` | PASS | `D:/Project/AI-NATIVE-01-evidence/p5-final-tester-build.log` |
| `npm run game:mcp:build` | PASS | `D:/Project/AI-NATIVE-01-evidence/p5-final-tester-mcp-build.log` |
| `npx vitest run src/ai-native/coop.test.ts`（目标 21） | PASS（21/21） | `D:/Project/AI-NATIVE-01-evidence/p5-final-tester-targeted.log` |
| `npm test`（全量） | PASS（12 files/287） | `D:/Project/AI-NATIVE-01-evidence/p5-final-tester-full.log` |
| `npx vite-node src/ai-native/coopDemo.mts` | PASS | `D:/Project/AI-NATIVE-01-evidence/p5-final-tester-demo.log` |
| `npx vite-node p4-final-tester-replay.mts`（P4 replay） | PASS（5/5） | `D:/Project/AI-NATIVE-01-evidence/p5-final-tester-p4-replay.log` |
| `npx playwright test`（完整 23 E2E，首次） | PASS（23 passed） | `D:/Project/AI-NATIVE-01-evidence/p5-final-tester-e2e.log` |
| `npx playwright test`（完整 23 E2E，复跑） | PASS（23 passed） | `D:/Project/AI-NATIVE-01-evidence/p5-final-tester-e2e-run2.log` |
| `npx vite-node p5-final-tester-frames.mts`（直连帧/快照/共享/状态） | PASS（23/23） | `D:/Project/AI-NATIVE-01-evidence/p5-final-tester-frames.log` |
| `npx vite-node p5-final-tester-coop.mts`（官方 Dev MCP 真实双 Actor） | PASS（27/27） | `D:/Project/AI-NATIVE-01-evidence/p5-final-tester-coop.log` |
| 稳定 MD5 前后 | PASS（STABLE） | `D:/Project/AI-NATIVE-01-evidence/p5-final-tester-md5-after.log` |

**首次 E2E 失败核查**：本次完整 23 E2E **首次即通过**（`p5-final-tester-e2e.log`，23 passed），复跑亦通过（run2）；未发现可复现的 E2E 失败，未通过扩大 wait 掩盖。开发者侧的完整 23 E2E 记录（`p5-architecture-playwright-smoke.log`，`EXIT_CODE: 0`）亦为通过。

## 3. 独立探针结果（固定版）

### 3.1 帧/快照/共享/状态（直连，`p5-final-tester-frames.log`，23/23 PASS）
- **R1 随机 instance/session**：同 seed 两实例 `instanceId`/`sessionId` 不同（`inst_…`/`ses_…` 随机）；A 的帧在 B 恢复 → `E_SNAPSHOT_INVALID`（instance 不匹配），B 状态不变（原子）。
- **R2 签发绑定/全串校验**：伪造 `snapshotId` → 拒绝；伪造 `instanceId`/`sessionId` → 拒绝；**篡改 payload 并重算公有 `publicHash` 仍拒绝**（授权用 issued 存的完整 canonical 串，不用 32bit 公有 hash）。
- **R3 共享白名单**：`SHARE_FIELDS = [relationId, stateLabel, position]`；`fields=[stateLabel]` 仅投 `stateLabel`（`position` 被置 `{0,0}` 脱敏、`relationId` 缺省）；空 `fields` → `E_SCHEMA`；未知字段 → `E_SCHEMA`；非自有目标 → `E_ILLEGAL_TARGET`；双向（human→echo）同样裁剪。
- **64 淘汰 / 重复合法 restore / epoch 单调 / 旧确认不复活**：第 65 个之前的帧被淘汰 → 恢复拒绝；同一 issued 帧可重复恢复；恢复 `epoch` 严格递增（1→2）；恢复旧帧后，更新的 confirm **不复活**（完整替换 hypotheses，状态回到 `proposed`）。
- **完整双 Actor 恢复无 alias**：tick/双方 position/evidence/hypotheses 与帧一致；恢复后再改帧（push memory/evidence、改 position）**不影响** live 会话（深拷贝）。
- **V1 投影** / **V2 EchoStatus 无 human 私有字段**（仅 `humanActorId`）/ **V3 snapshot 深拷贝** / **V5 plan 深冻结**（`deepFreeze(deepClone(plan))`，外部改动无效）全部 PASS。

### 3.2 官方 Dev MCP 真实双 Actor（`p5-final-tester-coop.log`，27/27 PASS）
- Player 面仅 6 工具、**无** `game_coop_*`；Dev 面 9 个 coop 工具齐全。
- 真实链：Human 扫设备 A（receiver）/ Echo 独立扫设备 B（seal source）→ 各自只见自己；`echo share` 仅共享自有设备 → `proposed` 不 canonical → 未确认/已拒绝执行 `E_PERMISSION` 且**零副作用**（door/energy 不变）→ human confirm → echo 合法 Jam → door **JAMMED_OPEN** → human 过门 `passed=true`；事件 actor 明确（human/echo）。
- ECHO management（pause/resume/takeover/release）全部 `E_PERMISSION`；ECHO 无法伪造 human confirm。
- pause→`E_PAUSED`、takeover→`E_PERMISSION`、cancel→`E_CANCELLED` 均停止 ECHO，human 仍可继续；预算耗尽 `E_RESOURCE_LIMIT`，human 不受影响；offline 决策确定性（同一观察→同一提案，无 LLM）；多实例隔离；dev 进程释放。

## 4. 历史（不抹除）

- 更早轮次 V1–V5 曾阻断（pre-fix）：`p5-fix-tester-lead-findings.log` 记录了当时对 `fields` 记录式白名单 / Companion.status / snapshot 浅引用 / restore 无校验 / plan 可变的初检（部分为对早期读码的复核，后经固定版逐项反例验证关闭）。
- 固定版针对 R1/R2/R3 与 V1/V2/V3/V5 的修复经本轮独立反例验证全部关闭。更早的 pre-fix 日志（`p5-developer-*` = 52d7425a/15/281）保留，不抹除。

## 5. 边界与透明度

- 只读源码/仓库测试；未 commit/切分支；只写项目外 `p5-final-tester-*` 与自有报告；未扩正式 ECHO/World/旧档/key/version。
- Player 6 工具与 P4 Player replay 不变；coop 工具仅 `--dev` 注册，Player 面不可选择。
- fixture 明确 `test:true`，仅初态，不计为合作行动（创建时事件数为 0）。

## 6. 结论

P5 固定版经独立验收 **PASS**：Lead 指定 6 个固定版 MD5 匹配且稳定；构建/typecheck/目标 21/全量 287/demo/P4 replay/完整 23 E2E（两次）全绿；R1/R2/R3、64 淘汰/重复 restore/epoch 单调/旧确认不复活、完整双 Actor 恢复无 alias、V1/V2/V3/V5 全部经独立反例验证关闭；真实 HumanA/EchoB 合作链、权限/暂停/接管/取消/预算/offline 全部符合；Player 6 工具与 P4 replay 不变。无 BLOCKED 项。
