import fs from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const output = path.join(root, "dist/extension");
const version = JSON.parse(
  await fs.readFile(path.join(root, "package.json"), "utf8"),
).version;
await fs.rm(output, { recursive: true, force: true });
await fs.mkdir(output, { recursive: true });
await fs.cp(path.join(root, "src/apps/extension/public"), output, {
  recursive: true,
});
const entries = ["background", "content", "sidepanel", "options"];
for (const name of entries) {
  await build({
    entryPoints: [path.join(root, `src/apps/extension/src/${name}.ts`)],
    outfile: path.join(output, `${name}.js`),
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "chrome116",
    legalComments: "eof",
    logLevel: "silent",
  });
}
await fs.copyFile(
  path.join(root, "src/modules/gateway/node_modules/lucide/LICENSE"),
  path.join(output, "LUCIDE-LICENSE"),
);
await fs.copyFile(
  path.join(root, "src/features/vocabulary/node_modules/dexie/LICENSE"),
  path.join(output, "DEXIE-LICENSE"),
);
for (const name of ["LICENSE", "NOTICE", "PRIVACY.md"]) {
  await fs.copyFile(path.join(root, name), path.join(output, name));
}
await fs.writeFile(
  path.join(output, "README.md"),
  `# YouTube Scaffold ${version}

在视频旁阅读双语转写、查看概览、保存笔记和带来源的单词。
参考并改写自 Zara Zhang 的 YouTube Digest：https://github.com/zarazhangrui/youtube-digest。

## 安装与使用

1. 将本目录放在固定位置。在 Chrome 的 chrome://extensions 中启用开发者模式，加载这个包含 manifest.json 的目录。
2. 打开设置，填写并保存自己的 Supadata 和 DeepSeek API Key，可先测试连接。
3. 打开有字幕的 YouTube 视频，点击扩展图标。选中英文单词加入单词本，顶部书本图标查看全部收藏，词卡播放按钮回到视频来源。
4. 更新后重新加载扩展、刷新 YouTube 并重开侧栏；不要删除原加载目录。

设置和收藏保存在本机。清理缓存保留单词本；重置全部数据会清除它。单词本暂不包含在学习 Markdown 导出中。

## 许可与隐私

MIT，见 [LICENSE](LICENSE)。来源和依赖见 [NOTICE](NOTICE)，数据与安全说明见 [PRIVACY.md](PRIVACY.md)。
`,
);
console.log(`Built ${output}`);
