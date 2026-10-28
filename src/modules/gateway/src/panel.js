import { mountActionIcons } from "./icons.js";
// Derived from YouTube Digest (MIT); see LICENSE and NOTICE.
export function mountPanel(api, createViews) {
  mountActionIcons();
  const YTD_EXPORT = api.export;
  /**
   * SIDE PANEL LOGIC
   *
   * Handles the UI for YouTube Scaffold: video detection, transcript analysis,
   * rendering results, and export features.
   */

  const DEBUG = false;
  const debugLog = (...args) => {
    if (DEBUG) console.log(...args);
  };

  // ============================================================
  // STATE
  // ============================================================

  let currentVideoId = null;
  let contentGeneration = 0;
  let analysisGeneration = 0;
  let currentVideoUrl = null;
  let currentAnalysis = null;
  let currentTranscript = null;
  let currentTranscriptText = null; // Plain text (for display/export)
  let currentTranscriptTimestamped = null; // With timestamps for AI analysis
  let currentTranscriptLanguage = null;
  let currentVideoTitle = "";
  let currentChannelName = "";
  let currentVideoDescription = "";
  let currentVideoDuration = 0;
  let isAnalysisLoading = false; // Track if analysis is in progress
  let youtubeTabId = null; // Store the YouTube tab ID for reliable messaging
  let errorAction = null;

  // --- Translation state ---
  // The universal language control supports original content, Chinese, and an
  // aligned bilingual view across Transcript, Overview, and Notes.
  let currentTranscriptMode = "original";
  const DISPLAY_LANGUAGE_MODE_KEY = "ytd_display_language_modes_by_video";
  const DISPLAY_LANGUAGE_MODES = new Set(["original", "zh", "bilingual"]);
  let translationGeneration = 0; // Invalidates responses from older UI modes/videos.
  let translationWorkCount = 0;
  let transcriptScrollObserver = null;
  // Stable keys include the video, source mode, language, and semantic segment ID.
  let transcriptParagraphCache = new Map();
  let interfaceTranslationCache = new Map();
  let interfaceTranslationInFlight = new Set();
  let interfaceTranslationFailures = new Set();
  let currentNotes = [];
  let currentNotesFilterVideoId = null;
  const TRANSLATION_MESSAGE_TIMEOUT_MS = 130_000;
  const TRANSLATION_BATCH_SIZE = 3;

  // --- Transcript search state ---
  // Matches point to visible marks in the active transcript language mode.
  // Search navigation only scrolls the panel. It does not seek the video.
  let transcriptSearchMatches = [];
  let transcriptSearchIndex = -1;

  /**
   * Prevent a stopped service worker or dead message channel from leaving the
   * transcript queue stuck forever. The underlying Chrome message cannot be
   * cancelled, so settled guards deliberately ignore any late response.
   */
  function sendTranslationMessage(message) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let timeoutId;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        callback(value);
      };

      timeoutId = setTimeout(() => {
        finish(
          reject,
          new Error(
            "Translation request timed out after 130 seconds. Please Retry.",
          ),
        );
      }, TRANSLATION_MESSAGE_TIMEOUT_MS);

      let messagePromise;
      try {
        messagePromise = api.sendMessage(message);
      } catch (error) {
        finish(reject, error);
        return;
      }

      Promise.resolve(messagePromise).then(
        (result) => finish(resolve, result),
        (error) => finish(reject, error),
      );
    });
  }

  // --- Auto-scroll state (follow video playback in transcript) ---
  let autoScrollEnabled = true; // True = scroll transcript to follow video playback
  let autoScrollInterval = null; // setInterval ID for polling video time
  let lastAutoScrollTime = 0; // Timestamp of last programmatic scroll (ignores scroll events within 1s)

  // --- Transcript reading position state ---
  // Session storage survives a side panel close but clears when Chrome closes.
  const TRANSCRIPT_VIEW_STATE_KEY = "ytd_transcript_view_state";
  let pendingTranscriptViewState = null;
  let transcriptViewStateSaveTimer = null;
  let isRestoringTranscriptView = false;
  let selectionActionsController = null;
  let lastTranscriptScrollTop = 0;

  // ============================================================
  // TRANSCRIPT GROUPING
  // ============================================================

  function normalizeCaptionText(...args) {
    return views.normalizeCaptionText(...args);
  }

  /**
   * Splits a single oversized thought at the strongest nearby punctuation.
   * Word boundaries are the final safety valve for captions with no punctuation.
   */
  function splitOversizedThought(...args) {
    return views.splitOversizedThought(...args);
  }

  /**
   * Reconstructs complete sentences across raw caption boundaries. Each segment
   * keeps the timestamp of the first caption that contributed text. Character
   * and time limits prevent a malformed Supadata entry from becoming one giant
   * row while punctuation remains the preferred boundary.
   */
  function groupTranscriptEntries(...args) {
    return views.groupTranscriptEntries(...args);
  }

  // ============================================================
  // INITIALIZATION
  // ============================================================

  document.addEventListener("DOMContentLoaded", async () => {
    setTranscriptModeButtons("original");
    setupEventListeners();
    await evictOldCacheEntries(20);

    const configStatus = await api.sendMessage({
      action: "checkConfig",
    });

    if (!configStatus.hasSupadataKey || !configStatus.hasAiKey) {
      showConfigError(configStatus);
      return;
    }

    await checkCurrentTab();
  });

  // Listen for messages from the Digest button on YouTube page
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "startDigestFromButton") {
      // Load the digest for the current video. Served from cache when we've
      // seen this video before (no API calls); fetched fresh otherwise.
      // (This used to force-clear the cache on every click, which silently
      // burned a transcript credit + analysis tokens per click.)
      checkCurrentTab();
      sendResponse({ success: true });
    }
    if (message.action === "transcriptProgress") {
      // Background is telling us the transcript fetch status changed
      updateLoading(message.title, message.subtitle);
      sendResponse({ success: true });
    }
    if (message.action === "dataReset") {
      window.location.reload();
      return;
    }
    if (message.action === "noteSaved") {
      // Refresh notes list when a new note is saved
      const filterAll = document
        .getElementById("notesFilterAll")
        ?.classList.contains("active");
      loadNotes(filterAll ? null : currentVideoId);
      sendResponse({ success: true });
    }
    return false;
  });

  // ============================================================
  // FOLLOW THE ACTIVE TAB
  // ============================================================
  // The panel watches which tab is in front of it and reacts:
  //   - Front tab is NOT YouTube  -> the panel closes itself (window.close()).
  //     We do this OURSELVES rather than relying only on the background
  //     script's per-tab enable/disable, because Chrome doesn't reliably
  //     apply per-tab panel state to tabs spawned in unusual ways (e.g. a
  //     link opened from another app) — which let the panel linger on
  //     non-YouTube pages.
  //   - Front tab IS YouTube but on a different video -> refresh the digest.
  //     YouTube is a single-page app (clicking a video swaps content without
  //     a reload), so we track URL changes; startDigest() caches per video,
  //     making re-checks instant and free for already-digested videos.
  //
  // Everything is scoped to the window this panel lives in: tab switches in
  // OTHER browser windows must not close this panel or hijack its content.

  let navigationRefreshTimer = null;
  let panelWindowId = null;
  chrome.windows.getCurrent().then((w) => {
    panelWindowId = w.id;
  });

  function scheduleDigestRefresh() {
    // Small delay lets YouTube finish rendering the new video's title and
    // description before we read them. Also collapses rapid-fire URL events
    // into a single refresh.
    clearTimeout(navigationRefreshTimer);
    navigationRefreshTimer = setTimeout(() => {
      checkCurrentTab();
    }, 600);
  }

  function panelIsShowingResults() {
    const results = document.getElementById("resultsState");
    return results && results.style.display !== "none";
  }

  /**
   * Reacts to the URL now in front of the panel: close on non-YouTube,
   * refresh the digest when the video changed.
   */
  function handleFrontTabUrl(url) {
    if (!(url || "").startsWith("https://www.youtube.com")) {
      // Start the position save, then close in this same event callback. Chrome
      // does not reliably honor window.close() after an asynchronous wait.
      void saveCurrentTranscriptViewState();
      window.close();
      return;
    }

    const newVideoId = extractVideoId(url);
    // Refresh when the video changed, or when we're not currently showing
    // results (e.g. user went home, then clicked back into the same video).
    if (newVideoId !== currentVideoId || !panelIsShowingResults()) {
      scheduleDigestRefresh();
    }
  }

  /**
   * Gets the best URL from a tab update that can change the visible page.
   * The status events repeat the close request after Chrome commits the first
   * non-YouTube navigation, when an early URL event alone can be lost.
   */
  function getNavigationUrl(changeInfo, tab) {
    if (changeInfo.url) return changeInfo.url;
    if (changeInfo.status !== "loading" && changeInfo.status !== "complete") {
      return "";
    }
    return tab.pendingUrl || tab.url || "";
  }

  // Fires when a tab starts or completes navigation, including YouTube's
  // no-reload navigation. The completion event is a deliberate second close
  // attempt for the first non-YouTube page.
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (!tab.active) return;
    if (panelWindowId !== null && tab.windowId !== panelWindowId) return;
    const url = getNavigationUrl(changeInfo, tab);
    if (!url) return;
    handleFrontTabUrl(url);
  });

  // Fires when a different tab comes to the front — switching tabs, or a new
  // tab being opened (including ones opened by clicking links in other apps).
  chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
    if (panelWindowId !== null && windowId !== panelWindowId) return;
    try {
      const tab = await chrome.tabs.get(tabId);
      // Brand-new tabs may not have committed their URL yet — fall back to
      // the pending one so we judge where the tab is actually going.
      handleFrontTabUrl(tab.url || tab.pendingUrl || "");
    } catch (e) {
      // Tab closed before we could read it — nothing to do.
    }
  });

  function setupEventListeners() {
    // Tab switching
    document.querySelectorAll(".tab").forEach((tab) => {
      tab.addEventListener("click", () => switchTab(tab.dataset.tab));
    });

    // Error retry
    document.getElementById("errorBtn").addEventListener("click", () => {
      if (errorAction) {
        errorAction();
        return;
      }
      if (currentVideoId) {
        startDigest(currentVideoId, currentVideoUrl);
      }
    });

    document.getElementById("settingsBtn")?.addEventListener("click", () => {
      api.sendMessage({ action: "openOptions" });
    });

    // Transcript actions
    document
      .getElementById("copyTranscriptBtn")
      ?.addEventListener("click", copyTranscript);
    document
      .getElementById("exportTranscriptBtn")
      ?.addEventListener("click", exportTranscript);
    document
      .getElementById("exportStudyBtn")
      ?.addEventListener("click", exportStudy);
    document.querySelectorAll(".transcript-mode-btn").forEach((button) => {
      button.addEventListener("click", () => {
        handleDisplayLanguageModeChange(button.dataset.transcriptMode);
      });
    });
    setupTranscriptSearch();

    // pagehide also covers closing the side panel without a tab change.
    window.addEventListener("pagehide", () => {
      void saveCurrentTranscriptViewState();
    });

    // Follow playback button — re-enables auto-scroll after user scrolled away
    document
      .getElementById("followPlaybackBtn")
      ?.addEventListener("click", () => {
        autoScrollEnabled = true;
        document.getElementById("followPlaybackBtn").style.display = "none";
        // Jump straight back to the line currently being spoken. We scroll
        // directly (not via playbackTrackingTick) because the tick skips
        // entries that are already highlighted — and the current line almost
        // always IS highlighted, which made this button appear to do nothing.
        if (!scrollToActiveEntry()) {
          playbackTrackingTick(); // No highlight yet — let a tick establish one
        }
      });

    // Notes filter buttons
    document
      .getElementById("notesFilterThis")
      ?.addEventListener("click", () => {
        setNotesFilter(false);
        loadNotes(currentVideoId);
      });
    document.getElementById("notesFilterAll")?.addEventListener("click", () => {
      setNotesFilter(true);
      loadNotes(null); // Load all notes
    });
  }

  function setNotesFilter(showAll) {
    const thisVideoButton = document.getElementById("notesFilterThis");
    const allNotesButton = document.getElementById("notesFilterAll");
    thisVideoButton?.classList.toggle("active", !showAll);
    thisVideoButton?.setAttribute("aria-pressed", String(!showAll));
    allNotesButton?.classList.toggle("active", showAll);
    allNotesButton?.setAttribute("aria-pressed", String(showAll));
  }

  // ============================================================
  // VIDEO DETECTION
  // ============================================================

  let navigationGeneration = 0;
  async function checkCurrentTab() {
    const navigation = ++navigationGeneration;
    try {
      // The panel belongs only to the active tab. Looking for another open
      // YouTube tab here can keep an old transcript visible on a non-YouTube
      // page, so never fall back to background tabs.
      const tabs = await chrome.tabs.query({
        active: true,
        ...(panelWindowId === null
          ? { currentWindow: true }
          : { windowId: panelWindowId }),
      });
      if (navigation !== navigationGeneration) return;
      const tab = tabs[0] || null;

      debugLog("[YouTube Scaffold Panel] Found tab:", tab?.id, tab?.url);

      if (!tab?.url) {
        showState("welcome");
        return;
      }

      if (!tab.url.startsWith("https://www.youtube.com")) {
        handleFrontTabUrl(tab.url);
        return;
      }

      // Store the tab ID for reliable messaging later
      youtubeTabId = tab.id;

      const videoId = extractVideoId(tab.url);

      if (videoId) {
        currentVideoUrl = tab.url;

        try {
          // Route through background script for reliable message passing
          const result = await api.sendMessage({
            action: "relayToContent",
            targetTabId: youtubeTabId,
            expectedVideoId: videoId,
            payload: { action: "getVideoInfo" },
          });
          debugLog("[YouTube Scaffold Panel] getVideoInfo result:", result);
          if (navigation !== navigationGeneration) return;
          if (result.success && result.response) {
            currentVideoTitle = result.response.title || "";
            currentChannelName = result.response.channelName || "";
            currentVideoDescription = result.response.description || "";
            currentVideoDuration = result.response.duration || 0;
          }
        } catch (e) {
          console.error("[YouTube Scaffold Panel] getVideoInfo error:", e);
          currentVideoTitle = "";
          currentChannelName = "";
          currentVideoDescription = "";
          currentVideoDuration = 0;
        }

        if (navigation !== navigationGeneration) return;
        startDigest(videoId, tab.url);
      } else {
        showState("welcome");
      }
    } catch (error) {
      console.error("Tab check error:", error);
      showState("welcome");
    }
  }

  function extractVideoId(url) {
    try {
      const urlObj = new URL(url);

      if (
        urlObj.hostname.includes("youtube.com") &&
        urlObj.searchParams.has("v")
      ) {
        return urlObj.searchParams.get("v");
      }

      if (urlObj.hostname === "youtu.be") {
        return urlObj.pathname.slice(1);
      }

      if (urlObj.pathname.startsWith("/embed/")) {
        return urlObj.pathname.split("/")[2];
      }

      return null;
    } catch {
      return null;
    }
  }

  // ============================================================
  // DIGEST PIPELINE
  // ============================================================

  /** Material acquisition is correlated before any await; UI state is only a projection. */
  async function startDigest(videoId, videoUrl) {
    const generation = ++contentGeneration;
    const isCurrent = () =>
      generation === contentGeneration && currentVideoId === videoId;
    if (videoId === currentVideoId && currentAnalysis) {
      showState("results");
      return;
    }
    const changed = videoId !== currentVideoId;
    if (changed) void saveCurrentTranscriptViewState();
    currentVideoId = videoId;
    currentVideoUrl = videoUrl;
    currentAnalysis = null;
    currentTranscript = null;
    currentTranscriptText = null;
    currentTranscriptTimestamped = null;
    currentTranscriptLanguage = null;
    isAnalysisLoading = false;
    if (changed) {
      analysisGeneration += 1;
      translationGeneration += 1;
      transcriptScrollObserver?.disconnect();
      transcriptScrollObserver = null;
      resetTranscriptSearch();
      dismissSelectionActions(true);
      lastTranscriptScrollTop = 0;
      setNotesFilter(false);
    }
    showState("loading");
    updateLoading("Fetching transcript", "");
    if (changed) {
      const position = await loadTranscriptViewState(videoId);
      if (!isCurrent()) return;
      pendingTranscriptViewState = position;
      const mode = await loadDisplayLanguageMode(videoId);
      if (!isCurrent()) return;
      currentTranscriptMode = mode;
      setTranscriptModeButtons(mode);
    }
    const cached = await loadFromCache(videoId);
    if (!isCurrent()) return;
    if (cached) {
      currentAnalysis = cached.analysis || null;
      currentTranscript = cached.transcript;
      currentTranscriptText = cached.transcriptText;
      currentTranscriptTimestamped = cached.transcriptTimestamped;
      currentTranscriptLanguage = cached.transcriptLanguage || null;
      currentVideoTitle ||= cached.videoTitle || "";
      currentChannelName ||= cached.channelName || "";
      for (const [key, value] of Object.entries(cached.paragraphCache || {}))
        transcriptParagraphCache.set(key, value);
      for (const [key, value] of Object.entries(cached.interfaceCache || {}))
        interfaceTranslationCache.set(key, value);
    } else {
      const result = await api.sendMessage({
        action: "fetchTranscript",
        videoId,
      });
      if (!isCurrent()) return;
      if (!result.success) {
        showError(
          result.error === "NO_SUPADATA_KEY"
            ? "API key missing"
            : "No transcript found",
          result.message || result.error,
        );
        return;
      }
      currentTranscript = result.transcript;
      currentTranscriptText = result.transcriptText;
      currentTranscriptTimestamped = result.transcriptTextTimestamped;
      currentTranscriptLanguage = result.language || null;
    }
    const info = document.getElementById("videoInfo");
    document.getElementById("videoTitle").textContent = currentVideoTitle;
    document.getElementById("videoChannel").textContent = currentChannelName;
    info.style.display =
      currentVideoTitle || currentChannelName ? "block" : "none";
    renderTranscript();
    if (currentAnalysis) renderAnalysisResults(currentAnalysis);
    showState("results");
    document.getElementById("tabsNav").style.display = "flex";
    restorePendingTranscriptViewState(videoId);
    void loadNotes(videoId);
    setupExplainFeature();
    if (currentTranscriptMode !== "original") void translateTranscript();
    if (!cached) await saveToCache(videoId);
    // Summary remains lazy; reading alone never starts an AI request.
  }

  // ============================================================
  // RENDERING
  // ============================================================

  function interfaceTranslationCacheKey(...args) {
    return views.interfaceTranslationCacheKey(...args);
  }

  function getInterfaceTranslation(...args) {
    return views.getInterfaceTranslation(...args);
  }

  function renderLocalizedContent(...args) {
    return views.renderLocalizedContent(...args);
  }

  function getLocalizedPlainText(...args) {
    return views.getLocalizedPlainText(...args);
  }

  function translateInterfaceSegments(...args) {
    return views.translateInterfaceSegments(...args);
  }

  function getOverviewTranslationSegments(...args) {
    return views.getOverviewTranslationSegments(...args);
  }

  function translateOverviewContent() {
    return translateInterfaceSegments(
      "overview",
      getOverviewTranslationSegments(),
      () => {
        const contentArea = document.getElementById("contentArea");
        const scrollTop = contentArea?.scrollTop || 0;
        renderAnalysisResults(currentAnalysis);
        if (contentArea) contentArea.scrollTop = scrollTop;
      },
    );
  }

  function getNoteTranslationId(...args) {
    return views.getNoteTranslationId(...args);
  }

  function translateNotesContent() {
    const segments = currentNotes.map((note, index) => ({
      id: getNoteTranslationId(note, index),
      text: note.text || "",
    }));
    return translateInterfaceSegments("notes", segments, () => {
      const contentArea = document.getElementById("contentArea");
      const scrollTop = contentArea?.scrollTop || 0;
      renderNotes(currentNotes, currentNotesFilterVideoId);
      if (contentArea) contentArea.scrollTop = scrollTop;
    });
  }

  /**
   * Renders the analysis results into the Overview tab.
   * Shows chapters and key quotes only.
   */
  function renderAnalysisResults(...args) {
    return views.renderAnalysisResults(...args);
  }

  /**
   * Saves a key quote as a timestamped note.
   */
  function saveQuoteAsNote(...args) {
    return views.saveQuoteAsNote(...args);
  }

  /**
   * Legacy function for backwards compatibility with cached data.
   * Renders both transcript and analysis.
   */
  function renderResults(...args) {
    return views.renderResults(...args);
  }

  /**
   * Returns true while the user has a range of text selected.
   * Transcript row clicks must not seek in that state: the click emitted after
   * selection mouseup belongs to the selection/explain interaction, not playback.
   */
  function hasNonCollapsedTextSelection(...args) {
    return views.hasNonCollapsedTextSelection(...args);
  }

  /**
   * Preserves normal row-click seeking while keeping text selection inert.
   */
  function seekFromTranscriptEntryClick(...args) {
    return views.seekFromTranscriptEntryClick(...args);
  }

  function renderTranscript(...args) {
    return views.renderTranscript(...args);
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
    return views.findLiteralTranscriptMatches(...args);
  }

  /**
   * Removes old marks before a new search. Restoring plain text first prevents
   * nested marks when the user types one more letter into the search field.
   */
  function clearTranscriptSearchHighlights(...args) {
    return views.clearTranscriptSearchHighlights(...args);
  }

  /**
   * Replaces matching parts of one text node with mark elements. We collect all
   * text nodes before changing the DOM, so each replacement is safe and stable.
   */
  function markTranscriptTextNode(...args) {
    return views.markTranscriptTextNode(...args);
  }

  /**
   * Updates the result count and navigation buttons from the current search
   * state. The live output gives the same information to screen reader users.
   */
  function updateTranscriptSearchControls(...args) {
    return views.updateTranscriptSearchControls(...args);
  }

  /**
   * Shows which match is current. Search navigation pauses automatic transcript
   * following, so playback cannot pull the user away from the result they found.
   */
  function revealCurrentTranscriptSearchMatch(...args) {
    return views.revealCurrentTranscriptSearchMatch(...args);
  }

  /**
   * Searches the transcript that is visible now. This means Original searches
   * source subtitles, Chinese searches translated text, and Bilingual searches
   * both columns. Translated rows call this again as their text arrives.
   */
  function refreshTranscriptSearch(...args) {
    return views.refreshTranscriptSearch(...args);
  }

  /**
   * Moves through results in a loop, like the browser's built-in Find control.
   */
  function moveTranscriptSearch(...args) {
    return views.moveTranscriptSearch(...args);
  }

  /**
   * Clears search when the user opens a different video. A query for the old
   * video is unlikely to help and can make the next transcript look empty.
   */
  function resetTranscriptSearch(...args) {
    return views.resetTranscriptSearch(...args);
  }

  /**
   * Wires mouse and keyboard controls once when the side panel starts.
   */
  function setupTranscriptSearch(...args) {
    return views.setupTranscriptSearch(...args);
  }

  function getDisplayedTranscriptText(...args) {
    return views.getDisplayedTranscriptText(...args);
  }

  function copyTranscript(...args) {
    return views.copyTranscript(...args);
  }

  function exportTranscript(...args) {
    return views.exportTranscript(...args);
  }

  function exportStudy(...args) {
    return views.exportStudy(...args);
  }

  // ============================================================
  // UI STATE MANAGEMENT
  // ============================================================

  function showState(state) {
    document.getElementById("welcomeState").style.display =
      state === "welcome" ? "flex" : "none";
    document.getElementById("loadingState").style.display =
      state === "loading" ? "block" : "none";
    document.getElementById("errorState").style.display =
      state === "error" ? "block" : "none";
    const uploadEl = document.getElementById("uploadState");
    if (uploadEl) uploadEl.style.display = "none"; // Upload state removed — always hidden
    document.getElementById("resultsState").style.display =
      state === "results" ? "block" : "none";

    // The tab bar only belongs on the results view. We toggle it HERE, in one
    // place, so it tracks the view automatically. Previously each caller had to
    // remember to re-show it after showState("results"), and one path forgot —
    // which is why the tabs could vanish when re-opening an already-analyzed video.
    document.getElementById("tabsNav").style.display =
      state === "results" ? "flex" : "none";
    document.getElementById("transcriptModeControl").style.display =
      state === "results" ? "inline-flex" : "none";

    if (state !== "results") {
      stopPlaybackTracking();
    }
  }

  function updateLoading(title, subtitle) {
    document.getElementById("loadingText").textContent = title;
    document.getElementById("loadingSubtext").textContent = subtitle;
  }

  function showError(title, message) {
    errorAction = null;
    showState("error");
    document.getElementById("errorTitle").textContent = title;
    document.getElementById("errorMessage").textContent = message;
    document.getElementById("errorBtn").textContent = "Try Again";
  }

  function showConfigError(configStatus) {
    const missingKeys = [];
    if (!configStatus.hasSupadataKey) missingKeys.push("Supadata");
    if (!configStatus.hasAiKey) missingKeys.push("AI provider");

    showState("error");
    document.getElementById("errorTitle").textContent = "API Keys Missing";
    document.getElementById("errorMessage").textContent =
      `Add your ${missingKeys.join(" and ")} API key${missingKeys.length === 1 ? "" : "s"} in YouTube Scaffold Settings.`;
    document.getElementById("errorBtn").textContent = "Open Settings";
    errorAction = () => api.sendMessage({ action: "openOptions" });
  }

  // ============================================================
  // TAB SWITCHING
  // ============================================================

  function switchTab(tabName) {
    // Capture the transcript position before another tab reuses the same scroll
    // area. Scrolling Overview or Notes must not replace this value.
    if (tabName !== "transcript" && transcriptTabIsActive()) {
      captureCurrentTranscriptScrollTop();
      dismissSelectionActions(true);
    }

    document.querySelectorAll(".tab").forEach((tab) => {
      tab.classList.toggle("active", tab.dataset.tab === tabName);
    });

    document.querySelectorAll(".tab-panel").forEach((panel) => {
      panel.classList.toggle("active", panel.dataset.panel === tabName);
    });

    // Start/stop playback tracking based on which tab is active
    if (tabName === "transcript") {
      // Notes always opens at the top, so restore the independent transcript
      // reading position when the user returns here.
      requestAnimationFrame(() => {
        const contentArea = document.getElementById("contentArea");
        if (!contentArea || !transcriptTabIsActive()) return;
        lastAutoScrollTime = Date.now();
        contentArea.scrollTop = lastTranscriptScrollTop;
      });
      startPlaybackTracking();
    } else {
      stopPlaybackTracking();
    }

    // Saved notes are stored newest first. Open Notes at the top so the note the
    // user just created is the first item they see.
    if (tabName === "notes") {
      requestAnimationFrame(() => {
        const contentArea = document.getElementById("contentArea");
        const notesPanelIsActive = document.querySelector(
          '.tab-panel[data-panel="notes"].active',
        );
        if (contentArea && notesPanelIsActive) contentArea.scrollTop = 0;
      });
    }

    // Translate only the visible tab. This prevents hidden surfaces from using
    // tokens or competing with the batch queue the user is waiting for.
    if (tabName === "overview") {
      if (!currentAnalysis && !isAnalysisLoading) {
        triggerAnalysis();
      } else if (currentAnalysis && currentTranscriptMode !== "original") {
        void translateOverviewContent();
      }
    } else if (tabName === "notes" && currentTranscriptMode !== "original") {
      void translateNotesContent();
    } else if (
      tabName === "transcript" &&
      currentTranscriptMode !== "original" &&
      !transcriptScrollObserver
    ) {
      void translateTranscript();
    }
  }

  /**
   * Triggers the LLM analysis (lazy-loaded when user clicks Overview or Quotes tab).
   * This saves tokens by not running analysis until needed.
   */
  function triggerAnalysis(...args) {
    return views.triggerAnalysis(...args);
  }

  // ============================================================
  // TIMESTAMP / SEEK
  // ============================================================

  async function seekTo(seconds) {
    debugLog("[YouTube Scaffold Panel] seekTo called with:", seconds);
    if (seconds === undefined || seconds === null) {
      debugLog("[YouTube Scaffold Panel] seekTo aborted - no seconds value");
      return;
    }

    const payload = {
      action: "seekTo",
      seconds: Number(seconds),
    };

    try {
      // Try direct messaging to the stored YouTube tab first (fastest/reliable)
      if (youtubeTabId) {
        try {
          await chrome.tabs.sendMessage(youtubeTabId, payload);
          debugLog("[YouTube Scaffold Panel] seekTo direct success");
          return;
        } catch (directErr) {
          debugLog(
            "[YouTube Scaffold Panel] Direct seekTo failed, falling back to relay:",
            directErr.message,
          );
        }
      }

      // Fallback: route through background script
      const result = await api.sendMessage({
        action: "relayToContent",
        targetTabId: youtubeTabId,
        expectedVideoId: currentVideoId,
        payload,
      });
      debugLog("[YouTube Scaffold Panel] seekTo relay result:", result);
    } catch (error) {
      console.error("[YouTube Scaffold Panel] seekTo error:", error);
    }
  }

  /**
   * Plays a saved note at its timestamp.
   * - If the note belongs to the video currently open, we seek the player in place.
   * - If it belongs to a DIFFERENT video (e.g. viewing "All Notes"), seeking the
   *   current player would jump to the wrong content, so we open that video in a
   *   new tab at the right timestamp instead.
   */
  function playNote(note) {
    if (note.videoId && note.videoId === currentVideoId) {
      seekTo(note.timestampSeconds);
    } else {
      // note.timestampedUrl already includes the &t=<seconds>s anchor
      chrome.tabs.create({ url: note.timestampedUrl });
    }
  }

  async function highlightMomentsOnPage(moments) {
    if (!moments || !moments.length) return;

    try {
      // Route through background script for reliable message passing
      await api.sendMessage({
        action: "relayToContent",
        targetTabId: youtubeTabId,
        expectedVideoId: currentVideoId,
        payload: {
          action: "highlightMoments",
          moments: moments,
          videoDuration: currentVideoDuration,
        },
      });
    } catch (error) {
      console.error("Highlight error:", error);
    }
  }

  // ============================================================
  // UTILITY
  // ============================================================

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text || "";
    return div.innerHTML;
  }

  /**
   * Renders the small subset of inline formatting commonly present in subtitle
   * tracks and model translations. Everything is escaped first; only exact,
   * attribute-free allowlisted tags are restored as markup afterwards.
   */
  function renderSubtitleInlineMarkup(text) {
    return escapeHtml(text).replace(
      /&lt;(\/?)(i|em|b|strong|u)&gt;|&lt;br(?:\s*\/)?&gt;/gi,
      (_match, closing, tagName) =>
        tagName ? `<${closing}${tagName.toLowerCase()}>` : "<br>",
    );
  }

  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (error) {
      console.error("Copy failed:", error);
      return false;
    }
  }

  async function copyToClipboardWithFeedback(text, buttonId) {
    const btn = document.getElementById(buttonId);
    const original = btn.textContent;

    const success = await copyToClipboard(text);
    if (success) {
      btn.textContent = "Copied";
      setTimeout(() => {
        btn.textContent = original;
      }, 2000);
    }
  }

  function downloadTextFile(...args) {
    return views.downloadTextFile(...args);
  }

  function sanitizeFilename(...args) {
    return views.sanitizeFilename(...args);
  }

  // ============================================================
  // TEXT SELECTION ACTIONS
  // ============================================================

  /**
   * Hides actions that belong only to a live transcript selection. Clearing the
   * browser range also prevents the toolbar from returning on another tab.
   */
  function dismissSelectionActions(clearSelection = false) {
    const tooltip = document.getElementById("explainTooltip");
    if (tooltip) tooltip.style.display = "none";
    if (clearSelection) window.getSelection()?.removeAllRanges();
  }

  /**
   * Sets up text selection handling in the transcript.
   * When the user selects text, shows Explain and Note actions.
   */
  function captureWordContext(term, row) {
    const source = api.reading.vocabularyContext(
      currentTranscript || [],
      row?.dataset.segmentId,
      Number(row?.dataset.seconds),
    );
    const translation = row?.querySelector(
      ".transcript-translation:not(.translation-pending):not(.translation-error)",
    );
    return {
      term,
      videoId: currentVideoId,
      videoTitle: currentVideoTitle,
      ...source,
      sentenceZh: translation?.textContent.trim() || "",
    };
  }

  function setupExplainFeature() {
    const transcriptList = document.getElementById("transcriptList");
    if (!transcriptList) return;

    // This setup can run again after a cached transcript render. Abort old
    // document listeners so one selection creates only one action toolbar.
    selectionActionsController?.abort();
    selectionActionsController = new AbortController();
    const selectionSignal = selectionActionsController.signal;

    // Remove existing tooltip if any
    const existingTooltip = document.getElementById("explainTooltip");
    if (existingTooltip) existingTooltip.remove();

    // Create one small toolbar for actions on the selected transcript text.
    const tooltip = document.createElement("div");
    tooltip.id = "explainTooltip";
    tooltip.className = "explain-tooltip";
    tooltip.setAttribute("role", "toolbar");
    tooltip.setAttribute("aria-label", "Selected transcript actions");
    tooltip.innerHTML = `
    <button class="explain-btn" type="button">Explain</button>
    <button class="selection-note-btn" type="button">Note</button>
    <button class="selection-vocabulary-btn" type="button" disabled>加入单词本（请选择一个完整英文单词）</button>
    <span class="selection-vocabulary-status" role="status"></span>
  `;
    tooltip.style.display = "none";
    document.body.appendChild(tooltip);

    let selectedText = "";
    let selectedTimestamp = 0;
    let selectionSnapshot = null;
    let vocabularyCapture = null;
    let vocabularySaving = false;

    // Interacting with either action must preserve the transcript selection and
    // stay isolated from document and row click behavior.
    tooltip.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    tooltip.addEventListener("mouseup", (event) => {
      event.stopPropagation();
    });
    tooltip.addEventListener("click", (event) => {
      event.stopPropagation();
    });

    // Listen for text selection
    document.addEventListener(
      "mouseup",
      () => {
        const selection = window.getSelection();
        const text = selection?.toString().trim() || "";
        const range = selection?.rangeCount ? selection.getRangeAt(0) : null;

        // Both ends must be inside the transcript. The first selected row
        // supplies the timestamp when the selection spans more than one row.
        const isInTranscript = Boolean(
          range &&
            transcriptList.contains(range.startContainer) &&
            transcriptList.contains(range.endContainer),
        );

        // Allow any selection length.
        if (text.length > 0 && isInTranscript) {
          selectedText = text;
          const startElement =
            range.startContainer.nodeType === 1
              ? range.startContainer
              : range.startContainer.parentElement;
          const selectedRow = startElement?.closest(".transcript-entry");
          const rowSeconds = Number(selectedRow?.dataset.seconds);
          selectedTimestamp = Number.isFinite(rowSeconds) ? rowSeconds : 0;
          const endpointRole = (node) => {
            const element = node.nodeType === 1 ? node : node.parentElement;
            return element?.closest(".transcript-translation")
              ? "translation"
              : "source";
          };
          const firstRole = endpointRole(range.startContainer),
            lastRole = endpointRole(range.endContainer);
          selectionSnapshot = api.reading.selection(
            currentVideoId,
            text,
            selectedTimestamp,
            firstRole === lastRole ? firstRole : "mixed",
            currentTranscript || [],
            selectedRow?.dataset.segmentId,
          );

          vocabularyCapture = null;
          const sourceElement = startElement?.closest(
            ".transcript-text, .transcript-original",
          );
          let wholeToken = false;
          if (sourceElement?.contains(range.endContainer)) {
            const before = range.cloneRange(),
              after = range.cloneRange();
            before.selectNodeContents(sourceElement);
            before.setEnd(range.startContainer, range.startOffset);
            after.selectNodeContents(sourceElement);
            after.setStart(range.endContainer, range.endOffset);
            wholeToken =
              !/[A-Za-z'’-]$/.test(before.toString()) &&
              !/^[A-Za-z'’-]/.test(after.toString());
          }
          if (
            wholeToken &&
            firstRole === "source" &&
            lastRole === "source" &&
            currentTranscriptMode !== "zh" &&
            /^[A-Za-z]+(?:['’-][A-Za-z]+)*$/.test(text) &&
            text.length <= 80 &&
            (!currentTranscriptLanguage ||
              /^en(?:-|$)/i.test(currentTranscriptLanguage))
          ) {
            try {
              vocabularyCapture = captureWordContext(text, selectedRow);
            } catch {
              /* Keep note/explain available. */
            }
          }
          // Keep the action discoverable even when the current selection is a phrase or translation.
          const vocabularyButton = tooltip.querySelector(
            ".selection-vocabulary-btn",
          );
          vocabularyButton.disabled = !vocabularyCapture || vocabularySaving;
          if (!vocabularySaving)
            vocabularyButton.textContent = vocabularyCapture
              ? "加入单词本"
              : "加入单词本（请选择一个完整英文单词）";
          tooltip.querySelector(".selection-vocabulary-status").textContent =
            "";

          // Set the final coordinates while the toolbar is still hidden. If it
          // becomes visible first, Chrome paints it at its default left edge for
          // one frame before moving it to the selection center.
          const rect = range.getBoundingClientRect();
          tooltip.style.top = `${rect.bottom + window.scrollY + 8}px`;
          tooltip.style.left = `${rect.left + rect.width / 2}px`;
          tooltip.style.display = "flex";
        } else {
          tooltip.style.display = "none";
        }
      },
      { signal: selectionSignal },
    );

    // Hide tooltip when clicking elsewhere
    document.addEventListener(
      "mousedown",
      (event) => {
        if (!tooltip.contains(event.target)) {
          tooltip.style.display = "none";
        }
      },
      { signal: selectionSignal },
    );

    tooltip
      .querySelector(".selection-vocabulary-btn")
      .addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const input = vocabularyCapture;
        if (!input || input.videoId !== currentVideoId || vocabularySaving)
          return;
        const button = event.currentTarget;
        const status = tooltip.querySelector(".selection-vocabulary-status");
        vocabularySaving = true;
        button.disabled = true;
        button.textContent = "保存中";
        let feedbackDuration = 900;
        try {
          const result = await views.captureVocabulary(input);
          if (input === vocabularyCapture) {
            button.textContent = "Saved";
            status.textContent = result.duplicate ? "这条来源已收藏" : "已收藏";
          }
        } catch (error) {
          feedbackDuration = 1500;
          if (input === vocabularyCapture) {
            button.textContent = "Error";
            status.textContent = error.message || "收藏失败，请重试";
          }
        } finally {
          vocabularySaving = false;
          // Match the note action: acknowledge first, then restore. A late result
          // must never hide or relabel a newly selected word's toolbar.
          if (input === vocabularyCapture) {
            const succeeded = button.textContent === "Saved";
            setTimeout(() => {
              if (input !== vocabularyCapture) return;
              if (succeeded) tooltip.style.display = "none";
              button.disabled = false;
              button.textContent = "加入单词本";
              status.textContent = "";
            }, feedbackDuration);
          } else {
            button.disabled = !vocabularyCapture;
            button.textContent = vocabularyCapture
              ? "加入单词本"
              : "加入单词本（请选择一个完整英文单词）";
          }
        }
      });

    // Handle explain button click
    tooltip
      .querySelector(".explain-btn")
      .addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!selectedText) return;

        tooltip.style.display = "none";
        if (selectionSnapshot?.origin !== currentVideoId) return;
        await showExplanation(
          selectedText,
          selectedTimestamp,
          selectionSnapshot,
        );
      });

    // Save the exact selected words at the first selected transcript row. This
    // action does not move playback and does not ask the AI to rewrite the text.
    tooltip
      .querySelector(".selection-note-btn")
      .addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (
          !selectedText ||
          !currentVideoId ||
          selectionSnapshot?.origin !== currentVideoId
        )
          return;

        const button = event.currentTarget;
        const originalText = button.textContent;
        button.textContent = "Saving...";
        button.disabled = true;

        try {
          const result = await api.sendMessage({
            action: "saveNote",
            videoId: currentVideoId,
            timestamp: selectedTimestamp,
            videoTitle: currentVideoTitle,
            channelName: currentChannelName,
            selectedText,
          });

          if (!result?.success) {
            throw new Error(result?.error || "Could not save note");
          }

          button.textContent = "Saved";
          loadNotes(currentVideoId);
          setTimeout(() => {
            tooltip.style.display = "none";
            button.textContent = originalText;
            button.disabled = false;
          }, 900);
        } catch (error) {
          console.error("[YouTube Scaffold] Save selected note error:", error);
          button.textContent = "Error";
          setTimeout(() => {
            button.textContent = originalText;
            button.disabled = false;
          }, 1500);
        }
      });
  }

  /**
   * Shows the explanation modal and fetches it from the configured AI provider.
   */
  function showExplanation(...args) {
    return views.showExplanation(...args);
  }

  /**
   * Gets surrounding context from the transcript for the selected text.
   */

  // ============================================================
  // CACHING
  // ============================================================

  /**
   * Saves the current digest results to persistent local storage.
   * Results survive browser restarts — reopening the same video loads from cache
   * without consuming API tokens or Supadata calls.
   * Cache expires after 30 days. Oldest entries evicted when > 20 videos cached.
   */
  async function saveToCache(videoId) {
    if (!videoId || !currentTranscript) return;
    const pick = (map) =>
      Object.fromEntries(
        [...map.entries()].filter(([key]) => key.startsWith(videoId + ":")),
      );
    await api.cache.write(videoId, {
      analysis: currentAnalysis,
      transcript: currentTranscript,
      transcriptText: currentTranscriptText,
      transcriptTimestamped: currentTranscriptTimestamped,
      transcriptLanguage: currentTranscriptLanguage,
      videoTitle: currentVideoTitle,
      channelName: currentChannelName,
      paragraphCache: pick(transcriptParagraphCache),
      interfaceCache: pick(interfaceTranslationCache),
      timestamp: Date.now(),
    });
  }

  /**
   * Keeps the cache from growing unbounded.
   * Removes the oldest entries when we exceed maxEntries videos.
   *
   * @param {number} maxEntries - Maximum number of cached videos to keep
   */
  async function evictOldCacheEntries(maxEntries) {
    return api.cache.evict(maxEntries);
  }

  /**
   * Loads digest results from persistent local storage.
   * Returns null if not cached or expired (30-day expiry).
   */
  async function loadFromCache(videoId) {
    return api.cache.read(videoId);
  }

  /**
   * Updates the cache after enhance or translation operations.
   */
  async function updateCache() {
    if (currentVideoId) {
      await saveToCache(currentVideoId);
    }
  }

  // ============================================================
  // NOTES
  // ============================================================

  /**
   * Loads and renders notes from storage.
   * @param {string|null} videoId - Filter by video ID, or null for all notes
   */
  function loadNotes(...args) {
    return views.loadNotes(...args);
  }

  /**
   * Renders the notes list in the Notes tab.
   */
  function renderNotes(...args) {
    return views.renderNotes(...args);
  }

  /**
   * Deletes a note by ID.
   */
  function deleteNote(...args) {
    return views.deleteNote(...args);
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
  function startPlaybackTracking(...args) {
    return views.startPlaybackTracking(...args);
  }

  /**
   * Stops playback tracking entirely. Called when leaving transcript tab,
   * starting a new digest, or leaving results state.
   */
  function stopPlaybackTracking(...args) {
    return views.stopPlaybackTracking(...args);
  }

  /**
   * One tick of the playback tracker. Gets current video time from the
   * YouTube tab and highlights + scrolls to the matching transcript entry.
   */
  function playbackTrackingTick(...args) {
    return views.playbackTrackingTick(...args);
  }

  /**
   * Scrolls the transcript to the entry currently being spoken (the one
   * carrying the active-playback highlight). Returns false if nothing is
   * highlighted yet. Stamps lastAutoScrollTime BEFORE scrolling so the scroll
   * events from our own smooth animation aren't mistaken for the user
   * scrolling away (which would re-disable auto-scroll immediately).
   */
  function scrollToActiveEntry(...args) {
    return views.scrollToActiveEntry(...args);
  }

  /**
   * Finds the transcript entry matching the current playback time,
   * highlights it, and scrolls to it (if auto-scroll is enabled).
   *
   * @param {number} currentSeconds - Current video playback time in seconds
   */
  function highlightActiveEntry(...args) {
    return views.highlightActiveEntry(...args);
  }

  /**
   * Scroll event handler for the content area.
   * Detects manual scrolling and disables auto-scroll so the user
   * can read at their own pace without being yanked back.
   */
  function onContentAreaScroll(...args) {
    return views.onContentAreaScroll(...args);
  }

  /**
   * Uses session storage when it is available. Local storage is a safe fallback
   * for older test or browser environments that do not expose session storage.
   */
  function getTranscriptViewStateStorage(...args) {
    return views.getTranscriptViewStateStorage(...args);
  }

  /**
   * Reads one video's last visible transcript position.
   */
  function loadTranscriptViewState(...args) {
    return views.loadTranscriptViewState(...args);
  }

  /**
   * Stores positions for a small recent set of videos. This prevents one value
   * from growing without a limit during a long Chrome session.
   */
  function saveTranscriptViewState(...args) {
    return views.saveTranscriptViewState(...args);
  }

  /**
   * Saves the visible position after scrolling stops. Capturing the video ID and
   * position now prevents a later video change from writing the wrong state.
   */
  function scheduleTranscriptViewStateSave(...args) {
    return views.scheduleTranscriptViewStateSave(...args);
  }

  /**
   * Saves immediately before the panel closes.
   */
  function saveCurrentTranscriptViewState(...args) {
    return views.saveCurrentTranscriptViewState(...args);
  }

  /**
   * Returns true only while the Transcript tab is the visible results panel.
   */
  function transcriptTabIsActive(...args) {
    return views.transcriptTabIsActive(...args);
  }

  function resultTabIsActive(tabName) {
    return Boolean(
      document.querySelector(
        `.tab-panel[data-panel="${CSS.escape(tabName)}"].active`,
      ),
    );
  }

  /**
   * Copies the shared scroll area's current value into transcript-only state.
   */
  function captureCurrentTranscriptScrollTop(...args) {
    return views.captureCurrentTranscriptScrollTop(...args);
  }

  /**
   * Restores the saved position after the transcript becomes visible. Follow
   * Playback stays paused, so the next timer tick cannot move the panel again.
   */
  function restorePendingTranscriptViewState(...args) {
    return views.restorePendingTranscriptViewState(...args);
  }

  // ============================================================
  // UNIVERSAL DISPLAY LANGUAGE — Original / Chinese / aligned bilingual
  // ============================================================

  function loadDisplayLanguageMode(...args) {
    return views.loadDisplayLanguageMode(...args);
  }

  function saveDisplayLanguageMode(...args) {
    return views.saveDisplayLanguageMode(...args);
  }

  function getActiveTranscriptSegments(...args) {
    return views.getActiveTranscriptSegments(...args);
  }

  function transcriptTranslationCacheKey(...args) {
    return views.transcriptTranslationCacheKey(...args);
  }

  function setTranscriptModeButtons(...args) {
    return views.setTranscriptModeButtons(...args);
  }

  function handleDisplayLanguageModeChange(...args) {
    return views.handleDisplayLanguageModeChange(...args);
  }

  function renderTranscriptSegmentContent(...args) {
    return views.renderTranscriptSegmentContent(...args);
  }

  function renderTranscriptModeRows(...args) {
    return views.renderTranscriptModeRows(...args);
  }

  /**
   * Rebuilds a provider response in source order. Unknown IDs are ignored and
   * missing IDs remain explicit errors, never positional guesses.
   */
  function alignTranslatedSegmentBatch(...args) {
    return views.alignTranslatedSegmentBatch(...args);
  }

  function updateTranslatedRow(...args) {
    return views.updateTranslatedRow(...args);
  }

  let activeTranslationQueue = null;

  function requestTranscriptTranslationBatch(...args) {
    return views.requestTranscriptTranslationBatch(...args);
  }

  function retryTranslationSegment(...args) {
    return views.retryTranslationSegment(...args);
  }

  /**
   * Renders immediately, translates the first small batch, then observes the
   * remaining rows. Batches are sequential so the provider is never flooded.
   */
  function translateTranscript(...args) {
    return views.translateTranscript(...args);
  }

  function setTranslatingSpinner(...args) {
    return views.setTranslatingSpinner(...args);
  }

  // Pure helpers are exposed for the repository's Node tests. The extension does
  // not read this object at runtime.

  // Application shell owns view-state snapshots; feature presenters receive an explicit host interface.
  const ctx = {};
  Object.defineProperties(ctx, {
    api: { get: () => api },
    captureWordContext: { get: () => captureWordContext },
    setVocabularyEntries: {
      get:
        () =>
        (...args) =>
          views.setVocabularyEntries(...args),
    },
    openVocabulary: {
      get:
        () =>
        (...args) =>
          views.openVocabulary(...args),
    },
    YTD_EXPORT: { get: () => YTD_EXPORT },
    DEBUG: { get: () => DEBUG },
    debugLog: { get: () => debugLog },
    currentVideoId: {
      get: () => currentVideoId,
      set: (value) => {
        currentVideoId = value;
      },
    },
    contentGeneration: {
      get: () => contentGeneration,
      set: (value) => {
        contentGeneration = value;
      },
    },
    analysisGeneration: {
      get: () => analysisGeneration,
      set: (value) => {
        analysisGeneration = value;
      },
    },
    currentVideoUrl: {
      get: () => currentVideoUrl,
      set: (value) => {
        currentVideoUrl = value;
      },
    },
    currentAnalysis: {
      get: () => currentAnalysis,
      set: (value) => {
        currentAnalysis = value;
      },
    },
    currentTranscript: {
      get: () => currentTranscript,
      set: (value) => {
        currentTranscript = value;
      },
    },
    currentTranscriptText: {
      get: () => currentTranscriptText,
      set: (value) => {
        currentTranscriptText = value;
      },
    },
    currentTranscriptTimestamped: {
      get: () => currentTranscriptTimestamped,
      set: (value) => {
        currentTranscriptTimestamped = value;
      },
    },
    currentTranscriptLanguage: {
      get: () => currentTranscriptLanguage,
      set: (value) => {
        currentTranscriptLanguage = value;
      },
    },
    currentVideoTitle: {
      get: () => currentVideoTitle,
      set: (value) => {
        currentVideoTitle = value;
      },
    },
    currentChannelName: {
      get: () => currentChannelName,
      set: (value) => {
        currentChannelName = value;
      },
    },
    currentVideoDescription: {
      get: () => currentVideoDescription,
      set: (value) => {
        currentVideoDescription = value;
      },
    },
    currentVideoDuration: {
      get: () => currentVideoDuration,
      set: (value) => {
        currentVideoDuration = value;
      },
    },
    isAnalysisLoading: {
      get: () => isAnalysisLoading,
      set: (value) => {
        isAnalysisLoading = value;
      },
    },
    youtubeTabId: {
      get: () => youtubeTabId,
      set: (value) => {
        youtubeTabId = value;
      },
    },
    errorAction: {
      get: () => errorAction,
      set: (value) => {
        errorAction = value;
      },
    },
    currentTranscriptMode: {
      get: () => currentTranscriptMode,
      set: (value) => {
        currentTranscriptMode = value;
      },
    },
    DISPLAY_LANGUAGE_MODE_KEY: { get: () => DISPLAY_LANGUAGE_MODE_KEY },
    DISPLAY_LANGUAGE_MODES: { get: () => DISPLAY_LANGUAGE_MODES },
    translationGeneration: {
      get: () => translationGeneration,
      set: (value) => {
        translationGeneration = value;
      },
    },
    translationWorkCount: {
      get: () => translationWorkCount,
      set: (value) => {
        translationWorkCount = value;
      },
    },
    transcriptScrollObserver: {
      get: () => transcriptScrollObserver,
      set: (value) => {
        transcriptScrollObserver = value;
      },
    },
    transcriptParagraphCache: {
      get: () => transcriptParagraphCache,
      set: (value) => {
        transcriptParagraphCache = value;
      },
    },
    interfaceTranslationCache: {
      get: () => interfaceTranslationCache,
      set: (value) => {
        interfaceTranslationCache = value;
      },
    },
    interfaceTranslationInFlight: {
      get: () => interfaceTranslationInFlight,
      set: (value) => {
        interfaceTranslationInFlight = value;
      },
    },
    interfaceTranslationFailures: {
      get: () => interfaceTranslationFailures,
      set: (value) => {
        interfaceTranslationFailures = value;
      },
    },
    currentNotes: {
      get: () => currentNotes,
      set: (value) => {
        currentNotes = value;
      },
    },
    currentNotesFilterVideoId: {
      get: () => currentNotesFilterVideoId,
      set: (value) => {
        currentNotesFilterVideoId = value;
      },
    },
    TRANSLATION_MESSAGE_TIMEOUT_MS: {
      get: () => TRANSLATION_MESSAGE_TIMEOUT_MS,
    },
    TRANSLATION_BATCH_SIZE: { get: () => TRANSLATION_BATCH_SIZE },
    transcriptSearchMatches: {
      get: () => transcriptSearchMatches,
      set: (value) => {
        transcriptSearchMatches = value;
      },
    },
    transcriptSearchIndex: {
      get: () => transcriptSearchIndex,
      set: (value) => {
        transcriptSearchIndex = value;
      },
    },
    sendTranslationMessage: { get: () => sendTranslationMessage },
    autoScrollEnabled: {
      get: () => autoScrollEnabled,
      set: (value) => {
        autoScrollEnabled = value;
      },
    },
    autoScrollInterval: {
      get: () => autoScrollInterval,
      set: (value) => {
        autoScrollInterval = value;
      },
    },
    lastAutoScrollTime: {
      get: () => lastAutoScrollTime,
      set: (value) => {
        lastAutoScrollTime = value;
      },
    },
    TRANSCRIPT_VIEW_STATE_KEY: { get: () => TRANSCRIPT_VIEW_STATE_KEY },
    pendingTranscriptViewState: {
      get: () => pendingTranscriptViewState,
      set: (value) => {
        pendingTranscriptViewState = value;
      },
    },
    transcriptViewStateSaveTimer: {
      get: () => transcriptViewStateSaveTimer,
      set: (value) => {
        transcriptViewStateSaveTimer = value;
      },
    },
    isRestoringTranscriptView: {
      get: () => isRestoringTranscriptView,
      set: (value) => {
        isRestoringTranscriptView = value;
      },
    },
    selectionActionsController: {
      get: () => selectionActionsController,
      set: (value) => {
        selectionActionsController = value;
      },
    },
    lastTranscriptScrollTop: {
      get: () => lastTranscriptScrollTop,
      set: (value) => {
        lastTranscriptScrollTop = value;
      },
    },
    normalizeCaptionText: { get: () => normalizeCaptionText },
    splitOversizedThought: { get: () => splitOversizedThought },
    groupTranscriptEntries: { get: () => groupTranscriptEntries },
    navigationRefreshTimer: {
      get: () => navigationRefreshTimer,
      set: (value) => {
        navigationRefreshTimer = value;
      },
    },
    panelWindowId: {
      get: () => panelWindowId,
      set: (value) => {
        panelWindowId = value;
      },
    },
    scheduleDigestRefresh: { get: () => scheduleDigestRefresh },
    panelIsShowingResults: { get: () => panelIsShowingResults },
    handleFrontTabUrl: { get: () => handleFrontTabUrl },
    getNavigationUrl: { get: () => getNavigationUrl },
    setupEventListeners: { get: () => setupEventListeners },
    setNotesFilter: { get: () => setNotesFilter },
    checkCurrentTab: { get: () => checkCurrentTab },
    extractVideoId: { get: () => extractVideoId },
    startDigest: { get: () => startDigest },
    interfaceTranslationCacheKey: { get: () => interfaceTranslationCacheKey },
    getInterfaceTranslation: { get: () => getInterfaceTranslation },
    renderLocalizedContent: { get: () => renderLocalizedContent },
    getLocalizedPlainText: { get: () => getLocalizedPlainText },
    translateInterfaceSegments: { get: () => translateInterfaceSegments },
    getOverviewTranslationSegments: {
      get: () => getOverviewTranslationSegments,
    },
    translateOverviewContent: { get: () => translateOverviewContent },
    getNoteTranslationId: { get: () => getNoteTranslationId },
    translateNotesContent: { get: () => translateNotesContent },
    renderAnalysisResults: { get: () => renderAnalysisResults },
    saveQuoteAsNote: { get: () => saveQuoteAsNote },
    renderResults: { get: () => renderResults },
    hasNonCollapsedTextSelection: { get: () => hasNonCollapsedTextSelection },
    seekFromTranscriptEntryClick: { get: () => seekFromTranscriptEntryClick },
    renderTranscript: { get: () => renderTranscript },
    findLiteralTranscriptMatches: { get: () => findLiteralTranscriptMatches },
    clearTranscriptSearchHighlights: {
      get: () => clearTranscriptSearchHighlights,
    },
    markTranscriptTextNode: { get: () => markTranscriptTextNode },
    updateTranscriptSearchControls: {
      get: () => updateTranscriptSearchControls,
    },
    revealCurrentTranscriptSearchMatch: {
      get: () => revealCurrentTranscriptSearchMatch,
    },
    refreshTranscriptSearch: { get: () => refreshTranscriptSearch },
    moveTranscriptSearch: { get: () => moveTranscriptSearch },
    resetTranscriptSearch: { get: () => resetTranscriptSearch },
    setupTranscriptSearch: { get: () => setupTranscriptSearch },
    getDisplayedTranscriptText: { get: () => getDisplayedTranscriptText },
    copyTranscript: { get: () => copyTranscript },
    exportTranscript: { get: () => exportTranscript },
    exportStudy: { get: () => exportStudy },
    showState: { get: () => showState },
    updateLoading: { get: () => updateLoading },
    showError: { get: () => showError },
    showConfigError: { get: () => showConfigError },
    switchTab: { get: () => switchTab },
    triggerAnalysis: { get: () => triggerAnalysis },
    seekTo: { get: () => seekTo },
    playNote: { get: () => playNote },
    highlightMomentsOnPage: { get: () => highlightMomentsOnPage },
    escapeHtml: { get: () => escapeHtml },
    renderSubtitleInlineMarkup: { get: () => renderSubtitleInlineMarkup },
    copyToClipboard: { get: () => copyToClipboard },
    copyToClipboardWithFeedback: { get: () => copyToClipboardWithFeedback },
    downloadTextFile: { get: () => downloadTextFile },
    sanitizeFilename: { get: () => sanitizeFilename },
    dismissSelectionActions: { get: () => dismissSelectionActions },
    setupExplainFeature: { get: () => setupExplainFeature },
    showExplanation: { get: () => showExplanation },
    saveToCache: { get: () => saveToCache },
    evictOldCacheEntries: { get: () => evictOldCacheEntries },
    loadFromCache: { get: () => loadFromCache },
    updateCache: { get: () => updateCache },
    loadNotes: { get: () => loadNotes },
    renderNotes: { get: () => renderNotes },
    deleteNote: { get: () => deleteNote },
    startPlaybackTracking: { get: () => startPlaybackTracking },
    stopPlaybackTracking: { get: () => stopPlaybackTracking },
    playbackTrackingTick: { get: () => playbackTrackingTick },
    scrollToActiveEntry: { get: () => scrollToActiveEntry },
    highlightActiveEntry: { get: () => highlightActiveEntry },
    onContentAreaScroll: { get: () => onContentAreaScroll },
    getTranscriptViewStateStorage: { get: () => getTranscriptViewStateStorage },
    loadTranscriptViewState: { get: () => loadTranscriptViewState },
    saveTranscriptViewState: { get: () => saveTranscriptViewState },
    scheduleTranscriptViewStateSave: {
      get: () => scheduleTranscriptViewStateSave,
    },
    saveCurrentTranscriptViewState: {
      get: () => saveCurrentTranscriptViewState,
    },
    transcriptTabIsActive: { get: () => transcriptTabIsActive },
    resultTabIsActive: { get: () => resultTabIsActive },
    captureCurrentTranscriptScrollTop: {
      get: () => captureCurrentTranscriptScrollTop,
    },
    restorePendingTranscriptViewState: {
      get: () => restorePendingTranscriptViewState,
    },
    loadDisplayLanguageMode: { get: () => loadDisplayLanguageMode },
    saveDisplayLanguageMode: { get: () => saveDisplayLanguageMode },
    getActiveTranscriptSegments: { get: () => getActiveTranscriptSegments },
    transcriptTranslationCacheKey: { get: () => transcriptTranslationCacheKey },
    setTranscriptModeButtons: { get: () => setTranscriptModeButtons },
    handleDisplayLanguageModeChange: {
      get: () => handleDisplayLanguageModeChange,
    },
    renderTranscriptSegmentContent: {
      get: () => renderTranscriptSegmentContent,
    },
    renderTranscriptModeRows: { get: () => renderTranscriptModeRows },
    alignTranslatedSegmentBatch: { get: () => alignTranslatedSegmentBatch },
    updateTranslatedRow: { get: () => updateTranslatedRow },
    activeTranslationQueue: {
      get: () => activeTranslationQueue,
      set: (value) => {
        activeTranslationQueue = value;
      },
    },
    requestTranscriptTranslationBatch: {
      get: () => requestTranscriptTranslationBatch,
    },
    retryTranslationSegment: { get: () => retryTranslationSegment },
    translateTranscript: { get: () => translateTranscript },
    setTranslatingSpinner: { get: () => setTranslatingSpinner },
  });
  const views = createViews(ctx);
  views.initVocabulary?.();
  chrome.runtime.onMessage.addListener((message) => {
    if (
      message.action === "vocabularyChanged" ||
      message.action === "dataReset"
    )
      void views.refreshVocabulary?.();
  });
}
