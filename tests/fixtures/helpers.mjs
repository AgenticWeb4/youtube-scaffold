import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import {
  createVocabulary,
  createVocabularyDatabase,
} from "../../src/features/vocabulary/dist/index.js";
import fs from "node:fs/promises";
import {
  createMemoryStore,
  canonicalUrl,
  createConfiguration,
  createModelPort,
} from "../../src/modules/infrastructure/dist/index.js";
import { assembleApplication } from "../../src/apps/extension/dist/platform.js";

export {
  createMemoryStore,
  canonicalUrl,
  createConfiguration,
  createModelPort,
};
export const id = "videoA00001";
export const captions = [
  { text: "A hypothesis needs evidence.", start: 0, duration: 5 },
  { text: "The evidence supports the conclusion.", start: 5, duration: 5 },
  { text: "Assumptions determine where it holds.", start: 10, duration: 5 },
];
export const analysis = {
  chapters: [
    {
      title: "Evidence",
      summary: "How evidence supports a conclusion.",
      timestampSeconds: 0,
      timestamp: "0:00",
    },
  ],
  keyQuotes: [
    {
      quote: "A hypothesis needs evidence.",
      timestampSeconds: 0,
      timestamp: "0:00",
    },
  ],
  keyMoments: [0],
};
export const settings = {
  provider: "deepseek",
  aiApiKey: "fixture-key",
  supadataApiKey: "fixture-key",
  aiBaseUrl: "https://api.deepseek.com",
  aiModel: "deepseek-v4-flash",
};
export const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
export const model = (
  request = async () => ({ text: JSON.stringify(analysis) }),
) => ({
  getSettings: async () => ({ ...settings }),
  prompt: async (file, heading, variables = {}) =>
    JSON.stringify({ file, heading, ...variables }),
  request,
});
export const material = () => ({
  transcript: structuredClone(captions),
  transcriptText: captions.map((c) => c.text).join(" "),
  transcriptTimestamped: captions
    .map((c) => `[0:${String(c.start).padStart(2, "0")}] ${c.text}`)
    .join("\n"),
  transcriptLanguage: "en",
  videoTitle: "Evidence",
  channelName: "Example",
  timestamp: Date.now(),
});
export async function application(options = {}) {
  const store = createMemoryStore();
  const session = createMemoryStore();
  const app = assembleApplication(store, session, {
    vocabulary: createVocabulary(
      createVocabularyDatabase(crypto.randomUUID(), { indexedDB, IDBKeyRange })
        .repository,
    ),
    model: model(),
    ...options,
  });
  await app.config.save(settings);
  const dispatch = (message, context = { trusted: true }) =>
    app.application.dispatch(message, context);
  return { store, session, ...app, dispatch };
}
export async function prompts(file) {
  return fs.readFile(
    new URL(`../../src/apps/extension/public/prompts/${file}`, import.meta.url),
    "utf8",
  );
}
