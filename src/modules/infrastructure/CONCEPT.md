# concept Configuration

## purpose

保留用户选择的服务凭证和界面语言，并允许在保存前检查凭证能否连接服务。用途从设置页面归纳。

## state

- `settings: Config?` 对应 ytd_settings；初始无记录；`read` 归一化成固定 DeepSeek provider/base URL/model 和两个空 Key 的默认配置。
- `optionsLanguage: "en" | "zh-CN"` 对应 ytd_options_language；缺失默认为 en。
- Config 字段为 provider/aiApiKey/aiBaseUrl/aiModel/supadataApiKey；Key 存本机，不写日志或规格。
- 本文件只定义 Configuration；同目录的存储、HTTP、prompt 适配器不是额外业务概念。

## actions

```text
read [] => [config: Config]
  ensures 只读，返回固定服务配置与归一化 Key；历史 custom provider 的 aiApiKey 被忽略。
readRaw [] => [value: Record<string,unknown> | undefined]
  ensures 只读，返回原始 settings；缺失为 undefined。
save [input: unknown] => [config: Config]
  ensures normalize 后保存并返回；固定 provider/base URL/model，Key trim；不接纳任意远端地址。
language [] => [value: unknown]
  ensures 返回存储中的 truthy 值，缺失/假值为 en；不承诺清洗历史非法值。
setLanguage [value: unknown] => []
  ensures 仅 zh-CN 原样保存，其余归一化 en。
reset [] => []
  ensures 删除 settings 与 optionsLanguage，不清理其他所有者的数据。
testConnection [provider: string; apiKey: string]
  => [success: boolean; provider: string; code: string; status?: number]
  ensures 仅支持 deepseek/supadata，分别 GET 固定 /models 与 /v1/me；丢弃响应 body；
          使用本次入参的 Key，不保存、不生成文本；拒绝重定向；默认15秒超时。
          code 为 CONNECTED / UNKNOWN_PROVIDER / NO_KEY / AUTH_FAILED / RATE_LIMITED /
          HTTP_ERROR / TIMEOUT / NETWORK_ERROR；有 HTTP 响应时带 status。
```

存储失败可拒绝，`save` 不负责交易式验证服务可用性；testConnection 不改变本概念状态。
非秘密纯工具 `api` 暴露 DEFAULTS、normalize、migrateLegacyCustom、chatCompletionsUrl、canonicalYouTubeUrl；
其实现与 URL 校验见 [configuration.js](src/configuration.js)，不是跨概念协调动作。

## operational principle

以未保存的 Key 调用 `testConnection` 获得结果，不改变旧配置；读者决定 `save` 后，`read` 才返回新 Key。

## evidence

[index.ts](src/index.ts)、[connection.ts](src/connection.ts)、[configuration tests](../../../tests/integration/configuration.test.mjs)。
本概念由工作线程装配并通过 [SYNCS](../syncs/SYNCS.md) 限制可访问的键。
