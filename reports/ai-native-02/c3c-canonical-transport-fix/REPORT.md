# C3c 修复：canonical 稳定投影 + 官方 stdio 传输预算

- 分支 `feat/ai-native-world-integration`；基线 `dcb4f14`（Tester 确认历史 immutable / 20→15 PASS，剩 canonical 键序 + 4.7MB stdio 关闭两项）。
- P3 源码扩展按 Lead 决定**暂停**；本轮只修 C3c canonical/transport，P3 WIP 不混入。
- 三个小提交：`f5629ef`（canonical）、`3058348`（export flag）、本提交（transport budget）。

## 1. canonical 稳定投影（`f5629ef`）

- `src/world/sim/core.ts`：`canonicalSimulationState` / `canonicalSimulationEvents` 改用项目 `canonicalJson`（递归排序键、数组保序、数值全精度、不圆整）。
- 根因：旧实现用 `JSON.stringify`，`player.data` 的键**插入顺序**参与哈希；同值对象经一次 sorted 传输（MCP `structuredContent` / 文件）再 restore 后键序不同 → `sameState=false`（Tester 定位 char 174）。
- 修复后：同值任意键序 → 同一 canonical 字符串/fingerprint；数值改动 1e-9 仍能区分；数组顺序改变会改变哈希。
- 回归 `canonicalStability.test.ts`（6）：键序无关、不同构键序等值、精度 1e-9、数组保序、boundary frame 经 sorted 传输→restore→同动作 state/events 相同、数值篡改负向。
- 因 canonical 语义修正，按新语义重生成 C2/C3c parity 夹具（`c2/parity/*`、`c2-fixes-round2/parity-kill/*`、`c3c/parity/rendered.json`），node 8/8、kill 13/13、room 220、loot、c3c 16/16 全 PASS。

## 2. export `replayable` 窄口（`3058348`）

- `replayable = action-boundary && !真实历史截断`。
- 精确截断谓词 `isHistoryTruncated(eventTotal, retained)`：`==` 不截断，`>` 才截断（恰 20k 不误报）。
- `eventTotal` 进入 owner frame（snapshot/restore/fromFrame），`snapshot`/`replay`/`exportFailure` 使用同一阈值。
- 截断时 `note` 明确 `HISTORY TRUNCATED … not a full reproduction`，`replayable:false`，frame 不打可恢复标记。
- 回归 `c3cExportFlag.test.ts`（5）：20000/20001 谓词、短 boundary 可重放、mid 不可重放、>20k 真实战斗 boundary 导出 `replayable:false`、截断 snapshot 标记。

## 3. 官方 stdio 传输预算（本提交）

Tester 实测 Dev `step` 每次回完整 `canonicalEvents`，~4.68MB / ~17.1k tick 时 `MCP -32000 Connection closed`。修复：

- **Dev step 不再回全量 canonical**：返回 `stateFingerprint` / `eventsFingerprint` + `eventTotal`/`eventsRetained`/`eventsTruncated` + **有界事件尾窗（64）** + `nextCursor`。Player step 仍是合法裁剪事件尾窗。
- **事件分页**：`world_headless_dev_events_summary`（total/retained/windowStart/truncated/hash）与 `world_headless_dev_events(offset,limit)`（schema/offset/requestedOffset/limit/total/retained/windowStart/truncated/lostPrefix/nextCursor/items）。`offset < windowStart` 时**显式**返回 `lostPrefix`，不静默丢 prefix；页大小受字节预算自动收缩。
- **C >= 4MB 的 frame 不再上线**：`snapshot` 返回 `frameref_*`（进程内有界 LRU，最多 2 个/16MB）+ `frameBytes`/截断标记/hash，**不内联 frame**；`restore`/`replay` 接受 `ref`（优先）或 ≤512KiB 内联 frame；`frame_export` 写 owner-only 文件返回路径；`restore_file`/`replay_file` 只接受 `reports/ai-native-02/c3c/frames/` 下的路径（Player 永远拿不到）。
- **响应硬预算** `MAX_RESPONSE_BYTES = 512KiB`：`respond()` 对每个结果做字节检查，超限返回 `E_PAYLOAD_TOO_LARGE / world.response_too_large`（带字节与提示），绝不发接近 SDK 上限的消息。
- `inspect`/`dev_state` 返回小的 canonical STATE + hashes；事件历史只经分页。
- 回归：
  - `worldHeadlessTransport` 行为内嵌于更新后的 `worldHeadlessMcp`/`snapshotBoundary`/`crop`/`exportFlag` 测试：step 无 canonical、hash 存在、尾窗 ≤64、分页 cursor/truncated/lostPrefix、snapshot ref、restore ref、frame 文件、超限内联拒绝。
  - **官方 stdio 20k 长流量** `worldHeadless20kSmoke.mts`：真实 Dev MCP 子进程，8 drone 波次，11×1000 tick：连接**不死**（单响应最大 ~21KB 步进 / ~70KB 汇总），`eventTotal=101635`、`retained=20000`、`windowStart=81635`、`truncated=true`；tail 页 offset/nextCursor 正确；`offset=0` 报 `lostPrefix=81635`；boundary snapshot `eventsTruncated=true`、frame 6.3MB 文件导出、`restore_file` 成功（状态完整、历史窗显式截断）；`exportFailure` `replayable:false` + `HISTORY TRUNCATED`；wall ≈ 9.8s。

## 4. 质量门（`reports/ai-native-02/c3c-canonical-transport-fix/logs/`）

| 门 | 结果 |
| --- | --- |
| typecheck | PASS |
| unit | PASS **41 files / 574 tests** |
| build / build:test / MCP 三入口 | PASS |
| 官方 SDK Player 裁剪/通道负向 | PASS `PLAYER_CROP_NEGATIVE_PASS`（Dev 步骤现为 hash/ref/文件） |
| Headless MCP smoke（含 refs/历史 replay） | PASS `HEADLESS_MCP_SMOKE_PASS` |
| 官方 stdio 20k 长流量 | PASS `HEADLESS_20K_STDIO_PASS`（单响应 ≤70KB） |
| Rendered↔Headless parity 16 | PASS 16/16 |
| C2 parity room/node/kill/loot | PASS |
| C2 存档/resume 定向 | PASS |
| 默认 MCP / `--world` smoke / lease / token ACL / F-03 | PASS |
| C3b 定向 repeat ×3 | PASS **48/48** |
| 全量 E2E（五视口 + C2） | PASS **69/69** |

日志：`canonical.log`、`exportflag.log`、`transport.log`（各一行 PASS/FAIL + 命令 + 结果 + 路径）。

## 5. 剩余边界 / 不声称

- 本组修复仍待独立 Reviewer/Tester 定向复核；通过前 C3c/P4 不放行，P3 实现继续冻结（Lead 后续单独放行）。
- 事件历史 `20k` 是显式保留窗口：`eventsTruncated`/`lostPrefix`/`windowStart` 会如实报告丢失前缀；不声称完整历史可重放。
- 跨进程恢复 20k+ 事件 frame 只能经 owner 文件（`frames/`）；内联 MCP frame 上限 512KiB。
- Signal 未实现（`E_NOT_APPLICABLE`）；未新增 Energy/scan/jam。
- 未 merge/push/stash；C2 维持放行。
