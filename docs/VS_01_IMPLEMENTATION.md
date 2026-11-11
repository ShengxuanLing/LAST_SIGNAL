# VS-01 · Station Zero 失稳走廊

## 试玩

运行 `npm ci` 和 `npm run dev`，打开 Vite 地址下的 `/station-zero.html`。也可运行 `npm run build` 后用 `npm run preview` 试玩生产包。

1. 在观测实验室按 **X** 压制门接收器，穿过门并走到东侧青色出口。原型实验室出口位于 `(12.5, 5.5)`。
2. 进入走廊后按 **Z** 查看中继器与桥梁、感知端口的连接。按 **J** 或点击守卫开火，再靠近西岸中继器按 **F**。桥梁建立完成后可过桥。
3. 站在桥中央且中继器在射程内时按 **X**，观察失稳预警。可在预警期撤离。留在桥上会返回进入前的安全岸点并损失 20 HP。压制到期后，仍开启并供电的中继器会重新建桥。
4. 到达东岸青色标记后完成 VS-01。**Esc** 冻结游戏时钟。死亡后使用 **重开** 回到实验室。

## 规则与实现

- R2 使用 GDD-03 的 26×14 固定布局。桥面覆盖 `x10..15, y8..10`，两岸各有免费本地控制器。装载时校验两岸站位、控制器可达性和桥通断前后的连通性。
- 中继器由开关意图、供电和 Jam 求解为 `ACTIVE`、`INACTIVE`、`JAMMED` 或 `DISABLED`。桥梁和感知端口读取同一次提交的输出，订阅者收到同一个只读快照。一次异常订阅回调不会中断其余回调。
- 桥梁从 `UNAVAILABLE` 经 90 tick 的 `TRANSITIONING` 进入 `STABLE`。失去信号后进入 90 tick 的 `UNSTABLE`，期间仍承重。信号恢复可取消失稳。到期先用权威位置检查占位，再更新碰撞。仍在桥上的玩家会被送回最后一岸，单次扣 20 HP，可致命。
- Scan、Jam、Energy、冷却与暂停复用 VS-00 的 60 Hz 时钟。扫描只揭示符合距离和视线的端点。走廊只有一个 Jam 目标，**X** 直接向合法范围内的中继器施放。重开与卸载销毁走廊状态和订阅。
- 守卫是固定站位的本地攻击原型，复用 Drone 与脉冲步枪的数值。感知端口显示信号读数，完整共享感知与单次压制守卫的路线 B 留待后续阶段。切片在 R2 东岸结束。

规则对应 [GDD-02 Reality Engineering](REALITY_ENGINEERING_RULES.md) 的 §4、§6、§7、§9 和 §11。布局与路线对应 [GDD-03 关卡](VERTICAL_SLICE_LEVEL_DESIGN.md) 的 §5 和 §8。

## 检查点

使用 VS-00 的独立 `last_signal_station_zero_vs00_v1` 槽，沿用原有 schema 并追加可选的 R2 检查点。旧实验室存档仍可读。R2 仅在守卫清除、玩家存活且站在安全岸边、桥梁没有危险转换时保存。HP、开关、供电、桥态、揭示和 Jam 剩余 tick 与 Energy、冷却在同一次写入中保存。刷新后继续剩余逻辑时间，暂停和离线时间不计入。

实验室出口先保存，带活守卫进入走廊或完成穿越时可从该处重新尝试。非致命送岸保留检查点。死亡只清理本会话观察过的有效检查点。损坏或已被其他会话更新的存档保留，保存失败会提示。原版与 economy 仍各通过原有入口使用原版的存档键。

## 改动文件

| 文件 | 用途 |
| --- | --- |
| `src/slice/corridor.ts`、`corridorRoom.ts` | Relay 与 Bridge 求解、固定几何、守卫和安全岸点 |
| `src/slice/rules.ts`、`tuning.ts`、`room.ts`、`storage.ts` | 复用固定时钟、几何辅助和独立检查点 |
| `src/slice/SliceScene.ts`、`slice.css`、`station-zero.html` | 房间过渡、输入、桥面及状态反馈 |
| `src/slice/vs01.corridor.test.ts`、`tests/vs01.spec.ts` | 规则单测及真实键盘验收 |

## 验证

- 基线 `d85784d` 在 Windows PowerShell、Node 24 和 Chromium 上通过 Typecheck、46 项 Vitest、19 项 Playwright 及两种生产构建。
- VS-01 通过类型检查、60 项 Vitest、22 项 Playwright、默认生产构建及 economy 生产构建。运行 `npm run typecheck`、`npm test -- --no-cache`、`npm run build`、`npm run build -- --config vite.economy.config.ts`。完整浏览器回归需要 5173 与 5199 两个本机 Vite 服务，命令为 `npm run playwright`。
- 首次 GitHub 检查发现 Phaser 在同一帧重放按键，覆盖 VS-00 的压制消耗反馈。现按浏览器事件对象去重，独立按下相同按键仍能产生新操作。新增同帧按键回归用例，原 E1 断言保留。
- 3 项专项测试在默认生产预览上通过。主流程未发现控制台错误或未捕获异常。
- 专项浏览器测试使用真实键盘穿过实验室门、进入走廊、观察两路连接、清除守卫、建桥、在桥上压制、暂停预警、扣血送岸、保存刷新及再次过桥。死亡用例从低血量检查点开始，实际走到桥上触发失稳并重开。
- 生产预览交互试玩确认预警倒计时与撤离方向可见。桥中央暂停时仍为 100 HP，恢复后送回 `(9.5, 9.5)` 并变为 80 HP。Jam 到期后桥重建，沿桥走到东岸并保存。
- 独立复审复现并确认了到期帧先结算占位、订阅者异常隔离、过期会话保留较新存档。复审未发现剩余阻断问题。

下一阶段可在已发布的 `perceptionFeed` 上接入守卫的共享感知，并用单次 Jam 的六秒窗口验收路线 B。
