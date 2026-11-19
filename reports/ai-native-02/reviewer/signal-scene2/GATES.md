# 门禁逐行（每行 PASS/FAIL/NOT RUN + 命令 + 结果 + 路径）

| 行 | 命令 | 结果 | 日志 |
|---|---|---|---|
| PASS | `npm run typecheck` | rc=0 | gate-typecheck.log |
| PASS | `npm run game:mcp:build` | rc=0，产出 dist-mcp/companionMcpServer.mjs / worldHeadlessMcpServer.mjs / signalCore | gate-mcp-build.log |
| PASS | `npx vitest run src/signal/signalCore.test.ts src/systems/runCheckpoint.test.ts src/ai-native/worldGateway.test.ts src/world/sim/signalState.test.ts src/ai-native/worldHeadlessSignal.test.ts src/ai-native/worldHeadlessHarness.test.ts` | 6 文件 / 54 tests PASS | gate-targeted-unit.log |
| PASS | `npx vite-node reviewer-probe-core-signal.mts` | `CORE_SIGNAL_PASS failures=0`：设备建立/严格`<`半径/再生 tick 量化/守卫压制保留中继计时/无敌暂停/有效验证拒绝 hiddenTarget/nested.free/旧档无设备可用/单设备房间中心 | gate-probe-core-signal.log |
| FAIL（探针脚本 Bug，非产品回归） | `npx vite-node reviewer-probe-gateway-raw.mts` | `ReferenceError: Cannot access 'obs2'`；网关 v2 scan/jam 批次未真正到达核心执行 | gate-probe-gateway-raw.log |
| FAIL（探针脚本 Bug，非产品回归） | `npx vite-node reviewer-probe-owner-confirm.mts` | `E_LINK_UNAVAILABLE`（observation 对象未匹配 worldObservationSchema），Owner 确认→echo scan→核心耗能未闭环验证 | gate-probe-owner-confirm.log |
| FAIL（探针脚本 Bug，非产品回归） | `npx vite-node reviewer-probe-v2-gateway.mts` | `E_LINK_UNAVAILABLE`（observation 对象缺字段），v2 scan/jam 未通过网关落到核心 | gate-probe-gateway-raw.log、gate-probe-v2-gateway.log |
| PASS（源码真值，非运行） | 源码核查：worldActionSchemaV2 含 scan/jam + actor；worldActionSchema v1 未改（v1 客户端 scan/jam → E_VERSION_UNSUPPORTED）；World.worldHeadlessMcpTools 无 dev 信号工具；worldMcpTools world_action 仅 v1 | 源码逐行审计，无运行日志 | 无日志（源码审计） |
| 未做（依据 Lead 指令不重复） | 全量 E2E / 正式 LLM 建议 / 跑完全部 probe | 未执行 | — |

冻结快照：`git archive c1cc2dd`，2034/2034 blob SHA1 ALL_TRACKED_FILES_MATCH（D:/Project/AI-NATIVE-02-snapshots/c1cc2dd-signal-scene2）。
未修改生产源码/已有测试/配置/分支；未 merge/reset；未读/恢复 WIP/stash；未重复无关全量。
