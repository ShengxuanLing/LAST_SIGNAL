# AI-NATIVE-01 P1 — Headless 共享模拟核心（Runtime）

> 状态：**P1 可运行垂直链路**。本文件只描述已实现内容与未完成项，不把结构校验或固定脚本冒充「AI 已合法通关」。
> 范围：同一纯 TS 权威核心（`SliceModel` / `Corridor` / `CorridorGuard` / 几何）同时服务 Phaser 浏览器端与 Node 无头端。
> 不含：MCP Server、WebSocket、真实 LLM/ECHO、P2 完整 Gateway、主 `World` 迁移。

---

## 1. 文件与职责

| 文件 | 职责 | 说明 |
| --- | --- | --- |
| `src/ai-native/runtime.ts` | 无头核心 API、动作校验/排序、事件、内部 snapshot/restore/replay | 纯 TS；不 import Phaser/DOM/node:crypto |
| `src/ai-native/headlessCli.ts` | `npm run game:headless` 的行式 JSON CLI | Node 边界；`node:crypto` 只在此文件计算 sha256 |
| `src/slice/sharedCore.ts` | 共享移动入口 + 通过门/进走廊/完成判定 | Scene 与 Node 都调用它 |
| `src/slice/fullState.ts` | 完整内部状态类型与严格验证器 | 浏览器 checkpoints 与私有运行帧分离 |
| `src/slice/SliceScene.ts` | 浏览器输入/渲染/音频/存储 UI | 移动与转场决策改走 sharedCore |
| `src/slice/rules.ts` / `corridor.ts` / `corridorGuard.ts` | 权威规则 + `captureFull/restoreFull` 最小接缝 | 不复制门/桥/Guard 规则 |

---

## 2. Node API

```ts
import { createGame } from './src/ai-native/runtime';

const game = createGame({ scenario: 'station-zero', seed: 2026, mode: 'headless' });

game.step({
  actions: [
    { type: 'move', direction: 'east', ticks: 60 },
    { type: 'scan' },
    { type: 'jam', target: 'door' },
    { type: 'wait' },
  ],
  ticks: 60,
});

game.observe();   // 白名单观察（无 seed/RNG/完整内部状态）
game.getState();  // 完整内部快照（dev/test 边界，等同 snapshot()）
game.pause();
game.resume();
const snap = game.snapshot();       // 内部私有帧（非浏览器 checkpoint）
game.restore(snap);                  // 逐字段恢复，不调用 scan、不延长 TTL
game.replay(snap, steps);            // 从快照确定性重放
```

### 2.1 动作

| `type` | 参数 | 语义 |
| --- | --- | --- |
| `move` | `direction`、`ticks` | 固定 tick 的移动意图，持续 `ticks` 个逻辑 tick；方向为 `up/down/left/right`（原始等距 W/A/S/D）或 `north/south/east/west`（精确网格轴） |
| `scan` | 无 | 调用现有 `SliceModel.scan()`；成功时在同一事务内写 R9 证据 |
| `jam` | `target`: `door`/`relay`/`guard` | 调用现有 `SliceModel.jam(...)`；`door` 与 `relay` 都走模型默认路径 |
| `interact` | 无 | 现有 `SliceModel.interact()` |
| `shoot_guard` | 无 | 走廊受限能力；仍受现有射程/冷却/存活判定 |
| `wait` | `ticks`（可选） | 清除移动意图 |

`aim` / `fire` / `decoy` **明确不支持**，返回 `E_NOT_APPLICABLE`；不存在 `setPosition`/`teleport` 动作。
`__testSetPosition` 仅供单测，不能通过动作或 CLI 触达。

### 2.2 确定性

- 固定 tick，不读取墙钟；`step({ticks})` 显式推进逻辑 tick。
- 动作先按 `(actor priority, actor, id, input index)` 排序，再执行；输入数组顺序不影响结果。
- 事件按 `(tick, phase, ordinal)` 生成，`eventSeq` 单调；`phase`：0 lifecycle、1 protocol、2 action、3 domain-precommit、4 domain-commit、5 observation、6 dev-audit。
- 同一 `seed` + 同一动作序列 → 相同 canonical state / events。
- 固定场景没有随机玩法，seed/RNG 按实例独立保存，但不强行随机化。

### 2.3 有界执行

`RUNTIME_LIMITS`：单步 tick 上限 1000、单步动作上限 32、移动意图上限 3600 tick、总 tick 上限 1,000,000、事件上限 10,000（超出计数 `droppedEvents`）、**私有签发快照上限 `MAX_ISSUED_SNAPSHOTS = 64`**（FIFO 淘汰，超出后最早一帧 `restore` 返回 `E_SNAPSHOT_INVALID` 且消息含 `evicted`，不会无界增长）。超限返回 `E_RESOURCE_LIMIT`，不排队执行。

### 2.3a 快照签发绑定（B4 终态）

`snapshot()` 为本实例签发一个不可伪造的私有指纹：`snapshotId`（`snap_<seed8hex><c36>`）+ 对该帧**完整权威载荷**做规范 JSON 指纹（`snapshotIdentity`，排除公共 `stateHash`/`eventsHash`，因为公共哈希不是鉴权来源）。`restore()` 与 `replay()` 强制先经过 `issuedProblem()`：

- `snapshotId` 必须在本实例的私有签发记录内（否则 `not issued`）；
- 帧的规范指纹必须与该 `snapshotId` 签发时记录的指纹**逐字节一致**（改 `model.position`、删 `DOOR_PASSED`、重算公共 `stateHash`/`eventsHash` 都将被 `mismatch` 拒绝）；
- `passed === true` 必须存在合法 `DOOR_PASSED` 事件（含 corridor 路径），否则 `passed flag without a door-pass event`；
- 内容层 `validateRestoreFrame` 仍校验 seed/sessionId/rngState 源绑定、几何（`canFit`/`canStandInCorridor`/`occupiesBridge`）、范围、事件全序、动作日志、封闭 schema、TTL。

失败原子：候选 `SliceModel` 先于替换本地状态构建；任何校验失败都不污染当前实例。跨进程导入属于新鉴权边界，未实现、不冒充。

---

### 2.4 公共观察 = P0 `ObservationV1` 白名单投影

`observe()` 返回可被 P0 `validateObservationDetailed()` 通过的 `ObservationV1`：`current.self` / `publicDeviceState` / `publicTimers` / `visibleTargets`（仅来自合法 Scan 证据）/ `knownConnections` / `evidence`（P0 schema，ID 由 adapter 稳定派生）/ `availableActions`（模型 `actionAvailability()` 当前态查询）/ `omittedFieldCount`。**不含** Guard FSM `behavior`、`reveal`/`corridorReveal` 原始布尔、`attackAt`/`jamUntil`/`watching`、seed/RNG/完整 model。`completed` 仅 `RUN_COMPLETED` 为真，`RUN_FAILED` 为失败；`failed` 独立。`aim/fire/decoy` 状态恒 `unavailable` + `E_NOT_APPLICABLE`。`hasHiddenField(observe(), ['role']) === null`（`role` 是 P0 必需字段）。

---

## 3. 浏览器与 Node 的共享接缝

1. `SliceScene.stepMovement` 改为调用 `sharedCore.stepMovement(model, intent)`；速度、各向异性、5 点 AABB footprint、轴分离碰撞与 Node 完全一致。
2. 通过门 / `enterCorridor` / 东岸 crossed 判定移到 `sharedCore.resolveTransitions`；Scene 只保留存档、提示、重绘等 UI/存储副作用，Node 只保留事件。
3. **转场提交点统一**：`SliceModel.step(delta, onTick, onCommit)` 与 `advanceTicks(n, onTick, onCommit)` 在每个逻辑 tick 结束后立刻回调 `onCommit(preTickSnapshot)`；浏览器帧批（最多 15 tick）与 Node 逐 tick 因此完全同采样率，不会因帧末采样出现规则分叉（Reviewer B1 精确反例 `passed=true, pos(12.64,5.07), south, 15 ticks` 两路径同为第 1 tick 进走廊且位置相同。
4. tick 顺序仍由 `SliceModel.tickOnce(onTick)` 拥有：实验室先移动后到期，走廊先到期/解算后移动。共享层不复制该顺序。

---

## 4. 私有运行快照 vs 浏览器 checkpoint

| 项目 | 浏览器 checkpoint `PersistedSliceState` | P1 私有运行帧 `RuntimeSnapshot` |
| --- | --- | --- |
| schema/key | `last_signal_station_zero_vs00_v1`（未改） | `last_signal.ai-native.runtime-snapshot.v1` |
| 捕获条件 | 仅清 Guard 安全点、无危险转换、不在桥上 | 任意 tick，包含活 Guard |
| 内容 | 安全点字段 + 可选 R9 evidence | 全部 private 字段：桥 deadline、relay 状态、Guard `evidence/attackAt/jamUntil/watching/hp`、`regenAcc`、`accumulatorMs`、移动意图、事件日志 |
| 用途 | 浏览器退出/刷新恢复 | 内部 replay/测试/dev 快照；**不作为 Player/Companion 响应** |
| 授权的 Player 导出 | 不允许 | 不允许；`authorizeRawFrame` 只允许 `DEVELOPER + test` |

- `restore()` 为**原子、来源绑定**：closed schema + 数值区间 + 几何 `canFit`/`canStandInCorridor` + 事件全序 + `actionLog` 元素 + `sessionId`/`seed`/`rngState` 绑定；任何失败不污染现有实例。`passed` 必须带合法 `DOOR_PASSED` 事件，禁止伪造成门/墙外位置。
- R9 证据与 `savedTick` / `scanRemaining` / 绝对 TTL / room 绑定，target/relationship/stateLabel 使用枚举白名单；过期/未来证据安全丢弃并提示重扫，进走廊清 R1 证据，绝不免费 Scan。旧档无 evidence 降级不变。
- `canonicalState()` 只覆盖权威状态，`epoch`（网关隔离）与 `accumulatorMs` / `lastResult`（传输/UI 元数据）不计入哈希；`snapshot -> restore -> 0 步 replay` 的 canonical hash 相等。哈希只是完整性，不是 Player 授权。
- 真实 `sha256:` 只在 Node 边界（CLI 的 `node:crypto`）计算，浏览器纯核心不 import Node crypto。

---

## 5. CLI（不是 MCP）

```bash
npm run game:headless   # = vite-node src/ai-native/headlessCli.ts --run --dev
```

`--dev` 是**启动时固定的本机 Dev/test 通道身份**：只有该通道允许私有帧（snapshot/restore/replay）。不加 `--dev` 是受限通道，只开放 create/step/observe/pause/resume/close/quit；自述参数 `audience:"dev"` **不能**升权。CLI 不是 MCP Server，不是 Player Gateway，也不构成 AI 通关证据。seed / RNG / Guard 内部字段只在 `--dev` 通道输出；`observe` 恒为 P0 `ObservationV1` 白名单投影（无 FSM behavior / 原始 reveal / 隐藏计时 / 未发现目标 / seed / RNG）。

`vite-node` 启动独立 Node 进程；stdin 每行一个 JSON 命令，stdout 每行一个结构化 JSON 响应，日志走 stderr。多实例用 `id` 区分。

| 命令 | 示例 | 说明 |
| --- | --- | --- |
| `create` | `{"cmd":"create","id":"g1","seed":42}` | 新建实例 |
| `step` | `{"cmd":"step","id":"g1","actions":[...],"ticks":60}` | 推进固定 tick |
| `observe` | `{"cmd":"observe","id":"g1"}` | 白名单观察；无 seed/RNG/完整内部状态 |
| `snapshot` | `{"cmd":"snapshot","id":"g1"}` | 完整私有帧 + `stateHash`/`eventsHash`；仅 `--dev` 通道 |
| `restore` | `{"cmd":"restore","id":"g1","snapshot":{...}}` | 强制 `stateHash`+`eventsHash` 齐全并校验；源绑定由 runtime 负责；仅 `--dev` |
| `replay` | `{"cmd":"replay","id":"g1","steps":[...]}` | 确定性重放并返回哈希；仅 `--dev` |
| `pause`/`resume` | `{"cmd":"pause","id":"g1"}` | 冻结/恢复 tick |
| `close`/`quit` | | 释放实例 / 立即退出（不等 stdin EOF） |

严格 schema：`actions`、`steps` 必须是数组（非数组即 `E_SCHEMA`，不静默降级）。资源上限：实例数 16、id 长度 32、JSON 行 16 KiB、快照 256 KiB、事件 10k、动作 32/step、总 replay ticks 100k、命令数 10k、会话 5 分钟。哈希是完整性校验，不是授权；不能改 payload 重算哈希就当作合法玩家恢复。

`npm run game:headless` 的 npm 横幅会写 stdout（`> last-signal@... game:headless`），直接协议入口应使用 `npx vite-node src/ai-native/headlessCli.ts --run --dev`（无 npm 横幅）。

---

## 6. 已知限制与未完成（P2+）

1. **不是 Gateway**：无 Session Manager、devTicket/AuthContext/Handshake、幂等缓存实例、速率令牌桶、事件日志持久化、MCP/WebSocket。
2. **快照/回放**只覆盖 `station-zero-r1-r2` 纯规则核心；主 `World` 变长 dt、`Math.random()`、渲染调度不在确定性承诺内。
3. **Player/Companion 响应**：`SnapshotV1`/`ReplayV1` 仍只在 dev/test 边界出现；`authorizeRawFrame` 是纯检查，真实授权仍须 P2 服务端强制执行。
4. **R9 浏览器扩展**是最小可选字段：target/relationship/stateLabel 枚举白名单、savedTick/TTL/scanRemaining/room 绑定；过期或未来证据拒绝或安全丢弃并提示重扫，进走廊清 R1 证据。完整 `ObservationEvidenceV1` 身份/epoch/evidenceId 绑定与关系白名单 ADR 仍待 P2 批准。
5. **CLI** 使用 `vite-node` 运行 TS（已在 `devDependencies` 声明），不是生产分发入口；无网络、无凭据、无外部模型。
6. **`shoot_guard`** 仅为原型受限能力，不构成通用战斗 Action API；`aim/fire/decoy` 仍未实现。
7. **哈希 = 完整性，不是授权**：`restore` 绑定 `sessionId`/`seed`/`rngState` 并做几何/事件/actionLog 校验；本机 `--dev` 通道可调试私有帧，但不能据此声称 Player Gateway 或真实 AI 通关。

---

## 7. 验证命令

```bash
npm run typecheck
npx vitest run src/ai-native/runtime.test.ts
npm test
npm run build
# Playwright: 需先启动 5173/5199（脚本不自动启动）
npx playwright test tests/vs00.spec.ts tests/vs01.spec.ts
```

证据日志统一落 `D:/Project/AI-NATIVE-01-evidence/p1-*.log`。


---

## 8. P1 阻断关闭表（Reviewer B1–B7）

| 编号 | 修复摘要 | 回归 |
| --- | --- | --- |
| B1 | `step`/`advanceTicks` 增加 `onCommit(preTick)`；Scene 与 runtime 均在每逻辑 tick 提交转场；存档/提示副作用仍留 Scene。`passed=true pos(12.64,5.07) south 15 tick` 两路径同第 1 tick 进走廊且位置相同。`runtime.test.ts` B1 两组 + 项目外 `p1-fix-developer-parity.mts`。 |
| B2 | `observe()` 改为 P0 `ObservationV1` 白名单；删 FSM behavior / 原始 reveal / 隐藏计时；`availableActions` 由模型查询；`completed` 区分失败。P0 校验通过、隐藏字段黑名单为空。`runtime.test.ts` B2 三组。 |
| B3 | R9 证据 target/relationship/stateLabel 枚举白名单；savedTick/TTL/scanRemaining/room 绑定；过期/未来证据安全丢弃并提示；进走廊清 R1 证据。`evidence.test.ts` B3 四组 + `runtime.test.ts` B3 四组。 |
| B4 | `restore` closed schema + 区间/几何/事件全序/actionLog + `sessionId`/`seed`/`rngState` 源绑定 + `passed`/finished 事件一致性；临时实例校验后原子替换；失败不污染。`runtime.test.ts` B4 五组 + CLI 强制双哈希。 |
| B5 | canonical 投影排除 `epoch`/`accumulatorMs`/`lastResult`；恢复不 `setPaused` 清 accumulator。源快照 → restore → 0 步 replay hash 相等；CLI 0 步 replay hash 相等。`runtime.test.ts` B5 两组。 |
| B6 | CLI 启动 `--dev` 固定通道身份；snapshot/restore/replay 无 `--dev` 即 `E_PERMISSION`；`audience` 自述不升权；create 不回显 seed；文档/日志明确 seed 只在 Dev 通道。`runtime.test.ts` B6 三组 + `p1-fix-developer-cli-restricted.log`。 |
| B7 | actions/steps 非数组严格 `E_SCHEMA`；实例数/id/行字节/快照/事件/actionLog/replay ticks/命令数/会话时间上限；`quit` 立即退出清理；npm 横幅与直接入口文档说明。`runtime.test.ts` B7 四组 + CLI 日志。 |

以上均为本机 Runtime 验证回归，不是真实 AI 通关证据。
