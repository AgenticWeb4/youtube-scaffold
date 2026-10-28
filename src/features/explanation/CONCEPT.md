# concept Explanation

## purpose

解释阅读时选中的文字在当前视频语境中的含义。用途从选区解释场景归纳。

## state

无持久化业务状态；一次请求的文本与结果为临时值，不建立解释历史。

## actions

```text
explain [input: {selectedText: string; transcriptContext: string; videoTitle: string}]
  => [success: true; explanation: string]
  requires selectedText trim 后非空、已配置模型且模型请求成功。
  ensures 以原选区、上下文及标题请求解释，返回 trim 后文本，不写业务存储。
explain [input: {selectedText: string; transcriptContext: string; videoTitle: string}]
  => [success: false; error: string; message?: string]
  requires 选区为空、缺 Key，或模型请求失败。
  ensures 返回失败，不写业务存储。
```

当前代码不对成功返回的解释额外做非空断言；空模型文本仍可能 success=true。
接口按上述字符串类型调用；不把类型外输入的运行时行为作为新承诺。

## operational principle

对某个片段调用 `explain [input: {selectedText, transcriptContext, videoTitle}]`，
得到与该选区关联的解释；读者可继续阅读，解释请求不改变字幕或收藏。

## evidence

[service.ts](src/application/service.ts)、[model.js](src/adapters/model.js)、[tests](../../../tests/unit/explanation.test.mjs)。
