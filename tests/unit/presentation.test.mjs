import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createSummaryView } from "../../src/features/summary/dist/presentation/index.js";
import { createExplanationView } from "../../src/features/explanation/dist/presentation/index.js";
import { createTranslationView } from "../../src/features/translation/dist/presentation/index.js";
import { deferred, id, analysis } from "../fixtures/helpers.mjs";
test("P35 Summary view does not publish or cache A response into B", async () => {
  globalThis.document = { getElementById: () => null };
  const response = deferred();
  const writes = [];
  const ctx = {
    currentTranscriptTimestamped: "[0:00] A",
    isAnalysisLoading: false,
    currentAnalysis: null,
    currentVideoId: id,
    analysisGeneration: 0,
    currentVideoTitle: "A",
    currentChannelName: "Channel",
    currentVideoDescription: "",
    currentVideoDuration: 60,
    api: { sendMessage: () => response.promise },
    renderAnalysisResults: () => assert.fail("Stale render"),
    highlightMomentsOnPage() {},
    saveToCache: async (origin) => writes.push(origin),
  };
  const p = createSummaryView(ctx).triggerAnalysis();
  ctx.currentVideoId = "videoB00001";
  ctx.analysisGeneration++;
  response.resolve({ success: true, analysis });
  await p;
  assert.deepEqual(writes, []);
  assert.equal(ctx.currentAnalysis, null);
  delete globalThis.document;
});
test("P21 Summary view issues nothing until needed and includes source identity", async () => {
  globalThis.document = { getElementById: () => null };
  let message;
  const writes = [];
  const ctx = {
    currentTranscriptTimestamped: "[0:00] A",
    isAnalysisLoading: false,
    currentAnalysis: null,
    currentVideoId: id,
    analysisGeneration: 0,
    currentVideoTitle: "A",
    currentChannelName: "Channel",
    currentVideoDescription: "",
    currentVideoDuration: 60,
    api: {
      sendMessage: async (m) => {
        message = m;
        return { success: true, analysis };
      },
    },
    renderAnalysisResults() {},
    highlightMomentsOnPage() {},
    saveToCache: async (origin) => writes.push(origin),
  };
  const view = createSummaryView(ctx);
  await view.triggerAnalysis();
  assert.equal(message.videoId, id);
  assert.deepEqual(writes, [id]);
  await view.triggerAnalysis();
  assert.equal(writes.length, 1);
  delete globalThis.document;
});
test("P18 translated-only and bilingual rendering preserve source formatting roles", () => {
  const escape = (s) =>
    String(s).replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const ctx = { renderSubtitleInlineMarkup: escape };
  const v = createTranslationView(ctx);
  const segment = { text: "Original" };
  const bilingual = v.renderTranscriptSegmentContent(
    segment,
    "bilingual",
    "原文",
    "",
  );
  assert.match(bilingual, /Original/);
  assert.match(bilingual, /原文/);
  const chinese = v.renderTranscriptSegmentContent(segment, "zh", "原文", "");
  assert.doesNotMatch(chinese, /Original/);
  assert.match(
    v.renderTranscriptSegmentContent(
      { text: "<script>x</script>" },
      "bilingual",
      "",
      "",
    ),
    /&lt;script&gt;/,
  );
});
test("P11/P12/P13/P14/P15 view shell wires existing reading and navigation behavior", () => {
  const root = new URL("../../", import.meta.url);
  const read = (p) => fs.readFileSync(new URL(p, root), "utf8");
  const reading = read("src/features/reading/src/presentation/index.js");
  const shell = read("src/modules/gateway/src/panel.js");
  assert.match(reading, /setInterval\([\s\S]*500/);
  assert.match(reading, /autoScrollEnabled = false/);
  assert.match(reading, /restorePendingTranscriptViewState/);
  assert.match(reading, /Shift|shiftKey/);
  assert.match(reading, /original/);
  assert.match(shell, /panelWindowId/);
  assert.match(shell, /targetTabId/);
});
test("P27/P29 two export entry points remain present in the real extension HTML", () => {
  const html = fs.readFileSync(
    new URL("../../src/apps/extension/public/sidepanel.html", import.meta.url),
    "utf8",
  );
  assert.match(html, /id="exportTranscriptBtn"/);
  assert.match(html, /id="exportStudyBtn"/);
  assert.match(html, /data-tab="transcript"/);
  assert.match(html, /data-tab="overview"/);
  assert.match(html, /data-tab="notes"/);
});
test("P36 output keeps unsafe subtitle HTML escaped while allowing safe inline formatting", () => {
  const source = fs.readFileSync(
    new URL("../../src/modules/gateway/src/panel.js", import.meta.url),
    "utf8",
  );
  assert.match(source, /function renderSubtitleInlineMarkup/);
  assert.match(source, /&lt;/);
  assert.match(source, /escapeHtml/);
});
