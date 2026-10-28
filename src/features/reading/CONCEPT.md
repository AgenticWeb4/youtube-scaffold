# concept Reading [VideoId]

## purpose

提供可按来源时间定位、选择和检索的字幕阅读材料。用途从阅读界面及公开服务归纳。

## state

- `material: VideoId -> Material?`，初始空；每个视频至多一份材料，含 Caption[]、纯文本、带时间文本、语言、标题、频道、保存时间。
- 读取时超过 30 天的材料会删除并返回 null；`evict` 才批量限制份数，`save/load` 本身不承诺永远最多 20 份。
- 阅读位置存 session（不可用时回退 local），每次更新最多保留 20 项；显示语言偏好存 local，最多 50 项。
- `pending` 按 VideoId 合并在途取字幕；`generation` 标记清理世代，两者均为实例内状态。

## actions

```text
read [id: VideoId] => [material: Material | null]
  ensures 命中有效材料则返回；缺失返回 null；过期删除本概念材料后返回 null。
save [id: VideoId; value: Partial<Material>] => [material: Material]
  requires id 非空且 value.transcript 为数组。
  ensures 替换字幕和文本；时间/时长归一化为非负数；标题/频道可沿用旧值；更新时间。
save [id: VideoId; value: Partial<Material>] => [error: Error]
  requires 入参不合法或存储失败。
  ensures 非法入参不写入；存储失败拒绝，不声称跨动作事务。
load [id: VideoId] => [success: true; transcript: Caption[]; transcriptText: string;
                       transcriptTextTimestamped: string; language: string | null]
  ensures 先查缓存；无缓存时同视频复用在途 source 请求；有效非空新材料入缓存。
load [id: VideoId] => [success: false; error: string; message?: string]
  requires source 不可用、字幕不可用、取源失败，或获取期间 generation 变化。
  ensures 不把被世代检查识别的旧请求结果写回；读取过期材料的删除不撤销。
evict [max: number = 20] => [ids: VideoId[]]
  ensures 删除过期项和按保存时间倒序超过 max 的项；返回被删除视频 ID。
clear [] => [count: number]
  ensures generation 递增，清 pending，并删除全部材料；返回删除的材料键数。
resetView [] => []
  ensures 删除阅读位置与语言显示状态；不删除材料。
viewStorage.get [key: string] => [value: Record<string, unknown>]
  requires key 为 ytd_transcript_view_state 或 ytd_display_language_modes_by_video。
  ensures 返回 {key: 对应值}，缺失值为 undefined；只读。
viewStorage.set [values: Record<string, unknown>] => []
  requires 每个 key 属于上述白名单且 value 为非空对象。
  ensures 逐键合并并按 updatedAt 排序截断；后续键非法时，前面已完成的键不回滚。
```

其余公开纯函数无持久化副作用：

| 动作签名 | 结果及分支 |
| --- | --- |
| `groupTranscriptEntries(entries, limits?)` | 按源码规则分组合成 Segment[]；不是语义/单词时间对齐 |
| `splitOversizedThought(text, maxChars)` | 分割过长文本，返回 string[] |
| `normalizeCaptionText(text)` | 压缩空白并 trim |
| `findLiteralTranscriptMatches(text, query)` | 返回字面匹配区间，无匹配为空数组 |
| `wordMatches(text, terms)` | 返回大小写不敏感的完整词匹配及 entryId；不匹配子串或屈折词形 |
| `context(entries, at)` | 当前字幕前 2 条、后 4 条上下文；空字幕返回空字符串 |
| `selection(origin, displayText, at, displayRole, entries, unitId?)` | 返回当前显示文本的 SelectionSnapshot，anchor.precision 固定为 segment |
| `vocabularyContext(entries, segmentId, at)` | 按组 id 或起点找原文，返回 sentenceEn/startMs；组已变化则抛错 |

I/O 异常可以拒绝；源适配器通常转成 success=false。没有跨视频源/其他概念状态的事务。

## operational principle

`load [id: 视频]` 得到带时间字幕，`groupTranscriptEntries` 形成阅读段落；
`selection` 冻结所选显示内容和片段锚点，后续异步处理不应猜测单词级时间。

## evidence

- [service.ts](src/application/service.ts)、[segments.js](src/domain/segments.js)、[word-matches.ts](src/domain/word-matches.ts)。
- [source.js](src/adapters/source.js)：只取原生字幕，Supadata 202 时轮询；不回退付费 AI 转写。
- [reading tests](../../../tests/unit/reading.test.mjs)、[vocabulary tests](../../../tests/integration/vocabulary.test.mjs)。
- 边界：过期 read 只清本概念材料；摘要/译文的联动清理由 SYNCS 决定。
