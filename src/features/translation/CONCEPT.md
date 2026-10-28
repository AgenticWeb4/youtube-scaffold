# concept Translation [VideoId]

## purpose

把带稳定 ID 的文本片段译为中文，并保留原文与译文的对应关系。用途从分段翻译与双语视图归纳。

## state

`cache: VideoId -> {paragraphCache: Map<string,string>, interfaceCache: Map<string,string>}`。
初始无记录；读取缺失记录视为空映射；仅拥有译文缓存，不拥有原文。

## actions

```text
translate [input: {content, contentType, targetLanguage, videoTitle}]
  => [success: true; translatedContent: {segments: {id, text, error}[]}]
  requires targetLanguage="zh"；contentType 为 transcriptBatch/interfaceBatch；
           1..4 段，ID 唯一且符合 [A-Za-z0-9:_-]{1,128}；
           每段 trim 后非空且 ≤4000 字符，总计 ≤12000 字符；已配置模型 Key。
  ensures 按源 ID 与顺序重建结果；至少一段有效才成功；缺失/无效段 text="" 且有 error；不自动持久化。
translate [input: {content, contentType, targetLanguage, videoTitle}]
  => [success: false; error: string; code?: string]
  requires 入参/配置不满足要求、模型请求/解析失败，或没有任何有效译文。
  ensures 不写缓存；空模型响应仅按适配器规则去掉 JSON 模式重试一次，不无限重试。
align [source: {id,text}[]; result: unknown] => [segments: {id,text,error}[]]
  ensures 只按 ID 对齐；重复 ID 取第一个非空值；源中缺失的结果显式标错；不按数组位置猜配。
read [id: VideoId] => [cache: {paragraphCache, interfaceCache}]
  ensures 只读，缺失返回两个空对象。
save [id: VideoId; value: {paragraphCache?: unknown; interfaceCache?: unknown}]
  => [success: true]
  ensures 仅合并 string 值，保留未覆盖键；不校验内容是否真的为译文。
remove [ids: VideoId[]] => [success: true]
  ensures 删除对应视频译文记录；缺失项无操作。
clear [] => [success: true]
  ensures 删除全部本概念缓存；不取消已发出的网络请求。
validate [content: unknown] => [segments: {id,text}[]]
  ensures 执行 translate 的批次校验；非法抛 Error；只读。
normalize [parsed: unknown; sourceSegments: {id,text}[]] => [value: {segments: {id,text,error}[]}]
  ensures 过滤未知/重复 ID、空译文和适配器识别的非中文结果；只读。
```

I/O 存储错误可抛出；模型适配器将通常的翻译错误返回为 success=false。

## operational principle

`translate` 接收 ID 为 a/b 的两段；模型即使返回 b/a，结果仍按 a/b 对齐。
只有 a 有有效译文时，a 可显示中文，b 保留明确失败状态供重试；原文不会被覆盖。

## evidence

[service.ts](src/application/service.ts)、[model.js](src/adapters/model.js)、[alignment.js](src/domain/alignment.js)、[tests](../../../tests/unit/translation.test.mjs)。
缓存何时保存、如何与阅读缓存联动，见 [SYNCS](../../modules/syncs/SYNCS.md)。
