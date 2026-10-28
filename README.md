参考并改写自 [Zara Zhang](https://github.com/zarazhangrui) 的 [YouTube Digest](https://github.com/zarazhangrui/youtube-digest)，保留原作者的 [MIT许可](https://github.com/AgenticWeb4/youtube-scaffold/blob/main/LICENSE)。第三方依赖及随包许可证见 [NOTICE](https://github.com/AgenticWeb4/youtube-scaffold/blob/main/NOTICE)。

# YouTube Scaffold

在YouTube视频旁阅读字幕、查看双语译文、理解重点，并保存可回到来源的笔记和单词。

- 按时间戳阅读、搜索字幕并定位视频。
- 切换原文、中文或双语视图，按需生成概览和语境解释。
- 保存片段笔记，或收藏带双语语境与视频时间的英文单词。
- 再次遇见收藏词时高亮，回到来源重听。
- 导出字幕TXT，以及包含概览、字幕与笔记的Markdown。

## 用看过的视频记单词

比如，你在编程教程里遇到 approach（方法），又在一段访谈里听到这个词。把两次遇见都收藏后，单词本会把它们放在一起，保留原句、中文译文和视频位置。复习时点一下，就能回到当时的视频，再听一遍这个词是怎么用的。

![转写阅读与单词本功能概览](assets/screenshots/product-overview.png)

*界面节选合成，已对无关画面作模糊处理。*

## 安装

需要Chrome 116或更新版本。

1. 从 [最新 Release](https://github.com/AgenticWeb4/youtube-scaffold/releases/latest) 下载扩展ZIP并解压到固定目录。
2. 打开 `chrome://extensions`，启用开发者模式。
3. 选择“加载已解压的扩展程序”，打开解压后包含 `manifest.json` 的目录。

更新后重新加载扩展并刷新YouTube；保留原加载目录可继续使用已有设置和收藏。

从源码构建时，需要Node.js 22或更新版本及项目指定版本的pnpm：

```sh
pnpm install --frozen-lockfile
pnpm run build
```

构建后，在Chrome加载 `dist/extension/`。

## 开始使用

1. 在设置中填写自己的 [Supadata](https://dash.supadata.ai/) 和 [DeepSeek](https://platform.deepseek.com/) API Key，可先测试连接。
2. 打开有字幕的标准YouTube视频页面，点击扩展图标。
3. 阅读或翻译字幕；打开概览，或选中文字进行解释和摘录。
4. 选中英文整词加入单词本，点击词卡播放按钮回到视频来源。
5. 按需导出学习资料。

服务费用由对应服务商收取，本项目不提供API额度。无可用字幕时不自动生成转写；时间定位依据字幕片段。单词本保存在本机，暂不支持云同步、文件导出或复习算法。

## 数据与安全

API请求直接发往Supadata与DeepSeek，本项目不提供中转服务、广告或使用情况追踪。Key只填写在扩展设置中，不写入源码、截图或Issue。数据保留、删除和权限范围见 [隐私说明](PRIVACY.md)。

## 检查与打包

```sh
pnpm run check
pnpm run package
```

安装包生成在 `dist/`；构建产物与本地数据不提交到Git。

概念契约与同步规格随源码维护：从 [架构与规格导航](ARCHITECTURE.md) 进入各模块的 `CONCEPT.md` 及协调层的 `SYNCS.md`。`pnpm run check` 会检查规格覆盖、引用与派生地图；更新规格后运行 `pnpm run specs:map` 重建导航。行为变更应在同一次提交中更新对应规格、实现及必要测试。

推送代码或提交PR时，GitHub Actions会自动测试、构建并提供安装包。推送与项目版本一致的 `vX.Y.Z` 标签后，会自动发布到 Releases；也可在 Actions 页面手动运行构建。
