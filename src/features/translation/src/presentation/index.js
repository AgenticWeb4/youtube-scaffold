// Feature presentation; all application actions enter through the injected syncs facade.
// Derived UI: see LICENSE and NOTICE.
export function createTranslationView(ctx) {
  // ============================================================
  // RENDERING
  // ============================================================
  function interfaceTranslationCacheKey(surface, id, text) {
    return `${ctx.currentVideoId || "none"}:zh:${surface}:${id}:${text}`;
  }

  function getInterfaceTranslation(surface, id, text) {
    return ctx.interfaceTranslationCache.get(
      ctx.interfaceTranslationCacheKey(surface, id, text),
    );
  }

  function renderLocalizedContent(text, surface, id) {
    const original = String(text || "");
    if (!original) return "";
    const cacheKey = ctx.interfaceTranslationCacheKey(surface, id, original);
    const translated = ctx.getInterfaceTranslation(surface, id, original);
    if (ctx.currentTranscriptMode === "original")
      return ctx.escapeHtml(original);
    const translation = translated
      ? ctx.escapeHtml(translated)
      : ctx.interfaceTranslationFailures.has(cacheKey)
        ? '<span class="translation-error">Translation unavailable.</span>'
        : '<span class="translation-pending">Translating...</span>';
    if (ctx.currentTranscriptMode === "bilingual") {
      return `<span class="localized-copy"><span class="localized-original">${ctx.escapeHtml(original)}</span><span class="localized-translation">${translation}</span></span>`;
    }
    return `<span class="localized-copy"><span class="localized-translation">${translation}</span></span>`;
  }

  function getLocalizedPlainText(text, surface, id) {
    const original = String(text || "");
    const translated = ctx.getInterfaceTranslation(surface, id, original);
    if (ctx.currentTranscriptMode === "zh") return translated || original;
    if (ctx.currentTranscriptMode === "bilingual" && translated) {
      return `${original}\n\n${translated}`;
    }
    return original;
  }

  async function translateInterfaceSegments(surface, segments, rerender) {
    if (ctx.currentTranscriptMode === "original" || !segments.length) return;
    const generation = ctx.translationGeneration;
    const videoId = ctx.currentVideoId;
    const missing = segments
      .filter((segment) => segment.text)
      .map((segment) => ({
        ...segment,
        cacheKey: ctx.interfaceTranslationCacheKey(
          surface,
          segment.id,
          segment.text,
        ),
      }))
      .filter(
        (segment) =>
          !ctx.interfaceTranslationCache.has(segment.cacheKey) &&
          !ctx.interfaceTranslationFailures.has(segment.cacheKey) &&
          !ctx.interfaceTranslationInFlight.has(segment.cacheKey),
      );
    if (!missing.length) return;
    missing.forEach((segment) =>
      ctx.interfaceTranslationInFlight.add(segment.cacheKey),
    );
    ctx.setTranslatingSpinner(true);
    try {
      for (
        let start = 0;
        start < missing.length;
        start += ctx.TRANSLATION_BATCH_SIZE
      ) {
        const batch = missing.slice(start, start + ctx.TRANSLATION_BATCH_SIZE);
        let result;
        try {
          result = await ctx.sendTranslationMessage({
            action: "translateContent",
            content: {
              segments: batch.map(({ id, text }) => ({ id, text })),
            },
            contentType: "interfaceBatch",
            targetLanguage: "zh",
            videoTitle: ctx.currentVideoTitle,
          });
        } catch (error) {
          console.error("[YouTube Scaffold] Interface batch error:", error);
          result = { success: false, error: error.message };
        }
        if (
          generation !== ctx.translationGeneration ||
          videoId !== ctx.currentVideoId ||
          ctx.currentTranscriptMode === "original"
        ) {
          return;
        }
        const aligned = ctx.alignTranslatedSegmentBatch(
          batch,
          result?.success ? result.translatedContent?.segments : [],
        );
        aligned.forEach((item, index) => {
          if (item.text) {
            ctx.interfaceTranslationCache.set(batch[index].cacheKey, item.text);
          } else {
            ctx.interfaceTranslationFailures.add(batch[index].cacheKey);
          }
        });
        // Match the Transcript UX: reveal and persist every small batch as soon
        // as it returns instead of waiting for the full Overview or Notes list.
        rerender();
        await ctx.updateCache();
      }
    } catch (error) {
      console.error("[YouTube Scaffold] Interface translation error:", error);
      missing.forEach((segment) =>
        ctx.interfaceTranslationFailures.add(segment.cacheKey),
      );
    } finally {
      missing.forEach((segment) =>
        ctx.interfaceTranslationInFlight.delete(segment.cacheKey),
      );
      if (generation === ctx.translationGeneration)
        ctx.setTranslatingSpinner(false);
    }
  }

  function renderTranscriptSegmentContent(segment, mode, translated, error) {
    const original = ctx.renderSubtitleInlineMarkup(segment.text);
    let translationHtml = "";
    if (translated) {
      translationHtml = ctx.renderSubtitleInlineMarkup(translated);
    } else if (error) {
      translationHtml = `${ctx.escapeHtml(error)}<button class="translation-retry-btn" type="button">Retry</button>`;
    } else {
      translationHtml = "Waiting for translation…";
    }
    if (mode === "bilingual") {
      return `<span class="transcript-copy"><span class="transcript-original">${original}</span><span class="transcript-translation ${translated ? "" : error ? "translation-error" : "translation-pending"}">${translationHtml}</span></span>`;
    }
    return `<span class="transcript-copy"><span class="transcript-translation ${translated ? "" : error ? "translation-error" : "translation-pending"}">${translationHtml}</span></span>`;
  }

  function renderTranscriptModeRows(segments, mode) {
    const transcriptList = document.getElementById("transcriptList");
    if (!transcriptList) return [];
    transcriptList.innerHTML = "";
    const existingBadge = document.getElementById("transcriptSourceBadge");
    if (existingBadge) existingBadge.remove();
    const rows = [];
    segments.forEach((segment, index) => {
      const div = document.createElement("div");
      const cached = ctx.transcriptParagraphCache.get(
        ctx.transcriptTranslationCacheKey(segment),
      );
      div.className = `transcript-entry ${cached ? "translated" : "translating"}`;
      div.dataset.seconds = segment.start;
      div.dataset.segmentId = segment.id;
      div.dataset.segmentIndex = index;
      const minutes = Math.floor(segment.start / 60);
      const seconds = Math.floor(segment.start % 60);
      const timestamp = `${minutes}:${String(seconds).padStart(2, "0")}`;
      div.innerHTML = `
      <span class="transcript-time">${timestamp}</span>
      ${ctx.renderTranscriptSegmentContent(segment, mode, cached, "")}
    `;
      div.addEventListener("click", (event) =>
        ctx.seekFromTranscriptEntryClick(event, segment.start),
      );
      transcriptList.appendChild(div);
      rows.push(div);
    });
    // Bilingual mode can find source text before each translation arrives.
    ctx.refreshTranscriptSearch({ preserveIndex: false, scroll: false });
    ctx.startPlaybackTracking();
    return rows;
  }

  /**
   * Rebuilds a provider response in source order. Unknown IDs are ignored and
   * missing IDs remain explicit errors, never positional guesses.
   */
  function alignTranslatedSegmentBatch(...args) {
    return ctx.api.translation.align(...args);
  }

  function updateTranslatedRow(segment, index, alignedItem, generation) {
    if (generation !== ctx.translationGeneration) return;
    const row = document.querySelector(
      `.transcript-entry[data-segment-id="${CSS.escape(segment.id)}"]`,
    );
    if (!row) return;
    if (alignedItem.text) {
      ctx.transcriptParagraphCache.set(
        ctx.transcriptTranslationCacheKey(segment),
        alignedItem.text,
      );
    }
    const copy = row.querySelector(".transcript-copy");
    if (copy) {
      copy.outerHTML = ctx.renderTranscriptSegmentContent(
        segment,
        ctx.currentTranscriptMode,
        alignedItem.text,
        alignedItem.error,
      );
    }
    row.classList.toggle("translated", !!alignedItem.text);
    row.classList.toggle("translating", false);
    row.classList.toggle("translation-failed", !alignedItem.text);
    const retry = row.querySelector(".translation-retry-btn");
    if (retry) {
      ["mousedown", "mouseup"].forEach((eventName) => {
        retry.addEventListener(eventName, (event) => {
          event.preventDefault();
          event.stopPropagation();
        });
      });
      retry.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        ctx.retryTranslationSegment(index, generation);
      });
    }
  }

  async function requestTranscriptTranslationBatch(
    indices,
    segments,
    generation,
    videoId,
    mode,
  ) {
    const sourceBatch = indices.map((index) => segments[index]);
    ctx.setTranslatingSpinner(true);
    try {
      const result = await ctx.sendTranslationMessage({
        action: "translateContent",
        content: {
          segments: sourceBatch.map(({ id, text }) => ({ id, text })),
        },
        contentType: "transcriptBatch",
        targetLanguage: "zh",
        videoTitle: ctx.currentVideoTitle,
      });
      const isStale =
        generation !== ctx.translationGeneration ||
        videoId !== ctx.currentVideoId ||
        mode !== ctx.currentTranscriptMode;
      if (isStale) return;
      const responseSegments = result?.success
        ? result.translatedContent?.segments
        : [];
      const aligned = ctx.alignTranslatedSegmentBatch(
        sourceBatch,
        responseSegments,
      );
      aligned.forEach((item, batchIndex) => {
        if (!result?.success) {
          item.error = result?.error || "Translation failed.";
        }
        ctx.updateTranslatedRow(
          sourceBatch[batchIndex],
          indices[batchIndex],
          item,
          generation,
        );
      });
      ctx.refreshTranscriptSearch({ preserveIndex: true, scroll: false });
      await ctx.updateCache();
    } catch (error) {
      if (generation !== ctx.translationGeneration) return;
      sourceBatch.forEach((segment, batchIndex) => {
        ctx.updateTranslatedRow(
          segment,
          indices[batchIndex],
          {
            id: segment.id,
            text: "",
            error: error.message || "Translation failed.",
          },
          generation,
        );
      });
      ctx.refreshTranscriptSearch({ preserveIndex: true, scroll: false });
    } finally {
      if (generation === ctx.translationGeneration)
        ctx.setTranslatingSpinner(false);
    }
  }

  function retryTranslationSegment(index, generation) {
    if (generation !== ctx.translationGeneration || !ctx.activeTranslationQueue)
      return;
    const row = document.querySelector(
      `.transcript-entry[data-segment-index="${index}"]`,
    );
    if (row) {
      row.classList.add("translating");
      row.classList.remove("translation-failed");
      const translation = row.querySelector(".transcript-translation");
      if (translation) {
        translation.className = "transcript-translation translation-pending";
        translation.textContent = "Retrying…";
      }
    }
    ctx.activeTranslationQueue.enqueue(index, true);
  }

  /**
   * Renders immediately, translates the first small batch, then observes the
   * remaining rows. Batches are sequential so the provider is never flooded.
   */
  async function translateTranscript() {
    const segments = ctx.getActiveTranscriptSegments();
    if (!segments.length || ctx.currentTranscriptMode === "original") return;
    const generation = ctx.translationGeneration;
    const videoId = ctx.currentVideoId;
    const mode = ctx.currentTranscriptMode;
    if (ctx.transcriptScrollObserver) ctx.transcriptScrollObserver.disconnect();
    const rows = ctx.renderTranscriptModeRows(segments, mode);
    const queue = [];
    const queued = new Set();
    let processing = false;
    const processNext = async () => {
      if (
        processing ||
        queue.length === 0 ||
        generation !== ctx.translationGeneration
      )
        return;
      processing = true;
      const indices = queue.splice(0, ctx.TRANSLATION_BATCH_SIZE);
      indices.forEach((index) => queued.delete(index));
      try {
        await ctx.requestTranscriptTranslationBatch(
          indices,
          segments,
          generation,
          videoId,
          mode,
        );
      } finally {
        processing = false;
        if (queue.length && generation === ctx.translationGeneration)
          processNext();
      }
    };
    const enqueue = (index, force = false) => {
      if (!Number.isInteger(index) || !segments[index]) return;
      const cached = ctx.transcriptParagraphCache.has(
        ctx.transcriptTranslationCacheKey(segments[index]),
      );
      if ((!force && cached) || queued.has(index)) return;
      queue.push(index);
      queued.add(index);
      // Let all entries reported in the same viewport turn collect before the
      // worker starts, producing one small contextual multi-segment request.
      Promise.resolve().then(processNext);
    };
    ctx.activeTranslationQueue = { enqueue };
    ctx.transcriptScrollObserver = new IntersectionObserver(
      (observerEntries) => {
        observerEntries
          .filter((entry) => entry.isIntersecting)
          .sort(
            (a, b) =>
              Number(a.target.dataset.segmentIndex) -
              Number(b.target.dataset.segmentIndex),
          )
          .forEach((entry) =>
            enqueue(Number(entry.target.dataset.segmentIndex)),
          );
      },
      {
        root: document.getElementById("contentArea"),
        rootMargin: "320px 0px",
        threshold: 0,
      },
    );
    rows.forEach((row, index) => {
      if (!row.classList.contains("translated"))
        ctx.transcriptScrollObserver.observe(row);
      if (index < ctx.TRANSLATION_BATCH_SIZE) enqueue(index);
    });
  }

  function setTranslatingSpinner(show) {
    if (show) ctx.translationWorkCount += 1;
    else ctx.translationWorkCount = Math.max(0, ctx.translationWorkCount - 1);
    const isTranslating = ctx.translationWorkCount > 0;
    const spinner = document.getElementById("langSpinner");
    if (spinner) spinner.classList.toggle("visible", isTranslating);
  }

  function transcriptTranslationCacheKey(segment) {
    return `${ctx.currentVideoId}:zh:semantic:${segment.id}`;
  }
  return {
    interfaceTranslationCacheKey,
    getInterfaceTranslation,
    renderLocalizedContent,
    getLocalizedPlainText,
    translateInterfaceSegments,
    renderTranscriptSegmentContent,
    renderTranscriptModeRows,
    alignTranslatedSegmentBatch,
    updateTranslatedRow,
    requestTranscriptTranslationBatch,
    retryTranslationSegment,
    translateTranscript,
    setTranslatingSpinner,
    transcriptTranslationCacheKey,
  };
}
