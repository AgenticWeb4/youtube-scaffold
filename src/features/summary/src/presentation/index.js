// Feature presentation; all application actions enter through the injected syncs facade.
// Derived UI: see LICENSE and NOTICE.
export function createSummaryView(ctx) {
  /**
   * Renders the analysis results into the Overview tab.
   * Shows chapters and key quotes only.
   */
  function renderAnalysisResults(analysis) {
    // Chapters
    const chapterList = document.getElementById("chapterList");
    chapterList.innerHTML = "";
    (analysis.chapters || []).forEach((chapter, index) => {
      const li = document.createElement("li");
      li.className = "chapter-item";
      li.dataset.seconds = chapter.timestampSeconds;
      li.innerHTML = `
      <span class="chapter-timestamp">${ctx.escapeHtml(chapter.timestamp)}</span>
      <div class="chapter-content">
        <span class="chapter-title">${ctx.renderLocalizedContent(chapter.title, "overview", `chapter-${index}-title`)}</span>
        <span class="chapter-summary">${ctx.renderLocalizedContent(chapter.summary || "", "overview", `chapter-${index}-summary`)}</span>
      </div>
    `;
      li.addEventListener("click", () => {
        ctx.debugLog(
          "[YouTube Scaffold Panel] Chapter clicked:",
          chapter.timestamp,
          chapter.timestampSeconds,
        );
        ctx.seekTo(chapter.timestampSeconds);
      });
      chapterList.appendChild(li);
    });
    // Quotes - sort by timestamp (chronological order)
    const quotesList = document.getElementById("quotesList");
    quotesList.innerHTML = "";
    const sortedQuotes = [...(analysis.keyQuotes || [])].sort(
      (a, b) => (a.timestampSeconds || 0) - (b.timestampSeconds || 0),
    );
    sortedQuotes.forEach((quote, index) => {
      const div = document.createElement("div");
      div.className = "quote-item";
      div.dataset.seconds = quote.timestampSeconds;
      div.innerHTML = `
      <div class="quote-text">${ctx.renderLocalizedContent(quote.quote, "overview", `quote-${index}`)}</div>
      <div class="quote-meta">
        <span class="quote-timestamp">${ctx.escapeHtml(quote.timestamp)}</span>
        <div class="quote-actions">
          <button class="quote-save-note-btn" title="Save this quote as a note">Note</button>
          <button class="quote-copy-btn" title="Copy this quote">Copy</button>
        </div>
      </div>
    `;
      div.addEventListener("click", () => {
        ctx.debugLog(
          "[YouTube Scaffold Panel] Quote clicked:",
          quote.timestamp,
          quote.timestampSeconds,
        );
        ctx.seekTo(quote.timestampSeconds);
      });
      const quoteCopyBtn = div.querySelector(".quote-copy-btn");
      quoteCopyBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(
            ctx.getLocalizedPlainText(
              quote.quote,
              "overview",
              `quote-${index}`,
            ),
          );
          quoteCopyBtn.textContent = "Copied";
          setTimeout(() => {
            quoteCopyBtn.textContent = "Copy";
          }, 1500);
        } catch (err) {
          console.error("Copy failed:", err);
        }
      });
      const quoteSaveNoteBtn = div.querySelector(".quote-save-note-btn");
      quoteSaveNoteBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        await ctx.saveQuoteAsNote(quote, quoteSaveNoteBtn);
      });
      quotesList.appendChild(div);
    });
    if (
      ctx.currentTranscriptMode !== "original" &&
      ctx.resultTabIsActive("overview")
    ) {
      void ctx.translateOverviewContent();
    }
  }

  /**
   * Saves a key quote as a timestamped note.
   */
  async function saveQuoteAsNote(quote, btn) {
    if (!ctx.currentVideoId) return;
    const originalText = btn.textContent;
    btn.textContent = "Saving...";
    btn.disabled = true;
    try {
      const result = await ctx.api.sendMessage({
        action: "saveNote",
        videoId: ctx.currentVideoId,
        timestamp: quote.timestampSeconds,
        videoTitle: ctx.currentVideoTitle,
        channelName: ctx.currentChannelName,
      });
      if (result.success) {
        btn.textContent = "Saved";
        setTimeout(() => {
          btn.textContent = originalText;
          btn.disabled = false;
        }, 1500);
        // Refresh notes list if on Notes tab
        ctx.loadNotes(ctx.currentVideoId);
      } else {
        console.error(
          "[YouTube Scaffold] Save quote as note failed:",
          result.error,
        );
        btn.textContent = "Error";
        setTimeout(() => {
          btn.textContent = originalText;
          btn.disabled = false;
        }, 1500);
      }
    } catch (error) {
      console.error("[YouTube Scaffold] Save quote as note error:", error);
      btn.textContent = "Error";
      setTimeout(() => {
        btn.textContent = originalText;
        btn.disabled = false;
      }, 1500);
    }
  }

  /**
   * Legacy function for backwards compatibility with cached data.
   * Renders both transcript and analysis.
   */
  function renderResults(analysis) {
    ctx.renderAnalysisResults(analysis);
    ctx.renderTranscript();
    document.getElementById("tabsNav").style.display = "flex";
    // Setup explain feature for text selection
    ctx.setupExplainFeature();
  }

  /**
   * Triggers the LLM analysis (lazy-loaded when user clicks Overview or Quotes tab).
   * This saves tokens by not running analysis until needed.
   */
  async function triggerAnalysis() {
    if (
      !ctx.currentTranscriptTimestamped ||
      ctx.isAnalysisLoading ||
      ctx.currentAnalysis
    )
      return;
    const requestVideoId = ctx.currentVideoId;
    const generation = ++ctx.analysisGeneration;
    ctx.isAnalysisLoading = true;
    // Show loading indicators in the Overview tab
    const chapterList = document.getElementById("chapterList");
    const quotesList = document.getElementById("quotesList");
    if (chapterList)
      chapterList.innerHTML =
        '<li class="chapter-item" style="color: var(--text-muted); border: none;">Loading chapters...</li>';
    if (quotesList)
      quotesList.innerHTML =
        '<div class="quote-item" style="color: var(--text-muted); border-left-color: var(--border);">Loading quotes...</div>';
    try {
      const analysisResult = await ctx.api.sendMessage({
        action: "analyzeTranscript",
        videoId: requestVideoId,
        transcriptText: ctx.currentTranscriptTimestamped,
        videoTitle: ctx.currentVideoTitle,
        channelName: ctx.currentChannelName,
        videoDescription: ctx.currentVideoDescription,
        videoDuration: ctx.currentVideoDuration,
      });
      if (
        generation !== ctx.analysisGeneration ||
        requestVideoId !== ctx.currentVideoId
      )
        return;
      if (!analysisResult.success) {
        if (chapterList)
          chapterList.innerHTML = `<li class="chapter-item" style="color: var(--accent); border: none;">Analysis failed: ${ctx.escapeHtml(analysisResult.error || "Unknown error")}</li>`;
        ctx.isAnalysisLoading = false;
        return;
      }
      ctx.currentAnalysis = analysisResult.analysis;
      ctx.renderAnalysisResults(ctx.currentAnalysis);
      ctx.highlightMomentsOnPage(ctx.currentAnalysis.keyMoments);
      // Save to cache now that we have analysis
      await ctx.saveToCache(requestVideoId);
    } catch (error) {
      if (
        generation !== ctx.analysisGeneration ||
        requestVideoId !== ctx.currentVideoId
      )
        return;
      console.error("[YouTube Scaffold Panel] Analysis error:", error);
      if (chapterList)
        chapterList.innerHTML = `<li class="chapter-item" style="color: var(--accent); border: none;">Error: ${ctx.escapeHtml(error.message)}</li>`;
    }
    ctx.isAnalysisLoading = false;
  }

  function getOverviewTranslationSegments() {
    if (!ctx.currentAnalysis) return [];
    const segments = [];
    (ctx.currentAnalysis.chapters || []).forEach((chapter, index) => {
      if (chapter.title) {
        segments.push({ id: `chapter-${index}-title`, text: chapter.title });
      }
      if (chapter.summary) {
        segments.push({
          id: `chapter-${index}-summary`,
          text: chapter.summary,
        });
      }
    });
    [...(ctx.currentAnalysis.keyQuotes || [])]
      .sort((a, b) => (a.timestampSeconds || 0) - (b.timestampSeconds || 0))
      .forEach((quote, index) => {
        if (quote.quote)
          segments.push({ id: `quote-${index}`, text: quote.quote });
      });
    return segments;
  }
  return {
    renderAnalysisResults,
    saveQuoteAsNote,
    renderResults,
    triggerAnalysis,
    getOverviewTranslationSegments,
  };
}
