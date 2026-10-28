import type { Config, KVStore, ModelPort } from "@ys/shared";
import { configuration } from "./configuration.js";
import { createProvider } from "./provider.js";
import { createConnectionTester } from "./connection.js";

export { configuration };
export { createProvider };
export { createConnectionTester };
export type { ConnectionResult, ProviderName } from './connection.js';
export interface StorageArea {
  get(key: string | null): Promise<Record<string, unknown>>;
  set(value: Record<string, unknown>): Promise<void>;
  remove(key: string | string[]): Promise<void>;
}
export function createStore(area: StorageArea): KVStore {
  const queues = new Map<string, Promise<unknown>>();
  const store: KVStore = {
    async get<T>(key: string) {
      return (await area.get(key))[key] as T | undefined;
    },
    async set<T>(key: string, value: T) {
      await area.set({ [key]: value });
    },
    async update<T>(key: string, change: (old: T | undefined) => T) {
      const operation = (queues.get(key) || Promise.resolve())
        .catch(() => {})
        .then(async () => {
          const value = change(await store.get<T>(key));
          await area.set({ [key]: value });
          return value;
        });
      queues.set(key, operation);
      try {
        return await operation;
      } finally {
        if (queues.get(key) === operation) queues.delete(key);
      }
    },
    async keys(prefix = "") {
      return Object.keys(await area.get(null)).filter((key) =>
        key.startsWith(prefix),
      );
    },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        const op = (queues.get(key) || Promise.resolve())
          .catch(() => {})
          .then(() => area.remove(key));
        queues.set(key, op);
        try {
          await op;
        } finally {
          if (queues.get(key) === op) queues.delete(key);
        }
      }
    },
  };
  return store;
}
export function createMemoryStore(): KVStore {
  const values = new Map<string, unknown>();
  return createStore({
    async get(key) {
      return structuredClone(
        key === null ? Object.fromEntries(values) : { [key]: values.get(key) },
      );
    },
    async set(items) {
      for (const [key, value] of Object.entries(items))
        values.set(key, structuredClone(value));
    },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) values.delete(key);
    },
  });
}
export function createConfiguration(
  store: KVStore,
  options: { fetch?: typeof fetch; timeoutMs?: number } = {},
) {
  const testConnection = createConnectionTester(options);
  return {
    api: configuration,
    async read(): Promise<Config> {
      return configuration.normalize((await store.get("ytd_settings")) || {});
    },
    async readRaw() {
      return await store.get<Record<string, unknown>>("ytd_settings");
    },
    async save(input: unknown) {
      const value = configuration.normalize(input as any);
      await store.set("ytd_settings", value);
      return value;
    },
    async language() {
      return (await store.get("ytd_options_language")) || "en";
    },
    async setLanguage(value: unknown) {
      await store.set("ytd_options_language", value === "zh-CN" ? value : "en");
    },
    async reset() {
      await store.remove(["ytd_settings", "ytd_options_language"]);
    },
    testConnection,
  };
}
export function createModelPort(options: {
  config: ReturnType<typeof createConfiguration>;
  loadText(file: string): Promise<string>;
  fetch?: typeof fetch;
}): ModelPort {
  const texts = new Map<string, Promise<string>>();
  const provider = createProvider({
    getSettings: options.config.read,
    fetch: options.fetch,
  });
  return {
    getSettings: options.config.read,
    request: provider.request,
    async prompt(file, heading, values = {}) {
      if (!/^[a-z-]+\.md$/.test(file))
        throw new Error("Invalid prompt filename");
      if (!texts.has(file))
        texts.set(
          file,
          options.loadText(file).catch((error) => {
            texts.delete(file);
            throw error;
          }),
        );
      const markdown = await texts.get(file)!;
      const marker = `## ${heading}`;
      const start = markdown.indexOf(marker);
      if (start < 0)
        throw new Error(`Prompt section not found: ${file}#${heading}`);
      const end = markdown.indexOf("\n## ", start + marker.length);
      const section = markdown.slice(
        start + marker.length,
        end < 0 ? undefined : end,
      );
      const fence = section.match(/```(?:[A-Za-z0-9_-]+)?\n([\s\S]*?)\n```/);
      if (!fence) throw new Error(`Prompt fence not found: ${file}#${heading}`);
      // One pass: braces in user text cannot become recursive substitutions.
      return fence[1].replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (whole, key) =>
        Object.hasOwn(values, key) ? String(values[key] ?? "") : whole,
      );
    },
  };
}
export function canonicalUrl(videoId: string) {
  return configuration.canonicalYouTubeUrl(videoId);
}
