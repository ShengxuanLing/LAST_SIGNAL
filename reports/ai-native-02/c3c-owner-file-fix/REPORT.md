# C3c Owner 文件 / 响应预算 / 控制台启动 修复（Reviewer A–D）

- 分支 `feat/ai-native-world-integration`；基线 `87d6ae0`（Reviewer 确认旧 canonical/stdio 失败关闭、C3c Player clean、同 core/Dev 功能通过；新增 A–D 文件/预算局限）。
- 本提交是独立小补丁；P3-a 恢复在下一提交开始，两者不混。

## A. Owner 文件 ACL（仅当前用户）

- `secureTokenFile.ts` 新增 `hardenOwnerFile` / `hardenOwnerDirectory`：
  - POSIX：文件 0600、目录 0700。
  - Windows：绝对路径 `System32\icacls.exe`，`/inheritance:r` 去掉继承，目录 `/grant:r *<SID>:(OI)(CI)F`（子文件继承当前 SID），文件 `/grant:r *<SID>:F`。
- `frameExport` 与 `exportFailure` 写完即硬化目录 + 文件，并在结果里返回 `acl`/`aclDir` 说明。
- 回归（`c3cOwnerFile.test.ts`）：Windows `icacls` 断言无 `(I)`、无 `BUILTIN\Users`/`Authenticated Users`/`Everyone`；POSIX 断言 `mode & 0o777 === 0o600`。

## B. junction / symlink 穿越

- `resolveFrameFile` 改为异步：词法校验（非 frames 根、在 frames 下）→ `realpath(base)` 与 `realpath(file)` 再次校验必须位于真实 frames 根 → `lstat` 必须是普通文件且非符号链接 → 大小 ≤ 16MiB。
- `restoreFile`/`replayFile` 都用该解析结果；不做任何递归删除。
- 回归：Windows `mklink /J` junction 指向 frames 外 → `E_PERMISSION / world.frame_path_forbidden`；POSIX symlink 同；frames 根本身被拒绝；合法 root 内普通文件正常。

## C. 512KiB 预算按完整 MCP 结果计费

- `respond()` 现在对完整 `CallToolResult` 计费：`measureMcpResult(result) = Buffer.byteLength(JSON.stringify(result), 'utf8')`，包含 `content[0].text` + `structuredContent` + envelope；超 512KiB 返回 `E_PAYLOAD_TOO_LARGE / world.response_too_large`，不回到 4MB。
- `devEvents` 分页收缩使用**同一**完整结果计费（`EVENTS_PAGE_BYTE_BUDGET`），非 ASCII 也按 UTF-8 计。
- 回归：`measureMcpResult` 对 ASCII vs CJK 断言（CJK 1000 字 → 明显 >2× body）；大事件页 `measureMcpResult ≤ 512KiB`；20k stdio 烟测改为测量完整结果（最大 ~147KB envelope）。

## D. 超大文件读取预检

- `resolveFrameFile` 在 `readFile`/`JSON.parse` 之前 `lstat` 校验 `isFile()` 与 `size ≤ HEADLESS_MAX_FRAME_BYTES (16MiB)`；超限返回 `E_RESOURCE_LIMIT / world.frame_file_too_large`，不读取、不解析。
- 回归：17MiB 文件 → `restoreFile`/`replayFile` 均 `E_RESOURCE_LIMIT`（未进入 parse）。

## 控制台发布脚本修复（Lead 实测发现的启动 bug）

- `scripts/c3b-mcp-console.mts` 的 `stdout.write('...')` 中有一个**真实换行**导致 `Unterminated string literal`（`tsc` 当时不覆盖 `scripts/`）。改为显式 `+ String.fromCharCode(10)`。
- **tsc 覆盖 scripts**：`tsconfig.json` 的 `include` 增加 `scripts`，并修掉 3 个既有脚本类型错误（`c2-loot-pickup-parity` 的 `PlayerData` 导入、`c2-room-generation-parity` 的数组推断、`c3b-world-console` 的 handshake 窄化/重复 `ok`）。今后脚本语法/类型错误会在 `typecheck` 阶段暴露。
- 新增**真实启动烟测** `worldConsoleSmoke.mts`（不是 typecheck/bundle）：
  - `--headless` Player：`create → observe → quit`，进程 `exit 0` 且被 reap；
  - `--headless --dev`：`help` 输出 `create [seed] … step <ticks>`，`create 424242` 成功；
  - Rendered：真实 bridge + human handshake → `help/status/quit`，输出 `CONNECTED console mode=rendered` 与工具帮助，进程 reap。
  - 三路均断言 stderr 无 `Unterminated`。

## 质量门（`reports/ai-native-02/c3c-owner-file-fix/logs/gate.log`）

| 门 | 结果 |
| --- | --- |
| typecheck（含 scripts） | PASS |
| unit | PASS **42 files / 580 tests** |
| build / build:test / MCP | PASS |
| Headless smoke / 20k stdio | PASS（20k 完整结果 max ~147KB） |
| 官方 SDK Player 裁剪/通道负向 | PASS |
| 控制台真实启动烟测（Player/Dev/Rendered） | PASS `WORLD_CONSOLE_SMOKE_PASS` |

## 说明

- Lead 已用冻结 `87d6ae0` 官方 SDK 完成真实模型的 Headless 最小单 drone 遭遇（`reports/ai-native-02/lead-headless-cropped/`，已交 Reviewer）；本报告不再把“真实 LLM 完全未跑”作为结论，但该遭遇只算**最小单次**，不代表完整 Run / P4 文件与 Signal 完成。
- 本补丁只修文件/预算/控制台边界，不改 core 规则；P3-a 在下一提交开始。
- 未 merge/push/stash；C2 维持放行。
