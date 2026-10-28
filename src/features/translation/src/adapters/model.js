// Derived from YouTube Digest (MIT); see LICENSE and NOTICE.
export function createTranslationModel(ports) {
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

  async function getTranslationBaseRules(targetLanguage) {
    if (targetLanguage !== "zh") {
      throw new Error(`Unsupported translation target: ${targetLanguage}`);
    }
    const langName = "Simplified Chinese";
    const langSpecific = await loadPromptSection(
      "translation.md",
      "Chinese rules",
    );
    return loadPromptSection("translation.md", "Shared base rules", {
      langName,
      langSpecific,
    });
  }

  function validateTranscriptBatchRequest(content) {
    const segments = content?.segments;
    if (
      !Array.isArray(segments) ||
      segments.length < 1 ||
      segments.length > 4
    ) {
      throw new Error("Transcript translation requires 1 to 4 segments");
    }

    const seenIds = new Set();
    let totalCharacters = 0;
    const normalized = segments.map((segment) => {
      const id = typeof segment?.id === "string" ? segment.id.trim() : "";
      const text = typeof segment?.text === "string" ? segment.text.trim() : "";
      if (!/^[A-Za-z0-9:_-]{1,128}$/.test(id) || seenIds.has(id)) {
        throw new Error(
          "Transcript translation segment IDs must be unique and stable",
        );
      }
      if (!text || text.length > 4000) {
        throw new Error(
          "Transcript translation segment text is invalid or too long",
        );
      }
      seenIds.add(id);
      totalCharacters += text.length;
      return { id, text };
    });
    if (totalCharacters > 12000) {
      throw new Error("Transcript translation batch is too large");
    }
    return normalized;
  }

  function looksLikeChineseTranslation(text, sourceText) {
    const latinLetters = (sourceText.match(/[A-Za-z]/g) || []).length;
    if (latinLetters < 20) return true;
    return /[\u3400-\u9fff]/.test(text);
  }

  function normalizeTranslatedSegmentBatch(parsed, sourceSegments) {
    const candidates = Array.isArray(parsed?.segments) ? parsed.segments : [];
    const sourceById = new Map(
      sourceSegments.map((segment) => [segment.id, segment]),
    );
    const translatedById = new Map();

    candidates.forEach((candidate) => {
      if (
        typeof candidate?.id !== "string" ||
        typeof candidate?.text !== "string" ||
        !sourceById.has(candidate.id) ||
        translatedById.has(candidate.id)
      ) {
        return;
      }
      const text = candidate.text.trim();
      const source = sourceById.get(candidate.id);
      if (text && looksLikeChineseTranslation(text, source.text)) {
        translatedById.set(candidate.id, text);
      }
    });

    return {
      segments: sourceSegments.map((source) => ({
        id: source.id,
        text: translatedById.get(source.id) || "",
        error: translatedById.has(source.id)
          ? ""
          : "Missing or invalid Chinese translation",
      })),
    };
  }

  async function handleTranslateContent(
    content,
    contentType,
    targetLanguage,
    videoTitle,
  ) {
    try {
      if (targetLanguage !== "zh") {
        return {
          success: false,
          error: `Unsupported translation target: ${String(targetLanguage)}`,
        };
      }
      if (!["transcriptBatch", "interfaceBatch"].includes(contentType)) {
        return {
          success: false,
          error: `Unsupported translation content type: ${String(contentType)}`,
        };
      }

      const settings = await getSettings();
      if (!settings.aiApiKey) {
        return { success: false, error: "DeepSeek API key not configured" };
      }

      const sourceSegments = validateTranscriptBatchRequest(content);
      const langName = "Simplified Chinese";
      const baseRules = await getTranslationBaseRules(targetLanguage);
      const promptSection =
        contentType === "transcriptBatch"
          ? "Transcript batch translation"
          : "Interface content translation";
      const systemPrompt = await loadPromptSection(
        "translation.md",
        promptSection,
        {
          langName,
          videoTitle: videoTitle || "Unknown",
          baseRules,
        },
      );
      const userContent = JSON.stringify({ segments: sourceSegments });
      const translationOptions = {
        temperature: 0.2,
        maxTokens: 1536,
        responseFormat: { type: "json_object" },
      };
      let result = await callAiTranslation(
        systemPrompt,
        userContent,
        translationOptions,
      );

      // DeepSeek JSON mode can rarely return an empty content string. The prompt
      // already requires JSON, so retry once without response_format.
      if (!result.success && result.code === "EMPTY_AI_RESPONSE") {
        result = await callAiTranslation(systemPrompt, userContent, {
          temperature: translationOptions.temperature,
          maxTokens: translationOptions.maxTokens,
        });
      }
      if (!result.success) return result;

      const parsed = parseLooseJson(result.text);
      const aligned = normalizeTranslatedSegmentBatch(parsed, sourceSegments);
      if (!aligned.segments.some((segment) => segment.text)) {
        return {
          success: false,
          error: "Translation returned no valid Chinese segments",
        };
      }
      return { success: true, translatedContent: aligned };
    } catch (error) {
      console.error("[YouTube Scaffold] Translation error:", error);
      return { success: false, error: error.message || "Translation failed" };
    }
  }

  async function callAiTranslation(
    systemPrompt,
    userContent,
    { temperature = 0.3, maxTokens = 8192, responseFormat } = {},
  ) {
    try {
      const { text } = await requestAiCompletion({
        temperature,
        maxTokens,
        responseFormat,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
      });

      return { success: true, text };
    } catch (error) {
      if (error.status === 429) {
        return {
          success: false,
          error: "Rate limited — try again in a moment",
          code: "RATE_LIMITED",
        };
      }
      return { success: false, error: error.message, code: error.code };
    }
  }
  return {
    translate: handleTranslateContent,
    validate: validateTranscriptBatchRequest,
    normalize: normalizeTranslatedSegmentBatch,
  };
}
