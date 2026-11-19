# Task C 场景2 / v2 Signal 阶段独立定向检查（冻结 `c1cc2dd`）

**本阶段结论：PASS（精确 scope，当前状态，不等后续 parity/混 WIP）。** 单一设备/房间/ACTIVE门控、jam到期恢复、无设备旧车道、独立actor能量/CD真实量、范围/LOS/不足/重复/paused不regen、长按R单次toggle、暂停/输入表单不触发、AI/External按Signal键安全接管、HUD以Tick为单位、五视口HUD/设备sprite/目标线渲染，全部独立复现通过。

**诚实边界（阶段状态，非缺陷掩盖）：** 官方 world MCP 面板在 `c1cc2dd` 尚未暴露 v2 真 scan/jam 工具（仅 headless `--dev` 的 `world_headless_dev_signal_command/device/batch` 与只读 `world_signal_status`）；v1 `world_action` 传 `scan`/`jam` 按 v1 schema 明确报 MCP 错误（isError=true），不静默重解释为 v2。Signal 扫描/干扰的真实收费与阻断已在核心 + headless Dev 工具上验证。

## 冻结

- 目标：`c1cc2dd8714ff953e75be70dc3d68349506d50d9`（父 `57af6f5de0e4e9119cffa26295b4873b0812706b`；链 `3fb8af9 → 1b0dca0 → 57af6f5 → c1cc2dd`，HEAD 于冻结时同值）
- `git archive c1cc2dd | tar -x` → `D:/Project/AI-NATIVE-02-snapshots/c1cc2dd`；2034 文件，全量 sha256（`00-all-files.sha256`）；二次解包 `diff -rq` 零差异（`00-archive-diff.log`）
- 未改源/测/配置/分支，未 merge，未读 WIP/stash。独立端口 dev 5392；本单不涉及 Owner/pairing 凭据（Signal 键为玩家自有），产物 secret 扫描零命中。

## 门禁逐行（完整 `gate-summary.log`）

| 结论 | 门 | 命令 / 结果 |
|---|---|---|
| PASS | 冻结 | `git archive c1cc2dd` + 全量 hash + 二次 diff=0 |
| PASS | typecheck | `npx tsc --noEmit` → 0 |
| PASS | unit | `npx vitest run` → 57 files / 674 tests；673 pass，1 个已知 flake（heartbeat 200-vs-409，隔离重跑 3/3 pass） |
| PASS | prod build | `npx vite build` → 0 |
| PASS | MCP build | `npx vite build --config vite.mcp.config.ts` → 0 |
| PASS | signal 核心纯规则 | `probe-signal-core.mts` → **14/14 PASS** |
| PASS | signal 真实 UI | `probe-signal-ui.mts` → **21/21 PASS** |
| PASS | MCP signal 面板 | `probe-mcp-surface.mts` → **13/13 PASS** |
| PASS | secret 扫描 | 产物中 Bearer/ownerCap/ownerKey/TOKEN 模式零命中 |

## 核心纯规则（14/14，`10-signal-core.json`）

`createSignalDevice` / `commitSignalScan` / `commitSignalJam` / `tickSignalDevice` / `signalExitOpen` 直接调用：

- S01 共享调真实值：SCAN_COST 10 / SCAN_CD 120t / JAM_COST 25 / JAM_CD 480t / JAM_DURATION 360t / ENERGY_MAX 100 / REGEN 12t。
- S02 一台设备 / 一间房间（roomId 7），初始 INACTIVE，exitOpen=false。
- S03 Owner toggle → ACTIVE（exitOpen=true）；power off → INACTIVE（exitClosed）。
- S04 玩家 scan 独占玩家账户：-10 能量 + 120t CD，echo 能量不变（100）。
- S05 echo jam 独占 echo 账户：-25 能量 + 480t CD，relay 进入 JAMMED，玩家能量不变。
- S06 超出范围 / 无视线 → `E_PERMISSION`，不扣能量。
- S07 CD 内重复 scan → `E_COOLDOWN`，不重复扣费。
- S08 能量不足（5）→ `E_ENERGY_INSUFFICIENT`，不扣费。
- S09 暂停 tick 不 re-gen 能量、不 decay CD。
- S10 非暂停 12 tick 恰好 +1 能量（5 tick/秒）。
- S11 jam 抑制发射直到精确过期 tick（360t），到期 manual+power 重算为 ACTIVE，exitOpen 恢复。
- S12 手动 toggle 不能覆盖 JAM（JAM 优先）。
- S13 无设备旧 run：`signalExitOpen(undefined)=true`，旧车道完全不变。
- S14 证据 actor-local，reveal TTL 后过期。

## 真实 UI（21/21，`01-signal-ui.json`，全新 browser context，无 global config，官方游戏循环，无手工 push/step）

M02 真实 NEW RUN → GameScene，首次房间进入产生 **唯一** relay 设备（deviceId `relay_main`，room 0，INACTIVE，exit closed）。

- **M04/M05 长按 R 1s → 单次 toggle**（INACTIVE↔ACTIVE）；释放后再按 → 第二次单次 toggle。Root 源 `isDown` 疑点已由 `signalKeyCooldown`（松开后清零）消除：不因长按连续触发。
- **M06/M07 直接核心调用 playerSignalScan**：首次玩家 -10 能量 + CD120t；第二次被 CD 阻断，**不重复扣费**（energy 持续 ~90）。
- **M08/M09 playerSignalJam**：首次 -25 能量、relay 进入 JAMMED；第二次被 jam 剩余时长阻断，**不重复扣费**。
- **M10 jam 到期恢复**：手动 toggle 置 ACTIVE 后，jam 360t（≈6s 实时）→ 精确过期 tick 恢复 ACTIVE，exitOpen=true。
- **M11 HUD 时间单位**：`txtSignal` 显示 `echoScanCD:0t/jamCD:0t`（**tick 单位 `t`**，非秒），与实时 tick 对应。
- **M12 暂停**：Q 按压不改变能量/CD（paused 不触发）。
- **M13 输入表单/覆盖层**：打开后不发 -10 扫描（任何能量变动为 re-gen，非扫描）。
- **M14/M15 AI/External 接管**：`toggleAiControl()` 后 owner=`ai`，Q 按压不触发信号（energy 不变）；M16 切回 human 恢复。
- **M17 无页面/控制台错误**。
- **五视口（800×600 / 1024×768 / 1280×720 / 1366×768 / 1920×1080）**：HUD 完整渲染并显示 `RELAY ACTIVE | … EXIT OPEN`；截图 `evidence/sig-vp-*.png`。

**观察（不掩盖，非门禁失败）：** `World.signalView()` 的 `scanCooldown`/`jamCooldown` 读取的是 **echo** 的 CD（源第 279-280 行），HUD 上玩家扫描的 CD 显示为 echo 的 CD；玩家 CD 在核心中独立正确。建议后续统一 HUD 显示所属 actor 的 CD。

## MCP 信号面板（13/13，`02-mcp-surface.json`）

- 官方 headless MCP（`worldHeadlessMcpServer.mjs`，player 面板）：`world_signal_status` 存在，**无** `world_signal_scan/jam` 通用工具。
- headless `--dev`：仅 `world_headless_dev_signal_command/device/batch`（DEV 专属）+` world_signal_status`。
- 无设备时 `world_signal_status` → `E_NOT_APPLICABLE world.signal_combat_unsupported`（真实，不谎称 supported）；有设备后 `supported:true`。
- 官方 `world_action`（v1 schema）传 `{type:'scan'}` → MCP 层 `isError=true`（明确拒绝，无静默 v2 重解读）。
- Companion 官方面板恰好 `echo_observe/echo_suggest/echo_status/echo_memory`，**无 confirm 工具**；actor 不能自改 Player（信号命令由玩家通过 World 方法发起）。

## 可发布判断

**PASS（精确 scope = Task C 场景2 / v2 Signal 阶段当前状态）。** 未验证真实 LLM（Lead 本轮已独立做两轮建议击杀，见 `reports/ai-native-02/lead-echo-model-live/`，Reviewer 审中，本任务不重放策略冒充 LLM）；不外推 P3/P4；不重复历史全量；不等后续 parity。

## 路径

`reports/ai-native-02/tester/signal-scene2-final/`
`gate-summary.log` / `00-freeze.log` / `00-all-files.sha256` / `00-archive-diff.log` / `01-signal-ui.log` / `01-signal-ui.json` / `02-mcp-surface.log` / `02-mcp-surface.json` / `02-typecheck.log` / `02-unit.log` / `02-flake-rerun-1/2/3.log` / `03-build.log` / `04-mcp-build.log` / `10-signal-core.log` / `10-signal-core.json` / `evidence/sig-vp-*.png` / `probe-*.mts`

---

## Patch-notes 补充（口径更正，独立探针 probe-patch-notes.mts）

**口径更正（按 Lead 指示）：** 原报告中「AI/External按Signal键安全接管」表述过强。独立复测确认：
- **PN04**：`owner=ai` 时，Q 按压不触发信号（energy 100→100），即 **AI/External 对 Signal 键是“忽略/只读”，不接管、不发射**。
- **PN05**：`owner→human` 恢复后，Q 再次触发信号（energy 100→97，扫描扣费 + 再生），证明 owner↔human 是**真实可逆的切换**，而非单向“接管”。应更正为：“AI/External 按 Signal 键被忽略（只读），恢复 human 后信号权限重新生效”。
- **PN03**：普通 NEW RUN 自动装载唯一 relay 设备（deviceId `relay_main`，首次房间进入即生成），**非显式 opt-in**；武器仅 `pulse` 一把（weapon count=1）。
- **PN06/PN07（代码级双绑定观察）**：`keydown-Q/E` 同时绑定 `switchWeapon(-1/1)` 与 `update` 期 `Q.isDown/E.isDown`→`playerSignalScan/Jam`。普通运行仅 1 把武器，`switchWeapon` 提前返回（无实际换枪），信号正常消耗；**若给第二把武器（如已解锁 scatter），Q/E 会“一按同时换枪+耗 Signal/Jam”**，为真实的代码级交互，建议后续在 Owner fixture 下完整覆盖。

**独立结论（c1cc2dd 当前状态）：** AI/External 不接管 Signal 发射权（只读忽略）；owner→human 可逆且恢复后信号重新生效；普通 NEW RUN 自动装 relay 且仅 1 把武器（无 Q/E 换枪冲突）；与 2 把武器时的 Q/E 双触发为代码级已验证交互，非普通运行表现。以上不改变原报告 PASS 结论。
