# Whale-chan 角色外观

主菜单右侧可在 Operator 与 Whale-chan 之间切换。外观偏好保存在当前浏览器中，新开局和继续游戏都会读取。旧存档默认使用 Operator。

游戏直接使用 `1190fasheqi/dafeiyu-pet` 发布的 306 像素高透明 PNG 三视图。仓库内三个文件仅改名，像素数据与上游一致。Phaser 根据移动和开火方向选用正面、背面或侧面，向右时镜像侧面，三张图使用相同显示高度和各自的落脚点。

- `front.png`、`side.png`、`back.png` 分别来自 `正面_306.png`、`侧面_306.png`、`背面_306.png`。游戏发行包包含署名与上游仓库许可，位于 `whale-chan/`。[固定版本素材目录](https://github.com/1190fasheqi/dafeiyu-pet/tree/5b0e01856116bd2bae82df1f43c32faa5f056196/sprites) · [上游 LICENSE](https://github.com/1190fasheqi/dafeiyu-pet/blob/5b0e01856116bd2bae82df1f43c32faa5f056196/LICENSE)
- 原始角色「溟月」由上善无形设计，ZipZipPipe 加入 DeepSeek 与女仆元素。社区角色形象遵循上游的署名、非商业性使用和相同方式共享条款。项目以非商业同人素材使用。[社区角色来源与许可](https://github.com/xiaoweigen/deepseek-dafeiyu-assets/blob/7e7a888845877b30314d36a7f274dc3bd6f330b1/NOTICE.md) · [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/)
