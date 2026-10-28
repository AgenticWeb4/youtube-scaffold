# concept Collection [VideoId]

## purpose

保留读者选中的内容或当前视频时刻的笔记，并能回到来源。用途从摘录场景归纳。

## state

- `notes: sequence Note`，初始 []，最多 100 条，新笔记置前；超过上限丢弃最旧项。
- Note 包含 id、videoId、标题/频道、整数秒、显示时间、带时间 URL、text、rawText、createdAt、可选 operationId。
- 在当前保留的 notes 内，相同非空 operationId 复用原笔记。不是无限期幂等记录。
- 实例 generation 防止 clear 后仍在等待润色的旧笔记重新写入。

## actions

```text
saveExact [input: NoteInput] => [success: true; note: Note]
  requires selectedText 压缩空白并 trim 后非空；videoId 可生成标准来源 URL。
  ensures text/rawText 取最多 3000 字符的原选区，不取字幕、不调用模型；保存或返回同 operationId 既有笔记。
saveExact [input: NoteInput] => [success: false; error: "Empty selection"]
  requires 原选区归一化后为空。
  ensures 不写入。
saveMoment [input: NoteInput; transcript: Caption[]] => [success: true; note: Note]
  requires transcript 非空且未在等待润色期间 clear。
  ensures 按 input.timestamp 选字幕；越界选首/末条；用前2后4条及较宽上下文润色；
          text 为润色结果最多3000字符，rawText 保留目标字幕；位置仍为输入秒数。
saveMoment [input: NoteInput; transcript: Caption[]] => [success: false; error: "No transcript content"]
  requires transcript 为空。
  ensures 不写入。
list [videoId?: VideoId | null] => [success: true; notes: Note[]]
  ensures 只读；指定视频则过滤；未指定返回全部；无记录返回 []。
delete [noteId: string] => [success: true]
  ensures 删除该笔记，缺失无操作。
clear [] => [success: true]
  ensures generation 递增，删除全部笔记。
```

NoteInput = `{videoId: VideoId, timestamp: number, videoTitle?, channelName?, selectedText?, operationId?}`。
时间取非负整数；标题最多500字符、频道最多300字符。非法视频、存储失败或世代冲突抛 Error；
单键 update 保证本 store 实例内串行，多个概念之间无事务。
缺模型 Key 的时刻摘录直接拼接附近字幕；模型请求失败也有源码定义的降级路径，不把润色必成作为契约。

## operational principle

`saveExact` 保存当前显示选区，再 `list [videoId]` 能读回相同摘录及来源时间。
没有选区时应用提供字幕后调用 `saveMoment`，所得笔记同时保留原始目标字幕，便于核对润色。

## evidence

[service.ts](src/application/service.ts)、[polish.js](src/adapters/polish.js)、[tests](../../../tests/unit/collection.test.mjs)、[flow tests](../../../tests/integration/application.test.mjs)。
字幕获取与成功通知由 [SYNCS](../../modules/syncs/SYNCS.md) 承担，本概念不调用 Reading。
