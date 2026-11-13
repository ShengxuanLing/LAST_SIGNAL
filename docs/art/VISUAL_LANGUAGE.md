# LAST SIGNAL — 视觉语言规范（Visual Language）

> 可执行规范。每条规则都对应 `src/visual/` 中的具体实现或测试。
> 方向与动机见 [ART_DIRECTION.md](ART_DIRECTION.md)。

---

## 1. 架构契约（必须遵守）

```
SliceModel ──snapshot()──▶ SliceScene ──SliceSnapshot──▶ SliceVisuals (src/visual)
   (权威)                    (宿主)          只读                (表现)
```

| 规则 | 实现 / 守护 |
|---|---|
| 表现层只读 `SliceSnapshot`，不调用 `SliceModel` 任何方法 | `signalEvents.ts::diffSnapshots` 为纯函数；`visual.test.ts` 静态检查 `src/visual` 不导入可变 `SliceModel` |
| 不使用游戏 RNG / `Math.random` | `pool.ts::visualRng`（mulberry32，独立种子）；测试静态检查 |
| 不绑定键盘、不写存档、不改 HUD DOM | 测试静态检查 `keyboard.on / addKeys / saveSlice / localStorage.setItem` |
| 几何只来自规则使用的同一张表 | `sliceGeometry.ts` 复用 `isStaticWallCell / isDoorCell / corridorTile` |
| `?vq=off` 时原渲染器 100% 保持原样 | `SliceVisuals.onRoomLayout` 只切换 legacy Graphics 的可见性 |
| 同一操作序列在 on/off 下结果一致 | `tests/art02-visual.spec.ts` "gameplay outcomes are identical" |

宿主改动（`src/slice/SliceScene.ts`，+10 行）：创建、`drawRoom()` 末尾 `onRoomLayout`、`update()` 末尾 `update(snapshot, delta)`、`teardown()` 中 `destroy()`。

## 2. 图层与深度

| depth | 对象 | 说明 |
|---|---|---|
| -100 | 原 `bg` | 艺术层开启时隐藏（被环境纹理完全覆盖，省一次全屏绘制），`off`/销毁时恢复 |
| 5 | `art02:env:<room>:<q>` | 远景巨构 + 观测环 + 房间环境 + 边缘雾，**合并为一张**全屏纹理（Canvas 渲染器每帧只 blit 一次） |
| 20 | 光照精灵池（≤40，`ADD`） | 按颜色缓存的径向光斑 |
| 30 | `fxFloor` Graphics | 门、桥、中继器外壳、地面环、环境灯 |
| 200 / 500+ | 原守卫 / 玩家精灵 | 不动 |
| 1500 | `fxTop` Graphics | 连接线、扫描波、Jam 光束、粒子、守卫灯 |
| 3001 | 受伤红晕 | 仅受伤时可见 |

## 3. Signal 语法：颜色 × 线型 × 运动

**任何状态都必须同时由至少两种通道表达**（颜色 + 线型/运动），色觉差异玩家仍可分辨。

| 线型 | 含义 |
|---|---|
| 实线 + 流动脉冲 | 连接存在且正在传输；脉冲方向 = 源 → 汇 |
| 静态虚线 | 连接存在但无输出（中继器关闭 / 失去供电），或扫描信息即将过期 |
| 实线在 70% 处断开 + 紫色锯齿 | 被 Jam 干扰；断点靠近被干扰的一端（干扰方向） |
| 剩余时长弧 | 由权威 tick 计算：`jamRemainingTicks / JAM_DURATION_TICKS`、`bridgeRemainingTicks / transitionTicks` |

## 4. 五种 Signal 表现

### 4.1 Scan（`scan` 事件 = `scanRevealTicks` 被合法重置）
1. **起始**：玩家位置白色闪环（0.15s）。
2. **传播**：青色等距椭圆从 0 扩张到 `SCAN_RADIUS = 12` 格（0.75s，ease-out），内侧跟随一道淡环 —— 直接画出真实观察范围。
3. **命中**：波前到达每个**被合法揭示**的端点时（延迟 = 距离/半径 × 0.7s）出现白色十字 + 扩散环 + 白光。
4. **揭示**：端点与连接按 §3 语法显示。
5. **消退 / 过期**：不透明度随 `scanRevealTicks / SCAN_REVEAL_TICKS` 下降；最后 25% 闪烁并改为虚线，提示"信息正在过期"；归零时全部消失（`revealExpired`）。

### 4.2 Jam
- **对象与方向**：紫色锯齿光束从玩家（z=18）延伸至目标（门接收器 / 中继器 / 守卫）。
- **持续时间**：目标处紫色剩余时长弧，随权威 tick 递减。
- **设备状态改变**：门叶缩回地槽，轨道两侧变为紫色干扰线；中继器灯紫色频闪；守卫灯熄灭、周身静电。
- **副作用**：已揭示的连接在目标端断开（例：中继器被压制 → 通往桥与守卫的两条线同时断开，玩家能看到"同一干扰同时影响环境与敌人"）。

### 4.3 Relay
- **输入**：手动开关位置（开 = 青色上位，关 = 灰色下位）—— 意图在被压制/断电时仍保留。
- **输出**：灯色 `ACTIVE` 冷蓝 / `INACTIVE` 灰 / `JAMMED` 紫频闪；`ACTIVE` 时发射头旋转。
- **依赖关系**（扫描后）：一源两汇 —— 冷蓝线 → 桥承重端口；**红线** → 守卫感知。颜色直接回答"这条输出对我有利还是有害"。
- **可操作**：`canInteract` 为真时控制器脚下青色呼吸环（与 HUD "F 可切换" 同源）。

### 4.4 Bridge
| 状态 | 画面 | 可通行线索 |
|---|---|---|
| `UNAVAILABLE` / `DISABLED` | 只剩两岸残桩；发射柱镜头熄灭 | 无桥面 |
| `TRANSITIONING` | 桥段从两岸向中间按进度组装，**线框**、琥珀扫描线；发射柱进度弧 | 线框 = 尚不可走 |
| `STABLE` | 实体桥面，两侧冷蓝导轨脉冲流向对岸 | 实体 = 可走 |
| `UNSTABLE` | 桥面琥珀闪烁 + 位移残影 + 裂纹；抖动/裂纹/闪烁频率随剩余 tick 增加；发射柱倒计时弧 | 越来越"不可信" |
| 恢复 `UNSTABLE→STABLE` | 冷蓝扫掠光从西到东 | |
| 失效 `UNSTABLE→UNAVAILABLE` | 碎片坠入深渊 | |

### 4.5 Guard（只表现合法可观察信息）
| 行为 | 画面 | 合法性依据 |
|---|---|---|
| `IDLE` / `WATCHING` | 暗琥珀灯，灰色接地环 —— **二者画面相同** | `WATCHING` 由视野半径 + LOS 决定；单独画出会暴露精确视野边界与攻击前摇起点（RER 隐藏信息），因此不画 |
| 攻击命中玩家后 | 红灯 + 红色接地环短暂亮起（约 0.4s 衰减）+ 屏幕边缘红晕 | 攻击已发生，是普通可见事件 |
| `INVESTIGATING` 搜索 | 琥珀灯闪烁 + 短扫掠扇（固定 0.9 格，**不是**视野半径） | HUD 已显示"守卫正在调查" |
| `JAMMED` 被干扰 | 紫色频闪 + 静电 + 剩余时长弧 | 玩家自己施加的效果 |
| 感知链路 | 仅在扫描揭示 `perceptionPort` 后显示中继器 → 守卫红线 | Scan 揭示 |
| 命中 / 清除 | 白色闪光 + 火花；清除时琥珀爆散（守卫可点击，故不震动相机） | 普通可见 |

**明确不画**：`WATCHING` 状态本身、证据坐标（`guard.evidence`）、视野半径（`VISION_RANGE`）、攻击前摇计时、共享观察半径。

## 5. 交互物体识别规则

1. 可交互端点永远带**青色**元素；非交互装饰永远不用青色。
2. 出口是唯一常亮的青色地面标记。
3. 装饰物（终端、样本车、坞站）不得放在出生点、出口、门、岸点、设备 1.2 格内（`visual.test.ts` 断言）。
4. HUD 仍是 DOM，位于画布之上；表现层不覆盖 HUD。

## 6. 危险与安全

- 安全：冷蓝/青、稳定、慢节奏。
- 危险：红（敌对）与琥珀（不稳定）；节奏越快越危险。
- 受伤：屏幕边缘红晕（桥失效救援更强）+ 相机微震（仅表现，不影响逻辑坐标；只在玩家受伤时触发）。

## 7. 环境组件（可组合，按主题配置）

`themes.ts` 中的 `Prop` 种类，每种只有一个绘制函数，房间之间不复制渲染代码：
`pipeRun · cableRun · plate · stencil · plinth · console · rail · cart · hazardEdge · emitter · dock · wreck · wear · grime`；
动态 `Ambient`：`flicker`（固定节奏图案）· `blink` · `abyssLight`。

新增房间 = 新增一个 `RoomTheme` 配置 + `RoomGeometry`，不需要新渲染代码。

## 8. 质量档位与性能

| 档位 | 粒子上限 | 环境尘埃 | 同时特效 | 光照精灵 | 背景动态 | 相机反馈 | 贴花 | 地面变体 |
|---|---|---|---|---|---|---|---|---|
| off | 0 | 0 | 0 | ✗ | ✗ | ✗ | ✗ | 原渲染 |
| low | 48 | 10 | 6 | ✗ | ✗ | ✗ | ✗ | 2 |
| medium | 140 | 28 | 12 | ✓ | ✓ | ✓ | ✓ | 4 |
| high | 260 | 48 | 20 | ✓ | ✓ | ✓ | ✓ | 6 |

- 选择：URL `?vq=off|low|medium|high`（强制）＞ `localStorage['last_signal_art02_quality']`（偏好）＞ 默认 `high`。
- 退化策略：未强制时，`FrameGovernor` 以 120 帧滚动均值 > 24ms 触发降一档，之后冷却 240 帧；从不自动升档，不低于 `low`。
- 复用：固定容量粒子池、有界特效表（满则淘汰最旧）、光照精灵池（≤40）、按颜色缓存光斑纹理。
- 纹理缓存：每房间每档位一张环境纹理；另一房间在后台以 **3ms/帧** 预算分片预烘焙，进入时直接复用（投影签名不一致则同步重烘，保证对齐）。
- 释放：场景 `SHUTDOWN` 时销毁所有 `art02:*` 纹理与对象；`window.__art02` 暴露计数供测试。
