# AI-NATIVE-02 C3-c — Headless same-core MCP + Task0 收尾

分支 `feat/ai-native-world-integration`。本轮为**接口/内核/复现**交付：真实 LLM 战斗仍未由我实跑，**不得据此宣称完整 P2 PASS**。

## 1. 提交

| commit | 内容 |
| --- | --- |
| `da7c169` | Task0：stop 抢占、凭据清理、Agent 租约历史有界 |
| `122cafe` | LOST/CLOSED 桥接会话由明确人类再授权原子回收（browser reload 永久回归） |
| 本提交 | C3-c：Headless same-core 运行时 + 官方 `--world-headless` MCP（Player/Dev 分离）+ Rendered↔Headless canonical parity + P4 Dev harness/perf + 官方 console |

## 2. Task0（Reviewer 限制 1–3）

- **stop 抢占**：`ExternalLinkState.preemptActive()`。`beforeFrame` 在 active 时 peek 下一个动作，若是 `stop` 则立即取消 active（receipt `cancelled` + `executedTicks`/`startedTick`/`completedTick`），随后 `stop` 作为 **1 tick 真实 neutral** 提交；其他排队动作保持 FIFO。人类接管仍立即生效（不依赖 stop）。
- **凭据清理**：控制器把 `bridgeUrl/token` 放在自身字段；`degrade()/dispose()` 调 `forgetCredentials()`（清自身 + `delete globalThis.__externalLinkConfig`）；`GameScene.authorizeExternalAgent` 在入口即删页面级配置；`ExternalLinkClient.close()` 清其内存 token。授权成功后 token 只存在于**活连接**。
- **租约有界**：`AgentLeaseRegistry.prune()` + `AGENT_LEASE_CAPS`（leases 256 / expiredSessions 1024 / versionSessions 256），只淘汰**非 live** 记录；`release/reap/invalidateSession` 后清理。旧 lease 记录被淘汰即无法 renew（`leaseId` 查找失败），**不会**因此续到新 session。
- 测试：`task0.test.ts` 9 条（stop 抢占/FIFO、1000 次 issue+invalidate、1000 次 gateway+lease 生命周期、120 次真实 HTTP bridge 会话、token 全局不可读、degrade/dispose 清凭据）；E2E `stop preempts ACTIVE`、`__externalLinkConfig` 授权后为 undefined。

## 3. 桥接会话回收（Tester 新发现）

- `handshake`：仅 `status === 'connected'` 的活链接返回 409 `duplicate_handshake`；`closed/yielded/LOST`（浏览器刷新/崩溃）由**明确人类新授权**原子回收：作废旧 lease、`closeSession` 取消旧 pending/缓存、删除 origin 绑定、创建**全新 session/epoch**。旧 epoch 一律拒绝，旧 token 不能复活旧会话，无自动接管，**无需重启 bridge**。
- 更新 C3-a 用例（原“LOST 后一律 409”改为“LOST 后可回收；新 live 会话仍 409”），并新增 `tests/c3c-bridge-reclaim.spec.ts`：reload → LOST → 新授权成功且 session id 变化、旧 epoch 被拒、bridge URL 不变。

## 4. C3-c Headless same-core

**运行时** `src/ai-native/worldHeadless.ts`（无 Phaser/DOM/window）：
- 直接使用 `src/world/sim/core.ts`（`createSimulationState`/`stepSimulationTicks`/`processCommands`）+ 真实 `MapGenerator`（`assignRoles`/`guaranteeReachable`）+ 真实 `config`（`basePlayerData`/`pulse`/`buildEnemyData`）。
- 起始为**真实战斗房**：`start` 房间 + 相连 `combat` 房间，玩家与一只真实 `drone`（真实 `EnemyData`、按 depth 缩放）；真实碰撞/伤害/死亡/清场。
- 观察复用 `buildWorldObservation` + `worldPerception`（12 格 + 已探索 + LOS），`projectiles` 同样裁剪；Player 观察无 seed/RNG/map/pending/ledger。
- Owner frame：`sim`（含 `pendingCommands`/`purchaseTransactions`/`rngState`/`map`/`loot`/`nextProjectileId`）、`events`、`actionLog`、`enteredRooms`、`mapIdentity{seed,mapHash,...}`、status/kills/shots/damageTaken。
- `restore` 深拷贝 + epoch bump；`replay` 从 start frame 重跑同序列并返回**真实** sameState/sameEvents/firstDivergence；`exportFailure` 导出完整 bundle。
- `fromSimulationState(sim)` 供 Rendered 快照直接对比（不复制规则）。

**官方 MCP** `dist-mcp/worldHeadlessMcpServer.mjs`（也支持 `mcpServer.mjs --world-headless [--dev]`）：
- 复用 `WorldGateway`：epoch / request 幂等（fingerprint）/ action 去重 / TTL / `applyByTick` 截止 / 会话预算 / close。`rebindSession` 用于 Dev restore/fixture 后 epoch 严格递增。
- **Player 面**：`world_headless_create_session`（仅服务端 seed）、`world_list_sessions`、`world_observe`、`world_action`（与 Rendered 完全同 schema，queue-only）、`world_headless_step`、`world_close`、`world_signal_status`（明确 UNSUPPORTED）。
- **Dev 面（仅 `--dev`）**：`world_headless_dev_inspect/snapshot/restore/replay/load_room/spawn_enemies/export_failure/batch/compare/perf`。Player 无 seed / fixture / HP 写入权限（Player schema 直接拒绝 seed，manager 再校验一次）。
- `world_headless_step` 是**唯一状态推进**：按 FIFO 抽干已排动作（每个消耗其 `durationTicks`），剩余 tick 用传入 intent/neutral 填充；真实 core tick 计数。收到动作后 ACK 真实 `appliedTick`（超 `applyByTick` 则 `E_ACTION_EXPIRED`）。同 `requestId` + 同 payload → `replayed:true`；不同 payload → `E_ID_PAYLOAD_MISMATCH`；旧 epoch → `E_STALE_EPOCH`；战斗结束（非 Dev）→ `E_NOT_APPLICABLE`。

## 5. Rendered ↔ Headless parity

`tests/c3c-headless-parity.spec.ts`：Rendered 真实 World（同一 core）+ 真实 drone，按固定 intent 序列逐 fixed tick 运行并导出 `initial.json`/`sequence.json`/`rendered.json`。
`scripts/c3c-rendered-headless-parity.mts`：用 `HeadlessWorld.fromSimulationState(initial)` 重放同序列，比较 canonical state/events/finalTick/drones/projectiles。
结果：`C3C_RENDERED_HEADLESS_PARITY_PASS finalTick=63 events=126`（8/8 PASS）。

## 6. P4 Dev harness / perf（不冒充 Signal）

`src/ai-native/worldHeadlessHarness.ts`：
- 固定 combat regression（确定性基线策略 `seek-and-fire`）：真实房间 + 真实 drone，输出每次 seed 的 ticks/status/kills/shots/damage/HP/canonical hash。
- 确定性基线对比 `hold` vs `seek-and-fire`，结果明确标注 **deterministic baselines, NOT an AI agent and NOT Signal Combat**。
- `combatPerf(ticks, sessions)`：真实战斗，清场时用真实敌人波次续场（`spawnEnemies`），报告 wall/CPU/heap/events 与 `liveCombatTicks`。实测 1000×10：wall ≈ 2.9s、cpuUser ≈ 2.9s、events 30340、liveTicks 9200/10000；10000×10：wall ≈ 5.0s、events 200k（单调计数）、liveTicks 91900/100000。
- `signalCombatStatus()` 恒返回 `E_NOT_APPLICABLE world.signal_combat_unsupported`；**Signal Combat 未实现，明确不 PASS**。

## 7. 工具（Lead 单次 JSON / 持续 REPL）

`scripts/c3b-mcp-console.mts`（`npm run game:world:mcp-console`）：
- 一个 MCP 进程保持同一 session/lease；REPL 命令：渲染 `list/observe/act/raw/status/close`；headless 额外 `create [seed] / step <ticks> [intentJson] / inspect / snapshot / loadroom / spawn / batch / compare / perf / exportfailure / signal / session / epoch`。
- `--json '{"tool":...,"args":...}'` 单次调用后退出。
- 工具参数/结果写入 `reports/ai-native-02/c3c/tool-io/*.jsonl`，**自动脱敏**（token/authorization/bridgeUrl/secret/password → `<redacted>`）。
- 不预写战斗策略；每轮由操作者/Lead 自己看 observation 决定动作。

## 8. 质量门（`reports/ai-native-02/c3c/logs/c3c.log`，一行 PASS/FAIL + 命令 + 结果 + 路径）

| 门 | 结果 |
| --- | --- |
| typecheck | PASS |
| unit | PASS **37 files / 522 tests** |
| build / build:test / MCP 三入口 | PASS |
| headless MCP smoke（Player+Dev） | PASS `HEADLESS_MCP_SMOKE_PASS` |
| Rendered↔Headless parity | PASS 8/8 `finalTick=63 events=126` |
| 默认 StationZero MCP client | PASS |
| `--world` MCP smoke / lease smoke | PASS |
| token ACL / F-03（prod/test/custom mode） | PASS |
| C3b 定向 repeat ×3（15 用例） | PASS **45/45** |
| 全量 E2E（五视口 + C2 回归） | PASS **69/69** |

### 单测数量口径说明（485 vs 497）
Tester 对 `8b9705d` 冻结快照报 **485**；开发工作区当时显示 **497**。差异恰为未提交的 C3c WIP `worldHeadless.test.ts`（12 条）——`npx vitest run` 会收集未跟踪测试文件，而冻结快照不会。**目标快照以冻结 commit 为准**；本提交后 tracked 单测为 522（485 + 12 headless + 9 task0 + 5 harness + 11 headless-MCP）。

## 9. 未完成 / 不声称

- **真实 LLM 战斗**：仍由 Lead 后续执行；本轮只做接口/内核/复现 smoke。Lead 已用官方 MCP 完成一次真实单 drone 遭遇（冻结 `8b9705d`，证据 `reports/ai-native-02/lead-live-drone/`），**仍待独立 Reviewer**；本报告不把它当作我的脚本策略，也不宣称完整 P2 PASS。
- **Signal Combat / ECHO**：主 World 未实现，显式 UNSUPPORTED。
- **Headless 性能**：P4 最低能力已交（1000/10000 tick × 10 session、CPU/heap/wall/events），未做更长期压力/内存剖析。
- 人类授权仍是本地 token 信任模型，无 per-agent 撤销/审计。
- 未 merge/push/stash；C2 维持放行。
