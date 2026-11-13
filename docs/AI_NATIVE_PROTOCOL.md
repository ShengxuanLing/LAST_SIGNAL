# AI-NATIVE-01 P0 — 协议契约 DTO schema v1

> 状态：**P0 可落地技术契约**；不是产品决定，不定义 ECHO 身份/世界观，不冻结旧 Bridge 文档的 6+9 工具名。
>
> 实现目标：`src/ai-native/protocol.ts` 由 Developer 负责。该文件必须是纯 TypeScript 类型 + 常量 + 无副作用校验/规范化函数；不 import `phaser`，不访问 DOM/`localStorage`，不调用 `Date.now()`/`performance.now()`/`Math.random()`，不持有任何全局可变 Session 单例。
>
> 配套：`docs/AI_NATIVE_ARCHITECTURE.md`、`docs/AI_NATIVE_PERMISSION_MODEL.md`。
>
> 基线：任务分支 `feat/ai-native-runtime` 的 `HEAD` 与 `origin/main` 均为 `c656f788227f44efec993315bfb65a323e398377`。

---

## 0. P0 收敛口径（Leader 裁决）

本节为三份契约的共同收敛口径，优先级高于正文里任何早期措辞：

- `actorId` 保持不透明，角色只由不可变 `actorRegistry` 绑定；`pause` / `resume` 接受为 `SessionCommandV1`，仍按权限矩阵由人类 UI / Gateway / Dev test 调用，PLAYER Agent / COMPANION 不得自行暂停或恢复。
- `SnapshotV1` / `ReplayV1` 是**服务端私有存储格式**，可承载内部生产状态用于服务端内部恢复；绝不作为 `PLAYER` / `COMPANION` 响应。仅 `DEVELOPER` + `kind:"test"` 可导出原始帧，不允许删去 `dev` 段后给 Player。Player 恢复走服务端内部路径，本轮不新增公开恢复凭据接口。
- `ObservationEvidenceV1` 统一带 `protocolVersion: 1`。
- P0 只交付类型、常量、schema 校验、canonical JSON、hash 字符串形状与纯比较；真实 tick 推进、幂等缓存、事件日志、restore / replay 执行留 P1–P3。文档中的运行时契约是后续实现边界，不代表 P0 已实现运行时。
- 不新增运行时或能力，不改旧存档 key/版本，不 commit、不切分支。
- P0 实现/验收范围以 §0.1 表为准；正文如出现未实现的握手、AuthContext、devTicket、Gateway 命令、refs、audience/hash projection、新 guard、summary 投影或运行时流程，一律按 P1–P3 计划解释，不冒充 P0 现状。

### 0.1 P0 实现状态表（对照 `src/ai-native/protocol.ts`）

基线：`protocol.ts` md5 `b99eb7011b148c055e14e70fb87e3d0e`，`protocol.test.ts` md5 `79359f01439ccecf063720a23ee40f66`；新增 72 / 全量 135 PASS。本表优先级高于正文后续 DTO/流程描述。

| 项目 | P0 现状 | 后续 |
| --- | --- | --- |
| 版本/常量 | `AI_NATIVE_PROTOCOL_VERSION`、七个 schema 字符串、`AI_NATIVE_SCHEMA_V1`（7 键）、错误码、`AI_NATIVE_LIMITS_V1`（大写键）、隐藏字段名、ID 正则、状态表、`GAME_IMPLEMENTATION_STATUS` 已导出且冻结 | handshake / gateway-internal schema 为 P1–P3 计划 |
| DTO/校验 | 当前 `validate*` / `*Detailed` 封闭 schema 守卫、隐藏字段拒绝、`canonicalJson`、`payloadFingerprint`、`redactError` | 文档中出现但文件未导出的新 guard 一律 P1–P3 |
| 版本辅助 | `isCompatibleVersion(input: unknown)` 接受裸 `1`，也接受 `{protocolVersion:1,schema:<AI_NATIVE_SCHEMA_V1 任一值>}`；其他 false | — |
| 纯比较 | `compareActionOrder(a,b,priorityOf)` 真实第三参数 `priorityOf(actorId)=>number`；`compareEventOrder`、`firstErrorByStage` | — |
| 授权/策略辅助 | `validateActionSupport`、`validateActionPermission`、`validateActionTargetTick`、`validateObserveDetail`、`authorizeRawFrame`、`checkIdempotency`、`validatePayloadSize`、`validateRestoredEvidence`、`validateRestoreEligibility`、`validateReplayCompatibility` 等纯 helper | 真实 Gateway 强制授权、tick/cache/log/restore/replay 执行 P1–P3 |
| 观察/detail | P0 仅 schema 校验与 `validateObserveDetail(role,detail)`；`debug` 对非 Dev `E_PERMISSION`、对 Dev `E_SCHEMA`（当前纯 helper 行为） | `summary` 空值投影、`messageKey:'USE_INSPECT_STATE'`、adapter 返回 `DebugInspectionV1` 归 adapter/P1–P3 |
| Snapshot/Replay 输入 | 当前 `RestoreRequestV1.snapshot` / `ReplayRequestV1.replay` / `ReplayV1.initialSnapshot` 是内嵌私有输入；`validateSnapshot`/`validateReplay` 只做结构校验，`authorizeRawFrame` 只做纯 audience gate | 未来公开控制帧必须改用 `SnapshotRefV1` / `ReplayRefV1`（ref+requestId+hash）；公开原始帧强制 `DEVELOPER` + `kind:'test'`，真实 Gateway 在 P1+ 强制授权 |
| 握手/认证/Gateway | `HandshakeEnvelopeV1`、`PreSessionAuthContextV1`/`AuthContextV1`、`devTicket`、`GatewayCreateTestSessionV1`/`GatewayInternalCommandV1` 均**未实现** | P1–P3 计划；正文相关 DTO 是后续契约 |
| refs/audience/hash projection/新 guard | `ref`/`requestId`、`audience`、`replayHash` 白名单 projection、新 guard、`USE_INSPECT_STATE` 均**未实现** | P1–P3 计划，不新增 P0 运行时或能力 |
| `pause`/`resume` | 仅 `SessionCommandV1.command` 字面量与 schema；无执行 | P1–P3 Gateway/Runtime |
| `aim`/`fire`/`decoy` | wire shape 合法，`validateActionSupport()` 返回 `E_NOT_APPLICABLE` | 不宣称游戏已实现 |
| 安全边界 | 结构校验不是授权；Player/Companion 不得获内部快照/隐藏状态；`authorizeRawFrame` 纯检查不替代真实 Gateway | P1+ 真实 Gateway 必须强制授权 |

---

## 1. 规范用语与版本

「必须 / MUST」为 P0 验收条件；「不得 / MUST NOT」为实现红线；「应 / SHOULD」为推荐但允许 Leader 裁决。
`protocolVersion` 是整数 `1`，不是 semver 字符串。所有 v1 对象都用封闭 schema：未知字段、嵌套未知字段、类型不符、越界数值一律拒绝，不静默剔除、不降级为原样发送。

| 常量 | 值 |
| --- | --- |
| `AI_NATIVE_PROTOCOL_VERSION` | `1` |
| `AI_NATIVE_KERNEL_VERSION_V1` | `"station-zero-r1-r2@1"` |
| `AI_NATIVE_DTO_SCHEMA_V1` | `"last_signal.ai-native.dto.v1"` |
| `AI_NATIVE_ENVELOPE_SCHEMA_V1` | `"last_signal.ai-native.envelope.v1"` |
| `AI_NATIVE_HANDSHAKE_SCHEMA_V1` | `"last_signal.ai-native.handshake.v1"`（P1–P3 计划，P0 未导出） |
| `AI_NATIVE_OBSERVATION_SCHEMA_V1` | `"last_signal.ai-native.observation.v1"` |
| `AI_NATIVE_DEBUG_SCHEMA_V1` | `"last_signal.ai-native.debug.v1"` |
| `AI_NATIVE_EVENT_SCHEMA_V1` | `"last_signal.ai-native.event.v1"` |
| `AI_NATIVE_SNAPSHOT_SCHEMA_V1` | `"last_signal.ai-native.snapshot.v1"` |
| `AI_NATIVE_REPLAY_SCHEMA_V1` | `"last_signal.ai-native.replay.v1"` |
| `AI_NATIVE_GATEWAY_INTERNAL_SCHEMA_V1` | `"last_signal.ai-native.gateway-internal.v1"`（P1–P3 计划，P0 未导出） |

`AI_NATIVE_SCHEMA_V1` 是七个 P0 schema 字符串的只读汇总对象，必须导出；`handshake` / `gatewayInternal` 是 P1–P3 计划，不在 P0 汇总对象里。P0 形状固定为：

```ts
interface AiNativeSchemaMapV1 {
  readonly dto: 'last_signal.ai-native.dto.v1';
  readonly envelope: 'last_signal.ai-native.envelope.v1';
  readonly observation: 'last_signal.ai-native.observation.v1';
  readonly debug: 'last_signal.ai-native.debug.v1';
  readonly event: 'last_signal.ai-native.event.v1';
  readonly snapshot: 'last_signal.ai-native.snapshot.v1';
  readonly replay: 'last_signal.ai-native.replay.v1';
}
// handshake / gatewayInternal：P1-P3 计划，不在 P0 AI_NATIVE_SCHEMA_V1 中。
```

`hello` / 能力协商在 P0 不做；版本或 schema 字符串不精确匹配即 `E_VERSION_UNSUPPORTED`。v1 不接受「高版本兼容」「最小公共能力集」「未知字段宽松模式」。

`AI_NATIVE_ERROR_CODES_V1` 是全部错误码的只读数组，也是 `ErrorCodeV1` 的唯一真源：

```ts
const AI_NATIVE_ERROR_CODES_V1 = [
  'E_SCHEMA', 'E_VERSION_UNSUPPORTED', 'E_PAYLOAD_TOO_LARGE',
  'E_SESSION_NOT_FOUND', 'E_SESSION_CLOSED', 'E_STALE_EPOCH',
  'E_STALE_GENERATION', 'E_TARGET_DESTROYED', 'E_STALE_TICK', 'E_FUTURE_TICK',
  'E_UNKNOWN_ACTOR', 'E_ID_PAYLOAD_MISMATCH', 'E_ACTION_EXPIRED',
  'E_PERMISSION', 'E_PAUSED', 'E_NOT_APPLICABLE', 'E_ILLEGAL_TARGET',
  'E_LINK_UNAVAILABLE', 'E_RETRYABLE', 'E_ENERGY_INSUFFICIENT', 'E_COOLDOWN',
  'E_RATE_LIMIT', 'E_RESOURCE_LIMIT', 'E_CANCELLED', 'E_PREEMPTED', 'E_TIMEOUT',
  'E_SNAPSHOT_INVALID', 'E_REPLAY_INCOMPATIBLE', 'E_SAVE_FAILED',
  'E_INTERNAL_TRANSACTION',
] as const;
type ErrorCodeV1 = typeof AI_NATIVE_ERROR_CODES_V1[number];
```

`isCompatibleVersion(input: unknown)` 是 P0 版本辅助函数：接受裸 `1`，也接受 `{protocolVersion:1,schema:<AI_NATIVE_SCHEMA_V1 七个键之一>}`；`protocolVersion!==1`、缺 schema、未知 schema、`null`、字符串 `'1'` 均返回 false。§6.2 不再重复声明 `ErrorCodeV1`。

---

## 2. 通用原语

### 2.1 ID、数值与认证上下文

```ts
type SessionId = `ses_${string}`;      // Gateway 生成，24 lowercase hex，不透明
type ActorId   = `act_${string}`;      // Gateway 生成，16 lowercase hex，不透明；不得从中推断 role
type ActionId   = `aid_${string}`;      // 幂等键，24 lowercase hex；同会话内唯一
type RequestId  = `req_${string}`;      // 命令请求 ID，24 lowercase hex
type TargetId   = `tgt_${string}`;      // 核心目标注册表派生的不透明 ID，只能从合法观察获得
type EvidenceId = `ev_${string}`;
type EventId    = `evt_${string}`;
type SnapshotId = `snap_${string}`;
type Epoch      = number;              // uint32 safe integer
type Tick       = number;              // uint53 safe integer，逻辑 tick
type ClientSeq  = number;              // uint53，单 session 单调递增，仅传输排序/重放检测
type Ms         = number;              // uint53，仅审计/传输超时，不进入权威规则

interface WxWyV1 { x: number; y: number } // wx/wy 网格坐标；有限数；禁止屏幕像素/等距投影坐标
```

认证上下文由 Gateway 从已认证传输通道派生，**不是请求体字段**。会话存在前用 `PreSessionAuthContextV1`，会话存在后扩展为 `AuthContextV1`：

```ts
interface PreSessionAuthContextV1 {
  channel: 'human-ui' | 'player-agent' | 'dev-stdio' | 'gateway-internal';
  authLevel: 'player' | 'developer-test';
  ticketId?: string;                  // devTicket 校验后派生的不透明引用 ID，不含票据值
  clientNonce: string;
}

interface AuthContextV1 extends PreSessionAuthContextV1 {
  principalActorId: ActorId;
  principalRole: 'PLAYER' | 'COMPANION' | 'DEVELOPER';
  sessionId: SessionId;
  sessionKind: 'production' | 'test';
}
```

硬规则：任何会话内请求里的 `actorId` 只用于与 `AuthContextV1.principalActorId` 做一致性比对；该检查属于权限闸门，放在 §6.1 阶段 6，不一致即 `E_PERMISSION`。`role` / `permission` / `asActor` / `impersonate` / `kind` / `debug` / `seed` / `fixture` 等**字段名**若出现在 `ActionRequestV1`、`StepRequestV1`、`SessionCommandV1`、`ObserveRequestV1`、`GetEventsRequestV1`、`CancelActionRequestV1` 等普通请求体，都是未知字段，`E_SCHEMA` 拒绝；这不禁止 `observationDetail`/`detail` 的合法字面量 `'debug'`。`create_session` / `create_test_session` 发生在 `sessionId` / `principalActorId` 存在之前，只使用 `PreSessionAuthContextV1` + `clientNonce` / `devTicket`，仅过 §6.1 阶段 0/1，阶段 2–13 不适用。外部客户端不能通过参数把 `kind` 改成 `'test'`。

`issuedAtMs` / `receivedAtMs` / `expiresAtMs` 只用于传输超时和审计；核心排序、TTL、冷却、deadline 一律用 `tick` / `deadlineTick`。禁止离线补时。

### 2.2 canonical JSON 与哈希

`canonicalJson(value)` 必须由 `protocol.ts` 导出：对象键按 UTF-16 码点升序、数组保序、只接受 null/boolean/finite number/string/array/plain object；`undefined`、`NaN`、`Infinity`、`Date`、`Map`、`Set`、函数、类实例、循环引用一律拒绝。

`payloadFingerprint(value)` = `"fnv1a32:" + 8 位小写十六进制`，对 `canonicalJson(value)` 的 UTF-8 字节做 FNV-1a 32，纯 TS 实现。

`stateHash` / `eventsHash` / `snapshotHash` = `"sha256:" + 64 位小写十六进制`，由 Gateway/Runtime 对 canonical JSON 计算；这三者的输入不得含 `issuedAtMs`、`transportSeq`、stack、文件路径，Player/Companion 可见对象不得含 seed 明文。`replayHash` 同样是 `sha256:` 字符串，但按 §9.4 的显式字段白名单计算；`protocol.ts` 只校验字符串形状，不引入 Node `crypto`。

---

## 3. 信封、Session 创建与 Gateway 内部命令

### 3.1 握手信封与 Player Session 创建

`create_session` 发生在 `sessionId` / `principalActorId` 存在之前，必须用独立 `HandshakeEnvelopeV1`，**不套** §3.3 的 `AiNativeEnvelopeV1`。握手帧与 `GatewayCreateTestSessionV1` 仅经过 §6.1 阶段 0/1 的字节/schema/version 校验，阶段 2–13 不适用；改由 `validateHandshakeEnvelope` / `validateGatewayInternalCommand` 加 `PreSessionAuthContextV1`、`clientNonce`、`devTicket` 单独校验。

```ts
type HandshakeKindV1 = 'request' | 'response' | 'error';

interface HandshakeEnvelopeV1 {
  schema: 'last_signal.ai-native.handshake.v1';
  protocolVersion: 1;
  kind: HandshakeKindV1;
  requestId: RequestId;
  correlationId?: RequestId;
  issuedAtMs: Ms;
  sessionId?: SessionId;              // 仅 response/error 可带
  epoch?: Epoch;
  transportSeq?: ClientSeq;
  payload: CreatePlayerSessionRequestV1 | CreatePlayerSessionResponseV1 | ErrorV1;
}

interface CreatePlayerSessionRequestV1 {
  schema: 'last_signal.ai-native.dto.v1';
  protocolVersion: 1;
  requestId: RequestId;
  mode: 'headless' | 'rendered';
  scenarioId: 'station-zero-r1-r2';
  clientNonce: string;               // 24 lowercase hex，仅防重放
  includeCompanion: boolean;         // 非特权；Gateway 决定是否创建 COMPANION actor
}

interface CreatePlayerSessionResponseV1 {
  schema: 'last_signal.ai-native.dto.v1';
  protocolVersion: 1;
  requestId: RequestId;
  sessionId: SessionId;
  sessionKind: 'production';         // 固定，不接受客户端覆盖
  mode: 'headless' | 'rendered';
  status: 'created';
  epoch: Epoch;
  tick: 0;
  actorRegistry: Record<ActorId, PublicActorBindingV1>; // 不含 seed/fixture/权限提升字段
  resourceLimits: ResourceLimitsV1;
}

interface PublicActorBindingV1 {
  actorId: ActorId;
  role: 'PLAYER' | 'COMPANION';
  priority: 0 | 1;
  allowedActions: ActionTypeV1[];
  observationScope: 'self' | 'shared';
}
```

判别约束：`kind:'request'` 只能配 `CreatePlayerSessionRequestV1`，`kind:'response'` 只能配 `CreatePlayerSessionResponseV1`，`kind:'error'` 只能配 `ErrorV1`；`HandshakeKindV1` 与会话内 `EnvelopeKindV1` 是两套独立判别式，不共用 `notification`。

`CreatePlayerSessionRequestV1` 不得出现 `kind` / `role` / `seed` / `fixtureRef` / `DEVELOPER` / `debug`。Gateway 固定创建 `kind:'production'`，只为 `PLAYER` 和可选 `COMPANION` 绑定 actor。

### 3.2 Gateway 内部：创建 Dev/Test Session

`GatewayCreateTestSessionV1` 不是公共 `RequestV1`；只能由本机已认证 Dev 通道或 Gateway 内部调用，必须校验短期不透明 `devTicket`。`devTicket` 由本地带外流程签发，仅存在于带外通道与 `gateway-internal.v1` 命令中，不是 API Key 明文，不进入任何浏览器或外部 DTO；校验通过后只在 `PreSessionAuthContextV1.ticketId` 里保留不透明引用 ID。

```ts
interface GatewayCreateTestSessionV1 {
  schema: 'last_signal.ai-native.gateway-internal.v1';
  protocolVersion: 1;
  requestId: RequestId;
  command: 'create_test_session';
  kind: 'test';                      // 固定；外部请求体不存在此字段
  mode: 'headless' | 'rendered';
  scenarioId: 'station-zero-r1-r2';
  actorSpecs: Array<{
    role: 'PLAYER' | 'COMPANION' | 'DEVELOPER';
    observationScope: 'self' | 'shared' | 'debug';
    allowedActions: ActionTypeV1[];
  }>;
  seed?: number;
  fixtureRef?: string;
  resourceLimits?: Partial<ResourceLimitsV1>; // 只能收紧
  devTicket: string;                 // 短期不透明票据，Gateway 带外验证
}

type GatewayInternalCommandV1 = GatewayCreateTestSessionV1;
```

任何外部 `AiNativeEnvelopeV1` / `HandshakeEnvelopeV1` 中出现 `schema:'last_signal.ai-native.gateway-internal.v1'` 或 `devTicket` 都按 `E_PERMISSION` 拒绝。`kind:'test'` 与 `DEVELOPER` 只能由该内部命令创建；Production `CreatePlayerSessionRequestV1` 路径不存在通向 Dev 的分支。

### 3.3 会话内信封与顶层联合

```ts
type EnvelopeKindV1 = 'request' | 'response' | 'event';

interface AiNativeEnvelopeV1 {
  schema: 'last_signal.ai-native.envelope.v1';
  protocolVersion: 1;
  sessionId: SessionId;
  epoch: Epoch;
  transportSeq: ClientSeq;
  kind: EnvelopeKindV1;
  requestId?: RequestId;
  correlationId?: RequestId | ActionId;
  issuedAtMs: Ms;
  payload: RequestV1 | ResponseV1 | EventV1;
}

type RequestV1 =
  | StepRequestV1
  | ObserveRequestV1
  | GetEventsRequestV1
  | CancelActionRequestV1
  | SessionCommandV1;

type ResponseV1 =
  | StepResultV1
  | ObservationV1
  | DebugInspectionV1
  | EventPageV1
  | ActionResultV1
  | CommandAckV1
  | ErrorV1;
```

`SnapshotV1` / `ReplayV1` 是独立大帧（§9），不嵌入普通 `AiNativeEnvelopeV1`。`transportSeq` 在 `sessionId` 内单调递增，只检测乱序/丢帧；**不得**参与权威 tick 排序。重复 `transportSeq` / `requestId` 按幂等重放处理，不二次执行。

以下是契约目标导出清单；**P0 实际导出/行为以 §0.1 表为准**，当前文件未导出的 guard 均列 P1–P3，不计入 P0 验收：

```ts
validateHandshakeEnvelope(input: unknown): input is HandshakeEnvelopeV1;
validateGatewayInternalCommand(input: unknown): input is GatewayInternalCommandV1;
validatePreSessionAuthContext(input: unknown): input is PreSessionAuthContextV1;
validateAuthContext(input: unknown): input is AuthContextV1;
validateEnvelope(input: unknown): input is AiNativeEnvelopeV1;
validateRequest(input: unknown): input is RequestV1;
validateResponse(input: unknown): input is ResponseV1;
validateActionRequest(input: unknown): input is ActionRequestV1;
validateObservation(input: unknown): input is ObservationV1;
validateObservationEvidence(input: unknown): input is ObservationEvidenceV1;
validateActionCapability(input: unknown): input is ActionCapabilityV1;
validateKnowledge(input: unknown): input is KnowledgeV1;
validateHypothesis(input: unknown): input is HypothesisV1;
validateDebugInspection(input: unknown): input is DebugInspectionV1;
validateEvent(input: unknown): input is EventV1;
validateEventPage(input: unknown): input is EventPageV1;
validateCommandAck(input: unknown): input is CommandAckV1;
validateSessionDescriptor(input: unknown): input is SessionDescriptorV1;
validatePublicActorBinding(input: unknown): input is PublicActorBindingV1;
validateResourceLimits(input: unknown): input is ResourceLimitsV1;
validateResourceUsage(input: unknown): input is ResourceUsageV1;
validateSnapshot(input: unknown): input is SnapshotV1;
validateReplay(input: unknown): input is ReplayV1;
validateSnapshotRef(input: unknown): input is SnapshotRefV1;
validateReplayRef(input: unknown): input is ReplayRefV1;
isCompatibleVersion(input: unknown): boolean; // P0 接受裸 1 或精确 schema 对象
canonicalJson(value: unknown): string;
payloadFingerprint(value: unknown): string;
redactError(error: ErrorV1): ErrorV1;
compareActionOrder(a: ActionRequestV1, b: ActionRequestV1, priorityOf: (actorId: ActorId) => number): number;
compareEventOrder(a: EventV1, b: EventV1): number;
```

以及常量：§1 表中 9 个 `AI_NATIVE_*_SCHEMA_V1` 字符串常量、`AI_NATIVE_PROTOCOL_VERSION`、`AI_NATIVE_KERNEL_VERSION_V1`、`AI_NATIVE_SCHEMA_V1: AiNativeSchemaMapV1`、`AI_NATIVE_ERROR_CODES_V1`、`AI_NATIVE_LIMITS_V1: ResourceLimitsV1`、`AI_NATIVE_HARD_LIMITS_V1: ResourceHardLimitsV1`。`AI_NATIVE_SCHEMA_V1` 是九个 schema 字符串的只读汇总，验收时既可直接导入九个常量，也可从汇总对象取值。

---

## 4. Session / Actor / Action DTO

### 4.1 Session 与 Actor 绑定

```ts
type RoleV1 = 'PLAYER' | 'COMPANION' | 'DEVELOPER';
type ObserverRoleV1 = 'PLAYER' | 'COMPANION'; // DEVELOPER 不产生普通 ObservationV1
type SessionKindV1 = 'production' | 'test';
type ModeV1 = 'headless' | 'rendered';
type SessionStatusV1 = 'created' | 'running' | 'paused' | 'finished' | 'closed' | 'failed';
type RunEndReasonV1 = 'completed' | 'died' | 'cancelled' | 'timeout' | 'closed' | null;
type ObservationScopeV1 = 'self' | 'shared' | 'debug';
type ObservationDetailV1 = 'summary' | 'standard' | 'debug';

interface ActorBindingV1 {
  actorId: ActorId;
  role: RoleV1;
  priority: 0 | 1 | 2;              // PLAYER=0, COMPANION=1, DEVELOPER=2；创建时固定
  allowedActions: ActionTypeV1[];
  observationScope: ObservationScopeV1; // DEVELOPER 用 debug，但不产生普通 ObservationV1
}

interface SessionDescriptorV1 {
  schema: 'last_signal.ai-native.dto.v1';
  protocolVersion: 1;
  sessionId: SessionId;
  kind: SessionKindV1;               // 不可变
  mode: ModeV1;
  status: SessionStatusV1;
  epoch: Epoch;
  tick: Tick;
  scenarioId: 'station-zero-r1-r2';
  kernelVersion: 'station-zero-r1-r2@1';
  runId: string;
  runEndReason: RunEndReasonV1;
  actorRegistry: Record<ActorId, ActorBindingV1>;
  createdAtMs: Ms; lastActivityMs: Ms; expiresAtMs: Ms;
  resourceLimits: ResourceLimitsV1;
}
```

`seed` / `rngState` / `fixture` / 完整 map 不在 `SessionDescriptorV1` 里；只在 Dev 私有调试域。`mode:'headless'` 不等于 Dev。`SessionDescriptorV1` 是 Gateway 内部状态，不进入 `RequestV1` / `ResponseV1`；`CreatePlayerSessionResponseV1.actorRegistry` 是它的白名单投影 `PublicActorBindingV1`。

### 4.2 ActionRequestV1

```ts
type ActionTypeV1 =
  | 'move' | 'aim' | 'fire' | 'scan' | 'jam' | 'interact'
  | 'shoot_guard' | 'decoy' | 'wait';

type ActionPayloadV1 =
  | { type: 'move';   direction: WxWyV1; durationTicks: number }
  | { type: 'aim';    direction: WxWyV1 }
  | { type: 'fire';   held: boolean; durationTicks: number }
  | { type: 'scan';   }
  | { type: 'jam';    targetId: TargetId }
  | { type: 'interact'; targetId: TargetId }
  | { type: 'shoot_guard'; targetId: TargetId }
  | { type: 'decoy';  position: WxWyV1 }
  | { type: 'wait';   durationTicks: number };

interface ActionRequestV1 {
  schema: 'last_signal.ai-native.dto.v1';
  protocolVersion: 1;
  actionId: ActionId;
  actorId: ActorId;                  // 必须与 AuthContext.principalActorId 一致
  sessionId: SessionId;
  epoch: Epoch;
  targetTick: Tick;                  // 必须等于当前 tick + 1
  type: ActionTypeV1;
  payload: ActionPayloadV1;          // payload.type 必须严格等于外层 type
  clientSeq: ClientSeq;
  issuedAtMs: Ms;
  deadlineTick: Tick;
}
```

- `aim` / `fire` / `decoy` 在 `station-zero-r1-r2` 的 P0 实现里返回 `E_NOT_APPLICABLE`，不得伪装成已实现战斗/诱饵。
- `move` 的 `direction` 是 `wx/wy` 方向意图，不是坐标增量；adapter 复用 `SliceScene` 的 W/A/S/D→世界向量映射与 `canStand` 轴分离碰撞。禁止传 `speed` / `position` / `teleport` / `ignoreCollision`。
- `move` / `wait` 是持续 intent；`durationTicks` 范围 `1..AI_NATIVE_LIMITS_V1.maxActionDurationTicks`。完成/取消/抢占/超时必须清除 intent。
- `scan` / `jam` / `interact` / `shoot_guard` 是瞬时动作。`interact()` 本身无 target 参数，adapter 按当前 `roomId` 选择实验室或走廊分支；DTO 的 `targetId` 必须先通过当前房间与授权可见性校验。

内部目标注册表（不外发给 Player/Companion 的完整列表）：

| TargetId | 对应现有规则入口 | 可见前提 |
| --- | --- | --- |
| `tgt_lab_door_receiver` | `SliceModel.jam()` 默认 / `ROOM.receiver` | 距离/LOS 合法且当前可观察 |
| `tgt_lab_door` | `SliceModel.interact()` 实验室分支 | 当前房间普通可见 |
| `tgt_lab_seal_source` | 仅 Scan 证据目标，无直接写动作 | 仅 Scan 揭示；不得由端点臆造连接 |
| `tgt_corridor_relay` | `SliceModel.jam('relay')` / `Corridor.canJam()` | 当前房间且距离/LOS 合法 |
| `tgt_corridor_guard` | `SliceModel.jam('guard')` / `shootGuard()` | 当前房间且目标可见 |
| `tgt_corridor_control` | `SliceModel.interact()` 走廊分支 | 靠近岸边控制器且 LOS 合法 |
| `tgt_corridor_bridge` | 只读观察目标 | 当前桥态/Scan 证据；无直接写动作 |

`SliceModel.enterCorridor()` / `markPassed()` 是 adapter 依据权威位置/房间条件触发的内部转移，不是 Player/Companion 可直接调用的 Action。`SliceModel.setSealSourcePresent()` 是领域测试 hook，只能由 `DEVELOPER` 的 `inject_fixture` 在 test 会话调用，禁止出现在 Player/Companion 动作面。

### 4.3 Step / Observe / Events / Cancel

```ts
interface StepRequestV1 {
  schema: 'last_signal.ai-native.dto.v1';
  protocolVersion: 1;
  requestId: RequestId;
  sessionId: SessionId;
  epoch: Epoch;
  actorId: ActorId;                  // 与 AuthContext 一致性比对
  fromTick: Tick;
  ticks: number;                     // 1..resourceLimits.maxTicksPerStep
  actions: ActionRequestV1[];        // <= maxActionsPerTick；全部 targetTick===fromTick+1
  includeObservation: boolean;
  observationDetail?: ObservationDetailV1; // debug 字面量通过 schema，阶段 6 统一处理
}

interface ObserveRequestV1 {
  schema: 'last_signal.ai-native.dto.v1';
  protocolVersion: 1;
  requestId: RequestId;
  sessionId: SessionId;
  epoch: Epoch;
  actorId: ActorId;
  detail: ObservationDetailV1;       // debug 字面量通过 schema，阶段 6 统一 E_PERMISSION / USE_INSPECT_STATE
  sinceEventSeq?: number;
  maxEvents?: number;                // <= limits.maxObservationEvents
}

契约目标（adapter/P1–P3）：同时检查 `StepRequestV1.observationDetail` 与 `ObserveRequestV1.detail`；P0 只有 `validateObserveDetail(role,detail)` 纯 helper，`USE_INSPECT_STATE` 与 summary 空值投影属于 adapter 阶段，不作为 P0 已实现行为。

interface GetEventsRequestV1 {
  schema: 'last_signal.ai-native.dto.v1';
  protocolVersion: 1;
  requestId: RequestId;
  sessionId: SessionId;
  epoch: Epoch;
  actorId: ActorId;
  cursor?: number;                   // 上次返回的 nextCursor
  limit: number;                     // 1..maxEventsPerPage
  includeDevAudit?: boolean;         // 仅 DEVELOPER + kind:'test'
}

interface CancelActionRequestV1 {
  schema: 'last_signal.ai-native.dto.v1';
  protocolVersion: 1;
  requestId: RequestId;
  sessionId: SessionId;
  epoch: Epoch;
  actorId: ActorId;
  actionId: ActionId;
  reason: 'client_cancel' | 'human_takeover' | 'timeout' | 'session_close';
}
```

### 4.4 SessionCommandV1（会话/Dev 命令统一入口）

```ts
interface SessionCommandBaseV1 {
  schema: 'last_signal.ai-native.dto.v1';
  protocolVersion: 1;
  requestId: RequestId;
  sessionId: SessionId;
  epoch: Epoch;
  actorId: ActorId;                  // 与 AuthContext 一致性比对
}

interface SnapshotRefV1 {
  snapshotId: SnapshotId; snapshotHash: string; ref: string; requestId: RequestId;
}
interface ReplayRefV1 {
  replayHash: string; ref: string; requestId: RequestId;
}

type SessionCommandV1 =
  | (SessionCommandBaseV1 & { command: 'pause'; reason?: string })
  | (SessionCommandBaseV1 & { command: 'resume' })
  | (SessionCommandBaseV1 & { command: 'reset'; newRun: true })
  | (SessionCommandBaseV1 & { command: 'close'; reason?: string })
  | (SessionCommandBaseV1 & { command: 'snapshot'; label?: string; includeDev?: boolean })
  | (SessionCommandBaseV1 & { command: 'restore'; snapshot: SnapshotRefV1 })
  | (SessionCommandBaseV1 & { command: 'replay'; replay: ReplayRefV1; stopOnMismatch: boolean })
  | (SessionCommandBaseV1 & { command: 'inspect_state'; detail: 'debug' })
  | (SessionCommandBaseV1 & { command: 'inject_fixture'; fixtureId: string; targetId: TargetId; values: Readonly<Record<string, string | number | boolean>> });
```

`snapshot` / `restore` / `replay` 命令都是 `DEVELOPER` + `kind:'test'` 命令；`SnapshotV1` / `ReplayV1` 是服务端私有存储格式，服务端内部可读写作恢复用途，但**外部导出**仅 Dev/test。`restore` / `replay` 只携带 `SnapshotRefV1` / `ReplayRefV1`（含 `ref` + `requestId` + hash）；实际大帧通过 §9 独立帧传输，避免 4 KiB 控制帧上限自锁。浏览器退出/刷新恢复最近安全点是 Gateway/适配层内部状态路径，不导出 `SnapshotV1`，也不是 AI 可调的 `restore` 命令。Player/Companion 不得导出 `ReplayV1`；授权轨迹只通过 `GetEventsRequestV1` 分页提供脱敏事件。`snapshot` 仅允许 `paused` / `finished` 状态，`restore` 仅允许 `created` / `paused` 状态；`running` 必须先 `pause`，违规在阶段 6 返回 `E_PERMISSION` + `messageKey:'INVALID_SESSION_STATE'`，不新增错误码。

### 4.5 响应 DTO

```ts
type ActionStatusV1 = 'pending' | 'active' | 'completed' | 'rejected' | 'timeout' | 'cancelled' | 'preempted';

interface ActionResultV1 {
  schema: 'last_signal.ai-native.dto.v1';
  protocolVersion: 1;
  sessionId: SessionId;
  epoch: Epoch;
  tick: Tick;
  actionId: ActionId;
  actorId: ActorId;
  status: ActionStatusV1;
  code: ErrorCodeV1 | 'OK';
  cost: number;
  resourceWritesThisCall: 0 | 1;
  replayed: boolean;
  durationRemainingTicks?: number;
  correlationId?: RequestId;
  messageKey?: string;
}

interface StepResultV1 {
  schema: 'last_signal.ai-native.dto.v1';
  protocolVersion: 1;
  sessionId: SessionId;
  epoch: Epoch;
  fromTick: Tick;
  toTick: Tick;
  status: 'completed' | 'paused' | 'finished' | 'rejected' | 'cancelled';
  actionResults: ActionResultV1[];
  events: EventV1[];
  eventCursor: number;
  observation?: ObservationV1;
  postStateHash: string;
  resourceUsage: ResourceUsageV1;
}

interface EventPageV1 {
  schema: 'last_signal.ai-native.dto.v1';
  protocolVersion: 1;
  sessionId: SessionId;
  epoch: Epoch;
  events: EventV1[];
  nextCursor: number | null;
  droppedEvents: number;
  truncated: boolean;
}

type CommandNameV1 =
  | SessionCommandV1['command']
  | 'step' | 'observe' | 'get_events' | 'cancel_action';

interface CommandAckV1 {
  schema: 'last_signal.ai-native.dto.v1';
  protocolVersion: 1;
  sessionId: SessionId;
  epoch: Epoch;
  requestId: RequestId;
  command: CommandNameV1;
  status: 'accepted' | 'rejected' | 'completed';
  code: ErrorCodeV1 | 'OK';
  snapshotHash?: string;
  snapshotRef?: string;
  replayHash?: string;
  replayRef?: string;
}
```

`CommandAckV1` 只用于已存在 `sessionId` 的会话内命令；`create_session` 用 `CreatePlayerSessionResponseV1`，`create_test_session` 用 Gateway 内部回执，二者都不套 `CommandAckV1`。

```ts
interface ErrorV1 {
  schema: 'last_signal.ai-native.dto.v1';
  protocolVersion: 1;
  sessionId?: SessionId;
  epoch?: Epoch;
  tick?: Tick;
  requestId?: RequestId;
  correlationId?: RequestId | ActionId;
  code: ErrorCodeV1;
  messageKey: string;
  retryable: boolean;
}
```

错误信息不得包含 `MapData.seed`、`GameScene.seed`、`RNG.state`、`bestSeed`、`SaveData.*`、`EnemyData` 内部计时、文件路径、环境变量、堆栈或 Dev fixture 值。`redactError()` 必须再做一次黑名单检查。

---

## 5. Observation DTO、白名单与历史证据

### 5.1 观察分层

```ts
interface ObservationV1 {
  schema: 'last_signal.ai-native.observation.v1';
  protocolVersion: 1;
  sessionId: SessionId;
  epoch: Epoch;
  tick: Tick;
  actorId: ActorId;
  role: ObserverRoleV1;              // 来自 actorRegistry，不是请求参数
  detail: 'summary' | 'standard';   // debug 不在此 schema
  roomId: 'station-zero-r1' | 'station-zero-r2';
  current: CurrentFactsV1;
  evidence: ObservationEvidenceV1[];
  knowledge: KnowledgeV1[];
  hypotheses: HypothesisV1[];
  events: EventV1[];
  recentEventCount: number;         // summary 下 events 为空时用此计数
  availableActions: ActionCapabilityV1[];
  omittedFieldCount: number;
}

interface KnowledgeV1 {
  knowledgeId: string;
  statement: string;
  confirmedAtTick: Tick;
  evidenceIds: EvidenceId[];
}

interface HypothesisV1 {
  hypothesisId: string;
  statement: string;
  confidence: number;               // 0..1
  evidenceIds: EvidenceId[];
}
```

`summary` 与 `standard` 使用**同一个封闭 ObservationV1 形状**：`summary` 不得省略必填字段，而是把 `evidence` / `knowledge` / `hypotheses` / `events` / `visibleTargets` / `knownConnections` 置空数组，`publicTimers` 置零值；`current.self` 与 `current.publicDeviceState` 仍填公开白名单字段，`availableActions` 只保留 `type/status`。`recentEventCount` 是本次可授权事件总数：`events` 最多保留 `maxObservationEvents` 条，超出则截断且 `truncatedObservation=true`；`standard` 下 `recentEventCount=events.length`、`omittedFieldCount=0`，`summary` 下 `omittedFieldCount` 为被置空/置零的字段计数。`detail:'debug'` 不产生 `ObservationV1`，只有 `inspect_state` 返回 `DebugInspectionV1`。

### 5.2 `current` 字段白名单

```ts
interface CurrentFactsV1 {
  self: {
    position: WxWyV1;
    energy: number;
    hp?: number; maxHp?: number;
    alive: boolean; paused: boolean;
    passed: boolean; crossed: boolean; failed: boolean; completed: boolean;
  };
  publicDeviceState: {
    door: 'SEALED' | 'JAMMED_OPEN' | 'OPEN' | 'CLOSED' | 'SAFE_PENDING_CLOSE';
    doorPassable: boolean;
    relay?: 'ACTIVE' | 'INACTIVE' | 'JAMMED' | 'DISABLED';
    effectiveOutput?: boolean;
    bridge?: 'UNAVAILABLE' | 'TRANSITIONING' | 'STABLE' | 'UNSTABLE' | 'DISABLED';
    bridgePassable?: boolean;
    guardLink?: 'DEAD' | 'JAMMED' | 'LINKED' | 'DISCONNECTED';
    guardHp?: number;
    canInteract?: boolean;
    onBridge?: boolean;
    lastShore?: 'west' | 'east';
  };
  publicTimers: {
    scanCooldownTicks: number;
    jamCooldownTicks: number;
    scanRevealRemainingTicks: number;
    jamRemainingTicks: number;
    safeClearRemainingTicks: number;
    guardJamRemainingTicks?: number;
    bridgeRemainingTicks?: number;
  };
  visibleTargets: Array<{
    targetId: TargetId;
    kind: 'door' | 'receiver' | 'source' | 'relay' | 'bridge' | 'guard' | 'control';
    publicState: string;
    position?: WxWyV1;
    visibility: 'ordinary' | 'scan-revealed' | 'echo-shared';
  }>;
  knownConnections: Array<{
    relationId: string;
    fromTargetId: TargetId;
    toTargetId: TargetId;
    stateLabel: string;
    evidenceId: EvidenceId;
  }>;
}
```

### 5.3 隐藏字段黑名单（出参侧强制）

禁止出现：`seed` / `rngState` / `RNG.state` / `bestSeed` / `GameScene.seed` / `MapData.tiles|doorways|roomsOrder` 全量 / 未探索房间 / 未来阶段 / `EnemyData.stateTimer|patrolPoints|patrolIndex|stunTimer|targetId|aggroRange|state` / `ProjectileData.hitSet` / `SaveData.*` / `window.__game` / `Phaser.Scene` / `World` / `Player` 实例 / `Set` / `Map` / 函数 / class 实例。

`SliceSnapshot` 内部字段尤其禁止：`manualOpenIntent`、`sealSourcePresent`、`pendingSafeClose`、`occupancy`、`revealDoorReceiver`、`revealSealSource`、`reveal` 原始布尔、`deadline`、`regenAcc`。`CorridorSnapshot` 内部字段尤其禁止：`listeners`、`guard.evidence`、`guard.attackAt`、`guard.watching`、`nextShotTick`、`lastShore` 除上表授权情形、`onBridge` 除上表授权情形、`bridgeRemainingTicks` 除 `publicTimers`。

出参顺序：Gateway 从白名单构造新对象 → `validateObservation()` 二次校验 → 黑名单终检 → 才允许发送。校验失败返回 `E_SCHEMA` / `E_INTERNAL_TRANSACTION`，**不得**回退到原始对象。

### 5.4 历史证据 `ObservationEvidenceV1`

```ts
interface ObservationEvidenceV1 {
  schema: 'last_signal.ai-native.observation.v1';
  protocolVersion: 1;
  evidenceId: EvidenceId;
  sceneEpoch: Epoch;
  roomId: 'station-zero-r1' | 'station-zero-r2';
  sourceActionId: ActionId;
  source: 'player-scan';
  observerActorId: ActorId;
  observerPosition: WxWyV1;
  targetId: TargetId;
  relationId?: string;
  observedAtTick: Tick;
  expiresAtTick: Tick;
  observedState: Readonly<Record<string, string | number | boolean>>;
}
```

`observedState` 允许键白名单：`stateLabel`、`signalPresent`、`suppressed`、`bridgePassable`、`effectiveOutput`、`guardLink`、`discovered`、`linkVisible`。值不得是对象/数组/坐标/内部枚举实例。

`live` / `stale` 由 `currentTick < expiresAtTick` 派生，不持久化。关系证据必须在 Scan 时合法看见关系；只见两个端点**不得**自动确认连接。当前 `SliceModel.snapshot().reveal.link` 是「两个端点布尔同时为真」的局部简化，**不得**直接当作 `relationId` 或 `knownConnections` 证据；在关系白名单 ADR 批准前，`knownConnections` 只能来自显式授权的关系采样。

恢复规则：

1. Snapshot 中证据数组深拷贝；`restore()` 只校验 `sceneEpoch`、`roomId`、`targetId` 白名单、`0 <= observedAtTick <= savedTick < expiresAtTick`、字段形状。
2. 绝不调用 `scan()`、LOS 或当前位置重算；旧档无证据则清空并提示重新扫描。默认不补 Energy、不补连接、不凭坐标猜；是否补偿扫描消耗属于所有者待决项，P0 不冻结。
3. 设备改变后旧证据保留到 `expiresAtTick`，标记「在 observedAtTick 时观察」；隐藏变化不得产生「已过时」实时通知。
4. `tick >= expiresAtTick` 从活动叠层清理；暂停冻结 tick；重复恢复同一 snapshot 得到同一集合与剩余时间，不延长 TTL。
5. `knowledge` / `hypotheses` 与证据分离；假设不得自动写入 `knownConnections` 或 `observedState`。

R9 实现红线：`SliceModel.restore()` 当前会用 `distanceToReceiver` / `hasLineOfSight` 重算 `revealDoorReceiver` / `revealSealSource`（`src/slice/rules.ts`）。P1/P2 adapter **不得**把这些重算标志当作证据真值；证据真值只来自 `SnapshotV1.observationEvidence`，恢复路径必须忽略/清零模型重算的 reveal 标志，或走新增的无重扫恢复入口。R9 正式修复若改 `PersistedSliceState` 形状，必须同步 `src/slice/storage.ts:isPersistedSliceState` 与坏档锁写测试，不能只改模型 reader/writer。

### 5.5 `availableActions` 与 `DebugInspectionV1`

```ts
interface ActionCapabilityV1 {
  type: ActionTypeV1;
  status: 'available' | 'unavailable' | 'cooldown' | 'insufficient_energy' | 'permission_denied';
  reasonCode?: ErrorCodeV1;
  targetIds?: TargetId[];
  maxDurationTicks?: number;
}

interface DebugInspectionV1 {
  schema: 'last_signal.ai-native.debug.v1';
  protocolVersion: 1;
  sessionId: SessionId;
  epoch: Epoch;
  tick: Tick;
  actorId: ActorId;
  role: 'DEVELOPER';
  fullState: unknown;
  seed?: number; rngState?: number | null;
  fixtureLog: unknown[];
  rawEvents: EventV1[];
  hiddenMap?: unknown;
}
```

只有 `kind:'test'` + `role:'DEVELOPER'` + `AuthContext.authLevel==='developer-test'` 的**显式 `inspect_state` 命令**返回 `DebugInspectionV1`；`DEVELOPER` 不调用 `observe`，也不产生 `ObservationV1`。`ObserveRequestV1.detail` / `StepRequestV1.observationDetail` 中的 `debug` 字面量通过封闭 schema，但在 §6.1 阶段 6 一律返回 `E_PERMISSION`（Dev 也返回 `E_PERMISSION` 并带固定 `messageKey:'USE_INSPECT_STATE'`），不是 `E_SCHEMA`。`DebugInspectionV1` 不得嵌入 `ObservationV1`、非 Dev `StepResultV1`、`ErrorV1` 或任何 Player/Companion 可见导出。`fullState` / `hiddenMap` / `fixtureLog` 中的 `unknown` 是 Dev/test 私有对象的显式豁免：仍必须能被 `canonicalJson` 序列化，不得含函数、Phaser 实例、循环引用或凭据。

P0 实际状态以 §0.1 表为准：当前只有 `validateObserveDetail(role,detail)` 纯 helper；`USE_INSPECT_STATE`、summary 空值投影、adapter 返回 `DebugInspectionV1` 均归 adapter/P1–P3，不列为 P0 已实现行为。

---

## 6. 校验与错误顺序

### 6.1 固定校验流水线（先到先返回，首个原因）

实现必须按阶段号顺序执行，不得依赖 JS 对象键遍历顺序；每个失败只返回第一个 `ErrorV1`，不聚合内部诊断。`HandshakeEnvelopeV1` 与 `GatewayInternalCommandV1` 仅过阶段 0/1，阶段 2–13 不适用。`SnapshotV1` / `ReplayV1` 独立大帧走专用帧校验：阶段 0/1 → 阶段 6 权限 → `ref` / `requestId` / hash 绑定；不走动作流水线的阶段 2/3/4/5/7–13。阶段 2–13 的动作流水线只适用于已存在 `sessionId` / `AuthContext` 的 `AiNativeEnvelopeV1`。本文 §6 的 0–13、§7 的 T0–T11、§8 的 phase 0–6 都是内部顺序编号，不与 RER §7 的 P0–P7 或 AI-NATIVE-01 的 P0–P5 混用。

| 阶段 | 检查 | 典型错误码 |
| --- | --- | --- |
| 0 | 帧/字节上限、JSON 可解析、canonicalJson 可用 | `E_PAYLOAD_TOO_LARGE`, `E_SCHEMA` |
| 1 | `schema` 精确匹配、`protocolVersion===1`、封闭对象、字段类型/范围 | `E_VERSION_UNSUPPORTED`, `E_SCHEMA` |
| 2 | `sessionId` 存在且未 `closed`；`requestId`/`transportSeq` 幂等 | `E_SESSION_NOT_FOUND`, `E_SESSION_CLOSED`, `E_SCHEMA` |
| 3 | `epoch` 匹配、run 未结束、目标生命周期/实例未失效 | `E_STALE_EPOCH`, `E_STALE_GENERATION`, `E_TARGET_DESTROYED` |
| 4 | ID 载荷：`actionId` 语法、请求 `actorId` 存在于 registry、幂等缓存同 hash 重放 / 异 hash `E_ID_PAYLOAD_MISMATCH` | `E_UNKNOWN_ACTOR`, `E_ID_PAYLOAD_MISMATCH` |
| 5 | `targetTick===currentTick+1`、`deadlineTick` 合法、传输请求未超墙钟期限 | `E_STALE_TICK`, `E_FUTURE_TICK`, `E_ACTION_EXPIRED`, `E_TIMEOUT` |
| 6 | 权限/暂停：`AuthContext` 一致性（`actorId===principalActorId`）、role/actor 权限、`session.kind` 约束、暂停态、Dev-only 命令、`ObserveRequestV1.detail` / `StepRequestV1.observationDetail` 的 `debug` 改用 `inspect_state`、`snapshot`/`restore` 状态前提 | `E_PERMISSION`, `E_PAUSED` |
| 7 | 动作支持性：`aim/fire/decoy` 在 P0 场景、`COMPANION` 世界写入 | `E_NOT_APPLICABLE`, `E_PERMISSION` |
| 8 | 目标 ID 在授权集合、距离/LOS/可达/几何、房间一致 | `E_ILLEGAL_TARGET` |
| 9 | 目标状态机合法性、已有 Jam/重复同 tick 动作 | `E_RETRYABLE`, `E_LINK_UNAVAILABLE` |
| 10 | Energy | `E_ENERGY_INSUFFICIENT` |
| 11 | 冷却 | `E_COOLDOWN` |
| 12 | 速率/资源限制 | `E_RATE_LIMIT`, `E_RESOURCE_LIMIT` |
| 13 | 原子事务提交；失败全回滚 | `E_INTERNAL_TRANSACTION`, `E_RETRYABLE` |

阶段 0–2 是 schema/session 前置闸门；阶段 3 起保持 RER §9 的「epoch → 生命周期 → ID 载荷 → 权限/暂停 → 支持性 → 目标几何 → 目标状态 → Energy → 冷却」业务顺序。阶段 5 的 tick/deadline 闸门是新增传输校验，显式放在 ID 载荷（阶段 4）之后、权限（阶段 6）之前；`AuthContext` 一致性属于权限，放在阶段 6，避免 `E_PERMISSION` 早于 `E_ID_PAYLOAD_MISMATCH`。非法请求必须零扣费、无冷却变化、无新效果、无新证据。

### 6.2 错误码枚举

错误码全集已在 §1 的 `AI_NATIVE_ERROR_CODES_V1` 数组中给出，`ErrorCodeV1` 由该数组派生；本节不再重复声明类型，避免 TS2300。成功用 `'OK'`；桥安全送岸是独立 `PLAYER_RESCUED` 事件，不是失败码。错误文案固定 `messageKey`，详细原因只进 Dev/服务端审计日志，不回给 Player/Companion。

### 6.3 幂等与去重

- 缓存键：`(sessionId, epoch, actorId, actionId)`；值含 `payloadFingerprint` 与完整首次 `ActionResultV1`。
- 同键同 hash：返回首次结果，`replayed=true`、`resourceWritesThisCall=0`，不二次扣费/不二次产生领域事件；`cost` 仍表示首次事务值。
- 同键异 hash：`E_ID_PAYLOAD_MISMATCH`，不写缓存。
- 阶段 3 之后产生的失败也缓存；阶段 0–2 的 schema/version/session 错误不缓存。
- 同 `(epoch, targetTick, actorId, type, payloadFingerprint)` 但不同 `actionId` 的重复在扣费前合并，第二个返回 `E_RETRYABLE`，零费零效果。
- 缓存随 epoch 变化 / `reset` / `close` 清空，不跨 session、不跨 epoch 误命中。

---

## 7. 固定 tick 顺序

以 `fromTick = T-1`、目标 `T` 为例；`actions` 全部属于 `T`。

| 阶段 | 操作 | 顺序约束 |
| --- | --- | --- |
| T0 | 按 §6 校验并排序 actions | 排序键固定为 `(targetTick, actorRegistry.priority, actorId, actionId)`；`transportSeq` 不参与 |
| T1 | 冻结 `T-1` 权威位置/占位/设备提交态快照 | 所有 action 读同一份输入，禁止「先改后读」 |
| T2 | 预提交瞬时动作 `scan/jam/interact/shoot_guard`；注册/更新持续 `move/wait` intent | 失败零写；成功进入候选事务 |
| T3 | 实验室：`onTick` 移动，使用 `T-1` 的 `doorPassable` | 复用 `canStand` 轴分离碰撞与 `SLICE.MOVE_SPEED` |
| T4 | `tickIndex++`；Energy regen、冷却、Scan 揭示 TTL、Jam 到期 | 满 Energy 清 `regenAcc`；暂停不进入本阶段；**不**在这里扣安全延迟 |
| T5 | 走廊：`Corridor.advance(T, jamActive)` 按 `T-1` 位置解析 Relay/桥/Guard、预警/救援/失败 | 下游一次提交，消费者不读半成品 |
| T6 | 走廊：若未救援且未失败，`onTick` 移动，使用 T5 提交后的 `bridgePassable` | 保持源码「先解算后移动」顺序 |
| T7 | 实验室：重算 `occupancy` → 安全延迟扣减 → `SAFE_PENDING_CLOSE` → `solveDoor()` | `safeClearTicks--` 必须在占位重算之后，不能早扣一 tick |
| T8 | 完成/失败判定：`passed`/`crossed`/`hp<=0` | 同 tick 双方死亡失败优先；死亡只 `finished(died)`，不 checkpoint 续局 |
| T9 | 证据：仅本 tick 的合法 Scan 产生/替换 `ObservationEvidenceV1` | 恢复/移动/重放不重新扫描；旧证据不自动变当前事实 |
| T10 | 事件：按 §8 生成并排序；动作结果定稿 | 事件不得改本 tick 状态 |
| T11 | 发布 post-commit snapshot / `StepResultV1` / 可选 `ObservationV1` | 观察只从白名单投影，详见 §5 |

多 tick `StepRequest.ticks>1` 时，T2 的瞬时动作只在第一 tick 执行；持续 `move/wait` intent 按 `durationTicks` 每 tick 复用到完成/取消/超时。每个 tick 都走 T1–T11，且 `postStateHash` 覆盖最终 tick。渲染端 `MAX_TICKS_PER_FRAME=15` 只限制单帧；无头显式 `ticks` 用 `maxTicksPerStep` 限制。

---

## 8. 事件模型与排序

```ts
type EventPhaseV1 = 0 | 1 | 2 | 3 | 4 | 5 | 6;
// 0 lifecycle, 1 protocol, 2 action, 3 domain-precommit, 4 domain-commit, 5 observation, 6 dev-audit

type EventTypeV1 =
  | 'SESSION_CREATED' | 'SESSION_PAUSED' | 'SESSION_RESUMED' | 'SESSION_RESET' | 'SESSION_CLOSED'
  | 'ACTION_ACCEPTED' | 'ACTION_REJECTED' | 'ACTION_COMPLETED' | 'ACTION_CANCELLED'
  | 'ACTION_PREEMPTED' | 'ACTION_TIMEOUT' | 'ACTION_REPLAYED'
  | 'SCAN_EVIDENCE_CREATED' | 'SCAN_EVIDENCE_EXPIRED'
  | 'JAM_APPLIED' | 'JAM_EXPIRED' | 'DOOR_STATE_CHANGED'
  | 'RELAY_STATE_CHANGED' | 'BRIDGE_STATE_CHANGED' | 'GUARD_LINK_CHANGED'
  | 'GUARD_HIT' | 'GUARD_CLEARED' | 'PLAYER_RESCUED'
  | 'RUN_COMPLETED' | 'RUN_FAILED'
  | 'SNAPSHOT_SAVED' | 'SNAPSHOT_RESTORED' | 'REPLAY_STARTED' | 'REPLAY_FINISHED'
  | 'DEV_FIXTURE_INJECTED' | 'PERMISSION_DENIED' | 'RATE_LIMITED' | 'SCHEMA_REJECTED';

type EventPayloadKeyV1 =
  | 'status' | 'reason' | 'newEpoch' | 'actionId' | 'actorId' | 'code' | 'cost'
  | 'resourceWritesThisCall' | 'replayed' | 'evidenceId' | 'targetId'
  | 'observedAtTick' | 'expiresAtTick' | 'sourceActionId' | 'stateLabel'
  | 'remainingTicks' | 'effectiveOutput' | 'bridgePassable' | 'hp' | 'shore'
  | 'snapshotId' | 'stateHash' | 'eventsHash' | 'epoch' | 'fixtureId' | 'requestId' | 'tick';

type EventPayloadV1 = Partial<Record<EventPayloadKeyV1, string | number | boolean | null>>;

interface EventV1 {
  schema: 'last_signal.ai-native.event.v1';
  protocolVersion: 1;
  eventId: EventId;
  sessionId: SessionId;
  epoch: Epoch;
  tick: Tick;
  phase: EventPhaseV1;
  ordinal: number;
  eventSeq: number;
  actorId?: ActorId;
  actionId?: ActionId;
  correlationId?: RequestId;
  type: EventTypeV1;
  payload: EventPayloadV1;
}
```

**全序** = `(tick, phase, ordinal, actorId ?? '', eventId)`；`eventSeq` 只是日志游标，不替代全序。`compareEventOrder()` 必须实现该全序。禁止用 `Date.now()`、订阅者注册顺序、`Set` 迭代顺序或 Promise 完成顺序决定事件次序。

| EventTypeV1 | payload 白名单 |
| --- | --- |
| `SESSION_*` | `status`, `reason?`, `newEpoch?` |
| `ACTION_*` | `actionId`, `actorId`, `code`, `cost`, `resourceWritesThisCall`, `replayed?`, `reason?` |
| `SCAN_EVIDENCE_*` | `evidenceId`, `targetId`, `observedAtTick`, `expiresAtTick`, `sourceActionId` |
| `JAM_*` / `DOOR_STATE_CHANGED` | `targetId`, `stateLabel`, `remainingTicks`, `code` |
| `RELAY_*` / `BRIDGE_*` / `GUARD_LINK_CHANGED` | `targetId`, `stateLabel`, `effectiveOutput?`, `bridgePassable?` |
| `GUARD_HIT` / `GUARD_CLEARED` / `PLAYER_RESCUED` | `targetId`, `hp?`, `shore?`, `cost:0` |
| `RUN_*` | `reason`, `tick` |
| `SNAPSHOT_*` / `REPLAY_*` | `snapshotId?`, `stateHash?`, `eventsHash?`, `epoch` |
| `DEV_FIXTURE_INJECTED` | `fixtureId`, `actorId`, `tick`, `targetId`；仅 Dev 测试会话可见 |
| `PERMISSION_DENIED` / `RATE_LIMITED` / `SCHEMA_REJECTED` | `code`, `requestId?`；不含内部路径/值 |

`payload` 不得含 seed、RNG、全图、fixture 值、stack、`SliceSnapshot` 原对象。`get_events` 用 `cursor=lastEventSeq`、`limit<=maxEventsPerPage` 分页；事件日志超过 `maxEventLogEvents` 时丢弃最旧并显式记录 `droppedEvents`，replay 的 `eventsHash` 必须包含该计数，不能静默截断。

---

## 9. Snapshot / Restore / Replay 独立帧

### 9.1 独立帧与大小上限

P0 实际状态：当前 `SnapshotV1` / `ReplayV1` 及 `RestoreRequestV1.snapshot` / `ReplayRequestV1.replay` / `ReplayV1.initialSnapshot` 是内嵌私有输入，只做结构校验 + `authorizeRawFrame` 纯 audience gate。下文 `ref` / `requestId` / `audience` / `replayHash` projection / `SnapshotRefV1` / `ReplayRefV1` 是 P1–P3 公开控制帧计划，不是 P0 已实现字段。未来公开控制帧必须使用 Ref；公开原始帧强制 `DEVELOPER` + `kind:'test'`；私有帧不套 `AiNativeEnvelopeV1`，不受 `AI_NATIVE_LIMITS_V1.maxPayloadBytes` 控制；分别受 `maxSnapshotFrameBytes` / `maxReplayFrameBytes` 控制。`GatewayCreateTestSessionV1` 走 `maxPayloadBytes`。文档里出现的 `MAX_PAYLOAD_BYTES` / `MAX_SNAPSHOT_FRAME_BYTES` / `MAX_REPLAY_FRAME_BYTES` 只是说明性别名，**不是** `protocol.ts` 导出名；资源上限相关的唯一导出对象是 `AI_NATIVE_LIMITS_V1`（`ResourceLimitsV1`）与 `AI_NATIVE_HARD_LIMITS_V1`（`ResourceHardLimitsV1`）。控制命令只传 §4.4 定义的 `SnapshotRefV1` / `ReplayRefV1`（含 `ref` + `requestId` + hash）；独立帧本身也必须带相同 `ref` 与 `requestId`，在专用帧校验中绑定 `AuthContext` 与 hash，不走会话内 `transportSeq`。

### 9.2 SnapshotV1

```ts
type DoorStateV1 = 'SEALED' | 'JAMMED_OPEN' | 'OPEN' | 'CLOSED' | 'SAFE_PENDING_CLOSE';

interface CorridorRevealV1 { relay: boolean; bridge: boolean; perceptionPort: boolean }

interface CorridorCheckpointV1 {
  template: 'station-zero-r2-v1';
  position: WxWyV1;
  hp: number;
  relayEnabled: boolean;
  powered: boolean;
  bridge: 'STABLE' | 'UNAVAILABLE';
  guardCleared: true;
  crossed: boolean;
  jamRemaining: number;
  scanRemaining: number;
  reveal: CorridorRevealV1 | null;
}

interface SlicePersistedStateV1 {
  schema: 'last_signal_station_zero_vs00_v1';
  version: 1;
  roomId: 'station-zero-r1';
  energy: number;
  tick: number;
  doorState: DoorStateV1;
  manualOpenIntent: boolean;
  sealSourcePresent: boolean;
  passed: boolean;
  position: WxWyV1;
  corridor?: CorridorCheckpointV1;
  remaining: {
    jam: number; jamCooldown: number; scanCooldown: number;
    scanReveal: number; safeClear: number; regenAcc: number;
  };
}

interface SnapshotV1 {
  schema: 'last_signal.ai-native.snapshot.v1';
  protocolVersion: 1;
  audience: 'developer-test';        // 仅 Dev/test 可见，不能当 Player 响应
  kernelVersion: 'station-zero-r1-r2@1';
  ref: string;                       // 与 SnapshotRefV1.ref 一致
  requestId: RequestId;              // 与控制命令/AuthContext 绑定
  snapshotId: SnapshotId;
  sessionId: SessionId;
  sessionKind: SessionKindV1;
  epoch: Epoch;
  tick: Tick;
  scenarioId: 'station-zero-r1-r2';
  runStatus: 'active' | 'finished';
  runEndReason: RunEndReasonV1;
  createdAtMs: Ms;
  state: SlicePersistedStateV1;
  observationEvidence: ObservationEvidenceV1[];
  idempotencyCache: ReadonlyArray<{
    actionId: ActionId; actorId: ActorId; payloadHash: string; result: ActionResultV1;
  }>;
  eventCursor: number;
  rngState: null;
  snapshotHash: string;              // sha256 canonical(除本字段与 createdAtMs)
  dev?: { seed?: number; fixtureLog?: unknown[] }; // 仅 test/Dev 帧
}
```

`SlicePersistedStateV1` 严格复用 `src/slice/rules.ts` 的 `PersistedSliceState` 字段。因为 `SnapshotV1.audience==='developer-test'`，`state` 中的 `manualOpenIntent` / `sealSourcePresent` / `regenAcc` 等内部字段只对该私有帧可见，**绝不**作为 `ObservationV1`、`StepResultV1` 或 Player/Companion 响应返回；生产浏览器刷新恢复走 Gateway 内部状态，不导出本帧。P0 **不写** `last_signal_station_zero_vs00_v1` 旧 localStorage key，不提升 `version`，不改 `SAVE_VERSION=2` / `last_signal_save_v1`；AI-Native snapshot 是服务端私有存储/内存信封，可承载内部生产状态用于服务端内部恢复，外部导出仅 Dev/test。捕获条件沿用 `SliceModel.serialize()` / `Corridor.canSave`：安全点、无危险转换、守卫已清、不在桥上；`canCheckpoint=false` 返回 `E_SNAPSHOT_INVALID`。战斗内快照不因本契约自动获得批准。

### 9.3 Restore

`restore` 是 `SessionCommandV1` 分支，仅 `DEVELOPER` + `kind:'test'` + `AuthContext.authLevel==='developer-test'`，且 session 状态只能是 `created` 或 `paused`；`running` 必须先 `pause`，否则阶段 6 `E_PERMISSION` + `INVALID_SESSION_STATE`。浏览器退出/刷新恢复最近安全点是 Gateway/适配层内部路径，不是该命令。校验顺序：schema/version → `ref`/`requestId`/`AuthContext` 绑定 → `kernelVersion` 精确匹配 → `snapshotHash` 与独立帧一致 → `sessionId/kind/actorRegistry` 一致 → `runStatus==='active'` → 证据数组逐项校验 → 位置/模板/效果余时一致。

恢复后**新建 `epoch`**、拒绝所有旧 `actionId` / 旧 `clientSeq`、取消在途动作；不补墙钟 tick、不重扫证据、不改变权限、不把 `finished(died)` 快照恢复成续局。`finished(died)` 只能 Dev 只读检查；再玩必须 `reset` 开新 R0。

### 9.4 ReplayV1

```ts
interface ReplayV1 {
  schema: 'last_signal.ai-native.replay.v1';
  protocolVersion: 1;
  audience: 'developer-test';
  kernelVersion: 'station-zero-r1-r2@1';
  ref: string;                       // 与 ReplayRefV1.ref 一致
  requestId: RequestId;              // 与控制命令/AuthContext 绑定
  sessionId: SessionId;
  sessionKind: SessionKindV1;
  initialSnapshotRef: SnapshotRefV1;
  actions: ReadonlyArray<ActionRequestV1>;
  actionResults: ReadonlyArray<ActionResultV1>;
  eventsHash: string;
  finalStateHash: string;
  replayHash: string;               // sha256 canonical(除 replayHash 与 dev 段)
  eventLogRef?: string;             // 可选独立事件日志导出，不内嵌全部事件
  resourceUsage: ResourceUsageV1;
  dev?: { seed?: number; fixtureLog?: unknown[] };
}
```

`replay` 仅 `DEVELOPER` + `kind:'test'`；Player/Companion 不得调用或导出 `ReplayV1`。`replayHash` 是独立帧自校验字段：对 `ReplayV1` 做 canonical projection，只保留 `schema` / `protocolVersion` / `audience` / `kernelVersion` / `ref` / `requestId` / `sessionId` / `sessionKind` / `initialSnapshotRef` / `actions` 的权威字段（排除 `issuedAtMs` / `clientSeq` / `correlationId` / `requestId` 等传输字段）/ `actionResults` 的权威字段 / `eventsHash` / `finalStateHash` / `eventLogRef` / `resourceUsage`；排除 `replayHash`、`dev` 段及所有传输字段后再取 sha256。确定性判据：同一 `initialSnapshotRef` 指向的 snapshot + `actions` + `kernelVersion` 重放，得到相同 `finalStateHash` 与 `eventsHash`。`ActionRequestV1` 无 `transportSeq` 字段；`issuedAtMs` / `clientSeq` 不参与权威结果，若影响结果即为实现缺陷。

不兼容情况：`schema`/`protocolVersion` 不同、`kernelVersion` 不同、snapshot 来自其他 session/kind、包含未知字段、actions 被重排、Dev fixture 试图进入 production、高版本快照喂给 v1 reader → `E_REPLAY_INCOMPATIBLE`，保留原档不覆写。旧 `last_signal_station_zero_vs00_v1` 档可读但没有 `observationEvidence`：迁移时证据清空、提示重新扫描；默认不补 Energy、不补连接、不让旧 reader 覆写新证据。未知/坏/高 schema 沿用 rejected 锁写策略：保留原文、拒绝写入。

---

## 10. 取消、超时与动作状态机

状态机：`pending → active → completed | timeout | cancelled | preempted`；校验失败直接 `rejected` 终态。终态重复取消/重放幂等无副作用。

| 触发 | 结果 | 必须动作 |
| --- | --- | --- |
| `cancel_action` by owner / Dev test | `cancelled` | 清除 active intent，零资源写，发 `ACTION_CANCELLED` |
| 人类 takeover（仅 rendered production） | `preempted` | 清除所有 Agent intent，`YIELDED`，不自动回切；`YIELDED` 不得由参数触发 |
| `currentTick > deadlineTick` | `timeout` | 清除 intent，发 `ACTION_TIMEOUT`，请求级 `E_TIMEOUT` |
| 传输 `issuedAtMs + requestTimeoutMs` 过期 | `E_ACTION_EXPIRED` | 不进入核心；不补时 |
| `pause` | 冻结 | tick/TTL/冷却/动作 deadline 不推进；恢复清帧累加器，不补离线时间 |
| `reset` / `close` / epoch 变化 | `cancelled` | 清缓存、清 intent、清旧证据引用；`close` 释放资源 |
| session 墙钟 / 空闲超时 | `finished(timeout)` → 自动 `close` | 先取消在途动作、标记逻辑终态、再释放资源；`finished` 与 `closed` 是顺序两步，不是二选一 |

`E_CANCELLED` / `E_PREEMPTED` / `E_TIMEOUT` 是动作终态码，不是玩法失败码；不得由此扣 Energy 或改门/桥状态。

---

## 11. 资源限制（P0 工程护栏，非玩法数值）

`AI_NATIVE_LIMITS_V1` / `AI_NATIVE_HARD_LIMITS_V1` 与 `ResourceLimitsV1` 必须导出：

```ts
interface ResourceLimitsV1 {
  maxTicksPerStep: number;
  maxActionsPerTick: number;
  maxActiveIntentsPerActor: number;
  maxActionDurationTicks: number;
  maxPayloadBytes: number;
  maxSnapshotFrameBytes: number;
  maxReplayFrameBytes: number;
  maxObservationEvents: number;
  maxEventLogEvents: number;
  maxEventsPerPage: number;
  requestTimeoutMs: number;
  heartbeatMs: number;
  idleTimeoutMs: number;
  maxSessionWallMs: number;
  maxRequestsPerSecond: number;
  maxObservePerSecond: number;
  maxStepTicksPerSecond: number;
}

interface ResourceUsageV1 {
  wallMs: number;
  ticksAdvanced: number;
  eventsEmitted: number;
  peakActionsPerTick: number;
  droppedEvents: number;
  truncatedObservation: boolean;
}

interface ResourceHardLimitsV1 extends ResourceLimitsV1 {
  maxSessions: number;              // 默认 16
  maxConcurrentSteps: number;       // 默认 4
  maxTicksPerStepHard: number;      // 10000
}
```

`AI_NATIVE_LIMITS_V1: ResourceLimitsV1` 是会话默认值，`AI_NATIVE_HARD_LIMITS_V1: ResourceHardLimitsV1` 是 Gateway 全局硬上限；二者都使用上表驼峰字段名。大写 `MAX_*` 仅用于本文表格叙述，不是导出符号。

| 字段 | 默认 | 硬上限/说明 |
| --- | ---: | --- |
| `maxTicksPerStep` | 1000 | 硬上限 10000；基准 1000/10000 tick 分开测 |
| `maxActionsPerTick` | 32 | 超过 `E_RESOURCE_LIMIT` |
| `maxActiveIntentsPerActor` | 1 | 同 actor 只能一个持续 `move/wait` |
| `maxActionDurationTicks` | 3600 | 60Hz 下 60 逻辑秒 |
| `maxPayloadBytes` | 4096 | 普通 `AiNativeEnvelopeV1` / `HandshakeEnvelopeV1` 控制帧 |
| `maxSnapshotFrameBytes` | 262144 | 独立 `SnapshotV1` 帧，不套控制帧上限 |
| `maxReplayFrameBytes` | 8388608 | 独立 `ReplayV1` 帧，不套控制帧上限 |
| `maxObservationEvents` | 64 | `ObservationV1.events` 上限 |
| `maxEventLogEvents` | 10000 | 环形截断并记 `droppedEvents` |
| `maxEventsPerPage` | 256 | `get_events` 分页 |
| `requestTimeoutMs` | 30000 | 墙钟，仅传输层 |
| `heartbeatMs` | 5000 | 双向探活；连续丢失后按权限文档降级 |
| `idleTimeoutMs` | 300000 | 空闲 session 回收：先 `finished(timeout)` 再自动 `close` |
| `maxSessionWallMs` | 3600000 | 1 小时硬上限 |
| `maxRequestsPerSecond` | 20 | 每 session 令牌桶；超限 `E_RATE_LIMIT`，不排队执行 |
| `maxObservePerSecond` | 10 | 观察背压 |
| `maxStepTicksPerSecond` | 6000 | 快进上限；不代表性能合格线 |

Gateway 全局硬上限为 `AI_NATIVE_HARD_LIMITS_V1.maxSessions=16`、`maxConcurrentSteps=4`、`maxTicksPerStepHard=10000`。production 会话不可放宽；Dev/test 创建时只能收紧。独立大帧在 §6.1 阶段 0 走 `maxSnapshotFrameBytes` / `maxReplayFrameBytes`，普通控制帧走 `maxPayloadBytes`。渲染端另有源码既有 `MAX_FRAME_DELTA_MS=250` / `MAX_TICKS_PER_FRAME=15`，不得与上表混用。

---

## 12. 未来传输/MCP 边界与证据口径

P0 只定义 JSON DTO 与纯 TS 校验，不实现 MCP Server、WebSocket、HTTP 或 stdio。P3 若用 MCP，必须真实使用 MCP `tools/list` / `tools/call`，不得用自定义文本协议冒充；`stdout` 只走协议帧、日志走 `stderr`；Dev 工具与 Player 工具分开授权；默认只本机监听。旧 `AGENT_BRIDGE_ARCHITECTURE.md` 的 6 `observe_*` / 9 `action_*` 是历史候选，本 v1 命令到 MCP 工具名的映射留到 P3，不得在 P0 反向要求协议改名。

### 12.1 非阻断证据与授权边界

- 仓库外 `D:/Project/ALIGN-01-20261112/docs/` 六份报告已找到；其最终报告为 `PENDING HUMAN VALIDATION`，建议暂缓 Agent Bridge / ECHO / Decoy，观察持久化 ADR 待批。上述范围是否已被本次 AI-NATIVE-01 正式授权覆盖，须由 Lead 确认；P0 只冻结技术契约，不代替所有者签核。
- ALIGN-01 §B 记录历史本地 `main` 为 `d85784d`、远端 `main` 为 `c656f788227f44efec993315bfb65a323e398377`；本任务分支 HEAD 对齐远端，不把历史本地 HEAD 当当前基线。
- 主 World 变长 `dt` / `Math.random()` / 速度各向异性未迁移；本文确定性承诺只覆盖 `station-zero-r1-r2` 纯规则核心。
- ECHO 身份、记忆持久化范围、结局与世界观仍未决；COMPANION 只保留权限位与隔离最小双 Actor 测试场景。

---

## 13. Developer 最小验收清单（P0 纯校验）

基线：`protocol.ts` md5 `b99eb7011b148c055e14e70fb87e3d0e`，`protocol.test.ts` md5 `79359f01439ccecf063720a23ee40f66`；新增 72 / 全量 135 PASS。P0 只验收当前文件真实导出的类型、常量、封闭 schema 校验、canonical JSON、hash 字符串形状、纯比较与授权辅助函数；未实现握手/AuthContext/devTicket/Gateway 命令、refs、audience/hash projection、新 guard、summary 投影及真实运行时均按 §0.1 归 P1–P3，不列为 P0 验收项。

1. 七个 P0 schema 常量、`AI_NATIVE_SCHEMA_V1`（7 键）、版本/kernel/error codes/`AI_NATIVE_LIMITS_V1`/hidden field names/ID patterns/status tables/`GAME_IMPLEMENTATION_STATUS` 导出且冻结；`AI_NATIVE_ERROR_CODES_V1` 是 `ErrorCodeV1` 唯一真源。
2. `isCompatibleVersion` 接受裸 `1` 和 `{protocolVersion:1,schema:<精确 schema>}`；拒绝 v2、缺 schema、未知 schema、`null`、字符串 `'1'`。
3. 当前 `validate*` / `*Detailed` 守卫：合法 DTO 通过；未知顶层/嵌套字段、隐藏字段名、NaN/Infinity、`undefined`、`Set`/函数/类实例/循环引用等返回首个 `E_SCHEMA`；`validateError` 脱敏。
4. `validateActionSupport` 对 `aim/fire/decoy` 返回 `E_NOT_APPLICABLE`；`validateActionPermission` 按不可变 binding 做纯检查；`validateActionTargetTick` 只做纯比较。
5. `compareActionOrder(a,b,priorityOf)` 使用第三参数真实签名；`compareEventOrder` 实现事件全序；`firstErrorByStage` 返回最早阶段。
6. `canonicalJson` / `payloadFingerprint` / `redactError` / `validatePayloadSize` 为纯函数；hash 只验字符串形状，不在 P0 计算 sha256。
7. `authorizeRawFrame` 仅纯 audience gate：只有 `DEVELOPER` + `kind:'test'` 可导出原始帧；结构校验不等于授权，真实 Gateway 在 P1+ 强制。
8. `ObservationEvidenceV1` 统一 `protocolVersion:1`；`validateRestoredEvidence` / `validateRestoreEligibility` / `validateReplayCompatibility` 只做纯校验，P0 不执行 restore/replay。
9. `SnapshotV1` / `ReplayV1` 当前内嵌输入仅私有内部；P0 只验结构与 `authorizeRawFrame`，不导出 `ref/requestId/audience/replayHash` 新字段；未来公开控制帧必须 Ref，公开原始帧强制 Dev/test。
10. 资源/分页/截断/取消/超时/deadline 仅纯 helper 断言；`summary` 空值投影、`USE_INSPECT_STATE`、真实 tick/cache/log/restore/replay 执行归 adapter/P1–P3，不列为 P0 现状。
