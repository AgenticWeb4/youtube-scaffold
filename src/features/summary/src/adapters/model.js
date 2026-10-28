// Derived from YouTube Digest (MIT); see LICENSE and NOTICE.
export function createSummaryModel(ports) {
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

  function validateAndFixTimestamps(analysis, maxSeconds) {
    const safeMax =
      Number.isFinite(Number(maxSeconds)) && Number(maxSeconds) > 0
        ? Number(maxSeconds)
        : Number.MAX_SAFE_INTEGER;

    // Helper to format seconds as MM:SS
    const formatTimestamp = (seconds) => {
      const mins = Math.floor(seconds / 60);
      const secs = Math.floor(seconds % 60);
      return `${mins}:${String(secs).padStart(2, "0")}`;
    };

    const safeString = (value, maxLength) =>
      typeof value === "string" ? value.trim().slice(0, maxLength) : "";
    const safeSeconds = (value) => {
      const seconds = Number(value);
      if (!Number.isFinite(seconds) || seconds < 0 || seconds > safeMax) {
        return null;
      }
      return Math.floor(seconds);
    };

    const chapters = (
      Array.isArray(analysis?.chapters) ? analysis.chapters : []
    )
      .slice(0, 100)
      .map((chapter) => {
        const seconds = safeSeconds(chapter?.timestampSeconds);
        const title = safeString(chapter?.title, 300);
        if (seconds === null || !title) return null;
        return {
          title,
          summary: safeString(chapter?.summary, 1500),
          timestampSeconds: seconds,
          timestamp: formatTimestamp(seconds),
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.timestampSeconds - b.timestampSeconds);

    const keyQuotes = (
      Array.isArray(analysis?.keyQuotes) ? analysis.keyQuotes : []
    )
      .slice(0, 50)
      .map((quote) => {
        const seconds = safeSeconds(quote?.timestampSeconds);
        const text = safeString(quote?.quote, 3000);
        if (seconds === null || !text) return null;
        return {
          quote: text,
          timestampSeconds: seconds,
          timestamp: formatTimestamp(seconds),
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.timestampSeconds - b.timestampSeconds);

    const keyMoments = (
      Array.isArray(analysis?.keyMoments) ? analysis.keyMoments : []
    )
      .map(safeSeconds)
      .filter((seconds) => seconds !== null)
      .slice(0, 100);

    return { chapters, keyQuotes, keyMoments };
  }

  async function handleAnalyzeTranscript(
    transcriptText,
    videoTitle,
    channelName,
    videoDescription,
    videoDuration,
  ) {
    try {
      const settings = await getSettings();
      if (!settings.aiApiKey) {
        return {
          success: false,
          error: "NO_AI_KEY",
          message:
            "DeepSeek API key not configured. Open YouTube Scaffold Settings.",
        };
      }

      // Convert duration to MM:SS format for context
      // The transcript text is already prefixed with [M:SS] markers. Its LAST
      // marker is the most reliable signal of where the content actually ends —
      // more trustworthy than the duration metadata, which is sometimes missing
      // or wrong. We use the larger of (metadata duration, last transcript stamp).
      let lastTranscriptSeconds = 0;
      const stampMatches = transcriptText.match(/\[(\d+):(\d{2})\]/g) || [];
      if (stampMatches.length) {
        const last =
          stampMatches[stampMatches.length - 1].match(/\[(\d+):(\d{2})\]/);
        lastTranscriptSeconds = parseInt(last[1]) * 60 + parseInt(last[2]);
      }

      const effectiveSeconds = Math.max(
        Math.floor(videoDuration || 0),
        lastTranscriptSeconds,
      );
      const durationMinutes = Math.floor(effectiveSeconds / 60);
      const durationSeconds = Math.floor(effectiveSeconds % 60);
      const durationFormatted = `${durationMinutes}:${String(durationSeconds).padStart(2, "0")}`;
      const maxTimestampSeconds = effectiveSeconds;

      // The "last chapter must be after" threshold (75% in) forces the model to
      // cover the WHOLE video instead of front-loading chapters near the start.
      // We do NOT prescribe a chapter count — the model picks the natural splits.
      const lateThresholdSeconds = Math.floor(effectiveSeconds * 0.75);
      const lateThreshold = `${Math.floor(lateThresholdSeconds / 60)}:${String(
        lateThresholdSeconds % 60,
      ).padStart(2, "0")}`;

      const promptVariables = {
        durationFormatted,
        lateThreshold,
        maxTimestampSeconds,
        videoTitle: videoTitle || "Unknown",
        channelName: channelName || "Unknown",
        videoDescription: videoDescription || "No description available",
        transcriptText,
      };
      const systemPrompt = await loadPromptSection(
        "analysis.md",
        "System prompt",
        promptVariables,
      );
      const userPrompt = await loadPromptSection(
        "analysis.md",
        "User prompt",
        promptVariables,
      );

      debugLog(
        "[YouTube Scaffold] Requesting video analysis",
        settings.aiModel,
      );
      const { text: responseText } = await requestAiCompletion({
        maxTokens: 8192,
        responseFormat: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      });

      // Parse the JSON, tolerating trailing commas / stray prose
      let analysis = parseLooseJson(responseText);

      // Treat every model response as untrusted data. Rebuild the supported
      // schema and derive display timestamps from validated numeric seconds.
      analysis = validateAndFixTimestamps(analysis, maxTimestampSeconds);

      return {
        success: true,
        analysis: analysis,
      };
    } catch (error) {
      console.error("Analysis error:", error);
      if (error.status === 401) {
        return {
          success: false,
          error: "INVALID_AI_KEY",
          message: "DeepSeek rejected the API key.",
        };
      }
      if (error.status === 429) {
        return {
          success: false,
          error: "RATE_LIMITED",
          message: "DeepSeek rate-limited this request. Try again shortly.",
        };
      }
      return {
        success: false,
        error: error.message || "Failed to analyze transcript",
      };
    }
  }
  return {
    analyze: handleAnalyzeTranscript,
    validate: validateAndFixTimestamps,
    parse: parseLooseJson,
  };
}
