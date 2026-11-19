# P3-b Companion 会话生命周期补丁独立定向验收（冻结 `d690848`）

**结论：PASS（精确 scope）。** 首次纯 UI 无 global 表单配对、授权后立即合法 echoObs、暂停 15s 会话存活且 Agent 四工具可用、Owner 真当前 tick 确认→自然 tick 生效、cap 不进 URL、Agent 不持 Owner 凭据、hardkill 4s 独立租约 fallback 不被浏览器心跳续命、旧 epoch 无动作、重复确认不双执行 —— 全部独立复现通过。权限攻链、门禁与 C3b resume 定向均绿。

**范围边界**：本单为接口/生命周期验收，只使用官方 SDK 与真实 UI；未重放任何建议策略、未冒充真实 LLM（Lead 本轮真实 LLM 击杀见 `reports/ai-native-02/lead-echo-model-live/`，不在本单内）。不重跑全量套件。

## 冻结

- 目标：`d6908489b39edcb4e10882d79b35707a23b92229`（父 `ae8b4e22e9d82fc98b295ac52beb5382515446b1`，`ae8` 为纯表单修复，7fd 纯表单根因已由该链修复）
- 冻结时 HEAD 同目标值；工作区 WIP 未读取、未使用
- `git archive d690848 | tar -x` → `D:/Project/AI-NATIVE-02-snapshots/d690848`；2033 文件，全量 sha256（`00-all-files.sha256`）；二次解包 `diff -rq` 零差异（`00-archive-diff.log`）
- 未改源/测/配置/分支，未 merge，未读 stash。独立端口 dev 5392 / bridge 8904；凭据独立私有文件且有 ACL；产物 secret 扫描零命中；Agent MCP env 仅 bridgeUrl+token，无 ownerKey/cap。

## 门禁逐行（完整 `gate-summary.log`）

| 结论 | 门 | 命令 / 结果 |
|---|---|---|
| PASS | 冻结 | `git archive d690848` + 全量 hash + 二次 diff=0 |
| PASS | typecheck | `npx tsc --noEmit` → 0 |
| PASS | unit | `npx vitest run` → 57 files / 673 tests |
| PASS | prod build | `npx vite build` → 0 |
| PASS | MCP build | `npx vite build --config vite.mcp.config.ts` → 0 |
| PASS | Owner 攻链少量 | `probe-b1-attack.mts` → **19 SECURE / 0 VULNERABLE** |
| PASS | 真实 15s 会话 | `probe-real-ui-session.mts` → **18/18 PASS** |
| PASS | 生命周期 | `probe-lifecycle.mts` → **14/14 PASS** |
| PASS | C3b resume 定向 | `PORT=5392 npx playwright test tests/resume-no-step.spec.ts` → **3 passed** |
| PASS | 开发者 15s E2E 交叉 | `PORT=5392 npx playwright test tests/p3b-companion-owner.spec.ts` → **2 passed** |
| PASS | secret 扫描 | 产物中 Bearer/ownerCap/ownerKey 模式零命中 |

## 真实 UI + 官方 SDK（独立探针 18/18）

`probe-real-ui-session.mts`：全新 browser context，**无任何 `__externalLinkConfig` 预注入**，走真实 NEW RUN→ECHO→真实 drone→Pause LLM COMPANION→ENABLE 掩码表单填 bridgeUrl/token/ownerKey→AUTHORIZE。

1. **首次纯 UI 表单成功**：提交后 `companionStatus=CONNECTED`，`globalBefore=[]`（证明无 host 配置），7fd 的纯 UI 失败已修复。
2. **授权后立即有合法 echoObs**：官方 SDK `echo_observe` → `ok=true, drones=1`（真实 drone，非手工 push）。
3. **暂停 15s**：core tick `29→29`（不变），`companionStatus=CONNECTED`；浏览器 1s 心跳维持 rendered session。
4. **Agent 正常 lease 下四工具成功**（15s 暂停后）：`echo_observe ok(1 drone)`、`echo_status ok(link=connected)`、`echo_memory ok(entries=1)`、`echo_suggest ok(kind=fire,status=proposed)`。
5. **cap 不进 URL**：页面请求全捕获 21 条，`capInUrl=false`；GET `companion-suggestions` 用 `x-owner-cap` header（`capHeaderUsed=true`）；POST 走 body。
6. **Agent 不持 Owner 凭据**：MCP stdio env 仅 `LAST_SIGNAL_WORLD_BRIDGE_URL` + `LAST_SIGNAL_WORLD_TOKEN`；官方工具恰好四路、无 confirm/owner 工具。
7. **Owner 真当前 tick 确认**：暂停中点击 CONFIRM → `hasPendingCompanionIntent=true`，tick 仍 29；恢复后自然帧 tick `29→37`、`echoShots 0→1`、pending 清空（无手工 step/flush）。
8. **无页面/控制台错误**；截图 `evidence/real-ui-session.png`。

### 状态一致性观察（不掩盖，不列为 gate 失败）

Owner 确认后再次调用 Agent `echo_status`，该建议**仍在 `pending` 中且状态为 `proposed`**（`pendingCount=1, containsConfirmed=true`）。即 Agent 侧状态未反映已确认/已执行。证据 `01-real-ui.json` 第 16 项。这是状态一致性观察，建议后续统一 decision/applied 对 `echo_status` 的可见性；本单不将其当作安全失败，也不掩盖。

## 生命周期（独立探针 14/14）

`probe-lifecycle.mts`：
- hardkill（无 agent-renew 5.2s，同时浏览器每 500ms 心跳 8 次成功）→ `agent-status attached=false, status=closed`；证明浏览器心跳**不能**给独立 Agent 租约续命。
- 过期后浏览器心跳被拒（`403 owner_capability_required`，旧 cap 随 session 失效），无法复活。
- 旧 session/epoch 的 `action-submit` / `companion-observation` → `404 E_SESSION_NOT_FOUND`；重新 handshake 得到新 session，旧 epoch 仍被拒。
- 首次 confirm+applied 200；重复 confirm → `400 E_RETRYABLE companion.decision_exists`，重复 applied → `400 E_RETRYABLE companion.decision_already_applied`；`move` 类建议同样只执行一次。无双执行。

## Owner 攻链（19/19 SECURE）

复用 `probe-b1-attack.mts`（原 87ab379 攻击链，路径改指 d690848）：X2 覆盖、X4 假 observation、X6 自 confirm、X7 自 applied、X9 模式翻转均 403；Y2 早期 tick `E_STALE_TICK`；Y5 reject 不可 applied；C1/C2 自 handshake 均 `world.owner_pairing_required`；合法 cap 在攻击后仍有效。安全边界未被本次生命周期补丁削弱。

## 可发布判断

**PASS，可发布（精确 scope = Companion 会话生命周期 + Owner 授权不回归）**。未验证真实 LLM 建议（禁）、不外推 Signal B / P4 / 全量套件。上述 `echo_status` 状态一致性观察需另行跟踪，但不阻塞本补丁的生命周期/安全验收。

## 路径

`reports/ai-native-02/tester/p3b-session-final/`
`gate-summary.log` / `00-freeze.log` / `00-all-files.sha256` / `00-archive-diff.log` / `01-real-ui.json` / `02-lifecycle.json` / `02-typecheck.log` / `02-unit.log` / `03-prod-build.log` / `04-mcp-build.log` / `05-owner-attack.json` / `06-real-ui-session.log` / `07-lifecycle.log` / `08-c3b-resume.log` / `09-dev-15s-e2e.log` / `evidence/real-ui-session.png` / `probe-*.mts`
