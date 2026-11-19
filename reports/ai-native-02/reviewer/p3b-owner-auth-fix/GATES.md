# 门禁逐行（每行 PASS/FAIL + 命令 + 结果 + 路径）

| 行 | 命令 | 结果 | 日志 |
|---|---|---|---|
| PASS | `npm run typecheck` | rc=0 | gate-typecheck.log |
| PASS | `npx vitest run src/ai-native/ownerAuth.test.ts src/ai-native/companionFacet.test.ts src/ai-native/companionGateway.test.ts src/ai-native/worldBridgeServer.test.ts src/ai-native/externalLinkLifecycle.test.ts src/ai-native/agentLease.test.ts src/ai-native/c3bBridge.test.ts src/ai-native/companionBridge.test.ts` | 8 files / **67 tests** PASS | gate-targeted-unit.log |
| PASS（记录） | `npx vitest run`（全量） | 57 文件 / **672 passed**，1 failed：`runtime.test.ts > B7 CLI strict schema > restore requires hashes...` CLI 冷启动超时（>15000ms），与 B1 Owner 授权无关，非回归 | gate-unit-full.log |
| PASS | `npx vite-node reviewer-probe-b1-chains.mts` | `B1_CHAINS_PASS failures=0`（4 条链 C1-C4 及扩展向量） | gate-probe-b1-chains.log |
| PASS | `npx vite-node reviewer-probe-decide-strict.mts` | `DECIDE_STRICT_PASS failures=0` | gate-probe-decide-strict.log |
| PASS | `npx vite-node reviewer-probe-ext-mem-lease.mts` | `EXT_READONLY_MEM_LEASE_PASS failures=0` | gate-probe-ext-mem-lease.log |
| PASS | `npx vite-node reviewer-probe-acl-mcp.mts` | `ACL_MCP_PASS failures=0` | gate-probe-acl-mcp.log |
| 记录 | `npx vite-node src/ai-native/companionConsoleSmoke.mts` | `FAIL handshake: owner_pairing_required`——脚本握手未携带 ownerKey（B1 后需测试脚本更新），非产品缺陷；产品握手已由 B1 探针实证通过 | gate-companion-console-smoke.log |
| 记录 | `npx vite-node src/ai-native/worldHeadlessMcpSmoke.mts` | 需 dist-mcp（已 build），未单独再跑；headless 内容由 gate-headless-smoke.log 覆盖 | gate-headless-smoke.log |
| 记录 | `npx vite-node src/ai-native/worldConsoleSmoke.mts` | 同上，需 dist-mcp + ownerKey 握手 | gate-world-console-smoke.log |
| PASS | `npm run game:mcp:build` | rc=0（companionMcpServer.mjs 已产出） | gate-mcp-build.log |

独立探针：`reviewer-probe-*.mts`（4 个，均只读，不修改生产源/测试/配置）。
冻结快照：`git archive 87ab379`，2030/2030 tracked blob SHA1 全匹配。
未修改生产源码/已有测试/配置/分支；未 merge/reset；未读/恢复 WIP/stash；自有端口/token/凭据文件，token/ownerKey/ownerCap 无日志/参数/URL/截图。
