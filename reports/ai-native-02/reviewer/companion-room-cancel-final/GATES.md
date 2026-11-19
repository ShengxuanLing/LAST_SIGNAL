# 门禁逐行 — 7c0068f 房间世代失效链（独立复核）

被测：`7c0068f6c40cf3059b107260de50cbf0a3c4b9e1`（父 `246469b…`）
快照：`D:\review-cancel\snap`（`git archive 7c0068f`，2045 tracked，blob 比对 diff=0）
本目录：`D:\Project\LAST_SIGNAL\reports\ai-native-02\reviewer\companion-room-cancel-final\`
环境：自有 dev `strictPort 5373`（Playwright 用 `PORT=5373`），用完仅关自己的 vite（已验证 0 残留）；5173 等他人端口未动

| # | 结论 | 门禁 | 实际命令 | 结果 | 日志（绝对路径） |
|---|---|---|---|---|---|
| 1 | **PASS** | 目标 hash + 父提交 | `git rev-parse 7c0068f; git rev-parse 7c0068f^` | `7c0068f6c40cf3059b107260de50cbf0a3c4b9e1`，父 `246469b7…` | 见 #2 同批命令 |
| 2 | **PASS** | 隔离快照 = 提交（逐 blob） | `git archive 7c0068f \| tar -x`；`git ls-tree -r 7c0068f` vs 快照内 `git hash-object` 全量 | **2045 文件，diff 0 行** | `…\tracked-blobs-7c0068f.txt`、`…\tracked-blobs-snapshot.txt` |
| 3 | **PASS** | 类型检查 | `npx tsc --noEmit` | exit 0，0 字节输出 | `…\logs\gate-typecheck.log` |
| 4 | **PASS** | MCP 构建 | `npx vite build --config vite.mcp.config.ts` | exit 0，built in 1.06s | `…\logs\gate-mcp-build.log` |
| 5 | **PASS** | 新增 unit（房界作废语义） | `npx vitest run src/ai-native/companionRoomGeneration.test.ts` | **7/7 passed** | `…\logs\gate-unit-room-generation.log` |
| 6 | **PASS** | Owner/权限最小回归 | `npx vitest run ownerAuth companionBridge worldBridgeServer companionGateway companionFacet companionInsights` | **54/54 passed**（6 文件） | `…\logs\gate-owner-auth-regression.log` |
| 7 | **PASS** | 新房界 E2E（正常路径） | `PORT=5373 npx playwright test tests/companion-room-cancel.spec.ts --project chromium` | **2 passed**（5.7s / 5.9s）：旧建议不确认不执行不扣费、agent 403、新房一次、pause 不作废 | `…\logs\gate-room-cancel-e2e.log` |
| 8 | **PASS** | 合作链回归（确认→提交→过门） | `PORT=5373 npx playwright test tests/signal-coop-e2e.spec.ts --project chromium` | 1 passed（10.8s），STEP1–10；STEP9 记为 `room 3 → -1`（过渡态，不影响） | `…\logs\gate-coop-e2e-regression.log` |
| 9 | **PASS（含 2 条缺陷实测）** | 我的确定性排序探针（无浏览器/无定时器） | `npx vitest run src/zz-probe/roomGeneration.probe.test.ts` | **7/7 passed**：P1 代际单调+同房无 pending 为 no-op；P4 旧对象 decide→E_STALE_GENERATION；P6 墓碑 512 淘汰后仍不可复活；P7 新房观察前不可提议。**P2 实测同房重复+已确认决策→代际仍+1 且收据变 cancelled**；**P5 实测迟到的旧房报告会作废新房合法建议并把 roomId 退回** | `…\logs\probe-room-generation-ordering.log`（源码 `…\roomGeneration.probe.test.ts`） |
| 10 | **PASS（含 1 条边界缺陷）** | 我的 bridge 边界探针 | `npx vitest run src/zz-probe/roomBridgeBoundary.probe.test.ts` | agent（token 无 Origin）→ **403 `world.origin_mismatch`**（handler 拦），对照 `companion-decision` 同形态 → 403 `world.origin_denied`（外层拦）；agent 伪造 Origin / 错 cap → 403 `owner_capability_required`；三次尝试后 `pending` 仍 1；浏览器路径 200 且 pending→0 | `…\logs\probe-bridge-boundary.log`（源码 `…\roomBridgeBoundary.probe.test.ts`） |
| 11 | **FAIL（阻断·在途竞态）** | notify 在途窗口内旧 confirm 是否可执行 | 核对 Tester 原始产物 `reports/ai-native-02/tester/companion-room-cancel-final/13-notify-race.json`、`14-notify-race.log` | R04 `inWindow.ok=true`（窗口内确认成功）；R05 通知到达后 decide 被拒（`E_RETRYABLE decision_exists`）但 receipt 已是 `{"status":"applied","decidedAtTick":40,"appliedTick":45}` → **旧房动作已执行并记为 applied** | `D:\Project\LAST_SIGNAL\reports\ai-native-02\tester\companion-room-cancel-final\14-notify-race.log` |
| 12 | **FAIL（同竞态的账本层孪生，我独立复现）** | 迟到的 markApplied | 我的探针 P3（见 #9） | `decide(confirm)`→ok；`roomChanged`；迟到的 `markApplied` → `E_STALE_GENERATION`，收据变 `cancelled/room_changed/decidedAtTick:null` → 同一物理事件两种真相 | `…\logs\probe-room-generation-ordering.log` |
| 13 | **PASS（源码级）** | 机制链完整性与门序 | 读 `World.ts:713-719`、`GameScene.ts:699-710/449-452/940-946`、`companionLink.ts:139-156`、`worldBridgeServer.ts:124-141/290-300`、`companionGateway.ts:148-155/225-252/284/307`、`companionFacet.ts:536-583/701` | 房界→notify→cap 门→gateway 作废→facet 代际/墓碑/丢观察→suggest 门在观察门之前；`apply` 闭包**无本地房界校验**（竞态根因） | 源码（`D:\review-cancel\snap`，与 #2 同 hash） |
| 14 | **NOT RUN（按指令不重复）** | 全量单测 / Tester 的 resume·checkpoint·CD 恢复 / 我自己的浏览器级人为延迟 notify 探针 | — | 开发者报 734/734；Tester 已覆盖异步竞态（#11）；账本层等价证据已由 P3 提供。**新提交后再做定向异步负向** | `D:\Project\LAST_SIGNAL\reports\ai-native-02\tester\companion-room-cancel-final\` |

## 失败行（最相关错误）

1. **#11 Tester R04/R05（浏览器，4000ms 延迟）**：`FAIL | R05 after notify lands: old confirm refused; status cancelled` —— 最相关字段
   `"receipt":{"suggestionId":"sug_ef11…","status":"applied","decidedAtTick":40,"appliedTick":45}`，
   `"afterNotify":{"ok":false,"error":"E_RETRYABLE companion.decision_exists"}`（即：动作已执行并记账为 applied，房界作废来晚了）。
2. **#12 我的 P3（账本层）**：`markApplied` 迟到 → `E_STALE_GENERATION`，同一 id 的收据为
   `{"status":"cancelled","reason":"room_changed","decidedAtTick":null}` —— 与 #11 互为反序，说明账本缺少“执行代际”维度。
3. **#10 bridge 探针（边界，非阻断）**：agent 无 Origin 得到 `world.origin_mismatch` 而非 `world.origin_denied` → 证明 `/companion-room` 被放进了 token-only 的 `agentRoute` 白名单（`worldBridgeServer.ts:293`），少一层 Origin 门（cap 仍拦得住：3 次尝试后 pending 不变）。
