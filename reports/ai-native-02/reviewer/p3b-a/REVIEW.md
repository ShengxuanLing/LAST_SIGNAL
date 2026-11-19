# P3-b A 真实 Companion 接线 / Owner 确认 独立验收（a1e23dd）

- **被测提交**：`a1e23dd17ab5ba79795472aae5ad37000aff4151`（HEAD，分支 `feat/ai-native-world-integration`）
- **解析/链**：`a1e23dd=a1e23dd17…aff4151`（preview 入口修复，父 `d768f6f`）；`d768f6f=d768f6f1…9aef7df2b5`（gateway/bridge/官方 MCP/Owner UI 接线，父 `f16741a`）；`f16741a=f16741af…70aff4151`（浏览器专属 Owner 权限收紧 + 严格 DTO，父 `ab59fe6`）
- **冻结**：`git -c core.autocrlf=false -c core.eol=lf archive a1e23dd | tar -x -C D:/Project/lastsignal-p3b-a-review-a1e23dd`；`node_modules` junction；Python 逐文件 git blob SHA1 → **ALL_TRACKED_FILES_MATCH（2004/2004, MISMATCH=0, MISSING=0）**
- **边界**：未改生产源/已有测试/配置/分支；未 merge/reset；未读/恢复 WIP/stash；未 kill 他人进程（5176 被占用，改用 5412/5414）。只做必要 probe/unit + OwnerE2E，未重复无关全量。
- **结论**：**PASS 的部分确实落地且可验证，但发现 1 个接线硬阻断，P3-b A 不能放行**：`companion-authorize` 只校验「token + 可伪造 Origin + session/epoch」，**Agent 可重授权装自己的 ownerSecret 并在人类会话上自 confirm**，甚至自己伪 Origin 握手全程无人类。开发者「Agent token/伪 Origin 不能自 confirm」的结论只对**单次直调**成立，对**重授权链**不成立。另有 4 个契约/接线缺口。Signal 仍未接线，不能当完整 P3-b；**Lead 真实 LLM 建议实跑本轮不允许**。

## 1. 已验证 PASS 的部分

| 检查项 | 结果 | 证据 |
|---|---|---|
| 共享 `createOwnerCapability`/`isOwnerCapability`/公开 Symbol 已删 | **PASS** | `companionFacet.ts` 仅剩 `OwnerAuthorityValidator` 类型 + 注入式 `CompanionOwnerLedger`；生产源静态搜索 `NO_FACTORY_IN_PRODUCTION_SRC`（唯一命中是注释文字）。`companionLink.ts` 的 `OWNER_AUTHORITIES = new WeakSet` + `mintOwnerAuthority()` 均**模块私有不导出** |
| 官方 Companion MCP 生产 bundle 无 Owner 工厂 / confirm 路由 | **PASS** | 冷 `game:mcp:build` 后扫 `dist-mcp/companionMcpServer.mjs`+chunks：无 `createOwnerCapability/isOwnerCapability/OWNER_CAPABILITY/mintOwnerAuthority/OWNER_AUTHORITIES/CompanionOwnerLedger/companion-decision/companion-applied/companion-authorize/echo_confirm/ownerSecretHash/startWorldBridge/CompanionLink`；真实 SDK `listTools` **恰 4 个** `echo_observe/echo_suggest/echo_status/echo_memory`；`CompanionClient` 无 confirm/decide/applied/authorize 方法；console REPL 无 confirm 命令，JSONL 脱敏 |
| 浏览器侧私有凭据不外泄（observer/status/log/global） | **PASS（有残余）** | 6 个源文件无 raw secret 日志；bridge 只存 sha256、不回显；`observe/status/memory/suggestions/agent-status/attach` 全响应无 secret/token/OWNER 字样；link 不写 `globalThis`/URL/日志；`status/error/session` getter 不带 secret。**残余**：TS `private` 仅编译期，`ownerSecret` 运行时可枚举且 `JSON.stringify(link)` 会带出（生产三入口无 `__game`，当前不可达） |
| Agent 直调 confirm/applied 全拒 | **PASS（仅限直调）** | token-only 无 Origin→403；伪 Origin 无 secret→403；`{kind:'OWNER'}`、spread、`Object.create(null)`、`Object.create(secretObj)`、JSON round-trip、错 secret、**跨 session secret**、数字/数组/空串 secret、错 session、错 epoch、错 token→401 全拒；`companion-applied` 同样 |
| 权限界限是「不同凭据 + session + epoch」而非模块字符串 | **部分 PASS** | 正确 secret + 正确 session + 正确 Origin + 正确 epoch 才 200；错 session/epoch 拒；这是真实凭据校验，不是 `Symbol` 字符串比较 |
| 私有 secret 不被 observer/status/log/global/serialization 返回 | **PASS（除实例序列化）** | 见上；唯一例外是 `JSON.stringify(CompanionLink 实例)` 本身（残余） |
| TTL / dedup 硬界 / memory 16 / 假 hidden 输入 | **PASS** | TTL 到期拒；8 未确认硬界拒（非 FIFO 淘汰）；512 request-dedup 硬界 `E_RESOURCE_LIMIT`；memory≤16；`isEchoObservation` 拒 raw sim / 假 schema / 隐藏额外字段 / 超 12 格 drone / center 不符；gateway allowlist 拒未知 top-level 键 |
| queued 建议「确认一次后单条 echo intent 由下一 core tick 提交」 | **PASS** | 独立 Owner E2E：人类 Pause UI 授权→Agent HTTP 提议→Agent 自确认拒→人类 CONFIRM 后 `hasPendingCompanionIntent=true, echoShotsFired=0`（只入队、不直写）→关面板下一 tick `echoShotsFired=1, pending=false`；`World.enqueueCompanionAction` 单次赋值 `pendingCompanionIntent`，`stepFrame` 取用后立即置 null，`reset` 清空 |
| 拒绝/过期/复用 id 不执行；receipt 不提前报效果 | **PASS（有缺口）** | 决策前 `applied` 拒；confirm 记录 `applied=false`；重复同 id→`E_RETRYABLE`；过期→拒；复用 id→拒；reject 只记录不执行。**缺口**：`markApplied` 不校验 `decision==='confirm'`，被 reject 的 id 仍可标 `applied=true` |
| AI/External 主角只读互斥 | **部分 PASS** | gateway `setOwnerMode('ai'/'external')` → `readOnly=true` 且拒新 suggest/confirm；`GameScene.toggleAiControl` 正确调用 `setOwnerMode('ai'/'human')`；**缺口**：见 §3 |
| 真实 lease hardkill / 迟到请求不自动恢复建议 | **PASS** | 4s 无续租硬过期（reaper 200ms）→ `E_SESSION_NOT_FOUND`/link 降级、迟到 suggest/status/confirm/renew 全拒、旧 leaseId 不能复活、ownerSecretHash 清理、无假 connected |
| echo 自主观察 targets/LOS/memory 证据 | **PASS（有缺口）** | `buildEchoObservation` 输出带 `schema+perception` 裁剪证明，`targets` 正确记入有界 memory（`target_<id>_<kind>`）；`availableActions` 对 >6 目标 `out_of_range`；理由必须由当前观察可证。**缺口**：证明是自声明字符串，见 §3 |
| 控制 token cleanup / bounded session | **PASS** | `CompanionClient.close()` 清 renewTimer/session/leaseId；`WorldGateway` 会话硬界 4；bridge reaper 清 `ownerSecretHashes`/`linkedByOrigin`/pending |
| preview `toCombatPort` 兼容不回退目标选择/写边界 | **PASS** | 真 `ActorCombatPort` 按**对象身份**原样返回（nearest-echo 选择不变）；`PlayerLike` 走 `player.hurt`→core pending hit、不直写 HP、不臆造 echo 目标；渲染 E2E `p3a-enemy-target`+`audit` **3/3 PASS**（hunter 真伤 echo、死后改选、全种类+Boss） |
| 三入口 prod 无 `__game` | **PASS** | 生产 `dist` preview `/`、`/economy.html`、`/station-zero.html` 真实 DOM 全在、无 `__game`、无泄漏 `__externalLinkConfig`、无 page error |
| Owner E2E / 官方 console / headless MCP / world console | **PASS** | `OWNER_E2E_PASS`；`COMPANION_CONSOLE_SMOKE_OK`；`HEADLESS_MCP_SMOKE_PASS`；`WORLD_CONSOLE_SMOKE_PASS` 3/3 |
| typecheck / 定向 unit 6 文件 49 测试 / MCP build / vite build | **PASS** | 见 `GATES.md`（首跑 unit 因冷构建前置 FAIL，补 build 后全绿，已如实记录） |

## 2. 硬阻断（必须修复后才能放行 P3-b A）

### B1 — Agent 可重授权装自己的 Owner secret 并自 confirm（Owner 隔离破口）

`worldBridgeServer.ts` 的 `/world-link/companion-authorize`：
```ts
if (!originMatches(req, options.gateway, session)) return originDenied(res);
const r = companions.authorize(session, epoch, mode);
if (!r.ok) return companionResult(res, r);
ownerSecretHashes.set(session, hash);   // 无「既有 secret 校验」，直接覆盖
```
`originMatches` 只比较 `req.headers.origin === gateway.sessionOrigin(session)`；而 **Origin 是 Node Agent 可任意伪造的公开值**（`scripts/c3b-bridge.mts` 明文打印 `ORIGIN=${ORIGIN}`，默认 `http://localhost:5173`），token 是 Agent 本来就持有的凭据。因此：

- **重授权链**（`reviewer-probe-reauth.mts` / `reviewer-probe-reauth-boundary.mts`）：人类正常握手+授权→Agent `attach()` 拿到 session/epoch→Agent 伪 Origin 重跑 `companion-authorize` 装自己的 `ownerSecretHash`（**200 ok**）→原浏览器 secret **立即失效 403**→Agent 用自己的 secret `companion-decision` **200 ok confirm** → `companion-applied` 也 200。
- **最强形态**（`reviewer-probe-agent-full.mts`）：Agent **自己伪 Origin 握手**→自 `companion-authorize`→自推观察→自 `companion-suggest`→自 `companion-decision` confirm，**全程没有任何人类**（`dec.status=200, ok:true`）。
- **最小知识形态**（`reviewer-probe-agent-minimal.mts`）：Agent 只需 token + 公开 ORIGIN，空 body `attach()` 即返回唯一 live 会话的 session/epoch，随后覆盖人类会话的 secret 并自 confirm + 自报 applied。
- 附带：`/companion-mode` 同样只靠 `originMatches`，Agent 可把 `ai/external → human` 翻回来解除只读（`reviewer-probe-reauth-boundary.mts` 实测 `readOnly:false`）。`/companion-observation` POST 同理。

**为什么开发者测试没抓到**：`companionBridge.test.ts` 只测「Agent 直调 decision 无 Origin→403」「伪 Origin 无 secret→403」，**从不测重授权**；`companionSurface.test.ts` 只做 bundle 字符串扫描。单测结论「Agent token/伪 Origin 不能自 confirm」对直调成立、对链路不成立。

**修复方向（建议，不代改）**：`companion-authorize` 必须是一次性且绑定**已在浏览器内生成的凭据**——例如把 ownerSecret 的生成/哈希注册合并进 `handshake` 的 `authorized=true` 人类点击路径并只在该路径写 `ownerSecretHashes`，重授权必须证明持有**旧 secret**（`ownerSecretOk(session, previousSecret)`）或由新的独立人类凭据签发；`companion-mode` / `companion-observation POST` / `companion-suggestions` / `companion-decision` / `companion-applied` 全部纳入 `ownerSecretOk` 校验；或把 Owner 路由绑定到一个 Agent 完全拿不到的第二 token（与 `LAST_SIGNAL_WORLD_TOKEN` 分离、只在浏览器内存）。修复后需补负向单测覆盖「重授权」「自握手」「空 body attach 后自确认」「mode 翻转」四条链。

## 3. 其他缺口（非硬阻断，但接线前须处理/记录）

| # | 缺口 | 证据 |
|---|---|---|
| G1 | **裁剪证明是可伪造的自声明字符串**：`isEchoObservation` 只校验 `schema` 常量 + `perception` 字段 + 距离 <12；任何知道常量的进程可拼一个「已裁剪」观察。Agent 伪 Origin POST 一个含伪造 Boss target（id=999, hp=900）的观察 → **200**，且 Agent `echo_observe` 回读到该伪造感知，`echo_suggest(perceived_hostile)` 随之被接受（`reviewer-probe-fake-obs.mts`）。额外未知字段仍会被拒，但「LOS/explored 真实发生」并无密码学/进程级证明。接线时应把 observation POST 也纳入 Owner 凭据，或由 bridge 自己从 World 拉取而非信任浏览器/Actor 推送 | gate-probe-fake-obs.log |
| G2 | **收紧后的 `CompanionOwnerLedger` 无生产消费者**：真实接线走 `CompanionGateway.decide`（另一套实现），后者**不校验 `tick >= createdAtTick`、不运行时校验 decision 枚举**（`reviewer-probe-gateway-decide.mts` 实测 `tick=0`（创建于 10）与 `decision='anything'` 均 `ok:true`）；而 `OwnerAuthorityValidator`/WeakSet 身份校验只在 `companionFacet` 单测与浏览器 `CompanionLink.decide` 本地分支使用，bridge 侧不调用。即 f16741a 的「严格枚举/单调 epoch/tick 下界」在**生产确认路径未生效** | gate-probe-gateway-decide.log + 静态 `NO_PRODUCTION_CONSUMER` |
| G3 | **`markApplied` 不校验 decision**：被 `reject` 的 suggestionId 调 applied 仍返回 `applied:true`；receipt 语义不严谨（虽不产生 core 效果，但「receipt 不可提前/误报效果」只做了一半） | gate-probe-receipt.log |
| G4 | **External 主角接管不置 companion 只读**：`gateway.setOwnerMode('external')` 本身正确，但 `GameScene.authorizeExternalAgent()` **不调用** `companionLink.setOwnerMode('external')`（只有 `toggleAiControl` 调 `ai/human`）。即 C3-b 外部 Player 接管主角时，Owner 面板仍可能确认 ECHO 建议，AI/External 互斥非对称 | gate-probe-external-mode.log |
| G5 | **TS `private` 不是运行时隔离**：`ownerSecret`/`capability` 在 `CompanionLink` 实例上可枚举，`JSON.stringify(link)` 会带出 secret。当前生产三入口无 `__game` 故不可达；但任何 dev/diagnostic 序列化、错误上报、`__game` 泄漏都会暴露。建议改 `#private` 字段或闭包 WeakMap | gate-probe-serialize.log / gate-probe-owner-e2e.log（`capabilityEnumerable:["ownerSecret","capability"]`） |
| G6 | 其余既有小残余：`E_ACTION_EXPIRED` 实际不可达（`advanceTo` 先驱逐→`E_TARGET_DESTROYED`）；`rebindEpoch` 后旧 epoch decision 仍留在 `list()`；`companion-decision` 的 `tick` 由浏览器自报（`suggestion.createdAtTick+1`）而非权威 core tick | gate-probe-contract.log / 源码 |

## 4. Lead 真实 LLM 建议实跑是否允许 / 缺口 + Signal 状态

**本轮不允许 Lead 做「真实 LLM 逐轮建议」验收实跑**，理由：
1. **B1 未修**：Agent 可自授权自确认，任何「人类 Owner 已确认」的证据都无法证明确为人类授权；真实模型接入后该破口直接变成可越权执行路径。
2. 即使官方 MCP 工具面本身干净（4 个工具、无 confirm），`echo_suggest` 的观察来源（G1）、确认路径的严格性（G2/G3）与 External 互斥（G4）都未闭环。
3. **仍无真实 LLM 连接**：`scripts/p3b-companion-console.mts` 只是官方 SDK REPL（observe/suggest/status/memory/quit），不预写策略、不调模型；`companionConsoleSmoke` 只证明工具能启动。**没有模型逐轮建议 → 人类确认 → core 提交的真实回合证据**。
4. **Signal 未实现（此轮不假完整 P3-b）**：`World.enqueueCompanionAction` 对 `scan/jam` 明确 `return false`（注释「P3-b B」）；`World.ts` 无 `spawn-signal/signal-scan/signal-jam/createSignalResources`；`signalCombatStatus()` 仍 `E_NOT_APPLICABLE / world.signal_combat_unsupported`；`world_signal_status` 工具描述「NOT implemented」；headless smoke `PASS signal_unsupported`。即 `scan/jam` 类建议即使被确认也**不会入队**，`availableActions` 的 jam `<6` 只到 DTO 层。B（core Signal 状态/命令/事件/canonical/checkpoint、v2 协商、Headless 同规则、Signal Combat 批测）与 C（正式 Relay 合作场景/五视口/跨端 echoSignal 字节 parity/full E2E）尚未实施；默认 run / 旧 C2 hash 不变。
5. 既有两份真实 LLM 最小遭遇（Rendered `lead-live`、Headless `lead-headless-cropped`）是 **P3-a 前的 Player 证据**，不代表 ECHO 已跑 LLM、也不代表本轮 Owner 链路经过真实模型验证。

**允许的范围**：在 B1/G1–G4 修复并补负向门禁后，可先用官方 SDK 做「observe → suggest → 人类 UI CONFIRM → 下一 core tick 单条 echo intent」的**受控实跑**（本轮 Owner E2E 已用真实 HTTP 提议 + 真实 Pause UI 确认覆盖此链，只是提议来自脚本而非模型）；真实模型逐轮建议仍需 Lead 后续亲自用正式工具执行并留证。

## 5. 范围与诚实边界

- 本地确定性 HTTP 脚本/官方 SDK REPL ≠ 外部 LLM；渲染 E2E ≠ Headless World；开发者自测已由本轮独立复跑，但仍是 fixture/dev 句柄驱动；本轮**没有**真实模型遭遇、没有 Signal Combat 批测、没有五视口 UI 验收、没有跨端字节 parity。
- 未把「首跑 FAIL」掩盖：冷构建前置、Owner E2E 取样时机均已如实记录并复跑 PASS；**B1 的三条负向探针 `AGENT_FULL/AGENT_MINIMAL/REAUTH_BOUNDARY` 的 `_PASS` 表示「漏洞确实成立」的断言通过，不是产品通过**，已在 `GATES.md` 逐行标注 FAIL（阻断）/PASS（阻断定界）。
- 5176 端口被他人进程占用，未 kill、未复用；dev server/预览用自有 5412/5414；bridge 用 `port:0` 临时端口；token 全为进程内随机假值，未进日志/参数/URL/截图。
- 报告目录：`reports/ai-native-02/reviewer/p3b-a/`（`REVIEW.md`、`GATES.md`、`gate-*.log` ×26、`reviewer-probe-*.mts` ×17、`pw-out-targeting/`）。

未修改生产源码/已有测试/配置/分支；未合并/重置；未读取/恢复共享 WIP/stash。
