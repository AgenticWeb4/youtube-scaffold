import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import fs from "node:fs";
import { createVocabularyView } from "../../src/features/vocabulary/dist/presentation/index.js";
import { createReadingView } from "../../src/features/reading/dist/presentation/index.js";
import { wordMatches } from "../../src/features/reading/dist/domain/word-matches.js";
const settle = () => new Promise((resolve) => setImmediate(resolve));
function dom(t) {
  const { document, window } = parseHTML(
    fs.readFileSync(
      new URL(
        "../../src/apps/extension/public/sidepanel.html",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const saved = Object.fromEntries(
    ["document", "window", "NodeFilter"].map((k) => [k, globalThis[k]]),
  );
  Object.assign(globalThis, {
    document,
    window,
    NodeFilter: { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 },
  });
  t.after(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete globalThis[k];
      else globalThis[k] = v;
    }
  });
  const dialog = document.getElementById("vocabularyDialog");
  dialog.showModal = () => {
    dialog.open = true;
  };
  dialog.close = () => {
    dialog.open = false;
  };
  return { document, window, dialog };
}
const example = (id, videoId = "videoA00001") => ({
  id,
  entryId: "word",
  videoId,
  videoTitle: "Video " + videoId,
  sentenceEn: "Evidence <script>bad()</script> supports the claim.",
  sentenceZh: "证据支持论点。",
  startMs: 2500,
  createdAt: 1,
  translationStatus: "ready",
});
test("Vocabulary cards safely render source text, expand sources, and route playback to the saved origin", async (t) => {
  const { document, dialog } = dom(t);
  const plays = [];
  const card = {
    id: "word",
    term: "evidence",
    normalizedTerm: "evidence",
    language: "en",
    examples: [example("a"), example("b", "videoB00001")],
  };
  const ctx = {
    api: { vocabulary: { list: async () => [card] } },
    setVocabularyEntries() {},
    playNote: (n) => plays.push(n),
  };
  const view = createVocabularyView(ctx);
  view.initVocabulary();
  await view.openVocabulary();
  assert.equal(document.querySelectorAll(".vocabulary-example").length, 1);
  assert.equal(document.querySelectorAll("#vocabularyList script").length, 0);
  assert.match(
    document.querySelector(".vocabulary-original").textContent,
    /<script>/,
  );
  document.querySelector(".vocabulary-expand").click();
  assert.equal(document.querySelectorAll(".vocabulary-example").length, 2);
  document.querySelectorAll(".vocabulary-play")[1].click();
  assert.equal(dialog.open, false);
  assert.equal(plays[0].videoId, "videoB00001");
  assert.equal(plays[0].timestampSeconds, 2.5);
  assert.equal(
    plays[0].timestampedUrl,
    "https://www.youtube.com/watch?v=videoB00001&t=2s",
  );
});
test("Opening an already highlighted word never auto-captures; adding uses the frozen source", async (t) => {
  const { document } = dom(t);
  let captures = [];
  const card = {
    id: "word",
    term: "evidence",
    normalizedTerm: "evidence",
    examples: [example("a")],
  };
  const view = createVocabularyView({
    api: {
      vocabulary: {
        list: async () => [card],
        capture: async (input) => {
          captures.push(input);
          return { example: example("b"), duplicate: false };
        },
      },
    },
    setVocabularyEntries() {},
  });
  view.initVocabulary();
  const input = {
    term: "evidence",
    videoId: "videoB00001",
    videoTitle: "B",
    sentenceEn: "Evidence matters.",
    startMs: 8000,
  };
  await view.openVocabulary("word", input);
  assert.equal(captures.length, 0);
  document.getElementById("vocabularyAddCurrent").click();
  await settle();
  assert.deepEqual(captures, [input]);
  assert.equal(document.getElementById("vocabularyAddCurrent").hidden, true);
  assert.equal(
    document.getElementById("vocabularyStatus").textContent,
    "已添加当前来源",
  );
});
test("Vocabulary marks survive refresh, ignore translations, and yield to phrase search without breaking it", (t) => {
  const { document } = dom(t);
  document.getElementById("transcriptList").innerHTML =
    '<div class="transcript-entry"><span class="transcript-copy"><span class="transcript-original">The evidence supports art, not start.</span><span class="transcript-translation">evidence 的中文译文</span></span></div>';
  const ctx = {
    api: { reading: { wordMatches } },
    transcriptSearchMatches: [],
    transcriptSearchIndex: -1,
    findLiteralTranscriptMatches: (text, query) => {
      const at = text.toLowerCase().indexOf(query.toLowerCase());
      return at < 0 ? [] : [{ start: at, end: at + query.length }];
    },
    hasNonCollapsedTextSelection: () => false,
    captureWordContext() {
      return null;
    },
    openVocabulary() {},
    autoScrollInterval: null,
  };
  ctx.api.reading.findLiteralTranscriptMatches =
    ctx.findLiteralTranscriptMatches;
  const view = createReadingView(ctx);
  Object.assign(ctx, view);
  view.setVocabularyEntries([
    { id: "e", normalizedTerm: "evidence" },
    { id: "a", normalizedTerm: "art" },
  ]);
  assert.equal(document.querySelectorAll(".vocabulary-mark").length, 2);
  assert.equal(
    document.querySelectorAll(".transcript-translation .vocabulary-mark")
      .length,
    0,
  );
  view.refreshTranscriptSearch({ scroll: false });
  assert.equal(document.querySelectorAll(".vocabulary-mark").length, 2);
  document.getElementById("transcriptSearchInput").value = "evidence supports";
  view.refreshTranscriptSearch({ scroll: false });
  assert.equal(
    document.querySelectorAll(".transcript-search-highlight").length,
    1,
  );
  assert.equal(document.querySelectorAll(".vocabulary-mark").length, 0);
  document.getElementById("transcriptSearchInput").value = "";
  view.refreshTranscriptSearch({ scroll: false });
  assert.equal(document.querySelectorAll(".vocabulary-mark").length, 2);
  view.setVocabularyEntries([]);
  assert.equal(document.querySelectorAll(".vocabulary-mark").length, 0);
});

test("All words clears both focused-entry and search filters across video sources", async (t) => {
  const { document } = dom(t);
  const cards = [
    { id: "a", term: "evidence", examples: [example("a")] },
    { id: "b", term: "assumptions", examples: [example("b", "videoB00001")] },
  ];
  const view = createVocabularyView({
    api: { vocabulary: { list: async () => cards } },
    setVocabularyEntries() {},
  });
  view.initVocabulary();
  await view.openVocabulary("a");
  assert.equal(document.querySelectorAll(".vocabulary-card").length, 1);
  document.getElementById("vocabularySearch").value = "no-match";
  document.getElementById("vocabularyShowAll").click();
  assert.equal(document.getElementById("vocabularySearch").value, "");
  assert.equal(document.querySelectorAll(".vocabulary-card").length, 2);
});

test("Vocabulary history expands in batches of ten without limiting storage, and collapses back to its latest source", async (t) => {
  const { document } = dom(t);
  const card = {
    id: "word",
    term: "evidence",
    normalizedTerm: "evidence",
    language: "en",
    examples: Array.from({ length: 26 }, (_, i) => ({
      ...example(String(i)),
      startMs: i * 1000,
    })),
  };
  const view = createVocabularyView({
    api: { vocabulary: { list: async () => [card] } },
    setVocabularyEntries() {},
  });
  view.initVocabulary();
  await view.openVocabulary();
  const shown = () => document.querySelectorAll(".vocabulary-example").length;
  assert.equal(shown(), 1);
  assert.equal(
    document.querySelector(".vocabulary-count").textContent,
    "26 条学习来源",
  );
  assert.equal(document.querySelector(".vocabulary-more"), null);
  document.querySelector(".vocabulary-expand").click();
  assert.equal(shown(), 11); // The latest source plus ten historical sources.
  assert.equal(
    document.querySelector(".vocabulary-expand").getAttribute("aria-expanded"),
    "true",
  );
  assert.match(
    document.querySelector(".vocabulary-more").textContent,
    /剩余 15 条/,
  );
  document.querySelector(".vocabulary-more").click();
  assert.equal(shown(), 21);
  assert.match(
    document.querySelector(".vocabulary-more").textContent,
    /剩余 5 条/,
  );
  document.querySelector(".vocabulary-more").click();
  assert.equal(shown(), 26);
  assert.equal(document.querySelector(".vocabulary-more"), null);
  await view.refreshVocabulary();
  assert.equal(shown(), 26);
  document.querySelector(".vocabulary-expand").click();
  assert.equal(shown(), 1);
  assert.equal(
    document.querySelector(".vocabulary-expand").getAttribute("aria-expanded"),
    "false",
  );
  assert.equal(document.querySelector(".vocabulary-more"), null);
  document.querySelector(".vocabulary-expand").click();
  assert.equal(shown(), 11);
  // Deleting history clamps the view and removes obsolete paging actions.
  card.examples.splice(1);
  await view.refreshVocabulary();
  assert.equal(shown(), 1);
  assert.equal(document.querySelector(".vocabulary-expand"), null);
  assert.equal(document.querySelector(".vocabulary-more"), null);
});
