# P3-b A 独立验收补充：Reviewer B1 攻击链复核（冻结 `a1e23dd`）

**结论：FAIL — Reviewer B1 安全漏洞已独立复现，P3-b A 不可发布。**

## 冻结与范围

- 目标提交：`a1e23dd17ab5ba79795472aae5ad37000aff4151`（父 `d768f6f1cd9ecfb3958c221b14e8fb9aef7df2b5`）
- 冻结目录：`D:/Project/AI-NATIVE-02-snapshots/a1e23dd`（`git archive` 解包 + `node_modules` junction）
- 完整性：`md5sum -c 00-frozen-hashes.log` 全部 11 个关键文件 `OK`（含 `worldBridgeServer.ts`、`companionGateway.ts`、`companionFacet.ts`、`companionLink.ts`、`companionMcpTools.ts`）
- 命令：`cd snapshots/a1e23dd && npx tsc --noEmit` → `TYPECHECK=0`，日志 `01-typecheck.log`（0 字节）
- 基线：MCP 构建 `npx vite build --config vite.mcp.config.ts` → exit 0（`03-mcp-build.log`）；单测 `npx vitest run` → 54 files / 658 tests 全通过（`02b-unit-after-mcp.log`）
- **注意**：上述绿色门禁与 `companionBridge.test.ts` 中的「`confirm 403`」断言均**不能**说明安全。本轮以独立攻击链为准，不把绿测外推为Owner隔离成立。
- 未做任何真实 LLM/Agent 调用；未改源/测/配置；所有服务自起自停，独立端口（探针使用 bridge 随机端口，ORIGIN 声明为 `http://localhost:5392`，与 dev server 无关）。

## 独立攻击链（逐项一行）

命令统一形式：`cd snapshots/a1e23dd && npx vite-node D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/p3b-a-final/probe-b1-attack.mts`
结果：`22/22 观察项均符合预期`（即攻击步骤全部成功、声称的防护全部被绕过），证据 `b1-attack.json`。

- **X2 主机密覆盖**：Agent（持共享 token）从伪造 Origin POST `/world-link/companion-authorize` 携带自己的 `ownerSecretHash` → `200`、原浏览器 `ownerSecretHash` 被覆盖。**攻击成功**（B1 核心）。
- **X3 旧凭据失效**：覆盖后真实 Owner 的 secret 再 POST confirm → `403 companion.owner_capability_required`，证明覆盖确实生效。
- **X4 自投观察**：Agent 从伪造 Origin POST `/world-link/companion-observation` → `200`，观察被写入 gateway。
- **X5 自提议**：Agent token-only POST `/world-link/companion-suggest` → `200 proposed`。
- **X6 自确认**：Agent 用自己 secret + 伪造 Origin POST `/world-link/companion-decision` → `200`，`decision=confirm` 被记录。**攻击成功**。
- **X7 自标记已应用**：Agent POST `/world-link/companion-applied` → `200 applied:true`。**攻击成功**（完整闭环：提议→确认→applied 均可被 Agent 自导自演）。
- **X9 模式翻转**：Agent 从伪造 Origin POST `/world-link/companion-mode` `{ownerMode:'human'}` → `200 readOnly:false`，可把 `external` 翻回 `human` 恢复写入权。**攻击成功**。
- **Y2 过早期 tick**：生产 `CompanionGateway.decide` 对 `createdAtTick=100` 的提议接受 `tick=50` → `200`（无 `tick < createdAtTick` 校验）。**缺陷成立**。
- **Y5 reject 被 applied**：生产路径 `decide(decision='reject')` 后 `markApplied` → `200 applied:true`。**缺陷成立**。
- **Y6 对照**：严格 `CompanionOwnerLedger.decide` 对同样 `tick=50` → `E_STALE_TICK`，证明生产路径确实绕开了严格实现。
- **X1 对照（唯一未攻破项）**：Agent 在 live session 上重 handshake → `409 world.duplicate_handshake`（已阻断）。即 reviewer 表述的「re-handshake/authorize」中，仅 re-authorize 可用；这不影响 B1 成立，因为 authorize 一条即可覆盖 Owner 凭据。
- **G1 基线对照**：伪造 Origin + token 但**不带 secret** → `403 owner_capability_required`（与现有单测一致）。该基线正确但不足以防护，因为 secret hash 可被 Agent 自己通过 X2 重新安装。

## 结论要点

- Reviewer `reports/ai-native-02/reviewer/p3b-a/REVIEW.md` 的 B1 在实际 HTTP bridge 上以具体请求复现：`agent token + 公开/可伪造 Origin` → 重新 `companion-authorize` 覆盖 Owner secret hash → 自提交 observation/suggest/confirm/applied 全链路成功，并可翻转 ownerMode。
- 开发者声称的「独立 Owner bootstrap 凭据」在当前代码中可被同源 token 请求覆盖，Owner 隔离失效；生产 `Gateway.decide` 与严格 `CompanionOwnerLedger` 行为不一致（tick 校验、capability 校验）；`reject` 也可被 `markApplied`。
- 本轮只验证安全边界，**未验证真实 LLM 建议**（按约束禁止），不将任何绿测外推为 P3-b A 通过。A 保持未发布，C 协作为依赖 A 的状态不解除。

## 路径

- 报告：`reports/ai-native-02/tester/p3b-a-final/P3B-A-SECURITY-RECHECK.md`（本文件）
- 攻击探针：`reports/ai-native-02/tester/p3b-a-final/probe-b1-attack.mts`
- 原始结果：`reports/ai-native-02/tester/p3b-a-final/b1-attack.json`（22/22）
- 门禁日志：`01-typecheck.log`、`02b-unit-after-mcp.log`、`03-mcp-build.log`、`00-frozen-hashes.log`（同目录）
