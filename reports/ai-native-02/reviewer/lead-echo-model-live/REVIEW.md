# Lead 实际 LLM ECHO 两轮建议证据独立审查 + d690848 会话修复复核

- **被测提交**：`d6908489b39edcb4e10882d79b35707a23b92229`（HEAD，分支 `feat/ai-native-world-integration`，父 `ae8b4e2`）
- **冻结**：`git -c core.autocrlf=false -c core.eol=lf archive d690848 | tar -x -C D:/Project/AI-NATIVE-02-snapshots/d690848-lead`（隔离快照）；`node_modules` junction；逐文件 git blob SHA1 → **ALL_TRACKED_FILES_MATCH（2033/2033, MISMATCH=0, MISSING=0）**
- **边界**：只读原始 log/脚本/录像抽帧；未改生产源码/已有测试/配置/分支；未 merge/reset；未读/恢复共享 WIP/stash；token/ownerKey 仅进程内；先前 7fd/ae8b4e2 失败目录分开保留、未混用
- **结论**：**① d690848 修复了我 SESSION_REPRO 的四个缺陷，且无授权回退（独立 15 秒 probe 实证）；② Lead 的“真实 LLM ECHO 建议 → Owner UI 测试确认 → 真实协作”最小子项可以关闭（有限范围）；③ 不是真人确认、不是 Signal、不是完整 Run。**

## 1. d690848 对 SESSION_REPRO 四缺陷的修复（源码 + 独立 probe）

| 原缺陷 | d690848 修复 | 证据 |
|---|---|---|
| D1 授权后不推首份 observation | `GameScene` 授权成功后立即 `void companionLink.pushObservation()`（不恢复 tick） | `GameScene.ts` diff；probe B |
| D2 Pause 冻结 GameScene 帧→永不推观察 | 首份观察在 authorize 时推，不依赖帧 | probe B |
| D3 心跳只 GET status、默认 5000ms，与 LOST 5s 冲突 | 心跳改为真实 `POST /world-link/heartbeat`，默认 **1000ms**，幂等，失败降级 NO_MODEL，绝不续 Agent lease | `companionLink.ts` diff；probe A |
| D4 ownerCap 放 query URL；`decide` 用 `createdAtTick+1` | GET 改 `x-owner-cap` 头（POST 仍 body）；桥接读头（query 仅兼容回退）；`decide` 用真实 `appliedTick()` | `companionLink.ts`/`worldBridgeServer.ts` diff；probe C/D |

**独立 15 秒暂停 probe**（真实 `CompanionLink`，无浏览器、无手动 push/step；`reviewer-probe-d690848-fix.mts`）：
```
PASS B: first echo_observe succeeds immediately after authorize (no game frame needed)
PASS C: companion-suggestions GET carries a valid 64-hex x-owner-cap header
PASS C: companion-suggestions GET URL contains NO ownerCap
PASS C: header-cap GET accepted (status 200, Owner-only read works)
PASS D: decide tick == real appliedTick() (40) ; re-read live (41)
PASS A: session stays CONNECTED through 15s pause (14 renderer heartbeat POSTs)
PASS A: epoch NOT bumped during pause
PASS A: echo_observe still succeeds after 15s pause (no stale_epoch)
PASS E: missing cap rejected 403 ; wrong cap rejected 403 ; wrong cap via query fallback still rejected 403
D690848_FIX_PASS failures=0
```
**无授权回退**：缺失/错误 cap 仍 403；header-cap 与 query 回退都要求有效 cap；`ownerAuth` 8/8、`worldBridgeServer` 7/7、`companionGateway` 5/5、`companionFacet` 23/23 全绿。

## 2. Lead 实际 LLM 两轮证据（原始 log + 录像抽帧独立核对）

**适配器**：`owner-bootstrap-and-agent-adapter.mts` 仅把外部输入的 tool JSON 透传给官方 MCP（无建议策略/无预写目标）；Agent 子进程 env 仅 `LAST_SIGNAL_WORLD_BRIDGE_URL`+`TOKEN`（无 ownerKey/cap）；`_owner_confirm` 分支是**独立真实 UI 点击**（`CONFIRM FIRST PROPOSAL` → Escape → 正常 600ms → Pause），无手动 `pushObservation`/`step`。Owner bootstrap 仅 `enableEcho`+真实生成 room spawn 一只 drone，无 HP/伤害/资源修改。

**原始序列与独立核对**（`tool-io.jsonl` / `owner-ui.jsonl`；session id 已脱敏 `ses_…`）：

| 轮 | 工具/事件 | 时间 | 关键值 | 核对 |
|---|---|---|---|---|
| 1 | echo_observe | 17:36:35.558 | tick9, echo(9,45)HP100, player(8,45), drone#1(9,43)HP24, memory1 | 基线 |
| 2 | echo_suggest fire target(9,43) | 17:37:09.855 | proposed, createdAtTick9 | **target 来自轮 1 obs 的 drone(9,43)** ✓ |
| 3 | echo_status | 17:37:14.435 | pendingSuggestions1, status 仍 `proposed` | **确认前无效果** ✓ |
| — | Owner UI 确认 1（真实 click） | 17:37:31.101 | tick36, playerHp100, echoHp100, enemies[{id1,hp6}] | **真实 HP 结果 1：drone 24→6** ✓ |
| 4 | echo_observe | 17:37:40.485 | tick29, drone(9,42.7734375)HP6, memory2 | 轮 2 效果已发生 |
| 5 | echo_suggest fire target(9,42.7734375) | 17:37:49.366 | proposed, createdAtTick29 | **target 来自轮 4 obs 的 drone 新位置** ✓ |
| — | Owner UI 确认 2（真实 click） | 17:37:55.343 | tick61, playerHp100, echoHp94, enemies[] | **真实 HP 结果 2：drone 被击杀** ✓ |
| 6 | echo_observe | 17:38:04.302 | tick58, drones=[] | post-commit 缓存，滞后 |
| 7 | echo_memory | 17:38:04.455 | memoryEntries2, TTL600 | ✓ |
| 8 | echo_status | 17:38:04.639 | pendingSuggestions2, **两条仍 `proposed`** | 见下“status 缺口” |

**录像抽帧独立确认**（`video/page@…webm`，800×450，2:56；抽帧 35/60/70/80/88s + HUD 放大）：
- 35s/60s：STATE OFF、HOSTILES 1、ECHO 100/100、KILLS 0、`NOT CONNECTED · NO MODEL`（授权前，无假连接）。
- 70s：STATE `CONNECTED`、HOSTILES 1、ECHO 100/100、KILLS 0（已授权、未击杀）。
- 80s：STATE CONNECTED、HOSTILES 1、ECHO 100/100、KILLS 0（确认 1 后 drone 剩 HP6、未死）。
- 88s：STATE CONNECTED、HOSTILES 0、**KILLS 1 / DMG 30 / XP 8/30 / HP 100/100 / ECHO 94/100**、`COMPANION CONNECTED`、`EXTERNAL NOT CONNECTED`（诚实）。
- 底部 stats 行放大读出：`KILLS 1 · LOOT 1 · DMG 30 · …`。

**结论核对**：
- **target 来自各次 obs** ✓（轮 2→轮 1 obs；轮 5→轮 4 obs，坐标逐位一致）。
- **建议 proposed 前没有效果** ✓（轮 3 status 仍 proposed；录像 70s KILLS0/HOSTILES1；效果仅在 Owner 确认后出现）。
- **两个 Owner 实际 click → 两个真实 HP 结果** ✓（确认 1 drone 24→6；确认 2 drone 击杀；录像交叉确认 KILLS1/DMG30/ECHO94）。
- **不靠 `status.pending` 作为效果** ✓：轮 3/轮 8 的 `pendingSuggestions` 仍显示 1/2 条 `proposed`，确认后也不变；效果依据 Owner 只读记录 + 后续观察 + HUD/录像。这是**Agent 只读 `echo_status.pending` 的缺口**（已由 REPORT 注明），建议后续暴露自身 confirmed/applied receipt。
- **最后 post-commit obs tick58 滞后实际 tick61** ✓：轮 6 缓存观察为 tick58（echoHP100、drones=[]），Owner 读数 tick61（echoHP94、enemies=[]）。**UI HUD ECHO94 与缓存 obs echoHP100 是 3 tick 滞后，不是篡改**（缓存帧早于 echo 受伤时刻）。不称其为完整实时 tick61 帧。

## 3. 可关闭的最小项 / 范围

- **可关闭（有限）**：真实模型（外部输入的逐轮 tool JSON）**ech_o_observe → 自主 echo_suggest 两个不同目标 → 独立 Owner UI 真实点击确认 → 真实 core 效果（drone 24→6→死；KILLS1/DMG30/ECHO94/HP100）** 的最小协作子项；且不存在“手动 push/step/改 HP”或“预写建议策略”。
- **不可关闭**：不是真人授权/确认（自动化夹具点击）；不是 Signal（未接）；不是完整 Run/长期人格；`status.pending` 只读缺口仍在；本证据不构成最终真人交互验收或 LLM 长期建议验收。
- 先前 `7fd`（表单失败）/`ae8b4e2`（暂停无首观察/过期）目录与本目录分开保留、未混用。
- 说明：本轮（d690848）在属主写入与 B1 授权链均无回退；两份既有 Player 小遭遇不受影响。

## 4. 门禁日志（一行 PASS/FAIL + 命令 + 结果 + 路径）

| 行 | 命令 | 结果 | 日志 |
|---|---|---|---|
| PASS | `git archive d690848` + 全文件 blob SHA1 | 2033/2033 ALL_TRACKED_FILES_MATCH | （命令输出） |
| PASS | `npx vite-node reviewer-probe-d690848-fix.mts` | `D690848_FIX_PASS failures=0`（A/B/C/D/E 全过，15s 暂停存活） | gate-probe-d690848-fix.log |
| PASS | `npx vitest run ownerAuth worldBridgeServer companionGateway companionFacet` | 4 文件 / 43 tests PASS | gate-auth-sanity.log |
| PASS | `ffmpeg` 抽帧 35/60/70/80/88s + HUD 放大 | HUD 独立确认 KILLS1/DMG30/XP8/HOSTILES0/ECHO94/HP100/CONNECTED | frames/*.png |

- 未做全量回归（按 Lead「用最小 15 秒 probe 即可无需全量」）；仅最小 probe + 源码审查 + auth sanity + 录像抽帧。
- 探针/日志经复核无 token/ownerKey/ownerCap 值泄漏；session id 已在报告中脱敏。

## 5. 报告目录

`reports/ai-native-02/reviewer/lead-echo-model-live/`：`REVIEW.md`、`gate-probe-d690848-fix.log`、`gate-auth-sanity.log`、`frames/`（抽帧 + HUD 放大）。

未修改生产源码/已有测试/配置/分支；未合并/重置；未读取/恢复共享 WIP/stash。
