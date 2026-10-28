import type { Vocabulary } from "@ys/vocabulary";
import type { Reading } from "@ys/reading";
import type { Translation } from "@ys/translation";
import type { Explanation } from "@ys/explanation";
import type { Summary } from "@ys/summary";
import type { Collection } from "@ys/collection";
import type { Export } from "@ys/export";
import type {
  Config,
  CacheSnapshot,
  Remote,
  RemoteMessage,
  Trace,
} from "@ys/shared";

export interface ConfigurationPort {
  read(): Promise<Config>;
  readRaw(): Promise<Record<string, unknown> | undefined>;
  save(value: unknown): Promise<Config>;
  language(): Promise<unknown>;
  setLanguage(value: unknown): Promise<void>;
  reset(): Promise<void>;
  testConnection(
    provider: string,
    apiKey: string,
  ): Promise<{
    success: boolean;
    provider: string;
    code: string;
    status?: number;
  }>;
}
export interface ExecutionPort {
  enter(trace: Trace): Promise<boolean>;
  finish(trace: Trace): Promise<void>;
  clear(): Promise<void>;
}
export interface ApplicationPorts {
  vocabulary: Vocabulary;
  reading: Reading;
  translation: Translation;
  explanation: Explanation;
  summary: Summary;
  collection: Collection;
  config: ConfigurationPort;
  execution: ExecutionPort;
  notify(message: Record<string, unknown>): void;
}
const trustedOnly = new Set([
  "vocabularyList",
  "vocabularyCapture",
  "vocabularyTranslate",
  "vocabularyRemoveEntry",
  "vocabularyRemoveExample",
  "cacheRead",
  "cacheWrite",
  "cacheEvict",
  "cacheClear",
  "viewGet",
  "viewSet",
  "configurationGet",
  "configurationSet",
  "configurationRemove",
  "testConnection",
  "resetData",
  "clearNotes",
  "deleteNote",
  "getNotes",
  "analyzeTranscript",
  "translateContent",
  "explainSelection",
]);

/** Named mediator rules preserve completion order, request identity and failure cases. */
export function createApplication(p: ApplicationPorts) {
  const inFlight = new Map<string, Promise<any>>();
  let resetEpoch = 0;
  const translations = new Map<string, Promise<any>>();
  let mutationQueue: Promise<unknown> = Promise.resolve();

  async function readCache(videoId: string): Promise<CacheSnapshot | null> {
    const material = await p.reading.read(videoId);
    if (!material) return null;
    const [analysis, translated] = await Promise.all([
      p.summary.read(videoId),
      p.translation.read(videoId),
    ]);
    return { ...material, analysis, ...translated };
  }

  // Rule CacheWritten: only public owner actions can persist their respective fields.
  async function writeCache(videoId: string, value: CacheSnapshot) {
    await p.reading.save(videoId, value);
    await p.summary.save(videoId, value.analysis);
    await p.translation.save(videoId, value);
    const evicted = await p.reading.evict(20);
    await Promise.all([
      p.summary.remove(evicted),
      p.translation.remove(evicted),
    ]);
    return { success: true };
  }
  async function clearCache() {
    const count = await p.reading.clear();
    await Promise.all([p.summary.clear(), p.translation.clear()]);
    return count;
  }

  // Rule NoteRequested: source acquisition is outside Collection; exact capture skips it entirely.
  async function saveNote(m: any, epoch: number, trace: Trace) {
    const input = {
      videoId: String(m.videoId || ""),
      timestamp: Number(m.timestamp),
      videoTitle: m.videoTitle,
      channelName: m.channelName,
      selectedText: m.selectedText,
      operationId: m.__ys_requestId,
    };
    let result;
    if (typeof input.selectedText === "string" && input.selectedText.trim()) {
      trace.emittedCalls.push("Collection/saveExact");
      result = await p.collection.saveExact(input);
    } else {
      trace.emittedCalls.push("Reading/load");
      const material = await p.reading.load(input.videoId);
      if (!material.success)
        return {
          success: false,
          error: "Could not fetch transcript",
          message: material.message || material.error,
        };
      if (epoch !== resetEpoch)
        return { success: false, error: "Data was reset during capture" };
      trace.emittedCalls.push("Collection/saveMoment");
      result = await p.collection.saveMoment(input, material.transcript);
    }
    if (result.success) p.notify({ action: "noteSaved", note: result.note });
    return result;
  }

  async function apply(m: any, epoch: number, trace: Trace): Promise<any> {
    switch (m.action) {
      case "vocabularyList":
        return { success: true, cards: await p.vocabulary.list() };
      case "vocabularyCapture": {
        trace.emittedCalls.push("Vocabulary/capture");
        const result = await p.vocabulary.capture(m.input);
        p.notify({ action: "vocabularyChanged" });
        return { success: true, ...result };
      }
      case "vocabularyRemoveEntry":
      case "vocabularyRemoveExample": {
        const entry = m.action === "vocabularyRemoveEntry";
        trace.emittedCalls.push(
          entry ? "Vocabulary/removeEntry" : "Vocabulary/removeExample",
        );
        if (entry) await p.vocabulary.removeEntry(String(m.id));
        else await p.vocabulary.removeExample(String(m.id));
        p.notify({ action: "vocabularyChanged" });
        return { success: true };
      }
      case "vocabularyTranslate": {
        const id = String(m.id);
        if (!translations.has(id)) {
          const operation = (async () => {
            const example = await p.vocabulary.example(id);
            if (!example || example.sentenceZh) return { success: true };
            let text = "";
            try {
              trace.emittedCalls.push("Translation/translate");
              const result = await p.translation.translate({
                content: {
                  segments: [{ id: "vocabulary", text: example.sentenceEn }],
                },
                contentType: "transcriptBatch",
                targetLanguage: "zh",
                videoTitle: example.videoTitle,
              });
              if (result.success)
                text =
                  result.translatedContent?.segments?.find(
                    (s: any) => s.id === "vocabulary",
                  )?.text || "";
            } catch {
              /* Exact capture already succeeded. A failed enrichment remains retryable. */
            }
            trace.emittedCalls.push("Vocabulary/completeTranslation");
            await p.vocabulary.completeTranslation(id, text);
            p.notify({ action: "vocabularyChanged" });
            return { success: true, translated: !!text };
          })();
          translations.set(id, operation);
        }
        try {
          return await translations.get(id);
        } finally {
          translations.delete(id);
        }
      }
      case "fetchTranscript":
        trace.emittedCalls.push("Reading/load");
        return p.reading.load(String(m.videoId || ""));
      case "checkConfig": {
        const c = await p.config.read();
        return { hasSupadataKey: !!c.supadataApiKey, hasAiKey: !!c.aiApiKey };
      }
      case "analyzeTranscript": {
        trace.emittedCalls.push("Summary/analyze");
        const result = await p.summary.analyze({
          ...m,
          videoId: String(m.videoId || ""),
          transcriptText: String(m.transcriptText || ""),
        });
        if (result.success && epoch === resetEpoch) {
          trace.emittedCalls.push("Summary/save");
          await p.summary.save(String(m.videoId), result.analysis);
        }
        return result;
      }
      case "translateContent":
        trace.emittedCalls.push("Translation/translate");
        return p.translation.translate(m);
      case "explainSelection":
        trace.emittedCalls.push("Explanation/explain");
        return p.explanation.explain(m);
      case "saveNote":
        return saveNote(m, epoch, trace);
      case "getNotes":
        return p.collection.list(m.videoId);
      case "deleteNote":
        trace.emittedCalls.push("Collection/delete");
        return p.collection.delete(String(m.noteId));
      case "clearNotes":
        trace.emittedCalls.push("Collection/clear");
        await p.collection.clear();
        return { success: true };
      case "cacheRead":
        return { success: true, value: await readCache(String(m.videoId)) };
      case "cacheWrite":
        trace.emittedCalls.push(
          "Reading/save",
          "Summary/save",
          "Translation/save",
          "Reading/evict",
        );
        return writeCache(String(m.videoId), m.value);
      case "cacheEvict": {
        const ids = await p.reading.evict(Number(m.max) || 20);
        await Promise.all([p.summary.remove(ids), p.translation.remove(ids)]);
        return { success: true };
      }
      case "cacheClear":
        return { success: true, count: await clearCache() };
      case "viewGet":
        return { success: true, value: await p.reading.viewStorage.get(m.key) };
      case "viewSet":
        await p.reading.viewStorage.set(m.value);
        return { success: true };
      case "configurationGet": {
        const keys =
          m.keys === null
            ? ["ytd_settings", "ytd_options_language"]
            : Array.isArray(m.keys)
              ? m.keys
              : [m.keys];
        const value: Record<string, unknown> = {};
        for (const key of keys) {
          if (key === "ytd_settings") value[key] = await p.config.readRaw();
          else if (key === "ytd_options_language")
            value[key] = await p.config.language();
          else throw new Error("Unknown configuration key");
        }
        return { success: true, value };
      }
      case "configurationSet":
        for (const [key, value] of Object.entries(m.value || {})) {
          if (key === "ytd_settings") await p.config.save(value);
          else if (key === "ytd_options_language")
            await p.config.setLanguage(value);
          else throw new Error("Unknown configuration key");
        }
        return { success: true };
      case "configurationRemove":
        throw new Error("Use the named owner clear/reset operation");
      case "testConnection":
        trace.emittedCalls.push("Configuration/testConnection");
        return p.config.testConnection(
          String(m.provider || ""),
          String(m.apiKey || ""),
        );
      case "resetData":
        resetEpoch += 1;
        trace.emittedCalls.push(
          "Reading/clear",
          "Summary/clear",
          "Translation/clear",
          "Collection/clear",
          "Vocabulary/clear",
          "Reading/resetView",
          "Configuration/reset",
        );
        await Promise.all([
          clearCache(),
          p.collection.clear(),
          p.vocabulary.clear(),
          p.reading.resetView(),
          p.config.reset(),
        ]);
        await p.execution.clear();
        p.notify({ action: "dataReset" });
        return { success: true };
      default:
        return { success: false, error: `Unknown action: ${String(m.action)}` };
    }
  }

  async function dispatch(
    message: RemoteMessage,
    context: { trusted: boolean; sourceUrl?: string | null },
  ): Promise<any> {
    if (!message || typeof message.action !== "string")
      return { success: false, error: "Invalid request" };
    if (trustedOnly.has(message.action) && !context.trusted)
      return { success: false, error: "Trusted extension page required" };
    if (context.sourceUrl && message.action === "saveNote") {
      const source = new URL(context.sourceUrl);
      if (
        source.origin !== "https://www.youtube.com" ||
        source.searchParams.get("v") !== message.videoId
      )
        return { success: false, error: "Video target changed" };
    }
    const requestId = message.__ys_requestId || crypto.randomUUID();
    if (inFlight.has(requestId)) return inFlight.get(requestId)!;
    const epoch = resetEpoch;
    const trace: Trace = {
      requestId,
      actionId: requestId,
      flow: requestId,
      causedBy: "Gateway/request",
      rule: message.action,
      objectId: String(message.videoId || ""),
      emittedCalls: [],
      phase: "started",
      at: Date.now(),
    };
    const operation = (async () => {
      if (!(await p.execution.enter(trace)))
        return {
          success: false,
          error: "Request already handled; issue a new explicit request",
          code: "REPLAY_SUPPRESSED",
        };
      try {
        const invoke = () =>
          epoch !== resetEpoch && message.action !== "resetData"
            ? Promise.resolve({
                success: false,
                error: "Data was reset during request",
              })
            : apply({ ...message, __ys_requestId: requestId }, epoch, trace);
        const serialized = [
          "vocabularyCapture",
          "vocabularyRemoveEntry",
          "vocabularyRemoveExample",
          "cacheWrite",
          "cacheEvict",
          "cacheClear",
          "resetData",
        ].includes(message.action);
        const operation = serialized
          ? mutationQueue.catch(() => {}).then(invoke)
          : invoke();
        if (serialized) mutationQueue = operation;
        const value = await operation;
        if (epoch !== resetEpoch && message.action !== "resetData")
          return { success: false, error: "Data was reset during request" };
        await p.execution.finish({
          ...trace,
          phase: value?.success === false ? "failed" : "completed",
          at: Date.now(),
        });
        return value;
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        await p.execution.finish({
          ...trace,
          phase: "failed",
          at: Date.now(),
          error: "Action failed",
        });
        return { success: false, error: text };
      }
    })();
    inFlight.set(requestId, operation);
    try {
      return await operation;
    } finally {
      inFlight.delete(requestId);
    }
  }
  return { dispatch };
}
export type Application = ReturnType<typeof createApplication>;

/** View-facing facade: presenters cannot bypass syncs to reach business storage. */
export function createViewApi(p: {
  remote: Remote;
  reading: Reading;
  translation: Translation;
  export: Export;
  settings: any;
}) {
  const sendMessage: Remote = (m) =>
    p.remote({ ...m, __ys_requestId: m.__ys_requestId || crypto.randomUUID() });
  async function call(action: string, value: Record<string, unknown> = {}) {
    const result = await sendMessage({ action, ...value });
    if (result?.success === false) {
      if (String(result.error || "").startsWith("Unknown action: vocabulary"))
        throw new Error(
          "插件后台仍为旧版本，请在扩展管理页重新加载 YouTube Scaffold，再重新打开侧栏",
        );
      throw new Error(result.error || "Application operation failed");
    }
    return result;
  }
  return {
    sendMessage,
    settings: p.settings,
    export: p.export,
    reading: {
      groupTranscriptEntries: p.reading.groupTranscriptEntries,
      splitOversizedThought: p.reading.splitOversizedThought,
      normalizeCaptionText: p.reading.normalizeCaptionText,
      findLiteralTranscriptMatches: p.reading.findLiteralTranscriptMatches,
      context: p.reading.context,
      selection: p.reading.selection,
      vocabularyContext: p.reading.vocabularyContext,
      wordMatches: p.reading.wordMatches,
      viewStorage: {
        get: async (key: string) => (await call("viewGet", { key })).value,
        set: async (value: unknown) => {
          await call("viewSet", { value });
        },
      },
    },
    translation: { align: p.translation.align },
    cache: {
      read: async (videoId: string) =>
        (await call("cacheRead", { videoId })).value,
      write: async (videoId: string, value: unknown) => {
        await call("cacheWrite", { videoId, value });
      },
      evict: async (max: number) => {
        await call("cacheEvict", { max });
      },
      clear: async () => (await call("cacheClear")).count as number,
    },
    vocabulary: {
      list: async () => (await call("vocabularyList")).cards,
      capture: (input: unknown) => call("vocabularyCapture", { input }),
      translate: (id: string) => call("vocabularyTranslate", { id }),
      removeEntry: (id: string) => call("vocabularyRemoveEntry", { id }),
      removeExample: (id: string) => call("vocabularyRemoveExample", { id }),
    },
    collection: {
      clear: async () => {
        await call("clearNotes");
      },
    },
    configurationStorage: {
      get: async (keys: unknown) =>
        (await call("configurationGet", { keys })).value,
      set: async (value: unknown) => {
        await call("configurationSet", { value });
      },
      remove: async (keys: unknown) => {
        await call("configurationRemove", { keys });
      },
      clear: async () => {
        await call("resetData");
      },
    },
    reset: async () => {
      await call("resetData");
    },
  };
}
export type ViewApi = ReturnType<typeof createViewApi>;
