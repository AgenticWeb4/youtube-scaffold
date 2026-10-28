import {
  createVocabulary,
  createVocabularyDatabase,
  type Vocabulary,
} from "@ys/vocabulary";
import {
  createStore,
  createMemoryStore,
  createConfiguration,
  createModelPort,
  canonicalUrl,
  configuration,
} from "@ys/infrastructure";
import { createReading } from "@ys/reading";
import { createTranslation } from "@ys/translation";
import { createExplanation } from "@ys/explanation";
import { createSummary } from "@ys/summary";
import { createCollection } from "@ys/collection";
import { createExport } from "@ys/export";
import { createApplication, createViewApi } from "@ys/syncs";
import type { KVStore, ModelPort, Trace } from "@ys/shared";

declare const chrome: any;

/** Worker is the sole writer for persistent material, AI caches, preferences and notes. */
export function assembleApplication(
  store: KVStore,
  session: KVStore,
  options: {
    vocabulary?: Vocabulary;
    model?: ModelPort;
    fetch?: typeof fetch;
    configurationFetch?: typeof fetch;
    loadText?: (file: string) => Promise<string>;
    notify?: (message: Record<string, unknown>) => void;
  } = {},
) {
  const vocabulary =
    options.vocabulary ||
    createVocabulary(createVocabularyDatabase().repository);
  const config = createConfiguration(store, {
    fetch: options.configurationFetch,
  });
  const model =
    options.model ||
    createModelPort({
      config,
      fetch: options.fetch,
      loadText:
        options.loadText ||
        (async (file) => {
          const response = await fetch(
            chrome.runtime.getURL(`prompts/${file}`),
          );
          if (!response.ok) throw new Error("Prompt not found");
          return response.text();
        }),
    });
  const reading = createReading({
    store,
    session,
    source: { getSettings: config.read, canonicalUrl, fetch: options.fetch },
  });
  const translation = createTranslation({ model, store });
  const explanation = createExplanation(model);
  const summary = createSummary({ model, store });
  const collection = createCollection({ model, store, canonicalUrl });
  const execution = {
    async enter(trace: Trace) {
      let entered = false;
      await store.update<Trace[]>("ys_execution", (old) => {
        const records = old || [];
        if (records.some((item) => item.requestId === trace.requestId))
          return records;
        entered = true;
        return [...records, trace].slice(-250);
      });
      return entered;
    },
    async finish(trace: Trace) {
      await store.update<Trace[]>("ys_execution", (old) =>
        (old || []).map((item) =>
          item.requestId === trace.requestId ? trace : item,
        ),
      );
    },
    async clear() {
      await store.remove("ys_execution");
    },
  };
  const application = createApplication({
    vocabulary,
    reading,
    translation,
    explanation,
    summary,
    collection,
    config,
    execution,
    notify: options.notify || (() => {}),
  });
  return {
    application,
    vocabulary,
    reading,
    translation,
    explanation,
    summary,
    collection,
    config,
  };
}

export function assembleWorker() {
  const store = createStore(chrome.storage.local);
  const session = chrome.storage.session
    ? createStore(chrome.storage.session)
    : store;
  return assembleApplication(store, session, {
    notify: (message) => {
      chrome.runtime.sendMessage(message).catch(() => {});
    },
  }).application;
}

/** Local feature tools are pure queries; all persistent business writes use the worker facade. */
export function assembleView(
  remote = (message: unknown) => chrome.runtime.sendMessage(message),
  exporter = createExport(),
) {
  const store = createMemoryStore();
  const model: ModelPort = {
    getSettings: async () => ({ ...configuration.DEFAULTS }),
    prompt: async () => "",
    request: async () => {
      throw new Error("AI actions must enter through the worker");
    },
  };
  return createViewApi({
    remote,
    reading: createReading({ store, session: store }),
    translation: createTranslation({ model, store }),
    export: exporter,
    settings: configuration,
  });
}
