# AR-02 · 观测墨线可玩切片

用户确认采用 A · SURVEY INK。主游戏以种子 1 的 R-01 战斗房为切片。Station Zero 的实验室和失稳走廊承担 Signal 的可玩演示。

## 可玩内容

- 探索时先看到设施的石墨体块。进房后由实际房间进入事件揭示骨白地板接缝、测绘刻度和设施标号。设备架、线缆、倒置推车与旧弹痕表达零号站过去的用途。
- 执行者使用骨白硬壳服、单侧仪器桅杆和前后向步态。Drone 以三脚支架立地，Stalker 以贴地钳肢前进，Hunter 悬浮并以菱形机身辨识。切片的自然遭遇是五个 Hunter。三种单位在自动化实机阵列中用实际生成入口并列检查。
- Pulse 的短促枪口闪、骨白弹道、冲击射线和近地残影分别表达射击、飞行、命中和毁损。敌方弹道与瞄准预兆保留朱红色。命中伤害、射程、攻速与碰撞沿用原规则。
- HUD 将生命、经验和装备放在上沿，底部显示局内统计与测绘地图。进房提示移到屏幕上方，伤害数字在目标头顶横向错开。
- Station Zero 的 Scan 从玩家位置展开八向刻线，以有方向的虚线和节点显示规则已揭示的连接。Jam 在被压制目标上画叉，并将相关信号线改为琥珀短划。设备、桥梁和门是否可用仍取自现有快照及固定逻辑时钟。

## 代码与资产

| 位置 | 用途 |
| --- | --- |
| `src/art/survey/` | Canvas 精灵表源文件、语义色、独立视觉 RNG、动画与战斗表现 |
| `src/world/WorldRenderer.ts` | 房间体块和贴花、进房测绘、按需生成并清理墨线纹理 |
| `src/world/World.ts`、`src/entities/` | 把既有实体位置、状态、事件和武器结果传给表现层 |
| `src/scenes/GameScene.ts` | 屏幕锁定 HUD、房间提示、Boss 血条 |
| `src/slice/SliceScene.ts`、`src/slice/slice.css` | 既有 Signal 的 Canvas 反馈与 HUD 语义色 |
| `tests/art/baseline.capture.ts` | 增加 Pulse 固定帧、敌人阵列、扫描传播和切片性能场景 |

新纹理由项目代码在本机 Canvas 2D 生成，可编辑源保存在上表路径，沿用仓库 MIT 授权。未新增第三方图像或字体文件。社区角色仍使用原素材与原授权说明。

## 复现与验收

运行 `node node_modules/vite/bin/vite.js`，浏览主入口或 `/station-zero.html`。主入口的新局随机选择地图，复现切片截图使用固定种子的验证命令。Station Zero 使用 Z 扫描、X 压制门或中继器、G 压制守卫、F 交互。

Windows PowerShell 中运行：

```powershell
$env:ART_AR02 = '1'
node scripts/art/run-checks.mjs --phase after
```

[实机对比页](../../reports/art/comparisons/index.html)包含种子、帧数或操作流程可比的画面。主游戏使用固定帧推进和相机，Station Zero 使用相同按键与等待间隔，精确扫线相位受浏览器帧调度影响。战斗和走廊体验也由键盘与鼠标 E2E 覆盖。Observation、Action、Bridge 与回放仍无可执行接口，现有 `window.__game` 和 Station Zero DOM 状态由测试覆盖。

最终验证通过 TypeScript 类型检查、63 项单元测试、主游戏及 Economy 两项生产构建、31 项 E2E 和 3 项视觉采集任务。初轮 HUD 装备文案回归已修复。Station Zero 两条流程曾出现计时敏感的失败，最终全量运行通过，旧版独立工作树的走廊坍塌流程复跑 3/3 通过。

## 性能

同一台 Windows 11、Intel i7-10510U（8 逻辑线程）、15.8 GB 内存电脑，Chromium 158.0.8127.18 无头、Phaser 3.90 Canvas、1280 × 720、DPR 1、默认设置。三组各测 10 秒，敌人保持存活以维持负载。前值来自独立运行的 `09b7e4c`，后值来自切片。数据见 [前](../../reports/art/test-results/perf-ar02-before.json) 与 [后](../../reports/art/test-results/perf-after.json)。

| 场景 | RAF FPS | 帧时 p95（ms） | `game.step` CPU p95（ms） | 结束 JS 堆（MB） |
| --- | ---: | ---: | ---: | ---: |
| R-01 持续射击 | 60 → 60 | 16.7 → 16.8 | 7.3 → 6.4 | 227.7 → 239.1 |
| 精英房持续射击 | 60 → 60 | 16.8 → 16.7 | 7.6 → 6.3 | 227.9 → 238.1 |
| Warden 第三阶段弹幕 | 60 → 60 | 16.7 → 16.7 | 7.9 → 5.7 | 429.0 → 237.1 |

三组均无超过 20 ms 的 RAF 帧。RAF 接近刷新率上限。R-01 和精英房的 JS 堆样本分别增加 11.4 MB 和 10.2 MB。Boss 的旧版样本明显高于 AR-00 的 229.1 MB 旧值，单轮 JS 堆受垃圾回收时机影响，无法据此归因。JS 堆也不涵盖 Canvas 或整个浏览器进程内存。

## 尚未完成

正式 Boss 重塑、完整武器与房型美术、品牌与菜单体系、Low/Medium/High、减少闪烁设置和全游戏最终艺术评分属于后续阶段。当前世界渲染的共用部件会出现在切片以外，精英房与 Boss 对照用于确认共享表现和性能。商店房与事件房仍沿用 AR-00 清单记录的采集边界。当前角色暗部的对比度和密集命中数字仍值得在后续动态打磨阶段复查。
