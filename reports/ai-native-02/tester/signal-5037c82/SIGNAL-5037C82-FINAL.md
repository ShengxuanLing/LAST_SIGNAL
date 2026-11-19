# Task C 新 5037c82 Signal 输入 / opt-in / v2 阶段独立定向检查

**结论：PASS（精确 scope，当前阶段状态）。** 默认 NEW RUN 无设备 → Pause 设置显式启 Signal → 当前房间唯一设备/场景入口 → 关闭后旧 run 门控恢复；双武器 fixture 后 Q/E 只换枪、T/Y 独立耗 player energy、R hold 1s 只 toggle 一次/放再按第二次；Pause/表单输入/恢复持键不触发；AI/External 物理 Signal 键真正 human reclaim；HUD 两账户/CD 单位五视口看图；官方 v2 SDK scan/jam 真实 post-commit 扣费/证据、actor=echo 冒用 Player 被拒、v1 新动作不静默重解；范围/LOS/不足/CD/重复/paused 不 regen，普通存档/协作 flag 恢复边界。全部独立复现通过。

**范围边界：** 当前阶段不等后续合作/parity；不把单测源码字符串门禁当 UI 行为；未做真实 LLM 建议。

## 冻结

- 目标：`5037c8245a5b175b248584f03523352b9318e141`（父 `c1cc2dd8714ff953e75be70dc3d68349506d50d9`）
- HEAD 于冻结时同目标值；工作区 WIP 未读取、未使用
- `git archive 5037c82 | tar -x` → `D:/Project/AI-NATIVE-02-snapshots/5037c82`；2035 文件，全量 sha256（`00-all-files.sha256`）；二次解包 `diff -rq` 零差异（`00-archive-diff.log`）
- 未改源/测/配置/分支，未 merge，未读 stash。独立端口 dev 5392；本单不涉及 Owner/pairing 凭据（Signal 键为玩家自有），产物 secret 扫描零命中。

## 门禁逐行（完整 `gate-summary.log`）

| 结论 | 门 | 命令 / 结果 |
|---|---|---|
| PASS | 冻结 | `git archive 5037c82` + 全量 hash + 二次 diff=0 |
| PASS | typecheck | `npx tsc --noEmit` → 0 |
| PASS | unit | `npx vitest run` → 58 files / 695 tests |
| PASS | prod build | `npx vite build` → 0 |
| PASS | MCP build | `npx vite build --config vite.mcp.config.ts` → 0 |
| PASS | signal 核心纯规则 | `probe-signal-core.mts` → **17/17 PASS** |
| PASS | signal 真实 UI | `probe-signal-ui.mts` → **21/21 PASS** |
| PASS | MCP v2 信号面板 | `probe-mcp-v2.mts` → **13/13 PASS** |
| PASS | secret 扫描 | 产物中 Bearer/ownerCap/ownerKey/TOKEN 模式零命中 |

## 核心纯规则（17/17，`10-signal-core.json`）

直接调用 `createSignalDevice` / `commitSignalScan` / `commitSignalJam` / `commitToggleRelay` / `tickSignalDevice` / `signalExitOpen` / `validSignalDevice`：

- S01 共享调真实值：SCAN_COST 10 / SCAN_CD 120t / JAM_COST 25 / JAM_CD 480t / JAM_DURATION 360t / ENERGY_MAX 100 / REGEN 12t / EVIDENCE_TTL 300t。
- S02 无设备 => legacy，`signalExitOpen(undefined)=true`，旧 run 门控不变。
- S03 一台设备 / 一间房间（roomId 7），初始 INACTIVE，exit closed。
- S04 toggle-relay → ACTIVE（exit open）；再 toggle off → INACTIVE（exit closed）。
- S05 玩家 scan：独占玩家账户 -10 能量 + CD 120t，echo 能量不变。
- S06 echo scan：独占 echo 账户 -10 能量 + CD 120t，玩家能量不变。
- S07 echo actor 不能耗 player 账户（actor 严格映射对应账户，无冒用）。
- S08 超出范围 / 无视线 → `E_PERMISSION`，不扣能量。
- S09 CD 内重复 scan → `E_COOLDOWN`，不重复扣费。
- S10 能量不足 → `E_ENERGY_INSUFFICIENT`，不扣能量。
- S11 paused tick 不 regen 能量、不 decay CD。
- S12 非暂停 12 tick 恰好 +1 能量（5 tick/秒）。
- S13 JAM 抑制发射直到精确过期 tick（360t），到期 manual+power 重算为 ACTIVE。
- S14 toggle-relay 不能覆盖 JAM（JAM 优先）。
- S15 无效/空 actor → `E_PERMISSION`（v1 风格无 actor 被拒）。
- S16 `validSignalDevice` 严格拒绝空/null。
- S17 无设备旧 run 门控恢复（`signalExitOpen(undefined)=true`）。

## 真实 UI（21/21，`01-signal-ui.json`，全新 browser context，无 global config，官方游戏循环，无手工 push/step）

**A) 默认 NEW RUN 无设备 → Pause 设置显式启 Signal**
- A01 默认 NEW RUN → GameScene，`signalView()=null`（无 relay 设备，legacy）。
- A02 HUD 显示 `RELAY OFF · NO DEVICE`。
- A03 Pause → Settings → 点击 `SIGNAL COLLABORATION` → `world.signalCollaborationOptIn === true`（显式 opt-in，已持久化）。

**B) 双武器 fixture，Q/E 只换枪，T/Y 独立耗 player energy**
- B01 预设 save（`unlockedWeapons:['pulse','scatter']` + `signalCollaborationOptIn:true`）→ NEW RUN 自动产生唯一 relay 设备（`deviceId='relay_main'`，首次房间入口），**非显式 opt-in 差异**：默认无设备，启后自动装。
- B02 武器仅 pulse+scatter（2 把）。
- B03 Q 只换枪（pulse→scatter），不耗 signal 能量。
- B04 E 只换枪回（scatter→pulse）。
- B05 T scan：player 能量 -10 + CD 120t（HUD `playerScanCD:107t`）。
- B06 Y jam：player 能量 -25 + CD 480t，relay 进入 JAMMED（玩家在设备坐标 (8,45)，jam 范围 6t 冻；echo 能量不变）。

**C) R 按键语义**
- C01 R hold 1s → 只 toggle 一次（INACTIVE→ACTIVE），边缘触发（JustDown + cooldown 直至释放），不因长按重复。
- C02 释放 R 再按 → 第二次 toggle（ACTIVE→INACTIVE）。

**D) Pause / 表单输入 / 恢复持键不触发**
- D01 暂停中按 T 持键 → 能量不变（暂停不扫描）。
- D02 通过 RESUME 按钮恢复后，scene unpaused 且 scan 能再次发射（energy -10，cd 设置）；cooldown 阻断立即重复（核心 S10 已验证重复被拒）。

**E) AI/External 物理 Signal 键 → 真正 human reclaim**
- E01 `control.enableAi(0)` → owner=`ai`（未暂停）。
- E02 owner=ai 时按 T 物理键 → `takeoverFromHumanInput()` 把 owner 改回 `human` 并发射扫描（energy -10）。**AI/External 对 Signal 键不是“接管”，而是 human reclaim 后才发射；owner 非 human 时按键不直接发射。**

**F) HUD 两账户/CD 单位；五视口**
- F01 五视口（800×600 / 1024×768 / 1280×720 / 1366×768 / 1920×1080）HUD 均完整渲染，显示 `RELAY ... | e:100 p:90 echoScanCD:0t/jamCD:0t playerScanCD:106t/jamCD:0t · EXIT CLOSED`：玩家/echo 独立账户、CD 均以 tick 单位 `t` 显示；截图 `evidence/sig-vp-*.png`。

## MCP v2 官方信号面板（13/13，`02-mcp-v2.json`）

- 官方 headless MCP（`worldHeadlessMcpServer.mjs --dev`）：`world_signal_status` 存在，**无** `world_signal_scan/jam` 通用工具；仅 `--dev` 的 `world_headless_dev_signal_command/device/batch`。
- 无设备时 `world_signal_status` → `E_NOT_APPLICABLE world.signal_combat_unsupported`（真实，不谎称 supported）；有设备后 `supported:true`。
- 官方 `world_headless_dev_signal_command` scan（actor=player）：post-commit 真扣费（player 100→90）+ evidence（evidence 1），**echo 能量不变（100）**，证明 echo 未冒用 player 账户。
- 重复 scan：能量保持 90（未重复扣费），被 CD 阻断。
- jam（actor=player）：player 90→65，relay 进入 JAMMED，echo 能量不变（100），进一步证明 player 指令用 player 账户，echo 未冒用。
- v1 风格 `world_action {type:'scan'}`（无 actor）：schema 要求 actor，被明确拒绝（`isError=true`），**不静默重解为 v2**。
- v1 风格 `world_action {type:'fire'}`：仍正常受理（v1 语义未变）。

## 可发布判断

**PASS（精确 scope = Task C 新 5037c82 Signal 输入/opt-in/v2 阶段当前状态）。** 未验证真实 LLM 建议；不外推合作/parity；不重复历史全量；不把单测源码字符串门禁当 UI 行为（所有 UI 行为均在真实浏览器 + 官方游戏循环中独立复现）。

## 路径

`reports/ai-native-02/tester/signal-5037c82/`
`gate-summary.log` / `00-freeze.log` / `00-all-files.sha256` / `00-archive-diff.log` / `01-signal-ui.log` / `01-signal-ui.json` / `02-mcp-v2.log` / `02-mcp-v2.json` / `02-typecheck.log` / `02-unit.log` / `03-build.log` / `04-mcp-build.log` / `10-signal-core.log` / `10-signal-core.json` / `evidence/sig-vp-*.png` / `probe-*.mts`
