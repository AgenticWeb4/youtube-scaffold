// Derived from YouTube Digest (MIT); see LICENSE and NOTICE.
export function createCaptionSource(ports) {
  const getSettings = ports.getSettings;
  const requestAiCompletion = ports.request;
  const loadPromptSection = ports.prompt;
  const debugLog = () => {};

  const fetch = ports.fetch || globalThis.fetch;
  const setTimeout = ports.setTimeout || globalThis.setTimeout;
  const YTD_SETTINGS = { canonicalYouTubeUrl: ports.canonicalUrl };
  async function handleFetchTranscript(videoId) {
    try {
      const settings = await getSettings();
      if (!settings.supadataApiKey) {
        return {
          success: false,
          error: "NO_SUPADATA_KEY",
          message:
            "Supadata API key not configured. Open YouTube Scaffold Settings.",
        };
      }

      // Share only the canonical watch URL. This strips playlist, referral,
      // timestamp, and other browsing parameters from the active tab URL.
      const canonicalVideoUrl = YTD_SETTINGS.canonicalYouTubeUrl(videoId);
      // Using the universal transcript endpoint with text=false to get timestamped chunks
      const apiUrl = new URL("https://api.supadata.ai/v1/transcript");
      apiUrl.searchParams.set("url", canonicalVideoUrl);
      apiUrl.searchParams.set("text", "false"); // Get timestamped chunks, not plain text
      apiUrl.searchParams.set("lang", "en"); // Prefer English
      // Caption-only product scope: never fall back to paid AI transcription.
      apiUrl.searchParams.set("mode", "native");

      // Make the API request
      const response = await fetch(apiUrl.toString(), {
        method: "GET",
        headers: {
          "x-api-key": settings.supadataApiKey,
        },
      });

      // Handle async jobs (for videos > 20 minutes, Supadata returns a job ID)
      if (response.status === 202) {
        const jobData = await response.json();
        // Poll for the result
        return await pollTranscriptJob(jobData.jobId, settings.supadataApiKey);
      }

      if (response.status === 206) {
        return {
          success: false,
          error: "NO_TRANSCRIPT",
          message: "No native subtitle track is available for this video.",
        };
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        if (response.status === 401) {
          return {
            success: false,
            error: "INVALID_SUPADATA_KEY",
            message:
              "Your Supadata API key is invalid. Open YouTube Scaffold Settings.",
          };
        }
        if (response.status === 404) {
          return {
            success: false,
            error: "NO_TRANSCRIPT",
            message: "No subtitles found for this video.",
          };
        }
        if (response.status === 429) {
          return {
            success: false,
            error: "RATE_LIMITED",
            message:
              "Supadata rate limit reached. Please wait a minute and try again.",
          };
        }
        throw new Error(
          errorData.message || `Supadata API error: ${response.status}`,
        );
      }

      const data = await response.json();

      // Parse the response into our internal format
      // Supadata returns: { content: [{ text, offset, duration, lang }], lang, availableLangs }
      const transcript = [];
      let transcriptTextPlain = ""; // Plain text for display/export
      let transcriptTextTimestamped = ""; // Timestamped text for AI analysis

      if (data.content && Array.isArray(data.content)) {
        for (const chunk of data.content) {
          if (chunk.text) {
            // Clean up caption artifacts:
            // ">>" = speaker change marker from YouTube auto-captions
            const cleanText = chunk.text.replace(/>> ?/g, "").trim();
            if (!cleanText) continue; // Skip if nothing left after cleanup

            // offset is in milliseconds, convert to seconds
            const startSeconds = Math.floor((chunk.offset || 0) / 1000);
            const minutes = Math.floor(startSeconds / 60);
            const seconds = startSeconds % 60;
            const timestamp = `${minutes}:${String(seconds).padStart(2, "0")}`;

            transcript.push({
              text: cleanText,
              start: startSeconds,
              duration: Math.floor((chunk.duration || 0) / 1000),
              language: chunk.lang || data.lang || null,
            });

            // Plain text without timestamps (for display/export)
            transcriptTextPlain += cleanText + " ";

            // Timestamped text for DeepSeek (format: [MM:SS] text)
            // This allows the model to reference actual transcript positions.
            transcriptTextTimestamped += `[${timestamp}] ${cleanText}\n`;
          }
        }
      }

      if (transcript.length === 0) {
        return {
          success: false,
          error: "EMPTY_TRANSCRIPT",
          message: "Supadata returned an empty transcript for this video.",
        };
      }

      return {
        success: true,
        transcript: transcript,
        transcriptText: transcriptTextPlain.trim(), // For display
        transcriptTextTimestamped: transcriptTextTimestamped.trim(), // For AI
        language: typeof data.lang === "string" ? data.lang : null,
      };
    } catch (error) {
      console.error("Transcript fetch error:", error);
      return {
        success: false,
        error: error.message || "Failed to fetch transcript",
      };
    }
  }

  async function pollTranscriptJob(jobId, supadataApiKey) {
    const maxAttempts = 60; // Max 60 seconds of polling
    const pollInterval = 1000; // Poll every 1 second

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      // Wait before polling
      await new Promise((resolve) => setTimeout(resolve, pollInterval));

      const response = await fetch(
        `https://api.supadata.ai/v1/transcript/${encodeURIComponent(jobId)}`,
        {
          headers: { "x-api-key": supadataApiKey },
        },
      );

      if (!response.ok) {
        throw new Error(`Job polling failed: ${response.status}`);
      }

      const data = await response.json();

      if (data.status === "completed") {
        // Parse the completed transcript
        const transcript = [];
        let transcriptTextPlain = "";
        let transcriptTextTimestamped = "";

        if (data.content && Array.isArray(data.content)) {
          for (const chunk of data.content) {
            if (chunk.text) {
              // Clean up caption artifacts (">>" = speaker change marker)
              const cleanText = chunk.text.replace(/>> ?/g, "").trim();
              if (!cleanText) continue;

              const startSeconds = Math.floor((chunk.offset || 0) / 1000);
              const minutes = Math.floor(startSeconds / 60);
              const seconds = startSeconds % 60;
              const timestamp = `${minutes}:${String(seconds).padStart(2, "0")}`;

              transcript.push({
                text: cleanText,
                start: startSeconds,
                duration: Math.floor((chunk.duration || 0) / 1000),
                language: chunk.lang || data.lang || null,
              });
              transcriptTextPlain += cleanText + " ";
              transcriptTextTimestamped += `[${timestamp}] ${chunk.text}\n`;
            }
          }
        }

        return {
          success: true,
          transcript: transcript,
          transcriptText: transcriptTextPlain.trim(),
          transcriptTextTimestamped: transcriptTextTimestamped.trim(),
          language: typeof data.lang === "string" ? data.lang : null,
        };
      }

      if (data.status === "failed") {
        throw new Error("Transcript processing failed");
      }

      // Status is 'queued' or 'active' — keep polling
    }

    throw new Error("Transcript processing timed out");
  }
  return { fetchTranscript: handleFetchTranscript };
}
