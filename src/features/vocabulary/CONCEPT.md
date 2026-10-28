# concept Vocabulary [VideoId]

## purpose

让学习者按一个英文词回看自己收藏过的原句和视频来源。用途从当前收藏与回放场景归纳。

## state

- `Entry = {id, language: "en", term, normalizedTerm, createdAt}`。
- `Example = {id, entryId, videoId: VideoId, videoTitle, sentenceEn, sentenceZh, startMs, translationStatus, createdAt}`。
- 初始 entries/examples 为空；每个 Example 恰属一个 Entry；Entry 至少有一个 Example。
- `(language, normalizedTerm)` 唯一；`(entryId, videoId, startMs)` 唯一。两个唯一约束及新增/级联删除在 IndexedDB 事务内维护。
- 词形归一化：NFKC、弯引号转直引号、trim、转小写；没有词干化、词义推断或跨词形合并。
- `translationStatus ∈ pending | ready | failed`。原文快照独立持久化，不依赖字幕缓存存续。

## actions

下列命名参数对应 service 的参数名；`input` 保持对象整体，不展开为虚构的参数。

```text
capture [input: Capture] => [entryId: string; example: Example; duplicate: boolean]
  requires input 是合法英文整词，且该整词存在于 sentenceEn；videoId 为 11 位合法 ID；
           sentenceEn 非空且 ≤4000 字符；startMs 为 0..604800000 的安全整数。
  ensures 按归一化词取得或新建 Entry，再按来源唯一键保存快照；重复来源返回 duplicate=true。
          重复来源保留既有原文；仅在旧译文为空且新输入有译文时补入译文。
          新快照有译文为 ready，否则 pending；不调用模型。
capture [input: Capture] => [error: Error]
  requires 上述校验失败，或存储事务失败。
  ensures 校验失败不写入；事务失败回滚该事务；错误以异常拒绝。
list [] => [cards: Card[]]
  ensures 只读；词卡按创建时间倒序，例句按创建时间倒序、同时间按 id 倒序；无记录返回 []。
example [id: string] => [example: Example | undefined]
  ensures 只读，最多一条；不存在为 undefined。
completeTranslation [id: string; text: string] => [updated: boolean]
  ensures 不存在返回 false 且不新增；已有非空译文返回 true 且不改写；
          其余情况将 trim 后最多 8000 字符写入，非空为 ready、空为 failed，返回 true。
removeEntry [id: string] => []
  ensures 原子删除该词及所有例句；不存在时无操作。
removeExample [id: string] => []
  ensures 原子删除该例句；最后一条例句删除时一并删除词；不存在时无操作。
clear [] => []
  ensures 原子清空两个集合。
```

`Capture` 字段及约束以 [entry.ts](src/domain/entry.ts) 为证据；未单列的仓储 I/O 异常均为拒绝，不保证调用成功。

## operational principle

先 `capture [input: 编程教程中的 approach]`，再 `capture [input: 访谈中的 approach]`；
`list []` 返回一张词卡、两份独立来源快照。即使视频缓存被外部清除，这两份快照仍可读取。
回到视频的 UI 行为属于 [同步规格](../../modules/syncs/SYNCS.md)，时间精度是片段级。

## evidence

- 契约入口：[service.ts](src/application/service.ts)；原子性、去重、删除及迟到译文：[dexie.ts](src/adapters/dexie.ts)。
- 验证：[storage tests](../../../tests/integration/vocabulary-storage.test.mjs)、[application tests](../../../tests/integration/vocabulary.test.mjs)。
- 范围：只收藏用户明确保存的出现位置；没有自动搜集所有视频、云同步、复习算法或视频剪辑。
