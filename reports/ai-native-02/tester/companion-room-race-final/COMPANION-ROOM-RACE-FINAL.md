# `c233e5c` 跨房旧建议修复独立重跑

**结论：PASS（精确 scope，冻结 `c233e5cfeae0473a70878cb25608d30d88f9c976`，父 `7c0068f`）。** 原 in-flight 竞态已关闭：window 内旧确认同步返回 `E_STALE_GENERATION`，不产生 pending/命令/弹道/耗能；通知后 `cancelled`；new room 可 observe/suggest/确认一次；原 session 不重授权；迟到旧 obs 不污染；迟到确认不复活；迟到 A→B 通知不回滚新房。原 `13-notify-race.json`/`14-notify-race.log` 保留不覆盖；原模型证据不变。

## 冻结

- 目标：`c233e5cfeae0473a70878cb25608d30d88f9c976`（父 `7c0068f6c40cf3059b107260de50cbf0a3c4b9e1`）
- `git archive c233e5c | tar -x` → `D:/Project/AI-NATIVE-02-snapshots/c233e5c`；**2047 文件**
- **tracked blob 比对**：mismatch=0 / 2047；二次解包 diff=0；全量 sha256
- 未改源码/测试/配置/分支，未 merge/push/reset/rebase。自有 dev strictPort 5392，用完仅清理 5392（剩 TIME_WAIT，无 LISTENING）；其他端口（5173/5176/5393/5394/5396/5397/5398）未动；secret 零日志/URL/截图。

## 门禁逐行（完整 `gate-summary.log`）

| 门 | 命令 | 结果 |
|---|---|---|
| 冻结+tracked blob | `git archive c233e5c` + `git hash-object` vs `git ls-tree` | 2047 mismatch=0, diff=0 |
| typecheck | `npx tsc --noEmit` | 0 |
| MCP build | `npx vite build --config vite.mcp.config.ts` | 0 |
| 定向 unit | `vitest run companionRoomBoundary/ companionRoomGeneration/ companionFacet` | 34 passed |
| **cancel2 (2 例)** | `PORT=5392 playwright test tests/companion-room-cancel.spec.ts` | **2 passed** |
| **race3 (3 例)** | `PORT=5392 playwright test tests/companion-room-race.spec.ts` | **3 passed (T1/T2/T3)** |
| **我方 in-flight race rerun (5 项)** | `vite-node probe-notify-race-rerun.mts` | **5/5 PASS**: window 内 old confirm 同步 `E_STALE_GENERATION`，不产生 pending/命令/弹道/耗能；通知后 `cancelled` |
| **signal coop + SDK** | `PORT=5392 playwright test signal-coop-e2e + signal-sdk-negative` | **2 passed** |
| **echo migration** | `PORT=5392 playwright test tests/echo-portal-migration.spec.ts` | **2 passed** |
| **C2 resume** | `PORT=5392 playwright test tests/resume-no-step.spec.ts` | **3 passed** |
| **late-obs / same-room idempotence (7 项)** | `vite-node probe-late-obs-idempotent.mts` | **7/7 PASS**: late old-room obs refused `E_STALE_GENERATION`；same-room repeat no bump；out-of-order report cannot rollback |
| **cross-room old-suggestion negative (fire, 14 项)** | `vite-node probe-cross-room-negative.mts` | **14/14 PASS** (原 246469b X07 已关闭) |
| **screenshot actually viewed** | `read evidence/notify-race.png` | room B: echo next to player, `RELAY ACTIVE ... EXIT OPEN`, `COMPANION CONNECTED` |

## 核心结果：原 `13-notify-race.json` 的 in-flight 竞态已关闭

原 probe（`7c0068f`）在 4000ms notify 延迟窗口内：old confirm → `ok=true`，下一 tick 落 `applied`（decided 40/applied 45），通知到达后已 `applied` 的建议不被取消。

`c233e5c` 重跑同一探针（`14-notify-race-rerun.log` / `13-notify-race.json`）全 5/5 PASS：
- **R04**：窗口内 `decide(old,'confirm')` → `ok=false, error=E_STALE_GENERATION companion.suggestion_room_changed`，**不产生 pending/命令/弹道/耗能**。
- **R05**：通知到达后旧建议 `status:cancelled, reason:room_changed`，**从不 `applied`**。

根因：`onRoomEntered` 现在先**同步**调用 `companionLink.enterRoom(roomId, tick)`（本地 barrier，房变立即生效），再异步发送 `notifyRoom`；延迟到达的 `notifyRoom` 通过 `roomSeq` 与本地 generation 比较，**不回滚新房**（`#sameAuthority` 判定后返回 `false`，旧房通知被丢弃）。`companionLink.decide` 在 `postApplied` 前后均复核 `#sameAuthority`（房/世代/生命周期），迟到的确认拒绝；`markApplied` 带 `execution.generation/roomId`，网关 `markApplied` 校验 `execution.roomId !== record.roomId` 并拒绝。所以窗口内确认在本地同步层就被拒绝，核心永远不收到旧确认。

## 跳过的门（按 Lead 决策）

- **rendered parity**：本轮 **NOT RUN**。补丁只改 `companionFacet/gateway/link/bridge/GameScene`（以及 `World/echoView` 的只读 getter/allowlist 字段），不触 `worldHeadless/signal` 核心；代码实质不相关，按 Lead 决策不重跑全套，不并行全量避免 CPU 争用。

## 精确范围与剩余阻断

- **PASS（精确 scope）**：跨房旧建议正常路径在窗口内同步拒绝（原 X07 彻底关闭）；new room observe/suggest/confirm 一次执行；原 session 不重授权；迟到旧 obs 不污染；迟到确认不复活；迟到 A→B 通知不回滚；同房重复含 confirmed 未 applied、pause/resume 不取消；Agent token 直取消 403；observation memory 是新房。原模型证据不变。
- **剩余阻断**：无。原 X07 正常路径 + in-flight 窗口均已关闭。Lead 可关闭原 `13-notify-race.json`/`14-notify-race.log` 竞态；剩余尚待人验收的是最终产品形态（非模型回合），不要求重跑模型。

## 路径

`reports/ai-native-02/tester/companion-room-race-final/`
`00-freeze.log` / `00-all-files.sha256` / `00-archive-diff.log` / `00-tracked-hash-check.log` / `01-typecheck.log` / `02-mcp-build.log` / `03-unit.log` / `04-companion-room-cancel.log` / `04-race3.log` / `05-cancel2.log` / `07-signal-coop-sdk.log` / `08-portal.log` / `09-resume.log` / `11-cross-room-negative.json` / `12-cross-room-negative.log` / `13-notify-race.json` / `14-notify-race.log` / `13-notify-race-rerun.json` / `14-notify-race-rerun.log` / `09-late-obs-idempotent.json` / `10-late-obs-idempotent.log` / `gate-summary.log` / `evidence/notify-race.png` / `probe-*.mts`
