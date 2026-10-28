# concept Export [VideoId]

## purpose

把用户选定的学习资料写入自己授权的本地目录。用途从 Markdown 导出场景归纳。

## state

本概念独立 IndexedDB 保存 `directory: FileSystemDirectoryHandle?` 与 `sections`。
初始无目录；sections 缺失时 analysis/transcript/notes 全选。它不是 worker 的 chrome.storage.local。

## actions

```text
readConfig [] => [directoryName: string; sections: Sections]
  ensures 只读；没有目录则名字为空；section 仅显式 false 关闭。
chooseDirectory [] => [name: string]
  requires 浏览器支持目录选择且调用保有用户手势。
  ensures 先打开 picker，再等待存储；选中后保存句柄并返回名字。
chooseDirectory [] => [error: Error]
  requires 用户取消、平台不支持或存储失败。
  ensures 不声称已保存目录；取消前未改配置，存储失败遵循适配器行为。
setSections [input: unknown] => [success: true]
  requires 归一化后至少有一项启用。
  ensures 保存 analysis/transcript/notes 三个开关。
setSections [input: unknown] => [error: Error(code="NO_SECTIONS")]
  requires 所有项关闭。
  ensures 不保存新配置。
saveStudy [study: Study; loadNotes?: (videoId: VideoId) => Promise<Note[]>]
  => [filename: string; directoryName: string; url: string]
  requires 视频 ID 合法，已选目录，至少启用一项，目录读写权限获准，文件写入成功。
  ensures 仅在 notes 开启时执行 loadNotes；未传时使用 study.notes 或 []；
          以 videoId+唯一后缀.md 新建文件，写入并关闭后才返回；不修改输入学习资料。
saveStudy [study: Study; loadNotes?: Function] => [error: Error]
  requires 无目录(NO_DIRECTORY)、无权限(PERMISSION_DENIED)、无章节(NO_SECTIONS)，
           非法 ID、取笔记/生成文件名/创建/写入失败。
  ensures 不报告成功；write/close 失败时尝试 abort；不保证文件系统没有残留项。
reset [] => [success: true]
  ensures 清空本概念配置；不删除用户已导出的文件。
```

Sections = `{analysis: boolean, transcript: boolean, notes: boolean}`。
Study = `{videoId: VideoId, title?, channel?, analysis?, transcript?, notes?}`；实际 Markdown 字段见 [markdown.js](src/domain/markdown.js)。
输入视频 ID 在该导出边界按 6..20 位 `[A-Za-z0-9_-]` 检查，与 Vocabulary 的 11 位校验不同。

## operational principle

`chooseDirectory` 后 `setSections` 选好资料，`saveStudy` 返回文件名，用户能在该目录找到可回到视频时间的 Markdown。
`reset` 撤掉扩展保存的目录配置，已经导出的个人文件仍保留。

## evidence

[service.js](src/application/service.js)、[indexed-db.js](src/adapters/indexed-db.js)、[tests](../../../tests/unit/export.test.mjs)。
loadNotes 由应用注入读取动作，不允许在概念内部导入 Collection；重置顺序见 [SYNCS](../../modules/syncs/SYNCS.md)。
