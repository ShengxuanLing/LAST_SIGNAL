# VS-00 — Station Zero 最小因果原型（实现说明）

> 状态：**原型实现**（`station-zero.html` + `src/slice/*`）。仅验证“Scan → Jam → Door”最小可玩因果与独立入口/存档隔离，**不是**完整切片，也不把 GDD-02 全设计宣称已批准。数值沿用 GDD-02 原型初值，仅本原型使用。

## 1. 启动与入口

- dev：`npm run dev` → 打开 `http://localhost:5173/station-zero.html`
- 默认生产：`npm run build`（或 `npx vite build`）→ 产出 `index.html` + `station-zero.html`。
- **economy 生产仍用独立配置**：`npx vite build --config vite.economy.config.ts`（不是默认可打开；默认构建不产出 `economy.html`）。
- **独立 Phaser 入口**：`src/slice/main.ts` 只注册 `SliceScene`，**不 import `../main`**，不启动原版七场景；原版 `index.html`/economy 行为不变。
- 操作：`WASD` 移动（等距方向）、`Z` 扫描、`X` 压制、`F` 普通开门尝试、`Esc` 暂停/恢复；HUD 另提供 扫描/压制/开门尝试/暂停/重开/保存 按钮，按钮与键盘走同一规则入口；**忽略键盘 auto-repeat**，不会因按住一直扣费。

## 2. 采用规则（原型）

| 项 | 值 |
|---|---|
| 固定 tick | 60 Hz；`accumulatorMs += clamp(delta,0,250)`，单帧最多 15 tick，超出丢弃整 tick 积压；无离线补时 |
| 移动 | 在**每个逻辑 tick 开始**用固定 dt 移动（当前门 passable 碰撞），再算占位/到期/解算；不使用 render delta，无双累加器 |
| Energy | 上限 100；恢复 5/逻辑秒（每 12 tick +1）；满值 `regenAcc` 保持 0，消费后从 0 计数（不会立即多领） |
| Scan | 耗 10；CD 2s；揭示 8s；半径 12；**单次脉冲，空扫合法扣 10**；只揭示（receiver/source/link 各自按距离 **<12** 且 LOS） |
| Jam | 耗 25；CD 8s；持续 6s；半径 **<6** 严格；单目标；生效中重按 `E_RETRYABLE` 零费、不刷新 |
| 门解算 | 单一 resolver 按 `sealSourcePresent（默认 true）+ jamActive + manualOpenIntent + occupancy`；Jam 到期**只改 remaining**，门态由 resolver 决定；不脚本硬写、不夹人、不传送 |
| 安全清空 | 到期/空出后 `SAFE_PENDING_CLOSE` 延迟 1s 再按当前条件恢复；占位中不关门 |
| 占位 | 玩家 AABB `[x±r]×[y±r]` 与门矩形 `[7,8]×[4,6]` 重叠（边/角算占位），与 `canStand` 同一 footprint |
| LOS | 网格线 DDA supercover：逐格步进、精确角点查相邻两格、去两端；静态墙阻挡；源嵌墙自身 cell 例外；动态门格不算静态墙，封门时 Scan 仍能看到源 |
| 普通开门 | 源恒存在 ⇒ `F` 返回 `E_LINK_UNAVAILABLE` 零费，不能绕 SEALED |
| 成功 | 玩家经门到东侧 `x > 8.0` ⇒ `passed=true`，显示“已通过门：原型完成”，不加载 Boss |

`setSealSourcePresent(false)` 是**领域测试钩子**（供连接变化单测），UI 不提供免费切源，也不引入 relay。

## 3. 固定房间

- 14×10 grid；边框墙；竖直隔断 `x=7, y=1..8`，仅门孔 cell `(7,4)`、`(7,5)`；门为动态可通行 overlay。
- 出生 `(3.5,5.5)`；门接收器 `(7.5,5.0)`；只读封锁源 `(7.5,3.5)`（cell `(7,3)` 中心，始终存在、不可 Jam/删除）。
- 玩家半径 0.35 格；移动速度 3.4375 格/秒（原型值，非原版恒速声明）。
- `F` 交互半径原型为独立常量 `INTERACT_RANGE=6`（与 Jam 半径分离，仅原型值；后续规则层可再收紧）。

## 4. 实际复用 / 不复用

- **复用**：`src/core/iso.ts`（等距投影）、`src/core/GraphicsFactory.ts`（`player`/`bg` 程序化纹理与色板）、`src/config/game.ts`（窗口尺寸）。
- **不复用**：`World/Player/WorldRenderer` 会牵连房间刷怪、portal、弹丸、Boss、相机与输入注册；本原型范围禁止这些系统，局部改造风险大于收益。故只在 `src/slice/` 内实现最小网格移动 + 门碰撞，**未改** `src/main.ts`/`GameScene`/`World`/`Player`/`SaveSystem`/economy。

## 5. 存档隔离 ADR（原型级）

- 专用 key：`last_signal_station_zero_vs00_v1`；自有 schema `{schema,version:1,roomId}`。
- **不触碰** `SAVE_VERSION=2`、`last_signal_save_v1`、未来完整切片 save key；不新增 Save3。
- **rejected 会话锁写**：坏/未知 schema 时拒绝加载并**锁定写入**，Save 按钮与“通过门自动保存”都不覆写原档；只有显式 Restart 成功清除本 key 才解锁。
- 持久字段：`energy/tick/doorState/manualOpenIntent/sealSourcePresent/passed/position/remaining{...}`；position + effects 原子保存，恢复先 position→occupancy→solve，避免临时夹人。
- 恢复位置由模型只读 `position` 提供，Scene 按它绘制，**不再用 spawn 覆盖**；无存档时才用 spawn。
- 恢复时由 `doorState==='SAFE_PENDING_CLOSE' && jam===0` 重建 `pendingSafeClose` 并保留 `remaining.safeClear`，覆盖“已离开门但 1s 安全延迟未完成”的恢复分支。
- position 校验复用 Scene 同 5 点 AABB/半径 0.35 与当前门态（含 jam/pending/OPEN），中心合法但身体越墙（如 `(12.9,5.5)`、`(6.7,1.5)`）直接 rejected 并保留坏档锁写。
- **`passed` 是历史通过记录**：玩家通过门后可以合法走回西侧，因此不强制 `passed=true` 时当前 `x>8`；恢复只按存档 position 放置，**不凭 passed 传送**。
- 字段范围校验（整数/上限）越界即拒绝；`localStorage` 不可用仍可玩并提示未保存；Restart 清除失败不得声称已清除。
- 不做战斗快照泛化，不升级旧 Save 格式（仅独立 proto key schema 1，尚无已发布用户档）。

## 6. 文件

| 文件 | 作用 |
|---|---|
| `station-zero.html` | 独立页面 + HUD（稳定 `data-testid`） |
| `src/slice/main.ts` | 独立 Phaser 入口（不 import `../main`） |
| `src/slice/SliceScene.ts` | 固定房间渲染、WASD、按钮/键盘、HUD 投影、存储警告 |
| `src/slice/rules.ts` | 纯 TS 规则模型（Node 可测） |
| `src/slice/room.ts` | 固定房间几何/碰撞/LOS 辅助（纯 TS） |
| `src/slice/storage.ts` | 专用 key localStorage 适配（校验/写锁/不可用） |
| `src/slice/slice.css` | HUD/按钮样式 |
| `vite.config.ts` | 仅新增 `station-zero.html` 默认生产入口（最小改动） |
| `docs/VS_00_IMPLEMENTATION.md` | 本文件 |

## 7. 测试与验收

- 规则与存储单测：`src/slice/vs00.rules.test.ts`；固定房间、门角占位与视线单测：`src/slice/vs00.room.test.ts`。运行 `npm test -- --no-cache`，并执行 `npm run typecheck`。
- 浏览器验收：先启动 dev server，再运行 `npm run playwright -- tests/vs00.spec.ts`。完整原有回归另需 5199 服务（现有 canvas 用例使用该端口）；配置不会自动启动服务器。
- E2E 使用真实按键/按钮与只读 DOM 状态，验证封锁碰撞、Scan 不开门、Jam 后通行、到期占位保护、暂停、资源恢复、保存重载及存档隔离。存档 fixture 只用于设置资源不足和坏档等初态，默认通行用例不修改游戏内部状态。
- 能量不足可由真实操作触发：**单独 Scan 的 10/2s 恰好等于恢复 5/s，不能持续耗尽**；同时按 8s 节奏 Jam 才净消耗。按 **每 2s Scan + 每 8s Jam** 持续，约 32s 后不足25，Jam 返回 `E_ENERGY_INSUFFICIENT`（零费）；停止消耗后最多约5个逻辑秒即可恢复一次Jam所需能量。
- 自动化输出使用项目外 cwd、`LS_SHOT_DIR` 和 Playwright `--output`，构建指定项目外 `--outDir`，避免覆盖既有截图和构建产物。生产包另验 `/station-zero.html` 的真实操作与原版 `/index.html` 菜单启动。

## 8. 非目标

走廊 / 中继器 / 桥梁 / 敌人感知 / Warden / ECHO / Decoy / Agent Bridge / MCP / LLM / Electron / 通用规则编辑器均不在本轮范围；不改旧档格式，不推送远端，不宣称完整切片或全设计已批准。
