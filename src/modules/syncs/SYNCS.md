# app YouTubeScaffold

实现回填：本文件描述现有 mediator、页面及浏览器入口的协调；用途由 README 场景归纳。
`when/where/then` 是说明性 Jackson 记法，不是已部署的同步引擎；没有新增事件总线。
动作结果字段用于区分成功、普通缺失和失败；JS 的单值结果用一个命名字段表达。

```text
include Reading [VideoId] from ../../features/reading/CONCEPT.md
include Vocabulary [VideoId] from ../../features/vocabulary/CONCEPT.md
include Translation [VideoId] from ../../features/translation/CONCEPT.md
include Summary [VideoId] from ../../features/summary/CONCEPT.md
include Explanation from ../../features/explanation/CONCEPT.md
include Collection [VideoId] from ../../features/collection/CONCEPT.md
include Export [VideoId] from ../../features/export/CONCEPT.md
include Configuration from ../infrastructure/CONCEPT.md
include Gateway from #external-entry-contracts
include View from #external-entry-contracts
```

`VideoId = string`；各概念保留自己的入参约束，不以实例化放宽校验。
Material/Caption/Analysis/Note/Input 类型见 [shared](../shared/src/index.ts)；词卡类型见 [entry](../../features/vocabulary/src/domain/entry.ts)。

## external-entry-contracts

| 外部动作 | 输入 → 完成输出及实现含义 |
| --- | --- |
| `Gateway/request` | `[message: RemoteMessage; context: {trusted,sourceUrl?}] => [request: string; message; epoch: number; admitted: true]`，表示 dispatch 的校验、execution.enter 和调用前 epoch 检查都通过，之后才可调所有者。request 来自 __ys_requestId 或 UUID；message 内补入此 ID |
| `Gateway/respond` | `[request: string; value: unknown] => []`，兑现该 dispatch 的 Promise；不是发给任意标签页。失败响应同样走此出口 |
| `Gateway/notify` | `[message: Record<string,unknown>] => []`，调用注入通知端口；worker 的广播失败会被忽略，不保证页面收到 |
| `View/captureCompleted` | `[request: string] => [example: Example]`，页面 facade 的 capture 已成功且 refreshVocabulary 已完成 |
| `View/requestTranslation` | `[id: string] => []`，页面发新 vocabularyTranslate 请求；同例句页面内与 worker 内各有在途合并 |
| `View/resetConfirmed` | `[] => [confirmed: true]`，设置页 confirm 同意后执行；取消为 confirmed=false，后续无动作 |
| `View/workerReset` | `[] => [success: true]` 或 `[error: Error]`，api.reset 的完成；只有成功才能清导出配置 |
| `View/refreshSettings` | `[] => []`，保存当前界面语言，重载设置与导出配置并显示完成；失败由页面处理，后台已完成清理不回滚 |
| `View/playExample` | `[example: Example] => [selected: true; example]`，点击来源按钮，冻结例句来源 |
| `View/returnToVideo` | `[videoId: VideoId; seconds: number] => []`，映射到现有 ctx.playNote({videoId,timestampSeconds:seconds,timestampedUrl:标准带整秒时间的来源URL})；当前视频 seek，跨视频在新标签打开来源；不是生成剪辑 |

以上入口是对实际调用点的命名，**没有**一个额外的 Gateway/request 事件被持久化。
不存在独立的计时器业务流；Supadata 轮询属于 Reading 源适配器，浏览器标签页事件属于 Gateway 技术装配。

## admission, correlation and failure

证据：[dispatch/apply](src/index.ts)、[worker](../gateway/src/worker.js)、[assembly](../../apps/extension/src/platform.ts)。

1. worker 拒绝不同扩展 sender.id；精确扩展 URL 前缀作为 trusted。带 sender.tab 的不可信上下文只允许 saveNote/openSidePanel/checkConfig。
2. dispatch 的 trustedOnly 白名单限制词本、配置、缓存、摘要/翻译/解释、笔记列表与删除等；非法 message 拒绝。来自网页的 saveNote 还要匹配 YouTube origin 与 URL 的 v。
3. 校验失败即返回 success=false，不进入所有者。有效请求在 inFlight 里按 requestId 合并。
4. execution.enter 以 requestId 保存 started；已见 ID 返回 `success=false, code=REPLAY_SUPPRESSED`。仅保留最近 250 条，清 reset 会删除；不是永久 exactly-once。
5. vocabularyCapture/removeEntry/removeExample、cacheWrite/evict/clear、resetData 共用实例 mutationQueue 串行；读取、AI 请求、笔记操作不在该队列。
6. 同一 flow 由 requestId 关联；视频操作另以 videoId，补译另以 example.id 绑定。表中顺序是 await 顺序，同一 then 多个调用没有默认顺序。
7. 成功/普通失败通过 Gateway/respond 返回；抛错由 dispatch 转成 `{success:false,error}`，execution.finish 标 failed；正常结果依 success===false 判定 phase。
8. 旧 epoch 请求在执行前/执行后拒绝；这不撤销已完成写入。reset 在进入 apply 时递增 epoch。
9. 单个 I/O 操作可抛错；执行账本本身 enter/finish 失败可能导致拒绝或不完整记录。没有分布式事务、外部请求补偿或自动恢复队列。
10. 执行后的 epoch 拒绝在 finish 之前返回，记录可能保持 started；reset 也可能已删掉记录。不能把 started 推断为操作绝未发生。

## route coverage

以下每行是 `Gateway/request(admitted=true, message.action=入口)` 后的完整调用/返回顺序速记；
`m` 是已绑定 message。只读方法也返回完成值。未特别注明时，返回所有者的原始结果；表中后续操作只在前一 await 成功后发生。
任意异常遵循上节；同一行并不意味着跨所有者原子提交。

| message.action | 所有者调用及参数绑定 | 完成/分支 |
| --- | --- | --- |
| vocabularyList | Vocabulary/list[] | `{success:true,cards}`，空为 [] |
| vocabularyCapture | Vocabulary/capture[input:m.input] | `{success:true,...result}`，然后 vocabularyChanged 通知；不等待补译 |
| vocabularyRemoveEntry | Vocabulary/removeEntry[id:String(m.id)] | 完成后通知，返回 success=true |
| vocabularyRemoveExample | Vocabulary/removeExample[id:String(m.id)] | 完成后通知，返回 success=true |
| vocabularyTranslate | Vocabulary/example[id:String(m.id)]；需要时 Translation/translate；Vocabulary/completeTranslation | 见补译规则；缺失/已有译文返回 success=true |
| fetchTranscript | Reading/load[id:String(m.videoId或空串)] | 原始结果 |
| checkConfig | Configuration/read[] | 只返回 hasSupadataKey/hasAiKey 两个 boolean，不返回 Key |
| analyzeTranscript | Summary/analyze[input:{...m,videoId:String(m.videoId或空串),transcriptText:String(m.transcriptText或空串)}] | success=true 且 epoch 未变才 Summary/save[id:String(m.videoId),analysis]；返回分析结果 |
| translateContent | Translation/translate[input:m] | 原始结果；不自动持久化 |
| explainSelection | Explanation/explain[input:m] | 原始结果 |
| saveNote | Collection/saveExact 或 Reading/load 后 Collection/saveMoment | 见摘录规则；成功后 noteSaved 通知 |
| getNotes | Collection/list[videoId:m.videoId] | 原始结果 |
| deleteNote | Collection/delete[noteId:String(m.noteId)] | 原始结果 |
| clearNotes | Collection/clear[] | success=true，不清词本 |
| cacheRead | Reading/read[id:String(m.videoId)]，非空再并行 Summary/read 与 Translation/read | `{success:true,value:null或组合快照}`；读取不触发模型 |
| cacheWrite | Reading/save[id:String(m.videoId),value:m.value] → Summary/save[id,analysis:m.value.analysis] → Translation/save[id,value:m.value] → Reading/evict[max:20] → 并行 Summary/remove 与 Translation/remove | 全部完成返回 success=true；中途失败可能留下部分写入 |
| cacheEvict | Reading/evict[max:Number(m.max)或20] → 并行 Summary/remove[ids]、Translation/remove[ids] | success=true；不删除笔记/词本 |
| cacheClear | Reading/clear[] → 并行 Summary/clear[]、Translation/clear[] | `{success:true,count}`；count 仅字幕材料键数 |
| viewGet | Reading/viewStorage.get[key:m.key] | `{success:true,value}` |
| viewSet | Reading/viewStorage.set[values:m.value] | success=true |
| configurationGet | keys=null 取两个白名单；数组原样，否则包成数组；逐键 readRaw 或 language | `{success:true,value:{key:值}}`；未知键抛错 |
| configurationSet | 遍历 m.value；ytd_settings 调 save[input:value]；ytd_options_language 调 setLanguage[value] | success=true；未知键抛错，已完成键不回滚 |
| configurationRemove | 无所有者调用 | 明确拒绝：Use the named owner clear/reset operation |
| testConnection | Configuration/testConnection[provider:String(m.provider或空串),apiKey:String(m.apiKey或空串)] | 原始结果 |
| resetData | epoch++；clearCache 与 Collection/clear、Vocabulary/clear、Reading/resetView、Configuration/reset 并行；再 execution.clear；再 dataReset 通知 | success=true；不直接清 Export |

未知 action 返回 success=false/Unknown action。worker 单独处理 openOptions/openSidePanel/getVideoInfo/relayToContent；
它们不进入本 route 表，分别是导航、面板控制、页面元数据和消息转发，不伪造为概念。
relayToContent 校验实际目标 origin 与 expectedVideoId，再转发；失败返回 success=false，getVideoInfo 优先播放器元数据。

## capture-vocabulary

// flow: capture-vocabulary

```text
sync CaptureVocabulary
when { Gateway/request: [] => [message: ?m; admitted: true] }
where { ?m.action = "vocabularyCapture"; ?input = ?m.input }
then { Vocabulary/capture: [input: ?input] }

sync EnrichCapturedExample
when { View/captureCompleted: [] => [example: ?example] }
where { ?example.sentenceZh = ""; ?id = ?example.id }
then { View/requestTranslation: [id: ?id] }
```

capture 后，worker 返回的是已持久化快照；页面 refresh 成功后才 fire-and-forget 补译。
已有译文时 where 零条，不发模型请求。refresh 失败可能延后补译，但不会撤销已保存原文。

## enrich-vocabulary

// flow: enrich-vocabulary

```text
sync ReadExampleForTranslation
when { Gateway/request: [] => [message: ?m; admitted: true] }
where { ?m.action = "vocabularyTranslate"; ?id = String(?m.id) }
then { Vocabulary/example: [id: ?id] }

sync TranslateExistingExample
when { Vocabulary/example: [id: ?id] => [example: ?example] }
where {
  ?example != undefined; ?example.sentenceZh = ""
  ?input = {content: {segments: [{id: "vocabulary", text: ?example.sentenceEn}]},
            contentType: "transcriptBatch", targetLanguage: "zh", videoTitle: ?example.videoTitle}
}
then { Translation/translate: [input: ?input] }

sync CompleteExampleTranslation
when {
  Vocabulary/example: [id: ?id] => [example: ?example]
  Translation/translate: [] => [success: true; translatedContent: ?translated]
}
where {
  ?example != undefined
  ?text = ?translated.segments 中 id="vocabulary" 的首个段落的 text，缺失则 ""
}
then { Vocabulary/completeTranslation: [id: ?id; text: ?text] }

sync FailExampleTranslation
when {
  Vocabulary/example: [id: ?id] => [example: ?example]
  Translation/translate: [] => [success: false; error: ?error]
}
where { ?example != undefined }
then { Vocabulary/completeTranslation: [id: ?id; text: ""] }
```

两条 completion 合取规则属于同一例句的同一次在途补译，不能仅凭相同 action 名跨请求拼接。
每个 id 同时只发一份 Translation 请求；已有操作的请求等待同一个 Promise。
例句不存在或已有译文：零次 translate，直接 success=true；模型抛异常与普通翻译失败一样写空译文。
completeTranslation 返回 false（等待期间已删除）也不重建记录；无论 true/false 都通知 vocabularyChanged，
返回 `{success:true,translated:!!text}`。translated 表示本次取得文本，不证明该例句最终仍存在。
翻译失败保留原文并可发新的显式请求重试；无自动无限重试。

## capture-note

// flow: capture-note

```text
sync SaveExactSelection
when { Gateway/request: [] => [request: ?request; message: ?m; admitted: true] }
where {
  ?m.action = "saveNote"; typeof ?m.selectedText = "string"; trim(?m.selectedText) != ""
  ?input = NoteInput(?m, operationId=?request)
}
then { Collection/saveExact: [input: ?input] }

sync LoadForMoment
when { Gateway/request: [] => [message: ?m; admitted: true] }
where { ?m.action = "saveNote"; 非非空字符串选区; ?id = String(?m.videoId或空串) }
then { Reading/load: [id: ?id] }

sync SaveLoadedMoment
when {
  Gateway/request: [] => [request: ?request; message: ?m; epoch: ?epoch; admitted: true]
  Reading/load: [id: ?id] => [success: true; transcript: ?transcript]
}
where {
  ?m.action = "saveNote"; ?id = String(?m.videoId或空串); epoch仍等于?epoch
  ?input = NoteInput(?m, operationId=?request)
}
then { Collection/saveMoment: [input: ?input; transcript: ?transcript] }
```

`NoteInput(m,operationId)` 的绑定为 videoId=String(m.videoId或空串)、timestamp=Number(m.timestamp)、
videoTitle/channelName/selectedText 原样传递、operationId=request。精确摘录路线完全跳过 Reading 与模型。
load 失败返回 `success:false,error:"Could not fetch transcript",message`；世代已变返回 Data was reset during capture。
saveExact/saveMoment 成功才通知 noteSaved（含 note）；普通失败直接返回，不发成功通知。

## summary

// flow: summary

```text
sync SaveSuccessfulAnalysis
when {
  Gateway/request: [] => [message: ?m; epoch: ?epoch; admitted: true]
  Summary/analyze: [] => [success: true; analysis: ?analysis]
}
where { ?m.action = "analyzeTranscript"; epoch仍等于?epoch; ?id = String(?m.videoId) }
then { Summary/save: [id: ?id; analysis: ?analysis] }
```

分析本身的入参及返回见 route 表。success=false 不保存；保存异常转成失败响应。epoch 变化时不保存，并由 dispatch 最终检查返回失败。

## cache

// flow: cache

```text
sync RemoveEvictedDerivatives
when { Reading/evict: [] => [ids: ?ids] }
then { Summary/remove: [ids: ?ids]; Translation/remove: [ids: ?ids] }

sync ClearDerivativesAfterMaterial
when { Reading/clear: [] => [count: ?count] }
then { Summary/clear: []; Translation/clear: [] }
```

这里只对 route 表列出的 cache/reset 调用因果实例启用；测试或本地工具直接调用 Reading/clear 不会自动发同步。
ids 为零个时仍调用 remove([])，无删除效果；N 个 ID 作为同一个数组传入，**不是**任取第一个。
cacheWrite 各保存动作的完整顺序以 route 表为准；Reading/save 的成功返回不是整个组合缓存写成功。

## reset

// flow: reset

```text
sync ResetExportAfterWorker
when { View/workerReset: [] => [success: true] }
then { Export/reset: [] }

sync RefreshAfterExportReset
when {
  View/workerReset: [] => [success: true]
  Export/reset: [] => [success: true]
}
then { View/refreshSettings: [] }
```

View/resetConfirmed confirmed=true 后调用 View/workerReset；取消零调用。
后台 reset 的具体动作见 route 表；导出配置仅由设置页后续 reset 清理，直接调用后台 resetData 不会清 Export。
设置页随后恢复当前界面语言，因此完成后的界面语言不保证是默认 en。
各 owner 清理是并行、无跨库事务：一个失败不能撤销其余清理，失败时不显示整套流程成功；需用户重试。

## replay-source

// flow: replay-source

```text
sync ReplaySource
when { View/playExample: [] => [selected: true; example: ?example] }
where { ?videoId = ?example.videoId; ?seconds = ?example.startMs / 1000 }
then { View/returnToVideo: [videoId: ?videoId; seconds: ?seconds] }
```

一份快照只绑定一个视频与片段起点；同视频 seek 传入小数秒，跨视频 URL 的 t 取整秒。
无快照就没有本规则触发。没有片段终点、自动停止或循环播放承诺。

## view-local composition and observed limits

- Export 的 readConfig/chooseDirectory/setSections/saveStudy 在扩展页直接调用；目录 picker 必须在手势内执行，不能先 await worker。saveStudy 的 loadNotes 回调通过 facade 取 getNotes，只有 notes 开启时才取。
- **已知耦合**：loadNotes 回调在 Export 内被调用，虽然没有跨功能 import，但严格“概念完全不感知外部行为”的独立性尚未得到证明；本次只回填，不重构此接口。
- 页面持有本地纯 Reading/Translation 工具；持久化字幕、词本、笔记与服务配置走 worker。Export 的目录存储是明确例外。
- **待修方向**：缓存多所有者写入/删除及整体重置没有事务补偿；Reading/read 的过期删除不主动清摘要/译文；重放账本有 250 条窗口且 reset 清空；epoch 检查不是所有异步 I/O 的原子取消屏障。
- trace 仅记录部分 emittedCalls，不能视为完整同步事件日志，也不能用 trace 覆盖率证明语义正确。
- 目前没有发现业务 feature 互相 import；这只证明静态边界，不等于组合满足所有产品目的。

## evidence

- [mediator](src/index.ts)、[platform](../../apps/extension/src/platform.ts)、[worker](../gateway/src/worker.js)、[panel](../gateway/src/panel.js)。
- [vocabulary view](../../features/vocabulary/src/presentation/index.ts)、[options](../gateway/src/options.js)。
- [application tests](../../../tests/integration/application.test.mjs)、[vocabulary tests](../../../tests/integration/vocabulary.test.mjs)、[export tests](../../../tests/unit/export.test.mjs)。
