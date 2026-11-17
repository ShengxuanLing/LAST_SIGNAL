# GAMEPLAY-01 · P2 真实 Magpie ECHO 链 · 独立实验报告（v2：证据口径收尾）

**结论（不变）：本次实验 PASS —— 真实模型 → 合法 ECHO 观察 → 官方 `echo_suggest` → Owner fixture 确认/拒绝 → 真实 core 执行 → 断线降级。**
**本轮只做证据口径收尾：0 次新模型请求、未重跑、未改 src/tests/config、未提交。**

- 运行时：`git archive 87a0fac` → 独立快照 `D:/tmp/gp01-echo`，**自有 `dist-mcp` 构建**（exit 0），cwd/devRoot 均在该快照；未写共享旧 reports。
- 源 hash（LF 字节，内容与 v3 manifest 10 源一致）：`echo.ts 5408830f…`、`PauseScene.ts ed323491…`、`World.ts 37cf6ffb…`（运行前后不变）。
- 模型：本地 Magpie `http://127.0.0.1:3425/v1/chat/completions`，`group/elisa`，无凭据；不推断 vendor；不读取/输出任何密钥。
- 证据目录：`reports/gameplay-01/reviewer/real-model-echo/`。

---

## 0. 预算与计数依据（**已修正**：不是"精确 8"）

| 计数口径 | 数值 | 依据 |
|---|---|---|
| **trace 可独立核实** | **4 次** | 两次归档运行各 2 次请求，`trace-87a0fac-final.json` / `trace-87a0fac-scan.json` 内有 id/延迟/usage/可见输出 |
| 执行者记录、原始日志**已被同名覆盖** | **6 次**（早期 4 次尝试：1+1+2+2） | 仅凭本会话执行记录；其中 5 个 request id 有当场打印（见 §6 表），**1 个 id 未留存**；**原始日志/trace 不可复核** |
| 合计（执行者记录） | **10 次** | 上限 12 次；但**严格可核实的只有 4 次**，其余 6 次的预算遵守属"执行者记录、证据有限" |

- 单次运行 wall clock：27.6s / 29.3s（限 5 分钟）——两项均由 trace `budgetUsed` 记录。
- 每次 `max_tokens = 1024`（harness 硬编码，见 `harness.echo.spec.ts`）。
- **不重试追绿**：早期失败全部是我方 harness 缺陷（§6），未靠调大预算/超时；失败后未再刷同一路径。

## 1. 模型请求账本（成功两次运行，逐条可核）

| 运行 | # | request id | route / http | 延迟 | usage（prompt/completion/reasoning） | 模型可见输出（严格 JSON） |
|---|---|---|---|---|---|---|
| run#1（toggle） | 1 | `chatcmpl-c975c036e99b5539b3b95fde335f8d64` | group/elisa · 200 | 1381ms | 417 / 24 / 0 | `{"kind":"toggle-relay","reason":"perceived_relay","target":{"x":8,"y":45}}` |
| run#1（toggle） | 2 | `chatcmpl-3f2fe8497040fac524136a386e7b294a` | group/elisa · 200 | 1960ms | 770 / 23 / 0 | `{"kind":"toggle-relay","reason":"objective_blocked","target":{"x":8,"y":45}}`（该条被 Owner 拒绝） |
| run#2（scan） | 1 | `chatcmpl-0fe7a5cdff8e5c2ad98aa3ef4292f58f` | group/elisa · 200 | 2167ms | 409 / 26 / 0 | `{"kind":"scan","reason":"perceived_hostile","target":{"x":11.7890625,"y":45}}` |
| run#2（scan） | 2 | `chatcmpl-a1f4cb81d5021172634766f7d6f84c7f` | group/elisa · 200 | 1608ms | 788 / 24 / 0 | `{"kind":"toggle-relay","reason":"perceived_relay","target":{"x":8,"y":45}}`（该条被 Owner 拒绝） |

→ 两次运行模型给出**不同 kind**（toggle-relay / scan），**不是脚本固定**；未保存内部 reasoning（该路线 reasoning_tokens 均为 0）。

## 2. Task 1 — 真实入口 + 官方 Owner 配对（fixture 输入）

- 真实主菜单 `DEMO 01 · LINKED SENTRY` → `ESC → AI & COMPANION → ECHO COMPANION → ENABLE ECHO` → **resume 真实 tick** 后 ECHO 落地（`{hp:94,x:8.625,y:45}`）。
- 暂停 → `LLM COMPANION` → `ENABLE / RE-AUTHORIZE` → **真实掩码表单**（bridge URL / token / `TEST_OWNER_KEY` 全由 fixture 注入；**不打印、不截图、不进 prompt**）→ `companionStatus = CONNECTED`。
- 标注：Owner 表单输入与所有 Owner 点击 = **autoOwner fixture，不是真人**。

## 3. Task 2 — 模型只拿合法观察、自己决定 kind

官方 SDK（`dist-mcp/companionMcpServer.mjs`，token-only）`echo_observe` 返回的观察仅含：`echo / player / drones(按感知) / relay(echo 自身感知) / energy / cooldowns / memory`。**无 seed、无全图、无 hidden/dev、无 cap/Owner key。**
模型输出经 kind/reason 枚举 + target 数值合法性校验后，由官方 `echo_suggest` 提交（两次运行均 `ok:true`）。

## 4. Task 3 — 暂停只入队 → 下一 tick 真实 receipt

| 断言（两次运行一致） | 实测 |
|---|---|
| 暂停中确认 | `pendingCommands = 1`；echo/player energy 与 tick 均不变（run#1 tick 98、run#2 tick 93） |
| 重复确认 | 再点 CONFIRM → 队列**仍为 1**（不重复） |
| resume 后 | 队列清空，tick 推进（98→241 / 93→236），`pendingIntent=false` |
| **scan（run#2）** | `signal-scanned {actorId:1, ok:true, energy:90}` → echo **100→90（精确 = SCAN_COST 10）**、evidence 0→1、relay 仍 ACTIVE、**player energy 不变** |
| **toggle（run#1）** | `signal-relay-changed {relay:'INACTIVE', manualEnabled:false}` **恰好 1 次**，relay ACTIVE→INACTIVE，energy 不变（按 kind 正确） |
| 来源 | 标注 `fixture: autoOwner click (not human)`；属 **owner-external**，未与 P2 本地 `human-local` 混淆 |

## 5. Task 4 — 拒绝、断线降级、离线本地路径

- **拒绝**：先 `pushObservation()` 推新观察 → 模型对新观察出第二次建议（官方 suggest 接受）→ Owner fixture `REJECT FIRST PROPOSAL` → `pendingIntent=false`、**tick 不前进**（265→265 / 271→271）、energy/evidence 不变；`pending()` 中该 id **已不存在**（不可复活）。
- **断线**：`DISCONNECT (NO MODEL)` → `companionStatus = FALLBACK:NO_MODEL`、`companionLink = null`；UI 实测 `STATE FALLBACK:NO_MODEL` / `MODEL OFFLINE` / `No pending proposal.`（**无假 CONNECTED**）；ECHO 实体与手动跟随仍在（hp 94/88）。
- **离线本地路径**：`LOCAL COOPERATION` 生成 deterministic `local_267_1 · scan`（**不是模型**），Owner fixture 确认 → 队列 1；断线**不**自动获得 Dev/autoConfirm。

## 6. 失败说明与证据缺口（**标题与口径已按 Lead 要求修正**）

**不能声称"失败全部保留"。** 事实是：

- 本任务共 4 次早期失败尝试（1+1+2+2 = 6 次请求），失败原因**全部是我方 harness 缺陷**，不是产品：
  1. 用 `hasPendingCompanionIntent` 判断非移动动作（scan/toggle 走的是 signal 命令，不是 companion intent）；
  2. 等待已废弃的 UI 文本 `CONFIRMABLE`（P2 已改为 `▶ KIND · reason · tgt …`）；
  3. 断线后导航按固定 `BACK` 次数（已改为 ESC 逐层 `toRoot`）。
- 这些尝试的 **run 日志/trace 已被同名文件覆盖，原始记录不可复核**；仅保留了执行时的控制台记录（下表）。**不重建、不伪造已丢失日志。**
- 早期请求 id（有当场打印、但无留存日志，**不可独立核实**）：
  `chatcmpl-6b0a5347f02719b64dc28ca37f9de61e`（2261ms, scan）、
  `chatcmpl-cdbdd3a7d70056d2e92b46b816beef84`（1724ms, toggle）、
  `chatcmpl-4a8ca41b55586a930f8044db0de29777`（1943ms, toggle）、
  `chatcmpl-58bea61a7deba0e1578a4e2aa5dc4055`（1514ms, toggle）、
  `chatcmpl-f0d9fef04dc5ec3efcec6b2ae8ebbe75`（1371ms, toggle）；
  另有 1 次早期请求的 id 未留存。
- 因此：**成功 trace 确认 4 次**；早期 6 次为"执行者记录、原始证据缺失"；**不要再断言精确 8 次**，也不要把 10 次当作完全可核。

## 7. 未验证范围（不变）

真人操作（Owner 全为 fixture）、`jam` kind、模型输出非法 JSON 的完整拒绝路径（两次均合法）、真实 checkpoint 下的 pending 恢复、完整 794/全量 Playwright、fresh Rendered↔Headless parity；场景为 authored DEMO 01 且**未清敌**（echo 真实掉血 94→88），不称"自然通关/无辅助完整战斗"。模型链 PASS **不代替**完整回归、P4 或真人验收 → `HUMAN ACCEPTANCE PENDING`。

## 8. 交付物清单（`reports/gameplay-01/reviewer/real-model-echo/`）

| 文件 | 说明 |
|---|---|
| `REAL_MODEL_ECHO_REPORT.md` | 本报告（含下方复跑说明） |
| `harness.echo.spec.ts` + `pw.echo.config.ts` | **可复跑 harness（已随证据目录交付，无密钥）**：token 为运行时 `randomBytes`，Owner key 导入公共测试向量 `src/ai-native/ownerAuthFixture`，**无任何真实凭据字面量** |
| `run-87a0fac-final.log` + `trace-87a0fac-final.json` | run#1（模型选 toggle-relay）完整日志与 trace |
| `run-87a0fac-scan.log` + `trace-87a0fac-scan.json` | run#2（模型选 scan）完整日志与 trace |
| `echo-1..5-*.png`（无后缀，5 张） | run#1 截图：模型建议 / 确认结果 / 拒绝 / 断线 / 离线本地 |
| `echo-1..5-*-scanrun.png`（5 张） | run#2 截图，同上五类 |
| `dist-mcp-build.log` | 该快照自有 MCP 产物构建日志 |

**截图口径：每次运行 5 张，两次共 10 张**（不是"总共 5 张"）；均为 1280×720，表单类画面只显示掩码输入，无密钥明文。

## 9. 复跑方法（cwd 必须是独立快照）

```bash
mkdir -p D:/tmp/gp01-echo && cd D:/Project/LAST_SIGNAL && git archive 87a0fac | tar -x -C D:/tmp/gp01-echo
cmd //c "mklink /J D:\\tmp\\gp01-echo\\node_modules D:\\Project\\LAST_SIGNAL\\node_modules"
cd D:/tmp/gp01-echo && npx vite build --config vite.mcp.config.ts
mkdir -p _review && cp <证据目录>/harness.echo.spec.ts <证据目录>/pw.echo.config.ts _review/
npx vite --port 5488 --strictPort &
PORT=5488 npx playwright test -c _review/pw.echo.config.ts --workers=1
```
harness 内建约束：≤12 请求、每次 `max_tokens=1024`、单次运行 wall ≤5 分钟、失败不自动重试；Owner 点击统一标 `autoOwner fixture`；本地 deterministic proposal 与模型建议分开记录。

## 10. 本轮检查（一行一条）

| 检查 | 结果 | 依据 / 绝对路径 |
|---|---|---|
| 两次成功运行的 4 次请求 id/延迟/usage 与 trace 一致 | **PASS** | `…/real-model-echo/trace-87a0fac-final.json`、`trace-87a0fac-scan.json` |
| 早期 6 次请求的原始日志/trace 是否可复核 | **UNVERIFIABLE**（已被同名覆盖，仅执行者记录） | 同上目录；本报告 §6 |
| harness 与 config 是否随证据目录交付 | **PASS** | `…/real-model-echo/harness.echo.spec.ts`、`pw.echo.config.ts` |
| 证据目录是否含真实凭据明文（64-hex/token/Bearer） | **PASS**（未发现；仅公共测试向量 import） | `grep -rlE "[0-9a-f]{64}" …` 无命中 |
| 截图口径 | **PASS**（5 张/次 × 2 次 = 10 张） | `ls …/real-model-echo/*.png | wc -l` = 10 |
| 本轮未新增模型请求 | **PASS**（本次 0 次；trace 计数未变） | trace `budgetUsed` 仍为 2/2 |
| 快照源未被修改 | **PASS**（echo/PauseScene/World hash 前后一致） | `D:/tmp/gp01-echo` 内 hash 比较 |
