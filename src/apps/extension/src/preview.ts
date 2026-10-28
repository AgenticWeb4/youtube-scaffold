// Development-only browser harness. This entry is excluded from the extension/ZIP.
import { startPanel } from "./sidepanel.js";
import { mountOptions } from "@ys/gateway";
import { assembleView, assembleApplication } from "./platform.js";
import { createMemoryStore } from "@ys/infrastructure";
import { createVocabulary, createVocabularyDatabase } from "@ys/vocabulary";
// A separate synthetic database lets browser checks exercise long histories
// without touching ordinary preview words or the installed extension's data.
const historyFixture =
  new URLSearchParams(location.search).get("fixture") === "vocabulary-history";
// Vocabulary uses real browser IndexedDB, with synthetic translation only.
const localApp = assembleApplication(createMemoryStore(), createMemoryStore(), {
  ...(historyFixture
    ? {
        vocabulary: createVocabulary(
          createVocabularyDatabase("ys_vocabulary_history_preview").repository,
        ),
      }
    : {}),
  model: {
    getSettings: async () => ({
      provider: "deepseek",
      aiApiKey: "fixture",
      supadataApiKey: "fixture",
      aiBaseUrl: "https://api.deepseek.com",
      aiModel: "fixture",
    }),
    prompt: async () => "Fixture translation",
    request: async (options) => ({
      text: JSON.stringify({
        segments: JSON.parse(options.messages[1].content).segments.map(
          (s: any) => ({ id: s.id, text: "结论依赖证据与假设。" }),
        ),
      }),
    }),
  },
  notify: (message) => listeners.forEach((fn) => fn(message, {}, () => {})),
});
const listeners: ((
  message: any,
  sender: any,
  respond: (value: any) => void,
) => void)[] = [];
const listener = { addListener() {} };
const origin = "https://www.youtube.com/watch?v=videoA00001";
async function sendMessage(message: any) {
  if (message.action.startsWith("vocabulary"))
    return localApp.application.dispatch(message, { trusted: true });
  if (message.action === "openOptions") {
    location.href = "/options.html";
    return { success: true };
  }
  const response = await fetch("/api", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(message),
  });
  const value = await response.json();
  if (message.action === "saveNote" && value.success)
    listeners.forEach((fn) =>
      fn({ action: "noteSaved", note: value.note }, {}, () => {}),
    );
  return value;
}
(globalThis as any).chrome = {
  runtime: {
    sendMessage,
    onMessage: {
      addListener: (
        fn: (message: any, sender: any, respond: (value: any) => void) => void,
      ) => listeners.push(fn),
    },
  },
  windows: { getCurrent: async () => ({ id: 1 }) },
  tabs: {
    query: async () => [{ id: 1, windowId: 1, active: true, url: origin }],
    get: async () => ({ id: 1, windowId: 1, active: true, url: origin }),
    onUpdated: listener,
    onActivated: listener,
    sendMessage: async (_: number, payload: any) =>
      (await sendMessage({ action: "relayToContent", payload })).response,
    create: async () => {},
  },
};
document.title = "Fixture preview — YouTube Scaffold";
const banner = document.createElement("div");
banner.textContent = "开发验证：合成视频与模型数据（非真实 API 结果）";
banner.style.cssText =
  "padding:8px;background:#fff4cf;color:#5b4d22;text-align:center;font:12px system-ui";
document.body.prepend(banner);
const api = assembleView(sendMessage);
if (location.pathname.includes("options")) mountOptions(api);
else
  void (async () => {
    if (historyFixture) {
      for (let i = 0; i < 26; i++) {
        await localApp.application.dispatch(
          {
            action: "vocabularyCapture",
            input: {
              term: "evidence",
              videoId: "videoA00001",
              videoTitle: `Fixture learning source ${i + 1}`,
              sentenceEn: `Source ${i + 1}: The evidence supports the claim.`,
              sentenceZh: `语境 ${i + 1}：证据支持论点。`,
              startMs: i * 20000,
            },
          },
          { trusted: true },
        );
      }
    }
    startPanel(api);
  })();
