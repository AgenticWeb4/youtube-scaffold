// Feature presentation; all application actions enter through the injected syncs facade.
// Derived UI: see LICENSE and NOTICE.
export function createCollectionView(ctx) {
  let loadGeneration = 0;
  // ============================================================
  // NOTES
  // ============================================================
  /**
   * Loads and renders notes from storage.
   * @param {string|null} videoId - Filter by video ID, or null for all notes
   */
  async function loadNotes(videoId) {
    const generation = ++loadGeneration;
    try {
      const result = await ctx.api.sendMessage({
        action: "getNotes",
        videoId: videoId,
      });
      if (
        generation !== loadGeneration ||
        (videoId && videoId !== ctx.currentVideoId)
      )
        return;
      if (result.success) {
        ctx.currentNotes = result.notes || [];
        ctx.currentNotesFilterVideoId = videoId;
        ctx.renderNotes(result.notes, videoId);
      }
    } catch (error) {
      console.error("[YouTube Scaffold Panel] Load notes error:", error);
    }
  }

  /**
   * Renders the notes list in the Notes tab.
   */
  function renderNotes(notes, filteredVideoId) {
    const notesList = document.getElementById("notesList");
    const notesIntro = document.getElementById("notesIntro");
    if (!notesList) return;
    notesList.innerHTML = "";
    if (!notes || notes.length === 0) {
      notesIntro.style.display = "block";
      notesIntro.textContent = filteredVideoId
        ? "No notes for this video yet. Hover over the video and click Note to save."
        : "No notes saved yet. Hover over a video and click Note to save.";
      return;
    }
    notesIntro.style.display = "none";
    notes.forEach((note, index) => {
      const translationId = ctx.getNoteTranslationId(note, index);
      const noteEl = document.createElement("div");
      noteEl.className = "note-item";
      noteEl.innerHTML = `
      <div class="note-header">
        <span class="note-timestamp" data-url="${ctx.escapeHtml(note.timestampedUrl)}" data-seconds="${Number(note.timestampSeconds) || 0}">${ctx.escapeHtml(note.timestamp)}</span>
        ${!filteredVideoId ? `<span class="note-video-title">${ctx.escapeHtml(note.videoTitle)}</span>` : ""}
      </div>
      <div class="note-text">${ctx.renderLocalizedContent(note.text, "notes", translationId)}</div>
      <div class="note-actions">
        <button class="note-action-btn note-copy-text">Copy text</button>
        <button class="note-action-btn note-copy-link" data-url="${ctx.escapeHtml(note.timestampedUrl)}">Copy timestamp</button>
        <button class="note-action-btn note-play" data-seconds="${Number(note.timestampSeconds) || 0}">Play</button>
        <button class="note-delete" data-id="${ctx.escapeHtml(note.id)}" type="button" aria-label="Delete note" title="Delete note">
          Delete note
        </button>
      </div>
    `;
      // Timestamp click - play from this point (in this tab or a new one)
      noteEl.querySelector(".note-timestamp").addEventListener("click", () => {
        ctx.playNote(note);
      });
      // Delete button
      noteEl
        .querySelector(".note-delete")
        .addEventListener("click", async (e) => {
          e.stopPropagation();
          await ctx.deleteNote(note.id);
          ctx.loadNotes(filteredVideoId);
        });
      // Copy text button — copies just the note's text
      noteEl
        .querySelector(".note-copy-text")
        .addEventListener("click", async () => {
          try {
            await navigator.clipboard.writeText(
              ctx.getLocalizedPlainText(note.text, "notes", translationId),
            );
            const btn = noteEl.querySelector(".note-copy-text");
            btn.textContent = "Copied";
            setTimeout(() => {
              btn.textContent = "Copy text";
            }, 2000);
          } catch (err) {
            console.error("Copy failed:", err);
          }
        });
      // Copy timestamp button — copies the timestamped YouTube link
      noteEl
        .querySelector(".note-copy-link")
        .addEventListener("click", async () => {
          try {
            await navigator.clipboard.writeText(note.timestampedUrl);
            const btn = noteEl.querySelector(".note-copy-link");
            btn.textContent = "Copied";
            setTimeout(() => {
              btn.textContent = "Copy timestamp";
            }, 2000);
          } catch (err) {
            console.error("Copy failed:", err);
          }
        });
      // Play button (in this tab if it's the current video, else a new tab)
      noteEl.querySelector(".note-play").addEventListener("click", () => {
        ctx.playNote(note);
      });
      notesList.appendChild(noteEl);
    });
    if (
      ctx.currentTranscriptMode !== "original" &&
      ctx.resultTabIsActive("notes")
    ) {
      void ctx.translateNotesContent();
    }
  }

  /**
   * Deletes a note by ID.
   */
  async function deleteNote(noteId) {
    try {
      await ctx.api.sendMessage({
        action: "deleteNote",
        noteId: noteId,
      });
    } catch (error) {
      console.error("[YouTube Scaffold Panel] Delete note error:", error);
    }
  }

  function getNoteTranslationId(note, index) {
    const stablePart = String(note.id || note.createdAt || index)
      .replace(/[^A-Za-z0-9_-]/g, "-")
      .slice(0, 96);
    return `note-${stablePart || index}`;
  }
  return { loadNotes, renderNotes, deleteNote, getNoteTranslationId };
}
