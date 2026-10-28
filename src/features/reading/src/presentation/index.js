// Feature presentation; all application actions enter through the injected syncs facade.
// Derived UI: see LICENSE and NOTICE.
export function createReadingView(ctx) {
  let vocabularyTerms = new Map();
  function setVocabularyEntries(entries) {
    vocabularyTerms = new Map(
      entries.map((entry) => [entry.normalizedTerm, entry.id]),
    );
    ctx.refreshTranscriptSearch({ preserveIndex: true, scroll: false });
  }
  function clearVocabularyHighlights() {
    document
      .querySelectorAll("#transcriptList .vocabulary-mark")
      .forEach((mark) => {
        const parent = mark.parentNode;
        mark.replaceWith(document.createTextNode(mark.textContent || ""));
        parent?.normalize();
      });
  }
  /** Rebuilt after row rendering/translation. Source only; Chinese is never matched. */
  function highlightVocabulary() {
    document
      .querySelectorAll(
        "#transcriptList .transcript-text, #transcriptList .transcript-original",
      )
      .forEach((source) => {
        const walker = document.createTreeWalker(source, NodeFilter.SHOW_TEXT);
        const nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);
        for (const node of nodes) {
          const matches = ctx.api.reading.wordMatches(
            node.nodeValue,
            vocabularyTerms,
          );
          if (!matches.length) continue;
          const fragment = document.createDocumentFragment();
          let cursor = 0;
          for (const match of matches) {
            fragment.append(
              document.createTextNode(
                node.nodeValue.slice(cursor, match.start),
              ),
            );
            const mark = document.createElement("mark");
            mark.className = "vocabulary-mark";
            mark.textContent = node.nodeValue.slice(match.start, match.end);
            mark.setAttribute("role", "button");
            mark.tabIndex = 0;
            mark.title = `查看已收藏单词：${mark.textContent}`;
            mark.setAttribute("aria-label", mark.title);
            const open = (event) => {
              if (ctx.hasNonCollapsedTextSelection()) return;
              event.preventDefault();
              event.stopPropagation();
              const row = mark.closest(".transcript-entry");
              let capture = null;
              try {
                capture = ctx.captureWordContext(mark.textContent, row);
              } catch {
                /* Historical card remains available. */
              }
              ctx.openVocabulary(match.entryId, capture);
            };
            mark.addEventListener("click", open);
            mark.addEventListener("keydown", (event) => {
              if (event.key === "Enter" || event.key === " ") open(event);
            });
            fragment.append(mark);
            cursor = match.end;
          }
          fragment.append(
            document.createTextNode(node.nodeValue.slice(cursor)),
          );
          node.replaceWith(fragment);
        }
      });
  }

  // ============================================================
  // TRANSCRIPT GROUPING
  // ============================================================
  function normalizeCaptionText(...args) {
    return ctx.api.reading.normalizeCaptionText(...args);
  }

  /**
   * Splits a single oversized thought at the strongest nearby punctuation.
   * Word boundaries are the final safety valve for captions with no punctuation.
   */
  function splitOversizedThought(...args) {
    return ctx.api.reading.splitOversizedThought(...args);
  }

  /**
   * Reconstructs complete sentences across raw caption boundaries. Each segment
   * keeps the timestamp of the first caption that contributed text. Character
   * and time limits prevent a malformed Supadata entry from becoming one giant
   * row while punctuation remains the preferred boundary.
   */
  function groupTranscriptEntries(...args) {
    return ctx.api.reading.groupTranscriptEntries(...args);
  }

  /**
   * Returns true while the user has a range of text selected.
   * Transcript row clicks must not seek in that state: the click emitted after
   * selection mouseup belongs to the selection/explain interaction, not playback.
   */
  function hasNonCollapsedTextSelection() {
    const selection = window.getSelection();
    return Boolean(
      selection && selection.rangeCount > 0 && !selection.isCollapsed,
    );
  }

  /**
   * Preserves normal row-click seeking while keeping text selection inert.
   */
  function seekFromTranscriptEntryClick(event, seconds) {
    if (ctx.hasNonCollapsedTextSelection()) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    ctx.seekTo(seconds);
  }

  function renderTranscript() {
    if (!ctx.currentTranscript) return;
    const transcriptList = document.getElementById("transcriptList");
    transcriptList.innerHTML = "";
    const existingBadge = document.getElementById("transcriptSourceBadge");
    if (existingBadge) existingBadge.remove();
    // Group entries using smart sentence-boundary + time-guardrail logic
    const grouped = ctx.groupTranscriptEntries(ctx.currentTranscript);
    grouped.forEach((group) => {
      const div = document.createElement("div");
      div.className = "transcript-entry";
      div.dataset.seconds = group.start;
      div.dataset.segmentId = group.id;
      const minutes = Math.floor(group.start / 60);
      const seconds = Math.floor(group.start % 60);
      const timestamp = `${minutes}:${String(seconds).padStart(2, "0")}`;
      div.innerHTML = `
      <span class="transcript-time">${timestamp}</span>
      <span class="transcript-text">${ctx.renderSubtitleInlineMarkup(group.text)}</span>
    `;
      div.addEventListener("click", (event) =>
        ctx.seekFromTranscriptEntryClick(event, group.start),
      );
      transcriptList.appendChild(div);
    });
    // Reapply an active query after a language mode rerenders the transcript.
    ctx.refreshTranscriptSearch({ preserveIndex: false, scroll: false });
    // Start tracking video playback for auto-scroll
    ctx.startPlaybackTracking();
  }

  // ============================================================
  // TRANSCRIPT SEARCH
  // ============================================================
  /**
   * Finds separate, case-insensitive literal matches. A literal search is
   * important here because punctuation such as "." must be treated as transcript
   * text, not as a regular expression command.
   */
  function findLiteralTranscriptMatches(...args) {
    return ctx.api.reading.findLiteralTranscriptMatches(...args);
  }

  /**
   * Removes old marks before a new search. Restoring plain text first prevents
   * nested marks when the user types one more letter into the search field.
   */
  function clearTranscriptSearchHighlights() {
    document
      .querySelectorAll("#transcriptList mark.transcript-search-highlight")
      .forEach((mark) => {
        const parent = mark.parentNode;
        mark.replaceWith(document.createTextNode(mark.textContent || ""));
        parent?.normalize();
      });
    document
      .querySelectorAll("#transcriptList .transcript-entry.search-current")
      .forEach((row) => row.classList.remove("search-current"));
  }

  /**
   * Replaces matching parts of one text node with mark elements. We collect all
   * text nodes before changing the DOM, so each replacement is safe and stable.
   */
  function markTranscriptTextNode(textNode, query) {
    const ranges = ctx.findLiteralTranscriptMatches(textNode.nodeValue, query);
    if (!ranges.length) return [];
    const fragment = document.createDocumentFragment();
    const marks = [];
    let cursor = 0;
    ranges.forEach(({ start, end }) => {
      if (start > cursor) {
        fragment.appendChild(
          document.createTextNode(textNode.nodeValue.slice(cursor, start)),
        );
      }
      const mark = document.createElement("mark");
      mark.className = "transcript-search-highlight";
      mark.textContent = textNode.nodeValue.slice(start, end);
      fragment.appendChild(mark);
      marks.push(mark);
      cursor = end;
    });
    if (cursor < textNode.nodeValue.length) {
      fragment.appendChild(
        document.createTextNode(textNode.nodeValue.slice(cursor)),
      );
    }
    textNode.parentNode.replaceChild(fragment, textNode);
    return marks;
  }

  /**
   * Updates the result count and navigation buttons from the current search
   * state. The live output gives the same information to screen reader users.
   */
  function updateTranscriptSearchControls(query) {
    const count = document.getElementById("transcriptSearchCount");
    const previous = document.getElementById("transcriptSearchPrevBtn");
    const next = document.getElementById("transcriptSearchNextBtn");
    const hasMatches = ctx.transcriptSearchMatches.length > 0;
    if (count) {
      count.textContent = !query
        ? ""
        : hasMatches
          ? `${ctx.transcriptSearchIndex + 1} of ${ctx.transcriptSearchMatches.length}`
          : "No matches";
    }
    if (previous) previous.disabled = !hasMatches;
    if (next) next.disabled = !hasMatches;
  }

  /**
   * Shows which match is current. Search navigation pauses automatic transcript
   * following, so playback cannot pull the user away from the result they found.
   */
  function revealCurrentTranscriptSearchMatch({ scroll = true } = {}) {
    ctx.transcriptSearchMatches.forEach((mark) =>
      mark.classList.remove("current"),
    );
    document
      .querySelectorAll("#transcriptList .transcript-entry.search-current")
      .forEach((row) => row.classList.remove("search-current"));
    const mark = ctx.transcriptSearchMatches[ctx.transcriptSearchIndex];
    if (!mark) return;
    mark.classList.add("current");
    mark.closest(".transcript-entry")?.classList.add("search-current");
    if (!scroll) return;
    if (ctx.autoScrollInterval) {
      ctx.autoScrollEnabled = false;
      document.getElementById("followPlaybackBtn").style.display = "block";
    }
    mark.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  /**
   * Searches the transcript that is visible now. This means Original searches
   * source subtitles, Chinese searches translated text, and Bilingual searches
   * both columns. Translated rows call this again as their text arrives.
   */
  function refreshTranscriptSearch({
    preserveIndex = false,
    scroll = true,
  } = {}) {
    const input = document.getElementById("transcriptSearchInput");
    const clearButton = document.getElementById("transcriptSearchClearBtn");
    const query = String(input?.value || "").trim();
    const previousIndex = ctx.transcriptSearchIndex;
    ctx.clearTranscriptSearchHighlights();
    clearVocabularyHighlights();
    ctx.transcriptSearchMatches = [];
    ctx.transcriptSearchIndex = -1;
    if (clearButton) clearButton.hidden = !input?.value;
    if (!query) {
      // Search temporarily owns highlights, preserving phrase matches across word boundaries.
      highlightVocabulary();
      ctx.updateTranscriptSearchControls(query);
      return;
    }
    document
      .querySelectorAll("#transcriptList .transcript-entry")
      .forEach((row) => {
        const content = row.querySelector(".transcript-text, .transcript-copy");
        if (!content) return;
        const textNodes = [];
        const walker = document.createTreeWalker(
          content,
          NodeFilter.SHOW_TEXT,
          {
            acceptNode(node) {
              const parent = node.parentElement;
              if (!node.nodeValue || parent?.closest("button")) {
                return NodeFilter.FILTER_REJECT;
              }
              return NodeFilter.FILTER_ACCEPT;
            },
          },
        );
        while (walker.nextNode()) textNodes.push(walker.currentNode);
        textNodes.forEach((node) => {
          ctx.transcriptSearchMatches.push(
            ...ctx.markTranscriptTextNode(node, query),
          );
        });
      });
    if (ctx.transcriptSearchMatches.length) {
      ctx.transcriptSearchIndex = preserveIndex
        ? Math.min(
            Math.max(previousIndex, 0),
            ctx.transcriptSearchMatches.length - 1,
          )
        : 0;
      ctx.revealCurrentTranscriptSearchMatch({ scroll });
    }
    ctx.updateTranscriptSearchControls(query);
  }

  /**
   * Moves through results in a loop, like the browser's built-in Find control.
   */
  function moveTranscriptSearch(direction) {
    if (!ctx.transcriptSearchMatches.length) return;
    ctx.transcriptSearchIndex =
      (ctx.transcriptSearchIndex +
        direction +
        ctx.transcriptSearchMatches.length) %
      ctx.transcriptSearchMatches.length;
    ctx.revealCurrentTranscriptSearchMatch();
    ctx.updateTranscriptSearchControls(
      document.getElementById("transcriptSearchInput")?.value.trim(),
    );
  }

  /**
   * Clears search when the user opens a different video. A query for the old
   * video is unlikely to help and can make the next transcript look empty.
   */
  function resetTranscriptSearch({ focus = false } = {}) {
    const input = document.getElementById("transcriptSearchInput");
    if (input) input.value = "";
    ctx.refreshTranscriptSearch({ scroll: false });
    if (focus) input?.focus();
  }

  /**
   * Wires mouse and keyboard controls once when the side panel starts.
   */
  function setupTranscriptSearch() {
    const input = document.getElementById("transcriptSearchInput");
    const clearButton = document.getElementById("transcriptSearchClearBtn");
    const previous = document.getElementById("transcriptSearchPrevBtn");
    const next = document.getElementById("transcriptSearchNextBtn");
    if (!input) return;
    input.addEventListener("input", () => ctx.refreshTranscriptSearch());
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        ctx.moveTranscriptSearch(event.shiftKey ? -1 : 1);
      } else if (event.key === "Escape" && input.value) {
        event.preventDefault();
        ctx.resetTranscriptSearch({ focus: true });
      }
    });
    clearButton?.addEventListener("click", () => {
      ctx.resetTranscriptSearch({ focus: true });
    });
    previous?.addEventListener("click", () => ctx.moveTranscriptSearch(-1));
    next?.addEventListener("click", () => ctx.moveTranscriptSearch(1));
  }

  function getDisplayedTranscriptText() {
    if (ctx.currentTranscriptMode === "original")
      return ctx.currentTranscriptText || "";
    return ctx
      .getActiveTranscriptSegments()
      .map((segment) => {
        const translated = ctx.transcriptParagraphCache.get(
          ctx.transcriptTranslationCacheKey(segment),
        );
        if (ctx.currentTranscriptMode === "zh")
          return translated || segment.text;
        return translated ? `${segment.text}\n${translated}` : segment.text;
      })
      .join("\n\n");
  }

  // ============================================================
  // AUTO-SCROLL — Follow video playback in transcript
  // ============================================================
  // While a video plays, the transcript automatically scrolls to show which
  // 30-second chunk is currently being spoken. If the user manually scrolls
  // (e.g., to read ahead), auto-scroll pauses and a "Follow playback" button
  // appears so they can resume it. Highlight always stays active regardless.
  /**
   * Starts polling the video's current time and highlighting/scrolling
   * to the matching transcript entry.
   */
  function startPlaybackTracking() {
    if (!ctx.currentTranscript || !ctx.currentTranscript.length) return;
    // Don't restart if already tracking (preserves user's auto-scroll state)
    if (ctx.autoScrollInterval) return;
    const willRestoreReadingPosition =
      ctx.pendingTranscriptViewState?.videoId === ctx.currentVideoId;
    ctx.autoScrollEnabled = !willRestoreReadingPosition;
    document.getElementById("followPlaybackBtn").style.display =
      willRestoreReadingPosition ? "block" : "none";
    // Poll video time every 500ms
    ctx.autoScrollInterval = setInterval(() => ctx.playbackTrackingTick(), 500);
    // Listen for manual scrolls on the content area
    const contentArea = document.getElementById("contentArea");
    contentArea.removeEventListener("scroll", ctx.onContentAreaScroll);
    contentArea.addEventListener("scroll", ctx.onContentAreaScroll);
  }

  /**
   * Stops playback tracking entirely. Called when leaving transcript tab,
   * starting a new digest, or leaving results state.
   */
  function stopPlaybackTracking() {
    if (ctx.autoScrollInterval) {
      clearInterval(ctx.autoScrollInterval);
      ctx.autoScrollInterval = null;
    }
    ctx.autoScrollEnabled = true; // Reset for next time
    ctx.lastAutoScrollTime = 0;
    document.getElementById("followPlaybackBtn").style.display = "none";
    // Remove active highlights
    document
      .querySelectorAll(".transcript-entry.active-playback")
      .forEach((el) => {
        el.classList.remove("active-playback");
      });
  }

  /**
   * One tick of the playback tracker. Gets current video time from the
   * YouTube tab and highlights + scrolls to the matching transcript entry.
   */
  async function playbackTrackingTick() {
    try {
      const result = await ctx.api.sendMessage({
        action: "relayToContent",
        targetTabId: ctx.youtubeTabId,
        expectedVideoId: ctx.currentVideoId,
        payload: { action: "getCurrentTime" },
      });
      if (!result.success || !result.response) return;
      const currentTime = result.response.currentTime || 0;
      ctx.highlightActiveEntry(currentTime);
    } catch (error) {
      // Silently ignore — YouTube tab might be closed or navigated away
    }
  }

  /**
   * Scrolls the transcript to the entry currently being spoken (the one
   * carrying the active-playback highlight). Returns false if nothing is
   * highlighted yet. Stamps lastAutoScrollTime BEFORE scrolling so the scroll
   * events from our own smooth animation aren't mistaken for the user
   * scrolling away (which would re-disable auto-scroll immediately).
   */
  function scrollToActiveEntry() {
    const activeEntry = document.querySelector(
      "#transcriptList .transcript-entry.active-playback",
    );
    if (!activeEntry) return false;
    ctx.lastAutoScrollTime = Date.now();
    activeEntry.scrollIntoView({ behavior: "smooth", block: "center" });
    return true;
  }

  /**
   * Finds the transcript entry matching the current playback time,
   * highlights it, and scrolls to it (if auto-scroll is enabled).
   *
   * @param {number} currentSeconds - Current video playback time in seconds
   */
  function highlightActiveEntry(currentSeconds) {
    const transcriptList = document.getElementById("transcriptList");
    if (!transcriptList) return;
    const entries = transcriptList.querySelectorAll(".transcript-entry");
    if (entries.length === 0) return;
    // Find the entry whose time range contains the current playback time
    let activeEntry = null;
    entries.forEach((entry, index) => {
      const entrySeconds = parseInt(entry.dataset.seconds);
      const nextEntry = entries[index + 1];
      const nextSeconds = nextEntry
        ? parseInt(nextEntry.dataset.seconds)
        : Infinity;
      if (currentSeconds >= entrySeconds && currentSeconds < nextSeconds) {
        activeEntry = entry;
      }
    });
    if (!activeEntry) return;
    // Skip if this entry is already highlighted (no DOM thrashing)
    if (activeEntry.classList.contains("active-playback")) return;
    // Remove old highlight, add new one
    entries.forEach((e) => e.classList.remove("active-playback"));
    activeEntry.classList.add("active-playback");
    // Only scroll if auto-scroll is enabled
    if (ctx.autoScrollEnabled) {
      ctx.lastAutoScrollTime = Date.now();
      activeEntry.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  /**
   * Scroll event handler for the content area.
   * Detects manual scrolling and disables auto-scroll so the user
   * can read at their own pace without being yanked back.
   */
  function onContentAreaScroll() {
    ctx.scheduleTranscriptViewStateSave();
    // Ignore scroll events within 1 second of a programmatic scroll
    // (smooth scroll animations can last longer than a simple boolean flag)
    if (Date.now() - ctx.lastAutoScrollTime < 1000) return;
    // User scrolled manually — disable auto-scroll and show the button
    if (ctx.autoScrollEnabled && ctx.autoScrollInterval) {
      ctx.autoScrollEnabled = false;
      document.getElementById("followPlaybackBtn").style.display = "block";
    }
  }

  /**
   * Uses session storage when it is available. Local storage is a safe fallback
   * for older test or browser environments that do not expose session storage.
   */
  function getTranscriptViewStateStorage() {
    return ctx.api.reading.viewStorage;
  }

  /**
   * Reads one video's last visible transcript position.
   */
  async function loadTranscriptViewState(videoId) {
    if (!videoId) return null;
    try {
      const result = await ctx
        .getTranscriptViewStateStorage()
        .get(ctx.TRANSCRIPT_VIEW_STATE_KEY);
      const state = result?.[ctx.TRANSCRIPT_VIEW_STATE_KEY]?.[videoId];
      const scrollTop = Number(state?.scrollTop);
      if (!Number.isFinite(scrollTop) || scrollTop < 0) return null;
      return { videoId, scrollTop };
    } catch (error) {
      console.error("[YouTube Scaffold] Reading position load error:", error);
      return null;
    }
  }

  /**
   * Stores positions for a small recent set of videos. This prevents one value
   * from growing without a limit during a long Chrome session.
   */
  async function saveTranscriptViewState(videoId, scrollTop) {
    if (!videoId || !Number.isFinite(scrollTop) || scrollTop < 0) return;
    try {
      const storage = ctx.getTranscriptViewStateStorage();
      const result = await storage.get(ctx.TRANSCRIPT_VIEW_STATE_KEY);
      const states = result?.[ctx.TRANSCRIPT_VIEW_STATE_KEY] || {};
      states[videoId] = { scrollTop, updatedAt: Date.now() };
      const recentStates = Object.fromEntries(
        Object.entries(states)
          .sort(([, a], [, b]) => (b.updatedAt || 0) - (a.updatedAt || 0))
          .slice(0, 20),
      );
      await storage.set({ [ctx.TRANSCRIPT_VIEW_STATE_KEY]: recentStates });
    } catch (error) {
      console.error("[YouTube Scaffold] Reading position save error:", error);
    }
  }

  /**
   * Saves the visible position after scrolling stops. Capturing the video ID and
   * position now prevents a later video change from writing the wrong state.
   */
  function scheduleTranscriptViewStateSave() {
    if (
      ctx.isRestoringTranscriptView ||
      !ctx.currentVideoId ||
      !ctx.transcriptTabIsActive()
    ) {
      return;
    }
    const contentArea = document.getElementById("contentArea");
    if (!contentArea) return;
    const videoId = ctx.currentVideoId;
    const scrollTop = contentArea.scrollTop;
    ctx.lastTranscriptScrollTop = scrollTop;
    clearTimeout(ctx.transcriptViewStateSaveTimer);
    ctx.transcriptViewStateSaveTimer = setTimeout(() => {
      void ctx.saveTranscriptViewState(videoId, scrollTop);
    }, 150);
  }

  /**
   * Saves immediately before the panel closes.
   */
  function saveCurrentTranscriptViewState() {
    clearTimeout(ctx.transcriptViewStateSaveTimer);
    const contentArea = document.getElementById("contentArea");
    if (!ctx.currentVideoId || !contentArea) return Promise.resolve();
    if (ctx.transcriptTabIsActive()) ctx.captureCurrentTranscriptScrollTop();
    return ctx.saveTranscriptViewState(
      ctx.currentVideoId,
      ctx.lastTranscriptScrollTop,
    );
  }

  /**
   * Returns true only while the Transcript tab is the visible results panel.
   */
  function transcriptTabIsActive() {
    return ctx.resultTabIsActive("transcript");
  }

  /**
   * Copies the shared scroll area's current value into transcript-only state.
   */
  function captureCurrentTranscriptScrollTop() {
    const contentArea = document.getElementById("contentArea");
    if (contentArea) ctx.lastTranscriptScrollTop = contentArea.scrollTop;
  }

  /**
   * Restores the saved position after the transcript becomes visible. Follow
   * Playback stays paused, so the next timer tick cannot move the panel again.
   */
  function restorePendingTranscriptViewState(videoId) {
    const state = ctx.pendingTranscriptViewState;
    ctx.pendingTranscriptViewState = null;
    const contentArea = document.getElementById("contentArea");
    if (!state || state.videoId !== videoId) {
      contentArea?.classList.remove("restoring-transcript-view");
      return;
    }
    requestAnimationFrame(() => {
      if (ctx.currentVideoId !== videoId || !contentArea) {
        contentArea?.classList.remove("restoring-transcript-view");
        return;
      }
      ctx.isRestoringTranscriptView = true;
      ctx.lastAutoScrollTime = Date.now();
      ctx.autoScrollEnabled = false;
      contentArea.scrollTop = state.scrollTop;
      ctx.lastTranscriptScrollTop = state.scrollTop;
      document.getElementById("followPlaybackBtn").style.display = "block";
      contentArea.classList.remove("restoring-transcript-view");
      requestAnimationFrame(() => {
        ctx.isRestoringTranscriptView = false;
      });
    });
  }

  // ============================================================
  // UNIVERSAL DISPLAY LANGUAGE — Original / Chinese / aligned bilingual
  // ============================================================
  async function loadDisplayLanguageMode(videoId) {
    if (!videoId) return "original";
    try {
      const stored = await ctx.api.reading.viewStorage.get(
        ctx.DISPLAY_LANGUAGE_MODE_KEY,
      );
      const mode = stored?.[ctx.DISPLAY_LANGUAGE_MODE_KEY]?.[videoId]?.mode;
      return ctx.DISPLAY_LANGUAGE_MODES.has(mode) ? mode : "original";
    } catch (_) {
      return "original";
    }
  }

  async function saveDisplayLanguageMode(videoId, mode) {
    if (!videoId || !ctx.DISPLAY_LANGUAGE_MODES.has(mode)) return;
    const stored = await ctx.api.reading.viewStorage.get(
      ctx.DISPLAY_LANGUAGE_MODE_KEY,
    );
    const modes = stored?.[ctx.DISPLAY_LANGUAGE_MODE_KEY] || {};
    modes[videoId] = { mode, updatedAt: Date.now() };
    const recentModes = Object.fromEntries(
      Object.entries(modes)
        .sort(([, a], [, b]) => (b.updatedAt || 0) - (a.updatedAt || 0))
        .slice(0, 50),
    );
    await ctx.api.reading.viewStorage.set({
      [ctx.DISPLAY_LANGUAGE_MODE_KEY]: recentModes,
    });
  }

  function getActiveTranscriptSegments() {
    return ctx.groupTranscriptEntries(ctx.currentTranscript || []);
  }

  function setTranscriptModeButtons(mode) {
    document.querySelectorAll(".transcript-mode-btn").forEach((button) => {
      const active = button.dataset.transcriptMode === mode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  async function handleDisplayLanguageModeChange(mode) {
    if (!ctx.DISPLAY_LANGUAGE_MODES.has(mode)) return;
    if (mode === ctx.currentTranscriptMode) return;
    const videoId = ctx.currentVideoId;
    const generation = ++ctx.translationGeneration;
    ctx.currentTranscriptMode = mode;
    await ctx.saveDisplayLanguageMode(videoId, mode);
    if (
      generation !== ctx.translationGeneration ||
      videoId !== ctx.currentVideoId
    )
      return;
    if (mode !== "original") ctx.interfaceTranslationFailures.clear();
    ctx.translationWorkCount = 0;
    ctx.setTranslatingSpinner(false);
    if (ctx.transcriptScrollObserver) ctx.transcriptScrollObserver.disconnect();
    ctx.transcriptScrollObserver = null;
    ctx.setTranscriptModeButtons(mode);
    const activeTabName =
      document.querySelector(".tab.active")?.dataset.tab || "transcript";
    if (mode === "original") {
      ctx.renderTranscript();
      if (ctx.currentAnalysis) ctx.renderAnalysisResults(ctx.currentAnalysis);
      if (ctx.currentNotes.length)
        ctx.renderNotes(ctx.currentNotes, ctx.currentNotesFilterVideoId);
      return;
    }
    if (ctx.currentAnalysis) {
      ctx.renderAnalysisResults(ctx.currentAnalysis);
    }
    if (ctx.currentNotes.length) {
      ctx.renderNotes(ctx.currentNotes, ctx.currentNotesFilterVideoId);
    }
    if (activeTabName === "overview" && ctx.currentAnalysis) {
      await ctx.translateOverviewContent();
    } else if (activeTabName === "notes" && ctx.currentNotes.length) {
      await ctx.translateNotesContent();
    } else if (activeTabName === "transcript") {
      await ctx.translateTranscript();
    }
  }
  return {
    normalizeCaptionText,
    splitOversizedThought,
    groupTranscriptEntries,
    setVocabularyEntries,
    hasNonCollapsedTextSelection,
    seekFromTranscriptEntryClick,
    renderTranscript,
    findLiteralTranscriptMatches,
    clearTranscriptSearchHighlights,
    markTranscriptTextNode,
    updateTranscriptSearchControls,
    revealCurrentTranscriptSearchMatch,
    refreshTranscriptSearch,
    moveTranscriptSearch,
    resetTranscriptSearch,
    setupTranscriptSearch,
    getDisplayedTranscriptText,
    startPlaybackTracking,
    stopPlaybackTracking,
    playbackTrackingTick,
    scrollToActiveEntry,
    highlightActiveEntry,
    onContentAreaScroll,
    getTranscriptViewStateStorage,
    loadTranscriptViewState,
    saveTranscriptViewState,
    scheduleTranscriptViewStateSave,
    saveCurrentTranscriptViewState,
    transcriptTabIsActive,
    captureCurrentTranscriptScrollTop,
    restorePendingTranscriptViewState,
    loadDisplayLanguageMode,
    saveDisplayLanguageMode,
    getActiveTranscriptSegments,
    setTranscriptModeButtons,
    handleDisplayLanguageModeChange,
  };
}
