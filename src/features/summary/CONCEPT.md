# concept Summary [VideoId]

## purpose

提供带视频时间锚点的内容概览，帮助学习者找到章节与重点。用途从概览交互归纳。

## state

- `analysis: VideoId -> Analysis?`，初始空；Analysis 含 chapters/keyQuotes/keyMoments。
- 实例内每视频 generation 与清理 epoch 用于拒绝被更新请求取代的模型结果；不是持久化任务队列。

## actions

```text
analyze [input: SummaryInput] => [success: true; analysis: Analysis]
  requires 已配置模型，模型返回可解析结果，且同视频 generation 与 epoch 未变化。
  ensures 结果按 validate 规则清洗；只返回，不保存。
analyze [input: SummaryInput] => [success: false; error: string; message?: string]
  requires 缺 Key、鉴权/限流/网络/解析失败，或被同视频更新请求/clear 取代。
  ensures 不写 analysis；过时结果返回 Superseded summary。
validate [value: unknown; maxSeconds: number] => [analysis: Analysis]
  ensures 只保留合法字段；章节 ≤100、引用 ≤50、重点时间 ≤100；
          丢弃负/非有限/超界时间并取整；章节/引用按时间排序；显示时间由秒数派生。
read [id: VideoId] => [analysis: Analysis | null]
  ensures 只读，缺失返回 null。
save [id: VideoId; analysis: Analysis | null] => [success: true]
  ensures 非空时 validate 后覆盖保存；null 为无操作，不等于删除。
remove [ids: VideoId[]] => [success: true]
  ensures 删除指定记录，缺失项无操作。
clear [] => [success: true]
  ensures epoch 递增、清实例 generation 和全部摘要缓存。
```

SummaryInput = `{videoId: VideoId, transcriptText, videoTitle?, channelName?, videoDescription?, videoDuration?}`。
analyze 的时间上界取视频时长与最后一个字幕时间戳的较大值；非法/非正上界在验证函数中视为最大安全整数。
存储 I/O 异常为拒绝，不保证多个动作原子提交。

## operational principle

`analyze` 得到清洗后的章节与时间，应用决定 `save` 后，`read` 能恢复概览而不重发模型请求。
同视频第二次 analyze 开始后，第一次迟到结果不应成为新的有效分析结果。

## evidence

[service.ts](src/application/service.ts)、[model.js](src/adapters/model.js)、[tests](../../../tests/unit/summary.test.mjs)。
从 analyze 成功到 save 的应用级顺序由 [SYNCS](../../modules/syncs/SYNCS.md) 定义。
