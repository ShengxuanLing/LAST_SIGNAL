# Whale-chan 角色外观

主菜单右侧可在 Operator 与 Whale-chan 之间切换。外观偏好保存在当前浏览器中，新开局和继续游戏都会读取。旧存档默认使用 Operator。

角色用两张程序化 Canvas 纹理表现正后两种四分之三视角，水平镜像补足左右朝向。蓝色渐变长发、鳍耳、鲸尾、深蓝裙和白围裙参考社区 Q 版设定与公开 LoRA 的角色描述。游戏内的绘图路径、配色和动作特效为本项目制作。

- 原始角色「溟月」由上善无形设计，ZipZipPipe 加入 DeepSeek 与女仆元素。Q 版参考由 YunYueSama 制作，xiaoweigen 整理了社区六视图及相关许可。[GitHub 六视图及署名](https://github.com/xiaoweigen/deepseek-dafeiyu-assets)
- 图像模型参考为 PixAI 公布的 Q 版 Anima LoRA。本实现根据角色描述绘制，生成流程未加载 LoRA 权重。[LoRA 模型页](https://pixai.art/model/2069858568973677032)
