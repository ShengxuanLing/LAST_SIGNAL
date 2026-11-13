# ART-02 — 素材与许可证清单

**结论：ART-02 未引入任何外部素材文件。** 所有新增视觉内容均为本仓库源码在运行时通过 Canvas 2D / Phaser Graphics 程序化生成，随项目 `LICENSE`（MIT）发布。

| 素材 | 来源 / 生成方式 | 作者 | 许可证 | 使用范围 | 文件位置 |
|---|---|---|---|---|---|
| 房间环境纹理（地板、墙、管线、电缆、铭牌、喷字、深渊、残骸、终端、样本车、坞站） | 运行时程序化烘焙（`EnvironmentBaker`），固定种子视觉 RNG | 本项目（ART-02，Claude Code 编写） | MIT（项目许可证） | Station Zero 切片 | `src/visual/EnvironmentBaker.ts`、`src/visual/themes.ts` |
| 远景背景（观测环、塔柱、桁架） | 运行时程序化（`bakeBackdrop`） | 同上 | MIT | 同上 | `src/visual/EnvironmentBaker.ts` |
| 光斑、暗角、受伤红晕纹理 | 运行时径向渐变（`bakeGlow`、`bakeVignette`） | 同上 | MIT | 同上 | `src/visual/EnvironmentBaker.ts` |
| Signal 特效（扫描波、命中、Jam 光束、桥体、守卫灯、粒子） | 每帧 Phaser Graphics 绘制 | 同上 | MIT | 同上 | `src/visual/SliceVisuals.ts` |
| 色板 | 沿用 `docs/STYLE_GUIDE.md` 既有 hex，新增冷蓝 `#5d8dff` 与材质灰 | 同上 | MIT | 同上 | `src/visual/palette.ts` |
| 铭牌/终端文字 | 原创短文本，系统等宽字体渲染（`ui-monospace, Consolas, monospace`），不打包字体文件 | 同上 | MIT | 同上 | `src/visual/themes.ts` |
| 证据截图 | Playwright 对本项目运行画面截图 | 同上 | MIT | 文档/PR 证据，不随游戏分发 | `docs/art/evidence/*.png` |

## 核查

- 未复制任何商业游戏、电影或其他作品的素材；未使用外部参考图；未使用 AI 生成位图。
- 字体：仅引用用户系统已安装的等宽字体，不分发字体文件。
- 仓库既有素材（`assets/` 及其它已有资源）未被 ART-02 修改或引用。
- 未改动 `package.json` 依赖；未新增 CDN 请求（`tests/vs01.spec.ts` 已有"无外部请求"断言，仍通过）。
