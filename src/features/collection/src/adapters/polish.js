// Derived from YouTube Digest (MIT); see LICENSE and NOTICE.
export function createPolisher(ports) {
  const getSettings = ports.getSettings;
  const requestAiCompletion = ports.request;
  const loadPromptSection = ports.prompt;
  const debugLog = () => {};

  function parseLooseJson(text) {
    let cleaned = (text || "").trim();

    // Strip ```json ... ``` style code fences
    if (cleaned.startsWith("```")) {
      cleaned = cleaned
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/```\s*$/i, "");
    }

    // Isolate the outermost { ... } in case the model added a sentence around it
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      cleaned = cleaned.slice(firstBrace, lastBrace + 1);
    }

    try {
      return JSON.parse(cleaned);
    } catch (firstError) {
      // Most common LLM slip: a trailing comma right before a } or ].
      // e.g. ["a", "b", ]  ->  ["a", "b" ]
      const repaired = cleaned.replace(/,(\s*[}\]])/g, "$1");
      return JSON.parse(repaired);
    }
  }

  async function cleanupNoteText(
    targetText,
    beforeText,
    afterText,
    fullContext,
    videoTitle,
  ) {
    const settings = await getSettings();
    if (!settings.aiApiKey) {
      return [beforeText, targetText, afterText].filter(Boolean).join(" ");
    }

    try {
      debugLog("[YouTube Scaffold] Requesting note cleanup");
      const variables = {
        videoTitle: videoTitle || "Unknown",
        fullContext,
        beforeText: beforeText || "(none)",
        targetText,
        afterText: afterText || "(none)",
      };
      const systemPrompt = await loadPromptSection(
        "note-cleanup.md",
        "System prompt",
        variables,
      );
      const userPrompt = await loadPromptSection(
        "note-cleanup.md",
        "User prompt",
        variables,
      );
      const { text: resultText } = await requestAiCompletion({
        maxTokens: 512,
        responseFormat: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      });

      let result = resultText.trim() || targetText;

      // Parse the JSON response (tolerating trailing commas / fences).
      try {
        const parsed = parseLooseJson(result);
        if (typeof parsed.quote === "string" && parsed.quote.trim()) {
          return parsed.quote.trim().slice(0, 3000);
        }
      } catch (parseError) {
        console.warn(
          "[YouTube Scaffold] JSON parse failed for note, stripping preambles:",
          parseError,
        );
        result = result.replace(
          /^(Here'?s?( the)?( cleaned)?( version)?:?\s*)/i,
          "",
        );
        result = result.replace(
          /^(The cleaned (quote|text|version)( is)?:?\s*)/i,
          "",
        );
        result = result.replace(/^(I will.*?:?\s*)/i, "");
        result = result.replace(/^(Cleaned:?\s*)/i, "");
        result = result.replace(/^["']|["']$/g, "");
      }

      return result.slice(0, 3000);
    } catch (e) {
      console.error("[YouTube Scaffold] Cleanup error:", e);
    }

    // Return combined raw text if cleanup fails
    return [beforeText, targetText, afterText].filter(Boolean).join(" ");
  }
  return cleanupNoteText;
}
