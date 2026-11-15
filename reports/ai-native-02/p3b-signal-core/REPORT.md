# P3-b 前置：Echo 基础数据钉死 + Signal 共享纯规则 + Companion 接口纯模块

- 分支 `feat/ai-native-world-integration`；未 merge/push/stash（`stash@{0}`/`@{1}` 原样）。
- 口径：P3-a `212cd56` 已由 Reviewer `reports/ai-native-02/reviewer/p3a-fixes/REVIEW.md` 放行；两份真实 LLM 最小遭遇（Rendered `lead-live`、Headless `lead-headless-cropped`）已独立确认，ECHO 的 LLM 建议仍需 Lead 后续真实逐轮实跑。
- **本轮未接线**：正式 World 仍无 Signal 可用，也没有 LLM 连接；`companionFacet`/`signalCore` 都是纯模块，未注册 gateway/bridge/MCP/UI，未改 core/World 执行路径，默认 run 行为不变。

## 1. Task0 `77c9294`：Echo 基础数据与 `echoPlayerData()` 同源

- `src/systems/RunCheckpoint.ts` 从 `src/world/sim/core.ts` 导入 `echoPlayerData()` / `ECHO_ACTOR_ID`，`validEchoActor()` 对**不可升级字段**逐项要求**精确等于 factory**：`maxHp/speed/armor/damage/critChance/critDamage/xpGain/pickupRange/dashCooldown/dashDuration/cooldownReduced/pierceCount/hpRegen/level/xp/xpToNext/currency/weaponKey`；`weapons` 必须恰好一把 pulse、level 1、ammo/magazine -1、reloading false；`upgrades/abilities` 必须为空。
- 运行态只做合法范围：`hp ∈ [0,maxHp]`（正常受伤不误拒）、`aimYaw` 有限（可为负）、位置在坐标上限内、dash/invuln/hurt/fire 计时器与 `reloadTimer` 非负有限（正常武器计时器不误拒）；不是每帧/初始值完全相等。
- 拒绝 Reviewer/Tester 列出的全部篡改：`damage=99 / hpRegen=50 / cooldownReduced=1 / critDamage=99 / pierceCount=10 / speed=1000 / armor=1000 / pickupRange=1000 / xpGain=100 / xp=100 / currency=100 / maxHp=10000`。旧档无 echo、玩家自身合法升级均不误拒。
- 回归：`runCheckpoint.test.ts` 6/6；P3-a `p3a-restore` + `p3a-enemy-target` E2E 3/3；checkpoint/economy E2E 7/7（dev server）。

## 2. `c0cfdb6` Signal 共享纯规则 + 旧 slice 同函数

- 新增 `src/signal/signalTuning.ts`：`src/slice/tuning.ts` 现在 `...SIGNAL_TUNING` 展开，**真实数值同源**：energy 100 / regen 5·12ticks / scan 10·cd120·reveal480·radius12 / jam 25·cd480·duration360·range6。单测逐项断言 `SLICE[key] === SIGNAL_TUNING[key]`。
- 新增 `src/signal/relay.ts`（从 `corridor.ts` 原样抽出）：`relayState`、`nextBridge`、`buildRelayReading`、`relayOutput`、`exitOpen`。`corridor.ts` 删除本地实现，改为 import/re-export 并调用共享函数（含 `CORRIDOR.transitionTicks` 仍由设施侧提供）。
- 新增 `src/signal/signalCore.ts`：独立 actor 能量账户（player/echo 各 100，绝不共享）、`tickEnergyAccount`（暂停不推进）、`tickCooldowns`、`scanBlocker/chargeScan`（空扫仍扣 10、CD120、reveal480）、`jamBlocker/chargeJam`（CD480、duration360；guard-jam 保留 relay 倒计时）、`withinSignalRange`（radius 由共享常量拥有，LOS/地图由调用方回调）、`scanDiscover/evidenceExpiry/expireEvidence`（actor 归属与 tick TTL）、`applyJamToRelay/currentRelayState/clearJam`（**JAM 抑制发射，不等于手动 toggle 或 ACTIVE**）、`validSignalResources`（未来 core 状态的精确范围 + 无免费技能）。
- **真正共享调用点**（旧 slice 也走同函数，防两套规则）：`slice/tuning.ts` 展开；`slice/corridor.ts` 的 `reading/nextBridge/relayState/inRange`；`slice/rules.ts` 的 `signalResources/applySignalResources`、`scanCost`→`scanBlocker+chargeScan`、`startJam`→`chargeJam`、`tickOnce`→`tickEnergyAccount+tickCooldowns`、`labScanFrom/labJamFrom/interact/actionAvailability`→`withinSignalRange`、`buildLabEvidence/buildCorridorEvidence`→`evidenceExpiry`。没有复制 `SliceModel` 或设施地图。
- 回归：slice unit **59/59**（`vs00.rules`/`vs01.corridor`/`corridorGuard`/`evidence`/`vs00.room`），slice E2E **13/13**（`tests/vs00.spec.ts`/`vs01.spec.ts`），全量 unit **642/642**，typecheck/build/build:test/MCP/Headless smoke/console smoke 全绿。

## 3. Companion 接口纯模块（本提交）

- `companionFacet.ts` 新增**不可伪造的 Owner 凭据**：模块私有 `Symbol` + `createOwnerCapability(session)` / `isOwnerCapability()`；token、`Origin` 头、JSON 往返、普通对象都无法通过（Origin 不是认证，Node Agent 可任意伪造）。
- `CompanionOwnerLedger.decide()`：只**记录**人类决定，不执行；要求凭据、同 session/epoch、human owner 模式、connected、建议未过期；`move` 等所有外部建议必须逐个确认，本地 follow 是合法默认策略但不是隐式确认。
- `CompanionFacet.snapshot()`：必要状态 + 建议 TTL600 + 未确认上限 8 + 总 dedup 512 + memory TTL600，冻结输出、不含 hidden/auth、无 `restoreSnapshot`（禁止恢复旧授权）。
- 契约单测 19/19：伪造凭据/旧 epoch/断线 `NO_MODEL`/AI·External 只读/同 id 冲突/过期/TTL/全 kind 保持 proposed/无执行面。
- `console` 仍**不含 confirm**；确认入口未来只能在游戏内 Owner UI，agent token/伪 Origin 不能自 confirm。

## 4. 门禁与环境说明

- 一行 PASS/FAIL + 命令 + 结果 + 路径：`reports/ai-native-02/p3b-signal-core/logs/gate.log`、`signal-shared.log`、`companion-interface.log`、`task0.log`。
- 全量单测曾出现 `runtime.test.ts` CLI `spawnSync ETIMEDOUT`（满负载），单独复跑通过；重跑全量 **642/642 PASS**，非回归。
- `tests/checkpoint.spec.ts` / `tests/economy.spec.ts` 在 `vite preview --outDir dist-test` 下 3 例失败（Supply terminal/level-up card 不可见），在**同一份代码**的 dev server 下 **7/7 PASS**；且在已放行提交 `212cd56` 的独立 worktree 上同样 preview 失败、dev 通过 → 构建预览服务方式差异，不是本轮或 P3-a 回归。正式 E2E 采用 dev server。

## 5. 未完成边界（诚实）

- **未接线**：正式 World 无 Signal 设备/energy/scan/jam 动作，无 Relay 门控，无 `world_signal_status` 支持变更；仍是 UNSUPPORTED。
- **未接线**：gateway/bridge/官方 MCP Companion 工具、Owner UI 确认、租约断线取消、v2 能力协商、正式菜单 Signal 合作场景、Signal Combat 批测、跨端 echoSignal 字节 parity 全部未在 core/World/UI 落地。
- 没有另造第二协议/World，没有预写 LLM 建议策略，没有假 connected/假 LLM；两份真实 LLM 最小遭遇是既有证据，不代表 ECHO 已跑 LLM。
- 下一步按 A（Companion 传输/权限）→ B（core Signal 状态/命令/事件/存档）→ C（正式 Relay 场景/UI/跨端演示）继续，每步小提交 + 日志。
