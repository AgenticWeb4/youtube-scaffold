// Derived from YouTube Digest (MIT); see LICENSE and NOTICE.
export function createExplanationModel(ports) {
  const getSettings = ports.getSettings;
  const requestAiCompletion = ports.request;
  const loadPromptSection = ports.prompt;
  const debugLog = () => {};

  async function handleExplainSelection(
    selectedText,
    transcriptContext,
    videoTitle,
  ) {
    try {
      const settings = await getSettings();
      if (!settings.aiApiKey) {
        return {
          success: false,
          error: "NO_AI_KEY",
          message: "DeepSeek API key not configured.",
        };
      }

      const variables = {
        videoTitle: videoTitle || "Unknown",
        selectedText,
        transcriptContext: transcriptContext || "None",
      };
      const systemPrompt = await loadPromptSection(
        "explain.md",
        "System prompt",
        variables,
      );
      const userPrompt = await loadPromptSection(
        "explain.md",
        "User prompt",
        variables,
      );

      debugLog("[YouTube Scaffold] Requesting selection explanation");
      const { text: explanation } = await requestAiCompletion({
        maxTokens: 1024,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      });

      return {
        success: true,
        explanation: explanation.trim(),
      };
    } catch (error) {
      console.error("Explain selection error:", error);
      return {
        success: false,
        error: error.message || "Failed to explain selection",
      };
    }
  }
  return { explain: handleExplainSelection };
}
