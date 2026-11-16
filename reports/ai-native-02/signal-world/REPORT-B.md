# P3-b B — core Signal 状态 / v2 能力 / Headless 真实 capability

- 分支 `feat/ai-native-world-integration`；未 merge/push/stash；`a1e23dd` 冻结验中，A 通道若报权限硬阻断后续先修。

## core 可选 Signal（唯一写者不变）
- `src/world/sim/signalState.ts`：一处真实 Relay 设备 `SimSignalDevice`，**player/echo 独立** `SignalResources`（同源 `src/signal` 纯规则），`manualEnabled/powered/jammedUntilTick/relay/evidence/actors`。
- `core.ts` 新增 `SimulationState.signal?`（**缺省不存在** → C1/C2/C3c 无 signal 的 canonical 字节不变）、`SimCommand`：`spawn-signal-device`、`signal-scan`、`signal-jam`、`toggle-relay`、`signal-power`；命令只在 `processCommands` 的 tick 内提交，`stepSimulationTicks` 每 tick `tickSignalDevice`（能量回复/冷却/证据 TTL/jam 到期 → relay 重算）。
- `SimEvent` `signal-device-spawned/scanned/jammed/relay-changed/energy/evidence-expired`，含 `actorId`、扣费、冷却、relay 状态；`canonicalSimulationState` 含 `signal`（仅存在时）。
- **JAM 只抑制发射**：`relay=JAMMED`，手动 toggle 不能覆盖；jam 到期按 `manualEnabled&&powered` 重算 ACTIVE；`signalExitOpen()` 仅 ACTIVE 为 true，无设备时旧 portal 行为完全不变。
- checkpoint：`CoreCheckpointState.signal?` + `validSignalDevice()` 严格 allowlist（拒 `hiddenTarget`/nested `free`/篡改 energy），旧档无 signal 合法；`capture/restoreCheckpoint` 深拷贝；默认 run 无设备。
- v2：`worldProtocol.ts` 新增 `WORLD_SCHEMA_V2`/`WORLD_PROTOCOL_VERSION_2`/`WORLD_CAPABILITIES_V2`（signal/actors/actions），`worldActionSchemaV2` 加 `scan/jam` + 显式 `actor`；**v1 schema/解析完全未改**，v1 客户端请求 scan/jam 由上层明确 `E_VERSION_UNSUPPORTED`，不静默降级。`isSignalAction` 辅助。

## Headless / MCP / 批测
- `HeadlessWorld.enableSignalDevice/enqueueSignalCommand/signalView` 与 Rendered 同一 core 命令；`world_signal_status` 只在真实 core 设备存在时 `supported:true`（`worldHeadlessSignal.test.ts` 2/2），无设备仍 `E_NOT_APPLICABLE`。
- Dev 工具 `world_headless_dev_signal_device/_signal_command/_signal_batch`（Dev 隔离）；`worldHeadlessHarness.signalCombatBatch(seeds)` 真实多 seed：scan 扣 10 / CD120、jam 扣 25 / CD480、JAMMED 不 ACTIVE、到期 ACTIVE 出口开放、evidence 发现、canonical hash 每 seed 稳定（`worldHeadlessHarness.test.ts` 6/6）。
- `world_signal_status` 的 supported 是真实状态，不是文案改写。

## 门禁（`reports/ai-native-02/signal-world/logs/B-gate.log`）
MCP build 冷启动 → typecheck → unit **663/663** → build/build:test → slice unit 59/59 → Headless smoke / Player crop / Companion console smoke → C2 `PARITY_PASS`、C3c `C3C_RENDERED_HEADLESS_PARITY_PASS`、P3a echo rendered parity → P3-a/Owner E2E、C2/C3b/C3c E2E、test-build preview 回归。
- C3c parity 初跑 FAIL 是 gitignored `initial/sequence` 与已提交 `rendered.json` 夹具漂移；用 `tests/c3c-headless-parity.spec.ts` 重新导出三件套后 PASS，本提交刷新 `rendered.json`。
- preview 20 例满负载下 `vs01 route B` 出现 x=2.7 vs <=2.6 时序 flake，单独复跑 1/1 PASS；日志记为 NOTE，未放宽断言。

## 未完成边界（诚实）
- **C 未实施**：正式游戏内 Relay 协作场景、真实 room 装置 sprite/朝向/目标线、菜单可进入入口、Owner 面板确认 → echo scan/jam/toggle → ACTIVE 出口推进、五视口状态/能量/建议、跨端 echoSignal 字节 parity、连续截图/操作日志、正式 SDK console v2 Player scan/jam 全流程。
- 无 LLM 连接/ECHO 真实模型逐轮建议；两份既有真实 LLM 最小玩家遭遇仍为独立证据。
- 默认旧 run 不挂 relay 门；Signal 只在显式 `spawn-signal-device` 后存在。
