# P3-b Owner 授权修复（87ab379）独立验收报告

**总结论：部分通过 / 暂不可整体发布。** 安全边界（Reviewer B1）已修复并经独立攻击链复验成立；但真实生产表单 Owner 配对与 UI 重授权存在 wiring 缺陷，`echo_status` MCP 工具回归。精确 scope 见下。

## 冻结与门禁

| 项 | 结论 | 命令 / 证据 |
|---|---|---|
| 目标解析 | PASS | `git rev-parse 87ab379` = `87ab3797d9fbcf08293649cf3137250245ee8ee9`；父 `1b0dca0f71eea5eba0cc708bd216d84b00451c41`；HEAD 冻结时同值（`00-freeze.log`） |
| 独立冻结 | PASS | `git archive 87ab379 \| tar -x` → `D:/Project/AI-NATIVE-02-snapshots/87ab379`；2030 文件（与 `git ls-tree` 数一致）；`00-all-files.sha256` 全量 sha256；二次解包 `diff -rq` 零差异（`00-archive-diff.log`） |
| typecheck | PASS | `npx tsc --noEmit` → 0（`02-typecheck.log`） |
| unit | PASS | `npx vitest run` → **57 files / 673 tests**（`02-unit.log`） |
| prod build | PASS | `npx vite build` → 0（`03-prod-build.log`） |
| MCP build | PASS | `npx vite build --config vite.mcp.config.ts` → 0（`04-mcp-build.log`） |

未读 WIP/stash；未改源/测/配置/分支；未 merge/commit。端口 dev `5392`、bridge `8904`，自起自停。Owner key 由生产 helper `createOwnerCredentialFile()` 写入独立私有文件（当前 SID ACL），仅进程内读入；token/ownerKey/ownerCap 未出现在任何日志、参数、URL 或截图（`grep` 扫描产物零命中）。

## 一、B1 攻击链重验（原 probe 按新契约改写）

命令：`cd snapshots/87ab379 && npx vite-node .../probe-b1-attack-v2.mts` → **19/19 SECURE，0 VULNERABLE**（`01-attack-recheck.json`）。

| 原漏洞项 | 当前结果 |
|---|---|
| X2 re-authorize 覆盖 Owner | 403 `companion.owner_capability_required`；旧 cap 仍有效（X10 200） |
| X4 假 observation | 403；仅持 cap 的真实浏览器 observation 200（P2） |
| X6 自 confirm | 403；真实 Owner cap confirm 200（P4） |
| X7 自 applied | 403；真实 Owner cap applied 200（P5） |
| X9 external→human 翻转 | 403 |
| Y2 过早期 tick | `E_STALE_TICK companion.tick_before_creation` |
| Y5 reject 变 applied | `E_PERMISSION companion.decision_not_confirmed`；`appliedTick < decidedTick` → `E_STALE_TICK` |
| 附加：C1/C2 自 handshake | 403 `world.owner_pairing_required`（无 key / 假 key 均拒） |

**B1 安全漏洞确认修复。** 不可用旧结论的「22/22 漏洞成立」当作 PASS；本轮全部为攻击被拒的独立证据。

## 二、生命周期 / 双凭据 / C3b 边界

`probe-lifecycle.mts` → **21/21 PASS**（`07-lifecycle.json`）：cap 轮换、旧 cap 失效、错 key 重授权被拒、正确 key 轮换成功、agent 租约 4s 到期 `attached:false/status:closed`、不自动重连、LOST reload 后用同一 host key 重新 handshake（同桥不重启）、新 session、agent 重新 attach；C3b Player handshake/observation/close 均需 cap、attach 仍 token-only、close 后 attach 被拒。

## 三、真实 E2E 生产链（19 项，17 PASS / 2 FAIL）

`probe-e2e-full-chain.mts`，真实 bridge launcher + 生产 Pause 表单 + 真实 core tick（`06-e2e-full-chain.log`、`e2e-full-chain.json`）：

- PASS：F1 Owner 配对 CONNECTED；F2 agent attach；F3 真实 echo 观察；F4 提议；F5 **确认前无 core 效果**（echoShots=0/pending=false）；F6 agent 自确认 403；F7 确认后 pending intent；F8 **下一 core tick 真实 echo 效果**（tick 5→79，echoShots 0→1，echoX 9→8.625）；F9 重复决策不执行；F10 旧 key 重授权拒绝；F12/F14 AI/External 互斥（READ_ONLY ↔ CONNECTED）；F13 external 下提议被拒；F16/F17 reload 与无页面错误。
- **FAIL F11**：生产 UI「ENABLE / RE-AUTHORIZE」重授权返回 `FAILED · owner pairing rejected — control stays human`（HTTP 层用正确 key + 当前 cap 的重授权 L6 成功，故为 UI wiring 缺陷，非加密边界失效）。
- **FAIL F15**：agent 租约到期后游戏 HUD 仍显示 `CONNECTED`（桥侧 L11–L13 已正确 fallback/closed，不自动重连）；属 UI 状态陈旧。

## 四、五视口与秘密泄漏

`probe-viewports.mts` → **11/11 PASS**（`08-viewports.json`、`evidence/viewport-*.png`）：800×600 / 1024×768 / 1280×720 / 1366×768 / 1920×1080 表单完整可见、token/ownerKey 均 `type=password`；提交后 DOM 输入清空、全局无 `ownerKey`、日志/页面输出无 token/ownerKey 命中；截图在清空后拍摄。注：`__externalLinkConfig` 仍含 `bridgeUrl`/`token`（既有设计，非本次引入），ownerKey/ownerCap 不在其中。

## 五、发现与工具链失效（不硬改快照）

1. **B-1（阻塞，真实产品缺陷）E4**：真实生产 Companion 表单在**未预注入 `__externalLinkConfig`** 时无法完成 Owner 配对。表单的 `bridgeUrl`/`token` 输入在 companion 分支被忽略，只 `stashOwnerPairing` 后调用 `authorizeCompanionFromConfig()` 读取全局；无全局则失败，状态 `FAILED · owner pairing rejected`。证据 `e2e-real-form.json`（E4 FAIL，companionStatus `OFF`）。生产门禁要求「真生产表单 Owner pairing」→ 不满足。
2. **B-2（真实产品缺陷）F11**：同上 UI 重授权路径始终走新 handshake，live session 被 `409 world.duplicate_handshake` 拒绝；未调用已存在的 `reauthorizeCompanion(ownerKey)`（HTTP 层 L6 证明协议本身可用）。
3. **B-3（回归）`echo_status` MCP 工具失效**：`companionStatus` 现要求 `ownerCap` 查询参数，而官方 MCP `client.status()` 仅持 token → `403 companion.owner_capability_required`；`echo_memory` 仍 200（`10-echo-status-route.json`）。Agent 官方四工具面少一可用工具。
4. **B-4（UI 陈旧）F15**：租约过期后 HUD `CONNECTED` 不刷新（与上一轮 P3b-A 记录一致）。
5. **工具链失效（非产品回归）**：旧 E2E 未适配双凭据。`PORT=5392 npx playwright test tests/p3b-companion-owner.spec.ts` → `Error: world bridge requires a sha256 owner pairing key hash`（`worldBridgeServer.ts:42`），因测试仍用 `startWorldBridge({gateway,token,allowedOrigins})` 且 handshake 未带 ownerKey。按要求明确记录为工具链失效，未修改快照/测试。

## 可发布判断

- **可发布（精确 scope）**：B1 Owner 授权安全修复本身 —— host 私有 pairing key、bridge 签发 cap、所有 renderer 变更强制 cap、严格共享 validator、reject/applied 约束、租约 4s fallback、C3b 双凭据/close。证据：19/19 攻击被拒 + 21/21 生命周期 + 全门禁绿。
- **不可发布（P3-b A 整体）**：真实生产表单不能无预注入配对（B-1）、UI 重授权失效（B-2）、`echo_status` MCP 回归（B-3）。这三项均为本次修复引入/遗留的 wiring 问题，需在开发者侧修复后重新独立验收。
- 未验证真实 LLM 建议（按约束禁止）；不外推 Signal B / P4；不等待下一步 Signal。

## 路径

报告目录：`reports/ai-native-02/tester/p3b-owner-auth-final/`
- `00-freeze.log`、`00-all-files.sha256`、`00-archive-diff.log`
- `01-attack-recheck.json` / `probe-b1-attack-v2.mts`
- `02-typecheck.log`、`02-unit.log`、`03-prod-build.log`、`04-mcp-build.log`
- `05-e2e-real-form.log` / `e2e-real-form.json`（E4）
- `06-e2e-full-chain.log` / `e2e-full-chain.json`（F1–F17）
- `07-lifecycle.log` / `07-lifecycle.json`（L1–L21）
- `08-viewports.log` / `08-viewports.json` / `evidence/viewport-*.png`
- `09-e2e-old-toolchain.log`、`10-echo-status-route.json`
- 探针：`probe-*.mts`（均只读快照生产模块，不改快照）
