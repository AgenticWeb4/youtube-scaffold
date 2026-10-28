// Feature presentation; all application actions enter through the injected syncs facade.
// Derived UI: see LICENSE and NOTICE.
export function createExplanationView(ctx) {
  /**
   * Shows the explanation modal and fetches it from the configured AI provider.
   */
  async function showExplanation(selectedText, selectedTimestamp, snapshot) {
    // Create modal
    const modal = document.createElement("div");
    modal.id = "explainModal";
    modal.className = "explain-modal-overlay";
    modal.innerHTML = `
    <div class="explain-modal">
      <div class="explain-modal-header">
        <div class="explain-modal-title">Explain</div>
        <button class="explain-modal-close" id="closeExplain">Close</button>
      </div>
      <div class="explain-selected-text">"${ctx.escapeHtml(selectedText.substring(0, 200))}${selectedText.length > 200 ? "..." : ""}"</div>
      <div class="explain-modal-content" id="explanationContent">
        <div class="explain-loading">
          <div class="loading-bar"></div>
          <span>Analyzing...</span>
        </div>
      </div>
    </div>
  `;
    document.body.appendChild(modal);
    // Close handlers
    document
      .getElementById("closeExplain")
      .addEventListener("click", () => modal.remove());
    modal.addEventListener("click", (e) => {
      if (e.target === modal) modal.remove();
    });
    // Get some context around the selection from the transcript
    const transcriptContext =
      snapshot?.context ||
      ctx.api.reading.context(ctx.currentTranscript || [], selectedTimestamp);
    // Fetch explanation
    try {
      const result = await ctx.api.sendMessage({
        action: "explainSelection",
        selectedText: selectedText,
        transcriptContext: transcriptContext,
        videoTitle: ctx.currentVideoTitle,
      });
      if (!modal.isConnected) return;
      const contentDiv = modal.querySelector("#explanationContent");
      if (result.success) {
        contentDiv.innerHTML = `<div class="explain-text">${ctx.escapeHtml(result.explanation).replace(/\n\n/g, "</p><p>").replace(/\n/g, "<br>")}</div>`;
      } else {
        contentDiv.innerHTML = `<div class="explain-error">Failed to get explanation: ${ctx.escapeHtml(result.error)}</div>`;
      }
    } catch (error) {
      if (!modal.isConnected) return;
      const contentDiv = modal.querySelector("#explanationContent");
      contentDiv.innerHTML = `<div class="explain-error">Error: ${ctx.escapeHtml(error.message)}</div>`;
    }
  }

  /**
   * Gets surrounding context from the transcript for the selected text.
   */
  return { showExplanation };
}
