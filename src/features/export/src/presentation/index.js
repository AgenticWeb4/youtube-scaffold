// Feature presentation; all application actions enter through the injected syncs facade.
// Derived UI: see LICENSE and NOTICE.
export function createExportView(ctx) {
  function copyTranscript() {
    ctx.copyToClipboardWithFeedback(
      ctx.getDisplayedTranscriptText(),
      "copyTranscriptBtn",
    );
  }

  function exportTranscript() {
    const transcriptContent = ctx.getDisplayedTranscriptText();
    const videoUrl = `https://youtube.com/watch?v=${ctx.currentVideoId}`;
    let exportText = "";
    exportText += `TRANSCRIPT\n`;
    exportText += `${"=".repeat(60)}\n\n`;
    exportText += `Title: ${ctx.currentVideoTitle || "Unknown"}\n`;
    exportText += `Channel: ${ctx.currentChannelName || "Unknown"}\n`;
    exportText += `URL: ${videoUrl}\n`;
    exportText += `\n${"—".repeat(60)}\n\n`;
    if (ctx.currentVideoDescription) {
      exportText += `DESCRIPTION:\n${ctx.currentVideoDescription}\n`;
      exportText += `\n${"—".repeat(60)}\n\n`;
    }
    exportText += `TRANSCRIPT:\n\n${transcriptContent}\n`;
    exportText += `\n${"—".repeat(60)}\n`;
    exportText += `Exported by YouTube Scaffold\n`;
    const filename = `${ctx.sanitizeFilename(ctx.currentVideoTitle)}-transcript.txt`;
    ctx.downloadTextFile(exportText, filename);
  }

  async function exportStudy() {
    const button = document.getElementById("exportStudyBtn");
    const status = document.getElementById("exportStudyStatus");
    if (!ctx.currentVideoId || button.disabled) return;
    // Freeze the video before any asynchronous permission or storage work.
    const study = {
      videoId: ctx.currentVideoId,
      title: ctx.currentVideoTitle,
      channel: ctx.currentChannelName,
      analysis: ctx.currentAnalysis
        ? structuredClone(ctx.currentAnalysis)
        : null,
      transcript: ctx.getDisplayedTranscriptText(),
    };
    button.disabled = true;
    status.textContent = "正在导出学习资料…";
    try {
      const result = await ctx.YTD_EXPORT.saveStudy(study, async (videoId) => {
        const response = await ctx.api.sendMessage({
          action: "getNotes",
          videoId,
        });
        if (!response?.success) throw new Error("无法读取笔记，请重试。");
        return response.notes || [];
      });
      status.textContent = `已保存到 ${result.directoryName}/${result.filename}`;
    } catch (error) {
      const messages = {
        NO_DIRECTORY: "请先在 Settings → 导出设置 中选择保存目录。",
        PERMISSION_DENIED: "目录授权未通过，请在 Settings 中重新选择目录。",
        NO_SECTIONS: "请在 Settings 中至少选择一项导出内容。",
      };
      status.textContent =
        error.name === "AbortError"
          ? "已取消导出。"
          : messages[error.code] || "导出失败，请检查目录权限后重试。";
    } finally {
      button.disabled = false;
    }
  }

  function downloadTextFile(text, filename) {
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function sanitizeFilename(str) {
    return (str || "untitled")
      .replace(/[^\w\s-]/g, "")
      .replace(/\s+/g, "-")
      .substring(0, 50)
      .toLowerCase();
  }
  return {
    copyTranscript,
    exportTranscript,
    exportStudy,
    downloadTextFile,
    sanitizeFilename,
  };
}
