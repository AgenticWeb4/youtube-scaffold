import { normalizeTerm } from "../domain/entry.js";
import { mountVocabularyDialogPosition } from "./dialog-position.js";
import type { Card, Capture, Example } from "../domain/entry.js";

/** Feature UI depends only on the injected facade. No storage or network access here. */
export function createVocabularyView(ctx: any) {
  let cards: Card[] = [];
  let loadGeneration = 0;
  let focusEntry: string | null = null;
  let currentCapture: Capture | null = null;
  // Presentation batch size is independent of how many sources a word can store.
  const HISTORY_BATCH_SIZE = 10;
  const visibleHistory = new Map<string, number>();
  const pending = new Set<string>();
  let constrainDialog = () => {};
  const dialog = () =>
    document.getElementById("vocabularyDialog") as HTMLDialogElement;
  const status = (text: string) => {
    document.getElementById("vocabularyStatus")!.textContent = text;
  };
  function element(tag: string, className: string, text = "") {
    const el = document.createElement(tag);
    el.className = className;
    el.textContent = text;
    return el;
  }
  function button(className: string, label: string, action: () => void) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = className;
    b.textContent = label;
    b.addEventListener("click", action);
    return b;
  }
  async function mutate(action: () => Promise<unknown>) {
    try {
      await action();
      status("");
      await refreshVocabulary();
    } catch {
      status("操作未完成，请重试");
    }
  }
  async function translateExample(id: string) {
    if (pending.has(id)) return;
    pending.add(id);
    render();
    try {
      await ctx.api.vocabulary.translate(id);
    } catch {
      status("原句已保存，译文待补充，可点击重试");
    } finally {
      pending.delete(id);
      await refreshVocabulary();
    }
  }
  /** Highlight the saved word without interpreting source text as markup. */
  function originalText(text: string, term: string) {
    const paragraph = element("p", "vocabulary-original");
    let cursor = 0;
    for (const match of text.matchAll(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g)) {
      if (normalizeTerm(match[0]) !== normalizeTerm(term)) continue;
      paragraph.append(
        document.createTextNode(text.slice(cursor, match.index)),
      );
      paragraph.append(element("mark", "vocabulary-term", match[0]));
      cursor = match.index! + match[0].length;
    }
    paragraph.append(document.createTextNode(text.slice(cursor)));
    return paragraph;
  }
  function renderExample(example: Example, term: string, featured: boolean) {
    const block = element("section", "vocabulary-example");
    const context = element(
      "div",
      featured ? "vocabulary-aha" : "vocabulary-history-context",
    );
    const label = element(
      "div",
      "vocabulary-context-label",
      featured ? "最近语境" : "历史语境",
    );
    if (featured) {
      const icon = element("span", "vocabulary-context-icon");
      icon.dataset.uiIcon = "explain";
      icon.setAttribute("aria-hidden", "true");
      label.prepend(icon);
    }
    context.append(label, originalText(example.sentenceEn, term));
    context.append(
      element(
        "p",
        "vocabulary-translation",
        example.sentenceZh ||
          (pending.has(example.id) ? "正在补充译文…" : "译文待补充"),
      ),
    );
    block.append(context);
    const footer = element("div", "vocabulary-source");
    const seconds = Math.floor(example.startMs / 1000);
    const origin = element("div", "vocabulary-source-info");
    origin.append(
      element("span", "vocabulary-source-label", "视频来源"),
      element("span", "vocabulary-source-title", example.videoTitle),
    );
    footer.append(origin);
    const playback = element("div", "vocabulary-playback");
    playback.append(
      button("vocabulary-play", "回到视频播放", () => {
        dialog().close();
        ctx.playNote({
          videoId: example.videoId,
          timestampSeconds: example.startMs / 1000,
          timestampedUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(example.videoId)}&t=${seconds}s`,
        });
      }),
    );
    playback.append(
      element(
        "span",
        "vocabulary-time",
        `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`,
      ),
    );
    footer.append(playback);
    if (!example.sentenceZh) {
      const retry = button(
        "vocabulary-retry",
        pending.has(example.id) ? "正在补译" : "补充译文",
        () => void translateExample(example.id),
      );
      retry.disabled = pending.has(example.id);
      footer.append(retry);
    }
    footer.append(
      button(
        "vocabulary-delete-example",
        "删除这条来源",
        () => void mutate(() => ctx.api.vocabulary.removeExample(example.id)),
      ),
    );
    block.append(footer);
    return block;
  }
  function render() {
    const list = document.getElementById("vocabularyList");
    if (!list) return;
    const query =
      (document.getElementById("vocabularySearch") as HTMLInputElement)?.value
        .trim()
        .toLowerCase() || "";
    list.replaceChildren();
    const visible = cards.filter(
      (card) =>
        (!focusEntry || card.id === focusEntry) && card.term.includes(query),
    );
    if (!visible.length)
      list.append(
        element(
          "p",
          "vocabulary-empty",
          query ? "未找到单词" : "在英文转写中选中单词，点击加入单词本。",
        ),
      );
    for (const card of visible) {
      const item = element("article", "vocabulary-card");
      item.dataset.entryId = card.id;
      const header = element("div", "vocabulary-card-header");
      header.append(
        element("h3", "", card.term),
        element("span", "vocabulary-language", "EN → 中"),
      );
      header.append(
        button("vocabulary-delete-entry", `删除单词 ${card.term}`, () => {
          if (
            window.confirm(
              `删除「${card.term}」及其 ${card.examples.length} 条来源？`,
            )
          )
            void mutate(async () => {
              await ctx.api.vocabulary.removeEntry(card.id);
              focusEntry = null;
              currentCapture = null;
            });
        }),
      );
      item.append(
        header,
        element(
          "div",
          "vocabulary-count",
          `${card.examples.length} 条学习来源`,
        ),
      );
      const historyCount = Math.max(0, card.examples.length - 1);
      const shownHistory = Math.min(
        visibleHistory.get(card.id) || 0,
        historyCount,
      );
      const shown = card.examples.slice(0, 1 + shownHistory);
      shown.forEach((example, index) =>
        item.append(renderExample(example, card.term, index === 0)),
      );
      if (shownHistory > 0 && shownHistory < historyCount) {
        item.append(
          button(
            "vocabulary-more",
            `显示更多 · 剩余 ${historyCount - shownHistory} 条`,
            () => {
              visibleHistory.set(card.id, shownHistory + HISTORY_BATCH_SIZE);
              render();
            },
          ),
        );
      }
      if (historyCount > 0) {
        const toggle = button(
          "vocabulary-expand",
          shownHistory > 0
            ? "收起历史语境"
            : `历史语境 · 另 ${historyCount} 条`,
          () => {
            if (shownHistory > 0) visibleHistory.delete(card.id);
            else visibleHistory.set(card.id, HISTORY_BATCH_SIZE);
            render();
          },
        );
        toggle.setAttribute("aria-expanded", String(shownHistory > 0));
        item.append(toggle);
      }
      list.append(item);
    }
    const add = document.getElementById(
      "vocabularyAddCurrent",
    ) as HTMLButtonElement;
    add.hidden = !currentCapture;
    document.getElementById("vocabularyCurrentContext")!.textContent =
      currentCapture?.sentenceEn || "";
    constrainDialog();
  }
  async function refreshVocabulary() {
    const generation = ++loadGeneration;
    try {
      const values = await ctx.api.vocabulary.list();
      if (generation !== loadGeneration) return;
      cards = values;
      const ids = new Set(cards.map((card) => card.id));
      for (const id of visibleHistory.keys())
        if (!ids.has(id)) visibleHistory.delete(id);
      ctx.setVocabularyEntries(cards);
      render();
    } catch (error) {
      if (generation === loadGeneration)
        status(
          error instanceof Error
            ? error.message
            : "单词本暂时无法读取，请重新打开重试",
        );
    }
  }
  async function openVocabulary(
    entryId: string | null = null,
    capture: Capture | null = null,
  ) {
    focusEntry = entryId;
    currentCapture = capture;
    (document.getElementById("vocabularySearch") as HTMLInputElement).value =
      "";
    status("");
    render();
    if (!dialog().open) dialog().showModal();
    constrainDialog();
    await refreshVocabulary();
  }
  async function captureVocabulary(input: Capture) {
    const result = await ctx.api.vocabulary.capture(input);
    await refreshVocabulary();
    // The first response is already durable. Enrichment is independent and retryable.
    if (!result.example.sentenceZh) void translateExample(result.example.id);
    return result;
  }
  function initVocabulary() {
    constrainDialog = mountVocabularyDialogPosition(
      dialog(),
      document.getElementById("vocabularyHeading")!,
    );
    document
      .getElementById("vocabularyOpenBtn")
      ?.addEventListener("click", () => void openVocabulary());
    document
      .getElementById("vocabularyCloseBtn")
      ?.addEventListener("click", () => dialog().close());
    document
      .getElementById("vocabularyShowAll")
      ?.addEventListener("click", () => {
        focusEntry = null;
        currentCapture = null;
        (
          document.getElementById("vocabularySearch") as HTMLInputElement
        ).value = "";
        render();
      });
    document
      .getElementById("vocabularySearch")
      ?.addEventListener("input", () => {
        focusEntry = null;
        render();
      });
    document
      .getElementById("vocabularyAddCurrent")
      ?.addEventListener("click", async (event) => {
        const input = currentCapture;
        if (!input) return;
        const control = event.currentTarget as HTMLButtonElement;
        control.disabled = true;
        try {
          const result = await captureVocabulary(input);
          if (input === currentCapture) {
            currentCapture = null;
            status(result.duplicate ? "这条来源已收藏" : "已添加当前来源");
            render();
          }
        } catch (error) {
          status(error instanceof Error ? error.message : "收藏失败，请重试");
        } finally {
          control.disabled = false;
        }
      });
    void refreshVocabulary();
  }
  return {
    initVocabulary,
    refreshVocabulary,
    openVocabulary,
    captureVocabulary,
  };
}
