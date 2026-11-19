# 门禁逐行 — Lead 真实模型 Signal 最小回合（独立只读复核）

被测产物：`D:\Project\LAST_SIGNAL\reports\ai-native-02\lead-signal-model-live\`（Lead 现场，2026-11-16 00:15–00:18Z）
冻结源码：`363eb173207bb5adaa0a21cd1af348dc92f29827`
本目录：`D:\Project\LAST_SIGNAL\reports\ai-native-02\reviewer\lead-signal-model-live\`
说明：本轮为**只读证据复核**，未回放策略、未修改 Lead 产物；"命令"列即我实际执行的核验命令，"日志"列即其输出留存。

| # | 结论 | 门禁 | 实际命令 | 结果 | 日志（绝对路径） |
|---|---|---|---|---|---|
| 1 | **PASS** | 冻结一致性（源码未变） | `git rev-parse HEAD; git status --porcelain --untracked-files=no \| wc -l` | 复核开始时（约 01:19Z）：`363eb173207bb5adaa0a21cd1af348dc92f29827`、tracked 改动 **0 行**、`bootstrap.json.commit` 同值。**复核结束时（01:26）发现开发者在并发修改 5 个 tracked 源文件**（`companionFacet.ts`/`companionFacet.test.ts`/`echo.ts`/`World.ts`/`sim/core.ts`，mtime 01:22:12–01:22:34），非本次复核所为（我的产出只落在 `reports/…/reviewer/lead-signal-model-live/`，untracked），且本报告所有源码引用均取自 `git archive 363eb17` 的逐 blob 校验快照 | `…\reviewer\lead-signal-model-live\logs\transcript-1-artifacts-and-auth.txt` |
| 2 | **PASS** | 产物哈希留存（12 文本/源 + 14 截图 + 1 录像） | `sha256sum …` | 27 行哈希；截图仅 1 组重复（`13`=`14`，见 #12） | `…\artifact-hashes.txt` |
| 3 | **PASS** | 工具回合数与种类（无预置、无多余工具） | `grep -o '"round":[0-9]*,"tool":"[a-z_]*"' tool-io.jsonl` | 7 轮：observe/suggest/observe/suggest/observe/observe/status；无 confirm 类工具 | `…\logs\transcript-1-artifacts-and-auth.txt` |
| 4 | **PASS** | 无预置建议（bootstrap 阶段 0 建议、0 模型动作） | 读 `bootstrap.json` | `modelActionsPerformed: 0`、`suggestionsMade: 0`、`observationProof.pending: 0`、`receipts: []` | `…\lead-signal-model-live\bootstrap.json`（哈希见 artifact-hashes.txt） |
| 5 | **PASS** | adapter 无建议策略 | `grep -n "perceived_relay\|objective_blocked\|toggle-relay\|kind:" signal-agent-adapter.mts`；`grep -n "for (\|while (\|setInterval"` | 命中仅出现在文件头注释与 `_help` 文本（第 18/134 行）；3 处循环为脱敏/密钥扫描/命令分派，无自动建议、无重试、无兜底 | `…\logs\transcript-1-artifacts-and-auth.txt` |
| 6 | **PASS** | Agent 子进程环境无 Owner key / cap | `grep -o '"childEnvKeys":\[[^]]*\]' tool-io.jsonl`；`grep -n "ownerKey" signal-agent-adapter.mts` | `[PATH,SystemRoot,TEMP,TMP,LAST_SIGNAL_WORLD_BRIDGE_URL,LAST_SIGNAL_WORLD_TOKEN_FILE]`；adapter 从不读 `ownerKeyFile`（仅类型声明与脱敏键名） | `…\logs\transcript-1-artifacts-and-auth.txt` |
| 7 | **PASS** | 确认走独立 UI 的真实鼠标点击（非 API 直调） | `sed -n '104,127p;695,716p' owner-bootstrap.mts` | `clickText` = `page.mouse.click(bounds.centerX,centerY)` 点真实 Phaser 文本；结果 `clicked:"CONFIRM FIRST PROPOSAL (OWNER)"`；面板自述 "The agent MCP has NO confirm tool" | `…\logs\transcript-1-artifacts-and-auth.txt` |
| 8 | **PASS** | 观察→建议→确认→提交 因果顺序 | `grep -o '"at":"[^"]*","command":"[a-z_]*"' owner-ui.jsonl` | adapter 每轮工具后自动截图 → 独立时序锚点：tool1 00:16:29 → tool2 00:16:36 → confirm 00:16:41 → resume 00:16:46 → tool3 00:16:57 → tool4 00:17:07 → confirm 00:17:13 → resume 00:17:18 → tool5 00:17:31 → portal 00:17:44 → tool6 00:18:00 → tool7 00:18:09 | `…\logs\transcript-1-artifacts-and-auth.txt` |
| 9 | **PASS** | 确认只入队、暂停期零早写 | `sed -n '8p;12p' owner-ui.jsonl` | confirm#1：`stateBefore`/`stateAfter` 仅差 `pendingCommands []→["signal-scan"]`，tick 171 不变、`evidence 0`；confirm#2 同型 → `["toggle-relay"]`；`pendingBefore 1 → pendingAfter 0` | `…\logs\transcript-3-run-evidence.txt` |
| 10 | **PASS** | 真实扫描：ECHO 独立扣费 + 证据 1 | `sed -n '9p' owner-ui.jsonl`；`sed -n '64,80p;…signalState.ts'` | resume#1 tick 171→200：`echoEnergy 100→92`、`playerEnergy 100` 不变、`evidence 0→1`、`echoScanCD 91`、relay 仍 INACTIVE、receipt `applied@172`；`commitSignalScan` 的证据源唯一为 relay 设备（`signalState.ts:96-98`），与残敌无关 | `…\logs\transcript-3-run-evidence.txt`、`…\logs\transcript-2-frozen-source-audit.txt` |
| 11 | **PASS** | 能量/冷却与冻结常量逐 tick 精确自洽 | 读 `signalTuning.ts`(ENERGY_MAX100/REGEN_TICKS12/SCAN_COST10/SCAN_CD120) + `transcript-4` 表 | 90→92(t200)→94(t227)→98(t273)（1/12tick，含 regenAcc 余量）；CD 120→91(200)→64(227)→18(273) 逐 tick 精确递减；无一处不合 | `…\logs\transcript-2-frozen-source-audit.txt`、`…\logs\transcript-4-targets-and-geometry.txt` |
| 12 | **PASS** | ACTIVE / exitOpen / receipts 172,201 | `sed -n '13p' owner-ui.jsonl`；`grep -o '"receipts":\[[^]]*\]' tool-io.jsonl` | tick227 `relay=ACTIVE, manualEnabled=true, powered=true, exitOpen=true`；`receipts=[{ab01 applied, decided171, applied172},{ab02 applied, decided200, applied201}]`，`pending=[]` | `…\logs\transcript-3-run-evidence.txt` |
| 13 | **PASS** | room 3 → 具体 room 5（拒绝过渡态 -1 冒充） | `sed -n '756,762p' owner-bootstrap.mts`；`sed -n '15p' owner-ui.jsonl` | 代码显式 `if (id === -1 \|\| id === prev) return false`；结果 `roomBefore 3 → roomAfter 5, roomKind elite`，其后 state/tool-6/tool-7 均 roomId 5 | `…\logs\transcript-1-artifacts-and-auth.txt`、`…\logs\transcript-3-run-evidence.txt` |
| 14 | **PASS** | 录像真实性抽帧（实际看图，非只读 JSON） | `ffprobe …`；`ffmpeg -ss {20,50,60,90,120,140} -frames:v 1` | 146.12s / vp9 / 1280x720 / 25fps / 19.7MB，覆盖 141s 运行窗口；帧内含 HUD 数值与 JSON 完全一致（详见 `frames/`） | `…\logs\transcript-5-media-secrets-cleanup.txt`、`…\frames\f-{20,60,90,120,140}.png` |
| 15 | **PASS** | 截图重复显式披露 | `sha256sum screenshots/*.png \| sort \| uniq -d` | 仅 `be5769b78b11…` 一组重复 = `13-tool-6-echo_observe.png` 与 `14-tool-7-echo_status.png`；原因：`echo_status` 不改画面（t=120s 与 t=140s 两帧 HUD 相同） | `…\logs\transcript-5-media-secrets-cleanup.txt` |
| 16 | **PASS** | 无密文外泄 | `grep -lE "[0-9a-f]{48}\|[0-9a-f]{64}" <8 个文本产物>` | 无命中（exit 1）；`06` 截图内 token/ownerKey 均为圆点掩码 | `…\logs\transcript-5-media-secrets-cleanup.txt` |
| 17 | **PASS** | 凭据清理与进程清理 | `ls -d` 三个临时凭据目录；`netstat -ano \| grep -E ":(5301\|5302\|39914) "` | 三个凭据目录均已不存在（`credentialsDeleted=true`）；5301/5302/39914 无残留监听 | `…\logs\transcript-5-media-secrets-cleanup.txt` |
| 18 | **PASS** | 正式运行与 `_smoke/` 演练分离 | `grep -o '"bridge":"[^"]*"'`（两处）；`head -1`（两处） | 正式：bridge `:39914`，首条 attach `00:16:21Z`；`_smoke`：bridge `:5577`，首条 attach `00:14:18Z`，目录独立 | `…\logs\transcript-5-media-secrets-cleanup.txt` |
| 19 | **PASS（缺陷定界）** | 残敌 fixture 遗留 targets 是否污染 Signal 事实 | `transcript-4`（逐轮 targets 表） | 3 个 hunter 在 tick 171/200/227/273 的 `hp=59` 与坐标**完全不变**（102 tick 零变化 → inert）；扫描证据唯一来源是 relay → 不污染 evidence；但污染 `availableActions` 的 reason | `…\logs\transcript-4-targets-and-geometry.txt` |
| 20 | **PASS（缺陷定界）** | memory 把 hunter 标成 `kind='relay'` 的根因 | `grep -n "kind: 'relay'" companionFacet.ts`；`sed -n '73,82p' companionFacet.test.ts` | 根因 `companionFacet.ts:498` 对 targets 硬编码 `kind:'relay'`；且单测 `companionFacet.test.ts:79` 断言了该错误行为；引入提交 `f16741a`（早于 363eb17，非本 delta 回归） | `…\logs\transcript-2-frozen-source-audit.txt` |
| 21 | **PASS（缺陷定界）** | `availableActions.scan=true` 与 `scanCD=18` 冲突根因 | `sed -n '50,62p' companionFacet.ts` | `companionAvailableActions` 只按最近 actor 距离判定，完全不看 cooldown/energy/objective；另 reason 文案 `perceived_target` 不在 `COMPANION_REASONS` 枚举内 | `…\logs\transcript-2-frozen-source-audit.txt` |
| 22 | **PASS（缺陷定界）** | echo 留原房是否数据错误 | `grep -n "echo" World.ts \| grep -i "room\|teleport"`；`transcript-4` 几何 | 房间切换路径无 echo 迁移/teleport 逻辑（仅 `echoController.reset()`）；tick273 echo 距 relay 3.168 格 < 12 → 观察合法；room5 的 6 个敌人 ~88 格 → 未被上报（裁剪真实） | `…\logs\transcript-2-frozen-source-audit.txt`、`…\logs\transcript-4-targets-and-geometry.txt` |
| 23 | **PASS（源码瑕疵）** | Vite「World.ts 重复 enemy-spawned case」 | `grep -n "case 'enemy-spawned'" World.ts`；`sed -n '1263,1266p'` | 同一 switch（`applySimEvents`，1265 行）里 1319 与 1370 两个同名 case → 第二个不可达（`spawnEnemyFromCore` 为死代码）；tsc 不报错，esbuild 警告；本轮行为由第一个分支完成，无功能影响 | `…\logs\transcript-2-frozen-source-audit.txt` |
| 24 | **PASS（限制）** | 建议时序可证性 | 见 #8 | `tool-io.jsonl` 每轮**无时间戳**；用 adapter 自动截图在 `owner-ui.jsonl` 留下的时间戳建立独立时序，顺序成立 | `…\logs\transcript-1-artifacts-and-auth.txt` |
| 25 | **NOT RUN** | 真人（非自动化点击）Owner 确认 | — | 本轮确认为自动化点击；不构成真人验收 | — |
| 26 | **NOT RUN** | 真实链中的 jam / 建议被拒 / 过期 / 重复决策 | — | 本轮 7 轮只做 observe/suggest(scan,toggle-relay)/status，未建议 jam，未触发拒绝路径 | — |
| 27 | **NOT RUN** | “建议→确认→提交被 core 拒绝（如 E_COOLDOWN）”的真写照 | — | 本轮 scanCD 与 confirm 时间窗未重叠；收据是 applied 还是 rejected 未验证 | — |
| 28 | **NOT RUN** | 模型推理主体来源 | — | 无法从产物证明 stdin 建议行由模型而非人类生成；无模型侧对话/推理日志 | — |
| 29 | **NOT RUN** | 退出码（报告称 “exit0”） | `grep -n "exit" bootstrap.log` | 产物无退出码记录；可证的是两者都走到优雅关闭路径（`shutdown done`、`adapter-shutdown.json` 为 `_shutdown` 分支产物） | `…\lead-signal-model-live\bootstrap.log` |

## 失败行

无 FAIL。唯一“不成立的说法”是 `REPORT-LEAD.md` 的“两个执行进程均 exit0”——产物里没有退出码证据（见 #29，最相关行：`bootstrap.log` 末行 `2026-11-16T00:18:17.781Z [boot] shutdown done (only own processes touched)`），建议改口径为“优雅关闭”。
