# 门禁逐行（每行 PASS/FAIL + 命令 + 结果 + 路径）

| 行 | 命令 | 结果 | 日志 |
|---|---|---|---|
| PASS | `npm run typecheck` | rc=0 | gate-typecheck.log |
| PASS | `npx vitest run src/signal/signalCore.test.ts src/systems/runCheckpoint.test.ts src/ai-native/companionFacet.test.ts src/slice/` | 8 files / **94 tests** 全 PASS | gate-targeted-unit.log |
| PASS | `npx vite-node reviewer-probe-checkpoint.mts` | `CHECKPOINT_PASS`（factory 精确钉死 / 运行边界 / 旧档不误拒 / 14 类注入全拒） | gate-probe-checkpoint.log |
| PASS | `npx vite-node reviewer-probe-signal.mts` | `SIGNAL_PASS`（tuning 同源 / `<` 边界 / tick 量化 / guard jam / 证据 TTL+扣费顺序 / 无无限资源 / validSignalResources） | gate-probe-signal.log |
| PASS | `npx vite-node reviewer-probe-slice-parity.mts` | `OLD_VS_NEW_SLICE_PASS`（ab59fe6 与 212cd56 冻结 slice：14 步 snapshot/result/availability/evidence/serialize 全同） | gate-probe-slice-parity.log |
| PASS | `npx vite-node reviewer-probe-corridor.mts` | `CORRIDOR_PARITY_PASS`（走廊 10 步 + guard/relay jam + scanFrom 扣费顺序全同） | gate-probe-corridor.log |
| PASS | `npx vite-node reviewer-probe-owner.mts` | `OWNER_PASS`（Symbol 伪造拒绝 / 公开 factory 可铸 / decide 全负向 / 不双执行 / snapshot 有界无泄漏 / 隐藏 target 不入 memory） | gate-probe-owner.log |
| PASS | `npx vite-node reviewer-probe-boundary.mts` | `BOUNDARY_PASS`（`<` vs `<=` / 重复 jam gate / denylist 额外键） | gate-probe-boundary.log |
| PASS | `npx vite-node reviewer-probe-ledger-edges.mts` | `LEDGER_EDGES_PASS`（tick 逆序 / decision 枚举 / 双建议双决策） | gate-probe-ledger-edges.log |
| PASS | 静态接线核查 | `NO_WIRING_OUTSIDE_PURE_AND_SLICE` / `NO_WORLD_WIRING` / `world_signal_status` 仍 `E_NOT_APPLICABLE` | gate-static-wiring.log |
| FAIL→PASS | `npx vite-node src/ai-native/worldHeadlessMcpSmoke.mts` | 首跑 `FAIL headless mcp smoke \| "MCP error -32000: Connection closed"`（快照未建 dist-mcp，前置缺失非回归）；`npm run game:mcp:build` 后 `HEADLESS_MCP_SMOKE_PASS` | gate-headless-smoke.log / gate-headless-smoke-retry.log / gate-mcp-build.log |

- 首次 smoke 关键错误行：`FAIL headless mcp smoke | "MCP error -32000: Connection closed"`（原因：`dist-mcp/worldHeadlessMcpServer.mjs` 未生成；补 `game:mcp:build` 后 PASS）。已如实记录，未掩盖。
- 探针源码：`reviewer-probe-*.mts`（7 个，均为本人只读独立负向，不修改生产源/测试/配置）。
- 旧 slice 对照来源：`git archive 212cd56 src` 解到本快照 `reviewer-old-src/`，与 `ab59fe6` 的 `src/slice/` 在同一冻结快照内双跑。
- 未重跑无关全量（按 Lead「针对 unit 与独立负向即可」）；未占用他人端口、未起 dev server、未读 WIP/stash。
