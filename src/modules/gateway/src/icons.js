import {
  createElement,
  Settings,
  BookOpen,
  BookPlus,
  FileText,
  ListTree,
  NotebookPen,
  Copy,
  FileDown,
  FolderOutput,
  BookmarkPlus,
  Lightbulb,
  Play,
  Link,
  Trash2,
  LocateFixed,
  X,
  RotateCcw,
  PlugZap,
  Save,
  FolderOpen,
  BrushCleaning,
  Video,
  Library,
  ArrowUp,
  ArrowDown,
  Search,
  LoaderCircle,
  Check,
  CircleAlert,
} from "lucide";

// Import individual Lucide exports so the production bundle includes only used icons.
const icons = {
  vocabulary: BookOpen,
  addWord: BookPlus,
  settings: Settings,
  transcript: FileText,
  overview: ListTree,
  notes: NotebookPen,
  copy: Copy,
  download: FileDown,
  export: FolderOutput,
  bookmark: BookmarkPlus,
  explain: Lightbulb,
  play: Play,
  link: Link,
  delete: Trash2,
  follow: LocateFixed,
  close: X,
  retry: RotateCcw,
  connection: PlugZap,
  save: Save,
  folder: FolderOpen,
  clear: BrushCleaning,
  video: Video,
  library: Library,
  up: ArrowUp,
  down: ArrowDown,
  search: Search,
  busy: LoaderCircle,
  success: Check,
  error: CircleAlert,
};

const actions = [
  ["#vocabularyOpenBtn", "vocabulary"],
  [".selection-vocabulary-btn, #vocabularyAddCurrent", "addWord"],
  ["#vocabularyCloseBtn", "close"],
  ["#vocabularyShowAll", "library"],
  [".vocabulary-play", "play"],
  [".vocabulary-delete-entry, .vocabulary-delete-example", "delete"],
  [".vocabulary-retry", "retry"],
  ["#settingsBtn", "settings"],
  ['.tab[data-tab="transcript"]', "transcript"],
  ['.tab[data-tab="overview"]', "overview"],
  ['.tab[data-tab="notes"]', "notes"],
  [
    "#copyTranscriptBtn, .quote-copy-btn, .note-copy-text, #copyCustomizationPromptBtn",
    "copy",
  ],
  ["#exportTranscriptBtn", "download"],
  ["#exportStudyBtn", "export"],
  [".quote-save-note-btn, .selection-note-btn", "bookmark"],
  [".explain-btn", "explain"],
  [".note-play", "play"],
  [".note-copy-link", "link"],
  [".note-delete, #clearNotesBtn", "delete"],
  ["#followPlaybackBtn", "follow"],
  [".explain-modal-close, #transcriptSearchClearBtn", "close"],
  ["#errorBtn, .translation-retry-btn, #resetBtn", "retry"],
  ['button[data-i18n="testConnection"]', "connection"],
  ['button[data-i18n="saveSettings"], #saveExportSettingsBtn', "save"],
  ["#chooseExportDirectoryBtn", "folder"],
  ["#clearCacheBtn", "clear"],
  ["#notesFilterThis", "video"],
  ["#notesFilterAll", "library"],
  ["#transcriptSearchPrevBtn", "up"],
  ["#transcriptSearchNextBtn", "down"],
];

/** Library SVGs are decorative; the containing control owns its accessible name. */
export function createActionIcon(name) {
  return createElement(icons[name] || icons.error, {
    width: "18",
    height: "18",
    "stroke-width": "1.8",
    "aria-hidden": "true",
    focusable: "false",
    class: "ys-icon",
  });
}

/** Preserve textContent for existing copy/save handlers and translated labels. */
export function renderActionIcon(
  button,
  name,
  label = button.textContent.trim(),
) {
  const text =
    label ||
    button.dataset.iconLabel ||
    button.getAttribute("aria-label") ||
    name;
  const state = /^(saving|testing|保存中|正在测试)/i.test(text)
    ? "busy"
    : /^(saved|copied|已保存|已复制)$/i.test(text)
      ? "success"
      : /^(error|failed|错误|失败)$/i.test(text)
        ? "error"
        : name;
  if (
    button.dataset.iconRendered === `${state}:${text}` &&
    button.querySelector(".ys-icon")
  )
    return;
  button.dataset.iconLabel = text;
  button.dataset.iconRendered = `${state}:${text}`;
  button.classList.add("ys-icon-button");
  button.classList.toggle("ys-icon-busy", state === "busy");
  button.setAttribute("aria-label", text);
  button.setAttribute("title", text);
  button.setAttribute("aria-busy", String(state === "busy"));
  const hidden = button.ownerDocument.createElement("span");
  hidden.className = "ys-visually-hidden";
  hidden.style.cssText =
    "position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0";
  hidden.textContent = text;
  button.replaceChildren(createActionIcon(state), hidden);
}

/** Observe only our extension document, including lazily rendered feature controls.
 * Existing feature handlers still own every click and status transition.
 */
export function mountActionIcons(root = document) {
  const refresh = () => {
    for (const [selector, icon] of actions) {
      for (const button of root.querySelectorAll(selector)) {
        const text = button.textContent.trim();
        // Preserve descriptive names already supplied for glyph-only search controls.
        const label =
          !button.dataset.iconRendered && (!text || /^[×↑↓]$/.test(text))
            ? button.getAttribute("aria-label")
            : text;
        renderActionIcon(button, icon, label);
      }
    }
    for (const slot of root.querySelectorAll(
      "[data-ui-icon]:not([data-icon-ready])",
    )) {
      slot.replaceChildren(createActionIcon(slot.dataset.uiIcon));
      slot.dataset.iconReady = "true";
    }
  };
  refresh();
  const observer = new MutationObserver(refresh);
  observer.observe(root.body || root, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  return () => observer.disconnect();
}
