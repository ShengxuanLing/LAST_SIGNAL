# ART-02 — 最终报告：World Art Direction, Environmental Storytelling & Visual Upgrade

- **分支**：`feat/art-02-world-visuals`（起点 `origin/main` @ `860a0dd`）
- **范围**：Station Zero 切片（`station-zero.html`，R1 观测实验室 + R2 失稳走廊）
- **规范**：[ART_DIRECTION.md](ART_DIRECTION.md) · [VISUAL_LANGUAGE.md](VISUAL_LANGUAGE.md) · [ASSET_LICENSES.md](ASSET_LICENSES.md) · [证据](evidence/README.md)

---

## 1. 交付状态（明确区分）

| 项 | 状态 |
|---|---|
| R1 观测实验室环境升级（材质、墙体高度、管线、铭牌、终端、样本车、磨损、AO、远景） | **已集成正式游戏**（`station-zero.html` 默认开启） |
| R2 失稳走廊环境升级（格栅、深渊纵深/断崖、旧桥残骸、发射柱、巡检坞站、危险边条） | **已集成正式游戏** |
| Signal：Scan 起始/传播/命中/揭示/过期 | **已集成** |
| Signal：Jam 对象/方向/时长/设备状态/副作用（门、中继器、守卫） | **已集成** |
| Signal：Relay 输入/输出/激活/依赖/被干扰 | **已集成** |
| Signal：Bridge 稳定/不稳定/即将失效/已失效/恢复 | **已集成** |
| Signal：Guard 巡逻/发现/搜索/被干扰/命中（仅合法可观察信息） | **已集成** |
| 环境叙事组件（铭牌、维护编号、终端日志、中断的自动化、旧桥残骸） | **已集成** |
| Low / Medium / High 档位 + `off` 对照 + 自动降档 | **已集成** |
| 主游戏 `index.html`（World/WorldRenderer/GameScene） | **未改动**（属于 AI-NATIVE-02 / 其它团队区域，本轮不触碰） |
| R0 苏醒舱、R3 共识核心 | **尚未完成**：切片中尚未实现这两个房间；主题系统已可直接扩展（新增 `RoomTheme` 配置即可） |
| ECHO 可视化 | **等待 AI-NATIVE-02 接口**：ECHO 的位置/观察目前不在 `SliceSnapshot` 中，表现层不自行推断 |

## 2. 修改文件

| 文件 | 类型 | 说明 |
|---|---|---|
| `src/visual/palette.ts` | 新增 | 语义色 + 材质色 + 对比度工具 |
| `src/visual/quality.ts` | 新增 | 档位、选择优先级、`FrameGovernor` 自动降档 |
| `src/visual/themes.ts` | 新增 | `EnvironmentVisualConfig`、`RoomTheme`、两间房的可组合道具配置 |
| `src/visual/iso2d.ts` | 新增 | 等距几何工具 |
| `src/visual/pool.ts` | 新增 | 固定容量粒子池、有界特效表、视觉 RNG |
| `src/visual/EnvironmentBaker.ts` | 新增 | Canvas 2D 环境烘焙（支持分片） |
| `src/visual/sliceGeometry.ts` | 新增 | 复用规则几何表 |
| `src/visual/signalEvents.ts` | 新增 | 纯函数快照差分 → 表现事件 |
| `src/visual/SliceVisuals.ts` | 新增 | Phaser 表现层（图层、光照池、特效、生命周期） |
| `src/visual/sliceAdapter.ts` | 新增 | 宿主挂载适配 + 布局预测 |
| `src/visual/visual.test.ts` | 新增 | 13 个单元测试 |
| `src/slice/SliceScene.ts` | **修改 +10 行** | 仅挂载：import、字段、创建、`drawRoom` 末尾、`update` 末尾、`teardown` |
| `tests/art02-visual.spec.ts` | 新增 | 7 个 E2E（档位、泄漏、暂停、玩法一致性） |
| `scripts/art02/capture.spec.ts`、`playwright.art02.config.ts` | 新增 | 证据采集（不在默认套件中） |
| `docs/art/*` | 新增 | 规范、许可、报告、证据 |

新增资源：无外部文件（全部程序化，见 ASSET_LICENSES）。

## 3. 测试

| 检查 | 改造前（origin/main） | 改造后 |
|---|---|---|
| Typecheck `tsc --noEmit` | 通过 | 通过 |
| Unit `vitest run` | 292 / 292 | **305 / 305**（+13 ART-02） |
| Build `vite build` | — | 通过 |
| Playwright 全套 | 26 / 27（`canvas.spec` 需 5199 端口，环境原因） | 见 §3.1 |
| 浏览器控制台错误 | — | 4 个档位 + Demo B 均为 0 |
| 资源泄漏 | — | 走廊进入 + 6 次重开后纹理 ≤16、对象 ≤46、粒子 ≤ 上限 |
| 暂停/恢复 | — | 暂停期间粒子/特效冻结，恢复继续 |
| 玩法一致性 | — | 同一输入序列在 `off` / `high` 下门态、结果码、揭示完全一致 |
| 场景切换 / 重复进入 | — | 实验室 ↔ 走廊 ↔ 重开，走廊环境由后台分片预烘焙复用（同步烘焙仅首屏 1 次） |

### 3.1 Playwright 结果

最终一轮：**34 / 34 通过**（含 `canvas.spec`，另起 5199 端口服务；含新增 7 个 ART-02 用例），证据采集 15 / 15 通过。

**已知不稳定用例（既有，非本分支引入）**：`tests/vs01.spec.ts › route B …` 在 `walk()` 轮询到进入走廊后才松键，断言出生 x ≤ 2.6、y = 10.5；松键延迟 1–2 帧就会多走 0.1 格。本机 20 次重复 A/B：

| 版本 | 失败 / 20 |
|---|---|
| `origin/main` 原 `SliceScene.ts` | 11 |
| ART-02 | 7 |

结论：该用例在本机本身对计时敏感，ART-02 未使其恶化。开发中曾发现进入走廊时同步烘焙环境造成一次卡顿，已改为后台分片预烘焙（见 §4）。建议测试负责人把断言改为容差或松键后再读坐标（本分支不修改他人测试）。

日志：`docs/art/evidence/logs/`。

### 3.2 分辨率

1920×1080、1366×768、1280×720、1024×768、800×600 截图见 `evidence/res-*.png`。Phaser `Scale.FIT` 保持 1280×720 逻辑分辨率，HUD 为 DOM，各分辨率下 HUD 与画面无重叠遮挡（800×600 使用既有响应式 HUD 布局）。

## 4. 性能

`evidence/perf.json`（1920×1080，Playwright 无头 Chromium，本机）：

| 场景 | off（原渲染） | low | medium | high |
|---|---|---|---|---|
| 实验室 平均帧间隔 | 17.0 ms | 17.2 ms | 18.5 ms | 18.5 ms |
| 走廊 平均帧间隔 | 19.4 ms | 18.4 ms | 18.0 ms | 17.7 ms |

每帧脚本执行时间（rAF 回调内，含 Canvas 绘制提交）：off 约 2.2 ms，high 约 1.2–1.9 ms；进入走廊那一帧最大 23 ms（off 为 16.5 ms）。

结论（仅限此环境）：各档位与原渲染器差异在测量噪声内（本轮 off 本身也出现 33 ms 的 p95 尖峰）。**这不是对任意硬件的 60 FPS 承诺**；目标硬件基线仍需项目所有者确定。低端设备上 `FrameGovernor` 会自动降档。

主要成本控制：远景 + 环境 + 边缘雾一次烘焙为单张纹理（每帧 1 次 blit，并隐藏被覆盖的原 `bg`）；动态层两个 Graphics；光照精灵 ≤40；粒子固定容量池；非当前房间以 3ms/帧预算分片预烘焙。

## 5. 已知问题

1. 原守卫贴图仍是 `enemy_drone`（青色菱形），Canvas 渲染器下原有 `setTint` 无效；ART-02 通过守卫灯/接地环表达状态，未替换贴图（贴图属实体表现，留待与实体负责人协商）。
2. 铭牌文字使用系统等宽字体，不同系统字形略有差异。
3. 自动降档阈值（24ms/120 帧）为经验值，需在目标硬件上校准。
4. 主游戏（`index.html`）未纳入本轮；`feat/art-renaissance` 分支有另一套方向，二者尚未统一。

## 6. 合并风险与潜在冲突

| 文件 | 风险 | 说明 |
|---|---|---|
| `src/slice/SliceScene.ts` | **低–中** | 唯一修改的既有文件，+10 行、无格式化。若 AI-NATIVE-02 修改 `create()/update()/drawRoom()/teardown()`，可能产生文本冲突；解决方式是保留对方改动后重新插入 4 个挂载调用 |
| `src/slice/*` 其它文件 | 无 | 未修改 |
| `src/world/*`、`src/entities/*`、`src/core/*`、`src/ai-native/*` | 无 | 未修改 |
| `feat/art-renaissance`（未合并） | 中 | 该分支重写了 `SliceScene.ts`（148 行）；若两者都要合并，需要选择或融合方向 |
| 存档格式 / RNG / Tick / 碰撞 / 输入 | 无 | 未触碰（单元测试静态守护） |

**不自动合并。** 等待项目所有者安排审查与合并。

## 7. 独立审查

由一个独立的只读审查代理按 §12 清单审查（禁止区域、玩法状态、碰撞、AI-Native、泄漏、版权、性能、可读性）。结论：**无阻断问题**。

| 发现 | 严重度 | 处理 |
|---|---|---|
| 守卫 `WATCHING` 的红环/瞄准线暴露精确视野/LOS 边界与攻击前摇起点（RER 隐藏信息） | 中 | **已修复**：`WATCHING` 与 `IDLE` 画面相同；红色只在攻击已命中后出现 |
| 守卫命中时相机震动会让可点击守卫的命中区短暂移动 | 低 | **已修复**：命中守卫不再震动；仅玩家受伤时震动 |
| 暂停时抖动种子仍在递增 | 低 | **已修复**：`dt=0` 时不推进 |
| 重开后残留受伤红晕/命中闪光 | 低 | **已修复**：`roomChanged` 清零 |
| `setQuality('off')` 时受伤红晕可能残留 | 低 | **已修复** |
| `publishStats` 每帧分配 | 低 | **已修复**：每 15 帧或有事件时发布 |
| 降档时同步重烘焙 | 低 | 保留：降档是罕见事件，已记录 |
| `model.snapshot()` 每帧调用两次 | 低 | 保留：为把 `SliceScene` 改动控制在 10 行内；快照成本很低 |
| 证据 PNG 体积 | 提示 | 约 10.6 MB，保留在 `docs/art/evidence/` 供审查 |

禁止区域、存档/RNG/输入、泄漏与版权四项：审查确认无问题。
