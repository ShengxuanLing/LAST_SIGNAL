# P3-b A 接线边界（Owner 收紧 + gateway/bridge/官方 MCP/Owner UI）

- 分支 `feat/ai-native-world-integration`；未 merge/push/stash。
- 前置：`ab59fe6` 纯模块已由 `reviewer/p3b-pure/REVIEW.md` + `tester/p3b-pure-final/P3B-PURE-FINAL.md` 独立 PASS；两份真实 LLM 最小玩家遭遇仍为既有证据，ECHO 的 LLM 逐轮建议仍需 Lead 后续用正式工具亲自执行。

## Owner 凭据收紧（本轮第一小提交）
- 删除共享 `companionFacet.ts` 的 `createOwnerCapability`/`isOwnerCapability`/公开 Symbol；改为 `CompanionOwnerLedger` 注入 `OwnerAuthorityValidator` 回调。
- 浏览器专属 `companionLink.ts` 内**模块私有 WeakSet** + `mintOwnerAuthority()`（不导出）；spread、`Object.create`、符号复制、JSON 往返都过不了对象身份校验。Bridge 侧另用浏览器持有、Agent 拿不到的 `ownerSecret` 的 sha256 校验 confirm/applied 路由；Agent token/伪 Origin 不能自 confirm。
- `companionSurface.test.ts` 在 **MCP build 冷启动后**检查生产 `dist-mcp/companionMcpServer.mjs`+chunks 无 Owner 工厂/决策/路由；官方 Companion MCP 只有 `echo_observe/echo_suggest/echo_status/echo_memory`。
- 纯契约：`decide` 严格枚举、tick≥createdAtTick、epoch 单调、过期显式错误；`observe` 只接受 `buildEchoObservation` 的裁剪证明（schema/perception/严格 <12），拒绝裸 sim/hiddenTarget，targets 正确记入有界 memory；`availableActions` 对 >6 目标明确 `out_of_range`；Signal/echo DTO 严格 allowlist + 物理时长计时器边界；`tryScan/tryJam` 单一 blocker、权限先判后扣、无重复扣/负 energy。slice 边界保持 `<12/<6` 不变。

## A 接线（本轮第二小提交）
- `worldBridgeServer.ts` 新增 Companion 路由：Agent（token-only）`companion-observation GET / companion-suggest POST / companion-status GET / companion-memory GET`；Renderer（Origin+ownerSecret）`companion-authorize/observation POST/suggestions GET/decision POST/applied POST/mode/disconnect`。复用 `WorldGateway` session/epoch、`AgentLeaseRegistry` 租约 reaper（过期清 pending + `NO_MODEL`），`CompanionGateway` 有界 8 未确认/512 dedup/TTL600/同 id 冲突/旧 epoch。
- `companionMcpTools.ts` + `dist-mcp/companionMcpServer.mjs` 官方 SDK surface；`scripts/p3b-companion-console.mts` REPL 只有 observe/suggest/status/memory/quit（输入 `confirm` 直接提示去游戏 UI），原始 I/O 脱敏 JSONL；`companionConsoleSmoke.mts` 真实启动烟测。
- 游戏内 Owner UI：`PauseScene` `LLM COMPANION >` 面板（Connected/Fallback NO_MODEL、建议 reason/目标、CONFIRM/REJECT/DISCONNECT），`GameScene.authorizeCompanionFromConfig()` 人类握手 + 生成浏览器私有 secret，`CompanionLink` 持私有 capability；确认后 `World.enqueueCompanionAction` 只入队**单条** echo core intent，由下一个 `stepFrame` tick 提交，不 flush、不直写状态。AI/External 主角模式只读互斥；HUD 明示 `NO MODEL`，不假 connected。
- `scan/jam` 提议当前仍显式不支持入队（`E_NOT_APPLICABLE`），等 P3-b B 的 core Signal 命令；`move/aim/fire/stop` 已可确认后真实入队。

## 门禁（`reports/ai-native-02/p3b/logs/final-gate.log`，每行 PASS/FAIL + 命令 + 结果 + 路径）
MCP build 冷启动 → typecheck → unit **658/658** → build/build:test → slice unit **59/59** → Owner E2E **1/1** → console smoke → P3-a/P3a修复 **13/13** → audit dev **2/2** → test-build preview checkpoint/economy/slice **20/20** → 生产 preview 三入口 smoke `PREVIEW_ENTRY_SMOKE_PASS`。

## 未完成边界（诚实）
- **正式 World 仍无 Signal**：无 energy/scan/jam core 命令、无 Relay 设备/门控、`world_signal_status` 仍 UNSUPPORTED；默认 run/旧 C2 hash 不变。
- **没有 LLM 连接**：没有真实模型逐轮建议；console 只是工具，不预写策略。
- B（core Signal 状态/命令/事件/canonical/checkpoint、v2 能力协商、Headless 同规则、Signal Combat 批测）与 C（正式 Relay 合作场景/五视口/跨端 echoSignal 字节 parity/full E2E）尚未实施。
