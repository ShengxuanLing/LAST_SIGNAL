# 独立复核 — Lead 真实模型 Signal 最小回合（lead-signal-model-live）

- 被审对象：`D:\Project\LAST_SIGNAL\reports\ai-native-02\lead-signal-model-live\`（Lead 现场产物，2026-11-16 00:15–00:18Z）
- 冻结源码：`363eb173207bb5adaa0a21cd1af348dc92f29827`。复核开始时本机 `git rev-parse HEAD` 为该值且 `git status --porcelain -uno` = 0 行；**复核结束时（01:26）开发者已在并发修改 5 个 tracked 源文件**（`companionFacet.ts`/`companionFacet.test.ts`/`echo.ts`/`World.ts`/`sim/core.ts`，mtime 01:22:12–01:22:34），非本次复核所为，我的产出只在 `reports/ai-native-02/reviewer/lead-signal-model-live/`（untracked）。本报告所有源码引用均取自 `git archive 363eb17` 的逐 blob 校验快照，因此结论对 363eb17 成立；开发者正在修的正是本报告定界的 4 个根因（`companionFacet.ts` 差异显示 `availableActions` 已开始考虑 energy/cooldown）。
- 复核者：独立 worker `mmxu9qr3pny4jua138sycuoq`；方式：只读证据 + 冻结源码只读审计 + 实际查看截图/录像抽帧；**未回放策略、未修改任何 Lead 产物**
- 逐门一行表见 `GATES.md`；产物哈希见 `artifact-hashes.txt`；录像探针见 `video-probe.txt`；我从录像抽的帧见 `frames/`

## 结论

**最小 Signal 模型协作事实：PASS（成立，可关闭该子项）。**
可证：真实 `echo_observe` → Lead 依据观察自主给出 `scan` 建议 → 独立 Owner UI 真实点击确认 → 暂停期只入队、不早写 → 正常帧提交 `appliedTick=172`、**ECHO 账户真实扣费**（100→92，玩家 100 不动）、evidence=1 → 模型据新状态给出 `toggle-relay` → 确认后 `appliedTick=201`、`relay=ACTIVE`、`manualEnabled=true`、`exitOpen=true` → 真实 portal 从 **room 3 进入具体 room 5（elite）**。
**不可证**：真人（非自动点击）验收、Task C 整体完成、完整 Run 无缺陷、多 seed/跨平台、以及“推理主体一定是模型而非人类打字”。

## 12 项证据级核验（摘要，明细见 GATES.md）

| # | 核验 | 结论 | 关键证据 |
|---|---|---|---|
| 1 | 产物完整与哈希留存 | PASS | 12 个文本/源文件 + 14 张截图 + 1 段录像全部 sha256 落盘（`artifact-hashes.txt`）；截图仅 `13`=`14` 同哈希（见 GATES #15 说明） |
| 2 | 冻结一致性 | PASS | HEAD=363eb17，tracked 0 改动；`bootstrap.json.commit` 一致 |
| 3 | 工具回合无预置/无策略 | PASS | `bootstrap.json.modelActionsPerformed=0 / suggestionsMade=0`；`tool-io.jsonl` 只有 7 条 round（observe/suggest/observe/suggest/observe/observe/status）；adapter 源码无任何 kind/reason 常量、无循环、无自动建议 |
| 4 | 因果顺序（观察→建议→确认→提交） | PASS（见 GATES #8） | adapter 每轮工具后自动截图，`owner-ui.jsonl` 的 `_screenshot` 时间戳给出独立时序锚点：tool1 00:16:29 → tool2 00:16:36 → confirm 00:16:41 → resume 00:16:46 → tool3 00:16:57 → tool4 00:17:07 → confirm 00:17:13 → resume 00:17:18 → tool5 00:17:31 → portal 00:17:44 → tool6 00:18:00 |
| 5 | Agent 侧无 Owner 凭据 | PASS | `tool-io.jsonl` 首行 `childEnvKeys` 仅 PATH/SystemRoot/TEMP/TMP/BRIDGE_URL/TOKEN_FILE；adapter 从不读 `ownerKeyFile`（仅出现在类型声明与脱敏键名） |
| 6 | 确认走独立 UI 真实点击 | PASS | `owner-bootstrap.mts:104-127` `clickText` = `page.mouse.click(bounds.centerX,centerY)` 点真实 Phaser 文本；`:695-716` 结果 `clicked:"CONFIRM FIRST PROPOSAL (OWNER)"`；面板自述 “The agent MCP has NO confirm tool”；`companionMcpTools` 无 confirm 工具 |
| 7 | 确认只入队、不早写 | PASS | confirm#1 `stateBefore`/`stateAfter` 除 `pendingCommands: []→["signal-scan"]` 外完全一致，tick 171 不变、evidence 0；confirm#2 同理→`["toggle-relay"]` |
| 8 | 真实扫描：ECHO 扣费 + 证据 | PASS | resume#1 tick 171→200：`echoEnergy 100→92`、`playerEnergy 100` 不变、`evidence 0→1`、`echoScanCD 91`、relay 仍 INACTIVE；`signalState.ts:96-98` 证明 scan 证据唯一来源就是 relay 设备本身（`kind:'relay'`），与 3 个残敌无关 |
| 9 | 数值与冻结常量精确自洽 | PASS | 扣费 10（SCAN_COST）→90；regen 1/12tick：90→92（tick200）、92→94（tick227）、94→98（tick273，46 tick 跨 4 个 12 边界，regenAcc 余量 2）；CD 120：91(200)→64(227)→18(273)，逐 tick 精确递减，无一处不合 |
| 10 | ACTIVE / exitOpen / receipts | PASS | tick227 `relay=ACTIVE, manualEnabled=true, powered=true, exitOpen=true`；receipts `[{ab01:applied, decided171, applied172},{ab02:applied, decided200, applied201}]`，`pending=[]`；录像 t=90s 帧 HUD 实测 `RELAY ACTIVE … · EXIT OPEN`，t=60s 帧 `e:92 echoScanCD:91t … EXIT CLOSED` |
| 11 | room 3 → 具体 5 | PASS | `owner-bootstrap.mts:756-762` 显式 `if (id === -1 \|\| id === prev) return false`（拒绝过渡态冒充）；结果 `roomBefore 3 → roomAfter 5, roomKind elite`，随后的 state 与 tool-6/tool-7 均为 roomId 5、HUD `ELITE ROOM / HOSTILES 6`、录像 t=120s 帧一致 |
| 12 | 无密文外泄 / 凭据删除 / 无残留监听 | PASS | 产物内无 48/64-hex 命中；`06` 截图 token 与 ownerKey 均掩码为圆点；`shutdown.json.credentialsDeleted=true`，三个临时凭据目录（`last-signal-c3b-E7DHFB`/`owner-hZUMyr`/`c3b-ksfBl9`）已不存在；5301/5302/39914 无残留监听 |

## 现场 4 个问题的独立定界（Lead 要求：是否影响最小模型协作事实）

### A. 清敌 fixture 遗留 3 个 targets —— **不影响 Signal 事实；但“清场”只到渲染层，必须写清**
- 事实：tick 171/200/227/273 四次观察里 3 个 `hunter` 全部 `hp=59`、坐标 `(22,44)/(24.33,44)/(26.67,44)` 完全不动 —— 跨 102 tick 零变化，**inert**。
- 根因：fixture 只 `destroy()` 精灵并 `world.enemies=[]`，未清 `sim.targets`；`World.echoView()` 读的是 `this._sim.targets`（`World.ts:264`），而 legacy 敌人的行为跑在被销毁的 Enemy 对象里 → 观察“诚实地”报告了 canonical 里仍存在但永不再行动的 actor。HUD 同时显示 `HOSTILES 0`（渲染层），因此 HUD 与观察不一致是**夹具残留**，不是投影撒谎。
- 影响面：① 扫描证据**不受影响**（证据只有 relay，见 #8）；② 受影响的是 `availableActions` 的 reason（`perceived_target`/`in_jam_range` 由这 3 个残骸算出，jam 距离 0.6 格）；③ 本轮**没有**任何 fire/攻击建议，所以不存在“模型打了假敌人”的问题。
- 结论：最小 Signal 协作事实成立；但这轮**不能**称为“无敌人干扰的干净场景”，后续 runbook 应把 `sim.targets/sim.drones` 一并清空并断言。

### B. memory 把 hunter 标成 `kind='relay'` —— **产品侧真实缺陷（模型可见的不真实字段），但不影响本轮 Signal 事实**
- 根因：`companionFacet.ts:498` 对 targets 硬编码 `kind: 'relay'`（drone 用 `'drone'`，relay 用 `'relay'`，target 也写 `'relay'`，只靠 id 前缀 `target_<id>_<kind>` 区分）。
- 归属：`f16741a` 引入，**早于 363eb17**，不是本 delta 回归；更糟的是单测 `companionFacet.test.ts:79` 断言了这段错误行为（`m.kind === 'relay' && id.startsWith('target_')` 期望为 true），等于把 bug 固化成契约。
- 影响面：`echo_memory` 是模型可见工具，模型可能把 3 个 hunter 位置的记忆读成“relay”。本轮模型的两次建议都基于 `observation.relay`（真设备）与 `objectiveBlocked`，**未使用 memory**，所以不影响已发生的链。
- 结论：不影响最小事实；属**必须跟进**的模型面真实性缺陷（建议改 `kind:'target'`/`'hunter'` 派生，并改掉那条断言）。

### C. 过门后 player(115,44) 而 echo(27.16,43.68) 留在原房 —— **不是数据错误，是“echo 不随房间迁移”的既有行为；本轮相关结论需限定**
- 源码：`World` 房间切换路径没有任何 echo 迁移/传送逻辑（仅有 `echoController.reset()`），也没有 teleport。echo 在 FOLLOW 模式下会朝玩家方向移动（46 tick 内从 26,46 漂到 27.165,43.688），随后被房间边界挡住。
- 观察一致性：tick273 echo 仍在 room 3，距 relay `(25,46)` 约 3.17 格 < 12 → 报告 relay 完全合法；room 5 的 6 个敌人距 echo ~88 格 → **未被报告**（说明裁剪是真的，不是整图透传）。
- 影响面：本轮“过门成功”成立（玩家侧），但**没有**任何“ECHO 随队进入新房间/在新房间协作”的证据；tool-6 的观察是“留在原房的 echo 视角”，不应被引用为新房间协作。
- 结论：不影响已发生的 Signal 最小事实；限制必须写明，作为独立产品议题（echo 跨房迁移）跟进。

### D. `scanCD=18` 但 `availableActions.scan=true` —— **产品侧真实缺陷（提示字段口径不一致），不影响已发生的链**
- 根因：`companionFacet.ts:50-62` 的 `availableActions` 只用“最近 actor 距离”判定，**完全不看 cooldown / energy / objectiveBlocked**；且 reason 文案 `'perceived_target'` 不在 `COMPANION_REASONS` 枚举内（我上一轮已记录）。
- 影响面：`availableActions` 是建议性提示；`echo_suggest` 本身不校验 CD（`suggest` 只看 reason 是否被观察支撑），真正拦截在 core 的 `scanBlocker`（`E_COOLDOWN`）。因此本轮**没有**触发“建议→确认→提交被拒”的路径；但该路径一旦发生，是否给出 `rejected` 收据而非 `applied`，本轮**未覆盖**（见 `未关闭` 项）。
- 结论：不影响最小事实；属必须跟进的口径缺陷（提示应含 CD/能量）。

### 附：Vite “World.ts 重复 enemy-spawned case” —— 真实源码瑕疵，无功能影响
`World.applySimEvents` 同一个 switch 里有 **两个** `case 'enemy-spawned'`（`World.ts:1319` 与 `:1370`）。JS 语义下第二个不可达（`spawnEnemyFromCore` 因此是死代码）；tsc 不报错（TS 允许重复 case 标签），esbuild/Vite 会警告。本轮行为由第一个分支完成（与观察一致），无功能影响；建议删除或合并。

## 复核中发现的其他口径偏差（小事，但影响“精确引用”）

1. `tool-io.jsonl` 的每条记录**没有时间戳**（只有 `round/tool/args/ms/error/raw`），所以“模型调用早于 Owner 确认”不能只靠它证明；我用 adapter 的“每轮自动截图”在 `owner-ui.jsonl` 里留下的时间戳建立了独立时序（见 #4）。建议 adapter 给每条记录加 `at`。
2. `REPORT-LEAD.md` 写“两个执行进程均 exit0”，但 `shutdown.json`/`adapter-shutdown.json`/`bootstrap.log` 都**没有**记录退出码；能证明的是“两者都走到了优雅关闭路径”（`bootstrap.log: shutdown done`、`adapter-shutdown.json` 为 `_shutdown` 分支产物）。建议记录退出码，或把措辞改成“优雅关闭”。
3. 截图 `13-tool-6-echo_observe` 与 `14-tool-7-echo_status` **同哈希**（`be5769b78b11…`）：`echo_status` 不改变画面，HUD 在 t=120s 与 t=140s 两帧完全一致，属如实结果，但报告里应像早期 04/05 那样显式标注。
4. “Lead 逐轮模型”这点在证据上只能证明“**有人**依据真实观察逐轮给出建议，且适配器无策略”；`stdin` 行由哪个主体生成无法从产物证明（无法排除人类打字）。若要更强的“模型自主”证据，需要模型侧的原始对话/推理日志一并落盘。

## 可关闭（本轮可关闭的子项）

1. **真实模型（Lead 会话）Signal 最小协作链成立**：observe → suggest(scan, perceived_relay) → Owner UI 真实点击 → 真实 core tick 提交（applied 172）→ ECHO 独立扣费 + evidence=1 → 新观察 → suggest(toggle-relay, objective_blocked) → 确认 → applied 201 → relay ACTIVE / exitOpen true → **真实 portal 进具体 room 5**。
2. **权限边界成立**：模型侧 4 工具无 confirm；Agent 子进程环境无 Owner key/cap；确认为独立进程对真实 UI 的真实鼠标点击（非 API 直调）。
3. **提交语义成立**：确认只入队；暂停期零早写；下一正常帧恰一次提交；receipts `applied@172/201` 与 `decidedAt171/200` 真实、`pending=[]`。
4. **数值真实性成立**：能量/冷却/证据数与冻结常量精确自洽（可逐 tick 复算）。
5. **无密文外泄 & 清理**：产物无 token/ownerKey 明文，临时凭据已删除，无残留监听。

## 未关闭（不得据此关闭的范围）

1. **真人验收**：Owner 确认为自动化点击；本轮不构成人类确认验收。
2. **Task C 整体**：未覆盖 jam、未覆盖“建议被拒/过期/重复决策”在真实链中的表现、未覆盖多 seed/跨端复跑。
3. **模型自主性的强证据**：建议由 Lead 会话逐轮写入；无法从产物证明推理主体，也无模型侧对话日志。
4. **“建议→确认→提交被 core 拒绝”的真写照**：如 scan 在冷却中（本轮 `availableActions` 误报就来自这种口径），提交层会 `E_COOLDOWN`，此时收据是 `rejected` 还是 `applied`，本轮未验证。
5. **ECHO 跨房迁移**：本轮明确没有证明（echo 留在原房）。
6. **场景干净度**：残敌 fixture 只清到渲染层；不能把本轮称为无干扰场景。
7. **两个必须跟进的源码缺陷**：memory `kind` 误标（并被单测固化）、`availableActions` 忽略 CD/能量；以及重复 `case 'enemy-spawned'` 死分支。
