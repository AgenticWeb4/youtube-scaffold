import { mountActionIcons } from "./icons.js";
// Derived from YouTube Digest (MIT); see LICENSE and NOTICE.
export function mountOptions(api) {
  mountActionIcons();
  const YTD_OPTIONS = (() => {
    const LANGUAGE_STORAGE_KEY = "ytd_options_language";
    const PREVIEW_STORAGE_PREFIX = "youtubeScaffoldPreview:";
    const SUPPORTED_LANGUAGES = new Set(["en", "zh-CN"]);

    const COPY = {
      en: {
        pageTitle: "YouTube Scaffold Settings",
        languageGroupLabel: "Interface language",
        heading: "Bring your own API keys",
        lede: "Keys stay in this Chrome profile and are sent only to Supadata and DeepSeek. This open-source extension has no developer server or analytics.",
        transcriptProvider: "Transcript provider",
        supadataApiKeyLabel: "Supadata API key",
        supadataHelp: "Used to fetch timestamped YouTube subtitles. ",
        supadataLink: "Create a Supadata account and key",
        supadataHelpSuffix: ". Supadata generates the key during onboarding.",
        aiProvider: "AI provider",
        providerSummaryLabel: "Supported AI provider",
        providerBadge: "Supported in this version",
        deepseekApiKeyLabel: "DeepSeek API key",
        deepseekHelp:
          "YouTube Scaffold uses DeepSeek V4 Flash for overviews, explanations, translation, and note polishing. ",
        deepseekLink: "Create a DeepSeek API key",
        deepseekHelpSuffix: ".",
        privacyNote:
          "When you use AI features, DeepSeek receives the video transcript and relevant video context. Review DeepSeek's terms and pricing before saving.",
        saveSettings: "Save settings",
        testConnection: "Test connection",
        connectionTesting: "Testing…",
        connectionConnected:
          "Connected. Authentication accepted; generation and quota are not tested.",
        connectionAuthFailed:
          "Authentication or access denied. Check this key.",
        connectionNoKey: "Enter this provider's API key first.",
        connectionRateLimited:
          "The service is rate-limiting requests. Try again shortly.",
        connectionTimeout:
          "Connection timed out. Check your network and retry.",
        connectionNetworkError:
          "Could not reach the service. Check your network and retry.",
        connectionHttpError: "The service returned an error. Try again later.",
        exportSettings: "Export settings",
        exportDirectoryHelp:
          "Choose your project's _support/inbox/youtube-digest-kit folder once. Future exports use that folder. Chrome may ask you to renew folder access.",
        exportDirectoryLabel: "Save folder",
        chooseExportDirectory: "Choose folder",
        exportContents: "Export contents",
        exportAnalysis: "Overview",
        exportTranscript: "Transcript",
        exportNotes: "Notes",
        exportFormatHelp:
          "Each export creates a new Markdown file. Existing files are kept.",
        saveExportSettings: "Save export settings",
        exportDirectoryUnset: "Not selected",
        exportDirectorySelected: ({ name }) => name,
        exportSettingsSaved: "Export settings saved.",
        exportDirectorySaved:
          "Folder saved. Use Export study in the side panel.",
        exportSettingsFailed:
          "Could not save export settings. Please try again.",
        exportDirectoryFailed:
          "Could not access this folder. Choose it again in desktop Chrome.",
        exportNoSections: "Select at least one export section.",
        localRemix: "Local remix",
        customizationTitle: "Want to use another AI model?",
        customizationPurpose:
          "Edit and copy a safe prompt for your coding agent",
        agentBadge: "Coding agent ready",
        customizationIntro:
          "You can edit the prompt directly. Complete these three steps before copying:",
        customizationStepFolder:
          "Open the extracted YouTube Scaffold project folder in your coding agent.",
        customizationStepReplace:
          "Replace [PROVIDER] and [MODEL] with the service and model you want to use.",
        customizationStepKeys:
          "Never include API keys in the prompt or chat. Enter them yourself after the code is ready.",
        customizationPromptLabel: "Editable customization prompt",
        customizationReminderLabel: "Prompt reminder",
        customizationReminder:
          "Before copying, replace [PROVIDER] and [MODEL] with the provider and model you want to use.",
        customizationPrompt:
          "Customize this local YouTube Scaffold source project to use [PROVIDER] with [MODEL]. Confirm package.json and src/apps/extension/public/manifest.json identify this project. Update the provider adapter, settings, and minimum host permissions. Preserve local storage and keep API keys out of source, logs, and chat. Update README.md, PRIVACY.md, and relevant tests. Run pnpm run check and pnpm run package from the project root. Rebuild dist/extension, then explain how to reload Chrome and test a real YouTube video. If only an unpacked release is available, request its matching source project before editing.",
        copyCustomizationPrompt: "Copy edited prompt",
        localData: "Local data",
        localDataHelp:
          "Digests, translations, and notes stay in this Chrome profile. Exported files stay in your chosen folder and are not deleted by a reset.",
        clearCache: "Clear cached digests",
        deleteNotes: "Delete all notes",
        resetData: "Reset extension data",
        footer:
          'Read <a href="PRIVACY.md" target="_blank">PRIVACY.md</a> in the repository for the complete data-flow description.',
        migrationWarning:
          "Custom provider settings were removed safely. Your Supadata key was kept, but the AI key was cleared. Enter a DeepSeek API key to continue.",
        saving: "Saving…",
        addSupadataKey: "Add a Supadata API key.",
        addDeepseekKey: "Add a DeepSeek API key.",
        saved: "Saved. Reopen YouTube Scaffold to use these settings.",
        saveFailed: "Could not save settings. Please try again.",
        copying: "Copying…",
        promptCopied: "Edited prompt copied.",
        copyFailed:
          "Could not copy the prompt. Select the prompt text and copy it manually.",
        clearedDigests: ({ count }) =>
          `Cleared ${count} cached digest${count === 1 ? "" : "s"}.`,
        notesDeleted: "Deleted all saved notes.",
        resetConfirm:
          "Delete API keys, cached digests, translations, saved notes, and export settings from this Chrome profile? Exported files will remain.",
        allDataDeleted: "All YouTube Scaffold data was deleted.",
        settingsLoadFailed:
          "Could not load saved settings. You can still preview this page.",
      },
      "zh-CN": {
        pageTitle: "YouTube Scaffold 设置",
        languageGroupLabel: "界面语言",
        heading: "使用你自己的 API 密钥",
        lede: "密钥仅保存在当前 Chrome 个人资料中，只会发送给 Supadata 和 DeepSeek。本开源扩展没有开发者服务器，也不使用分析服务。",
        transcriptProvider: "字幕服务",
        supadataApiKeyLabel: "Supadata API 密钥",
        supadataHelp: "用于获取带时间戳的 YouTube 字幕。",
        supadataLink: "创建 Supadata 账号并获取密钥",
        supadataHelpSuffix: "。Supadata 会在引导流程中生成密钥。",
        aiProvider: "AI 服务",
        providerSummaryLabel: "支持的 AI 服务",
        providerBadge: "当前版本支持",
        deepseekApiKeyLabel: "DeepSeek API 密钥",
        deepseekHelp:
          "YouTube Scaffold 使用 DeepSeek V4 Flash 生成概览、解释内容、翻译字幕和润色笔记。",
        deepseekLink: "创建 DeepSeek API 密钥",
        deepseekHelpSuffix: "。",
        privacyNote:
          "使用 AI 功能时，DeepSeek 会收到视频字幕及相关视频上下文。保存前请查看 DeepSeek 的服务条款和价格。",
        saveSettings: "保存设置",
        testConnection: "测试连接",
        connectionTesting: "正在测试…",
        connectionConnected: "连接成功，认证通过；未测试生成能力或额度。",
        connectionAuthFailed: "认证或访问权限失败，请检查此密钥。",
        connectionNoKey: "请先填写此服务的 API 密钥。",
        connectionRateLimited: "服务暂时限流，请稍后重试。",
        connectionTimeout: "连接超时，请检查网络后重试。",
        connectionNetworkError: "无法连接服务，请检查网络后重试。",
        connectionHttpError: "服务返回错误，请稍后重试。",
        exportSettings: "导出设置",
        exportDirectoryHelp:
          "首次选择项目中的 _support/inbox/youtube-digest-kit 文件夹，之后默认保存到这里。Chrome 可能要求重新授权。",
        exportDirectoryLabel: "保存目录",
        chooseExportDirectory: "选择目录",
        exportContents: "导出内容",
        exportAnalysis: "分析",
        exportTranscript: "字幕",
        exportNotes: "笔记",
        exportFormatHelp: "每次生成一份新的 Markdown 文件，已有文件会保留。",
        saveExportSettings: "保存导出设置",
        exportDirectoryUnset: "尚未选择",
        exportDirectorySelected: ({ name }) => name,
        exportSettingsSaved: "导出设置已保存。",
        exportDirectorySaved: "目录已保存，可在侧边栏点击 Export study 导出。",
        exportSettingsFailed: "无法保存导出设置，请重试。",
        exportDirectoryFailed: "无法访问目录，请在桌面版 Chrome 中重新选择。",
        exportNoSections: "请至少选择一项导出内容。",
        localRemix: "本地改造",
        customizationTitle: "想使用其他 AI 模型？",
        customizationPurpose: "编辑并复制一段可安全交给编程 Agent 的提示词",
        agentBadge: "可交给编程 Agent",
        customizationIntro: "你可以直接编辑提示词。复制前完成以下三步：",
        customizationStepFolder:
          "在编程 Agent 中打开 YouTube Scaffold 解压后的项目文件夹。",
        customizationStepReplace:
          "把 [PROVIDER] 和 [MODEL] 替换成你想使用的服务和模型。",
        customizationStepKeys:
          "不要在提示词或聊天中加入 API 密钥。代码准备好后，请自行填写。",
        customizationPromptLabel: "可编辑的自定义提示词",
        customizationReminderLabel: "提示词提醒",
        customizationReminder:
          "复制前，请先把 [PROVIDER] 和 [MODEL] 替换成你想使用的服务和模型。",
        customizationPrompt:
          "请将当前 YouTube Scaffold 源码项目改为使用 [PROVIDER] 和 [MODEL]。先确认 package.json 与 src/apps/extension/public/manifest.json 属于本项目。更新服务适配器、设置及最小网站权限，保留本地存储，不把 API Key 写入源码、日志或聊天。同步更新 README.md、PRIVACY.md 和相关测试，在项目根目录运行 pnpm run check 与 pnpm run package。重新构建 dist/extension 后，说明如何在 Chrome 重新加载并用真实视频验证。如果只有解压后的安装包，请先取得对应源码再修改。",
        copyCustomizationPrompt: "复制编辑后的提示词",
        localData: "本地数据",
        localDataHelp:
          "摘要、翻译和笔记保存在当前 Chrome 个人资料中。导出文件保存在所选目录，重置扩展不会删除它们。",
        clearCache: "清除缓存的摘要",
        deleteNotes: "删除全部笔记",
        resetData: "重置扩展数据",
        footer:
          '完整数据流说明请参阅仓库中的 <a href="PRIVACY.md" target="_blank">PRIVACY.md</a>。',
        migrationWarning:
          "已安全移除自定义服务设置。Supadata 密钥已保留，AI 密钥已清除。请输入 DeepSeek API 密钥以继续使用。",
        saving: "正在保存…",
        addSupadataKey: "请添加 Supadata API 密钥。",
        addDeepseekKey: "请添加 DeepSeek API 密钥。",
        saved: "已保存。请重新打开 YouTube Scaffold 以使用这些设置。",
        saveFailed: "无法保存设置，请重试。",
        copying: "正在复制…",
        promptCopied: "已复制编辑后的提示词。",
        copyFailed: "无法复制提示词。请选中提示词文本并手动复制。",
        clearedDigests: ({ count }) => `已清除 ${count} 条缓存摘要。`,
        notesDeleted: "已删除全部已保存的笔记。",
        resetConfirm:
          "要删除当前 Chrome 个人资料中的 API 密钥、缓存摘要、翻译、笔记和导出设置吗？已导出的文件会保留。",
        allDataDeleted: "已删除全部 YouTube Scaffold 数据。",
        settingsLoadFailed: "无法加载已保存的设置，但你仍可预览此页面。",
      },
    };

    function normalizeLanguage(language) {
      return SUPPORTED_LANGUAGES.has(language) ? language : "en";
    }

    function translate(language, key, params = {}) {
      const normalizedLanguage = normalizeLanguage(language);
      const value = COPY[normalizedLanguage][key] ?? COPY.en[key] ?? "";
      return typeof value === "function" ? value(params) : value;
    }

    function createStorageAdapter(chromeApi, fallbackStorage) {
      if (api.configurationStorage) return api.configurationStorage;
      const chromeStorage = chromeApi?.storage?.local;
      const memoryStorage = new Map();

      function fallbackKeys() {
        const keys = [];
        if (!fallbackStorage) return keys;
        try {
          for (let index = 0; index < fallbackStorage.length; index += 1) {
            const key = fallbackStorage.key(index);
            if (key?.startsWith(PREVIEW_STORAGE_PREFIX)) keys.push(key);
          }
        } catch (_error) {
          return [];
        }
        return keys;
      }

      function readFallbackValue(key) {
        try {
          const rawValue = fallbackStorage?.getItem(
            `${PREVIEW_STORAGE_PREFIX}${key}`,
          );
          if (rawValue !== null && rawValue !== undefined) {
            return JSON.parse(rawValue);
          }
        } catch (_error) {
          // Fall through to memory when localStorage is unavailable or malformed.
        }
        return memoryStorage.get(key);
      }

      function writeFallbackValue(key, value) {
        memoryStorage.set(key, value);
        try {
          fallbackStorage?.setItem(
            `${PREVIEW_STORAGE_PREFIX}${key}`,
            JSON.stringify(value),
          );
        } catch (_error) {
          // The in-memory copy keeps a restricted preview functional.
        }
      }

      return {
        async get(keys) {
          if (chromeStorage) return chromeStorage.get(keys);

          const requestedKeys =
            keys === null
              ? [
                  ...new Set([
                    ...memoryStorage.keys(),
                    ...fallbackKeys().map((key) =>
                      key.slice(PREVIEW_STORAGE_PREFIX.length),
                    ),
                  ]),
                ]
              : Array.isArray(keys)
                ? keys
                : [keys];

          return Object.fromEntries(
            requestedKeys
              .map((key) => [key, readFallbackValue(key)])
              .filter(([, value]) => value !== undefined),
          );
        },

        async set(items) {
          if (chromeStorage) return chromeStorage.set(items);
          for (const [key, value] of Object.entries(items)) {
            writeFallbackValue(key, value);
          }
        },

        async remove(keys) {
          if (chromeStorage) return chromeStorage.remove(keys);
          for (const key of Array.isArray(keys) ? keys : [keys]) {
            memoryStorage.delete(key);
            try {
              fallbackStorage?.removeItem(`${PREVIEW_STORAGE_PREFIX}${key}`);
            } catch (_error) {
              // Memory removal is sufficient for this preview session.
            }
          }
        },

        async clear() {
          if (chromeStorage) return chromeStorage.clear();
          memoryStorage.clear();
          for (const key of fallbackKeys()) {
            try {
              fallbackStorage.removeItem(key);
            } catch (_error) {
              // Continue clearing any remaining preview keys.
            }
          }
        },
      };
    }

    async function readPreferredLanguage(storage) {
      const stored = await storage.get(LANGUAGE_STORAGE_KEY);
      return normalizeLanguage(stored[LANGUAGE_STORAGE_KEY]);
    }

    async function persistPreferredLanguage(storage, language) {
      const normalizedLanguage = normalizeLanguage(language);
      await storage.set({ [LANGUAGE_STORAGE_KEY]: normalizedLanguage });
      return normalizedLanguage;
    }

    function updateLanguageButtonState(buttons, language) {
      const normalizedLanguage = normalizeLanguage(language);
      for (const button of buttons) {
        button.setAttribute(
          "aria-pressed",
          String(button.dataset.language === normalizedLanguage),
        );
      }
    }

    function updateLocalizedPrompt(textarea, prompt) {
      const selectionStart = textarea.selectionStart;
      const selectionEnd = textarea.selectionEnd;
      const selectionDirection = textarea.selectionDirection;
      const scrollTop = textarea.scrollTop;
      const scrollLeft = textarea.scrollLeft;

      textarea.value = prompt;

      if (
        Number.isInteger(selectionStart) &&
        Number.isInteger(selectionEnd) &&
        typeof textarea.setSelectionRange === "function"
      ) {
        textarea.setSelectionRange(
          Math.min(selectionStart, prompt.length),
          Math.min(selectionEnd, prompt.length),
          selectionDirection || "none",
        );
      }
      textarea.scrollTop = scrollTop;
      textarea.scrollLeft = scrollLeft;
    }

    function createPromptDrafts() {
      return {
        en: translate("en", "customizationPrompt"),
        "zh-CN": translate("zh-CN", "customizationPrompt"),
      };
    }

    function switchPromptDraft(
      drafts,
      currentLanguage,
      nextLanguage,
      currentValue,
    ) {
      const normalizedCurrentLanguage = normalizeLanguage(currentLanguage);
      const normalizedNextLanguage = normalizeLanguage(nextLanguage);
      drafts[normalizedCurrentLanguage] = String(currentValue ?? "");
      if (typeof drafts[normalizedNextLanguage] !== "string") {
        drafts[normalizedNextLanguage] = translate(
          normalizedNextLanguage,
          "customizationPrompt",
        );
      }
      return {
        language: normalizedNextLanguage,
        prompt: drafts[normalizedNextLanguage],
      };
    }

    async function copyPromptValue(clipboard, value) {
      await clipboard.writeText(value);
    }

    function getSafeLocalStorage(root) {
      try {
        return root.localStorage;
      } catch (_error) {
        return null;
      }
    }

    function initialize(root = globalThis) {
      const doc = root.document;
      const settingsApi = api.settings;
      if (!doc || !settingsApi) return;

      const storage = createStorageAdapter(
        root.chrome,
        getSafeLocalStorage(root),
      );
      const form = doc.getElementById("settingsForm");
      const aiApiKeyInput = doc.getElementById("aiApiKey");
      const supadataApiKeyInput = doc.getElementById("supadataApiKey");
      const customizationPrompt = doc.getElementById("customizationPrompt");
      const copyCustomizationPromptBtn = doc.getElementById(
        "copyCustomizationPromptBtn",
      );
      const copyStatus = doc.getElementById("copyStatus");
      const saveStatus = doc.getElementById("saveStatus");
      const dataStatus = doc.getElementById("dataStatus");
      const exportApi = api.export;
      const exportStatus = doc.getElementById("exportStatus");
      const exportDirectoryName = doc.getElementById("exportDirectoryName");
      const exportSectionInputs = [
        ...doc.querySelectorAll("[data-export-section]"),
      ];
      const languageButtons = [...doc.querySelectorAll("[data-language]")];
      const statusStates = new Map();
      const promptDrafts = createPromptDrafts();
      let currentLanguage = "en";

      function renderStatus(element) {
        const state = statusStates.get(element);
        element.textContent = state
          ? translate(currentLanguage, state.key, state.params)
          : "";
      }

      function setStatus(element, key, params = {}) {
        statusStates.set(element, { key, params });
        renderStatus(element);
      }

      function applyLanguage(language) {
        const nextDraft = switchPromptDraft(
          promptDrafts,
          currentLanguage,
          language,
          customizationPrompt.value,
        );
        currentLanguage = nextDraft.language;
        doc.documentElement.lang = currentLanguage;
        doc.title = translate(currentLanguage, "pageTitle");

        for (const element of doc.querySelectorAll("[data-i18n]")) {
          element.textContent = translate(
            currentLanguage,
            element.dataset.i18n,
          );
        }
        for (const element of doc.querySelectorAll("[data-i18n-html]")) {
          element.innerHTML = translate(
            currentLanguage,
            element.dataset.i18nHtml,
          );
        }
        for (const element of doc.querySelectorAll("[data-i18n-aria-label]")) {
          element.setAttribute(
            "aria-label",
            translate(currentLanguage, element.dataset.i18nAriaLabel),
          );
        }

        updateLocalizedPrompt(customizationPrompt, nextDraft.prompt);
        updateLanguageButtonState(languageButtons, currentLanguage);
        for (const element of statusStates.keys()) renderStatus(element);
      }

      async function loadSettings() {
        try {
          const stored = await storage.get(settingsApi.STORAGE_KEY);
          const migration = settingsApi.migrateLegacyCustom(
            stored[settingsApi.STORAGE_KEY],
          );
          const settings = migration.settings;

          aiApiKeyInput.value = settings.aiApiKey;
          supadataApiKeyInput.value = settings.supadataApiKey;
          if (migration.migrated) {
            await storage.set({ [settingsApi.STORAGE_KEY]: settings });
            setStatus(saveStatus, "migrationWarning");
          }
        } catch (_error) {
          setStatus(saveStatus, "settingsLoadFailed");
        }
      }

      async function loadOptions() {
        try {
          applyLanguage(await readPreferredLanguage(storage));
        } catch (_error) {
          applyLanguage("en");
        }
        await loadSettings();
        await loadExportSettings();
      }

      async function loadExportSettings() {
        if (!exportApi || !exportDirectoryName) return;
        try {
          const config = await exportApi.readConfig();
          setStatus(
            exportDirectoryName,
            config.directoryName
              ? "exportDirectorySelected"
              : "exportDirectoryUnset",
            { name: config.directoryName },
          );
          for (const input of exportSectionInputs)
            input.checked = config.sections[input.dataset.exportSection];
        } catch (_error) {
          setStatus(exportDirectoryName, "exportDirectoryUnset");
          setStatus(exportStatus, "exportSettingsFailed");
        }
      }

      async function chooseExportDirectory() {
        try {
          const name = await exportApi.chooseDirectory();
          setStatus(exportDirectoryName, "exportDirectorySelected", { name });
          setStatus(exportStatus, "exportDirectorySaved");
        } catch (error) {
          if (error.name !== "AbortError")
            setStatus(exportStatus, "exportDirectoryFailed");
        }
      }

      async function saveExportSettings() {
        try {
          const sections = Object.fromEntries(
            exportSectionInputs.map((input) => [
              input.dataset.exportSection,
              input.checked,
            ]),
          );
          await exportApi.setSections(sections);
          setStatus(exportStatus, "exportSettingsSaved");
        } catch (error) {
          setStatus(
            exportStatus,
            error.code === "NO_SECTIONS"
              ? "exportNoSections"
              : "exportSettingsFailed",
          );
        }
      }

      async function saveSettings(event) {
        event.preventDefault();
        setStatus(saveStatus, "saving");

        const settings = settingsApi.normalize({
          aiApiKey: aiApiKeyInput.value,
          supadataApiKey: supadataApiKeyInput.value,
        });

        if (!settings.supadataApiKey) {
          setStatus(saveStatus, "addSupadataKey");
          return;
        }
        if (!settings.aiApiKey) {
          setStatus(saveStatus, "addDeepseekKey");
          return;
        }

        try {
          await storage.set({ [settingsApi.STORAGE_KEY]: settings });
          setStatus(saveStatus, "saved");
        } catch (_error) {
          setStatus(saveStatus, "saveFailed");
        }
      }

      async function copyCustomizationPrompt() {
        setStatus(copyStatus, "copying");
        try {
          await copyPromptValue(
            root.navigator.clipboard,
            customizationPrompt.value,
          );
          setStatus(copyStatus, "promptCopied");
        } catch (_error) {
          setStatus(copyStatus, "copyFailed");
        }
      }

      async function clearCachedDigests() {
        const count = await api.cache.clear();
        setStatus(dataStatus, "clearedDigests", { count });
      }

      async function clearNotes() {
        await api.collection.clear();
        setStatus(dataStatus, "notesDeleted");
      }

      async function resetAllData() {
        const confirmed = root.confirm(
          translate(currentLanguage, "resetConfirm"),
        );
        if (!confirmed) return;

        await api.reset();
        if (exportApi) await exportApi.reset();
        await persistPreferredLanguage(storage, currentLanguage);
        await loadSettings();
        await loadExportSettings();
        setStatus(dataStatus, "allDataDeleted");
      }

      // Each probe uses the unsaved input snapshot and never persists the tested key.
      for (const [provider, input] of [
        ["supadata", supadataApiKeyInput],
        ["deepseek", aiApiKeyInput],
      ]) {
        const button = doc.getElementById(provider + "TestConnectionBtn");
        const status = doc.getElementById(provider + "ConnectionStatus");
        let generation = 0;
        input.addEventListener("input", () => {
          generation++;
          status.textContent = "";
        });
        button.addEventListener("click", async () => {
          const expected = generation;
          const key = input.value;
          button.disabled = true;
          setStatus(status, "connectionTesting");
          try {
            const result = await api.sendMessage({
              action: "testConnection",
              provider,
              apiKey: key,
            });
            if (expected !== generation) return;
            const names = {
              CONNECTED: "connectionConnected",
              AUTH_FAILED: "connectionAuthFailed",
              NO_KEY: "connectionNoKey",
              RATE_LIMITED: "connectionRateLimited",
              TIMEOUT: "connectionTimeout",
              NETWORK_ERROR: "connectionNetworkError",
              HTTP_ERROR: "connectionHttpError",
            };
            setStatus(status, names[result.code] || "connectionHttpError");
          } catch (_) {
            if (expected === generation)
              setStatus(status, "connectionNetworkError");
          } finally {
            button.disabled = false;
          }
        });
      }
      form.addEventListener("submit", saveSettings);
      if (exportApi) {
        doc
          .getElementById("chooseExportDirectoryBtn")
          ?.addEventListener("click", chooseExportDirectory);
        doc
          .getElementById("saveExportSettingsBtn")
          ?.addEventListener("click", saveExportSettings);
      }
      copyCustomizationPromptBtn.addEventListener(
        "click",
        copyCustomizationPrompt,
      );
      doc
        .getElementById("clearCacheBtn")
        .addEventListener("click", clearCachedDigests);
      doc.getElementById("clearNotesBtn").addEventListener("click", clearNotes);
      doc.getElementById("resetBtn").addEventListener("click", resetAllData);
      for (const button of languageButtons) {
        button.addEventListener("click", async () => {
          const language = button.dataset.language;
          applyLanguage(language);
          await persistPreferredLanguage(storage, language);
        });
      }

      if (doc.readyState === "loading") {
        doc.addEventListener("DOMContentLoaded", loadOptions, { once: true });
      } else {
        void loadOptions();
      }
    }

    return {
      COPY,
      LANGUAGE_STORAGE_KEY,
      copyPromptValue,
      createPromptDrafts,
      createStorageAdapter,
      normalizeLanguage,
      persistPreferredLanguage,
      readPreferredLanguage,
      translate,
      updateLanguageButtonState,
      updateLocalizedPrompt,
      switchPromptDraft,
      initialize,
    };
  })();

  if (typeof document !== "undefined") {
    YTD_OPTIONS.initialize();
  }

  return YTD_OPTIONS;
}
