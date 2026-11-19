# P3-b Owner 授权功能补丁独立抽查（7fd4a2e）

- **被测提交**：`7fd4a2eedb39ebf3602de00328eb5a12287ee300`（HEAD，分支 `feat/ai-native-world-integration`，父 `87ab379`，已确认 B1 关闭）
- **冻结**：`git -c core.autocrlf=false -c core.eol=lf archive 7fd4a2e | tar -x -C D:/Project/lastsignal-p3b-owner-functional-review-7fd4a2e`；`node_modules` junction；Python 逐文件 git blob SHA1 → **ALL_TRACKED_FILES_MATCH（2031/2031, MISMATCH=0, MISSING=0）**
- **边界**：未改生产源码/已有测试/配置/分支；未 merge/reset；未读/恢复 WIP/stash；自有端口/token/凭据文件，token/ownerKey/ownerKeyHash 无日志/参数/URL/截图
- **作用域**：**单看 functional 改动**（不重复整轮 B1 攻击/全架构审查）：
  - `src/ai-native/companionConsoleSmoke.mts`：控制台握手/授权/观察加 ownerCap
  - `src/ai-native/worldConsoleSmoke.mts`：渲染控制台三路用 OWNER_KEY_FILE 单独读 ownerKey 手握手，Agent env **不**含 ownerKey
  - `src/ai-native/worldMcpIntegration.mts` / `worldMcpLeaseSmoke.mts`：人类手握手带 ownerKey，观察/关闭带 ownerCap
  - `src/scenes/GameScene.ts` / `src/scenes/PauseScene.ts`：允许从 `__externalLinkConfig.ownerKey` 回退（仍要求 ownerKey，非认证旁路）
- **结论**：**functional 补丁独立抽查 PASS，可发布；无 Owner key 泄漏，无认证回退，三路控制台真实可启动，F03 与 Owner 功能无回归。可并行进入 Task C（Lead 已明确授权），若新硬阻断及时报告。不把“无真实 LLM 证据”当作禁止实现 C，不夸大为完整 P3。**

## 1. 功能改动逐项审查

| 改动文件 | 检查点 | 结果 | 说明 |
|---|---|---|---|
| `companionConsoleSmoke.mts` | 手握手带 ownerKey，授权/观察带 ownerCap | **PASS** | 脚本已按 B1 要求补充 ownerKey，不再裸握手 |
| `worldConsoleSmoke.mts` | 渲染控制台从 `OWNER_KEY_FILE` 单独读 ownerKey 手握手；Agent env **不含** ownerKey | **PASS** | `LAST_SIGNAL_WORLD_BRIDGE_URL`/`LAST_SIGNAL_WORLD_TOKEN` 传给控制台进程，**不**传 `LAST_SIGNAL_WORLD_OWNER_KEY`；注释说明 |
| `worldMcpIntegration.mts` | 人类手握手带 ownerKey；推送观察带 ownerCap；断言 `handshake.ownerCap` | **PASS** | 会话→观察→动作→关闭全链二进制 |
| `worldMcpLeaseSmoke.mts` | 人类手握手带 ownerKey；关闭带 ownerCap；断言 `handshake.ownerCap` | **PASS** | 租约硬杀毁链保留 |
| `GameScene.ts` | `authorizeCompanionFromConfig` 允许 `config.ownerKey` 作为配对密钥来源（与 `peekOwnerPairing().consumeKey()` 并存），仍要求 ownerKey | **PASS** | 仍要求 ownerKey，非认证旁路；`pairing?.swapCap` 防空 |
| `PauseScene.ts` | 同理允许 `config.ownerKey` 回退，仍要求 ownerKey | **PASS** | 同上 |

**无 Owner key 泄漏**：ownerKey 仅在人类手握手体中出现（桥接侧 `ownerKeyHash` 只存哈希），Agent 侧 env/控制台进程不收 ownerKey；`companionConsoleSmoke`/`worldMcpIntegration`/`worldMcpLeaseSmoke` 均使用测试夹具 `TEST_OWNER_KEY`（与 `TEST_OWNER_KEY_HASH` 匹配，非真实凭据）。

**F03 与 Owner 功能回归**：`worldConsoleSmoke` 三路（headless player / headless dev help / rendered help）全部 exit=0；`worldMcpIntegration` list→observe→action→close 二进制 pass；`ownerAuth.test.ts` 8/8、`worldBridgeServer.test.ts` 7/7、`worldGateway.test.ts`（F2/F3 硬门）23/23、owner 相关 52/52 全绿。

## 2. 观察（非阻断，建议清理）

- `src/ai-native/worldMcpLeaseSmoke.mts` 第 ~76 行 `console.error('[DEBUG] TOKEN:', TOKEN, ...)` 会把随机生成的测试 TOKEN 印到 stderr。TOKEN 是测试脚本自身随机生成（非生产 Owner 配对密钥/桥接 token），**不是 Owner key 泄漏**，但为严格遵守“token 不进日志”，建议移除该调试输出。

## 3. 门禁日志（一行 PASS/FAIL + 命令 + 结果 + 路径）

| 行 | 命令 | 结果 | 日志 |
|---|---|---|---|
| PASS | `npm run typecheck` | rc=0 | gate-typecheck.log |
| PASS | `npm run game:mcp:build` | rc=0 | gate-mcp-build.log |
| PASS | `npx vite-node src/ai-native/companionConsoleSmoke.mts` | `COMPANION_CONSOLE_SMOKE_OK` | gate-companion-console-smoke.log |
| PASS | `npx vite-node src/ai-native/worldConsoleSmoke.mts` | `WORLD_CONSOLE_SMOKE_PASS`（三路） | gate-world-console-smoke.log |
| PASS | `npx vite-node src/ai-native/worldMcpIntegration.mts` | `WORLD_MCP_INTEGRATION_PASS` | gate-world-mcp-integration.log |
| PASS | `npx vitest run src/ai-native/ownerAuth.test.ts` | 8/8 | gate-ownerauth.log |
| PASS | `npx vitest run src/ai-native/worldBridgeServer.test.ts` | 7/7 | gate-worldbridgeserver.log |
| PASS | `npx vitest run src/ai-native/worldGateway.test.ts` | 23/23（含 F2/F3/F4/F5 硬门） | gate-worldgateway.log |
| PASS | `npx vitest run companionFacet/companionGateway/externalLinkLifecycle/agentLease/c3bBridge/companionBridge` | 6 文件 / 52 PASS | gate-owner-related.log |

日志目录：`reports/ai-native-02/reviewer/p3b-owner-functional/`。

## 4. scope / 可发布状态

**可发布**：functional 补丁本身独立抽查 PASS，无 Owner key 泄漏，无认证回退，三路控制台真实可启动，F03 与 Owner 功能无回归。可并行进入 Task C。

**不夸大完整 P3**：本轮未做完整 P3 验收；Lead 真实 LLM 建议实践的证据仍缺（控制台只是工具，不预写策略）；Signal 正式 Relay 协作场景/跨端 parity/完整 E2E 仍未实施。

未修改生产源码/已有测试/配置/分支；未合并/重置；未读取/恢复共享 WIP/stash。
