const DEFAULT_SECTIONS = Object.freeze({
  analysis: true,
  transcript: true,
  notes: true,
});
function normalizeSections(value = {}) {
  if (!value || typeof value !== "object") value = {};
  return Object.fromEntries(
    Object.keys(DEFAULT_SECTIONS).map((key) => [key, value[key] !== false]),
  );
}

function requireSections(sections) {
  if (!Object.values(sections).some(Boolean)) {
    throw Object.assign(new Error("Select at least one export section."), {
      code: "NO_SECTIONS",
    });
  }
}

function videoUrl(videoId) {
  if (!/^[A-Za-z0-9_-]{6,20}$/.test(videoId || ""))
    throw new Error("Invalid YouTube video ID.");
  return `https://www.youtube.com/watch?v=${videoId}`;
}

function timestampLink(item, url) {
  const seconds = item.timestampSeconds;
  if (!Number.isFinite(seconds) || seconds < 0) return "";
  const value = Math.floor(seconds);
  const label = `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
  return `[${label}](${url}&t=${value}s)`;
}

function buildMarkdown(study, selected = DEFAULT_SECTIONS) {
  const sections = normalizeSections(selected);
  requireSections(sections);
  const url = videoUrl(study.videoId);
  const title = String(study.title || "Untitled video").replace(
    /[\r\n]+/g,
    " ",
  );
  const lines = [
    `# ${title}`,
    "",
    `视频：${url}`,
    `频道：${String(study.channel || "").replace(/[\r\n]+/g, " ")}`,
    "",
  ];
  if (sections.analysis) {
    lines.push("## 分析", "");
    if (!study.analysis) lines.push("尚未生成分析。", "");
    else {
      lines.push("### 章节", "");
      for (const chapter of study.analysis.chapters || []) {
        lines.push(
          `- ${timestampLink(chapter, url)} ${chapter.title || ""}`,
          `  ${chapter.summary || ""}`,
          "",
        );
      }
      lines.push("### 重点引用", "");
      for (const quote of study.analysis.keyQuotes || []) {
        lines.push(
          timestampLink(quote, url),
          String(quote.quote || "")
            .split(/\r?\n/)
            .map((line) => `> ${line}`)
            .join("\n"),
          "",
        );
      }
    }
  }
  if (sections.transcript)
    lines.push("## 字幕", "", study.transcript || "暂无字幕。", "");
  if (sections.notes) {
    lines.push("## 笔记", "");
    const notes = (study.notes || []).filter(
      (note) => note.videoId === study.videoId,
    );
    if (!notes.length) lines.push("暂无笔记。", "");
    for (const note of notes)
      lines.push(
        `### ${timestampLink(note, url) || "笔记"}`,
        "",
        note.text || "",
        "",
      );
  }
  return lines.join("\n");
}
export {
  DEFAULT_SECTIONS,
  normalizeSections,
  requireSections,
  buildMarkdown,
  videoUrl,
};
