// Derived from YouTube Digest (MIT); see LICENSE and NOTICE.
export function createProvider(ports) {
  const AI_PROVIDER_IDLE_TIMEOUT_MS = 50_000;
  const AI_PROVIDER_HARD_TIMEOUT_MS = 120_000;
  const AI_PROVIDER_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
  const getSettings = ports.getSettings;
  const fetch = ports.fetch || globalThis.fetch;
  const setTimeout = ports.setTimeout || globalThis.setTimeout;
  const clearTimeout = ports.clearTimeout || globalThis.clearTimeout;
  const YTD_SETTINGS = {
    chatCompletionsUrl: () => "https://api.deepseek.com/chat/completions",
  };
  async function requestAiCompletion({
    messages,
    maxTokens,
    temperature,
    responseFormat,
  }) {
    const settings = await getSettings();
    if (!settings.aiApiKey) {
      const error = new Error(
        "DeepSeek API key not configured. Open YouTube Scaffold Settings.",
      );
      error.code = "NO_AI_KEY";
      throw error;
    }
    const body = {
      model: settings.aiModel,
      max_tokens: maxTokens,
      messages,
    };
    if (typeof temperature === "number") body.temperature = temperature;
    if (responseFormat) {
      body.response_format = responseFormat;
    }
    // Product features need bounded, predictable latency rather than reasoning traces.
    body.thinking = { type: "disabled" };

    const controller = new AbortController();
    let timeoutKind = "";
    let idleTimeoutId;
    let hardTimeoutId;
    const abortForTimeout = (kind) => {
      if (controller.signal.aborted) return;
      timeoutKind = kind;
      controller.abort();
    };
    const resetIdleTimeout = () => {
      clearTimeout(idleTimeoutId);
      idleTimeoutId = setTimeout(
        () => abortForTimeout("idle"),
        AI_PROVIDER_IDLE_TIMEOUT_MS,
      );
    };

    hardTimeoutId = setTimeout(
      () => abortForTimeout("hard"),
      AI_PROVIDER_HARD_TIMEOUT_MS,
    );
    resetIdleTimeout();
    try {
      const response = await fetch(YTD_SETTINGS.chatCompletionsUrl(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.aiApiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      // Receiving headers proves DeepSeek is still making progress. DeepSeek
      // may then send blank-line body chunks while a non-streaming request queues.
      resetIdleTimeout();

      const data = await readBoundedAiResponse(response, resetIdleTimeout);
      if (!response.ok) {
        const errorData = data && typeof data === "object" ? data : {};
        const error = new Error(
          errorData.error?.message ||
            errorData.message ||
            `DeepSeek error: ${response.status}`,
        );
        error.status = response.status;
        throw error;
      }

      const text = data.choices?.[0]?.message?.content;
      if (typeof text !== "string" || !text.trim()) {
        const error = new Error("DeepSeek returned an empty response.");
        error.code = "EMPTY_AI_RESPONSE";
        throw error;
      }

      return { text, settings };
    } catch (error) {
      if (timeoutKind === "idle") {
        const timeoutError = new Error(
          "DeepSeek request was inactive for 50 seconds. Please Retry.",
        );
        timeoutError.code = "AI_IDLE_TIMEOUT";
        throw timeoutError;
      }
      if (timeoutKind === "hard") {
        const timeoutError = new Error(
          "DeepSeek request exceeded the 120-second limit. Please Retry.",
        );
        timeoutError.code = "AI_HARD_TIMEOUT";
        throw timeoutError;
      }
      throw error;
    } finally {
      clearTimeout(idleTimeoutId);
      clearTimeout(hardTimeoutId);
    }
  }

  async function readBoundedAiResponse(response, onActivity) {
    const reader = response.body?.getReader?.();
    if (reader) {
      const decoder = new TextDecoder();
      let responseText = "";
      let responseBytes = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        // Every received chunk is activity, including DeepSeek's blank lines.
        onActivity();
        const byteLength = value?.byteLength ?? 0;
        responseBytes += byteLength;
        if (responseBytes > AI_PROVIDER_MAX_RESPONSE_BYTES) {
          await reader.cancel?.().catch(() => {});
          const error = new Error(
            "DeepSeek response exceeded the 2 MiB limit.",
          );
          error.code = "AI_RESPONSE_TOO_LARGE";
          throw error;
        }
        responseText += decoder.decode(value, { stream: true });
      }
      responseText += decoder.decode();
      return JSON.parse(responseText.trimStart());
    }

    // Some fetch implementations do not expose a readable stream. Preserve a
    // bounded body read for that case.
    if (typeof response.text === "function") {
      const responseText = await response.text();
      onActivity();
      const byteLength = new TextEncoder().encode(responseText).byteLength;
      if (byteLength > AI_PROVIDER_MAX_RESPONSE_BYTES) {
        const error = new Error("DeepSeek response exceeded the 2 MiB limit.");
        error.code = "AI_RESPONSE_TOO_LARGE";
        throw error;
      }
      return JSON.parse(responseText.trimStart());
    }

    // Legacy/test fetch shims may expose only json(). The hard and idle timers
    // still bound this fallback even though chunk-level activity is unavailable.
    const data = await response.json();
    onActivity();
    return data;
  }
  return { request: requestAiCompletion };
}
