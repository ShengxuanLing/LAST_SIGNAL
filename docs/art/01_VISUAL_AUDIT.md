# ART-RENAISSANCE · AR-00 视觉审计（Visual Audit）

> 分支：`feat/art-renaissance`（基线 `ef57986`）· 日期：2026-11-13 · 角色：Creative / Art Director、Technical Artist、Game UI Designer
> 本文只做审计，不改游戏行为。截图全部来自实际运行（`reports/art/before/`），概念图另见 AR-01。
> 证据记号：`[S##]` = `reports/art/before/##-*.png` 实机截图；`[src:path:line]` = 源码；`[doc:file §]` = 设计文档。

---

## 0. 结论摘要

1. **工程地基健康，视觉身份缺位。** 类型检查、63 项单测、两种生产构建、31 项端到端测试全部通过（第 8 节）。画面却仍是"深蓝底 + 青色描边几何"的原型语言，与 GDB 确认的高层方向"孤独、宏大、神秘、废弃科技文明、秩序与失稳冲突"[doc:GAME_DESIGN_BIBLE §12.1] 之间几乎没有可见联系。
2. **可读性问题先于风格问题。**
   - 敌方无人机使用我方系统青 `#33e0ff` [src:core/GraphicsFactory.ts:75]，资源房的装饰物与拾取物也是青色菱形 [S04]，玩家无法区分敌我。
   - Boss 只是 `enemy_hunter` 放大 2.4 倍，NEAREST 采样下锯齿明显 [src:entities/Boss.ts:31-35][S11]。
   - 0.8 倍缩放下，角色只占屏幕约 1–2% [S03][S07]。
3. **世界观最有辨识度的东西（Signal、观测、共识）在主游戏里完全不可见。** 主游戏没有 Signal 系统。Station Zero 原型里的 Signal 只是细线和小方框 [S20][S22]，HUD 又是另一套 DOM 中文体系，两套 UI 互不统一。
4. **技术约束决定美术路线。**
   - 游戏固定使用 `Phaser.CANVAS` [src:main.ts:12]。Phaser 3.90 的 preFX/postFX 与 Light2D 点光源都只支持 WebGL（见 3.3）。
   - 现有 E2E 用 `getContext('2d')` 读像素（3 个规格文件，8 处）。改用 WebGL 会直接破坏这些测试。
   - 因此 AR-02 应走"Canvas 可烘焙"的美术路线，WebGL 留作 AR-06 的可选决策。

---

## 1. 审查范围与方法

| 类别 | 已审查 |
| --- | --- |
| 文档 | `README.md`、`docs/README.md`、`GAME_DESIGN_BIBLE.md`（全文）、`STYLE_GUIDE.md`、`VERTICAL_SLICE_UI_SPEC.md`、`VS_00/VS_01_IMPLEMENTATION.md`、`ARCHITECTURE_DECISIONS.md`/`SIGNAL_SYSTEM_DESIGN.md`/`AGENT_BRIDGE_ARCHITECTURE.md`（按 `docs/README` 索引核对状态）、`.github/workflows/ci.yml` |
| 源码 | `main.ts`；`config/{game,enemies,weapons}`；`core/{GraphicsFactory,PlayerAppearance}`；`entities/{Player,Enemy,Boss}`；`world/{MapGenerator,World,WorldRenderer}`；`scenes/{Preload,MainMenu,Game,LevelUp,Pause,GameOver}`；`slice/{SliceScene,slice.css}`、`station-zero.html`；`systems/AudioSystem` |
| 运行 | 真实 Chromium 运行主游戏与 Station Zero，共 20 张截图、2 组性能场景（第 5、6 节） |
| 版本（`package-lock.json` 实装） | Phaser **3.90.0**、Vite **5.4.21**、TypeScript **5.9.3**、Vitest **2.1.9**、@playwright/test **1.65.0**；Node **v24.22.1** |

---

## 2. 世界观事实分级（有证据才认定）

**分级说明：**

- **已有设定**：来自用户确认的高层方向，或已实现的代码与文案。
- **合理推导**：由已有设定推出，尚未确认。
- **新增艺术提案**：AR-01 中提出，需要评审。

GDB 自述其世界观细节均为"V1.0 创意提案"[doc:GAME_DESIGN_BIBLE §0.3]。因此下表"已有设定"一栏的含义是"已归档的设计依据"，不等于冻结规格。

| 主题 | 已有设定（证据） | 合理推导 | 新增艺术提案（AR-01） |
| --- | --- | --- | --- |
| 世界事件 | **大静默 The Silence**：所有共识场中继站同时收到约 0.8 秒的未知信号，此后现实状态失去统一协调 [GDB §2.4] | 灾难之后设施仍在运行，所以画面应当是"仍在工作的废墟"，不是"毁灭后的废墟" | 用"已观测 / 未观测"的渲染差异表现失去协调（方向 A） |
| 玩家身份 | 经过特殊训练的**现实工程执行者**，在零号站休眠舱中苏醒，姓名与性别不固定；设施里留有多次苏醒记录 [GDB §3.1, §3.3] | 角色应当是一件"工作服 / 工具"，而不是英雄造型；装备上会有被反复使用的磨损 | 执行者外壳编号 `EX-17`、"AWAKENING #17"字样（暗示多次苏醒，但不揭示真相） |
| 设施用途 | **Station Zero 零号站**：观测共识场异常、保存知识、维护局部稳定、培养执行者；失联多年、无人维护 [GDB §2.5] | 环境应体现观测仪器、档案、冷存、中继 | 测绘与观测器材的造型语言（经纬仪、浑天仪） |
| Signal 含义 | Signal 负责事件的产生、传播、衰减、感知、干扰、来源识别 [GDB §7.1]；Scan / Jam / Decoy [GDB §5]。**已实现**：Station Zero 的 Scan→Jam→门、中继器→桥梁 / 守卫感知 [doc:VS_00, VS_01] | 信号要有"来源→接收"的方向性，可以被看见、被打断、会过期 | 冷蓝 = 稳定信号，青 = 可交互协议，琥珀 = 未知（沿用 GDB §12.3 候选） |
| 敌人起源 | **未确认**。GDB 只给出设计原则：敌人依赖不同信息源（视觉、通信网络、中继器）[GDB §8.3]。代码中只有 `drone / stalker / hunter / sentinel / boss_warden` 五个名字 [src:config/enemies.ts] | GDB §2.4 提到"部分设施不断执行已经失去意义的指令"。据此推导：敌人很可能是零号站自己的自动化维护 / 防御 / 测绘系统，仍在执行失效指令（**推导，非事实**） | 敌人造型取自设施工具（测绘三脚架、夹持机、测距器、闸门塔、浑天仪） |
| 敌人行为 | **已实现** FSM：idle → patrol → detect(0.5 秒) → chase → attack；感知只按距离计算 [src:entities/Enemy.ts:103-147]。drone 与 hunter 远程，stalker 与 sentinel 近战（`reachEnemy`）[src:config/enemies.ts] | 被感知的过程需要可视化（GDD-03 UI §4 Enemy Link） | 敌对光圈作为"感知器官"，是唯一的红色来源 |
| 敌人形态 | 仅有程序化圆形 / 菱形 + 阵营描边 [src:core/GraphicsFactory.ts:75-78] | — | 每类敌人一个独立轮廓类（见 A2） |
| Boss | **Warden**，三阶段（追击冲击波 → 激光与召唤 → 快速弹幕）[src:entities/Boss.ts:89-113]；GDB 建议其护盾与 Signal 关联 [GDB §8.4, §11.7] | 阶段切换应当在视觉上可读 | 护盾节点 = 共识节点环（方向 A） |
| 核心情绪 | 神秘、孤独、宏大、冷峻、废弃科技文明、微弱人类存在、秩序与失稳冲突 [GDB §0.2, §12.1] | — | — |
| 标题寓意 | 菜单副标题 "SIGNAL LOST. SIGNAL REMAINS." [src:scenes/MainMenuScene.ts:34]；第五幕 "The Last Signal" 指向原始信号源 [GDB §10]；结语 "The world is not broken. We have forgotten how to understand it." | "最后的信号"既是灾难起点，也是理解世界的最后线索 | Logo 留到 AR-05 |
| **冲突 / 待确认** | `STYLE_GUIDE.md` 的色彩语义（青 = 我方，紫 = 精英）与 GDB §12.3（冷蓝 = 稳定信号，琥珀 = 未知，白 = 高优先观测）不一致；`VERTICAL_SLICE_UI_SPEC §9` 已注明"不直接覆写现行规范"。GameOver 文案 "The city keeps its secrets." [src:scenes/GameOverScene.ts:25] 指向第二幕的城市，与当前零号站场景不符 | — | AR-01 视觉规范以 GDB 语义为准，**需要你确认**是否替代 STYLE_GUIDE |

---

## 3. 技术基线

### 3.1 渲染管线（实测与源码）

**世界层**
- `WorldRenderer` 把整张地图一次性烘焙成单张 Canvas 纹理（`worldLayer`）[src:world/WorldRenderer.ts:17-28]。
- 只绘制邻接可走格的一圈墙，墙高 26px，墙体朝地板下方延伸 [src:world/WorldRenderer.ts:268-302]。
- 每帧开销接近一次 blit，性能友好，但所有房间外观完全相同。

**光照层**
- 一张 1280×720 的屏幕空间 Canvas，每帧 `clearRect` 后重绘玩家周围的青色径向光和四角暗角 [src:world/WorldRenderer.ts:117-134]。
- 这层光只锁定在屏幕中心，与世界中任何光源都没有关系。

**实体**
- 实体是 `Sprite`。深度规则：玩家固定 100，Boss 固定 95，敌人为 `floor(wy)`，HUD 为 500 [src:entities/Enemy.ts:76, Player.ts:76, Boss.ts:34]。
- **这不是等距排序**（等距排序应按 `wx+wy`），所以前后遮挡关系错误。

**特效**
- 命中特效：单个 `Graphics` 每帧画半透明圆，寿命 0.3 秒 [src:world/World.ts:606-621]。
- 伤害数字：`Text` 加 tween 动画 [src:world/World.ts:449-458]。
- 没有粒子、拖尾、死亡、出生或阶段过场。

**HUD**
- HUD 元素逐个放入世界空间，每帧按相机反算位置和缩放（`lockHud`）[src:scenes/GameScene.ts:216-249]。
- 字体全部为通用 `monospace`，没有 webfont。

**Station Zero**
- 独立 Phaser 入口，使用固定 60 Hz 逻辑时钟。Graphics 直绘地形与门，HUD 是 DOM 加 `slice.css` [src:slice/SliceScene.ts; station-zero.html]。

### 3.2 确定性与 AI Native 现状

**已经确定的部分**
- 地图生成：`MapGenerator` 使用种子 RNG。
- 世界 RNG：`World.rng` 以 `map.seed*7919+1` 为种子，参与掉落、暴击、刷怪挑选，并进入检查点快照 [src:world/World.ts:62, 684]。

**不确定的部分**
- 主游戏使用可变 `dt`（`delta/1000`）[src:scenes/GameScene.ts:258]。
- 以下位置使用 `Math.random`：
  - 星空背景 [GraphicsFactory.ts:57]
  - Boss 召唤角度 [Boss.ts:142]
  - 掉落浮动相位 [World.ts:433]
  - Boss 掉落散布 [World.ts:644]
  - 升级卡抽取 [LevelUpScene.ts:126]
  - 新局种子 [GameScene.ts:86]

**AI Native**
- Observation / Action API、Agent Bridge、回放：**均未实现**，仍处于设计阶段 [doc:docs/README "当前实现边界"]。
- 当前事实上的观测面只有两个：
  - `window.__game` 句柄 [src:main.ts:37]；
  - Station Zero 的 `data-testid` 与 `data-*` DOM 状态。
- 后续艺术工作**必须**保持：
  - `__game`、所有 `data-testid` 和 DOM 状态属性；
  - 规则与渲染的分离；
  - 视觉随机独立于玩法 RNG（AR-03 的约束已经写入 03 视觉规范 §9）。

### 3.3 Phaser 3.90 能力边界（来源：仓库内安装版本的官方 API 文档注释）

| 能力 | 结论 | 出处（`node_modules/phaser`） |
| --- | --- | --- |
| preFX / postFX（Glow、Shadow、Bloom、Vignette…） | **仅 WebGL**："All FX are WebGL only and do not have Canvas counterparts." | `types/phaser.d.ts:3771` 等 |
| Light2D 点光源 | **仅 WebGL**："Point Lights are a WebGL only feature and do not have a Canvas counterpart." | `src/gameobjects/lights/LightsManager.js:118` |
| 混合模式 ADD / MULTIPLY / SCREEN / ERASE | **Canvas 与 WebGL 都支持** | `src/renderer/BlendModes.js:38-60, 214` |
| OVERLAY、SOFT_LIGHT、LIGHTER 等 | 仅 Canvas | 同上 |
| 粒子发射器 | 有 Canvas 渲染器 | `src/gameobjects/particles/ParticleEmitterCanvasRenderer.js` |
| BitmapMask | Canvas 下是空操作（NOOP） | `types/phaser.d.ts:9532` |

> WebFetch 在本会话不可用，所以没有在线访问 docs.phaser.io。上表引用的是与运行版本完全一致的随包官方文档。

---

## 4. 资产与内容清单

| 类别 | 现状 | 证据 |
| --- | --- | --- |
| 玩家 Operator | 48×48 程序化圆体，青色描边加橙色侧块 | `GraphicsFactory.ts:62-73`、[S03] |
| 社区角色 | 鲸鱼娘 / Claude / Grok / Gemini / GPT 三视图位图（PNG / WebP，有授权声明）；缩放到 72px 高 | `PlayerAppearance.ts`、`Player.ts:77-81`、[S18] |
| 敌人 | 4 种：drone 菱形青、stalker 圆红、sentinel 圆金、hunter 圆紫；24–34px | `GraphicsFactory.ts:75-78` |
| Boss | 复用 `enemy_hunter` ×2.4 | `Boss.ts:31-35`、[S11][S12] |
| 武器 | 4 种。scatter 与 arc 的子弹都复用 `proj_pulse`；"Arc 链式闪电"和"Plasma 命中爆炸"在代码中**不存在**（只是 pierce+2） | `World.ts:418-422`、`weapons.ts:45,60`、[S08][S09][S10] |
| 敌弹 | `proj_enemy` 再叠 `setTint(0xff5533)` | `World.ts:429` |
| 拾取 / 门户 | 拾取物：血、金、星图标；**门户使用 `icon_pause` 双竖条图标** | `World.ts:238`、[S02] |
| 房型 | start / combat / resource / shop / event / elite / boss，**视觉完全一致**；仅 resource / shop 有 3 个装饰菱形 | `MapGenerator.ts:209-233`、`WorldRenderer.ts:304-335`、[S04] |
| 动画 | 没有帧动画。敌人与 Boss 用 `setRotation` 朝向玩家，烘焙在同一纹理中的影子跟着旋转；受击是一次白色 tint；冲刺时 alpha 0.7 | `Enemy.ts:155-158`、`Player.ts:221-222` |
| 字体 | 通用 `monospace`（Phaser）/ `ui-monospace…Consolas`（Station Zero DOM） | 场景源码、`slice.css:10` |
| 音效 | Web Audio 实时合成，无音频素材 | `systems/AudioSystem.ts` |
| 菜单 | 扫描线 Graphics 在 `update()` 中**每帧清空并重绘 180 条线**，另有 40ms 定时器重复调用 | `MainMenuScene.ts:128-145, 166-168` |

---

## 5. 实机基线截图（可复现）

**复现命令**：`node scripts/art/run-checks.mjs --phase before`。只跑截图可加 `--only art`。

**脚本**：`tests/art/baseline.capture.ts`，配置 `playwright.art.config.ts`。该配置独立于默认的 `npm run playwright`。

**固定条件**
- Chromium 158（Playwright 1.65 自带）、1280×720、DPR 1、`Phaser.CANVAS`。
- `Math.random` 在页面脚本加载前替换为 mulberry32，种子 `20261113`。
- 主地图种子 **1**：程序扫描种子 1–64，没有一张地图包含全部 7 种房型，因此退回种子 1。截图脚本已改为对缺失房型自动选取后备种子，结果写入 manifest 的 `fallbackSeeds`。
- 时钟：截静帧时让 RAF 循环休眠，再用 `game.step(t, 1000/60)` 推进固定帧数，tween、FSM、弹道与相机都使用同一个时钟。
- 新的 localStorage 档；默认设置（震屏开启）。
- 玩家通过真实刷怪路径被传送进房间（`updateRoom`），并设为无敌，以保证构图稳定。

**清单**：`reports/art/before/manifest.json`（含每张图的种子、房间 id、房型、相机 zoom / scroll、推进帧数）与 `manifest-station-zero.json`。

| # | 画面 | 用途 |
| --- | --- | --- |
| S01 | 主菜单 | 品牌 / UI |
| S02 | 起始房探索 | 环境 / 门户 |
| S03 | 战斗房射击 | 战斗可读性 |
| S04 | 资源房 | 道具与敌人辨识 |
| S05 / S06 | 商店 / 事件房 | 扫描种子 1–400 未生成这两种房型，清单已记录跳过 |
| S07 | 精英房 | 密集战斗 |
| S08 / S09 / S10 | Scatter / Plasma / Arc 射击 | 武器 VFX |
| S11 / S12 | Warden 阶段 1 / 阶段 3 弹幕 | Boss |
| S13 / S14 / S15 | 升级 / 暂停 / 背包 | 叠层 UI |
| S16 / S17 | 失败 / 胜利结算 | 结算 UI |
| S18 | 鲸鱼娘战斗 | 社区角色融合 |
| S19 / S20 / S21 / S22 | Station Zero：实验室待机 / 扫描 / 压制，走廊扫描 | 已实现的 Signal |

最终采集 **16 张主游戏图和 4 张 Station Zero 图**，控制台错误 0。

---

## 6. 性能基线

**数据**：`reports/art/test-results/perf-before.json`

**场景**
- 精英房持续射击：敌人设为不死，负载恒定。
- Boss 阶段 3 弹幕：Boss 不受伤。
- 两个场景各持续 10 秒真实 RAF；环境同第 5 节。
- 机器：i7-10510U，8 线程，15.8 GB 内存，Windows 11。

| 场景 | 帧数 | 平均帧时 | p95 / p99 / 最大 | >20ms 帧 | Phaser actualFps | 显示对象 | JS 堆（起 / 止） |
| --- | --- | --- | --- | --- | --- | --- | --- |
| elite-room-sustained-fire | 596 | 16.67 ms | 16.7 / 16.8 / 16.8 | 0 | 55.1 | 31 | 227.6 / 227.6 MB |
| boss-phase3-barrage | 596 | 16.67 ms | 16.7 / 16.8 / 16.8 | 0 | 59.9 | 35 | 229.1 / 229.1 MB |

**解读**
- 当前画面极轻，帧时完全被 vsync 锁在 16.7ms，看不出余量。
- `game.step` 的 CPU 耗时 p95 分别为 **7.3 ms** 和 **7.5 ms**。完整分位数见性能 JSON，供 AR-02 同条件对照。
- 堆数值是整页 `usedJSHeapSize`，只用于比较趋势，不代表绝对占用。

---

## 7. 十项诊断

**评分说明**：1–10 分，依据商业独立游戏标准与 GDB 方向，由审计者给出。评分仅供横向比较，AR-07 由独立评审复核。

### 7.1 Art Identity 艺术身份 · 2/10

**观察**
- [S03][S07][S12] 去掉 HUD 文字之后，画面可以是任何一款"暗蓝霓虹网格射击"小游戏。
- `STYLE_GUIDE` 的四条支柱（暗底单色辉光、几何极简、青色系统、数据秩序）[doc:STYLE_GUIDE §1] 描述的是技术取巧，不是世界观表达。
- GDB 的关键词——废弃科技文明、巨型基础设施、不可理解的空间、微弱人类存在 [GDB §12.1-12.2]——在画面中**没有一项**被表现出来。

**结论**：缺少可以一句话说清的视觉命题，也缺少只属于这款游戏的视觉规则。

### 7.2 Composition 构图 · 3/10

**观察**
- 0.8 倍缩放下，房间只占画面中部约 35%，其余是空黑与重复走廊 [S03][S04]。
- 角色约 19px，玩家位于屏幕正中，没有前景层或画框元素。
- 房名浮字 "COMBAT ROOM" 直接盖在玩家与敌人上 [S03][S09]，伤害数字叠成 "12 22 2" [S03][S18]。
- Boss 战的 1.25 倍缩放改善了尺度 [S11]，但战斗区仍然偏居一隅。

### 7.3 Color 色彩 · 3/10

**观察**
- **语义冲突**：敌方 drone 使用我方系统青 `#33e0ff` [src:GraphicsFactory.ts:75]。资源房的装饰菱形、upgrade 图标与 drone 同色同形 [S04]，"HOSTILES 4" 时无法指认哪几个是敌人。
- 主色依次是青、红、橙、金、紫，五个高饱和色争抢注意力。
- 环境是单一青灰网格，墙、地、走廊明度几乎相同，缺少明度层次。
- 我方 / 系统 / 环境都用青色，青色已经失去信息量。

### 7.4 Silhouette 轮廓 · 2/10

**观察**
- stalker、hunter、sentinel 都是"圆加中心点"，只靠颜色区分 [src:GraphicsFactory.ts:135-150][S07]。
- Boss 与 hunter 同形，放大后 NEAREST 锯齿明显 [S11]。
- 玩家 Operator 同样是圆形 [S03]。
- 社区角色是 72px 立绘，与 24px 几何敌人尺度不协调 [S18]。
- 灰度化后，全部敌人只剩"圆点"。

### 7.5 Environment 环境 · 2/10

**观察**
- 所有房型共用同一套地板（菱形 + 四角点）与 26px 墙沿 [src:WorldRenderer.ts:236-302]。
- 起始房、精英房、Boss 房外观相同 [S02][S07][S11]。
- 没有设施功能（观测、冷存、中继、档案），没有材质、磨损或环境叙事。
- 墙"向下延伸"，房间读起来像漂浮的平板，而不是建筑内部 [S03]。

### 7.6 Lighting 光照 · 2/10

**观察**
- 唯一的"光"是屏幕中心的青色径向渐变加四角暗角，跟随相机而不是世界 [src:WorldRenderer.ts:117-134]。
- 没有光源、阴影方向、自发光物或光照层次。
- 子弹的径向辉光只有 12px [src:GraphicsFactory.ts:81-85]。
- 光照没有承载任何玩法或叙事信息，例如稳定区与失稳区的差别。

### 7.7 Animation 动画 · 1/10

**观察**
- 没有任何帧动画：Idle、Move、Attack、Hit、Death 全部缺失。
- 敌人整张纹理随朝向旋转，连烘焙的阴影一起转 [src:Enemy.ts:155-158]。
- 敌人死亡时 `sprite.destroy()`，直接消失 [src:World.ts:625]；Boss 死亡同样如此 [World.ts:638]。
- 只有鲸鱼娘有尾迹与开火特效 [src:core/WhaleCharacter.ts]。

### 7.8 VFX 特效 · 2/10

**观察**
- 命中只有一个 0.3 秒的半透明圆 [World.ts:606-621]。
- scatter 与 arc 复用 pulse 的子弹贴图 [World.ts:420][S08][S10]；武器描述中的"链式闪电""命中爆炸"没有对应表现，也没有对应机制。
- 枪口、弹壳、拖尾、爆炸、死亡、Boss 预兆、阶段过场全部缺失 [S12]。
- 敌弹是红色小点，在 1.25 倍缩放下仍然很难看清弹幕节奏 [S12]。

### 7.9 UI/UX · 3/10

**观察**
- HUD 是左上和右上的散列文本，层级弱，字体是系统 monospace [S03]。
- Boss 血条的填充与底框错位：填充约 x 640–956，底框约 480–800 [S11][S12]。原因是 `bossBarFill.width` 被直接赋值，没有更新显示原点 [src:GameScene.ts:211, 355]。
- 背包叠层的底色不足以压住世界，文字与房间重叠 [S15]。
- 门户用暂停图标 [S02]。
- 升级卡信息完整但视觉单调 [S13]。
- 结算文案指向"城市" [S16]。
- Station Zero 使用 DOM 中文面板与按钮 [S20][S22]，与主游戏的 Phaser 英文 HUD 是两套系统。

### 7.10 Cohesion 一致性 · 2/10

**观察**
- 存在四种互不相干的视觉语言：
  - 程序化几何（世界与敌人）；
  - 社区立绘（5 个角色）；
  - Phaser 文本 UI；
  - Station Zero DOM UI。
- `STYLE_GUIDE` 与 GDB 的色彩语义互相冲突（第 2 节）。
- 没有统一的设计 Token（颜色、间距、字号、时序）。

**综合（加权前的平均印象）：约 2.2 / 10。** 目标（AR-07）为 8 / 10。

---

## 8. 测试结果

日志与汇总位于 `reports/art/test-results/`，入口为 `before-summary.json`。

| 项 | 命令（无 npm，直接调用 JS 入口） | 结果 |
| --- | --- | --- |
| 类型检查 | `node node_modules/typescript/bin/tsc --noEmit` | ✅ 通过（2.3 s） |
| 单测 | `node node_modules/vitest/vitest.mjs run --no-cache` | ✅ 5 个文件 **63 / 63**（1.5 s） |
| 生产构建 | `node node_modules/vite/bin/vite.js build --outDir <tmp>` | ✅ 通过；`enemies-*.js` 1,487 kB（gzip 343 kB），触发大于 500 kB 警告（已知） |
| economy 构建 | `… build --config vite.economy.config.ts --outDir <tmp>` | ✅ 通过 |
| E2E | `node node_modules/@playwright/test/cli.js test --workers=1`，同时启动 5173 与 5199 两个 dev server | ✅ **31 / 31**（2.4 min），覆盖菜单、玩法、检查点、Boss 房、HUD、角色、economy、VS-00、VS-01 |
| AI 接口回归 | — | ⚪ **不适用**：Observation / Action / Bridge 未实现，没有可执行的测试。已有替代保护：E2E 断言 `__game` 与 Station Zero 的 `data-testid` 状态 |
| 视觉测试 | `… test -c playwright.art.config.ts` | ✅ 基线采集通过（38.2 s，0 控制台错误）。项目此前没有像素级视觉回归；本次建立的是可复现的截图基线，比对工具留到 AR-07 |

**环境**：Node v24.22.1（本机 Codex 运行时附带，`npm` 不在 PATH）、Windows 11 10.0.26200 x64、Chromium 158。

**执行说明**：Codex 在本机运行 Claude Code 编写的验证脚本，并修正了中文路径解析。日志记录了实际执行路径。

---

## 9. 对后续阶段的约束

1. **保持 `Phaser.CANVAS`**，至少在 AR-02 内不切换 WebGL。原因：现有 E2E 依赖 2D 上下文读像素；`roundPixels` / `pixelArt` 的历史问题见 `main.ts:22-26`。WebGL、FX 与 Light2D 作为 AR-06 的可选质量档，单独决策。
2. **视觉随机使用独立 RNG**，派生自 `map.seed` 加常量盐，绝不调用 `World.rng`。否则会改变掉落与暴击序列，破坏检查点里的 `rngState`。
3. **只改渲染，不改碰撞**：`isWalkable` 与 `tileAt` 的语义、房间尺寸、刷怪点保持不变。墙体加高与前景层只在烘焙纹理和深度上实现。
4. **保留全部 `data-testid` 与 `window.__game`**；HUD 改版后，`canvas.spec.ts` 中关于 HUD 区域像素的断言需要同步审阅。
5. **截图条件已固定**：`baseline.capture.ts` 是 before / after 唯一的对比来源，`ART_PHASE=after` 输出到 `reports/art/after/`。
6. 第 7 节发现的**行为类缺陷**本阶段没有修复，以保持基线行为：Boss 血条错位、门户图标、depth 排序、敌人旋转阴影、arc / plasma 描述与实现不符、`Math.random` 来源。这些问题列入 AR-02 / AR-04 的待修清单，修复前需要单独确认是否触及玩法。
