# C3-c canonical / 传输 最后定向验收（87d6ae0）

- **被测提交**：`87d6ae026bdafa8fef0350dcc91a84d9974b9db1`（HEAD），父 `b3b0e00`；功能 `f5629ef`（canonical）、`3058348`（截断 flag）、`b3b0e00`（transport budget）
- **分支**：`feat/ai-native-world-integration`；未读/不恢复 WIP/stash；未改源/测试/配置/分支
- **快照**：`git archive` 冻结 `D:/Project/lastsignal-c3c-transport-review-87d6ae0`；Python git blob SHA1 全量比对 → `ALL_TRACKED_FILES_MATCH`（1863/1863）
- **结论：旧两个失败（canonical 键序、stdio 超限）已关闭；新增 3 类文件/预算边界阻断（Owner 文件 ACL 过宽、junction/symlink 穿越、512KiB 预算未含 text+structured）。** C3c Player 通道本身干净；P4 最低 Dev 的文件/预算边界需修复或明确限制。

## 一、质量门一行结果（命令 → 结果 → 路径）

| 门 | 命令 | 结果 | 路径 |
|---|---|---|---|
| 快照哈希 | Python blob SHA1 全量比对 | **PASS** 1863/1863 | `tree.ls` |
| 类型检查 | `npm run typecheck` | **PASS** exit=0 | `gate-typecheck.log` |
| 定向 unit（canonical/export/boundary/MCP） | `npx vitest run ...` | **PASS** 29/29 | `gate-unit.log` |
| 官方 stdio 20k 烟测 | `vite-node src/ai-native/worldHeadless20kSmoke.mts` | **PASS**（eventTotal 101635, retained 20000, truncated, export replayable=false） | `gate-20k-smoke.log` |
| 独立 canonical/transport/ref 探针 | `vite-node reviewer-probe-transport.mts` | **PASS** 22/22；envelope/body=2.12 | `gate-probe-transport.log` |
| 官方 SDK Player/Dev 工具面 | `vite-node reviewer-probe-sdk-tools.mts` | **PASS** 13/13 | `gate-probe-sdk-tools.log` |
| 独立 file/ACL 探针 | `vite-node reviewer-probe-files.mts` | **FAIL（确认 3 类新增阻断）** | `gate-probe-files.log` |

## 二、旧两个失败：已关闭

### 1. canonical 键序 / 数组 / 精度 —— PASS
- `canonicalSimulationState` / `canonicalSimulationEvents` 改用 `canonicalJson`：递归对象键按 Unicode code point 排序、数组保序、数值保留 IEEE-754（`JSON.stringify`，`-0→0`，非有限/函数/循环拒绝）。
- 独立 probe：`{b,a}` 与 `{a,b}` canonical 相同；嵌套同；`[1,2]≠[2,1]`；`1e-15≠2e-15`；同值相等。`canonicalStability.test.ts` 另覆盖 state/playerData 重建 key order、transport→restore、数值篡改。
- boundary frame sorted 序列化 → 新 session restore 同动作：独立 probe 跨 session ref restore 后 `canonicalState`/`canonicalEvents` 与源 session 完全一致；未知 ref 拒绝。PASS。

### 2. stdio 超限 / 大响应 —— 功能 PASS（预算语义见下）
- 20k 官方 stdio 烟测：11 次 step×1000 tick，eventTotal **101,635**、retained **20,000**、windowStart 81,635、truncated；tail page/lostPrefix/nextCursor 正确；最长 **text 69,666B**，连接不断。
- `world_headless_step` 不再内联 canonicalState/canonicalEvents（只有 hash + ≤64 事件 tail）；`snapshot` 只返回 ref + size/hash/truncation；Dev 大历史通过 `dev_events` 分页 / ref / frame 文件。
- 传输预算：`respond` 512KiB、`devEvents` 384KiB body + 分页收缩；实际大响应被 ref/文件/分页替代。PASS（但见阻断 C）。

## 三、新增阻断/边界（需修复或明确限制）

### A. Owner 文件 ACL 过宽（frame/failure 文件）
- `frameExport`/`exportFailure` 用 `writeFile(file, text, 'utf8')`，未设置 0600/icacls；实测两文件继承：
  ```
  BUILTIN\Administrators:(I)(F)
  NT AUTHORITY\SYSTEM:(I)(F)
  NT AUTHORITY\Authenticated Users:(I)(M)
  BUILTIN\Users:(I)(RX)
  ```
  `BUILTIN\Users:(I)(RX)` 意味着同机其他普通用户（Player 若为独立 OS 用户）可读 frame（内含 seed/map/events）。与 Lead 要求“Owner 文件 ACL 不得 Player 读取”不符。
- 修复：复用 `secureTokenFile` 的 icacls/0600 逻辑（Windows `/inheritance:r` + 仅当前 SID；POSIX 0600），或把 frames 目录创建为仅当前 SID。

### B. junction/symlink 穿越（file 路径）
- `resolveFrameFile` 仅 `resolve(path)` + `startsWith(base+sep)`；不调用 `realpath`/`lstat`。实测在 `reports/.../c3c/frames/` 下创建 junction 指向外部目录，`restoreFile('.../frames/link/frame.json')` **成功读取并 restore**（`ok:true, epoch:2`）。
- `..` 穿越、外部绝对路径、大小写变体、invalid JSON 均被拒绝；但 symlink/junction 未拒绝。
- 修复：`realpath` 后再次校验必须位于 frames 目录，并 `lstat` 拒绝 symlink/junction；`readFile` 前 `stat` 限制大小。

### C. 512KiB 预算未包含 text+structured 整体开销
- `respond()` 只测 `canonicalJson(body).length`；MCP `CallToolResult` 同时含 `content[0].text`（body 的 JSON 字符串）与 `structuredContent`（同一 body），实际 envelope ≈ 2×。独立实测：body 137,617B → envelope **291,866B（2.12×）**。
- 20k 烟测的 `maxResponseBytes` 也只取 `text.length`，不含 `structuredContent`。若 `devEvents` body 接近 384KiB（EVENTS_PAGE_BYTE_BUDGET），envelope 可 ~815KiB > 512KiB。
- 当前实际大响应被 ref/分页压到 ~70KB text（~140KB envelope），未触发 4MB 限制；但“512KiB 预算真正包含 text+structured”未成立。
- 修复：对完整 `CallToolResult`（text+structured）计费，或把 body 预算设为 256KiB 并文档化；烟测同步测 envelope。

### D. 超大文件读取无预检（resource）
- `restoreFile`/`replayFile` 直接 `readFile`+`JSON.parse`，之后 `applyRestore` 才检查 `canonicalJson(frame).length > 16MB`。20MB 文件实测 61ms 被拒，但无 `stat` 预检；超大文件可耗内存/CPU。
- 修复：读取前 `stat` 限制 ≤ `MAX_FRAME_INGRESS_BYTES`/16MB。

## 四、已通过（无阻断）

- **精确截断**：`isHistoryTruncated(total, retained) = total > retained`；恰好 20k → false，20,001 → true；导出 `replayable = boundary && !truncated`；实测 20k 截断导出 `replayable:false` 且 note 明确“HISTORY TRUNCATED”；truncated snapshot 仍带 ref + `eventsTruncated:true`；restore 可恢复完整 future state（epoch 3）但历史不完整。
- **ref 边界**：LRU≤2、未知 ref 拒绝、跨 session ref restore 成功且同动作 canonical/events 一致（新 session 需要跨 session，符合任务）；16MB ref 上限逻辑存在（单帧上限）。
- **Player 工具面**：官方 SDK 非 Dev 仅 `create/list/observe/action/step/close/signal`，无 `_dev_`、无 `ref`/`path`、step 无 `intent`；Dev 有 ref/file/paging 工具，`restore` 有 ref/frame，`replay_file` 有 path。
- **文件路径**：`..` 逃逸、外部绝对路径、大小写变体、invalid JSON 均拒绝（junction 除外，见阻断 B）。
- **C3c Player 通道**：canonical/输出/时长/ledger/history/mid-run replay/transport 均通过；Player 无文件/ref/path 工具。

## 五、判定与放行范围

- **旧两个失败（canonical 键序、stdio 超限）：关闭。**
- **新增阻断 A/B/C/D**：文件 ACL 过宽、junction 穿越、512KiB 预算未含 envelope、超大文件无预检。A/B 属 owner 文件安全边界；C 属预算契约；D 属资源边界。
- **C3c Player**：Player 工具面无 ref/path/Dev，canonical/transport 均通过；若 Lead 接受 A–D 作为 **Dev/owner-only 修复项**（不阻塞 Player 通道），C3c Player 可放行；否则先修 A/B（安全）与 C（预算）再放行。
- **P4 最低 Dev**：real combat/perf/batch/parity/20k/ref/paging 功能通过；但在 A/B/C/D 修复或明确限制（frames 目录 ACL、symlink 拒绝、预算按 envelope、文件 stat 预检）前，不建议宣称 P4 Dev 文件/传输边界完全 PASS。
- **Signal Combat：未实现**（`E_NOT_APPLICABLE`，未伪造）→ **AI-NATIVE-02 整体仍不能 PASS**。
- **真实 LLM 最小遭遇**：已在 `reports/ai-native-02/reviewer/lead-live/REVIEW.md` 独立确认；本轮不重开无关架构。

## 六、报告目录

`reports/ai-native-02/reviewer/c3c-transport-final/`：`REVIEW.md`、`tree.ls`、`gate-typecheck.log`、`gate-unit.log`、`gate-20k-smoke.log`、`gate-mcp-build.log`、`gate-probe-transport.log`、`gate-probe-sdk-tools.log`、`gate-probe-files.log`、`probe-transport.mts`、`probe-sdk-tools.mts`、`probe-files.mts`。

未修改生产源码/已有测试/配置/分支；未合并/重置；未读取/恢复共享 WIP/stash。
