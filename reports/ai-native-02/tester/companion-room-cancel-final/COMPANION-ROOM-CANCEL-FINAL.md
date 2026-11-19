# `7c0068f` 跨房旧建议修复独立重跑验收

**结论：原 X07 正常路径缺陷已关闭（CLOSE）；但发现 1 处残留“notify 在途窗口”异步竞态（及时回报）。** 新 portal 退役旧建议 2 例、我方 fire 负向 14 项、signal coop/SDK、echo 迁移、C2 resume 全 PASS；关掉"正常路径可随时误执行"的旧缺口；残留竞态仅在取消通知尚未到达桥的窄窗口内可复现。

## 冻结

- 目标：`7c0068f6c40cf3059b107260de50cbf0a3c4b9e1`（父 `246469b7d7e82bb469f62f80f293b0702af46588`）
- HEAD 于冻结时同目标值；WIP 未读；不覆盖原 `246469b` 失败 JSON/日志（保留于 `reports/ai-native-02/tester/signal-field-fix/`）
- `git archive 7c0068f | tar -x` → `D:/Project/AI-NATIVE-02-snapshots/7c0068f`；**2045 文件**
- **tracked blob 比对**：`git ls-tree` vs `git hash-object --stdin-paths` → **mismatch=0 / 2045**；二次解包 `diff -rq`=0；全量 sha256
- 未改源码/测试/配置/分支，未 merge/push/reset/rebase。自有 dev strictPort 5392，用完仅清理 5392（剩 TIME_WAIT，无 LISTENING），其他端口（5173/5176/5393/5394/5396/5397/5398）未动；secret 零日志/URL/截图。

## 门禁逐行（完整 `gate-summary.log`）

| 门 | 命令 | 结果 |
|---|---|---|
| 冻结+blob 比对 | `git archive` + `git hash-object` vs `git ls-tree` | 2045 mismatch=0, diff=0 |
| typecheck | `npx tsc --noEmit` | 0 |
| MCP build | `npx vite build --config vite.mcp.config.ts` | 0 |
| 定向 unit | `vitest run companionRoomGeneration/ insights/ facet` | 39 passed |
| **新 companion-room-cancel 2 例** | `PORT=5392 playwright test tests/companion-room-cancel.spec.ts` | **2 passed** |
| **重跑我方跨房负向（fire）14 项** | `vite-node probe-cross-room-negative.mts` | **14/14 PASS** |
| **notify 在途窗口竞态** | `vite-node probe-notify-race.mts` | **FAIL（4000ms 窗口内旧确认仍执行）** |
| signal coop + SDK | `playwright test signal-coop-e2e + signal-sdk-negative` | 2 passed |
| echo 迁移 | `playwright test tests/echo-portal-migration.spec.ts` | 2 passed |
| C2 resume | `playwright test tests/resume-no-step.spec.ts` | 3 passed |
| rendered parity | — | **NOT RUN**：补丁只动 companionFacet/gateway/link/bridge/GameScene，不触及 worldHeadless/signal core，本轮非实质相关 |
| 截图实际查看 | `read evidence/room-b-after-fix.png` | room B 正常（见下） |

## 原 X07 正常路径：已关闭（我方 fire 负向 14/14）

`probe-cross-room-negative.mts`（真实 bridge + 官方 Companion SDK + 真实 masked 表单 + 真实 portal；夹具：置玩家门口、直开 relay，已披露）：

1. X02 room A 未确认 `fire` 建议（generation 0）。
2. X05 真实 portal A→B（room 0→3）。
3. **X06**：过门后 `echo_status` pending **不含旧 id**，receipt `{status:'cancelled', reason:'room_changed'}`，`status.roomId===B`。
4. **X07**：持有旧对象 `decide(old,'confirm')` → **`E_STALE_GENERATION companion.suggestion_room_changed`**，下一 tick **无弹道**（echoProj 0）、**不耗能**（echoEnergy 100→100）、**无 pending 意图/无 signal 命令**。
5. **X08**：旧 id 重复 `echo_suggest` → `E_STALE_GENERATION`（不复活）。
6. **X09**：旧 id `postApplied` → `E_STALE_GENERATION`（迟到 applied 不产生幻影执行）。
7. **X10**：Agent token 直连 `POST /world-link/companion-room` → **403**（Agent 不能取消 Owner 工作）。
8. **X11**：过门后 observation **memory 全在新房**（旧房坐标条目 0）。
9. **X12/X13/X14**：新房 observe → 新 suggest（`roomId=B, generation=1`）→ Owner confirm → 下一真实 tick **一次执行**（receipt `applied`，decided 102 / applied 107，pending 清空）。

新 spec `tests/companion-room-cancel.spec.ts` 两例亦 PASS：真实 portal 退役旧建议（无 stale confirm/无执行、agent 403、新房一次）+ **pause/resume 无房变不取消**（同房通知幂等）。

## ❌ 残留竞态：notify 在途窗口内旧确认仍落 core（及时回报）

`probe-notify-race.mts`：把渲染端 `POST /world-link/companion-room` 用 Playwright route **确定性延迟 4000ms**，在窗口内（真实 portal 已提交、取消通知尚未到达桥）执行 `decide(old,'confirm')`：
- **R04 FAIL**：窗口内 `ok=true, pending=true`（旧建议被确认并入队）。
- 下一 tick 消费 → 该建议以 **`applied`** 落账（decided 40 / applied 45）。
- **R05**：通知到达后 `roomChanged` 只取消 `confirmed 且 applied!==true` 的决定；此例已 `applied:true`，**不会被取消**，旧确认执行存活。再次 confirm 返回 `E_RETRYABLE decision_exists`。

**性质**：`GameScene.onRoomEntered` 以 `void link.notifyRoom(...)` **异步 fire-and-forget** 报告房变，房变提交与取消之间非原子。正常本地回环窗口约 1–5ms（人手点击不可能命中），但桥负载/慢链路会放大。**建议**：房变提交时在本地同步标记 generation（或在 `decide` 前校验本地当前房与建议房一致性），使窗口内确认也立即 `E_STALE_GENERATION`。**这是需开发者确认/修复的残留，不阻塞“正常路径 X07 已关闭”的结论。**

## 精确范围与结论

- **X07 原缺陷（正常路径）**：**已关闭**。可在报告中把原 246469b 的 X07 FAIL 标记为“已修复/关闭（7c0068f）”，保留原失败证据不覆盖。
- **残留阻断**：notify 在途窗口竞态（`14-notify-race.log` / `13-notify-race.json`），窄窗口、需异步房变取消原子化才彻底消除；已及时回报。
- **PASS 范围**：新 cancel 2 例、fire 负向 14 项、signal coop/SDK、echo 迁移、C2 resume、memory 新房、agent 403、pause/resume 幂等、核心 unit 39。原模型最小 Signal 事实不变，本轮未再声称 LLM。parity 本轮 NOT RUN（非实质相关）。

## 路径

`reports/ai-native-02/tester/companion-room-cancel-final/`
`00-freeze.log` / `00-all-files.sha256` / `00-archive-diff.log` / `00-tracked-hash-check.log` / `01-typecheck.log` / `02-mcp-build.log` / `03-unit-room-generation.log` / `04-companion-room-cancel.log` / `05-signal-coop-sdk.log` / `06-echo-migration.log` / `07-resume.log` / `11-cross-room-negative.json` / `12-cross-room-negative.log` / `13-notify-race.json` / `14-notify-race.log` / `gate-summary.log` / `evidence/room-b-after-fix.png` / `evidence/notify-race.png` / `probe-*.mts`
