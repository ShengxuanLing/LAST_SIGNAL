# GDD-03 终态独立窄复核报告（Station Zero · The Broken Door）

> **性质**：终态独立窄复核（supersedes 旧初审/上轮快照）。**仅编制复核报告，未修改游戏源码/其他规格；本轮未运行玩法验收、构建或测试**。提案不因交付升为批准，设计不以实测结论冒充实测；全部新增细则沿用 GDD-02 未批准标记（`建议冻结`/`原型调参初值`）。**本复核不预设通过、不授予批准**；结论见 §8。

---

## 1. 本次复核实际读取的哈希与状态

- **HEAD** `0001c6baa95f2019ff097aa206fb287e46925756`，分支 `main`，`[ahead 1]`（vs `origin/main` `48cd36fc…`）。
- **文档变更（外部 `check_docs_final_content.log` 全 tracked baseline 哈希范围）**：`check_docs.py` 本轮 **PASS / 0**；`BASELINE 83`，`AUTHORIZED_CHANGED = [DESIGN_DECISION_REGISTER, GAME_DESIGN_BIBLE_ALIGNMENT, README]`（3 个既有文档变化已授权），其余 baseline 未变；**7 new 共 10 授权 docs**（6 主体 + 本 REVIEW + 3 Lead 文档）。该 baseline 校验集覆盖文档，**不含游戏源码**；源码零改动由任务边界 + `git status` 仅显示 10 个文档变更（无 `src/` 文件）共同确认。
- **六主体 sha256（本次读取）**：
  - `VERTICAL_SLICE_LEVEL_DESIGN.md`  `db5809fc7e06379e`  149L
  - `VERTICAL_SLICE_IMPLEMENTATION_PLAN.md` `a05c0a4577407b4f`  143L
  - `VERTICAL_SLICE_EXPERIENCE_FLOW.md` `7d5de454f2620f5f`  132L  ← 本轮 R7 修后
  - `VERTICAL_SLICE_UI_SPEC.md`  `45a21b8535f54b31`  107L
  - `ECHO_VERTICAL_SLICE_SCRIPT.md` `c3055d1a61eba4d5`  80L
  - `GDD_03_TEST_SPEC.md`  `b12fa1b9d92c21ad`  351L
- **GDD-02 基线（未变，参考）**：`REALITY_ENGINEERING_RULES.md` `617d5554…`、`VERTICAL_SLICE_CAUSAL_CHAINS.md` `e2015208…`、`GDD_02_TEST_SPEC.md` `d62d5ce3…`、`GDD_02_REVIEW_REPORT.md` `959c4733…`。
- **源码事实范围（本次读取，未变）**：`Player.ts` `d24d5c96…`、`Enemy.ts` `46de6c1f…`、`Boss.ts` `9f73cf8f…`、`World.ts` `cebddc34…`、`SaveSystem.ts` `128c6804…`、`types/index.ts` `781d29b8…`、`config/game.ts` `a3683122…`。
- **Lead 独立几何检查（外部，仅设计 mask/算术）**：`lead_geometry_check.log` 结论 `PASS`：R1 封门不连通/开门连通、R2 单 Jam 距离 5<6、6×3 桥 radius-.5 路径、5.596804s 预算、R3 静态路径；并明示「input/AI 未模拟、moving Boss combat 未模拟、仅设计检查、不声称 gameplay 通过」。

---

## 2. 门禁（单行 command|结果|exit|外部日志）

```
state      | pass | 0 | finaln_00_state.log        — HEAD/ahead/10 文档变更/src 零改/hashes
gdb/src    | pass | 0 | finaln_02_gdb_src.log       — 7 源码哈希/GDB 约束
crossdoc   | pass | 0 | finaln_03_crossdoc.log      — 六主体无旧稿回填/错节
close      | pass | 0 | finalr_00_close.log         — FLOW §5 窄读 + check_docs PASS/0
checks     | pass | 0 | check_docs_final_content.log — baseline 83 / 3 授权变更 / 7 new 共 10 / ERRORS 0
```

---

## 3. 上轮 6 项阻断修订 — 逐条闭合确认

| # | 旧问题 | 本轮文档状态 | 闭合判定 |
|---|---|---|---|
| R1 | LEVEL 仍复用自动 `placePortal`（旁路密封门/桥）+ 过房 `reset` 满血 | LEVEL §2/§8、PLAN M1/M4、TEST L-06/F-10/E-07 一致写明「过房由切片专用状态门控触发，**不复用 `World.placePortal`**、保 HP/位置、**不 reset 满血**」；M4 指定新建 `SliceTransition.ts` 实现门态/桥态/胜利位+玩家位置门控 | **CLOSED** |
| R2 | R1 对照侧室无隔墙 → 可绕密封门 | LEVEL §4 现完整封闭 mask：`x=10` 竖墙 `y1..12` + `y=5` 横墙 `x11..21`；REF 门孔 `(10,2)(10,3)`→北死路 `x11..21,y1..4`；SEAL 门孔 `(10,9)(10,10)`→南廊 `x11..21,y6..12`；两门孔 2 格全占 | **CLOSED**（TEST L-02 同口径） |
| R3 | LEVEL 仍双敌 + 9×12 桥，与 TEST 单 guard/6×3 矛盾 | LEVEL §5 现 26×14、**单 guard `(5.5,6.5)`**、桥 `x10..15,y8..10`（6×3）、单次 Jam 25、设计期上界 5.597s；PLAN 增 SL-11/SL-12、工期 20–31；TEST L-04/L-06/F-12 同口径 | **CLOSED** |
| R4 | 整数/格中心混用 | LEVEL §1 明确「地形 mask 用整数 cell `(i,j)`；实体/设备用 position `(i+0.5,j+0.5)`」；§3–§7 坐标统一；TEST §9.1「同一比较只用一种坐标类」 | **CLOSED** |
| R5 | R3 用 `Boss→relay` 证玩家 Scan（错原点） | LEVEL §6 现「玩家 Jam/Scan 阵地 `(20.5,7.5)` → relay `(20.5,4.5)` 距离 `3.0<12`、LOS 通，**Scan 由玩家发出**」；TEST L-07 同 | **CLOSED** |
| R6 | 路线 B 仅按敌人初始定点证明，未按移动敌人验证 | LEVEL §5/§6 现给出**具体有界路径**（R3 路径到 Boss 最小距 `7.0>3`、阵地→Boss `7.28>attackRange 3.125`；R2 运行期验收「单 Jam 生效起 ≤6s 到 `SAFE_E`」），并明示依赖 PLAN M5 新感知 FSM、运行期 E2E 实测；TEST L-05 把 Decoy 降为「单测 fixture、非必经路线」 | **CLOSED（作为文档缺陷）；移动敌验证属运行风险，见 §7** |

---

## 4. 本轮 R7 闭合（supersedes 上轮「R7 仍残余」）

- **R7 — FLOW §5 双敌表述不一致**：本轮窄读 `VERTICAL_SLICE_EXPERIENCE_FLOW.md` §5（sha `7d5de454`）已改为「**一个守卫（drone）**观察入口」；路线 A「先战斗清除守卫」、路线 B「对该守卫感知接收器施放**一次 Jam**，开启 relay、等待桥建立并跨越，在守卫存活时到达东岸」；「Decoy 只作可选信息实验，不保证能转移看得见玩家的守卫，也不构成另一条已经证明的过桥路线」；「恢复桥与恢复共享信息必须同 tick 发生；**个人 Jam 不会被 relay 恢复覆盖**」。与 LEVEL §5 / PLAN M2 / TEST L-04·F-12 的单 guard / 单次 Jam / Decoy 可选口径完全一致。
- 判定：**R7 = CLOSED**。六主体之间（坐标类、门控触发、checkpoint 语义、ECHO 权限、结尾读回、ADR 引用）经 §5 核查一致，TEST §9 已用 LEVEL 终版坐标回填，无旧稿占位/错节。

---

## 5. 跨文档关键规则相容性确认

- **坐标类一致**：cell（mask）/position（实体）双约定在 LEVEL §1、TEST §9.1、PLAN §2 统一；距离严格 `<` 半径、LOS supercover、`isWalkable(0.5)` 判据引用同一源码（`World.ts:136,145,674`、`Enemy.ts:145`）。
- **过房门控一致**：R0→R1（门开+到门位）、R1→R2（`passedSealThisVisit` 后到南廊出口 `(20.5,9.5)` 才转，不要求出口时仍 `JAMMED_OPEN`）、R2→R3（桥 `STABLE`+到 `SAFE_E(16.5,9.5)`）、R3→R4（`boss._hp≤0 && alive`）四段在 LEVEL §2/§4/§5/§6、PLAN M4、TEST F-02/F-07/F-10/F-13/E-07 完全一致；均「不借 `placePortal`、不 reset 满血」。
- **checkpoint / 死亡语义一致**：LEVEL §8 与源码 `captureCheckpoint`（`World.ts:674-688`，要求 cleared/alive/`!won`/`!boss`/无活敌/无未清 spawned 房）一致；路线 B 留活 guard 无 R2 checkpoint、最近安全为 R1 出口；死亡 `finishRun(false)` 清 run 新 R0、仅退出/刷新恢复最近成功 checkpoint；TEST M-05/M-10/S-02 同口径。
- **ECHO 权限一致**：ECHO §1「事件须同房间本地接收范围+LOS，或已发生授权 Scan/玩家动作回执；白名单字段；未扫描护盾源/未来阶段/全图/RNG/内部存档/身份不可作触发」与 RER §10、UI §3、TEST F-15/M-06 相容；H3/H4 仅显式请求（FLOW §8 / ECHO §4），无自动全知提示。
- **结尾保存读回一致**：UI §8 状态机 + 「写失败先读回同局提交结果，存在→COMMITTED、明确未提交才改选、读回失败只重试」与 TEST S-02/M-09/F-16/E-06 一致；`ECHO_SAVE_FAILED` 只说「未确认保存结果」，不伪报；`NONE|POWER|MEMORY` 单枚举、下局可替换、不覆盖原档/不升 `SAVE_VERSION`。
- **GDB 约束对齐**：GDB 支持「信号维持门锁/干扰敌人感知/恢复桥梁/解除远程协议门锁」（`GAME_DESIGN_BIBLE.md` §138/§549/§619/§640/§695-697），与四目标模型（门/中继器/桥/敌人链）一致；无第五类可操纵目标；固定模板复用 `World` 不与 GDB 冲突。

---

## 6. 设计 vs 实际未执行（关键区分，复核基准）

| 能力 / 规则 | 文档设计 | 源码实际（探针） | 判定 |
|---|---|---|---|
| 玩家移动 | 各向异性 `sx/32,sy/16`，3.4375 仅下界 | `Player.ts:165-179` 证实 | 设计=实际 |
| R1 九步门链 | LEVEL §4 完整 | 门/SEAL 状态机未实现 | 设计；未执行 |
| R2 桥/中继/双解 | LEVEL §5 + TEST L-05/06 | `World.placePortal` 无条件生成；无 bridge/relay 状态机 | 设计；未执行 |
| 敌人感知（Jam 抑制/诱饵/LOS） | RER §9 + LEVEL §5 路线 B | `Enemy.detects` = 纯距离（`Enemy.ts:145`），无 LOS/诱饵/Jam | **设计未执行**，路线 B 依赖 PLAN M5 落地的感知 FSM |
| Boss 三阶段/正伤害 | LEVEL §6 + TEST M-07 | `Boss.hit` `max(2,…)` 已落地；护盾 0.5/1.0 倍率**未实现**（GDD-02 提案）；`summonDrones` `Math.random()` | 部分执行；护盾/确定性未执行 |
| 双结尾 `NONE\|POWER\|MEMORY` | LEVEL §7/UI §8/ECHO §5/TEST S-01..05 | 无 `commitChoice`/无 `choice` 字段/`SAVE_KEY='last_signal_save_v1'`/无独立键/无枚举 | **完全未执行** |
| 存档/检查点/死亡 R0 | LEVEL §8 与源码一致 | `captureCheckpoint`/`finishRun` 现状 | 设计=实际 |
| 20–30min 预算 | 全文档标「待试玩验证」 | 无 playtest | 设计期预算，非结果 |

---

## 7. 仍待产品签核（不阻断设计交付）+ 后续运行风险

- **待产品签核（候选，非阻断）**：GDD-02 §6 原型初值与 GDD-03 新增布局/台词/选择/时长 `Prototype Tuning Values` 最终冻结；手动交互细节（两岸免费开关/自供电/Boss 节点手动限制）与 R1 门前等待区；切片独立存储 `last_signal_station_zero_save_v2` 与 ADR-06 迁移/回滚/是否升 `SAVE_VERSION`；`POWER/MEMORY/NONE` 语义与 R0 下局差异表现；`R1_SOURCE_TEST` 是否采纳；D9 试玩样本量/seed/CI 归属；H0–H4 文案终稿。以上均为既有「仅原则认可/候选」项，不阻断本轮设计交付。
- **后续运行风险（实现期须验证，非文档缺陷）**：
  1. **路线 B 移动敌验证**：静态 mask/算术已 PASS，但 guard 巡逻/追逐与 Jam 抑制感知须由 PLAN M5 新 FSM 落地后，用真实移动 + 输入开销 E2E 验证「单 Jam 生效起 ≤6s 到 `SAFE_E`」；输入 overhead 已写入 TEST L-08/F-12 验收口径。
  2. **Boss 召唤确定性**：`Boss.summonDrones` 用 `Math.random()`（Boss.ts:142），PLAN §6 已将其列为「实施必须收敛」的高优先项（用户可复现要求）；若实现阶段留 `Math.random()` 会破坏同 seed 可复现与 E2E 回放。
  3. **20–30min 预算**：仅设计期预算；R2 路线 B 的 ≤6s 为运行期硬验收线，须实测；其余分段待无提示试玩。
  4. **双结尾持久化**：`commitChoice`/独立键/读回全部未实现，须 SL-09/SL-12 + ADR-06 落地后才可验「下局不偷改数值」。

---

## 8. 结论（验收语言，不预设通过）

- **文档级无剩余阻断**：上轮 6 项阻断修订全部闭合；本轮 R7（FLOW §5 双敌表述）经窄读确认已改为单 guard / 单次 Jam / Decoy 可选 / 个人 Jam 不被 relay 恢复覆盖，**R7 = CLOSED**；六主体跨文档关键规则（坐标类、过房门控、checkpoint/死亡、ECHO 权限、结尾读回、GDB 约束）相容；TEST §9 已用 LEVEL 终版坐标回填，无旧稿占位/错节；外部 `check_docs.py` PASS/0、10 授权文档、baseline 其余未变；Lead 外部几何检查独立确认设计 mask/算术 `PASS`（仅设计检查，不声称 gameplay 通过）。
- **可本地 docs-only 提交**：本次变更仅文档（6 主体 + 本 REVIEW + 3 Lead 文档），游戏源码/其他规格/构建/测试/存档零改动、零 commit/push；据此可发起本地 docs-only 提交（提交由 Lead 决定）。
- **终态窄核待办（无阻断）**：(a) 实现期按 §7 运行风险逐条 E2E 实测；(b) 待产品签核项（§7）与 ADR-06 落地后，再进入「批准/冻结」决策。
- 未执行特征（Signal/Jam/Decoy/Relay/Bridge/Door-Seal/ECHO/双结尾/感知 FSM）均已被文档正确标为候选/ADR 待定，符合「全为候选不擅自冻结」；其可接受性以 §7 运行验证 + 产品签核为准，本文不授予任何冻结/批准。

> 复核完成。报告基于本次实际读取的哈希与 `check_docs_final_content.log` 全 tracked baseline 范围。
