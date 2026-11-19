# Lead 真实逐轮 MCP 小遭遇 证据独立复核

- **复核对象**：`D:/Project/LAST_SIGNAL/reports/ai-native-02/lead-live-drone/`（REPORT.md、tool-io.jsonl、round-1..6.png、video/*.webm、bootstrap.json、bootstrap-and-mcp-adapter.mts）
- **冻结源码**：`8b9705d6bce1894b08717c0180e127f26de8e2f5`；快照源 `D:/Project/AI-NATIVE-02-snapshots/8b9705d/lead-live.mts`
- **复核方式**：只读证据与冻结源码；未修改任何产物/源码/测试/分支；未回放预写序列；仅计算哈希、解析 JSONL、抽帧、看截图/录像、比对夹具。
- **证据哈希**：见 `verification.log`（11 个文件 sha256 已记录；归档 adapter 与冻结 `lead-live.mts` **字节一致**）。

## 一、结论（先给判定）

- **可以关闭 P2 的“真实 Agent 最小合法遭遇”子项**（**限定条件**）：一次真实模型经官方 Player MCP，在 Rendered 正式 World 上完成“observe → fire → observe 确认击杀 → move → observe → close”的最小合法遭遇；动作 target 来自首轮观察，击杀与位移由后续 observation 与真实 HUD/录像交叉印证。
- **不能**据此关闭 P2 整体，也**不能**当作“人类授权证据/完整房间/整轮 Run/稳定性/广泛自主能力”。人类授权按钮是 **Owner 自动化点击**，报告已如实声明为开发夹具，不是真人授权。
- **尚缺**：Replay/可复现轨迹、Agent 自主探索路线、Headless World、ECHO 双 Actor、Signal、完整 Run 验收、真实人类授权证据、多次稳定性。

## 二、逐项核验

### 1. 原始参数/返回与报告一致 —— PASS
`tool-io.jsonl` 共 6 轮，单一 session `ses_aca0fa32870ce667753a436e`：

| 轮 | 工具 | 关键内容 |
|---|---|---|
| 1 | `world_observe` | tick=27 room=0 player=(8,45) HP=100；drone #1 (5.092624,41.120814) HP=24 state=chase |
| 2 | `world_action` | fire target=(5.1,41.2) ticks=120, req/action `…001`；acceptedTick=345 applyByTick=945；返回 **queued** |
| 3 | `world_observe` | tick=668 HP=76；drones=[]；projectiles=[] |
| 4 | `world_action` | move dir=(1,0) ticks=30, `…002`；acceptedTick=2040 applyByTick=2640；返回 **queued** |
| 5 | `world_observe` | tick=2652 player=(10.618351,44.481549) HP=76；无敌人/弹丸 |
| 6 | `world_close` | closed=true |

与 `REPORT.md` 完全一致；fire target 正是首轮 drone 坐标四舍五入（5.0926→5.1, 41.1208→41.2），说明动作由观察导出，非预写坐标。

### 2. 真实效果交叉验证（queued 不作为命中证据）—— PASS
- 报告已声明“raw queued receipt 本身不作为命中证据”；本复核用后续 observation + 真实 HUD + 录像交叉：
  - `round-3.png` HUD：**HP76/100、XP 8/30、KILLS 1、DMG 30、HOSTILES 0、CREDITS 4、LOOT 1、CONTROL EXTERNAL、AT ACTION/LAST `aid_…001 0472`**；与 round 3 observation（HP76、drones=[]）一致。
  - `round-5.png` HUD：**AT ACTION/LAST `aid_…002 02078`**，玩家屏幕位置较 round 3 明显移动；与 round 5 observation 位移一致。
  - `round-1.png`：HP100、HOSTILES 1、KILLS0/DMG0、EXTERNAL、AT ACTION —，与首轮 observe 一致。
  - 录像抽帧（`reviewer/lead-live/video-t22.png`）与 round-3 一致（KILLS1/DMG30/AT ACTION 0472），证明录像为真实游戏过程而非静态图。
- 结论：fire 与 move 均**实际提交并产生真实效果**；`AT ACTION/LAST` 的 tick 0472/02078 是动作已应用的渲染侧强证据，且击杀/伤害/经验/位移等模拟效果不可能由 queued 回执伪造。

### 3. 夹具边界与“无作弊” —— PASS（1 处注释不一致）
- Owner bootstrap（`bootstrap-and-mcp-adapter.mts`）：真实 NEW RUN 后在当前真实生成房间调用正常 `w.spawnEnemy('drone', …)`，**未写**玩家/敌人 HP、伤害、资源、无敌帧。冻结源码核对：`spawnEnemy` 走 `new Enemy(...).initHp()` + `buildEnemyData`，drone depth0 scale=1 → maxHp=24，与 observe 的 HP24 一致；玩家 100→76 = 4×6 真实伤害输出（drone damage 6）。
- Player 阶段：循环体只调用官方 `client.callTool`、`page.screenshot`、写日志；**无键盘/鼠标/`page.evaluate`/Scene 写入**。`page.keyboard/mouse/evaluate` 仅出现在 Player 阶段之前的 Owner bootstrap。
- 无策略代码：归档 adapter 与冻结 `lead-live.mts` **完全一致**；无目标选择/战斗策略；动作由 Lead 外部逐轮提供。
- 失败尝试隔离：`../lead-live/` 为 room1、多 hunter/sentinel、HP47、session `ses_4349…`，动作返回 `E_SESSION_NOT_FOUND / world.session_closed`；与成功 session `ses_aca0…`（room0）**不同会话、不同目录**，未混用。
- **不一致点**：adapter 注释写 “actual generated combat room”，实际是 **start room（room 0）**；`bootstrap.json` 与 REPORT 写的是 start room。建议修正注释，避免误读为战斗房。不影响“真实配置敌人/真实生成房间”的结论。

### 4. 记录材料真实性 —— PASS
- `video/*.webm`：VP9，800×450，25fps，**54.8s**，3.83MB；抽帧与 HUD 一致。
- 截图 6 张均为 1280×720 真实游戏画面（首/击杀/移动 HUD 已核）。
- 未发现 token 泄漏：证据中无 64-hex token 值；adapter 仅含变量名 `token`，运行时 `generateToken()`，经 env 传给 MCP 子进程（不在 args/URL/日志/截图）。

## 三、证据缺口 / 限制（需在结论中保留）

1. **MCP 返回只有 `queued`**：`world_action` 不返回 `applied/executedTicks/receipt`；本证据靠“后续 observe + HUD AT ACTION + 击杀/位移”交叉，不能从单条返回直接证明 120 tick 全部执行。建议后续 MCP 暴露 receipt 状态（或 `world_observe` 附带最近动作的 applied/executedTicks）。
2. **Owner 自动化授权 ≠ 人类授权**：AUTHORIZE 点击由 Owner 脚本完成；本证据不能关闭“真人授权的外部链接”要求。
3. **单 drone、start room**：不是完整战斗房/整轮 Run，也不是自主探索路线；不能外推为稳定性或广泛自主能力。
4. **首 observe 前的 `world_list_sessions` 与 Owner bootstrap 不在 `tool-io.jsonl`**（仅 `bootstrap.json` 记录夹具）；属可接受的范围声明，但严格审计需把 bootstrap 也纳入原始日志。
5. **token 经进程 env 传递**（非 args/日志）：同一用户进程可读；开发夹具可接受，正式生产应优先用 0600/ACL token 文件（该能力已在 8b9705d 提供）。

## 四、P2 子项判定

- **可关闭**：`P2 真实 Agent 最小合法遭遇` —— 证据支持“一次真实模型经官方 Player MCP，在 Rendered 正式 World 完成最小合法 observe→action→击杀→移动→close，且无策略/无 Scene 注入/无 HP 夹具作弊”。
- **不可关闭**：P2 整体（人类授权证据、Replay/轨迹、自主路线、Headless、ECHO、Signal、完整 Run、稳定性）。本证据只覆盖“最小遭遇”，不能等同完整 P2。

## 五、工具验证日志（一行 PASS/FAIL + 命令 + 结果 + 路径）

| # | 命令 | 结果 | 路径 |
|---|---|---|---|
| 1 | `sha256sum REPORT.md bootstrap.json adapter tool-io.jsonl round-*.png video/*.webm` | **PASS** 11 文件哈希已记录 | `reviewer/lead-live/verification.log` |
| 2 | 解析 `tool-io.jsonl`（python） | **PASS** 6 轮、session `ses_aca0…`、序列与 REPORT 一致 | 同上 |
| 3 | 解析 `../lead-live/tool-io.jsonl` | **PASS** 失败尝试 session `ses_4349…`、`E_SESSION_NOT_FOUND`，与成功隔离 | 同上 |
| 4 | `grep -rEo "[0-9a-f]{64}"` 证据 | **PASS** 无 64-hex token 值 | 同上 |
| 5 | `diff frozen lead-live.mts archived adapter` | **PASS** IDENTICAL（无隐藏策略） | 同上 |
| 6 | `ffprobe video/*.webm` | **PASS** vp9 800×450 25fps 54.8s | 同上 |
| 7 | 查看 `round-1/3/5.png` | **PASS** HUD 与 observation 一致（HP100→76、KILLS1/DMG30/XP8、AT ACTION 0472/02078） | 证据目录 |
| 8 | `ffmpeg -ss 22` 抽帧并查看 | **PASS** 录像帧与 round-3 HUD 一致 | `reviewer/lead-live/video-t22.png` |
| 9 | `git show 8b9705d:World.ts spawnEnemy` + `enemies.ts` | **PASS** 真实 drone maxHp24，无 HP/伤害覆盖 | 冻结源码 |
| 10 | 检查 adapter Player 阶段循环体 | **PASS** 仅 `callTool`+`screenshot`+日志；无键鼠/`evaluate` | 证据目录 |

> 失败关键错误：无（本复核未发现证据不一致或作弊；唯一问题为 adapter 注释“combat room”与实际 start room 不一致，属文档瑕疵，非阻断）。

## 六、报告目录

`reports/ai-native-02/reviewer/lead-live/`：`REVIEW.md`（本文）、`verification.log`（哈希/解析/比对/ffprobe 完整输出）、`video-t08.png`、`video-t22.png`、`video-t42.png`（录像抽帧）。

未修改证据/源码/测试/分支；未执行任何 Player 动作或 Scene 写入；未把预写序列当作模型实跑。
